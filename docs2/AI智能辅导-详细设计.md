# AI智能辅导模块详细设计

## 1. 模块概述

### 1.1 功能定位
AI智能辅导模块是PrimeTop的核心功能，为学生提供随时可用的AI学习助手，支持文字、语音、图片等多模态输入，根据用户年级、学科、教材版本和学习进度，输出符合认知水平的讲解内容。

### 1.2 核心能力
- 自然语言提问与多轮对话
- 分学段、分年级的适龄化讲解
- 分步提示与启发式引导
- 知识点关联与溯源引用
- 追问拓展与深度学习
- 内容安全过滤与合规控制

### 1.3 技术架构
```
客户端层
    ├─ 文字输入
    ├─ 语音输入 (ASR)
    └─ 图片输入
        │
API网关层
    ├─ 鉴权校验
    ├─ 限流控制
    └─ 日志记录
        │
业务服务层
    ├─ 对话上下文管理
    ├─ 用户画像获取
    ├─ 学段年级适配
    └─ 知识点映射
        │
AI能力编排层
    ├─ Prompt模板引擎
    ├─ RAG检索增强
    ├─ 多模型调度
    └─ 输出后处理
        │
外部服务层
    ├─ 大模型API (多供应商)
    ├─ 向量检索
    ├─ 内容审核
    └─ 语音合成 (TTS)
```

## 2. 数据结构定义

### 2.1 核心数据表

#### 2.1.1 会话表 (ai_conversation)

| 字段名 | 类型 | 说明 | 约束 |
|--------|------|------|------|
| id | BIGINT | 主键ID | PK, AUTO_INCREMENT |
| user_id | BIGINT | 用户ID | NOT NULL, FK |
| session_id | VARCHAR(64) | 会话唯一标识 | NOT NULL, UNIQUE |
| title | VARCHAR(200) | 会话标题 | |
| subject_id | INT | 学科ID | FK |
| grade_level | VARCHAR(20) | 年级（如：小学一年级） | |
| textbook_id | INT | 教材版本ID | FK |
| model_id | VARCHAR(50) | 使用的大模型ID | |
| total_messages | INT | 消息总数 | DEFAULT 0 |
| total_tokens | INT | 总Token消耗 | DEFAULT 0 |
| status | TINYINT | 状态：1-进行中，2-已结束，3-已归档 | DEFAULT 1 |
| created_at | TIMESTAMP | 创建时间 | DEFAULT CURRENT_TIMESTAMP |
| updated_at | TIMESTAMP | 更新时间 | DEFAULT CURRENT_TIMESTAMP ON UPDATE |
| ended_at | TIMESTAMP | 结束时间 | |
| deleted_at | TIMESTAMP | 删除时间 | |

```sql
CREATE TABLE ai_conversation (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    session_id VARCHAR(64) NOT NULL UNIQUE,
    title VARCHAR(200),
    subject_id INT,
    grade_level VARCHAR(20),
    textbook_id INT,
    model_id VARCHAR(50),
    total_messages INT DEFAULT 0,
    total_tokens INT DEFAULT 0,
    status TINYINT DEFAULT 1 COMMENT '1-进行中，2-已结束，3-已归档',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    ended_at TIMESTAMP NULL,
    deleted_at TIMESTAMP NULL,
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI对话会话表';
```

#### 2.1.2 消息表 (ai_message)

| 字段名 | 类型 | 说明 | 约束 |
|--------|------|------|------|
| id | BIGINT | 主键ID | PK, AUTO_INCREMENT |
| conversation_id | BIGINT | 会话ID | NOT NULL, FK |
| session_id | VARCHAR(64) | 会话标识 | NOT NULL |
| role | TINYINT | 角色：1-用户，2-助手，3-系统 | NOT NULL |
| content_type | TINYINT | 内容类型：1-文本，2-语音，3-图片，4-混合 | DEFAULT 1 |
| text_content | TEXT | 文本内容 | MEDIUMTEXT |
| audio_url | VARCHAR(500) | 语音URL | |
| image_urls | JSON | 图片URL列表 | |
| input_tokens | INT | 输入Token数 | |
| output_tokens | INT | 输出Token数 | |
| model_id | VARCHAR(50) | 使用的模型ID | |
| knowledge_points | JSON | 关联的知识点ID列表 | |
| rag_sources | JSON | RAG检索的来源信息 | |
| safety_check_result | JSON | 安全审核结果 | |
| feedback_score | TINYINT | 用户反馈评分：1-5分 | |
| feedback_tags | JSON | 反馈标签 | |
| created_at | TIMESTAMP | 创建时间 | DEFAULT CURRENT_TIMESTAMP |
| is_deleted | BOOLEAN | 是否删除 | DEFAULT FALSE |

```sql
CREATE TABLE ai_message (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    conversation_id BIGINT NOT NULL,
    session_id VARCHAR(64) NOT NULL,
    role TINYINT NOT NULL COMMENT '1-用户，2-助手，3-系统',
    content_type TINYINT DEFAULT 1 COMMENT '1-文本，2-语音，3-图片，4-混合',
    text_content MEDIUMTEXT,
    audio_url VARCHAR(500),
    image_urls JSON,
    input_tokens INT,
    output_tokens INT,
    model_id VARCHAR(50),
    knowledge_points JSON COMMENT '关联的知识点ID列表',
    rag_sources JSON COMMENT 'RAG检索的来源信息',
    safety_check_result JSON COMMENT '安全审核结果',
    feedback_score TINYINT COMMENT '用户反馈评分：1-5分',
    feedback_tags JSON COMMENT '反馈标签',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    INDEX idx_conversation_id (conversation_id),
    INDEX idx_session_id (session_id),
    INDEX idx_created_at (created_at),
    FOREIGN KEY (conversation_id) REFERENCES ai_conversation(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI对话消息表';
```

#### 2.1.3 Prompt模板表 (ai_prompt_template)

| 字段名 | 类型 | 说明 | 约束 |
|--------|------|------|------|
| id | INT | 主键ID | PK, AUTO_INCREMENT |
| template_code | VARCHAR(100) | 模板编码 | NOT NULL, UNIQUE |
| name | VARCHAR(200) | 模板名称 | NOT NULL |
| category | VARCHAR(50) | 分类：question_answer, tutoring, homework_help等 | |
| applicable_grade | VARCHAR(100) | 适用年级：multiple choice, range | |
| applicable_subject | VARCHAR(100) | 适用学科 | |
| template_content | TEXT | 模板内容（支持变量占位符） | NOT NULL |
| variables | JSON | 变量定义 | |
| system_prompt | TEXT | 系统提示词 | |
| priority | INT | 优先级 | DEFAULT 0 |
| is_active | BOOLEAN | 是否启用 | DEFAULT TRUE |
| created_at | TIMESTAMP | 创建时间 | DEFAULT CURRENT_TIMESTAMP |
| updated_at | TIMESTAMP | 更新时间 | DEFAULT CURRENT_TIMESTAMP ON UPDATE |
| created_by | BIGINT | 创建人 | |
| version | VARCHAR(20) | 版本号 | |

```sql
CREATE TABLE ai_prompt_template (
    id INT PRIMARY KEY AUTO_INCREMENT,
    template_code VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(50),
    applicable_grade VARCHAR(100),
    applicable_subject VARCHAR(100),
    template_content TEXT NOT NULL,
    variables JSON COMMENT '变量定义',
    system_prompt TEXT,
    priority INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by BIGINT,
    version VARCHAR(20),
    INDEX idx_category (category),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI Prompt模板表';
```

#### 2.1.4 RAG检索记录表 (ai_rag_retrieval)

| 字段名 | 类型 | 说明 | 约束 |
|--------|------|------|------|
| id | BIGINT | 主键ID | PK, AUTO_INCREMENT |
| message_id | BIGINT | 消息ID | NOT NULL, FK |
| query_text | TEXT | 查询文本 | NOT NULL |
| embedding_vector | JSON | 向量表示 | |
| retrieved_count | INT | 检索到的文档数量 | |
| top_k | INT | 检索参数Top-K | |
| threshold | DECIMAL(5,4) | 相似度阈值 | |
| retrieval_time_ms | INT | 检索耗时（毫秒） | |
| sources | JSON | 检索来源详情 | |
| used_in_context | BOOLEAN | 是否用于上下文构建 | DEFAULT TRUE |
| created_at | TIMESTAMP | 创建时间 | DEFAULT CURRENT_TIMESTAMP |

```sql
CREATE TABLE ai_rag_retrieval (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    message_id BIGINT NOT NULL,
    query_text TEXT NOT NULL,
    embedding_vector JSON,
    retrieved_count INT,
    top_k INT,
    threshold DECIMAL(5,4),
    retrieval_time_ms INT,
    sources JSON COMMENT '检索来源详情',
    used_in_context BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_message_id (message_id),
    FOREIGN KEY (message_id) REFERENCES ai_message(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RAG检索记录表';
```

#### 2.1.5 模型调用记录表 (ai_model_call)

| 字段名 | 类型 | 说明 | 约束 |
|--------|------|------|------|
| id | BIGINT | 主键ID | PK, AUTO_INCREMENT |
| message_id | BIGINT | 消息ID | FK |
| model_provider | VARCHAR(50) | 模型供应商 | NOT NULL |
| model_id | VARCHAR(50) | 模型ID | NOT NULL |
| request_payload | MEDIUMTEXT | 请求负载 | |
| response_payload | MEDIUMTEXT | 响应负载 | |
| input_tokens | INT | 输入Token数 | |
| output_tokens | INT | 输出Token数 | |
| total_tokens | INT | 总Token数 | |
| latency_ms | INT | 响应延迟（毫秒） | |
| status_code | INT | HTTP状态码 | |
| error_message | TEXT | 错误信息 | |
| cost_cny | DECIMAL(10,4) | 成本（人民币） | |
| created_at | TIMESTAMP | 创建时间 | DEFAULT CURRENT_TIMESTAMP |

```sql
CREATE TABLE ai_model_call (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    message_id BIGINT,
    model_provider VARCHAR(50) NOT NULL,
    model_id VARCHAR(50) NOT NULL,
    request_payload MEDIUMTEXT,
    response_payload MEDIUMTEXT,
    input_tokens INT,
    output_tokens INT,
    total_tokens INT,
    latency_ms INT,
    status_code INT,
    error_message TEXT,
    cost_cny DECIMAL(10,4) COMMENT '成本（人民币）',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_message_id (message_id),
    INDEX idx_model_provider (model_provider),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='模型调用记录表';
```

### 2.2 Redis缓存结构

#### 2.2.1 会话上下文缓存
```
Key: ai:session:{session_id}:context
TTL: 3600s (1小时)
Value: {
  "userId": 123456,
  "gradeLevel": "小学三年级",
  "subjectId": 1,
  "textbookId": 1,
  "recentMessages": [
    {"role": 1, "content": "..."},
    {"role": 2, "content": "..."}
  ],
  "totalTokens": 1500,
  "lastActivityAt": "2026-06-17T06:30:00Z"
}
```

#### 2.2.2 用户限流缓存
```
Key: ai:rate_limit:{user_id}:{date}
TTL: 86400s (1天)
Value: {
  "questionCount": 10,
  "tokenUsed": 5000,
  "lastResetAt": "2026-06-17T00:00:00Z"
}
```

#### 2.2.3 Prompt模板缓存
```
Key: ai:prompt:template:{template_code}
TTL: 1800s (30分钟)
Value: {
  "templateCode": "elementary_math_tutoring",
  "name": "小学数学辅导",
  "templateContent": "...",
  "variables": {...},
  "systemPrompt": "..."
}
```

## 3. API接口设计

### 3.1 创建会话

**接口路径:** `POST /api/v1/ai/conversations`

**请求体:**
```json
{
  "title": "数学作业辅导",
  "subjectId": 1,
  "gradeLevel": "小学三年级",
  "textbookId": 1
}
```

**响应体:**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "conversationId": 1001,
    "sessionId": "sess_abc123xyz",
    "title": "数学作业辅导",
    "status": 1,
    "createdAt": "2026-06-17T06:30:00.000Z"
  }
}
```

**错误码:**
- `4001`: 参数错误
- `4003`: 非法年级
- `4004`: 教材版本不存在
- `5001`: 系统内部错误

### 3.2 发送消息

**接口路径:** `POST /api/v1/ai/conversations/{session_id}/messages`

**请求体:**
```json
{
  "role": 1,
  "contentType": 1,
  "textContent": "小明有5个苹果，吃了2个，还剩几个？",
  "imageUrls": [],
  "enableRag": true,
  "enableSafety": true
}
```

**响应体:**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "messageId": 2001,
    "role": 2,
    "textContent": "小明原来有5个苹果，吃了2个后，还剩下几个呢？让我们来算一算...\n\n**解题步骤：**\n1. 原来有：5个\n2. 吃掉了：2个\n3. 还剩下：5 - 2 = 3个\n\n**答案：** 小明还剩下3个苹果。\n\n你理解了吗？要不要我再换一种方法讲一遍？",
    "knowledgePoints": [
      {"id": 101, "name": "减法运算", "chapter": "第一章"},
      {"id": 102, "name": "应用题理解", "chapter": "第一章"}
    ],
    "ragSources": [
      {
        "type": "knowledge_point",
        "title": "减法的基本概念",
        "relevance": 0.95
      }
    ],
    "tokens": {
      "input": 25,
      "output": 180
    },
    "latency": 1234
  }
}
```

**错误码:**
- `4001`: 参数错误
- `4005`: 会话不存在或已结束
- `4006`: 超出每日提问次数限制
- `4007`: 内容包含敏感信息
- `4008`: AI服务暂时不可用
- `5001`: 系统内部错误

### 3.3 获取会话历史

**接口路径:** `GET /api/v1/ai/conversations/{session_id}/messages`

**请求参数:**
- `page`: 页码（默认1）
- `pageSize`: 每页数量（默认20）
- `sinceMessageId`: 从某条消息ID之后的消息

**响应体:**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "messages": [
      {
        "messageId": 2001,
        "role": 1,
        "contentType": 1,
        "textContent": "小明有5个苹果...",
        "createdAt": "2026-06-17T06:30:00.000Z"
      },
      {
        "messageId": 2002,
        "role": 2,
        "contentType": 1,
        "textContent": "小明原来有5个苹果...",
        "createdAt": "2026-06-17T06:30:01.234Z"
      }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 2,
      "hasMore": false
    }
  }
}
```

### 3.4 获取会话列表

**接口路径:** `GET /api/v1/ai/conversations`

**请求参数:**
- `status`: 状态筛选（1-进行中，2-已结束）
- `subjectId`: 学科筛选
- `page`: 页码（默认1）
- `pageSize`: 每页数量（默认10）

**响应体:**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "conversations": [
      {
        "conversationId": 1001,
        "sessionId": "sess_abc123xyz",
        "title": "数学作业辅导",
        "subjectId": 1,
        "gradeLevel": "小学三年级",
        "totalMessages": 5,
        "status": 1,
        "createdAt": "2026-06-17T06:30:00.000Z",
        "lastMessageAt": "2026-06-17T06:35:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 10,
      "total": 1,
      "hasMore": false
    }
  }
}
```

### 3.5 提交反馈

**接口路径:** `POST /api/v1/ai/messages/{message_id}/feedback`

**请求体:**
```json
{
  "score": 5,
  "tags": ["讲解清晰", "有帮助"],
  "comment": "讲得很清楚，我懂了"
}
```

**响应体:**
```json
{
  "code": 0,
  "message": "feedback submitted",
  "data": null
}
```

### 3.6 停止生成

**接口路径:** `POST /api/v1/ai/conversations/{session_id}/stop`

**响应体:**
```json
{
  "code": 0,
  "message": "generation stopped",
  "data": {
    "messageId": 2002,
    "textContent": "小明原来有5个苹果，吃了2个后...",
    "isStopped": true
  }
}
```

## 4. 核心业务逻辑

### 4.1 消息处理流程

```python
async def process_message(user_id: int, session_id: str, request: MessageRequest):
    # 1. 权限和限流检查
    await check_permission_and_rate_limit(user_id)

    # 2. 获取会话上下文
    context = await get_conversation_context(session_id)

    # 3. 内容安全审核
    safety_result = await safety_check(request.textContent)
    if not safety_result.is_safe:
        raise ContentSafetyError(safety_result.reason)

    # 4. 保存用户消息
    user_message = await save_user_message(session_id, request)

    # 5. 构建Prompt上下文
    prompt_context = await build_prompt_context(
        user_id=user_id,
        session_id=session_id,
        user_message=request.textContent,
        context=context
    )

    # 6. 调用AI模型
    ai_response = await call_ai_model(prompt_context)

    # 7. 后处理（适龄化、格式化）
    processed_response = await post_process_response(
        ai_response,
        context.grade_level,
        context.subject_id
    )

    # 8. 保存AI回复
    ai_message = await save_ai_message(
        session_id,
        processed_response,
        ai_response.metadata
    )

    # 9. 更新缓存和统计
    await update_session_cache(session_id, ai_message)
    await update_usage_statistics(user_id, ai_response.tokens)

    return ai_message
```

### 4.2 Prompt上下文构建

```python
async def build_prompt_context(
    user_id: int,
    session_id: str,
    user_message: str,
    context: ConversationContext
) -> PromptContext:

    # 1. 获取用户画像
    user_profile = await get_user_profile(user_id)

    # 2. 选择合适的Prompt模板
    template = await select_prompt_template(
        grade_level=context.grade_level,
        subject_id=context.subject_id,
        intent=classify_intent(user_message)
    )

    # 3. RAG检索增强
    rag_results = []
    if template.enable_rag:
        rag_results = await rag_retrieve(
            query=user_message,
            subject_id=context.subject_id,
            grade_level=context.grade_level,
            textbook_id=context.textbook_id,
            top_k=template.rag_top_k,
            threshold=template.rag_threshold
        )

    # 4. 获取对话历史（最近N轮）
    recent_history = await get_recent_messages(session_id, limit=template.history_window)

    # 5. 构建变量
    variables = {
        "user_name": user_profile.nickname or "同学",
        "grade_level": context.grade_level,
        "subject_name": get_subject_name(context.subject_id),
        "question": user_message,
        "knowledge_points": extract_knowledge_points(rag_results),
        "history": format_conversation_history(recent_history),
        "current_date": datetime.now().strftime("%Y-%m-%d")
    }

    # 6. 渲染Prompt
    system_prompt = render_template(template.system_prompt, variables)
    user_prompt = render_template(template.template_content, variables)

    return PromptContext(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        rag_sources=rag_results,
        variables=variables,
        metadata={
            "template_code": template.template_code,
            "model_id": template.default_model_id
        }
    )
```

### 4.3 RAG检索实现

```python
async def rag_retrieve(
    query: str,
    subject_id: int,
    grade_level: str,
    textbook_id: int,
    top_k: int = 5,
    threshold: float = 0.7
) -> List[RAGSource]:

    # 1. 生成查询向量
    embedding = await generate_embedding(query)

    # 2. 构建检索过滤器
    filters = {
        "subject_id": subject_id,
        "grade_level": grade_level,
        "textbook_id": textbook_id,
        "is_active": True
    }

    # 3. 向量相似度检索
    vector_results = await vector_search(
        collection="knowledge_points",
        vector=embedding,
        filters=filters,
        top_k=top_k * 2,  # 多取一些用于过滤
        score_threshold=threshold
    )

    # 4. 二次过滤和排序
    filtered_results = []
    for result in vector_results:
        if result.score >= threshold:
            filtered_results.append(RAGSource(
                type="knowledge_point",
                id=result.payload["id"],
                title=result.payload["title"],
                content=result.payload["content"],
                chapter=result.payload["chapter"],
                relevance=result.score
            ))

    # 5. 按相关度排序并返回Top-K
    filtered_results.sort(key=lambda x: x.relevance, reverse=True)
    return filtered_results[:top_k]
```

### 4.4 适龄化处理

```python
async def post_process_response(
    response: AIResponse,
    grade_level: str,
    subject_id: int
) -> ProcessedResponse:

    # 1. 根据年级调整语言复杂度
    if "小学" in grade_level:
        response = simplify_language_for_elementary(response)
    elif "初中" in grade_level:
        response = adjust_for_middle_school(response)
    elif "高中" in grade_level:
        # 高中生可以接受更复杂的表达
        pass

    # 2. 格式化数学公式
    if subject_id in [1, 2, 5, 6]:  # 数学、物理、化学、生物
        response = format_math_formulas(response)

    # 3. 添加学习建议
    response = append_learning_tips(response, grade_level)

    # 4. 格式化为Markdown
    response = format_as_markdown(response)

    return response
```

### 4.5 流式响应处理

```python
async def stream_response(session_id: str, prompt_context: PromptContext):
    # 1. 建立SSE连接
    async with sse_connection(session_id) as conn:
        # 2. 调用流式AI模型
        stream = await call_ai_model_stream(prompt_context)

        # 3. 逐块发送给客户端
        accumulated_content = ""
        async for chunk in stream:
            accumulated_content += chunk.content

            # 发送SSE事件
            await conn.send({
                "event": "message_delta",
                "data": {
                    "content": chunk.content,
                    "isComplete": chunk.is_complete,
                    "tokens": chunk.tokens
                }
            })

            # 如果是停止信号，中断流
            if await is_generation_stopped(session_id):
                await conn.send({
                    "event": "generation_stopped",
                    "data": {"content": accumulated_content}
                })
                break

        # 4. 保存完整回复
        await save_ai_message(session_id, accumulated_content)

        # 5. 发送完成事件
        await conn.send({
            "event": "message_complete",
            "data": {"messageId": message_id}
        })
```

## 5. 状态流转

### 5.1 会话状态机

```
创建会话
    ↓
[进行中] (status=1)
    ├─ 用户继续对话 → [进行中]
    ├─ 超时无活动 → [已归档] (status=3)
    ├─ 用户手动结束 → [已结束] (status=2)
    └─ 系统归档 → [已归档] (status=3)
    ↓
[已结束] (status=2)
    └─ 用户重新打开 → [进行中] (status=1)
    ↓
[已归档] (status=3)
    └─ (不可逆)
```

### 5.2 消息处理状态

```
用户发送消息
    ↓
[安全审核中]
    ├─ 审核通过 → [AI处理中]
    └─ 审核失败 → [已拒绝]
    ↓
[AI处理中]
    ├─ 生成成功 → [已完成]
    ├─ 超时 → [已超时]
    └─ 模型错误 → [已失败]
    ↓
[已完成]
    └─ 用户反馈 → [已评价]
```

## 6. 错误处理

### 6.1 错误分类与处理策略

| 错误类型 | 错误码 | 处理策略 | 用户提示 |
|---------|--------|---------|---------|
| 参数错误 | 4001 | 直接返回 | "请求参数有误，请检查后重试" |
| 会话不存在 | 4005 | 检查会话ID | "会话不存在或已失效" |
| 超出限流 | 4006 | 显示限制和重置时间 | "今日提问次数已用完，明天再试吧" |
| 内容违规 | 4007 | 拦截并记录 | "内容包含敏感信息，请修改后重试" |
| 模型超时 | 5002 | 自动重试1次 | "AI正在思考中，请稍候..." |
| 模型不可用 | 4008 | 切换备用模型 | "AI服务繁忙，已为您切换其他模型" |
| 系统错误 | 5001 | 记录日志并告警 | "系统繁忙，请稍后再试" |

### 6.2 重试策略

```python
class RetryStrategy:
    def __init__(self):
        self.max_retries = 3
        self.retryable_errors = [
            "timeout",
            "rate_limit_exceeded",
            "service_unavailable"
        ]
        self.backoff_factor = 2  # 指数退避

    async def execute_with_retry(self, func, *args, **kwargs):
        last_error = None

        for attempt in range(self.max_retries):
            try:
                return await func(*args, **kwargs)
            except Exception as e:
                last_error = e

                if not self.is_retryable(e):
                    break

                if attempt < self.max_retries - 1:
                    wait_time = self.backoff_factor ** attempt
                    await asyncio.sleep(wait_time)

        raise last_error

    def is_retryable(self, error: Exception) -> bool:
        error_type = type(error).__name__.lower()
        return any(err in error_type for err in self.retryable_errors)
```

### 6.3 降级策略

```python
class FallbackStrategy:
    async def call_ai_with_fallback(self, prompt_context: PromptContext):
        # 主模型
        primary_model = "gpt-4"
        fallback_models = ["gpt-3.5-turbo", "claude-3"]

        models = [primary_model] + fallback_models

        for model in models:
            try:
                result = await call_ai_model(prompt_context, model_id=model)
                if self.validate_response(result):
                    return result
            except Exception as e:
                logger.warning(f"Model {model} failed: {e}")
                continue

        # 所有模型都失败，返回默认回复
        return self.get_fallback_response()
```

## 7. 性能优化策略

### 7.1 缓存策略

#### 7.1.1 会话上下文缓存
- **缓存对象:** 活跃会话的上下文信息
- **缓存键:** `ai:session:{session_id}:context`
- **TTL:** 1小时（有活动时自动续期）
- **更新策略:** 每次发送消息后更新
- **淘汰策略:** LRU

#### 7.1.2 Prompt模板缓存
- **缓存对象:** 活跃的Prompt模板
- **缓存键:** `ai:prompt:template:{template_code}`
- **TTL:** 30分钟
- **失效策略:** 模板更新后主动失效

#### 7.1.3 向量检索缓存
- **缓存对象:** 相似查询的检索结果
- **缓存键:** `ai:rag:cache:{query_hash}`
- **TTL:** 5分钟
- **命中率:** 预期 > 30%

### 7.2 并发控制

```python
class ConcurrencyController:
    def __init__(self):
        self.semaphore = asyncio.Semaphore(100)  # 最大并发数
        self.queue = asyncio.Queue(maxsize=1000)  # 请求队列

    async def process_request(self, request):
        # 获取信号量，控制并发数
        async with self.semaphore:
            try:
                return await self._process(request)
            except Exception as e:
                logger.error(f"Request failed: {e}")
                raise

    async def _process(self, request):
        # 实际处理逻辑
        ...
```

### 7.3 批量处理优化

对于高频操作，采用批量处理：

```python
async def batch_save_messages(messages: List[Message]):
    # 使用批量插入
    await batch_insert(ai_message, messages)

    # 批量更新统计
    await batch_update_conversation_stats(
        [msg.conversation_id for msg in messages]
    )
```

## 8. 安全与合规

### 8.1 内容安全过滤

```python
class ContentSafetyFilter:
    def __init__(self):
        # 敏感词列表
        self.sensitive_words = self._load_sensitive_words()

        # 正则表达式规则
        self.patterns = [
            r'\b暴力\b',
            r'\b赌博\b',
            # ... 更多规则
        ]

    async def check(self, content: str) -> SafetyCheckResult:
        # 1. 敏感词检测
        word_hits = self._check_sensitive_words(content)
        if word_hits:
            return SafetyCheckResult(
                is_safe=False,
                reason=f"包含敏感词: {', '.join(word_hits)}",
                category="sensitive_word"
            )

        # 2. 调用第三方内容审核API
        api_result = await self._call_safety_api(content)
        if not api_result.is_safe:
            return api_result

        # 3. 特殊场景检测
        if self._detect_inappropriate_scenario(content):
            return SafetyCheckResult(
                is_safe=False,
                reason="包含不适宜内容",
                category="inappropriate"
            )

        return SafetyCheckResult(is_safe=True)
```

### 8.2 用户限流

```python
class RateLimiter:
    async def check_and_consume(self, user_id: int) -> RateLimitResult:
        today = datetime.now().strftime("%Y-%m-%d")
        key = f"ai:rate_limit:{user_id}:{today}"

        # 获取当前使用量
        usage = await redis.hgetall(key)

        # 获取用户限额（基于会员等级）
        limit = await self._get_user_limit(user_id)

        # 检查是否超限
        if usage.get('count', 0) >= limit['max_questions']:
            return RateLimitResult(
                allowed=False,
                remaining=0,
                reset_at=self._get_reset_time()
            )

        # 增加计数
        await redis.hincrby(key, 'count', 1)
        await redis.hincrby(key, 'tokens', estimated_tokens)

        return RateLimitResult(
            allowed=True,
            remaining=limit['max_questions'] - usage['count'] - 1,
            reset_at=self._get_reset_time()
        )
```

### 8.3 数据脱敏

```python
def mask_sensitive_data(data: dict) -> dict:
    """脱敏敏感数据"""
    masked = data.copy()

    # 手机号脱敏
    if 'phone' in masked:
        masked['phone'] = mask_phone(masked['phone'])

    # 姓名脱敏
    if 'real_name' in masked:
        masked['real_name'] = mask_name(masked['real_name'])

    return masked
```

## 9. 监控与告警

### 9.1 关键指标监控

| 指标 | 类型 | 阈值 | 告警级别 |
|------|------|------|---------|
| 平均响应时间 | Gauge | > 3s | Warning |
| P99响应时间 | Gauge | > 10s | Critical |
| 请求成功率 | Counter | < 95% | Critical |
| 模型调用失败率 | Counter | > 5% | Warning |
| 内容安全拦截率 | Counter | > 10% | Info |
| Token消耗速率 | Counter | 异常波动 | Warning |

### 9.2 日志规范

```python
import logging

logger = logging.getLogger(__name__)

# 结构化日志
logger.info(
    "ai_message_processed",
    extra={
        "user_id": user_id,
        "session_id": session_id,
        "message_id": message_id,
        "model_id": model_id,
        "tokens": tokens,
        "latency_ms": latency,
        "success": True
    }
)
```

## 10. 关键代码示例

### 10.1 消息处理服务

```typescript
// services/ai-message.service.ts
export class AIMessageService {
  constructor(
    private readonly redis: Redis,
    private readonly db: Database,
    private readonly aiClient: AIClient,
    private readonly safetyFilter: ContentSafetyFilter
  ) {}

  async processMessage(
    userId: number,
    sessionId: string,
    request: SendMessageRequest
  ): Promise<SendMessageResponse> {
    // 1. 限流检查
    await this.checkRateLimit(userId);

    // 2. 安全审核
    const safetyResult = await this.safetyFilter.check(request.textContent);
    if (!safetyResult.isSafe) {
      throw new ContentSafetyError(safetyResult.reason);
    }

    // 3. 获取会话上下文
    const context = await this.getConversationContext(sessionId);

    // 4. 保存用户消息
    const userMessage = await this.saveUserMessage(sessionId, request);

    // 5. 构建Prompt
    const promptContext = await this.buildPromptContext(userId, sessionId, request, context);

    // 6. 调用AI
    const aiResponse = await this.aiClient.generate(promptContext);

    // 7. 后处理
    const processed = await this.postProcess(aiResponse, context);

    // 8. 保存AI回复
    const aiMessage = await this.saveAIMessage(sessionId, processed, aiResponse);

    // 9. 更新缓存
    await this.updateSessionCache(sessionId, aiMessage);

    return {
      messageId: aiMessage.id,
      textContent: processed.content,
      knowledgePoints: processed.knowledgePoints,
      ragSources: processed.ragSources,
      tokens: {
        input: aiResponse.inputTokens,
        output: aiResponse.outputTokens
      },
      latency: aiResponse.latency
    };
  }

  private async buildPromptContext(
    userId: number,
    sessionId: string,
    request: SendMessageRequest,
    context: ConversationContext
  ): Promise<PromptContext> {
    // 获取用户画像
    const userProfile = await this.getUserProfile(userId);

    // 选择模板
    const template = await this.selectTemplate(context);

    // RAG检索
    const ragResults = template.enableRag
      ? await this.ragRetrieve(request.textContent, context)
      : [];

    // 获取历史
    const history = await this.getRecentHistory(sessionId, template.historyWindow);

    // 构建变量
    const variables = {
      userName: userProfile.nickname || '同学',
      gradeLevel: context.gradeLevel,
      subjectName: context.subjectName,
      question: request.textContent,
      knowledgePoints: ragResults.map(r => r.content).join('\n'),
      history: this.formatHistory(history),
      currentDate: new Date().toISOString().split('T')[0]
    };

    return {
      systemPrompt: this.renderTemplate(template.systemPrompt, variables),
      userPrompt: this.renderTemplate(template.templateContent, variables),
      ragSources: ragResults,
      variables
    };
  }
}
```

### 10.2 流式响应处理器

```typescript
// services/stream-processor.service.ts
export class StreamProcessor {
  private activeStreams = new Map<string, AbortController>();

  async processStream(
    sessionId: string,
    promptContext: PromptContext,
    onChunk: (chunk: StreamChunk) => void,
    onComplete: (messageId: number) => void,
    onError: (error: Error) => void
  ): Promise<void> {
    const controller = new AbortController();
    this.activeStreams.set(sessionId, controller);

    try {
      const stream = await this.aiClient.streamGenerate(promptContext, {
        signal: controller.signal
      });

      let accumulated = '';

      for await (const chunk of stream) {
        if (this.isStopped(sessionId)) {
          break;
        }

        accumulated += chunk.content;

        onChunk({
          content: chunk.content,
          isComplete: chunk.isComplete,
          tokens: chunk.tokens,
          isFirst: chunk.isFirst,
          isLast: chunk.isLast
        });
      }

      // 保存完整消息
      const messageId = await this.saveMessage(sessionId, accumulated);
      onComplete(messageId);

    } catch (error) {
      if (error.name === 'AbortError') {
        logger.info(`Stream aborted for session: ${sessionId}`);
      } else {
        logger.error(`Stream error: ${error}`);
        onError(error);
      }
    } finally {
      this.activeStreams.delete(sessionId);
    }
  }

  stopStream(sessionId: string): void {
    const controller = this.activeStreams.get(sessionId);
    if (controller) {
      controller.abort();
      logger.info(`Stream stopped: ${sessionId}`);
    }
  }

  private isStopped(sessionId: string): boolean {
    return this.activeStreams.has(sessionId) === false;
  }
}
```

## 11. 部署与运维

### 11.1 环境配置

```yaml
# config/ai-service.yaml
ai:
  models:
    primary:
      provider: openai
      model_id: gpt-4
      api_key: ${OPENAI_API_KEY}
      base_url: ${OPENAI_BASE_URL}

    fallback:
      provider: openai
      model_id: gpt-3.5-turbo
      api_key: ${OPENAI_API_KEY}

  rag:
    enabled: true
    vector_db:
      type: milvus
      host: ${MILVUS_HOST}
      port: ${MILVUS_PORT}
      collection: knowledge_points

    embedding:
      model: text-embedding-ada-002
      dimension: 1536

  safety:
    enabled: true
    provider: aliyun
    api_key: ${ALIYUN_ACCESS_KEY}

  limits:
    max_concurrent: 100
    max_tokens_per_request: 4000
    timeout_seconds: 30
```

### 11.2 Docker部署

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/main.js"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  ai-service:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgresql://user:pass@postgres:5432/primetop
    depends_on:
      - redis
      - postgres
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_DB=primetop
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
    volumes:
      - postgres-data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  redis-data:
  postgres-data:
```

## 12. 测试策略

### 12.1 单元测试

```typescript
// __tests__/ai-message.service.test.ts
describe('AIMessageService', () => {
  let service: AIMessageService;
  let mockDb: jest.Mocked<Database>;
  let mockAI: jest.Mocked<AIClient>;

  beforeEach(() => {
    mockDb = createMockDatabase();
    mockAI = createMockAIClient();
    service = new AIMessageService(mockRedis, mockDb, mockAI, mockSafety);
  });

  it('should process message successfully', async () => {
    // Given
    const request = {
      role: 1,
      content: '1+1=?'
    };

    mockAI.generate.mockResolvedValue({
      content: '1+1=2',
      inputTokens: 10,
      outputTokens: 5,
      latency: 100
    });

    // When
    const result = await service.processMessage(123, 'sess-123', request);

    // Then
    expect(result.textContent).toBe('1+1=2');
    expect(mockAI.generate).toHaveBeenCalled();
  });

  it('should block unsafe content', async () => {
    // Given
    const request = {
      role: 1,
      content: '如何制造炸弹'
    };

    mockSafety.check.mockResolvedValue({
      isSafe: false,
      reason: '包含危险内容'
    });

    // When & Then
    await expect(
      service.processMessage(123, 'sess-123', request)
    ).rejects.toThrow(ContentSafetyError);
  });
});
```

### 12.2 集成测试

```typescript
// __tests__/integration/ai-flow.test.ts
describe('AI Message Integration Flow', () => {
  it('should complete full message flow', async () => {
    // 1. Create conversation
    const conv = await createConversation({
      userId: 123,
      subjectId: 1,
      gradeLevel: '小学三年级'
    });

    // 2. Send user message
    const response = await sendMessage({
      sessionId: conv.sessionId,
      textContent: '小明有5个苹果...'
    });

    // 3. Verify response
    expect(response.messageId).toBeDefined();
    expect(response.textContent).toContain('3个');

    // 4. Check database records
    const messages = await getMessages(conv.sessionId);
    expect(messages).toHaveLength(2); // user + ai

    // 5. Check RAG sources
    expect(response.ragSources).toHaveLengthGreaterThan(0);

    // 6. Check cache
    const cache = await getSessionCache(conv.sessionId);
    expect(cache.totalMessages).toBe(2);
  });
});
```

## 13. 迭代规划

### 13.1 MVP阶段 (P0)
- 基础文字问答
- 简单上下文管理
- 基础安全过滤
- 用户限流控制

### 13.2 V1.0 (P1)
- 语音输入和输出
- 图片输入（OCR）
- RAG检索增强
- 多模型切换
- 消息反馈机制

### 13.3 V1.5 (P2)
- 流式响应
- 知识点溯源引用
- 个性化Prompt优化
- 对话历史智能摘要
- 学习建议生成

### 13.4 V2.0 (P3)
- 多模态理解
- 视频讲解生成
- 个性化学习路径
- 跨会话知识关联
- 学习效果评估

## 14. 风险与应对

| 风险 | 影响 | 概率 | 应对策略 |
|------|------|------|---------|
| AI回答不准确 | 高 | 中 | RAG增强 + 用户反馈 + 多模型复核 |
| 成本过高 | 高 | 高 | 限额 + 缓存 + 模型分层 |
| 响应慢 | 中 | 中 | 降级 + 缓存 + 超时控制 |
| 内容违规 | 高 | 低 | 多重审核 + 人工抽检 |
| 模型供应商依赖 | 高 | 低 | 多供应商 + 本地模型备份 |

---

**文档版本:** v1.0
**创建日期:** 2026-06-17
**最后更新:** 2026-06-17
**维护人:** AI服务团队