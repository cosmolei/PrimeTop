# 服务端-AI辅导对话嵌入式即时练习与实时理解度检测引擎-详细设计

## 1. 概述

### 1.1 功能定位

AI辅导对话嵌入式即时练习与实时理解度检测引擎（In-Dialogue Embedded Practice & Real-time Comprehension Detection Engine，简称 IDEPRCDE）是 PrimeTop 教育平台 AI 辅导子系统的核心增强组件。

传统的 AI 辅导对话遵循"学生提问→AI讲解→学生追问"的单向知识传递模式。本引擎在此模式上引入**对话内嵌入式即时练习**（In-Dialogue Embedded Practice，简称 IDEP）机制，使 AI 能在讲解过程中：

1. **动态生成微练习**：根据当前对话上下文，实时生成1-2道针对性检测题
2. **即时评估理解度**：学生对嵌入式练习的作答表现作为理解度的直接证据
3. **自适应调整辅导策略**：基于理解度信号决定继续深入、换种讲法、切换主题或标记掌握
4. **学习行为数据闭环**：嵌入式练习结果回写知识点掌握度系统，消除"听了≠会了"的认知幻觉

**与现有模块的区分：**
| 现有模块 | 定位 | 与本引擎的区别 |
| --- | --- | --- |
| 互动练习与即时反馈引擎 | 独立练习模块中的答题与反馈 | 本引擎练习嵌入在AI对话流中，非独立模块 |
| 练习测评会话服务 | 结构化测评会话管理 | 本引擎的"微测验"是对话内碎片化的，不走完整会话流程 |
| AI辅导对话教育成效评估 | 对话结束后的整体效果评估 | 本引擎是**对话过程中实时检测**，非事后评估 |
| AI辅导对话知识点掌握度更新 | 基于对话内容推断掌握度变化 | 本引擎提供**直接的行为证据**，提升掌握度推断可信度 |
| 题目智能推荐与个性化练习编排 | 独立练习模块的题目推荐 | 本引擎的题目由AI实时生成，不依赖题库检索 |

### 1.2 核心目标

| 目标 | 说明 | 衡量指标 |
| --- | --- | --- |
| 检测精度 | 嵌入式练习结果准确反映学生对当前知识点的理解程度 | 练习正确率与后续正式测评结果的相关系数 ≥ 0.75 |
| 无缝体验 | 练习嵌入对话自然流畅，不产生割裂感 | 学生对话中断率 ≤ 5%，练习完成率 ≥ 90% |
| 低延迟 | 动态题目生成+渲染的端到端延迟可接受 | 题目出现延迟 ≤ 2秒（P95） |
| 策略优化 | 练习触发时机和难度精准匹配学生状态 | 触发后学生"换种讲法"请求率下降 ≥ 15% |
| 数据质量 | 练习结果有效回写掌握度系统 | 掌握度更新置信度提升 ≥ 20% |

### 1.3 适用范围

- **学段**：小学三年级至高中三年级（幼儿及小学低年级因键盘输入能力限制，仅支持语音/选择类练习）
- **学科**：全学科覆盖，理科侧重计算/推导类微练习，文科侧重理解/判断类微练习
- **触发场景**：AI讲解完一个知识点/解题步骤后、学生表示"懂了"后验证、对话持续较长时间后的理解度抽检
- **集成方式**：作为 AI 辅导服务的子组件，通过事件驱动方式与对话编排引擎协作

---

## 2. 系统架构

### 2.1 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AI 辅导对话编排引擎                            │
│                                                                     │
│  ┌─────────────┐  ┌──────────────────────┐  ┌───────────────────┐  │
│  │ 对话上下文   │  │ IDEPRCDE 嵌入式练习   │  │ 回答生成与渲染    │  │
│  │ 管理器      │◄─┤ 引擎 (本模块)        )├─┤ 引擎             │  │
│  └──────┬──────┘  └──────────┬───────────┘  └───────────────────┘  │
│         │                    │                                       │
│         ▼                    ▼                                       │
│  ┌─────────────┐  ┌──────────────────────┐  ┌───────────────────┐  │
│  │ Prompt 编排  │  │ 理解度评估模型        │  │ 掌握度增量更新    │  │
│  │ 引擎        │  │                      │  │ 服务              │  │
│  └─────────────┘  └──────────────────────┘  └───────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件

| 组件 | 职责 | 技术选型 |
| --- | --- | --- |
| 练习触发决策器 (Trigger Decider) | 判断当前对话轮次是否需要插入微练习 | 规则引擎 + 机器学习模型 |
| 题目动态生成器 (Question Generator) | 基于上下文实时生成微练习题 | 大模型 Few-shot + 模板约束 |
| 作答评估器 (Answer Evaluator) | 评估学生对嵌入式练习的作答 | 精确匹配 + 语义相似度 + AI 判定 |
| 理解度计算器 (Comprehension Calculator) | 综合多维度信号计算实时理解度 | 贝叶斯估计模型 |
| 策略推荐器 (Strategy Recommender) | 基于理解度结果推荐后续对话策略 | 决策树 + 优先级队列 |
| 练习历史管理器 (Practice History) | 管理对话内所有嵌入式练习的记录 | Redis + MySQL 持久化 |

### 2.3 与外部系统的交互

```
                    ┌──────────────────┐
                    │  学生画像特征服务  │
                    └────────┬─────────┘
                             │ 学生认知特征
                             ▼
┌──────────┐     ┌──────────────────────┐     ┌──────────────────┐
│ AI辅导   │────►│   IDEPRCDE 引擎      │────►│ 知识追踪模型引擎  │
│ 对话编排  │     │                      │     │ (掌握度更新)     │
│ 引擎     │◄────│                      │◄────│                  │
└──────────┘     └──────────┬───────────┘     └──────────────────┘
                            │
                    ┌───────┴────────┐
                    │                │
                    ▼                ▼
            ┌──────────────┐ ┌──────────────┐
            │ 知识点体系    │ │ 学习行为事件  │
            │ 服务         │ │ 总线         │
            └──────────────┘ └──────────────┘
```

---

## 3. 数据结构定义

### 3.1 核心数据模型

#### 3.1.1 嵌入式练习记录表 `dialogue_embedded_practice`

```sql
CREATE TABLE dialogue_embedded_practice (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    practice_id     VARCHAR(36) NOT NULL COMMENT '练习唯一标识(UUID)',
    conversation_id VARCHAR(36) NOT NULL COMMENT '所属AI对话会话ID',
    turn_id         VARCHAR(36) NOT NULL COMMENT '触发时的对话轮次ID',
    student_id      BIGINT NOT NULL COMMENT '学生用户ID',
    knowledge_point_id BIGINT NOT NULL COMMENT '关联知识点ID',
    subject         VARCHAR(20) NOT NULL COMMENT '学科',
    grade_id        INT NOT NULL COMMENT '学生年级',

    -- 练习内容
    question_type   VARCHAR(20) NOT NULL COMMENT '题型: CHOICE/FILL/SHORT_ANSWER/JUDGE/CALCULATE',
    question_content JSON NOT NULL COMMENT '题目内容(结构化JSON)',
    correct_answer  JSON NOT NULL COMMENT '正确答案',
    answer_analysis TEXT COMMENT '答案解析',
    difficulty_level DECIMAL(3,2) DEFAULT 0.50 COMMENT '难度系数0-1',

    -- 触发上下文
    trigger_reason  VARCHAR(30) NOT NULL COMMENT '触发原因: POST_EXPLANATION/CLAIM_UNDERSTOOD/PERIODIC_CHECK/TOPIC_TRANSITION',
    trigger_context JSON COMMENT '触发时上下文快照',

    -- 作答信息
    student_answer  JSON NULL COMMENT '学生作答内容',
    answer_status   VARCHAR(15) NULL COMMENT '作答状态: PENDING/CORRECT/PARTIAL/INCORRECT/SKIPPED/TIMEOUT',
    answer_time_ms  INT NULL COMMENT '作答耗时(毫秒)',
    answered_at     DATETIME(3) NULL COMMENT '作答时间',

    -- 理解度评估
    comprehension_score DECIMAL(4,3) NULL COMMENT '本次练习理解度得分0-1',
    confidence_level    DECIMAL(4,3) NULL COMMENT '评估置信度0-1',

    -- 后续策略
    recommended_strategy VARCHAR(30) NULL COMMENT '推荐后续策略',
    strategy_executed    BOOLEAN DEFAULT FALSE COMMENT '策略是否被执行',

    -- 元数据
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX idx_conversation (conversation_id),
    INDEX idx_student_kp (student_id, knowledge_point_id),
    INDEX idx_turn (turn_id),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI对话嵌入式即时练习记录';
```

#### 3.1.2 理解度评估历史表 `dialogue_comprehension_log`

```sql
CREATE TABLE dialogue_comprehension_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    conversation_id VARCHAR(36) NOT NULL COMMENT '对话会话ID',
    student_id      BIGINT NOT NULL,
    knowledge_point_id BIGINT NOT NULL,
    comprehension_score DECIMAL(4,3) NOT NULL COMMENT '理解度得分0-1',
    score_source    VARCHAR(20) NOT NULL COMMENT '来源: EMBEDDED_PRACTICE/DIALOGUE_SIGNAL/BEHAVIORAL_CUE/COMBINED',
    evidence_count  INT NOT NULL DEFAULT 1 COMMENT '支撑证据数量',
    confidence      DECIMAL(4,3) NOT NULL COMMENT '置信度0-1',
    evidence_detail JSON COMMENT '证据明细',
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX idx_conversation_kp (conversation_id, knowledge_point_id),
    INDEX idx_student_kp_time (student_id, knowledge_point_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='对话理解度评估历史';
```

#### 3.1.3 练习触发规则配置表 `embedded_practice_rules`

```sql
CREATE TABLE embedded_practice_rules (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    rule_name       VARCHAR(100) NOT NULL COMMENT '规则名称',
    rule_code       VARCHAR(50) NOT NULL UNIQUE COMMENT '规则编码',
    rule_type       VARCHAR(30) NOT NULL COMMENT 'TRIGGER_CONDITION/QUESTION_GENERATION/STRATEGY_SELECTION',
    priority        INT NOT NULL DEFAULT 100 COMMENT '优先级(越小越高)',
    condition_expr  TEXT NOT NULL COMMENT '条件表达式(DSL)',
    action_config   JSON NOT NULL COMMENT '执行动作配置',
    enabled         BOOLEAN DEFAULT TRUE,
    effective_grade_range VARCHAR(20) COMMENT '适用年级范围, 如: 3-12',
    effective_subjects VARCHAR(200) COMMENT '适用学科, 逗号分隔',
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='嵌入式练习触发规则配置';
```

### 3.2 核心数据结构 (Java/TypeScript 表达)

#### 3.2.1 嵌入式练习请求

```typescript
interface EmbeddedPracticeTrigger {
    conversationId: string;          // 对话会话ID
    turnId: string;                  // 当前轮次ID
    studentId: number;               // 学生ID
    knowledgePointId: number;        // 当前讨论的知识点ID
    subject: Subject;                // 学科
    gradeId: number;                 // 年级
    triggerReason: TriggerReason;    // 触发原因
    dialogueContext: DialogueContext; // 对话上下文快照
    studentProfile: StudentCognitiveProfile; // 学生认知特征
}

enum TriggerReason {
    POST_EXPLANATION = 'POST_EXPLANATION',      // 讲解完成后
    CLAIM_UNDERSTOOD = 'CLAIM_UNDERSTOOD',       // 学生声称"懂了"
    PERIODIC_CHECK = 'PERIODIC_CHECK',           // 定期检测
    TOPIC_TRANSITION = 'TOPIC_TRANSITION',       // 话题转换前
    ERROR_CORRECTION = 'ERROR_CORRECTION',       // AI纠正错误后
    DEEP_DIVE_COMPLETE = 'DEEP_DIVE_COMPLETE'    // 深入讲解完成
}
```

#### 3.2.2 动态生成的练习

```typescript
interface EmbeddedQuestion {
    practiceId: string;              // 练习唯一ID
    questionType: EmbeddedQuestionType;
    content: EmbeddedQuestionContent;
    metadata: {
        estimatedDifficulty: number; // 预估难度 0-1
        estimatedTimeSec: number;    // 预估作答时间(秒)
        knowledgePointIds: number[]; // 考查知识点
        cognitiveLevel: CognitiveLevel; // 认知层级
        sourceType: 'AI_GENERATED' | 'BANK_RETRIEVED' | 'TEMPLATE_BASED';
    };
    renderHint: RenderHint;          // 客户端渲染提示
}

enum EmbeddedQuestionType {
    MULTIPLE_CHOICE = 'MULTIPLE_CHOICE',     // 选择题
    FILL_IN_BLANK = 'FILL_IN_BLANK',         // 填空题
    TRUE_FALSE = 'TRUE_FALSE',               // 判断题
    SHORT_ANSWER = 'SHORT_ANSWER',           // 简答题
    CALCULATE = 'CALCULATE',                 // 计算题
    SORT_ORDER = 'SORT_ORDER',               // 排序题
    SELECT_ALL = 'SELECT_ALL'                // 多选题
}

enum CognitiveLevel {
    REMEMBER = 'REMEMBER',       // 记忆
    UNDERSTAND = 'UNDERSTAND',   // 理解
    APPLY = 'APPLY',             // 应用
    ANALYZE = 'ANALYZE',         // 分析
    EVALUATE = 'EVALUATE',       // 评价
    CREATE = 'CREATE'            // 创造
}

interface EmbeddedQuestionContent {
    stem: string;                    // 题干(支持Markdown + LaTeX)
    stemImageUrl?: string;           // 题干配图URL
    options?: QuestionOption[];      // 选项(选择题)
    blanks?: BlankInfo[];            // 填空信息(填空题)
    hint?: string;                   // 提示语
    renderType: 'CARD' | 'INLINE' | 'POPOVER'; // 渲染形态
}

interface RenderHint {
    uiComponent: 'choice_card' | 'fill_blank_inline' | 'judge_toggle'
                | 'text_input' | 'formula_input' | 'sort_list';
    layout: 'INLINE' | 'CARD' | 'BOTTOM_SHEET';
    animationType: 'SLIDE_UP' | 'FADE_IN' | 'EXPAND';
    dismissible: boolean;            // 学生是否可跳过
    showSkipButton: boolean;
    skipButtonText: string;
}
```

#### 3.2.3 作答评估结果

```typescript
interface PracticeEvaluation {
    practiceId: string;
    studentAnswer: StudentAnswer;
    status: AnswerStatus;
    correctnessScore: number;        // 正确性得分 0-1
    partialCreditDetails?: PartialCreditDetail[];
    misconceptionDetected?: MisconceptionInfo;
    responseTimeMs: number;
    understandingScore: number;      // 理解度得分 0-1
    confidence: number;              // 评估置信度 0-1
    feedbackMessage: string;         // 给学生的反馈消息
    recommendedNextAction: NextAction;
}

enum AnswerStatus {
    CORRECT = 'CORRECT',
    PARTIAL = 'PARTIAL',
    INCORRECT = 'INCORRECT',
    SKIPPED = 'SKIPPED',
    TIMEOUT = 'TIMEOUT'
}

interface NextAction {
    type: NextActionType;
    reason: string;
    payload?: Record<string, unknown>;
}

enum NextActionType {
    CONTINUE_CURRENT_TOPIC = 'CONTINUE_CURRENT_TOPIC',   // 继续当前话题
    RE_EXPLAIN_DIFFERENTLY = 'RE_EXPLAIN_DIFFERENTLY',   // 换种方式重新讲解
    PROVIDE_SIMPLER_EXAMPLE = 'PROVIDE_SIMPLER_EXAMPLE', // 提供更简单示例
    MOVE_TO_NEXT_TOPIC = 'MOVE_TO_NEXT_TOPIC',           // 进入下一话题
    GENERATE_HARDER_QUESTION = 'GENERATE_HARDER_QUESTION', // 生成更难题目
    FLAG_FOR_REVIEW = 'FLAG_FOR_REVIEW',                  // 标记需复习
    SUGGEST_OFFLINE_PRACTICE = 'SUGGEST_OFFLINE_PRACTICE', // 建议课后练习
    ESCALATE_TO_TEACHER = 'ESCALATE_TO_TEACHER'           // 升级给教师
}
```

---

## 4. 核心算法设计

### 4.1 练习触发决策算法

练习触发决策器使用**多信号融合 + 规则约束**的方式判断是否在当前对话轮次插入微练习。

#### 4.1.1 触发信号权重模型

```python
class TriggerDecider:
    """
    嵌入式练习触发决策器
    基于 LRU (Linear Regression Utility) 模型计算触发分数
    """

    SIGNAL_WEIGHTS = {
        'explanation_length': 0.20,      # 讲解长度信号
        'concept_complexity': 0.15,      # 概念复杂度信号
        'student_claim_understanding': 0.25, # 学生声称理解
        'turns_since_last_practice': 0.15,   # 距上次练习轮次数
        'knowledge_point_importance': 0.10,  # 知识点重要性
        'student_overconfidence_risk': 0.10, # 学生过度自信风险
        'topic_transition_imminent': 0.05,  # 即将切换话题
    }

    TRIGGER_THRESHOLD = 0.65  # 触发阈值

    def decide(self, context: DialogueContext, profile: StudentProfile) -> TriggerDecision:
        """
        决策流程:
        1. 检查冷却期 → 冷却期内不触发
        2. 检查硬约束（最大练习次数、学生疲劳度等）
        3. 计算各信号分数
        4. 加权融合得到触发分数
        5. 与阈值比较，输出决策
        """
        # Step 1: 冷却期检查
        if self._in_cooldown(context):
            return TriggerDecision(should_trigger=False, reason='IN_COOLDOWN')

        # Step 2: 硬约束检查
        if not self._check_hard_constraints(context, profile):
            return TriggerDecision(should_trigger=False, reason='CONSTRAINT_VIOLATED')

        # Step 3: 计算信号分数
        signals = {
            'explanation_length': self._eval_explanation_length(context),
            'concept_complexity': self._eval_concept_complexity(context),
            'student_claim_understanding': self._eval_claim_understanding(context),
            'turns_since_last_practice': self._eval_turns_gap(context),
            'knowledge_point_importance': self._eval_kp_importance(context),
            'student_overconfidence_risk': self._eval_overconfidence(context, profile),
            'topic_transition_imminent': self._eval_topic_transition(context),
        }

        # Step 4: 加权融合
        trigger_score = sum(
            self.SIGNAL_WEIGHTS[k] * v for k, v in signals.items()
        )

        # Step 5: 输出决策
        should_trigger = trigger_score >= self.TRIGGER_THRESHOLD

        return TriggerDecision(
            should_trigger=should_trigger,
            score=trigger_score,
            signals=signals,
            trigger_reason=self._determine_trigger_reason(signals),
            cooldown_seconds=self._calculate_cooldown(profile)
        )

    def _eval_explanation_length(self, context: DialogueContext) -> float:
        """讲解长度信号: 讲解越长，越需要检测理解"""
        word_count = context.current_response_word_count
        if word_count < 50:
            return 0.2
        elif word_count < 150:
            return 0.5
        elif word_count < 300:
            return 0.8
        else:
            return 1.0

    def _eval_claim_understanding(self, context: DialogueContext) -> float:
        """学生声称理解信号: 学生说"懂了/明白了"时高触发"""
        if context.student_signals.get('claims_understanding'):
            return 1.0
        return 0.0

    def _eval_overconfidence(self, context: DialogueContext, profile: StudentProfile) -> float:
        """
        过度自信风险: 根据学生历史"声称理解→实际错误"比率评估
        高过度自信学生应更频繁触发练习验证
        """
        overconfidence_ratio = profile.historical_overconfidence_ratio  # 0-1
        return min(1.0, overconfidence_ratio * 1.5)

    def _eval_turns_gap(self, context: DialogueContext) -> float:
        """距上次练习轮次: 越久没检测越需要检测"""
        gap = context.turns_since_last_practice
        if gap <= 1:
            return 0.0
        elif gap <= 3:
            return 0.3
        elif gap <= 6:
            return 0.6
        elif gap <= 10:
            return 0.85
        else:
            return 1.0
```

#### 4.1.2 触发约束条件

| 约束 | 规则 | 说明 |
| --- | --- | --- |
| 单次对话最大练习数 | ≤ 5 次 | 避免对话变成考试 |
| 连续触发冷却 | ≥ 2 轮 | 两次练习间至少间隔2个对话轮次 |
| 学生疲劳度 | 疲劳指数 < 0.7 | 通过滑动窗口检测学生近5轮的疲劳信号 |
| 学段限制 | grade ≥ 3 | 小学三年级以下不触发（改用语音问答形式） |
| 情绪检测 | 情绪 ≠ FRUSTRATED | 学生明显沮丧时暂停触发 |
| 上次结果 | 上次练习 ≠ TIMEOUT/SKIPPED | 上次跳过或超时，本次降低触发概率 |

### 4.2 题目动态生成算法

#### 4.2.1 基于对话上下文的题目生成策略

```python
class EmbeddedQuestionGenerator:
    """
    嵌入式练习题目动态生成器
    采用"模板约束 + 大模型生成 + 安全校验"三阶段管线
    """

    def generate(
        self,
        context: DialogueContext,
        knowledge_point: KnowledgePoint,
        student_profile: StudentProfile,
        trigger: TriggerDecision
    ) -> EmbeddedQuestion:
        """
        生成流程:
        1. 确定题型和认知层级
        2. 选择生成策略 (AI生成/模板/题库检索)
        3. 构建生成Prompt
        4. 调用大模型生成
        5. 安全校验与质量控制
        6. 包装为客户端可渲染的结构
        """

        # Step 1: 确定题型和认知层级
        question_spec = self._determine_question_spec(
            knowledge_point, student_profile, trigger
        )

        # Step 2: 选择生成策略
        strategy = self._select_generation_strategy(question_spec, knowledge_point)

        # Step 3: 执行生成
        if strategy == 'AI_GENERATED':
            question = self._generate_via_llm(context, question_spec, student_profile)
        elif strategy == 'TEMPLATE_BASED':
            question = self._generate_via_template(context, question_spec, knowledge_point)
        elif strategy == 'BANK_RETRIEVED':
            question = self._retrieve_from_bank(knowledge_point, question_spec)
        else:
            question = self._generate_via_llm(context, question_spec, student_profile)

        # Step 4: 质量校验
        question = self._quality_check(question, knowledge_point)

        return question

    def _determine_question_spec(
        self,
        kp: KnowledgePoint,
        profile: StudentProfile,
        trigger: TriggerDecision
    ) -> QuestionSpec:
        """
        根据知识点类型和学生特征确定题型
        """
        spec = QuestionSpec()

        # 难度设定: 基于学生当前掌握度 + 最近发展区
        current_mastery = profile.get_mastery(kp.id)  # 0-1
        # 目标难度 = 当前掌握度 + 0.15 (略高于当前水平)
        spec.target_difficulty = min(0.95, current_mastery + 0.15)

        # 题型选择: 根据知识点类型
        if kp.kp_type == 'CONCEPT':
            spec.question_type = EmbeddedQuestionType.MULTIPLE_CHOICE
            spec.cognitive_level = CognitiveLevel.UNDERSTAND
        elif kp.kp_type == 'FORMULA':
            spec.question_type = EmbeddedQuestionType.CALCULATE
            spec.cognitive_level = CognitiveLevel.APPLY
        elif kp.kp_type == 'PROCESS':
            spec.question_type = EmbeddedQuestionType.SORT_ORDER
            spec.cognitive_level = CognitiveLevel.UNDERSTAND
        elif kp.kp_type == 'JUDGMENT':
            spec.question_type = EmbeddedQuestionType.TRUE_FALSE
            spec.cognitive_level = CognitiveLevel.ANALYZE
        else:
            spec.question_type = EmbeddedQuestionType.FILL_IN_BLANK
            spec.cognitive_level = CognitiveLevel.UNDERSTAND

        # 触发原因覆盖
        if trigger.trigger_reason == 'CLAIM_UNDERSTOOD':
            # 学生声称理解时，用稍高难度验证
            spec.target_difficulty = min(0.95, spec.target_difficulty + 0.1)
            spec.cognitive_level = CognitiveLevel.APPLY

        return spec

    def _generate_via_llm(
        self,
        context: DialogueContext,
        spec: QuestionSpec,
        profile: StudentProfile
    ) -> EmbeddedQuestion:
        """
        使用大模型生成练习题
        采用约束Prompt确保生成质量
        """
        prompt = self._build_generation_prompt(context, spec, profile)

        # 使用快速模型生成 (优先低延迟模型)
        response = await self.llm_client.generate(
            model=self.FAST_MODEL_ID,  # 如 GPT-4o-mini / Claude Haiku
            messages=prompt,
            temperature=0.7,
            max_tokens=500,
            response_format={'type': 'json_object'}
        )

        raw_question = json.loads(response.content)

        return self._wrap_as_embedded_question(raw_question, spec)

    def _build_generation_prompt(
        self,
        context: DialogueContext,
        spec: QuestionSpec,
        profile: StudentProfile
    ) -> list[dict]:
        """
        构建题目生成Prompt
        关键约束:
        1. 题目必须与当前讨论的知识点直接相关
        2. 题目难度匹配学生当前水平
        3. 题目简洁，适合在对话流中展示
        4. 避免需要复杂输入(公式/图形)
        5. 答案明确，无歧义
        """
        system_prompt = f"""你是一位{profile.grade_name}{profile.subject_name}教师。
你需要根据AI辅导对话的上下文，快速生成一道嵌入式检测练习。

## 题目要求
- 题型: {spec.question_type.value}
- 认知层级: {spec.cognitive_level.value}
- 目标难度: {spec.target_difficulty:.2f} (0=最易, 1=最难)
- 估计作答时间: ≤60秒
- 题干字数: ≤100字
- 选项数: 4个(A/B/C/D)
- 仅考查当前正在讨论的知识点，不跨知识点
- 避免需要输入复杂数学公式或图形的题目

## 输出格式
严格输出以下JSON格式:
```json
{{
  "stem": "题干内容(支持LaTeX: $...$)",
  "options": ["选项A", "选项B", "选项C", "选项D"],
  "correct_answer": "正确选项字母",
  "explanation": "简短解析(≤50字)",
  "difficulty_estimate": 0.0到1.0,
  "misconception_traps": ["常见错误理解1", "常见错误理解2"]
}}
```
"""

        user_prompt = f"""## 当前对话上下文
学生年级: {profile.grade_name}
学科: {profile.subject_name}
正在讲解的知识点: {context.current_knowledge_point_name}
知识点描述: {context.current_kp_description}

## AI最近讲解内容摘要
{context.recent_explanation_summary}

## 对话历史(最近3轮)
{self._format_dialogue_history(context.recent_turns)}

请根据以上上下文，生成一道检测学生理解程度的练习题。
"""

        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
```

#### 4.2.2 题目质量控制管线

```python
class QuestionQualityPipeline:
    """
    生成的题目必须通过以下质量校验:
    """

    def validate(self, question: EmbeddedQuestion, kp: KnowledgePoint) -> ValidationResult:
        checks = [
            self._check_answer_correctness,    # 答案正确性校验
            self._check_knowledge_alignment,    # 知识点对齐校验
            self._check_difficulty_alignment,   # 难度匹配校验
            self._check_content_safety,         # 内容安全校验
            self._check_no_ambiguity,           # 无歧义性校验
            self._check_language_appropriateness,# 适龄语言校验
        ]

        for check in checks:
            result = check(question, kp)
            if not result.passed:
                return result  # 快速失败

        return ValidationResult(passed=True)

    async def _check_answer_correctness(
        self, question: EmbeddedQuestion, kp: KnowledgePoint
    ) -> ValidationResult:
        """
        使用第二个大模型独立验算答案正确性
        双模型交叉校验
        """
        verification_prompt = self._build_verification_prompt(question, kp)
        result = await self.llm_client.generate(
            model=self.VERIFICATION_MODEL_ID,
            messages=verification_prompt,
            temperature=0.0  # 确定性输出
        )

        verification = json.loads(result.content)
        if not verification['is_correct']:
            return ValidationResult(
                passed=False,
                reason='ANSWER_INCORRECT',
                detail=verification['explanation']
            )

        return ValidationResult(passed=True)
```

### 4.3 实时理解度评估算法

#### 4.3.1 贝叶斯理解度估计模型

```python
class ComprehensionCalculator:
    """
    实时理解度计算器
    使用贝叶斯更新模型，将嵌入式练习结果与对话行为信号融合
    """

    def calculate(
        self,
        practice_result: PracticeEvaluation,
        dialogue_signals: list[DialogueSignal],
        prior_mastery: float,
        student_profile: StudentProfile
    ) -> ComprehensionAssessment:
        """
        贝叶斯理解度估计

        P(understands | evidence) = P(evidence | understands) * P(understands)
                                     / P(evidence)

        简化为 Beta 分布共轭先验更新:
        - 先验: Beta(α, β)，其中 α/(α+β) = prior_mastery
        - 练习正确: α += w_practice
        - 练习错误: β += w_practice
        - 对话信号: 根据