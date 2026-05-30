# 服务端 - AI对话自动摘要与知识提取引擎 - 详细设计

## 1. 文档概述

### 1.1 目的
本文档详细设计 PrimeTop AI辅导对话的**后处理引擎**：在每次AI辅导会话结束后，自动生成结构化对话摘要、提取涉及的知识点、识别学生的困惑点与错误认知，并将结果推送至学情分析、错题本、知识掌握度等下游系统。

### 1.2 背景
- AI辅导对话平均时长 5-15 分钟，学生很难事后回溯全部内容
- 现有「AI对话引擎与会话管理」聚焦于对话的实时管理，缺少对话结束后的结构化知识提取
- 学习报告、学情分析需要细粒度的知识点级别数据，而非整段对话文本
- 家长端学情报告需要可理解的「孩子今天学了什么」摘要

### 1.3 范围
| 包含 | 不包含 |
|------|--------|
| 对话摘要生成 | 实时对话管理 |
| 知识点提取与映射 | Prompt模板设计 |
| 学生困惑点/误解检测 | AI幻觉检测 |
| 情感/参与度评估 | 内容安全审核 |
| 摘要存储与查询API | 前端摘要展示组件 |
| 下游事件推送 | RAG检索增强 |

### 1.4 依赖
| 依赖服务 | 说明 |
|----------|------|
| AI对话引擎与会话管理 | 提供完整对话记录 |
| 知识点体系与教材映射引擎 | 知识点标准化映射 |
| 学习行为事件流 | 接收摘要生成事件 |
| AI-Prompt编排与场景模板系统 | 摘要Prompt模板管理 |
| 多模型调度与成本治理 | 模型调用与成本控制 |
| 用户学习画像与能力维度模型 | 下游知识掌握度更新 |

---

## 2. 整体架构

### 2.1 系统上下文

```
┌─────────────────────────────────────────────────────────────┐
│                      AI对话自动摘要引擎                       │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ 对话触发  │→│ 摘要生成  │→│ 知识提取  │→│ 事件推送   │  │
│  │ 检测器    │  │ 管道      │  │ 管道      │  │ 管道       │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────┘  │
│       ↑              ↑             ↑              │         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐        ↓         │
│  │ 触发规则  │  │ Prompt   │  │ 知识点    │  ┌───────────┐  │
│  │ 引擎     │  │ 模板库    │  │ 映射服务  │  │ 摘要存储   │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────┘  │
└─────────────────────────────────────────────────────────────┘
        ↑                                          │
        │ 对话结束事件                               │ 下游消费
   AI对话引擎                              ┌────────┼────────┐
                                           ↓        ↓        ↓
                                      学情分析   错题服务   学习报告
                                      画像更新   复习建议   家长推送
```

### 2.2 核心流程

```
对话结束 → 判断是否触发摘要 → 加载对话全文 → 调用LLM生成摘要
                                              → 调用LLM提取知识点
                                              → 知识点标准化映射
                                              → 检测困惑点/误解
                                              → 评估参与度
                                              → 结构化存储
                                              → 推送下游事件
```

### 2.3 技术选型

| 组件 | 选型 | 说明 |
|------|------|------|
| 消息队列 | RabbitMQ / Kafka | 接收对话结束事件 |
| 摘要LLM | 轻量级模型(GLM-4-Flash/Qwen-Turbo) | 成本敏感，用小模型 |
| 知识提取LLM | 同摘要模型 | 复用同一调用 |
| 存储 | MySQL(摘要主表) + Redis(热查询) | 主存储+缓存 |
| 知识点映射 | ES + 向量检索 | 知识点标准化匹配 |
| 定时任务 | XXL-Job | 离线补跑、重试 |

---

## 3. 数据结构设计

### 3.1 对话摘要主表 `ai_conversation_summary`

```sql
CREATE TABLE `ai_conversation_summary` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '摘要ID',
  `conversation_id` VARCHAR(64) NOT NULL COMMENT '对话ID',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
  `student_profile_id` BIGINT UNSIGNED NOT NULL COMMENT '学生档案ID',
  `subject_code` VARCHAR(16) NOT NULL COMMENT '学科代码(MATH/CHINESE/ENGLISH...)',
  `grade_code` VARCHAR(16) NOT NULL COMMENT '年级代码',
  `textbook_id` VARCHAR(64) DEFAULT NULL COMMENT '关联教材ID',
  `chapter_id` VARCHAR(64) DEFAULT NULL COMMENT '关联章节ID',

  -- 对话元数据
  `conversation_start_time` DATETIME NOT NULL COMMENT '对话开始时间',
  `conversation_end_time` DATETIME NOT NULL COMMENT '对话结束时间',
  `turn_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '对话轮次',
  `total_tokens` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '对话总token数',
  `trigger_source` VARCHAR(32) NOT NULL COMMENT '触发来源: USER_CLOSE/TIMEOUT/SESSION_EXPIRE/PROACTIVE',

  -- 摘要内容
  `summary_short` VARCHAR(255) NOT NULL COMMENT '一句话摘要(≤100字)',
  `summary_full` TEXT NOT NULL COMMENT '完整摘要(200-500字)',
  `summary_for_parent` VARCHAR(512) DEFAULT NULL COMMENT '家长端摘要(通俗语言)',

  -- 学习状态评估
  `engagement_level` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '参与度: 1-5分',
  `comprehension_level` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '理解度: 1-5分',
  `has_confusion` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否存在困惑点',
  `has_misconception` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否存在错误认知',
  `emotion_tendency` VARCHAR(16) DEFAULT 'NEUTRAL' COMMENT '情绪倾向: POSITIVE/NEUTRAL/FRUSTRATED/BORED',

  -- 质量与处理状态
  `summary_quality_score` DECIMAL(3,2) DEFAULT NULL COMMENT '摘要质量自评分 0-1',
  `llm_model_used` VARCHAR(64) NOT NULL COMMENT '使用的LLM模型标识',
  `llm_tokens_used` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '摘要生成消耗token',
  `processing_time_ms` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '处理耗时(毫秒)',
  `status` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '状态: 0-处理中 1-成功 2-失败 3-跳过',

  -- 审计字段
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_conversation_id` (`conversation_id`),
  KEY `idx_user_id_created` (`user_id`, `created_at`),
  KEY `idx_student_subject_time` (`student_profile_id`, `subject_code`, `conversation_end_time`),
  KEY `idx_status_created` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI对话摘要表';
```

### 3.2 知识点提取表 `conversation_knowledge_point`

```sql
CREATE TABLE `conversation_knowledge_point` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `summary_id` BIGINT UNSIGNED NOT NULL COMMENT '摘要ID',
  `conversation_id` VARCHAR(64) NOT NULL COMMENT '对话ID',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',

  -- 知识点映射
  `knowledge_point_id` VARCHAR(64) DEFAULT NULL COMMENT '标准化知识点ID',
  `knowledge_point_name` VARCHAR(128) NOT NULL COMMENT '知识点名称(提取原文)',
  `knowledge_point_normalized` VARCHAR(128) DEFAULT NULL COMMENT '标准化知识点名称',
  `chapter_code` VARCHAR(64) DEFAULT NULL COMMENT '章节代码',
  `difficulty_level` TINYINT UNSIGNED DEFAULT NULL COMMENT '知识点难度: 1-5',

  -- 出现上下文
  `mention_turn` SMALLINT UNSIGNED NOT NULL COMMENT '首次出现的对话轮次',
  `mention_context` VARCHAR(512) NOT NULL COMMENT '出现上下文(学生/AI发言摘要)',
  `depth_level` VARCHAR(16) NOT NULL COMMENT '讨论深度: MENTIONED/BRIEF/DEEP/MASTERED',
  `student_mastery_hint` VARCHAR(16) DEFAULT NULL COMMENT '掌握度暗示: STRONG/MODERATE/WEAK/UNKNOWN',

  -- 排序与权重
  `relevance_score` DECIMAL(3,2) NOT NULL DEFAULT 0.5 COMMENT '相关度得分 0-1',
  `sort_order` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '排序序号',

  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_summary_id` (`summary_id`),
  KEY `idx_user_kp` (`user_id`, `knowledge_point_id`),
  KEY `idx_conversation_id` (`conversation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='对话知识点提取表';
```

### 3.3 困惑点与误解记录表 `conversation_confusion_point`

```sql
CREATE TABLE `conversation_confusion_point` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `summary_id` BIGINT UNSIGNED NOT NULL COMMENT '摘要ID',
  `conversation_id` VARCHAR(64) NOT NULL COMMENT '对话ID',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',

  -- 困惑点信息
  `type` VARCHAR(16) NOT NULL COMMENT '类型: CONFUSION/MISCONCEPTION/GAP',
  `description` VARCHAR(512) NOT NULL COMMENT '困惑点/误解描述',
  `evidence_quote` VARCHAR(512) DEFAULT NULL COMMENT '对话中的证据原文',
  `evidence_turn` SMALLINT UNSIGNED NOT NULL COMMENT '证据所在轮次',

  -- 关联知识点
  `related_knowledge_point_id` VARCHAR(64) DEFAULT NULL COMMENT '关联知识点ID',
  `related_knowledge_point_name` VARCHAR(128) DEFAULT NULL COMMENT '关联知识点名称',

  -- AI的处理方式
  `ai_addressed` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'AI是否已解答此困惑',
  `ai_resolution_summary` VARCHAR(512) DEFAULT NULL COMMENT 'AI的解答摘要',
  `resolution_turn` SMALLINT UNSIGNED DEFAULT NULL COMMENT '解答所在轮次',

  -- 后续建议
  `suggested_action` VARCHAR(32) DEFAULT NULL COMMENT '建议动作: REVIEW/PRACTICE/ASK_TEACHER/NONE',
  `suggested_exercise_type` VARCHAR(32) DEFAULT NULL COMMENT '建议练习类型',

  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_summary_id` (`summary_id`),
  KEY `idx_user_type` (`user_id`, `type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='对话困惑点与误解记录表';
```

### 3.4 对话参与度时序数据 `conversation_engagement_timeseries`

```sql
CREATE TABLE `conversation_engagement_timeseries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `conversation_id` VARCHAR(64) NOT NULL,
  `turn_number` SMALLINT UNSIGNED NOT NULL,
  `timestamp` DATETIME NOT NULL,

  -- 行为指标
  `response_time_ms` INT UNSIGNED DEFAULT NULL COMMENT '学生响应时间(毫秒)',
  `student_msg_length` SMALLINT UNSIGNED DEFAULT NULL COMMENT '学生消息字符数',
  `interaction_type` VARCHAR(16) DEFAULT NULL COMMENT '互动类型: QUESTION/ANSWER/FOLLOWUP/TYPING/DRAWING',

  -- 参与度评分(滑动窗口)
  `engagement_score` DECIMAL(3,2) DEFAULT NULL COMMENT '当前轮次参与度 0-1',

  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_conversation_turn` (`conversation_id`, `turn_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='对话参与度时序数据';
```

---

## 4. API接口设计

### 4.1 内部触发接口

#### POST /internal/v1/summary/trigger
触发对话摘要生成（由AI对话引擎调用）。

**请求：**
```json
{
  "conversationId": "conv_20260530_abc123",
  "userId": 100001,
  "studentProfileId": 500001,
  "subjectCode": "MATH",
  "gradeCode": "G8",
  "textbookId": "tb_renjiao_math_8a",
  "chapterId": "ch_8a_03_linear_equations",
  "triggerSource": "USER_CLOSE",
  "turnCount": 12,
  "totalTokens": 3840,
  "startTime": "2026-05-30T19:30:00+08:00",
  "endTime": "2026-05-30T19:45:00+08:00",
  "priority": "NORMAL"
}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "summaryId": 20260530001,
    "status": "PROCESSING",
    "estimatedCompletionMs": 5000
  }
}
```

**处理逻辑：**
1. 校验对话是否存在且未生成过摘要
2. 判断是否满足触发条件（轮次≥2 或 时长≥2分钟）
3. 异步投递到摘要生成队列
4. 立即返回 summaryId

#### POST /internal/v1/summary/batch-trigger
批量触发（用于离线补跑）。

```json
{
  "conversationIds": ["conv_001", "conv_002"],
  "overrideExisting": false,
  "priority": "LOW"
}
```

### 4.2 摘要查询接口

#### GET /api/v1/users/{userId}/conversation-summaries
查询用户的对话摘要列表。

**参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| subjectCode | String | 否 | 学科过滤 |
| startDate | String | 否 | 起始日期 YYYY-MM-DD |
| endDate | String | 否 | 结束日期 YYYY-MM-DD |
| hasConfusion | Boolean | 否 | 是否有困惑点 |
| page | Integer | 否 | 页码(默认1) |
| size | Integer | 否 | 每页条数(默认20, 最大50) |

**响应：**
```json
{
  "code": 0,
  "data": {
    "total": 42,
    "items": [
      {
        "summaryId": 20260530001,
        "conversationId": "conv_20260530_abc123",
        "subjectCode": "MATH",
        "subjectName": "数学",
        "summaryShort": "学习了二元一次方程组的解法，掌握了代入消元法和加减消元法",
        "conversationEndTime": "2026-05-30T19:45:00+08:00",
        "turnCount": 12,
        "engagementLevel": 4,
        "comprehensionLevel": 3,
        "hasConfusion": true,
        "knowledgePointCount": 3,
        "topKnowledgePoints": [
          {
            "name": "二元一次方程组",
            "masteryHint": "MODERATE"
          },
          {
            "name": "代入消元法",
            "masteryHint": "WEAK"
          }
        ]
      }
    ]
  }
}
```

#### GET /api/v1/conversation-summaries/{summaryId}
获取摘要详情（含知识点列表、困惑点列表）。

**响应：**
```json
{
  "code": 0,
  "data": {
    "summaryId": 20260530001,
    "conversationId": "conv_20260530_abc123",
    "subjectCode": "MATH",
    "gradeCode": "G8",
    "chapterName": "第三章 二元一次方程组",
    "summaryShort": "学习了二元一次方程组的解法，掌握了代入消元法和加减消元法",
    "summaryFull": "本次辅导共12轮对话。学生询问了二元一次方程组的解法，AI首先用生活例子（鸡兔同笼）引入概念，然后分步讲解了代入消元法的步骤：1) 从一个方程中解出一个未知数 2) 代入另一个方程 3) 求解并回代。学生在第8轮出现困惑，混淆了'用一个未知数表示另一个'的方向。AI通过具体数值例子重新讲解后学生理解。随后引入加减消元法，学生理解较快。",
    "summaryForParent": "孩子今天学习了数学中的二元一次方程组，主要学习了两种解题方法。整体学习态度认真，但对代入消元法的步骤还有些不够熟练，建议多做几道练习题巩固。",
    "engagementLevel": 4,
    "comprehensionLevel": 3,
    "emotionTendency": "POSITIVE",
    "hasConfusion": true,
    "hasMisconception": false,
    "conversationStartTime": "2026-05-30T19:30:00+08:00",
    "conversationEndTime": "2026-05-30T19:45:00+08:00",
    "turnCount": 12,
    "knowledgePoints": [
      {
        "knowledgePointId": "kp_math_g8_0301",
        "name": "二元一次方程组的概念",
        "normalized": "二元一次方程组的定义与基本概念",
        "depthLevel": "BRIEF",
        "masteryHint": "STRONG",
        "relevanceScore": 0.9
      },
      {
        "knowledgePointId": "kp_math_g8_0302",
        "name": "代入消元法",
        "normalized": "代入消元法解二元一次方程组",
        "depthLevel": "DEEP",
        "masteryHint": "WEAK",
        "relevanceScore": 0.95
      },
      {
        "knowledgePointId": "kp_math_g8_0303",
        "name": "加减消元法",
        "normalized": "加减消元法解二元一次方程组",
        "depthLevel": "BRIEF",
        "masteryHint": "MODERATE",
        "relevanceScore": 0.7
      }
    ],
    "confusionPoints": [
      {
        "type": "CONFUSION",
        "description": "代入消元时混淆了应该从哪个方程解出哪个未知数",
        "evidenceQuote": "学生: \"是把x从第一个式子里解出来，还是从第二个？我总是搞反\"",
        "evidenceTurn": 8,
        "aiAddressed": true,
        "aiResolutionSummary": "AI通过鸡兔同笼具体数值演示了选择策略：选系数为1的未知数更容易计算",
        "suggestedAction": "PRACTICE",
        "suggestedExerciseType": "SUBSTITUTION_METHOD"
      }
    ]
  }
}
```

### 4.3 家长端接口

#### GET /api/v1/parents/{parentId}/children/{childId}/daily-summaries
获取孩子每日学习摘要（家长端）。

**参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| date | String | 否 | 日期，默认今天 |
| subjectCode | String | 否 | 学科过滤 |

**响应：**
```json
{
  "code": 0,
  "data": {
    "date": "2026-05-30",
    "childName": "小明",
    "gradeName": "八年级",
    "totalConversations": 3,
    "totalStudyMinutes": 42,
    "overallEngagement": 4,
    "dailyBrief": "今天共进行了3次AI辅导，重点学习了数学（二元一次方程组）、英语（现在完成时）和语文（古诗文赏析）。数学方面有个小困惑已解决，建议今晚复习代入消元法的练习题。",
    "summaries": [
      {
        "summaryId": 20260530001,
        "subjectCode": "MATH",
        "subjectName": "数学",
        "summaryForParent": "孩子今天学习了数学中的二元一次方程组...",
        "conversationEndTime": "2026-05-30T19:45:00+08:00",
        "studyMinutes": 15,
        "engagementLevel": 4,
        "comprehensionLevel": 3,
        "hasConfusion": true,
        "confusionResolved": true
      }
    ],
    "suggestions": [
      {
        "subjectCode": "MATH",
        "message": "建议今晚复习代入消元法，做3-5道基础题巩固",
        "priority": "HIGH"
      }
    ]
  }
}
```

### 4.4 管理后台接口

#### GET /admin/v1/summaries/statistics
摘要生成统计。

**参数：** `startDate`, `endDate`, `groupBy(DAY/SUBJECT/GRADE)`

#### POST /admin/v1/summaries/{summaryId}/retry
手动重试失败的摘要生成。

#### PUT /admin/v1/summaries/config
更新摘要生成配置（触发阈值、Prompt模板等）。

---

## 5. 核心处理流程

### 5.1 触发检测与决策

```java
@Service
public class SummaryTriggerService {

    @Autowired
    private SummaryConfigRepository configRepo;

    @Autowired
    private MessageQueueService mqService;

    /**
     * 判断是否触发摘要生成
     */
    public TriggerDecision evaluateTrigger(ConversationEndEvent event) {
        SummaryConfig config = configRepo.getActiveConfig();

        // 规则1: 最少轮次检查
        if (event.getTurnCount() < config.getMinTurnThreshold()) {
            // 轮次太少，记录但不生成摘要
            return TriggerDecision.skip("TURN_COUNT_BELOW_THRESHOLD",
                "对话仅" + event.getTurnCount() + "轮，低于最小阈值" + config.getMinTurnThreshold());
        }

        // 规则2: 最短时长检查
        long durationMinutes = ChronoUnit.MINUTES.between(
            event.getStartTime(), event.getEndTime());
        if (durationMinutes < config.getMinDurationMinutes()) {
            return TriggerDecision.skip("DURATION_BELOW_THRESHOLD",
                "对话时长仅" + durationMinutes + "分钟");
        }

        // 规则3: 幼儿启蒙场景特殊处理 - 降低阈值
        if (isEarlyChildhood(event.getGradeCode()) && event.getTurnCount() >= 1) {
            return TriggerDecision.trigger("EARLY_CHILDHOOD_OVERRIDE");
        }

        // 规则4: 检查是否已有摘要（幂等）
        if (summaryRepo.existsByConversationId(event.getConversationId())) {
            return TriggerDecision.skip("ALREADY_SUMMARIZED", "摘要已存在");
        }

        // 规则5: 检查当日摘要生成配额（成本控制）
        int todayCount = summaryRepo.countTodayByUser(event.getUserId());
        if (todayCount >= config.getMaxDailySummariesPerUser()) {
            return TriggerDecision.skip("DAILY_QUOTA_EXCEEDED",
                "今日已生成" + todayCount + "条摘要");
        }

        // 规则6: 根据对话质量评分决定是否值得摘要
        float conversationQuality = estimateConversationQuality(event);
        if (conversationQuality < config.getMinQualityScore()) {
            return TriggerDecision.skip("LOW_QUALITY",
                "对话质量评分" + conversationQuality + "低于阈值");
        }

        return TriggerDecision.trigger("NORMAL");
    }

    /**
     * 粗略估算对话质量(不调用LLM，基于规则)
     */
    private float estimateConversationQuality(ConversationEndEvent event) {
        float score = 0.5f;
        // 轮次越多越可能是有意义的对话
        score += Math.min(0.2f, event.getTurnCount() * 0.02f);
        // 时长越长越有价值
        long minutes = ChronoUnit.MINUTES.between(event.getStartTime(), event.getEndTime());
        score += Math.min(0.2f, minutes * 0.02f);
        // token消耗越多说明内容越丰富
        score += Math.min(0.1f, event.getTotalTokens() / 5000f);
        return Math.min(1.0f, score);
    }
}
```

### 5.2 对话预处理与分块

```java
@Service
public class ConversationPreprocessor {

    /**
     * 将原始对话记录转换为LLM可处理的格式
     */
    public ProcessedConversation process(ConversationRecord conversation) {
        ProcessedConversation result = new ProcessedConversation();
        result.setConversationId(conversation.getId());

        // 1. 按轮次组织消息
        List<TurnMessage> turns = conversation.getMessages().stream()
            .filter(m -> m.getRole() != Role.SYSTEM) // 过滤系统消息
            .map(this::toTurnMessage)
            .collect(Collectors.toList());
        result.setTurns(turns);

        // 2. 提取学生消息占比(参与度指标之一)
        long studentMsgCount = turns.stream()
            .filter(t -> t.getRole() == Role.STUDENT)
            .count();
        result.setStudentMessageRatio((float) studentMsgCount / turns.size());

        // 3. 检测是否包含图片/公式等特殊内容
        boolean hasImage = turns.stream()
            .anyMatch(t -> t.getContentType() == ContentType.IMAGE);
        boolean hasFormula = turns.stream()
            .anyMatch(t -> t.getContentType() == ContentType.FORMULA);
        result.setHasImage(hasImage);
        result.setHasFormula(hasFormula);

        // 4. 截断过长对话(保留关键轮次)
        String truncatedText = truncateConversation(turns);
        result.setProcessedText(truncatedText);

        // 5. 提取元数据
        result.setSubjectCode(conversation.getSubjectCode());
        result.setGradeCode(conversation.getGradeCode());
        result.setTextbookId(conversation.getTextbookId());

        return result;
    }

    /**
     * 智能截断：保留首尾轮次 + 中间关键轮次
     * 控制在约4000 tokens内
     */
    private String truncateConversation(List<TurnMessage> turns) {
        if (turns.size() <= 20) {
            // 20轮以内全部保留
            return formatTurns(turns);
        }

        List<TurnMessage> selected = new ArrayList<>();
        // 保留前5轮(对话开场)
        selected.addAll(turns.subList(0, Math.min(5, turns.size())));
        // 保留最后5轮(对话结尾，通常包含结论)
        selected.addAll(turns.subList(Math.max(0, turns.size() - 5), turns.size()));
        // 中间轮次：选择学生提问或关键转折点
        List<TurnMessage> middle = turns.subList(5, Math.max(5, turns.size() - 5));
        middle.stream()
            .filter(t -> t.isStudentQuestion() || t.isTopicShift() || t.hasFormula())
            .limit(10)
            .forEach(selected::add);

        // 按轮次排序
        selected.sort(Comparator.comparingInt(TurnMessage::getTurnNumber));

        StringBuilder sb = new StringBuilder();
        for (TurnMessage turn : selected) {
            sb.append(formatTurn(turn)).append("\n");
        }
        // 在截断处标记
        sb.append("\n[注：对话共").append(turns.size()).append("轮，已精简展示]");
        return sb.toString();
    }
}
```

### 5.3 摘要生成核心服务

```java
@Service
@Slf4j
public class SummaryGenerationService {

    @Autowired
    private LlmClientFactory llmClientFactory;

    @Autowired
    private PromptTemplateManager promptManager;

    @Autowired
    private KnowledgePointMapper kpMapper;

    @Autowired
    private SummaryStorageService storageService;

    @Autowired
    private EventPublisher eventPublisher;

    private static final String SUMMARY_MODEL = "glm-4-flash";

    /**
     * 核心方法：生成对话摘要
     */
    @Retryable(maxAttempts = 2, backoff = @Backoff(delay = 2000))
    public ConversationSummary generateSummary(ProcessedConversation conversation) {
        long startTime = System.currentTimeMillis();

        try {
            // 1. 构建摘要Prompt
            String summaryPrompt = buildSummaryPrompt(conversation);

            // 2. 构建知识点提取Prompt
            String kpPrompt = buildKnowledgePointPrompt(conversation);

            // 3. 构建困惑点检测Prompt
            String confusionPrompt = buildConfusionDetectionPrompt(conversation);

            // 4. 调用LLM - 可以合并为一次调用减少成本
            LlmRequest request = LlmRequest.builder()
                .model(SUMMARY_MODEL)
                .temperature(0.3) // 低温度保证稳定性
                .maxTokens(2000)
                .build();

            // 单次调用输出所有维度
            String combinedPrompt = buildCombinedPrompt(
                summaryPrompt, kpPrompt, confusionPrompt, conversation);
            request.setMessages(List.of(
                Message.system(combinedPrompt),
                Message.user(conversation.getProcessedText())
            ));

            LlmResponse response = llmClientFactory.getClient(SUMMARY_MODEL).chat(request);
            String content = response.getContent();

            // 5. 解析结构化输出
            SummaryOutput output = parseStructuredOutput(content);

            // 6. 知识点标准化映射
            List<ExtractedKnowledgePoint> mappedKps = output.getKnowledgePoints().stream()
                .map(kp -> kpMapper.mapToStandard(kp, conversation.getSubjectCode(),
                    conversation.getGradeCode()))
                .filter(Optional::isPresent)
                .map(Optional::get)
                .collect(Collectors.toList());

            // 7. 组装摘要对象
            ConversationSummary summary = ConversationSummary.builder()
                .conversationId(conversation.getConversationId())
                .userId(conversation.getUserId())
                .studentProfileId(conversation.getStudentProfileId())
                .subjectCode(conversation.getSubjectCode())
                .gradeCode(conversation.getGradeCode())
                .summaryShort(output.getShortSummary())
                .summaryFull(output.getFullSummary())
                .summaryForParent(output.getParentSummary())
                .engagementLevel(output.getEngagementLevel())
                .comprehensionLevel(output.getComprehensionLevel())
                .hasConfusion(output.getConfusionPoints() != null
                    && !output.getConfusionPoints().isEmpty())
                .hasMisconception(output.getConfusionPoints() != null
                    && output.getConfusionPoints().stream()
                        .anyMatch(cp -> cp.getType() == "MISCONCEPTION"))
                .emotionTendency(output.getEmotionTendency())
                .llmModelUsed(SUMMARY_MODEL)
                .llmTokensUsed(response.getUsage().getTotalTokens())
                .processingTimeMs(System.currentTimeMillis() - startTime)
                .status(SummaryStatus.SUCCESS)
                .build();

            // 8. 存储
            summary = storageService.save(summary, mappedKps, output.getConfusionPoints());

            // 9. 推送下游事件
            publishDownstreamEvents(summary, mappedKps, output.getConfusionPoints());

            return summary;

        } catch (Exception e) {
            log.error("摘要生成失败, conversationId={}",
                conversation.getConversationId(), e);
            storageService.saveFailed(
                conversation.getConversationId(),
                SUMMARY_MODEL,
                System.currentTimeMillis() - startTime,
                e.getMessage()
            );
            throw e; // 触发重试
        }
    }
}
```

### 5.4 Prompt模板设计

#### 5.4.1 综合提取Prompt

```
你是一个教育对话分析专家。请分析以下学生与AI辅导老师的对话记录，按要求输出结构化分析结果。

## 学生信息
- 年级：{{gradeName}}
- 学科：{{subjectName}}
- 教材版本：{{textbookName}}
- 当前章节：{{chapterName}}

## 分析要求

### 1. 对话摘要
- summary_short: 一句话概括(≤100字)，描述本次对话的学习内容和成果
- summary_full: 完整摘要(200-500字)，包括：学习主题、讲解过程、学生互动、关键结论
- summary_for_parent: 面向家长的通俗版摘要(≤200字)，避免专业术语，强调学习态度和需要关注的问题

### 2. 知识点提取
提取对话中涉及的所有知识点，每个包含：
- name: 知识点名称
- depth: 讨论深度 MENTIONED(仅提及)/BRIEF(简单讨论)/DEEP(深入讲解)/MASTERED(学生已掌握)
- mastery_hint: 学生掌握度暗示 STRONG/MODERATE/WEAK/UNKNOWN
- mention_context: 该知识点在什么上下文中被讨论(≤100字)
- relevance_score: 与本次对话核心主题的相关度 0-1

### 3. 困惑点与误解检测
识别学生的困惑点、错误认知或知识缺口：
- type: CONFUSION(困惑)/MISCONCEPTION(错误认知)/GAP(知识缺口)
- description: 清晰描述学生的困惑或误解
- evidence: 对话中体现这一点的原文引用
- evidence_turn: 所在轮次
- ai_addressed: AI是否已处理此问题 true/false
- ai_resolution: AI如何解答的(如果已解答)
- suggested_action: 建议后续动作 REVIEW/PRACTICE/ASK_TEACHER/NONE

### 4. 学习状态评估
- engagement_level: 参与度1-5(1=被动应付 5=积极追问)
- comprehension_level: 理解度1-5(1=完全不理解 5=融会贯通)
- emotion_tendency: 情绪倾向 POSITIVE/NEUTRAL/FRUSTRATED/BORED/CONFIDENT
- summary_quality_note: 对本次摘要质量的备注(如有不确定之处)

## 输出格式
严格输出JSON，不要包含其他内容：
```json
{
  "summary_short": "...",
  "summary_full": "...",
  "summary_for_parent": "...",
  "knowledge_points": [...],
  "confusion_points": [...],
  "engagement_level": 4,
  "comprehension_level": 3,
  "emotion_tendency": "POSITIVE"
}
```

## 注意事项
1. 知识点名称应尽量使用教材标准术语
2. 区分「学生真的理解」和「只是重复了AI的话」
3. 如果对话太短或信息不足，字段可以设为null
4. 不要编造对话中不存在的信息
5. 家长版摘要应关注学习态度和方法，而非具体知识点
```

### 5.5 知识点标准化映射

```java
@Service
public class KnowledgePointMapper {

    @Autowired
    private KnowledgePointRepository kpRepo;

    @Autowired
    private ElasticsearchTemplate esTemplate;

    // 本地缓存：知识点名称 → 标准知识点
    private final LoadingCache<String, List<KnowledgePoint>> kpCache =
        Caffeine.newBuilder()
            .maximumSize(10000)
            .expireAfterWrite(Duration.ofHours(6))
            .build(this::searchKnowledgePoints);

    /**
     * 将LLM提取的知识点名称映射到标准化知识点体系
     */
    public Optional<ExtractedKnowledgePoint> mapToStandard(
            RawKnowledgePoint rawKp, String subjectCode, String gradeCode) {

        String name = rawKp.getName();
        List<KnowledgePoint> candidates = kpCache.get(
            subjectCode + ":" + name);

        if (candidates == null || candidates.isEmpty()) {
            // 精确匹配失败，尝试模糊匹配
            candidates = fuzzyMatch(name, subjectCode, gradeCode);
        }

        if (candidates.isEmpty()) {
            log.warn("知识点映射失败, name={}, subject={}", name, subjectCode);
            // 返回未映射的原始知识点
            return Optional.of(ExtractedKnowledgePoint.unmapped(rawKp));
        }

        // 选择最匹配的知识点(考虑年级范围)
        KnowledgePoint best = selectBestMatch(candidates, gradeCode);
        return Optional.of(ExtractedKnowledgePoint.mapped(rawKp, best));
    }

    private List<KnowledgePoint> fuzzyMatch(String name, String subject, String grade) {
        // 1. ES模糊搜索
        NativeSearchQuery query = new NativeSearchQueryBuilder()
            .withQuery(QueryBuilders.boolQuery()
                .must(QueryBuilders.termQuery("subjectCode", subject))
                .should(QueryBuilders.matchQuery("name", name)
                    .fuzziness(Fuzziness.AUTO).boost(2.0f))
                .should(QueryBuilders.matchQuery("aliases", name)
                    .boost(1.5f))
                .should(QueryBuilders.matchQuery("keywords", name)
                    .boost(1.0f))
            )
            .withMaxResults(5)
            .build();

        SearchHits<KnowledgePointDoc> hits =
            esTemplate.search(query, KnowledgePointDoc.class);

        return hits.stream()
            .filter(h -> h.getScore() >= 5.0f) // 最低相关度阈值
            .map(h -> convertToKnowledgePoint(h.getContent()))
            .collect(Collectors.toList());
    }
}
```

---

## 6. 下游事件推送

### 6.1 事件定义

```java
/** 摘要生成完成事件 */
public class SummaryCompletedEvent {
    private Long summaryId;
    private String conversationId;
    private Long userId;
    private Long studentProfileId;
    private String subjectCode;
    private String gradeCode;
    private String summaryShort;
    private int engagementLevel;
    private int comprehensionLevel;
    private List<KnowledgePointMention> knowledgePoints;
    private List<ConfusionPointMention> confusionPoints;
    private LocalDateTime occurredAt;
}

/** 知识点掌握度更新事件 */
public class KnowledgeMasteryUpdateEvent {
    private Long userId;
    private String subjectCode;
    private String knowledgePointId;
    private String masteryHint; // STRONG/MODERATE/WEAK
    private String source; // "CONVERSATION_SUMMARY"
    private String sourceId; // summaryId
    private LocalDateTime occurredAt;
}

/** 困惑点检测事件(推送到错题/复习系统) */
public class ConfusionDetectedEvent {
    private Long userId;
    private String subjectCode;
    private String type; // CONFUSION/MISCONCEPTION/GAP
    private String description;
    private String relatedKnowledgePointId;
    private String suggestedAction;
    private Long sourceSummaryId;
    private LocalDateTime occurredAt;
}
```

### 6.2 事件推送路由

```java
@Service
public class SummaryEventPublisher {

    @Autowired
    private MessageQueueService mqService;

    private static final String EXCHANGE = "summary.events";

    public void publishDownstreamEvents(ConversationSummary summary,
            List<ExtractedKnowledgePoint> knowledgePoints,
            List<ConfusionPoint> confusionPoints) {

        // 1. 发送摘要完成事件(通用)
        SummaryCompletedEvent completedEvent = buildCompletedEvent(
            summary, knowledgePoints, confusionPoints);
        mqService.publish(EXCHANGE, "summary.completed", completedEvent);

        // 2. 为每个知识点发送掌握度更新事件
        for (ExtractedKnowledgePoint kp : knowledgePoints) {
            if (kp.getStandardId() != null && kp.getMasteryHint() != null) {
                KnowledgeMasteryUpdateEvent kpEvent = new KnowledgeMasteryUpdateEvent()
                    .setUserId(summary.getUserId())
                    .setSubjectCode(summary.getSubjectCode())
                    .setKnowledgePointId(kp.getStandardId())
                    .setMasteryHint(kp.getMasteryHint())
                    .setSource("CONVERSATION_SUMMARY")
                    .setSourceId(String.valueOf(summary.getId()));
                mqService.publish(EXCHANGE,
                    "summary.knowledge-mastery", kpEvent);
            }
        }

        // 3. 为每个困惑点发送事件
        for (ConfusionPoint cp : confusionPoints) {
            ConfusionDetectedEvent cpEvent = new ConfusionDetectedEvent()
                .setUserId(summary.getUserId())
                .setSubjectCode(summary.getSubjectCode())
                .setType(cp.getType())
                .setDescription(cp.getDescription())
                .setRelatedKnowledgePointId(cp.getRelatedKpId())
                .setSuggestedAction(cp.getSuggestedAction())
                .setSourceSummaryId(summary.getId());
            mqService.publish(EXCHANGE, "summary.confusion-detected", cpEvent);
        }

        // 4. 如果是家长绑定的学生，发送家长通知事件
        if (summary.isParentLinked()) {
            mqService.publish(EXCHANGE, "summary.parent-notification",
                buildParentNotification(summary));
        }
    }
}
```

---

## 7. 状态流转

### 7.1 摘要处理状态机

```
                    ┌──────────┐
     触发请求 ───→ │ PENDING   │
                    └────┬─────┘
                         │ 投递队列成功
                         ↓
                    ┌──────────┐
                    │PROCESSING│ ←── 重试(最多2次)
                    └────┬─────┘
                         │
                ┌────────┼────────┐
                │        │        │
                ↓        ↓        ↓
          ┌─────────┐┌────────┐┌───────┐
          │ SUCCESS ││ FAILED ││SKIPPED│
          └────┬────┘└───┬────┘└───────┘
               │         │
               │    ┌────┴────┐
               │    │RETRYING │
               │    └────┬────┘
               │         │ 超过重试次数
               │         ↓
               │    ┌──────────┐
               │    │DEAD_LETTER│
               │    └──────────┘
               │
               ↓
          事件推送 → 下游消费
```

### 7.2 状态定义

| 状态 | 说明 | 后续动作 |
|------|------|----------|
| PENDING | 已创建，等待处理 | 队列消费 |
| PROCESSING | 正在调用LLM生成 | 等待完成或超时 |
| SUCCESS | 生成成功 | 推送下游事件 |
| FAILED | 生成失败 | 自动重试 |
| SKIPPED | 不满足条件被跳过 | 记录日志 |
| DEAD_LETTER | 重试耗尽 | 告警 + 人工处理 |

---

## 8. 错误处理

### 8.1 异常分类与策略

| 异常类型 | 具体场景 | 处理策略 |
|----------|----------|----------|
| LLM调用超时 | 模型响应慢/网络问题 | 重试2次，间隔2s |
| LLM返回格式错误 | JSON解析失败 | 重试1次，降级为仅摘要模式 |
| LLM内容截断 | 输出超maxTokens | 使用已获取内容，标记partial |
| 知识点映射全部失败 | 无法匹配任何知识点 | 保存原始名称，后续人工校准 |
| 对话记录不存在 | conversationId无效 | 跳过并记录warn日志 |
| 对话记录为空 | 无学生消息 | 跳过(status=SKIPPED) |
| 存储写入失败 | DB连接问题 | 重试3次，进入死信队列 |
| MQ推送失败 | 消息队列不可用 | 本地暂存，定时补发 |
| 并发重复触发 | 同一对话重复请求 | 幂等检查，返回已有摘要 |

### 8.2 降级策略

```java
@Service
public class SummaryFallbackService {

    /**
     * 降级策略：仅生成简短摘要，跳过知识点提取
     */
    public ConversationSummary fallbackSummary(ProcessedConversation conversation) {
        // 使用更短的Prompt，仅要求一句话摘要
        String prompt = "请用一句话概括以下对话的学习内容(≤50字):\n\n"
            + truncateTo(conversation.getProcessedText(), 1000);

        LlmResponse response = llmClient.chat(SUMMARY_MODEL, prompt);

        return ConversationSummary.builder()
            .conversationId(conversation.getConversationId())
            .summaryShort(response.getContent())
            .summaryFull(response.getContent()) // 降级时short=full
            .status(SummaryStatus.SUCCESS_PARTIAL)
            .build();
    }

    /**
     * 完全降级：基于规则生成摘要，不调用LLM
     */
    public ConversationSummary ruleBasedSummary(ProcessedConversation conversation) {
        String subject = conversation.getSubjectName();
        int turns = conversation.getTurns().size();
        long minutes = conversation.getDurationMinutes();

        String shortSummary = String.format(
            "进行了%d分钟的%s学习，共%d轮对话", minutes, subject, turns);

        return ConversationSummary.builder()
            .conversationId(conversation.getConversationId())
            .summaryShort(shortSummary)
            .status(SummaryStatus.SUCCESS_RULE_BASED)
            .build();
    }
}
```

---

## 9. 配置管理

### 9.1 摘要配置表 `summary_generation_config`

```sql
CREATE TABLE `summary_generation_config` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `config_key` VARCHAR(64) NOT NULL COMMENT '配置键',
  `config_value` VARCHAR(512) NOT NULL COMMENT '配置值',
  `value_type` VARCHAR(16) NOT NULL DEFAULT 'STRING' COMMENT '值类型: STRING/INT/FLOAT/JSON',
  `description` VARCHAR(256) DEFAULT NULL COMMENT '配置说明',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='摘要生成配置表';
```

### 9.2 核心配置项

| 配置键 | 默认值 | 说明 |
|--------|--------|------|
| `min_turn_threshold` | 2 | 最少对话轮次才触发摘要 |
| `min_duration_minutes` | 2 | 最短对话时长(分钟) |
| `max_daily_summaries_per_user` | 50 | 每用户每日摘要上限 |
| `min_quality_score` | 0.4 | 最低对话质量分 |
| `llm_model` | glm-4-flash | 使用的LLM模型 |
| `llm_temperature` | 0.3 | LLM温度 |
| `llm_max_tokens` | 2000 | 最大输出token |
| `max_conversation_tokens` | 4000 | 对话输入截断阈值 |
| `retry_max_attempts` | 2 | 最大重试次数 |
| `retry_delay_ms` | 2000 | 重试间隔 |
| `knowledge_point_match_threshold` | 5.0 | 知识点匹配最低分数 |
| `enable_parent_summary` | true | 是否生成家长版摘要 |
| `enable_confusion_detection` | true | 是否检测困惑点 |
| `enable_engagement_scoring` | true | 是否评估参与度 |
| `prompt_template_id` | summary_v2 | 使用的Prompt模板ID |

---

## 10. 性能与成本控制

### 10.1 成本估算

| 场景 | Token消耗(约) | 单价(元/千token) | 单次成本 |
|------|---------------|-------------------|----------|
| 输入(对话) | ~3000 | 0.001 | ¥0.003 |
| 输出(摘要) | ~800 | 0.001 | ¥0.0008 |
| 合计 | ~3800 | - | **¥0.004/次** |

按日均10万次对话估算：**日成本约¥400**，月成本约¥12,000。

### 10.2 优化策略

1. **模型分层**：常规对话用Flash模型(低成本)；深度理科对话用标准模型(高精度)
2. **批量处理**：非实时场景合并多次短对话的摘要
3. **缓存复用**：相似对话模板的摘要部分可复用
4. **异步处理**：非关键路径（如家长摘要）可延迟生成
5. **选择性处理**：低质量对话跳过，只对有价值的对话生成摘要

### 10.3 性能指标

| 指标 | 目标 |
|------|------|
| 摘要生成延迟(P95) | ≤ 5s |
| 摘要生成延迟(P99) | ≤ 10s |
| 摘要生成成功率 | ≥ 99% |
| 知识点映射命中率 | ≥ 85% |
| 每日处理容量 | ≥ 100万次 |

---

## 11. 关键代码示例

### 11.1 消费者入口（消息队列消费）

```java
@Component
@RabbitListener(queues = "summary.generation.queue")
@Slf4j
public class SummaryGenerationConsumer {

    @Autowired
    private ConversationPreprocessor preprocessor;
    @Autowired
    private SummaryTriggerService triggerService;
    @Autowired
    private SummaryGenerationService generationService;
    @Autowired
    private ConversationService conversationService;

    @RabbitHandler
    public void handleMessage(ConversationEndEvent event,
                              Channel channel,
                              @Header(AmqpHeaders.DELIVERY_TAG) long tag) {
        try {
            log.info("收到摘要生成任务, conversationId={}, userId={}",
                event.getConversationId(), event.getUserId());

            // 1. 加载对话全文
            ConversationRecord conversation = conversationService
                .getFullConversation(event.getConversationId());
            if (conversation == null) {
                log.warn("对话不存在, conversationId={}", event.getConversationId());
                channel.basicAck(tag, false);
                return;
            }

            // 2. 预处理
            ProcessedConversation processed = preprocessor.process(conversation);

            // 3. 生成摘要
            generationService.generateSummary(processed);

            channel.basicAck(tag, false);
            log.info("摘要生成完成, conversationId={}", event.getConversationId());

        } catch (LlmCallException e) {
            log.error("LLM调用异常，进入重试", e);
            channel.basicNack(tag, false, true); // 重新入队
        } catch (Exception e) {
            log.error("摘要处理异常", e);
            channel.basicNack(tag, false, false); // 不重试，进死信
        }
    }
}
```

### 11.2 结构化输出解析

```java
@Service
@Slf4j
public class SummaryOutputParser {

    private static final ObjectMapper mapper = new ObjectMapper();

    /**
     * 解析LLM返回的JSON，容错处理
     */
    public SummaryOutput parseStructuredOutput(String llmContent) {
        // 清理markdown代码块标记
        String cleaned = llmContent
            .replaceAll("```json\\s*", "")
            .replaceAll("```\\s*", "")
            .trim();

        try {
            // 尝试完整解析
            return mapper.readValue(cleaned, SummaryOutput.class);
        } catch (JsonProcessingException e) {
            log.warn("JSON解析失败，尝试提取JSON片段", e);
            // 尝试提取第一个 { 到最后一个 }
            int start = cleaned.indexOf('{');
            int end = cleaned.lastIndexOf('}');
            if (start >= 0 && end > start) {
                try {
                    return mapper.readValue(
                        cleaned.substring(start, end + 1),
                        SummaryOutput.class);
                } catch (JsonProcessingException e2) {
                    log.error("JSON片段解析也失败", e2);
                }
            }

            // 最终降级：构建最小可用输出
            return SummaryOutput.builder()
                .shortSummary("摘要解析异常")
                .fullSummary(cleaned.substring(0, Math.min(500, cleaned.length())))
                .engagementLevel(3)
                .comprehensionLevel(3)
                .emotionTendency("UNKNOWN")
                .build();
        }
    }
}
```

### 11.3 每日汇总聚合（定时任务）

```java
@Component
@Slf4j
public class DailySummaryAggregationJob {

    @Autowired
    private ConversationSummaryMapper summaryMapper;
    @Autowired
    private EventPublisher eventPublisher;

    /**
     * 每日00:30执行，汇总前一天的学习数据
     * 生成用户维度的「今日学习小结」
     */
    @XxlJob("dailySummaryAggregation")
    public void execute() {
        LocalDate yesterday = LocalDate.now().minusDays(1);

        // 1. 查找昨天有摘要的所有用户
        List<Long> userIds = summaryMapper
            .distinctUserIdsByDate(yesterday);

        for (Long userId : userIds) {
            try {
                // 2. 获取该用户昨天的所有摘要
                List<ConversationSummary> summaries = summaryMapper
                    .selectByUserAndDate(userId, yesterday);

                // 3. 生成每日学习小结
                DailyStudyBrief brief = buildDailyBrief(userId, yesterday, summaries);

                // 4. 推送事件（触发家长报告、学习报告等）
                eventPublisher.publishDailyBrief(brief);

            } catch (Exception e) {
                log.error("每日汇总失败, userId={}, date={}",
                    userId, yesterday, e);
            }
        }
    }

    private DailyStudyBrief buildDailyBrief(Long userId, LocalDate date,
            List<ConversationSummary> summaries) {
        // 按学科分组
        Map<String, List<ConversationSummary>> bySubject = summaries.stream()
            .collect(Collectors.groupingBy(ConversationSummary::getSubjectCode));

        // 计算总学习时长
        int totalMinutes = summaries.stream()
            .mapToInt(s -> (int) ChronoUnit.MINUTES.between(
                s.getConversationStartTime(), s.getConversationEndTime()))
            .sum();

        // 收集所有知识点
        List<KnowledgePointMention> allKps = summaries.stream()
            .flatMap(s -> s.getKnowledgePoints().stream())
            .collect(Collectors.toList());

        // 收集所有困惑点
        List<ConfusionPointMention> allConfusions = summaries.stream()
            .flatMap(s -> s.getConfusionPoints().stream())
            .collect(Collectors.toList());

        // 生成每日一句话
        String dailyOneLiner = generateDailyOneLiner(bySubject, totalMinutes);

        return DailyStudyBrief.builder()
            .userId(userId)
            .date(date)
            .totalConversations(summaries.size())
            .totalStudyMinutes(totalMinutes)
            .subjectBreakdown(buildSubjectBreakdown(bySubject))
            .avgEngagement(calculateAvgEngagement(summaries))
            .avgComprehension(calculateAvgComprehension(summaries))
            .allKnowledgePoints(allKps)
            .allConfusionPoints(allConfusions)
            .dailyOneLiner(dailyOneLiner)
            .build();
    }
}
```

---

## 12. 监控与告警

### 12.1 关键监控指标

| 指标 | 类型 | 告警阈值 |
|------|------|----------|
| summary_generation_total | Counter(成功/失败/跳过) | 失败率>5%告警 |
| summary_generation_duration_ms | Histogram | P95>8s告警 |
| summary_llm_tokens_total | Counter(输入/输出) | 日消耗>预算120%告警 |
| summary_queue_depth | Gauge | 积压>10000告警 |
| summary_knowledge_point_hit_rate | Gauge | 命中率<80%告警 |
| summary_dead_letter_count | Counter | >0告警 |

### 12.2 Grafana看板指标

```
# 每小时摘要生成量
rate(summary_generation_total{status="success"}[1h])

# 生成延迟分布
histogram_quantile(0.95, summary_generation_duration_ms)

# LLM Token消耗趋势
rate(summary_llm_tokens_total[1d])

# 知识点映射成功率
sum(rate(summary_generation_total{kp_mapped="true"}[1h]))
/ sum(rate(summary_generation_total{status="success"}[1h]))
```

---

## 13. 部署与扩展

### 13.1 资源需求

| 资源 | 配置 | 说明 |
|------|------|------|
| 服务实例 | 2-4个Pod (2C4G) | 处理摘要生成任务 |
| 消息队列 | RabbitMQ集群 | summary队列 + 死信队列 |
| MySQL | 主从 | 4张表，初期单库即可 |
| Redis | 集群 | 热点摘要缓存、知识点映射缓存 |

### 13.2 水平扩展

- 消费者无状态，可直接水平扩展
- 摘要生成是IO密集型(LLM调用)，2-4实例足够支撑10万QPS
- 极端场景可启用批量模式：多个短对话合并一次LLM调用

---

## 14. 与其他模块的集成关系

| 模块 | 集成方式 | 说明 |
|------|----------|------|
| AI对话引擎与会话管理 | 事件消费 | 监听对话结束事件 |
| 知识点体系与教材映射引擎 | API调用 | 知识点标准化映射 |
| 用户学习画像与能力维度模型 | 事件推送 | 知识掌握度更新 |
| 错题整理 | 事件推送 | 困惑点生成推荐练习 |
| 学习报告生成与交付服务 | 事件推送 | 摘要作为报告数据源 |
| 家长中心 | 事件推送 | 家长版摘要与每日小结 |
| 间隔重复算法与复习调度引擎 | 事件推送 | 困惑知识点加入复习队列 |
| 学习行为事件流与跨模块级联处理引擎 | 事件推送 | 摘要事件流入事件流 |
| 多模型调度与成本治理 | API调用 | LLM调用与成本核算 |
| AI-Prompt编排与场景模板系统 | API调用 | Prompt模板管理 |

---

## 15. 后续演进

1. **增量摘要**：对超长对话实时生成增量摘要，而非结束后一次性处理
2. **摘要质量自动评估**：训练专门的评估模型对摘要质量打分
3. **学生画像更新自动化**：摘要结果直接更新能力维度模型
4. **跨会话知识图谱**：将多次对话的知识点串联，生成个人知识图谱
5. **智能复习建议**：基于困惑点历史，自动生成个性化复习计划
6. **对话质量教练**：基于摘要数据反馈给AI对话引擎，优化辅导策略
