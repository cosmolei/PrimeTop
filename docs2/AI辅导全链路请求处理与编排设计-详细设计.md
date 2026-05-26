# AI辅导全链路请求处理与编排设计 - 详细设计

> **版本**: v1.0 | **日期**: 2026-05-24 | **状态**: 初稿
> **关联文档**: AI对话引擎与会话管理、学习场景意图识别与智能路由引擎、AI-Prompt编排与场景模板系统、RAG与知识库系统、多模型调度与成本治理、AI回答后处理与智能优化管线、答案管控与渐进式提示引擎、SSE流式响应与AI增量渲染引擎

---

## 1. 文档定位与目标

### 1.1 为什么需要这份文档

PrimeTop 的 AI 辅导功能涉及 **10+ 个子系统** 的协同工作。各子系统的详细设计文档已分别编写，但缺少一份 **端到端的全链路编排文档**，回答以下关键问题：

1. 用户发送一条消息后，请求经过哪些服务？调用顺序是什么？
2. 各步骤之间的数据如何传递？上下游依赖是什么？
3. 整个链路的超时预算如何分配？某一步超时/失败时如何降级？
4. 流式（SSE）场景下，各步骤如何协作实现"边生成边处理边推送"？
5. 链路中如何插入新步骤（如灰度新特性）而不影响已有逻辑？

### 1.2 适用读者

- **服务端开发工程师**：理解 AI 辅导请求的完整处理链路，实现编排逻辑
- **客户端开发工程师**：理解请求协议、SSE 流协议和渲染时序
- **AI 工程师**：理解模型调用在整体链路中的位置和约束
- **测试工程师**：设计端到端集成测试用例

### 1.3 核心链路一览

```
客户端发送消息
    │
    ▼
[1] API 网关层 ─ 鉴权 / 限流 / 设备校验 / 请求预处理
    │
    ▼
[2] 请求入口 Controller ─ 参数校验 / 场景路由 / 额度校验
    │
    ▼
[3] 上下文构建 ─ 学生画像加载 / 对话历史加载 / 会话状态恢复
    │
    ▼
[4] 意图识别引擎 ─ 学习意图分类 / 学科识别 / 附件解析
    │
    ▼
[5] 教学策略决策 ─ 选择教学策略 / 计算引导深度 / 设定答案管控层级
    │
    ▼
[6] RAG 检索 ─ 知识库向量检索 / 教材内容匹配 / 考点关联
    │
    ▼
[7] Prompt 编排 ─ 模板选择 / 变量注入 / RAG结果注入 / 策略标签注入
    │
    ▼
[8] 模型调用 ─ 模型路由 / 调用分发 / 流式响应接收
    │
    ▼
[9] 后处理管线 ─ 安全过滤 / 格式规范 / 适龄化 / 知识点标注
    │
    ▼
[10] SSE 流式推送 ─ 增量渲染指令 / 答案管控层级检查
    │
    ▼
[11] 异步后置任务 ─ 学习记录 / 知识点标注完成 / 缓存写入 / 质量评估
    │
    ▼
客户端渲染完成
```

---

## 2. 链路阶段详细设计

### 2.1 API 网关层

**负责人**: API 网关（Kong/APISIX）
**超时预算**: 整体链路 120s，网关层自身处理 ≤ 50ms

#### 2.1.1 网关处理步骤

```python
# 网关层拦截器链（Lua/Plugin 配置示意）
# 顺序: 鉴权 → 限流 → 设备校验 → 请求预处理

# 1. JWT 鉴权
#    - 从 Header 提取 Bearer Token
#    - 校验签名、过期时间
#    - 提取 user_id, device_id 注入 Header: X-User-Id, X-Device-Id
#    - 无效 Token 返回 401

# 2. 全局限流
#    - 按 user_id 维度限流: 每秒最大 5 个 AI 请求
#    - 按功能维度限流: 额度管控系统校验剩余配额
#    - 超限返回 429, Header: Retry-After: 5

# 3. 设备校验
#    - 验证 device_id 合法性
#    - 校验 APP 版本是否低于最低支持版本
#    - 低版本返回 426, Body: { "upgrade_url": "..." }

# 4. 请求预处理
#    - 注入 trace_id (X-Trace-Id) 用于全链路追踪
#    - 记录请求开始时间 (X-Request-Start-Ts)
#    - 设置 upstream 超时: 120s (AI 流式场景)
```

#### 2.1.2 请求协议

客户端发送 AI 辅导请求的协议定义：

```typescript
// 客户端 → 服务端请求
// POST /api/v1/ai/chat/send
// Content-Type: application/json
// Authorization: Bearer <jwt_token>

interface AIChatRequest {
  /** 会话ID，首次为空由服务端创建 */
  conversation_id?: string;

  /** 用户消息内容 */
  message: string;

  /** 输入类型 */
  input_type: 'text' | 'voice' | 'image';

  /** 附件列表（图片、语音等） */
  attachments?: Array<{
    type: 'image' | 'voice';
    file_id: string;       // 已上传的文件ID
    mime_type: string;
    size_bytes: number;
    metadata?: {
      duration_ms?: number;    // 语音时长
      width?: number;          // 图片宽
      height?: number;         // 图片高
    };
  }>;

  /** 客户端上下文 */
  client_context: {
    current_page: string;        // 当前所在页面
    source_entry: string;        // 入口来源: home_shortcut/ai_tab/photo_qa/exercise
    subject_hint?: string;       // 用户当前选择的学科
    chapter_id?: string;         // 当前所在章节
    question_id?: string;        // 关联题目ID（从拍题跳转时）
    knowledge_point_id?: string; // 关联知识点ID
  };

  /** 客户端支持的SSE事件类型 */
  supported_events: string[];   // 默认 ['text','formula','card','status']
}
```

```typescript
// 服务端 SSE 响应流
// Content-Type: text/event-stream
// 每行格式: event: <type>\ndata: <json>\n\n

// SSE 事件类型定义
type SSEEvent =
  | ConversationCreatedEvent     // 会话创建（首次）
  | TextDeltaEvent               // 文本增量
  | FormulaBlockEvent            // 公式块
  | KnowledgeCardEvent           // 知识点卡片
  | HintTierEvent                // 答案管控层级提示
  | StatusEvent                  // 状态事件（思考中/检索中/...）
  | ErrorEvent                   // 错误事件
  | CompleteEvent                // 完成事件
  | PostProcessEvent             // 后处理异步结果（知识点标注等）

interface ConversationCreatedEvent {
  conversation_id: string;
  message_id: string;
}

interface TextDeltaEvent {
  delta: string;               // 增量文本
  is_markdown_start?: boolean;  // 是否开始新的 markdown 块
}

interface FormulaBlockEvent {
  latex: string;               // LaTeX 公式
  display_mode: boolean;       // 行间/行内
  label?: string;              // 公式标签
}

interface KnowledgeCardEvent {
  kp_id: string;
  name: string;
  chapter_path: string;        // "七年级上 > 第一章 > 1.1"
  mastery_level?: number;      // 学生当前掌握度
  action_url?: string;         // 深链接到知识点详情页
}

interface HintTierEvent {
  tier: number;                // 当前提示层级 0-4
  max_tier: number;            // 最大层级
  tier_label: string;          // "思路提示" / "关键步骤" / "完整解析"
  unlock_action?: string;      // "点击查看下一步提示"
}

interface StatusEvent {
  status: 'thinking' | 'retrieving' | 'generating' | 'post_processing';
  message?: string;            // 可选的状态描述
  progress?: number;           // 0-100, 可选进度
}

interface ErrorEvent {
  error_code: string;
  message: string;             // 用户友好的错误描述
  retryable: boolean;
  retry_after_ms?: number;
}

interface CompleteEvent {
  message_id: string;
  total_tokens: number;         // 总 token 消耗
  finish_reason: 'stop' | 'length' | 'content_filter';
  metadata: {
    model_used: string;
    latency_ms: number;         // 端到端延迟
    tokens_prompt: number;
    tokens_completion: number;
    rag_documents_count: number; // RAG 检索文档数
    strategy_used: string;      // 使用的教学策略
    guidance_level: number;     // 引导深度
    quality_score?: number;     // 质量评分
  };
}

interface PostProcessEvent {
  message_id: string;
  knowledge_points: Array<{    // 知识点标注结果
    kp_id: string;
    name: string;
    relevance_score: number;
  }>;
  safety_flags: string[];       // 安全标记
  quality_detail?: {            // 质量评估详情
    accuracy: number;
    completeness: number;
    age_appropriateness: number;
  };
}
```

---

### 2.2 请求入口 Controller

**负责人**: AI Chat Service
**超时预算**: ≤ 100ms（不含下游调用时间）

#### 2.2.1 处理流程

```python
# server/services/ai/chat/controller.py

class AIChatController:
    """AI 辅导聊天请求入口"""

    def __init__(
        self,
        quota_service: QuotaService,            # 额度管控
        context_builder: ContextBuilder,         # 上下文构建
        orchestrator: AIChatOrchestrator,        # 链路编排器
        session_manager: SessionManager,         # 会话管理
    ):
        self._quota = quota_service
        self._ctx_builder = context_builder
        self._orchestrator = orchestrator
        self._session = session_manager

    async def handle_send(
        self,
        request: AIChatRequest,
        user_id: int,
        device_id: str,
        trace_id: str,
    ) -> AsyncIterator[SSEEvent]:
        """
        处理 AI 聊天请求，返回 SSE 事件流。
        
        异常通过 SSE ErrorEvent 返回，不抛 HTTP 异常。
        """

        # ── Step 1: 参数校验 ──────────────────────────
        validation_error = self._validate_request(request)
        if validation_error:
            yield ErrorEvent(
                error_code="INVALID_REQUEST",
                message=validation_error,
                retryable=False,
            )
            return

        # ── Step 2: 额度校验 ──────────────────────────
        quota_check = await self._quota.check_and_reserve(
            user_id=user_id,
            feature=FeatureType.AI_STREAM,
            conversation_id=request.conversation_id,
        )
        if not quota_check.allowed:
            yield ErrorEvent(
                error_code="QUOTA_EXCEEDED",
                message=quota_check denial_message,
                retryable=False,
            )
            return

        # 额度预留成功，后续无论成功失败都需要释放或确认消耗
        try:
            # ── Step 3: 会话获取或创建 ──────────────
            conversation = await self._session.get_or_create(
                conversation_id=request.conversation_id,
                user_id=user_id,
                client_context=request.client_context,
            )

            # SSE: 发送会话创建事件（新会话时）
            if conversation.is_new:
                yield ConversationCreatedEvent(
                    conversation_id=conversation.id,
                    message_id=conversation.current_message_id,
                )

            # ── Step 4: 发送初始状态 ──────────────────
            yield StatusEvent(status="thinking", message="正在理解你的问题...")

            # ── Step 5: 委托编排器处理核心链路 ──────
            async for event in self._orchestrator.process(
                conversation=conversation,
                request=request,
                user_id=user_id,
                trace_id=trace_id,
            ):
                yield event

        except QuotaExceededError as e:
            yield ErrorEvent(
                error_code="QUOTA_EXCEEDED",
                message="今日AI问答次数已达上限",
                retryable=False,
            )
        except ContentSafetyBlockError as e:
            yield ErrorEvent(
                error_code="CONTENT_BLOCKED",
                message="问题包含不当内容，请重新描述",
                retryable=False,
            )
        except ModelAllDownError as e:
            yield ErrorEvent(
                error_code="SERVICE_UNAVAILABLE",
                message="AI助手暂时无法回答，请稍后再试",
                retryable=True,
                retry_after_ms=5000,
            )
        except Exception as e:
            logger.exception(f"Unexpected error in AI chat: trace_id={trace_id}")
            yield ErrorEvent(
                error_code="INTERNAL_ERROR",
                message="出了点问题，请重试",
                retryable=True,
                retry_after_ms=3000,
            )
        finally:
            # ── Step 6: 额度确认/释放 ──────────────
            await self._quota.confirm_or_release(
                reservation_id=quota_check.reservation_id,
                consumed=True,  # 实际消耗（即使出错也算一次调用）
            )

    def _validate_request(self, req: AIChatRequest) -> Optional[str]:
        """参数校验，返回错误描述或 None"""
        if not req.message or not req.message.strip():
            return "消息内容不能为空"
        if len(req.message) > 5000:
            return "消息内容不能超过5000字"
        if req.attachments and len(req.attachments) > 5:
            return "最多同时上传5个附件"
        return None
```

---

### 2.3 上下文构建

**负责人**: ContextBuilder
**超时预算**: ≤ 200ms
**并行策略**: 学生画像、对话历史、会话状态三路并行加载

#### 2.3.1 上下文数据结构

```python
@dataclass
class ChatContext:
    """AI 辅导全链路上下文，贯穿整个请求处理过程"""
    
    # ── 基础信息 ──
    trace_id: str
    request_id: str
    user_id: int
    conversation_id: str
    message_id: str
    timestamp: datetime
    
    # ── 学生画像（来自学习状态建模引擎） ──
    student: StudentSnapshot
    
    # ── 对话历史（来自上下文管理引擎） ──
    conversation_history: list[ConversationMessage]
    conversation_summary: Optional[str]     # 长对话压缩摘要
    
    # ── 会话状态 ──
    session_state: SessionState
    
    # ── 意图识别结果 ──
    intent: Optional[IntentResult] = None
    
    # ── 教学策略 ──
    strategy_decision: Optional[StrategyDecision] = None
    
    # ── RAG 检索结果 ──
    rag_documents: list[RAGDocument] = field(default_factory=list)
    
    # ── 编排后的 Prompt ──
    final_prompt: Optional[PromptAssembly] = None
    
    # ── 模型调用结果 ──
    model_response: Optional[ModelResponse] = None
    
    # ── 后处理结果 ──
    post_process_result: Optional[PostProcessResult] = None
    
    # ── 链路追踪信息 ──
    stage_timings: dict[str, float] = field(default_factory=dict)  # 各阶段耗时
    stage_errors: dict[str, str] = field(default_factory=dict)     # 各阶段错误


@dataclass
class StudentSnapshot:
    """学生画像快照（请求级缓存，避免多次查询）"""
    user_id: int
    grade_level: GradeLevel
    stage: str                              # preschool/primary/junior/senior
    grade: int                              # 0-12
    semester: str
    textbook_edition: str
    subjects: list[str]                     # 关注的学科列表
    cognitive_level: CognitiveLevel
    subject_proficiencies: dict[str, float]  # 学科→熟练度
    learning_style: LearningStyle
    membership_tier: str                    # free/monthly/yearly
    is_new_user: bool
    
    # 近期学习指标
    recent_accuracy: float                  # 近7天整体正确率
    recent_active_minutes: float            # 近7天日均学习时长
    consecutive_study_days: int             # 连续学习天数


@dataclass
class SessionState:
    """会话级状态"""
    current_subject: Optional[str]          # 当前讨论的学科
    current_topic_id: Optional[str]         # 当前讨论的知识点
    current_guidance_level: int = 2         # 当前引导深度
    strategies_attempted: list[str] = field(default_factory=list)
    interaction_count: int = 0              # 本会话交互轮次
    frustration_score: float = 0.0          # 挫败感评估
    engagement_score: float = 0.7           # 参与度
    last_answer_tier: int = 0               # 上次答案展示层级
```

#### 2.3.2 并行加载实现

```python
class ContextBuilder:
    """上下文构建器：并行加载所有必需数据"""
    
    def __init__(
        self,
        student_repo: StudentProfileRepository,
        conversation_repo: ConversationRepository,
        session_cache: SessionCache,           # Redis 缓存
        state_engine: StudentStateEngine,      # 学习状态建模引擎
    ):
        self._student_repo = student_repo
        self._conversation_repo = conversation_repo
        self._session_cache = session_cache
        self._state_engine = state_engine

    async def build(
        self,
        user_id: int,
        conversation_id: str,
        request: AIChatRequest,
    ) -> ChatContext:
        """
        并行构建上下文。总耗时取决于最慢的一路。
        """
        ctx = ChatContext(
            trace_id=request.trace_id,
            request_id=uuid4().hex,
            user_id=user_id,
            conversation_id=conversation_id,
            message_id=uuid4().hex,
            timestamp=datetime.utcnow(),
        )

        # 三路并行加载
        (
            student_snapshot,
            history,
            session_state,
        ) = await asyncio.gather(
            self._load_student_snapshot(user_id),
            self._load_conversation_history(conversation_id),
            self._load_session_state(conversation_id),
        )

        ctx.student = student_snapshot
        ctx.conversation_history = history.messages
        ctx.conversation_summary = history.summary
        ctx.session_state = session_state

        return ctx

    async def _load_student_snapshot(self, user_id: int) -> StudentSnapshot:
        """加载学生画像快照"""
        # 优先从 Redis 缓存读取（TTL 10min）
        cached = await self._session_cache.get_student_snapshot(user_id)
        if cached:
            return cached

        # 缓存未命中，从 DB + 状态引擎计算
        profile = await self._student_repo.get_by_user_id(user_id)
        state = await self._state_engine.get_current_state(user_id)

        snapshot = StudentSnapshot(
            user_id=user_id,
            grade_level=_grade_to_level(profile.grade),
            stage=profile.stage,
            grade=profile.grade,
            semester=profile.semester,
            textbook_edition=profile.textbook_edition,
            subjects=profile.subjects,
            cognitive_level=state.cognitive_level,
            subject_proficiencies=state.subject_proficiencies,
            learning_style=state.learning_style,
            membership_tier=profile.membership_tier,
            is_new_user=profile.total_sessions < 5,
            recent_accuracy=state.recent_accuracy,
            recent_active_minutes=state.recent_active_minutes,
            consecutive_study_days=state.consecutive_study_days,
        )

        # 写入缓存
        await self._session_cache.set_student_snapshot(
            user_id, snapshot, ttl=600
        )
        return snapshot

    async def _load_conversation_history(
        self, conversation_id: str
    ) -> ConversationHistory:
        """加载对话历史"""
        if not conversation_id:
            return ConversationHistory(messages=[], summary=None)
        return await self._conversation_repo.get_history(
            conversation_id=conversation_id,
            max_messages=20,       # 最近 20 轮
            include_summary=True,  # 长对话时附带压缩摘要
        )

    async def _load_session_state(self, conversation_id: str) -> SessionState:
        """从 Redis 加载会话级状态"""
        if not conversation_id:
            return SessionState()
        state = await self._session_cache.get_session_state(conversation_id)
        return state or SessionState()
```

---

### 2.4 意图识别引擎

**负责人**: 学习场景意图识别与智能路由引擎
**超时预算**: ≤ 500ms
**失败策略**: 降级为 `general_qa` 通用问答意图

#### 2.4.1 意图识别在链路中的位置

意图识别是链路的 **第一个决策分支点**，其结果决定后续的 Prompt 编排模板和 RAG 检索策略。

```python
# 意图类型到后续编排路径的映射
INTENT_ROUTING: dict[LearningIntent, RoutingConfig] = {
    # ── 解题类 ──
    LearningIntent.PHOTO_SOLVE: RoutingConfig(
        prompt_template="photo_qa_solve",
        rag_collections=["questions", "knowledge_points", "textbook_chapters"],
        model_preference="reasoning",      # 优先推理模型
        require_answer_control=True,       # 需要答案管控
    ),
    LearningIntent.TEXT_SOLVE: RoutingConfig(
        prompt_template="text_qa_solve",
        rag_collections=["questions", "knowledge_points"],
        model_preference="reasoning",
        require_answer_control=True,
    ),

    # ── 知识学习类 ──
    LearningIntent.CONCEPT_EXPLAIN: RoutingConfig(
        prompt_template="concept_explain",
        rag_collections=["knowledge_points", "textbook_chapters"],
        model_preference="general",
        require_answer_control=False,
    ),
    LearningIntent.REVIEW: RoutingConfig(