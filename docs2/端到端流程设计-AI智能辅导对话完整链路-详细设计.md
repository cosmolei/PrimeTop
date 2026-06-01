# 端到端流程设计 - AI 智能辅导对话完整链路

## 1. 概述

### 1.1 文档目的

本文档详细描述 AI 智能辅导对话从用户发起提问到最终响应交付、行为归档的完整端到端链路。作为 PrimeTop 最重要的 P0 核心功能，AI 辅导对话涉及客户端 UI 交互、BFF 编排、多模型调度、RAG 检索、SSE 流式推送、对话持久化、安全审核、学习行为追踪等多个子系统的协作。本文档旨在让开发人员理解完整数据流转和调用链路，可直接依据本文档进入编码阶段。

### 1.2 适用范围

覆盖以下场景：
- 文字输入提问（P0）
- 语音输入提问（P1，经 ASR 转文字后走相同链路）
- 图片输入提问（P1，经 OCR/多模态模型理解后融合到对话链路）
- 多轮追问（P0）
- "再讲简单点"/"换一种讲法"/"生成同类题"等快捷指令（P1）

### 1.3 核心设计原则

1. **启发式优先**：默认先给出思路提示，不直接暴露完整答案
2. **学段适配**：根据用户年级自动调整讲解深度、语言风格
3. **RAG 增强**：每次提问均结合教材知识库进行检索增强
4. **流式交付**：采用 SSE 实现逐 token 推送，首 token 延迟 < 3s
5. **安全兜底**：所有 AI 输出必须经过内容安全审核后才可推送到客户端

---

## 2. 端到端流程总览

### 2.1 主流程时序

```text
[客户端]                [BFF层]                [AI辅导服务]           [RAG服务]          [模型网关]        [安全审核]
   │                       │                        │                     │                   │                 │
   │  1.发送用户消息        │                        │                     │                   │                 │
   │──────────────────────>│                        │                     │                   │                 │
   │                       │  2.鉴权+限流+参数校验    │                     │                   │                 │
   │                       │                        │                     │                   │                 │
   │                       │  3.创建/获取会话        │                     │                   │                 │
   │                       │──────────────────────>│                     │                   │                 │
   │                       │                        │                     │                   │                 │
   │                       │                        │  4.意图识别+学段适配  │                   │                 │
   │                       │                        │──────┐              │                   │                 │
   │                       │                        │<─────┘              │                   │                 │
   │                       │                        │                     │                   │                 │
   │                       │                        │  5.RAG知识检索       │                   │                 │
   │                       │                        │────────────────────>│                   │                 │
   │                       │                        │  6.检索结果返回      │                   │                 │
   │                       │                        │<────────────────────│                   │                 │
   │                       │                        │                     │                   │                 │
   │                       │                        │  7.组装Prompt+模型选择                    │                 │
   │                       │                        │────────────────────────────────────────>│                 │
   │                       │                        │                     │                   │                 │
   │  8.SSE: 思路提示token  │                        │                     │  8'.流式响应token  │                 │
   │<──────────────────────│<──────────────────────│<────────────────────────────────────────│                 │
   │  SSE: 步骤token...    │                        │                     │                   │                 │
   │  SSE: 完整回答...     │                        │                     │                   │                 │
   │                       │                        │                     │                   │                 │
   │                       │                        │  9.完整回答产出       │                   │                 │
   │                       │                        │─────────────────────────────────────────────────────────>│
   │                       │                        │  10.审核通过         │                   │                 │
   │                       │                        │<──────────────────────────────────────────────────────────│
   │                       │                        │                     │                   │                 │
   │  11.SSE: 最终回答完成  │                        │                     │                   │                 │
   │<──────────────────────│<──────────────────────│                     │                   │                 │
   │                       │                        │  12.持久化对话+行为日志                     │                 │
   │                       │                        │──────┐              │                   │                 │
   │                       │                        │<─────┘              │                   │                 │
   │                       │                        │  13.异步:更新画像/知识点掌握度              │                 │
   │                       │                        │──────┐              │                   │                 │
   │                       │                        │<─────┘              │                   │                 │
```

### 2.2 阶段划分

| 阶段 | 职责 | 超时目标 |
|------|------|----------|
| Phase 1: 请求接入 | BFF 鉴权、限流、参数校验 | < 50ms |
| Phase 2: 会话管理 | 加载/创建会话上下文 | < 100ms |
| Phase 3: 意图理解 | 意图分类、学段适配、Prompt模板选择 | < 200ms |
| Phase 4: RAG 检索 | 知识库向量检索 + 结构化知识补充 | < 800ms |
| Phase 5: 模型调用 | Prompt 组装 + 大模型流式推理 | 首 token < 3s |
| Phase 6: 流式交付 | SSE 推送到客户端渲染 | 逐 token |
| Phase 7: 后审核 | 完整回答安全审核 + 必要截断 | < 500ms |
| Phase 8: 后处理 | 对话持久化、行为日志、画像更新 | 异步 |

---

## 3. 数据结构定义

### 3.1 请求与响应数据结构

#### 3.1.1 用户消息请求

```typescript
// POST /api/v1/ai/chat/send
interface ChatSendRequest {
  /** 会话ID，首次为null，服务端创建后返回 */
  sessionId: string | null;
  /** 用户输入内容 */
  content: ChatContent;
  /** 快捷指令类型 */
  quickAction?: 'simplify' | 'rephrase' | 'similar_question' | 'explain_detail' | null;
  /** 客户端上下文 */
  clientContext: {
    /** 当前学科 */
    subject?: string;
    /** 当前年级 */
    grade?: string;
    /** 当前教材版本ID */
    textbookId?: string;
    /** 来源页面 */
    sourcePage: 'home' | 'ai_chat' | 'sync_class' | 'wrong_book' | 'question_detail';
    /** 是否弱网环境 */
    poorNetwork: boolean;
    /** 客户端时间戳 */
    clientTimestamp: number;
  };
}

/** 多模态内容 */
interface ChatContent {
  /** 内容类型 */
  type: 'text' | 'voice' | 'image' | 'mixed';
  /** 文字内容 */
  text?: string;
  /** 语音文件URL（已上传） */
  voiceUrl?: string;
  /** 语音时长(ms) */
  voiceDuration?: number;
  /** 图片URL列表（已上传） */
  imageUrls?: string[];
  /** 图片描述（客户端OCR预提取的文字） */
  imageOcrText?: string;
}
```

#### 3.1.2 SSE 事件流响应

```typescript
// Response: Content-Type: text/event-stream
// 每个事件格式: data: {JSON}\n\n

interface SSEEvent {
  /** 事件类型 */
  type: SSEEventType;
  /** 事件数据 */
  data: SSEEventData;
  /** 序列号，用于断线续传 */
  seq: number;
}

type SSEEventType =
  | 'session_created'     // 会话创建成功，返回sessionId
  | 'thinking_start'      // AI开始思考（显示loading）
  | 'thinking_end'        // 思考结束
  | 'hint_start'          // 思路提示段开始
  | 'hint_token'          // 思路提示token
  | 'hint_end'            // 思路提示段结束
  | 'answer_start'        // 正式回答段开始
  | 'answer_token'        // 正式回答token
  | 'answer_end'          // 正式回答段结束
  | 'knowledge_refs'      // 关联知识点引用
  | 'similar_questions'   // 同类题推荐（如果有）
  | 'quick_actions'       // 可用快捷操作列表
  | 'usage_update'        // 额度消耗更新
  | 'error'               // 错误事件
  | 'done';               // 整个响应完成

// 各事件Data类型
interface SessionCreatedData {
  sessionId: string;
}

interface ThinkingStartData {
  /** 预估等待提示 */
  placeholder: string;  // e.g. "正在为你分析这道数学题..."
}

interface HintTokenData {
  /** 增量文本 */
  delta: string;
  /** 所属段落索引 */
  segmentIndex: number;
}

interface AnswerTokenData {
  /** 增量文本 */
  delta: string;
  /** 所属段落索引 */
  segmentIndex: number;
  /** 数学公式标记 */
  isLatex?: boolean;
  /** 代码块标记 */
  isCode?: boolean;
}

interface KnowledgeRefData {
  refs: Array<{
    knowledgePointId: string;
    name: string;
    chapterName: string;
    masteryLevel: 'mastered' | 'learning' | 'weak' | 'unknown';
  }>;
}

interface QuickActionsData {
  actions: Array<{
    action: string;
    label: string;
    icon: string;
  }>;
}

interface UsageUpdateData {
  /** 本次消耗对话次数 */
  consumed: number;
  /** 今日剩余次数 */
  remaining: number;
  /** 是否为会员 */
  isMember: boolean;
}

interface ErrorData {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}

interface DoneData {
  /** 完整回答ID */
  answerId: string;
  /** 总token数 */
  totalTokens: number;
  /** 响应耗时(ms) */
  durationMs: number;
  /** 消息ID */
  messageId: string;
}
```

### 3.2 核心领域模型

#### 3.2.1 会话模型

```sql
-- AI对话会话表
CREATE TABLE ai_chat_session (
    id              VARCHAR(36)     NOT NULL COMMENT '会话ID (UUID)',
    user_id         BIGINT          NOT NULL COMMENT '用户ID',
    student_id      BIGINT          NOT NULL COMMENT '学生ID',
    title           VARCHAR(100)    NULL COMMENT '会话标题（首条消息摘要/LLM生成）',
    subject         VARCHAR(20)     NULL COMMENT '关联学科',
    grade           VARCHAR(20)     NULL COMMENT '关联年级',
    textbook_id     VARCHAR(36)     NULL COMMENT '关联教材版本ID',
    status          TINYINT         NOT NULL DEFAULT 1 COMMENT '1-活跃 2-归档 3-已删除',
    message_count   INT             NOT NULL DEFAULT 0 COMMENT '消息总数',
    last_message_at DATETIME        NULL COMMENT '最后消息时间',
    source_page     VARCHAR(30)     NULL COMMENT '来源页面',
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_user_status (user_id, status, last_message_at),
    INDEX idx_student_updated (student_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI对话会话表';
```

#### 3.2.2 消息模型

```sql
-- AI对话消息表
CREATE TABLE ai_chat_message (
    id              BIGINT          NOT NULL AUTO_INCREMENT COMMENT '消息ID',
    session_id      VARCHAR(36)     NOT NULL COMMENT '会话ID',
    user_id         BIGINT          NOT NULL COMMENT '用户ID',
    role            TINYINT         NOT NULL COMMENT '1-user 2-assistant 3-system',
    content_type    TINYINT         NOT NULL COMMENT '1-纯文本 2-含图片 3-含语音 4-混合',
    content         JSON            NOT NULL COMMENT '消息内容JSON',
    quick_action    VARCHAR(30)     NULL COMMENT '快捷指令类型',
    -- AI回答相关字段（role=2时有效）
    model_id        VARCHAR(50)     NULL COMMENT '使用的模型ID',
    prompt_tokens   INT             NULL COMMENT '输入token数',
    completion_tokens INT           NULL COMMENT '输出token数',
    total_tokens    INT             NULL COMMENT '总token数',
    duration_ms     INT             NULL COMMENT '模型响应耗时(ms)',
    -- 知识关联
    knowledge_refs  JSON            NULL COMMENT '关联知识点ID列表',
    -- 安全审核
    audit_status    TINYINT         NULL COMMENT '1-待审核 2-通过 3-拦截 4-修改后通过',
    audit_result    JSON            NULL COMMENT '审核结果详情',
    -- 结构化回答段
    segments        JSON            NULL COMMENT '回答分段JSON [{type,content,order}]',
    -- 用户反馈
    user_rating     TINYINT         NULL COMMENT '1-不满意 2-一般 3-满意',
    user_feedback   VARCHAR(500)    NULL COMMENT '用户反馈内容',
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE INDEX uk_session_order (session_id, id),
    INDEX idx_user_created (user_id, created_at),
    INDEX idx_model_created (model_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI对话消息表';
```

#### 3.2.3 消息内容 JSON 结构

```typescript
// 用户消息 content JSON
interface UserMessageContent {
  text: string;
  images?: Array<{
    url: string;
    thumbnailUrl: string;
    ocrText?: string;
  }>;
  voice?: {
    url: string;
    durationMs: number;
    asrText?: string;  // 语音转文字结果
  };
}

// AI回答消息 content JSON
interface AssistantMessageContent {
  /** 结构化回答段落 */
  segments: Array<{
    type: 'hint' | 'answer' | 'summary' | 'practice' | 'extension';
    content: string;
    order: number;
    latexBlocks?: string[];
    codeBlocks?: Array<{ language: string; code: string }>;
  }>;
  /** 关联知识点 */
  knowledgeRefs?: Array<{
    knowledgePointId: string;
    name: string;
  }>;
  /** 同类题推荐 */
  similarQuestionIds?: string[];
}

// 回答段类型（用于segments字段独立存储以支持渐进式展示）
interface AnswerSegment {
  type: 'hint' | 'step' | 'explanation' | 'summary' | 'tip' | 'practice';
  content: string;
  order: number;
  metadata?: {
    formulaLatex?: string;
    imageNeeded?: boolean;
    isKeyPoint?: boolean;
  };
}
```

### 3.3 RAG 检索结果结构

```typescript
interface RAGRetrievalResult {
  /** 检索到的文档片段 */
  chunks: Array<{
    content: string;
    source: 'textbook' | 'knowledge_point' | 'question_bank' | 'exam_guide';
    sourceId: string;
    chapterName?: string;
    knowledgePointId?: string;
    relevanceScore: number;  // 0-1
  }>;
  /** 检索元信息 */
  meta: {
    query: string;
    embeddingModel: string;
    topK: number;
    totalCandidates: number;
    retrievalTimeMs: number;
  };
}
```

---

## 4. API 接口设计

### 4.1 发送对话消息（SSE 流式）

```
POST /api/v1/ai/chat/send
Content-Type: application/json
Accept: text/event-stream
Authorization: Bearer <access_token>
X-Request-Id: <uuid>
X-Device-Id: <device_fingerprint>

请求体: ChatSendRequest (见 3.1.1)
响应: SSE 事件流 (见 3.1.2)
```

**限流规则：**
- 免费用户：每日 10 次，每分钟 3 次
- 月度会员：每日 100 次，每分钟 10 次
- 年度会员：每日不限（软限 500 次/天），每分钟 15 次
- 并发限制：同一用户同时只允许 1 个活跃 SSE 连接

**错误码：**

| 错误码 | HTTP 状态 | 含义 | 客户端动作 |
|--------|-----------|------|-----------|
| CHAT_RATE_LIMITED | 429 | 频率超限 | 显示倒计时提示 |
| CHAT_QUOTA_EXHAUSTED | 429 | 当日次数用尽 | 引导开通会员 |
| CHAT_SESSION_NOT_FOUND | 404 | 会话不存在 | 重新创建会话 |
| CHAT_CONCURRENT_LIMIT | 409 | 并发连接超限 | 提示等待上一个回答完成 |
| CHAT_CONTENT_BLOCKED | 400 | 输入内容被安全拦截 | 提示内容不合规 |
| CHAT_MODEL_UNAVAILABLE | 503 | 模型服务不可用 | 自动降级或提示稍后重试 |

### 4.2 获取历史会话列表

```
GET /api/v1/ai/chat/sessions?page=1&pageSize=20&status=active
Authorization: Bearer <access_token>

响应:
{
  "code": 0,
  "data": {
    "sessions": [
      {
        "sessionId": "uuid",
        "title": "关于二次函数的讨论",
        "subject": "math",
        "grade": "G9",
        "messageCount": 8,
        "lastMessagePreview": "二次函数的顶点公式是...",
        "lastMessageAt": "2026-06-01T15:30:00+08:00",
        "createdAt": "2026-06-01T14:00:00+08:00"
      }
    ],
    "total": 42,
    "page": 1,
    "pageSize": 20
  }
}
```

### 4.3 获取会话消息历史

```
GET /api/v1/ai/chat/sessions/{sessionId}/messages?cursor={lastMessageId}&limit=30&direction=before
Authorization: Bearer <access_token>

响应:
{
  "code": 0,
  "data": {
    "messages": [
      {
        "messageId": "123456",
        "role": "user",
        "contentType": "text",
        "content": { "text": "什么是二次函数？" },
        "quickAction": null,
        "createdAt": "2026-06-01T14:01:00+08:00"
      },
      {
        "messageId": "123457",
        "role": "assistant",
        "contentType": "text",
        "content": {
          "segments": [
            { "type": "hint", "content": "先想想...", "order": 1 },
            { "type": "explanation", "content": "二次函数是...", "order": 2 }
          ]
        },
        "knowledgeRefs": [...],
        "modelId": "glm-4",
        "totalTokens": 256,
        "durationMs": 1200,
        "createdAt": "2026-06-01T14:01:02+08:00"
      }
    ],
    "hasMore": true,
    "cursor": "123456"
  }
}
```

### 4.4 会话管理操作

```
// 修改会话标题
PUT /api/v1/ai/chat/sessions/{sessionId}
Body: { "title": "新标题" }

// 归档会话
PUT /api/v1/ai/chat/sessions/{sessionId}/archive

// 删除会话（逻辑删除）
DELETE /api/v1/ai/chat/sessions/{sessionId}

// 对回答进行反馈
POST /api/v1/ai/chat/messages/{messageId}/feedback
Body: { "rating": 3, "feedback": "讲解很清晰" }
```

---

## 5. 关键流程详细设计

### 5.1 Phase 1: 请求接入 (BFF 层)

#### 5.1.1 鉴权与权限校验

```java
@Service
public class ChatAuthService {

    /**
     * 校验用户是否有权发起AI对话
     * @return ChatAuthResult 含用户信息、学生档案、会员状态
     */
    public ChatAuthResult authenticate(String accessToken, String deviceId) {
        // 1. 解析JWT Token，提取userId
        Long userId = jwtService.parseToken(accessToken);

        // 2. 检查Token是否被吊销（Redis黑名单）
        if (tokenBlacklistService.isRevoked(accessToken)) {
            throw new ChatException(ErrorCode.AUTH_TOKEN_REVOKED);
        }

        // 3. 加载用户信息和学生档案
        User user = userService.getById(userId);
        StudentProfile profile = studentProfileService.getActiveProfile(userId);

        // 4. 检查会员状态和对话额度
        MembershipInfo membership = membershipService.getMembership(userId);
        QuotaInfo quota = quotaService.getChatQuota(userId, membership.getTier());

        // 5. 检查是否有并发活跃对话
        String activeSseKey = "chat:active_sse:" + userId;
        if (redisTemplate.hasKey(activeSseKey)) {
            throw new ChatException(ErrorCode.CHAT_CONCURRENT_LIMIT);
        }

        return ChatAuthResult.builder()
            .userId(userId)
            .studentId(profile.getStudentId())
            .grade(profile.getGrade())
            .subject(profile.getSubject())
            .textbookId(profile.getTextbookId())
            .membershipTier(membership.getTier())
            .quota(quota)
            .build();
    }
}
```

#### 5.1.2 限流策略

```java
@Service
public class ChatRateLimiter {

    /**
     * 多层限流校验
     * 层级: 全局 > 用户级 > 用户每日 > 用户每分钟 > 并发
     */
    public void checkRateLimit(Long userId, MembershipTier tier) {
        // 1. 全局限流 - 保护系统容量
        String globalKey = "ratelimit:chat:global";
        if (!rateLimitService.allow(globalKey, 5000, 60)) {  // 5000次/分钟
            throw new ChatException(ErrorCode.SYSTEM_BUSY);
        }

        // 2. 用户每分钟限流
        int minuteLimit = tier == MembershipTier.FREE ? 3
                        : tier == MembershipTier.MONTHLY ? 10 : 15;
        String minuteKey = "ratelimit:chat:min:" + userId;
        if (!rateLimitService.allow(minuteKey, minuteLimit, 60)) {
            throw new ChatException(ErrorCode.CHAT_RATE_LIMITED);
        }

        // 3. 用户每日额度限流
        int dailyLimit = tier == MembershipTier.FREE ? 10
                       : tier == MembershipTier.MONTHLY ? 100 : 500;
        String dailyKey = "ratelimit:chat:day:" + userId + ":" + LocalDate.now();
        long dailyUsed = redisTemplate.opsForValue().increment(dailyKey);
        if (dailyUsed == 1) {
            redisTemplate.expire(dailyKey, 1, TimeUnit.DAYS);
        }
        if (dailyUsed > dailyLimit) {
            throw new ChatException(ErrorCode.CHAT_QUOTA_EXHAUSTED);
        }
    }
}
```

### 5.2 Phase 2: 会话管理

#### 5.2.1 会话创建与加载

```java
@Service
public class ChatSessionService {

    /**
     * 获取或创建会话
     * - 如果请求中带sessionId，加载现有会话并校验归属
     * - 如果sessionId为null，创建新会话
     */
    @Transactional
    public ChatSession resolveSession(ChatSendRequest request, ChatAuthResult auth) {
        if (request.getSessionId() != null) {
            // 加载已有会话
            ChatSession session = sessionMapper.selectById(request.getSessionId());
            if (session == null || session.getStatus() == SessionStatus.DELETED) {
                throw new ChatException(ErrorCode.CHAT_SESSION_NOT_FOUND);
            }
            if (!session.getUserId().equals(auth.getUserId())) {
                throw new ChatException(ErrorCode.AUTH_FORBIDDEN);
            }
            if (session.getStatus() == SessionStatus.ARCHIVED) {
                // 自动解除归档
                session.setStatus(SessionStatus.ACTIVE);
                sessionMapper.updateById(session);
            }
            return session;
        }

        // 创建新会话
        ChatSession newSession = ChatSession.builder()
            .id(UUID.randomUUID().toString())
            .userId(auth.getUserId())
            .studentId(auth.getStudentId())
            .subject(request.getClientContext().getSubject())
            .grade(request.getClientContext().getGrade() ?? auth.getGrade())
            .textbookId(request.getClientContext().getTextbookId() ?? auth.getTextbookId())
            .status(SessionStatus.ACTIVE)
            .sourcePage(request.getClientContext().getSourcePage())
            .messageCount(0)
            .build();
        sessionMapper.insert(newSession);
        return newSession;
    }

    /**
     * 加载会话上下文（最近N条消息，用于多轮对话）
     */
    public ConversationContext loadConversationContext(String sessionId, int maxTurns) {
        // 取最近 maxTurns 轮对话（每轮 = 1个user + 1个assistant）
        List<ChatMessage> recentMessages = messageMapper.selectRecentBySession(
            sessionId, maxTurns * 2
        );

        // 构建上下文，控制token总量
        ConversationContext ctx = new ConversationContext();
        int totalTokens = 0;
        int maxContextTokens = 4096;  // 上下文窗口上限

        for (ChatMessage msg : recentMessages) {
            int msgTokens = tokenEstimator.estimate(msg.getContent().toString());
            if (totalTokens + msgTokens > maxContextTokens) break;
            ctx.addMessage(msg);
            totalTokens += msgTokens;
        }

        return ctx;
    }
}
```

### 5.3 Phase 3: 意图识别与 Prompt 编排

#### 5.3.1 意图分类

```java
@Service
public class ChatIntentClassifier {

    /** 意图类型 */
    public enum ChatIntent {
        CONCEPT_QUESTION,     // 概念理解："什么是二次函数"
        PROBLEM_SOLVING,      // 题目求解："这道题怎么做"
        KNOWLEDGE_REVIEW,     // 知识复习："帮我复习一下力学"
        TEXT_ANALYSIS,        // 文本分析："这段文言文什么意思"
        COMPOSITION_HELP,     // 作文辅导："帮我看看这篇作文"
        RECITATION_ASSIST,    // 背诵辅助："帮我检查背诵"
        GENERAL_CHAT,         // 日常闲聊
        INAPPROPRIATE         // 不当内容
    }

    /**
     * 分类用户意图
     * 采用轻量级模型快速分类，不消耗大量token
     */
    public IntentResult classify(String userMessage, String subject, String grade) {
        // 1. 规则引擎快速匹配（正则 + 关键词）
        IntentResult ruleResult = ruleBasedClassify(userMessage, subject);
        if (ruleResult.getConfidence() > 0.9) {
            return ruleResult;  // 规则匹配高置信度直接返回
        }

        // 2. 轻量模型分类（使用低成本模型）
        String classifyPrompt = buildClassifyPrompt(userMessage, subject, grade);
        ModelResponse response = modelGateway.call(
            ModelCallRequest.builder()
                .modelId("intent-classifier-v1")  // 专用微调小模型
                .prompt(classifyPrompt)
                .maxTokens(100)
                .temperature(0.0)
                .build()
        );

        return parseIntentResponse(response.getContent());
    }

    private IntentResult ruleBasedClassify(String message, String subject) {
        // 题目求解模式：包含"怎么做"、"解题步骤"、"算式"等
        if (PROBLEM_PATTERN.matcher(message).find()) {
            return new IntentResult(ChatIntent.PROBLEM_SOLVING, 0.85);
        }
        // 作文相关模式
        if (COMPOSITION_PATTERN.matcher(message).find() || "chinese".equals(subject)) {
            return new IntentResult(ChatIntent.COMPOSITION_HELP, 0.7);
        }
        // 不当内容模式
        if (safetyKeywordMatcher.matches(message)) {
            return new IntentResult(ChatIntent.INAPPROPRIATE, 0.95);
        }
        return new IntentResult(ChatIntent.GENERAL_CHAT, 0.3);
    }
}
```

#### 5.3.2 Prompt 模板编排

```java
@Service
public class PromptComposer {

    /**
     * 组装完整Prompt
     * 结构: System Prompt + 学段适配指令 + RAG知识片段 + 对话历史 + 当前问题
     */
    public ComposedPrompt compose(
        ChatIntent intent,
        String grade,
        String subject,
        ConversationContext history,
        RAGRetrievalResult ragResult,
        String userMessage,
        String quickAction
    ) {
        ComposedPrompt prompt = new ComposedPrompt();

        // 1. System Prompt 基础模板
        prompt.setSystemPrompt(loadSystemPrompt(intent, grade));

        // 2. 学段适配指令
        prompt.appendSystemInstruction(getGradeAdaptation(grade));

        // 3. 学科专项指令
        if (subject != null) {
            prompt.appendSystemInstruction(getSubjectInstruction(subject, intent));
        }

        // 4. 快捷指令处理
        if (quickAction != null) {
            prompt.appendSystemInstruction(getQuickActionInstruction(quickAction));
        }

        // 5. RAG 知识片段注入
        if (ragResult != null && !ragResult.getChunks().isEmpty()) {
            String knowledgeBlock = buildKnowledgeBlock(ragResult.getChunks());
            prompt.appendSystemInstruction(knowledgeBlock);
        }

        // 6. 对话历史
        prompt.setHistoryMessages(toModelMessages(history));

        // 7. 当前用户消息
        prompt.setUserMessage(userMessage);

        // 8. 输出格式要求
        prompt.appendSystemInstruction(getOutputFormatRequirement(intent));

        return prompt;
    }

    /**
     * 根据年级生成适配指令
     */
    private String getGradeAdaptation(String grade) {
        return switch (GradeGroup.fromGrade(grade)) {
            case PRESCHOOL -> """
                你正在与一位幼儿园小朋友对话。
                - 使用极简短句，每句不超过10个字
                - 多用比喻和生活中的例子
                - 大量使用鼓励性语言："你真棒！""太厉害了！"
                - 避免任何抽象概念
                - 使用emoji让回答更生动 🌟🌈
                """;
            case PRIMARY_LOW -> """
                你正在与一位小学低年级(1-3年级)学生对话。
                - 语言简单清晰，使用生活化例子
                - 解释概念时先举具体实例再归纳
                - 步骤最多拆分3步
                - 使用鼓励性语言
                - 适当使用emoji增加趣味
                """;
            case PRIMARY_HIGH -> """
                你正在与一位小学高年级(4-6年级)学生对话。
                - 语言清晰易懂，适当引入学科术语
                - 解题时展示完整步骤，标注关键转折点
                - 可以使用简单公式，但要解释公式含义
                - 每个知识点配一个例子
                """;
            case JUNIOR -> """
                你正在与一位初中生对话。
                - 使用标准学科术语，必要时给出通俗解释
                - 展示完整解题步骤，标注关键公式和定理
                - 适当关联考试重点
                - 引导思考，不要直接给全部答案
                """;
            case SENIOR -> """
                你正在与一位高中生对话。
                - 使用标准学科术语和专业表达
                - 展示完整推导过程，注重逻辑严密性
                - 关联高考考点和常见题型
                - 指出易错点和注意事项
                - 适当拓展关联知识
                """;
        };
    }

    /**
     * 答案管控策略：根据意图决定是否隐藏答案
     */
    private String getOutputFormatRequirement(ChatIntent intent) {
        if (intent == ChatIntent.PROBLEM_SOLVING) {
            return """
                请按以下结构回答：
                1. 【思路提示】先给出解题方向，不展示具体计算过程（放在<thint>标签内）
                2. 【解题步骤】展示完整解题过程，每步标注使用的公式/定理
                3. 【总结方法】归纳这类题的通用解法
                4. 【易错提醒】指出这道题容易犯的错误
                5. 【练习建议】给出一个类似题让学生自己尝试
                """;
        }
        // 其他意图的输出格式...
        return "请给出清晰、准确、结构化的回答。";
    }
}
```

### 5.4 Phase 4: RAG 知识检索

#### 5.4.1 检索流程

```java
@Service
public class ChatRAGService {

    /**
     * 执行知识检索增强
     */
    public RAGRetrievalResult retrieve(String userMessage, String subject, String grade,
                                        String textbookId, ChatIntent intent) {
        // 1. 查询改写 - 将口语化问题转为检索友好的query
        String retrievalQuery = queryRewriter.rewrite(userMessage, subject, grade);

        // 2. 并行执行多路检索
        CompletableFuture<List<RetrievalChunk>> textbookFuture =
            searchAsync(textbookIndexName, retrievalQuery, subject, grade, textbookId, 5);
        CompletableFuture<List<RetrievalChunk>> knowledgeFuture =
            searchAsync(knowledgeIndexName, retrievalQuery, subject, null, 5);
        CompletableFuture<List<RetrievalChunk>> questionFuture = CompletableFuture.completedFuture(List.of());
        if (intent == ChatIntent.PROBLEM_SOLVING) {
            questionFuture = searchAsync(questionIndexName, retrievalQuery, subject, grade, 3);
        }

        // 等待所有检索完成（最多等800ms）
        CompletableFuture.allOf(textbookFuture, knowledgeFuture, questionFuture)
            .orTimeout(800, TimeUnit.MILLISECONDS)
            .exceptionally(ex -> null)
            .join();

        // 3. 合并 + 去重 + 重排序
        List<RetrievalChunk> allChunks = new ArrayList<>();
        allChunks.addAll(safeGet(textbookFuture));
        allChunks.addAll(safeGet(knowledgeFuture));
        allChunks.addAll(safeGet(questionFuture));

        // 4. 相关性过滤（低于阈值0.6的丢弃）
        List<RetrievalChunk> filtered = allChunks.stream()
            .filter(c -> c.getRelevanceScore() >= 0.6)
            .collect(Collectors.toList());

        // 5. RRF (Reciprocal Rank Fusion) 重排序
        List<RetrievalChunk> reranked = reciprocalRankFusion(filtered, 3);

        return RAGRetrievalResult.builder()
            .chunks(reranked.subList(0, Math.min(reranked.size(), 8)))
            .meta(RetrievalMeta.builder()
                .query(retrievalQuery)
                .totalCandidates(allChunks.size())
                .build())
            .build();
    }

    /**
     * 构建注入Prompt的知识文本块
     */
    private String buildKnowledgeBlock(List<RetrievalChunk> chunks) {
        StringBuilder sb = new StringBuilder();
        sb.append("以下是从教材和知识库中检索到的相关内容，请参考这些内容进行回答：\n\n");
        for (int i = 0; i < chunks.size(); i++) {
            RetrievalChunk chunk = chunks.get(i);
            sb.append(String.format("【参考资料%d】(来源:%s, 章节:%s)\n%s\n\n",
                i + 1,
                chunk.getSource(),
                chunk.getChapterName() ?? "通用知识",
                chunk.getContent()
            ));
        }
        sb.append("请注意：以上材料仅供参考，请结合学生的年级和理解能力进行适龄化讲解，");
        sb.append("不要直接照搬参考资料的表述。\n");
        return sb.toString();
    }
}
```

### 5.5 Phase 5: 模型调用与流式响应

#### 5.5.1 模型选择策略

```java
@Service
public class ModelSelectionStrategy {

    /**
     * 根据意图、学段、会员等级选择最优模型
     */
    public ModelSelection select(ChatIntent intent, String grade,
                                  MembershipTier tier, boolean poorNetwork) {
        ModelSelection selection = new ModelSelection();

        // 基础模型选择（根据意图）
        selection.setModelId(resolveBaseModel(intent, tier));

        // 参数配置
        selection.setParameters(ModelParameters.builder()
            .temperature(intent == ChatIntent.GENERAL_CHAT ? 0.7 : 0.3)
            .topP(0.9)
            .maxTokens(resolveMaxTokens(intent, tier))
            .frequencyPenalty(0.3)
            .presencePenalty(0.1)
            .build());

        // 弱网环境降低maxTokens加速响应
        if (poorNetwork) {
            selection.getParameters().setMaxTokens(
                Math.min(selection.getParameters().getMaxTokens(), 1024)
            );
        }

        // 设置降级备选模型链
        selection.setFallbackChain(List.of(
            selection.getModelId(),           // 首选模型
            "glm-4-flash",                    // 降级1：快速模型
            "qwen-turbo"                      // 降级2：备用模型
        ));

        return selection;
    }

    private String resolveBaseModel(ChatIntent intent, MembershipTier tier) {
        // 会员享有更高级模型
        if (tier == MembershipTier.ANNUAL) {
            return switch (intent) {
                case PROBLEM_SOLVING -> "deepseek-r1";      // 推理增强模型
                case CONCEPT_QUESTION -> "glm-4-plus";
                default -> "glm-4";
            };
        }
        // 月度会员
        if (tier == MembershipTier.MONTHLY) {
            return switch (intent) {
                case PROBLEM_SOLVING -> "glm-4-plus";
                default -> "glm-4";
            };
        }
        // 免费用户使用基础模型
        return "glm-4-flash";
    }

    private int resolveMaxTokens(ChatIntent intent, MembershipTier tier) {
        int base = switch (intent) {
            case PROBLEM_SOLVING -> 2048;
            case COMPOSITION_HELP -> 3000;
            case CONCEPT_QUESTION -> 1500;
            default -> 1024;
        };
        if (tier == MembershipTier.FREE) {
            base = Math.min(base, 1200);  // 免费用户限制输出长度
        }
        return base;
    }
}
```

#### 5.5.2 流式调用与 SSE 推送

```java
@Service
public class ChatStreamService {

    /**
     * 执行流式对话并推送SSE事件
     */
    public void streamChat(
        ChatSendRequest request,
        ChatAuthResult auth,
        ChatSession session,
        SseEmitter emitter
    ) {
        String userId = auth.getUserId().toString();
        ConversationContext history = sessionService.loadConversationContext(
            session.getId(), 10
        );

        // 1. 标记活跃SSE连接
        String activeKey = "chat:active_sse:" + userId;
        redisTemplate.opsForValue().set(activeKey, session.getId(), 5, TimeUnit.MINUTES);

        try {
            // 2. 意图识别
            sendEvent(emitter, SSEEventType.THINKING_START, Map.of(
                "placeholder", "正在思考你的问题..."
            ));

            ChatIntent intent = intentClassifier.classify(
                request.getContent().getText(),
                session.getSubject(), session.getGrade()
            );

            // 不当内容直接拦截
            if (intent == ChatIntent.INAPPROPRIATE) {
                sendEvent(emitter, SSEEventType.ERROR, Map.of(
                    "code", "CONTENT_BLOCKED",
                    "message", "你的问题包含不适宜内容，请重新提问",
                    "retryable", true
                ));
                sendEvent(emitter, SSEEventType.DONE, Map.of());
                return;
            }

            sendEvent(emitter, SSEEventType.THINKING_END, Map.of());

            // 3. RAG检索（异步，不阻塞主流程）
            CompletableFuture<RAGRetrievalResult> ragFuture = CompletableFuture.supplyAsync(
                () -> ragService.retrieve(
                    request.getContent().getText(),
                    session.getSubject(), session.getGrade(),
                    session.getTextbookId(), intent
                ),
                ragExecutor
            );

            // 4. Prompt组装
            RAGRetrievalResult ragResult = ragFuture.join();
            ComposedPrompt prompt = promptComposer.compose(
                intent, session.getGrade(), session.getSubject(),
                history, ragResult, request.getContent().getText(),
                request.getQuickAction()
            );

            // 5. 模型选择
            ModelSelection modelSelection = modelStrategy.select(
                intent, session.getGrade(), auth.getMembershipTier(),
                request.getClientContext().getPoorNetwork()
            );

            // 6. 流式调用模型
            sendEvent(emitter, SSEEventType.HINT_START, Map.of("segmentIndex", 0));

            StreamIterator modelStream = modelGateway.streamCall(
                ModelStreamRequest.builder()
                    .modelId(modelSelection.getModelId())
                    .fallbackChain(modelSelection.getFallbackChain())
                    .messages(prompt.toMessages())
                    .parameters(modelSelection.getParameters())
                    .build()
            );

            // 7. 逐token推送
            StringBuilder fullAnswer = new StringBuilder();
            int segmentIndex = 0;
            boolean inHint = true;  // 先在hint段
            int tokenCount = 0;
            long startTime = System.currentTimeMillis();

            while (modelStream.hasNext()) {
                ModelToken token = modelStream.next();
                String text = token.getText();
                fullAnswer.append(text);
                tokenCount++;

                // 检测段落切换（基于标签）
                if (inHint && text.contains("</hint>")) {
                    sendEvent(emitter, SSEEventType.HINT_END, Map.of("segmentIndex", segmentIndex));
                    segmentIndex++;
                    sendEvent(emitter, SSEEventType.ANSWER_START, Map.of("segmentIndex", segmentIndex));
                    inHint = false;
                    continue;
                }

                // 推送token
                SSEEventType tokenType = inHint ? SSEEventType.HINT_TOKEN : SSEEventType.ANSWER_TOKEN;
                sendEvent(emitter, tokenType, Map.of(
                    "delta", text,
                    "segmentIndex", segmentIndex
                ));
            }

            if (inHint) {
                // 模型没有生成hint段，直接结束hint开始answer
                sendEvent(emitter, SSEEventType.HINT_END, Map.of("segmentIndex", 0));
                segmentIndex++;
            }

            sendEvent(emitter, SSEEventType.ANSWER_END, Map.of("segmentIndex", segmentIndex));

            long durationMs = System.currentTimeMillis() - startTime;

            // 8. 后审核（异步，不阻塞推送）
            CompletableFuture<AuditResult> auditFuture = CompletableFuture.supplyAsync(
                () -> contentSafetyService.audit(fullAnswer.toString()),
                auditExecutor
            );

            // 9. 推送知识关联
            if (ragResult != null && !ragResult.getChunks().isEmpty()) {
                sendEvent(emitter, SSEEventType.KNOWLEDGE_REFS, Map.of(
                    "refs", extractKnowledgeRefs(ragResult)
                ));
            }

            // 10. 推送快捷操作
            sendEvent(emitter, SSEEventType.QUICK_ACTIONS, Map.of(
                "actions", resolveQuickActions(intent, auth.getMembershipTier())
            ));

            // 11. 推送额度更新
            sendEvent(emitter, SSEEventType.USAGE_UPDATE, Map.of(
                "consumed", 1,
                "remaining", quotaService.decrementAndGetRemaining(userId),
                "isMember", auth.getMembershipTier() != MembershipTier.FREE
            ));

            // 12. 持久化（异步）
            AuditResult auditResult = auditFuture.join();
            ChatMessage userMsg = saveUserMessage(session.getId(), auth.getUserId(), request);
            ChatMessage assistantMsg = saveAssistantMessage(
                session.getId(), auth.getUserId(),
                fullAnswer.toString(), intent, ragResult,
                modelSelection.getModelId(), tokenCount, durationMs,
                auditResult
            );

            // 13. 完成事件
            sendEvent(emitter, SSEEventType.DONE, Map.of(
                "answerId", assistantMsg.getId().toString(),
                "messageId", assistantMsg.getId().toString(),
                "totalTokens", tokenCount,
                "durationMs", durationMs
            ));

            // 14. 异步后续处理
            asyncPostProcess(userMsg, assistantMsg, session, intent, auth);

        } catch (ModelUnavailableException e) {
            sendEvent(emitter, SSEEventType.ERROR, Map.of(
                "code", "MODEL_UNAVAILABLE",
                "message", "AI助手暂时忙碌，请稍后再试",
                "retryable", true,
                "retryAfterMs", 5000
            ));
            sendEvent(emitter, SSEEventType.DONE, Map.of());
        } catch (Exception e) {
            log.error("Chat stream error, userId={}, sessionId={}", userId, session.getId(), e);
            sendEvent(emitter, SSEEventType.ERROR, Map.of(
                "code", "INTERNAL_ERROR",
                "message", "出了点问题，请重试",
                "retryable", true
            ));
            sendEvent(emitter, SSEEventType.DONE, Map.of());
        } finally {
            redisTemplate.delete(activeKey);
            emitter.complete();
        }
    }

    private void sendEvent(SseEmitter emitter, SSEEventType type, Map<String, Object> data) {
        try {
            SSEEvent event = new SSEEvent(type, data, nextSeq());
            emitter.send(SseEmitter.event()
                .name(type.name().toLowerCase())
                .data(objectMapper.writeValueAsString(event)));
        } catch (Exception e) {
            log.warn("SSE send failed: {}", e.getMessage());
        }
    }
}
```

### 5.6 Phase 6: 客户端 SSE 接收与渲染

#### 5.6.1 客户端 SSE 连接管理 (Flutter)

```dart
/// AI对话SSE客户端
class ChatSSEClient {
  static const _maxRetries = 3;
  static const _baseRetryDelay = Duration(seconds: 1);

  final Dio _dio;
  final ChatMessageStore _messageStore;
  final ChatUIController _uiController;

  StreamSubscription? _subscription;
  String? _currentSessionId;
  int _retryCount = 0;
  int _lastSeq = 0;

  /// 发送消息并接收SSE流
  Future<void> sendMessage(ChatSendRequest request) async {
    _retryCount = 0;
    await _doSend(request);
  }

  Future<void> _doSend(ChatSendRequest request) async {
    try {
      final response = await _dio.post(
        '/api/v1/ai/chat/send',
        data: request.toJson(),
        options: Options(
          responseType: ResponseType.stream,
          headers: {'Accept': 'text/event-stream'},
        ),
      );

      final stream = response.data.stream as Stream<Uint8List>;
      String buffer = '';

      _subscription = stream.listen(
        (chunk) {
          buffer += utf8.decode(chunk, allowMalformed: true);
          // 按SSE协议解析
          while (buffer.contains('\n\n')) {
            final idx = buffer.indexOf('\n\n');
            final eventStr = buffer.substring(0, idx);
            buffer = buffer.substring(idx + 2);
            _handleEvent(eventStr);
          }
        },
        onError: (error) => _handleError(error, request),
        onDone: () => _handleDone(),
        cancelOnError: false,
      );
    } on DioException catch (e) {
      if (_shouldRetry(e) && _retryCount < _maxRetries) {
        _retryCount++;
        await Future.delayed(_baseRetryDelay * _retryCount);
        await _doSend(request);
      } else {
        _uiController.showError(_errorMessage(e));
      }
    }
  }

  void _handleEvent(String eventStr) {
    final lines = eventStr.split('\n');
    String? eventType;
    String? data;

    for (final line in lines) {
      if (line.startsWith('event:')) {
        eventType = line.substring(6).trim();
      } else if (line.startsWith('data:')) {
        data = line.substring(5).trim();
      }
    }

    if (eventType == null || data == null) return;

    final event = SSEEvent.fromJson(jsonDecode(data));
    if (event.seq <= _lastSeq) return;  // 去重
    _lastSeq = event.seq;

    switch (event.type) {
      case 'session_created':
        _currentSessionId = event.data['sessionId'];
        break;
      case 'thinking_start':
        _uiController.showThinking(event.data['placeholder']);
        break;
      case 'thinking_end':
        _uiController.hideThinking();
        break;
      case 'hint_start':
        _uiController.startSegment(type: 'hint', index: event.data['segmentIndex']);
        break;
      case 'hint_token':
      case 'answer_token':
        _uiController.appendToken(
          delta: event.data['delta'],
          segmentIndex: event.data['segmentIndex'],
          isLatex: event.data['isLatex'] ?? false,
        );
        break;
      case 'hint_end':
      case 'answer_end':
        _uiController.endSegment(event.data['segmentIndex']);
        break;
      case 'knowledge_refs':
        _uiController.showKnowledgeRefs(event.data['refs']);
        break;
      case 'quick_actions':
        _uiController.showQuickActions(event.data['actions']);
        break;
      case 'usage_update':
        _messageStore.updateQuota(
          remaining: event.data['remaining'],
          isMember: event.data['isMember'],
        );
        break;
      case 'error':
        _uiController.showError(
          event.data['message'],
          retryable: event.data['retryable'],
        );
        break;
      case 'done':
        _handleDone(event.data);
        break;
    }
  }

  /// 取消当前流
  void cancel() {
    _subscription?.cancel();
    _subscription = null;
    _uiController.cancelStreaming();
  }
}
```

#### 5.6.2 回答渲染策略

```dart
/// AI回答渲染组件
class AIAnswerRenderer extends StatelessWidget {
  final List<AnswerSegment> segments;
  final bool isStreaming;
  final int streamingSegmentIndex;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (int i = 0; i < segments.length; i++)
          _buildSegment(context, segments[i], i),
        if (isStreaming)
          _StreamingIndicator(segmentIndex: streamingSegmentIndex),
      ],
    );
  }

  Widget _buildSegment(BuildContext context, AnswerSegment segment, int index) {
    return switch (segment.type) {
      'hint' => _HintCard(
          content: segment.content,
          isRevealed: index < streamingSegmentIndex || !isStreaming,
          onReveal: () => _revealHint(index),
        ),
      'step' => _StepCard(
          order: segment.order,
          content: segment.content,
          mathFormulas: segment.latexBlocks,
        ),
      'explanation' => _ExplanationCard(
          content: segment.content,
          mathFormulas: segment.latexBlocks,
        ),
      'summary' => _SummaryCard(content: segment.content),
      'tip' => _TipCard(content: segment.content),
      'practice' => _PracticeCard(
          content: segment.content,
          onStartPractice: () => _navigateToPractice(),
        ),
      _ => Text(segment.content),
    };
  }
}

/// 思路提示卡片 - 默认折叠，用户点击后展开
class _HintCard extends StatefulWidget {
  final String content;
  final bool isRevealed;
  final VoidCallback onReveal;

  @override
  State<_HintCard> createState() => _HintCardState();
}

class _HintCardState extends State<_HintCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.primaryContainer.withOpacity(0.3),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Theme.of(context).colorScheme.primary.withOpacity(0.3)),
      ),
      child: Column(
        children: [
          // 标题栏：点击展开/折叠
          InkWell(
            onTap: () {
              if (!_expanded) widget.onReveal();
              setState(() => _expanded = !_expanded);
            },
            child: Padding(
              padding: EdgeInsets.all(12),
              child: Row(
                children: [
                  Icon(Icons.lightbulb_outline, size: 18, color: Colors.amber),
                  SizedBox(width: 8),
                  Text('思路提示', style: TextStyle(fontWeight: FontWeight.w600)),
                  Spacer(),
                  AnimatedRotation(
                    turns: _expanded ? 0.5 : 0,
                    child: Icon(Icons.arrow_forward_ios, size: 14),
                  ),
                ],
              ),
            ),
          ),
          // 内容区：折叠/展开动画
          AnimatedCrossFade(
            firstChild: SizedBox.shrink(),
            secondChild: Padding(
              padding: EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: _buildRichContent(widget.content),
            ),
            crossFadeState: _expanded
                ? CrossFadeState.showSecond
                : CrossFadeState.showFirst,
            duration: Duration(milliseconds: 300),
          ),
        ],
      ),
    );
  }
}
```

### 5.7 Phase 7: 异步后处理

#### 5.7.1 后处理任务链

```java
@Service
public class ChatPostProcessor {

    /**
     * 异步后处理链：
     * 1. 安全审核结果处理
     * 2. 会话标题生成（首轮）
     * 3. 知识点关联与掌握度更新
     * 4. 学习行为日志记录
     * 5. 用户画像更新
     */
    @Async("chatPostProcessExecutor")
    public void postProcess(ChatMessage userMsg, ChatMessage assistantMsg,
                             ChatSession session, ChatIntent intent, ChatAuthResult auth) {
        try {
            // 1. 处理审核结果
            handleAuditResult(assistantMsg);

            // 2. 首轮消息生成会话标题
            if (session.getMessageCount() <= 2) {
                generateSessionTitle(session, userMsg, assistantMsg);
            }

            // 3. 更新消息计数
            sessionService.incrementMessageCount(session.getId());

            // 4. 知识点关联与掌握度更新
            if (assistantMsg.getKnowledgeRefs() != null) {
                knowledgeTrackingService.recordKnowledgeInteraction(
                    auth.getStudentId(),
                    assistantMsg.getKnowledgeRefs(),
                    intent == ChatIntent.PROBLEM_SOLVING
                        ? InteractionType.PROBLEM_SOLVING
                        : InteractionType.CONCEPT_LEARNING,
                    extractDifficultyLevel(assistantMsg)
                );
            }

            // 5. 记录学习行为事件
            learningBehaviorService.recordEvent(LearningBehaviorEvent.builder()
                .userId(auth.getUserId())
                .studentId(auth.getStudentId())
                .eventType("AI_CHAT")
                .sessionId(session.getId())
                .messageId(assistantMsg.getId())
                .subject(session.getSubject())
                .intent(intent.name())
                .modelId(assistantMsg.getModelId())
                .tokenCost(assistantMsg.getTotalTokens())
                .durationMs(assistantMsg.getDurationMs())
                .timestamp(LocalDateTime.now())
                .build()
            );

            // 6. 异步更新用户画像（去抖，不每次都更新）
            profileUpdateThrottler.throttle(auth.getStudentId(), 300_000, () -> {
                userProfileService.updateChatProfile(auth.getStudentId(), session.getSubject());
            });

        } catch (Exception e) {
            log.error("Post-process failed for message {}", assistantMsg.getId(), e);
            // 后处理失败不影响主流程，仅记录日志
        }
    }

    /**
     * 生成会话标题（使用轻量模型）
     */
    private void generateSessionTitle(ChatSession session,
                                       ChatMessage userMsg, ChatMessage assistantMsg) {
        try {
            String prompt = String.format(
                "请用不超过15个字概括以下对话的主题，只返回标题文字：\n用户：%s\n助手：%s",
                truncate(userMsg.getContent().toString(), 100),
                truncate(assistantMsg.getContent().toString(), 200)
            );
            String title = modelGateway.call(
                ModelCallRequest.builder()
                    .modelId("glm-4-flash")
                    .prompt(prompt)
                    .maxTokens(30)
                    .temperature(0.0)
                    .build()
            ).getContent();

            sessionService.updateTitle(session.getId(), title.trim());
        } catch (Exception e) {
            // 标题生成失败，使用用户首条消息的前20字
            String fallback = userMsg.getContent().getText();
            if (fallback != null && fallback.length() > 20) {
                fallback = fallback.substring(0, 20) + "...";
            }
            sessionService.updateTitle(session.getId(), fallback);
        }
    }
}
```

---

## 6. 安全审核集成

### 6.1 输入审核（同步，在意图识别前）

```java
@Service
public class ChatInputSafetyFilter {

    /**
     * 用户输入安全过滤
     * 拦截场景：政治敏感、暴力色情、个人隐私泄露、非学习类滥用
     */
    public SafetyCheckResult checkInput(String text, Long userId) {
        // 1. 关键词黑名单快速匹配
        if (blacklistMatcher.matches(text)) {
            return SafetyCheckResult.blocked("输入内容包含不合规信息");
        }

        // 2. 个人信息泄露检测（手机号、身份证号等）
        if (piiDetector.contains(text)) {
            return SafetyCheckResult.blocked("请勿在对话中包含个人隐私信息");
        }

        // 3. 轻量模型安全分类（低优先级，异步不阻塞）
        // 如果前两步通过，放行并异步补充审核

        return SafetyCheckResult.pass();
    }
}
```

### 6.2 输出审核（异步，不阻塞SSE推送）

```java
@Service
public class ChatOutputAuditor {

    /**
     * 输出审核策略：
     * - 采用"先推后审"模式：SSE流式推送不等待审核结果
     * - 审核在流结束后异步执行
     * - 如果审核发现问题，标记消息并通知客户端替换/删除
     */
    @Async
    public AuditResult auditOutput(String fullAnswer, Long messageId, Long userId) {
        AuditResult result = contentSafetyService.audit(fullAnswer);

        if (result.isBlocked()) {
            // 标记消息为审核不通过
            messageMapper.updateAuditStatus(messageId, AuditStatus.BLOCKED, result.toJson());

            // 通知客户端（通过WebSocket或下次拉取时处理）
            notificationService.sendContentReplacement(userId, messageId, result.getSafeReplacement());

            // 记录审核日志
            auditLogService.log(AuditEvent.builder()
                .targetType("AI_CHAT_MESSAGE")
                .targetId(messageId)
                .auditResult(result.getStatus().name())
                .riskCategories(result.getRiskCategories())
                .build()
            );
        } else {
            messageMapper.updateAuditStatus(messageId, AuditStatus.PASSED, null);
        }

        return result;
    }
}
```

### 6.3 答案管控策略

```java
@Service
public class AnswerControlService {

    /**
     * 答案管控配置
     * 根据用户学段和会员等级决定答案展示策略
     */
    public AnswerControlConfig getConfig(String grade, MembershipTier tier) {
        AnswerControlConfig config = new AnswerControlConfig();

        // 所有用户默认：先展示思路提示，不直接暴露答案
        config.setShowHintByDefault(true);
        config.setAutoRevealAnswer(false);  // 需用户主动点击"查看完整解答"

        // 幼儿和小学低年级：更严格的答案管控
        GradeGroup gradeGroup = GradeGroup.fromGrade(grade);
        if (gradeGroup == GradeGroup.PRESCHOOL || gradeGroup == GradeGroup.PRIMARY_LOW) {
            config.setRequireInteractiveStep(true);  // 需要互动式逐步揭示
            config.setMaxAutoRevealSteps(2);  // 最多自动展示2步
        }

        // 高中阶段：可适当放宽，但仍需展示思考过程
        if (gradeGroup == GradeGroup.SENIOR) {
            config.setAutoRevealAnswer(true);  // 高中生自动展示完整解答
            config.setShowHintByDefault(true);  // 但仍然先给提示
        }

        return config;
    }
}
```

---

## 7. 快捷指令处理

### 7.1 快捷指令定义与处理

```typescript
// 快捷指令类型
type QuickAction =
  | 'simplify'          // 再讲简单点 - 降低一个难度等级重新解释
  | 'rephrase'          // 换一种讲法 - 用不同的方式重新解释
  | 'similar_question'  // 生成同类题 - 基于当前知识点生成练习题
  | 'explain_detail'    // 详细展开 - 对某个点展开详细说明
  | 'add_to_wrongbook'  // 加入错题本 - 将当前题目加入错题本
  | 'ask_teacher';      // 我还有疑问 - 引导继续追问

// 指令对应的Prompt模板
const QUICK_ACTION_PROMPTS: Record<QuickAction, string> = {
  simplify: `
    用户觉得刚才的解释太难理解了。请用更简单的方式重新解释，要求：
    - 使用更短的句子和更通俗的词汇
    - 增加生活化的比喻和例子
    - 减少专业术语，或对术语给出通俗解释
    - 适合{grade_adjust_down}年级学生的理解水平
  `,
  rephrase: `
    用户希望换一种方式理解。请用完全不同的角度和方法重新解释，要求：
    - 换一种讲解方式（如：之前用推理，这次用画图/举例）
    - 使用不同的例子
    - 保留核心知识不变
  `,
  similar_question: `
    请基于刚才讨论的知识点，生成一道类似的练习题，要求：
    - 难度与原题相当
    - 考察相同的知识点
    - 先只给题目，不直接给答案
    - 等用户作答后再给出解析
  `,
  explain_detail: `
    用户希望对当前内容进行更详细的展开。请：
    - 补充更多细节和推导过程
    - 增加更多的示例和对比
    - 关联相关的知识点
  `,
};
```

### 7.2 快捷指令服务端处理

```java
@Service
public class QuickActionService {

    /**
     * 处理快捷指令
     * 快捷指令复用当前会话上下文，在历史消息基础上继续对话
     */
    public QuickActionContext prepareContext(String action, String sessionId, Long userId) {
        // 加载最近一轮对话（用户问题 + AI回答）
        List<ChatMessage> lastTurn = messageMapper.selectLastNTurns(sessionId, 1);
        if (lastTurn.isEmpty()) {
            throw new ChatException(ErrorCode.CHAT_NO_CONTEXT);
        }

        ChatMessage lastUserMsg = lastTurn.stream()
            .filter(m -> m.getRole() == MessageRole.USER).findFirst().orElseThrow();
        ChatMessage lastAssistantMsg = lastTurn.stream()
            .filter(m -> m.getRole() == MessageRole.ASSISTANT).findFirst().orElseThrow();

        // 特殊处理：加入错题本不走对话链路
        if ("add_to_wrongbook".equals(action)) {
            wrongBookService.createFromAIMessage(userId, lastAssistantMsg);
            return QuickActionContext.directResult("已加入错题本 ✅");
        }

        // 其他指令：构建新的对话请求
        String prompt = QUICK_ACTION_PROMPTS.get(action);
        return QuickActionContext.chatContext(
            prompt,
            lastUserMsg,
            lastAssistantMsg
        );
    }
}
```

---

## 8. 错误处理与降级策略

### 8.1 错误分级处理

```java
@Service
public class ChatErrorHandler {

    /**
     * 按错误严重程度分级处理
     */
    public void handleError(Exception e, SseEmitter emitter, String userId) {
        if (e instanceof RateLimitException) {
            // Level 1: 限流 - 客户端提示等待
            RateLimitException rle = (RateLimitException) e;
            sendErrorAndDone(emitter, "CHAT_RATE_LIMITED",
                "请求太快了，请稍等一会儿再试", true, rle.getRetryAfterMs());

        } else if (e instanceof QuotaExhaustedException) {
            // Level 2: 额度用尽 - 引导开通会员
            sendErrorAndDone(emitter, "CHAT_QUOTA_EXHAUSTED",
                "今日免费对话次数已用完，开通会员可享更多次数", false, null);
            // 异步记录额度事件
            eventPublisher.publishQuotaExhausted(userId);

        } else if (e instanceof ModelUnavailableException) {
            // Level 3: 模型不可用 - 尝试降级
            sendErrorAndDone(emitter, "CHAT_MODEL_UNAVAILABLE",
                "AI助手暂时忙碌，请稍后再试", true, 5000);

        } else if (e instanceof ModelTimeoutException) {
            // Level 4: 模型超时
            sendErrorAndDone(emitter, "CHAT_MODEL_TIMEOUT",
                "回答生成时间较长，请重新提问", true, 3000);

        } else if (e instanceof ContentBlockedException) {
            // Level 5: 内容安全拦截
            sendErrorAndDone(emitter, "CHAT_CONTENT_BLOCKED",
                "你的问题包含不适宜内容，请重新提问", true, null);

        } else {
            // Level 6: 未知错误
            log.error("Unexpected chat error, userId={}", userId, e);
            sendErrorAndDone(emitter, "INTERNAL_ERROR",
                "出了点问题，请重试", true, null);
            // 告警
            alertService.sendChatErrorAlert(userId, e);
        }
    }
}
```

### 8.2 模型降级链

```java
@Service
public class ModelFallbackChain {

    /**
     * 模型调用降级策略
     * 主模型失败后，按优先级尝试备选模型
     */
    public StreamIterator callWithFallback(ModelStreamRequest request) {
        List<String> tryChain = new ArrayList<>();
        tryChain.add(request.getModelId());
        tryChain.addAll(request.getFallbackChain());

        Exception lastException = null;
        for (String modelId : tryChain) {
            try {
                return modelGateway.streamCall(
                    request.withModelId(modelId)
                );
            } catch (ModelUnavailableException e) {
                log.warn("Model {} unavailable, trying fallback", modelId);
                lastException = e;
            } catch (ModelRateLimitException e) {
                log.warn("Model {} rate limited, trying fallback", modelId);
                lastException = e;
            }
        }

        // 所有模型都失败，返回一个安全的降级响应
        return StreamIterator.of(
            "抱歉，AI助手暂时无法回答。请稍后再试，或尝试换一种方式描述你的问题。"
        );
    }
}
```

### 8.3 SSE 断线重连

```typescript
// 客户端断线重连策略
class ChatSSEReconnect {
  private _maxRetries: number = 3;
  private _baseDelay: number = 1000;

  async reconnectWithResume(
    sessionId: string,
    lastSeq: number,
    request: ChatSendRequest
  ): Promise<void> {
    // 1. 先尝试从服务端恢复中断的流
    try {
      final response = await _dio.post(
        '/api/v1/ai/chat/resume',
        data: {
          sessionId: sessionId,
          lastSeq: lastSeq,
        },
      );

      if (response.data['resumable']) {
        // 服务端还在生成，从lastSeq继续推送
        this._connectToSSE(response.data['resumeUrl'], lastSeq);
        return;
      }
    } catch (e) {
      // 恢复失败，重新发送
    }

    // 2. 无法恢复，重新发起完整请求
    await this._retrySend(request);
  }
}
```

---

## 9. 性能优化策略

### 9.1 关键路径优化

| 优化点 | 策略 | 目标 |
|--------|------|------|
| BFF鉴权 | Redis缓存用户会话，避免每次查DB | < 20ms |
| 会话加载 | 最近会话缓存到Redis | < 30ms |
| RAG检索 | 热点知识向量预加载 + 异步检索 | < 800ms |
| Prompt组装 | 模板预编译 + 缓存 | < 10ms |
| 模型首token | Prompt长度控制 + 模型预热 | < 3s |
| SSE推送 | Nginx关闭buffering + chunked传输 | 实时 |
| 对话持久化 | 异步写入 + 批量 | 不阻塞响应 |

### 9.2 缓存策略

```java
@Service
public class ChatCacheManager {

    /**
     * 多级缓存架构
     * L1: 本地Caffeine缓存（热点会话上下文、Prompt模板）
     * L2: Redis缓存（用户额度、会话元信息、限流计数）
     * L3: 数据库（消息历史、会话详情）
     */

    // Prompt模板本地缓存（变更时通过配置中心推送刷新）
    @Cacheable(value = "promptTemplates", cacheManager = "localCacheManager")
    public PromptTemplate getPromptTemplate(String intent, String grade) {
        return promptTemplateMapper.selectByIntentAndGrade(intent, grade);
    }

    // 用户会话上下文缓存（Redis，5分钟TTL）
    public ConversationContext getCachedContext(String sessionId) {
        String key = "chat:context:" + sessionId;
        String cached = redisTemplate.opsForValue().get(key);
        if (cached != null) {
            return objectMapper.readValue(cached, ConversationContext.class);
        }
        ConversationContext ctx = loadContextFromDB(sessionId);
        redisTemplate.opsForValue().set(key, objectMapper.writeValueAsString(ctx),
            5, TimeUnit.MINUTES);
        return ctx;
    }

    // AI回答缓存（相同问题短时间去重）
    public String getCachedAnswer(String questionHash, String contextHash) {
        String key = "chat:answer_cache:" + questionHash + ":" + contextHash;
        return redisTemplate.opsForValue().get(key);
    }

    public void cacheAnswer(String questionHash, String contextHash,
                             String answer, int ttlSeconds) {
        String key = "chat:answer_cache:" + questionHash + ":" + contextHash;
        redisTemplate.opsForValue().set(key, answer, ttlSeconds, TimeUnit.SECONDS);
    }
}
```

### 9.3 AI 输出缓存复用

```java
@Service
public class AIOutputCacheService {

    /**
     * 对相同/高度相似的问题，复用已有AI回答
     * 条件：
     * 1. 问题相似度 > 0.95
     * 2. 学段、学科相同
     * 3. 原回答在24小时内
     * 4. 原回答通过安全审核
     * 5. 用户评分不为"不满意"
     */
    public CacheLookupResult lookupSimilarAnswer(
        String userMessage, String subject, String grade) {

        // 1. 问题向量化
        float[] embedding = embeddingService.embed(userMessage);

        // 2. 在回答缓存中检索相似问题
        List<CachedAnswer> candidates = answerCacheRepository.searchSimilar(
            embedding, subject, grade, 0.95, 3
        );

        if (candidates.isEmpty()) {
            return CacheLookupResult.miss();
        }

        // 3. 取最相似的已审核回答
        CachedAnswer best = candidates.get(0);
        return CacheLookupResult.hit(best.getAnswerId(), best.getContent());
    }
}
```

---

## 10. 监控与告警

### 10.1 关键监控指标

```yaml
# Prometheus指标定义
metrics:
  # 请求量
  - name: chat_request_total
    type: counter
    labels: [user_tier, intent, subject, grade, model_id, status]
  
  # 首 token 延迟
  - name: chat_first_token_duration_ms
    type: histogram
    labels: [model_id, intent]
    buckets: [500, 1000, 2000, 3000, 5000, 10000]
  
  # 完整响应延迟
  - name: chat_total_duration_ms
    type: histogram
    labels: [model_id, intent]
    buckets: [1000, 3000, 5000, 10000, 30000, 60000]
  
  # Token消耗
  - name: chat_token_consumed
    type: counter
    labels: [model_id, token_type]  # prompt / completion
  
  # 模型调用成功率
  - name: chat_model_call_result
    type: counter
    labels: [model_id, result]  # success / fallback / failure
  
  # RAG检索命中率
  - name: chat_rag_retrieval_hit_rate
    type: gauge
  
  # SSE连接数
  - name: chat_active_sse_connections
    type: gauge
  
  # 安全审核拦截率
  - name: chat_audit_block_rate
    type: gauge
    labels: [audit_type]  # input / output
  
  # 用户反馈评分
  - name: chat_user_rating
    type: histogram
    labels: [rating]  # 1/2/3
```

### 10.2 告警规则

```yaml
alerts:
  - name: ChatFirstTokenSlow
    condition: p95(chat_first_token_duration_ms) > 5000
    duration: 3m
    severity: warning
    message: "AI对话首token延迟过高 P95={{ $value }}ms"
  
  - name: ChatModelErrorRate
    condition: rate(chat_model_call_result{result="failure"}[5m]) / rate(chat_model_call_result[5m]) > 0.1
    severity: critical
    message: "模型调用失败率过高 {{ $value | humanizePercentage }}"
  
  - name: ChatQuotaExhaustionSpike
    condition: rate(chat_request_total{status="quota_exhausted"}[10m]) > 100
    severity: warning
    message: "额度耗尽请求激增，可能需要调整限额"
  
  - name: ChatSSEConnectionLeak
    condition: chat_active_sse_connections > 10000
    severity: critical
    message: "活跃SSE连接数异常 {{ $value }}，可能存在连接泄漏"
  
  - name: ChatAuditBlockRateHigh
    condition: chat_audit_block_rate > 0.05
    severity: warning
    message: "内容审核拦截率偏高 {{ $value | humanizePercentage }}，需排查"
```

---

## 11. 数据流转图

### 11.1 消息生命周期状态机

```text
用户消息:
  [创建] → [已发送] → [已持久化] → [已关联知识点]
                                    ↘ [已归档]

AI回答消息:
  [创建] → [流式生成中] → [生成完成] → [审核中] → [审核通过] → [已持久化]
                                    ↘ [审核拦截] → [已替换] → [已持久化]
                                                        ↘ [已删除]
  任何阶段异常:
    [生成中] → [生成失败] → [已记录] → [已重试/放弃]
```

### 11.2 Token 消耗追踪

```text
用户请求
  │
  ├─ 意图分类调用: ~100 tokens (轻量模型)
  │
  ├─ RAG检索: 0 tokens (向量检索，不消耗模型token)
  │
  ├─ 主模型调用:
  │   ├─ System Prompt: ~300-800 tokens (含RAG知识片段)
  │   ├─ 对话历史: ~200-4000 tokens (按轮数动态调整)
  │   ├─ 用户消息: ~50-500 tokens
  │   └─ 模型输出: ~200-3000 tokens
  │
  ├─ 标题生成(首轮): ~80 tokens (轻量模型)
  │
  └─ 总计: 单次对话 ~800-8000 tokens
```

---

## 12. 与其他模块的交互

### 12.1 模块依赖关系

```text
AI辅导对话链路
  │
  ├─→ 用户账号服务: 鉴权、学生档案
  ├─→ 会员权益服务: 额度校验、功能门控
  ├─→ RAG知识库服务: 向量检索、知识片段
  ├─→ 模型网关: 多模型调度、流式调用
  ├─→ 内容安全服务: 输入/输出审核
  ├─→ 错题服务: "加入错题本"快捷操作
  ├─→ 知识点服务: 知识点关联、掌握度更新
  ├─→ 学习行为服务: 行为日志记录
  ├─→ 用户画像服务: 画像更新
  ├─→ 通知服务: 审核拦截通知
  └─→ 配置中心: Prompt模板、模型配置、限额配置
```

### 12.2 事件发布

| 事件 | 触发时机 | 下游消费方 |
|------|---------|-----------|
| ChatMessageCreated | AI回答持久化后 | 学习行为服务、数据分析服务 |
| ChatQuotaConsumed | 每次对话消耗额度后 | 额度管控服务、运营分析 |
| ChatFeedbackReceived | 用户对回答评分后 | AI质量评估服务、Prompt优化 |
| ChatContentAudited | 输出审核完成后 | 审核管理后台、质量统计 |
| ChatSessionTitleGenerated | 会话标题生成后 | 会话列表缓存更新 |

---

## 13. 开发任务分解建议

| 序号 | 任务 | 预估工时 | 前置依赖 |
|------|------|---------|---------|
| 1 | DB表创建 (session + message) | 0.5d | 无 |
| 2 | BFF鉴权+限流拦截器 | 1d | 用户服务、会员服务 |
| 3 | 会话管理CRUD接口 | 1d | DB表 |
| 4 | SSE基础设施搭建 | 1d | 无 |
| 5 | 意图分类服务（规则引擎 + 轻量模型） | 2d | 模型网关 |
| 6 | Prompt模板管理+编排引擎 | 2d | 配置中心 |
| 7 | RAG检索集成 | 1.5d | RAG服务 |
| 8 | 模型调用+流式响应 | 2d | 模型网关 |
| 9 | 消息持久化+对话历史加载 | 1d | DB表 |
| 10 | 安全审核集成（输入+输出） | 1.5d | 内容安全服务 |
| 11 | 答案管控+渐进式展示 | 1d | 无 |
| 12 | 快捷指令处理 | 1d | 任务5,6 |
| 13 | 客户端SSE接收+渲染 | 3d | 任务4 |
| 14 | 后处理异步链 | 1.5d | 知识点服务、行为服务 |
| 15 | 降级与容错 | 1d | 任务8 |
| 16 | 联调+集成测试 | 2d | 全部 |
| **合计** | | **~22人天** | |

---

*文档版本: v1.0 | 创建时间: 2026-06-01 | 状态: 待评审*
