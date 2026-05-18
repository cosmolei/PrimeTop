# AI 智能辅导 - 详细设计文档

## 1. 模块概述

AI 智能辅导是 PrimeTop 的核心引擎，为学生提供随时可用的 AI 学习助手。支持文字、语音、图片多模态输入，根据用户学段、年级、学科、教材版本和学习进度，输出符合认知水平的讲解内容。

### 1.1 功能范围

| 功能 | 优先级 | MVP |
|------|--------|-----|
| 文字问答 | P0 | ✅ |
| 多轮连续追问 | P0 | ✅ |
| 分学段讲解（适龄化输出） | P0 | ✅ |
| 分步提示（先思路后答案） | P0 | ✅ |
| 知识点关联（映射教材章节） | P0 | ✅ |
| 语音提问 | P1 | ❌ |
| 图片输入（非拍题场景） | P1 | ❌ |
| 追问快捷操作（再讲简单点、生成同类题等） | P1 | ❌ |
| 安全过滤 | P0 | ✅ |

---

## 2. 核心概念与数据结构

### 2.1 对话会话表 `ai_conversations`

```sql
CREATE TABLE ai_conversations (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '会话ID',
    user_id         BIGINT NOT NULL COMMENT '用户ID',
    title           VARCHAR(100) COMMENT '会话标题（取首条消息摘要）',
    subject         VARCHAR(20) COMMENT '学科: chinese/math/english/physics/chemistry/biology/history/geography/politics',
    stage           VARCHAR(20) NOT NULL COMMENT '学段（快照）',
    grade           INT NOT NULL COMMENT '年级（快照）',
    textbook_edition VARCHAR(50) COMMENT '教材版本（快照）',
    status          TINYINT NOT NULL DEFAULT 1 COMMENT '状态: 0=已删除, 1=活跃, 2=已归档',
    message_count   INT NOT NULL DEFAULT 0 COMMENT '消息计数',
    last_message_at DATETIME COMMENT '最后消息时间',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_user_status (user_id, status),
    INDEX idx_last_msg (user_id, last_message_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI对话会话';
```

### 2.2 对话消息表 `ai_messages`

```sql
CREATE TABLE ai_messages (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '消息ID',
    conversation_id BIGINT NOT NULL COMMENT '会话ID',
    user_id         BIGINT NOT NULL COMMENT '用户ID',
    role            VARCHAR(20) NOT NULL COMMENT '角色: user/assistant/system',
    content_type    VARCHAR(20) NOT NULL DEFAULT 'text' COMMENT '内容类型: text/image/voice/formula',
    content         TEXT NOT NULL COMMENT '消息正文（Markdown格式）',
    -- 结构化回答字段（assistant消息专用）
    thinking        TEXT COMMENT 'AI思考过程（可选展示）',
    answer_summary  VARCHAR(500) COMMENT '一句话总结',
    key_points      JSON COMMENT '关键知识点 ["二元一次方程","代入消元法"]',
    related_kp_ids  JSON COMMENT '关联知识点ID [1001,1002]',
    related_chapter VARCHAR(200) COMMENT '关联教材章节 "人教版七年级上册第三章"',
    step_count      INT COMMENT '解题步骤数（理科题）',
    -- 元数据
    model_name      VARCHAR(50) COMMENT '使用的模型: glm-5/gpt-4o/deepseek-r1',
    prompt_version  VARCHAR(20) COMMENT 'Prompt模板版本',
    input_tokens    INT COMMENT '输入token数',
    output_tokens   INT COMMENT '输出token数',
    latency_ms      INT COMMENT '响应耗时(ms)',
    -- 用户反馈
    user_rating     TINYINT COMMENT '用户评分: 1=踩, 2=踩后纠错, null=未评, 3=有用, 4=非常好',
    feedback_tag    VARCHAR(50) COMMENT '反馈标签: wrong_answer/too_complex/off_topic/good',
    feedback_text   VARCHAR(500) COMMENT '反馈文字',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_conv_id (conversation_id, created_at),
    INDEX idx_user_created (user_id, created_at DESC),
    INDEX idx_model_latency (model_name, latency_ms)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI对话消息';
```

### 2.3 消息附件表 `ai_message_attachments`

```sql
CREATE TABLE ai_message_attachments (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    message_id      BIGINT NOT NULL COMMENT '消息ID',
    file_type       VARCHAR(20) NOT NULL COMMENT '类型: image/voice/formula_image',
    file_url        VARCHAR(500) NOT NULL COMMENT '文件URL',
    file_size       INT COMMENT '文件大小(bytes)',
    width           INT COMMENT '图片宽度',
    height          INT COMMENT '图片高度',
    duration_sec    INT COMMENT '语音时长(秒)',
    ocr_text        TEXT COMMENT 'OCR识别文本（图片类型）',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_message (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='消息附件';
```

### 2.4 知识点映射表 `knowledge_points`（关联模块，此处定义接口）

```sql
-- 由内容服务管理，AI服务读取
CREATE TABLE knowledge_points (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    subject         VARCHAR(20) NOT NULL,
    stage           VARCHAR(20) NOT NULL,
    grade           INT NOT NULL,
    chapter_id      BIGINT COMMENT '所属章节ID',
    name            VARCHAR(100) NOT NULL COMMENT '知识点名称',
    description     TEXT COMMENT '知识点描述',
    difficulty      TINYINT COMMENT '难度: 1-5',
    prerequisites   JSON COMMENT '前置知识点ID列表',
    keywords        JSON COMMENT '关键词 ["二元一次方程","消元法"]',
    embedding       BLOB COMMENT '向量嵌入（用于RAG检索）',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_subject_stage (subject, stage, grade),
    INDEX idx_chapter (chapter_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='知识点';
```

### 2.5 Prompt 模板配置表 `prompt_templates`

```sql
CREATE TABLE prompt_templates (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    scene           VARCHAR(50) NOT NULL COMMENT '场景: general_qa/math_solve/essay_review/recite/young_learner',
    stage           VARCHAR(20) NOT NULL DEFAULT '*' COMMENT '学段: */preschool/primary/junior/senior',
    subject         VARCHAR(20) NOT NULL DEFAULT '*' COMMENT '学科: */chinese/math/...',
    system_prompt   TEXT NOT NULL COMMENT '系统提示词',
    output_format   TEXT COMMENT '输出格式要求',
    safety_rules    TEXT COMMENT '安全规则附加',
    version         INT NOT NULL DEFAULT 1 COMMENT '版本号',
    is_active       TINYINT NOT NULL DEFAULT 1 COMMENT '是否启用',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_scene_version (scene, stage, subject, version),
    INDEX idx_active (scene, stage, subject, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Prompt模板配置';
```

---

## 3. AI 调用架构

### 3.1 整体调用链路

```
用户发送消息
    ↓
客户端 → POST /api/v1/ai/chat
    ↓
API网关 → 鉴权 + 额度检查
    ↓
AI服务接收
    ↓
┌─────────────────────────────────────────────┐
│ 1. 加载用户上下文（学段/年级/学科/教材版本）    │
│ 2. 加载对话历史（最近 N 条消息）               │
│ 3. 意图识别 + 知识点提取                       │
│ 4. RAG 检索相关教材内容/知识点                  │
│ 5. 选择 Prompt 模板                            │
│ 6. 组装最终 Prompt                             │
│ 7. 调用大模型（流式）                          │
│ 8. 安全审核输出                                │
│ 9. 后处理：知识点关联、结构化提取               │
│ 10. 存储消息 + 扣减额度                       │
└─────────────────────────────────────────────┘
    ↓
流式返回给客户端（SSE）
```

### 3.2 模型路由策略

```python
# 模型路由表：根据场景+学科选择最优模型
MODEL_ROUTING = {
    # 场景 -> (首选模型, 备选模型)
    "general_qa":      ("glm-5",        "gpt-4o-mini"),
    "math_solve":      ("deepseek-r1",  "glm-5"),
    "physics_solve":   ("deepseek-r1",  "glm-5"),
    "chemistry_solve": ("deepseek-r1",  "glm-5"),
    "essay_review":    ("gpt-4o",       "glm-5"),
    "english_qa":      ("gpt-4o",       "glm-5"),
    "young_learner":   ("glm-5",        "gpt-4o-mini"),
    "recite_check":    ("glm-5",        "gpt-4o-mini"),
}

# 模型降级链：首选模型超时/异常时自动切换
FALLBACK_CHAIN = {
    "glm-5":        ["gpt-4o-mini", "deepseek-chat"],
    "deepseek-r1":  ["glm-5", "gpt-4o-mini"],
    "gpt-4o":       ["glm-5", "deepseek-chat"],
}
```

### 3.3 RAG 检索流程

```python
class RAGService:
    """检索增强生成服务"""
    
    def __init__(self, vector_store, knowledge_repo, embedding_client):
        self.vector_store = vector_store      # Milvus/pgvector
        self.knowledge_repo = knowledge_repo  # 知识点+教材内容
        self.embedding = embedding_client     # 嵌入模型
    
    async def retrieve(
        self, 
        query: str, 
        subject: str, 
        stage: str, 
        grade: int,
        textbook_edition: str,
        top_k: int = 5
    ) -> list[RAGResult]:
        """
        检索与问题相关的教材内容和知识点
        
        返回按相关性排序的结果列表，每个结果包含：
        - source_type: 'textbook' | 'knowledge_point' | 'question_example'
        - content: 原文内容
        - relevance_score: 相关性分数
        - metadata: 章节名、知识点名等
        """
        # 1. 生成查询向量
        query_embedding = await self.embedding.embed(query)
        
        # 2. 向量检索（带学科+学段过滤）
        filters = {
            "subject": subject,
            "stage": stage,
            "grade": {"$gte": grade - 1, "$lte": grade + 1},
        }
        vector_results = await self.vector_store.search(
            collection="knowledge_base",
            vector=query_embedding,
            filter=filters,
            top_k=top_k * 2,  # 多取一些，后续精排
        )
        
        # 3. 关键词检索补充（防止向量检索遗漏精确匹配）
        keyword_results = await self.knowledge_repo.search_by_keywords(
            query=query,
            subject=subject,
            stage=stage,
            grade=grade,
            textbook_edition=textbook_edition,
            limit=top_k,
        )
        
        # 4. 合并去重 + 精排
        merged = self._merge_and_rerank(query, vector_results, keyword_results)
        
        return merged[:top_k]
```

---

## 4. API 接口设计

### 4.1 创建对话

```
POST /api/v1/ai/conversations
Authorization: Bearer <token>
```

**Request:**
```json
{
    "subject": "math",
    "title": "二元一次方程组怎么解？"
}
```

**Response:**
```json
{
    "code": 0,
    "data": {
        "conversation_id": 200001,
        "subject": "math",
        "title": "二元一次方程组怎么解？",
        "created_at": "2026-05-18T18:30:00+08:00"
    }
}
```

### 4.2 发送消息（流式响应）

```
POST /api/v1/ai/chat
Authorization: Bearer <token>
Content-Type: application/json
Accept: text/event-stream
```

**Request:**
```json
{
    "conversation_id": 200001,
    "content": "解方程组：2x + 3y = 7, x - y = 1",
    "content_type": "text",
    "attachments": []
}
```

**Response（SSE 流式）:**

```
event: message_start
data: {"message_id": 300001, "model": "deepseek-r1"}

event: thinking
data: {"content": "这是一个二元一次方程组，可以用代入法或加减消元法..."}

event: content_delta
data: {"content": "## 解题思路\n\n"}

event: content_delta
data: {"content": "这是一道**二元一次方程组**问题，我们可以用**代入消元法**来解。\n\n"}

event: content_delta
data: {"content": "### 第一步：从较简单的方程入手\n从第二个方程 $x - y = 1$ 可以得到：\n$$x = y + 1$$\n\n"}

event: content_delta
data: {"content": "### 第二步：代入另一个方程\n将 $x = y + 1$ 代入第一个方程：\n$$2(y+1) + 3y = 7$$\n$$2y + 2 + 3y = 7$$\n$$5y = 5$$\n$$y = 1$$\n\n"}

event: content_delta
data: {"content": "### 第三步：回代求 x\n$$x = y + 1 = 1 + 1 = 2$$\n\n"}

event: content_delta
data: {"content": "### ✅ 最终答案\n$$\\boxed{x = 2,\\ y = 1}$$\n\n**验证**：$2(2) + 3(1) = 7$ ✓，$2 - 1 = 1$ ✓\n\n💡 **方法总结**：当方程组中某个未知数的系数为 1 时，用**代入消元法**最方便。"}

event: metadata
data: {
    "message_id": 300001,
    "answer_summary": "用代入消元法解方程组，x=2, y=1",
    "key_points": ["二元一次方程组", "代入消元法"],
    "related_kp_ids": [1001, 1002],
    "related_chapter": "人教版七年级下册第八章",
    "step_count": 3,
    "input_tokens": 850,
    "output_tokens": 320,
    "latency_ms": 4200,
    "quick_actions": ["再讲简单点", "生成同类题", "加入错题本", "换一种解法"]
}

event: message_end
data: {"message_id": 300001}
```

### 4.3 发送消息（非流式，弱网备用）

```
POST /api/v1/ai/chat/sync
Authorization: Bearer <token>
```

同样的请求体，但返回完整 JSON 响应而非 SSE 流。

**Response:**
```json
{
    "code": 0,
    "data": {
        "user_message": {
            "id": 300000,
            "role": "user",
            "content": "解方程组：2x + 3y = 7, x - y = 1",
            "created_at": "2026-05-18T18:30:01+08:00"
        },
        "assistant_message": {
            "id": 300001,
            "role": "assistant",
            "content": "## 解题思路\n\n...(完整内容同上)...",
            "answer_summary": "用代入消元法解方程组，x=2, y=1",
            "key_points": ["二元一次方程组", "代入消元法"],
            "related_chapter": "人教版七年级下册第八章",
            "step_count": 3,
            "quick_actions": ["再讲简单点", "生成同类题", "加入错题本", "换一种解法"],
            "created_at": "2026-05-18T18:30:05+08:00"
        }
    }
}
```

### 4.4 获取对话历史

```
GET /api/v1/ai/conversations/{conversation_id}/messages?cursor={msg_id}&limit=20
Authorization: Bearer <token>
```

**Response:**
```json
{
    "code": 0,
    "data": {
        "messages": [
            {
                "id": 300001,
                "role": "assistant",
                "content": "...",
                "answer_summary": "...",
                "key_points": ["..."],
                "created_at": "2026-05-18T18:30:05+08:00"
            },
            {
                "id": 300000,
                "role": "user",
                "content": "解方程组：2x + 3y = 7, x - y = 1",
                "attachments": [],
                "created_at": "2026-05-18T18:30:01+08:00"
            }
        ],
        "has_more": false,
        "conversation": {
            "id": 200001,
            "title": "二元一次方程组怎么解？",
            "subject": "math",
            "message_count": 2
        }
    }
}
```

### 4.5 对话列表

```
GET /api/v1/ai/conversations?status=active&page=1&size=20
Authorization: Bearer <token>
```

**Response:**
```json
{
    "code": 0,
    "data": {
        "items": [
            {
                "id": 200001,
                "title": "二元一次方程组怎么解？",
                "subject": "math",
                "last_message_at": "2026-05-18T18:30:05+08:00",
                "message_count": 2
            }
        ],
        "total": 15,
        "page": 1,
        "size": 20
    }
}
```

### 4.6 消息反馈

```
POST /api/v1/ai/messages/{message_id}/feedback
Authorization: Bearer <token>
```

**Request:**
```json
{
    "rating": 1,
    "feedback_tag": "wrong_answer",
    "feedback_text": "计算过程第三步有误"
}
```

**Response:**
```json
{
    "code": 0,
    "message": "感谢反馈，我们会持续优化"
}
```

### 4.7 快捷操作

```
POST /api/v1/ai/chat/action
Authorization: Bearer <token>
```

**Request:**
```json
{
    "conversation_id": 200001,
    "action": "simplify",         // simplify | similar_question | add_mistake | alternative_method
    "ref_message_id": 300001      // 参考哪条AI回复
}
```

**Response:** 同 chat 接口的 SSE 流式/同步响应

**action 含义:**
| action | 含义 | 处理方式 |
|--------|------|---------|
| `simplify` | 再讲简单点 | 在原对话基础上生成更通俗的讲解 |
| `similar_question` | 生成同类题 | 基于原题知识点生成一道类似练习题 |
| `add_mistake` | 加入错题本 | 调用错题服务，将原对话中的题目收录 |
| `alternative_method` | 换一种解法 | 用不同方法重新解答 |

### 4.8 删除对话

```
DELETE /api/v1/ai/conversations/{conversation_id}
Authorization: Bearer <token>
```

软删除（status 置为 0），不物理删除消息数据。

---

## 5. Prompt 编排设计

### 5.1 Prompt 组装结构

最终发送给大模型的 Prompt 由以下部分拼接：

```
[系统角色设定]        ← 来自 prompt_templates.system_prompt
[安全规则]           ← 来自 prompt_templates.safety_rules
[用户画像注入]        ← 动态生成：学段/年级/学科/教材版本/学习目标
[输出格式要求]        ← 来自 prompt_templates.output_format
[RAG检索结果]        ← 来自知识库检索（如有命中）
[对话历史]           ← 最近 N 条消息
[当前用户消息]        ← 用户本次输入
```

### 5.2 系统提示词示例（小学数学）

```python
PRIMARY_MATH_SYSTEM_PROMPT = """你是一位经验丰富、耐心的数学老师，正在辅导一名小学{grade_label}学生。

## 你的教学原则
1. **先引导后给出**：不要直接给出答案，先引导学生思考
2. **语言简单**：用小学生能理解的语言，避免抽象概念
3. **举生活例子**：多用生活中的例子帮助理解
4. **分步讲解**：每一步都要说清楚为什么
5. **正面鼓励**：多鼓励学生，"你问得很好！""这个思路很棒！"

## 输出格式
- 使用 Markdown 格式
- 数学公式用 LaTeX 语法（$...$ 和 $$...$$）
- 解题分步骤，用"### 第一步"格式
- 最终答案用 ✅ 标注
- 结尾给出 💡 方法总结

## 禁止行为
- 直接给出答案而不讲解过程
- 使用超过该年级水平的概念
- 跳过中间步骤"""
```

### 5.3 系统提示词示例（高中物理）

```python
SENIOR_PHYSICS_SYSTEM_PROMPT = """你是一位专业的物理学科辅导教师，正在辅导一名高中{grade_label}学生。

## 教学风格
1. **严谨推导**：每一步推导都注明依据（物理定律/公式）
2. **模型识别**：先判断物理模型（匀变速/圆周/电磁感应等），再列方程
3. **单位意识**：始终关注单位换算和量纲检验
4. **易错提醒**：主动指出常见错误（如正方向选取、受力分析遗漏等）
5. **方法对比**：如有多种解法，简要对比优劣

## 输出格式
- 物理量使用标准符号（$v, a, F, E, B$ 等）
- 解题步骤：审题 → 建模 → 列方程 → 求解 → 验证
- 关键公式单独列出并标注来源定律
- 易错点用 ⚠️ 标注
- 提供答题规范建议（考试得分技巧）"""
```

### 5.4 用户画像动态注入

```python
def build_user_context(profile: StudentProfile) -> str:
    """根据学生档案生成用户上下文片段"""
    stage_labels = {
        "preschool": "幼儿", "primary": "小学", 
        "junior": "初中", "senior": "高中"
    }
    grade_label = STAGE_GRADE_MAP[profile.stage]["grades"].get(profile.grade, "")
    
    ctx = f"""
<user_context>
- 学段：{stage_labels[profile.stage]}
- 年级：{grade_label}
- 教材版本：{profile.textbook_edition or '未设置'}
- 关注学科：{', '.join(profile.subjects or [])}
- 学习目标：{profile.study_goal or '日常学习'}
</user_context>"""
    return ctx
```

### 5.5 RAG 上下文注入

```python
def build_rag_context(rag_results: list[RAGResult]) -> str:
    """将 RAG 检索结果注入 Prompt"""
    if not rag_results:
        return ""
    
    parts = ["<reference_materials>"]
    for i, r in enumerate(rag_results, 1):
        parts.append(f"""
<reference_{i}>
来源：{r.source_type} | 章节：{r.metadata.get('chapter', '')} | 知识点：{r.metadata.get('kp_name', '')}
内容：{r.content}
</reference_{i}>""")
    parts.append("</reference_materials>")
    parts.append("请参考以上教材内容回答学生问题。如果参考材料与问题不相关，可以忽略。")
    
    return "\n".join(parts)
```

---

## 6. 上下文管理

### 6.1 对话历史窗口

```python
# 对话历史管理策略
CONTEXT_CONFIG = {
    "max_history_messages": 20,      # 最大历史消息数
    "max_history_tokens": 4000,      # 历史消息最大 token 数
    "summary_threshold": 15,         # 超过此数量触发摘要压缩
    "system_prompt_max_tokens": 1500, # 系统提示词最大 token 数
    "rag_context_max_tokens": 2000,  # RAG 检索结果最大 token 数
    "total_max_input_tokens": 8000,  # 总输入 token 上限（不含用户当前消息）
}

class ContextManager:
    """管理对话上下文，控制 token 预算"""
    
    def __init__(self, db_session, tokenizer):
        self.db = db_session
        self.tokenizer = tokenizer
    
    async def build_context(
        self, 
        conversation_id: int,
        user_message: str,
        profile: StudentProfile,
    ) -> ChatContext:
        """
        构建完整的对话上下文
        
        Token 预算分配：
        - system_prompt: ≤1500 tokens
        - rag_context: ≤2000 tokens  
        - history: ≤4000 tokens
        - 当前消息: 不限
        """
        # 1. 加载系统提示词
        system_prompt = await self._load_system_prompt(profile)
        
        # 2. 加载对话历史
        history = await self._load_history(
            conversation_id, 
            max_tokens=CONTEXT_CONFIG["max_history_tokens"]
        )
        
        # 3. RAG 检索
        rag_context = ""
        rag_results = await rag_service.retrieve(
            query=user_message,
            subject=profile.subject or "general",
            stage=profile.stage,
            grade=profile.grade,
            textbook_edition=profile.textbook_edition,
        )
        if rag_results:
            rag_context = build_rag_context(rag_results)
            # 检查 token 数，必要时截断
            rag_tokens = self.tokenizer.count(rag_context)
            if rag_tokens > CONTEXT_CONFIG["rag_context_max_tokens"]:
                rag_context = self._truncate_rag(rag_results, CONTEXT_CONFIG["rag_context_max_tokens"])
        
        # 4. 压缩历史（如果过长）
        history_text = self._serialize_history(history)
        history_tokens = self.tokenizer.count(history_text)
        if history_tokens > CONTEXT_CONFIG["max_history_tokens"]:
            history = await self._summarize_older_messages(conversation_id, history)
        
        return ChatContext(
            system_prompt=system_prompt,
            rag_context=rag_context,
            history=history,
        )
```

### 6.2 历史消息摘要压缩

```python
async def _summarize_older_messages(
    self, 
    conversation_id: int, 
    messages: list[Message]
) -> list[Message]:
    """
    当历史消息过多时，将较早的消息压缩为摘要
    
    保留策略：
    - 最近 6 条消息原样保留
    - 更早的消息调用 LLM 生成摘要，存为一条 system 消息
    """
    if len(messages) <= 6:
        return messages
    
    # 分割：旧消息 + 最近消息
    old_messages = messages[:-6]
    recent_messages = messages[-6:]
    
    # 调用 LLM 生成摘要（使用轻量模型降低成本）
    old_text = self._serialize_history(old_messages)
    summary_prompt = f"请用2-3句话概括以下学习对话的核心内容和讨论的知识点：\n\n{old_text}"
    summary = await llm_client.generate(summary_prompt, model="gpt-4o-mini", max_tokens=200)
    
    # 返回：摘要 + 最近消息
    summary_msg = Message(
        conversation_id=conversation_id,
        role="system",
        content=f"[对话摘要] {summary}",
    )
    return [summary_msg] + recent_messages
```

---

## 7. 流式响应处理（SSE）

### 7.1 SSE 事件类型

| 事件 | 含义 | 数据 |
|------|------|------|
| `message_start` | 开始生成 | `{message_id, model}` |
| `thinking` | 思维链输出 | `{content}` |
| `content_delta` | 内容增量 | `{content}` |
| `metadata` | 结构化元数据 | `{key_points, related_chapter, ...}` |
| `message_end` | 生成完成 | `{message_id}` |
| `error` | 发生错误 | `{code, message}` |

### 7.2 服务端流式处理

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
import json

@router.post("/api/v1/ai/chat")
async def chat(req: ChatRequest, request: Request, user_id: int = Depends(get_current_user_id)):
    # 1. 前置检查
    await check_ai_quota(user_id)
    
    # 2. 加载上下文
    profile = await get_student_profile(user_id)
    context = await context_manager.build_context(
        req.conversation_id, req.content, profile
    )
    
    # 3. 创建消息记录
    user_msg = await save_user_message(req, user_id)
    assistant_msg = await create_assistant_message(req.conversation_id, user_id)
    
    # 4. 选择模型
    model = select_model(profile, req.content, context)
    
    # 5. 流式生成
    async def event_stream():
        full_content = ""
        thinking_content = ""
        start_time = time.time()
        
        try:
            # 发送开始事件
            yield f"event: message_start\ndata: {json.dumps({'message_id': assistant_msg.id, 'model': model})}\n\n"
            
            # 调用大模型
            stream = await llm_client.stream(
                model=model,
                messages=context.to_messages() + [{"role": "user", "content": req.content}],
                temperature=0.7,
                max_tokens=2000,
            )
            
            async for chunk in stream:
                if chunk.type == "thinking":
                    thinking_content += chunk.content
                    yield f"event: thinking\ndata: {json.dumps({'content': chunk.content})}\n\n"
                elif chunk.type == "content":
                    full_content += chunk.content
                    yield f"event: content_delta\ndata: {json.dumps({'content': chunk.content})}\n\n"
            
            # 6. 后处理
            metadata = await post_process(full_content, profile, context.rag_results)
            yield f"event: metadata\ndata: {json.dumps(metadata)}\n\n"
            
            # 7. 安全审核
            safety_result = await safety_check(full_content)
            if not safety_result.passed:
                # 替换为安全提示
                full_content = "抱歉，我无法回答这个问题。请换一个学习相关的问题吧。"
                yield f"event: content_delta\ndata: {json.dumps({'content': '[内容已被安全过滤]'})}\n\n"
            
            # 8. 更新数据库
            latency = int((time.time() - start_time) * 1000)
            await update_assistant_message(
                msg_id=assistant_msg.id,
                content=full_content,
                metadata=metadata,
                model_name=model,
                latency_ms=latency,
                input_tokens=context.total_input_tokens,
                output_tokens=len(full_content) // 2,  # 估算
            )
            
            # 9. 扣减额度
            await deduct_ai_quota(user_id)
            
            # 10. 记录学习行为
            await record_learning_event(user_id, "ai_chat", {
                "conversation_id": req.conversation_id,
                "subject": profile.subject,
                "knowledge_points": metadata.get("key_points", []),
            })
            
            yield f"event: message_end\ndata: {json.dumps({'message_id': assistant_msg.id})}\n\n"
            
        except Exception as e:
            logger.error(f"Stream error: {e}", exc_info=True)
            yield f"event: error\ndata: {json.dumps({'code': 50001, 'message': '生成出错，请重试'})}\n\n"
    
    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

### 7.3 客户端 SSE 消费

```dart
// Flutter 示例：消费 SSE 流
Stream<ChatEvent> listenChatStream(String conversationId, String content) async* {
  final response = await http.post(
    Uri.parse('$baseUrl/api/v1/ai/chat'),
    headers: {
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: jsonEncode({
      'conversation_id': conversationId,
      'content': content,
      'content_type': 'text',
    }),
  );
  
  // 解析 SSE 事件流
  await for (final line in response.stream.transform(utf8.decoder).transform(const LineSplitter())) {
    if (line.startsWith('event: ')) {
      currentEvent = line.substring(7);
    } else if (line.startsWith('data: ')) {
      final data = jsonDecode(line.substring(6));
      yield ChatEvent(type: currentEvent, data: data);
    }
  }
}
```

---

## 8. 后处理与知识点关联

### 8.1 结构化元数据提取

```python
class PostProcessor:
    """AI 输出的后处理"""
    
    async def extract_metadata(
        self, 
        content: str, 
        profile: StudentProfile,
        rag_results: list[RAGResult]
    ) -> MessageMetadata:
        """
        从 AI 回答中提取结构化信息
        """
        # 1. 提取关键知识点（使用轻量模型，降低成本）
        kp_prompt = f"""从以下教学内容中提取关键知识点（最多5个），返回JSON数组：
{content[:1000]}

返回格式：["知识点1", "知识点2"]"""
        
        kp_response = await llm_client.generate(kp_prompt, model="gpt-4o-mini", max_tokens=100)
        key_points = json.loads(kp_response)
        
        # 2. 关联知识库中的知识点ID
        related_kp_ids = []
        for kp_name in key_points:
            kp = await knowledge_repo.find_by_name(kp_name, profile.subject, profile.stage)
            if kp:
                related_kp_ids.append(kp.id)
        
        # 3. 生成一句话总结
        summary_prompt = f"用一句话概括以下教学内容的核心结论：\n{content[:500]}"
        answer_summary = await llm_client.generate(summary_prompt, model="gpt-4o-mini", max_tokens=50)
        
        # 4. 统计解题步骤数
        step_count = content.count("### 第") + content.count("### 步骤")
        
        # 5. 关联教材章节（优先使用 RAG 命中的章节）
        related_chapter = ""
        if rag_results:
            related_chapter = rag_results[0].metadata.get("chapter", "")
        
        return MessageMetadata(
            answer_summary=answer_summary.strip(),
            key_points=key_points,
            related_kp_ids=related_kp_ids,
            related_chapter=related_chapter,
            step_count=step_count or None,
            quick_actions=self._generate_quick_actions(content, profile),
        )
    
    def _generate_quick_actions(self, content: str, profile: StudentProfile) -> list[str]:
        """根据回答内容生成可用的快捷操作"""
        actions = []
        if "### 第" in content or "步骤" in content:
            actions.append("再讲简单点")
            actions.append("换一种解法")
            actions.append("生成同类题")
            actions.append("加入错题本")
        elif any(kw in content for kw in ["作文", "文章", "写作"]):
            actions.append("帮我改一段")
            actions.append("给个提纲")
            actions.append("推荐素材")
        else:
            actions.append("再详细说说")
            actions.append("举个大白话例子")
            actions.append("我不太懂，换个讲法")
        return actions
```

---

## 9. 安全过滤

### 9.1 输入过滤

```python
class InputSafetyChecker:
    """用户输入安全检查"""
    
    BLOCKED_PATTERNS = [
        # 非学习相关请求
        r"(帮我写|给我写).{0,5}(作文|文章).{0,5}(不要|不用).{0,5}(学习|思考)",
        r"(直接给|只要).{0,5}答案",
        r"(帮我做|替我做).{0,5}作业",
        # 敏感话题
        # ... (通过配置表管理)
    ]
    
    async def check(self, content: str, user_type: str) -> SafetyResult:
        # 1. 正则规则匹配
        for pattern in self.BLOCKED_PATTERNS:
            if re.search(pattern, content, re.IGNORECASE):
                return SafetyResult(
                    passed=False,
                    reason="BLOCKED_PATTERN",
                    redirect_hint="建议你先自己想一想，我可以给你提示和讲解～"
                )
        
        # 2. 调用内容安全API（阿里/腾讯）
        safety_result = await safety_api.text_check(content)
        if not safety_result.passed:
            return SafetyResult(
                passed=False,
                reason=f"CONTENT_UNSAFE:{safety_result.label}",
            )
        
        return SafetyResult(passed=True)
```

### 9.2 输出过滤

```python
class OutputSafetyChecker:
    """AI 输出安全检查"""
    
    async def check(self, content: str) -> SafetyResult:
        # 1. 调用内容安全API
        safety_result = await safety_api.text_check(content)
        if not safety_result.passed:
            logger.warning(f"AI output blocked: {safety_result.label}")
            return SafetyResult(passed=False, reason=safety_result.label)
        
        # 2. 检查是否包含答案而缺少讲解（反抄答案策略）
        if self._looks_like_bare_answer(content):
            return SafetyResult(
                passed=True,
                warning="BARE_ANSWER",
                note="需要审查是否缺少讲解过程"
            )
        
        return SafetyResult(passed=True)
    
    def _looks_like_bare_answer(self, content: str) -> bool:
        """检测是否像纯答案输出（缺少讲解过程）"""
        # 简单启发式：内容很短且包含数字答案模式
        if len(content) < 50:
            return bool(re.search(r'=\s*[\d.]+', content))
        return False
```

---

## 10. 额度与限流

### 10.1 AI 调用额度

```python
class QuotaService:
    """AI调用额度管理"""
    
    async def check_and_deduct(self, user_id: int) -> QuotaResult:
        """检查并扣减一次 AI 调用额度"""
        # 1. 获取今日已用次数
        today_key = f"quota:ai:{user_id}:{date.today().isoformat()}"
        used = await redis.get(today_key)
        used = int(used or 0)
        
        # 2. 获取用户额度上限
        membership = await get_active_membership(user_id)
        limit = membership.daily_ai_quota  # -1 表示无限
        
        if limit == -1:
            return QuotaResult(allowed=True, remaining=-1, limit=-1)
        
        remaining = limit - used
        if remaining <= 0:
            return QuotaResult(
                allowed=False, 
                remaining=0, 
                limit=limit,
                message="今日AI问答次数已用完，升级会员可获取更多次数"
            )
        
        return QuotaResult(allowed=True, remaining=remaining - 1, limit=limit)
    
    async def deduct(self, user_id: int):
        """确认扣减（在AI成功生成后调用）"""
        today_key = f"quota:ai:{user_id}:{date.today().isoformat()}"
        await redis.incr(today_key)
        # 设置过期时间（仅在key首次创建时）
        await redis.expire(today_key, 86400)
```

### 10.2 接口限流

| 接口 | 限流策略 |
|------|---------|
| `POST /ai/chat` | 同用户 10次/分钟 |
| `POST /ai/chat/action` | 同用户 10次/分钟 |
| `POST /ai/messages/{id}/feedback` | 同用户 30次/分钟 |

```python
# 使用 Redis 滑动窗口限流
async def rate_limit(user_id: int, action: str, max_requests: int, window_sec: int) -> bool:
    key = f"ratelimit:{action}:{user_id}"
    now = time.time()
    window_start = now - window_sec
    
    pipe = redis.pipeline()
    pipe.zremrangebyscore(key, 0, window_start)
    pipe.zadd(key, {str(now): now})
    pipe.zcard(key)
    pipe.expire(key, window_sec)
    results = await pipe.execute()
    
    count = results[2]
    return count <= max_requests
```

---

## 11. 模型降级与容错

### 11.1 降级策略

```python
class LLMClient:
    """大模型调用客户端，带降级和重试"""
    
    async def stream(self, model: str, messages: list, **kwargs) -> AsyncStream:
        try:
            return await self._call_model(model, messages, stream=True, **kwargs)
        except (TimeoutError, ConnectionError) as e:
            logger.warning(f"Model {model} failed: {e}, trying fallback")
            return await self._fallback(model, messages, **kwargs)
    
    async def _fallback(self, failed_model: str, messages: list, **kwargs) -> AsyncStream:
        """模型降级：按降级链尝试备选模型"""
        fallbacks = FALLBACK_CHAIN.get(failed_model, [])
        for fb_model in fallbacks:
            try:
                logger.info(f"Trying fallback model: {fb_model}")
                return await self._call_model(fb_model, messages, stream=True, **kwargs)
            except Exception as e:
                logger.warning(f"Fallback {fb_model} also failed: {e}")
                continue
        
        # 所有模型都不可用
        raise AIServiceUnavailableError("所有模型暂时不可用，请稍后重试")
```

### 11.2 超时配置

```python
MODEL_TIMEOUT_CONFIG = {
    "glm-5":          {"connect": 5, "read": 30, "total": 45},
    "deepseek-r1":    {"connect": 5, "read": 60, "total": 90},  # 推理模型可能更慢
    "gpt-4o":         {"connect": 5, "read": 30, "total": 45},
    "gpt-4o-mini":    {"connect": 5, "read": 15, "total": 25},
}
```

---

## 12. 错误处理

### 12.1 错误码

| 错误码 | 含义 | HTTP状态码 | 客户端行为 |
|--------|------|-----------|-----------|
| 30001 | AI 额度已用完 | 403 | 弹出升级引导 |
| 30002 | AI 服务暂不可用 | 503 | 提示稍后重试 |
| 30003 | 内容安全过滤 | 200 | 显示安全提示 |
| 30004 | 对话不存在 | 404 | 返回对话列表 |
| 30005 | 消息超长 | 400 | 提示缩短问题 |
| 30006 | 请求频率过高 | 429 | 倒计时提示 |
| 30007 | 模型响应超时 | 504 | 自动重试1次 |

### 12.2 客户端错误处理

```dart
// Flutter 错误处理示例
Future<void> handleChatError(ChatError error) async {
  switch (error.code) {
    case 30001: // 额度用完
      showUpgradeDialog(
        title: "今日问答次数已用完",
        subtitle: "升级会员可获得更多次数",
      );
    case 30002: // 服务不可用
      showSnackBar("AI助手暂时开小差了，请稍后再试");
    case 30007: // 超时
      showSnackBar("回答生成中，请稍等...");
      await Future.delayed(Duration(seconds: 2));
      retryLastRequest(); // 自动重试
    default:
      showSnackBar("出了点问题，请重试");
  }
}
```

---

## 13. 状态流转

### 13.1 对话生命周期

```
[用户发送第一条消息]
    ↓
[创建 conversation] → status=1(活跃)
    ↓
[多轮对话] → message_count++
    ↓
[用户主动删除] → status=0(已删除)
    或
[30天无活动] → status=2(已归档) → 归档后90天 → 可清理存储
```

### 13.2 单次 AI 生成流程状态

```
[请求进入]
    ↓
额度检查 ─── 额度不足 → 返回 30001
    ↓ 通过
安全检查 ─── 不通过 → 返回 30003
    ↓ 通过
上下文构建
    ↓
模型调用 ─── 超时 → 降级到备选模型 ─── 全部超时 → 返回 30002
    ↓ 成功                         ↓ 成功
流式输出 ←───────────────────────────┘
    ↓
后处理（知识点提取、元数据）
    ↓
存储 + 扣额度
    ↓
[完成]
```

---

## 14. 监控与质量保障

### 14.1 核心监控指标

| 指标 | 含义 | 告警阈值 |
|------|------|---------|
| `ai.chat.latency_p50` | 首 token 延迟 P50 | > 5s |
| `ai.chat.latency_p99` | 首 token 延迟 P99 | > 15s |
| `ai.chat.error_rate` | 调用失败率 | > 5% |
| `ai.chat.fallback_rate` | 降级触发率 | > 20% |
| `ai.safety.block_rate` | 安全过滤率 | > 10% 需人工审查 |
| `ai.chat.user_rating_avg` | 用户平均评分 | < 3.0 |
| `ai.chat.token_cost_daily` | 每日 token 消耗 | 预算的 80% |
| `ai.rag.hit_rate` | RAG 检索命中率 | < 30% 需优化知识库 |

### 14.2 质量回流机制

```
用户标记"回答有误" (rating=1)
    ↓
写入 ai_message_feedback 队列
    ↓
运营/教研定期审查
    ↓
┌─── 知识库有误 → 更新知识库内容
├─── Prompt 不当 → 优化 Prompt 模板
├─── 模型能力不足 → 切换/升级模型
└─── RAG 检索不准 → 优化向量/标签
```

---

## 15. 与其他模块的交互

### 15.1 依赖关系

```
AI智能辅导
    ├── ← 用户账号体系（用户信息、学生档案、会员额度）
    ├── ← 内容服务（教材章节、知识点、题库）
    ├── ← 错题服务（加入错题本操作）
    └── → 学情分析（学习行为记录）
```

### 15.2 学习行为事件

每次 AI 对话完成后，向学情分析模块发送学习事件：

```python
async def record_learning_event(user_id: int, event_type: str, data: dict):
    event = {
        "user_id": user_id,
        "event_type": "ai_chat",       # 事件类型
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "subject": data["subject"],     # 学科
        "duration_sec": data["duration"],  # 对话耗时
        "knowledge_points": data["knowledge_points"],  # 涉及的知识点
        "message_count": data["message_count"],  # 本次会话消息数
        "model_used": data["model"],    # 使用的模型
    }
    # 发送到消息队列（Kafka/RabbitMQ）
    await mq.publish("learning_events", event)
```
