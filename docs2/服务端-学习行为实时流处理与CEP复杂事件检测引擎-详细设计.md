# 服务端-学习行为实时流处理与CEP复杂事件检测引擎 详细设计

## 1. 概述

### 1.1 模块定位

学习行为实时流处理与 CEP（Complex Event Processing）复杂事件检测引擎是 PrimeTop 平台的**实时智能感知中枢**。它位于事件采集层（统一用户行为埋点平台）和业务干预层（统一学习干预编排引擎）之间，负责从海量学习行为事件流中**实时检测有意义的时序模式**，并输出结构化的事件触发信号。

### 1.2 核心职责

| 职责 | 说明 |
| --- | --- |
| 事件流接入 | 消费 Kafka 中的学习行为事件，进行预处理和标准化 |
| 实时模式检测 | 基于预定义规则和 ML 模型，在时间窗口内检测行为模式 |
| 上下文增强 | 将事件流与用户画像、知识点信息等静态/慢变数据进行流式 Join |
| 模式事件输出 | 将检测到的复合事件输出到下游干预引擎和告警系统 |
| 规则动态管理 | 支持运营和教研人员通过配置界面动态增删检测规则 |
| 流处理监控 | 提供处理延迟、吞吐量、规则命中率等运维指标 |

### 1.3 依赖关系

```
┌─────────────────────────────────────────────────────────────┐
│                    上游数据源                                 │
├─────────────┬──────────────┬──────────────┬─────────────────┤
│ 用户行为    │ 答题事件     │ 学习会话     │ AI对话事件      │
│ 埋点平台    │ (练习/考试)  │ 事件         │                 │
└──────┬──────┴──────┬───────┴──────┬───────┴────────┬────────┘
       │             │              │                │
       ▼             ▼              ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│              Kafka 事件总线 (统一 Topic)                      │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│         CEP 复杂事件检测引擎 (本模块)                         │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │ 事件预处理│→ │ 模式检测引擎  │→ │ 复合事件输出层     │    │
│  │ & 标准化  │  │ (规则+ML)    │  │ (Kafka/HTTP)      │    │
│  └──────────┘  └──────────────┘  └────────────────────┘    │
│                       ↑                                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           上下文增强层 (流式 Join)                     │   │
│  │  用户画像 │ 知识点 │ 学习计划 │ 能力维度 │ 会话状态   │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────┬───────────────────────────────────────┘
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐
│ 统一学习干预 │ │ 告警系统 │ │ 数据仓库     │
│ 编排引擎     │ │ (钉钉/   ││ (ClickHouse) │
│              │ │  飞书)   ││              │
└──────────────┘ └──────────┘ └──────────────┘
```

### 1.4 与已有模块的边界

| 已有模块 | 本模块与其关系 |
| --- | --- |
| 统一用户行为埋点平台与事件流处理管线 | **上游**：负责事件采集、格式化和 Kafka 投递，本模块消费其产出 |
| 学习行为事件流与跨模块级联处理引擎 | **平行**：该模块处理单事件的级联业务逻辑（如答题→更新掌握度→触发推荐），本模块处理多事件的时序模式 |
| 统一学习干预编排与智能频控引擎 | **下游**：接收本模块输出的复合事件，决定是否执行干预及干预方式 |
| 学生学习会话疲劳度实时监测引擎 | **协作**：该模块可订阅本模块输出的"疲劳模式"事件；疲劳检测的部分计算逻辑可作为 CEP 规则注册到本模块 |
| 学生学习状态实时感知与会话质量动态评估引擎 | **协作**：该模块专注会话级质量评分，本模块提供跨会话、跨模块的行为模式检测 |

---

## 2. 数据模型

### 2.1 输入事件结构

所有上游事件统一遵循 `LearningEvent` 标准格式：

```json
{
  "eventId": "evt_20260712_0001_a3f8b2c1",
  "userId": "U100234",
  "sessionId": "S20260712001",
  "eventType": "ANSWER_SUBMITTED",
  "timestamp": 1720756800000,
  "clientTimestamp": 1720756799500,
  "source": "PRACTICE_MODULE",
  "version": "2.1.0",
  "payload": {
    "questionId": "Q58231",
    "subject": "MATH",
    "knowledgePointIds": ["KP1023", "KP1089"],
    "isCorrect": false,
    "timeCostMs": 45000,
    "difficulty": 0.65,
    "hintUsed": true,
    "answerType": "MULTIPLE_CHOICE"
  },
  "context": {
    "grade": "G7",
    "term": "2026春季",
    "textbookVersion": "人教版",
    "deviceType": "ANDROID",
    "networkType": "WIFI",
    "appVersion": "3.2.1"
  }
}
```

### 2.2 标准化事件类型枚举

```java
public enum LearningEventType {
    // ===== 答题类 =====
    ANSWER_SUBMITTED("答案提交"),
    ANSWER_CORRECT("答对"),
    ANSWER_WRONG("答错"),
    ANSWER_TIMEOUT("超时未答"),
    HINT_REQUESTED("请求提示"),
    ANSWER_MODIFIED("修改答案"),

    // ===== 学习类 =====
    CHAPTER_OPENED("打开章节"),
    CHAPTER_COMPLETED("完成章节"),
    VIDEO_PLAYED("播放视频"),
    VIDEO_PAUSED("暂停视频"),
    VIDEO_COMPLETED("视频播放完成"),
    KNOWLEDGE_VIEWED("查看知识点"),
    NOTE_SAVED("保存笔记"),

    // ===== 会话类 =====
    SESSION_STARTED("会话开始"),
    SESSION_ENDED("会话结束"),
    SESSION_PAUSED("会话暂停"),
    SESSION_RESUMED("会话恢复"),
    APP_BACKGROUND("应用进入后台"),
    APP_FOREGROUND("应用回到前台"),

    // ===== AI 交互类 =====
    AI_QUESTION_ASKED("AI提问"),
    AI_ANSWER_RECEIVED("AI回答接收"),
    AI_FOLLOWUP_ASKED("AI追问"),
    AI_FEEDBACK_SUBMITTED("AI反馈提交"),
    AI_ANSWER_RATED("AI回答评价"),

    // ===== 拍题类 =====
    PHOTO_SUBMITTED("拍照提交"),
    PHOTO_RECOGNIZED("拍照识别完成"),
    PHOTO_PARSE_COMPLETED("解析完成"),

    // ===== 导航类 =====
    PAGE_ENTERED("进入页面"),
    PAGE_EXITED("离开页面"),
    SEARCH_PERFORMED("搜索"),
    TAB_SWITCHED("切换Tab"),

    // ===== 社交类 =====
    STUDY_GROUP_JOINED("加入学习小组"),
    CHALLENGE_ENTERED("进入挑战赛"),
    ACHIEVEMENT_UNLOCKED("成就解锁");
}
```

### 2.3 CEP 规则定义模型

```sql
CREATE TABLE cep_rule (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    rule_id         VARCHAR(64) NOT NULL UNIQUE COMMENT '规则唯一标识',
    rule_name       VARCHAR(128) NOT NULL COMMENT '规则名称',
    rule_type       VARCHAR(32) NOT NULL COMMENT 'PATTERN / THRESHOLD / SEQUENCE / ABSENCE',
    category        VARCHAR(64) NOT NULL COMMENT 'FRUSTRATION / FATIGUE / ENGAGEMENT / CHEATING / DROPOUT / RISK',
    priority        INT NOT NULL DEFAULT 50 COMMENT '优先级 1-100, 越高越优先',
    enabled         TINYINT NOT NULL DEFAULT 1 COMMENT '是否启用',

    -- CEP 核心定义 (JSON)
    pattern_json    TEXT NOT NULL COMMENT 'CEP 模式定义 (Flink CEP Pattern JSON)',
    
    -- 触发条件补充
    condition_json  TEXT COMMENT '额外过滤条件 (SpEL 表达式)',
    
    -- 时间约束
    time_window_ms  BIGINT NOT NULL COMMENT '时间窗口 (毫秒)',
    within_clause   VARCHAR(256) COMMENT 'within 时间约束表达式',

    -- 输出配置
    output_event_type  VARCHAR(64) NOT NULL COMMENT '输出的复合事件类型',
    output_payload_tpl TEXT COMMENT '输出 payload 模板 (JSON Path + SpEL)',
    
    -- 干预联动
    intervention_strategy VARCHAR(64) COMMENT '关联的干预策略 ID',
    cooldown_ms         BIGINT DEFAULT 300000 COMMENT '同一用户同规则冷却时间 (默认5分钟)',

    -- 适用范围
    grade_scope     VARCHAR(256) COMMENT '适用学段 (逗号分隔, null=全部)',
    subject_scope   VARCHAR(256) COMMENT '适用学科 (逗号分隔, null=全部)',

    -- 元数据
    description     TEXT,
    created_by      VARCHAR(64),
    updated_by      VARCHAR(64),
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_category_enabled (category, enabled),
    INDEX idx_type_enabled (rule_type, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CEP检测规则表';
```

### 2.4 复合事件（输出）结构

```json
{
  "complexEventId": "ce_20260712_001_a3f8b2c1",
  "ruleId": "RULE_FRUSTRATION_001",
  "ruleName": "连续答错挫败检测",
  "eventType": "FRUSTRATION_DETECTED",
  "category": "FRUSTRATION",
  "userId": "U100234",
  "sessionId": "S20260712001",
  "detectedAt": 1720756900000,
  "windowStart": 1720756800000,
  "windowEnd": 1720756900000,
  "severity": "HIGH",
  "confidence": 0.87,
  "matchedEvents": [
    {"eventId": "evt_001", "timestamp": 1720756800000, "type": "ANSWER_WRONG"},
    {"eventId": "evt_002", "timestamp": 1720756830000, "type": "ANSWER_WRONG"},
    {"eventId": "evt_003", "timestamp": 1720756860000, "type": "ANSWER_WRONG"}
  ],
  "context": {
    "subject": "MATH",
    "knowledgePointIds": ["KP1023"],
    "currentStreak": 3,
    "sessionDuration": 600000,
    "userGrade": "G7"
  },
  "outputPayload": {
    "suggestionType": "ENCOURAGE_AND_SIMPLIFY",
    "recommendedDifficulty": 0.35,
    "message": "检测到连续答错，建议降低难度或切换知识点"
  },
  "interventionStrategy": "STRATEGY_FRUSTRATION_RELIEF_V2"
}
```

### 2.5 规则命中统计表

```sql
CREATE TABLE cep_rule_hit_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    rule_id         VARCHAR(64) NOT NULL,
    user_id         VARCHAR(64) NOT NULL,
    session_id      VARCHAR(64),
    detected_at     DATETIME NOT NULL,
    severity        VARCHAR(16),
    confidence      DECIMAL(5,4),
    matched_count   INT COMMENT '匹配的事件数量',
    
    INDEX idx_rule_time (rule_id, detected_at),
    INDEX idx_user_time (user_id, detected_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CEP规则命中日志';

CREATE TABLE cep_rule_statistics (
    rule_id         VARCHAR(64) PRIMARY KEY,
    date            DATE NOT NULL,
    hit_count       BIGINT DEFAULT 0,
    unique_user_count BIGINT DEFAULT 0,
    avg_confidence  DECIMAL(5,4),
    intervention_triggered_count BIGINT DEFAULT 0,
    intervention_suppressed_count BIGINT DEFAULT 0 COMMENT '被频控抑制的数量',
    
    PRIMARY KEY (rule_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CEP规则日统计';
```

---

## 3. CEP 模式定义与检测引擎

### 3.1 模式类型分类

本引擎支持四类 CEP 模式：

| 模式类型 | 说明 | 示例 |
| --- | --- | --- |
| **PATTERN** | 在时间窗口内检测特定事件组合 | 5分钟内：答错3次 + 请求提示2次 |
| **THRESHOLD** | 在时间窗口内某指标超过阈值 | 10分钟内：同一知识点答题正确率 < 30% |
| **SEQUENCE** | 检测事件的严格时序关系 | 先查看知识点 → 答错 → 再查看同一知识点 → 又答错 |
| **ABSENCE** | 在时间窗口内期望的事件未发生 | 进入考试模拟后30分钟内未提交任何答案 |

### 3.2 Pattern JSON 定义规范

#### 3.2.1 基础模式原子 (Pattern Atom)

```json
{
  "atomId": "A1",
  "eventType": "ANSWER_WRONG",
  "filter": {
    "payload.isCorrect": false,
    "payload.subject": "MATH"
  },
  "occurrence": {
    "type": "EXACTLY",
    "count": 3
  }
}
```

occurrence.type 支持值：
- `EXACTLY(n)` — 恰好出现 n 次
- `AT_LEAST(n)` — 至少出现 n 次
- `AT_MOST(n)` — 最多出现 n 次
- `BETWEEN(min, max)` — 出现 min~max 次

#### 3.2.2 完整 PATTERN 模式示例

```json
{
  "mode": "PATTERN",
  "within": "PT5M",
  "atoms": [
    {
      "atomId": "A1",
      "eventType": "ANSWER_WRONG",
      "filter": { "payload.subject": "#{subject}" },
      "occurrence": { "type": "AT_LEAST", "count": 3 }
    },
    {
      "atomId": "A2",
      "eventType": "HINT_REQUESTED",
      "filter": {},
      "occurrence": { "type": "AT_LEAST", "count": 1 }
    }
  ],
  "logicalOp": "AND",
  "timeRelations": [
    {
      "from": "A1",
      "to": "A2",
      "relation": "BEFORE_OR_CONCURRENT"
    }
  ],
  "groupBy": ["userId", "subject"],
  "having": {
    "expression": "A1.count >= 3 AND A2.count >= 1",
    "language": "SPEL"
  }
}
```

#### 3.2.3 SEQUENCE 模式示例

```json
{
  "mode": "SEQUENCE",
  "within": "PT10M",
  "sequence": [
    {
      "step": 1,
      "atomId": "S1",
      "eventType": "KNOWLEDGE_VIEWED",
      "filter": { "payload.knowledgePointId": "#{kpId}" }
    },
    {
      "step": 2,
      "atomId": "S2",
      "eventType": "ANSWER_WRONG",
      "filter": { "payload.knowledgePointIds": "CONTAINS(#{kpId})" }
    },
    {
      "step": 3,
      "atomId": "S3",
      "eventType": "KNOWLEDGE_VIEWED",
      "filter": { "payload.knowledgePointId": "#{kpId}" },
      "contiguity": "NON_STRICT"
    },
    {
      "step": 4,
      "atomId": "S4",
      "eventType": "ANSWER_WRONG",
      "filter": { "payload.knowledgePointIds": "CONTAINS(#{kpId})" }
    }
  ],
  "groupBy": ["userId", "kpId"]
}
```

contiguity 支持：
- `STRICT` — 严格连续（中间不能有其他事件）
- `NON_STRICT` — 非严格连续（中间允许有其他事件）
- `SKIP_TO_NEXT` — 跳到下一个匹配

#### 3.2.4 THRESHOLD 模式示例

```json
{
  "mode": "THRESHOLD",
  "within": "PT10M",
  "windowType": "SLIDING",
  "slideInterval": "PT1M",
  "metric": {
    "expression": "COUNT(CASE WHEN payload.isCorrect THEN 1 END) / COUNT(*)",
    "alias": "correctRate"
  },
  "filter": {
    "eventType": "ANSWER_SUBMITTED",
    "payload.subject": "#{subject}"
  },
  "groupBy": ["userId", "subject"],
  "threshold": {
    "operator": "<",
    "value": 0.3,
    "minSamples": 5
  }
}
```

#### 3.2.5 ABSENCE 模式示例

```json
{
  "mode": "ABSENCE",
  "within": "PT30M",
  "triggerEvent": {
    "atomId": "T1",
    "eventType": "PAGE_ENTERED",
    "filter": { "payload.pageCode": "EXAM_SIMULATION" }
  },
  "expectedEvent": {
    "eventType": "ANSWER_SUBMITTED",
    "occurrence": { "type": "AT_LEAST", "count": 1 }
  },
  "groupBy": ["userId"]
}
```

### 3.3 窗口策略

```java
public enum WindowType {
    TUMBLING("翻滚窗口 — 固定大小，不重叠"),
    SLIDING("滑动窗口 — 固定大小，有重叠"),
    SESSION("会话窗口 — 基于活跃间隔动态划分"),
    GLOBAL("全局窗口 — 需配触发器使用");

    private final String description;
}

public class WindowConfig {
    private WindowType type;
    private Duration windowSize;       // TUMBLING/SLIDING 窗口大小
    private Duration slideInterval;    // SLIDING 滑动间隔
    private Duration sessionGap;       // SESSION 活动间隙 (默认 5 分钟)

    // 会话窗口特殊配置
    private boolean mergeAdjacentSessions = true;
    private Duration maxSessionDuration = Duration.ofHours(2);
}
```

### 3.4 内置 CEP 规则清单

以下为系统预置的核心检测规则，可直接启用：

| 规则 ID | 规则名称 | 模式类型 | 检测逻辑 | 输出事件 | 默认冷却 |
| --- | --- | --- | --- | --- | --- |
| `RULE_FRUSTRATION_001` | 连续答错挫败检测 | PATTERN | 5分钟内同一学科连续答错≥3次 | `FRUSTRATION_DETECTED` | 5 min |
| `RULE_FRUSTRATION_002` | 频繁提示依赖检测 | PATTERN | 10分钟内单题请求提示≥3次 | `HINT_DEPENDENCY_DETECTED` | 10 min |
| `RULE_FATIGUE_001` | 长时间学习疲劳检测 | THRESHOLD | 连续学习>45分钟且最近5分钟答题正确率下降>20% | `FATIGUE_SIGNAL` | 30 min |
| `RULE_FATIGUE_002` | 夜间超时学习检测 | THRESHOLD | 23:00-06:00 期间学习时长>30分钟 | `NIGHT_STUDY_ALERT` | 60 min |
| `RULE_DISENGAGEMENT_001` | 学习中断放弃检测 | ABSENCE | 开始答题后3分钟内无任何操作 | `DISENGAGEMENT_DETECTED` | 15 min |
| `RULE_DISENGAGEMENT_002` | 高频切换检测 | THRESHOLD | 5分钟内切换Tab/页面>8次 | `DISTRACTION_DETECTED` | 10 min |
| `RULE_RAPID_GUESS_001` | 猜题检测 | THRESHOLD | 连续5题答题时间<3秒/题 | `RAPID_GUESSING_DETECTED` | 15 min |
| `RULE_KNOWLEDGE_GAP_001` | 同一知识点反复出错 | SEQUENCE | 查看知识点→答错→查看→答错（同一KP） | `KNOWLEDGE_GAP_DETECTED` | 30 min |
| `RULE_CHEATING_001` | 考试切屏检测 | PATTERN | 考试模式下APP进入后台≥3次 | `EXAM_CHEATING_SUSPECTED` | 整场考试 |
| `RULE_DROPOUT_001` | 流失风险检测 | ABSENCE | 完成上次学习后7天未活跃 | `DROPOUT_RISK_HIGH` | 一次 |
| `RULE_OVEREAGER_001` | 过度学习检测 | THRESHOLD | 单日同一学科学习>3小时 | `OVEREAGER_STUDY_WARN` | 24 h |
| `RULE_AI_DEPENDENCY_001` | AI依赖检测 | THRESHOLD | 一节课中AI提问>15次且自答率<20% | `AI_OVERRELiance_DETECTED` | 60 min |

---

## 4. API 接口设计

### 4.1 规则管理 API

#### 4.1.1 创建 CEP 规则

```
POST /api/v1/cep/rules
Content-Type: application/json
Authorization: Bearer {admin_token}
```

**请求体：**

```json
{
  "ruleName": "数学连续错题焦虑检测",
  "ruleType": "PATTERN",
  "category": "FRUSTRATION",
  "priority": 75,
  "patternJson": {
    "mode": "PATTERN",
    "within": "PT5M",
    "atoms": [{
      "atomId": "A1",
      "eventType": "ANSWER_WRONG",
      "filter": { "payload.subject": "MATH" },
      "occurrence": { "type": "AT_LEAST", "count": 4 }
    }],
    "groupBy": ["userId"],
    "having": {
      "expression": "A1.count >= 4",
      "language": "SPEL"
    }
  },
  "timeWindowMs": 300000,
  "outputEventType": "MATH_ANXIETY_DETECTED",
  "interventionStrategy": "STRATEGY_MATH_ANXIETY_V1",
  "cooldownMs": 600000,
  "gradeScope": "G7,G8,G9",
  "subjectScope": "MATH",
  "description": "初中数学5分钟内连续4题答错，触发数学焦虑干预"
}
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "ruleId": "RULE_FRUSTRATION_003",
    "status": "CREATED",
    "compiledAt": "2026-07-12T05:46:00Z",
    "validationResult": {
      "valid": true,
      "warnings": []
    }
  }
}
```

#### 4.1.2 更新规则

```
PUT /api/v1/cep/rules/{ruleId}
```

请求体同创建，支持部分字段更新。

#### 4.1.3 启用/禁用规则

```
PATCH /api/v1/cep/rules/{ruleId}/status
```

```json
{
  "enabled": true
}
```

#### 4.1.4 查询规则列表

```
GET /api/v1/cep/rules?category=FRUSTRATION&enabled=true&page=1&size=20
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "total": 12,
    "page": 1,
    "size": 20,
    "items": [
      {
        "ruleId": "RULE_FRUSTRATION_001",
        "ruleName": "连续答错挫败检测",
        "ruleType": "PATTERN",
        "category": "FRUSTRATION",
        "enabled": true,
        "priority": 75,
        "hitCountToday": 342,
        "lastHitAt": "2026-07-12T05:32:00Z"
      }
    ]
  }
}
```

#### 4.1.5 规则试运行（Dry Run）

```
POST /api/v1/cep/rules/{ruleId}/dry-run
```

```json
{
  "startTime": "2026-07-11T00:00:00Z",
  "endTime": "2026-07-12T00:00:00Z",
  "sampleUserId": "U100234",
  "maxResults": 100
}
```

返回历史数据中该规则会命中哪些事件序列，便于验证规则正确性。

#### 4.1.6 规则语法校验

```
POST /api/v1/cep/rules/validate
```

```json
{
  "patternJson": { ... }
}
```

返回：

```json
{
  "code": 0,
  "data": {
    "valid": false,
    "errors": [
      {
        "line": 12,
        "field": "atoms[0].occurrence.count",
        "message": "count must be >= 1 for AT_LEAST type"
      }
    ],
    "warnings": [
      {
        "field": "within",
        "message": "Window > 30 minutes may cause high memory usage"
      }
    ]
  }
}
```

### 4.2 复合事件查询 API

#### 4.2.1 查询用户最近的复合事件

```
GET /api/v1/cep/events?userId=U100234&category=FRUSTRATION&hours=24
```

#### 4.2.2 规则命中统计

```
GET /api/v1/cep/statistics/rules/{ruleId}?startDate=2026-07-01&endDate=2026-07-12
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "ruleId": "RULE_FRUSTRATION_001",
    "dailyStats": [
      {
        "date": "2026-07-11",
        "hitCount": 892,
        "uniqueUserCount": 456,
        "avgConfidence": 0.82,
        "interventionTriggered": 523,
        "interventionSuppressed": 369
      }
    ],
    "summary": {
      "totalHits": 892,
      "avgDailyHits": 892,
      "topUsers": ["U100234", "U100567", "U100890"]
    }
  }
}
```

### 4.3 引擎运行状态 API

#### 4.3.1 引擎健康状态

```
GET /api/v1/cep/engine/health
```

```json
{
  "code": 0,
  "data": {
    "status": "HEALTHY",
    "flinkJobStatus": "RUNNING",
    "consumers": [
      {
        "topic": "learning-events",
        "consumerGroup": "cep-engine-prod",
        "lag": 42,
        "lagAlert": false,
        "consumptionRate": 3200.5
      }
    ],
    "activeRules": 47,
    "disabledRules": 3,
    "jvmHeapUsage": 0.62,
    "checkpoints": {
      "lastCheckpointDuration": 856,
      "lastCheckpointSize": "245MB",
      "checkpointInterval": 60000
    }
  }
}
```

#### 4.3.2 实时指标

```
GET /api/v1/cep/engine/metrics?window=5m
```

```json
{
  "code": 0,
  "data": {
    "windowSeconds": 300,
    "eventsConsumed": 158234,
    "eventsPerSecond": 527.4,
    "patternsMatched": 342,
    "patternsMatchedPerSecond": 1.14,
    "avgProcessingLatencyMs": 47,
    "p99ProcessingLatencyMs": 180,
    "rulesEvaluated": 47,
    "topMatchedRules": [
      {"ruleId": "RULE_FRUSTRATION_001", "matches": 89},
      {"ruleId": "RULE_FATIGUE_001", "matches": 67},
      {"ruleId": "RULE_RAPID_GUESS_001", "matches": 45}
    ]
  }
}
```

---

## 5. 核心技术实现

### 5.1 技术选型

| 组件 | 选型 | 理由 |
| --- | --- | --- |
| 流处理框架 | **Apache Flink 1.18+** | 原生 CEP 库、事件时间语义、精确一次语义、Checkpoint 恢复 |
| 消息队列 | **Apache Kafka 3.x** | 高吞吐、持久化、消费者组管理 |
| 规则存储 | **MySQL 8.x** | 规则元数据持久化 |
| 状态后端 | **RocksDB (增量 Checkpoint)** | 大规模状态管理，支持 TB 级状态 |
| 时间语义 | **Event Time + Watermark** | 保证乱序事件正确处理 |
| 规则动态加载 | **Kafka Broadcast Stream** | 规则变更实时广播到所有 TaskManager |
| ML 模式增强 | **ONNX Runtime (嵌入式)** | 在流中同步调用轻量模型增强检测 |
| 监控 | **Prometheus + Grafana** | Flink Metrics 对接 |

### 5.2 Flink CEP 核心实现

#### 5.2.1 主处理拓扑

```java
/**
 * CEP 引擎主作业 — 从 Kafka 消费学习事件，执行 CEP 模式检测，输出复合事件
 */
public class CepEngineJob {

    public static void main(String[] args) throws Exception {
        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment(
            CepEngineConfig.fromArgs(args)
        );

        // --- 1. 事件源：消费学习行为事件 ---
        DataStream<LearningEvent> eventStream = env
            .addSource(new FlinkKafkaConsumer<>(
                "learning-events",
                new LearningEventDeserializer(),
                kafkaProps()
            ))
            .name("learning-events-source")
            .uid("learning-events-source")
            .assignTimestampsAndWatermarks(
                WatermarkStrategy
                    .<LearningEvent>forBoundedOutOfOrderness(Duration.ofSeconds(10))
                    .withTimestampAssigner((event, ts) -> event.getTimestamp())
                    .withIdleness(Duration.ofMinutes(1))
            );

        // --- 2. 规则广播流：消费规则变更 ---
        DataStream<RuleSet> ruleBroadcast = env
            .addSource(new FlinkKafkaConsumer<>(
                "cep-rule-updates",
                new RuleSetDeserializer(),
                kafkaProps()
            ))
            .name("rule-broadcast-source")
            .uid("rule-broadcast-source")
            .broadcast(RULE_DESCRIPTOR);

        // --- 3. 事件预处理 & 上下文增强 ---
        DataStream<EnrichedEvent> enrichedStream = eventStream
            .keyBy(LearningEvent::getUserId)
            .connect(ruleBroadcast)
            .process(new ContextEnrichmentFunction())
            .name("context-enrichment")
            .uid("context-enrichment");

        // --- 4. CEP 模式检测 (按规则类型分流) ---
        // 4a. PATTERN 类型规则
        DataStream<ComplexEvent> patternEvents = enrichedStream
            .keyBy(EnrichedEvent::getUserId)
            .process(new DynamicPatternDetector())
            .name("pattern-detector")
            .uid("pattern-detector");

        // 4b. THRESHOLD 类型规则 (窗口聚合)
        DataStream<ComplexEvent> thresholdEvents = enrichedStream
            .keyBy(e -> Tuple2.of(e.getUserId(), e.getSubject()))
            .window(SlidingEventTimeWindows.of(Time.minutes(10), Time.minutes(1)))
            .process(new ThresholdDetectorFunction())
            .name("threshold-detector")
            .uid("threshold-detector");

        // 4c. SEQUENCE 类型规则 (Flink CEP)
        // 注意: SEQUENCE 规则使用 Flink 原生 CEP API，需要按规则动态编译
        DataStream<ComplexEvent> sequenceEvents = enrichedStream
            .keyBy(EnrichedEvent::getUserId)
            .process(new DynamicSequenceDetector())
            .name("sequence-detector")
            .uid("sequence-detector");

        // 4d. ABSENCE 类型规则
        DataStream<ComplexEvent> absenceEvents = enrichedStream
            .keyBy(EnrichedEvent::getUserId)
            .process(new AbsenceDetectorFunction())
            .name("absence-detector")
            .uid("absence-detector");

        // --- 5. 合并所有检测结果 ---
        DataStream<ComplexEvent> allComplexEvents = patternEvents
            .union(thresholdEvents)
            .union(sequenceEvents)
            .union(absenceEvents)
            .name("complex-events-union")
            .uid("complex-events-union");

        // --- 6. 冷却去重 ---
        DataStream<ComplexEvent> dedupedEvents = allComplexEvents
            .keyBy(ce -> Tuple3.of(ce.getUserId(), ce.getRuleId(), ce.getCategory()))
            .process(new CooldownDedupFunction())
            .name("cooldown-dedup")
            .uid("cooldown-dedup");

        // --- 7. 输出 ---
        // 7a. 发送到 Kafka 下游
        dedupedEvents
            .addSink(new FlinkKafkaProducer<>(
                "cep-complex-events",
                new ComplexEventSerializer(),
                kafkaProps()
            ))
            .name("complex-events-sink")
            .uid("complex-events-sink");

        // 7b. 写入 ClickHouse (异步)
        dedupedEvents
            .addSink(new ClickHouseAsyncSink(
                "cep_rule_hit_log",
                CepEngineConfig.getClickHouseConfig()
            ))
            .name("clickhouse-sink")
            .uid("clickhouse-sink");

        // 7c. 触发实时告警 (HTTP 推送)
        dedupedEvents
            .filter(ComplexEvent::isHighSeverity)
            .addSink(new HttpAlertSink(CepEngineConfig.getAlertWebhookUrl()))
            .name("alert-sink")
            .uid("alert-sink");

        env.execute("PrimeTop CEP Detection Engine v2.0");
    }

    private static final MapStateDescriptor<Long, RuleSet> RULE_DESCRIPTOR =
        new MapStateDescriptor<>(
            "cep-rules",
            BasicTypeInfo.LONG_TYPE_INFO,
            TypeInformation.of(RuleSet.class)
        );
}
```

#### 5.2.2 动态模式检测器（核心）

```java
/**
 * 动态 PATTERN 检测器 — 根据广播流中的规则集，对事件流执行多种 PATTERN 模式检测。
 * 使用 KeyedProcessFunction + 自定义状态机实现，避免 CEP Pattern 动态编译的限制。
 */
public class DynamicPatternDetector 
        extends KeyedProcessFunction<String, EnrichedEvent, ComplexEvent> {

    // 规则集 (来自广播流)
    private transient MapState<Long, RuleSet> rulesState;

    // 每个规则的状态：记录当前匹配进度
    // Key: ruleId, Value: 该规则的匹配上下文
    private transient MapState<String, RuleMatchContext> matchState;

    // 用户冷却状态：ruleId → 上次触发时间戳
    private transient MapState<String, Long> cooldownState;

    @Override
    public void open(Configuration parameters) {
        rulesState = getRuntimeContext().getMapState(RULE_DESCRIPTOR);
        matchState = getRuntimeContext().getMapState(
            new MapStateDescriptor<>("match-state",
                String.class, RuleMatchContext.class));
        cooldownState = getRuntimeContext().getMapState(
            new MapStateDescriptor<>("cooldown-state",
                String.class, Long.class));
    }

    @Override
    public void processElement(EnrichedEvent event, Context ctx,
                               Collector<ComplexEvent> out) throws Exception {
        long currentTime = ctx.timerService().currentWatermark();

        // 遍历所有启用的 PATTERN 规则
        for (RuleSet ruleSet : rulesState.values()) {
            for (CepRule rule : ruleSet.getPatterns()) {
                if (!rule.isEnabled()) continue;
                if (!rule.matchesScope(event)) continue;

                String stateKey = rule.getRuleId();
                RuleMatchContext matchCtx = matchState.get(stateKey);

                if (matchCtx == null) {
                    matchCtx = RuleMatchContext.init(rule, currentTime);
                }

                // 检查是否在冷却期
                Long lastTriggered = cooldownState.get(stateKey);
                if (lastTriggered != null) {
                    long cooldownEnd = lastTriggered + rule.getCooldownMs();
                    if (currentTime < cooldownEnd) {
                        continue; // 跳过，仍在冷却期
                    }
                }

                // 尝试匹配当前事件
                MatchResult result = rule.tryMatch(event, matchCtx, currentTime);

                switch (result.getStatus()) {
                    case MATCHED:
                        // 所有 atom 都满足，输出复合事件
                        ComplexEvent ce = buildComplexEvent(rule, matchCtx, event, currentTime);
                        out.collect(ce);

                        // 更新冷却
                        cooldownState.put(stateKey, currentTime);

                        // 重置匹配状态 (准备下一轮检测)
                        matchState.remove(stateKey);
                        break;

                    case PROGRESSED:
                        // 匹配进度增加
                        matchCtx.recordEvent(event);
                        matchState.put(stateKey, matchCtx);
                        break;

                    case RESET:
                        // 当前事件破坏了匹配模式，重置
                        matchState.remove(stateKey);
                        // 如果当前事件可以作为新模式起点，重新初始化
                        if (rule.canStartWith(event)) {
                            RuleMatchContext newCtx = RuleMatchContext.init(rule, currentTime);
                            newCtx.recordEvent(event);
                            matchState.put(stateKey, newCtx);
                        }
                        break;

                    case IGNORED:
                        // 事件不影响当前匹配进度 (如属于其他学科)
                        break;
                }

                // 注册窗口超时清理 Timer
                long windowEnd = matchCtx.getWindowStart() + rule.getTimeWindowMs();
                ctx.timerService().registerEventTimeTimer(windowEnd);
            }
        }
    }

    @Override
    public void onTimer(long timestamp, OnTimerContext ctx,
                        Collector<ComplexEvent> out) throws Exception {
        // 清理超时的匹配上下文
        Iterator<Map.Entry<String, RuleMatchContext>> it = matchState.entries().iterator();
        while (it.hasNext()) {
            Map.Entry<String, RuleMatchContext> entry = it.next();
            RuleMatchContext matchCtx = entry.getValue();
            if (timestamp >= matchCtx.getWindowStart() + matchCtx.getTimeWindowMs()) {
                // 窗口超时，清理
                // 如果是 ABSENCE 规则，检查是否应该触发
                if (matchCtx.getRuleType() == RuleType.ABSENCE 
                        && !matchCtx.isExpectEventReceived()) {
                    ComplexEvent ce = buildAbsenceEvent(matchCtx, timestamp);
                    out.collect(ce);
                }
                it.remove();
            }
        }
    }

    private ComplexEvent buildComplexEvent(CepRule rule, RuleMatchContext matchCtx,
                                           EnrichedEvent currentEvent, long timestamp) {
        return ComplexEvent.builder()
            .complexEventId(IdGenerator.next("ce"))
            .ruleId(rule.getRuleId())
            .ruleName(rule.getRuleName())
            .eventType(rule.getOutputEventType())
            .category(rule.getCategory())
            .userId(currentEvent.getUserId())
            .sessionId(currentEvent.getSessionId())
            .detectedAt(timestamp)
            .windowStart(matchCtx.getWindowStart())
            .windowEnd(timestamp)
            .severity(calculateSeverity(matchCtx))
            .confidence(calculateConfidence(matchCtx, rule))
            .matchedEvents(matchCtx.getMatchedEvents())
            .context(extractContext(matchCtx, currentEvent))
            .outputPayload(renderPayload(rule, matchCtx))
            .interventionStrategy(rule.getInterventionStrategy())
            .build();
    }

    private Severity calculateSeverity(RuleMatchContext matchCtx) {
        int matchStrength = matchCtx.getMatchStrength();
        if (matchStrength >= 80) return Severity.CRITICAL;
        if (matchStrength >= 60) return Severity.HIGH;
        if (matchStrength >= 40) return Severity.MEDIUM;
        return Severity.LOW;
    }

    private double calculateConfidence(RuleMatchContext matchCtx, CepRule rule) {
        // 基于匹配事件数量、时间窗口占比、规则优先级等计算置信度
        int matchedCount = matchCtx.getMatchedEvents().size();
        int requiredCount = rule.getMinRequiredEvents();
        double baseConfidence = (double) matchedCount / requiredCount;
        double priorityFactor = rule.getPriority() / 100.0;
        return Math.min(0.99, baseConfidence * 0.7 + priorityFactor * 0.3);
    }
}
```

#### 5.2.3 上下文增强函数

```java
/**
 * 将原始事件与用户画像、知识点信息等慢变数据进行流式 Join
 * 使用 Flink Async I/O 查询外部存储，避免阻塞主数据流
 */
public class ContextEnrichmentFunction 
        extends BroadcastProcessFunction<LearningEvent, RuleSet, EnrichedEvent> {

    private transient AsyncUserProfiler userProfiler;
    private transient AsyncKnowledgeBase knowledgeBase;

    @Override
    public void open(Configuration parameters) {
        // 初始化异步查询客户端 (Redis 异步 + 本地 Caffeine 缓存)
        userProfiler = new AsyncUserProfiler(
            CepEngineConfig.getRedisClient(),
            Caffeine.newBuilder()
                .maximumSize(50_000)
                .expireAfterWrite(Duration.ofMinutes(5))
                .build()
        );
        knowledgeBase = new AsyncKnowledgeBase(
            CepEngineConfig.getRedisClient()
        );
    }

    @Override
    public void processElement(LearningEvent event, ReadOnlyContext ctx,
                               Collector<EnrichedEvent> out) throws Exception {
        // 获取当前生效的规则集
        RuleSet currentRules = ctx.getBroadcastState(RULE_DESCRIPTOR).get(1L);
        
        // 异步查询用户画像 (CompletableFuture → AsyncWaitOperator)
        CompletableFuture<UserProfile> profileFuture = userProfiler.getAsync(event.getUserId());
        
        // 异步查询知识点信息（如果有）
        CompletableFuture<KnowledgeContext> kpFuture = 
            event.getKnowledgePointIds() != null 
                ? knowledgeBase.getAsync(event.getKnowledgePointIds())
                : CompletableFuture.completedFuture(KnowledgeContext.empty());

        // 等待异步结果
        CompletableFuture.allOf(profileFuture, kpFuture).thenAccept(v -> {
            UserProfile profile = profileFuture.join();
            KnowledgeContext kpCtx = kpFuture.join();

            EnrichedEvent enriched = EnrichedEvent.from(event)
                .withUserProfile(profile)
                .withKnowledgeContext(kpCtx)
                .withRuleSet(currentRules)
                .build();

            out.collect(enriched);
        });
    }

    @Override
    public void processBroadcastElement(RuleSet ruleSet, Context ctx,
                                        Collector<EnrichedEvent> out) throws Exception {
        // 将最新规则集写入广播状态
        ctx.getBroadcastState(RULE_DESCRIPTOR).put(1L, ruleSet);
    }
}
```

#### 5.2.4 冷却去重函数

```java
/**
 * 基于规则+用户的冷却去重，防止同一用户短时间内被同一规则反复触发
 */
public class CooldownDedupFunction 
        extends KeyedProcessFunction<Tuple3<String, String, String>, 
                                     ComplexEvent, ComplexEvent> {

    private transient ValueState<Long> lastTriggerTimeState;
    private transient ValueState<Integer> suppressCountState;

    @Override
    public void open(Configuration parameters) {
        lastTriggerTimeState = getRuntimeContext().getState(
            new ValueStateDescriptor<>("last-trigger", Long.class));
        suppressCountState = getRuntimeContext().getState(
            new ValueStateDescriptor<>("suppress-count", Integer.class));
    }

    @Override
    public void processElement(ComplexEvent event, Context ctx,
                               Collector<ComplexEvent> out) throws Exception {
        Long lastTriggered = lastTriggerTimeState.value();
        long currentTime = ctx.timerService().currentWatermark();

        if (lastTriggered != null) {
            long elapsed = currentTime - lastTriggered;
            if (elapsed < event.getCooldownMs()) {
                // 在冷却期内，抑制此次触发
                int suppressed = (suppressCountState.value() != null 
                    ? suppressCountState.value() : 0) + 1;
                suppressCountState.update(suppressed);

                // 写入被抑制日志 (用于分析)
                logSuppression(event, suppressed);
                return;
            }
        }

        // 通过冷却检查，输出事件
        lastTriggerTimeState.update(currentTime);
        suppressCountState.update(0);
        out.collect(event);
    }

    private void logSuppression(ComplexEvent event, int consecutiveSuppressed) {
        // 记录到监控: 某规则在某用户上的连续抑制次数
        // 如果连续抑制次数过高，可能说明规则需要调优
    }
}
```

### 5.3 规则动态编译与热加载

```java
/**
 * 规则管理服务 — 负责规则的 CRUD、编译、验证和 Kafka 广播
 */
@Service
public class CepRuleManagementService {

    @Autowired
    private CepRuleMapper ruleMapper;
    
    @Autowired
    private KafkaTemplate<String, RuleSet> ruleKafkaTemplate;

    private static final String RULE_UPDATE_TOPIC = "cep-rule-updates";

    /**
     * 创建新规则并广播到 Flink 集群
     */
    @Transactional
    public CepRule createRule(CreateRuleRequest request) {
        // 1. 语法校验
        ValidationResult validation = validatePattern(request.getPatternJson());
        if (!validation.isValid()) {
            throw new RuleValidationException(validation.getErrors());
        }

        // 2. 持久化
        CepRule rule = CepRule.builder()
            .ruleId(generateRuleId(request.getCategory()))
            .ruleName(request.getRuleName())
            .ruleType(request.getRuleType())
            .category(request.getCategory())
            .priority(request.getPriority())
            .patternJson(JsonUtils.toJson(request.getPatternJson()))
            .timeWindowMs(request.getTimeWindowMs())
            .outputEventType(request.getOutputEventType())
            .interventionStrategy(request.getInterventionStrategy())
            .cooldownMs(request.getCooldownMs())
            .gradeScope(String.join(",", request.getGradeScope()))
            .subjectScope(String.join(",", request.getSubjectScope()))
            .enabled(true)
            .createdBy(SecurityUtils.getCurrentUser())
            .build();
        
        ruleMapper.insert(rule);

        // 3. 广播规则变更
        broadcastRuleUpdate();

        return rule;
    }

    /**
     * 广播当前所有启用的规则集到 Kafka
     * Flink 消费端会更新广播状态，实现热加载
     */
    public void broadcastRuleUpdate() {
        List<CepRule> activeRules = ruleMapper.selectAllEnabled();
        
        RuleSet ruleSet = RuleSet.builder()
            .version(System.currentTimeMillis())
            .patterns(activeRules.stream()
                .filter(r -> r.getRuleType() == RuleType.PATTERN)
                .collect(Collectors.toList()))
            .thresholds(activeRules.stream()
                .filter(r -> r.getRuleType() == RuleType.THRESHOLD)
                .collect(Collectors.toList()))
            .sequences(activeRules.stream()
                .filter(r -> r.getRuleType() == RuleType.SEQUENCE)
                .collect(Collectors.toList()))
            .absences(activeRules.stream()
                .filter(r -> r.getRuleType() == RuleType.ABSENCE)
                .collect(Collectors.toList()))
            .build();

        ruleKafkaTemplate.send(RULE_UPDATE_TOPIC, "ruleset", ruleSet);
    }

    /**
     * 规则语法校验
     */
    public ValidationResult validatePattern(Object patternJson) {
        ValidationResult result = new ValidationResult();
        
        try {
            PatternDefinition def = JsonUtils.parse(
                JsonUtils.toJson(patternJson), 
                PatternDefinition.class
            );
            
            // 校验 within 字段
            if (def.getWithin() == null || def.getWithin().isEmpty()) {
                result.addError("within", "时间窗口不能为空");
            } else {
                Duration d = Duration.parse(def.getWithin());
                if (d.toMinutes() > 60) {
                    result.addWarning("within", "窗口超过60分钟可能导致内存压力增大");
                }
                if (d.toSeconds() < 5) {
                    result.addError("within", "窗口不能小于5秒");
                }
            }

            // 校验 atoms
            if (def.getAtoms() == null || def.getAtoms().isEmpty()) {
                result.addError("atoms", "至少需要一个 Pattern Atom");
            } else {
                for (int i = 0; i < def.getAtoms().size(); i++) {
                    PatternAtom atom = def.getAtoms().get(i);
                    if (atom.getEventType() == null) {
                        result.addError("atoms[" + i + "].eventType", "事件类型不能为空");
                    }
                    if (atom.getOccurrence() == null) {
                        result.addError("atoms[" + i + "].occurrence", "出现次数不能为空");
                    } else if (atom.getOccurrence().getCount() < 1) {
                        result.addError("atoms[" + i + "].occurrence.count", 
                            "出现次数必须 >= 1");
                    }
                }
            }

            // 校验 groupBy 必须包含 userId
            if (def.getGroupBy() == null || !def.getGroupBy().contains("userId")) {
                result.addWarning("groupBy", "建议包含 userId 以实现按用户检测");
            }

        } catch (Exception e) {
            result.addError("patternJson", "JSON 解析失败: " + e.getMessage());
        }

        return result;
    }
}
```

### 5.5 THRESHOLD 检测器实现

```java
/**
 * 基于 Sliding Window 的阈值检测
 */
public class ThresholdDetectorFunction 
        extends ProcessWindowFunction<EnrichedEvent, ComplexEvent, 
                                      Tuple2<String, String>, TimeWindow> {

    @Override
    public void process(Tuple2<String, String> key,
                        Context context,
                        Iterable<EnrichedEvent> events,
                        Collector<ComplexEvent> out) throws Exception {
        
        TimeWindow window = context.window();
        List<EnrichedEvent> eventList = new ArrayList<>();
        events.forEach(eventList::add);

        // 获取当前窗口适用的 THRESHOLD 规则
        RuleSet rules = context.getBroadcastState(RULE_DESCRIPTOR).get(1L);
        if (rules == null) return;

        for (CepRule rule : rules.getThresholds()) {
            if (!rule.isEnabled()) continue;
            
            ThresholdDefinition thresholdDef = rule.getThresholdDefinition();
            
            // 检查最小样本量
            if (eventList.size() < thresholdDef.getMinSamples()) continue;

            // 计算指标值
            double metricValue = calculateMetric(eventList, thresholdDef.getMetricExpression());

            // 比较阈值
            if (thresholdDef.compare(metricValue)) {
                ComplexEvent ce = ComplexEvent.builder()
                    .complexEventId(IdGenerator.next("ce"))
                    .ruleId(rule.getRuleId())
                    .ruleName(rule.getRuleName())
                    .eventType(rule.getOutputEventType())
                    .category(rule.getCategory())
                    .userId(key.f0)
                    .detectedAt(window.maxTimestamp())
                    .windowStart(window.getStart())
                    .windowEnd(window.getEnd())
                    .severity(Severity.MEDIUM)
                    .confidence(calculateThresholdConfidence(metricValue, thresholdDef))
                    .matchedEvents(eventList.stream()
                        .map(EnrichedEvent::toSimpleEvent)
                        .collect(Collectors.toList()))
                    .build();
                
                out.collect(ce);
            }
        }
    }

    /**
     * 支持 COUNT / SUM / AVG / MIN / MAX / RATE 等基本聚合
     * 以及 CASE WHEN 条件聚合
     */
    private double calculateMetric(List<EnrichedEvent> events, String expression) {
        if (expression.startsWith("COUNT(CASE WHEN")) {
            // 解析 CASE WHEN 条件并计数
            String condition = extractCondition(expression);
            return events.stream()
                .filter(e -> evaluateCondition(e, condition))
                .count();
        }
        
        if (expression.startsWith("RATE(") || expression.contains("/ COUNT(*)")) {
            // 正确率等比率指标
            String numerator = extractNumerator(expression);
            double num = calculateMetric(events, numerator);
            return num / events.size();
        }
        
        if (expression.startsWith("AVG(")) {
            String field = extractField(expression);
            return events.stream()
                .mapToDouble(e -> e.getDouble(field))
                .average()
                .orElse(0);
        }
        
        // 默认: COUNT(*)
        return events.size();
    }
}
```

---

## 6. 状态管理与容错

### 6.1 Flink 状态管理

```
┌─────────────────────────────────────────────────────────────┐
│                    Flink State 管理架构                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────┐    ┌──────────────────────────┐   │
│  │ Operator State      │    │ Keyed State              │   │
│  │ (Broadcast State)   │    │ (按 userId 分区)          │   │
│  │                     │    │                          │   │
│  │ • 规则集 (RuleSet)  │    │ • 匹配上下文 (MatchCtx)   │   │
│  │   ~5MB              │    │   ~2KB/user × 50万 users │   │
│  │                     │    │   ≈ 1GB                  │   │
│  └─────────────────────┘    │ • 冷却状态 (Cooldown)     │   │
│                             │   ~8B/user × 50万 = 4MB  │   │
│                             │                          │   │
│                             │ • 抑制计数 (SuppressCnt)  │   │
│                             │   ~4B/user × 50万 = 2MB  │   │
│                             └──────────────────────────┘   │
│                                                             │
│  Backend: RocksDB (Incremental Checkpoint)                  │
│  Checkpoint Interval: 60s                                   │
│  Checkpoint Timeout: 5min                                   │
│  Min Pause Between Checkpoints: 30s                        │
│  Max Concurrent Checkpoints: 1                             │
│  Retained Checkpoints: 3                                    │
│                                                             │
│  Estimated Total State Size: ~1.5 GB                       │
│  Checkpoint Duration: ~5 seconds (incremental)             │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 Watermark 与乱序处理

```java
/**
 * Watermark 策略: 允许 10 秒乱序，空闲检测 1 分钟
 */
WatermarkStrategy.<LearningEvent>forBoundedOutOfOrderness(Duration.ofSeconds(10))
    .withTimestampAssigner((event, ts) -> event.getTimestamp())
    .withIdleness(Duration.ofMinutes(1))
```

- **事件时间语义**：所有窗口和 CEP 检测基于事件产生时间（`clientTimestamp`），而非处理时间
- **乱序容忍**：最多允许 10 秒乱序（网络延迟场景）
- **延迟事件处理**：超过 watermark 的事件进入侧输出流 `late-events`，用于离线补偿
- **空闲检测**：1 分钟无数据时推进 watermark，防止下游窗口永久等待

### 6.3 容错与恢复

```yaml
# Flink Job 配置
execution:
  checkpointing:
    interval: 60s
    mode: EXACTLY_ONCE
    timeout: 5min
    min-pause: 30s
    max-concurrent: 1
    externalized-checkpoint-cleanup: RETAIN_ON_CANCELLATION
    state-backend: rocksdb
    rocksdb:
      incremental: true
      local-dir: /data/flink/rocksdb
  
  restart-strategy:
    type: exponential-delay
    initial-backoff: 10s
    max-backoff: 5min
    backoff-multiplier: 2.0
    reset-backoff-threshold: 10min
    
  parallelism:
    default: 8
    pattern-detector: 16  # 高并发检测
    threshold-detector: 4  # 窗口计算少并发
```

### 6.4 延迟事件补偿

```java
/**
 * 延迟事件侧输出 → 离线补偿管线
 */
DataStream<LearningEvent> lateEvents = enrichedStream
    .getSideOutput(lateOutputTag);

// 延迟事件写入 Kafka 离线 Topic，由 Spark 批处理任务进行补偿分析
lateEvents
    .addSink(new FlinkKafkaProducer<>(
        "cep-late-events",
        new LearningEventSerializer(),
        kafkaProps()
    ))
    .name("late-events-sink")
    .uid("late-events-sink")
    .setParallelism(2);
```

---

## 7. 错误处理

### 7.1 错误分类

| 错误类型 | 场景 | 处理策略 |
| --- | --- | --- |
| 事件反序列化失败 | 上游发送格式错误的事件 | 跳过 + 记录到 `dead-letter-queue` Topic |
| 规则编译失败 | Pattern JSON 格式错误 | 规则创建时拦截；运行时跳过该规则 |
| 异步查询超时 | Redis/用户画像查询超时 | 降级为空上下文，不影响主流程 |
| Checkpoint 失败 | 状态后端写入异常 | 自动重试 3 次 → 通知运维 |
| Kafka 消费者 Lag 过大 | 消费速度跟不上生产速度 | 自动扩容并行度 + 告警 |
| 下游 Kafka 不可用 | 复合事件写入失败 | 本地缓冲 + 重试 + 告警 |
| Flink TaskManager OOM | 状态过大或内存泄漏 | 自动重启 + 告警 + 扩容 |

### 7.2 降级策略

```java
/**
 * 降级控制器 — 在系统压力过大时自动降级
 */
public class DegradationController {
    
    // 降级等级
    public enum DegradationLevel {
        NORMAL(1.0),      // 正常处理所有规则
        WARNING(0.8),     // 跳过低优先级规则 (priority < 30)
        DEGRADED(0.5),    // 只处理高优先级规则 (priority >= 60)
        CRITICAL(0.2),    // 只处理关键规则 (priority >= 80)
        EMERGENCY(0.0);   // 暂停所有检测，只做事件转发
        
        public final double processingRatio;
    }

    /**
     * 根据系统指标动态调整降级等级
     */
    public DegradationLevel evaluate(SystemMetrics metrics) {
        // Kafka Lag 检查
        if (metrics.getKafkaLag() > 100_000) {
            return DegradationLevel.DEGRADED;
        }
        if (metrics.getKafkaLag() > 500_000) {
            return DegradationLevel.CRITICAL;
        }
        
        // 处理延迟检查
        if (metrics.getP99LatencyMs() > 5000) {
            return DegradationLevel.WARNING;
        }
        if (metrics.getP99LatencyMs() > 15000) {
            return DegradationLevel.DEGRADED;
        }
        
        // 内存使用检查
        if (metrics.getJvmHeapUsage() > 0.85) {
            return DegradationLevel.WARNING;
        }
        if (metrics.getJvmHeapUsage() > 0.95) {
            return DegradationLevel.CRITICAL;
        }
        
        // Checkpoint 背压
        if (metrics.getCheckpointDurationMs() > 120_000) {
            return DegradationLevel.WARNING;
        }
        
        return DegradationLevel.NORMAL;
    }
}
```

### 7.3 错误码

| 错误码 | 含义 | HTTP Status |
| --- | --- | --- |
| `CEP_4001` | 规则 JSON 格式错误 | 400 |
| `CEP_4002` | 规则 within 时间窗口无效 | 400 |
| `CEP_4003` | 规则 atom 缺少必填字段 | 400 |
| `CEP_4004` | 规则 occurrence 参数无效 | 400 |
| `CEP_4005` | 规则 groupBy 缺少 userId | 400 |
| `CEP_4041` | 规则不存在 | 404 |
| `CEP_4091` | 规则 ID 已存在 | 409 |
| `CEP_4092` | 规则名称已存在 | 409 |
| `CEP_5001` | 引擎内部错误 | 500 |
| `CEP_5002` | 规则编译/加载失败 | 500 |
| `CEP_5003` | Kafka 连接失败 | 500 |
| `CEP_5031` | 引擎正在降级运行 | 503 |
| `CEP_5032` | 引擎正在重启 | 503 |

---

## 8. 性能优化

### 8.1 性能目标

| 指标 | 目标值 | 告警阈值 |
| --- | --- | --- |
| 事件处理吞吐量 | ≥ 5000 events/s | < 2000 events/s |
| 平均处理延迟 | ≤ 100 ms | > 500 ms |
| P99 处理延迟 | ≤ 500 ms | > 2000 ms |
| 规则匹配延迟（事件到输出） | ≤ 2 s | > 5 s |
| Kafka 消费 Lag | ≤ 1000 | > 10,000 |
| Checkpoint 耗时 | ≤ 10 s | > 60 s |
| 状态大小 | ≤ 5 GB | > 20 GB |

### 8.2 优化策略

#### 8.2.1 规则索引与预过滤

```java
/**
 * 规则预索引：按 eventType 建立倒排索引
 * 每条事件只评估与其 eventType 相关的规则，减少无效匹配
 */
public class RuleIndex {
    // eventType → 相关规则列表
    private Map<LearningEventType, List<CepRule>> eventTypeIndex;
    
    // subject → 相关规则列表
    private Map<String, List<CepRule>> subjectIndex;
    
    // grade → 相关规则列表
    private Map<String, List<CepRule>> gradeIndex;

    public List<CepRule> getCandidateRules(LearningEvent event) {
        // 多级过滤：eventType ∩ subject ∩ grade
        Set<CephRule> candidates = new HashSet<>();
        
        List<CepRule> byEventType = eventTypeIndex.getOrDefault(
            event.getEventType(), Collections.emptyList());
        
        List<CepRule> bySubject = event.getSubject() != null
            ? subjectIndex.getOrDefault(event.getSubject(), Collections.emptyList())
            : null;
        
        candidates.addAll(byEventType);
        if (bySubject != null) {
            candidates.retainAll(bySubject);
        }
        
        return new ArrayList<>(candidates);
    }
}
```

#### 8.2.2 状态清理与 TTL

```java
/**
 * 所有 keyed state 配置 TTL，防止状态无限增长
 */
StateTtlConfig ttlConfig = StateTtlConfig
    .newBuilder(Time.hours(2))              // 2小时 TTL
    .setUpdateType(StateTtlConfig.UpdateType.OnCreateAndWrite)
    .setStateVisibility(StateTtlConfig.StateVisibility.NeverReturnExpired)
    .cleanupInRocksdbCompactFilter(1000)    // RocksDB compaction 时清理
    .build();

// 应用到各状态
MapStateDescriptor<String, RuleMatchContext> matchDesc = 
    new MapStateDescriptor<>("match-state", String.class, RuleMatchContext.class);
matchDesc.enableTimeToLive(ttlConfig);
```

#### 8.2.3 异步 I/O 并发控制

```java
// 上下文查询使用 AsyncFunction，设置并发 100，超时 3 秒
AsyncFunction<LearningEvent, EnrichedEvent> enricher = 
    new ContextEnrichmentFunction();

AsyncDataStream
    .unorderedWait(enricher, enrichedStream, 
        3, TimeUnit.SECONDS,  // 超时
        100)                   // 并发请求
    .name("async-context-enrichment");
```

#### 8.2.4 规则评估短路

```java
/**
 * 对于多 atom 的 PATTERN 规则，按成本从低到高排序 atom
 * 低成本 atom 快速过滤，高成本 atom 延迟计算
 */
public class AtomOptimizer {
    public List<PatternAtom> optimize(List<PatternAtom> atoms) {
        return atoms.stream()
            .sorted(Comparator.comparingInt(this::estimateCost))
            .collect(Collectors.toList());
    }
    
    private int estimateCost(PatternAtom atom) {
        int cost = 0;
        // 简单 filter 低成本
        if (atom.getFilter() != null && !atom.getFilter().isEmpty()) cost += 10;
        // 正则匹配高成本
        if (atom.getFilter().values().stream()
            .anyMatch(v -> v.toString().startsWith("REGEX:"))) cost += 50;
        // 多字段 join 高成本
        if (atom.getFilter().values().stream()
            .anyMatch(v -> v.toString().startsWith("JOIN:"))) cost += 80;
        return cost;
    }
}
```

---

## 9. 安全考虑

### 9.1 数据安全

- **事件流加密**：Kafka 启用 TLS 传输加密，SASL 认证
- **敏感字段脱敏**：用户手机号、真实姓名等在进入 CEP 前已脱敏
- **状态数据隔离**：Flink Keyed State 按 userId 分区，天然隔离
- **Checkpoint 加密**：RocksDB checkpoint 数据使用 AES-256 加密存储

### 9.2 权限控制

| 操作角色 | 规则查看 | 规则创建/修改 | 规则启用/禁用 | 引擎状态 | Dry Run |
| --- | --- | --- | --- | --- | --- |
| 管理员 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 教研人员 | ✓ | ✗ (需审批) | ✗ | ✓ | ✓ |
| 运营人员 | ✓ | ✗ | ✗ | ✓ | ✓ |
| 开发人员 | ✓ | ✗ | ✗ | ✓ | ✓ |

### 9.3 审计日志

```sql
INSERT INTO audit_log (operator, action, target_type, target_id, 
                       detail, ip, created_at)
VALUES ('admin_001', 'CREATE_CEP_RULE', 'CEP_RULE', 'RULE_FRUSTRATION_003',
        '{"ruleName":"数学连续错题焦虑检测","category":"FRUSTRATION"}',
        '10.0.1.5', NOW());
```

所有规则的创建、修改、启停操作均记录审计日志，保留至少 180 天。

---

## 10. 部署与运维

### 10.1 部署架构

```
┌──────────────────────────────────────────────────────┐
│                  Kubernetes 集群                      │
│                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │
│  │ JobManager  │  │ JobManager  │  │  ZooKeeper │  │
│  │ (Leader)    │←→│ (Standby)   │  │  (HA)      │  │
│  └──────┬──────┘  └─────────────┘  └────────────┘  │
│         │                                            │
│  ┌──────┴───────────────────────────────────────┐   │
│  │           TaskManager × 8                    │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐       │   │
│  │  │ Slot 0  │ │ Slot 1  │ │ Slot 2  │ ...   │   │
│  │  │ Source  │ │ Pattern │ │ Threshold│      │   │
│  │  │ + Enr.  │ │ Detector│ │ Detector│       │   │
│  │  └─────────┘ └─────────┘ └─────────┘       │   │
│  │  CPU: 4 Core | RAM: 8GB | Disk: 100GB SSD  │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │           外部依赖                            │   │
│  │  Kafka Cluster (5 brokers)                   │   │
│  │  Redis Cluster (3 master + 3 slave)          │   │
│  │  MySQL (RDS primary + readonly)              │   │
│  │  ClickHouse Cluster (2 shard × 2 replica)    │   │
│  │  Prometheus + Grafana                        │   │
│  └──────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

### 10.2 资源规划

| 组件 | 规格 | 数量 | 备注 |
| --- | --- | --- | --- |
| JobManager | 2 Core / 4GB RAM | 2 | HA (1 Leader + 1 Standby) |
| TaskManager | 4 Core / 8GB RAM / 100GB SSD | 4-8 | 按 Kafka 分区数和吞吐量弹性伸缩 |
| Kafka Broker | 4 Core / 16GB RAM / 1TB SSD | 3-5 | 独立集群或共享 |
| Redis | 4 Core / 16GB RAM | 3+3 | 主从集群 |

### 10.3 监控大盘

**Grafana Dashboard 核心面板：**

1. **吞吐量面板**
   - Events/sec（输入）、Complex Events/sec（输出）
   - 各 Topic 消费 Lag 趋势
   - Kafka 分区分配状态

2. **延迟面板**
   - 处理延迟分位数（P50/P95/P99）
   - 端到端延迟（事件产生 → 复合事件输出）
   - Checkpoint 耗时趋势

3. **规则面板**
   - 各规则命中次数实时排行
   - 规则命中率（命中/评估）趋势
   - 高频触发用户 Top N

4. **资源面板**
   - TM CPU/Memory/Network 使用率
   - JVM Heap / GC 时长
   - RocksDB 状态大小
   - 背压状态

5. **告警面板**
   - Kafka Lag > 10000 → P2 告警
   - P99 延迟 > 2000ms → P2 告警
   - Checkpoint 失败 → P1 告警
   - 消费者组失联 → P1 告警

### 10.4 日常运维操作

| 操作 | 命令/步骤 | 注意事项 |
| --- | --- | --- |
| 查看作业状态 | `flink list -r` | 确认所有 Job 处于 RUNNING |
| 手动触发 Savepoint | `flink savepoint <jobId> <targetDir>` | 便于升级前备份 |
| 作业升级 | Savepoint → 停止旧作业 → 启动新作业 → 从 Savepoint 恢复 | 估计停机 1-2 分钟 |
| 规则热加载 | 通过 API 修改规则 → 自动广播 | 无需重启 |
| 扩容 TaskManager | K8s `kubectl scale` | 等待自动 Rebalance |
| 查看 Watermark | Flink WebUI → Job → Operators → Watermark | 确认无长时间停滞 |

---

## 11. 测试策略

### 11.1 单元测试

```java
@DisplayName("CEP 规则匹配引擎测试")
class PatternDetectorTest {

    private DynamicPatternDetector detector;
    private MockContext mockCtx;

    @BeforeEach
    void setUp() {
        detector = new DynamicPatternDetector();
        mockCtx = new MockContext();
    }

    @Test
    @DisplayName("5分钟内连续答错3次应触发 FRUSTRATION_DETECTED")
    void shouldDetectFrustration_3WrongAnswersIn5Min() throws Exception {
        // Given
        CepRule rule = createRule("RULE_FRUSTRATION_001",
            RuleType.PATTERN, "PT5M", 3);
        mockCtx.setRules(rule);

        long baseTime = System.currentTimeMillis();

        // When - 模拟 3 次连续答错
        LearningEvent wrong1 = createAnswerEvent(baseTime, false, "MATH");
        LearningEvent wrong2 = createAnswerEvent(baseTime + 60_000, false, "MATH");
        LearningEvent wrong3 = createAnswerEvent(baseTime + 120_000, false, "MATH");

        detector.processElement(wrong1, mockCtx, mockCtx.getCollector());
        detector.processElement(wrong2, mockCtx, mockCtx.getCollector());
        detector.processElement(wrong3, mockCtx, mockCtx.getCollector());

        // Then
        assertThat(mockCtx.getCollectedOutputs()).hasSize(1);
        ComplexEvent ce = mockCtx.getCollectedOutputs().get(0);
        assertThat(ce.getEventType()).isEqualTo("FRUSTRATION_DETECTED");
        assertThat(ce.getMatchedEvents()).hasSize(3);
        assertThat(ce.getSeverity()).isEqualTo(Severity.HIGH);
    }

    @Test
    @DisplayName("不同学科的答错不应触发同学科规则")
    void shouldNotCrossTrigger_differentSubjects() throws Exception {
        // Given
        CepRule rule = createRule("RULE_MATH_FRUSTRATION", 
            RuleType.PATTERN, "PT5M", 3, "MATH");

        // When
        LearningEvent mathWrong = createAnswerEvent(1000L, false, "MATH");
        LearningEvent englishWrong = createAnswerEvent(2000L, false, "ENGLISH");
        LearningEvent mathWrong2 = createAnswerEvent(3000L, false, "MATH");

        // Then - 只有 2 次 MATH 答错，不应触发
        assertThat(mockCtx.getCollectedOutputs()).isEmpty();
    }

    @Test
    @DisplayName("冷却期内不应重复触发")
    void shouldNotTriggerDuringCooldown() throws Exception {
        // Given - 触发一次
        triggerFrustration();
        
        // When - 冷却期内再次满足条件
        triggerFrustration();
        
        // Then - 只触发一次
        assertThat(mockCtx.getCollectedOutputs()).hasSize(1);
    }

    @Test
    @DisplayName("超出时间窗口的事件应被忽略")
    void shouldExpireEventsOutOfWindow() throws Exception {
        long baseTime = 0L;

        // 第一次答错
        LearningEvent wrong1 = createAnswerEvent(baseTime, false, "MATH");
        detector.processElement(wrong1, mockCtx, mockCtx.getCollector());

        // 模拟窗口超时 Timer 触发
        mockCtx.fireTimer(baseTime + 5 * 60_000L);

        // 窗口超时后的答错（新窗口）
        LearningEvent wrong2 = createAnswerEvent(baseTime + 5 * 60_000L + 1, false, "MATH");
        LearningEvent wrong3 = createAnswerEvent(baseTime + 5 * 60_000L + 61_000, false, "MATH");

        detector.processElement(wrong2, mockCtx, mockCtx.getCollector());
        detector.processElement(wrong3, mockCtx, mockCtx.getCollector());

        // 只有 2 次，不满足 3 次条件
        assertThat(mockCtx.getCollectedOutputs()).isEmpty();
    }
}
```

### 11.2 集成测试

```java
@SpringBootTest
@Testcontainers
class CepEngineIntegrationTest {

    @Container
    static final KafkaContainer KAFKA = new KafkaContainer("confluentinc/cp-kafka:7.5.0");
    
    @Container
    static final GenericContainer<?> REDIS = new GenericContainer<>("redis:7-alpine")
        .withExposedPorts(6379);

    @Test
    @DisplayName("端到端：事件发送→CEP检测→复合事件输出")
    void endToEnd_eventToComplexEvent() throws Exception {
        // 1. 启动 MiniCluster
        try (AutoCloseable flink = startMiniCluster()) {
            // 2. 创建规则
            ruleApi.createRule(createFrustrationRule());
            await().atMost(10, SECONDS).until(() -> ruleApi.countRules() == 1);

            // 3. 发送学习事件
            kafkaTemplate.send("learning-events", buildWrongAnswer("U001", "MATH"));
            kafkaTemplate.send("learning-events", buildWrongAnswer("U001", "MATH"));
            kafkaTemplate.send("learning-events", buildWrongAnswer("U001", "MATH"));

            // 4. 验证复合事件输出
            await().atMost(30, SECONDS).untilAsserted(() -> {
                List<ConsumerRecord<String, ComplexEvent>> records = 
                    kafkaConsumer.poll("cep-complex-events");
                assertThat(records).anyMatch(r -> 
                    r.value().getEventType().equals("FRUSTRATION_DETECTED") &&
                    r.value().getUserId().equals("U001"));
            });
        }
    }
}
```

### 11.3 性能测试

```yaml
# JMeter / Gatling 性能测试计划
performance-test:
  scenario-1-normal-load:
    description: "正常负载 2000 events/s"
    duration: 30 min
    events-per-second: 2000
    expected-latency-p99: < 500ms
    expected-kafka-lag: < 500
    
  scenario-2-peak-load:
    description: "高峰负载 5000 events/s"
    duration: 15 min
    events-per-second: 5000
    expected-latency-p99: < 2000ms
    expected-kafka-lag: < 5000
    
  scenario-3-burst:
    description: "突发流量 10000 events/s 持续1分钟"
    duration: 1 min
    events-per-second: 10000
    expected: 引擎不崩溃，降级机制启动
    
  scenario-4-sustained:
    description: "持续负载 3000 events/s × 2 小时"
    duration: 120 min
    events-per-second: 3000
    expected: 无内存泄漏，状态大小稳定
```

---

## 12. 与下游系统的集成协议

### 12.1 复合事件 Kafka Topic 规范

```yaml
Topic: cep-complex-events
Partitions: 12
Replication: 3
Retention: 7 days
Cleanup: delete

Message Format: JSON (ComplexEvent)
Compression: lz4
```

### 12.2 下游消费方适配

| 下游系统 | 消费方式 | 消费组 | 处理逻辑 |
| --- | --- | --- | --- |
| 统一学习干预编排引擎 | Kafka Consumer | `intervention-orchestrator` | 接收复合事件 → 匹配干预策略 → 执行干预 |
| 告警系统（飞书/钉钉） | HTTP Webhook | N/A | 高严重度事件实时推送到运维群 |
| 数据仓库 (ClickHouse) | Kafka Connector | `clickhouse-sink` | 全量写入，用于离线分析 |
| 用户行为分析平台 | Kafka Consumer | `analytics-platform` | 结合其他行为数据进行综合分析 |
| 实时大盘 (Grafana) | Prometheus | N/A | 通过 Flink Metrics 上报 |

### 12.3 干预引擎对接协议

```json
// 复合事件 → 干预引擎的消息格式
{
  "eventName": "INTERVENTION_REQUEST",
  "source": "CEP_ENGINE",
  "version": "1.0",
  "timestamp": 1720756900000,
  "payload": {
    "complexEvent": { /* 完整 ComplexEvent */ },
    "recommendedStrategy": "STRATEGY_FRUSTRATION_RELIEF_V2",
    "urgency": "MEDIUM",
    "userContext": {
      "userId": "U100234",
      "currentSessionId": "S20260712001",
      "currentModule": "PRACTICE",
      "currentSubject": "MATH",
      "grade": "G7"
    },
    "constraints": {
      "maxInterventionsPerHour": 3,
      "respectQuietHours": true,
      "respectDndMode": true
    }
  }
}
```

干预引擎收到后返回 ACK：

```json
{
  "eventName": "INTERVENTION_ACK",
  "correlationId": "ce_20260712_001_a3f8b2c1",
  "timestamp": 1720756901000,
  "payload": {
    "accepted": true,
    "interventionId": "intv_20260712_001",
    "plannedAction": "SHOW_ENCOURAGEMENT_CARD",
    "willExecuteAt": 1720756902000
  }
}
```

---

## 13. 附录

### 13.1 术语表

| 术语 | 说明 |
| --- | --- |
| CEP | Complex Event Processing，复杂事件处理 |
| Pattern Atom | 模式原子，CEP 检测的最小匹配单元 |
| Window | 时间窗口，定义 CEP 检测的时间范围 |
| Watermark | 水位线，Flink 中用于处理乱序事件的时间机制 |
| Checkpoint | Flink 状态快照，用于容错恢复 |
| Complex Event | 复合事件，CEP 检测到模式后输出的结构化事件 |
| Rule Hit | 规则命中，规则条件被满足 |
| Cooldown | 冷却期，同一用户同一规则两次触发间的最小间隔 |

### 13.2 版本历史

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v1.0 | 2026-07-12 | 初始版本，支持 PATTERN/THRESHOLD/SEQUENCE/ABSENCE 四种模式 |

### 13.3 开放问题

| 编号 | 问题 | 状态 | 备注 |
| --- | --- | --- | --- |
| Q1 | ML 模型增强检测（如基于历史序列预测挫败概率）是否需要在 v1 引入 | 待定 | v1 使用规则引擎，v2 可引入 ML |
| Q2 | 是否支持跨用户模式检测（如班级级别的共性错误模式） | 待定 | 当前设计聚焦单用户模式 |
| Q3 | 规则版本管理与 A/B 测试 | 待定 | 后续可接入 AB 测试平台 |
| Q4 | Flink Application Mode vs Session Mode 部署选择 | 已定 | 采用 Application Mode，每作业独立 JM |
