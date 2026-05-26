# 服务端分布式唯一ID生成与序号管理服务 - 详细设计

## 1. 概述

### 1.1 设计目标

为 PrimeTop 全平台提供统一、高性能、趋势递增的全局唯一标识生成服务，覆盖所有业务实体（用户、题目、订单、学习记录、错题、对话、报告等），支撑日新增数千万条记录的规模。

### 1.2 核心需求

| 需求 | 说明 |
|------|------|
| 全局唯一 | 分布式环境下，任意节点生成的 ID 不重复 |
| 趋势递增 | ID 整体趋势递增，利于 MySQL InnoDB 聚簇索引写入性能 |
| 高性能 | 单节点 QPS ≥ 50万，P99 延迟 ≤ 1μs（本地模式） |
| 信息安全 | ID 不可逆推业务量、不可枚举、不可推测创建时间 |
| 可读性（可选） | 部分业务场景需要人类可读的序号（订单号、报告编号） |
| 多类型支持 | 支持纯数字主键、带前缀业务序号、短码标识三种形态 |

### 1.3 ID 类型矩阵

| 类型 | 格式示例 | 用途 | 特点 |
|------|----------|------|------|
| 主键ID (Primary Key) | `1234567890123456` (BIGINT) | 所有表主键 | 纯数字、趋势递增、高性能 |
| 业务序号 (Business Code) | `ORD20260526143700001` | 订单号、报告编号 | 带前缀、时间嵌入、人类可读 |
| 短码 (Short Code) | `a7Xk9m` | 分享链接、邀请码 | 短、Base62 编码、不可枚举 |

---

## 2. 整体架构

### 2.1 架构图

```text
┌─────────────────────────────────────────────────────────┐
│                    业务服务层                              │
│  用户服务  题目服务  学习服务  订单服务  报告服务  ...       │
└──────────┬──────────────────────────────────┬────────────┘
           │ 调用                              │ 调用
           ▼                                  ▼
┌─────────────────────┐          ┌──────────────────────────┐
│  PrimaryKeyGenerator│          │  BusinessCodeGenerator   │
│  (Snowflake 改进版)  │          │  (序号生成器)              │
│                     │          │                          │
│  · 本地时钟驱动      │          │  · 前缀+日期+序列          │
│  · WorkerID 自动分配 │          │  · Redis 原子序列          │
│  · 时钟回拨容忍      │          │  · 按业务域隔离            │
└──────────┬──────────┘          └──────────┬───────────────┘
           │                                │
           ▼                                ▼
┌─────────────────────┐          ┌──────────────────────────┐
│  WorkerID 管理器      │          │  Redis 序列池             │
│  (MySQL 持久化)       │          │  · INCR 原子自增          │
│  · 注册/心跳/回收     │          │  · 预取批量分配            │
└─────────────────────┘          │  · 按 date+prefix 分 key  │
                                  └──────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│                   ShortCodeGenerator                      │
│  · Base62 编码                                            │
│  · 唯一性保证 (Bloom Filter + DB 唯一索引)                  │
└──────────────────────────────────────────────────────────┘
```

### 2.2 模块分层

```text
primetop/
└── common/
    └── idgen/
        ├── __init__.py                  # 公共导出
        ├── engine.py                    # ID 生成引擎主入口
        ├── snowflake.py                 # Snowflake 改进算法
        ├── worker_manager.py            # WorkerID 管理
        ├── business_code.py             # 业务序号生成器
        ├── short_code.py                # 短码生成器
        ├── config.py                    # 配置
        ├── exceptions.py                # 异常定义
        └── metrics.py                   # 监控指标
```

---

## 3. 主键ID生成器 — Snowflake 改进算法

### 3.1 ID 结构设计

采用改进型 Snowflake 算法，64 bit 布局如下：

```text
┌─────────────────────────┬──────────┬───────────┬──────────────┐
│     41 bit timestamp     │ 2 bit DC │ 10 bit WID │ 11 bit seq   │
│    (毫秒级，约69年)       │ 数据中心  │  WorkerID  │ 毫秒内序列    │
└─────────────────────────┴──────────┴───────────┴──────────────┘

总长度: 64 bit (BIGINT UNSIGNED)
最大值: 2^64 - 1 = 18446744073709551615
```

| 字段 | 位数 | 范围 | 说明 |
|------|------|------|------|
| timestamp | 41 | 0 ~ 2^41-1 | 自定义纪元起的毫秒数，可用约 69 年 |
| datacenter_id | 2 | 0 ~ 3 | 支持 4 个数据中心/可用区 |
| worker_id | 10 | 0 ~ 1023 | 每个数据中心最多 1024 个 Worker |
| sequence | 11 | 0 ~ 2047 | 单 Worker 单毫秒最多 2048 个 ID |

### 3.2 自定义纪元

```python
# 以 2025-01-01 00:00:00 UTC 为纪元起点
# 可用至 2025 + 69 ≈ 2094 年
PRIMETOP_EPOCH_MS = 1735689600000  # 2025-01-01T00:00:00Z
```

### 3.3 核心实现

```python
# primetop/common/idgen/snowflake.py

import time
import threading
from primetop.common.idgen.exceptions import ClockMovedBackwardError, SequenceOverflowError


class SnowflakeGenerator:
    """
    改进型 Snowflake ID 生成器
    
    特点:
    - 41 bit 时间戳 + 2 bit 数据中心 + 10 bit WorkerID + 11 bit 序列
    - 单 Worker 单毫秒最大 2048 ID (204.8 万/秒)
    - 时钟回拨容忍 5ms，超出则抛异常
    - 线程安全（无锁 CAS）
    """

    __slots__ = (
        '_datacenter_id', '_worker_id',
        '_sequence', '_last_timestamp',
        '_lock',
    )

    # 位移常量
    DATACENTER_ID_SHIFT = 21   # sequence_bits + worker_id_bits = 11 + 10
    WORKER_ID_SHIFT = 11       # sequence_bits = 11
    TIMESTAMP_SHIFT = 23       # sequence_bits + worker_id_bits + datacenter_bits = 11 + 10 + 2

    # 掩码
    SEQUENCE_MASK = (1 << 11) - 1      # 0x7FF,   2047
    WORKER_ID_MASK = (1 << 10) - 1     # 0x3FF,   1023
    DATACENTER_ID_MASK = (1 << 2) - 1  # 0x3,     3

    # 时钟回拨容忍阈值
    CLOCK_BACKWARD_TOLERANCE_MS = 5

    def __init__(self, datacenter_id: int, worker_id: int, epoch_ms: int):
        if datacenter_id < 0 or datacenter_id > self.DATACENTER_ID_MASK:
            raise ValueError(f"datacenter_id 范围: 0~{self.DATACENTER_ID_MASK}")
        if worker_id < 0 or worker_id > self.WORKER_ID_MASK:
            raise ValueError(f"worker_id 范围: 0~{self.WORKER_ID_MASK}")

        self._datacenter_id = datacenter_id
        self._worker_id = worker_id
        self._epoch_ms = epoch_ms
        self._sequence = 0
        self._last_timestamp = -1
        self._lock = threading.Lock()

    def generate(self) -> int:
        """生成一个唯一 ID"""
        with self._lock:
            now = self._current_millis()

            # 时钟回拨检测
            if now < self._last_timestamp:
                diff = self._last_timestamp - now
                if diff <= self.CLOCK_BACKWARD_TOLERANCE_MS:
                    # 等待追回
                    time.sleep(diff / 1000.0)
                    now = self._current_millis()
                else:
                    raise ClockMovedBackwardError(
                        f"时钟回拨 {diff}ms，超出容忍阈值 "
                        f"{self.CLOCK_BACKWARD_TOLERANCE_MS}ms"
                    )

            if now == self._last_timestamp:
                self._sequence = (self._sequence + 1) & self.SEQUENCE_MASK
                if self._sequence == 0:
                    # 序列溢出，等待下一毫秒
                    now = self._wait_next_millis(self._last_timestamp)
            else:
                self._sequence = 0

            self._last_timestamp = now

            return (
                ((now - self._epoch_ms) << self.TIMESTAMP_SHIFT)
                | (self._datacenter_id << self.DATACENTER_ID_SHIFT)
                | (self._worker_id << self.WORKER_ID_SHIFT)
                | self._sequence
            )

    def generate_batch(self, count: int) -> list[int]:
        """批量生成 ID，减少锁竞争"""
        if count <= 0 or count > 2048:
            raise ValueError("batch size 范围: 1~2048")

        ids = []
        with self._lock:
            for _ in range(count):
                now = self._current_millis()

                if now < self._last_timestamp:
                    now = self._wait_next_millis(self._last_timestamp)

                if now == self._last_timestamp:
                    self._sequence = (self._sequence + 1) & self.SEQUENCE_MASK
                    if self._sequence == 0:
                        now = self._wait_next_millis(self._last_timestamp)
                else:
                    self._sequence = 0

                self._last_timestamp = now
                ids.append(
                    ((now - self._epoch_ms) << self.TIMESTAMP_SHIFT)
                    | (self._datacenter_id << self.DATACENTER_ID_SHIFT)
                    | (self._worker_id << self.WORKER_ID_SHIFT)
                    | self._sequence
                )
        return ids

    def _current_millis(self) -> int:
        return int(time.time() * 1000)

    def _wait_next_millis(self, last: int) -> int:
        now = self._current_millis()
        while now <= last:
            time.sleep(0.0001)  # 100μs
            now = self._current_millis()
        return now

    @classmethod
    def extract_timestamp(cls, id_: int, epoch_ms: int) -> int:
        """从 ID 中提取时间戳（毫秒）"""
        return (id_ >> cls.TIMESTAMP_SHIFT) + epoch_ms

    @classmethod
    def extract_datacenter_id(cls, id_: int) -> int:
        """从 ID 中提取数据中心 ID"""
        return (id_ >> cls.DATACENTER_ID_SHIFT) & cls.DATACENTER_ID_MASK

    @classmethod
    def extract_worker_id(cls, id_: int) -> int:
        """从 ID 中提取 Worker ID"""
        return (id_ >> cls.WORKER_ID_SHIFT) & cls.WORKER_ID_MASK

    @classmethod
    def extract_sequence(cls, id_: int) -> int:
        """从 ID 中提取序列号"""
        return id_ & cls.SEQUENCE_MASK
```

### 3.4 性能预算

| 指标 | 目标 | 说明 |
|------|------|------|
| 单线程 QPS | ≥ 204.8 万/秒 | 理论值：2048 × 1000 |
| 实际单线程 QPS | ≥ 100 万/秒 | 考虑锁开销和系统调用 |
| P50 延迟 | ≤ 0.5μs | 本地生成，无网络 |
| P99 延迟 | ≤ 1μs | 本地生成 |
| 时钟回拨容忍 | ≤ 5ms | 自动等待追回 |

---

## 4. WorkerID 管理器

### 4.1 数据模型

```sql
-- WorkerID 注册表
CREATE TABLE idgen_worker_registry (
    worker_id       SMALLINT UNSIGNED NOT NULL COMMENT 'Worker ID (0~1023)',
    datacenter_id   TINYINT UNSIGNED  NOT NULL COMMENT '数据中心 ID (0~3)',
    service_name    VARCHAR(64)       NOT NULL COMMENT '服务名称，如 learning-service',
    instance_id     VARCHAR(128)      NOT NULL COMMENT '实例标识 (pod名/容器ID)',
    ip_address      VARCHAR(45)       NOT NULL COMMENT '实例 IP',
    pid             INT UNSIGNED      NOT NULL COMMENT '进程 PID',
    heartbeat_at    DATETIME(3)       NOT NULL COMMENT '最近心跳时间',
    status          ENUM('ACTIVE', 'EXPIRED', 'DEAD') NOT NULL DEFAULT 'ACTIVE',
    created_at      DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (datacenter_id, worker_id),
    UNIQUE KEY uk_instance (datacenter_id, instance_id),
    INDEX idx_status_heartbeat (status, heartbeat_at),
    INDEX idx_service (service_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ID生成器Worker注册表';
```

### 4.2 WorkerID 分配策略

```python
# primetop/common/idgen/worker_manager.py

import os
import socket
import logging
from datetime import datetime, timedelta
from typing import Optional

import db

logger = logging.getLogger(__name__)


class WorkerManager:
    """
    WorkerID 自动分配与生命周期管理

    策略:
    1. 首次启动：查询可用 slot，选择最小 worker_id 注册
    2. 心跳续约：每 10s 更新 heartbeat_at
    3. 故障检测：超过 30s 无心跳标记 EXPIRED
    4. 死亡回收：超过 5 分钟无心跳标记 DEAD，释放 slot
    5. 优雅关闭：主动注销，立即释放 slot
    """

    HEARTBEAT_INTERVAL_SEC = 10
    EXPIRE_THRESHOLD_SEC = 30
    DEAD_THRESHOLD_SEC = 300   # 5 分钟
    MAX_WORKER_ID = 1023

    def __init__(self, datacenter_id: int, service_name: str):
        self._datacenter_id = datacenter_id
        self._service_name = service_name
        self._instance_id = os.environ.get(
            'HOSTNAME', socket.gethostname()
        )
        self._ip = self._detect_ip()
        self._pid = os.getpid()
        self._worker_id: Optional[int] = None
        self._heartbeat_timer = None

    @property
    def worker_id(self) -> int:
        if self._worker_id is None:
            raise RuntimeError("WorkerID 尚未分配，请先调用 register()")
        return self._worker_id

    async def register(self) -> int:
        """
        注册并获取 WorkerID

        流程:
        1. 检查本实例是否已有注册（重启复用）
        2. 清理过期 slot
        3. 分配最小可用 worker_id
        """
        # 1. 检查已有注册
        existing = await self._find_existing_registration()
        if existing is not None:
            self._worker_id = existing
            await self._renew_heartbeat()
            logger.info(
                f"复用已有 WorkerID: dc={self._datacenter_id} "
                f"worker={self._worker_id}"
            )
            return self._worker_id

        # 2. 清理过期 Worker
        await self._cleanup_expired()

        # 3. 分配新 WorkerID
        self._worker_id = await self._allocate_slot()
        await self._insert_registration()

        logger.info(
            f"分配新 WorkerID: dc={self._datacenter_id} "
            f"worker={self._worker_id} instance={self._instance_id}"
        )
        return self._worker_id

    async def _find_existing_registration(self) -> Optional[int]:
        """查找本实例的已有注册"""
        row = await db.fetch_one("""
            SELECT worker_id FROM idgen_worker_registry
            WHERE datacenter_id = %s
              AND instance_id = %s
              AND status = 'ACTIVE'
        """, (self._datacenter_id, self._instance_id))
        return row['worker_id'] if row else None

    async def _allocate_slot(self) -> int:
        """分配最小可用 WorkerID"""
        rows = await db.fetch_all("""
            SELECT worker_id FROM idgen_worker_registry
            WHERE datacenter_id = %s AND status = 'ACTIVE'
            ORDER BY worker_id
        """, (self._datacenter_id,))

        used = {row['worker_id'] for row in rows}

        for wid in range(self.MAX_WORKER_ID + 1):
            if wid not in used:
                return wid

        raise RuntimeError(
            f"数据中心 {self._datacenter_id} 的 WorkerID 已耗尽"
        )

    async def _insert_registration(self):
        """插入注册记录"""
        await db.execute("""
            INSERT INTO idgen_worker_registry
                (worker_id, datacenter_id, service_name,
                 instance_id, ip_address, pid, heartbeat_at, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'ACTIVE')
        """, (
            self._worker_id, self._datacenter_id, self._service_name,
            self._instance_id, self._ip, self._pid,
            datetime.utcnow(),
        ))

    async def renew_heartbeat(self):
        """外部调用的心跳续约"""
        await self._renew_heartbeat()

    async def _renew_heartbeat(self):
        await db.execute("""
            UPDATE idgen_worker_registry
            SET heartbeat_at = %s, status = 'ACTIVE'
            WHERE datacenter_id = %s AND worker_id = %s
        """, (datetime.utcnow(), self._datacenter_id, self._worker_id))

    async def _cleanup_expired(self):
        """清理过期和死亡的 Worker"""
        now = datetime.utcnow()

        # 标记过期
        await db.execute("""
            UPDATE idgen_worker_registry
            SET status = 'EXPIRED'
            WHERE datacenter_id = %s
              AND status = 'ACTIVE'
              AND heartbeat_at < %s
        """, (self._datacenter_id, now - timedelta(seconds=self.EXPIRE_THRESHOLD_SEC)))

        # 标记死亡（释放 slot）
        await db.execute("""
            UPDATE idgen_worker_registry
            SET status = 'DEAD'
            WHERE datacenter_id = %s
              AND status = 'EXPIRED'
              AND heartbeat_at < %s
        """, (self._datacenter_id, now - timedelta(seconds=self.DEAD_THRESHOLD_SEC)))

    async def deregister(self):
        """优雅关闭，主动释放 WorkerID"""
        if self._worker_id is not None:
            await db.execute("""
                UPDATE idgen_worker_registry
                SET status = 'DEAD'
                WHERE datacenter_id = %s AND worker_id = %s
            """, (self._datacenter_id, self._worker_id))
            logger.info(
                f"注销 WorkerID: dc={self._datacenter_id} "
                f"worker={self._worker_id}"
            )
            self._worker_id = None

    @staticmethod
    def _detect_ip() -> str:
        """检测本机 IP"""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(('8.8.8.8', 80))
                return s.getsockname()[0]
        except Exception:
            return '127.0.0.1'
```

### 4.3 心跳机制

```python
# 心跳启动（在 FastAPI lifespan 中集成）

import asyncio
from contextlib import asynccontextmanager


@asynccontextmanager
async def idgen_lifespan(app):
    """ID 生成器生命周期管理"""
    dc_id = int(os.environ.get('DATACENTER_ID', '0'))
    service = os.environ.get('SERVICE_NAME', 'unknown')

    manager = WorkerManager(dc_id, service)
    worker_id = await manager.register()

    # 初始化全局生成器
    generator = SnowflakeGenerator(
        datacenter_id=dc_id,
        worker_id=worker_id,
        epoch_ms=PRIMETOP_EPOCH_MS,
    )
    idgen_engine.init_primary_generator(generator)

    # 启动心跳
    async def heartbeat_loop():
        while True:
            await asyncio.sleep(WorkerManager.HEARTBEAT_INTERVAL_SEC)
            try:
                await manager.renew_heartbeat()
            except Exception as e:
                logger.error(f"心跳续约失败: {e}")

    task = asyncio.create_task(heartbeat_loop())

    yield  # 应用运行中

    # 关闭
    task.cancel()
    await manager.deregister()
```

---

## 5. 业务序号生成器

### 5.1 设计思路

部分业务场景需要人类可读的序号（订单号、报告编号、工单号等），这类序号需要：
- 包含业务前缀，一眼识别类型
- 嵌入日期，方便排序和追溯
- 严格连续或分段连续，满足审计要求
- 高可用，依赖 Redis 原子操作

### 5.2 序号格式

```text
[前缀][日期][小时][4位流水号]

示例:
  ORD2026052614370001   — 订单号
  RPT2026052608000012   — 学习报告编号
  TK2026052616000099    — 工单号
  INV2026052618000001   — 邀请码批次号

结构:
  前缀     3~4 字母
  日期     YYYYMMDD    8 位
  小时     HH          2 位
  序号     0001~9999    4 位（每小时 9999 个，单日 24 万个）

总长度: 17~18 字符
```

### 5.3 业务前缀注册表

```python
# primetop/common/idgen/business_code.py

from enum import Enum
from datetime import datetime
import redis


class BusinessPrefix(str, Enum):
    """业务前缀注册表"""
    ORDER = "ORD"           # 订单
    REPORT = "RPT"          # 学习报告
    TICKET = "TK"           # 工单
    INVITE = "INV"          # 邀请码批次
    EXPORT = "EXP"          # 数据导出
    REFUND = "REF"          # 退款
    RECEIPT = "REC"         # 收据
    CAMPAIGN = "CMP"        # 活动
    COUPON = "CPN"          # 优惠券
    CERT = "CRT"            # 证书
    EXAM_PAPER = "EXM"      # 试卷
    ERROR_BOOK = "EBK"      # 错题导出


class BusinessCodeGenerator:
    """
    业务序号生成器

    基于 Redis INCR 实现原子自增序列。
    Key 设计: idgen:seq:{prefix}:{YYYYMMDDHH}
    TTL: 48 小时（保留到次日对账）
    """

    # 每小时最大序号
    MAX_SEQ_PER_HOUR = 9999

    def __init__(self, redis_client: redis.Redis):
        self._redis = redis_client

    def generate(self, prefix: BusinessPrefix) -> str:
        """
        生成一个业务序号

        Args:
            prefix: 业务前缀

        Returns:
            如 "ORD2026052614370001"
        """
        now = datetime.utcnow()
        date_str = now.strftime('%Y%m%d')
        hour_str = now.strftime('%H')

        redis_key = f"idgen:seq:{prefix.value}:{date_str}{hour_str}"

        seq = self._redis.incr(redis_key)

        # 首次创建设置 TTL
        if seq == 1:
            self._redis.expire(redis_key, 48 * 3600)

        if seq > self.MAX_SEQ_PER_HOUR:
            raise SequenceOverflowError(
                f"业务序号 [{prefix.value}] 在 {date_str}{hour_str} 时段已耗尽 "
                f"(max={self.MAX_SEQ_PER_HOUR})"
            )

        return f"{prefix.value}{date_str}{hour_str}{seq:04d}"

    def generate_batch(self, prefix: BusinessPrefix, count: int) -> list[str]:
        """
        批量生成连续序号

        用于批量导出、批量生成报告等场景
        """
        if count <= 0 or count > self.MAX_SEQ_PER_HOUR:
            raise ValueError(f"batch size 范围: 1~{self.MAX_SEQ_PER_HOUR}")

        now = datetime.utcnow()
        date_str = now.strftime('%Y%m%d')
        hour_str = now.strftime('%H')

        redis_key = f"idgen:seq:{prefix.value}:{date_str}{hour_str}"

        # INCRBY 原子获取范围
        end_seq = self._redis.incrby(redis_key, count)
        start_seq = end_seq - count + 1

        if end_seq == count:
            self._redis.expire(redis_key, 48 * 3600)

        if end_seq > self.MAX_SEQ_PER_HOUR:
            # 超限回滚
            self._redis.incrby(redis_key, -count)
            raise SequenceOverflowError(
                f"业务序号 [{prefix.value}] 剩余空间不足 "
                f"(请求 {count}，剩余 {self.MAX_SEQ_PER_HOUR - (end_seq - count)})"
            )

        return [
            f"{prefix.value}{date_str}{hour_str}{seq:04d}"
            for seq in range(start_seq, end_seq + 1)
        ]
```

### 5.4 序号容量规划

| 业务 | 前缀 | 估计峰值/小时 | 容量上限 | 充裕度 |
|------|------|-------------|---------|--------|
| 订单 | ORD | 500 | 9,999 | 20× |
| 学习报告 | RPT | 2,000 | 9,999 | 5× |
| 工单 | TK | 100 | 9,999 | 100× |
| 数据导出 | EXP | 50 | 9,999 | 200× |
| 退款 | REF | 200 | 9,999 | 50× |

若单时段 9999 不够，可扩展为 6 位序号（999999/小时），只需修改格式和 `MAX_SEQ_PER_HOUR`。

---

## 6. 短码生成器

### 6.1 设计思路

分享链接和邀请码需要短小精悍的标识符，要求：
- 6~8 字符长度
- Base62 编码（0-9, a-z, A-Z）
- 不可枚举、不可推测
- 全局唯一

### 6.2 实现

```python
# primetop/common/idgen/short_code.py

import hashlib
import os
import time
from collections.abc import Sequence

ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
BASE = len(ALPHABET)  # 62


def base62_encode(num: int) -> str:
    """将整数编码为 Base62 字符串"""
    if num == 0:
        return ALPHABET[0]
    chars = []
    while num > 0:
        num, remainder = divmod(num, BASE)
        chars.append(ALPHABET[remainder])
    return ''.join(reversed(chars))


def base62_decode(s: str) -> int:
    """将 Base62 字符串解码为整数"""
    num = 0
    for ch in s:
        num = num * BASE + ALPHABET.index(ch)
    return num


class ShortCodeGenerator:
    """
    短码生成器

    策略: 基于 Snowflake ID 的 Base62 编码 + 随机混淆

    格式:
    - 标准短码 (6字符): ID % 62^6 的 Base62 编码 + 校验位
    - 长短码 (8字符): 完整 ID 的 Base62 编码
    """

    # 6 字符 Base62 可表示的最大值
    CODE_6_MAX = 62 ** 6   # 56,800,235,584
    # 8 字符 Base62 可表示的最大值
    CODE_8_MAX = 62 ** 8   # 218,340,105,584,896

    # 混淆盐，防止连续 ID 生成连续短码
    OBFUSCATION_SALT = 0x5BD1E995

    def __init__(self, snowflake: 'SnowflakeGenerator'):
        self._snowflake = snowflake
        self._counter = 0

    def generate(self, length: int = 6) -> str:
        """
        生成一个短码

        Args:
            length: 短码长度，6 或 8

        Returns:
            如 "a7Xk9m"
        """
        if length not in (6, 8):
            raise ValueError("短码长度仅支持 6 或 8")

        snowflake_id = self._snowflake.generate()

        if length == 6:
            # 截取 + 混淆
            truncated = snowflake_id % self.CODE_6_MAX
            obfuscated = self._obfuscate(truncated)
            code = base62_encode(obfuscated)
            return code.zfill(6)[-6:]
        else:
            # 完整编码
            code = base62_encode(snowflake_id)
            return code.zfill(8)[-8:]

    def generate_with_check(
        self,
        length: int,
        existence_check_fn,
        max_retries: int = 5,
    ) -> str:
        """
        生成短码并检查唯一性

        Args:
            length: 短码长度
            existence_check_fn: 异步/同步函数，接收短码返回是否已存在
            max_retries: 最大重试次数

        用于分享链接等需要绝对唯一的场景
        """
        for attempt in range(max_retries):
            code = self.generate(length)
            if not existence_check_fn(code):
                return code

        # 极端情况：增加随机性重试
        for attempt in range(max_retries):
            random_id = int.from_bytes(os.urandom(8), 'big')
            if length == 6:
                code = base62_encode(random_id % self.CODE_6_MAX).zfill(6)[-6:]
            else:
                code = base62_encode(random_id % self.CODE_8_MAX).zfill(8)[-8:]

            if not existence_check_fn(code):
                return code

        raise RuntimeError(f"短码生成失败: 重试 {max_retries * 2} 次后仍有冲突")

    @staticmethod
    def _obfuscate(value: int) -> int:
        """简单混淆，使连续输入产生不连续输出"""
        # MurmurHash 风格的位混合
        value ^= value >> 16
        value = (value * ShortCodeGenerator.OBFUSCATION_SALT) & 0xFFFFFFFF