# 服务端 - 学生 AI 辅导对话提问意图细粒度分类与辅导策略精准匹配引擎 - 详细设计

## 1. 概述

### 1.1 功能定位

本引擎是 PrimeTop AI 辅导对话链路中的**意图理解核心**，位于「用户输入」与「Prompt 编排 / 模型调用」之间。其核心职责是：对学生在 AI 辅导对话中的每一条消息，进行**教育场景细粒度意图分类**，并据此选择最优的辅导策略（Prompt 模板、回答结构、脚手架层级、答案揭示程度）。

**核心问题：** 同样一句"二次函数怎么学"，不同情境下含义完全不同：
- 刚接触的学生 → **概念理解需求**（CONCEPT_SEEKING）→ 应从生活实例引入，避免术语堆砌
- 刚学完做错题的学生 → **纠错诊断需求**（ERROR_DIAGNOSIS）→ 应先定位误区，针对性纠正
- 考前复习的学生 → **应试梳理需求**（EXAM_PREP）→ 应聚焦考点、题型、易错点
- 提前自学的学生 → **超前学习需求**（ADVANCED_LEARNING）→ 可加快节奏，增加深度

如果用同一套 Prompt 和回答策略应对所有情况，将导致"该深入时太浅、该简明时太绕"的体验问题。

### 1.2 设计目标

| 目标 | 说明 |
|------|------|
| 意图识别准确率 | Top-1 准确率 ≥ 85%，Top-3 准确率 ≥ 95% |
| 实时响应 | 单条消息意图分类延迟 ≤ 80ms（规则） / ≤ 300ms（模型） |
| 策略一致性 | 同一意图在同一对话上下文中保持策略连贯，避免忽苏格拉底忽灌输 |
| 多轮意图漂移检测 | 实时检测对话中意图变化（如从"概念理解"漂移到"闲聊"），触发拉回或策略切换 |
| 可解释性 | 向下游输出意图分类理由和置信度，支持人工审计 |

### 1.3 在系统中的位置

```
用户消息
    │
    ▼
┌──────────────────┐     ┌───────────────────────────────┐
│  AI 输入安全护栏  │────▶│  本引擎：提问意图分类与策略匹配  │
│  (前置过滤)       │     │  IntentClassifier +           │
└──────────────────┘     │  TutoringStrategyMatcher       │
                         └──────────────┬────────────────┘
                                        │ intent_type, strategy_params
                                        ▼
                         ┌──────────────────────────────┐
                         │  Prompt 编排系统              │
                         │  (按策略参数选择模板+注入上下文) │
                         └──────────────┬───────────────┘
                                        │
                                        ▼
                         ┌──────────────────────────────┐
                         │  RAG 检索 + 大模型生成         │
                         └──────────────────────────────┘
```

### 1.4 与现有文档的边界

| 现有文档 | 关注点 | 本文档区别 |
|----------|--------|-----------|
| `学习场景意图识别与智能路由引擎-详细设计.md` | 模块级路由（用户该去哪个功能模块） | 本文聚焦**单次对话消息**的教学意图 |
| `AI教育辅导策略引擎与启发式引导系统-详细设计.md` | 整体教学策略框架和启发式方法论 | 本文是其在**消息级别**的实时执行器 |
| `服务端-AI辅导对话情感感知与自适应回应策略引擎-详细设计.md` | 情绪维度（困惑/沮丧/兴奋）的感知与回应 | 本文聚焦**认知意图**维度，与情感引擎正交协同 |
| `服务端-AI辅导对话话题漂移检测与学习焦点智能引导拉回引擎-详细设计.md` | 话题是否偏离学习领域 | 本文检测的是**学习意图类型**的漂移，更细粒度 |
| `服务端-用户提问质量评估与低质提问智能引导优化引擎-详细设计.md` | 提问质量高低评估 | 本文不评判质量，而是分类意图类型 |

---

## 2. 意图分类体系

### 2.1 意图类型定义（11 种主意图 + 4 种子意图）

| 编码 | 意图类型 | 中文 | 描述 | 典型表述 |
|------|----------|------|------|---------|
| `CONCEPT_SEEKING` | 概念理解 | "什么是XXX" | 寻求概念、定义、原理的解释 | "什么是勾股定理"、"为什么要有虚数" |
| `PROBLEM_SOLVING` | 解题求助 | "这道题怎么做" | 针对具体题目寻求解题过程 | "这道二次函数题我不会"、"帮我解这个方程" |
| `ERROR_DIAGNOSIS` | 纠错诊断 | "我哪里做错了" | 已做错，想知道为什么错 | "我这步为什么不对"、"答案为什么是B不是A" |
| `VERIFICATION` | 答案验证 | "我做对了吗" | 验证自己的答案或理解是否正确 | "这道题答案是√2对吗"、"我这样理解对不对" |
| `METHOD_SEEKING` | 方法寻求 | "有没有更好的方法" | 寻求解题技巧、方法总结 | "这类题有没有口诀"、"怎么快速判断" |
| `EXAM_PREP` | 应试准备 | "考试会怎么考" | 围绕考试要点、题型、策略 | "这个知识点高考怎么考"、"期中考什么" |
| `REVIEW_REINFORCE` | 复习巩固 | "帮我复习一下" | 对已学内容的系统性回顾 | "帮我复习一下第三章"、"生物细胞结构再讲讲" |
| `ADVANCED_LEARNING` | 超前学习 | "我想提前学" | 超出当前进度的自主学习 | "下学期的内容能提前学吗"、"深入讲讲泰勒展开" |
| `PRACTICE_REQUEST` | 练习请求 | "给我出几道题" | 主动要求练习题或同类题 | "再来一道类似的"、"给我出5道练习" |
| `KNOWLEDGE_CONNECTION` | 知识关联 | "XXX和YYY有什么关系" | 探索知识点之间的关联和区别 | "向量点乘和叉乘有什么区别"、"惯性和力有关系吗" |
| `OFF_TOPIC` | 非学习意图 | "陪我聊聊天" | 与学习无关的请求 | "给我讲个笑话"、"你喜欢什么电影" |

**4 种子意图**（仅在 `PROBLEM_SOLVING` 下细分）：

| 子编码 | 子意图 | 描述 |
|--------|--------|------|
| `PS_FULL_SOLUTION` | 完整解题 | 需要完整过程和答案 |
| `PS_HINT_ONLY` | 仅需提示 | 只需思路点拨，不要完整答案 |
| `PS_STUCK_POINT` | 卡点求助 | 只在某一步卡住 |
| `PS_ALTERNATIVE` | 换种讲法 | 当前讲法不理解，换一种 |

### 2.2 意图分类特征体系

意图分类基于以下特征维度综合判定：

```
特征向量 = [
    linguistic_features,      # 语言学特征（关键词、句式、标点）
    context_features,         # 对话上下文特征（前序意图、对话轮次）
    student_profile_features, # 学生画像特征（年级、近期错题、学习进度）
    temporal_features,        # 时间特征（是否考试季、是否寒暑假）
    behavioral_features       # 行为特征（输入时长、编辑次数、是否来自错题本）
]
```

#### 2.2.1 语言学特征

| 特征 | 提取方式 | 判定权重 |
|------|---------|---------|
| 疑问词模式 | 正则匹配 "什么是/为什么/怎么做/对不对/有没有" | 高 |
| 题目标记 | 检测"这道题/第X题/如图所示/图片中" | 高 |
| 错误标记 | 检测"做错了/不对/为什么选/为什么不是" | 高 |
| 验证标记 | 检测"对吗/行吗/可以吗/是不是" + 答案内容 | 中 |
| 方法标记 | 检测"技巧/口诀/方法/套路/快捷" | 中 |
| 考试标记 | 检测"考试/高考/中考/期末/考点/真题" | 中 |
| 复习标记 | 检测"复习/回顾/再讲讲/总结" | 中 |
| 练习标记 | 检测"出题/练习/同类题/再来一道" | 高 |
| 图片附件 | 是否附带图片（拍题场景） | 高 |

#### 2.2.2 上下文特征

| 特征 | 说明 |
|------|------|
| `prev_intent` | 同会话前一轮意图类型 |
| `prev_strategy` | 前一轮使用的辅导策略 |
| `turn_index` | 当前是对话第几轮 |
| `same_topic_turns` | 在同一话题上已对话的轮数 |
| `recent_error_context` | 最近 30 分钟内是否有错题记录 |
| `entry_point` | 消息来源入口（AI对话页/拍题/错题本/同步课堂） |

---

## 3. 数据结构定义

### 3.1 意图分类记录表 `ai_intent_log`

```sql
CREATE TABLE ai_intent_log (
    id                BIGINT PRIMARY KEY AUTO_INCREMENT,
    log_id            VARCHAR(40) NOT NULL UNIQUE COMMENT '日志ID（UUID）',
    conversation_id   VARCHAR(40) NOT NULL COMMENT '对话会话ID',
    message_id        VARCHAR(40) NOT NULL COMMENT '消息ID',
    user_id           BIGINT NOT NULL COMMENT '学生ID',
    
    -- 分类结果
    primary_intent    VARCHAR(40) NOT NULL COMMENT '主意图编码',
    sub_intent        VARCHAR(40) NULL COMMENT '子意图编码（仅PROBLEM_SOLVING）',
    confidence_score  DECIMAL(5,4) NOT NULL COMMENT '置信度 [0,1]',
    runner_up_intent  VARCHAR(40) NULL COMMENT '第二候选意图',
    runner_up_score   DECIMAL(5,4) NULL COMMENT '第二候选置信度',
    
    -- 分类方法
    classify_method   VARCHAR(20) NOT NULL COMMENT '分类方法: RULE/MODEL/ENSEMBLE',
    classify_latency_ms INT NOT NULL COMMENT '分类耗时(毫秒)',
    
    -- 输入特征快照
    feature_snapshot  JSON NOT NULL COMMENT '特征向量快照',
    
    -- 匹配的策略
    matched_strategy  VARCHAR(40) NOT NULL COMMENT '匹配的辅导策略编码',
    
    -- 元数据
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_conversation (conversation_id, created_at),
    INDEX idx_user_intent (user_id, primary_intent, created_at),
    INDEX idx_intent_stats (primary_intent, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI对话意图分类日志';
```

### 3.2 辅导策略配置表 `tutoring_strategy_config`

```sql
CREATE TABLE tutoring_strategy_config (
    id                INT PRIMARY KEY AUTO_INCREMENT,
    strategy_code     VARCHAR(40) NOT NULL UNIQUE COMMENT '策略编码',
    strategy_name     VARCHAR(80) NOT NULL COMMENT '策略名称',
    
    -- 适用意图（可多选）
    applicable_intents JSON NOT NULL COMMENT '适用的意图类型列表',
    
    -- Prompt 配置
    prompt_template_id VARCHAR(40) NOT NULL COMMENT '关联的Prompt模板ID',
    prompt_overrides  JSON NULL COMMENT 'Prompt变量覆盖',
    
    -- 回答结构控制
    response_structure VARCHAR(30) NOT NULL COMMENT '回答结构: CONCEPT_FIRST/STEP_FIRST/HINT_FIRST/QA_FIRST/SUMMARY_FIRST',
    max_response_tokens INT NOT NULL COMMENT '最大生成长度',
    
    -- 答案揭示策略
    answer_reveal_level VARCHAR(20) NOT NULL COMMENT '答案揭示: FULL/GRADUAL/HINT_ONLY/WITHHOLD',
    reveal_steps_max INT NULL COMMENT '渐进揭示最大步数',
    
    -- 脚手架（Scaffolding）配置
    scaffolding_level VARCHAR(20) NOT NULL COMMENT '脚手架级别: HIGH/MEDIUM/LOW/NONE',
    use_socratic      TINYINT NOT NULL DEFAULT 0 COMMENT '是否使用苏格拉底式追问',
    use_analogy       TINYINT NOT NULL DEFAULT 1 COMMENT '是否使用类比举例',
    
    -- 后续操作建议
    followup_actions  JSON NOT NULL COMMENT '回答后推荐的快捷操作列表',
    
    -- 适用条件
    min_grade_level   INT NOT NULL DEFAULT 1 COMMENT '最低适用年级(1-12)',
    max_grade_level   INT NOT NULL DEFAULT 12 COMMENT '最高适用年级(1-12)',
    
    -- 优先级和状态
    priority          INT NOT NULL DEFAULT 100 COMMENT '优先级（多个策略匹配时取最高）',
    status            VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' COMMENT '状态: ACTIVE/DISABLED/TESTING',
    
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_intent_lookup (applicable_intents(128), status, priority DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='辅导策略配置';
```

### 3.3 意图漂移检测配置表 `intent_drift_config`

```sql
CREATE TABLE intent_drift_config (
    id                INT PRIMARY KEY AUTO_INCREMENT,
    source_intent     VARCHAR(40) NOT NULL COMMENT '起始意图',
    target_intent     VARCHAR(40) NOT NULL COMMENT '漂移到目标意图',
    drift_type        VARCHAR(30) NOT NULL COMMENT '漂移类型: NATURAL_TRANSITION/DEGRADATION/FOCUS_LOSS',
    severity          VARCHAR(20) NOT NULL COMMENT '严重度: NORMAL/WARNING/CRITICAL',
    
    -- 处理动作
    action_type       VARCHAR(30) NOT NULL COMMENT '处理动作: ALLOW/PULLBACK/INTERVENE/FLAG',
    pullback_message  TEXT NULL COMMENT '拉回消息模板',
    max_consecutive   INT NULL COMMENT '允许连续漂移的最大轮数',
    
    -- 条件
    min_turn_index    INT NOT NULL DEFAULT 1 COMMENT '对话第几轮起检测',
    
    status            VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_drift_lookup (source_intent, target_intent, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='意图漂移检测配置';
```

### 3.4 核心数据模型（Java）

```java
/**
 * 学生提问意图分类结果
 */
@Data
@Builder
public class IntentClassificationResult {
    /** 主意图 */
    private QuestionIntent primaryIntent;
    
    /** 子意图（仅 PROBLEM_SOLVING） */
    private ProblemSolvingSubIntent subIntent;
    
    /** 置信度 [0, 1] */
    private double confidence;
    
    /** 分类方法 */
    private ClassifyMethod method;
    
    /** 第二候选意图及置信度 */
    private QuestionIntent runnerUpIntent;
    private double runnerUpConfidence;
    
    /** 分类耗时 */
    private long latencyMs;
    
    /** 特征快照 */
    private IntentFeatureSnapshot features;
    
    /** 匹配的辅导策略 */
    private TutoringStrategy matchedStrategy;
    
    /** 意图漂移检测结果 */
    private IntentDriftResult driftResult;
    
    public enum ClassifyMethod {
        RULE,       // 规则匹配
        MODEL,      // 轻量模型
        ENSEMBLE    // 规则 + 模型融合
    }
}

/**
 * 辅导策略参数（传递给 Prompt 编排系统）
 */
@Data
@Builder
public class TutoringStrategy {
    private String strategyCode;
    private String strategyName;
    private String promptTemplateId;
    private Map<String, Object> promptOverrides;
    private ResponseStructure responseStructure;
    private int maxResponseTokens;
    private AnswerRevealLevel answerRevealLevel;
    private int revealStepsMax;
    private ScaffoldingLevel scaffoldingLevel;
    private boolean useSocratic;
    private boolean useAnalogy;
    private List<FollowupAction> followupActions;
    
    public enum ResponseStructure {
        CONCEPT_FIRST,   // 先概念后例子
        STEP_FIRST,      // 先分步后总结
        HINT_FIRST,      // 先提示后展开
        QA_FIRST,        // 先回答后展开
        SUMMARY_FIRST    // 先总结后详述
    }
    
    public enum AnswerRevealLevel {
        FULL,            // 完整展示答案
        GRADUAL,         // 渐进展示
        HINT_ONLY,       // 仅提示
        WITHHOLD         // 隐藏答案
    }
    
    public enum ScaffoldingLevel {
        HIGH,            // 大量引导
        MEDIUM,          // 适度引导
        LOW,             // 少量引导
        NONE             // 无脚手架
    }
}

/**
 * 后续推荐操作
 */
@Data
@AllArgsConstructor
public class FollowupAction {
    private String actionCode;     // 操作编码
    private String actionLabel;    // 显示文案
    private String actionType;     // 类型: PRACTICE/REVIEW/EXPLORE/VERIFY
    private int priority;          // 推荐优先级
}
```

---

## 4. 核心算法设计

### 4.1 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                  IntentClassificationEngine                      │
│                                                                 │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────────┐  │
│  │ FeatureBuilder│  │ RuleClassifier│  │  ModelClassifier   │  │
│  │ (特征构建器)  │  │ (规则分类器)  │  │  (模型分类器)       │  │
│  └──────┬───────┘  └──────┬───────┘  └─────────┬──────────┘  │
│         │                  │                     │              │
│         ▼                  ▼                     ▼              │
│  ┌──────────────┐   ┌──────────────────────────────────────┐  │
│  │ FeatureStore │──▶│        EnsembleDecisionEngine          │  │
│  │ (特征缓存)   │   │        (融合决策器)                     │  │
│  └──────────────┘   └──────────────────┬───────────────────┘  │
│                                         │                      │
│  ┌──────────────────────────────────────┐                     │
│  │  TutoringStrategyMatcher              │◀────────────────────┘
│  │  (辅导策略匹配器)                      │
│  └──────────────────┬───────────────────┘
│                     │
│  ┌──────────────────────────────────────┐
│  │  IntentDriftDetector                  │
│  │  (意图漂移检测器)                      │
│  └──────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 FeatureBuilder — 特征构建器

```java
/**
 * 特征构建器：从用户消息和上下文中提取分类特征
 */
@Component
public class FeatureBuilder {
    
    private static final Pattern QUESTION_PATTERN = Pattern.compile(
        "(?:什么是|什么叫|.*是什么|.*是什么意思|.*的含义|.*的定义)"
    );
    private static final Pattern PROBLEM_PATTERN = Pattern.compile(
        "(?:这道题|第\\d+题|如图所示|帮我解|怎么做|求\\w+的值|计算|证明)"
    );
    private static final Pattern ERROR_PATTERN = Pattern.compile(
        "(?:做错了|不对|为什么错|为什么选\\w*不选|为什么不是|哪里错了|错在哪)"
    );
    private static final Pattern VERIFY_PATTERN = Pattern.compile(
        "(?:对吗|对不对|行吗|可以吗|是不是|是不是这样|正确吗|这样写对)"
    );
    private static final Pattern METHOD_PATTERN = Pattern.compile(
        "(?:技巧|口诀|方法|套路|快捷|更快|更简单|有没有.*办法|怎么快速)"
    );
    private static final Pattern EXAM_PATTERN = Pattern.compile(
        "(?:考试|高考|中考|期末|期中|月考|模考|考点|真题|会考什么|考哪些)"
    );
    private static final Pattern REVIEW_PATTERN = Pattern.compile(
        "(?:复习|回顾|再讲讲|重新讲|总结|梳理|串.*一遍)"
    );
    private static final Pattern PRACTICE_PATTERN = Pattern.compile(
        "(?:出题|练习|同类题|再来.*道|做几道|给我.*题|练.*手)"
    );
    private static final Pattern CONNECTION_PATTERN = Pattern.compile(
        "(?:.*和.*的区别|.*跟.*的关系|.*和.*有什么.*|对比|比较.*和)"
    );
    private static final Pattern OFF_TOPIC_PATTERN = Pattern.compile(
        "(?:讲个.*故事|笑话|聊天|玩游戏|你喜欢|你叫什么|你是.*机器人)"
    );
    
    // 关键词权重表
    private static final Map<Pattern, QuestionIntent> RULE_MAP = Map.ofEntries(
        Map.entry(QUESTION_PATTERN, QuestionIntent.CONCEPT_SEEKING),
        Map.entry(PROBLEM_PATTERN, QuestionIntent.PROBLEM_SOLVING),
        Map.entry(ERROR_PATTERN, QuestionIntent.ERROR_DIAGNOSIS),
        Map.entry(VERIFY_PATTERN, QuestionIntent.VERIFICATION),
        Map.entry(METHOD_PATTERN, QuestionIntent.METHOD_SEEKING),
        Map.entry(EXAM_PATTERN, QuestionIntent.EXAM_PREP),
        Map.entry(REVIEW_PATTERN, QuestionIntent.REVIEW_REINFORCE),
        Map.entry(PRACTICE_PATTERN, QuestionIntent.PRACTICE_REQUEST),
        Map.entry(CONNECTION_PATTERN, QuestionIntent.KNOWLEDGE_CONNECTION),
        Map.entry(OFF_TOPIC_PATTERN, QuestionIntent.OFF_TOPIC)
    );
    
    /**
     * 构建完整特征向量
     */
    public IntentFeatureSnapshot build(
            String message,
            List<String> attachments,
            ConversationContext context,
            StudentProfile profile) {
        
        return IntentFeatureSnapshot.builder()
            .linguisticFeatures(extractLinguisticFeatures(message, attachments))
            .contextFeatures(extractContextFeatures(context))
            .profileFeatures(extractProfileFeatures(profile))
            .temporalFeatures(extractTemporalFeatures())
            .behavioralFeatures(extractBehavioralFeatures(message, context))
            .build();
    }
    
    /**
     * 提取语言学特征
     */
    private LinguisticFeatures extractLinguisticFeatures(String message, List<String> attachments) {
        String normalized = message.trim().toLowerCase();
        boolean hasImage = attachments != null && !attachments.isEmpty();
        int messageLength = message.length();
        
        // 匹配各意图关键词
        Map<QuestionIntent, Double> ruleScores = new EnumMap<>(QuestionIntent.class);
        for (Map.Entry<Pattern, QuestionIntent> entry : RULE_MAP.entrySet()) {
            Matcher m = entry.getKey().matcher(normalized);
            if (m.find()) {
                ruleScores.merge(entry.getValue(), 1.0, Double::sum);
            }
        }
        
        // 句式特征
        boolean isQuestion = normalized.contains("？") || normalized.contains("?");
        boolean startsWithWhy = normalized.startsWith("为什么");
        boolean hasImperative = normalized.startsWith("帮我") || normalized.startsWith("给我") 
                                || normalized.startsWith("教教") || normalized.startsWith("讲讲");
        
        // 数学公式检测
        boolean hasMathFormula = message.contains("$") || message.contains("\\frac") 
                                  || message.contains("\\sqrt") || message.matches(".*[=±±].*\\d.*");
        
        return LinguisticFeatures.builder()
            .messageLength(messageLength)
            .hasImage(hasImage)
            .hasMathFormula(hasMathFormula)
            .isQuestion(isQuestion)
            .startsWithWhy(startsWithWhy)
            .hasImperative(hasImperative)
            .ruleScores(ruleScores)
            .build();
    }
    
    /**
     * 提取上下文特征
     */
    private ContextFeatures extractContextFeatures(ConversationContext context) {
        return ContextFeatures.builder()
            .prevIntent(context.getPreviousIntent())
            .prevStrategy(context.getPreviousStrategyCode())
            .turnIndex(context.getTurnIndex())
            .sameTopicTurns(context.getSameTopicTurnCount())
            .hasRecentErrors(context.hasRecentErrorsLast30Min())
            .entryPoint(context.getEntryPoint())
            .build();
    }
    
    /**
     * 提取学生画像特征
     */
    private ProfileFeatures extractProfileFeatures(StudentProfile profile) {
        return ProfileFeatures.builder()
            .gradeLevel(profile.getGradeLevel())
            .stageCode(profile.getStageCode())
            .weakSubjects(profile.getWeakSubjects())
            .currentChapterId(profile.getCurrentChapterId())
            .learningStyle(profile.getPreferredLearningStyle())
            .build();
    }
    
    /**
     * 提取时间特征
     */
    private TemporalFeatures extractTemporalFeatures() {
        LocalDate now = LocalDate.now();
        int month = now.getMonthValue();
        
        return TemporalFeatures.builder()
            .isExamSeason(month >= 5 && month <= 6 || month >= 11 && month <= 12)
            .isSummerBreak(month >= 7 && month <= 8)
            .isWinterBreak(month == 1 || month == 2)
            .dayOfWeek(now.getDayOfWeek().getValue())
            .build();
    }
    
    /**
     * 提取行为特征
     */
    private BehavioralFeatures extractBehavioralFeatures(String message, ConversationContext context) {
        return BehavioralFeatures.builder()
            .inputDurationSec(context.getLastInputDurationSec())
            .editCount(context.getLastMessageEditCount())
            .fromErrorBook("error_book".equals(context.getEntryPoint()))
            .fromExamModule("exam_practice".equals(context.getEntryPoint()))
            .fromClassroom("sync_classroom".equals(context.getEntryPoint()))
            .build();
    }
}
```

### 4.3 RuleClassifier — 规则分类器

规则分类器使用多级规则树进行快速分类，延迟目标 ≤ 50ms：

```java
/**
 * 规则分类器 — 基于关键词和上下文规则的快速分类
 */
@Component
public class RuleClassifier {
    
    /**
     * 规则分类主入口
     * @return 分类结果，置信度 0-1
     */
    public RuleClassifyResult classify(IntentFeatureSnapshot features) {
        List<RuleScore> scores = new ArrayList<>();
        
        // === 第一级：强信号规则（置信度 ≥ 0.85） ===
        
        // 1. 图片附件 + "怎么做" → PROBLEM_SOLVING
        if (features.getLinguisticFeatures().isHasImage() && 
            features.getLinguisticFeatures().getRuleScores()
                .getOrDefault(QuestionIntent.PROBLEM_SOLVING, 0.0) > 0) {
            scores.add(new RuleScore(QuestionIntent.PROBLEM_SOLVING, 0.95, 
                "IMG+PROBLEM_KW", RuleTier.STRONG));
        }
        
        // 2. 来自错题本入口 + 任何提问 → ERROR_DIAGNOSIS
        if (features.getBehavioralFeatures().isFromErrorBook() &&
            features.getLinguisticFeatures().isQuestion()) {
            scores.add(new RuleScore(QuestionIntent.ERROR_DIAGNOSIS, 0.88,
                "ERROR_BOOK_ENTRY+QUESTION", RuleTier.STRONG));
        }
        
        // 3. "给我出题" 类明确练习请求
        if (features.getLinguisticFeatures().getRuleScores()
                .getOrDefault(QuestionIntent.PRACTICE_REQUEST, 0.0) > 0) {
            scores.add(new RuleScore(QuestionIntent.PRACTICE_REQUEST, 0.92,
                "PRACTICE_KW", RuleTier.STRONG));
        }
        
        // 4. 明确的非学习请求
        if (features.getLinguisticFeatures().getRuleScores()
                .getOrDefault(QuestionIntent.OFF_TOPIC, 0.0) > 0) {
            scores.add(new RuleScore(QuestionIntent.OFF_TOPIC, 0.90,
                "OFF_TOPIC_KW", RuleTier.STRONG));
        }
        
        // === 第二级：中等信号规则（置信度 0.65-0.84） ===
        
        for (Map.Entry<QuestionIntent, Double> entry : 
                features.getLinguisticFeatures().getRuleScores().entrySet()) {
            if (entry.getValue() > 0 && scores.stream()
                    .noneMatch(s -> s.intent == entry.getKey())) {
                double confidence = calculateContextualConfidence(entry.getKey(), features);
                scores.add(new RuleScore(entry.getKey(), confidence,
                    "KW_MATCH:" + entry.getKey(), RuleTier.MEDIUM));
            }
        }
        
        // === 第三级：上下文推断（置信度 0.40-0.64） ===
        
        // 5. 前序意图延续
        if (features.getContextFeatures().getPrevIntent() != null && 
            scores.stream().allMatch(s -> s.confidence < 0.65)) {
            QuestionIntent prev = features.getContextFeatures().getPrevIntent();
            scores.add(new RuleScore(prev, 0.55,
                "PREV_INTENT_CONTINUATION", RuleTier.WEAK));
        }
        
        // 6. 来自考试模块 → EXAM_PREP
        if (features.getBehavioralFeatures().isFromExamModule() &&
            scores.stream().allMatch(s -> s.confidence < 0.65)) {
            scores.add(new RuleScore(QuestionIntent.EXAM_PREP, 0.60,
                "EXAM_MODULE_ENTRY", RuleTier.WEAK));
        }
        
        // 取最高分
        return selectBest(scores);
    }
    
    /**
     * 基于上下文调整置信度
     */
    private double calculateContextualConfidence(
            QuestionIntent intent, IntentFeatureSnapshot features) {
        double base = 0.72;
        
        // 年级匹配加成
        if (intent == QuestionIntent.EXAM_PREP && 
            features.getProfileFeatures().getGradeLevel() >= 9) {
            base += 0.08; // 初高中更可能问考试
        }
        
        // 近期错题加成
        if (intent == QuestionIntent.ERROR_DIAGNOSIS && 
            features.getContextFeatures().isHasRecentErrors()) {
            base += 0.10;
        }
        
        // 考试季节加成
        if (intent == QuestionIntent.EXAM_PREP && 
            features.getTemporalFeatures().isExamSeason()) {
            base += 0.06;
        }
        
        return Math.min(base, 0.85);
    }
    
    private RuleClassifyResult selectBest(List<RuleScore> scores) {
        if (scores.isEmpty()) {
            // 无规则命中，返回默认意图
            return new RuleClassifyResult(
                QuestionIntent.CONCEPT_SEEKING, 0.35, 
                "DEFAULT_FALLBACK", RuleTier.NONE);
        }
        
        scores.sort(Comparator.comparingDouble(RuleScore::confidence).reversed());
        RuleScore best = scores.get(0);
        return new RuleClassifyResult(
            best.intent, best.confidence, best.ruleId, best.tier);
    }
    
    @Data
    @AllArgsConstructor
    private static class RuleScore {
        QuestionIntent intent;
        double confidence;
        String ruleId;
        RuleTier tier;
    }
    
    private enum RuleTier { STRONG, MEDIUM, WEAK, NONE }
}
```

### 4.4 ModelClassifier — 轻量模型分类器

当规则分类器置信度 < 0.75 时，调用轻量文本分类模型：

```python
"""
意图分类轻量模型 — 基于 FastText 的多类别分类器
模型大小: ~8MB | 推理延迟: <50ms (CPU)
训练数据: 标注的教育对话历史（目标 ≥ 50万条）
"""

import fasttext
import numpy as np
from typing import Tuple

class IntentModelClassifier:
    
    LABEL_MAP = {
        "__label__concept_seeking":    "CONCEPT_SEEKING",
        "__label__problem_solving":    "PROBLEM_SOLVING",
        "__label__error_diagnosis":    "ERROR_DIAGNOSIS",
        "__label__verification":       "VERIFICATION",
        "__label__method_seeking":     "METHOD_SEEKING",
        "__label__exam_prep":          "EXAM_PREP",
        "__label__review_reinforce":   "REVIEW_REINFORCE",
        "__label__advanced_learning":  "ADVANCED_LEARNING",
        "__label__practice_request":   "PRACTICE_REQUEST",
        "__label__knowledge_connection": "KNOWLEDGE_CONNECTION",
        "__label__off_topic":          "OFF_TOPIC",
    }
    
    def __init__(self, model_path: str):
        self.model = fasttext.load_model(model_path)
    
    def classify(self, message: str, context_features: dict) -> Tuple[str, float]:
        """
        返回 (意图编码, 置信度)
        """
        # 预处理：保留中文、英文、数字、常见标点
        cleaned = self._preprocess(message)
        
        # 拼接上下文摘要（前一轮意图 + 入口来源）
        context_str = self._build_context_str(context_features)
        input_text = f"{cleaned} {context_str}".strip()
        
        # 模型预测
        labels, probs = self.model.predict(input_text, k=3)
        
        top_label = self.LABEL_MAP.get(labels[0], "CONCEPT_SEEKING")
        top_prob = float(probs[0])
        
        # 置信度校准（Platt Scaling）
        calibrated_prob = self._calibrate(top_prob)
        
        return top_label, calibrated_prob
    
    def _preprocess(self, text: str) -> str:
        import re
        # 移除控制字符
        text = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', text)
        # 标准化标点
        text = text.replace('？', '?').replace('！', '!')
        # 截断
        return text[:200].strip().lower()
    
    def _build_context_str(self, ctx: dict) -> str:
        parts = []
        if ctx.get("prev_intent"):
            parts.append(f"[prev:{ctx['prev_intent']}]")
        if ctx.get("entry_point"):
            parts.append(f"[from:{ctx['entry_point']}]")
        if ctx.get("has_recent_errors"):
            parts.append("[recent_error]")
        return " ".join(parts)
    
    def _calibrate(self, raw_prob: float) -> float:
        """
        Platt Scaling 校准
        通过验证集拟合的 sigmoid 参数
        """
        # 参数通过验证集学习得到
        A, B = 2.3, -0.8  # 示例值，需根据实际验证集调整
        import math
        calibrated = 1.0 / (1.0 + math.exp(-(A * raw_prob + B)))
        return max(0.0, min(1.0, calibrated))
```

### 4.5 EnsembleDecisionEngine — 融合决策器

```java
/**
 * 融合决策器：整合规则分类器和模型分类器的结果
 */
@Component
public class EnsembleDecisionEngine {
    
    @Autowired
    private RuleClassifier ruleClassifier;
    
    @Autowired
    private ModelClassifier modelClassifier;
    
    // 规则分类器的权重（高置信度规则结果优先）
    private static final double RULE_WEIGHT_STRONG = 0.85;
    private static final double RULE_WEIGHT_MEDIUM = 0.55;
    private static final double RULE_WEIGHT_WEAK = 0.30;
    private static final double MODEL_WEIGHT = 0.60;
    
    // 规则与模型一致时的置信度加成
    private static final double AGREEMENT_BONUS = 0.12;
    
    /**
     * 融合分类
     */
    public IntentClassificationResult classify(
            IntentFeatureSnapshot features,
            String rawMessage,
            ConversationContext context) {
        
        long startTime = System.currentTimeMillis();
        
        // 1. 规则分类（始终执行，快速）
        RuleClassifyResult ruleResult = ruleClassifier.classify(features);
        
        // 2. 判断是否需要模型分类
        IntentClassificationResult.ClassifyMethod method;
        QuestionIntent finalIntent;
        double finalConfidence;
        QuestionIntent runnerUp = null;
        double runnerUpConfidence = 0;
        
        if (ruleResult.getConfidence() >= 0.85 && ruleResult.getTier() == RuleTier.STRONG) {
            // 规则强信号，直接采用，跳过模型调用
            method = IntentClassificationResult.ClassifyMethod.RULE;
            finalIntent = ruleResult.getIntent();
            finalConfidence = ruleResult.getConfidence();
            
        } else {
            // 需要模型分类
            ModelClassifyResult modelResult = modelClassifier.classify(
                rawMessage, context.toModelContext());
            
            if (ruleResult.getConfidence() < 0.40) {
                // 规则太弱，以模型为主
                method = IntentClassificationResult.ClassifyMethod.MODEL;
                finalIntent = modelResult.getIntent();
                finalConfidence = modelResult.getConfidence();
                runnerUp = modelResult.getRunnerUp();
                runnerUpConfidence = modelResult.getRunnerUpConfidence();
                
            } else {
                // 融合
                method = IntentClassificationResult.ClassifyMethod.ENSEMBLE;
                
                // 计算加权分数
                double ruleWeight = getRuleWeight(ruleResult.getTier());
                
                if (ruleResult.getIntent() == modelResult.getIntent()) {
                    // 规则与模型一致 → 高置信度
                    finalIntent = ruleResult.getIntent();
                    finalConfidence = Math.min(1.0, 
                        (ruleResult.getConfidence() * ruleWeight + 
                         modelResult.getConfidence() * MODEL_WEIGHT) / 
                        (ruleWeight + MODEL_WEIGHT) + AGREEMENT_BONUS);
                } else {
                    // 不一致 → 取权重高的一方
                    double ruleScore = ruleResult.getConfidence() * ruleWeight;
                    double modelScore = modelResult.getConfidence() * MODEL_WEIGHT;
                    
                    if (ruleScore >= modelScore) {
                        finalIntent = ruleResult.getIntent();
                        finalConfidence = ruleResult.getConfidence();
                        runnerUp = modelResult.getIntent();
                        runnerUpConfidence = modelResult.getConfidence();
                    } else {
                        finalIntent = modelResult.getIntent();
                        finalConfidence = modelResult.getConfidence();
                        runnerUp = ruleResult.getIntent();
                        runnerUpConfidence = ruleResult.getConfidence();
                    }
                }
            }
        }
        
        long latency = System.currentTimeMillis() - startTime;
        
        // 3. PROBLEM_SOLVING 子意图细分
        ProblemSolvingSubIntent subIntent = null;
        if (finalIntent == QuestionIntent.PROBLEM_SOLVING) {
            subIntent = classifyProblemSolvingSubIntent(rawMessage, features);
        }
        
        return IntentClassificationResult.builder()
            .primaryIntent(finalIntent)
            .subIntent(subIntent)
            .confidence(finalConfidence)
            .method(method)
            .runnerUpIntent(runnerUp)
            .runnerUpConfidence(runnerUpConfidence)
            .latencyMs(latency)
            .features(features)
            .build();
    }
    
    /**
     * PROBLEM_SOLVING 子意图分类
     */
    private ProblemSolvingSubIntent classifyProblemSolvingSubIntent(
            String message, IntentFeatureSnapshot features) {
        String lower = message.toLowerCase();
        
        // "换一种讲法" / "再讲简单点" → PS_ALTERNATIVE
        if (lower.contains("换") || lower.contains("简单") || 
            lower.contains("听不懂") || lower.contains("另一种")) {
            return ProblemSolvingSubIntent.PS_ALTERNATIVE;
        }
        
        // 来自前序回答后的追问 → 大概率是 PS_STUCK_POINT
        if (features.getContextFeatures().getTurnIndex() > 1 &&
            features.getContextFeatures().getSameTopicTurns() > 0) {
            return ProblemSolvingSubIntent.PS_STUCK_POINT;
        }
        
        // 答案管控场景（答案管控引擎设置 HINT_ONLY）→ PS_HINT_ONLY
        if (features.getLinguisticFeatures().getRuleScores()
                .getOrDefault(QuestionIntent.METHOD_SEEKING, 0.0) > 0) {
            return ProblemSolvingSubIntent.PS_HINT_ONLY;
        }
        
        // 默认：完整解题
        return ProblemSolvingSubIntent.PS_FULL_SOLUTION;
    }
    
    private double getRuleWeight(RuleTier tier) {
        return switch (tier) {
            case STRONG -> RULE_WEIGHT_STRONG;
            case MEDIUM -> RULE_WEIGHT_MEDIUM;
            case WEAK -> RULE_WEIGHT_WEAK;
            default -> 0.10;
        };
    }
}
```

### 4.6 TutoringStrategyMatcher — 辅导策略匹配器

```java
/**
 * 辅导策略匹配器：根据意图分类结果选择最优辅导策略
 */
@Component
public class TutoringStrategyMatcher {
    
    @Autowired
    private TutoringStrategyConfigRepository strategyRepo;
    
    /**
     * 默认意图→策略映射（数据库不可用时的兜底）
     */
    private static final Map<QuestionIntent, TutoringStrategy> FALLBACK_MAP = Map.of(
        QuestionIntent.CONCEPT_SEEKING, TutoringStrategy.builder()
            .strategyCode("TS_CONCEPT")
            .responseStructure(TutoringStrategy.ResponseStructure.CONCEPT_FIRST)
            .answerRevealLevel(TutoringStrategy.AnswerRevealLevel.GRADUAL)
            .scaffoldingLevel(TutoringStrategy.ScaffoldingLevel.HIGH)
            .useSocratic(false)
            .useAnalogy(true)
            .followupActions(List.of(
                new FollowupAction("practice", "练一道相关题", "PRACTICE", 1),
                new FollowupAction("ask_more", "继续追问", "EXPLORE", 2)))
            .build(),
        
        QuestionIntent.PROBLEM_SOLVING, TutoringStrategy.builder()
            .strategyCode("TS_SOLVE")
            .responseStructure(TutoringStrategy.ResponseStructure.STEP_FIRST)
            .answerRevealLevel(TutoringStrategy.AnswerRevealLevel.GRADUAL)
            .revealStepsMax(5)
            .scaffoldingLevel(TutoringStrategy.ScaffoldingLevel.MEDIUM)
            .useSocratic(true)
            .useAnalogy(false)
            .followupActions(List.of(
                new FollowupAction("similar", "练一道同类题", "PRACTICE", 1),
                new FollowupAction("error_book", "加入错题本", "REVIEW", 2),
                new FollowupAction("method", "总结解题方法", "EXPLORE", 3)))
            .build(),
        
        QuestionIntent.ERROR_DIAGNOSIS, TutoringStrategy.builder()
            .strategyCode("TS_DIAGNOSE")
            .responseStructure(TutoringStrategy.ResponseStructure.QA_FIRST)
            .answerRevealLevel(TutoringStrategy.AnswerRevealLevel.GRADUAL)
            .scaffoldingLevel(TutoringStrategy.ScaffoldingLevel.HIGH)
            .useSocratic(true)
            .useAnalogy(true)
            .followupActions(List.of(
                new FollowupAction("similar", "再做一道检验", "PRACTICE", 1),
                new FollowupAction("review", "复习相关知识点", "REVIEW", 2)))
            .build(),
        
        QuestionIntent.VERIFICATION, TutoringStrategy.builder()
            .strategyCode("TS_VERIFY")
            .responseStructure(TutoringStrategy.ResponseStructure.QA_FIRST)
            .answerRevealLevel(TutoringStrategy.AnswerRevealLevel.FULL)
            .scaffoldingLevel(TutoringStrategy.ScaffoldingLevel.LOW)
            .useSocratic(false)
            .useAnalogy(false)
            .followupActions(List.of(
                new FollowupAction("similar", "练一道同类题", "PRACTICE", 1)))
            .build(),
        
        QuestionIntent.EXAM_PREP, TutoringStrategy.builder()
            .strategyCode("TS_EXAM")
            .responseStructure(TutoringStrategy.ResponseStructure.SUMMARY_FIRST)
            .answerRevealLevel(TutoringStrategy.AnswerRevealLevel.FULL)
            .scaffoldingLevel(TutoringStrategy.ScaffoldingLevel.LOW)
            .useSocratic(false)
            .useAnalogy(false)
            .followupActions(List.of(
                new FollowupAction("practice", "模拟练习", "PRACTICE", 1),
                new FollowupAction("review", "考点串讲", "REVIEW", 2)))
            .build(),
        
        QuestionIntent.OFF_TOPIC, TutoringStrategy.builder()
            .strategyCode("TS_REDIRECT")
            .responseStructure(TutoringStrategy.ResponseStructure.QA_FIRST)
            .answerRevealLevel(TutoringStrategy.AnswerRevealLevel.WITHHOLD)
            .scaffoldingLevel(TutoringStrategy.ScaffoldingLevel.NONE)
            .useSocratic(false)
            .useAnalogy(false)
            .followupActions(List.of(
                new FollowupAction("back_to_study", "回到学习", "EXPLORE", 1)))
            .build()
    );
    
    /**
     * 匹配辅导策略
     */
    public TutoringStrategy match(
            IntentClassificationResult intentResult,
            StudentProfile profile) {
        
        // 1. 从数据库查询适用策略（按优先级排序）
        List<TutoringStrategyConfig> configs = strategyRepo
            .findApplicableStrategies(
                intentResult.getPrimaryIntent().name(),
                profile.getGradeLevel());
        
        if (!configs.isEmpty()) {
            TutoringStrategyConfig config = configs.get(0); // 取最高优先级
            return config.toStrategy();
        }
        
        // 2. 兜底：使用内存默认映射
        TutoringStrategy fallback = FALLBACK_MAP.get(intentResult.getPrimaryIntent());
        if (fallback == null) {
            fallback = FALLBACK_MAP.get(QuestionIntent.CONCEPT_SEEKING);
        }
        
        // 3. 根据子意图微调
        if (intentResult.getSubIntent() != null) {
            fallback = adjustForSubIntent(fallback, intentResult.getSubIntent());
        }
        
        // 4. 根据年级微调
        fallback = adjustForGrade(fallback, profile.getGradeLevel());
        
        return fallback;
    }
    
    /**
     * 子意图微调策略
     */
    private TutoringStrategy adjustForSubIntent(
            TutoringStrategy base, ProblemSolvingSubIntent subIntent) {
        return switch (subIntent) {
            case PS_HINT_ONLY -> base.toBuilder()
                .answerRevealLevel(TutoringStrategy.AnswerRevealLevel.HINT_ONLY)
                .scaffoldingLevel(TutoringStrategy.ScaffoldingLevel.HIGH)
                .useSocratic(true)
                .build();
            case PS_STUCK_POINT -> base.toBuilder()
                .responseStructure(TutoringStrategy.ResponseStructure.QA_FIRST)
                .scaffoldingLevel(TutoringStrategy.ScaffoldingLevel.MEDIUM)
                .build();
            case PS_ALTERNATIVE -> base.toBuilder()
                .useAnalogy(true)
                .scaffoldingLevel(TutoringStrategy.ScaffoldingLevel.HIGH)
                .build();
            default -> base;
        };
    }
    
    /**
     * 分龄微调：低年级增加脚手架，高年级增加自主性
     */
    private TutoringStrategy adjustForGrade(
            TutoringStrategy base, int gradeLevel) {
        if (gradeLevel <= 3) {
            // 小学低年级：高脚手架 + 类比
            return base.toBuilder()
                .scaffoldingLevel(TutoringStrategy.ScaffoldingLevel.HIGH)
                .useAnalogy(true)
                .maxResponseTokens(Math.min(base.getMaxResponseTokens(), 800))
                .build();
        } else if (gradeLevel >= 10) {
            // 高中：低脚手架 + 更多专业术语
            return base.toBuilder()
                .scaffoldingLevel(base.getScaffoldingLevel() == 
                    TutoringStrategy.ScaffoldingLevel.HIGH ? 
                    TutoringStrategy.ScaffoldingLevel.MEDIUM : 
                    base.getScaffoldingLevel())
                .maxResponseTokens(Math.max(base.getMaxResponseTokens(), 1500))
                .build();
        }
        return base;
    }
}
```

### 4.7 IntentDriftDetector — 意图漂移检测器

```java
/**
 * 意图漂移检测器：监控多轮对话中意图变化的合理性
 */
@Component
public class IntentDriftDetector {
    
    @Autowired
    private IntentDriftConfigRepository driftConfigRepo;
    
    // 允许的自然意图转移（学习场景中的正常话题跳转）
    private static final Set<Pair<QuestionIntent>> NATURAL_TRANSITIONS = Set.of(
        Pair.of(QuestionIntent.CONCEPT_SEEKING, QuestionIntent.PROBLEM_SOLVING),
        Pair.of(QuestionIntent.PROBLEM_SOLVING, QuestionIntent.ERROR_DIAGNOSIS),
        Pair.of(QuestionIntent.ERROR_DIAGNOSIS, QuestionIntent.METHOD_SEEKING),
        Pair.of(QuestionIntent.CONCEPT_SEEKING, QuestionIntent.KNOWLEDGE_CONNECTION),
        Pair.of(QuestionIntent.METHOD_SEEKING, QuestionIntent.PRACTICE_REQUEST),
        Pair.of(QuestionIntent.REVIEW_REINFORCE, QuestionIntent.PROBLEM_SOLVING),
        Pair.of(QuestionIntent.PROBLEM_SOLVING, QuestionIntent.PRACTICE_REQUEST),
        Pair.of(QuestionIntent.VERIFICATION, QuestionIntent.METHOD_SEEKING)
    );
    
    /**
     * 检测意图漂移
     */
    public IntentDriftResult check(
            QuestionIntent currentIntent,
            ConversationContext context) {
        
        QuestionIntent prevIntent = context.getPreviousIntent();
        if (prevIntent == null || prevIntent == currentIntent) {
            return IntentDriftResult.ok();
        }
        
        // 1. 检查是否为自然转移
        if (NATURAL_TRANSITIONS.contains(Pair.of(prevIntent, currentIntent))) {
            return IntentDriftResult.naturalTransition(prevIntent, currentIntent);
        }
        
        // 2. 检查是否漂移到 OFF_TOPIC
        if (currentIntent == QuestionIntent.OFF_TOPIC) {
            int consecutiveOffTopic = context.getConsecutiveOffTopicCount() + 1;
            if (consecutiveOffTopic >= 2) {
                return IntentDriftResult.builder()
                    .driftType(DriftType.FOCUS_LOSS)
                    .severity(Severity.WARNING)
                    .action(DriftAction.PULLBACK)
                    .pullbackMessage(buildPullbackMessage(prevIntent, context))
                    .consecutiveCount(consecutiveOffTopic)
                    .build();
            }
        }
        
        // 3. 查询漂移配置表
        IntentDriftConfig config = driftConfigRepo
            .findByTransition(prevIntent, currentIntent);
        if (config != null) {
            return IntentDriftResult.builder()
                .driftType(DriftType.valueOf(config.getDriftType()))
                .severity(Severity.valueOf(config.getSeverity()))
                .action(DriftAction.valueOf(config.getActionType()))
                .pullbackMessage(config.getPullbackMessage())
                .build();
        }
        
        // 4. 默认：允许但记录
        return IntentDriftResult.builder()
            .driftType(DriftType.NATURAL_TRANSITION)
            .severity(Severity.NORMAL)
            .action(DriftAction.ALLOW)
            .build();
    }
    
    private String buildPullbackMessage(
            QuestionIntent studyIntent, ConversationContext context) {
        return String.format(
            "我们刚才在聊%s相关的内容，要继续学习吗？也可以换个知识点来学习～",
            context.getTopicKeyword() != null ? 
                context.getTopicKeyword() : "学习");
    }
}
```

---

## 5. API 接口设计

### 5.1 意图分类接口（内部调用）

```
POST /api/internal/intent/classify
```

**请求体：**
```json
{
  "conversation_id": "conv_20260729_001",
  "message_id": "msg_0001",
  "user_id": 10086,
  "message": "这道二次函数的对称轴怎么求？",
  "attachments": [],
  "context": {
    "prev_intent": null,
    "prev_strategy": null,
    "turn_index": 1,
    "same_topic_turns": 0,
    "entry_point": "ai_dialogue",
    "has_recent_errors": false
  }
}
```

**响应体：**
```json
{
  "code": 0,
  "data": {
    "primary_intent": "PROBLEM_SOLVING",
    "sub_intent": "PS_FULL_SOLUTION",
    "confidence": 0.92,
    "method": "ENSEMBLE",
    "latency_ms": 45,
    "runner_up_intent": "CONCEPT_SEEKING",
    "runner_up_confidence": 0.21,
    "matched_strategy": {
      "strategy_code": "TS_SOLVE",
      "response_structure": "STEP_FIRST",
      "answer_reveal_level": "GRADUAL",
      "reveal_steps_max": 5,
      "scaffolding_level": "MEDIUM",
      "use_socratic": true,
      "use_analogy": false,
      "prompt_overrides": {
        "response_format_hint": "请先分析题目条件，再逐步推导",
        "knowledge_point_hint": "二次函数|对称轴"
      },
      "followup_actions": [
        {"action_code": "similar", "label": "练一道同类题", "priority": 1},
        {"action_code": "error_book", "label": "加入错题本", "priority": 2}
      ]
    },
    "drift_result": {
      "drift_type": null,
      "action": "ALLOW",
      "pullback_message": null
    }
  }
}
```

### 5.2 意图统计查询接口

```
GET /api/internal/intent/stats?user_id=10086&start_date=2026-07-01&end_date=2026-07-29
```

**响应体：**
```json
{
  "code": 0,
  "data": {
    "total_messages": 342,
    "intent_distribution": {
      "CONCEPT_SEEKING": 0.28,
      "PROBLEM_SOLVING": 0.35,
      "ERROR_DIAGNOSIS": 0.12,
      "VERIFICATION": 0.08,
      "METHOD_SEEKING": 0.05,
      "EXAM_PREP": 0.04,
      "REVIEW_REINFORCE": 0.03,
      "PRACTICE_REQUEST": 0.02,
      "KNOWLEDGE_CONNECTION": 0.02,
      "OFF_TOPIC": 0.01
    },
    "avg_confidence": 0.87,
    "rule_vs_model_ratio": {"rule": 0.62, "model": 0.18, "ensemble": 0.20}
  }
}
```

### 5.3 策略配置管理接口

```
PUT /api/admin/tutoring-strategies/{strategy_code}
```

**请求体：**
```json
{
  "answer_reveal_level": "GRADUAL",
  "reveal_steps_max": 4,
  "scaffolding_level": "HIGH",
  "use_socratic": true,
  "status": "ACTIVE"
}
```

---

## 6. 状态流转

### 6.1 单条消息处理状态机

```
                    ┌─────────┐
                    │ RECEIVED │
                    └────┬─────┘
                         │
                    ┌────▼─────┐
                    │  FEATURING│  特征构建
                    └────┬─────┘
                         │
               ┌─────────▼──────────┐
               │  RULE_CLASSIFYING   │  规则分类
               └─────────┬──────────┘
                         │
               ┌─────────▼──────────┐
       ┌───────│  CONFIDENCE ≥ 0.85?  │───────┐
       │       └──────────────────────┘       │
       │ Yes                                  │ No
       │                                      │
  ┌────▼─────┐                      ┌─────────▼──────────┐
  │ STRATEGY │                      │ MODEL_CLASSIFYING  │ 模型分类
  │ MATCHING │                      └─────────┬──────────┘
  └────┬─────┘                                │
       │                               ┌───────▼──────────┐
       │                               │ ENSEMBLE_FUSION  │ 融合决策
       │                               └───────┬──────────┘
       │                                       │
       └──────────┬────────────────────────────┘
                  │
           ┌──────▼──────┐
           │ DRIFT_CHECK  │  漂移检测
           └──────┬──────┘
                  │
           ┌──────▼──────┐
           │ LOGGING      │  日志记录
           └──────┬──────┘
                  │
           ┌──────▼──────┐
           │ COMPLETED    │  输出结果
           └─────────────┘
```

### 6.2 策略切换状态机

```
    ┌─────────────┐     新意图      ┌─────────────────┐
    │ STRATEGY_A  │──────────────▶│ STRATEGY_SWITCH  │
    │ (执行中)     │               │ (过渡)            │
    └─────────────┘               └────────┬────────┘
                                           │
                                   ┌───────▼────────┐
                                   │ STRATEGY_B     │
                                   │ (新策略执行中)  │
                                   └────────────────┘
```

---

## 7. 错误处理与降级策略

### 7.1 异常场景

| 异常场景 | 触发条件 | 处理策略 | 用户影响 |
|----------|---------|---------|---------|
| 模型加载失败 | FastText 模型文件缺失 | 仅使用规则分类器，置信度降级标记 | 无感知，分类准确率略降 |
| 模型推理超时 | >300ms | 中断模型调用，使用规则结果 | 无感知 |
| 数据库不可用 | 策略配置表查询失败 | 使用内存 FALLBACK_MAP | 无感知，使用默认策略 |
| 特征构建失败 | 上下文数据缺失 | 使用默认特征值，继续分类 | 无感知 |
| 全部失败 | 规则+模型均异常 | 返回默认意图 CONCEPT_SEEKING + 默认策略 | AI 仍可回答，但策略可能非最优 |

### 7.2 降级链路

```java
@Component
public class IntentClassificationFallback {
    
    /**
     * 降级处理
     */
    public IntentClassificationResult fallback(String reason) {
        return IntentClassificationResult.builder()
            .primaryIntent(QuestionIntent.CONCEPT_SEEKING)
            .confidence(0.30)
            .method(IntentClassificationResult.ClassifyMethod.RULE)
            .latencyMs(1)
            .matchedStrategy(TutoringStrategyMatcher.FALLBACK_MAP
                .get(QuestionIntent.CONCEPT_SEEKING))
            .driftResult(IntentDriftResult.ok())
            .build();
    }
}
```

---

## 8. 性能优化

### 8.1 缓存策略

| 缓存对象 | 存储介质 | TTL | 失效策略 |
|---------|---------|-----|---------|
| 策略配置 | Redis (Hash) | 30min | 后台更新时主动刷新 |
| 漂移配置 | Redis (Hash) | 30min | 同上 |
| FastText 模型 | JVM 内存 | 永久 | 文件变更时热加载 |
| 常见问题→意图映射 | Redis (String) | 24h | LRU淘汰 |

### 8.2 并发优化

- 规则分类器无状态，天然线程安全
- FastText 模型推理只读，支持并发
- 特征构建器无状态，可安全共享

### 8.3 短文本快速路径

```java
/**
 * 对于 ≤10 字符的短消息，先查热点缓存
 */
if (message.length() <= 10) {
    String cacheKey = "intent:short:" + message.hashCode();
    IntentClassificationResult cached = redis.get(cacheKey);
    if (cached != null) {
        return cached; // 缓存命中，跳过全流程
    }
}
```

---

## 9. 监控与告警

### 9.1 核心指标

| 指标 | 告警阈值 | 说明 |
|------|---------|------|
| `intent_classify_p99_latency_ms` | > 200ms | 分类P99延迟 |
| `intent_classify_error_rate` | > 1% | 分类异常率 |
| `model_classify_usage_ratio` | > 60% | 模型调用占比过高说明规则覆盖不足 |
| `low_confidence_ratio` (conf<0.5) | > 15% | 低置信度分类占比 |
| `off_topic_ratio` | > 10% | 非学习意图占比 |
| `strategy_fallback_rate` | > 5% | 使用兜底策略的比例 |

### 9.2 数据回流与模型迭代

```
分类日志 → 离线标注抽样 → 误分类分析 → 模型重训练 → 灰度发布
```

- 每周从 `ai_intent_log` 抽样 1000 条进行人工标注校验
- 计算各意图的 Precision/Recall/F1
- 低于 0.80 F1 的意图类型需补充训练数据
- 模型重训练后通过灰度发布验证效果

---

## 10. 安全与合规

| 关注点 | 措施 |
|--------|------|
| 意图日志脱敏 | `feature_snapshot` 中的原始消息文本仅保留 hash，不存储原文 |
| 学生画像最小化 | 只拉取分类所需的画像字段，不拉取完整画像 |
| 非学习意图不记录 | OFF_TOPIC 意图不写入学生长期画像 |
| 审计可追溯 | 策略配置变更全部记录审计日志 |

---

## 11. 测试策略

### 11.1 单元测试

| 测试对象 | 测试重点 |
|---------|---------|
| FeatureBuilder | 各特征维度提取正确性 |
| RuleClassifier | 每条规则的命中/未命中场景 |
| ModelClassifier | 模型加载、推理、校准正确性 |
| EnsembleDecisionEngine | 融合决策逻辑（规则优先/模型优先/一致性加成） |
| TutoringStrategyMatcher | 策略匹配、子意图微调、分龄微调 |
| IntentDriftDetector | 自然转移/焦点丢失/拉回触发 |

### 11.2 集成测试

```gherkin
Scenario: 学生从错题本进入并提问
  Given 学生从错题本入口打开AI对话
  And 学生输入"这道题为什么选B"
  When 意图分类引擎处理该消息
  Then 主意图应为 ERROR_DIAGNOSIS
  And 置信度应大于 0.85
  And 匹配策略应为 TS_DIAGNOSE
  And 脚手架级别应为 HIGH

Scenario: 多轮对话中的意图自然转移
  Given 第1轮意图为 CONCEPT_SEEKING
  When 第2轮学生输入"给我出一道练习题"
  Then 意图应为 PRACTICE_REQUEST
  And 漂移检测结果应为 NATURAL_TRANSITION
  And 不触发拉回

Scenario: 连续非学习意图触发拉回
  Given 第1轮意图为 OFF_TOPIC
  When 第2轮仍为 OFF_TOPIC
  Then 漂移检测结果应为 FOCUS_LOSS
  And 动作应为 PULLBACK
  And 应生成拉回消息
```

---

## 12. 部署与配置

### 12.1 配置项

```yaml
intent:
  classify:
    # 规则强信号直接采用阈值
    rule_strong_threshold: 0.85
    # 触发模型分类的规则置信度下限
    model_trigger_threshold: 0.75
    # 融合时一致性加成
    agreement_bonus: 0.12
    # 模型调用超时
    model_timeout_ms: 300
    # 短文本快速路径长度阈值
    short_text_threshold: 10
  drift:
    # OFF_TOPIC 连续触发拉回的轮数
    off_topic_pullback_turns: 2
  cache:
    # 短文本意图缓存条数上限
    short_text_cache_max: 100000
```

### 12.2 模型文件管理

```
/opt/primetop/models/intent/
├── fasttext_intent_v1.bin      # 当前版本
├── fasttext_intent_v1.meta     # 元数据（训练数据范围、F1分数等）
└── fasttext_intent_v2.bin      # 灰度版本（如有）
```

---

## 13. 版本规划

| 版本 | 功能范围 | 核心交付 |
|------|---------|---------|
| V1.0 (MVP+) | 规则分类器 + 默认策略映射 + 基础漂移检测 | 覆盖 80% 场景的快速分类 |
| V1.5 | FastText 模型 + 融合决策 + 子意图细分 | 准确率提升到 85%+ |
| V2.0 | 模型重训练管线 + 策略 A/B 测试 + 分龄策略优化 | 数据驱动持续提升 |
| V3.0 | 基于 LLM 的 zero-shot 意图分类（替代 FastText） | 更细粒度意图识别 |

---

## 14. 附录

### 14.1 意图类型枚举

```java
public enum QuestionIntent {
    CONCEPT_SEEKING,      // 概念理解
    PROBLEM_SOLVING,      // 解题求助
    ERROR_DIAGNOSIS,      // 纠错诊断
    VERIFICATION,         // 答案验证
    METHOD_SEEKING,       // 方法寻求
    EXAM_PREP,            // 应试准备
    REVIEW_REINFORCE,     // 复习巩固
    ADVANCED_LEARNING,    // 超前学习
    PRACTICE_REQUEST,     // 练习请求
    KNOWLEDGE_CONNECTION, // 知识关联
    OFF_TOPIC             // 非学习意图
}

public enum ProblemSolvingSubIntent {
    PS_FULL_SOLUTION,   // 完整解题
    PS_HINT_ONLY,       // 仅需提示
    PS_STUCK_POINT,     // 卡点求助
    PS_ALTERNATIVE      // 换种讲法
}
```

### 14.2 Prompt 注入示例

当意图为 `PROBLEM_SOLVING` + 子意图 `PS_HINT_ONLY` 时，向 Prompt 编排系统注入的参数：

```json
{
  "system_prompt_suffix": "\n\n**重要**：本次提问学生只需要思路提示，不要给出完整答案。请使用苏格拉底式引导，通过提问帮助学生自己发现解题方向。",
  "response_format": "hint_first",
  "max_steps": 2,
  "tone": "encouraging",
  "knowledge_anchors": ["二次函数", "对称轴", "顶点坐标公式"]
}
```

当意图为 `EXAM_PREP` 时：

```json
{
  "system_prompt_suffix": "\n\n**重要**：学生正在备考，请围绕考试要点组织回答。标注该知识点在考试中的出现频率和常见题型。",
  "response_format": "summary_first",
  "include_exam_tips": true,
  "include_common_mistakes": true
}
```