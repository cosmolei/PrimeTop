# 服务端-AI辅导对话知识点掌握度实时更新与能力维度同步引擎 - 详细设计

## 1. 模块概述

### 1.1 功能定位

本引擎是 PrimeTop 学习闭环中的**核心桥梁服务**，负责在 AI 辅导对话结束后（或进行中），实时完成以下工作：

1. **知识点提取**：从 AI 对话内容中自动识别涉及的知识点
2. **掌握度评估**：结合对话交互行为（追问模式、提示展开次数、回答正确性等）评估学生对每个知识点的掌握程度
3. **能力维度映射**：将知识点掌握度变化映射到计算能力、阅读理解、逻辑推理、空间思维、语言表达等多维能力雷达
4. **状态同步**：将更新后的掌握度和能力维度实时推送到学情画像、推荐引擎、复习调度等下游服务
5. **事件触发**：生成结构化的掌握度变更事件，驱动级联业务逻辑

### 1.2 为什么需要独立设计

本引擎横跨多个现有子系统，是一个典型的**跨模块集成管线**：

| 现有模块 | 关注点 | 本引擎关系 |
|----------|--------|------------|
| AI对话引擎与会话管理 | 对话存储与多轮上下文 | 本引擎的**数据源** |
| 知识点体系与教材映射引擎 | 知识点树结构与教材章节映射 | 本引擎的**映射基础** |
| AI回答知识点自动标注与溯源引用系统 | AI回答中的知识点标注 | 本引擎**复用其标注结果** |
| 用户学习画像与能力维度模型 | 学生画像的存储与查询 | 本引擎的**写入目标** |
| 学生学习状态建模与动态评估引擎 | 学习状态的宏观建模 | 本引擎提供**微观输入数据** |
| 间隔重复算法与遗忘曲线复习调度引擎 | 复习计划生成 | 本引擎触发其**重新调度** |
| 自适应学习与个性化推荐引擎 | 内容推荐 | 本引擎提供**实时掌握度信号** |
| 学习行为事件流与跨模块级联处理引擎 | 事件的分发与路由 | 本引擎是事件的**生产者** |

单独设计此引擎的原因：
- 各子系统独立工作，缺少一条**端到端的数据管线**将 AI 对话成果转化为可量化的掌握度更新
- 掌握度评估需要综合多种信号（对话行为 + 知识点关联 + 历史基线），逻辑复杂度足以独立成模块
- 实时性要求高（对话结束后 5 秒内完成掌握度更新），需要专门的性能设计

### 1.3 设计原则

1. **异步解耦**：掌握度更新通过事件驱动，不阻塞 AI 对话主流程
2. **增量更新**：每次只更新本次对话涉及的知识点，全量重算按天/周批处理
3. **可解释性**：每次掌握度变化都附带证据链（基于哪次对话、哪些行为特征）
4. **渐进可信**：单次对话的掌握度变化幅度受限，避免单次异常对话导致大幅波动
5. **幂等安全**：同一对话重复触发掌握度更新不会产生重复计算

---

## 2. 核心概念与数据模型

### 2.1 知识点掌握度模型

#### 2.1.1 掌握度等级定义

```java
public enum MasteryLevel {
    UNKNOWN(0, "未接触"),       // 从未学习过该知识点
    EXPOSED(1, "初步接触"),     // 在AI对话中被提及但未深入
    FAMILIAR(2, "有所了解"),    // 能识别概念，但无法独立运用
    COMPREHEND(3, "基本理解"),  // 能理解原理，在提示下可运用
    APPLY(4, "能够运用"),       // 能独立运用知识解题
    MASTER(5, "熟练掌握");      // 能灵活运用并解决变式题

    private final int value;
    private final String label;
}
```

#### 2.1.2 掌握度评分（连续值）

除了离散等级，系统维护一个 0.0~1.0 的连续掌握度分数，用于精细化追踪：

| 分数区间 | 等级 | 含义 |
|----------|------|------|
| [0, 0.1) | UNKNOWN | 无任何学习记录 |
| [0.1, 0.25) | EXPOSED | 仅在对话中被动接触 |
| [0.25, 0.45) | FAMILIAR | 有初步认知但未掌握 |
| [0.45, 0.65) | COMPREHEND | 理解核心概念 |
| [0.65, 0.85) | APPLY | 能独立应用 |
| [0.85, 1.0] | MASTER | 熟练掌握 |

#### 2.1.3 知识点掌握度实体

```sql
CREATE TABLE student_kp_mastery (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    student_id          BIGINT NOT NULL COMMENT '学生ID',
    knowledge_point_id  BIGINT NOT NULL COMMENT '知识点ID',
    
    -- 掌握度核心字段
    mastery_score       DECIMAL(5,4) NOT NULL DEFAULT 0 COMMENT '掌握度分数 0.0000~1.0000',
    mastery_level       TINYINT NOT NULL DEFAULT 0 COMMENT '掌握度等级 0-5',
    confidence          DECIMAL(5,4) NOT NULL DEFAULT 0 COMMENT '评估置信度 0~1',
    
    -- 统计字段
    exposure_count      INT NOT NULL DEFAULT 0 COMMENT '接触次数',
    practice_count      INT NOT NULL DEFAULT 0 COMMENT '练习次数',
    correct_count       INT NOT NULL DEFAULT 0 COMMENT '正确次数',
    hint_used_count     INT NOT NULL DEFAULT 0 COMMENT '使用提示次数',
    ai_tutor_count      INT NOT NULL DEFAULT 0 COMMENT 'AI辅导涉及次数',
    
    -- 时间字段
    first_exposure_at   DATETIME COMMENT '首次接触时间',
    last_exposure_at    DATETIME COMMENT '最近接触时间',
    last_practice_at    DATETIME COMMENT '最近练习时间',
    last_ai_tutor_at    DATETIME COMMENT '最近AI辅导时间',
    last_assessed_at    DATETIME COMMENT '最近评估时间',
    
    -- 衰减相关
    decayed_score       DECIMAL(5,4) COMMENT '经遗忘衰减后的有效掌握度',
    last_decay_at       DATETIME COMMENT '最近衰减计算时间',
    
    -- 元数据
    version             INT NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_student_kp (student_id, knowledge_point_id),
    INDEX idx_student_score (student_id, mastery_score),
    INDEX idx_student_level (student_id, mastery_level),
    INDEX idx_last_exposure (student_id, last_exposure_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生知识点掌握度';
```

### 2.2 能力维度模型

#### 2.2.1 能力维度定义

```java
public enum AbilityDimension {
    CALCULATION("计算能力", "数值计算、运算准确性、运算速度"),
    LOGIC("逻辑推理", "演绎推理、归纳推理、条件分析"),
    READING_COMP("阅读理解", "文本理解、信息提取、主旨概括"),
    SPATIAL("空间思维", "图形认知、空间想象、几何推理"),
    EXPRESSION("语言表达", "书面表达、语言组织、论述能力"),
    MEMORY("记忆能力", "知识点记忆、公式记忆、词汇记忆"),
    APPLICATION("知识应用", "跨场景应用、变式题解决、综合运用"),
    ANALYSIS("分析综合", "问题分解、信息整合、方案评估");
    
    private final String name;
    private final String description;
}
```

#### 2.2.2 知识点→能力维度映射规则

每个知识点可关联多个能力维度，权重不同：

```sql
CREATE TABLE kp_ability_weight (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    knowledge_point_id  BIGINT NOT NULL COMMENT '知识点ID',
    ability_dimension   VARCHAR(32) NOT NULL COMMENT '能力维度枚举值',
    weight              DECIMAL(3,2) NOT NULL DEFAULT 0.5 COMMENT '该知识点对此能力维度的贡献权重 0~1',
    
    UNIQUE KEY uk_kp_dim (knowledge_point_id, ability_dimension),
    INDEX idx_dimension (ability_dimension)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='知识点-能力维度权重映射';
```

**权重示例：**

| 知识点 | 能力维度 | 权重 | 说明 |
|--------|----------|------|------|
| 一元二次方程 | CALCULATION | 0.7 | 方程求解涉及大量计算 |
| 一元二次方程 | LOGIC | 0.5 | 需要分析条件选择解法 |
| 一元二次方程 | APPLICATION | 0.6 | 常出现在应用题中 |
| 古诗文鉴赏 | READING_COMP | 0.8 | 核心是文本理解 |
| 古诗文鉴赏 | MEMORY | 0.5 | 需要记忆相关文学常识 |
| 古诗文鉴赏 | EXPRESSION | 0.4 | 鉴赏题需要书面表达 |

#### 2.2.3 学生能力维度实体

```sql
CREATE TABLE student_ability_dimension (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    student_id          BIGINT NOT NULL COMMENT '学生ID',
    ability_dimension   VARCHAR(32) NOT NULL COMMENT '能力维度枚举值',
    
    -- 能力值
    ability_score       DECIMAL(5,4) NOT NULL DEFAULT 0.5 COMMENT '能力分数 0~1',
    confidence          DECIMAL(5,4) NOT NULL DEFAULT 0 COMMENT '评估置信度',
    
    -- 统计
    contributing_kp_count INT NOT NULL DEFAULT 0 COMMENT '贡献此维度的已评估知识点数',
    
    -- 时间
    last_updated_at     DATETIME COMMENT '最近更新时间',
    
    version             INT NOT NULL DEFAULT 0,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_student_dim (student_id, ability_dimension),
    INDEX idx_student_score (student_id, ability_score)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生能力维度';
```

### 2.3 掌握度变更记录

```sql
CREATE TABLE mastery_change_log (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    student_id          BIGINT NOT NULL,
    knowledge_point_id  BIGINT NOT NULL,
    
    -- 变更来源
    source_type         VARCHAR(32) NOT NULL COMMENT '来源类型: AI_TUTOR/PRACTICE/EXAM/MANUAL',
    source_id           BIGINT NOT NULL COMMENT '来源ID: 对话ID/练习ID等',
    
    -- 变更详情
    old_score           DECIMAL(5,4) COMMENT '变更前掌握度分数',
    new_score           DECIMAL(5,4) COMMENT '变更后掌握度分数',
    score_delta         DECIMAL(6,4) COMMENT '变化量（正为提升，负为下降）',
    old_level           TINYINT COMMENT '变更前等级',
    new_level           TINYINT COMMENT '变更后等级',
    level_changed       BOOLEAN NOT NULL DEFAULT FALSE COMMENT '等级是否变化',
    
    -- 评估依据
    evidence_json       JSON COMMENT '评估依据详情（行为特征、对话片段等）',
    confidence          DECIMAL(5,4) NOT NULL COMMENT '本次评估置信度',
    
    -- 幂等控制
    idempotent_key      VARCHAR(128) NOT NULL COMMENT '幂等键: source_type:source_id:kp_id',
    
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_idempotent (idempotent_key),
    INDEX idx_student_time (student_id, created_at),
    INDEX idx_source (source_type, source_id),
    INDEX idx_kp_time (knowledge_point_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='掌握度变更日志';
```

---

## 3. 整体架构与处理流程

### 3.1 系统架构图

```
┌──────────────────────────────────────────────────────────────┐
│                     AI 辅导对话引擎                           │
│                  (对话完成/阶段性节点)                        │
└──────────────────────┬───────────────────────────────────────┘
                       │ 对话完成事件
                       ▼
┌──────────────────────────────────────────────────────────────┐
│              Step 1: 对话内容知识点提取                        │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐ │
│  │ 复用知识点标注  │  │ 补充上下文推断 │  │ 去重与排序     │ │
│  │ 服务结果       │  │ (追问意图等)   │  │ (按相关性排序) │ │
│  └────────────────┘  └────────────────┘  └────────────────┘ │
└──────────────────────┬───────────────────────────────────────┘
                       │ 知识点列表 + 相关性分数
                       ▼
┌──────────────────────────────────────────────────────────────┐
│              Step 2: 对话交互行为特征提取                      │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐ │
│  │ 追问模式分析   │  │ 提示依赖度评估 │  │ 理解信号检测   │ │
│  │ (深度/浅层)    │  │ (展开次数等)   │  │ ("懂了"/复述)  │ │
│  └────────────────┘  └────────────────┘  └────────────────┘ │
└──────────────────────┬───────────────────────────────────────┘
                       │ 行为特征向量
                       ▼
┌──────────────────────────────────────────────────────────────┐
│              Step 3: 掌握度增量计算                           │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐ │
│  │ 行为信号融合   │  │ 历史基线参考   │  │ 增量幅度限制   │ │
│  │ (加权评分)     │  │ (当前掌握度)   │  │ (防止单次突变) │ │
│  └────────────────┘  └────────────────┘  └────────────────┘ │
└──────────────────────┬───────────────────────────────────────┘
                       │ 掌握度增量（每个知识点）
                       ▼
┌──────────────────────────────────────────────────────────────┐
│              Step 4: 掌握度持久化与变更记录                    │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐ │
│  │ 乐观锁更新     │  │ 变更日志写入   │  │ 等级跃迁检测   │ │
│  │ student_kp_    │  │ mastery_       │  │ (触发通知等)   │ │
│  │ mastery        │  │ change_log     │  │                │ │
│  └────────────────┘  └────────────────┘  └────────────────┘ │
└──────────────────────┬───────────────────────────────────────┘
                       │ 掌握度变更事件
                       ▼
┌──────────────────────────────────────────────────────────────┐
│              Step 5: 能力维度聚合更新                          │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐ │
│  │ 查询KP→能力    │  │ 加权聚合计算   │  │ 能力分数更新   │ │
│  │ 维度映射       │  │ (增量式)       │  │ + 变更事件     │ │
│  └────────────────┘  └────────────────┘  └────────────────┘ │
└──────────────────────┬───────────────────────────────────────┘
                       │ 能力维度变更事件
                       ▼
┌──────────────────────────────────────────────────────────────┐
│              Step 6: 下游事件分发                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │ 复习调度重排 │ │ 推荐引擎刷新 │ │ 学情报告/家长推送    │ │
│  │ (间隔重复)   │ │ (自适应学习) │ │ (等级跃迁通知)       │ │
│  └──────────────┘ └──────────────┘ └──────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 触发时机

本引擎在以下时机被触发：

| 触发事件 | 触发条件 | 处理策略 |
|----------|----------|----------|
| AI对话回合完成 | 用户发送新消息或对话结束 | 轻量级：仅提取知识点和基础评分 |
| AI对话会话结束 | 用户主动关闭或超时 | 完整管线：全量评估+能力同步 |
| 用户反馈提交 | 点赞/点踩/纠错 | 增量修正：根据反馈调整掌握度 |
| 答题结果回调 | 练习/考试答题完成 | 融合评估：结合答题结果和AI辅导历史 |
| 定时批处理 | 每日凌晨 | 衰减计算+全量校准 |

### 3.3 核心接口设计

#### 3.3.1 对话完成触发接口

```java
/**
 * AI辅导对话完成后的掌握度更新入口
 * 由 AI对话引擎在会话结束时异步调用
 */
@PostMapping("/api/internal/mastery/evaluate/conversation")
public ApiResponse<MasteryEvaluationResult> evaluateConversation(
    @RequestBody ConversationEvaluateRequest request
) { ... }

@Data
public class ConversationEvaluateRequest {
    /** 对话会话ID */
    @NotNull
    private Long conversationId;
    
    /** 学生ID */
    @NotNull
    private Long studentId;
    
    /** 对话中AI回答的知识点标注结果（复用标注服务） */
    private List<KPAnnotation> kpAnnotations;
    
    /** 对话回合列表（摘要） */
    private List<ConversationTurnSummary> turns;
    
    /** 对话上下文（学科、年级、教材版本等） */
    @NotNull
    private ConversationContext context;
    
    /** 触发类型 */
    @NotNull
    private EvaluateTriggerType triggerType; // SESSION_END / TURN_COMPLETE / FEEDBACK
}

@Data
public class ConversationTurnSummary {
    private int turnIndex;               // 回合序号
    private String userIntent;           // 用户意图: QUESTION / FOLLOW_UP / CONFUSED / CONFIRM / PRACTICE
    private int hintExpansionCount;      // 提示展开次数
    private boolean userAskedSimpler;    // 是否请求"讲简单点"
    private boolean userAskedAnotherWay; // 是否请求"换一种讲法"
    private boolean userConfirmed;       // 是否表示"懂了"
    private Double userResponseTimeMs;   // 用户回复耗时（毫秒）
    private List<String> detectedKpIds;  // 该回合涉及的知识点ID
}

@Data
public class KPAnnotation {
    private String knowledgePointId;     // 知识点ID
    private Double relevanceScore;       // 相关性分数 0~1
    private String annotationSource;     // 标注来源: AUTO / MANUAL
}

@Data
public class ConversationContext {
    private String subject;              // 学科
    private String grade;                // 年级
    private String textbookVersion;      // 教材版本
    private String chapterId;            // 当前章节（如有）
    private String scenario;             // 场景: SYNC_CLASS / FREE_QUESTION / EXAM_PREP / MISTAKE_REVIEW
}
```

#### 3.3.2 掌握度评估结果

```java
@Data
public class MasteryEvaluationResult {
    /** 评估ID */
    private String evaluationId;
    
    /** 涉及的知识点掌握度变更 */
    private List<KPMasteryChange> kpChanges;
    
    /** 受影响的能力维度 */
    private List<AbilityDimensionChange> abilityChanges;
    
    /** 触发的下游事件 */
    private List<String> triggeredEvents;
    
    /** 评估耗时(ms) */
    private long evaluationDurationMs;
}

@Data
public class KPMasteryChange {
    private Long knowledgePointId;
    private String knowledgePointName;
    private BigDecimal oldScore;
    private BigDecimal newScore;
    private BigDecimal delta;
    private int oldLevel;
    private int newLevel;
    private boolean levelUpgraded;
    private boolean levelDowngraded;
    private BigDecimal confidence;
    private String evidence;
}

@Data
public class AbilityDimensionChange {
    private String dimension;            // 能力维度枚举值
    private BigDecimal oldScore;
    private BigDecimal newScore;
    private BigDecimal delta;
}
```

#### 3.3.3 查询接口

```java
/**
 * 查询学生在指定知识点上的掌握度
 */
@GetMapping("/api/v1/mastery/student/{studentId}/knowledge-point/{kpId}")
public ApiResponse<KPMasteryDetail> getKPMastery(
    @PathVariable Long studentId,
    @PathVariable Long kpId
) { ... }

/**
 * 批量查询学生在多个知识点上的掌握度
 */
@PostMapping("/api/v1/mastery/student/{studentId}/knowledge-points/batch")
public ApiResponse<List<KPMasteryDetail>> batchGetKPMastery(
    @PathVariable Long studentId,
    @RequestBody List<Long> kpIds
) { ... }

/**
 * 查询学生能力维度雷达图数据
 */
@GetMapping("/api/v1/mastery/student/{studentId}/ability-radar")
public ApiResponse<AbilityRadarVO> getAbilityRadar(
    @PathVariable Long studentId,
    @RequestParam(required = false) String subject  // 可选：按学科筛选
) { ... }

/**
 * 查询掌握度变更历史
 */
@GetMapping("/api/v1/mastery/student/{studentId}/changes")
public ApiResponse<PageResult<MasteryChangeLogVO>> getMasteryChanges(
    @PathVariable Long studentId,
    @RequestParam(required = false) Long kpId,
    @RequestParam(required = false) String sourceType,
    @RequestParam(defaultValue = "1") int page,
    @RequestParam(defaultValue = "20") int size
) { ... }

@Data
public class KPMasteryDetail {
    private Long knowledgePointId;
    private String kpName;
    private String kpCode;
    private BigDecimal masteryScore;
    private int masteryLevel;
    private String masteryLevelLabel;
    private BigDecimal confidence;
    private BigDecimal decayedScore;       // 衰减后有效掌握度
    private int exposureCount;
    private int practiceCount;
    private double correctRate;            // 正确率 = correct_count / practice_count
    private LocalDateTime firstExposureAt;
    private LocalDateTime lastExposureAt;
    private List<MasteryChangeLogVO> recentChanges;  // 最近5次变更
}

@Data
public class AbilityRadarVO {
    private Long studentId;
    private List<AbilityDimensionVO> dimensions;
    private LocalDateTime calculatedAt;
    
    @Data
    public static class AbilityDimensionVO {
        private String dimension;
        private String dimensionName;
        private BigDecimal score;
        private BigDecimal confidence;
        private int contributingKPCount;
        private BigDecimal previousScore;   // 上次分数（用于展示趋势）
        private String trend;               // UP / DOWN / STABLE
    }
}
```

---

## 4. 核心算法设计

### 4.1 Step 1: 对话内容知识点提取

#### 4.1.1 知识点提取策略

```
输入: 对话会话(包含所有回合) + 已有的AI回答知识点标注
输出: 本对话涉及的知识点列表 + 每个知识点与对话的相关性权重
```

**提取流程：**

```java
public class ConversationKPExtractor {
    
    /**
     * 从对话中提取知识点列表
     * 
     * 策略：
     * 1. 直接复用：取AI回答知识点标注服务的已有结果（主要来源）
     * 2. 意图推断：分析用户追问意图，补充隐含知识点
     * 3. 上下文补充：根据对话上下文（章节、学科）补充背景知识点
     * 4. 去重合并：同一知识点多次出现时取最高相关性
     */
    public List<WeightedKnowledgePoint> extract(
        ConversationEvaluateRequest request
    ) {
        // 1. 基础知识点集合：从标注结果中获取
        Map<String, Double> kpScores = new HashMap<>();
        
        for (KPAnnotation annotation : request.getKpAnnotations()) {
            kpScores.merge(
                annotation.getKnowledgePointId(),
                annotation.getRelevanceScore(),
                Math::max
            );
        }
        
        // 2. 意图推断：分析追问模式补充知识点
        for (ConversationTurnSummary turn : request.getTurns()) {
            if ("FOLLOW_UP".equals(turn.getUserIntent())) {
                // 追问暗示对前述知识点有更深入的需求
                for (String kpId : turn.getDetectedKpIds()) {
                    kpScores.merge(kpId, 0.6, Math::max);
                }
            }
            if ("CONFUSED".equals(turn.getUserIntent())) {
                // 困惑暗示可能涉及前置知识点的缺失
                List<String> prerequisiteKPs = kpService.getPrerequisites(turn.getDetectedKpIds());
                for (String preKpId : prerequisiteKPs) {
                    kpScores.merge(preKpId, 0.4, Math::max);
                }
            }
        }
        
        // 3. 章节上下文补充：如果对话发生在特定章节下
        if (request.getContext().getChapterId() != null) {
            List<String> chapterKPs = chapterService.getChapterKnowledgePoints(
                request.getContext().getChapterId()
            );
            // 章节知识点给较低的基础分，除非已在对话中明确出现
            for (String kpId : chapterKPs) {
                kpScores.putIfAbsent(kpId, 0.2);
            }
        }
        
        // 4. 过滤：只保留相关性 >= 0.3 的知识点
        return kpScores.entrySet().stream()
            .filter(e -> e.getValue() >= 0.3)
            .map(e -> new WeightedKnowledgePoint(e.getKey(), e.getValue()))
            .sorted(Comparator.comparing(WeightedKnowledgePoint::getWeight).reversed())
            .collect(Collectors.toList());
    }
}