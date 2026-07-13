# 服务端 - SLO 服务等级目标管理与可靠性工程平台 详细设计

> **文档版本**: v1.0  
> **创建时间**: 2026-06-26  
> **适用对象**: 后端开发、SRE/运维工程师、架构师  
> **前置依赖**: 《日志与监控告警体系-详细设计》《服务端-分布式链路追踪与全链路可观测体系-详细设计》《服务端-健康检查与服务就绪探针设计规范-详细设计》

---

## 1. 概述与设计目标

### 1.1 背景与问题

PrimeTop 作为全学段 AI 辅助学习 APP，服务端由用户服务、AI 对话引擎、拍照搜题（OCR）、同步课堂、错题服务、学习规划、支付订阅、推送通知等数十个微服务/模块组成。随着系统规模增长，面临以下可靠性挑战：

| 痛点 | 描述 |
|------|------|
| **可靠性无量化** | "AI 对话慢了""拍题识别卡了"——缺少客观的服务等级衡量标准，团队对"够不够好"没有共识 |
| **告警疲劳** | 全靠固定阈值告警（如 CPU > 80%），大量误报/漏报，on-call 人员疲于奔命 |
| **过度工程 vs 欠工程** | 核心链路（AI 对话、拍题）可能投入不足，而边缘服务（运营后台）可能过度设计 |
| **故障复盘流于形式** | 缺少结构化的错误预算追踪和 postmortem 闭环，同类故障反复发生 |
| **扩容决策拍脑袋** | 没有 SLO 数据支撑的容量规划，靠"感觉"加机器 |

### 1.2 设计目标

1. **建立 SLO/SLI 量化体系**：为 PrimeTop 每个核心服务定义可衡量的可靠性目标。
2. **错误预算驱动决策**：通过错误预算（Error Budget）自动控制发布节奏和风险承担。
3. **燃烧率智能告警**：基于多窗口燃烧率（Burn Rate）生成精准告警，降低告警噪声。
4. **可靠性数据看板**：为技术团队和管理层提供实时可靠性可视化。
5. **混沌工程验证**：定期通过故障注入验证 SLO 防御能力。
6. **Postmortem 闭环**：标准化事故复盘流程，沉淀为组织知识库。

### 1.3 核心原则

- **用户视角定义 SLI**：SLI 衡量的是用户体验，而非系统内部指标。
- **区分服务等级**：Critical / Important / Supporting 三级，不同等级对应不同 SLO 目标。
- **错误预算即自由度**：预算未耗尽时鼓励快速迭代；预算耗尽时冻结高风险变更。
- **Data-Driven**：一切可靠性决策基于数据，非主观判断。

---

## 2. 概念定义与服务分级

### 2.1 核心概念

```
┌─────────────────────────────────────────────────────────────────┐
│                        SLO 体系层级                              │
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐              │
│  │   SLI    │───▶│   SLO    │───▶│ Error Budget │              │
│  │ (指标)   │    │ (目标)   │    │  (错误预算)   │              │
│  └──────────┘    └──────────┘    └──────────────┘              │
│       │               │                   │                     │
│       ▼               ▼                   ▼                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐              │
│  │ 采集引擎 │    │ 评估引擎 │    │  燃烧率告警   │              │
│  └──────────┘    └──────────┘    └──────────────┘              │
│                         │                                        │
│                         ▼                                        │
│              ┌──────────────────┐                               │
│              │  冻结/解冻发布   │                               │
│              │  Postmortem 追踪 │                               │
│              └──────────────────┘                               │
└─────────────────────────────────────────────────────────────────┘
```

| 概念 | 定义 | 示例 |
|------|------|------|
| **SLI (Service Level Indicator)** | 衡量服务质量的量化指标 | AI 对话 P99 首 token 延迟 = 2.1s |
| **SLO (Service Level Objective)** | SLI 的目标值，代表对用户的承诺 | AI 对话 P99 首 token ≤ 3s，30天窗口内 ≥ 99% |
| **Error Budget** | 100% - SLO 目标，即允许的"不可靠"余量 | SLO 99% → 错误预算 1% → 30天内允许 7.2h 不达标 |
| **Burn Rate** | 错误预算消耗速度 vs 预期消耗速度 | 燃烧率 = 10 表示比预期快 10 倍消耗预算 |
| **SLA (Service Level Agreement)** | 对外合同承诺（与赔偿挂钩） | 通常比 SLO 更宽松，如 99.5% |

### 2.2 PrimeTop 服务等级划分

```text
┌───────────────────────────────────────────────────────────────────────┐
│                        PrimeTop 服务金字塔                             │
│                                                                       │
│                    ┌─────────────┐                                    │
│                   /   Critical   \     ← 直接影响核心学习闭环          │
│                  /    (L1) 99.9%  \      用户可感知的 P0 功能          │
│                 ┌─────────────────┐                                   │
│                /                   \                                  │
│               /    Important (L2)   \   ← 重要但非核心闭环必需         │
│              /      SLO: 99.5%        \    P1 功能，短暂降级可接受     │
│             ┌─────────────────────────┐                               │
│            /                           \                              │
│           /      Supporting (L3)        \ ← 内部支撑、管理后台         │
│          /        SLO: 99.0%              \  短时不可用影响小          │
│         ┌─────────────────────────────────┐                           │
└───────────────────────────────────────────────────────────────────────┘
```

#### L1 - Critical（核心服务，SLO 99.9%）

| 服务 | 关键功能 | 为什么是 L1 |
|------|----------|-------------|
| `ai-dialogue-gateway` | AI 对话请求编排、SSE 流式响应 | 核心学习入口，直接影响用户体验 |
| `ocr-recognition` | 拍照题目识别 | 拍题是 P0 功能，识别失败=功能不可用 |
| `auth-service` | 登录注册、Token 校验 | 全量请求入口，挂了=全站不可用 |
| `payment-service` | 支付下单、权益校验 | 涉及资金安全，不可降级 |
| `api-gateway` | 统一入口、鉴权、限流 | 所有请求的必经之路 |

#### L2 - Important（重要服务，SLO 99.5%）

| 服务 | 关键功能 | 为什么是 L2 |
|------|----------|-------------|
| `mistake-book-service` | 错题收录与管理 | 重要但可容忍短暂延迟 |
| `study-plan-service` | 学习规划生成 | 非实时关键路径 |
| `content-recommendation` | 个性化推荐 | 降级可回退默认推荐 |
| `sync-classroom-service` | 同步课堂内容 | 可用缓存兜底 |
| `notification-service` | 消息推送 | 延迟几分钟可接受 |
| `analytics-service` | 学情分析 | 离线计算为主 |
| `parent-service` | 家长端服务 | 家长非实时在线 |

#### L3 - Supporting（支撑服务，SLO 99.0%）

| 服务 | 关键功能 | 为什么是 L3 |
|------|----------|-------------|
| `admin-backend` | 管理后台 | 内部使用，工作时间窗口 |
| `content-management` | 内容运营管理 | 非用户直接感知 |
| `data-pipeline` | 数据同步/ETL | 批量处理，可重试 |
| `report-generator` | 定时报告生成 | 非实时 |
| `feature-flag-service` | 灰度/配置中心 | 可本地缓存兜底 |

---

## 3. SLI 指标体系设计

### 3.1 SLI 分类模型

每个服务的 SLI 遵循 **"好事件 / 总事件"** 模型：

```
SLI = (好事件数 / 总事件数) × 100%
```

#### 3.1.1 请求成功率 (Availability)

```yaml
SLI_NAME: request_availability
描述: 成功响应的请求占总请求的比例
好事件: HTTP 状态码 ∈ [200, 399] 且业务码 = SUCCESS
总事件: 所有接收到的用户请求（不含 429 限流）
排除:
  - 主动拒绝的限流请求 (429)
  - 用户主动取消的请求 (499)
  - 健康检查请求 (/health, /ready)
  - 内部探针请求 (User-Agent: kube-probe/*)
```

#### 3.1.2 延迟 (Latency)

```yaml
SLI_NAME: request_latency_p99
描述: P99 延迟达标的请求比例
好事件: 请求延迟 ≤ threshold 的请求数
总事件: 所有成功处理的请求数
排除:
  - 流式 SSE 长连接（单独定义 SLI）
  - 文件上传请求（单独定义 SLI）
```

#### 3.1.3 正确性 (Correctness) — AI 专项

```yaml
SLI_NAME: ai_response_quality
描述: AI 回答质量抽检合格率
好事件: 质量抽检评分 ≥ 3分（5分制）的回答数
总事件: 质量抽检总样本数
说明: 通过离线评测 + 在线用户反馈 ("有用"/"无用"点击) 综合计算
```

#### 3.1.4 数据完整性 (Data Integrity)

```yaml
SLI_NAME: data_freshness
描述: 学习数据同步延迟在允许范围内的比例
好事件: 数据同步延迟 ≤ 阈值的记录数
总事件: 应同步的数据总记录数
说明: 适用于错题同步、学习进度、答题记录等
```

### 3.2 PrimeTop 核心服务 SLI 定义

#### 3.2.1 AI 对话服务 (`ai-dialogue-gateway`)

```yaml
service: ai-dialogue-gateway
tier: L1
slo_target: 99.9%
window: 28d  # 4周滚动窗口

indicators:
  - name: dialogue_availability
    type: availability
    good: response.status < 500 AND response.business_code == 'SUCCESS'
    total: request.total EXCEPT response.status == 429
    slo: 99.9%

  - name: first_token_latency
    type: latency
    good: response.first_token_latency_ms <= 3000
    total: request.total EXCEPT request.is_streaming == false
    slo: 99.0%  # 允许1%的请求首token超过3s
    note: "用户感知最强指标，首token 3s内必须有输出"

  - name: complete_response_latency
    type: latency
    good: response.total_latency_ms <= 30000
    total: request.total
    slo: 99.5%
    note: "完整对话响应（含流式全部token）不超过30s"

  - name: dialogue_quality
    type: correctness
    good: quality_score >= 3.0
    total: sampled_responses.total
    slo: 97.0%
    note: "基于离线抽检+用户反馈综合评分"
```

#### 3.2.2 拍照搜题/OCR 服务 (`ocr-recognition`)

```yaml
service: ocr-recognition
tier: L1

indicators:
  - name: ocr_availability
    type: availability
    good: response.status < 500
    total: request.total
    slo: 99.9%

  - name: ocr_latency
    type: latency
    good: response.latency_ms <= 5000
    total: request.total
    slo: 99.0%
    note: "OCR识别结果5s内返回"

  - name: ocr_accuracy
    type: correctness
    good: recognition_confidence >= 0.85 AND user_confirmed_correct == true
    total: ocr_results.total
    slo: 92.0%
    note: "识别准确率不低于92%（基于用户确认率+抽检）"

  - name: structure_parse_rate
    type: availability
    good: parse_result.is_valid == true
    total: ocr_success.total
    slo: 95.0%
    note: "OCR成功后题目结构化解析成功率"
```

#### 3.2.3 认证服务 (`auth-service`)

```yaml
service: auth-service
tier: L1

indicators:
  - name: auth_availability
    type: availability
    good: response.status < 500
    total: request.total
    slo: 99.9%

  - name: auth_latency
    type: latency
    good: response.latency_ms <= 500
    total: request.total
    slo: 99.9%
    note: "认证服务必须极速响应"

  - name: token_validation_success
    type: availability
    good: token_validation.result == 'VALID'
    total: token_validation.attempts EXCEPT token_validation.result == 'EXPIRED'
    slo: 99.99%
    note: "有效token不应被误判为无效（排除自然过期）"
```

#### 3.2.4 错题服务 (`mistake-book-service`)

```yaml
service: mistake-book-service
tier: L2

indicators:
  - name: mistake_sync_availability
    type: availability
    good: response.status < 500
    total: request.total
    slo: 99.5%

  - name: mistake_sync_freshness
    type: data_freshness
    good: sync_delay_seconds <= 5
    total: mistake_records.total
    slo: 99.0%
    note: "错题数据同步延迟95%在5s内"

  - name: query_latency
    type: latency
    good: response.latency_ms <= 800
    total: request.total EXCEPT request.action == 'export_pdf'
    slo: 99.0%
    note: "错题查询P99 800ms内（PDF导出除外）"
```

#### 3.2.5 支付服务 (`payment-service`)

```yaml
service: payment-service
tier: L1

indicators:
  - name: payment_availability
    type: availability
    good: response.status < 500
    total: request.total
    slo: 99.95%
    note: "支付服务SLO高于其他L1服务"

  - name: order_consistency
    type: data_integrity
    good: reconciled_orders == total_orders
    total: total_orders
    slo: 99.99%
    note: "订单与支付渠道对账一致率"

  - name: payment_latency
    type: latency
    good: response.latency_ms <= 3000
    total: request.total
    slo: 99.0%
```

---

## 4. 数据结构设计

### 4.1 核心表结构

#### 4.1.1 SLO 定义表 (`slo_definitions`)

```sql
CREATE TABLE slo_definitions (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    slo_code        VARCHAR(64) NOT NULL UNIQUE COMMENT 'SLO唯一编码，如 ai-dialogue-gateway:availability',
    service_name    VARCHAR(64) NOT NULL COMMENT '服务名称',
    slo_name        VARCHAR(128) NOT NULL COMMENT 'SLO名称',
    tier            TINYINT NOT NULL COMMENT '服务等级: 1=Critical, 2=Important, 3=Supporting',
    
    -- SLI 定义
    sli_type        VARCHAR(32) NOT NULL COMMENT 'SLI类型: availability/latency/correctness/data_freshness/data_integrity',
    sli_good_expr   TEXT NOT NULL COMMENT '好事件PromQL/表达式',
    sli_total_expr  TEXT NOT NULL COMMENT '总事件PromQL/表达式',
    sli_exclusion   TEXT COMMENT '排除条件表达式',
    
    -- SLO 目标
    target_percent  DECIMAL(5,2) NOT NULL COMMENT 'SLO目标百分比，如 99.90',
    window_days     INT NOT NULL DEFAULT 28 COMMENT '评估窗口天数',
    
    -- 告警配置
    burn_rate_configs JSON NOT NULL COMMENT '燃烧率告警配置，多窗口组合',
    
    -- 状态管理
    status          VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE/PAUSED/DEPRECATED',
    freeze_policy   VARCHAR(32) NOT NULL DEFAULT 'WARN' COMMENT 'BUDGET_EXHAUSTED时的策略: FREEZE/WARN/NONE',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by      VARCHAR(64) NOT NULL,
    
    INDEX idx_service (service_name),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='SLO定义表';
```

#### 4.1.2 SLI 采集记录表 (`sli_measurements`)

```sql
CREATE TABLE sli_measurements (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    slo_code        VARCHAR(64) NOT NULL COMMENT '关联SLO编码',
    bucket_start    DATETIME NOT NULL COMMENT '统计窗口开始时间',
    bucket_end      DATETIME NOT NULL COMMENT '统计窗口结束时间',
    bucket_minutes  INT NOT NULL COMMENT '窗口粒度（分钟）',
    
    good_count      BIGINT NOT NULL COMMENT '好事件数',
    total_count     BIGINT NOT NULL COMMENT '总事件数',
    slo_value       DECIMAL(8,4) GENERATED ALWAYS AS (CASE WHEN total_count > 0 THEN good_count / total_count * 100 ELSE NULL END) STORED COMMENT '实际SLI百分比',
    
    is_meeting      TINYINT GENERATED ALWAYS AS (CASE WHEN total_count > 0 AND good_count / total_count * 100 >= 0 THEN 1 ELSE 0 END) STORED COMMENT '是否达标',
    
    -- 扩展指标
    p50_ms          INT COMMENT 'P50延迟(ms)',
    p90_ms          INT COMMENT 'P90延迟(ms)',
    p99_ms          INT COMMENT 'P99延迟(ms)',
    p999_ms         INT COMMENT 'P99.9延迟(ms)',
    error_count     INT COMMENT '错误数',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_slo_bucket (slo_code, bucket_start, bucket_minutes),
    INDEX idx_bucket (bucket_start, bucket_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='SLI采集记录表'
PARTITION BY RANGE (TO_DAYS(bucket_start)) (
    PARTITION p_current VALUES LESS THAN (TO_DAYS('2026-07-01')),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);
```

#### 4.1.3 错误预算表 (`error_budgets`)

```sql
CREATE TABLE error_budgets (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    slo_code            VARCHAR(64) NOT NULL COMMENT '关联SLO编码',
    window_start        DATETIME NOT NULL COMMENT '窗口开始时间',
    window_end          DATETIME NOT NULL COMMENT '窗口结束时间',
    
    -- 预算计算
    target_percent      DECIMAL(5,2) NOT NULL COMMENT 'SLO目标，如 99.90',
    budget_percent      DECIMAL(5,2) GENERATED ALWAYS AS (100.0 - target_percent) STORED COMMENT '错误预算百分比',
    budget_seconds      INT NOT NULL COMMENT '允许不达标的总秒数 = window_days * 86400 * budget_percent / 100',
    
    -- 实际消耗
    consumed_seconds    DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '已消耗的错误时间(秒)',
    remaining_seconds   DECIMAL(12,2) GENERATED ALWAYS AS (budget_seconds - consumed_seconds) STORED COMMENT '剩余预算(秒)',
    remaining_percent   DECIMAL(8,4) GENERATED ALWAYS AS (CASE WHEN budget_seconds > 0 THEN (budget_seconds - consumed_seconds) / budget_seconds * 100 ELSE 0 END) STORED COMMENT '剩余预算百分比',
    
    -- 燃烧率
    burn_rate_1h        DECIMAL(10,2) COMMENT '1小时燃烧率',
    burn_rate_6h        DECIMAL(10,2) COMMENT '6小时燃烧率',
    burn_rate_24h       DECIMAL(10,2) COMMENT '24小时燃烧率',
    
    -- 冻结状态
    freeze_status       VARCHAR(16) NOT NULL DEFAULT 'NORMAL' COMMENT 'NORMAL/WARNING/FROZEN/CRITICAL',
    frozen_at           DATETIME COMMENT '冻结时间',
    frozen_reason       VARCHAR(256) COMMENT '冻结原因',
    
    computed_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_slo_window (slo_code, window_start),
    INDEX idx_freeze (freeze_status),
    INDEX idx_slo_time (slo_code, window_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='错误预算表';
```

#### 4.1.4 告警事件表 (`slo_alerts`)

```sql
CREATE TABLE slo_alerts (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    alert_code      VARCHAR(128) NOT NULL UNIQUE COMMENT '告警唯一编码',
    slo_code        VARCHAR(64) NOT NULL,
    alert_type      VARCHAR(32) NOT NULL COMMENT 'BURN_RATE/BUDGET_EXHAUSTED/SLO_VIOLATION/ANOMALY',
    severity        VARCHAR(16) NOT NULL COMMENT 'CRITICAL/WARNING/INFO',
    
    -- 告警详情
    title           VARCHAR(256) NOT NULL,
    description     TEXT NOT NULL COMMENT '告警详情',
    burn_rate_value DECIMAL(10,2) COMMENT '触发时的燃烧率',
    window_short    VARCHAR(16) COMMENT '短窗口，如 5m',
    window_long     VARCHAR(16) COMMENT '长窗口，如 1h',
    
    -- 状态
    status          VARCHAR(16) NOT NULL DEFAULT 'FIRING' COMMENT 'FIRING/RESOLVED/ACKNOWLEDGED/SUPPRESSED',
    fired_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at     DATETIME,
    acknowledged_by VARCHAR(64),
    acknowledged_at DATETIME,
    
    -- 关联
    incident_id     BIGINT COMMENT '关联的事故ID',
    
    -- 上下文
    runbook_url     VARCHAR(512) COMMENT '应急手册链接',
    dashboard_url   VARCHAR(512) COMMENT '看板链接',
    context_data    JSON COMMENT '附加上下文数据',
    
    INDEX idx_slo (slo_code),
    INDEX idx_status (status),
    INDEX idx_fired (fired_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='SLO告警事件表';
```

#### 4.1.5 事故/Postmortem 表 (`incidents`)

```sql
CREATE TABLE incidents (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    incident_code       VARCHAR(32) NOT NULL UNIQUE COMMENT '事故编号，如 INC-2026-0042',
    title               VARCHAR(256) NOT NULL,
    severity            VARCHAR(16) NOT NULL COMMENT 'SEV1/SEV2/SEV3/SEV4',
    
    -- 关联SLO
    affected_slo_codes  JSON NOT NULL COMMENT '受影响的SLO列表',
    
    -- 时间线
    detected_at         DATETIME NOT NULL COMMENT '发现时间',
    started_at          DATETIME COMMENT '实际开始时间',
    mitigated_at        DATETIME COMMENT '缓解时间',
    resolved_at         DATETIME COMMENT '彻底修复时间',
    
    -- 影响评估
    impact_summary      TEXT NOT NULL COMMENT '影响摘要',
    affected_users      INT COMMENT '影响用户数',
    error_budget_cost   DECIMAL(10,2) COMMENT '消耗的错误预算(秒)',
    revenue_impact      DECIMAL(12,2) COMMENT '收入影响(元)',
    
    -- 根因
    root_cause          TEXT NOT NULL COMMENT '根因分析',
    contributing_factors JSON COMMENT '促成因素列表',
    
    -- 行动项
    action_items        JSON NOT NULL COMMENT '改进行动项列表',
    
    -- Postmortem
    postmortem_status   VARCHAR(16) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/IN_PROGRESS/COMPLETED',
    postmortem_url      VARCHAR(512) COMMENT '复盘文档链接',
    blameless           TINYINT NOT NULL DEFAULT 1 COMMENT '是否遵循Blameless原则',
    
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_severity (severity),
    INDEX idx_status (postmortem_status),
    INDEX idx_detected (detected_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='事故与复盘记录表';
```

#### 4.1.6 冻结发布记录表 (`release_freezes`)

```sql
CREATE TABLE release_freezes (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    slo_code        VARCHAR(64) NOT NULL,
    freeze_type     VARCHAR(32) NOT NULL COMMENT 'SOFT_FREEZE/HARD_FREEZE',
    freeze_reason   VARCHAR(256) NOT NULL COMMENT 'BUDGET_EXHAUSTED/INCIDENT/MANUAL',
    
    triggered_by    VARCHAR(64) NOT NULL COMMENT '触发者(system/username)',
    triggered_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    lift