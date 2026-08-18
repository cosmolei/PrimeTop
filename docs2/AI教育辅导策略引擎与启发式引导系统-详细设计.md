# AI教育辅导策略引擎与启发式引导系统 - 详细设计

## 1. 模块概述

### 1.1 定位

AI教育辅导策略引擎（Pedagogical Strategy Engine, PSE）是 PrimeTop 的"教学大脑"，负责在每次 AI 学习交互中决定**如何教**——不是教什么内容（由 RAG 和知识库决定），也不是用什么格式呈现（由渲染引擎决定），而是选择最适合当前学生的**教学策略和引导方式**。

本模块是以下现有模块的"策略决策层"：

| 现有模块 | 职责 | 与 PSE 的关系 |
|----------|------|---------------|
| 答案管控与渐进式提示引擎 | 答案分级展示、解锁机制 | PSE 决定展示哪一级、何时升级 |
| AI-Prompt编排与场景模板系统 | Prompt 模板管理、组装 | PSE 选择 Prompt 策略标签 |
| 学习场景意图识别与智能路由引擎 | 识别用户意图 | PSE 接收意图后选择教学策略 |
| 学生学习状态建模与动态评估引擎 | 评估学生状态 | PSE 基于学生状态调整策略 |
| AI模型上下文管理与对话记忆引擎 | 管理对话上下文 | PSE 的决策结果写入上下文 |
| 互动练习与即时反馈引擎 | 练习批改与反馈 | PSE 决定反馈的力度和形式 |

### 1.2 核心设计原则

1. **启发优于灌输**：优先引导学生思考，而非直接给答案
2. **因材施教**：根据学段、能力、历史表现选择差异化策略
3. **渐进释放**：随学生理解深入，逐步减少提示、增加自主性
4. **及时反馈**：每一步都给予有针对性的反馈
5. **正向激励**：避免打击自信，用建设性方式指出错误
6. **策略可观测**：所有策略决策可追溯、可评估、可迭代

### 1.3 适用学段

| 学段 | 策略特点 |
|------|----------|
| 幼儿 | 强引导、高互动、语音为主、即时鼓励 |
| 小学 | 半引导、分步提示、生活化举例、正向反馈 |
| 初中 | 引导与自主结合、追问启发、方法论总结 |
| 高中 | 弱引导、深度分析、方法对比、自主探索 |

---

## 2. 核心概念模型

### 2.1 教学策略模型

```python
class TeachingStrategy(str, Enum):
    """教学策略枚举"""
    # --- 启发策略 ---
    SCAFFOLD = "scaffold"             # 脚手架：分步引导，逐步撤除支持
    SOCRATIC = "socratic"             # 苏格拉底式：通过提问引导发现答案
    HINT_CHAIN = "hint_chain"         # 提示链：从模糊到具体的渐进提示
    EXAMPLE_FIRST = "example_first"   # 例题先行：先给类似例题再看当前题

    # --- 讲解策略 ---
    STEP_BY_STEP = "step_by_step"     # 分步讲解：逐步展示推理过程
    CONCEPT_MAP = "concept_map"       # 概念图：先讲相关知识点再解题
    CONTRAST = "contrast"             # 对比法：与相似但不同的概念/题型对比
    VISUAL_AID = "visual_aid"         # 可视化：借助图形、动画辅助理解
    CONTEXT_MAP = "context_map"       # 语境法：在语境/例句中理解含义（v1.1 补定义）
    MNEMONIC = "mnemonic"             # 记忆术：联想、词根、口诀等记忆技巧（v1.1 补定义）

    # --- 评估策略 ---
    CHECK_UNDERSTANDING = "check_understanding"  # 理解检测：让学生复述或做题验证
    COMMON_MISTAKE = "common_mistake"            # 易错点分析：展示常见错误
    SELF_CORRECT = "self_correct"                # 自我纠正：指出有误让学生自己发现

    # --- 激励策略 ---
    ENCOURAGE = "encourage"           # 鼓励式：肯定进步，建设性反馈
    CHALLENGE = "challenge"           # 挑战式：提供更有挑战的变式题
    MILESTONE = "milestone"           # 里程碑：标记阶段性进步

    # --- 特殊策略 ---
    DIRECT_ANSWER = "direct_answer"   # 直接给答案（低龄/紧急场景受限使用）
    REDIRECT = "redirect"             # 重定向：当问题偏离学习时引导回来
    ESCALATE = "escalate"             # 升级：当前策略无效时切换更强策略
```

### 2.2 策略上下文（StrategyContext）

每次教学交互的策略决策基于以下上下文信息：

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

@dataclass
class StrategyContext:
    """教学策略决策上下文"""
    # --- 学生画像 ---
    student_id: str
    grade_level: GradeLevel              # 学段年级
    cognitive_level: CognitiveLevel      # 认知水平评估
    subject_proficiency: float           # 学科熟练度 [0, 1]
    learning_style: LearningStyle        # 学习风格偏好

    # --- 当前交互 ---
    session_id: str
    interaction_count: int               # 本次会话交互轮次
    intent_type: LearningIntent          # 学习意图（来自意图识别引擎）
    subject: Subject                     # 学科
    topic_id: Optional[str]              # 知识点ID
    question_difficulty: float           # 题目难度 [0, 1]

    # --- 历史表现 ---
    recent_accuracy: float               # 近期该知识点正确率
    hint_usage_rate: float               # 近期提示使用率
    avg_response_depth: int              # 平均作答深度（1-5）
    consecutive_errors: int              # 连续错误次数
    consecutive_corrects: int            # 连续正确次数

    # --- 会话状态 ---
    current_guidance_level: int          # 当前引导深度 [0-4]
    strategies_attempted: list[TeachingStrategy] = field(default_factory=list)
    student_frustration_score: float = 0.0  # 学生挫败感评估 [0, 1]
    engagement_score: float = 0.7           # 参与度评估 [0, 1]

    # --- 时间上下文 ---
    time_of_day: str = "unknown"         # morning/afternoon/evening/night
    session_duration_minutes: float = 0.0
    is_exam_period: bool = False
```

### 2.3 策略决策结果（StrategyDecision）

```python
@dataclass
class StrategyDecision:
    """策略决策结果"""
    primary_strategy: TeachingStrategy
    secondary_strategies: list[TeachingStrategy]
    guidance_level: int                  # 引导深度 [0-4]
    prompt_strategy_tags: list[str]      # 传给 Prompt 编排的策略标签
    answer_reveal_tier: int              # 传给答案管控的展示层级 [0-4]

    # 策略参数
    max_hints: int = 3                   # 最大提示次数
    hint_progression: str = "gradual"    # gradual | aggressive | conservative
    feedback_tone: str = "encouraging"   # encouraging | neutral | challenging
    explanation_depth: str = "standard"  # brief | standard | detailed
    use_analogy: bool = False            # 是否使用类比
    follow_up_action: str = "wait"       # wait | ask | practice | move_on

    # 元信息
    confidence: float                    # 策略决策置信度
    reason: str                          # 决策理由（可追溯）
    fallback_strategy: TeachingStrategy  # 降级策略
```

### 2.4 引导深度模型（Guidance Level）

采用 5 级引导深度模型（Gradual Release of Responsibility）：

```
Level 0: 完全引导 → AI 讲解完整过程，学生跟随理解
Level 1: 强引导   → AI 给出框架和关键步骤，学生填充细节
Level 2: 半引导   → AI 给提示和方向，学生独立完成主体
Level 3: 弱引导   → AI 仅在关键节点提示，学生主导完成
Level 4: 自主完成 → 学生独立完成，AI 仅确认结果
```

引导深度动态调整规则：

| 条件 | 调整 |
|------|------|
| 连续正确 ≥ 3 次 | 深度 +1 |
| 连续错误 ≥ 2 次 | 深度 -1 |
| 主动追问深度问题 | 深度 +1 |
| 反复要求简单解释 | 深度 -1 |
| 一次通过无提示 | 深度 +1 |
| 使用全部提示仍错 | 深度 -1 |
| 挫败感 > 0.7 | 深度设为 0，切换鼓励策略 |
| 参与度 < 0.3 | 深度设为 0，切换互动策略 |

---

## 3. 策略决策引擎

### 3.1 决策流程

```
用户提问
    │
    ▼
意图识别（已有模块）
    │
    ▼
构建 StrategyContext
    │
    ├── 查询学生画像（学习状态建模）
    ├── 查询历史表现（学习记录服务）
    ├── 查询会话状态（上下文管理）
    └── 查询知识点属性（知识点体系）
    │
    ▼
策略决策引擎
    │
    ├── Rule Layer（规则优先）
    │   ├── 安全规则：必须阻断的场景
    │   ├── 分龄规则：按学段的硬约束
    │   └── 频率规则：防止单一策略过度使用
    │
    ├── Scoring Layer（评分选择）
    │   ├── 候选策略集生成
    │   ├── 多维评分计算
    │   └── 加权排序与选择
    │
    └── Adjustment Layer（动态调整）
        ├── 引导深度计算
        ├── 基于实时状态微调
        └── 生成最终决策
    │
    ▼
StrategyDecision 输出
    │
    ├── → Prompt 编排（策略标签）
    ├── → 答案管控（展示层级）
    └── → 上下文管理（策略记录）
```

### 3.2 规则层（Rule Layer）

#### 3.2.1 安全规则

```python
SAFETY_RULES: list[Rule] = [
    # 规则1：禁止对幼儿直接给完整答案
    Rule(
        name="no_direct_answer_for_young",
        condition=lambda ctx: ctx.grade_level <= GradeLevel.G3,
        action=RuleAction(
            block_strategies=[TeachingStrategy.DIRECT_ANSWER],
            force_strategy=TeachingStrategy.SCAFFOLD,
            force_guidance_level=0,
        ),
        priority=100,
    ),

    # 规则2：连续错误≥3次必须降级引导
    Rule(
        name="escalate_on_repeated_failure",
        condition=lambda ctx: ctx.consecutive_errors >= 3,
        action=RuleAction(
            force_strategy=TeachingStrategy.STEP_BY_STEP,
            force_guidance_level=0,
            force_follow_up="ask",
        ),
        priority=90,
    ),

    # 规则3：挫败感过高必须切换鼓励
    Rule(
        name="encourage_on_frustration",
        condition=lambda ctx: ctx.student_frustration_score > 0.7,
        action=RuleAction(
            prepend_strategy=TeachingStrategy.ENCOURAGE,
            force_feedback_tone="encouraging",
            force_explanation_depth="brief",
        ),
        priority=95,
    ),

    # 规则4：考试期间允许更多直接帮助
    Rule(
        name="exam_mode_relaxation",
        condition=lambda ctx: ctx.is_exam_period,
        action=RuleAction(
            allow_direct_answer=True,
            max_guidance_level=2,
        ),
        priority=60,
    ),

    # 规则5：深夜学习使用简短策略
    Rule(
        name="late_night_brief",
        condition=lambda ctx: ctx.time_of_day == "night"
                             and ctx.session_duration_minutes > 60,
        action=RuleAction(
            force_explanation_depth="brief",
            prepend_strategy=TeachingStrategy.ENCOURAGE,
        ),
        priority=50,
    ),
]
```

#### 3.2.2 分龄策略约束

```python
AGE_STRATEGY_CONSTRAINTS = {
    GradeLevel.K: AgeConstraint(
        allowed_strategies=[TeachingStrategy.SCAFFOLD, TeachingStrategy.EXAMPLE_FIRST,
                          TeachingStrategy.VISUAL_AID, TeachingStrategy.ENCOURAGE],
        forbidden_strategies=[TeachingStrategy.DIRECT_ANSWER, TeachingStrategy.SOCRATIC,
                            TeachingStrategy.SELF_CORRECT, TeachingStrategy.CHALLENGE],
        max_guidance_level=1,
        default_feedback_tone="encouraging",
        max_interaction_depth=2,
    ),
    GradeLevel.G1_G3: AgeConstraint(
        allowed_strategies=[TeachingStrategy.SCAFFOLD, TeachingStrategy.HINT_CHAIN,
                          TeachingStrategy.EXAMPLE_FIRST, TeachingStrategy.STEP_BY_STEP,
                          TeachingStrategy.VISUAL_AID, TeachingStrategy.ENCOURAGE,
                          TeachingStrategy.COMMON_MISTAKE],
        forbidden_strategies=[TeachingStrategy.DIRECT_ANSWER],
        max_guidance_level=2,
        default_feedback_tone="encouraging",
    ),
    GradeLevel.G4_G6: AgeConstraint(
        allowed_strategies=ALL_STRATEGIES - {TeachingStrategy.DIRECT_ANSWER},
        forbidden_strategies=[TeachingStrategy.DIRECT_ANSWER],
        max_guidance_level=3,
        default_feedback_tone="encouraging",
    ),
    GradeLevel.G7_G9: AgeConstraint(
        allowed_strategies=ALL_STRATEGIES,
        forbidden_strategies=[],
        max_guidance_level=4,
        default_feedback_tone="neutral",
        restricted_strategies={
            TeachingStrategy.DIRECT_ANSWER: Restriction(max_per_session=2),
        },
    ),
    GradeLevel.G10_G12: AgeConstraint(
        allowed_strategies=ALL_STRATEGIES,
        forbidden_strategies=[],
        max_guidance_level=4,
        default_feedback_tone="neutral",
        restricted_strategies={
            TeachingStrategy.DIRECT_ANSWER: Restriction(max_per_session=3),
        },
    ),
}
```

### 3.3 评分层（Scoring Layer）

#### 3.3.1 策略-场景适配评分矩阵

```python
# 每个维度 [0, 1]，越高越适合
STRATEGY_FITNESS_MATRIX: dict[TeachingStrategy, StrategyFitness] = {
    TeachingStrategy.SCAFFOLD: StrategyFitness(
        # 适合场景评分
        novice_student=0.9,        # 新手学生
        complex_problem=0.8,       # 复杂问题
        multi_step=0.9,            # 多步骤问题
        first_encounter=0.9,       # 首次接触知识点
        # 不适合场景评分（低分）
        expert_student=0.3,        # 熟练学生
        simple_question=0.2,       # 简单问题
        exam_rush=0.4,             # 考试赶时间
    ),
    TeachingStrategy.SOVRATIC: StrategyFitness(
        novice_student=0.3,
        complex_problem=0.7,
        multi_step=0.5,
        first_encounter=0.2,
        expert_student=0.8,
        simple_question=0.3,
        concept_check=0.9,         # 概念理解检查
    ),
    TeachingStrategy.HINT_CHAIN: StrategyFitness(
        novice_student=0.7,
        complex_problem=0.6,
        multi_step=0.7,
        first_encounter=0.6,
        expert_student=0.5,
        simple_question=0.8,
        partial_understanding=0.9, # 部分理解
    ),
    TeachingStrategy.STEP_BY_STEP: StrategyFitness(
        novice_student=0.8,
        complex_problem=0.9,
        multi_step=0.9,
        first_encounter=0.7,
        expert_student=0.4,
        repeated_errors=0.9,       # 反复出错
    ),
    TeachingStrategy.SELF_CORRECT: StrategyFitness(
        novice_student=0.2,
        expert_student=0.8,
        minor_error=0.9,           # 小错误
        major_misconception=0.3,   # 严重误解
    ),
    TeachingStrategy.CHECK_UNDERSTANDING: StrategyFitness(
        post_explanation=0.9,      # 讲解后
        end_of_topic=0.8,          # 知识点学完
        before_advance=0.8,        # 进入下一阶段前
    ),
    # ... 其他策略类似
}
```

#### 3.3.2 综合评分算法

```python
def score_strategy(
    strategy: TeachingStrategy,
    context: StrategyContext,
    fitness_matrix: dict[TeachingStrategy, StrategyFitness],
) -> float:
    """
    综合评分算法：基于多维加权计算策略适配度
    
    返回: float [0, 1]，越高越适合
    """
    fitness = fitness_matrix[strategy]
    
    # 1. 场景适配分（基于学生状态和问题特征）
    scene_score = _compute_scene_score(fitness, context)
    
    # 2. 历史效果分（该策略在此类学生上的历史效果）
    history_score = _compute_history_score(strategy, context)
    
    # 3. 新鲜度分（避免同一策略重复使用导致疲劳）
    freshness_score = _compute_freshness_score(strategy, context)
    
    # 4. 效率分（该策略的预期耗时与学生可用时间的匹配度）
    efficiency_score = _compute_efficiency_score(strategy, context)
    
    # 加权求和
    weights = STRATEGY_WEIGHTS[context.grade_level]
    total = (
        scene_score * weights.scene +
        history_score * weights.history +
        freshness_score * weights.freshness +
        efficiency_score * weights.efficiency
    )
    
    return total


STRATEGY_WEIGHTS = {
    # v1.1 修复：v1.0 仅有 G1_G6 键，与 §3.2.2 AGE_STRATEGY_CONSTRAINTS 的
    # G1_G3 / G4_G6 粒度不一致，运行期查表抛 KeyError。现按五学段统一。
    GradeLevel.K: StrategyWeights(scene=0.5, history=0.1, freshness=0.2, efficiency=0.2),
    GradeLevel.G1_G3: StrategyWeights(scene=0.45, history=0.15, freshness=0.2, efficiency=0.2),
    GradeLevel.G4_G6: StrategyWeights(scene=0.4, history=0.2, freshness=0.2, efficiency=0.2),
    GradeLevel.G7_G9: StrategyWeights(scene=0.35, history=0.3, freshness=0.15, efficiency=0.2),
    GradeLevel.G10_G12: StrategyWeights(scene=0.3, history=0.3, freshness=0.1, efficiency=0.3),
}


def _compute_scene_score(fitness: StrategyFitness, ctx: StrategyContext) -> float:
    """基于当前场景特征匹配策略适配度"""
    scores = []
    
    # 学生水平维度
    if ctx.subject_proficiency < 0.3:
        scores.append(fitness.novice_student)
    elif ctx.subject_proficiency > 0.7:
        scores.append(fitness.expert_student)
    
    # 问题复杂度维度
    if ctx.question_difficulty > 0.7:
        scores.append(fitness.complex_problem)
    elif ctx.question_difficulty < 0.3:
        scores.append(fitness.simple_question)
    
    # 错误状态维度
    if ctx.consecutive_errors >= 2:
        scores.append(fitness.repeated_errors if hasattr(fitness, 'repeated_errors') else 0.5)
    
    return sum(scores) / len(scores) if scores else 0.5


def _compute_freshness_score(strategy: TeachingStrategy, ctx: StrategyContext) -> float:
    """
    新鲜度：近期使用过的策略得分降低
    - 最近1次使用: 降 0.3
    - 最近2-3次使用: 降 0.15
    - 最近4-5次使用: 降 0.05
    - 未使用: 1.0
    """
    recent_count = ctx.strategies_attempted[-5:].count(strategy)
    if recent_count == 0:
        return 1.0
    elif recent_count == 1:
        return 0.7
    elif recent_count <= 3:
        return 0.85
    else:
        return 0.95
```

### 3.4 动态调整层（Adjustment Layer）

```python
class GuidanceAdjuster:
    """引导深度动态调整器"""
    
    def compute_guidance_level(self, ctx: StrategyContext) -> int:
        """计算推荐引导深度"""
        base_level = self._base_from_proficiency(ctx.subject_proficiency)
        
        # 趋势调整
        if ctx.consecutive_corrects >= 3:
            trend_adjust = +1
        elif ctx.consecutive_errors >= 2:
            trend_adjust = -1
        else:
            trend_adjust = 0
        
        # 挫败感调整（覆盖其他调整）
        if ctx.student_frustration_score > 0.7:
            trend_adjust = -base_level  # 直接降到 0
        
        adjusted = max(0, min(4, base_level + trend_adjust))
        
        # 分龄上限约束
        age_constraint = AGE_STRATEGY_CONSTRAINTS[ctx.grade_level]
        adjusted = min(adjusted, age_constraint.max_guidance_level)
        
        return adjusted
    
    def _base_from_proficiency(self, proficiency: float) -> int:
        """基于熟练度确定基础引导深度"""
        if proficiency < 0.2:
            return 0
        elif proficiency < 0.4:
            return 1
        elif proficiency < 0.6:
            return 2
        elif proficiency < 0.8:
            return 3
        else:
            return 4
```

---

## 4. 学科特定策略

### 4.1 数学学科策略

```python
MATH_STRATEGY_RULES: dict[QuestionType, StrategySequence] = {
    QuestionType.COMPUTATION: StrategySequence(
        # 计算题策略链
        default_sequence=[
            TeachingStrategy.HINT_CHAIN,       # 先给方向提示
            TeachingStrategy.SCAFFOLD,          # 不行则分步引导
            TeachingStrategy.STEP_BY_STEP,      # 再不行则完整展示
        ],
        error_handling=TeachingStrategy.COMMON_MISTAKE,  # 出错时分析易错点
        verification=TeachingStrategy.CHECK_UNDERSTANDING, # 出类似题验证
    ),
    QuestionType.GEOMETRY: StrategySequence(
        default_sequence=[
            TeachingStrategy.VISUAL_AID,        # 先画图/标辅助线
            TeachingStrategy.SCAFFOLD,          # 引导分析几何关系
            TeachingStrategy.STEP_BY_STEP,      # 完整推导
        ],
    ),
    QuestionType.WORD_PROBLEM: StrategySequence(
        default_sequence=[
            TeachingStrategy.SOCRATIC,            # 提问引导审题
            TeachingStrategy.SCAFFOLD,           # 引导建模
            TeachingStrategy.HINT_CHAIN,         # 解题提示
        ],
    ),
    QuestionType.PROOF: StrategySequence(
        default_sequence=[
            TeachingStrategy.CONCEPT_MAP,        # 先回顾相关定理
            TeachingStrategy.HINT_CHAIN,         # 给推理方向
            TeachingStrategy.SELF_CORRECT,       # 让学生尝试并自检
        ],
    ),
}
```

### 4.2 语文学科策略

```python
CHINESE_STRATEGY_RULES: dict[TaskType, StrategySequence] = {
    TaskType.READING_COMPREHENSION: StrategySequence(
        default_sequence=[
            TeachingStrategy.SOVRATIC,           # 提问引导文本分析
            TeachingStrategy.CONCEPT_MAP,        # 关联写作手法/修辞
            TeachingStrategy.CHECK_UNDERSTANDING, # 出理解题验证
        ],
    ),
    TaskType.ANCIENT_TEXT: StrategySequence(
        default_sequence=[
            TeachingStrategy.SCAFFOLD,           # 逐句引导翻译
            TeachingStrategy.HINT_CHAIN,         # 关键词释义提示
            TeachingStrategy.CONTRAST,           # 古今义对比
        ],
    ),
    TaskType.COMPOSITION: StrategySequence(
        default_sequence=[
            TeachingStrategy.SOVRATIC,           # 引导审题和立意
            TeachingStrategy.SCAFFOLD,           # 结构框架引导
            TeachingStrategy.ENCOURAGE,          # 肯定优点
            TeachingStrategy.COMMON_MISTAKE,     # 指出常见问题
        ],
    ),
}
```

### 4.3 英语学科策略

```python
ENGLISH_STRATEGY_RULES: dict[TaskType, StrategySequence] = {
    TaskType.GRAMMAR: StrategySequence(
        default_sequence=[
            TeachingStrategy.EXAMPLE_FIRST,      # 先给例句
            TeachingStrategy.CONTRAST,           # 正误对比
            TeachingStrategy.HINT_CHAIN,         # 规则提示
        ],
    ),
    TaskType.VOCABULARY: StrategySequence(
        default_sequence=[
            TeachingStrategy.CONTEXT_MAP,        # 语境中理解
            TeachingStrategy.MNEMONIC,           # 记忆技巧
            TeachingStrategy.CHECK_UNDERSTANDING, # 用法检测
        ],
    ),
    TaskType.ORAL_PRACTICE: StrategySequence(
        default_sequence=[
            TeachingStrategy.EXAMPLE_FIRST,      # 示范发音/表达
            TeachingStrategy.ENCOURAGE,          # 鼓励尝试
            TeachingStrategy.SCAFFOLD,           # 提供表达支架
        ],
    ),
}
```

### 4.4 理科学科策略

```python
SCIENCE_STRATEGY_RULES: dict[Subject, dict[QuestionType, StrategySequence]] = {
    Subject.PHYSICS: {
        QuestionType.EXPERIMENT_ANALYSIS: StrategySequence(
            default_sequence=[
                TeachingStrategy.VISUAL_AID,     # 实验过程可视化
                TeachingStrategy.SOVRATIC,        # 引导分析变量关系
                TeachingStrategy.STEP_BY_STEP,   # 公式推导
            ],
        ),
        QuestionType.FORCE_ANALYSIS: StrategySequence(
            default_sequence=[
                TeachingStrategy.VISUAL_AID,     # 受力分析图
                TeachingStrategy.SCAFFOLD,        # 引导建坐标系
                TeachingStrategy.HINT_CHAIN,     # 方程提示
            ],
        ),
    },
    Subject.CHEMISTRY: {
        QuestionType.EQUATION_BALANCE: StrategySequence(
            default_sequence=[
                TeachingStrategy.EXAMPLE_FIRST,   # 先看配平范例
                TeachingStrategy.HINT_CHAIN,      # 化合价/电子转移提示
                TeachingStrategy.SELF_CORRECT,    # 尝试自检
            ],
        ),
    },
}
```

---

## 5. 挫败感检测与干预

### 5.1 挫败感评估模型

```python
@dataclass
class FrustrationIndicators:
    """挫败感评估指标"""
    # 行为指标
    rapid_repeated_asks: float = 0.0      # 短时间内重复问同类问题
    hint_rejection_rate: float = 0.0       # 拒绝提示（跳过/关闭）
    session_exit_probability: float = 0.0  # 会话退出概率
    response_time_trend: float = 0.0      # 响应时间趋势（递增=挫败）
    
    # 语义指标
    negative_sentiment: float = 0.0        # 负面情绪检测
    confusion_keywords: float = 0.0        # 困惑关键词频率
    give_up_signals: float = 0.0           # 放弃信号（"算了"、"不会"）
    
    # 学习指标
    accuracy_decline: float = 0.0          # 正确率下降趋势
    error_type_shift: float = 0.0          # 错误类型恶化（方法错→概念错）


def compute_frustration_score(indicators: FrustrationIndicators) -> float:
    """
    综合挫败感评分 [0, 1]
    
    阈值:
    - < 0.3: 正常，学生正在思考
    - 0.3-0.5: 轻度挫败，可继续当前策略
    - 0.5-0.7: 中度挫败，需要调整策略
    - > 0.7: 高度挫败，必须干预
    """
    weights = {
        "rapid_repeated_asks": 0.15,
        "hint_rejection_rate": 0.10,
        "session_exit_probability": 0.10,
        "negative_sentiment": 0.20,
        "confusion_keywords": 0.15,
        "give_up_signals": 0.20,
        "accuracy_decline": 0.10,
    }
    
    score = sum(
        getattr(indicators, k) * w for k, w in weights.items()
    )
    return min(1.0, score)
```

### 5.2 干预策略矩阵

```python
FRUSTRATION_INTERVENTIONS: dict[FrustrationLevel, InterventionPlan] = {
    FrustrationLevel.LOW: InterventionPlan(
        level=0.0,
        actions=[
            # 继续当前策略，轻微调整
            InterventionAction(
                strategy_adjustment=StrategyAdjustment(
                    feedback_tone="encouraging",
                    explanation_depth="brief",
                ),
            ),
        ],
    ),
    FrustrationLevel.MEDIUM: InterventionPlan(
        level=0.5,
        actions=[
            InterventionAction(
                name="switch_to_easier",
                strategy_adjustment=StrategyAdjustment(
                    primary_strategy=TeachingStrategy.SCAFFOLD,
                    guidance_level=lambda ctx: max(0, ctx.current_guidance_level - 1),
                    max_hints=5,
                    use_analogy=True,
                ),
            ),
            InterventionAction(
                name="acknowledge_difficulty",
                prepend_message="这个问题确实有一定难度，我们换个角度来看",
            ),
        ],
    ),
    FrustrationLevel.HIGH: InterventionPlan(
        level=0.7,
        actions=[
            InterventionAction(
                name="full_reset",
                strategy_adjustment=StrategyAdjustment(
                    primary_strategy=TeachingStrategy.STEP_BY_STEP,
                    guidance_level=0,
                    follow_up_action="ask",
                    feedback_tone="encouraging",
                    explanation_depth="detailed",
                ),
            ),
            InterventionAction(
                name="positive_reinforcement",
                prepend_message="你已经理解了前面的步骤，这说明你的基础很扎实。让我们一起完成最后这部分。",
            ),
            InterventionAction(
                name="suggest_break",
                condition=lambda ctx: ctx.session_duration_minutes > 30,
                prepend_message="要不我们先休息一下，稍后再回来。休息后的大脑解题效率会更高！",
                force_follow_up="move_on",          # 不再继续当前题，转向收尾
                emit_event="pse.intervention.suggest_break",  # 客户端展示休息引导卡
            ),
        ],
    ),
    FrustrationLevel.CRITICAL: InterventionPlan(
        level=0.9,
        actions=[
            InterventionAction(
                name="stop_and_downshift",
                strategy_adjustment=StrategyAdjustment(
                    primary_strategy=TeachingStrategy.EXAMPLE_FIRST,  # 换最简单的同类例题
                    guidance_level=0,
                    follow_up_action="move_on",      # 本题不再纠缠
                    feedback_tone="encouraging",
                    explanation_depth="brief",
                    max_hints=6,
                ),
            ),
            InterventionAction(
                name="acknowledge_emotion",
                prepend_message="这道题真的挺难，你不是学不会，只是还没找到切入点。我们先看一个简单很多的例子。",
            ),
            InterventionAction(
                name="suggest_stop_today",
                condition=lambda ctx: ctx.session_duration_minutes > 45
                                     or ctx.time_of_day == "night",
                prepend_message="今天已经学了不少了，大脑也需要休息。明天再来挑战它，说不定一下子就通了！",
                emit_event="pse.intervention.suggest_session_end",  # 客户端展示今日总结入口
            ),
            InterventionAction(
                name="notify_parent_gently",
                # 仅小学及以下、且家长已订阅学情提醒时触发；
                # 话术固定为「今天有道题比较难，孩子坚持了很久」，
                # 禁止指责性/焦虑性表述（合规红线 C3）
                condition=lambda ctx: ctx.grade_level in (GradeLevel.K, GradeLevel.G1_G3,
                                                         GradeLevel.G4_G6)
                                     and ctx.student_frustration_score > 0.9,
                emit_event="pse.intervention.triggered",
                event_payload={"kind": "PERSISTENT_STRUGGLE", "notify": "parent_summary"},
            ),
        ],
    ),
}


# 挫败等级判定（与 §5.1 阈值对齐）
def classify_frustration(score: float) -> FrustrationLevel:
    if score < 0.3:
        return FrustrationLevel.NONE
    elif score < 0.5:
        return FrustrationLevel.LOW
    elif score < 0.7:
        return FrustrationLevel.MEDIUM
    elif score < 0.9:
        return FrustrationLevel.HIGH
    else:
        return FrustrationLevel.CRITICAL


### 5.3 干预执行器与防重复规则

干预不是每次挫败信号都触发，必须做冷却与上限控制，防止「过度关怀」变成新的打扰：

```python
class FrustrationInterventionExecutor:
    """挫败干预执行器"""

    INTERVENTION_COOLDOWN_SECONDS = 900      # 同会话同级别干预冷却 15 分钟
    MAX_INTERVENTIONS_PER_SESSION = 3        # 单会话干预总次数上限
    ESCALATE_WINDOW_SECONDS = 300            # 5 分钟内挫败分连升两级 → 跳级干预

    async def maybe_intervene(
        self, ctx: StrategyContext, decision: StrategyDecision
    ) -> StrategyDecision:
        level = classify_frustration(ctx.student_frustration_score)
        if level is FrustrationLevel.NONE:
            return decision

        # 规则1：冷却期内不重复干预，仅温和调整语气
        if await self._in_cooldown(ctx.session_id, level):
            decision.feedback_tone = "encouraging"
            return decision

        # 规则2：单会话干预次数上限（防说教疲劳）
        if await self._session_intervention_count(ctx.session_id) >= self.MAX_INTERVENTIONS_PER_SESSION:
            decision.feedback_tone = "encouraging"
            return decision

        # 规则3：快速恶化检测——5 分钟内连升两级，直接按更高级别处理
        effective_level = await self._escalate_if_rapid_worsening(ctx, level)

        plan = FRUSTRATION_INTERVENTIONS[effective_level]
        for action in plan.actions:
            if action.condition and not action.condition(ctx):
                continue
            decision = self._apply_action(decision, action)
            if action.emit_event:
                await self._publish_intervention_event(ctx, decision, action)

        await self._record_intervention(ctx, effective_level, decision)
        await self._set_cooldown(ctx.session_id, effective_level)
        return decision
```

| 防重复规则 | 参数 | 目的 |
|-----------|------|------|
| 同级别冷却 | 15 min | 同一挫败级别短时间内只干预一次 |
| 会话总上限 | 3 次/会话 | 防止连续关怀消息变成噪音 |
| 跳级窗口 | 5 min 内连升两级 | 高速恶化时跳过中间级别直接强干预 |
| 跨会话去重 | 同一 topic_id 24h 内不重复 MEDIUM 以上干预 | 换个会话回来不重复安慰 |
| 与防沉迷协同 | suggest_break 事件后 15 min 内防沉迷休息提醒不再推 | 防双重打扰（见 §16 对齐项 9） |

---

## 6. 策略执行追踪与效果反馈闭环

「策略可观测、可评估、可迭代」（§1.2 原则 6）的落地：每次决策有唯一标识，结果可回报，效果可统计，统计反哺评分层的历史效果分。

### 6.1 决策标识与决策流水

- 每次决策生成 `decision_id`（格式：`pse_dec_` + ULID），随 StrategyDecision 返回给调用方。
- 调用方（AI 辅导编排器 / 语音编排器 / 互动练习引擎）在后续消息或反馈接口中回传 `decision_id`，实现决策与效果的闭环绑定。
- 决策流水落库 `pse_strategy_decision`（§7.1），上下文仅存**特征快照**（学段/熟练度/挫败分/意图/难度），不存对话原文（合规 C5）。

### 6.2 结果绑定与效果归因

策略效果统一抽象为六类结果（StrategyOutcome），由三个上报方写入：

| 结果枚举 | 含义 | 典型上报方 |
|---------|------|------------|
| SOLVED_NO_HINT | 未再要提示即完成/答对 | 判题引擎、互动练习 |
| SOLVED_WITH_HINT | 使用提示后完成 | 答案管控（提示解锁记录）、对话（追问后自答） |
| STILL_STUCK | 仍然卡住（再次求助同类问题） | 对话编排器、意图识别序列 |
| GAVE_UP | 放弃（换题/退出/「算了」） | 会话结束快照、语义检测 |
| OFF_TOPIC | 偏离学习（闲聊/无关请求） | 意图识别、话题漂移检测引擎 |
| NEGATIVE_FEEDBACK | 用户点踩/明确表示没帮助 | 反馈入口、评价服务 |

```python
def compute_effectiveness_score(outcomes: dict[str, int], total: int) -> float:
    """单策略效果分 [0,1]：解决且少提示得高分，卡住/放弃/负反馈扣分"""
    if total == 0:
        return 0.5  # 无样本时中性
    w = {
        "SOLVED_NO_HINT": 1.0,
        "SOLVED_WITH_HINT": 0.7,
        "STILL_STUCK": 0.1,
        "GAVE_UP": 0.0,
        "OFF_TOPIC": 0.3,   # 策略无过错但不加分
        "NEGATIVE_FEEDBACK": 0.0,
    }
    return sum(outcomes.get(k, 0) * v for k, v in w.items()) / total
```

### 6.3 效果统计与历史效果分反哺

- **日聚合**：每日 02:30 将前一日 `pse_strategy_outcome` 按（学段 × 学科 × 策略）聚到 `pse_strategy_effect_stats`，滚动 30 天窗口计算 `effectiveness_score`。
- **历史效果分**（§3.3.2 `history_score`）= 近 30 天同（学段, 学科, 策略）的 `effectiveness_score`，样本 < 500 时向 0.5 收缩：`0.5 + (score - 0.5) * sample / 500`。
- **权重自优化护栏**：每周允许 STRATEGY_WEIGHTS 至多 ±0.05 自动微调，且 scene+history+freshness+efficiency 之和恒等于 1.0；微调仅对 G7+ 生效（低学段以安全规则优先，不做线上自优化）。

### 6.4 策略疲劳与多样性保护

- freshness（§3.3.2）已对最近 5 次内重复策略降分。
- 追加硬约束：同一会话内同一策略连续使用 ≤ 3 次；第 4 次即使得分最高也强制换选次优策略（差值容忍 0.15 以内），除非被安全规则 force。

---

## 7. 数据模型

存储选型：决策/结果/干预日志 MySQL 8.0（utf8mb4，月分区）；配置 MySQL；统计聚合 MySQL；Redis 做上下文/冷却/计数缓存。

### 7.1 决策流水表 pse_strategy_decision

```sql
CREATE TABLE pse_strategy_decision (
    id               BIGINT       NOT NULL AUTO_INCREMENT,
    decision_id      CHAR(30)     NOT NULL COMMENT 'pse_dec_{ULID}',
    student_id       BIGINT       NOT NULL,
    session_id       VARCHAR(64)  NOT NULL COMMENT '学习会话ID',
    interaction_seq  INT          NOT NULL COMMENT '会话内交互序号，调用方保证单调递增',
    intent_type      VARCHAR(32)  NOT NULL COMMENT 'LearningIntent 枚举值',
    subject          VARCHAR(16)  NOT NULL,
    topic_id         VARCHAR(64)  NULL,
    grade_level      VARCHAR(8)   NOT NULL COMMENT 'K/G1_G3/G4_G6/G7_G9/G10_G12',
    -- 特征快照（最小化，不存对话原文）
    f_proficiency    DECIMAL(4,3) NOT NULL DEFAULT 0.500,
    f_difficulty     DECIMAL(4,3) NULL,
    f_recent_acc     DECIMAL(4,3) NULL,
    f_consec_err     TINYINT      NOT NULL DEFAULT 0,
    f_consec_ok      TINYINT      NOT NULL DEFAULT 0,
    f_frustration    DECIMAL(4,3) NOT NULL DEFAULT 0.000,
    f_engagement     DECIMAL(4,3) NOT NULL DEFAULT 0.700,
    f_time_of_day    VARCHAR(8)   NOT NULL DEFAULT 'unknown',
    -- 决策内容
    primary_strategy VARCHAR(24)  NOT NULL,
    secondary_strategies JSON     NULL,
    guidance_level   TINYINT      NOT NULL,
    prompt_tags      JSON         NULL COMMENT '传 Prompt 编排的策略标签数组',
    answer_reveal_tier TINYINT    NOT NULL DEFAULT 1,
    max_hints        TINYINT      NOT NULL DEFAULT 3,
    feedback_tone    VARCHAR(16)  NOT NULL DEFAULT 'encouraging',
    explanation_depth VARCHAR(16) NOT NULL DEFAULT 'standard',
    follow_up_action VARCHAR(16)  NOT NULL DEFAULT 'wait',
    -- 决策元信息
    rule_hits        JSON         NULL COMMENT '命中的规则名列表（可追溯）',
    confidence       DECIMAL(4,3) NOT NULL DEFAULT 0.800,
    reason           VARCHAR(512) NOT NULL,
    fallback_strategy VARCHAR(24) NOT NULL,
    degraded         TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1=降级决策（D1-D10）',
    config_version   INT          NOT NULL,
    created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id, created_at),
    UNIQUE KEY uk_session_seq (session_id, interaction_seq),
    UNIQUE KEY uk_decision (decision_id),
    KEY idx_student_time (student_id, created_at),
    KEY idx_strategy_time (subject, primary_strategy, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='PSE 决策流水，月分区，在线 90 天后归档 ClickHouse'
PARTITION BY RANGE (TO_DAYS(created_at)) (
    PARTITION p202608 VALUES LESS THAN (TO_DAYS('2026-09-01')),
    PARTITION p202609 VALUES LESS THAN (TO_DAYS('2026-10-01'))
);
```

> 分区表要求分区键包含在主键中，故主键为 (id, created_at)；按月滚动新增分区。

### 7.2 策略结果表 pse_strategy_outcome

```sql
CREATE TABLE pse_strategy_outcome (
    id                BIGINT      NOT NULL AUTO_INCREMENT,
    decision_id       CHAR(30)    NOT NULL,
    outcome           ENUM('SOLVED_NO_HINT','SOLVED_WITH_HINT','STILL_STUCK',
                            'GAVE_UP','OFF_TOPIC','NEGATIVE_FEEDBACK') NOT NULL,
    hints_used        TINYINT     NULL COMMENT '达到的提示层级数（答案管控回传）',
    reveal_tier_reached TINYINT   NULL COMMENT '实际看到的最深层级 0-4',
    response_seconds  INT         NULL COMMENT '从决策到结果的耗时',
    student_rating    TINYINT     NULL COMMENT '用户即时评价 1 helpful / 0 not_helpful',
    next_interaction_seq INT      NULL COMMENT '绑定到的下一次交互序号',
    reported_by       VARCHAR(24) NOT NULL COMMENT 'dialogue/judge/practice/voice',
    created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_decision_outcome (decision_id),  -- 一决策一结果，重复回报幂等命中
    KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='策略结果回报，保留 180 天';
```

### 7.3 效果统计表 pse_strategy_effect_stats

```sql
CREATE TABLE pse_strategy_effect_stats (
    id                  BIGINT      NOT NULL AUTO_INCREMENT,
    stat_date           DATE        NOT NULL,
    grade_level         VARCHAR(8)  NOT NULL,
    subject             VARCHAR(16) NOT NULL,
    strategy            VARCHAR(24) NOT NULL,
    decisions           BIGINT      NOT NULL DEFAULT 0,
    solved_no_hint      INT         NOT NULL DEFAULT 0,
    solved_with_hint    INT         NOT NULL DEFAULT 0,
    still_stuck         INT         NOT NULL DEFAULT 0,
    gave_up             INT         NOT NULL DEFAULT 0,
    off_topic           INT         NOT NULL DEFAULT 0,
    negative_feedback   INT         NOT NULL DEFAULT 0,
    effectiveness_score DECIMAL(4,3) NOT NULL DEFAULT 0.500,
    sample_size         INT         NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_dim (stat_date, grade_level, subject, strategy),
    KEY idx_strategy (strategy, stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='策略效果日聚合，保留 13 个月';
```

### 7.4 干预记录表 pse_intervention_log

```sql
CREATE TABLE pse_intervention_log (
    id               BIGINT      NOT NULL AUTO_INCREMENT,
    session_id       VARCHAR(64) NOT NULL,
    student_id       BIGINT      NOT NULL,
    frustration_level VARCHAR(8) NOT NULL COMMENT 'LOW/MEDIUM/HIGH/CRITICAL',
    frustration_score DECIMAL(4,3) NOT NULL,
    actions          JSON        NOT NULL COMMENT '实际执行的动作名列表',
    decision_id      CHAR(30)    NOT NULL,
    created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_student_time (student_id, created_at),
    KEY idx_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='挫败干预记录，保留 180 天';
```

### 7.5 策略配置表 pse_strategy_config（版本化）

```sql
CREATE TABLE pse_strategy_config (
    id              INT         NOT NULL AUTO_INCREMENT,
    config_version  INT         NOT NULL,
    content         JSON        NOT NULL COMMENT '{"rules":..,"weights":..,"matrix":..,"age_constraints":..}',
    status          ENUM('DRAFT','PUBLISHED','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    gray_percentage TINYINT     NOT NULL DEFAULT 100,
    created_by      BIGINT      NOT NULL,
    approved_by     BIGINT      NULL,
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    published_at    DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_version (config_version),
    KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='策略规则/权重/矩阵版本化配置';
```

### 7.6 事件外发表 pse_outbox

```sql
CREATE TABLE pse_outbox (
    id           BIGINT       NOT NULL AUTO_INCREMENT,
    event_id     CHAR(30)     NOT NULL,
    event_type   VARCHAR(64)  NOT NULL,
    aggregate_id VARCHAR(64)  NOT NULL,
    payload      JSON         NOT NULL,
    status       ENUM('PENDING','SENT','DEAD') NOT NULL DEFAULT 'PENDING',
    retry_count  TINYINT      NOT NULL DEFAULT 0,
    created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    sent_at      DATETIME(3)  NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_event (event_id),
    KEY idx_status_time (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PSE Outbox，与决策同事务写入';
```

事件类型：`pse.decision.made`（学情/埋点消费）、`pse.intervention.triggered`（通知/家长周报）、`pse.intervention.suggest_break`（客户端/防沉迷协同）、`pse.intervention.suggest_session_end`、`pse.config.published`（配置中心审计）。

### 7.7 Redis Key 总表

| Key | 类型 | TTL | 用途 |
|-----|------|-----|------|
| `pse:ctx:{session_id}` | Hash | 2h | StrategyContext 会话缓存 |
| `pse:dec:{session_id}:{interaction_seq}` | String(JSON) | 30min | 决策幂等缓存（重试命中直接返回） |
| `pse:direct:{session_id}` | String(int) | 2h | 会话内 DIRECT_ANSWER 已用次数（频控） |
| `pse:hint:{session_id}:{question_ref}` | Hash | 30min | 提示链推进状态（当前层级/是否触底） |
| `pse:iv:cd:{session_id}:{level}` | String(ts) | 15min | 干预冷却 |
| `pse:iv:cnt:{session_id}` | String(int) | 2h | 会话干预计数 |
| `pse:iv:topic:{student_id}:{topic_id}` | String(ts) | 24h | 同知识点跨会话干预去重 |
| `pse:cfg:current` | String(JSON) | 发布时写入 | 当前已发布配置快照 |
| `pse:rl:decide:{student_id}` | ZSET | 60s | 决策接口滑动窗限流（安全兜底） |

---

## 8. API 设计

PSE 为**纯内部服务**（AI 编排层调用），不对客户端直接暴露；管理端接口走管理后台网关。

### 8.1 核心决策接口

`POST /internal/v1/pse/decide`

幂等性：`(session_id, interaction_seq)` 唯一；重复请求返回首次决策（幂等命中标记 `idempotent_replay=true`）。

请求：

```json
{
  "session_id": "ls_9f2c8a1b",
  "interaction_seq": 7,
  "student_id": 100234,
  "intent_type": "homework_help",
  "subject": "MATH",
  "topic_id": "kp_math_0803",
  "question_type": "WORD_PROBLEM",
  "question_difficulty": 0.72,
  "interaction_signals": {
    "rapid_repeated_asks": 0.4,
    "negative_sentiment": 0.2,
    "give_up_signals": 0.0,
    "response_time_trend": 0.3
  },
  "channel": "text",
  "timeout_ms": 50
}
```

> 学生画像/历史表现/挫败基准分由 PSE 服务端从学习状态建模引擎与学习记录服务拉取并缓存；`interaction_signals` 为本次交互的实时增量信号（语义由 AI 辅导编排器随轮附带，见 §16 对齐项 4/7）。`channel=voice` 时预算压缩为 30ms。

响应：

```json
{
  "code": 0,
  "data": {
    "decision_id": "pse_dec_01J8ZK3Q9T5W2Y7A8B6C4D0E1F",
    "primary_strategy": "scaffold",
    "secondary_strategies": ["hint_chain", "step_by_step"],
    "guidance_level": 2,
    "prompt_strategy_tags": [
      "pse.primary=scaffold", "pse.guidance=2", "pse.tone=encouraging",
      "pse.depth=standard", "pse.analogy=false", "pse.subject_seq=math_word_problem"
    ],
    "answer_reveal_tier": 1,
    "max_hints": 3,
    "hint_progression": "gradual",
    "feedback_tone": "encouraging",
    "explanation_depth": "standard",
    "use_analogy": false,
    "follow_up_action": "ask",
    "prepend_messages": [],
    "intervention": null,
    "confidence": 0.86,
    "reason": "G7 数学应用题/熟练度0.62/近3题错2 → 场景适配 scaffold 最高且近5次未用；规则层无命中",
    "fallback_strategy": "step_by_step",
    "rule_hits": [],
    "degraded": false,
    "config_version": 12,
    "idempotent_replay": false
  }
}
```

`prepend_messages`：干预动作注入的前置关怀话术，由调用方拼在 AI 回复最前部（不进入 Prompt，避免污染生成内容）。

### 8.2 结果回报接口

`POST /internal/v1/pse/feedback`

```json
{
  "decision_id": "pse_dec_01J8ZK3Q9T5W2Y7A8B6C4D0E1F",
  "outcome": "SOLVED_WITH_HINT",
  "hints_used": 2,
  "reveal_tier_reached": 2,
  "response_seconds": 214,
  "student_rating": 1,
  "next_interaction_seq": 9,
  "reported_by": "judge"
}
```

- 幂等：`uk_decision_outcome` 唯一键，重复回报返回 `56415`（幂等命中，非错误语义，HTTP 200 + code=56415）。
- `decision_id` 不存在 → `56414`。

### 8.3 会话策略状态查询

`GET /internal/v1/pse/sessions/{session_id}/state`

```json
{
  "code": 0,
  "data": {
    "session_id": "ls_9f2c8a1b",
    "current_guidance_level": 2,
    "strategies_attempted": ["scaffold", "hint_chain"],
    "direct_answer_used": 0,
    "direct_answer_quota": 2,
    "frustration": {"score": 0.34, "level": "LOW", "last_intervention_at": null},
    "hint_chain": {"question_ref": "q_8821", "current_tier": 1, "max_tier": 3}
  }
}
```

### 8.4 gRPC 接口（高频路径）

```protobuf
service PedagogicalStrategyService {
  // 同步决策，超时预算由 deadline 传递（文本 50ms / 语音 30ms）
  rpc Decide(StrategyDecideRequest) returns (StrategyDecideResponse);
  // 结果回报（可异步 fire-and-forget，服务端幂等）
  rpc ReportOutcome(StrategyOutcomeRequest) returns (StrategyOutcomeResponse);
  // 语音链路轻量状态查询（打断恢复用）
  rpc GetSessionState(SessionStateRequest) returns (SessionStateResponse);
}
```

### 8.5 管理端接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/admin/v1/pse/configs?status=` | 配置版本列表 |
| GET | `/admin/v1/pse/configs/{version}` | 配置详情（规则/权重/矩阵） |
| POST | `/admin/v1/pse/configs` | 新建 DRAFT（JSON Schema 校验，失败 56416） |
| POST | `/admin/v1/pse/configs/{version}/publish` | 发布（双人审批，gray_percentage 校验 56417） |
| GET | `/admin/v1/pse/stats?group_by=grade,subject&strategy=&from=&to=` | 效果统计（单组样本<50 显示「样本不足」，合规 C6） |
| GET | `/admin/v1/pse/decisions?student_id=&session_id=&decision_id=` | 决策追溯（客服/教研排障，明文字段脱敏，全程审计） |
| GET | `/admin/v1/pse/interventions?student_id=&from=&to=` | 干预记录查询 |

---

## 9. 状态机与守卫

### 9.1 引导深度迁移表

| 当前深度 | 事件 | 迁移 | 守卫 |
|---------|------|------|------|
| L0-L3 | 连续正确≥3 / 一次无提示通过 / 主动深问 | +1 | G1：不超过学段 max_guidance_level |
| L1-L4 | 连续错误≥2 | -1 | G2：不低于 0 |
| L0-L4 | 挫败分>0.7 | → 0 | G3：强制，优先级最高 |
| L0-L4 | 参与度<0.3 | → 0 并转互动策略 | G4：与 G3 互斥时取 G3 |
| L0-L4 | 考试模式（G7+） | 上限放宽至 2 | G5：幼儿/小学段考试模式不生效 |

### 9.2 提示链推进状态机（单题内）

```
IDLE → HINT(1) → HINT(2) → HINT(3,max) → REVEAL_REQUEST → [答案管控按 tier 解锁流程处理]
  │        │         │          │
  └────────┴─────────┴──────────┴──→ SOLVED（任意层答对，链终止）
```

- 每层提示下发后记录 `pse:hint:{session}:{question_ref}`；达到 max_hints 仍错 → 触发 `ESCALATE`（升级到 STEP_BY_STEP 或按学段决策），并按 §2.4 规则深度 -1。
- `REVEAL_REQUEST`（用户主动要求看答案）：幼儿/小学 → 拒绝并转引导；初中以上 → 答案管控引擎校验会员权益与频控后解锁 TIER3/4。

### 9.3 挫败干预状态机

```
NONE → DETECTED → INTERVENING → COOLDOWN(15min) → RESOLVED
                    │                              │
                    └── 恶化（连升两级/CRITICAL）──┘ 直接回到 INTERVENING（跳级）
```

| 守卫 | 规则 |
|------|------|
| G6 | DETECTED→INTERVENING 需通过冷却/上限/跨会话三重检查（§5.3） |
| G7 | COOLDOWN 期内仅允许 tone 调整，不产生新 prepend_message |
| G8 | 会话干预计数≥3 后状态锁 RESOLVED，本会话不再升级 |

### 9.4 配置状态机

`DRAFT → PUBLISHED → ARCHIVED`；守卫：G9 同一时刻仅一个 PUBLISHED 版本（发布新版自动归档旧版）；G10 DRAFT 可编辑，PUBLISHED 不可变；G11 发布需双人审批且 gray_percentage∈[1,100]；G12 决策流水必须记录 config_version，保证任意历史决策可复现。

---

## 10. 幂等与并发控制

| 场景 | 机制 |
|------|------|
| decide 重试 | 先查 `pse:dec:{session}:{seq}` 缓存，未命中再查 DB uk(session_id, interaction_seq)，命中即返回原决策（idempotent_replay=true） |
| decide 并发同 seq | DB 唯一键兜底，后写者捕获 1062 → 回读先写决策返回 |
| feedback 重复 | uk_decision_outcome 唯一键，返回 56415 幂等命中 |
| 干预并发 | 冷却/计数为 Redis 原子 INCR+EXPIRE，竞态下最多多发一次干预（可接受，非资金场景） |
| 决策+Outbox | 同事务写入（决策行 + pse_outbox），Relay 异步投递，日终对账（SENT 数 vs 消费方 ack 数） |
| 配置灰度 | 按 student_id 哈希分流，同一学生会话内固定命中同一 config_version（配置快照写入决策行） |

---

## 11. 错误码（56400-56499）

| 错误码 | 含义 | HTTP | 调用方处理 |
|--------|------|------|-----------|
| 56400 | 决策失败（通用） | 500 | 走默认策略（D7/D8） |
| 56401 | 会话不存在或已过期 | 404 | 调用方重建会话 |
| 56402 | interaction_seq 非单调递增 | 409 | 调用方检查本地序号，可能多端并发 |
| 56403 | 必填上下文缺失（student/subject） | 400 | 修参数 |
| 56404 | 学段不在支持清单 | 400 | 修参数 |
| 56405 | intent_type 不在 LearningIntent 清单 | 400 | 与意图识别引擎对齐枚举 |
| 56406 | 策略配置加载失败 | 500 | 走本地配置快照（D6），告警 |
| 56407 | 配置版本不存在 | 404 | 管理端排查 |
| 56408 | 规则引擎执行异常 | 500 | 跳过规则层，仅评分层（降级不拒答） |
| 56409 | 候选策略集为空（约束过滤后无策略可选） | 500 | 返回学段默认策略链首项（D7） |
| 56410 | 评分矩阵缺项（配置错误） | 500 | 该维度按 0.5 中性分，告警 |
| 56411 | 干预冷却冲突（软错误） | 200 | 非 error，data.intervention=null + tone 已调整 |
| 56412 | DIRECT_ANSWER 超出学段/考试频控 | 403 | 改用 fallback_strategy |
| 56413 | outcome 枚举非法 | 400 | 修参数 |
| 56414 | decision_id 不存在 | 404 | 检查回传链路 |
| 56415 | 反馈重复提交（幂等命中） | 200 | 忽略即可 |
| 56416 | 配置发布校验失败（Schema/权重和≠1/引用不存在） | 400 | 管理端修正 |
| 56417 | gray_percentage 非法 | 400 | 管理端修正 |
| 56418 | 决策 QPS 超限（限流） | 429 | 调用方走 D8 兜底默认策略，禁止重试风暴 |
| 56419 | 服务降级中 | 200 | data.degraded=true，决策仍返回 |
| 56420 | 内部依赖超时（画像/状态/记录服务） | 200 | 降级字段已置默认，degraded=true |

> 客户端永远不直接看到 564xx；调用方（AI 编排层）统一转换为既有的对话级错误处理（对齐《服务端统一业务异常码与错误分类体系》）。

---

## 12. 降级矩阵

PSE 是**旁路决策层**：任何降级不得阻断 AI 主链路，只降低决策精细度。

| 编号 | 故障 | 降级行为 | 用户感知 |
|------|------|---------|---------|
| D1 | 学生画像服务不可用 | 中性画像（proficiency=0.5），degraded=true | 讲解粒度中等，无个性化 |
| D2 | 学习状态建模不可用 | frustration=0 / engagement=0.7，干预停用 | 无关怀话术，不影响答题 |
| D3 | 历史表现查询失败 | history_score=0.5 常数 | 策略可能不贴合近期状态 |
| D4 | 效果统计表不可用 | 静态矩阵评分 | 无近期效果加权 |
| D5 | Redis 不可用 | 本地 Caffeine 缓存(5min)；干预计数退化为 DB COUNT 兜底 | 无感 |
| D6 | 配置中心不可用 | 最后一份已发布配置的本地快照 | 无感 |
| D7 | 决策超时（>50ms / 语音>30ms） | 返回学段默认决策（DEFAULT_DECISION） | 讲解风格为学段默认，无个性化 |
| D8 | PSE 整体不可用 | 调用方兜底：Prompt 编排用默认模板 + 答案管控默认 TIER1 起步 | AI 仍可用，交互略生硬 |
| D9 | 语音链路预算耗尽（30ms） | 直接 DEFAULT_DECISION，不阻塞首字延迟 | 无感 |
| D10 | Outbox 投递失败 | 重试 2^n 退避×5 → DEAD + P2 告警 | 无感（统计/通知延迟） |

DEFAULT_DECISION（按学段）：K/G1_G3 → SCAFFOLD + L0 + encouraging；G4_G6 → HINT_CHAIN + L2；G7_G9 → SOCRATIC + L2 + neutral；G10_G12 → HINT_CHAIN + L3 + neutral。

---

## 13. 监控与埋点

| 指标 | 类型 | 告警阈值 |
|------|------|---------|
| pse_decide_latency_p99 | Gauge(Histogram) | >50ms（语音 >30ms）持续 5min，P1 |
| pse_decision_total / pse_fallback_total | Counter | 降级率（degraded+超时）/总数 >10%，P2 |
| pse_direct_answer_ratio{grade} | Gauge | 幼儿/小学 >0（任何一次即 P0 告警）；G7+ >5% P2 |
| pse_intervention_total{level} | Counter | CRITICAL 环比日增 >50%，P2（可能题目难度异常） |
| pse_intervention_improved_ratio | Gauge | 干预后 10min 内 STILL_STUCK 占比 >60%，P2（干预无效，需回检话术/矩阵） |
| pse_strategy_distribution_kl | Gauge | 与 7 日前分布 KL 散度 >0.3，P2（分布漂移，疑似配置/上游变更） |
| pse_feedback_coverage | Gauge | 回报率 <30%，P2（闭环数据不足） |
| pse_effect_stats_job_delay | Gauge | 日聚合 04:00 未完成，P2 |
| pse_outbox_dead_total | Counter | >0，P2 |
| pse_config_publish_total | Counter | 24h 内 >3 次，P3 提示（配置频繁变更） |

埋点（对齐统一埋点平台）：`pse_decision_made`（strategy/guidance/tier/degraded/confidence）、`pse_intervention_triggered`（level/actions）、`pse_hint_reveal`（tier/hints_used）、`pse_direct_answer_granted`（rule_hits/reason）。

---

## 14. 容量估算与数据保留

- 假设 DAU 50 万，人均日 AI 交互 6 次 → 日决策 ~300 万，峰值 QPS ≈ 300万×80% /(4×3600) ≈ 170/s；单实例 2000 QPS 语义（纯内存计算 + 缓存读），3 实例冗余即可，水平扩展无状态。
- 决策流水单行约 400B（特征快照精简后）→ 日增 ~1.2GB；在线 90 天 ≈ 108GB（月分区），归档 ClickHouse 保留 180 天（学情回溯与教研分析用）。
- outcome 180 天、intervention_log 180 天、effect_stats 13 个月；到期清理注册到《存储资源统一生命周期管理引擎》，PSE 不自建清理任务。
- Redis：会话上下文 50 万会话 × 2KB ≈ 1GB + 其余杂项 ≈ 2GB 总量。

---

## 15. 合规红线

| 编号 | 红线 |
|------|------|
| C1 | 幼儿与小学学段（≤G6）任何情况下（含考试模式）不得输出 TIER4 完整答案；考试放宽仅对 G7+ 生效 |
| C2 | DIRECT_ANSWER 每次授予必须携带 rule_hits 与 reason 落库，纳入审计；频控超额一律 56412 拒绝 |
| C3 | 干预话术禁止指责性、比较性（「别人都会」）、焦虑性表述；通知家长仅限中性事实描述且需家长已订阅 |
| C4 | 决策/干预日志属未成年人学习数据：注销时级联删除（对齐账户注销链路）；家长端仅呈现聚合效果，不可见逐条策略日志 |
| C5 | 上下文快照最小化：仅存特征值，不存对话原文/图片/音频引用 |
| C6 | 管理端效果统计单组样本 <50 时显示「样本不足」，禁止下发个体级策略画像 |
| C7 | 语音链路挫败检测仅基于文本与行为信号，不存储、不复听音频 |
| C8 | 配置发布双人审批 + 全量审计（谁/何时/改了什么/灰度比例），PUBLISHED 不可变 |

---

## 16. 契约对齐（与既有文档）

| # | 对方文档 | 契约内容 |
|---|---------|---------|
| 1 | 答案管控与渐进式提示引擎 | `answer_reveal_tier` 0-4 与其 TIER0-4（题目理解/思路提示/关键突破/分步详解/完整答案）语义一一对应；PSE 决定**起始层与可达层**，解锁流程/会员权益校验由管控引擎负责；幼儿/小学请求 TIER4 时管控引擎兜底拒绝 |
| 2 | AI-Prompt编排与场景模板系统 | `prompt_strategy_tags` 采用 `pse.primary/guidance/tone/depth/analogy/subject_seq` 六类选择器标签，需 Prompt 编排 v1.1 注册这些 selector（模板中 `{{pse_primary}}` 等占位） |
| 3 | 学习场景意图识别与智能路由引擎 | `intent_type` 直接复用其 LearningIntent 枚举（homework_help/concept_learn/exam_prep/…），PSE 不做二次意图识别 |
| 4 | 学生学习状态建模与动态评估引擎 | 输入契约：`frustrationIndex`（0-100）÷100 → `student_frustration_score`；CognitiveLevel 四级枚举映射 cognitive_level；engagement 取其 Fatigue 维度反量化 |
| 5 | AI模型上下文管理与对话记忆引擎 | 决策完成后将 (decision_id, primary_strategy, guidance_level) 写入对话上下文；多轮追问时上下文管理注入最近一次决策供 PSE 读取 |
| 6 | 互动练习与即时反馈引擎 / 多题型统一判题引擎 | 判题结果（对/部分对/错 + 用时）由其调用 feedback 接口回报 outcome；`reveal_tier_reached` 来自答案管控的解锁记录 |
| 7 | AI辅导全链路请求处理与编排设计 | PSE 位于意图识别之后、Prompt 组装之前；同步预算 50ms；prepend_messages 由编排器拼接在回复头部 |
| 8 | 语音提问与AI语音交互完整链路 | VoiceDialogOrchestrator 走 gRPC Decide，预算 30ms，超时 D9 直接默认策略，不打断流式首字 |
| 9 | 防沉迷与未成年人保护机制 | `pse.intervention.suggest_break` 与防沉迷休息提醒互斥 15min（防双重打扰）；CRITICAL 建议结束学习与护眼/防沉迷的强制休息链路对齐 |
| 10 | 学情分析与学习报告 | 仅消费 effect_stats 聚合维度（学科×策略×效果），个体决策明细不进学生端报告 |
| 11 | 统一埋点数据治理与事件质量保障引擎 | §13 四个埋点事件按其 Schema 注册，字段命名蛇形，治理侧校验枚举合法性 |
| 12 | 配置中心与动态配置管理 | pse_strategy_config 的发布/灰度/审计走配置中心既有协议；本地快照与配置中心推送一致性对账 |

---

## 17. 验收场景

1. 幼儿段请求直接答案 → 命中规则 no_direct_answer_for_young，强制 SCAFFOLD + L0，TIER≤2。
2. 小学生连错 3 次 → escalate_on_repeated_failure 触发，STEP_BY_STEP + L0 + follow_up=ask。
3. 挫败分 0.75 → 干预 HIGH 档：STEP_BY_STEP + L0 + 正向话术 prepend；深度强制 0。
4. 会话 40 分钟且挫败 0.92（CRITICAL）→ 建议 break/结束话术 + 家长中性通知事件（仅小学且已订阅）。
5. 干预后 8 分钟挫败再报 HIGH → 冷却命中，仅 tone=encouraging，无重复 prepend。
6. 同会话第 4 次干预请求 → 上限拦截，状态锁 RESOLVED。
7. 初中考试模式 → DIRECT_ANSWER 上限 2 次，第 3 次请求 56412，fallback=HINT_CHAIN。
8. 同一 (session, seq) 决策重试 → 返回同一 decision_id，idempotent_replay=true，DB 仅一行。
9. 判题引擎回报 outcome 后再次回报 → 56415 幂等命中，统计不双计。
10. 画像服务宕机演练 → 决策 degraded=true、proficiency=0.5，主链路 200，AI 正常回答。
11. PSE 全停演练 → AI 编排走默认模板 + 答案管控 TIER1 起步，拍题/问答功能不报错。
12. 语音链路压测 30ms 预算 → 首字延迟劣化 <5ms，超时次数占比 <1%。
13. 连续 3 次同策略后 → 第 4 次强制切换次优策略（freshness + 多样性硬约束）。
14. G4 学生决策 → STRATEGY_WEIGHTS 查 G4_G6 键（v1.0 缺键缺陷回归用例，无 KeyError）。
15. 配置发布权重和 0.95 → 56416 校验拒绝；正常发布后旧版自动 ARCHIVED，同学生固定命中新版本。
16. 决策 P99 延迟 5min 窗口 >50ms → P1 告警触发。
17. 词汇学习意图 → ENGLISH VOCABULARY 序列使用 CONTEXT_MAP/MNEMONIC（枚举已补定义，无 AttributeError）。
18. 账户注销 → 30 天内决策/结果/干预日志全部清除，管理端查询不可见。

---

## 18. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-08 初批次 | 初始版本：概念模型/决策引擎三层/学科策略/挫败评估。文件在 §5.2 干预矩阵代码中段截断，API/数据模型/状态机/错误码/降级/监控/合规/验收全缺 |
| v1.1 | 2026-08-18 | 补全烂尾文档：完成 §5.2 干预矩阵（HIGH 补全 + CRITICAL 新增）并新增 §5.3 干预执行器与防重复规则、§6 执行追踪与效果反馈闭环（六类 outcome/效果分/权重自优化护栏/多样性硬约束）、§7 数据模型六表 DDL 与 Redis 九类 Key、§8 API（decide 幂等/feedback/state/gRPC×3/管理端×7）、§9 四套状态机与守卫 G1-G12、§10 幂等并发六机制、§11 错误码 56400-56499 共 21 项、§12 降级矩阵 D1-D10（旁路降级不阻断 AI 主链路）、§13 监控 10 指标+4 埋点、§14 容量估算（DAU50 万/日 300 万决策/PSE 无状态水平扩展）、§15 合规红线 C1-C8、§16 契约对齐 12 项、§17 验收 18 条。修复 v1.0 四处缺陷：SOVRATIC 拼写×2（§3.2.2/§4.1，应为 SOCRATIC）、TeachingStrategy 枚举缺 CONTEXT_MAP/MNEMONIC 定义（§4.3 英语词汇序列引用未定义枚举）、STRATEGY_WEIGHTS 学段键粒度与 AGE_STRATEGY_CONSTRAINTS 不一致（G1_G6 vs G1_G3/G4_G6，运行期 KeyError） |