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
        forbidden_strategies=[TeachingStrategy.DIRECT_ANSWER, TeachingStrategy.SOVRATIC,
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
    GradeLevel.K: StrategyWeights(scene=0.5, history=0.1, freshness=0.2, efficiency=0.2),
    GradeLevel.G1_G6: StrategyWeights(scene=0.4, history=0.2, freshness=0.2, efficiency=0.2),
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
            TeachingStrategy.SOVRATIC,           # 提问引导审题
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
                    prepend_message="要不我们先休息一下，稍后再回来