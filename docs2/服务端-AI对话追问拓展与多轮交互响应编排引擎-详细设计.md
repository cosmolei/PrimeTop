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

> **协议对齐（v1.1 修正）**：追问产生的新轮次作为普通对话轮次由对话引擎持久化（`parent_turn_id` 指向触发轮次），流式事件协议**复用 AI对话引擎 §5.2 SSE 协议**（`content` / `reasoning` / `metadata` / `suggestions` / `error` / `done`），不另立事件名。v1.0 草案中的 `meta` / `token` / `suggested_actions` 事件名已废弃。

```
event: metadata
data: {"follow_up_id":"fup_001","new_turn_id":"turn_20260609_001_006","parent_turn_id":"turn_20260609_001_005","response_type":"stream"}

event: content
data: {"delta":"好的，","index":0}

event: content
data: {"delta":"我们用更简单的方式来理解这个概念。","index":1}

...

event: suggestions
data: {"items":[{"type":"give_example","label":"举例说明","icon":"bulb"},{"type":"continue","label":"继续追问","icon":"chat"},{"type":"add_to_mistakes","label":"加入错题本","icon":"book"}]}

event: done
data: {}
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

#### 4.1.4 客户端动作标识映射

客户端快捷操作面板（`客户端-AI对话快捷操作面板与学习场景动作触发引擎`）使用 `action_id`，服务端使用 `action_type`，映射关系如下（**唯一权威映射，新增动作必须双端同步登记**）：

| 客户端 action_id | 服务端 action_type | 类别 | 生效版本 |
|------------------|--------------------|------|---------|
| `explain_simpler` | `SIMPLIFY` | 生成类 | MVP |
| `explain_alternative` | `REPHRASE` | 生成类 | MVP |
| `give_example` | `GIVE_EXAMPLE` | 生成类 | MVP |
| `follow_up` | `CONTINUE_ASKING`（`user_text` 必填） | 生成类 | MVP |
| `generate_similar` | `GENERATE_SIMILAR` | 数据类 | MVP（会员功能） |
| `add_to_mistakes` | `ADD_TO_MISTAKE_BOOK` | 数据类 | MVP |
| `summarize` | `SUMMARIZE` | 生成类 | V1.5 |
| `deep_dive` | `DEEP_DIVE` | 生成类 | V1.5 |
| `exam_focus` | `EXAM_FOCUS` | 生成类 | V1.5 |

> 注意服务端枚举值为 `add_to_mistake_book`（单数 book），客户端按钮 id 为 `add_to_mistakes`，以本表映射为准，**禁止双端各改各的**。客户端面板展示策略（何时隐藏 `add_to_mistakes`、`generate_similar` 会员门控等）归客户端文档权威，服务端只做最终校验（G7）。

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
            "3. 逐步增加复杂度，最后一个贴近考试题目"
        ),
        "requires_rag": False,
        "max_output_tokens": 1000,
    },
    
    FollowUpAction.GENERATE_SIMILAR: {
        "strategy_tag": "follow_up_generate_similar",
        "system_instruction": (
            "你是出题老师。请基于当前题目生成一道考察相同知识点的变式练习题。\n"
            "要求：\n"
            "1. 只改变题目情境、数字或表述方式，不改变考察的知识点\n"
            "2. 难度与原始题目相当，并适配当前学段\n"
            "3. 不直接给出答案，只给题目和必要的引导\n"
            "4. 题目必须可解、无歧义、无超纲内容"
        ),
        "requires_rag": True,   # 需要检索原题与知识点上下文
        "max_output_tokens": 600,
    },
    
    FollowUpAction.CONTINUE_ASKING: {
        "strategy_tag": "follow_up_continue",
        "system_instruction": (
            "你是学生的 AI 学习伙伴。学生将继续提问，请结合上文上下文回答。\n"
            "要求：\n"
            "1. 保持与上文讲解的连贯性\n"
            "2. 如果新问题与上文知识点相关，先建立联系再回答\n"
            "3. 沿用之前的学段适配与讲解风格"
        ),
        "requires_rag": False,
        "max_output_tokens": 1200,
    },
    
    # --- V1.5 扩展动作 ---
    
    FollowUpAction.SUMMARIZE: {
        "strategy_tag": "follow_up_summarize",
        "system_instruction": (
            "你是善于总结的老师。请对本次对话涉及的知识点做系统性总结。\n"
            "要求：\n"
            "1. 用条目化方式列出核心知识点\n"
            "2. 标注每个知识点的掌握要点\n"
            "3. 给出 3 点以内的复习建议"
        ),
        "requires_rag": False,
        "max_output_tokens": 800,
    },
    
    FollowUpAction.DEEP_DIVE: {
        "strategy_tag": "follow_up_deep_dive",
        "system_instruction": (
            "你是学科专家。学生希望深入了解当前知识点，请给出拓展性内容。\n"
            "要求：\n"
            "1. 说明该知识点在学科体系中的位置\n"
            "2. 给出与后续知识的衔接关系\n"
            "3. 严格控制在当前学段可理解的深度，不超纲"
        ),
        "requires_rag": True,
        "max_output_tokens": 1000,
    },
    
    FollowUpAction.EXAM_FOCUS: {
        "strategy_tag": "follow_up_exam_focus",
        "system_instruction": (
            "你是备考教练。请说明当前知识点在考试中的常见考法。\n"
            "要求：\n"
            "1. 列出 2-3 种常见题型\n"
            "2. 给出解题关键步骤\n"
            "3. 指出常见失分点"
        ),
        "requires_rag": True,
        "max_output_tokens": 900,
    },
    
    # 数据类动作不走 LLM：strategy_tag 为 None，Prompt 层直接跳过（见 §4.4.3）
    FollowUpAction.ADD_TO_MISTAKE_BOOK: {
        "strategy_tag": None,
        "system_instruction": None,
        "requires_rag": False,
        "max_output_tokens": 0,
    },
}
```

> **说明**：
> 1. `ADD_TO_MISTAKE_BOOK` 为数据类动作，由执行层直接委托错题服务，不进入 Prompt 层。
> 2. `GENERATE_SIMILAR` 优先走《题目条件变式生成与解题方法归纳引擎》的确定性生成管线（见 §4.4.2），本 Prompt 策略仅作为变式引擎不可用时的降级路径（D3）。
> 3. 所有 `strategy_tag` 必须先在《AI-Prompt编排与场景模板系统》注册同名模板实例后方可上线，注册校验见守卫 G9。

#### 4.3.2 模板变量与填充规则

Prompt 编排系统提供的模板实例包含以下占位变量，由本引擎在组装阶段填充：

| 变量名 | 来源 | 填充规则 |
|--------|------|---------|
| `{{grade_level}}` | 触发轮次学段快照 | 直接透传，不做二次推断 |
| `{{grade}}` | 触发轮次年级快照 | 直接透传 |
| `{{subject}}` | 触发轮次学科 | 可空，空时模板须走通用学科分支 |
| `{{trigger_content}}` | 触发轮次 AI 回复（截断后） | 超预算时尾部截断并追加「（上文略）」标记 |
| `{{history_context}}` | 历史轮次拼接文本 | 每轮以「第 N 轮·角色：内容」格式拼接 |
| `{{knowledge_points}}` | 知识点列表 | 格式为「- 知识点名（ID）」，最多 5 个 |
| `{{user_follow_up}}` | 用户追问文本 | 仅 `continue_asking` 使用，其他动作为空 |
| `{{rag_context}}` | RAG 检索结果 | 仅 `requires_rag=True` 的动作填充，其余置空串 |

填充红线：

1. **禁止变量逃逸**：填充前对用户文本做 `{{` / `}}` 转义，防止用户输入污染模板结构（注入防护）。
2. **空值不留占位符**：所有变量必须在组装阶段完成替换，发送到模型前做最终扫描，残留 `{{...}}` 视为组装失败（59911）。
3. **原文最小化**：`trigger_content` 与 `history_context` 只保留文本正文，剔除图片/公式原始 LaTeX 以外的一切附件引用。

#### 4.3.3 输出约束

所有生成类动作的统一输出约束（在系统指令尾部由模板自动附加）：

```
输出要求：
1. 面向当前学段学生，语气鼓励、耐心，禁止贬低或嘲讽
2. 数学/物理/化学内容中的公式使用标准 LaTeX 表示
3. 单次回复不超过 800 字（超出时优先精简例子而非删减讲解步骤）
4. 结尾不主动推荐付费内容；如用户问到会员权益相关问题按客服话术指引
5. 涉及答案管控的内容遵守渐进式提示规则（不直接给出完整答案）
```

输出约束与《AI回答后处理与智能优化管线》的关系：约束 1/2/3 为生成前引导（软约束），ARPP 的结构化增强与格式规范化仍为生成后硬保障，双保险不互相替代。

### 4.4 执行分发

编排器完成上下文组装与 Prompt 拼装后，按动作类别分流：

```
FollowUpOrchestrator.execute()
    │
    ├── 生成类（SIMPLIFY/REPHRASE/GIVE_EXAMPLE/CONTINUE_ASKING/
    │          SUMMARIZE/DEEP_DIVE/EXAM_FOCUS/GENERATE_SIMILAR-降级路径）
    │     → 创建新轮次（parent_turn_id=trigger_turn_id）
    │     → 调用模型网关（流式）→ SSE 推送 → 轮次落库
    │
    └── 数据类（ADD_TO_MISTAKE_BOOK / GENERATE_SIMILAR-主路径）
          → 同步委托下游服务 → JSON 响应
```

#### 4.4.1 生成类执行流程

```python
async def execute_generative(
    self,
    record: FollowUpActionRecord,
    context: FollowUpContext,
    prompt: AssembledPrompt,
) -> None:
    """生成类动作执行：流式调用 + SSE 推送 + 状态维护"""
    
    # ① 状态推进 pending → processing（CAS，防并发双执行）
    record = await self._repo.cas_status(
        record.id, expect="pending", target="processing",
    ) or raise ConcurrencyError(59906)
    
    # ② 由对话引擎创建新轮次（parent_turn_id 指向触发轮次）
    new_turn = await self._dialogue_engine.create_turn(
        conversation_id=record.conversation_id,
        parent_turn_id=record.trigger_turn_id,
        role="assistant",
        source="follow_up",
        follow_up_id=record.id,
    )
    await self._repo.update_new_turn(record.id, new_turn.turn_id)
    
    # ③ 流式调用模型网关（委托大模型统一适配层）
    stream = await self._model_gateway.chat_stream(
        prompt=prompt,
        max_tokens=prompt.strategy.max_output_tokens,
        cancel_token=record.cancel_token,
    )
    
    # ④ SSE 事件转发（协议复用 AI对话引擎 §5.2，见 §4.1.1 对齐说明）
    try:
        async for event in stream:
            if record.is_cancelled:            # G11 cancel 竞态：先完成者胜
                await stream.aclose()
                await self._repo.cas_status(record.id, "processing", "cancelled")
                return
            await self._sse_hub.emit(record.conversation_id, event)
    except ModelCallError:
        await self._repo.cas_status(record.id, "processing", "failed")
        await self._sse_hub.emit(record.conversation_id, ErrorEvent(59912))
        raise
    
    # ⑤ 完成：轮次内容由对话引擎落库，本引擎只更新状态与后处理
    await self._repo.cas_status(record.id, "processing", "completed")
    await self._post_processor.on_completed(record)
```

延迟预算（P99）：

| 阶段 | 预算 | 说明 |
|------|------|------|
| 请求校验 + 幂等 | 20ms | 含 uk_request_id 查询 |
| 上下文组装 | 80ms | 含轮次查询与 KP 提取 |
| Prompt 拼装 | 30ms | 含模板渲染与转义 |
| 首 token | ≤ 3s | 委托模型网关，与对话主链路同 SLA |
| 非生成类动作总耗时 | ≤ 200ms | 数据类动作硬顶 |

#### 4.4.2 GENERATE_SIMILAR 双路径编排

| 路径 | 触发条件 | 执行方式 | 响应 |
|------|---------|---------|------|
| 主路径（确定性生成） | 变式引擎健康且原题结构化信息完整 | 委托《题目条件变式生成与解题方法归纳引擎》生成变式题，入库后返回题目 ID | `response_type=json`，`related_id=变式题ID`，客户端跳转练习组件 |
| 降级路径（LLM 生成） | 变式引擎不可用/超时（D3）或原题为开放题无结构化信息 | 走生成类管线（strategy_tag=`follow_up_generate_similar`），AI 直接生成题目文本 | `response_type=stream`，题面以流式文本下发 |

主路径时序：

```
FollowUpOrchestrator ──► VariationEngine.generate(
                          source_question_id, kp_ids, grade)
                       ──► 变式题入库（question 表，source=VARIATION）
                       ──► 返回 variation_question_id
FollowUpOrchestrator ──► record.related_question_id = variation_question_id
                       ──► 响应 JSON（action_result=success）
```

主路径超时（默认 5s）未返回 → 自动切降级路径并标记 `degraded=true`（对客户端透明，仅在埋点与日志体现）。

#### 4.4.3 ADD_TO_MISTAKE_BOOK 执行流程

```python
async def execute_add_to_mistake_book(
    self,
    record: FollowUpActionRecord,
) -> AddToMistakeResult:
    """数据类动作：委托错题服务收录"""
    
    # ① 从触发轮次提取关联题目（对话引擎提供的 kp/question 引用）
    question_ref = await self._dialogue_engine.get_turn_question_ref(
        record.trigger_turn_id,
    )
    if question_ref is None:
        # 对话无关联题目（如纯知识问答）→ 转「手工建错题」流程
        return AddToMistakeResult(
            action_result="failed",
            detail="当前对话未关联具体题目，无法自动收录",
        )
    
    # ② 幂等委托错题服务（幂等键 = follow_up 的 request_id，
    #    错题服务内部另有 uk 防重，双重保障）
    result = await self._mistake_service.add_from_dialogue(
        question_id=question_ref.question_id,
        conversation_id=record.conversation_id,
        trigger_turn_id=record.trigger_turn_id,
        idempotency_key=record.request_id,
    )
    
    # ③ 结果映射
    if result.status == "CREATED":
        record.related_mistake_id = result.mistake_id
        return AddToMistakeResult("success", "已加入错题本", result.mistake_id)
    elif result.status == "DUPLICATED":
        # 已在错题本：200 语义码 59931，action_result=partial
        return AddToMistakeResult("partial", "该题已在错题本中", result.mistake_id)
    else:
        return AddToMistakeResult("failed", "收录失败，请稍后重试", None)
```

> **事件红线（G6）**：`mistake.added` 事件由错题服务在其领域内发布，本引擎**不重复发布**；下游如需关联追问来源，消费错题事件中的 `source_conversation_id` / `source_follow_up_id` 字段。

### 4.5 后处理与效果追踪

每次追问动作进入终态后，后处理器执行：

1. **效果记录**：更新 `follow_up_actions` 终态、`completed_at`、`token_budget_used`。
2. **下一步建议**（生成类）：由《AI教育辅导策略引擎与启发式引导系统》决策 `suggested_actions`，本引擎只做透传，不决策。
3. **用户满意度推断**：用户在追问响应后 60s 内继续追问 → `user_satisfied=1`；点击「没用/重新生成」→ `user_satisfied=0`；超窗无操作 → NULL（不推断）。
4. **事件发布**：按 §7 发布 `follow_up.*` 事件。
5. **AI 质量信号**：生成类追问的低质输出（用户点踩）经《用户反馈与AI质量评估》通道回流，本引擎提供 `follow_up_id` 维度的关联键。

---

## 5. 错误码

本服务使用 **59900-59999** 错误码段（全库扫描确认：59800-59899 归 AI辅导对话知识点掌握度引擎、59100-59299 归增值商品域，本段无冲突；段内 59900 字面量出现在价格字段属非错误码巧合，不影响分配）。

| 错误码 | HTTP | 语义 | 客户端提示策略 |
|--------|------|------|---------------|
| 59900 | 500 | 追问处理通用失败 | 统一文案「操作失败，请稍后重试」，不重试 |
| 59901 | 400 | 请求参数校验失败（缺字段/格式错） | 客户端表单内联提示，不重试 |
| 59902 | 403 | 对话不存在或无访问权限 | 统一文案，刷新对话列表 |
| 59903 | 404 | 触发轮次不存在或不属于该对话 | 客户端刷新对话后重试一次 |
| 59904 | 400 | 动作类型未注册或当前版本未启用 | 客户端隐藏该动作入口（面板文档 G7） |
| 59905 | 409 | 对话状态不允许追问（已结束/冻结/安全阻断中） | 提示对话状态，引导新建对话 |
| 59906 | 409 | 幂等键冲突：同 request_id 不同 payload | P2 告警，客户端按 59900 处理 |
| 59907 | 410 | 触发轮次内容已过保留期，无法追问 | 提示「对话记录已过期」，不重试 |
| 59910 | 500 | 上下文提取失败（对话引擎超时） | 重试 1 次，仍失败按 59900 |
| 59911 | 500 | Prompt 组装失败（模板缺失/变量残留） | 不重试，P2 告警 |
| 59912 | 502 | 模型调用失败（生成类） | 客户端展示重试按钮（同对话页重试语义） |
| 59913 | 200 | 语义码：流式响应已被用户取消 | 静默处理，仅埋点 |
| 59920 | 502 | 变式题生成失败（主路径超时且降级路径不可用） | 提示「生成失败」，可重试 |
| 59921 | 502 | 错题收录失败（下游超时/拒绝） | 提示「收录失败，请稍后重试」，可重试 |
| 59930 | 200 | 语义码：取消请求幂等命中（已是 cancelled 或终态） | 返回当前状态，不报错 |
| 59931 | 200 | 语义码：题目已在错题本（DUPLICATED） | toast「该题已在错题本」，跳转错题详情 |
| 59940 | 200 | 语义码：幂等重放，返回首次执行结果 | 客户端无感 |

限流：追问接口按用户维度限流（生成类 20 次/分钟，数据类 30 次/分钟），超限走全局 429 标准响应，不使用本段错误码。

---

## 6. 状态机与守卫

### 6.1 状态机

状态集合与 §2.3 流转图一致：`pending → processing → completed / failed / cancelled`，`pending → cancelled`（排队期取消，极端场景）。

补充规则：

| 规则 | 说明 |
|------|------|
| 数据类动作 | 不经历长时 processing：委托下游期间短暂置 processing，下游返回后立即终态；G12 兜底 10s 未返回置 failed（59921/59920） |
| cancelled 终态不可逆 | 已取消的动作不允许重放为 completed |
| completed 幂等 | 重复完成回调（如模型网关重试）不重复发布事件（§7 幂等键） |

### 6.2 守卫总表

| 编号 | 守卫 | 违反后果 |
|------|------|---------|
| G1 | 幂等：uk_request_id 唯一；同键同 payload 重放返回 59940 + 首次结果；同键不同 payload 拒绝 59906 | 59906 |
| G2 | action_type 必须在服务端注册表内且当前版本启用 | 59904 |
| G3 | 对话必须处于 ACTIVE 状态（非 ENDED/FROZEN/安全阻断） | 59905 |
| G4 | trigger_turn_id 必须属于该 conversation_id | 59903 |
| G5 | 生成类动作必须创建新轮次且 parent_turn_id 必填；数据类动作 new_turn_id 必须为 NULL | 数据一致性异常，P2 告警 |
| G6 | 跨服务委托不重复发布下游领域事件（mistake.added 归错题服务） | 下游双计，P1 告警 |
| G7 | 客户端 action_id ↔ 服务端 action_type 以 §4.1.4 映射表为唯一权威，双端各改各的视为契约破坏 | 契约对齐检查 CI 拦截 |
| G8 | GENERATE_SIMILAR 主路径需通过功能门控引擎校验会员/额度，校验失败走门控标准响应（本引擎不发明门控错误码） | 门控引擎标准响应 |
| G9 | strategy_tag 对应的 Prompt 模板必须已在编排系统注册且状态 ACTIVE，否则 59911（禁止兜底硬编码 Prompt） | 59911 |
| G10 | 同一 trigger_turn_id 的连续追问深度上限 10 层（防无限追问导致上下文爆炸），超限返回 59905 并建议新开对话 | 59905 |
| G11 | cancel 竞态：processing 与 cancel 并发时先完成的状态迁移生效，后到的 CAS 失败不报错（59930） | 59930 |
| G12 | 数据类动作下游 10s 未返回 → failed；禁止无限等待 | 59921/59920 |
| G13 | 生成内容必须经 ARPP/SOSF 全链路（含流式安全过滤），追问管线不得绕过内容安全 | 安全阻断，按 SOSF blocked 协议 |

---

## 7. 事件 Outbox

### 7.1 发布事件

所有事件经 `follow_up_outbox` 表 Outbox 同事务持久化，Relay 投递，event_id = `fup_{record_id}_{status}` 保证幂等。

| 事件 | 触发时机 | 关键载荷 | 消费方 |
|------|---------|---------|--------|
| `follow_up.completed` | 任意动作进入 completed | conversation_id, trigger_turn_id, new_turn_id, action_type, related_question_id, related_mistake_id, token_budget_used | 埋点平台（漏斗分析）、学情分析（对话行为归因）、辅导策略引擎（suggested_actions 决策输入） |
| `follow_up.failed` | 进入 failed | record 全量快照 + error_code | 监控告警（599xx 聚合）、埋点平台 |
| `follow_up.cancelled` | 进入 cancelled | record 快照 + cancel_source(client/disconnect/timeout) | 埋点平台 |

> 数据类动作的成功语义包含在 `follow_up.completed` 的 `action_type` 中，不另立 `mistake.added`（G6 红线）。

### 7.2 follow_up_outbox DDL

```sql
CREATE TABLE follow_up_outbox (
    id            BIGINT PRIMARY KEY AUTO_INCREMENT,
    event_id      VARCHAR(80)  NOT NULL COMMENT 'fup_{record_id}_{status}，幂等键',
    event_type    VARCHAR(32)  NOT NULL COMMENT 'follow_up.completed/failed/cancelled',
    payload       JSON         NOT NULL COMMENT '事件载荷（同 7.1 字段）',
    publish_status VARCHAR(16) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/SENT/FAILED',
    retry_count   INT          NOT NULL DEFAULT 0,
    created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    sent_at       DATETIME(3)  DEFAULT NULL,
    UNIQUE KEY uk_event_id (event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='追问动作事件 Outbox';
```

### 7.3 上游订阅

本引擎不消费上游领域事件；所需对话状态由对话引擎同步接口查询（短耗时容忍，80ms 预算内）。

---

## 8. 降级矩阵

| 编号 | 故障场景 | 降级策略 | 红线 |
|------|---------|---------|------|
| D1 | 对话引擎超时/不可用 | 追问请求整体失败 59910；客户端保留快捷操作按钮可重试 | 不得用缓存上下文替代实时对话状态 |
| D2 | Prompt 编排系统不可用 | 全部生成类动作失败 59911；数据类动作不受影响 | G9：禁止本地硬编码 Prompt 兜底 |
| D3 | 变式生成引擎不可用 | GENERATE_SIMILAR 自动切 LLM 降级路径；降级也失败 → 59920 | 主路径超时必须显式标记 degraded |
| D4 | 错题服务不可用 | ADD_TO_MISTAKE_BOOK 返回 failed（59921），客户端展示重试；不做本地暂存（避免跨端状态分叉） | 禁止假成功 |
| D5 | 模型网关不可用 | 生成类 59912，SSE error 事件；客户端展示重试按钮 | 与对话主链路同一熔断策略，不独立熔断 |
| D6 | KP 提取服务不可用 | 上下文组装跳过 knowledge_points（置空列表），追问继续 | 不得因增强项故障阻塞主链路 |
| D7 | RAG 检索不可用 | requires_rag 动作以空 rag_context 继续，Prompt 模板走无检索分支 | 同 D6 |
| D8 | SSE 推送通道断开 | 轮次内容仍由对话引擎落库；客户端重连后按 Last-Event-ID 增量拉取（协议归 AI对话引擎） | 追问不单独实现补推机制 |
| D9 | 埋点/事件下游堆积 | Outbox 积压告警，追问主链路不受影响 | 事件不得同步阻塞响应 |
| D10 | 功能门控引擎不可用 | G8 校验 fail-closed：GENERATE_SIMILAR 暂停服务（按门控引擎熔断标准响应） | 免费额度不可 fail-open |

---

## 9. 监控指标

| 编号 | 指标 | 口径 | 告警阈值 |
|------|------|------|---------|
| M1 | 追问接口成功率 | 非 5xx 占比（含语义码 200） | < 99% 持续 5min → P2 |
| M2 | 生成类首 token 延迟 | P99 | > 3s 持续 10min → P2 |
| M3 | 数据类动作耗时 | P99 | > 200ms 持续 10min → P3 |
| M4 | 各 action_type 分布 | 每分钟计数 | 单一动作占比 > 60% 持续 1h → P3（入口展示异常怀疑） |
| M5 | 幂等命中率 | 59940 占比 | > 5% → P3（客户端重试策略异常） |
| M6 | 下游委托失败率 | 变式引擎/错题服务调用失败占比 | > 2% 持续 10min → P2 |
| M7 | cancel 竞态率 | G11 CAS 失败占比 | 突增 > 10x 基线 → P3 |
| M8 | Prompt 组装失败率 | 59911 占比 | > 0.1% → P2（模板配置事故） |
| M9 | 追问深度超限率 | G10 拦截占比 | > 1% → P3 |
| M10 | Outbox 积压量 | PENDING 行数 | > 10 万 → P2 |

容量估算（DAU 50 万）：追问占 AI 对话会话的 35%，日追问请求约 120 万，峰值 300 QPS；`follow_up_actions` 日增 120 万行，在线保留 90 天（约 1.1 亿行），按月分区，归档注册统一清理引擎。

---

## 10. 合规要点

| 编号 | 要点 |
|------|------|
| C1 | 追问生成的内容仍须完整经过 ARPP/SOSF/适龄化全链路（G13），未成年人内容安全不因「追问」场景降级 |
| C2 | `request_context` 快照含对话内容，按对话数据同等级保护；在线 90 天，归档剥离用户标识 |
| C3 | 追问行为数据（action_type、满意度）仅用于学习效果分析与产品改进，禁止回流营销画像 |
| C4 | 生成内容遵守 AIGC 标识规范（由 ARPP 注入，本引擎不重复处理） |
| C5 | 追问不绕过防沉迷与时长管控：对话被防沉迷收束时 G3 直接拦截 |
| C6 | 用户点踩数据回流 LLM 训练须符合训练数据授权规则（《教育大模型RLHF反馈数据管线》G14 过滤链） |

---

## 11. 契约对齐

| 编号 | 契约 | 裁决 |
|------|------|------|
| R1 | SSE 事件协议 | 权威归《AI对话引擎与会话管理》§5.2，本引擎复用不扩展（v1.1 已废弃草案事件名） |
| R2 | 新轮次持久化 | 权威归对话引擎；本引擎只传 parent_turn_id 与 source=follow_up，轮次内容落库不归本引擎 |
| R3 | 客户端动作标识 | §4.1.4 映射表为双端唯一权威；客户端展示/门控逻辑归《客户端-AI对话快捷操作面板与学习场景动作触发引擎》 |
| R4 | 错题收录与事件 | 权威归错题服务；本引擎委托调用且不重复发布 mistake.added（G6） |
| R5 | 变式题生成 | 权威归《题目条件变式生成与解题方法归纳引擎》；本引擎仅编排与降级 |
| R6 | Prompt 模板 | 权威归《AI-Prompt编排与场景模板系统》；本引擎只定义 strategy_tag 与变量填充（G9 禁止硬编码） |
| R7 | 上下文预算执行 | 预算裁剪/压缩执行归《AI模型上下文管理与对话记忆引擎》；预算分配比例策略归本引擎 §4.2.1 |
| R8 | 功能门控 | 会员/额度校验归《用户额度管控与功能门控引擎》，本引擎不做门控决策（G8/D10） |
| R9 | suggested_actions 决策 | 权威归《AI教育辅导策略引擎与启发式引导系统》，本引擎透传 |
| R10 | 内容安全 | 权威归 SOSF/ARPP 链路；本引擎仅保证不绕过（G13） |

---

## 12. 验收场景

| 编号 | 场景 | 预期 |
|------|------|------|
| A1 | simplify 追问 | 新轮次 parent_turn_id 正确，SSE 协议与对话引擎一致，状态 completed |
| A2 | 同 request_id 重发同 payload | 返回 59940 + 首次结果，不产生新轮次 |
| A3 | 同 request_id 不同 payload | 59906，P2 告警 |
| A4 | 触发轮次属于他人对话 | 59903 |
| A5 | 对话已结束 | 59905 |
| A6 | 未注册 action_type | 59904 |
| A7 | 连续追问 11 层 | G10 拦截 59905，提示新开对话 |
| A8 | add_to_mistakes 成功 | 200，related_id 为错题 ID，错题服务发布 mistake.added 且本引擎无重复事件 |
| A9 | 同题重复加入错题本 | 59931，action_result=partial |
| A10 | 对话无关联题目时 add_to_mistakes | action_result=failed + 引导文案，不调下游 |
| A11 | 错题服务超时 | G12 兜底 10s → failed 59921，可重试 |
| A12 | 变式引擎超时 | 自动切 LLM 降级路径，埋点 degraded=true |
| A13 | 变式引擎与降级路径均失败 | 59920 |
| A14 | 流式响应中用户取消 | cancelled 终态，59913 语义码，不产生完整轮次内容 |
| A15 | cancel 与完成并发 | G11 先到者胜，后到 CAS 失败返回 59930 |
| A16 | Prompt 模板未注册 | G9 拦截 59911，P2 告警 |
| A17 | 用户文本含 {{变量}} 注入 | 转义后填充，模板结构无污染 |
| A18 | KP 提取服务宕机 | D6 降级继续追问，knowledge_points 为空 |
| A19 | 防沉迷收束中追问 | G3 拦截 59905 |
| A20 | 生成内容含敏感词 | SOSF 流式拦截，追问侧不绕过（G13） |

---

## 13. 维护记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-06 | 初版：模块概述/数据模型/状态流转/架构/API/上下文组装（§1-§4.2）。 |
| v1.1 | 2026-09-22 | 补全烂尾文档：原文件 643 行截断于 §4.3.1 `FOLLOW_UP_PROMPT_STRATEGIES` 的 `GIVE_EXAMPLE` 策略代码块中段（围栏未闭合），§4.3.1 后半至文末全部缺失。本次补齐：§4.3.1 全部 9 动作策略映射收尾（含数据类动作占位语义与 GENERATE_SIMILAR 双路径说明）；新增 §4.3.2 模板变量与填充规则（含 {{}} 注入转义红线）、§4.3.3 输出约束、§4.4 执行分发（生成类流程代码/延迟预算表/GENERATE_SIMILAR 主降级双路径/ADD_TO_MISTAKE_BOOK 委托代码含 DUPLICATED 语义）、§4.5 后处理与效果追踪；§5 错误码 59900-59999 共 18 项（全库扫描确认段空闲，含 59913/59930/59931/59940 四个 200 语义码）；§6 状态机补充规则与守卫 G1-G13；§7 follow_up_outbox DDL 与三事件消费方矩阵（G6 不重复发布 mistake.added 红线）；§8 降级矩阵 D1-D10；§9 监控 M1-M10 与 DAU50 万容量；§10 合规 C1-C6；§11 契约对齐 R1-R10；§12 验收场景 20 条。 |