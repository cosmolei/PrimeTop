# AI 输出缓存与智能复用引擎 - 详细设计

## 1. 模块概述

### 1.1 定位与目标

AI 输出缓存与智能复用引擎是介于业务服务层与大模型 API 之间的中间件层，负责对 AI 调用结果进行缓存、检索和智能复用，以降低大模型调用成本、减少重复推理、提升响应速度。

核心目标：
1. **成本控制**：通过缓存命中减少大模型 API 调用次数，预期降低 30%-50% 的 API 成本
2. **响应加速**：缓存命中场景下将响应时间从秒级降至毫秒级
3. **质量保障**：确保缓存内容时效性，避免过时答案影响学习效果
4. **智能匹配**：基于语义相似度匹配缓存，而非仅依赖精确匹配

### 1.2 适用场景

| 场景 | 缓存价值 | 预期命中率 |
|------|---------|-----------|
| 高频基础题解析（同一道题多人提问） | 极高 | 60%-80% |
| 常见知识点讲解 | 高 | 40%-60% |
| 同教材版本章节预习/复习提问 | 中高 | 30%-50% |
| 个性化学习规划生成 | 中 | 20%-40% |
| 作文批改 | 低 | <10% |
| 多轮对话后续追问 | 极低 | <5% |

### 1.3 与其他模块关系

```
┌─────────────────────────────────────────────────┐
│                 业务调用方                         │
│  AI辅导 / 拍题答疑 / 练习测评 / 作文辅导 / ...    │
└──────────────────────┬──────────────────────────┘
                       │ AI请求
                       ▼
┌─────────────────────────────────────────────────┐
│          AI 输出缓存与智能复用引擎（本模块）       │
│  ┌─────────┐  ┌──────────┐  ┌────────────────┐  │
│  │缓存查询  │→│缓存写入   │→│生命周期管理     │  │
│  └─────────┘  └──────────┘  └────────────────┘  │
│  ┌─────────┐  ┌──────────┐  ┌────────────────┐  │
│  │语义匹配  │  │预热管线   │  │统计分析       │  │
│  └─────────┘  └──────────┘  └────────────────┘  │
└──────────────────────┬──────────────────────────┘
                       │ 缓存未命中时
                       ▼
┌─────────────────────────────────────────────────┐
│        多模型调度与成本治理（已有模块）             │
│              ↓ 大模型 API 调用                    │
└─────────────────────────────────────────────────┘
```

依赖模块：
- **多模型调度与成本治理**：缓存未命中时的 LLM 调用
- **RAG与知识库系统**：缓存 key 可关联知识点
- **数据埋点与关键指标系统**：缓存命中/未命中指标上报
- **题目与题库服务**：题目 ID 作为缓存 key 维度
- **配置中心与动态配置管理**：缓存策略热更新
- **知识点体系与教材映射引擎**：知识点维度缓存分区

---

## 2. 核心概念与数据模型

### 2.1 缓存键设计

缓存键采用多维度组合设计，确保缓存命中精度：

```python
class CacheKey:
    """缓存键模型"""
    
    # 场景类型：tutoring / photo_question / exercise / essay / planning / ...
    scene: str
    
    # 模型标识：不同模型的缓存互不干扰
    model_id: str
    
    # 标准化后的输入内容哈希（语义归一化后）
    input_hash: str  # SHA-256(归一化输入)
    
    # 上下文指纹：多轮对话场景的上下文摘要
    context_fingerprint: str | None
    
    # 辅助维度（用于缓存分区与失效）
    subject: str | None          # 学科
    grade_range: str | None      # 学段（primary/junior/senior）
    knowledge_point_ids: list[str] | None  # 关联知识点
    
    # Prompt 模板版本（模板更新时缓存失效）
    prompt_template_version: str
    
    def composite_key(self) -> str:
        """生成组合缓存键"""
        parts = [
            f"s:{self.scene}",
            f"m:{self.model_id}",
            f"h:{self.input_hash}",
            f"ptv:{self.prompt_template_version}",
        ]
        if self.context_fingerprint:
            parts.append(f"ctx:{self.context_fingerprint}")
        return "|".join(parts)
```

### 2.2 缓存条目模型

```sql
CREATE TABLE ai_cache_entries (
    id              BIGSERIAL PRIMARY KEY,
    composite_key   VARCHAR(255) NOT NULL UNIQUE,       -- 组合缓存键
    scene           VARCHAR(64)  NOT NULL,               -- 场景类型
    model_id        VARCHAR(64)  NOT NULL,               -- 模型标识
    
    -- 输入侧
    original_input  TEXT         NOT NULL,               -- 原始输入内容
    normalized_input TEXT        NOT NULL,               -- 归一化后的输入
    input_hash      VARCHAR(64)  NOT NULL,               -- SHA-256哈希
    input_embedding VECTOR(768),                         -- 输入向量化（用于语义匹配）
    
    -- 上下文
    context_fingerprint VARCHAR(64),                     -- 上下文指纹
    prompt_template_version VARCHAR(32) NOT NULL,        -- Prompt模板版本
    
    -- 输出侧
    output_content  TEXT         NOT NULL,               -- AI输出内容
    output_metadata JSONB,                               -- 元数据（tokens, latency, etc.）
    output_hash     VARCHAR(64)  NOT NULL,               -- 输出内容哈希（去重）
    
    -- 分区维度
    subject         VARCHAR(32),                         -- 学科
    grade_range     VARCHAR(32),                         -- 学段
    knowledge_point_ids INT[] DEFAULT '{}',              -- 关联知识点ID
    
    -- 策略
    cache_strategy  VARCHAR(32)  NOT NULL DEFAULT 'standard', -- 缓存策略
    ttl_seconds     INT          NOT NULL DEFAULT 86400, -- 生存时间（秒）
    
    -- 统计
    hit_count       INT          NOT NULL DEFAULT 0,     -- 命中次数
    last_hit_at     TIMESTAMPTZ,                         -- 最近命中时间
    estimated_saving_usd DECIMAL(10,4) DEFAULT 0,        -- 累计节省费用(USD)
    
    -- 生命周期
    status          VARCHAR(16)  NOT NULL DEFAULT 'active', -- active/expired/invalidated/revoked
    expires_at      TIMESTAMPTZ  NOT NULL,               -- 过期时间
    invalidated_at  TIMESTAMPTZ,                         -- 失效时间
    invalidate_reason VARCHAR(64),                       -- 失效原因
    
    -- 审计
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by      VARCHAR(64)  NOT NULL DEFAULT 'system', -- system/warmup/admin
    source_request_id VARCHAR(64),                       -- 原始请求ID（溯源）
    
    -- 索引
    CONSTRAINT uk_composite_key UNIQUE (composite_key)
);

-- 索引
CREATE INDEX idx_cache_scene_status ON ai_cache_entries (scene, status, expires_at);
CREATE INDEX idx_cache_input_hash ON ai_cache_entries (input_hash, scene, model_id);
CREATE INDEX idx_cache_subject_grade ON ai_cache_entries (subject, grade_range) WHERE status = 'active';
CREATE INDEX idx_cache_kp ON ai_cache_entries USING GIN (knowledge_point_ids) WHERE status = 'active';
CREATE INDEX idx_cache_hits ON ai_cache_entries (hit_count DESC) WHERE status = 'active';
CREATE INDEX idx_cache_expires ON ai_cache_entries (expires_at) WHERE status = 'active';
CREATE INDEX idx_cache_embedding ON ai_cache_entries USING ivfflat (input_embedding vector_cosine_ops) WITH (lists = 100) WHERE status = 'active';
```

### 2.3 缓存策略模型

```python
from enum import Enum
from dataclasses import dataclass
from typing import Optional


class CacheStrategy(str, Enum):
    """缓存策略枚举"""
    NONE = "none"              # 不缓存（如多轮对话后续追问）
    EXACT = "exact"            # 精确匹配缓存（题目类）
    SEMANTIC = "semantic"      # 语义相似匹配缓存（知识点讲解类）
    TEMPLATE = "template"      # 模板化预生成缓存（常用内容）
    STANDARD = "standard"      # 标准策略（精确优先，语义兜底）


@dataclass
class CachePolicy:
    """缓存策略配置"""
    scene: str                          # 场景标识
    strategy: CacheStrategy             # 缓存策略
    ttl_seconds: int                    # 默认TTL
    max_ttl_seconds: int                # 最大TTL（高命中可延长）
    semantic_threshold: float           # 语义相似度阈值（0-1）
    max_entries: int                    # 最大缓存条数
    enable_warmup: bool                 # 是否启用预热
    enable_auto_extend_ttl: bool        # 高命中时是否自动延长TTL
    hit_extend_threshold: int           # 延长TTL的命中次数阈值
    cost_minimum_usd: float             # 缓存的最低成本门槛（低于此不缓存）
    
    @staticmethod
    def default_policies() -> dict[str, "CachePolicy"]:
        return {
            "photo_question": CachePolicy(
                scene="photo_question",
                strategy=CacheStrategy.EXACT,
                ttl_seconds=86400 * 30,       # 30天，题目答案相对稳定
                max_ttl_seconds=86400 * 90,
                semantic_threshold=0.98,      # 题目需极高相似度
                max_entries=500000,
                enable_warmup=True,
                enable_auto_extend_ttl=True,
                hit_extend_threshold=5,
                cost_minimum_usd=0.001,
            ),
            "tutoring": CachePolicy(
                scene="tutoring",
                strategy=CacheStrategy.STANDARD,
                ttl_seconds=86400 * 7,        # 7天
                max_ttl_seconds=86400 * 30,
                semantic_threshold=0.90,      # 讲解可接受一定差异
                max_entries=300000,
                enable_warmup=False,
                enable_auto_extend_ttl=True,
                hit_extend_threshold=10,
                cost_minimum_usd=0.002,
            ),
            "exercise_explain": CachePolicy(
                scene="exercise_explain",
                strategy=CacheStrategy.EXACT,
                ttl_seconds=86400 * 30,
                max_ttl_seconds=86400 * 90,
                semantic_threshold=0.98,
                max_entries=300000,
                enable_warmup=True,
                enable_auto_extend_ttl=True,
                hit_extend_threshold=5,
                cost_minimum_usd=0.001,
            ),
            "essay_review": CachePolicy(
                scene="essay_review",
                strategy=CacheStrategy.NONE,  # 作文批改不缓存
                ttl_seconds=0,
                max_ttl_seconds=0,
                semantic_threshold=0.0,
                max_entries=0,
                enable_warmup=False,
                enable_auto_extend_ttl=False,
                hit_extend_threshold=0,
                cost_minimum_usd=999,
            ),
            "planning": CachePolicy(
                scene="planning",
                strategy=CacheStrategy.SEMANTIC,
                ttl_seconds=86400 * 3,        # 3天
                max_ttl_seconds=86400 * 7,
                semantic_threshold=0.85,
                max_entries=50000,
                enable_warmup=False,
                enable_auto_extend_ttl=False,
                hit_extend_threshold=0,
                cost_minimum_usd=0.005,
            ),
            "knowledge_explain": CachePolicy(
                scene="knowledge_explain",
                strategy=CacheStrategy.STANDARD,
                ttl_seconds=86400 * 14,
                max_ttl_seconds=86400 * 60,
                semantic_threshold=0.92,
                max_entries=200000,
                enable_warmup=True,
                enable_auto_extend_ttl=True,
                hit_extend_threshold=20,
                cost_minimum_usd=0.001,
            ),
        }
```

### 2.4 输入归一化器

```python
import re
import unicodedata
import hashlib


class InputNormalizer:
    """输入归一化器 - 将不同表达方式的相同问题标准化"""
    
    # 数学符号标准化映射
    MATH_SYMBOL_MAP = {
        "×": "*", "÷": "/", "−": "-", "＋": "+", "＝": "=",
        "（": "(", "）": ")", "，": ",", "。": ".",
        "：": ":", "；": ";", "！": "!", "？": "?",
        "＜": "<", "＞": ">", "≤": "<=", "≥": ">=",
        "≠": "!=", "∈": "in", "∞": "inf",
    }
    
    @classmethod
    def normalize(cls, raw_input: str, scene: str) -> str:
        """
        归一化流程：
        1. Unicode 标准化 (NFKC)
        2. 全角→半角转换
        3. 多余空白合并
        4. 数学符号标准化
        5. 标点符号统一
        6. 大小写处理（按场景）
        7. 去除无意义前缀后缀
        """
        text = raw_input.strip()
        
        # Unicode 标准化
        text = unicodedata.normalize("NFKC", text)
        
        # 数学符号标准化
        for cn_char, en_char in cls.MATH_SYMBOL_MAP.items():
            text = text.replace(cn_char, en_char)
        
        # 多空白合并
        text = re.sub(r"\s+", " ", text)
        
        # 去除常见无意义前缀
        prefixes = [
            r"^请(?:帮我|帮忙|问一下|教我|告诉我)?[：:]?\s*",
            r"^请问[：:]?\s*",
            r"^我想知道\s*",
            r"^老师[，,]?\s*",
        ]
        for pattern in prefixes:
            text = re.sub(pattern, "", text, flags=re.IGNORECASE)
        
        # 题目场景：去除题号
        if scene in ("photo_question", "exercise_explain"):
            text = re.sub(r"^\d+[\.\)、]\s*", "", text)
        
        # 大小写（理科不区分，文科区分）
        if scene in ("photo_question", "exercise_explain", "tutoring"):
            # 仅对英文字母+数字+符号部分处理
            pass  # 保持原文
        
        return text.strip()
    
    @classmethod
    def compute_hash(cls, normalized_input: str) -> str:
        """计算输入哈希"""
        return hashlib.sha256(normalized_input.encode("utf-8")).hexdigest()
```

---

## 3. 核心流程设计

### 3.1 缓存查询主流程

```
请求到达
   │
   ▼
┌──────────────┐
│ 1. 策略查询   │  查询该场景的缓存策略
│    策略=NONE? │──── 是 ────→ 直接调用LLM，不缓存
└──────┬───────┘
       │ 否
       ▼
┌──────────────┐
│ 2. 输入归一化 │  标准化输入内容
│    计算哈希   │  SHA-256(归一化输入)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 3. L1查询    │  Redis精确匹配查询
│    composite │  key = scene|model|hash|ptv
│    _key      │
│    命中?     │──── 是 ────→ 返回缓存，更新统计
└──────┬───────┘
       │ 未命中
       ▼
┌──────────────┐
│ 4. 策略判断   │
│  EXACT?      │──── 是 ────→ 缓存未命中，调用LLM
│  SEMANTIC/   │
│  STANDARD?   │──── 是
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 5. L2语义查询 │  向量相似度检索
│    PG向量    │  threshold = 策略配置的阈值
│    命中?     │──── 是 ────→ 相似度≥阈值？
└──────┬───────┘              │
       │ 未命中/低于阈值        │ 是→返回缓存
       ▼                      │ 否→调用LLM
┌──────────────┐
│ 6. 调用LLM   │  走多模型调度
│    获取结果   │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 7. 缓存写入   │  异步写入（不阻塞响应）
│    +L1 Redis  │
│    +L2 PG    │
└──────┬───────┘
       │
       ▼
    返回结果
```

### 3.2 缓存写入流程

```python
import asyncio
from dataclasses import dataclass
from typing import Any, Optional
import structlog

logger = structlog.get_logger()


@dataclass
class CacheWriteRequest:
    """缓存写入请求"""
    scene: str
    model_id: str
    original_input: str
    normalized_input: str
    input_hash: str
    input_embedding: list[float] | None
    context_fingerprint: str | None
    prompt_template_version: str
    output_content: str
    output_metadata: dict[str, Any]
    subject: str | None
    grade_range: str | None
    knowledge_point_ids: list[int]
    source_request_id: str
    cost_usd: float                    # 本次LLM调用成本


class CacheWriter:
    """缓存写入器"""
    
    def __init__(self, redis_client, db_pool, config_client):
        self.redis = redis_client
        self.db = db_pool
        self.config = config_client
    
    async def write_async(self, req: CacheWriteRequest) -> Optional[int]:
        """
        异步写入缓存（不阻塞主流程）
        返回缓存条目ID，失败返回None
        """
        policy = await self._get_policy(req.scene)
        
        # 成本门槛检查
        if req.cost_usd < policy.cost_minimum_usd:
            logger.debug(
                "cache_skip_cost_below_threshold",
                scene=req.scene,
                cost=req.cost_usd,
                threshold=policy.cost_minimum_usd,
            )
            return None
        
        # 计算TTL
        ttl = policy.ttl_seconds
        
        # 计算输出哈希
        import hashlib
        output_hash = hashlib.sha256(
            req.output_content.encode("utf-8")
        ).hexdigest()
        
        # 去重检查（同一输出不重复写入）
        existing = await self._check_output_duplicate(
            req.input_hash, req.scene, req.model_id, output_hash
        )
        if existing:
            logger.debug("cache_skip_duplicate_output", entry_id=existing)
            return existing
        
        # 组合键
        composite_key = self._build_composite_key(req, policy)
        
        # 写入 L1 Redis
        try:
            redis_key = f"ai_cache:{composite_key}"
            await self.redis.setex(
                redis_key,
                min(ttl, 3600 * 6),  # Redis缓存最多6小时
                req.output_content,
            )
            # 存储元数据
            meta_key = f"ai_cache_meta:{composite_key}"
            await self.redis.hset(meta_key, mapping={
                "entry_id": "pending",  # PG写入后更新
                "scene": req.scene,
                "model_id": req.model_id,
                "ttl": str(ttl),
            })
            await self.redis.expire(meta_key, min(ttl, 3600 * 6))
        except Exception as e:
            logger.warning("cache_redis_write_failed", error=str(e))
            # Redis写入失败不阻塞，继续写PG
        
        # 写入 L2 PostgreSQL
        try:
            import numpy as np
            
            embedding = None
            if req.input_embedding and policy.strategy in (
                CacheStrategy.SEMANTIC, CacheStrategy.STANDARD
            ):
                embedding = str(req.input_embedding)  # pgvector格式
            
            entry_id = await self.db.fetchval(
                """
                INSERT INTO ai_cache_entries (
                    composite_key, scene, model_id,
                    original_input, normalized_input, input_hash, input_embedding,
                    context_fingerprint, prompt_template_version,
                    output_content, output_metadata, output_hash,
                    subject, grade_range, knowledge_point_ids,
                    cache_strategy, ttl_seconds, estimated_saving_usd,
                    expires_at, status, created_by, source_request_id
                ) VALUES (
                    $1, $2, $3,
                    $4, $5, $6, $7::vector,
                    $8, $9,
                    $10, $11::jsonb, $12,
                    $13, $14, $15,
                    $16, $17, 0,
                    NOW() + $18::interval, 'active', 'system', $19
                )
                ON CONFLICT (composite_key) DO UPDATE SET
                    output_content = EXCLUDED.output_content,
                    output_metadata = EXCLUDED.output_metadata,
                    output_hash = EXCLUDED.output_hash,
                    hit_count = ai_cache_entries.hit_count,
                    ttl_seconds = EXCLUDED.ttl_seconds,
                    expires_at = EXCLUDED.expires_at,
                    updated_at = NOW(),
                    status = 'active'
                RETURNING id
                """,
                composite_key, req.scene, req.model_id,
                req.original_input, req.normalized_input, req.input_hash,
                embedding,
                req.context_fingerprint, req.prompt_template_version,
                req.output_content,
                __import__("json").dumps(req.output_metadata),
                output_hash,
                req.subject, req.grade_range,
                req.knowledge_point_ids,
                policy.strategy.value, policy.ttl_seconds,
                f"{ttl} seconds",
                req.source_request_id,
            )
            
            # 更新Redis中的entry_id
            try:
                meta_key = f"ai_cache_meta:{composite_key}"
                await self.redis.hset(meta_key, "entry_id", str(entry_id))
            except Exception:
                pass
            
            logger.info(
                "cache_written",
                entry_id=entry_id,
                scene=req.scene,
                ttl=ttl,
            )
            return entry_id
            
        except Exception as e:
            logger.error("cache_pg_write_failed", error=str(e), scene=req.scene)
            return None
    
    def _build_composite_key(self, req: CacheWriteRequest, policy: CachePolicy) -> str:
        parts = [
            f"s:{req.scene}",
            f"m:{req.model_id}",
            f"h:{req.input_hash}",
            f"ptv:{req.prompt_template_version}",
        ]
        if req.context_fingerprint and policy.strategy != CacheStrategy.EXACT:
            parts.append(f"ctx:{req.context_fingerprint}")
        return "|".join(parts)
```

### 3.3 语义匹配查询

```python
from typing import Optional


class SemanticCacheQuerier:
    """语义相似度缓存查询器"""
    
    def __init__(self, db_pool, embedding_service):
        self.db = db_pool
        self.embedding = embedding_service
    
    async def query(
        self,
        input_text: str,
        scene: str,
        model_id: str,
        subject: str | None,
        grade_range: str | None,
        threshold: float,
        top_k: int = 5,
    ) -> Optional[dict]:
        """
        语义相似度查询
        返回相似度最高的缓存条目，低于阈值返回None
        """
        # 向量化输入
        query_vector = await self.embedding.embed(input_text)
        
        # PG向量检索
        rows = await self.db.fetch(
            """
            SELECT 
                id, composite_key, original_input, output_content,
                output_metadata, hit_count,
                1 - (input_embedding <=> $1::vector) AS similarity
            FROM ai_cache_entries
            WHERE scene = $2
              AND model_id = $3
              AND status = 'active'
              AND expires_at > NOW()
              AND ($4::text IS NULL OR subject = $4)
              AND ($5::text IS NULL OR grade_range = $5)
            ORDER BY input_embedding <=> $1::vector
            LIMIT $6
            """,
            str(query_vector),
            scene, model_id,
            subject, grade_range,
            top_k,
        )
        
        if not rows:
            return None
        
        # 取最高相似度
        best = dict(rows[0])
        
        if best["similarity"] < threshold:
            return None
        
        return best
    
    async def record_hit(self, entry_id: int, saving_usd: float) -> None:
        """记录命中并更新统计"""
        await self.db.execute(
            """
            UPDATE ai_cache_entries
            SET hit_count = hit_count + 1,
                last_hit_at = NOW(),
                estimated_saving_usd = estimated_saving_usd + $2,
                updated_at = NOW()
            WHERE id = $1
            """,
            entry_id, saving_usd,
        )
```

---

## 4. 统一缓存服务接口

### 4.1 服务类设计

```python
from dataclasses import dataclass
from typing import Any, Optional
from enum import Enum
import structlog
import time

logger = structlog.get_logger()


class CacheResult(Enum):
    """缓存查询结果类型"""
    HIT_EXACT = "hit_exact"           # 精确命中
    HIT_SEMANTIC = "hit_semantic"     # 语义命中
    MISS = "miss"                      # 未命中
    SKIP = "skip"                      # 跳过（策略为NONE）


@dataclass
class CacheLookupResult:
    """缓存查询结果"""
    result: CacheResult
    content: Optional[str] = None
    entry_id: Optional[int] = None
    similarity: Optional[float] = None
    latency_ms: float = 0.0


class AICacheService:
    """AI缓存统一服务"""
    
    def __init__(
        self,
        redis_client,
        db_pool,
        embedding_service,
        normalizer: InputNormalizer,
        config_client,
    ):
        self.redis = redis_client
        self.db = db_pool
        self.embedding = embedding_service
        self.normalizer = normalizer
        self.config = config_client
        self._policies: dict[str, CachePolicy] = CachePolicy.default_policies()
        self._writer = CacheWriter(redis_client, db_pool, config_client)
        self._semantic_querier = SemanticCacheQuerier(db_pool, embedding_service)
    
    async def lookup(
        self,
        raw_input: str,
        scene: str,
        model_id: str,
        prompt_template_version: str,
        context_fingerprint: str | None = None,
        subject: str | None = None,
        grade_range: str | None = None,
        knowledge_point_ids: list[int] | None = None,
        source_request_id: str | None = None,
    ) -> CacheLookupResult:
        """
        缓存查询主入口
        """
        start = time.monotonic()
        
        policy = self._policies.get(scene)
        if not policy or policy.strategy == CacheStrategy.NONE:
            return CacheLookupResult(
                result=CacheResult.SKIP,
                latency_ms=(time.monotonic() - start) * 1000,
            )
        
        # 归一化输入
        normalized = self.normalizer.normalize(raw_input, scene)
        input_hash = self.normalizer.compute_hash(normalized)
        
        # L1: Redis精确查询
        composite_key = self._build_key(
            scene, model_id, input_hash, prompt_template_version,
            context_fingerprint, policy,
        )
        redis_key = f"ai_cache:{composite_key}"
        
        try:
            cached_content = await self.redis.get(redis_key)
            if cached_content:
                # 获取entry_id
                meta_key = f"ai_cache_meta:{composite_key}"
                meta = await self.redis.hgetall(meta_key)
                entry_id = int(meta.get(b"entry_id", 0)) if meta else None
                
                # 异步更新命中统计
                if entry_id:
                    await self._async_hit_update(entry_id, scene)
                
                latency = (time.monotonic() - start) * 1000
                logger.info(
                    "cache_hit_exact",
                    scene=scene,
                    entry_id=entry_id,
                    latency_ms=latency,
                )
                return CacheLookupResult(
                    result=CacheResult.HIT_EXACT,
                    content=cached_content,
                    entry_id=entry_id,
                    latency_ms=latency,
                )
        except Exception as e:
            logger.warning("cache_redis_lookup_failed", error=str(e))
        
        # L2: 语义查询（仅 SEMANTIC / STANDARD 策略）
        if policy.strategy in (CacheStrategy.SEMANTIC, CacheStrategy.STANDARD):
            semantic_result = await self._semantic_querier.query(
                input_text=normalized,
                scene=scene,
                model_id=model_id,
                subject=subject,
                grade_range=grade_range,
                threshold=policy.semantic_threshold,
            )
            
            if semantic_result:
                # 回填L1 Redis
                try:
                    await self.redis.setex(
                        f"ai_cache:{composite_key}",
                        min(policy.ttl_seconds, 3600 * 6),
                        semantic_result["output_content"],
                    )
                except Exception:
                    pass
                
                # 更新命中统计
                await self._semantic_querier.record_hit(
                    semantic_result["id"],
                    saving_usd=0,  # 由后续任务计算
                )
                
                latency = (time.monotonic() - start) * 1000
                logger.info(
                    "cache_hit_semantic",
                    scene=scene,
                    entry_id=semantic_result["id"],
                    similarity=semantic_result["similarity"],
                    latency_ms=latency,
                )
                return CacheLookupResult(
                    result=CacheResult.HIT_SEMANTIC,
                    content=semantic_result["output_content"],
                    entry_id=semantic_result["id"],
                    similarity=semantic_result["similarity"],
                    latency_ms=latency,
                )
        
        # 未命中 - 准备embedding供后续写入使用
        embedding = None
        if policy.strategy in (CacheStrategy.SEMANTIC, CacheStrategy.STANDARD):
            embedding = await self.embedding.embed(normalized)
        
        # 将归一化信息存入请求上下文，供后续写入使用
        latency = (time.monotonic() - start) * 1000
        return CacheLookupResult(result=CacheResult.MISS, latency_ms=latency)
    
    async def store(
        self,
        raw_input: str,
        scene: str,
        model_id: str,
        prompt_template_version: str,
        output_content: str,
        output_metadata: dict[str, Any],
        cost_usd: float,
        context_fingerprint: str | None = None,
        subject: str | None = None,
        grade_range: str | None = None,
        knowledge_point_ids: list[int] | None = None,
        source_request_id: str | None = None,
    ) -> Optional[int]:
        """
        缓存写入入口（在LLM调用成功后调用）
        """
        policy = self._policies.get(scene)
        if not policy or policy.strategy == CacheStrategy.NONE:
            return None
        
        normalized = self.normalizer.normalize(raw_input, scene)
        input_hash = self.normalizer.compute_hash(normalized)
        
        # 计算embedding（如需要）
        embedding = None
        if policy.strategy in (CacheStrategy.SEMANTIC, CacheStrategy.STANDARD):
            embedding = await self.embedding.embed(normalized)
        
        write_req = CacheWriteRequest(
            scene=scene,
            model_id=model_id,
            original_input=raw_input,
            normalized_input=normalized,
            input_hash=input_hash,
            input_embedding=embedding,
            context_fingerprint=context_fingerprint,
            prompt_template_version=prompt_template_version,
            output_content=output_content,
            output_metadata=output_metadata,
            subject=subject,
            grade_range=grade_range,
            knowledge_point_ids=knowledge_point_ids or [],
            source_request_id=source_request_id or "",
            cost_usd=cost_usd,
        )
        
        return await self._writer.write_async(write_req)
    
    async def invalidate(
        self,
        entry_id: int | None = None,
        scene: str | None = None,
        subject: str | None = None,
        knowledge_point_id: int | None = None,
        reason: str = "manual",
    ) -> int:
        """
        缓存失效操作
        支持按条目ID、场景、学科、知识点维度失效
        返回失效条目数
        """
        conditions = ["status = 'active'"]
        params = []
        param_idx = 1
        
        if entry_id:
            conditions.append(f"id = ${param_idx}")
            params.append(entry_id)
            param_idx += 1
        if scene:
            conditions.append(f"scene = ${param_idx}")
            params.append(scene)
            param_idx += 1
        if subject:
            conditions.append(f"subject = ${param_idx}")
            params.append(subject)
            param_idx += 1
        if knowledge_point_id:
            conditions.append(f"${param_idx} = ANY(knowledge_point_ids)")
            params.append(knowledge_point_id)
            param_idx += 1
        
        where_clause = " AND ".join(conditions)
        
        # 批量失效
        count = await self.db.fetchval(
            f"""
            UPDATE ai_cache_entries
            SET status = 'invalidated',
                invalidated_at = NOW(),
                invalidate_reason = ${{param_idx}},
                updated_at = NOW()
            WHERE {where_clause}
            """,
            *params, reason,
        )
        
        # 清理相关Redis缓存（异步，不阻塞）
        asyncio.ensure_future(self._cleanup_redis_for_invalidated(
            entry_id, scene, subject
        ))
        
        logger.info("cache_invalidated", count=count, reason=reason)
        return count or 0
    
    async def _async_hit_update(self, entry_id: int, scene: str) -> None:
        """异步更新命中统计"""
        policy = self._policies.get(scene)
        try:
            await self.db.execute(
                """
                UPDATE ai_cache_entries
                SET hit_count = hit_count + 1,
                    last_hit_at = NOW(),
                    updated_at = NOW()
                WHERE id = $1 AND status = 'active'
                """,
                entry_id,
            )
            
            # 高命中自动延长TTL
            if policy and policy.enable_auto_extend_ttl:
                current_hits = await self.db.fetchval(
                    "SELECT hit_count FROM ai_cache_entries WHERE id = $1",
                    entry_id,
                )
                if current_hits and current_hits >= policy.hit_extend_threshold:
                    new_ttl = min(
                        int(policy.ttl_seconds * 1.5),
                        policy.max_ttl_seconds,
                    )
                    await self.db.execute(
                        """
                        UPDATE ai_cache_entries
                        SET ttl_seconds = $2,
                            expires_at = GREATEST(expires_at, NOW() + $3::interval)
                        WHERE id = $1 AND status = 'active'
                        """,
                        entry_id, new_ttl, f"{new_ttl} seconds",
                    )
        except Exception as e:
            logger.warning("cache_hit_update_failed", error=str(e))
```

### 4.2 与业务层集成示例

```python
class AITutoringService:
    """AI辅导服务 - 展示缓存集成方式"""
    
    def __init__(self, cache_service: AICacheService, model_dispatcher):
        self.cache = cache_service
        self.dispatcher = model_dispatcher
    
    async def ask(
        self,
        user_id: int,
        question: str,
        subject: str,
        grade_range: str,
        knowledge_point_ids: list[int],
        request_id: str,
    ) -> AsyncIterator[str]:
        """
        AI辅导问答（流式返回）
        展示缓存如何与LLM调用集成
        """
        model_id = self.dispatcher.select_model(subject, grade_range)
        ptv = await self._get_prompt_template_version(subject, grade_range)
        
        # 1. 查询缓存
        lookup = await self.cache.lookup(
            raw_input=question,
            scene="tutoring",
            model_id=model_id,
            prompt_template_version=ptv,
            subject=subject,
            grade_range=grade_range,
            knowledge_point_ids=knowledge_point_ids,
            source_request_id=request_id,
        )
        
        if lookup.result in (CacheResult.HIT_EXACT, CacheResult.HIT_SEMANTIC):
            # 缓存命中 - 直接返回（模拟流式）
            yield lookup.content
            return
        
        # 2. 缓存未命中 - 调用LLM
        collected_content = []
        cost_usd = 0.0
        
        async for chunk in self.dispatcher.stream_call(
            model_id=model_id,
            prompt=self._build_prompt(question, subject, grade_range),
        ):
            collected_content.append(chunk)
            yield chunk
        
        full_content = "".join(collected_content)
        cost_usd = self.dispatcher.calculate_cost(model_id, full_content)
        
        # 3. 异步写入缓存（不阻塞响应）
        asyncio.ensure_future(self.cache.store(
            raw_input=question,
            scene="tutoring",
            model_id=model_id,
            prompt_template_version=ptv,
            output_content=full_content,
            output_metadata={"tokens": len(full_content)},
            cost_usd=cost_usd,
            subject=subject,
            grade_range=grade_range,
            knowledge_point_ids=knowledge_point_ids,
            source_request_id=request_id,
        ))
```

---

## 5. 预热管线设计

### 5.1 预热策略

对于高频场景（题目解析、知识点讲解），支持在低峰期预生成缓存：

```python
from dataclasses import dataclass
from enum import Enum


class WarmupTrigger(str, Enum):
    """预热触发类型"""
    SCHEDULED = "scheduled"      # 定时预热（低峰期）
    CONTENT_UPDATE = "content"   # 内容更新触发
    COLD_DETECT = "cold"         # 冷启动检测（新教材上线）


@dataclass
class WarmupTask:
    """预热任务"""
    task_id: str
    scene: str                    # 目标场景
    trigger: WarmupTrigger
    model_id: str                 # 使用的模型
    prompt_template_version: str
    
    # 预热范围
    subject: str | None
    grade_range: str | None
    knowledge_point_ids: list[int] | None
    question_ids: list[int] | None    # 指定题目ID预热
    
    # 控制
    max_items: int = 1000             # 单次最大预热数量
    concurrency: int = 3             # 并发数
    cost_budget_usd: float = 1.0     # 单次成本预算
    priority: int = 5                # 优先级 1-10
    
    # 状态
    status: str = "pending"
    completed_count: int = 0
    failed_count: int = 0
    cost_spent_usd: float = 0.0


class WarmupScheduler:
    """预热调度器"""
    
    def __init__(self, db_pool, cache_service, model_dispatcher, celery_app):
        self.db = db_pool
        self.cache = cache_service
        self.dispatcher = model_dispatcher
        self.celery = celery_app
    
    async def schedule_question_warmup(
        self,
        subject: str,
        grade_range: str,
        question_ids: list[int] | None = None,
        trigger: WarmupTrigger = WarmupTrigger.SCHEDULED,
    ) -> str:
        """
        调度题目解析预热
        选择高频访问但未缓存或缓存即将过期的题目
        """
        # 查询需要预热的题目
        query = """
            SELECT q.id, q.content, q.subject, q.grade_range, q.knowledge_point_ids
            FROM questions q
            WHERE q.subject = $1
              AND q.grade_range = $2
              AND q.status = 'published'
        """
        
        if question_ids:
            query += " AND q.id = ANY($3)"
            rows = await self.db.fetch(query, subject, grade_range, question_ids)
        else:
            # 按访问频率选择高频题目
            query += """
                ORDER BY q.access_count DESC NULLS LAST
                LIMIT 500
            """
            rows = await self.db.fetch(query, subject, grade_range)
        
        # 过滤已有有效缓存的题目
        to_warmup = []
        for row in rows:
            normalized = self.cache.normalizer.normalize(row["content"], "photo_question")
            input_hash = self.cache.normalizer.compute_hash(normalized)
            
            cached = await self.db.fetchval(
                """
                SELECT 1 FROM ai_cache_entries
                WHERE input_hash = $1
                  AND scene = 'photo_question'
                  AND status = 'active'
                  AND expires_at > NOW() + INTERVAL '1 day'
                LIMIT 1
                """,
                input_hash,
            )
            if not cached:
                to_warmup.append(row)
        
        if not to_warmup:
            return "no_items_to_warmup"
        
        # 提交Celery预热任务
        task_id = f"warmup_{subject}_{grade_range}_{int(time.time())}"
        self.celery.send_task(
            "ai_cache.warmup_questions",
            args=[task_id, [dict(r) for r in to_warmup]],
            queue="warmup",
            priority=3,  # 低优先级，不影响正常业务
        )
        
        return task_id
    
    async def warmup_knowledge_explanations(
        self,
        subject: str,
        grade_range: str,
        knowledge_point_ids: list[int],
    ) -> int:
        """
        预热知识点讲解缓存
        为每个知识点生成标准讲解并存入缓存
        """
        model_id = self.dispatcher.select_model(subject, grade_range)
        ptv = await self._get_ptv(subject, grade_range)
        warmed = 0
        
        for kp_id in knowledge_point_ids:
            kp = await self.db.fetchrow(
                "SELECT id, name, description, subject FROM knowledge_points WHERE id = $1",
                kp_id,
            )
            if not kp:
                continue
            
            # 生成标准讲解问题
            question = f"请讲解知识点：{kp['name']}"
            if kp["description"]:
                question += f"（{kp['description']}）"
            
            # 查缓存
            lookup = await self.cache.lookup(
                raw_input=question,
                scene="knowledge_explain",
                model_id=model_id,
                prompt_template_version=ptv,
                subject=subject,
                grade_range=grade_range,
                knowledge_point_ids=[kp_id],
            )
            
            if lookup.result != CacheResult.MISS:
                continue  # 已有缓存
            
            # 调用LLM生成讲解
            content = await self.dispatcher.call(
                model_id=model_id,
                prompt=self._build_knowledge_prompt(kp, grade_range),
            )
            
            # 写入缓存
            await self.cache.store(
                raw_input=question,
                scene="knowledge_explain",
                model_id=model_id,
                prompt_template_version=ptv,
                output_content=content,
                output_metadata={"warmup": True, "kp_id": kp_id},
                cost_usd=self.dispatcher.calculate_cost(model_id, content),
                subject=subject,
                grade_range=grade_range,
                knowledge_point_ids=[kp_id],
            )
            warmed += 1
        
        return warmed
```

### 5.2 定时预热任务注册

```python
# 在Celery定时任务表中注册

WARMUP_BEAT_SCHEDULE = {
    # 每日凌晨3点预热高频题目
    "warmup-high-freq-questions": {
        "task": "ai_cache.scheduled_warmup",
        "schedule": crontab(hour=3, minute=0),
        "args": {
            "scene": "photo_question",
            "subjects": ["math", "physics", "chemistry"],
            "trigger": "scheduled",
        },
    },
    # 每周一凌晨4点预热知识点讲解
    "warmup-knowledge-explain": {
        "task": "ai_cache.scheduled_warmup",
        "schedule": crontab(hour=4, minute=0, day_of_week=1),
        "args": {
            "scene": "knowledge_explain",
            "trigger": "scheduled",
        },
    },
}
```

---

## 6. 生命周期管理

### 6.1 缓存失效触发条件

| 触发条件 | 失效范围 | 失效原因码 | 触发源 |
|---------|---------|-----------|-------|
| TTL过期 | 单条 | `ttl_expired` | 定时清理任务 |
| Prompt模板更新 | 按scene+ptv | `template_update` | 配置变更事件 |
| 知识点内容变更 | 按kp_id | `knowledge_update` | 内容管理事件 |
| 教材版本更新 | 按教材维度 | `textbook_update` | 内容管理事件 |
| 质量投诉（用户反馈错误） | 单条 | `quality_complaint` | 用户反馈事件 |
| 管理员手动失效 | 自定义范围 | `manual_invalidate` | 管理后台操作 |
| 模型升级/切换 | 按model_id | `model_change` | 模型配置变更 |
| 题目内容修正 | 按question_id | `question_correction` | 题库管理事件 |

### 6.2 过期清理任务

```python
class CacheJanitor:
    """缓存清理守护"""
    
    async def cleanup_expired(self) -> dict:
        """清理过期缓存条目"""
        # 1. 批量标记过期（超过expires_at的active条目）
        expired_count = await self.db.fetchval(
            """
            UPDATE ai_cache_entries
            SET status = 'expired', updated_at = NOW()
            WHERE status = 'active'
              AND expires_at < NOW()
            """
        )
        
        # 2. 删除超过30天的已过期/已失效条目（归档后删除）
        deleted_count = await self.db.fetchval(
            """
            DELETE FROM ai_cache_entries
            WHERE status IN ('expired', 'invalidated', 'revoked')
              AND updated_at < NOW() - INTERVAL '30 days'
            """
        )
        
        # 3. 清理Redis中的过期键（被动过期已由Redis TTL处理，清理残留meta）
        # 扫描匹配模式并清理
        meta_keys = await self.redis.keys("ai_cache_meta:*")
        cleaned = 0
        for key in meta_keys:
            entry_id = await self.redis.hget(key, "entry_id")
            if entry_id:
                status = await self.db.fetchval(
                    "SELECT status FROM ai_cache_entries WHERE id = $1",
                    int(entry_id),
                )
                if status and status != "active":
                    await self.redis.delete(key)
                    # 同时删除对应的content key
                    composite_key = key.replace("ai_cache_meta:", "")
                    await self.redis.delete(f"ai_cache:{composite_key}")
                    cleaned += 1
        
        return {
            "expired": expired_count or 0,
            "deleted": deleted_count or 0,
            "redis_cleaned": cleaned,
        }
    
    async def capacity_check(self) -> dict:
        """容量检查与告警"""
        stats = {}
        
        for scene, policy in CachePolicy.default_policies().items():
            count = await self.db.fetchval(
                """
                SELECT COUNT(*) FROM ai_cache_entries
                WHERE scene = $1 AND status = 'active'
                """,
                scene,
            )
            utilization = count / policy.max_entries if policy.max_entries > 0 else 0
            
            stats[scene] = {
                "count": count,
                "max": policy.max_entries,
                "utilization": round(utilization, 4),
                "near_limit": utilization > 0.85,
            }
        
        return stats
```

### 6.3 事件驱动失效

```python
# 事件订阅注册表
CACHE_INVALIDATION_SUBSCRIPTIONS = {
    # 知识点内容变更 → 失效关联缓存
    "knowledge_point.updated": {
        "handler": "invalidate_by_knowledge_point",
        "scope": ["knowledge_explain", "tutoring"],
    },
    # 题目修正 → 失效题目解析缓存
    "question.corrected": {
        "handler": "invalidate_by_question",
        "scope": ["photo_question", "exercise_explain"],
    },
    # Prompt模板更新 → 失效该模板版本的缓存
    "prompt_template.published": {
        "handler": "invalidate_by_template_version",
        "scope": "all",
    },
    # 模型切换 → 失效旧模型缓存
    "model_config.switched": {
        "handler": "invalidate_by_model",
        "scope": "all",
    },
    # 用户反馈AI输出错误 → 失效具体条目
    "user_feedback.ai_error": {
        "handler": "invalidate_by_entry",
        "scope": "all",
    },
}


async def handle_cache_invalidation_event(event_name: str, payload: dict):
    """处理缓存失效事件"""
    subscription = CACHE_INVALIDATION_SUBSCRIPTIONS.get(event_name)
    if not subscription:
        return
    
    cache_service = get_cache_service()
    
    if subscription["handler"] == "invalidate_by_knowledge_point":
        kp_id = payload["knowledge_point_id"]
        await cache_service.invalidate(
            knowledge_point_id=kp_id,
            reason="knowledge_update",
        )
    
    elif subscription["handler"] == "invalidate_by_question":
        question_id = payload["question_id"]
        # 查找该题目的缓存条目
        entries = await cache_service.db.fetch(
            """
            SELECT id FROM ai_cache_entries
            WHERE input_hash IN (
                SELECT encode(digest(normalized_content, 'sha256'), 'hex')
                FROM questions WHERE id = $1
            ) AND scene = ANY($2::text[]) AND status = 'active'
            """,
            question_id, subscription["scope"],
        )
        for entry in entries:
            await cache_service.invalidate(
                entry_id=entry["id"],
                reason="question_correction",
            )
    
    elif subscription["handler"] == "invalidate_by_template_version":
        old_version = payload["old_version"]
        scene = payload.get("scene")
        await cache_service.db.execute(
            """
            UPDATE ai_cache_entries
            SET status = 'invalidated',
                invalidated_at = NOW(),
                invalidate_reason = 'template_update',
                updated_at = NOW()
            WHERE prompt_template_version = $1
              AND ($2::text IS NULL OR scene = $2)
              AND status = 'active'
            """,
            old_version, scene,
        )
```

---

## 7. 管理后台 API

### 7.1 缓存统计看板

```
GET /admin/api/v1/cache/stats
```

**响应示例：**
```json
{
  "overview": {
    "total_entries": 245680,
    "active_entries": 198450,
    "total_hit_count": 1523456,
    "overall_hit_rate": 0.423,
    "estimated_total_saving_usd": 3245.67,
    "avg_semantic_similarity": 0.9456
  },
  "by_scene": {
    "photo_question": {
      "entries": 85600,
      "hit_rate": 0.62,
      "avg_ttl_seconds": 2592000,
      "saving_usd": 1876.34
    },
    "tutoring": {
      "entries": 52300,
      "hit_rate": 0.38,
      "avg_ttl_seconds": 604800,
      "saving_usd": 856.22
    },
    "knowledge_explain": {
      "entries": 35200,
      "hit_rate": 0.51,
      "avg_ttl_seconds": 1209600,
      "saving_usd": 423.11
    }
  },
  "by_model": {
    "gpt-4o": { "entries": 120000, "hit_rate": 0.45, "saving_usd": 2100.00 },
    "deepseek-r1": { "entries": 80000, "hit_rate": 0.38, "saving_usd": 890.00 }
  },
  "capacity": {
    "photo_question": { "utilization": 0.171, "near_limit": false },
    "tutoring": { "utilization": 0.174, "near_limit": false }
  }
}
```

### 7.2 管理接口

```
# 手动失效缓存
POST /admin/api/v1/cache/invalidate
Body: {
  "entry_ids": [12345, 67890],           // 指定条目（可选）
  "scene": "tutoring",                   // 按场景（可选）
  "subject": "math",                     // 按学科（可选）
  "knowledge_point_ids": [101, 102],     // 按知识点（可选）
  "reason": "manual"
}

# 查询缓存条目
GET /admin/api/v1/cache/entries?scene=photo_question&status=active&page=1&size=20

# 触发预热
POST /admin/api/v1/cache/warmup
Body: {
  "scene": "photo_question",
  "subject": "math",
  "grade_range": "junior",
  "question_ids": [1001, 1002, 1003],   // 可选，不指定则自动选择高频题目
  "max_items": 500
}

# 缓存策略配置
GET /admin/api/v1/cache/policies
PUT /admin/api/v1/cache/policies/{scene}
Body: {
  "ttl_seconds": 86400,
  "semantic_threshold": 0.92,
  "max_entries": 500000
}

# 清理任务状态
GET /admin/api/v1/cache/janitor/status
POST /admin/api/v1/cache/janitor/trigger   // 手动触发清理
```

---

## 8. 监控指标

### 8.1 Prometheus 指标定义

```python
from prometheus_client import Counter, Histogram, Gauge, Summary

# 缓存查询
cache_lookup_total = Counter(
    "ai_cache_lookup_total",
    "缓存查询总数",
    ["scene", "result"],  # result: hit_exact / hit_semantic / miss / skip
)

cache_lookup_latency = Histogram(
    "ai_cache_lookup_latency_seconds",
    "缓存查询延迟",
    ["scene", "layer"],  # layer: l1_redis / l2_pg / total
    buckets=[0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0],
)

# 缓存写入
cache_write_total = Counter(
    "ai_cache_write_total",
    "缓存写入总数",
    ["scene", "status"],  # status: success / duplicate / error
)

cache_write_latency = Histogram(
    "ai_cache_write_latency_seconds",
    "缓存写入延迟",
    ["scene"],
)

# 缓存容量
cache_entries_active = Gauge(
    "ai_cache_entries_active",
    "活跃缓存条目数",
    ["scene"],
)

cache_entries_total = Gauge(
    "ai_cache_entries_total",
    "缓存条目总数（含所有状态）",
    ["scene", "status"],
)

cache_capacity_utilization = Gauge(
    "ai_cache_capacity_utilization",
    "缓存容量利用率",
    ["scene"],
)

# 成本节省
cache_saving_usd = Counter(
    "ai_cache_saving_usd_total",
    "缓存节省费用总额(USD)",
    ["scene"],
)

# 预热
cache_warmup_total = Counter(
    "ai_cache_warmup_total",
    "预热任务总数",
    ["scene", "status"],  # status: success / failed
)

cache_warmup_cost_usd = Counter(
    "ai_cache_warmup_cost_usd_total",
    "预热成本总额(USD)",
    ["scene"],
)

# 失效
cache_invalidation_total = Counter(
    "ai_cache_invalidation_total",
    "缓存失效总数",
    ["reason"],
)
```

### 8.2 告警规则

```yaml
# Prometheus alerting rules
groups:
  - name: ai_cache
    rules:
      # 整体命中率过低
      - alert: AICacheHitRateLow
        expr: |
          sum(rate(ai_cache_lookup_total{result=~"hit_.*"}[5m]))
          /
          sum(rate(ai_cache_lookup_total{result!="skip"}[5m]))
          < 0.15
        for: 30m
        labels:
          severity: warning
        annotations:
          summary: "AI缓存命中率低于15%"
          
      # 缓存查询延迟过高
      - alert: AICacheLookupLatencyHigh
        expr: |
          histogram_quantile(0.95, 
            sum(rate(ai_cache_lookup_latency_seconds_bucket[5m])) by (le, scene)
          ) > 0.5
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "AI缓存P95查询延迟超过500ms (scene={{ $labels.scene }})"
      
      # 缓存容量接近上限
      - alert: AICacheCapacityNearLimit
        expr: |
          ai_cache_capacity_utilization > 0.85
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "AI缓存容量利用率超过85% (scene={{ $labels.scene }})"
      
      # 缓存写入失败率过高
      - alert: AICacheWriteErrorRateHigh
        expr: |
          sum(rate(ai_cache_write_total{status="error"}[5m]))
          /
          sum(rate(ai_cache_write_total[5m]))
          > 0.05
        for: 15m
        labels:
          severity: critical
        annotations:
          summary: "AI缓存写入错误率超过5%"
```

---

## 9. 客户端集成

### 9.1 Flutter 客户端适配

缓存命中对客户端透明，但需处理以下差异：

```dart
/// AI缓存的客户端感知
/// 1. 缓存命中时响应为非流式（完整内容一次返回）
/// 2. 需在UI上区分展示（可选标记"来自缓存"）

class AICacheAwareResponse {
  final String content;
  final bool fromCache;
  final double? similarity;  // 语义命中时的相似度
  final int? cacheEntryId;   // 用于反馈时溯源
  
  const AICacheAwareResponse({
    required this.content,
    this.fromCache = false,
    this.similarity,
    this.cacheEntryId,
  });
}

/// SSE响应头中增加缓存标记
/// X-AI-Cache: hit_exact / hit_semantic / miss
/// X-AI-Cache-Similarity: 0.9567 (语义命中时)
/// X-AI-Cache-Entry-Id: 12345

class AIResponseParser {
  /// 解析SSE响应头，判断缓存状态
  static AICacheAwareResponse parseFromHeaders(
    Map<String, String> headers,
    String content,
  ) {
    final cacheStatus = headers['x-ai-cache'];
    return AICacheAwareResponse(
      content: content,
      fromCache: cacheStatus == 'hit_exact' || cacheStatus == 'hit_semantic',
      similarity: double.tryParse(headers['x-ai-cache-similarity'] ?? ''),
      cacheEntryId: int.tryParse(headers['x-ai-cache-entry-id'] ?? ''),
    );
  }
}
```

---

## 10. 错误处理与降级

### 10.1 错误码

| 错误码 | 含义 | 处理策略 |
|--------|------|---------|
| `CACHE_LOOKUP_ERROR` | 缓存查询失败 | 降级直接调用LLM |
| `CACHE_WRITE_ERROR` | 缓存写入失败 | 记录日志，不影响业务 |
| `CACHE_EMBEDDING_ERROR` | 向量化失败 | 跳过语义查询，降级为精确匹配 |
| `CACHE_REDIS_UNAVAILABLE` | Redis不可用 | 跳过L1，直接查L2 |
| `CACHE_PG_SLOW` | PG查询超时 | 跳过L2，降级调用LLM |
| `CACHE_WARMUP_FAILED` | 预热失败 | 记录日志，不影响正常业务 |
| `CAPACITY_EXCEEDED` | 缓存容量超限 | 触发LRU淘汰 |

### 10.2 降级策略

```python
class CacheDegradation:
    """缓存降级策略"""
    
    @staticmethod
    async def lookup_with_degradation(cache_service, **kwargs) -> CacheLookupResult:
        """
        带降级的缓存查询
        任一层失败都不影响业务
        """
        try:
            return await cache_service.lookup(**kwargs)
        except RedisError:
            logger.warning("cache_l1_down_skip_redis")
            # 降级：跳过Redis，尝试直接查PG
            try:
                return await cache_service._semantic_querier.query(
                    input_text=kwargs["raw_input"],
                    scene=kwargs["scene"],
                    model_id=kwargs["model_id"],
                    subject=kwargs.get("subject"),
                    grade_range=kwargs.get("grade_range"),
                    threshold=0.95,  # 提高阈值（少了归一化可能不精确）
                )
            except Exception:
                return CacheLookupResult(result=CacheResult.MISS)
        except Exception as e:
            logger.error("cache_lookup_degradation", error=str(e))
            return CacheLookupResult(result=CacheResult.MISS)
```

---

## 11. 容量估算

### 11.1 存储估算

| 维度 | 估算值 | 说明 |
|------|--------|------|
| 题目解析缓存 | 50万条 × 平均2KB ≈ 1GB | 覆盖主流题目 |
| 知识点讲解缓存 | 20万条 × 平均1.5KB ≈ 300MB | 知识点+年级组合 |
| 辅导问答缓存 | 30万条 × 平均2KB ≈ 600MB | 一般问答 |
| 向量索引 | 100万条 × 3KB ≈ 3GB | 768维float32 |
| Redis L1 | 10万条 × 2KB ≈ 200MB | 热点缓存 |
| **合计** | **~5GB** | PG + Redis |

### 11.2 成本节省估算

| 假设条件 | 数值 |
|---------|------|
| 日均AI调用次数 | 50万次 |
| 平均每次调用成本 | ¥0.05 |
| 预期综合命中率 | 35% |
| 日均缓存命中次数 | 17.5万次 |
| 日均节省成本 | ¥8,750 |
| 月均节省成本 | ~¥26万 |

---

## 12. 部署与配置

### 12.1 环境变量

```env
# AI缓存服务配置
AI_CACHE_ENABLED=true
AI_CACHE_REDIS_URL=redis://redis:6379/5
AI_CACHE_PG_DSN=postgresql://user:pass@pg:5432/primetop_cache
AI_CACHE_EMBEDDING_SERVICE_URL=http://embedding-service:8080
AI_CACHE_DEFAULT_TTL_SECONDS=86400
AI_CACHE_MAX_ENTRIES_PER_SCENE=500000
AI_CACHE_SEMANTIC_DEFAULT_THRESHOLD=0.90
AI_CACHE_WARMUP_ENABLED=true
AI_CACHE_WARMUP_CONCURRENCY=3
AI_CACHE_WARMUP_COST_BUDGET_DAILY_USD=5.0
AI_CACHE_JANITOR_INTERVAL_SECONDS=3600
AI_CACHE_JANITOR_RETENTION_DAYS=30
```

### 12.2 Celery Worker 配置

```python
# 预热专用队列，独立Worker
WARMUP_WORKER_CONFIG = {
    "queues": ["warmup"],
    "concurrency": 3,
    "max_tasks_per_child": 50,
    "task_soft_time_limit": 1800,  # 30分钟
    "task_time_limit": 3600,
    "prefetch_multiplier": 1,
}
```
