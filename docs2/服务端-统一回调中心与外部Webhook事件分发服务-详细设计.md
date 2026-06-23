# 服务端-统一回调中心与外部 Webhook 事件分发服务 - 详细设计

> 模块版本：v1.0 | 最后更新：2026-06-24
> 原始需求来源：`docs/design/启硕-PrimeTop-全学段AI辅助学习软件项目设计文档.md` §8.4, §8.5, §11, §13
> 依赖文档：`异步任务与事件驱动架构-详细设计.md`、`服务端统一业务异常码与错误分类体系-详细设计.md`、`支付与会员订阅-详细设计.md`、`服务端密钥管理与敏感配置安全策略-详细设计.md`、`服务端分布式锁实现与并发资源竞争防护规范-详细设计.md`

---

## 1. 模块概述

### 1.1 定位

统一回调中心（Unified Webhook Center，简称 UWC）是 PrimeTop 服务端与所有外部第三方服务之间的**唯一可信入站网关**。它负责接收支付机构（微信支付、支付宝、Apple IAP、Google Play）、AI 供应商（异步长任务回调）、短信/推送网关（送达回执）、内容处理管线（转码完成、OCR 完成）等外部系统的异步回调通知，进行统一的身份验证、签名校验、幂等去重、事件路由与可靠分发。

本文档定义 UWC 的完整架构、数据模型、接口规范、安全策略和扩展机制，使开发人员可直接按规范实现回调接入。

### 1.2 解决的问题

| 痛点 | 说明 |
|------|------|
| 回调散落各处 | 支付回调在支付服务、AI 回调在 AI 服务，安全边界不统一 |
| 签名校验重复实现 | 每个供应商签名算法不同，各团队重复造轮子 |
| 幂等保障不足 | 外部系统会重发回调，缺少统一幂等表导致重复处理 |
| 回调链路不可观测 | 回调失败无告警、无大盘，出问题才发现 |
| 安全暴露面大 | 多个服务直接暴露公网回调端口，攻击面不可控 |
| 新接入成本高 | 接一个新供应商需要各服务自行改造，缺乏标准流程 |

### 1.3 核心目标

1. **统一入口**：所有外部回调统一通过 UWC 接收，业务服务不直接暴露回调端口
2. **安全可信**：每条回调经过严格的签名验证 + 时间窗口校验 + 防重放检查
3. **精确一次**：通过幂等表保证回调事件的业务效果 exactly-once 语义
4. **可靠分发**：校验通过后通过内部事件总线投递到目标业务服务，支持失败重试
5. **全链路可观测**：每条回调从接收到处理完成可追踪、可回溯、可告警
6. **低成本扩展**：接入新供应商只需注册渠道配置 + 编写 Handler，无需修改框架代码

### 1.4 技术选型

| 组件 | 选型 | 说明 |
|------|------|------|
| Web 框架 | FastAPI (Python 3.11+) | 与主后端技术栈一致，异步高性能 |
| 幂等存储 | MySQL + Redis | MySQL 持久化幂等记录，Redis 做热路径快速判重 |
| 事件分发 | Redis Stream → Celery | 复用现有异步任务与事件驱动架构 |
| 配置管理 | 配置中心（Nacos/Apollo） | 渠道配置动态下发，支持热更新 |
| 日志 & 追踪 | OpenTelemetry + ELK | 全链路 traceId 贯穿回调→分发→业务处理 |
| 签名验证 | 自研 Verifier Registry | 按渠道注册验签策略，策略模式扩展 |

### 1.5 术语定义

| 术语 | 含义 |
|------|------|
| Channel | 回调渠道，代表一个外部系统的回调来源（如 `wechat_pay`、`alipay`） |
| Webhook Event | UWC 对外部回调的内部标准化表示 |
| Verifier | 渠道签名验证器，负责校验回调请求的真实性 |
| Handler | 业务处理器，处理特定渠道特定事件类型的业务逻辑 |
| Idempotency Key | 幂等键，用于判断回调是否已处理 |
| Replay Window | 防重放时间窗口，超过窗口的回调视为过期拒绝 |

---

## 2. 架构总览

### 2.1 整体架构图

```text
┌────────────────────────────────────────────────────────────────────┐
│                        外部服务 (Third-party)                       │
│                                                                    │
│  微信支付   支付宝   Apple IAP   Google Play   AI供应商   短信网关   │
└─────┬────────┬────────┬────────────┬────────────┬────────┬────────┘
      │        │        │            │            │        │
      ▼        ▼        ▼            ▼            ▼        ▼
┌────────────────────────────────────────────────────────────────────┐
│                     UWC API 层 (FastAPI)                           │
│                                                                    │
│  POST /api/v1/webhook/{channel}                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  1. 请求解析 (Raw Body 保留)                                  │  │
│  │  2. 渠道路由 (Channel Router)                                 │  │
│  │  3. 限流检查 (Rate Limiter - per channel)                     │  │
│  │  4. 签名验证 (Verifier Registry)                              │  │
│  │  5. 时间窗口检查 (Replay Protection)                          │  │
│  │  6. 幂等检查 (Idempotency Guard - Redis + MySQL)              │  │
│  │  7. 标准化 (Normalizer → WebhookEvent)                        │  │
│  │  8. 持久化 (Webhook Record)                                   │  │
│  │  9. 事件分发 (Event Dispatcher → Redis Stream)               │  │
│  │  10. 返回 ACK                                                │  │
│  └──────────────────────────────────────────────────────────────┘  │
└───────────────────────────┬────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────────┐
│              Redis Stream (内部事件总线)                            │
│                                                                    │
│  stream:webhook:events                                             │
│  ┌──────┬──────┬──────┬──────┬──────┬──────┐                      │
│  │ msg1 │ msg2 │ msg3 │ msg4 │ msg5 │ ...  │                      │
│  └──┬───┴──┬───┴──┬───┴──┬───┴──┬───┴──────┘                      │
└─────┼──────┼──────┼──────┼──────┼─────────────────────────────────┘
      │      │      │      │      │
      ▼      ▼      ▼      ▼      ▼
┌────────────────────────────────────────────────────────────────────┐
│                   Celery Worker (webhook-handler)                   │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Handler Registry                                           │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │   │
│  │  │ Payment     │ │ AI Provider │ │ Notification        │   │   │
│  │  │ Handler     │ │ Handler     │ │ Handler             │   │   │
│  │  │ (支付退款)   │ │ (异步AI任务) │ │ (推送/短信送达回执)  │   │   │
│  │  └─────────────┘ └─────────────┘ └─────────────────────┘   │   │
│  │  ┌─────────────┐ ┌─────────────┐                           │   │
│  │  │ Content     │ │ Custom      │                           │   │
│  │  │ Handler     │ │ Handler     │                           │   │
│  │  │ (转码/OCR)   │ │ (扩展)      │                           │   │
│  │  └─────────────┘ └─────────────┘                           │   │
│  └─────────────────────────────────────────────────────────────┘   │
└───────────────────────────┬────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────────┐
│                    业务服务 (Business Services)                     │
│                                                                    │
│  payment-service   ai-service   content-service   notify-service  │
│  (订单状态更新)     (结果落库)    (资源状态更新)     (送达状态更新)  │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心设计原则

1. **同步接收、异步处理**：UWC 对外部回调在 3 秒内返回 ACK，真正的业务处理异步进行
2. **先校验后处理**：签名校验、时间窗口、幂等检查全部通过后才进入业务处理流程
3. **原始数据留存**：每个回调的原始 HTTP 请求（Header + Body）完整持久化，便于审计和问题排查
4. **失败安全**：处理失败的回调进入重试队列，重试耗尽后进入死信队列并触发告警
5. **渠道隔离**：不同渠道的回调互不影响，某个渠道的 Handler 故障不影响其他渠道

---

## 3. 数据结构定义

### 3.1 数据库表设计

#### 3.1.1 `webhook_channel` — 回调渠道注册表

```sql
CREATE TABLE `webhook_channel` (
    `id`                BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT COMMENT '主键',
    `channel_code`      VARCHAR(64)      NOT NULL COMMENT '渠道编码，如 wechat_pay、alipay、apple_iap',
    `channel_name`      VARCHAR(128)     NOT NULL COMMENT '渠道名称',
    `channel_category`  VARCHAR(32)      NOT NULL COMMENT '渠道类别: payment / ai_provider / notification / content / other',
    `base_path`         VARCHAR(128)     NOT NULL COMMENT '回调基础路径，如 /api/v1/webhook/wechat_pay',
    `verifier_type`     VARCHAR(64)      NOT NULL COMMENT '签名验证器类型: hmac_sha256 / rsa_sha256 / apple_jwt / google_pubkey / custom',
    `verifier_config`   JSON             NOT NULL COMMENT '验证器配置（密钥ID、公钥地址等，敏感信息引用密钥管理服务）',
    `replay_window_sec` INT UNSIGNED     NOT NULL DEFAULT 300 COMMENT '防重放时间窗口（秒），默认5分钟',
    `rate_limit_per_min` INT UNSIGNED    NOT NULL DEFAULT 1000 COMMENT '每分钟最大回调数（限流）',
    `is_active`         TINYINT(1)       NOT NULL DEFAULT 1 COMMENT '是否启用',
    `created_at`        DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`        DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_channel_code` (`channel_code`),
    KEY `idx_category_active` (`channel_category`, `is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='回调渠道注册表';
```

#### 3.1.2 `webhook_record` — 回调记录表（核心表）

```sql
CREATE TABLE `webhook_record` (
    `id`                BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT COMMENT '主键',
    `webhook_id`        VARCHAR(64)      NOT NULL COMMENT '内部唯一事件ID (ULID)',
    `channel_code`      VARCHAR(64)      NOT NULL COMMENT '渠道编码',
    `external_event_id` VARCHAR(128)     DEFAULT NULL COMMENT '外部事件ID（如微信的 transaction_id）',
    `event_type`        VARCHAR(64)      NOT NULL COMMENT '标准化事件类型: payment.success / payment.refund / ai.task_complete 等',
    `event_subtype`     VARCHAR(64)      DEFAULT NULL COMMENT '事件子类型，如 wechat_pay 为: pay / refund / transfer',
    `raw_headers`       JSON             NOT NULL COMMENT '原始请求头',
    `raw_body`          LONGTEXT         NOT NULL COMMENT '原始请求体',
    `body_size`         INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '请求体字节数',
    `client_ip`         VARCHAR(45)      NOT NULL COMMENT '请求来源 IP',
    `idempotency_key`   VARCHAR(128)     NOT NULL COMMENT '幂等键（渠道+外部事件ID 派生）',
    `status`            VARCHAR(20)      NOT NULL DEFAULT 'RECEIVED' COMMENT '处理状态: RECEIVED / VERIFIED / DISPATCHED / PROCESSING / SUCCESS / FAILED / DEAD',
    `retry_count`       INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '已重试次数',
    `max_retry`         INT UNSIGNED     NOT NULL DEFAULT 5 COMMENT '最大重试次数',
    `next_retry_at`     DATETIME(3)      DEFAULT NULL COMMENT '下次重试时间',
    `verified_at`       DATETIME(3)      DEFAULT NULL COMMENT '签名验证通过时间',
    `dispatched_at`     DATETIME(3)      DEFAULT NULL COMMENT '事件分发时间',
    `processed_at`      DATETIME(3)      DEFAULT NULL COMMENT '业务处理完成时间',
    `error_code`        VARCHAR(64)      DEFAULT NULL COMMENT '最后错误码',
    `error_message`     TEXT             DEFAULT NULL COMMENT '最后错误信息',
    `handler_name`      VARCHAR(128)     DEFAULT NULL COMMENT '处理的 Handler 名称',
    `trace_id`          VARCHAR(64)      NOT NULL COMMENT '分布式追踪 TraceID',
    `created_at`        DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`        DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_webhook_id` (`webhook_id`),
    UNIQUE KEY `uk_idempotency_key` (`idempotency_key`),
    KEY `idx_channel_status` (`channel_code`, `status`),
    KEY `idx_event_type` (`event_type`),
    KEY `idx_status_retry` (`status`, `next_retry_at`),
    KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Webhook 回调记录表';
```

#### 3.1.3 `webhook_retry_log` — 重试日志表

```sql
CREATE TABLE `webhook_retry_log` (
    `id`                BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    `webhook_id`        VARCHAR(64)      NOT NULL COMMENT '关联的 webhook_id',
    `retry_seq`         INT UNSIGNED     NOT NULL COMMENT '重试序号，从1开始',
    `handler_name`      VARCHAR(128)     NOT NULL COMMENT '执行的 Handler',
    `attempt_result`    VARCHAR(20)      NOT NULL COMMENT 'SUCCESS / FAILED',
    `error_code`        VARCHAR(64)      DEFAULT NULL,
    `error_message`     TEXT             DEFAULT NULL,
    `execution_ms`      INT UNSIGNED     DEFAULT NULL COMMENT '执行耗时（毫秒）',
    `executed_at`       DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_webhook_retry` (`webhook_id`, `retry_seq`),
    KEY `idx_webhook_id` (`webhook_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Webhook 重试日志表';
```

#### 3.1.4 `webhook_dead_letter` — 死信表

```sql
CREATE TABLE `webhook_dead_letter` (
    `id`                BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    `webhook_id`        VARCHAR(64)      NOT NULL COMMENT '关联的 webhook_id',
    `channel_code`      VARCHAR(64)      NOT NULL,
    `event_type`        VARCHAR(64)      NOT NULL,
    `original_record`   JSON             NOT NULL COMMENT '原始 webhook_record 快照',
    `last_error_code`   VARCHAR(64)      NOT NULL,
    `last_error_message` TEXT            NOT NULL,
    `total_retries`     INT UNSIGNED     NOT NULL,
    `dead_at`           DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '进入死信时间',
    `manual_status`     VARCHAR(20)      NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING / REPROCESSED / IGNORED',
    `handled_by`        VARCHAR(64)      DEFAULT NULL COMMENT '处理人',
    `handled_at`        DATETIME(3)      DEFAULT NULL,
    `handled_note`      TEXT             DEFAULT NULL COMMENT '处理备注',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_webhook_id` (`webhook_id`),
    KEY `idx_manual_status` (`manual_status`),
    KEY `idx_dead_at` (`dead_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Webhook 死信表';
```

### 3.2 Redis 数据结构

#### 3.2.1 幂等去重 Bloom Filter + KV

```text
# 快速判重（热路径）：Redis String，TTL = replay_window_sec * 2
KEY: webhook:dedup:{idempotency_key}
VAL: webhook_id
TTL: 600 (秒)

# 渠道级别限流：Redis 滑动窗口
KEY: webhook:ratelimit:{channel_code}:{minute_timestamp}
VAL: count
TTL: 120 (秒)
```

#### 3.2.2 Redis Stream — 事件分发

```text
# 主事件流
STREAM: webhook:events
Consumer Group: webhook-handlers
Consumer: handler-{worker_id}

# 字段:
{
    "webhook_id": "01J...",
    "channel_code": "wechat_pay",
    "event_type": "payment.success",
    "trace_id": "abc123..."
}
```

### 3.3 内部标准化数据模型

```python
from pydantic import BaseModel, Field
from enum import Enum
from typing import Any, Optional
from datetime import datetime


class WebhookStatus(str, Enum):
    """回调处理状态机"""
    RECEIVED    = "RECEIVED"      # 已接收，待校验
    REJECTED    = "REJECTED"      # 校验失败，已拒绝
    VERIFIED    = "VERIFIED"      # 校验通过，待分发
    DISPATCHED  = "DISPATCHED"    # 已分发到事件流
    PROCESSING  = "PROCESSING"    # Handler 正在处理
    SUCCESS     = "SUCCESS"       # 处理成功
    FAILED      = "FAILED"        # 处理失败，待重试
    DEAD        = "DEAD"          # 重试耗尽，进入死信


class WebhookEvent(BaseModel):
    """标准化 Webhook 事件对象 — UWC 内部统一表示"""

    # ── 标识 ──
    webhook_id: str = Field(
        ..., description="内部唯一事件ID，使用 ULID 生成，全局唯一且有序"
    )
    channel_code: str = Field(
        ..., description="渠道编码，如 wechat_pay"
    )
    external_event_id: Optional[str] = Field(
        None, description="外部事件ID，如微信支付通知中的 transaction_id"
    )
    event_type: str = Field(
        ..., description="标准化事件类型，如 payment.success / ai.task_complete"
    )
    event_subtype: Optional[str] = Field(
        None, description="事件子类型，渠道特定，如 refund / transfer"
    )

    # ── 幂等 ──
    idempotency_key: str = Field(
        ..., description="幂等键 = sha256(channel_code:external_event_id:event_type)"
    )

    # ── 原始数据 ──
    raw_headers: dict[str, str] = Field(
        ..., description="原始 HTTP 请求头"
    )
    raw_body: str = Field(
        ..., description="原始请求体文本"
    )
    parsed_payload: dict[str, Any] = Field(
        default_factory=dict, description="解析后的结构化数据（各渠道 Normalizer 输出）"
    )

    # ── 元数据 ──
    client_ip: str = Field(..., description="来源 IP")
    received_at: datetime = Field(..., description="接收时间")
    trace_id: str = Field(..., description="OpenTelemetry TraceID")

    # ── 处理状态 ──
    status: WebhookStatus = Field(
        default=WebhookStatus.RECEIVED, description="当前处理状态"
    )
    retry_count: int = Field(default=0)
    handler_name: Optional[str] = Field(None, description="分配的 Handler")
```

---

## 4. API 接口设计

### 4.1 统一回调接收接口

#### `POST /api/v1/webhook/{channel_code}`

所有外部系统的回调统一入口。`{channel_code}` 标识来源渠道。

**请求格式**：各渠道原始格式，UWC 不做任何前置转换。

**响应格式**（统一）：

```json
{
    "code": 0,
    "message": "success",
    "data": {
        "webhook_id": "01JZ..."
    }
}
```

**注意**：不同渠道对 ACK 响应的格式要求不同：

| 渠道 | 期望响应 | HTTP 状态码 |
|------|---------|-------------|
| 微信支付 | `{"code": "SUCCESS", "message": "成功"}` | 200 |
| 支付宝 | `success` (纯文本) | 200 |
| Apple IAP | JWT 格式通知 | 200 |
| Google Play | 空响应即可 | 200 |
| 通用/自定义 | 标准 JSON | 200 |

UWC 通过 **AckStrategy** 策略模式处理此差异。

**处理时序**：

```text
外部服务 ──POST──> UWC API
                    │
                    ├─ 1. 解析 Raw Body + Headers
                    ├─ 2. 渠道存在性检查
                    ├─ 3. IP 白名单检查（可选）
                    ├─ 4. 限流检查（per channel）
                    ├─ 5. 签名/时间窗口验证
                    ├─ 6. Redis 快速幂等检查
                    ├─ 7. MySQL 持久化 webhook_record
                    ├─ 8. 标准化 (Normalizer)
                    ├─ 9. 写入 Redis Stream
                    └─ 10. 返回渠道特定 ACK
                         │
                    总耗时 < 200ms（目标）
```

### 4.2 管理后台接口

#### `GET /api/v1/admin/webhooks` — 回调记录列表

```text
查询参数:
  channel_code   (可选) 渠道编码筛选
  status         (可选) 状态筛选
  event_type     (可选) 事件类型筛选
  start_time     (可选) 开始时间
  end_time       (可选) 结束时间
  page           页码，默认 1
  page_size      每页条数，默认 20，最大 100
```

响应：
```json
{
    "code": 0,
    "data": {
        "total": 15234,
        "items": [
            {
                "webhook_id": "01JZ...",
                "channel_code": "wechat_pay",
                "event_type": "payment.success",
                "status": "SUCCESS",
                "retry_count": 0,
                "received_at": "2026-06-24T10:30:00.123Z",
                "processed_at": "2026-06-24T10:30:01.456Z"
            }
        ]
    }
}
```

#### `GET /api/v1/admin/webhooks/{webhook_id}` — 回调详情

返回完整记录，包括原始 Headers、Body、重试日志。

#### `POST /api/v1/admin/webhooks/{webhook_id}/retry` — 手动重试

将指定回调重新投递到事件流，状态重置为 `DISPATCHED`。

#### `POST /api/v1/admin/webhooks/{webhook_id}/dead-letter/reprocess` — 死信重处理

从死信表中取出回调，重新走分发流程。

#### `GET /api/v1/admin/webhooks/stats` — 统计概览

```json
{
    "code": 0,
    "data": {
        "today_total": 8532,
        "today_success": 8501,
        "today_failed": 28,
        "today_dead": 3,
        "by_channel": {
            "wechat_pay": {"total": 3200, "success_rate": 0.998},
            "alipay": {"total": 2100, "success_rate": 0.999},
            "apple_iap": {"total": 1500, "success_rate": 0.995},
            "ai_provider": {"total": 1732, "success_rate": 0.997}
        },
        "avg_process_ms": 145,
        "p99_process_ms": 890
    }
}
```

### 4.3 渠道注册接口

#### `POST /api/v1/admin/webhook-channels` — 注册新渠道

```json
{
    "channel_code": "huawei_push",
    "channel_name": "华为推送回执",
    "channel_category": "notification",
    "verifier_type": "hmac_sha256",
    "verifier_config": {
        "secret_key_ref": "kms://webhook/huawei_push/secret",
        "header_signature": "X-Huawei-Signature",
        "header_timestamp": "X-Huawei-Timestamp"
    },
    "replay_window_sec": 300,
    "rate_limit_per_min": 500,
    "ack_strategy": {
        "type": "json",
        "template": {"code": 0, "message": "success"}
    },
    "normalizer_class": "app.webhook.normalizers.HuaweiPushNormalizer",
    "handler_class": "app.webhook.handlers.NotificationHandler"
}
```

---

## 5. 核心处理流程

### 5.1 回调接收处理流程（详细伪代码）

```python
async def handle_webhook(
    channel_code: str,
    request: Request,
    trace_id: str,
) -> WebhookEvent:
    """
    Webhook 接收主流程，从 HTTP 入口到事件分发。
    任何步骤失败都会记录日志并返回错误响应。
    """

    # ── Step 1: 获取渠道配置 ──
    channel = await channel_registry.get(channel_code)
    if channel is None or not channel.is_active:
        raise WebhookError("CHANNEL_NOT_FOUND", f"Unknown channel: {channel_code}")

    # 保存原始数据（重要：在验证之前保存，便于安全审计）
    raw_body = await request.body()
    raw_headers = dict(request.headers)
    client_ip = request.client.host

    # ── Step 2: 限流检查 ──
    allowed = await rate_limiter.check(
        key=f"webhook:ratelimit:{channel_code}",
        limit=channel.rate_limit_per_min,
        window_sec=60,
    )
    if not allowed:
        raise WebhookError("RATE_LIMITED", f"Channel {channel_code} rate limited")

    # ── Step 3: 签名验证 ──
    verifier = verifier_registry.get(channel.verifier_type)
    verify_result = await verifier.verify(
        headers=raw_headers,
        body=raw_body,
        config=channel.verifier_config,
    )
    if not verify_result.is_valid:
        # 记录安全日志，返回 200 避免泄露信息（但标记为 REJECTED）
        await security_audit_logger.log_rejection(
            channel_code, raw_headers, raw_body,
            reason=verify_result.reason, client_ip=client_ip,
        )
        raise WebhookError("SIGNATURE_INVALID", verify_result.reason)

    # ── Step 4: 防重放时间窗口检查 ──
    timestamp_str = verifier.extract_timestamp(raw_headers, channel.verifier_config)
    if timestamp_str is not None:
        callback_time = datetime.fromtimestamp(int(timestamp_str), tz=timezone.utc)
        age_seconds = abs((datetime.now(timezone.utc) - callback_time).total_seconds())
        if age_seconds > channel.replay_window_sec:
            raise WebhookError(
                "REPLAY_EXPIRED",
                f"Callback timestamp exceeds replay window: {age_seconds}s > {channel.replay_window_sec}s"
            )

    # ── Step 5: 标准化 ──
    normalizer = normalizer_registry.get(channel_code)
    event = await normalizer.normalize(
        raw_body=raw_body,
        raw_headers=raw_headers,
        channel=channel,
    )
    # 补充元数据
    event.webhook_id = generate_ulid()
    event.client_ip = client_ip
    event.received_at = datetime.now(timezone.utc)
    event.trace_id = trace_id

    # ── Step 6: 幂等检查（Redis 快速判重 + MySQL 精确判重）──
    # Redis 快速路径
    exists = await redis_client.get(f"webhook:dedup:{event.idempotency_key}")
    if exists is not None:
        # 已处理过，直接返回成功（幂等）
        logger.info("webhook_duplicate", webhook_id=exists, idempotency_key=event.idempotency_key)
        return await webhook_record_repo.get(exists)

    # ── Step 7: MySQL 持久化（包含唯一约束兜底幂等）──
    try:
        await webhook_record_repo.insert(event)
    except IntegrityError:  # uk_idempotency_key 冲突
        existing = await webhook_record_repo.get_by_idempotency_key(event.idempotency_key)
        logger.info("webhook_duplicate_db", webhook_id=existing.webhook_id)
        return existing

    # Redis 写入幂等标记
    await redis_client.setex(
        f"webhook:dedup:{event.idempotency_key}",
        value=event.webhook_id,
        expire=channel.replay_window_sec * 2,
    )

    # ── Step 8: 分发到事件流 ──
    await event_dispatcher.dispatch(event)
    await webhook_record_repo.update_status(event.webhook_id, WebhookStatus.DISPATCHED)

    return event
```

### 5.2 事件分发与消费流程

```python
# ── Producer: 写入 Redis Stream ──
class EventDispatcher:
    """将校验通过的 Webhook 事件分发到 Redis Stream"""

    STREAM_KEY = "webhook:events"
    CONSUMER_GROUP = "webhook-handlers"

    async def dispatch(self, event: WebhookEvent) -> None:
        fields = {
            "webhook_id": event.webhook_id,
            "channel_code": event.channel_code,
            "event_type": event.event_type,
            "trace_id": event.trace_id,
            "dispatched_at": datetime.now(timezone.utc).isoformat(),
        }
        await redis_client.xadd(self.STREAM_KEY, fields, maxlen=100000)
        logger.info("webhook_dispatched", webhook_id=event.webhook_id, event_type=event.event_type)


# ── Consumer: Celery Worker 处理 ──
@celery_app.task(
    name="webhook.handle_event",
    bind=True,
    max_retries=5,
    autoretry_for=(HandlerError,),
    retry_backoff=True,           # 指数退避: 1s, 2s, 4s, 8s, 16s
    retry_backoff_max=300,        # 最大退避 5 分钟
    retry_jitter=True,            # 添加抖动防止惊群
    acks_late=True,               # 任务完成后才 ACK，保证 at-least-once
)
def handle_event(self, webhook_id: str) -> dict:
    """
    Webhook 事件处理 Celery 任务。
    被 Redis Stream Consumer 触发。
    """
    trace_id = get_trace_from_webhook(webhook_id)
    with tracer.start_as_current_span("webhook.handle_event", attributes={"webhook_id": webhook_id}):
        try:
            # 获取记录
            record = webhook_record_repo.get(webhook_id)
            if record is None:
                logger.error("webhook_not_found", webhook_id=webhook_id)
                return {"status": "NOT_FOUND"}

            # 幂等检查（双保险：如果状态已是 SUCCESS，跳过）
            if record.status == WebhookStatus.SUCCESS:
                logger.info("webhook_already_processed", webhook_id=webhook_id)
                return {"status": "ALREADY_PROCESSED"}

            # 标记为处理中
            webhook_record_repo.update_status(webhook_id, WebhookStatus.PROCESSING)

            # 路由到对应 Handler
            handler = handler_registry.get(record.channel_code, record.event_type)
            if handler is None:
                raise HandlerError(
                    "HANDLER_NOT_FOUND",
                    f"No handler for channel={record.channel_code} event_type={record.event_type}"
                )

            # 执行 Handler
            start = time.monotonic()
            result = handler.handle(record)
            elapsed_ms = int((time.monotonic() - start) * 1000)

            # 记录成功
            webhook_record_repo.mark_success(webhook_id, handler_name=handler.__class__.__name__)
            webhook_retry_log_repo.log_retry(webhook_id, self.request.retries + 1,
                                              handler_name=handler.__class__.__name__,
                                              result="SUCCESS", execution_ms=elapsed_ms)

            metrics.increment("webhook.handler.success",
                              tags=[f"channel:{record.channel_code}", f"event:{record.event_type}"])
            metrics.timing("webhook.handler.duration", elapsed_ms,
                           tags=[f"channel:{record.channel_code}"])

            return {"status": "SUCCESS", "webhook_id": webhook_id}

        except RecoverableHandlerError as e:
            # 可重试错误（如下游服务暂时不可用）
            metrics.increment("webhook.handler.recoverable_error",
                              tags=[f"channel:{record.channel_code}"])
            webhook_record_repo.update_error(webhook_id, error_code=e.code, error_message=str(e))
            webhook_retry_log_repo.log_retry(webhook_id, self.request.retries + 1,
                                              handler_name=handler.__class__.__name__,
                                              result="FAILED", error_code=e.code)
            raise self.retry(exc=e)

        except FatalHandlerError as e:
            # 不可重试错误（如数据格式错误、业务规则违反）
            logger.error("webhook_fatal_error", webhook_id=webhook_id, error=str(e))
            webhook_record_repo.mark_dead(webhook_id, error_code=e.code, error_message=str(e))
            metrics.increment("webhook.handler.fatal_error",
                              tags=[f"channel:{record.channel_code}"])
            return {"status": "DEAD", "reason": str(e)}

        except Exception as e:
            # 未知错误，记录后重试
            logger.exception("webhook_unknown_error", webhook_id=webhook_id)
            metrics.increment("webhook.handler.unknown_error",
                              tags=[f"channel:{record.channel_code}"])
            raise self.retry(exc=e)
```

### 5.3 状态流转图

```text
                         ┌──────────────────────────────────────────────────┐
                         │                                                  │
                         ▼                                                  │
    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐          │
    │ RECEIVED │───>│ VERIFIED │───>│DISPATCHED│───>│PROCESSING│          │
    └──────────┘    └──────────┘    └──────────┘    └────┬─────┘          │
         │               │                                │                │
         │ 签名失败       │ 标准化失败                     │                │
         ▼               ▼                                ├──成功────────> │
    ┌──────────┐    ┌──────────┐                          │   ┌──────┐    │
    │ REJECTED │    │ REJECTED │                          │   │SUCCESS│    │
    └──────────┘    └──────────┘                          │   └──────┘    │
                                                        可重试失败         │
                                                          │   ┌─────┐     │
                                                          ├──>│FAILED│─────┘
                                                          │   └──┬──┘     │
                                                          │      │        │ 重试次数
                                                          │      │ 重试    │ 用尽
                                                          │      ▼        │
                                                          │  ┌──────┐    │
                                                          └─>│ DEAD │    │
                                                             └──────┘    │
                                                                          │
                                          手动重处理                        │
                                          ┌────────┐                        │
                                          │  DEAD  │──手动reprocess──> DISPATCHED
                                          └────────┘                        │
                                                                            │
```

---

## 6. 签名验证器设计

### 6.1 Verifier Registry（策略模式）

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class VerifyResult:
    is_valid: bool
    reason: str = ""
    timestamp: Optional[int] = None  # 从请求中提取的时间戳


class BaseVerifier(ABC):
    """签名验证器基类"""

    @abstractmethod
    async def verify(
        self,
        headers: dict[str, str],
        body: bytes,
        config: dict,
    ) -> VerifyResult:
        ...

    def extract_timestamp(
        self, headers: dict[str, str], config: dict
    ) -> Optional[int]:
        """从请求头提取时间戳，用于防重放检查"""
        ts_header = config.get("header_timestamp")
        if ts_header and ts_header in headers:
            try:
                return int(headers[ts_header])
            except ValueError:
                return None
        return None


class VerifierRegistry:
    """签名验证器注册中心"""

    def __init__(self):
        self._verifiers: dict[str, BaseVerifier] = {}

    def register(self, verifier_type: str, verifier: BaseVerifier) -> None:
        self._verifiers[verifier_type] = verifier

    def get(self, verifier_type: str) -> BaseVerifier:
        verifier = self._verifiers.get(verifier_type)
        if verifier is None:
            raise ValueError(f"Unknown verifier type: {verifier_type}")
        return verifier


# ── 全局注册表 ──
verifier_registry = VerifierRegistry()
```

### 6.2 内置验证器实现

#### 6.2.1 HMAC-SHA256（微信支付等）

```python
import hashlib
import hmac


class HMACSHA256Verifier(BaseVerifier):
    """HMAC-SHA256 签名验证器，适用于微信支付等"""

    async def verify(self, headers, body, config) -> VerifyResult:
        # 微信支付签名在头或体中
        signature = headers.get(config["header_signature"]) or \
                    _extract_from_json(body, config.get("body_signature_field"))
        if not signature:
            return VerifyResult(is_valid=False, reason="Signature not found")

        secret = await kms_client.get_secret(config["secret_key_ref"])

        # 微信支付 V3: 对 timestamp\nnonce\nbody 做 HMAC-SHA256
        timestamp = headers.get(config["header_timestamp"], "")
        nonce = headers.get(config["header_nonce"], "")
        message = f"{timestamp}\n{nonce}\n".encode() + body

        expected = hmac.new(
            secret.encode(), message, hashlib.sha256
        ).hexdigest()

        if hmac.compare_digest(expected, signature):
            return VerifyResult(is_valid=True, timestamp=int(timestamp) if timestamp else None)
        return VerifyResult(is_valid=False, reason="HMAC signature mismatch")


verifier_registry.register("hmac_sha256", HMACSHA256Verifier())
```

#### 6.2.2 RSA-SHA256（支付宝等）

```python
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
import base64


class RSASHA256Verifier(BaseVerifier):
    """RSA-SHA256 签名验证器，适用于支付宝"""

    async def verify(self, headers, body, config) -> VerifyResult:
        signature_b64 = headers.get(config["header_signature"], "")
        if not signature_b64:
            return VerifyResult(is_valid=False, reason="Signature header missing")

        public_key_pem = await kms_client.get_secret(config["public_key_ref"])
        public_key = serialization.load_pem_public_key(public_key_pem.encode())

        # 支付宝签名是对特定字段拼接后的签名
        sign_data = _extract_alipay_sign_data(body, config)

        try:
            public_key.verify(
                base64.b64decode(signature_b64),
                sign_data.encode(),
                padding.PKCS1v15(),
                hashes.SHA256(),
            )
            return VerifyResult(is_valid=True)
        except Exception:
            return VerifyResult(is_valid=False, reason="RSA signature verification failed")


verifier_registry.register("rsa_sha256", RSASHA256Verifier())
```

#### 6.2.3 Apple JWT（Apple IAP V2）

```python
import jwt


class AppleJWTVerifier(BaseVerifier):
    """Apple App Store Server Notifications V2 JWT 验证"""

    APPLE_ROOT_CA_URL = "https://www.apple.com/certificateauthority/AppleRootCA-G3.cer"

    async def verify(self, headers, body, config) -> VerifyResult:
        try:
            # Apple V2 通知是 JWT 格式
            token = body.decode("utf-8").strip()
            unverified_header = jwt.get_unverified_header(token)

            # 获取 Apple 公钥（JWKS 缓存）
            jwks = await apple_jwks_cache.get(unverified_header["kid"])

            # 验证 JWT 签名
            payload = jwt.decode(
                token,
                key=jwks,
                algorithms=["ES256"],
                audience=config["bundle_id"],
                options={"verify_aud": True},
            )

            return VerifyResult(
                is_valid=True,
                timestamp=payload.get("signedDate", 0) // 1000,  # ms → s
            )
        except jwt.PyJWTError as e:
            return VerifyResult(is_valid=False, reason=f"JWT verification failed: {e}")


verifier_registry.register("apple_jwt", AppleJWTVerifier())
```

#### 6.2.4 Google Ed25519（Google Play Real-time Developer Notifications）

```python
from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError
import base64


class GooglePubKeyVerifier(BaseVerifier):
    """Google Play RTDN 使用 Ed25519 签名"""

    async def verify(self, headers, body, config) -> VerifyResult:
        signature_b64 = headers.get("X-Goog-Signature", "")
        if not signature_b64:
            return VerifyResult(is_valid=False, reason="Google signature missing")

        # 从 Google 获取公钥（缓存 24h）
        public_key_b64 = await google_key_cache.get(config["project_id"])
        verify_key = VerifyKey(base64.b64decode(public_key_b64))

        try:
            verify_key.verify(body, base64.b64decode(signature_b64))
            return VerifyResult(is_valid=True)
        except BadSignatureError:
            return VerifyResult(is_valid=False, reason="Ed25519 signature mismatch")


verifier_registry.register("google_pubkey", GooglePubKeyVerifier())
```

---

## 7. 标准化处理器（Normalizer）

每个渠道的回调数据格式不同，Normalizer 负责将其转换为统一的 `WebhookEvent` 对象。

### 7.1 Normalizer 基类与注册

```python
from abc import ABC, abstractmethod
import hashlib


class BaseNormalizer(ABC):
    """回调数据标准化器基类"""

    @abstractmethod
    async def normalize(
        self,
        raw_body: bytes,
        raw_headers: dict[str, str],
        channel: WebhookChannel,
    ) -> WebhookEvent:
        ...

    def _build_idempotency_key(
        self, channel_code: str, external_id: str, event_type: str
    ) -> str:
        raw = f"{channel_code}:{external_id}:{event_type}"
        return hashlib.sha256(raw.encode()).hexdigest()


class NormalizerRegistry:
    def __init__(self):
        self._normalizers: dict[str, BaseNormalizer] = {}

    def register(self, channel_code: str, normalizer: BaseNormalizer) -> None:
        self._normalizers[channel_code] = normalizer

    def get(self, channel_code: str) -> BaseNormalizer:
        n = self._normalizers.get(channel_code)
        if n is None:
            raise ValueError(f"No normalizer for channel: {channel_code}")
        return n


normalizer_registry = NormalizerRegistry()
```

### 7.2 微信支付 Normalizer 示例

```python
import json
from datetime import datetime, timezone


class WechatPayNormalizer(BaseNormalizer):
    """微信支付 V3 回调标准化"""

    async def normalize(self, raw_body, raw_headers, channel) -> WebhookEvent:
        data = json.loads(raw_body)
        resource = data.get("resource", {})

        # 微信 V3 回调中正文是加密的，需要解密
        # 这里假设 Verifier 已经验证了签名，解密在 Normalizer 中进行
        ciphertext = resource.get("ciphertext", "")
        nonce = resource.get("nonce", "")
        associated_data = resource.get("associated_data", "")
        api_key = await kms_client.get_secret("kms://webhook/wechat_pay/api_v3_key")

        decrypted = aes_gcm_decrypt(api_key, ciphertext, nonce, associated_data)
        payload = json.loads(decrypted)

        # 映射事件类型
        event_type_map = {
            "TRANSACTION.SUCCESS": "payment.success",
            "TRANSACTION.FAIL": "payment.failed",
            "REFUND.SUCCESS": "payment.refund.success",
            "REFUND.ABNORMAL": "payment.refund.abnormal",
        }
        event_type = event_type_map.get(
            data.get("event_type"), f"wechat_pay.{data.get('event_type', 'unknown').lower()}"
        )

        external_id = payload.get("transaction_id") or payload.get("refund_id") or data.get("id")
        idempotency_key = self._build_idempotency_key(
            channel.channel_code, external_id, event_type
        )

        return WebhookEvent(
            webhook_id="",  # 由调用方填充 ULID
            channel_code=channel.channel_code,
            external_event_id=external_id,
            event_type=event_type,
            event_subtype=payload.get("trade_state", ""),
            idempotency_key=idempotency_key,
            raw_headers=raw_headers,
            raw_body=raw_body.decode("utf-8"),
            parsed_payload=payload,
            client_ip="",  # 由调用方填充
            received_at=datetime.now(timezone.utc),
            trace_id="",  # 由调用方填充
            status=WebhookStatus.VERIFIED,
        )


normalizer_registry.register("wechat_pay", WechatPayNormalizer())
```

### 7.3 各渠道事件类型映射表

| 渠道 | 外部事件 | 标准化 event_type | 说明 |
|------|---------|-------------------|------|
| wechat_pay | TRANSACTION.SUCCESS | payment.success | 支付成功 |
| wechat_pay | REFUND.SUCCESS | payment.refund.success | 退款成功 |
| wechat_pay | REFUND.ABNORMAL | payment.refund.abnormal | 退款异常 |
| alipay | TRADE_SUCCESS (notify_type=trade_status_sync) | payment.success | 交易成功 |
| alipay | TRADE_CLOSED | payment.closed | 交易关闭 |
| apple_iap | DID_RENEW | subscription.renewed | 订阅续期 |
| apple_iap | DID_FAIL_TO_RENEW | subscription.renewal_failed | 续期失败 |
| apple_iap | REFUND | payment.refund.success | 退款 |
| google_play | 1 (SUBSCRIPTION_RECOVERED) | subscription.recovered | 订阅恢复 |
| google_play | 2 (SUBSCRIPTION_RENEWED) | subscription.renewed | 订阅续期 |
| google_play | 12 (SUBSCRIPTION_REVOKED) | subscription.revoked | 订阅被撤销 |
| ai_provider | task.completed | ai.task_complete | 异步AI任务完成 |
| ai_provider | task.failed | ai.task_failed | 异步AI任务失败 |
| sms_gateway | delivered | notification.delivered | 短信送达 |
| push_gateway | delivered | push.delivered | 推送送达 |
| push_gateway | failed | push.failed | 推送失败 |

---

## 8. Handler 设计（业务处理器）

### 8.1 Handler 基类与注册

```python
from abc import ABC, abstractmethod


class BaseHandler(ABC):
    """Webhook 业务处理器基类"""

    @abstractmethod
    def handle(self, record: WebhookRecord) -> dict:
        """
        处理回调事件，返回处理结果。

        异常规范:
        - RecoverableHandlerError: 临时故障，可重试
        - FatalHandlerError: 数据错误或业务规则违反，不可重试
        - 其他异常: 视为可重试
        """
        ...


class HandlerRegistry:
    """Handler 注册中心，支持按 channel + event_type 路由"""

    def __init__(self):
        # 二级路由: {channel_code: {event_type: handler}}
        self._handlers: dict[str, dict[str, BaseHandler]] = {}
        # 通配符路由: {channel_code: handler}（处理该渠道所有事件类型）
        self._wildcard_handlers: dict[str, BaseHandler] = {}

    def register(
        self,
        channel_code: str,
        event_type: str | None,
        handler: BaseHandler,
    ) -> None:
        if event_type is None:
            self._wildcard_handlers[channel_code] = handler
        else:
            self._handlers.setdefault(channel_code, {})[event_type] = handler

    def get(
        self, channel_code: str, event_type: str
    ) -> BaseHandler | None:
        # 精确匹配优先
        handler = self._handlers.get(channel_code, {}).get(event_type)
        if handler is not None:
            return handler
        # 通配符兜底
        return self._wildcard_handlers.get(channel_code)


handler_registry = HandlerRegistry()
```

### 8.2 支付回调 Handler 示例

```python
from app.services.payment_service import PaymentService


class WechatPayHandler(BaseHandler):
    """微信支付回调处理器"""

    def __init__(self):
        self.payment_service = PaymentService()

    def handle(self, record: WebhookRecord) -> dict:
        payload = record.parsed_payload
        out_trade_no = payload.get("out_trade_no")
        transaction_id = payload.get("transaction_id")
        trade_state = payload.get("trade_state")

        if not out_trade_no:
            raise FatalHandlerError("MISSING_ORDER_NO", "out_trade_no not found in payload")

        if record.event_type == "payment.success":
            # 调用支付服务更新订单状态
            result = self.payment_service.confirm_payment(
                order_no=out_trade_no,
                transaction_id=transaction_id,
                channel="wechat_pay",
                raw_payload=payload,
            )
            return {"action": "payment_confirmed", "order_id": result.order_id}

        elif record.event_type == "payment.refund.success":
            result = self.payment_service.confirm_refund(
                order_no=out_trade_no,
                refund_id=payload.get("refund_id"),
                raw_payload=payload,
            )
            return {"action": "refund_confirmed", "refund_id": result.refund_id}

        # 未识别的事件类型
        raise FatalHandlerError(
            "UNHANDLED_EVENT_TYPE",
            f"Unhandled event_type: {record.event_type} for wechat_pay"
        )


# 注册
handler_registry.register("wechat_pay", "payment.success", WechatPayHandler())
handler_registry.register("wechat_pay", "payment.refund.success", WechatPayHandler())
```

### 8.3 AI 异步回调 Handler 示例

```python
from app.services.ai_service import AIService


class AIProviderHandler(BaseHandler):
    """AI 供应商异步任务回调处理器"""

    def __init__(self):
        self.ai_service = AIService()

    def handle(self, record: WebhookRecord) -> dict:
        payload = record.parsed_payload
        task_id = payload.get("task_id")
        status = payload.get("status")

        if not task_id:
            raise FatalHandlerError("MISSING_TASK_ID", "task_id not found")

        if record.event_type == "ai.task_complete":
            result_data = payload.get("result", {})
            self.ai_service.save_async_result(
                task_id=task_id,
                result=result_data,
                provider=record.channel_code,
            )
            return {"action": "ai_result_saved", "task_id": task_id}

        elif record.event_type == "ai.task_failed":
            error_info = payload.get("error", {})
            self.ai_service.mark_task_failed(
                task_id=task_id,
                error_code=error_info.get("code", "UNKNOWN"),
                error_message=error_info.get("message", ""),
            )
            return {"action": "ai_task_marked_failed", "task_id": task_id}

        raise FatalHandlerError(
            "UNHANDLED_EVENT_TYPE",
            f"Unhandled event_type: {record.event_type} for ai_provider"
        )


handler_registry.register("ai_provider", "ai.task_complete", AIProviderHandler())
handler_registry.register("ai_provider", "ai.task_failed", AIProviderHandler())
```

### 8.4 推送送达回执 Handler 示例

```python
class PushDeliveryHandler(BaseHandler):
    """推送服务送达/失败回执处理器"""

    def handle(self, record: WebhookRecord) -> dict:
        payload = record.parsed_payload
        message_id = payload.get("message_id")
        device_token = payload.get("device_token")

        if not message_id:
            raise FatalHandlerError("MISSING_MESSAGE_ID", "message_id not found")

        if record.event_type == "push.delivered":
            notify_service.mark_delivered(message_id, device_token)
            return {"action": "push_marked_delivered"}

        elif record.event_type == "push.failed":
            failure_reason = payload.get("failure_reason", "unknown")
            is_permanent = payload.get("permanent_failure", False)
            if is_permanent:
                # 永久失败：设备 token 失效，从推送列表中移除
                notify_service.invalidate_device_token(device_token, reason=failure_reason)
            notify_service.mark_failed(message_id, reason=failure_reason)
            return {"action": "push_marked_failed", "permanent": is_permanent}

        raise FatalHandlerError("UNHANDLED", f"Unknown push event: {record.event_type}")


handler_registry.register("push_gateway", "push.delivered", PushDeliveryHandler())
handler_registry.register("push_gateway", "push.failed", PushDeliveryHandler())
```

---

## 9. ACK 策略设计

不同外部系统对回调响应的格式要求不同，UWC 通过 AckStrategy 模式处理。

```python
from abc import ABC, abstractmethod


class AckStrategy(ABC):
    """回调响应策略"""

    @abstractmethod
    def build_response(self, webhook_id: str | None = None) -> tuple[Any, int]:
        """返回 (response_body, status_code)"""
        ...


class JsonAckStrategy(AckStrategy):
    """标准 JSON ACK"""

    def __init__(self, template: dict | None = None):
        self.template = template or {"code": 0, "message": "success"}

    def build_response(self, webhook_id=None):
        return self.template, 200


class TextAckStrategy(AckStrategy):
    """纯文本 ACK（支付宝用）"""

    def __init__(self, text: str = "success"):
        self.text = text

    def build_response(self, webhook_id=None):
        return self.text, 200


class WechatAckStrategy(AckStrategy):
    """微信支付 ACK 格式"""

    def build_response(self, webhook_id=None):
        return {"code": "SUCCESS", "message": "成功"}, 200


class AppleAckStrategy(AckStrategy):
    """Apple IAP V2 ACK"""

    def build_response(self, webhook_id=None):
        return "", 200  # Apple 只需 200 状态码


class AckStrategyFactory:
    @staticmethod
    def create(strategy_config: dict) -> AckStrategy:
        strategy_type = strategy_config.get("type", "json")
        if strategy_type == "json":
            return JsonAckStrategy(strategy_config.get("template"))
        elif strategy_type == "text":
            return TextAckStrategy(strategy_config.get("text", "success"))
        elif strategy_type == "wechat":
            return WechatAckStrategy()
        elif strategy_type == "apple":
            return AppleAckStrategy()
        raise ValueError(f"Unknown ACK strategy type: {strategy_type}")
```

---

## 10. 错误处理与重试策略

### 10.1 错误分类

| 错误类别 | 错误码 | 处理方式 | 是否重试 |
|---------|--------|---------|---------|
| 渠道不存在 | CHANNEL_NOT_FOUND | 返回 404，记录安全日志 | 否 |
| 限流 | RATE_LIMITED | 返回 429，记录监控 | 否 |
| 签名失败 | SIGNATURE_INVALID | 返回 200（避免泄露），记录安全审计 | 否 |
| 时间窗口过期 | REPLAY_EXPIRED | 返回 200，记录日志 | 否 |
| 幂等重复 | DUPLICATE_CALLBACK | 返回 200 ACK，不重新处理 | 否 |
| Handler 未找到 | HANDLER_NOT_FOUND | 标记 DEAD，告警 | 否 |
| Handler 可恢复错误 | RECOVERABLE_* | 标记 FAILED，重试 | 是 |
| Handler 致命错误 | FATAL_* | 标记 DEAD，告警 | 否 |
| Handler 未知异常 | UNKNOWN | 标记 FAILED，重试 | 是 |

### 10.2 重试策略

```python
from datetime import timedelta


# Celery 任务重试配置
WEBHOOK_RETRY_CONFIG = {
    "max_retries": 5,
    "retry_backoff": True,        # 指数退避
    "retry_backoff_max": 300,     # 最大退避 5 分钟
    "retry_jitter": True,         # 添加随机抖动

    # 退避序列（含抖动，实际值在 ±25% 范围波动）:
    # 第1次重试: ~1s
    # 第2次重试: ~2s
    # 第3次重试: ~4s
    # 第4次重试: ~8s
    # 第5次重试: ~16s
    # 总耗时上限: ~31s（不含处理时间）
}


# 对于 Handler 级别的自定义重试（独立于 Celery）
HANDLER_RETRY_DELAYS = [
    timedelta(seconds=10),     # 第1次：10s
    timedelta(seconds=30),     # 第2次：30s
    timedelta(minutes=1),      # 第3次：1min
    timedelta(minutes=5),      # 第4次：5min
    timedelta(minutes=15),     # 第5次：15min
]
```

### 10.3 死信处理流程

```python
def move_to_dead_letter(webhook_id: str, error_code: str, error_message: str):
    """将重试耗尽的回调移入死信表"""

    record = webhook_record_repo.get(webhook_id)
    if record is None:
        return

    # 创建死信记录
    dead_letter_repo.create(
        webhook_id=webhook_id,
        channel_code=record.channel_code,
        event_type=record.event_type,
        original_record=record.to_dict(),
        last_error_code=error_code,
        last_error_message=error_message,
        total_retries=record.retry_count,
    )

    # 更新主记录状态
    webhook_record_repo.update_status(webhook_id, WebhookStatus.DEAD)

    # 触发告警
    alert_manager.send(
        level="WARNING",
        title=f"Webhook 死信告警: {record.channel_code}/{record.event_type}",
        message=f"webhook_id={webhook_id}, error={error_code}: {error_message}",
        tags=["webhook", "dead-letter", record.channel_code],
        # 按渠道聚合，避免告警风暴
        group_key=f"webhook-dead-{record.channel_code}-{record.event_type}",
    )
```

---

## 11. 安全设计

### 11.1 安全分层

```text
┌──────────────────────────────────────────────────────────┐
│                     L1: 网络层                            │
│  • WAF 规则：只允许已知渠道 IP 段访问回调路径             │
│  • DDoS 防护：Cloudflare / 云厂商 DDoS 清洗              │
│  • TLS 1.2+ 强制：所有回调必须 HTTPS                     │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│                     L2: 应用层                            │
│  • 渠道路由校验：channel_code 必须已注册且 active         │
│  • 限流保护：per-channel 限流 + 全局限流                 │
│  • 请求大小限制：Body 最大 1MB                            │
│  • Header 数量限制：最多 50 个                            │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│                     L3: 密码学层                          │
│  • 签名验证：每条回调必须通过签名验证                     │
│  • 时间窗口：回调时间戳偏差不超过 replay_window_sec       │
│  • Nonce 去重（如渠道支持）：防止重放攻击                 │
│  • 密钥管理：所有密钥通过 KMS 引用，不硬编码              │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│                     L4: 业务层                            │
│  • 幂等保证：同一回调只处理一次                           │
│  • Handler 隔离：渠道间故障隔离                           │
│  • 敏感数据脱敏：日志中不记录完整卡号、手机号等           │
│  • 审计日志：所有回调留存 90 天，含原始请求              │
└──────────────────────────────────────────────────────────┘
```

### 11.2 IP 白名单配置

```python
# 各渠道已知 IP 段（定期更新）
CHANNEL_IP_WHITELIST = {
    "wechat_pay": [
        # 微信支付回调 IP 段（需从官方文档获取最新值）
        # 参考: https://pay.weixin.qq.com/doc/v3/merchant/4012791522
    ],
    "alipay": [
        # 支付宝回调 IP 段
    ],
    # Apple 和 Google 不提供固定 IP 段，依赖签名验证
}

# IP 白名单检查（可选，取决于渠道是否提供 IP 列表）
async def check_ip_whitelist(channel_code: str, client_ip: str) -> bool:
    whitelist = CHANNEL_IP_WHITELIST.get(channel_code)
    if not whitelist:
        return True  # 未配置白名单则跳过
    return ip_in_ranges(client_ip, whitelist)
```

### 11.3 敏感信息处理

```python
SENSITIVE_HEADER_KEYS = {"authorization", "cookie", "x-api-key"}
SENSITIVE_BODY_PATTERNS = [
    r"\d{16,19}",          # 银行卡号
    r"1[3-9]\d{9}",        # 中国手机号
]


def sanitize_for_logging(headers: dict, body: str) -> tuple[dict, str]:
    """脱敏处理，用于日志和审计"""
    safe_headers = {
        k: ("***REDACTED***" if k.lower() in SENSITIVE_HEADER_KEYS else v)
        for k, v in headers.items()
    }
    safe_body = body
    for pattern in SENSITIVE_BODY_PATTERNS:
        safe_body = re.sub(pattern, "***REDACTED***", safe_body)
    return safe_headers, safe_body
```

---

## 12. 监控与告警

### 12.1 核心指标

| 指标名 | 类型 | 说明 | 告警阈值 |
|--------|------|------|---------|
| webhook.receive.total | Counter | 回调接收总数（按渠道） | — |
| webhook.verify.failed | Counter | 签名验证失败数 | >10/min |
| webhook.duplicate | Counter | 幂等重复回调数 | — |
| webhook.dispatch.latency | Histogram | 从接收到分发的延迟 | p99 > 500ms |
| webhook.handler.duration | Histogram | Handler 处理耗时（按渠道+事件） | p99 > 5s |
| webhook.handler.success_rate | Gauge | Handler 成功率（按渠道） | < 99.5% |
| webhook.retry.count | Counter | 重试次数 | 增长率 > 50%/h |
| webhook.dead_letter.count | Counter | 死信数 | > 0 |
| webhook.queue.lag | Gauge | Stream 消费延迟 | > 60s |
| webhook.replay.expired | Counter | 时间窗口过期拒绝数 | > 5/min |

### 12.2 告警规则

```yaml
# Prometheus AlertManager 规则
groups:
  - name: webhook-alerts
    rules:
      - alert: WebhookSignatureFailureSpike
        expr: rate(webhook_verify_failed_total[5m]) > 10
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Webhook signature verification failures spike"
          description: "{{ $value }} failures/min on channel {{ $labels.channel }}"

      - alert: WebhookDeadLetter
        expr: increase(webhook_dead_letter_total[1h]) > 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Webhook entered dead letter queue"
          description: "Channel {{ $labels.channel }}, event {{ $labels.event_type }}"

      - alert: WebhookQueueBacklog
        expr: webhook_queue_lag_seconds > 60
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Webhook processing queue backlog"
          description: "{{ $value }}s behind, consumers may be down"

      - alert: WebhookHandlerSuccessRateLow
        expr: webhook_handler_success_rate < 0.995
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Webhook handler success rate low"
          description: "Channel {{ $labels.channel }} success rate: {{ $value }}"
```

---

## 13. 日志规范

### 13.1 结构化日志格式

所有 Webhook 相关日志使用 JSON 结构化格式，包含以下标准字段：

```json
{
    "timestamp": "2026-06-24T10:30:00.123Z",
    "level": "INFO",
    "trace_id": "abc123def456",
    "webhook_id": "01JZ...",
    "channel_code": "wechat_pay",
    "event_type": "payment.success",
    "status": "DISPATCHED",
    "retry_count": 0,
    "duration_ms": 45,
    "message": "webhook_dispatched",
    "extra": {}
}
```

### 13.2 关键日志事件

| 事件 | 级别 | 触发时机 |
|------|------|---------|
| webhook_received | INFO | 回调到达 UWC |
| webhook_verified | INFO | 签名验证通过 |
| webhook_rejected | WARN | 签名验证失败 |
| webhook_duplicate | INFO | 幂等重复回调 |
| webhook_dispatched | INFO | 事件分发到 Stream |
| webhook_handler_start | INFO | Handler 开始执行 |
| webhook_handler_success | INFO | Handler 处理成功 |
| webhook_handler_failed | ERROR | Handler 处理失败 |
| webhook_dead_letter | ERROR | 进入死信队列 |
| webhook_retry_scheduled | INFO | 调度重试 |
| webhook_security_alert | WARN/ERROR | 安全相关事件（签名失败、IP 异常等） |

---

## 14. 定时任务

### 14.1 重试调度任务

```python
@celery_app.task(name="webhook.scan_retry")
def scan_and_retry_pending():
    """
    每 30 秒扫描一次 FAILED 状态且到达 next_retry_at 的回调，
    重新投递到处理队列。
    """
    pending = webhook_record_repo.get_failed_ready_for_retry(limit=100)
    for record in pending:
        handle_event.apply_async(
            args=[record.webhook_id],
            queue="webhook-handler",
        )
        logger.info("webhook_retry_scheduled", webhook_id=record.webhook_id)
```

### 14.2 死信自动迁移任务

```python
@celery_app.task(name="webhook.auto_dead_letter")
def auto_move_dead_letter():
    """
    每 5 分钟扫描 FAILED 且重试次数用尽的记录，自动迁移到死信表。
    """
    exhausted = webhook_record_repo.get_retry_exhausted(limit=50)
    for record in exhausted:
        move_to_dead_letter(
            webhook_id=record.webhook_id,
            error_code=record.error_code or "RETRY_EXHAUSTED",
            error_message=record.error_message or "Max retries exhausted",
        )
```

### 14.3 数据清理任务

```python
@celery_app.task(name="webhook.cleanup")
def cleanup_old_records():
    """
    每天凌晨执行，清理 90 天前的已成功回调记录。
    原始数据归档到冷存储后删除。
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)

    # 归档到冷存储
    old_records = webhook_record_repo.get_older_than(cutoff, limit=1000)
    if old_records:
        cold_storage.archive("webhook_records", old_records)

    # 删除已归档数据
    webhook_record_repo.delete_older_than(cutoff)

    logger.info("webhook_cleanup_done", deleted_count=len(old_records))
```

---

## 15. 扩展指南：接入新渠道

### 15.1 接入步骤

接入一个新的外部回调渠道只需以下步骤：

```text
Step 1: 注册渠道配置
  └─ POST /api/v1/admin/webhook-channels 注册新渠道

Step 2: 实现签名验证器（如已有同类型则跳过）
  └─ 继承 BaseVerifier，实现 verify() 方法
  └─ verifier_registry.register() 注册

Step 3: 实现标准化器
  └─ 继承 BaseNormalizer，实现 normalize() 方法
  └─ normalizer_registry.register() 注册

Step 4: 实现业务处理器
  └─ 继承 BaseHandler，实现 handle() 方法
  └─ handler_registry.register() 注册

Step 5: 配置 ACK 策略
  └─ 在渠道配置中指定 ack_strategy

Step 6: 测试
  └─ 使用管理后台的手动触发功能测试完整链路
```

### 15.2 新渠道接入检查清单

- [ ] 渠道 `channel_code` 唯一且语义清晰
- [ ] 签名验证器已实现并测试（包含篡改/重放场景）
- [ ] Normalizer 正确映射事件类型
- [ ] 幂等键计算包含足够区分度（同一外部事件不会产生不同 key）
- [ ] Handler 处理完成后业务状态正确更新
- [ ] Handler 正确区分 RecoverableHandlerError 和 FatalHandlerError
- [ ] ACK 响应格式符合渠道要求
- [ ] 限流配置合理（基于该渠道预期回调频率）
- [ ] 时间窗口配置合理（考虑时钟偏差）
- [ ] 监控指标已接入 Dashboard
- [ ] 告警规则已配置
- [ ] 文档已更新

---

## 16. 部署与容量规划

### 16.1 资源估算

| 组件 | MVP 配置 | 生产配置 |
|------|---------|---------|
| UWC API (FastAPI) | 2 实例 × 2C/4G | 4+ 实例 × 4C/8G |
| Celery Worker | 2 实例 × 2C/4G | 8+ 实例 × 4C/8G |
| Redis | 1 主 1 从 × 4G | 1 主 1 从 × 16G |
| MySQL 存储 | ~1GB/月 | ~50GB/月（含90天留存） |

### 16.2 容量预估

基于 PrimeTop 日活 10 万用户、付费率 10% 的预估：

| 回调来源 | 预估日回调量 | 峰值 QPS |
|---------|------------|---------|
| 支付回调（微信+支付宝+IAP） | ~500 | ~5 |
| AI 供应商异步回调 | ~2000 | ~20 |
| 推送/短信回执 | ~50000 | ~100 |
| 内容处理回调 | ~1000 | ~10 |
| **合计** | ~53500 | ~135 |

单实例 UWC API 可处理 ~500 QPS（FastAPI 异步），2 实例足够 MVP 阶段。

Celery Worker 单实例并行度 8，4 实例可并行处理 32 个回调，足够覆盖。

---

## 17. 与现有模块的关系

| 关联模块 | 关系 | 说明 |
|---------|------|------|
| 异步任务与事件驱动架构 | 依赖 | 复用 Celery + Redis Stream 基础设施 |
| 支付与会员订阅 | 被调用方 | UWC 分发支付回调给支付服务处理 |
| 应用内购与商店支付集成层 | 被调用方 | Apple/Google 支付回调经 UWC 中转 |
| AI 对话引擎与会话管理 | 被调用方 | AI 异步任务回调经 UWC 中转 |
| 消息与推送服务 | 被调用方 | 推送/短信送达回执经 UWC 中转 |
| 统一业务异常码与错误分类体系 | 遵循 | 使用统一错误码体系 |
| 密钥管理与敏感配置安全策略 | 依赖 | 所有签名密钥通过 KMS 引用 |
| 分布式链路追踪与全链路可观测体系 | 集成 | 所有回调注入 OpenTelemetry TraceID |
| 服务端审计日志与操作追溯系统 | 集成 | 安全事件写入审计日志 |

---

## 18. FAQ

**Q1: 为什么不在各业务服务中直接接收回调？**

统一入口有三大优势：(1) 安全边界收敛——只有 UWC 暴露公网回调端口，其他服务在内网；(2) 复用基础设施——签名验证、幂等、重试、监控不用每个服务各写一套；(3) 新接入成本低——接一个新渠道只需注册配置 + 写 Handler。

**Q2: UWC 宕机会怎样？**

外部系统有重试机制（微信最多 15 分钟内重试、支付宝 8 次重试等），UWC 恢复后可继续处理。Redis Stream 中已分发但未消费的消息不会丢失。MySQL 中的 webhook_record 持久化保证回调不丢失。

**Q3: 如何处理回调处理顺序问题？**

同一外部事件 ID 的回调通过幂等表保证只处理一次。对于需要顺序的场景（如先支付成功再退款），业务服务通过订单状态机保证——退款 Handler 检查订单状态是否为"已支付"，不是则抛出 RecoverableHandlerError 延后处理。

**Q4: 如何支持本地开发和联调？**

提供 `POST /api/v1/admin/webhooks/{webhook_id}/retry` 管理接口，可以手动触发回调处理。开发环境提供 Mock Webhook 发送工具，模拟各渠道的回调请求。

---

## 附录 A: 完整渠道接入示例文件结构

```text
app/webhook/
├── __init__.py
├── app.py                      # FastAPI 应用入口
├── router.py                   # 路由定义
├── middleware.py               # 中间件（限流、日志、追踪）
├── models.py                   # 数据模型（Pydantic + SQLAlchemy）
├── repository.py              # 数据库操作
│
├── core/
│   ├── dispatcher.py          # 事件分发器
│   ├── idempotency.py         # 幂等管理器
│   ├── ack_strategy.py        # ACK 策略
│   └── rate_limiter.py        # 限流器
│
├── verifiers/
│   ├── base.py                # 验证器基类
│   ├── hmac_sha256.py         # HMAC-SHA256 验证器
│   ├── rsa_sha256.py          # RSA-SHA256 验证器
│   ├── apple_jwt.py           # Apple JWT 验证器
│   └── google_pubkey.py       # Google Ed25519 验证器
│
├── normalizers/
│   ├── base.py                # 标准化器基类
│   ├── wechat_pay.py          # 微信支付
│   ├── alipay.py              # 支付宝
│   ├── apple_iap.py           # Apple IAP
│   ├── google_play.py         # Google Play
│   ├── ai_provider.py         # AI 供应商
│   ├── sms_gateway.py         # 短信网关
│   └── push_gateway.py        # 推送网关
│
├── handlers/
│   ├── base.py                # Handler 基类
│   ├── payment_handler.py     # 支付回调处理
│   ├── ai_handler.py          # AI 回调处理
│   ├── notification_handler.py # 通知回执处理
│   └── content_handler.py     # 内容处理回调
│
├── tasks/
│   ├── celery_app.py          # Celery 配置
│   ├── handle_event.py        # 事件处理任务
│   ├── scan_retry.py          # 重试扫描任务
│   ├── auto_dead_letter.py    # 死信迁移任务
│   └── cleanup.py             # 数据清理任务
│
└── admin/
    ├── channels.py            # 渠道管理 API
    ├── records.py             # 回调记录查询 API
    └── stats.py               # 统计 API
```

---

## 附录 B: 管理后台界面要点

### B.1 回调记录列表页

| 列 | 说明 |
|----|------|
| Webhook ID | 内部事件 ID，可点击查看详情 |
| 渠道 | 渠道编码 + 名称 |
| 事件类型 | 标准化事件类型 |
| 状态 | 状态标签（颜色编码：绿色=SUCCESS，黄色=PROCESSING，红色=FAILED/DEAD） |
| 外部事件ID | 外部系统的唯一标识 |
| 接收时间 | 格式化为本地时间 |
| 处理耗时 | 从接收到处理完成的毫秒数 |
| 操作 | 「查看详情」「手动重试」 |

### B.2 回调详情页

- 基本信息：渠道、事件类型、状态、时间线
- 原始请求：Headers（脱敏后）+ Body（JSON 美化）
- 解析后数据：标准化后的结构化 payload
- 重试日志：每次重试的时间、结果、错误信息
- 关联信息：TraceID（可跳转到链路追踪系统）、关联订单ID等

### B.3 死信管理页

- 死信列表，支持按渠道、事件类型、时间筛选
- 每条死信可展开查看原始请求和错误信息
- 支持「重新处理」和「标记忽略」操作
- 处理记录留痕（处理人、时间、备注）
