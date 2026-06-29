# 服务端 - 学生 AI 学习伙伴长期记忆库与跨会话关系建构引擎 详细设计

## 1. 概述

### 1.1 模块定位

本引擎负责为每个学生构建和维护一个 **持久化跨会话记忆系统**，使 AI 学习伙伴能够在不同学习会话之间"记住"学生的关键信息——包括学习偏好、知识薄弱点、个人目标、历史交互模式和情感联结状态——从而在每次对话中提供具有连续性和关系深度的个性化辅导体验。

### 1.2 与现有模块的边界

| 现有模块 | 本模块的差异 |
|---------|------------|
| AI 模型上下文管理与对话记忆引擎 | 管理单次会话内的短期上下文（多轮对话窗口、Token 预算），本模块管理跨天/跨会话的长期记忆 |
| 学生 AI 学习伙伴角色个性化与对话风格自适应引擎 | 决定 AI"怎么说"（语气、风格），本模块决定 AI"知道什么"（关于该学生的持久信息） |
| 用户学习画像与能力维度模型 | 关注学科能力维度的结构化评分，本模块关注交互层面的细节记忆（如"上次学生说害怕几何证明题"） |
| 学生心理状态建模与学习动机激励策略引擎 | 关注心理状态的实时建模与激励策略，本模块关注历史交互记忆的长期沉淀 |

### 1.3 核心职责

1. **记忆编码**：从每次 AI 对话/学习行为中提取值得长期记住的信息
2. **记忆存储**：以多种表征方式（结构化事实、向量嵌入、情感标签）持久化存储
3. **记忆检索**：在新会话开始时，根据当前上下文召回相关记忆
4. **记忆整合**：定期合并、去重、归纳碎片化记忆，形成结构化的学生画像
5. **记忆衰减**：基于时间相关性和使用频率，对记忆进行自然的遗忘与强化
6. **隐私管控**：提供用户可见、可控的记忆管理机制，支持查看与删除

### 1.4 依赖关系

```
┌─────────────────────────────────────────────────────┐
│              长期记忆库与关系建构引擎                  │
├─────────────┬──────────────┬────────────────────────┤
│   读取上游    │   写入下游    │       双向交互          │
├─────────────┼──────────────┼────────────────────────┤
│ AI 对话引擎   │ 记忆向量库    │ AI 对话上下文组装       │
│ (对话内容)    │ (pgvector)   │ (会话开启时注入)        │
├─────────────┼──────────────┼────────────────────────┤
│ 学习行为事件  │ 结构化记忆库  │ Prompt 模板系统         │
│ (答题/学习)   │ (MySQL)      │ (记忆→Prompt 注入)     │
├─────────────┼──────────────┼────────────────────────┤
│ 用户画像服务  │ 情感关系状态  │ 学生 AI 伙伴角色引擎     │
│ (能力维度)    │ (Redis)      │ (风格←记忆影响)        │
└─────────────┴──────────────┴────────────────────────┘
```

---

## 2. 数据模型

### 2.1 记忆分类体系

```
记忆类型
├── 语义记忆 (Semantic Memory) — 关于学生的持久事实
│   ├── 学习档案事实 (年级、教材版本、选科、目标分数)
│   ├── 学习偏好事实 (偏好图文讲解、不喜欢长文字、喜欢被鼓励)
│   ├── 环境事实 (通常晚上 9 点学习、使用 iPad、家长偶尔陪同)
│   └── 关键里程碑 (2026-05 通过 KET 考试、数学期中考 85 分)
│
├── 情景记忆 (Episodic Memory) — 具体的交互片段
│   ├── 学习高光时刻 (解出了一道难题、连续 7 天打卡)
│   ├── 挫折时刻 (某个知识点反复出错、表达了对某学科的挫败感)
│   ├── 对话关键时刻 (AI 的一次特别有帮助的讲解、学生的感谢)
│   └── 目标承诺 (学生说"这周要把二次函数搞懂")
│
├── 情感记忆 (Emotional Memory) — 关系与情感状态
│   ├── 关系信任度 (学生是否信任 AI 的建议、是否愿意分享困难)
│   ├── 学科情绪 (对数学焦虑、对英语有成就感)
│   ├── 互动模式 (喜欢追问"为什么"、喜欢做挑战题、不喜欢被催促)
│   └── 激励响应偏好 (对鼓励型反馈效果好、对竞争激励不感兴趣)
│
└── 过程记忆 (Procedural Memory) — 学习策略记忆
    ├── 有效策略 (先画图再解题对这个学生有效)
    ├── 无效策略 (直接给公式推导会导致学生困惑)
    └── 习惯模式 (喜欢先看例题再自己做、习惯用草稿纸)
```

### 2.2 核心数据表

#### 2.2.1 `student_memory_fact` — 结构化记忆事实表

```sql
CREATE TABLE student_memory_fact (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    student_id      BIGINT NOT NULL,
    fact_type       VARCHAR(32) NOT NULL COMMENT '记忆类型: PROFILE/PREFERENCE/ENVIRONMENT/MILESTONE',
    fact_key        VARCHAR(128) NOT NULL COMMENT '事实键, 如 preferred_explanation_style',
    fact_value      TEXT NOT NULL COMMENT '事实值, 如 "图文结合+分步骤"',
    fact_metadata   JSON COMMENT '附加元数据, 如置信度、来源会话ID',
    confidence      DECIMAL(3,2) DEFAULT 0.80 COMMENT '置信度 0.00-1.00',
    source_type     VARCHAR(32) NOT NULL COMMENT '来源: AI_EXTRACT/USER_SETTING/BEHAVIOR_INFERENCE',
    source_session_id BIGINT COMMENT '来源会话ID',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_accessed   DATETIME COMMENT '最后被检索使用的时间',
    access_count    INT DEFAULT 0 COMMENT '被检索使用次数',
    decay_score     DECIMAL(3,2) DEFAULT 1.00 COMMENT '衰减分数 0.00-1.00, 越高越不易遗忘',
    is_active       TINYINT DEFAULT 1 COMMENT '是否有效(未被用户删除)',
    
    INDEX idx_student_type (student_id, fact_type),
    INDEX idx_student_key (student_id, fact_key),
    INDEX idx_last_accessed (student_id, last_accessed),
    UNIQUE INDEX uk_student_key (student_id, fact_key, fact_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生结构化记忆事实表';
```

#### 2.2.2 `student_memory_episode` — 情景记忆表

```sql
CREATE TABLE student_memory_episode (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    student_id      BIGINT NOT NULL,
    episode_type    VARCHAR(32) NOT NULL COMMENT 'HIGHLIGHT/FRUSTRATION/KEY_MOMENT/COMMITMENT',
    title           VARCHAR(256) NOT NULL COMMENT '情景标题(摘要)',
    content         TEXT NOT NULL COMMENT '情景详细内容',
    emotion_tag     VARCHAR(32) COMMENT '情感标签: JOY/PRIDE/FRUSTRATION/ANXIETY/GRATITUDE/DETERMINATION',
    intensity       DECIMAL(3,2) DEFAULT 0.50 COMMENT '情感强度 0.00-1.00',
    subject_code    VARCHAR(16) COMMENT '相关学科',
    knowledge_point_ids JSON COMMENT '相关知识点ID列表',
    source_session_id BIGINT NOT NULL COMMENT '来源会话ID',
    source_conversation_id BIGINT COMMENT '来源对话ID',
    embedding_id    VARCHAR(64) COMMENT '向量库中对应的embedding ID',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_recalled   DATETIME COMMENT '最后被回忆使用的时间',
    recall_count    INT DEFAULT 0 COMMENT '被回忆次数',
    decay_score     DECIMAL(3,2) DEFAULT 1.00,
    is_active       TINYINT DEFAULT 1,
    
    INDEX idx_student_type (student_id, episode_type),
    INDEX idx_student_emotion (student_id, emotion_tag),
    INDEX idx_student_subject (student_id, subject_code),
    INDEX idx_created_at (student_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生情景记忆表';
```

#### 2.2.3 `student_relationship_state` — 情感关系状态表

```sql
CREATE TABLE student_relationship_state (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    student_id      BIGINT NOT NULL UNIQUE,
    trust_level     DECIMAL(3,2) DEFAULT 0.30 COMMENT '信任度 0.00-1.00, 初始较低',
    rapport_level   DECIMAL(3,2) DEFAULT 0.20 COMMENT '亲密度 0.00-1.00',
    engagement_tendency VARCHAR(32) DEFAULT 'NEUTRAL' COMMENT 'ENGAGED/NEUTRAL/RESISTANT',
    preferred_interaction_style JSON COMMENT '互动风格偏好: {encouragement: HIGH, competition: LOW, ...}',
    humor_receptivity DECIMAL(3,2) DEFAULT 0.50 COMMENT '幽默接受度',
    formality_level DECIMAL(3,2) DEFAULT 0.70 COMMENT '正式程度偏好, 越高越正式',
    communication_pattern JSON COMMENT '沟通模式: {avg_message_length, question_frequency, ...}',
    total_sessions  INT DEFAULT 0 COMMENT '总会话数',
    positive_interactions INT DEFAULT 0 COMMENT '正向交互次数',
    last_interaction_at DATETIME COMMENT '最近交互时间',
    last_interaction_summary TEXT COMMENT '最近交互的一句话摘要',
    relationship_milestones JSON COMMENT '关系里程碑: [{type, date, description}]',
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生-AI情感关系状态表';
```

#### 2.2.4 `student_memory_consolidation_log` — 记忆整合日志表

```sql
CREATE TABLE student_memory_consolidation_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    student_id      BIGINT NOT NULL,
    consolidation_type VARCHAR(32) NOT NULL COMMENT 'MERGE/SUMMARIZE/DECAY/ARCHIVE',
    input_memory_ids JSON NOT NULL COMMENT '输入的记忆ID列表',
    output_memory_id BIGINT COMMENT '输出的新记忆ID(如有)',
    consolidation_summary TEXT COMMENT '整合描述',
    consolidated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_student (student_id),
    INDEX idx_consolidated (student_id, consolidated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='记忆整合日志表';
```

### 2.3 向量存储 (pgvector)

```sql
-- 在 PostgreSQL 中使用 pgvector 扩展
CREATE TABLE student_memory_embedding (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id      BIGINT NOT NULL,
    memory_type     VARCHAR(32) NOT NULL COMMENT 'EPISODE/FACT_SUMMARY/CONVERSATION_SUMMARY',
    source_id       BIGINT NOT NULL COMMENT '对应表的记录ID',
    content_text    TEXT NOT NULL COMMENT '被嵌入的原始文本',
    embedding       VECTOR(1536) NOT NULL COMMENT '1536维向量(text-embedding-3-small)',
    metadata        JSONB COMMENT '附加过滤字段: subject, emotion, etc.',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    INDEX idx_student (student_id),
    INDEX idx_memory_type (student_id, memory_type)
);

-- HNSW 索引加速相似性检索
CREATE INDEX idx_memory_embedding_hnsw ON student_memory_embedding
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
```

### 2.4 Redis 缓存层

```text
# 当前会话记忆热缓存 (会话期间有效, TTL 2小时)
memory:session:{student_id} → Hash
  ├── active_facts: JSON        # 当前激活的语义记忆
  ├── active_episodes: JSON     # 最近回忆的情景记忆
  ├── relationship: JSON        # 当前关系状态快照
  └── working_memory: JSON      # 本次会话的工作记忆(临时)

# 记忆索引缓存 (减少DB查询, TTL 1小时)
memory:index:{student_id}:{memory_type} → Set (memory_id list)

# 记忆检索结果缓存 (相同查询不重复embedding, TTL 30分钟)
memory:search:cache:{student_id}:{query_hash} → JSON (search results)

# 全局记忆衰减调度锁
memory:decay:lock:{student_id} → String (timestamp, TTL 1小时, 防止并发)
```

---

## 3. API 接口设计

### 3.1 接口总览

| # | 接口 | 方法 | 路径 | 说明 |
|---|------|------|------|------|
| 1 | 注入记忆到会话上下文 | POST | `/api/v1/memory/inject` | 会话开始时调用，返回相关记忆 |
| 2 | 编码新记忆 | POST | `/api/v1/memory/encode` | 会话结束后调用，提取并存储记忆 |
| 3 | 检索记忆 | POST | `/api/v1/memory/search` | 根据查询文本语义检索记忆 |
| 4 | 获取关系状态 | GET | `/api/v1/memory/relationship/{studentId}` | 获取当前情感关系状态 |
| 5 | 更新关系状态 | PUT | `/api/v1/memory/relationship/{studentId}` | 会话后更新关系状态 |
| 6 | 获取记忆列表 | GET | `/api/v1/memory/list/{studentId}` | 用户查看自己的记忆(分页) |
| 7 | 删除记忆 | DELETE | `/api/v1/memory/{memoryId}` | 用户删除指定记忆 |
| 8 | 批量删除记忆 | DELETE | `/api/v1/memory/batch` | 用户批量删除记忆 |
| 9 | 触发记忆整合 | POST | `/api/v1/memory/consolidate` | 手动触发记忆整合(管理后台) |
| 10 | 获取记忆统计 | GET | `/api/v1/memory/stats/{studentId}` | 记忆数量、类型分布等统计 |

### 3.2 核心接口详细设计

#### 3.2.1 注入记忆到会话上下文

会话开始时，根据当前学习场景检索并组装相关记忆，注入到 AI 对话的 System Prompt 中。

```
POST /api/v1/memory/inject
```

**请求体：**
```json
{
  "studentId": 10086,
  "sessionId": "sess_20260630_001",
  "context": {
    "scene": "AI_TUTORING",         // 场景: AI_TUTORING / PRACTICE / ERROR_REVIEW / EXAM_PREP
    "subject": "MATH",              // 当前学科
    "topic": "二次函数",             // 当前主题(可选)
    "knowledgePointIds": [1234, 1235],  // 相关知识点(可选)
    "userQuery": "帮我理解二次函数的顶点公式"  // 用户当前问题(可选)
  },
  "options": {
    "maxFacts": 8,                  // 最多注入的语义记忆条数
    "maxEpisodes": 4,               // 最多注入的情景记忆条数
    "includeRelationship": true,    // 是否包含关系状态
    "tokenBudget": 1200             // 记忆注入的Token预算
  }
}
```

**响应体：**
```json
{
  "code": 0,
  "data": {
    "sessionId": "sess_20260630_001",
    "facts": [
      {
        "factKey": "preferred_explanation_style",
        "factValue": "图文结合 + 分步骤讲解，不喜欢大段文字",
        "confidence": 0.92
      },
      {
        "factKey": "math_anxiety_level",
        "factValue": "对函数类题目有中等焦虑，曾表达'函数好难'",
        "confidence": 0.78,
        "lastAccessed": "2026-06-28T10:30:00Z"
      }
    ],
    "episodes": [
      {
        "title": "二次函数图像理解突破",
        "content": "2026-06-20 学生通过画图理解了顶点公式，当时非常开心",
        "emotionTag": "JOY",
        "intensity": 0.80,
        "createdAt": "2026-06-20T21:15:00Z"
      }
    ],
    "relationship": {
      "trustLevel": 0.75,
      "rapportLevel": 0.68,
      "preferredInteractionStyle": {
        "encouragement": "HIGH",
        "competition": "LOW",
        "humor": "MODERATE"
      },
      "lastInteractionSummary": "昨晚完成了三角函数练习，正确率提升到80%"
    },
    "promptSnippet": "## 关于这位学生\n- 偏好图文结合+分步讲解，避免大段纯文字\n- 对函数类题目有一定焦虑，需多鼓励\n- 上次成功通过画图理解了顶点公式，可以引用这个成功经验\n- 信任度较高，可以适度推进学习节奏\n- 最近一次交互: 昨晚完成三角函数练习, 正确率80%",
    "tokenUsed": 287
  }
}
```

#### 3.2.2 编码新记忆

会话结束后，从对话内容和学习行为中提取值得记忆的信息。

```
POST /api/v1/memory/encode
```

**请求体：**
```json
{
  "studentId": 10086,
  "sessionId": "sess_20260630_001",
  "conversationIds": [50001, 50002, 50003],   // 本次会话的对话消息ID列表
  "learningEvents": [                           // 本次会话的学习行为事件
    {
      "type": "ANSWER_SUBMITTED",
      "subject": "MATH",
      "knowledgePointId": 1234,
      "result": "CORRECT",
      "timeSpent": 45
    }
  ],
  "sessionSummary": "学生本次学习了二次函数顶点公式的推导，通过3道练习题巩固，正确率67%。学生一开始觉得难，后来通过画图理解了。最后主动要求练习更多。",
  "options": {
    "extractEpisodes": true,
    "updateFacts": true,
    "updateRelationship": true,
    "maxNewEpisodes": 3
  }
}
```

**响应体：**
```json
{
  "code": 0,
  "data": {
    "encodedFacts": [
      {
        "factKey": "quadratic_function_comprehension",
        "factValue": "通过图形法理解二次函数效果好, 纯代数推导效果差",
        "factType": "PROCEDURAL",
        "confidence": 0.85
      },
      {
        "factKey": "math_persistence",
        "factValue": "在掌握方法后愿意主动增加练习量",
        "factType": "PREFERENCE",
        "confidence": 0.72
      }
    ],
    "encodedEpisodes": [
      {
        "title": "主动要求增加二次函数练习",
        "episodeType": "HIGHLIGHT",
        "emotionTag": "DETERMINATION",
        "intensity": 0.70
      }
    ],
    "relationshipUpdate": {
      "trustLevel": 0.76,         // +0.01
      "rapportLevel": 0.69,       // +0.01
      "engagementTendency": "ENGAGED",
      "lastInteractionSummary": "学习二次函数顶点公式, 3题练习正确率67%, 主动要求加练"
    },
    "embeddingIds": ["uuid_1", "uuid_2", "uuid_3"]
  }
}
```

#### 3.2.3 检索记忆

根据查询文本进行语义检索，返回最相关的记忆。

```
POST /api/v1/memory/search
```

**请求体：**
```json
{
  "studentId": 10086,
  "query": "学生对函数的态度",
  "memoryTypes": ["EPISODE", "FACT"],
  "topK": 5,
  "minScore": 0.65,
  "filters": {
    "subject": "MATH",
    "emotionTags": ["ANXIETY", "JOY", "FRUSTRATION"]
  }
}
```

**响应体：**
```json
{
  "code": 0,
  "data": {
    "results": [
      {
        "memoryId": 5001,
        "memoryType": "EPISODE",
        "title": "对函数题表达挫败感",
        "content": "2026-05-15 学生在练习一次函数题目时连续出错，表达了'函数真的好难'的挫败感",
        "score": 0.89,
        "emotionTag": "FRUSTRATION",
        "createdAt": "2026-05-15T20:30:00Z"
      },
      {
        "memoryId": 3002,
        "memoryType": "FACT",
        "factKey": "math_anxiety_level",
        "factValue": "对函数类题目有中等焦虑",
        "score": 0.85,
        "confidence": 0.78
      }
    ],
    "totalFound": 12,
    "searchLatencyMs": 23
  }
}
```

### 3.3 错误码定义

| 错误码 | HTTP状态码 | 说明 |
|--------|-----------|------|
| `MEMORY_001` | 400 | 学生ID缺失或无效 |
| `MEMORY_002` | 400 | 记忆类型不合法 |
| `MEMORY_003` | 403 | 无权访问该学生的记忆 |
| `MEMORY_004` | 404 | 指定记忆不存在 |
| `MEMORY_005` | 409 | 记忆正在被整合，暂时不可写入 |
| `MEMORY_006` | 422 | 记忆编码失败：内容为空或无法提取有效信息 |
| `MEMORY_007` | 429 | 记忆写入频率超限(单学生 100条/天) |
| `MEMORY_008` | 500 | 向量嵌入服务调用失败 |
| `MEMORY_009` | 500 | 记忆整合任务执行失败 |

---

## 4. 核心业务逻辑

### 4.1 记忆编码管线

会话结束后，从对话内容和行为数据中自动提取记忆。这是本引擎最核心的逻辑。

```text
输入: 会话消息列表 + 学习行为事件 + 会话摘要
  │
  ▼
┌──────────────────────────────────────────┐
│  Step 1: 预处理 & 过滤                      │
│  - 移除无信息量的消息(如纯问候)               │
│  - 检测敏感内容(不记忆隐私信息)               │
│  - 合并连续短消息为逻辑段落                   │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Step 2: LLM 记忆提取                       │
│  - 使用专门的记忆提取 Prompt                 │
│  - 从对话中提取: 事实/情景/情感/策略          │
│  - 输出结构化 JSON                          │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Step 3: 记忆去重 & 冲突检测                 │
│  - 与现有记忆做语义相似度比对                 │
│  - 相似度 > 0.85: 合并更新                   │
│  - 矛盾记忆: 以新记忆为准, 标记旧记忆为过时    │
│  - 全新记忆: 直接新增                         │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Step 4: 向量嵌入 & 存储                     │
│  - 对情景记忆和事实摘要生成 embedding         │
│  - 写入结构化表 + 向量表                     │
│  - 更新 Redis 热缓存                         │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Step 5: 关系状态更新                        │
│  - 根据本次交互更新信任度、亲密度              │
│  - 更新偏好风格                               │
│  - 记录交互摘要                               │
└──────────────────────────────────────────┘
```

#### 记忆提取 Prompt 模板

```python
MEMORY_EXTRACTION_PROMPT = """你是一个记忆提取专家。请从以下学生与AI学习伙伴的对话中，提取值得长期记住的信息。

## 对话内容
{conversation_text}

## 学习行为
{learning_events_text}

## 提取规则
1. **只提取有长期价值的信息**，不要记录一次性的事实（如"这道题选B"）
2. **关注以下维度**：
   - 学习偏好（偏好的讲解方式、练习方式、反馈方式）
   - 知识状态（哪些知识点掌握得好/差， misconceptions）
   - 情感状态（对某学科的情绪、挫败感、成就感、焦虑点）
   - 目标承诺（学生提到的考试目标、学习计划承诺）
   - 有效/无效的学习策略（什么方法对这个学生有效）
   - 关键交互时刻（特别成功或特别失败的学习体验）
3. **不要记忆**：具体题目的答案、临时性的技术问题、与学习无关的闲聊
4. 为每条记忆标注置信度（0.0-1.0），反映你对这条记忆准确性的判断

## 输出格式（JSON）
```json
{{
  "facts": [
    {{
      "fact_key": "简洁的键名(英文snake_case)",
      "fact_value": "具体内容描述(中文)",
      "fact_type": "PROFILE|PREFERENCE|ENVIRONMENT|MILESTONE|PROCEDURAL",
      "confidence": 0.85,
      "evidence": "对话中的依据"
    }}
  ],
  "episodes": [
    {{
      "title": "简短标题",
      "content": "详细描述(包含时间上下文)",
      "episode_type": "HIGHLIGHT|FRUSTRATION|KEY_MOMENT|COMMITMENT",
      "emotion_tag": "JOY|PRIDE|FRUSTRATION|ANXIETY|GRATITUDE|DETERMINATION",
      "intensity": 0.7,
      "subject": "MATH|ENGLISH|...",
      "knowledge_points": ["知识点名称"]
    }}
  ],
  "relationship_signals": {{
    "trust_change": 0.05,  // -0.1 到 +0.1
    "rapport_change": 0.03,
    "engagement_level": "ENGAGED|NEUTRAL|RESISTANT",
    "notable_pattern": "观察到的互动模式(如有)"
  }}
}}
```

如果对话中没有值得记忆的信息，返回空数组。
"""
```

### 4.2 记忆检索与注入策略

会话开始时，根据当前上下文智能选择记忆注入。

```python
class MemoryRetrievalStrategy:
    """记忆检索策略 - 决定在会话开始时注入哪些记忆"""

    def retrieve_for_context(self, student_id: int, context: SessionContext,
                             budget: TokenBudget) -> InjectedMemories:
        # Phase 1: 总是注入的核心记忆
        core_facts = self._get_core_facts(student_id)
        # 核心记忆: 学习偏好、关键焦虑、最近目标 (3-5条)

        # Phase 2: 基于当前学科的情境记忆
        if context.subject:
            subject_episodes = self._get_subject_episodes(
                student_id, context.subject, limit=3
            )

        # Phase 3: 基于当前主题/知识点的精准检索
        if context.topic or context.knowledge_point_ids:
            relevant_memories = self._semantic_search(
                student_id,
                query=context.user_query or context.topic,
                top_k=5,
                min_score=0.65
            )

        # Phase 4: 关系状态快照
        relationship = self._get_relationship_state(student_id)

        # Phase 5: 最近交互摘要 (上次对话的总结)
        last_interaction = self._get_last_interaction_summary(student_id)

        # Phase 6: Token 预算分配与裁剪
        memories = self._assemble_and_trim(
            core_facts=core_facts,
            subject_episodes=subject_episodes,
            relevant_memories=relevant_memories,
            relationship=relationship,
            last_interaction=last_interaction,
            budget=budget
        )

        return memories

    def _assemble_and_trim(self, **kwargs) -> InjectedMemories:
        """按优先级分配 Token 预算"""
        budget = kwargs['budget']
        allocated = TokenBudget(remaining=budget.total)

        result = InjectedMemories()

        # 优先级 1: 核心偏好 (必须注入)
        for fact in kwargs['core_facts'][:3]:
            tokens = count_tokens(fact.to_prompt_text())
            if allocated.can_fit(tokens):
                result.add_fact(fact)
                allocated.consume(tokens)

        # 优先级 2: 关系状态摘要 (必须注入)
        rel_text = kwargs['relationship'].to_prompt_summary()
        rel_tokens = count_tokens(rel_text)
        if allocated.can_fit(rel_tokens):
            result.set_relationship(kwargs['relationship'])
            allocated.consume(rel_tokens)

        # 优先级 3: 最近交互摘要
        if kwargs.get('last_interaction'):
            tokens = count_tokens(kwargs['last_interaction'])
            if allocated.can_fit(tokens):
                result.set_last_interaction(kwargs['last_interaction'])
                allocated.consume(tokens)

        # 优先级 4: 情境相关记忆 (按相关性排序)
        for episode in kwargs.get('subject_episodes', []):
            tokens = count_tokens(episode.to_prompt_text())
            if allocated.can_fit(tokens):
                result.add_episode(episode)
                allocated.consume(tokens)

        # 优先级 5: 语义检索结果
        for memory in kwargs.get('relevant_memories', []):
            tokens = count_tokens(memory.to_prompt_text())
            if allocated.can_fit(tokens):
                result.add_relevant(memory)
                allocated.consume(tokens)

        return result
```

### 4.3 记忆衰减模型

模拟人类记忆的遗忘规律，对长期未被访问的记忆降低权重。

```python
import math
from datetime import datetime, timedelta

class MemoryDecayModel:
    """记忆衰减模型 - 基于艾宾浩斯遗忘曲线改进"""

    # 不同记忆类型的衰减速率
    DECAY_RATES = {
        "MILESTONE":     0.02,   # 里程碑几乎不衰减
        "PREFERENCE":    0.05,   # 偏好缓慢变化
        "PROFILE":       0.03,   # 基本档案稳定
        "HIGHLIGHT":     0.08,   # 高光时刻中等衰减
        "KEY_MOMENT":    0.10,   # 关键时刻
        "FRUSTRATION":   0.12,   # 挫折记忆逐渐淡化(积极设计)
        "COMMITMENT":    0.15,   # 承诺需要不断被激活, 否则淡化
        "PROCEDURAL":    0.06,   # 策略记忆较稳定
    }

    # 增强因子: 每次被回忆使用, 衰减分数提升
    RECALL_REINFORCEMENT = 0.15

    # 衰减下限: 低于此值记忆进入"归档"状态
    DECAY_FLOOR = 0.15

    def calculate_decay_score(
        self,
        memory_type: str,
        current_score: float,
        last_accessed: datetime,
        recall_count: int,
        now: datetime = None
    ) -> float:
        """
        计算记忆的当前衰减分数
        
        Returns: 0.0-1.0 的衰减分数
        """
        now = now or datetime.utcnow()
        days_since_access = (now - last_accessed).days

        # 获取衰减率
        base_rate = self.DECAY_RATES.get(memory_type, 0.10)

        # 指数衰减: score * e^(-rate * days)
        decayed = current_score * math.exp(-base_rate * days_since_access)

        # 回忆增强: 每次回忆减缓衰减
        reinforcement = min(recall_count * self.RECALL_REINFORCEMENT, 0.5)
        final_score = decayed + reinforcement * (1.0 - decayed)

        # 上限和下限
        return max(self.DECAY_FLOOR, min(1.0, final_score))

    def should_archive(self, decay_score: float) -> bool:
        """判断记忆是否应该归档"""
        return decay_score <= self.DECAY_FLOOR

    def should_reinforce(self, memory_type: str, days_since_access: int,
                         current_score: float) -> bool:
        """
        判断是否应该在合适的时机"提醒"AI回忆这个记忆
        
        例如: 学生曾经承诺"这周搞懂二次函数"，但之后很久没有提到相关内容
        系统可以提示AI主动询问
        """
        if memory_type == "COMMITMENT" and days_since_access > 7:
            return True
        if current_score < 0.4 and days_since_access < 3:
            return True  # 快要遗忘但最近的记忆
        return False
```

### 4.4 记忆整合任务

定期合并碎片化记忆，生成更连贯的学生画像。

```python
class MemoryConsolidationTask:
    """记忆整合任务 - 类似人类睡眠期间的记忆整合过程"""

    CONSOLIDATION_INTERVAL_HOURS = 24  # 每天整合一次
    MAX_EPISODES_BEFORE_CONSOLIDATION = 50  # 超过50条情景记忆时触发整合
    MAX_FACTS_BEFORE_CONSOLIDATION = 100    # 超过100条事实记忆时触发整合

    def consolidate(self, student_id: int):
        """执行记忆整合"""
        # Step 1: 检查是否需要整合
        if not self._should_consolidate(student_id):
            return

        # Step 2: 衰减更新
        self._update_decay_scores(student_id)

        # Step 3: 归档低分记忆
        archived = self._archive_low_score_memories(student_id)

        # Step 4: 主题聚类合并
        # 将相关的情景记忆聚类, 用 LLM 合并为更高层的总结
        episodes = self._get_active_episodes(student_id)
        clusters = self._cluster_episodes(episodes)
        for cluster in clusters:
            if len(cluster) >= 3:  # 3条以上相关情景才合并
                consolidated = self._llm_consolidate_episodes(cluster)
                self._store_consolidated_episode(student_id, consolidated)
                self._deactivate_original_episodes(cluster)

        # Step 5: 事实去重 & 冲突解决
        facts = self._get_active_facts(student_id)
        self._deduplicate_and_resolve_conflicts(student_id, facts)

        # Step 6: 更新整合日志
        self._log_consolidation(student_id, archived, clusters)

    def _cluster_episodes(self, episodes: List[Episode]) -> List[List[Episode]]:
        """使用向量聚类将相关情景分组"""
        if len(episodes) < 3:
            return []

        embeddings = [ep.embedding for ep in episodes]
        # 使用 Agglomerative Clustering (层次聚类)
        from sklearn.cluster import AgglomerativeClustering

        clusterer = AgglomerativeClustering(
            n_clusters=None,
            metric='cosine',
            linkage='average',
            distance_threshold=0.35  # 余弦距离 < 0.35 归为同类
        )
        labels = clusterer.fit_predict(embeddings)

        clusters = []
        for label in set(labels):
            cluster = [episodes[i] for i in range(len(episodes)) if labels[i] == label]
            if len(cluster) >= 3:
                clusters.append(cluster)

        return clusters

    def _llm_consolidate_episodes(self, episodes: List[Episode]) -> Episode:
        """使用 LLM 将多条相关情景记忆合并为一条总结性记忆"""
        episode_texts = "\n".join([
            f"- [{ep.created_at}] {ep.title}: {ep.content}"
            for ep in episodes
        ])

        prompt = f"""请将以下多条相关的学习情景记忆合并为一条更高层的总结记忆:

{episode_texts}

请输出合并后的记忆，包含:
1. title: 概括性的标题
2. content: 合并后的总结(保留关键细节, 去除冗余)
3. emotion_tag: 主导情感
4. intensity: 情感强度(0-1)
"""

        result = self.llm.generate(prompt)
        return self._parse_consolidated_episode(result, episodes)
```

### 4.5 关系状态动态更新

```python
class RelationshipStateUpdater:
    """更新学生-AI之间的情感关系状态"""

    def update_after_session(
        self,
        student_id: int,
        session_signals: RelationshipSignals
    ) -> RelationshipState:
        """
        会话结束后更新关系状态

        Args:
            session_signals: 从记忆编码管线中提取的关系信号
        """
        state = self.repo.get_or_create(student_id)

        # 信任度更新: 正向交互增加, 负向交互减少
        trust_delta = self._calculate_trust_delta(session_signals)
        state.trust_level = self._clamp(state.trust_level + trust_delta, 0.0, 1.0)

        # 亲密度更新: 会话次数和深度交互增加亲密度
        rapport_delta = self._calculate_rapport_delta(session_signals, state.total_sessions)
        state.rapport_level = self._clamp(state.rapport_level + rapport_delta, 0.0, 1.0)

        # 参与倾向: 根据本次会话的参与度更新
        state.engagement_tendency = self._update_engagement(
            state.engagement_tendency, session_signals.engagement_level
        )

        # 沟通模式: 滑动平均更新
        state.communication_pattern = self._merge_communication_pattern(
            state.communication_pattern, session_signals.communication_metrics
        )

        # 检测关系里程碑
        milestone = self._detect_milestone(state)
        if milestone:
            state.relationship_milestones.append(milestone)

        # 更新计数器
        state.total_sessions += 1
        if session_signals.sentiment == "POSITIVE":
            state.positive_interactions += 1
        state.last_interaction_at = datetime.utcnow()
        state.last_interaction_summary = session_signals.session_summary

        self.repo.save(state)
        return state

    def _calculate_trust_delta(self, signals: RelationshipSignals) -> float:
        """
        信任度变化计算
        
        信任度增加的触发:
        - 学生接受了AI的建议并成功
        - 学生表达了感谢/认可
        - 学生主动分享困难
        
        信任度减少的触发:
        - 学生质疑AI的解答(且AI确实有误)
        - 学生明确表示不信任
        - 会话中频繁中断/放弃
        """
        delta = signals.trust_change  # 从LLM提取的基础值

        # 边界递减效应: 信任度越高, 每次增加越少
        if delta > 0:
            delta *= (1.0 - signals.current_trust * 0.5)

        # 信任度低时, 增加更快(建立信任期)
        if signals.current_trust < 0.5 and delta > 0:
            delta *= 1.2

        # 单次变化上限
        return max(-0.15, min(0.10, delta))
```

---

## 5. 记忆注入到 AI 对话的完整流程

### 5.1 时序图

```text
┌──────┐     ┌──────────┐     ┌──────────┐     ┌─────────┐    ┌────────┐
│Client│     │AI对话引擎 │     │记忆注入API│     │记忆服务  │    │向量库   │
└──┬───┘     └────┬─────┘     └────┬─────┘     └────┬────┘    └───┬────┘
   │              │                │                 │             │
   │ 1.发起对话    │                │                 │             │
   │─────────────>│                │                 │             │
   │              │                │                 │             │
   │              │ 2.请求记忆注入  │                 │             │
   │              │───────────────>│                 │             │
   │              │                │                 │             │
   │              │                │ 3.加载核心记忆   │             │
   │              │                │────────────────>│             │
   │              │                │                 │             │
   │              │                │                 │ 4.语义检索   │
   │              │                │                 │────────────>│
   │              │                │                 │<────────────│
   │              │                │                 │             │
   │              │                │ 5.返回记忆集     │             │
   │              │                │<────────────────│             │
   │              │                │                 │             │
   │              │                │ 6.组装Prompt片段│             │
   │              │<───────────────│                 │             │
   │              │                │                 │             │
   │              │ 7.构建完整System Prompt           │             │
   │              │ (记忆 + 场景模板 + 安全规则)      │             │
   │              │                │                 │             │
   │              │ 8.调用LLM      │                 │             │
   │              │─────────────────────────────────────────────>  │
   │              │<─────────────────────────────────────────────  │
   │              │                │                 │             │
   │ 9.流式返回    │                │                 │             │
   │<─────────────│                │                 │             │
   │              │                │                 │             │
   │ 对话结束      │                │                 │             │
   │─────────────>│                │                 │             │
   │              │                │                 │             │
   │              │ 10.触发记忆编码 │                 │             │
   │              │───────────────>│                 │             │
   │              │                │ 11.LLM提取记忆   │             │
   │              │                │ 12.去重/存储     │             │
   │              │                │ 13.更新关系状态  │             │
   │              │                │────────────────>│             │
   │              │                │                 │ 14.写入向量  │
   │              │                │                 │────────────>│
```

### 5.2 System Prompt 中的记忆注入示例

```text
你是一位学生学习伙伴。请根据以下关于这位学生的信息，提供个性化的辅导。

## 关于这位学生
- 姓名: 小明 (化名)    年级: 初二    教材版本: 人教版
- 学习偏好: 喜欢图文结合讲解，不喜欢大段纯文字；偏好分步骤、有条理的分析
- 学科状态: 数学(中等偏上, 函数较弱)、英语(较好, 口语自信)、物理(刚接触, 有兴趣)
- 注意事项: 对函数类题目有一定焦虑, 建议用画图法引导; 鼓励效果好, 不要施压

## 最近的学习经历
- 上次学习(2026-06-28): 完成了二次函数练习, 正确率67%, 通过画图理解了顶点公式
- 近期目标: 期末考试数学目标90分, 还有2周
- 上次高光时刻: 6月20日成功理解二次函数图像变换, 表现出很大成就感

## 互动风格建议
- 信任度: 较高 (0.75/1.0)
- 参与度: 积极
- 鼓励方式: 正向反馈+具体表扬 > 泛泛鼓励
- 可以适度幽默

## 当前对话上下文
- 场景: AI辅导
- 学科: 数学
- 主题: 二次函数
```

---

## 6. 关键代码结构

### 6.1 项目结构

```text
com.primetop.memory
├── controller
│   └── MemoryController.java          # REST API
├── service
│   ├── MemoryEncodeService.java       # 记忆编码服务
│   ├── MemoryRetrievalService.java    # 记忆检索服务
│   ├── MemoryDecayService.java        # 记忆衰减服务
│   ├── MemoryConsolidationService.java# 记忆整合服务
│   ├── RelationshipStateService.java  # 关系状态管理
│   ├── MemoryPrivacyService.java      # 记忆隐私管理
│   └── MemoryPromptAssembler.java     # Prompt组装器
├── domain
│   ├── entity
│   │   ├── MemoryFact.java
│   │   ├── MemoryEpisode.java
│   │   ├── RelationshipState.java
│   │   └── ConsolidationLog.java
│   ├── enums
│   │   ├── MemoryType.java
│   │   ├── EpisodeType.java
│   │   ├── EmotionTag.java
│   │   └── FactType.java
│   └── dto
│       ├── MemoryInjectRequest.java
│       ├── MemoryInjectResponse.java
│       ├── MemoryEncodeRequest.java
│       └── MemorySearchRequest.java
├── infrastructure
│   ├── repository
│   │   ├── MemoryFactRepository.java
│   │   ├── MemoryEpisodeRepository.java
│   │   ├── RelationshipStateRepository.java
│   │   └── MemoryEmbeddingRepository.java
│   ├── cache
│   │   └── MemoryCacheManager.java
│   └── llm
│       ├── MemoryExtractionLLMClient.java
│       └── MemoryConsolidationLLMClient.java
└── config
    ├── MemoryProperties.java
    └── MemoryScheduleConfig.java
```

### 6.2 核心服务类

```java
/**
 * 记忆编码服务 - 从会话中提取并存储记忆
 */
@Service
@Slf4j
public class MemoryEncodeService {

    @Autowired
    private MemoryExtractionLLMClient llmClient;

    @Autowired
    private MemoryFactRepository factRepository;

    @Autowired
    private MemoryEpisodeRepository episodeRepository;

    @Autowired
    private MemoryEmbeddingRepository embeddingRepository;

    @Autowired
    private RelationshipStateService relationshipService;

    @Autowired
    private MemoryCacheManager cacheManager;

    /**
     * 编码会话记忆
     */
    @Async("memoryEncodeExecutor")
    public CompletableFuture<EncodeResult> encodeSessionMemories(
            Long studentId, Long sessionId, List<Long> conversationIds,
            List<LearningEvent> learningEvents, String sessionSummary) {

        // 1. 获取对话内容
        String conversationText = conversationService.getConversationText(conversationIds);

        // 2. 隐私过滤
        conversationText = privacyFilter.filter(conversationText);
        if (StringUtils.isBlank(conversationText)) {
            return CompletableFuture.completedFuture(EncodeResult.empty());
        }

        // 3. LLM 提取记忆
        MemoryExtractionResult extraction = llmClient.extractMemories(
            conversationText, learningEvents, sessionSummary
        );

        // 4. 去重 & 冲突检测
        List<MemoryFact> newFacts = deduplicateFacts(studentId, extraction.getFacts());
        List<MemoryEpisode> newEpisodes = deduplicateEpisodes(studentId, extraction.getEpisodes());

        // 5. 存储事实记忆
        for (MemoryFact fact : newFacts) {
            fact.setStudentId(studentId);
            fact.setSourceSessionId(sessionId);
            fact.setSourceType(SourceType.AI_EXTRACT);
            factRepository.save(fact);
        }

        // 6. 存储情景记忆 + 向量嵌入
        for (MemoryEpisode episode : newEpisodes) {
            episode.setStudentId(studentId);
            episode.setSourceSessionId(sessionId);
            episodeRepository.save(episode);

            // 生成向量嵌入
            String embedText = episode.getTitle() + " " + episode.getContent();
            float[] embedding = embeddingService.embed(embedText);
            embeddingRepository.save(studentId, "EPISODE", episode.getId(),
                                    embedText, embedding);
        }

        // 7. 更新关系状态
        RelationshipStateUpdate relUpdate = extraction.getRelationshipSignals();
        relationshipService.updateAfterSession(studentId, relUpdate);

        // 8. 清除缓存(让下次会话重新加载)
        cacheManager.evictSessionMemory(studentId);

        // 9. 更新统计
        cacheManager.incrementMemoryCount(studentId, newFacts.size(), newEpisodes.size());

        log.info("记忆编码完成: studentId={}, sessionId={}, facts={}, episodes={}",
                studentId, sessionId, newFacts.size(), newEpisodes.size());

        return CompletableFuture.completedFuture(
            EncodeResult.of(newFacts, newEpisodes, relUpdate)
        );
    }

    /**
     * 事实记忆去重 - 语义相似度比对
     */
    private List<MemoryFact> deduplicateFacts(Long studentId, List<MemoryFact> newFacts) {
        List<MemoryFact> existing = factRepository.findActiveByStudentId(studentId);
        List<MemoryFact> result = new ArrayList<>();

        for (MemoryFact newFact : newFacts) {
            Optional<MemoryFact> similar = existing.stream()
                .filter(e -> e.getFactKey().equals(newFact.getFactKey()))
                .findFirst();

            if (similar.isPresent()) {
                // 相同key: 合并更新
                MemoryFact existingFact = similar.get();
                existingFact.setFactValue(newFact.getFactValue());
                existingFact.setConfidence(
                    Math.max(existingFact.getConfidence(), newFact.getConfidence())
                );
                existingFact.setUpdatedAt(LocalDateTime.now());
                factRepository.save(existingFact);
            } else {
                // 语义相似度检测
                boolean isDuplicate = false;
                for (MemoryFact e : existing) {
                    float similarity = semanticSimilarity(
                        newFact.getFactValue(), e.getFactValue()
                    );
                    if (similarity > 0.85) {
                        // 合并到已有记忆
                        e.setFactValue(mergeFactValues(e.getFactValue(), newFact.getFactValue()));
                        e.setUpdatedAt(LocalDateTime.now());
                        factRepository.save(e);
                        isDuplicate = true;
                        break;
                    }
                }
                if (!isDuplicate) {
                    result.add(newFact);
                }
            }
        }
        return result;
    }
}
```

### 6.3 记忆检索服务

```java
/**
 * 记忆检索服务 - 为新会话召回相关记忆
 */
@Service
@Slf4j
public class MemoryRetrievalService {

    @Autowired
    private MemoryFactRepository factRepository;

    @Autowired
    private MemoryEpisodeRepository episodeRepository;

    @Autowired
    private MemoryEmbeddingRepository embeddingRepository;

    @Autowired
    private RelationshipStateService relationshipService;

    @Autowired
    private MemoryPromptAssembler promptAssembler;

    /**
     * 为会话上下文检索记忆
     */
    public MemoryInjectResponse retrieveForContext(
            Long studentId, SessionContext context, InjectOptions options) {

        // 1. 检查缓存
        MemoryInjectResponse cached = checkCache(studentId, context);
        if (cached != null) {
            return cached;
        }

        // 2. 并行检索各类记忆
        CompletableFuture<List<MemoryFact>> factsFuture = CompletableFuture.supplyAsync(
            () -> retrieveCoreFacts(studentId, options.getMaxFacts())
        );

        CompletableFuture<List<MemoryEpisode>> episodesFuture = CompletableFuture.supplyAsync(
            () -> retrieveRelevantEpisodes(studentId, context, options.getMaxEpisodes())
        );

        CompletableFuture<RelationshipState> relFuture = CompletableFuture.supplyAsync(
            () -> relationshipService.getState(studentId)
        );

        CompletableFuture<String> lastInteractionFuture = CompletableFuture.supplyAsync(
            () -> relationshipService.getLastInteractionSummary(studentId)
        );

        // 3. 等待全部完成
        CompletableFuture.allOf(factsFuture, episodesFuture, relFuture, lastInteractionFuture).join();

        List<MemoryFact> facts = factsFuture.join();
        List<MemoryEpisode> episodes = episodesFuture.join();
        RelationshipState relationship = relFuture.join();
        String lastInteraction = lastInteractionFuture.join();

        // 4. 组装 Prompt 片段
        String promptSnippet = promptAssembler.assemble(
            facts, episodes, relationship, lastInteraction, options.getTokenBudget()
        );

        // 5. 更新访问计数
        updateAccessCounts(facts, episodes);

        // 6. 构建响应
        MemoryInjectResponse response = MemoryInjectResponse.builder()
            .facts(facts.stream().map(this::toFactDTO).collect(Collectors.toList()))
            .episodes(episodes.stream().map(this::toEpisodeDTO).collect(Collectors.toList()))
            .relationship(toRelationshipDTO(relationship))
            .lastInteractionSummary(lastInteraction)
            .promptSnippet(promptSnippet)
            .tokenUsed(countTokens(promptSnippet))
            .build();

        // 7. 缓存结果
        cacheResult(studentId, context, response);

        return response;
    }

    /**
     * 检索核心事实记忆(总是需要的)
     */
    private List<MemoryFact> retrieveCoreFacts(Long studentId, int maxCount) {
        // 按优先级获取: PREFERENCE > PROFILE > MILESTONE > PROCEDURAL
        List<MemoryFact> facts = factRepository.findActiveByStudentIdOrderByPriority(
            studentId, maxCount * 2  // 获取更多, 然后裁剪
        );

        return facts.stream()
            .sorted(Comparator.comparing(MemoryFact::getDecayScore).reversed())
            .limit(maxCount)
            .collect(Collectors.toList());
    }

    /**
     * 检索与当前上下文相关的情景记忆
     */
    private List<MemoryEpisode> retrieveRelevantEpisodes(
            Long studentId, SessionContext context, int maxCount) {

        // 如果有用户查询, 做语义检索
        if (StringUtils.isNotBlank(context.getUserQuery())) {
            float[] queryEmbedding = embeddingService.embed(context.getUserQuery());

            List<MemorySearchResult> results = embeddingRepository.search(
                studentId, "EPISODE", queryEmbedding, maxCount * 2, 0.65f
            );

            // 按学科过滤
            if (context.getSubject() != null) {
                results = results.stream()
                    .filter(r -> {
                        MemoryEpisode ep = episodeRepository.findById(r.getSourceId());
                        return ep != null && (
                            ep.getSubjectCode() == null ||
                            ep.getSubjectCode().equals(context.getSubject())
                        );
                    })
                    .collect(Collectors.toList());
            }

            return results.stream()
                .limit(maxCount)
                .map(r -> episodeRepository.findById(r.getSourceId()))
                .filter(Objects::nonNull)
                .collect(Collectors.toList());
        }

        // 无查询: 返回最近的情景
        return episodeRepository.findRecentActiveByStudentId(
            studentId, maxCount, LocalDateTime.now().minusDays(30)
        );
    }
}
```

---

## 7. 记忆隐私与安全

### 7.1 隐私原则

| 原则 | 实现方式 |
|------|---------|
| **最小化记忆** | 只记忆有教育价值的信息，不记忆隐私敏感内容 |
| **用户可知** | 用户可以在"我的→AI记忆"页面查看所有记忆 |
| **用户可控** | 用户可以删除任何记忆，或关闭记忆功能 |
| **自动过期** | 超过保留期的记忆自动归档/删除 |
| **加密存储** | 记忆内容在数据库中加密，向量库中匿名化 |
| **不跨用户** | 记忆严格按 student_id 隔离，绝不跨用户检索 |

### 7.2 敏感内容过滤

```python
class MemoryPrivacyFilter:
    """记忆隐私过滤器 - 决定什么可以被记忆"""

    # 绝对不可记忆的内容
    FORBIDDEN_PATTERNS = [
        r'\d{11}',                    # 手机号
        r'\d{17}[\dXx]',              # 身份证号
        r'[\w.]+@[\w.]+',            # 邮箱
        r'(?:银行卡|卡号)\s*\d+',      # 银行卡号
        r'(?:家庭住址|我家在|我住在)\s*[\u4e00-\u9fa5]{2,}',  # 家庭住址
        r'(?:密码|支付密码|验证码)\s*\d+',                      # 密码
    ]

    # 可记忆但需标记为"敏感"的内容
    SENSITIVE_TOPICS = [
        '家庭矛盾', '父母争吵', '经济困难',
        '身体发育', '校园欺凌', '心理问题',
    ]

    def filter(self, text: str) -> str:
        """过滤不可记忆的内容"""
        import re
        for pattern in self.FORBIDDEN_PATTERNS:
            text = re.sub(pattern, '[已过滤]', text)
        return text

    def classify_sensitivity(self, memory_text: str) -> str:
        """分类记忆的敏感等级"""
        for topic in self.SENSITIVE_TOPICS:
            if topic in memory_text:
                return "SENSITIVE"  # 可存储, 但仅在高信任度时注入

        return "NORMAL"

    def should_remember(self, proposed_memory: dict) -> bool:
        """判断一条提议的记忆是否应该被存储"""
        # 不可记忆的内容
        if proposed_memory.get('fact_type') in ['POLITICAL', 'RELIGIOUS', 'MEDICAL']:
            return False

        # 检查是否包含禁止内容
        for pattern in self.FORBIDDEN_PATTERNS:
            import re
            if re.search(pattern, proposed_memory.get('fact_value', '')):
                return False

        return True
```

### 7.3 未成年人特殊保护

```java
/**
 * 未成年人记忆保护策略
 */
@Component
public class MinorMemoryProtection {

    private static final int MAX_MEMORIES_PER_MINOR = 200;    // 未成年最大记忆数
    private static final int MAX_RETENTION_DAYS = 365;        // 未成年记忆最长保留期
    private static final int AUTO_DELETE_AGE = 18;            // 满18岁后提示清理

    /**
     * 检查记忆数量限制
     */
    public void checkMemoryLimit(Long studentId, int currentCount) {
        if (currentCount >= MAX_MEMORIES_PER_MINOR) {
            // 触发强制整合: 合并碎片记忆释放空间
            eventBus.publish(new MemoryConsolidationEvent(
                studentId,
                ConsolidationType.FORCED_CONSOLIDATION,
                "达到未成年人记忆数量上限"
            ));
        }
    }

    /**
     * 过期记忆清理 (每天定时执行)
     */
    @Scheduled(cron = "0 0 3 * * *")  // 每天凌晨3点
    public void cleanExpiredMinorMemories() {
        List<Long> minorStudentIds = userService.getMinorStudentIds();
        
        for (Long studentId : minorStudentIds) {
            memoryRepository.deleteMemoriesOlderThan(
                studentId, MAX_RETENTION_DAYS
            );
        }
        
        log.info("未成年人过期记忆清理完成, 处理用户数: {}", minorStudentIds.size());
    }
}
```

---

## 8. 定时任务调度

```yaml
# 定时任务配置
memory_scheduled_tasks:
  - name: memory-decay-update
    description: 更新所有学生的记忆衰减分数
    cron: "0 0 4 * * *"          # 每天凌晨4点
    batch_size: 500              # 每批处理500个学生
    throttle_ms: 100             # 每批间隔100ms

  - name: memory-consolidation
    description: 记忆整合(聚类合并、去重)
    cron: "0 30 4 * * *"         # 每天凌晨4:30
    condition: "episodes >= 30 OR facts >= 50"

  - name: memory-archive-cleanup
    description: 归档低分记忆, 清理过期记忆
    cron: "0 0 5 * * *"          # 每天凌晨5点
    
  - name: relationship-stale-check
    description: 关系状态衰减(长时间未交互的学生)
    cron: "0 0 6 * * 1"          # 每周一早上6点
    
  - name: memory-stats-report
    description: 生成记忆统计报告
    cron: "0 0 2 * * 1"          # 每周一凌晨2点
```

---

## 9. 性能设计

### 9.1 性能指标

| 操作 | 目标延迟 | 说明 |
|------|---------|------|
| 记忆注入(会话开始) | < 100ms | P95, 含缓存命中 |
| 记忆注入(缓存未命中) | < 300ms | P95, 含向量检索 |
| 记忆编码(异步) | < 5s | 单次会话编码 |
| 记忆语义检索 | < 50ms | 单次向量搜索 |
| 记忆整合(单学生) | < 30s | 全量整合 |
| 关系状态读取 | < 10ms | Redis缓存命中 |

### 9.2 批量优化

```java
/**
 * 记忆注入的批量预加载
 * 在学生打开APP时就预加载常用记忆, 而不是等到发起对话时
 */
@Component
public class MemoryPreloader {

    /**
     * APP启动时预加载
     */
    @EventListener(ApplicationLaunchEvent.class)
    public void preloadOnAppStart(Long studentId) {
        // 预加载核心记忆到Redis
        CompletionStage<List<MemoryFact>> factsFuture = 
            CompletableFuture.supplyAsync(() -> 
                factRepository.findCoreFacts(studentId)
            );

        CompletionStage<RelationshipState> relFuture = 
            CompletableFuture.supplyAsync(() -> 
                relationshipService.getState(studentId)
            );

        // 写入缓存, 等对话时直接命中
        CompletableFuture.allOf(
            factsFuture.thenAccept(facts -> cacheManager.cacheFacts(studentId, facts)),
            relFuture.thenAccept(rel -> cacheManager.cacheRelationship(studentId, rel))
        );
    }
}
```

### 9.3 向量检索优化

```sql
-- 使用 IVFFlat 索引替代 HNSW (当数据量大时性能更好)
-- 每个学生的向量数量通常 < 500, HNSW 更适合
-- 如果全平台向量总数 > 1M, 考虑分区索引

-- 查询优化: 先过滤 student_id, 再做向量搜索
SELECT e.id, e.content_text, 1 - (e.embedding <=> $1) AS score
FROM student_memory_embedding e
WHERE e.student_id = $2
  AND e.memory_type = $3
  AND (e.metadata->>'subject' IS NULL OR e.metadata->>'subject' = $4)
ORDER BY e.embedding <=> $1
LIMIT $5;

-- 为过滤条件建立复合索引
CREATE INDEX idx_embedding_student_type_subject 
ON student_memory_embedding (student_id, memory_type) 
INCLUDE (metadata);
```

---

## 10. 监控与告警

### 10.1 关键监控指标

| 指标 | 类型 | 告警阈值 |
|------|------|---------|
| `memory.encode.failure_rate` | 编码失败率 | > 5% |
| `memory.inject.latency_p95` | 注入延迟P95 | > 300ms |
| `memory.search.latency_p95` | 检索延迟P95 | > 100ms |
| `memory.consolidation.duration` | 整合执行时长 | > 60s/学生 |
| `memory.storage.per_student_avg` | 每学生平均记忆数 | > 200 条 |
| `memory.embedding.api.error_rate` | 向量化API错误率 | > 2% |
| `relationship.trust.avg` | 全平台平均信任度 | 持续下降趋势 |
| `memory.user_delete.rate` | 用户主动删除率 | > 10%/月 |

### 10.2 Prometheus 指标埋点

```java
@Component
public class MemoryMetrics {

    private final MeterRegistry registry;

    private final Counter encodeSuccessCounter;
    private final Counter encodeFailureCounter;
    private final Timer injectLatencyTimer;
    private final Counter memoryCreatedCounter;

    public MemoryMetrics(MeterRegistry registry) {
        this.registry = registry;
        this.encodeSuccessCounter = Counter.builder("memory.encode.success")
            .description("记忆编码成功次数")
            .register(registry);
        this.encodeFailureCounter = Counter.builder("memory.encode.failure")
            .description("记忆编码失败次数")
            .register(registry);
        this.injectLatencyTimer = Timer.builder("memory.inject.latency")
            .description("记忆注入延迟")
            .publishPercentiles(0.5, 0.95, 0.99)
            .register(registry);
        this.memoryCreatedCounter = Counter.builder("memory.created")
            .description("新创建记忆数")
            .tag("type", "")
            .register(registry);
    }

    public void recordEncodeSuccess() {
        encodeSuccessCounter.increment();
    }

    public void recordEncodeFailure(String reason) {
        encodeFailureCounter.increment();
        Counter.builder("memory.encode.failure.by_reason")
            .tag("reason", reason)
            .register(registry)
            .increment();
    }

    public Timer.Sample startInjectTimer() {
        return Timer.start(registry);
    }

    public void recordMemoryCreated(String memoryType) {
        Counter.builder("memory.created")
            .tag("type", memoryType)
            .register(registry)
            .increment();
    }
}
```

---

## 11. 状态流转

### 11.1 记忆生命周期状态机

```text
                    ┌──────────┐
    LLM提取完成 ────>│  ACTIVE   │<──── 用户恢复
                    └────┬─────┘
                         │
            ┌────────────┼────────────┐
            │            │            │
            ▼            ▼            ▼
     ┌──────────┐ ┌──────────┐ ┌──────────┐
     │ REINFORCED│ │ DECAYING │ │ DELETED  │
     │ (被回忆后) │ │ (衰减中) │ │(用户删除)│
     └────┬─────┘ └────┬─────┘ └──────────┘
          │            │
          │            ▼
          │     ┌──────────┐
          │     │ ARCHIVED  │
          │     │ (已归档)  │
          │     └──────────┘
          │
          └──────────> 回到 ACTIVE
```

### 11.2 关系状态演变

```text
首次交互 (trust=0.30, rapport=0.20)
    │
    ├─ 正向交互(3-5次) ──> 建立期 (trust=0.50, rapport=0.40)
    │                         │
    │                    ├─ 持续正向 ──> 稳定期 (trust=0.75, rapport=0.65)
    │                    │                    │
    │                    │              ├─ 深度信任 ──> 伙伴期 (trust=0.90, rapport=0.80)
    │                    │              │
    │                    │              └─ 负向交互 ──> 修复期 (trust↓0.15, rapport↓0.10)
    │                    │
    │                    └─ 负向交互 ──> 观察期 (trust↓0.10, rapport↓0.05)
    │
    └─ 负向交互 ──> 戒备期 (trust↓0.10) ──> 需要多次正向交互才能恢复
```

---

## 12. 测试策略

### 12.1 单元测试重点

| 测试目标 | 关键测试用例 |
|---------|------------|
| 记忆提取 | 给定对话文本，验证提取出的 facts 和 episodes 正确性 |
| 去重逻辑 | 相同语义的新旧记忆能正确合并 |
| 衰减模型 | 不同类型记忆的衰减速率符合预期 |
| Token 预算分配 | 注入记忆不超过 Token 预算 |
| 隐私过滤 | 敏感信息被正确过滤 |
| 关系状态更新 | 信任度变化在合理范围内 |

### 12.2 集成测试场景

```gherkin
Scenario: 完整的记忆编码-检索-注入流程
  Given 一个新学生完成了首次 AI 对话
  When 触发记忆编码
  Then 应生成至少 1 条语义记忆
  And 关系状态应被初始化
  When 该学生发起第二次对话
  Then 注入的记忆应包含上次对话的相关信息
  And Prompt 片段应包含学生的学习偏好

Scenario: 记忆整合流程
  Given 一个学生有 50 条情景记忆
  When 触发记忆整合
  Then 相关的情景记忆应被聚类合并
  And 合并后的记忆应保留关键信息
  And 原始记忆应被标记为非活跃

Scenario: 隐私保护
  Given 学生在对话中提到了手机号
  When 触发记忆编码
  Then 记忆中的手机号应被替换为 [已过滤]
  And 不应创建包含手机号的记忆条目
```

### 12.3 压力测试

| 场景 | 目标 |
|------|------|
| 1000 并发记忆注入 | P95 延迟 < 500ms |
| 单学生 500 条记忆检索 | 延迟 < 200ms |
| 10万学生同时编码 | 系统稳定，无 OOM |

---

## 13. 配置参数

```yaml
# application-memory.yml
primetop:
  memory:
    # 记忆编码配置
    encode:
      max-facts-per-session: 5        # 单次会话最多提取事实记忆数
      max-episodes-per-session: 3     # 单次会话最多提取情景记忆数
      min-confidence: 0.60            # 最低置信度, 低于此值不存储
      async-pool-size: 8              # 异步编码线程池大小
      llm-timeout-ms: 15000           # LLM 调用超时

    # 记忆注入配置
    inject:
      default-token-budget: 1000      # 默认 Token 预算
      max-token-budget: 2000          # 最大 Token 预算
      cache-ttl-minutes: 120          # 会话热缓存 TTL
      
    # 向量检索配置
    search:
      top-k: 5                        # 默认返回结果数
      min-score: 0.65                 # 最低相似度阈值
      embedding-model: "text-embedding-3-small"
      embedding-dim: 1536
      
    # 衰减配置
    decay:
      enable: true
      schedule-cron: "0 0 4 * * *"
      archive-threshold: 0.15
      reinforcement-per-recall: 0.15
      
    # 整合配置
    consolidation:
      schedule-cron: "0 30 4 * * *"
      trigger-episodes-threshold: 30
      trigger-facts-threshold: 50
      cluster-distance-threshold: 0.35
      
    # 隐私配置
    privacy:
      max-memories-per-minor: 200
      max-retention-days-minor: 365
      forbidden-patterns-enabled: true
      
    # 限流
    rate-limit:
      encode-per-student-per-day: 100
      search-per-student-per-minute: 30
```

---

## 14. 部署与扩容

### 14.1 资源评估

| 用户规模 | 记忆存储(MySQL) | 向量库(pgvector) | Redis缓存 | LLM调用量 |
|---------|----------------|------------------|----------|----------|
| 10万 DAU | ~50GB | ~20GB | ~2GB | ~5万次/天 |
| 50万 DAU | ~250GB | ~100GB | ~10GB | ~25万次/天 |
| 100万 DAU | ~500GB | ~200GB | ~20GB | ~50万次/天 |

> 估算依据: 每学生平均 50 条事实 + 30 条情景, 每条情景含 1536 维向量(6KB)

### 14.2 扩容策略

- **MySQL**: 按 `student_id` 分库，16库 × 16表 = 256表
- **pgvector**: 按 `student_id` 分区，使用 Citus 或独立 PostgreSQL 实例分片
- **Redis**: 集群模式，按 `student_id % N` 分片
- **LLM 调用**: 使用消息队列削峰，编码任务容忍延迟(异步)

---

## 15. 未来演进方向

| 阶段 | 能力 | 说明 |
|------|------|------|
| V1.0 | 基础记忆 | 语义记忆 + 情景记忆 + 关系状态 |
| V1.5 | 智能整合 | 自动聚类合并 + 衰减管理 + 隐私管理 |
| V2.0 | 主动回忆 | AI 主动引用过去的记忆, 如"还记得上次你说函数很难吗?" |
| V2.5 | 跨模态记忆 | 记住学生的手写笔记图片、语音情感特征 |
| V3.0 | 群体记忆 | 匿名化的群体学习模式记忆, 如"和你同水平的同学通常在这个知识点上..." |

---

*文档版本: v1.0*
*创建日期: 2026-06-30*
*模块负责人: PrimeTop 架构组*
