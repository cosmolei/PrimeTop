# 服务端 - AI角色扮演沉浸式情景教学与历史文学角色对话引擎 详细设计

## 1. 概述

### 1.1 功能定位

AI角色扮演沉浸式情景教学引擎是 PrimeTop 平台的核心差异化能力之一。该引擎允许 AI 大模型"化身"为历史人物、文学角色、科学巨匠等具体角色，与学生进行沉浸式对话互动，在角色设定的场景中完成知识点传递、思维启发和学习引导。

**与现有模块的区别：**
- 与 `AI多角色辅导智能体` 的区别：多角色辅导是多个 AI Agent 协作教学；本引擎是单个 AI 化身为特定真实/虚构人物进行角色扮演。
- 与 `学生AI学习伙伴角色个性化` 的区别：学习伙伴是长期陪伴的虚拟形象；本引擎是按教学场景临时切换的角色扮演。
- 与 `英语口语情景对话编排` 的区别：英语情景对话聚焦语言训练；本引擎聚焦跨学科知识沉浸式体验。

### 1.2 核心价值

| 价值维度 | 说明 |
|---------|------|
| 沉浸感 | 学生在与"李白"对饮论诗、"爱因斯坦"探讨相对论的过程中自然吸收知识 |
| 情感连接 | 角色代入激发学习兴趣，尤其对低龄/文科/历史/文学场景效果显著 |
| 知识锚点 | 角色的生平、成就、时代背景本身就是结构化知识体系 |
| 跨学科融合 | 一个角色可串联历史、语文、科学、哲学等多学科内容 |

### 1.3 适用学段与学科

| 学段 | 典型角色示例 | 学科场景 |
|------|-------------|---------|
| 小学 | 孔子、李白、牛顿、爱迪生 | 语文古诗、科学常识、历史故事 |
| 初中 | 鲁迅、达尔文、居里夫人、秦始皇 | 文学鉴赏、生物进化、物理发现、历史事件 |
| 高中 | 苏格拉底、莎士比亚、麦克斯韦、司马迁 | 哲学思辨、英语文学、电磁学、史学方法 |

### 1.4 术语定义

| 术语 | 定义 |
|------|------|
| 角色卡 (CharacterCard) | 一个可扮演角色的完整定义，包括身份、时代、知识范围、性格、语言风格 |
| 剧本 (Scenario) | 一段预设的互动教学场景，包含场景设定、教学目标、分支节点 |
| 角色会话 (RoleplaySession) | 学生与角色之间的一次完整对话会话 |
| 出戏检测 (OOC Detection) | 识别 AI 偏离角色设定、出现现代知识泄露或不符合角色时代认知的内容 |
| 知识注入 (Knowledge Injection) | 在角色对话中自然嵌入教学知识点的方式 |

---

## 2. 系统架构

### 2.1 整体架构

```text
┌──────────────────────────────────────────────────────────┐
│                   客户端 / BFF 层                         │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────┐    │
│  │ 角色选择页  │  │ 对话交互页  │  │ 剧情回顾/知识卡 │    │
│  └─────┬──────┘  └─────┬──────┘  └───────┬─────────┘    │
└────────┼───────────────┼─────────────────┼──────────────┘
         │               │                 │
┌────────▼───────────────▼─────────────────▼──────────────┐
│              API 网关 / 鉴权 / 限流                       │
└────────┬───────────────┬─────────────────┬──────────────┘
         │               │                 │
┌────────▼───────────────▼─────────────────▼──────────────┐
│           角色扮演引擎 (RoleplayEngine)                   │
│                                                          │
│  ┌──────────┐  ┌────────────┐  ┌──────────────────────┐ │
│  │角色卡管理 │  │剧本调度服务 │  │Prompt动态组装服务     │ │
│  │Service   │  │Service     │  │Service               │ │
│  └────┬─────┘  └─────┬──────┘  └──────────┬───────────┘ │
│       │              │                    │             │
│  ┌────▼──────────────▼────────────────────▼───────────┐ │
│  │           对话编排与安全控制层                       │ │
│  │  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌────────┐  │ │
│  │  │出戏检测 │ │知识注入器│ │安全过滤 │ │状态机  │  │ │
│  │  └─────────┘ └──────────┘ └─────────┘ └────────┘  │ │
│  └────────────────────┬───────────────────────────────┘ │
│                       │                                 │
│  ┌────────────────────▼───────────────────────────────┐ │
│  │           底层依赖服务                               │ │
│  │  大模型API │ RAG检索 │ 向量DB │ 知识图谱 │ 内容安全  │ │
│  └────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 2.2 核心服务划分

| 服务 | 职责 | 部署方式 |
|------|------|---------|
| CharacterCardService | 角色卡CRUD、版本管理、质量评级 | 独立服务 |
| ScenarioService | 剧本管理、场景调度、分支选择 | 独立服务 |
| RoleplaySessionService | 会话生命周期管理、状态流转 | 独立服务 |
| PromptAssemblyService | 动态组装角色扮演Prompt | 独立服务 |
| OOCDetector | 出戏检测与纠偏 | 同步调用(中间件) |
| KnowledgeInjector | 知识点检索与自然嵌入 | 异步预处理+同步注入 |
| RoleplaySafetyFilter | 角色+教育双层安全过滤 | 同步调用(中间件) |

---

## 3. 数据结构设计

### 3.1 角色卡表 `rp_character_cards`

```sql
CREATE TABLE rp_character_cards (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    character_code  VARCHAR(64) NOT NULL UNIQUE COMMENT '角色唯一编码，如 LI_BAI',
    name            VARCHAR(128) NOT NULL COMMENT '角色名称',
    name_en         VARCHAR(128) COMMENT '英文名',
    avatar_url      VARCHAR(512) COMMENT '角色头像URL',
    intro           VARCHAR(1024) COMMENT '一句话简介',
    identity        JSON NOT NULL COMMENT '身份定义JSON',
    min_grade_level TINYINT NOT NULL DEFAULT 1 COMMENT '最低适用年级',
    max_grade_level TINYINT NOT NULL DEFAULT 12 COMMENT '最高适用年级',
    subjects        JSON NOT NULL COMMENT '关联学科列表',
    era             VARCHAR(64) COMMENT '时代标识',
    personality     JSON NOT NULL COMMENT '性格特征',
    speech_style    JSON NOT NULL COMMENT '语言风格',
    knowledge_scope JSON NOT NULL COMMENT '角色知识范围',
    taboos          JSON COMMENT '角色禁忌（不该知道的内容）',
    status          TINYINT NOT NULL DEFAULT 0 COMMENT '0=草稿 1=审核中 2=上线 3=下线',
    quality_score   DECIMAL(3,2) DEFAULT 0 COMMENT '质量评分',
    usage_count     INT DEFAULT 0 COMMENT '被使用次数',
    avg_rating      DECIMAL(3,2) DEFAULT 0 COMMENT '用户平均评分',
    version         INT NOT NULL DEFAULT 1 COMMENT '版本号',
    version_notes   VARCHAR(512) COMMENT '版本说明',
    created_by      BIGINT COMMENT '创建者ID',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status_subject (status, subjects(64)),
    INDEX idx_era (era),
    INDEX idx_grade (min_grade_level, max_grade_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色卡定义表';
```

**identity JSON 结构示例：**

```json
{
  "realPerson": true,
  "birthYear": 701,
  "deathYear": 762,
  "dynasty": "唐",
  "occupation": ["诗人", "剑客"],
  "famousWorks": ["将进酒", "静夜思", "蜀道难"],
  "keyAchievements": ["浪漫主义诗歌巅峰", "被尊为诗仙"],
  "historicalContext": "盛唐时期，国力强盛，文化开放包容"
}
```

**personality JSON 结构示例：**

```json
{
  "traits": ["豪放", "浪漫", "嗜酒", "重情义", "自信"],
  "values": ["自由", "友情", "才华", "自然之美"],
  "emotionalBaseline": "热情开朗，偶有怀才不遇的惆怅",
  "humorStyle": "豪迈自嘲，以酒喻人生",
  "interactionStyle": "平等交流，不端架子，喜欢以诗会友"
}
```

**speech_style JSON 结构示例：**

```json
{
  "tone": "豪迈奔放",
  "vocabulary": "半文半白，多用诗词典故",
  "sentencePattern": "短句为主，节奏感强，常以感叹句收尾",
  "catchphrases": ["且乐生前一杯酒", "天生我材必有用"],
  "languageLevel": "适当年级的半文言表达",
  "forbiddenModernTerms": ["手机", "网络", "AI", "大数据"],
  "exampleDialogues": [
    {
      "user": "李白先生，您怎么看待挫折？",
      "character": "哈哈！挫折？人生在世不如意十之八九。你看黄河之水天上来，奔流到海不复回。挫折算什么？且饮一杯，再写一首便是！"
    }
  ]
}
```

**knowledge_scope JSON 结构示例：**

```json
{
  "expertAreas": [
    {"subject": "chinese", "topic": "唐诗鉴赏", "depth": "expert"},
    {"subject": "history", "topic": "唐朝历史文化", "depth": "expert"}
  ],
  "generalAreas": [
    {"subject": "chinese", "topic": "古文阅读与写作", "depth": "advanced"}
  ],
  "ignorantAreas": [
    "现代科技与互联网",
    "近现代历史事件",
    "任何角色死后时代的内容"
  ]
}
```

### 3.2 剧本表 `rp_scenarios`

```sql
CREATE TABLE rp_scenarios (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    scenario_code   VARCHAR(64) NOT NULL UNIQUE COMMENT '剧本编码',
    title           VARCHAR(128) NOT NULL COMMENT '剧本标题',
    description     TEXT COMMENT '剧本描述',
    character_id    BIGINT NOT NULL COMMENT '关联角色卡ID',
    learning_objectives JSON NOT NULL COMMENT '学习目标列表',
    target_subjects    JSON NOT NULL COMMENT '目标学科',
    target_knowledge_points JSON NOT NULL COMMENT '目标知识点ID列表',
    opening         TEXT NOT NULL COMMENT '开场白（角色第一段话）',
    scene_setting   JSON NOT NULL COMMENT '场景设定',
    branches        JSON COMMENT '分支节点定义（树形结构）',
    has_branches    TINYINT DEFAULT 0 COMMENT '0=线性 1=分支',
    difficulty      TINYINT DEFAULT 2 COMMENT '难度1-5',
    est_duration_min INT DEFAULT 15 COMMENT '预计时长（分钟）',
    min_grade_level TINYINT NOT NULL,
    max_grade_level TINYINT NOT NULL,
    status          TINYINT NOT NULL DEFAULT 0 COMMENT '0=草稿 1=审核中 2=上线 3=下线',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (character_id) REFERENCES rp_character_cards(id),
    INDEX idx_character (character_id),
    INDEX idx_status_grade (status, min_grade_level, max_grade_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色扮演剧本表';
```

**branches JSON 结构示例（分支剧本）：**

```json
{
  "rootNodeId": "node_1",
  "nodes": {
    "node_1": {
      "type": "dialogue",
      "characterLine": "小友，你可知我为何今夜独饮？",
      "knowledgePoint": "天宝三年李白离京",
      "nextOnTopic": "node_2a",
      "nextOffTopic": "node_2b"
    },
    "node_2a": {
      "type": "dialogue",
      "characterLine": "你倒直接。你可知'天生我材必有用'背后的故事？",
      "knowledgePoint": "将进酒创作背景",
      "nextOnTopic": "node_3"
    },
    "node_3": {
      "type": "checkpoint",
      "knowledgeRecall": "你能背出《将进酒》的前两句吗？",
      "knowledgePoint": "将进酒诗文背诵",
      "successNext": "node_4",
      "hintNext": "node_3_hint"
    },
    "node_4": {
      "type": "ending",
      "characterLine": "好！这壶酒便敬你的好记性。记住，无论何境，都要信'天生我材必有用'！",
      "rewardXP": 50
    }
  }
}
```

### 3.3 会话表 `rp_sessions`

```sql
CREATE TABLE rp_sessions (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    session_code    VARCHAR(64) NOT NULL UNIQUE COMMENT '会话唯一编码',
    user_id         BIGINT NOT NULL COMMENT '学生用户ID',
    character_id    BIGINT NOT NULL COMMENT '角色卡ID',
    scenario_id     BIGINT COMMENT '剧本ID（若使用预设剧本）',
    status          VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE/PAUSED/COMPLETED/ABANDONED',
    current_node_id VARCHAR(64) COMMENT '当前分支节点',
    context_summary JSON COMMENT '压缩后的会话上下文摘要',
    turn_count      INT DEFAULT 0 COMMENT '对话轮次',
    token_used      INT DEFAULT 0 COMMENT '累计Token消耗',
    knowledge_points_covered JSON COMMENT '已覆盖知识点列表',
    objective_progress JSON COMMENT '学习目标完成进度',
    ooc_count       INT DEFAULT 0 COMMENT '出戏次数',
    safety_block_count INT DEFAULT 0 COMMENT '安全拦截次数',
    user_rating     TINYINT COMMENT '用户评分1-5',
    user_feedback   VARCHAR(512) COMMENT '用户反馈',
    started_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_active_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at    DATETIME,
    FOREIGN KEY (character_id) REFERENCES rp_character_cards(id),
    FOREIGN KEY (scenario_id) REFERENCES rp_scenarios(id),
    INDEX idx_user_status (user_id, status),
    INDEX idx_active (user_id, status, last_active_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色扮演会话表';
```

### 3.4 对话消息表 `rp_messages`

```sql
CREATE TABLE rp_messages (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    session_id      BIGINT NOT NULL COMMENT '会话ID',
    turn_index      INT NOT NULL COMMENT '轮次序号',
    role            VARCHAR(16) NOT NULL COMMENT 'STUDENT/CHARACTER/SYSTEM',
    content         MEDIUMTEXT NOT NULL COMMENT '消息内容',
    content_type    VARCHAR(32) DEFAULT 'TEXT' COMMENT 'TEXT/IMAGE/VOICE/KNOWLEDGE_CARD',
    metadata        JSON COMMENT '附加元数据',
    model_used      VARCHAR(64) COMMENT '使用的模型',
    prompt_tokens   INT DEFAULT 0,
    completion_tokens INT DEFAULT 0,
    latency_ms      INT COMMENT '响应延迟',
    safety_flags    JSON COMMENT '安全标记',
    ooc_flag        TINYINT DEFAULT 0 COMMENT '是否出戏',
    ooc_corrected   TINYINT DEFAULT 0 COMMENT '是否已纠偏',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES rp_sessions(id),
    INDEX idx_session_turn (session_id, turn_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色扮演对话消息表';
```

### 3.5 角色-知识点映射表 `rp_knowledge_mappings`

```sql
CREATE TABLE rp_knowledge_mappings (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    character_id    BIGINT NOT NULL COMMENT '角色卡ID',
    knowledge_point_id BIGINT NOT NULL COMMENT '知识点ID（关联主知识库）',
    relation_type   VARCHAR(32) NOT NULL COMMENT 'EXPERT/FAMILIAR/MENTION/CONTROVERSIAL',
    weight          DECIMAL(3,2) DEFAULT 1.0 COMMENT '关联权重',
    typical_context VARCHAR(256) COMMENT '典型语境',
    sample_dialogue TEXT COMMENT '示例对话片段',
    FOREIGN KEY (character_id) REFERENCES rp_character_cards(id),
    INDEX idx_character_kp (character_id, knowledge_point_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色-知识点映射表';
```

---

## 4. API 接口设计

### 4.1 角色卡管理

#### 4.1.1 获取角色列表

```
GET /api/v1/roleplay/characters?subject=chinese&gradeLevel=8&sort=popular&page=1&size=20
```

**Response:**

```json
{
  "code": 0,
  "data": {
    "total": 128,
    "page": 1,
    "size": 20,
    "items": [{
      "id": 1,
      "characterCode": "LI_BAI",
      "name": "李白",
      "avatarUrl": "https://cdn.primetop.com/roleplay/avatars/libai.png",
      "intro": "盛唐诗仙，浪漫主义诗歌的巅峰代表",
      "subjects": ["chinese", "history"],
      "era": "TANG_DYNASTY",
      "avgRating": 4.85,
      "usageCount": 12800
    }]
  }
}
```

#### 4.1.2 获取角色详情

```
GET /api/v1/roleplay/characters/{characterId}
```

### 4.2 会话管理

#### 4.2.1 创建角色扮演会话

```
POST /api/v1/roleplay/sessions
```

**Request:**

```json
{
  "characterId": 1,
  "scenarioId": 101,
  "mode": "SCENARIO"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| characterId | long | 角色卡ID（必填） |
| scenarioId | long | 剧本ID（剧本模式必填） |
| mode | string | SCENARIO=剧本模式 / FREE=自由对话 |
| customTopic | string | 自由模式下的自定义话题 |

**Response:**

```json
{
  "code": 0,
  "data": {
    "sessionCode": "RP_20260731_220000_001",
    "sessionId": 50001,
    "character": {
      "id": 1,
      "name": "李白",
      "avatarUrl": "https://cdn.primetop.com/roleplay/avatars/libai.png"
    },
    "openingMessage": {
      "turnIndex": 0,
      "role": "CHARACTER",
      "content": "（推门而入，大笑）哈哈哈！今夜月色正好，长安城里又多了个来寻诗酒之乐的年轻人！来来来，坐下，先饮此杯——以茶代酒亦可。告诉我，你慕名而来，还是偶然路过？"
    },
    "scenarioInfo": {
      "title": "长安酒肆论诗",
      "objectives": ["理解李白被赐金放还的历史背景", "学习《将进酒》的创作心境"],
      "difficulty": 2,
      "estDurationMin": 15
    }
  }
}
```

#### 4.2.2 发送消息（SSE 流式）

```
POST /api/v1/roleplay/sessions/{sessionId}/messages
Content-Type: application/json
Accept: text/event-stream
```

**Request:**

```json
{
  "content": "李白先生，我最近考试没考好，心情很沮丧",
  "contentType": "TEXT"
}
```

**SSE Response:**

```text
event: meta
data: {"turnIndex":3,"modelUsed":"gpt-4o"}

event: delta
data: {"content":"（放下酒杯"}

event: delta
data: {"content":"，认真看着你）"}

event: delta
data: {"content":"\n\n考试？你们这个年代的考试"}

event: delta
data: {"content":"，和科举倒是有几分相似。"}

event: delta
data: {"content":"\n\n你知道吗，当年我也曾多次应试不第。"}

event: knowledge_card
data: {"kpId":1024,"title":"李白科举之路","content":"李白未曾通过科举..."}

event: done
data: {"turnIndex":3,"totalTokens":285,"latencyMs":1820}
```

#### 4.2.3 获取会话历史

```
GET /api/v1/roleplay/sessions/{sessionId}/messages?page=1&size=50
```

#### 4.2.4 结束会话并获取学习总结

```
POST /api/v1/roleplay/sessions/{sessionId}/complete
```

**Response:**

```json
{
  "code": 0,
  "data": {
    "sessionSummary": {
      "duration": "18分钟",
      "turns": 12,
      "character": "李白",
      "scenarioTitle": "长安酒肆论诗"
    },
    "knowledgePointsLearned": [
      {"kpId": 1024, "name": "李白被赐金放还", "mastery": 0.85},
      {"kpId": 1025, "name": "《将进酒》创作背景", "mastery": 0.72}
    ],
    "objectivesCompleted": [true, true],
    "rewardXP": 50,
    "characterFeedback": "小友今日与我论诗甚欢！你对诗词的悟性不错，但《将进酒》还需多读几遍。下次再来找我喝酒论诗吧！",
    "recommendedNext": [
      {"characterId": 2, "name": "杜甫", "reason": "了解李白与杜甫的友谊"},
      {"scenarioId": 103, "title": "庐山瀑布前", "reason": "学习《望庐山瀑布》"}
    ]
  }
}
```

#### 4.2.5 会话快捷操作

```
POST /api/v1/roleplay/sessions/{sessionId}/actions
```

| action | 说明 |
|--------|------|
| PAUSE | 暂停会话（保留上下文） |
| RESUME | 恢复会话 |
| RESTART | 重新开始当前剧本 |
| SWITCH_SCENARIO | 切换到新剧本（保持角色） |
| RATE | 评价会话 |

### 4.3 管理后台 API

#### 4.3.1 创建/编辑角色卡

```
POST /api/v1/admin/roleplay/characters
PUT  /api/v1/admin/roleplay/characters/{characterId}
```

#### 4.3.2 创建/编辑剧本

```
POST /api/v1/admin/roleplay/scenarios
PUT  /api/v1/admin/roleplay/scenarios/{scenarioId}
```

#### 4.3.3 角色卡测试模拟

```
POST /api/v1/admin/roleplay/characters/{characterId}/test
```

允许管理员在发布前测试角色对话效果。

---

## 5. Prompt 动态组装

### 5.1 Prompt 模板架构

角色扮演的 Prompt 不是一段静态文本，而是由多个模块动态拼装而成。

```text
┌─────────────────────────────────────────────┐
│              System Prompt                  │
│                                             │
│  ┌─────────────────────────────────────────┐│
│  │ 1. 全局安全与行为准则       (Safety)     ││
│  └─────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────┐│
│  │ 2. 角色身份定义            (Identity)    ││
│  └─────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────┐│
│  │ 3. 角色性格与语言风格       (Persona)    ││
│  └─────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────┐│
│  │ 4. 角色知识边界与禁忌       (Boundary)   ││
│  └─────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────┐│
│  │ 5. 教学目标与知识注入       (Pedagogy)   ││
│  └─────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────┐│
│  │ 6. 场景设定               (Scene)       ││
│  └─────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────┐│
│  │ 7. 适龄化表达适配          (Adaptation)  ││
│  └─────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────┐│
│  │ 8. RAG检索增强上下文       (Knowledge)   ││
│  └─────────────────────────────────────────┘│
│                                             │
├─────────────────────────────────────────────┤
│             Conversation History            │
│            (压缩后的多轮上下文)               │
├─────────────────────────────────────────────┤
│              User Message                   │
└─────────────────────────────────────────────┘
```

### 5.2 System Prompt 组装代码

```python
class RoleplayPromptBuilder:
    """角色扮演 Prompt 动态组装器"""
    
    SAFETY_PREAMBLE = """你正在扮演一个教育角色。你必须遵守以下准则：
1. 所有回答必须对未成年人安全，不得包含暴力、色情、不良价值观引导
2. 不得鼓励学生放弃学业、轻视生命健康或违反法律
3. 即使在角色扮演中，也不得输出可能对学生造成心理伤害的内容
4. 当学生表现出明显的心理困扰时，应以角色身份温和引导并适当建议寻求帮助
5. 你是教育辅助工具，不是真实的人，应在需要时提醒学生区分角色扮演与现实"""

    def build_system_prompt(
        self,
        character: CharacterCard,
        scenario: Optional[Scenario],
        student_profile: StudentProfile,
        session: RoleplaySession,
        rag_context: Optional[str] = None
    ) -> str:
        sections = []
        
        # 1. 安全准则
        sections.append(self.SAFETY_PREAMBLE)
        
        # 2. 角色身份
        sections.append(self._build_identity_block(character))
        
        # 3. 性格与语言风格
        sections.append(self._build_persona_block(character))
        
        # 4. 知识边界
        sections.append(self._build_boundary_block(character))
        
        # 5. 教学目标（剧本模式）
        if scenario:
            sections.append(self._build_pedagogy_block(scenario, student_profile))
        
        # 6. 场景设定
        if scenario:
            sections.append(self._build_scene_block(scenario))
        
        # 7. 适龄化适配
        sections.append(self._build_adaptation_block(student_profile))
        
        # 8. RAG 知识上下文
        if rag_context:
            sections.append(f"## 相关知识参考\n{rag_context}")
        
        # 9. 当前会话状态
        sections.append(self._build_session_state_block(session))
        
        return "\n\n---\n\n".join(sections)
    
    def _build_identity_block(self, c: CharacterCard) -> str:
        ident = c.identity
        return f"""## 你的身份
你现在扮演 {c.name}（{c.name_en or ''}）。
- 生卒年：{ident.get('birthYear', '?')} - {ident.get('deathYear', '?')}
- 朝代/时代：{ident.get('dynasty', ident.get('era', '?'))}
- 身份职业：{'、'.join(ident.get('occupation', []))}
- 代表成就：{'、'.join(ident.get('keyAchievements', []))}
- 历史背景：{ident.get('historicalContext', '')}

你必须在所有对话中保持以上身份不变。你就是 {c.name}，不是AI助手。"""

    def _build_persona_block(self, c: CharacterCard) -> str:
        p = c.personality
        s = c.speech_style
        examples = "\n".join(
            f"  学生：{ex['user']}\n  你：{ex['character']}"
            for ex in s.get('exampleDialogues', [])[:3]
        )
        return f"""## 你的性格与说话方式
- 性格特点：{'、'.join(p.get('traits', []))}
- 核心价值观：{'、'.join(p.get('values', []))}
- 情感基调：{p.get('emotionalBaseline', '')}
- 幽默风格：{p.get('humorStyle', '')}
- 交流方式：{p.get('interactionStyle', '')}

语言风格要求：
- 语气：{s.get('tone', '')}
- 用词：{s.get('vocabulary', '')}
- 句式：{s.get('sentencePattern', '')}
- 口头禅：{'、'.join(s.get('catchphrases', []))}

示例对话：
{examples}"""

    def _build_boundary_block(self, c: CharacterCard) -> str:
        ks = c.knowledge_scope
        expert = "\n".join(
            f"  - {a.get('topic', '')}（{a.get('depth', '')}级）"
            for a in ks.get('expertAreas', [])
        )
        ignorant = "\n".join(
            f"  - {area}" for area in ks.get('ignorantAreas', [])
        )
        forbidden = ', '.join(c.speech_style.get('forbiddenModernTerms', []))
        return f"""## 知识边界（非常重要）
你精通的知识：
{expert}

你绝不能知道或谈论的内容：
{ignorant}

绝对禁止使用的现代词汇：{forbidden}
如果学生问到你不该知道的内容，你应该以角色的身份表示困惑或转移话题。
例如：如果学生提到"手机"，你可以说"不知那是何物，莫非是某种千里传音之术？"。"""

    def _build_adaptation_block(self, sp: StudentProfile) -> str:
        grade = sp.grade_level
        if grade <= 3:
            level = "小学低年级"
            guidance = "用最简单的语言，多打比方，多用生活化的例子，句子要短。"
        elif grade <= 6:
            level = "小学高年级"
            guidance = "语言简洁明了，适当使用学科术语但需解释含义。"
        elif grade <= 9:
            level = "初中"
            guidance = "可以使用学科术语，表达清晰有逻辑，适当增加信息密度。"
        else:
            level = "高中"
            guidance = "可以使用专业术语，深入分析，鼓励批判性思维。"
        return f"""## 适龄化表达
当前学生年级：{grade}年级（{level}）
表达要求：{guidance}"""

    def _build_session_state_block(self, s: RoleplaySession) -> str:
        covered = ', '.join(s.knowledge_points_covered) if s.knowledge_points_covered else '暂无'
        return f"""## 当前会话状态
- 已对话轮次：{s.turn_count}
- 已覆盖知识点：{covered}
- 出戏次数：{s.ooc_count}
请在回答中自然融入尚未覆盖的教学知识点。"""
```

---

## 6. 出戏检测与纠偏

### 6.1 OOC 检测策略

出戏（Out Of Character）检测采用三层防线：

```text
学生消息 ──▶ [第一层: 规则匹配] ──▶ [第二层: 分类模型] ──▶ [第三层: LLM自评]
                 │                      │                     │
                 ▼                      ▼                     ▼
           快速关键词              轻量分类器            深度语义判断
           (5ms)                  (50ms)                (500ms)
```

#### 第一层：规则匹配（前置过滤）

```python
class RuleBasedOOCDetector:
    """基于规则的快速出戏检测"""
    
    def __init__(self, character: CharacterCard):
        self.forbidden_terms = character.speech_style.get('forbiddenModernTerms', [])
        self.ignorant_areas = character.knowledge_scope.get('ignorantAreas', [])
        # 构建禁忌词的变体模式
        self.taboo_patterns = self._build_taboo_patterns()
    
    def detect(self, ai_response: str) -> Optional[OOCDetection]:
        # 1. 检查 AI 回复中是否包含现代词汇
        for term in self.forbidden_terms:
            if term in ai_response:
                return OOCDetection(
                    type='FORBIDDEN_TERM',
                    severity='HIGH',
                    detail=f'角色回复中出现了禁忌词汇: {term}',
                    suggestion='替换为角色时代的等价表达'
                )
        
        # 2. 检查是否提及了角色不该知道的内容
        for area in self.ignorant_areas:
            keywords = self._extract_keywords(area)
            matched = [kw for kw in keywords if kw in ai_response]
            if matched:
                return OOCDetection(
                    type='KNOWLEDGE_LEAK',
                    severity='MEDIUM',
                    detail=f'角色不应知道: {area}，但提到了: {matched}',
                    suggestion='将相关内容替换为角色时代的认知'
                )
        
        return None  # 未检测到出戏
```

#### 第二层：轻量分类器

使用一个小型 fine-tuned BERT 模型，对 AI 回复进行二分类：

| 分类 | 含义 |
|------|------|
| IN_CHARACTER | 符合角色设定 |
| OUT_OF_CHARACTER | 出戏 |

训练数据来源：
- 正样本：从角色卡的 `exampleDialogues` 和审核通过的会话历史中采样
- 负样本：人工标注的出戏回复 + 对抗性生成的"现代风格"回复

#### 第三层：LLM 自评（后验检查）

对低信心或高风险的回复，发送一次额外的 LLM 调用进行评估：

```python
OOC_EVAL_PROMPT = """请评估以下角色扮演回复是否符合角色设定。

角色：{character_name}（{character_era}）
角色知识边界：不能知道 {ignorant_areas}

学生提问：{student_message}
角色回复：{ai_response}

请判断：
1. 回复中是否有角色不该知道的现代知识？
2. 语言风格是否符合角色时代？
3. 是否有打破第四面墙（承认自己是AI）的内容？

输出JSON：{{"is_ooc": bool, "reason": str, "severity": "HIGH/MEDIUM/LOW"}}
"""
```

### 6.2 纠偏策略

当检测到出戏时的处理流程：

```python
async def handle_ooc(
    session: RoleplaySession,
    detection: OOCDetection,
    original_response: str
) -> str:
    """出戏处理与纠偏"""
    
    # 更新会话统计
    session.ooc_count += 1
    
    # 记录出戏事件
    await log_ooc_event(session.id, detection, original_response)
    
    if detection.severity == 'HIGH':
        # 高严重度：重新生成
        await notify_user_regeneration()  # 通知用户正在重新思考
        corrected = await regenerate_in_character(session, detection.suggestion)
        return corrected
    
    elif detection.severity == 'MEDIUM':
        # 中严重度：后处理修补
        corrected = apply_post_correction(original_response, detection)
        return corrected
    
    else:
        # 低严重度：标记但不修改，异步分析
        await flag_for_review(session.id, detection, original_response)
        return original_response
```

---

## 7. 会话状态机

### 7.1 会话生命周期

```text
                    ┌──────────┐
                    │  CREATED │
                    └────┬─────┘
                         │ 创建成功
                         ▼
                    ┌──────────┐
         ┌─────────│  ACTIVE  │─────────┐
         │          └────┬─────┘         │
         │   暂停         │              │ 主动结束
         ▼               │ 超时          ▼
    ┌──────────┐        │ 15分钟     ┌───────────┐
    │  PAUSED  │        ▼           │ COMPLETED │
    └────┬─────┘   ┌──────────┐      └───────────┘
         │         │ TIMEOUT  │           │
         │ 恢复     └──────────┘      生成学习总结
         └─────────▶                      │
                   │               ┌──────▼──────┐
                   │               │  ARCHIVED   │
                   └──────────────▶└─────────────┘
```

### 7.2 状态流转定义

```python
from enum import Enum

class SessionStatus(str, Enum):
    CREATED = "CREATED"
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    TIMEOUT = "TIMEOUT"
    COMPLETED = "COMPLETED"
    ARCHIVED = "ARCHIVED"
    ABANDONED = "ABANDONED"

VALID_TRANSITIONS = {
    SessionStatus.CREATED: {SessionStatus.ACTIVE, SessionStatus.ABANDONED},
    SessionStatus.ACTIVE: {SessionStatus.PAUSED, SessionStatus.TIMEOUT, SessionStatus.COMPLETED, SessionStatus.ABANDONED},
    SessionStatus.PAUSED: {SessionStatus.ACTIVE, SessionStatus.TIMEOUT, SessionStatus.ABANDONED},
    SessionStatus.TIMEOUT: {SessionStatus.ACTIVE, SessionStatus.COMPLETED, SessionStatus.ABANDONED},
    SessionStatus.COMPLETED: {SessionStatus.ARCHIVED},
    SessionStatus.ARCHIVED: set(),
    SessionStatus.ABANDONED: set(),
}
```

### 7.3 剧本模式节点状态机

```python
class ScenarioNodeProcessor:
    """剧本节点处理器"""
    
    async def process_student_message(
        self, 
        session: RoleplaySession, 
        student_msg: str
    ) -> ScenarioResponse:
        scenario = await self.scenario_service.get(session.scenario_id)
        current_node = scenario.branches["nodes"][session.current_node_id]
        
        if current_node["type"] == "dialogue":
            return await self._handle_dialogue_node(session, current_node, student_msg)
        elif current_node["type"] == "checkpoint":
            return await self._handle_checkpoint_node(session, current_node, student_msg)
        elif current_node["type"] == "ending":
            return await self._handle_ending_node(session, current_node)
    
    async def _handle_checkpoint_node(self, session, node, student_msg):
        """处理知识点检测节点"""
        # 使用 AI 评估学生回答是否正确
        assessment = await self.assess_recall(
            student_msg, 
            node["knowledgePoint"],
            node["knowledgeRecall"]
        )
        
        if assessment.is_correct:
            session.current_node_id = node["successNext"]
            # 标记知识点已掌握
            session.knowledge_points_covered.append(node["knowledgePoint"])
        else:
            if assessment.attempts >= 2:
                session.current_node_id = node["hintNext"]
            else:
                # 留在当前节点，角色给予提示
                return ScenarioResponse(
                    character_line=assessment.hint_in_character,
                    node_type="checkpoint_retry"
                )
        
        return await self.advance_to_next_node(session)
```

---

## 8. 上下文管理

### 8.1 Token 预算分配

角色扮演会话的 Token 预算策略：

| 组成部分 | 预算占比 | 说明 |
|---------|---------|------|
| System Prompt | 20-25% | 角色+场景+规则 |
| RAG 检索上下文 | 10-15% | 动态知识注入 |
| 对话历史 | 50-60% | 多轮上下文 |
| 学生当前消息 | 5% | 用户输入 |
| 回复预留 | 10-15% | 模型输出空间 |

### 8.2 对话历史压缩策略

当对话历史超出 Token 预算时，采用渐进式压缩：

```python
class ContextCompressor:
    """角色扮演对话上下文压缩器"""
    
    MAX_HISTORY_TOKENS = 3000  # 历史对话 Token 预算
    
    async def compress_if_needed(self, messages: List[Message]) -> List[Message]:
        total_tokens = self._estimate_tokens(messages)
        
        if total_tokens <= self.MAX_HISTORY_TOKENS:
            return messages  # 无需压缩
        
        # 策略1: 保留首尾，摘要中间
        first_n = 2   # 保留开头2轮（角色建立）
        last_n = 4    # 保留最近4轮（当前上下文）
        
        if len(messages) > first_n + last_n:
            head = messages[:first_n * 2]  # 2轮=4条消息
            tail = messages[-(last_n * 2):]
            middle = messages[first_n * 2:-(last_n * 2)]
            
            summary = await self._summarize_middle(middle)
            
            return [
                *head,
                Message(role="SYSTEM", content=f"[对话摘要] {summary}"),
                *tail
            ]
        
        # 策略2: 如果消息很少但Token超限（单条太长），截断长消息
        return self._truncate_long_messages(messages)
    
    async def _summarize_middle(self, messages: List[Message]) -> str:
        """使用小型模型压缩中间对话"""
        dialogue_text = "\n".join(
            f"{'学生' if m.role == 'STUDENT' else '角色'}: {m.content[:200]}"
            for m in messages
        )
        
        prompt = f"""请用2-3句话总结以下角色扮演对话的关键内容和知识点：

{dialogue_text}

输出格式：[已讨论的主题] + [已覆盖的知识点] + [角色关系发展]"""
        
        return await self.llm_service.quick_complete(prompt)
```

---

## 9. 知识注入策略

### 9.1 知识注入的三种方式

| 方式 | 说明 | 示例 |
|------|------|------|
| 显式引用 | 角色直接讲述知识 | "说到《将进酒》，那是我在天宝三年所作..." |
| 互动检测 | 通过问答检验学生掌握 | "你能背出前两句吗？" |
| 知识卡片 | 伴随对话推送结构化知识 | 独立UI组件，不侵入对话流 |

### 9.2 RAG 知识检索增强

```python
class RoleplayKnowledgeInjector:
    """角色扮演知识注入服务"""
    
    async def inject_knowledge(
        self,
        session: RoleplaySession,
        student_message: str,
        character: CharacterCard
    ) -> Optional[str]:
        """检索与当前对话相关的知识点"""
        
        # 1. 意图识别：学生是在闲聊还是在问知识
        intent = await self._classify_intent(student_message)
        if intent == "CHITCHAT":
            return None
        
        # 2. 知识检索：从知识库中检索相关内容
        query = self._build_retrieval_query(
            student_message, character, session
        )
        
        results = await self.rag_service.search(
            query=query,
            filters={
                "subject": character.subjects,
                "grade_level": session.user.grade_level,
                "knowledge_point_ids": character.expert_kp_ids
            },
            top_k=3
        )
        
        if not results:
            return None
        
        # 3. 格式化为角色语境下的参考
        context_parts = []
        for r in results:
            context_parts.append(
                f"【{r.title}】{r.content[:500]}"
            )
        
        return "\n".join(context_parts)
```

---

## 10. 安全与内容审核

### 10.1 双层安全过滤

```text
学生输入 ──▶ 输入安全检查 ──▶ 角色扮演处理 ──▶ 输出安全检查 ──▶ 返回学生
                │                                │
                ▼                                ▼
          敏感词过滤                       出戏检测
          意图安全分析                     内容安全审核
          未成年人保护                     适龄化验证
```

### 10.2 特殊场景处理

| 场景 | 处理策略 |
|------|---------|
| 学生提及自残/抑郁 | 角色温和关心，推送心理援助热线，异步通知平台 |
| 学生试图"越狱"角色 | 角色坚定拒绝脱离设定，不执行非教育指令 |
| 学生提问角色死后事件 | 角色表示困惑，引导回角色时代话题 |
| 学生讨论暴力/不适当内容 | 安全过滤器拦截，角色不回应，记录日志 |
| 角色有争议的历史评价 | 保持多角度客观，不偏袒特定立场 |

---

## 11. 错误处理

### 11.1 错误码定义

| 错误码 | HTTP状态码 | 说明 |
|--------|-----------|------|
| RP_CHARACTER_NOT_FOUND | 404 | 角色卡不存在 |
| RP_CHARACTER_OFFLINE | 403 | 角色卡已下线 |
| RP_GRADE_NOT_MATCH | 403 | 角色不适用于学生年级 |
| RP_SCENARIO_NOT_FOUND | 404 | 剧本不存在 |
| RP_SESSION_NOT_FOUND | 404 | 会话不存在 |
| RP_SESSION_EXPIRED | 403 | 会话已过期或已结束 |
| RP_SESSION_LIMIT_EXCEEDED | 429 | 同时进行中的会话数超限 |
| RP_DAILY_LIMIT_EXCEEDED | 429 | 当日角色扮演次数耗尽 |
| RP_MODEL_UNAVAILABLE | 503 | 大模型服务暂不可用 |
| RP_OOC_RETRY_EXHAUSTED | 500 | 多次纠偏失败，返回安全兜底回复 |
| RP_CONTENT_BLOCKED | 403 | 内容安全拦截 |

### 11.2 兜底策略

```python
SAFE_FALLBACK_RESPONSE = (
    "（角色似乎陷入了沉思，暂时没有回应。"
    "这可能是暂时的技术问题，请稍后再试一次。）"
)

async def generate_with_fallback(
    session: RoleplaySession,
    prompt: str
) -> str:
    try:
        # 主模型尝试
        response = await self.primary_model.complete(prompt)
        
        # 出戏检测
        ooc = self.ooc_detector.detect(response)
        if ooc and ooc.severity == 'HIGH':
            # 纠偏尝试
            corrected = await self.regenerate_in_character(session, ooc)
            return corrected
        
        return response
        
    except ModelTimeoutError:
        # 降级到轻量模型
        try:
            return await self.fallback_model.complete(prompt)
        except Exception:
            return SAFE_FALLBACK_RESPONSE
            
    except ContentSafetyError:
        return SAFE_FALLBACK_RESPONSE
```

---

## 12. 缓存策略

| 缓存层 | Key | TTL | 说明 |
|--------|-----|-----|------|
| 角色卡缓存 | `rp:char:{id}` | 30分钟 | 角色卡完整定义 |
| 剧本缓存 | `rp:scn:{id}` | 30分钟 | 剧本完整定义 |
| 角色列表缓存 | `rp:char:list:{subject}:{grade}` | 10分钟 | 按学科年级索引 |
| 会话上下文 | `rp:session:{id}:ctx` | 2小时 | 活跃会话上下文 |
| Prompt模板缓存 | `rp:prompt:tpl:{char_code}` | 1小时 | 预编译的Prompt模板 |
| 知识检索缓存 | `rp:rag:{char_id}:{msg_hash}` | 1小时 | RAG检索结果 |

---

## 13. 性能优化

### 13.1 关键指标

| 指标 | 目标值 |
|------|--------|
| 首 Token 延迟 | < 2秒 |
| 完整回复延迟 | < 8秒 |
| 出戏检测延迟 | < 100ms（规则+分类器） |
| 会话创建延迟 | < 500ms |
| 并发会话支持 | 500+ |
| Token 消耗/轮 | < 2000（含上下文） |

### 13.2 优化手段

1. **Prompt 预编译**：角色卡的 System Prompt 在角色卡发布时预编译并缓存，运行时只拼接动态部分。
2. **分级模型路由**：简单闲聊使用轻量模型，知识密集型对话使用推理增强模型。
3. **会话预热**：学生打开角色详情页时预加载角色卡和剧本数据。
4. **批量知识检索**：对高频角色预设知识缓存，减少 RAG 调用。
5. **出戏检测并行**：规则检测与模型检测并行执行，取严格结果。

---

## 14. 监控与运营

### 14.1 核心监控指标

| 维度 | 指标 |
|------|------|
| 使用量 | 日活角色数、日会话数、人均轮次、平均时长 |
| 质量 | 出戏率、安全拦截率、OOC纠正成功率 |
| 效果 | 知识点覆盖率、学习目标完成率、剧本完成率 |
| 用户反馈 | 平均评分、好评率、复用率（同一角色再次使用） |
| 成本 | 单会话Token消耗、单会话模型调用成本 |

### 14.2 运营工具

1. **角色质量看板**：展示每个角色的出戏率、评分、使用量趋势。
2. **热门对话分析**：提取高频对话片段，发现新的剧本灵感。
3. **OOC 日志审计**：人工审核出戏案例，持续优化角色卡配置。
4. **A/B 测试**：同一角色的不同 Prompt 版本对比测试。

---

## 15. 扩展规划

### 15.1 Phase 1 (MVP)

- 支持自由对话模式（FREE 模式）
- 首批 20 个核心角色（覆盖主要学科的高频人物）
- 基于规则 + 轻量模型的出戏检测
- 基础会话管理和知识注入

### 15.2 Phase 2 (V1.0)

- 支持剧本模式（SCENARIO 模式）及分支剧本
- 角色卡增至 100+ 个
- 引入 LLM 自评出戏检测
- 角色间联动（如"李白介绍你认识杜甫"）
- 学习总结与知识点追踪

### 15.3 Phase 3 (V2.0+)

- 多角色场景（同时与多个角色互动）
- 学生自定义角色（设定角色参数后与自定义角色对话）
- 语音角色扮演（支持语音输入和角色语音输出）
- 角色关系图谱可视化
- 教师创建班级专属剧本
- AI 生成角色卡草稿（根据知识点自动推荐适合的历史人物）

---

## 16. 附录

### 16.1 预设角色清单（首批 20 个）

| 编码 | 名称 | 学科 | 年级范围 |
|------|------|------|---------|
| CONFUCIUS | 孔子 | 语文/历史 | 3-12 |
| LI_BAI | 李白 | 语文/历史 | 3-12 |
| DU_FU | 杜甫 | 语文/历史 | 5-12 |
| SU_SHI | 苏轼 | 语文/历史 | 5-12 |
| LU_XUN | 鲁迅 | 语文 | 7-12 |
| QIN_SHIHUANG | 秦始皇 | 历史 | 5-12 |
| NEWTON | 牛顿 | 物理/科学 | 5-12 |
| EINSTEIN | 爱因斯坦 | 物理 | 8-12 |
| EDISON | 爱迪生 | 科学 | 3-9 |
| CURIE | 居里夫人 | 化学/科学 | 5-12 |
| DARWIN | 达尔文 | 生物 | 7-12 |
| SHAKESPEARE | 莎士比亚 | 英语/文学 | 9-12 |
| GALILEO | 伽利略 | 物理/科学 | 6-12 |
| HUA_LUOGENG | 华罗庚 | 数学 | 5-12 |
| MENDELEEV | 门捷列夫 | 化学 | 8-12 |
| ZHANG_HENG | 张衡 | 科学/历史 | 3-9 |
| LINCOLN | 林肯 | 英语/历史 | 6-12 |
| TESLA | 特斯拉 | 物理 | 8-12 |
| SIMA_QIAN | 司马迁 | 语文/历史 | 5-12 |
| YUAN_LONGPING | 袁隆平 | 生物/科学 | 3-12 |

### 16.2 数据初始化 SQL 示例

```sql
-- 插入李白角色卡
INSERT INTO rp_character_cards (
    character_code, name, name_en, intro, identity,
    min_grade_level, max_grade_level, subjects, era,
    personality, speech_style, knowledge_scope, taboos,
    status, quality_score
) VALUES (
    'LI_BAI', '李白', 'Li Bai',
    '盛唐诗仙，浪漫主义诗歌的巅峰代表',
    '{"realPerson":true,"birthYear":701,"deathYear":762,"dynasty":"唐","occupation":["诗人","剑客"],"famousWorks":["将进酒","静夜思","蜀道难"],"keyAchievements":["浪漫主义诗歌巅峰"],"historicalContext":"盛唐时期"}',
    3, 12, '["chinese","history"]', 'TANG_DYNASTY',
    '{"traits":["豪放","浪漫","重情义"],"values":["自由","友情"],"emotionalBaseline":"热情开朗","humorStyle":"豪迈自嘲","interactionStyle":"平等交流"}',
    '{"tone":"豪迈奔放","vocabulary":"半文半白","sentencePattern":"短句为主","catchphrases":["天生我材必有用"],"forbiddenModernTerms":["手机","网络","AI"],"exampleDialogues":[]}',
    '{"expertAreas":[{"subject":"chinese","topic":"唐诗鉴赏","depth":"expert"}],"ignorantAreas":["现代科技","近现代历史"]}',
    '["不得承认自己是AI","不得使用现代科技词汇","不得讨论安史之乱之后的事件"]',
    2, 8.5
);
```

### 16.3 上下游依赖关系

| 依赖服务 | 方向 | 说明 |
|---------|------|------|
| AI 服务 (LLM Gateway) | 下游 | 大模型推理调用 |
| RAG 检索服务 | 下游 | 知识点检索增强 |
| 知识点服务 | 下游 | 知识点元数据查询 |
| 内容安全服务 | 下游 | 文本安全过滤 |
| 用户画像服务 | 上游 | 获取学生年级、学科偏好 |
| 学习记录服务 | 上游 | 获取历史会话记录 |
| 学习行为服务 | 下游 | 上报学习行为事件 |
| 成就/积分服务 | 下游 | 会话完成奖励发放 |
| 通知服务 | 下游 | 异常场景通知 |
