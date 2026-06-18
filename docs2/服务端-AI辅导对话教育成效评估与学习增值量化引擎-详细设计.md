# AI辅导对话教育成效评估与学习增值量化引擎 - 详细设计

> **文档版本**: 1.0
> **创建日期**: 2026-06-18
> **所属模块**: AI智能辅导 / 学情分析
> **优先级**: P1
> **依赖模块**: AI对话引擎、知识点追踪引擎、学习行为分析引擎、学情分析服务

---

## 1. 模块概述

### 1.1 设计目标

构建一套面向AI辅导对话场景的**教育成效量化评估体系**，回答以下核心问题：

1. **学习是否发生**：学生在这次AI对话交互后，是否真正获取了知识或提升了理解？
2. **学习增值几何**：对话前后，学生对相关知识点的掌握度变化了多少？
3. **对话模式诊断**：学生的学习行为模式是"深度学习型"还是"答案索取型"？
4. **教学策略归因**：AI的哪种讲解策略（分步引导、类比举例、追问启发等）在该学段/学科上效果最好？
5. **群体成效对比**：不同年级、不同能力水平的学生从AI辅导中获得的增益有何差异？

### 1.2 与现有模块的边界

| 已有模块 | 关注维度 | 本模块的差异 |
|---------|---------|-------------|
| AI对话质量抽样审核 | 人工审核AI回答的准确性、表达质量 | **不关注AI回答本身的质量**，关注学生端是否产生了学习效果 |
| AI幻觉检测与教育事实校验 | AI回答的事实正确性 | 事实正确≠学习发生；本模块评估的是学生侧的认知变化 |
| AI回答质量监控与用户纠错反馈 | 用户满意度评分、纠错反馈 | 满意度≠学习成效；本模块用行为信号量化实际学习增益 |
| 练习答题行为数据采集 | 答题行为本身（用时、正确率） | 本模块将答题行为变化**归因到**具体的AI辅导对话 |
| 知识追踪模型引擎 | 学生知识掌握度的持续追踪 | 本模块是KT模型在"AI对话干预"维度的**增量归因分析** |
| 学习状态实时感知 | 学习会话整体质量评估 | 本模块聚焦AI对话这一特定干预手段的效果 |

### 1.3 核心价值

- **产品侧**：为AI Prompt策略优化提供数据驱动反馈闭环
- **教研侧**：识别高效讲解模式和低效讲解模式，指导Prompt模板迭代
- **运营侧**：量化AI辅导的学习价值，为会员转化提供"学习成效"证据
- **风控侧**：识别"抄答案型"滥用行为，触发答案管控策略升级

---

## 2. 核心概念定义

### 2.1 教育成效（Educational Effectiveness）

指学生在参与AI辅导对话后，在相关知识点上产生的可观测的认知水平提升。衡量维度包括：

| 维度 | 缩写 | 说明 | 数据来源 |
|------|------|------|---------|
| 知识掌握度增量 | **ΔMastery** | 对话前后相关知识点掌握度变化值 | 知识追踪引擎 |
| 后续答题正确率变化 | **ΔAccuracy** | 对话后同类题正确率 vs 对话前同类题正确率 | 答题记录 |
| 知识迁移表现 | **Transfer** | 对话后在相关（非相同）知识点上的表现变化 | 答题记录+知识图谱 |
| 独立解题能力 | **Independence** | 后续遇到同类题时是否还需要AI辅助 | AI对话日志+答题日志 |
| 认知参与度 | **CogEngage** | 对话过程中的认知投入水平（追问深度、思考时长等） | 对话行为分析 |

### 2.2 对话学习模式分类

| 模式 | 代号 | 特征描述 | 教育价值 |
|------|------|---------|---------|
| 深度学习型 | DEEP | 多轮追问、主动求变讲法、请求同类题练习 | ⭐⭐⭐⭐⭐ |
| 理解验证型 | VERIFY | 提问后请求"换一种讲法"或"再解释一遍"，然后结束 | ⭐⭐⭐ |
| 快速答疑型 | QUICK | 单轮问答，获取解答后离开 | ⭐⭐ |
| 答案索取型 | ANSWER | 直接要求答案、忽略解题步骤、高频连续提交相似题目 | ⭐ |
| 偏离学习型 | OFFTOPIC | 对话内容偏离学习主题 | ❌ |

---

## 3. 系统架构

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                     触发源（Event Sources）                       │
├─────────────┬──────────────┬──────────────┬────────────────────┤
│  AI对话结束  │  对话后答题   │  错题复习完成  │  定时批处理(T+1)   │
│  事件        │  事件         │  事件         │  每日成效计算      │
└──────┬──────┴───────┬──────┴───────┬──────┴─────────┬──────────┘
       │              │              │                │
       ▼              ▼              ▼                ▼
┌─────────────────────────────────────────────────────────────────┐
│              成效评估事件接入层 (Event Ingestion)                 │
│         Kafka Topic: edu-effect-events                          │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   成效评估引擎 (Core Engine)                      │
│  ┌──────────┐ ┌────────────┐ ┌──────────┐ ┌─────────────────┐   │
│  │ 对话模式  │ │ 增量计算    │ │ 策略归因  │ │ 成效综合评级    │   │
│  │ 分类器   │ │ 引擎       │ │ 引擎     │ │ 引擎           │   │
│  └──────────┘ └────────────┘ └──────────┘ └─────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              规则配置中心 (Rule Config)                   │   │
│  └──────────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
┌────────────────┐ ┌───────────────┐ ┌─────────────────┐
│ 成效数据仓库   │ │ 实时告警通道   │ │ Prompt优化反馈  │
│ (ClickHouse)   │ │ (异常模式告警) │ │ (Prompt编排系统) │
└────────────────┘ └───────────────┘ └─────────────────┘
```

### 3.2 服务定位

本引擎作为**异步分析服务**运行，不阻塞用户交互流程。对话结束时进行轻量级实时初评，在T+1批处理中进行深度成效计算。

---

## 4. 数据模型

### 4.1 对话成效评估主表 `ai_dialogue_effect`

```sql
CREATE TABLE ai_dialogue_effect (
    id              BIGSERIAL PRIMARY KEY,
    dialogue_id     VARCHAR(64) NOT NULL,      -- AI对话会话ID
    user_id         BIGINT NOT NULL,            -- 学生用户ID
    subject_code    VARCHAR(20) NOT NULL,       -- 学科编码
    knowledge_codes TEXT[] NOT NULL,            -- 涉及知识点编码列表
    grade_level     SMALLINT NOT NULL,          -- 学生年级
    -- 对话模式分类
    dialogue_pattern    VARCHAR(20) NOT NULL,   -- DEEP/VERIFY/QUICK/ANSWER/OFFTOPIC
    pattern_confidence  DECIMAL(5,4),           -- 分类置信度 0~1
    -- 认知参与度
    cog_engage_score    DECIMAL(5,2),           -- 认知参与度评分 0~100
    turn_count          SMALLINT NOT NULL,      -- 对话轮次
    total_duration_ms   INTEGER NOT NULL,       -- 对话总时长(毫秒)
    avg_think_time_ms   INTEGER,                -- 平均每轮思考时长(发送间隔)
    followup_depth      SMALLINT,               -- 追问深度（最大嵌套层级）
    -- 教育成效指标
    delta_mastery       DECIMAL(6,4),           -- 知识掌握度增量 -1~1
    delta_accuracy      DECIMAL(6,4),           -- 后续答题正确率变化 -1~1
    transfer_score      DECIMAL(6,4),           -- 知识迁移表现 -1~1
    independence_score  DECIMAL(6,4),           -- 独立解题能力 -1~1
    overall_effect      VARCHAR(20) NOT NULL,   -- HIGH/MEDIUM/LOW/NONE/NEGATIVE
    -- AI教学策略标记
    ai_strategies       TEXT[],                 -- AI使用的策略标签
    best_strategy       VARCHAR(50),            -- 归因最优策略
    -- 元数据
    evaluated_at        TIMESTAMPTZ NOT NULL,   -- 评估时间
    eval_method         VARCHAR(20) NOT NULL,   -- REALTIME/BATCH/REINFORCE
    confidence_level    DECIMAL(5,4),           -- 评估整体置信度
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE (dialogue_id)
);

CREATE INDEX idx_effect_user ON ai_dialogue_effect (user_id, evaluated_at DESC);
CREATE INDEX idx_effect_subject ON ai_dialogue_effect (subject_code, dialogue_pattern);
CREATE INDEX idx_effect_knowledge ON ai_dialogue_effect USING GIN (knowledge_codes);
CREATE INDEX idx_effect_overall ON ai_dialogue_effect (overall_effect, evaluated_at DESC);
```

### 4.2 对话行为特征表 `dialogue_behavior_feature`

```sql
CREATE TABLE dialogue_behavior_feature (
    id                  BIGSERIAL PRIMARY KEY,
    dialogue_id         VARCHAR(64) NOT NULL,
    user_id             BIGINT NOT NULL,
    -- 行为特征向量
    avg_msg_length      INTEGER,            -- 学生消息平均字数
    ai_msg_length       INTEGER,            -- AI回复平均字数
    question_count      SMALLINT,           -- 学生主动提问次数
    clarification_count SMALLINT,           -- "没看懂"/"再讲讲"类追问次数
    method_change_req   SMALLINT,           -- "换个方法"/"另一种解法"次数
    similar_q_req       SMALLINT,           -- "出个类似的题"请求次数
    direct_answer_req   SMALLINT,           -- "直接给答案"/"答案是什么"次数
    copy_paste_pattern  BOOLEAN,            -- 是否检测到大段复制粘贴特征
    rapid_fire_pattern  BOOLEAN,            -- 是否高频快速连续提问(<5s间隔)
    quit_after_answer   BOOLEAN,            -- 是否在获得答案后立即退出
    -- 时间特征
    first_response_ms   INTEGER,            -- 首次响应时间
    avg_interval_ms     INTEGER,            -- 平均消息间隔
    longest_pause_ms    INTEGER,            -- 最长停顿时间
    -- 情感特征(来自情感感知引擎)
    sentiment_trend     VARCHAR(20),        -- POSITIVE/NEUTRAL/FRUSTRATED/BORED
    confusion_signals   SMALLINT,           -- 困惑信号次数
    insight_moments     SMALLINT,           -- "哦!"/"懂了"/"原来如此"次数
    -- 知识点相关
    kp_coverage_count   SMALLINT,           -- 对话覆盖知识点数
    kp_depth_ratio      DECIMAL(4,3),       -- 深度讨论占比
    computed_at         TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE (dialogue_id)
);

CREATE INDEX idx_behavior_user ON dialogue_behavior_feature (user_id, computed_at DESC);
CREATE INDEX idx_behavior_dialogue ON dialogue_behavior_feature (dialogue_id);
```

### 4.3 策略效果统计表 `strategy_effect_stat`

```sql
CREATE TABLE strategy_effect_stat (
    id              BIGSERIAL PRIMARY KEY,
    strategy_code   VARCHAR(50) NOT NULL,       -- 策略编码
    subject_code    VARCHAR(20) NOT NULL,       -- 学科
    grade_band      VARCHAR(20) NOT NULL,       -- 学段: PRIMARY/JUNIOR/SENIOR
    -- 统计指标
    sample_count        INTEGER NOT NULL,       -- 样本数
    avg_delta_mastery   DECIMAL(6,4),           -- 平均掌握度增量
    avg_delta_accuracy  DECIMAL(6,4),           -- 平均正确率变化
    avg_cog_engage      DECIMAL(5,2),           -- 平均认知参与度
    high_effect_ratio   DECIMAL(5,4),           -- 高成效占比
    low_effect_ratio    DECIMAL(5,4),           -- 低成效占比
    negative_ratio      DECIMAL(5,4),           -- 负效果占比
    -- 时序
    stat_date       DATE NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE (strategy_code, subject_code, grade_band, stat_date)
);
```

### 4.4 学生AI辅导成效汇总表 `student_ai_effect_summary`

```sql
CREATE TABLE student_ai_effect_summary (
    id                  BIGSERIAL PRIMARY KEY,
    user_id             BIGINT NOT NULL,
    stat_period         VARCHAR(10) NOT NULL,       -- DAILY/WEEKLY/MONTHLY
    period_start        DATE NOT NULL,
    period_end          DATE NOT NULL,
    -- 汇总数据
    total_dialogues     INTEGER NOT NULL,           -- 对话总数
    deep_ratio          DECIMAL(5,4),               -- 深度学习型占比
    answer_seeker_ratio DECIMAL(5,4),               -- 答案索取型占比
    avg_effect_score    DECIMAL(5,2),               -- 平均成效评分
    high_effect_count   INTEGER,                    -- 高成效对话数
    knowledge_gained    INTEGER,                    -- 新增掌握知识点数
    avg_delta_mastery   DECIMAL(6,4),               -- 平均掌握度增量
    -- 趋势
    effect_trend        VARCHAR(10),                -- UP/STABLE/DOWN
    -- 推荐策略
    recommended_strategy VARCHAR(50),               -- 推荐最优策略
    risk_flags          TEXT[],                     -- 风险标记
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE (user_id, stat_period, period_start)
);

CREATE INDEX idx_summary_user_period ON student_ai_effect_summary (user_id, period_start DESC);
```

---

## 5. 核心算法设计

### 5.1 对话模式分类器

采用**规则引擎 + 加权评分**双通道架构，规则引擎提供实时初判，加权评分提供更精确的后续修正。

#### 5.1.1 规则引擎（实时通道）

```java
/**
 * 对话模式实时分类器 - 基于规则引擎
 * 在对话结束时同步执行，延迟 <50ms
 */
@Component
public class DialoguePatternClassifier {

    // 行为特征权重配置（可通过规则配置中心动态调整）
    private static final PatternWeights DEFAULT_WEIGHTS = PatternWeights.builder()
        .clarificationWeight(0.20)      // 追问"没看懂"
        .methodChangeWeight(0.25)       // "换个方法"
        .similarQWeight(0.15)           // "出类似题"
        .directAnswerWeight(-0.30)      // "直接给答案"(负权)
        .turnCountWeight(0.10)          // 轮次因子
        .avgThinkTimeWeight(0.10)       // 思考时长因子
        .insightMomentWeight(0.15)      // "懂了"时刻
        .rapidFireWeight(-0.20)         // 快速连发(负权)
        .copyPasteWeight(-0.15)         // 复制粘贴(负权)
        .quitAfterAnswerWeight(-0.25)   // 得答案即走(负权)
        .build();

    /**
     * 实时分类入口
     * @param features 对话行为特征
     * @return 分类结果（含置信度）
     */
    public PatternResult classify(DialogueBehaviorFeature features) {
        double score = calculatePatternScore(features, DEFAULT_WEIGHTS);

        // 先检查硬规则（高精度）
        if (isOffTopic(features)) {
            return PatternResult.of("OFFTOPIC", 0.95);
        }
        if (isAnswerSeeker(features)) {
            return PatternResult.of("ANSWER", 0.90);
        }

        // 软评分分类
        if (score >= 0.6) return PatternResult.of("DEEP", normalize(score));
        if (score >= 0.3) return PatternResult.of("VERIFY", normalize(score));
        if (score >= 0.0) return PatternResult.of("QUICK", normalize(score));
        return PatternResult.of("ANSWER", normalize(score));
    }

    /**
     * 答案索取型硬规则判定
     */
    private boolean isAnswerSeeker(DialogueBehaviorFeature f) {
        // 规则1: 首条消息即要求直接答案 + 获得答案后立即退出
        if (f.getDirectAnswerReq() >= 1
            && f.getTurnCount() <= 2
            && Boolean.TRUE.equals(f.getQuitAfterAnswer())) {
            return true;
        }
        // 规则2: 高频连发相似题目（疑似抄作业）
        if (Boolean.TRUE.equals(f.getRapidFirePattern())
            && f.getDirectAnswerReq() >= 2) {
            return true;
        }
        // 规则3: 大段复制粘贴 + 无追问
        if (Boolean.TRUE.equals(f.getCopyPastePattern())
            && f.getClarificationCount() == 0
            && f.getQuestionCount() <= 1) {
            return true;
        }
        return false;
    }

    /**
     * 偏离学习型硬规则判定
     */
    private boolean isOffTopic(DialogueBehaviorFeature f) {
        // 无知识点覆盖 + 无学科上下文 + 短对话
        return f.getKpCoverageCount() == 0
            && f.getSubjectCode() == null
            && f.getAvgMsgLength() != null
            && f.getAvgMsgLength() < 15;
    }

    private double calculatePatternScore(DialogueBehaviorFeature f, PatternWeights w) {
        double score = 0.5; // 基准分
        score += f.getClarificationCount() * w.getClarificationWeight();
        score += f.getMethodChangeReq() * w.getMethodChangeWeight();
        score += f.getSimilarQReq() * w.getSimilarQWeight();
        score += f.getDirectAnswerReq() * w.getDirectAnswerWeight();
        score += Math.min(f.getTurnCount() / 5.0, 1.0) * w.getTurnCountWeight();
        score += normalizeThinkTime(f.getAvgIntervalMs()) * w.getAvgThinkTimeWeight();
        score += Math.min(f.getInsightMoments() / 2.0, 1.0) * w.getInsightMomentWeight();
        if (Boolean.TRUE.equals(f.getRapidFirePattern())) score += w.getRapidFireWeight();
        if (Boolean.TRUE.equals(f.getCopyPastePattern())) score += w.getCopyPasteWeight();
        if (Boolean.TRUE.equals(f.getQuitAfterAnswer())) score += w.getQuitAfterAnswerWeight();
        return Math.max(-1.0, Math.min(1.0, score));
    }

    private double normalizeThinkTime(Integer avgIntervalMs) {
        if (avgIntervalMs == null) return 0.3;
        // 30秒以上思考时间记为满分，5秒以下记为0
        return Math.max(0, Math.min(1.0, (avgIntervalMs - 5000) / 25000.0));
    }

    private double normalize(double score) {
        return Math.abs(score);
    }
}
```

#### 5.1.2 权重配置结构

```json
{
  "patternWeights": {
    "clarificationWeight": 0.20,
    "methodChangeWeight": 0.25,
    "similarQWeight": 0.15,
    "directAnswerWeight": -0.30,
    "turnCountWeight": 0.10,
    "avgThinkTimeWeight": 0.10,
    "insightMomentWeight": 0.15,
    "rapidFireWeight": -0.20,
    "copyPasteWeight": -0.15,
    "quitAfterAnswerWeight": -0.25
  },
  "hardRules": {
    "answerSeekerRules": [
      {
        "id": "ASR-01",
        "condition": "directAnswerReq >= 1 AND turnCount <= 2 AND quitAfterAnswer == true",
        "pattern": "ANSWER",
        "confidence": 0.90
      },
      {
        "id": "ASR-02",
        "condition": "rapidFirePattern == true AND directAnswerReq >= 2",
        "pattern": "ANSWER",
        "confidence": 0.90
      }
    ],
    "offTopicRules": [
      {
        "id": "OT-01",
        "condition": "kpCoverageCount == 0 AND subjectCode == null AND avgMsgLength < 15",
        "pattern": "OFFTOPIC",
        "confidence": 0.95
      }
    ]
  }
}
```

### 5.2 教育成效增量计算引擎

#### 5.2.1 ΔMastery 计算（知识掌握度增量）

```java
/**
 * 知识掌握度增量计算引擎
 * 
 * 核心思路: 对比对话前后窗口期内，学生在相关知识点上的掌握度变化
 * 
 * 时间窗口设计:
 *   - 对话前窗口: 对话前 7 天内的掌握度均值作为基线
 *   - 对话后窗口: 对话后 7 天内的掌握度均值（T+1批量计算）
 *   - 冷却期: 对话后 1 小时内的答题不计入（避免即时记忆效应）
 */
@Service
public class MasteryDeltaCalculator {

    private static final int PRE_WINDOW_DAYS = 7;
    private static final int POST_WINDOW_DAYS = 7;
    private static final long COOLDOWN_HOURS = 1;

    @Autowired
    private KnowledgeTrackerClient ktClient;

    /**
     * 计算单次对话的掌握度增量
     * 
     * @param dialogue 对话上下文
     * @return 增量结果
     */
    public MasteryDeltaResult calculate(DialogueContext dialogue) {
        List<String> kpCodes = dialogue.getKnowledgeCodes();
        if (kpCodes == null || kpCodes.isEmpty()) {
            return MasteryDeltaResult.insufficient("NO_KNOWLEDGE_POINT");
        }

        LocalDateTime dialogueTime = dialogue.getEndTime();
        LocalDateTime preStart = dialogueTime.minusDays(PRE_WINDOW_DAYS);
        LocalDateTime postEnd = dialogueTime.plusDays(POST_WINDOW_DAYS);
        LocalDateTime cooldownEnd = dialogueTime.plusHours(COOLDOWN_HOURS);

        double totalDelta = 0;
        int validKpCount = 0;
        Map<String, Double> kpDeltas = new LinkedHashMap<>();

        for (String kpCode : kpCodes) {
            // 获取对话前基线掌握度
            Double preMastery = ktClient.getAverageMastery(
                dialogue.getUserId(), kpCode, preStart, dialogueTime
            );
            // 获取对话后掌握度（排除冷却期）
            Double postMastery = ktClient.getAverageMastery(
                dialogue.getUserId(), kpCode, cooldownEnd, postEnd
            );

            if (preMastery != null && postMastery != null) {
                double delta = postMastery - preMastery;
                kpDeltas.put(kpCode, round4(delta));
                totalDelta += delta;
                validKpCount++;
            }
        }

        if (validKpCount == 0) {
            return MasteryDeltaResult.insufficient("INSUFFICIENT_DATA");
        }

        double avgDelta = totalDelta / validKpCount;
        
        // 置信度计算：样本越多越高
        double confidence = Math.min(1.0, validKpCount / 5.0 * 0.3 
            + calculateSampleConfidence(kpCodes, preStart, postEnd));

        return MasteryDeltaResult.builder()
            .deltaMastery(round4(avgDelta))
            .perKpDelta(kpDeltas)
            .confidence(confidence)
            .method("WINDOW_COMPARISON_7D")
            .build();
    }

    /**
     * 对照组校正: 同一学生在未参与AI对话的知识点上的自然变化
     */
    public MasteryDeltaResult applyControlGroupCorrection(
            MasteryDeltaResult raw, 
            Double controlGroupAvgDelta) {
        if (controlGroupAvgDelta == null) return raw;
        
        double correctedDelta = raw.getDeltaMastery() - controlGroupAvgDelta;
        return raw.toBuilder()
            .deltaMastery(round4(correctedDelta))
            .method("WINDOW_COMPARISON_7D_WITH_CONTROL")
            .build();
    }
}
```

#### 5.2.2 ΔAccuracy 计算（后续答题正确率变化）

```java
/**
 * 答题正确率变化计算器
 * 对比对话前后同类题(同知识点)的正确率
 */
@Service
public class AccuracyDeltaCalculator {

    private static final int MIN_SAMPLE_SIZE = 3; // 最少3道题才计算
    private static final int PRE_WINDOW_DAYS = 14;
    private static final int POST_WINDOW_DAYS = 14;
    private static final long COOLDOWN_HOURS = 2;  // 正确率冷却期更长

    @Autowired
    private AnswerRecordRepository answerRecordRepo;

    public AccuracyDeltaResult calculate(DialogueContext dialogue) {
        Long userId = dialogue.getUserId();
        List<String> kpCodes = dialogue.getKnowledgeCodes();
        LocalDateTime dialogueTime = dialogue.getEndTime();

        // 对话前答题记录
        List<AnswerRecord> preRecords = answerRecordRepo.findByUserAndKnowledgePointsAndTimeRange(
            userId, kpCodes,
            dialogueTime.minusDays(PRE_WINDOW_DAYS), dialogueTime
        );

        // 对话后答题记录（排除冷却期）
        List<AnswerRecord> postRecords = answerRecordRepo.findByUserAndKnowledgePointsAndTimeRange(
            userId, kpCodes,
            dialogueTime.plusHours(COOLDOWN_HOURS),
            dialogueTime.plusDays(POST_WINDOW_DAYS)
        );

        if (preRecords.size() < MIN_SAMPLE_SIZE || postRecords.size() < MIN_SAMPLE_SIZE) {
            return AccuracyDeltaResult.insufficient("INSUFFICIENT_QUESTIONS");
        }

        double preAccuracy = calculateAccuracy(preRecords);
        double postAccuracy = calculateAccuracy(postRecords);
        double delta = postAccuracy - preAccuracy;

        // 难度校正：如果后置题目更难，需要补偿
        double preAvgDifficulty = calculateAvgDifficulty(preRecords);
        double postAvgDifficulty = calculateAvgDifficulty(postRecords);
        double difficultyAdjustment = (postAvgDifficulty - preAvgDifficulty) * 0.15; // 难度系数
        double adjustedDelta = delta + difficultyAdjustment;

        return AccuracyDeltaResult.builder()
            .preAccuracy(round4(preAccuracy))
            .postAccuracy(round4(postAccuracy))
            .rawDelta(round4(delta))
            .adjustedDelta(round4(adjustedDelta))
            .preSampleSize(preRecords.size())
            .postSampleSize(postRecords.size())
            .confidence(calculateConfidence(preRecords.size(), postRecords.size()))
            .build();
    }
}
```

#### 5.2.3 Independence Score 计算（独立解题能力）

```java
/**
 * 独立解题能力评分
 * 度量学生在AI辅导后，遇到同类问题时是否能独立解决（不再求助AI）
 */
@Service
public class IndependenceScorer {

    private static final int TRACKING_WINDOW_DAYS = 30;

    @Autowired
    private AiDialogueRepository dialogueRepo;

    @Autowired
    private AnswerRecordRepository answerRecordRepo;

    public IndependenceResult calculate(DialogueContext dialogue) {
        Long userId = dialogue.getUserId();
        List<String> kpCodes = dialogue.getKnowledgeCodes();
        LocalDateTime dialogueTime = dialogue.getEndTime();
        LocalDateTime windowEnd = dialogueTime.plusDays(TRACKING_WINDOW_DAYS);

        // 统计后续30天内：
        // 1. 同知识点自主答题数（非AI辅助）
        long independentAnswers = answerRecordRepo.countIndependentByKps(
            userId, kpCodes, dialogueTime, windowEnd
        );
        // 2. 同知识点AI求助次数
        long aiAssistCount = dialogueRepo.countByUserAndKnowledgePointsAndTimeRange(
            userId, kpCodes, dialogueTime, windowEnd
        );

        // 3. 同知识点自主答题正确率
        double independentAccuracy = answerRecordRepo.getAccuracyByUserAndKps(
            userId, kpCodes, dialogueTime, windowEnd
        );

        // 独立性评分公式
        // independenceScore = w1 * (independentRatio) + w2 * (accuracy) + w3 * (1 - aiDependencyDecline)
        double independentRatio = independentAnswers == 0 ? 0
            : (double) independentAnswers / (independentAnswers + aiAssistCount);
        
        double aiDependencyTrend = calculateAiDependencyTrend(userId, kpCodes, dialogueTime);
        double dependencyDecline = 1.0 - aiDependencyTrend; // AI依赖度下降越多越好

        double score = 0.4 * independentRatio 
                     + 0.35 * independentAccuracy 
                     + 0.25 * dependencyDecline;

        return IndependenceResult.builder()
            .independenceScore(round4(score))
            .independentAnswerCount(independentAnswers)
            .aiAssistCount(aiAssistCount)
            .independentAccuracy(round4(independentAccuracy))
            .aiDependencyTrend(round4(aiDependencyTrend))
            .build();
    }
}
```

### 5.3 认知参与度评分模型

```java
/**
 * 认知参与度(Cognitive Engagement)评分模型
 * 
 * 综合行为信号、时间模式、内容深度多维度评分
 */
@Service
public class CognitiveEngagementScorer {

    public CogEngageResult score(DialogueBehaviorFeature feature, DialogueContext context) {
        // 维度1: 交互深度 (0-30分)
        double interactDepth = scoreInteractionDepth(feature);
        
        // 维度2: 思考质量 (0-25分)  
        double thinkQuality = scoreThinkQuality(feature);
        
        // 维度3: 主动建构 (0-25分) - 学生是否主动构建知识
        double activeConstruct = scoreActiveConstruction(feature);
        
        // 维度4: 元认知行为 (0-20分) - 反思、自我纠错
        double metacognition = scoreMetacognition(feature);

        double total = interactDepth + thinkQuality + activeConstruct + metacognition;
        
        return CogEngageResult.builder()
            .totalScore(round2(total))
            .interactDepth(round2(interactDepth))
            .thinkQuality(round2(thinkQuality))
            .activeConstruction(round2(activeConstruct))
            .metacognition(round2(metacognition))
            .level(classifyLevel(total))
            .build();
    }

    private double scoreInteractionDepth(DialogueBehaviorFeature f) {
        double score = 0;
        // 追问次数贡献
        score += Math.min(f.getClarificationCount() * 6, 18);
        // 换方法请求
        score += Math.min(f.getMethodChangeReq() * 4, 8);
        // 同类题请求
        score += Math.min(f.getSimilarQReq() * 4, 4);
        return Math.min(score, 30);
    }

    private double scoreThinkQuality(DialogueBehaviorFeature f) {
        double score = 0;
        if (f.getAvgIntervalMs() != null) {
            // 平均思考时长: >60s=满分, <5s=0分
            double thinkNorm = Math.max(0, Math.min(1, (f.getAvgIntervalMs() - 5000) / 55000.0));
            score += thinkNorm * 15;
        }
        // 最长停顿: 反映深度思考
        if (f.getLongestPauseMs() != null) {
            double pauseNorm = Math.max(0, Math.min(1, (f.getLongestPauseMs() - 10000) / 110000.0));
            score += pauseNorm * 10;
        }
        return Math.min(score, 25);
    }

    private double scoreActiveConstruction(DialogueBehaviorFeature f) {
        double score = 0;
        // "懂了"/"原来如此" = 顿悟时刻
        score += Math.min(f.getInsightMoments() * 5, 15);
        // 主动提问数量
        score += Math.min(f.getQuestionCount() * 3, 10);
        return Math.min(score, 25);
    }

    private double scoreMetacognition(DialogueBehaviorFeature f) {
        double score = 0;
        // 困惑信号后继续追问 = 元认知监控
        if (f.getConfusionSignals() > 0 && f.getClarificationCount() > 0) {
            score += 10;
        }
        // "换个方法" = 策略调整意识
        score += Math.min(f.getMethodChangeReq() * 5, 10);
        return Math.min(score, 20);
    }

    private String classifyLevel(double score) {
        if (score >= 75) return "HIGH";
        if (score >= 50) return "MEDIUM";
        if (score >= 25) return "LOW";
        return "MINIMAL";
    }
}
```

### 5.4 综合成效评级引擎

```java
/**
 * 综合成效评级引擎
 * 将各维度指标融合为统一的成效评级
 */
@Service
public class OverallEffectEvaluator {

    /**
     * 综合评级
     * 输入各维度指标，输出统一评级和评分
     */
    public EffectEvaluation evaluate(EffectEvaluationInput input) {
        // 获取各维度指标（部分可能因数据不足为null）
        Double deltaMastery = input.getDeltaMastery();    // -1 ~ 1
        Double deltaAccuracy = input.getDeltaAccuracy();   // -1 ~ 1
        Double independence = input.getIndependenceScore(); // 0 ~ 1
        Double cogEngage = input.getCogEngageScore() / 100.0; // 归一化到 0 ~ 1
        String pattern = input.getDialoguePattern();

        // 数据可用性检查
        int availableDimensions = countNonNull(deltaMastery, deltaAccuracy, independence, cogEngage);
        if (availableDimensions < 2) {
            return EffectEvaluation.insufficient("INSUFFICIENT_DIMENSIONS");
        }

        // 加权综合评分 (各维度权重可配置)
        double[] weights = calculateWeights(input, availableDimensions);
        double compositeScore = 0;
        int idx = 0;
        
        if (deltaMastery != null) compositeScore += deltaMastery * weights[idx];
        idx++;
        if (deltaAccuracy != null) compositeScore += deltaAccuracy * weights[idx];
        idx++;
        if (independence != null) compositeScore += (independence - 0.5) * 2 * weights[idx]; // 中心化到-1~1
        idx++;
        if (cogEngage != null) compositeScore += (cogEngage - 0.5) * 2 * weights[idx];

        // 对话模式修正
        double patternModifier = getPatternModifier(pattern);
        compositeScore = compositeScore * (1 + patternModifier * 0.1);

        // 评级映射
        String overallEffect;
        if (compositeScore >= 0.15) overallEffect = "HIGH";
        else if (compositeScore >= 0.05) overallEffect = "MEDIUM";
        else if (compositeScore >= -0.05) overallEffect = "LOW";
        else if (compositeScore >= -0.15) overallEffect = "NONE";
        else overallEffect = "NEGATIVE";

        // 置信度评估
        double confidence = calculateOverallConfidence(input, availableDimensions);

        return EffectEvaluation.builder()
            .overallEffect(overallEffect)
            .compositeScore(round4(compositeScore))
            .confidence(round4(confidence))
            .dimensionWeights(weights)
            .build();
    }

    /**
     * 根据可用维度和学段动态计算权重
     */
    private double[] calculateWeights(EffectEvaluationInput input, int available) {
        // 基础权重
        double wMastery = 0.35;
        double wAccuracy = 0.30;
        double wIndependence = 0.20;
        double wCogEngage = 0.15;

        // 小学段更看重认知参与度
        if (input.getGradeLevel() <= 6) {
            wCogEngage = 0.25;
            wIndependence = 0.10;
        }
        // 高中段更看重掌握度变化
        if (input.getGradeLevel() >= 10) {
            wMastery = 0.45;
            wAccuracy = 0.25;
        }

        // 归一化（仅对可用维度）
        double total = 0;
        double[] raw = {wMastery, wAccuracy, wIndependence, wCogEngage};
        // ... 归一化逻辑省略
        return normalizeWeights(raw, input);
    }

    private double getPatternModifier(String pattern) {
        return switch (pattern) {
            case "DEEP" -> 0.15;       // 深度学习型加成
            case "VERIFY" -> 0.05;     // 理解验证型小幅加成
            case "QUICK" -> 0.0;       // 中性
            case "ANSWER" -> -0.20;    // 答案索取型扣减
            case "OFFTOPIC" -> -0.30;  // 偏离型强扣减
            default -> 0.0;
        };
    }
}
```

### 5.5 AI教学策略归因引擎

```java
/**
 * AI教学策略归因引擎
 * 分析哪种AI讲解策略产生了最好的教育成效
 */
@Service
public class StrategyAttributionEngine {

    @Autowired
    private StrategyEffectStatRepository statRepo;

    /**
     * 策略标签枚举
     */
    public static final class StrategyTags {
        public static final String STEP_BY_STEP = "STEP_BY_STEP";       // 分步讲解
        public static final String ANALOGY = "ANALOGY";                 // 类比举例
        public static final String SOCRATIC = "SOCRATIC";               // 苏格拉底式追问
        public static final String VISUAL_AID = "VISUAL_AID";           // 图形辅助
        public static final String REAL_WORLD = "REAL_WORLD";           // 生活实例
        public static final String KNOWLEDGE_REVIEW = "KNOWLEDGE_REVIEW"; // 旧知识回顾
        public static final String PRACTICE_FIRST = "PRACTICE_FIRST";   // 先练后讲
        public static final String HINT_ONLY = "HINT_ONLY";             // 仅给提示
        public static final String FULL_SOLUTION = "FULL_SOLUTION";     // 完整解答
        public static final String MULTIPLE_METHODS = "MULTIPLE_METHODS"; // 多种解法
    }

    /**
     * 对单次对话进行策略归因
     */
    public AttributionResult attribute(DialogueContext dialogue, EffectEvaluation effect) {
        List<String> strategies = dialogue.getAiStrategies();
        if (strategies == null || strategies.isEmpty() || 
            "INSUFFICIENT".equals(effect.getOverallEffect())) {
            return AttributionResult.skipped();
        }

        // 获取该学段+学科下各策略的历史平均成效
        Map<String, StrategyBenchmark> benchmarks = getBenchmarks(
            dialogue.getSubjectCode(), 
            dialogue.getGradeBand(),
            strategies
        );

        // 找出本次成效超出平均最多的策略
        String bestStrategy = null;
        double maxLift = Double.NEGATIVE_INFINITY;

        for (String strategy : strategies) {
            StrategyBenchmark benchmark = benchmarks.get(strategy);
            if (benchmark == null) continue;
            
            double expectedEffect = benchmark.getAvgDeltaMastery();
            double actualEffect = effect.getCompositeScore();
            double lift = actualEffect - expectedEffect;
            
            if (lift > maxLift) {
                maxLift = lift;
                bestStrategy = strategy;
            }
        }

        return AttributionResult.builder()
            .bestStrategy(bestStrategy)
            .expectedEffect(benchmarks.get(bestStrategy) != null 
                ? benchmarks.get(bestStrategy).getAvgDeltaMastery() : null)
            .actualEffect(effect.getCompositeScore())
            .lift(round4(maxLift))
            .build();
    }

    /**
     * 更新策略效果统计（批量任务）
     */
    @Scheduled(cron = "0 0 2 * * *") // 每天凌晨2点
    public void updateStrategyStatistics() {
        LocalDate yesterday = LocalDate.now().minusDays(1);
        
        // 获取昨天所有已评估的对话
        List<AiDialogueEffect> effects = effectRepo.findByEvaluatedDateAndMethod(yesterday, "BATCH");
        
        // 按策略+学科+学段分组统计
        Map<StrategySubjectGradeKey, List<AiDialogueEffect>> grouped = effects.stream()
            .filter(e -> e.getAiStrategies() != null && !e.getAiStrategies().isEmpty())
            .flatMap(e -> e.getAiStrategies().stream().map(s -> Map.entry(
                StrategySubjectGradeKey.of(s, e.getSubjectCode(), gradeToBand(e.getGradeLevel())),
                e
            )))
            .collect(Collectors.groupingBy(Map.Entry::getKey, 
                     Collectors.mapping(Map.Entry::getValue, Collectors.toList())));

        // 更新统计表
        for (var entry : grouped.entrySet()) {
            upsertStrategyStat(entry.getKey(), entry.getValue(), yesterday);
        }
    }
}
```

---

## 6. API接口设计

### 6.1 对话结束实时初评接口

```
POST /api/v1/ai-effect/realtime-evaluate
```

**请求体：**
```json
{
  "dialogueId": "dlg_20260618_a1b2c3d4",
  "userId": 10002345,
  "subjectCode": "MATH",
  "gradeLevel": 8,
  "knowledgeCodes": ["KP_MATH_0078", "KP_MATH_0079"],
  "startTime": "2026-06-18T03:20:00Z",
  "endTime": "2026-06-18T03:35:00Z",
  "turns": [
    {
      "role": "STUDENT",
      "content": "这道一元二次方程怎么解？x²-5x+6=0",
      "timestamp": "2026-06-18T03:20:15Z",
      "msgLength": 28
    },
    {
      "role": "AI",
      "content": "我们用因式分解法来解这道题...",
      "timestamp": "2026-06-18T03:20:18Z",
      "strategies": ["STEP_BY_STEP", "KNOWLEDGE_REVIEW"],
      "msgLength": 320
    },
    {
      "role": "STUDENT",
      "content": "哦！是因为可以分解成(x-2)(x-3)=0对吗？",
      "timestamp": "2026-06-18T03:22:45Z",
      "msgLength": 35,
      "insightMoment": true
    }
  ],
  "behaviorSignals": {
    "clarificationCount": 0,
    "methodChangeReq": 0,
    "similarQReq": 0,
    "directAnswerReq": 0,
    "copyPastePattern": false,
    "rapidFirePattern": false,
    "quitAfterAnswer": false
  }
}
```

**响应体：**
```json
{
  "code": 0,
  "data": {
    "dialogueId": "dlg_20260618_a1b2c3d4",
    "pattern": "DEEP",
    "patternConfidence": 0.82,
    "cogEngageScore": 68.5,
    "cogEngageLevel": "MEDIUM",
    "realtimeEffect": "PENDING",
    "note": "实时初评完成，完整成效需T+1批量计算后更新",
    "riskFlags": []
  }
}
```

### 6.2 T+1批量成效查询接口

```
GET /api/v1/ai-effect/dialogue/{dialogueId}
```

**响应体：**
```json
{
  "code": 0,
  "data": {
    "dialogueId": "dlg_20260618_a1b2c3d4",
    "userId": 10002345,
    "pattern": "DEEP",
    "patternConfidence": 0.82,
    "cogEngageScore": 68.5,
    "deltaMastery": 0.0823,
    "deltaAccuracy": 0.1500,
    "independenceScore": 0.72,
    "overallEffect": "HIGH",
    "compositeScore": 0.1875,
    "confidence": 0.78,
    "evalMethod": "BATCH",
    "evaluatedAt": "2026-06-19T02:15:30Z",
    "aiStrategies": ["STEP_BY_STEP", "KNOWLEDGE_REVIEW"],
    "bestStrategy": "STEP_BY_STEP",
    "strategyLift": 0.035,
    "perKpDelta": {
      "KP_MATH_0078": 0.0950,
      "KP_MATH_0079": 0.0696
    }
  }
}
```

### 6.3 学生成效汇总查询

```
GET /api/v1/ai-effect/student/{userId}/summary?period=WEEKLY&date=2026-06-18
```

**响应体：**
```json
{
  "code": 0,
  "data": {
    "userId": 10002345,
    "period": "WEEKLY",
    "periodStart": "2026-06-12",
    "periodEnd": "2026-06-18",
    "totalDialogues": 14,
    "patternDistribution": {
      "DEEP": 0.43,
      "VERIFY": 0.21,
      "QUICK": 0.29,
      "ANSWER": 0.07,
      "OFFTOPIC": 0.00
    },
    "avgEffectScore": 72.3,
    "avgDeltaMastery": 0.0456,
    "highEffectCount": 6,
    "knowledgeGained": 8,
    "effectTrend": "UP",
    "recommendedStrategy": "STEP_BY_STEP",
    "riskFlags": ["ANSWER_SEEKER_INCREASING"]
  }
}
```

### 6.4 策略效果排行榜

```
GET /api/v1/ai-effect/strategies/ranking?subject=MATH&gradeBand=JUNIOR&days=30
```

**响应体：**
```json
{
  "code": 0,
  "data": {
    "subject": "MATH",
    "gradeBand": "JUNIOR",
    "rankings": [
      {
        "strategy": "STEP_BY_STEP",
        "sampleCount": 3420,
        "avgDeltaMastery": 0.0623,
        "highEffectRatio": 0.38,
        "rank": 1
      },
      {
        "strategy": "SOCRATIC",
        "sampleCount": 1850,
        "avgDeltaMastery": 0.0589,
        "highEffectRatio": 0.35,
        "rank": 2
      },
      {
        "strategy": "ANALOGY",
        "sampleCount": 2100,
        "avgDeltaMastery": 0.0412,
        "highEffectRatio": 0.28,
        "rank": 3
      }
    ]
  }
}
```

### 6.5 异常模式告警回调

```
POST /api/v1/ai-effect/alerts/callback  (内部接口)
```

当检测到以下异常模式时，触发告警推送到消息系统：

```json
{
  "alertType": "ANSWER_SEEKER_SPIKE",
  "userId": 10002345,
  "severity": "WARNING",
  "description": "答案索取型对话占比本周上升至35%（上周12%）",
  "triggerRule": "answer_seeker_ratio > 0.30 AND week_over_week_increase > 0.15",
  "suggestedActions": [
    "强化答案管控策略",
    "推送分步引导式提示",
    "通知家长（如已绑定）"
  ],
  "triggeredAt": "2026-06-18T08:00:00Z"
}
```

---

## 7. 状态流转

### 7.1 评估状态机

```
                     对话结束
                        │
                        ▼
               ┌────────────────┐
               │   PENDING      │  对话刚结束，等待实时初评
               └───────┬────────┘
                       │ 实时分类器执行
                       ▼
               ┌────────────────┐     数据不足
               │  REALTIME_DONE │─────────────▶ INSUFFICIENT
               └───────┬────────┘
                       │ T+1 批处理触发
                       ▼
               ┌────────────────┐     无后续答题数据
               │  CALCULATING   │─────────────▶ DATA_LIMITED
               └───────┬────────┘
                       │ 增量计算完成
                       ▼
               ┌────────────────┐
               │   EVALUATED    │  最终评估完成
               └───────┬────────┘
                       │ 7天后新数据到达
                       ▼
               ┌────────────────┐
               │  REINFORCED    │  强化评估（更多后置数据）
               └────────────────┘
```

### 7.2 状态流转实现

```java
public enum EffectEvalState {
    PENDING,          // 等待评估
    REALTIME_DONE,    // 实时初评完成
    CALCULATING,      // T+1计算中
    EVALUATED,        // 评估完成
    REINFORCED,       // 强化评估（更多数据后重算）
    INSUFFICIENT,     // 数据不足
    DATA_LIMITED      // 数据有限（部分维度可用）
}
```

---

## 8. 异常处理与边界条件

### 8.1 异常处理策略

| 异常场景 | 处理策略 | 错误码 |
|---------|---------|--------|
| 对话无知识点标注 | 跳过ΔMastery和ΔAccuracy计算，仅评估认知参与度和对话模式 | EE-001 |
| 对话前后无答题记录 | 标记为 DATA_LIMITED，仅使用实时维度评估 | EE-002 |
| 知识追踪服务不可用 | 降级为仅使用ΔAccuracy维度，标记降级原因 | EE-003 |
| 对话轮次<2 | 直接标记为 INSUFFICIENT，不进行评估 | EE-004 |
| 对话涉及>10个知识点 | 取AI标注置信度最高的前5个知识点计算 | EE-005 |
| 同一知识点7天内多次AI辅导 | 只计算首次对话的增量，后续标记为"重复辅导" | EE-006 |
| 批处理窗口期内无数据 | 标记 PENDING，延后至下一批处理周期 | EE-007 |
| 学生年级升迁 | 升迁前后知识点掌握度基线不同，使用升迁后的新基线 | EE-008 |

### 8.2 数据质量保障

```java
/**
 * 评估数据质量校验器
 * 在计算前校验输入数据的完整性和合理性
 */
@Component
public class EffectDataValidator {

    public ValidationResult validate(DialogueContext context) {
        List<String> errors = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        // 基础完整性校验
        if (context.getUserId() == null) {
            errors.add("userId is required");
        }
        if (context.getKnowledgeCodes() == null || context.getKnowledgeCodes().isEmpty()) {
            warnings.add("no knowledge points tagged for this dialogue");
        }
        if (context.getEndTime() == null) {
            errors.add("endTime is required for delta calculation");
        }

        // 合理性校验
        if (context.getTurnCount() != null && context.getTurnCount() < 2) {
            errors.add("dialogue too short (turnCount < 2) for meaningful evaluation");
        }
        if (context.getKnowledgeCodes() != null && context.getKnowledgeCodes().size() > 15) {
            warnings.add("too many knowledge points tagged, will use top 5 by confidence");
        }

        // 时间窗口校验
        if (context.getEndTime() != null) {
            Duration duration = Duration.between(context.getStartTime(), context.getEndTime());
            if (duration.toMinutes() < 1) {
                warnings.add("dialogue duration < 1 minute, evaluation may not be meaningful");
            }
            if (duration.toHours() > 4) {
                warnings.add("dialogue duration > 4 hours, may include idle time");
            }
        }

        return new ValidationResult(errors, warnings);
    }
}
```

---

## 9. 批处理任务设计

### 9.1 T+1 成效计算任务

```java
/**
 * T+1 成效批量计算任务
 * 每天凌晨2点执行，计算昨天结束的AI对话的完整教育成效
 */
@Component
@Slf4j
public class DailyEffectCalculationJob {

    @Scheduled(cron = "0 0 2 * * *")
    public void execute() {
        LocalDate targetDate = LocalDate.now().minusDays(1);
        log.info("Starting daily effect calculation for date: {}", targetDate);

        // Step 1: 获取待评估对话列表
        List<String> dialogueIds = dialogueRepo.findIdsByDateAndState(
            targetDate, EffectEvalState.REALTIME_DONE.name()
        );
        log.info("Found {} dialogues to evaluate", dialogueIds.size());

        // Step 2: 分批处理 (每批200条)
        int batchSize = 200;
        int totalSuccess = 0;
        int totalFailed = 0;

        for (int i = 0; i < dialogueIds.size(); i += batchSize) {
            List<String> batch = dialogueIds.subList(i, Math.min(i + batchSize, dialogueIds.size()));
            
            BatchResult result = processBatch(batch);
            totalSuccess += result.getSuccessCount();
            totalFailed += result.getFailedCount();

            // 批间间隔，避免对数据库和KT服务造成压力
            sleep(500);
        }

        // Step 3: 更新策略效果统计
        strategyAttributionEngine.updateStrategyStatistics();

        // Step 4: 生成学生日汇总
        generateDailyStudentSummaries(targetDate);

        // Step 5: 检测异常模式并告警
        anomalyDetector.detectAndAlert(targetDate);

        log.info("Daily effect calculation completed: success={}, failed={}", 
            totalSuccess, totalFailed);
    }

    private BatchResult processBatch(List<String> dialogueIds) {
        int success = 0;
        int failed = 0;

        for (String dialogueId : dialogueIds) {
            try {
                processSingleDialogue(dialogueId);
                success++;
            } catch (Exception e) {
                log.error("Failed to evaluate dialogue: {}", dialogueId, e);
                failed++;
                // 记录失败原因，明天重试
                failedRecordRepo.save(new FailedEvaluation(dialogueId, e.getMessage(), LocalDate.now()));
            }
        }
        return new BatchResult(success, failed);
    }

    private void processSingleDialogue(String dialogueId) {
        // 1. 加载对话上下文和行为特征
        DialogueContext context = dialogueService.loadContext(dialogueId);
        DialogueBehaviorFeature features = featureExtractor.extract(context);

        // 2. 数据质量校验
        ValidationResult validation = dataValidator.validate(context);
        if (!validation.getErrors().isEmpty()) {
            effectRepo.updateState(dialogueId, EffectEvalState.INSUFFICIENT);
            return;
        }

        // 3. 各维度增量计算
        MasteryDeltaResult masteryResult = masteryCalculator.calculate(context);
        AccuracyDeltaResult accuracyResult = accuracyCalculator.calculate(context);
        IndependenceResult independenceResult = independenceScorer.calculate(context);
        CogEngageResult cogEngageResult = cogEngagementScorer.score(features, context);

        // 4. 综合评级
        EffectEvaluationInput input = EffectEvaluationInput.builder()
            .deltaMastery(masteryResult.getDeltaMastery())
            .deltaAccuracy(accuracyResult.getAdjustedDelta())
            .independenceScore(independenceResult.getIndependenceScore())
            .cogEngageScore(cogEngageResult.getTotalScore())
            .dialoguePattern(context.getRealtimePattern())
            .gradeLevel(context.getGradeLevel())
            .subjectCode(context.getSubjectCode())
            .build();

        EffectEvaluation overall = overallEvaluator.evaluate(input);

        // 5. 策略归因
        AttributionResult attribution = strategyAttribution.attribute(context, overall);

        // 6. 持久化结果
        AiDialogueEffect entity = buildEntity(
            dialogueId, context, features, 
            masteryResult, accuracyResult, independenceResult, 
            cogEngageResult, overall, attribution
        );
        effectRepo.upsert(entity);
    }
}
```

### 9.2 7天强化评估任务

```java
/**
 * 7天强化评估任务
 * 对7天前评估为EVALUATED的对话，用更多后置数据重新计算
 */
@Component
@Slf4j
public class ReinforcementEvaluationJob {

    @Scheduled(cron = "0 0 4 * * *")  // 每天凌晨4点
    public void execute() {
        LocalDate targetDate = LocalDate.now().minusDays(7);
        
        // 获取7天前评估完成的对话
        List<String> dialogueIds = effectRepo.findIdsByDateAndState(
            targetDate, EffectEvalState.EVALUATED.name()
        );

        for (String dialogueId : dialogueIds) {
            try {
                // 使用完整的14天后置窗口重新计算
                DialogueContext context = dialogueService.loadContext(dialogueId);
                MasteryDeltaResult reinforced = masteryCalculator.calculateWithExtendedWindow(
                    context, 14 // 14天后置窗口
                );
                
                // 如果增量显著变化，更新评估结果
                effectRepo.updateMasteryDelta(dialogueId, reinforced);
                
                if (reinforced.getDeltaMastery() != null) {
                    effectRepo.updateState(dialogueId, EffectEvalState.REINFORCED);
                }
            } catch (Exception e) {
                log.warn("Reinforcement evaluation failed for {}: {}", dialogueId, e.getMessage());
            }
        }
    }
}
```

---

## 10. 告警与异常模式检测

### 10.1 异常模式定义

| 异常模式 | 触发条件 | 建议动作 | 级别 |
|---------|---------|---------|------|
| 答案索取激增 | 周答案索取型占比>30%且环比上升>15% | 强化答案管控、推送启发式提示 | WARNING |
| 学习成效下降 | 连续2周平均成效评分下降>20% | 分析下降原因、调整推荐策略 | WARNING |
| 负效果累积 | 连续5次对话评估为NONE/NEGATIVE | 触发人工教研介入 | CRITICAL |
| 高频偏离 | 单日OFFTOPIC对话占比>20% | 检查AI输入安全护栏 | WARNING |
| 策略失效 | 某策略的avgDeltaMastery连续30天<0 | 标记策略需要优化 | INFO |
| 抄袭模式 | 检测到rapidFirePattern+copyPaste组合 | 限制AI调用频率、通知家长 | CRITICAL |

### 10.2 告警检测器实现

```java
@Component
@Slf4j
public class EffectAnomalyDetector {

    /**
     * 检测异常模式并触发告警
     */
    public void detectAndAlert(LocalDate date) {
        // 1. 答案索取激增检测
        detectAnswerSeekerSpike(date);

        // 2. 成效下降趋势检测
        detectEffectDecline(date);

        // 3. 负效果累积检测
        detectNegativeStreak(date);

        // 4. 高频偏离检测
        detectOffTopicSpike(date);

        // 5. 策略失效检测
        detectStrategyFailure(date);
    }

    private void detectAnswerSeekerSpike(LocalDate date) {
        LocalDate weekStart = date.minusDays(6);
        LocalDate lastWeekStart = weekStart.minusDays(7);

        // 本周答案索取型占比
        double thisWeekRatio = effectRepo.getPatternRatio(
            "ANSWER", weekStart, date
        );
        // 上周占比
        double lastWeekRatio = effectRepo.getPatternRatio(
            "ANSWER", lastWeekStart, weekStart.minusDays(1)
        );

        if (thisWeekRatio > 0.30 && (thisWeekRatio - lastWeekRatio) > 0.15) {
            // 按用户维度找到恶化最严重的用户
            List<UserRatioChange> topUsers = effectRepo.getTopAnswerSeekerUsers(
                weekStart, date, lastWeekStart, weekStart.minusDays(1), 50
            );

            for (UserRatioChange user : topUsers) {
                alertService.sendAlert(EffectAlert.builder()
                    .alertType("ANSWER_SEEKER_SPIKE")
                    .userId(user.getUserId())
                    .severity("WARNING")
                    .description(String.format(
                        "答案索取型对话占比本周上升至%.0f%%（上周%.0f%%）",
                        user.getCurrentRatio() * 100, user.getPreviousRatio() * 100
                    ))
                    .metric("current_ratio", user.getCurrentRatio())
                    .metric("previous_ratio", user.getPreviousRatio())
                    .suggestedActions(List.of(
                        "强化答案管控策略",
                        "推送分步引导式提示",
                        "通知家长（如已绑定）"
                    ))
                    .triggeredAt(ZonedDateTime.now())
                    .build());
            }
        }
    }
}
```

---

## 11. 性能与容量设计

### 11.1 性能指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 实时初评延迟 | < 50ms (P99) | 对话结束时的同步评估 |
| T+1批处理吞吐 | > 5000条/小时 | 单节点处理能力 |
| 单条对话评估延迟 | < 500ms | 含DB写入和KT服务调用 |
| 查询接口P99延迟 | < 200ms | 成效查询接口 |
| 告警检测延迟 | < 5min | 从数据到达到告警发出 |

### 11.2 容量估算

| 资源 | 日均量 | 月峰值量 | 说明 |
|------|--------|---------|------|
| AI对话量 | 50万条 | 2000万条 | 假设50万DAU，人均1次AI辅导 |
| 效果评估记录 | 50万条/天 | 2000万条/月 | 1:1对应对话 |
| 行为特征存储 | ~200MB/天 | ~6GB/月 | 单条约400字节 |
| ClickHouse查询 | ~5万次/天 | - | 汇总查询和排行 |

### 11.3 优化策略

```java
/**
 * 批处理并行化设计
 */
@Configuration
public class EffectCalculationParallelConfig {

    @Bean
    public TaskExecutor effectCalculationExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);        // 4个并发线程
        executor.setMaxPoolSize(8);         // 最大8个
        executor.setQueueCapacity(2000);    // 队列容量
        executor.setThreadNamePrefix("effect-calc-");
        executor.setRejectedExecutionHandler(new CallerRunsPolicy());
        return executor;
    }
}

/**
 * KT服务调用批量优化
 * 避免逐知识点逐条调用KT引擎，改为批量查询
 */
@Service
public class BatchKtClient {

    /**
     * 批量获取多知识点掌握度
     */
    public Map<String, Double> batchGetMastery(
            Long userId, 
            List<String> kpCodes, 
            LocalDateTime start, 
            LocalDateTime end) {
        
        // 单次HTTP请求获取多个知识点的掌握度
        return ktClient.batchQuery(BatchMasteryQuery.builder()
            .userId(userId)
            .knowledgePointCodes(kpCodes)
            .startTime(start)
            .endTime(end)
            .build());
    }
}
```

---

## 12. 与其他模块的集成

### 12.1 集成清单

| 下游模块 | 集成方式 | 数据流向 | 说明 |
|---------|---------|---------|------|
| AI Prompt编排系统 | API回调 | 成效→Prompt优化 | 将策略效果反馈到Prompt编排，优化低效策略 |
| 答案管控引擎 | Kafka事件 | 风险标记→管控升级 | ANSWER模式激增时触发更严格的答案隐藏 |
| 学情分析服务 | DB共享 | 成效数据→学情报告 | 将AI辅导成效纳入学情报告的"学习增值"板块 |
| 防沉迷系统 | API调用 | OFFTOPIC时长→防沉迷 | 将OFFTOPIC对话时间计入非学习时长 |
| 知识追踪引擎 | API调用 | ΔMastery数据回流 | 校准KT模型对AI辅导干预的敏感度 |
| 运营数据看板 | ClickHouse查询 | 策略排行→运营驾驶舱 | 展示AI辅导成效核心指标 |
| 家长端报告 | API查询 | 成效汇总→家长报告 | 向家长展示AI辅导带来的学习增值 |
| 推荐系统 | Kafka事件 | 成效信号→推荐优化 | 高成效内容类型优先推荐 |

### 12.2 Prompt优化反馈闭环

```java
/**
 * Prompt优化反馈推送
 * 当检测到某策略持续低效时，通知Prompt编排系统
 */
@Component
public class PromptFeedbackNotifier {

    @Autowired
    private StrategyEffectStatRepository statRepo;

    @Scheduled(cron = "0 0 6 * * MON")  // 每周一上午6点
    public void pushWeeklyFeedback() {
        LocalDate weekEnd = LocalDate.now().minusDays(1);
        LocalDate weekStart = weekEnd.minusDays(6);

        // 获取各策略周表现
        List<StrategyEffectStat> stats = statRepo.findByDateRange(weekStart, weekEnd);

        Map<String, StrategyPerformanceReport> reports = stats.stream()
            .collect(Collectors.groupingBy(StrategyEffectStat::getStrategyCode))
            .entrySet().stream()
            .map(e -> Map.entry(e.getKey(), aggregateWeekly(e.getValue())))
            .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));

        // 找出表现最差的策略，生成优化建议
        List<OptimizationSuggestion> suggestions = reports.entrySet().stream()
            .filter(e -> e.getValue().getAvgDeltaMastery() < 0.01)
            .filter(e -> e.getValue().getSampleCount() > 100) // 样本量足够
            .sorted(Comparator.comparingDouble(e -> e.getValue().getAvgDeltaMastery()))
            .limit(5)
            .map(e -> OptimizationSuggestion.builder()
                .strategyCode(e.getKey())
                .subject(e.getValue().getBestSubject())
                .gradeBand(e.getValue().getBestGradeBand())
                .avgDeltaMastery(e.getValue().getAvgDeltaMastery())
                .sampleCount(e.getValue().getSampleCount())
                .recommendation(buildRecommendation(e.getKey(), e.getValue()))
                .build())
            .collect(Collectors.toList());

        // 推送到Prompt编排系统
        if (!suggestions.isEmpty()) {
            promptSystemClient.submitOptimizationSuggestions(suggestions);
            log.info("Pushed {} strategy optimization suggestions", suggestions.size());
        }
    }

    private String buildRecommendation(String strategy, StrategyPerformanceReport report) {
        return switch (strategy) {
            case "FULL_SOLUTION" -> "完整解答策略成效低，建议在小学段降低完整解答频率，增加分步引导";
            case "HINT_ONLY" -> "仅提示策略成效偏低，建议结合知识点回顾提高提示质量";
            case "ANALOGY" -> "类比举例策略未达预期，建议优化类比素材库，使用更贴近学生生活的例子";
            default -> String.format("策略%s成效低于预期(avgΔ=%.4f)，建议检查Prompt模板", 
                strategy, report.getAvgDeltaMastery());
        };
    }
}
```

---

## 13. 安全与隐私

### 13.1 数据脱敏

- 对话内容不存储在本引擎中，仅存储行为特征和评估结果
- 学生ID在汇总报告中做聚合处理，不暴露单次对话内容
- 策略效果统计按学段+学科聚合，不暴露个体数据

### 13.2 权限控制

| 角色 | 可见数据范围 |
|------|------------|
| 学生本人 | 仅自己的成效汇总和趋势 |
| 家长 | 已绑定孩子的成效汇总 |
| 教师 | 班级学生匿名化的成效分布 |
| 教研人员 | 学段+学科维度的策略效果排行（不含学生ID） |
| 平台管理员 | 全量数据（含异常告警和运营指标） |

---

## 14. 测试策略

### 14.1 单元测试重点

| 测试对象 | 测试重点 |
|---------|---------|
| DialoguePatternClassifier | 各模式分类准确率>85%，边界case覆盖 |
| MasteryDeltaCalculator | 窗口计算正确性，对照组校正逻辑 |
| AccuracyDeltaCalculator | 难度补偿计算，小样本降级 |
| CognitiveEngagementScorer | 各维度评分边界值，权重归一化 |
| OverallEffectEvaluator | 多维度缺失时的降级逻辑 |
| StrategyAttributionEngine | 策略归因准确性，样本不足处理 |

### 14.2 集成测试场景

```gherkin
Scenario: 完整成效评估流程（深度学习型对话）
  Given 一个8年级学生进行了一次5轮的数学AI辅导对话
  And 对话涉及知识点"一元二次方程"
  And 对话中出现了2次追问和1次"懂了"信号
  And 对话后3天内有5道相关知识点答题，正确率80%
  And 对话前7天内同类知识点正确率为55%
  When T+1批处理执行成效评估
  Then 对话模式应被分类为"DEEP"
  And ΔAccuracy应约为0.25
  And 综合评级应为"HIGH"或"MEDIUM"
  And 应识别出最有效的AI策略

Scenario: 答案索取型对话识别
  Given 一个10年级学生在晚自习时段连续发起3次AI对话
  And 每次对话仅1-2轮，首条消息即要求"直接给答案"
  And 每次获得答案后在30秒内退出
  When 实时初评执行
  Then 3次对话均应被标记为"ANSWER"模式
  And 应触发"rapidFirePattern"标记
  And 异常模式检测器应生成告警
```

---

## 15. 部署与监控

### 15.1 部署架构

```
                    ┌──────────────────┐
                    │   Kubernetes      │
                    │   Namespace:      │
                    │   edu-effect      │
                    ├──────────────────┤
                    │                  │
                    │  ┌────────────┐  │     ┌───────────┐
                    │  │ API Service│──│─────│  Redis    │
                    │  │ (3 pods)   │  │     │ (缓存查询) │
                    │  └────────────┘  │     └───────────┘
                    │       │          │
                    │  ┌────────────┐  │     ┌───────────┐
                    │  │ Batch Job  │──│─────│ClickHouse │
                    │  │ (CronJob)  │  │     │ (成效仓库) │
                    │  └────────────┘  │     └───────────┘
                    │       │          │
                    │  ┌────────────┐  │     ┌───────────┐
                    │  │ Alert      │──│─────│ PostgreSQL│
                    │  │ Detector   │  │     │ (主数据库) │
                    │  └────────────┘  │     └───────────┘
                    │                  │
                    └──────────────────┘
```

### 15.2 关键监控指标

| 监控项 | 指标 | 告警阈值 |
|--------|------|---------|
| 批处理成功率 | success/total | < 95% |
| 批处理耗时 | 从开始到完成 | > 4小时 |
| KT服务调用失败率 | failed/total | > 5% |
| 实时评估延迟P99 | end-to-end | > 100ms |
| ClickHouse查询延迟P99 | query time | > 500ms |
| Kafka消息积压 | lag | > 10000 |
| 告警发送成功率 | sent/total | < 99% |

---

## 16. 后续演进方向

| 阶段 | 演进方向 | 预期收益 |
|------|---------|---------|
| V1.5 | 引入ML模型替代规则分类器 | 对话模式分类准确率提升至90%+ |
| V2.0 | 因果推断模型替代简单窗口对比 | 更精确地归因学习增量到AI辅导 |
| V2.0 | 多模态行为分析（语音语调、停留热区） | 更丰富的认知参与度信号 |
| V2.5 | 个性化策略推荐（per-student最优策略） | AI辅导成效提升15-20% |
| V3.0 | 教育成效预测（对话中实时预测成效） | 低效对话实时干预和策略切换 |

---

## 附录A: 数据字典

### 对话模式枚举

| 值 | 含义 | 触发条件 |
|----|------|---------|
| DEEP | 深度学习型 | 多轮深度追问，主动建构 |
| VERIFY | 理解验证型 | 请求重解释或换方法后结束 |
| QUICK | 快速答疑型 | 单轮问答获取信息后离开 |
| ANSWER | 答案索取型 | 直接要答案、高频连发、复制粘贴 |
| OFFTOPIC | 偏离学习型 | 无知识点覆盖、无学科上下文 |

### 成效评级枚举

| 值 | 含义 | 评分区间 |
|----|------|---------|
| HIGH | 高成效 | compositeScore >= 0.15 |
| MEDIUM | 中等成效 | 0.05 <= score < 0.15 |
| LOW | 低成效 | -0.05 <= score < 0.05 |
| NONE | 无明显效果 | -0.15 <= score < -0.05 |
| NEGATIVE | 负效果 | score < -0.15 |

### AI教学策略枚举

| 编码 | 名称 | 说明 |
|------|------|------|
| STEP_BY_STEP | 分步讲解 | 将解题过程分解为有序步骤逐一讲解 |
| ANALOGY | 类比举例 | 用生活实例或已学知识类比新概念 |
| SOCRATIC | 苏格拉底式追问 | 通过引导性提问让学生自己发现答案 |
| VISUAL_AID | 图形辅助 | 用图形、图表辅助理解 |
| REAL_WORLD | 生活实例 | 结合真实世界场景讲解 |
| KNOWLEDGE_REVIEW | 旧知回顾 | 先回顾前置知识再讲解新内容 |
| PRACTICE_FIRST | 先练后讲 | 先让学生尝试再讲解 |
| HINT_ONLY | 仅给提示 | 仅提供方向性提示不给出完整解答 |
| FULL_SOLUTION | 完整解答 | 给出完整的解题过程和答案 |
| MULTIPLE_METHODS | 多种解法 | 展示两种以上的解题方法 |

---

## 附录B: 配置参数速查

| 参数 | 默认值 | 说明 |
|------|--------|------|
| effect.pre-window-days | 7 | 对话前数据窗口 |
| effect.post-window-days | 7 | 对话后数据窗口 |
| effect.cooldown-hours | 1 | 掌握度计算冷却期 |
| effect.accuracy-cooldown-hours | 2 | 正确率计算冷却期 |
| effect.accuracy-pre-window-days | 14 | 正确率对比前置窗口 |
| effect.accuracy-post-window-days | 14 | 正确率对比后置窗口 |
| effect.min-sample-size | 3 | 正确率计算最少样本 |
| effect.independence-window-days | 30 | 独立性追踪窗口 |
| effect.reinforcement-delay-days | 7 | 强化评估延迟 |
| effect.reinforcement-window-days | 14 | 强化评估后置窗口 |
| effect.batch-size | 200 | 批处理每批大小 |
| effect.batch-interval-ms | 500 | 批间隔 |
| effect.pattern.threshold.deep | 0.6 | DEEP模式阈值 |
| effect.pattern.threshold.verify | 0.3 | VERIFY模式阈值 |
| effect.alert.answer-seeker.ratio | 0.30 | 答案索取型告警阈值 |
| effect.alert.answer-seeker.wow-increase | 0.15 | 答案索取型环比告警阈值 |
| effect.alert.negative-streak | 5 | 负效果连续次数告警 |

---

*文档结束*
