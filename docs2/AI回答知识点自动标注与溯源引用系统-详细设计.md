# AI回答知识点自动标注与溯源引用系统 - 详细设计

## 1. 模块概述

### 1.1 定位与目标

本系统是 AI 学习闭环中的关键桥梁层，负责将 AI 生成的自由文本回答自动映射到结构化知识体系上。当 AI 回答一道数学题、讲解一个物理概念或分析一篇语文课文时，本系统自动完成以下工作：

1. **知识点提取**：从 AI 回答中识别涉及的知识点（显式提及 + 隐式关联）
2. **知识体系映射**：将提取的知识点映射到教材章节、课标考点和知识图谱节点
3. **溯源引用生成**：标注回答中各段内容的知识来源（教材页码、知识点文档、题库解析等）
4. **关联推荐计算**：基于标注结果推荐相关知识点、同类题和拓展阅读
5. **学习行为沉淀**：将知识点映射记录写入学习画像，驱动学情分析和个性化推荐

### 1.2 与周边模块的关系

```
┌──────────────┐     AI回答原文      ┌──────────────────────────┐
│  AI对话引擎   │ ──────────────────→ │  知识点自动标注与溯源引擎  │
│  (AI智能辅导) │                     │                          │
└──────────────┘                     │  1. 知识点提取器          │
                                     │  2. 知识体系映射器        │
┌──────────────┐  知识点树+教材映射   │  3. 溯源引用生成器        │
│ 知识点体系与  │ ←────────────────── │  4. 关联推荐引擎          │
│ 教材映射引擎  │ ──────────────────→ │  5. 标注结果持久化        │
└──────────────┘  查询知识点详情      └──────────────┬───────────┘
                                                      │
                        ┌─────────────────────────────┼──────────────────────────────┐
                        │                             │                              │
                        ▼                             ▼                              ▼
               ┌──────────────┐              ┌──────────────┐               ┌──────────────┐
               │  学习记录与   │              │  富文本渲染   │               │  学情分析与   │
               │  进度追踪服务  │              │  引擎(引用标注)│               │  用户画像     │
               └──────────────┘              └──────────────┘               └──────────────┘
```

### 1.3 设计原则

| 原则 | 说明 |
|------|------|
| 异步标注为主 | 知识点标注不阻塞 AI 回答流式输出，采用后置异步处理 |
| 实时标注为辅 | 对关键场景（如拍题答疑）提供同步快速标注，确保基础信息即时可用 |
| 分龄适配 | 不同学段标注粒度不同：幼儿粗粒度、高中细粒度 |
| 可解释性 | 每个标注结果必须附带置信度和来源说明，供用户和运营审核 |
| 渐进精确 | 首次标注允许粗粒度，后续通过用户反馈和后台校验逐步精确化 |

---

## 2. 核心数据结构

### 2.1 知识点标注结果 (AnswerAnnotation)

```python
class AnswerAnnotation(Base):
    """AI回答的知识点标注结果"""
    __tablename__ = "answer_annotations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)  # UUID
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    message_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)  # AI消息ID
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)

    # 标注元信息
    annotation_version: Mapped[int] = mapped_column(Integer, default=1)  # 标注版本(可修正)
    annotation_source: Mapped[str] = mapped_column(String(20), nullable=False)
    # SOURCE: rule_based | model_extract | rag_mapped | manual_review | user_feedback
    annotation_status: Mapped[str] = mapped_column(String(20), default="pending")
    # STATUS: pending | completed | partial | failed | review_required

    # 标注耗时
    extract_duration_ms: Mapped[int] = mapped_column(Integer, nullable=True)
    map_duration_ms: Mapped[int] = mapped_column(Integer, nullable=True)

    # 统计
    knowledge_point_count: Mapped[int] = mapped_column(Integer, default=0)
    textbook_ref_count: Mapped[int] = mapped_column(Integer, default=0)
    avg_confidence: Mapped[float] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

    # 关联
    points: Mapped[List["AnnotationKnowledgePoint"]] = relationship(back_populates="annotation")
    references: Mapped[List["AnnotationReference"]] = relationship(back_populates="annotation")
    recommendations: Mapped[List["AnnotationRecommendation"]] = relationship(back_populates="annotation")


class AnnotationKnowledgePoint(Base):
    """标注出的知识点关联"""
    __tablename__ = "annotation_knowledge_points"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    annotation_id: Mapped[str] = mapped_column(String(36), ForeignKey("answer_annotations.id"), index=True)

    # 知识点信息
    knowledge_point_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    knowledge_point_name: Mapped[str] = mapped_column(String(200), nullable=False)
    knowledge_point_code: Mapped[str] = mapped_column(String(50), nullable=False)  # 如 MATH-G7-ALG-EQ-01

    # 在回答中的定位
    mention_type: Mapped[str] = mapped_column(String(20), nullable=False)
    # TYPE: explicit (直接提及) | implicit (隐含/推理得到) | prerequisite (前置知识)
    text_segment_start: Mapped[int] = mapped_column(Integer, nullable=True)  # 回答文本中的起始位置
    text_segment_end: Mapped[int] = mapped_column(Integer, nullable=True)    # 回答文本中的结束位置
    text_segment: Mapped[str] = mapped_column(Text, nullable=True)  # 相关文本片段

    # 置信度与来源
    confidence: Mapped[float] = mapped_column(Float, nullable=False)  # 0.0 ~ 1.0
    extract_method: Mapped[str] = mapped_column(String(30), nullable=False)
    # METHOD: keyword_match | ner | embedding_similarity | rag_context | model_inference

    # 映射信息
    subject_code: Mapped[str] = mapped_column(String(10), nullable=False)
    grade_range: Mapped[str] = mapped_column(String(20), nullable=True)  # 如 "7-9"
    textbook_chapter_id: Mapped[str] = mapped_column(String(36), nullable=True)
    exam_point_ids: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array

    # 用户反馈
    user_confirmed: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)  # 用户确认/否定
    user_feedback: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    annotation: Mapped["AnswerAnnotation"] = relationship(back_populates="points")


class AnnotationReference(Base):
    """溯源引用记录"""
    __tablename__ = "annotation_references"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    annotation_id: Mapped[str] = mapped_column(String(36), ForeignKey("answer_annotations.id"), index=True)
    knowledge_point_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)

    # 引用来源类型
    ref_type: Mapped[str] = mapped_column(String(30), nullable=False)
    # TYPE: textbook | knowledge_doc | question_solution | exam_standard | external_resource
    ref_source_id: Mapped[str] = mapped_column(String(36), nullable=False)  # 来源记录ID
    ref_title: Mapped[str] = mapped_column(String(300), nullable=False)
    ref_summary: Mapped[str] = mapped_column(Text, nullable=True)  # 引用摘要

    # 教材定位
    textbook_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    textbook_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    chapter_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)  # 如 "第三章 > 3.2 方程"
    page_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # 关联度
    relevance_score: Mapped[float] = mapped_column(Float, default=0.5)  # 0.0 ~ 1.0

    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())

    annotation: Mapped["AnswerAnnotation"] = relationship(back_populates="references")


class AnnotationRecommendation(Base):
    """基于标注的关联推荐"""
    __tablename__ = "annotation_recommendations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    annotation_id: Mapped[str] = mapped_column(String(36), ForeignKey("answer_annotations.id"), index=True)

    # 推荐类型
    rec_type: Mapped[str] = mapped_column(String(30), nullable=False)
    # TYPE: related_knowledge | similar_question | extended_reading | review_reminder | prerequisite_review
    target_id: Mapped[str] = mapped_column(String(36), nullable=False)  # 推荐目标ID
    target_title: Mapped[str] = mapped_column(String(300), nullable=False)
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)
    # TARGET_TYPE: knowledge_point | question | chapter | course | article

    # 推荐理由
    reason: Mapped[str] = mapped_column(String(500), nullable=True)  # 如 "你在这道题中涉及的..."
    relevance_score: Mapped[float] = mapped_column(Float, default=0.5)

    # 用户行为
    clicked: Mapped[bool] = mapped_column(Boolean, default=False)
    clicked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    annotation: Mapped["AnswerAnnotation"] = relationship(back_populates="recommendations")
```

### 2.2 DDL (MySQL)

```sql
CREATE TABLE answer_annotations (
    id                  VARCHAR(36)    NOT NULL PRIMARY KEY,
    conversation_id     VARCHAR(36)    NOT NULL,
    message_id          VARCHAR(36)    NOT NULL,
    user_id             VARCHAR(36)    NOT NULL,
    annotation_version  INT            NOT NULL DEFAULT 1,
    annotation_source   VARCHAR(20)    NOT NULL COMMENT 'rule_based|model_extract|rag_mapped|manual_review|user_feedback',
    annotation_status   VARCHAR(20)    NOT NULL DEFAULT 'pending' COMMENT 'pending|completed|partial|failed|review_required',
    extract_duration_ms INT            NULL,
    map_duration_ms     INT            NULL,
    knowledge_point_count INT          NOT NULL DEFAULT 0,
    textbook_ref_count  INT            NOT NULL DEFAULT 0,
    avg_confidence      FLOAT          NULL,
    created_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_conversation (conversation_id),
    INDEX idx_message (message_id),
    INDEX idx_user (user_id),
    INDEX idx_status (annotation_status),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE annotation_knowledge_points (
    id                    VARCHAR(36)  NOT NULL PRIMARY KEY,
    annotation_id         VARCHAR(36)  NOT NULL,
    knowledge_point_id    VARCHAR(36)  NOT NULL,
    knowledge_point_name  VARCHAR(200) NOT NULL,
    knowledge_point_code  VARCHAR(50)  NOT NULL COMMENT '如 MATH-G7-ALG-EQ-01',
    mention_type          VARCHAR(20)  NOT NULL COMMENT 'explicit|implicit|prerequisite',
    text_segment_start    INT          NULL,
    text_segment_end      INT          NULL,
    text_segment          TEXT         NULL,
    confidence            FLOAT        NOT NULL COMMENT '0.0-1.0',
    extract_method        VARCHAR(30)  NOT NULL COMMENT 'keyword_match|ner|embedding_similarity|rag_context|model_inference',
    subject_code          VARCHAR(10)  NOT NULL,
    grade_range           VARCHAR(20)  NULL,
    textbook_chapter_id   VARCHAR(36)  NULL,
    exam_point_ids        TEXT         NULL COMMENT 'JSON array of exam point IDs',
    user_confirmed        TINYINT(1)   NULL COMMENT '用户确认/否定',
    user_feedback         VARCHAR(500) NULL,
    sort_order            INT          NOT NULL DEFAULT 0,
    INDEX idx_annotation (annotation_id),
    INDEX idx_kp (knowledge_point_id),
    INDEX idx_kp_code (knowledge_point_code),
    INDEX idx_subject (subject_code),
    FOREIGN KEY (annotation_id) REFERENCES answer_annotations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE annotation_references (
    id                VARCHAR(36)  NOT NULL PRIMARY KEY,
    annotation_id     VARCHAR(36)  NOT NULL,
    knowledge_point_id VARCHAR(36) NOT NULL,
    ref_type          VARCHAR(30)  NOT NULL COMMENT 'textbook|knowledge_doc|question_solution|exam_standard|external_resource',
    ref_source_id     VARCHAR(36)  NOT NULL,
    ref_title         VARCHAR(300) NOT NULL,
    ref_summary       TEXT         NULL,
    textbook_id       VARCHAR(36)  NULL,
    textbook_name     VARCHAR(200) NULL,
    chapter_path      VARCHAR(500) NULL COMMENT '如 第三章 > 3.2 方程',
    page_number       INT          NULL,
    relevance_score   FLOAT        NOT NULL DEFAULT 0.5,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_annotation (annotation_id),
    INDEX idx_kp (knowledge_point_id),
    INDEX idx_ref_type (ref_type),
    FOREIGN KEY (annotation_id) REFERENCES answer_annotations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE annotation_recommendations (
    id                VARCHAR(36)  NOT NULL PRIMARY KEY,
    annotation_id     VARCHAR(36)  NOT NULL,
    rec_type          VARCHAR(30)  NOT NULL COMMENT 'related_knowledge|similar_question|extended_reading|review_reminder|prerequisite_review',
    target_id         VARCHAR(36)  NOT NULL,
    target_title      VARCHAR(300) NOT NULL,
    target_type       VARCHAR(20)  NOT NULL COMMENT 'knowledge_point|question|chapter|course|article',
    reason            VARCHAR(500) NULL,
    relevance_score   FLOAT        NOT NULL DEFAULT 0.5,
    clicked           TINYINT(1)   NOT NULL DEFAULT 0,
    clicked_at        DATETIME     NULL,
    sort_order        INT          NOT NULL DEFAULT 0,
    INDEX idx_annotation (annotation_id),
    INDEX idx_rec_type (rec_type),
    FOREIGN KEY (annotation_id) REFERENCES answer_annotations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 2.3 Redis 缓存结构

```python
# 标注结果缓存 (写入后缓存，避免重复查询DB)
# Key: annotation:msg:{message_id}
# Value: JSON (AnswerAnnotation + points + references + recommendations 的完整快照)
# TTL: 24h (热点消息) → 后续按需加载
ANNOTATION_CACHE_KEY = "annotation:msg:{message_id}"
ANNOTATION_CACHE_TTL = 86400  # 24h

# 知识点→消息倒排索引 (用于"学过这个知识点的回答")
# Key: annotation:kp:{knowledge_point_id}:messages
# Value: Sorted Set (score=created_at, member=message_id)
# 过期：不设TTL，定期清理90天前数据
ANNOTATION_KP_INDEX_KEY = "annotation:kp:{knowledge_point_id}:messages"

# 用户→知识点覆盖度 bitmap (用于学情分析)
# Key: annotation:user:{user_id}:kp_coverage
# Value: Hash { knowledge_point_id: max_confidence }
# TTL: 7天，学情分析触发时重建
ANNOTATION_USER_COVERAGE_KEY = "annotation:user:{user_id}:kp_coverage"
```

---

## 3. 标注流程设计

### 3.1 整体流程

```
AI消息完成 (SSE结束) ─────┐
                          ▼
               ┌─────────────────────┐
               │  1. 快速同步标注      │  ← 阻塞式，<200ms
               │  (关键词+RAG上下文)   │
               └──────────┬──────────┘
                          │ 返回基础标注 (用于即时UI展示)
                          ▼
            ┌─────────────────────────────┐
            │  SSE推送: 知识点标签 + 引用   │  ← 前端追加渲染
            └─────────────────────────────┘
                          │
                          ▼ (异步，不阻塞用户)
               ┌─────────────────────┐
               │  2. 深度异步标注      │  ← Celery Task
               │  (NER+Embedding+LLM) │
               └──────────┬──────────┘
                          │
               ┌──────────▼──────────┐
               │  3. 知识体系映射      │  ← 查询知识点树+教材映射
               └──────────┬──────────┘
                          │
               ┌──────────▼──────────┐
               │  4. 溯源引用生成      │  ← 查询教材章节、题库解析
               └──────────┬──────────┘
                          │
               ┌──────────▼──────────┐
               │  5. 关联推荐计算      │  ← 基于标注结果推荐
               └──────────┬──────────┘
                          │
               ┌──────────▼──────────┐
               │  6. 标注结果持久化     │
               │  + 学习行为事件发布    │  ← 发送到事件总线
               └─────────────────────┘
```

### 3.2 阶段一：快速同步标注（< 200ms）

在 AI 回答流式输出完成后、用户阅读回答的同时，执行快速同步标注：

```python
class QuickAnnotationService:
    """快速同步标注 - 利用已有上下文信息，不做额外AI调用"""

    def __init__(self, db_session, redis_client, knowledge_point_repo):
        self.db = db_session
        self.redis = redis_client
        self.kp_repo = knowledge_point_repo

    async def annotate_quick(
        self,
        message_id: str,
        conversation_id: str,
        user_id: str,
        ai_answer: str,
        rag_context: list[RAGContextItem],  # RAG阶段已检索到的上下文
        user_profile: UserProfile,           # 含年级、学科、教材版本
        scene_context: SceneContext,          # 场景上下文(AI辅导/拍题/练习等)
    ) -> QuickAnnotationResult:
        """
        快速标注，目标 < 200ms。
        策略：仅利用 RAG 已检索结果 + 关键词匹配，不额外调用AI。
        """
        start = time.monotonic()

        # Step 1: 从 RAG 上下文中提取知识点 (0ms - 已有数据)
        rag_kps = self._extract_kps_from_rag_context(rag_context)

        # Step 2: 关键词匹配补充 (< 50ms)
        keyword_kps = await self._keyword_match(
            ai_answer, user_profile.subject_code, user_profile.grade
        )

        # Step 3: 合并去重
        all_kps = self._merge_and_dedup(rag_kps, keyword_kps)

        # Step 4: 按置信度排序，取 Top N
        top_kps = sorted(all_kps, key=lambda x: x.confidence, reverse=True)[:5]

        # Step 5: 查询教材映射 (< 50ms)
        for kp in top_kps:
            kp.textbook_mapping = await self.kp_repo.get_textbook_mapping(
                kp.knowledge_point_id, user_profile.textbook_id
            )

        # Step 6: 构建快速标注结果
        result = QuickAnnotationResult(
            message_id=message_id,
            conversation_id=conversation_id,
            user_id=user_id,
            knowledge_points=top_kps,
            duration_ms=int((time.monotonic() - start) * 1000),
        )

        return result

    def _extract_kps_from_rag_context(
        self, rag_context: list[RAGContextItem]
    ) -> list[ExtractedKnowledgePoint]:
        """从 RAG 检索结果中提取知识点 - RAG 检索阶段已标注"""
        kps = []
        seen = set()
        for item in rag_context:
            for kp_id in item.knowledge_point_ids:
                if kp_id not in seen:
                    seen.add(kp_id)
                    kps.append(ExtractedKnowledgePoint(
                        knowledge_point_id=kp_id,
                        knowledge_point_name=item.knowledge_point_name,
                        knowledge_point_code=item.knowledge_point_code,
                        confidence=item.relevance_score,  # 复用RAG的相关度分数
                        extract_method="rag_context",
                        mention_type="explicit" if item.is_primary else "implicit",
                    ))
        return kps

    async def _keyword_match(
        self, text: str, subject_code: str, grade: int
    ) -> list[ExtractedKnowledgePoint]:
        """基于关键词树快速匹配 - 使用 Aho-Corasick 多模式匹配"""
        # 加载该学科的知识点关键词树（Redis缓存）
        keyword_tree = await self._load_keyword_tree(subject_code)
        matches = keyword_tree.search(text)  # Aho-Corasick, O(n)

        results = []
        for match in matches:
            kp = await self.kp_repo.get_by_keyword_id(match.keyword_id)
            if kp and self._grade_compatible(kp.grade_range, grade):
                results.append(ExtractedKnowledgePoint(
                    knowledge_point_id=kp.id,
                    knowledge_point_name=kp.name,
                    knowledge_point_code=kp.code,
                    confidence=0.6,  # 关键词匹配基础置信度
                    extract_method="keyword_match",
                    mention_type="explicit",
                    text_segment_start=match.start,
                    text_segment_end=match.end,
                    text_segment=text[match.start:match.end],
                ))
        return results
```

### 3.3 阶段二：深度异步标注（Celery Task）

```python
@celery_app.task(
    name="annotation.deep_annotate",
    queue="annotation",
    max_retries=2,
    time_limit=30,
    soft_time_limit=25,
)
def deep_annotate_task(annotation_id: str, message_id: str, ai_answer: str,
                       quick_result_json: str, user_profile_json: str):
    """
    深度异步标注：
    1. NER 实体识别（数学概念、物理定律、化学反应等）
    2. Embedding 语义相似度匹配
    3. LLM 辅助提取（低优先级，高成本场景才启用）
    4. 溯源引用生成
    5. 关联推荐计算
    """
    service = DeepAnnotationService()
    try:
        result = service.run_full_pipeline(
            annotation_id=annotation_id,
            message_id=message_id,
            ai_answer=ai_answer,
            quick_result=QuickAnnotationResult.from_json(quick_result_json),
            user_profile=UserProfile.from_json(user_profile_json),
        )
        # 发布事件
        event_bus.publish("annotation.completed", {
            "annotation_id": annotation_id,
            "message_id": message_id,
            "kp_count": result.kp_count,
            "ref_count": result.ref_count,
            "rec_count": result.rec_count,
        })
        return {"status": "completed", "annotation_id": annotation_id}
    except SoftTimeLimitExceeded:
        # 超时，标记为 partial
        service.mark_partial(annotation_id)
        return {"status": "partial", "annotation_id": annotation_id}
    except Exception as e:
        service.mark_failed(annotation_id, str(e))
        raise


class DeepAnnotationService:

    def run_full_pipeline(self, annotation_id, message_id, ai_answer,
                          quick_result, user_profile):
        with annotate_performance("annotation.deep_pipeline") as perf:
            # Phase 1: NER 提取
            ner_kps = self._ner_extract(ai_answer, user_profile.subject_code)
            perf.tick("ner")

            # Phase 2: Embedding 语义匹配
            embedding_kps = self._embedding_match(ai_answer, user_profile)
            perf.tick("embedding")

            # Phase 3: 合并所有来源的知识点
            all_kps = self._merge_all_sources(quick_result.knowledge_points, ner_kps, embedding_kps)
            perf.tick("merge")

            # Phase 4: 知识体系映射
            mapped_kps = self._map_to_knowledge_tree(all_kps, user_profile)
            perf.tick("map")

            # Phase 5: 溯源引用生成
            references = self._generate_references(mapped_kps, user_profile)
            perf.tick("references")

            # Phase 6: 关联推荐
            recommendations = self._generate_recommendations(mapped_kps, user_profile)
            perf.tick("recommendations")

            # Phase 7: 持久化
            self._persist_results(annotation_id, mapped_kps, references, recommendations)
            perf.tick("persist")

            # Phase 8: 缓存更新
            self._update_cache(message_id, mapped_kps, references, recommendations)
            perf.tick("cache")

        return DeepAnnotationResult(
            kp_count=len(mapped_kps),
            ref_count=len(references),
            rec_count=len(recommendations),
        )

    def _ner_extract(self, text: str, subject_code: str) -> list[ExtractedKnowledgePoint]:
        """
        使用学科专用 NER 模型提取知识点实体。
        采用轻量级模型（如 BERT-CRF 或 DistilBERT-NER），本地部署。
        """
        # 学科→NER 模型映射
        model_map = {
            "MATH": "ner_math_v2",
            "PHYSICS": "ner_physics_v2",
            "CHEMISTRY": "ner_chemistry_v2",
            "CHINESE": "ner_chinese_v2",
            "ENGLISH": "ner_english_v2",
        }
        model_name = model_map.get(subject_code, "ner_general_v2")

        ner_result = ner_service.extract(
            text=text,
            model=model_name,
            entity_types=["CONCEPT", "FORMULA", "LAW", "TERM", "METHOD"],
        )

        results = []
        for entity in ner_result.entities:
            results.append(ExtractedKnowledgePoint(
                knowledge_point_id=None,  # 待映射阶段填充
                knowledge_point_name=entity.text,
                knowledge_point_code=None,
                confidence=entity.confidence,
                extract_method="ner",
                mention_type="explicit",
                text_segment_start=entity.start,
                text_segment_end=entity.end,
                text_segment=entity.text,
            ))
        return results

    def _embedding_match(self, text: str, user_profile: UserProfile) -> list[ExtractedKnowledgePoint]:
        """
        通过文本 Embedding 与知识点向量库做语义匹配。
        复用 RAG 系统的向量索引。
        """
        # 对整段回答做 embedding
        query_vector = embedding_service.embed(text, model="bge-large-zh-v1.5")

        # 在知识点向量库中搜索 Top-K
        search_results = vector_store.search(
            collection="knowledge_points",
            vector=query_vector,
            top_k=10,
            filters={
                "subject_code": user_profile.subject_code,
                "grade_range": {"$lte": user_profile.grade},
            },
            threshold=0.65,  # 语义相似度阈值
        )

        results = []
        for hit in search_results:
            results.append(ExtractedKnowledgePoint(
                knowledge_point_id=hit.id,
                knowledge_point_name=hit.metadata["name"],
                knowledge_point_code=hit.metadata["code"],
                confidence=hit.score,
                extract_method="embedding_similarity",
                mention_type="implicit",  # 语义匹配通常是隐式关联
            ))
        return results

    def _merge_all_sources(self, quick_kps, ner_kps, embedding_kps):
        """合并多来源知识点，去重并融合置信度"""
        kp_map: dict[str, MergedKnowledgePoint] = {}

        all_sources = [
            ("quick", quick_kps),
            ("ner", ner_kps),
            ("embedding", embedding_kps),
        ]

        for source_name, kps in all_sources:
            for kp in kps:
                key = kp.knowledge_point_id or kp.knowledge_point_name
                if key in kp_map:
                    existing = kp_map[key]
                    # 融合置信度：加权平均 + 多源加分
                    existing.sources.append(source_name)
                    existing.confidence = min(
                        existing.confidence * 0.6 + kp.confidence * 0.4 + 0.1 * (len(existing.sources) - 1),
                        1.0
                    )
                    # 取更好的文本定位
                    if kp.text_segment_start is not None and existing.text_segment_start is None:
                        existing.text_segment_start = kp.text_segment_start
                        existing.text_segment_end = kp.text_segment_end
                        existing.text_segment = kp.text_segment
                else:
                    kp_map[key] = MergedKnowledgePoint(
                        knowledge_point_id=kp.knowledge_point_id,
                        knowledge_point_name=kp.knowledge_point_name,
                        knowledge_point_code=kp.knowledge_point_code,
                        confidence=kp.confidence,
                        sources=[source_name],
                        text_segment_start=kp.text_segment_start,
                        text_segment_end=kp.text_segment_end,
                        text_segment=kp.text_segment,
                    )

        return sorted(kp_map.values(), key=lambda x: x.confidence, reverse=True)