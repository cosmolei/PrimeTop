# AI 模型上下文管理与对话记忆引擎 - 详细设计

> 模块负责人：AI 工程组  
> 最后更新：2026-05-24  
> 状态：待评审

---

## 1. 概述

### 1.1 问题定义

LLM 的上下文窗口有限（8K~1M tokens），而学习场景天然存在多轮对话、跨天复习、长期学习记录等需求。如果每次请求都发送完整历史，会导致：

- **Token 超限**：超出模型上下文窗口，请求被拒绝或截断
- **成本失控**：输入 token 按 token 计费，重复发送历史浪费成本
- **质量下降**：过长上下文导致模型"遗忘"关键信息，回答偏题
- **响应延迟**：输入越长，首 token 延迟越高

### 1.2 目标

1. **精准控制上下文窗口预算**：确保每次 LLM 调用的 token 数在模型限制内
2. **保留关键学习上下文**：优先保留对当前回答最有价值的信息
3. **支持跨会话记忆**：将长期学习状态浓缩为可检索的记忆片段
4. **成本透明**：每次调用的 token 预算可预测、可审计
5. **模型无关**：适配不同上下文窗口大小的模型（GPT-4o 128K、Claude 200K、Qwen 32K 等）

### 1.3 范围

本引擎负责从原始对话历史到最终拼装 Prompt 的全部处理链路，是 AI 对话引擎与底层模型调用之间的核心中间层。

```
用户输入 → 意图识别 → [本引擎] → 完整 Prompt → 模型调用
                         ↑
              上下文预算分配 / 记忆检索 / 历史压缩
```

---

## 2. 核心概念

### 2.1 术语表

| 术语 | 含义 |
|------|------|
| Context Window | 模型单次请求允许的最大 token 数（输入 + 输出） |
| Token Budget | 单次请求中可用于填充内容的 token 预算（= 上下文窗口 - 输出预留 - 系统提示） |
| Message History | 原始对话消息列表（用户/AI 轮流） |
| Context Block | 经过处理的可插入 Prompt 的上下文片段，携带优先级和 token 估算 |
| Memory Fragment | 从历史对话中提取的结构化知识片段，存储于长期记忆库 |
| Context Plan | 一次 LLM 调用前的上下文组装计划，定义各 Block 的预算分配 |

### 2.2 Token 估算模型

精确 token 计数依赖模型特定分词器，在线上我们采用双层策略：

```python
class TokenEstimator:
    """Token 估算器：快速估算 + 懒精确"""
    
    # 平均字符/token 比率（中文约 1.5 字符/token，英文约 4 字符/token）
    CHAR_TOKEN_RATIO_ZH = 1.5
    CHAR_TOKEN_RATIO_EN = 4.0
    
    def __init__(self, precise_tokenizer: Optional[Callable] = None):
        self._tokenizer = precise_tokenizer  # tiktoken / transformers tokenizer
    
    def estimate(self, text: str) -> int:
        """快速估算（用于预算规划阶段）"""
        # 简化：中文占比高的场景取 1.5，混合场景取 2.0
        char_count = len(text)
        estimated = int(char_count / 2.0)
        return max(estimated, 1)
    
    def count_precise(self, text: str, model: str) -> int:
        """精确计数（用于最终拼装验证）"""
        if self._tokenizer is None:
            return self.estimate(text)
        return self._tokenizer(text, model)
```

---

## 3. 架构设计

### 3.1 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                     ContextManager (入口)                        │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ BudgetPlan- │  │ ContextAssem-│  │ MemoryRetriever          │ │
│  │ ner         │  │ bler         │  │ ┌──────┐ ┌─────────────┐ │ │
│  │             │  │              │  │ │短期记忆│ │长期记忆检索  │ │ │
│  │ 模型规格    │  │ 优先级排序   │  │ │(Redis)│ │(PG+向量)    │ │ │
│  │ 预算分配    │  │ 截断/压缩    │  │ └──────┘ └─────────────┘ │ │
│  │ 约束校验    │  │ 最终拼装     │  └──────────────────────────┘ │
│  └────────────┘  └──────────────┘                                │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ HistoryProc-│  │ MemoryExtra- │  │ ContextCache             │ │
│  │ essor       │  │ ctor         │  │ 相同上下文缓存结果       │ │
│  │             │  │              │  └──────────────────────────┘ │
│  │ 历史压缩    │  │ 对话摘要     │                                │
│  │ 关键轮提取  │  │ 实体提取     │                                │
│  │ 关键词标注  │  │ 知识点关联   │                                │
│  └────────────┘  └──────────────┘                                │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 模块职责

| 模块 | 职责 |
|------|------|
| **BudgetPlanner** | 根据目标模型规格、系统提示长度、输出预留，计算可用 Token Budget |
| **HistoryProcessor** | 处理原始对话历史：压缩、截断、关键轮提取 |
| **MemoryExtractor** | 从对话中提取结构化记忆片段，写入长期记忆库 |
| **MemoryRetriever** | 根据当前问题检索相关记忆片段 |
| **ContextAssembler** | 按优先级将各 Context Block 拼装为最终 Prompt，确保不超预算 |
| **ContextCache** | 缓存相同上下文的拼装结果，避免重复计算 |

---

## 4. 数据结构定义

### 4.1 模型规格表

```python
# modelspec.py

from dataclasses import dataclass
from enum import Enum

class ModelProvider(str, Enum):
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    ZHIPU = "zhipu"
    QWEN = "qwen"
    DEEPSEEK = "deepseek"
    BAIDU = "baidu"

@dataclass(frozen=True)
class ModelSpec:
    """模型上下文规格"""
    model_id: str              # "gpt-4o", "claude-3.5-sonnet", "qwen-max"
    provider: ModelProvider
    context_window: int        # 总上下文窗口 token 数
    max_output: int            # 最大输出 token 数
    system_prompt_overhead: int  # 系统提示固定开销（含格式标记）
    
    @property
    def available_budget(self) -> int:
        """可用于填充内容的 token 预算"""
        return self.context_window - self.max_output - self.system_prompt_overhead

# 模型规格注册表
MODEL_SPECS: dict[str, ModelSpec] = {
    "gpt-4o":           ModelSpec("gpt-4o",           ModelProvider.OPENAI,    128000, 16384, 50),
    "gpt-4o-mini":      ModelSpec("gpt-4o-mini",      ModelProvider.OPENAI,    128000, 16384, 50),
    "claude-3.5-sonnet": ModelSpec("claude-3.5-sonnet", ModelProvider.ANTHROPIC, 200000, 8192,  50),
    "claude-3-haiku":    ModelSpec("claude-3-haiku",    ModelProvider.ANTHROPIC, 200000, 4096,  50),
    "qwen-max":          ModelSpec("qwen-max",          ModelProvider.QWEN,     32000,  8192,  50),
    "qwen-plus":         ModelSpec("qwen-plus",         ModelProvider.QWEN,     131072, 8192,  50),
    "glm-4":             ModelSpec("glm-4",             ModelProvider.ZHIPU,    128000, 4096,  50),
    "deepseek-v3":       ModelSpec("deepseek-v3",       ModelProvider.DEEPSEEK, 65536,  8192,  50),
    "ernie-4.0":         ModelSpec("ernie-4.0",         ModelProvider.BAIDU,    128000, 4096,  50),
}
```

### 4.2 上下文块（Context Block）

```python
# context_block.py

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
import time

class BlockType(str, Enum):
    """上下文块类型"""
    SYSTEM_PROMPT = "system_prompt"        # 系统提示（固定）
    RAG_KNOWLEDGE = "rag_knowledge"        # RAG 检索结果
    MEMORY_FRAGMENT = "memory_fragment"    # 长期记忆片段
    CONVERSATION_RECENT = "conv_recent"    # 最近 N 轮对话（原文）
    CONVERSATION_SUMMARY = "conv_summary"  # 历史对话摘要
    USER_PROFILE = "user_profile"          # 用户画像/学段信息
    TASK_CONTEXT = "task_context"          # 当前任务上下文（错题/练习等）
    SAFETY_GUARD = "safety_guard"          # 安全护栏提示

class Priority(int, Enum):
    """优先级：数值越高越不容易被裁剪"""
    CRITICAL = 100    # 系统提示、安全护栏 — 不可裁剪
    HIGH = 80         # 用户画像、当前任务上下文
    MEDIUM = 60       # RAG 知识、相关记忆
    LOW = 40          # 最近对话历史（可压缩）
    DISPOSABLE = 20   # 对话摘要、扩展背景

@dataclass
class ContextBlock:
    """上下文块"""
    block_id: str                              # 唯一标识
    block_type: BlockType                      # 类型
    priority: Priority                         # 优先级
    content: str                               # 文本内容
    token_count: int = 0                       # token 数（估算）
    source: Optional[str] = None               # 来源标识（用于调试）
    compressible: bool = True                  # 是否可压缩
    min_retain_ratio: float = 0.0              # 最少保留比例（0=可完全丢弃）
    metadata: dict = field(default_factory=dict)  # 扩展元数据
    created_at: float = field(default_factory=time.time)
    
    def effective_priority(self) -> int:
        """有效优先级（考虑最小保留约束）"""
        return self.priority.value
```

### 4.3 上下文计划（Context Plan）

```python
# context_plan.py

from dataclasses import dataclass, field
from typing import List, Optional
from .context_block import ContextBlock

@dataclass
class ContextPlan:
    """一次 LLM 调用的上下文组装计划"""
    plan_id: str                          # 计划 ID（用于追踪）
    model_id: str                         # 目标模型
    total_budget: int                     # 总 token 预算
    blocks: List[ContextBlock] = field(default_factory=list)
    allocated_tokens: int = 0             # 已分配 token
    remaining_budget: int = 0             # 剩余预算
    
    # 预算分配方案（初始建议）
    allocation_strategy: dict = field(default_factory=dict)
    
    def add_block(self, block: ContextBlock) -> bool:
        """添加一个块，检查是否超出预算"""
        if self.allocated_tokens + block.token_count <= self.total_budget:
            self.blocks.append(block)
            self.allocated_tokens += block.token_count
            self.remaining_budget = self.total_budget - self.allocated_tokens
            return True
        return False
    
    def get_blocks_by_type(self, block_type: str) -> List[ContextBlock]:
        return [b for b in self.blocks if b.block_type.value == block_type]
    
    def sort_by_priority(self) -> List[ContextBlock]:
        """按优先级降序排列（高优先级在前，不易被裁剪）"""
        return sorted(self.blocks, key=lambda b: b.effective_priority(), reverse=True)
```

### 4.4 记忆片段（Memory Fragment）

```python
# memory_fragment.py

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional
import time

class MemoryType(str, Enum):
    """记忆类型"""
    CONVERSATION_SUMMARY = "conv_summary"       # 对话摘要
    KNOWLEDGE_POINT = "knowledge_point"         # 已学习知识点
    MISTAKE_PATTERN = "mistake_pattern"          # 错题模式
    LEARNING_PREFERENCE = "learning_preference"  # 学习偏好
    WEAKNESS = "weakness"                        # 薄弱点
    GOAL = "goal"                                # 学习目标

@dataclass
class MemoryFragment:
    """长期记忆片段"""
    fragment_id: str                        # 唯一 ID
    user_id: str                            # 用户 ID
    memory_type: MemoryType                 # 记忆类型
    title: str                              # 标题（用于检索展示）
    content: str                            # 内容
    summary: str                            # 简短摘要（用于上下文插入）
    keywords: List[str] = field(default_factory=list)  # 关键词
    subject: Optional[str] = None           # 学科
    grade: Optional[str] = None             # 年级
    knowledge_points: List[str] = field(default_factory=list)  # 关联知识点
    embedding: Optional[List[float]] = None  # 向量嵌入
    source_conversation_id: Optional[str] = None  # 来源对话 ID
    relevance_score: float = 0.0            # 相关性得分
    access_count: int = 0                   # 访问次数
    last_accessed_at: Optional[float] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    expires_at: Optional[float] = None      # 过期时间（如学期结束）
```

### 4.5 数据库 Schema

```sql
-- 长期记忆片段表
CREATE TABLE memory_fragments (
    fragment_id     VARCHAR(36) PRIMARY KEY,          -- UUID
    user_id         VARCHAR(36) NOT NULL,             -- 用户 ID
    memory_type     VARCHAR(32) NOT NULL,             -- conv_summary/knowledge_point/...
    title           VARCHAR(200) NOT NULL,            -- 标题
    content         TEXT NOT NULL,                     -- 完整内容
    summary         VARCHAR(500) NOT NULL,            -- 简短摘要（用于上下文插入）
    keywords        JSON NOT NULL DEFAULT '[]',       -- 关键词列表
    subject         VARCHAR(20),                      -- 学科
    grade           VARCHAR(20),                      -- 年级
    knowledge_points JSON NOT NULL DEFAULT '[]',      -- 关联知识点 ID 列表
    source_conversation_id VARCHAR(36),               -- 来源对话 ID
    access_count    INT NOT NULL DEFAULT 0,           -- 访问次数
    last_accessed_at TIMESTAMPTZ,                     -- 最后访问时间
    expires_at      TIMESTAMPTZ,                      -- 过期时间
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_memory_user_type ON memory_fragments(user_id, memory_type);
CREATE INDEX idx_memory_subject_grade ON memory_fragments(user_id, subject, grade);
CREATE INDEX idx_memory_keywords ON memory_fragments USING gin(keywords jsonb_path_ops);
CREATE INDEX idx_memory_expires ON memory_fragments(expires_at) WHERE expires_at IS NOT NULL;

-- 向量索引（pgvector）
-- embedding 字段通过 Milvus 管理，此处仅存 fragment_id 映射

-- 对话摘要缓存表（避免重复摘要）
CREATE TABLE conversation_summaries (
    conversation_id  VARCHAR(36) PRIMARY KEY,
    user_id          VARCHAR(36) NOT NULL,
    summary_text     TEXT NOT NULL,                   -- 摘要文本
    covered_rounds   INT NOT NULL,                    -- 摘要覆盖的轮数
    key_topics       JSON NOT NULL DEFAULT '[]',      -- 关键话题
    token_count      INT NOT NULL,                    -- 摘要 token 数
    model_used       VARCHAR(50) NOT NULL,            -- 生成摘要的模型
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conv_summary_user ON conversation_summaries(user_id);

-- 上下文使用日志（用于审计和优化）
CREATE TABLE context_usage_logs (
    log_id           BIGSERIAL PRIMARY KEY,
    user_id          VARCHAR(36) NOT NULL,
    conversation_id  VARCHAR(36) NOT NULL,
    model_id         VARCHAR(50) NOT NULL,
    plan_id          VARCHAR(36) NOT NULL,
    total_budget     INT NOT NULL,                    -- 总预算
    allocated_tokens INT NOT NULL,                    -- 实际分配
    block_count      INT NOT NULL,                    -- 块数量
    block_breakdown  JSON NOT NULL,                   -- 各块 token 明细
    compression_used BOOLEAN NOT NULL DEFAULT FALSE,  -- 是否使用了压缩
    memory_hits      INT NOT NULL DEFAULT 0,          -- 记忆命中数
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_context_log_user ON context_usage_logs(user_id, created_at DESC);
CREATE INDEX idx_context_log_model ON context_usage_logs(model_id, created_at DESC);
```

---

## 5. 核心流程

### 5.1 上下文组装主流程

```python
# context_manager.py

import uuid
import logging
from typing import List, Optional, Tuple
from .modelspec import MODEL_SPECS, ModelSpec
from .context_block import ContextBlock, BlockType, Priority
from .context_plan import ContextPlan
from .token_estimator import TokenEstimator
from .history_processor import HistoryProcessor
from .memory_retriever import MemoryRetriever
from .memory_extractor import MemoryExtractor
from .context_assembler import ContextAssembler
from .context_cache import ContextCache

logger = logging.getLogger(__name__)


class ContextManager:
    """AI 模型上下文管理引擎 — 主入口"""
    
    def __init__(
        self,
        token_estimator: TokenEstimator,
        history_processor: HistoryProcessor,
        memory_retriever: MemoryRetriever,
        memory_extractor: MemoryExtractor,
        context_assembler: ContextAssembler,
        context_cache: ContextCache,
    ):
        self._estimator = token_estimator
        self._history = history_processor
        self._memory_retriever = memory_retriever
        self._memory_extractor = memory_extractor
        self._assembler = context_assembler
        self._cache = context_cache
    
    async def build_context(
        self,
        user_id: str,
        conversation_id: str,
        current_message: str,
        model_id: str,
        scene_type: str,               # 场景：ai_tutor / photo_search / essay / ...
        system_prompt: str,            # 场景系统提示
        rag_results: Optional[List[str]] = None,   # RAG 检索结果
        task_context: Optional[str] = None,        # 当前任务上下文
    ) -> Tuple[List[dict], ContextPlan]:
        """
        组装完整的 LLM 调用上下文。
        
        返回:
            (messages, plan) — 可直接传给模型 SDK 的 messages 列表 + 上下文计划
        """
        # 1. 查缓存
        cache_key = self._cache.make_key(user_id, conversation_id, current_message, model_id)
        cached = await self._cache.get(cache_key)
        if cached:
            return cached
        
        # 2. 获取模型规格
        spec = MODEL_SPECS.get(model_id)
        if not spec:
            raise ValueError(f"Unknown model: {model_id}")
        
        # 3. 创建上下文计划
        plan = ContextPlan(
            plan_id=str(uuid.uuid4()),
            model_id=model_id,
            total_budget=spec.available_budget,
        )
        
        # 4. 收集各类型 Context Block
        blocks: List[ContextBlock] = []
        
        # 4.1 系统提示（CRITICAL，不可裁剪）
        blocks.append(ContextBlock(
            block_id=f"sys_{conversation_id}",
            block_type=BlockType.SYSTEM_PROMPT,
            priority=Priority.CRITICAL,
            content=system_prompt,
            token_count=self._estimator.estimate(system_prompt),
            compressible=False,
            min_retain_ratio=1.0,
        ))
        
        # 4.2 安全护栏（CRITICAL）
        safety_text = self._get_safety_guard(scene_type)
        blocks.append(ContextBlock(
            block_id=f"safety_{conversation_id}",
            block_type=BlockType.SAFETY_GUARD,
            priority=Priority.CRITICAL,
            content=safety_text,
            token_count=self._estimator.estimate(safety_text),
            compressible=False,
            min_retain_ratio=1.0,
        ))
        
        # 4.3 用户画像（HIGH）
        profile_text = await self._get_user_profile_context(user_id)
        if profile_text:
            blocks.append(ContextBlock(
                block_id=f"profile_{user_id}",
                block_type=BlockType.USER_PROFILE,
                priority=Priority.HIGH,
                content=profile_text,
                token_count=self._estimator.estimate(profile_text),
                compressible=False,
                min_retain_ratio=1.0,
            ))
        
        # 4.4 任务上下文（HIGH）
        if task_context:
            blocks.append(ContextBlock(
                block_id=f"task_{conversation_id}",
                block_type=BlockType.TASK_CONTEXT,
                priority=Priority.HIGH,
                content=task_context,
                token_count=self._estimator.estimate(task_context),
                compressible=False,
                min_retain_ratio=1.0,
            ))
        
        # 4.5 RAG 知识（MEDIUM）
        if rag_results:
            rag_text = self._format_rag_results(rag_results)
            blocks.append(ContextBlock(
                block_id=f"rag_{conversation_id}",
                block_type=BlockType.RAG_KNOWLEDGE,
                priority=Priority.MEDIUM,
                content=rag_text,
                token_count=self._estimator.estimate(rag_text),
                compressible=True,
                min_retain_ratio=0.3,
            ))
        
        # 4.6 长期记忆（MEDIUM）
        memory_blocks = await self._memory_retriever.retrieve(
            user_id=user_id,
            query=current_message,
            scene_type=scene_type,
            max_fragments=5,
        )
        for i, frag in enumerate(memory_blocks):
            blocks.append(ContextBlock(
                block_id=f"mem_{frag.fragment_id}",
                block_type=BlockType.MEMORY_FRAGMENT,
                priority=Priority.MEDIUM,
                content=f"[学习记忆] {frag.summary}",
                token_count=self._estimator.estimate(frag.summary),
                compressible=True,
                min_retain_ratio=0.0,
                metadata={"fragment_id": frag.fragment_id},
            ))
        
        # 4.7 对话历史（LOW / DISPOSABLE）
        history_blocks = await self._history.process(
            conversation_id=conversation_id,
            current_message=current_message,
            model_spec=spec,
            estimator=self._estimator,
        )
        blocks.extend(history_blocks)
        
        # 5. 组装：按优先级排序，在预算内填充
        plan.blocks = blocks
        messages = self._assembler.assemble(plan)
        
        # 6. 异步提取记忆（不阻塞当前请求）
        # 使用事件总线触发，不在此 await
        self._schedule_memory_extraction(
            user_id, conversation_id, current_message
        )
        
        # 7. 缓存结果
        await self._cache.set(cache_key, (messages, plan), ttl=300)
        
        logger.info(
            "Context assembled: plan=%s model=%s budget=%d allocated=%d blocks=%d",
            plan.plan_id, model_id, plan.total_budget, plan.allocated_tokens, len(plan.blocks)
        )
        
        return messages, plan
    
    def _get_safety_guard(self, scene_type: str) -> str:
        """获取安全护栏提示"""
        return (
            "【安全规范】你是一个教育辅助工具。请遵守以下规则：\n"
            "1. 只回答学习相关问题，拒绝非学习请求\n"
            "2. 不直接给出完整答案，优先引导思路\n"
            "3. 内容适龄化，根据学生年级调整表达\n"
            "4. 不输出暴力、色情、政治敏感内容\n"
        )
    
    def _schedule_memory_extraction(self, user_id: str, conv_id: str, msg: str):
        """异步调度记忆提取（通过事件总线）"""
        # 实际通过 Celery 或进程内事件总线触发
        pass
```

### 5.2 历史处理流程（HistoryProcessor）

```python
# history_processor.py

import logging
from typing import List, Optional, Tuple
from dataclasses import dataclass
from .modelspec import ModelSpec
from .context_block import ContextBlock, BlockType, Priority
from .token_estimator import TokenEstimator

logger = logging.getLogger(__name__)

# 历史消息类型
@dataclass
class HistoryMessage:
    role: str          # "user" | "assistant" | "system"
    content: str
    round_index: int   # 对话轮次（从 1 开始）
    token_count: int
    is_key_round: bool = False   # 是否为关键轮（含重要知识点/解题转折）
    topics: List[str] = None     # 涉及话题


class HistoryProcessor:
    """对话历史处理器：压缩、截断、关键轮提取"""
    
    # 不同场景下的历史保留策略
    SCENE_STRATEGIES = {
        "ai_tutor": {"recent_rounds": 10, "max_history_ratio": 0.4},
        "photo_search": {"recent_rounds": 3, "max_history_ratio": 0.2},
        "essay": {"recent_rounds": 15, "max_history_ratio": 0.5},
        "recitation": {"recent_rounds": 8, "max_history_ratio": 0.3},
        "science_solve": {"recent_rounds": 10, "max_history_ratio": 0.4},
        "exam_sim": {"recent_rounds": 20, "max_history_ratio": 0.6},
    }
    
    def __init__(self, conversation_repo, summary_service):
        self._repo = conversation_repo
        self._summary = summary_service
    
    async def process(
        self,
        conversation_id: str,
        current_message: str,
        model_spec: ModelSpec,
        estimator: TokenEstimator,
    ) -> List[ContextBlock]:
        """
        处理对话历史，返回一组 Context Block。
        
        策略：
        1. 最近 N 轮保留原文（CONVERSATION_RECENT, LOW priority）
        2. 更早的轮次生成摘要（CONVERSATION_SUMMARY, DISPOSABLE priority）
        3. 如果摘要也放不下，按时间远近从旧到新裁剪摘要
        """
        # 加载对话历史
        history = await self._repo.get_messages(conversation_id)
        if not history:
            return []
        
        # 标注关键轮（含解题转折、知识点确认等）
        history = self._annotate_key_rounds(history)
        
        # 获取场景策略
        strategy = self.SCENE_STRATEGIES.get(
            "ai_tutor", self.SCENE_STRATEGIES["ai_tutor"]
        )
        
        # 计算历史可用预算
        max_history_tokens = int(model_spec.available_budget * strategy["max_history_ratio"])
        recent_round_count = strategy["recent_rounds"]
        
        blocks: List[ContextBlock] = []
        
        # 分割：最近 N 轮 vs 早期轮次
        recent, early = self._split_history(history, recent_round_count)
        
        # 处理最近 N 轮（保留原文，关键轮提升优先级）
        recent_tokens = 0
        for msg in reversed(recent):  # 从最新到最旧
            priority = Priority.LOW if not msg.is_key_round else Priority.MEDIUM
            block = ContextBlock(
                block_id=f"hist_{conversation_id}_r{msg.round_index}",
                block_type=BlockType.CONVERSATION_RECENT,
                priority=priority,
                content=f"{msg.role}: {msg.content}",
                token_count=msg.token_count,
                compressible=not msg.is_key_round,
                min_retain_ratio=1.0 if msg.is_key_round else 0.0,
                metadata={"round_index": msg.round_index, "is_key": msg.is_key_round},
            )
            blocks.append(block)
            recent_tokens += msg.token_count
        
        # 处理早期轮次（生成/获取摘要）
        if early:
            summary = await self._get_or_create_summary(conversation_id, early)
            if summary:
                summary_tokens = estimator.estimate(summary)
                blocks.append(ContextBlock(
                    block_id=f"summary_{conversation_id}",
                    block_type=BlockType.CONVERSATION_SUMMARY,
                    priority=Priority.DISPOSABLE,
                    content=f"[对话历史摘要]\n{summary}",
                    token_count=summary_tokens,
                    compressible=True,
                    min_retain_ratio=0.0,
                ))
        
        # 按原始顺序排列
        blocks.sort(key=lambda b: b.metadata.get("round_index", 0) if "round_index" in b.metadata else -1)
        
        return blocks
    
    def _split_history(
        self, history: List[HistoryMessage], recent_count: int
    ) -> Tuple[List[HistoryMessage], List[HistoryMessage]]:
        """分割为最近 N 轮和早期轮次"""
        if len(history) <= recent_count:
            return history, []
        cutoff = len(history) - recent_count
        return history[cutoff:], history[:cutoff]
    
    def _annotate_key_rounds(self, history: List[HistoryMessage]) -> List[HistoryMessage]:
        """
        标注关键轮。
        规则：包含知识点确认、解题转折、用户明确表示理解的轮次。
        """
        KEY_PATTERNS = [
            "明白了", "懂了", "原来如此", "理解了", "学会了",
            "但是", "不对", "还是不懂", "为什么",
            "这个知识点", "关键步骤", "解题思路",
        ]
        
        for msg in history:
            if msg.role == "assistant":
                # AI 回答中包含公式或分步解析的标记为关键
                if any(marker in msg.content for marker in ["步骤", "公式", "解法", "关键"]):
                    msg.is_key_round = True
            elif msg.role == "user":
                if any(p in msg.content for p in KEY_PATTERNS):
                    msg.is_key_round = True
        
        return history
    
    async def _get_or_create_summary(
        self, conversation_id: str, early_msgs: List[HistoryMessage]
    ) -> Optional[str]:
        """获取或生成早期对话摘要"""
        # 1. 尝试从缓存获取
        existing = await self._summary.get_cached(conversation_id)
        if existing and existing.covered_rounds >= early_msgs[-1].round_index:
            return existing.summary_text
        
        # 2. 生成新摘要
        combined = "\n".join(f"{m.role}: {m.content}" for m in early_msgs)
        summary = await self._summary.generate(combined, max_output_tokens=300)
        
        # 3. 缓存
        await self._summary.save_cache(
            conversation_id=conversation_id,
            summary_text=summary,
            covered_rounds=early_msgs[-1].round_index,
        )
        
        return summary
```

### 5.3 上下文组装器（ContextAssembler）

```python
# context_assembler.py

import logging
from typing import List
from .context_plan import ContextPlan
from .context_block import ContextBlock, Priority

logger = logging.getLogger(__name__)


class ContextAssembler:
    """
    将 Context Block 按优先级组装为最终的 LLM messages 列列。
    
    策略：
    1. 按 priority 降序排列
    2. 逐个添加，超出预算时尝试压缩（如果 compressible=True）
    3. 压缩后仍超预算则丢弃（除非 min_retain_ratio > 0）
    4. 最终拼装为 system + context + history 的 messages 格式
    """
    
    def __init__(self, token_estimator, compressor=None):
        self._estimator = token_estimator
        self._compressor = compressor  # 可选的压缩器
    
    def assemble(self, plan: ContextPlan) -> List[dict]:
        """
        组装最终的 messages 列表。
        返回格式：[{"role": "system", "content": "..."}, ...]
        """
        # Step 1: 按优先级排序（降序）
        sorted_blocks = plan.sort_by_priority()
        
        # Step 2: 贪心填充
        selected: List[ContextBlock] = []
        used_tokens = 0
        budget = plan.total_budget
        
        for block in sorted_blocks:
            # CRITICAL 块必须保留
            if block.priority == Priority.CRITICAL:
                selected.append(block)
                used_tokens += block.token_count
                continue
            
            remaining = budget - used_tokens
            
            # 情况 1：完全放下
            if block.token_count <= remaining:
                selected.append(block)
                used_tokens += block.token_count
                continue
            
            # 情况 2：可压缩
            if block.compressible and self._compressor:
                compressed = self._compressor.compress(
                    block.content,
                    target_tokens=int(remaining * block.min_retain_ratio) if block.min_retain_ratio > 0 else remaining,
                )
                if compressed:
                    compressed_tokens = self._estimator.estimate(compressed)
                    if compressed_tokens <= remaining:
                        block.content = compressed
                        block.token_count = compressed_tokens
                        selected.append(block)
                        used_tokens += compressed_tokens
                        logger.debug("Compressed block %s: %d → %d tokens", block.block_id, block.token_count, compressed_tokens)
                        continue
            
            # 情况 3：有最小保留比例要求
            if block.min_retain_ratio > 0 and remaining > 0:
                min_tokens = int(block.token_count * block.min_retain_ratio)
                if min_tokens <= remaining:
                    truncated = self._truncate(block.content, remaining)
                    block.content = truncated
                    block.token_count = self._estimator.estimate(truncated)
                    selected.append(block)
                    used_tokens += block.token_count
                    continue
            
            # 情况 4：丢弃
            logger.debug("Dropped block %s (priority=%s, tokens=%d, remaining=%d)",
                        block.block_id, block.priority.name, block.token_count, remaining)
        
        # Step 3: 更新计划统计
        plan.allocated_tokens = used_tokens
        plan.remaining_budget = budget - used_tokens
        
        # Step 4: 转换为 messages 格式
        return self._blocks_to_messages(selected)
    
    def _blocks_to_messages(self, blocks: List[ContextBlock]) -> List[dict]:
        """将 blocks 转换为标准 messages 格式"""
        messages = []
        
        # 合并所有 system 级别的内容
        system_parts = []
        context_parts = []
        history_parts = []
        
        for block in blocks:
            if block.block_type.value == "system_prompt":
                system_parts.append(block.content)
            elif block.block_type.value in ("conv_recent",):
                history_parts.append(block.content)
            else:
                context_parts.append(block.content)
        
        # 构建 system message
        system_content = "\n\n".join(system_parts)
        if context_parts:
            system_content += "\n\n【参考信息】\n" + "\n\n".join(context_parts)
        
        messages.append({"role": "system", "content": system_content})
        
        # 构建历史对话消息
        for hist in history_parts:
            if hist.startswith("user: "):
                messages.append({"role": "user", "content": hist[6:]})
            elif hist.startswith("assistant: "):
                messages.append({"role": "assistant", "content": hist[11:]})
        
        return messages
    
    def _truncate(self, text: str, target_tokens: int) -> str:
        """简单截断到目标 token 数"""
        # 粗略估算：target_tokens * 2 字符
        target_chars = target_tokens * 2
        if len(text) <= target_chars:
            return text
        return text[:target_chars] + "...(内容已截断)"
```

### 5.4 记忆提取器（MemoryExtractor）

```python
# memory_extractor.py

import json
import logging
import uuid
from typing import List, Optional
from .memory_fragment import MemoryFragment, MemoryType

logger = logging.getLogger(__name__)

EXTRACTION_PROMPT = """\
你是一个教育学习记忆提取器。分析以下对话内容，提取值得长期记忆的信息。

请以 JSON 数组格式输出，每个元素格式：
{
  "type": "knowledge_point|mistake_pattern|learning_preference|weakness|goal",
  "title": "简短标题",
  "content": "详细内容描述",
  "summary": "一句话摘要（用于后续检索时展示）",
  "keywords": ["关键词1", "关键词2"],
  "subject": "学科（如有）",
  "knowledge_points": ["关联知识点ID（如有）"]
}

提取规则：
1. 只提取有长期参考价值的信息
2. 忽略临时性问答（如"今天天气怎么样"）
3. knowledge_point: 学生新学到的知识点或已掌握的知识
4. mistake_pattern: 反复出现的错误模式
5. learning_preference: 学生的学习偏好（如"喜欢用图解方式理解"）
6. weakness: 暴露的知识薄弱点
7. goal: 学生提到的学习目标

如果对话中没有值得记忆的信息，输出空数组 []。

对话内容：
{conversation}
"""


class MemoryExtractor:
    """从对话中提取长期记忆"""
    
    def __init__(self, llm_client, memory_repo, token_estimator, event_bus):
        self._llm = llm_client
        self._repo = memory_repo
        self._estimator = token_estimator
        self._bus = event_bus
    
    async def extract_and_store(
        self,
        user_id: str,
        conversation_id: str,
        messages: List[dict],    # 对话消息列表
    ) -> List[MemoryFragment]:
        """
        从一段对话中提取记忆并存储。
        通常由事件总线异步触发。
        """
        # 1. 跳过短对话（少于 3 轮不值得提取）
        user_msgs = [m for m in messages if m.get("role") == "user"]
        if len(user_msgs) < 3:
            return []
        
        # 2. 拼接对话文本
        conv_text = self._format_conversation(messages)
        
        # 如果对话太长，先做摘要
        if self._estimator.estimate(conv_text) > 4000:
            conv_text = await self._summarize_for_extraction(conv_text)
        
        # 3. 调用 LLM 提取
        prompt = EXTRACTION_PROMPT.format(conversation=conv_text)
        try:
            response = await self._llm.chat(
                messages=[{"role": "user", "content": prompt}],
                model="gpt-4o-mini",  # 用便宜模型做提取
                temperature=0.1,
                max_tokens=2000,
            )
        except Exception as e:
            logger.error("Memory extraction failed: %s", e)
            return []
        
        # 4. 解析结果
        fragments = self._parse_extraction(response, user_id, conversation_id)
        
        # 5. 去重（与已有记忆比对）
        new_fragments = await self._deduplicate(user_id, fragments)
        
        # 6. 存储
        if new_fragments:
            await self._repo.batch_save(new_fragments)
            logger.info("Extracted %d new memory fragments for user %s", len(new_fragments), user_id)
        
        return new_fragments
    
    def _format_conversation(self, messages: List[dict]) -> str:
        """格式化对话为纯文本"""
        lines = []
        for msg in messages:
            role = "学生" if msg["role"] == "user" else "AI老师"
            lines.append(f"{role}: {msg['content']}")
        return "\n".join(lines)
    
    def _parse_extraction(
        self, response: str, user_id: str, conversation_id: str
    ) -> List[MemoryFragment]:
        """解析 LLM 提取结果"""
        try:
            # 尝试提取 JSON
            text = response.strip()
            if text.startswith("```"):
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            
            items = json.loads(text)
            if not isinstance(items, list):
                return []
            
            fragments = []
            for item in items:
                frag = MemoryFragment(
                    fragment_id=str(uuid.uuid4()),
                    user_id=user_id,
                    memory_type=MemoryType(item.get("type", "knowledge_point")),
                    title=item.get("title", ""),
                    content=item.get("content", ""),
                    summary=item.get("summary", ""),
                    keywords=item.get("keywords", []),
                    subject=item.get("subject"),
                    knowledge_points=item.get("knowledge_points", []),
                    source_conversation_id=conversation_id,
                )
                fragments.append(frag)
            
            return fragments
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning("Failed to parse memory extraction: %s", e)
            return []
    
    async def _deduplicate(
        self, user_id: str, fragments: List[MemoryFragment]
    ) -> List[MemoryFragment]:
        """与已有记忆去重"""
        existing = await self._repo.get_by_user_and_type(user_id)
        existing_summaries = {f.summary for f in existing}
        
        new = []
        for frag in fragments:
            if frag.summary not in existing_summaries:
                new.append(frag)
            else:
                # 更新已有记忆的访问时间和计数
                existing_frag = next(f for f in existing if f.summary == frag.summary)
                await self._repo.update_access(existing_frag.fragment_id)
        
        return new
    
    async def _summarize_for_extraction(self, text: str) -> str:
        """将过长对话摘要后再提取"""
        summary_prompt = (
            "请将以下对话内容压缩为关键信息摘要，保留知识点、错误模式和重要结论。\n\n"
            f"对话内容：\n{text}"
        )
        result = await self._llm.chat(
            messages=[{"role": "user", "content": summary_prompt}],
            model="gpt-4o-mini",
            temperature=0.1,
            max_tokens=2000,
        )
        return result
```

### 5.5 记忆检索器（MemoryRetriever）

```python
# memory_retriever.py

import logging
from typing import List, Optional
from .memory_fragment import MemoryFragment

logger = logging.getLogger(__name__)


class MemoryRetriever:
    """检索与当前问题相关的长期记忆"""
    
    def __init__(self, memory_repo, vector_client, token_estimator):
        self._repo = memory_repo
        self._vector = vector_client
        self._estimator = token_estimator
    
    async def retrieve(
        self,
        user_id: str,
        query: str,
        scene_type: str,
        max_fragments: int = 5,
        max_total_tokens: int = 500,
    ) -> List[MemoryFragment]:
        """
        检索与当前问题相关的记忆片段。
        
        策略：向量相似度 + 关键词匹配 + 时效性加权
        """
        # 1. 向量检索（语义相似）
        vector_hits = await self._vector.search(
            collection="memory_fragments",
            query_text=query,
            filter_expr=f"user_id == '{user_id}'",
            top_k=max_fragments * 2,  # 多取一些，后面还要过滤
        )
        
        # 2. 关键词检索（精确匹配补充）
        keyword_hits = await self._repo.search_by_keywords(
            user_id=user_id,
            query_keywords=self._extract_keywords(query),
            limit=max_fragments,
        )
        
        # 3. 合并去重
        all_hits = self._merge_hits(vector_hits, keyword_hits)
        
        # 4. 按场景过滤
        filtered = self._filter_by_scene(all_hits, scene_type)
        
        # 5. 排序：相关性 × 时效性 × 访问频率
        scored = self._score_and_sort(filtered, query)
        
        # 6. 截断到 token 预算
        result = []
        used_tokens = 0
        for frag in scored:
            frag_tokens = self._estimator.estimate(frag.summary)
            if used_tokens + frag_tokens <= max_total_tokens:
                result.append(frag)
                used_tokens += frag_tokens
            if len(result) >= max_fragments:
                break
        
        # 7. 更新访问计数（异步）
        for frag in result:
            await self._repo.increment_access(frag.fragment_id)
        
        return result
    
    def _score_and_sort(
        self, fragments: List[MemoryFragment], query: str
    ) -> List[MemoryFragment]:
        """
        综合评分排序。
        score = relevance_score * 0.5 + recency_score * 0.3 + access_score * 0.2
        """
        import time
        now = time.time()
        
        for frag in fragments:
            # 时效性得分：30天衰减
            age_days = (now - frag.created_at) / 86400
            recency = max(0, 1 - age_days / 30)
            
            # 访问频率得分
            access = min(1.0, frag.access_count / 10)
            
            frag.relevance_score = (
                frag.relevance_score * 0.5 +
                recency * 0.3 +
                access * 0.2
            )
        
        return sorted(fragments, key=lambda f: f.relevance_score, reverse=True)
    
    def _filter_by_scene(
        self, fragments: List[MemoryFragment], scene_type: str
    ) -> List[MemoryFragment]:
        """按场景过滤记忆类型"""
        SCENE_MEMORY_TYPES = {
            "ai_tutor": None,   # 全部类型
            "photo_search": ["mistake_pattern", "weakness", "knowledge_point"],
            "essay": ["learning_preference", "weakness", "goal"],
            "exam_sim": ["weakness", "mistake_pattern", "knowledge_point"],
            "science_solve": ["mistake_pattern", "knowledge_point"],
        }
        allowed = SCENE_MEMORY_TYPES.get(scene_type)
        if allowed is None:
            return fragments
        return [f for f in fragments if f.memory_type.value in allowed]
    
    def _merge_hits(
        self, vector: List[MemoryFragment], keyword: List[MemoryFragment]
    ) -> List[MemoryFragment]:
        """合并向量检索和关键词检索结果"""
        seen_ids = set()
        merged = []
        for frag in vector + keyword:
            if frag.fragment_id not in seen_ids:
                merged.append(frag)
                seen_ids.add(frag.fragment_id)
        return merged
    
    def _extract_keywords(self, query: str) -> List[str]:
        """简单关键词提取（实际可接入 jieba）"""
        # 去除停用词后返回分词结果
        import re
        words = re.findall(r'[\u4e00-\u9fa5]+|[a-zA-Z]+', query)
        stop_words = {"的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这"}
        return [w for w in words if w not in stop_words and len(w) > 1]
```

---

## 6. 上下文预算分配策略

### 6.1 默认分配方案

```python
# budget_allocation.py

from dataclasses import dataclass
from typing import Dict

@dataclass
class AllocationRule:
    """预算分配规则"""
    block_type: str          # Context Block 类型
    max_ratio: float         # 最大占比
    min_ratio: float         # 最小占比
    default_ratio: float     # 默认占比


# 默认分配方案
DEFAULT_ALLOCATION: Dict[str, AllocationRule] = {
    "system_prompt":   AllocationRule("system_prompt",   0.15, 0.10, 0.10),
    "safety_guard":    AllocationRule("safety_guard",    0.05, 0.03, 0.03),
    "user_profile":    AllocationRule("user_profile",    0.05, 0.02, 0.03),
    "task_context":    AllocationRule("task_context",    0.10, 0.00, 0.05),
    "rag_knowledge":   AllocationRule("rag_knowledge",   0.25, 0.05, 0.15),
    "memory_fragment":  AllocationRule("memory_fragment",  0.10, 0.00, 0.05),
    "conv_recent":     AllocationRule("conv_recent",     0.30, 0.05, 0.25),
    "conv_summary":    AllocationRule("conv_summary",    0.10, 0.00, 0.05),
}

# 场景定制方案（覆盖默认值）
SCENE_OVERRIDES = {
    "photo_search": {
        # 拍题场景：RAG 和任务上下文更重要，历史不重要
        "rag_knowledge":  AllocationRule("rag_knowledge", 0.35, 0.10, 0.25),
        "task_context":   AllocationRule("task_context",  0.15, 0.05, 0.10),
        "conv_recent":    AllocationRule("conv_recent",   0.10, 0.00, 0.05),
        "conv_summary":   AllocationRule("conv_summary",  0.00, 0.00, 0.00),
    },
    "essay": {
        # 作文场景：对话历史和记忆更重要
        "conv_recent":    AllocationRule("conv_recent",   0.35, 0.10, 0.30),
        "memory_fragment": AllocationRule("memory_fragment", 0.15, 0.05, 0.10),
        "rag_knowledge":  AllocationRule("rag_knowledge", 0.15, 0.05, 0.10),
    },
    "exam_sim": {
        # 考试场景：RAG + 任务上下文为主
        "rag_knowledge":  AllocationRule("rag_knowledge", 0.30, 0.10, 0.20),
        "task_context":   AllocationRule("task_context",  0.20, 0.10, 0.15),
        "conv_recent":    AllocationRule("conv_recent",   0.15, 0.05, 0.10),
    },
}
```

### 6.2 预算分配可视化示例

以 `qwen-max`（32K 上下文）为例：

```
模型上下文窗口:   32,768 tokens
输出预留:         -8,192 tokens
系统开销:            -50 tokens
─────────────────────────
可用 Token 预算:  24,526 tokens

默认分配（ai_tutor 场景）:
┌─────────────────┬────────┬──────────┐
│ Block Type      │ Ratio  │ Tokens   │
├─────────────────┼────────┼──────────┤
│ system_prompt   │  10%   │  2,453   │
│ safety_guard    │   3%   │    736   │
│ user_profile    │   3%   │    736   │
│ task_context    │   5%   │  1,226   │
│ rag_knowledge   │  25%   │  6,132   │
│ memory_fragment │   5%   │  1,226   │
│ conv_recent     │  35%   │  8,584   │
│ conv_summary    │   5%   │  1,226   │
│ ─ ─ ─ ─ ─ ─ ─ ─│ ─ ─ ─ ─│ ─ ─ ─ ─ ─│
│ 预留缓冲        │   9%   │  2,207   │
└─────────────────┴────────┴──────────┘
```

---

## 7. 上下文压缩策略

### 7.1 压缩级别

当预算不足时，按以下级别逐步压缩：

| 级别 | 策略 | Token 节省 | 质量影响 |
|------|------|-----------|---------|
| L0 | 不压缩（完整上下文） | 0% | 无 |
| L1 | 裁剪最早的非关键对话轮次 | 10-30% | 极低 |
| L2 | 对话摘要（N轮→1段摘要） | 50-70% | 低 |
| L3 | 记忆片段精简（只保留 summary） | 60-80% | 中 |
| L4 | RAG 结果截断（只保留 top-3） | 40-60% | 中高 |
| L5 | 系统提示精简版 | 30-50% | 高 |

### 7.2 压缩器实现

```python
# compressor.py

import logging
from typing import Optional

logger = logging.getLogger(__name__)


class ContextCompressor:
    """上下文压缩器"""
    
    def __init__(self, llm_client, token_estimator):
        self._llm = llm_client
        self._estimator = token_estimator
    
    async def compress(self, content: str, target_tokens: int) -> Optional[str]:
        """将内容压缩到目标 token 数以内"""
        current_tokens = self._estimator.estimate(content)
        
        if current_tokens <= target_tokens:
            return content
        
        # 简单截断（当目标很小或内容不是对话时）
        if target_tokens < 50:
            return self._truncate(content, target_tokens)
        
        # LLM 摘要压缩（当需要保留语义时）
        compression_ratio = target_tokens / current_tokens
        
        if compression_ratio > 0.5:
            # 轻度压缩：提取关键句
            return await self._extract_key_sentences(content, target_tokens)
        else:
            # 重度压缩：LLM 摘要
            return await self._summarize(content, target_tokens)
    
    def _truncate(self, text: str, target_tokens: int) -> str:
        """硬截断"""
        target_chars = target_tokens * 2
        return text[:target_chars] + "...(已压缩)"
    
    async def _extract_key_sentences(self, text: str, target_tokens: int) -> str:
        """提取关键句（不调用 LLM，基于规则）"""
        sentences = text.replace("。", "。\n").replace("？", "？\n").replace("！", "！\n").split("\n")
        sentences = [s.strip() for s in sentences if s.strip()]
        
        # 优先保留包含关键词的句子
        KEY_INDICATORS = ["因此", "所以", "关键", "重点", "结论", "注意", "公式", "步骤", "答案"]
        
        scored = []
        for s in sentences:
            score = sum(1 for k in KEY_INDICATORS if k in s)
            scored.append((score, s))
        
        scored.sort(key=lambda x: x[0], reverse=True)
        
        result = []
        used = 0
        for score, sent in scored:
            tokens = self._estimator.estimate(sent)
            if used + tokens <= target_tokens:
                result.append(sent)
                used += tokens
        
        # 按原文顺序排列
        result_set = set(result)
        return "".join(s for s in sentences if s in result_set)
    
    async def _summarize(self, text: str, target_tokens: int) -> str:
        """LLM 摘要压缩"""
        prompt = (
            f"请将以下内容压缩为约{target_tokens}个token的摘要，"
            "保留所有关键信息、数据和结论：\n\n"
            f"{text}"
        )
        try:
            result = await self._llm.chat(
                messages=[{"role": "user", "content": prompt}],
                model="gpt-4o-mini",  # 用便宜模型
                temperature=0.1,
                max_tokens=target_tokens + 100,
            )
            return result
        except Exception as e:
            logger.warning("Compression failed, falling back to truncation: %s", e)
            return self._truncate(text, target_tokens)
```

---

## 8. 跨会话记忆生命周期

### 8.1 记忆生命周期状态机

```
  ┌──────────┐  提取成功   ┌──────────┐  首次访问   ┌──────────┐
  │ Created  │ ──────────→ │ Active   │ ──────────→ │ Accessed │
  └──────────┘            └──────────┘            └──────────┘
                                                      │
                               长期未访问              │
                                                      ▼
                                                  ┌──────────┐
                              ┌────────────────── │ Dormant   │
                              │                   └──────────┘
                              │                        │
                              │   过期/学期结束         │ expired
                              ▼                        ▼
                          ┌──────────┐            ┌──────────┐
                          │ Archived │            │ Expired  │
                          └──────────┘            └──────────┘
```

### 8.2 记忆管理任务

```python
# memory_maintenance.py

import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class MemoryMaintenanceService:
    """记忆维护服务（Celery 定时任务）"""
    
    def __init__(self, memory_repo, event_bus):
        self._repo = memory_repo
        self._bus = event_bus
    
    async def cleanup_expired(self):
        """清理过期记忆（每天执行）"""
        count = await self._repo.archive_expired()
        logger.info("Archived %d expired memory fragments", count)
    
    async def consolidate_memories(self, user_id: str):
        """
        合并同一用户的相似记忆（每周执行）。
        当同一用户的记忆片段超过 100 条时触发。
        """
        all_memories = await self._repo.get_all_by_user(user_id)
        if len(all_memories) < 100:
            return
        
        # 按类型分组
        by_type = {}
        for mem in all_memories:
            by_type.setdefault(mem.memory_type, []).append(mem)
        
        # 合并同类型的相似记忆
        for mem_type, fragments in by_type.items():
            if len(fragments) < 10:
                continue
            
            merged_count = await self._merge_similar(fragments)
            if merged_count > 0:
                logger.info("Merged %d similar %s memories for user %s",
                          merged_count, mem_type, user_id)
    
    async def _merge_similar(self, fragments):
        """合并相似的记忆片段"""
        merged = 0
        used = set()
        
        for i, frag_a in enumerate(fragments):
            if i in used:
                continue
            for j, frag_b in enumerate(fragments):
                if j <= i or j in used:
                    continue
                
                # 简单相似度判断：关键词重叠 > 60%
                overlap = len(set(frag_a.keywords) & set(frag_b.keywords))
                union = len(set(frag_a.keywords) | set(frag_b.keywords))
                if union > 0 and overlap / union > 0.6:
                    # 合并：保留更新的，合并关键词
                    frag_a.keywords = list(set(frag_a.keywords + frag_b.keywords))
                    frag_a.content += f"\n[补充] {frag_b.content}"
                    frag_a.summary = frag_a.summary  # 保留更完整的 summary
                    await self._repo.update(frag_a)
                    await self._repo.archive(frag_b.fragment_id)
                    used.add(j)
                    merged += 1
        
        return merged
```

---

## 9. API 接口设计

### 9.1 上下文管理接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/context/build` | 组装上下文（内部接口） |
| GET | `/api/v1/context/plan/{plan_id}` | 查询上下文计划详情 |
| GET | `/api/v1/context/stats` | 查询上下文使用统计 |

### 9.2 记忆管理接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/memory/list` | 查询用户记忆列表 |
| GET | `/api/v1/memory/{fragment_id}` | 查询记忆详情 |
| DELETE | `/api/v1/memory/{fragment_id}` | 删除指定记忆 |
| POST | `/api/v1/memory/trigger-extract` | 手动触发记忆提取 |
| GET | `/api/v1/memory/stats` | 查询记忆统计 |

### 9.3 接口详细定义

#### POST /api/v1/context/build

```json
// Request
{
  "user_id": "u_12345",
  "conversation_id": "conv_67890",
  "current_message": "二次函数的顶点坐标怎么求？",
  "model_id": "qwen-max",
  "scene_type": "ai_tutor",
  "rag_results": ["知识点: 二次函数顶点式...", "例题: 已知抛物线..."],
  "task_context": null
}

// Response
{
  "plan_id": "plan_abc123",
  "model_id": "qwen-max",
  "total_budget": 24526,
  "allocated_tokens": 22183,
  "block_count": 8,
  "block_breakdown": {
    "system_prompt": 2453,
    "safety_guard": 736,
    "user_profile": 580,
    "rag_knowledge": 6132,
    "memory_fragment": 892,
    "conv_recent": 10560,
    "conv_summary": 830
  },
  "compression_used": false,
  "messages": [
    {"role": "system", "content": "你是一个面向初二学生的数学辅导老师..."},
    {"role": "user", "content": "一次函数和二次函数有什么区别？"},
    {"role": "assistant", "content": "一次函数的图像是直线..."},
    {"role": "user", "content": "二次函数的顶点坐标怎么求？"}
  ]
}
```

#### GET /api/v1/memory/list

```json
// Query: ?user_id=u_12345&type=knowledge_point&page=1&size=20

// Response
{
  "total": 45,
  "items": [
    {
      "fragment_id": "frag_001",
      "memory_type": "knowledge_point",
      "title": "二次函数顶点坐标公式",
      "summary": "已掌握二次函数顶点坐标公式 y=a(x-h)²+k 中顶点为(h,k)",
      "subject": "数学",
      "access_count": 12,
      "created_at": "2026-05-20T14:30:00Z"
    }
  ]
}
```

---

## 10. 降级策略

### 10.1 降级矩阵

| 故障点 | 降级策略 | 用户体验 |
|--------|---------|---------|
| 向量检索不可用 | 退化为关键词检索 | 记忆匹配精度下降，可接受 |
| 记忆库不可用 | 跳过记忆检索，仅用对话历史 | 丢失长期上下文，体验轻微下降 |
| 摘要服务不可用 | 直接截断早期历史 | 丢失部分早期上下文，可接受 |
| Token 估算偏差 | 最终拼装后精确计数，超限则紧急裁剪 DISPOSABLE 块 | 极端情况丢失摘要 |
| 全部记忆服务不可用 | 纯对话历史模式（最近 N 轮） | 类似无状态对话，可接受 |
| 小模型上下文窗口不足 | 自动升级到大窗口模型 | 成本增加但体验不变 |

### 10.2 降级代码示例

```python
# degradation.py

class ContextDegradationLevel:
    NORMAL = "normal"
    NO_VECTOR = "no_vector"       # 向量检索退化
    NO_MEMORY = "no_memory"       # 记忆服务退化
    MINIMAL = "minimal"           # 最小模式：仅系统提示+最近对话

async def build_context_with_fallback(
    context_manager: ContextManager,
    **kwargs
) -> Tuple[List[dict], ContextPlan]:
    """带降级的上下文组装"""
    
    degradation = ContextDegradationLevel.NORMAL
    
    try:
        return await context_manager.build_context(**kwargs)
    except VectorSearchError:
        degradation = ContextDegradationLevel.NO_VECTOR
        logger.warning("Vector search unavailable, falling back to keyword-only")
        kwargs["disable_vector_search"] = True
        try:
            return await context_manager.build_context(**kwargs)
        except Exception:
            degradation = ContextDegradationLevel.NO_MEMORY
    
    if degradation == ContextDegradationLevel.NO_MEMORY:
        logger.warning("Memory service unavailable, minimal context mode")
        return await _build_minimal_context(**kwargs)


async def _build_minimal_context(
    user_id: str,
    conversation_id: str,
    current_message: str,
    model_id: str,
    system_prompt: str,
    **kwargs,
) -> Tuple[List[dict], ContextPlan]:
    """最小上下文：系统提示 + 最近 5 轮对话"""
    plan = ContextPlan(
        plan_id=str(uuid.uuid4()),
        model_id=model_id,
        total_budget=MODEL_SPECS[model_id].available_budget,
    )
    
    messages = [{"role": "system", "content": system_prompt}]
    
    # 只加载最近 5 轮
    history = await get_recent_history(conversation_id, limit=5)
    for msg in history:
        messages.append({"role": msg.role, "content": msg.content})
    
    plan.allocated_tokens = sum(
        estimate(m["content"]) for m in messages
    )
    
    return messages, plan
```

---

## 11. 监控与指标

### 11.1 关键指标

| 指标名 | 含义 | 告警阈值 |
|--------|------|---------|
| `context.build.duration_ms` | 上下文组装耗时 | P99 > 200ms |
| `context.budget.utilization` | 预算利用率 | > 95% 持续 5min |
| `context.blocks.dropped` | 被丢弃的 Block 数 | > 2 平均/请求 |
| `context.compression.used` | 使用压缩的请求比例 | > 30% |
| `memory.fragments.total` | 用户记忆片段总数 | > 500/用户 |
| `memory.extraction.success_rate` | 记忆提取成功率 | < 90% |
| `memory.retrieval.hit_rate` | 记忆检索命中率 | < 20% |
| `context.plan.token_overflow` | 精确计数后仍超限的次数 | > 0 |

### 11.2 日志格式

```python
# 结构化日志示例
logger.info("Context built", extra={
    "plan_id": plan.plan_id,
    "user_id": user_id,
    "model_id": model_id,
    "scene": scene_type,
    "budget_total": plan.total_budget,
    "budget_used": plan.allocated_tokens,
    "budget_utilization": round(plan.allocated_tokens / plan.total_budget, 2),
    "block_count": len(plan.blocks),
    "blocks_dropped": dropped_count,
    "compression_used": compression_used,
    "memory_hits": memory_hits,
    "duration_ms": round(duration * 1000, 1),
})
```

---

## 12. 容量估算

### 12.1 存储估算

| 资源 | 单用户估算 | 10万用户 | 备注 |
|------|-----------|---------|------|
| 记忆片段 | 50 条 × 500B = 25KB | 2.5GB | PG 存储 |
| 记忆向量 | 50 × 1536维 × 4B = 300KB | 30GB | Milvus 存储 |
| 对话摘要 | 10 条 × 1KB = 10KB | 1GB | PG 存储 |
| 上下文日志 | 100条/天 × 500B × 30天 = 1.5MB | 150GB/月 | ClickHouse |

### 12.2 性能估算

| 操作 | 目标延迟 | QPS 估算 | 瓶颈 |
|------|---------|---------|------|
| 上下文组装 | < 100ms (P95) | 500 | 向量检索 + 历史加载 |
| 记忆检索 | < 50ms (P95) | 500 | Milvus 向量搜索 |
| 记忆提取 | < 5s (异步) | 50 | LLM 调用 |
| 对话摘要生成 | < 3s (异步) | 20 | LLM 调用 |

---

## 13. 与其他模块的集成

### 13.1 集成点清单

| 集成模块 | 集成方式 | 说明 |
|---------|---------|------|
| AI对话引擎 | 同步调用 | 对话引擎在调用 LLM 前调用本引擎组装上下文 |
| 多模型调度 | 被动接收 | 调度层告知目标模型，本引擎据此分配预算 |
| RAG知识库 | 同步调用 | 本引擎接收 RAG 结果作为 Context Block |
| 学习会话编排 | 事件消费 | 会话结束时触发记忆提取 |
| 用户画像 | 数据查询 | 获取学段、年级、薄弱点等信息 |
| AI输出缓存 | 缓存检查 | 组装前检查是否有缓存命中 |
| 数据埋点 | 事件发布 | 发布上下文使用指标 |
| Prompt编排 | 数据查询 | 获取场景系统提示模板 |

### 13.2 事件定义

```python
# 事件定义（接入异步任务与事件驱动架构）

# 记忆提取事件
EVENT_MEMORY_EXTRACT = "memory.extract.requested"
# payload: {"user_id": str, "conversation_id": str}

# 上下文组装完成事件
EVENT_CONTEXT_ASSEMBLED = "context.assembled"
# payload: {"plan_id": str, "user_id": str, "model_id": str, "stats": dict}

# 记忆过期事件
EVENT_MEMORY_EXPIRED = "memory.expired"
# payload: {"fragment_ids": List[str], "user_id": str}
```

---

## 14. 测试策略

### 14.1 单元测试重点

| 测试目标 | 测试用例 |
|---------|---------|
| TokenEstimator | 中英文混合文本估算偏差 < 20% |
| BudgetPlanner | 各模型规格预算计算正确 |
| ContextAssembler | 超预算时按优先级裁剪，CRITICAL 不被裁剪 |
| ContextAssembler | compressible 块被压缩后能放入预算 |
| HistoryProcessor | 最近 N 轮保留原文，更早生成摘要 |
| MemoryExtractor | JSON 解析正确，空结果不报错 |
| MemoryRetriever | 向量+关键词结果合并去重 |

### 14.2 集成测试场景

```python
# 集成测试示例

async def test_full_context_build_flow():
    """测试完整上下文组装流程"""
    manager = create_test_context_manager()
    
    # 模拟 20 轮对话历史
    conversation_id = "test_conv_001"
    for i in range(20):
        await save_message(conversation_id, "user", f"第{i+1}个问题")
        await save_message(conversation_id, "assistant", f"第{i+1}个回答" + "详细内容" * 50)
    
    messages, plan = await manager.build_context(
        user_id="test_user",
        conversation_id=conversation_id,
        current_message="请总结一下我们讨论过的内容",
        model_id="qwen-max",
        scene_type="ai_tutor",
        system_prompt="你是一个AI学习助手",
    )
    
    # 验证
    assert messages[0]["role"] == "system"
    assert plan.allocated_tokens <= plan.total_budget
    assert any(b.block_type == BlockType.CONVERSATION_SUMMARY for b in plan.blocks)
    assert len(messages) > 2  # system + 至少一轮历史 + 当前问题


async def test_context_with_tiny_model():
    """测试小窗口模型的上下文裁剪"""
    manager = create_test_context_manager()
    
    # 使用 8K 模型（小窗口）
    messages, plan = await manager.build_context(
        user_id="test_user",
        conversation_id="long_conv",
        current_message="继续讲解",
        model_id="some-8k-model",
        scene_type="ai_tutor",
        system_prompt="你是一个AI学习助手",
    )
    
    # 应该触发了压缩或裁剪
    assert plan.allocated_tokens <= plan.total_budget
```

---

## 15. 版本演进

### 15.1 MVP 阶段

- 仅实现 ContextManager + ContextAssembler
- 固定预算分配（不做动态调整）
- 对话历史简单截断（不做摘要压缩）
- 不实现记忆系统

### 15.2 V1.0 阶段

- 实现完整的记忆提取和检索
- 对话摘要压缩
- 场景定制预算方案
- 上下文使用监控

### 15.3 V1.5 阶段

- 动态预算调整（基于对话质量反馈）
- 记忆合并和去重
- 跨用户记忆模式分析（匿名化）
- A/B 测试不同预算分配方案的效果

---

## 附录 A：模型上下文窗口速查表

| 模型 | 上下文窗口 | 最大输出 | 建议预算利用率 |
|------|-----------|---------|---------------|
| GPT-4o | 128K | 16K | ≤ 80% |
| GPT-4o-mini | 128K | 16K | ≤ 85% |
| Claude 3.5 Sonnet | 200K | 8K | ≤ 75% |
| Qwen-Max | 32K | 8K | ≤ 85% |
| Qwen-Plus | 131K | 8K | ≤ 80% |
| GLM-4 | 128K | 4K | ≤ 80% |
| DeepSeek-V3 | 64K | 8K | ≤ 80% |
| ERNIE-4.0 | 128K | 4K | ≤ 80% |

## 附录 B：Context Block 优先级速查

| 优先级 | Block 类型 | 说明 | 可裁剪 |
|--------|-----------|------|--------|
| CRITICAL (100) | SYSTEM_PROMPT | 系统提示 | ❌ |
| CRITICAL (100) | SAFETY_GUARD | 安全护栏 | ❌ |
| HIGH (80) | USER_PROFILE | 用户画像 | ❌ |
| HIGH (80) | TASK_CONTEXT | 任务上下文 | ❌ |
| MEDIUM (60) | RAG_KNOWLEDGE | RAG 检索结果 | ✅ (保底30%) |
| MEDIUM (60) | MEMORY_FRAGMENT | 长期记忆 | ✅ (可全删) |
| LOW (40) | CONVERSATION_RECENT | 最近对话 | ✅ (关键轮保底) |
| DISPOSABLE (20) | CONVERSATION_SUMMARY | 历史摘要 | ✅ (可全删) |
