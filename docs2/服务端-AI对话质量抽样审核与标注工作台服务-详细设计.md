# 服务端 - AI 对话质量抽样审核与标注工作台服务 详细设计

> 版本:v1.0 | 更新日期:2026-05-31 | 状态:待评审

---

## 1. 模块概述

### 1.1 背景与目标

AI 辅导质量是 PrimeTop 产品核心竞争力。自动校验引擎(幻觉检测、事实校验)能拦截部分问题,但无法替代人工对**讲解适龄性、启发性、教学法合规性**等维度的评估。本服务构建从**抽样 → 分配 → 审核 → 标注 → 统计 → 反馈**的完整人工审核闭环。

### 1.2 核心目标

| 目标 | 说明 |
|------|------|
| 自动抽样 | 按策略从海量 AI 对话中自动抽取待审样本 |
| 任务分发 | 将审核任务智能分配给审核员,支持负载均衡与技能匹配 |
| 结构化标注 | 提供多维度标签体系,确保标注结果可量化、可追溯 |
| 质量闭环 | 标注结果回流至 Prompt 优化、模型评测、RAG 检索策略改进 |
| 成本可控 | 通过分层抽样、优先级队列控制人工审核成本 |

### 1.3 与其他模块的关系

```
AI对话引擎 ──→ 对话存储 ──→ 本服务(抽样审核) ──→ 标注结果
                     ↑                              │
               用户反馈标记 ←──────────────────────────┘
                     │                              │
                     ↓                              ↓
              AI输出质量校验        Prompt编排系统 / 模型评测基准
```

| 关联模块 | 交互方式 |
|----------|----------|
| AI对话引擎 | 读取对话记录作为审核样本来源 |
| AI输出质量校验与多模型复核引擎 | 接收自动校验触发的高优先级审核任务 |
| AI-Prompt编排与场景模板系统 | 标注结果驱动 Prompt 模板优化 |
| AI模型评测基准与质量回归测试系统 | 标注结果作为评测数据集来源 |
| AI幻觉检测与教育事实校验引擎 | 高风险对话自动进入审核队列 |
| 用户反馈与AI质量评估 | 用户负反馈对话优先进入审核队列 |
| 统一业务异常码体系 | 复用标准异常码 |
| 审计日志与操作追溯系统 | 记录所有审核操作 |

---

## 2. 数据结构设计

### 2.1 核心实体关系

```
SamplingStrategy ──1:N──→ ReviewTask ──1:N──→ ReviewAnnotation
                          │                    │
                          ├── 审核员分配         ├── 维度评分
                          └── 状态流转           └── 标签标注

ReviewerProfile ──1:N──→ ReviewTaskAssignment
```

### 2.2 抽样策略表 `ai_review_sampling_strategy`

```sql
CREATE TABLE ai_review_sampling_strategy (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    strategy_name       VARCHAR(100) NOT NULL COMMENT '策略名称',
    strategy_code       VARCHAR(50) NOT NULL UNIQUE COMMENT '策略编码',

    -- 抽样条件
    target_scenes       JSON COMMENT '适用场景,如["math_tutoring","essay_correction"]',
    target_models       JSON COMMENT '适用模型列表',
    subject_filter      JSON COMMENT '学科过滤,null表示全部',
    grade_filter        JSON COMMENT '学段过滤,null表示全部',

    -- 抽样规则
    sample_type         ENUM('RANDOM','STRATIFIED','PRIORITY','FULL') NOT NULL DEFAULT 'RANDOM',
    sample_rate         DECIMAL(5,4) COMMENT '随机抽样率 0.0000~1.0000',
    stratify_dimensions JSON COMMENT '分层维度,如["scene","subject","model"]',
    min_sample_per_day  INT NOT NULL DEFAULT 10 COMMENT '每日最少样本数',
    max_sample_per_day  INT NOT NULL DEFAULT 500 COMMENT '每日最多样本数',

    -- 优先级加权
    priority_weights    JSON COMMENT '优先级加权配置',
    -- 示例: {"negative_feedback": 10, "auto_reject": 8, "new_prompt": 5, "normal": 1}

    -- 生命周期
    is_enabled          TINYINT(1) NOT NULL DEFAULT 1,
    effective_start     DATETIME COMMENT '生效开始时间',
    effective_end       DATETIME COMMENT '生效结束时间',

    created_by          VARCHAR(50) NOT NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_enabled (is_enabled, effective_start, effective_end),
    INDEX idx_code (strategy_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI对话审核抽样策略';
```

### 2.3 审核任务表 `ai_review_task`

```sql
CREATE TABLE ai_review_task (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_no             VARCHAR(32) NOT NULL UNIQUE COMMENT '任务编号 RVT20260531xxxx',

    -- 来源信息
    source_type         ENUM('AUTO_SAMPLE','USER_FEEDBACK','AUTO_REJECT',
                             'MANUAL_ADD','REGRESSION_TEST','NEW_PROMPT') NOT NULL,
    source_id           VARCHAR(64) COMMENT '来源关联ID',
    strategy_id         BIGINT COMMENT '关联抽样策略ID',

    -- 对话信息
    conversation_id     VARCHAR(64) NOT NULL COMMENT 'AI对话ID',
    message_id          VARCHAR(64) NOT NULL COMMENT '具体消息ID',
    user_id             BIGINT NOT NULL COMMENT '用户ID',
    session_id          VARCHAR(64) COMMENT '学习会话ID',

    -- 快照(审核时对话可能已变更,需快照)
    conversation_snapshot JSON NOT NULL COMMENT '对话上下文快照',
    user_question       TEXT NOT NULL COMMENT '用户原始问题',
    ai_response         TEXT NOT NULL COMMENT 'AI回复内容',
    ai_model            VARCHAR(50) NOT NULL COMMENT '使用的AI模型',
    prompt_template_id  VARCHAR(64) COMMENT 'Prompt模板ID',

    -- 上下文元数据
    scene_code          VARCHAR(50) COMMENT '场景编码',
    subject_code        VARCHAR(20) COMMENT '学科编码',
    grade_code          VARCHAR(20) COMMENT '年级编码',
    textbook_id         BIGINT COMMENT '教材ID',
    chapter_id          BIGINT COMMENT '章节ID',
    knowledge_point_ids JSON COMMENT '关联知识点ID列表',

    -- 用户反馈(如有)
    user_feedback_type  VARCHAR(20) COMMENT '用户反馈类型: negative/positive/neutral',
    user_feedback_text  TEXT COMMENT '用户反馈文字',
    user_rating         TINYINT COMMENT '用户评分 1-5',

    -- 自动校验结果
    auto_check_result   JSON COMMENT '自动校验结果',
    -- 示例: {"hallucination_score":0.3, "fact_check_passed":true, "safety_passed":true}

    -- 任务状态
    priority            TINYINT NOT NULL DEFAULT 5 COMMENT '优先级 1(最高)~10(最低)',
    status              ENUM('PENDING','ASSIGNED','REVIEWING','COMPLETED',
                             'DISPUTED','EXPIRED','CANCELLED') NOT NULL DEFAULT 'PENDING',
    assigned_reviewer   VARCHAR(50) COMMENT '分配的审核员',
    review_round        TINYINT NOT NULL DEFAULT 1 COMMENT '审核轮次',

    -- 时间
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    assigned_at         DATETIME COMMENT '分配时间',
    review_started_at   DATETIME COMMENT '开始审核时间',
    completed_at        DATETIME COMMENT '完成时间',
    expire_at           DATETIME COMMENT '过期时间',

    -- 统计
    annotation_count    TINYINT NOT NULL DEFAULT 0 COMMENT '标注次数',
    final_verdict       ENUM('PASS','MINOR_ISSUE','MAJOR_ISSUE','CRITICAL','INCONCLUSIVE')
                        COMMENT '最终判定',

    INDEX idx_status_priority (status, priority, created_at),
    INDEX idx_conversation (conversation_id, message_id),
    INDEX idx_source (source_type, source_id),
    INDEX idx_reviewer (assigned_reviewer, status),
    INDEX idx_scene (scene_code, created_at),
    INDEX idx_created (created_at),
    INDEX idx_expire (expire_at, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI对话审核任务';
```

### 2.4 审核员档案表 `ai_reviewer_profile`

```sql
CREATE TABLE ai_reviewer_profile (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id             VARCHAR(50) NOT NULL UNIQUE COMMENT '系统用户ID',
    reviewer_name       VARCHAR(50) NOT NULL COMMENT '审核员姓名',

    -- 能力标签
    expertise_subjects  JSON COMMENT '擅长学科 ["math","physics","chinese"]',
    expertise_grades    JSON COMMENT '擅长学段 ["primary","junior","senior"]',
    expertise_scenes    JSON COMMENT '擅长场景 ["math_tutoring","essay_correction"]',

    -- 资质
    reviewer_level      ENUM('JUNIOR','SENIOR','EXPERT','LEAD') NOT NULL DEFAULT 'JUNIOR',
    qualification       JSON COMMENT '资质信息 {certification,experience_years,specialties}',

    -- 工作配置
    max_daily_tasks     INT NOT NULL DEFAULT 50 COMMENT '每日最大任务数',
    max_concurrent      INT NOT NULL DEFAULT 5 COMMENT '最大并发任务数',
    available_hours     JSON COMMENT '可用时段 ["09:00-12:00","14:00-18:00"]',

    -- 统计
    total_reviewed      INT NOT NULL DEFAULT 0 COMMENT '累计审核数',
    avg_review_time_sec INT COMMENT '平均审核耗时(秒)',
    quality_score       DECIMAL(3,2) COMMENT '审核质量分(与专家标注的一致率)',

    -- 状态
    is_active           TINYINT(1) NOT NULL DEFAULT 1,
    last_active_at      DATETIME,

    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_active (is_active, last_active_at),
    INDEX idx_level (reviewer_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='审核员档案';
```

### 2.5 审核标注表 `ai_review_annotation`

```sql
CREATE TABLE ai_review_annotation (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_id             BIGINT NOT NULL COMMENT '审核任务ID',
    annotation_round    TINYINT NOT NULL COMMENT '标注轮次',

    -- 标注人
    reviewer_id         VARCHAR(50) NOT NULL COMMENT '审核员ID',
    review_started_at   DATETIME NOT NULL COMMENT '开始时间',
    review_duration_sec INT COMMENT '审核耗时(秒)',

    -- 整体判定
    overall_verdict     ENUM('PASS','MINOR_ISSUE','MAJOR_ISSUE','CRITICAL','INCONCLUSIVE')
                        NOT NULL,
    overall_comment     TEXT COMMENT '整体评语',

    -- 多维度评分 (1-5分)
    score_accuracy      TINYINT COMMENT '准确性: 内容是否正确',
    score_age_appropriate TINYINT COMMENT '适龄性: 表达是否符合用户年级',
    score_pedagogy      TINYINT COMMENT '教学法: 是否启发式而非直接给答案',
    score_completeness  TINYINT COMMENT '完整性: 解答是否完整覆盖问题',
    score_clarity       TINYINT COMMENT '清晰度: 表述是否清晰易懂',
    score_safety        TINYINT COMMENT '安全性: 内容是否合规安全',

    -- 标签标注(多选)
    issue_tags          JSON COMMENT '问题标签列表',
    -- 可选值见 2.6 标签体系

    -- 具体问题标记
    issue_highlights    JSON COMMENT '问题高亮标记',
    -- 示例: [{"text":"公式错误","position":120,"severity":"error","quote":"F=ma应为F=mg"}]

    -- 改进建议
    suggested_fix       TEXT COMMENT '建议的改进内容',
    suggested_prompt    TEXT COMMENT '建议的Prompt调整',

    -- 状态
    status              ENUM('DRAFT','SUBMITTED','APPEALED','CONFIRMED','OVERRIDDEN')
                        NOT NULL DEFAULT 'DRAFT',

    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submitted_at        DATETIME COMMENT '提交时间',

    INDEX idx_task (task_id, annotation_round),
    INDEX idx_reviewer (reviewer_id, created_at),
    INDEX idx_verdict (overall_verdict),
    INDEX idx_tags ((CAST(issue_tags AS CHAR(500))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI对话审核标注';
```

### 2.6 标签体系定义

```json
{
  "accuracy_issues": {
    "FACTUAL_ERROR": "事实错误",
    "CALCULATION_ERROR": "计算错误",
    "FORMULA_ERROR": "公式错误",
    "CONCEPT_CONFUSION": "概念混淆",
    "HALLUCINATION": "幻觉编造",
    "OUTDATED_INFO": "信息过时"
  },
  "pedagogy_issues": {
    "DIRECT_ANSWER": "直接给答案缺乏引导",
    "SKIP_STEPS": "跳步过多",
    "TOO_COMPLEX": "讲解超出年级水平",
    "TOO_SIMPLE": "讲解过于简单",
    "NO_PRACTICE": "缺少练习推荐",
    "NEGATIVE_TONE": "语气负面打击信心"
  },
  "presentation_issues": {
    "FORMAT_MESSY": "排版混乱",
    "LATEX_ERROR": "公式渲染错误",
    "MISSING_DIAGRAM": "缺少必要的图示",
    "LANGUAGE_UNCLEAR": "表述不清晰",
    "TOO_LONG": "回答过长",
    "TOO_SHORT": "回答过于简略"
  },
  "safety_issues": {
    "INAPPROPRIATE_CONTENT": "不适宜内容",
    "PRIVACY_LEAK": "隐私信息泄露",
    "OFF_TOPIC": "严重偏离学习主题",
    "MISLEADING": "误导性内容",
    "CULTURAL_INSENSITIVE": "文化敏感性问题"
  },
  "positive_tags": {
    "EXCELLENT_EXPLANATION": "讲解出色",
    "GOOD_SCAFFOLDING": "很好的启发式引导",
    "AGE_APPROPRIATE": "适龄性良好",
    "CREATIVE_ANALOGY": "巧妙的类比",
    "THOROUGH_COVERAGE": "覆盖全面"
  }
}
```

### 2.7 审核结果聚合表 `ai_review_result_aggregate`

```sql
CREATE TABLE ai_review_result_aggregate (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_id             BIGINT NOT NULL UNIQUE COMMENT '审核任务ID',

    -- 聚合结果
    final_verdict       ENUM('PASS','MINOR_ISSUE','MAJOR_ISSUE','CRITICAL','INCONCLUSIVE')
                        NOT NULL,
    consensus_level     ENUM('UNANIMOUS','MAJORITY','SPLIT','CONFLICT') NOT NULL,

    -- 统计
    total_annotations   TINYINT NOT NULL,
    verdict_distribution JSON NOT NULL COMMENT '{"PASS":2,"MINOR_ISSUE":1}',
    avg_scores         JSON COMMENT '{"accuracy":4.2,"pedagogy":3.8}',
    aggregated_tags     JSON COMMENT '聚合标签及出现次数',

    -- 归因
    root_cause_category VARCHAR(50) COMMENT '根因分类',
    root_cause_detail   TEXT COMMENT '根因描述',

    -- 关联行动
    action_type         ENUM('NONE','PROMPT_FIX','MODEL_SWITCH','RAG_UPDATE',
                             'ESCALATE','TRAINING_DATA') COMMENT '建议行动',
    action_reference_id VARCHAR(64) COMMENT '关联行动工单ID',

    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_verdict (final_verdict),
    INDEX idx_action (action_type),
    INDEX idx_cause (root_cause_category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='审核结果聚合';
```

---

## 3. API 接口设计

### 3.1 抽样管理 API

#### 3.1.1 触发手动抽样

```
POST /api/v1/admin/review/sampling/trigger
```

**请求体:**
```json
{
  "strategyCode": "daily_random_sample",
  "overrideParams": {
    "sampleRate": 0.02,
    "maxSampleCount": 100
  },
  "timeRange": {
    "start": "2026-05-30T00:00:00+08:00",
    "end": "2026-05-31T00:00:00+08:00"
  },
  "filters": {
    "sceneCodes": ["math_tutoring", "physics_tutoring"],
    "modelFilter": ["gpt-4", "claude-3"],
    "includeUserNegative": true
  }
}
```

**响应:**
```json
{
  "code": 0,
  "data": {
    "batchId": "SMP20260531001",
    "strategyCode": "daily_random_sample",
    "sampledCount": 87,
    "skippedCount": 12,
    "skipReasons": {
      "already_reviewed": 8,
      "conversation_too_short": 4
    },
    "taskIds": [10001, 10002, "..."]
  }
}
```

#### 3.1.2 查询抽样策略列表

```
GET /api/v1/admin/review/sampling/strategies?page=1&size=20&enabled=true
```

#### 3.1.3 创建/更新抽样策略

```
POST /api/v1/admin/review/sampling/strategies
PUT /api/v1/admin/review/sampling/strategies/{strategyId}
```

**请求体:**
```json
{
  "strategyName": "数学辅导场景日常抽样",
  "strategyCode": "math_daily_sample",
  "targetScenes": ["math_tutoring"],
  "sampleType": "STRATIFIED",
  "sampleRate": 0.01,
  "stratifyDimensions": ["grade_code", "ai_model"],
  "minSamplePerDay": 20,
  "maxSamplePerDay": 200,
  "priorityWeights": {
    "negative_feedback": 10,
    "auto_reject": 8,
    "new_prompt": 5,
    "normal": 1
  }
}
```

### 3.2 审核任务 API

#### 3.2.1 获取待审核任务列表

```
GET /api/v1/admin/review/tasks?status=PENDING&priority=1,2,3&page=1&size=20
```

**响应:**
```json
{
  "code": 0,
  "data": {
    "total": 156,
    "items": [
      {
        "taskId": 10001,
        "taskNo": "RVT202605310001",
        "sourceType": "AUTO_SAMPLE",
        "priority": 2,
        "status": "PENDING",
        "sceneCode": "math_tutoring",
        "subjectCode": "math",
        "gradeCode": "junior_2",
        "aiModel": "gpt-4",
        "userQuestion": "二次函数y=ax2+bx+c的顶点坐标怎么求?",
        "aiResponsePreview": "二次函数的顶点坐标可以通过配方法...",
        "autoCheckResult": {
          "hallucinationScore": 0.15,
          "factCheckPassed": true
        },
        "userFeedbackType": null,
        "createdAt": "2026-05-31T02:15:30+08:00",
        "expireAt": "2026-06-02T02:15:30+08:00"
      }
    ]
  }
}
```

#### 3.2.2 领取审核任务

```
POST /api/v1/admin/review/tasks/{taskId}/claim
```

**请求体:**
```json
{
  "reviewerId": "reviewer_003"
}
```

**响应:**
```json
{
  "code": 0,
  "data": {
    "taskId": 10001,
    "status": "REVIEWING",
    "assignedReviewer": "reviewer_003",
    "conversationSnapshot": {
      "messages": [
        {"role": "user", "content": "二次函数y=ax2+bx+c的顶点坐标怎么求?"},
        {"role": "assistant", "content": "二次函数的顶点坐标可以通过配方法来求..."}
      ],
      "context": {
        "userId": 12345,
        "gradeCode": "junior_2",
        "subjectCode": "math",
        "textbookVersion": "pep",
        "chapterTitle": "二次函数"
      }
    },
    "autoCheckResult": {
      "hallucinationScore": 0.15,
      "factCheckPassed": true,
      "safetyCheckPassed": true
    },
    "reviewDeadline": "2026-06-01T14:15:30+08:00"
  }
}
```

#### 3.2.3 批量领取任务

```
POST /api/v1/admin/review/tasks/batch-claim
```

**请求体:**
```json
{
  "reviewerId": "reviewer_003",
  "count": 5,
  "preferredScenes": ["math_tutoring", "physics_tutoring"],
  "preferredGrades": ["junior_1", "junior_2", "junior_3"]
}
```

### 3.3 标注提交 API

#### 3.3.1 提交审核标注

```
POST /api/v1/admin/review/tasks/{taskId}/annotations
```

**请求体:**
```json
{
  "overallVerdict": "MINOR_ISSUE",
  "overallComment": "讲解基本正确,但在配方法步骤中跳过了一步中间变形,对初二学生可能不够清晰",
  "scores": {
    "accuracy": 4,
    "ageAppropriate": 4,
    "pedagogy": 3,
    "completeness": 4,
    "clarity": 3,
    "safety": 5
  },
  "issueTags": ["SKIP_STEPS", "LANGUAGE_UNCLEAR"],
  "issueHighlights": [
    {
      "position": 85,
      "length": 45,
      "severity": "warning",
      "quote": "将y=a(x-h)2+k配方得到",
      "comment": "缺少中间步骤:从ax2+bx出发配方的过程"
    }
  ],
  "suggestedFix": "建议在配方法步骤中增加从 ax2+bx+c 出发提取 a 后完全平方的详细过程",
  "suggestedPrompt": "在数学解题场景中,对初中生讲解配方法时应展示完整的配方过程,每一步变形都要给出说明"
}
```

**响应:**
```json
{
  "code": 0,
  "data": {
    "annotationId": 5001,
    "taskId": 10001,
    "status": "SUBMITTED",
    "submittedAt": "2026-05-31T09:30:00+08:00",
    "taskUpdatedStatus": "COMPLETED"
  }
}
```

#### 3.3.2 保存草稿标注

```
POST /api/v1/admin/review/tasks/{taskId}/annotations/draft
```

与提交标注结构相同,status 设为 `DRAFT`。

#### 3.3.3 获取已有标注

```
GET /api/v1/admin/review/tasks/{taskId}/annotations
```

### 3.4 统计分析 API

#### 3.4.1 审核概览统计

```
GET /api/v1/admin/review/stats/overview?startDate=2026-05-24&endDate=2026-05-31
```

**响应:**
```json
{
  "code": 0,
  "data": {
    "period": {
      "start": "2026-05-24",
      "end": "2026-05-31"
    },
    "totals": {
      "totalTasks": 1250,
      "completed": 1180,
      "pending": 45,
      "inProgress": 25,
      "expired": 0
    },
    "verdictDistribution": {
      "PASS": 756,
      "MINOR_ISSUE": 295,
      "MAJOR_ISSUE": 98,
      "CRITICAL": 15,
      "INCONCLUSIVE": 16
    },
    "avgScores": {
      "accuracy": 4.21,
      "ageAppropriate": 4.05,
      "pedagogy": 3.72,
      "completeness": 4.10,
      "clarity": 3.95,
      "safety": 4.89
    },
    "topIssueTags": [
      {"tag": "DIRECT_ANSWER", "count": 145, "trend": "down"},
      {"tag": "SKIP_STEPS", "count": 98, "trend": "up"},
      {"tag": "TOO_COMPLEX", "count": 67, "trend": "stable"}
    ],
    "reviewerStats": {
      "activeReviewers": 8,
      "avgReviewTimeSec": 185,
      "avgAnnotationsPerReviewer": 147
    }
  }
}
```

#### 3.4.2 按维度分析

```
GET /api/v1/admin/review/stats/by-dimension?dimension=scene_code&startDate=2026-05-24&endDate=2026-05-31
```

支持的维度:`scene_code`、`subject_code`、`grade_code`、`ai_model`、`prompt_template_id`、`reviewer_id`

#### 3.4.3 审核员绩效统计

```
GET /api/v1/admin/review/stats/reviewer/{reviewerId}?period=30d
```

#### 3.4.4 质量趋势分析

```
GET /api/v1/admin/review/stats/trends?metric=pass_rate&granularity=daily&startDate=2026-05-01&endDate=2026-05-31
```

### 3.5 审核员管理 API

#### 3.5.1 审核员列表

```
GET /api/v1/admin/review/reviewers?page=1&size=20&level=SENIOR&isActive=true
```

#### 3.5.2 审核员工作负载

```
GET /api/v1/admin/review/reviewers/{reviewerId}/workload
```

**响应:**
```json
{
  "code": 0,
  "data": {
    "reviewerId": "reviewer_003",
    "today": {
      "assigned": 12,
      "completed": 8,
      "inProgress": 4,
      "remainingCapacity": 38
    },
    "thisWeek": {
      "assigned": 55,
      "completed": 50,
      "avgDurationSec": 172
    },
    "expertise": {
      "subjects": ["math", "physics"],
      "grades": ["junior", "senior"],
      "preferredScenes": ["math_tutoring", "physics_tutoring", "exam_prep"]
    }
  }
}
```

---

## 4. 核心流程设计

### 4.1 抽样流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                        定时抽样调度 (每日 02:00)                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ 加载所有启用的策略      │
                    └──────────┬──────────┘
                               │
               ┌───────────────┼───────────────┐
               ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐    ┌──────────┐
        │ 策略 A    │   │ 策略 B    │    │ 策略 C    │
        │ 数学抽样   │   │ 作文抽样   │    │ 通用抽样   │
        └────┬─────┘   └────┬─────┘    └────┬─────┘
             │              │               │
             ▼              ▼               ▼
    ┌────────────────────────────────────────────────┐
    │            查询候选对话集合                       │
    │  SELECT FROM ai_conversation_message            │
    │  WHERE created_at BETWEEN ? AND ?               │
    │    AND scene_code IN (...)                       │
    │    AND subject_code IN (...)                     │
    │    AND id NOT IN (已审核对话)                      │
    └───────────────────────┬────────────────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │   计算优先级分数           │
              │   score = Σ(weight × factor)│
              │   - 用户负反馈 ×10         │
              │   - 自动校验拒绝 ×8        │
              │   - 新Prompt模板 ×5        │
              │   - 新上线模型 ×5           │
              │   - 普通对话 ×1             │
              └────────────┬────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │   执行抽样算法             │
              │   RANDOM: 随机取N条        │
              │   STRATIFIED: 分层抽样     │
              │   PRIORITY: 取topN         │
              └────────────┬────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │   去重 & 配额检查          │
              │   - 与已有任务去重          │
              │   - 检查每日配额上限        │
              └────────────┬────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │   创建审核任务             │
              │   - 快照对话上下文          │
              │   - 关联策略和来源          │
              │   - 计算过期时间            │
              │   - 写入 ai_review_task    │
              └────────────┬────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │   触发任务分配             │
              │   (见 4.2 分配流程)        │
              └─────────────────────────┘
```

### 4.2 任务分配流程

```
任务进入 PENDING 状态
         │
         ▼
┌────────────────────────────┐
│ 查询符合条件的一审审核员       │
│ 条件:                       │
│ - isActive = true           │
│ - 当日任务数 < maxDailyTasks  │
│ - 并发数 < maxConcurrent     │
│ - 在可用时段内                │
└────────────┬───────────────┘
             │
             ▼
┌────────────────────────────┐
│ 技能匹配评分                 │
│ matchScore = Σ:             │
│ - 学科匹配 +3                │
│ - 学段匹配 +2                │
│ - 场景匹配 +2                │
│ - 审核质量分加权 +1           │
│ - 负载均衡调整               │
└────────────┬───────────────┘
             │
             ▼
    ┌────────┴────────┐
    │ 找到匹配审核员?   │
    └────┬───────┬────┘
      是 │       │ 否
         ▼       ▼
  ┌──────────┐  ┌──────────────┐
  │ 自动分配   │  │ 保持 PENDING  │
  │ 状态→      │  │ 等待手动分配   │
  │ ASSIGNED  │  └──────────────┘
  └──────────┘
         │
         ▼
┌────────────────────────────┐
│ 发送通知给审核员             │
│ - 站内消息                  │
│ - 可选: 钉钉/飞书推送        │
└────────────────────────────┘
```

**分配策略说明：**

| 分配模式 | 说明 |
|----------|------|
| AUTO | 系统自动分配给最优匹配审核员（默认） |
| ROUND_ROBIN | 轮询分配给所有可用审核员 |
| MANUAL | 管理员手动指定审核员 |
| CLAIM | 审核员自行从任务池领取 |

### 4.3 审核标注流程

```
审核员领取任务 → 状态: REVIEWING
         │
         ▼
┌────────────────────────────┐
│ 审核工作台展示               │
│ 1. 完整对话上下文             │
│ 2. 用户画像(年级/学科)        │
│ 3. 自动校验结果              │
│ 4. 用户反馈(如有)            │
│ 5. Prompt模板信息             │
│ 6. 历史审核记录(如有)         │
└────────────┬───────────────┘
             │
             ▼
┌────────────────────────────┐
│ 审核员逐项评判               │
│ ① 整体判定(5级)              │
│ ② 六维度评分(1-5)            │
③ 问题标签(多选)             │
│ ④ 高亮标记问题片段           │
│ ⑤ 改进建议                  │
│ ⑥ Prompt优化建议            │
└────────────┬───────────────┘
             │
         ┌───┴───┐
         ▼       ▼
    保存草稿   提交标注
    (DRAFT)   (SUBMITTED)
         │       │
         │       ▼
         │  ┌────────────────────────────┐
         │  │ 检查是否需要二审             │
         │  │ 条件:                       │
         │  │ - 判定为 CRITICAL → 必须二审  │
         │  │ - 判定为 MAJOR_ISSUE → 建议二审│
         │  │ - 判定为 INCONCLUSIVE → 二审  │
         │  │ - 审核员等级 Junior → 高优先级二审│
         │  └────────┬───────────────────┘
         │           │
         │     ┌─────┴──────┐
         │   不需要          需要
         │     │              │
         │     ▼              ▼
         │  ┌────────┐  ┌───────────────┐
         │  │ 直接完成│  │ 创建二审任务   │
         │  │ → 聚合  │  │ 分配高级审核员 │
         │  └────────┘  │ review_round=2│
         │               └───────────────┘
         │                       │
         │                       ▼
         │              ┌────────────────┐
         │              │ 二审完成 → 聚合  │
         │              └───────┬────────┘
         │                      │
         ▼                      ▼
         ┌──────────────────────────────┐
         │    结果聚合与行动触发           │
         │  - 计算共识度                  │
         │  - 确定最终判定                 │
         │  - 生成行动建议                 │
         │  - 写入 ai_review_result_aggregate │
         └──────────────────────────────┘
```

### 4.4 任务状态流转

```
                     ┌─────────┐
                     │ PENDING │ ← 初始状态/待分配
                     └────┬────┘
                          │
                   ┌──────┴──────┐
                   │ 自动/手动分配 │
                   └──────┬──────┘
                          │
                     ┌────▼────┐
              ┌──────┤ ASSIGNED │ ← 已分配待领取
              │      └────┬────┘
              │           │ 审核员领取
              │      ┌────▼────┐
              │      │REVIEWING│ ← 审核中
              │      └────┬────┘
              │           │
              │     ┌─────┴──────┐
              │     │            │
              │     ▼            ▼
              │ ┌─────────┐ ┌──────────┐
              │ │COMPLETED│ │ DISPUTED │ ← 审核争议
              │ └────┬────┘ └────┬─────┘
              │      │           │ 争议解决
              │      │      ┌────▼─────┐
              │      │      │COMPLETED │
              │      │      └──────────┘
              │      │
              │      ▼
              │  (触发聚合)
              │
              ▼
         ┌─────────┐
         │ EXPIRED │ ← 超时未处理
         └─────────┘
              │
              ▼
         (可重新激活或取消)

特殊转换:
- 任何状态 → CANCELLED (管理员操作)
- EXPIRED → PENDING (管理员重新激活)
- REVIEWING → ASSIGNED (审核员退回任务，限3次)
```

---

## 5. 关键代码设计

### 5.1 抽样引擎核心实现

```java
@Service
@Slf4j
public class ReviewSamplingEngine {

    @Autowired
    private SamplingStrategyRepository strategyRepo;
    @Autowired
    private ReviewTaskRepository taskRepo;
    @Autowired
    private ConversationRepository conversationRepo;
    @Autowired
    private ApplicationEventPublisher eventPublisher;

    /**
     * 执行定时抽样
     * 由定时任务每日 02:00 触发
     */
    @Transactional
    public SamplingResult executeDailySampling() {
        List<SamplingStrategy> strategies = strategyRepo.findAllEnabled();
        if (strategies.isEmpty()) {
            log.warn("无启用的抽样策略");
            return SamplingResult.empty();
        }

        LocalDateTime yesterday = LocalDate.now().minusDays(1).atStartOfDay();
        LocalDateTime today = LocalDate.now().atStartOfDay();

        int totalSampled = 0;
        int totalSkipped = 0;
        List<Long> allTaskIds = new ArrayList<>();

        for (SamplingStrategy strategy : strategies) {
            try {
                StrategySamplingResult result = executeStrategy(strategy, yesterday, today);
                totalSampled += result.getSampledCount();
                totalSkipped += result.getSkippedCount();
                allTaskIds.addAll(result.getTaskIds());
            } catch (Exception e) {
                log.error("抽样策略 {} 执行失败", strategy.getStrategyCode(), e);
            }
        }

        // 发布任务创建事件，触发分配
        if (!allTaskIds.isEmpty()) {
            eventPublisher.publishEvent(new ReviewTasksCreatedEvent(allTaskIds));
        }

        return SamplingResult.builder()
                .sampledCount(totalSampled)
                .skippedCount(totalSkipped)
                .build();
    }

    /**
     * 执行单个抽样策略
     */
    private StrategySamplingResult executeStrategy(
            SamplingStrategy strategy,
            LocalDateTime startTime,
            LocalDateTime endTime) {

        // 1. 查询候选对话
        List<CandidateConversation> candidates = conversationRepo
                .findCandidates(startTime, endTime,
                        strategy.getTargetScenes(),
                        strategy.getTargetModels(),
                        strategy.getSubjectFilter(),
                        strategy.getGradeFilter());

        if (candidates.isEmpty()) {
            return StrategySamplingResult.empty();
        }

        // 2. 排除已审核对话
        Set<String> reviewedIds = taskRepo.findReviewedConversationIds(
                candidates.stream().map(CandidateConversation::getConversationId)
                        .collect(Collectors.toSet()));

        candidates = candidates.stream()
                .filter(c -> !reviewedIds.contains(c.getConversationId() + "#" + c.getMessageId()))
                .collect(Collectors.toList());

        // 3. 计算优先级分数
        List<ScoredCandidate> scored = candidates.stream()
                .map(c -> new ScoredCandidate(c, calculatePriorityScore(c, strategy)))
                .sorted(Comparator.comparingDouble(ScoredCandidate::getScore).reversed())
                .collect(Collectors.toList());

        // 4. 执行抽样
        int sampleCount = calculateSampleCount(scored.size(), strategy);
        List<ScoredCandidate> sampled = performSampling(scored, strategy, sampleCount);

        // 5. 配额检查
        int todayExisting = taskRepo.countTodayTasksByStrategy(strategy.getId());
        int remaining = strategy.getMaxSamplePerDay() - todayExisting;
        if (remaining <= 0) {
            return StrategySamplingResult.empty();
        }
        sampled = sampled.subList(0, Math.min(sampled.size(), remaining));

        // 6. 创建审核任务
        List<Long> taskIds = new ArrayList<>();
        int skipped = 0;
        for (ScoredCandidate sc : sampled) {
            try {
                ReviewTask task = buildReviewTask(sc, strategy);
                taskRepo.save(task);
                taskIds.add(task.getId());
            } catch (DuplicateKeyException e) {
                skipped++;
                log.debug("对话 {} 已存在审核任务，跳过", sc.getCandidate().getConversationId());
            }
        }

        return new StrategySamplingResult(taskIds, taskIds.size(), skipped);
    }

    /**
     * 计算优先级分数
     */
    private double calculatePriorityScore(CandidateConversation c, SamplingStrategy strategy) {
        Map<String, Double> weights = strategy.getPriorityWeights();
        double score = weights.getOrDefault("normal", 1.0);

        if (c.getUserFeedbackType() != null && c.getUserFeedbackType().equals("negative")) {
            score += weights.getOrDefault("negative_feedback", 10.0);
        }
        if (c.getAutoCheckPassed() != null && !c.getAutoCheckPassed()) {
            score += weights.getOrDefault("auto_reject", 8.0);
        }
        if (c.getPromptTemplateCreatedAt() != null
                && c.getPromptTemplateCreatedAt().isAfter(LocalDateTime.now().minusDays(7))) {
            score += weights.getOrDefault("new_prompt", 5.0);
        }
        if (c.getModelFirstUsedAt() != null
                && c.getModelFirstUsedAt().isAfter(LocalDateTime.now().minusDays(7))) {
            score += weights.getOrDefault("new_model", 5.0);
        }

        return score;
    }

    /**
     * 执行抽样算法
     */
    private List<ScoredCandidate> performSampling(
            List<ScoredCandidate> scored,
            SamplingStrategy strategy,
            int sampleCount) {

        switch (strategy.getSampleType()) {
            case RANDOM:
                Collections.shuffle(scored);
                return scored.subList(0, Math.min(sampleCount, scored.size()));

            case PRIORITY:
                return scored.subList(0, Math.min(sampleCount, scored.size()));

            case STRATIFIED:
                return stratifiedSample(scored, strategy.getStratifyDimensions(), sampleCount);

            case FULL:
                return scored;

            default:
                throw new IllegalArgumentException("不支持的抽样类型: " + strategy.getSampleType());
        }
    }

    /**
     * 分层抽样
     */
    private List<ScoredCandidate> stratifiedSample(
            List<ScoredCandidate> scored,
            List<String> dimensions,
            int totalSampleCount) {

        // 按维度组合分组
        Map<String, List<ScoredCandidate>> groups = scored.stream()
                .collect(Collectors.groupingBy(sc -> buildGroupKey(sc, dimensions)));

        // 按比例分配每组样本数
        int totalPopulation = scored.size();
        List<ScoredCandidate> result = new ArrayList<>();

        for (Map.Entry<String, List<ScoredCandidate>> entry : groups.entrySet()) {
            int groupSize = entry.getValue().size();
            int groupQuota = (int) Math.max(1,
                    Math.round((double) groupSize / totalPopulation * totalSampleCount));

            // 每组内按优先级排序取 topN
            entry.getValue().stream()
                    .sorted(Comparator.comparingDouble(ScoredCandidate::getScore).reversed())
                    .limit(groupQuota)
                    .forEach(result::add);
        }

        return result;
    }

    private String buildGroupKey(ScoredCandidate sc, List<String> dimensions) {
        return dimensions.stream()
                .map(d -> getDimensionValue(sc.getCandidate(), d))
                .collect(Collectors.joining("|"));
    }
}
```

### 5.2 任务分配器

```java
@Service
@Slf4j
public class ReviewTaskAssigner {

    @Autowired
    private ReviewerProfileRepository reviewerRepo;
    @Autowired
    private ReviewTaskRepository taskRepo;

    /**
     * 为单个任务寻找最佳审核员
     */
    @Transactional
    public Optional<String> findBestReviewer(ReviewTask task) {
        List<ReviewerProfile> candidates = reviewerRepo.findAvailableReviewers();

        if (candidates.isEmpty()) {
            log.warn("无可用审核员");
            return Optional.empty();
        }

        // 评分排序
        List<ScoredReviewer> scored = candidates.stream()
                .map(r -> new ScoredReviewer(r, calculateMatchScore(r, task)))
                .sorted(Comparator.comparingDouble(ScoredReviewer::getScore).reversed())
                .collect(Collectors.toList());

        // 取最高分且当日未超限的审核员
        for (ScoredReviewer sr : scored) {
            ReviewerProfile r = sr.getReviewer();
            int todayActive = taskRepo.countTodayActiveByReviewer(r.getUserId());
            int currentConcurrent = taskRepo.countInProgressDialogByReviewer(r.getUserId());

            if (todayActive < r.getMaxDailyTasks()
                    && currentConcurrent < r.getMaxConcurrent()
                    && isInAvailableHours(r)) {
                return Optional.of(r.getUserId());
            }
        }

        return Optional.empty();
    }

    /**
     * 计算审核员匹配分
     */
    private double calculateMatchScore(ReviewerProfile reviewer, ReviewTask task) {
        double score = 0;

        // 学科匹配
        if (reviewer.getExpertiseSubjects() != null
                && reviewer.getExpertiseSubjects().contains(task.getSubjectCode())) {
            score += 3;
        }

        // 学段匹配
        String gradeGroup = extractGradeGroup(task.getGradeCode());
        if (reviewer.getExpertiseGrades() != null
                && reviewer.getExpertiseGrades().contains(gradeGroup)) {
            score += 2;
        }

        // 场景匹配
        if (reviewer.getExpertiseScenes() != null
                && reviewer.getExpertiseScenes().contains(task.getSceneCode())) {
            score += 2;
        }

        // 审核质量加权
        if (reviewer.getQualityScore() != null) {
            score += reviewer.getQualityScore();
        }

        // 负载均衡：当日任务越少越优先
        int todayCount = taskRepo.countTodayActiveByReviewer(reviewer.getUserId());
        score -= todayCount * 0.1;

        // 审核员等级加权
        score += reviewer.getReviewerLevel().getWeight();

        return score;
    }

    /**
     * 批量分配任务
     */
    @Transactional
    public BatchAssignResult batchAssign(List<Long> taskIds) {
        int assigned = 0;
        int unassigned = 0;

        // 按优先级排序
        List<ReviewTask> tasks = taskRepo.findByIdsOrderByPriority(taskIds);

        for (ReviewTask task : tasks) {
            if (task.getStatus() != TaskStatus.PENDING) {
                continue;
            }

            Optional<String> reviewerOpt = findBestReviewer(task);
            if (reviewerOpt.isPresent()) {
                task.assignTo(reviewerOpt.get());
                taskRepo.save(task);
                assigned++;
            } else {
                unassigned++;
            }
        }

        return new BatchAssignResult(assigned, unassigned);
    }
}
```

### 5.3 结果聚合服务

```java
@Service
@Slf4j
public class ReviewResultAggregator {

    @Autowired
    private ReviewAnnotationRepository annotationRepo;
    @Autowired
    private ReviewResultAggregateRepository aggregateRepo;
    @Autowired
    private ApplicationEventPublisher eventPublisher;

    /**
     * 聚合单个任务的审核结果
     */
    @Transactional
    public ReviewResultAggregate aggregateTaskResult(Long taskId) {
        List<ReviewAnnotation> annotations = annotationRepo.findByTaskId(taskId);

        if (annotations.isEmpty()) {
            log.warn("任务 {} 无标注结果", taskId);
            return null;
        }

        // 1. 计算最终判定
        String finalVerdict = computeConsensusVerdict(annotations);

        // 2. 计算共识度
        String consensusLevel = computeConsensusLevel(annotations, finalVerdict);

        // 3. 判定分布
        Map<String, Integer> verdictDist = annotations.stream()
                .collect(Collectors.groupingBy(
                        ReviewAnnotation::getOverallVerdict,
                        Collectors.summingInt(a -> 1)));

        // 4. 计算平均分
        Map<String, Double> avgScores = computeAverageScores(annotations);

        // 5. 聚合标签
        Map<String, Integer> aggregatedTags = annotations.stream()
                .flatMap(a -> a.getIssueTags() != null
                        ? a.getIssueTags().stream() : Stream.empty())
                .collect(Collectors.groupingBy(
                        Function.identity(),
                        Collectors.summingInt(t -> 1)));

        // 6. 根因分析
        RootCauseAnalysis rootCause = analyzeRootCause(finalVerdict, aggregatedTags, avgScores);

        // 7. 建议行动
        String suggestedAction = determineSuggestedAction(finalVerdict, rootCause);

        // 8. 持久化
        ReviewResultAggregate aggregate = ReviewResultAggregate.builder()
                .taskId(taskId)
                .finalVerdict(finalVerdict)
                .consensusLevel(consensusLevel)
                .totalAnnotations((byte) annotations.size())
                .verdictDistribution(toJson(verdictDist))
                .avgScores(toJson(avgScores))
                .aggregatedTags(toJson(aggregatedTags))
                .rootCauseCategory(rootCause.getCategory())
                .rootCauseDetail(rootCause.getDetail())
                .actionType(suggestedAction)
                .build();

        aggregateRepo.save(aggregate);

        // 9. 发布事件通知
        if ("CRITICAL".equals(finalVerdict) || "MAJOR_ISSUE".equals(finalVerdict)) {
            eventPublisher.publishEvent(
                    new CriticalReviewResultEvent(taskId, aggregate));
        }

        return aggregate;
    }

    /**
     * 共识判定算法
     */
    private String computeConsensusVerdict(List<ReviewAnnotation> annotations) {
        // 优先级: CRITICAL > MAJOR_ISSUE > MINOR_ISSUE > INCONCLUSIVE > PASS
        // 取加权投票结果
        Map<String, Double> weightedVotes = new HashMap<>();

        for (ReviewAnnotation annotation : annotations) {
            double weight = annotation.getReviewerLevel().getVerdictWeight();
            weightedVotes.merge(annotation.getOverallVerdict(), weight, Double::sum);
        }

        return weightedVotes.entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .map(Map.Entry::getKey)
                .orElse("INCONCLUSIVE");
    }

    /**
     * 共识度计算
     */
    private String computeConsensusLevel(
            List<ReviewAnnotation> annotations,
            String finalVerdict) {
        long agreeingCount = annotations.stream()
                .filter(a -> a.getOverallVerdict().equals(finalVerdict))
                .count();
        double ratio = (double) agreeingCount / annotations.size();

        if (ratio >= 1.0) return "UNANIMOUS";
        if (ratio >= 0.7) return "MAJORITY";
        if (ratio >= 0.5) return "SPLIT";
        return "CONFLICT";
    }

    /**
     * 根因分析
     */
    private RootCauseAnalysis analyzeRootCause(
            String verdict,
            Map<String, Integer> tags,
            Map<String, Double> scores) {

        if ("PASS".equals(verdict)) {
            return new RootCauseAnalysis("NO_ISSUE", "审核通过");
        }

        // 根据最高频标签推断根因
        String topTag = tags.entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .map(Map.Entry::getKey)
                .orElse("UNKNOWN");

        // 根据最低评分维度推断
        String lowestDimension = scores.entrySet().stream()
                .min(Map.Entry.comparingByValue())
                .map(Map.Entry::getKey)
                .orElse("");

        String category = categorizeRootCause(topTag, lowestDimension);
        String detail = String.format("高频问题标签: %s, 最低评分维度: %s", topTag, lowestDimension);

        return new RootCauseAnalysis(category, detail);
    }

    private String categorizeRootCause(String topTag, String lowestDim) {
        // 准确性问题
        if (Set.of("FACTUAL_ERROR", "CALCULATION_ERROR", "FORMULA_ERROR",
                   "HALLUCINATION", "CONCEPT_CONFUSION").contains(topTag)
                || "accuracy".equals(lowestDim)) {
            return "ACCURACY_ISSUE";
        }
        // 教学法问题
        if (Set.of("DIRECT_ANSWER", "SKIP_STEPS", "NEGATIVE_TONE").contains(topTag)
                || "pedagogy".equals(lowestDim)) {
            return "PEDAGOGY_ISSUE";
        }
        // 适龄性问题
        if (Set.of("TOO_COMPLEX", "TOO_SIMPLE").contains(topTag)
                || "age_appropriate".equals(lowestDim)) {
            return "AGE_APPROPRIATENESS_ISSUE";
        }
        // 安全问题
        if (Set.of("INAPPROPRIATE_CONTENT", "PRIVACY_LEAK", "MISLEADING").contains(topTag)
                || "safety".equals(lowestDim)) {
            return "SAFETY_ISSUE";
        }
        // 表述问题
        return "PRESENTATION_ISSUE";
    }

    /**
     * 建议行动类型
     */
    private String determineSuggestedAction(
            String verdict,
            RootCauseAnalysis rootCause) {

        if ("PASS".equals(verdict) || "INCONCLUSIVE".equals(verdict)) {
            return "NONE";
        }
        if ("CRITICAL".equals(verdict)) {
            return "ESCALATE"; // 升级为紧急工单
        }

        switch (rootCause.getCategory()) {
            case "ACCURACY_ISSUE":
                return "RAG_UPDATE"; // 更新RAG知识库
            case "PEDAGOGY_ISSUE":
                return "PROMPT_FIX"; // 修复Prompt模板
            case "AGE_APPROPRIATENESS_ISSUE":
                return "PROMPT_FIX"; // 调整适龄化策略
            case "SAFETY_ISSUE":
                return "ESCALATE"; // 安全问题升级
            default:
                return "TRAINING_DATA"; // 作为训练数据回流
        }
    }
}
```

### 5.4 审核员质量评估

```java
@Service
public class ReviewerQualityEvaluator {

    /**
     * 计算审核员与专家标注的一致率
     * 用于定期评估审核员质量
     */
    public ReviewerQualityReport evaluate(String reviewerId, LocalDate since) {
        // 查询该审核员在此期间的所有标注
        List<ReviewAnnotation> annotations = annotationRepo
                .findByReviewerIdAndSubmittedAtAfter(reviewerId, since.atStartOfDay());

        if (annotations.isEmpty()) {
            return ReviewerQualityReport.empty(reviewerId);
        }

        // 对比专家标注（LEAD/EXPERT级别的标注视为基准）
        int consistent = 0;
        int comparable = 0;

        for (ReviewAnnotation annotation : annotations) {
            List<ReviewAnnotation> expertAnnotations = annotationRepo
                    .findExpertAnnotationsByTaskId(annotation.getTaskId());

            if (expertAnnotations.isEmpty()) continue;
            comparable++;

            // 判定一致
            boolean verdictMatch = expertAnnotations.stream()
                    .anyMatch(ea -> ea.getOverallVerdict()
                            .equals(annotation.getOverallVerdict()));

            if (verdictMatch) {
                consistent++;
            }
        }

        double consistencyRate = comparable > 0
                ? (double) consistent / comparable : 0;

        // 计算平均审核时间
        double avgDuration = annotations.stream()
                .filter(a -> a.getReviewDurationSec() != null)
                .mapToInt(ReviewAnnotation::getReviewDurationSec)
                .average()
                .orElse(0);

        return ReviewerQualityReport.builder()
                .reviewerId(reviewerId)
                .period(since)
                .totalAnnotations(annotations.size())
                .comparableCount(comparable)
                .consistencyRate(consistencyRate)
                .avgReviewDurationSec(avgDuration)
                .build();
    }
}
```

---

## 6. 定时任务设计

| 任务名 | Cron 表达式 | 说明 |
|--------|-------------|------|
| `dailySamplingJob` | `0 0 2 * * ?` | 每日 02:00 执行常规抽样 |
| `taskAutoAssignJob` | `0 */10 * * * ?` | 每 10 分钟自动分配 PENDING 任务 |
| `taskExpireCheckJob` | `0 0 */1 * * ?` | 每小时检查任务是否过期 |
| `reviewerScoreUpdateJob` | `0 0 3 * * ?` | 每日 03:00 更新审核员质量分 |
| `weeklyReportJob` | `0 0 4 ? * MON` | 每周一 04:00 生成周报 |
| `aggregateCheckJob` | `0 */5 * * * ?` | 每 5 分钟检查已完成但未聚合的任务 |

### 6.1 过期处理策略

```java
@Component
@Slf4j
public class TaskExpireCheckJob {

    @Autowired
    private ReviewTaskRepository taskRepo;

    @Scheduled(cron = "0 0 */1 * * ?")
    @Transactional
    public void checkAndExpire() {
        List<ReviewTask> expired = taskRepo
                .findByStatusInAndExpireAtBefore(
                        List.of(TaskStatus.PENDING, TaskStatus.ASSIGNED, TaskStatus.REVIEWING),
                        LocalDateTime.now());

        for (ReviewTask task : expired) {
            task.expire();
            log.info("审核任务 {} 已过期", task.getTaskNo());

            // 如果审核中过期，释放审核员配额
            if (task.getStatus() == TaskStatus.REVIEWING) {
                log.warn("审核员 {} 未按时完成任务 {}",
                        task.getAssignedReviewer(), task.getTaskNo());
            }
        }

        taskRepo.saveAll(expired);
    }
}
```

---

## 7. 错误处理与异常设计

### 7.1 业务异常码

| 异常码 | 说明 | 处理方式 |
|--------|------|----------|
| `REVIEW_001` | 抽样策略配置错误 | 检查策略参数 |
| `REVIEW_002` | 无可用审核员 | 告警，等待手动分配 |
| `REVIEW_003` | 任务已被他人领取 | 刷新任务列表 |
| `REVIEW_004` | 审核员当日任务已满 | 提示明日再领取 |
| `REVIEW_005` | 标注数据校验失败 | 返回具体字段错误 |
| `REVIEW_006` | 任务状态不允许此操作 | 检查任务当前状态 |
| `REVIEW_007` | 审核员无权限审核此学科 | 重新分配 |
| `REVIEW_008` | 对话快照不存在 | 重新创建任务 |
| `REVIEW_009` | 聚合计算失败 | 重试，告警 |
| `REVIEW_010` | 审核员退回次数超限 | 锁定任务，通知管理员 |

### 7.2 核心异常处理策略

```java
@RestControllerAdvice(basePackages = "com.primetop.review")
public class ReviewExceptionHandler {

    @ExceptionHandler(ReviewException.class)
    public ResponseEntity<ApiResponse<Void>> handleReviewException(ReviewException e) {
        log.warn("审核业务异常: code={}, message={}", e.getCode(), e.getMessage());
        return ResponseEntity.status(e.getHttpStatus())
                .body(ApiResponse.error(e.getCode(), e.getMessage()));
    }

    @ExceptionHandler(OptimisticLockException.class)
    public ResponseEntity<ApiResponse<Void>> handleConcurrentConflict(OptimisticLockException e) {
        log.warn("审核任务并发冲突");
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ApiResponse.error("REVIEW_003", "任务状态已变更，请刷新后重试"));
    }
}
```

### 7.3 并发控制

**任务领取**使用乐观锁 + CAS，防止多人同时领取同一任务：

```sql
UPDATE ai_review_task
SET status = 'REVIEWING',
    assigned_reviewer = ?,
    review_started_at = NOW()
WHERE id = ?
  AND status = 'ASSIGNED'
  AND assigned_reviewer = ?
```

**批量分配**使用分布式锁（按任务ID范围分段），防止分配器多实例重复分配：

```java
@ DistributedLock(key = "'review:assign:' + #batchId")
public BatchAssignResult batchAssign(String batchId, List<Long> taskIds) {
    // ...
}
```

---

## 8. 配置项设计

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `review.task.default-expire-hours` | `48` | 任务默认过期时间(小时) |
| `review.task.max-return-count` | `3` | 审核员最大退回次数 |
| `review.task.auto-assign-enabled` | `true` | 是否自动分配 |
| `review.task.auto-assign-interval-ms` | `600000` | 自动分配间隔(毫秒) |
| `review.task.second-review-required-levels` | `CRITICAL,MAJOR_ISSUE` | 需要二审的判定级别 |
| `review.sampling.default-sample-rate` | `0.005` | 默认抽样率(0.5%) |
| `review.sampling.min-conversation-length` | `3` | 最少对话轮次(低于此不抽样) |
| `review.reviewer.max-daily-tasks` | `50` | 审核员每日默认最大任务数 |
| `review.reviewer.max-concurrent-tasks` | `5` | 审核员最大并发任务数 |
| `review.aggregate.auto-trigger-enabled` | `true` | 自动触发聚合 |
| `review.notification.enabled` | `true` | 审核通知开关 |
| `review.notification.channels` | `in_app,dingtalk` | 通知渠道 |

---

## 9. 部署与扩展建议

### 9.1 服务定位

本服务属于**运营管理域**，部署在管理后台服务内，不直接面向 C 端用户。

### 9.2 性能预估

| 指标 | 预估值 |
|------|--------|
| 日均 AI 对话量 | 10万~50万条 |
| 日均抽样量 | 200~2000条 |
| 在线审核员 | 5~20人 |
| 审核任务表年增量 | ~50万行 |

### 9.3 扩展方向

1. **AI 辅助审核**：利用模型预标注，审核员只需修正确认，提升效率
2. **主动学习**：将高质量标注数据作为微调数据集，持续优化模型
3. **审核工作流编排**：支持更复杂的多轮审核、交叉审核、专家仲裁流程
4. **质量评分卡**：为 Prompt 模板、模型、场景生成实时质量评分卡
5. **自动回归**：Prompt 变更后自动抽取同类对话进行回归审核