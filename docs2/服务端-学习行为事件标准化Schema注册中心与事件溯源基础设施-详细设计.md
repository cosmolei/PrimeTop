# 服务端-学习行为事件标准化Schema注册中心与事件溯源基础设施-详细设计

## 1. 概述

### 1.1 功能定位

本模块是 PrimeTop 教育平台**全域学习行为领域事件的统一基础设施层**，为所有业务微服务提供：

1. **标准化事件 Schema 定义**：统一所有学习相关领域事件的数据格式
2. **Schema 注册中心**：集中管理事件 Schema 版本、演进与兼容性校验
3. **事件溯源基础设施**：基于 Event Sourcing 模式持久化领域事件，支持状态重建与时序查询
4. **事件分发总线**：将领域事件可靠分发给下游消费者（推荐引擎、分析平台、通知服务等）

### 1.2 设计目标

| 目标 | 指标 |
| --- | --- |
| 事件发布延迟（P99） | < 10ms（同步写入）/ < 100ms（异步通知） |
| 事件投递可靠性 | At-Least-Once，幂等消费保障 |
| Schema 兼容性校验 | 100% 向后兼容，破坏性变更需走迁移流程 |
| 事件存储查询能力 | 支持按时间范围、聚合根ID、事件类型多维查询 |
| 事件回放能力 | 支持指定时间段的精准事件回放，误差 < 1ms |

### 1.3 适用范围

覆盖所有学习行为相关领域事件的发布、存储、分发与消费，包括但不限于：

- 学习会话事件（开始、暂停、恢复、结束）
- 答题行为事件（作答、批改、订正）
- 内容学习事件（章节学习、视频观看、音频播放）
- AI 交互事件（对话、提问、反馈）
- 学习计划事件（创建、更新、完成）
- 错题相关事件（收录、复习、掌握）

### 1.4 与现有模块的边界

| 现有模块 | 本模块与之关系 |
| --- | --- |
| 统一用户行为埋点平台 | 埋点平台偏重**客户端**用户交互埋点采集；本模块偏重**服务端领域语义事件** |
| 学习行为实时流处理与CEP | CEP引擎是本模块的**下游消费者**，专注复杂事件检测 |
| 统一变更数据捕获CDC管道 | CDC捕获**数据库变更**（技术层面）；本模块捕获**领域语义事件**（业务层面） |
| 消息队列与事件驱动架构 | 本模块是消息队列之上的**领域事件治理框架**，提供Schema管理、事件存储等能力 |
| 学习行为事件流与跨模块级联 | 跨模块级联是本模块事件总线的**消费模式之一** |

---

## 2. 核心概念与领域模型

### 2.1 核心概念定义

| 概念 | 说明 |
| --- | --- |
| **DomainEvent（领域事件）** | 业务上有意义的、已发生的学习行为事实，不可变 |
| **AggregateRoot（聚合根）** | 事件的归属实体，如 `LearningSession`、`AnswerRecord` 等 |
| **EventStore（事件存储）** | 领域事件的持久化存储，按聚合根ID追加写入 |
| **SchemaRegistry（Schema注册中心）** | 管理事件Schema定义、版本、兼容性校验 |
| **Projection（投影/读模型）** | 从事件流派生的物化视图，用于查询优化 |
| **Snapshot（快照）** | 聚合根在某个时间点的状态快照，加速状态重建 |
| **Replay（回放）** | 从事件存储重新读取历史事件，重建聚合根状态 |

### 2.2 领域事件分类体系

```
LearningEvent（根接口）
├── SessionEvent（学习会话事件）
│   ├── LearningSessionStartedEvent
│   ├── LearningSessionPausedEvent
│   ├── LearningSessionResumedEvent
│   ├── LearningSessionEndedEvent
│   └── LearningContextSwitchedEvent
├── AnswerEvent（答题事件）
│   ├── AnswerSubmittedEvent
│   ├── AnswerGradedEvent
│   ├── AnswerReviewedEvent
│   ├── AnswerCorrectedEvent
│   └── TimeOutSubmittedEvent
├── ContentEvent（内容学习事件）
│   ├── ChapterStudyStartedEvent
│   ├── ChapterStudyCompletedEvent
│   ├── VideoPlayEvent
│   ├── VideoProgressEvent
│   ├── AudioPlayEvent
│   ├── AudioProgressEvent
│   └── ReadingProgressEvent
├── AIInteractionEvent（AI交互事件）
│   ├── AIConversationStartedEvent
│   ├── AIMessageSentEvent
│   ├── AIResponseReceivedEvent
│   ├── AIFeedbackSubmittedEvent
│   └── AIQualityFlaggedEvent
├── MistakeEvent（错题事件）
│   ├── MistakeAddedEvent
│   ├── MistakeReviewedEvent
│   ├── MistakeMasteredEvent
│   └── MistakeArchivedEvent
├── PlanEvent（学习计划事件）
│   ├── StudyPlanCreatedEvent
│   ├── StudyPlanUpdatedEvent
│   ├── TaskAssignedEvent
│   ├── TaskCompletedEvent
│   └── TaskOverdueEvent
└── EngagementEvent（参与度事件）
    ├── StreakUpdatedEvent
    ├── BadgeUnlockedEvent
    ├── ChallengeJoinedEvent
    └── LeaderboardUpdatedEvent
```

---

## 3. 数据结构定义

### 3.1 领域事件通用信封结构

所有领域事件共用一个信封（Envelope）结构，携带元数据信息：

```json
{
  "eventId": "evt_20260729_000123456",
  "eventType": "AnswerSubmittedEvent",
  "eventVersion": "2.1.0",
  "schemaId": "sch_answer_submitted_v2_1_0",
  "timestamp": "2026-07-29T00:36:12.123Z",
  "aggregateRootId": "stu_100234_session_20260729_001",
  "aggregateRootType": "LearningSession",
  "tenantId": "school_org_001",
  "userId": "stu_100234",
  "studentId": "stu_100234",
  "grade": 7,
  "stage": "MIDDLE",
  "subject": "MATH",
  "textbookVersion": "PEP_2024",
  "source": "question_service",
  "correlationId": "corr_abc123",
  "causationId": "cmd_submit_answer_456",
  "metadata": {
    "deviceId": "dev_xxx",
    "appVersion": "3.2.1",
    "platform": "ANDROID",
    "networkType": "WIFI",
    "latencyMs": 234
  },
  "payload": {
  }
}
```

### 3.2 事件信封字段说明

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| eventId | String | 是 | 全局唯一事件ID，格式 `evt_{yyyyMMdd}_{nanoid}` |
| eventType | String | 是 | 事件类型名称，PascalCase |
| eventVersion | String | 是 | 事件Schema版本，语义化版本号 `MAJOR.MINOR.PATCH` |
| schemaId | String | 是 | Schema注册中心分配的唯一标识 |
| timestamp | DateTime | 是 | 事件发生时间（UTC，毫秒精度） |
| aggregateRootId | String | 是 | 聚合根唯一标识 |
| aggregateRootType | String | 是 | 聚合根类型 |
| tenantId | String | 否 | 租户ID（多租户/学校场景） |
| userId | String | 是 | 操作用户ID |
| studentId | String | 否 | 学生ID（家长/教师操作时与userId不同） |
| grade | Integer | 否 | 学生年级，冗余字段便于下游消费 |
| stage | String | 否 | 学段：`KINDERGARTEN` / `PRIMARY` / `MIDDLE` / `HIGH` |
| subject | String | 否 | 学科枚举 |
| textbookVersion | String | 否 | 教材版本 |
| source | String | 是 | 事件来源服务名 |
| correlationId | String | 否 | 链路追踪ID，串联同一请求的所有事件 |
| causationId | String | 否 | 因果命令ID |
| metadata | Object | 否 | 附加技术元数据（设备信息等） |
| payload | Object | 是 | 事件业务数据负载 |

### 3.3 核心事件 Payload Schema 定义

#### 3.3.1 答题提交事件（AnswerSubmittedEvent）

```json
{
  "payload": {
    "answerId": "ans_20260729_000001",
    "sessionId": "sess_20260729_001",
    "questionId": "q_math_001234",
    "questionType": "MULTIPLE_CHOICE",
    "studentAnswer": "B",
    "submittedAt": "2026-07-29T00:36:10.000Z",
    "timeSpentMs": 45000,
    "attemptNumber": 1,
    "hintsUsed": 1,
    "inputMethod": "TAP",
    "knowledgePoints": ["kp_algebra_linear_eq", "kp_solve_equations"],
    "chapterCode": "MATH_G7_CH3_S2",
    "difficulty": 3,
    "isFromMistakeReview": false,
    "context": {
      "source": "SYNC_CLASSROOM_PRACTICE",
      "sectionId": "sec_20260729_math_001"
    }
  }
}
```

#### 3.3.2 答题批改事件（AnswerGradedEvent）

```json
{
  "payload": {
    "answerId": "ans_20260729_000001",
    "questionId": "q_math_001234",
    "isCorrect": false,
    "score": 0,
    "maxScore": 5,
    "gradedBy": "AUTO_GRADER",
    "gradedAt": "2026-07-29T00:36:11.000Z",
    "gradingDetails": {
      "correctAnswer": "C",
      "errorType": "CONCEPT_MISUNDERSTANDING",
      "knowledgePointMastery": {
        "kp_algebra_linear_eq": {
          "beforeMastery": 0.75,
          "afterMastery": 0.65,
          "delta": -0.10
        }
      }
    },
    "shouldAddToMistakes": true,
    "recommendedAction": "REVIEW_KNOWLEDGE_POINT"
  }
}
```

#### 3.3.3 学习会话开始事件（LearningSessionStartedEvent）

```json
{
  "payload": {
    "sessionId": "sess_20260729_001",
    "sessionType": "SYNC_CLASSROOM",
    "startedAt": "2026-07-29T00:30:00.000Z",
    "studyContext": {
      "subject": "MATH",
      "chapterCode": "MATH_G7_CH3_S2",
      "textbookVersion": "PEP_2024",
      "learningGoal": "掌握一元一次方程的解法"
    },
    "plannedDurationMin": 30,
    "parentControlActive": false
  }
}
```

#### 3.3.4 学习会话结束事件（LearningSessionEndedEvent）

```json
{
  "payload": {
    "sessionId": "sess_20260729_001",
    "endedAt": "2026-07-29T01:05:00.000Z",
    "actualDurationMs": 2100000,
    "effectiveDurationMs": 1850000,
    "pauseCount": 2,
    "pauseTotalMs": 250000,
    "questionsAnswered": 15,
    "correctRate": 0.73,
    "knowledgePointsCovered": ["kp_algebra_linear_eq", "kp_solve_equations"],
    "aiInteractions": 3,
    "sessionQuality": "GOOD",
    "endReason": "USER_INITIATED",
    "nextRecommendedAction": "REVIEW_MISTAKES"
  }
}
```

#### 3.3.5 错题收录事件（MistakeAddedEvent）

```json
{
  "payload": {
    "mistakeId": "mis_20260729_000001",
    "questionId": "q_math_001234",
    "source": "PRACTICE",
    "sourceSessionId": "sess_20260729_001",
    "errorType": "CONCEPT_MISUNDERSTANDING",
    "studentAnswer": "B",
    "correctAnswer": "C",
    "knowledgePoints": ["kp_algebra_linear_eq"],
    "chapterCode": "MATH_G7_CH3_S2",
    "subject": "MATH",
    "difficulty": 3,
    "addedAt": "2026-07-29T00:36:12.000Z",
    "tags": ["代数", "方程"],
    "reviewScheduledAt": "2026-07-30T00:36:12.000Z",
    "reviewInterval": 1,
    "reviewAlgorithm": "SM_2"
  }
}
```

#### 3.3.6 AI 对话消息事件（AIMessageSentEvent）

```json
{
  "payload": {
    "conversationId": "conv_20260729_001",
    "messageId": "msg_000001",
    "role": "STUDENT",
    "contentType": "TEXT",
    "contentLength": 45,
    "inputMethod": "TEXT_INPUT",
    "context": {
      "subject": "MATH",
      "grade": 7,
      "chapterCode": "MATH_G7_CH3_S2",
      "intent": "CONCEPT_EXPLANATION",
      "previousMessageId": "msg_000000"
    },
    "modelConfig": {
      "modelId": "gpt-4-edu",
      "promptTemplateId": "tpl_math_explanation_v3",
      "temperature": 0.3,
      "maxTokens": 2000
    }
  }
}
```

---

## 4. 数据库设计

### 4.1 事件存储表（event_store）

```sql
CREATE TABLE event_store (
    event_id           VARCHAR(64)   NOT NULL COMMENT '全局唯一事件ID',
    event_type         VARCHAR(64)   NOT NULL COMMENT '事件类型',
    event_version      VARCHAR(16)   NOT NULL COMMENT '事件Schema版本',
    schema_id          VARCHAR(64)   NOT NULL COMMENT 'Schema注册中心分配的ID',
    aggregate_root_id  VARCHAR(64)   NOT NULL COMMENT '聚合根ID',
    aggregate_root_type VARCHAR(32)  NOT NULL COMMENT '聚合根类型',
    tenant_id          VARCHAR(32)   NULL     COMMENT '租户ID',
    user_id            VARCHAR(32)   NOT NULL COMMENT '用户ID',
    student_id         VARCHAR(32)   NULL     COMMENT '学生ID',
    event_timestamp    DATETIME(3)   NOT NULL COMMENT '事件发生时间(UTC毫秒精度)',
    stored_timestamp   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '入库时间',
    payload            JSON          NOT NULL COMMENT '完整事件JSON(含信封和payload)',
    payload_hash       VARCHAR(64)   NOT NULL COMMENT 'payload的SHA-256哈希(去重用)',
    sequence_number    BIGINT        NOT NULL AUTO_INCREMENT COMMENT '全局单调递增序列号',
    PRIMARY KEY (event_id),
    UNIQUE KEY uk_seq (sequence_number),
    UNIQUE KEY uk_payload_hash (payload_hash),
    KEY idx_aggregate_time (aggregate_root_id, event_timestamp),
    KEY idx_type_time (event_type, event_timestamp),
    KEY idx_user_time (user_id, event_timestamp),
    KEY idx_student_time (student_id, event_timestamp),
    KEY idx_tenant_time (tenant_id, event_timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='领域事件存储表(事件溯源核心表)';
```

### 4.2 聚合根快照表（aggregate_snapshot）

```sql
CREATE TABLE aggregate_snapshot (
    snapshot_id         BIGINT        NOT NULL AUTO_INCREMENT,
    aggregate_root_id   VARCHAR(64)   NOT NULL COMMENT '聚合根ID',
    aggregate_root_type VARCHAR(32)   NOT NULL COMMENT '聚合根类型',
    snapshot_version    INT           NOT NULL COMMENT '快照版本号(递增)',
    snapshot_data       JSON          NOT NULL COMMENT '聚合根状态快照JSON',
    event_sequence      BIGINT        NOT NULL COMMENT '快照对应的最大事件序列号',
    created_at          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (snapshot_id),
    KEY idx_aggregate_ver (aggregate_root_id, snapshot_version DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='聚合根快照表';
```

### 4.3 Schema 注册表（schema_registry）

```sql
CREATE TABLE schema_registry (
    schema_id          VARCHAR(64)   NOT NULL COMMENT 'Schema唯一标识',
    event_type         VARCHAR(64)   NOT NULL COMMENT '事件类型',
    version_major      INT           NOT NULL COMMENT '主版本号',
    version_minor      INT           NOT NULL COMMENT '次版本号',
    version_patch      INT           NOT NULL COMMENT '补丁版本号',
    schema_definition  JSON          NOT NULL COMMENT 'JSON Schema定义',
    compatibility_mode VARCHAR(16)   NOT NULL DEFAULT 'BACKWARD' COMMENT '兼容模式',
    status             VARCHAR(16)   NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE/DEPRECATED/RETIRED',
    registered_by      VARCHAR(32)   NOT NULL COMMENT '注册人',
    registered_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    deprecated_at      DATETIME(3)   NULL,
    description        TEXT          NULL     COMMENT 'Schema描述说明',
    PRIMARY KEY (schema_id),
    UNIQUE KEY uk_event_ver (event_type, version_major, version_minor, version_patch),
    KEY idx_event_type (event_type),
    KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='事件Schema注册中心';
```

### 4.4 消费者位移表（consumer_offset）

```sql
CREATE TABLE consumer_offset (
    consumer_group    VARCHAR(64)   NOT NULL COMMENT '消费者组名称',
    event_type_filter VARCHAR(64)   NOT NULL DEFAULT '*' COMMENT '订阅事件类型(*=全部)',
    last_consumed_seq BIGINT        NOT NULL DEFAULT 0 COMMENT '最后消费的事件序列号',
    last_consumed_at  DATETIME(3)   NULL     COMMENT '最后消费时间',
    last_acked_seq    BIGINT        NOT NULL DEFAULT 0 COMMENT '最后ACK的序列号',
    status            VARCHAR(16)   NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE/PAUSED',
    updated_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (consumer_group, event_type_filter)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='消费者位移记录表';
```

### 4.5 死信队列表（event_dead_letter）

```sql
CREATE TABLE event_dead_letter (
    id              BIGINT        NOT NULL AUTO_INCREMENT,
    event_id        VARCHAR(64)   NOT NULL COMMENT '原始事件ID',
    event_type      VARCHAR(64)   NOT NULL,
    payload         JSON          NOT NULL COMMENT '原始事件完整内容',
    consumer_group  VARCHAR(64)   NOT NULL COMMENT '消费者组',
    fail_count      INT           NOT NULL DEFAULT 0 COMMENT '累计失败次数',
    last_error      TEXT          NULL     COMMENT '最后错误信息',
    last_failed_at  DATETIME(3)   NULL,
    status          VARCHAR(16)   NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/RETRYING/ABANDONED/RESOLVED',
    created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    resolved_at     DATETIME(3)   NULL,
    resolved_by     VARCHAR(32)   NULL,
    resolution_note TEXT          NULL,
    PRIMARY KEY (id),
    KEY idx_event (event_id),
    KEY idx_consumer_status (consumer_group, status),
    KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='事件死信队列';
```

---

## 5. Schema 注册中心详细设计

### 5.1 Schema 兼容性策略

| 兼容模式 | 说明 | 适用场景 |
| --- | --- | --- |
| BACKWARD | 新Schema能读取旧版本数据 | 新增可选字段（最常用，默认模式） |
| FORWARD | 旧Schema能读取新版本数据 | 删除可选字段 |
| FULL | 同时满足 BACKWARD 和 FORWARD | 同时新增可选字段并设置默认值 |
| NONE | 无兼容性约束 | 仅开发/测试环境 |

### 5.2 Schema 版本演进规则

```
修改类型决策：
├── 新增可选字段（有默认值/null） → PATCH +1  (v1.0.0 → v1.0.1)
├── 新增必填字段（提供默认值）    → MINOR +1  (v1.0.0 → v1.1.0)
├── 删除字段                     → MINOR +1  (v1.0.0 → v1.1.0)
├── 字段类型变更                 → MAJOR +1  (v1.0.0 → v2.0.0)
└── 字段语义变更                 → MAJOR +1  (v1.0.0 → v2.0.0)
```

### 5.3 Schema 注册 API

#### 注册新 Schema

```
POST /api/v1/schema-registry/schemas
Content-Type: application/json

{
  "eventType": "AnswerSubmittedEvent",
  "versionMajor": 2,
  "versionMinor": 1,
  "versionPatch": 0,
  "compatibilityMode": "BACKWARD",
  "schemaDefinition": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "required": ["answerId", "questionId", "studentAnswer", "submittedAt"],
    "properties": {
      "answerId": { "type": "string", "pattern": "^ans_" },
      "questionId": { "type": "string" },
      "questionType": {
        "type": "string",
        "enum": ["MULTIPLE_CHOICE", "FILL_BLANK", "TRUE_FALSE", "SHORT_ANSWER", "ESSAY"]
      },
      "studentAnswer": { "type": ["string", "array", "object"] },
      "submittedAt": { "type": "string", "format": "date-time" },
      "timeSpentMs": { "type": "integer", "minimum": 0 },
      "attemptNumber": { "type": "integer", "minimum": 1 },
      "hintsUsed": { "type": "integer", "minimum": 0, "default": 0 },
      "inputMethod": {
        "type": "string",
        "enum": ["TAP", "TYPE", "VOICE", "HANDWRITE", "PHOTO"]
      },
      "knowledgePoints": {
        "type": "array",
        "items": { "type": "string" }
      },
      "chapterCode": { "type": "string" },
      "difficulty": { "type": "integer", "minimum": 1, "maximum": 5 },
      "isFromMistakeReview": { "type": "boolean", "default": false }
    }
  },
  "description": "学生提交答题事件 v2.1.0 - 新增 inputMethod 字段"
}
```

**成功响应**：

```json
{
  "code": 0,
  "data": {
    "schemaId": "sch_answer_submitted_v2_1_0",
    "status": "ACTIVE",
    "compatibilityCheck": {
      "previousVersion": "2.0.0",
      "result": "COMPATIBLE",
      "details": "新增可选字段 inputMethod，向后兼容"
    }
  }
}
```

**兼容性校验失败响应**：

```json
{
  "code": 40901,
  "message": "Schema兼容性校验失败",
  "data": {
    "result": "INCOMPATIBLE",
    "conflicts": [
      {
        "type": "FIELD_TYPE_CHANGED",
        "field": "studentAnswer",
        "detail": "字段类型从 string 变更为 object，不满足 BACKWARD 兼容"
      }
    ],
    "suggestion": "请提升 MAJOR 版本号并走破坏性变更迁移流程"
  }
}
```

#### 查询 Schema

```
GET /api/v1/schema-registry/schemas?eventType=AnswerSubmittedEvent&latest=true

GET /api/v1/schema-registry/schemas/{schemaId}

GET /api/v1/schema-registry/schemas?eventType=AnswerSubmittedEvent&version=2.1.0
```

#### 废弃 Schema

```
DELETE /api/v1/schema-registry/schemas/{schemaId}?deprecate=true
```

---

## 6. 事件发布 API 设计

### 6.1 发布单个事件

```
POST /api/v1/events/publish
Content-Type: application/json
X-Source-Service: question_service

{
  "eventType": "AnswerSubmittedEvent",
  "schemaVersion": "2.1.0",
  "aggregateRootId": "stu_100234_session_20260729_001",
  "aggregateRootType": "LearningSession",
  "correlationId": "corr_abc123",
  "payload": {
    "answerId": "ans_20260729_000001",
    "questionId": "q_math_001234",
    "questionType": "MULTIPLE_CHOICE",
    "studentAnswer": "B",
    "submittedAt": "2026-07-29T00:36:10.000Z",
    "timeSpentMs": 45000,
    "attemptNumber": 1,
    "hintsUsed": 1,
    "inputMethod": "TAP",
    "knowledgePoints": ["kp_algebra_linear_eq"],
    "chapterCode": "MATH_G7_CH3_S2",
    "difficulty": 3,
    "isFromMistakeReview": false
  }
}
```

**响应**：

```json
{
  "code": 0,
  "data": {
    "eventId": "evt_20260729_000123456",
    "sequenceNumber": 9876543,
    "storedAt": "2026-07-29T00:36:12.130Z",
    "schemaValidation": "PASSED",
    "consumerNotified": 5
  }
}
```

### 6.2 批量发布事件

```
POST /api/v1/events/publish-batch
Content-Type: application/json

{
  "events": [
    { "eventType": "AnswerSubmittedEvent", ... },
    { "eventType": "AnswerGradedEvent", ... },
    { "eventType": "MistakeAddedEvent", ... }
  ],
  "atomic": true
}
```

批量发布支持原子模式（`atomic: true`），所有事件要么全部成功写入，要么全部回滚。

### 6.3 查询事件

```
# 按聚合根查询事件流
GET /api/v1/events?aggregateRootId=stu_100234_session_20260729_001

# 按时间范围和事件类型查询
GET /api/v1/events?eventType=AnswerSubmittedEvent&from=2026-07-29T00:00:00Z&to=2026-07-29T23:59:59Z&limit=100

# 按学生ID查询
GET /api/v1/events?studentId=stu_100234&eventType=MistakeAddedEvent&from=2026-07-01T00:00:00Z

# 获取事件序列号之后的事件（增量拉取）
GET /api/v1/events?afterSequence=9876543&limit=500
```

---

## 7. 事件消费 API 设计

### 7.1 拉取模式消费

```
# 注册消费者组
POST /api/v1/event-bus/consumers
{
  "consumerGroup": "recommendation_engine",
  "eventTypes": ["AnswerGradedEvent", "MistakeAddedEvent", "LearningSessionEndedEvent"],
  "config": {
    "maxBatchSize": 100,
    "maxWaitMs": 5000,
    "autoAck": false
  }
}
```

```
# 拉取事件
GET /api/v1/event-bus/consumers/recommendation_engine/events?maxCount=100

响应:
{
  "code": 0,
  "data": {
    "events": [...],
    "batchId": "batch_001",
    "fromSequence": 9876544,
    "toSequence": 9876643
  }
}
```

```
# 确认消费
POST /api/v1/event-bus/consumers/recommendation_engine/ack
{
  "batchId": "batch_001",
  "upToSequence": 9876643
}
```

```
# 否认消费（消息将重试）
POST /api/v1/event-bus/consumers/recommendation_engine/nack
{
  "batchId": "batch_001",
  "reason": "Downstream service unavailable",
  "retryDelayMs": 30000
}
```

### 7.2 推送模式消费（Webhook）

```
# 注册 Webhook 消费者
POST /api/v1/event-bus/webhooks
{
  "consumerGroup": "analytics_pipeline",
  "eventTypes": ["*"],
  "webhookUrl": "https://analytics.primetop.internal/api/v1/events/ingest",
  "secret": "whsec_xxx",
  "config": {
    "retryPolicy": "EXPONENTIAL",
    "maxRetries": 5,
    "initialDelayMs": 1000,
    "maxDelayMs": 60000,
    "timeout": 10000,
    "batchMode": true,
    "batchSize": 50
  }
}
```

推送时携带签名头：

```
X-EventPrime-Signature: sha256=abcdef...
X-EventPrime-Timestamp: 1722218172000
X-EventPrime-Batch-Id: batch_001
Content-Type: application/json
```

---

## 8. 事件溯源核心逻辑

### 8.1 事件写入流程

```
                    ┌──────────────────────────────────────────┐
                    │          事件发布请求                       │
                    └──────────────────┬───────────────────────┘
                                       ▼
                    ┌──────────────────────────────────────────┐
                    │  1. Schema 校验                           │
                    │  - 从Schema注册中心获取最新Schema           │
                    │  - 校验payload是否符合Schema定义            │
                    │  - 校验版本兼容性                          │
                    └──────────────────┬───────────────────────┘
                                       │ 通过
                                       ▼
                    ┌──────────────────────────────────────────┐
                    │  2. 构建完整事件信封                        │
                    │  - 生成eventId、timestamp、sequence        │
                    │  - 填充信封元数据（userId/studentId等）     │
                    │  - 计算payload_hash                       │
                    └──────────────────┬───────────────────────┘
                                       ▼
                    ┌──────────────────────────────────────────┐
                    │  3. 幂等性检查                             │
                    │  - 检查eventId是否已存在                   │
                    │  - 检查payload_hash是否重复                │
                    └──────────────────┬───────────────────────┘
                                       │ 非重复
                                       ▼
                    ┌──────────────────────────────────────────┐
                    │  4. 写入事件存储(MySQL)                    │
                    │  - INSERT INTO event_store                │
                    │  - 获取全局sequence_number                 │
                    └──────────────────┬───────────────────────┘
                                       │ 成功
                                       ▼
                    ┌──────────────────────────────────────────┐
                    │  5. 异步分发到Kafka                       │
                    │  - 按eventType路由到对应Topic              │
                    │  - 失败则记录到重试队列                     │
                    └──────────────────┬───────────────────────┘
                                       ▼
                    ┌──────────────────────────────────────────┐
                    │  6. 返回发布结果                           │
                    │  - eventId, sequenceNumber                │
                    └──────────────────────────────────────────┘
```

### 8.2 聚合根状态重建

通过事件回放重建聚合根状态的流程：

```java
/**
 * 聚合根状态重建器
 */
public class AggregateRebuilder<T extends AggregateRoot> {

    /**
     * 从事件存储重建聚合根状态
     *
     * @param aggregateRootId   聚合根ID
     * @param aggregateClass    聚合根类型
     * @param pointInTime       重建到的时间点（null=最新状态）
     * @return 重建后的聚合根状态
     */
    public T rebuild(String aggregateRootId, Class<T> aggregateClass,
                     Instant pointInTime) {
        // 1. 查找最近的快照
        AggregateSnapshot snapshot = snapshotRepository
            .findLatestBefore(aggregateRootId, pointInTime);

        T aggregate = aggregateClass.getDeclaredConstructor().newInstance();
        long fromSequence = 0L;

        if (snapshot != null) {
            // 从快照恢复
            aggregate.restoreFromSnapshot(snapshot.getSnapshotData());
            fromSequence = snapshot.getEventSequence() + 1;
        }

        // 2. 从事件存储加载快照之后的事件
        List<DomainEvent> events = eventStoreRepository
            .findByAggregateRootIdAndSequenceAfter(
                aggregateRootId,
                fromSequence,
                pointInTime != null ? pointInTime : Instant.now()
            );

        // 3. 按顺序重放事件
        for (DomainEvent event : events) {
            aggregate.apply(event);
        }

        return aggregate;
    }

    /**
     * 自动创建快照（每N个事件自动创建一次）
     */
    @Scheduled(every = 5, unit = "minutes")
    public void autoSnapshot() {
        List<String> hotAggregates = identifyHotAggregates();
        for (String aggregateRootId : hotAggregates) {
            long eventCount = eventStoreRepository
                .countEventsSinceLastSnapshot(aggregateRootId);
            if (eventCount >= SNAPSHOT_THRESHOLD) {
                // 重建最新状态并保存为快照
                AggregateRoot aggregate = rebuild(aggregateRootId, ...);
                snapshotRepository.save(aggregate.createSnapshot());
            }
        }
    }
}
```

### 8.3 学习会话聚合根示例

```java
/**
 * 学习会话聚合根 - 通过事件溯源重建状态
 */
public class LearningSessionAggregate extends AggregateRoot {

    private String sessionId;
    private String studentId;
    private SessionStatus status;
    private Instant startedAt;
    private Instant endedAt;
    private long effectiveDurationMs;
    private int questionsAnswered;
    private int correctCount;
    private List<String> knowledgePointsCovered;
    private List<String> mistakeIds;

    @Override
    public void apply(DomainEvent event) {
        switch (event) {
            case LearningSessionStartedEvent e -> handleStarted(e);
            case LearningSessionPausedEvent e -> handlePaused(e);
            case LearningSessionResumedEvent e -> handleResumed(e);
            case AnswerSubmittedEvent e -> handleAnswerSubmitted(e);
            case AnswerGradedEvent e -> handleAnswerGraded(e);
            case MistakeAddedEvent e -> handleMistakeAdded(e);
            case LearningSessionEndedEvent e -> handleEnded(e);
            default -> { /* 未知事件类型，忽略或记录日志 */ }
        }
    }

    private void handleAnswerGraded(AnswerGradedEvent event) {
        if (event.getPayload().isCorrect()) {
            correctCount++;
        }
    }

    private void handleMistakeAdded(MistakeAddedEvent event) {
        mistakeIds.add(event.getPayload().getMistakeId());
    }

    private void handleEnded(LearningSessionEndedEvent event) {
        this.status = SessionStatus.ENDED;
        this.endedAt = event.getTimestamp();
        this.effectiveDurationMs = event.getPayload().getEffectiveDurationMs();
    }

    // 快照创建与恢复
    public JsonObject createSnapshot() {
        return Json.createObjectBuilder()
            .add("sessionId", sessionId)
            .add("studentId", studentId)
            .add("status", status.name())
            .add("startedAt", startedAt.toString())
            .add("questionsAnswered", questionsAnswered)
            .add("correctCount", correctCount)
            .add("effectiveDurationMs", effectiveDurationMs)
            .build();
    }

    public void restoreFromSnapshot(JsonObject snapshot) {
        this.sessionId = snapshot.getString("sessionId");
        this.studentId = snapshot.getString("studentId");
        this.status = SessionStatus.valueOf(snapshot.getString("status"));
        // ... 其他字段
    }
}
```

---

## 9. 事件分发总线设计

### 9.1 Kafka Topic 规划

```
Topic 命名规范: primetop.events.{category}

Category 映射:
├── primetop.events.session      ← SessionEvent
├── primetop.events.answer       ← AnswerEvent
├── primetop.events.content      ← ContentEvent
├── primetop.events.ai           ← AIInteractionEvent
├── primetop.events.mistake      ← MistakeEvent
├── primetop.events.plan         ← PlanEvent
├── primetop.events.engagement   ← EngagementEvent
└── primetop.events.all          ← 全量事件（用于数据仓库等）
```

每个 Topic 配置：
- Partition 数：按 `aggregateRootId` hash 分区，初始 12 个分区
- Replication Factor：3
- Retention：7 天（事件存储为持久化源头，Kafka 仅做分发通道）
- Cleanup Policy：delete

### 9.2 消费者重试策略

```
重试层级设计：

Layer 1: 即时重试（消费失败后立即重试）
  ├── 最大次数: 3
  └── 间隔: 100ms, 500ms, 2s

Layer 2: 延迟重试（发送到延迟Topic）
  ├── 最大次数: 5
  └── 间隔: 30s, 1min, 5min, 15min, 1h（指数退避）

Layer 3: 死信队列（超过重试上限后入库）
  ├── 存储: event_dead_letter 表
  ├── 告警: 通知运维 + 创建工单
  └── 人工处理: 管理后台提供重放/丢弃操作
```

### 9.3 消费者幂等保障

```java
/**
 * 幂等消费者基类
 */
public abstract class IdempotentConsumer<T extends DomainEvent> {

    @Autowired
    private ProcessedEventRepository processedEventRepo;

    public void handle(T event) {
        // 1. 幂等检查 - 是否已处理过该事件
        if (processedEventRepo.exists(event.getEventId())) {
            log.info("事件已处理，跳过: eventId={}", event.getEventId());
            return;
        }

        // 2. 业务处理
        try {
            doHandle(event);
            // 3. 标记为已处理
            processedEventRepo.markProcessed(
                event.getEventId(),
                event.getEventType(),
                getConsumerGroup(),
                Instant.now()
            );
        } catch (Exception e) {
            log.error("事件处理失败: eventId={}", event.getEventId(), e);
            throw e; // 触发重试机制
        }
    }

    protected abstract void doHandle(T event);
    protected abstract String getConsumerGroup();
}
```

### 9.4 Processed Event 记录表

```sql
CREATE TABLE processed_event (
    event_id        VARCHAR(64)   NOT NULL COMMENT '事件ID',
    event_type      VARCHAR(64)   NOT NULL,
    consumer_group  VARCHAR(64)   NOT NULL,
    processed_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (event_id, consumer_group),
    KEY idx_consumer_time (consumer_group, processed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='已处理事件记录(幂等保障)';
```

> **清理策略**：每天定时清理 7 天前的记录，防止表无限膨胀。

---

## 10. 事件回放（Replay）设计

### 10.1 回放场景

| 场景 | 说明 |
| --- | --- |
| 新消费者上线 | 新增下游服务，需要消费历史事件构建初始状态 |
| 数据修复 | 消费者Bug导致数据错误，修复后重新消费 |
| 读模型重建 | Projection数据损坏或Schema变更，需要从事件重建 |
| 审计/分析 | 特定时间段的事件重新分析 |

### 10.2 回放 API

```
# 创建回放任务
POST /api/v1/events/replay
{
  "consumerGroup": "new_analytics_service",
  "fromTime": "2026-07-01T00:00:00Z",
  "toTime": "2026-07-31T23:59:59Z",
  "eventTypes": ["AnswerGradedEvent", "LearningSessionEndedEvent"],
  "speed": "MAX",
  "filter": {
    "studentIds": null,
    "subjects": ["MATH", "PHYSICS"],
    "grades": [7, 8, 9]
  }
}
```

**响应**：

```json
{
  "code": 0,
  "data": {
    "replayTaskId": "replay_20260729_001",
    "status": "RUNNING",
    "totalEvents": 1250000,
    "processedEvents": 0,
    "estimatedDurationMin": 15,
    "progressUrl": "/api/v1/events/replay/replay_20260729_001/status"
  }
}
```

### 10.3 回放速率控制

```java
public class EventReplayExecutor {

    // 速率模式
    public enum ReplaySpeed {
        MAX(0),           // 最快速度，无限制
        FAST(10_000),     // 10000 events/sec
        NORMAL(5_000),    // 5000 events/sec
        SLOW(1_000),      // 1000 events/sec
        THROTTLED(100);   // 100 events/sec（安全模式）

        final int eventsPerSecond;
    }

    public void executeReplay(ReplayTask task) {
        long lastReportTime = System.currentTimeMillis();
        int batchSize = 500;

        try (Cursor<DomainEvent> cursor = eventStoreRepository
                .streamEvents(task.getFromTime(), task.getToTime(),
                              task.getEventTypes(), task.getFilter())) {

            RateLimiter limiter = RateLimiter.create(task.getSpeed().eventsPerSecond);

            while (cursor.hasNext()) {
                List<DomainEvent> batch = cursor.next(batchSize);

                for (DomainEvent event : batch) {
                    limiter.acquire();
                    eventBus.publishToConsumer(task.getConsumerGroup(), event);
                    task.incrementProcessed();
                }

                // 定期更新进度
                if (System.currentTimeMillis() - lastReportTime > 5000) {
                    task.updateProgress();
                    lastReportTime = System.currentTimeMillis();
                }
            }

            task.markCompleted();
        }
    }
}
```

---

## 11. 关键 Projection（读模型）设计

### 11.1 学生学习汇总投影

```sql
-- 投影表：学生学习每日汇总
CREATE TABLE projection_student_daily_summary (
    student_id        VARCHAR(32) NOT NULL,
    stat_date         DATE        NOT NULL,
    subject           VARCHAR(16) NOT NULL,
    total_sessions    INT         DEFAULT 0 COMMENT '学习会话数',
    total_duration_ms BIGINT      DEFAULT 0 COMMENT '总学习时长',
    effective_duration_ms BIGINT   DEFAULT 0 COMMENT '有效学习时长',
    questions_answered INT        DEFAULT 0 COMMENT '答题总数',
    correct_count     INT         DEFAULT 0 COMMENT '正确数',
    mistakes_added    INT         DEFAULT 0 COMMENT '新增错题数',
    mistakes_reviewed INT         DEFAULT 0 COMMENT '复习错题数',
    ai_interactions   INT         DEFAULT 0 COMMENT 'AI交互次数',
    chapters_completed INT        DEFAULT 0 COMMENT '完成章节数',
    last_updated_seq  BIGINT      DEFAULT 0 COMMENT '最后投影的事件序列号',
    updated_at        DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (student_id, stat_date, subject),
    KEY idx_date_subject (stat_date, subject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生学习每日汇总(Projection)';
```

### 11.2 投影构建器

```java
/**
 * 学生学习每日汇总 Projection 构建器
 */
@ConsumerGroup("projection_student_daily_summary")
@EventTypes({
    "LearningSessionEndedEvent",
    "AnswerGradedEvent",
    "MistakeAddedEvent",
    "MistakeReviewedEvent",
    "AIMessageSentEvent",
    "ChapterStudyCompletedEvent"
})
public class StudentDailySummaryProjection extends IdempotentConsumer<DomainEvent> {

    @Override
    protected void doHandle(DomainEvent event) {
        String studentId = event.getStudentId();
        LocalDate statDate = event.getTimestamp().atZone(ZoneId.of("Asia/Shanghai")).toLocalDate();
        String subject = event.getSubject() != null ? event.getSubject() : "GENERAL";

        switch (event) {
            case LearningSessionEndedEvent e -> {
                var payload = e.getPayload();
                upsertSummary(studentId, statDate, subject, summary -> {
                    summary.incrementTotalSessions();
                    summary.addTotalDuration(payload.getActualDurationMs());
                    summary.addEffectiveDuration(payload.getEffectiveDurationMs());
                    summary.addQuestionsAnswered(payload.getQuestionsAnswered());
                    summary.addCorrectCount(
                        (int)(payload.getQuestionsAnswered() * payload.getCorrectRate())
                    );
                });
            }
            case MistakeAddedEvent e -> {
                upsertSummary(studentId, statDate, e.getSubject(), summary -> {
                    summary.incrementMistakesAdded();
                });
            }
            // ... 其他事件类型
        }

        // 更新最后投影序列号
        updateProjectionSequence(studentId, statDate, subject, event.getSequenceNumber());
    }

    private void upsertSummary(String studentId, LocalDate date,
                                String subject, Consumer<SummaryUpdater> updater) {
        // INSERT ON DUPLICATE KEY UPDATE 实现幂等upsert
        summaryRepository.upsert(studentId, date, subject, updater);
    }
}
```

---

## 12. 错误处理

### 12.1 错误码定义

| 错误码 | HTTP | 说明 | 处理方式 |
| --- | --- | --- | --- |
| EVT_40001 | 400 | 事件payload格式错误 | 调用方修复payload |
| EVT_40002 | 400 | 缺少必填字段 | 调用方补全字段 |
| EVT_40401 | 404 | Schema未找到 | 检查eventType是否正确 |
| EVT_40901 | 409 | Schema兼容性校验失败 | 调整Schema变更或升级MAJOR版本 |
| EVT_40902 | 409 | 事件已存在（重复提交） | 幂等处理，直接返回成功 |
| EVT_40903 | 409 | Schema版本冲突 | 重新基于最新版本提交 |
| EVT_42201 | 422 | Schema校验失败 | 检查payload是否符合Schema定义 |
| EVT_42901 | 429 | 发布速率超限 | 调用方降速或使用批量接口 |
| EVT_50001 | 500 | 事件存储写入失败 | 重试，如持续失败则告警 |
| EVT_50002 | 500 | 分发通道异常 | 重试，事件已持久化不会丢失 |
| EVT_50301 | 503 | 回放任务资源不足 | 排队等待或降低速率 |

### 12.2 降级策略

```java
/**
 * 事件发布降级策略
 */
public class EventPublishFallbackHandler {

    /**
     * MySQL写入失败时的降级处理
     */
    public PublishResult handleStorageFailure(DomainEvent event, Exception cause) {
        // 1. 写入本地Fallback队列（Redis List或本地文件）
        try {
            fallbackQueue.push(event);
            log.warn("事件写入Fallback队列: eventId={}", event.getEventId());

            // 2. 后台Worker定期重试写入主存储
            fallbackRetryWorker.scheduleRetry(event.getEventId());

            return PublishResult.deferred(event.getEventId());
        } catch (Exception e) {
            // 3. Fallback也失败 → 紧急告警
            alertService.sendCritical(
                "EVENT_STORAGE_EMERGENCY",
                "事件存储和Fallback均失败，可能丢失数据: " + event.getEventId()
            );
            throw new EventStorageException("Critical: 无法存储事件", e);
        }
    }

    /**
     * Kafka分发失败时的降级处理
     */
    public void handleDispatchFailure(DomainEvent event, Exception cause) {
        // 事件已持久化到MySQL，Kafka分发失败不影响数据安全
        // 记录到分发重试表
        dispatchRetryRepository.save(new DispatchRetryRecord(
            event.getEventId(),
            event.getEventType(),
            Instant.now(),
            0
        ));

        // 分发Worker会定期扫描重试表
        log.warn("事件分发失败，已加入重试队列: eventId={}", event.getEventId());
    }
}
```

---

## 13. 性能优化

### 13.1 写入优化

| 策略 | 说明 |
| --- | --- |
| 批量写入 | 批量发布接口使用 `INSERT ... VALUES (),(),()` 批量插入 |
| 顺序写入 | event_store 表按 sequence_number 顺序追加，减少随机IO |
| 分区表 | 按月分区 `PARTITION BY RANGE (TO_DAYS(event_timestamp))` |
| 写缓冲 | MySQL `innodb_flush_log_at_trx_commit=2`（允许1s数据丢失换性能） |
| 异步分发 | Kafka分发为异步，不阻塞事件写入主流程 |

### 13.2 查询优化

```sql
-- 按月分区表DDL
ALTER TABLE event_store PARTITION BY RANGE (TO_DAYS(event_timestamp)) (
    PARTITION p202607 VALUES LESS THAN (TO_DAYS('2026-08-01')),
    PARTITION p202608 VALUES LESS THAN (TO_DAYS('2026-09-01')),
    PARTITION p202609 VALUES LESS THAN (TO_DAYS('2026-10-01')),
    -- ...
    PARTITION pmax VALUES LESS THAN MAXVALUE
);
```

### 13.3 快照策略

| 条件 | 触发快照 |
| --- | --- |
| 事件数阈值 | 聚合根累积事件超过 100 条 |
| 时间阈值 | 最近一次快照超过 24 小时 |
| 热点聚合 | 活跃会话每 6 小时一次 |

### 13.4 数据生命周期

```
事件数据生命周期管理:

event_store (MySQL)
├── 热数据: 最近3个月，MySQL主库
├── 温数据: 3-12个月，迁移到冷存储表(event_store_archive)
└── 冷数据: 12个月以上，导出到对象存储(Parquet格式)，从MySQL删除

aggregate_snapshot
├── 保留最新版本快照
└── 历史快照保留30天后清理

processed_event
├── 保留7天
└── 每日定时清理

consumer_offset
├── 永久保留（活跃消费者）
└── 非活跃消费者90天后归档
```

---

## 14. 监控与运维

### 14.1 关键监控指标

| 指标 | 类型 | 告警阈值 |
| --- | --- | --- |
| `event.publish.latency_p99` | 发布延迟 | > 50ms |
| `event.publish.error_rate` | 发布错误率 | > 1% |
| `event.store.write_qps` | 存储写入QPS | > 5000（容量规划参考） |
| `event.consumer.lag` | 消费延迟（积压事件数） | > 10000 |
| `event.consumer.error_rate` | 消费错误率 | > 5% |
| `event.dead_letter.count` | 死信队列堆积 | > 100 |
| `schema.validation.failure_rate` | Schema校验失败率 | > 0.1% |
| `replay.task.duration` | 回放任务耗时 | > 预估时间×2 |

### 14.2 健康检查端点

```
GET /api/v1/events/health

响应:
{
  "status": "HEALTHY",
  "components": {
    "eventStore": { "status": "UP", "latencyMs": 2 },
    "schemaRegistry": { "status": "UP", "activeSchemas": 47 },
    "kafkaProducer": { "status": "UP" },
    "consumerLag": {
      "recommendation_engine": 0,
      "analytics_pipeline": 12,
      "notification_service": 0
    },
    "deadLetterQueue": {
      "pendingCount": 3,
      "oldestPending": "2026-07-29T00:10:00Z"
    }
  }
}
```

---

## 15. 安全与合规

### 15.1 访问控制

| 操作 | 所需权限 |
| --- | --- |
| 发布事件 | `event:publish` |
| 查询事件 | `event:read` |
| 注册/修改Schema | `schema:manage` |
| 创建回放任务 | `event:replay` |
| 管理死信队列 | `deadletter:manage` |
| 管理消费者组 | `consumer:manage` |

### 15.2 数据脱敏

事件payload中的敏感字段在写入前进行脱敏：

```java
@SensitiveField(fields = {"studentName", "phone", "ipAddress"})
public class EventPublishInterceptor {

    public DomainEvent sanitize(DomainEvent event) {
        JsonObject payload = event.getPayload();
        JsonObjectBuilder sanitized = Json.createObjectBuilder();

        for (String key : payload.keySet()) {
            JsonValue value = payload.get(key);
            if (sensitiveFields.contains(key)) {
                sanitized.add(key, DesensitizationUtil.mask(value));
            } else {
                sanitized.add(key, value);
            }
        }

        return event.withPayload(sanitized.build());
    }
}
```

### 15.3 未成年人数据保护

- 事件中的学生ID在非授权消费场景下进行假名化处理
- 家长可见范围内的事件与教师可见范围隔离
- 数据导出时自动过滤敏感字段

---

## 16. 客户端集成 SDK 设计

### 16.1 Java SDK 使用示例

```java
// 初始化
EventBusClient client = EventBusClient.builder()
    .endpoint("https://events.primetop.internal")
    .authToken(serviceToken)
    .source("question_service")
    .build();

// 发布事件
AnswerSubmittedEvent event = AnswerSubmittedEvent.builder()
    .aggregateRootId("stu_100234_session_20260729_001")
    .aggregateRootType("LearningSession")
    .correlationId(MDC.get("traceId"))
    .payload(payloadBuilder -> payloadBuilder
        .answerId("ans_20260729_000001")
        .questionId("q_math_001234")
        .questionType(QuestionType.MULTIPLE_CHOICE)
        .studentAnswer("B")
        .timeSpentMs(45000)
        .build())
    .publish();

// 消费事件
client.subscribe("recommendation_engine")
    .eventTypes("AnswerGradedEvent", "MistakeAddedEvent")
    .handler(event -> {
        log.info("收到事件: type={}, studentId={}",
            event.getEventType(), event.getStudentId());
        recommendationService.process(event);
    })
    .start();
```

### 16.2 Python SDK（数据分析场景）

```python
from primetop_event_bus import EventBusClient, ConsumerConfig

client = EventBusClient(
    endpoint="https://events.primetop.internal",
    auth_token=os.environ["EVENT_BUS_TOKEN"],
    source="analytics_service"
)

# 消费事件
config = ConsumerConfig(
    consumer_group="analytics_pipeline",
    event_types=["LearningSessionEndedEvent", "AnswerGradedEvent"],
    batch_size=100,
    auto_ack=False
)

for batch in client.consume(config):
    for event in batch.events:
        process_learning_event(event)
    batch.ack()
```

---

## 17. 部署架构

```
                    ┌─────────────────────────┐
                    │      Load Balancer       │
                    │    (Nginx / ALB)         │
                    └──────────┬──────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │ Event API    │ │ Event API    │ │ Event API    │
     │ Instance #1  │ │ Instance #2  │ │ Instance #3  │
     └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
            │                │                │
            └────────────────┼────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     ┌──────────────┐ ┌───────────┐ ┌───────────────┐
     │  MySQL       │ │  Redis    │ │   Kafka       │
     │  (主从)       │ │ (缓存)     │ │ (3 Broker)    │
     │  event_store │ │           │ │ 事件分发       │
     │  snapshots   │ │           │ │               │
     │  schema_reg  │ │           │ │               │
     └──────────────┘ └───────────┘ └───────┬───────┘
                                           │
                              ┌────────────┼────────────┐
                              ▼            ▼            ▼
                     ┌──────────┐ ┌──────────┐ ┌──────────────┐
                     │推荐引擎   │ │分析管道   │ │通知服务       │
                     │(Consumer)│ │(Consumer)│ │(Consumer)    │
                     └──────────┘ └──────────┘ └──────────────┘
```

### 容量规划参考

| 组件 | MVP阶段 | V1.5阶段 | V2.0阶段 |
| --- | --- | --- | --- |
| Event API 实例 | 2 (2C4G) | 4 (4C8G) | 8 (4C8G) |
| MySQL | 1主1从 (8C16G, 500GB SSD) | 1主2从 (16C32G, 2TB SSD) | 分库分表 |
| Redis | 1 (4C8G) | 1主1从 (8C16G) | 集群模式 |
| Kafka Broker | 3 (4C8G) | 3 (8C16G) | 5 (8C16G) |
| 日事件量预估 | ~50万/天 | ~500万/天 | ~2000万/天 |

---

## 18. 实施路线

| 阶段 | 范围 | 依赖 |
| --- | --- | --- |
| Phase 1: Schema注册中心 + 事件存储 | Schema管理、事件写入、基础查询 | MySQL, Redis |
| Phase 2: Kafka分发 + 消费者SDK | 事件分发、消费者SDK、幂等保障 | Kafka集群 |
| Phase 3: 事件回放 + Projection | 回放引擎、Projection框架 | Phase 1+2 完成 |
| Phase 4: 快照 + 性能优化 | 自动快照、分区表、冷热分离 | Phase 1+2+3 运行稳定 |
| Phase 5: 运维监控 + 告警 | Dashboard、告警规则、运维工具 | 全部完成后 |

---

## 19. 附录

### 19.1 事件类型完整清单（首期）

| 事件类型 | 版本 | 发布方 | 主要消费者 |
| --- | --- | --- | --- |
| LearningSessionStartedEvent | 1.0.0 | 学习服务 | 分析、推荐、通知 |
| LearningSessionEndedEvent | 1.0.0 | 学习服务 | 分析、推荐、通知、积分 |
| AnswerSubmittedEvent | 2.1.0 | 题目服务 | 判题、分析、推荐 |
| AnswerGradedEvent | 1.2.0 | 判题引擎 | 错题、分析、推荐、知识追踪 |
| MistakeAddedEvent | 1.1.0 | 错题服务 | 复习调度、分析 |
| MistakeReviewedEvent | 1.0.0 | 错题服务 | 分析、推荐 |
| MistakeMasteredEvent | 1.0.0 | 错题服务 | 分析、积分 |
| ChapterStudyStartedEvent | 1.0.0 | 内容服务 | 分析、推荐 |
| ChapterStudyCompletedEvent | 1.0.0 | 内容服务 | 分析、推荐、积分 |
| AIMessageSentEvent | 1.1.0 | AI服务 | 分析、质量监控 |
| AIResponseReceivedEvent | 1.0.0 | AI服务 | 分析、质量监控 |
| AIFeedbackSubmittedEvent | 1.0.0 | AI服务 | 质量监控、RLHF |
| StudyPlanCreatedEvent | 1.0.0 | 规划服务 | 通知、分析 |
| TaskCompletedEvent | 1.0.0 | 规划服务 | 积分、分析、通知 |
| StreakUpdatedEvent | 1.0.0 | 积分服务 | 分析、通知 |
| BadgeUnlockedEvent | 1.0.0 | 积分服务 | 通知、分析 |

### 19.2 术语表

| 术语 | 说明 |
| --- | --- |
| Event Sourcing | 事件溯源模式，将状态变更存储为不可变事件序列 |
| CQRS | 命令查询职责分离，写入(命令)和读取(查询)使用不同模型 |
| Aggregate Root | DDD中的聚合根概念，是一组相关对象的统一入口 |
| Projection | 从事件流中派生的物化视图，用于高效查询 |
| At-Least-Once | 至少一次投递语义，消费者需实现幂等性 |
| Schema Evolution | Schema随时间演进的过程，需保证兼容性 |
