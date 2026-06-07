# 服务端 - AI 回答适龄化处理与学段表达适配引擎 详细设计

> 版本：v1.0 | 日期：2026-06-08 | 模块归属：AI 能力层 / 回答后处理管线

## 1. 概述

### 1.1 功能定位

本引擎负责对 AI 模型原始输出进行**学段感知的适龄化处理**，确保最终呈现给学生的内容在语言复杂度、讲解深度、示例选择、表达风格等方面与其认知水平匹配。它是 AI 回答后处理管线中的关键环节，位于安全审核之后、格式化渲染之前。

### 1.2 背景与问题

| 问题 | 表现 | 影响 |
|------|------|------|
| 语言过于学术化 | 对小学三年级学生使用"加速度是速度变化率" | 学生看不懂，降低学习信心 |
| 讲解深度错配 | 对高中生用"苹果掉下来"解释重力 | 浪费时间，无法提升 |
| 示例脱离生活经验 | 对幼儿用"微积分"做类比 | 完全无法理解 |
| 情感表达不当 | 对所有年龄段使用同一鼓励语 | 幼儿觉得冷冰冰，高中生觉得幼稚 |
| 知识前置假设错误 | 讲三角形面积时默认学生已学勾股定理 | 前置知识缺失导致理解断层 |

### 1.3 核心目标

1. 根据学生学段（幼儿/小学/初中/高中）自动识别回答中的适龄性问题
2. 对不合适的表达进行自动改写或标记提示
3. 提供可量化的"表达难度评分"，支持后续质量追踪
4. 将适龄化规则配置化，教研团队可持续调优

### 1.4 在整体架构中的位置

```
AI 模型输出
    ↓
安全审核引擎（AI输入安全与教育对话护栏）
    ↓
事实校验引擎（AI幻觉检测与教育事实校验）
    ↓
┌──────────────────────────────────────┐
│  ★ 本引擎：适龄化处理与表达适配 ★     │
│  - 表达难度评估                       │
│  - 学段适配改写                       │
│  - 示例与类比替换                     │
│  - 情感语调调节                       │
│  - 前置知识检测                       │
└──────────────────────────────────────┘
    ↓
格式化渲染引擎（富文本与学科内容渲染）
    ↓
客户端展示
```

## 2. 学段表达标准体系

### 2.1 学段分级定义

```python
class AgeGroup(Enum):
    """学段枚举，对应不同的表达适配策略"""
    PRESCHOOL = "preschool"       # 幼儿启蒙（3-6岁）
    PRIMARY_LOW = "primary_low"   # 小学低年级（1-3年级）
    PRIMARY_HIGH = "primary_high" # 小学高年级（4-6年级）
    JUNIOR = "junior"             # 初中（7-9年级）
    SENIOR = "senior"             # 高中（10-12年级）
```

### 2.2 各学段表达标准

| 维度 | 幼儿启蒙 | 小学低年级 | 小学高年级 | 初中 | 高中 |
|------|----------|-----------|-----------|------|------|
| **句子长度** | ≤8字/句 | ≤15字/句 | ≤25字/句 | ≤40字/句 | 不限 |
| **用词等级** | 日常口语 | 常用词汇 | 课本词汇 | 学科术语+解释 | 学科术语 |
| **抽象程度** | 纯具象 | 具象为主 | 简单抽象 | 抽象+具象结合 | 抽象推理 |
| **类比来源** | 动物/食物/玩具 | 校园/家庭/游戏 | 生活常识 | 社会现象/科技 | 跨学科类比 |
| **数学表达** | 无符号 | 简单数字运算 | 四则运算+分数 | 代数式/方程 | 函数/推导 |
| **鼓励风格** | 🌟 频繁emoji + 夸奖 | 星星/奖章 + 鼓励 | 肯定 + 方法建议 | 客观反馈 | 专业点评 |
| **步骤粒度** | 每步1个动作 | 每步1个简单操作 | 每步1个知识点 | 每步可含2-3个子步骤 | 每步可含完整推导链 |

### 2.3 表达难度评分模型

使用 0-100 分量化文本难度：

```python
@dataclass
class ExpressionDifficulty:
    """表达难度评分"""
    overall_score: float         # 综合难度 0-100
    vocabulary_score: float      # 词汇难度
    sentence_score: float        # 句式复杂度
    concept_score: float         # 概念抽象度
    reasoning_score: float       # 推理链长度
    prerequisite_score: float    # 前置知识要求
    
    # 各学段目标难度范围
    TARGET_RANGES = {
        AgeGroup.PRESCHOOL:    (10, 25),
        AgeGroup.PRIMARY_LOW:  (20, 40),
        AgeGroup.PRIMARY_HIGH: (35, 55),
        AgeGroup.JUNIOR:       (50, 70),
        AgeGroup.SENIOR:       (60, 85),
    }
    
    def is_within_target(self, age_group: AgeGroup) -> bool:
        lo, hi = self.TARGET_RANGES[age_group]
        return lo <= self.overall_score <= hi
    
    def difficulty_gap(self, age_group: AgeGroup) -> float:
        """返回与目标范围的偏差，正数表示偏难，负数表示偏易"""
        lo, hi = self.TARGET_RANGES[age_group]
        if self.overall_score < lo:
            return self.overall_score - lo  # 偏易（负数）
        elif self.overall_score > hi:
            return self.overall_score - hi  # 偏难（正数）
        return 0.0
```

## 3. 数据结构设计

### 3.1 核心数据表

#### 3.1.1 适龄化规则配置表 `age_adaptation_rules`

```sql
CREATE TABLE age_adaptation_rules (
    id                  BIGSERIAL PRIMARY KEY,
    rule_code           VARCHAR(64) NOT NULL UNIQUE,   -- 规则编码，如 "vocab_replacement_preset"
    rule_name           VARCHAR(128) NOT NULL,          -- 规则名称
    rule_type           VARCHAR(32) NOT NULL,           -- 规则类型：vocabulary|sentence|analogy|emotion|prerequisite
    age_group           VARCHAR(32) NOT NULL,           -- 学段
    subject             VARCHAR(32),                    -- 学科（null 表示通用）
    priority            INT NOT NULL DEFAULT 100,       -- 优先级，越小越先执行
    is_enabled          BOOLEAN NOT NULL DEFAULT true,
    config_json         JSONB NOT NULL,                 -- 规则配置（结构因 rule_type 而异）
    description         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by          VARCHAR(64),
    
    CONSTRAINT uk_rule_code UNIQUE (rule_code)
);

-- 索引
CREATE INDEX idx_adapt_rules_type_age ON age_adaptation_rules(rule_type, age_group);
CREATE INDEX idx_adapt_rules_subject ON age_adaptation_rules(subject) WHERE subject IS NOT NULL;
```

**config_json 示例（词汇替换规则）：**

```json
{
    "replacements": [
        {
            "pattern": "加速度",
            "age_groups_needing_replacement": ["preschool", "primary_low"],
            "replacements": {
                "preschool": "速度变得更快或者更慢",
                "primary_low": "速度变化得多快"
            }
        },
        {
            "pattern": "光合作用",
            "age_groups_needing_replacement": ["preschool", "primary_low", "primary_high"],
            "replacements": {
                "preschool": "植物吃阳光长大",
                "primary_low": "植物用阳光做食物",
                "primary_high": "植物用阳光、水和空气制造养分"
            }
        }
    ]
}
```

**config_json 示例（情感语调规则）：**

```json
{
    "emotion_profiles": {
        "preschool": {
            "praise_frequency": "every_step",
            "praise_templates": ["太棒了！🌟", "你真聪明！⭐", "哇，好厉害！🎉"],
            "encouragement_on_error": "没关系，我们再试一次！💪",
            "emoji_density": "high"
        },
        "primary_low": {
            "praise_frequency": "on_completion",
            "praise_templates": ["做得好！", "答对了！👍", "真厉害！"],
            "encouragement_on_error": "差一点点就对了，再想想看！",
            "emoji_density": "medium"
        },
        "senior": {
            "praise_frequency": "on_insight",
            "praise_templates": ["思路正确", "这个解法很好", "分析到位"],
            "encouragement_on_error": "这个方向可以考虑另一种思路",
            "emoji_density": "minimal"
        }
    }
}
```

#### 3.1.2 词汇难度词典表 `vocabulary_difficulty`

```sql
CREATE TABLE vocabulary_difficulty (
    id                  BIGSERIAL PRIMARY KEY,
    word                VARCHAR(128) NOT NULL,          -- 词汇
    subject             VARCHAR(32),                    -- 学科
    difficulty_level    INT NOT NULL,                   -- 难度等级 1-10
    min_age_group       VARCHAR(32) NOT NULL,           -- 最低适用学段
    explanation         TEXT,                           -- 简明释义
    alternatives        JSONB,                          -- 各学段替代表述 {"preschool": "...", "primary_low": "..."}
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT uk_word_subject UNIQUE (word, subject)
);

CREATE INDEX idx_vocab_difficulty ON vocabulary_difficulty(difficulty_level, min_age_group);
```

#### 3.1.3 适龄化处理日志表 `age_adaptation_logs`

```sql
CREATE TABLE age_adaptation_logs (
    id                  BIGSERIAL PRIMARY KEY,
    conversation_id     VARCHAR(64) NOT NULL,           -- AI对话ID
    message_id          VARCHAR(64) NOT NULL,           -- 消息ID
    student_id          BIGINT NOT NULL,
    age_group           VARCHAR(32) NOT NULL,
    
    original_text       TEXT NOT NULL,                  -- 原始AI输出
    original_difficulty JSONB,                          -- 原始难度评分
    adapted_text        TEXT NOT NULL,                  -- 适龄化后文本
    adapted_difficulty  JSONB,                          -- 适配后难度评分
    
    rules_applied       JSONB,                          -- 应用的规则列表 [{"rule_code": "...", "changes": [...]}]
    adaptation_count    INT NOT NULL DEFAULT 0,         -- 改写次数
    
    processing_time_ms  INT,                            -- 处理耗时
    quality_flag        VARCHAR(16),                    -- ok|too_simple|too_hard|skip
    
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_adapt_logs_student ON age_adaptation_logs(student_id, created_at DESC);
CREATE INDEX idx_adapt_logs_quality ON age_adaptation_logs(quality_flag) WHERE quality_flag != 'ok';
```

### 3.2 Redis 缓存结构

```
# 适龄化规则缓存（按学段+学科分组）
age_rules:{age_group}:{subject}  -> JSON  TTL=300s

# 词汇难度缓存
vocab_difficulty:{word_hash}     -> JSON  TTL=3600s

# 学生学段信息缓存
student_age_group:{student_id}   -> STRING  TTL=1800s

# 近期处理统计（用于教研分析）
adapt_stats:daily:{date}         -> HASH {age_group -> count, avg_original_score, avg_adapted_score}
```

## 4. API 接口设计

### 4.1 内部服务接口（服务间调用）

#### 4.1.1 适龄化处理接口

```
POST /internal/v1/age-adaptation/process
```

**请求体：**

```json
{
    "text": "力是物体对物体的作用，力的三要素是大小、方向和作用点。根据牛顿第二定律F=ma，加速度与力成正比...",
    "student_id": 12345,
    "age_group": "primary_low",
    "subject": "physics",
    "context": {
        "chapter": "力与运动",
        "knowledge_points": ["力的概念", "牛顿第二定律"],
        "conversation_turn": 3,
        "intent": "concept_explanation"
    },
    "options": {
        "max_rewrite_rounds": 2,
        "difficulty_tolerance": 5,
        "enable_analogy_replacement": true,
        "enable_emotion_adjustment": true,
        "enable_prerequisite_check": true
    }
}
```

**响应体：**

```json
{
    "adapted_text": "力就是一个东西推或者拉另一个东西。力有三个重要的地方：力气有多大、往哪个方向推、推在哪个位置。就像你推门的时候，用力大一点门就开得快一点！💪",
    "original_difficulty": {
        "overall_score": 72,
        "vocabulary_score": 75,
        "sentence_score": 68,
        "concept_score": 80,
        "reasoning_score": 60,
        "prerequisite_score": 65
    },
    "adapted_difficulty": {
        "overall_score": 32,
        "vocabulary_score": 28,
        "sentence_score": 30,
        "concept_score": 35,
        "reasoning_score": 25,
        "prerequisite_score": 40
    },
    "target_range": [20, 40],
    "changes_applied": [
        {
            "type": "vocabulary_replacement",
            "original": "力是物体对物体的作用",
            "adapted": "力就是一个东西推或者拉另一个东西",
            "rule_code": "vocab_physics_force"
        },
        {
            "type": "analogy_addition",
            "original": "加速度与力成正比",
            "adapted": "就像你推门的时候，用力大一点门就开得快一点！",
            "rule_code": "analogy_force_primary"
        },
        {
            "type": "content_removal",
            "original": "根据牛顿第二定律F=ma",
            "reason": "formula_too_advanced",
            "rule_code": "prerequisite_check"
        },
        {
            "type": "emotion_adjustment",
            "added": "💪",
            "rule_code": "emotion_primary_low"
        }
    ],
    "processing_time_ms": 230,
    "quality_flag": "ok",
    "needs_human_review": false
}
```

#### 4.1.2 批量难度评分接口

```
POST /internal/v1/age-adaptation/evaluate-batch
```

**请求体：**

```json
{
    "items": [
        {
            "text": "...",
            "age_group": "junior",
            "subject": "math"
        }
    ]
}
```

**响应体：**

```json
{
    "results": [
        {
            "text": "...",
            "difficulty": {
                "overall_score": 55,
                "vocabulary_score": 50,
                "sentence_score": 58,
                "concept_score": 60,
                "reasoning_score": 52,
                "prerequisite_score": 48
            },
            "target_range": [50, 70],
            "is_within_target": true,
            "gap": 0.0
        }
    ]
}
```

#### 4.1.3 获取学段表达规范

```
GET /internal/v1/age-adaptation/standards/{age_group}?subject={subject}
```

**响应体：**

```json
{
    "age_group": "primary_low",
    "subject": "math",
    "expression_standard": {
        "max_sentence_length": 15,
        "allowed_operations": ["加法", "减法", "简单乘法"],
        "forbidden_terms": ["方程", "函数", "积分", "导数"],
        "preferred_analogy_sources": ["分苹果", "数糖果", "买东西"],
        "encouragement_style": "positive_frequent",
        "step_granularity": "single_action"
    },
    "vocabulary_tips": [
        {"term": "等式", "say_instead": "两边一样的算式"},
        {"term": "乘法", "say_instead": "几个几相加"}
    ]
}
```

### 4.2 管理后台接口（教研运营使用）

#### 4.2.1 规则 CRUD

```
GET    /admin/v1/age-adaptation/rules?type={rule_type}&age_group={age_group}&page=1&size=20
POST   /admin/v1/age-adaptation/rules
PUT    /admin/v1/age-adaptation/rules/{rule_id}
DELETE /admin/v1/age-adaptation/rules/{rule_id}
```

#### 4.2.2 词汇难度管理

```
GET    /admin/v1/age-adaptation/vocabulary?subject={subject}&min_level={level}&page=1&size=50
POST   /admin/v1/age-adaptation/vocabulary/batch
PUT    /admin/v1/age-adaptation/vocabulary/{vocab_id}
```

#### 4.2.3 处理质量统计

```
GET /admin/v1/age-adaptation/statistics?start_date={date}&end_date={date}&age_group={age_group}
```

**响应体：**

```json
{
    "period": {"start": "2026-05-01", "end": "2026-05-31"},
    "total_processed": 150000,
    "by_age_group": {
        "preschool": {
            "count": 15000,
            "avg_original_score": 62.3,
            "avg_adapted_score": 18.5,
            "avg_gap_reduction": 43.8,
            "quality_distribution": {"ok": 14200, "too_simple": 300, "too_hard": 500},
            "avg_processing_time_ms": 180
        },
        "junior": {
            "count": 55000,
            "avg_original_score": 58.1,
            "avg_adapted_score": 61.2,
            "avg_gap_reduction": 3.1,
            "quality_distribution": {"ok": 52000, "too_simple": 1000, "too_hard": 2000},
            "avg_processing_time_ms": 95
        }
    },
    "top_rules_triggered": [
        {"rule_code": "vocab_replacement_science", "trigger_count": 12000},
        {"rule_code": "analogy_math_primary", "trigger_count": 8500}
    ],
    "needs_review_count": 2800
}
```

## 5. 核心处理流程

### 5.1 主处理流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    适龄化处理主流程                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │ 1. 加载学生上下文 │
                    │  - 学段/年级     │
                    │  - 学科          │
                    │  - 近期学习记录  │
                    └────────┬─────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │ 2. 表达难度评估  │
                    │  - 词汇难度      │
                    │  - 句式复杂度    │
                    │  - 概念抽象度    │
                    │  - 推理链长度    │
                    │  - 前置知识要求  │
                    └────────┬─────────┘
                              │
                    ┌─────────┴─────────┐
                    │ 难度是否在目标范围？│
                    └────┬──────────┬───┘
                      是 │          │ 否
                         ▼          ▼
                  ┌──────────┐ ┌────────────────────┐
                  │ 直接返回  │ │ 3. 确定适配策略     │
                  │ (quality │ │  - gap > 0 → 简化  │
                  │  = ok)   │ │  - gap < 0 → 深化  │
                  └──────────┘ │  - 按优先级排规则   │
                               └────────┬───────────┘
                                        │
                                        ▼
                          ┌──────────────────────────┐
                          │ 4. 执行适配规则链         │
                          │  a. 前置知识检测与补充    │
                          │  b. 词汇替换              │
                          │  c. 句式拆分/合并         │
                          │  d. 类比/示例替换         │
                          │  e. 情感语调调节          │
                          │  f. 数学表达降级/升级     │
                          └────────┬─────────────────┘
                                   │
                                   ▼
                          ┌──────────────────┐
                          │ 5. 二次难度评估   │
                          └────────┬─────────┘
                                   │
                          ┌────────┴─────────┐
                          │ 是否达标？        │
                          │ 重写轮次 < max？  │
                          └───┬──────────┬───┘
                           是 │          │ 否
                              │          ▼
                              │   ┌──────────────────┐
                              │   │ 标记 needs_review │
                              │   │ 返回最佳版本      │
                              │   └──────────────────┘
                              ▼
                    ┌──────────────────┐
                    │ 6. 记录处理日志  │
                    │    返回结果      │
                    └──────────────────┘
```

### 5.2 难度评估算法

```python
class DifficultyEvaluator:
    """表达难度评估器"""
    
    def evaluate(self, text: str, subject: str = None) -> ExpressionDifficulty:
        scores = {
            "vocabulary_score": self._eval_vocabulary(text, subject),
            "sentence_score": self._eval_sentence_complexity(text),
            "concept_score": self._eval_concept_abstraction(text, subject),
            "reasoning_score": self._eval_reasoning_chain(text),
            "prerequisite_score": self._eval_prerequisite_knowledge(text, subject),
        }
        
        # 加权平均
        weights = {
            "vocabulary_score": 0.25,
            "sentence_score": 0.15,
            "concept_score": 0.25,
            "reasoning_score": 0.20,
            "prerequisite_score": 0.15,
        }
        
        overall = sum(scores[k] * weights[k] for k in scores)
        scores["overall_score"] = round(overall, 1)
        
        return ExpressionDifficulty(**scores)
    
    def _eval_vocabulary(self, text: str, subject: str) -> float:
        """词汇难度评估
        - 分词后查询 vocabulary_difficulty 表
        - 计算加权平均难度等级
        - 映射到 0-100 分
        """
        words = self._tokenize(text)
        total_difficulty = 0
        count = 0
        
        for word in words:
            # 查缓存或数据库
            entry = self._lookup_vocabulary(word, subject)
            if entry:
                total_difficulty += entry.difficulty_level
                count += 1
        
        if count == 0:
            return 30.0  # 默认中等偏低
        
        avg_level = total_difficulty / count
        return min(avg_level * 10, 100)  # 1-10 映射到 10-100
    
    def _eval_sentence_complexity(self, text: str) -> float:
        """句式复杂度评估
        - 平均句子长度（字数）
        - 嵌套层级（括号/从句）
        - 长句占比
        """
        sentences = self._split_sentences(text)
        if not sentences:
            return 0
        
        avg_len = sum(len(s) for s in sentences) / len(sentences)
        
        # 句子长度映射：≤10字→10分，≤20字→30分，≤40字→60分，>60字→90分
        len_score = min(avg_len * 2, 100)
        
        # 嵌套检测
        nesting_score = min(text.count("因为") + text.count("所以") + 
                          text.count("如果") + text.count("那么") +
                          text.count("虽然") + text.count("但是"), 5) * 5
        
        return min((len_score + nesting_score) / 2, 100)
    
    def _eval_concept_abstraction(self, text: str, subject: str) -> float:
        """概念抽象度评估
        - 检测抽象概念关键词（公理/定理/性质/定律/原理）
        - 检测数学符号密度
        - 检测跨概念关联数量
        """
        abstraction_markers = [
            "定理", "公理", "性质", "定律", "原理", "法则", "推论",
            "充分必要", "充要条件", "等价于", "反之",
            "一般地", "类似地", "同理可证", "归纳"
        ]
        
        marker_count = sum(1 for m in abstraction_markers if m in text)
        marker_score = min(marker_count * 12, 60)
        
        # 数学符号检测
        math_symbols = ["∑", "∫", "∂", "∞", "∈", "⊆", "→", "⇒", "∈fty", "log", "sin", "cos"]
        math_count = sum(1 for s in math_symbols if s in text)
        math_score = min(math_count * 10, 40)
        
        return min(marker_score + math_score, 100)
    
    def _eval_reasoning_chain(self, text: str) -> float:
        """推理链长度评估
        - 检测步骤标记（"首先""然后""接着""最后""因此"）
        - 检测推理连接词密度
        - 检测"因为...所以..."嵌套层级
        """
        step_markers = ["首先", "然后", "接着", "其次", "再次", "最后", "综上", "因此", "所以"]
        step_count = sum(text.count(m) for m in step_markers)
        
        if step_count == 0:
            return 15.0
        elif step_count <= 2:
            return 30.0
        elif step_count <= 4:
            return 50.0
        elif step_count <= 6:
            return 70.0
        else:
            return 90.0
    
    def _eval_prerequisite_knowledge(self, text: str, subject: str) -> float:
        """前置知识要求评估
        - 检测文本中隐含的前置知识点
        - 根据知识点图谱判断前置层级深度
        - 层级越深分数越高
        """
        # 从知识点图谱服务查询
        prereqs = self._detect_implicit_prerequisites(text, subject)
        
        if not prereqs:
            return 20.0
        
        max_depth = max(p.get("depth", 0) for p in prereqs)
        return min(20 + max_depth * 15, 100)
```

### 5.3 适配规则执行引擎

```python
class AgeAdaptationEngine:
    """适龄化适配引擎"""
    
    def __init__(self, db_pool, redis_client, knowledge_service):
        self.db = db_pool
        self.redis = redis_client
        self.knowledge = knowledge_service
        self.evaluator = DifficultyEvaluator()
        
    async def process(self, request: AdaptationRequest) -> AdaptationResult:
        """主处理入口"""
        # 1. 加载学生上下文
        age_group = request.age_group
        subject = request.subject
        
        # 2. 首次难度评估
        original_difficulty = self.evaluator.evaluate(request.text, subject)
        
        # 快速路径：已在目标范围内
        if original_difficulty.is_within_target(age_group):
            return AdaptationResult(
                adapted_text=request.text,
                original_difficulty=original_difficulty,
                adapted_difficulty=original_difficulty,
                quality_flag="ok",
                changes_applied=[],
                processing_time_ms=0,
                needs_human_review=False,
            )
        
        # 3. 加载适用规则
        rules = await self._load_rules(age_group, subject)
        
        # 4. 按优先级执行规则链
        current_text = request.text
        all_changes = []
        max_rounds = request.options.get("max_rewrite_rounds", 2)
        
        for round_num in range(max_rounds):
            changes = []
            
            # a. 前置知识检测与补充
            if request.options.get("enable_prerequisite_check", True):
                prereq_changes = await self._check_and_fix_prerequisites(
                    current_text, age_group, subject
                )
                changes.extend(prereq_changes)
            
            # b. 词汇替换
            vocab_changes = await self._replace_vocabulary(
                current_text, age_group, subject
            )
            if vocab_changes:
                current_text = self._apply_text_changes(current_text, vocab_changes)
                changes.extend(vocab_changes)
            
            # c. 句式调整
            sentence_changes = self._adjust_sentences(current_text, age_group)
            if sentence_changes:
                current_text = self._apply_text_changes(current_text, sentence_changes)
                changes.extend(sentence_changes)
            
            # d. 类比/示例替换
            if request.options.get("enable_analogy_replacement", True):
                analogy_changes = await self._replace_analogies(
                    current_text, age_group, subject
                )
                if analogy_changes:
                    current_text = self._apply_text_changes(current_text, analogy_changes)
                    changes.extend(analogy_changes)
            
            # e. 情感语调调节
            if request.options.get("enable_emotion_adjustment", True):
                emotion_changes = self._adjust_emotion(current_text, age_group)
                if emotion_changes:
                    current_text = self._apply_text_changes(current_text, emotion_changes)
                    changes.extend(emotion_changes)
            
            # f. 数学表达调整
            math_changes = self._adjust_math_expressions(current_text, age_group, subject)
            if math_changes:
                current_text = self._apply_text_changes(current_text, math_changes)
                changes.extend(math_changes)
            
            all_changes.extend(changes)
            
            if not changes:
                break  # 无更多可改写内容
            
            # 二次评估
            adapted_difficulty = self.evaluator.evaluate(current_text, subject)
            tolerance = request.options.get("difficulty_tolerance", 5)
            gap = adapted_difficulty.difficulty_gap(age_group)
            
            if abs(gap) <= tolerance:
                # 达标
                return self._build_result(
                    request.text, current_text, original_difficulty,
                    adapted_difficulty, age_group, all_changes, "ok"
                )
        
        # 未完全达标，标记需人工审核
        final_difficulty = self.evaluator.evaluate(current_text, subject)
        quality = "too_hard" if final_difficulty.difficulty_gap(age_group) > 0 else "too_simple"
        
        return self._build_result(
            request.text, current_text, original_difficulty,
            final_difficulty, age_group, all_changes, quality,
            needs_human_review=True
        )
```

### 5.4 各适配规则详细逻辑

#### 5.4.1 词汇替换

```python
async def _replace_vocabulary(self, text: str, age_group: AgeGroup, subject: str) -> list:
    """检测并替换超纲词汇"""
    # 获取该学段不应出现的词汇列表
    forbidden_words = await self._get_forbidden_vocabulary(age_group, subject)
    
    changes = []
    for word_entry in forbidden_words:
        if word_entry["word"] in text:
            replacement = word_entry["alternatives"].get(age_group.value)
            if replacement:
                changes.append(AdaptationChange(
                    type="vocabulary_replacement",
                    original=word_entry["word"],
                    adapted=replacement,
                    rule_code=f"vocab_{word_entry['word']}",
                ))
    return changes
```

#### 5.4.2 句式调整

```python
def _adjust_sentences(self, text: str, age_group: AgeGroup) -> list:
    """根据学段调整句式"""
    changes = []
    
    max_length = {
        AgeGroup.PRESCHOOL: 8,
        AgeGroup.PRIMARY_LOW: 15,
        AgeGroup.PRIMARY_HIGH: 25,
        AgeGroup.JUNIOR: 40,
        AgeGroup.SENIOR: float('inf'),
    }.get(age_group, 40)
    
    if max_length == float('inf'):
        return changes
    
    sentences = self._split_sentences(text)
    for i, sent in enumerate(sentences):
        if len(sent) > max_length * 1.5:
            # 长句拆分
            split_points = self._find_natural_split_points(sent)
            if split_points:
                parts = self._split_at_points(sent, split_points)
                adapted = "。".join(parts)
                changes.append(AdaptationChange(
                    type="sentence_split",
                    original=sent,
                    adapted=adapted,
                    rule_code="sentence_length_limit",
                ))
    
    return changes
```

#### 5.4.3 类比/示例替换

```python
async def _replace_analogies(self, text: str, age_group: AgeGroup, subject: str) -> list:
    """替换不适合当前学段的类比"""
    # 查询类比配置表
    analogy_rules = await self._load_analogy_rules(age_group, subject)
    
    changes = []
    for rule in analogy_rules:
        if rule["trigger_pattern"] in text:
            age_analogy = rule["analogies"].get(age_group.value)
            if age_analogy:
                changes.append(AdaptationChange(
                    type="analogy_replacement",
                    original=rule["trigger_pattern"],
                    adapted=age_analogy,
                    rule_code=rule["rule_code"],
                ))
    return changes
```

**类比配置示例：**

| 学科 | 概念 | 幼儿 | 小学低 | 小学高 | 初中 | 高中 |
|------|------|------|--------|--------|------|------|
| 数学-分数 | 分数 | 把一个苹果切成几块，取其中几块 | 把一块蛋糕平均分成几份 | 分数表示部分与整体的关系 | 有理数的一种形式 | 实数系的子集 |
| 物理-电流 | 电流 | 水在水管里流 | 像水流过管道 | 电荷的定向移动 | I=Q/t | 电流密度矢量 |
| 化学-分子 | 分子 | 很小很小的粒子 | 组成物质的小颗粒 | 保持化学性质的最小粒子 | 分子由原子组成 | 分子轨道理论 |

#### 5.4.4 前置知识检测

```python
async def _check_and_fix_prerequisites(
    self, text: str, age_group: AgeGroup, subject: str
) -> list:
    """检测文本中隐含的前置知识是否超出学生学段"""
    # 从知识图谱获取该学段已学的知识点
    learned_kps = await self.knowledge.get_learned_knowledge_points(age_group, subject)
    
    # 从文本中检测提到的知识点
    mentioned_kps = await self.knowledge.extract_knowledge_points(text, subject)
    
    changes = []
    for kp in mentioned_kps:
        if kp not in learned_kps:
            # 该知识点超出学段，需简化或添加过渡说明
            simplified = await self.knowledge.get_simplified_explanation(
                kp, age_group, subject
            )
            if simplified:
                changes.append(AdaptationChange(
                    type="prerequisite_bridge",
                    original=f"（涉及 {kp.name}）",
                    adapted=simplified,
                    rule_code=f"prereq_bridge_{kp.code}",
                ))
            else:
                # 无法简化则移除
                changes.append(AdaptationChange(
                    type="content_removal",
                    original="",
                    reason=f"prerequisite_too_advanced: {kp.name}",
                    rule_code=f"prereq_remove_{kp.code}",
                ))
    
    return changes
```

## 6. 状态流转

### 6.1 处理状态机

```
                     ┌───────────┐
                     │ RECEIVED  │
                     └─────┬─────┘
                           │
                           ▼
                     ┌───────────┐
                ┌──→ │ EVALUATING│ ←── 首次/二次评估
                │    └─────┬─────┘
                │          │
                │    ┌─────┴──────┐
                │    │ 在目标范围内？│
                │    └──┬─────┬───┘
                │    是  │     │ 否
                │       ▼     ▼
                │  ┌──────┐ ┌──────────────┐
                │  │ DONE │ │ ADAPTING     │
                │  │(ok)  │ │ 执行规则链   │
                │  └──┬───┘ └──────┬───────┘
                │     │            │
                │     │            ▼
                │     │      ┌──────────────┐
                │     │      │RE_EVALUATING │
                │     │      └──────┬───────┘
                │     │             │
                │     │     ┌───────┴────────┐
                │     │     │ 达标且轮次 < max？│
                │     │  是 └──┬──────────┬───┘ 否
                │     └──┘     │          │
                │         ┌────┘          │
                │         │    ┌──────────┴──────┐
                └─────────┘    │DONE(needs_review)│
                     (重试)    └─────────────────┘
```

### 6.2 规则执行优先级

| 优先级 | 规则类型 | 说明 | 原因 |
|--------|----------|------|------|
| 10 | prerequisite_check | 前置知识检测 | 先移除/补充学生无法理解的内容 |
| 20 | vocabulary_replacement | 词汇替换 | 基础术语替换 |
| 30 | sentence_adjustment | 句式调整 | 拆分长句或合并短句 |
| 40 | analogy_replacement | 类比替换 | 替换不合适的类比 |
| 50 | math_expression | 数学表达调整 | 符号/公式降级或升级 |
| 60 | emotion_adjustment | 情感语调 | 最后微调鼓励方式 |

## 7. 与其他模块的协作

### 7.1 依赖服务

| 服务 | 用途 | 调用方式 |
|------|------|----------|
| AI 对话引擎 | 获取原始 AI 输出 | 同步调用（管线内） |
| 安全审核引擎 | 获取已审核文本 | 同步调用（前置） |
| 知识图谱服务 | 查询知识点层级、前置关系 | gRPC |
| Prompt 编排服务 | 获取学段感知 Prompt 参数 | Redis 缓存 |
| 学生画像服务 | 获取学生学段、能力水平 | Redis 缓存 |
| 词汇难度服务 | 本地数据库查询 | PostgreSQL |

### 7.2 在 AI 辅导管线中的调用时序

```
客户端请求 → API 网关 → AI 辅导服务
                          │
                          ├→ Prompt 编排（注入学段参数）
                          ├→ RAG 检索（学段过滤）
                          ├→ AI 模型调用
                          ├→ 安全审核
                          ├→ 事实校验
                          ├→ ★ 适龄化适配 ★ ←── 本引擎
                          ├→ 格式化渲染
                          └→ SSE 流式返回
```

### 7.3 SSE 流式场景的处理策略

对于流式输出的场景，适龄化处理需要特殊设计：

```python
class StreamingAgeAdapter:
    """流式输出适龄化处理器"""
    
    def __init__(self, age_group: AgeGroup, subject: str, buffer_size: int = 200):
        self.age_group = age_group
        self.subject = subject
        self.buffer = ""
        self.buffer_size = buffer_size
        self.sentence_buffer = []
        self.rules_loaded = asyncio.Event()
        self._load_rules_task = None
    
    async def start(self):
        """异步加载规则（不阻塞流式输出）"""
        self._load_rules_task = asyncio.create_task(self._load_rules())
    
    async def process_chunk(self, chunk: str) -> str | None:
        """处理流式文本片段
        
        策略：
        1. 累积到完整句子再处理
        2. 快速规则（词汇替换）即时应用
        3. 复杂规则（句式调整）在段落边界处理
        """
        self.buffer += chunk
        
        # 检测句子边界
        sentences = self._extract_complete_sentences()
        
        if not sentences:
            if len(self.buffer) >= self.buffer_size:
                # 缓冲区满但无句号，强制处理
                return await self._quick_adapt(self.buffer)
            return None  # 继续缓冲
        
        result_parts = []
        for sent in sentences:
            adapted = await self._adapt_sentence(sent)
            result_parts.append(adapted)
        
        return "".join(result_parts)
    
    async def _quick_adapt(self, text: str) -> str:
        """快速适配：仅执行高优先级规则"""
        if not self.rules_loaded.is_set():
            return text  # 规则未加载完成，跳过
        
        text = await self._quick_vocab_replace(text)
        return text
    
    async def finalize(self) -> str | None:
        """处理缓冲区中的剩余内容"""
        if self.buffer.strip():
            adapted = await self._adapt_sentence(self.buffer)
            self.buffer = ""
            return adapted
        return None
```

## 8. 性能设计

### 8.1 性能目标

| 指标 | 目标 | 说明 |
|------|------|------|
| 非流式处理延迟 | ≤ 300ms | 从输入到输出 |
| 流式处理首句延迟 | ≤ 100ms | 首个句子完成适配 |
| 流式处理逐句延迟 | ≤ 50ms/句 | 后续句子 |
| 规则加载缓存命中率 | ≥ 95% | Redis 缓存 |
| 词汇查询延迟 | ≤ 5ms/词 | 带缓存 |
| 批量评估 QPS | ≥ 500 | /evaluate-batch |

### 8.2 缓存策略

```
规则缓存：
  - 首次加载从 DB 读取，写入 Redis
  - TTL = 5min，后台定时刷新
  - 管理后台修改规则时主动失效

词汇缓存：
  - 热门词汇预加载到本地 LRU 缓存（10000条）
  - Redis 二级缓存
  - 新词异步回填

学段信息缓存：
  - 从学生画像服务获取
  - 本地缓存 30min
  - 学生切换学段时主动失效
```

### 8.3 预计算优化

对于高频学科-学段组合，预计算难度评分模板：

```python
# 预计算：常见表达方式的难度评分缓存
PRECOMPUTED_EXPRESSIONS = {
    ("primary_low", "math"): {
        "加法": 10, "减法": 10, "乘法": 25, "除法": 25,
        "分数": 40, "小数": 35, "面积": 30, "周长": 30,
    },
    ("junior", "math"): {
        "方程": 45, "函数": 55, "根号": 40, "绝对值": 35,
        "概率": 50, "勾股定理": 45, "相似三角形": 55,
    },
}
```

## 9. 错误处理

### 9.1 异常场景与策略

| 异常场景 | 处理策略 | 降级行为 |
|----------|----------|----------|
| 规则加载超时（>2s） | 使用本地缓存 | 返回原文 + 日志标记 |
| 词汇服务不可用 | 跳过词汇替换 | 仅执行句式和情感调整 |
| 知识图谱服务超时 | 跳过前置知识检测 | 返回原文 + 日志标记 |
| 难度评估异常 | 默认中等难度 | 不做适配，返回原文 |
| 改写后质量下降 | 回滚到改写前版本 | 返回最优版本 |
| 流式中断 | finalize 输出已缓冲内容 | 丢弃未完成片段 |

### 9.2 异常码定义

```python
class AgeAdaptationError(Enum):
    """适龄化处理错误码（前缀 AA）"""
    AA_RULES_LOAD_FAILED = "AA001"      # 规则加载失败
    AA_VOCAB_SERVICE_ERROR = "AA002"    # 词汇服务异常
    AA_KNOWLEDGE_SERVICE_ERROR = "AA003" # 知识图谱服务异常
    AA_EVALUATION_FAILED = "AA004"       # 难度评估失败
    AA_REWRITE_EXHAUSTED = "AA005"       # 改写轮次耗尽
    AA_TEXT_TOO_SHORT = "AA006"          # 文本过短（<5字），跳过处理
    AA_STREAM_INTERRUPTED = "AA007"      # 流式处理中断
```

### 9.3 降级策略配置

```yaml
age_adaptation:
  degradation:
    # 单个规则超时阈值
    rule_timeout_ms: 100
    # 总处理超时
    total_timeout_ms: 300
    # 降级时是否跳过适龄化
    skip_on_timeout: true
    # 降级时是否记录日志
    log_on_degradation: true
    # 连续降级次数告警阈值
    alert_threshold: 100
```

## 10. 配置化与可运营设计

### 10.1 教研运营能力

1. **规则热更新**：管理后台修改规则后 30s 内生效（Redis 缓存 TTL + 主动失效）
2. **A/B 测试支持**：可对不同用户分组应用不同的适龄化规则集
3. **效果追踪**：每日统计各学段的适配效果，生成适龄化质量报告
4. **人工审核队列**：`needs_human_review=true` 的记录进入审核队列
5. **词汇库持续扩充**：教研人员可批量导入/修改词汇难度定义

### 10.2 效果度量指标

```sql
-- 适龄化处理质量日报视图
CREATE OR REPLACE VIEW v_age_adaptation_daily_report AS
SELECT 
    DATE(created_at) AS report_date,
    age_group,
    COUNT(*) AS total_processed,
    AVG((original_difficulty->>'overall_score')::float) AS avg_original_score,
    AVG((adapted_difficulty->>'overall_score')::float) AS avg_adapted_score,
    SUM(CASE WHEN quality_flag = 'ok' THEN 1 ELSE 0 END) AS ok_count,
    SUM(CASE WHEN quality_flag = 'too_hard' THEN 1 ELSE 0 END) AS too_hard_count,
    SUM(CASE WHEN quality_flag = 'too_simple' THEN 1 ELSE 0 END) AS too_simple_count,
    AVG(processing_time_ms) AS avg_processing_time_ms,
    SUM(CASE WHEN needs_human_review THEN 1 ELSE 0 END) AS review_needed_count
FROM age_adaptation_logs
GROUP BY DATE(created_at), age_group;
```

## 11. 测试要点

### 11.1 单元测试用例

| 测试场景 | 输入 | 学段 | 预期 |
|----------|------|------|------|
| 幼儿-物理简单题 | "力是物体对物体的作用" | preschool | "力就是一个东西推或者拉另一个东西" |
| 小学低-数学分数 | "1/2是最简分数" | primary_low | "把一个东西平均分成2份，取其中1份" |
| 初中-化学方程式 | "2H₂+O₂→2H₂O" | junior | 保留方程式，添加"氢气和氧气反应生成水" |
| 高中-微积分 | "求f(x)的导数" | senior | 保持不变 |
| 难度已在范围内 | "1+1=2" | primary_low | 直接返回，不做改写 |
| 文本过短 | "对" | any | 跳过处理 |

### 11.2 集成测试场景

| 场景 | 验证点 |
|------|--------|
| AI 完整管线 | 从用户提问到适龄化输出端到端 |
| 流式输出 | SSE 逐句适配，无乱序/丢失 |
| 规则热更新 | 修改规则后 30s 内生效 |
| 降级恢复 | 依赖服务恢复后自动回正 |
| 并发压力 | 500 QPS 下延迟 < 300ms |

### 11.3 质量回归测试

定期（每周）对历史适配结果进行抽检：
- 随机抽取各学段 100 条已适配文本
- 教研人员人工评分（1-5 分）
- 自动评分与人工评分的相关系数 > 0.8
- 不合格率 < 5%
