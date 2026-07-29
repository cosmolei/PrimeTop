# 服务端-AI辅导对话交互行为信号感知与学习体验无感化质量评估引擎

## 1. 概述

### 1.1 功能定位

本引擎负责在 AI 辅导对话过程中，**无感化采集和分析用户交互行为信号**，在不依赖用户主动评分的前提下，实时评估学生的学习体验质量和 AI 回答满意度。引擎输出满意度评分、体验质量分级和异常预警，驱动 AI 模型路由调整、Prompt 优化、内容重生成和运营干预。

### 1.2 设计目标

| 目标 | 说明 |
| --- | --- |
| 无感化采集 | 零额外用户操作，纯基于已有交互行为数据 |
| 实时感知 | 单轮对话交互完成后 ≤2s 内输出信号评分 |
| 多维度评估 | 覆盖满意度、困惑度、投入度、流失倾向四个维度 |
| 可解释 | 评分附带关键信号贡献度，便于运维和产品决策 |
| 驱动闭环 | 评分直接接入模型路由、Prompt 迭代、运营干预链路 |

### 1.3 与现有模块的边界

| 现有模块 | 本引擎关系 |
| --- | --- |
| AI输出质量校验与多模型复核引擎 | 关注 **内容正确性**（答案对不对）；本引擎关注 **用户体验**（用户觉得好不好） |
| AI辅导对话教育成效评估与学习增值量化引擎 | 关注 **学习效果**（学到了什么）；本引擎关注 **过程体验**（交互是否顺畅） |
| AI辅导实时质量监控与人工接管兜底系统 | 关注 **安全兜底**（是否需要人工介入）；本引擎为该系统提供体验维度输入信号 |
| 用户反馈与AI质量评估 | 依赖 **显式反馈**（用户主动评分纠错）；本引擎实现 **隐式感知**（行为信号推导） |
| 学习状态实时感知与会话质量动态评估引擎 | 关注 **学习会话整体状态**；本引擎聚焦 **单轮对话级别的交互质量** |

### 1.4 适用范围

- AI 文字问答、语音提问、拍照搜题后的解析对话
- 连续追问多轮对话
- 各学段（幼儿至高中）全学科场景

---

## 2. 核心概念定义

### 2.1 交互行为信号（Interaction Behavior Signal）

在 AI 辅导对话过程中，用户与客户端交互产生的、可被服务端采集和计算的行为数据点。

信号分为三大类：

| 类别 | 信号示例 |
| --- | --- |
| 时序信号 | 首字响应延迟、阅读时长、回复间隔、会话持续时长 |
| 行为信号 | 追问方式、操作选择、退出/继续、复制/收藏、滚动行为 |
| 语义信号 | 追问内容相似度、话题漂移、情绪词、输入修改次数 |

### 2.2 无感化质量评估（Implicit Quality Assessment）

不需要用户主动提供反馈（如评分、点赞/踩、纠错提交），仅通过分析交互行为信号，推导出用户对 AI 回答的满意度和学习体验质量。

### 2.3 体验质量分级

| 等级 | 标识 | 含义 |
| --- | --- | --- |
| S | 🟢 优秀 | 用户高度满意，回答精准有效，追问深入或有正向行为反馈 |
| A | 🟢 良好 | 用户满意，回答基本满足需求，正常继续学习 |
| B | 🟡 一般 | 用户可能存在轻微困惑，有换种讲法或简化请求 |
| C | 🟠 较差 | 用户明显不满意，多次追问同一问题或表达困惑 |
| D | 🔴 很差 | 用户放弃对话或投诉，体验严重恶化 |

---

## 3. 信号体系详细设计

### 3.1 信号采集清单

#### 3.1.1 时序信号

| 信号ID | 信号名称 | 数据类型 | 采集方式 | 单位 |
| --- | --- | --- | --- | --- |
| T01 | firstTokenLatency | float | 服务端记录 SSE 首 token 到达时间 | 毫秒 |
| T02 | completeResponseLatency | float | 服务端记录完整响应到达时间 | 毫秒 |
| T03 | readingDuration | float | 客户端上报：AI回答渲染完成到用户下一条消息的时间 | 秒 |
| T04 | replyInterval | float | 用户上一条消息到该回答完成后的回复间隔 | 秒 |
| T05 | sessionDuration | float | 当前连续对话会话总时长 | 秒 |
| T06 | idleGapAfterResponse | float | AI回答后用户无操作时长（非阅读时长） | 秒 |
| T07 | inputTypingDuration | float | 用户编辑下一条输入的开始到提交时长 | 秒 |
| T08 | voiceToTextDuration | float | 语音输入录音时长 | 秒 |

#### 3.1.2 行为信号

| 信号ID | 信号名称 | 数据类型 | 触发条件 |
| --- | --- | --- | --- |
| B01 | continueFollowUp | boolean | 用户在回答后继续追问 |
| B02 | reAskSameTopic | boolean | 用户用不同表达重新问相同问题（语义相似度 >0.85） |
| B03 | requestSimplify | boolean | 用户点击"再讲简单点" |
| B04 | requestDifferentApproach | boolean | 用户点击"换一种讲法" |
| B05 | requestSimilarQuestion | boolean | 用户点击"练一道同类题" |
| B06 | addToMistakeBook | boolean | 用户点击"加入错题本" |
| B07 | copyAnswer | boolean | 用户复制了回答内容 |
| B08 | shareAnswer | boolean | 用户分享了回答 |
| B09 | thumbUp | boolean | 用户点击"有用"（如有） |
| B10 | thumbDown | boolean | 用户点击"没用"（如有） |
| B11 | reportIssue | boolean | 用户点击"回答有误"反馈 |
| B12 | sessionAbandon | boolean | 用户在收到回答后直接退出会话 |
| B13 | scrollBack | boolean | 用户向上滚动回看之前内容 |
| B14 | switchSubject | boolean | 用户切换到其他学科/模块 |
| B15 | screenshot | boolean | 客户端检测到截屏（如系统允许感知） |
| B16 | regenerateRequest | boolean | 用户请求重新生成 |
| B17 | switchModelRequest | boolean | 用户手动切换 AI 模型 |
| B18 | voiceRepeat | int | 语音播放回答的重复播放次数 |

#### 3.1.3 语义信号

| 信号ID | 信号名称 | 数据类型 | 计算方式 |
| --- | --- | --- | --- |
| S01 | followUpSimilarity | float | 用户追问与原问题的语义余弦相似度（嵌入向量计算） |
| S02 | topicDriftScore | float | 追问内容与原话题的漂移程度（0=完全相关，1=完全不相关） |
| S03 | negativeEmotionScore | float | 追问文本中的负面情绪词频/强度 |
| S04 | confusionWordScore | float | 追问中的困惑表达检测（"不懂""没看懂""什么意思""为什么"等） |
| S05 | positiveEmotionScore | float | 追问中的正面情绪词频/强度（"懂了""明白了""谢谢""原来如此"等） |
| S06 | questionComplexityDelta | float | 追问问题复杂度与前一轮的变化（追问更简单→困惑，更复杂→深入） |
| S07 | responseLengthRatio | float | 用户追问输入长度与前一轮的比例（显著变短可能表示困惑或失去耐心） |
| S08 | repetitiveContentRatio | float | 追问中与之前消息重复内容的比例 |

### 3.2 信号采集数据结构

#### 3.2.1 客户端上报 Schema

```json
{
  "eventId": "evt_20260729_001",
  "sessionId": "sess_abc123",
  "conversationId": "conv_xyz789",
  "turnIndex": 3,
  "userId": "U10001",
  "studentGrade": "G07",
  "subject": "math",
  "timestamp": 1753809600000,
  "signals": {
    "timeline": {
      "firstTokenLatency": 1200,
      "completeResponseLatency": 8500,
      "readingDuration": 23.5,
      "replyInterval": 5.2,
      "inputTypingDuration": 8.3,
      "idleGapAfterResponse": 0,
      "voiceToTextDuration": null
    },
    "behaviors": {
      "continueFollowUp": true,
      "reAskSameTopic": false,
      "requestSimplify": false,
      "requestDifferentApproach": false,
      "requestSimilarQuestion": false,
      "addToMistakeBook": false,
      "copyAnswer": true,
      "shareAnswer": false,
      "thumbUp": false,
      "thumbDown": false,
      "reportIssue": false,
      "sessionAbandon": false,
      "scrollBack": true,
      "screenshot": false,
      "regenerateRequest": false,
      "switchModelRequest": false,
      "voiceRepeat": 0
    },
    "semantic": {
      "followUpSimilarity": 0.72,
      "topicDriftScore": 0.15,
      "negativeEmotionScore": 0.05,
      "confusionWordScore": 0.0,
      "positiveEmotionScore": 0.35,
      "questionComplexityDelta": 0.3,
      "responseLengthRatio": 1.2,
      "repetitiveContentRatio": 0.08
    }
  },
  "answerMeta": {
    "modelUsed": "glm-5",
    "promptTemplateId": "pt_junior_math_01",
    "ragChunksUsed": 5,
    "responseTokenCount": 850,
    "knowledgePoints": ["KP_301", "KP_302"]
  }
}
```

#### 3.2.2 服务端信号存储模型

```sql
-- 交互信号事件表（写入 ClickHouse，支持高写入和聚合分析）
CREATE TABLE ai_dialog_interaction_signals
(
    event_id            String,
    session_id          String,
    conversation_id     String,
    turn_index          UInt32,
    user_id             String,
    student_grade       LowCardinality(String),
    subject             LowCardinality(String),
    event_time          DateTime64(3),
    event_date          Date MATERIALIZED toDate(event_time),

    -- 时序信号
    first_token_latency_ms    Float32,
    complete_response_latency_ms Float32,
    reading_duration_s        Float32,
    reply_interval_s          Float32,
    session_duration_s        Float32,
    idle_gap_after_s          Float32,
    input_typing_duration_s   Float32,
    voice_to_text_duration_s  Nullable(Float32),

    -- 行为信号
    continue_follow_up        UInt8,
    re_ask_same_topic         UInt8,
    request_simplify          UInt8,
    request_different_approach UInt8,
    request_similar_question  UInt8,
    add_to_mistake_book       UInt8,
    copy_answer               UInt8,
    share_answer              UInt8,
    thumb_up                  UInt8,
    thumb_down                UInt8,
    report_issue              UInt8,
    session_abandon           UInt8,
    scroll_back               UInt8,
    switch_subject            UInt8,
    screenshot                UInt8,
    regenerate_request        UInt8,
    switch_model_request      UInt8,
    voice_repeat              UInt32,

    -- 语义信号
    follow_up_similarity      Float32,
    topic_drift_score         Float32,
    negative_emotion_score    Float32,
    confusion_word_score      Float32,
    positive_emotion_score    Float32,
    question_complexity_delta Float32,
    response_length_ratio     Float32,
    repetitive_content_ratio  Float32,

    -- AI回答元数据
    model_used                LowCardinality(String),
    prompt_template_id        String,
    rag_chunks_used           UInt32,
    response_token_count      UInt32,
    knowledge_points          Array(String),

    -- 评估结果（异步回填）
    satisfaction_score        Nullable(Float32),
    confusion_score           Nullable(Float32),
    engagement_score          Nullable(Float32),
    churn_risk_score          Nullable(Float32),
    quality_grade             Nullable(LowCardinality(String)),

    INDEX idx_user user_id TYPE bloom_filter GRANULARITY 1,
    INDEX idx_conv conversation_id TYPE bloom_filter GRANULARITY 1
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, user_id, conversation_id, turn_index)
TTL event_date + INTERVAL 180 DAY;
```

```sql
-- 会话级聚合评估表（写入 MySQL，支持实时查询和管理后台展示）
CREATE TABLE ai_dialog_quality_evaluation
(
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    evaluation_id      VARCHAR(48) NOT NULL UNIQUE COMMENT '评估ID',
    conversation_id    VARCHAR(48) NOT NULL COMMENT '对话会话ID',
    user_id            VARCHAR(32) NOT NULL COMMENT '用户ID',
    student_grade      VARCHAR(8) NOT NULL COMMENT '学生年级',
    subject            VARCHAR(16) NOT NULL COMMENT '学科',
    total_turns        INT NOT NULL COMMENT '对话总轮数',
    avg_satisfaction   DECIMAL(4,3) COMMENT '平均满意度 [0,1]',
    avg_confusion      DECIMAL(4,3) COMMENT '平均困惑度 [0,1]',
    avg_engagement     DECIMAL(4,3) COMMENT '平均投入度 [0,1]',
    churn_risk         DECIMAL(4,3) COMMENT '流失风险 [0,1]',
    quality_grade      CHAR(1) NOT NULL COMMENT '质量等级 S/A/B/C/D',
    key_negative_signals JSON COMMENT '关键负面信号列表',
    key_positive_signals JSON COMMENT '关键正面信号列表',
    model_used         VARCHAR(32) COMMENT '主要使用的AI模型',
    prompt_template_id VARCHAR(48) COMMENT '主要使用的Prompt模板',
    created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX idx_user (user_id),
    INDEX idx_conv (conversation_id),
    INDEX idx_grade_subject (quality_grade, subject),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI对话质量评估表';
```

---

## 4. 评估模型设计

### 4.1 评分维度定义

引擎输出四个维度的评分（取值范围 [0, 1]）：

| 维度 | 含义 | 高分含义 | 低分含义 |
| --- | --- | --- | --- |
| satisfaction_score | 满意度 | 用户对回答高度满意 | 用户不满意 |
| confusion_score | 困惑度 | 用户非常困惑（注意：高分是负面） | 用户理解清晰 |
| engagement_score | 投入度 | 用户深度参与学习 | 用户注意力涣散 |
| churn_risk_score | 流失倾向 | 用户可能放弃学习（高分是负面） | 用户愿意继续 |

> **注意**：satisfaction 和 engagement 高分为正面，confusion 和 churn_risk 高分为负面。

### 4.2 信号权重模型

采用加权评分 + 上下文修正的策略。每个信号对各维度的贡献权重不同：

#### 4.2.1 满意度权重矩阵

| 信号 | 权重 | 方向 | 说明 |
| --- | --- | --- | --- |
| reAskSameTopic (B02) | 0.20 | 负面 | 重新问同样问题→不满意 |
| requestSimplify (B03) | 0.10 | 负面 | 请求简化→回答太复杂 |
| requestDifferentApproach (B04) | 0.10 | 负面 | 换讲法→第一种没听懂 |
| regenerateRequest (B16) | 0.15 | 负面 | 要求重生成→回答质量差 |
| thumbDown (B10) | 0.15 | 负面 | 显式不满意 |
| reportIssue (B11) | 0.20 | 负面 | 举报→严重问题 |
| sessionAbandon (B12) | 0.15 | 负面 | 直接退出→放弃 |
| copyAnswer (B07) | 0.10 | 正面 | 复制→认为有用 |
| shareAnswer (B08) | 0.10 | 正面 | 分享→认可价值 |
| thumbUp (B09) | 0.15 | 正面 | 显式满意 |
| addToMistakeBook (B06) | 0.08 | 正面 | 加入错题本→认可学习价值 |
| requestSimilarQuestion (B05) | 0.10 | 正面 | 练同类题→学进去了 |
| positiveEmotionScore (S05) | 0.12 | 正面 | "懂了""明白了" |
| confusionWordScore (S04) | 0.12 | 负面 | "不懂""什么意思" |
| readingDuration (T03) | 0.05 | 正面 | 适当阅读时长→认真看 |
| replyInterval (T04) | 0.03 | 正面 | 快速追问→积极投入 |

#### 4.2.2 困惑度权重矩阵

| 信号 | 权重 | 方向 |
| --- | --- | --- |
| confusionWordScore (S04) | 0.25 | 正面（高分=更困惑） |
| reAskSameTopic (B02) | 0.20 | 正面 |
| requestSimplify (B03) | 0.15 | 正面 |
| requestDifferentApproach (B04) | 0.15 | 正面 |
| followUpSimilarity (S01) | 0.10 | 正面（追问高度相似→没听懂） |
| negativeEmotionScore (S03) | 0.08 | 正面 |
| questionComplexityDelta (S06) | 0.05 | 负向（追问更简单→困惑） |
| scrollBack (B13) | 0.05 | 正面（回看→可能在理解） |
| idleGapAfterResponse (T06) | 0.05 | 正面（发呆→可能困惑） |

#### 4.2.3 投入度权重矩阵

| 信号 | 权重 | 方向 |
| --- | --- | --- |
| continueFollowUp (B01) | 0.20 | 正面 |
| sessionDuration (T05) | 0.15 | 正面 |
| requestSimilarQuestion (B05) | 0.15 | 正面 |
| readingDuration (T03) | 0.10 | 正面 |
| inputTypingDuration (T07) | 0.05 | 正面 |
| voiceRepeat (B18) | 0.05 | 正面 |
| copyAnswer (B07) | 0.05 | 正面 |
| addToMistakeBook (B06) | 0.10 | 正面 |
| scrollBack (B13) | 0.05 | 正面 |
| topicDriftScore (S02) | 0.10 | 负面（偏离话题→投入度下降） |

#### 4.2.4 流失倾向权重矩阵

| 信号 | 权重 | 方向 |
| --- | --- | --- |
| sessionAbandon (B12) | 0.25 | 正面（高分=易流失） |
| switchSubject (B14) | 0.15 | 正面 |
| replyInterval (T04) | 0.10 | 正面（长时间不回复→可能离开） |
| idleGapAfterResponse (T06) | 0.10 | 正面 |
| responseLengthRatio (S07) | 0.08 | 负面（输入越来越短→失去耐心） |
| negativeEmotionScore (S03) | 0.12 | 正面 |
| topicDriftScore (S02) | 0.10 | 正面 |
| switchModelRequest (B17) | 0.10 | 正面 |

### 4.3 上下文修正因子

原始加权评分需要根据上下文修正：

| 修正因子 | 计算方式 | 影响范围 |
| --- | --- | --- |
| 学段因子 | 幼儿=0.8, 小学=0.9, 初中=1.0, 高中=1.1 | 高年级用户行为更理性，信号可信度更高 |
| 学科因子 | 理科类信号波动更大（题目难→困惑正常） | 理科 confusion 阈值上调 20% |
| 对话轮次因子 | 第1轮权重×1.2, 2-5轮×1.0, >5轮×0.9 | 首轮印象更重要 |
| 时段因子 | 深夜(22:00-06:00) idle/abandon 信号可信度降低 | 深夜时段 churn_risk ×0.8 |
| 网络因子 | 弱网环境下 latency 信号权重降低 | firstTokenLatency ×0.3 |

### 4.4 质量等级映射

```python
def map_quality_grade(satisfaction: float, confusion: float,
                      engagement: float, churn_risk: float) -> str:
    """
    将四维评分映射到质量等级 S/A/B/C/D
    """
    # 综合体验分 = 满意度*0.4 + 投入度*0.3 + (1-困惑度)*0.15 + (1-流失倾向)*0.15
    composite = (satisfaction * 0.40 +
                 engagement * 0.30 +
                 (1 - confusion) * 0.15 +
                 (1 - churn_risk) * 0.15)

    if composite >= 0.85:
        return 'S'
    elif composite >= 0.70:
        return 'A'
    elif composite >= 0.55:
        return 'B'
    elif composite >= 0.40:
        return 'C'
    else:
        return 'D'
```

---

## 5. 系统架构设计

### 5.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    客户端 SDK                              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ 时序信号采集  │  │ 行为信号采集  │  │ 输入预处理    │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
└─────────┼─────────────────┼──────────────────┼──────────┘
          │                 │                  │
          ▼                 ▼                  ▼
┌─────────────────────────────────────────────────────────┐
│              Signal Collection API (BFF)                   │
│              /api/v1/signals/report                        │
└──────────────────────┬────────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐
│ Kafka Topic  │ │ 语义信号  │ │ 上下文缓存   │
│ signals.raw  ││ 异步计算  │ │ (Redis)      │
└──────┬───────┘ └────┬─────┘ └──────────────┘
       │              │
       ▼              ▼
┌─────────────────────────────────────────────────────────┐
│              Signal Processing Pipeline                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ 信号清洗  │→│ 特征工程  │→│ 评分计算  │→│ 等级映射 │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │
└──────────────────────┬────────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐
│ ClickHouse   │ │ MySQL    │ │ Kafka Topic  │
│ 原始信号存储  │ │ 评估结果 │ │ quality.eval │
└──────────────┘ └──────────┘ └──────┬───────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
          ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
          │ 模型路由调整  │  │ Prompt优化   │  │ 运营预警通知  │
          │ (下游消费者)  │  │ 反馈循环     │  │ (下游消费者)  │
          └──────────────┘  └──────────────┘  └──────────────┘
```

### 5.2 核心组件

#### 5.2.1 客户端信号采集 SDK

客户端在 AI 对话页面的各交互节点埋入信号采集逻辑，批量上报到服务端。

```dart
/// 客户端信号采集器（Flutter Dart 示例）
class InteractionSignalCollector {
  final String sessionId;
  final String conversationId;
  final String userId;
  final String grade;
  final String subject;

  final List<Map<String, dynamic>> _signalBuffer = [];
  DateTime? _responseRenderTime;
  DateTime? _lastUserMessageTime;

  /// AI 回答渲染完成时调用
  void onAiResponseRendered({
    required int turnIndex,
    required double firstTokenLatencyMs,
    required double completeResponseLatencyMs,
    required String modelUsed,
    required String promptTemplateId,
    int? ragChunksUsed,
    int? responseTokenCount,
    List<String>? knowledgePoints,
  }) {
    _responseRenderTime = DateTime.now();
  }

  /// 用户提交追问消息时调用
  void onUserSubmitFollowUp({
    required int turnIndex,
    required String userInput,
    required bool isVoiceInput,
    double? voiceDuration,
  }) {
    final now = DateTime.now();
    final readingDuration = _responseRenderTime != null
        ? now.difference(_responseRenderTime!).inMilliseconds / 1000.0
        : 0.0;

    _signalBuffer.add({
      'turnIndex': turnIndex,
      'timestamp': now.millisecondsSinceEpoch,
      'timeline': {
        'readingDuration': readingDuration,
        'inputTypingDuration': _measureTypingDuration(),
        'voiceToTextDuration': voiceDuration,
      },
      'userInput': userInput, // 用于服务端语义分析
    });

    _flushIfNeeded();
  }

  /// 用户点击操作按钮时调用
  void onUserAction({
    required int turnIndex,
    required String actionType, // simplify, different_approach, similar_question, etc.
  }) {
    _signalBuffer.add({
      'turnIndex': turnIndex,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
      'behaviors': {actionType: true},
    });
    _flushIfNeeded();
  }

  /// 会话结束时调用
  Future<void> flushOnSessionEnd() async {
    await _flush(force: true);
  }

  void _flushIfNeeded() {
    if (_signalBuffer.length >= 5) {
      _flush();
    }
  }

  Future<void> _flush({bool force = false}) async {
    if (_signalBuffer.isEmpty) return;
    final batch = List.from(_signalBuffer);
    _signalBuffer.clear();

    // 调用上报API
    await _apiClient.post('/api/v1/signals/report', data: {
      'sessionId': sessionId,
      'conversationId': conversationId,
      'userId': userId,
      'studentGrade': grade,
      'subject': subject,
      'events': batch,
    });
  }
}
```

#### 5.2.2 信号接收 API（BFF 层）

```java
/**
 * 交互信号上报接口
 */
@RestController
@RequestMapping("/api/v1/signals")
public class SignalReportController {

    @Autowired
    private SignalIngestService signalIngestService;

    /**
     * 批量上报交互信号
     */
    @PostMapping("/report")
    public ApiResponse<Void> reportSignals(
            @RequestBody @Valid SignalReportRequest request,
            @RequestHeader("X-User-Id") String userId) {

        // 快速校验
        if (request.getEvents() == null || request.getEvents().isEmpty()) {
            return ApiResponse.success(null);
        }

        // 异步处理，快速返回（信号上报不应阻塞用户操作）
        signalIngestService.ingestAsync(request, userId);
        return ApiResponse.success(null);
    }
}
```

```java
@Data
public class SignalReportRequest {
    @NotBlank
    private String sessionId;
    @NotBlank
    private String conversationId;
    @NotBlank
    private String userId;
    @NotBlank
    private String studentGrade;
    @NotBlank
    private String subject;

    @NotEmpty
    @Valid
    private List<SignalEvent> events;
}

@Data
public class SignalEvent {
    @NotNull
    private Integer turnIndex;
    @NotNull
    private Long timestamp;

    private TimelineSignals timeline;
    private BehaviorSignals behaviors;
    private SemanticSignals semantic;

    // AI回答元数据
    private AnswerMeta answerMeta;

    // 用户输入原文（用于服务端语义分析，可选）
    private String userInput;
}
```

#### 5.2.3 信号处理流水线

```java
/**
 * 信号摄入服务：接收原始信号 → Kafka → 异步处理
 */
@Service
public class SignalIngestService {

    @Autowired
    private KafkaTemplate<String, String> kafka;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private RedisTemplate<String, String> redis;

    private static final String TOPIC_SIGNALS_RAW = "signals.raw";

    public void ingestAsync(SignalReportRequest request, String authUserId) {
        // 安全校验：确保 userId 一致
        if (!request.getUserId().equals(authUserId)) {
            log.warn("UserId mismatch in signal report: header={}, body={}",
                     authUserId, request.getUserId());
            return;
        }

        // 补充上下文（网络质量等）
        for (SignalEvent event : request.getEvents()) {
            enrichWithContext(event, request);
        }

        // 写入 Kafka
        String payload = objectMapper.writeValueAsString(request);
        kafka.send(TOPIC_SIGNALS_RAW, request.getConversationId(), payload);
    }

    /**
     * 补充上下文修正信息
     */
    private void enrichWithContext(SignalEvent event, SignalReportRequest request) {
        // 查询网络质量
        String networkKey = "net:" + request.getSessionId();
        String networkQuality = redis.opsForValue().get(networkKey);

        event.setNetworkQuality(networkQuality); // good/medium/poor

        // 补充时间上下文
        LocalTime time = LocalTime.ofSecondOfDay(event.getTimestamp() / 1000 % 86400);
        event.setTimeSlot(categorizeTimeSlot(time)); // morning/afternoon/evening/late_night
    }

    private String categorizeTimeSlot(LocalTime time) {
        int hour = time.getHour();
        if (hour >= 6 && hour < 12) return "morning";
        if (hour >= 12 && hour < 18) return "afternoon";
        if (hour >= 18 && hour < 22) return "evening";
        return "late_night";
    }
}
```

#### 5.2.4 评分计算引擎

```java
/**
 * 质量评估评分引擎
 * 消费 Kafka signals.raw → 计算评分 → 输出到评估结果存储 + Kafka quality.eval
 */
@Service
public class QualityEvaluationEngine {

    // 满意度权重配置（从配置中心加载，支持动态调整）
    private static final double W_SATISFACTION_NEG = 0.20; // reAskSameTopic
    // ... 其他权重见 4.2.1 节

    @KafkaListener(topics = "signals.raw", groupId = "quality-eval-group")
    public void processSignalBatch(String message) {
        SignalReportRequest report = objectMapper.readValue(message, SignalReportRequest.class);

        List<TurnQualityResult> results = new ArrayList<>();

        for (SignalEvent event : report.getEvents()) {
            TurnQualityResult result = evaluateTurn(event, report);
            results.add(result);
        }

        // 单轮评估结果写入 ClickHouse
        persistToClickHouse(results, report);

        // 如果会话结束，生成会话级聚合评估
        if (isConversationEnded(results)) {
            ConversationQualityResult convResult = aggregateConversation(report, results);
            persistToMySQL(convResult);

            // 发布会话级评估事件
            kafka.send("quality.eval", objectMapper.writeValueAsString(convResult));
        }

        // 实时异常检测
        for (TurnQualityResult r : results) {
            if (r.getQualityGrade().equals("D") || r.getQualityGrade().equals("C")) {
                triggerRealTimeAlert(r, report);
            }
        }
    }

    /**
     * 单轮对话质量评估
     */
    private TurnQualityResult evaluateTurn(SignalEvent event, SignalReportRequest report) {
        // 1. 提取特征向量
        FeatureVector features = featureExtractor.extract(event, report);

        // 2. 计算四维评分
        double satisfaction = calculateSatisfaction(features, event, report);
        double confusion = calculateConfusion(features, event, report);
        double engagement = calculateEngagement(features, event, report);
        double churnRisk = calculateChurnRisk(features, event, report);

        // 3. 应用上下文修正
        ContextFactors context = buildContext(event, report);
        satisfaction = applyContextCorrection(satisfaction, context, "satisfaction");
        confusion = applyContextCorrection(confusion, context, "confusion");
        engagement = applyContextCorrection(engagement, context, "engagement");
        churnRisk = applyContextCorrection(churnRisk, context, "churn_risk");

        // 4. 钳位 [0, 1]
        satisfaction = clamp01(satisfaction);
        confusion = clamp01(confusion);
        engagement = clamp01(engagement);
        churnRisk = clamp01(churnRisk);

        // 5. 映射质量等级
        String grade = QualityGradeMapper.map(satisfaction, confusion, engagement, churnRisk);

        // 6. 提取关键信号（可解释性）
        List<String> keyNegatives = extractKeyNegativeSignals(features);
        List<String> keyPositives = extractKeyPositiveSignals(features);

        return TurnQualityResult.builder()
                .conversationId(report.getConversationId())
                .turnIndex(event.getTurnIndex())
                .satisfactionScore(satisfaction)
                .confusionScore(confusion)
                .engagementScore(engagement)
                .churnRiskScore(churnRisk)
                .qualityGrade(grade)
                .keyNegativeSignals(keyNegatives)
                .keyPositiveSignals(keyPositives)
                .build();
    }

    /**
     * 满意度计算
     */
    private double calculateSatisfaction(FeatureVector f, SignalEvent e, SignalReportRequest r) {
        double score = 0.5; // 基线

        // 负面信号扣分
        if (f.reAskSameTopic)    score -= 0.20;
        if (f.requestSimplify)   score -= 0.10;
        if (f.requestDifferent)  score -= 0.10;
        if (f.regenerateRequest) score -= 0.15;
        if (f.thumbDown)         score -= 0.15;
        if (f.reportIssue)       score -= 0.20;
        if (f.sessionAbandon)    score -= 0.15;

        // 正面信号加分
        if (f.copyAnswer)           score += 0.10;
        if (f.shareAnswer)          score += 0.10;
        if (f.thumbUp)              score += 0.15;
        if (f.addToMistakeBook)     score += 0.08;
        if (f.requestSimilarQ)      score += 0.10;

        // 语义信号调整
        score += f.positiveEmotionScore * 0.12;
        score -= f.confusionWordScore * 0.12;

        // 阅读时长调整（非线性：过短和过长都是负面）
        double readingAdjust = readingDurationScore(f.readingDuration, f.responseTokens);
        score += readingAdjust * 0.05;

        return score;
    }

    /**
     * 阅读时长合理性评分
     * 过短=没看就跳过，过长=可能走神
     */
    private double readingDurationScore(double readingS, int responseTokens) {
        // 预期阅读时间：约 5 tokens/秒
        double expectedReadingS = responseTokens / 5.0;
        double ratio = readingS / Math.max(expectedReadingS, 1.0);

        if (ratio < 0.2) return -1.0;  // 几乎没看
        if (ratio < 0.5) return -0.5;  // 看得很匆忙
        if (ratio >= 0.5 && ratio <= 3.0) return 0.5 + Math.min(ratio - 0.5, 1.0) * 0.5; // 合理范围
        if (ratio < 5.0) return 0.0;   // 可能在思考
        return -0.3; // 走神了
    }

    private double clamp01(double v) {
        return Math.max(0.0, Math.min(1.0, v));
    }

    /**
     * 上下文修正
     */
    private double applyContextCorrection(double score, ContextFactors ctx, String dimension) {
        // 学段因子
        score *= ctx.getGradeFactor();

        // 学科因子（理科困惑度阈值上调）
        if ("confusion".equals(dimension) && ctx.isScienceSubject()) {
            score *= 0.8; // 理科困惑度打8折
        }

        // 时段因子（深夜流失倾向降权）
        if ("churn_risk".equals(dimension) && ctx.isLateNight()) {
            score *= 0.8;
        }

        // 弱网因子（延迟类信号降权已在前端处理，此处兜底）
        if ("satisfaction".equals(dimension) && ctx.isPoorNetwork()) {
            score *= 1.05; // 弱网下满意度略加上容错
        }

        return score;
    }
}
```

#### 5.2.5 语义信号计算服务

```python
"""
语义信号计算服务
从用户追问文本中提取语义层面的信号
"""
import jieba
import numpy as np
from sentence_transformers import SentenceTransformer
from collections import Counter

# 预加载嵌入模型（中文教育场景微调）
_embedder = SentenceTransformer('BAAI/bge-small-zh-v1.5')

# 情绪/困惑词典（教育场景定制）
_NEGATIVE_WORDS = {'不懂', '不会', '难', '看不懂', '什么意思', '为什么不对', '错了',
                   '烦', '搞不懂', '不明白', '不理解', '怎么做', '为什么', '不是'}
_CONFUSION_WORDS = {'不懂', '看不懂', '什么意思', '不明白', '不理解', '为什么',
                    '怎么做', '没思路', '不知道怎么下手', '为什么不对', '怎么算'}
_POSITIVE_WORDS = {'懂了', '明白了', '会了', '谢谢', '原来如此', '对了', '有道理',
                   '学到了', '厉害', '清晰', '讲得好', '理解了', '通了'}


def compute_semantic_signals(
    current_input: str,
    previous_question: str,
    ai_response: str,
    conversation_history: list[str]
) -> dict:
    """
    计算语义信号
    :return: dict containing S01-S08 signals
    """
    # S01: 追问与原问题的语义相似度
    follow_up_similarity = _cosine_sim(current_input, previous_question)

    # S02: 话题漂移分数
    topic_drift_score = 1.0 - _cosine_sim(current_input, ai_response)

    # S03: 负面情绪分数
    negative_emotion_score = _lexicon_score(current_input, _NEGATIVE_WORDS)

    # S04: 困惑词分数
    confusion_word_score = _lexicon_score(current_input, _CONFUSION_WORDS)

    # S05: 正面情绪分数
    positive_emotion_score = _lexicon_score(current_input, _POSITIVE_WORDS)

    # S06: 问题复杂度变化
    current_complexity = _estimate_complexity(current_input)
    previous_complexity = _estimate_complexity(previous_question)
    question_complexity_delta = current_complexity - previous_complexity

    # S07: 输入长度比
    response_length_ratio = len(current_input) / max(len(previous_question), 1)

    # S08: 重复内容比
    repetitive_content_ratio = _repetition_ratio(current_input, conversation_history)

    return {
        "followUpSimilarity": round(follow_up_similarity, 3),
        "topicDriftScore": round(topic_drift_score, 3),
        "negativeEmotionScore": round(negative_emotion_score, 3),
        "confusionWordScore": round(confusion_word_score, 3),
        "positiveEmotionScore": round(positive_emotion_score, 3),
        "questionComplexityDelta": round(question_complexity_delta, 3),
        "responseLengthRatio": round(response_length_ratio, 3),
        "repetitiveContentRatio": round(repetitive_content_ratio, 3),
    }


def _cosine_sim(text_a: str, text_b: str) -> float:
    if not text_a or not text_b:
        return 0.0
    emb_a = _embedder.encode(text_a, normalize_embeddings=True)
    emb_b = _embedder.encode(text_b, normalize_embeddings=True)
    return float(np.dot(emb_a, emb_b))


def _lexicon_score(text: str, lexicon: set[str]) -> float:
    words = set(jieba.cut(text))
    matches = words & lexicon
    if not matches:
        return 0.0
    # 简单 TF 加权
    return min(len(matches) / 5.0, 1.0)


def _estimate_complexity(text: str) -> float:
    """粗略估计问题复杂度：句子长度 + 数学符号密度 + 从句数量"""
    length_score = min(len(text) / 200.0, 1.0)
    symbol_density = sum(c in '+-*/=<>≤≥∈π√∑' for c in text) / max(len(text), 1)
    clause_count = text.count('，') + text.count('。') + text.count('？')
    clause_score = min(clause_count / 5.0, 1.0)
    return round(0.4 * length_score + 0.3 * symbol_density * 10 + 0.3 * clause_score, 3)


def _repetition_ratio(text: str, history: list[str]) -> float:
    if not history:
        return 0.0
    text_words = set(jieba.cut(text))
    overlap_sum = 0.0
    for h in history[-3:]:  # 只看最近3轮
        h_words = set(jieba.cut(h))
        if text_words and h_words:
            overlap_sum += len(text_words & h_words) / len(text_words)
    return round(overlap_sum / min(len(history[-3:]), 3), 3)
```

---

## 6. API 接口设计

### 6.1 信号上报接口

**已有，见 5.2.2 节**：`POST /api/v1/signals/report`

### 6.2 对话质量评估查询接口

```
GET /api/v1/quality/conversation/{conversationId}
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "conversationId": "conv_xyz789",
    "userId": "U10001",
    "subject": "math",
    "studentGrade": "G07",
    "totalTurns": 5,
    "avgSatisfaction": 0.72,
    "avgConfusion": 0.18,
    "avgEngagement": 0.81,
    "churnRisk": 0.12,
    "qualityGrade": "A",
    "turnDetails": [
      {
        "turnIndex": 1,
        "satisfaction": 0.85,
        "confusion": 0.05,
        "engagement": 0.90,
        "qualityGrade": "S",
        "keyPositiveSignals": ["copy_answer", "positive_emotion"],
        "keyNegativeSignals": []
      },
      {
        "turnIndex": 2,
        "satisfaction": 0.55,
        "confusion": 0.35,
        "engagement": 0.70,
        "qualityGrade": "B",
        "keyPositiveSignals": [],
        "keyNegativeSignals": ["request_simplify", "confusion_word"]
      }
    ],
    "createdAt": "2026-07-29T15:46:00.000Z"
  }
}
```

### 6.3 用户维度质量统计接口

```
GET /api/v1/quality/user/{userId}/summary?startDate=2026-07-01&endDate=2026-07-29
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "userId": "U10001",
    "period": "2026-07-01 ~ 2026-07-29",
    "totalConversations": 47,
    "totalTurns": 213,
    "avgSatisfaction": 0.76,
    "avgConfusion": 0.15,
    "avgEngagement": 0.78,
    "gradeDistribution": {
      "S": 12, "A": 18, "B": 10, "C": 5, "D": 2
    },
    "subjectBreakdown": {
      "math": { "avgSatisfaction": 0.68, "avgConfusion": 0.22, "count": 15 },
      "english": { "avgSatisfaction": 0.82, "avgConfusion": 0.08, "count": 12 },
      "chinese": { "avgSatisfaction": 0.79, "avgConfusion": 0.12, "count": 10 }
    },
    "topNegativeSignals": [
      { "signal": "request_simplify", "frequency": 0.15 },
      { "signal": "re_ask_same_topic", "frequency": 0.08 }
    ],
    "trend": "stable"
  }
}
```

### 6.4 全局质量监控接口（管理后台用）

```
GET /api/v1/quality/dashboard?date=2026-07-29&subject=math&grade=G07
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "date": "2026-07-29",
    "filters": { "subject": "math", "grade": "G07" },
    "totalEvaluations": 3421,
    "gradeDistribution": {
      "S": 892, "A": 1456, "B": 687, "C": 289, "D": 97
    },
    "avgSatisfaction": 0.71,
    "avgConfusion": 0.19,
    "avgEngagement": 0.76,
    "avgChurnRisk": 0.14,
    "modelComparison": [
      { "model": "glm-5", "avgSatisfaction": 0.74, "count": 2100 },
      { "model": "qwen-max", "avgSatisfaction": 0.70, "count": 891 },
      { "model": "doubao-pro", "avgSatisfaction": 0.68, "count": 430 }
    ],
    "promptTemplateComparison": [
      { "templateId": "pt_junior_math_01", "avgSatisfaction": 0.78, "count": 1200 },
      { "templateId": "pt_junior_math_02", "avgSatisfaction": 0.65, "count": 800 }
    ],
    "topProblematicAreas": [
      { "knowledgePoint": "KP_301_一元一次方程", "avgConfusion": 0.35, "count": 234 },
      { "knowledgePoint": "KP_305_几何图形初步", "avgConfusion": 0.28, "count": 189 }
    ],
    "hourlyTrend": [
      { "hour": "09:00", "avgSatisfaction": 0.78 },
      { "hour": "10:00", "avgSatisfaction": 0.75 },
      { "hour": "20:00", "avgSatisfaction": 0.68 }
    ]
  }
}
```

### 6.5 实时异常预警回调接口

当引擎检测到 C/D 级质量事件时，通过 Kafka 推送预警事件：

```json
// Kafka topic: quality.alert
{
  "alertId": "alert_20260729_001",
  "type": "LOW_QUALITY_TURN",
  "severity": "HIGH",
  "conversationId": "conv_xyz789",
  "userId": "U10001",
  "turnIndex": 3,
  "qualityGrade": "D",
  "scores": {
    "satisfaction": 0.15,
    "confusion": 0.82,
    "engagement": 0.20,
    "churnRisk": 0.75
  },
  "keyNegativeSignals": ["report_issue", "session_abandon", "negative_emotion"],
  "modelUsed": "glm-5",
  "promptTemplateId": "pt_junior_math_01",
  "timestamp": "2026-07-29T15:46:00.000Z"
}
```

---

## 7. 实时异常检测规则

### 7.1 单轮异常规则

| 规则ID | 条件 | 触发动作 |
| --- | --- | --- |
| R01 | qualityGrade == D | 立即推送 Kafka 预警；如连续2轮D，触发人工接管候选 |
| R02 | qualityGrade == C 且 连续≥3轮 | 推送预警；建议 Prompt 切换/模型降级 |
| R03 | confusion > 0.7 且同一知识点 | 推荐切换教学策略（换视频/换图示） |
| R04 | churnRisk > 0.6 | 触发挽留弹窗/推荐其他学习方式 |
| R05 | reportIssue == true | 自动标记该轮AI回答进入审核队列 |

### 7.2 会话级异常规则

| 规则ID | 条件 | 触发动作 |
| --- | --- | --- |
| RS01 | 会话平均 satisfaction < 0.4 | 标记为"低质量会话"，回流到Prompt优化管线 |
| RS02 | 会话总轮数 >10 且 avgConfusion > 0.5 | 标记为"无效拉锯会话"，推荐学习路径调整 |
| RS03 | 会话中 D 级轮数占比 > 30% | 标记为"模型异常会话"，触发模型质量检查 |

### 7.3 全局趋势异常规则

| 规则ID | 条件 | 触发动作 |
| --- | --- | --- |
| RG01 | 某 Prompt 模板平均满意度周环比下降 >15% | 告警Prompt负责人 |
| RG02 | 某模型日均满意度低于基线 >10% | 建议模型路由调整 |
| RG03 | 某知识点全局平均困惑度 > 0.5 | 标记为"教学难点"，建议内容团队优化 |

---

## 8. 状态流转

### 8.1 单轮评估状态机

```
信号到达 ──→ COLLECTING ──→ 特征提取 ──→ SCORING ──→ EVALUATED
    │                                              │
    │              (超时30s未齐全)                   │
    └─────────→ PARTIAL_EVAL ──────────────────────┘
                                                       │
                                          ┌────────────┤
                                          ▼            ▼
                                    NORMAL       ABNORMAL
                                   (A/B/S级)    (C/D级)
                                      │            │
                                      ▼            ▼
                                   归档存储    触发预警+审核队列
```

### 8.2 会话级评估状态机

```
CONVERSATION_STARTED
       │
       ▼ (每轮评估完成)
  IN_PROGRESS ←─────────┐
       │                │
       │ (新轮次到达)    │
       ├────────────────┘
       │
       │ (用户退出或超时15分钟无活动)
       ▼
  CONVERSATION_ENDED
       │
       ▼ (聚合计算)
  AGGREGATED
       │
       ├──→ NORMAL (S/A级) ──→ 归档
       │
       ├──→ ATTENTION (B级) ──→ 标记归档 + Prompt优化候选
       │
       └──→ PROBLEM (C/D级) ──→ 告警 + 内容审核 + 模型质量检查
```

---

## 9. 数据流与下游消费

### 9.1 评估结果消费者

| 消费者 | Kafka Topic | 消费内容 | 动作 |
| --- | --- | --- | --- |
| AI模型路由引擎 | quality.eval | 会话级满意度 | 低满意度模型降权，高满意度模型加权 |
| Prompt优化管线 | quality.eval | 低质量会话 + Prompt模板ID | 将低质量会话加入Prompt A/B测试候选 |
| 运营预警系统 | quality.alert | C/D级异常事件 | 触发企业微信/钉钉预警通知 |
| 内容审核系统 | quality.alert | reportIssue事件 | 将AI回答加入审核队列 |
| 学情分析系统 | quality.eval | 用户维度质量趋势 | 纳入学情画像 |
| 管理后台看板 | quality.dashboard | 聚合统计数据 | 展示实时质量监控大屏 |

### 9.2 数据回流 Prompt 优化

```
低质量会话 (grade ≤ C)
       │
       ▼
┌──────────────┐
│ 会话内容提取  │ ── 提取: 原始问题、AI回答、用户困惑信号、知识点
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 失败模式分类  │ ── 分类: 回答太复杂/答案错误/偏题/格式差/不安全
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Prompt候选池  │ ── 生成: Prompt变体 → A/B测试 → 选优
└──────────────┘
```

---

## 10. 性能设计

### 10.1 性能指标

| 指标 | 目标 |
| --- | --- |
| 信号上报API响应时间 | P99 ≤ 50ms（异步处理，快速确认） |
| 单轮评估计算延迟 | ≤ 500ms |
| Kafka消息端到端延迟 | ≤ 2s（信号采集→评估完成） |
| 日处理能力 | ≥ 1000万条信号事件 |
| ClickHouse查询延迟（管理后台） | ≤ 2s |

### 10.2 扩展策略

1. **Kafka 分区**：按 `conversationId` hash 分区，保证同一会话顺序处理
2. **消费者水平扩展**：评估引擎消费者组按分区数扩展，无状态可自由扩缩
3. **ClickHouse 分区**：按月分区，冷数据自动 TTL 过期
4. **Redis 缓存**：热点用户的近期评估结果缓存 5 分钟

---

## 11. 错误处理与容错

### 11.1 信号缺失处理

```python
def evaluate_with_missing_signals(event: SignalEvent) -> TurnQualityResult:
    """
    信号不完整时的降级评估策略
    """
    missing = identify_missing_signals(event)

    if missing.count > TOTAL_SIGNALS * 0.5:
        # 超过一半信号缺失 → 标记为 PARTIAL_EVAL
        return TurnQualityResult(
            status="PARTIAL",
            note=f"50%+ signals missing ({missing.list})",
            # 仅基于已有信号给出保守评分
            satisfaction=0.5,  # 中性基线
            confidence="LOW"
        )

    # 少量缺失 → 用中位数填充
    filled = impute_missing_signals(event, strategy="median_by_grade_subject")
    return evaluate_turn(filled)
```

### 11.2 异常处理

| 异常场景 | 处理策略 |
| --- | --- |
| Kafka 消费积压 | 丢弃 >30分钟前的历史信号（已无实时价值），仅处理近期信号 |
| 语义计算服务超时 | 跳过语义信号，仅用时序+行为信号评分，标记 confidence=LOW |
| ClickHouse 写入失败 | 降级写入 MySQL，后台任务补偿迁移 |
| Redis 缓存不可用 | 直接查询 ClickHouse（降级但可用） |
| 信号上报格式错误 | 记录错误日志，丢弃该条，不影响其他信号处理 |

### 11.3 数据质量保障

```java
/**
 * 信号数据质量校验
 */
@Component
public class SignalQualityValidator {

    private static final double MAX_READING_DURATION_S = 7200; // 2小时
    private static final double MAX_LATENCY_MS = 120000; // 2分钟

    public ValidationResult validate(SignalEvent event) {
        List<String> issues = new ArrayList<>();

        // 时序信号合理性检查
        if (event.getTimeline() != null) {
            if (event.getTimeline().getReadingDuration() != null) {
                double reading = event.getTimeline().getReadingDuration();
                if (reading < 0 || reading > MAX_READING_DURATION_S) {
                    issues.add("invalid_reading_duration: " + reading);
                    event.getTimeline().setReadingDuration(null); // 置空，后续用中位数填充
                }
            }
            // ... 类似校验其他时序字段
        }

        // 语义信号范围检查 [0, 1]
        if (event.getSemantic() != null) {
            checkRange(event.getSemantic().getFollowUpSimilarity(), 0, 1, "follow_up_similarity", issues);
            checkRange(event.getSemantic().getTopicDriftScore(), 0, 1, "topic_drift_score", issues);
            // ...
        }

        // 行为信号互斥检查
        if (Boolean.TRUE.equals(event.getBehaviors().getThumbUp())
            && Boolean.TRUE.equals(event.getBehaviors().getThumbDown())) {
            issues.add("conflict: thumb_up and thumb_down both true");
            // 取最后操作的为准
        }

        return new ValidationResult(issues.isEmpty(), issues);
    }
}
```

---

## 12. 安全与隐私

### 12.1 数据脱敏

- 信号上报中的 `userInput` 字段仅用于语义分析，分析完成后立即删除明文，仅保留计算的语义分数
- 用户 ID 在 ClickHouse 中做哈希处理，管理后台展示时脱敏
- 管理后台查询用户维度数据需具备 `quality:read:user` 权限

### 12.2 合规要求

- 交互信号属于用户行为数据，需在隐私政策中说明采集目的
- 未成年人交互信号采集需家长同意（家长绑定流程中包含授权）
- 用户可在「设置 → 隐私 → 数据采集」中关闭无感化评估（降级为仅依赖显式反馈）
- 数据存储周期 180 天，超期自动 TTL 删除

### 12.3 权限控制

| 权限码 | 说明 | 默认角色 |
| --- | --- | --- |
| quality:report | 信号上报 | 所有登录用户（SDK自动） |
| quality:read:self | 查看自己的质量数据 | 所有用户 |
| quality:read:user | 查看指定用户的质量数据 | 教师、家长（仅绑定学生） |
| quality:read:dashboard | 查看全局质量看板 | 运营、管理员 |
| quality:config:rule | 修改评估规则和权重 | AI工程师、管理员 |

---

## 13. 部署与配置

### 13.1 服务部署

| 组件 | 部署方式 | 资源建议 |
| --- | --- | --- |
| Signal Collection API | K8s Deployment, 3 replicas | 2C4G × 3 |
| Signal Processing Pipeline | K8s Deployment, 消费者组 | 4C8G × 3（可按积压自动扩缩） |
| Semantic Signal Service | 独立部署（GPU 嵌入模型） | GPU T4 × 1, 16C32G |
| ClickHouse | 集群 2 shard × 2 replica | 8C32G + 1TB SSD |
| MySQL（评估结果） | RDS | 4C8G + 200GB |
| Kafka | 3 broker | 已有集群复用 |
| Redis | 已有集群复用 | 4GB dedicated |

### 13.2 动态配置（配置中心）

```yaml
quality_evaluation:
  # 权重配置（可热更新）
  weights:
    satisfaction:
      reAskSameTopic: 0.20
      requestSimplify: 0.10
      # ... 完整权重表
    confusion:
      confusionWordScore: 0.25
      # ...
    engagement:
      continueFollowUp: 0.20
      # ...
    churnRisk:
      sessionAbandon: 0.25
      # ...

  # 上下文修正因子
  context:
    gradeFactors:
      preschool: 0.8
      primary: 0.9
      junior: 1.0
      senior: 1.1
    lateNightHourStart: 22
    lateNightHourEnd: 6

  # 异常检测规则
  alerts:
    consecutiveLowGradeThreshold: 2
    highConfusionThreshold: 0.7
    highChurnRiskThreshold: 0.6

  # TTL
  clickHouseTtlDays: 180

  # 功能开关
  enabled: true
  semanticServiceEnabled: true
  userOptOutDefault: false
```

---

## 14. 监控指标

| 指标 | 类型 | 告警阈值 |
| --- | --- | --- |
| signal_ingest_rate | Counter | 突降>50% → 告警（可能SDK异常） |
| signal_processing_lag_ms | Gauge | >5000ms → 告警 |
| evaluation_error_rate | Counter | >5% → 告警 |
| semantic_service_latency_ms | Gauge | >2000ms → 告警 |
| kafka_consumer_lag | Gauge | 积压>10000条 → 告警 |
| daily_d_grade_ratio | Gauge | 日D级占比>10% → 告警（AI质量整体下降） |
| model_satisfaction_drop | Gauge | 任一模型日满意度环比>15%下降 → 告警 |

---

## 15. 附录

### 15.1 困惑词与情绪词词典（教育场景扩展）

```
# 困惑词（持续扩充）
不懂, 看不懂, 不明白, 不理解, 什么意思, 为什么, 怎么做,
没思路, 不知道怎么下手, 为什么不对, 怎么算, 哪来的,
什么道理, 凭什么, 这步怎么到的, 为什么用这个公式

# 负面情绪词
烦, 无聊, 太难了, 做不到, 不想学, 放弃, 太复杂了,
绕, 讲的什么, 越讲越糊涂, 有完没完

# 正面情绪词
懂了, 明白了, 会了, 谢谢, 原来如此, 对了, 有道理,
学到了, 厉害, 清晰, 讲得好, 理解了, 通了, 简单,
原来这么简单, 我试试, 那我去做
```

### 15.2 信号采集客户端集成检查清单

- [ ] AI 回答渲染完成事件埋点
- [ ] 用户输入提交事件埋点（含输入时间戳）
- [ ] 快捷操作按钮点击埋点（简化/换法/同类题/错题本/复制/分享）
- [ ] 评价按钮埋点（有用/没用/纠错）
- [ ] 会话退出事件埋点
- [ ] 语音播放和重复播放埋点
- [ ] 滚动行为埋点（简化版：是否回滚到之前的回答）
- [ ] 批量上报逻辑（5条或30秒 flush 一次）
- [ ] 弱网降级策略（信号暂存本地，网络恢复后补传）
- [ ] 用户隐私开关对接

### 15.3 术语表

| 术语 | 定义 |
| --- | --- |
| 无感化评估 | 不需要用户主动操作的数据采集和评估方式 |
| 交互信号 | 用户与AI对话界面交互过程中产生的行为数据 |
| 轮次（Turn） | 一次用户提问 + AI回答的完整往返 |
| 会话（Conversation） | 连续的多轮对话，以15分钟无活动为超时切分 |
| 体验质量等级 | S/A/B/C/D 五级，用于标识单轮或会话的交互体验水平 |
