# AI 对话引擎与会话管理 - 详细设计

## 1. 概述

### 1.1 模块定位

AI 对话引擎是 PrimeTop 所有 AI 交互场景的底层运行时，负责管理对话会话的全生命周期：创建、上下文构建、流式调用、响应处理、状态持久化和历史归档。它向上为 AI 智能辅导、拍照搜题、作文辅导、英语口语陪练等业务场景提供统一的对话能力，向下对接 Prompt 编排系统、多模型调度层、RAG 检索引擎和内容安全审核。

### 1.2 设计目标

1. **统一抽象**：所有业务场景共用一套对话引擎，通过场景路由区分行为差异
2. **流式优先**：所有 AI 响应默认 SSE 流式输出，首 token 延迟 < 3s
3. **上下文可控**：精确管理 token 预算，避免超限导致截断或成本浪费
4. **高可用**：模型故障自动降级、超时熔断、断线重连不丢失状态
5. **可观测**：每轮对话记录 token 用量、延迟、模型、质量评分

### 1.3 与其他模块的关系

| 关联模块 | 交互方式 | 说明 |
|---------|---------|------|
| AI-Prompt 编排 | 调用 | 获取场景模板、组装最终 Prompt |
| 多模型调度与成本治理 | 调用 | 模型路由、降级熔断 |
| RAG 与知识库 | 调用 | 检索增强上下文 |
| 安全与内容合规 | 调用 | 输入/输出内容审核 |
| 学习记录与进度追踪 | 事件发布 | 对话完成事件 → 学习行为记录 |
| 错题整理 | 事件发布 | 标记加入错题本 |
| 语音服务 ASR/TTS | 调用 | 语音对话场景 |
| 用户反馈与 AI 质量评估 | 事件发布 | 对话质量评分数据 |
| API 网关 | 被调用 | SSE 流式接口 |

---

## 2. 核心概念与数据模型

### 2.1 关键概念

```
┌─────────────────────────────────────────────────┐
│                    Scene (场景)                   │
│  tutoring | photo_question | essay | oral_english │
├─────────────────────────────────────────────────┤
│              Conversation (对话会话)               │
│  一个用户的连续学习对话，可跨多轮                      │
├─────────────────────────────────────────────────┤
│                Turn (对话轮次)                     │
│  user_message + assistant_response = 1 turn      │
├─────────────────────────────────────────────────┤
│             Context Window (上下文窗口)            │
│  从历史 Turn 中选取的、送入模型的有效内容              │
└─────────────────────────────────────────────────┘
```

### 2.2 会话状态

```python
class ConversationStatus(str, Enum):
    ACTIVE = "active"           # 进行中
    PAUSED = "paused"           # 用户暂停（切换到其他页面）
    ARCHIVED = "archived"       # 已归档（用户手动归档或超时）
    SUMMARIZED = "summarized"   # 长对话已压缩，原始消息移至归档
    DELETED = "deleted"         # 用户删除（软删除）
```

### 2.3 数据库表设计

#### conversations 表

```sql
CREATE TABLE conversations (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id         BIGINT NOT NULL COMMENT '用户ID',
    scene           VARCHAR(32) NOT NULL COMMENT '场景标识: tutoring/photo_question/essay/oral_english/pronunciation/memorization',
    title           VARCHAR(128) DEFAULT NULL COMMENT '对话标题（首条消息摘要或AI生成）',
    status          VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT '会话状态',
    
    -- 学段上下文快照
    grade_level     VARCHAR(16) NOT NULL COMMENT '学段: preschool/primary/junior_senior/senior',
    grade           VARCHAR(8) NOT NULL COMMENT '年级: 1-12 或 preschool',
    subject         VARCHAR(16) DEFAULT NULL COMMENT '学科（可选）',
    textbook_id     BIGINT DEFAULT NULL COMMENT '当前教材版本ID',
    
    -- 统计信息
    turn_count      INT NOT NULL DEFAULT 0 COMMENT '对话轮次',
    total_tokens_in  INT NOT NULL DEFAULT 0 COMMENT '累计输入token',
    total_tokens_out INT NOT NULL DEFAULT 0 COMMENT '累计输出token',
    
    -- 上下文管理
    summary         TEXT DEFAULT NULL COMMENT '长对话压缩后的摘要（替换早期历史）',
    summary_turn_id BIGINT DEFAULT NULL COMMENT '摘要覆盖到的最后一条turn ID',
    context_config  JSON DEFAULT NULL COMMENT '上下文策略配置（场景级覆盖）',
    
    -- 元数据
    last_message_at DATETIME(3) DEFAULT NULL COMMENT '最后消息时间',
    last_model_used VARCHAR(64) DEFAULT NULL COMMENT '最后使用的模型标识',
    
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    deleted_at      DATETIME(3) DEFAULT NULL COMMENT '软删除时间',
    
    INDEX idx_user_status (user_id, status, last_message_at DESC),
    INDEX idx_user_scene (user_id, scene, last_message_at DESC),
    INDEX idx_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='对话会话表';
```

#### conversation_turns 表

```sql
CREATE TABLE conversation_turns (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    conversation_id BIGINT NOT NULL COMMENT '会话ID',
    turn_index      INT NOT NULL COMMENT '轮次序号（从1开始）',
    
    -- 用户消息
    user_role       VARCHAR(16) NOT NULL DEFAULT 'user' COMMENT '发送者角色: user/assistant/system',
    user_content    MEDIUMTEXT NOT NULL COMMENT '用户消息内容（纯文本/Markdown）',
    user_content_type VARCHAR(16) NOT NULL DEFAULT 'text' COMMENT 'text/image/audio/mixed',
    user_images     JSON DEFAULT NULL COMMENT '图片列表 [{"url":"...","ocr_text":"..."}]',
    user_audio_url  VARCHAR(512) DEFAULT NULL COMMENT '语音消息URL',
    
    -- AI 响应
    assistant_content MEDIUMTEXT DEFAULT NULL COMMENT 'AI回复内容（Markdown）',
    assistant_status  VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/streaming/completed/failed/censored',
    
    -- 模型调用记录
    model_id        VARCHAR(64) DEFAULT NULL COMMENT '实际使用的模型ID',
    prompt_template_id BIGINT DEFAULT NULL COMMENT '使用的Prompt模板ID',
    rag_doc_ids     JSON DEFAULT NULL COMMENT 'RAG检索命中的文档ID列表',
    input_tokens    INT DEFAULT NULL COMMENT '本轮输入token数',
    output_tokens   INT DEFAULT NULL COMMENT '本轮输出token数',
    latency_ms      INT DEFAULT NULL COMMENT '首token延迟(ms)',
    total_latency_ms INT DEFAULT NULL COMMENT '总延迟(ms)',
    
    -- 安全审核
    input_moderation_result  VARCHAR(16) DEFAULT NULL COMMENT 'pass/flagged/blocked',
    output_moderation_result VARCHAR(16) DEFAULT NULL COMMENT 'pass/flagged/blocked',
    
    -- 上下文构建快照（用于排查）
    context_snapshot MEDIUMTEXT DEFAULT NULL COMMENT '实际送入模型的上下文摘要（可选存储）',
    
    -- 用户反馈
    user_rating     TINYINT DEFAULT NULL COMMENT '用户评分 1-5',
    user_feedback   VARCHAR(512) DEFAULT NULL COMMENT '用户文字反馈',
    feedback_tags   JSON DEFAULT NULL COMMENT '反馈标签 ["wrong_answer","too_complex","inappropriate"]',
    
    -- 关联资源
    related_question_id BIGINT DEFAULT NULL COMMENT '关联题目ID（拍题场景）',
    related_essay_id    BIGINT DEFAULT NULL COMMENT '关联作文ID（作文辅导场景）',
    
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    
    UNIQUE INDEX uk_conv_turn (conversation_id, turn_index),
    INDEX idx_conv_created (conversation_id, created_at),
    INDEX idx_model_latency (model_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='对话轮次表';
```

#### conversation_context_events 表（上下文变更事件日志）

```sql
CREATE TABLE conversation_context_events (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    conversation_id BIGINT NOT NULL,
    turn_id         BIGINT DEFAULT NULL COMMENT '触发变更的turn ID',
    event_type      VARCHAR(32) NOT NULL COMMENT 'context_built/summary_created/context_truncated/model_changed',
    event_data      JSON NOT NULL COMMENT '事件详情',
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    
    INDEX idx_conv_event (conversation_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='上下文变更事件日志';
```

### 2.4 Redis 缓存结构

```
# 会话活跃状态（TTL: 30min，用户活跃时续期）
conv:active:{conversation_id} → {
    "status": "streaming",
    "current_turn_id": 12345,
    "model_id": "zhipu/glm-4-plus",
    "last_heartbeat": 1716163200
}

# 对话上下文缓存（TTL: 2h，避免每次重建）
conv:context:{conversation_id} → {
    "system_prompt": "...",
    "messages": [{"role":"user","content":"..."}, ...],
    "token_count": 2800,
    "summary_applied_up_to": 45
}

# 用户并发对话限制（TTL: 无，按用户维护）
conv:user_sessions:{user_id} → SET[conversation_id1, conversation_id2, ...]

# 流式响应缓冲（TTL: 5min，断线重连时恢复）
conv:stream:{conversation_id}:{turn_id} → {
    "content": "已输出的内容...",
    "status": "streaming|completed|failed"
}
```

---

## 3. 会话生命周期管理

### 3.1 生命周期状态机

```
                          ┌──────────────┐
          创建对话          │              │
         ─────────────→   │    ACTIVE     │ ←──── 用户发消息
                          │              │
                          └──────┬───────┘
                                 │
                    ┌────────────┼────────────────┐
                    │            │                 │
                    ▼            ▼                 ▼
             ┌──────────┐ ┌──────────┐    ┌──────────────┐
             │  PAUSED  │ │ ARCHIVED │    │  SUMMARIZED  │
             │ (超时/切页)│ │(手动归档) │    │ (长对话压缩)  │
             └────┬─────┘ └──────────┘    └──────┬───────┘
                  │                               │
                  │  用户回来发消息                  │ 用户继续对话
                  └──────────→ ACTIVE ←────────────┘
                                  │
                                  ▼
                           ┌──────────┐
                           │ DELETED  │
                           │ (软删除)  │
                           └──────────┘
```

### 3.2 会话创建流程

```python
class ConversationService:
    """
    对话会话管理服务
    """
    
    async def create_conversation(
        self,
        user_id: int,
        scene: str,
        initial_context: dict | None = None,
    ) -> Conversation:
        """
        创建新对话会话
        
        流程:
        1. 校验用户并发对话数（同场景最多 5 个 active）
        2. 获取用户学段上下文（grade_level, grade, subject, textbook）
        3. 初始化 context_config（从场景默认配置加载）
        4. 写入 conversations 表
        5. 初始化 Redis 缓存
        6. 发布 ConversationCreatedEvent
        """
        
        # 1. 并发限制检查
        active_count = await self._count_active_conversations(user_id, scene)
        if active_count >= self.MAX_ACTIVE_PER_SCENE:
            raise BusinessException(
                code="TOO_MANY_CONVERSATIONS",
                message=f"当前场景最多同时进行 {self.MAX_ACTIVE_PER_SCENE} 个对话",
            )
        
        # 2. 获取用户学段上下文
        student_profile = await self.profile_repo.get_active_profile(user_id)
        
        # 3. 获取场景默认上下文配置
        scene_config = await self.scene_config_repo.get(scene)
        context_config = scene_config.default_context_config.copy()
        if initial_context:
            context_config.update(initial_context)
        
        # 4. 创建会话
        conversation = Conversation(
            user_id=user_id,
            scene=scene,
            status=ConversationStatus.ACTIVE,
            grade_level=student_profile.grade_level,
            grade=student_profile.grade,
            subject=initial_context.get("subject") if initial_context else None,
            textbook_id=student_profile.textbook_id,
            context_config=context_config,
        )
        conversation = await self.conv_repo.create(conversation)
        
        # 5. 初始化 Redis
        await self._init_redis_cache(conversation)
        
        # 6. 发布事件
        await self.event_bus.publish(ConversationCreatedEvent(
            conversation_id=conversation.id,
            user_id=user_id,
            scene=scene,
        ))
        
        return conversation
```

### 3.3 会话自动归档

```python
class ConversationArchiveScheduler:
    """
    定时扫描并归档不活跃的对话会话
    """
    
    # 执行频率：每 10 分钟
    CRON_SCHEDULE = "*/10 * * * *"
    
    async def run(self):
        now = datetime.utcnow()
        
        # 规则1: 超过 30 分钟无消息的 active → paused
        pause_threshold = now - timedelta(minutes=30)
        paused = await self.conv_repo.bulk_update_status(
            from_status=ConversationStatus.ACTIVE,
            to_status=ConversationStatus.PAUSED,
            last_message_before=pause_threshold,
        )
        
        # 规则2: 超过 7 天无消息的 paused → archived
        archive_threshold = now - timedelta(days=7)
        archived = await self.conv_repo.bulk_update_status(
            from_status=ConversationStatus.PAUSED,
            to_status=ConversationStatus.ARCHIVED,
            last_message_before=archive_threshold,
        )
        
        # 规则3: 超过 90 天的 archived → 清理 Redis 缓存
        cleanup_threshold = now - timedelta(days=90)
        cleaned = await self.conv_repo.cleanup_redis_cache(
            last_message_before=cleanup_threshold,
        )
        
        log.info(
            "对话归档完成",
            extra={"paused": paused, "archived": archived, "cleaned": cleaned},
        )
```

---

## 4. 上下文构建引擎

### 4.1 Token 预算分配

```python
@dataclass
class ContextBudget:
    """
    上下文 token 预算分配
    
    总预算由模型上下文窗口决定，分配策略按场景可配。
    默认基于 8K 上下文窗口（如 GLM-4），大模型可达 128K。
    """
    total: int = 8192          # 模型上下文窗口总大小
    
    # 分配比例（占 total 的百分比）
    system_prompt_pct: float = 0.10     # 系统提示词
    rag_context_pct: float = 0.25       # RAG 检索结果
    history_pct: float = 0.45           # 历史对话
    current_message_pct: float = 0.15   # 当前用户消息
    safety_margin_pct: float = 0.05     # 安全余量
    
    @property
    def system_prompt_budget(self) -> int:
        return int(self.total * self.system_prompt_pct)
    
    @property
    def rag_budget(self) -> int:
        return int(self.total * self.rag_context_pct)
    
    @property
    def history_budget(self) -> int:
        return int(self.total * self.history_pct)
    
    @property
    def current_budget(self) -> int:
        return int(self.total * self.current_message_pct)
    
    @property
    def safety_margin(self) -> int:
        return int(self.total * self.safety_margin_pct)
```

**各场景预算配置示例：**

```json
{
    "tutoring": {
        "total": 8192,
        "system_prompt_pct": 0.12,
        "rag_context_pct": 0.20,
        "history_pct": 0.48,
        "current_message_pct": 0.15,
        "safety_margin_pct": 0.05
    },
    "photo_question": {
        "total": 4096,
        "system_prompt_pct": 0.08,
        "rag_context_pct": 0.35,
        "history_pct": 0.22,
        "current_message_pct": 0.30,
        "safety_margin_pct": 0.05
    },
    "essay": {
        "total": 16384,
        "system_prompt_pct": 0.10,
        "rag_context_pct": 0.15,
        "history_pct": 0.40,
        "current_message_pct": 0.30,
        "safety_margin_pct": 0.05
    },
    "oral_english": {
        "total": 4096,
        "system_prompt_pct": 0.15,
        "rag_context_pct": 0.10,
        "history_pct": 0.55,
        "current_message_pct": 0.15,
        "safety_margin_pct": 0.05
    }
}
```

### 4.2 上下文构建流程

```python
class ContextBuilder:
    """
    对话上下文构建器
    
    职责：根据 token 预算，组装送入模型的消息列表。
    优先级：系统提示 > RAG 上下文 > 当前消息 > 历史消息（从近到远）
    """
    
    def __init__(
        self,
        prompt_service: PromptTemplateService,
        rag_service: RAGService,
        token_counter: TokenCounter,
        conv_repo: ConversationRepository,
    ):
        self.prompt_service = prompt_service
        self.rag_service = rag_service
        self.token_counter = token_counter
        self.conv_repo = conv_repo
    
    async def build(
        self,
        conversation: Conversation,
        current_message: UserMessage,
        budget: ContextBudget,
    ) -> ContextResult:
        """
        构建完整的模型调用上下文
        
        Returns:
            ContextResult:
                messages: List[dict]  # [{role, content}, ...]
                token_usage: dict     # 各部分 token 用量
                rag_doc_ids: list     # 检索到的文档 ID
                truncated_turns: int  # 被截断的历史轮次数
        """
        usage = {}
        messages = []
        
        # ── Step 1: 系统提示词 ──────────────────────
        system_prompt = await self.prompt_service.render(
            scene=conversation.scene,
            grade_level=conversation.grade_level,
            grade=conversation.grade,
            subject=conversation.subject,
            variables={
                "user_name": conversation.user.nickname,
                "textbook": conversation.textbook_name,
            },
        )
        system_tokens = self.token_counter.count(system_prompt)
        
        if system_tokens > budget.system_prompt_budget:
            # 系统提示超出预算，截断（保留核心部分）
            system_prompt = self.token_counter.truncate_to_budget(
                system_prompt, budget.system_prompt_budget
            )
            system_tokens = budget.system_prompt_budget
        
        messages.append({"role": "system", "content": system_prompt})
        usage["system_prompt"] = system_tokens
        
        # ── Step 2: RAG 检索增强上下文 ──────────────
        rag_content = ""
        rag_doc_ids = []
        rag_tokens = 0
        
        if budget.rag_budget > 0:
            rag_result = await self.rag_service.search(
                query=current_message.text_content,
                grade_level=conversation.grade_level,
                subject=conversation.subject,
                max_tokens=budget.rag_budget,
                top_k=5,
            )
            rag_content = rag_result.formatted_context  # 带来源标注的格式化文本
            rag_doc_ids = rag_result.doc_ids
            rag_tokens = rag_result.token_count
        
        if rag_content:
            rag_block = (
                f"<reference_materials>\n"
                f"{rag_content}\n"
                f"</reference_materials>"
            )
            messages.append({"role": "system", "content": rag_block})
            usage["rag_context"] = rag_tokens
        
        # ── Step 3: 历史对话 ──────────────────────
        remaining_budget = budget.total - system_tokens - rag_tokens - budget.safety_margin
        
        # 先为当前消息预留
        current_tokens = self.token_counter.count_messages([
            {"role": "user", "content": current_message.to_model_format()}
        ])
        history_budget = min(
            budget.history_budget,
            remaining_budget - current_tokens,
        )
        
        history_messages, truncated = await self._build_history(
            conversation_id=conversation.id,
            budget=history_budget,
            summary=conversation.summary,
            summary_up_to=conversation.summary_turn_id,
        )
        messages.extend(history_messages)
        usage["history"] = sum(
            self.token_counter.count_messages(history_messages)
            for _ in [None]  # 只计算一次
        ) or self.token_counter.count_messages(history_messages)
        usage["truncated_turns"] = truncated
        
        # ── Step 4: 当前用户消息 ──────────────────
        messages.append({
            "role": "user",
            "content": current_message.to_model_format(),
        })
        usage["current_message"] = current_tokens
        
        # ── 校验总 token 数 ──────────────────────
        total_estimated = sum(v for k, v in usage.items() if isinstance(v, int))
        assert total_estimated <= budget.total, \
            f"上下文超预算: {total_estimated} > {budget.total}"
        
        return ContextResult(
            messages=messages,
            token_usage=usage,
            rag_doc_ids=rag_doc_ids,
            truncated_turns=truncated,
        )
    
    async def _build_history(
        self,
        conversation_id: int,
        budget: int,
        summary: str | None,
        summary_up_to: int | None,
    ) -> tuple[list[dict], int]:
        """
        从最近的轮次向前加载历史，直到 token 预算用完
        
        策略：
        1. 如果存在 summary，将其作为一条 system 消息插入（代表早期对话的摘要）
        2. 从 summary_up_to 之后的轮次开始加载
        3. 逐轮向前加载（实际是从最近的往回），直到预算用完
        """
        messages = []
        used_tokens = 0
        truncated = 0
        
        # 如果有摘要，先加入
        if summary and summary_up_to:
            summary_msg = {
                "role": "system",
                "content": f"<conversation_summary>\n{summary}\n</conversation_summary>",
            }
            summary_tokens = self.token_counter.count_messages([summary_msg])
            if summary_tokens <= budget:
                messages.insert(0, summary_msg)  # 放在历史消息最前面
                used_tokens += summary_tokens
            # 如果摘要本身就超预算，跳过（极端情况）
        
        # 加载最近的轮次
        turns = await self.conv_repo.get_recent_turns(
            conversation_id=conversation_id,
            after_turn_id=summary_up_to,
            limit=50,  # 单次最多加载 50 轮
        )
        
        # 从最新到最早遍历，构建消息列表
        for turn in reversed(turns):
            turn_messages = turn.to_model_messages()  # [user_msg, assistant_msg]
            turn_tokens = self.token_counter.count_messages(turn_messages)
            
            if used_tokens + turn_tokens > budget:
                truncated += 1
                continue  # 跳过更早的轮次
            
            # 插入到摘要之后、当前消息之前
            messages.extend(turn_messages)
            used_tokens += turn_tokens
        
        return messages, truncated
```

### 4.3 Token 计数器

```python
class TokenCounter:
    """
    Token 计数服务
    
    策略：
    1. 优先使用模型官方 tokenizer（精确）
    2. 降级使用 tiktoken 通用估算（cl100k_base）
    3. 最终降级使用字符数 / 2 的粗略估算（中文）
    """
    
    def __init__(self):
        self._tokenizers: dict[str, Any] = {}
        self._fallback_encoder = tiktoken.get_encoding("cl100k_base")
    
    def count(self, text: str, model_id: str | None = None) -> int:
        """计算单段文本的 token 数"""
        if not text:
            return 0
        
        encoder = self._get_encoder(model_id)
        if encoder:
            return len(encoder.encode(text))
        
        # 粗略估算：中文约 1.5 字/token，英文约 4 字符/token
        chinese_chars = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
        other_chars = len(text) - chinese_chars
        return int(chinese_chars / 1.5 + other_chars / 4) + 1
    
    def count_messages(self, messages: list[dict]) -> int:
        """计算消息列表的 token 数（含格式开销）"""
        total = 0
        for msg in messages:
            # 每条消息的格式开销约 4-6 token
            total += 5
            content = msg.get("content", "")
            if isinstance(content, str):
                total += self.count(content)
            elif isinstance(content, list):
                # 多模态消息
                for part in content:
                    if part.get("type") == "text":
                        total += self.count(part["text"])
                    elif part.get("type") == "image_url":
                        total += 85  # 图片 token 估算（低分辨率）
        return total
    
    def truncate_to_budget(self, text: str, budget: int) -> str:
        """截断文本到指定 token 预算"""
        encoder = self._fallback_encoder
        tokens = encoder.encode(text)
        if len(tokens) <= budget:
            return text
        truncated = encoder.decode(tokens[:budget - 3])  # 留 3 token 给省略号
        return truncated + "\n..."
```

---

## 5. 流式响应处理

### 5.1 SSE 流式输出架构

```
客户端 (Flutter)
     │
     │  POST /api/v1/conversations/{id}/messages
     │  Accept: text/event-stream
     │
     ▼
API 网关 (Kong/Nginx)
     │
     │  建立 SSE 连接，设置超时 120s
     │
     ▼
对话控制器 (ConversationController)
     │
     │  1. 创建 turn 记录（status=streaming）
     │  2. 异步调用 ChatEngine.stream()
     │  3. 逐 chunk 写入 SSE
     │
     ▼
ChatEngine
     │
     │  1. 构建上下文
     │  2. 内容安全审核（输入）
     │  3. 调用模型调度层（流式）
     │  4. 并行：内容安全审核（输出片段）
     │  5. 返回 token 流
     │
     ▼
模型调度层 → 大模型 API (SSE)
```

### 5.2 SSE 事件协议

```typescript
// SSE 事件类型定义
interface SSEEvents {
    // 流式内容块
    "content": {
        delta: string;          // 增量文本
        index: number;          // 块序号
    };
    
    // 思维链（推理模型）
    "reasoning": {
        delta: string;
        index: number;
    };
    
    // 元数据（流结束时发送）
    "metadata": {
        turn_id: number;
        model_id: string;
        input_tokens: number;
        output_tokens: number;
        latency_ms: number;
        rag_sources?: Array<{
            title: string;
            doc_id: string;
            relevance: number;
        }>;
    };
    
    // 相关操作建议
    "suggestions": {
        items: Array<{
            type: "similar_question" | "explain_differently" | "add_to_mistakes" | "continue";
            label: string;
            icon: string;
        }>;
    };
    
    // 错误
    "error": {
        code: string;
        message: string;
        retryable: boolean;
    };
    
    // 流结束
    "done": {};
}
```

### 5.3 服务端流式处理

```python
class ConversationController:
    """
    对话控制器 - 处理 SSE 流式响应
    """
    
    async def send_message(
        self,
        conversation_id: int,
        request: SendMessageRequest,
    ) -> AsyncGenerator[SSEEvent, None]:
        """
        处理用户消息并流式返回 AI 响应
        
        Args:
            conversation_id: 会话 ID
            request: {
                content: str           # 文本内容
                images?: list[str]     # 图片 URL（base64 或 OSS）
                audio_url?: str        # 语音 URL
                content_type: str      # text/image/audio/mixed
                parent_turn_id?: int   # 追问时指定的父轮次
            }
        """
        conversation = await self.conv_service.get_or_raise(conversation_id)
        
        # ── 1. 前置检查 ────────────────────────
        await self._pre_check(conversation, request)
        
        # ── 2. 创建 turn 记录 ──────────────────
        turn = await self.conv_service.create_turn(
            conversation=conversation,
            user_content=request.content,
            user_content_type=request.content_type,
            user_images=request.images,
            user_audio_url=request.audio_url,
        )
        
        # ── 3. 语音转文字（如需要）──────────────
        if request.content_type == "audio":
            asr_result = await self.asr_service.recognize(
                audio_url=request.audio_url,
                language=self._detect_language(conversation),
            )
            # 更新 turn 的文本内容
            await self.conv_service.update_turn_text(turn.id, asr_result.text)
            effective_text = asr_result.text
        else:
            effective_text = request.content
        
        # ── 4. 图片 OCR（如需要）────────────────
        ocr_texts = []
        if request.images:
            for img in request.images:
                ocr_result = await self.ocr_service.recognize(img)
                ocr_texts.append(ocr_result.text)
        
        # ── 5. 输入内容安全审核 ─────────────────
        moderation = await self.moderation_service.check_input(
            text=effective_text,
            images=request.images,
            scene=conversation.scene,
            grade_level=conversation.grade_level,
        )
        if moderation.blocked:
            await self.conv_service.update_turn_moderation(
                turn.id, "blocked"
            )
            yield SSEEvent(event="error", data={
                "code": "INPUT_BLOCKED",
                "message": moderation.reason,
                "retryable": False,
            })
            yield SSEEvent(event="done", data={})
            return
        
        await self.conv_service.update_turn_moderation(turn.id, "passed")
        
        # ── 6. 构建上下文 ─────────────────────
        budget = await self._get_budget(conversation.scene)
        current_msg = UserMessage(
            text_content=effective_text,
            images=request.images,
            ocr_texts=ocr_texts,
        )
        context = await self.context_builder.build(
            conversation=conversation,
            current_message=current_msg,
            budget=budget,
        )
        
        # 记录上下文快照（低频采样，每 10 轮记录一次）
        if turn.turn_index % 10 == 0:
            await self._save_context_snapshot(turn.id, context)
        
        # ── 7. 获取模型路由 ────────────────────
        model_route = await self.model_router.resolve(
            scene=conversation.scene,
            grade_level=conversation.grade_level,
            subject=conversation.subject,
            has_images=bool(request.images),
            context_token_count=sum(
                v for k, v in context.token_usage.items() 
                if isinstance(v, int)
            ),
        )
        
        # ── 8. 流式调用模型 ────────────────────
        full_response = []
        output_tokens = 0
        start_time = time.monotonic()
        first_token_time = None
        
        try:
            stream = await self.model_client.stream_chat(
                model_id=model_route.model_id,
                messages=context.messages,
                temperature=model_route.temperature,
                max_tokens=budget.total - context.token_usage.get("total", 0),
                stream=True,
            )
            
            async for chunk in stream:
                if chunk.delta:
                    if first_token_time is None:
                        first_token_time = time.monotonic()
                    
                    full_response.append(chunk.delta)
                    output_tokens += 1  # 近似，实际由模型返回
                    
                    # 并行输出审核（异步，不阻塞流式输出）
                    yield SSEEvent(event="content", data={
                        "delta": chunk.delta,
                        "index": chunk.index,
                    })
                
                if chunk.reasoning_delta:
                    yield SSEEvent(event="reasoning", data={
                        "delta": chunk.reasoning_delta,
                        "index": chunk.index,
                    })
        
        except ModelCallError as e:
            # 模型调用失败
            yield SSEEvent(event="error", data={
                "code": "MODEL_ERROR",
                "message": "AI 服务暂时不可用，请稍后重试",
                "retryable": True,
            })
            await self.conv_service.update_turn_status(
                turn.id, TurnStatus.FAILED
            )
            # 记录错误事件
            await self.error_tracker.track(e, context={
                "conversation_id": conversation_id,
                "turn_id": turn.id,
                "model_id": model_route.model_id,
            })
            yield SSEEvent(event="done", data={})
            return
        
        # ── 9. 后处理 ─────────────────────────
        response_text = "".join(full_response)
        total_latency = int((time.monotonic() - start_time) * 1000)
        first_token_latency = (
            int((first_token_time - start_time) * 1000) 
            if first_token_time else None
        )
        
        # 输出内容安全审核（异步，不阻塞用户）
        asyncio.create_task(
            self._async_output_moderation(
                turn.id, response_text, conversation
            )
        )
        
        # 更新 turn 记录
        await self.conv_service.complete_turn(
            turn_id=turn.id,
            assistant_content=response_text,
            model_id=model_route.model_id,
            prompt_template_id=context.prompt_template_id,
            rag_doc_ids=context.rag_doc_ids,
            input_tokens=context.total_tokens,
            output_tokens=output_tokens,
            latency_ms=first_token_latency,
            total_latency_ms=total_latency,
        )
        
        # 更新会话统计
        await self.conv_service.update_conversation_stats(
            conversation_id=conversation.id,
            tokens_in=context.total_tokens,
            tokens_out=output_tokens,
            model_used=model_route.model_id,
        )
        
        # ── 10. 发送元数据和建议 ────────────────
        yield SSEEvent(event="metadata", data={
            "turn_id": turn.id,
            "model_id": model_route.model_id,
            "input_tokens": context.total_tokens,
            "output_tokens": output_tokens,
            "latency_ms": first_token_latency,
            "rag_sources": context.rag_sources_summary,
        })
        
        suggestions = self._generate_suggestions(
            scene=conversation.scene,
            has_images=bool(request.images),
        )
        yield SSEEvent(event="suggestions", data={"items": suggestions})
        
        # ── 11. 发布领域事件 ───────────────────
        await self.event_bus.publish(TurnCompletedEvent(
            conversation_id=conversation.id,
            turn_id=turn.id,
            scene=conversation.scene,
            user_id=conversation.user_id,
            tokens_in=context.total_tokens,
            tokens_out=output_tokens,
            latency_ms=first_token_latency,
        ))
        
        yield SSEEvent(event="done", data={})
```

### 5.4 断线重连机制

```python
class StreamResumptionService:
    """
    流式响应断线重连服务
    
    机制：
    1. 流式输出过程中，每 5 个 chunk 将已输出内容写入 Redis
    2. 客户端断线后重连，携带 Last-Event-ID（即最后一个收到的 chunk index）
    3. 服务端从 Redis 读取已输出内容，从断点续传
    """
    
    CHUNK_BUFFER_INTERVAL = 5  # 每 5 个 chunk 缓冲一次
    
    async def buffer_chunk(
        self,
        conversation_id: int,
        turn_id: int,
        chunk_index: int,
        content: str,
    ) -> None:
        """缓冲流式输出内容"""
        key = f"conv:stream:{conversation_id}:{turn_id}"
        await self.redis.hset(
            key,
            mapping={
                "content": content,      # 累积的全部内容
                "status": "streaming",
                "last_chunk": chunk_index,
            },
        )
        await self.redis.expire(key, 300)  # 5 分钟 TTL
    
    async def resume_stream(
        self,
        conversation_id: int,
        turn_id: int,
        from_chunk_index: int,
    ) -> AsyncGenerator[SSEEvent, None]:
        """
        从断点续传流式响应
        
        两种情况：
        1. 模型调用仍在进行：直接继续订阅模型流
        2. 模型调用已完成：返回缓存的完整内容（从断点开始）
        """
        key = f"conv:stream:{conversation_id}:{turn_id}"
        cached = await self.redis.hgetall(key)
        
        if not cached:
            yield SSEEvent(event="error", data={
                "code": "STREAM_EXPIRED",
                "message": "响应缓存已过期，请重新发送消息",
                "retryable": True,
            })
            yield SSEEvent(event="done", data={})
            return
        
        status = cached["status"]
        full_content = cached["content"]
        
        if status == "completed":
            # 模型已完成，直接返回缓存内容
            # 从断点处截取
            remaining = self._extract_from_chunk(full_content, from_chunk_index)
            if remaining:
                yield SSEEvent(event="content", data={
                    "delta": remaining,
                    "index": from_chunk_index + 1,
                })
            yield SSEEvent(event="done", data={})
        
        elif status == "streaming":
            # 模型仍在进行，先返回已有缓存，再继续订阅
            buffered = self._extract_from_chunk(full_content, from_chunk_index)
            if buffered:
                yield SSEEvent(event="content", data={
                    "delta": buffered,
                    "index": from_chunk_index + 1,
                })
            
            # 尝试订阅正在进行的模型流
            # （通过进程内事件总线实现，超时 5s 无新 chunk 则结束）
            async for event in self._subscribe_active_stream(
                conversation_id, turn_id, timeout=5.0
            ):
                yield event
```

---

## 6. 长对话压缩与摘要

### 6.1 触发策略

```python
class ConversationSummaryService:
    """
    长对话自动压缩服务
    
    触发条件（任一满足）：
    1. 对话轮次 >= 场景阈值（如辅导场景 30 轮，拍题场景 10 轮）
    2. 历史 token 总量 >= 上下文窗口的 60%
    3. 用户主动触发（"总结一下我们讨论的内容"）
    """
    
    SCENE_THRESHOLDS = {
        "tutoring": 30,          # 辅导场景：30 轮
        "photo_question": 10,    # 拍题场景：10 轮
        "essay": 20,             # 作文辅导：20 轮
        "oral_english": 40,      # 口语陪练：40 轮
        "pronunciation": 30,     # 发音练习：30 轮
        "memorization": 20,      # 背诵辅助：20 轮
    }
    
    async def check_and_summarize(self, conversation: Conversation) -> bool:
        """检查并执行长对话压缩"""
        threshold = self.SCENE_THRESHOLDS.get(conversation.scene, 20)
        
        if conversation.turn_count < threshold:
            return False
        
        # 检查是否已有摘要覆盖了大部分历史
        if conversation.summary and conversation.summary_turn_id:
            turns_after_summary = await self.conv_repo.count_turns_after(
                conversation.id, conversation.summary_turn_id
            )
            if turns_after_summary < threshold:
                return False
        
        await self._do_summarize(conversation)
        return True
    
    async def _do_summarize(self, conversation: Conversation) -> None:
        """执行对话摘要压缩"""
        # 获取需要摘要的轮次（保留最近 5 轮不压缩）
        KEEP_RECENT = 5
        
        turns_to_summarize = await self.conv_repo.get_turns_range(
            conversation_id=conversation.id,
            after_id=conversation.summary_turn_id,
            exclude_last_n=KEEP_RECENT,
        )
        
        if not turns_to_summarize:
            return
        
        # 构建摘要请求
        summary_prompt = self._build_summary_prompt(
            turns=turns_to_summarize,
            scene=conversation.scene,
            subject=conversation.subject,
        )
        
        # 使用低成本模型生成摘要
        summary = await self.model_client.chat(
            model_id="summary-model",  # 路由到低成本模型
            messages=[{"role": "user", "content": summary_prompt}],
            temperature=0.3,
            max_tokens=500,
        )
        
        last_summarized_turn = turns_to_summarize[-1]
        
        # 更新会话
        await self.conv_repo.update_summary(
            conversation_id=conversation.id,
            summary=summary,
            summary_turn_id=last_summarized_turn.id,
            status=ConversationStatus.SUMMARIZED,
        )
        
        # 记录上下文事件
        await self.context_event_repo.create(
            conversation_id=conversation.id,
            event_type="summary_created",
            event_data={
                "summarized_turns": len(turns_to_summarize),
                "summary_token_estimate": self.token_counter.count(summary),
                "last_summarized_turn_id": last_summarized_turn.id,
            },
        )
        
        log.info(
            "对话摘要完成",
            extra={
                "conversation_id": conversation.id,
                "summarized_turns": len(turns_to_summarize),
            },
        )
    
    def _build_summary_prompt(
        self, turns: list[Turn], scene: str, subject: str | None
    ) -> str:
        """构建摘要请求的 Prompt"""
        conversation_text = []
        for turn in turns:
            conversation_text.append(f"学生: {turn.user_content}")
            conversation_text.append(f"AI老师: {turn.assistant_content[:200]}...")  # 截断长回复
        
        return f"""请将以下学习对话压缩为一段结构化摘要，保留以下关键信息：
1. 讨论的主要知识点和概念
2. 学生的薄弱点和错误类型
3. 已讲解的解题方法和技巧
4. 学生的掌握程度和进步
5. 未解决的问题或待续话题

学科: {subject or '综合'}
场景: {self.SCENE_NAMES.get(scene, scene)}

对话内容:
{chr(10).join(conversation_text)}

请输出 JSON 格式:
{{
    "main_topics": ["知识点1", "知识点2"],
    "weaknesses": ["薄弱点1", "薄弱点2"],
    "methods_taught": ["方法1", "方法2"],
    "mastery_level": "partial|good|needs_review",
    "unresolved": ["问题1"]
}}"""
```

---

## 7. 场景路由与行为差异化

### 7.1 场景配置表

```python
class SceneConfig:
    """场景配置"""
    
    # 场景标识
    scene: str
    
    # 上下文策略
    context_budget: ContextBudget
    max_history_turns: int          # 最大历史轮次
    enable_rag: bool                # 是否启用 RAG
    enable_streaming: bool          # 是否流式输出（默认 true）
    
    # 安全策略
    input_moderation_level: str     # strict/standard/relaxed
    output_moderation_level: str
    block_answer_reveal: bool       # 是否隐藏直接答案
    
    # 对话行为
    allow_multi_model: bool         # 是否允许中途切换模型
    auto_title: bool                # 是否自动生成对话标题
    suggestion_types: list[str]     # 支持的快捷操作类型
    
    # 摘要策略
    summary_threshold_turns: int
    summary_keep_recent: int
```

```json
{
    "tutoring": {
        "context_budget": {"total": 8192, "system_prompt_pct": 0.12, "rag_context_pct": 0.20, "history_pct": 0.48},
        "max_history_turns": 30,
        "enable_rag": true,
        "enable_streaming": true,
        "input_moderation_level": "standard",
        "output_moderation_level": "standard",
        "block_answer_reveal": false,
        "allow_multi_model": true,
        "auto_title": true,
        "suggestion_types": ["similar_question", "explain_differently", "add_to_mistakes", "continue"],
        "summary_threshold_turns": 30,
        "summary_keep_recent": 5
    },
    "photo_question": {
        "context_budget": {"total": 4096, "system_prompt_pct": 0.08, "rag_context_pct": 0.35, "history_pct": 0.22},
        "max_history_turns": 10,
        "enable_rag": true,
        "enable_streaming": true,
        "input_moderation_level": "standard",
        "output_moderation_level": "strict",
        "block_answer_reveal": true,
        "allow_multi_model": false,
        "auto_title": false,
        "suggestion_types": ["similar_question", "explain_differently", "add_to_mistakes"],
        "summary_threshold_turns": 10,
        "summary_keep_recent": 3
    },
    "essay": {
        "context_budget": {"total": 16384, "system_prompt_pct": 0.10, "rag_context_pct": 0.15, "history_pct": 0.40},
        "max_history_turns": 20,
        "enable_rag": true,
        "enable_streaming": true,
        "input_moderation_level": "standard",
        "output_moderation_level": "standard",
        "block_answer_reveal": false,
        "allow_multi_model": true,
        "auto_title": true,
        "suggestion_types": ["explain_differently", "continue"],
        "summary_threshold_turns": 20,
        "summary_keep_recent": 5
    },
    "oral_english": {
        "context_budget": {"total": 4096, "system_prompt_pct": 0.15, "rag_context_pct": 0.10, "history_pct": 0.55},
        "max_history_turns": 50,
        "enable_rag": false,
        "enable_streaming": true,
        "input_moderation_level": "relaxed",
        "output_moderation_level": "standard",
        "block_answer_reveal": false,
        "allow_multi_model": false,
        "auto_title": false,
        "suggestion_types": ["continue"],
        "summary_threshold_turns": 40,
        "summary_keep_recent": 10
    }
}
```

### 7.2 答案隐藏策略（拍题场景）

```python
class AnswerRevealStrategy:
    """
    答案隐藏策略
    
    拍题场景下默认不直接展示答案，而是分步引导。
    根据学生操作逐步揭示：
    """
    
    REVEAL_STAGES = [
        {
            "stage": "hint",
            "label": "解题思路",
            "content": "AI 生成的思路提示，不包含具体答案",
            "auto_show": True,
        },
        {
            "stage": "steps",
            "label": "解题步骤",
            "content": "分步解析，关键数值用占位符替代",
            "auto_show": False,
            "trigger": "user_click",
        },
        {
            "stage": "answer",
            "label": "最终答案",
            "content": "完整答案",
            "auto_show": False,
            "trigger": "user_click",
            "require_wait_seconds": 5,  # 点击后等待 5 秒才显示（反直觉冲动）
        },
    ]
    
    def apply(self, response: str, conversation: Conversation) -> AnswerRevealResult:
        """
        将 AI 完整响应拆分为多个展示阶段
        
        通过正则匹配拆分：
        - 思路部分（"思路"/"分析" 开头的段落）
        - 步骤部分（编号步骤段落）
        - 答案部分（"答案"/"结果" 开头的段落）
        """
        if conversation.scene != "photo_question":
            return AnswerRevealResult(stages=[
                {"stage": "full", "content": response, "auto_show": True}
            ])
        
        parsed = self._parse_response(response)
        return AnswerRevealResult(stages=[
            {
                "stage": "hint",
                "content": parsed.hint,
                "auto_show": True,
                "label": "解题思路",
            },
            {
                "stage": "steps",
                "content": parsed.steps,
                "auto_show": False,
                "label": "解题步骤",
                "trigger": "user_click",
            },
            {
                "stage": "answer",
                "content": parsed.answer,
                "auto_show": False,
                "label": "最终答案",
                "trigger": "user_click",
                "require_wait_seconds": 5,
            },
        ])
```

---

## 8. 对话标题自动生成

```python
class ConversationTitleService:
    """
    对话标题自动生成
    
    策略：
    1. 第 1 轮完成后触发（延迟异步）
    2. 使用低成本模型，限制 20 token 输出
    3. 标题格式：[学科] 核心知识点/问题摘要
    4. 后续轮次不更新标题（除非用户手动修改）
    """
    
    async def generate_title(self, conversation_id: int, first_turn: Turn) -> None:
        """异步生成对话标题"""
        try:
            prompt = f"""为以下学习对话生成一个简短标题（不超过15个字）。
只输出标题文本，不要加引号或其他符号。

学生问题：{first_turn.user_content[:200]}

标题："""
            
            title = await self.model_client.chat(
                model_id="title-model",  # 路由到最快最便宜的模型
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=20,
            )
            
            title = title.strip()[:64]  # 安全截断
            
            await self.conv_repo.update_title(conversation_id, title)
            
        except Exception as e:
            log.warning("标题生成失败，使用用户消息前缀", extra={"error": str(e)})
            fallback_title = first_turn.user_content[:30]
            if len(first_turn.user_content) > 30:
                fallback_title += "..."
            await self.conv_repo.update_title(conversation_id, fallback_title)
```

---

## 9. API 接口设计

### 9.1 接口清单

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/conversations` | 创建对话会话 |
| GET | `/api/v1/conversations` | 获取用户对话列表 |
| GET | `/api/v1/conversations/{id}` | 获取对话详情 |
| DELETE | `/api/v1/conversations/{id}` | 删除对话（软删除） |
| POST | `/api/v1/conversations/{id}/messages` | 发送消息（SSE 流式） |
| GET | `/api/v1/conversations/{id}/messages` | 获取对话历史消息 |
| POST | `/api/v1/conversations/{id}/messages/{turnId}/reveal` | 揭示下一阶段答案 |
| POST | `/api/v1/conversations/{id}/messages/{turnId}/feedback` | 提交用户反馈 |
| POST | `/api/v1/conversations/{id}/archive` | 归档对话 |
| PATCH | `/api/v1/conversations/{id}` | 更新对话（标题等） |
| GET | `/api/v1/conversations/{id}/resume` | 断线重连续传 |
| GET | `/api/v1/conversations/stats` | 用户对话统计 |

### 9.2 核心接口详细定义

#### 创建对话会话

```
POST /api/v1/conversations
Authorization: Bearer {token}
Content-Type: application/json

Request:
{
    "scene": "tutoring",              // 必填：场景标识
    "subject": "math",                // 可选：学科
    "initial_context": {              // 可选：初始上下文
        "textbook_id": 123,
        "chapter_id": 456,
        "related_question_id": 789    // 从拍题页跳转时携带
    }
}

Response 201:
{
    "id": 100001,
    "scene": "tutoring",
    "status": "active",
    "title": null,
    "grade_level": "junior_senior",
    "grade": "8",
    "subject": "math",
    "turn_count": 0,
    "created_at": "2026-05-20T10:30:00.000Z"
}
```

#### 发送消息（SSE 流式）

```
POST /api/v1/conversations/100001/messages
Authorization: Bearer {token}
Accept: text/event-stream
Content-Type: application/json

Request:
{
    "content": "二次函数的顶点怎么求？",
    "content_type": "text",
    "images": null,
    "audio_url": null,
    "parent_turn_id": null
}

Response 200 (SSE):
event: content
data: {"delta": "二次", "index": 0}

event: content
data: {"delta": "函数", "index": 1}

...（持续流式输出）

event: suggestions
data: {"items": [
    {"type": "similar_question", "label": "练一道同类题", "icon": "practice"},
    {"type": "explain_differently", "label": "换个讲法", "icon": "refresh"},
    {"type": "add_to_mistakes", "label": "加入错题本", "icon": "bookmark"},
    {"type": "continue", "label": "继续追问", "icon": "chat"}
]}

event: metadata
data: {
    "turn_id": 500001,
    "model_id": "zhipu/glm-4-plus",
    "input_tokens": 1250,
    "output_tokens": 380,
    "latency_ms": 1200,
    "rag_sources": [
        {"title": "二次函数-人教版九年级上", "doc_id": "kp_22_2_1", "relevance": 0.92}
    ]
}

event: done
data: {}
```

#### 断线重连

```
GET /api/v1/conversations/100001/resume?turnId=500001&lastChunkIndex=15
Authorization: Bearer {token}
Accept: text/event-stream

Response 200 (SSE):
event: content
data: {"delta": "（从断点续传的内容）", "index": 16}

...（继续流式输出直到完成）

event: metadata
data: {...}

event: done
data: {}
```

#### 提交反馈

```
POST /api/v1/conversations/100001/messages/500001/feedback
Authorization: Bearer {token}
Content-Type: application/json

Request:
{
    "rating": 4,                      // 1-5 评分
    "feedback": "讲解很清楚，但例子可以更贴近生活",
    "tags": ["too_complex"]           // 可选标签
}

Response 200:
{
    "ok": true
}
```

---

## 10. 客户端集成（Flutter）

### 10.1 对话 Repository

```dart
/// 对话数据仓库
class ConversationRepository {
  final ApiClient _api;
  final LocalCache _cache;
  
  /// 获取用户对话列表
  /// 
  /// 优先从本地缓存返回，同时异步刷新远程数据
  Future<List<Conversation>> getConversations({
    String? scene,
    int page = 1,
    int pageSize = 20,
  }) async {
    final cached = await _cache.getConversationList(scene: scene);
    if (cached != null && cached.isNotEmpty) {
      // 后台刷新
      _refreshConversations(scene: scene, page: page, pageSize: pageSize);
      return cached;
    }
    return _fetchConversations(scene: scene, page: page, pageSize: pageSize);
  }
  
  /// 发送消息并获取 SSE 流
  Stream<SSEEvent> sendMessage({
    required int conversationId,
    required String content,
    String contentType = 'text',
    List<String>? images,
    String? audioUrl,
  }) async* {
    final response = await _api.postSSE(
      '/api/v1/conversations/$conversationId/messages',
      body: {
        'content': content,
        'content_type': contentType,
        if (images != null) 'images': images,
        if (audioUrl != null) 'audio_url': audioUrl,
      },
    );
    
    await for (final event in response.stream) {
      yield _parseSSEEvent(event);
    }
  }
  
  /// 断线重连
  Stream<SSEEvent> resumeStream({
    required int conversationId,
    required int turnId,
    required int lastChunkIndex,
  }) async* {
    final response = await _api.getSSE(
      '/api/v1/conversations/$conversationId/resume',
      queryParameters: {
        'turnId': turnId,
        'lastChunkIndex': lastChunkIndex,
      },
    );
    
    await for (final event in response.stream) {
      yield _parseSSEEvent(event);
    }
  }
}
```

### 10.2 对话 UI 状态管理

```dart
/// 对话页面状态管理（Riverpod）
@riverpod
class ConversationChat extends _$ConversationChat {
  @override
  Future<ChatState> build(int conversationId) async {
    final conversation = await ref.read(
      conversationProvider(conversationId).future,
    );
    final messages = await ref.read(
      messageListProvider(conversationId).future,
    );
    return ChatState(
      conversation: conversation,
      messages: messages,
      streamingState: StreamingState.idle,
    );
  }
  
  /// 发送消息
  Future<void> sendMessage(String content, {
    String contentType = 'text',
    List<String>? images,
  }) async {
    final state = this.state.value!;
    if (state.streamingState == StreamingState.streaming) {
      return; // 防止重复发送
    }
    
    // 立即在 UI 中添加用户消息（乐观更新）
    final tempTurn = Turn(
      id: -DateTime.now().millisecondsSinceEpoch, // 临时 ID
      userContent: content,
      userContentType: contentType,
      userImages: images,
      createdAt: DateTime.now(),
    );
    
    state = state.copyWith(
      messages: [...state.messages, tempTurn],
      streamingState: StreamingState.streaming,
    );
    
    // 创建 AI 消息占位
    final aiTurn = Turn(
      id: -DateTime.now().millisecondsSinceEpoch - 1,
      assistantContent: '',
      assistantStatus: 'streaming',
      createdAt: DateTime.now(),
    );
    state = state.copyWith(
      messages: [...state.messages, aiTurn],
    );
    
    // 流式接收
    try {
      final repo = ref.read(conversationRepositoryProvider);
      await for (final event in repo.sendMessage(
        conversationId: conversationId,
        content: content,
        contentType: contentType,
        images: images,
      )) {
        switch (event.type) {
          case 'content':
            // 更新 AI 消息内容
            final lastIdx = state.messages.length - 1;
            final updated = state.messages[lastIdx].copyWith(
              assistantContent: state.messages[lastIdx].assistantContent + event.data['delta'],
            );
            state = state.copyWith(
              messages: [...state.messages.sublist(0, lastIdx), updated],
            );
            
          case 'metadata':
            // 更新 turn ID 和元数据
            final lastIdx = state.messages.length - 1;
            final updated = state.messages[lastIdx].copyWith(
              id: event.data['turn_id'],
              modelId: event.data['model_id'],
            );
            state = state.copyWith(
              messages: [...state.messages.sublist(0, lastIdx), updated],
            );
            
          case 'suggestions':
            state = state.copyWith(
              suggestions: (event.data['items'] as List)
                  .map((e) => SuggestionItem.fromJson(e))
                  .toList(),
            );
            
          case 'error':
            state = state.copyWith(
              streamingState: StreamingState.error,
              errorMessage: event.data['message'],
            );
            
          case 'done':
            state = state.copyWith(
              streamingState: StreamingState.idle,
            );
            // 异步刷新消息列表（获取准确的元数据）
            _refreshMessages();
        }
      }
    } catch (e) {
      state = state.copyWith(
        streamingState: StreamingState.error,
        errorMessage: '网络错误，请检查连接后重试',
      );
    }
  }
}

/// 对话 UI 状态
@freezed
class ChatState with _$ChatState {
  const factory ChatState({
    required Conversation conversation,
    required List<Turn> messages,
    required StreamingState streamingState,
    String? errorMessage,
    List<SuggestionItem>? suggestions,
  }) = _ChatState;
}

enum StreamingState { idle, streaming, error }
```

### 10.3 SSE 客户端实现

```dart
/// SSE 客户端封装
class SSEClient {
  final http.Client _httpClient;
  
  /// 发送 POST 请求并接收 SSE 流
  Stream<SSEEvent> postSSE(
    String url, {
    Map<String, dynamic>? body,
    Map<String, String>? headers,
  }) async* {
    final uri = Uri.parse(url);
    final request = http.Request('POST', uri);
    
    request.headers.addAll({
      'Accept': 'text/event-stream',
      'Content-Type': 'application/json',
      ...?headers,
    });
    
    if (body != null) {
      request.body = jsonEncode(body);
    }
    
    final response = await _httpClient.send(request);
    
    if (response.statusCode != 200) {
      final errorBody = await response.stream.bytesToString();
      throw ApiException(response.statusCode, errorBody);
    }
    
    // 解析 SSE 流
    String buffer = '';
    await for (final chunk in response.stream.transform(utf8.decoder)) {
      buffer += chunk;
      
      // 按双换行分割事件
      while (buffer.contains('\n\n')) {
        final eventEnd = buffer.indexOf('\n\n');
        final eventBlock = buffer.substring(0, eventEnd);
        buffer = buffer.substring(eventEnd + 2);
        
        final event = _parseEventBlock(eventBlock);
        if (event != null) {
          yield event;
          if (event.type == 'done') return;
        }
      }
    }
  }
  
  SSEEvent? _parseEventBlock(String block) {
    String? eventType;
    String? data;
    
    for (final line in block.split('\n')) {
      if (line.startsWith('event: ')) {
        eventType = line.substring(7).trim();
      } else if (line.startsWith('data: ')) {
        data = line.substring(6).trim();
      }
    }
    
    if (eventType == null || data == null) return null;
    
    return SSEEvent(
      type: eventType,
      data: jsonDecode(data),
    );
  }
}

class SSEEvent {
  final String type;
  final Map<String, dynamic> data;
  
  SSEEvent({required this.type, required this.data});
}
```

---

## 11. 错误处理与降级

### 11.1 错误码定义

| 错误码 | HTTP 状态码 | 说明 | 客户端处理 |
|--------|------------|------|-----------|
| `CONVERSATION_NOT_FOUND` | 404 | 对话不存在 | 返回对话列表 |
| `CONVERSATION_DELETED` | 410 | 对话已删除 | 返回对话列表 |
| `TOO_MANY_CONVERSATIONS` | 429 | 并发对话数超限 | 提示用户先结束其他对话 |
| `TURN_NOT_FOUND` | 404 | 轮次不存在 | 刷新对话 |
| `MODEL_ERROR` | 502 | 模型调用失败 | 自动重试 1 次，失败后提示稍后重试 |
| `MODEL_TIMEOUT` | 504 | 模型响应超时 | 自动重试 1 次 |
| `MODEL_RATE_LIMITED` | 429 | 模型限流 | 自动降级到备用模型 |
| `INPUT_BLOCKED` | 400 | 输入内容被拦截 | 展示拦截原因 |
| `OUTPUT_CENSORED` | 200 | 输出被审核拦截 | 展示安全提示，不展示原文 |
| `STREAM_EXPIRED` | 410 | 断线重连缓存过期 | 提示重新发送 |
| `MEMBERSHIP_LIMIT` | 403 | 会员额度不足 | 引导订阅 |
| `CONTEXT_TOO_LONG` | 413 | 上下文超限（极端情况） | 自动归档旧对话并创建新对话 |
| `NETWORK_ERROR` | 0 | 网络连接失败 | 离线缓存提示 |

### 11.2 模型降级链路

```python
class ModelFallbackChain:
    """
    模型降级链
    
    场景示例（理科解题）:
    zhipu/glm-4-plus → zhipu/glm-4 → zhipu/glm-4-flash → 本地缓存常见题解析
    """
    
    async def call_with_fallback(
        self,
        scene: str,
        messages: list[dict],
        **kwargs,
    ) -> AsyncGenerator[StreamChunk, None]:
        """
        带降级的流式调用
        
        策略：
        1. 主模型调用
        2. 超时（30s 无首 token）→ 切换备用模型
        3. 限流（429）→ 切换备用模型
        4. 全部模型失败 → 返回缓存结果或错误提示
        """
        chain = await self._get_fallback_chain(scene)
        
        last_error = None
        for model_id in chain:
            try:
                async for chunk in self.model_client.stream_chat(
                    model_id=model_id,
                    messages=messages,
                    **kwargs,
                ):
                    yield chunk
                return  # 成功则直接返回
                
            except ModelTimeoutError as e:
                last_error = e
                log.warning(
                    "模型超时，尝试降级",
                    extra={"model_id": model_id, "next": chain.index(model_id) + 1},
                )
                continue
                
            except ModelRateLimitError as e:
                last_error = e
                log.warning(
                    "模型限流，尝试降级",
                    extra={"model_id": model_id},
                )
                continue
                
            except ModelCallError as e:
                last_error = e
                log.error(
                    "模型调用失败",
                    extra={"model_id": model_id, "error": str(e)},
                )
                continue
        
        # 所有模型都失败
        yield StreamChunk(
            delta="抱歉，AI 服务暂时繁忙，请稍后再试。您也可以先浏览错题本或学习计划。",
            is_fallback=True,
        )
        yield StreamChunk(done=True)
```

### 11.3 客户端错误处理

```dart
/// 对话错误处理 Widget
class ChatErrorHandler {
  static void handle(BuildContext context, String errorCode, String? message) {
    switch (errorCode) {
      case 'MODEL_ERROR':
      case 'MODEL_TIMEOUT':
        _showRetryBanner(context, message ?? 'AI 服务暂时不可用');
        break;
        
      case 'MODEL_RATE_LIMITED':
        _showInfoBanner(context, '当前使用人数较多，请稍后再试');
        break;
        
      case 'INPUT_BLOCKED':
        _showWarningDialog(context, message ?? '请输入与学习相关的问题');
        break;
        
      case 'MEMBERSHIP_LIMIT':
        _showMembershipDialog(context);
        break;
        
      case 'STREAM_EXPIRED':
        _showRetryBanner(context, '响应已过期，请重新发送');
        break;
        
      case 'NETWORK_ERROR':
        _showOfflineBanner(context);
        break;
        
      default:
        _showRetryBanner(context, message ?? '发生未知错误');
    }
  }
}
```

---

## 12. 监控指标与告警

### 12.1 关键指标

| 指标名 | 类型 | 说明 | 告警阈值 |
|--------|------|------|---------|
| `conv.turn.latency_p50` | Histogram | 首 token 延迟 P50 | > 3000ms |
| `conv.turn.latency_p99` | Histogram | 首 token 延迟 P99 | > 8000ms |
| `conv.turn.total_latency_p50` | Histogram | 总响应延迟 P50 | > 10000ms |
| `conv.turn.error_rate` | Gauge | 对话轮次错误率 | > 5% |
| `conv.turn.model_fallback_rate` | Gauge | 模型降级率 | > 10% |
| `conv.context.truncation_rate` | Gauge | 历史截断率 | > 30% |
| `conv.summary.trigger_rate` | Counter | 长对话压缩触发频率 | - |
| `conv.stream.disconnect_rate` | Gauge | SSE 断线率 | > 3% |
| `conv.stream.resume_success_rate` | Gauge | 断线重连成功率 | < 95% |
| `conv.active.count` | Gauge | 当前活跃对话数 | - |
| `conv.turn.tokens_in` | Counter | 输入 token 总量 | - |
| `conv.turn.tokens_out` | Counter | 输出 token 总量 | - |
| `conv.moderation.block_rate` | Gauge | 内容拦截率 | > 1%（可能误伤） |
| `conv.user.feedback_avg` | Gauge | 用户平均评分 | < 3.5 |

### 12.2 告警规则

```yaml
# Prometheus alerting rules
groups:
  - name: conversation_engine
    rules:
      - alert: HighTurnErrorRate
        expr: rate(conv_turn_error_rate[5m]) > 0.05
        for: 3m
        labels:
          severity: critical
        annotations:
          summary: "对话轮次错误率过高"
          description: "过去 5 分钟错误率 {{ $value | humanizePercentage }}"
      
      - alert: HighModelFallbackRate
        expr: rate(conv_turn_model_fallback_rate[10m]) > 0.10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "模型降级率过高"
          description: "过去 10 分钟降级率 {{ $value | humanizePercentage }}"
      
      - alert: SlowFirstToken
        expr: histogram_quantile(0.95, conv_turn_latency_bucket) > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "首 token 延迟过高（P95）"
          description: "P95 延迟 {{ $value }}s"
      
      - alert: HighStreamDisconnectRate
        expr: rate(conv_stream_disconnect_rate[5m]) > 0.03
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "SSE 断线率过高"
```

---

## 13. 性能优化

### 13.1 上下文缓存策略

```python
class ContextCacheStrategy:
    """
    上下文缓存策略
    
    三级缓存：
    L1: Redis（2h TTL）- 完整上下文消息列表
    L2: 应用内存 LRU（1000 会话）- 仅 token 计数
    L3: 数据库 - 完整历史
    """
    
    async def get_context(self, conversation_id: int) -> CachedContext | None:
        """从缓存获取上下文"""
        # L1: Redis
        cached = await self.redis.get(f"conv:context:{conversation_id}")
        if cached:
            return CachedContext.model_validate_json(cached)
        
        return None
    
    async def put_context(self, conversation_id: int, context: CachedContext) -> None:
        """写入上下文缓存"""
        await self.redis.setex(
            f"conv:context:{conversation_id}",
            7200,  # 2 小时
            context.model_dump_json(),
        )
    
    async def invalidate_context(self, conversation_id: int) -> None:
        """使上下文缓存失效（新消息后调用）"""
        await self.redis.delete(f"conv:context:{conversation_id}")
```

### 13.2 批量操作优化

```python
class ConversationListOptimizer:
    """
    对话列表查询优化
    
    策略：
    1. 列表页只返回摘要信息（不含完整消息）
    2. 使用覆盖索引避免回表
    3. 热点用户数据走 Redis 缓存
    """
    
    LIST_QUERY = """
        SELECT 
            c.id, c.scene, c.title, c.status,
            c.subject, c.turn_count, c.last_message_at,
            -- 最新一条用户消息的前 50 字
            LEFT(ct.user_content, 50) AS last_user_preview,
            ct.user_content_type AS last_content_type
        FROM conversations c
        LEFT JOIN conversation_turns ct ON ct.id = (
            SELECT id FROM conversation_turns 
            WHERE conversation_id = c.id 
            ORDER BY created_at DESC LIMIT 1
        )
        WHERE c.user_id = %s AND c.deleted_at IS NULL AND c.status = 'active'
        ORDER BY c.last_message_at DESC
        LIMIT %s OFFSET %s
    """
    # 使用覆盖索引: idx_user_status(user_id, status, last_message_at DESC)
```

---

## 14. 数据归档与清理

```python
class ConversationDataLifecycle:
    """
    对话数据生命周期管理
    
    热数据（MySQL）  →  温数据（MySQL 归档表）  →  冷数据（对象存储/归档库）
    
    时间线：
    - 0-30 天：热数据，正常查询
    - 30-180 天：温数据，迁移到归档表（conversation_turns_archive）
    - 180 天+：冷数据，打包为 JSON 存入对象存储，从数据库删除
    """
    
    async def archive_old_turns(self) -> int:
        """将 30 天前的 turns 迁移到归档表"""
        cutoff = datetime.utcnow() - timedelta(days=30)
        
        # 批量迁移（每次 1000 条）
        migrated = 0
        while True:
            batch = await self.turn_repo.fetch_old_turns(cutoff, limit=1000)
            if not batch:
                break
            
            await self.turn_archive_repo.bulk_insert(batch)
            turn_ids = [t.id for t in batch]
            await self.turn_repo.bulk_delete(turn_ids)
            migrated += len(batch)
        
        return migrated
    
    async def cold_storage_pack(self) -> int:
        """将 180 天前的归档数据打包到对象存储"""
        cutoff = datetime.utcnow() - timedelta(days=180)
        
        conversations = await self.conv_repo.find_older_than(cutoff)
        
        for conv in conversations:
            # 获取所有归档 turns
            turns = await self.turn_archive_repo.get_by_conversation(conv.id)
            
            # 打包为 JSON
            pack = {
                "conversation": conv.to_dict(),
                "turns": [t.to_dict() for t in turns],
                "archived_at": datetime.utcnow().isoformat(),
            }
            
            # 上传到对象存储
            key = f"conversation-archive/{conv.user_id}/{conv.id}.json.gz"
            await self.storage.upload_json_gz(key, pack)
            
            # 删除数据库记录
            await self.turn_archive_repo.delete_by_conversation(conv.id)
            await self.conv_repo.hard_delete(conv.id)
        
        return len(conversations)
```

---

## 15. 领域事件定义

```python
class ConversationCreatedEvent(DomainEvent):
    """对话创建事件"""
    event_type = "conversation.created"
    conversation_id: int
    user_id: int
    scene: str

class TurnCompletedEvent(DomainEvent):
    """对话轮次完成事件"""
    event_type = "conversation.turn_completed"
    conversation_id: int
    turn_id: int
    scene: str
    user_id: int
    tokens_in: int
    tokens_out: int
    latency_ms: int | None

class ConversationArchivedEvent(DomainEvent):
    """对话归档事件"""
    event_type = "conversation.archived"
    conversation_id: int
    user_id: int
    scene: str
    total_turns: int

class ConversationSummarizedEvent(DomainEvent):
    """对话摘要事件"""
    event_type = "conversation.summarized"
    conversation_id: int
    summarized_turns: int
    summary_token_estimate: int

class TurnFeedbackEvent(DomainEvent):
    """对话反馈事件"""
    event_type = "conversation.turn_feedback"
    conversation_id: int
    turn_id: int
    rating: int
    tags: list[str] | None
```

### 事件订阅关系

| 事件 | 订阅者 | 处理逻辑 |
|------|--------|---------|
| `conversation.turn_completed` | 学习记录服务 | 记录学习行为、更新学习时长 |
| `conversation.turn_completed` | 数据埋点服务 | 发送学习事件到埋点系统 |
| `conversation.turn_completed` | AI 质量评估服务 | 异步质量评分 |
| `conversation.turn_completed` | 成本治理服务 | 记录 token 用量、更新成本统计 |
| `conversation.turn_feedback` | AI 质量评估服务 | 记录用户反馈 |
| `conversation.turn_feedback` | Prompt 优化服务 | 低评分自动回流训练数据 |
| `conversation.summarized` | 数据分析服务 | 更新对话统计指标 |
| `conversation.archived` | 学习记录服务 | 标记对话已归档 |

---

## 16. 部署与配置

### 16.1 环境配置

```yaml
# config/conversation_engine.yaml
conversation_engine:
  # 会话管理
  max_active_per_scene: 5          # 每用户每场景最大活跃对话数
  auto_pause_minutes: 30           # 自动暂停超时（分钟）
  auto_archive_days: 7             # 自动归档超时（天）
  hard_delete_days: 180            # 硬删除周期（天）
  
  # 上下文构建
  default_context_window: 8192     # 默认上下文窗口
  safety_margin_pct: 0.05          # 安全余量比例
  context_cache_ttl_seconds: 7200  # 上下文缓存 TTL
  
  # 流式输出
  sse_timeout_seconds: 120         # SSE 连接超时
  stream_buffer_interval: 5        # 断线重连缓冲间隔（chunk 数）
  stream_cache_ttl_seconds: 300    # 断线重连缓存 TTL
  
  # 长对话压缩
  summary_threshold_default: 20    # 默认摘要触发轮次
  summary_model: "zhipu/glm-4-flash"  # 摘要用模型
  summary_keep_recent: 5           # 压缩时保留最近 N 轮
  
  # 标题生成
  title_model: "zhipu/glm-4-flash"
  title_max_chars: 64
  
  # 监控
  context_snapshot_interval: 10    # 每 N 轮记录一次上下文快照
```

### 16.2 依赖服务

| 服务 | 用途 | 故障影响 |
|------|------|---------|
| MySQL | 会话和轮次持久化 | 无法发消息（致命） |
| Redis | 缓存、并发控制、流缓冲 | 性能下降，功能降级 |
| 大模型 API | AI 响应生成 | 无法获取 AI 回复（致命） |
| RAG 服务 | 知识库检索增强 | 回复质量下降（可降级） |
| 内容安全审核 | 输入/输出安全过滤 | 安全风险（可降级为仅日志） |
| ASR 服务 | 语音消息转文字 | 语音功能不可用 |
| OCR 服务 | 图片题目识别 | 图片功能不可用 |
| 对象存储 | 图片/语音文件存储 | 无法发送多媒体消息 |
