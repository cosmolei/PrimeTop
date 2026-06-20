# AI 模型版本生命周期管理与灰度发布决策引擎 - 详细设计

> **模块定位**：AI 能力层 / 模型治理基础设施
>
> **文档版本**：v1.0　**最后更新**：2026-06-21
>
> **关联文档**：
> - `多模型调度与成本治理-详细设计.md` — 运行时模型路由与选型
> - `AI模型调用多供应商容灾切换与自动降级引擎-详细设计.md` — 故障切换
> - `AI模型评测基准与质量回归测试系统-详细设计.md` — 质量评测
> - `灰度发布与特性开关系统-详细设计.md` — 通用灰度基础设施
> - `AI-Prompt编排与场景模板系统-详细设计.md` — Prompt 模板管理
> - `配置中心与动态配置管理-详细设计.md` — 动态配置

---

## 1. 背景与目标

### 1.1 问题陈述

PrimeTop 接入多家 AI 模型供应商（如 OpenAI、Anthropic、智谱、百度文心、阿里通义等），每个供应商又有多个模型版本（GPT-4o、GPT-4o-mini、GLM-4-Flash 等）。日常运营中频繁面临以下场景：

| 场景 | 当前痛点 |
| --- | --- |
| 模型供应商发布新版本 | 缺乏标准化评估流程，凭感觉切换 |
| Prompt 模板更新后需匹配新模型 | 新旧模型对同一 Prompt 的响应差异大 |
| 某模型供应商涨价 | 紧急切换缺乏灰度过渡，直接全量切导致质量波动 |
| 发现某模型在特定学科表现差 | 无法快速回退到上一稳定版本 |
| A/B 测试不同模型效果 | 测试配置分散，缺乏统一的流量分配和指标采集 |
| 成本优化需逐步将流量切到更便宜模型 | 缺乏细粒度流量控制和自动质量保障 |

### 1.2 设计目标

1. **统一模型注册**：所有 AI 模型（含供应商、版本、参数、价格）在统一注册中心管理。
2. **全生命周期管控**：从注册 → 评测 → 灰度 → 上线 → 监控 → 迭代/退役，每一步有明确的准入/准出门禁。
3. **安全灰度发布**：支持按百分比、用户分群、场景维度逐步切换流量，异常自动回滚。
4. **质量门禁**：每次模型变更必须通过自动化评测基线，防止质量倒退。
5. **成本可追踪**：每个模型版本的调用成本、质量得分、用户满意度一屏可见。
6. **一键回滚**：任何模型变更可秒级回退到上一个稳定版本。

### 1.3 与现有系统的关系

```
┌──────────────────────────────────────────────────────┐
│              本引擎 (Model Version Lifecycle)         │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │ 模型注册 │  │ 灰度编排 │  │ 质量门禁 & 回滚    │  │
│  └─────┬────┘  └─────┬────┘  └─────────┬──────────┘  │
└────────┼─────────────┼────────────────┼──────────────┘
         │             │                │
    ┌────▼────┐   ┌────▼────┐    ┌──────▼──────┐
    │配置中心  │   │流量路由 │    │评测基准系统 │
    │(动态配置)│   │(网关层) │    │(自动回归)   │
    └─────────┘   └─────────┘    └─────────────┘
         │             │                │
    ┌────▼────┐   ┌────▼────┐    ┌──────▼──────┐
    │多模型   │   │容灾切换 │    │Token计量 &  │
    │调度引擎 │   │引擎     │    │成本归集     │
    └─────────┘   └─────────┘    └─────────────┘
```

- **配置中心**：本引擎将模型版本配置推送到配置中心，各服务通过配置中心获取当前生效的模型配置。
- **多模型调度引擎**：运行时根据本引擎输出的流量分配规则选择具体模型。
- **容灾切换引擎**：处理模型故障时的紧急切换，与本引擎的灰度发布共享流量路由基础设施。
- **评测基准系统**：本引擎在模型准入和灰度监控阶段调用评测系统生成质量报告。

---

## 2. 核心概念

### 2.1 术语表

| 术语 | 定义 |
| --- | --- |
| **Model Provider** | 模型供应商，如 OpenAI、Anthropic、智谱 |
| **Model Variant** | 供应商下的具体模型，如 `gpt-4o`、`gpt-4o-mini`、`glm-4-flash` |
| **Model Version** | 模型的快照配置，包含供应商、模型名、API 参数、Prompt 版本、评测报告的组合 |
| **Scene** | 使用场景，如 `general_qa`（通用问答）、`math_solve`（数学解题）、`essay_grade`（作文批改） |
| **Release** | 一次模型版本发布活动，包含灰度计划、流量规则、监控配置 |
| **Quality Gate** | 质量门禁，模型版本变更前必须通过的自动化检查项集合 |
| **Canary** | 灰度阶段，新模型版本仅接收部分流量 |

### 2.2 模型版本生命周期状态机

```
    ┌────────┐  注册/导入
    │ DRAFT  │──────────────────────────────┐
    └───┬────┘                              │
        │ 提交评测                           │
        ▼                                   │
    ┌────────┐  评测通过                     │
    │TESTING │──────────────┐               │
    └───┬────┘              │               │
        │ 评测失败           │               │
        ▼                   ▼               │
    ┌────────┐        ┌──────────┐          │
    │REJECTED│        │ STAGING  │          │
    └────────┘        └────┬─────┘          │
                           │ 创建灰度发布    │
                           ▼                 │
                     ┌──────────┐           │
                     │ CANARY   │           │
                     └────┬─────┘           │
                      ├───┤                 │
              回滚 ◀──┤   ├──▶ 加灰度比例    │
                      ▼                       │
                ┌──────────┐                 │
                │ ACTIVE   │◀──── 全量上线   │
                └────┬─────┘                 │
                     │ 新版本上线后          │
                     ▼                       │
                ┌──────────┐                 │
                │DEPRECATED│                 │
                └────┬─────┘                 │
                     │ 数据归档完毕          │
                     ▼                       │
                ┌──────────┐                 │
                │ RETIRED  │                 │
                └──────────┘                 │
```

| 状态 | 说明 | 允许的操作 |
| --- | --- | --- |
| `DRAFT` | 新注册或导入的模型版本，尚未评测 | 编辑配置、提交评测、删除 |
| `TESTING` | 正在执行自动化评测 | 查看评测进度、取消评测 |
| `REJECTED` | 评测未通过质量门禁 | 修改配置后重新提交、归档 |
| `STAGING` | 评测通过，等待创建灰度发布 | 创建灰度发布、设为候选版本 |
| `CANARY` | 灰度进行中，接收部分流量 | 调整流量比例、回滚、全量上线 |
| `ACTIVE` | 当前生产环境主力版本 | 监控、设为回退版本、发起替换 |
| `DEPRECATED` | 已被新版本替换，不再接收新流量 | 查看历史数据、归档 |
| `RETIRED` | 完全下线，数据已归档 | 查询归档数据 |

---

## 3. 数据结构设计

### 3.1 模型供应商表 `ai_model_provider`

```sql
CREATE TABLE `ai_model_provider` (
    `provider_id`       VARCHAR(32)     NOT NULL COMMENT '供应商唯一标识，如 openai, anthropic, zhipu',
    `provider_name`     VARCHAR(64)     NOT NULL COMMENT '供应商显示名称',
    `api_base_url`      VARCHAR(256)    NOT NULL COMMENT 'API 基础地址',
    `auth_type`         VARCHAR(16)     NOT NULL DEFAULT 'api_key' COMMENT '认证方式: api_key / oauth2',
    `auth_key_ref`      VARCHAR(128)            COMMENT '密钥引用名(指向密钥管理系统)',
    `rate_limit_rpm`    INT             NOT NULL DEFAULT 60 COMMENT '供应商级 RPM 限制',
    `rate_limit_tpm`    INT             NOT NULL DEFAULT 60000 COMMENT '供应商级 TPM 限制',
    `timeout_ms`        INT             NOT NULL DEFAULT 30000 COMMENT '默认超时时间',
    `retry_count`       INT             NOT NULL DEFAULT 2 COMMENT '默认重试次数',
    `status`            VARCHAR(16)     NOT NULL DEFAULT 'active' COMMENT 'active / suspended / deprecated',
    `contract_start`    DATE                     COMMENT '商务合同开始日期',
    `contract_end`      DATE                     COMMENT '商务合同结束日期',
    `created_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`provider_id`),
    INDEX `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI模型供应商信息';
```

### 3.2 模型变体表 `ai_model_variant`

```sql
CREATE TABLE `ai_model_variant` (
    `variant_id`        BIGINT          NOT NULL AUTO_INCREMENT COMMENT '模型变体ID',
    `provider_id`       VARCHAR(32)     NOT NULL COMMENT '所属供应商',
    `model_name`        VARCHAR(64)     NOT NULL COMMENT '模型名称，如 gpt-4o, glm-4-flash',
    `display_name`      VARCHAR(128)    NOT NULL COMMENT '展示名称',
    `modality`          VARCHAR(32)     NOT NULL COMMENT '能力类型: text / multimodal / embedding / voice',
    `max_input_tokens`  INT             NOT NULL COMMENT '最大输入 Token 数',
    `max_output_tokens` INT             NOT NULL COMMENT '最大输出 Token 数',
    `supports_stream`   TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '是否支持流式输出',
    `supports_function_call` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否支持函数调用',
    `supports_vision`   TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '是否支持图像输入',
    `input_price_per_1k`  DECIMAL(10,6) NOT NULL DEFAULT 0 COMMENT '输入每1K Token价格(元)',
    `output_price_per_1k` DECIMAL(10,6) NOT NULL DEFAULT 0 COMMENT '输出每1K Token价格(元)',
    `currency`          VARCHAR(8)      NOT NULL DEFAULT 'CNY' COMMENT '计价币种',
    `latency_p50_ms`    INT                     COMMENT 'P50 延迟基准(ms)',
    `latency_p99_ms`    INT                     COMMENT 'P99 延迟基准(ms)',
    `status`            VARCHAR(16)     NOT NULL DEFAULT 'active' COMMENT 'active / deprecated',
    `created_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`variant_id`),
    UNIQUE KEY `uk_provider_model` (`provider_id`, `model_name`),
    INDEX `idx_modality` (`modality`),
    INDEX `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI模型变体信息';
```

### 3.3 模型版本表 `ai_model_version`（核心表）

```sql
CREATE TABLE `ai_model_version` (
    `version_id`        VARCHAR(40)     NOT NULL COMMENT '版本唯一标识，如 mv_20260621_gpt4o_v2',
    `variant_id`        BIGINT          NOT NULL COMMENT '关联的模型变体',
    `scene_code`        VARCHAR(32)     NOT NULL COMMENT '使用场景: general_qa / math_solve / essay_grade 等',
    `version_label`     VARCHAR(64)     NOT NULL COMMENT '版本标签，如 v2.1-gpt4o-optimized',
    `version_desc`      TEXT                    COMMENT '版本描述，说明本次变更内容',

    -- 模型调用参数
    `temperature`       DECIMAL(3,2)    NOT NULL DEFAULT 0.30 COMMENT '温度参数',
    `top_p`             DECIMAL(3,2)    NOT NULL DEFAULT 0.90 COMMENT 'Top-P',
    `max_tokens`        INT             NOT NULL DEFAULT 4096 COMMENT '单次最大输出 Token',
    `frequency_penalty` DECIMAL(3,2)    NOT NULL DEFAULT 0.00 COMMENT '频率惩罚',
    `presence_penalty`  DECIMAL(3,2)    NOT NULL DEFAULT 0.00 COMMENT '存在惩罚',
    `stop_sequences`    JSON                     COMMENT '停止序列',

    -- Prompt 关联
    `prompt_template_id` VARCHAR(40)             COMMENT '关联的 Prompt 模板 ID',
    `system_prompt_hash` VARCHAR(64)             COMMENT 'System Prompt 内容哈希(快速比对)',

    -- 评测信息
    `eval_report_id`    VARCHAR(40)             COMMENT '最近一次评测报告 ID',
    `eval_score`        DECIMAL(5,2)            COMMENT '评测综合得分(0-100)',
    `eval_accuracy`     DECIMAL(5,2)            COMMENT '准确率(%)',
    `eval_latency_ms`   INT                     COMMENT '评测平均延迟(ms)',
    `eval_cost_per_call` DECIMAL(10,4)          COMMENT '评测单次调用成本(元)',

    -- 生命周期
    `lifecycle_state`   VARCHAR(16)     NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/TESTING/REJECTED/STAGING/CANARY/ACTIVE/DEPRECATED/RETIRED',
    `previous_version_id` VARCHAR(40)           COMMENT '上一活跃版本(用于回滚)',
    `activated_at`      DATETIME(3)             COMMENT '成为 ACTIVE 的时间',
    `deprecated_at`     DATETIME(3)             COMMENT '被替换的时间',

    -- 审计
    `created_by`        VARCHAR(64)     NOT NULL COMMENT '创建人',
    `approved_by`       VARCHAR(64)             COMMENT '审批人',
    `created_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`version_id`),
    INDEX `idx_variant_scene` (`variant_id`, `scene_code`),
    INDEX `idx_scene_state` (`scene_code`, `lifecycle_state`),
    INDEX `idx_lifecycle` (`lifecycle_state`),
    CONSTRAINT `fk_mv_variant` FOREIGN KEY (`variant_id`) REFERENCES `ai_model_variant`(`variant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI模型版本(核心表)';
```

### 3.4 灰度发布表 `ai_model_release`

```sql
CREATE TABLE `ai_model_release` (
    `release_id`        VARCHAR(40)     NOT NULL COMMENT '发布 ID',
    `scene_code`        VARCHAR(32)     NOT NULL COMMENT '场景代码',
    `candidate_version_id` VARCHAR(40)  NOT NULL COMMENT '灰度候选版本',
    `baseline_version_id` VARCHAR(40)   NOT NULL COMMENT '当前基线(回滚目标)版本',
    `release_type`      VARCHAR(16)     NOT NULL COMMENT 'canary(灰度) / immediate(紧急切换) / rollback(回滚)',

    -- 流量分配
    `traffic_strategy`  VARCHAR(16)     NOT NULL DEFAULT 'percentage' COMMENT 'percentage / whitelist / scene_rule',
    `traffic_percentage` DECIMAL(5,2)   NOT NULL DEFAULT 0.00 COMMENT '灰度流量百分比(0-100)',
    `whitelist_key`     VARCHAR(128)             COMMENT '白名单配置 Key(策略为 whitelist 时)',
    `scene_rule_json`   JSON                     COMMENT '场景路由规则(策略为 scene_rule 时)',

    -- 灰度阶梯
    `ramp_up_strategy`  JSON            NOT NULL COMMENT '灰度阶梯计划',
    /*
     * ramp_up_strategy 示例:
     * {
     *   "steps": [
     *     {"percentage": 5,  "duration_min": 30, "auto_promote": true},
     *     {"percentage": 20, "duration_min": 60, "auto_promote": true},
     *     {"percentage": 50, "duration_min": 120, "auto_promote": true},
     *     {"percentage": 100,"duration_min": 0,  "auto_promote": false}
     *   ],
     *   "current_step": 0
     * }
     */

    -- 质量门禁
    `gate_config`       JSON            NOT NULL COMMENT '质量门禁配置',
    /*
     * gate_config 示例:
     * {
     *   "min_accuracy": 85.0,
     *   "max_latency_p99_ms": 8000,
     *   "max_error_rate": 0.02,
     *   "min_user_satisfaction": 4.0,
     *   "max_cost_increase_pct": 20,
     *   "evaluation_dataset": "eval_golden_v3"
     * }
     */

    -- 监控快照
    `current_metrics`   JSON                     COMMENT '当前实时指标快照',
    /*
     * current_metrics 示例:
     * {
     *   "candidate": {"accuracy": 88.5, "latency_p50": 1200, "latency_p99": 3500,
     *                 "error_rate": 0.008, "satisfaction": 4.3, "cost_per_call": 0.012},
     *   "baseline":  {"accuracy": 87.2, "latency_p50": 1100, "latency_p99": 3200,
     *                 "error_rate": 0.010, "satisfaction": 4.2, "cost_per_call": 0.011},
     *   "updated_at": "2026-06-21T10:30:00Z"
     * }
     */

    -- 状态
    `release_state`     VARCHAR(16)     NOT NULL DEFAULT 'pending' COMMENT 'pending / running / paused / completed / rolled_back / aborted',
    `pause_reason`      VARCHAR(256)            COMMENT '暂停原因',
    `started_at`        DATETIME(3)             COMMENT '灰度开始时间',
    `completed_at`      DATETIME(3)             COMMENT '灰度完成时间(全量上线或回滚)',

    -- 操作人
    `created_by`        VARCHAR(64)     NOT NULL,
    `created_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`release_id`),
    INDEX `idx_scene_state` (`scene_code`, `release_state`),
    INDEX `idx_candidate` (`candidate_version_id`),
    CONSTRAINT `fk_release_candidate` FOREIGN KEY (`candidate_version_id`) REFERENCES `ai_model_version`(`version_id`),
    CONSTRAINT `fk_release_baseline` FOREIGN KEY (`baseline_version_id`) REFERENCES `ai_model_version`(`version_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI模型灰度发布记录';
```

### 3.5 发布事件日志表 `ai_model_release_event`

```sql
CREATE TABLE `ai_model_release_event` (
    `event_id`          BIGINT          NOT NULL AUTO_INCREMENT,
    `release_id`        VARCHAR(40)     NOT NULL COMMENT '关联的发布 ID',
    `event_type`        VARCHAR(32)     NOT NULL COMMENT 'created/step_promoted/quality_check_passed/quality_check_failed/paused/resumed/completed/rolled_back/auto_rollback_triggered/gate_breached',
    `event_detail`      JSON            NOT NULL COMMENT '事件详情',
    `operator`          VARCHAR(64)             COMMENT '操作人(系统自动时为 "system")',
    `operator_type`     VARCHAR(16)     NOT NULL DEFAULT 'human' COMMENT 'human / system',
    `created_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`event_id`),
    INDEX `idx_release_event` (`release_id`, `created_at`),
    CONSTRAINT `fk_event_release` FOREIGN KEY (`release_id`) REFERENCES `ai_model_release`(`release_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='模型发布事件日志';
```

### 3.6 场景-版本绑定缓存结构 (Redis)

```
# Key: ai:scene_routing:{scene_code}
# Value: JSON
{
    "active_version": "mv_20260615_gpt4o_v1",       // 当前 ACTIVE 版本
    "canary_release_id": "rls_20260621_001",         // 进行中的灰度发布ID (无则 null)
    "routing_rules": [
        {
            "match": {"user_segment": "whitelist:beta_testers"},
            "target_version": "mv_20260621_gpt4o_v2",
            "weight": 100
        },
        {
            "match": {},
            "target_version": "mv_20260621_gpt4o_v2",  // 候选版本
            "weight": 5                                   // 5% 流量
        },
        {
            "match": {},
            "target_version": "mv_20260615_gpt4o_v1",   // 基线版本
            "weight": 95                                  // 95% 流量
        }
    ],
    "updated_at": "2026-06-21T10:00:00Z",
    "config_version": 42
}

# TTL: 无 (持久化 Key，变更时主动推送)
# 发布: 通过 Pub/Sub 频道 `ai:model_routing:update` 通知所有服务实例刷新本地缓存
```

---

## 4. API 接口设计

### 4.1 模型版本管理 API

#### 4.1.1 注册新模型版本

```
POST /api/admin/ai/model-versions
```

**Request Body:**
```json
{
    "variant_id": 15,
    "scene_code": "general_qa",
    "version_label": "v2.1-gpt4o-optimized",
    "version_desc": "降低 temperature 至 0.2，更新 system prompt 以改善低年级回答的简洁性",
    "parameters": {
        "temperature": 0.20,
        "top_p": 0.90,
        "max_tokens": 4096,
        "frequency_penalty": 0.0,
        "presence_penalty": 0.0
    },
    "prompt_template_id": "pt_20260620_general_v3",
    "previous_version_id": "mv_20260615_gpt4o_v1"
}
```

**Response (201):**
```json
{
    "code": 0,
    "data": {
        "version_id": "mv_20260621_gpt4o_v2",
        "lifecycle_state": "DRAFT",
        "created_at": "2026-06-21T10:00:00.000Z"
    }
}
```

#### 4.1.2 提交评测（触发质量门禁）

```
POST /api/admin/ai/model-versions/{version_id}/evaluate
```

**Request Body:**
```json
{
    "evaluation_dataset": "eval_golden_v3",
    "sample_size": 500,
    "timeout_minutes": 30
}
```

**Response (202):**
```json
{
    "code": 0,
    "data": {
        "eval_task_id": "eval_task_20260621_001",
        "version_id": "mv_20260621_gpt4o_v2",
        "lifecycle_state": "TESTING",
        "estimated_completion": "2026-06-21T10:25:00.000Z"
    }
}
```

#### 4.1.3 查询版本详情（含评测结果）

```
GET /api/admin/ai/model-versions/{version_id}
```

**Response:**
```json
{
    "code": 0,
    "data": {
        "version_id": "mv_20260621_gpt4o_v2",
        "variant_id": 15,
        "provider_id": "openai",
        "model_name": "gpt-4o",
        "scene_code": "general_qa",
        "version_label": "v2.1-gpt4o-optimized",
        "version_desc": "降低 temperature 至 0.2...",
        "parameters": {
            "temperature": 0.20,
            "top_p": 0.90,
            "max_tokens": 4096
        },
        "prompt_template_id": "pt_20260620_general_v3",
        "lifecycle_state": "STAGING",
        "eval_report": {
            "eval_score": 89.5,
            "eval_accuracy": 88.2,
            "eval_latency_ms": 1450,
            "eval_cost_per_call": 0.014,
            "report_url": "/api/admin/ai/eval-reports/eval_task_20260621_001"
        },
        "previous_version_id": "mv_20260615_gpt4o_v1",
        "created_by": "ai_engineer_01",
        "created_at": "2026-06-21T10:00:00.000Z"
    }
}
```

#### 4.1.4 查询场景下的版本列表

```
GET /api/admin/ai/model-versions?scene_code=general_qa&state=ACTIVE,CANARY,STAGING
```

### 4.2 灰度发布管理 API

#### 4.2.1 创建灰度发布

```
POST /api/admin/ai/releases
```

**Request Body:**
```json
{
    "scene_code": "general_qa",
    "candidate_version_id": "mv_20260621_gpt4o_v2",
    "release_type": "canary",
    "ramp_up_strategy": {
        "steps": [
            {"percentage": 5,  "duration_min": 30, "auto_promote": true},
            {"percentage": 20, "duration_min": 60, "auto_promote": true},
            {"percentage": 50, "duration_min": 120, "auto_promote": true},
            {"percentage": 100, "duration_min": 0, "auto_promote": false}
        ]
    },
    "gate_config": {
        "min_accuracy": 85.0,
        "max_latency_p99_ms": 8000,
        "max_error_rate": 0.02,
        "min_user_satisfaction": 4.0,
        "max_cost_increase_pct": 20,
        "check_interval_sec": 60
    }
}
```

**Response (201):**
```json
{
    "code": 0,
    "data": {
        "release_id": "rls_20260621_001",
        "release_state": "pending",
        "candidate_version_id": "mv_20260621_gpt4o_v2",
        "baseline_version_id": "mv_20260615_gpt4o_v1",
        "created_at": "2026-06-21T10:05:00.000Z"
    }
}
```

> 系统自动将 `baseline_version_id` 设为该场景当前的 ACTIVE 版本。

#### 4.2.2 启动灰度

```
POST /api/admin/ai/releases/{release_id}/start
```

系统执行以下操作：
1. 校验 candidate 版本处于 `STAGING` 状态
2. 推送流量路由规则到配置中心 / Redis
3. 将 candidate 版本状态改为 `CANARY`
4. 发布事件 `created` + `step_promoted(5%)`
5. 启动定时质量监控任务

#### 4.2.3 手动推进灰度阶梯

```
POST /api/admin/ai/releases/{release_id}/promote
```

**Request Body:**
```json
{
    "target_percentage": 20,
    "skip_gate_check": false
}
```

#### 4.2.4 暂停灰度

```
POST /api/admin/ai/releases/{release_id}/pause
```

**Request Body:**
```json
{
    "reason": "准确率出现波动，需人工分析"
}
```

暂停后流量分配冻结在当前比例。

#### 4.2.5 全量上线

```
POST /api/admin/ai/releases/{release_id}/complete
```

系统执行：
1. 将 candidate 版本设为 `ACTIVE`
2. 将 baseline 版本设为 `DEPRECATED`，记录 `previous_version_id`
3. 更新场景路由规则为 100% 指向新版本
4. 发布事件 `completed`

#### 4.2.6 回滚

```
POST /api/admin/ai/releases/{release_id}/rollback
```

**Request Body:**
```json
{
    "reason": "P99 延迟超出阈值且用户满意度下降"
}
```

系统执行：
1. 流量路由 100% 切回 baseline 版本
2. Candidate 版本状态改为 `REJECTED`
3. 发布事件 `rolled_back`
4. 记录回滚原因供后续分析

#### 4.2.7 查询灰度发布详情与实时指标

```
GET /api/admin/ai/releases/{release_id}
```

**Response:**
```json
{
    "code": 0,
    "data": {
        "release_id": "rls_20260621_001",
        "scene_code": "general_qa",
        "candidate_version_id": "mv_20260621_gpt4o_v2",
        "baseline_version_id": "mv_20260615_gpt4o_v1",
        "release_state": "running",
        "traffic_percentage": 20.0,
        "current_step": 1,
        "total_steps": 4,
        "gate_config": { "...": "..." },
        "current_metrics": {
            "candidate": {
                "accuracy": 88.5,
                "latency_p50": 1200,
                "latency_p99": 3500,
                "error_rate": 0.008,
                "satisfaction": 4.3,
                "cost_per_call": 0.014,
                "sample_count": 3420
            },
            "baseline": {
                "accuracy": 87.2,
                "latency_p50": 1100,
                "latency_p99": 3200,
                "error_rate": 0.010,
                "satisfaction": 4.2,
                "cost_per_call": 0.011,
                "sample_count": 16250
            },
            "gate_status": {
                "accuracy": "PASS",
                "latency_p99": "PASS",
                "error_rate": "PASS",
                "satisfaction": "PASS",
                "cost_increase": "WARN (+27%)"
            },
            "overall_verdict": "PASS_WITH_WARNING",
            "updated_at": "2026-06-21T11:00:00Z"
        },
        "events": [
            {"event_type": "created", "operator": "ai_engineer_01", "created_at": "2026-06-21T10:05:00Z"},
            {"event_type": "step_promoted", "event_detail": {"from": 0, "to": 5}, "operator": "system", "created_at": "2026-06-21T10:05:30Z"},
            {"event_type": "quality_check_passed", "event_detail": {"step": 0, "score": 89.5}, "operator": "system", "created_at": "2026-06-21T10:35:30Z"},
            {"event_type": "step_promoted", "event_detail": {"from": 5, "to": 20}, "operator": "system", "created_at": "2026-06-21T10:36:00Z"}
        ],
        "started_at": "2026-06-21T10:05:30Z"
    }
}
```

### 4.3 运行时路由查询 API（供业务服务调用）

#### 4.3.1 获取目标模型版本

```
GET /api/internal/ai/routing?scene_code=general_qa&user_id=U123456&user_segment=beta_testers
```

**Response:**
```json
{
    "code": 0,
    "data": {
        "version_id": "mv_20260621_gpt4o_v2",
        "provider_id": "openai",
        "model_name": "gpt-4o",
        "parameters": {
            "temperature": 0.20,
            "top_p": 0.90,
            "max_tokens": 4096
        },
        "prompt_template_id": "pt_20260620_general_v3",
        "release_id": "rls_20260621_001",
        "is_canary": true,
        "config_version": 42
    }
}
```

> 业务服务（AI 服务层）调用此接口获取应该使用的模型版本。路由逻辑：
> 1. 如果有活跃灰度发布，按流量百分比随机分配
> 2. 如果用户在白名单中，直接返回候选版本
> 3. 否则返回当前 ACTIVE 版本

---

## 5. 核心流程设计

### 5.1 模型版本注册与评测流程

```
工程师创建版本 (DRAFT)
       │
       ▼
 ┌─────────────┐     ┌───────────────────┐
 │ 提交评测     │────▶│ 评测系统执行       │
 │ (TESTING)   │     │ - 准确率测试(500题)│
 └─────────────┘     │ - 延迟测试         │
                     │ - 成本测试         │
                     │ - 安全性测试       │
                     └────────┬──────────┘
                              │
                     ┌────────▼──────────┐
                     │ 生成评测报告        │
                     │ eval_score, etc.  │
                     └────────┬──────────┘
                              │
                     ┌────────▼──────────┐
                     │ 质量门禁判定        │
                     │ (与基线版本对比)   │
                     └────────┬──────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
              ┌─────▼─────┐     ┌──────▼──────┐
              │ PASS      │     │ FAIL        │
              │ → STAGING │     │ → REJECTED  │
              └───────────┘     └─────────────┘
```

**质量门禁规则（与基线版本对比）:**

| 指标 | 门禁条件 | 不满足时 |
| --- | --- | --- |
| 准确率 | ≥ 基线 -2% 且 ≥ 80% | 拒绝 |
| P99 延迟 | ≤ 基线 × 1.5 且 ≤ 10s | 拒绝 |
| 错误率 | ≤ 基线 +1% 且 ≤ 3% | 拒绝 |
| 安全性 | 100% 通过敏感词检测 | 拒绝 |
| 成本 | ≤ 基线 × 1.5 | 警告（允许但需人工审批） |

### 5.2 灰度发布全流程

```
 ┌─────────────────────────────────────────────────────────────┐
 │                    灰度发布完整流程                           │
 └─────────────────────────────────────────────────────────────┘

 创建发布 (pending)
    │
    ▼
 前置检查:
    ✓ candidate 版本 = STAGING
    ✓ 该场景无其他活跃灰度
    ✓ baseline 版本 = 当前 ACTIVE
    ✓ 门禁配置完整
    │
    ▼
 启动灰度 (running, step 0)
    │ 推送路由规则: candidate 5%, baseline 95%
    │ 启动监控采集任务(每60s)
    │
    ├──▶ [每60秒] 质量门禁检查
    │      │
    │      ├── ALL PASS → 继续
    │      ├── WARN    → 记录告警, 继续观察
    │      └── FAIL    → 触发自动暂停 → 人工介入决策
    │
    ├──▶ [阶梯时间到达] 自动推进 (auto_promote=true时)
    │      │
    │      │  step 0 (5%,  30min) ──▶ step 1 (20%, 60min)
    │      │  step 1 (20%, 60min) ──▶ step 2 (50%, 120min)
    │      │  step 2 (50%, 120min) ──▶ step 3 (100%, 0min)
    │      │
    │      ▼
    │   推进前检查门禁 → PASS则推进, FAIL则暂停
    │
    ▼
 到达 100% (step 3)
    │ auto_promote = false → 等待人工确认
    │
    ├──▶ 人工点击「全量上线」
    │      │ candidate → ACTIVE
    │      │ baseline → DEPRECATED
    │      │ 更新路由: 100% → candidate
    │      └── 发布事件: completed
    │
    └──▶ 人工点击「回滚」(任何阶段均可)
           │ 路由恢复: 100% → baseline
           │ candidate → REJECTED
           └── 发布事件: rolled_back
```

### 5.3 自动回滚触发条件

| 触发条件 | 阈值 | 动作 |
| --- | --- | --- |
| 错误率突增 | > 5%（持续 3 分钟） | 立即回滚 |
| P99 延迟突增 | > 15s（持续 3 分钟） | 立即回滚 |
| 准确率骤降 | < 基线 -10% | 立即回滚 |
| 用户负反馈率 | 差评率 > 15%（样本≥100） | 暂停灰度 |
| 成本超支 | 单次调用成本 > 基线 × 3 | 暂停灰度 |
| 供应商 API 故障 | 错误率 > 20% | 立即回滚（交由容灾引擎接管） |

### 5.4 运行时流量路由算法

```python
import random
import hashlib

def route_model_version(scene_code: str, user_id: str, user_tags: set[str],
                        routing_config: dict) -> tuple[str, str]:
    """
    运行时模型版本路由。

    Args:
        scene_code: 场景代码
        user_id: 用户ID
        user_tags: 用户标签集合
        routing_config: 来自 Redis 的路由配置

    Returns:
        (version_id, release_id | None)
    """
    rules = routing_config["routing_rules"]

    # 1. 先检查精确匹配规则（白名单、用户分群）
    for rule in rules:
        match = rule.get("match", {})
        if not match:
            continue
        if "user_segment" in match:
            segment_key = match["user_segment"]
            if segment_key in user_tags:
                return rule["target_version"], routing_config.get("canary_release_id")

    # 2. 百分比分流：基于 user_id + scene_code 做确定性哈希
    #    同一用户在同一场景下始终被分到同一组（避免体验跳变）
    hash_input = f"{user_id}:{scene_code}".encode("utf-8")
    hash_value = int(hashlib.md5(hash_input).hexdigest(), 16) % 10000  # 0-9999
    user_bucket = hash_value / 100.0  # 0.00 - 99.99

    cumulative = 0.0
    for rule in rules:
        if rule.get("match"):
            continue  # 跳过有精确匹配条件的规则
        cumulative += rule["weight"]
        if user_bucket < cumulative:
            return rule["target_version"], routing_config.get("canary_release_id")

    # Fallback: 返回 active_version
    return routing_config["active_version"], None
```

**关键设计决策**：使用 `user_id + scene_code` 的确定性哈希，确保同一用户在同一场景下的模型版本不会频繁跳变，避免回答风格不一致导致的学习体验问题。

---

## 6. 服务架构与关键代码

### 6.1 模块划分

```
ai-model-lifecycle-service/
├── controller/
│   ├── ModelVersionController.java      # 模型版本 CRUD
│   ├── ReleaseController.java           # 灰度发布管理
│   └── RoutingController.java           # 运行时路由查询(内部)
├── service/
│   ├── ModelVersionService.java         # 版本注册、状态管理
│   ├── EvaluationService.java           # 评测编排（调用评测系统）
│   ├── ReleaseService.java              # 灰度发布流程控制
│   ├── GateCheckService.java            # 质量门禁判定
│   ├── MetricsCollectorService.java     # 实时指标采集
│   ├── AutoRollbackService.java         # 自动回滚
│   └── RoutingConfigPublisher.java      # 路由配置发布(配置中心/Redis)
├── domain/
│   ├── ModelVersion.java
│   ├── ModelRelease.java
│   ├── ReleaseEvent.java
│   ├── GateResult.java
│   └── RoutingRule.java
├── infrastructure/
│   ├── ModelVersionRepository.java
│   ├── ReleaseRepository.java
│   ├── RedisRoutingStore.java
│   └── EvaluationSystemClient.java      # 调用评测系统的 Feign Client
└── scheduler/
    ├── GateCheckScheduler.java          # 定时门禁检查(每60s)
    └── RampUpScheduler.java             # 灰度阶梯自动推进
```

### 6.2 版本状态管理核心代码

```java
/**
 * 模型版本状态机 —— 管理版本生命周期转换。
 * 所有状态变更必须通过此方法，确保合法性和审计。
 */
@Service
public class ModelVersionStateManager {

    private static final Map<String, Set<String>> TRANSITION_MAP = Map.of(
        "DRAFT",     Set.of("TESTING", "RETIRED"),
        "TESTING",   Set.of("STAGING", "REJECTED"),
        "REJECTED",  Set.of("DRAFT", "RETIRED"),
        "STAGING",   Set.of("CANARY", "RETIRED"),
        "CANARY",    Set.of("ACTIVE", "REJECTED"),
        "ACTIVE",    Set.of("DEPRECATED"),
        "DEPRECATED", Set.of("RETIRED"),
        "RETIRED",   Set.of()  // 终态
    );

    @Autowired
    private ModelVersionRepository versionRepo;

    @Autowired
    private ReleaseEventPublisher eventPublisher;

    @Transactional
    public void transition(String versionId, String targetState, String operator, String reason) {
        ModelVersion version = versionRepo.findById(versionId)
            .orElseThrow(() -> new BusinessException("VERSION_NOT_FOUND", "模型版本不存在: " + versionId));

        String currentState = version.getLifecycleState();
        validateTransition(currentState, targetState);

        // 特殊处理：CANARY → ACTIVE 时，需要同时处理旧版本降级
        if ("CANARY".equals(currentState) && "ACTIVE".equals(targetState)) {
            handleActivation(version, operator);
        }

        // 特殊处理：CANARY → REJECTED 时，需要回滚路由
        if ("CANARY".equals(currentState) && "REJECTED".equals(targetState)) {
            handleRollback(version, operator, reason);
        }

        version.setLifecycleState(targetState);
        if ("ACTIVE".equals(targetState)) {
            version.setActivatedAt(LocalDateTime.now());
        }
        if ("DEPRECATED".equals(targetState)) {
            version.setDeprecatedAt(LocalDateTime.now());
        }
        versionRepo.save(version);

        eventPublisher.publishVersionStateChange(versionId, currentState, targetState, operator, reason);
    }

    private void validateTransition(String from, String to) {
        Set<String> allowed = TRANSITION_MAP.get(from);
        if (allowed == null || !allowed.contains(to)) {
            throw new BusinessException(
                "INVALID_TRANSITION",
                String.format("非法状态转换: %s → %s", from, to)
            );
        }
    }

    /**
     * 激活新版本：将旧 ACTIVE 版本降级为 DEPRECATED
     */
    private void handleActivation(ModelVersion newActive, String operator) {
        List<ModelVersion> oldActiveList = versionRepo
            .findBySceneCodeAndLifecycleState(newActive.getSceneCode(), "ACTIVE");

        for (ModelVersion old : oldActiveList) {
            old.setLifecycleState("DEPRECATED");
            old.setDeprecatedAt(LocalDateTime.now());
            old.setPreviousVersionId(newActive.getVersionId());
            versionRepo.save(old);
            log.info("版本降级: {} ACTIVE → DEPRECATED (被 {} 替换), 操作人: {}",
                old.getVersionId(), newActive.getVersionId(), operator);
        }
    }

    private void handleRollback(ModelVersion version, String operator, String reason) {
        log.warn("版本回滚: {} CANARY → REJECTED, 原因: {}, 操作人: {}",
            version.getVersionId(), reason, operator);
        // 路由恢复由 ReleaseService 处理
    }
}
```

### 6.3 灰度发布流程控制核心代码

```java
/**
 * 灰度发布流程控制器 —— 管理灰度发布的启动、推进、完成、回滚。
 */
@Service
@Slf4j
public class ReleaseService {

    @Autowired private ReleaseRepository releaseRepo;
    @Autowired private ModelVersionRepository versionRepo;
    @Autowired private RoutingConfigPublisher routingPublisher;
    @Autowired private MetricsCollectorService metricsCollector;
    @Autowired private GateCheckService gateCheckService;
    @Autowired private ModelVersionStateManager stateManager;
    @Autowired private ReleaseEventPublisher eventPublisher;

    /**
     * 启动灰度发布
     */
    @Transactional
    public String startRelease(CreateReleaseRequest request, String operator) {
        // 1. 前置校验
        ModelVersion candidate = versionRepo.findById(request.getCandidateVersionId())
            .orElseThrow(() -> new BusinessException("VERSION_NOT_FOUND", "候选版本不存在"));

        if (!"STAGING".equals(candidate.getLifecycleState())) {
            throw new BusinessException("INVALID_STATE",
                "候选版本必须处于 STAGING 状态, 当前: " + candidate.getLifecycleState());
        }

        // 检查同一场景下无其他活跃灰度
        Optional<ModelRelease> activeRelease = releaseRepo
            .findBySceneCodeAndReleaseStateIn(candidate.getSceneCode(),
                List.of("pending", "running"));
        if (activeRelease.isPresent()) {
            throw new BusinessException("RELEASE_CONFLICT",
                "场景 " + candidate.getSceneCode() + " 已有活跃发布: " + activeRelease.get().getReleaseId());
        }

        // 获取基线版本（当前 ACTIVE）
        ModelVersion baseline = versionRepo
            .findBySceneCodeAndLifecycleState(candidate.getSceneCode(), "ACTIVE")
            .stream()
            .findFirst()
            .orElseThrow(() -> new BusinessException("NO_BASELINE",
                "场景 " + candidate.getSceneCode() + " 无 ACTIVE 版本作为基线"));

        // 2. 创建发布记录
        String releaseId = generateReleaseId();
        ModelRelease release = new ModelRelease();
        release.setReleaseId(releaseId);
        release.setSceneCode(candidate.getSceneCode());
        release.setCandidateVersionId(candidate.getVersionId());
        release.setBaselineVersionId(baseline.getVersionId());
        release.setReleaseType(request.getReleaseType());
        release.setRampUpStrategy(JsonUtils.toJson(request.getRampUpStrategy()));
        release.setGateConfig(JsonUtils.toJson(request.getGateConfig()));
        release.setReleaseState("pending");
        release.setCreatedBy(operator);

        // 3. 推进到第一步
        RampUpStrategy strategy = request.getRampUpStrategy();
        if (strategy.getSteps() != null && !strategy.getSteps().isEmpty()) {
            RampUpStep firstStep = strategy.getSteps().get(0);
            release.setTrafficPercentage(firstStep.getPercentage());
        }

        releaseRepo.save(release);

        // 4. 推送路由配置
        publishRoutingConfig(release, candidate, baseline);

        // 5. 更新版本状态
        stateManager.transition(candidate.getVersionId(), "CANARY", operator,
            "灰度发布启动: " + releaseId);

        // 6. 更新发布状态
        release.setReleaseState("running");
        release.setStartedAt(LocalDateTime.now());
        releaseRepo.save(release);

        // 7. 记录事件
        eventPublisher.publishEvent(releaseId, "created",
            Map.of("candidate", candidate.getVersionId(),
                   "baseline", baseline.getVersionId()), operator);
        eventPublisher.publishEvent(releaseId, "step_promoted",
            Map.of("from", 0, "to", release.getTrafficPercentage()), "system");

        log.info("灰度发布启动: releaseId={}, scene={}, candidate={}, baseline={}, initial_percentage={}",
            releaseId, candidate.getSceneCode(), candidate.getVersionId(),
            baseline.getVersionId(), release.getTrafficPercentage());

        return releaseId;
    }

    /**
     * 推进灰度阶梯
     */
    @Transactional
    public void promote(String releaseId, BigDecimal targetPercentage, String operator) {
        ModelRelease release = getReleaseOrThrow(releaseId);
        assertRunning(release);

        // 门禁检查
        GateResult gateResult = gateCheckService.check(release);
        if (!gateResult.isPassed()) {
            throw new BusinessException("GATE_CHECK_FAILED",
                "质量门禁未通过: " + gateResult.getFailedItems());
        }

        BigDecimal oldPercentage = release.getTrafficPercentage();
        release.setTrafficPercentage(targetPercentage);
        releaseRepo.save(release);

        // 更新路由
        ModelVersion candidate = versionRepo.findById(release.getCandidateVersionId()).orElseThrow();
        ModelVersion baseline = versionRepo.findById(release.getBaselineVersionId()).orElseThrow();
        publishRoutingConfig(release, candidate, baseline);

        eventPublisher.publishEvent(releaseId, "step_promoted",
            Map.of("from", oldPercentage, "to", targetPercentage,
                   "gate_result", gateResult), operator);

        log.info("灰度推进: releaseId={}, {}% → {}%, 操作人: {}",
            releaseId, oldPercentage, targetPercentage, operator);
    }

    /**
     * 全量上线完成
     */
    @Transactional
    public void complete(String releaseId, String operator) {
        ModelRelease release = getReleaseOrThrow(releaseId);
        assertRunning(release);

        // 最终门禁检查
        GateResult gateResult = gateCheckService.check(release);
        if (!gateResult.isPassed()) {
            throw new BusinessException("GATE_CHECK_FAILED",
                "全量上线前最终门禁未通过: " + gateResult.getFailedItems());
        }

        // 版本状态变更
        stateManager.transition(release.getCandidateVersionId(), "ACTIVE", operator,
            "灰度发布完成: " + releaseId);

        // 路由 100% 指向新版本
        release.setTrafficPercentage(new BigDecimal("100.00"));
        ModelVersion candidate = versionRepo.findById(release.getCandidateVersionId()).orElseThrow();
        ModelVersion baseline = versionRepo.findById(release.getBaselineVersionId()).orElseThrow();
        publishRoutingConfig100(candidate);

        release.setReleaseState("completed");
        release.setCompletedAt(LocalDateTime.now());
        releaseRepo.save(release);

        eventPublisher.publishEvent(releaseId, "completed",
            Map.of("final_percentage", "100",
                   "candidate_version", candidate.getVersionId()), operator);

        log.info("灰度发布完成: releaseId={}, 新 ACTIVE 版本: {}, 操作人: {}",
            releaseId, candidate.getVersionId(), operator);
    }

    /**
     * 回滚
     */
    @Transactional
    public void rollback(String releaseId, String reason, String operator) {
        ModelRelease release = getReleaseOrThrow(releaseId);
        if (!Set.of("running", "paused").contains(release.getReleaseState())) {
            throw new BusinessException("INVALID_RELEASE_STATE",
                "仅 running/paused 状态可回滚, 当前: " + release.getReleaseState());
        }

        // 路由全部切回基线
        ModelVersion baseline = versionRepo.findById(release.getBaselineVersionId()).orElseThrow();
        publishRoutingConfig100(baseline);

        // 候选版本标记为 REJECTED
        stateManager.transition(release.getCandidateVersionId(), "REJECTED", operator, reason);

        release.setReleaseState("rolled_back");
        release.setCompletedAt(LocalDateTime.now());
        releaseRepo.save(release);

        eventPublisher.publishEvent(releaseId, "rolled_back",
            Map.of("reason", reason), operator);

        log.warn("灰度回滚: releaseId={}, 原因: {}, 操作人: {}",
            releaseId, reason, operator);
    }

    /**
     * 发布路由配置到 Redis / 配置中心
     */
    private void publishRoutingConfig(ModelRelease release,
                                       ModelVersion candidate,
                                       ModelVersion baseline) {
        RoutingConfig config = new RoutingConfig();
        config.setActiveVersion(baseline.getVersionId());
        config.setCanaryReleaseId(release.getReleaseId());

        BigDecimal candidateWeight = release.getTrafficPercentage();
        BigDecimal baselineWeight = new BigDecimal("100").subtract(candidateWeight);

        config.setRoutingRules(List.of(
            RoutingRule.builder()
                .targetVersion(candidate.getVersionId())
                .weight(candidateWeight)
                .build(),
            RoutingRule.builder()
                .targetVersion(baseline.getVersionId())
                .weight(baselineWeight)
                .build()
        ));

        routingPublisher.publish(release.getSceneCode(), config);
    }

    private void publishRoutingConfig100(ModelVersion version) {
        RoutingConfig config = new RoutingConfig();
        config.setActiveVersion(version.getVersionId());
        config.setCanaryReleaseId(null);
        config.setRoutingRules(List.of(
            RoutingRule.builder()
                .targetVersion(version.getVersionId())
                .weight(new BigDecimal("100"))
                .build()
        ));
        routingPublisher.publish(version.getSceneCode(), config);
    }
}
```

### 6.4 质量门禁检查器

```java
/**
 * 质量门禁检查 —— 对比候选版本与基线版本的实时指标。
 */
@Service
@Slf4j
public class GateCheckService {

    @Autowired private MetricsCollectorService metricsCollector;

    /**
     * 执行质量门禁检查
     */
    public GateResult check(ModelRelease release) {
        GateConfig gateConfig = parseGateConfig(release.getGateConfig());

        // 采集最近 N 分钟的指标
        MetricsSnapshot candidateMetrics = metricsCollector.collect(
            release.getCandidateVersionId(),
            release.getSceneCode(),
            Duration.ofMinutes(gateConfig.getCheckWindowMin() != null ?
                gateConfig.getCheckWindowMin() : 5)
        );
        MetricsSnapshot baselineMetrics = metricsCollector.collect(
            release.getBaselineVersionId(),
            release.getSceneCode(),
            Duration.ofMinutes(gateConfig.getCheckWindowMin() != null ?
                gateConfig.getCheckWindowMin() : 5)
        );

        // 样本量检查
        if (candidateMetrics.getSampleCount() < gateConfig.getMinSampleSize()) {
            return GateResult.insufficientData(
                "候选版本样本量不足: " + candidateMetrics.getSampleCount() +
                " < " + gateConfig.getMinSampleSize());
        }

        GateResult result = new GateResult();
        boolean allPassed = true;

        // 准确率检查
        if (gateConfig.getMinAccuracy() != null) {
            boolean pass = candidateMetrics.getAccuracy() >= gateConfig.getMinAccuracy();
            result.addCheck("accuracy", pass,
                candidateMetrics.getAccuracy(), gateConfig.getMinAccuracy());
            allPassed &= pass;
        }

        // P99 延迟检查
        if (gateConfig.getMaxLatencyP99Ms() != null) {
            boolean pass = candidateMetrics.getLatencyP99() <= gateConfig.getMaxLatencyP99Ms();
            result.addCheck("latency_p99", pass,
                candidateMetrics.getLatencyP99(), gateConfig.getMaxLatencyP99Ms());
            allPassed &= pass;
        }

        // 错误率检查
        if (gateConfig.getMaxErrorRate() != null) {
            boolean pass = candidateMetrics.getErrorRate() <= gateConfig.getMaxErrorRate();
            result.addCheck("error_rate", pass,
                candidateMetrics.getErrorRate(), gateConfig.getMaxErrorRate());
            allPassed &= pass;
        }

        // 用户满意度检查
        if (gateConfig.getMinUserSatisfaction() != null) {
            boolean pass = candidateMetrics.getSatisfaction() >= gateConfig.getMinUserSatisfaction();
            result.addCheck("satisfaction", pass,
                candidateMetrics.getSatisfaction(), gateConfig.getMinUserSatisfaction());
            allPassed &= pass;
        }

        // 成本增幅检查（仅警告，不阻止）
        if (gateConfig.getMaxCostIncreasePct() != null && baselineMetrics.getCostPerCall() > 0) {
            BigDecimal increasePct = candidateMetrics.getCostPerCall()
                .subtract(baselineMetrics.getCostPerCall())
                .divide(baselineMetrics.getCostPerCall(), 4, RoundingMode.HALF_UP)
                .multiply(new BigDecimal("100"));
            boolean pass = increasePct.compareTo(new BigDecimal(gateConfig.getMaxCostIncreasePct())) <= 0;
            result.addCheck("cost_increase", pass,
                increasePct.doubleValue(), gateConfig.getMaxCostIncreasePct());
            // 成本超标只发警告，不阻止
        }

        result.setPassed(allPassed);
        return result;
    }
}
```

### 6.5 自动回滚监控调度器

```java
/**
 * 定时质量门禁检查 + 自动回滚调度器。
 * 每个活跃灰度发布每 60 秒检查一次。
 */
@Component
@Slf4j
public class GateCheckScheduler {

    @Autowired private ReleaseRepository releaseRepo;
    @Autowired private GateCheckService gateCheckService;
    @Autowired private ReleaseService releaseService;
    @Autowired private ReleaseEventPublisher eventPublisher;

    @Value("${ai.model.gate-check.interval-sec:60}")
    private int checkIntervalSec;

    @Value("${ai.model.gate-check.auto-rollback-enabled:true}")
    private boolean autoRollbackEnabled;

    private final Map<String, Integer> consecutiveBreachCount = new ConcurrentHashMap<>();

    @Scheduled(fixedDelayString = "${ai.model.gate-check.interval-sec:60}000")
    public void scheduledGateCheck() {
        List<ModelRelease> activeReleases = releaseRepo
            .findByReleaseStateIn(List.of("running"));

        for (ModelRelease release : activeReleases) {
            try {
                GateResult result = gateCheckService.check(release);

                if (result.isPassed()) {
                    consecutiveBreachCount.remove(release.getReleaseId());
                    continue;
                }

                // 门禁未通过
                int breaches = consecutiveBreachCount.merge(
                    release.getReleaseId(), 1, Integer::sum);
                log.warn("灰度门禁未通过: releaseId={}, 连续次数={}, 失败项={}",
                    release.getReleaseId(), breaches, result.getFailedItems());

                // 严重违规 → 立即回滚
                if (hasCriticalBreach(result)) {
                    handleCriticalBreach(release, result);
                }
                // 连续 3 次非严重违规 → 暂停
                else if (breaches >= 3) {
                    releaseService.rollback(release.getReleaseId(),
                        "连续 " + breaches + " 次门禁未通过: " + result.getFailedItems(),
                        "system");
                    consecutiveBreachCount.remove(release.getReleaseId());
                }

            } catch (Exception e) {
                log.error("门禁检查异常: releaseId={}", release.getReleaseId(), e);
            }
        }
    }

    /**
     * 判断是否为严重违规（触发立即回滚）
     */
    private boolean hasCriticalBreach(GateResult result) {
        return result.getFailedItems().stream()
            .anyMatch(item -> Set.of("error_rate", "accuracy").contains(item.getCheckName())
                && item.isCritical());
    }

    private void handleCriticalBreach(ModelRelease release, GateResult result) {
        if (!autoRollbackEnabled) {
            log.warn("自动回滚已关闭, 仅告警: releaseId={}", release.getReleaseId());
            return;
        }
        log.error("触发自动回滚: releaseId={}, 原因: {}",
            release.getReleaseId(), result.getFailedItems());
        eventPublisher.publishEvent(release.getReleaseId(),
            "auto_rollback_triggered",
            Map.of("reason", result.getFailedItems()), "system");
        releaseService.rollback(release.getReleaseId(),
            "自动回滚: 严重门禁违规 - " + result.getFailedItems(), "system");
    }
}
```

### 6.6 灰度阶梯自动推进调度器

```java
/**
 * 灰度阶梯自动推进调度器。
 * 每分钟检查是否有阶梯到达推进时间。
 */
@Component
@Slf4j
public class RampUpScheduler {

    @Autowired private ReleaseRepository releaseRepo;
    @Autowired private ReleaseService releaseService;
    @Autowired private GateCheckService gateCheckService;
    @Autowired private ReleaseEventPublisher eventPublisher;

    @Scheduled(fixedDelay = 60000)
    public void checkRampUp() {
        List<ModelRelease> runningReleases = releaseRepo.findByReleaseStateIn(List.of("running"));

        for (ModelRelease release : runningReleases) {
            try {
                RampUpStrategy strategy = RampUpStrategy.parse(release.getRampUpStrategy());
                int currentStep = strategy.getCurrentStep();

                if (currentStep >= strategy.getSteps().size() - 1) {
                    continue; // 已在最后一步
                }

                RampUpStep currentStepConfig = strategy.getSteps().get(currentStep);

                // 检查当前阶梯是否到时间
                if (currentStepConfig.getDurationMin() == 0) {
                    continue; // 需要手动推进
                }

                long elapsedMin = Duration.between(
                    release.getStartedAt(), LocalDateTime.now()).toMinutes();

                // 计算到当前阶梯的累计时间
                int cumulativeMin = 0;
                for (int i = 0; i <= currentStep; i++) {
                    cumulativeMin += strategy.getSteps().get(i).getDurationMin();
                }

                if (elapsedMin >= cumulativeMin && currentStepConfig.isAutoPromote()) {
                    // 门禁检查
                    GateResult gateResult = gateCheckService.check(release);
                    if (!gateResult.isPassed()) {
                        log.warn("阶梯自动推进中止(门禁未通过): releaseId={}, step={}, failed={}",
                            release.getReleaseId(), currentStep, gateResult.getFailedItems());
                        eventPublisher.publishEvent(release.getReleaseId(),
                            "gate_breached",
                            Map.of("step", currentStep, "failed", gateResult.getFailedItems()),
                            "system");
                        continue;
                    }

                    // 推进到下一步
                    RampUpStep nextStep = strategy.getSteps().get(currentStep + 1);
                    releaseService.promote(release.getReleaseId(),
                        new BigDecimal(nextStep.getPercentage()), "system");

                    // 更新策略中的 current_step
                    strategy.setCurrentStep(currentStep + 1);
                    release.setRampUpStrategy(JsonUtils.toJson(strategy));
                    releaseRepo.save(release);

                    log.info("阶梯自动推进: releaseId={}, step {} → {}, 百分比 {}% → {}%",
                        release.getReleaseId(), currentStep, currentStep + 1,
                        currentStepConfig.getPercentage(), nextStep.getPercentage());
                }

            } catch (Exception e) {
                log.error("阶梯推进异常: releaseId={}", release.getReleaseId(), e);
            }
        }
    }
}
```

---

## 7. 错误处理

### 7.1 业务异常码

| 异常码 | HTTP状态 | 说明 | 处理建议 |
| --- | --- | --- | --- |
| `VERSION_NOT_FOUND` | 404 | 模型版本不存在 | 检查 version_id |
| `INVALID_STATE` | 400 | 版本状态不允许此操作 | 检查 lifecycle_state |
| `INVALID_TRANSITION` | 400 | 非法状态转换 | 参照状态机 |
| `RELEASE_CONFLICT` | 409 | 场景下已有活跃灰度 | 先完成或终止当前灰度 |
| `NO_BASELINE` | 500 | 场景无 ACTIVE 基线版本 | 先注册并激活一个版本 |
| `GATE_CHECK_FAILED` | 422 | 质量门禁未通过 | 查看 gate_result 详情 |
| `INVALID_RELEASE_STATE` | 400 | 发布状态不允许此操作 | 检查 release_state |
| `EVALUATION_IN_PROGRESS` | 409 | 版本正在评测中 | 等待评测完成 |
| `ROUTING_PUBLISH_FAILED` | 500 | 路由配置发布失败 | 检查 Redis/配置中心连接 |
| `INSUFFICIENT_SAMPLES` | 422 | 指标样本量不足 | 延长观察窗口 |

### 7.2 关键场景容错

| 场景 | 处理策略 |
| --- | --- |
| Redis 连接中断 | 本地缓存继续服务路由（最多 5 分钟），超时后降级到 ACTIVE 版本 |
| 评测系统不可用 | 版本停留在 TESTING 状态，标记为 `eval_pending`，发告警 |
| 配置中心推送失败 | 重试 3 次，间隔指数退避，仍失败则回滚版本状态变更并告警 |
| 指标采集延迟 | 灰度推进暂停，等待指标恢复后自动继续 |
| 数据库事务失败 | 全部回滚，版本和发布状态保持变更前一致 |

---

## 8. 监控指标

### 8.1 关键业务指标

| 指标名 | 类型 | 说明 |
| --- | --- | --- |
| `ai.model.active_version_count` | Gauge | 各场景 ACTIVE 版本数（应 = 1） |
| `ai.model.canary_count` | Gauge | 进行中灰度数量 |
| `ai.model.gate_check_total` | Counter | 门禁检查总次数（按 pass/fail 标签） |
| `ai.model.rollback_total` | Counter | 回滚总次数（按 auto/manual 标签） |
| `ai.model.release_duration_min` | Histogram | 灰度发布总时长分布 |
| `ai.model.version_age_days` | Gauge | 当前 ACTIVE 版本存活天数 |
| `ai.model.eval_score_trend` | Gauge | 各场景版本评测得分趋势 |

### 8.2 告警规则

| 告警 | 条件 | 级别 |
| --- | --- | --- |
| 灰度自动回滚 | `ai.model.rollback_total{type="auto"} increase in 1h > 0` | P1 |
| 场景无 ACTIVE 版本 | `ai.model.active_version_count{scene=*} == 0` | P0 |
| 灰度持续超 24 小时 | release started_at > 24h ago AND state=running | P2 |
| 连续门禁失败 | gate_check{result=fail} > 5 in 10min | P2 |
| 路由配置推送失败 | `ROUTING_PUBLISH_FAILED` > 0 | P1 |

---

## 9. 管理后台界面建议

### 9.1 模型版本管理页

- **版本列表**：按场景筛选，展示版本标签、状态、评测得分、创建时间
- **版本详情**：参数配置、Prompt 关联、评测报告、事件历史
- **操作按钮**：注册新版本、提交评测、创建灰度发布

### 9.2 灰度发布监控面板

```
┌──────────────────────────────────────────────────────────┐
│  灰度发布监控 - general_qa 场景                            │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  发布ID: rls_20260621_001    状态: 🟢 Running            │
│  候选版本: v2.1-gpt4o-opt    基线版本: v2.0-gpt4o-stable │
│  灰度比例: 20%               阶梯: 2/4                   │
│                                                          │
│  ┌─────────────────┐  ┌─────────────────┐               │
│  │  候选版本指标    │  │  基线版本指标    │               │
│  │  准确率: 88.5%   │  │  准确率: 87.2%   │               │
│  │  P99:   3.5s    │  │  P99:   3.2s    │               │
│  │  错误率: 0.8%    │  │  错误率: 1.0%    │               │
│  │  满意度: 4.3⭐   │  │  满意度: 4.2⭐   │               │
│  │  成本:   ¥0.014  │  │  成本:   ¥0.011  │               │
│  │  样本:   3,420   │  │  样本:   16,250  │               │
│  └─────────────────┘  └─────────────────┘               │
│                                                          │
│  门禁状态:                                                │
│  ✅ accuracy    ✅ latency    ✅ error_rate               │
│  ✅ satisfaction ⚠️ cost_increase (+27%, WARN)            │
│                                                          │
│  [⏸ 暂停]  [▶ 推进到50%]  [✅ 全量上线]  [↩ 回滚]       │
│                                                          │
│  事件时间线:                                              │
│  10:05 创建发布 (ai_engineer_01)                         │
│  10:05 推进至 5% (system)                                │
│  10:35 门禁通过 step 0 (system)                          │
│  10:36 推进至 20% (system)                               │
│  ─── 当前 ───                                            │
└──────────────────────────────────────────────────────────┘
```

---

## 10. 与其他系统的集成

### 10.1 与多模型调度引擎集成

本引擎输出的路由配置（哪个场景用哪个版本）是多模型调度引擎的输入：

```
本引擎 → Redis 路由配置 → 多模型调度引擎 → 按版本配置调用具体供应商 API
```

调度引擎在每次 AI 调用时：
1. 读取 Redis 中的场景路由配置
2. 根据用户 ID 哈希确定使用哪个版本
3. 获取该版本的完整参数配置（供应商、模型名、temperature 等）
4. 发起实际 API 调用
5. 记录调用日志（含 version_id, release_id）

### 10.2 与评测基准系统集成

- **评测触发**：本引擎在版本提交评测时，调用评测系统 API
- **评测数据集管理**：评测系统维护各场景的标准测试集
- **评测报告回写**：评测系统完成后将结果回写到版本记录

### 10.3 与容灾切换引擎集成

- **紧急切换**：容灾引擎检测到供应商故障时，可跳过灰度流程直接切换（`release_type=immediate`）
- **事后补录**：紧急切换完成后，系统自动补录一条发布记录用于审计
- **共享路由基础设施**：两者共用 Redis 路由配置 Key 和 Pub/Sub 通道

### 10.4 与 Token 计量服务集成

- 每次模型调用日志中的 `version_id` 和 `release_id` 传递到 Token 计量服务
- 计量服务按版本维度聚合成本数据
- 本引擎从计量服务读取各版本的成本指标用于门禁判断

---

## 11. 开发任务拆解

| 任务 | 估时 | 优先级 | 依赖 |
| --- | --- | --- | --- |
| 数据表创建 + 基础 Entity/Repository | 2天 | P0 | 无 |
| 模型版本 CRUD API + 状态机 | 2天 | P0 | 任务1 |
| 路由配置发布器(Redis + Pub/Sub) | 1天 | P0 | 任务1 |
| 运行时路由查询 API | 1天 | P0 | 任务3 |
| 评测系统集成（调用评测系统） | 1天 | P1 | 任务2 |
| 质量门禁检查器 | 2天 | P0 | 任务5 |
| 灰度发布流程控制(CRUD + 状态) | 3天 | P0 | 任务2,3,6 |
| 灰度阶梯自动推进调度器 | 1天 | P1 | 任务7 |
| 自动回滚监控调度器 | 2天 | P0 | 任务7 |
| 指标采集服务(对接监控系统) | 2天 | P0 | 任务7 |
| 管理后台前端页面 | 3天 | P1 | 任务2,7 |
| 集成测试 + 端到端验证 | 2天 | P0 | 全部 |

**合计**：约 22 人天

---

## 12. 安全与权限

| 权限码 | 说明 |
| --- | --- |
| `ai:model:read` | 查看模型版本和发布信息 |
| `ai:model:create` | 注册新模型版本 |
| `ai:model:evaluate` | 提交评测 |
| `ai:model:release:create` | 创建灰度发布 |
| `ai:model:release:operate` | 推进/暂停/回滚灰度发布 |
| `ai:model:release:complete` | 全量上线确认 |
| `ai:model:rollback` | 回滚操作 |
| `ai:model:provider:manage` | 管理供应商信息 |

所有操作记录审计日志，包含操作人、操作时间、前后值对比。
