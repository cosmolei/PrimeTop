# AI 回答后处理与智能优化管线 - 详细设计

> **版本**: v1.0 | **日期**: 2026-05-24 | **状态**: 初稿
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
    safety_result: Optional['SafetyResult'] = None
    subject_check_result: Optional['SubjectCheckResult'] = None
    age_adapt_metadata: Optional[dict] = None
    quality_score: Optional[float] = None
    detected_knowledge_points: List[dict] = field(default_factory=list)
    detected_formulas: List[dict] = field(default_factory=list)
    references: List[dict] = field(default_factory=list)

    # 性能追踪
    stage_timings: dict = field(default_factory=dict)
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
                    yield formatted_text

                elif buffer_size > 0:
                    # 未到检测阈值，先做轻量格式化
                    ctx.start_stage(PipelineStage.FORMAT)
                    formatted = await self.filters[
                        PipelineStage.FORMAT
                    ].process_chunk(parsed, ctx)
                    ctx.end_stage()
                    ctx.processed_chunks.append(formatted)
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
        """管线异常时的降级输出"""
        # 返回已处理的 + 原始未处理的
        return "".join(ctx.processed_chunks) + "".join(
            c for c in ctx.raw_chunks[len(ctx.processed_chunks):]
        )

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
                flagged_segments=[{"type": "url", "content": u