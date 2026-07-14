# Prompt 版本管理与效果回归评估引擎 — 详细设计

## 1. 概述

### 1.1 模块定位

本模块是 AI 能力层的 Prompt 生命周期管理基础设施，负责 Prompt 模板的版本控制、回归测试、灰度发布、效果评估与自动回滚。与现有的 `AI-Prompt 编排与场景模板系统` 互补——后者聚焦于 Prompt 的**编排与执行**，本模块聚焦于 Prompt 的**治理与质量保障**。

### 1.2 核心职责

| 职责 | 说明 |
| --- | --- |
| Prompt 版本控制 | 对每个 Prompt 模板实施语义化版本管理，支持分支、合并、历史追溯 |
| 回归测试 | 维护 Golden Dataset，在 Prompt 变更后自动执行回归评估 |
| 灰度发布 | 按 用户学段/年级/地区/设备 等维度逐步放量新版本 Prompt |
| 效果评估 | 实时采集 Prompt 执行指标（延迟、Token 消耗、用户满意度、准确率） |
| 自动回滚 | 当新版本 Prompt 质量指标低于阈值时自动回滚到上一个稳定版本 |
| 依赖管理 | 管理 Prompt 之间的引用关系（共享片段、变量模板） |
| 实验框架 | 支持 A/B 测试不同 Prompt 策略，提供统计显著性判定 |

### 1.3 依赖关系

```
┌─────────────────────────────────────────────────────┐
│              Prompt 版本管理与效果回归评估引擎          │
├─────────────┬───────────────┬───────────────────────┤
│  依赖上游    │   依赖内部     │      依赖下游          │
├─────────────┼───────────────┼───────────────────────┤
│ AI-Prompt   │ 配置中心       │ AI 对话引擎            │
│ 编排系统     │ 消息队列       │ AI 辅导全链路           │
│ 大模型 API  │ Redis 集群     │ 答案管控与提示引擎      │
│ 模型管理服务 │ MySQL/PG      │ AI 质量监控系统         │
│ 灰度发布系统 │ 对象存储       │ 用户反馈系统            │
└─────────────┴───────────────┴───────────────────────┘
```

### 1.4 设计目标

1. **Prompt 即代码**：将 Prompt 模板纳入版本控制体系，实施与软件代码同等的管理标准
2. **变更可追溯**：任何 Prompt 变更都有明确的变更记录、审批流和效果数据
3. **质量可度量**：建立多维度的 Prompt 效果评估体系，支持量化决策
4. **发布可控制**：支持精细化灰度发布策略，最小化 Prompt 变更风险
5. **问题可回滚**：当效果下降时自动触发回滚，保障线上质量

---

## 2. 核心概念

### 2.1 Prompt 资产层级

```
PromptTemplate (模板)
  └── PromptVersion (版本)
        └── PromptSnapshot (快照 - 不可变)
              └── PromptExperiment (实验)
                    └── ExperimentAssignment (分配)
```

### 2.2 版本语义

采用 `MAJOR.MINOR.PATCH` 语义化版本：

| 版本类型 | 触发条件 | 示例 |
| --- | --- | --- |
| MAJOR | Prompt 核心策略变更，可能导致输出风格/格式重大变化 | `2.0.0` |
| MINOR | 新增变量、条件分支，向后兼容 | `1.2.0` |
| PATCH | 修复拼写、调整措辞、优化提示语 | `1.1.3` |

### 2.3 生命周期状态机

```
    ┌──────────┐     提交评审
    │  DRAFT   │────────────────┐
    └──────────┘                │
         │                      ▼
         │ 保存            ┌──────────┐
         │                 │ REVIEWING│
         │                 └──────────┘
         │                      │
         │               评审通过 │ 评审驳回
         │                      │
         │                      ▼
         │                 ┌──────────┐
         │                 │ TESTING  │  ← 回归测试中
         │                 └──────────┘
         │                      │
         │               测试通过 │ 测试失败
         │                      │
         │                      ▼
         │                 ┌──────────┐
         │                 │  STAGING │  ← 灰度发布中
         │                 └──────────┘
         │                      │
         │               全量发布 │ 效果不达标
         │                      │
         │                      ▼
         │                 ┌──────────┐
         └─────────────────│ PUBLISHED│  ← 线上稳定版
                           └──────────┘
                                │
                           紧急回滚 │
                                ▼
                           ┌──────────┐
                           │ ROLLED   │
                           │   BACK   │
                           └──────────┘
```

---

## 3. 数据模型

### 3.1 核心表结构

#### 3.1.1 `prompt_template` — Prompt 模板表

```sql
CREATE TABLE prompt_template (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    template_code   VARCHAR(128) NOT NULL UNIQUE COMMENT '模板唯一编码，如 math_solve_v2',
    template_name   VARCHAR(256) NOT NULL COMMENT '模板名称',
    scene_code      VARCHAR(64)  NOT NULL COMMENT '场景编码',
    subject_code    VARCHAR(32)  DEFAULT NULL COMMENT '学科编码',
    grade_range     VARCHAR(64)  DEFAULT NULL COMMENT '适用学段，如 primary,junior,senior',
    description     TEXT         DEFAULT NULL COMMENT '模板说明',
    current_version_id BIGINT    DEFAULT NULL COMMENT '当前线上版本ID',
    staging_version_id BIGINT    DEFAULT NULL COMMENT '当前灰度版本ID',
    status          TINYINT      NOT NULL DEFAULT 1 COMMENT '1=启用 0=停用',
    created_by      BIGINT       NOT NULL,
    updated_by      BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    
    INDEX idx_scene_subject (scene_code, subject_code),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Prompt模板表';
```

#### 3.1.2 `prompt_version` — Prompt 版本表

```sql
CREATE TABLE prompt_version (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    template_id     BIGINT       NOT NULL COMMENT '所属模板ID',
    version_number  VARCHAR(32)  NOT NULL COMMENT '语义化版本号，如 1.2.0',
    version_label   VARCHAR(128) DEFAULT NULL COMMENT '版本标签，如 "中考季优化"',
    
    -- Prompt 内容
    system_prompt   MEDIUMTEXT   NOT NULL COMMENT '系统提示词',
    user_prompt_tpl MEDIUMTEXT   NOT NULL COMMENT '用户提示词模板（含变量占位符）',
    variables_schema JSON        NOT NULL COMMENT '变量定义（类型、默认值、校验规则）',
    model_params    JSON         NOT NULL COMMENT '模型参数（temperature, top_p, max_tokens等）',
    stop_sequences  JSON         DEFAULT NULL COMMENT '停止序列',
    
    -- 版本状态
    lifecycle_status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/REVIEWING/TESTING/STAGING/PUBLISHED/ROLLED_BACK/ARCHIVED',
    
    -- 变更信息
    change_summary  TEXT         NOT NULL COMMENT '变更摘要',
    change_detail   TEXT         DEFAULT NULL COMMENT '详细变更说明',
    parent_version_id BIGINT     DEFAULT NULL COMMENT '父版本ID（用于追溯变更链）',
    
    -- 审批信息
    reviewed_by     BIGINT       DEFAULT NULL,
    reviewed_at     DATETIME(3)  DEFAULT NULL,
    review_comment  TEXT         DEFAULT NULL,
    
    -- 发布信息
    published_at    DATETIME(3)  DEFAULT NULL COMMENT '全量发布时间',
    published_by    BIGINT       DEFAULT NULL,
    
    -- 回滚信息
    rolled_back_at  DATETIME(3)  DEFAULT NULL,
    rolled_back_reason TEXT      DEFAULT NULL,
    rollback_version_id BIGINT   DEFAULT NULL COMMENT '回滚至的版本ID',
    
    created_by      BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    
    UNIQUE KEY uk_template_version (template_id, version_number),
    INDEX idx_lifecycle (lifecycle_status),
    INDEX idx_template (template_id),
    FOREIGN KEY (template_id) REFERENCES prompt_template(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Prompt版本表';
```

#### 3.1.3 `prompt_fragment` — Prompt 共享片段表

```sql
CREATE TABLE prompt_fragment (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    fragment_code   VARCHAR(128) NOT NULL UNIQUE COMMENT '片段编码',
    fragment_name   VARCHAR(256) NOT NULL,
    content         MEDIUMTEXT   NOT NULL COMMENT '片段内容',
    description     TEXT         DEFAULT NULL,
    version         VARCHAR(32)  NOT NULL DEFAULT '1.0.0',
    status          TINYINT      NOT NULL DEFAULT 1,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Prompt共享片段表';
```

#### 3.1.4 `prompt_version_fragment` — 版本-片段引用关系表

```sql
CREATE TABLE prompt_version_fragment (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    version_id      BIGINT       NOT NULL,
    fragment_id     BIGINT       NOT NULL,
    fragment_alias  VARCHAR(64)  NOT NULL COMMENT '在模板中的引用别名',
    UNIQUE KEY uk_version_alias (version_id, fragment_alias),
    INDEX idx_fragment (fragment_id),
    FOREIGN KEY (version_id) REFERENCES prompt_version(id),
    FOREIGN KEY (fragment_id) REFERENCES prompt_fragment(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='版本-片段引用关系表';
```

#### 3.1.5 `prompt_golden_case` — 黄金测试用例表

```sql
CREATE TABLE prompt_golden_case (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    template_id     BIGINT       NOT NULL,
    case_code       VARCHAR(64)  NOT NULL,
    case_name       VARCHAR(256) NOT NULL,
    
    -- 输入
    input_variables JSON         NOT NULL COMMENT '输入变量值',
    input_context   TEXT         DEFAULT NULL COMMENT '附加上下文（如对话历史）',
    
    -- 期望输出
    expected_summary TEXT        NOT NULL COMMENT '期望输出摘要（人工评估基准）',
    expected_keywords JSON       DEFAULT NULL COMMENT '期望包含的关键词列表',
    expected_format VARCHAR(32)  DEFAULT NULL COMMENT '期望输出格式',
    forbidden_keywords JSON      DEFAULT NULL COMMENT '禁止出现的关键词',
    
    -- 质量标准
    min_accuracy_score DECIMAL(5,2) DEFAULT 80.00 COMMENT '最低准确率得分',
    min_safety_score DECIMAL(5,2)   DEFAULT 95.00 COMMENT '最低安全得分',
    max_latency_ms   INT         DEFAULT 10000 COMMENT '最大延迟（毫秒）',
    
    -- 标签
    grade_code      VARCHAR(32)  DEFAULT NULL COMMENT '适用学段',
    subject_code    VARCHAR(32)  DEFAULT NULL COMMENT '学科',
    difficulty      TINYINT      DEFAULT 3 COMMENT '难度 1-5',
    tags            JSON         DEFAULT NULL COMMENT '标签列表',
    
    status          TINYINT      NOT NULL DEFAULT 1 COMMENT '1=启用 0=停用',
    created_by      BIGINT       NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    
    UNIQUE KEY uk_template_case (template_id, case_code),
    INDEX idx_template (template_id),
    FOREIGN KEY (template_id) REFERENCES prompt_template(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Prompt黄金测试用例表';
```

#### 3.1.6 `prompt_regression_result` — 回归测试结果表

```sql
CREATE TABLE prompt_regression_result (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    version_id      BIGINT       NOT NULL COMMENT '被测版本ID',
    batch_no        VARCHAR(64)  NOT NULL COMMENT '测试批次号',
    
    -- 测试统计
    total_cases     INT          NOT NULL COMMENT '总用例数',
    passed_cases    INT          NOT NULL COMMENT '通过用例数',
    failed_cases    INT          NOT NULL COMMENT '失败用例数',
    pass_rate       DECIMAL(5,2) NOT NULL COMMENT '通过率',
    
    -- 指标聚合
    avg_accuracy    DECIMAL(5,2) NOT NULL COMMENT '平均准确率',
    avg_safety      DECIMAL(5,2) NOT NULL COMMENT '平均安全分',
    avg_latency_ms  INT          NOT NULL COMMENT '平均延迟',
    p99_latency_ms  INT          NOT NULL COMMENT 'P99延迟',
    avg_token_usage INT          NOT NULL COMMENT '平均Token消耗',
    
    -- 对比信息（与基线版本对比）
    baseline_version_id BIGINT   DEFAULT NULL COMMENT '基线版本ID',
    accuracy_delta DECIMAL(5,2)  NOT NULL DEFAULT 0 COMMENT '准确率变化（正数=提升）',
    latency_delta_pct DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT '延迟变化百分比',
    
    -- 测试结论
    test_result    VARCHAR(20)   NOT NULL COMMENT 'PASS/PARTIAL/FAIL',
    test_report_url VARCHAR(512) DEFAULT NULL COMMENT '详细报告URL',
    
    triggered_by   VARCHAR(64)   NOT NULL COMMENT 'MANUAL/AUTO/SCHEDULED/CI',
    started_at     DATETIME(3)   NOT NULL,
    finished_at    DATETIME(3)   DEFAULT NULL,
    created_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    
    INDEX idx_version (version_id),
    INDEX idx_batch (batch_no),
    FOREIGN KEY (version_id) REFERENCES prompt_version(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='回归测试结果表';
```

#### 3.1.7 `prompt_experiment` — Prompt 实验表

```sql
CREATE TABLE prompt_experiment (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    experiment_code VARCHAR(128) NOT NULL UNIQUE,
    experiment_name VARCHAR(256) NOT NULL,
    template_id     BIGINT       NOT NULL,
    
    -- 实验类型
    experiment_type VARCHAR(32)  NOT NULL COMMENT 'AB_TEST/CANARY/SHADOW',
    
    -- 参与版本
    control_version_id  BIGINT   NOT NULL COMMENT '对照组版本（基线）',
    treatment_version_id BIGINT   NOT NULL COMMENT '实验组版本（新版本）',
    
    -- 分流策略
    traffic_split    INT          NOT NULL DEFAULT 10 COMMENT '实验组流量百分比',
    targeting_rules  JSON         NOT NULL COMMENT '分流规则（学段/年级/地区等）',
    
    -- 评估指标
    primary_metric   VARCHAR(64)  NOT NULL COMMENT '主要评估指标',
    secondary_metrics JSON        DEFAULT NULL COMMENT '次要指标列表',
    
    -- 实验状态
    status           VARCHAR(20)  NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/RUNNING/PAUSED/COMPLETED/STOPPED',
    started_at       DATETIME(3)  DEFAULT NULL,
    ended_at         DATETIME(3)  DEFAULT NULL,
    
    -- 实验结论
    conclusion       TEXT         DEFAULT NULL COMMENT '实验结论',
    winner_version_id BIGINT      DEFAULT NULL COMMENT '胜出版本ID',
    statistical_significance DECIMAL(5,2) DEFAULT NULL COMMENT '统计显著性（p值）',
    
    created_by       BIGINT       NOT NULL,
    created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    
    INDEX idx_template (template_id),
    INDEX idx_status (status),
    FOREIGN KEY (template_id) REFERENCES prompt_template(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Prompt实验表';
```

#### 3.1.8 `prompt_call_metric` — Prompt 调用指标表（按分钟聚合）

```sql
CREATE TABLE prompt_call_metric (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    template_id     BIGINT       NOT NULL,
    version_id      BIGINT       NOT NULL,
    experiment_id   BIGINT       DEFAULT NULL COMMENT '关联实验ID（如有）',
    
    -- 时间维度
    stat_minute     DATETIME     NOT NULL COMMENT '统计分钟',
    stat_date       DATE         NOT NULL COMMENT '统计日期（用于分区/归档）',
    
    -- 调用统计
    call_count      INT          NOT NULL DEFAULT 0 COMMENT '总调用次数',
    success_count   INT          NOT NULL DEFAULT 0 COMMENT '成功次数',
    error_count     INT          NOT NULL DEFAULT 0 COMMENT '错误次数',
    timeout_count   INT          NOT NULL DEFAULT 0 COMMENT '超时次数',
    
    -- 性能指标
    avg_latency_ms  INT          NOT NULL DEFAULT 0,
    p50_latency_ms  INT          NOT NULL DEFAULT 0,
    p95_latency_ms  INT          NOT NULL DEFAULT 0,
    p99_latency_ms  INT          NOT NULL DEFAULT 0,
    
    -- 质量指标
    avg_quality_score DECIMAL(5,2) DEFAULT NULL COMMENT '平均质量分（来自后处理评估）',
    avg_safety_score  DECIMAL(5,2) DEFAULT NULL COMMENT '平均安全分',
    avg_user_rating   DECIMAL(3,2) DEFAULT NULL COMMENT '平均用户评分（1-5星）',
    positive_feedback_count INT   NOT NULL DEFAULT 0 COMMENT '正面反馈数',
    negative_feedback_count INT   NOT NULL DEFAULT 0 COMMENT '负面反馈数',
    
    -- Token 消耗
    total_input_tokens  BIGINT   NOT NULL DEFAULT 0,
    total_output_tokens BIGINT   NOT NULL DEFAULT 0,
    estimated_cost_yuan DECIMAL(10,4) DEFAULT NULL COMMENT '估算成本（元）',
    
    UNIQUE KEY uk_metric (template_id, version_id, stat_minute),
    INDEX idx_date (stat_date),
    INDEX idx_version (version_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Prompt调用指标表'
PARTITION BY RANGE (TO_DAYS(stat_date)) (
    PARTITION p_20260701 VALUES LESS THAN (TO_DAYS('2026-07-01')),
    PARTITION p_20260801 VALUES LESS THAN (TO_DAYS('2026-08-01')),
    PARTITION p_max VALUES LESS THAN MAXVALUE
);
```

### 3.2 缓存设计

```redis
# Prompt 活跃版本缓存（写入时刷新，TTL 10分钟）
prompt:active:{templateCode} → JSON({ versionId, versionNumber, systemPrompt, userPromptTpl, variablesSchema, modelParams })

# Prompt 灰度版本缓存
prompt:staging:{templateCode} → JSON({ versionId, ... })

# Prompt 实验分流缓存
prompt:experiment:{experimentCode}:assignment:{userId} → "control" | "treatment"

# Prompt 回归测试锁
prompt:regression:lock:{versionId} → "1" (TTL 30分钟)

# Prompt 效果指标实时计数器
prompt:metrics:{versionId}:{yyyyMMddHHmm} → Hash({
    "calls": count,
    "errors": count,
    "quality_sum": sum,
    "quality_count": count,
    "latency_sum": sum
})
```

---

## 4. API 接口设计

### 4.1 Prompt 版本管理 API

#### 4.1.1 创建 Prompt 版本

```
POST /api/v1/admin/prompt-templates/{templateId}/versions
Content-Type: application/json
Authorization: Bearer {admin_token}

Request Body:
{
    "versionNumber": "1.3.0",
    "versionLabel": "初中数学-增加作图题引导",
    "systemPrompt": "你是一名专业的初中数学辅导老师...",
    "userPromptTpl": "学生问题：{{question}}\n年级：{{grade}}\n教材版本：{{textbookVersion}}\n请按照分步讲解的方式...",
    "variablesSchema": {
        "type": "object",
        "properties": {
            "question": { "type": "string", "required": true, "maxLength": 2000 },
            "grade": { "type": "string", "required": true, "enum": ["七年级","八年级","九年级"] },
            "textbookVersion": { "type": "string", "required": true },
            "chapterCode": { "type": "string", "required": false }
        }
    },
    "modelParams": {
        "temperature": 0.3,
        "topP": 0.9,
        "maxTokens": 2048,
        "presencePenalty": 0.0,
        "frequencyPenalty": 0.0
    },
    "stopSequences": ["###END###"],
    "fragmentRefs": {
        "safety_guard": "fragment_safety_v2",
        "format_guide": "fragment_math_format_v1"
    },
    "changeSummary": "增加几何作图题的分步引导逻辑",
    "changeDetail": "1. 在system_prompt中增加作图题识别规则\n2. 增加坐标系/几何图形辅助说明策略\n3. 调整temperature从0.5→0.3以提升一致性",
    "parentVersionId": 10042
}

Response (201 Created):
{
    "code": 0,
    "data": {
        "versionId": 10056,
        "templateId": 12,
        "versionNumber": "1.3.0",
        "lifecycleStatus": "DRAFT",
        "createdAt": "2026-07-15T03:40:00.000Z"
    }
}
```

#### 4.1.2 提交评审

```
POST /api/v1/admin/prompt-versions/{versionId}/submit-review
Authorization: Bearer {admin_token}

Request Body:
{
    "reviewers": [1001, 1002],
    "reviewNotes": "请重点评审作图题引导逻辑是否符合教学规范",
    "autoTestOnApprove": true
}

Response (200 OK):
{
    "code": 0,
    "data": {
        "versionId": 10056,
        "lifecycleStatus": "REVIEWING",
        "submittedAt": "2026-07-15T03:42:00.000Z"
    }
}
```

#### 4.1.3 获取版本详情（含变更对比）

```
GET /api/v1/admin/prompt-versions/{versionId}?diffWith={baselineVersionId}

Response (200 OK):
{
    "code": 0,
    "data": {
        "versionId": 10056,
        "templateId": 12,
        "templateCode": "math_solve_junior",
        "versionNumber": "1.3.0",
        "lifecycleStatus": "TESTING",
        "systemPrompt": "...",
        "userPromptTpl": "...",
        "variablesSchema": {...},
        "modelParams": {...},
        "changeSummary": "增加几何作图题的分步引导逻辑",
        "diff": {
            "systemPrompt": {
                "added": ["在处理几何作图题时，先引导学生画出示意图..."],
                "removed": [],
                "modified": [
                    {
                        "old": "temperature: 0.5",
                        "new": "temperature: 0.3"
                    }
                ]
            },
            "userPromptTpl": {
                "added": ["{{#if isGeometryProblem}}请先画出示意图...{{/if}}"],
                "removed": []
            }
        },
        "regressionResults": [...],
        "metrics": {...}
    }
}
```

### 4.2 回归测试 API

#### 4.2.1 触发回归测试

```
POST /api/v1/admin/prompt-versions/{versionId}/regression-test
Authorization: Bearer {admin_token}

Request Body:
{
    "testCaseIds": null,  // null=全部用例，指定ID数组则只测指定用例
    "baselineVersionId": 10042,  // 对比基线版本
    "timeoutSeconds": 600,
    "parallelism": 5,  // 并行度
    "notifyOnComplete": true
}

Response (202 Accepted):
{
    "code": 0,
    "data": {
        "batchNo": "REG-20260715-034200-10056",
        "status": "RUNNING",
        "totalCases": 120,
        "estimatedDurationSeconds": 300
    }
}
```

#### 4.2.2 查询回归测试结果

```
GET /api/v1/admin/prompt-versions/{versionId}/regression-results/{batchNo}

Response (200 OK):
{
    "code": 0,
    "data": {
        "batchNo": "REG-20260715-034200-10056",
        "status": "COMPLETED",
        "totalCases": 120,
        "passedCases": 114,
        "failedCases": 6,
        "passRate": 95.00,
        "avgAccuracy": 87.3,
        "avgSafety": 98.5,
        "avgLatencyMs": 2340,
        "p99LatencyMs": 5600,
        "avgTokenUsage": 856,
        "baselineComparison": {
            "baselineVersionId": 10042,
            "baselineAvgAccuracy": 84.1,
            "accuracyDelta": 3.2,
            "latencyDeltaPct": -5.1,
            "verdict": "IMPROVED"
        },
        "testResult": "PASS",
        "failedCaseDetails": [
            {
                "caseId": 2034,
                "caseName": "二次函数最值问题-含参讨论",
                "failureReason": "accuracy_score=72.0 < min_accuracy_score=80.0",
                "actualOutput": "...",
                "expectedSummary": "..."
            }
        ],
        "testReportUrl": "https://oss.primetop.com/reports/REG-20260715-034200-10056.html"
    }
}
```

### 4.3 灰度发布 API

#### 4.3.1 创建灰度发布计划

```
POST /api/v1/admin/prompt-templates/{templateId}/canary-release
Authorization: Bearer {admin_token}

Request Body:
{
    "versionId": 10056,
    "baselineVersionId": 10042,
    "strategy": "GRADUAL",
    "steps": [
        {
            "trafficPct": 5,
            "duration": "PT2H",
            "successCriteria": {
                "minAccuracyScore": 82.0,
                "maxErrorRate": 2.0,
                "maxLatencyP99Ms": 8000,
                "minUserRating": 4.0
            }
        },
        {
            "trafficPct": 20,
            "duration": "PT6H",
            "successCriteria": {
                "minAccuracyScore": 83.0,
                "maxErrorRate": 1.5,
                "maxLatencyP99Ms": 7000,
                "minUserRating": 4.1
            }
        },
        {
            "trafficPct": 50,
            "duration": "PT12H",
            "successCriteria": {
                "minAccuracyScore": 84.0,
                "maxErrorRate": 1.0,
                "maxLatencyP99Ms": 6000,
                "minUserRating": 4.2
            }
        },
        {
            "trafficPct": 100,
            "duration": "PT24H",
            "successCriteria": {
                "minAccuracyScore": 85.0,
                "maxErrorRate": 1.0,
                "maxLatencyP99Ms": 6000,
                "minUserRating": 4.2
            }
        }
    ],
    "targetingRules": {
        "gradeRange": ["七年级", "八年级", "九年级"],
        "excludeRegions": [],
        "userWhitelist": null
    },
    "autoRollback": true,
    "autoPromoteOnSuccess": true
}

Response (201 Created):
{
    "code": 0,
    "data": {
        "releaseId": 2008,
        "templateId": 12,
        "versionId": 10056,
        "currentStep": 0,
        "currentTrafficPct": 5,
        "status": "RUNNING",
        "nextStepAt": "2026-07-15T05:42:00.000Z"
    }
}
```

#### 4.3.2 查询灰度发布状态

```
GET /api/v1/admin/prompt-templates/{templateId}/canary-status

Response (200 OK):
{
    "code": 0,
    "data": {
        "releaseId": 2008,
        "status": "RUNNING",
        "currentStep": 1,
        "totalSteps": 4,
        "currentTrafficPct": 20,
        "version": {
            "versionId": 10056,
            "versionNumber": "1.3.0"
        },
        "baseline": {
            "versionId": 10042,
            "versionNumber": "1.2.1"
        },
        "stepMetrics": {
            "current": {
                "callCount": 3421,
                "avgAccuracy": 86.2,
                "avgLatencyMs": 2180,
                "errorRate": 0.8,
                "avgUserRating": 4.3
            },
            "baseline": {
                "callCount": 13684,
                "avgAccuracy": 84.1,
                "avgLatencyMs": 2340,
                "errorRate": 1.2,
                "avgUserRating": 4.1
            }
        },
        "meetsCriteria": true,
        "nextAction": "AUTO_PROMOTE",
        "nextStepAt": "2026-07-15T11:42:00.000Z"
    }
}
```

### 4.4 Prompt 运行时路由 API（内部服务调用）

#### 4.4.1 获取当前生效的 Prompt 版本

```
GET /api/v1/internal/prompt/resolve/{templateCode}?userId={userId}&grade={grade}&subject={subject}

Response (200 OK):
{
    "code": 0,
    "data": {
        "versionId": 10056,
        "systemPrompt": "你是一名专业的初中数学辅导老师...",
        "userPromptTpl": "...",
        "variablesSchema": {...},
        "modelParams": {
            "temperature": 0.3,
            "topP": 0.9,
            "maxTokens": 2048
        },
        "experimentId": 3001,
        "experimentGroup": "treatment"
    }
}
```

### 4.5 效果分析 API

#### 4.5.1 版本效果对比

```
GET /api/v1/admin/prompt-templates/{templateId}/versions/{versionIdA}/compare/{versionIdB}?startDate={date}&endDate={date}

Response (200 OK):
{
    "code": 0,
    "data": {
        "versionA": { "versionId": 10056, "versionNumber": "1.3.0" },
        "versionB": { "versionId": 10042, "versionNumber": "1.2.1" },
        "comparison": {
            "accuracy": { "a": 86.2, "b": 84.1, "delta": 2.1, "significant": true },
            "latencyMs": { "a": 2180, "b": 2340, "delta": -160, "deltaPct": -6.8 },
            "userRating": { "a": 4.3, "b": 4.1, "delta": 0.2, "significant": true },
            "errorRate": { "a": 0.8, "b": 1.2, "delta": -0.4 },
            "tokenUsage": { "a": 856, "b": 920, "delta": -64, "deltaPct": -7.0 },
            "costPerCall": { "a": 0.0183, "b": 0.0196, "delta": -0.0013 }
        },
        "recommendation": "PROMOTE_A"
    }
}
```

---

## 5. 核心业务逻辑

### 5.1 Prompt 版本解析与路由流程

```java
/**
 * Prompt 版本解析器 — 根据用户上下文返回生效的 Prompt 版本
 */
@Service
public class PromptVersionResolver {

    @Autowired
    private PromptTemplateMapper templateMapper;
    
    @Autowired
    private PromptExperimentService experimentService;
    
    @Autowired
    private RedisTemplate<String, String> redisTemplate;
    
    @Autowired
    private PromptMetricsCollector metricsCollector;
    
    private static final String ACTIVE_CACHE_KEY = "prompt:active:";
    private static final String STAGING_CACHE_KEY = "prompt:staging:";
    
    /**
     * 解析生效的 Prompt 版本
     * 
     * 路由优先级：
     * 1. 用户命中实验 → 返回实验组版本
     * 2. 灰度发布中且用户在灰度范围 → 按流量百分比分流
     * 3. 返回当前线上稳定版本
     */
    public ResolvedPrompt resolve(String templateCode, UserContext userCtx) {
        // 1. 校验模板存在
        PromptTemplate template = templateMapper.getByCode(templateCode);
        if (template == null || template.getStatus() != 1) {
            throw new PromptNotFoundException("Prompt template not found: " + templateCode);
        }
        
        // 2. 检查活跃实验
        PromptExperiment experiment = experimentService
            .findActiveExperiment(template.getId(), userCtx);
        
        if (experiment != null) {
            ExperimentAssignment assignment = experimentService.assignUser(
                experiment.getId(), userCtx.getUserId()
            );
            
            Long versionId = assignment.isTreatment() 
                ? experiment.getTreatmentVersionId()
                : experiment.getControlVersionId();
            
            PromptVersion version = loadVersion(versionId);
            metricsCollector.recordExperimentExposure(experiment.getId(), 
                userCtx.getUserId(), assignment.getGroup());
            
            return ResolvedPrompt.builder()
                .version(version)
                .experimentId(experiment.getId())
                .experimentGroup(assignment.getGroup())
                .build();
        }
        
        // 3. 检查灰度发布
        CanaryRelease canary = canaryService.getActiveRelease(template.getId());
        if (canary != null && canary.isInTargetingRange(userCtx)) {
            // 基于用户ID哈希分流
            int hashBucket = Math.abs(
                userCtx.getUserId().hashCode() % 100
            );
            if (hashBucket < canary.getCurrentTrafficPct()) {
                PromptVersion stagingVersion = loadVersion(
                    canary.getVersionId()
                );
                metricsCollector.recordCanaryExposure(
                    canary.getReleaseId(), userCtx.getUserId()
                );
                return ResolvedPrompt.builder()
                    .version(stagingVersion)
                    .releaseId(canary.getReleaseId())
                    .build();
            }
        }
        
        // 4. 返回稳定版本（带缓存）
        return ResolvedPrompt.builder()
            .version(loadActiveVersionFromCache(template))
            .build();
    }
    
    /**
     * 从缓存加载活跃版本，缓存未命中则查库并回填
     */
    private PromptVersion loadActiveVersionFromCache(PromptTemplate template) {
        String cacheKey = ACTIVE_CACHE_KEY + template.getTemplateCode();
        String cached = redisTemplate.opsForValue().get(cacheKey);
        
        if (cached != null) {
            PromptVersion cachedVersion = JsonUtil.fromJson(cached, PromptVersion.class);
            if (cachedVersion.getId().equals(template.getCurrentVersionId())) {
                return cachedVersion;
            }
            // 缓存版本与当前线上版本不一致，说明版本刚切换，重新加载
        }
        
        PromptVersion version = versionMapper.getById(
            template.getCurrentVersionId()
        );
        if (version == null) {
            throw new PromptVersionNotFoundException(
                "Active version not found for template: " + template.getTemplateCode()
            );
        }
        
        // 渲染共享片段
        version = renderFragments(version);
        
        redisTemplate.opsForValue().set(
            cacheKey, JsonUtil.toJson(version), 
            10, TimeUnit.MINUTES
        );
        
        return version;
    }
    
    /**
     * 渲染共享片段到 Prompt 中
     * 支持片段引用语法：{{@fragment_alias}}
     */
    private PromptVersion renderFragments(PromptVersion version) {
        List<PromptVersionFragment> refs = fragmentMapper
            .getByVersionId(version.getId());
        
        if (refs.isEmpty()) {
            return version;
        }
        
        Map<String, String> fragmentMap = refs.stream()
            .collect(Collectors.toMap(
                PromptVersionFragment::getFragmentAlias,
                f -> fragmentMapper.getById(f.getFragmentId()).getContent()
            ));
        
        String renderedSystemPrompt = replaceFragments(
            version.getSystemPrompt(), fragmentMap
        );
        String renderedUserPrompt = replaceFragments(
            version.getUserPromptTpl(), fragmentMap
        );
        
        return version.toBuilder()
            .systemPrompt(renderedSystemPrompt)
            .userPromptTpl(renderedUserPrompt)
            .build();
    }
    
    private String replaceFragments(String text, Map<String, String> fragments) {
        for (Map.Entry<String, String> entry : fragments.entrySet()) {
            text = text.replace(
                "{{@" + entry.getKey() + "}}", 
                entry.getValue()
            );
        }
        return text;
    }
}
```

### 5.2 回归测试执行引擎

```java
/**
 * 回归测试执行引擎
 */
@Service
@Slf4j
public class RegressionTestEngine {
    
    @Autowired
    private PromptGoldenCaseMapper caseMapper;
    
    @Autowired
    private LlmInvokerService llmInvoker;
    
    @Autowired
    private QualityAssessmentService qualityAssessment;
    
    @Autowired
    private PromptRegressionResultMapper resultMapper;
    
    @Autowired
    private RedissonClient redisson;
    
    /**
     * 执行回归测试
     */
    @Async("regressionTestExecutor")
    public CompletableFuture<RegressionTestReport> execute(
            Long versionId, RegressionTestRequest request) {
        
        String batchNo = generateBatchNo(versionId);
        String lockKey = "prompt:regression:lock:" + versionId;
        RLock lock = redisson.getLock(lockKey);
        
        if (!lock.tryLock()) {
            throw new RegressionTestInProgressException(
                "Regression test already running for version: " + versionId
            );
        }
        
        try {
            // 1. 加载测试用例
            List<PromptGoldenCase> cases = loadTestCases(
                request.getTestCaseIds(), versionId
            );
            
            // 2. 加载被测版本
            PromptVersion testVersion = versionMapper.getById(versionId);
            PromptVersion baselineVersion = request.getBaselineVersionId() != null
                ? versionMapper.getById(request.getBaselineVersionId())
                : null;
            
            // 3. 并行执行测试用例
            int parallelism = Math.min(request.getParallelism(), 10);
            ExecutorService executor = Executors.newFixedThreadPool(parallelism);
            
            List<CompletableFuture<CaseResult>> futures = cases.stream()
                .map(testCase -> CompletableFuture.supplyAsync(
                    () -> executeSingleCase(testCase, testVersion),
                    executor
                ))
                .collect(Collectors.toList());
            
            List<CaseResult> results = futures.stream()
                .map(CompletableFuture::join)
                .collect(Collectors.toList());
            
            executor.shutdown();
            
            // 4. 基线对比（可选）
            List<CaseResult> baselineResults = null;
            if (baselineVersion != null) {
                List<CompletableFuture<CaseResult>> baselineFutures = cases.stream()
                    .map(tc -> CompletableFuture.supplyAsync(
                        () -> executeSingleCase(tc, baselineVersion),
                        executor
                    ))
                    .collect(Collectors.toList());
                baselineResults = baselineFutures.stream()
                    .map(CompletableFuture::join)
                    .collect(Collectors.toList());
            }
            
            // 5. 汇总报告
            RegressionTestReport report = buildReport(
                batchNo, versionId, results, baselineResults
            );
            
            // 6. 持久化
            saveRegressionResult(report);
            
            // 7. 推送通知
            if (request.isNotifyOnComplete()) {
                notifyTestComplete(report);
            }
            
            return CompletableFuture.completedFuture(report);
            
        } finally {
            lock.unlock();
        }
    }
    
    /**
     * 执行单个测试用例
     */
    private CaseResult executeSingleCase(
            PromptGoldenCase testCase, PromptVersion version) {
        
        long startTime = System.currentTimeMillis();
        
        try {
            // 构建调用参数
            Map<String, Object> variables = JsonUtil.fromJson(
                testCase.getInputVariables(), Map.class
            );
            
            String renderedPrompt = PromptRenderer.render(
                version.getUserPromptTpl(), variables
            );
            
            // 调用模型
            LlmInvokeRequest invokeRequest = LlmInvokeRequest.builder()
                .systemPrompt(version.getSystemPrompt())
                .userPrompt(renderedPrompt)
                .modelParams(version.getModelParams())
                .timeoutMs(30000)
                .build();
            
            LlmInvokeResponse response = llmInvoker.invoke(invokeRequest);
            
            long latency = System.currentTimeMillis() - startTime;
            
            // 质量评估
            QualityScore qualityScore = qualityAssessment.assess(
                QualityAssessmentRequest.builder()
                    .output(response.getContent())
                    .expectedSummary(testCase.getExpectedSummary())
                    .expectedKeywords(testCase.getExpectedKeywords())
                    .forbiddenKeywords(testCase.getForbiddenKeywords())
                    .expectedFormat(testCase.getExpectedFormat())
                    .build()
            );
            
            // 安全评估
            SafetyScore safetyScore = qualityAssessment.assessSafety(
                response.getContent()
            );
            
            // 判定通过/失败
            boolean passed = qualityScore.getAccuracy() >= testCase.getMinAccuracyScore()
                && safetyScore.getScore() >= testCase.getMinSafetyScore()
                && latency <= testCase.getMaxLatencyMs();
            
            return CaseResult.builder()
                .caseId(testCase.getId())
                .caseName(testCase.getCaseName())
                .actualOutput(response.getContent())
                .latencyMs(latency)
                .tokenUsage(response.getTotalTokens())
                .accuracyScore(qualityScore.getAccuracy())
                .safetyScore(safetyScore.getScore())
                .formatScore(qualityScore.getFormatScore())
                .passed(passed)
                .failureReason(passed ? null : buildFailureReason(
                    testCase, qualityScore, safetyScore, latency
                ))
                .build();
            
        } catch (Exception e) {
            long latency = System.currentTimeMillis() - startTime;
            return CaseResult.builder()
                .caseId(testCase.getId())
                .caseName(testCase.getCaseName())
                .latencyMs(latency)
                .passed(false)
                .failureReason("EXECUTION_ERROR: " + e.getMessage())
                .build();
        }
    }
    
    private String buildFailureReason(
            PromptGoldenCase testCase,
            QualityScore quality,
            SafetyScore safety,
            long latency) {
        
        List<String> reasons = new ArrayList<>();
        
        if (quality.getAccuracy() < testCase.getMinAccuracyScore()) {
            reasons.add(String.format(
                "accuracy_score=%.1f < min=%.1f",
                quality.getAccuracy(), testCase.getMinAccuracyScore()
            ));
        }
        if (safety.getScore() < testCase.getMinSafetyScore()) {
            reasons.add(String.format(
                "safety_score=%.1f < min=%.1f",
                safety.getScore(), testCase.getMinSafetyScore()
            ));
        }
        if (latency > testCase.getMaxLatencyMs()) {
            reasons.add(String.format(
                "latency=%dms > max=%dms",
                latency, testCase.getMaxLatencyMs()
            ));
        }
        
        return String.join("; ", reasons);
    }
}
```

### 5.3 自动灰度发布与回滚

```java
/**
 * 灰度发布调度引擎
 */
@Service
@Slf4j
public class CanaryReleaseScheduler {
    
    @Autowired
    private CanaryReleaseMapper releaseMapper;
    
    @Autowired
    private PromptCallMetricService metricService;
    
    @Autowired
    private PromptVersionService versionService;
    
    @Autowired
    private NotifyService notifyService;
    
    /**
     * 定时检查灰度发布状态（每5分钟执行）
     */
    @Scheduled(fixedRate = 5 * 60 * 1000)
    public void checkCanaryReleases() {
        List<CanaryRelease> activeReleases = releaseMapper
            .findByStatus("RUNNING");
        
        for (CanaryRelease release : activeReleases) {
            try {
                processCanaryStep(release);
            } catch (Exception e) {
                log.error("Canary check failed for release {}: {}", 
                    release.getId(), e.getMessage(), e);
            }
        }
    }
    
    private void processCanaryStep(CanaryRelease release) {
        CanaryStep currentStep = release.getCurrentStep();
        
        // 1. 收集当前步骤的指标
        CanaryMetrics metrics = metricService.collectCanaryMetrics(
            release.getId(),
            release.getTemplateId(),
            release.getVersionId(),
            release.getBaselineVersionId(),
            currentStep.getStartedAt()
        );
        
        log.info("Canary release {} step {}/{}: {}% traffic, metrics={}",
            release.getId(),
            release.getCurrentStepIndex() + 1,
            release.getTotalSteps(),
            currentStep.getTrafficPct(),
            metrics);
        
        // 2. 检查是否满足当前步骤的成功标准
        SuccessCriteria criteria = currentStep.getSuccessCriteria();
        boolean meetsCriteria = evaluateCriteria(metrics, criteria);
        
        // 3. 检查是否需要紧急回滚
        if (shouldRollback(metrics, criteria)) {
            log.warn("Canary release {} triggering auto-rollback! metrics={}",
                release.getId(), metrics);
            triggerRollback(release, metrics);
            return;
        }
        
        // 4. 检查步骤是否到期
        if (!currentStep.isExpired()) {
            return; // 还在观察期，继续等待
        }
        
        if (!meetsCriteria) {
            log.warn("Canary release {} step {} does not meet criteria, pausing",
                release.getId(), release.getCurrentStepIndex());
            release.setStatus("PAUSED");
            releaseMapper.update(release);
            notifyService.notifyCanaryPaused(release, metrics);
            return;
        }
        
        // 5. 是否是最后一步
        if (release.isLastStep()) {
            // 全量发布成功
            completeRelease(release, metrics);
        } else {
            // 进入下一步
            release.advanceToNextStep();
            releaseMapper.update(release);
            
            // 刷新缓存
            versionService.refreshStagingCache(release);
            
            notifyService.notifyCanaryPromoted(release, metrics);
        }
    }
    
    /**
     * 评估是否满足成功标准
     */
    private boolean evaluateCriteria(CanaryMetrics metrics, SuccessCriteria criteria) {
        if (metrics.getSampleSize() < 30) {
            log.debug("Sample size too small ({}), skipping criteria check",
                metrics.getSampleSize());
            return true; // 样本量不足时暂不判定
        }
        
        return metrics.getAccuracy() >= criteria.getMinAccuracyScore()
            && metrics.getErrorRate() <= criteria.getMaxErrorRate()
            && metrics.getLatencyP99() <= criteria.getMaxLatencyP99Ms()
            && metrics.getUserRating() >= criteria.getMinUserRating();
    }
    
    /**
     * 回滚判定 — 出现严重问题时立即回滚
     */
    private boolean shouldRollback(CanaryMetrics metrics, SuccessCriteria criteria) {
        // 错误率超过阈值的3倍 → 立即回滚
        if (metrics.getErrorRate() > criteria.getMaxErrorRate() * 3) {
            return true;
        }
        
        // 安全分低于 90 → 立即回滚
        if (metrics.getAvgSafetyScore() != null 
            && metrics.getAvgSafetyScore() < 90.0) {
            return true;
        }
        
        // 准确率比基线下降超过 15 个百分点 → 立即回滚
        if (metrics.getBaselineAccuracy() != null
            && metrics.getAccuracy() < metrics.getBaselineAccuracy() - 15.0) {
            return true;
        }
        
        // 用户评分低于 3.0 → 立即回滚
        if (metrics.getSampleSize() >= 50
            && metrics.getUserRating() < 3.0) {
            return true;
        }
        
        return false;
    }
    
    /**
     * 触发回滚
     */
    private void triggerRollback(CanaryRelease release, CanaryMetrics metrics) {
        // 1. 更新发布状态
        release.setStatus("ROLLED_BACK");
        release.setRolledBackAt(LocalDateTime.now());
        release.setRollbackReason(buildRollbackReason(metrics));
        releaseMapper.update(release);
        
        // 2. 回滚版本状态
        versionService.rollbackVersion(
            release.getVersionId(),
            release.getBaselineVersionId(),
            "AUTO_ROLLBACK: " + metrics
        );
        
        // 3. 清除灰度缓存
        versionService.clearStagingCache(release.getTemplateId());
        
        // 4. 紧急通知
        notifyService.notifyCanaryRollback(release, metrics);
        
        // 5. 记录告警事件
        alertService.raiseAlert(
            "PROMPT_CANARY_ROLLBACK",
            AlertLevel.CRITICAL,
            String.format(
                "Template %s version %s auto-rolled back. Metrics: %s",
                release.getTemplateId(),
                release.getVersionId(),
                metrics
            )
        );
    }
    
    /**
     * 完成全量发布
     */
    private void completeRelease(CanaryRelease release, CanaryMetrics metrics) {
        // 1. 将新版本设为线上版本
        versionService.publishVersion(release.getVersionId());
        
        // 2. 更新模板的当前版本指针
        templateMapper.updateCurrentVersionId(
            release.getTemplateId(),
            release.getVersionId()
        );
        
        // 3. 刷新活跃版本缓存
        versionService.refreshActiveCache(release.getTemplateId());
        
        // 4. 更新发布状态
        release.setStatus("COMPLETED");
        release.setCompletedAt(LocalDateTime.now());
        releaseMapper.update(release);
        
        // 5. 通知
        notifyService.notifyCanaryCompleted(release, metrics);
    }
}
```

### 5.4 质量评估服务

```java
/**
 * Prompt 输出质量评估服务
 * 
 * 三层评估体系：
 * 1. 规则匹配层 — 关键词/格式检查（快、确定性）
 * 2. 语义评估层 — 使用评估模型打分（准、耗时）
 * 3. 统计聚合层 — 汇总指标用于趋势分析
 */
@Service
public class QualityAssessmentService {
    
    @Autowired
    private LlmInvokerService llmInvoker;
    
    @Value("${prompt.quality.assessment-model}")
    private String assessmentModel;  // 如 gpt-4o-mini
    
    /**
     * 规则匹配层：关键词与格式检查
     */
    public QualityScore assess(QualityAssessmentRequest request) {
        String output = request.getOutput();
        List<String> expectedKeywords = request.getExpectedKeywords();
        List<String> forbiddenKeywords = request.getForbiddenKeywords();
        
        // 关键词覆盖率
        double keywordCoverage = 0.0;
        if (expectedKeywords != null && !expectedKeywords.isEmpty()) {
            long matched = expectedKeywords.stream()
                .filter(kw -> output.contains(kw))
                .count();
            keywordCoverage = (double) matched / expectedKeywords.size() * 100;
        }
        
        // 禁止词检测
        boolean hasForbidden = forbiddenKeywords != null
            && forbiddenKeywords.stream().anyMatch(output::contains);
        
        // 格式检查
        double formatScore = assessFormat(output, request.getExpectedFormat());
        
        // 与期望摘要的语义相似度
        double accuracyScore = (keywordCoverage * 0.3 + formatScore * 0.2);
        if (accuracyScore > 100) accuracyScore = 100;
        
        // 如果有禁止词，直接降分
        if (hasForbidden) {
            accuracyScore *= 0.5;
        }
        
        return QualityScore.builder()
            .accuracy(BigDecimal.valueOf(accuracyScore)
                .setScale(2, RoundingMode.HALF_UP).doubleValue())
            .formatScore(BigDecimal.valueOf(formatScore)
                .setScale(2, RoundingMode.HALF_UP).doubleValue())
            .keywordCoverage(BigDecimal.valueOf(keywordCoverage)
                .setScale(2, RoundingMode.HALF_UP).doubleValue())
            .build();
    }
    
    /**
     * 语义评估层：使用评估模型进行深度评分
     * 用于回归测试和定期质量审计
     */
    public DeepQualityAssessment deepAssess(
            String output, String expectedSummary, 
            String question, String gradeLevel) {
        
        String assessmentPrompt = buildAssessmentPrompt(
            output, expectedSummary, question, gradeLevel
        );
        
        LlmInvokeResponse response = llmInvoker.invoke(
            LlmInvokeRequest.builder()
                .model(assessmentModel)
                .systemPrompt(ASSESSMENT_SYSTEM_PROMPT)
                .userPrompt(assessmentPrompt)
                .modelParams(ModelParams.builder()
                    .temperature(0.0)  // 确定性输出
                    .maxTokens(500)
                    .build())
                .timeoutMs(15000)
                .build()
        );
        
        // 解析评估结果（JSON格式）
        return JsonUtil.fromJson(response.getContent(), 
            DeepQualityAssessment.class);
    }
    
    private static final String ASSESSMENT_SYSTEM_PROMPT = """
        你是一个教育AI回答质量评估专家。请对AI辅导系统的回答进行评分。
        
        评分维度：
        1. accuracy (0-100): 内容准确性，是否存在知识错误
        2. pedagogy (0-100): 教学方法合理性，是否符合启发式引导原则
        3. age_appropriateness (0-100): 表达是否适合学生学段
        4. completeness (0-100): 回答完整性
        5. clarity (0-100): 表述清晰度
        
        请严格按以下JSON格式输出：
        {"accuracy": 85, "pedagogy": 90, "age_appropriateness": 88, 
         "completeness": 82, "clarity": 92, 
         "issues": ["问题1", "问题2"]}
        """;
    
    private String buildAssessmentPrompt(
            String output, String expectedSummary,
            String question, String gradeLevel) {
        return String.format("""
            ## 原始问题
            %s
            
            ## 学生学段
            %s
            
            ## AI回答
            %s
            
            ## 期望回答要点
            %s
            
            请对AI回答进行评分。
            """, question, gradeLevel, output, expectedSummary);
    }
}
```

---

## 6. Prompt 指标实时采集

### 6.1 采集流程

```
AI调用请求
    │
    ▼
PromptVersionResolver.resolve()  ← 解析版本
    │
    ├── 记录 experimentId / releaseId（如有）
    │
    ▼
LLM 调用执行
    │
    ├── 成功/失败/超时
    │
    ▼
后处理评估（异步）
    │
    ├── 规则层评估 → qualityScore
    ├── 安全过滤 → safetyScore
    │
    ▼
指标写入
    │
    ├── Redis 实时计数器（亚秒级）
    ├── Kafka 事件流（异步持久化）
    └── MySQL 分钟级聚合（T+1分钟）
```

### 6.2 指标采集实现

```java
/**
 * Prompt 指标采集器
 */
@Service
@Slf4j
public class PromptMetricsCollector {
    
    @Autowired
    private RedisTemplate<String, String> redisTemplate;
    
    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;
    
    private static final String METRIC_KEY_PATTERN = 
        "prompt:metrics:%d:%s";  // versionId, yyyyMMddHHmm
    
    /**
     * 记录单次 Prompt 调用指标
     */
    public void recordCall(PromptCallContext ctx) {
        String minuteKey = LocalDateTime.now()
            .format(DateTimeFormatter.ofPattern("yyyyMMddHHmm"));
        String redisKey = String.format(
            METRIC_KEY_PATTERN, ctx.getVersionId(), minuteKey
        );
        
        // 使用 Redis Hash 原子更新计数器
        redisTemplate.opsForHash().increment(redisKey, "calls", 1);
        
        if (ctx.isError()) {
            redisTemplate.opsForHash().increment(redisKey, "errors", 1);
        }
        if (ctx.isTimeout()) {
            redisTemplate.opsForHash().increment(redisKey, "timeouts", 1);
        } else {
            redisTemplate.opsForHash().increment(redisKey, "latency_sum", 
                ctx.getLatencyMs());
            redisTemplate.opsForHash().increment(redisKey, "success_count", 1);
        }
        
        // Token 消耗
        if (ctx.getInputTokens() > 0) {
            redisTemplate.opsForHash().increment(redisKey, "input_tokens",
                ctx.getInputTokens());
            redisTemplate.opsForHash().increment(redisKey, "output_tokens",
                ctx.getOutputTokens());
        }
        
        // 质量分（如有）
        if (ctx.getQualityScore() != null) {
            redisTemplate.opsForHash().increment(redisKey, "quality_sum",
                ctx.getQualityScore());
            redisTemplate.opsForHash().increment(redisKey, "quality_count", 1);
        }
        
        // 用户反馈
        if (ctx.getUserRating() != null) {
            if (ctx.getUserRating() >= 4) {
                redisTemplate.opsForHash().increment(redisKey, 
                    "positive_feedback", 1);
            } else {
                redisTemplate.opsForHash().increment(redisKey, 
                    "negative_feedback", 1);
            }
        }
        
        // 设置 TTL（2小时后过期，分钟级聚合任务会在此之前持久化）
        redisTemplate.expire(redisKey, 2, TimeUnit.HOURS);
        
        // 异步发送到 Kafka 用于持久化分析
        MetricEvent event = MetricEvent.builder()
            .versionId(ctx.getVersionId())
            .templateId(ctx.getTemplateId())
            .experimentId(ctx.getExperimentId())
            .timestamp(System.currentTimeMillis())
            .latencyMs(ctx.getLatencyMs())
            .inputTokens(ctx.getInputTokens())
            .outputTokens(ctx.getOutputTokens())
            .qualityScore(ctx.getQualityScore())
            .safetyScore(ctx.getSafetyScore())
            .userRating(ctx.getUserRating())
            .isError(ctx.isError())
            .build();
        
        kafkaTemplate.send("prompt-metrics", 
            String.valueOf(ctx.getVersionId()),
            JsonUtil.toJson(event)
        );
    }
}
```

### 6.3 分钟级聚合任务

```java
/**
 * Prompt 指标分钟级聚合任务
 * 每分钟将 Redis 中的实时计数器聚合到 MySQL
 */
@Component
@Slf4j
public class PromptMetricAggregator {
    
    @Autowired
    private RedisTemplate<String, String> redisTemplate;
    
    @Autowired
    private PromptCallMetricMapper metricMapper;
    
    @Scheduled(cron = "0 * * * * *")  // 每分钟执行
    public void aggregate() {
        // 处理前一分钟的指标
        LocalDateTime lastMinute = LocalDateTime.now().minusMinutes(1);
        String minuteStr = lastMinute.format(
            DateTimeFormatter.ofPattern("yyyyMMddHHmm")
        );
        
        // 扫描所有活跃版本的指标 key
        Set<String> keys = redisTemplate.keys(
            "prompt:metrics:*:" + minuteStr
        );
        
        if (keys == null || keys.isEmpty()) {
            return;
        }
        
        for (String key : keys) {
            try {
                Map<Object, Object> entries = redisTemplate
                    .opsForHash().entries(key);
                
                if (entries.isEmpty()) continue;
                
                // 解析 key 获取 versionId
                String[] parts = key.split(":");
                Long versionId = Long.parseLong(parts[2]);
                
                // 聚合写入 MySQL
                PromptCallMetric metric = buildMetric(
                    versionId, lastMinute, entries
                );
                metricMapper.upsertOnDuplicate(metric);
                
            } catch (Exception e) {
                log.error("Failed to aggregate metric for key {}: {}", 
                    key, e.getMessage());
            }
        }
    }
    
    private PromptCallMetric buildMetric(
            Long versionId, LocalDateTime minute,
            Map<Object, Object> entries) {
        
        int calls = getInt(entries, "calls", 0);
        int errors = getInt(entries, "errors", 0);
        int timeouts = getInt(entries, "timeouts", 0);
        int successCount = getInt(entries, "success_count", 0);
        long latencySum = getLong(entries, "latency_sum", 0);
        
        double avgLatency = successCount > 0 
            ? (double) latencySum / successCount : 0;
        
        return PromptCallMetric.builder()
            .versionId(versionId)
            .statMinute(minute)
            .statDate(minute.toLocalDate())
            .callCount(calls)
            .successCount(calls - errors)
            .errorCount(errors)
            .timeoutCount(timeouts)
            .avgLatencyMs((int) avgLatency)
            .totalInputTokens(getLong(entries, "input_tokens", 0))
            .totalOutputTokens(getLong(entries, "output_tokens", 0))
            .positiveFeedbackCount(getInt(entries, "positive_feedback", 0))
            .negativeFeedbackCount(getInt(entries, "negative_feedback", 0))
            .build();
    }
}
```

---

## 7. Prompt 变更审批工作流

### 7.1 审批流程设计

```
开发人员提交变更
      │
      ▼
┌──────────────┐
│ 自动预检      │ ← 变更影响分析、依赖检查
└──────┬───────┘
       │ 预检通过
       ▼
┌──────────────┐
│ 自动回归测试  │ ← Golden Dataset 回归
└──────┬───────┘
       │ 回归通过
       ▼
┌──────────────┐     驳回
│ 人工评审      │──────────────┐
│ (教研+技术)  │              │
└──────┬───────┘              │
       │ 通过                  │
       ▼                      ▼
┌──────────────┐        返回修改
│ 灰度发布      │
└──────┬───────┘
       │ 全量通过
       ▼
┌──────────────┐
│ 线上发布      │
└──────────────┘
```

### 7.2 变更影响分析

```java
/**
 * Prompt 变更影响分析器
 * 在提交变更前自动分析潜在影响范围
 */
@Service
public class PromptChangeImpactAnalyzer {
    
    public ChangeImpactReport analyze(
            PromptVersion oldVersion, PromptVersion newVersion) {
        
        ChangeImpactReport report = new ChangeImpactReport();
        
        // 1. 差异分析
        PromptDiff diff = PromptDiffCalculator.calculate(oldVersion, newVersion);
        report.setDiff(diff);
        
        // 2. 影响范围评估
        // 2a. 模型参数变更影响
        if (diff.getModelParamChanges() != null) {
            report.setRiskLevel(assessModelParamRisk(diff.getModelParamChanges()));
        }
        
        // 2b. Prompt 内容变更影响
        int systemPromptChangeRate = calculateChangeRate(
            oldVersion.getSystemPrompt(), newVersion.getSystemPrompt()
        );
        report.setSystemPromptChangePct(systemPromptChangeRate);
        
        // 2c. 受影响用户范围估算
        PromptTemplate template = templateMapper.getById(
            oldVersion.getTemplateId()
        );
        long affectedUsers = estimateAffectedUsers(template);
        report.setEstimatedAffectedUsers(affectedUsers);
        
        // 3. 风险评级
        report.setOverallRisk(calculateOverallRisk(report));
        
        // 4. 建议
        report.setRecommendations(generateRecommendations(report));
        
        return report;
    }
    
    private RiskLevel calculateOverallRisk(ChangeImpactReport report) {
        // 高风险：模型参数大幅变更 + Prompt 重写 + 大量用户
        // 中风险：Prompt 部分修改或参数微调
        // 低风险：措辞修改、拼写修正
        
        if (report.getSystemPromptChangePct() > 50 
            && report.getEstimatedAffectedUsers() > 10000) {
            return RiskLevel.HIGH;
        } else if (report.getSystemPromptChangePct() > 20) {
            return RiskLevel.MEDIUM;
        } else {
            return RiskLevel.LOW;
        }
    }
    
    private List<String> generateRecommendations(ChangeImpactReport report) {
        List<String> recommendations = new ArrayList<>();
        
        if (report.getOverallRisk() == RiskLevel.HIGH) {
            recommendations.add("建议增加灰度步骤，从小流量（1%）开始");
            recommendations.add("建议增加回归测试用例覆盖");
            recommendations.add("建议安排教研人员参与评审");
        } else if (report.getOverallRisk() == RiskLevel.MEDIUM) {
            recommendations.add("建议从5%流量开始灰度");
            recommendations.add("建议确保回归测试全部通过");
        } else {
            recommendations.add("可适当加快灰度节奏（从10%开始）");
        }
        
        return recommendations;
    }
}
```

---

## 8. 错误处理

### 8.1 错误码定义

| 错误码 | HTTP | 说明 | 处理建议 |
| --- | --- | --- | --- |
| `PROMPT_001` | 404 | Prompt 模板不存在 | 检查 templateCode |
| `PROMPT_002` | 404 | Prompt 版本不存在 | 检查 versionId |
| `PROMPT_003` | 409 | 版本号已存在 | 使用新的版本号 |
| `PROMPT_004` | 409 | 同一模板已有进行中的灰度发布 | 等待当前灰度完成或终止 |
| `PROMPT_005` | 422 | 版本状态不允许此操作 | 检查 lifecycle_status |
| `PROMPT_006` | 409 | 回归测试正在进行中 | 等待当前测试完成 |
| `PROMPT_007` | 503 | Prompt 缓存不可用 | 降级到直接查库 |
| `PROMPT_008` | 422 | 回归测试通过率不足 | 根据失败用例修改 Prompt |
| `PROMPT_009` | 500 | 版本解析失败 | 检查版本配置和实验配置 |
| `PROMPT_010` | 422 | 灰度发布成功标准未满足 | 查看指标详情，调整策略 |
| `PROMPT_011` | 503 | LLM 调用超时 | 重试或降级到备用模型 |

### 8.2 降级策略

```java
/**
 * Prompt 版本解析降级策略
 */
@Component
public class PromptResolverFallback {
    
    /**
     * 当 Redis 缓存不可用时的降级方案
     */
    public PromptVersion fallbackResolve(String templateCode) {
        // 1. 尝试本地内存缓存（上一次成功的版本）
        PromptVersion localCached = LocalPromptCache.get(templateCode);
        if (localCached != null) {
            log.warn("Using local fallback cache for prompt: {}", templateCode);
            return localCached;
        }
        
        // 2. 直接查数据库（仅获取稳定版本，跳过实验和灰度）
        PromptTemplate template = templateMapper.getByCode(templateCode);
        if (template == null || template.getCurrentVersionId() == null) {
            throw new PromptNotFoundException(templateCode);
        }
        
        PromptVersion version = versionMapper.getById(
            template.getCurrentVersionId()
        );
        
        log.warn("Using database fallback for prompt: {}", templateCode);
        return version;
    }
    
    /**
     * 当 LLM 调用失败时的降级方案
     */
    public String fallbackResponse(String templateCode, String userQuestion) {
        return String.format(
            "抱歉，AI 辅导服务暂时繁忙，请稍后再试。\n" +
            "你可以尝试：\n" +
            "1. 重新提问\n" +
            "2. 换一种方式描述问题\n" +
            "3. 使用拍照搜题功能\n\n" +
            "(参考ID: %s)",
            UUID.randomUUID().toString().substring(0, 8)
        );
    }
}
```

---

## 9. 客户端 / 消费方集成指南

### 9.1 AI 对话引擎集成

```java
// AI 对话引擎中的集成示例
@Service
public class AiConversationEngine {
    
    @Autowired
    private PromptVersionResolver promptResolver;
    
    @Autowired
    private PromptMetricsCollector metricsCollector;
    
    public ConversationResponse converse(ConversationRequest request) {
        // 1. 确定 Prompt 模板编码
        String templateCode = determinePromptTemplate(
            request.getSubject(), request.getGrade(), 
            request.getSceneType()
        );
        
        // 2. 解析生效版本
        UserContext userCtx = UserContext.builder()
            .userId(request.getUserId())
            .grade(request.getGrade())
            .subject(request.getSubject())
            .region(request.getRegion())
            .build();
        
        ResolvedPrompt resolved = promptResolver.resolve(templateCode, userCtx);
        PromptVersion version = resolved.getVersion();
        
        // 3. 渲染变量
        Map<String, Object> variables = buildVariables(request);
        String systemPrompt = version.getSystemPrompt();
        String userPrompt = PromptRenderer.render(
            version.getUserPromptTpl(), variables
        );
        
        // 4. 调用 LLM
        long startTime = System.currentTimeMillis();
        PromptCallContext.CallContextBuilder ctxBuilder = PromptCallContext.builder()
            .templateId(version.getTemplateId())
            .versionId(version.getId())
            .experimentId(resolved.getExperimentId());
        
        try {
            LlmInvokeResponse llmResponse = llmInvoker.invoke(
                LlmInvokeRequest.builder()
                    .systemPrompt(systemPrompt)
                    .userPrompt(userPrompt)
                    .modelParams(version.getModelParams())
                    .stopSequences(version.getStopSequences())
                    .build()
            );
            
            long latency = System.currentTimeMillis() - startTime;
            
            // 5. 采集指标
            metricsCollector.recordCall(ctxBuilder
                .latencyMs(latency)
                .inputTokens(llmResponse.getInputTokens())
                .outputTokens(llmResponse.getOutputTokens())
                .isError(false)
                .build()
            );
            
            return ConversationResponse.builder()
                .content(llmResponse.getContent())
                .promptVersionId(version.getId())
                .promptVersionNumber(version.getVersionNumber())
                .experimentId(resolved.getExperimentId())
                .build();
            
        } catch (Exception e) {
            metricsCollector.recordCall(ctxBuilder
                .latencyMs(System.currentTimeMillis() - startTime)
                .isError(true)
                .build()
            );
            throw e;
        }
    }
}
```

---

## 10. 性能优化

### 10.1 Prompt 缓存策略

| 缓存层 | 命中场景 | TTL | 失效策略 |
| --- | --- | --- | --- |
| Redis（活跃版本） | 线上 Prompt 路由 | 10 分钟 | 版本发布时主动刷新 |
| Redis（灰度版本） | 灰度流量路由 | 5 分钟 | 灰度步骤推进时刷新 |
| 本地内存（兜底） | Redis 不可用时 | 无限 | 定期后台刷新（60秒） |
| CDN（Prompt 片段） | 共享片段渲染 | 1 小时 | 片段更新时刷新 |

### 10.2 回归测试优化

```yaml
策略:
  增量测试:
    描述: "只运行受变更影响的测试用例子集"
    触发: "Prompt 变更只影响特定学段时，只跑该学段用例"
    实现: "通过 tags 字段筛选相关用例"
    
  并行执行:
    最大并行度: 10
    超时: 单用例 30 秒
    总超时: 10 分钟
    
  结果缓存:
    描述: "未变更的 Prompt + 相同用例 → 复用上次结果"
    TTL: 24 小时
    失效条件: "Prompt 内容变更 / 模型参数变更 / 用例变更"
```

### 10.3 数据库优化

```sql
-- 指标表按月分区，便于归档和查询
ALTER TABLE prompt_call_metric 
PARTITION BY RANGE (TO_DAYS(stat_date)) (
    PARTITION p_202607 VALUES LESS THAN (TO_DAYS('2026-08-01')),
    PARTITION p_202608 VALUES LESS THAN (TO_DAYS('2026-09-01')),
    -- ... 每月追加分区
    PARTITION p_max VALUES LESS THAN MAXVALUE
);

-- 版本表常用查询索引
CREATE INDEX idx_template_lifecycle ON prompt_version(template_id, lifecycle_status);
CREATE INDEX idx_published ON prompt_version(lifecycle_status, published_at DESC);
```

---

## 11. 安全考虑

### 11.1 权限控制

| 操作 | 所需角色 | 说明 |
| --- | --- | --- |
| 查看 Prompt 版本 | AI工程师、教研人员 | 只读权限 |
| 创建/修改版本 | AI工程师 | 需评审后才能发布 |
| 审批版本 | 教研主管、技术主管 | 双重审批机制 |
| 触发灰度发布 | 技术主管 | 高风险变更需 CTO 审批 |
| 紧急回滚 | 运维工程师、AI工程师 | 事后补审批 |
| 管理测试用例 | AI工程师、教研人员 | 变更需记录 |
| 查看实验数据 | 数据分析师、产品经理 | 只读 |

### 11.2 审计日志

```java
// 所有关键操作记录审计日志
@Aspect
@Component
public class PromptAuditAspect {
    
    @Autowired
    private AuditLogService auditLogService;
    
    @Pointcut("@annotation(PromptAuditAction)")
    public void promptAction() {}
    
    @AfterReturning(pointcut = "promptAction()", returning = "result")
    public void logAction(JoinPoint jp, Object result) {
        MethodSignature sig = (MethodSignature) jp.getSignature();
        PromptAuditAction annotation = sig.getMethod()
            .getAnnotation(PromptAuditAction.class);
        
        auditLogService.record(AuditLog.builder()
            .action(annotation.value())
            .operator(SecurityContext.getCurrentUserId())
            .targetType("PROMPT_VERSION")
            .targetId(extractTargetId(jp.getArgs()))
            .detail(extractDetail(jp.getArgs(), result))
            .timestamp(LocalDateTime.now())
            .ip(SecurityContext.getCurrentIp())
            .build());
    }
}
```

---

## 12. 测试策略

### 12.1 单元测试

```java
@DisplayName("Prompt 版本解析器")
class PromptVersionResolverTest {
    
    @Test
    @DisplayName("无实验无灰度时返回稳定版本")
    void shouldReturnStableVersion() {
        // given
        when(experimentService.findActiveExperiment(any(), any()))
            .thenReturn(null);
        when(canaryService.getActiveRelease(any()))
            .thenReturn(null);
        when(templateMapper.getByCode("math_solve_junior"))
            .thenReturn(template(12L, 10042L));
        
        // when
        ResolvedPrompt result = resolver.resolve("math_solve_junior", userCtx());
        
        // then
        assertThat(result.getVersion().getId()).isEqualTo(10042L);
        assertThat(result.getExperimentId()).isNull();
    }
    
    @Test
    @DisplayName("实验组用户返回实验版本")
    void shouldReturnExperimentVersion() {
        // given
        PromptExperiment exp = experiment(3001L, 10042L, 10056L);
        when(experimentService.findActiveExperiment(any(), any()))
            .thenReturn(exp);
        when(experimentService.assignUser(eq(3001L), any()))
            .thenReturn(ExperimentAssignment.treatment());
        
        // when
        ResolvedPrompt result = resolver.resolve("math_solve_junior", userCtx());
        
        // then
        assertThat(result.getVersion().getId()).isEqualTo(10056L);
        assertThat(result.getExperimentId()).isEqualTo(3001L);
        assertThat(result.getExperimentGroup()).isEqualTo("treatment");
    }
    
    @Test
    @DisplayName("灰度用户基于哈希分桶进入实验组")
    void shouldAssignCanaryByHash() {
        // given
        when(experimentService.findActiveExperiment(any(), any()))
            .thenReturn(null);
        CanaryRelease canary = canaryRelease(2008L, 10056L, 5);  // 5%流量
        when(canaryService.getActiveRelease(any()))
            .thenReturn(canary);
        
        // 模拟用户ID落在 0-4 范围（命中灰度）
        UserContext userInCanary = UserContext.builder()
            .userId("user_0003")  // hash = 3 < 5
            .build();
        
        // when
        ResolvedPrompt result = resolver.resolve("math_solve_junior", userInCanary);
        
        // then
        assertThat(result.getVersion().getId()).isEqualTo(10056L);
    }
}
```

### 12.2 集成测试场景

| 场景 | 步骤 | 预期结果 |
| --- | --- | --- |
| 端到端灰度发布 | 创建版本→评审→回归→灰度→全量 | 新版本替换旧版本 |
| 灰度自动回滚 | 灰度发布中模拟准确率骤降 | 自动回滚到基线版本 |
| 回归测试全流程 | 提交回归→执行→查看报告 | 报告包含通过率和失败详情 |
| 实验分流一致性 | 同一用户多次调用 | 每次返回相同实验组 |
| 缓存失效与刷新 | 切换线上版本 | 缓存自动刷新为新版本 |
| 并发回归测试 | 同时触发同一版本的回归测试 | 第二次请求被锁拒绝 |

---

## 13. 部署与配置

### 13.1 核心配置

```yaml
# application.yml
prompt:
  version-management:
    cache:
      active-ttl: 10m
      staging-ttl: 5m
      local-refresh-interval: 60s
    
    regression:
      max-parallelism: 10
      per-case-timeout: 30s
      total-timeout: 10m
      min-pass-rate: 90.0
    
    canary:
      check-interval: 5m
      min-sample-size: 30
      rollback:
        error-rate-multiplier: 3
        min-safety-score: 90.0
        max-accuracy-drop: 15.0
        min-user-rating: 3.0
    
    quality:
      assessment-model: gpt-4o-mini
      assessment-timeout: 15s
    
    metrics:
      aggregation-interval: 60s
      redis-ttl: 2h
      retention-days: 90
```

### 13.2 Kafka Topic 配置

```yaml
kafka:
  topics:
    prompt-metrics:
      partitions: 12
      replicas: 3
      retention: 90d
    prompt-lifecycle-events:
      partitions: 3
      replicas: 3
      retention: 365d
```

---

## 14. 与现有系统关系

### 14.1 系统边界划分

| 系统模块 | 职责 | 与本模块的关系 |
| --- | --- | --- |
| AI-Prompt 编排与场景模板系统 | Prompt 的场景路由、变量注入、模板渲染 | 本模块管理模板的**版本与发布**，编排系统调用本模块获取**生效版本** |
| AI 模型版本生命周期管理 | 大模型本身的版本管理 | 本模块管理 **Prompt** 版本（比模型版本变更更频繁） |
| AI 模型调用 Token 计量 | Token 用量和成本统计 | 本模块提供 versionId 维度的调用指标，Token 计量提供模型维度的成本 |
| AI 输出质量校验 | 单次输出的事后质量检查 | 本模块的回归测试使用类似的质量评估方法，但批量执行 |
| 灰度发布与特性开关系统 | 通用功能灰度 | 本模块实现 **Prompt 专用**的灰度，支持基于学段/年级/学科的精细化分流 |
| 配置中心 | 通用配置管理 | 本模块将 Prompt 元数据存储在配置中心，版本数据存储在数据库 |

### 14.2 集成接口约定

```
本模块对外提供：
  1. /api/v1/internal/prompt/resolve/{templateCode}  → 版本解析（内部）
  2. /api/v1/internal/prompt/metrics/report          → 指标上报（内部）
  3. /api/v1/admin/prompt-templates/**               → 管理后台 API

本模块消费：
  1. 配置中心：监听模板配置变更
  2. Kafka (prompt-metrics)：消费指标事件持久化
  3. LLM 服务：执行回归测试调用
```

---

## 15. 演进路线

### Phase 1: MVP（当前）
- Prompt 版本 CRUD 和基础审批
- 手动触发回归测试
- 基础灰度发布（手动推进）
- Redis 实时指标采集

### Phase 2: 自动化增强
- 自动灰度发布与自动回滚
- Prompt 变更影响分析
- A/B 实验框架
- 分钟级指标聚合与告警

### Phase 3: 智能化
- 基于历史数据的 Prompt 效果预测
- 自动生成测试用例建议
- Prompt 质量异常智能归因
- Prompt 变更推荐（基于学习数据分析）

---

## 附录 A: 数据结构汇总

```typescript
// TypeScript 接口定义（供前端/客户端参考）

interface PromptTemplate {
  id: number;
  templateCode: string;
  templateName: string;
  sceneCode: string;
  subjectCode?: string;
  gradeRange?: string;
  currentVersionId?: number;
  stagingVersionId?: number;
  status: number;
  createdAt: string;
  updatedAt: string;
}

interface PromptVersion {
  id: number;
  templateId: number;
  versionNumber: string;
  versionLabel?: string;
  systemPrompt: string;
  userPromptTpl: string;
  variablesSchema: Record<string, any>;
  modelParams: {
    temperature: number;
    topP: number;
    maxTokens: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
  };
  stopSequences?: string[];
  lifecycleStatus: 'DRAFT' | 'REVIEWING' | 'TESTING' | 'STAGING' | 'PUBLISHED' | 'ROLLED_BACK' | 'ARCHIVED';
  changeSummary: string;
  changeDetail?: string;
  parentVersionId?: number;
  publishedAt?: string;
  rolledBackAt?: string;
}

interface RegressionTestReport {
  batchNo: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  avgAccuracy: number;
  avgSafety: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  testResult: 'PASS' | 'PARTIAL' | 'FAIL';
  failedCaseDetails: FailedCaseDetail[];
}

interface CanaryReleaseStatus {
  releaseId: number;
  status: 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'ROLLED_BACK';
  currentStep: number;
  totalSteps: number;
  currentTrafficPct: number;
  stepMetrics: {
    current: CanaryMetrics;
    baseline: CanaryMetrics;
  };
  meetsCriteria: boolean;
  nextAction?: string;
}
```

---

*文档版本: v1.0 | 创建日期: 2026-07-15 | 维护团队: AI 工程组*
