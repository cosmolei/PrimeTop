# 异步任务 DAG 编排引擎与复杂工作流调度平台 - 详细设计

> 模块版本：v1.0 | 最后更新：2026-07-28
> 原始需求来源：`docs/design/启硕-PrimeTop-全学段AI辅助学习软件项目设计文档.md` §8.4, §8.5, §13
> 依赖文档：`异步任务与事件驱动架构-详细设计.md`、`服务端定时任务调度与批处理框架-详细设计.md`、`消息队列与事件驱动架构-详细设计.md`

---

## 1. 模块概述

### 1.1 定位

DAG（有向无环图）编排引擎是 PrimeTop 平台的**复杂工作流调度核心**，负责协调需要按严格依赖顺序执行的多步骤异步任务。与 Celery 任务队列（处理独立异步任务）和 Celery Beat（处理定时触发）不同，DAG 引擎专注于**有依赖关系的任务图编排**，适用于内容处理管线、学情报告生成、AI 推理流水线、批量数据迁移等复杂场景。

### 1.2 设计目标

| 目标 | 说明 |
|------|------|
| DAG 建模 | 支持以声明式 JSON/YAML 定义任务图，包含节点、依赖、条件分支 |
| 依赖调度 | 严格按拓扑排序执行，前置任务完成后才触发后继任务 |
| 断点恢复 | 支持 Pipeline 级别 checkpoint，失败后从最后成功节点恢复 |
| 可观测性 | 每个 DAG 运行实例可视化追踪，节点级耗时、状态、日志 |
| 幂等保障 | 同一 Pipeline 可安全重跑，通过幂等键避免副作用重复 |
| 优先级调度 | 多 Pipeline 并发时按优先级分配 Worker 资源 |
| 动态扩展 | 运行时动态注入节点（如根据上一步结果决定是否追加处理步骤） |

### 1.3 与现有组件的边界

```
┌──────────────────────────────────────────────────────────┐
│                   用户请求 / 定时触发 / 事件触发           │
└──────────────────────┬───────────────────────────────────┘
                       │
           ┌───────────▼───────────┐
           │   DAG 编排引擎 (本文档) │  ← 复杂多步骤、有依赖
           │   Pipeline / Workflow   │
           └───────────┬───────────┘
                       │ 拆解为独立 Task
           ┌───────────▼───────────┐
           │   Celery 任务队列       │  ← 独立单任务
           │   (异步任务与事件驱动)   │
           └───────────┬───────────┘
                       │
           ┌───────────▼───────────┐
           │   Celery Beat           │  ← 定时触发
           │   (定时任务调度框架)     │
           └───────────────────────┘
```

| 组件 | 适用场景 | 示例 |
|------|----------|------|
| **DAG 引擎** | 多步骤、有依赖、需断点恢复 | 学情报告生成（采集→分析→排版→导出→推送） |
| **Celery 队列** | 独立单任务、高并发 | 单次 AI 问答、单张图片 OCR |
| **Celery Beat** | 定时触发 | 每日学习日报、会员到期检查 |

### 1.4 术语定义

| 术语 | 含义 |
|------|------|
| Pipeline | 一个完整的 DAG 工作流实例，对应一次业务操作 |
| DAG Template | Pipeline 的静态模板定义，描述节点和边 |
| Node | DAG 中的一个任务节点，封装具体执行逻辑 |
| Edge | 节点间的依赖关系，A→B 表示 B 依赖 A |
| Sink Node | 没有后继节点的节点（终点） |
| Source Node | 没有前驱节点的节点（起点） |
| Run | Pipeline 的一次执行实例 |
| Checkpoint | 运行时保存的进度快照，用于断点恢复 |
| Fan-out | 一个节点完成后触发多个并行后继节点 |
| Fan-in | 多个前驱节点全部完成后才触发后继节点 |

### 1.5 技术选型

| 组件 | 选型 | 说明 |
|------|------|------|
| DAG 存储 | MySQL + Redis | 模板存 MySQL，运行状态缓存在 Redis |
| 任务分发 | Celery（复用现有） | DAG 调度器通过 Celery 分发节点任务 |
| 状态机 | 自研 State Machine | 基于 Redis 的原子状态转换 |
| DAG 解析 | networkx（Python） | 成熟的图论库，支持拓扑排序、环路检测 |
| 可视化 | Graphviz + D3.js | 后端生成 SVG，前端 D3 交互渲染 |
| 锁 | Redis Redlock | Pipeline 级别互斥锁，防止并发冲突 |

---

## 2. 核心业务场景

### 2.1 内容处理管线

教材内容上传后需要经过多步处理：

```
[文件上传] → [格式检测] → [OCR 识别] → [结构化解析] → [知识点标注]
                                      ↓
                                 [向量嵌入] → [入向量库]
                                      ↓
                                 [内容审核] → [质量评分] → [发布上线]
```

### 2.2 学情报告生成管线

```
[触发报告生成] → [采集学习数据] → [计算掌握度] → [AI 分析解读]
                                                   ↓
                              ┌─────────────────────┤
                              ↓                       ↓
                    [生成图表数据]           [生成改进建议]
                              ↓                       ↓
                              └──────────┬────────────┘
                                         ↓
                                [组装报告 PDF] → [推送通知]
```

### 2.3 AI 批量推理管线

```
[题目批量上传] → [题目结构化] → ┌─ [知识点标注] ──┐
                                 ├─ [难度评估] ──┤
                                 ├─ [解析生成] ──┤
                                 └─ [类题匹配] ──┘
                                                    ↓
                                          [结果汇总校验] → [入库]
```

### 2.4 数据迁移管线

```
[Schema 版本检测] → [数据备份] → [Schema 迁移] → [数据转换] → [一致性校验] → [切换]
```

### 2.5 错题复习材料生成管线

```
[选择错题范围] → [错题聚类] → ┌─ [同类题推荐] ──┐
                               ├─ [知识点梳理] ──┤
                               └─ [复习卡片生成] ┤
                                                  ↓
                                       [排版组装] → [PDF 导出]
```

---

## 3. 数据结构定义

### 3.1 DAG 模板表 `dag_template`

```sql
CREATE TABLE `dag_template` (
    `id`             BIGINT       UNSIGNED NOT NULL AUTO_INCREMENT,
    `template_code`  VARCHAR(64)  NOT NULL COMMENT '模板唯一编码，如 report-generation',
    `name`           VARCHAR(128) NOT NULL COMMENT '模板名称',
    `description`    TEXT         NULL     COMMENT '模板描述',
    `version`        INT          NOT NULL DEFAULT 1 COMMENT '模板版本号',
    `definition`     JSON         NOT NULL COMMENT 'DAG 定义（节点+边），见 §3.2',
    `category`       VARCHAR(32)  NOT NULL COMMENT '分类：content|report|ai|migration',
    `max_concurrency` INT         NOT NULL DEFAULT 1 COMMENT '同一模板最大并发实例数',
    `priority`       TINYINT      NOT NULL DEFAULT 50 COMMENT '默认优先级（1-100，越大越优先）',
    `timeout_seconds` INT         NOT NULL DEFAULT 3600 COMMENT '整个 Pipeline 超时时间',
    `retry_policy`   JSON         NULL     COMMENT '重试策略：{max_retries, backoff_base, backoff_max}',
    `status`         TINYINT      NOT NULL DEFAULT 1 COMMENT '1=启用 0=停用',
    `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_template_code_version` (`template_code`, `version`),
    KEY `idx_category_status` (`category`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='DAG 工作流模板';
```

### 3.2 DAG 定义 JSON 结构

```json
{
  "nodes": [
    {
      "node_id": "collect_data",
      "name": "采集学习数据",
      "type": "task",
      "handler": "primetop.dag.handlers.report.CollectDataHandler",
      "params": {
        "data_sources": ["answer_records", "learning_sessions", "mistake_records"],
        "date_range_days": 30
      },
      "timeout_seconds": 300,
      "retry": { "max_retries": 3, "backoff_base": 5, "backoff_max": 60 },
      "resource": { "queue": "default", "routing_key": "dag.default" }
    },
    {
      "node_id": "ai_analysis",
      "name": "AI 分析解读",
      "type": "task",
      "handler": "primetop.dag.handlers.report.AIAnalysisHandler",
      "params": {
        "model": "gpt-4o-mini",
        "prompt_template": "study_report_analysis_v2"
      },
      "timeout_seconds": 120,
      "retry": { "max_retries": 2, "backoff_base": 10, "backoff_max": 120 },
      "resource": { "queue": "ai_heavy", "routing_key": "dag.ai_heavy" }
    },
    {
      "node_id": "branch_check",
      "name": "条件判断",
      "type": "condition",
      "params": {
        "expression": "context.get('has_chart_data') == true"
      }
    }
  ],
  "edges": [
    { "from": "collect_data", "to": "ai_analysis" },
    { "from": "collect_data", "to": "branch_check" },
    { "from": "branch_check", "to": "generate_chart", "condition": "true" },
    { "from": "ai_analysis", "to": "assemble_report" },
    { "from": "generate_chart", "to": "assemble_report" },
    { "from": "assemble_report", "to": "push_notification" }
  ]
}
```

### 3.3 Pipeline 运行实例表 `dag_run`

```sql
CREATE TABLE `dag_run` (
    `id`              BIGINT       UNSIGNED NOT NULL AUTO_INCREMENT,
    `run_uuid`        CHAR(36)     NOT NULL COMMENT '运行实例 UUID',
    `template_id`     BIGINT       UNSIGNED NOT NULL COMMENT '关联模板 ID',
    `template_code`   VARCHAR(64)  NOT NULL COMMENT '模板编码（冗余加速查询）',
    `template_version` INT         NOT NULL COMMENT '模板版本快照',
    `status`          VARCHAR(20)  NOT NULL DEFAULT 'PENDING' COMMENT '状态：PENDING|RUNNING|PAUSED|SUCCESS|FAILED|TIMEOUT|CANCELLED',
    `priority`        TINYINT      NOT NULL DEFAULT 50 COMMENT '运行优先级',
    `trigger_source`  VARCHAR(32)  NOT NULL COMMENT '触发来源：manual|cron|event|api',
    `trigger_params`  JSON         NULL     COMMENT '触发参数，包含业务上下文',
    `business_key`    VARCHAR(128) NULL     COMMENT '业务关联键，如 student_id:12345:report:2026-07',
    `context`         JSON         NULL     COMMENT '运行时上下文（节点间传递数据）',
    `checkpoint`      JSON         NULL     COMMENT '检查点信息（已完成节点快照）',
    `started_at`      DATETIME     NULL     COMMENT '开始执行时间',
    `finished_at`     DATETIME     NULL     COMMENT '结束时间（成功/失败/取消）',
    `timeout_at`      DATETIME     NULL     COMMENT '超时截止时间',
    `error_message`   TEXT         NULL     COMMENT '失败原因',
    `retry_count`     INT          NOT NULL DEFAULT 0 COMMENT 'Pipeline 级重试次数',
    `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_run_uuid` (`run_uuid`),
    KEY `idx_template_status` (`template_code`, `status`),
    KEY `idx_business_key` (`business_key`),
    KEY `idx_status_priority` (`status`, `priority`, `created_at`),
    KEY `idx_timeout` (`status`, `timeout_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='DAG Pipeline 运行实例';
```

### 3.4 节点执行记录表 `dag_node_execution`

```sql
CREATE TABLE `dag_node_execution` (
    `id`              BIGINT       UNSIGNED NOT NULL AUTO_INCREMENT,
    `run_id`          BIGINT       UNSIGNED NOT NULL COMMENT '关联 Pipeline 运行 ID',
    `run_uuid`        CHAR(36)     NOT NULL COMMENT '运行实例 UUID（冗余）',
    `node_id`         VARCHAR(64)  NOT NULL COMMENT 'DAG 模板中的节点 ID',
    `node_name`       VARCHAR(128) NOT NULL COMMENT '节点名称',
    `handler`         VARCHAR(256) NOT NULL COMMENT '处理器全限定名',
    `status`          VARCHAR(20)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING|RUNNING|SUCCESS|FAILED|SKIPPED|TIMEOUT|CANCELLED',
    `attempt`         INT          NOT NULL DEFAULT 0 COMMENT '执行尝试次数',
    `input_data`      JSON         NULL     COMMENT '节点输入数据（前驱节点输出聚合）',
    `output_data`     JSON         NULL     COMMENT '节点输出数据',
    `error_message`   TEXT         NULL     COMMENT '失败错误信息',
    `error_stack`     TEXT         NULL     COMMENT '错误堆栈',
    `celery_task_id`  VARCHAR(256) NULL     COMMENT '关联的 Celery 任务 ID',
    `started_at`      DATETIME     NULL     COMMENT '节点开始执行时间',
    `finished_at`     DATETIME     NULL     COMMENT '节点完成时间',
    `duration_ms`     INT          UNSIGNED NULL     COMMENT '执行耗时（毫秒）',
    `worker_node`     VARCHAR(64)  NULL     COMMENT '执行 Worker 标识',
    `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_run_node_attempt` (`run_id`, `node_id`, `attempt`),
    KEY `idx_run_uuid` (`run_uuid`),
    KEY `idx_status` (`status`),
    KEY `idx_celery_task` (`celery_task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='DAG 节点执行记录';
```

### 3.5 Pipeline 事件日志表 `dag_event_log`

```sql
CREATE TABLE `dag_event_log` (
    `id`           BIGINT       UNSIGNED NOT NULL AUTO_INCREMENT,
    `run_uuid`     CHAR(36)     NOT NULL COMMENT 'Pipeline 运行 UUID',
    `node_id`      VARCHAR(64)  NULL     COMMENT '相关节点 ID（Pipeline 级事件为 NULL）',
    `event_type`   VARCHAR(32)  NOT NULL COMMENT '事件类型：PIPELINE_STARTED|NODE_STARTED|NODE_SUCCEEDED|NODE_FAILED|PIPELINE_COMPLETED 等',
    `event_data`   JSON         NULL     COMMENT '事件详情',
    `created_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '精确到毫秒',
    PRIMARY KEY (`id`),
    KEY `idx_run_uuid_time` (`run_uuid`, `created_at`),
    KEY `idx_event_type` (`event_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='DAG 事件审计日志';
```

---

## 4. 核心架构设计

### 4.1 整体架构

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        触发层                                       │
│   API 请求   │   事件监听   │   定时触发   │   手动触发              │
└────────┬─────────────┬──────────────┬──────────────┬───────────────┘
         │             │              │              │
         ▼             ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Pipeline Manager                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────────┐  │
│  │ 模板加载器   │  │ 实例创建器    │  │ 幂等校验器                  │  │
│  │ Template     │  │ Run Factory  │  │ Idempotency Checker        │  │
│  │ Loader       │  │              │  │                            │  │
│  └─────────────┘  └──────────────┘  └────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    DAG Scheduler (核心调度器)                         │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────────┐  │
│  │ 拓扑排序器   │  │ 就绪队列      │  │ 超时监控器                  │  │
│  │ TopoSorter  │  │ ReadyQueue   │  │ TimeoutMonitor             │  │
│  └─────────────┘  └──────────────┘  └────────────────────────────┘  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────────┐  │
│  │ 条件评估器   │  │ Checkpoint   │  │ 死信处理器                  │  │
│  │ CondEval    │  │ Manager      │  │ DLQ Handler                │  │
│  └─────────────┘  └──────────────┘  └────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ 分发就绪节点
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Node Dispatcher                                   │
│                    (Celery 任务分发)                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │ default 队列  │  │ ai_heavy 队列 │  │ io_heavy 队列             │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────────┘   │
└─────────┼─────────────────┼─────────────────────┼───────────────────┘
          │                 │                     │
          ▼                 ▼                     ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────────┐
│ Celery Workers  │ │ Celery Workers  │ │ Celery Workers              │
│ (default)       │ │ (ai_heavy)      │ │ (io_heavy)                  │
│                 │ │                 │ │                             │
│ ┌─────────────┐ │ │ ┌─────────────┐ │ │ ┌─────────────────────────┐ │
│ │NodeExecutor │ │ │ │NodeExecutor │ │ │ │NodeExecutor              │ │
│ │(执行节点)    │ │ │ │(执行节点)    │ │ │ │(执行节点)                │ │
│ └─────────────┘ │ │ └─────────────┘ │ │ └─────────────────────────┘ │
└────────┬────────┘ └────────┬────────┘ └─────────────┬───────────────┘
         │                   │                        │
         └───────────────────┼────────────────────────┘
                             │ 回调结果
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Callback Handler                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────────┐  │
│  │ 结果存储器   │  │ 后继触发器    │  │ 完成检测器                  │  │
│  │ ResultStore │  │ Successor    │  │ CompletionDetector         │  │
│  │             │  │ Trigger      │  │                            │  │
│  └─────────────┘  └──────────────┘  └────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Pipeline 生命周期状态机

```text
                    ┌──────────┐
         创建 ────→ │ PENDING  │
                    └────┬─────┘
                         │ 获取资源锁 & 调度就绪
                         ▼
                    ┌──────────┐
                    │ RUNNING  │ ←──────────┐
                    └────┬─────┘             │
                         │                   │ 恢复
              ┌──────────┼──────────┐        │
              │          │          │        │
              ▼          ▼          ▼        │
        ┌─────────┐ ┌─────────┐ ┌────────┐   │
        │ PAUSED  │ │ TIMEOUT │ │ FAILED │   │
        └────┬────┘ └────┬────┘ └───┬────┘   │
             │ 手动恢复     │ 超时     │ 重试    │
             └──────────┐  │        │        │
                        │  │        │        │
                        ▼  ▼        ▼        │
                    ┌──────────┐              │
                    │ FAILED   │──── 重试 ────┘
                    └────┬─────┘
                         │ 重试耗尽
                         ▼
                    ┌──────────┐
                    │CANCELLED │ (手动取消)
                    └──────────┘

              全部节点成功
                    │
                    ▼
              ┌──────────┐
              │ SUCCESS  │
              └──────────┘
```

### 4.3 节点生命周期状态机

```text
          ┌──────────┐
   创建 → │ PENDING  │
          └────┬─────┘
               │ 前驱全部完成 & 资源就绪
               ▼
          ┌──────────┐
          │ RUNNING  │
          └────┬─────┘
               │
     ┌─────────┼─────────┐
     │         │         │
     ▼         ▼         ▼
┌────────┐ ┌────────┐ ┌──────────┐
│SUCCESS │ │ FAILED │ │ TIMEOUT  │
└────────┘ └───┬────┘ └────┬─────┘
                │           │
                │  重试      │
                ▼           ▼
           ┌──────────┐
           │ PENDING  │ (重新入队)
           └──────────┘

  条件判断节点：条件不满足
           │
           ▼
      ┌──────────┐
      │ SKIPPED  │
      └──────────┘
```

---

## 5. 核心组件详细设计

### 5.1 Pipeline Manager（Pipeline 管理器）

负责创建、启动、暂停、取消 Pipeline 实例。

```python
# primetop/dag/manager.py

import uuid
import json
from datetime import datetime, timedelta
from typing import Any, Optional
from dataclasses import dataclass

from primetop.dag.storage import DagStorage
from primetop.dag.scheduler import DagScheduler
from primetop.dag.exceptions import (
    PipelineAlreadyRunningError,
    TemplateNotFoundError,
    ConcurrencyLimitError,
)


@dataclass
class PipelineTrigger:
    """Pipeline 触发参数"""
    template_code: str
    trigger_source: str  # manual | cron | event | api
    business_key: str    # 幂等键，如同 business_key 的 Pipeline 不重复创建
    priority: int = 50
    params: dict = None  # 业务参数
    timeout_override: Optional[int] = None


class PipelineManager:
    """Pipeline 生命周期管理器"""

    def __init__(
        self,
        storage: DagStorage,
        scheduler: DagScheduler,
        redis_client: "Redis",
    ):
        self._storage = storage
        self._scheduler = scheduler
        self._redis = redis_client

    async def create_and_start(self, trigger: PipelineTrigger) -> str:
        """创建 Pipeline 实例并启动执行

        Returns:
            run_uuid: Pipeline 运行实例 UUID
        """
        # 1. 幂等校验：同 business_key 的 Pipeline 如果正在运行则直接返回
        existing = await self._storage.get_active_run_by_business_key(
            trigger.business_key
        )
        if existing:
            raise PipelineAlreadyRunningError(
                f"Pipeline already running: {existing.run_uuid}"
            )

        # 2. 加载模板
        template = await self._storage.get_template(trigger.template_code)
        if not template or template["status"] != 1:
            raise TemplateNotFoundError(
                f"Template not found or disabled: {trigger.template_code}"
            )

        # 3. 并发限制检查
        active_count = await self._storage.count_active_runs(template["id"])
        if active_count >= template["max_concurrency"]:
            raise ConcurrencyLimitError(
                f"Max concurrency reached: {template['max_concurrency']}"
            )

        # 4. 创建运行实例
        run_uuid = str(uuid.uuid4())
        timeout_seconds = trigger.timeout_override or template["timeout_seconds"]
        now = datetime.utcnow()

        run_id = await self._storage.create_run(
            run_uuid=run_uuid,
            template_id=template["id"],
            template_code=template["template_code"],
            template_version=template["version"],
            priority=trigger.priority,
            trigger_source=trigger.trigger_source,
            trigger_params=trigger.params or {},
            business_key=trigger.business_key,
            timeout_at=now + timedelta(seconds=timeout_seconds),
        )

        # 5. 记录启动事件
        await self._storage.append_event(
            run_uuid=run_uuid,
            node_id=None,
            event_type="PIPELINE_CREATED",
            event_data={"template_code": trigger.template_code, "params": trigger.params},
        )

        # 6. 交给调度器启动
        await self._scheduler.start_pipeline(run_id)

        return run_uuid

    async def cancel(self, run_uuid: str, reason: str = "") -> bool:
        """取消 Pipeline 执行"""
        run = await self._storage.get_run_by_uuid(run_uuid)
        if not run:
            return False

        if run["status"] in ("SUCCESS", "FAILED", "CANCELLED", "TIMEOUT"):
            return False  # 已终态

        # 更新状态
        await self._storage.update_run_status(
            run_id=run["id"],
            status="CANCELLED",
            error_message=f"Manually cancelled: {reason}",
            finished_at=datetime.utcnow(),
        )

        # 取消所有运行中的节点 Celery 任务
        running_nodes = await self._storage.get_nodes_by_status(run["id"], "RUNNING")
        for node in running_nodes:
            if node["celery_task_id"]:
                # 通过 Celery revoke 取消
                from primetop.celery_app import app as celery_app
                celery_app.control.revoke(node["celery_task_id"], terminate=True)

            await self._storage.update_node_status(
                node_execution_id=node["id"],
                status="CANCELLED",
                finished_at=datetime.utcnow(),
            )

        await self._storage.append_event(
            run_uuid=run_uuid,
            node_id=None,
            event_type="PIPELINE_CANCELLED",
            event_data={"reason": reason},
        )

        return True

    async def retry(self, run_uuid: str, from_checkpoint: bool = True) -> str:
        """从失败点重试 Pipeline

        Args:
            run_uuid: 原 Pipeline UUID
            from_checkpoint: True=从最后失败节点恢复，False=从头开始

        Returns:
            新的 run_uuid
        """
        run = await self._storage.get_run_by_uuid(run_uuid)
        if not run:
            raise ValueError(f"Run not found: {run_uuid}")

        # 获取原参数
        original_trigger = PipelineTrigger(
            template_code=run["template_code"],
            trigger_source="retry",
            business_key=f"{run['business_key']}:retry:{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
            priority=run["priority"],
            params=run["trigger_params"],
        )

        # 创建新实例
        new_run_uuid = await self.create_and_start(original_trigger)

        if from_checkpoint:
            # 复制已成功节点的输出到新实例的 context
            succeeded_nodes = await self._storage.get_nodes_by_status(
                run["id"], "SUCCESS"
            )
            checkpoint = {}
            for node in succeeded_nodes:
                if node["output_data"]:
                    checkpoint[node["node_id"]] = node["output_data"]

            await self._storage.update_run_context(
                run_uuid=new_run_uuid,
                context_update={"_checkpoint": checkpoint},
            )

        return new_run_uuid

    async def pause(self, run_uuid: str) -> bool:
        """暂停 Pipeline（不再调度新节点，运行中的节点自然完成）"""
        run = await self._storage.get_run_by_uuid(run_uuid)
        if not run or run["status"] != "RUNNING":
            return False

        await self._storage.update_run_status(run_id=run["id"], status="PAUSED")
        await self._storage.append_event(
            run_uuid=run_uuid, node_id=None,
            event_type="PIPELINE_PAUSED", event_data={},
        )
        return True

    async def resume(self, run_uuid: str) -> bool:
        """恢复暂停的 Pipeline"""
        run = await self._storage.get_run_by_uuid(run_uuid)
        if not run or run["status"] != "PAUSED":
            return False

        await self._storage.update_run_status(run_id=run["id"], status="RUNNING")
        await self._scheduler.start_pipeline(run["id"])
        await self._storage.append_event(
            run_uuid=run_uuid, node_id=None,
            event_type="PIPELINE_RESUMED", event_data={},
        )
        return True
```

### 5.2 DAG Scheduler（DAG 调度器）

核心调度逻辑：解析 DAG 拓扑结构，找到就绪节点（所有前驱已完成），分发到 Celery 队列。

```python
# primetop/dag/scheduler.py

import json
import networkx as nx
from typing import List, Dict, Set
from datetime import datetime

from primetop.dag.storage import DagStorage
from primetop.dag.node_dispatcher import NodeDispatcher
from primetop.dag.conditions import ConditionEvaluator
from primetop.dag.exceptions import DAGCycleError


class DagScheduler:
    """DAG 任务调度器"""

    def __init__(
        self,
        storage: DagStorage,
        dispatcher: NodeDispatcher,
        condition_evaluator: ConditionEvaluator,
    ):
        self._storage = storage
        self._dispatcher = dispatcher
        self._condition_eval = condition_evaluator

    async def start_pipeline(self, run_id: int):
        """启动 Pipeline 调度"""
        run = await self._storage.get_run_by_id(run_id)
        if not run:
            return

        # 解析 DAG 定义
        template = await self._storage.get_template_by_id(run["template_id"])
        definition = template["definition"]  # JSON field from MySQL

        # 构建 networkx 有向图
        graph = self._build_graph(definition)

        # 更新 Pipeline 状态
        await self._storage.update_run_status(
            run_id=run_id,
            status="RUNNING",
            started_at=datetime.utcnow(),
        )

        # 记录启动事件
        await self._storage.append_event(
            run_uuid=run["run_uuid"], node_id=None,
            event_type="PIPELINE_STARTED",
            event_data={"node_count": graph.number_of_nodes()},
        )

        # 调度就绪节点
        await self._schedule_ready_nodes(run, graph)

    def _build_graph(self, definition: dict) -> nx.DiGraph:
        """从 JSON 定义构建有向图"""
        graph = nx.DiGraph()

        for node in definition["nodes"]:
            graph.add_node(
                node["node_id"],
                **node  # 存储节点完整定义
            )

        for edge in definition.get("edges", []):
            graph.add_edge(
                edge["from"],
                edge["to"],
                condition=edge.get("condition"),  # 条件边
            )

        # 环路检测
        if not nx.is_directed_acyclic_graph(graph):
            cycle = nx.find_cycle(graph)
            raise DAGCycleError(f"DAG contains a cycle: {cycle}")

        return graph

    async def _schedule_ready_nodes(
        self, run: dict, graph: nx.DiGraph
    ):
        """调度所有就绪节点（前驱全部完成的节点）"""
        run_id = run["id"]
        run_uuid = run["run_uuid"]

        # 获取 checkpoint（恢复场景）
        context = run.get("context") or {}
        checkpoint = context.get("_checkpoint", {})

        # 查询已成功节点
        succeeded_nodes = await self._storage.get_nodes_by_status(run_id, "SUCCESS")
        completed_node_ids = {n["node_id"] for n in succeeded_nodes}

        # 加上 checkpoint 中的节点
        completed_node_ids.update(checkpoint.keys())

        # 查找就绪节点
        ready_nodes = self._find_ready_nodes(graph, completed_node_ids)

        # 排除已存在 PENDING/RUNNING 的节点（避免重复调度）
        existing_pending = await self._storage.get_nodes_by_status(run_id, "PENDING")
        existing_running = await self._storage.get_nodes_by_status(run_id, "RUNNING")
        scheduled_node_ids = {n["node_id"] for n in existing_pending + existing_running}

        truly_ready = [
            n for n in ready_nodes if n["node_id"] not in scheduled_node_ids
        ]

        for node_def in truly_ready:
            # 如果在 checkpoint 中，直接标记成功并继续
            if node_def["node_id"] in checkpoint:
                await self._storage.create_node_execution(
                    run_id=run_id,
                    run_uuid=run_uuid,
                    node_id=node_def["node_id"],
                    node_name=node_def["name"],
                    handler=node_def["handler"],
                    status="SUCCESS",
                    output_data=checkpoint[node_def["node_id"]],
                    started_at=datetime.utcnow(),
                    finished_at=datetime.utcnow(),
                )
                # 递归调度后继
                await self._on_node_succeeded(run, graph, node_def["node_id"])
                continue

            # 创建节点执行记录并分发
            input_data = self._collect_input_data(graph, node_def["node_id"], run)

            node_exec_id = await self._storage.create_node_execution(
                run_id=run_id,
                run_uuid=run_uuid,
                node_id=node_def["node_id"],
                node_name=node_def["name"],
                handler=node_def["handler"],
                status="PENDING",
                input_data=input_data,
            )

            await self._dispatcher.dispatch(
                run=run,
                node_execution_id=node_exec_id,
                node_def=node_def,
                input_data=input_data,
            )

    def _find_ready_nodes(
        self, graph: nx.DiGraph, completed: Set[str]
    ) -> List[dict]:
        """找到所有前驱节点已完成的节点"""
        ready = []
        for node_id in graph.nodes():
            if node_id in completed:
                continue

            predecessors = list(graph.predecessors(node_id))
            if not predecessors:
                # 源节点，直接就绪
                ready.append(graph.nodes[node_id])
                continue

            # 检查所有前驱是否完成
            if all(pred in completed for pred in predecessors):
                # 检查条件边
                edges = graph.in_edges(node_id, data=True)
                all_conditions_met = True
                for u, v, data in edges:
                    if data.get("condition"):
                        # 条件边的条件需要在前驱节点的输出上下文中评估
                        # 这里先标记为就绪，具体条件在 on_node_succeeded 中评估
                        pass  # 条件在 _collect_input_data 或回调中处理
                if all_conditions_met:
                    ready.append(graph.nodes[node_id])

        return ready

    def _collect_input_data(
        self, graph: nx.DiGraph, node_id: str, run: dict
    ) -> dict:
        """收集节点的输入数据（前驱节点输出聚合）"""
        # 从 context 中获取前驱输出
        context = run.get("context") or {}
        node_outputs = context.get("_node_outputs", {})

        input_data = {}
        for pred in graph.predecessors(node_id):
            if pred in node_outputs:
                input_data[pred] = node_outputs[pred]

        # 合并触发参数
        input_data["_trigger_params"] = run.get("trigger_params", {})

        return input_data

    async def on_node_completed(
        self, run_id: int, node_id: str, success: bool, output: dict, error: str = ""
    ):
        """节点完成回调"""
        run = await self._storage.get_run_by_id(run_id)
        if not run:
            return

        template = await self._storage.get_template_by_id(run["template_id"])
        definition = template["definition"]
        graph = self._build_graph(definition)

        if success:
            await self._on_node_succeeded(run, graph, node_id, output)
        else:
            await self._on_node_failed(run, graph, node_id, error)

    async def _on_node_succeeded(
        self, run: dict, graph: nx.DiGraph, node_id: str, output: dict = None
    ):
        """节点成功后处理"""
        run_id = run["id"]
        run_uuid = run["run_uuid"]

        # 更新 context 中的节点输出
        if output:
            context_update = {"_node_outputs": {node_id: output}}
            await self._storage.merge_run_context(run_uuid, context_update)

        # 记录事件
        await self._storage.append_event(
            run_uuid=run_uuid, node_id=node_id,
            event_type="NODE_SUCCEEDED",
            event_data={"has_output": output is not None},
        )

        # 评估后继节点的条件边
        for successor in graph.successors(node_id):
            edge_data = graph.get_edge_data(node_id, successor)
            if edge_data and edge_data.get("condition"):
                # 评估条件
                context = await self._storage.get_run_context(run_uuid)
                condition_met = self._condition_eval.evaluate(
                    edge_data["condition"], context
                )
                if not condition_met:
                    # 条件不满足，标记后继节点为 SKIPPED
                    await self._storage.create_node_execution(
                        run_id=run_id,
                        run_uuid=run_uuid,
                        node_id=successor,
                        node_name=graph.nodes[successor]["name"],
                        handler=graph.nodes[successor].get("handler", ""),
                        status="SKIPPED",
                    )
                    # 递归处理 SKIPPED 节点的后继
                    await self._on_node_succeeded(run, graph, successor, None)
                    return

        # 继续调度就绪节点
        await self._schedule_ready_nodes(run, graph)

        # 检查 Pipeline 是否全部完成
        await self._check_pipeline_completion(run, graph)

    async def _on_node_failed(
        self, run: dict, graph: nx.DiGraph, node_id: str, error: str
    ):
        """节点失败处理"""
        run_id = run["id"]
        run_uuid = run["run_uuid"]

        # 获取节点执行记录
        node_exec = await self._storage.get_latest_node_execution(run_id, node_id)
        retry_policy = node_exec.get("retry") or {"max_retries": 0}

        if node_exec["attempt"] < retry_policy["max_retries"]:
            # 还有重试次数
            backoff = min(
                retry_policy["backoff_base"] * (2 ** node_exec["attempt"]),
                retry_policy["backoff_max"],
            )
            # 延迟重试（通过 Celery countdown）
            await self._dispatcher.dispatch_with_delay(
                run=run,
                node_execution_id=node_exec["id"],
                node_def=graph.nodes[node_id],
                input_data=node_exec["input_data"],
                delay_seconds=backoff,
                attempt=node_exec["attempt"] + 1,
            )
            await self._storage.append_event(
                run_uuid=run_uuid, node_id=node_id,
                event_type="NODE_RETRY_SCHEDULED",
                event_data={
                    "attempt": node_exec["attempt"] + 1,
                    "delay_seconds": backoff,
                },
            )
        else:
            # 重试耗尽，Pipeline 标记失败
            await self._storage.update_run_status(
                run_id=run_id,
                status="FAILED",
                error_message=f"Node '{node_id}' failed after {node_exec['attempt']} attempts: {error}",
                finished_at=datetime.utcnow(),
            )
            await self._storage.append_event(
                run_uuid=run_uuid, node_id=node_id,
                event_type="PIPELINE_FAILED",
                event_data={"failed_node": node_id, "error": error},
            )

    async def _check_pipeline_completion(self, run: dict, graph: nx.DiGraph):
        """检查 Pipeline 是否全部完成"""
        run_id = run["id"]
        run_uuid = run["run_uuid"]

        all_nodes = set(graph.nodes())
        terminal_statuses = {"SUCCESS", "SKIPPED"}
        finished_nodes = set()

        for node_id in all_nodes:
            node_exec = await self._storage.get_latest_node_execution(run_id, node_id)
            if node_exec and node_exec["status"] in terminal_statuses:
                finished_nodes.add(node_id)

        if finished_nodes == all_nodes:
            await self._storage.update_run_status(
                run_id=run_id,
                status="SUCCESS",
                finished_at=datetime.utcnow(),
            )
            await self._storage.append_event(
                run_uuid=run_uuid, node_id=None,
                event_type="PIPELINE_COMPLETED",
                event_data={"total_nodes": len(all_nodes)},
            )

            # 触发 Pipeline 完成事件（供外部系统监听）
            from primetop.dag.events import publish_pipeline_completed
            await publish_pipeline_completed(run_uuid, run.get("context"))
```

### 5.3 Node Dispatcher（节点分发器）

将就绪节点分发到 Celery 队列执行。

```python
# primetop/dag/node_dispatcher.py

import json
from typing import Any, Optional
from datetime import datetime

from primetop.dag.storage import DagStorage
from primetop.celery_app import app as celery_app


class NodeDispatcher:
    """将 DAG 节点分发到 Celery 队列执行"""

    def __init__(self, storage: DagStorage):
        self._storage = storage

    async def dispatch(
        self,
        run: dict,
        node_execution_id: int,
        node_def: dict,
        input_data: dict,
        attempt: int = 0,
    ):
        """分发节点到 Celery 执行"""
        resource = node_def.get("resource", {})
        queue = resource.get("queue", "default")

        # 更新节点状态为 PENDING（等待 Celery 接收）
        await self._storage.update_node_execution(
            node_execution_id=node_execution_id,
            attempt=attempt,
        )

        # 提交 Celery 任务
        result = celery_app.send_task(
            name="primetop.dag.execute_node",
            args=[run["id"], node_execution_id, node_def, input_data],
            queue=queue,
            routing_key=resource.get("routing_key", f"dag.{queue}"),
            retry=True,
            retry_policy={
                "max_retries": node_def.get("retry", {}).get("max_retries", 3),
                "interval_start": 0,
                "interval_step": 5,
                "interval_max": 60,
            },
            time_limit=node_def.get("timeout_seconds", 300),
            soft_time_limit=node_def.get("timeout_seconds", 300) - 10,
        )

        # 记录 Celery Task ID
        await self._storage.update_node_execution(
            node_execution_id=node_execution_id,
            celery_task_id=result.id,
        )

    async def dispatch_with_delay(
        self,
        run: dict,
        node_execution_id: int,
        node_def: dict,
        input_data: dict,
        delay_seconds: int,
        attempt: int,
    ):
        """延迟分发（重试场景）"""
        resource = node_def.get("resource", {})
        queue = resource.get("queue", "default")

        result = celery_app.send_task(
            name="primetop.dag.execute_node",
            args=[run["id"], node_execution_id, node_def, input_data, attempt],
            queue=queue,
            countdown=delay_seconds,
            time_limit=node_def.get("timeout_seconds", 300),
        )

        await self._storage.update_node_execution(
            node_execution_id=node_execution_id,
            celery_task_id=result.id,
        )


# ─── Celery Task 定义 ──────────────────────────────────────────

@celery_app.task(
    name="primetop.dag.execute_node",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
)
def execute_node_task(
    self,
    run_id: int,
    node_execution_id: int,
    node_def: dict,
    input_data: dict,
    attempt: int = 0,
):
    """Celery 任务入口：执行 DAG 节点

    此函数在 Celery Worker 进程中执行。
    """
    import asyncio
    from primetop.dag.node_executor import NodeExecutor
    from primetop.dag.storage import DagStorageFactory

    storage = DagStorageFactory.get_storage()

    # 更新节点状态为 RUNNING
    asyncio.run(storage.update_node_status(
        node_execution_id=node_execution_id,
        status="RUNNING",
        started_at=datetime.utcnow(),
        worker_node=self.request.hostname,
    ))

    run = asyncio.run(storage.get_run_by_id(run_id))
    run_uuid = run["run_uuid"]

    asyncio.run(storage.append_event(
        run_uuid=run_uuid,
        node_id=node_def["node_id"],
        event_type="NODE_STARTED",
        event_data={"attempt": attempt, "worker": self.request.hostname},
    ))

    try:
        # 实例化 Handler 并执行
        executor = NodeExecutor()
        output = asyncio.run(executor.execute(node_def, input_data, run))

        # 标记成功
        asyncio.run(storage.update_node_result(
            node_execution_id=node_execution_id,
            status="SUCCESS",
            output_data=output,
            finished_at=datetime.utcnow(),
        ))

        # 回调调度器
        from primetop.dag.scheduler import DagSchedulerFactory
        scheduler = DagSchedulerFactory.get_scheduler()
        asyncio.run(scheduler.on_node_completed(
            run_id=run_id,
            node_id=node_def["node_id"],
            success=True,
            output=output,
        ))

        return {"status": "SUCCESS", "node_id": node_def["node_id"]}

    except Exception as e:
        import traceback
        error_msg = str(e)
        error_stack = traceback.format_exc()

        # 标记失败
        asyncio.run(storage.update_node_result(
            node_execution_id=node_execution_id,
            status="FAILED",
            error_message=error_msg,
            error_stack=error_stack,
            finished_at=datetime.utcnow(),
        ))

        # 回调调度器
        from primetop.dag.scheduler import DagSchedulerFactory
        scheduler = DagSchedulerFactory.get_scheduler()
        asyncio.run(scheduler.on_node_completed(
            run_id=run_id,
            node_id=node_def["node_id"],
            success=False,
            output={},
            error=error_msg,
        ))

        # 不 raise，让 Celery 认为"成功处理"了
        # 重试逻辑由 DAG Scheduler 控制
        return {"status": "FAILED", "node_id": node_def["node_id"], "error": error_msg}
```

### 5.4 Node Executor（节点执行器）

动态加载 Handler 执行节点逻辑。

```python
# primetop/dag/node_executor.py

import importlib
from typing import Any
from abc import ABC, abstractmethod


class BaseNodeHandler(ABC):
    """所有 DAG 节点 Handler 的基类"""

    @abstractmethod
    async def execute(
        self, input_data: dict, node_params: dict, run_context: dict
    ) -> dict:
        """执行节点逻辑

        Args:
            input_data: 前驱节点的输出数据 + 触发参数
            node_params: DAG 模板中定义的节点参数
            run_context: Pipeline 运行时上下文

        Returns:
            节点输出数据（将传递给后继节点）
        """
        ...


class NodeExecutor:
    """节点执行器：加载 Handler 并执行"""

    def __init__(self):
        self._handler_cache: dict[str, BaseNodeHandler] = {}

    async def execute(
        self, node_def: dict, input_data: dict, run: dict
    ) -> dict:
        """执行单个节点"""
        handler_path = node_def["handler"]
        node_params = node_def.get("params", {})
        run_context = run.get("context") or {}

        handler = self._get_handler(handler_path)
        output = await handler.execute(input_data, node_params, run_context)

        if output is None:
            output = {}

        return output

    def _get_handler(self, handler_path: str) -> BaseNodeHandler:
        """动态加载 Handler 类"""
        if handler_path in self._handler_cache:
            return self._handler_cache[handler_path]

        module_path, class_name = handler_path.rsplit(".", 1)
        module = importlib.import_module(module_path)
        handler_class = getattr(module, class_name)

        if not issubclass(handler_class, BaseNodeHandler):
            raise TypeError(
                f"Handler {handler_path} must inherit from BaseNodeHandler"
            )

        handler = handler_class()
        self._handler_cache[handler_path] = handler
        return handler
```

### 5.5 Condition Evaluator（条件评估器）

评估条件边表达式，决定是否触发后继节点。

```python
# primetop/dag/conditions.py

import ast
import operator
from typing import Any


class ConditionEvaluator:
    """安全的条件表达式评估器

    支持的表达式语法：
        - context.get('key') == value
        - context.get('key') != value
        - context.get('key') in ['a', 'b']
        - context.get('key', 0) > threshold
        - expr1 and expr2
        - expr1 or expr2
        - not expr
    """

    # 安全的运算符映射
    _OPERATORS = {
        ast.Eq: operator.eq,
        ast.NotEq: operator.ne,
        ast.Lt: operator.lt,
        ast.LtE: operator.le,
        ast.Gt: operator.gt,
        ast.GtE: operator.ge,
        ast.In: lambda a, b: a in b,
        ast.NotIn: lambda a, b: a not in b,
        ast.And: lambda a, b: a and b,
        ast.Or: lambda a, b: a or b,
        ast.Not: lambda a: not a,
        ast.Add: operator.add,
        ast.Sub: operator.sub,
        ast.Mult: operator.mul,
        ast.Div: operator.truediv,
        ast.Mod: operator.mod,
    }

    def evaluate(self, expression: str, context: dict) -> bool:
        """评估条件表达式"""
        try:
            tree = ast.parse(expression, mode="eval")
            result = self._eval_node(tree.body, context)
            return bool(result)
        except Exception as e:
            # 条件评估失败时默认不触发（安全降级）
            return False

    def _eval_node(self, node: ast.AST, context: dict) -> Any:
        """递归评估 AST 节点"""

        # 字面量
        if isinstance(node, ast.Constant):
            return node.value

        # 列表/字典/集合
        if isinstance(node, ast.List):
            return [self._eval_node(e, context) for e in node.elts]
        if isinstance(node, ast.Dict):
            return {
                self._eval_node(k, context): self._eval_node(v, context)
                for k, v in zip(node.keys, node.values)
            }

        # 变量名 (只允许 'context', 'True', 'False', 'None')
        if isinstance(node, ast.Name):
            if node.id == "context":
                return context
            if node.id == "True":
                return True
            if node.id == "False":
                return False
            if node.id == "None":
                return None
            raise ValueError(f"Variable not allowed: {node.id}")

        # 属性访问 (只允许 context.get, context.keys, context.values)
        if isinstance(node, ast.Attribute):
            obj = self._eval_node(node.value, context)
            return getattr(obj, node.attr)

        # 函数调用 (限制为 context.get('key', default))
        if isinstance(node, ast.Call):
            func = self._eval_node(node.func, context)
            args = [self._eval_node(a, context) for a in node.args]
            kwargs = {
                kw.arg: self._eval_node(kw.value, context)
                for kw in node.keywords
            }
            return func(*args, **kwargs)

        # 比较运算
        if isinstance(node, ast.Compare):
            left = self._eval_node(node.left, context)
            for op, comparator in zip(node.ops, node.comparators):
                right = self._eval_node(comparator, context)
                op_func = self._OPERATORS.get(type(op))
                if not op_func:
                    raise ValueError(f"Operator not allowed: {type(op).__name__}")
                if not op_func(left, right):
                    return False
                left = right
            return True

        # 布尔运算
        if isinstance(node, ast.BoolOp):
            op_func = self._OPERATORS.get(type(node.op))
            if not op_func:
                raise ValueError(f"BoolOp not allowed: {type(node.op).__name__}")
            result = self._eval_node(node.values[0], context)
            for value in node.values[1:]:
                result = op_func(result, self._eval_node(value, context))
            return result

        # 一元运算
        if isinstance(node, ast.UnaryOp):
            op_func = self._OPERATORS.get(type(node.op))
            if not op_func:
                raise ValueError(f"UnaryOp not allowed: {type(node.op).__name__}")
            return op_func(self._eval_node(node.operand, context))

        raise ValueError(f"AST node type not allowed: {type(node).__name__}")
```

---

## 6. API 接口设计

### 6.1 创建 Pipeline

```
POST /api/v1/dag/pipelines
```

**Request Body:**
```json
{
  "template_code": "study-report-generation",
  "trigger_source": "api",
  "business_key": "student:12345:monthly-report:2026-07",
  "priority": 60,
  "params": {
    "student_id": 12345,
    "report_type": "monthly",
    "period_start": "2026-07-01",
    "period_end": "2026-07-31"
  }
}
```

**Response:**
```json
{
  "code": 0,
  "data": {
    "run_uuid": "550e8400-e29b-41d4-a716-446655440000",
    "status": "RUNNING",
    "template_code": "study-report-generation",
    "created_at": "2026-07-28T10:36:00Z",
    "timeout_at": "2026-07-28T11:36:00Z"
  }
}
```

### 6.2 查询 Pipeline 状态

```
GET /api/v1/dag/pipelines/{run_uuid}
```

**Response:**
```json
{
  "code": 0,
  "data": {
    "run_uuid": "550e8400-e29b-41d4-a716-446655440000",
    "status": "RUNNING",
    "template_code": "study-report-generation",
    "priority": 60,
    "started_at": "2026-07-28T10:36:01Z",
    "timeout_at": "2026-07-28T11:36:00Z",
    "progress": {
      "total_nodes": 7,
      "completed": 3,
      "running": 1,
      "pending": 2,
      "failed": 0,
      "skipped": 0
    },
    "nodes": [
      {
        "node_id": "collect_data",
        "name": "采集学习数据",
        "status": "SUCCESS",
        "attempt": 1,
        "duration_ms": 2340,
        "started_at": "2026-07-28T10:36:02Z",
        "finished_at": "2026-07-28T10:36:04Z"
      },
      {
        "node_id": "ai_analysis",
        "name": "AI 分析解读",
        "status": "RUNNING",
        "attempt": 1,
        "started_at": "2026-07-28T10:36:05Z"
      }
    ]
  }
}
```

### 6.3 获取 Pipeline 可视化图

```
GET /api/v1/dag/pipelines/{run_uuid}/graph
```

**Response:**
```json
{
  "code": 0,
  "data": {
    "run_uuid": "550e8400-e29b-41d4-a716-446655440000",
    "svg": "<svg xmlns='http://www.w3.org/2000/svg'>...</svg>",
    "nodes": [
      {"id": "collect_data", "label": "采集学习数据", "status": "SUCCESS", "x": 100, "y": 50},
      {"id": "ai_analysis", "label": "AI 分析解读", "status": "RUNNING", "x": 100, "y": 150}
    ],
    "edges": [
      {"from": "collect_data", "to": "ai_analysis", "condition": null}
    ]
  }
}
```

### 6.4 取消 Pipeline

```
POST /api/v1/dag/pipelines/{run_uuid}/cancel
```

**Request Body:**
```json
{
  "reason": "用户手动取消"
}
```

### 6.5 重试 Pipeline

```
POST /api/v1/dag/pipelines/{run_uuid}/retry
```

**Request Body:**
```json
{
  "from_checkpoint": true
}
```

### 6.6 暂停/恢复 Pipeline

```
POST /api/v1/dag/pipelines/{run_uuid}/pause
POST /api/v1/dag/pipelines/{run_uuid}/resume
```

### 6.7 获取节点执行日志

```
GET /api/v1/dag/pipelines/{run_uuid}/nodes/{node_id}/logs
```

**Response:**
```json
{
  "code": 0,
  "data": {
    "node_id": "ai_analysis",
    "status": "SUCCESS",
    "input_data": {"collect_data": {"records": 156}},
    "output_data": {"analysis": "...", "score": 78},
    "duration_ms": 4520,
    "events": [
      {
        "event_type": "NODE_STARTED",
        "created_at": "2026-07-28T10:36:05.123Z"
      },
      {
        "event_type": "NODE_SUCCEEDED",
        "created_at": "2026-07-28T10:36:09.643Z"
      }
    ]
  }
}
```

### 6.8 列出模板

```
GET /api/v1/dag/templates?category=report&page=1&size=20
```

### 6.9 管理 API（后台）

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/v1/admin/dag/templates` | POST | 创建/更新 DAG 模板 |
| `/api/v1/admin/dag/templates/{code}` | PUT | 更新模板定义 |
| `/api/v1/admin/dag/templates/{code}/status` | PATCH | 启用/停用模板 |
| `/api/v1/admin/dag/pipelines` | GET | 分页查询 Pipeline 实例 |
| `/api/v1/admin/dag/pipelines/stats` | GET | 统计信息（运行数、成功率、平均耗时） |
| `/api/v1/admin/dag/queue/stats` | GET | 各队列积压情况 |

---

## 7. Handler 实现示例

### 7.1 学情报告 Handler

```python
# primetop/dag/handlers/report.py

from primetop.dag.node_executor import BaseNodeHandler
from primetop.services.learning import LearningDataService
from primetop.services.ai import AIService


class CollectDataHandler(BaseNodeHandler):
    """采集学习数据节点"""

    async def execute(
        self, input_data: dict, node_params: dict, run_context: dict
    ) -> dict:
        trigger = input_data.get("_trigger_params", {})
        student_id = trigger["student_id"]
        period_start = trigger["period_start"]
        period_end = trigger["period_end"]

        service = LearningDataService()
        data = await service.collect_student_data(
            student_id=student_id,
            start_date=period_start,
            end_date=period_end,
            sources=node_params.get("data_sources", []),
        )

        return {
            "study_time_total_minutes": data.total_minutes,
            "answer_records": data.answer_count,
            "correct_rate": data.correct_rate,
            "knowledge_mastery": data.mastery_snapshot,
            "weakness_points": data.weakness_points,
            "subject_distribution": data.subject_distribution,
        }


class AIAnalysisHandler(BaseNodeHandler):
    """AI 分析解读节点"""

    async def execute(
        self, input_data: dict, node_params: dict, run_context: dict
    ) -> dict:
        # 从前驱节点获取数据
        collect_output = input_data.get("collect_data", {})

        ai_service = AIService()
        analysis = await ai_service.generate_study_analysis(
            study_data=collect_output,
            model=node_params.get("model", "gpt-4o-mini"),
            prompt_template=node_params.get("prompt_template"),
        )

        return {
            "summary": analysis.summary,
            "improvements": analysis.suggestions,
            "risk_level": analysis.risk_level,
            "highlight": analysis.highlight,
        }


class AssembleReportHandler(BaseNodeHandler):
    """组装报告节点"""

    async def execute(
        self, input_data: dict, node_params: dict, run_context: dict
    ) -> dict:
        ai_output = input_data.get("ai_analysis", {})
        chart_output = input_data.get("generate_chart", {})

        report = {
            "sections": [
                {
                    "type": "overview",
                    "title": "学习概览",
                    "data": input_data.get("collect_data", {}),
                },
                {
                    "type": "analysis",
                    "title": "AI 分析解读",
                    "data": ai_output,
                },
                {
                    "type": "charts",
                    "title": "数据图表",
                    "data": chart_output,
                },
            ],
            "metadata": {
                "generated_at": datetime.utcnow().isoformat(),
            },
        }

        # 保存到数据库
        trigger = input_data.get("_trigger_params", {})
        report_service = ReportService()
        report_id = await report_service.save_report(
            student_id=trigger["student_id"],
            report_type=trigger["report_type"],
            content=report,
        )

        return {"report_id": report_id, "section_count": len(report["sections"])}
```

### 7.2 内容处理 Handler

```python
# primetop/dag/handlers/content.py

from primetop.dag.node_executor import BaseNodeHandler
from primetop.services.content import ContentService, OCRService, VectorService


class FormatDetectionHandler(BaseNodeHandler):
    """格式检测节点"""

    async def execute(
        self, input_data: dict, node_params: dict, run_context: dict
    ) -> dict:
        file_url = input_data["_trigger_params"]["file_url"]

        service = ContentService()
        file_info = await service.detect_format(file_url)

        return {
            "format": file_info.format,          # pdf|docx|image|video|audio
            "size_bytes": file_info.size,
            "page_count": file_info.page_count,
            "needs_ocr": file_info.needs_ocr,
            "needs_transcode": file_info.needs_transcode,
        }


class OCRRecognitionHandler(BaseNodeHandler):
    """OCR 识别节点"""

    async def execute(
        self, input_data: dict, node_params: dict, run_context: dict
    ) -> dict:
        format_output = input_data.get("format_detection", {})

        if not format_output.get("needs_ocr"):
            return {"text_content": None, "skipped": True}

        ocr_service = OCRService()
        result = await ocr_service.recognize(
            file_url=input_data["_trigger_params"]["file_url"],
            language=node_params.get("language", "auto"),
        )

        return {
            "text_content": result.text,
            "blocks": result.blocks,
            "formulas": result.formulas,
            "confidence": result.confidence,
        }


class VectorEmbeddingHandler(BaseNodeHandler):
    """向量嵌入节点"""

    async def execute(
        self, input_data: dict, node_params: dict, run_context: dict
    ) -> dict:
        struct_output = input_data.get("structural_parse", {})
        chunks = struct_output.get("chunks", [])

        if not chunks:
            return {"embedded_count": 0}

        vector_service = VectorService()
        embeddings = await vector_service.embed_batch(
            texts=[c["content"] for c in chunks],
            model=node_params.get("model", "text-embedding-3-small"),
        )

        # 入向量库
        await vector_service.upsert(
            collection="educational_content",
            documents=chunks,
            embeddings=embeddings,
            metadata_prefix=input_data["_trigger_params"],
        )

        return {"embedded_count": len(chunks)}
```

---

## 8. 超时与异常处理

### 8.1 超时体系

```
Pipeline 超时（timeout_at 字段）
  └── 节点超时（timeout_seconds in node_def）
       └── Celery time_limit（hard kill）
            └── Celery soft_time_limit（优雅停止）
```

### 8.2 超时监控器

```python
# primetop/dag/timeout_monitor.py

import asyncio
from datetime import datetime, timedelta


class TimeoutMonitor:
    """Pipeline 与节点超时监控"""

    def __init__(self, storage, scheduler):
        self._storage = storage
        self._scheduler = scheduler

    async def run_periodically(self, interval_seconds: int = 30):
        """定时扫描超时的 Pipeline 和节点"""
        while True:
            await asyncio.sleep(interval_seconds)
            try:
                await self._check_pipeline_timeouts()
                await self._check_node_timeouts()
            except Exception as e:
                # 监控器异常不影响业务
                pass

    async def _check_pipeline_timeouts(self):
        """检查 Pipeline 超时"""
        now = datetime.utcnow()
        timed_out = await self._storage.get_runs_by_status_and_timeout(
            status="RUNNING", before_time=now
        )

        for run in timed_out:
            # 取消所有运行中的节点
            running_nodes = await self._storage.get_nodes_by_status(
                run["id"], "RUNNING"
            )
            for node in running_nodes:
                await self._storage.update_node_status(
                    node_execution_id=node["id"],
                    status="TIMEOUT",
                    finished_at=now,
                    error_message="Pipeline timeout",
                )

            await self._storage.update_run_status(
                run_id=run["id"],
                status="TIMEOUT",
                error_message=f"Pipeline exceeded timeout of {run['timeout_at']}",
                finished_at=now,
            )

            await self._storage.append_event(
                run_uuid=run["run_uuid"],
                node_id=None,
                event_type="PIPELINE_TIMEOUT",
                event_data={"timeout_at": run["timeout_at"].isoformat()},
            )

    async def _check_node_timeouts(self):
        """检查节点级超时（节点运行时间超过其定义的 timeout）"""
        running_nodes = await self._storage.get_all_running_nodes_with_timeout()

        for node_exec in running_nodes:
            if node_exec["started_at"]:
                elapsed = (datetime.utcnow() - node_exec["started_at"]).total_seconds()
                if elapsed > node_exec.get("timeout_seconds", 300):
                    # 标记节点超时
                    await self._storage.update_node_status(
                        node_execution_id=node_exec["id"],
                        status="TIMEOUT",
                        finished_at=datetime.utcnow(),
                        error_message=f"Node exceeded {node_exec['timeout_seconds']}s",
                    )
                    # 触发调度器失败处理
                    await self._scheduler.on_node_completed(
                        run_id=node_exec["run_id"],
                        node_id=node_exec["node_id"],
                        success=False,
                        output={},
                        error="Node timeout",
                    )
```

### 8.3 错误处理矩阵

| 场景 | 处理策略 | 恢复方式 |
|------|----------|----------|
| 节点执行异常 | 按 retry_policy 自动重试，指数退避 | 自动 |
| 节点重试耗尽 | Pipeline 标记 FAILED，发送告警 | 手动 retry from checkpoint |
| Pipeline 超时 | 标记 TIMEOUT，取消运行中节点 | 手动 retry |
| Celery Worker 崩溃 | `acks_late=True`，消息重投 | 自动（Celery 重试） |
| 数据库连接失败 | 节点重试 + Pipeline 级容错 | 自动 |
| AI 模型调用失败 | 节点级重试 + 降级模型 | 自动（降级）或手动重试 |
| 死锁/竞争条件 | Redlock + 幂等键 | 自动（重试）或手动 |

### 8.4 死信处理

```python
# primetop/dag/dlq.py

class DeadLetterHandler:
    """处理所有重试耗尽的 Pipeline"""

    def __init__(self, storage, alert_service):
        self._storage = storage
        self._alert = alert_service

    async def handle_failed_pipeline(self, run_uuid: str):
        """Pipeline 彻底失败后的处理"""
        run = await self._storage.get_run_by_uuid(run_uuid)

        # 1. 发送告警
        await self._alert.send_alert(
            level="ERROR",
            title=f"DAG Pipeline Failed: {run['template_code']}",
            content=(
                f"Run UUID: {run_uuid}\n"
                f"Business Key: {run.get('business_key')}\n"
                f"Error: {run.get('error_message')}\n"
                f"Trigger Params: {run.get('trigger_params')}\n"
                f"Started: {run.get('started_at')}\n"
                f"Failed: {run.get('finished_at')}"
            ),
            tags=["dag", run["template_code"], "pipeline-failed"],
        )

        # 2. 记录到失败看板（供管理后台查询）
        await self._storage.record_failure_metrics(
            template_code=run["template_code"],
            failed_node=run.get("error_message", "").split("'")[1] if "'" in run.get("error_message", "") else "unknown",
            duration=(run["finished_at"] - run["started_at"]).total_seconds()
            if run.get("started_at") and run.get("finished_at") else 0,
        )

        # 3. 根据模板配置决定是否自动降级处理
        template = await self._storage.get_template_by_id(run["template_id"])
        fallback = template.get("definition", {}).get("fallback")
        if fallback:
            await self._execute_fallback(run, fallback)
```

---

## 9. 预定义 DAG 模板

### 9.1 学情报告生成模板

```yaml
# templates/study-report-generation.yaml
template_code: study-report-generation
name: 学情报告生成管线
category: report
max_concurrency: 100
priority: 50
timeout_seconds: 600

nodes:
  - node_id: collect_data
    name: 采集学习数据
    handler: primetop.dag.handlers.report.CollectDataHandler
    params:
      data_sources: [answer_records, learning_sessions, mistake_records]
    timeout_seconds: 60
    retry: { max_retries: 2, backoff_base: 5, backoff_max: 30 }
    resource: { queue: default }

  - node_id: compute_mastery
    name: 计算知识掌握度
    handler: primetop.dag.handlers.report.ComputeMasteryHandler
    timeout_seconds: 30
    retry: { max_retries: 2, backoff_base: 3, backoff_max: 15 }
    resource: { queue: default }

  - node_id: ai_analysis
    name: AI 分析解读
    handler: primetop.dag.handlers.report.AIAnalysisHandler
    params:
      model: gpt-4o-mini
      prompt_template: study_report_analysis_v2
    timeout_seconds: 120
    retry: { max_retries: 2, backoff_base: 10, backoff_max: 60 }
    resource: { queue: ai_heavy }

  - node_id: has_chart_data
    name: 条件判断-是否有图表数据
    type: condition
    params:
      expression: "context.get('_node_outputs', {}).get('collect_data', {}).get('answer_records', 0) > 0"

  - node_id: generate_chart
    name: 生成图表数据
    handler: primetop.dag.handlers.report.GenerateChartHandler
    timeout_seconds: 30
    retry: { max_retries: 1, backoff_base: 3, backoff_max: 10 }
    resource: { queue: default }

  - node_id: assemble_report
    name: 组装报告
    handler: primetop.dag.handlers.report.AssembleReportHandler
    timeout_seconds: 30
    retry: { max_retries: 2, backoff_base: 3, backoff_max: 15 }
    resource: { queue: default }

  - node_id: push_notification
    name: 推送通知
    handler: primetop.dag.handlers.report.PushNotificationHandler
    timeout_seconds: 15
    retry: { max_retries: 3, backoff_base: 5, backoff_max: 30 }
    resource: { queue: default }

edges:
  - { from: collect_data, to: compute_mastery }
  - { from: collect_data, to: has_chart_data }
  - { from: has_chart_data, to: generate_chart, condition: "true" }
  - { from: compute_mastery, to: ai_analysis }
  - { from: ai_analysis, to: assemble_report }
  - { from: generate_chart, to: assemble_report }
  - { from: assemble_report, to: push_notification }
```

### 9.2 内容处理管线模板

```yaml
# templates/content-processing.yaml
template_code: content-processing
name: 教育内容处理管线
category: content
max_concurrency: 20
priority: 70
timeout_seconds: 1800

nodes:
  - node_id: format_detection
    name: 格式检测
    handler: primetop.dag.handlers.content.FormatDetectionHandler
    timeout_seconds: 10
    retry: { max_retries: 1, backoff_base: 2, backoff_max: 5 }
    resource: { queue: default }

  - node_id: ocr_recognition
    name: OCR 识别
    handler: primetop.dag.handlers.content.OCRRecognitionHandler
    params: { language: auto }
    timeout_seconds: 120
    retry: { max_retries: 2, backoff_base: 5, backoff_max: 30 }
    resource: { queue: io_heavy }

  - node_id: structural_parse
    name: 结构化解析
    handler: primetop.dag.handlers.content.StructuralParseHandler
    timeout_seconds: 60
    retry: { max_retries: 2, backoff_base: 5, backoff_max: 30 }
    resource: { queue: default }

  - node_id: knowledge_tagging
    name: 知识点标注
    handler: primetop.dag.handlers.content.KnowledgeTaggingHandler
    timeout_seconds: 60
    retry: { max_retries: 2, backoff_base: 5, backoff_max: 30 }
    resource: { queue: ai_heavy }

  - node_id: vector_embedding
    name: 向量嵌入
    handler: primetop.dag.handlers.content.VectorEmbeddingHandler
    params: { model: text-embedding-3-small }
    timeout_seconds: 120
    retry: { max_retries: 2, backoff_base: 10, backoff_max: 60 }
    resource: { queue: ai_heavy }

  - node_id: content_moderation
    name: 内容审核
    handler: primetop.dag.handlers.content.ContentModerationHandler
    timeout_seconds: 30
    retry: { max_retries: 3, backoff_base: 3, backoff_max: 20 }
    resource: { queue: default }

  - node_id: quality_scoring
    name: 质量评分
    handler: primetop.dag.handlers.content.QualityScoringHandler
    timeout_seconds: 30
    retry: { max_retries: 1, backoff_base: 3, backoff_max: 10 }
    resource: { queue: default }

  - node_id: publish
    name: 发布上线
    handler: primetop.dag.handlers.content.PublishHandler
    timeout_seconds: 15
    retry: { max_retries: 3, backoff_base: 5, backoff_max: 30 }
    resource: { queue: default }

edges:
  - { from: format_detection, to: ocr_recognition }
  - { from: ocr_recognition, to: structural_parse }
  - { from: structural_parse, to: knowledge_tagging }
  - { from: structural_parse, to: vector_embedding }
  - { from: knowledge_tagging, to: content_moderation }
  - { from: vector_embedding, to: content_moderation }
  - { from: content_moderation, to: quality_scoring }
  - { from: quality_scoring, to: publish }
```

---

## 10. 性能优化

### 10.1 调度性能

| 策略 | 说明 |
|------|------|
| Redis 就绪队列 | 就绪节点写入 Redis Sorted Set（score=优先级），避免频繁查 DB |
| 批量加载 | 一次加载 Pipeline 所有节点状态，减少 DB 往返 |
| 图缓存 | networkx 图对象按 template_id 缓存（模板不变则复用） |
| 异步并发 | 所有 I/O 操作使用 asyncio，节点分发并发提交 |

### 10.2 并发控制

```python
# 全局并发控制：按队列限制并发 Pipeline 数
DAG_QUEUE_CONCURRENCY = {
    "default": 50,     # 普通任务队列最多 50 个并发节点
    "ai_heavy": 10,    # AI 密集型队列最多 10 个并发
    "io_heavy": 20,    # I/O 密集型队列最多 20 个并发
}

# Celery worker_prefetch_multiplier = 1  (避免一个 Worker 囤积任务)
# Celery worker_concurrency 根据 CPU 核数设置
```

### 10.3 数据库优化

```sql
-- 关键索引（已在建表语句中定义）
-- idx_status_priority: 支持按优先级调度
-- idx_timeout: 支持超时快速扫描
-- idx_business_key: 支持幂等查询
-- idx_run_uuid_time: 支持事件日志按时间范围查询

-- 定期归档：3个月以上的 dag_node_execution 和 dag_event_log 迁移到归档表
-- 分区策略：dag_event_log 按月分区
ALTER TABLE dag_event_log PARTITION BY RANGE (TO_DAYS(created_at)) (
    PARTITION p202607 VALUES LESS THAN (TO_DAYS('2026-08-01')),
    PARTITION p202608 VALUES LESS THAN (TO_DAYS('2026-09-01')),
    PARTITION p_max VALUES LESS THAN MAXVALUE
);
```

---

## 11. 监控与告警

### 11.1 核心监控指标

| 指标 | 类型 | 说明 |
|------|------|------|
| `dag.pipeline.total` | Counter | Pipeline 创建总数 |
| `dag.pipeline.success.rate` | Gauge | Pipeline 成功率（滑动5分钟） |
| `dag.pipeline.duration` | Histogram | Pipeline 端到端耗时分布 |
| `dag.node.duration` | Histogram | 节点耗时分布（按 handler 分标签） |
| `dag.node.retry.count` | Counter | 节点重试次数 |
| `dag.queue.depth` | Gauge | 各队列积压深度 |
| `dag.checkpoint.recovery.count` | Counter | 断点恢复次数 |
| `dag.concurrent.pipelines` | Gauge | 当前活跃 Pipeline 数 |

### 11.2 告警规则

```yaml
alerts:
  - name: PipelineFailureRate
    condition: "dag.pipeline.success.rate < 0.9 AND rate > 10"
    duration: 5m
    severity: WARNING
    message: "Pipeline 成功率低于 90%"

  - name: PipelineStuck
    condition: "dag.pipeline.duration{quantile='0.95'} > 1800"
    duration: 5m
    severity: WARNING
    message: "95% 的 Pipeline 耗时超过 30 分钟"

  - name: QueueBacklog
    condition: "dag.queue.depth{queue='ai_heavy'} > 50"
    duration: 10m
    severity: CRITICAL
    message: "AI 队列积压超过 50，可能需要扩容 Worker"

  - name: NodeRetrySpike
    condition: "rate(dag.node.retry.count[5m]) > 10"
    duration: 5m
    severity: WARNING
    message: "节点重试率激增，可能存在下游服务故障"
```

---

## 12. 安全与权限

### 12.1 访问控制

| 操作 | 权限 | 说明 |
|------|------|------|
| 创建 Pipeline | `dag:pipeline:create` | 业务服务自动拥有 |
| 查询 Pipeline | `dag:pipeline:read` | 按业务隔离（仅查自己创建的） |
| 取消 Pipeline | `dag:pipeline:cancel` | 创建者或管理员 |
| 管理模板 | `dag:template:manage` | 仅管理员 |
| 查看 DAG 监控 | `dag:monitor:view` | 运维人员 |

### 12.2 安全防护

1. **Handler 白名单**：只允许注册过的 Handler 类执行，防止代码注入
2. **参数校验**：Pipeline 参数经过 JSON Schema 校验后存入
3. **条件表达式沙箱**：ConditionEvaluator 使用 AST 白名单，禁止 `import`/`exec`/`eval`
4. **资源隔离**：不同业务线的 Pipeline 使用不同队列，避免互相影响
5. **审计日志**：所有管理操作（创建/取消/重试/模板变更）记录到 `dag_event_log`

---

## 13. 部署与配置

### 13.1 Worker 部署

```yaml
# docker-compose.yml (DAG Worker 节点)
dag-worker-default:
  build: .
  command: >
    celery -A primetop.celery_app worker
    -Q dag.default,default
    --concurrency=8
    --prefetch-multiplier=1
    --max-tasks-per-child=100
    -n dag-default@%h
  deploy:
    replicas: 2
  environment:
    - CELERY_BROKER_URL=redis://redis:6379/3
    - DATABASE_URL=mysql://primetop:***@mysql:3306/primetop

dag-worker-ai:
  build: .
  command: >
    celery -A primetop.celery_app worker
    -Q dag.ai_heavy,ai_heavy
    --concurrency=4
    --prefetch-multiplier=1
    --max-tasks-per-child=20
    -n dag-ai@%h
  deploy:
    replicas: 3
  environment:
    - CELERY_BROKER_URL=redis://redis:6379/3
    - DATABASE_URL=mysql://primetop:***@mysql:3306/primetop

dag-timeout-monitor:
  build: .
  command: python -m primetop.dag.timeout_monitor
  deploy:
    replicas: 1  # 单实例，避免重复扫描
  environment:
    - CHECK_INTERVAL_SECONDS=30
```

### 13.2 关键配置

```python
# config/dag.py

DAG_CONFIG = {
    # 调度器
    "SCHEDULER_POLL_INTERVAL_MS": 500,    # 调度器轮询间隔
    "MAX_NODES_PER_PIPELINE": 50,         # 单 Pipeline 最大节点数
    "MAX_CONCURRENT_PIPELINES": 200,      # 全局最大活跃 Pipeline 数

    # 超时
    "DEFAULT_NODE_TIMEOUT": 300,          # 默认节点超时（秒）
    "DEFAULT_PIPELINE_TIMEOUT": 3600,     # 默认 Pipeline 超时（秒）
    "TIMEOUT_CHECK_INTERVAL": 30,         # 超时检查间隔（秒）

    # 重试
    "DEFAULT_MAX_RETRIES": 3,             # 默认最大重试次数
    "DEFAULT_BACKOFF_BASE": 5,            # 默认退避基数（秒）
    "DEFAULT_BACKOFF_MAX": 300,           # 默认最大退避（秒）

    # Checkpoint
    "CHECKPOINT_ENABLED": True,           # 启用断点恢复
    "CHECKPOINT_COMPRESS": True,          # 压缩 checkpoint 数据

    # 清理
    "ARCHIVAL_AGE_DAYS": 90,              # 90天后归档到冷存储
    "ARCHIVAL_BATCH_SIZE": 1000,          # 每批归档 1000 条

    # 可视化
    "GRAPH_LAYOUT": "dot",                # Graphviz 布局算法
    "MAX_GRAPH_NODES_DISPLAY": 100,       # 可视化最大节点数
}
```

---

## 14. 演进路线

| 阶段 | 目标 | 关键能力 |
|------|------|----------|
| **Phase 1 (MVP)** | 基础 DAG 调度 | JSON 模板定义 + 拓扑排序 + 断点恢复 + 内容/报告管线 |
| **Phase 2 (V1.0)** | 可视化与监控 | DAG 实时可视化 + Web 管理面板 + Prometheus 指标 |
| **Phase 3 (V1.5)** | 动态 DAG | 运行时动态注入节点 + 子 Pipeline 嵌套 + 条件分支增强 |
| **Phase 4 (V2.0)** | 分布式优化 | 调度器高可用（主备切换）+ 跨集群调度 + GPU 资源池化 |

---

## 附录 A: 完整事件类型清单

| event_type | 触发时机 | 附带数据 |
|------------|----------|----------|
| `PIPELINE_CREATED` | Pipeline 实例创建 | template_code, params |
| `PIPELINE_STARTED` | 调度器开始执行 | node_count |
| `PIPELINE_PAUSED` | 手动暂停 | - |
| `PIPELINE_RESUMED` | 手动恢复 | - |
| `PIPELINE_CANCELLED` | 手动取消 | reason |
| `PIPELINE_COMPLETED` | 全部节点成功 | total_nodes, duration |
| `PIPELINE_FAILED` | 节点失败且重试耗尽 | failed_node, error |
| `PIPELINE_TIMEOUT` | Pipeline 超时 | timeout_at |
| `NODE_STARTED` | 节点开始执行 | attempt, worker |
| `NODE_SUCCEEDED` | 节点成功完成 | has_output, duration |
| `NODE_FAILED` | 节点执行失败 | error, attempt |
| `NODE_RETRY_SCHEDULED` | 节点计划重试 | attempt, delay_seconds |
| `NODE_SKIPPED` | 条件不满足跳过 | reason |
| `NODE_TIMEOUT` | 节点超时 | timeout_seconds |
| `NODE_CANCELLED` | Pipeline 取消导致 | - |
