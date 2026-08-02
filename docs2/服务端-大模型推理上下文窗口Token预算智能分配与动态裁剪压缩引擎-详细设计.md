# 服务端-大模型推理上下文窗口Token预算智能分配与动态裁剪压缩引擎-详细设计

## 1. 概述

### 1.1 功能定位

本引擎负责在每次大模型推理调用前，对有限的上下文窗口（Context Window）Token 预算进行智能分配、消息优先级排序、动态裁剪与压缩，确保在模型 Token 上限内最大化教育辅导质量，同时控制单次调用的 Token 成本。

### 1.2 与现有模块的关系

| 现有模块 | 职责边界 | 本引擎差异 |
| --- | --- | --- |
| AI模型上下文管理与对话记忆引擎 | 管理**跨会话**的长期记忆存储与检索策略 | 本引擎聚焦**单次调用**的 Token 预算分配与实时裁剪决策 |
| 学生AI学习伙伴长期记忆库 | 管理**持久化**的学生画像记忆、关系建构 | 本引擎负责将记忆库内容**适配到当前模型的上下文窗口** |
| RAG混合检索策略与知识检索质量优化 | 负责**检索相关性**、召回质量 | 本引擎负责将 RAG 召回结果按预算**择优填充**到 Prompt |
| AI模型调用Token计量与成本归集核算 | 负责**事后**计量、成本归集 | 本引擎负责**事前**预算规划与用量预测 |
| Prompt版本管理与效果回归评估 | 负责 Prompt **模板管理** | 本引擎负责在模板基础上做**运行时动态填充与裁剪** |
| 多模型调度与成本治理 | 负责**模型选择**与供应商路由 | 本引擎在模型已选定后，**优化该模型的上下文构成** |

### 1.3 设计目标

1. **Token 利用率最大化**：在模型上下文窗口限制内，填充最有教育价值的内容。
2. **成本可控**：避免不必要的 Token 浪费，对每次调用做预估和预算约束。
3. **质量稳定**：保证关键上下文（学段、学科、核心问题、关键知识点）不被裁剪。
4. **模型无关**：适配不同模型供应商的上下文窗口大小（4K ~ 200K Token）。
5. **实时低延迟**：裁剪决策延迟 < 5ms，不阻塞主请求流程。
6. **可观测**：输出每次裁剪决策的审计日志，支持效果回溯分析。

### 1.4 适用范围

- AI 智能辅导对话（多轮问答、追问、换种讲法）
- 拍照搜题解析（含图片描述、OCR 结果、知识点检索上下文）
- 作文辅导与批改（含作文全文、评分维度、范文素材）
- 文科背诵辅助（含背诵材料、检测结果、记忆曲线数据）
- 理科解题推导（含题目条件、公式检索、解题模型）
- 同步课堂讲解（含章节内容、知识点关联、课标要求）
- 所有其他需要调用大模型的教育场景

---

## 2. 核心概念定义

### 2.1 上下文消息段（Context Segment）

一次大模型调用的上下文由多个**消息段**组成，每个段有明确的类型、优先级和 Token 开销。

```typescript
enum ContextSegmentType {
  SYSTEM_PROMPT       = 'system_prompt',       // 系统提示词模板
  SAFETY_GUARDRAIL    = 'safety_guardrail',     // 安全护栏指令
  STUDENT_PROFILE     = 'student_profile',      // 学生画像摘要
  SUBJECT_CONTEXT     = 'subject_context',      // 学科与教材上下文
  RAG_KNOWLEDGE       = 'rag_knowledge',        // RAG 检索到的知识点
  RAG_EXAMPLES        = 'rag_examples',         // RAG 检索到的例题/范例
  CONVERSATION_HISTORY= 'conversation_history', // 多轮对话历史
  CONVERSATION_SUMMARY='conversation_summary',  // 对话历史压缩摘要
  LONG_TERM_MEMORY    = 'long_term_memory',     // 长期记忆关键事实
  USER_QUERY          = 'user_query',           // 当前用户提问（文本/图片描述）
  IMAGES_OCR          = 'images_ocr',           // 图片OCR/描述结果
  FEW_SHOT_EXEMPLARS  = 'few_shot_exemplars',   // 少样本示例
  OUTPUT_FORMAT_SPEC  = 'output_format_spec',   // 输出格式规范
}

enum SegmentPriority {
  CRITICAL   = 0,  // 不可裁剪：系统提示、安全护栏、用户当前提问
  HIGH       = 1,  // 高优先级：学科上下文、核心RAG结果
  MEDIUM     = 2,  // 中优先级：对话历史（近期）、学生画像
  LOW        = 3,  // 低优先级：对话历史（远期）、补充RAG结果
  DISPOSABLE = 4,  // 可丢弃：寒暄消息、few-shot示例、格式说明
}

interface ContextSegment {
  id: string;
  type: ContextSegmentType;
  priority: SegmentPriority;
  content: string;                    // 原始文本内容
  tokenCount: number;                 // 预估Token数
  metadata: {
    source: string;                   // 来源标识（如 RAG doc id）
    relevanceScore?: number;          // 检索相关性分数（0~1）
    timestamp?: number;               // 消息时间戳
    turnIndex?: number;               // 对话轮次索引
    compressible: boolean;            // 是否可压缩
    compressionRatio?: number;        // 压缩后预估保留比例
    educationalWeight?: number;       // 教育价值权重（0~1）
  };
}
```

### 2.2 Token 预算模型

```typescript
interface TokenBudget {
  modelMaxTokens: number;             // 模型最大上下文Token数
  reservedForOutput: number;          // 为输出预留的Token数
  availableForInput: number;          // 可用于输入的Token = modelMax - reservedForOutput
  safetyMargin: number;               // 安全余量（防止Token计算误差）
  effectiveBudget: number;            // 实际可用 = availableForInput - safetyMargin
}

// 场景级预算策略
interface BudgetPolicy {
  scenario: string;                   // 场景标识
  outputReserveRatio: number;         // 输出预留比例（如0.3=30%）
  safetyMarginRatio: number;          // 安全余量比例（如0.05=5%）
  segmentAllocation: {                // 各类型段的默认分配比例
    system_prompt: number;
    student_profile: number;
    rag_knowledge: number;
    conversation_history: number;
    few_shot: number;
    // ... 各项比例之和 ≤ 1.0
  };
  maxCostPerCall: number;             // 单次调用最大Token成本（输入+输出）
  preferQualityOverCost: boolean;     // 是否倾向质量优先
}
```

### 2.3 场景预算配置示例

| 场景 | 模型窗口 | 输出预留 | 安全余量 | 对话历史占比 | RAG占比 | Few-shot占比 |
| --- | --- | --- | --- | --- | --- | --- |
| 简单问答 | 8K | 2K (25%) | 200 | 30% | 25% | 10% |
| 多轮辅导对话 | 32K | 4K (12.5%) | 500 | 45% | 20% | 5% |
| 拍题解析 | 16K | 6K (37.5%) | 300 | 10% | 35% | 0% |
| 作文批改 | 32K | 8K (25%) | 500 | 5% | 15% | 0% |
| 背诵检测 | 8K | 1K (12.5%) | 200 | 40% | 20% | 0% |
| 理科解题 | 16K | 4K (25%) | 300 | 15% | 40% | 5% |
| 长文本精读 | 128K | 4K (3%) | 1000 | 5% | 70% | 0% |

---

## 3. 数据结构定义

### 3.1 核心数据表

#### 3.1.1 场景预算策略表 `llm_budget_policy`

```sql
CREATE TABLE llm_budget_policy (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  scenario_code   VARCHAR(64) NOT NULL COMMENT '场景编码: ai_tutoring/photo_solve/essay_grading...',
  scenario_name   VARCHAR(128) NOT NULL COMMENT '场景名称',
  model_tier      VARCHAR(32) NOT NULL COMMENT '模型层级: premium/standard/economy',
  model_max_tokens INT NOT NULL COMMENT '该层级模型上下文Token上限',
  output_reserve_ratio DECIMAL(4,3) NOT NULL DEFAULT 0.250 COMMENT '输出预留比例',
  safety_margin_ratio DECIMAL(4,3) NOT NULL DEFAULT 0.050 COMMENT '安全余量比例',
  segment_allocation JSON NOT NULL COMMENT '各段类型分配比例',
  max_cost_per_call INT NOT NULL DEFAULT 8000 COMMENT '单次调用最大Token',
  prefer_quality  TINYINT NOT NULL DEFAULT 1 COMMENT '1=质量优先, 0=成本优先',
  enabled         TINYINT NOT NULL DEFAULT 1,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_scenario_tier (scenario_code, model_tier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='大模型Token预算策略表';
```

#### 3.1.2 裁剪决策日志表 `llm_context_trim_log`

```sql
CREATE TABLE llm_context_trim_log (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  request_id      VARCHAR(64) NOT NULL COMMENT '请求追踪ID',
  user_id         BIGINT NOT NULL COMMENT '用户ID',
  scenario_code   VARCHAR(64) NOT NULL COMMENT '场景编码',
  model_name      VARCHAR(128) NOT NULL COMMENT '实际调用模型',
  budget_total    INT NOT NULL COMMENT '总Token预算',
  budget_used     INT NOT NULL COMMENT '实际使用Token',
  segments_input  INT NOT NULL COMMENT '输入段总数',
  segments_kept   INT NOT NULL COMMENT '保留段数',
  segments_trimmed INT NOT NULL COMMENT '裁剪段数',
  segments_compressed INT NOT NULL COMMENT '压缩段数',
  trim_strategy   VARCHAR(32) NOT NULL COMMENT '裁剪策略: none/trim/compress/hybrid',
  original_tokens INT NOT NULL COMMENT '裁剪前总Token',
  final_tokens    INT NOT NULL COMMENT '裁剪后总Token',
  compression_ratio DECIMAL(5,4) COMMENT '压缩比 = final/original',
  segment_details JSON NOT NULL COMMENT '各段决策详情',
  processing_time_ms INT NOT NULL COMMENT '裁剪处理耗时(ms)',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_request (request_id),
  INDEX idx_user_time (user_id, created_at),
  INDEX idx_scenario_time (scenario_code, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='上下文裁剪决策日志';
```

#### 3.1.3 对话压缩摘要表 `conversation_compression`

```sql
CREATE TABLE conversation_compression (
  id                BIGINT PRIMARY KEY AUTO_INCREMENT,
  conversation_id   VARCHAR(64) NOT NULL COMMENT '对话会话ID',
  user_id           BIGINT NOT NULL COMMENT '用户ID',
  source_turn_start INT NOT NULL COMMENT '原始对话起始轮次',
  source_turn_end   INT NOT NULL COMMENT '原始对话结束轮次',
  original_token_count INT NOT NULL COMMENT '原始消息总Token',
  summary_text      TEXT NOT NULL COMMENT '压缩后的摘要文本',
  summary_token_count INT NOT NULL COMMENT '摘要Token数',
  compression_ratio DECIMAL(5,4) NOT NULL COMMENT '压缩比',
  key_facts_extracted JSON NOT NULL COMMENT '提取的关键事实列表',
  knowledge_points  JSON NOT NULL COMMENT '涉及的知识点',
  model_used        VARCHAR(128) NOT NULL COMMENT '用于压缩的模型',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_conversation (conversation_id),
  INDEX idx_user_time (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='对话历史压缩摘要';
```

### 3.2 Redis 缓存结构

```
# 场景预算策略缓存
KEY:  llm:budget:policy:{scenario_code}:{model_tier}
TYPE: Hash
TTL:  300s
FIELDS: model_max_tokens, output_reserve_ratio, safety_margin_ratio, segment_allocation(JSON), ...

# 用户对话Token累计统计
KEY:  llm:budget:conversation:{conversation_id}:token_stats
TYPE: Hash
TTL:  7200s (2小时)
FIELDS: total_input_tokens, total_output_tokens, turn_count, last_trim_turn

# 压缩摘要缓存
KEY:  llm:budget:summary:{conversation_id}:{turn_range}
TYPE: String (JSON)
TTL:  86400s (24小时)
VALUE: { summary_text, summary_token_count, key_facts, ... }

# Token计数器限流
KEY:  llm:budget:rate:{user_id}:{date}
TYPE: Hash
TTL:  90000s (到当天结束)
FIELDS: input_tokens_used, output_tokens_used, call_count

# 模型Tokenizer缓存
KEY:  llm:tokenizer:model:{model_name}
TYPE: String
TTL:  604800s (7天)
VALUE: tokenizer配置信息
```

---

## 4. API 接口设计

### 4.1 预算计算与上下文组装接口

**POST `/api/v1/llm-context/assemble`**

组装并裁剪上下文，返回最终可发送给大模型的 messages 数组。

**请求：**

```json
{
  "requestId": "req_20260802_001",
  "userId": 100123,
  "conversationId": "conv_abc123",
  "scenarioCode": "ai_tutoring",
  "modelTier": "standard",
  "modelName": "gpt-4o",
  "userQuery": {
    "text": "老师，为什么负负得正？",
    "imageDescriptions": [],
    "ocrResults": []
  },
  "availableSegments": [
    {
      "type": "student_profile",
      "content": "初一学生，人教版数学，当前学到有理数乘法...",
      "metadata": { "compressible": true, "compressionRatio": 0.3 }
    },
    {
      "type": "conversation_history",
      "content": "多轮对话历史消息...",
      "metadata": {
        "turnIndex": 5,
        "compressible": true,
        "compressionRatio": 0.2,
        "timestamp": 1722470400000
      }
    },
    {
      "type": "rag_knowledge",
      "content": "有理数乘法法则：两数相乘，同号得正...",
      "metadata": {
        "relevanceScore": 0.95,
        "compressible": false,
        "source": "kb_math_grade7_ch1"
      }
    }
  ],
  "extraOptions": {
    "forceIncludeSegments": ["safety_guardrail"],
    "excludeSegmentTypes": [],
    "customBudgetOverride": null
  }
}
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "requestId": "req_20260802_001",
    "budget": {
      "modelMaxTokens": 16384,
      "reservedForOutput": 4096,
      "availableForInput": 12288,
      "safetyMargin": 614,
      "effectiveBudget": 11674
    },
    "assembledMessages": [
      {
        "role": "system",
        "content": "[系统提示词 + 安全护栏 + 学生画像摘要]"
      },
      {
        "role": "system",
        "content": "[RAG知识点: 有理数乘法法则...]"
      },
      {
        "role": "user",
        "content": "[对话历史摘要: 用户之前讨论了正负数概念...]"
      },
      {
        "role": "user",
        "content": "老师，为什么负负得正？"
      }
    ],
    "finalTokenCount": 11200,
    "trimReport": {
      "originalTokenCount": 18500,
      "finalTokenCount": 11200,
      "compressionRatio": 0.605,
      "strategy": "hybrid",
      "segmentsKept": 5,
      "segmentsTrimmed": 2,
      "segmentsCompressed": 3,
      "details": [
        {
          "segmentId": "seg_1",
          "type": "system_prompt",
          "decision": "kept",
          "originalTokens": 500,
          "finalTokens": 500,
          "reason": "CRITICAL priority - never trimmed"
        },
        {
          "segmentId": "seg_2",
          "type": "conversation_history",
          "decision": "compressed",
          "originalTokens": 8000,
          "finalTokens": 1600,
          "reason": "MEDIUM priority - compressed via turn-dropping"
        }
      ]
    }
  }
}
```

### 4.2 对话历史压缩接口

**POST `/api/v1/llm-context/compress-history`**

异步触发对话历史的压缩摘要生成。

**请求：**

```json
{
  "conversationId": "conv_abc123",
  "userId": 100123,
  "turnStart": 1,
  "turnEnd": 8,
  "compressionModel": "gpt-4o-mini",
  "extractKeyFacts": true,
  "extractKnowledgePoints": true,
  "targetCompressionRatio": 0.2
}
```

**响应（同步返回任务ID，异步处理）：**

```json
{
  "code": 0,
  "data": {
    "taskId": "task_compress_001",
    "status": "processing",
    "estimatedCompletionMs": 3000
  }
}
```

### 4.3 预算策略管理接口（管理后台）

**PUT `/api/v1/admin/llm-budget/policies/{scenarioCode}`**

更新场景预算策略。

**请求：**

```json
{
  "modelTier": "standard",
  "outputReserveRatio": 0.25,
  "safetyMarginRatio": 0.05,
  "segmentAllocation": {
    "system_prompt": 0.05,
    "student_profile": 0.05,
    "rag_knowledge": 0.25,
    "conversation_history": 0.40,
    "rag_examples": 0.10,
    "few_shot": 0.05,
    "output_format_spec": 0.05
  },
  "maxCostPerCall": 10000,
  "preferQualityOverCost": true
}
```

### 4.4 裁剪效果统计查询接口

**GET `/api/v1/admin/llm-context/stats?startDate=2026-08-01&endDate=2026-08-02&scenarioCode=ai_tutoring`**

**响应：**

```json
{
  "code": 0,
  "data": {
    "summary": {
      "totalRequests": 125000,
      "avgOriginalTokens": 16800,
      "avgFinalTokens": 9200,
      "avgCompressionRatio": 0.548,
      "avgProcessingTimeMs": 3.2,
      "trimRate": {
        "none": 0.15,
        "trim": 0.30,
        "compress": 0.40,
        "hybrid": 0.15
      }
    },
    "byScenario": [
      {
        "scenarioCode": "ai_tutoring",
        "avgOriginalTokens": 18500,
        "avgFinalTokens": 11200,
        "avgCompressionRatio": 0.605
      }
    ],
    "bySegmentType": [
      {
        "type": "conversation_history",
        "avgCompressionRatio": 0.25,
        "trimFrequency": 0.72
      }
    ]
  }
}
```

---

## 5. 核心算法设计

### 5.1 Token 预算分配算法

```python
class TokenBudgetAllocator:
    """Token预算分配器"""

    def calculate_budget(
        self,
        model_name: str,
        scenario_code: str,
        model_tier: str,
        policy: BudgetPolicy
    ) -> TokenBudget:
        """计算可用Token预算"""
        model_max = self.get_model_max_tokens(model_name, model_tier)

        reserved_for_output = int(model_max * policy.output_reserve_ratio)
        available_for_input = model_max - reserved_for_output

        safety_margin = int(available_for_input * policy.safety_margin_ratio)
        effective_budget = available_for_input - safety_margin

        return TokenBudget(
            model_max_tokens=model_max,
            reserved_for_output=reserved_for_output,
            available_for_input=available_for_input,
            safety_margin=safety_margin,
            effective_budget=effective_budget
        )

    def allocate_by_policy(
        self,
        budget: TokenBudget,
        policy: BudgetPolicy,
        segments: List[ContextSegment]
    ) -> Dict[str, int]:
        """
        按策略比例分配Token预算到各段类型
        返回: {segment_type: allocated_tokens}
        """
        allocation = {}
        total_allocated = 0
        effective = budget.effective_budget

        # 第一轮：按比例分配
        for seg_type, ratio in policy.segment_allocation.items():
            target_tokens = int(effective * ratio)
            # 计算该类型所有段的实际总需求
            actual_demand = sum(
                s.token_count for s in segments
                if self._map_segment_type(s.type) == seg_type
            )
            allocated = min(target_tokens, actual_demand)
            allocation[seg_type] = allocated
            total_allocated += allocated

        # 第二轮：将剩余预算按优先级重新分配给不足的段
        remaining = effective - total_allocated
        if remaining > 0:
            shortage_types = self._find_shortage_types(segments, allocation, policy)
            for seg_type in shortage_types:
                actual_demand = sum(
                    s.token_count for s in segments
                    if self._map_segment_type(s.type) == seg_type
                )
                current = allocation.get(seg_type, 0)
                extra = min(remaining, actual_demand - current)
                allocation[seg_type] += extra
                remaining -= extra
                if remaining <= 0:
                    break

        return allocation
```

### 5.2 上下文裁剪决策算法

这是核心的裁剪决策引擎，采用**贪心 + 动态规划混合**策略。

```python
class ContextTrimDecisionEngine:
    """上下文裁剪决策引擎"""

    def decide(
        self,
        segments: List[ContextSegment],
        budget: TokenBudget,
        allocation: Dict[str, int],
        policy: BudgetPolicy
    ) -> TrimResult:
        """
        裁剪决策主入口
        """
        # Step 1: 标记不可裁剪段
        critical_segments = [s for s in segments if s.priority == SegmentPriority.CRITICAL]
        non_critical = [s for s in segments if s.priority != SegmentPriority.CRITICAL]

        critical_tokens = sum(s.token_count for s in critical_segments)
        remaining_budget = budget.effective_budget - critical_tokens

        if remaining_budget < 0:
            # 极端情况：关键段已超预算
            return self._handle_critical_overflow(critical_segments, budget)

        # Step 2: 计算非关键段的总需求
        total_demand = sum(s.token_count for s in non_critical)

        if total_demand <= remaining_budget:
            # 全部放入，无需裁剪
            return TrimResult(
                strategy="none",
                kept_segments=critical_segments + non_critical,
                trimmed_segments=[],
                compressed_segments=[]
            )

        # Step 3: 尝试压缩策略
        compressed_result = self._try_compress_strategy(
            non_critical, remaining_budget, allocation, policy
        )

        if compressed_result.fits:
            return compressed_result

        # Step 4: 压缩不够，执行裁剪
        return self._trim_with_dp(
            critical_segments, non_critical, remaining_budget, policy
        )

    def _try_compress_strategy(
        self,
        segments: List[ContextSegment],
        budget: int,
        allocation: Dict[str, int],
        policy: BudgetPolicy
    ) -> TrimResult:
        """
        尝试通过压缩使所有段都能放入预算
        """
        result = TrimResult(strategy="compress", kept_segments=[], trimmed_segments=[], compressed_segments=[])
        total_after_compression = 0

        for seg in segments:
            seg_allocation = allocation.get(self._map_segment_type(seg.type), 0)

            if seg.token_count <= seg_allocation:
                # 该段在分配额度内，直接保留
                result.kept_segments.append(seg)
                total_after_compression += seg.token_count
            elif seg.metadata.compressible:
                # 可压缩，计算压缩后Token
                compressed_tokens = int(seg.token_count * seg.metadata.compression_ratio)

                if compressed_tokens <= seg_allocation:
                    # 压缩后可以放入
                    compressed_seg = self._create_compressed_segment(seg, compressed_tokens)
                    result.compressed_segments.append(compressed_seg)
                    total_after_compression += compressed_tokens
                else:
                    # 压缩后仍超出，标记为需要裁剪
                    seg.metadata.needs_trim = True
                    result.kept_segments.append(seg)  # 暂时保留，后续DP处理
                    total_after_compression += compressed_tokens
            else:
                result.kept_segments.append(seg)
                total_after_compression += seg.token_count

        result.fits = total_after_compression <= budget
        return result

    def _trim_with_dp(
        self,
        critical: List[ContextSegment],
        non_critical: List[ContextSegment],
        budget: int,
        policy: BudgetPolicy
    ) -> TrimResult:
        """
        使用动态规划在预算内选择最大化教育价值的消息段组合
        类似0/1背包问题：预算=容量，教育价值=价值，Token=重量
        """
        n = len(non_critical)

        # 按优先级和相关性排序（优先级高的先考虑丢弃成本）
        non_critical.sort(key=lambda s: (
            s.priority.value,                              # 优先级数字越小越重要
            -(s.metadata.relevanceScore or 0),             # 相关性高的优先
            -(s.metadata.educationalWeight or 0.5)         # 教育价值高的优先
        ))

        # 背包DP
        # dp[j] = 在Token预算为j时能获得的最大教育价值
        B = budget  # Token预算
        dp = [0.0] * (B + 1)
        keep = [[False] * (B + 1) for _ in range(n)]

        for i in range(n):
            seg = non_critical[i]
            tokens = seg.token_count
            value = self._calculate_educational_value(seg, policy)

            # 逆序遍历（0/1背包标准写法）
            for j in range(B, tokens - 1, -1):
                if dp[j - tokens] + value > dp[j]:
                    dp[j] = dp[j - tokens] + value
                    keep[i][j] = True

        # 回溯找出保留的段
        kept = []
        trimmed = []
        j = B
        for i in range(n - 1, -1, -1):
            seg = non_critical[i]
            if keep[i][j]:
                kept.append(seg)
                j -= seg.token_count
            else:
                trimmed.append(seg)

        return TrimResult(
            strategy="hybrid" if any(s.metadata.compressible for s in kept) else "trim",
            kept_segments=critical + kept,
            trimmed_segments=trimmed,
            compressed_segments=[s for s in kept if s.metadata.get('was_compressed')]
        )

    def _calculate_educational_value(
        self,
        segment: ContextSegment,
        policy: BudgetPolicy
    ) -> float:
        """
        计算消息段的教育价值分数 (0.0 ~ 10.0)
        综合考虑：优先级权重、检索相关性、教育权重、时效性、轮次近因
        """
        # 基础优先级权重
        priority_weights = {
            SegmentPriority.CRITICAL: 10.0,
            SegmentPriority.HIGH: 7.0,
            SegmentPriority.MEDIUM: 4.0,
            SegmentPriority.LOW: 2.0,
            SegmentPriority.DISPOSABLE: 0.5
        }
        base = priority_weights.get(segment.priority, 1.0)

        # 检索相关性加成（0.5 ~ 1.5）
        relevance = segment.metadata.relevanceScore or 0.5
        relevance_multiplier = 0.5 + relevance

        # 教育权重加成（0.7 ~ 1.3）
        edu_weight = segment.metadata.educationalWeight or 0.5
        edu_multiplier = 0.7 + edu_weight * 0.6

        # 时效性衰减（对话历史越久远，价值越低）
        recency_multiplier = 1.0
        if segment.metadata.timestamp:
            age_hours = (time.time() * 1000 - segment.metadata.timestamp) / (3600 * 1000)
            recency_multiplier = max(0.3, 1.0 - age_hours * 0.02)  # 每小时衰减2%，最低0.3

        # 轮次近因（最近几轮对话更重要）
        turn_multiplier = 1.0
        if segment.metadata.turnIndex is not None:
            # 假设当前是第N轮，最近3轮价值最高
            turns_ago = self.current_turn - segment.metadata.turnIndex
            turn_multiplier = max(0.2, 1.0 - turns_ago * 0.1)

        value = base * relevance_multiplier * edu_multiplier * recency_multiplier * turn_multiplier
        return round(min(value, 15.0), 3)  # 上限15.0
```

### 5.3 对话历史渐进式压缩策略

```python
class ConversationHistoryCompressor:
    """对话历史压缩器"""

    # 压缩触发条件
    COMPRESSION_TRIGGERS = {
        "token_threshold": 6000,      # 对话历史超过6000 Token时触发
        "turn_threshold": 8,           # 对话超过8轮时触发
        "budget_pressure": 0.7,       # 对话历史占预算70%时触发
    }

    async def maybe_compress(
        self,
        conversation_id: str,
        user_id: int,
        history: List[Message],
        budget: TokenBudget,
        current_turn: int
    ) -> List[Message]:
        """检查是否需要压缩，执行压缩并返回压缩后的历史"""

        history_tokens = sum(msg.token_count for msg in history)

        # 判断是否需要压缩
        need_compress = (
            history_tokens > self.COMPRESSION_TRIGGERS["token_threshold"] or
            len(history) > self.COMPRESSION_TRIGGERS["turn_threshold"] or
            history_tokens / budget.effective_budget > self.COMPRESSION_TRIGGERS["budget_pressure"]
        )

        if not need_compress:
            return history

        # 分层压缩策略
        return await self._layered_compress(
            conversation_id, user_id, history, current_turn
        )

    async def _layered_compress(
        self,
        conversation_id: str,
        user_id: int,
        history: List[Message],
        current_turn: int
    ) -> List[Message]:
        """
        分层压缩策略：
        Layer 0: 保留最近 N 轮原始对话（默认3轮）
        Layer 1: 中等距离对话 → 摘要化压缩（保留关键信息）
        Layer 2: 远期对话 → 极简摘要（只保留知识点和结论）
        Layer 3: 超远期对话 → 丢弃，仅保留在长期记忆库中
        """
        RECENT_KEEP_TURNS = 3      # 保留最近3轮完整对话
        MID_RANGE_TURNS = 5        # 中等距离：3~8轮 → 摘要
        FAR_RANGE_TURNS = 10       # 远期：8~18轮 → 极简摘要
        # 超过18轮：丢弃

        turns = len(history) // 2  # 假设每轮=1个user+1个assistant

        # 按轮次分层
        recent_messages = history[-(RECENT_KEEP_TURNS * 2):]  # 最近N轮
        mid_messages = history[-((MID_RANGE_TURNS + RECENT_KEEP_TURNS) * 2):-(RECENT_KEEP_TURNS * 2)]
        far_messages = history[:-(MID_RANGE_TURNS + RECENT_KEEP_TURNS) * 2] if len(history) > (MID_RANGE_TURNS + RECENT_KEEP_TURNS) * 2 else []

        result = []

        # 远期：极简摘要
        if far_messages:
            ultra_summary = await self._generate_summary(
                conversation_id=conversation_id,
                user_id=user_id,
                messages=far_messages,
                model="gpt-4o-mini",
                instruction="""将以下对话极度精简，只保留：
                1. 讨论过的核心知识点（用一句话）
                2. 学生的常见错误认知
                3. 已解决vs未解决的问题
                压缩到200Token以内。""",
                target_tokens=200
            )
            result.append(Message(
                role="system",
                content=f"[早期对话摘要] {ultra_summary.text}",
                token_count=ultra_summary.token_count,
                metadata={"compressed": True, "compression_layer": "far"}
            ))

        # 中等距离：标准摘要
        if mid_messages:
            mid_summary = await self._generate_summary(
                conversation_id=conversation_id,
                user_id=user_id,
                messages=mid_messages,
                model="gpt-4o-mini",
                instruction="""将以下对话精简摘要，保留：
                1. 学生提出的每个问题（一句话）
                2. AI讲解的核心思路和方法
                3. 关键结论和公式
                4. 学生的反馈（是否理解）
                压缩到500Token以内。""",
                target_tokens=500
            )
            result.append(Message(
                role="system",
                content=f"[近期对话摘要] {mid_summary.text}",
                token_count=mid_summary.token_count,
                metadata={"compressed": True, "compression_layer": "mid"}
            ))

        # 最近：保留原始消息
        result.extend(recent_messages)

        return result

    async def _generate_summary(
        self,
        conversation_id: str,
        user_id: int,
        messages: List[Message],
        model: str,
        instruction: str,
        target_tokens: int
    ) -> CompressionResult:
        """调用小模型生成对话摘要"""

        # 检查缓存
        cache_key = f"llm:budget:summary:{conversation_id}:{messages[0].turn_index}:{messages[-1].turn_index}"
        cached = await self.redis.get(cache_key)
        if cached:
            return CompressionResult.from_json(cached)

        # 构建压缩请求
        original_tokens = sum(m.token_count for m in messages)
        messages_text = "\n\n".join([
            f"{'学生' if m.role == 'user' else '老师'}: {m.content}"
            for m in messages
        ])

        prompt = f"""{instruction}

以下是需要压缩的对话内容：

{messages_text}

请生成摘要："""

        response = await self.llm_client.chat(
            model=model,
            messages=[
                {"role": "system", "content": "你是一个对话压缩助手。"},
                {"role": "user", "content": prompt}
            ],
            max_tokens=target_tokens + 100,  # 留一点余量
            temperature=0.1  # 低温度保证摘要忠实
        )

        summary_text = response.content
        summary_tokens = self.tokenizer.count(summary_text, model)

        # 提取关键事实
        key_facts = await self._extract_key_facts(summary_text, model)

        result = CompressionResult(
            text=summary_text,
            token_count=summary_tokens,
            original_token_count=original_tokens,
            compression_ratio=summary_tokens / original_tokens,
            key_facts=key_facts
        )

        # 写缓存
        await self.redis.setex(cache_key, 86400, result.to_json())

        # 写数据库
        await self._save_compression(conversation_id, user_id, messages, result, model)

        return result
```

### 5.4 多模型上下文窗口适配

```python
class ModelContextAdapter:
    """多模型上下文窗口适配器"""

    # 主流模型上下文窗口大小（输入Token）
    MODEL_CONTEXT_WINDOWS = {
        # OpenAI
        "gpt-4o":           {"input": 128000, "output": 16384},
        "gpt-4o-mini":      {"input": 128000, "output": 16384},
        "gpt-4-turbo":      {"input": 128000, "output": 4096},
        # Claude
        "claude-sonnet-4":  {"input": 200000, "output": 8192},
        "claude-haiku-3.5": {"input": 200000, "output": 8192},
        # 国产模型
        "deepseek-v3":      {"input": 64000,  "output": 8192},
        "qwen-max":         {"input": 32000,  "output": 8192},
        "glm-4":            {"input": 128000, "output": 4096},
        # 推理模型
        "o1":               {"input": 200000, "output": 100000},
        "deepseek-r1":      {"input": 64000,  "output": 8192},
    }

    def get_effective_context(
        self,
        model_name: str,
        scenario_code: str
    ) -> Tuple[int, int]:
        """
        获取模型在特定场景下的有效上下文大小
        返回: (effective_input_tokens, effective_output_tokens)
        """
        config = self.MODEL_CONTEXT_WINDOWS.get(model_name)
        if not config:
            # 未知模型，使用保守默认值
            self.logger.warning(f"Unknown model: {model_name}, using conservative defaults")
            return 8000, 2048

        input_limit = config["input"]
        output_limit = config["output"]

        # 场景级裁剪：某些场景不使用完整窗口
        scenario_limits = {
            "quick_qa":       {"input_cap": 8000},    # 快速问答不需要超长上下文
            "essay_grading":  {"input_cap": 32000},   # 作文批改限制
            "photo_solve":    {"input_cap": 16000},   # 拍题解析限制
        }

        scenario_cfg = scenario_limits.get(scenario_code, {})
        if "input_cap" in scenario_cfg:
            input_limit = min(input_limit, scenario_cfg["input_cap"])

        return input_limit, output_limit

    def adapt_segments_for_model(
        self,
        segments: List[ContextSegment],
        target_model: str,
        source_model: str = None
    ) -> List[ContextSegment]:
        """
        将上下文段从源模型适配到目标模型
        主要处理：Tokenizer差异、特殊Token格式、消息结构差异
        """
        adapted = []

        for seg in segments:
            # 重新计算Token数（不同模型Tokenizer不同）
            if source_model and source_model != target_model:
                seg.token_count = self.retokenize(seg.content, target_model)

            # 模型特定的格式适配
            seg = self._apply_model_specific_formatting(seg, target_model)

            adapted.append(seg)

        return adapted

    def retokenize(self, text: str, model_name: str) -> int:
        """使用目标模型的Tokenizer重新计算Token数"""
        # 中文字符约等于1.5 Token，英文约0.75 Token/word
        # 这里使用轻量级估算（实际使用tiktoken或模型对应Tokenizer）
        family = self._get_model_family(model_name)

        if family == "openai":
            # GPT系列使用cl100k_base或o200k_base
            return len(self.openai_encoder.encode(text))
        elif family == "anthropic":
            # Claude估算：中文1.3 Token/字，英文1.3 Token/word
            return self._estimate_anthropic_tokens(text)
        elif family == "chinese":
            # 国产模型中文Token效率更高
            return self._estimate_chinese_model_tokens(text, model_name)
        else:
            return self._estimate_generic_tokens(text)
```

---

## 6. 状态流转设计

### 6.1 上下文组装状态机

```
                    ┌──────────┐
                    │ RECEIVED │ ← 接收到组装请求
                    └────┬─────┘
                         │
                    ┌────▼─────┐
                    │ BUDGET_  │ ← 计算Token预算
                    │ CALCULATED│
                    └────┬─────┘
                         │
                    ┌────▼─────┐
                    │ SEGMENTS_│ ← 收集并分类上下文段
                    │ COLLECTED│
                    └────┬─────┘
                         │
                    ┌────▼─────┐
                    │ TOKENIZE_| ← 计算各段Token数
                    │ DONE     │
                    └────┬─────┘
                         │
              ┌──────────▼──────────┐
              │ total <= budget ?   │
              └──────┬───────┬──────┘
                     │ Yes   │ No
                     │       │
               ┌─────▼──┐ ┌──▼──────────┐
               │ ASSEMBLE│ │ TRIM_NEEDED │ ← 触发裁剪
               │ _DIRECT │ └──┬──────────┘
               └─────┬──┘    │
                     │  ┌────▼───────────┐
                     │  │ COMPRESSION_   │ ← 尝试压缩
                     │  │ ATTEMPTED      │
                     │  └────┬───┬───────┘
                     │       │   │
                     │  ┌────▼───▼───────┐
                     │  │ fits budget?   │
                     │  └──┬───────┬─────┘
                     │     │ Yes   │ No
                     │     │       │
                     │ ┌───▼──┐ ┌──▼──────────┐
                     │ │COMPRESS│ │ DP_TRIM     │ ← 动态规划裁剪
                     │ │_OK    │ │ _EXECUTED   │
                     │ └───┬──┘ └──┬──────────┘
                     │     │       │
                     └─────┴───────┘
                          │
                    ┌─────▼──────┐
                    │ ASSEMBLED  │ ← 最终组装完成
                    └─────┬──────┘
                          │
                    ┌─────▼──────┐
                    │ LOGGED     │ ← 记录裁剪日志
                    └────────────┘
```

### 6.2 压缩任务状态机

```
PENDING → PROCESSING → COMPLETED
              │              │
              │              ├→ CACHED (命中缓存)
              │              │
              ├→ FAILED ────→┐
              │              ├→ RETRY (最多3次)
              │              │
              └→ TIMEOUT ───→ FALLBACK (降级为简单截断)
```

---

## 7. 关键流程设计

### 7.1 AI辅导对话上下文组装完整流程

```python
class ContextAssemblyPipeline:
    """上下文组装管线"""

    async def assemble_for_ai_tutoring(
        self,
        request: ContextAssemblyRequest
    ) -> AssembledContext:
        """AI辅导场景的上下文组装"""

        # 1. 获取预算策略
        policy = await self.policy_service.get_policy(
            request.scenario_code,
            request.model_tier
        )

        # 2. 计算Token预算
        input_limit, output_limit = self.adapter.get_effective_context(
            request.model_name,
            request.scenario_code
        )
        budget = self.allocator.calculate_budget(
            request.model_name,
            request.scenario_code,
            request.model_tier,
            policy
        )

        # 3. 收集上下文段
        segments = []

        # 3a. 系统提示词（CRITICAL）
        system_prompt = await self.prompt_service.get_system_prompt(
            request.scenario_code,
            request.user_id
        )
        segments.append(ContextSegment(
            type=ContextSegmentType.SYSTEM_PROMPT,
            priority=SegmentPriority.CRITICAL,
            content=system_prompt,
            token_count=self.tokenizer.count(system_prompt, request.model_name),
            metadata={"compressible": False}
        ))

        # 3b. 安全护栏（CRITICAL）
        guardrails = self.guardrail_service.get_guardrails(
            request.user_id,
            "student"
        )
        segments.append(ContextSegment(
            type=ContextSegmentType.SAFETY_GUARDRAIL,
            priority=SegmentPriority.CRITICAL,
            content=guardrails,
            token_count=self.tokenizer.count(guardrails, request.model_name),
            metadata={"compressible": False}
        ))

        # 3c. 学生画像摘要（MEDIUM，可压缩）
        profile_summary = await self.profile_service.get_compact_summary(
            request.user_id,
            target_tokens=int(budget.effective_budget * 0.05)
        )
        segments.append(ContextSegment(
            type=ContextSegmentType.STUDENT_PROFILE,
            priority=SegmentPriority.MEDIUM,
            content=profile_summary,
            token_count=self.tokenizer.count(profile_summary, request.model_name),
            metadata={"compressible": True, "compressionRatio": 0.3}
        ))

        # 3d. 学科上下文（HIGH）
        subject_ctx = await self.subject_service.get_context(
            request.user_id,
            request.scenario_code
        )
        segments.append(ContextSegment(
            type=ContextSegmentType.SUBJECT_CONTEXT,
            priority=SegmentPriority.HIGH,
            content=subject_ctx,
            token_count=self.tokenizer.count(subject_ctx, request.model_name),
            metadata={"compressible": False}
        ))

        # 3e. RAG知识检索结果（HIGH/LOW，按相关性排序）
        rag_results = await self.rag_service.retrieve(
            query=request.user_query.text,
            user_id=request.user_id,
            subject="math",  # 根据场景确定
            top_k=5,
            max_tokens=int(budget.effective_budget * 0.25)
        )
        for idx, result in enumerate(rag_results):
            priority = SegmentPriority.HIGH if idx < 2 else SegmentPriority.LOW
            segments.append(ContextSegment(
                type=ContextSegmentType.RAG_KNOWLEDGE if idx < 2 else ContextSegmentType.RAG_EXAMPLES,
                priority=priority,
                content=result.content,
                token_count=result.token_count,
                metadata={
                    "relevanceScore": result.score,
                    "compressible": idx >= 2,
                    "compressionRatio": 0.4,
                    "source": result.doc_id
                }
            ))

        # 3f. 对话历史（MEDIUM/LOW，按轮次分层）
        history = await self.conversation_service.get_history(
            request.conversation_id,
            max_messages=50
        )
        for msg in history:
            turns_ago = len(history) // 2 - msg.turn_index
            priority = SegmentPriority.HIGH if turns_ago <= 2 else \
                       SegmentPriority.MEDIUM if turns_ago <= 5 else \
                       SegmentPriority.LOW
            segments.append(ContextSegment(
                type=ContextSegmentType.CONVERSATION_HISTORY,
                priority=priority,
                content=msg.content,
                token_count=msg.token_count,
                metadata={
                    "turnIndex": msg.turn_index,
                    "timestamp": msg.timestamp,
                    "compressible": turns_ago > 2,
                    "compressionRatio": 0.2 if turns_ago > 5 else 0.35
                }
            ))

        # 3g. 长期记忆关键事实（LOW）
        memory_facts = await self.memory_service.get_relevant_facts(
            request.user_id,
            request.user_query.text,
            max_facts=3
        )
        for fact in memory_facts:
            segments.append(ContextSegment(
                type=ContextSegmentType.LONG_TERM_MEMORY,
                priority=SegmentPriority.LOW,
                content=fact.content,
                token_count=fact.token_count,
                metadata={"compressible": True, "compressionRatio": 0.5}
            ))

        # 3h. 用户当前提问（CRITICAL）
        segments.append(ContextSegment(
            type=ContextSegmentType.USER_QUERY,
            priority=SegmentPriority.CRITICAL,
            content=request.user_query.text,
            token_count=self.tokenizer.count(request.user_query.text, request.model_name),
            metadata={"compressible": False}
        ))

        # 4. 按策略分配Token预算
        allocation = self.allocator.allocate_by_policy(budget, policy, segments)

        # 5. 检查是否需要压缩对话历史
        history_tokens = sum(
            s.token_count for s in segments
            if s.type == ContextSegmentType.CONVERSATION_HISTORY
        )
        if history_tokens > allocation.get("conversation_history", 0):
            # 异步触发对话历史压缩
            await self.compressor.maybe_compress(
                conversation_id=request.conversationId,
                user_id=request.user_id,
                history=[
                    Message(**self._segment_to_message(s))
                    for s in segments
                    if s.type == ContextSegmentType.CONVERSATION_HISTORY
                ],
                budget=budget,
                current_turn=max((s.metadata.turnIndex for s in segments if s.metadata.turnIndex), default=0)
            )
            # 用压缩结果替换原始对话历史段
            compressed = await self.compressor.get_latest_compression(request.conversationId)
            if compressed:
                segments = [
                    s for s in segments
                    if s.type != ContextSegmentType.CONVERSATION_HISTORY
                ]
                segments.append(ContextSegment(
                    type=ContextSegmentType.CONVERSATION_SUMMARY,
                    priority=SegmentPriority.MEDIUM,
                    content=compressed.summary_text,
                    token_count=compressed.summary_token_count,
                    metadata={"compressible": False}
                ))

        # 6. 执行裁剪决策
        trim_result = self.trim_engine.decide(segments, budget, allocation, policy)

        # 7. 组装最终messages数组
        messages = self._build_messages(trim_result.kept_segments + trim_result.compressed_segments)

        # 8. 记录日志
        await self._log_trim_decision(request, budget, trim_result)

        return AssembledContext(
            messages=messages,
            budget=budget,
            trim_report=trim_result.to_report()
        )

    def _build_messages(self, segments: List[ContextSegment]) -> List[Dict]:
        """将段列表转换为LLM API的messages格式"""
        messages = []
        for seg in segments:
            if seg.type == ContextSegmentType.SYSTEM_PROMPT:
                messages.append({"role": "system", "content": seg.content})
            elif seg.type == ContextSegmentType.SAFETY_GUARDRAIL:
                # 合并到system消息中
                if messages and messages[-1]["role"] == "system":
                    messages[-1]["content"] += "\n\n" + seg.content
                else:
                    messages.append({"role": "system", "content": seg.content})
            elif seg.type in (
                ContextSegmentType.STUDENT_PROFILE,
                ContextSegmentType.SUBJECT_CONTEXT,
                ContextSegmentType.RAG_KNOWLEDGE,
                ContextSegmentType.RAG_EXAMPLES,
                ContextSegmentType.CONVERSATION_SUMMARY,
                ContextSegmentType.LONG_TERM_MEMORY
            ):
                # 作为system消息注入（知识点上下文）
                messages.append({"role": "system", "content": seg.content})
            elif seg.type == ContextSegmentType.CONVERSATION_HISTORY:
                role = "user" if seg.metadata.get("role") == "user" else "assistant"
                messages.append({"role": role, "content": seg.content})
            elif seg.type == ContextSegmentType.USER_QUERY:
                messages.append({"role": "user", "content": seg.content})
        return messages
```

### 7.2 异步对话压缩触发流程

```python
class AsyncCompressionTrigger:
    """异步对话压缩触发器"""

    COMPRESSION_CHECK_TURNS = [3, 5, 8, 12, 18]  # 在这些轮次后检查压缩

    async def on_turn_completed(
        self,
        conversation_id: str,
        user_id: str,
        turn_number: int
    ):
        """每轮对话完成后检查是否需要异步压缩"""

        if turn_number not in self.COMPRESSION_CHECK_TURNS:
            return

        # 检查最近是否已有压缩任务
        recent_task = await self.task_store.get_latest_compression_task(conversation_id)
        if recent_task and recent_task.status == "processing":
            return  # 已有压缩在进行

        # 获取对话历史
        history = await self.conversation_service.get_history(
            conversation_id,
            max_messages=turn_number * 2
        )

        history_tokens = sum(msg.token_count for msg in history)

        # 只有历史超过阈值才触发
        if history_tokens < 3000:
            return

        # 提交异步压缩任务
        task = await self.task_queue.submit(
            task_type="conversation_compress",
            payload={
                "conversation_id": conversation_id,
                "user_id": user_id,
                "history": [msg.to_dict() for msg in history],
                "turn_range": {
                    "start": max(1, turn_number - 10),
                    "end": max(1, turn_number - 3)  # 压缩3轮之前的历史
                },
                "priority": "low"  # 低优先级，不抢占用户请求
            },
            delay_seconds=0,  # 立即执行（但优先级低）
            timeout_seconds=30
        )

        self.logger.info(
            "Triggered async compression",
            extra={
                "conversation_id": conversation_id,
                "turn_number": turn_number,
                "history_tokens": history_tokens,
                "task_id": task.id
            }
        )
```

---

## 8. 教育场景特化设计

### 8.1 教育价值评估矩阵

不同上下文段在不同教育场景下的价值权重不同：

```python
EDUCATIONAL_VALUE_MATRIX = {
    # segment_type: { scenario: weight }
    "conversation_history": {
        "ai_tutoring":      0.9,   # 多轮辅导对话中，历史很重要（需理解学生思路）
        "photo_solve":      0.2,   # 拍题解析中，历史不太重要（每次独立题目）
        "essay_grading":    0.1,   # 作文批改中，历史不重要
        "recitation":       0.7,   # 背诵检测中，需要知道之前背到哪了
        "science_solving":  0.5,   # 理科解题中，可能有多步骤关联
    },
    "rag_knowledge": {
        "ai_tutoring":      0.8,   # 辅导对话需要教材知识支撑
        "photo_solve":      0.9,   # 拍题解析高度依赖知识点检索
        "essay_grading":    0.4,   # 作文批改更依赖模型自身能力
        "recitation":       0.6,   # 背诵辅助需要原文对照
        "science_solving":  0.95,  # 理科解题高度依赖公式和定理
    },
    "student_profile": {
        "ai_tutoring":      0.7,   # 需要知道年级和认知水平
        "photo_solve":      0.5,   # 需要知道年级来调整解析深度
        "essay_grading":    0.6,   # 需要知道年级来调整批改标准
        "recitation":       0.4,
        "science_solving":  0.5,
    },
    "few_shot_exemplars": {
        "ai_tutoring":      0.3,   # 一般不需要示例
        "photo_solve":      0.5,   # 可以提供解题格式示例
        "essay_grading":    0.4,   # 可以提供评分标准示例
        "recitation":       0.1,   # 几乎不需要
        "science_solving":  0.6,   # 可以提供解题步骤示例
    },
    "long_term_memory": {
        "ai_tutoring":      0.6,   # 记住之前的讨论结论
        "photo_solve":      0.1,
        "essay_grading":    0.1,
        "recitation":       0.5,   # 记住之前背错的字
        "science_solving":  0.3,
    }
}
```

### 8.2 学科特化Token分配策略

```python
SUBJECT_SPECIFIC_ALLOCATION = {
    "mathematics": {
        # 数学需要更多Token给RAG（公式、定理检索）和解题步骤输出
        "rag_knowledge": 0.35,
        "conversation_history": 0.25,
        "output_reserve": 0.30,  # 数学解题需要较长输出
        "few_shot": 0.05,
    },
    "chinese_essay": {
        # 作文辅导需要更多Token给输入（学生作文全文）
        "user_content": 0.40,     # 学生作文内容
        "rag_knowledge": 0.15,    # 范文素材
        "conversation_history": 0.05,
        "output_reserve": 0.35,   # 批改建议需要较长输出
    },
    "english_listening": {
        # 英语听力需要Token给音频转写文本
        "user_content": 0.35,     # 听力原文
        "rag_knowledge": 0.15,
        "conversation_history": 0.20,
        "output_reserve": 0.25,
    },
    "recitation": {
        # 背诵检测需要Token给原文和检测结果
        "reference_text": 0.25,   # 标准原文
        "user_content": 0.25,     # 学生背诵语音转写
        "conversation_history": 0.20,
        "output_reserve": 0.15,
    }
}
```

### 8.3 答案管控与渐进式提示的Token适配

当答案管控引擎决定采用"渐进式提示"策略时，Token预算需要适配：

```python
class ProgressiveHintBudgetAdapter:
    """渐进式提示Token预算适配器"""

    BUDGET_BY_HINT_LEVEL = {
        "hint_level_1": {
            # 第一级：只给方向性提示
            "description": "方向提示",
            "output_reserve": 500,    # 提示很短
            "rag_knowledge": 0.15,    # 少量背景知识
            "few_shot": 0,            # 不需要示例
            "instruction": "给出方向性提示，不涉及具体解题步骤。回复控制在3句话以内。"
        },
        "hint_level_2": {
            # 第二级：给出解题思路框架
            "description": "思路提示",
            "output_reserve": 1000,
            "rag_knowledge": 0.25,
            "few_shot": 0.05,
            "instruction": "给出解题思路框架，说明每一步要做什么，但不给出具体计算过程。"
        },
        "hint_level_3": {
            # 第三级：给出部分解题过程
            "description": "部分解析",
            "output_reserve": 2000,
            "rag_knowledge": 0.30,
            "few_shot": 0.05,
            "instruction": "给出前两步详细过程，后续步骤留作思考。"
        },
        "hint_level_4": {
            # 第四级：完整解析
            "description": "完整解析",
            "output_reserve": 4000,
            "rag_knowledge": 0.30,
            "few_shot": 0.05,
            "instruction": "给出完整的分步解析，包含公式推导和最终答案。"
        },
        "full_detailed": {
            # 最高级：完整解析 + 知识点拓展 + 同类题推荐
            "description": "深度解析",
            "output_reserve": 6000,
            "rag_knowledge": 0.25,
            "few_shot": 0.10,
            "instruction": "完整解析 + 知识点总结 + 易错点提醒 + 1道同类练习题。"
        }
    }

    def adapt_budget_for_hint_level(
        self,
        base_budget: TokenBudget,
        hint_level: str
    ) -> TokenBudget:
        """根据提示等级调整Token预算"""
        config = self.BUDGET_BY_HINT_LEVEL[hint_level]

        adapted = TokenBudget(
            model_max_tokens=base_budget.model_max_tokens,
            reserved_for_output=config["output_reserve"],
            available_for_input=base_budget.model_max_tokens - config["output_reserve"],
            safety_margin=base_budget.safety_margin,
            effective_budget=base_budget.model_max_tokens - config["output_reserve"] - base_budget.safety_margin
        )

        return adapted
```

---

## 9. 错误处理与降级策略

### 9.1 错误码定义

| 错误码 | 含义 | 触发场景 | 处理策略 |
| --- | --- | --- | --- |
| `CTX_001` | Token 计算失败 | Tokenizer 异常 | 降级为字符数估算（字符数 × 1.2） |
| `CTX_002` | 预算策略未找到 | 场景码或模型层级未配置 | 使用默认策略（输入Token的70%为有效预算） |
| `CTX_003` | 上下文段收集超时 | 依赖服务（RAG、画像）超时 | 使用已有段继续组装，缺失段记录告警 |
| `CTX_004` | 压缩服务不可用 | 压缩模型调用失败 | 降级为简单截断（保留最近N轮） |
| `CTX_005` | 裁剪后仍超预算 | DP算法或Token估算偏差 | 强制截断：从低优先级段开始逐段丢弃 |
| `CTX_006` | 模型配置缺失 | 未知模型名称 | 使用默认 8K 上下文窗口 |
| `CTX_007` | 对话历史不可用 | 对话服务异常 | 跳过历史段，仅用RAG+当前提问 |

### 9.2 降级链路

```
正常流程: RAG检索 + 完整历史 + 画像 + 压缩摘要 → 智能裁剪 → 组装
    ↓ (RAG超时)
降级1: 简化RAG(单路检索) + 完整历史 + 画像 → 智能裁剪 → 组装
    ↓ (历史服务超时)
降级2: RAG + 无历史 + 画像 → 直接组装
    ↓ (画像服务超时)
降级3: RAG + 无历史 + 无画像 → 最小化组装
    ↓ (RAG也超时)
降级4: 仅系统提示 + 用户提问 → 直接发送
```

### 9.3 强制兜底逻辑

```python
class FallbackHandler:
    """兜底处理器"""

    async def emergency_assemble(
        self,
        system_prompt: str,
        user_query: str,
        model_name: str,
        error_context: dict
    ) -> List[Dict]:
        """
        最极端降级：仅保留系统提示和用户提问
        确保用户至少能获得AI回复（即使质量降低）
        """
        self.logger.error(
            "Emergency context assembly triggered",
            extra=error_context
        )

        # 告警
        await self.alert_service.send_alert(
            level="WARNING",
            title="上下文组装全链路降级",
            message=f"Request {error_context.get('request_id')} fell back to emergency mode",
            tags=["llm-context", "degradation"]
        )

        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_query}
        ]

    async def force_fit_budget(
        self,
        segments: List[ContextSegment],
        budget: int
    ) -> List[ContextSegment]:
        """
        强制裁剪到预算内：从最低优先级开始暴力丢弃
        """
        segments_sorted = sorted(
            segments,
            key=lambda s: (-s.priority.value, -(s.metadata.relevanceScore or 0))
        )

        kept = []
        total = 0
        for seg in segments_sorted:
            if total + seg.token_count <= budget:
                kept.append(seg)
                total += seg.token_count
            elif seg.priority == SegmentPriority.CRITICAL:
                # 关键段即使超预算也要保留（但标记溢出）
                kept.append(seg)
                total += seg.token_count
            # 非关键段直接丢弃

        return kept
```

---

## 10. 性能优化

### 10.1 Token 计算优化

```python
class FastTokenEstimator:
    """快速Token估算器"""

    # 缓存Token计算结果（相同内容不重复计算）
    _cache = {}  # LRU cache, maxsize=10000

    # 模型家族到估算参数的映射
    ESTIMATION_PARAMS = {
        "openai": {       # cl100k/o200k Tokenizer
            "chinese_chars_per_token": 0.6,    # 约1.5字符/Token
            "english_words_per_token": 0.75,   # 约1.3词/Token
            "punctuation_per_token": 0.3,
            "number_per_token": 0.3,
        },
        "anthropic": {    # Claude Tokenizer
            "chinese_chars_per_token": 0.75,
            "english_words_per_token": 0.75,
            "punctuation_per_token": 0.3,
            "number_per_token": 0.25,
        },
        "chinese_model": {  # 国产模型（中文更高效）
            "chinese_chars_per_token": 1.0,    # 约1字符/Token
            "english_words_per_token": 0.6,
            "punctuation_per_token": 0.5,
            "number_per_token": 0.3,
        },
    }

    def estimate_fast(self, text: str, model_family: str) -> int:
        """快速估算（< 0.1ms），用于实时决策"""
        cache_key = f"{hash(text)}:{model_family}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        params = self.ESTIMATION_PARAMS.get(model_family, self.ESTIMATION_PARAMS["openai"])

        # 快速字符分类统计
        chinese_count = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
        ascii_alpha = sum(1 for c in text if c.isascii() and c.isalpha())
        digits = sum(1 for c in text if c.isdigit())
        punctuation = sum(1 for c in text if c in '，。、；：？！""''（）【】《》—…·,.!?;:\'"()[]{},.')

        word_count = len(text.split())

        tokens = (
            chinese_count / params["chinese_chars_per_token"] +
            word_count / params["english_words_per_token"] +
            punctuation * params["punctuation_per_token"] +
            digits * params["number_per_token"]
        )

        result = max(1, int(tokens))
        self._cache[cache_key] = result
        return result

    def estimate_precise(self, text: str, model_name: str) -> int:
        """精确计算（1~5ms），用于最终验证"""
        # 使用tiktoken或模型对应的Tokenizer
        try:
            import tiktoken
            encoding = tiktoken.encoding_for_model(model_name)
            return len(encoding.encode(text))
        except Exception:
            return self.estimate_fast(text, self._get_family(model_name))
```

### 10.2 裁剪决策缓存

```python
class TrimDecisionCache:
    """裁剪决策缓存"""

    async def get_or_compute(
        self,
        cache_key: str,
        compute_fn: Callable,
        ttl: int = 300
    ) -> TrimResult:
        """
        对于相同的段集合和预算，复用裁剪决策
        缓存key = hash(sorted(segment_ids) + budget + policy_version)
        """
        cached = await self.redis.get(f"llm:trim:decision:{cache_key}")
        if cached:
            return TrimResult.from_json(cached)

        result = await compute_fn()
        await self.redis.setex(f"llm:trim:decision:{cache_key}", ttl, result.to_json())
        return result
```

### 10.3 性能基准

| 操作 | 目标延迟 | 说明 |
| --- | --- | --- |
| Token 预算计算 | < 1ms | 纯计算，无IO |
| 段 Token 估算（快速） | < 0.1ms/段 | 字符分类估算 |
| 段 Token 计算（精确） | < 3ms/段 | tiktoken 计算 |
| 裁剪决策（≤20段） | < 5ms | DP算法，段数有上限 |
| 裁剪决策（≤50段） | < 15ms | DP算法，需优化 |
| 对话压缩（异步） | < 3s | 小模型调用 |
| 完整组装流程 | < 20ms | 不含异步压缩 |

---

## 11. 监控与告警

### 11.1 核心指标

| 指标名 | 类型 | 说明 |
| --- | --- | --- |
| `llm_context_assembly_total` | Counter | 上下文组装请求总数 |
| `llm_context_assembly_duration_ms` | Histogram | 组装处理耗时分布 |
| `llm_context_trim_strategy_distribution` | Counter | 裁剪策略分布（none/trim/compress/hybrid） |
| `llm_context_original_tokens` | Histogram | 原始Token数分布 |
| `llm_context_final_tokens` | Histogram | 最终Token数分布 |
| `llm_context_compression_ratio` | Histogram | 压缩比分布 |
| `llm_context_budget_utilization` | Gauge | 预算利用率（final/effective） |
| `llm_context_trim_overflow_count` | Counter | 裁剪后仍超预算次数（异常） |
| `llm_context_compression_task_total` | Counter | 压缩任务总数 |
| `llm_context_compression_task_failed` | Counter | 压缩任务失败数 |
| `llm_context_compression_duration_ms` | Histogram | 压缩任务耗时 |
| `llm_context_fallback_triggered` | Counter | 降级触发次数 |

### 11.2 告警规则

```yaml
alerts:
  - name: 上下文组装耗时过高
    expr: histogram_quantile(0.95, llm_context_assembly_duration_ms) > 50
    for: 5m
    severity: WARNING
    message: "上下文组装P95耗时 > 50ms"

  - name: 裁剪后超预算比例过高
    expr: rate(llm_context_trim_overflow_count[5m]) / rate(llm_context_assembly_total[5m]) > 0.01
    for: 5m
    severity: CRITICAL
    message: "1%以上的请求裁剪后仍超预算，检查Tokenizer精度"

  - name: 压缩任务失败率过高
    expr: rate(llm_context_compression_task_failed[5m]) / rate(llm_context_compression_task_total[5m]) > 0.05
    for: 10m
    severity: WARNING
    message: "压缩任务失败率 > 5%"

  - name: 降级触发频繁
    expr: rate(llm_context_fallback_triggered[5m]) > 0.1
    for: 5m
    severity: WARNING
    message: "降级触发频率 > 0.1次/秒"
```

---

## 12. 与其他系统的集成

### 12.1 集成关系图

```
┌─────────────────────────────────────────────────────┐
│              AI辅导请求处理链路                        │
│                                                     │
│  用户请求                                             │
│    │                                                │
│    ▼                                                │
│  ┌──────────────┐                                   │
│  │ AI辅导策略引擎 │ ← 决策提示等级、模型选择           │
│  └──────┬───────┘                                   │
│         │                                           │
│         ▼                                           │
│  ┌──────────────────────────────────────┐           │
│  │     本引擎：Token预算分配与裁剪        │           │
│  │                                      │           │
│  │  ┌────────┐ ┌────────┐ ┌──────────┐ │           │
│  │  │预算计算 │ │段收集   │ │裁剪决策   │ │           │
│  │  └────────┘ └────────┘ └──────────┘ │           │
│  │       │           │          │       │           │
│  │       ▼           ▼          ▼       │           │
│  │  ┌─────────────────────────────┐    │           │
│  │  │     对话历史压缩服务          │    │           │
│  │  └─────────────────────────────┘    │           │
│  └──────────────────────────────────────┘           │
│         │                                           │
│         ▼                                           │
│  ┌──────────────┐                                   │
│  │ 大模型API调用  │ ← 安全过滤 → 流式输出 → 后处理   │
│  └──────────────┘                                   │
└─────────────────────────────────────────────────────┘
```

### 12.2 调用时序

```
AI辅导服务          本引擎           RAG服务    对话服务    画像服务    压缩服务
    │                 │                │          │          │          │
    │  assemble()     │                │          │          │          │
    │────────────────>│                │          │          │          │
    │                 │  retrieve()    │          │          │          │
    │                 │───────────────>│          │          │          │
    │                 │  results       │          │          │          │
    │                 │<───────────────│          │          │          │
    │                 │                │          │          │          │
    │                 │  get_history()            │          │          │
    │                 │───────────────────────────>│          │          │
    │                 │  history                  │          │          │
    │                 │<───────────────────────────│          │          │
    │                 │                                      │          │
    │                 │  get_profile()                                 │
    │                 │───────────────────────────────────────────────>│
    │                 │  profile                                        │
    │                 │<────────────────────────────────────────────────│
    │                 │                                                            │
    │                 │  maybe_compress()                                          │
    │                 │───────────────────────────────────────────────────────>│
    │                 │  compressed                                               │
    │                 │<────────────────────────────────────────────────────────│
    │                 │                                                            │
    │                 │  decide_trim()                                             │
    │                 │  (内部DP算法)                                               │
    │                 │                                                            │
    │  assembled ctx  │                                                            │
    │<────────────────│                                                            │
    │                 │                                                            │
    │  call LLM API   │                                                            │
    │─────────────────│--------------------------------------------------------->  │
```

---

## 13. 配置项汇总

```yaml
# Nacos配置中心: llm-context-engine.yaml
llm_context:
  # 默认预算策略
  default:
    output_reserve_ratio: 0.25
    safety_margin_ratio: 0.05
    max_cost_per_call: 10000

  # 场景覆盖
  scenarios:
    ai_tutoring:
      output_reserve_ratio: 0.15
      segment_allocation:
        system_prompt: 0.04
        student_profile: 0.05
        subject_context: 0.06
        rag_knowledge: 0.20
        conversation_history: 0.45
        long_term_memory: 0.05
        few_shot: 0.05
        output_format_spec: 0.05
      compression:
        trigger_turn: 8
        trigger_tokens: 6000
        recent_keep_turns: 3
        mid_range_turns: 5
        far_range_turns: 10
        summary_model: "gpt-4o-mini"

    photo_solve:
      output_reserve_ratio: 0.35
      segment_allocation:
        system_prompt: 0.05
        rag_knowledge: 0.40
        images_ocr: 0.15
        user_query: 0.05
      compression:
        trigger_turn: 3

    essay_grading:
      output_reserve_ratio: 0.30
      segment_allocation:
        system_prompt: 0.03
        user_content: 0.45
        rag_examples: 0.12
        output_format_spec: 0.05

  # Token估算
  token_estimation:
    use_precise: false              # 是否使用精确Tokenizer（true=精确但慢）
    cache_size: 10000               # Token计算缓存大小
    fallback_multiplier: 1.2        # 降级估算时的字符→Token系数

  # 裁剪DP算法
  trim:
    max_segments_for_dp: 30         # DP算法最大段数（超过则用贪心）
    force_fit_on_overflow: true     # 溢出时强制截断

  # 异步压缩
  compression:
    enabled: true
    model: "gpt-4o-mini"
    max_concurrent_tasks: 10        # 最大并发压缩任务数
    task_timeout_seconds: 30
    cache_ttl_seconds: 86400        # 压缩结果缓存24小时
    check_turns: [3, 5, 8, 12, 18]  # 在这些轮次检查压缩

  # 监控
  monitoring:
    log_every_request: false        # 是否记录每次请求日志（量大时关闭）
    sample_rate: 0.1                # 日志采样率
    alert_on_overflow: true         # 溢出时告警
```

---

## 14. 安全与合规

### 14.1 数据安全

1. **裁剪日志脱敏**：日志中的 `segment_details` 需对用户提问内容做截断处理（仅保留前100字符）。
2. **压缩摘要安全**：压缩生成过程中需经过安全过滤，避免将敏感信息压缩到摘要中。
3. **缓存失效**：用户注销或修改隐私设置时，需清除对应的压缩缓存和Token统计缓存。
4. **数据隔离**：多租户场景下，裁剪策略和压缩结果需按租户隔离。

### 14.2 教育合规

1. **答案管控联动**：当答案管控引擎决定提示等级时，本引擎必须适配对应等级的Token预算，确保不会因为Token预算过大导致模型输出超出等级限制的详细答案。
2. **适龄化适配**：学生画像中的年龄/学段信息必须包含在 CRITICAL 段中，确保模型始终输出适龄内容。
3. **内容安全过滤联动**：安全过滤指令始终作为 CRITICAL 段注入，不可被裁剪。

---

## 15. 开发任务分解

| 任务 | 工作量 | 优先级 | 依赖 |
| --- | --- | --- | --- |
| Token预算计算器 + 场景策略配置 | 3天 | P0 | 无 |
| 上下文段收集器（各类型段适配） | 5天 | P0 | 预算计算器 |
| 快速Token估算器 | 2天 | P0 | 无 |
| 裁剪决策引擎（DP算法） | 4天 | P0 | 段收集器、估算器 |
| 对话历史分层压缩服务 | 5天 | P1 | 小模型API接入 |
| 多模型上下文窗口适配器 | 2天 | P1 | 各模型Tokenizer |
| 裁剪日志记录 + 监控指标 | 2天 | P1 | 裁剪引擎 |
| 降级兜底处理 | 2天 | P1 | 裁剪引擎 |
| 管理后台预算策略管理页面 | 3天 | P2 | 策略API |
| 裁剪效果分析统计报表 | 3天 | P2 | 日志数据积累 |
| 渐进式提示预算适配 | 2天 | P2 | 答案管控引擎对接 |
| 学科特化分配策略 | 3天 | P2 | 基础裁剪引擎 |

**总预估：约36人天**

---

## 16. 附录

### 16.1 默认场景策略完整配置

```json
{
  "scenarios": {
    "ai_tutoring": {
      "description": "AI智能辅导对话",
      "model_tiers": {
        "premium": {
          "model_examples": ["gpt-4o", "claude-sonnet-4"],
          "model_max_tokens": 128000,
          "output_reserve_ratio": 0.15,
          "safety_margin_ratio": 0.03,
          "segment_allocation": {
            "system_prompt": 0.02,
            "safety_guardrail": 0.01,
            "student_profile": 0.03,
            "subject_context": 0.04,
            "rag_knowledge": 0.15,
            "conversation_history": 0.50,
            "long_term_memory": 0.05,
            "few_shot": 0.05,
            "output_format_spec": 0.05
          }
        },
        "standard": {
          "model_examples": ["gpt-4o-mini", "qwen-max"],
          "model_max_tokens": 32000,
          "output_reserve_ratio": 0.15,
          "safety_margin_ratio": 0.05,
          "segment_allocation": {
            "system_prompt": 0.04,
            "safety_guardrail": 0.01,
            "student_profile": 0.05,
            "subject_context": 0.06,
            "rag_knowledge": 0.20,
            "conversation_history": 0.45,
            "long_term_memory": 0.04,
            "few_shot": 0.05,
            "output_format_spec": 0.05
          }
        },
        "economy": {
          "model_examples": ["deepseek-v3", "glm-4"],
          "model_max_tokens": 16000,
          "output_reserve_ratio": 0.20,
          "safety_margin_ratio": 0.05,
          "segment_allocation": {
            "system_prompt": 0.05,
            "safety_guardrail": 0.02,
            "student_profile": 0.05,
            "subject_context": 0.08,
            "rag_knowledge": 0.25,
            "conversation_history": 0.35,
            "long_term_memory": 0.03,
            "few_shot": 0.02,
            "output_format_spec": 0.05
          }
        }
      }
    },
    "photo_solve": {
      "description": "拍照搜题解析",
      "model_tiers": {
        "standard": {
          "model_max_tokens": 16000,
          "output_reserve_ratio": 0.35,
          "safety_margin_ratio": 0.03,
          "segment_allocation": {
            "system_prompt": 0.03,
            "safety_guardrail": 0.02,
            "rag_knowledge": 0.30,
            "rag_examples": 0.15,
            "images_ocr": 0.10,
            "few_shot": 0.05
          }
        }
      }
    }
  }
}
```

### 16.2 Token估算参考表

| 内容类型 | 中文Token估算 | 英文Token估算 | 说明 |
| --- | --- | --- | --- |
| 100个汉字 | ~167 Token | - | OpenAI cl100k |
| 100个英文单词 | - | ~130 Token | OpenAI cl100k |
| 100个汉字 | ~100 Token | - | 国产模型(通义千问) |
| 数学公式（LaTeX） | ~50-200 Token | - | 如 $\frac{-b\pm\sqrt{b^2-4ac}}{2a}$ ≈ 50 Token |
| 一轮对话（问+答） | 500-2000 Token | - | 视内容复杂度 |
| 系统提示词模板 | 200-800 Token | - | 视场景复杂度 |
| RAG知识点片段 | 100-500 Token | - | 单个知识点检索片段 |

---

## 文档信息

| 项 | 值 |
| --- | --- |
| 文档版本 | v1.0 |
| 创建日期 | 2026-08-02 |
| 模块负责人 | 待定 |
| 关联模块 | AI对话引擎、RAG检索系统、Prompt编排系统、答案管控引擎、多模型调度系统 |
| 评审状态 | 待评审 |
