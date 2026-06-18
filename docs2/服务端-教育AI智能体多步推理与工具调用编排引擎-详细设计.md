# 教育AI智能体多步推理与工具调用编排引擎 - 详细设计

> **文档版本：** v1.0  
> **创建日期：** 2026-06-19  
> **所属模块：** AI 能力层 / AI 智能辅导  
> **优先级：** P1（V1.5 阶段核心能力）

---

## 1. 概述

### 1.1 设计目标

为 PrimeTop 的 AI 辅导场景引入 **智能体（Agent）** 能力，使 AI 不仅能"一次性回答"，还能：

1. **自主规划**：将复杂的学科问题分解为多个推理步骤
2. **调用工具**：在推理过程中按需调用计算器、知识图谱查询、公式校验等外部工具
3. **中间验证**：对每一步推理结果进行正确性校验，发现错误时自动回溯
4. **结果合成**：将多步推理和工具调用结果整合为结构化、适龄化的最终回答

### 1.2 与现有模块的边界

| 现有模块 | 职责 | 本引擎的差异 |
|---------|------|-------------|
| AI-Prompt 编排与场景模板系统 | 按场景选择 Prompt 模板 | 本引擎在 Prompt 之上增加 **自主推理循环** |
| AI 辅导全链路请求处理与编排 | 请求路由、安全过滤、响应后处理 | 本引擎是全链路中的 **推理执行单元** |
| 多模型调度与成本治理 | 模型选择、负载均衡、成本统计 | 本引擎决定 **是否需要多步调用** 及工具选择 |
| AI 模型上下文管理与对话记忆 | 对话历史压缩与长期记忆 | 本引擎管理 **单次推理的任务上下文** |
| 学习场景意图识别与智能路由 | 识别用户意图并路由到处理流程 | 本引擎接收路由后的复杂任务并 **自主执行** |

### 1.3 适用场景

| 场景 | 典型问题 | 需要的工具 |
|------|---------|-----------|
| 复杂理科解题 | 多步骤数学证明、物理综合题、化学平衡计算 | 计算器、公式校验器、单位换算、图形分析 |
| 跨学科综合 | "结合化学反应方程式计算产物质量并分析实验误差" | 化学方程式解析器、计算器、知识查询 |
| 作文深度批改 | 议论文逻辑链分析、素材适配性评估 | 文本分析、引用查证、评分模型 |
| 知识图谱推理 | "函数单调性与导数的关系，如果函数在某区间不单调怎么分析？" | 知识图谱查询、概念关联检索 |
| 错题归因分析 | 学生连续错在同一类题型，需要深度归因 | 学习记录查询、知识点掌握度查询、模式匹配 |

### 1.4 设计原则

1. **安全优先**：Agent 的每一步推理和工具调用都经过安全检查
2. **成本可控**：设置最大推理步数、最大工具调用次数和总 Token 预算
3. **可观测**：完整记录推理链路，支持回放和调试
4. **可降级**：Agent 执行超时或异常时，降级为单次 LLM 调用
5. **渐进增强**：MVP 阶段仅支持简单工具链，后续逐步扩展

---

## 2. 系统架构

### 2.1 总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    AI 辅导全链路请求处理                          │
│                         (已有模块)                                │
│  用户请求 → 意图识别 → 安全过滤 → ┬─→ 简单问题 → 直接 LLM 调用   │
│                                   │                              │
│                                   └─→ 复杂问题 → Agent 引擎 ──┐  │
│                                                               │  │
│  ┌──────────────────────────────────────────────────────────┐ │  │
│  │              Agent 多步推理编排引擎                        │ │  │
│  │                                                          │ │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │ │  │
│  │  │ Planner  │→ │ Executor │→ │ Verifier │→ │Synthesizer│ │  │
│  │  │ 任务规划  │  │ 工具执行  │  │ 结果验证  │  │ 答案合成 │ │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │ │  │
│  │       ↑             ↑↑             ↑                     │ │  │
│  │       │     ┌───────┴┴───────┐     │                     │ │  │
│  │       │     │  Tool Registry │     │                     │ │  │
│  │       │     │  工具注册中心   │     │                     │ │  │
│  │       │     └────────────────┘     │                     │ │  │
│  │       │                            │                     │ │  │
│  │  ┌────┴────────────────────────────┴──────────────────┐  │ │  │
│  │  │              Agent State Manager                    │  │ │  │
│  │  │              状态管理与执行上下文                     │  │ │  │
│  │  └─────────────────────────────────────────────────────┘  │ │  │
│  └──────────────────────────────────────────────────────────┘ │  │
│                                                               │  │
│  最终回答 ← 响应后处理 ← 适龄化适配 ← ─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件

| 组件 | 职责 |
|------|------|
| **Agent Orchestrator** | Agent 生命周期管理，控制推理循环 |
| **Planner** | 任务分解，生成推理计划 |
| **Executor** | 执行工具调用，管理并行/串行策略 |
| **Verifier** | 中间结果验证，错误检测和回溯决策 |
| **Synthesizer** | 合成最终答案，结构化输出 |
| **Tool Registry** | 工具注册、发现、权限管控 |
| **Agent State Manager** | 执行状态、上下文、预算追踪 |
| **Execution Trace Logger** | 推理链路记录，支持回放和审计 |

### 2.3 Agent 执行流程（ReAct 模式增强版）

```
用户问题输入
    │
    ▼
┌──────────────────────────┐
│ Step 0: 任务评估          │
│ - 判断是否需要 Agent 模式  │
│ - 设置推理预算             │
└────────────┬─────────────┘
             │ 需要 Agent
             ▼
┌──────────────────────────┐
│ Step 1: 规划 (Plan)       │
│ - LLM 分析问题结构         │
│ - 生成分步推理计划          │
│ - 选择需要的工具集          │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ Step 2: 执行 (Act)        │ ◄──── 回溯重试
│ - 执行当前步骤             │
│ - 调用工具或 LLM 推理       │
│ - 记录中间结果             │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ Step 3: 验证 (Verify)     │
│ - 检查结果合理性           │
│ - 单位/量纲校验            │
│ - 逻辑一致性检查            │
│ - 数值范围校验             │
└────────────┬─────────────┘
             │
      ┌──────┴──────┐
      │             │
   验证通过      验证失败
      │             │
      │             ├──→ 回溯（重试当前步骤，最多 2 次）
      │             │
      │             └──→ 标记异常，继续（记录告警）
      │
      ▼
┌──────────────────────────┐
│ 还有未完成步骤？           │
├──────┬───────────────────┤
│  是  │       否           │
│  ↓   │       ↓            │
│ 回到 Step 2    Step 4     │
└──────────────────────────┘
             │
             ▼
┌──────────────────────────┐
│ Step 4: 合成 (Synthesize) │
│ - 整合所有中间结果          │
│ - 生成结构化回答            │
│ - 适龄化语言适配            │
│ - 添加知识点点标注          │
└────────────┬─────────────┘
             │
             ▼
        最终回答输出
```

---

## 3. 数据结构定义

### 3.1 核心实体模型

#### 3.1.1 AgentSession（Agent 会话）

```java
/**
 * Agent 推理会话，一次用户问题对应一个 AgentSession
 */
@Data
@Builder
public class AgentSession {
    
    /** 会话唯一ID */
    private String sessionId;
    
    /** 关联的用户ID */
    private Long userId;
    
    /** 关联的AI对话消息ID */
    private String conversationMessageId;
    
    /** 用户原始问题 */
    private String userQuery;
    
    /** 用户上下文（年级、学科、教材版本等） */
    private AgentUserContext userContext;
    
    /** 会话状态 */
    private AgentSessionStatus status;
    
    /** 推理计划 */
    private ReasoningPlan plan;
    
    /** 执行步骤列表 */
    private List<ExecutionStep> steps;
    
    /** 工具调用记录 */
    private List<ToolCallRecord> toolCalls;
    
    /** 最终合成结果 */
    private AgentResult result;
    
    /** 预算控制 */
    private AgentBudget budget;
    
    /** 会话元数据 */
    private Map<String, String> metadata;
    
    /** 创建时间 */
    private OffsetDateTime createdAt;
    
    /** 更新时间 */
    private OffsetDateTime updatedAt;
    
    /** 超时时间（秒） */
    private Integer timeoutSeconds;
}
```

#### 3.1.2 AgentUserContext（用户上下文）

```java
/**
 * Agent 执行时的用户上下文信息
 */
@Data
@Builder
public class AgentUserContext {
    
    /** 学段: KINDERGARTEN / PRIMARY / JUNIOR / SENIOR */
    private StageType stage;
    
    /** 年级 */
    private Integer gradeLevel;
    
    /** 学科 */
    private SubjectType subject;
    
    /** 教材版本ID */
    private String textbookEditionId;
    
    /** 当前学习章节ID */
    private String chapterId;
    
    /** 用户当前能力等级（1-10） */
    private Integer proficiencyLevel;
    
    /** 语言偏好 */
    private String locale;
    
    /** 是否需要启发式引导（低年级默认 true） */
    private Boolean enableScaffolding;
    
    /** 最大提示深度（渐进式提示的最大层数） */
    private Integer maxHintDepth;
}
```

#### 3.1.3 ReasoningPlan（推理计划）

```java
/**
 * LLM 生成的推理计划
 */
@Data
@Builder
public class ReasoningPlan {
    
    /** 计划ID */
    private String planId;
    
    /** 问题类型分类 */
    private ProblemType problemType;
    
    /** 问题摘要 */
    private String problemSummary;
    
    /** 推理步骤列表 */
    private List<PlannedStep> plannedSteps;
    
    /** 预计需要的工具列表 */
    private List<String> requiredToolNames;
    
    /** 预计总推理步数 */
    private Integer estimatedSteps;
    
    /** 复杂度等级: SIMPLE / MODERATE / COMPLEX / HIGHLY_COMPLEX */
    private ComplexityLevel complexity;
    
    /** 是否允许并行执行 */
    private Boolean allowParallel;
}

@Data
@Builder
public class PlannedStep {
    
    /** 步骤序号（从1开始） */
    private Integer stepOrder;
    
    /** 步骤描述 */
    private String description;
    
    /** 步骤类型 */
    private StepType stepType;
    
    /** 预期使用的工具名（可为null，表示纯LLM推理） */
    private String toolName;
    
    /** 工具输入提示 */
    private String toolInputHint;
    
    /** 本步骤依赖的前序步骤序号 */
    private List<Integer> dependsOn;
    
    /** 本步骤的学习目标/知识点 */
    private List<String> knowledgePointIds;
}

public enum StepType {
    ANALYZE,        // 问题分析
    CALCULATE,      // 计算
    QUERY,          // 知识查询
    VERIFY,         // 验证
    TRANSFORM,      // 转换/变形
    DEDUCE,         // 推导
    SYNTHESIZE      // 综合
}
```

#### 3.1.4 ExecutionStep（执行步骤）

```java
/**
 * 单个推理步骤的执行记录
 */
@Data
@Builder
public class ExecutionStep {
    
    /** 步骤唯一ID */
    private String stepId;
    
    /** 对应计划中的步骤序号 */
    private Integer planStepOrder;
    
    /** 步骤状态 */
    private StepStatus status;
    
    /** LLM 推理内容（Act阶段的思考过程） */
    private String reasoning;
    
    /** 工具调用（如果有） */
    private ToolCallRecord toolCall;
    
    /** 步骤输出结果 */
    private String output;
    
    /** 验证结果 */
    private VerificationResult verification;
    
    /** 执行耗时（毫秒） */
    private Long durationMs;
    
    /** Token 消耗 */
    private TokenUsage tokenUsage;
    
    /** 重试次数 */
    private Integer retryCount;
    
    /** 时间戳 */
    private OffsetDateTime executedAt;
    
    /** 错误信息（如果有） */
    private String errorMessage;
}

public enum StepStatus {
    PENDING,        // 等待执行
    EXECUTING,      // 执行中
    AWAITING_TOOL,  // 等待工具返回
    VERIFYING,      // 验证中
    COMPLETED,      // 已完成
    FAILED,         // 失败
    SKIPPED,        // 跳过（因前序步骤失败）
    RETRYING        // 重试中
}
```

#### 3.1.5 ToolCallRecord（工具调用记录）

```java
/**
 * 工具调用详细记录
 */
@Data
@Builder
public class ToolCallRecord {
    
    /** 调用唯一ID */
    private String callId;
    
    /** 工具名称 */
    private String toolName;
    
    /** 工具版本 */
    private String toolVersion;
    
    /** 输入参数（JSON） */
    private String inputJson;
    
    /** 输出结果（JSON） */
    private String outputJson;
    
    /** 调用状态 */
    private ToolCallStatus status;
    
    /** 耗时（毫秒） */
    private Long durationMs;
    
    /** 错误信息 */
    private String error;
    
    /** 来源步骤ID */
    private String sourceStepId;
}

public enum ToolCallStatus {
    SUCCESS,
    FAILED,
    TIMEOUT,
    INVALID_INPUT,
    RATE_LIMITED
}
```

#### 3.1.6 AgentBudget（预算控制）

```java
/**
 * Agent 执行的资源和成本预算
 */
@Data
@Builder
public class AgentBudget {
    
    /** 最大推理步数 */
    private Integer maxSteps;
    
    /** 已执行步数 */
    private Integer usedSteps;
    
    /** 最大工具调用次数 */
    private Integer maxToolCalls;
    
    /** 已使用工具调用次数 */
    private Integer usedToolCalls;
    
    /** 最大 LLM Token 预算 */
    private Integer maxTokens;
    
    /** 已消耗 Token */
    private Integer usedTokens;
    
    /** 最大执行时长（秒） */
    private Integer maxDurationSeconds;
    
    /** 实际执行时长（秒） */
    private Integer usedDurationSeconds;
    
    /** 最大重试次数（总） */
    private Integer maxRetries;
    
    /** 已使用重试次数 */
    private Integer usedRetries;
    
    /**
     * 检查预算是否耗尽
     */
    public boolean isExhausted() {
        return usedSteps >= maxSteps 
            || usedToolCalls >= maxToolCalls
            || usedTokens >= maxTokens
            || usedDurationSeconds >= maxDurationSeconds
            || usedRetries >= maxRetries;
    }
    
    /**
     * 计算剩余预算百分比
     */
    public double remainingPercentage() {
        double stepRatio = 1.0 - (double) usedSteps / maxSteps;
        double tokenRatio = 1.0 - (double) usedTokens / maxTokens;
        double durationRatio = 1.0 - (double) usedDurationSeconds / maxDurationSeconds;
        return Math.min(stepRatio, Math.min(tokenRatio, durationRatio));
    }
}
```

#### 3.1.7 AgentResult（Agent 最终结果）

```java
/**
 * Agent 执行的最终合成结果
 */
@Data
@Builder
public class AgentResult {
    
    /** 最终回答文本（Markdown格式） */
    private String answer;
    
    /** 回答结构化分段 */
    private List<AnswerSection> sections;
    
    /** 涉及的知识点列表 */
    private List<String> knowledgePoints;
    
    /** 关联的教材章节 */
    private List<String> relatedChapters;
    
    /** 推理摘要（用于展示给用户） */
    private String reasoningSummary;
    
    /** 置信度评分（0.0 ~ 1.0） */
    private Double confidence;
    
    /** 是否发生过回溯 */
    private Boolean hadBacktrack;
    
    /** 是否降级为直接LLM调用 */
    private Boolean degraded;
    
    /** 执行统计 */
    private ExecutionStats stats;
    
    /** 质量自评 */
    private QualitySelfAssessment quality;
}

@Data
@Builder
public class AnswerSection {
    
    /** 段落类型 */
    private SectionType type;
    
    /** 段落标题 */
    private String title;
    
    /** 段落内容（Markdown） */
    private String content;
    
    /** 排序序号 */
    private Integer order;
}

public enum SectionType {
    PROBLEM_ANALYSIS,    // 题目分析
    IDEA,               // 解题思路
    STEP,               // 解题步骤
    FORMULA,            // 公式说明
    VERIFICATION,       // 验证过程
    SUMMARY,            // 总结归纳
    TIP,                // 易错提醒
    EXTENSION           // 拓展延伸
}

@Data
@Builder
public class ExecutionStats {
    private Integer totalSteps;
    private Integer successfulSteps;
    private Integer failedSteps;
    private Integer totalRetries;
    private Integer totalToolCalls;
    private Integer totalTokens;
    private Long totalDurationMs;
}
```

#### 3.1.8 VerificationResult（验证结果）

```java
/**
 * 单步推理结果的验证结论
 */
@Data
@Builder
public class VerificationResult {
    
    /** 是否通过验证 */
    private Boolean passed;
    
    /** 验证维度 */
    private List<VerificationCheck> checks;
    
    /** 综合置信度 */
    private Double confidence;
    
    /** 验证失败原因（如果有） */
    private String failureReason;
    
    /** 建议动作 */
    private VerificationAction suggestedAction;
}

@Data
@Builder
public class VerificationCheck {
    
    /** 检查类型 */
    private CheckType checkType;
    
    /** 检查描述 */
    private String description;
    
    /** 是否通过 */
    private Boolean passed;
    
    /** 检查详情 */
    private String detail;
}

public enum CheckType {
    DIMENSIONAL_CONSISTENCY,  // 量纲/单位一致性
    NUMERIC_RANGE,            // 数值范围合理性
    LOGICAL_CONSISTENCY,      // 逻辑一致性
    FORMULA_CORRECTNESS,      // 公式正确性
    ANSWER_COMPLETENESS,      // 答案完整性
    SIGN_CONVENTION,          // 符号约定
    BOUNDARY_CONDITION        // 边界条件
}

public enum VerificationAction {
    PROCEED,          // 继续
    RETRY,            // 重试当前步骤
    ADJUST_PLAN,      // 调整后续计划
    FALLBACK_SIMPLE,  // 降级为简单回答
    ABORT             // 终止
}
```

### 3.2 数据库表设计

#### 3.2.1 agent_session 表

```sql
CREATE TABLE agent_session (
    id              BIGINT          PRIMARY KEY AUTO_INCREMENT,
    session_id      VARCHAR(64)     NOT NULL UNIQUE COMMENT 'Agent会话唯一ID',
    user_id         BIGINT          NOT NULL COMMENT '用户ID',
    conversation_msg_id VARCHAR(64) NOT NULL COMMENT '关联AI对话消息ID',
    user_query      TEXT            NOT NULL COMMENT '用户原始问题',
    stage           VARCHAR(20)     NOT NULL COMMENT '学段',
    grade_level     INT             NOT NULL COMMENT '年级',
    subject         VARCHAR(20)     NOT NULL COMMENT '学科',
    status          VARCHAR(20)     NOT NULL DEFAULT 'INITIALIZED' COMMENT '会话状态',
    problem_type    VARCHAR(50)     COMMENT '问题类型',
    complexity      VARCHAR(20)     COMMENT '复杂度',
    
    -- 预算字段
    max_steps       INT             NOT NULL DEFAULT 8 COMMENT '最大推理步数',
    used_steps      INT             NOT NULL DEFAULT 0,
    max_tool_calls  INT             NOT NULL DEFAULT 5 COMMENT '最大工具调用次数',
    used_tool_calls INT             NOT NULL DEFAULT 0,
    max_tokens      INT             NOT NULL DEFAULT 8000 COMMENT '最大Token预算',
    used_tokens     INT             NOT NULL DEFAULT 0,
    max_duration_sec INT            NOT NULL DEFAULT 30 COMMENT '最大执行时长(秒)',
    used_duration_sec INT           NOT NULL DEFAULT 0,
    
    -- 结果字段
    final_answer    MEDIUMTEXT      COMMENT '最终回答(Markdown)',
    confidence      DECIMAL(3,2)    COMMENT '置信度',
    had_backtrack   TINYINT(1)      DEFAULT 0 COMMENT '是否发生过回溯',
    degraded        TINYINT(1)      DEFAULT 0 COMMENT '是否降级',
    
    -- 完整执行轨迹（JSON）
    execution_trace JSON            COMMENT '完整执行轨迹(含所有步骤和工具调用)',
    
    created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    completed_at    DATETIME(3)     NULL COMMENT '完成时间',
    
    INDEX idx_user_id (user_id),
    INDEX idx_conversation_msg (conversation_msg_id),
    INDEX idx_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Agent推理会话';
```

#### 3.2.2 agent_tool_call_log 表

```sql
CREATE TABLE agent_tool_call_log (
    id              BIGINT          PRIMARY KEY AUTO_INCREMENT,
    call_id         VARCHAR(64)     NOT NULL UNIQUE COMMENT '调用唯一ID',
    session_id      VARCHAR(64)     NOT NULL COMMENT 'Agent会话ID',
    step_id         VARCHAR(64)     NOT NULL COMMENT '来源步骤ID',
    tool_name       VARCHAR(100)    NOT NULL COMMENT '工具名称',
    tool_version    VARCHAR(20)     NOT NULL DEFAULT '1.0.0',
    input_json      JSON            NOT NULL COMMENT '输入参数',
    output_json     JSON            COMMENT '输出结果',
    status          VARCHAR(20)     NOT NULL COMMENT '调用状态',
    duration_ms     BIGINT          NOT NULL DEFAULT 0 COMMENT '耗时(毫秒)',
    error_msg       TEXT            COMMENT '错误信息',
    called_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    
    INDEX idx_session (session_id),
    INDEX idx_tool_name (tool_name),
    INDEX idx_called_at (called_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Agent工具调用日志';
```

#### 3.2.3 agent_tool_registry 表

```sql
CREATE TABLE agent_tool_registry (
    id              BIGINT          PRIMARY KEY AUTO_INCREMENT,
    tool_name       VARCHAR(100)    NOT NULL UNIQUE COMMENT '工具唯一名称',
    display_name    VARCHAR(100)    NOT NULL COMMENT '展示名称',
    description     TEXT            NOT NULL COMMENT '工具描述',
    category        VARCHAR(50)     NOT NULL COMMENT '工具类别',
    version         VARCHAR(20)     NOT NULL DEFAULT '1.0.0',
    status          VARCHAR(20)     NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE/DEPRECATED/DISABLED',
    
    -- 输入输出Schema (JSON Schema)
    input_schema    JSON            NOT NULL COMMENT '输入参数Schema',
    output_schema   JSON            NOT NULL COMMENT '输出参数Schema',
    
    -- 适用条件
    applicable_subjects JSON        NOT NULL COMMENT '适用学科列表',
    applicable_stages JSON          NOT NULL COMMENT '适用学段列表',
    
    -- 限流配置
    rate_limit_per_sec INT          DEFAULT 10 COMMENT '每秒最大调用次数',
    timeout_ms      INT             NOT NULL DEFAULT 5000 COMMENT '调用超时(毫秒)',
    
    -- 成本权重（用于预算计算，1个工具调用 = cost_weight 个 token）
    cost_weight     INT             NOT NULL DEFAULT 200 COMMENT '工具调用成本权重',
    
    created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Agent工具注册表';
```

---

## 4. 工具注册中心设计

### 4.1 工具分类体系

```
工具注册中心 (Tool Registry)
│
├── 📐 数学工具 (Math)
│   ├── math_calculator          # 安全表达式计算器
│   ├── symbolic_solver          # 符号计算（方程求解、因式分解）
│   ├── geometry_analyzer        # 几何图形分析
│   ├── function_plotter         # 函数图像生成
│   └── unit_converter           # 单位换算
│
├── 🔬 理科工具 (Science)
│   ├── chemical_equation_parser  # 化学方程式解析与配平
│   ├── physics_formula_lookup   # 物理公式检索
│   ├── periodic_table_query     # 元素周期表查询
│   ├── biology_diagram_analyzer # 生物图表分析
│   └── experiment_simulator     # 虚拟实验模拟
│
├── 📚 知识工具 (Knowledge)
│   ├── knowledge_graph_query    # 知识图谱查询
│   ├── textbook_search          # 教材内容检索
│   ├── exam_point_lookup        # 考点查询
│   └── similar_problem_finder   # 相似题推荐
│
├── 📝 语言工具 (Language)
│   ├── text_analyzer            # 文本分析（语法、修辞）
│   ├── chinese_classic_lookup   # 古诗文检索与注释
│   ├── english_dictionary       # 英语词典与例句
│   └── phonetic_checker         # 拼音/音标检查
│
├── ✅ 验证工具 (Verification)
│   ├── formula_verifier         # 公式正确性校验
│   ├── numeric_range_checker    # 数值范围合理性检查
│   ├── dimensional_analyzer     # 量纲/单位一致性检查
│   └── logic_consistency_checker # 逻辑一致性检查
│
└── 📊 分析工具 (Analysis)
    ├── student_proficiency_query # 学生知识点掌握度查询
    ├── mistake_pattern_analyzer  # 错题模式分析
    └── learning_progress_query   # 学习进度查询
```

### 4.2 工具接口定义

```java
/**
 * Agent 工具统一接口
 */
public interface AgentTool {
    
    /**
     * 工具唯一名称
     */
    String getName();
    
    /**
     * 工具描述（供 LLM 理解工具用途）
     */
    String getDescription();
    
    /**
     * 输入参数 Schema (JSON Schema 格式)
     */
    String getInputSchema();
    
    /**
     * 输出结果 Schema
     */
    String getOutputSchema();
    
    /**
     * 执行工具调用
     * 
     * @param input    输入参数（已通过 Schema 校验）
     * @param context   执行上下文（用户信息、会话信息等）
     * @return         工具执行结果
     */
    ToolExecutionResult execute(JsonNode input, AgentExecutionContext context);
    
    /**
     * 检查当前用户是否有权限使用此工具
     */
    default boolean checkPermission(AgentUserContext userContext) {
        return true;
    }
    
    /**
     * 估算执行耗时（用于计划阶段）
     */
    default int estimatedDurationMs() {
        return 1000;
    }
}
```

### 4.3 工具执行结果

```java
@Data
@Builder
public class ToolExecutionResult {
    
    /** 是否成功 */
    private boolean success;
    
    /** 输出数据 (JSON) */
    private JsonNode output;
    
    /** 错误类型（失败时） */
    private ToolErrorType errorType;
    
    /** 错误信息 */
    private String errorMessage;
    
    /** 执行耗时（毫秒） */
    private long durationMs;
    
    /** 附加元数据 */
    private Map<String, String> metadata;
}

public enum ToolErrorType {
    INVALID_INPUT,      // 输入参数无效
    EXECUTION_ERROR,    // 执行错误
    TIMEOUT,            // 超时
    RATE_LIMITED,       // 限流
    PERMISSION_DENIED,  // 权限不足
    SERVICE_UNAVAILABLE // 服务不可用
}
```

### 4.4 关键工具实现示例

#### 4.4.1 数学计算器工具

```java
@Component
public class MathCalculatorTool implements AgentTool {
    
    private final SafeExpressionEvaluator evaluator;
    
    @Override
    public String getName() {
        return "math_calculator";
    }
    
    @Override
    public String getDescription() {
        return "安全数学表达式计算器，支持四则运算、幂运算、三角函数、对数、" +
               "排列组合等。适用于需要精确数值计算的场景。不支持符号计算。";
    }
    
    @Override
    public String getInputSchema() {
        return """
            {
              "type": "object",
              "properties": {
                "expression": {
                  "type": "string",
                  "description": "数学表达式，如 '2*sin(30°) + sqrt(3)'"
                },
                "precision": {
                  "type": "integer",
                  "description": "小数精度位数，默认4",
                  "default": 4
                }
              },
              "required": ["expression"]
            }
            """;
    }
    
    @Override
    public ToolExecutionResult execute(JsonNode input, AgentExecutionContext context) {
        long start = System.currentTimeMillis();
        try {
            String expression = input.get("expression").asText();
            int precision = input.has("precision") ? input.get("precision").asInt() : 4;
            
            // 安全评估表达式（沙箱内执行，禁止系统调用）
            BigDecimal result = evaluator.evaluate(expression, precision);
            
            ObjectNode output = JsonUtils.createObjectNode();
            output.put("expression", expression);
            output.put("result", result.toPlainString());
            output.put("precision", precision);
            
            return ToolExecutionResult.builder()
                .success(true)
                .output(output)
                .durationMs(System.currentTimeMillis() - start)
                .build();
                
        } catch (InvalidExpressionException e) {
            return ToolExecutionResult.builder()
                .success(false)
                .errorType(ToolErrorType.INVALID_INPUT)
                .errorMessage("表达式无效: " + e.getMessage())
                .durationMs(System.currentTimeMillis() - start)
                .build();
        } catch (Exception e) {
            return ToolExecutionResult.builder()
                .success(false)
                .errorType(ToolErrorType.EXECUTION_ERROR)
                .errorMessage("计算错误: " + e.getMessage())
                .durationMs(System.currentTimeMillis() - start)
                .build();
        }
    }
}
```

#### 4.4.2 安全表达式评估器（沙箱）

```java
/**
 * 安全数学表达式评估器
 * 基于 ANTLR4 解析 + 白名单运算符，禁止任何 Java 反射和系统调用
 */
@Component
public class SafeExpressionEvaluator {
    
    private static final Set<String> ALLOWED_FUNCTIONS = Set.of(
        "sin", "cos", "tan", "asin", "acos", "atan",
        "sinh", "cosh", "tanh",
        "log", "log2", "log10", "ln", "exp",
        "sqrt", "cbrt", "abs", "signum",
        "floor", "ceil", "round",
        "max", "min", "pow", "mod",
        "factorial", "permutation", "combination"
    );
    
    private static final int MAX_EXPRESSION_LENGTH = 500;
    private static final int MAX_NESTING_DEPTH = 20;
    
    public BigDecimal evaluate(String expression, int precision) {
        // 1. 长度检查
        if (expression.length() > MAX_EXPRESSION_LENGTH) {
            throw new InvalidExpressionException("表达式过长");
        }
        
        // 2. 括号深度检查
        validateNestingDepth(expression);
        
        // 3. 危险字符过滤
        sanitizeExpression(expression);
        
        // 4. 解析并计算
        MathExpressionParser parser = new MathExpressionParser(expression);
        BigDecimal result = parser.evaluate(precision);
        
        // 5. 结果范围检查
        validateResultRange(result);
        
        return result;
    }
    
    private void sanitizeExpression(String expr) {
        // 禁止字母组合中出现非数学函数的标识符
        // 禁止 ; {} [] 等代码注入字符
        String sanitized = expr.replaceAll("\\s+", "");
        if (sanitized.matches(".*[;{}\\[\\]<>?=].*")) {
            throw new InvalidExpressionException("表达式包含非法字符");
        }
    }
    
    private void validateResultRange(BigDecimal result) {
        BigDecimal max = new BigDecimal("1E308");
        BigDecimal min = new BigDecimal("-1E308");
        if (result.compareTo(max) > 0 || result.compareTo(min) < 0) {
            throw new InvalidExpressionException("计算结果超出合理范围");
        }
    }
}
```

#### 4.4.3 知识图谱查询工具

```java
@Component
public class KnowledgeGraphQueryTool implements AgentTool {
    
    private final KnowledgeGraphService graphService;
    
    @Override
    public String getName() {
        return "knowledge_graph_query";
    }
    
    @Override
    public String getDescription() {
        return "查询知识点关联关系，包括前置依赖、后续延伸、相关概念、所属章节等。" +
               "适用于需要建立知识间联系的场景。";
    }
    
    @Override
    public String getInputSchema() {
        return """
            {
              "type": "object",
              "properties": {
                "query_type": {
                  "type": "string",
                  "enum": ["prerequisites", "dependents", "related", "path", "detail"],
                  "description": "查询类型：前置知识点/后续知识点/相关概念/学习路径/知识点详情"
                },
                "knowledge_point_id": {
                  "type": "string",
                  "description": "知识点ID"
                },
                "knowledge_point_name": {
                  "type": "string",
                  "description": "知识点名称（当ID未知时使用）"
                },
                "subject": {
                  "type": "string",
                  "description": "学科"
                },
                "depth": {
                  "type": "integer",
                  "description": "查询深度（默认1层）",
                  "default": 1
                }
              }
            }
            """;
    }
    
    @Override
    public ToolExecutionResult execute(JsonNode input, AgentExecutionContext context) {
        long start = System.currentTimeMillis();
        try {
            String queryType = input.get("query_type").asText();
            String kpId = input.has("knowledge_point_id") 
                ? input.get("knowledge_point_id").asText() 
                : graphService.findKnowledgePointIdByName(
                    input.get("knowledge_point_name").asText(),
                    input.get("subject").asText()
                  );
            
            int depth = input.has("depth") ? input.get("depth").asInt() : 1;
            
            JsonNode result = switch (queryType) {
                case "prerequisites" -> graphService.findPrerequisites(kpId, depth);
                case "dependents" -> graphService.findDependents(kpId, depth);
                case "related" -> graphService.findRelatedConcepts(kpId, depth);
                case "path" -> graphService.findLearningPath(kpId);
                case "detail" -> graphService.getKnowledgePointDetail(kpId);
                default -> throw new InvalidInputException("未知查询类型: " + queryType);
            };
            
            return ToolExecutionResult.builder()
                .success(true)
                .output(result)
                .durationMs(System.currentTimeMillis() - start)
                .metadata(Map.of("query_type", queryType, "knowledge_point_id", kpId))
                .build();
                
        } catch (Exception e) {
            return ToolExecutionResult.builder()
                .success(false)
                .errorType(ToolErrorType.EXECUTION_ERROR)
                .errorMessage("知识图谱查询失败: " + e.getMessage())
                .durationMs(System.currentTimeMillis() - start)
                .build();
        }
    }
}
```

---

## 5. 核心引擎实现

### 5.1 Agent Orchestrator（编排器）

```java
/**
 * Agent 编排器 —— Agent 生命周期的核心管理器
 */
@Service
@Slf4j
public class AgentOrchestrator {
    
    private final PlannerService plannerService;
    private final ExecutorService executorService;
    private final VerifierService verifierService;
    private final SynthesizerService synthesizerService;
    private final ToolRegistry toolRegistry;
    private final AgentSessionRepository sessionRepository;
    private final AgentBudgetManager budgetManager;
    private final AgentTraceLogger traceLogger;
    private final LlmClient llmClient;
    private final AgentFallbackHandler fallbackHandler;
    
    /**
     * 执行 Agent 推理
     * 
     * @param request  Agent 执行请求
     * @return         Agent 执行结果
     */
    public AgentResult execute(AgentExecuteRequest request) {
        
        // ========== Step 0: 初始化会话 ==========
        AgentSession session = createSession(request);
        traceLogger.logSessionStart(session);
        
        try {
            // ========== Step 1: 任务评估 ==========
            TaskAssessment assessment = assessTask(request);
            traceLogger.logAssessment(session.getSessionId(), assessment);
            
            if (!assessment.requiresAgent()) {
                // 简单问题，不需要 Agent 模式
                return handleSimpleQuery(session, request);
            }
            
            // ========== Step 2: 规划 ==========
            ReasoningPlan plan = plannerService.createPlan(request, assessment);
            session.setPlan(plan);
            traceLogger.logPlan(session.getSessionId(), plan);
            
            // ========== Step 3: 逐步执行 ==========
            for (PlannedStep plannedStep : plan.getPlannedSteps()) {
                
                // 预算检查
                if (session.getBudget().isExhausted()) {
                    log.warn("Agent预算耗尽, session={}, usedSteps={}/{}", 
                        session.getSessionId(), 
                        session.getBudget().getUsedSteps(),
                        session.getBudget().getMaxSteps());
                    break;
                }
                
                ExecutionStep step = executeStep(session, plannedStep);
                session.getSteps().add(step);
                
                // 验证
                if (step.getStatus() == StepStatus.COMPLETED) {
                    VerificationResult verification = verifierService.verify(step, session);
                    step.setVerification(verification);
                    
                    if (!verification.getPassed()) {
                        handleVerificationFailure(session, step, verification);
                    }
                }
                
                budgetManager.consumeStepBudget(session);
            }
            
            // ========== Step 4: 合成 ==========
            AgentResult result = synthesizerService.synthesize(session);
            session.setResult(result);
            session.setStatus(AgentSessionStatus.COMPLETED);
            
            traceLogger.logSessionComplete(session);
            return result;
            
        } catch (AgentTimeoutException e) {
            log.warn("Agent执行超时, session={}", session.getSessionId());
            return fallbackHandler.handleTimeout(session);
            
        } catch (AgentBudgetExceededException e) {
            log.warn("Agent预算超限, session={}", session.getSessionId());
            return fallbackHandler.handleBudgetExceeded(session, e.getPartialResult());
            
        } catch (Exception e) {
            log.error("Agent执行异常, session={}", session.getSessionId(), e);
            return fallbackHandler.handleUnexpectedError(session, e);
            
        } finally {
            session.setUpdatedAt(OffsetDateTime.now());
            sessionRepository.save(session);
        }
    }
    
    /**
     * 执行单个推理步骤
     */
    private ExecutionStep executeStep(AgentSession session, PlannedStep plannedStep) {
        long start = System.currentTimeMillis();
        ExecutionStep.ExecutionStepBuilder stepBuilder = ExecutionStep.builder()
            .stepId(UUID.randomUUID().toString())
            .planStepOrder(plannedStep.getStepOrder())
            .status(StepStatus.EXECUTING)
            .retryCount(0)
            .executedAt(OffsetDateTime.now());
        
        try {
            // 如果需要工具调用，先执行工具
            ToolCallRecord toolCall = null;
            if (plannedStep.getToolName() != null) {
                toolCall = executeToolCall(session, plannedStep);
                stepBuilder.toolCall(toolCall);
                
                if (toolCall.getStatus() != ToolCallStatus.SUCCESS) {
                    // 工具调用失败，尝试重试或降级
                    toolCall = handleToolCallFailure(session, plannedStep, toolCall);
                    stepBuilder.toolCall(toolCall);
                    
                    if (toolCall.getStatus() != ToolCallStatus.SUCCESS) {
                        stepBuilder.status(StepStatus.FAILED);
                        stepBuilder.errorMessage("工具调用失败: " + toolCall.getError());
                        return stepBuilder.build();
                    }
                }
            }
            
            // LLM 推理（基于当前步骤的上下文 + 工具输出）
            String reasoningInput = buildReasoningInput(session, plannedStep, toolCall);
            LlmResponse llmResponse = llmClient.chat(reasoningInput, session.getUserContext());
            
            stepBuilder.reasoning(llmResponse.getReasoning());
            stepBuilder.output(llmResponse.getContent());
            stepBuilder.status(StepStatus.COMPLETED);
            stepBuilder.tokenUsage(llmResponse.getTokenUsage());
            
        } catch (Exception e) {
            stepBuilder.status(StepStatus.FAILED);
            stepBuilder.errorMessage(e.getMessage());
        }
        
        stepBuilder.durationMs(System.currentTimeMillis() - start);
        return stepBuilder.build();
    }
    
    /**
     * 执行工具调用
     */
    private ToolCallRecord executeToolCall(AgentSession session, PlannedStep plannedStep) {
        AgentTool tool = toolRegistry.getTool(plannedStep.getToolName());
        if (tool == null) {
            return ToolCallRecord.builder()
                .callId(UUID.randomUUID().toString())
                .toolName(plannedStep.getToolName())
                .status(ToolCallStatus.FAILED)
                .error("工具未注册: " + plannedStep.getToolName())
                .build();
        }
        
        // 权限检查
        if (!tool.checkPermission(session.getUserContext())) {
            return ToolCallRecord.builder()
                .callId(UUID.randomUUID().toString())
                .toolName(tool.getName())
                .status(ToolCallStatus.FAILED)
                .error("权限不足")
                .build();
        }
        
        // 解析输入参数
        JsonNode input;
        try {
            input = JsonUtils.parse(plannedStep.getToolInputHint());
        } catch (Exception e) {
            return ToolCallRecord.builder()
                .callId(UUID.randomUUID().toString())
                .toolName(tool.getName())
                .status(ToolCallStatus.FAILED)
                .error("输入参数解析失败: " + e.getMessage())
                .build();
        }
        
        // 执行（带超时）
        AgentExecutionContext ctx = AgentExecutionContext.builder()
            .sessionId(session.getSessionId())
            .userId(session.getUserId())
            .userContext(session.getUserContext())
            .build();
            
        long timeout = toolRegistry.getTimeoutMs(tool.getName());
        ToolExecutionResult result = executorService.executeWithTimeout(tool, input, ctx, timeout);
        
        return ToolCallRecord.builder()
            .callId(UUID.randomUUID().toString())
            .toolName(tool.getName())
            .inputJson(plannedStep.getToolInputHint())
            .outputJson(result.getOutput() != null ? result.getOutput().toString() : null)
            .status(switch (result.getErrorType()) {
                case null -> ToolCallStatus.SUCCESS;
                case INVALID_INPUT -> ToolCallStatus.INVALID_INPUT;
                case TIMEOUT -> ToolCallStatus.TIMEOUT;
                case RATE_LIMITED -> ToolCallStatus.RATE_LIMITED;
                default -> ToolCallStatus.FAILED;
            })
            .durationMs(result.getDurationMs())
            .error(result.getErrorMessage())
            .sourceStepId(null) // 由调用方设置
            .build();
    }
    
    /**
     * 处理验证失败
     */
    private void handleVerificationFailure(AgentSession session, ExecutionStep step, 
                                           VerificationResult verification) {
        switch (verification.getSuggestedAction()) {
            case RETRY -> {
                if (session.getBudget().getUsedRetries() < session.getBudget().getMaxRetries()) {
                    log.info("步骤验证失败，执行重试, session={}, step={}", 
                        session.getSessionId(), step.getStepId());
                    step.setStatus(StepStatus.RETRYING);
                    step.setRetryCount(step.getRetryCount() + 1);
                    // 重新执行该步骤（简化版，实际需要重建上下文）
                    PlannedStep retryPlan = session.getPlan().getPlannedSteps()
                        .get(step.getPlanStepOrder() - 1);
                    ExecutionStep retried = executeStep(session, retryPlan);
                    BeanUtils.copyProperties(retried, step, "stepId", "retryCount");
                }
            }
            case FALLBACK_SIMPLE -> {
                log.info("验证失败触发降级, session={}", session.getSessionId());
                throw new AgentBudgetExceededException("验证连续失败，触发降级");
            }
            case ABORT -> {
                throw new AgentExecutionException("验证失败导致中止: " + verification.getFailureReason());
            }
            default -> {
                // PROCEED 或 ADJUST_PLAN：记录告警但继续执行
                log.warn("步骤验证未通过但继续执行, session={}, step={}, reason={}", 
                    session.getSessionId(), step.getStepId(), verification.getFailureReason());
                step.setStatus(StepStatus.COMPLETED);
            }
        }
    }
}
```

### 5.2 Planner Service（规划器）

```java
/**
 * 规划器 —— 使用 LLM 分析问题并生成推理计划
 */
@Service
@Slf4j
public class PlannerService {
    
    private final LlmClient llmClient;
    private final ToolRegistry toolRegistry;
    
    /**
     * 生成推理计划
     */
    public ReasoningPlan createPlan(AgentExecuteRequest request, TaskAssessment assessment) {
        
        // 获取可用工具描述
        List<ToolDescription> availableTools = toolRegistry.getAvailableTools(
            request.getUserContext().getSubject(),
            request.getUserContext().getStage()
        );
        
        // 构建规划 Prompt
        String planPrompt = buildPlanPrompt(request, assessment, availableTools);
        
        // 调用 LLM 生成计划
        LlmResponse response = llmClient.chatStructured(planPrompt, PlanResponse.class);
        PlanResponse planResponse = response.getParsedContent();
        
        // 构建推理计划
        return ReasoningPlan.builder()
            .planId(UUID.randomUUID().toString())
            .problemType(planResponse.getProblemType())
            .problemSummary(planResponse.getProblemSummary())
            .plannedSteps(planResponse.getSteps().stream()
                .map(this::toPlannedStep)
                .collect(Collectors.toList()))
            .requiredToolNames(planResponse.getRequiredTools())
            .estimatedSteps(planResponse.getSteps().size())
            .complexity(assessment.getComplexity())
            .allowParallel(planResponse.isAllowParallel())
            .build();
    }
    
    private String buildPlanPrompt(AgentExecuteRequest request, TaskAssessment assessment, 
                                    List<ToolDescription> tools) {
        return """
            # 任务：分析以下学科问题并制定推理计划
            
            ## 学生信息
            - 学段：%s
            - 年级：%s  
            - 学科：%s
            - 能力水平：%s/10
            
            ## 问题
            %s
            
            ## 可用工具
            %s
            
            ## 要求
            1. 分析问题的结构和关键要素
            2. 将问题分解为2-6个推理步骤
            3. 为每个步骤指定类型和所需工具（如需要）
            4. 标注步骤间的依赖关系
            5. 判断是否可以并行执行某些步骤
            
            ## 输出格式（JSON）
            ```json
            {
              "problem_type": "类型分类",
              "problem_summary": "问题核心概括",
              "allow_parallel": false,
              "required_tools": ["工具名"],
              "steps": [
                {
                  "step_order": 1,
                  "description": "步骤描述",
                  "step_type": "ANALYZE|CALCULATE|QUERY|VERIFY|TRANSFORM|DEDUCE|SYNTHESIZE",
                  "tool_name": "工具名或null",
                  "tool_input_hint": "工具输入JSON或null",
                  "depends_on": [],
                  "knowledge_points": ["知识点ID"]
                }
              ]
            }
            ```
            """.formatted(
                request.getUserContext().getStage(),
                request.getUserContext().getGradeLevel(),
                request.getUserContext().getSubject(),
                request.getUserContext().getProficiencyLevel(),
                request.getUserQuery(),
                tools.stream()
                    .map(t -> "- %s: %s".formatted(t.getName(), t.getDescription()))
                    .collect(Collectors.joining("\n"))
            );
    }
}
```

### 5.3 Verifier Service（验证器）

```java
/**
 * 验证器 —— 对推理步骤的结果进行正确性校验
 */
@Service
@Slf4j
public class VerifierService {
    
    private final List<VerificationStrategy> strategies;
    private final FormulaVerifierTool formulaVerifier;
    private final NumericRangeChecker numericRangeChecker;
    private final DimensionalAnalyzer dimensionalAnalyzer;
    
    /**
     * 执行多维度验证
     */
    public VerificationResult verify(ExecutionStep step, AgentSession session) {
        
        List<VerificationCheck> checks = new ArrayList<>();
        
        // 1. 根据学科和步骤类型选择验证策略
        List<VerificationStrategy> applicableStrategies = strategies.stream()
            .filter(s -> s.appliesTo(step, session.getUserContext()))
            .collect(Collectors.toList());
        
        for (VerificationStrategy strategy : applicableStrategies) {
            try {
                VerificationCheck check = strategy.check(step, session);
                checks.add(check);
            } catch (Exception e) {
                log.warn("验证策略执行异常: strategy={}, error={}", 
                    strategy.getClass().getSimpleName(), e.getMessage());
                checks.add(VerificationCheck.builder()
                    .checkType(strategy.getCheckType())
                    .description(strategy.getDescription())
                    .passed(false)
                    .detail("验证器异常: " + e.getMessage())
                    .build());
            }
        }
        
        // 2. 综合判定
        boolean allPassed = checks.stream().allMatch(VerificationCheck::getPassed);
        double confidence = calculateConfidence(checks);
        
        VerificationAction action = decideAction(allPassed, confidence, step, session);
        
        return VerificationResult.builder()
            .passed(allPassed)
            .checks(checks)
            .confidence(confidence)
            .failureReason(allPassed ? null : "存在 " + 
                checks.stream().filter(c -> !c.getPassed()).count() + " 项验证未通过")
            .suggestedAction(action)
            .build();
    }
    
    private VerificationAction decideAction(boolean allPassed, double confidence, 
                                            ExecutionStep step, AgentSession session) {
        if (allPassed && confidence > 0.8) {
            return VerificationAction.PROCEED;
        }
        if (!allPassed && step.getRetryCount() < 2 && confidence > 0.3) {
            return VerificationAction.RETRY;
        }
        if (confidence < 0.3) {
            return session.getBudget().isExhausted() 
                ? VerificationAction.FALLBACK_SIMPLE 
                : VerificationAction.ADJUST_PLAN;
        }
        return VerificationAction.PROCEED; // 中等置信度，继续但有告警
    }
    
    private double calculateConfidence(List<VerificationCheck> checks) {
        // 简单加权平均
        return checks.stream()
            .mapToDouble(c -> c.getPassed() ? 1.0 : 0.0)
            .average()
            .orElse(0.5);
    }
}
```

### 5.4 Synthesizer Service（合成器）

```java
/**
 * 合成器 —— 将多步推理结果整合为最终回答
 */
@Service
public class SynthesizerService {
    
    private final LlmClient llmClient;
    private final AgeAdapterService ageAdapter;
    
    public AgentResult synthesize(AgentSession session) {
        
        // 收集所有成功步骤的输出
        List<ExecutionStep> successfulSteps = session.getSteps().stream()
            .filter(s -> s.getStatus() == StepStatus.COMPLETED)
            .collect(Collectors.toList());
        
        // 构建合成 Prompt
        String synthesisPrompt = buildSynthesisPrompt(session, successfulSteps);
        
        // 调用 LLM 合成最终回答
        LlmResponse response = llmClient.chatStructured(synthesisPrompt, SynthesisResponse.class);
        SynthesisResponse synthResp = response.getParsedContent();
        
        // 适龄化适配
        String adaptedAnswer = ageAdapter.adapt(
            synthResp.getAnswer(), 
            session.getUserContext().getStage(),
            session.getUserContext().getGradeLevel()
        );
        
        // 构建分段
        List<AnswerSection> sections = synthResp.getSections().stream()
            .map(s -> AnswerSection.builder()
                .type(s.getType())
                .title(s.getTitle())
                .content(s.getContent())
                .order(s.getOrder())
                .build())
            .collect(Collectors.toList());
        
        // 统计信息
        ExecutionStats stats = ExecutionStats.builder()
            .totalSteps(session.getSteps().size())
            .successfulSteps((int) successfulSteps.stream().count())
            .failedSteps((int) session.getSteps().stream()
                .filter(s -> s.getStatus() == StepStatus.FAILED).count())
            .totalRetries(session.getSteps().stream()
                .mapToInt(ExecutionStep::getRetryCount).sum())
            .totalToolCalls((int) session.getToolCalls().stream().count())
            .totalTokens(session.getBudget().getUsedTokens())
            .totalDurationMs(session.getSteps().stream()
                .mapToLong(ExecutionStep::getDurationMs).sum())
            .build();
        
        return AgentResult.builder()
            .answer(adaptedAnswer)
            .sections(sections)
            .knowledgePoints(synthResp.getKnowledgePoints())
            .relatedChapters(synthResp.getRelatedChapters())
            .reasoningSummary(synthResp.getReasoningSummary())
            .confidence(calculateOverallConfidence(session))
            .hadBacktrack(session.getSteps().stream()
                .anyMatch(s -> s.getRetryCount() > 0))
            .degraded(false)
            .stats(stats)
            .build();
    }
    
    private String buildSynthesisPrompt(AgentSession session, List<ExecutionStep> steps) {
        String stepsInfo = steps.stream()
            .map(s -> """
                ### 步骤 %d (%s)
                推理过程：%s
                工具调用：%s
                步骤结论：%s
                """.formatted(
                    s.getPlanStepOrder(),
                    s.getStatus(),
                    s.getReasoning(),
                    s.getToolCall() != null ? s.getToolCall().getOutputJson() : "无",
                    s.getOutput()
                ))
            .collect(Collectors.joining("\n"));
            
        return """
            # 任务：将多步推理结果合成最终回答
            
            ## 学生信息
            学段：%s | 年级：%s | 学科：%s | 能力水平：%d/10
            
            ## 原始问题
            %s
            
            ## 推理步骤汇总
            %s
            
            ## 合成要求
            1. 语言风格适合%s学生理解
            2. 按以下结构组织：题目分析 → 解题思路 → 详细步骤 → 总结归纳 → 易错提醒
            3. 每个步骤都要标注使用的关键公式/知识点
            4. 如果推理中有验证失败但最终正确的步骤，不需要暴露失败过程
            5. 最终答案需明确标注
            
            ## 输出格式（JSON）
            ```json
            {
              "answer": "完整Markdown格式回答",
              "sections": [
                {"type": "PROBLEM_ANALYSIS|IDEA|STEP|FORMULA|VERIFICATION|SUMMARY|TIP", 
                 "title": "标题", "content": "内容", "order": 1}
              ],
              "knowledge_points": ["知识点"],
              "related_chapters": ["章节"],
              "reasoning_summary": "一句话推理摘要"
            }
            ```
            """.formatted(
                session.getUserContext().getStage(),
                session.getUserContext().getGradeLevel(),
                session.getUserContext().getSubject(),
                session.getUserContext().getProficiencyLevel(),
                session.getUserQuery(),
                stepsInfo,
                session.getUserContext().getStage()
            );
    }
}
```

---

## 6. Agent 状态机

### 6.1 会话级状态流转

```
INITIALIZED ──→ PLANNING ──→ EXECUTING ──→ SYNTHESIZING ──→ COMPLETED
     │              │             │               │
     │              ↓             ↓               ↓
     │         PLAN_FAILED   EXEC_TIMEOUT    SYNTHESIS_FAILED
     │              │             │               │
     └──────────────┴─────────────┴───────────────┘
                         ↓
                    DEGRADED_MODE ──→ COMPLETED (降级回答)
```

### 6.2 状态枚举定义

```java
public enum AgentSessionStatus {
    INITIALIZED,      // 已初始化，待评估
    ASSESSING,        // 任务评估中
    PLANNING,         // 规划中
    PLAN_FAILED,      // 规划失败
    EXECUTING,        // 执行中
    EXEC_TIMEOUT,     // 执行超时
    EXEC_BUDGET_EXCEEDED, // 预算超限
    EXEC_ERROR,       // 执行异常
    SYNTHESIZING,     // 合成中
    SYNTHESIS_FAILED, // 合成失败
    DEGRADED_MODE,    // 降级模式
    COMPLETED,        // 已完成
    ABORTED           // 已中止
}
```

### 6.3 步骤级状态流转

```
PENDING ──→ EXECUTING ──→ AWAITING_TOOL ──→ VERIFYING ──→ COMPLETED
               │                                  │
               │                                  ↓
               │                              RETRYING ──→ EXECUTING (重试)
               │
               ↓
            FAILED ──→ SKIPPED (后续依赖步骤)
```

---

## 7. API 接口设计

### 7.1 内部接口（供 AI 辅导全链路调用）

#### 7.1.1 触发 Agent 执行

```
POST /internal/agent/execute
Content-Type: application/json
```

**请求体：**

```json
{
  "conversation_message_id": "msg-uuid-12345",
  "user_id": 10086,
  "user_query": "已知函数 f(x) = x³ - 3x² + 2，求 f(x) 的单调区间和极值",
  "user_context": {
    "stage": "SENIOR",
    "grade_level": 11,
    "subject": "MATH",
    "textbook_edition_id": "pep-senior-math-required1",
    "chapter_id": "ch-derivative-applications",
    "proficiency_level": 6,
    "locale": "zh-CN",
    "enable_scaffolding": true,
    "max_hint_depth": 3
  },
  "budget_override": {
    "max_steps": 6,
    "max_tool_calls": 3,
    "max_tokens": 6000,
    "max_duration_seconds": 25
  }
}
```

**响应体：**

```json
{
  "session_id": "agent-session-uuid-67890",
  "status": "COMPLETED",
  "result": {
    "answer": "## 题目分析\n...",
    "sections": [...],
    "knowledge_points": ["derivative", "monotonicity", "extremum"],
    "related_chapters": ["ch-derivative-applications"],
    "confidence": 0.92,
    "had_backtrack": false,
    "degraded": false,
    "stats": {
      "total_steps": 5,
      "successful_steps": 5,
      "failed_steps": 0,
      "total_tool_calls": 2,
      "total_tokens": 3850,
      "total_duration_ms": 12400
    }
  }
}
```

#### 7.1.2 查询执行轨迹

```
GET /internal/agent/sessions/{sessionId}/trace
```

**响应（节选）：**

```json
{
  "session_id": "agent-session-uuid-67890",
  "plan": {
    "problem_type": "CALCULUS_EXTREMUM",
    "complexity": "MODERATE",
    "estimated_steps": 5,
    "required_tool_names": ["math_calculator", "knowledge_graph_query"]
  },
  "steps": [
    {
      "step_id": "step-1",
      "plan_step_order": 1,
      "status": "COMPLETED",
      "reasoning": "首先求导数 f'(x) = 3x² - 6x",
      "output": "f'(x) = 3x² - 6x = 3x(x-2)",
      "verification": {
        "passed": true,
        "confidence": 0.95,
        "checks": [
          {
            "check_type": "FORMULA_CORRECTNESS",
            "description": "导数公式校验",
            "passed": true
          }
        ]
      },
      "duration_ms": 2100,
      "token_usage": {"prompt_tokens": 350, "completion_tokens": 120}
    },
    {
      "step_id": "step-2",
      "plan_step_order": 2,
      "status": "COMPLETED",
      "tool_call": {
        "call_id": "call-1",
        "tool_name": "math_calculator",
        "input_json": "{\"expression\": \"3*x*(x-2)\", \"precision\": 4}",
        "output_json": "{\"result\": \"3x²-6x\", \"zeros\": [0, 2]}",
        "status": "SUCCESS",
        "duration_ms": 150
      },
      "output": "令 f'(x)=0，解得 x=0 或 x=2",
      "verification": {
        "passed": true,
        "confidence": 1.0
      },
      "duration_ms": 1800
    }
  ],
  "stats": {
    "total_steps": 5,
    "total_tool_calls": 2,
    "total_tokens": 3850,
    "total_duration_ms": 12400
  }
}
```

### 7.2 工具管理接口

```
# 注册工具
POST /internal/agent/tools/register

# 查看工具列表
GET /internal/agent/tools?subject=MATH&stage=SENIOR

# 启用/禁用工具
PATCH /internal/agent/tools/{toolName}/status

# 查看工具调用统计
GET /internal/agent/tools/{toolName}/stats?from=2026-06-01&to=2026-06-19
```

---

## 8. 任务评估与路由策略

### 8.1 Agent 触发条件

不是所有问题都需要走 Agent 链路。任务评估器（TaskAssessor）决定是否启用 Agent：

```java
@Service
public class TaskAssessor {
    
    /**
     * 评估任务是否需要 Agent 模式
     */
    public TaskAssessment assess(AgentExecuteRequest request) {
        
        String query = request.getUserQuery();
        AgentUserContext ctx = request.getUserContext();
        
        // 1. 关键词快速检测 — 这些信号直接跳过 Agent
        if (isSimpleGreeting(query) || isSimpleDefinition(query, ctx)) {
            return TaskAssessment.simple();
        }
        
        // 2. 复杂度信号检测
        ComplexityScore score = calculateComplexity(query, ctx);
        
        // 3. 判断是否需要工具
        boolean needsTools = detectToolNeeds(query, ctx);
        
        // 4. 判断是否多步推理
        boolean needsMultiStep = score.getStepEstimate() > 2;
        
        boolean requiresAgent = needsTools || needsMultiStep || 
                                score.getOverallScore() > AGENT_THRESHOLD;
        
        return TaskAssessment.builder()
            .requiresAgent(requiresAgent)
            .complexity(score.getComplexityLevel())
            .estimatedSteps(score.getStepEstimate())
            .detectedTools(score.getSuggestedTools())
            .build();
    }
    
    private ComplexityScore calculateComplexity(String query, AgentUserContext ctx) {
        int score = 0;
        List<String> signals = new ArrayList<>();
        
        // 多条件/多问号 → 复杂度+
        long questionMarks = query.chars().filter(c -> c == '?' || c == '？').count();
        if (questionMarks > 1) { score += 2; signals.add("MULTI_QUESTION"); }
        
        // 包含"证明""推导""分析"等关键词
        if (query.contains("证明") || query.contains("推导") || query.contains("分析")) {
            score += 2; signals.add("PROOF_OR_DERIVATION");
        }
        
        // 数学表达式复杂度（含 ^ √ ∑ ∫ 等）
        if (query.matches(".*[\\^√∑∫≤≥≠∈π].*")) {
            score += 1; signals.add("COMPLEX_NOTATION");
        }
        
        // 跨学科关键词
        if (query.contains("结合") || query.contains("联系") || query.contains("综合")) {
            score += 2; signals.add("CROSS_DOMAIN");
        }
        
        // 理科实验场景
        if (query.contains("实验") || query.contains("测量")) {
            score += 1; signals.add("EXPERIMENT");
        }
        
        // 计算步骤估计（简单启发式）
        int stepEstimate = Math.min(2 + score / 2, 8);
        
        ComplexityLevel level = switch (stepEstimate) {
            case 0, 1, 2 -> ComplexityLevel.SIMPLE;
            case 3, 4 -> ComplexityLevel.MODERATE;
            case 5, 6 -> ComplexityLevel.COMPLEX;
            default -> ComplexityLevel.HIGHLY_COMPLEX;
        };
        
        return new ComplexityScore(score, level, stepEstimate, signals);
    }
}
```

### 8.2 预算分配策略

```java
@Service
public class AgentBudgetManager {
    
    /**
     * 根据复杂度分配默认预算
     */
    public AgentBudget allocateBudget(TaskAssessment assessment, 
                                       AgentUserContext userContext,
                                       BudgetOverride override) {
        
        ComplexityLevel complexity = assessment.getComplexity();
        
        int maxSteps, maxToolCalls, maxTokens, maxDuration, maxRetries;
        
        switch (complexity) {
            case SIMPLE:
                maxSteps = 3; maxToolCalls = 1; maxTokens = 2000; 
                maxDuration = 10; maxRetries = 1;
                break;
            case MODERATE:
                maxSteps = 5; maxToolCalls = 3; maxTokens = 4000; 
                maxDuration = 20; maxRetries = 2;
                break;
            case COMPLEX:
                maxSteps = 7; maxToolCalls = 4; maxTokens = 6000; 
                maxDuration = 30; maxRetries = 2;
                break;
            case HIGHLY_COMPLEX:
                maxSteps = 10; maxToolCalls = 6; maxTokens = 10000; 
                maxDuration = 45; maxRetries = 3;
                break;
            default:
                maxSteps = 5; maxToolCalls = 3; maxTokens = 4000; 
                maxDuration = 20; maxRetries = 2;
        }
        
        // 免费用户收紧预算
        if (userContext.getProficiencyLevel() != null) {
            // 低能力用户给更多步骤（需要更细致的引导）
            maxSteps = (int) (maxSteps * 1.2);
        }
        
        // 允许外部覆盖
        if (override != null) {
            maxSteps = override.getMaxSteps() != null ? override.getMaxSteps() : maxSteps;
            maxToolCalls = override.getMaxToolCalls() != null ? override.getMaxToolCalls() : maxToolCalls;
            maxTokens = override.getMaxTokens() != null ? override.getMaxTokens() : maxTokens;
            maxDuration = override.getMaxDurationSeconds() != null 
                ? override.getMaxDurationSeconds() : maxDuration;
        }
        
        return AgentBudget.builder()
            .maxSteps(maxSteps)
            .usedSteps(0)
            .maxToolCalls(maxToolCalls)
            .usedToolCalls(0)
            .maxTokens(maxTokens)
            .usedTokens(0)
            .maxDurationSeconds(maxDuration)
            .usedDurationSeconds(0)
            .maxRetries(maxRetries)
            .usedRetries(0)
            .build();
    }
}
```

---

## 9. 降级与容错策略

### 9.1 降级处理器

```java
@Service
@Slf4j
public class AgentFallbackHandler {
    
    private final LlmClient llmClient;
    private final AgentSessionRepository sessionRepository;
    
    /**
     * 超时降级：使用已完成的步骤结果合成部分回答
     */
    public AgentResult handleTimeout(AgentSession session) {
        log.warn("Agent超时降级, session={}, completedSteps={}", 
            session.getSessionId(),
            session.getSteps().stream().filter(s -> s.getStatus() == StepStatus.COMPLETED).count());
        
        session.setStatus(AgentSessionStatus.EXEC_TIMEOUT);
        
        // 如果至少有1个步骤完成，尝试合成部分回答
        if (session.getSteps().stream().anyMatch(s -> s.getStatus() == StepStatus.COMPLETED)) {
            return synthesizePartialResult(session);
        }
        
        // 否则降级为单次 LLM 调用
        return directLlmFallback(session);
    }
    
    /**
     * 预算超限降级
     */
    public AgentResult handleBudgetExceeded(AgentSession session, Object partialResult) {
        log.warn("Agent预算超限降级, session={}", session.getSessionId());
        session.setStatus(AgentSessionStatus.EXEC_BUDGET_EXCEEDED);
        
        // 尝试合成已完成步骤
        if (session.getSteps() != null && !session.getSteps().isEmpty()) {
            return synthesizePartialResult(session);
        }
        
        return directLlmFallback(session);
    }
    
    /**
     * 异常降级
     */
    public AgentResult handleUnexpectedError(AgentSession session, Exception e) {
        log.error("Agent异常降级, session={}", session.getSessionId(), e);
        session.setStatus(AgentSessionStatus.EXEC_ERROR);
        return directLlmFallback(session);
    }
    
    /**
     * 直接降级为普通 LLM 调用（不走 Agent 链路）
     */
    private AgentResult directLlmFallback(AgentSession session) {
        String prompt = "请回答以下问题（适合%s%s学生理解）：\n\n%s".formatted(
            session.getUserContext().getStage().getDescription(),
            session.getUserContext().getSubject().getDescription(),
            session.getUserQuery()
        );
        
        LlmResponse response = llmClient.chat(prompt, session.getUserContext());
        
        return AgentResult.builder()
            .answer(response.getContent())
            .confidence(0.5)
            .degraded(true)
            .reasoningSummary("Agent引擎降级，直接生成回答")
            .stats(ExecutionStats.builder()
                .totalSteps(1)
                .successfulSteps(1)
                .failedSteps(0)
                .totalRetries(0)
                .totalToolCalls(0)
                .totalTokens(response.getTokenUsage().getTotalTokens())
                .totalDurationMs((long) response.getDurationMs())
                .build())
            .build();
    }
    
    private AgentResult synthesizePartialResult(AgentSession session) {
        // 使用已完成的步骤合成部分回答
        // ... 合成逻辑（简化版）
        return AgentResult.builder()
            .answer("基于已完成的推理步骤合成回答...")
            .confidence(0.6)
            .degraded(true)
            .build();
    }
}
```

### 9.2 工具调用容错

| 工具失败类型 | 处理策略 |
|------------|---------|
| INVALID_INPUT | LLM 修正输入后重试1次 |
| TIMEOUT | 记录告警，跳过工具，LLM 尝试无工具推理 |
| RATE_LIMITED | 等待1秒后重试1次，仍失败则跳过 |
| SERVICE_UNAVAILABLE | 降级：LLM 尝试独立推理 |
| 权限不足 | 记录告警，跳过工具调用 |

---

## 10. 可观测性

### 10.1 执行轨迹记录

```java
@Service
public class AgentTraceLogger {
    
    private final TraceStorage traceStorage;
    
    public void logSessionStart(AgentSession session) {
        TraceEvent event = TraceEvent.builder()
            .sessionId(session.getSessionId())
            .eventType("SESSION_START")
            .timestamp(OffsetDateTime.now())
            .payload(Map.of(
                "userId", session.getUserId(),
                "query", session.getUserQuery(),
                "subject", session.getUserContext().getSubject(),
                "stage", session.getUserContext().getStage()
            ))
            .build();
        traceStorage.append(event);
    }
    
    public void logStepComplete(AgentSession session, ExecutionStep step) {
        TraceEvent event = TraceEvent.builder()
            .sessionId(session.getSessionId())
            .eventType("STEP_COMPLETE")
            .timestamp(OffsetDateTime.now())
            .stepId(step.getStepId())
            .payload(Map.of(
                "stepOrder", step.getPlanStepOrder(),
                "status", step.getStatus(),
                "durationMs", step.getDurationMs(),
                "hadToolCall", step.getToolCall() != null,
                "verificationPassed", step.getVerification() != null 
                    && step.getVerification().getPassed()
            ))
            .build();
        traceStorage.append(event);
    }
    
    public void logSessionComplete(AgentSession session) {
        // 写入完整的执行轨迹到 JSON 列
        sessionRepository.updateExecutionTrace(
            session.getSessionId(),
            JsonUtils.toJson(session.getSteps())
        );
    }
}
```

### 10.2 关键监控指标

```
# Agent 引擎 Prometheus 指标

# 1. 执行频次
agent_sessions_total{status="COMPLETED|DEGRADED|TIMEOUT|ERROR"}
agent_sessions_by_complexity{level="SIMPLE|MODERATE|COMPLEX|HIGHLY_COMPLEX"}

# 2. 执行效率
agent_duration_seconds_histogram{complexity="..."}
agent_steps_per_session_histogram
agent_tool_calls_per_session_histogram

# 3. 工具调用
agent_tool_calls_total{tool_name="...", status="SUCCESS|FAILED"}
agent_tool_duration_seconds{tool_name="..."}

# 4. 预算
agent_budget_exhausted_total{reason="STEPS|TOKENS|DURATION|RETRIES"}
agent_budget_remaining_ratio_histogram

# 5. 质量
agent_verification_failure_total{check_type="..."}
agent_backtrack_total
agent_confidence_histogram

# 6. 降级
agent_degraded_total{reason="TIMEOUT|BUDGET|ERROR|VALIDATION"}
```

---

## 11. 安全设计

### 11.1 工具调用安全

```java
/**
 * 工具执行沙箱管理器
 */
@Service
public class ToolSandboxManager {
    
    /**
     * 工具输入参数安全审计
     */
    public void auditToolInput(String toolName, JsonNode input, AgentUserContext ctx) {
        // 1. 检查是否包含敏感信息（手机号、身份证号等）
        String inputStr = input.toString();
        if (PatternMatches.containsSensitiveData(inputStr)) {
            throw new SecurityException("工具输入包含敏感信息");
        }
        
        // 2. 输入长度限制
        if (inputStr.length() > MAX_TOOL_INPUT_LENGTH) {
            throw new SecurityException("工具输入超出长度限制");
        }
        
        // 3. 针对特定工具的检查
        switch (toolName) {
            case "math_calculator" -> validateMathInput(input);
            case "knowledge_graph_query" -> validateKgQuery(input, ctx);
            case "textbook_search" -> validateSearchQuery(input);
        }
    }
    
    /**
     * 工具输出安全过滤
     */
    public JsonNode filterToolOutput(String toolName, JsonNode output) {
        // 过滤可能不适宜学生的内容
        // 隐藏内部系统路径或调试信息
        // 确保数值结果在合理范围
        return output;
    }
}
```

### 11.2 Agent 输出安全

Agent 最终回答在合成后，必须经过已有的安全过滤管线：

```
Agent合成回答
    ↓
AI输出安全与教育对话护栏引擎 (已有模块)
    ↓
AI回答后处理与智能优化管线 (已有模块)
    ↓
最终输出给用户
```

---

## 12. 与现有系统的集成方案

### 12.1 集成入口

```java
/**
 * 在 AI 辅导全链路中集成 Agent 引擎
 */
@Service
public class AITutoringPipeline {
    
    private final IntentRecognitionService intentService;
    private final TaskAssessor taskAssessor;
    private final AgentOrchestrator agentOrchestrator;
    private final DirectLlmService directLlmService;
    private final ResponsePostProcessor postProcessor;
    
    public TutoringResponse handle(TutoringRequest request) {
        
        // 1. 意图识别（已有）
        Intent intent = intentService.recognize(request.getQuery(), request.getUserContext());
        
        // 2. 安全过滤（已有）
        SafetyCheckResult safetyCheck = safetyFilter.check(request);
        if (safetyCheck.isBlocked()) {
            return TutoringResponse.blocked(safetyCheck.getReason());
        }
        
        // 3. 任务评估（新增）
        TaskAssessment assessment = taskAssessor.assess(request);
        
        // 4. 分流
        String answer;
        AgentExecutionTrace trace = null;
        
        if (assessment.requiresAgent()) {
            // 复杂问题 → Agent 链路
            AgentExecuteRequest agentReq = buildAgentRequest(request, assessment);
            AgentResult agentResult = agentOrchestrator.execute(agentReq);
            answer = agentResult.getAnswer();
            trace = AgentExecutionTrace.from(agentResult);
        } else {
            // 简单问题 → 直接 LLM
            answer = directLlmService.answer(request, intent);
        }
        
        // 5. 响应后处理（已有）
        String processed = postProcessor.process(answer, request.getUserContext());
        
        // 6. 知识点标注（已有）
        List<KnowledgePoint> kps = knowledgeAnnotator.annotate(processed);
        
        return TutoringResponse.builder()
            .answer(processed)
            .knowledgePoints(kps)
            .agentTrace(trace)  // 前端可用于展示推理过程
            .build();
    }
}
```

### 12.2 前端适配

前端接收 Agent 回答时，可以额外展示推理摘要：

```dart
// Flutter 前端接收 Agent 回答
class AgentAnswerWidget extends StatelessWidget {
  final AgentResult result;
  
  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // 主回答内容
        MarkdownBody(data: result.answer),
        
        // 推理过程折叠面板（可选展示）
        if (result.stats != null && result.stats.totalToolCalls > 0)
          ExpansionTile(
            title: Text('查看解题过程 (${result.stats.totalSteps}步)'),
            children: [
              _buildTraceTimeline(result.trace),
              _buildToolCalls(result.trace.toolCalls),
              _buildConfidenceIndicator(result.confidence),
            ],
          ),
          
        // 快捷操作
        Row(
          children: [
            ActionChip(label: '再讲简单点'),
            ActionChip(label: '生成同类题'),
            ActionChip(label: '加入错题本'),
          ],
        ),
      ],
    );
  }
}
```

---

## 13. 性能优化策略

### 13.1 并行步骤执行

当计划中存在无依赖关系的步骤时，可并行执行：

```java
/**
 * 并行步骤执行器
 */
public class ParallelStepExecutor {
    
    private final ExecutorService executor;
    
    public List<ExecutionStep> executeParallel(List<PlannedStep> parallelSteps, 
                                                AgentSession session) {
        List<CompletableFuture<ExecutionStep>> futures = parallelSteps.stream()
            .map(step -> CompletableFuture.supplyAsync(
                () -> executeStep(session, step),
                executor
            ))
            .collect(Collectors.toList());
        
        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
            .orTimeout(session.getTimeoutSeconds(), TimeUnit.SECONDS)
            .join();
        
        return futures.stream()
            .map(f -> {
                try { return f.get(); }
                catch (Exception e) { 
                    return ExecutionStep.builder()
                        .status(StepStatus.FAILED)
                        .errorMessage(e.getMessage())
                        .build();
                }
            })
            .collect(Collectors.toList());
    }
}
```

### 13.2 工具结果缓存

```java
/**
 * 工具调用结果缓存
 */
@Component
public class ToolResultCache {
    
    private final Cache<String, ToolExecutionResult> cache;
    
    public ToolResultCache() {
        this.cache = Caffeine.newBuilder()
            .maximumSize(1000)
            .expireAfterWrite(Duration.ofMinutes(10))
            .recordStats()
            .build();
    }
    
    public ToolExecutionResult getOrExecute(AgentTool tool, JsonNode input, 
                                             AgentExecutionContext ctx) {
        String cacheKey = buildCacheKey(tool.getName(), input);
        
        return cache.get(cacheKey, k -> {
            ToolExecutionResult result = tool.execute(input, ctx);
            // 只缓存成功结果
            if (!result.isSuccess()) {
                return null; // Caffeine 不缓存 null
            }
            return result;
        });
    }
    
    private String buildCacheKey(String toolName, JsonNode input) {
        return toolName + ":" + DigestUtils.md5Hex(input.toString());
    }
}
```

### 13.3 Prompt 压缩

对于推理步骤多的会话，对早期步骤进行摘要压缩，避免上下文爆炸：

```java
/**
 * Agent 上下文压缩器
 */
@Component
public class AgentContextCompressor {
    
    private static final int MAX_CONTEXT_TOKENS = 3000;
    
    /**
     * 当上下文超过阈值时，压缩早期步骤
     */
    public String compressIfNeeded(List<ExecutionStep> completedSteps) {
        int totalTokens = estimateTokens(completedSteps);
        
        if (totalTokens <= MAX_CONTEXT_TOKENS) {
            return buildFullContext(completedSteps);
        }
        
        // 保留最近2步的完整内容，早期步骤压缩为摘要
        int cutoff = completedSteps.size() - 2;
        List<ExecutionStep> toCompress = completedSteps.subList(0, cutoff);
        List<ExecutionStep> toKeep = completedSteps.subList(cutoff, completedSteps.size());
        
        String compressedSummary = llmSummarize(toCompress);
        
        return "## 已完成步骤摘要\n" + compressedSummary + "\n\n" +
               "## 最近步骤详情\n" + buildFullContext(toKeep);
    }
}
```

---

## 14. 测试策略

### 14.1 单元测试要点

| 组件 | 测试重点 |
|------|---------|
| TaskAssessor | 复杂度评分准确性、Agent 触发条件正确性 |
| PlannerService | 推理计划合理性、步骤依赖关系正确性 |
| SafeExpressionEvaluator | 恶意输入拦截、边界值、精度 |
| 各 Tool 实现 | 输入校验、异常处理、超时 |
| VerifierService | 各维度验证策略、置信度计算 |
| SynthesizerService | 回答完整性、适龄化适配 |
| AgentBudgetManager | 预算分配、超限检测 |
| AgentFallbackHandler | 各种降级路径覆盖 |

### 14.2 集成测试场景

```java
@SpringBootTest
class AgentIntegrationTest {
    
    @Test
    @DisplayName("复杂数学题 - 多步推理 + 计算器工具")
    void testComplexMathProblem() {
        var request = AgentExecuteRequest.builder()
            .userQuery("已知函数 f(x) = x³ - 3x² + 2，求单调区间和极值")
            .userContext(seniorMathContext())
            .build();
        
        AgentResult result = agentOrchestrator.execute(request);
        
        assertThat(result.getStats().getTotalSteps()).isBetween(3, 7);
        assertThat(result.getStats().getTotalToolCalls()).isGreaterThanOrEqualTo(1);
        assertThat(result.getAnswer()).contains("单调");
        assertThat(result.getAnswer()).contains("极值");
        assertThat(result.getConfidence()).isGreaterThan(0.7);
        assertThat(result.isDegraded()).isFalse();
    }
    
    @Test
    @DisplayName("Agent 预算超限降级")
    void testBudgetExceededDegrade() {
        var request = AgentExecuteRequest.builder()
            .userQuery("非常复杂的多步推理问题...")
            .userContext(seniorPhysicsContext())
            .budgetOverride(BudgetOverride.builder()
                .maxSteps(2)
                .maxTokens(500)
                .build())
            .build();
        
        AgentResult result = agentOrchestrator.execute(request);
        
        assertThat(result.isDegraded()).isTrue();
        assertThat(result.getAnswer()).isNotBlank();
    }
    
    @Test
    @DisplayName("工具调用超时 - 降级为无工具推理")
    void testToolTimeoutFallback() {
        // 模拟工具超时
        when(mockTool.execute(any(), any()))
            .thenThrow(new TimeoutException());
        
        var request = createRequestWithTool();
        AgentResult result = agentOrchestrator.execute(request);
        
        assertThat(result.getAnswer()).isNotBlank();
    }
}
```

---

## 15. 演进路线

### 15.1 Phase 1: MVP（V1.5 阶段）

- ✅ ReAct 模式基础循环（Plan → Act → Verify → Synthesize）
- ✅ 3-5 个核心工具（计算器、知识图谱查询、公式校验）
- ✅ 理科解题场景
- ✅ 基础降级和容错

### 15.2 Phase 2: 增强（V2.0 阶段）

- 🔲 工具并行执行
- 🔲 更多工具（化学方程式、物理模拟、文本分析）
- 🔲 跨学科综合推理
- 🔲 Agent 推理过程可视化（前端 Timeline 组件）
- 🔲 工具调用结果缓存
- 🔲 Prompt 上下文压缩

### 15.3 Phase 3: 高级（V2.5+）

- 🔲 Multi-Agent 协作（数学 Agent + 物理Agent + 语言 Agent）
- 🔲 自适应工具学习（根据使用数据优化工具选择策略）
- 🔲 端侧轻量 Agent（简单步骤在客户端执行）
- 🔲 教师可配置工具链（教师可定义特定工具组合）
- 🔲 Agent 推理质量自动评估与回流

---

## 附录 A: 工具描述模板

注册新工具时，需提供以下格式的描述（供 LLM Planner 理解）：

```yaml
tool_name: math_calculator
display_name: 数学计算器
description: |
  安全数学表达式计算器。支持:
  - 四则运算、幂运算、阶乘
  - 三角函数（角度/弧度）
  - 对数、指数
  - 排列组合
  不支持符号计算和方程求解。
  适用于：需要精确数值结果的计算步骤。
  不适用于：需要代数变形或符号推导的场景。
category: MATH
input_example:
  expression: "2*sin(30°) + sqrt(3)"
  precision: 4
output_example:
  expression: "2*sin(30°) + sqrt(3)"
  result: "2.7321"
  precision: 4
applicable_subjects: [MATH, PHYSICS, CHEMISTRY]
applicable_stages: [JUNIOR, SENIOR]
cost_weight: 200
timeout_ms: 3000
```

## 附录 B: 推理轨迹示例

以下是一道高中数学函数综合题的完整推理轨迹：

```json
{
  "session_id": "agent-001",
  "query": "已知函数 f(x) = x³ - 3x² + 2，求 f(x) 的单调区间和极值",
  "plan": {
    "problem_type": "CALCULUS_MONOTONICITY_EXTREMUM",
    "complexity": "MODERATE",
    "estimated_steps": 5,
    "steps": [
      {
        "step_order": 1,
        "description": "求导数 f'(x)",
        "step_type": "DEDUCE",
        "depends_on": []
      },
      {
        "step_order": 2,
        "description": "求 f'(x)=0 的根",
        "step_type": "CALCULATE",
        "tool_name": "math_calculator",
        "depends_on": [1]
      },
      {
        "step_order": 3,
        "description": "判断 f'(x) 在各区间的符号",
        "step_type": "ANALYZE",
        "tool_name": "math_calculator",
        "depends_on": [2]
      },
      {
        "step_order": 4,
        "description": "确定单调区间",
        "step_type": "DEDUCE",
        "depends_on": [3]
      },
      {
        "step_order": 5,
        "description": "确定极值点和极值",
        "step_type": "CALCULATE",
        "tool_name": "math_calculator",
        "depends_on": [4]
      }
    ]
  },
  "execution": {
    "total_steps": 5,
    "successful_steps": 5,
    "total_tool_calls": 3,
    "total_tokens": 3200,
    "total_duration_ms": 11800,
    "had_backtrack": false
  },
  "result": {
    "confidence": 0.95,
    "sections": [
      {"type": "PROBLEM_ANALYSIS", "content": "本题考查利用导数研究函数单调性和极值..."},
      {"type": "STEP", "content": "第一步：求导 f'(x) = 3x² - 6x"},
      {"type": "STEP", "content": "第二步：令 f'(x)=0，解得 x₁=0, x₂=2"},
      {"type": "STEP", "content": "第三步：列表分析各区间符号..."},
      {"type": "SUMMARY", "content": "单调递增区间：(-∞,0)和(2,+∞)；单调递减区间：(0,2)；极大值f(0)=2；极小值f(2)=-2"},
      {"type": "TIP", "content": "注意极值点是x的值，极值是函数值，两者不要混淆"}
    ]
  }
}
```

---

> **文档结束。** 本文为 PrimeTop 项目 Agent 多步推理引擎的详细设计，开发人员可依据此文档进行编码实现。如有疑问或需要补充，请在 docs2 目录下新增补充文档或更新本文档。
