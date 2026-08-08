# 服务端-教育平台AI训练数据标注管理平台与标注质量保障引擎-详细设计

## 1. 概述

### 1.1 功能定位

PrimeTop 作为全学段 AI 辅助学习平台，依赖大量高质量结构化标注数据驱动 AI 模型优化、内容质量评估和知识图谱构建。本模块是平台级的**训练数据标注任务管理与质量保障基础设施**，为内容教研、AI 工程和运营团队提供统一的标注任务创建、分发、执行、审核和数据导出能力。

### 1.2 设计目标

| 目标 | 说明 |
| --- | --- |
| 统一标注入口 | 将知识点标注、难度标定、答案校验、解析质量评审、适龄性评估等标注需求归集到统一平台 |
| 任务智能调度 | 根据标注员专业领域、工作负载、历史质量自动分配标注任务 |
| 质量闭环保障 | 通过多标、黄金题校验、一致性检测等手段保障标注数据可信度 |
| 模型训练对接 | 标注完成的数据自动进入训练数据仓库，供模型微调使用 |
| 全流程可追溯 | 从任务创建到数据消费全链路审计 |

### 1.3 适用范围

- 内容教研团队：教材知识点标注、考点关联、难度标定
- AI 工程团队：模型训练数据标注、回答质量评估、偏好排序标注
- 品质审核团队：题目答案正确性验证、解析准确性审核
- 外包标注团队：批量数据标注任务执行
- 学科专家：高难度知识内容审核与仲裁

### 1.4 与现有模块关系

| 现有模块 | 关系 |
| --- | --- |
| `AI模型微调训练数据管理与领域适配管线` | 本平台产出标注数据 → 该模块负责训练数据集构建与模型微调 |
| `AI对话质量抽样审核与标注工作台` | 本平台是其底层通用标注引擎，该模块是 AI 对话场景的上层应用 |
| `教育内容审核工作流与多级审核管线` | 内容审核流程可调用本平台标注能力做辅助分类 |
| `题目知识点自动标注与课标对齐引擎` | AI 自动标注结果 → 本平台做人工复核与修正 |
| `教育内容事实性校验与知识准确性验证引擎` | 事实校验结果 → 本平台做人工确认或驳回 |

---

## 2. 整体架构

```
┌──────────────────────────────────────────────────────────┐
│                    标注管理后台 (Web)                       │
│   任务创建 │ 标注员管理 │ 质量看板 │ 数据导出 │ 审核仲裁     │
└────────────────────────┬─────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────┐
│                  API Gateway / BFF                        │
└────────────────────────┬─────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────┐
│              标注管理服务 (Annotation Service)              │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ 任务调度  │ │ 标注执行  │ │ 质量管控  │ │ 数据导出  │   │
│  │ Scheduler │ │ Executor │ │ QA Engine│ │ Exporter │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                │
│  │ 标注员   │ │ 黄金题   │ │ 一致性   │                │
│  │ 管理     │ │ 管理     │ │ 计算     │                │
│  └──────────┘ └──────────┘ └──────────┘                │
└────────┬───────────────┬───────────────┬────────────────┘
         │               │               │
    ┌────▼────┐    ┌────▼────┐    ┌────▼────┐
    │ MySQL   │    │ Redis   │    │ 对象    │
    │ 业务数据 │    │ 缓存/   │    │ 存储    │
    │         │    │ 队列    │    │ (附件)  │
    └─────────┘    └─────────┘    └─────────┘
         │
    ┌────▼──────────────────────┐
    │  训练数据仓库              │
    │  (ClickHouse / HDFS)      │
    └───────────────────────────┘
```

---

## 3. 核心数据模型

### 3.1 数据库表设计

#### 3.1.1 标注项目表 `annotation_projects`

```sql
CREATE TABLE annotation_projects (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_code    VARCHAR(64) NOT NULL UNIQUE COMMENT '项目编码',
    project_name    VARCHAR(200) NOT NULL COMMENT '项目名称',
    project_type    VARCHAR(50) NOT NULL COMMENT '项目类型: KNOWLEDGE_TAG/DIFFICULTY/ANSWER_VERIFY/QUALITY_SCORE/PREFERENCE_RANK/AGE_RATING/ERROR_CLASSIFY',
    description     TEXT COMMENT '项目描述',
    subject         VARCHAR(20) COMMENT '学科: MATH/PHYSICS/CHEMISTRY/...',
    grade_range     VARCHAR(50) COMMENT '适用学段: PRIMARY/JUNIOR/SENIOR',
    status          VARCHAR(20) NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/ACTIVE/PAUSED/COMPLETED/ARCHIVED',
    total_items     INT NOT NULL DEFAULT 0 COMMENT '总标注条目数',
    annotated_items INT NOT NULL DEFAULT 0 COMMENT '已完成标注数',
    reviewed_items  INT NOT NULL DEFAULT 0 COMMENT '已审核数',
    quality_target  DECIMAL(5,2) DEFAULT 0.85 COMMENT '目标一致率',
    created_by      BIGINT NOT NULL COMMENT '创建人ID',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deadline        DATETIME COMMENT '截止时间',
    INDEX idx_status_type (status, project_type),
    INDEX idx_subject (subject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='标注项目表';
```

#### 3.1.2 标注任务表 `annotation_tasks`

```sql
CREATE TABLE annotation_tasks (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id      BIGINT NOT NULL COMMENT '所属项目ID',
    task_code       VARCHAR(64) NOT NULL UNIQUE COMMENT '任务编码',
    item_type       VARCHAR(30) NOT NULL COMMENT '条目类型: QUESTION/CONTENT/AI_RESPONSE/KNOWLEDGE_POINT/EXERCISE',
    item_id         BIGINT NOT NULL COMMENT '条目业务ID',
    item_snapshot   JSON COMMENT '条目内容快照(避免跨服务查询)',
    annotation_type VARCHAR(50) NOT NULL COMMENT '标注类型: SINGLE_LABEL/MULTI_LABEL/SCORE/TEXT/RANK/BBOX/SEGMENT',
    schema_config   JSON NOT NULL COMMENT '标注Schema定义(标签集、取值范围等)',
    gold_standard   JSON COMMENT '黄金标准答案(如有)',
    has_gold        TINYINT NOT NULL DEFAULT 0 COMMENT '是否为黄金题: 0/1',
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/ASSIGNED/SUBMITTED/REVIEWED/REJECTED/COMPLETED',
    priority        INT NOT NULL DEFAULT 5 COMMENT '优先级 1-10',
    assigned_to     BIGINT COMMENT '当前标注员ID',
    assigned_at     DATETIME COMMENT '分配时间',
    submitted_at    DATETIME COMMENT '提交时间',
    completed_at    DATETIME COMMENT '完成时间',
    retry_count     INT NOT NULL DEFAULT 0 COMMENT '被驳回重做次数',
    expire_at       DATETIME COMMENT '任务过期时间',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_project_status (project_id, status),
    INDEX idx_assignee (assigned_to, status),
    INDEX idx_item (item_type, item_id),
    INDEX idx_priority_status (priority DESC, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='标注任务表';
```

#### 3.1.3 标注结果表 `annotation_results`

```sql
CREATE TABLE annotation_results (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_id         BIGINT NOT NULL COMMENT '任务ID',
    annotator_id    BIGINT NOT NULL COMMENT '标注员ID',
    round           INT NOT NULL DEFAULT 1 COMMENT '标注轮次(初次/驳回后重做)',
    result_data     JSON NOT NULL COMMENT '标注结果数据',
    time_spent_ms   INT COMMENT '标注耗时(毫秒)',
    confidence      DECIMAL(3,2) COMMENT '标注员自评置信度 0-1',
    note            TEXT COMMENT '标注备注',
    submitted_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_task_round (task_id, round),
    INDEX idx_annotator (annotator_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='标注结果表';
```

#### 3.1.4 标注审核表 `annotation_reviews`

```sql
CREATE TABLE annotation_reviews (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_id         BIGINT NOT NULL COMMENT '任务ID',
    result_id       BIGINT NOT NULL COMMENT '被审核的标注结果ID',
    reviewer_id     BIGINT NOT NULL COMMENT '审核员ID',
    verdict         VARCHAR(20) NOT NULL COMMENT 'APPROVED/REJECTED/NEEDS_REVISION',
    feedback        TEXT COMMENT '审核反馈',
    corrected_data  JSON COMMENT '审核修正后的标注数据(如有修改)',
    reviewed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_task (task_id),
    INDEX idx_reviewer (reviewer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='标注审核表';
```

#### 3.1.5 标注员表 `annotation_workers`

```sql
CREATE TABLE annotation_workers (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id             BIGINT NOT NULL UNIQUE COMMENT '关联系统用户ID',
    worker_type         VARCHAR(20) NOT NULL COMMENT 'INTERNAL/EXPERT/OUTSOURCE',
    display_name        VARCHAR(100) NOT NULL,
    subjects            JSON COMMENT '擅长学科列表 ["MATH","PHYSICS"]',
    grade_expertise     JSON COMMENT '学段专长 ["SENIOR","JUNIOR"]',
    skill_tags          JSON COMMENT '技能标签 ["KNOWLEDGE_TAG","DIFFICULTY","ANSWER_VERIFY"]',
    status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE/PAUSED/DISABLED',
    total_tasks         INT NOT NULL DEFAULT 0 COMMENT '累计完成任务数',
    approved_rate       DECIMAL(5,2) DEFAULT 0.00 COMMENT '审核通过率',
    avg_consistency     DECIMAL(5,2) DEFAULT 0.00 COMMENT '平均一致率',
    gold_pass_rate      DECIMAL(5,2) DEFAULT 0.00 COMMENT '黄金题通过率',
    daily_quota         INT DEFAULT 50 COMMENT '每日任务配额',
    daily_completed     INT NOT NULL DEFAULT 0 COMMENT '今日已完成数',
    daily_reset_date    DATE COMMENT '配额重置日期',
    last_active_at      DATETIME,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status_type (status, worker_type),
    INDEX idx_subjects ((CAST(subjects AS CHAR(255))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='标注员表';
```

#### 3.1.6 黄金题集表 `annotation_gold_standards`

```sql
CREATE TABLE annotation_gold_standards (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id      BIGINT COMMENT '关联项目(NULL=通用黄金题)',
    task_item_type  VARCHAR(30) NOT NULL COMMENT '条目类型',
    task_item_id    BIGINT NOT NULL COMMENT '条目ID',
    standard_answer JSON NOT NULL COMMENT '标准答案',
    difficulty_level VARCHAR(20) DEFAULT 'NORMAL' COMMENT 'EASY/NORMAL/HARD',
    is_active       TINYINT NOT NULL DEFAULT 1,
    created_by      BIGINT NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_project_active (project_id, is_active),
    INDEX idx_item (task_item_type, task_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='黄金标准答案表';
```

### 3.2 标注Schema定义格式

标注Schema通过JSON配置定义标注界面的渲染方式和数据结构：

```json
{
  "version": "1.0",
  "annotationType": "MULTI_LABEL",
  "labels": [
    {
      "key": "knowledge_points",
      "label": "关联知识点",
      "type": "MULTI_SELECT",
      "required": true,
      "options": [
        {"value": "kp_001", "label": "一元二次方程"},
        {"value": "kp_002", "label": "判别式"},
        {"value": "kp_003", "label": "韦达定理"}
      ],
      "maxSelect": 5
    },
    {
      "key": "difficulty",
      "label": "难度等级",
      "type": "SINGLE_SELECT",
      "required": true,
      "options": [
        {"value": 1, "label": "基础"},
        {"value": 2, "label": "简单"},
        {"value": 3, "label": "中等"},
        {"value": 4, "label": "较难"},
        {"value": 5, "label": "困难"}
      ]
    },
    {
      "key": "cognitive_level",
      "label": "认知层级",
      "type": "SINGLE_SELECT",
      "required": false,
      "options": [
        {"value": "REMEMBER", "label": "记忆"},
        {"value": "UNDERSTAND", "label": "理解"},
        {"value": "APPLY", "label": "应用"},
        {"value": "ANALYZE", "label": "分析"},
        {"value": "EVALUATE", "label": "评价"},
        {"value": "CREATE", "label": "创造"}
      ]
    },
    {
      "key": "error_prone",
      "label": "易错点标注",
      "type": "TEXT",
      "required": false,
      "placeholder": "请描述本题常见易错点"
    }
  ],
  "validation": {
    "minLabels": 1,
    "requireDifficulty": true
  }
}
```

---

## 4. 标注类型体系

### 4.1 支持的标注类型

| 标注类型 | 标注形式 | 适用场景 | 质量评估方式 |
| --- | --- | --- | --- |
| `SINGLE_LABEL` | 单选标签 | 难度标定、题型分类、认知层级 | 准确率 / 黄金题通过率 |
| `MULTI_LABEL` | 多选标签 | 知识点关联、错误类型分类 | F1-Score / Jaccard相似度 |
| `SCORE` | 数值评分 | 解析质量评分、作文评分 | Pearson相关 / MSE |
| `TEXT` | 文本输入 | 易错点描述、解析补充、批注 | 人工审核 / 文本相似度 |
| `RANK` | 排序标注 | AI回答偏好排序、答案质量排序 | Kendall's Tau / NDCG |
| `BBOX` | 矩形框标注 | 题目图片区域标注、公式定位 | IoU |
| `KEY_VALUE` | 键值对标注 | 公式参数提取、条件结构化 | 字段级准确率 |

### 4.2 典型标注项目模板

```json
[
  {
    "templateCode": "KNOWLEDGE_TAG_QUESTION",
    "templateName": "题目知识点标注",
    "projectType": "KNOWLEDGE_TAG",
    "annotationType": "MULTI_LABEL",
    "schemaConfig": {
      "labels": [
        {"key": "knowledge_points", "label": "知识点", "type": "MULTI_SELECT", "required": true},
        {"key": "secondary_kp", "label": "次级知识点", "type": "MULTI_SELECT", "required": false},
        {"key": "exam_point", "label": "对应考点", "type": "MULTI_SELECT", "required": false}
      ]
    },
    "qualityControl": {
      "multiAnnotate": true,
      "annotatorCount": 3,
      "agreementThreshold": 0.67,
      "goldInsertRate": 0.10
    }
  },
  {
    "templateCode": "DIFFICULTY_RATING",
    "templateName": "题目难度标定",
    "projectType": "DIFFICULTY",
    "annotationType": "SCORE",
    "schemaConfig": {
      "labels": [
        {"key": "difficulty", "label": "难度(1-5)", "type": "SINGLE_SELECT", "required": true,
         "options": [
           {"value": 1, "label": "基础"}, {"value": 2, "label": "简单"},
           {"value": 3, "label": "中等"}, {"value": 4, "label": "较难"},
           {"value": 5, "label": "困难"}
         ]}
      ]
    },
    "qualityControl": {
      "multiAnnotate": true,
      "annotatorCount": 5,
      "agreementThreshold": 0.70,
      "goldInsertRate": 0.15
    }
  },
  {
    "templateCode": "AI_RESPONSE_PREFERENCE",
    "templateName": "AI回答偏好排序",
    "projectType": "PREFERENCE_RANK",
    "annotationType": "RANK",
    "schemaConfig": {
      "labels": [
        {"key": "ranking", "label": "回答质量排序", "type": "RANK", "required": true},
        {"key": "best_aspect", "label": "最优回答的优点", "type": "TEXT", "required": false},
        {"key": "worst_aspect", "label": "最差回答的缺点", "type": "TEXT", "required": false}
      ]
    },
    "qualityControl": {
      "multiAnnotate": true,
      "annotatorCount": 3,
      "agreementThreshold": 0.60,
      "goldInsertRate": 0.05
    }
  },
  {
    "templateCode": "ANSWER_VERIFICATION",
    "templateName": "答案正确性校验",
    "projectType": "ANSWER_VERIFY",
    "annotationType": "KEY_VALUE",
    "schemaConfig": {
      "labels": [
        {"key": "is_correct", "label": "答案是否正确", "type": "SINGLE_SELECT", "required": true,
         "options": [{"value": true, "label": "正确"}, {"value": false, "label": "错误"}]},
        {"key": "error_type", "label": "错误类型", "type": "SINGLE_SELECT", "required": false,
         "conditional": {"field": "is_correct", "equals": false},
         "options": [
           {"value": "CALCULATION", "label": "计算错误"},
           {"value": "CONCEPT", "label": "概念错误"},
           {"value": "LOGIC", "label": "逻辑错误"},
           {"value": "TYPO", "label": "印刷/录入错误"}
         ]},
        {"key": "correct_answer", "label": "正确答案", "type": "TEXT", "required": false,
         "conditional": {"field": "is_correct", "equals": false}}
      ]
    },
    "qualityControl": {
      "multiAnnotate": true,
      "annotatorCount": 2,
      "agreementThreshold": 1.0,
      "goldInsertRate": 0.20
    }
  }
]
```

---

## 5. API 接口设计

### 5.1 标注项目管理

#### 5.1.1 创建标注项目

```
POST /api/v1/annotation/projects
```

**请求体：**
```json
{
  "projectName": "2026年秋季人教版初中数学题目知识点标注",
  "projectType": "KNOWLEDGE_TAG",
  "description": "对人教版初中数学7-9年级题库进行知识点回标",
  "subject": "MATH",
  "gradeRange": "JUNIOR",
  "qualityTarget": 0.85,
  "deadline": "2026-09-30T23:59:59+08:00",
  "schemaConfig": { "...": "见3.2节Schema定义" },
  "qualityControl": {
    "multiAnnotate": true,
    "annotatorCount": 3,
    "agreementThreshold": 0.67,
    "goldInsertRate": 0.10
  },
  "sourceConfig": {
    "itemType": "QUESTION",
    "filter": {
      "subject": "MATH",
      "textbookVersion": "PEP",
      "gradeRange": ["GRADE_7", "GRADE_8", "GRADE_9"],
      "hasKnowledgePoint": false
    }
  }
}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "projectId": 10001,
    "projectCode": "ANN-2026-001",
    "status": "DRAFT",
    "totalItems": 0,
    "message": "项目创建成功，请执行任务生成"
  }
}
```

#### 5.1.2 批量生成标注任务

```
POST /api/v1/annotation/projects/{projectId}/generate-tasks
```

**请求体：**
```json
{
  "batchSize": 500,
  "priority": 7,
  "assignStrategy": "AUTO",
  "expireDays": 7
}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "generatedCount": 500,
    "totalTasks": 500,
    "goldTasksInserted": 50,
    "message": "成功生成500个标注任务，其中包含50个黄金题"
  }
}
```

#### 5.1.3 获取项目进度

```
GET /api/v1/annotation/projects/{projectId}/progress
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "projectId": 10001,
    "projectName": "2026年秋季人教版初中数学题目知识点标注",
    "status": "ACTIVE",
    "totalItems": 500,
    "annotatedItems": 342,
    "reviewedItems": 280,
    "approvedItems": 265,
    "rejectedItems": 15,
    "pendingReview": 62,
    "currentAgreement": 0.87,
    "qualityTarget": 0.85,
    "estimatedCompletion": "2026-09-22T00:00:00+08:00",
    "workerStats": [
      {"workerId": 201, "name": "张老师", "assigned": 80, "completed": 65, "approvedRate": 0.95},
      {"workerId": 202, "name": "李老师", "assigned": 80, "completed": 70, "approvedRate": 0.91}
    ]
  }
}
```

### 5.2 标注任务执行

#### 5.2.1 领取标注任务

```
POST /api/v1/annotation/tasks/claim
```

**请求体：**
```json
{
  "workerId": 201,
  "projectId": 10001,
  "count": 10,
  "preferredItems": []
}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "tasks": [
      {
        "taskId": 50001,
        "taskCode": "TASK-10001-0001",
        "itemType": "QUESTION",
        "itemSnapshot": {
          "questionId": 88001,
          "content": "已知方程 x² - 5x + 6 = 0，求x的值。",
          "questionType": "EQUATION_SOLVE",
          "subject": "MATH",
          "grade": "GRADE_8",
          "textbookVersion": "PEP",
          "currentKnowledgePoints": [],
          "currentDifficulty": null
        },
        "schemaConfig": { "...": "" },
        "isGold": false,
        "assignedAt": "2026-08-08T16:30:00+08:00",
        "expireAt": "2026-08-15T16:30:00+08:00"
      }
    ],
    "totalClaimed": 10,
    "dailyRemaining": 40
  }
}
```

#### 5.2.2 提交标注结果

```
POST /api/v1/annotation/tasks/{taskId}/submit
```

**请求体：**
```json
{
  "workerId": 201,
  "resultData": {
    "knowledge_points": ["kp_001", "kp_002"],
    "secondary_kp": ["kp_003"],
    "exam_point": ["ep_factoring", "ep_root_finding"]
  },
  "timeSpentMs": 45000,
  "confidence": 0.9,
  "note": "本题考查因式分解法解一元二次方程"
}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "taskId": 50001,
    "status": "SUBMITTED",
    "isGoldResult": {
      "passed": true,
      "score": 1.0
    },
    "autoConsistency": null,
    "message": "标注已提交，等待审核或一致性校验"
  }
}
```

#### 5.2.3 批量提交标注结果

```
POST /api/v1/annotation/tasks/batch-submit
```

**请求体：**
```json
{
  "workerId": 201,
  "submissions": [
    {"taskId": 50002, "resultData": {"knowledge_points": ["kp_004"]}, "timeSpentMs": 30000},
    {"taskId": 50003, "resultData": {"knowledge_points": ["kp_005", "kp_006"]}, "timeSpentMs": 55000},
    {"taskId": 50004, "resultData": {"knowledge_points": ["kp_007"]}, "timeSpentMs": 40000}
  ]
}
```

### 5.3 标注审核

#### 5.3.1 获取待审核任务

```
GET /api/v1/annotation/reviews/pending?projectId=10001&page=1&size=20
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "total": 62,
    "page": 1,
    "size": 20,
    "items": [
      {
        "taskId": 50001,
        "projectName": "2026年秋季人教版初中数学题目知识点标注",
        "itemSnapshot": {"questionId": 88001, "content": "已知方程 x² - 5x + 6 = 0..."},
        "annotationResult": {
          "workerId": 201,
          "workerName": "张老师",
          "resultData": {"knowledge_points": ["kp_001", "kp_002"]},
          "confidence": 0.9,
          "note": "本题考查因式分解法"
        },
        "multiAnnotations": [
          {"workerId": 202, "workerName": "李老师", "resultData": {"knowledge_points": ["kp_001"]}},
          {"workerId": 203, "workerName": "王老师", "resultData": {"knowledge_points": ["kp_001", "kp_002", "kp_003"]}}
        ],
        "consistencyScore": 0.67,
        "flagged": true,
        "flagReason": "一致率低于阈值0.85"
      }
    ]
  }
}
```

#### 5.3.2 提交审核结果

```
POST /api/v1/annotation/reviews
```

**请求体：**
```json
{
  "taskId": 50001,
  "resultId": 30001,
  "reviewerId": 301,
  "verdict": "APPROVED",
  "feedback": "标注准确，知识点关联合理",
  "correctedData": null
}
```

**驳回示例：**
```json
{
  "taskId": 50001,
  "resultId": 30001,
  "reviewerId": 301,
  "verdict": "REJECTED",
  "feedback": "遗漏了韦达定理知识点，本题也考查了根与系数的关系",
  "correctedData": {
    "knowledge_points": ["kp_001", "kp_002", "kp_003"]
  }
}
```

### 5.4 标注员管理

#### 5.4.1 注册标注员

```
POST /api/v1/annotation/workers
```

**请求体：**
```json
{
  "userId": 1001,
  "workerType": "EXPERT",
  "displayName": "张老师",
  "subjects": ["MATH", "PHYSICS"],
  "gradeExpertise": ["SENIOR", "JUNIOR"],
  "skillTags": ["KNOWLEDGE_TAG", "DIFFICULTY", "ANSWER_VERIFY"],
  "dailyQuota": 50
}
```

#### 5.4.2 获取标注员画像

```
GET /api/v1/annotation/workers/{workerId}/profile
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "workerId": 201,
    "displayName": "张老师",
    "workerType": "EXPERT",
    "subjects": ["MATH", "PHYSICS"],
    "stats": {
      "totalTasks": 1200,
      "approvedRate": 0.95,
      "avgConsistency": 0.88,
      "goldPassRate": 0.92,
      "avgTimePerTask": 38000,
      "weeklyThroughput": 85
    },
    "qualityTrend": [
      {"week": "2026-W31", "approvedRate": 0.96, "consistency": 0.89},
      {"week": "2026-W32", "approvedRate": 0.94, "consistency": 0.87}
    ],
    "skillMatrix": {
      "KNOWLEDGE_TAG": {"count": 500, "approvedRate": 0.96, "consistency": 0.90},
      "DIFFICULTY": {"count": 400, "approvedRate": 0.93, "consistency": 0.85},
      "ANSWER_VERIFY": {"count": 300, "approvedRate": 0.98, "consistency": 0.92}
    },
    "rank": "GOLD",
    "badges": ["准确率之星", "高一致率标注员", "数学领域专家"]
  }
}
```

### 5.5 数据导出

#### 5.5.1 导出标注数据

```
POST /api/v1/annotation/projects/{projectId}/export
```

**请求体：**
```json
{
  "format": "JSONL",
  "filter": {
    "status": "COMPLETED",
    "minConfidence": 0.8,
    "reviewVerdict": "APPROVED"
  },
  "include": ["itemSnapshot", "annotationResult", "reviewInfo"],
  "splitRatio": {
    "train": 0.8,
    "valid": 0.1,
    "test": 0.1
  }
}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "exportId": "EXP-2026-001",
    "status": "PROCESSING",
    "estimatedTime": 120,
    "callbackUrl": "/api/v1/annotation/exports/EXP-2026-001"
  }
}
```

---

## 6. 任务智能调度引擎

### 6.1 调度策略

```java
/**
 * 标注任务智能调度器
 * 综合考虑标注员专业匹配度、工作负载、历史质量进行任务分配
 */
@Component
public class AnnotationTaskScheduler {

    @Autowired
    private AnnotationWorkerRepository workerRepo;
    
    @Autowired
    private AnnotationTaskRepository taskRepo;
    
    @Autowired
    private AnnotationQualityService qualityService;

    /**
     * 为标注员分配最优任务
     * @param workerId 标注员ID
     * @param count 分配数量
     * @return 分配的任务列表
     */
    public List<AnnotationTask> assignTasks(Long workerId, int count) {
        AnnotationWorker worker = workerRepo.findById(workerId)
            .orElseThrow(() -> new BusinessException("标注员不存在"));
        
        // 1. 检查每日配额
        if (!hasRemainingQuota(worker)) {
            throw new BusinessException("今日任务配额已用完");
        }
        count = Math.min(count, worker.getDailyQuota() - worker.getDailyCompleted());
        
        // 2. 构建任务匹配评分
        List<AnnotationTask> candidates = taskRepo.findPendingTasksByProject(
            worker.getPreferredProjects(), PageRequest.of(0, count * 3)
        );
        
        // 3. 计算匹配分数并排序
        List<ScoredTask> scored = candidates.stream()
            .map(task -> new ScoredTask(task, calculateMatchScore(task, worker)))
            .sorted(Comparator.comparingDouble(ScoredTask::getScore).reversed())
            .limit(count)
            .collect(Collectors.toList());
        
        // 4. 按比例插入黄金题
        List<ScoredTask> finalAssignment = injectGoldStandards(scored, worker);
        
        // 5. 批量分配
        List<AnnotationTask> assigned = finalAssignment.stream()
            .map(s -> {
                AnnotationTask task = s.getTask();
                task.setAssignedTo(workerId);
                task.setStatus(TaskStatus.ASSIGNED);
                task.setAssignedAt(LocalDateTime.now());
                task.setExpireAt(LocalDateTime.now().plusDays(7));
                return taskRepo.save(task);
            })
            .collect(Collectors.toList());
        
        return assigned;
    }

    /**
     * 计算任务与标注员的匹配分数
     */
    private double calculateMatchScore(AnnotationTask task, AnnotationWorker worker) {
        double score = 0.0;
        
        // 学科匹配 (权重 0.35)
        if (task.getItemSubject() != null) {
            List<String> workerSubjects = worker.getSubjectList();
            if (workerSubjects.contains(task.getItemSubject())) {
                score += 0.35;
            }
        }
        
        // 学段匹配 (权重 0.15)
        if (task.getItemGradeRange() != null) {
            if (worker.getGradeExpertiseList().contains(task.getItemGradeRange())) {
                score += 0.15;
            }
        }
        
        // 标注类型技能匹配 (权重 0.20)
        String annotationType = task.getSchemaConfig().getAnnotationType();
        if (worker.getSkillTagsList().contains(annotationType)) {
            double skillAccuracy = qualityService.getSkillAccuracy(
                worker.getId(), annotationType
            );
            score += 0.20 * skillAccuracy;
        }
        
        // 任务优先级 (权重 0.15)
        score += 0.15 * (task.getPriority() / 10.0);
        
        // 标注员历史质量 (权重 0.15)
        double workerQuality = worker.getApprovedRate() * 0.5 
                             + worker.getAvgConsistency() * 0.5;
        score += 0.15 * workerQuality;
        
        return score;
    }

    /**
     * 黄金题注入：按项目配置的比例插入黄金题
     */
    private List<ScoredTask> injectGoldStandards(
            List<ScoredTask> assignments, AnnotationWorker worker) {
        
        double goldRate = assignments.get(0).getTask().getProject().getGoldInsertRate();
        int goldCount = (int) Math.ceil(assignments.size() * goldRate);
        
        // 优先选择该标注员未做过的黄金题
        List<AnnotationTask> goldTasks = taskRepo.findUncompletedGoldTasks(
            worker.getPreferredProjects(), worker.getId(), PageRequest.of(0, goldCount)
        );
        
        // 用黄金题替换分配列表中分数最低的条目
        for (int i = 0; i < Math.min(goldCount, goldTasks.size()); i++) {
            int replaceIdx = assignments.size() - 1 - i;
            assignments.set(replaceIdx, new ScoredTask(goldTasks.get(i), 1.0));
        }
        
        return assignments;
    }

    /**
     * 检查标注员今日是否还有剩余配额
     */
    private boolean hasRemainingQuota(AnnotationWorker worker) {
        LocalDate today = LocalDate.now();
        if (!today.equals(worker.getDailyResetDate())) {
            worker.setDailyCompleted(0);
            worker.setDailyResetDate(today);
            workerRepo.save(worker);
        }
        return worker.getDailyCompleted() < worker.getDailyQuota();
    }
}
```

### 6.2 调度策略矩阵

| 场景 | 分配策略 | 黄金题比例 | 多标人数 | 一致性阈值 |
| --- | --- | --- | --- | --- |
| 知识点标注（初次） | 学科匹配 + 轮询分配 | 10% | 3 | 0.67 |
| 难度标定 | 学段匹配 + 随机分配 | 15% | 5 | 0.70 |
| 答案正确性校验 | 精准匹配 + 双人独立 | 20% | 2 | 1.00 |
| AI回答偏好排序 | 随机分配 + 混合标注员池 | 5% | 3 | 0.60 |
| 内容适龄性评估 | 学段专家优先 | 10% | 3 | 0.80 |
| 解析质量评分 | 学科专家优先 | 15% | 3 | 0.75 |

---

## 7. 标注质量保障体系

### 7.1 质量保障架构

```
┌───────────────────────────────────────────────────────────┐
│                   标注质量保障四层防线                      │
├───────────────┬───────────────┬───────────────┬───────────┤
│   第一层       │   第二层       │   第三层       │  第四层    │
│   实时检测     │   一致性校验   │   人工审核     │  事后审计  │
├───────────────┼───────────────┼───────────────┼───────────┤
│ · 黄金题校验   │ · 多标一致性   │ · 专家抽审     │ · 模型效果 │
│ · 格式校验     │ · 冲突检测     │ · 驳回重做     │   回溯    │
│ · 超时检测     │ · 异常值检测   │ · 仲裁决策     │ · 定期    │
│ · 配额检测     │ · 趋势预警     │ · 批量审核     │   复查    │
└───────────────┴───────────────┴───────────────┴───────────┘
```

### 7.2 黄金题校验机制

```java
/**
 * 黄金题校验服务
 * 在标注员提交结果时，如果是黄金题，立即与标准答案比对
 */
@Service
public class GoldStandardValidationService {

    /**
     * 校验标注结果与黄金标准答案的一致程度
     * @param result 标注结果
     * @param goldStandard 黄金标准
     * @return 校验结果（0-1分数 + 详细差异）
     */
    public GoldValidationResult validate(
            AnnotationResult result, 
            GoldStandard goldStandard) {
        
        Map<String, Object> submitted = result.getResultDataMap();
        Map<String, Object> standard = goldStandard.getStandardAnswerMap();
        
        double totalScore = 0.0;
        int fieldCount = 0;
        List<FieldDiff> diffs = new ArrayList<>();
        
        for (Map.Entry<String, Object> entry : standard.entrySet()) {
            String field = entry.getKey();
            Object expected = entry.getValue();
            Object actual = submitted.get(field);
            fieldCount++;
            
            double fieldScore = calculateFieldScore(field, expected, actual);
            totalScore += fieldScore;
            
            if (fieldScore < 1.0) {
                diffs.add(new FieldDiff(field, expected, actual, fieldScore));
            }
        }
        
        double finalScore = fieldCount > 0 ? totalScore / fieldCount : 0.0;
        boolean passed = finalScore >= goldStandard.getPassThreshold();
        
        return new GoldValidationResult(finalScore, passed, diffs);
    }
    
    /**
     * 根据字段类型计算单字段得分
     */
    private double calculateFieldScore(
            String field, Object expected, Object actual) {
        
        if (expected == null && actual == null) return 1.0;
        if (expected == null || actual == null) return 0.0;
        
        // 集合类型：计算 Jaccard 相似度
        if (expected instanceof Collection && actual instanceof Collection) {
            Collection<?> expCol = (Collection<?>) expected;
            Collection<?> actCol = (Collection<?>) actual;
            Set<Object> expSet = new HashSet<>(expCol);
            Set<Object> actSet = new HashSet<>(actCol);
            
            Set<Object> intersection = new HashSet<>(expSet);
            intersection.retainAll(actSet);
            
            Set<Object> union = new HashSet<>(expSet);
            union.addAll(actSet);
            
            return union.isEmpty() ? 1.0 : (double) intersection.size() / union.size();
        }
        
        // 数值类型：计算相对误差
        if (expected instanceof Number && actual instanceof Number) {
            double expVal = ((Number) expected).doubleValue();
            double actVal = ((Number) actual).doubleValue();
            if (expVal == actVal) return 1.0;
            double error = Math.abs(expVal - actVal) / Math.max(Math.abs(expVal), 1.0);
            return Math.max(0.0, 1.0 - error);
        }
        
        // 字符串/枚举：精确匹配
        return expected.equals(actual) ? 1.0 : 0.0;
    }
}
```

### 7.3 多标注员一致性计算

```java
/**
 * 一致性计算服务
 * 对同一任务的多个标注结果计算一致性指标
 */
@Service
public class ConsistencyCalculator {

    /**
     * 计算一组标注结果的一致性分数
     * @param results 同一任务的多个标注结果
     * @param annotationType 标注类型
     * @return 一致性分数 0-1
     */
    public double calculateConsistency(
            List<AnnotationResult> results, 
            String annotationType) {
        
        if (results.size() < 2) return 1.0;
        
        switch (annotationType) {
            case "SINGLE_LABEL":
                return calculateFleissKappa(results);
            case "MULTI_LABEL":
                return calculateAvgJaccard(results);
            case "SCORE":
                return calculateICC(results);
            case "RANK":
                return calculateKendallsW(results);
            case "TEXT":
                return calculateAvgTextSimilarity(results);
            default:
                return calculateAvgJaccard(results);
        }
    }
    
    /**
     * 多标签标注的Jaccard平均相似度
     */
    private double calculateAvgJaccard(List<AnnotationResult> results) {
        List<Set<String>> labelSets = results.stream()
            .map(r -> new HashSet<>(r.getLabelList("knowledge_points")))
            .collect(Collectors.toList());
        
        double totalSimilarity = 0.0;
        int pairCount = 0;
        
        for (int i = 0; i < labelSets.size(); i++) {
            for (int j = i + 1; j < labelSets.size(); j++) {
                Set<String> intersection = new HashSet<>(labelSets.get(i));
                intersection.retainAll(labelSets.get(j));
                Set<String> union = new HashSet<>(labelSets.get(i));
                union.addAll(labelSets.get(j));
                totalSimilarity += union.isEmpty() ? 1.0 
                    : (double) intersection.size() / union.size();
                pairCount++;
            }
        }
        
        return pairCount > 0 ? totalSimilarity / pairCount : 1.0;
    }
    
    /**
     * Fleiss' Kappa - 多标注员分类一致性
     */
    private double calculateFleissKappa(List<AnnotationResult> results) {
        int n = results.size(); // 标注员数
        List<String> allLabels = results.stream()
            .map(AnnotationResult::getPrimaryLabel)
            .distinct()
            .collect(Collectors.toList());
        int k = allLabels.size(); // 类别数
        
        if (k <= 1) return 1.0;
        
        // 构建标注矩阵
        double[][] matrix = new double[1][k];
        for (AnnotationResult r : results) {
            int idx = allLabels.indexOf(r.getPrimaryLabel());
            if (idx >= 0) matrix[0][idx]++;
        }
        
        // 计算 P_i 和 P_bar
        double[] pj = new double[k];
        for (int j = 0; j < k; j++) {
            pj[j] = matrix[0][j] / n;
        }
        
        double pBar = 0.0;
        for (int j = 0; j < k; j++) {
            pBar += pj[j] * pj[j];
        }
        
        // 计算观察的一致性
        double pi = 0.0;
        for (int j = 0; j < k; j++) {
            pi += Math.pow(matrix[0][j], 2);
        }
        pi = (pi - n) / (n * (n - 1));
        
        if (pBar == 1.0) return 1.0;
        return (pi - pBar) / (1.0 - pBar);
    }
    
    /**
     * ICC (组内相关系数) - 评分型标注一致性
     */
    private double calculateICC(List<AnnotationResult> results) {
        List<Double> scores = results.stream()
            .map(AnnotationResult::getScoreValue)
            .filter(Objects::nonNull)
            .collect(Collectors.toList());
        
        if (scores.size() < 2) return 1.0;
        
        double mean = scores.stream().mapToDouble(Double::doubleValue).average().orElse(0);
        
        // 组间方差
        double betweenVar = scores.stream()
            .mapToDouble(s -> Math.pow(s - mean, 2))
            .sum() / scores.size();
        
        // 简化ICC：1 - CV² (变异系数的平方)
        double std = Math.sqrt(betweenVar);
        double cv = mean != 0 ? std / Math.abs(mean) : 0;
        
        return Math.max(0.0, 1.0 - cv);
    }
    
    /**
     * Kendall's W - 排序标注一致性
     */
    private double calculateKendallsW(List<AnnotationResult> results) {
        // 简化实现：提取排名序列，计算Kendall协调系数
        // W = 12 * ΣR_i² - n * k² * (k+1)² / 4  /  (k² * (n³ - n))
        // n = 被排序的条目数, k = 标注员数
        // 此处省略完整实现
        return 0.85; // placeholder
    }
}
```

### 7.4 标注员质量动态评级

```java
/**
 * 标注员质量动态评级服务
 * 基于多维度指标实时计算标注员质量等级
 */
@Service
public class WorkerQualityRankingService {

    private static final double GOLD_THRESHOLD = 0.90;
    private static final double SILVER_THRESHOLD = 0.80;
    private static final double BRONZE_THRESHOLD = 0.70;
    private static final int MIN_TASKS_FOR_RATING = 50;

    /**
     * 标注员等级枚举
     */
    public enum WorkerRank {
        GOLD("金牌标注员", 1.5),   // 任务权重 ×1.5
        SILVER("银牌标注员", 1.2), // 任务权重 ×1.2
        BRONZE("铜牌标注员", 1.0), // 标准
        PROBATION("观察期", 0.8),  // 降权
        DISABLED("已停用", 0.0);   // 不分配新任务
        
        private final String label;
        private final double weightMultiplier;
        // ... constructor, getters
    }

    /**
     * 重新计算标注员等级（定时任务每小时执行）
     */
    @Scheduled(fixedRate = 3600000)
    public void recalculateAllWorkerRanks() {
        List<AnnotationWorker> activeWorkers = workerRepo.findByStatus("ACTIVE");
        
        for (AnnotationWorker worker : activeWorkers) {
            if (worker.getTotalTasks() < MIN_TASKS_FOR_RATING) continue;
            
            WorkerRank newRank = calculateRank(worker);
            WorkerRank oldRank = worker.getCurrentRankEnum();
            
            if (newRank != oldRank) {
                worker.setRank(newRank);
                workerRepo.save(worker);
                
                // 发送等级变更通知
                eventPublisher.publishEvent(new WorkerRankChangedEvent(
                    worker.getId(), oldRank, newRank
                ));
                
                // 等级下降到观察期时，降低配额
                if (newRank == WorkerRank.PROBATION) {
                    worker.setDailyQuota((int)(worker.getDailyQuota() * 0.5));
                }
                
                // 连续低质量 → 停用
                if (newRank == WorkerRank.DISABLED) {
                    worker.setStatus("PAUSED");
                    notifyManagerForReview(worker);
                }
            }
        }
    }

    /**
     * 计算标注员等级
     */
    private WorkerRank calculateRank(AnnotationWorker worker) {
        // 综合得分 = 黄金题通过率 × 0.4 + 审核通过率 × 0.3 
        //         + 一致率 × 0.2 + 效率分 × 0.1
        
        double goldScore = worker.getGoldPassRate() * 0.4;
        double approvalScore = worker.getApprovedRate() * 0.3;
        double consistencyScore = worker.getAvgConsistency() * 0.2;
        double efficiencyScore = calculateEfficiencyScore(worker) * 0.1;
        
        double totalScore = goldScore + approvalScore + consistencyScore + efficiencyScore;
        
        if (totalScore >= GOLD_THRESHOLD) return WorkerRank.GOLD;
        if (totalScore >= SILVER_THRESHOLD) return WorkerRank.SILVER;
        if (totalScore >= BRONZE_THRESHOLD) return WorkerRank.BRONZE;
        if (totalScore >= 0.50) return WorkerRank.PROBATION;
        return WorkerRank.DISABLED;
    }
}
```

---

## 8. 任务状态流转

### 8.1 标注任务状态机

```
                    ┌─────────┐
     项目生成任务 ───▶│ PENDING │
                    └────┬────┘
                         │ 分配标注员
                         ▼
                    ┌─────────┐
                    │ ASSIGNED│──────────────────┐
                    └────┬────┘                  │
                    标注员提交或超时回收             │ 超时未提交
                         │                       ▼
                         ▼                  ┌─────────┐
                    ┌──────────┐            │ PENDING │ (回收重分配)
                    │SUBMITTED │            └─────────┘
                    └────┬─────┘
                    自动质量校验
                    ├ 通过 ──────────────┐
                    ├ 黄金题未通过 ──┐    │
                    │               ▼    │
                    │          ┌────────┐│
                    │          │REJECTED││
                    │          └───┬────┘│
                    │    驳回重做     │
                    │              ▼     │
                    │          ┌────────┐│
                    │          │ASSIGNED││ (回到标注)
                    │          └────────┘│
                    │                    │
                    ▼                    │
               ┌──────────┐              │
               │ REVIEWED │◀─────────────┘
               └────┬─────┘
               审核结果
               ├ APPROVED ────────────┐
               ├ NEEDS_REVISION ──▶ 回到 ASSIGNED
               │                      │
               ▼                      │
          ┌───────────┐               │
          │ COMPLETED │               │
          └───────────┘               │
           最终结果入库                 │
           训练数据仓库更新              │
```

### 8.2 状态转换规则

```java
/**
 * 标注任务状态机
 */
public class AnnotationTaskStateMachine {

    private static final Map<TaskStatus, Set<TaskStatus>> TRANSITIONS = Map.of(
        TaskStatus.PENDING,    EnumSet.of(TaskStatus.ASSIGNED, TaskStatus.COMPLETED),
        TaskStatus.ASSIGNED,   EnumSet.of(TaskStatus.SUBMITTED, TaskStatus.PENDING),
        TaskStatus.SUBMITTED,  EnumSet.of(TaskStatus.REVIEWED, TaskStatus.REJECTED, TaskStatus.ASSIGNED),
        TaskStatus.REJECTED,   EnumSet.of(TaskStatus.ASSIGNED),
        TaskStatus.REVIEWED,   EnumSet.of(TaskStatus.COMPLETED, TaskStatus.ASSIGNED),
        TaskStatus.COMPLETED,  EnumSet.of() // 终态
    );
    
    public static boolean canTransition(TaskStatus from, TaskStatus to) {
        return TRANSITIONS.getOrDefault(from, EnumSet.noneOf(TaskStatus.class)).contains(to);
    }
    
    public static void transition(AnnotationTask task, TaskStatus to) {
        TaskStatus from = task.getStatus();
        if (!canTransition(from, to)) {
            throw new IllegalStateException(
                String.format("非法状态转换: %s → %s", from, to)
            );
        }
        task.setStatus(to);
        if (to == TaskStatus.COMPLETED) {
            task.setCompletedAt(LocalDateTime.now());
        }
    }
}
```

---

## 9. 错误处理与异常场景

### 9.1 错误码定义

| 错误码 | 说明 | 处理策略 |
| --- | --- | --- |
| `ANN_001` | 项目不存在 | 返回 404 |
| `ANN_002` | 任务不存在或已删除 | 返回 404 |
| `ANN_003` | 标注员不存在或已停用 | 返回 403 |
| `ANN_004` | 任务不属于当前标注员 | 返回 403 |
| `ANN_005` | 任务已提交，不可重复标注 | 返回 409 |
| `ANN_006` | 每日配额已用完 | 返回 429，返回次日重置时间 |
| `ANN_007` | 标注结果格式不合法 | 返回 400，附带 Schema 校验错误详情 |
| `ANN_008` | 黄金题校验未通过 | 不阻断提交，标记为低质标注 |
| `ANN_009` | 任务已过期 | 返回 410，提示重新领取 |
| `ANN_010` | 项目已归归档 | 返回 403 |
| `ANN_011` | 导出任务排队中 | 返回 202，返回轮询地址 |
| `ANN_012` | 标注员被降级，无权领取 | 返回 403 |

### 9.2 异常处理策略

```java
/**
 * 标注平台统一异常处理
 */
@RestControllerAdvice
public class AnnotationExceptionHandler {

    @ExceptionHandler(AnnotationBusinessException.class)
    public ResponseEntity<ApiResponse<Void>> handleAnnotation(
            AnnotationBusinessException ex) {
        
        AnnotationErrorCode code = ex.getErrorCode();
        
        // 可重试错误
        if (code.isRetryable()) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(ApiResponse.error(code.getCode(), ex.getMessage(), 
                    Map.of("retryAfter", code.getRetryAfterSeconds())));
        }
        
        // 权限错误
        if (code.getCategory() == ErrorCategory.PERMISSION) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ApiResponse.error(code.getCode(), ex.getMessage()));
        }
        
        // 格式错误
        if (code.getCategory() == ErrorCategory.VALIDATION) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error(code.getCode(), ex.getMessage(), 
                    Map.of("validationErrors", ex.getDetails())));
        }
        
        // 默认
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(ApiResponse.error(code.getCode(), ex.getMessage()));
    }
}
```

### 9.3 关键异常场景处理

| 异常场景 | 触发条件 | 自动处理 |
| --- | --- | --- |
| 标注员中途退出 | 任务 ASSIGNED 超过 48h 无提交 | 自动回收任务 → PENDING |
| 黄金题连续失败 | 标注员近 10 个黄金题通过率 < 50% | 自动降级 → PROBATION，配额减半 |
| 一致性持续偏低 | 近 20 个任务平均一致性 < 0.5 | 触发人工审查 |
| 大量任务驳回 | 标注员驳回率 > 30%（近 50 个任务） | 暂停分配，通知管理员 |
| 项目数据异常 | 标注结果方差为 0（全相同） | 标记为可疑，冻结相关标注员 |
| 系统故障恢复 | 服务重启后任务状态不一致 | 定时巡检：ASSIGNED 超时回收到 PENDING |

---

## 10. 性能优化

### 10.1 缓存策略

| 缓存对象 | 缓存位置 | TTL | 失效策略 |
| --- | --- | --- | --- |
| 项目配置信息 | Redis | 1h | 项目修改时主动刷新 |
| 标注 Schema 定义 | Redis | 24h | Schema 修改时刷新 |
| 标注员画像 | Redis | 10min | 标注提交时增量更新 |
| 黄金标准答案 | Redis | 24h | 不可变，永久缓存 |
| 任务进度统计 | Redis | 5min | 定时任务刷新 |
| 标注员每日配额 | Redis | 至当日 24:00 | 提交时原子递增 |

### 10.2 批量操作优化

```java
/**
 * 批量任务分配优化
 * 使用 Redis 分布式锁 + Lua 脚本保证原子性
 */
@Service
public class BatchTaskAssignmentService {

    private static final String ASSIGN_LOCK_KEY = "annotation:assign:lock:";
    
    /**
     * 批量分配任务（使用 Redis Pipeline 减少网络往返）
     */
    @Transactional
    public BatchAssignResult batchAssign(Long workerId, List<Long> taskIds) {
        String lockKey = ASSIGN_LOCK_KEY + workerId;
        
        return redisLockManager.executeWithLock(lockKey, 30, () -> {
            // 1. 批量查询任务（SELECT ... WHERE id IN (...)）
            List<AnnotationTask> tasks = taskRepo.findAllByIdForUpdate(taskIds);
            
            // 2. 过滤可用任务
            List<AnnotationTask> available = tasks.stream()
                .filter(t -> t.getStatus() == TaskStatus.PENDING)
                .collect(Collectors.toList());
            
            // 3. 批量更新
            LocalDateTime now = LocalDateTime.now();
            for (AnnotationTask task : available) {
                task.setAssignedTo(workerId);
                task.setStatus(TaskStatus.ASSIGNED);
                task.setAssignedAt(now);
            }
            
            // 4. 批量保存（MyBatis 批量 UPDATE）
            taskRepo.batchUpdate(available);
            
            return new BatchAssignResult(
                available.size(), 
                taskIds.size() - available.size()
            );
        });
    }
}
```

### 10.3 异步导出处理

```java
/**
 * 标注数据异步导出
 * 大量数据导出走消息队列 + 异步处理
 */
@Service
public class AnnotationExportService {

    @Autowired
    private RabbitTemplate rabbitTemplate;
    
    @Autowired
    private FileStorageService fileStorageService;

    /**
     * 提交导出任务
     */
    public ExportTaskResult submitExport(
            Long projectId, ExportRequest request) {
        
        String exportId = generateExportId();
        
        // 1. 创建导出任务记录
        ExportTask task = ExportTask.builder()
            .exportId(exportId)
            .projectId(projectId)
            .format(request.getFormat())
            .filter(request.getFilter())
            .status(ExportStatus.QUEUED)
            .createdAt(LocalDateTime.now())
            .build();
        exportTaskRepo.save(task);
        
        // 2. 发送到导出队列
        rabbitTemplate.convertAndSend(
            "annotation.export.queue",
            new ExportMessage(exportId, projectId, request)
        );
        
        return new ExportTaskResult(exportId, "QUEUED", 120);
    }
    
    /**
     * 异步执行导出（消费者）
     */
    @RabbitListener(queues = "annotation.export.queue")
    public void processExport(ExportMessage message) {
        String exportId = message.getExportId();
        
        try {
            exportTaskRepo.updateStatus(exportId, ExportStatus.PROCESSING);
            
            // 1. 分批查询标注结果（避免内存溢出）
            int pageSize = 1000;
            int pageNum = 0;
            List<File> partFiles = new ArrayList<>();
            
            while (true) {
                Page<AnnotationResult> page = queryResultsBatch(
                    message.getProjectId(), message.getFilter(), pageNum, pageSize
                );
                if (page.isEmpty()) break;
                
                // 2. 写入临时文件
                File partFile = writeBatchToFile(page.getContent(), message.getFormat());
                partFiles.add(partFile);
                
                pageNum++;
            }
            
            // 3. 合并文件并上传
            File mergedFile = mergeFiles(partFiles);
            String downloadUrl = fileStorageService.upload(mergedFile);
            
            // 4. 更新导出任务状态
            exportTaskRepo.updateStatusAndUrl(
                exportId, ExportStatus.COMPLETED, downloadUrl
            );
            
        } catch (Exception e) {
            exportTaskRepo.updateStatus(exportId, ExportStatus.FAILED);
            log.error("导出失败: exportId={}, error={}", exportId, e.getMessage(), e);
        }
    }
}
```

---

## 11. 安全与权限控制

### 11.1 角色权限矩阵

| 角色 | 项目管理 | 任务执行 | 任务审核 | 标注员管理 | 数据导出 | 黄金题管理 |
| --- | --- | --- | --- | --- | --- | --- |
| 标注管理员 | ✅ 全部 | ❌ | ✅ | ✅ | ✅ | ✅ |
| 项目负责人 | ✅ 本项目 | ❌ | ✅ 本项目 | ❌ 查看 | ✅ 本项目 | ✅ 本项目 |
| 审核员 | ❌ 查看 | ❌ | ✅ 分配的 | ❌ | ❌ | ❌ |
| 内部标注员 | ❌ | ✅ 自己的 | ❌ | ❌ | ❌ | ❌ |
| 外包标注员 | ❌ | ✅ 自己的 | ❌ | ❌ | ❌ | ❌ |
| 学科专家 | ❌ 查看 | ✅ 优先分配 | ✅ | ❌ | ❌ 查看 | ❌ |

### 11.2 数据隔离

```java
/**
 * 标注平台数据权限拦截器
 */
@Component
public class AnnotationDataScopeInterceptor {

    /**
     * 根据用户角色自动注入数据范围过滤
     */
    public Specification<AnnotationTask> applyDataScope(
            Specification<AnnotationTask> spec, Long currentUserId, String role) {
        
        switch (role) {
            case "ANNOTATOR":
                // 标注员只能看到分配给自己的任务
                return spec.and((root, query, cb) -> 
                    cb.equal(root.get("assignedTo"), currentUserId));
                    
            case "REVIEWER":
                // 审核员只能看到分配给自己审核的任务
                return spec.and((root, query, cb) -> 
                    cb.equal(root.get("reviewerId"), currentUserId));
                    
            case "PROJECT_OWNER":
                // 项目负责人只能看到自己项目的任务
                List<Long> projectIds = getOwnedProjectIds(currentUserId);
                return spec.and((root, query, cb) -> 
                    root.get("projectId").in(projectIds));
                    
            case "ANNOTATION_ADMIN":
                // 管理员可见全部
                return spec;
                
            default:
                return spec.and((root, query, cb) -> 
                    cb.disjunction()); // 无数据
        }
    }
}
```

### 11.3 数据脱敏

- 标注员姓名在跨团队协作时做脱敏处理（显示工号+学科）
- 学生原始数据（如手写答案图片）在标注前做学生身份信息剥离
- 导出的标注数据不包含标注员个人身份信息
- 审计日志保留操作人完整信息但不对外展示

---

## 12. 监控与告警

### 12.1 关键监控指标

| 指标 | 告警阈值 | 处理动作 |
| --- | --- | --- |
| 项目整体进度滞后 | 完成 < 预期 60% 且距截止 < 7 天 | 通知项目负责人 |
| 标注一致率持续下降 | 连续 3 天一致率环比下降 > 10% | 触发标注规则复审 |
| 黄金题整体通过率低 | 全项目黄金题通过率 < 70% | 检查黄金标准答案正确性 |
| 标注员活跃度异常 | 日活标注员 < 总数 30% | 通知运营团队 |
| 任务积压 | PENDING 任务 > 总量 50% | 触发紧急标注员招募 |
| 导出任务超时 | 导出排队 > 30 分钟 | 检查导出消费者健康 |
| API 错误率 | 标注提交错误率 > 5% | 触发服务告警 |

### 12.2 数据质量看板

```json
{
  "dashboard": "annotation_quality_overview",
  "panels": [
    {
      "title": "每日标注产出趋势",
      "type": "LINE_CHART",
      "metrics": ["daily_submitted", "daily_approved", "daily_rejected"],
      "timeRange": "LAST_30_DAYS"
    },
    {
      "title": "项目进度总览",
      "type": "STACKED_BAR",
      "metrics": ["completed", "in_review", "pending", "rejected"],
      "groupBy": "project"
    },
    {
      "title": "标注员质量分布",
      "type": "PIE",
      "metrics": {
        "GOLD": 15,
        "SILVER": 28,
        "BRONZE": 12,
        "PROBATION": 3
      }
    },
    {
      "title": "一致率热力图",
      "type": "HEATMAP",
      "dimensions": ["subject", "annotation_type"],
      "metric": "avg_consistency"
    },
    {
      "title": "黄金题通过率趋势",
      "type": "LINE_CHART",
      "metrics": ["gold_pass_rate"],
      "groupBy": "worker_rank"
    }
  ]
}
```

---

## 13. 与模型训练管线对接

### 13.1 数据流转

```
标注平台产出              训练数据仓库              模型训练
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ 审核通过的    │─────▶│ 标注数据     │─────▶│ 微调数据集   │
│ 标注结果      │ 自动 │ 清洗 & 去重  │ 按   │ 构建         │
│              │ 入库  │ & 格式标准化 │ 比例 │              │
│ · 知识点标签 │      │              │ 划分 │ train/valid/ │
│ · 难度等级   │      │ · 去重       │      │ test         │
│ · 答案校验   │      │ · 格式校验   │      │              │
│ · 偏好排序   │      │ · 去敏感化   │      │ 模型微调     │
│ · 质量评分   │      │ · 版本标记   │      │ & 评估       │
└──────────────┘      └──────────────┘      └──────────────┘
                         │
                    ┌────▼────┐
                    │ 版本管理 │
                    │ v1.0.0  │
                    │ v1.1.0  │
                    │ v2.0.0  │
                    └─────────┘
```

### 13.2 训练数据版本管理

每次导出的标注数据集生成语义化版本号：

```json
{
  "datasetVersion": "math-knowledge-tag-v2.1.0",
  "projectId": 10001,
  "exportTime": "2026-08-08T16:00:00+08:00",
  "stats": {
    "totalSamples": 5000,
    "trainSplit": 4000,
    "validSplit": 500,
    "testSplit": 500,
    "avgAgreement": 0.87,
    "goldPassRate": 0.92
  },
  "schemaVersion": "1.0",
  "previousVersion": "math-knowledge-tag-v2.0.0",
  "changelog": "新增500个题目标注，修正23个错误知识点关联",
  "modelEvaluation": {
    "previousF1": 0.82,
    "afterRetrainF1": 0.86,
    "improvement": 0.04
  }
}
```

---

## 14. 部署与扩展

### 14.1 服务拆分建议

MVP 阶段可作为单体模块部署，后续按以下路径拆分：

| 阶段 | 拆分策略 |
| --- | --- |
| MVP | 标注服务作为内容管理服务的一个子模块 |
| V1.0 | 独立为 annotation-service，与 content-service 解耦 |
| V2.0 | 进一步拆分为调度服务(scheduler-service)和执行服务(executor-service) |

### 14.2 容量估算

| 并发规模 | 资源配置 |
| --- | --- |
| 50 并发标注员 | 2 核 4G × 2 实例 |
| 200 并发标注员 | 4 核 8G × 3 实例 + Redis 哨兵 |
| 500+ 并发标注员 | K8s 自动伸缩 (3-10 pod) + Redis 集群 |

---

## 15. 总结

本设计文档覆盖了 PrimeTop 教育平台 AI 训练数据标注管理的完整方案，核心价值包括：

1. **统一标注入口**：将知识点标注、难度标定、答案校验、AI 回答质量评估等标注需求归集到统一平台，避免各团队重复建设标注工具。
2. **智能任务调度**：基于标注员专业领域、历史质量和当前负载的智能分配算法，最大化标注效率和质量的平衡。
3. **四层质量保障**：黄金题实时校验 → 多标注员一致性检测 → 人工审核 → 事后模型效果回溯，层层递进保证标注数据可信度。
4. **标注员全生命周期管理**：从注册到评级、升降级、停用，形成完整的标注员质量管理闭环。
5. **训练管线无缝对接**：标注完成的数据自动清洗、版本化、导出，直接供模型微调管线消费。
6. **可扩展架构**：Schema 驱动的标注类型系统，新增标注类型只需配置 JSON Schema，无需修改代码。