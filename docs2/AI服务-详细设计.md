# AI 服务 - 详细设计

> 细化日期：2026-07-21  
> 原始文档：`docs/design/启硕-PrimeTop-全学段AI辅助学习软件项目设计文档.md` §6.2、§8.5、§8.6  
> 关联细化文档：`docs2/AI智能辅导-详细设计.md`、`docs2/AI对话引擎与会话管理-详细设计.md`、`docs2/服务端-多模型调度与成本治理-详细设计.md`、`docs2/RAG检索增强生成系统-详细设计.md`

## 1. 概述

### 1.1 模块定位

AI 服务（AI Service）是 PrimeTop 业务服务层与 AI 能力层之间的统一接入层。它为上层业务（AI 智能辅导、拍照搜题、作文辅导、理科解题、文科背诵等）提供**稳定、安全、可观测、可降级**的大模型调用入口，同时屏蔽不同模型供应商、不同模态输入、不同输出后处理策略的复杂性。

本服务不实现具体的 RAG 算法、Prompt 模板库或多模型调度算法（这些由专项引擎负责），而是负责：

- 接收业务侧请求并统一参数校验；
- 调用 RAG 检索引擎装配上下文；
- 调用 Prompt 编排引擎生成场景化提示词；
- 调用多模型调度引擎选择并执行模型；
- 对输出进行安全过滤、适龄化后处理、格式标准化；
- 记录调用日志、Token 消耗与学习行为关联；
- 在模型异常时执行降级与兜底策略。

### 1.2 核心职责

| 职责 | 说明 |
|------|------|
| 统一调用入口 | 所有 AI 生成类请求统一走 AI 服务，禁止业务服务直连大模型。 |
| 多模态输入标准化 | 将文本、图片 URL、语音转写文本、题目结构化数据统一转换为模型输入。 |
| 上下文装配 | 基于会话 ID 获取历史消息，结合 RAG 检索结果构造上下文。 |
| 模型调度委托 | 根据场景、成本、可用性调用多模型调度引擎选择模型。 |
| 安全与合规后处理 | 输出内容经安全过滤、适龄化、格式修正后返回。 |
| 调用计量与日志 | 记录每次请求、响应、Token、耗时、模型、成本、反馈。 |
| 异常降级 | 模型超时、失败、内容安全拦截时触发重试、降级或友好提示。 |

### 1.3 依赖关系

```text
业务服务层（AI辅导 / 拍题 / 作文 / 背诵 …）
                    │
                    ▼
            AI 服务（本模块）
                    │
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
Prompt 编排引擎   RAG 检索引擎   多模型调度引擎
    │               │               │
    └───────────────┴───────────────┘
                    │
        内容安全审核 / 适龄化后处理
                    │
        日志 & 计费 & 学习行为记录
```

## 2. 数据模型

### 2.1 核心实体定义

| 实体 | 英文 | 说明 |
|------|------|------|
| AI 请求记录 | ai_request | 一次大模型调用请求，含请求 ID、业务场景、输入摘要、上下文。 |
| AI 响应记录 | ai_response | 大模型返回内容，含状态、原始文本、处理后文本、Token、耗时。 |
| AI 会话上下文 | ai_session_context | 会话维度消息快照与关键记忆，用于快速构造上下文。 |
| 模型配置 | ai_model_config | 可用模型配置，含模型名、供应商、成本、能力标签、开关状态。 |
| 调用计量 | ai_usage_log | 按次计费的 Token、耗时、成本、模型、业务场景。 |
| 用户反馈 | ai_feedback | 用户对某次回答的点赞/点踩/纠错。 |

### 2.2 数据库表结构（DDL，MySQL 8）

```sql
-- AI 请求记录
CREATE TABLE `ai_request` (
    `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `request_id`      VARCHAR(64) NOT NULL COMMENT '全局请求ID，UUID 去横线',
    `session_id`      VARCHAR(64) COMMENT '会话ID',
    `business_scene`  VARCHAR(64) NOT NULL COMMENT '业务场景：chat/tutor/photo/essay/science/recite',
    `user_id`         BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
    `student_id`      BIGINT UNSIGNED COMMENT '学生ID（与家长账号区分时）',
    `subject_code`    VARCHAR(32) COMMENT '学科编码',
    `grade_level`     VARCHAR(32) COMMENT '年级标签，如 primary-3',
    `textbook_id`     BIGINT UNSIGNED COMMENT '教材版本ID',
    `input_type`      VARCHAR(20) NOT NULL DEFAULT 'TEXT' COMMENT 'TEXT / IMAGE / VOICE / MIXED',
    `input_summary`   VARCHAR(1024) NOT NULL COMMENT '输入摘要（用于日志展示、检索）',
    `input_payload`   JSON COMMENT '完整输入，含图片URL、语音ID、题目结构等',
    `context_payload` JSON COMMENT '装配后的上下文摘要',
    `prompt_hash`     VARCHAR(64) COMMENT '最终提示词哈希，用于缓存键',
    `model_id`        VARCHAR(64) COMMENT '实际调用模型ID',
    `status`          VARCHAR(32) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING / RAG / PROMPT / GENERATING / SAFETY / POST / COMPLETED / FAILED / BLOCKED',
    `retry_count`     TINYINT UNSIGNED NOT NULL DEFAULT 0,
    `client_ip`       VARCHAR(64),
    `app_version`     VARCHAR(32),
    `device_id`       VARCHAR(64),
    `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_request_id` (`request_id`),
    KEY `idx_user_created` (`user_id`, `created_at`),
    KEY `idx_session_created` (`session_id`, `created_at`),
    KEY `idx_business_scene` (`business_scene`, `status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI 请求记录';

-- AI 响应记录
CREATE TABLE `ai_response` (
    `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `request_id`        VARCHAR(64) NOT NULL COMMENT '关联请求ID',
    `output_text`       LONGTEXT COMMENT '最终返回给客户端的文本',
    `raw_output`        LONGTEXT COMMENT '模型原始输出',
    `finish_reason`     VARCHAR(32) COMMENT 'stop / length / content_filter / error',
    `prompt_tokens`     INT UNSIGNED NOT NULL DEFAULT 0,
    `completion_tokens` INT UNSIGNED NOT NULL DEFAULT 0,
    `total_tokens`      INT UNSIGNED NOT NULL DEFAULT 0,
    `latency_ms`        INT UNSIGNED NOT NULL DEFAULT 0,
    `model_id`          VARCHAR(64) NOT NULL,
    `cost_usd`          DECIMAL(10,6) DEFAULT 0 COMMENT '估算成本USD',
    `safety_status`     VARCHAR(32) DEFAULT 'PASS' COMMENT 'PASS / BLOCK / REPLACE',
    `safety_detail`     JSON COMMENT '安全审核明细',
    `error_code`        VARCHAR(64) COMMENT '失败错误码',
    `error_message`     VARCHAR(1024) COMMENT '失败描述',
    `created_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_request_id` (`request_id`),
    KEY `idx_model_created` (`model_id`, `created_at`),
    KEY `idx_finish_reason` (`finish_reason`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI 响应记录';

-- AI 会话上下文（用于快速恢复最近 N 条消息）
CREATE TABLE `ai_session_context` (
    `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `session_id`      VARCHAR(64) NOT NULL COMMENT '会话ID',
    `user_id`         BIGINT UNSIGNED NOT NULL,
    `student_id`      BIGINT UNSIGNED,
    `business_scene`  VARCHAR(64) NOT NULL,
    `subject_code`    VARCHAR(32),
    `grade_level`     VARCHAR(32),
    `textbook_id`     BIGINT UNSIGNED,
    `message_count`   INT UNSIGNED NOT NULL DEFAULT 0,
    `message_digest`  JSON COMMENT '最近 N 条消息摘要（role + content 摘要）',
    `knowledge_refs`  JSON COMMENT '会话关联知识点ID',
    `memory_snapshot` JSON COMMENT '关键记忆：如薄弱点、当前题目ID',
    `last_message_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_session_id` (`session_id`),
    KEY `idx_user_last` (`user_id`, `last_message_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI 会话上下文';

-- 模型配置快照
CREATE TABLE `ai_model_config` (
    `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `model_id`        VARCHAR(64) NOT NULL COMMENT '模型唯一标识',
    `provider`        VARCHAR(32) NOT NULL COMMENT '供应商：openai / azure / anthropic / qwen / moonshot / custom',
    `model_name`      VARCHAR(64) NOT NULL COMMENT '供应商处模型名',
    `capability_tags` JSON COMMENT '能力标签：chat / reasoning / vision / voice / coding',
    `cost_per_1k_prompt`     DECIMAL(10,6) NOT NULL DEFAULT 0,
    `cost_per_1k_completion` DECIMAL(10,6) NOT NULL DEFAULT 0,
    `max_tokens`      INT UNSIGNED NOT NULL DEFAULT 4096,
    `timeout_ms`      INT UNSIGNED NOT NULL DEFAULT 15000,
    `priority`        INT NOT NULL DEFAULT 0 COMMENT '优先级，数字越小优先级越高',
    `is_enabled`      TINYINT NOT NULL DEFAULT 1,
    `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_model_id` (`model_id`),
    KEY `idx_provider_enabled` (`provider`, `is_enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI 模型配置';

-- 用户反馈
CREATE TABLE `ai_feedback` (
    `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `request_id`      VARCHAR(64) NOT NULL,
    `user_id`         BIGINT UNSIGNED NOT NULL,
    `feedback_type`   VARCHAR(32) NOT NULL COMMENT 'thumbs_up / thumbs_down / report / correction',
    `reason`          VARCHAR(255),
    `correction_text` TEXT,
    `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    KEY `idx_request` (`request_id`),
    KEY `idx_user_created` (`user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI 回答反馈';
```

### 2.3 缓存策略

| 缓存项 | 存储 | TTL | 说明 |
|--------|------|-----|------|
| 模型配置 | Redis Hash | 5 分钟 | 热配置，变更后延迟生效。 |
| 会话上下文 | Redis Hash + MySQL | 30 分钟 | 高频访问最近会话。 |
| 回答缓存 | Redis String | 10 分钟 | 相同提示词（prompt_hash）直接复用，降低高并发成本。 |
| 安全规则 | Redis Hash | 10 分钟 | 关键词、正则、模型开关。 |
| 用户额度 | Redis Hash | 1 分钟 | 实时控制用户/场景调用额度。 |

## 3. API 接口设计

### 3.1 接口总览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/ai/chat` | 通用对话（非流式），返回完整回答。 |
| POST | `/api/v1/ai/tutor` | 辅导场景结构化回答（含思路、步骤、总结、知识点）。 |
| POST | `/api/v1/ai/stream` | SSE 流式返回，用于 AI 对话实时渲染。 |
| POST | `/api/v1/ai/feedback` | 对某次回答提交反馈。 |
| GET  | `/api/v1/ai/sessions/{sessionId}/messages` | 查询会话历史消息。 |
| POST | `/api/v1/ai/sessions/{sessionId}/clear` | 清空会话上下文。 |

### 3.2 通用请求头

```http
Authorization: Bearer <access_token>
X-Request-ID: <uuid>
X-Device-ID: <device_id>
X-App-Version: 1.0.0
Content-Type: application/json
```

### 3.3 通用对话接口

**请求：**

```http
POST /api/v1/ai/chat
```

```json
{
  "sessionId": "sess_202607211200_abc123",
  "businessScene": "chat",
  "subjectCode": "math",
  "gradeLevel": "junior-2",
  "textbookId": 1001,
  "input": {
    "type": "TEXT",
    "content": "一元二次方程的求根公式怎么推导？"
  },
  "options": {
    "stream": false,
    "answerMode": "HINT_FIRST",
    "maxTokens": 2048,
    "temperature": 0.7
  },
  "context": {
    "lastQuestionId": null,
    "knowledgePointIds": [101, 102]
  }
}
```

**响应（成功）：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "requestId": "req_202607211200_xyz789",
    "sessionId": "sess_202607211200_abc123",
    "messageId": "msg_202607211200_001",
    "role": "assistant",
    "content": "推导求根公式可以从配方法开始……",
    "contentType": "MARKDOWN",
    "knowledgePoints": [
      { "id": 101, "name": "一元二次方程" },
      { "id": 102, "name": "配方法" }
    ],
    "suggestedActions": [
      { "type": "EXPLAIN", "label": "再讲简单点" },
      { "type": "PRACTICE", "label": "练一道同类题" },
      { "type": "ADD_MISTAKE", "label": "加入错题本" }
    ],
    "usage": {
      "modelId": "qwen2.5-72b-instruct",
      "promptTokens": 320,
      "completionTokens": 412,
      "totalTokens": 732,
      "latencyMs": 2100
    }
  }
}
```

### 3.4 辅导场景接口

**请求：**

```json
{
  "sessionId": "sess_202607211201_def456",
  "businessScene": "tutor",
  "subjectCode": "physics",
  "gradeLevel": "senior-1",
  "input": {
    "type": "MIXED",
    "content": "一个物体从静止开始匀加速直线运动，5s 内位移 25m，求加速度。",
    "imageUrls": [],
    "questionMeta": {
      "questionId": 8080,
      "knowledgePointIds": [301]
    }
  },
  "options": {
    "answerMode": "STEP_BY_STEP",
    "languageStyle": "STUDENT_FRIENDLY"
  }
}
```

**响应结构：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "requestId": "req_202607211201_ghi012",
    "messageId": "msg_202607211201_001",
    "role": "assistant",
    "content": {
      "hint": "这道题考查匀变速直线运动的位移公式。",
      "steps": [
        { "step": 1, "text": "写出已知条件：v0=0, t=5s, x=25m" },
        { "step": 2, "text": "选择位移公式：x = v0*t + ½*a*t²" },
        { "step": 3, "text": "代入数据：25 = 0 + ½*a*25，得 a=2 m/s²" }
      ],
      "summary": "加速度为 2 m/s²，方向与运动方向相同。",
      "keyPoints": ["匀加速直线运动", "位移公式"],
      "commonMistakes": ["漏写单位", "混淆平均速度公式"]
    },
    "contentType": "STRUCTURED",
    "usage": { ... }
  }
}
```

### 3.5 SSE 流式接口

**请求：**

```http
POST /api/v1/ai/stream
```

请求体与 `/chat` 相同，但 `options.stream = true`。

**响应流示例：**

```text
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache
Connection: keep-alive

event: start
data: {"requestId":"req_...","messageId":"msg_..."}

event: delta
data: {"delta":"推导","finishReason":null}

event: delta
data: {"delta":"求根公式"}

event: finish
data: {"finishReason":"stop","usage":{...}}
```

### 3.6 错误响应统一格式

```json
{
  "code": 500201,
  "message": "模型调用超时，已切换至降级模型",
  "data": {
    "requestId": "req_...",
    "fallbackModel": "qwen2.5-7b-instruct",
    "retryable": true
  }
}
```

### 3.7 错误码定义

| 错误码 | 说明 | HTTP 状态 |
|--------|------|-----------|
| 0 | 成功 | 200 |
| 400001 | 参数校验失败 | 400 |
| 400002 | 输入内容为空或超过长度限制 | 400 |
| 400003 | 会话不存在或已过期 | 400 |
| 403001 | 内容安全拦截 | 403 |
| 403002 | 用户额度已耗尽 | 403 |
| 429001 | 请求过于频繁，触发限流 | 429 |
| 500201 | 模型调用超时，已降级 | 200（带降级） |
| 500202 | 模型调用失败，无可用降级 | 503 |
| 500203 | 后处理异常 | 500 |
| 500204 | RAG 检索异常 | 200（降级为无检索） |

## 4. 业务逻辑

### 4.1 核心处理流程

```text
1. 接收请求
   └─ 鉴权 / 限流 / 参数校验 / 额度检查
2. 生成 requestId，写入 ai_request(status=PENDING)
3. 加载/创建会话上下文
4. 输入安全预检（输入护栏）
   ├─ 通过 → 继续
   └─ 拦截 → status=BLOCKED，返回 403001
5. RAG 检索装配（异步/同步）
   ├─ 成功 → 拼接上下文
   └─ 失败 → 降级为无检索，记录异常但不阻断
6. Prompt 编排
   ├─ 调用 Prompt 引擎生成场景化提示词
   ├─ 计算 prompt_hash
   └─ 检查缓存命中
7. 模型路由与执行
   ├─ 多模型调度引擎选择模型
   ├─ 调用大模型（流式/非流式）
   └─ 超时或失败 → 重试/降级模型
8. 输出安全后处理
   ├─ 内容安全过滤
   ├─ 适龄化修正
   ├─ 格式标准化（Markdown/结构化）
   └─ 引用与知识点标注
9. 写入 ai_response，更新 ai_request(status=COMPLETED)
10. 异步记录 Usage、学习行为、更新会话上下文
11. 返回客户端
```

### 4.2 状态机

```text
PENDING
  │
  ▼
RAG ──(失败)──► RAG_FALLBACK
  │
  ▼
PROMPT
  │
  ▼
GENERATING ──(失败)──► RETRY ──(超限)──► FALLBACK ──(仍失败)──► FAILED
  │
  ▼
SAFETY ──(拦截)──► BLOCKED
  │
  ▼
POST_PROCESS
  │
  ▼
COMPLETED
```

状态说明：

| 状态 | 说明 |
|------|------|
| PENDING | 请求已接收，等待处理。 |
| RAG | 正在执行 RAG 检索。 |
| RAG_FALLBACK | 检索失败，使用无检索模式继续。 |
| PROMPT | 正在生成/选择 Prompt 模板。 |
| GENERATING | 模型正在生成内容。 |
| RETRY | 模型失败，进入重试。 |
| FALLBACK | 切换降级模型重新生成。 |
| FAILED | 所有尝试均失败，返回错误。 |
| BLOCKED | 安全审核拦截。 |
| POST_PROCESS | 后处理中。 |
| COMPLETED | 成功完成。 |

### 4.3 流式响应特殊处理

- 流式接口在接收到首个模型 delta 前返回 `event: start`；
- 每个 delta 经后处理（字符级安全过滤、适龄化替换）后发送；
- 如果流式过程中安全策略命中，发送 `event: safety_stop` 并结束流；
- 最后发送 `event: finish` 携带 usage 摘要；
- 客户端断开时，服务端保存已生成片段到 `ai_response` 表 `raw_output` 字段，并标记 `finish_reason=client_disconnect`。

### 4.4 降级策略

| 触发条件 | 降级行为 | 说明 |
|----------|----------|------|
| 模型超时 | 重试 1 次；仍失败切换同能力低优先级模型 | 保证可用性。 |
| 模型不可用 | 切换至备用供应商模型 | 跨供应商容灾。 |
| RAG 失败 | 关闭检索，仅使用对话上下文生成 | 避免阻塞。 |
| 安全模型异常 | 降级为本地关键词+规则过滤 | 基本合规兜底。 |
| 高并发成本 | 小模型处理简单场景，大模型处理复杂推理 | 成本治理。 |
| 用户额度耗尽 | 返回 403002，提示升级会员或明日再来 | 商业控制。 |

## 5. 代码示例

以下示例基于 Java 17 + Spring Boot 3 + WebFlux（流式接口）实现，实际可根据团队技术栈替换为同步 MVC。

### 5.1 核心请求 DTO

```java
public record AiChatRequest(
    String sessionId,
    @NotBlank String businessScene,
    String subjectCode,
    String gradeLevel,
    Long textbookId,
    @NotNull AiInput input,
    AiOptions options,
    AiContext context
) {}

public record AiInput(
    @NotNull AiInputType type,
    @NotBlank String content,
    List<String> imageUrls,
    String voiceId,
    QuestionMeta questionMeta
) {}

public record AiOptions(
    boolean stream,
    AnswerMode answerMode,
    LanguageStyle languageStyle,
    Integer maxTokens,
    Double temperature
) {
    public AiOptions {
        if (maxTokens == null) maxTokens = 2048;
        if (temperature == null) temperature = 0.7;
    }
}

public enum AiInputType { TEXT, IMAGE, VOICE, MIXED }
public enum AnswerMode { DIRECT, HINT_FIRST, STEP_BY_STEP, ONLY_CONCEPT }
public enum LanguageStyle { CHILD, STUDENT_FRIENDLY, ACADEMIC }
```

### 5.2 AI 服务入口

```java
@Service
@RequiredArgsConstructor
public class AiService {
    private final AiRequestRepository requestRepository;
    private final AiPipeline pipeline;
    private final AiResponseAssembler responseAssembler;
    private final UsageLogger usageLogger;
    private final SessionContextManager sessionManager;

    public Mono<AiChatResponse> chat(AiChatRequest req, UserContext user) {
        String requestId = IdUtil.next("req_");
        return requestRepository.savePending(requestId, req, user)
            .flatMap(r -> pipeline.execute(r)
                .flatMap(result -> responseAssembler.assemble(requestId, result))
                .doOnSuccess(resp -> {
                    requestRepository.markCompleted(requestId, resp.status());
                    usageLogger.log(requestId, resp.usage());
                    sessionManager.append(requestId, req, resp);
                })
                .doOnError(err -> requestRepository.markFailed(requestId, err))
            );
    }

    public Flux<ServerSentEvent<String>> stream(AiChatRequest req, UserContext user) {
        String requestId = IdUtil.next("req_");
        return requestRepository.savePending(requestId, req, user)
            .flatMapMany(r -> pipeline.stream(r)
                .doOnComplete(() -> requestRepository.markCompleted(requestId, "COMPLETED"))
                .doOnError(err -> requestRepository.markFailed(requestId, err))
            );
    }
}
```

### 5.3 处理管线

```java
@Component
@RequiredArgsConstructor
public class AiPipeline {
    private final InputGuard inputGuard;
    private final RagEngine ragEngine;
    private final PromptEngine promptEngine;
    private final ModelDispatcher modelDispatcher;
    private final OutputGuard outputGuard;
    private final PostProcessor postProcessor;

    public Mono<AiResult> execute(AiRequestRecord record) {
        return Mono.just(record)
            .flatMap(inputGuard::check)              // 输入安全
            .flatMap(ragEngine::augment)              // RAG 检索
            .flatMap(promptEngine::build)             // Prompt 编排
            .flatMap(modelDispatcher::call)          // 模型调用
            .flatMap(outputGuard::check)              // 输出安全
            .flatMap(postProcessor::process)          // 后处理
            .onErrorResume(ModelException.class, e -> modelDispatcher.fallback(record, e))
            .onErrorResume(RagException.class, e -> promptEngine.buildWithoutRag(record));
    }

    public Flux<ServerSentEvent<String>> stream(AiRequestRecord record) {
        return inputGuard.check(record)
            .flatMapMany(ragEngine::augmentStream)
            .flatMap(promptEngine::buildStream)
            .flatMap(modelDispatcher::stream)
            .map(delta -> outputGuard.checkStream(delta))
            .map(delta -> postProcessor.processStream(delta));
    }
}
```

### 5.4 模型路由调用

```java
@Component
@RequiredArgsConstructor
public class ModelDispatcher {
    private final ModelConfigProvider configProvider;
    private final ModelClientRegistry clientRegistry;

    public Mono<AiModelOutput> call(AiPrompt prompt) {
        ModelConfig cfg = configProvider.select(prompt.scene(), prompt.complexity());
        ModelClient client = clientRegistry.get(cfg.provider());
        return client.chat(cfg, prompt)
            .timeout(Duration.ofMillis(cfg.timeoutMs()))
            .retryWhen(Retry.backoff(1, Duration.ofMillis(200))
                .filter(e -> e instanceof TimeoutException || e instanceof IOException))
            .onErrorResume(e -> fallback(prompt, cfg));
    }

    public Mono<AiModelOutput> fallback(AiPrompt prompt, ModelConfig failedCfg) {
        ModelConfig fallback = configProvider.nextFallback(failedCfg);
        ModelClient client = clientRegistry.get(fallback.provider());
        return client.chat(fallback, prompt)
            .timeout(Duration.ofMillis(fallback.timeoutMs()));
    }
}
```

### 5.5 输出后处理（适龄化 + 安全）

```java
@Component
public class PostProcessor {
    public Mono<AiResult> process(AiModelOutput raw) {
        return Mono.fromCallable(() -> {
            String text = raw.text();
            // 1. 去除模型不稳定前缀
            text = text.trim();
            // 2. 年龄适配（小学阶段加鼓励语气，高中保持专业）
            text = AgeAdapter.adapt(text, raw.gradeLevel());
            // 3. 结构化提取知识点引用
            List<KnowledgePoint> refs = KnowledgeExtractor.extract(text);
            // 4. 生成建议动作
            List<SuggestedAction> actions = ActionRecommender.recommend(raw.businessScene(), refs);
            return new AiResult(text, refs, actions, raw.finishReason(), raw.usage());
        });
    }
}
```

## 6. 错误处理

### 6.1 异常类型

| 异常 | 触发场景 | 处理策略 |
|------|----------|----------|
| `QuotaExceededException` | 用户额度不足 | 返回 403002，不进入模型调用。 |
| `InputGuardException` | 输入命中安全规则 | 返回 403001，记录拦截日志。 |
| `RagException` | RAG 检索失败 | 降级为无检索，返回 200 但标记 `rag_fallback=true`。 |
| `ModelTimeoutException` | 模型超时 | 重试 1 次，仍失败切换降级模型。 |
| `ModelUnavailableException` | 模型不可用 | 直接切换供应商。 |
| `OutputGuardException` | 输出被安全拦截 | 返回 403001，替换为安全提示。 |
| `PostProcessException` | 后处理失败 | 返回原始模型输出，记录异常。 |

### 6.2 重试策略

```java
Retry.backoff(1, Duration.ofMillis(200))
    .maxBackoff(Duration.ofSeconds(2))
    .filter(e -> e instanceof TimeoutException || e instanceof IOException)
    .doBeforeRetry(s -> log.warn("模型调用重试: {} 次", s.totalRetries()));
```

### 6.3 降级顺序

```text
原始模型调用
    ↓ 超时/失败
同供应商低配模型（如 72B → 7B）
    ↓ 仍失败
备用供应商模型
    ↓ 仍失败
返回 503 + 友好提示
```

## 7. 性能优化

### 7.1 回答缓存

- 对 `prompt_hash` 计算 SHA-256，作为缓存键；
- 缓存内容包含 `output_text`、`knowledgePoints`、`suggestedActions`；
- 命中缓存后仍需经过安全过滤（避免缓存污染）；
- 不缓存流式输出内容本身，仅缓存完整文本用于非流式接口。

### 7.2 异步日志

- `ai_response` 写入、学习行为记录、计费日志均通过消息队列异步处理；
- 不影响主链路响应时间，保证接口 RT 99 分位低于 2.5s（不含模型生成时间）。

### 7.3 连接池与超时

- 每个模型供应商维护独立 HTTP 连接池；
- 大模型连接池大小按 QPS 配置，默认 50；
- 流式接口读取超时 60s，非流式首 token 超时 8s；
- 整体请求超时 30s（含重试）。

### 7.4 限流与熔断

- 接口限流：按用户 + 场景维度，例如免费用户 `chat` 场景 10 次/分钟；
- 模型限流：按模型供应商账号维度，防止触发供应商速率限制；
- 熔断：连续失败率 > 50% 且 1 分钟内 > 10 次，自动切换模型供应商；
- 慢调用比例 > 30% 触发告警。

## 8. 安全考虑

### 8.1 权限控制

- 所有接口必须携带有效 `access_token`；
- 学生账号只能访问自己的 `sessionId`，越权返回 403；
- 家长绑定后可通过 `student_id` 查询孩子的会话历史；
- 管理后台接口单独鉴权，不可直接复用学生端 token。

### 8.2 输入防护

- 长度限制：`content` 不超过 4000 字符；图片数量不超过 4 张；
- 关键词过滤：政治、色情、暴力、自我伤害等敏感内容；
- 意图识别：拦截非学习类请求（如“帮我写作文全文”直接给出整篇作文）；
- 未成年人保护：拒绝涉及个人隐私、线下见面、诱导消费等请求。

### 8.3 输出防护

- 输出内容安全过滤：敏感词、违法信息、不当价值观；
- 答案管控：辅导场景默认 `HINT_FIRST` 或 `STEP_BY_STEP`，避免直接给出完整答案；
- 引用校验：知识点引用必须存在于知识库，避免幻觉；
- 数学公式、化学方程式使用 LaTeX 输出，前端做安全渲染。

### 8.4 审计与隐私

- 所有 AI 调用记录 `request_id`、`user_id`、`client_ip`、`app_version`；
- 敏感输入（手机号、地址等）在日志中脱敏；
- 未成年人对话日志保存期限按法规要求（建议 6 个月 + 可导出删除）；
- 用户反馈（点踩/纠错）用于后续模型质量改进。

## 9. 测试策略

### 9.1 单元测试

- `InputGuard` 规则命中与放行；
- `PromptEngine` 场景化模板选择；
- `ModelDispatcher` 路由选择逻辑（优先级、成本、可用性）；
- `PostProcessor` 适龄化转换与知识点提取；
- `UsageLogger` Token 与成本计算。

### 9.2 集成测试

- 模拟大模型客户端（WireMock / Testcontainers），覆盖成功、超时、失败、降级；
- RAG 检索失败时的降级链路；
- 流式接口完整事件序列；
- 安全拦截返回正确错误码；
- 用户额度耗尽拦截。

### 9.3 性能测试

- 压测目标：非流式 99 分位 < 2.5s（不含模型生成），并发 200；
- 流式首 token 时间 < 1.5s；
- 缓存命中率目标 > 30%；
- 模型降级切换时间 < 5s。

### 9.4 安全测试

- 输入敏感词、绕过话术、多轮诱导；
- 输出直接答案场景是否被正确改写为分步提示；
- 越权访问他人会话；
- 未成年人数据隐私合规检查。

---

## 10. 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 统一 AI 服务入口 | 业务不直连模型 | 便于控成本、控安全、控质量、统一日志。 |
| 流式与同步接口分离 | `/stream` 与 `/chat` 独立 | 流式需要长连接与事件协议，非流式可缓存。 |
| 状态机持久化 | ai_request 表记录状态 | 便于排查、重试、审计。 |
| 失败优先降级 | 不直接失败 | 保证学习场景高可用，但记录降级以便分析成本。 |
| 输出安全后置 | 模型输出后再过滤 | 兼容不同模型供应商，统一安全策略。 |
