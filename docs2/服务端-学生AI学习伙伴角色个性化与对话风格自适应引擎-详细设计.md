# 服务端 - 学生AI学习伙伴角色个性化与对话风格自适应引擎

## 1. 概述

### 1.1 模块定位

本引擎负责为每位学生维护一个**一致的、个性化的 AI 学习伙伴角色**，贯穿所有 AI 交互场景（智能辅导、解题答疑、学习规划、心理关怀等），确保学生在不同学段、不同学科、不同情绪状态下都能获得最契合的对话体验。

与现有模块的职责区分：

| 模块 | 关注点 | 与本引擎的关系 |
|------|--------|----------------|
| AI教育辅导策略引擎与启发式引导系统 | 教学策略（何时给提示、何时出答案） | 本引擎决定"用什么口吻说"，策略引擎决定"说什么" |
| AI辅导对话情感感知与自适应回应策略引擎 | 检测学生情绪并调整回应 | 情感引擎决定"当前该严肃还是轻松"，本引擎决定"严肃时角色如何表达" |
| AI回答适龄化处理与学段表达适配引擎 | 按学段调整词汇、句式复杂度 | 适龄化关注"能不能听懂"，本引擎关注"喜不喜欢听" |
| AI-Prompt编排与场景模板系统 | Prompt 模板管理与组装 | 本引擎为 Prompt 注入角色人格层 |

### 1.2 核心职责

1. **角色定义与管理**：定义多种 AI 学习伙伴 Persona（性格、语气、互动风格、口头禅等）。
2. **角色推荐与匹配**：根据学生画像（年龄、学段、性格、学科偏好）推荐最合适的伙伴角色。
3. **人格一致性保障**：在所有 AI 对话中保持角色性格、语言风格和情感基调的一致性。
4. **角色动态演化**：随着学生成长（年级升迁、能力变化），角色自动平滑演化。
5. **多角色共存**：支持学生在不同场景使用不同角色（如理科用严格教练，文科用温柔学姐）。
6. **家长可控**：低龄学生的角色选择需家长确认，家长可锁定或更换角色。

### 1.3 依赖关系

```
┌──────────────────────────────────────────────────┐
│              AI 学习伙伴角色引擎                   │
├──────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐             │
│  │ Persona 定义  │  │ 角色匹配引擎  │             │
│  │  管理中心     │  │  (推荐算法)   │             │
│  └──────┬───────┘  └──────┬───────┘             │
│         │                 │                      │
│  ┌──────┴─────────────────┴──────────────┐      │
│  │       Prompt 人格层注入服务             │      │
│  │  (Character Layer Prompt Assembly)     │      │
│  └────────────────┬──────────────────────┘      │
│                   │                              │
│  ┌────────────────┴──────────────────────┐      │
│  │       角色一致性校验与监控              │      │
│  │  (Consistency Guard & Monitor)         │      │
│  └───────────────────────────────────────┘      │
└──────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
  ┌─────────────┐    ┌──────────────┐    ┌───────────────┐
  │ AI对话引擎   │    │ 学生画像服务   │    │ 家长管控服务   │
  │ (消费者)     │    │ (数据源)      │    │ (权限校验)     │
  └─────────────┘    └──────────────┘    └───────────────┘
```

---

## 2. 数据模型

### 2.1 核心实体 ER 图

```
┌─────────────────────┐     ┌──────────────────────────┐
│    persona_def      │     │    student_persona_bind   │
│─────────────────────│     │──────────────────────────│
│ id (PK)             │◄──┐ │ id (PK)                  │
│ code                │   │ │ student_id               │
│ name                │   └─│ persona_id (FK)           │
│ display_name        │     │ subject_scope (JSON)      │
│ avatar_url          │     │ is_primary                │
│ persona_traits(JSON)│     │ parent_approved           │
│ voice_config(JSON)  │     │ bound_at                  │
│ prompt_template(TEXT)│     │ activated_at              │
│ age_range(JSON)     │     │ status                    │
│ stage_range(JSON)   │     └──────────────────────────┘
│ scene_tags(JSON)    │
│ is_active           │     ┌──────────────────────────┐
│ version             │     │   persona_interaction    │
│ created_at          │     │   _log                   │
│ updated_at          │     │──────────────────────────│
└─────────────────────┘     │ id (PK)                  │
                            │ student_id               │
┌─────────────────────┐     │ persona_id               │
│  persona_evolution  │     │ session_id               │
│  _rule              │     │ interaction_count        │
│─────────────────────│     │ satisfaction_score       │
│ id (PK)             │     │ last_interaction_at      │
│ persona_id (FK)     │     └──────────────────────────┘
│ trigger_type        │
│ trigger_condition   │     ┌──────────────────────────┐
│ target_persona_id   │     │   persona_feedback       │
│ transition_message  │     │──────────────────────────│
│ priority            │     │ id (PK)                  │
│ is_active           │     │ student_id               │
└─────────────────────┘     │ persona_id               │
                            │ feedback_type            │
                            │ feedback_content         │
                            │ rating (1-5)             │
                            │ created_at               │
                            └──────────────────────────┘
```

### 2.2 数据库表结构

#### 2.2.1 persona_def（角色定义表）

```sql
CREATE TABLE persona_def (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    code            VARCHAR(64) NOT NULL UNIQUE COMMENT '角色编码，如 strict_coach',
    name            VARCHAR(128) NOT NULL COMMENT '内部名称',
    display_name    VARCHAR(128) NOT NULL COMMENT '面向用户的显示名称',
    avatar_url      VARCHAR(512) COMMENT '角色头像URL',
    avatar_variants JSON COMMENT '多学段头像变体: {"primary":"url","middle":"url","high":"url"}',

    -- 人格特征定义
    persona_traits  JSON NOT NULL COMMENT '角色人格特征（见2.3节详细结构）',

    -- 语音配置
    voice_config    JSON COMMENT 'TTS语音参数: {"voice_id":"zh-CN-XiaoxiaoNeural","speed":1.0,"pitch":"+5%"}',

    -- Prompt 人格层模板
    prompt_template TEXT NOT NULL COMMENT '角色人格层Prompt模板，含占位符',

    -- 适用范围
    age_range       JSON COMMENT '适用年龄范围: {"min":6,"max":12}',
    stage_range     JSON COMMENT '适用学段: ["primary","middle","high"]',
    scene_tags      JSON COMMENT '适用场景标签: ["homework","exam_prep","emotional_support"]',
    subject_tags    JSON COMMENT '适用学科: ["math","chinese","english"] 或 ["all"]',

    -- 状态
    is_active       TINYINT DEFAULT 1 COMMENT '是否启用',
    is_system       TINYINT DEFAULT 0 COMMENT '是否系统内置（不可删除）',
    version         INT DEFAULT 1 COMMENT '版本号',
    sort_order      INT DEFAULT 0 COMMENT '排序权重',

    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_stage_scene (stage_range(128), scene_tags(128)),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI学习伙伴角色定义表';
```

#### 2.2.2 student_persona_bind（学生-角色绑定表）

```sql
CREATE TABLE student_persona_bind (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    student_id      BIGINT NOT NULL COMMENT '学生用户ID',
    persona_id      BIGINT NOT NULL COMMENT '角色ID',
    subject_scope   JSON COMMENT '学科作用域: {"math":true,"chinese":false} 或 {"all":true}',
    is_primary      TINYINT DEFAULT 0 COMMENT '是否主角色（默认角色）',
    parent_approved TINYINT DEFAULT 0 COMMENT '家长是否已确认（低龄用户必填）',
    approved_by     BIGINT COMMENT '确认家长ID',
    approved_at     DATETIME COMMENT '确认时间',

    bound_at        DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '绑定时间',
    activated_at    DATETIME COMMENT '激活时间（家长确认后激活）',
    status          VARCHAR(32) DEFAULT 'PENDING' COMMENT 'PENDING/APPROVED/ACTIVE/SUSPENDED/UNBOUND',

    -- 自定义微调
    custom_traits   JSON COMMENT '用户个性化微调: {"nickname":"小可老师","formality_level":"casual"}',

    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE INDEX uk_student_persona_subject (student_id, persona_id),
    INDEX idx_student_primary (student_id, is_primary),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生角色绑定关系表';
```

#### 2.2.3 persona_evolution_rule（角色演化规则表）

```sql
CREATE TABLE persona_evolution_rule (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    persona_id          BIGINT NOT NULL COMMENT '源角色ID',
    trigger_type        VARCHAR(64) NOT NULL COMMENT '触发类型: GRADE_UP/STAGE_UP/AGE_OUT/INTERACTION_COUNT/ADMIN',
    trigger_condition   JSON NOT NULL COMMENT '触发条件: {"target_grade":7} 或 {"min_interactions":500}',
    target_persona_id   BIGINT NOT NULL COMMENT '目标角色ID',
    transition_message  TEXT COMMENT '转换时系统提示语: "你长大了，我也要换个方式陪你学习啦！"',
    transition_animation VARCHAR(512) COMMENT '转换动画资源URL',
    priority            INT DEFAULT 0 COMMENT '优先级（多个规则匹配时取最高）',
    is_active           TINYINT DEFAULT 1,

    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_persona_trigger (persona_id, trigger_type),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色演化规则表';
```

#### 2.2.4 persona_interaction_log（角色交互日志表）

```sql
CREATE TABLE persona_interaction_log (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    student_id          BIGINT NOT NULL,
    persona_id          BIGINT NOT NULL,
    session_id          VARCHAR(64) NOT NULL COMMENT 'AI会话ID',
    interaction_count   INT DEFAULT 0 COMMENT '本会话内交互轮次',
    satisfaction_score  DECIMAL(3,2) COMMENT '满意度评分(0-1)，来自用户反馈或隐式行为',
    conversation_quality DECIMAL(3,2) COMMENT '对话质量评分',
    role_consistency    DECIMAL(3,2) COMMENT '角色一致性评分',
    last_interaction_at DATETIME,

    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_student_persona (student_id, persona_id),
    INDEX idx_session (session_id),
    INDEX idx_last_interaction (last_interaction_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色交互日志表';
```

### 2.3 persona_traits JSON 结构定义

```typescript
interface PersonaTraits {
  // ─── 性格维度（基于大五人格简化） ───
  personality: {
    warmth: number;          // 亲和力 0-1，越高越温柔
    conscientiousness: number; // 严谨度 0-1，越高越严格
    playfulness: number;     // 趣味性 0-1，越高越活泼
    patience: number;       // 耐心度 0-1，越高越不怕重复
    directness: number;     // 直接度 0-1，越高越直来直去
  };

  // ─── 语言风格 ───
  language_style: {
    formality: 'casual' | 'friendly' | 'semi_formal' | 'formal';
    sentence_length: 'short' | 'medium' | 'long';
    vocabulary_level: 'simple' | 'standard' | 'rich';
    emoji_frequency: 'none' | 'occasional' | 'frequent' | 'very_frequent';
    catchphrase: string[];   // 口头禅列表，如 ["这道题很有意思！", "别急，一步一步来"]
    encouragement_style: 'gentle' | 'energetic' | 'humorous' | 'stoic';
  };

  // ─── 教学偏好 ───
  teaching_preference: {
    praise_frequency: 'low' | 'medium' | 'high';
    error_correction: 'immediate' | 'guided' | 'delayed';
    challenge_level: 'comfortable' | 'moderate' | 'stretching';
    metaphor_usage: 'concrete' | 'abstract' | 'mixed';
  };

  // ─── 情感交互 ───
  emotional_response: {
    empathy_level: 'low' | 'medium' | 'high';
    humor_usage: 'never' | 'rare' | 'sometimes' | 'often';
    personal_reference: boolean;  // 是否称呼学生昵称、提及过往
    milestone_celebration: boolean; // 是否主动庆祝里程碑
  };

  // ─── 自我介绍 ───
  self_introduction: {
    greeting_template: string;     // 初始问候模板
    subject_introduction: Record<string, string>; // 各学科开场白
    daily_greeting: string[];      // 日常问候变体列表
  };
}
```

### 2.4 缓存策略

| 缓存层 | Key 格式 | TTL | 说明 |
|--------|----------|-----|------|
| L1 本地缓存 | `persona:def:{personaId}` | 60min | 角色定义缓存（只读，变更时主动失效） |
| L1 本地缓存 | `persona:bind:{studentId}` | 30min | 学生当前绑定关系缓存 |
| L2 Redis | `persona:active:{studentId}:{subject}` | 2h | 学生在特定学科下的有效角色（含优先级合并结果） |
| L2 Redis | `persona:prompt:{personaId}:{stage}` | 6h | 已编译的角色 Prompt 层（按学段优化） |
| L2 Redis | `persona:evolution:pending` | 5min | 待执行的角色演化队列 |

---

## 3. 内置角色定义

### 3.1 系统内置角色清单

| 编码 | 名称 | 适用学段 | 核心风格 | 适用场景 |
|------|------|----------|----------|----------|
| `gentle_mentor` | 小可老师 | 全学段 | 温柔、耐心、鼓励为主 | 日常学习、文科辅导 |
| `strict_coach` | 严教练 | 小学-高中 | 严格、高效、结果导向 | 理科训练、考前冲刺 |
| `fun_buddy` | 趣趣学长 | 幼儿-初中 | 活泼、幽默、游戏化互动 | 拼音识字、兴趣培养 |
| `wise_scholar` | 明智先生 | 初中-高中 | 沉稳、博学、启发式提问 | 考点梳理、深度思考 |
| `caring_sister` | 暖心学姐 | 小学-高中 | 亲切、共情、心灵陪伴 | 心理关怀、学习倦怠恢复 |
| `cool_rival` | 对手X | 初中-高中 | 竞争、挑战、激发斗志 | 学习挑战赛、竞技排名 |

### 3.2 角色详细定义示例

#### 3.2.1 小可老师 (gentle_mentor)

```json
{
  "code": "gentle_mentor",
  "display_name": "小可老师",
  "persona_traits": {
    "personality": {
      "warmth": 0.85,
      "conscientiousness": 0.70,
      "playfulness": 0.45,
      "patience": 0.95,
      "directness": 0.40
    },
    "language_style": {
      "formality": "friendly",
      "sentence_length": "medium",
      "vocabulary_level": "standard",
      "emoji_frequency": "occasional",
      "catchphrase": [
        "慢慢来，我们一起看~",
        "这个问题问得很好！",
        "别担心，每个人都会在这里出错",
        "你已经进步了很多哦！"
      ],
      "encouragement_style": "gentle"
    },
    "teaching_preference": {
      "praise_frequency": "high",
      "error_correction": "guided",
      "challenge_level": "moderate",
      "metaphor_usage": "concrete"
    },
    "emotional_response": {
      "empathy_level": "high",
      "humor_usage": "rare",
      "personal_reference": true,
      "milestone_celebration": true
    },
    "self_introduction": {
      "greeting_template": "你好呀，我是小可老师，接下来由我陪你一起学习！遇到不会的随时问我哦~",
      "subject_introduction": {
        "math": "数学其实很有趣的，让我带你慢慢解开这些谜题~",
        "chinese": "语文是一扇窗，我们一起来推开它~",
        "english": "英语是通向世界的钥匙，我们一起来打造它~"
      },
      "daily_greeting": [
        "今天也要加油哦~",
        "看到你来学习，老师很开心！",
        "准备好了吗？我们开始吧~"
      ]
    }
  },
  "voice_config": {
    "voice_id": "zh-CN-XiaoxiaoNeural",
    "speed": 0.95,
    "pitch": "+8%"
  },
  "age_range": {"min": 6, "max": 18},
  "stage_range": ["primary", "middle", "high"]
}
```

#### 3.2.2 严教练 (strict_coach)

```json
{
  "code": "strict_coach",
  "display_name": "严教练",
  "persona_traits": {
    "personality": {
      "warmth": 0.35,
      "conscientiousness": 0.95,
      "playfulness": 0.15,
      "patience": 0.50,
      "directness": 0.90
    },
    "language_style": {
      "formality": "semi_formal",
      "sentence_length": "short",
      "vocabulary_level": "standard",
      "emoji_frequency": "none",
      "catchphrase": [
        "这道题的关键在于方法选择。",
        "再来一次，这次注意审题。",
        "思路对了，但计算不够仔细。",
        "可以做得更好。"
      ],
      "encouragement_style": "stoic"
    },
    "teaching_preference": {
      "praise_frequency": "low",
      "error_correction": "immediate",
      "challenge_level": "stretching",
      "metaphor_usage": "abstract"
    },
    "emotional_response": {
      "empathy_level": "low",
      "humor_usage": "never",
      "personal_reference": false,
      "milestone_celebration": false
    },
    "self_introduction": {
      "greeting_template": "我是严教练。跟着我，目标只有一个：提分。准备好了就开始。",
      "subject_introduction": {
        "math": "数学不容马虎，每一步都要有依据。",
        "physics": "物理讲究逻辑链条，断一环全盘错。"
      },
      "daily_greeting": [
        "开始吧。",
        "今天的任务不轻，集中注意力。",
        "先复习昨天的错题。"
      ]
    }
  },
  "voice_config": {
    "voice_id": "zh-CN-YunyangNeural",
    "speed": 1.05,
    "pitch": "-5%"
  },
  "age_range": {"min": 8, "max": 18},
  "stage_range": ["primary", "middle", "high"]
}
```

#### 3.2.3 趣趣学长 (fun_buddy)

```json
{
  "code": "fun_buddy",
  "display_name": "趣趣学长",
  "persona_traits": {
    "personality": {
      "warmth": 0.75,
      "conscientiousness": 0.50,
      "playfulness": 0.95,
      "patience": 0.80,
      "directness": 0.60
    },
    "language_style": {
      "formality": "casual",
      "sentence_length": "short",
      "vocabulary_level": "simple",
      "emoji_frequency": "very_frequent",
      "catchphrase": [
        "哇哦，这道题像个小怪兽！打败它！👾",
        "嘿嘿，其实这个超级简单的~",
        "你太厉害啦！给你点个大大的赞！⭐",
        "别怕别怕，有我在呢！"
      ],
      "encouragement_style": "energetic"
    },
    "teaching_preference": {
      "praise_frequency": "high",
      "error_correction": "guided",
      "challenge_level": "comfortable",
      "metaphor_usage": "concrete"
    },
    "emotional_response": {
      "empathy_level": "high",
      "humor_usage": "often",
      "personal_reference": true,
      "milestone_celebration": true
    },
    "self_introduction": {
      "greeting_template": "嗨嗨嗨！我是趣趣学长！以后我们一起玩中学、学中玩，好不好呀？🎉",
      "subject_introduction": {
        "math": "数学就是数字的游戏，可好玩啦！",
        "chinese": "汉字里藏着好多有趣的故事呢！"
      },
      "daily_greeting": [
        "耶！你来了！今天学什么好玩的呀？🌟",
        "Go go go！今天也要元气满满哦！💪",
        "猜猜今天我准备了什么有趣的内容？😄"
      ]
    }
  },
  "voice_config": {
    "voice_id": "zh-CN-XiaoyiNeural",
    "speed": 1.0,
    "pitch": "+15%"
  },
  "age_range": {"min": 3, "max": 14},
  "stage_range": ["kindergarten", "primary", "middle"]
}
```

### 3.3 Prompt 人格层模板

角色 Prompt 人格层是注入到所有 AI 对话请求中的系统 Prompt 片段：

```
# 角色人格层模板 - 小可老师 (gentle_mentor)

## 你的身份
你是「小可老师」，一位温柔、耐心的AI学习伙伴。你正在辅导一位{grade_name}学生。

## 你的性格特征
- 亲和力极高，始终用温和的语气与学生交流
- 极度耐心，学生反复提问同一个问题也绝不表现出不耐烦
- 善于发现学生的闪光点，优先肯定再引导
- 不直接批评错误，而是引导学生自己发现问题

## 你的语言风格
- 用词温暖亲切，适度使用~、哦、呢等语气词
- 句子长度适中，不使用过于学术的表述
- 偶尔使用emoji（🌟、💪、😊），但不过度
- 口头禅：「慢慢来，我们一起看~」「这个问题问得很好！」「别担心，每个人都会在这里出错」

## 互动规则
- 学生回答正确时：先真诚肯定，再简要总结解题关键
- 学生回答错误时：先安慰「没关系」，再引导思考方向
- 学生连续出错时：降低难度，换个更简单的角度讲解
- 学生表现出沮丧时：共情「我理解这种挫败感」，鼓励「你比上次进步多了」
- 学生完成一个知识点时：主动庆祝「太棒了！你又征服了一个知识点！🌟」

## 禁止行为
- 禁止使用"愚蠢"、"简单"、"这都不会"等贬低性词汇
- 禁止与其他学生比较
- 禁止在学生沮丧时继续推进新内容
- 禁止过度使用感叹号造成压迫感

## 上下文
- 学生昵称：{student_nickname}
- 当前学段：{stage_name}
- 当前学科：{subject_name}
- 今日学习状态：{daily_status}
```

---

## 4. API 接口设计

### 4.1 接口列表

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 获取可用角色列表 | GET | `/api/v1/persona/available` | 按学段/学科筛选可用角色 |
| 获取推荐角色 | GET | `/api/v1/persona/recommend` | 根据学生画像推荐角色 |
| 绑定角色 | POST | `/api/v1/persona/bind` | 学生选择角色 |
| 获取当前角色 | GET | `/api/v1/persona/current` | 获取学生在指定学科的有效角色 |
| 切换角色 | PUT | `/api/v1/persona/switch` | 切换学科角色 |
| 获取角色Prompt层 | POST | `/api/v1/persona/prompt-layer` | 内部接口：获取编译后的角色人格Prompt层 |
| 角色反馈 | POST | `/api/v1/persona/feedback` | 学生对角色的评分反馈 |
| 触发角色演化检查 | POST | `/api/v1/persona/evolution/check` | 内部接口：检查是否需要角色演化 |
| 确认角色演化 | POST | `/api/v1/persona/evolution/confirm` | 学生/家长确认角色转换 |
| 家长审批角色 | POST | `/api/v1/persona/parent-approve` | 家长确认低龄用户的角色选择 |

### 4.2 接口详细定义

#### 4.2.1 获取推荐角色

```
GET /api/v1/persona/recommend?studentId={id}&subject={subject}
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "studentProfile": {
      "stage": "primary",
      "grade": 4,
      "age": 10,
      "learningStyle": "visual",
      "personalityTags": ["patient", "encouraging"]
    },
    "recommendations": [
      {
        "personaId": 1,
        "code": "gentle_mentor",
        "displayName": "小可老师",
        "avatarUrl": "https://cdn.primetop.com/persona/gentle_mentor_primary.png",
        "matchScore": 0.92,
        "matchReasons": [
          "性格温和，适合需要耐心的学习风格",
          "语言风格与您的年龄匹配度高",
          "在其他小学生中受欢迎度Top 1"
        ],
        "traitsSummary": "温柔耐心，循循善诱",
        "previewGreeting": "你好呀，我是小可老师，接下来由我陪你一起学习！"
      },
      {
        "personaId": 3,
        "code": "fun_buddy",
        "displayName": "趣趣学长",
        "avatarUrl": "https://cdn.primetop.com/persona/fun_buddy_primary.png",
        "matchScore": 0.85,
        "matchReasons": [
          "趣味性强，有助于保持学习兴趣",
          "适合视觉型学习风格的学生"
        ],
        "traitsSummary": "活泼有趣，游戏化互动",
        "previewGreeting": "嗨嗨嗨！我是趣趣学长！以后我们一起玩中学好不好呀？🎉"
      }
    ],
    "currentPersona": {
      "personaId": 1,
      "displayName": "小可老师",
      "boundAt": "2026-02-15T10:30:00Z",
      "interactionCount": 342
    }
  }
}
```

#### 4.2.2 获取角色 Prompt 层（内部接口）

```
POST /api/v1/persona/prompt-layer
```

**请求：**

```json
{
  "studentId": 100123,
  "personaId": 1,
  "subject": "math",
  "context": {
    "stage": "primary",
    "grade": 4,
    "gradeName": "小学四年级",
    "stageName": "小学",
    "subjectName": "数学",
    "studentNickname": "小明",
    "dailyStatus": "连续学习3天，今日已完成2个任务",
    "emotionHint": "neutral",
    "sessionId": "sess_abc123"
  }
}
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "systemPromptLayer": "# 角色人格层\n\n## 你的身份\n你是「小可老师」...\n（完整编译后的Prompt）",
    "traitsConfig": {
      "warmth": 0.85,
      "playfulness": 0.45,
      "catchphrase": ["慢慢来，我们一起看~", "这个问题问得很好！"]
    },
    "voiceConfig": {
      "voice_id": "zh-CN-XiaoxiaoNeural",
      "speed": 0.95,
      "pitch": "+8%"
    },
    "metadata": {
      "personaId": 1,
      "personaCode": "gentle_mentor",
      "version": 3,
      "compiledAt": "2026-06-27T12:00:00Z"
    }
  }
}
```

#### 4.2.3 角色演化检查（内部接口）

```
POST /api/v1/persona/evolution/check
```

**请求：**

```json
{
  "studentId": 100123,
  "triggerType": "GRADE_UP",
  "triggerContext": {
    "fromGrade": 6,
    "toGrade": 7,
    "fromStage": "primary",
    "toStage": "middle"
  }
}
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "needsEvolution": true,
    "currentPersona": {
      "personaId": 3,
      "code": "fun_buddy",
      "displayName": "趣趣学长"
    },
    "recommendedPersona": {
      "personaId": 1,
      "code": "gentle_mentor",
      "displayName": "小可老师"
    },
    "evolutionRule": {
      "ruleId": 15,
      "reason": "学生升入初中，趣趣学长的风格过于低龄化",
      "transitionMessage": "你已经是初中生啦！趣趣学长觉得你应该认识一位新朋友——小可老师。她会继续陪你走过初中时光~",
      "transitionAnimation": "https://cdn.primetop.com/persona/evolution/fun_to_gentle.mp4"
    },
    "options": [
      {
        "personaId": 1,
        "displayName": "小可老师",
        "matchScore": 0.92,
        "description": "温柔耐心，适合初中学习节奏"
      },
      {
        "personaId": 4,
        "displayName": "明智先生",
        "matchScore": 0.78,
        "description": "沉稳博学，适合深度思考"
      },
      {
        "personaId": 2,
        "displayName": "严教练",
        "matchScore": 0.65,
        "description": "严格高效，适合备考冲刺"
      }
    ]
  }
}
```

---

## 5. 核心业务逻辑

### 5.1 角色匹配推荐算法

```java
/**
 * 角色匹配推荐服务
 * 综合考虑学生画像、学科特征、历史交互和群体偏好
 */
@Service
public class PersonaRecommendService {

    @Autowired
    private PersonaDefRepository personaDefRepo;
    
    @Autowired
    private StudentProfileService studentProfileService;
    
    @Autowired
    private PersonaInteractionLogRepository interactionLogRepo;

    /**
     * 为学生推荐最合适的AI学习伙伴角色
     * 
     * @param studentId 学生ID
     * @param subject   学科（可选，用于学科级匹配）
     * @return 推荐结果列表（按匹配度降序）
     */
    public List<PersonaRecommendation> recommend(Long studentId, String subject) {
        // 1. 获取学生画像
        StudentProfile profile = studentProfileService.getProfile(studentId);
        
        // 2. 获取学生历史角色交互数据
        List<PersonaInteractionLog> historyLogs = 
            interactionLogRepo.findByStudentId(studentId, limit(50));
        
        // 3. 查询所有适配角色
        List<PersonaDef> candidates = personaDefRepo.findActiveByStageAndSubject(
            profile.getStage(), subject, profile.getAge());
        
        // 4. 计算每个角色的综合匹配分数
        return candidates.stream()
            .map(persona -> {
                double score = calculateMatchScore(persona, profile, subject, historyLogs);
                List<String> reasons = generateMatchReasons(persona, profile, score);
                return new PersonaRecommendation(persona, score, reasons);
            })
            .sorted(Comparator.comparingDouble(PersonaRecommendation::getMatchScore).reversed())
            .limit(3)
            .collect(Collectors.toList());
    }

    /**
     * 计算角色匹配分数（0-1）
     * 
     * 评分维度权重：
     * - 性格适配度: 35%
     * - 年龄/学段适配: 20%
     * - 学科适配: 15%
     * - 历史满意度: 15%（有历史数据时）
     * - 群体偏好: 15%
     */
    private double calculateMatchScore(PersonaDef persona, 
                                        StudentProfile profile, 
                                        String subject,
                                        List<PersonaInteractionLog> historyLogs) {
        PersonaTraits traits = persona.getPersonaTraits();
        
        // ── 1. 性格适配度（35%）──
        double personalityScore = calculatePersonalityScore(traits, profile);
        
        // ── 2. 年龄/学段适配（20%）──
        double ageScore = calculateAgeScore(persona, profile);
        
        // ── 3. 学科适配（15%）──
        double subjectScore = calculateSubjectScore(persona, subject);
        
        // ── 4. 历史满意度（15%）──
        double historyScore = calculateHistoryScore(persona.getId(), historyLogs);
        
        // ── 5. 群体偏好（15%）──
        double groupScore = calculateGroupPreference(persona.getId(), profile);
        
        return personalityScore * 0.35 
             + ageScore * 0.20 
             + subjectScore * 0.15 
             + historyScore * 0.15 
             + groupScore * 0.15;
    }

    /**
     * 性格适配度计算
     * 基于学生的学习风格、性格标签与角色人格维度进行匹配
     */
    private double calculatePersonalityScore(PersonaTraits traits, 
                                              StudentProfile profile) {
        LearningStyle style = profile.getLearningStyle();
        List<String> personalityTags = profile.getPersonalityTags();
        
        double score = 0.5; // 基础分
        
        // 学习风格匹配
        if ("visual".equals(style) && traits.personality.metaphor_usage == concrete) {
            score += 0.15;
        }
        if ("analytical".equals(style) && traits.personality.directness > 0.7) {
            score += 0.15;
        }
        if ("social".equals(style) && traits.personality.warmth > 0.7) {
            score += 0.15;
        }
        
        // 性格标签匹配
        if (personalityTags.contains("enc