# AI 回答后处理与智能优化管线 - 详细设计

> **版本**: v1.1 | **日期**: 2026-08-16 | **状态**: 已补全（v1.0 初稿于 §3.2 SafetyFilter 代码处截断，本次补齐 §3.2-§3.8 全部过滤器、双模式协同、API/事件、落库、降级矩阵、状态机、监控、配置、契约对齐与验收场景；并修复 v1.0 两处代码缺陷：PipelineContext 补 metadata 字段、_build_error_fallback 切片逻辑修正）
> **原始需求来源**: `docs/design/启硕-PrimeTop-全学段AI辅助学习软件项目设计文档.md` §8.5.2、§6.2.2、§9.4

---

## 1. 模块概述

### 1.1 功能定位

AI 回答后处理与智能优化管线（AI Response Post-processing Pipeline，简称 ARPP）是 AI 能力层的核心中间件，负责将大模型的原始输出转化为安全、规范、适龄、富结构化的最终回答。它是 **"裸模型输出"→"用户可消费内容"** 的唯一通道。

**一句话定位：** 所有 AI 模型的原始回答都必须经过此管线处理，才能到达用户端。

### 1.2 在系统中的位置

```
用户提问 → 意图识别 + Prompt组装 + RAG检索 → 大模型调用 → SSE流式输出
                                                            │
                                              ┌─────────────▼──────────────┐
                                              │  AI回答后处理管线 (ARPP)    │
                                              │  ┌──────────────────────┐  │
                                              │  │ 1. 原始输出解析       │  │
                                              │  │ 2. 内容安全过滤       │  │
                                              │  │ 3. 学科内容校验       │  │
                                              │  │ 4. 适龄化处理         │  │
                                              │  │ 5. 知识点标注         │  │
                                              │  │ 6. 结构化增强         │  │
                                              │  │ 7. 格式规范化         │  │
                                              │  │ 8. 质量评分           │  │
                                              │  └──────────────────────┘  │
                                              └─────────────┬──────────────┘
                                                            │
                                              ┌─────────────▼──────────────┐
                                              │  SSE流式 → 客户端富文本渲染 │
                                              │  缓存写入 (AI输出缓存引擎)  │
                                              │  学习行为记录              │
                                              └────────────────────────────┘
```

### 1.3 核心能力

| 能力 | 说明 | 优先级 |
|------|------|--------|
| 流式逐块处理 | 与 SSE 流式输出并行，边生成边处理 | P0 |
| 内容安全过滤 | 敏感内容检测、有害信息拦截、合规审查 | P0 |
| 学科内容校验 | 公式语法校验、事实性检查、逻辑一致性验证 | P1 |
| 适龄化适配 | 根据用户年级调整语言复杂度和表达方式 | P0 |
| 知识点自动标注 | 从回答中提取并关联知识点和教材章节 | P1 |
| 格式规范化 | Markdown/LaTeX 统一规范化、渲染预处理 | P0 |
| 质量评分 | 对回答质量进行实时评估，低质量触发重试 | P1 |
| 引用溯源 | 标注回答中引用的知识库来源 | P2 |

### 1.4 设计原则

1. **管线即过滤器**：每个处理步骤是一个独立的"过滤器"（Filter），可独立开关、排序和替换
2. **流式优先**：所有过滤器必须支持流式（chunk-by-chunk）处理，不能等待完整回答
3. **不阻塞用户**：安全过滤等关键步骤同步执行，知识点标注等异步执行
4. **幂等安全**：同一输入多次处理结果一致
5. **可观测**：每个过滤器的处理耗时、拦截率、异常均有监控

---

## 2. 管线架构设计

### 2.1 管线编排器

```python
# server/services/ai/pipeline/orchestrator.py

from typing import AsyncIterator, List, Optional
from dataclasses import dataclass, field
from enum import Enum
import asyncio
import time


class PipelineStage(str, Enum):
    """管线阶段枚举"""
    PARSE = "parse"              # 原始输出解析
    SAFETY = "safety"            # 内容安全过滤
    SUBJECT = "subject"          # 学科内容校验
    AGE_ADAPT = "age_adapt"      # 适龄化处理
    STRUCTURE = "structure"      # 结构化增强
    FORMAT = "format"            # 格式规范化
    QUALITY = "quality"          # 质量评分
    TAGGING = "tagging"          # 知识点标注（异步）


@dataclass
class PipelineContext:
    """管线上下文，贯穿所有过滤器"""
    # 输入信息
    user_id: int
    student_profile: 'StudentProfile'    # 含年级、学段、教材版本
    conversation_id: str
    message_id: str
    scene: str                           # 场景：tutoring/photo_qa/exercise/essay...
    subject_id: Optional[int] = None
    model_id: Optional[str] = None

    # 处理状态
    stage: PipelineStage = PipelineStage.PARSE
    raw_chunks: List[str] = field(default_factory=list)
    processed_chunks: List[str] = field(default_factory=list)
    accumulated_text: str = ""

    # 元数据收集
    metadata: dict = field(default_factory=dict)
    safety_result: Optional['SafetyResult'] = None
    subject_check_result: Optional['SubjectCheckResult'] = None
    age_adapt_metadata: Optional[dict] = None
    quality_score: Optional[float] = None
    detected_knowledge_points: List[dict] = field(default_factory=list)
    detected_formulas: List[dict] = field(default_factory=list)
    references: List[dict] = field(default_factory=list)

    # 性能追踪
    stage_timings: dict = field(default_factory=dict)
    emitted_chars: int = 0                 # 已向下游 yield 的字符游标（降级用）
    _stage_start: float = 0.0

    def start_stage(self, stage: PipelineStage):
        self.stage = stage
        self._stage_start = time.monotonic()

    def end_stage(self):
        elapsed = time.monotonic() - self._stage_start
        self.stage_timings[self.stage.value] = elapsed


@dataclass
class PipelineResult:
    """管线最终输出"""
    chunks: List[str]                    # 处理后的文本块列表
    safety_result: 'SafetyResult'
    quality_score: float
    knowledge_points: List[dict]
    formulas: List[dict]
    references: List[dict]
    age_adapted: bool
    metadata: dict                        # 额外元数据
    stage_timings: dict                   # 各阶段耗时


class ResponsePipeline:
    """AI回答后处理管线编排器"""

    def __init__(self, config: 'PipelineConfig'):
        self.filters: dict[PipelineStage, 'BaseFilter'] = {}
        self.async_filters: List[PipelineStage] = []
        self.config = config
        self._register_filters()

    def _register_filters(self):
        """注册所有过滤器"""
        # 同步管线（流式处理，必须在线完成）
        self.filters[PipelineStage.PARSE] = ParseFilter(self.config)
        self.filters[PipelineStage.SAFETY] = SafetyFilter(self.config)
        self.filters[PipelineStage.SUBJECT] = SubjectCheckFilter(self.config)
        self.filters[PipelineStage.AGE_ADAPT] = AgeAdaptFilter(self.config)
        self.filters[PipelineStage.STRUCTURE] = StructureEnhanceFilter(self.config)
        self.filters[PipelineStage.FORMAT] = FormatNormalizeFilter(self.config)
        self.filters[PipelineStage.QUALITY] = QualityScoreFilter(self.config)

        # 异步管线（可延迟处理）
        self.filters[PipelineStage.TAGGING] = KnowledgeTagFilter(self.config)
        self.async_filters.append(PipelineStage.TAGGING)

    async def process_stream(
        self,
        raw_stream: AsyncIterator[str],
        ctx: PipelineContext,
    ) -> AsyncIterator[str]:
        """
        流式处理主入口。
        逐块接收模型原始输出，经管线处理后逐块输出。

        流程：
        1. 解析每个 chunk（提取公式、代码块边界等）
        2. 安全过滤（累积到一定长度后检测）
        3. 学科校验（公式语法检查）
        4. 适龄化（语言简化/复杂化标记）
        5. 格式规范化（Markdown/LaTeX 规范化）
        6. 质量评分（最终打分）
        7. 知识点标注（异步，不阻塞流式输出）
        """
        chunk_buffer = []
        buffer_size = 0
        safety_check_interval = self.config.safety_check_interval  # 字符数间隔

        try:
            async for raw_chunk in raw_stream:
                ctx.raw_chunks.append(raw_chunk)
                ctx.accumulated_text += raw_chunk

                # ── 阶段1: 解析 ──
                ctx.start_stage(PipelineStage.PARSE)
                parsed = await self.filters[PipelineStage.PARSE].process_chunk(
                    raw_chunk, ctx
                )
                ctx.end_stage()

                # ── 阶段2: 安全过滤（累积检测） ──
                chunk_buffer.append(parsed)
                buffer_size += len(parsed)

                if buffer_size >= safety_check_interval:
                    ctx.start_stage(PipelineStage.SAFETY)
                    buffer_text = "".join(chunk_buffer)
                    safe_text, safety_result = await self.filters[
                        PipelineStage.SAFETY
                    ].process_chunk(buffer_text, ctx)
                    ctx.safety_result = safety_result
                    ctx.end_stage()

                    if safety_result.blocked:
                        # 内容被拦截，输出替代消息并终止流
                        yield self._build_blocked_response(safety_result)
                        await self._run_async_pipeline(ctx)
                        return

                    # ── 阶段3: 学科内容校验 ──
                    ctx.start_stage(PipelineStage.SUBJECT)
                    checked_text = await self.filters[
                        PipelineStage.SUBJECT
                    ].process_chunk(safe_text, ctx)
                    ctx.end_stage()

                    # ── 阶段4: 适龄化处理 ──
                    ctx.start_stage(PipelineStage.AGE_ADAPT)
                    adapted_text = await self.filters[
                        PipelineStage.AGE_ADAPT
                    ].process_chunk(checked_text, ctx)
                    ctx.end_stage()

                    # ── 阶段5: 格式规范化 ──
                    ctx.start_stage(PipelineStage.FORMAT)
                    formatted_text = await self.filters[
                        PipelineStage.FORMAT
                    ].process_chunk(adapted_text, ctx)
                    ctx.end_stage()

                    chunk_buffer.clear()
                    buffer_size = 0
                    ctx.processed_chunks.append(formatted_text)
                    ctx.emitted_chars += len(formatted_text)
                    yield formatted_text

                elif buffer_size > 0:
                    # 未到检测阈值，先做轻量格式化
                    ctx.start_stage(PipelineStage.FORMAT)
                    formatted = await self.filters[
                        PipelineStage.FORMAT
                    ].process_chunk(parsed, ctx)
                    ctx.end_stage()
                    ctx.processed_chunks.append(formatted)
                    ctx.emitted_chars += len(formatted)
                    yield formatted

            # 处理剩余缓冲区
            if chunk_buffer:
                remaining = "".join(chunk_buffer)
                ctx.start_stage(PipelineStage.SAFETY)
                safe_text, safety_result = await self.filters[
                    PipelineStage.SAFETY
                ].process_chunk(remaining, ctx)
                ctx.safety_result = safety_result
                ctx.end_stage()

                if not safety_result.blocked:
                    ctx.start_stage(PipelineStage.FORMAT)
                    formatted = await self.filters[
                        PipelineStage.FORMAT
                    ].process_chunk(safe_text, ctx)
                    ctx.end_stage()
                    ctx.processed_chunks.append(formatted)
                    ctx.emitted_chars += len(formatted)
                    yield formatted

            # ── 阶段6: 质量评分（流结束后） ──
            ctx.start_stage(PipelineStage.QUALITY)
            ctx.quality_score = await self.filters[
                PipelineStage.QUALITY
            ].score(ctx.accumulated_text, ctx)
            ctx.end_stage()

            # ── 阶段7: 异步管线（知识点标注等） ──
            await self._run_async_pipeline(ctx)

        except Exception as e:
            # 管线异常不应导致用户看不到内容
            # 降级：直接输出原始 chunk
            yield self._build_error_fallback(e, ctx)
            await self._emit_pipeline_error(e, ctx)

    async def _run_async_pipeline(self, ctx: PipelineContext):
        """运行异步阶段（不阻塞流式输出）"""
        tasks = []
        for stage in self.async_filters:
            if stage in self.filters:
                tasks.append(self._run_async_stage(stage, ctx))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _run_async_stage(self, stage: PipelineStage, ctx: PipelineContext):
        ctx.start_stage(stage)
        try:
            result = await self.filters[stage].process_full(ctx.accumulated_text, ctx)
            if stage == PipelineStage.TAGGING:
                ctx.detected_knowledge_points = result.get("knowledge_points", [])
                ctx.references = result.get("references", [])
        finally:
            ctx.end_stage()

    def _build_blocked_response(self, safety_result: 'SafetyResult') -> str:
        """构建安全拦截后的替代回答"""
        replacements = {
            "violence": "这个问题我暂时无法回答，换一个学习问题试试吧～",
            "politics": "这个问题超出了学习范围，我们来讨论课本相关的内容吧～",
            "adult": "这个问题不适合在这里讨论，请专注于学习哦～",
            "default": "这个问题我暂时无法回答，换个学习问题试试吧～",
        }
        return replacements.get(
            safety_result.block_category, replacements["default"]
        )

    def _build_error_fallback(self, error: Exception, ctx: PipelineContext) -> str:
        """管线异常时的降级输出。

        v1.0 缺陷修正：原实现 ctx.raw_chunks[len(ctx.processed_chunks):] 假设
        raw 与 processed 逐块一一对应，实际安全缓冲合并后数量不对齐，
        可能重复输出已 yield 的内容或丢失未输出内容。
        正确做法：以已输出字符数 emitted_chars 为游标，从累积原文中截取剩余部分。
        """
        emitted = getattr(ctx, "emitted_chars", 0)
        remaining_raw = ctx.accumulated_text[emitted:]
        if remaining_raw:
            return remaining_raw
        # 没有剩余内容（异常发生在两次输出之间）则不追加输出
        return ""

    async def _emit_pipeline_error(self, error: Exception, ctx: PipelineContext):
        """上报管线异常到监控系统"""
        # 发送事件到监控系统
        pass
```

### 2.2 过滤器基类

```python
# server/services/ai/pipeline/filters/base.py

from abc import ABC, abstractmethod
from typing import Any, Optional, Tuple


class BaseFilter(ABC):
    """管线过滤器基类"""

    def __init__(self, config: 'PipelineConfig'):
        self.config = config
        self.enabled = True

    @abstractmethod
    async def process_chunk(self, chunk: str, ctx: 'PipelineContext') -> str:
        """
        处理单个文本块（流式模式）。
        必须是无状态或仅依赖 ctx 的操作。
        """
        return chunk

    async def process_full(self, full_text: str, ctx: 'PipelineContext') -> Any:
        """
        处理完整文本（非流式模式，用于异步阶段）。
        默认实现逐块调用 process_chunk。
        """
        return await self.process_chunk(full_text, ctx)

    async def score(self, text: str, ctx: 'PipelineContext') -> float:
        """质量评分，仅 QualityScoreFilter 实现"""
        return 0.0
```

### 2.3 管线配置

```python
# server/services/ai/pipeline/config.py

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class PipelineConfig:
    """管线配置（从配置中心动态加载）"""

    # 安全过滤配置
    safety_check_interval: int = 200          # 每200字符做一次安全检测
    safety_strict_mode: bool = True           # 严格模式（拦截所有可疑内容）
    safety_categories: List[str] = field(default_factory=lambda: [
        "violence", "politics", "adult", "gambling", "cult",
        "insult", "contraband", "ad_fraud"
    ])

    # 学科校验配置
    formula_syntax_check: bool = True         # 公式语法检查
    fact_check_enabled: bool = False          # 事实性检查（V2.0）
    fact_check_threshold: float = 0.8

    # 适龄化配置
    age_adapt_enabled: bool = True
    max_sentence_length: dict = field(default_factory=lambda: {
        "kindergarten": 15,    # 幼儿：≤15字/句
        "primary_low": 20,     # 小学低年级：≤20字/句
        "primary_high": 30,    # 小学高年级：≤30字/句
        "junior": 40,          # 初中：≤40字/句
        "senior": 60,          # 高中：≤60字/句
    })

    # 格式规范化配置
    latex_normalize: bool = True              # LaTeX 公式规范化
    markdown_normalize: bool = True           # Markdown 格式规范化
    auto_detect_formulas: bool = True         # 自动检测未标记的公式

    # 质量评分配置
    quality_scoring_enabled: bool = True
    quality_min_score: float = 0.4            # 低于此分数触发质量告警
    quality_auto_retry: bool = False          # 自动重试（V2.0）

    # 知识点标注配置
    tagging_enabled: bool = True
    tagging_max_kps: int = 10                 # 最多标注知识点数
    tagging_min_confidence: float = 0.6       # 最低置信度

    # 性能配置
    max_pipeline_latency_ms: int = 200        # 单块最大管线延迟
    async_stage_timeout_ms: int = 3000        # 异步阶段超时
```

---

## 3. 各过滤器详细设计

### 3.1 原始输出解析过滤器 (ParseFilter)

**职责**：解析模型原始输出，识别特殊标记、公式边界、代码块边界等。

```python
# server/services/ai/pipeline/filters/parse_filter.py

import re
from typing import List, Tuple


class ParseFilter(BaseFilter):
    """
    解析模型原始输出，提取结构信息。
    
    主要任务：
    1. 识别 LaTeX 公式边界（$...$, $$...$$, \[...\], \(...\)）
    2. 识别代码块边界（```...```）
    3. 识别步骤标记（【步骤1】、Step 1、第一步 等）
    4. 识别选择题选项标记（A. B. C. D.）
    5. 检测换行段落边界
    """

    # 步骤标记模式
    STEP_PATTERNS = [
        re.compile(r'【步骤(\d+)】'),
        re.compile(r'[Ss]tep\s*(\d+)'),
        re.compile(r'第([一二三四五六七八九十\d]+)[步部分]'),
        re.compile(r'(\d+)\.\s'),  # 数字序号
    ]

    # LaTeX 公式边界
    LATEX_BLOCK_START = re.compile(r'^\s*\$\$')
    LATEX_BLOCK_END = re.compile(r'\$\$\s*$')
    LATEX_INLINE = re.compile(r'(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)')
    LATEX_ESCAPED = re.compile(r'\\\[(.+?)\\\]|\\\((.+?)\\\)')

    # 代码块边界
    CODE_BLOCK_START = re.compile(r'^```(\w*)')
    CODE_BLOCK_END = re.compile(r'^```\s*$')

    async def process_chunk(self, chunk: str, ctx: 'PipelineContext') -> str:
        """解析单个 chunk，更新 ctx 中的元数据"""
        # 检测公式
        if self.config.auto_detect_formulas:
            self._detect_formulas(chunk, ctx)

        # 检测步骤标记
        self._detect_steps(chunk, ctx)

        return chunk

    def _detect_formulas(self, text: str, ctx: 'PipelineContext'):
        """检测文本中的公式"""
        # 行内公式
        for match in self.LATEX_INLINE.finditer(text):
            ctx.detected_formulas.append({
                "type": "inline",
                "latex": match.group(1),
                "position": match.start(),
                "source": "detected",
            })

        # 块级公式
        for match in self.LATEX_ESCAPED.finditer(text):
            latex = match.group(1) or match.group(2) or ""
            ctx.detected_formulas.append({
                "type": "block",
                "latex": latex,
                "position": match.start(),
                "source": "detected",
            })

    def _detect_steps(self, text: str, ctx: 'PipelineContext'):
        """检测步骤标记"""
        for pattern in self.STEP_PATTERNS:
            if pattern.search(text):
                ctx.metadata.setdefault("has_structured_steps", True)
                break
```

### 3.2 内容安全过滤器 (SafetyFilter)

**职责**：对 AI 回答内容进行安全审核，拦截不适宜内容。

```python
# server/services/ai/pipeline/filters/safety_filter.py

from dataclasses import dataclass
from typing import List, Optional, Tuple
from enum import Enum


class SafetyLevel(str, Enum):
    SAFE = "safe"                # 安全，直接通过
    SUSPICIOUS = "suspicious"    # 可疑，需人工复审（先通过）
    BLOCKED = "blocked"          # 拦截，替换为安全回答


@dataclass
class SafetyResult:
    level: SafetyLevel
    blocked: bool
    block_category: Optional[str] = None
    block_reason: Optional[str] = None
    risk_scores: dict = None     # {"violence": 0.01, "politics": 0.85, ...}
    flagged_segments: List[dict] = None
    moderator_id: Optional[str] = None  # 审核模型/服务ID
    latency_ms: float = 0.0


class SafetyFilter(BaseFilter):
    """
    内容安全过滤：调用安全审核服务检测敏感内容。

    架构设计：
    ┌───────────────────────────────────────────┐
    │           SafetyFilter                     │
    │                                            │
    │  ┌─────────┐  ┌─────────┐  ┌──────────┐  │
    │  │ 本地规则 │  │ 关键词库 │  │ 云端审核  │  │
    │  │ 快速过滤 │  │ 精确匹配 │  │ AI深度检测│  │
    │  └────┬────┘  └────┬────┘  └─────┬────┘  │
    │       │            │             │        │
    │       └────────┬───┘             │        │
    │                ▼                 │        │
    │          确定安全？ ──YES──→ 通过 │        │
    │              │                   │        │
    │             NO          疑似敏感？│        │
    │              │               │   │        │
    │              ▼               ▼   ▼        │
    │           本地拦截     提交云端深度检测    │
    └───────────────────────────────────────────┘

    详见：安全与内容合规系统-详细设计.md
    """

    def __init__(self, config: 'PipelineConfig'):
        super().__init__(config)
        self._init_local_rules()

    def _init_local_rules(self):
        """初始化本地快速过滤规则"""
        # 敏感关键词列表（从配置中心加载，支持热更新）
        self.blocked_keywords: List[str] = []
        self.suspicious_keywords: List[str] = []

        # 正则规则
        self.phone_pattern = re.compile(
            r'1[3-9]\d{9}|(\d{3,4}[-\s]?\d{7,8})'
        )
        self.id_card_pattern = re.compile(
            r'\d{17}[\dXx]'
        )
        self.url_pattern = re.compile(
            r'https?://[^\s<>"{}|\\^`\[\]]+'
        )

    async def process_chunk(
        self, chunk: str, ctx: 'PipelineContext'
    ) -> Tuple[str, SafetyResult]:
        """处理文本块，返回 (处理后的文本, 安全检测结果)"""

        risk_scores = {}
        flagged_segments = []

        # ── 第1层：本地规则快速过滤 ──
        local_result = self._local_check(chunk)
        if local_result.level == SafetyLevel.BLOCKED:
            return chunk, local_result

        # ── 第2层：关键词匹配 ──
        keyword_result = self._keyword_check(chunk)
        risk_scores.update(keyword_result.get("risk_scores", {}))
        flagged_segments.extend(keyword_result.get("flagged", []))

        # ── 第3层：云端审核服务 ──
        cloud_result = await self._cloud_check(chunk, ctx)
        risk_scores.update(cloud_result.get("risk_scores", {}))
        flagged_segments.extend(cloud_result.get("flagged", []))

        # ── 综合判定 ──
        max_risk = max(risk_scores.values()) if risk_scores else 0.0
        blocked_categories = [
            cat for cat, score in risk_scores.items()
            if score >= 0.8
        ]

        if blocked_categories and self.config.safety_strict_mode:
            return chunk, SafetyResult(
                level=SafetyLevel.BLOCKED,
                blocked=True,
                block_category=blocked_categories[0],
                block_reason=f"高风险类别: {', '.join(blocked_categories)}",
                risk_scores=risk_scores,
                flagged_segments=flagged_segments,
                moderator_id=cloud_result.get("moderator_id"),
            )
        elif max_risk >= 0.5:
            return chunk, SafetyResult(
                level=SafetyLevel.SUSPICIOUS,
                blocked=False,
                risk_scores=risk_scores,
                flagged_segments=flagged_segments,
            )
        else:
            return chunk, SafetyResult(
                level=SafetyLevel.SAFE,
                blocked=False,
                risk_scores=risk_scores,
                flagged_segments=flagged_segments,
            )

    def _local_check(self, text: str) -> SafetyResult:
        """本地规则检查：PII脱敏检测、URL过滤"""
        # 检测手机号、身份证号等个人信息泄露
        if self.phone_pattern.search(text) or self.id_card_pattern.search(text):
            # 标记但不拦截，交由后续脱敏处理
            pass

        # 检测外部URL（可能引导到不安全网站）
        urls = self.url_pattern.findall(text)
        if urls and self.config.safety_strict_mode:
            return SafetyResult(
                level=SafetyLevel.SUSPICIOUS,
                blocked=False,
                risk_scores={"external_url": 0.6},
                flagged_segments=[
                    {"type": "url", "content": u, "policy": "strip"}
                    for u in untrusted
                ],
                moderator_id="local_rule",
            )

        # 无命中：安全通过
        return SafetyResult(
            level=SafetyLevel.SAFE,
            blocked=False,
            risk_scores={},
            flagged_segments=[],
            moderator_id="local_rule",
        )

    def _is_trusted_url(self, url: str) -> bool:
        """可信域名白名单：教材CDN/官网/帮助中心/题库图片域。
        列表从配置中心 key=ai.pipeline.safety.url_whitelist 加载，支持热更新。"""
        return any(domain in url for domain in self.trusted_domains)

    def _keyword_check(self, text: str) -> dict:
        """第2层：AC自动机关键词匹配（复用敏感词过滤引擎的词库与分类体系）"""
        hits = self.ac_automaton.search(text)   # [(start, end, word_id)]
        if not hits:
            return {"risk_scores": {}, "flagged": []}

        risk_scores, flagged = {}, []
        for start, end, word_id in hits:
            word = self.word_dict[word_id]       # {term, category, level}\n            cat = word["category"]               # violence/politics/adult/...
            if word["level"] == "block":        # 一级敏感词：直接拉满该类风险分
                risk_scores[cat] = max(risk_scores.get(cat, 0.0), 1.0)
            else:                                 # 二级可疑词：累加，封顶0.9
                risk_scores[cat] = min(
                    risk_scores.get(cat, 0.0) + word["weight"], 0.9
                )
            flagged.append({
                "type": "keyword", "term": word["term"],
                "category": cat, "position": [start, end],
                "level": word["level"],
            })
        return {"risk_scores": risk_scores, "flagged": flagged}

    async def _cloud_check(self, text: str, ctx: 'PipelineContext') -> dict:
        """第3层：云端深度检测。两种路由：
        - 流式会话（ctx.scene 在 SSE 链路中）：委托 SOSF 流式安全中间件，
          由其在 SSE 管道内完成 L2/L3 深度检测，本方法仅合并其增量结果；
        - 非流式场景（批产/后台内容生成）：直接调用内容安全审核服务。
        超时(150ms)降级：放行 + 标记 suspicious + 投递异步复检队列。"""
        try:
            return await asyncio.wait_for(
                self.moderation_client.check(
                    text=text,
                    scene=ctx.scene,
                    user_id=ctx.user_id,
                    categories=self.config.safety_categories,
                ),
                timeout=0.15,
            )
        except asyncio.TimeoutError:
            await self.async_recheck_queue.enqueue(
                {"message_id": ctx.message_id, "text": text, "reason": "cloud_timeout"}
            )
            return {
                "risk_scores": {"cloud_timeout": 0.3},
                "flagged": [],
                "degraded": True,
                "moderator_id": "timeout-degraded",
            }

    async def on_config_changed(self, new_conf: dict):
        """配置中心回调：词库/白名单热更新（双缓冲原子切换）"""
        self.blocked_keywords = new_conf.get("blocked_keywords", self.blocked_keywords)
        self.suspicious_keywords = new_conf.get(
            "suspicious_keywords", self.suspicious_keywords
        )
        self.trusted_domains = new_conf.get("url_whitelist", self.trusted_domains)
        self.ac_automaton = build_ac_automaton(self.blocked_keywords + self.suspicious_keywords)
        self.word_dict = new_conf.get("word_dict", self.word_dict)
```

**与 SOSF 流式安全中间件的边界（重要）：**

| 场景 | 安全检测执行方 | ARPP 职责 |
| --- | --- | --- |
| SSE 流式会话（在线对话/拍题解析流式输出） | SOSF 中间件（L1 AC自动机 + L2 语义 + L3 云端），单 chunk <20ms | ARPP 的 SAFETY 阶段消费 SOSF 的拦截/替换事件，负责替代文案注入、流终止与审计事件落库 |
| 非流式场景（后台批产、缓存预热、离线任务、非流式API） | ARPP SafetyFilter 自身三层检测 | 全量检测 + 拦截替换 |

两套词库同源（均来自《服务端-教育场景敏感词多层次过滤与内容安全规则引擎》的词库与分类体系），拦截判定阈值统一为 `risk_score >= 0.8` 且 strict_mode 开启。

**拦截后的替代文案策略表：**

| 拦截类别 | 替代文案（按学段二次适配） | 后续动作 |
| --- | --- | --- |
| violence/adult/gambling/cult | 默认引导文案 + 幼儿版加表情符号 | 发 `ai.response.blocked` 事件 → AI对话安全审计服务 |
| politics | 引导回课本内容 | 同上 + 运营日报计数 |
| insult | 提示友善交流 | 不中断流，替换该段 |
| external_url（不可信） | 剥离 URL 后继续输出，段尾追加“链接已过滤” | 计数监控 |

---

### 3.3 学科内容校验过滤器 (SubjectCheckFilter)

**职责**：对回答中的学科元素做轻量级正确性/规范性校验。**只标注不拦截**（流式场景下拦截学科内容会误伤正常推导），校验结果写入 `ctx.subject_check_result`，供质量评分阶段加权与异步深度复核使用。

```python
# server/services/ai/pipeline/filters/subject_check_filter.py

import re
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class SubjectIssue:
    kind: str            # latex_syntax / chem_unbalanced / unit_missing / number_anomaly
    severity: str        # warning / error
    position: tuple      # (start, end)
    detail: str
    suggestion: Optional[str] = None


@dataclass
class SubjectCheckResult:
    issues: List[SubjectIssue] = field(default_factory=list)
    formulas_checked: int = 0
    equations_checked: int = 0
    passed: bool = True   # 无 error 级问题即通过


class SubjectCheckFilter(BaseFilter):
    """学科内容校验：
    1. LaTeX 公式语法校验（委托学科公式LaTeX统一解析引擎的轻量语法检查）
    2. 化学方程式配平快检（元素守恒快速比对）
    3. 物理量单位缺失提醒（公式后无单位标注）
    4. 数值自洽快检（步骤间数值突变检测）
    深度事实性校验不在本层——由幻觉检测引擎异步执行。
    """

    CHEM_EQ_PATTERN = re.compile(r'([A-Z][a-z]?\d*)+([=→]|\\rightarrow)([A-Z][a-z]?\d*)+')
    UNIT_HINT = re.compile(r'(?<=[\d}])\s*(?=[，。；]|$)')  # 数字后直接标点 → 疑似缺单位

    async def process_chunk(self, chunk: str, ctx: 'PipelineContext') -> str:
        result = ctx.subject_check_result or SubjectCheckResult()

        if self.config.formula_syntax_check:
            for f in ctx.detected_formulas:
                if f.get("checked"):
                    continue
                ok, err = self.latex_service.quick_syntax_check(f["latex"])
                result.formulas_checked += 1
                f["checked"] = True
                if not ok:
                    result.issues.append(SubjectIssue(
                        kind="latex_syntax", severity="warning",
                        position=(f["position"], f["position"] + len(f["latex"])),
                        detail=f"公式语法可疑: {err}",
                    ))

            for m in self.CHEM_EQ_PATTERN.finditer(chunk):
                result.equations_checked += 1
                if not self._chem_balanced(m.group()):
                    result.issues.append(SubjectIssue(
                        kind="chem_unbalanced", severity="warning",
                        position=(m.start(), m.end()),
                        detail="化学方程式疑似未配平",
                        suggestion="请检查系数",
                    ))

        ctx.subject_check_result = result
        return chunk  # 原文透传

    def _chem_balanced(self, eq: str) -> bool:
        """元素守恒快检：两侧元素计数字典比对（不含电子/条件上标）"""
        left, _, right = re.split(r'[=→]|\\rightarrow', eq)
        return self._count_elements(left) == self._count_elements(right)

    def _count_elements(self, side: str) -> dict:
        counts = {}
        for sym, n in re.findall(r'([A-Z][a-z]?)(\d*)', side):
            counts[sym] = counts.get(sym, 0) + (int(n) if n else 1)
        return counts
```

**校验结果消费方式：**

| 消费方 | 用法 |
| --- | --- |
| QualityScoreFilter（§3.7） | error 级 issue 数量参与扣分 |
| 幻觉检测引擎（异步） | `subject_check_result.issues` 作为深度复核的定向线索 |
| 客户端（P2） | 问答卡片角标“内容已校验/部分存疑”，由 SSE `knowledge_ref` 事件携带 |

---

### 3.4 适龄化处理过滤器 (AgeAdaptFilter)

**职责**：委托《服务端-AI回答适龄化处理与学段表达适配引擎》对回答做学段适配。**流式安全策略：只对小段落（句界缓冲）做替换，且仅幼儿/小学低年级启用重写，其余学段只做难度评估打标。**

```python
# server/services/ai/pipeline/filters/age_adapt_filter.py

import re


class AgeAdaptFilter(BaseFilter):
    """适龄化过滤器：
    - kindergarten / primary_low：句界缓冲 + 调用适龄化引擎改写（同步，预算内）
    - primary_high 及以上：仅评估难度分并写入 metadata（打标不改写）
    - 引擎超时(300ms)/异常：原文透传 + 标记 adapt_skipped
    """

    REWRITE_STAGES = {"kindergarten", "primary_low"}
    SENTENCE_END = re.compile(r'(?<=[。！？!?；;])')

    def __init__(self, config):
        super().__init__(config)
        self._hold = ""                # 句界保持缓冲（跨 chunk 未闭合句子）
        self._lock = asyncio.Lock()    # 顺序保证

    async def process_chunk(self, chunk: str, ctx: 'PipelineContext') -> str:
        if not self.config.age_adapt_enabled:
            return chunk
        stage = ctx.student_profile.stage_key   # kindergarten/primary_low/...

        if stage not in self.REWRITE_STAGES:
            # 高学段：只打难度标（轻量，不打外部调用，用本地启发式）
            ctx.age_adapt_metadata = {
                "mode": "assess_only",
                "long_sentence_count": self._count_long_sentences(
                    chunk, self.config.max_sentence_length[stage]
                ),
            }
            return chunk

        async with self._lock:
            buf = self._hold + chunk
            # 切出完整句，尾部不完整句留在缓冲
            parts = self.SENTENCE_END.split(buf)
            complete, self._hold = parts[:-1], parts[-1]
            if not complete:
                return ""                      # 无完整句：暂不输出
            text = "".join(complete)
            try:
                resp = await asyncio.wait_for(
                    self.age_engine.process(
                        text=text,
                        student_id=ctx.user_id,
                        age_group=stage,
                        subject=ctx.subject,
                        context={"conversation_id": ctx.conversation_id},
                        options={"max_rewrite_rounds": 1,      # 流式内只跑一轮
                                 "enable_analogy_replacement": True},
                    ),
                    timeout=0.3,
                )
                ctx.age_adapt_metadata = {
                    "mode": "rewrite",
                    "original_difficulty": resp["original_difficulty"]["overall_score"],
                    "adapted_difficulty": resp["adapted_difficulty"]["overall_score"],
                    "changes": len(resp.get("changes_applied", [])),
                }
                return resp["adapted_text"]
            except (asyncio.TimeoutError, Exception):
                ctx.age_adapt_metadata = {"mode": "adapt_skipped"}
                return text                   # 降级：原句输出

    async def flush(self, ctx) -> str:
        """流结束时满出缓冲尾巴"""
        tail, self._hold = self._hold, ""
        return tail

    def _count_long_sentences(self, text: str, limit: int) -> int:
        return sum(1 for s in re.split(r'[。！？!?；;]', text) if limit < len(s.strip()) <= 500)
```

**关键设计说明：**

1. **为什么按句界缓冲**：适龄化改写必须以完整句为最小单位，跨 chunk 的半个句子上引擎会误判；保持缓冲在流结束时由编排器调用 `flush()` 满出。
2. **为什么只跑一轮改写**：适龄化引擎支持多轮（离线场景 `max_rewrite_rounds=2+`），流式场景预算 300ms 只允许一轮，未达目标难度记录在 metadata 中，由异步阶段补一次评估（不追改已输出内容，仅入缓存供下次同题复用）。
3. **禁改区域**：公式块、代码块、题目原文引用不做改写（由引擎侧 `protected_spans` 保证，ARPP 在调用前把 `ctx.detected_formulas` 的位置区间传入）。

---

### 3.5 结构化增强过滤器 (StructureEnhanceFilter)

**职责**：确保回答符合设计文档 §9.4 的“分段卡片式结构”（问题理解 → 思路提示 → 详细步骤 → 总结）。**流式阶段只做检测与轻量补标，不重组内容**；结构补齐主要在非流式模式与缓存写入前完成。

```python
# server/services/ai/pipeline/filters/structure_filter.py

SECTION_TEMPLATES = {
    "tutoring":  ["问题理解", "思路提示", "详细步骤", "总结"],
    "photo_qa":  ["题目", "思路", "详细解答", "易错提醒"],
    "exercise": ["解析", "关键知识点", "方法总结"],
    "essay":    ["总体评价", "优点", "问题与建议", "下一步"],
}


class StructureEnhanceFilter(BaseFilter):
    """两种模式：
    - detect（流式）：识别已有分节标记，缺失的节记入 metadata.sections_missing
    - repair（非流式/缓存前）：对缺失节追加引导性小标题（仅在段落边界插入，
      绝不生成新内容、不改变模型论述顺序）
    """

    async def process_chunk(self, chunk: str, ctx: 'PipelineContext') -> str:
        # 流式模式：只检测（模板已有分节结构时不干预）
        template = SECTION_TEMPLATES.get(ctx.scene)
        if template:
            found = [s for s in template if s in ctx.accumulated_text]
            missing = [s for s in template if s not in ctx.accumulated_text]
            ctx.metadata["sections_found"] = found
            ctx.metadata["sections_missing"] = missing
        return chunk

    async def process_full(self, full_text: str, ctx: 'PipelineContext') -> str:
        """非流式/缓存写入前的结构修复"""
        template = SECTION_TEMPLATES.get(ctx.scene, [])
        text = full_text
        for section in template:
            if section not in text and self._should_insert(ctx, section):
                # 在首个段落边界后插入引导标题，内容用模型已有文本的就近段落
                text = self._insert_heading_after_first_para(text, section)
        return text

    def _should_insert(self, ctx, section: str) -> bool:
        # 高学段/短回答不强制补齐（<200字轻量问答免结构化）
        return len(ctx.accumulated_text) >= 200 and ctx.scene in ("tutoring", "photo_qa")

    def _insert_heading_after_first_para(self, text: str, section: str) -> str:
        paras = text.split("\n\n")
        if len(paras) < 2:
            return text
        paras.insert(1, f"**{section}**")   # 只插标题行
        return "\n\n".join(paras)
```

> **注意**：本过滤器与 Prompt 编排侧的约定是“双层保障”——Prompt 模板已要求模型按分节结构输出（见《AI-Prompt编排与场景模板系统》）；本过滤器是兜底防线，避免模型不邊守时前端卡片塌陷。`sections_missing` 会作为 Prompt 负反馈样本回流。

---
### 3.6 格式规范化过滤器 (FormatNormalizeFilter)

**职责**：Markdown/LaTeX/符号层面的统一规范化，保障客户端富文本渲染引擎（见《客户端-AI对话消息Markdown流式渲染与学科公式排版引擎》）能正确排版。

```python
# server/services/ai/pipeline/filters/format_filter.py

import re


class FormatNormalizeFilter(BaseFilter):
    """规范化规则表（全部为纯文本变换，无外部调用，单块 <5ms）：
    R1 LaTeX 定界符统一：\[..\]/\(..\) → $$..$$/$..$（客户端只认 $ 系）
    R2 未闭合公式保持：检测到 $$ 开头但未见闭合 → 持有该块至闭合（hold缓冲）
    R3 代码围栏补齐：``` 未闭合 → 流结束时补尾部 ```
    R4 Markdown 表格修复：表格行分隔符缺失 → 补 |---|
    R5 全角/半角：数学运算符周围空格规范化（a+b → a + b，仅 $ 内生效）
    R6 标题层级：禁止 # 一级标题（与产品标题冲突）→ 降为 ###
    R7 列表符号统一：*/•/- 混用 → 统一 -
    R8 步骤标记统一：【步骤1】/Step 1/第一步 → 统一 **步骤 1**
    """

    OPEN_BLOCK = re.compile(r'\$\$(?!.*\$\$)', re.S)      # 未闭合块级公式
    OPEN_CODE  = re.compile(r'^```(\w*)\n(?!.*^```)', re.S | re.M)
    H1 = re.compile(r'^# (?!#)', re.M)
    STEP_VARIANTS = re.compile(r'(【步骤(\d+)】|[Ss]tep\s*(\d+)|第([一二三四五六七八九十]+)步)')
    CN_NUM = {"一":1,"二":2,"三":3,"四":4,"五":5,"六":6,"七":7,"八":8,"九":9,"十":10}

    def __init__(self, config):
        super().__init__(config)
        self._block_hold = ""      # 跨 chunk 未闭合 $$ 代码块缓冲
        self._in_code_fence = False

    async def process_chunk(self, chunk: str, ctx: 'PipelineContext') -> str:
        if not self.config.markdown_normalize:
            return chunk
        buf = self._block_hold + chunk

        # R2: 块级公式闭合检测（奇偶计数）
        if buf.count('$$') % 2 == 1:
            self._block_hold = buf                # 持有至闭合
            return ""
        self._block_hold = ""

        # 代码围栏内不做任何变换（R3 记录状态）
        self._in_code_fence ^= (buf.count('```') % 2 == 1)
        if self._in_code_fence:
            return buf

        if self.config.latex_normalize:
            buf = self._normalize_latex_delims(buf)     # R1
            buf = self._normalize_math_spacing(buf)    # R5
        buf = self.H1.sub('### ', buf)                  # R6
        buf = self._normalize_lists(buf)                # R7
        buf = self._normalize_steps(buf)                # R8
        return buf

    async def flush(self, ctx) -> str:
        """流结束：补齐未闭合结构，防止渲染器悬挂"""
        out = self._block_hold
        self._block_hold = ""
        if self._in_code_fence:
            out += '\n```'
            self._in_code_fence = False
        elif out and out.count('$$') % 2 == 1:
            out += '$$'
        return out

    def _normalize_latex_delims(self, text: str) -> str:
        text = re.sub(r'\\\[(.+?)\\\]', r'$$\1$$', text, flags=re.S)
        return re.sub(r'\\\((.+?)\\\)', r'$\1$', text, flags=re.S)

    def _normalize_math_spacing(self, text: str) -> str:
        def _fix_inner(m):
            return re.sub(r'\s*([+\-*/=<>])\s*', r' \1 ', m.group(1))
        return re.sub(r'\$(?!\$)(.+?)(?<!\$)\$', _fix_inner, text)

    def _normalize_lists(self, text: str) -> str:
        return re.sub(r'^[•*] ', '- ', text, flags=re.M)

    def _normalize_steps(self, text: str) -> str:
        def _repl(m):
            n = m.group(2) or m.group(3) or self.CN_NUM.get(m.group(4), '?')
            return f'**步骤 {n}**'
        return self.STEP_VARIANTS.sub(_repl, text)
```

**与编排器的集成**：`FormatNormalizeFilter` 与 `AgeAdaptFilter` 均实现了 `flush()`；编排器在原始流耗尽后必须按注册逆序调用各过滤器 `flush()`，把保持缓冲一次性输出（见 §4.2 时序图 step ⑨）。

---

### 3.7 质量评分过滤器 (QualityScoreFilter)

**职责**：流结束后对完整回答打综合质量分，驱动缓存写入决策、低质量告警与回流。

```python
# server/services/ai/pipeline/filters/quality_filter.py

from dataclasses import dataclass


@dataclass
class QualityBreakdown:
    structure: float      # 结构完整性（分节/步骤/长度）
    subject: float        # 学科校验（公式/配平/单位）
    engagement: float     # 启发引导性（是否引导思考而非直给答案）
    safety_margin: float  # 安全裕度（suspicious 数量越多越低）
    overall: float        # 加权总分 0~1


class QualityScoreFilter(BaseFilter):
    """评分公式（无外部调用的启发式 + 消费上游已有结果）：
    overall = 0.35*structure + 0.35*subject + 0.20*engagement + 0.10*safety_margin

    说明：
    - 本层是“轻量实时分”，用于缓存门控与告警；
    - 权威质量评估由《AI输出质量校验与多模型复核引擎》Stage2 异步深度复核完成，
      其结果异步回填 ai_response_process_log.quality_score_deep；
    - quality_auto_retry=False（V1）：低分不自动重试，只告警+禁写缓存+回流样本库。
    """

    async def score(self, text: str, ctx: 'PipelineContext') -> float:
        b = QualityBreakdown(
            structure=self._score_structure(text, ctx),
            subject=self._score_subject(ctx),
            engagement=self._score_engagement(text),
            safety_margin=self._score_safety(ctx),
        )
        b.overall = round(
            0.35 * b.structure + 0.35 * b.subject
            + 0.20 * b.engagement + 0.10 * b.safety_margin, 4
        )
        ctx.metadata["quality_breakdown"] = b.__dict__

        if b.overall < self.config.quality_min_score:
            await self.event_bus.emit("ai.quality.low_score", {
                "message_id": ctx.message_id,
                "conversation_id": ctx.conversation_id,
                "score": b.overall,
                "breakdown": b.__dict__,
                "scene": ctx.scene,
                "model_id": ctx.model_id,
            })
            ctx.metadata["cache_write_allowed"] = False   # 低分禁写 AI 输出缓存
        return b.overall

    def _score_structure(self, text, ctx) -> float:
        missing = len(ctx.metadata.get("sections_missing", []))
        has_steps = ctx.metadata.get("has_structured_steps", False)
        length_ok = 30 <= len(text) <= 4000
        s = 1.0 - 0.15 * missing - (0.2 if not has_steps and ctx.scene == "tutoring" else 0)
        return max(0.0, min(1.0, s - (0.2 if not length_ok else 0)))

    def _score_subject(self, ctx) -> float:
        r = ctx.subject_check_result
        if r is None or (r.formulas_checked + r.equations_checked) == 0:
            return 0.8                      # 无学科元素：中性分
        errors = sum(1 for i in r.issues if i.severity == "error")
        warns = sum(1 for i in r.issues if i.severity == "warning")
        return max(0.0, 1.0 - 0.25 * errors - 0.08 * warns)

    def _score_engagement(self, text) -> float:
        """启发引导性：先问/提示再给答案的占比。启发式：提示词（想一想/试著/为什么）密度"""
        hints = sum(text.count(k) for k in ("想一想", "试著", "为什么", "你会怎么"))
        direct_answer_leak = len(text) < 100 and ("答案是" in text[:20])
        s = min(1.0, 0.5 + 0.15 * hints)
        return max(0.0, s - (0.3 if direct_answer_leak else 0))

    def _score_safety(self, ctx) -> float:
        sr = ctx.safety_result
        if sr is None:
            return 0.7
        if sr.level.value == "suspicious":
            return 0.5
        return 1.0 if sr.level.value == "safe" else 0.0
```

**分数消费矩阵：**

| 分数区间 | 缓存写入 | 展示策略 | 运营动作 |
| --- | --- | --- | --- |
| ≥ 0.8 | 允许（正常 TTL） | 正常展示 + “已校验”角标（P2） | 无 |
| 0.4 ~ 0.8 | 允许（TTL 减半） | 正常展示 | 无 |
| < 0.4（quality_min_score） | 禁止 | 正常展示（用户无感） | 告警 + 样本回流 Prompt 负反馈库 + 命中场景全量人工抽检 |
| 触发 answer_control（答案管控引擎联动） | 禁止 | 渐进式提示模式 | 违规 Prompt 样本入库 |

---

### 3.8 知识点标注过滤器 (KnowledgeTagFilter，异步)

**职责**：流式输出完成后，异步调用《AI回答知识点自动标注与溯源引用系统》的深度标注接口，提取知识点与引用溯源，回填对话记录与学习行为事件。

```python
# server/services/ai/pipeline/filters/knowledge_tag_filter.py


class KnowledgeTagFilter(BaseFilter):
    """仅运行于异步阶段（orchestrator._run_async_pipeline）：
    - 快速同步标注（<200ms，annotate_quick）已在 AI 对话引擎主链路完成，不重复跑；
    - 本过滤器只跑深度异步标注（实体识别 + 教材章节对齐 + 引用溯源）；
    - 结果不阻塞、不修改已输出内容，只回填 DB 并发 knowledge_ref 补推事件。
    """

    async def process_full(self, full_text: str, ctx: 'PipelineContext') -> dict:
        if not self.config.tagging_enabled:
            return {"knowledge_points": [], "references": []}
        try:
            annotation = await asyncio.wait_for(
                self.tagging_service.annotate_deep(
                    text=full_text,
                    subject_id=ctx.subject_id,
                    stage=ctx.student_profile.stage_key,
                    textbook_version=ctx.student_profile.textbook_version,
                    max_kps=self.config.tagging_max_kps,
                    min_confidence=self.config.tagging_min_confidence,
                    candidate_kps=ctx.metadata.get("quick_kp_hints", []),
                ),
                timeout=self.config.async_stage_timeout_ms / 1000,
            )
            # 回填对话记录（幂等：message_id 唯一键 upsert）
            await self.annotation_repo.upsert(ctx.message_id, annotation)
            # 补推 SSE knowledge_ref 事件（连接仍在时），供客户端卡片渲染知识点芯片
            await self.sse_pusher.try_push(
                ctx.conversation_id,
                event="knowledge_ref",
                payload={"message_id": ctx.message_id,
                         "knowledge_points": annotation.knowledge_points},
            )
            return {
                "knowledge_points": annotation.knowledge_points,
                "references": annotation.references,
            }
        except asyncio.TimeoutError:
            # 超时不丢弃：转入重试队列（指数退避，最多3次）
            await self.retry_queue.enqueue(
                "pipeline.tagging.retry", {"message_id": ctx.message_id}, delay=30
            )
            return {"knowledge_points": [], "references": [], "degraded": True}
```

---

## 4. 双模式协同：流式 / 非流式与 SOSF、SSE 的边界

### 4.1 模式判定

| 入口 | 模式 | 说明 |
| --- | --- | --- |
| AI 对话、拍题解析（在线用户） | STREAM（流式） | 编排器 `process_stream`，安全由 SOSF 主导 |
| 后台内容批量生成、缓存预热、离线报告生成 | BATCH（非流式） | 编排器 `process_full`，三层安全全量自跑 |
| 老消息重处理/修复任务 | REPLAY（重放） | BATCH + `ctx.metadata["replay"]=True`，事件去重

### 4.2 流式主链路时序（含 SOSF 与 SSE）

```text
用户端          AI对话引擎        SOSF          ARPP编排器        过滤器链           SSE引擎
 │  提问           │               │               │                │                 │
 │────────────────▶│               │               │                │                 │
 │                │ Prompt组装+RAG │               │                │                 │
 │                │────┐          │               │                │                 │
 │                │◀───┘          │               │                │                 │
 │                │ 模型流式调用   │               │                │                 │
 │                │────┐          │               │                │                 │
 │                │◀─┐ │ raw chunk │               │                │                 │
 │                │  │─┼──────────┼──────────────▶ │                │                 │
 │                │  │ │          │     ①PARSE     │                │                 │
 │                │  │ │          │  ②安全事件订阅◀─┼─ SOSF增量结论    │                 │
 │                │  │ │          │  ③SUBJECT(标注)│                │                 │
 │                │  │ │          │  ④AGE_ADAPT   │                │                 │
 │                │  │ │          │  ⑤FORMAT      │                │                 │
 │                │  │ │          │   out chunk   │                │                 │
 │                │  │ │          │────────────────┼───────────────▶│ text_delta      │
 │◀───────────────┼───┼──────────┼────────────────┼───────────────┼─┤                │
 │  ...(循环至流耗尽)...                                                              │
 │                │  │ │          │  ⑥flush(逆序)  │                │                 │
 │                │  │ │          │  ⑦QUALITY     │                │                 │
 │                │  │ │          │  ⑧BLOCKED? ───┼─ 替代文案注入    │ event:blocked   │
 │                │  │ │          │  ⑨TAGGING(异步)│                │ knowledge_ref  │
 │                │  │ │          │  ⑩落库+事件    │                │ session_end    │
 │◀───────────────────────────────────────────────────────────────────│                 │
```

**拦截时序（SOSF 判定 BLOCKED）：** SOSF 发出拦截事件 → ARPP 将已缓冲未输出的内容全部丢弃 → 注入 §3.2 替代文案（经 FORMAT 规范化）→ SSE 发 `event: blocked`（客户端停止增量渲染并展示替代文案）→ ARPP 发 `ai.response.blocked` 事件 → 审计服务落库 → 流终止（不再进入 QUALITY/TAGGING）。

### 4.3 非流式模式（BATCH）

```python
async def process_full(self, text: str, ctx: PipelineContext) -> PipelineResult:
    """非流式全量处理：安全三层全跑（不走SOSF）、结构修复启用、无flush概念"""
    ctx.accumulated_text = text
    parsed = await self.filters[PipelineStage.PARSE].process_chunk(text, ctx)
    safe_text, ctx.safety_result = await self.filters[PipelineStage.SAFETY].process_chunk(parsed, ctx)
    if ctx.safety_result.blocked:
        return self._finalize_blocked(ctx)
    checked = await self.filters[PipelineStage.SUBJECT].process_chunk(safe_text, ctx)
    adapted = await self.filters[PipelineStage.AGE_ADAPT].process_chunk(checked, ctx)
    adapted += await self.filters[PipelineStage.AGE_ADAPT].flush(ctx)
    structured = await self.filters[PipelineStage.STRUCTURE].process_full(adapted, ctx)
    formatted = await self.filters[PipelineStage.FORMAT].process_chunk(structured, ctx)
    formatted += await self.filters[PipelineStage.FORMAT].flush(ctx)
    ctx.quality_score = await self.filters[PipelineStage.QUALITY].score(formatted, ctx)
    await self._run_async_pipeline(ctx)
    return self._finalize(ctx, formatted)
```

---

## 5. API 接口与事件设计

### 5.1 对内 gRPC 接口（服务间）

```proto
service ARPPService {
  // 流式处理（AI对话引擎/SSE链路调用；实际以进程内调用为主，gRPC 用于跨服务场景）
  rpc ProcessStream(stream RawChunk) returns (stream ProcessedChunk);

  // 非流式全量处理（批产/缓存预热/重放）
  rpc ProcessFull(ProcessFullRequest) returns (ProcessFullResponse);

  // 过滤器健康与开关查询（运维用）
  rpc GetFilterStatus(Empty) returns (FilterStatusResponse);
}

message ProcessFullRequest {
  string text = 1;
  PipelineContextProto ctx = 2;      // user_id/scene/subject/student_profile摘要
  bool replay = 3;                    // 重放模式（事件幂等去重）
}

message ProcessFullResponse {
  string processed_text = 1;
  float  quality_score = 2;
  string safety_level = 3;            // safe/suspicious/blocked
  repeated KnowledgePointProto knowledge_points = 4;
  repeated ReferenceProto references = 5;
  map<string, string> metadata_json = 6;
}
```

### 5.2 管理接口（管理后台-AI模型与Prompt模板配置工作台 嵌入）

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/admin/v1/pipeline/config` | GET | 读取当前 PipelineConfig（脱敏后） |
| `/admin/v1/pipeline/filter/{stage}/toggle` | PUT | 过滤器级开关（双人审批 + 审计日志） |
| `/admin/v1/pipeline/dry-run` | POST | 输入样例文本，返回各阶段处理结果（配置预览） |
| `/admin/v1/pipeline/stats?window=1h` | GET | 各阶段拦截率/耗时/降级率 |

### 5.3 输出事件（Outbox，Kafka Topic：`ai.pipeline.events`）

| event_type | 触发时机 | 关键字段 | 消费方 |
| --- | --- | --- | --- |
| `ai.response.processed` | 流结束且未拦截 | message_id/quality_score/stage_timings/age_adapted/kps | 学习行为埋点、AI输出缓存、对话历史存储 |
| `ai.response.blocked` | SAFETY 判定 BLOCKED | message_id/category/reason/risk_scores | AI对话安全审计、运营日报 |
| `ai.response.suspicious` | SUSPICIOUS 且流结束 | message_id/flagged_segments | 人工抽检工作台（按 5% 抽样） |
| `ai.quality.low_score` | overall < 0.4 | message_id/breakdown | Prompt 负反馈回流、质量监控告警 |
| `ai.pipeline.error` | 管线异常降级 | message_id/stage/error_class | 日志告警、SLO 事故定位 |

**事件信封与幂等：** 统一信封 `{event_id, event_type, occurred_at, message_id, trace_id, payload}`；`event_id = ulid()`；消费方以 `event_id` 去重；Outbox 与消息落库同事务写入（复用《服务端统一回调中心》的 Outbox 基建）。

---

## 6. 数据落库设计

### 6.1 处理日志表 `ai_response_process_log`

```sql
CREATE TABLE ai_response_process_log (
    id               BIGINT PRIMARY KEY AUTO_INCREMENT,
    message_id       VARCHAR(64) NOT NULL COMMENT '对话消息ID',
    conversation_id  VARCHAR(64) NOT NULL,
    user_id          BIGINT NOT NULL,
    scene            VARCHAR(32) NOT NULL COMMENT 'tutoring/photo_qa/...',
    model_id         VARCHAR(64) NULL,
    mode             VARCHAR(8)  NOT NULL DEFAULT 'stream' COMMENT 'stream/batch/replay',
    outcome          VARCHAR(16) NOT NULL COMMENT 'COMPLETED/BLOCKED/FAILED/DEGRADED',
    safety_level     VARCHAR(16) NOT NULL COMMENT 'safe/suspicious/blocked',
    safety_detail    JSON NULL COMMENT 'risk_scores/flagged_segments/moderator_id',
    subject_issues   JSON NULL COMMENT '学科校验issues',
    age_adapt_meta   JSON NULL,
    quality_score    DECIMAL(4,3) NULL,
    quality_deep     DECIMAL(4,3) NULL COMMENT '深度复核回填分',
    kp_count         INT NOT NULL DEFAULT 0,
    stage_timings    JSON NULL COMMENT '{parse:0.2,safety:12.1,...}ms',
    raw_chars        INT NOT NULL DEFAULT 0,
    emitted_chars    INT NOT NULL DEFAULT 0,
    degraded_stages  JSON NULL COMMENT '发生降级的过滤器列表',
    created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_message (message_id),
    KEY idx_user_time (user_id, created_at),
    KEY idx_outcome_time (outcome, created_at)
) COMMENT='ARPP处理日志：每条AI回答一行，审计+质量分析双用途';
```

**保留策略：** 90 天热数据（MySQL）→ 归档至 ClickHouse（复用《服务端数据归档与生命周期管理策略》）。

### 6.2 埋点（复用统一埋点事件体系）

| 事件 | 属性 | 用途 |
| --- | --- | --- |
| `ai_pipeline_stage_timing` | stage/latency_ms/degraded | 各阶段延迟分布 |
| `ai_pipeline_blocked` | category/scene/model_id | 拦截率按场景下钻 |
| `ai_quality_score_dist` | bucket(0.1分档)/scene | 质量分布趋势 |

---

## 7. 错误处理与降级矩阵

| # | 故障场景 | 检测方式 | 降级动作 | 用户感知 | 恢复/补偿 |
| --- | --- | --- | --- | --- | --- |
| E1 | 云端安全审核超时(>150ms) | wait_for TimeoutError | 放行+suspicious+异步复检队列 | 无感 | 复检若判 blocked → 客服工单通道处理（仅记录，不撤回已输出） |
| E2 | 公式语法服务异常 | latex_service 抛错 | 跳过该项校验，issues 记 error?否：记 degraded | 无感 | 监控计数，恢复后对存量可疑公式补校 |
| E3 | 适龄化引擎超时(>300ms) | wait_for | 原句透传 + adapt_skipped | 低龄用户可能看到偏难表达 | 异步阶段补评估入缓存 |
| E4 | 知识点标注超时(>3s) | wait_for | 降级返回空 + 重试队列(30s/2m/10m) | 知识点芯片缺失，后续补推 | 重试成功后 SSE 补推 knowledge_ref |
| E5 | 质量引擎不可用 | 熔断器打开 | 仅启发式评分（subject 维度取中性分） | 无感 | 熔断半开探活恢复 |
| E6 | 管线自身异常 | try/except 兜底 | `_build_error_fallback` 输出剩余原文 | 可能看到未规范化文本 | `ai.pipeline.error` 事件 + trace 复盘 |
| E7 | 词库热更新失败 | 配置回调异常 | 继续用旧词库 | 无感 | 告警 `safety_wordlib_stale`，值班人工介入 |
| E8 | SOSF 未拦截但 ARPP 本地命中一级词 | 双层不一致（极少） | 以 ARPP 结果为准（更严格者优先） | 拦截替代文案 | 事件双报，规则组复盘不一致原因 |
| E9 | 重放(REPLAY)时 message 已有处理记录 | uk_message 冲突 | 跳过落库，仅重发缺失事件 | 无感 | 事件层 event_id 去重兜底 |
| E10 | 管线总开关 bypass（应急预案） | 管理后台 | 原文直出（仅保留本地一级词硬拦截） | 未规范化文本 | 仅 P0 事故授权启用，双人审批+审计 |

**熔断器配置（对每个外部依赖独立）：** 失败率>50%（窗口10s，最小20次）→ 打开 30s → 半开探活 3 次。安全审核服务熔断时升级为 E1 路径（全量异步复检 + suspicious）。

---

## 8. 状态机设计

### 8.1 消息处理状态机

```text
PENDING ──stream start──▶ STREAMING ──raw exhausted──▶ FINALIZING ──flush+score done──▶ FINALIZED
   │                          │                            │                            │
   │                          │ SAFETY=BLOCKED             │ 异常                        │ TAGGING成功
   │                          ▼                            ▼                            ▼
   └─────────────────────▶ BLOCKED                     FAILED                     ANNOTATED
                              │                                                       │
                              │ (TAGGING 仍执行，供审计)                                 │ (异步阶段超时→ 回 FINALIZED + 重试队列)
```

**守卫规则：**

| 守卫 | 规则 |
| --- | --- |
| G1 | STREAMING → BLOCKED 仅允许由 SAFETY 结果驱动；BLOCKED 后不得再进入 FINALIZING |
| G2 | FINALIZED 后禁止任何文本变更（AGE_ADAPT/FORMAT 已在 flush 前完成） |
| G3 | FINALIZED → ANNOTATED 只能由 TAGGING 成功触发；失败停留在 FINALIZED |
| G4 | FAILED 必须携带 emitted_chars 游标与降级文本快照，供补偿重放 |
| G5 | REPLAY 模式必须从 PENDING 重新走全链路，但落库受 uk_message 幂等保护 |

### 8.2 安全结果状态归档

`safe/suspicious/blocked` 三态随 `ai.response.processed` / `.suspicious` / `.blocked` 事件归档；blocked 样本 100% 进入《服务端-AI对话安全审计与敏感内容自动上报服务》，suspicious 按 5% 抽样进入人工抽检工作台。

---

## 9. 监控与告警

| 指标 | 类型 | 告警阈值 | 级别 |
| --- | --- | --- | --- |
| `arpp_stage_latency_ms{stage}` P99 | Histogram | FORMAT>20ms / SAFETY>150ms / 全管线>200ms | P2/P1/P1 |
| `arpp_block_rate` | Gauge（5min窗口） | >2%（基线0.5%）或环比翻倍 | P1（防误拦截） |
| `arpp_suspicious_rate` | Gauge | >8% | P2 |
| `arpp_quality_p20` | Gauge | <0.55 持续30min | P2（Prompt 质量滑坡） |
| `arpp_degraded_chunk_ratio` | Gauge | >1% | P2 |
| `arpp_tagging_retry_backlog` | Gauge | >5000 | P2 |
| `arpp_pipeline_error_total` | Counter | >50/hour | P1 |
| `safety_wordlib_stale_minutes` | Gauge | >30 | P2 |

**黄金指标看板（复用日志与监控告警体系）：** 流式回答量、拦截率按类别、质量分布热力图（scene×model）、降级率排汗、SSE 端到端延迟（首 token→首 text_delta）。

---

## 10. 配置项汇总与热更新

| 配置中心 Key | 对应字段 | 默认值 | 热更新 |
| --- | --- | --- | --- |
| `ai.pipeline.safety.check_interval` | safety_check_interval | 200 | ✅（下一条流生效） |
| `ai.pipeline.safety.strict_mode` | safety_strict_mode | true | ✅ |
| `ai.pipeline.safety.categories` | safety_categories | 8类 | ✅ |
| `ai.pipeline.safety.url_whitelist` | 可信域名 | 内置5域 | ✅ |
| `ai.pipeline.formula_check.enabled` | formula_syntax_check | true | ✅ |
| `ai.pipeline.age_adapt.enabled` | age_adapt_enabled | true | ✅ |
| `ai.pipeline.age_adapt.max_sentence` | max_sentence_length | 各学段表 | ✅ |
| `ai.pipeline.format.*` | latex/markdown_normalize | true | ✅ |
| `ai.pipeline.quality.min_score` | quality_min_score | 0.4 | ✅ |
| `ai.pipeline.tagging.*` | tagging 三项 | 见§2.3 | ✅ |
| `ai.pipeline.perf.max_latency_ms` | max_pipeline_latency_ms | 200 | ✅ |
| `ai.pipeline.bypass` | 应急总开关 | false | ⚠️ 双人审批，不在配置中心热更，仅管理后台带审计开关 |

**热更新机制：** 订阅配置中心（Nacos）`ai.pipeline.*` 命名空间 → 监听器重建 PipelineConfig（不可变对象整体替换）→ 正在进行的流继续用旧配置直至结束（避免同流内规则突变导致输出不一致）。

---

## 11. 安全与合规要点

1. **未成年人红线**：拦截文案本身需经适龄化（幼儿版无诱导性表情之外的符号）；blocked 事件不得携带原文全文出网（只带 message_id + 分类 + 分段指纹，审计系统按权限回查原文）。
2. **PII 最小化**：本地规则检测到的手机号/身份证号不写入埋点与事件，仅写入 safety_detail（JSON 脱敏为后四位）；完整脱敏由《服务端-数据脱敏规则引擎》统一执行。
3. **AIGC 标识联动**：ARPP 不注入水印文本（避免污染公式/代码块），由《服务端-AIGC内容标识与生成内容溯源水印系统》在 SSE 信封层与富文本渲染层加显式/隐式标识；ARPP 在 `ai.response.processed` 事件中携带 `aigc_label_ready=true` 供其触发。
4. **答案管控联动**：练习/作业场景（scene=exercise/homework）下，ARPP 不判断是否隐藏答案（由《答案管控与渐进式提示引擎》在 Prompt 与展示层主导）；QUALITY 的 `direct_answer_leak` 检测仅作回流统计。
5. **审计不可抵赖**：管理后台的过滤器开关、bypass 启用均写审计日志（谁/何时/前后值/审批人），见《服务端审计日志与操作追溯系统》。

---

## 12. 与其他文档的契约对齐表

| 对接文档 | 契约点 | 状态 |
| --- | --- | --- |
| 服务端-大模型流式输出实时安全过滤中间件（SOSF） | 流式安全主责方；ARPP 订阅其拦截事件；阈值统一 0.8 | ✅ §3.2/§4 |
| 服务端-教育场景敏感词多层次过滤引擎 | 词库/分类体系同源；AC 自动机构建规范 | ✅ §3.2 |
| 服务端-AI回答适龄化处理与学段表达适配引擎 | 内部 API `/internal/v1/age-adaptation/process`；流式内只跑一轮 | ✅ §3.4 |
| AI回答知识点自动标注与溯源引用系统 | 快速标注归对话引擎主链路，深度标注归 ARPP 异步阶段；upsert 幂等 | ✅ §3.8 |
| AI输出质量校验与多模型复核引擎 | 实时启发式分（ARPP）vs 权威深度分（引擎 Stage2）双轨；deep 分回填 | ✅ §3.7/§6.1 |
| 服务端-AI幻觉检测与教育事实校验引擎 | subject_check issues 作为其定向复核线索；并行异步不阻塞 | ✅ §3.3 |
| SSE流式响应与AI增量渲染引擎 | text_delta/formula_block/knowledge_ref/blocked 事件；首块延迟预算 | ✅ §4.2 |
| 服务端-学科公式LaTeX统一解析引擎 | quick_syntax_check 接口；R1 定界符统一为其渲染前提 | ✅ §3.3/§3.6 |
| AI-Prompt编排与场景模板系统 | 分节结构双层保障；sections_missing 负反馈回流 | ✅ §3.5 |
| AI输出缓存与智能复用引擎 | quality>=0.4 才可写入；低分禁写 | ✅ §3.7 |
| 服务端-AI对话安全审计与敏感内容自动上报 | blocked 事件 100% 消费；原文按权限回查 | ✅ §5.3/§11 |
| 服务端-AIGC内容标识与生成内容溯源水印系统 | ARPP 不注入水印，仅发 aigc_label_ready 标记 | ✅ §11.3 |
| 答案管控与渐进式提示引擎 | 隐藏答案决策不在 ARPP；leak 检测仅统计 | ✅ §11.4 |

---

## 13. 验收场景

1. 正常流式回答：所有阶段耗时在预算内，SSE 事件序列完整，落库 outcome=COMPLETED，事件 ai.response.processed 发出。
2. 一级敏感词出现在第 3 个缓冲窗口：该窗口替换为替代文案，前两窗口已输出内容保留，SSE 收到 event:blocked，审计事件落库。
3. 可疑内容（0.5≤risk<0.8）：流不中断，outcome=COMPLETED + safety_level=suspicious，进入 5% 抽样池。
4. 跨 chunk 的 $$ 公式块：FORMAT 的 hold 缓冲在闭合后一次性输出，客户端公式渲染无闪烁。
5. 流在公式块内耗尽（模型截断）：flush() 自动补 `$$` 闭合，渲染器不悬挂。
6. 幼儿用户长难句回答：AGE_ADAPT 句界缓冲改写生效，adapted_difficulty 落入目标区间，metadata 记录双难度分。
7. 适龄化引擎宕机：原文透传，adapt_skipped 记录，流不中断，告警不触发（降级预期内）。
8. 化学方程式未配平：subject_issues 记录 warning，质量分 subject 维度扣 0.08，回答仍正常展示。
9. 问答缺“思路提示”节：sections_missing 记录，缓存写入前（BATCH）补标题；回流样本库 +1。
10. 质量分 0.32：低分事件发出、缓存禁写、用户侧正常展示、告警 `ai_quality_p20` 评估样本 +1。
11. 知识点标注超时：DEGRADED 记录，重试队列 30s 后重试成功，SSE 补推 knowledge_ref。
12. 管线代码抛异常（注入测试）：剩余原文游标输出，无重复无丢失（emitted_chars 校验），FAILED + ai.pipeline.error。
13. 词库热更新：新词库在下一条流生效，当前流不受影响；更新失败 30min 告警。
14. bypass 应急开关：双人审批后启用，仅本地一级词拦截，审计日志完整。
15. REPLAY 重放：uk_message 冲突跳过落库，缺失事件按 event_id 去重补发。
16. 云端安全审核超时：E1 路径，异步复检判定 blocked 后工单通道生成记录（不撤回已输出内容，客服侧可见）。
17. 管理后台 dry-run：样例文本返回各阶段 diff 与耗时，配置变更可预览。

---

## 14. 附录：过滤器注册清单（实现对照）

| Stage | 类 | 模式 | 外部依赖 | 预算 |
| --- | --- | --- | --- | --- |
| PARSE | ParseFilter | 同步/流式 | 无 | 1ms/chunk |
| SAFETY | SafetyFilter | 同步+异步复检 | SOSF/敏感词库/审核服务 | 150ms/窗（流式委托 SOSF 时≈0） |
| SUBJECT | SubjectCheckFilter | 同步 | LaTeX 快检服务 | 20ms/窗 |
| AGE_ADAPT | AgeAdaptFilter | 同步（仅低学段改写） | 适龄化引擎 | 300ms/句批 |
| STRUCTURE | StructureEnhanceFilter | 流式检测/批修复 | 无 | 1ms/chunk |
| FORMAT | FormatNormalizeFilter | 同步/流式+flush | 无 | 5ms/chunk |
| QUALITY | QualityScoreFilter | 流结束 | 无（启发式） | 10ms/次 |
| TAGGING | KnowledgeTagFilter | 异步 | 标注系统 | 3000ms 上限 |

> 本文档为 AI 能力层后处理的唯一权威设计；流式安全细节以《服务端-大模型流式输出实时安全过滤中间件与动态拦截替换引擎》为准，两文档冲突时按 §4.1 边界表裁决。