# 教育 AI 多角色辅导智能体定义与多智能体协作编排引擎 - 详细设计

> **文档版本：** v1.0
> **创建日期：** 2026-06-23
> **所属模块：** AI 能力层 / AI 智能辅导
> **优先级：** P1（V1.5 阶段核心能力）

---

## 1. 概述

### 1.1 设计目标

为 PrimeTop 的 AI 辅导系统引入 **多角色智能体（Multi-Persona Agent）** 能力，使 AI 辅导不再是"一个匿名的 AI 助手"，而是可以根据学科、学段、场景切换不同的 **虚拟教师角色（Persona）**，并支持多个角色在同一个学习场景中 **协作教学**。

核心能力包括：

1. **角色定义**：为不同学科、学段定义差异化的 AI 教师形象（姓名、头像、性格、教学风格、语言风格）
2. **角色路由**：根据学生画像、学科、学习场景自动选择最合适的教师角色
3. **角色一致性**：在多轮对话和跨会话中保持角色性格、记忆和风格一致
4. **多智能体协作**：支持多个 AI 教师角色在同一个场景中协作（如：两位老师从不同角度讲解、师生角色扮演、同伴互学）
5. **角色管理**：运营团队可通过管理后台配置、预览、发布教师角色

### 1.2 与现有模块的边界

| 现有模块 | 职责 | 本引擎的差异 |
|---------|------|-------------|
| AI教育辅导策略引擎与启发式引导系统 | 决定"怎么教"（脚手架、苏格拉底、提示链等策略） | 本引擎决定"谁来教"（角色身份、性格、语言风格） |
| 教育AI智能体多步推理与工具调用编排引擎 | 单 Agent 的多步推理循环与工具调用编排 | 本引擎编排**多个 Agent 角色**的交互与协作 |
| AI-Prompt编排与场景模板系统 | Prompt 模板管理与组装 | 本引擎为 Prompt 注入角色 System Prompt 和角色约束 |
| AI回答适龄化处理与学段表达适配引擎 | 按学段调整表达深度和用词 | 本引擎按角色身份定义整体语言风格，适龄化是其中一个维度 |
| AI模型上下文管理与对话记忆引擎 | 对话上下文压缩与长期记忆 | 本引擎管理角色的跨会话一致性和角色记忆 |
| AI辅导对话情感感知与自适应回应策略引擎 | 感知学生情绪并调整回应 | 本引擎的角色性格中包含情感回应模式定义 |

### 1.3 核心价值

| 维度 | 无角色系统 | 有角色系统 |
|------|-----------|-----------|
| 用户粘性 | AI 是无名工具，切换成本低 | 学生与"李老师""小智同学"建立情感连接 |
| 教学适配 | 所有学科同一套语言风格 | 数学老师严谨，语文老师温婉，英语老师活泼 |
| 低龄友好 | 冷冰冰的 AI 回答 | 可爱的卡通角色陪伴幼儿学习 |
| 教学多样性 | 单一讲解视角 | 多角色辩论、同伴互学等丰富教学模式 |
| 品牌差异化 | 与竞品 AI 功能同质化 | 角色 IP 成为产品辨识度和品牌资产 |

### 1.4 适用场景

| 场景 | 角色配置 | 协作模式 |
|------|---------|---------|
| 小学数学辅导 | 张老师（耐心细致，善用比喻） | 单角色 |
| 高中物理难题讲解 | 李老师（逻辑严谨，强调方法） | 单角色 |
| 幼儿拼音启蒙 | 拼音小精灵（活泼可爱，语音为主） | 单角色 + 虚拟形象 |
| 作文写作指导 | 王老师（文学素养高，鼓励表达） | 单角色 |
| 英语口语练习 | Teacher Emma（纯正发音，互动引导） | 单角色 + 语音 |
| 理科综合解题讨论 | 李老师 + 赵老师（不同解题思路对比） | **双角色辩论** |
| 同伴互助学习 | 小智同学（同龄学霸角色，分享解题思路） | **角色扮演** |
| 知识拓展探讨 | 学科老师 + 历史人物（如"爱因斯坦讲相对论"） | **客串角色** |

### 1.5 设计原则

1. **角色服务于教学**：角色不是装饰，每种性格特征都对应教学目标
2. **安全为先**：角色设定中内置安全边界，角色永远不能突破内容安全策略
3. **一致性优先**：一个角色在任何场景下都不能"OOC"（Out of Character）
4. **成本可控**：多角色协作场景的 Token 消耗需有预算控制
5. **渐进增强**：MVP 先做单角色，V1.5 引入多角色协作
6. **可配置**：运营团队可在后台配置角色，无需修改代码

---

## 2. 系统架构

### 2.1 总体架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                        AI 辅导全链路请求处理                           │
│                            (已有模块)                                  │
│                                                                      │
│  用户请求 → 意图识别 → 安全过滤 → 角色路由决策                         │
│                                   │                                   │
│                    ┌──────────────┴──────────────┐                   │
│                    │                             │                   │
│                    ▼                             ▼                   │
│         ┌─────────────────┐         ┌─────────────────────┐         │
│         │  单角色辅导模式   │         │  多角色协作模式       │         │
│         │  (Single Persona)│         │  (Multi-Agent)      │         │
│         │                  │         │                     │         │
│         │  Persona Router  │         │ Collaboration       │         │
│         │  → Persona A     │         │ Orchestrator        │         │
│         │  → System Prompt │         │ → Persona A + B     │         │
│         │  → LLM Call      │         │ → Inter-Agent Msg   │         │
│         │  → Response      │         │ → Multi-Turn Synth  │         │
│         └────────┬────────┘         └────────┬────────────┘         │
│                  │                            │                       │
│                  └────────────┬───────────────┘                     │
│                               ▼                                       │
│                    ┌─────────────────────┐                           │
│                    │  角色一致性管理器     │                           │
│                    │  (Persona Memory &  │                           │
│                    │   State Manager)    │                           │
│                    └─────────────────────┘                           │
│                               │                                       │
│                               ▼                                       │
│                    ┌─────────────────────┐                           │
│                    │  后处理 & 响应封装    │                           │
│                    │  (已有模块)          │                           │
│                    └─────────────────────┘                           │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件

| 组件 | 职责 | 部署形态 |
|------|------|---------|
| PersonaRegistry | 角色定义注册中心，存储所有可用角色配置 | 服务端 + Redis 缓存 |
| PersonaRouter | 角色路由决策器，根据上下文选择角色 | 服务端 |
| PersonaContextBuilder | 构建 System Prompt 和角色约束上下文 | 服务端 |
| CollaborationOrchestrator | 多角色协作编排器，管理 Agent 间交互流程 | 服务端 |
| PersonaMemoryManager | 角色记忆管理器，维护跨会话角色一致性 | 服务端 + Redis + DB |
| PersonaAdminService | 角色管理后台服务，CRUD + 预览 + 发布 | 服务端 + 管理后台 |

### 2.3 在全链路中的位置

```
[用户输入]
    │
    ▼
[1. 意图识别] ← 学习场景意图识别与智能路由引擎
    │
    ▼
[2. 安全过滤] ← AI输入安全与教育对话护栏引擎
    │
    ▼
[3. 角色路由] ← ★ 本引擎：PersonaRouter ★
    │    ├── 单角色 → 注入 Persona SystemPrompt → 继续 [4]
    │    └── 多角色 → 进入 CollaborationOrchestrator → 多轮 Agent 交互 → 合成最终回答
    │
    ▼
[4. 教学策略选择] ← AI教育辅导策略引擎
    │
    ▼
[5. Prompt 组装] ← AI-Prompt编排系统（此时 Prompt 中已包含角色设定）
    │
    ▼
[6. RAG 检索增强] ← RAG与知识库系统
    │
    ▼
[7. 模型调用] ← 多模型调度与成本治理
    │
    ▼
[8. 响应后处理] ← AI回答后处理与适龄化处理
    │
    ▼
[9. 返回用户]
```

---

## 3. 数据模型设计

### 3.1 角色定义表 `ai_persona`

```sql
CREATE TABLE `ai_persona` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    `persona_code` VARCHAR(64) NOT NULL COMMENT '角色编码，唯一标识，如 math_teacher_li',
    `name` VARCHAR(32) NOT NULL COMMENT '角色显示名称，如"李老师"',
    `avatar_url` VARCHAR(512) DEFAULT NULL COMMENT '角色头像URL',
    `intro` VARCHAR(256) DEFAULT NULL COMMENT '角色简介，一句话描述',
    `description` TEXT DEFAULT NULL COMMENT '角色详细描述，用于管理后台展示',

    -- 角色身份设定
    `identity_role` VARCHAR(32) NOT NULL DEFAULT 'teacher' COMMENT '身份角色：teacher/student/companion/expert/cartoon',
    `gender` VARCHAR(16) DEFAULT NULL COMMENT '性别设定：male/female/neutral',
    `age_appearance` VARCHAR(32) DEFAULT NULL COMMENT '外观年龄描述：如"30岁左右"、"永远12岁"',

    -- 适用范围
    `applicable_stages` JSON NOT NULL COMMENT '适用学段列表，如["primary","junior","senior"]',
    `applicable_subjects` JSON NOT NULL COMMENT '适用学科列表，如["math","physics"]',
    `applicable_scenarios` JSON NOT NULL COMMENT '适用场景列表，如["qa","homework","review"]',
    `is_default` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否为默认角色（每个学科+学段可配一个默认）',

    -- 角色性格与风格
    `personality_tags` JSON NOT NULL COMMENT '性格标签列表，如["patient","rigorous","humorous"]',
    `teaching_style` VARCHAR(64) NOT NULL COMMENT '教学风格：scaffolding/encouraging/rigorous/interactive/storytelling',
    `language_style` VARCHAR(64) NOT NULL COMMENT '语言风格：concise/warm/academic/playful/literary',
    `formality_level` TINYINT UNSIGNED NOT NULL DEFAULT 2 COMMENT '正式程度 1-5，1最口语化，5最书面化',
    `emoji_usage` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否使用emoji：0=不使用，1=适度使用，2=频繁使用',
    `response_length_pref` VARCHAR(16) NOT NULL DEFAULT 'medium' COMMENT '回复长度偏好：short/medium/long',

    -- System Prompt 核心设定
    `system_prompt_template` TEXT NOT NULL COMMENT '角色 System Prompt 模板，包含角色设定、行为约束、风格要求',
    `greeting_template` TEXT DEFAULT NULL COMMENT '打招呼模板',
    `encouragement_phrases` JSON DEFAULT NULL COMMENT '鼓励语料列表，如["你真棒！","这个思路很好！"]',
    `correction_phrases` JSON DEFAULT NULL COMMENT '纠错引导语料列表，如["这里再想想？","注意一下这个条件哦"]',

    -- 语音设定（用于 TTS）
    `tts_voice_id` VARCHAR(64) DEFAULT NULL COMMENT 'TTS 语音模型ID',
    `tts_speed` DECIMAL(3,1) DEFAULT 1.0 COMMENT 'TTS 语速',
    `tts_pitch` DECIMAL(3,1) DEFAULT 0.0 COMMENT 'TTS 音调偏移',

    -- 安全约束
    `safety_extra_rules` TEXT DEFAULT NULL COMMENT '角色专属安全规则（叠加在全局安全策略之上）',
    `forbidden_topics` JSON DEFAULT NULL COMMENT '角色禁止讨论的话题列表',

    -- 优先级与权重
    `priority_weight` INT NOT NULL DEFAULT 50 COMMENT '路由优先权重（0-100，越高越优先）',
    `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序序号',

    -- 状态管理
    `status` VARCHAR(16) NOT NULL DEFAULT 'draft' COMMENT '状态：draft/reviewing/published/offline',
    `version` INT NOT NULL DEFAULT 1 COMMENT '版本号',
    `published_version` INT DEFAULT NULL COMMENT '当前发布版本',

    -- 元数据
    `created_by` BIGINT UNSIGNED NOT NULL COMMENT '创建人（管理员ID）',
    `updated_by` BIGINT UNSIGNED NOT NULL COMMENT '最后更新人',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_persona_code` (`persona_code`),
    KEY `idx_subject_stage` (`applicable_subjects`(128), `applicable_stages`(128)),
    KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI教师角色定义表';
```

### 3.2 角色版本表 `ai_persona_version`

```sql
CREATE TABLE `ai_persona_version` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `persona_id` BIGINT UNSIGNED NOT NULL COMMENT '关联角色ID',
    `version` INT NOT NULL COMMENT '版本号',
    `snapshot_json` JSON NOT NULL COMMENT '该版本完整配置快照',
    `change_log` VARCHAR(512) DEFAULT NULL COMMENT '变更说明',
    `created_by` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_persona_version` (`persona_id`, `version`),
    KEY `idx_persona_id` (`persona_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色版本历史表';
```

### 3.3 角色偏好绑定表 `user_persona_preference`

```sql
CREATE TABLE `user_persona_preference` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
    `subject` VARCHAR(32) NOT NULL COMMENT '学科',
    `persona_id` BIGINT UNSIGNED NOT NULL COMMENT '用户偏好的角色ID',
    `is_pinned` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否用户手动固定',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_subject` (`user_id`, `subject`),
    KEY `idx_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户角色偏好表';
```

### 3.4 角色记忆表 `persona_memory`

```sql
CREATE TABLE `persona_memory` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
    `persona_id` BIGINT UNSIGNED NOT NULL COMMENT '角色ID',
    `memory_type` VARCHAR(32) NOT NULL COMMENT '记忆类型：fact/preference/interaction/emotion',
    `content` TEXT NOT NULL COMMENT '记忆内容',
    `importance_score` DECIMAL(4,3) DEFAULT 0.500 COMMENT '重要性评分 0-1',
    `last_accessed_at` DATETIME DEFAULT NULL COMMENT '最后访问时间',
    `expires_at` DATETIME DEFAULT NULL COMMENT '过期时间（NULL=不过期）',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    KEY `idx_user_persona` (`user_id`, `persona_id`),
    KEY `idx_memory_type` (`memory_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色跨会话记忆表';
```

### 3.5 多角色协作场景表 `collaboration_scenario`

```sql
CREATE TABLE `collaboration_scenario` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `scenario_code` VARCHAR(64) NOT NULL COMMENT '场景编码',
    `name` VARCHAR(128) NOT NULL COMMENT '场景名称',
    `description` TEXT DEFAULT NULL COMMENT '场景描述',
    `collaboration_mode` VARCHAR(32) NOT NULL COMMENT '协作模式：debate/roleplay/coteach/tutorial',
    `participant_personas` JSON NOT NULL COMMENT '参与角色配置列表',
    `interaction_protocol` JSON NOT NULL COMMENT '交互协议：轮次规则、发言顺序、中断条件',
    `max_turns` INT NOT NULL DEFAULT 6 COMMENT '最大交互轮次',
    `synthesis_strategy` VARCHAR(64) NOT NULL DEFAULT 'last_agent' COMMENT '最终回答合成策略',
    `applicable_scenarios` JSON NOT NULL COMMENT '适用场景',
    `status` VARCHAR(16) NOT NULL DEFAULT 'draft' COMMENT '状态',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_scenario_code` (`scenario_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='多角色协作场景定义表';
```

### 3.6 枚举与常量定义

```python
from enum import Enum

class IdentityRole(str, Enum):
    """角色身份类型"""
    TEACHER = "teacher"        # 教师
    STUDENT = "student"        # 学生（同伴角色）
    COMPANION = "companion"    # 陪伴角色（宠物/精灵）
    EXPERT = "expert"          # 专家/名人
    CARTOON = "cartoon"        # 卡通角色

class TeachingStyle(str, Enum):
    """教学风格"""
    SCAFFOLDING = "scaffolding"    # 脚手架式
    ENCOURAGING = "encouraging"    # 鼓励式
    RIGOROUS = "rigorous"          # 严谨式
    INTERACTIVE = "interactive"    # 互动式
    STORYTELLING = "storytelling"  # 故事式

class LanguageStyle(str, Enum):
    """语言风格"""
    CONCISE = "concise"      # 简洁
    WARM = "warm"            # 温暖
    ACADEMIC = "academic"    # 学术
    PLAYFUL = "playful"      # 活泼
    LITERARY = "literary"    # 文艺

class CollaborationMode(str, Enum):
    """多角色协作模式"""
    DEBATE = "debate"          # 辩论模式：两个角色从不同角度解题
    ROLEPLAY = "roleplay"      # 角色扮演：师生角色互换、同伴互助
    COTEACH = "coteach"        # 联合教学：两位老师分工讲解不同部分
    TUTORIAL = "tutorial"      # 导师模式：一个主讲一个补充

class CollaborationSynthesisStrategy(str, Enum):
    """多角色回答合成策略"""
    LAST_AGENT = "last_agent"        # 以最后发言角色的回答为准
    MERGE_BEST = "merge_best"        # 合并各角色最佳部分
    SUMMARIZE = "summarize"          # 用第三个角色（或旁白）总结
    SEQUENTIAL = "sequential"        # 按顺序拼接各角色发言（保留对话感）

class PersonaStatus(str, Enum):
    """角色状态"""
    DRAFT = "draft"
    REVIEWING = "reviewing"
    PUBLISHED = "published"
    OFFLINE = "offline"
```

---

## 4. 角色 System Prompt 构建

### 4.1 System Prompt 模板结构

角色 System Prompt 是注入到 LLM 调用最前置的指令，决定 AI 的身份意识和行为边界。

```python
PERSONA_SYSTEM_PROMPT_TEMPLATE = """## 你的身份

{identity_description}

## 你的性格特征

{personality_description}

## 你的教学方式

{teaching_style_description}

## 你的语言风格

{language_style_description}

## 你的学生

{student_context}

## 行为准则

{behavior_rules}

## 禁止事项

{forbidden_topics_description}

## 安全底线（不可突破）

1. 你是教育辅导角色，所有回答必须服务于学生的学习成长
2. 你绝对不能提供与学习无关的内容（暴力、色情、政治敏感等）
3. 你不能突破 {app_name} 的内容安全策略
4. 你不能脱离角色——永远以 {persona_name} 的身份回应
5. 当学生提问超出你的学科/学段范围时，友善引导转交其他老师或使用通用AI

## 当前对话上下文

{session_context}
"""
```

### 4.2 Prompt 组装器实现

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class PersonaContext:
    """角色上下文数据"""
    persona: 'Persona'                      # 角色定义
    student_profile: 'StudentProfile'        # 学生画像
    session_context: Optional[str] = None    # 会话上下文摘要
    persona_memories: Optional[list] = None  # 角色跨会话记忆

class PersonaPromptBuilder:
    """角色 System Prompt 构建器"""

    def __init__(self, app_name: str = "启硕 PrimeTop"):
        self.app_name = app_name

    def build_system_prompt(self, ctx: PersonaContext) -> str:
        """组装完整的角色 System Prompt"""
        p = ctx.persona

        # 身份描述
        identity = self._build_identity(p)
        # 性格描述
        personality = self._build_personality(p)
        # 教学方式描述
        teaching = self._build_teaching_style(p)
        # 语言风格描述
        language = self._build_language_style(p)
        # 学生上下文
        student = self._build_student_context(ctx.student_profile)
        # 行为准则
        rules = self._build_behavior_rules(p)
        # 禁止话题
        forbidden = self._build_forbidden(p)

        # 角色记忆（如果有）
        memories_str = ""
        if ctx.persona_memories:
            memories_str = self._format_memories(ctx.persona_memories)

        prompt = PERSONA_SYSTEM_PROMPT_TEMPLATE.format(
            identity_description=identity,
            personality_description=personality,
            teaching_style_description=teaching,
            language_style_description=language,
            student_context=student + ("\n\n" + memories_str if memories_str else ""),
            behavior_rules=rules,
            forbidden_topics_description=forbidden,
            app_name=self.app_name,
            persona_name=p.name,
            session_context=ctx.session_context or "（新对话开始）",
        )

        return prompt

    def _build_identity(self, persona) -> str:
        """构建身份描述"""
        parts = []
        parts.append(f"你是{persona.name}。")

        role_map = {
            "teacher": "一名",
            "student": "一名",
            "companion": "一个",
            "expert": "一位",
            "cartoon": "一个",
        }
        prefix = role_map.get(persona.identity_role, "一位")

        if persona.identity_role == "teacher":
            subjects = "、".join(persona.applicable_subjects)
            stages = self._format_stages(persona.applicable_stages)
            parts.append(f"你是{prefix}{stages}{subjects}老师。")
        elif persona.identity_role == "student":
            parts.append(f"你是{prefix}和用户同龄的同学，擅长{ '、'.join(persona.applicable_subjects)}。")
        elif persona.identity_role == "companion":
            parts.append(f"你是{prefix}陪伴学习的{persona.age_appearance or '小伙伴'}。")

        if persona.intro:
            parts.append(persona.intro)

        return "\n".join(parts)

    def _build_personality(self, persona) -> str:
        """构建性格描述"""
        tag_map = {
            "patient": "你非常有耐心，学生听不懂时你会换不同方式反复讲解，从不急躁。",
            "rigorous": "你非常严谨，每个步骤都要确认逻辑严密，不允许跳步或含糊。",
            "humorous": "你幽默风趣，经常用有趣的比喻和笑话帮助学生记住知识点。",
            "gentle": "你温柔和蔼，总是用鼓励的语气和学生交流。",
            "energetic": "你充满活力，回答时热情洋溢，能带动学生的学习积极性。",
            "calm": "你沉稳冷静，即使学生犯低级错误也不会表现出不耐烦。",
            "creative": "你富有创意，经常用新颖的角度和跨学科的联想来讲解。",
        }
        parts = []
        for tag in persona.personality_tags:
            if tag in tag_map:
                parts.append(tag_map[tag])
        return "\n".join(parts) if parts else "保持自然友善的态度。"

    def _build_teaching_style(self, persona) -> str:
        """构建教学方式描述"""
        style_map = {
            "scaffolding": "采用脚手架式教学：先提供框架和提示，引导学生自己思考，逐步减少帮助。",
            "encouraging": "采用鼓励式教学：优先肯定学生的正确思路，再指出可以改进的地方。",
            "rigorous": "采用严谨教学：每一步推导都明确标注依据，强调规范性。",
            "interactive": "采用互动式教学：经常向学生提问，让学生参与推理过程。",
            "storytelling": "采用故事化教学：用叙事和场景化案例包装知识点。",
        }
        return style_map.get(persona.teaching_style, style_map["encouraging"])

    def _build_language_style(self, persona) -> str:
        """构建语言风格描述"""
        style_map = {
            "concise": "语言简洁明了，不啰嗦，直击要点。每段不超过3-4句话。",
            "warm": "语言温暖亲切，多用"我们"而不是"你"，让学生感觉被支持。",
            "academic": "语言规范学术，使用准确的学科术语，但会解释专业概念。",
            "playful": "语言活泼有趣，可以使用emoji和语气词，适合低龄学生。",
            "literary": "语言优美有文采，适合语文/文科场景，注意措辞典雅。",
        }
        parts = [style_map.get(persona.language_style, style_map["concise"])]

        # 正式程度
        formality_map = {
            1: "使用非常口语化的表达，像朋友聊天一样。",
            2: "语言偏口语化，偶尔使用书面语。",
            3: "口语和书面语均衡。",
            4: "语言偏书面化，使用规范的学科用语。",
            5: "使用高度规范的书面语，接近教材风格。",
        }
        parts.append(formality_map.get(persona.formality_level, formality_map[3]))

        # emoji 使用
        if persona.emoji_usage == 1:
            parts.append("可以适度使用emoji（每条回复1-3个）。")
        elif persona.emoji_usage == 2:
            parts.append("可以频繁使用emoji来增强表达效果。")

        # 回复长度
        length_map = {
            "short": "尽量简短回答，除非学生要求详细展开。",
            "medium": "回答长度适中，保证清晰但不冗长。",
            "long": "可以详细展开讲解，确保学生完全理解。",
        }
        parts.append(length_map.get(persona.response_length_pref, length_map["medium"]))

        return "\n".join(parts)

    def _build_student_context(self, profile) -> str:
        """构建学生上下文"""
        parts = [
            f"当前学生：{profile.nickname}",
            f"学段：{profile.stage_name}",
            f"年级：{profile.grade_name}",
            f"教材版本：{profile.textbook_version}",
        ]
        if profile.known_weak_points:
            parts.append(f"已知薄弱点：{', '.join(profile.known_weak_points)}")
        if profile.learning_style_preference:
            parts.append(f"学习偏好：{profile.learning_style_preference}")
        return "\n".join(parts)

    def _build_behavior_rules(self, persona) -> str:
        """构建行为准则"""
        rules = [
            "1. 始终以角色身份回应，不暴露AI身份，不说"作为一个AI"",
            "2. 回答必须围绕学习内容，礼貌拒绝非学习类请求",
            "3. 优先引导学生思考，而非直接给出答案",
            "4. 根据学生反应灵活调整讲解方式",
            "5. 对学生的每个进步给予肯定",
        ]
        # 角色专属规则
        if persona.identity_role == "student":
            rules.append("6. 你以"同学"的身份分享解题思路，用"我觉得""我的想法是"等表达")
            rules.append("7. 偶尔可以犯小错然后自我纠正，展示思考过程")
        elif persona.identity_role == "companion":
            rules.append("6. 语言要非常简单，适合低龄儿童理解")
            rules.append("7. 多用感叹和鼓励，营造积极氛围")

        return "\n".join(rules)

    def _build_forbidden(self, persona) -> str:
        """构建禁止事项"""
        items = ["直接给出考试答案让学生抄写", "布置超出学生学段的超纲内容"]
        if persona.forbidden_topics:
            items.extend(persona.forbidden_topics)
        items.append("使用与角色性格不符的语言风格")
        return "\n".join(f"- {item}" for item in items)

    def _format_memories(self, memories: list) -> str:
        """格式化角色记忆"""
        lines = ["## 你对这个学生的了解（跨会话记忆）"]
        for m in memories[:10]:  # 最多注入10条记忆
            lines.append(f"- {m['content']}")
        return "\n".join(lines)

    def _format_stages(self, stages: list) -> str:
        stage_map = {
            "kindergarten": "幼儿园",
            "primary": "小学",
            "junior": "初中",
            "senior": "高中",
        }
        return "、".join(stage_map.get(s, s) for s in stages)
```

---

## 5. 角色路由决策器

### 5.1 路由决策流程

角色路由器（PersonaRouter）在意图识别之后、Prompt 组装之前执行，决定本次对话使用哪个角色。

```
输入：user_id, subject, stage, scenario, intent, conversation_history
输出：persona_id（或 persona_id 列表，多角色场景）

决策优先级（从高到低）：
1. 用户手动固定偏好（is_pinned=true）
2. 当前会话已有角色（会话内一致性）
3. 科目+学段+场景精确匹配的默认角色
4. 科目+学段匹配的默认角色
5. 全局默认角色
```

### 5.2 路由器实现

```python
from typing import Optional
import json

class PersonaRouter:
    """角色路由决策器"""

    def __init__(self, redis_client, db_session):
        self.redis = redis_client
        self.db = db_session
        self.cache_ttl = 300  # 缓存5分钟

    async def route(
        self,
        user_id: int,
        subject: str,
        stage: str,
        scenario: str,
        intent: str,
        conversation_id: Optional[str] = None,
    ) -> int:
        """
        路由到最合适的角色ID

        Args:
            user_id: 用户ID
            subject: 学科 (math/chinese/english/...)
            stage: 学段 (kindergarten/primary/junior/senior)
            scenario: 场景 (qa/homework/review/exam/...)
            intent: 意图 (solve/explain/practice/...)
            conversation_id: 会话ID（用于会话内一致性）

        Returns:
            persona_id: 角色ID
        """
        # 1. 检查会话内一致性
        if conversation_id:
            session_persona = await self._get_session_persona(conversation_id)
            if session_persona:
                return session_persona

        # 2. 检查用户手动固定偏好
        pinned = await self._get_pinned_preference(user_id, subject)
        if pinned:
            return pinned

        # 3. 精确匹配：科目+学段+场景
        exact = await self._find_persona(subject, stage, scenario)
        if exact:
            return exact

        # 4. 宽松匹配：科目+学段
        broad = await self._find_persona(subject, stage, None)
        if broad:
            return broad

        # 5. 全局默认
        return await self._get_global_default()

    async def route_multi(
        self,
        user_id: int,
        subject: str,
        stage: str,
        scenario: str,
        collaboration_mode: str,
    ) -> list:
        """
        多角色路由：为协作场景选择多个角色
        """
        # 获取所有适用的角色
        candidates = await self._find_personas_batch(subject, stage)

        if collaboration_mode == "debate":
            # 辩论模式：选择两个教学风格差异最大的角色
            return self._select_diverse_pair(candidates)
        elif collaboration_mode == "roleplay":
            # 角色扮演：选择一个teacher + 一个student角色
            teacher = [p for p in candidates if p.identity_role == "teacher"]
            student = [p for p in candidates if p.identity_role == "student"]
            return [teacher[0].id, student[0].id] if teacher and student else [candidates[0].id]
        elif collaboration_mode == "coteach":
            # 联合教学：选择两个不同专长的老师
            return self._select_complementary_pair(candidates)

        return [candidates[0].id] if candidates else [await self._get_global_default()]

    async def _get_session_persona(self, conversation_id: str) -> Optional[int]:
        """获取会话内已绑定的角色"""
        key = f"persona:session:{conversation_id}"
        return await self.redis.get(key)

    async def _set_session_persona(self, conversation_id: str, persona_id: int):
        """绑定会话角色"""
        key = f"persona:session:{conversation_id}"
        await self.redis.setex(key, self.cache_ttl, persona_id)

    async def _get_pinned_preference(self, user_id: int, subject: str) -> Optional[int]:
        """获取用户固定偏好"""
        key = f"persona:pinned:{user_id}:{subject}"
        cached = await self.redis.get(key)
        if cached:
            return int(cached)

        # 查数据库
        result = await self.db.execute(
            "SELECT persona_id FROM user_persona_preference "
            "WHERE user_id = :uid AND subject = :subj AND is_pinned = 1",
            {"uid": user_id, "subj": subject},
        )
        row = result.fetchone()
        if row:
            await self.redis.setex(key, self.cache_ttl, row[0])
            return row[0]
        return None

    async def _find_persona(
        self, subject: str, stage: str, scenario: Optional[str]
    ) -> Optional[int]:
        """从缓存中查找匹配的角色"""
        cache_key = f"persona:registry:published"
        registry_raw = await self.redis.get(cache_key)
        if not registry_raw:
            await self._refresh_registry_cache()
            registry_raw = await self.redis.get(cache_key)

        registry = json.loads(registry_raw)
        candidates = []

        for persona in registry:
            if persona["status"] != "published":
                continue
            if subject not in persona["applicable_subjects"]:
                continue
            if stage not in persona["applicable_stages"]:
                continue
            if scenario and scenario not in persona["applicable_scenarios"]:
                continue
            candidates.append(persona)

        if not candidates:
            return None

        # 优先返回 is_default=true 的，其次 priority_weight 最高的
        candidates.sort(
            key=lambda p: (p.get("is_default", 0), p["priority_weight"]),
            reverse=True,
        )
        return candidates[0]["id"]

    async def _refresh_registry_cache(self):
        """刷新角色注册中心缓存"""
        result = await self.db.execute(
            "SELECT * FROM ai_persona WHERE status = 'published'"
        )
        rows = result.fetchall()
        registry = []
        for row in rows:
            # 转换为 dict（简化示例，实际用 dataclass 或 ORM）
            registry.append(dict(row))
        await self.redis.setex(
            "persona:registry:published",
            300,
            json.dumps(registry, ensure_ascii=False),
        )

    async def _get_global_default(self) -> int:
        """获取全局默认角色ID"""
        result = await self.db.execute(
            "SELECT id FROM ai_persona "
            "WHERE status = 'published' AND persona_code = 'default_assistant' "
            "LIMIT 1"
        )
        row = result.fetchone()
        return row[0] if row else 1  # fallback to ID=1

    def _select_diverse_pair(self, candidates: list) -> list:
        """选择风格差异最大的两个角色"""
        if len(candidates) < 2:
            return [candidates[0]["id"]] if candidates else []
        # 简化：选 teaching_style 不同的
        by_style = {}
        for c in candidates:
            style = c.get("teaching_style", "")
            if style not in by_style:
                by_style[style] = c
        if len(by_style) >= 2:
            import random
            chosen = random.sample(list(by_style.values()), 2)
            return [chosen[0]["id"], chosen[1]["id"]]
        return [candidates[0]["id"], candidates[1]["id"]]

    def _select_complementary_pair(self, candidates: list) -> list:
        """选择专长互补的两个角色"""
        if len(candidates) < 2:
            return [candidates[0]["id"]] if candidates else []
        return [candidates[0]["id"], candidates[-1]["id"]]
```

---

## 6. 多角色协作编排器

### 6.1 协作模式详细设计

#### 6.1.1 辩论模式（Debate）

两个角色从不同角度分析同一道题，展示多元思维。

```
用户提问："这道物理题怎么解？"
         │
         ▼
┌─────────────────────────────────────────┐
│  CollaborationOrchestrator              │
│                                         │
│  Step 1: Persona A (李老师-严谨派)      │
│  → 用公式推导法分析                      │
│  → 输出推理过程                          │
│                                         │
│  Step 2: Persona B (王老师-直觉派)      │
│  → 看到A的回答                           │
│  → 用能量守恒直觉法分析                  │
│  → 指出两种方法殊途同归                  │
│                                         │
│  Step 3: Synthesis (合成)               │
│  → 将两位老师的讨论整合为学习卡片         │
└─────────────────────────────────────────┘
         │
         ▼
用户看到：李老师和王老师的"课堂讨论"式回答
```

#### 6.1.2 角色扮演模式（Roleplay）

学生角色和老师角色互换，让学生通过