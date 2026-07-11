# 服务端 - 学生 AI 辅助依赖度智能监测与自主学习能力培养引导引擎 详细设计

## 1. 概述

### 1.1 模块定位

本引擎是 PrimeTop 教育产品中的**跨模块行为分析与干预引擎**，负责监测学生在使用 AI 辅助学习过程中的依赖行为模式，评估学生的自主学习能力水平，并根据依赖程度动态调整 AI 辅助策略，引导学生从"被动依赖 AI"逐步过渡到"主动独立思考"。

### 1.2 核心问题

原始设计文档明确指出风险：

> 用户依赖答案 → 直接抄答案，学习效果弱 → 应对：默认分步提示，强化思路和同类练习

具体需要解决的问题：

| 问题表现 | 危害 | 当前覆盖情况 |
|---------|------|-------------|
| 遇题直接拍 AI，不尝试独立思考 | 思维能力退化 | 答案管控引擎处理"展示层"，本引擎处理"行为层" |
| 快速连续提问，不阅读完整解析 | 知识吸收率低 | 无专门监测 |
| 反复要求"直接给答案"，跳过提示 | 学习效果归零 | 渐进式提示引擎部分覆盖 |
| AI 使用时长占比过高，自主练习极少 | 自主能力停滞 | 防沉迷引擎管控总时长，未区分 AI vs 自主 |
| 同类题目反复求助 AI | 知识点未真正掌握 | 错题引擎关注错题，不关注求助模式 |

### 1.3 核心职责

1. **依赖度采集**：实时采集学生与 AI 交互的行为事件，构建依赖行为特征向量
2. **依赖度评估**：基于多维特征计算 AI 依赖度指数（AIDI），生成依赖等级
3. **智能干预**：根据依赖等级动态调整 AI 辅助策略（提示深度、答案延迟、引导语等）
4. **能力培养**：设计渐进式自主学习能力提升路径，通过任务编排引导学生独立完成
5. **家长透明**：向家长报告 AI 依赖度趋势和自主能力发展情况

### 1.4 与其他模块的依赖关系

```
┌─────────────────────────────────────────────────────────┐
│                   本引擎 (AI Dependency Engine)          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ 行为采集  │→│ 依赖评估  │→│ 干预决策  │→│ 策略下发 │ │
│  └────┬─────┘  └──────────┘  └──────────┘  └────┬────┘ │
└───────┼──────────────────────────────────────────┼──────┘
        │                                          │
   ┌────▼────┐                               ┌─────▼─────┐
   │事件源模块│                               │执行模块    │
   ├─────────┤                               ├───────────┤
   │AI对话引擎│                               │渐进式提示引擎│
   │拍题答疑  │                               │答案管控引擎 │
   │练习测评  │                               │AI对话引擎   │
   │错题系统  │                               │消息推送服务 │
   │学习规划  │                               │家长中心     │
   └─────────┘                               └───────────┘
```

### 1.5 设计原则

- **非侵入式采集**：通过事件订阅获取行为数据，不侵入业务主流程
- **渐进式干预**：从轻度引导到强制策略，避免引起学生反感
- **个性化基线**：不同学段、不同能力水平的学生设定不同依赖度基线
- **可解释性**：依赖度评分和干预决策必须可解释，供家长和教师理解
- **A/B 可验证**：干预策略效果通过实验验证，持续迭代

---

## 2. 数据模型

### 2.1 核心实体 ER 图

```
┌──────────────────────┐     ┌──────────────────────────────┐
│  ai_usage_event       │     │  dependency_snapshot          │
│  (AI使用行为事件)      │     │  (依赖度快照)                 │
├──────────────────────┤     ├──────────────────────────────┤
│  id           BIGINT  │     │  id              BIGINT       │
│  student_id   BIGINT  │     │  student_id      BIGINT       │
│  session_id   VARCHAR │     │  snapshot_date   DATE         │
│  event_type   VARCHAR │     │  aidi_score      DECIMAL(4,2) │
│  module       VARCHAR │     │  dependency_level VARCHAR     │
│  context      JSON    │     │  dimension_scores JSON        │
│  occurred_at  DATETIME│     │  intervention    VARCHAR      │
│  created_at   DATETIME│     │  created_at      DATETIME     │
└──────────────────────┘     └──────────────────────────────┘
         │                              │
         │              ┌───────────────┘
         │              │
┌────────▼─────────────┐│┌──────────────────────────────────┐
│  behavior_feature     │││  intervention_log                 │
│  (行为特征向量)        │││  (干预执行日志)                   │
├──────────────────────┤│├──────────────────────────────────┤
│  id           BIGINT  │││  id              BIGINT           │
│  student_id   BIGINT  │││  student_id      BIGINT           │
│  feature_date DATE    │││  intervention_id VARCHAR          │
│  features     JSON    │││  strategy        VARCHAR          │
│  window_type  VARCHAR │││  triggered_at    DATETIME         │
│  created_at   DATETIME│││  effect_metric   JSON             │
└──────────────────────┘││  resolved_at     DATETIME         │
                        │└──────────────────────────────────┘
                        │
                ┌───────▼──────────────────┐
                │  autonomy_milestone       │
                │  (自主能力里程碑)          │
                ├──────────────────────────┤
                │  id           BIGINT      │
                │  student_id   BIGINT      │
                │  milestone    VARCHAR     │
                │  achieved_at  DATETIME    │
                │  evidence     JSON        │
                │  created_at   DATETIME    │
                └──────────────────────────┘
```

### 2.2 数据库表结构

#### 2.2.1 `ai_usage_event` — AI 使用行为事件表

```sql
CREATE TABLE ai_usage_event (
    id              BIGINT       PRIMARY KEY AUTO_INCREMENT,
    student_id      BIGINT       NOT NULL,
    session_id      VARCHAR(64)  NOT NULL COMMENT '学习会话ID',
    event_type      VARCHAR(48)  NOT NULL COMMENT '事件类型',
    module          VARCHAR(32)  NOT NULL COMMENT '来源模块: ai_dialog/photo_search/practice/mistake/plan',
    question_id     BIGINT       NULL     COMMENT '关联题目ID（如有）',
    subject         VARCHAR(16)  NULL     COMMENT '学科',
    knowledge_point VARCHAR(64)  NULL     COMMENT '关联知识点',
    
    -- 行为上下文
    time_to_first_action_ms INT   NULL COMMENT '从题目展示到首次AI操作的时间(毫秒)',
    attempt_count_before_ai INT   NULL COMMENT '求助AI前的独立尝试次数',
    read_full_answer       BOOLEAN NULL COMMENT '是否阅读完整解析',
    answer_reveal_level    VARCHAR(16) NULL COMMENT '答案展示级别: hint/partial/full',
    
    -- 拓展上下文
    context         JSON         NULL COMMENT '扩展上下文信息',
    occurred_at     DATETIME(3)  NOT NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_student_time (student_id, occurred_at),
    INDEX idx_session (session_id),
    INDEX idx_event_type (event_type, occurred_at),
    INDEX idx_module (module, student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI使用行为事件';
```

**事件类型枚举：**

| event_type | 含义 | 来源模块 |
|------------|------|---------|
| `AI_QUESTION_ASKED` | 向 AI 提出问题 | ai_dialog |
| `AI_FOLLOW_UP_ASKED` | 连续追问 | ai_dialog |
| `PHOTO_SEARCH_INITIATED` | 发起拍照搜题 | photo_search |
| `PHOTO_SEARCH_RESULT_VIEWED` | 查看搜题结果 | photo_search |
| `HINT_REQUESTED` | 请求提示 | practice, photo_search |
| `FULL_ANSWER_REQUESTED` | 请求完整答案 | practice, photo_search |
| `ANSWER_SKIPPED_TO_END` | 跳过提示直接查看答案 | practice |
| `SIMILAR_QUESTION_REQUESTED` | 请求同类题 | photo_search |
| `AI_EXPLANATION_REQUESTED` | 请求 AI 讲解 | practice |
| `INDEPENDENT_ANSWER_SUBMITTED` | 独立提交答案（无 AI 辅助） | practice |
| `ANSWER_CORRECT_FIRST_TRY` | 首次尝试正确（无 AI） | practice |
| `AI_ASSISTED_ANSWER_CORRECT` | AI 辅助后正确 | practice |
| `SESSION_AI_ONLY` | 学习会话中全部使用 AI 辅助 | session |

#### 2.2.2 `behavior_feature` — 行为特征向量表

```sql
CREATE TABLE behavior_feature (
    id              BIGINT       PRIMARY KEY AUTO_INCREMENT,
    student_id      BIGINT       NOT NULL,
    feature_date    DATE         NOT NULL,
    window_type     VARCHAR(16)  NOT NULL COMMENT '时间窗口: daily/weekly/monthly',
    
    -- 原始统计特征
    features        JSON         NOT NULL COMMENT '特征向量JSON',
    
    -- 关键衍生指标（冗余存储，便于查询）
    ai_action_count INT          NOT NULL DEFAULT 0 COMMENT 'AI操作总次数',
    independent_action_count INT NOT NULL DEFAULT 0 COMMENT '独立操作次数',
    ai_ratio        DECIMAL(4,3) NOT NULL DEFAULT 0 COMMENT 'AI操作占比',
    avg_time_to_ai_ms BIGINT     NULL COMMENT '平均求助AI前用时(毫秒)',
    avg_attempt_before_ai DECIMAL(3,1) NULL COMMENT '平均求助前独立尝试次数',
    direct_answer_ratio DECIMAL(4,3) NULL COMMENT '直接查看答案比例',
    follow_up_ratio  DECIMAL(4,3) NULL COMMENT '追问率',
    
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE INDEX uk_student_window (student_id, feature_date, window_type),
    INDEX idx_date_window (feature_date, window_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='行为特征向量';
```

#### 2.2.3 `dependency_snapshot` — 依赖度快照表

```sql
CREATE TABLE dependency_snapshot (
    id                BIGINT       PRIMARY KEY AUTO_INCREMENT,
    student_id        BIGINT       NOT NULL,
    snapshot_date     DATE         NOT NULL,
    
    -- AIDI 综合指数
    aidi_score        DECIMAL(4,2) NOT NULL COMMENT 'AI依赖度指数 0-100, 越高越依赖',
    dependency_level  VARCHAR(16)  NOT NULL COMMENT '依赖等级: LOW/MODERATE/HIGH/CRITICAL',
    
    -- 各维度分数
    dimension_scores  JSON         NOT NULL COMMENT '各维度得分明细',
    
    -- 干预建议
    recommended_intervention VARCHAR(48) NULL COMMENT '推荐干预策略',
    intervention_active BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否已激活干预',
    
    -- 趋势
    trend_direction   VARCHAR(8)   NULL COMMENT '趋势: UP/STABLE/DOWN',
    trend_delta       DECIMAL(5,2) NULL COMMENT '与前一次差值',
    
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE INDEX uk_student_date (student_id, snapshot_date),
    INDEX idx_level_date (dependency_level, snapshot_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI依赖度每日快照';
```

#### 2.2.4 `intervention_log` — 干预执行日志表

```sql
CREATE TABLE intervention_log (
    id                BIGINT       PRIMARY KEY AUTO_INCREMENT,
    student_id        BIGINT       NOT NULL,
    intervention_id   VARCHAR(64)  NOT NULL COMMENT '干预实例唯一标识',
    
    -- 干预配置
    strategy          VARCHAR(48)  NOT NULL COMMENT '干预策略类型',
    trigger_level     VARCHAR(16)  NOT NULL COMMENT '触发时的依赖等级',
    config_snapshot   JSON         NOT NULL COMMENT '干预配置快照',
    
    -- 执行信息
    triggered_at      DATETIME(3)  NOT NULL,
    activated_at      DATETIME(3)  NULL COMMENT '学生实际感知到干预的时间',
    resolved_at       DATETIME     NULL COMMENT '干预结束时间',
    resolved_reason   VARCHAR(48)  NULL COMMENT '结束原因: level_dropped/manual/experiment',
    
    -- 效果度量
    effect_metric     JSON         NULL COMMENT '干预效果指标',
    
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_student (student_id, triggered_at),
    INDEX idx_strategy (strategy, trigger_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='干预执行日志';
```

#### 2.2.5 `autonomy_milestone` — 自主能力里程碑表

```sql
CREATE TABLE autonomy_milestone (
    id              BIGINT       PRIMARY KEY AUTO_INCREMENT,
    student_id      BIGINT       NOT NULL,
    milestone       VARCHAR(48)  NOT NULL COMMENT '里程碑类型',
    milestone_level INT          NOT NULL COMMENT '等级 1-5',
    
    achieved_at     DATETIME     NOT NULL,
    evidence        JSON         NOT NULL COMMENT '达成证据',
    
    -- 奖励
    reward_granted  VARCHAR(64)  NULL COMMENT '已发放奖励',
    
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE INDEX uk_student_milestone (student_id, milestone, milestone_level),
    INDEX idx_student (student_id, achieved_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='自主能力里程碑';
```

### 2.3 `features` JSON 结构定义

`behavior_feature.features` 的 JSON 结构：

```json
{
  "timeBased": {
    "totalStudyDurationMs": 7200000,
    "aiAssistedDurationMs": 5400000,
    "aiRatio": 0.75,
    "avgSessionAiRatio": 0.68,
    "avgTimeToFirstAiMs": 8500,
    "avgTimeToFirstAiBySubject": {
      "math": 5200,
      "english": 12000,
      "chinese": 9800
    }
  },
  "frequencyBased": {
    "totalAiActions": 45,
    "dailyAvgAiActions": 15.0,
    "directAnswerRequests": 12,
    "directAnswerRatio": 0.267,
    "followUpCount": 18,
    "followUpRatio": 0.40,
    "photoSearchCount": 8,
    "photoSearchRatio": 0.178,
    "hintSkipCount": 7,
    "hintSkipRatio": 0.156
  },
  "attemptBased": {
    "totalQuestions": 30,
    "independentCorrectCount": 8,
    "independentCorrectRatio": 0.267,
    "aiAssistedCorrectCount": 18,
    "aiAssistedCorrectRatio": 0.60,
    "avgAttemptBeforeAi": 0.8,
    "zeroAttemptRatio": 0.567,
    "sameKnowledgePointAiCount": {
      "fraction_addition": 5,
      "linear_equation": 3
    }
  },
  "patternBased": {
    "rapidFireSessions": 2,
    "rapidFireThresholdMs": 3000,
    "noReadCompleteCount": 10,
    "noReadCompleteRatio": 0.222,
    "aiOnlySessionCount": 3,
    "aiOnlySessionRatio": 0.375,
    "subjectDependency": {
      "math": 0.82,
      "physics": 0.71,
      "english": 0.45
    }
  },
  "trendBased": {
    "aidiTrend7d": [62, 65, 68, 70, 72, 75, 78],
    "aiRatioTrend7d": [0.55, 0.60, 0.63, 0.68, 0.70, 0.73, 0.75],
    "isAccelerating": true
  }
}
```

### 2.4 `dimension_scores` JSON 结构定义

`dependency_snapshot.dimension_scores` 的 JSON 结构：

```json
{
  "frequencyDimension": {
    "score": 72.5,
    "weight": 0.25,
    "subMetrics": {
      "dailyAiActionCount": 15,
      "directAnswerRatio": 0.267,
      "followUpRatio": 0.40
    }
  },
  "speedDimension": {
    "score": 85.0,
    "weight": 0.30,
    "subMetrics": {
      "avgTimeToFirstAiMs": 8500,
      "zeroAttemptRatio": 0.567,
      "hintSkipRatio": 0.156
    }
  },
  "proportionDimension": {
    "score": 68.0,
    "weight": 0.20,
    "subMetrics": {
      "aiAssistedDurationRatio": 0.75,
      "aiOnlySessionRatio": 0.375,
      "subjectMaxDependency": 0.82
    }
  },
  "outcomeDimension": {
    "score": 55.0,
    "weight": 0.15,
    "subMetrics": {
      "independentCorrectRatio": 0.267,
      "sameKnowledgePointRepeatAi": 5,
      "knowledgeRetentionRate": 0.40
    }
  },
  "trendDimension": {
    "score": 78.0,
    "weight": 0.10,
    "subMetrics": {
      "aidiChangeRate7d": 16.0,
      "isAccelerating": true,
      "consecutiveHighDays": 5
    }
  }
}
```

### 2.5 缓存策略

| 缓存对象 | Redis Key 模式 | TTL | 说明 |
|---------|---------------|-----|------|
| 当日行为计数器 | `aid:cnt:{studentId}:{date}` | 至当日结束 | 原子计数器，INCR 操作 |
| 实时依赖度分数 | `aid:rt:{studentId}` | 30min | 近实时分数，用于策略判断 |
| 当日依赖度快照 | `aid:snap:{studentId}:{date}` | 7d | 避免重复计算 |
| 当前干预策略 | `aid:intv:{studentId}` | 24h | 当前生效的干预配置 |
| 学段基线配置 | `aid:baseline:{stage}` | 1h | 不同学段的依赖度基线 |
| 学生行为序列 | `aid:seq:{studentId}` | 2h | 最近 N 条行为的时序数据（Redis List/Stream） |

---

## 3. API 接口设计

### 3.1 接口总览

| # | 接口 | 方法 | 路径 | 说明 |
|---|------|------|------|------|
| 1 | 上报行为事件 | POST | `/api/v1/ai-dependency/events` | 各模块上报 AI 使用行为 |
| 2 | 获取依赖度概览 | GET | `/api/v1/ai-dependency/overview` | 学生当前依赖度状态 |
| 3 | 获取依赖度趋势 | GET | `/api/v1/ai-dependency/trend` | 历史依赖度变化趋势 |
| 4 | 获取维度详情 | GET | `/api/v1/ai-dependency/dimensions` | 各维度评分明细 |
| 5 | 获取干预策略 | GET | `/api/v1/ai-dependency/intervention` | 当前干预配置（内部调用） |
| 6 | 获取学科依赖分布 | GET | `/api/v1/ai-dependency/by-subject` | 各学科依赖度对比 |
| 7 | 获取自主能力里程碑 | GET | `/api/v1/ai-dependency/milestones` | 自主能力达成情况 |
| 8 | 获取家长报告 | GET | `/api/v1/ai-dependency/parent-report` | 家长视角的依赖度报告 |
| 9 | 管理端覆盖干预 | PUT | `/api/v1/ai-dependency/override` | 管理员/家长手动调整策略 |

### 3.2 详细接口定义

#### 3.2.1 上报行为事件

```
POST /api/v1/ai-dependency/events
```

**请求头：**
```
Authorization: Bearer {token}
Content-Type: application/json
X-Student-Id: {studentId}
```

**请求体：**
```json
{
  "sessionId": "sess_20260711_001",
  "eventType": "AI_QUESTION_ASKED",
  "module": "ai_dialog",
  "questionId": null,
  "subject": "math",
  "knowledgePoint": "linear_equation",
  "timeToFirstActionMs": 3000,
  "attemptCountBeforeAi": 0,
  "readFullAnswer": null,
  "answerRevealLevel": null,
  "context": {
    "dialogId": "conv_001",
    "messageType": "text",
    "source": "manual_input"
  },
  "occurredAt": "2026-07-11T10:30:00.123Z"
}
```

**响应：**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "eventId": "evt_001",
    "currentAidi": 72.5,
    "level": "HIGH",
    "interventionTriggered": false
  }
}
```

**验证规则：**

| 字段 | 规则 |
|------|------|
| eventType | 必须在枚举值内 |
| module | 必须在枚举值内 |
| timeToFirstActionMs | 0 ~ 3600000（1小时） |
| attemptCountBeforeAi | 0 ~ 99 |
| subject | 非空且在支持的学科列表内 |

#### 3.2.2 获取依赖度概览

```
GET /api/v1/ai-dependency/overview?studentId={studentId}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "studentId": 100001,
    "studentName": "小明",
    "stage": "JUNIOR_HIGH",
    "grade": 8,
    "currentAidi": 72.5,
    "dependencyLevel": "HIGH",
    "levelLabel": "较高依赖",
    "levelDescription": "AI辅助占比较高，建议加强独立思考练习",
    "levelColor": "#FF6B35",
    "trend": {
      "direction": "UP",
      "delta7d": 8.5,
      "description": "近7天依赖度上升了8.5分"
    },
    "dimensions": [
      {
        "name": "frequency",
        "label": "求助频率",
        "score": 72.5,
        "level": "HIGH",
        "suggestion": "今日AI求助15次，建议控制在10次以内"
      },
      {
        "name": "speed",
        "label": "求助速度",
        "score": 85.0,
        "level": "CRITICAL",
        "suggestion": "平均8.5秒即求助AI，建议先独立思考30秒"
      },
      {
        "name": "proportion",
        "label": "AI占比",
        "score": 68.0,
        "level": "HIGH",
        "suggestion": "AI辅助时长占75%，建议增加独立练习"
      },
      {
        "name": "outcome",
        "label": "学习效果",
        "score": 55.0,
        "level": "MODERATE",
        "suggestion": "独立正确率26.7%，AI辅助后知识留存率待提升"
      },
      {
        "name": "trend",
        "label": "变化趋势",
        "score": 78.0,
        "level": "HIGH",
        "suggestion": "依赖度持续上升中，需关注"
      }
    ],
    "intervention": {
      "active": true,
      "strategy": "GRADUAL_DELAY",
      "startedAt": "2026-07-10T00:00:00Z",
      "description": "已启用渐进式延迟策略，AI回答前会增加思考引导"
    },
    "comparison": {
      "peerAvgAidi": 52.3,
      "peerPercentile": 85,
      "description": "依赖度高于同龄人85%"
    }
  }
}
```

#### 3.2.3 获取干预策略（内部调用）

```
GET /api/v1/ai-dependency/intervention?studentId={studentId}&module={module}
```

此接口由 AI 对话引擎、练习引擎等模块在处理学生请求前调用，获取当前应该应用的辅助策略。

**响应：**
```json
{
  "code": 0,
  "data": {
    "studentId": 100001,
    "module": "ai_dialog",
    "strategy": "GRADUAL_DELAY",
    "config": {
      "thinkFirstPrompt": {
        "enabled": true,
        "minThinkTimeMs": 15000,
        "promptText": "先想想看，你已经学过这个知识点了~",
        "promptType": "gentle_reminder"
      },
      "answerRevealPolicy": {
        "defaultLevel": "hint",
        "hintLevels": ["keyword", "direction", "formula"],
        "fullAnswerDelayMs": 10000,
        "fullAnswerRequiresReason": true
      },
      "followUpPolicy": {
        "maxConsecutiveFollowUps": 3,
        "cooldownMs": 5000,
        "redirectToIntervention": true
      },
      "nudgeIndependence": {
        "enabled": true,
        "frequency": "every_3rd_ai_action",
        "message": "这道题你试试自己解，遇到困难再叫我~"
      }
    },
    "version": "v1.2.3",
    "expiresAt": "2026-07-11T23:59:59Z"
  }
}
```

#### 3.2.4 获取家长报告

```
GET /api/v1/ai-dependency/parent-report?studentId={studentId}&period=weekly
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "studentName": "小明",
    "reportPeriod": "2026-07-05 ~ 2026-07-11",
    "summary": {
      "avgAidi": 71.2,
      "level": "HIGH",
      "trend": "UP",
      "weeklyChange": 8.5,
      "concernLevel": "MODERATE",
      "concernText": "本周AI依赖度有所上升，建议关注"
    },
    "keyFindings": [
      {
        "type": "SPEED_INCREASE",
        "severity": "HIGH",
        "title": "求助速度加快",
        "detail": "平均8.5秒就向AI求助，比上周快了3秒",
        "recommendation": "鼓励孩子先独立思考1分钟"
      },
      {
        "type": "DIRECT_ANSWER_INCREASE",
        "severity": "MEDIUM",
        "title": "直接查看答案频率增加",
        "detail": "本周直接查看完整答案12次，占比26.7%",
        "recommendation": "引导孩子使用'提示'功能而非直接查看答案"
      },
      {
        "type": "INDEPENDENT_CORRECT",
        "severity": "POSITIVE",
        "title": "独立解题正确率有所提升",
        "detail": "数学独立正确率从15%提升到26.7%",
        "recommendation": "继续鼓励！可以适当减少AI辅助"
      }
    ],
    "subjectBreakdown": [
      {
        "subject": "数学",
        "aidi": 82,
        "level": "CRITICAL",
        "aiRatio": 0.82,
        "independentRatio": 0.18,
        "recommendation": "数学AI依赖最高，建议每天先独立完成3道题"
      },
      {
        "subject": "英语",
        "aidi": 45,
        "level": "LOW",
        "aiRatio": 0.45,
        "independentRatio": 0.55,
        "recommendation": "英语独立性强，继续保持"
      }
    ],
    "suggestedActions": [
      "与孩子一起回顾本周的学习内容，讨论哪些是自己独立完成的",
      "设置'独立思考时间'：每天前15分钟不使用AI辅助",
      "对独立完成的题目给予额外积分奖励"
    ]
  }
}
```

### 3.3 错误码定义

| 错误码 | HTTP 状态码 | 含义 | 处理建议 |
|--------|------------|------|---------|
| `ADE_001` | 400 | 事件类型不合法 | 检查 eventType 枚举 |
| `ADE_002` | 400 | 模块标识不合法 | 检查 module 枚举 |
| `ADE_003` | 403 | 无权操作该学生数据 | 检查权限令牌 |
| `ADE_004` | 404 | 学生档案不存在 | 确认 studentId |
| `ADE_005` | 409 | 事件时间超出接受窗口 | 事件发生时间与当前差超过24h |
| `ADE_006` | 422 | 特征数据不足无法评估 | 至少需要5条事件才能计算 |
| `ADE_101` | 500 | 特征计算异常 | 内部异常，重试 |
| `ADE_102` | 500 | AIDI 计算异常 | 内部异常，降级返回缓存值 |
| `ADE_103` | 500 | 干预策略匹配异常 | 降级为默认策略 |

---

## 4. 业务逻辑

### 4.1 核心流程总览

```
 ┌─────────────────────────────────────────────────────────────────┐
 │                     行为事件采集管道                              │
 │                                                                 │
 │  AI对话 ──┐    拍题答疑 ──┐    练习测评 ──┐    错题系统 ──┐      │
 │           │              │              │              │      │
 │           └──────────────┴──────────────┴──────────────┘      │
 │                              │                                  │
 │                    ┌─────────▼─────────┐                       │
 │                    │   事件标准化处理   │                       │
 │                    └─────────┬─────────┘                       │
 │                              │                                  │
 ├──────────────────────────────┼──────────────────────────────────┤
 │                     特征工程管道                                │
 │                              │                                  │
 │              ┌───────────────▼───────────────┐                 │
 │              │     特征向量构建 (5维度)        │                 │
 │              │  ┌──────┐ ┌──────┐ ┌────────┐ │                 │
 │              │  │时间维│ │频率维│ │尝试维  │ │                 │
 │              │  └──────┘ └──────┘ └────────┘ │                 │
 │              │  ┌──────────┐ ┌──────────┐   │                 │
 │              │  │ 模式维   │ │ 趋势维   │   │                 │
 │              │  └──────────┘ └──────────┘   │                 │
 │              └───────────────┬───────────────┘                 │
 │                              │                                  │
 ├──────────────────────────────┼──────────────────────────────────┤
 │                     评估管道                                    │
 │                              │                                  │
 │              ┌───────────────▼───────────────┐                 │
 │              │     AIDI 综合指数计算           │                 │
 │              │  Score = Σ(wᵢ × dim_scoreᵢ)   │                 │
 │              └───────────────┬───────────────┘                 │
 │                              │                                  │
 │              ┌───────────────▼───────────────┐                 │
 │              │     依赖等级分级               │                 │
 │              │  LOW / MODERATE / HIGH /       │                 │
 │              │  CRITICAL                      │                 │
 │              └───────────────┬───────────────┘                 │
 │                              │                                  │
 ├──────────────────────────────┼──────────────────────────────────┤
 │                     干预管道                                    │
 │                              │                                  │
 │     ┌────────────────────────▼────────────────────────┐        │
 │     │              干预策略决策器                       │        │
 │     │  Level × Subject × Trend × History → Strategy   │        │
 │     └────────────────────────┬────────────────────────┘        │
 │                              │                                  │
 │         ┌────────────────────┼────────────────────┐            │
 │         ▼                    ▼                    ▼            │
 │  ┌─────────────┐   ┌──────────────┐   ┌────────────────┐      │
 │  │ AI对话策略   │   │ 答案管控策略  │   │ 任务编排策略   │      │
 │  │ 下发        │   │ 下发          │   │ 下发           │      │
 │  └─────────────┘   └──────────────┘   └────────────────┘      │
 │                                                                 │
 ├─────────────────────────────────────────────────────────────────┤
 │                     效果跟踪管道                                │
 │                                                                 │
 │  干预前AIDI ──→ 干预后AIDI ──→ 效果评估 ──→ 策略迭代           │
 └─────────────────────────────────────────────────────────────────┘
```

### 4.2 AIDI（AI Dependency Index）计算算法

#### 4.2.1 五维度评分模型

每个维度归一化到 0-100 分，**分数越高表示依赖越严重**。

```python
class AIDICalculator:
    """
    AI 依赖度指数计算器
    综合五个维度加权得出 AIDI 分数
    """
    
    # 维度权重配置（可按学段动态调整）
    DIMENSION_WEIGHTS = {
        "frequency": 0.25,    # 求助频率维度
        "speed": 0.30,        # 求助速度维度
        "proportion": 0.20,   # AI占比维度
        "outcome": 0.15,      # 学习效果维度
        "trend": 0.10,        # 变化趋势维度
    }
    
    def calculate(self, features: dict, student_profile: dict) -> dict:
        """
        计算各维度分数和综合 AIDI
        
        Returns:
            {
                "aidi_score": float,
                "dependency_level": str,
                "dimension_scores": dict
            }
        """
        dim_scores = {}
        
        # 1. 频率维度
        dim_scores["frequency"] = self._calc_frequency_dim(
            features["frequencyBased"]
        )
        
        # 2. 速度维度
        dim_scores["speed"] = self._calc_speed_dim(
            features["timeBased"],
            features["attemptBased"],
            features["patternBased"]
        )
        
        # 3. 占比维度
        dim_scores["proportion"] = self._calc_proportion_dim(
            features["timeBased"],
            features["patternBased"]
        )
        
        # 4. 效果维度
        dim_scores["outcome"] = self._calc_outcome_dim(
            features["attemptBased"]
        )
        
        # 5. 趋势维度
        dim_scores["trend"] = self._calc_trend_dim(
            features["trendBased"]
        )
        
        # 加权综合
        aidi = sum(
            dim_scores[dim]["score"] * self.DIMENSION_WEIGHTS[dim]
            for dim in self.DIMENSION_WEIGHTS
        )
        
        # 学段校正因子
        aidi = self._apply_stage_correction(aidi, student_profile)
        
        level = self._score_to_level(aidi)
        
        return {
            "aidi_score": round(aidi, 2),
            "dependency_level": level,
            "dimension_scores": dim_scores
        }
```

#### 4.2.2 各维度计算细节

**频率维度评分：**

```python
def _calc_frequency_dim(self, freq_features: dict) -> dict:
    """
    频率维度：衡量AI求助的绝对频率和模式
    """
    score = 0.0
    
    # 日均AI操作次数（满分50分）
    # 基线：小学<8次正常，初中<12次，高中<15次
    daily_actions = freq_features["dailyAvgAiActions"]
    action_threshold = 10  # 可配置
    action_score = min(50, (daily_actions / action_threshold) * 50)
    score += action_score
    
    # 直接查看答案比例（满分25分）
    direct_ratio = freq_features.get("directAnswerRatio", 0)
    score += min(25, direct_ratio * 100)
    
    # 追问率（满分25分）
    # 高追问率可能表明没有理解第一次回答
    follow_up_ratio = freq_features.get("followUpRatio", 0)
    score += min(25, follow_up_ratio * 50)  # 追问率50%即满分
    
    return {
        "score": round(min(100, score), 2),
        "subMetrics": {
            "dailyAiActionCount": daily_actions,
            "directAnswerRatio": direct_ratio,
            "followUpRatio": follow_up_ratio
        }
    }
```

**速度维度评分：**

```python
def _calc_speed_dim(self, time_features: dict, 
                     attempt_features: dict,
                     pattern_features: dict) -> dict:
    """
    速度维度：衡量学生求助AI的速度和前置思考
    最关键的维度（权重0.30）
    """
    score = 0.0
    
    # 平均首次求助用时（满分40分）
    # 0秒=100分(秒求助)，5秒=80分，15秒=60分，30秒=40分，60秒+=20分
    avg_time_ms = time_features.get("avgTimeToFirstAiMs", 60000)
    avg_time_s = avg_time_ms / 1000
    if avg_time_s < 3:
        time_score = 40
    elif avg_time_s < 10:
        time_score = 40 - (avg_time_s - 3) * 2.86  # 3-10s 线性递减
    elif avg_time_s < 30:
        time_score = 20 - (avg_time_s - 10) * 0.5   # 10-30s
    else:
        time_score = max(5, 10 - (avg_time_s - 30) * 0.1)  # 30s+
    score += time_score
    
    # 零尝试比例（满分35分）
    # 0尝试 = 完全没有独立思考就求助AI
    zero_attempt = attempt_features.get("zeroAttemptRatio", 1.0)
    score += zero_attempt * 35
    
    # 提示跳过比例（满分25分）
    # 跳过提示直接看答案
    hint_skip = pattern_features.get("hintSkipRatio", 0)
    score += hint_skip * 25
    
    return {
        "score": round(min(100, score), 2),
        "subMetrics": {
            "avgTimeToFirstAiMs": avg_time_ms,
            "zeroAttemptRatio": zero_attempt,
            "hintSkipRatio": hint_skip
        }
    }
```

**学习效果维度评分：**

```python
def _calc_outcome_dim(self, attempt_features: dict) -> dict:
    """
    效果维度：评估AI辅助的实际学习效果
    低效果 + 高依赖 = 最危险
    """
    score = 0.0
    
    # 独立正确率（满分40分，反向：越低越依赖）
    # 独立正确率高说明学生真正掌握了
    independent_correct = attempt_features.get("independentCorrectRatio", 0)
    # 独立正确率越低，依赖分越高
    score += (1 - independent_correct) * 40
    
    # 同一知识点重复AI求助（满分30分）
    # 反复对同一知识点求助AI说明没学会
    repeat_kp = attempt_features.get("sameKnowledgePointAiCount", {})
    max_repeat = max(repeat_kp.values()) if repeat_kp else 0
    repeat_score = min(30, max_repeat * 6)  # 同一知识点求助5次=满分
    score += repeat_score
    
    # 知识留存率（满分30分，外部传入）
    # 通过间隔重复测试正确率衡量
    retention_rate = attempt_features.get("knowledgeRetentionRate", 0.5)
    score += (1 - retention_rate) * 30
    
    return {
        "score": round(min(100, score), 2),
        "subMetrics": {
            "independentCorrectRatio": independent_correct,
            "sameKnowledgePointRepeatAi": max_repeat,
            "knowledgeRetentionRate": retention_rate
        }
    }
```

#### 4.2.3 依赖等级分级标准

```python
def _score_to_level(self, score: float) -> str:
    """
    AIDI 分数 → 依赖等级
    
    等级     | 分数范围  | 含义                   | 颜色
    ---------|----------|------------------------|--------
    LOW      | 0-30     | 自主学习为主，AI为辅   | 绿色 #4CAF50
    MODERATE | 31-55    | AI辅助适度，基本均衡   | 黄色 #FFC107
    HIGH     | 56-75    | AI依赖较高，需要关注   | 橙色 #FF6B35
    CRITICAL | 76-100   | 严重依赖，需立即干预   | 红色 #F44336
    """
    if score <= 30:
        return "LOW"
    elif score <= 55:
        return "MODERATE"
    elif score <= 75:
        return "HIGH"
    else:
        return "CRITICAL"
```

#### 4.2.4 学段校正

```python
STAGE_CORRECTION = {
    "KINDERGARTEN": {"threshold_adjust": -5, "rationale": "幼儿阶段允许更多AI辅助"},
    "PRIMARY_LOW":  {"threshold_adjust": -3, "rationale": "小学低年级适当宽容"},
    "PRIMARY_HIGH": {"threshold_adjust": 0,  "rationale": "小学高年级标准基线"},
    "JUNIOR_HIGH":  {"threshold_adjust": +2, "rationale": "初中需要更多独立思考"},
    "SENIOR_HIGH":  {"threshold_adjust": +5, "rationale": "高中应高度自主"}
}

def _apply_stage_correction(self, score: float, profile: dict) -> float:
    stage = profile.get("stage", "PRIMARY_HIGH")
    correction = STAGE_CORRECTION.get(stage, {})
    adjusted = score + correction.get("threshold_adjust", 0)
    return max(0, min(100, adjusted))
```

### 4.3 干预策略决策器

#### 4.3.1 策略矩阵

```python
class InterventionStrategyDecider:
    """
    根据依赖等级、学科特征、历史效果选择干预策略
    """
    
    STRATEGY_MATRIX = {
        "LOW": {
            "action": "MONITOR_ONLY",
            "config": {
                "monitorFrequency": "daily",
                "noActiveIntervention": True,
                "positiveReinforcement": True  # 正向激励
            }
        },
        "MODERATE": {
            "action": "GENTLE_NUDGE",
            "config": {
                "thinkFirstReminder": {
                    "enabled": True,
                    "minThinkTimeMs": 10000,
                    "text": "先花10秒钟想想看~",
                    "frequency": "every_5th_ai_action"
                },
                "hintDefault": True,  # 默认展示提示而非答案
                "independenceBadge": True  # 独立完成题目给额外徽章
            }
        },
        "HIGH": {
            "action": "GRADUAL_DELAY",
            "config": {
                "thinkFirstPrompt": {
                    "enabled": True,
                    "minThinkTimeMs": 20000,
                    "text": "你已经学过这个知识点了，先试试自己解答",
                    "promptType": "educational_reminder",
                    "allowSkip": True  # 允许跳过但记录
                },
                "answerRevealPolicy": {
                    "defaultLevel": "hint",
                    "fullAnswerDelayMs": 15000,
                    "fullAnswerRequiresConfirmation": True
                },
                "followUpPolicy": {
                    "maxConsecutiveFollowUps": 3,
                    "cooldownMs": 8000,
                    "redirectToSimilarQuestion": True
                },
                "independenceChallenge": {
                    "dailyIndependentGoal": 3,
                    "rewardMultiplier": 2.0
                }
            }
        },
        "CRITICAL": {
            "action": "STRUCTURED_WEANING",
            "config": {
                "aiUsageLimit": {
                    "dailyMaxActions": 8,
                 