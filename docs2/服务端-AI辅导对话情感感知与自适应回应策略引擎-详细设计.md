# 服务端 - AI 辅导对话情感感知与自适应回应策略引擎 详细设计

## 1. 概述

### 1.1 文档目的

本文档详细设计 AI 辅导对话中的**情感感知与自适应回应策略引擎**，负责在学生与 AI 进行学习对话时，实时分析学生的情绪状态（困惑、沮丧、无聊、兴奋、专注等），并动态调整 AI 的回应策略（语气、难度推进节奏、鼓励频率、解释方式等），以提升学习体验和教学效果。

### 1.2 背景

原始设计文档指出，AI 辅导应"优先引导学生理解思路"并"根据学生年级调整讲解深度"，但缺少对**学生情感状态**的实时感知和自适应处理。在实际学习场景中：

- 学生遇到困难时若持续得不到有效引导，容易产生挫败感而放弃
- 低龄学生需要更多的鼓励和趣味性，否则容易失去兴趣
- 学生表现出兴奋和投入时，可以适当增加挑战
- 持续的负面情绪需要触发家长提醒

### 1.3 设计目标

| 目标 | 说明 |
|------|------|
| 实时情感识别 | 在每次对话轮次中对学生的文字/语音输入进行情感分析，延迟 < 200ms |
| 多维度情感建模 | 覆盖 7 种核心学习情感状态 + 强度等级 |
| 自适应回应策略 | 基于情感状态自动调整 AI 回应的语气、节奏、鼓励方式和教学策略 |
| 情感趋势追踪 | 维护对话级别的情感变化轨迹，检测异常模式 |
| 家长预警联动 | 检测到持续负面情绪时触发家长通知 |
| 低成本实现 | 复用现有 AI 模型调用链路，不额外引入独立的情感分析模型 |

### 1.4 与其他模块的关系

| 关联模块 | 交互方式 |
|----------|----------|
| AI 对话引擎 | 注入情感上下文到 Prompt 模板，调整生成策略 |
| Prompt 编排系统 | 选择情感适配的 Prompt 模板变体 |
| 语音服务 (ASR/TTS) | 接收语音情感特征，调整 TTS 语速和语气 |
| 家长中心 | 触发情感预警通知 |
| 学习动力量化引擎 | 提供情感维度数据用于倦怠检测 |
| 用户学习画像 | 更新学生的情感偏好和学习风格标签 |
| 埋点系统 | 输出情感分析事件用于数据分析和模型优化 |

---

## 2. 核心概念定义

### 2.1 学习情感状态枚举

```typescript
/**
 * 学习场景中的核心情感状态
 */
enum LearningEmotion {
  /** 困惑 - 不理解当前内容，表达出疑问 */
  CONFUSED = 'CONFUSED',
  /** 沮丧 - 反复出错或无法理解，产生挫败感 */
  FRUSTRATED = 'FRUSTRATED',
  /** 无聊 - 对当前内容缺乏兴趣 */
  BORED = 'BORED',
  /** 专注 - 认真投入学习中 */
  ENGAGED = 'ENGAGED',
  /** 兴奋 - 产生兴趣，表现积极 */
  EXCITED = 'EXCITED',
  /** 焦虑 - 担心学不好、考试压力等 */
  ANXIOUS = 'ANXIOUS',
  /** 中性 - 无明显情感倾向 */
  NEUTRAL = 'NEUTRAL',
}

/**
 * 情感强度等级 (1-5)
 */
enum EmotionIntensity {
  VERY_LOW = 1,   // 微弱暗示
  LOW = 2,        // 轻度表达
  MODERATE = 3,   // 明确表达
  HIGH = 4,       // 强烈表达
  VERY_HIGH = 5,  // 极度强烈
}
```

### 2.2 情感上下文数据结构

```typescript
/**
 * 单轮对话的情感分析结果
 */
interface EmotionAnalysisResult {
  /** 唯一标识 */
  id: string;
  /** 关联的对话消息 ID */
  messageId: string;
  /** 关联的会话 ID */
  sessionId: string;
  /** 用户 ID */
  userId: string;

  /** 主要情感状态 */
  primaryEmotion: LearningEmotion;
  /** 主要情感强度 */
  primaryIntensity: EmotionIntensity;

  /** 次要情感状态（可选） */
  secondaryEmotion: LearningEmotion | null;
  /** 次要情感强度 */
  secondaryIntensity: EmotionIntensity | null;

  /** 情感置信度 0.0-1.0 */
  confidence: number;

  /** 触发关键词/短语 */
  triggerPhrases: string[];

  /** 分析来源 */
  source: 'TEXT' | 'VOICE' | 'COMBINED';

  /** 分析时间戳 */
  analyzedAt: string; // ISO 8601
}

/**
 * 对话级别的情感上下文（随对话进行动态更新）
 */
interface ConversationEmotionContext {
  /** 会话 ID */
  sessionId: string;
  /** 用户 ID */
  userId: string;

  /** 当前情感状态 */
  currentEmotion: LearningEmotion;
  /** 当前情感强度 */
  currentIntensity: EmotionIntensity;

  /** 情感变化轨迹（最近 N 轮） */
  emotionTimeline: EmotionTimelineEntry[];

  /** 对话内情绪指标 */
  metrics: ConversationEmotionMetrics;

  /** 自适应策略参数 */
  strategyParams: AdaptiveStrategyParams;

  /** 是否需要触发预警 */
  alertTriggered: boolean;
  /** 预警类型 */
  alertType: EmotionAlertType | null;

  /** 最后更新时间 */
  updatedAt: string;
}

interface EmotionTimelineEntry {
  /** 轮次序号 */
  turnIndex: number;
  /** 情感状态 */
  emotion: LearningEmotion;
  /** 强度 */
  intensity: EmotionIntensity;
  /** 时间戳 */
  timestamp: string;
}

interface ConversationEmotionMetrics {
  /** 对话总轮次 */
  totalTurns: number;
  /** 连续困惑/沮丧轮次 */
  consecutiveNegativeTurns: number;
  /** 负面情绪占比 */
  negativeRatio: number;
  /** 情绪波动次数（状态切换次数） */
  fluctuationCount: number;
  /** 平均置信度 */
  avgConfidence: number;
  /** 正向情绪峰值强度 */
  positivePeakIntensity: number;
  /** 负向情绪峰值强度 */
  negativePeakIntensity: number;
}

/**
 * 自适应策略参数 - 传递给 Prompt 编排系统
 */
interface AdaptiveStrategyParams {
  /** 鼓励频率：每 N 轮至少包含一次鼓励 */
  encouragementFrequency: number;
  /** 是否切换为更简单的解释方式 */
  useSimplifiedExplanation: boolean;
  /** 是否增加步骤拆分 */
  increaseStepBreakdown: boolean;
  /** 是否需要主动提供帮助提示 */
  proactiveHintsEnabled: boolean;
  /** 回应语气风格 */
  toneStyle: 'ENCOURAGING' | 'NEUTRAL' | 'CHALLENGING' | 'PLAYFUL' | 'CALM';
  /** 是否降低当前问题难度 */
  reduceDifficulty: boolean;
  /** 是否建议休息 */
  suggestBreak: boolean;
  /** 额外 Prompt 指令片段 */
  promptInstructionOverride: string | null;
}
```

### 2.3 预警类型

```typescript
enum EmotionAlertType {
  /** 持续沮丧 - 连续多轮处于沮丧状态 */
  PERSISTENT_FRUSTRATION = 'PERSISTENT_FRUSTRATION',
  /** 学习焦虑 - 检测到高强度焦虑情绪 */
  STUDY_ANXIETY = 'STUDY_ANXIETY',
  /** 可能放弃 - 多种负面指标叠加 */
  LIKELY_ABANDON = 'LIKELY_ABANDON',
  /** 情绪异常波动 - 短时间内频繁切换状态 */
  EMOTIONAL_INSTABILITY = 'EMOTIONAL_INSTABILITY',
}
```

---

## 3. 系统架构

### 3.1 整体流程

```
学生输入 (文字/语音)
    │
    ▼
┌─────────────────────────┐
│  文本预处理与关键词提取   │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  情感分析引擎            │  ← 复用大模型（低成本方式）
│  - 文本情感推断          │
│  - 语音情感特征（可选）   │
│  - 上下文关联分析        │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  情感上下文管理器        │
│  - 更新情感时间线        │
│  - 计算情感指标          │
│  - 检测预警条件          │
└───────────┬─────────────┘
            │
    ┌───────┴───────┐
    ▼               ▼
┌─────────┐  ┌──────────────┐
│ 策略决策 │  │  预警触发器   │
│ 引擎    │  │ (异步通知)   │
└────┬────┘  └──────────────┘
     │
     ▼
┌─────────────────────────┐
│  Prompt 上下文注入       │  → 传递给 AI 对话引擎
│  - 语气指令             │
│  - 鼓励指令             │
│  - 难度调整指令         │
└─────────────────────────┘
```

### 3.2 模块划分

| 模块 | 职责 |
|------|------|
| EmotionAnalyzer | 对单条输入进行情感分析 |
| EmotionContextManager | 维护对话级别的情感上下文和趋势 |
| StrategyDecisionEngine | 基于情感上下文决定自适应策略参数 |
| AlertEvaluator | 评估是否需要触发情感预警 |
| PromptContextInjector | 将策略参数转化为 Prompt 注入指令 |
| EmotionEventPublisher | 发布情感分析事件到事件总线 |

### 3.3 服务位置

情感感知引擎作为 AI 对话服务的内部组件实现，不独立部署为微服务。理由：

1. 情感分析与对话生成是紧耦合的流水线环节
2. 减少网络调用开销，保证低延迟
3. 情感上下文是会话级数据，适合与对话上下文共存在同一进程中

---

## 4. 详细设计

### 4.1 EmotionAnalyzer - 情感分析器

#### 4.1.1 分析策略

采用**轻量级规则 + 大模型辅助**的混合方案：

**第一阶段（规则匹配，< 10ms）：**

```java
public class RuleBasedEmotionDetector {

    // 情感关键词库（按学段维护不同版本）
    private final Map<LearningEmotion, EmotionKeywordSet> keywordSets;

    /**
     * 基于规则的快速情感初判
     * @return 情感检测结果，可能为 null（规则未匹配时）
     */
    public EmotionDetectionResult detect(String input, StudentGrade grade) {
        EmotionKeywordSet keywords = keywordSets.get(grade.getPhase());

        // 1. 检查显式情感表达
        for (EmotionPattern pattern : keywords.getPatterns()) {
            if (pattern.matches(input)) {
                return new EmotionDetectionResult(
                    pattern.getEmotion(),
                    pattern.estimateIntensity(input),
                    0.7, // 规则匹配置信度
                    pattern.getMatchedPhrases()
                );
            }
        }

        // 2. 检查隐式情感信号（重复提问、短回答、语气词等）
        ImplicitSignal signal = detectImplicitSignals(input);
        if (signal != null) {
            return new EmotionDetectionResult(
                signal.getEmotion(),
                signal.getIntensity(),
                0.5, // 隐式信号置信度较低
                signal.getPhrases()
            );
        }

        return null; // 规则未匹配，交给模型分析
    }
}
```

**关键词库示例（小学阶段）：**

```json
{
  "FRUSTRATED": {
    "exact": ["我不会", "太难了", "不想做了", "做不来", "算了吧"],
    "pattern": ["还是.{0,4}不懂", "怎么.{0,4}不对", "又.{0,4}错了", "第.{1,3}次.{0,4}错"],
    "implicit": ["...", "？？" ,"？？？？", "唉", "啊", "呃"]
  },
  "CONFUSED": {
    "exact": ["不太明白", "没看懂", "什么意思", "不懂", "为什么", "怎么回事"],
    "pattern": ["为什么.{0,10}是", "怎么.{0,4}理解", "能再.{0,4}讲"],
    "implicit": ["嗯？", "啊？"]
  },
  "BORED": {
    "exact": ["好无聊", "没意思", "太简单了", "都会了", "能不能跳过"],
    "pattern": ["还有.{0,4}吗", "什么时候.{0,4}完"]
  },
  "EXCITED": {
    "exact": ["太好了", "我懂了", "明白了", "原来如此", "厉害", "好棒"],
    "pattern": ["终于.{0,4}会了", "我想.{0,4}更多", "还有.{0,4}题吗"]
  },
  "ANXIOUS": {
    "exact": ["考试怎么办", "来不及了", "肯定考不好", "跟不上", "别人都"],
    "pattern": ["如果.{0,4}考不好", "还有.{0,4}天"]
  }
}
```

**第二阶段（大模型辅助，按需调用）：**

当规则匹配失败或置信度过低时，将情感分析任务附加到主对话请求中，不额外发起一次模型调用：

```java
/**
 * 将情感分析指令附加到对话 Prompt 中
 * 这样做的好处：不增加额外的模型调用成本
 */
public class EmotionAwarePromptBuilder {

    private static final String EMOTION_ANALYSIS_INSTRUCTION = """
        [系统内部指令 - 不要在回答中体现]
        分析学生最后一条消息的情感状态，仅返回 JSON：
        {"emotion":"CONFUSED|FRUSTRATED|BORED|ENGAGED|EXCITED|ANXIOUS|NEUTRAL","intensity":1-5,"confidence":0.0-1.0,"triggers":["关键词"]}
        如果无法判断，返回 {"emotion":"NEUTRAL","intensity":1,"confidence":0.3,"triggers":[]}
        [/系统内部指令]
        """;

    /**
     * 将情感分析指令附加到用户 Prompt 中
     */
    public String buildEmotionAwarePrompt(String originalPrompt,
                                          ConversationEmotionContext context) {
        StringBuilder sb = new StringBuilder();

        // 注入情感上下文摘要
        if (context != null && context.getEmotionTimeline().size() > 0) {
            sb.append("[学生当前情感状态：")
              .append(context.getCurrentEmotion())
              .append("，强度：").append(context.getCurrentIntensity())
              .append("，连续困惑/沮丧轮次：")
              .append(context.getMetrics().getConsecutiveNegativeTurns())
              .append("]\n\n");
        }

        // 附加情感分析指令
        sb.append(EMOTION_ANALYSIS_INSTRUCTION).append("\n\n");

        sb.append(originalPrompt);
        return sb.toString();
    }
}
```

#### 4.1.2 情感结果解析

```java
public class EmotionResultParser {

    private static final Pattern JSON_PATTERN = Pattern.compile(
        "\\{\\s*\"emotion\"\\s*:\\s*\"(\\w+)\"\\s*,\\s*" +
        "\"intensity\"\\s*:\\s*(\\d)\\s*,\\s*" +
        "\"confidence\"\\s*:\\s*([\\d.]+)\\s*,\\s*" +
        "\"triggers\"\\s*:\\s*\\[([^\\]]*)\\]\\s*\\}"
    );

    /**
     * 从 AI 回复中提取情感分析结果
     * AI 回复格式：<情感JSON>\n---\n实际回答内容
     */
    public EmotionAnalysisResult parse(String aiResponse,
                                       String messageId,
                                       String sessionId,
                                       String userId) {
        // 尝试提取 JSON 块
        String[] parts = aiResponse.split("\\n---\\n", 2);

        if (parts.length == 2) {
            try {
                Matcher matcher = JSON_PATTERN.matcher(parts[0].trim());
                if (matcher.find()) {
                    return EmotionAnalysisResult.builder()
                        .id(UUID.randomUUID().toString())
                        .messageId(messageId)
                        .sessionId(sessionId)
                        .userId(userId)
                        .primaryEmotion(LearningEmotion.valueOf(matcher.group(1)))
                        .primaryIntensity(EmotionIntensity.values()[Integer.parseInt(matcher.group(2)) - 1])
                        .confidence(Double.parseDouble(matcher.group(3)))
                        .triggerPhrases(parseTriggers(matcher.group(4)))
                        .source(EmotionSource.COMBINED)
                        .analyzedAt(Instant.now().toString())
                        .build();
                }
            } catch (Exception e) {
                log.warn("情感分析结果解析失败, sessionId={}: {}", sessionId, e.getMessage());
            }
        }

        // 解析失败时返回中性结果
        return EmotionAnalysisResult.neutral(messageId, sessionId, userId);
    }
}
```

### 4.2 EmotionContextManager - 情感上下文管理器

#### 4.2.1 存储设计

**Redis 存储结构（会话级，对话结束后归档到 DB）：**

```
Key: emotion:ctx:{sessionId}
Type: Hash
TTL: 2h（与对话会话 TTL 同步）

Fields:
  currentEmotion    -> "FRUSTRATED"
  currentIntensity  -> "4"
  totalTurns        -> "12"
  consecutiveNeg    -> "3"
  negativeRatio     -> "0.42"
  fluctuationCount  -> "2"
  avgConfidence     -> "0.78"
  positivePeak      -> "4"
  negativePeak      -> "5"
  alertTriggered    -> "false"
  alertType         -> null
  updatedAt         -> "2026-06-06T06:00:00Z"
```

```
Key: emotion:timeline:{sessionId}
Type: List (最多保留最近 30 轮)
Value: JSON 序列化的 EmotionTimelineEntry
TTL: 2h
```

#### 4.2.2 上下文更新逻辑

```java
@Service
public class EmotionContextManager {

    private final RedisTemplate<String, String> redisTemplate;
    private final EmotionEventPublisher eventPublisher;

    private static final int MAX_TIMELINE_SIZE = 30;

    /**
     * 更新情感上下文
     */
    public ConversationEmotionContext updateContext(String sessionId,
                                                    String userId,
                                                    EmotionAnalysisResult analysis) {
        // 1. 获取当前上下文
        ConversationEmotionContext ctx = loadContext(sessionId);
        if (ctx == null) {
            ctx = createInitialContext(sessionId, userId);
        }

        // 2. 添加时间线条目
        EmotionTimelineEntry entry = new EmotionTimelineEntry(
            ctx.getMetrics().getTotalTurns() + 1,
            analysis.getPrimaryEmotion(),
            analysis.getPrimaryIntensity(),
            Instant.now().toString()
        );
        ctx.getEmotionTimeline().add(entry);

        // 保持时间线不超过最大长度
        if (ctx.getEmotionTimeline().size() > MAX_TIMELINE_SIZE) {
            ctx.getEmotionTimeline().remove(0);
        }

        // 3. 更新当前状态
        ctx.setCurrentEmotion(analysis.getPrimaryEmotion());
        ctx.setCurrentIntensity(analysis.getPrimaryIntensity());

        // 4. 重新计算指标
        recalculateMetrics(ctx);

        // 5. 持久化
        saveContext(ctx);

        // 6. 发布事件
        eventPublisher.publishEmotionEvent(analysis, ctx);

        return ctx;
    }

    /**
     * 重新计算情感指标
     */
    private void recalculateMetrics(ConversationEmotionContext ctx) {
        List<EmotionTimelineEntry> timeline = ctx.getEmotionTimeline();
        ConversationEmotionMetrics metrics = ctx.getMetrics();

        // 总轮次
        metrics.setTotalTurns(metrics.getTotalTurns() + 1);

        // 连续负面轮次
        if (isNegativeEmotion(ctx.getCurrentEmotion())) {
            metrics.setConsecutiveNegativeTurns(
                metrics.getConsecutiveNegativeTurns() + 1
            );
        } else {
            metrics.setConsecutiveNegativeTurns(0);
        }

        // 负面情绪占比
        long negativeCount = timeline.stream()
            .filter(e -> isNegativeEmotion(e.getEmotion()))
            .count();
        metrics.setNegativeRatio((double) negativeCount / timeline.size());

        // 情绪波动次数
        int fluctuations = 0;
        for (int i = 1; i < timeline.size(); i++) {
            if (timeline.get(i).getEmotion() != timeline.get(i - 1).getEmotion()) {
                fluctuations++;
            }
        }
        metrics.setFluctuationCount(fluctuations);

        // 峰值更新
        if (isPositiveEmotion(ctx.getCurrentEmotion())) {
            metrics.setPositivePeakIntensity(
                Math.max(metrics.getPositivePeakIntensity(),
                         ctx.getCurrentIntensity().getValue())
            );
        }
        if (isNegativeEmotion(ctx.getCurrentEmotion())) {
            metrics.setNegativePeakIntensity(
                Math.max(metrics.getNegativePeakIntensity(),
                         ctx.getCurrentIntensity().getValue())
            );
        }
    }

    private boolean isNegativeEmotion(LearningEmotion e) {
        return e == LearningEmotion.FRUSTRATED
            || e == LearningEmotion.CONFUSED
            || e == LearningEmotion.ANXIOUS;
    }

    private boolean isPositiveEmotion(LearningEmotion e) {
        return e == LearningEmotion.EXCITED
            || e == LearningEmotion.ENGAGED;
    }
}
```

### 4.3 StrategyDecisionEngine - 策略决策引擎

#### 4.3.1 策略决策表

基于情感状态和强度的策略映射：

```java
@Service
public class StrategyDecisionEngine {

    /**
     * 基于情感上下文决定自适应策略参数
     */
    public AdaptiveStrategyParams decide(ConversationEmotionContext ctx,
                                         StudentProfile student) {
        AdaptiveStrategyParams params = new AdaptiveStrategyParams();

        LearningEmotion emotion = ctx.getCurrentEmotion();
        int intensity = ctx.getCurrentIntensity().getValue();
        int consecutiveNeg = ctx.getMetrics().getConsecutiveNegativeTurns();

        // 基础策略（按情感状态分派）
        switch (emotion) {
            case CONFUSED -> applyConfusedStrategy(params, intensity, consecutiveNeg, student);
            case FRUSTRATED -> applyFrustratedStrategy(params, intensity, consecutiveNeg, student);
            case BORED -> applyBoredStrategy(params, intensity, student);
            case ENGAGED -> applyEngagedStrategy(params, intensity, student);
            case EXCITED -> applyExcitedStrategy(params, intensity, student);
            case ANXIOUS -> applyAnxiousStrategy(params, intensity, student);
            default -> applyNeutralStrategy(params, student);
        }

        // 叠加连续负面轮次的额外调整
        if (consecutiveNeg >= 3) {
            params.setSuggestBreak(true);
            params.setEncouragementFrequency(1); // 每轮都鼓励
            params.setPromptInstructionOverride(
                "学生已经连续多轮遇到困难，请先用简短温暖的话语安抚，" +
                "然后用最简单的方式重新解释，必要时换一个完全不同的角度或生活例子。"
            );
        }

        if (consecutiveNeg >= 5) {
            params.setReduceDifficulty(true);
            params.setPromptInstructionOverride(
                "学生遇到很大困难，请暂时降低难度，给出一个简单的引导性问题，" +
                "让学生能成功回答以重建信心。不要继续推进新内容。"
            );
        }

        return params;
    }

    private void applyConfusedStrategy(AdaptiveStrategyParams params,
                                        int intensity,
                                        int consecutiveNeg,
                                        StudentProfile student) {
        params.setToneStyle(ToneStyle.CALM);
        params.setIncreaseStepBreakdown(true);
        params.setProactiveHintsEnabled(true);

        if (intensity >= 3) {
            params.setUseSimplifiedExplanation(true);
            params.setEncouragementFrequency(2); // 每 2 轮鼓励一次
            params.setPromptInstructionOverride(
                "学生表示不太明白。请用更简单