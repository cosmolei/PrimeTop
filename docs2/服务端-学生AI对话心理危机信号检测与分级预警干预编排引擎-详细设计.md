# 服务端-学生AI对话心理危机信号检测与分级预警干预编排引擎-详细设计

## 1. 概述

### 1.1 功能定位

本引擎负责对学生在 AI 辅导对话中的输入内容进行实时心理风险信号检测，识别可能存在的心理危机迹象（如自我伤害倾向、抑郁情绪、遭受欺凌、极端行为意图等），并根据风险等级触发相应的分级预警与干预流程。

### 1.2 设计目标

| 目标 | 说明 |
| --- | --- |
| **实时检测** | 在 AI 对话流处理管线中完成心理风险信号识别，不增加用户可感知延迟 |
| **分级响应** | 建立 L0-L4 五级风险分类体系，不同等级触发不同干预动作 |
| **隐私保护** | 心理风险数据与学习数据物理隔离，访问需特殊权限 |
| **可审计** | 全流程留痕，干预决策可回溯，支持人工复核与质量评估 |
| **合规优先** | 严格遵循《未成年人保护法》《精神卫生法》《个人信息保护法》等法规要求 |
| **误报管控** | 多级过滤降低误报率，人工复核兜底避免对正常学习对话的干扰 |

### 1.3 适用范围

- 所有学生端 AI 辅导对话（文字、语音转文字内容）
- AI 作文辅导中学生自述内容的心理信号扫描
- 拍题答疑中 OCR 识别文本的附带内容扫描
- 不适用于家长端、教师端的对话（单独的风控策略）

### 1.4 与现有模块的关系

| 现有模块 | 关系说明 |
| --- | --- |
| AI 输入安全与教育对话护栏引擎 | 前置层：过滤违法违规内容；本引擎聚焦心理风险信号 |
| 大模型流式输出实时安全过滤中间件 | 输出侧过滤；本引擎工作在输入侧与对话上下文侧 |
| 学生考试焦虑智能识别与心理调适辅助干预引擎 | 专注考试场景焦虑；本引擎覆盖更广泛的心理危机信号 |
| 学生心理状态建模与学习动机激励策略引擎 | 长期心理画像建模；本引擎提供实时信号输入源 |
| AI 辅导对话情感感知与自适应回应策略引擎 | 情感感知调整 AI 回复风格；本引擎在检测到风险时覆盖正常回复流程 |
| AI 对话安全审计与敏感内容自动上报服务 | 通用安全审计；本引擎输出的事件汇入该服务做统一归档 |

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    AI 对话请求入口                            │
│              (来自 AI 辅导对话 / 作文辅导 / 拍题)               │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              心理风险信号检测管线 (PsychRiskPipeline)          │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │ 规则预筛  │→│ NLP 情感  │→│ 语义意图  │→│ 上下文累积  │ │
│  │ Layer 1  │  │ Layer 2  │  │ Layer 3  │  │ Layer 4    │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘ │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │           风险分级决策器 (RiskClassifier)               │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
     ┌──────────────┐ ┌──────────┐ ┌──────────────┐
     │ 正常流转(L0)  │ │ 风险拦截  │ │ 紧急干预(L4) │
     │ → 继续 AI 回复│ │(L1-L3)   │ │ → 中断对话   │
     └──────────────┘ └─────┬────┘ │ → 启动应急   │
                            │      └──────────────┘
                            ▼
              ┌─────────────────────────────┐
              │   干预编排器 (InterventionOrchestrator)   │
              │                             │
              │  ┌─────────┐ ┌───────────┐ │
              │  │ 温和引导 │ │ 家长通知  │ │
              │  │ (L1)    │ │ (L2-L3)  │ │
              │  └─────────┘ └───────────┘ │
              │  ┌─────────┐ ┌───────────┐ │
              │  │ 人工接管 │ │ 专业资源  │ │
              │  │ (L3)    │ │ 推荐(L2+) │ │
              │  └─────────┘ └───────────┘ │
              └─────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────────┐
              │     事件归档与审计中心        │
              │  (PsychRiskEventStore)      │
              └─────────────────────────────┘
```

### 2.2 核心组件

| 组件 | 职责 | 技术方案 |
| --- | --- | --- |
| PsychRiskPipeline | 多层串联检测管线 | 责任链模式，可插拔扩展 |
| RulePreFilter | Layer 1：关键词与正则规则预筛 | AC自动机 + 正则表达式 |
| NLPEmotionAnalyzer | Layer 2：情感极性与情绪强度分析 | 轻量级BERT情感分类模型 |
| SemanticIntentDetector | Layer 3：深层语义意图识别 | 小型意图分类模型（微调） |
| ContextAccumulator | Layer 4：多轮上下文累积风险评分 | 滑动窗口 + 时间衰减加权 |
| RiskClassifier | 综合四级信号输出最终风险等级 | 规则引擎 + 阈值矩阵 |
| InterventionOrchestrator | 根据风险等级编排干预动作 | 状态机驱动的工作流引擎 |
| PsychRiskEventStore | 事件持久化、审计日志、数据隔离 | 独立数据库 schema + 加密存储 |

---

## 3. 数据结构定义

### 3.1 核心数据表

#### 3.1.1 心理风险事件表 `psych_risk_events`

```sql
CREATE TABLE psych_risk_events (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    event_id        VARCHAR(36) NOT NULL UNIQUE COMMENT '事件唯一ID (UUID)',
    user_id         BIGINT NOT NULL COMMENT '学生用户ID',
    conversation_id VARCHAR(36) NOT NULL COMMENT '关联的AI对话会话ID',
    message_id      VARCHAR(36) COMMENT '触发消息ID',
    
    -- 风险分级
    risk_level      TINYINT NOT NULL COMMENT '风险等级: 0=L0(无风险) 1=L1(低) 2=L2(中) 3=L3(高) 4=L4(紧急)',
    risk_categories JSON NOT NULL COMMENT '风险类别标签数组 ["self_harm","depression","bullying",...]',
    risk_score      DECIMAL(5,2) NOT NULL COMMENT '综合风险评分 0-100',
    
    -- 检测详情
    rule_hits       JSON COMMENT 'Layer1 规则命中详情 [{rule_id, matched_text, score}]',
    emotion_analysis JSON COMMENT 'Layer2 情感分析结果 {polarity, intensity, dominant_emotion}',
    intent_analysis  JSON COMMENT 'Layer3 意图分类结果 {intent, confidence, raw_scores}',
    context_risk     JSON COMMENT 'Layer4 上下文累积 {window_messages, accumulated_score, trend}',
    
    -- 触发的原始内容（加密存储）
    trigger_content_encrypted TEXT COMMENT 'AES-256加密后的触发文本',
    trigger_content_hash      VARCHAR(64) COMMENT '触发内容SHA-256哈希（用于去重）',
    
    -- 干预状态
    intervention_status VARCHAR(32) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/IN_PROGRESS/COMPLETED/ESCALATED/CLOSED',
    intervention_actions JSON COMMENT '已执行的干预动作列表',
    
    -- 时间信息
    detected_at     DATETIME(3) NOT NULL COMMENT '检测时间',
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    
    -- 审计字段
    reviewed_by     BIGINT COMMENT '人工复核人ID',
    reviewed_at     DATETIME(3) COMMENT '复核时间',
    review_result   VARCHAR(32) COMMENT 'TRUE_POSITIVE/FALSE_POSITIVE/INCONCLUSIVE',
    review_notes    TEXT COMMENT '复核备注',
    
    INDEX idx_user_time (user_id, detected_at),
    INDEX idx_level_status (risk_level, intervention_status),
    INDEX idx_conversation (conversation_id),
    INDEX idx_detected (detected_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='心理风险事件表';
```

#### 3.1.2 风险信号词典表 `psych_risk_lexicon`

```sql
CREATE TABLE psych_risk_lexicon (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    term_id         VARCHAR(32) NOT NULL UNIQUE COMMENT '词条ID',
    category        VARCHAR(32) NOT NULL COMMENT '类别: self_harm/depression/anxiety/bullying/violence/eating_disorder/substance/extreme_behavior',
    term_pattern    VARCHAR(256) NOT NULL COMMENT '匹配模式（正则或关键词）',
    term_type       VARCHAR(16) NOT NULL COMMENT 'KEYWORD/REGEX/PHRASE',
    base_score      DECIMAL(4,2) NOT NULL COMMENT '基础风险分 0-10',
    age_adjustment  JSON COMMENT '年龄权重调整 {min_age:weight, max_age:weight}',
    is_active       TINYINT NOT NULL DEFAULT 1,
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    
    INDEX idx_category_active (category, is_active),
    INDEX idx_type (term_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='心理风险信号词典';
```

#### 3.1.3 干预动作记录表 `psych_intervention_actions`

```sql
CREATE TABLE psych_intervention_actions (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    action_id       VARCHAR(36) NOT NULL UNIQUE COMMENT '动作唯一ID',
    event_id        VARCHAR(36) NOT NULL COMMENT '关联风险事件ID',
    user_id         BIGINT NOT NULL COMMENT '学生用户ID',
    
    action_type     VARCHAR(48) NOT NULL COMMENT 'GENTLE_REDIRECT/WARM_REPLY/PARENT_NOTIFY/HUMAN_TAKEOVER/EMERGENCY_PROTOCOL/RESOURCE_RECOMMEND/CALL_HELPLINE',
    action_status   VARCHAR(32) NOT NULL COMMENT 'PENDING/EXECUTING/SUCCESS/FAILED/SKIPPED',
    
    -- 动作参数
    action_params   JSON COMMENT '动作执行参数 {template_id, channel, message_content, ...}',
    
    -- 执行结果
    executed_at     DATETIME(3),
    result_code     VARCHAR(32) COMMENT 'SUCCESS/TIMEOUT/REJECTED/ERROR',
    result_detail   JSON COMMENT '执行详情 {response, error_msg, retry_count}',
    
    -- 审计
    triggered_by    VARCHAR(32) NOT NULL DEFAULT 'SYSTEM' COMMENT 'SYSTEM/MANUAL',
    operator_id     BIGINT COMMENT '手动触发时的操作员ID',
    
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    
    INDEX idx_event (event_id),
    INDEX idx_user_time (user_id, created_at),
    INDEX idx_type_status (action_type, action_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='心理风险干预动作记录表';
```

#### 3.1.4 学生心理风险画像表 `student_psych_profile`

```sql
CREATE TABLE student_psych_profile (
    user_id             BIGINT PRIMARY KEY COMMENT '学生用户ID',
    
    -- 累积风险指标
    total_events        INT NOT NULL DEFAULT 0 COMMENT '历史风险事件总数',
    l4_count            INT NOT NULL DEFAULT 0 COMMENT 'L4紧急事件次数',
    l3_count            INT NOT NULL DEFAULT 0 COMMENT 'L3高危及事件次数',
    l2_count            INT NOT NULL DEFAULT 0 COMMENT 'L2中危及事件次数',
    l1_count            INT NOT NULL DEFAULT 0 COMMENT 'L1低危及事件次数',
    
    -- 时间维度
    first_event_at      DATETIME(3) COMMENT '首次风险事件时间',
    last_event_at       DATETIME(3) COMMENT '最近风险事件时间',
    consecutive_risk_days INT NOT NULL DEFAULT 0 COMMENT '连续风险天数',
    
    -- 风险趋势
    risk_trend          VARCHAR(16) NOT NULL DEFAULT 'STABLE' COMMENT 'INCREASING/DECREASING/STABLE/SPIKE',
    trend_updated_at    DATETIME(3),
    
    -- 累积加权风险分
    cumulative_score    DECIMAL(6,2) NOT NULL DEFAULT 0 COMMENT '时间衰减加权累积风险分',
    
    -- 当前干预状态
    active_intervention TINYINT NOT NULL DEFAULT 0 COMMENT '是否有进行中的干预 0=否 1=是',
    intervention_level  TINYINT COMMENT '当前干预等级',
    cooldown_until      DATETIME(3) COMMENT '冷却期（避免重复干预的截止时间）',
    
    updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    
    INDEX idx_trend (risk_trend),
    INDEX idx_consecutive (consecutive_risk_days DESC),
    INDEX idx_active_intervention (active_intervention)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生心理风险画像';
```

### 3.2 风险类别枚举

```java
public enum PsychRiskCategory {
    SELF_HARM           ("self_harm",           "自我伤害",   10.0),
    SUICIDAL_IDEATION   ("suicidal_ideation",   "自杀意念",   10.0),
    DEPRESSION          ("depression",          "抑郁情绪",    6.0),
    ANXIETY_PANIC       ("anxiety_panic",       "焦虑恐慌",    5.0),
    BULLYING_VICTIM     ("bullying_victim",     "遭受欺凌",    7.0),
    BULLYING_PERP       ("bullying_perp",       "欺凌他人",    6.0),
    EATING_DISORDER     ("eating_disorder",     "进食障碍",    7.0),
    SUBSTANCE_ABUSE     ("substance_abuse",     "物质滥用",    6.0),
    FAMILY_VIOLENCE     ("family_violence",     "家庭暴力",    8.0),
    EXTREME_BEHAVIOR    ("extreme_behavior",    "极端行为",    8.0),
    SLEEP_DISORDER      ("sleep_disorder",      "严重睡眠障碍", 4.0),
    SOCIAL_ISOLATION    ("social_isolation",    "社交隔离",    4.0),
    ACADEMIC_DESPAIR    ("academic_despair",    "学业绝望",    6.0);

    private final String code;
    private final String label;
    private final double baseScore;  // 类别基础风险分

    // constructor, getters...
}
```

### 3.3 风险等级定义

```java
public enum RiskLevel {
    /**
     * L0 - 无风险
     * 正常学习对话，无需特殊处理
     */
    L0_NORMAL(0, "无风险", 0, 20),

    /**
     * L1 - 低风险
     * 出现轻微负面情绪表达，但不构成危机
     * 干预：AI 回复中融入温暖关怀语，记录但不通知
     */
    L1_LOW(1, "低风险", 20, 40),

    /**
     * L2 - 中风险
     * 持续负面情绪、轻度自我贬低、社交退缩信号
     * 干预：AI 切换关怀模式，推荐心理调适内容，通知家长关注
     */
    L2_MEDIUM(2, "中风险", 40, 65),

    /**
     * L3 - 高风险
     * 明确的求助信号、自我伤害暗示、严重欺凌迹象
     * 干预：中断AI对话，人工客服接管，紧急通知家长
     */
    L3_HIGH(3, "高风险", 65, 85),

    /**
     * L4 - 紧急
     * 明确的自伤/自杀意图、正在发生的暴力、紧急危险
     * 干预：立即中断对话，启动应急协议，推送给危机干预团队
     */
    L4_EMERGENCY(4, "紧急", 85, 100);

    private final int level;
    private final String label;
    private final double lowerBound;
    private final double upperBound;

    // constructor, getters...

    public static RiskLevel fromScore(double score) {
        for (RiskLevel rl : values()) {
            if (score >= rl.lowerBound && score < rl.upperBound) {
                return rl;
            }
        }
        return score >= 100 ? L4_EMERGENCY : L0_NORMAL;
    }
}
```

---

## 4. 检测管线详细设计

### 4.1 Layer 1：规则预筛（RulePreFilter）

**目标**：以极低延迟（<5ms）过滤出明确包含高风险关键词/短语的消息，直接进入快速通道；对大多数正常消息快速放行。

#### 4.1.1 匹配策略

```java
public class RulePreFilter implements RiskDetectionLayer {

    private final AhoCorasickAutomaton keywordMatcher;  // AC自动机
    private final List<CompiledRegex> regexRules;
    private final PsychRiskLexiconService lexiconService;

    /**
     * AC自动机匹配高风险关键词，正则匹配组合短语
     * 返回所有命中的规则及其基础分
     */
    @Override
    public LayerResult detect(DetectionContext ctx) {
        String text = ctx.getNormalizedText();
        List<RuleHit> hits = new ArrayList<>();

        // 1. AC自动机关键词匹配（O(n) 时间复杂度）
        List<MatchResult> keywordMatches = keywordMatcher.match(text);
        for (MatchResult m : keywordMatches) {
            PsychRiskLexiconEntry entry = lexiconService.getById(m.getTermId());
            double score = calculateAdjustedScore(entry, ctx);
            hits.add(new RuleHit(entry.getCategory(), m.getMatchedText(), score, entry.getTermId()));
        }

        // 2. 正则规则匹配（仅当关键词命中数 >= 1 或文本长度 < 50 时执行）
        if (!hits.isEmpty() || text.length() < 50) {
            for (CompiledRegex regex : regexRules) {
                if (regex.matches(text)) {
                    hits.add(new RuleHit(regex.getCategory(), regex.getMatchedFragment(text),
                                        regex.getScore(), regex.getRuleId()));
                }
            }
        }

        double layerScore = hits.stream().mapToDouble(RuleHit::getScore).max().orElse(0);
        return LayerResult.builder()
            .layerName("RULE_PRE_FILTER")
            .hits(hits)
            .layerScore(layerScore)
            .passed(hits.isEmpty())
            .processingTimeMs(TimeUtils.elapsedMs(ctx.getStartTime()))
            .build();
    }

    private double calculateAdjustedScore(PsychRiskLexiconEntry entry, DetectionContext ctx) {
        double score = entry.getBaseScore();
        // 年龄调整：低龄学生出现高风险词汇时权重更高
        int age = ctx.getStudentAge();
        if (age <= 12 && entry.getCategory().startsWith("self_harm")) {
            score *= 1.2;  // 12岁以下出现自伤词汇，风险加重
        }
        return Math.min(score, 10.0);
    }
}
```

#### 4.1.2 词典示例数据

```sql
-- 自伤类关键词
INSERT INTO psych_risk_lexicon (term_id, category, term_pattern, term_type, base_score) VALUES
('SH-001', 'self_harm', '割腕', 'KEYWORD', 9.0),
('SH-002', 'self_harm', '不想活了', 'PHRASE', 9.5),
('SH-003', 'self_harm', '想死', 'KEYWORD', 9.0),
('SH-004', 'self_harm', '活着没意思', 'PHRASE', 8.0),
('SH-005', 'self_harm', '伤害自己', 'PHRASE', 8.5),
('SH-006', 'self_harm', '了结', 'KEYWORD', 7.5),
('SH-007', 'self_harm', '(割|划|烫)自己的', 'REGEX', 9.0),
('SH-008', 'self_harm', '写遗书', 'PHRASE', 10.0);

-- 抑郁类关键词
INSERT INTO psych_risk_lexicon (term_id, category, term_pattern, term_type, base_score) VALUES
('DP-001', 'depression', '没人在乎我', 'PHRASE', 6.0),
('DP-002', 'depression', '我是多余的', 'PHRASE', 7.0),
('DP-003', 'depression', '什么都提不起兴趣', 'PHRASE', 5.0),
('DP-004', 'depression', '好累好想消失', 'PHRASE', 7.5),
('DP-005', 'depression', '没有人喜欢我', 'PHRASE', 5.5);

-- 欺凌类关键词
INSERT INTO psych_risk_lexicon (term_id, category, term_pattern, term_type, base_score) VALUES
('BL-001', 'bullying_victim', '被打', 'KEYWORD', 6.0),
('BL-002', 'bullying_victim', '被欺负', 'PHRASE', 7.0),
('BL-003', 'bullying_victim', '被孤立', 'PHRASE', 6.0),
('BL-004', 'bullying_victim', '没有人跟我玩', 'PHRASE', 5.0),
('BL-005', 'bullying_victim', '他们嘲笑我', 'PHRASE', 5.5);

-- 学业绝望类
INSERT INTO psych_risk_lexicon (term_id, category, term_pattern, term_type, base_score) VALUES
('AD-001', 'academic_despair', '考不上活着还有什么意义', 'PHRASE', 9.5),
('AD-002', 'academic_despair', '成绩这么差不配活着', 'PHRASE', 9.0),
('AD-003', 'academic_despair', '让父母失望想去死', 'PHRASE', 10.0);
```

### 4.2 Layer 2：NLP 情感分析（NLPEmotionAnalyzer）

**目标**：对通过规则预筛但需要进一步分析的消息，或规则预筛得分处于边界区的消息，进行情感极性和情绪强度分析。

#### 4.2.1 模型选择

| 方案 | 模型 | 延迟 | 准确率 | 适用场景 |
| --- | --- | --- | --- | --- |
| 方案A（推荐） | 微调版 BERT-tiny (4层) | ~15ms | 87% | 本地部署，满足实时性 |
| 方案B | DistilBERT + 情感头 | ~25ms | 90% | 准确率更高 |
| 方案C | 轻量LSTM + Attention | ~8ms | 83% | 极低延迟场景 |

推荐方案A，在延迟和准确率之间取得平衡，模型大小约 15MB，可通过 ONNX Runtime 在 CPU 上高效推理。

#### 4.2.2 情感分析实现

```java
public class NLPEmotionAnalyzer implements RiskDetectionLayer {

    private final OnnxEmotionModel emotionModel;  // ONNX 模型
    private static final double EXECUTION_THRESHOLD = 15.0;  // Layer1 score >= 15 时执行

    @Override
    public LayerResult detect(DetectionContext ctx) {
        LayerResult prevLayer = ctx.getLayerResult("RULE_PRE_FILTER");

        // 优化：Layer 1 无任何命中且文本无明显负面情感特征时跳过
        if (prevLayer != null && prevLayer.getLayerScore() < 5.0
                && !hasNegativeEmotionCue(ctx.getNormalizedText())) {
            return LayerResult.skipped("NLP_EMOTION_ANALYZER");
        }

        // 模型推理
        EmotionPrediction prediction = emotionModel.predict(ctx.getNormalizedText());

        // 将情感结果映射为风险分
        double riskScore = mapEmotionToRisk(prediction);

        return LayerResult.builder()
            .layerName("NLP_EMOTION_ANALYZER")
            .layerScore(riskScore)
            .detail(EmotionAnalysisDTO.builder()
                .polarity(prediction.getPolarity())        // POSITIVE/NEUTRAL/NEGATIVE
                .intensity(prediction.getIntensity())       // 0-1
                .dominantEmotion(prediction.getDominant())  // SAD/ANGRY/FEARFUL/HOPELESS/ANXIOUS
                .build())
            .passed(riskScore < EXECUTION_THRESHOLD)
            .processingTimeMs(prediction.getInferenceTimeMs())
            .build();
    }

    private double mapEmotionToRisk(EmotionPrediction pred) {
        if (pred.getPolarity() == EmotionPolarity.POSITIVE) {
            return 0;
        }

        double base = switch (pred.getDominantEmotion()) {
            case HOPELESS -> 40 + pred.getIntensity() * 35;   // 绝望感 → 高风险
            case SAD      -> 15 + pred.getIntensity() * 25;   // 悲伤 → 中低风险
            case FEARFUL  -> 20 + pred.getIntensity() * 30;   // 恐惧 → 中高风险
            case ANXIOUS  -> 10 + pred.getIntensity() * 20;   // 焦虑 → 低中风险
            case ANGRY    -> 5  + pred.getIntensity() * 15;   // 愤怒 → 低风险
            default       -> pred.getIntensity() * 10;
        };

        return Math.min(base, 80);  // 本层最高输出80，L4级别由多层累积触发
    }

    /**
     * 快速判断是否有可能包含负面情感（避免对所有消息调用模型）
     */
    private boolean hasNegativeEmotionCue(String text) {
        // 使用预构建的负面情感指示词列表（约200词）
        for (String cue : NEGATIVE_CUE_WORDS) {
            if (text.contains(cue)) return true;
        }
        return false;
    }

    private static final Set<String> NEGATIVE_CUE_WORDS = Set.of(
        "难过", "伤心", "哭", "害怕", "怕", "讨厌", "烦", "累", "压力",
        "孤独", "寂寞", "绝望", "崩溃", "撑不住", "不想", "讨厌自己",
        "失败", "没用", "废物", "丢人", "配不上", "对不起"
    );
}
```

### 4.3 Layer 3：语义意图检测（SemanticIntentDetector）

**目标**：对情感分析后仍存在风险的消息，使用更强的模型进行深层语义意图识别，判断消息是否真正包含心理危机意图。

#### 4.3.1 意图分类体系

```
PsychRiskIntent (心理风险意图分类)
├── CRISIS_SIGNAL        危机信号（自伤/自杀直接表达）
├── HELP_SEEKING         求助信号（间接表达痛苦，希望得到帮助）
├── EMOTIONAL_VENTING    情感宣泄（表达负面情绪但无危机意图）
├── ACADEMIC_FRUSTRATION 学业挫折（对学习困难的表达，非心理危机）
├── CASUAL_MENTION       随意提及（非严肃语境下的词语出现）
├── QUOTING_CONTENT      引用内容（引用课文、歌词等非自我表达）
└── SAFE                 安全（无任何风险意图）
```

#### 4.3.2 意图分类实现

```java
public class SemanticIntentDetector implements RiskDetectionLayer {

    private final IntentClassificationModel intentModel;
    private static final double EXECUTION_THRESHOLD = 25.0;

    @Override
    public LayerResult detect(DetectionContext ctx) {
        LayerResult emotionResult = ctx.getLayerResult("NLP_EMOTION_ANALYZER");
        LayerResult ruleResult = ctx.getLayerResult("RULE_PRE_FILTER");

        double combinedScore = Math.max(
            emotionResult != null ? emotionResult.getLayerScore() : 0,
            ruleResult != null ? ruleResult.getLayerScore() : 0
        );

        // 只有前层累积分数超过阈值才执行此层（节省计算资源）
        if (combinedScore < EXECUTION_THRESHOLD) {
            return LayerResult.skipped("SEMANTIC_INTENT_DETECTOR");
        }

        // 构建上下文 prompt 进行意图分类
        IntentPrediction prediction = intentModel.classify(
            ctx.getNormalizedText(),
            ctx.getRecentContextMessages(3)  // 最近3轮对话作为上下文
        );

        // 意图到风险分的映射
        double riskScore = mapIntentToRisk(prediction);

        return LayerResult.builder()
            .layerName("SEMANTIC_INTENT_DETECTOR")
            .layerScore(riskScore)
            .detail(IntentAnalysisDTO.builder()
                .intent(prediction.getIntent())
                .confidence(prediction.getConfidence())
                .rawScores(prediction.getAllScores())
                .build())
            .processingTimeMs(prediction.getInferenceTimeMs())
            .build();
    }

    private double mapIntentToRisk(IntentPrediction pred) {
        return switch (pred.getIntent()) {
            case CRISIS_SIGNAL        -> 70 + pred.getConfidence() * 25;   // 70-95
            case HELP_SEEKING         -> 35 + pred.getConfidence() * 30;   // 35-65
            case EMOTIONAL_VENTING    -> 10 + pred.getConfidence() * 20;   // 10-30
            case ACADEMIC_FRUSTRATION -> 5  + pred.getConfidence() * 10;    // 5-15
            case CASUAL_MENTION       -> 0;
            case QUOTING_CONTENT      -> 0;
            case SAFE                 -> 0;
        };
    }
}
```

### 4.4 Layer 4：上下文累积分析（ContextAccumulator）

**目标**：综合多轮对话的历史信号，避免仅凭单条消息误判，识别渐进式风险升级模式。

#### 4.4.1 滑动窗口机制

```java
public class ContextAccumulator implements RiskDetectionLayer {

    private final PsychRiskEventStore eventStore;
    private static final int WINDOW_SIZE = 10;          // 滑动窗口：最近10条消息
    private static final int TIME_WINDOW_HOURS = 24;    // 时间窗口：24小时内
    private static final double DECAY_FACTOR = 0.85;    // 时间衰减因子

    @Override
    public LayerResult detect(DetectionContext ctx) {
        // 获取最近窗口内的检测历史
        List<RiskDetectionRecord> recentRecords = eventStore.getRecentDetections(
            ctx.getUserId(),
            ctx.getConversationId(),
            WINDOW_SIZE,
            TIME_WINDOW_HOURS
        );

        // 计算累积风险分（指数衰减加权）
        double accumulatedScore = 0;
        double accumulatedWeight = 0;
        String trend = "STABLE";

        for (int i = 0; i < recentRecords.size(); i++) {
            double weight = Math.pow(DECAY_FACTOR, i);  // 越近的记录权重越高
            accumulatedScore += recentRecords.get(i).getMaxLayerScore() * weight;
            accumulatedWeight += weight;
        }
        double contextScore = accumulatedWeight > 0 ? accumulatedScore / accumulatedWeight : 0;

        // 检测趋势
        if (recentRecords.size() >= 3) {
            trend = analyzeTrend(recentRecords);
        }

        // 检测突然飙升
        if (recentRecords.size() >= 2) {
            double latest = recentRecords.get(0).getMaxLayerScore();
            double previous = recentRecords.get(1).getMaxLayerScore();
            if (latest > 60 && previous < 30) {
                trend = "SPIKE";
                contextScore *= 1.3;  // 突然飙升时加权
            }
        }

        // 连续风险信号计数
        long consecutiveRiskyMessages = recentRecords.stream()
            .takeWhile(r -> r.getMaxLayerScore() >= 20)
            .count();

        // 连续多条风险消息时升级
        if (consecutiveRiskyMessages >= 3) {
            contextScore = Math.min(contextScore * 1.2, 90);
        }

        return LayerResult.builder()
            .layerName("CONTEXT_ACCUMULATOR")
            .layerScore(Math.min(contextScore, 95))
            .detail(ContextRiskDTO.builder()
                .windowMessages(recentRecords.size())
                .accumulatedScore(contextScore)
                .trend(trend)
                .consecutiveRiskyCount((int) consecutiveRiskyMessages)
                .build())
            .processingTimeMs(TimeUtils.elapsedMs(ctx.getStartTime()))
            .build();
    }

    private String analyzeTrend(List<RiskDetectionRecord> records) {
        // 线性回归斜率判断趋势
        double[] scores = records.stream()
            .mapToDouble(RiskDetectionRecord::getMaxLayerScore)
            .toArray();
        double slope = linearRegressionSlope(scores);

        if (slope > 3) return "INCREASING";
        if (slope < -3) return "DECREASING";
        return "STABLE";
    }
}
```

### 4.5 风险分级决策器（RiskClassifier）

```java
public class RiskClassifier {

    /**
     * 综合四层检测结果，输出最终风险等级
     */
    public RiskDecision classify(DetectionContext ctx) {
        LayerResult l1 = ctx.getLayerResult("RULE_PRE_FILTER");
        LayerResult l2 = ctx.getLayerResult("NLP_EMOTION_ANALYZER");
        LayerResult l3 = ctx.getLayerResult("SEMANTIC_INTENT_DETECTOR");
        LayerResult l4 = ctx.getLayerResult("CONTEXT_ACCUMULATOR");

        // 收集所有命中的风险类别
        Set<String> categories = new HashSet<>();
        if (l1 != null) l1.getHits().forEach(h -> categories.add(h.getCategory()));

        // === 规则1：L4 紧急快捷通道 ===
        // 规则层直接命中自杀/自伤极高危关键词且意图层确认为危机信号
        boolean hasImminentRisk = categories.contains("self_harm")
                || categories.contains("suicidal_ideation");
        boolean intentConfirmed = l3 != null && l3.getDetail() != null
                && ((IntentAnalysisDTO) l3.getDetail()).getIntent() == PsychRiskIntent.CRISIS_SIGNAL;

        if (hasImminentRisk && intentConfirmed) {
            return RiskDecision.builder()
                .riskLevel(RiskLevel.L4_EMERGENCY)
                .finalScore(95.0)
                .categories(categories)
                .reason("L4_FAST_PATH: imminent risk keyword + crisis intent confirmed")
                .build();
        }

        // === 规则2：综合评分 ===
        // 取四层中的最高分作为基础分，上下文累积作为调节
        double maxScore = Stream.of(l1, l2, l3, l4)
            .filter(Objects::nonNull)
            .mapToDouble(LayerResult::getLayerScore)
            .max()
            .orElse(0);

        // 上下文调节：如果趋势是 INCREASING 或 SPIKE，上调风险分
        double adjustedScore = maxScore;
        if (l4 != null && l4.getDetail() != null) {
            ContextRiskDTO ctxRisk = (ContextRiskDTO) l4.getDetail();
            if ("SPIKE".equals(ctxRisk.getTrend())) {
                adjustedScore = Math.min(maxScore * 1.15, 100);
            } else if ("INCREASING".equals(ctxRisk.getTrend())
                    && ctxRisk.getConsecutiveRiskyCount() >= 3) {
                adjustedScore = Math.min(maxScore * 1.1, 100);
            }
        }

        // === 规则3：降级保护 ===
        // 如果意图层明确判断为 QUOTING_CONTENT（引用课文/歌词）或 CASUAL_MENTION
        // 且上下文无累积风险，则降级
        if (l3 != null && l3.getDetail() != null) {
            PsychRiskIntent intent = ((IntentAnalysisDTO) l3.getDetail()).getIntent();
            if ((intent == PsychRiskIntent.QUOTING_CONTENT
                    || intent == PsychRiskIntent.CASUAL_MENTION)
                    && (l4 == null || l4.getLayerScore() < 20)) {
                adjustedScore *= 0.3;
            }
        }

        RiskLevel finalLevel = RiskLevel.fromScore(adjustedScore);

        return RiskDecision.builder()
            .riskLevel(finalLevel)
            .finalScore(adjustedScore)
            .categories(categories)
            .layerScores(Map.of(
                "L1_RULE",     l1 != null ? l1.getLayerScore() : 0,
                "L2_EMOTION",  l2 != null ? l2.getLayerScore() : 0,
                "L3_INTENT",   l3 != null ? l3.getLayerScore() : 0,
                "L4_CONTEXT",  l4 != null ? l4.getLayerScore() : 0
            ))
            .reason(String.format("Composite: max=%.1f adjusted=%.1f level=%s",
                    maxScore, adjustedScore, finalLevel))
            .build();
    }
}
```

---

## 5. 干预编排器详细设计

### 5.1 干预动作矩阵

| 风险等级 | 动作类型 | 目标 | 执行时机 | 通道 |
| --- | --- | --- | --- | --- |
| L0 | 无 | 正常流转 | - | - |
| L1 | GENTLE_REDIRECT | AI 回复中融入关怀语 | 同步 | AI 对话流 |
| L1 | LOG_ONLY | 记录事件，不做外部通知 | 异步 | 事件存储 |
| L2 | WARM_REPLY | AI 切换温暖关怀模式 | 同步 | AI 对话流 |
| L2 | RESOURCE_RECOMMEND | 推荐心理调适内容 | 同步 | AI 对话流 |
| L2 | PARENT_NOTIFY | 通知家长关注孩子情绪 | 异步 | 推送/站内信 |
| L3 | BLOCK_REPLY | 中断 AI 自动回复 | 同步 | 对话流 |
| L3 | HUMAN_TAKEOVER | 人工客服接管对话 | 同步 | 对话流切换 |
| L3 | PARENT_URGENT | 紧急通知家长 | 异步（<1min） | 短信+推送 |
| L3 | RESOURCE_RECOMMEND | 推荐专业心理资源 | 同步 | 对话流 |
| L4 | EMERGENCY_PROTOCOL | 启动应急协议 | 同步（立即） | 多通道 |
| L4 | PARENT_EMERGENCY | 紧急联系家长 | 立即 | 电话+短信 |
| L4 | HELPLINE_PUSH | 推送心理援助热线 | 同步 | 对话流 + 全屏 |
| L4 | STAFF_ALERT | 值班安全人员告警 | 立即 | 内部告警系统 |

### 5.2 干预状态机

```
                       ┌─────────┐
         新事件到达 ──→ │ PENDING │
                       └────┬────┘
                            │
                  ┌─────────┼──────────┐
                  │         │          │
                  ▼         ▼          ▼
           ┌──────────┐ ┌────────┐ ┌───────────┐
           │L1:LIGHT  │ │L2:MID │ │L3/L4:URGENT│
           │_TOUCH    │ │_TOUCH │ │_TOUCH     │
           └─────┬────┘ └───┬───┘ └─────┬─────┘
                 │          │           │
                 ▼          ▼           ▼
           ┌──────────┐ ┌────────┐ ┌───────────┐
           │ AI回复   │ │AI关怀+ │ │中断AI+人工│
           │ +关怀    │ │家长通知│ │接管+家长  │
           │ 融合     │ │        │ │紧急通知   │
           └─────┬────┘ └───┬───┘ └─────┬─────┘
                 │          │           │
                 │          │    ┌──────┼──────┐
                 │          │    │      │      │
                 │          │    ▼      ▼      ▼
                 │          │  ┌────┐ ┌────┐ ┌─────┐
                 │          │  │人工│ │家长│ │热线│
                 │          │  │接管│ │响应│ │推送│
                 │          │  └──┬─┘ └──┬─┘ └──┬──┘
                 │          │     │      │      │
                 ▼          ▼     ▼      ▼      ▼
           ┌────────────────────────────────────────┐
           │              IN_PROGRESS               │
           └───────────────────┬────────────────────┘
                               │
                               ▼
           ┌────────────────────────────────────────┐
           │    人工复核 → COMPLETED / ESCALATED     │
           └───────────────────┬────────────────────┘
                               │
                               ▼
           ┌────────────────────────────────────────┐
           │                CLOSED                   │
           └────────────────────────────────────────┘
```

### 5.3 干预编排器实现

```java
public class InterventionOrchestrator {

    private final PsychRiskEventStore eventStore;
    private final ParentNotificationService parentNotifyService;
    private final HumanTakeoverService takeoverService;
    private final AIReplyInterceptor replyInterceptor;
    private final StaffAlertService staffAlertService;
    private final WarmReplyTemplateService templateService;

    /**
     * 根据风险决策编排干预动作
     */
    public InterventionResult orchestrate(RiskDecision decision, DetectionContext ctx) {
        String eventId = UUID.randomUUID().toString();
        Long userId = ctx.getUserId();

        // 创建风险事件记录
        PsychRiskEvent event = PsychRiskEvent.builder()
            .eventId(eventId)
            .userId(userId)
            .conversationId(ctx.getConversationId())
            .riskLevel(decision.getRiskLevel().getLevel())
            .riskCategories(new ArrayList<>(decision.getCategories()))
            .riskScore(decision.getFinalScore())
            .triggerContentEncrypted(encrypt(ctx.getRawText(), userId))
            .interventionStatus("IN_PROGRESS")
            .detectedAt(LocalDateTime.now())
            .build();
        eventStore.save(event);

        List<InterventionAction> executedActions = new ArrayList<>();

        switch (decision.getRiskLevel()) {
            case L1_LOW -> executedActions.addAll(handleL1(event, ctx));
            case L2_MEDIUM -> executedActions.addAll(handleL2(event, ctx));
            case L3_HIGH -> executedActions.addAll(handleL3(event, ctx));
            case L4_EMERGENCY -> executedActions.addAll(handleL4(event, ctx));
            default -> { /* L0: 无需干预 */ }
        }

        // 更新学生心理风险画像
        updateStudentProfile(userId, decision);

        return InterventionResult.builder()
            .eventId(eventId)
            .actions(executedActions)
            .build();
    }

    // ============ L1: 低风险干预 ============
    private List<InterventionAction> handleL1(PsychRiskEvent event, DetectionContext ctx) {
        List<InterventionAction> actions = new ArrayList<>();

        // 动作1：AI 回复中融入关怀前缀
        String warmPrefix = templateService.getRandomTemplate("WARM_PREFIX_L1");
        // 例如："我注意到你最近可能有些压力。不管怎样，我都在这里陪你一起学习。"
        replyInterceptor.injectPrefix(ctx.getConversationId(), warmPrefix);

        actions.add(recordAction(event, "GENTLE_REDIRECT", warmPrefix));

        // 动作2：记录事件（不通知外部）
        actions.add(recordAction(event, "LOG_ONLY", null));

        return actions;
    }

    // ============ L2: 中风险干预 ============
    private List<InterventionAction> handleL2(PsychRiskEvent event, DetectionContext ctx) {
        List<InterventionAction> actions = new ArrayList<>();

        // 动作1：切换 AI 为温暖关怀模式
        replyInterceptor.switchMode(ctx.getConversationId(), AIReplyMode.WARM_CARE);
        actions.add(recordAction(event, "WARM_REPLY", Map.of("mode", "WARM_CARE")));

        // 动作2：在 AI 回复末尾附上心理调适建议
        String careTip = templateService.getTemplate("CARE_TIP_L2");
        // 例如："如果感到压力很大，可以试试深呼吸放松，或者跟信任的人聊聊。你的感受很重要。"
        replyInterceptor.injectSuffix(ctx.getConversationId(), careTip);
        actions.add(recordAction(event, "RESOURCE_RECOMMEND", careTip));

        // 动作3：异步通知家长（冷却期检查）
        if (!isInCooldown(ctx.getUserId(), NotificationType.PARENT_NOTIFY)) {
            ParentNotificationResult result = parentNotifyService.sendSoftNotification(
                ctx.getUserId(),
                ParentNotifyTemplate.SOFT_EMOTIONAL_CONCERN,
                // "您的孩子近期在学习中可能有一些情绪波动，建议多关注、多倾听。"
                Map.of("studentName", ctx.getStudentName(),
                       "timeRange", ctx.getTimeRangeDescription())
            );
            actions.add(recordAction(event, "PARENT_NOTIFY", result));
            setCooldown(ctx.getUserId(), NotificationType.PARENT_NOTIFY,
                       Duration.ofHours(12));  // 12小时内不重复通知
        } else {
            actions.add(recordSkippedAction(event, "PARENT_NOTIFY", "IN_COOLDOWN"));
        }

        return actions;
    }

    // ============ L3: 高风险干预 ============
    private List<InterventionAction> handleL3(PsychRiskEvent event, DetectionContext ctx) {
        List<InterventionAction> actions = new ArrayList<>();

        // 动作1：阻断 AI 自动回复
        replyInterceptor.blockReply(ctx.getConversationId(),
            "我注意到你提到的内容让我有些担心。让我为你转接一位专业的辅导员，他们会更好地帮助你。");
        actions.add(recordAction(event, "BLOCK_REPLY", null));

        // 动作2：人工客服接管
        TakeoverResult takeover = takeoverService.requestTakeover(
            ctx.getUserId(),
            ctx.getConversationId(),
            TakeoverPriority.HIGH,
            event.getRiskCategories()
        );
        actions.add(recordAction(event, "HUMAN_TAKEOVER", takeover));

        // 动作3：紧急通知家长（无冷却期限制）
        ParentNotificationResult urgentResult = parentNotifyService.sendUrgentNotification(
            ctx.getUserId(),
            ParentNotifyTemplate.URGENT_PSYCHOLOGICAL_CONCERN,
            // "我们关注到您的孩子在使用学习软件时表达了一些令人担忧的内容，建议您尽快与孩子沟通。"
            Map.of("studentName", ctx.getStudentName(),
                   "eventTime", ctx.getDetectedAt().toString(),
                   "suggestion", "请尽快与孩子进行温和的沟通，倾听他们的感受")
        );
        actions.add(recordAction(event, "PARENT_URGENT", urgentResult));

        // 动作4：推送心理援助资源
        String resourceCard = templateService.getTemplate("PSYCH_RESOURCE_L3");
        // 包含全国心理援助热线 400-161-9995、北京心理危机研究与干预中心 010-82951332 等
        replyInterceptor.injectCard(ctx.getConversationId(), resourceCard);
        actions.add(recordAction(event, "RESOURCE_RECOMMEND", resourceCard));

        return actions;
    }

    // ============ L4: 紧急干预 ============
    private List<InterventionAction> handleL4(PsychRiskEvent event, DetectionContext ctx) {
        List<InterventionAction> actions = new ArrayList<>();

        // 动作1：立即中断 AI 对话
        replyInterceptor.emergencyHalt(ctx.getConversationId(),
            "我非常关心你现在的安全。你很重要，有人愿意帮助你。\n\n" +
            "请立即拨打 24 小时心理援助热线：400-161-9995\n" +
            "或北京心理危机研究与干预中心：010-82951332\n\n" +
            "如果你正在面临紧急危险，请立即拨打 110 或 120。"
        );
        actions.add(recordAction(event, "EMERGENCY_PROTOCOL", null));

        // 动作2：全屏弹窗推送热线信息
        replyInterceptor.pushFullScreenAlert(ctx.getUserId(),
            EmergencyAlertTemplate.SELF_HARM_HOTLINE);
        actions.add(recordAction(event, "HELPLINE_PUSH", EmergencyAlertTemplate.SELF_HARM_HOTLINE));

        // 动作3：值班安全人员告警（内部系统）
        StaffAlert alert = staffAlertService.sendEmergencyAlert(
            StaffAlertBuilder.create()
                .eventId(event.getEventId())
                .userId(ctx.getUserId())
                .studentName(ctx.getStudentName())
                .studentAge(ctx.getStudentAge())
                .riskLevel(4)
                .categories(event.getRiskCategories())
                .detectedAt(event.getDetectedAt())
                .conversationId(ctx.getConversationId())
                .build()
        );
        actions.add(recordAction(event, "STAFF_ALERT", alert));

        // 动作4：紧急联系家长（电话 + 短信）
        ParentEmergencyContactResult contactResult = parentNotifyService.emergencyContact(
            ctx.getUserId(),
            ParentNotifyTemplate.EMERGENCY_psychological_RISK,
            // 【紧急】您的孩子在使用学习软件时表达了可能危害自身安全的内容，
            // 请您立即关注并与孩子沟通。如情况紧急请拨打110或120。
            // 心理援助热线：400-161-9995
            Map.of("studentName", ctx.getStudentName(),
                   "eventTime", ctx.getDetectedAt().toString(),
                   "hotline", "400-161-9995")
        );
        actions.add(recordAction(event, "PARENT_EMERGENCY", contactResult));

        // 动作5：触发人工接管（最高优先级）
        takeoverService.requestEmergencyTakeover(
            ctx.getUserId(),
            ctx.getConversationId(),
            event
        );
        actions.add(recordAction(event, "HUMAN_TAKEOVER",
            Map.of("priority", "EMERGENCY")));

        return actions;
    }
}
```

---

## 6. API 接口设计

### 6.1 对外 API

#### 6.1.1 检测请求（内部调用）

**此接口由 AI 对话管线内部调用，不对外暴露。**

```
POST /internal/v1/psych-risk/detect
Content-Type: application/json

Request:
{
  "userId": 10002345,
  "conversationId": "conv-uuid-xxx",
  "messageId": "msg-uuid-xxx",
  "text": "我真的很没用，什么都做不好，活着好累",
  "source": "AI_TUTOR_DIALOG",   // AI_TUTOR_DIALOG / ESSAY_TUTORING / OCR_SCAN
  "studentAge": 14,
  "studentGrade": "初三",
  "recentMessages": [             // 最近2-3轮对话上下文
    {"role": "user", "content": "这次考试又没考好"},
    {"role": "assistant", "content": "没关系，考试失利是学习中的正常经历..."}
  ]
}

Response:
{
  "eventId": "evt-uuid-xxx",
  "riskLevel": 3,                  // 0-4
  "riskScore": 72.5,
  "categories": ["depression", "academic_despair"],
  "decision": "BLOCK_AND_INTERVENE",  // PASS_THROUGH / INJECT_PREFIX / SWITCH_MODE / BLOCK_AND_INTERVENE / EMERGENCY_HALT
  "replyOverride": "我注意到你提到的内容让我有些担心...",   // 当 decision 需要覆盖回复时
  "actions": [
    {
      "type": "HUMAN_TAKEOVER",
      "status": "EXECUTING"
    },
    {
      "type": "PARENT_URGENT",
      "status": "PENDING"
    }
  ],
  "processingTimeMs": 48
}
```

#### 6.1.2 管理后台：风险事件列表

```
GET /admin/v1/psych-risk/events
Authorization: Bearer <admin_token>

Query Parameters:
  - page (default 1)
  - size (default 20)
  - riskLevel (optional: 1-4)
  - status (optional: PENDING/IN_PROGRESS/COMPLETED/CLOSED)
  - category (optional)
  - startDate (ISO date)
  - endDate (ISO date)
  - userId (optional)
  - sort (default: detectedAt,desc)

Response:
{
  "total": 156,
  "page": 1,
  "data": [
    {
      "eventId": "evt-uuid-xxx",
      "userId": 10002345,
      "userName": "张*三",
      "userGrade": "初三",
      "riskLevel": 3,
      "riskScore": 72.5,
      "categories": ["depression", "academic_despair"],
      "interventionStatus": "IN_PROGRESS",
      "detectedAt": "2026-07-30T10:23:45.123Z",
      "reviewed": false
    }
  ]
}
```

#### 6.1.3 管理后台：事件详情

```
GET /admin/v1/psych-risk/events/{eventId}
Authorization: Bearer <admin_token>

Response:
{
  "eventId": "evt-uuid-xxx",
  "userId": 10002345,
  "conversationId": "conv-uuid-xxx",
  "riskLevel": 3,
  "riskScore": 72.5,
  "categories": ["depression", "academic_despair"],

  "layerBreakdown": {
    "L1_RULE": {"score": 35.0, "hits": [{"category": "depression", "matchedText": "***", "score": 7.0}]},
    "L2_EMOTION": {"score": 45.0, "polarity": "NEGATIVE", "dominantEmotion": "HOPELESS", "intensity": 0.82},
    "L3_INTENT": {"score": 68.0, "intent": "HELP_SEEKING", "confidence": 0.91},
    "L4_CONTEXT": {"score": 58.0, "trend": "INCREASING", "consecutiveRiskyCount": 3}
  },

  "triggerContent": "***",  // 需要特殊权限查看明文，否则显示 ***

  "interventionActions": [
    {"type": "BLOCK_REPLY", "status": "SUCCESS", "executedAt": "..."},
    {"type": "HUMAN_TAKEOVER", "status": "SUCCESS", "executedAt": "...", "agentId": 2001},
    {"type": "PARENT_URGENT", "status": "SUCCESS", "executedAt": "..."},
    {"type": "RESOURCE_RECOMMEND", "status": "SUCCESS", "executedAt": "..."}
  ],

  "detectedAt": "2026-07-30T10:23:45.123Z",
  "reviewResult": null
}
```

#### 6.1.4 人工复核提交

```
POST /admin/v1/psych-risk/events/{eventId}/review
Authorization: Bearer <admin_token>
Content-Type: application/json

Request:
{
  "result": "TRUE_POSITIVE",      // TRUE_POSITIVE / FALSE_POSITIVE / INCONCLUSIVE
  "notes": "学生确实表达了学业绝望情绪，人工客服已介入沟通，家长已知晓",
  "followUpAction": "CONTINUE_MONITORING"  // CLOSE_EVENT / CONTINUE_MONITORING / ESCALATE
}

Response:
{
  "eventId": "evt-uuid-xxx",
  "reviewStatus": "COMPLETED",
  "reviewedBy": 2001,
  "reviewedAt": "2026-07-30T11:05:00.000Z"
}
```

#### 6.1.5 词典管理

```
POST /admin/v1/psych-risk/lexicon
Authorization: Bearer <admin_token>
Content-Type: application/json

Request:
{
  "category": "self_harm",
  "termPattern": "不想面对明天",
  "termType": "PHRASE",
  "baseScore": 7.5
}

Response:
{
  "termId": "SH-009",
  "status": "ACTIVE",
  "createdAt": "2026-07-30T12:00:00.000Z"
}
```

---

## 7. AI 回复拦截器设计

### 7.1 回复拦截模式

```java
public enum AIReplyMode {
    /**
     * 正常模式：标准 AI 辅导回复
     */
    NORMAL,

    /**
     * 温暖关怀模式（L2）：
     * - AI 回复开头加入关怀语句
     * - 使用更柔和的语气
     * - 避免施压性表达（"你必须"、"你应该"）
     * - 回复末尾附上鼓励
     */
    WARM_CARE,

    /**
     * 安全模式（L3+）：
     * - 完全阻断 AI 自动回复
     * - 展示预设的安全回复
     * - 等待人工接管
     */
    SAFE_BLOCK,

    /**
     * 紧急模式（L4）：
     * - 立即停止所有 AI 回复
     * - 展示紧急援助信息
     * - 全屏心理热线推送
     */
    EMERGENCY
}
```

### 7.2 拦截器实现

```java
public class AIReplyInterceptor {

    private final ConversationSessionStore sessionStore;

    /**
     * 在 AI 对话管线的 pre-reply 阶段调用
     * 返回是否允许继续生成回复
     */
    public ReplyDecision beforeReply(String conversationId, String userId) {
        ConversationSession session = sessionStore.get(conversationId);

        if (session == null || session.getReplyMode() == null) {
            return ReplyDecision.proceed();
        }

        switch (session.getReplyMode()) {
            case NORMAL:
                return ReplyDecision.proceed();

            case WARM_CARE:
                return ReplyDecision.proceedWithModifiers(
                    session.getPrefixInjection(),   // 前缀关怀语
                    session.getSuffixInjection()    // 后缀鼓励语
                );

            case SAFE_BLOCK:
                return ReplyDecision.replaceWith(
                    session.getBlockMessage()       // 预设的安全回复
                );

            case EMERGENCY:
                return ReplyDecision.halt(
                    session.getEmergencyMessage(),  // 紧急援助信息
                    session.getFullScreenAlert()    // 全屏弹窗内容
                );

            default:
                return ReplyDecision.proceed();
        }
    }

    /**
     * 切换对话模式
     */
    public void switchMode(String conversationId, AIReplyMode mode) {
        sessionStore.updateMode(conversationId, mode);
        // 记录模式切换日志
        log.info("Conversation {} switched to mode {}", conversationId, mode);
    }

    /**
     * 注入前缀（不改变 AI 回复内容，在回复前展示）
     */
    public void injectPrefix(String conversationId, String prefix) {
        sessionStore.setPrefix(conversationId, prefix);
    }

    /**
     * 注入后缀（在 AI 回复完成后追加展示）
     */
    public void injectSuffix(String conversationId, String suffix) {
        sessionStore.setSuffix(conversationId, suffix);
    }

    /**
     * 阻断回复，替换为预设消息
     */
    public void blockReply(String conversationId, String blockMessage) {
        sessionStore.updateMode(conversationId, AIReplyMode.SAFE_BLOCK);
        sessionStore.setBlockMessage(conversationId, blockMessage);
    }

    /**
     * 紧急中断
     */
    public void emergencyHalt(String conversationId, String emergencyMessage) {
        sessionStore.updateMode(conversationId, AIReplyMode.EMERGENCY);
        sessionStore.setEmergencyMessage(conversationId, emergencyMessage);
        // 取消所有进行中的 AI 生成任务
        aiGenerationService.cancelGeneration(conversationId);
    }

    /**
     * 全屏弹窗推送
     */
    public void pushFullScreenAlert(String userId, EmergencyAlertTemplate template) {
        pushNotificationService.sendFullScreenAlert(
            userId,
            template.getTitle(),
            template.getBody(),
            template.getActions(),  // ["拨打心理援助热线", "我知道了"]
            template.getDuration()  // 30秒不可关闭
        );
    }
}
```

---

## 8. 错误处理与降级策略

### 8.1 错误处理矩阵

| 错误场景 | 处理策略 | 降级方案 |
| --- | --- | --- |
| Layer 1 规则引擎超时 | 跳过规则层，直接进入 Layer 2 | 依赖后续层级兜底 |
| Layer 2 模型推理超时 (>50ms) | 跳过情感分析，使用 Layer 1 + Layer 3 | 降级为规则+意图双层 |
| Layer 3 意图模型不可用 | 使用 Layer 1 + Layer 2 结果做保守决策 | 保守评估（分数偏高） |
| Layer 4 上下文查询失败 | 忽略上下文，仅凭当前消息判断 | 标记为单消息决策 |
| 数据库写入失败 | 异步重试 3 次，失败后写入本地队列 | 不阻断主流程 |
| 家长通知发送失败 | 重试 2 次，失败后升级为短信通知 | 多通道容灾 |
| 人工接管队列满 | 立即升级为 L4 处理 | 安全优先 |
| 值班人员告警发送失败 | 多渠道告警（企微/钉钉/短信） | 确保至少一个渠道送达 |

### 8.2 超时与降级控制

```java
public class PsychRiskDetectionService {

    private static final long TOTAL_PIPELINE_TIMEOUT_MS = 100;  // 总管线超时 100ms
    private static final long LAYER_TIMEOUT_MS = 30;            // 单层超时 30ms

    public DetectionResult detect(DetectionContext ctx) {
        long startTime = System.currentTimeMillis();
        DetectionContext enrichedCtx = ctx;

        // 串联执行四层检测，每层带超时控制
        try {
            LayerResult l1 = executeWithTimeout(() -> rulePreFilter.detect(enrichedCtx),
                LAYER_TIMEOUT_MS, "L1");
            enrichedCtx = enrichedCtx.withLayerResult("RULE_PRE_FILTER", l1);
        } catch (TimeoutException e) {
            log.warn("L1 rule filter timeout for user {}", ctx.getUserId());
            // 超时不阻断，继续后续层
        }

        // 如果总时间已经不够，进行快速降级
        if (TimeUtils.elapsedMs(startTime) > TOTAL_PIPELINE_TIMEOUT_MS * 0.6) {
            // 快速路径：仅用 L1 结果做保守评估
            return quickFallback(ctx, enrichedCtx);
        }

        // 继续 L2-L4...
        // ...（类似 try-timeout 模式）

        // 最终风险分级
        RiskDecision decision = riskClassifier.classify(enrichedCtx);
        return DetectionResult.from(decision, enrichedCtx);
    }

    /**
     * 快速降级路径：当管线时间不足时
     * 策略：宁可误报不可漏报（保守评估）
     */
    private DetectionResult quickFallback(DetectionContext ctx, DetectionContext enriched) {
        LayerResult l1 = enriched.getLayerResult("RULE_PRE_FILTER");
        double score = l1 != null ? l1.getLayerScore() : 0;

        // 保守策略：有规则命中就至少 L2
        if (score > 0) {
            return DetectionResult.builder()
                .riskLevel(RiskLevel.L2_MEDIUM)  // 保守升级
                .riskScore(Math.max(score * 3, 45))
                .degraded(true)
                .reason("DEGRADED_MODE: pipeline timeout, conservative assessment")
                .build();
        }

        return DetectionResult.normal();
    }
}
```

---

## 9. 性能优化

### 9.1 性能目标

| 指标 | 目标 | 说明 |
| --- | --- | --- |
| 总管线延迟 P99 | ≤ 80ms | 不影响 AI 对话首 token 延迟 |
| Layer 1 延迟 P99 | ≤ 5ms | AC自动机匹配 |
| Layer 2 延迟 P99 | ≤ 25ms | ONNX 模型推理 |
| Layer 3 延迟 P99 | ≤ 40ms | 意图分类模型 |
| Layer 4 延迟 P99 | ≤ 15ms | Redis 缓存读取 |
| 吞吐量 | ≥ 2000 TPS | 单节点处理能力 |

### 9.2 优化策略

```java
// 策略1：短路优化 - 大多数消息在 Layer 1 就可以放行
// 约 95% 的消息不会触发任何规则，在 L1 即返回 L0

// 策略2：模型批处理
public class EmotionModelBatchProcessor {
    private final BlockingQueue<DetectionTask> batchQueue = new LinkedBlockingQueue<>();
    private static final int BATCH_SIZE = 16;
    private static final long BATCH_TIMEOUT_MS = 10;

    @Scheduled(fixedRate = 5)  // 每5ms检查一次
    public void processBatch() {
        List<DetectionTask> batch = new ArrayList<>(BATCH_SIZE);
        batchQueue.drainTo(batch, BATCH_SIZE);
        if (batch.isEmpty()) return;\n
        // 批量推理，减少模型加载开销
        List<EmotionPrediction> predictions = emotionModel.predictBatch(
            batch.stream().map(DetectionTask::getText).toList()
        );

        // 分发结果
        for (int i = 0; i < batch.size(); i++) {
            batch.get(i).complete(predictions.get(i));
        }
    }
}

// 策略3：上下文缓存 - Layer 4 的最近消息检测记录缓存在 Redis
// Key: psych:risk:ctx:{userId}:{conversationId}
// Value: List<RiskDetectionRecord> (JSON)
// TTL: 1 小时

// 策略4：词典预编译 - Layer 1 的 AC 自动机在启动时构建，更新时增量重建
// 避免每次请求重新构建自动机

// 策略5：异步持久化 - 事件写入和干预动作记录异步化
// 主检测路径仅做内存操作，数据库写入通过消息队列异步完成
```

---

## 10. 安全与合规

### 10.1 数据安全

| 安全措施 | 实现方案 |
| --- | --- |
| 触发内容加密 | AES-256-GCM 加密存储，密钥由 KMS 管理，按用户隔离 |
| 数据库隔离 | `psych_risk_events` 表存储在独立数据库 schema，仅限本服务访问 |
| 访问控制 | 查看明文触发内容需 `PSYCH_RISK_VIEW_CONTENT` 权限 |
| 数据脱敏 | 管理后台列表默认不展示触发文本，详情页需二次身份验证 |
| 传输加密 | 内部服务调用走 mTLS |
| 审计日志 | 所有对心理风险数据的访问、查看、导出操作全量审计 |

### 10.2 合规要求

```
相关法规：
- 《中华人民共和国未成年人保护法》
- 《中华人民共和精神卫生法》
- 《中华人民共和国个人信息保护法》
- 《儿童个人信息网络保护规定》
- 《生成式人工智能服务管理暂行办法》

合规措施：
1. 心理风险检测在隐私政策中明确告知用户和家长
2. 仅检测不诊断：系统不产出医学诊断结论，仅做风险信号提示
3. 干预推荐不替代专业服务：明确提示寻求专业心理帮助
4. 数据最小化：仅记录风险检测必要信息，不保留非必要的对话全文
5. 数据保留期限：L0-L1 事件保留 90 天，L2-L3 保留 1 年，L4 保留 3 年
6. 数据删除：用户注销账号时，心理风险数据在 30 日内完成清理
7. 人工复核：所有 L3-L4 事件须在 24 小时内由专业人员复核
```

### 10.3 隐私边界控制

系统严格遵循数据最小化原则，仅收集心理风险检测所必需的字段（userId、conversationId、messageText、studentAge、studentGrade、detectedAt）。禁止收集与学生心理风险检测无关的敏感属性（真实姓名、身份证号、家庭住址、电话号码、家庭收入、残疾状况、病史等）。

查看触发内容明文须满足：操作员拥有 `PSYCH_RISK_VIEW_CONTENT` 权限、已完成年度心理安全培训认证、操作行为全量审计记录、每次查看有 60 秒时间限制。

---

## 11. 监控与告警

### 11.1 核心监控指标

| 指标名 | 类型 | 说明 |
| --- | --- | --- |
| psych_risk_detection_total | Counter | 检测请求总数（按 level 标签） |
| psych_risk_detection_latency | Histogram | 检测管线延迟分布 |
| psych_risk_layer_latency | Histogram | 各层延迟分布 |
| psych_risk_l4_emergency_count | Counter | L4 紧急事件数 |
| psych_risk_intervention_success_rate | Gauge | 干预动作成功率 |
| psych_risk_parent_notify_latency | Histogram | 家长通知发送延迟 |
| psych_risk_takeover_queue_size | Gauge | 人工接管等待队列长度 |
| psych_risk_false_positive_rate | Gauge | 误报率（人工复核后统计） |
| psych_risk_model_inference_latency | Histogram | 各模型推理延迟 |

### 11.2 告警规则

```yaml
groups:
  - name: psych_risk_alerts
    rules:
      # L4 紧急事件：立即告警
      - alert: PsychRiskL4Emergency
        expr: rate(psych_risk_l4_emergency_count[5m]) > 0
        for: 0s
        labels:
          severity: critical
        annotations:
          summary: "L4 心理危机紧急事件"
          description: "过去5分钟内检测到 L4 级别心理风险事件"

      # 人工接管队列积压
      - alert: PsychRiskTakeoverQueueBacklog
        expr: psych_risk_takeover_queue_size > 10
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "心理风险人工接管队列积压"
          description: "当前有 {{ $value }} 个事件等待人工接管"

      # 检测延迟过高
      - alert: PsychRiskDetectionLatencyHigh
        expr: histogram_quantile(0.99, psych_risk_detection_latency_bucket) > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "心理风险检测延迟超过 100ms"

      # 误报率过高
      - alert: PsychRiskFalsePositiveRateHigh
        expr: psych_risk_false_positive_rate > 0.3
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "心理风险检测误报率超过30%"
          description: "可能需要调整检测阈值或更新词典"
```

---

## 12. 部署架构

### 12.1 组件部署

```
┌─────────────────────────────────────────────────┐
│              Kubernetes Cluster                   │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │  psych-risk-detector (Deployment)        │    │
│  │  replicas: 4-8 (HPA)                     │    │
│  │  CPU: 2 core / Mem: 4Gi (per pod)        │    │
│  │  - RulePreFilter (AC自动机, in-memory)    │    │
│  │  - NLPEmotionAnalyzer (ONNX Runtime)     │    │
│  │  - SemanticIntentDetector               │    │
│  │  - ContextAccumulator (Redis client)     │    │
│  └──────────────┬──────────────────────────┘    │
│                 │                                │
│  ┌──────────────┼──────────────────────────┐    │
│  │  psych-risk-intervention (Deployment)    │    │
│  │  replicas: 2-4                             │    │
│  │  - InterventionOrchestrator              │    │
│  │  - AIReplyInterceptor                     │    │
│  │  - ParentNotificationService              │    │
│  └──────────────┬──────────────────────────┘    │
│                 │                                │
│  ┌──────────────┼──────────────────────────┐    │
│  │  psych-risk-admin (Deployment)           │    │
│  │  replicas: 2                               │    │
│  │  - Admin API (事件列表/详情/复核/词典)     │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │  psych-risk-model-server (Deployment)    │    │
│  │  replicas: 2                               │    │
│  │  GPU: 1x T4 (共享)                        │    │
│  │  - Emotion BERT-tiny (ONNX)              │    │
│  │  - Intent Classification Model           │    │
│  │  - Triton Inference Server               │    │
│  └─────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘

依赖组件:
  - Redis Cluster: 上下文缓存、冷却期管理
  - MySQL (独立schema): 事件存储、干预记录、词典
  - KMS: 加密密钥管理
  - Kafka: 异步事件通知
```

### 12.2 水平伸缩策略

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: psych-risk-detector-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: psych-risk-detector
  minReplicas: 4
  maxReplicas: 16
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 65
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 75
```

---

## 13. 测试策略

### 13.1 单元测试

| 模块 | 测试重点 | 示例 |
| --- | --- | --- |
| RulePreFilter | AC自动机匹配准确性、正则表达式边界 | 包含"割腕"的文本正确命中、包含"割草"不误命中 |
| NLPEmotionAnalyzer | 情感分类准确性 | "今天真开心" → POSITIVE；"不想活了" → HOPELESS |
| SemanticIntentDetector | 意图分类准确性 | 引用古诗"人生若只如初见" → QUOTING_CONTENT |
| ContextAccumulator | 窗口计算、趋势分析 | 3条递增分数 → INCREASING |
| RiskClassifier | 分级逻辑 | score=85 → L4；引用降级 → 从L3降到L1 |

### 13.2 集成测试

```java
@SpringBootTest
class PsychRiskIntegrationTest {

    @Test
    @DisplayName("L4紧急场景：学生表达自杀意念 → 全链路干预")
    void testL4EmergencyFlow() {
        // Given: 学生发送包含自杀意念的消息
        DetectionContext ctx = DetectionContext.builder()
            .userId(100001L)
            .text("我真的想结束这一切，活着太痛苦了")
            .studentAge(15)
            .build();

        // When: 执行检测
        DetectionResult result = detectionService.detect(ctx);

        // Then: 验证风险等级和干预动作
        assertThat(result.getRiskLevel()).isEqualTo(RiskLevel.L4_EMERGENCY);
        assertThat(result.getDecision()).isEqualTo("EMERGENCY_HALT");

        // 验证干预编排
        List<InterventionAction> actions = result.getActions();
        assertThat(actions).extracting("type")
            .contains("EMERGENCY_PROTOCOL", "HELPLINE_PUSH",
                      "STAFF_ALERT", "PARENT_EMERGENCY", "HUMAN_TAKEOVER");

        // 验证事件已持久化
        PsychRiskEvent event = eventStore.findByEventId(result.getEventId());
        assertThat(event.getRiskLevel()).isEqualTo(4);
        assertThat(event.getInterventionStatus()).isEqualTo("IN_PROGRESS");
    }

    @Test
    @DisplayName("引用降级场景：学生引用古诗文 → 不触发误报")
    void testQuotingContentNoFalsePositive() {
        DetectionContext ctx = DetectionContext.builder()
            .userId(100002L)
            .text("人生自古谁无死，留取丹心照汗青")
            .studentAge(14)
            .recentMessages(List.of(
                new Message("user", "帮我解释一下文天祥的诗"),
                new Message("assistant", "好的，这句诗的意思是...")
            ))
            .build();

        DetectionResult result = detectionService.detect(ctx);

        // 意图层应识别为 QUOTING_CONTENT 并降级
        assertThat(result.getRiskLevel()).isIn(RiskLevel.L0_NORMAL, RiskLevel.L1_LOW);
    }

    @Test
    @DisplayName("累积升级场景：多条低风险消息逐渐升级")
    void testProgressiveEscalation() {
        // 模拟连续3条低风险消息
        for (int i = 0; i < 3; i++) {
            detectionService.detect(DetectionContext.builder()
                .userId(100003L)
                .text("我太笨了，怎么学都学不会")
                .build());
        }

        // 第4条触发升级
        DetectionResult result = detectionService.detect(DetectionContext.builder()
            .userId(100003L)
            .text("我是不是真的不适合读书，大家都不喜欢我")
            .build());

        assertThat(result.getRiskLevel()).isGreaterThanOrEqualTo(RiskLevel.L2_MEDIUM);
    }
}
```

### 13.3 性能测试

```
场景1：基线性能
- 1000 TPS 纯正常文本（L0），P99 延迟 ≤ 30ms

场景2：混合负载
- 95% L0 + 4% L1-L2 + 1% L3-L4，2000 TPS，P99 ≤ 80ms

场景3：突发流量
- 10秒内从 500 TPS 升至 3000 TPS，验证 HPA 扩容效果

场景4：模型推理压力
- 持续 500 次/秒的 Layer2 模型调用，GPU 利用率 ≤ 70%
```

---

## 14. 预置数据

### 14.1 温暖回复模板

```sql
INSERT INTO reply_templates (template_id, scene, content, language_tone) VALUES
('WARM_L1_01', 'WARM_PREFIX_L1', '学习有时确实会让人觉得有压力，没关系，我们一步一步来。', 'warm'),
('WARM_L1_02', 'WARM_PREFIX_L1', '我注意到你可能遇到了一些困难，不管是什么问题，都可以跟我说说。', 'warm'),
('WARM_L1_03', 'WARM_PREFIX_L1', '每个人的学习节奏都不一样，重要的是你在努力。', 'encouraging'),

('CARE_L2_01', 'CARE_TIP_L2', '如果你感到压力很大，可以试试：\n1. 深呼吸放松：慢慢吸气4秒，屏住呼吸4秒，再慢慢呼气4秒\n2. 跟信任的人聊聊你的感受\n3. 做一些让自己开心的事情\n你的感受很重要，值得被认真对待。', 'caring'),

('RESOURCE_L3_01', 'PSYCH_RESOURCE_L3', '如果你正在经历困难的情绪，以下资源可以帮助你：\n\n📞 全国24小时心理援助热线：400-161-9995\n📞 北京心理危机研究与干预中心：010-82951332\n📞 共青团心理辅导热线：12355\n\n你不需要独自面对困难，寻求帮助是勇敢的表现。', 'professional');
```

### 14.2 紧急干预预设文案

```sql
INSERT INTO emergency_templates (template_id, title, body, actions, duration_sec) VALUES
('EMERGENCY_SELF_HARM', '你很重要',
 '如果你现在感到不安全，请立即拨打24小时心理援助热线。\n\n🆘 全国心理援助热线：400-161-9995\n🆘 紧急情况请拨打：110 或 120\n\n你的感受很重要，有人愿意帮助你度过这个困难的时刻。',
 '["拨打心理援助热线", "我知道了"]',
 30),

('PARENT_URGENT_TEMPLATE', '【重要通知】请关注您的孩子',
 '我们关注到您的孩子在使用学习软件时表达了一些令人担忧的内容。\n建议您：\n1. 尽快与孩子进行温和的沟通，倾听他们的感受\n2. 避免批评或说教，表达关心和支持\n3. 如需要，可拨打心理援助热线：400-161-9995\n4. 如情况紧急，请立即拨打110或120',
 '["查看详情", "拨打热线"]',
 0);
```

---

## 15. 版本演进路线

| 版本 | 主要内容 | 预计周期 |
| --- | --- | --- |
| v1.0 | Layer 1 规则检测 + L3/L4 基础干预流程 | 4周 |
| v1.1 | 接入 Layer 2 情感分析模型，降低误报率 | 2周 |
| v1.2 | 接入 Layer 3 意图分类，支持引用/调侃降级 | 3周 |
| v1.3 | Layer 4 上下文累积分析，支持渐进升级检测 | 2周 |
| v2.0 | 词典持续优化（基于误报/漏报数据迭代） | 持续 |
| v2.1 | 多语言支持（英语/少数民族语言） | 3周 |
| v2.2 | 语音语调分析（从语音消息中提取情感特征） | 4周 |

---

## 16. 附录

### 16.1 心理援助热线资源

| 机构 | 号码 | 服务时间 |
| --- | --- | --- |
| 全国心理援助热线 | 400-161-9995 | 24小时 |
| 北京心理危机研究与干预中心 | 010-82951332 | 24小时 |
| 共青团心理辅导热线 | 12355 | 工作日 8:00-20:00 |
| 教育部华中师范大学心理援助热线 | 4001-888-976 | 24小时 |
| 希望24热线 | 400-161-9995 | 24小时 |

### 16.2 术语表

| 术语 | 说明 |
| --- | --- |
| 心理风险信号 | 学生在对话中表达的可能暗示心理困扰的语言信号 |
| 风险等级 | 系统对检测到的心理风险严重程度的分级评估 |
| 干预编排 | 根据风险等级自动触发的一系列响应动作的组合 |
| 温暖关怀模式 | AI 回复风格切换为更柔和、更具关怀性的模式 |
| 人工接管 | 中断 AI 自动回复，由专业人工客服接手对话 |
| 冷却期 | 为避免重复干预而设置的时间窗口 |
| 短路优化 | 在检测管线早期阶段完成判断，跳过后续不必要的处理 |
| 引用降级 | 当学生引用课文/歌词等非自我表达内容时，降低风险评级 |