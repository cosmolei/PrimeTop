# 服务端 - 统一变更数据捕获(CDC)管道与数据同步总线 详细设计

## 1. 概述

### 1.1 模块定位

统一变更数据捕获（Change Data Capture，简称 CDC）管道是 PrimeTop 平台的**核心数据基础设施**，负责在业务数据库发生变更时，以**低延迟、高可靠**的方式将变更事件捕获并分发给所有下游消费方（搜索引擎、缓存、数据仓库、推荐系统、消息推送等）。

CDC 管道是跨服务数据一致性的基石——它将"数据写入"与"数据传播"解耦，使业务服务无需关心下游同步逻辑。

### 1.2 核心职责

| 职责 | 说明 |
|------|------|
| 变更捕获 | 实时捕获 MySQL/PostgreSQL 的 INSERT/UPDATE/DELETE 事件 |
| 事件标准化 | 将不同数据源的变更转为统一的 `ChangeEvent` 标准格式 |
| 事件分发 | 将变更事件投递到 Kafka Topic，支持多消费者独立消费 |
| 顺序保证 | 保证同一主键的变更事件按发生顺序投递 |
| 幂等支持 | 消费者可安全重试，不会产生副作用 |
| 断点续传 | 记录消费位移(offset)，支持故障恢复后从断点继续 |
| Schema 演进 | 支持表结构变更后的兼容处理 |

### 1.3 依赖关系

```
┌────────────────────────────────────────────────────────────────────┐
│                     上游 (数据生产者)                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ 用户服务  │  │ 题目服务  │  │ 学习服务  │  │ 内容服务  │  ...      │
│  │ MySQL-A  │  │ MySQL-B  │  │ MySQL-C  │  │ MySQL-D  │           │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
└───────┼─────────────┼─────────────┼─────────────┼─────────────────┘
        │             │             │             │
        ▼             ▼             ▼             ▼
┌────────────────────────────────────────────────────────────────────┐
│                  CDC 管道 (本模块)                                   │
│  ┌──────────┐  ┌──────────────────────────────────┐               │
│  │ Debezium │→ │ Kafka (cdc.{db}.{table} topics)  │               │
│  │ Connect  │  │                                  │               │
│  └──────────┘  └──────────────┬───────────────────┘               │
└────────────────────────────────┼───────────────────────────────────┘
                                 │
        ┌────────────┬───────────┼───────────┬────────────┐
        ▼            ▼           ▼           ▼            ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ ES 索引   │ │ Redis    │ │ 数据仓库  │ │ 推荐     │ │ Outbox   │
│ 同步消费  │ │ 缓存失效  │ │ ODS 入库  │ │ 特征更新  │ │ 中继     │
│ 方        │ │ 消费方    │ │ 消费方    │ │ 消费方    │ │ 消费方    │
└──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

**上游依赖：**
- MySQL 8.0+（必须开启 Binlog，ROW 模式）
- Kafka 3.x（CDC 事件传输骨干）
- Debezium 2.x（开源 CDC 引擎，基于 Kafka Connect）

**下游消费方（已知）：**
- 搜索服务（Elasticsearch 索引同步）
- 缓存层（Redis 缓存失效）
- 数据仓库（ClickHouse ODS 层入库）
- 推荐系统（用户特征/物品特征实时更新）
- 学习行为事件流（跨模块级联处理）
- 统一数据对账（一致性校验）

### 1.4 设计原则

1. **对业务零侵入**：业务代码无需任何修改，CDC 在数据库层面工作
2. **至少一次语义**：事件可能重复投递，但不会丢失（消费者需实现幂等）
3. **最终一致性**：秒级延迟，非强一致（适合搜索索引、缓存、分析等场景）
4. **可观测性**：全链路延迟监控、积压告警、数据校验
5. **优雅降级**：单个消费者故障不影响其他消费者

---

## 2. 整体架构

### 2.1 架构全景

```
                        PrimeTop CDC Pipeline Architecture

┌─────────────────────────────────────────────────────────────────────────────┐
│  业务数据库集群                                                               │
│                                                                             │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐      │
│  │ MySQL: primetop │     │ MySQL: content  │     │ MySQL: analytics│      │
│  │ (用户/题/错题)   │     │ (教材/课程/资源)  │     │ (日志/统计)      │      │
│  │ Binlog: ROW     │     │ Binlog: ROW     │     │ Binlog: ROW     │      │
│  └────────┬────────┘     └────────┬────────┘     └────────┬────────┘      │
└───────────┼───────────────────────┼───────────────────────┼──────────────┘
            │                       │                       │
            │ TCP (Binlog Dump)     │                       │
            ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Kafka Connect 集群 (3 nodes, Debezium Connectors)                           │
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │ Connector:   │    │ Connector:   │    │ Connector:   │                  │
│  │ primetop-cdc │    │ content-cdc  │    │ analytics-cdc│                  │
│  │              │    │              │    │              │                  │
│  │ Source:      │    │ Source:      │    │ Source:      │                  │
│  │ Debezium     │    │ Debezium     │    │ Debezium     │                  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘                  │
└─────────┼───────────────────┼───────────────────┼──────────────────────────┘
          │                   │                   │
          ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Kafka Cluster (5 brokers)                                                  │
│                                                                             │
│  Topic: cdc.primetop.users           (PARTITIONS=6)                        │
│  Topic: cdc.primetop.student_profiles (PARTITIONS=3)                       │
│  Topic: cdc.primetop.questions        (PARTITIONS=6)                       │
│  Topic: cdc.primetop.mistake_records  (PARTITIONS=6)                       │
│  Topic: cdc.primetop.orders           (PARTITIONS=3)                       │
│  Topic: cdc.content.textbooks         (PARTITIONS=3)                       │
│  Topic: cdc.content.chapters          (PARTITIONS=3)                       │
│  Topic: cdc.content.knowledge_points  (PARTITIONS=6)                       │
│  Topic: cdc.content.questions         (PARTITIONS=6)                       │
│  Topic: cdc.analytics.*               (PARTITIONS=3)                       │
│  ...                                                                        │
│                                                                             │
│  Consumer Groups:                                                           │
│  - cg-es-sync         (ES 索引同步)                                          │
│  - cg-cache-invalidate(Redis 缓存失效)                                       │
│  - cg-dw-ods          (数据仓库 ODS 入库)                                    │
│  - cg-recommend       (推荐特征更新)                                         │
│  - cg-reconciliation  (数据对账)                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| CDC 引擎 | **Debezium 2.5+** | 开源成熟、社区活跃、原生支持 MySQL/PostgreSQL、基于 Kafka Connect 标准框架 |
| 消息队列 | **Apache Kafka 3.6+** | 高吞吐、持久化、多消费者独立 offset、Exactly-Once 支持 |
| Schema 注册 | **Confluent Schema Registry** | Avro/JSON Schema 管理、向前/向后兼容检查 |
| 连接管理 | **Kafka Connect** | 分布式 Connector 管理、自动故障转移、REST API 管理 |
| 监控 | **Prometheus + Debezium Exporter** | Connector 延迟、Kafka 积压标准监控方案 |

> **为何不用 Canal？** Canal 在国内也很流行，但 Debezium 在 Kafka Connect 生态中集成更自然，Schema Registry 支持更好，且社区迭代更活跃。Canal 适合纯 Java/Spring 技术栈且不需要 Kafka 的场景。

---

## 3. 数据模型

### 3.1 Debezium 标准变更事件格式

Debezium 产生的原始事件为 `Envelope` 格式：

```json
{
  "payload": {
    "before": {
      "id": 1001,
      "name": "张三",
      "grade": 7,
      "updated_at": "2026-06-27T10:00:00Z"
    },
    "after": {
      "id": 1001,
      "name": "张三",
      "grade": 8,
      "updated_at": "2026-06-27T12:30:00Z"
    },
    "source": {
      "version": "2.5.0.Final",
      "connector": "mysql",
      "name": "primetop",
      "ts_ms": 1719486600000,
      "snapshot": "false",
      "db": "primetop",
      "sequence": null,
      "ts_us": 1719486600000000,
      "table": "students",
      "server_id": 1,
      "gtid": null,
      "file": "mysql-bin.000123",
      "pos": 4567,
      "row": 0,
      "thread": null,
      "query": null
    },
    "op": "u",
    "ts_ms": 1719486600123,
    "transaction": null
  }
}
```

| 字段 | 说明 |
|------|------|
| `before` | 变更前的行数据快照（INSERT 时为 null） |
| `after` | 变更后的行数据快照（DELETE 时为 null） |
| `source` | 变更来源元数据（数据库、表、Binlog 位置等） |
| `op` | 操作类型：`c`=CREATE, `u`=UPDATE, `d`=DELETE, `r`=READ(快照) |
| `ts_ms` | Connector 处理时间戳 |
| `transaction` | 事务元数据（可选） |

### 3.2 PrimeTop 统一变更事件格式

在各消费者侧，建议将 Debezium Envelope 转换为 PrimeTop 统一的 `ChangeEvent` 格式：

```python
# domain/events/change_event.py

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional

class ChangeOp(str, Enum):
    CREATE = "c"
    UPDATE = "u"
    DELETE = "d"
    SNAPSHOT = "r"  # 初始全量快照

@dataclass
class ChangeEvent:
    """PrimeTop 统一 CDC 变更事件"""

    # ── 标识 ──
    event_id: str                    # 全局唯一事件ID (UUID)
    table: str                       # 源表名 (如 "students")
    database: str                    # 源数据库名 (如 "primetop")
    op: ChangeOp                     # 操作类型

    # ── 数据 ──
    before: Optional[dict[str, Any]] # 变更前行数据
    after: Optional[dict[str, Any]]  # 变更后行数据
    primary_key: dict[str, Any]      # 主键字段 {列名: 值}，支持复合主键

    # ── 元数据 ──
    source_ts: int                   # 数据库变更时间 (毫秒时间戳)
    ingest_ts: int                   # CDC 采集时间 (毫秒时间戳)
    binlog_file: str                 # MySQL Binlog 文件名
    binlog_pos: int                  # Binlog 位置
    transaction_id: Optional[str]    # 事务ID (如果是事务内变更)

    # ── 扩展 ──
    metadata: dict[str, Any] = field(default_factory=dict)
```

### 3.3 Kafka Topic 命名规范

```
命名模式: cdc.{database}.{table}

示例:
cdc.primetop.users               # 用户表变更
cdc.primetop.student_profiles    # 学生档案变更
cdc.primetop.questions           # 题目表变更
cdc.primetop.mistake_records     # 错题记录变更
cdc.primetop.orders              # 订单变更
cdc.primetop.ai_conversations    # AI对话记录变更
cdc.content.textbooks            # 教材变更
cdc.content.chapters             # 章节变更
cdc.content.knowledge_points     # 知识点变更
```

**Topic 配置策略：**

| 参数 | 推荐值 | 理由 |
|------|--------|------|
| `partitions` | 3~6 (按表写入量决定) | 高频表(questions/mistake_records) 6分区，低频表(textbooks) 3分区 |
| `replication.factor` | 3 | 高可用 |
| `retention.ms` | 7天 (604800000) | 给消费者足够的恢复时间 |
| `cleanup.policy` | delete | 精确消费，不用 compact（compact 会删除中间状态） |
| `min.insync.replicas` | 2 | 保证数据可靠性 |

> **注意**：CDC Topic 不适合用 Log Compaction，因为变更事件是"动作"而非"状态"，中间状态不可丢弃。如果需要表状态快照，应使用单独的 compact topic。

### 3.4 分区策略

按**主键 Hash** 分区，保证同一实体的所有变更事件进入同一分区，从而保证顺序性：

```
partition = hash(primary_key) % partition_count
```

Debezium 默认使用主键哈希分区，无需额外配置。

对于没有主键的表（不推荐但可能存在），使用表名+行 Hash。

---

## 4. Debezium Connector 配置

### 4.1 MySQL 侧前置准备

```sql
-- my.cnf 必须配置
-- [mysqld]
-- server-id         = 1
-- log_bin           = mysql-bin
-- binlog_format     = ROW          -- 必须 ROW 模式
-- binlog_row_image  = FULL         -- 记录完整的 before/after
-- binlog_expire_logs_seconds = 604800  -- 保留7天
-- expire_logs_days  = 7            -- MySQL 8.0.29 之前用这个

-- 创建 CDC 专用账号
CREATE USER 'debezium'@'%' IDENTIFIED BY '<strong_password>';
GRANT SELECT, RELOAD, SHOW DATABASES, REPLICATION SLAVE, REPLICATION CLIENT
  ON *.* TO 'debezium'@'%';
GRANT ALL PRIVILEGES ON primetop.* TO 'debezium'@'%';
FLUSH PRIVILEGES;

-- 确认 Binlog 配置
SHOW VARIABLES LIKE 'binlog_format';       -- 必须为 ROW
SHOW VARIABLES LIKE 'binlog_row_image';    -- 必须为 FULL
SHOW VARIABLES LIKE 'log_bin';             -- 必须为 ON
```

### 4.2 Debezium Connector 配置（主库 - primetop）

```json
{
  "name": "primetop-cdc-connector",
  "config": {
    "connector.class": "io.debezium.connector.mysql.MySqlConnector",
    "database.hostname": "mysql-primetop.internal",
    "database.port": "3306",
    "database.user": "debezium",
    "database.password": "${vault:secret/cdc/primetop:password}",
    "database.server.id": "184054",
    "database.server.name": "primetop",
    "database.include.list": "primetop",
    "table.include.list": "primetop.users,primetop.student_profiles,primetop.questions,primetop.mistake_records,primetop.orders,primetop.memberships,primetop.ai_conversations,primetop.learning_sessions,primetop.study_plans,primetop.parent_bindings,primetop.answers",
    "database.history.kafka.bootstrap.servers": "kafka-1:9092,kafka-2:9092,kafka-3:9092",
    "database.history.kafka.topic": "schema-changes.primetop",
    "snapshot.mode": "initial",
    "snapshot.locking.mode": "minimal",
    "snapshot.fetch.size": "2000",
    "tombstones.on.delete": "true",
    "converters": "datetimeConvert",
    "datetimeConvert.type": "com.primetop.cdc.converter.TimestampConverter",
    "datetimeConvert.format.date": "yyyy-MM-dd",
    "datetimeConvert.format.time": "HH:mm:ss",
    "datetimeConvert.format.datetime": "yyyy-MM-dd HH:mm:ss",
    "decimal.handling.mode": "string",
    "time.precision.mode": "connect",
    "max.batch.size": "2048",
    "max.queue.size": "8192",
    "poll.interval.ms": "500",
    "heartbeat.interval.ms": "5000",
    "heartbeat.topics.prefix": "heartbeat",
    "errors.tolerance": "none",
    "errors.log.enable": "true",
    "errors.log.include.messages": "true",
    "value.converter": "io.confluent.connect.avro.AvroConverter",
    "value.converter.schema.registry.url": "http://schema-registry:8081",
    "key.converter": "io.confluent.connect.avro.AvroConverter",
    "key.converter.schema.registry.url": "http://schema-registry:8081"
  }
}
```

**关键参数解释：**

| 参数 | 值 | 说明 |
|------|-----|------|
| `snapshot.mode` | `initial` | 首次启动时做全量快照，之后转为增量 Binlog |
| `snapshot.locking.mode` | `minimal` | 快照期间短暂加全局读锁，最小化业务影响 |
| `tombstones.on.delete` | `true` | DELETE 操作后追加一个 tombstone(null值)，通知 Stream 处理框架清理状态 |
| `decimal.handling.mode` | `string` | 金额等 DECIMAL 字段转字符串，避免浮点精度丢失 |
| `heartbeat.interval.ms` | `5000` | 每5秒发送心跳，防止 Binlog 位点过期 |
| `max.batch.size` | `2048` | 每批次最多处理 2048 条变更 |
| `max.queue.size` | `8192` | 内部队列大小，起缓冲作用 |

### 4.3 Connector 注册（REST API）

```bash
# 注册 Connector
curl -X POST http://kafka-connect:8083/connectors \
  -H "Content-Type: application/json" \
  -d @primetop-cdc-connector.json

# 查看状态
curl http://kafka-connect:8083/connectors/primetop-cdc-connector/status

# 暂停/恢复
curl -X PUT http://kafka-connect:8083/connectors/primetop-cdc-connector/pause
curl -X PUT http://kafka-connect:8083/connectors/primetop-cdc-connector/resume

# 删除（谨慎！）
curl -X DELETE http://kafka-connect:8083/connectors/primetop-cdc-connector
```

### 4.4 新增表 CDC 接入流程

当业务需要新表接入 CDC 时：

```
Step 1: 在 table.include.list 中添加新表名
Step 2: 更新 Connector 配置 (PUT /connectors/{name}/config)
Step 3: Connector 自动对新表触发 initial snapshot
Step 4: 在 Schema Registry 注册新表的 Avro Schema
Step 5: 消费者侧注册新的消费逻辑
Step 6: 在 CDC 管理后台确认新表 Topic 有数据流入
```

```bash
# 更新 Connector 配置，新增表
curl -X PUT http://kafka-connect:8083/connectors/primetop-cdc-connector/config \
  -H "Content-Type: application/json" \
  -d '{
    ...原配置...,
    "table.include.list": "primetop.users,...,primetop.new_table"
  }'
```

---

## 5. 消费者设计

### 5.1 ES 索引同步消费者

将 MySQL 变更实时同步到 Elasticsearch，保持搜索索引与源数据库一致。

```python
# consumers/es_sync_consumer.py

import json
from kafka import KafkaConsumer
from elasticsearch import Elasticsearch, helpers
from dataclasses import asdict

class ESSyncConsumer:
    """CDC → Elasticsearch 索引同步消费者"""

    # 表名到ES索引的映射
    TABLE_INDEX_MAP = {
        "questions":       "idx_questions",
        "knowledge_points": "idx_knowledge_points",
        "textbooks":       "idx_textbooks",
        "chapters":        "idx_chapters",
    }

    # 表名到需要同步的字段白名单（避免同步敏感字段）
    FIELD_WHITELIST = {
        "questions": ["id", "subject", "grade", "difficulty", "type",
                       "stem", "options", "answer", "analysis", "kp_ids",
                       "tags", "status", "created_at", "updated_at"],
        "knowledge_points": ["id", "name", "subject", "grade",
                       "parent_id", "description", "kp_code", "sort_order"],
    }

    def __init__(self, kafka_servers: list[str], es_hosts: list[str]):
        self.consumer = KafkaConsumer(
            *self._build_topics(),
            bootstrap_servers=kafka_servers,
            group_id="cg-es-sync",
            enable_auto_commit=False,
            auto_offset_reset="earliest",
            max_poll_records=500,
            session_timeout_ms=30000,
            heartbeat_interval_ms=10000,
            value_deserializer=lambda m: json.loads(m.decode("utf-8")),
        )
        self.es = Elasticsearch(es_hosts)
        self._buffer: list[dict] = []
        self._buffer_size = 0
        self.MAX_BUFFER = 200  # 批量提交大小

    def _build_topics(self) -> list[str]:
        """根据 TABLE_INDEX_MAP 构建 Topic 列表"""
        return [f"cdc.primetop.{table}" for table in self.TABLE_INDEX_MAP]

    def consume(self):
        """主消费循环"""
        for record in self.consumer:
            try:
                self._process_event(record.value)
                self._maybe_flush()
            except Exception as e:
                self._handle_error(record, e)

        # 循环结束后刷新剩余缓冲
        self._flush()

    def _process_event(self, event: dict):
        """处理单条变更事件"""
        # 从 Debezium Envelope 中提取信息
        payload = event.get("payload", event)
        op = payload.get("op", "r")
        before = payload.get("before")
        after = payload.get("after")
        source = payload.get("source", {})
        table = source.get("table", "")

        if table not in self.TABLE_INDEX_MAP:
            return

        index_name = self.TABLE_INDEX_MAP[table]
        doc_id = str(after["id"] if after else before["id"])

        if op == "d":
            # DELETE: 从ES中删除文档
            self._buffer.append({
                "_op_type": "delete",
                "_index": index_name,
                "_id": doc_id,
            })
        elif op in ("c", "u", "r"):
            # CREATE / UPDATE / SNAPSHOT: upsert 文档
            doc = self._filter_fields(table, after)
            doc["_op_type"] = "index"
            doc["_index"] = index_name
            doc["_id"] = doc_id
            self._buffer.append(doc)

        self._buffer_size += 1

    def _filter_fields(self, table: str, data: dict) -> dict:
        """字段白名单过滤"""
        whitelist = self.FIELD_WHITELIST.get(table, list(data.keys()))
        return {k: v for k, v in data.items() if k in whitelist}

    def _maybe_flush(self):
        """缓冲满后批量提交"""
        if self._buffer_size >= self.MAX_BUFFER:
            self._flush()

    def _flush(self):
        """批量写入ES"""
        if not self._buffer:
            return
        try:
            success, errors = helpers.bulk(self.es, self._buffer)
            if errors:
                for err in errors:
                    logger.warning(f"ES bulk partial failure: {err}")
            self.consumer