# 服务端 - SLO 服务等级目标管理与可靠性工程平台 详细设计

> **文档版本**: v1.1（2026-08-18 补全烂尾文档，详见文末维护记录）  
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
    target_percent_snapshot DECIMAL(5,2) NOT NULL DEFAULT 100.00 COMMENT '桶生成时点的SLO目标快照(v1.1增补,见§4.2.1)',
    
    is_meeting      TINYINT GENERATED ALWAYS AS (CASE WHEN total_count > 0 AND good_count / total_count * 100 >= target_percent_snapshot THEN 1 ELSE 0 END) STORED COMMENT '是否达标(v1.1修正:v1.0表达式>=0恒真,无法表达达标语义)',
    
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
    
    -- 解冻信息（v1.1 补全 v1.0 截断处）
    lift_type       VARCHAR(16) NOT NULL DEFAULT 'PENDING' COMMENT '解冻状态: PENDING待解冻/AUTO自动解冻/MANUAL手动解冻',
    lift_condition  VARCHAR(256) COMMENT '自动解冻条件表达式快照,如 remaining_percent>=25 AND sustained_hours>=6',
    lifted_by       VARCHAR(64) COMMENT '手动解冻操作人(MANUAL时必填)',
    lifted_at       DATETIME COMMENT '解冻生效时间',
    lift_reason     VARCHAR(256) COMMENT '解冻原因(AUTO=条件达成/MANUAL=人工裁决说明)',
    lift_approvers  JSON COMMENT '双人审批记录 [{"role":"SRE","name":"zhang","approved_at":"..."}],MANUAL解冻必填且须同时含SRE负责人与服务Owner',
    
    -- 豁免与影响范围
    scope           JSON NOT NULL COMMENT '冻结影响范围 {"service":"ai-dialogue-gateway","repos":["ai-dialogue"],"env":"production"}',
    exemption_count INT NOT NULL DEFAULT 0 COMMENT '冻结期间特批豁免发布次数(HOTFIX/SECURITY)',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- 唯一性: 同一SLO同时只允许一条未解除的冻结(函数唯一索引见§4.2.3,不在建表语句内联)
    INDEX idx_lift_status (lift_type, freeze_type),
    INDEX idx_triggered (triggered_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='发布冻结记录表';
```

> **v1.1 说明**: v1.0 截断于本表 `lift` 字段定义处。上表中 `lift_type/lift_condition/lifted_by/lifted_at/lift_reason/lift_approvers/scope/exemption_count` 及解冻审批语义均为 v1.1 补全定义;同一 SLO 的“未解除冻结唯一性”通过 §4.2.3 函数唯一索引实现（`lift_type='PENDING'` 的行才参与唯一约束，已解冻历史行不冲突）。

#### 4.1.7 SLO 滚动窗口快照表 (`slo_window_snapshots`)（v1.1 新增）

`sli_measurements` 是桶级明细，看板与趋势查询直接全表聚合代价高；评估引擎每小时为每个 ACTIVE SLO 落地一次滚动窗口快照，作为看板、报告、可达性判定的权威依据。

```sql
CREATE TABLE slo_window_snapshots (
    id                BIGINT PRIMARY KEY AUTO_INCREMENT,
    slo_code          VARCHAR(64) NOT NULL,
    snapshot_at       DATETIME NOT NULL COMMENT '快照生成时间(整点对齐)',
    window_start      DATETIME NOT NULL COMMENT '滚动窗口左端 = snapshot_at - window_days',
    window_end        DATETIME NOT NULL COMMENT '滚动窗口右端 = snapshot_at',
    
    -- 窗口内事件累计(排除低流量桶)
    good_total        BIGINT NOT NULL COMMENT '窗口内好事件累计',
    event_total       BIGINT NOT NULL COMMENT '窗口内总事件累计',
    skipped_buckets   INT NOT NULL DEFAULT 0 COMMENT '因低流量跳过的桶数(G7)',
    sli_value         DECIMAL(8,4) NOT NULL COMMENT '窗口实际SLI = good_total/event_total*100',
    
    -- 预算状态
    target_percent    DECIMAL(5,2) NOT NULL,
    budget_seconds    INT NOT NULL COMMENT '窗口预算总秒数',
    consumed_seconds  DECIMAL(12,2) NOT NULL COMMENT '已消耗预算秒数(按桶错误比例×桶时长累加)',
    remaining_percent DECIMAL(8,4) NOT NULL COMMENT '剩余预算百分比',
    burn_rate_1h      DECIMAL(10,2) COMMENT '1h燃烧率(快照时点)',
    burn_rate_6h      DECIMAL(10,2),
    burn_rate_24h     DECIMAL(10,2),
    
    -- 可达性判定
    achievable        TINYINT NOT NULL DEFAULT 1 COMMENT '1=窗口内仍可能达标;0=即使剩余窗口全部好事件也无法达标(数学上已违约)',
    
    UNIQUE KEY uk_slo_snap (slo_code, snapshot_at),
    INDEX idx_snap_time (snapshot_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='SLO滚动窗口小时级快照表';
```

#### 4.1.8 平台事件发件箱 (`slo_outbox`)（v1.1 新增）

事务性发件箱模式：所有对外事件与主业务变更同事务写入，由 Relay 进程异步投递至事件总线（对齐《服务端-事件驱动架构与统一事件总线详细设计》信封格式），保证“预算变更/冻结/告警”等状态变化不丢事件。

```sql
CREATE TABLE slo_outbox (
    id            BIGINT PRIMARY KEY AUTO_INCREMENT,
    event_id      VARCHAR(64) NOT NULL UNIQUE COMMENT '事件ID,evt_{ulid}',
    event_type    VARCHAR(64) NOT NULL COMMENT '事件类型,见§10',
    aggregate_id  VARCHAR(64) NOT NULL COMMENT '聚合根ID(slo_code/freeze_id/alert_id/incident_no)',
    payload       JSON NOT NULL COMMENT '事件载荷',
    occurred_at   DATETIME(3) NOT NULL,
    status        VARCHAR(16) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/PUBLISHED/DEAD',
    retry_count   INT NOT NULL DEFAULT 0,
    next_retry_at DATETIME(3) NULL,
    published_at  DATETIME(3) NULL,
    
    INDEX idx_status_retry (status, next_retry_at),
    INDEX idx_agg (aggregate_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='SLO平台事件发件箱';
```

#### 4.1.9 事故预算分摊明细表 (`incident_budget_breakdown`)（v1.1 新增）

一起事故可同时燃烧多个 SLO 的预算；预算归因核算按 SLO 维度分摊，供复盘引擎与管理驾驶舱引用。

```sql
CREATE TABLE incident_budget_breakdown (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    incident_no     VARCHAR(20) NOT NULL COMMENT 'OnCall系统事故编号INC-YYYYMMDD-NNN(权威源:OnCall)',
    slo_code        VARCHAR(64) NOT NULL,
    window_start    DATETIME NOT NULL COMMENT '归因区间=事故[started_at, mitigated_at]∩SLO窗口',
    cost_seconds    DECIMAL(12,2) NOT NULL COMMENT '区间内该SLO消耗的预算秒数',
    cost_percent    DECIMAL(8,4) NOT NULL COMMENT '占该SLO窗口总预算百分比',
    computed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_incident_slo (incident_no, slo_code),
    INDEX idx_slo_time (slo_code, computed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='事故预算分摊明细表(事故主体权威在OnCall系统,本表仅做SLO视角核算)';
```

### 4.2 DDL 增补与 v1.0 缺陷修正（v1.1）

#### 4.2.1 `sli_measurements.is_meeting` 恒真缺陷修正

v1.0 生成列表达式 `good_count / total_count * 100 >= 0` 恒为真（比例不可能为负），无法表达“桶是否达标”。生成列不允许引用他表的目标值，v1.1 在本表增加 `target_percent_snapshot` 列（已回写到 §4.1.2），存量库执行以下迁移：

```sql
-- 存量迁移(新库直接使用§4.1.2修正后的DDL)
ALTER TABLE sli_measurements
    ADD COLUMN target_percent_snapshot DECIMAL(5,2) NOT NULL DEFAULT 100.00 COMMENT '桶生成时点的SLO目标快照' AFTER slo_value;
ALTER TABLE sli_measurements
    MODIFY COLUMN is_meeting TINYINT
    GENERATED ALWAYS AS (CASE WHEN total_count > 0 AND good_count / total_count * 100 >= target_percent_snapshot THEN 1 ELSE 0 END) STORED COMMENT '是否达标';
-- 历史桶回填目标快照(按窗口期生效定义回填,执行前停采集)
UPDATE sli_measurements m
JOIN slo_definitions d ON d.slo_code = m.slo_code
SET m.target_percent_snapshot = d.target_percent
WHERE m.target_percent_snapshot = 100.00;
```

#### 4.2.2 `incidents` 表与 OnCall/复盘引擎的边界修正

v1.0 的 `incidents` 表自带完整事故状态字段，与《生产事故应急响应与OnCall值班调度体系》的 `incident` 表（权威事故主体，编号 `INC-YYYYMMDD-NNN`）、与《排障根因分析与系统故障复盘引擎》的 Postmortem 主体发生职责重叠。v1.1 确立边界：**事故事中响应权威 = OnCall 系统；复盘与行动项权威 = 复盘引擎；本平台 incidents 表退化为“SLO 视角事故影响核算记录”**，通过 `incident_no` 外联权威实体：

```sql
ALTER TABLE incidents
    ADD COLUMN incident_no VARCHAR(20) NULL UNIQUE COMMENT 'OnCall权威事故编号INC-YYYYMMDD-NNN,事故主体/状态机/状态页以OnCall为准' AFTER incident_code,
    ADD COLUMN pm_synced_at DATETIME NULL COMMENT '复盘状态最近一次从复盘引擎同步的时间(展示冗余,权威在复盘引擎)';
-- incident_code 保留为本平台内部主编号(SLO-INC-{年}-{序号});root_cause/action_items/postmortem_* 字段降级为只读展示快照,
-- 由复盘引擎事件驱动同步(见§5.7),禁止在本平台编辑入口直接修改(G12)。
```

#### 4.2.3 `release_freezes` 未解除冻结唯一性（函数唯一索引）

普通唯一键 `(slo_code)` 会导致解冻后再次冻结撞键；用函数唯一索引只约束未解除（`lift_type='PENDING'`）的行：

```sql
-- MySQL 8.0.13+;表达式返回NULL的行不参与唯一冲突
CREATE UNIQUE INDEX uk_slo_active_freeze
    ON release_freezes ((IF(lift_type = 'PENDING', slo_code, NULL)));
```

#### 4.2.4 `sli_measurements` 分区滚动管理

v1.0 建表仅预置两个分区，长期运行会全部落入 `p_future` 失去分区裁剪意义。由分区管理任务（§5.1.6）每月执行滚动重组，MySQL 保留 90 天，更早桶归档 ClickHouse 后删除：

```sql
-- 每月1日 02:00 执行:新增下月分区并滚动收拢
ALTER TABLE sli_measurements REORGANIZE PARTITION p_future INTO (
    PARTITION p_202610 VALUES LESS THAN (TO_DAYS('2026-10-01')),
    PARTITION p_202611 VALUES LESS THAN (TO_DAYS('2026-11-01')),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);
-- 归档后删除过期分区(保留90天)
ALTER TABLE sli_measurements DROP PARTITION p_202606;
```

### 4.3 Redis 数据结构（v1.1 新增）

| Key | 类型 | TTL | 用途 |
|-----|------|-----|------|
| `slo:sliding:{slo_code}` | Hash | 32d | 滚动窗口日级累计，field=`d:{yyyyMMdd}` value=`{good},{total}`，Lua 原子累加；评估 O(1) 读取 |
| `slo:budget:{slo_code}` | String(JSON) | 10m | 预算热对象 `{remaining_pct, burn_1h/6h/24h, consumed_s, stale, ts}`，门禁/看板读此不查库 |
| `slo:freeze:active` | Hash | 无(变更时淘汰) | field=`service_name` value=冻结 JSON（freeze_id/type/scope/lift_condition），门禁读缓存源 |
| `slo:alert:active:{slo_code}` | Hash | 无 | 当前 FIRING 告警 `{sev: alert_code}`，防抖与升级抑制判定 |
| `slo:collect:cursor:{slo_code}` | String | 无 | 采集游标（最后成功 bucket_start），断点续采 |
| `slo:collect:lock:{shard}` | String(SET NX PX) | 5m | 采集分片互斥锁（8 分片），防双跑双写 |
| `slo:eval:lock` | String(SET NX PX) | 10m | 评估任务全局互斥 |
| `slo:stale:{slo_code}` | String | 30m | 数据陈旧标记（连续 2 个采集周期失败置位，看板与告警降级判定依据） |
| `slo:dashboard:{view_hash}` | String(JSON) | 5m | 看板聚合缓存（overview/service/tier 三视图） |
| `slo:gate:approvers:{approval_id}` | String(JSON) | 24h | 解冻/豁免双人审批进行态 |
| `slo:rl:grpc:{caller}` | String+PEXPIRE | 1m | gRPC 调用方简单限流计数 |

### 4.4 ClickHouse 宽表（v1.1 新增）

MySQL 只保留热数据；长周期趋势、告警投递审计进 ClickHouse（对齐《日志与监控告警体系》的 ES/CH 选型边界，指标归档进 CH）。

```sql
-- SLI 桶归档宽表(MySQL 90天后归档至此,保留3年)
CREATE TABLE slo.slo_measurements_archive ON CLUSTER '{cluster}' (
    slo_code       LowCardinality(String),
    bucket_start   DateTime,
    bucket_minutes UInt8,
    good_count     UInt64,
    total_count    UInt64,
    p50_ms UInt32 DEFAULT 0, p90_ms UInt32 DEFAULT 0,
    p99_ms UInt32 DEFAULT 0, p999_ms UInt32 DEFAULT 0,
    skipped UInt8 DEFAULT 0
) ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(bucket_start)
ORDER BY (slo_code, bucket_start)
TTL toDateTime(bucket_start) + INTERVAL 3 YEAR;

-- 告警通知投递审计(保留1年)
CREATE TABLE slo.slo_alert_delivery_audit ON CLUSTER '{cluster}' (
    alert_code  String,
    slo_code    LowCardinality(String),
    severity    LowCardinality(String),
    channel     LowCardinality(String) COMMENT 'alertmanager/push_fallback',
    delivered_at DateTime,
    success UInt8,
    detail String DEFAULT ''
) ENGINE = MergeTree
PARTITION BY toYYYYMM(delivered_at)
ORDER BY (alert_code, delivered_at)
TTL toDateTime(delivered_at) + INTERVAL 1 YEAR;
```

---

## 5. 核心引擎设计（v1.1）

### 5.1 SLI 采集引擎 (`SliCollector`)

#### 5.1.1 职责与调度

从 Prometheus（权威时序源，对齐《日志与监控告警体系》的 Prometheus 2.x + `/actuator/prometheus` 采集体系）周期拉取每个 ACTIVE SLO 的好/总事件计数，写入桶表、Redis 滑动累计与 ClickHouse 归档。

```text
调度周期: 5分钟(桶边界对齐 +10s 偏移,避免与时序库滚桶竞态)
分片: slo_code hash % 8 并发采集,每分片 SET NX 互斥锁防双跑
查询超时: 单 PromQL 30s;分片总预算 4min,超时剩余 SLO 降级下轮补采
迟到数据: 游标回看 2 个桶,发现差异按 uk 幂等覆盖并回滚 Redis 日累计
```

#### 5.1.2 Recording Rules 下发（快路径）

为避免 60+ SLO × 每周期 2 条即时查询对 Prometheus 的压力，采集前先将好/总事件表达式固化为 recording rules，由 `RulePublisher` 以 ConfigMap + Prometheus Operator reload 方式下发，命名空间 `slo:*`：

```yaml
# 由 RulePublisher 按 slo_definitions 自动生成的规则文件示例
groups:
  - name: slo.ai-dialogue-gateway.availability
    interval: 30s
    rules:
      - record: slo:ai-dialogue-gateway:dialogue_availability:good:rate5m
        expr: sum(rate(http_server_requests_seconds_count{app="ai-dialogue-gateway",status!~"5..|429",uri!~"/health|/ready"}[5m]))
      - record: slo:ai-dialogue-gateway:dialogue_availability:total:rate5m
        expr: sum(rate(http_server_requests_seconds_count{app="ai-dialogue-gateway",uri!~"/health|/ready"}[5m]))
```

采集器优先查询 `slo:{slo}:{sli}:good:rate5m`；规则下发失败（D2）或规则未生效时回退即时表达式查询。

#### 5.1.3 关键代码

```java
@Component
public class SliCollector {

    private static final int LOW_TRAFFIC_MIN_SAMPLES = 100; // G7 默认值,可被 slo 定义覆盖

    @Scheduled(cron = "10 0/5 * * * ?")
    public void collectShard() {
        int shard = ShardContext.currentShard(); // 0..7, 由部署实例序号或 Redis 抢号
        if (!acquireShardLock(shard)) return;
        for (SloDefinition slo : activeSlosOfShard(shard)) {
            try {
                collectOne(slo);
            } catch (PromQueryException e) {
                markStale(slo);                  // 连续 2 次失败置 slo:stale
                log.warn("[SLO] collect fail slo={} err={}", slo.getCode(), e.getMessage());
            }
        }
    }

    void collectOne(SloDefinition slo) {
        Instant bucketStart = lastSuccessCursor(slo); // 对齐 5m
        while (bucketStart.isBefore(now().truncatedTo(5m))) {
            BucketResult g = query(slo, slo.getGoodExpr(), bucketStart); // 优先 recording rule
            BucketResult t = query(slo, slo.getTotalExpr(), bucketStart);
            if (t.getCount() != null && t.getCount() < slo.minSamples(LOW_TRAFFIC_MIN_SAMPLES)) {
                upsertBucket(slo, bucketStart, g.getCount(), t.getCount(), /*skipped=*/true); // G7: 低流量桶不计 SLI/预算
            } else {
                upsertBucket(slo, bucketStart, g.getCount(), t.getCount(), false);
                incrSliding(slo, bucketStart, g.getCount(), t.getCount());
            }
            advanceCursor(slo, bucketStart);
            bucketStart = bucketStart.plus(5, ChronoUnit.MINUTES);
        }
        clearStale(slo);
    }

    /** 桶级幂等: uk_slo_bucket 冲突则覆盖;若覆盖则回滚 Redis 旧值(记 before-image) */
    void upsertBucket(SloDefinition slo, Instant b, long good, long total, boolean skipped) {
        SliMeasurement prev = mapper.findForUpdate(slo.getCode(), b, 5);
        mapper.insertOnDuplicate(new SliMeasurement(slo, b, good, total, skipped, slo.getTarget()));
        if (prev != null && !prev.isSkipped()) rollbackSliding(slo, b, prev); // 迟到重算回滚
        chQueue.asyncAppend(slo, b, good, total); // 异步归档,失败走 D4 WAL
    }
}
```

#### 5.1.4 Redis 滑动累计 Lua（原子拆分累加）

```lua
-- KEYS[1]=slo:sliding:{slo_code} ARGV: day,good,total / rollback_day,prev_good,prev_total
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 1 then
  local g,t = string.match(redis.call('HGET', KEYS[1], ARGV[1]), '(%-?%d+),(%-?%d+)')
  redis.call('HSET', KEYS[1], ARGV[1], (tonumber(g)+tonumber(ARGV[2]))..','..(tonumber(t)+tonumber(ARGV[3])))
else
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[2]..','..ARGV[3])
  redis.call('EXPIRE', KEYS[1], 32*86400)
end
```

#### 5.1.5 与降级的协同

- Prometheus 查询失败 → 备源 VictoriaMetrics（D1）；双失败置 `slo:stale` 标记，看板与告警按陈旧数据降级（告警只记录不外呼，防陈旧数据误炸）。
- ClickHouse 写入失败 → 本地 WAL 文件缓冲，24h 内重放（D4）。

#### 5.1.6 分区管理任务（§4.2.4 的执行体）

每月 1 日 02:00：先归档即将删除分区至 CH，校验行数一致（±0）后 `DROP PARTITION`，再 REORGANIZE 滚动新增分区；任何一步失败中止并 P2 告警，绝不未归档先删。

### 5.2 SLO 评估引擎 (`SloEvaluator`)

#### 5.2.1 计算模型与公式

```text
窗口SLI      = Σgood / Σtotal                     (排除低流量桶, G7)
预算总秒数    budget_seconds  = window_days × 86400 × (100 − target)/100
已消耗秒数    consumed_seconds = Σ_buckets ( bad_ratio_b × bucket_seconds_b )
               bad_ratio_b = (total_b − good_b)/total_b (低流量桶 bad_ratio=0)
剩余百分比    remaining_pct = (budget − consumed)/budget × 100
燃烧率Xh     burn_Xh = ( Σbad/Σtotal over 最近Xh ) / ( (100−target)/100 )
```

> **为什么用“错误比例×桶时长”而非“不达标桶数×时长”**：事件型 SLI 的不可靠体验是连续分布的，按比例折算使预算语义与“用户经历的坏请求占比”一致；夜间低流量桶按 G7 跳过，避免少量请求放大燃烧。

#### 5.2.2 可达性判定（数学违约预警）

```java
boolean achievable(SlidingWindow w, SloDefinition slo, Instant now) {
    long futureDays = slo.getWindowDays() - daysBetween(w.start, now);
    double futureEvents = Math.max(0, dailyAvgEvents(w, 7) * futureDays); // 近7天日均外推
    double bestFinal = (w.goodTotal + futureEvents) * 100.0 / (w.eventTotal + futureEvents);
    return bestFinal >= slo.getTargetPercent(); // false → slo.snapshot.violation 事件
}
```

#### 5.2.3 调度与输出

- 每小时整点全量评估（互斥锁 `slo:eval:lock`），每 10 分钟刷新 Redis 预算热对象（增量：只加新桶）；
- 输出：`slo_window_snapshots` 落库 + `slo:budget:*` 热对象 + 达成 `slo.budget.warning/exhausted`、`slo.snapshot.violation` 事件的 Outbox 写入（与快照同事务）。

### 5.3 多窗口燃烧率告警引擎 (`BurnRateAlerter`)

#### 5.3.1 阈值矩阵（Google SRE 工法 × 服务分级）

| 档位 | 燃烧率 | 长窗口 | 短窗口 | 通知渠道 | 预算消耗含义(28d窗口) | 适用层级 |
|------|--------|--------|--------|----------|----------------------|----------|
| PAGE | 14.4× | 1h | 5m | 电话(经Alertmanager→OnCall升级策略) | 1h烧掉2%预算 | L1 |
| TICKET | 6× | 6h | 30m | IM群+工单 | 6h烧掉5%预算 | L1/L2 |
| IM | 3× | 1d | 2h | IM群 | 1天烧掉10%预算 | L1/L2/L3 |
| LOG | 1× | 3d | 6h | 仅记录看板 | 持续慢烧预警 | L1/L2/L3 |

触发条件：**长窗口与短窗口燃烧率同时 ≥ 阈值**（双窗口 AND，防瞬时毛刺误报）；解除条件：长窗口 < 阈值×0.5 持续 2 个评估周期（滞回）。

#### 5.3.2 告警生命周期关键代码

```java
@Service
public class BurnRateAlerter {

    public void evaluate(SloDefinition slo, BurnRates rates) {
        for (BurnTier tier : slo.tiers()) {          // PAGE→TICKET→IM→LOG 顺序
            if (rates.of(tier.longWindow()) >= tier.rate()
                && rates.of(tier.shortWindow()) >= tier.rate()) {
                fireOrUpgrade(slo, tier, rates);      // G9/G10 防抖与升级
                return;
            }
        }
        autoResolveIfCooled(slo);                     // 滞回解除
    }

    void fireOrUpgrade(SloDefinition slo, BurnTier tier, BurnRates rates) {
        String code = alertCode(slo, tier);           // {slo_code}:{tier}:{window}:{start_bucket}
        if (redis.hasAlert(slo, tier.sev())) { return; }             // 同级FIRING→续期不重建
        suppressLowerTiers(slo, tier);                // 高级触发时低级置SUPPRESSED
        SloAlert alert = repo.createFiring(slo, tier, rates, code);   // alert_code 幂等
        outbox.append("slo.alert.fired", alert);      // 同事务
        notifier.send(alert);                          // Alertmanager v2 API, 失败走 D6 兜底
    }
}
```

#### 5.3.3 预算耗尽独立告警

`remaining_pct ≤ 0` 触发 `BUDGET_EXHAUSTED`（CRITICAL，独立于燃烧率）；同时通知 Alertmanager 对该 SLO 的燃烧率低档告警发送抑制标签，避免预算已耗尽后的重复骚扰。

### 5.4 发布冻结引擎 (`FreezeManager`)

#### 5.4.1 触发与策略

```text
评估引擎发现 remaining_pct ≤ 0 (slo.budget.exhausted)
  → 按该 SLO freeze_policy 裁决:
     FREEZE: L1服务 → HARD_FREEZE(生产部署直接拒绝)
             L2/L3服务 → SOFT_FREEZE(部署需SRE负责人审批)
     WARN:   只发告警不冻结
     NONE:   静默(仅看板展示,用于试运行期SLO)
人工触发: 管理端 POST /freezes/{slo_code}/manual (需双人审批生成) 原因必填
```

#### 5.4.2 发布门禁 CheckReleaseGate（gRPC，供 CI-CD 生产部署前置步骤调用）

```protobuf
service SloPlatform {
  rpc CheckReleaseGate(ReleaseGateRequest) returns (ReleaseGateResponse);
}
message ReleaseGateRequest {
  string service_name = 1;    // 如 ai-dialogue-gateway
  string deploy_type  = 2;    // ROLLOUT/HOTFIX/SECURITY_FIX/ROLLBACK
  string incident_no  = 3;    // HOTFIX 必填,关联OnCall事故编号
  string pipeline_id  = 4;    // 审计
  string approver_token = 5;  // SECURITY_FIX 双人审批令牌
}
message ReleaseGateResponse {
  bool   allowed = 1;
  string reason  = 2;         // 拒绝原因: 56635/56636/56637/56638/56639 等门禁错误码+说明(见§9)
  string freeze_id = 3;
  bool   degraded = 4;        // true=本次判定基于60s本地缓存副本(D5)
}
```

豁免矩阵与 fail-secure 语义：

| deploy_type | HARD_FREEZE | SOFT_FREEZE | 备注 |
|-------------|-------------|-------------|------|
| ROLLOUT 普通发布 | ❌ 拒绝 | ⚠️ 需审批 | 默认路径 |
| HOTFIX 事故修复 | ✅ 放行(须 incident_no 经 OnCall 校验且该事故关联本服务冻结) | ✅ 放行 | 记 exemption_count+1 |
| SECURITY_FIX 安全修复 | ✅ 放行(须双人审批令牌) | ✅ 放行 | 令牌由管理端双人审批生成(24h有效) |
| ROLLBACK 回滚 | ✅ 永远放行 | ✅ 永远放行 | 回滚不设卡(安全网优先) |
| 门禁服务不可用 | ❌ 拒绝(degraded=true,CI 用 60s 本地缓存副本;无缓存副本时除 ROLLBACK 外一律拒绝) | ❌ 同左 | fail-secure:宁可不发,不可误发 |

#### 5.4.3 解冻

- **自动解冻**: 每轮评估检查 `lift_condition`（默认 `remaining_pct >= 25 AND sustained_hours >= 6`）, 满足则 PENDING→AUTO 落库 + 清 `slo:freeze:active` + Outbox `slo.freeze.lifted`；
- **手动解冻**: 管理端发起 → 生成审批单（须 SRE 负责人 + 服务 Owner 双人确认, `lift_approvers` 留痕）→ CAS `lift_type PENDING→MANUAL`；
- 若冻结由 SEV1/SEV2 事故引发（freeze_reason=INCIDENT 且关联 incident_no），附加条件：复盘已在复盘引擎创建（`pm_synced_at IS NOT NULL OR postmortem_status != 'PENDING'`），防止事故未复盘即恢复高风险发布（G13；此条件仅约束解冻，不影响 HOTFIX 豁免链）。

### 5.5 事故关联与预算归因引擎 (`IncidentLinker`)

```text
P1/P2 告警(经Alertmanager) → OnCall系统自动创建事故(INC-YYYYMMDD-NNN,权威)
  ← 回链: 两种途径二选一(以事件优先):
     a) 订阅 oncall.incident.created 事件(含 labels.slo_code) 自动回写 slo_alerts.incident_id
     b) 管理端 PUT /alerts/{id}/link-incident (人工关联,调 OnCall gRPC 校验编号存在性)
事故 MITIGATED/RESOLVED 事件 → 触发预算归因任务:
  对每个关联 slo: Σ [started_at, mitigated_at] 区间桶 bad_ratio×桶时长
  → 写 incident_budget_breakdown(uk幂等,重算覆盖) + incidents.error_budget_cost 汇总
  → Outbox incident.budget.cost.computed (复盘引擎消费,纳入复盘报告影响面)
```

### 5.6 看板聚合引擎 (`DashboardAggregator`)

- 实时视图读 `slo:budget:*` 热对象（10m 新鲜度，陈旧带 `stale` 标记）；
- 趋势视图读 `slo_window_snapshots`（小时粒度）与 CH 归档；
- 三类视图（overview/service/tier）聚合并缓存 5 分钟；对接《管理后台-系统监控与运维管理工作台》前端与 Grafana（CH 数据源）；
- 日终 `daily-report` 任务：各服务 SLO 达标率、预算剩余、燃烧 TOP5、冻结与豁免统计 → 输出 JSON 供《服务端-统一指标中心与数据语义查询引擎》注册消费（指标名命名空间 `slo.*`）。

### 5.7 复盘联动 (`PostmortemSyncer`)

订阅复盘引擎 `postmortem.*` / `action.item.*` 事件，幂等更新本平台 `incidents` 冗余展示字段（postmortem_status/pm_synced_at/action_items 快照）；订阅中断超过 30 分钟看板标记 stale 并重放（D8）。**本平台不建设独立行动项编辑入口**（权威在复盘引擎，G12）。

---

## 6. API 设计（v1.1）

### 6.1 管理端 REST（`/api/v1/slo-platform`，鉴权: 管理后台 RBAC `SLO_ADMIN`/`SLO_VIEWER`）

| 方法 | 路径 | 说明 | 幂等 |
|------|------|------|------|
| POST | `/slo-definitions` | 创建 SLO 定义（表达式先 dry-run 校验） | clientRequestId |
| PUT | `/slo-definitions/{code}` | 修改（ACTIVE 修改需双人审批，产生新表达式版本） | CAS version |
| POST | `/slo-definitions/{code}/pause` | 暂停采集与评估 | 幂等(已 PAUSED 直接 200) |
| POST | `/slo-definitions/{code}/activate` | 激活 | 同上 |
| GET | `/slo-definitions/{code}/budget` | 实时预算（读 Redis 热对象） | - |
| GET | `/slo-definitions/{code}/snapshots?from&to` | 快照趋势 | - |
| GET | `/dashboards/overview?tier&service` | 总览视图 | - |
| POST | `/freezes/{slo_code}/manual` | 人工冻结（双人审批） | 双重提交拒绝 |
| POST | `/freezes/{id}/lift` | 手动解冻（SRE+Owner 双确认） | CAS lift_type |
| GET | `/freezes?status=ACTIVE` | 冻结列表 | - |
| GET | `/alerts?slo_code&status&sev` | 告警列表 | - |
| PUT | `/alerts/{id}/ack` | 认领 | CAS status |
| PUT | `/alerts/{id}/link-incident` | 关联事故编号（OnCall gRPC 校验） | 幂等覆盖 |
| GET | `/incidents?severity&from&to` | SLO 视角事故列表 | - |
| GET | `/incidents/{incident_no}/budget-breakdown` | 预算分摊明细 | - |
| POST | `/rules/publish` | 重下发 recording rules | clientRequestId |
| POST | `/exemptions/approvals` | 生成 SECURITY_FIX 双人令牌 | clientRequestId |
| GET | `/reports/daily?date` | 日报 | - |

### 6.2 内部 gRPC（`slo.platform.v1`）

| 方法 | 调用方 | 说明 |
|------|--------|------|
| `CheckReleaseGate` | CI-CD 流水线（生产部署前置步骤） | §5.4.2；fail-secure |
| `GetBudget` (server-stream) | 灰度发布/弹性伸缩 | 订阅预算变化流（变更推送+30s 心跳） |
| `ResolveSliQuery` | 混沌工程平台 | slo_code → recording rule/即时 PromQL 解析 |
| `GetSloRealtime` | 混沌工程平台 | 批量返回当前 SLI/燃烧率（实验前后对照判定） |
| `GetIncidentExists` | （本平台内部调用 OnCall） | 校验 incident_no（防伪造豁免） |

> CI-CD 现有文档（发布审批/质量门禁）未包含预算冻结门禁步骤，需 CI-CD v1.x 在 production deploy job 增加 `CheckReleaseGate` 前置步骤（见 §16 契约对齐第 7 项）。

### 6.3 服务团队只读查询

各服务团队经管理后台 SSO 查看：本服务 SLO 达标、预算、告警、冻结与豁免历史（`SLO_VIEWER` 角色，无编辑权）；所有查询不含任何用户级数据（仅计数聚合，C1）。

---

## 7. 状态机设计（v1.1）

### 7.1 SLO 定义状态机（`slo_definitions.status`）

```text
  创建(dry-run通过,G1)
        │
        ▼
    ┌────────┐  pause(G4a)    ┌────────┐
    │ ACTIVE │ ◄────────────► │ PAUSED │
    └───┬────┘  activate(G4b) └───┬────┘
        │ deprecate(G3)          │ deprecate(G3)
        ▼                        ▼
    ┌────────────┐
    │ DEPRECATED │ (终态,桶数据90天后随分区归档自然过期)
    └────────────┘
```

| 转换 | 触发入口 | 前置守卫 | 级联动作 |
|------|---------|---------|---------|
| ∅ → ACTIVE | `POST /slo-definitions` | G1：表达式 dry-run 通过；slo_code 全局唯一；freeze_policy ∈ {FREEZE,WARN,NONE} | RulePublisher 增量下发 recording rules（D2 失败回退即时查询并重试）；Outbox `slo.definition.changed(action=CREATED)` |
| ACTIVE → PAUSED | `POST .../pause` | G4a：幂等（已 PAUSED 直接 200） | 退出采集分片与评估清单；存量 FIRING 告警批量转 RESOLVED（resolve_reason=PAUSED）；既有冻结不因暂停而解除（G11 冻结独立存续） |
| PAUSED → ACTIVE | `POST .../activate` | G4b：幂等 | 从 `slo:collect:cursor` 断点续采；暂停期间的桶不回补，窗口快照按 skipped 处理（与 G7 兼容）；恢复告警评估 |
| ACTIVE/PAUSED → DEPRECATED | 管理端下线（双人审批） | G3：无未解除冻结（lift_type=PENDING）；无 FIRING 告警 | 停止采集；规则文件摘除该 SLO；影响面提示：该服务从此无门禁数据 |

> 设计说明：不引入 DRAFT 态。表达式合法性由创建时 dry-run 保证（G1）；ACTIVE 语义变更走“双人审批 + 新表达式版本”（G2），避免半成品定义进入评估。

### 7.2 告警状态机（`slo_alerts.status`）

```text
  双窗口AND触发(G9幂等)
        │
        ▼
    ┌────────┐  PUT /alerts/{id}/ack(CAS)  ┌───────────────┐
    │ FIRING │ ──────────────────────────► │ ACKNOWLEDGED  │
    └─┬──┬───┘                             └───────┬───────┘
      │  │                                         │
      │  │ 高档触发(G10)/BUDGET_EXHAUSTED抑制        │ 滞回解除/人工/SLO暂停
      │  ▼                                         ▼
      │ ┌────────────┐ 抑制源解除且双窗口条件仍满足   ┌──────────┐
      │ │ SUPPRESSED │ ──────回 FIRING──────────── ┌──────────┐
      │ └────────────┘                              │ RESOLVED │(终态)
      └────────────滞回解除──────────────────────── └──────────┘
```

| 转换 | 守卫 | 说明 |
|------|------|------|
| ∅ → FIRING | G9：同 SLO 同档位无存续 FIRING（`slo:alert:active:{slo_code}` 判定），否则仅续期 | alert_code={slo_code}:{tier}:{long}:{short}:{触发桶} 天然幂等 |
| FIRING → ACKNOWLEDGED | CAS status；acknowledged_by 必填 | 认领不改变通知节奏，仅标记责任人 |
| FIRING/ACKNOWLEDGED → SUPPRESSED | G10 | 高档位触发时低档位静默；BUDGET_EXHAUSTED 触发后燃烧率低档抑制（§5.3.3） |
| SUPPRESSED → FIRING | 抑制源解除后需重新满足双窗口条件 | 防止抑制风暴结束后旧告警无脑回弹 |
| FIRING/ACKNOWLEDGED → RESOLVED | 滞回：长窗口 < 阈值×0.5 持续 2 个评估周期 | resolve_reason ∈ {HYSTERESIS,PAUSED,MANUAL}；Outbox `slo.alert.resolved` |

### 7.3 冻结状态机（`release_freezes`，lift_type × 生效语义）

```text
 预算耗尽(freeze_policy=FREEZE) / 人工(G14双人审批)
        │ 创建(G11:同一SLO至多一条PENDING)
        ▼
   ┌──────────┐ 满足lift_condition(G13:INCIDENT冻结需复盘已创建)
   │ PENDING  │─────────────────────────────► AUTO(终态,历史行)
   │ 冻结生效中 │ 手动解冻:双人确认+CAS lift_type
   └──────────┘─────────────────────────────► MANUAL(终态,历史行)
```

- PENDING 即“冻结生效中”：门禁读 `slo:freeze:active`（由 PENDING 行维护）；AUTO/MANUAL 为已解除的历史行，不参与唯一约束（§4.2.3 函数唯一索引）。
- `error_budgets.freeze_status`（NORMAL/WARNING/FROZEN/CRITICAL）**不是独立状态机**，是评估快照的派生展示态：NORMAL(remaining>50%)、WARNING(≤50%)、FROZEN(存在 PENDING 冻结)、CRITICAL(remaining≤0 且 tier=L1)。冻结权威唯一：`release_freezes`。

### 7.4 事故记录（`incidents`）——无独立状态机

事故事中状态（检测/缓解/解决）权威在 OnCall 系统；本平台 incidents 行仅随 `oncall.incident.*` 事件更新展示快照字段（§5.5/§5.7）。G12：本平台不提供任何编辑入口。

### 7.5 状态守卫总表（G1-G14）

| 守卫 | 约束 | 违反后果 |
|------|------|---------|
| G1 | SLO 创建必须通过表达式 dry-run（对 Prometheus 执行一次即时查询验证） | 56602 拒绝创建 |
| G2 | ACTIVE 定义修改必须双人审批通过，落库产生新 expr_version（规则文件按版本重下发） | 56603 拒绝 |
| G3 | DEPRECATED 前必须无未解除冻结、无 FIRING 告警 | 56604 拒绝 |
| G4 | PAUSE/ACTIVATE 幂等；暂停即退出采集/评估/告警；暂停不解除既有冻结（G11 存续） | 状态不变 |
| G5 | 窗口快照按 (slo_code, snapshot_at) 幂等写入，重算覆盖同键 | 无 |
| G6 | `slo:budget:*` 热对象单写者=评估引擎；门禁/看板只读 | 旁路写入记审计 |
| G7 | 低流量桶（total < min_samples，默认 100）计 skipped，不参与 SLI 与预算 | 无 |
| G8 | 采集游标单调前进；迟到覆盖必须回滚 Redis 日累计（before-image） | 数据回滚 |
| G9 | 同 SLO 同档位存续 FIRING 时，再触发仅续期不新建 | 无 |
| G10 | 高档位触发抑制低档位（SUPPRESSED）；BUDGET_EXHAUSTED 抑制燃烧率低档 | 无 |
| G11 | 同一 SLO 同时至多一条 lift_type=PENDING 冻结（函数唯一索引兜底） | 56641 |
| G12 | incidents 展示字段仅由复盘/OnCall 事件驱动同步，禁止本平台编辑 | 接口不存在 |
| G13 | freeze_reason=INCIDENT 的冻结，解冻附加条件：复盘已在复盘引擎创建 | 56643 拒绝 |
| G14 | 人工冻结、手动解冻、SECURITY_FIX 豁免令牌均需双人审批（SRE 负责人 + 服务 Owner），审批留痕 | 56644 拒绝 |

## 8. 幂等与并发控制（v1.1）

### 8.1 采集链路（桶级幂等）

- 写入：`INSERT ... ON DUPLICATE KEY UPDATE` 按 uk_slo_bucket 覆盖；
- 覆盖补偿：覆盖前读取 before-image，若旧桶未 skipped，则按旧值负向回滚 Redis 日累计（§5.1.4 Lua rollback 分支），再累加新值——“迟到重算”不双计；
- 游标：`slo:collect:cursor` 仅在桶落库成功后前进（G8），进程崩溃后从游标重放，天然幂等。

### 8.2 评估与快照

- 全局互斥：`slo:eval:lock`（10 分钟）；锁内完成“读 Redis 滑动累计 → 计算 → 快照落库 → 热对象刷新 → Outbox 追加”；
- 快照幂等：uk_slo_snap 冲突转 UPDATE（G5），任务重跑安全；
- 热对象单写者（G6）：GetBudget 流与门禁读到的是热对象/其推送副本，不存在读己之写问题。

### 8.3 告警创建与升级

- alert_code 唯一键兜底并发双触发（两个评估实例同时 fire）：后插入者捕获 DuplicateKey 后转为续期分支（G9）；
- 升级抑制为单事务批量 CAS：`UPDATE slo_alerts SET status='SUPPRESSED' WHERE slo_code=? AND severity<? AND status IN ('FIRING','ACKNOWLEDGED')`。

### 8.4 冻结创建/解除

- 创建：先取 `slo:freeze:active` 判重（快路径），再 INSERT 依赖 uk_slo_active_freeze 函数唯一索引兜底（G11），冲突转“已存在”读取返回；
- 解除：CAS `UPDATE release_freezes SET lift_type=? WHERE id=? AND lift_type='PENDING'`，影响行数=0 即已被处理（56642）；
- 缓存一致：解冻事务提交后同步 HDEL `slo:freeze:active` 并向门禁副本广播 invalidate（带 freeze_version 单调递增，副本乱序丢弃，见 §8.8）。

### 8.5 SLO 定义修改

- version 乐观锁：`UPDATE ... SET version=version+1 WHERE id=? AND version=?`；
- 审批与落库分离：审批通过仅产生 pending_change 记录，落库仍走 CAS；同一时刻至多一个未落库审批单（部分唯一索引，工法同 §4.2.3）。

### 8.6 Outbox 投递

- event_id 全局唯一（evt_{ulid}）；Relay 投递前 `SELECT ... WHERE status='PENDING' AND next_retry_at<=now FOR UPDATE SKIP LOCKED` 多 worker 抢占；
- 消费方幂等键统一为 `(event_id, consumer)`，见 §10.2；
- 重试：指数退避 2^n（1/2/4/8 分钟起步），第 16 次仍失败置 DEAD 并 P2 告警（D9）。

### 8.7 事故预算归因重算

- `incident_budget_breakdown` uk_incident_slo 幂等；归因区间因事故时间线修订而变化时，重算走“事务内删除该 incident_no 全部分行再重插”，避免区间交叠残留。

### 8.8 门禁并发与副本一致性

- 门禁读路径三级：本地 60s 副本 → Redis `slo:freeze:active` → DB `release_freezes`（逐级穿透）；
- 副本一致性：冻结变更广播带 freeze_version（release_freezes.id 单调），副本仅接受更大版本，防乱序回退（D5 语义）；
- fail-secure：三级全失败时，除 ROLLBACK 外一律拒绝（degraded=true，56639）。

## 9. 错误码（56600-56699，v1.1）

> 段位说明：v1.1 前一工作稿曾在 §5.4.2 引用 565xx 段位，因 56500-56599 已分配给《AI输出质量校验与多模型复核引擎》（其 §12 共 24 项），本版统一收敛为 56600-56699，并向《服务端-统一业务异常码与错误分类体系》注册。

| 错误码 | 语义 | HTTP/gRPC | 调用方处理 |
|--------|------|-----------|-----------|
| 56601 | SLO 定义不存在或已 DEPRECATED | 404 | 前端提示已下线 |
| 56602 | 表达式 dry-run 失败（G1） | 400 | 高亮表达式错误 |
| 56603 | ACTIVE 修改审批未通过/未完成（G2） | 409 | 引导审批队列 |
| 56604 | 状态守卫拒绝（G3/G4） | 409 | 提示前置条件 |
| 56605 | clientRequestId 冲突（同 ID 不同载荷） | 409 | 幂等拒绝 |
| 56611 | 采集查询失败（Prom 与备源双失败） | 内部 | 置 stale（D1） |
| 56612 | 采集分片超预算，剩余 SLO 延后 | 内部 | 下轮补采 |
| 56613 | 分区管理任务失败中止 | 内部 | P2 告警 |
| 56621 | 评估锁冲突或热对象被旁路写入（G6） | 内部 | 记录审计 |
| 56622 | 快照写入冲突重试耗尽 | 500 | 下轮覆盖 |
| 56631 | Alertmanager 通知失败（D6 兜底中） | 内部 | 检查通道 |
| 56632 | 告警处于 SUPPRESSED，操作被拒 | 409 | 无 |
| 56635 | 门禁拒绝：HARD_FREEZE 期间 ROLLOUT | gRPC denied | CI 中止（reason 展示） |
| 56636 | 门禁拦截：SOFT_FREEZE 需 SRE 审批 | gRPC denied | 走审批流 |
| 56637 | 门禁拒绝：incident_no 校验失败/不关联本服务冻结 | gRPC denied | CI 校验参数 |
| 56638 | 门禁拒绝：豁免令牌无效或过期（24h） | gRPC denied | 重新申请 |
| 56639 | 门禁降级拒绝（fail-secure，degraded=true） | gRPC denied | 人工确认后 ROLLBACK 或等待恢复 |
| 56641 | 冻结已存在（G11） | 409 | 返回既有冻结 |
| 56642 | 解冻 CAS 失败（已被处理） | 409 | 刷新状态 |
| 56643 | 解冻条件不满足（G13：复盘未创建） | 409 | 引导复盘引擎 |
| 56644 | 审批人组合非法（须 SRE 负责人+Owner，G14） | 400 | 重新发起 |
| 56651 | OnCall 事故编号不存在 | 404 | 校验编号 |
| 56652 | 归因重算窗口无效（mitigated<started 等） | 400 | 修时间线 |
| 56661 | gRPC 调用方限流（`slo:rl:grpc:*`） | 8 RESOURCE_EXHAUSTED | 退避重试 |
| 56662 | gRPC 参数校验失败 | 3 INVALID_ARGUMENT | 修正参数 |
| 56671 | recording rules 发布失败（D2，已回退即时查询） | 内部 | 观察重试 |
| 56699 | 平台内部错误 | 500 | 联系平台值班 |

## 10. 事件设计（`slo_outbox`，v1.1）

### 10.1 事件类型总表

（信封格式对齐《服务端-事件驱动架构与统一事件总线详细设计》：`{event_id, event_type, producer="slo-platform-service", occurred_at, payload}`）

| event_type | 触发时机 | payload 关键字段 |
|------------|---------|-----------------|
| slo.definition.changed | 创建/修改/暂停/激活/下线落库后 | slo_code, action, expr_version, operator |
| slo.snapshot.violation | 可达性判定 achievable=false（§5.2.2） | slo_code, best_final, target, window_end |
| slo.budget.warning | remaining_pct 首次跌破 50%（每窗口一次） | slo_code, remaining_pct, burn_24h |
| slo.budget.exhausted | remaining_pct ≤ 0（每窗口一次） | slo_code, freeze_policy, tier |
| slo.alert.fired | 告警创建 FIRING | alert_code, slo_code, severity, burn_rate |
| slo.alert.resolved | 告警转 RESOLVED | alert_code, resolve_reason, duration_s |
| slo.alert.suppressed | 告警被抑制 | alert_code, suppressed_by |
| slo.freeze.created | 冻结创建（系统/人工） | freeze_id, slo_code, freeze_type, reason |
| slo.freeze.lifted | 解冻（AUTO/MANUAL） | freeze_id, lift_type, lift_condition_hit, approvers |
| incident.budget.cost.computed | 事故归因核算完成 | incident_no, slos[], total_cost_seconds |
| slo.report.daily.ready | 日终 02:30 日报产出 | date, tier_summary, burn_top5 |
| slo.rules.published | 规则文件版本下发结果 | expr_version, success, failed_slos |

（slo.budget.warning/exhausted 的“每窗口一次”由 `slo:alert:active` 侧 seen 标记去重，防止整窗持续耗尽状态每小时重复发事件。）

### 10.2 消费方矩阵

| event_type | 消费方 | 幂等键 | 用途 |
|-----------|--------|--------|------|
| slo.definition.changed | 混沌工程平台 | (event_id, consumer) | 失效 slo_code→PromQL 解析缓存 |
| | 管理后台-系统监控工作台 | 同上 | 定义变更时间线 |
| slo.snapshot.violation | 系统监控工作台 | 同上 | 数学违约看板卡片 |
| slo.budget.warning / exhausted | 系统监控工作台 | 同上 | 预算水位卡片 |
| | 弹性伸缩引擎 | 同上 | 容量诊断参考输入（只读） |
| slo.alert.fired / resolved / suppressed | 日志与监控告警体系 | 同上 | 告警事件归档与展示（外呼仍走 Alertmanager 直连，事件仅审计） |
| slo.freeze.created / lifted | CI-CD 流水线 | 同上 | 门禁拒绝原因的实时解释（发布页提示） |
| | 系统监控工作台 | 同上 | 冻结时间线 |
| incident.budget.cost.computed | 排障根因分析与复盘引擎 | 同上 | 复盘报告“影响面与预算代价”章节 |
| slo.report.daily.ready | 统一指标中心 | 同上 | slo.* 指标命名空间日快照入库 |
| slo.rules.published | 系统监控工作台 | 同上 | 规则下发健康度 |

### 10.3 本平台订阅的事件

| 订阅事件 | 生产方 | 幂等键 | 处理 |
|---------|--------|--------|------|
| oncall.incident.created | OnCall 系统 | (event_id, "slo-platform") | 按 labels.slo_code 回写 slo_alerts.incident_id（§5.5 途径 a） |
| oncall.incident.mitigated / resolved | OnCall 系统 | 同上 | 触发预算归因任务（§5.5） |
| postmortem.status.changed | 复盘引擎 | 同上 | 幂等更新 incidents.postmortem_status/pm_synced_at（§5.7，G12） |
| action.item.changed | 复盘引擎 | 同上 | 刷新 incidents.action_items 展示快照 |

### 10.4 Relay 与对账

- Relay 进程独立部署 2 实例，SKIP LOCKED 抢占（§8.6）；
- 日终对账：昨日 Outbox PUBLISHED 数 vs 总线 ack 数；DEAD>0 或差异>0 → P2 工单（对齐事件总线 Relay 对账规范）；
- 订阅侧断流 30 分钟 → 看板 stale 标记 + 自动重放（D8）。

---

## 11. 降级矩阵（D1-D10，v1.1）

| 编号 | 故障场景 | 降级策略 | 影响 |
|------|---------|---------|------|
| D1 | Prometheus 查询失败 | 切备源 VictoriaMetrics；双失败置 `slo:stale` | 告警只记录不外呼，防陈旧数据误炸 |
| D2 | recording rules 下发失败/未生效 | 采集回退即时 PromQL 查询（压力升，控制在分片预算内） | 采集变慢（56612 观测） |
| D3 | MySQL 不可用 | 采集暂停（游标保留）；门禁走 Redis 副本 + 最近快照；恢复后断点续采并补桶 | 快照/告警延迟，门禁不受影响 |
| D4 | ClickHouse 写入失败 | 本地 WAL 缓冲 24h 内重放 | 归档延迟 |
| D5 | 门禁服务实例不可用 | CI 用 60s 本地缓存副本；无副本时除 ROLLBACK 外全部拒绝 | fail-secure 宁可不发 |
| D6 | Alertmanager 通知失败 | 兜底通道 push_fallback（值班群机器人直推）+ 重试；CH 审计留痕 | 电话可能降级为 IM |
| D7 | Redis 不可用 | 采集直写 MySQL 桶（评估走 SQL 聚合慢路径）；门禁直查 DB；热对象缺席 | 评估 P99 从 60s 升至 5min 级 |
| D8 | 事件订阅中断 | 30 分钟 stale 标记，恢复后按 cursor 重放 | incidents 冗余字段滞后 |
| D9 | Outbox 投递失败 | 2^n 退避重试，16 次进 DEAD + P2 | 事件延迟 |
| D10 | gRPC 调用过载 | 调用方限流 56661；门禁在过载时按 fail-secure 处理 | CI 退避重试或人工 |

> 红线：任何降级不得“静默放行发布”——门禁所有降级路径的终点都是拒绝，或带 degraded 标记的显式拒绝。

## 12. 监控与告警（平台自监控，M1-M10）

| 指标 | 口径 | 阈值/告警 |
|------|------|----------|
| M1 采集成功率 | 成功 SLO / 计划 ACTIVE SLO（5min 粒度） | <95% P3；<80% P2 |
| M2 stale SLO 数 | `slo:stale` 键数量 | >0 持续 15min P2 |
| M3 评估任务耗时 | 锁内全程耗时 | P99 >120s P3 |
| M4 快照新鲜度 | now − max(snapshot_at)（按 ACTIVE SLO） | >90min P2（含 D3 场景） |
| M5 门禁可用性与延迟 | CheckReleaseGate P99/拒绝率/degraded 比例 | P99>200ms P3；degraded>0 持续 5min P2 |
| M6 Outbox 积压 | 最老 PENDING 年龄 | >5min P3；>30min P2 |
| M7 Relay 成功率 | 投递 ack/尝试 | <99% P2；DEAD 新增 P2 |
| M8 通知通道健康 | Alertmanager 成功率 / 兑底通道占比 | 兑底占比>10% P3 |
| M9 分区归档健康 | 归档行数校验差值（必须 ±0） | ≠0 立即 P2 并中止 DROP |
| M10 豁免异动 | 24h HOTFIX+SECURITY_FIX 豁免次数 | >10 次/日 P3 提示复查发布纪律 |

> 平台自身指标注册进 Prometheus 命名空间 `slo_platform_*`，纳入《日志与监控告警体系》统一告警链路；本表阈值为平台级兑底，团队可自定义订阅。

## 13. 容量估算与性能预算（v1.1）

以 DAU 50 万规模为基准（对齐《非功能性需求-性能优化与容量规划》）：

| 对象 | 估算 | 依据 |
|------|------|------|
| 服务/SLO 数 | 45 服务 / ~70 SLO | §2.2 三级金字塔 + 每服务 1-2 个 SLO |
| sli_measurements | 70×288≈2.0 万行/日；90 天≈182 万行；含索引约 300MB | 5 分钟桶 |
| slo_window_snapshots | 70×24≈1,680 行/日；保留 400 天≈67 万行 | 小时快照 |
| ClickHouse 归档 | 3 年≈2,200 万行（ReplacingMergeTree 压缩后约 2GB） | §4.4 |
| Redis | sliding 70 键×32 field≈1MB 级；budget 70×1KB；冻结/告警键 <100KB | §4.3 |
| Prometheus 查询负载 | 常态 140 次/5min（走 recording rule）；即时回退峰值 +140，P99≤2s | D2 |
| 门禁 QPS | <10（部署时段脉冲） | CI 并发 |
| GetBudget 长连接 | ~20（灰度+弹性伸缩） | server-stream 30s 心跳 |
| 评估任务 | 70 SLO 全量 ≤60s（Redis 读聚合） | §5.2.3 |

部署：slo-platform-service 2 副本（采集分片 8，评估单活锁互斥），Relay 2 副本，独立 MySQL schema `slo` + ClickHouse 库 `slo`。

## 14. 合规红线（C1-C8，v1.1）

| 编号 | 红线 |
|------|------|
| C1 | 平台所有数据仅服务级计数聚合，不含任何用户级数据/PII；SLI 表达式禁止引入 user_id/device_id 维度（§6.3 只读查询同样适用） |
| C2 | 表达式 label 白名单静态扫描：仅允许 app/status/uri/method/env/tier；命中手机号/openid 等 label 直接 dry-run 拒绝（56602） |
| C3 | 定义修改、冻结、解冻、豁免令牌、审批记录全量审计留痕且不可删除，对接《服务端-审计日志与操作追溯系统》 |
| C4 | 双人审批硬约束：ACTIVE 修改/人工冻结/手动解冻/SECURITY_FIX 令牌，审批双方不得为同一人（G14） |
| C5 | 发布豁免仅作用于发布流程，不得绕过内容安全审核、未成年人保护等任何业务合规链路 |
| C6 | 事故影响数据（影响用户数/收入影响）仅内部运维视角可见，任何 C 端（学生/家长/教师）接口不暴露平台运维数据 |
| C7 | 平台告警与通知仅触达内部渠道（Alertmanager/OnCall/值班 IM），不进入 C 端推送通道 |
| C8 | 数据保留：桶 MySQL 90 天 + CH 3 年；告警投递审计 1 年；对齐《服务端-数据归档与生命周期管理策略》并注册其清理清单 |

## 15. 验收场景（18 条）

| # | 场景 | 预期 |
|---|------|------|
| 1 | 创建 SLO 提交非法表达式 | dry-run 拒绝 56602，不产生定义行 |
| 2 | ACTIVE 修改无审批直接落库 | 56603 拒绝；审批通过后 version+1 且规则重下发 |
| 3 | 夜间低流量桶（total=40） | skipped=1，SLI/预算不含该桶（G7） |
| 4 | 迟到数据触发桶覆盖 | Redis 日累计按 before-image 回滚后重加，日总量不双计（G8） |
| 5 | 构造 1h 燃烧率 15×且 5m 14.5×（L1） | PAGE 电话升级，告警含 runbook 链接 |
| 6 | 同档 FIRING 存续时再次满足条件 | 不新建告警（G9），原告警续期 |
| 7 | PAGE 触发时存在 IM 档 FIRING | IM 档转 SUPPRESSED（G10），事件落 slo.alert.suppressed |
| 8 | L1 SLO 预算耗尽（freeze_policy=FREEZE） | 自动创建 HARD_FREEZE，事件 slo.freeze.created，门禁生效 |
| 9 | HARD_FREEZE 期间 ROLLOUT 调门禁 | allowed=false，reason=56635 |
| 10 | HOTFIX 关联真实 incident_no | 放行且 exemption_count+1；伪造编号 56637 拒绝 |
| 11 | SECURITY_FIX 携带过期令牌 | 56638 拒绝；有效令牌消费后一次性失效 |
| 12 | 任意冻结期间 ROLLBACK | 永远放行 |
| 13 | 停掉 slo-platform 全副本 | CI 用 60s 副本；副本过期后除 ROLLBACK 全拒（degraded=true，56639） |
| 14 | INCIDENT 冻结 remaining≥25% 持续 6h 但未创建复盘 | 不自动解冻（56643/G13）；复盘创建后下轮解冻 |
| 15 | 手动解冻仅 SRE 单人确认 | 56644 拒绝；双确认后 CAS 成功且 lift_approvers 留痕 |
| 16 | 事故时间线修订后重算归因 | breakdown 按事务整体重写，无区间交叠残留（§8.7） |
| 17 | 在本平台尝试编辑事故根因 | 无编辑入口（G12）；复盘引擎事件驱动字段变化一次同步 |
| 18 | 分区归档 CH 行数与 MySQL 不一致 | 任务中止不 DROP，P2 告警（M9/§5.1.6） |

## 16. 契约对齐（v1.1）

| # | 对端文档 | 对齐内容 |
|---|---------|---------|
| 1 | 《日志与监控告警体系-详细设计》 | Prometheus 为权威时序源；recording rules 命名空间 slo:* 由本平台 RulePublisher 独占管理；Alertmanager 为唯一外呼通道（本平台不重复建设通知） |
| 2 | 《生产事故应急响应与OnCall值班调度体系-详细设计》 | 事故事中权威=OnCall（incident_no=INC-YYYYMMDD-NNN）；本平台 incidents 仅 SLO 视角核算（§4.2.2）；GetIncidentExists 用于防伪造豁免 |
| 3 | 《排障根因分析与系统故障复盘引擎-详细设计》 | 复盘与行动项权威=复盘引擎；incident.budget.cost.computed 供复盘影响面章节消费；G12/G13 依赖其 postmortem.status.changed 事件 |
| 4 | 《服务端-事件驱动架构与统一事件总线详细设计》 | slo_outbox 信封 producer=slo-platform-service；Relay 日终对账；消费方 (event_id,consumer) 幂等规范 |
| 5 | 《管理后台-系统监控与运维管理工作台-详细设计》 | 看板三视图（overview/service/tier）由工作台承载；RBAC 注册 SLO_ADMIN/SLO_VIEWER 两角色 |
| 6 | 《服务端-混沌工程实践与系统韧性自动化验证平台-详细设计》 | ResolveSliQuery/GetSloRealtime 供实验前后对照；生产混沌实验须先 PAUSE 相关 SLO 并留审计（G4），实验结束 activate |
| 7 | 《CI-CD流水线与自动化构建发布系统-详细设计》 | production deploy job 需新增 CheckReleaseGate 前置步骤（deploy_type/incident_no/approver_token 参数规范见 §5.4.2）；ROLLBACK 不设卡；fail-secure（D5）为门禁不可用时的唯一合法行为 |
| 8 | 《灰度发布与特性开关系统-详细设计》 | GetBudget server-stream（变更推送+30s 心跳）作为灰度收敛决策的只读输入；灰度平台自主决策，本平台不下发指令 |
| 9 | 《服务端-教育平台弹性伸缩与智能容量自适应调度引擎-详细设计》 | 同第 8 项消费预算流作容量诊断参考；不形成自动扩缩容强依赖（D1/D3 时伸缩须可独立运行） |
| 10 | 《服务端-统一指标中心与数据语义查询引擎-详细设计》 | slo.* 指标命名空间注册；日报 JSON（slo.report.daily.ready payload）为其日快照源 |
| 11 | 《服务端-数据归档与生命周期管理策略-详细设计》 | 桶 90 天/CH 3 年/审计 1 年保留策略注册进统一清理清单；分区 DROP 前置归档校验（M9） |
| 12 | 《服务端-统一业务异常码与错误分类体系-详细设计》 | 56600-56699 段位注册（本版弃用 565xx 草稿段位，避免与 AI 输出质量校验引擎冲突） |

## 维护记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-06-26 | 初版（§1-§5 部分；文件截断于 release_freezes 表 lift 字段定义处） |
| v1.1 | 2026-08-19 | 烂尾补全（两次会话接力）：补齐 §4.1.6 解冻语义与 §4.1.7-§4.1.9 三表（快照/Outbox/事故分摊）、§4.2 四项 DDL 缺陷修正（is_meeting 恒真、incidents 权威边界、函数唯一索引、分区滚动）、§4.3 Redis 十类键、§4.4 ClickHouse 宽表、§5 七引擎、§6 API；本轮接续补齐 §7 四套状态机与守卫 G1-G14、§8 幂等并发八节、§9 错误码 56600-56699 共 27 项（收敛与 AI 输出质量校验引擎冲突的 565xx 草稿段位）、§10 事件 12 类与消费/订阅/对账矩阵、§11 降级 D1-D10、§12 监控 M1-M10、§13 容量估算、§14 合规 C1-C8、§15 验收 18 条、§16 契约对齐 12 项 |