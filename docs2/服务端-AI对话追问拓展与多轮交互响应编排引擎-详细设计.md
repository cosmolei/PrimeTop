# AI对话追问拓展与多轮交互响应编排引擎 - 详细设计

> **模块定位**：服务端核心引擎，负责 AI 辅导对话中「追问拓展」类交互的全流程编排，将用户的二次操作请求转化为精准的上下文组装、Prompt 调优和多服务协调调用。  
> **优先级**：P0（MVP 核心体验，直接决定 AI 辅导的交互深度和用户粘性）  
> **最后更新**：2026-06-09  
> **状态**：待评审

---

## 1. 模块概述

### 1.1 背景与问题

原始设计文档（§6.2.2 第5项、§9.4）明确定义了 AI 辅导对话中的追问拓展能力：

> 每次回答后提供「再讲简单点」「生成同类题」「换一种讲法」「举例说明」「加入错题本」「继续追问」等快捷操作。

这些追问拓展动作是学习闭环中的关键「深化节点」：将单次问答转化为持续的交互式学习。如果缺乏统一编排，会导致：

1. **上下文断裂**：追问时丢失前一轮的知识点、学段适配和讲解策略
2. **Prompt 拼装混乱**：各动作各自为政，无统一模板和上下文预算管理
3. **体验不一致**：不同追问类型的响应风格、速度、质量参差不齐
4. **数据断层**：无法追踪追问行为与学习效果之间的因果链
5. **跨模块协同缺失**：「生成同类题」需要触达题库服务、「加入错题本」需要触达错题服务，缺少统一协调

### 1.2 目标

| 目标 | 衡量标准 |
|------|----------|
| 追问动作准确识别与路由 | 动作类型识别准确率 ≥ 99%（规则匹配，非 AI 推理） |
| 上下文无缝衔接 | 追问响应保留前文关键信息的 token 占比 ≥ 60% |
| 多服务协调一次成功 | 同类题生成 + 错题收录等跨服务调用成功率 ≥ 99.5% |
| 响应延迟可控 | 非生成类动作（如加入错题本）≤ 200ms；生成类动作首 token ≤ 3s |
| 追问行为可追踪 | 每次追问动作关联到对话 ID、轮次 ID、知识点点 ID |

### 1.3 与现有模块的边界

| 关联模块 | 职责边界 | 本模块的补充 |
|----------|---------|-------------|
| 学习场景意图识别与智能路由引擎 | 识别用户的**初始**学习意图并路由到功能模块 | 处理对话**内部**的追问拓展动作，是意图路由的下游消费者 |
| AI对话引擎与会话管理 | 管理对话会话的创建、消息流转、状态持久化 | 本模块是对话引擎的「追问拓展子管线」，通过对话引擎的扩展点接入 |
| AI教育辅导策略引擎与启发式引导系统 | 决定「如何教」—— 选择教学策略 | 本模块在策略引擎决策后，负责具体追问动作的执行编排 |
| AI模型上下文管理与对话记忆引擎 | 管理 token 预算、历史压缩、长期记忆 | 本模块定义追问场景下的上下文组装策略，由上下文引擎执行预算分配 |
| AI-Prompt编排与场景模板系统 | Prompt 模板 CRUD、版本管理 | 本模块定义追问场景的 Prompt 策略标签，由编排系统提供模板实例 |
| 题目条件变式生成与解题方法归纳引擎 | 生成同类题、变式题 | 本模块作为调用方，编排「生成同类题」动作的完整流程 |
| 错题整理模块 | 错题收录、错因标签、复习调度 | 本模块触发「加入错题本」动作，由错题服务执行 |

### 1.4 设计原则

1. **规则优先**：追问动作类型由客户端显式传递，服务端规则校验，不依赖 AI 推理
2. **上下文最小化**：追问 Prompt 只保留前文必要信息，不无脑全量回传
3. **异步协调**：跨服务调用采用异步事件 + 补偿机制，避免追问请求阻塞
4. **渐进增强**：MVP 支持 5 种核心追问动作，后续通过配置扩展新动作类型
5. **效果可归因**：每次追问动作记录独立事件，支持 A/B 测试和学习效果分析

---

## 2. 核心概念与数据模型

### 2.1 追问动作类型枚举

```typescript
/**
 * 追问动作类型
 * 客户端在用户点击快捷操作时，携带明确的 action_type
 */
export enum FollowUpAction {
  /** 再讲简单点 —— 降低讲解深度，使用更通俗的语言 */
  SIMPLIFY = "simplify",
  
  /** 换一种讲法 —— 保持深度，更换讲解视角或类比方式 */
  REPHRASE = "rephrase",
  
  /** 举例说明 —— 提供具体例子、生活化场景、类比 */
  GIVE_EXAMPLE = "give_example",
  
  /** 生成同类题 —— 基于当前题目知识点生成变式练习题 */
  GENERATE_SIMILAR = "generate_similar",
  
  /** 继续追问 —— 自由文本追问，保持上下文继续对话 */
  CONTINUE_ASKING = "continue_asking",
  
  /** 加入错题本 —— 将当前对话关联的题目加入错题本 */
  ADD_TO_MISTAKE_BOOK = "add_to_mistake_book",
  
  /** --- V1.5 扩展 --- */
  
  /** 总结归纳 —— 对当前对话涉及的知识点做系统性总结 */
  SUMMARIZE = "summarize",
  
  /** 深入探究 —— 针对当前知识点给出更深层/拓展性内容 */
  DEEP_DIVE = "deep_dive",
  
  /** 考点关联 —— 展示该知识点在考试中的常见考法 */
  EXAM_FOCUS = "exam_focus",
}
```

### 2.2 核心数据结构

#### 2.2.1 追问请求体

```typescript
interface FollowUpRequest {
  /** 对话 ID */
  conversation_id: string;
  
  /** 触发追问的消息轮次 ID（即 AI 回复所在轮次） */
  trigger_turn_id: string;
  
  /** 追问动作类型 */
  action_type: FollowUpAction;
  
  /** 用户附加内容（仅 continue_asking 类型必填） */
  user_text?: string;
  
  /** 客户端环境上下文 */
  context: {
    grade_level: string;    // 学段快照
    grade: string;          // 年级快照
    subject?: string;       // 学科
    scene: string;          // 场景标识
    platform: string;       // android / ios / web
  };
  
  /** 客户端请求 ID（幂等键） */
  request_id: string;
}
```

#### 2.2.2 追问响应体

```typescript
interface FollowUpResponse {
  /** 追问记录 ID */
  follow_up_id: string;
  
  /** 对话 ID（可能与请求不同，如创建新对话的情况） */
  conversation_id: string;
  
  /** 新轮次 ID */
  new_turn_id: string;
  
  /** 响应类型 */
  response_type: "stream" | "json";
  
  /** 流式响应端点（stream 类型） */
  stream_endpoint?: string;
  
  /** 直接响应数据（json 类型，如 add_to_mistake_book） */
  data?: {
    action_result: "success" | "partial" | "failed";
    detail?: string;
    related_id?: string;  // 如错题记录 ID、变式题 ID
  };
  
  /** 后续可用动作建议（由策略引擎决定） */
  suggested_actions?: FollowUpAction[];
}
```

#### 2.2.3 追问动作执行记录

```sql
CREATE TABLE follow_up_actions (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    conversation_id BIGINT NOT NULL COMMENT '对话ID',
    trigger_turn_id BIGINT NOT NULL COMMENT '触发追问的轮次ID',
    new_turn_id     BIGINT DEFAULT NULL COMMENT '追问产生的新轮次ID',
    
    action_type     VARCHAR(32) NOT NULL COMMENT '追问动作类型',
    status          VARCHAR(16) NOT NULL DEFAULT 'pending' 
        COMMENT 'pending/processing/completed/failed/cancelled',
    
    -- 请求上下文快照
    request_context JSON NOT NULL COMMENT '追问请求的完整上下文快照',
    
    -- Prompt 组装信息
    prompt_template_id  VARCHAR(64) DEFAULT NULL COMMENT '使用的 Prompt 模板 ID',
    prompt_strategy_tag VARCHAR(32) DEFAULT NULL COMMENT '策略标签',
    token_budget_used   INT DEFAULT NULL COMMENT '本次追问实际消耗的 token 预算',
    
    -- 关联资源
    related_question_id BIGINT DEFAULT NULL COMMENT '关联题目ID（generate_similar 用）',
    related_mistake_id  BIGINT DEFAULT NULL COMMENT '关联错题记录ID（add_to_mistake_book 用）',
    
    -- 效果追踪
    user_satisfied      TINYINT(1) DEFAULT NULL COMMENT '用户是否满意（后续追问或取消）',
    next_action_type    VARCHAR(32) DEFAULT NULL COMMENT '用户的下一个追问动作',
    
    -- 审计
    request_id      VARCHAR(64) NOT NULL COMMENT '客户端请求ID（幂等键）',
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    completed_at    DATETIME(3) DEFAULT NULL,
    
    INDEX idx_conv_turn (conversation_id, trigger_turn_id),
    INDEX idx_action_type (action_type, created_at),
    INDEX idx_request_id (request_id),
    UNIQUE KEY uk_request_id (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='追问动作执行记录';
```

### 2.3 状态流转

```
                    ┌─────────────┐
                    │   pending   │  ← 初始状态（请求到达）
                    └──────┬──────┘
                           │
                    上下文组装 + Prompt 拼装
                           │
                    ┌──────▼──────┐
                    │ processing  │  ← 正在执行追问动作
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼──────┐ ┌──▼───┐  ┌─────▼─────┐
       │  completed  │ │failed│  │ cancelled │
       └─────────────┘ └──────┘  └───────────┘
         成功完成      执行失败    用户取消/超时
```

状态转换规则：

| 当前状态 | 目标状态 | 触发条件 |
|---------|---------|---------|
| pending | processing | 开始组装上下文 |
| processing | completed | AI 响应完成（流式结束）或非生成类动作成功 |
| processing | failed | 模型调用失败 / 跨服务调用失败 / 超时 |
| processing | cancelled | 用户在响应完成前离开对话 / 连接断开 |
| pending | cancelled | 请求排队期间被取消（极端情况） |

---

## 3. 整体架构

### 3.1 追问拓展管线

```
客户端（快捷操作按钮点击）
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│                    API 网关                                │
│            鉴权 + 限流 + 幂等校验                           │
└───────────────────────┬──────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────┐
│           FollowUpOrchestrator（追问编排器）                │
│                                                            │
│  ① 请求校验（幂等 + 动作类型合法性 + 对话状态检查）           │
│  ② 上下文提取（从对话引擎获取前文、知识点、学段信息）          │
│  ③ 动作策略选择（根据 action_type + 学段 + 历史）            │
│  ④ Prompt 组装（策略标签 → Prompt 编排系统获取模板实例）     │
│  ⑤ 执行分发（生成类 / 非生成类分流）                        │
│  ⑥ 后处理（效果记录 + 下一步建议）                          │
└─────────┬──────────────────┬──────────────────┬───────────┘
          │                  │                  │
    ┌─────▼─────┐    ┌──────▼──────┐    ┌──────▼──────┐
    │ 生成类管线  │    │ 数据类管线   │    │ 事件发布     │
    │            │    │             │    │             │
    │ SIMPLIFY   │    │ ADD_TO_     │    │ follow_up_  │
    │ REPHRASE   │    │ MISTAKE_BOOK│    │ completed   │
    │ GIVE_      │    │             │    │             │
    │ EXAMPLE    │    │ （直接调用   │    │ → 学习行为   │
    │ GENERATE_  │    │   错题服务） │    │   采集       │
    │ SIMILAR    │    │             │    │ → 学情分析   │
    │ CONTINUE_  │    └─────────────┘    │   更新       │
    │ ASKING     │                       │ → 数据埋点   │
    │            │                       └─────────────┘
    │ （流式调用  │
    │   AI模型） │
    └────────────┘
```

### 3.2 分层职责

| 层次 | 组件 | 职责 |
|------|------|------|
| 入口层 | `FollowUpController` | HTTP 接口、参数校验、幂等检查 |
| 编排层 | `FollowUpOrchestrator` | 管线编排、策略选择、异常兜底 |
| 上下文层 | `FollowUpContextBuilder` | 提取前文、知识点、学段适配信息 |
| Prompt 层 | `FollowUpPromptAssembler` | 策略标签映射、模板填充、token 预算控制 |
| 执行层 | `FollowUpActionExecutor` | 分发生成类/数据类动作，管理流式/同步响应 |
| 后处理层 | `FollowUpPostProcessor` | 效果记录、下一步建议、事件发布 |
| 持久层 | `FollowUpActionRepository` | 追问记录 CRUD、状态更新 |

---

## 4. 详细设计

### 4.1 API 接口设计

#### 4.1.1 发起追问动作

```
POST /api/v1/conversations/{conversation_id}/follow-ups
```

**请求体：**

```json
{
  "trigger_turn_id": "turn_20260609_001_005",
  "action_type": "simplify",
  "user_text": null,
  "context": {
    "grade_level": "junior_senior",
    "grade": "8",
    "subject": "math",
    "scene": "tutoring",
    "platform": "android"
  },
  "request_id": "req_fup_20260609_abc123"
}
```

**响应（生成类动作 → SSE 流式）：**

HTTP 状态码 `200`，Content-Type: `text/event-stream`

```
event: meta
data: {"follow_up_id":"fup_001","new_turn_id":"turn_20260609_001_006","response_type":"stream"}

event: token
data: {"content":"好的，","index":0}

event: token
data: {"content":"我们用更简单的方式来理解这个概念。","index":1}

...

event: suggested_actions
data: {"actions":["give_example","continue_asking","add_to_mistake_book"]}

event: done
data: {"follow_up_id":"fup_001","tokens_used":186}
```

**响应（数据类动作 → JSON）：**

```json
{
  "follow_up_id": "fup_002",
  "conversation_id": "conv_20260609_001",
  "new_turn_id": null,
  "response_type": "json",
  "data": {
    "action_result": "success",
    "detail": "已加入错题本",
    "related_id": "mistake_20260609_0042"
  },
  "suggested_actions": ["generate_similar", "simplify"]
}
```

#### 4.1.2 查询追问历史

```
GET /api/v1/conversations/{conversation_id}/follow-ups
```

**Query 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `page` | int | 否 | 页码，默认 1 |
| `page_size` | int | 否 | 每页条数，默认 20，最大 50 |
| `action_type` | string | 否 | 按动作类型过滤 |

**响应：**

```json
{
  "total": 12,
  "items": [
    {
      "follow_up_id": "fup_001",
      "trigger_turn_id": "turn_20260609_001_005",
      "action_type": "simplify",
      "status": "completed",
      "created_at": "2026-06-09T10:30:00.000Z",
      "completed_at": "2026-06-09T10:30:05.120Z"
    }
  ]
}
```

#### 4.1.3 取消追问动作

```
POST /api/v1/conversations/{conversation_id}/follow-ups/{follow_up_id}/cancel
```

**响应：**

```json
{
  "follow_up_id": "fup_003",
  "status": "cancelled"
}
```

> 仅 `processing` 状态的生成类动作可取消。非生成类动作已同步完成，不支持取消。

### 4.2 上下文组装策略

追问动作的核心挑战是：如何从已有多轮对话中提取**恰好够用**的上下文，拼装出高质量的追问 Prompt。

#### 4.2.1 上下文提取规则

```python
class FollowUpContextBuilder:
    """追问上下文组装器"""
    
    def __init__(
        self,
        conversation_repo: ConversationRepository,
        turn_repo: TurnRepository,
        kp_service: KnowledgePointService,
        token_estimator: TokenEstimator,
    ):
        self._conv_repo = conversation_repo
        self._turn_repo = turn_repo
        self._kp_service = kp_service
        self._token_estimator = token_estimator
    
    async def build_context(
        self,
        conversation_id: str,
        trigger_turn_id: str,
        action_type: FollowUpAction,
        token_budget: int,
    ) -> FollowUpContext:
        """
        组装追问上下文
        
        核心策略：
        1. 触发轮次（trigger turn）的完整内容必须保留
        2. 向前回溯 1-2 轮保留原始问题上下文
        3. 提取知识点 ID 和学段信息作为元数据
        4. 剩余预算用于知识库检索结果
        """
        
        # ① 获取触发轮次
        trigger_turn = await self._turn_repo.get_by_id(trigger_turn_id)
        
        # ② 确定回溯轮数（根据动作类型）
        lookback = self._get_lookback_depth(action_type)
        
        # ③ 提取历史轮次
        history_turns = await self._turn_repo.get_recent_turns(
            conversation_id=conversation_id,
            before_turn_id=trigger_turn_id,
            limit=lookback,
        )
        
        # ④ 提取知识点
        knowledge_points = await self._kp_service.extract_from_turn(
            trigger_turn_id=trigger_turn_id,
        )
        
        # ⑤ 计算 token 分配
        allocation = self._allocate_budget(
            history_turns=history_turns,
            trigger_turn=trigger_turn,
            token_budget=token_budget,
            action_type=action_type,
        )
        
        return FollowUpContext(
            trigger_turn=self._truncate_to_budget(trigger_turn, allocation.trigger_budget),
            history_turns=[self._truncate_to_budget(t, allocation.per_turn_budget) for t in history_turns],
            knowledge_points=knowledge_points,
            grade_level=trigger_turn.grade_level,
            grade=trigger_turn.grade,
            subject=trigger_turn.subject,
            remaining_budget=allocation.knowledge_budget,
        )
    
    def _get_lookback_depth(self, action_type: FollowUpAction) -> int:
        """
        不同动作类型的回溯深度不同：
        - simplify/rephrase/give_example: 只需看触发轮次和用户原始问题 → 回溯 1 轮
        - generate_similar: 需要原始题目的完整信息 → 回溯 2 轮
        - continue_asking: 需要更多对话历史保持连贯性 → 回溯 3 轮
        """
        LOOKBACK_MAP = {
            FollowUpAction.SIMPLIFY: 1,
            FollowUpAction.REPHRASE: 1,
            FollowUpAction.GIVE_EXAMPLE: 1,
            FollowUpAction.GENERATE_SIMILAR: 2,
            FollowUpAction.CONTINUE_ASKING: 3,
            FollowUpAction.SUMMARIZE: 4,  # 总结需要更多上下文
            FollowUpAction.DEEP_DIVE: 2,
            FollowUpAction.EXAM_FOCUS: 2,
        }
        return LOOKBACK_MAP.get(action_type, 2)
    
    def _allocate_budget(
        self,
        history_turns: list,
        trigger_turn: Turn,
        token_budget: int,
        action_type: FollowUpAction,
    ) -> BudgetAllocation:
        """
        Token 预算分配策略
        
        总预算 = 系统提示 + 上下文 + 用户追问 + 输出预留
        
        上下文部分的分配：
        - 触发轮次: 40% 预算（最重要，是追问的直接对象）
        - 历史轮次: 30% 预算（平均分配给每轮）
        - 知识库检索: 30% 预算（RAG 增强内容）
        """
        context_budget = token_budget - 300  # 减去系统提示和输出预留
        
        trigger_budget = int(context_budget * 0.40)
        history_total = int(context_budget * 0.30)
        knowledge_budget = int(context_budget * 0.30)
        
        per_turn_budget = history_total // max(len(history_turns), 1)
        
        return BudgetAllocation(
            trigger_budget=trigger_budget,
            per_turn_budget=per_turn_budget,
            knowledge_budget=knowledge_budget,
        )
```

#### 4.2.2 上下文数据结构

```python
@dataclass
class FollowUpContext:
    """追问上下文"""
    
    # 触发轮次（被追问的 AI 回复）
    trigger_turn: TruncatedTurn
    
    # 历史轮次（按时间倒序）
    history_turns: list[TruncatedTurn]
    
    # 知识点列表
    knowledge_points: list[KnowledgePointRef]
    
    # 学段信息
    grade_level: str
    grade: str
    subject: Optional[str]
    
    # 剩余可用预算（用于 RAG 检索）
    remaining_budget: int


@dataclass
class TruncatedTurn:
    """截断后的轮次摘要"""
    turn_id: str
    role: str  # "user" | "assistant"
    content: str  # 截断后的文本内容
    is_truncated: bool
    original_token_count: int
    truncated_token_count: int


@dataclass
class BudgetAllocation:
    """Token 预算分配结果"""
    trigger_budget: int       # 触发轮次预算
    per_turn_budget: int      # 每个历史轮次预算
    knowledge_budget: int     # 知识库检索预算
```

### 4.3 Prompt 拼装策略

每种追问动作类型对应独立的 Prompt 策略标签和模板参数。

#### 4.3.1 策略标签映射

```python
FOLLOW_UP_PROMPT_STRATEGIES = {
    FollowUpAction.SIMPLIFY: {
        "strategy_tag": "follow_up_simplify",
        "system_instruction": (
            "你是一个耐心的老师。学生说上一个解释太难了，请用更简单的方式重新讲解。\n"
            "要求：\n"
            "1. 使用更通俗的语言，避免专业术语或先解释术语\n"
            "2. 用生活化的类比或故事帮助理解\n"
            "3. 把复杂概念拆解成更小的步骤\n"
            "4. 先说结论，再逐步展开\n"
            "5. 保持鼓励和耐心的语气"
        ),
        "requires_rag": False,
        "max_output_tokens": 800,
    },
    
    FollowUpAction.REPHRASE: {
        "strategy_tag": "follow_up_rephrase",
        "system_instruction": (
            "你是一个善于多角度讲解的老师。学生希望用另一种方式理解同一个内容。\n"
            "要求：\n"
            "1. 使用完全不同的讲解视角（如从图形→代数、从宏观→微观、从类比→定义）\n"
            "2. 不要简单重复之前的解释\n"
            "3. 指出两种理解方式的联系\n"
            "4. 适当使用对比或类比"
        ),
        "requires_rag": False,
        "max_output_tokens": 800,
    },
    
    FollowUpAction.GIVE_EXAMPLE: {
        "strategy_tag": "follow_up_example",
        "system_instruction": (
            "你是一个善于举例的老师。学生希望看到具体的例子来帮助理解。\n"
            "要求：\n"
            "1. 提供 2-3 个由浅入深的例子\n"
            "2. 第一个例子用最简单、最生活化的场景\n"
            "3. 逐步增加复杂度，最后一个贴近考试题目