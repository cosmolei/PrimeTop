# 服务端-学生AI辅导对话知识盲区实时检测与前置知识主动补救引擎-详细设计

## 1. 模块概述

### 1.1 功能定位

本引擎是 AI 辅导对话过程中的**实时认知诊断与自适应教学编排中间件**，部署在对话管理器与大模型调用层之间。它在每一轮对话交互中，被动分析学生提问内容、追问方式、回答反馈等多维度信号，实时识别学生是否存在前置知识盲区（即当前问题不理解的根本原因是某个先修知识点未掌握），并在适当时机主动插入前置知识补救教学，完成后再平滑返回原始学习话题。

### 1.2 与现有系统的关系

| 现有系统 | 职责 | 本引擎的差异 |
| --- | --- | --- |
| AI辅导对话知识点掌握度实时更新引擎 | 对话后更新知识点掌握度分数 | 本引擎在对话**过程中**做实时诊断并触发补救 |
| AI辅导对话嵌入式即时练习与实时理解度检测引擎 | 通过嵌入式小测验主动检测理解度 | 本引擎通过**被动信号分析**检测盲区，无需打断对话插入测验 |
| AI辅导对话情感感知与自适应回应策略引擎 | 检测学生情绪（沮丧、焦虑）并调整回应语气 | 本引擎检测**认知层面**的知识缺失，调整教学策略而非语气 |
| 学生学习卡点智能诊断与突破辅导策略推荐引擎 | 基于历史学习数据诊断卡点并推荐策略 | 本引擎在**单次对话内**做实时检测和即时补救 |
| 知识点前置依赖检测与学习路径推荐服务 | 学习路径开始前检查前置依赖 | 本引擎在学习过程中动态发现并补救前置缺失 |

### 1.3 核心价值

1. **减少学习挫败感**：学生在遇到前置知识不足时，AI 不会继续讲解新内容导致困惑加深，而是主动补位。
2. **提升单次对话学习效果**：一次对话不仅解决表面问题，还修复底层知识结构。
3. **积累知识盲区数据**：长期收集的前置知识盲区数据可用于优化学习路径推荐和内容生产。

### 1.4 适用范围

- 适用学段：小学至高中（幼儿阶段因对话交互能力有限，暂不纳入）
- 适用学科：全学科（语文、数学、英语、物理、化学、生物、历史、地理、政治）
- 适用场景：AI 文字问答、多轮追问、拍题答疑后的解析对话

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│                    AI 辅导对话主流程                       │
│                                                          │
│  学生消息 ──→ 意图识别 ──→ 上下文组装 ──→ LLM 调用 ──→ 回复
│                  │              │              │          │
│                  ▼              ▼              ▼          │
│  ┌──────────────────────────────────────────────────┐   │
│  │         知识盲区实时检测与补救引擎 (本模块)          │   │
│  │                                                    │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │   │
│  │  │ 盲区信号  │  │ 前置知识  │  │ 补救决策与   │   │   │
│  │  │ 采集器   │→│  推断器  │→│ 教学编排器   │   │   │
│  │  └──────────┘  └──────────┘  └──────────────┘   │   │
│  │        │                              │           │   │
│  │        ▼                              ▼           │   │
│  │  ┌──────────┐              ┌──────────────┐      │   │
│  │  │ 信号模型  │              │ 补救内容生成 │      │   │
│  │  │ 存储     │              │ 与Prompt组装 │      │   │
│  │  └──────────┘              └──────────────┘      │   │
│  └──────────────────────────────────────────────────┘   │
│         │                              │                 │
│         ▼                              ▼                 │
│  ┌──────────────┐           ┌────────────────┐          │
│  │ 知识图谱服务  │           │ 掌握度更新服务  │          │
│  └──────────────┘           └────────────────┘          │
└─────────────────────────────────────────────────────────┘
```

### 2.2 在对话流水线中的位置

```
对话流水线 (每轮交互):

1. 接收学生消息
2. 意图识别与场景路由
3. ★ 盲区信号采集 (本引擎 - 采集当前轮信号)
4. RAG 检索与上下文组装
5. ★ 盲区检测与前置推断 (本引擎 - 综合多轮信号判断)
6. ★ 补救决策 (本引擎 - 决定是否插入补救内容)
7. LLM Prompt 组装 (如需补救，注入补救指令)
8. LLM 调用与流式输出
9. ★ 补救状态跟踪 (本引擎 - 跟踪补救对话是否完成)
10. 后处理与知识点标注
11. ★ 掌握度更新 (本引擎 - 输出盲区诊断结果)
```

### 2.3 核心子系统

| 子系统 | 职责 | 技术要点 |
| --- | --- | --- |
| 盲区信号采集器 | 从对话内容中提取认知状态信号 | NLP 分类、规则匹配、学生画像查询 |
| 前置知识推断器 | 定位缺失的具体前置知识点 | 知识图谱遍历、贝叶斯推断 |
| 补救决策编排器 | 决定是否/何时/如何插入补救教学 | 决策树、频控策略、对话状态机 |
| 补救内容生成器 | 生成补救 mini-lesson 的 Prompt 指令 | Prompt 模板、分龄适配 |
| 补救状态跟踪器 | 跟踪补救会话的生命周期 | 状态机、超时机制 |

---

## 3. 数据结构定义

### 3.1 核心数据表

#### 3.1.1 `ai_gap_detection_signal` — 盲区检测信号表

存储每轮对话中采集到的认知状态信号。

```sql
CREATE TABLE ai_gap_detection_signal (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    signal_id       VARCHAR(64) NOT NULL UNIQUE COMMENT '信号唯一ID',
    conversation_id VARCHAR(64) NOT NULL COMMENT '所属对话会话ID',
    turn_id         INT NOT NULL COMMENT '当前对话轮次序号',
    student_id      BIGINT NOT NULL COMMENT '学生用户ID',
    
    -- 信号来源
    signal_source   VARCHAR(32) NOT NULL COMMENT '信号来源: QUESTION_PATTERN / RESPONSE_CONFUSION / FOLLOWUP_CLUSTER / EXPLICIT_ADMISSION / ERROR_PATTERN',
    
    -- 信号内容
    target_kp_id    VARCHAR(64) COMMENT '当前对话涉及的知识点ID',
    signal_type     VARCHAR(32) NOT NULL COMMENT '信号类型: PREREQUISITE_MISSING / CONCEPT_CONFUSION / METHOD_GAP / NOTATION_UNFAMILIAR / PROCEDURAL_ERROR',
    confidence      DECIMAL(4,3) NOT NULL DEFAULT 0 COMMENT '信号置信度 0-1',
    
    -- 信号详情 (JSON)
    signal_payload  JSON COMMENT '信号详细数据，如困惑关键词、错误模式等',
    
    -- 处理状态
    processed       TINYINT NOT NULL DEFAULT 0 COMMENT '是否已被推断器消费: 0未处理 1已处理',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_conversation_turn (conversation_id, turn_id),
    INDEX idx_student_kp (student_id, target_kp_id),
    INDEX idx_processed (processed, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI对话盲区检测信号表';
```

#### 3.1.2 `ai_prerequisite_gap_record` — 前置知识盲区诊断记录表

存储经推断器确认的前置知识盲区诊断结果。

```sql
CREATE TABLE ai_prerequisite_gap_record (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    record_id           VARCHAR(64) NOT NULL UNIQUE COMMENT '诊断记录ID',
    conversation_id     VARCHAR(64) NOT NULL COMMENT '对话会话ID',
    student_id          BIGINT NOT NULL COMMENT '学生ID',
    
    -- 诊断结果
    current_kp_id       VARCHAR(64) NOT NULL COMMENT '当前学习的知识点ID',
    missing_prereq_kp_id VARCHAR(64) NOT NULL COMMENT '缺失的前置知识点ID',
    gap_type            VARCHAR(32) NOT NULL COMMENT '盲区类型: COMPLETE_MISSING / PARTIAL_UNDERSTANDING / MISCONCEPTION / FORGOTTEN',
    gap_severity        VARCHAR(16) NOT NULL COMMENT '严重程度: LOW / MEDIUM / HIGH / CRITICAL',
    diagnosis_confidence DECIMAL(4,3) NOT NULL COMMENT '诊断置信度',
    
    -- 补救状态
    remediation_status  VARCHAR(24) NOT NULL DEFAULT 'PENDING' COMMENT '补救状态: PENDING / OFFERED / ACCEPTED / REJECTED / COMPLETED / EXPIRED / SKIPPED',
    remediation_turn_id INT COMMENT '补救教学发生的对话轮次',
    
    -- 信号来源 (JSON 数组，关联 ai_gap_detection_signal.signal_id)
    source_signals      JSON COMMENT '触发本次诊断的信号ID列表',
    
    -- 补救效果
    pre_remediation_mastery  DECIMAL(4,3) COMMENT '补救前掌握度',
    post_remediation_mastery DECIMAL(4,3) COMMENT '补救后掌握度',
    mastery_improvement      DECIMAL(4,3) COMMENT '掌握度提升幅度',
    
    -- 元数据
    subject_code        VARCHAR(16) NOT NULL COMMENT '学科代码',
    grade_level         INT NOT NULL COMMENT '学生年级',
    textbook_version    VARCHAR(32) NOT NULL COMMENT '教材版本',
    
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_record (record_id),
    INDEX idx_student_kp (student_id, missing_prereq_kp_id),
    INDEX idx_conversation (conversation_id),
    INDEX idx_status (remediation_status, created_at),
    INDEX idx_student_subject (student_id, subject_code, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI对话前置知识盲区诊断记录表';
```

#### 3.1.3 `ai_remediation_session` — 补救教学会话表

跟踪每次补救教学 mini-lesson 的完整生命周期。

```sql
CREATE TABLE ai_remediation_session (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    session_id          VARCHAR(64) NOT NULL UNIQUE COMMENT '补救会话ID',
    gap_record_id       VARCHAR(64) NOT NULL COMMENT '关联的盲区诊断记录ID',
    conversation_id     VARCHAR(64) NOT NULL COMMENT '主对话会话ID',
    student_id          BIGINT NOT NULL COMMENT '学生ID',
    
    -- 补救内容
    prereq_kp_id        VARCHAR(64) NOT NULL COMMENT '补救的前置知识点ID',
    remediation_strategy VARCHAR(32) NOT NULL COMMENT '补救策略: MINI_LESSON / ANALOGY / WORKED_EXAMPLE / VISUAL_DEMONSTRATION / STEP_BY_STEP_REVIEW',
    remediation_depth   VARCHAR(16) NOT NULL DEFAULT 'STANDARD' COMMENT '补救深度: BRIEF / STANDARD / THOROUGH',
    
    -- 会话状态
    status              VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' COMMENT '会话状态: ACTIVE / COMPLETED / ABANDONED / TIMEOUT',
    started_at_turn     INT NOT NULL COMMENT '开始的对话轮次',
    completed_at_turn   INT COMMENT '完成的对话轮次',
    turn_count          INT NOT NULL DEFAULT 0 COMMENT '补救消耗的对话轮数',
    
    -- 学生反馈
    student_response    VARCHAR(16) COMMENT '学生反应: ENGAGED / RELUCTANT / RESISTANT',
    follow_up_action    VARCHAR(24) COMMENT '补救后行为: RETURNED_TO_TOPIC / CONTINUED_EXPLORE / LEFT_CONVERSATION',
    
    -- 效果评估
    understanding_check_result VARCHAR(16) COMMENT '理解度检测: UNDERSTOOD / PARTIAL / STILL_CONFUSED',
    
    -- 时序
    started_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at        DATETIME,
    timeout_at          DATETIME COMMENT '超时时间点',
    
    INDEX idx_gap_record (gap_record_id),
    INDEX idx_conversation (conversation_id),
    INDEX idx_student_status (student_id, status),
    INDEX idx_timeout (timeout_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI补救教学会话表';
```

#### 3.1.4 `prerequisite_gap_profile` — 学生前置知识盲区画像表（聚合）

长期累积的学生前置知识盲区画像，用于个性化推荐和内容优化。

```sql
CREATE TABLE prerequisite_gap_profile (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    student_id          BIGINT NOT NULL COMMENT '学生ID',
    kp_id               VARCHAR(64) NOT NULL COMMENT '知识点ID',
    subject_code        VARCHAR(16) NOT NULL COMMENT '学科代码',
    
    -- 聚合统计
    total_gaps_detected INT NOT NULL DEFAULT 0 COMMENT '累计检测到的盲区次数',
    total_remediations  INT NOT NULL DEFAULT 0 COMMENT '累计补救次数',
    successful_remediations INT NOT NULL DEFAULT 0 COMMENT '成功补救次数',
    last_gap_at         DATETIME COMMENT '最近一次盲区检测时间',
    last_remediation_at DATETIME COMMENT '最近一次补救时间',
    
    -- 当前状态
    current_status      VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN' COMMENT '当前状态: UNKNOWN / IDENTIFIED_GAP / REMEDIATION_IN_PROGRESS / RESOLVED / RECURRENT_GAP',
    estimated_mastery   DECIMAL(4,3) COMMENT '估计掌握度',
    
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_student_kp (student_id, kp_id),
    INDEX idx_student_subject (student_id, subject_code),
    INDEX idx_status (current_status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生前置知识盲区画像表';
```

### 3.2 核心数据模型 (Java 伪代码)

```java
/**
 * 盲区检测信号 — 每轮对话产生的认知状态信号
 */
@Data
public class GapDetectionSignal {
    private String signalId;
    private String conversationId;
    private Integer turnId;
    private Long studentId;
    
    /** 信号来源 */
    private SignalSource signalSource;
    
    /** 当前对话知识点 */
    private String targetKpId;
    
    /** 信号类型 */
    private SignalType signalType;
    
    /** 置信度 0~1 */
    private BigDecimal confidence;
    
    /** 信号详情 */
    private SignalPayload payload;
    
    public enum SignalSource {
        QUESTION_PATTERN,       // 提问模式分析
        RESPONSE_CONFUSION,     // 学生回复中的困惑信号
        FOLLOWUP_CLUSTER,       // 追问聚类（连续追问同类基础问题）
        EXPLICIT_ADMISSION,     // 学生明确表示不会
        ERROR_PATTERN           // 错误模式匹配
    }
    
    public enum SignalType {
        PREREQUISITE_MISSING,   // 前置知识缺失
        CONCEPT_CONFUSION,      // 概念混淆
        METHOD_GAP,             // 方法/技能缺失
        NOTATION_UNFAMILIAR,    // 符号/记法不熟悉
        PROCEDURAL_ERROR        // 程序性错误（步骤顺序混乱）
    }
}

/**
 * 前置知识盲区诊断结果
 */
@Data
public class PrerequisiteGapRecord {
    private String recordId;
    private String conversationId;
    private Long studentId;
    
    private String currentKpId;          // 当前学习的知识点
    private String missingPrereqKpId;    // 缺失的前置知识点
    private GapType gapType;
    private GapSeverity gapSeverity;
    private BigDecimal diagnosisConfidence;
    
    private RemediationStatus remediationStatus;
    private Integer remediationTurnId;
    private List<String> sourceSignals;
    
    /** 补救效果 */
    private BigDecimal preRemediationMastery;
    private BigDecimal postRemediationMastery;
    
    public enum GapType {
        COMPLETE_MISSING,          // 完全未学过
        PARTIAL_UNDERSTANDING,    // 部分理解
        MISCONCEPTION,             // 存在错误理解
        FORGOTTEN                  // 学过但已遗忘
    }
    
    public enum GapSeverity {
        LOW, MEDIUM, HIGH, CRITICAL
    }
    
    public enum RemediationStatus {
        PENDING, OFFERED, ACCEPTED, REJECTED, COMPLETED, EXPIRED, SKIPPED
    }
}

/**
 * 补救决策结果
 */
@Data
public class RemediationDecision {
    private boolean shouldRemediate;       // 是否触发补救
    private RemediationStrategy strategy;  // 补救策略
    private RemediationDepth depth;        // 补救深度
    private String remediationPrompt;      // 注入给LLM的补救指令
    private String transitionPrompt;      // 从补救回到主题的过渡指令
    private long offerCooldownMinutes;     // 再次提议的冷却时间
    
    public enum RemediationStrategy {
        MINI_LESSON,             // 直接讲解前置知识
        ANALOGY,                 // 用类比/比喻解释
        WORKED_EXAMPLE,          // 给出完整例题演示
        VISUAL_DEMONSTRATION,    // 图形化演示
        STEP_BY_STEP_REVIEW      // 分步回顾基础概念
    }
    
    public enum RemediationDepth {
        BRIEF,      // 简要提及 (1-2句话)
        STANDARD,   // 标准讲解 (1段话+示例)
        THOROUGH    // 深入讲解 (多步骤+练习确认)
    }
}

/**
 * 补救教学会话状态机
 */
@Data
public class RemediationSession {
    private String sessionId;
    private String gapRecordId;
    private String conversationId;
    private Long studentId;
    private String prereqKpId;
    
    private RemediationSessionStatus status;
    private int startedAtTurn;
    private int completedAtTurn;
    private int turnCount;
    
    private String studentResponse;
    private String followUpAction;
    private String understandingCheckResult;
    
    private LocalDateTime startedAt;
    private LocalDateTime completedAt;
    private LocalDateTime timeoutAt;
    
    public enum RemediationSessionStatus {
        ACTIVE, COMPLETED, ABANDONED, TIMEOUT
    }
}
```

### 3.3 缓存结构 (Redis)

```python
# 1. 对话级盲区检测上下文 (Hash)
# Key: gap_detect:ctx:{conversation_id}
# TTL: 2小时 (对话结束后自动过期)
{
    "current_topic_kp": "kp_math_quadratic_formula",     # 当前讨论的知识点
    "current_subject": "MATH",                             # 当前学科
    "signals_in_window": "3",                              # 当前窗口内信号数
    "last_remediation_turn": "5",                          # 上次补救的轮次
    "remediation_active": "false",                         # 是否正在补救中
    "active_remediation_session": "",                      # 活跃补救会话ID
    "gap_history": "[...]",                                # 本次对话已检测到的盲区列表
    "student_mastery_snapshot": "{...}"                    # 对话开始时的掌握度快照
}

# 2. 学生补救冷却期 (String)
# Key: gap_detect:cooldown:{student_id}:{kp_id}
# Value: 过期时间戳
# TTL: 可配置，默认 30 分钟
# 用于防止同一知识点反复提议补救，造成学生反感

# 3. 补救会话状态 (Hash)
# Key: gap_detect:session:{session_id}
# TTL: 1小时
{
    "status": "ACTIVE",
    "prereq_kp_id": "kp_math_factoring",
    "started_turn": "5",
    "turn_count": "0",
    "max_turns": "5",
    "timeout_at": "2026-08-07T09:30:00"
}

# 4. 学生盲区频控 (Sorted Set)
# Key: gap_detect:freq:{student_id}:{date}
# Score: 时间戳, Member: kp_id
# TTL: 7天
# 用于统计单个学生每日被检测到盲区的频次，防止过度检测
```

---

## 4. 盲区信号采集器设计

### 4.1 信号采集架构

信号采集器在每轮对话中并行运行多个信号探测器，将结果汇总后输出。

```java
public interface GapSignalDetector {
    /**
     * 检测当前对话轮次中的认知盲区信号
     * @param context 对话上下文
     * @return 检测到的信号列表，空列表表示无信号
     */
    List<GapDetectionSignal> detect(ConversationContext context);
}

/**
 * 对话上下文 — 提供给各探测器的上下文信息
 */
@Data
@Builder
public class ConversationContext {
    private String conversationId;
    private Long studentId;
    private Integer currentTurnId;
    private String studentMessage;           // 学生当前轮消息原文
    private String previousAiResponse;       // 上一轮AI回复
    private List<TurnHistory> recentTurns;   // 最近N轮对话历史
    private String currentTopicKpId;         // 当前知识点
    private String subjectCode;              // 学科
    private StudentProfile studentProfile;   // 学生画像 (年级、学段、教材版本)
    private MasterySnapshot masterySnapshot; // 当前知识点及关联知识点的掌握度快照
}
```

### 4.2 信号探测器实现

#### 4.2.1 提问模式探测器 (QuestionPatternDetector)

分析学生提问方式中的基础性特征，判断是否暴露前置知识缺失。

```java
@Component
public class QuestionPatternDetector implements GapSignalDetector {
    
    // 基础性提问关键词模式库 (按学科+学段配置)
    private final QuestionPatternRegistry patternRegistry;
    
    @Override
    public List<GapDetectionSignal> detect(ConversationContext ctx) {
        List<GapDetectionSignal> signals = new ArrayList<>();
        String message = ctx.getStudentMessage();
        
        // 1. 匹配基础概念提问模式
        // 例: "什么是因式分解？" 在学习一元二次方程时出现
        List<QuestionPattern> matched = patternRegistry.match(
            message, ctx.getSubjectCode(), ctx.getCurrentTopicKpId()
        );
        
        for (QuestionPattern pattern : matched) {
            GapDetectionSignal signal = GapDetectionSignal.builder()
                .signalSource(SignalSource.QUESTION_PATTERN)
                .signalType(pattern.getInferredSignalType())
                .targetKpId(ctx.getCurrentTopicKpId())
                .confidence(pattern.getConfidence())
                .payload(SignalPayload.builder()
                    .matchedPattern(pattern.getPatternText())
                    .inferredPrereqKpId(pattern.getInferredPrereqKpId())
                    .studentGradeLevel(ctx.getStudentProfile().getGradeLevel())
                    .build())
                .build();
            signals.add(signal);
        }
        
        // 2. 检测"退化提问"模式
        // 学生在高级话题中提出非常基础的问题，暗示前置知识缺失
        if (isDegradedQuestion(message, ctx)) {
            signals.add(buildDegradedQuestionSignal(ctx, message));
        }
        
        return signals;
    }
    
    /**
     * 判断是否为退化提问
     * 退化提问 = 学生在当前学段不应再问的非常基础的问题
     * 例: 高中生在学二次函数时问"什么是变量"
     */
    private boolean isDegradedQuestion(String message, ConversationContext ctx) {
        int gradeLevel = ctx.getStudentProfile().getGradeLevel();
        BasicityScore score = basicityEvaluator.evaluate(message, gradeLevel, ctx.getSubjectCode());
        return score.isAbnormallyBasic();
    }
}
```

**提问模式规则示例：**

```yaml
# 提问模式规则配置 (存于数据库或配置中心)
question_patterns:
  - pattern_id: "QP_MATH_001"
    subject: "MATH"
    current_kp_keywords: ["二次方程", "求根公式", "判别式", "韦达定理"]
    basic_question_keywords:
      - "什么是因式分解"
      - "因式分解怎么算"
      - "什么是十字相乘"
      - "配方是什么意思"
    inferred_prereq_kp: "kp_math_polynomial_factoring"
    signal_type: "PREREQUISITE_MISSING"
    confidence: 0.85
    
  - pattern_id: "QP_PHYS_001"
    subject: "PHYSICS"
    current_kp_keywords: ["欧姆定律", "串并联电路", "电功率"]
    basic_question_keywords:
      - "什么是电流"
      - "电压和电流什么区别"
      - "电阻是什么"
    inferred_prereq_kp: "kp_physics_basic_circuit_concepts"
    signal_type: "PREREQUISITE_MISSING"
    confidence: 0.88
    
  - pattern_id: "QP_CHEM_001"
    subject: "CHEMISTRY"
    current_kp_keywords: ["化学平衡", "平衡常数", "勒夏特列原理"]
    basic_question_keywords:
      - "什么是可逆反应"
      - "浓度怎么算"
      - "摩尔是什么"
    inferred_prereq_kp: "kp_chem_reaction_basics"
    signal_type: "PREREQUISITE_MISSING"
    confidence: 0.82
```

#### 4.2.2 困惑回复探测器 (ResponseConfusionDetector)

分析学生回复中