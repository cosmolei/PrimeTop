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

    # ---------- Phase 4: 知识体系映射 ----------

    def _map_to_knowledge_tree(self, merged_kps, user_profile: UserProfile) -> list[MappedKnowledgePoint]:
        """
        将合并后的候选映射到结构化知识体系：
        1. 已有 kp_id 的候选（rag_context / embedding / keyword_match）→ 仅做学段适配校验
        2. 无 kp_id 的 NER 实体 → 别名词典精确解析 → 向量检索兜底 → LLM 辅助(可选) → 仍失败则丢弃并记录
        3. 前置知识扩展：对映射成功的 Top 知识点查询前置依赖，补充 prerequisite 类型
        4. 按学段粒度截断（见 §4 分龄策略表）
        """
        resolved, unresolved = [], []
        for kp in merged_kps:
            (resolved if kp.knowledge_point_id else unresolved).append(kp)

        for entity in unresolved:
            mapped = self._resolve_entity(entity, user_profile)
            if mapped:
                resolved.append(mapped)
            else:
                self._log_unresolved(entity, user_profile)  # 术语候选回流，见 §13 契约

        # 学段过滤：不匹配的剔除；相邻学段且显式提及的高置信候选降权保留（资优生场景）
        adapted = []
        for kp in resolved:
            fit = self._grade_fit(kp.grade_range, user_profile.grade)
            if fit == "fit":
                adapted.append(kp)
            elif fit == "adjacent" and kp.mention_type == "explicit" and kp.confidence >= 0.8:
                kp.confidence *= 0.7
                adapted.append(kp)
            # else: 丢弃（超纲且非显式提及）

        # 前置知识扩展（仅一层；高中可配二层）
        top_ids = [kp.knowledge_point_id for kp in adapted[:3]]
        prereq_edges = self.kp_repo.get_prerequisites(top_ids, max_depth=1)
        known_ids = {kp.knowledge_point_id for kp in adapted}
        for edge in prereq_edges:
            if edge.prerequisite_id in known_ids or edge.grade_gte > user_profile.grade:
                continue
            adapted.append(MappedKnowledgePoint(
                knowledge_point_id=edge.prerequisite_id,
                knowledge_point_name=edge.prerequisite_name,
                knowledge_point_code=edge.prerequisite_code,
                confidence=edge.weight * 0.8,        # 前置推断：关联权重打折
                extract_method="model_inference",
                mention_type="prerequisite",
                grade_range=edge.grade_range,
            ))

        adapted.sort(key=lambda x: x.confidence, reverse=True)
        limit = STAGE_KP_LIMITS[user_profile.stage_key]           # 见 §4
        min_conf = STAGE_MIN_CONFIDENCE[user_profile.stage_key]   # 见 §4
        return [kp for kp in adapted if kp.confidence >= min_conf][:limit]

    def _resolve_entity(self, entity, user_profile):
        """NER 实体 → 知识点ID：学科术语词典精确/别名命中 → 向量检索兜底"""
        # ① 学科术语词典（ES，含 alias 索引），预算 < 30ms
        hit = self.term_dict.lookup(
            term=entity.knowledge_point_name,
            subject_code=user_profile.subject_code,
            grade_lte=user_profile.grade,
        )
        if hit and hit.exact:
            entity.knowledge_point_id = hit.knowledge_point_id
            entity.knowledge_point_code = hit.code
            entity.grade_range = hit.grade_range
            entity.confidence = min(entity.confidence + 0.15, 0.95)  # 词典精确命中加分
            return entity

        # ② 向量检索兜底（复用 RAG 知识点向量库），预算 < 80ms
        vec = embedding_service.embed(entity.knowledge_point_name)
        near = vector_store.search(
            collection="knowledge_points", vector=vec, top_k=3,
            filters={"subject_code": user_profile.subject_code},
            threshold=0.70,
        )
        if near:
            best = near[0]
            entity.knowledge_point_id = best.id
            entity.knowledge_point_code = best.metadata["code"]
            entity.grade_range = best.metadata["grade_range"]
            entity.confidence = min(best.score * 0.9, 0.90)
            return entity

        # ③ LLM 辅助解析（默认关闭，成本门控见 §3.3.5）
        if self.config.llm_assist_enabled:
            return self._llm_resolve(entity, user_profile)
        return None

    def _log_unresolved(self, entity, user_profile):
        """未解析实体入库：供术语词典扩充与 NER 模型迭代回流（§13 契约）"""
        self.db.execute(
            """INSERT INTO annotation_unresolved_entities
                   (entity_text, subject_code, stage_key, ner_model, message_id, created_at)
               VALUES (%s, %s, %s, %s, %s, NOW())""",
            (entity.text_segment, user_profile.subject_code,
             user_profile.stage_key, self.ner_model_version, self.message_id),
        )

    # ---------- Phase 5: 溯源引用生成 ----------

    # 每个知识点各类引用的上限（防引用爆炸）
    REF_TYPE_LIMITS = {"textbook": 2, "knowledge_doc": 1,
                       "question_solution": 1, "exam_standard": 1}

    def _generate_references(self, mapped_kps, user_profile) -> list[AnnotationReference]:
        """
        逐知识点生成溯源引用。任一来源查询失败 → 跳过该来源不阻塞整体（降级矩阵 D5-D8）。
        版权红线：引用仅存元数据 + ≤50 字摘要，不落正文全文（§12）。
        """
        references = []
        total_limit = 4 if user_profile.stage_key in ("ECE", "PRIMARY_LOW") else 10
        used = {t: 0 for t in self.REF_TYPE_LIMITS}

        for kp in mapped_kps:
            # ① 教材引用（知识点体系与教材映射引擎）
            if used["textbook"] < self.REF_TYPE_LIMITS["textbook"]:
                try:
                    m = self.kp_repo.get_textbook_mapping(
                        kp.knowledge_point_id, user_profile.textbook_id, timeout_ms=100)
                    if m:
                        used["textbook"] += 1
                        references.append(self._build_ref(
                            kp=kp, ref_type="textbook", ref_source_id=m.chapter_id,
                            ref_title=f"{m.textbook_name} · {m.chapter_path}",
                            ref_summary=(m.chapter_summary or "")[:50],
                            textbook_id=m.textbook_id, textbook_name=m.textbook_name,
                            chapter_path=m.chapter_path, page_number=m.page_number,
                            relevance_score=kp.confidence * 0.9))
                except ExternalServiceTimeout:
                    metrics.incr("annotation.ref.textbook.degraded")

            # ② 知识文档（RAG 语料库中该知识点的权威讲解文档）
            if used["knowledge_doc"] < self.REF_TYPE_LIMITS["knowledge_doc"]:
                doc = self.rag_corpus.get_canonical_doc(kp.knowledge_point_id)
                if doc:
                    used["knowledge_doc"] += 1
                    references.append(self._build_ref(
                        kp=kp, ref_type="knowledge_doc", ref_source_id=doc.doc_id,
                        ref_title=doc.title, ref_summary=(doc.summary or "")[:50],
                        relevance_score=kp.confidence * 0.85))

            # ③ 题库解析（同章节代表题；优先用户错过的题——未查到用户作答则取高频题）
            if used["question_solution"] < self.REF_TYPE_LIMITS["question_solution"]:
                q = self.question_repo.find_representative(
                    knowledge_point_id=kp.knowledge_point_id,
                    user_id=user_profile.user_id,          # 查询失败不阻塞
                    prefer_wronged=True, limit=1)
                if q:
                    used["question_solution"] += 1
                    references.append(self._build_ref(
                        kp=kp, ref_type="question_solution", ref_source_id=q.question_id,
                        ref_title=f"例题 · {q.stem_brief}",
                        ref_summary=q.solution_brief[:50] if q.solution_brief else None,
                        relevance_score=kp.confidence * 0.7))

            # ④ 课标考点（课程标准数据库；读失败降级跳过——对方文档 §1129 已约定）
            if kp.exam_point_ids:
                for ep_id in json.loads(kp.exam_point_ids)[:1]:
                    ep = self.curriculum_repo.get_item_cached(ep_id)
                    if ep:
                        references.append(self._build_ref(
                            kp=kp, ref_type="exam_standard", ref_source_id=ep_id,
                            ref_title=f"课标 · {ep.code}", ref_summary=ep.statement[:50],
                            relevance_score=kp.confidence * 0.8))
                        break

        references.sort(key=lambda r: r.relevance_score, reverse=True)
        return references[:total_limit]

    # ---------- Phase 6: 关联推荐计算 ----------

    def _generate_recommendations(self, mapped_kps, user_profile) -> list[AnnotationRecommendation]:
        """
        基于标注结果的规则式推荐（不走大模型，全部本地/缓存查询）。
        全部依赖失败时返回空列表，标注主流程不受影响（D9）。
        """
        recs = []
        top = mapped_kps[0] if mapped_kps else None
        if not top:
            return recs

        # ① 关联知识点（同章节兄弟节点，掌握度低于 0.6 的优先）
        for sibling in self.kp_repo.get_siblings(top.knowledge_point_id, limit=4):
            mastery = self.mastery_cache.get(user_profile.user_id, sibling.id)  # None=未知
            if mastery is not None and mastery >= 0.6:
                continue
            recs.append(("related_knowledge", sibling.id, sibling.name, "knowledge_point",
                         f"与「{top.knowledge_point_name}」同章节关联", 0.6 if mastery is None else 0.75))

        # ② 同类题练习（题库；排除 7 天内已曝光——推荐疲劳引擎，失败忽略）
        for q in self.question_repo.find_similar(top.knowledge_point_id,
                                                 exclude_exposed_user=user_profile.user_id,
                                                 limit=2):
            recs.append(("similar_question", q.question_id, q.stem_brief, "question",
                         "针对刚学知识点的即时巩固练习", 0.7))

        # ③ 前置补弱（前置知识点掌握度 < 0.4 时触发）
        for kp in mapped_kps:
            if kp.mention_type != "prerequisite":
                continue
            mastery = self.mastery_cache.get(user_profile.user_id, kp.knowledge_point_id)
            if mastery is not None and mastery < 0.4:
                recs.append(("prerequisite_review", kp.knowledge_point_id,
                             kp.knowledge_point_name, "knowledge_point",
                             "该前置知识掌握较弱，建议先补齐再继续", 0.85))

        # ④ 复习提醒（SM-2 队列中含该知识点且 48h 内到期）
        due = self.review_queue.due_within(user_profile.user_id,
                                           [kp.knowledge_point_id for kp in mapped_kps], hours=48)
        for kp_id, due_at in due[:1]:
            recs.append(("review_reminder", kp_id, "错题/卡片复习", "knowledge_point",
                         f"复习计划 {due_at:%m-%d} 到期，含本回答知识点", 0.8))

        # 去重（同 target 只保留高分项）+ 排序 + 截断（幼儿 2 / 小学低 3 / 其余 5）
        best: dict[str, tuple] = {}
        for r in recs:
            key = f"{r[0]}:{r[1]}"
            if key not in best or r[5] > best[key][5]:
                best[key] = r
        ordered = sorted(best.values(), key=lambda r: r[5], reverse=True)
        limit = 2 if user_profile.stage_key == "ECE" else (3 if user_profile.stage_key == "PRIMARY_LOW" else 5)
        return [
            AnnotationRecommendation(
                rec_type=t, target_id=tid, target_title=tt, target_type=ty,
                reason=reason, relevance_score=score, sort_order=i)
            for i, (t, tid, tt, ty, reason, score) in enumerate(ordered[:limit])
        ]

    # ---------- Phase 7/8: 持久化与缓存 ----------

    def _persist_results(self, annotation_id, message_id, conversation_id, user_id,
                         mapped_kps, references, recommendations):
        """
        主表 message_id 唯一键 upsert（uk_message，§7.3 DDL 修订）+ 子表全量替换 +
        Outbox 事件同事务写入（§8）。整个方法在一个 DB 事务内。
        """
        avg_conf = round(sum(kp.confidence for kp in mapped_kps) / len(mapped_kps), 4) \
            if mapped_kps else None
        with self.db.transaction() as tx:
            tx.execute("""
                INSERT INTO answer_annotations
                    (id, conversation_id, message_id, user_id, annotation_source,
                     annotation_status, extract_duration_ms, map_duration_ms,
                     knowledge_point_count, textbook_ref_count, avg_confidence)
                VALUES (%s,%s,%s,%s,'model_extract','completed',%s,%s,%s,%s,%s)
                AS new
                ON DUPLICATE KEY UPDATE
                    annotation_version = answer_annotations.annotation_version + 1,
                    annotation_source   = 'model_extract',
                    annotation_status   = 'completed',
                    extract_duration_ms = new.extract_duration_ms,
                    map_duration_ms     = new.map_duration_ms,
                    knowledge_point_count = new.knowledge_point_count,
                    textbook_ref_count  = new.textbook_ref_count,
                    avg_confidence      = new.avg_confidence
            """, (annotation_id, conversation_id, message_id, user_id,
                  self.perf.get_ms("ner") + self.perf.get_ms("embedding"),
                  self.perf.get_ms("map"),
                  len(mapped_kps),
                  sum(1 for r in references if r.ref_type == "textbook"),
                  avg_conf))

            # 子表行数小（≤8+10+5），全量替换最简单且天然幂等
            for table, rows in (("annotation_knowledge_points", mapped_kps),
                                ("annotation_references", references),
                                ("annotation_recommendations", recommendations)):
                tx.execute(f"DELETE FROM {table} WHERE annotation_id = %s", (annotation_id,))
                if rows:
                    tx.executemany(self._insert_sql(table), self._to_row_params(annotation_id, rows))

            # Outbox：与业务数据同事务（§8.1），发布 annotation.deep.completed
            tx.execute("""
                INSERT INTO annotation_outbox (event_id, event_type, aggregate_id, payload)
                VALUES (%s, 'annotation.deep.completed', %s, %s)
            """, (uuid4().hex, annotation_id,
                  json.dumps({"message_id": message_id, "user_id": user_id,
                              "annotation_version": "incremented",  # 发布器回填实际版本
                              "kp_count": len(mapped_kps), "ref_count": len(references)})))

    def _update_cache(self, message_id, user_id, annotation_version,
                      mapped_kps, references, recommendations):
        """缓存三件套；任何一项失败仅记日志，不影响主流程（D10）"""
        try:
            # ① 结果快照（24h）
            snapshot = {"annotation_version": annotation_version,
                        "knowledge_points": [asdict(kp) for kp in mapped_kps],
                        "references": [asdict(r) for r in references],
                        "recommendations": [asdict(r) for r in recommendations]}
            self.redis.setex(f"annotation:msg:{message_id}", 86400, json.dumps(snapshot))

            pipe = self.redis.pipeline()
            now = time.time()
            for kp in mapped_kps:
                # ② 知识点→消息倒排（ZSET，score=created_at）
                pipe.zadd(f"annotation:kp:{kp.knowledge_point_id}:messages",
                          {message_id: now}, nx=True)
                # ③ 用户覆盖度 Hash：保留历史最大置信度
                pipe.hset(f"annotation:user:{user_id}:kp_coverage", kp.knowledge_point_id,
                          kp.confidence)  # HSET 不比较，下方 Lua 保证 max 语义
            pipe.eval(COVERAGE_MAX_LUA, keys=[], args=[user_id] +
                      [x for kp in mapped_kps for x in (kp.knowledge_point_id, kp.confidence)])
            pipe.execute()
        except RedisError as e:
            logger.warning("annotation cache update failed msg=%s err=%s", message_id, e)

    # ---------- 异常标记 ----------

    def mark_partial(self, annotation_id: str):
        """soft_time_limit 触发：已完成的知识点子集保留，状态置 partial，不发 completed 事件"""
        with self.db.transaction() as tx:
            tx.execute("""UPDATE answer_annotations
                          SET annotation_status='partial'
                          WHERE id=%s AND annotation_status IN ('pending','completed')""",
                       (annotation_id,))
            tx.execute("""INSERT INTO annotation_outbox (event_id, event_type, aggregate_id, payload)
                          VALUES (%s,'annotation.deep.partial',%s,%s)""",
                       (uuid4().hex, annotation_id, json.dumps({"annotation_id": annotation_id})))

    def mark_failed(self, annotation_id: str, error: str):
        """重试耗尽/持久化失败：状态置 failed；保留 quick 阶段结果供前端兜底展示"""
        with self.db.transaction() as tx:
            tx.execute("""UPDATE answer_annotations
                          SET annotation_status='failed'
                          WHERE id=%s AND annotation_status='pending'""", (annotation_id,))
            tx.execute("""INSERT INTO annotation_outbox (event_id, event_type, aggregate_id, payload)
                          VALUES (%s,'annotation.deep.failed',%s,%s)""",
                       (uuid4().hex, annotation_id,
                        json.dumps({"annotation_id": annotation_id, "error": error[:500]})))
```

未解析实体沉淀表（Phase 4 使用）：

```sql
CREATE TABLE annotation_unresolved_entities (
    id          BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
    entity_text VARCHAR(200) NOT NULL COMMENT 'NER识别但未映射到知识点的实体',
    subject_code VARCHAR(10) NOT NULL,
    stage_key   VARCHAR(20) NOT NULL COMMENT 'ECE|PRIMARY_LOW|PRIMARY_HIGH|JUNIOR|SENIOR',
    ner_model   VARCHAR(50) NOT NULL COMMENT '产生该实体的NER模型版本',
    message_id  VARCHAR(36) NOT NULL,
    created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_subject_stage (subject_code, stage_key),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='未解析实体日志：按周聚合供术语词典扩充评审（§13 契约）';
```

### 3.3.1 入口双模式：ARPP 同步门面与 Celery 异步

系统提供两个深度标注入口，内部复用同一 `DeepAnnotationService.run_full_pipeline` 代码路径：

| 入口 | 调用方 | 触发方式 | 时效预算 | 说明 |
| --- | --- | --- | --- | --- |
| 同步门面 `annotate_deep()` | 《AI回答后处理与智能优化管线》KnowledgeTagFilter（§3.8） | 进程内调用 | 8s（调用方 asyncio.wait_for 控制） | 超时后调用方转入 `pipeline.tagging.retry` 重试队列，本服务消费重试再跑（幂等：version+1 upsert，客户端按版本幂等渲染） |
| Celery `deep_annotate_task` | AI 对话引擎直投（拍题/作文等非 ARPP 场景）、管理端批量重处理 | MQ 异步 | 25s soft / 30s hard | 带自动重试（max_retries=2，指数退避） |

```python
class AnnotateDeepFacade:
    """对齐《AI回答后处理与智能优化管线》§3.8 的同步调用契约"""

    async def annotate_deep(self, *, text: str, subject_id: str, stage: str,
                            textbook_version: str, max_kps: int | None = None,
                            min_confidence: float | None = None,
                            candidate_kps: list[str] | None = None) -> DeepAnnotation:
        """
        - candidate_kps：调用方透传的 quick_kp_hints（快速标注结果 ID），直接并入合并阶段
        - max_kps / min_confidence 为 None 时按 §4 学段默认值
        - 返回对象必须含 .knowledge_points / .references（调用方直接序列化进 SSE）
        """
        user_profile = await self.profile_service.get_snapshot(subject_id, stage, textbook_version)
        service = DeepAnnotationService(config=self.config.with_overrides(
            max_kps=max_kps, min_confidence=min_confidence,
            candidate_kps=candidate_kps or []))
        result = await asyncio.to_thread(service.run_full_pipeline_for_text, text, user_profile)
        return result  # DeepAnnotation(knowledge_points=..., references=...)
```

### 3.3.2 LLM 辅助提取（可选阶段，成本门控）

NER + 向量仍未解析的实体，在预算允许时可交由 LLM 批量解析。**默认关闭**，仅在高价值场景（高中理科难题讲解）由配置开启：

```python
class LLMAssistResolver:
    """成本门控的 LLM 实体解析器"""

    async def resolve_batch(self, entities: list[str], user_profile) -> dict[str, str]:
        # 门控三条件，任一不满足直接返回空 dict（主流程无感降级）
        if not self.config.llm_assist_enabled:                      # ① 功能开关
            return {}
        if self.daily_budget.exceeded("annotation_llm_assist"):      # ② 日预算（token 计量服务）
            return {}
        if len(entities) < 2:                                        # ③ 单实体不值得调用，批量≥2
            return {}

        prompt = f"""你是知识点标注助手。将下列学科实体映射到知识点编码。
仅使用提供的候选编码列表，不确定的返回 null。
候选编码：{self.candidate_codes_for(user_profile)}
实体列表：{json.dumps(entities, ensure_ascii=False)}
输出 JSON: {{"<实体>": "<编码或null>"}}"""
        try:
            resp = await asyncio.wait_for(
                self.llm.chat_json(prompt=prompt, temperature=0.0), timeout=3.0)
            # LLM 结果置信度固定 0.75（低于词典/向量路径，排序天然靠后）
            return {k: v for k, v in resp.items() if v}
        except (TimeoutError, LLMError):
            metrics.incr("annotation.llm_assist.degraded")
            return {}
```

---

## 4. 分龄标注粒度与置信度策略

设计原则「分龄适配」的落地参数表。所有参数可配置热更新（配置中心 `annotation.stage.*`）：

| 学段 | stage_key | 知识点上限 | mention_type 允许集 | 最低置信度 | 前置展开 | 引用总上限 | 推荐上限 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 幼儿启蒙 | ECE | 2 | explicit | 0.75 | 否 | 4 | 2 |
| 小学低段(1-3) | PRIMARY_LOW | 3 | explicit | 0.70 | 否 | 4 | 3 |
| 小学高段(4-6) | PRIMARY_HIGH | 5 | explicit + implicit | 0.65 | 一层(仅必前置) | 10 | 5 |
| 初中(7-9) | JUNIOR | 6 | 全部 | 0.60 | 一层 | 10 | 5 |
| 高中(10-12) | SENIOR | 8 | 全部 | 0.55 | 二层(可配) | 10 | 5 |

```python
STAGE_KP_LIMITS = {"ECE": 2, "PRIMARY_LOW": 3, "PRIMARY_HIGH": 5, "JUNIOR": 6, "SENIOR": 8}
STAGE_MIN_CONFIDENCE = {"ECE": 0.75, "PRIMARY_LOW": 0.70, "PRIMARY_HIGH": 0.65,
                        "JUNIOR": 0.60, "SENIOR": 0.55}
STAGE_PREREQ_DEPTH = {"ECE": 0, "PRIMARY_LOW": 0, "PRIMARY_HIGH": 1, "JUNIOR": 1, "SENIOR": 2}
```

**幼儿段专项约束**：
1. 只保留显式提及的常识性/启蒙知识点（如“声母”“单韵母”“5 以内加减”），概念性超纲标注一律过滤；
2. 不生成 question_solution 引用（幼儿段无题库练习诉求），推荐只出 related_knowledge；
3. UI 侧芯片不显示置信度，文案由富文本渲染引擎按学段改写（“这个知识点在课本第 X 页”→“宝宝刚才学的是数数哦”）。

**置信度融合口径**（`_merge_all_sources` 公式的可解释性说明）：多来源命中是强信号，每次新增来源 +0.1 加分，但单来源封顶 0.95、融合后封顶 1.0；user confirm 反馈 ×1.1 封顶 1.0。运营可在复核工作台看到每个知识点的来源列表（sources 字段），满足 §1.3 可解释性原则。

---

## 5. 标注修正闭环：用户反馈 / 人工复核 / 重跑

```
用户点击知识点芯片“不对” ──→ POST /annotations/{id}/points/{row_id}/feedback (reject)
        │                              │
        │                    user_confirmed=false，该行渲染层过滤
        │                    annotation_source=user_feedback，version+1
        │                              │
        │                    同一 annotation 否定反馈 ≥2 ──→ review_required
        │                              │
        ▼                              ▼
用户点击“就是这个” ── confirm    管理后台复核队列（按 subject 分组）
   conf×1.1，version+1                │
                            ┌─────────┼──────────┐
                            ▼         ▼          ▼
                         approve   modify     reject(全部推翻)
                        (维持现状) (增删知识点/  状态回 completed，
                                   改置信度)    annotation_source=manual_review
                            │         │          │
                            └─────────┴────┬─────┘
                                           ▼
                            annotation.updated 事件（version++）
                            → 掌握度引擎重算 / SSE 重推 knowledge_ref
```

**规则表**：

| 规则 | 条件 | 动作 |
| --- | --- | --- |
| R1 反馈窗口 | 标注创建后 30 天内（feedback.window_days） | 窗口外返回 54019 |
| R2 单点否定 | 某 kp 行被 reject | 行保留（审计），user_confirmed=false，渲染层过滤 |
| R3 升级复核 | 同一 annotation 累计否定 ≥2 或 avg_confidence < 0.55（复核阈值可配） | annotation_status → review_required，推 AI 对话质量抽样审核工作台 |
| R4 确认加权 | confirm | 该行 confidence ×1.1 封顶 1.0，version+1 |
| R5 复核修正 | 管理员 modify | 子表按管理员提交全量替换，annotation_source=manual_review，version+1 |
| R6 版本回滚 | 复核 reject 全部 | 恢复上一 revision 快照，无则仅清空知识点子表 |
| R7 重跑保护 | reprocess 与在途 Celery 任务冲突 | 返回 54021，需等在途任务终态 |

修正后的所有版本变化写入修订日志（§7.3），任何版本可回溯。

---

## 6. API 接口设计

### 6.1 学生端 REST（网关前缀 /api/v1，鉴权：学生 Token）

#### 6.1.1 查询消息标注结果

```
GET /annotations/messages/{message_id}
```

响应（缓存优先，miss 落库，见 §2.3）：

```json
{
  "code": 0,
  "data": {
    "messageId": "msg_9f2c",
    "annotationId": "ann_71b0",
    "annotationVersion": 3,
    "annotationSource": "manual_review",
    "annotationStatus": "completed",
    "knowledgePoints": [
      {
        "rowId": "akp_001",
        "knowledgePointId": "kp_1001",
        "name": "一元二次方程求根公式",
        "code": "MATH-G8-ALG-QE-02",
        "mentionType": "explicit",
        "confidence": 0.92,
        "chapter": {"id": "ch_88", "path": "第2章 > 2.2 一元二次方程"},
        "userConfirmed": null
      }
    ],
    "references": [
      {
        "refId": "ref_01", "refType": "textbook",
        "title": "人教版数学八年级下 · 第2章 > 2.2",
        "chapterPath": "第2章 > 2.2 一元二次方程", "pageNumber": 32,
        "jumpUrl": "primetop://reader/chapter/ch_88?anchor=kp_1001"
      }
    ],
    "recommendations": [
      {"recId": "rec_01", "recType": "similar_question", "targetId": "q_50021",
       "targetTitle": "用公式法解 x²-4x+3=0", "reason": "针对刚学知识点的即时巩固练习",
       "relevanceScore": 0.7, "clicked": false}
    ]
  }
}
```

错误：54001（不存在，含未开始/已删除）；标注仍在 pending 时返回 `annotationStatus:"pending"` 与空列表（200，不报错——前端骨架芯片）。

#### 6.1.2 会话级知识点聚合

```
GET /annotations/conversations/{conversation_id}/knowledge-points
```

返回该会话所有消息标注去重后的知识点列表（score=出现次数×最大置信度），用于会话总结、知识点面板。分页同统一分页规范。

#### 6.1.3 知识点→回答倒排查询

```
GET /annotations/knowledge-points/{kp_id}/messages?page=1&size=20
```

基于 §2.3 倒排 ZSET，仅返回近 90 天内当前用户自己的消息（越权校验：ZSET member 前缀校验 user_id，54004）。用于“我在哪些回答里学过这个知识点”。

#### 6.1.4 知识点反馈

```
POST /annotations/{annotation_id}/points/{row_id}/feedback
{ "action": "confirm" | "reject", "reason": "应该属于配方法而不是公式法" }
```

幂等：同 (row_id, action) 重复提交返回成功不重复计数；action 变更（confirm→reject）按最新一次生效。响应返回更新后的 confidence 与 annotationVersion。错误：54001 / 54018（参数）/ 54019（超窗口）。

#### 6.1.5 用户知识覆盖度

```
GET /users/me/knowledge-coverage?subject=MATH
```

读 §2.3 覆盖度 Hash；miss 时同步重建（扫描近 90 天 annotation_knowledge_points，≤500ms；失败返回空集 + `degraded:true`，不报 5xx）。学情分析服务亦通过内部 gRPC 调用同源数据。

### 6.2 内部接口（服务间）

#### 6.2.1 同步门面（ARPP 进程内/HTTP 双形态）

进程内 SDK 为主；跨语言部署时降级 HTTP：

```
POST /internal/annotations/deep        # Idempotency-Key: message_id
{
  "messageId": "msg_9f2c",
  "conversationId": "conv_31a",
  "userId": "u_7",
  "text": "<AI回答全文>",
  "subjectId": "MATH",
  "stage": "JUNIOR",
  "textbookVersion": "PEP-2024",
  "maxKps": null,
  "minConfidence": null,
  "candidateKps": ["kp_1001"]
}
```

响应即 §3.3.1 的 DeepAnnotation 序列化。`Idempotency-Key: message_id` 保证 ARPP 重试队列重发不产生重复版本（同 key 7 天内返回首次结果）。

#### 6.2.2 gRPC

```protobuf
service AnnotationService {
  // 深度标注（异步包装：立即返回 annotationId，结果走事件/SSE）
  rpc DeepAnnotate(DeepAnnotateRequest) returns (DeepAnnotateAck);
  // 消息标注查询（掌握度引擎/学习记录服务拉取复用）
  rpc GetByMessage(GetByMessageRequest) returns (AnswerAnnotationDTO);
  // 覆盖度批量查询（画像特征工程平台）
  rpc BatchCoverage(BatchCoverageRequest) returns (BatchCoverageResponse);
}

message AnswerAnnotationDTO {
  string annotation_id = 1;
  int32 annotation_version = 2;
  string annotation_status = 3;
  repeated KPAnnotationDTO points = 4;   // 对齐掌握度引擎 KPAnnotation：
}                                        // knowledgePointId/relevanceScore(=confidence)/
message KPAnnotationDTO {               // annotationSource(AUTO|MANUAL)
  string knowledge_point_id = 1;
  string code = 2;
  float  relevance_score = 3;
  string annotation_source = 4;   // AUTO=自动标注, MANUAL=人工复核/用户反馈后
  string mention_type = 5;
}
```

### 6.3 管理端（/admin/annotations，运营/教研角色）

```
GET  /admin/annotations/review-queue?status=review_required&subject=MATH&page=1
GET  /admin/annotations/{id}/revisions                      # 版本历史
POST /admin/annotations/{id}/review   {"action":"approve|modify|reject",
                                        "points":[{"kpId":"kp_1001","confidence":0.9}]}   # 仅 modify 携带 points
POST /admin/annotations/{id}/reprocess {"reason":"词库更新v12"}   # 重新跑深度管线，守卫 R7
GET  /admin/annotations/unresolved-entities?subject=MATH&days=7   # 未解析实体聚合（术语候选）
```

### 6.4 错误码段（54000-54099）

| 错误码 | 含义 | 触发场景 |
| --- | --- | --- |
| 54000 | 标注服务内部错误 | 未分类异常兜底 |
| 54001 | 标注记录不存在 | message/annotation/row id 无效 |
| 54002 | message_id 缺失或非法 | 内部调用参数校验 |
| 54003 | 标注状态不允许该操作 | 状态机守卫拒绝（§7.2） |
| 54004 | 无权访问该标注 | 非本人/非授权角色 |
| 54005 | 快速标注超时 | >200ms 预算，返回空结果降级（不告警） |
| 54006 | 深度标注任务入队失败 | MQ 不可用，调用方走重试队列 |
| 54007 | 深度标注超时 | soft_time_limit，状态 partial |
| 54008 | 深度标注重试耗尽 | max_retries 后 mark_failed |
| 54009 | NER 服务不可用 | 跳过 NER 阶段（D2） |
| 54010 | 向量检索超时 | 跳过 embedding/实体解析兜底（D3） |
| 54011 | Embedding 服务不可用 | 同上（D3） |
| 54012 | 知识点映射失败 | 实体无法解析（记 unresolved，非错误返回） |
| 54013 | 教材映射查询失败 | 引用降级跳过教材来源（D5） |
| 54014 | 题库引用查询失败 | 引用降级跳过题库来源（D7） |
| 54015 | LLM 辅助提取失败/限流 | 门控返回空（D4） |
| 54016 | 标注结果持久化失败 | 事务回滚，任务重试 |
| 54017 | Outbox 发布失败 | 补偿扫描器兑底（§8.4） |
| 54018 | 用户反馈参数非法 | action/reason 校验 |
| 54019 | 反馈超出修正窗口 | >30 天 |
| 54020 | 复核操作权限不足 | 非授权复核角色 |
| 54021 | 重跑与在途任务冲突 | R7 守卫 |
| 54022 | 覆盖度缓存重建失败 | 返回降级空集 |
| 54023 | 倒排索引写入失败 | 仅日志，不影响主流程 |

---

## 7. 标注状态机与版本管理

### 7.1 状态定义与流转

```
                 ┌───────────────┐  深度管线全部阶段成功
     pending ────┤               ├────────────→ completed
        │        └───────────────┘                  │ ▲
        │ 超时(≥1个kp)/部分降级 → partial            │ │复核approve/modify(R5)
        │ 重试耗尽/持久化失败 → failed               │ │
        │ avg_conf<0.55/否定≥2 ──→ review_required ──┘ │
        │                            │  reject全部 → 回 completed(旧版本,R6)
        └── completed → reprocess → pending(新版本,R7)
```

- `pending`：快速阶段已建记录，深度结果未回；
- `completed`：深度管线成功（或复核采纳）；
- `partial`：超时但至少映射出 1 个知识点（引用/推荐可能缺失）；
- `failed`：重试耗尽（quick 结果仍可供前端兜底展示）；
- `review_required`：待人工复核（升级态，不阻断前端展示当前版本）。

### 7.2 状态守卫表

| 守卫 | 起点 → 终点 | 条件 | 拒绝码 |
| --- | --- | --- | --- |
| G1 | pending → completed | 深度管线 Phase1-8 全部成功 | 54003 |
| G2 | pending → partial | soft_time_limit 且已映射 kp ≥1 | 54003 |
| G3 | pending → failed | 重试耗尽或持久化失败 | 54003 |
| G4 | completed/partial → review_required | avg_confidence<0.55 或否定反馈≥2 或举报关联 | 54003 |
| G5 | review_required → completed | 复核 approve/modify/reject（annotation_source=manual_review，version+1） | 54020 |
| G6 | completed → pending | 管理端 reprocess 且无在途任务（生成新版本） | 54021 |
| G7 | failed → pending | reprocess（唯一允许从 failed 重试的入口） | 54021 |
| G8 | 任意 → failed 不允许覆盖 completed/partial | 重跑失败时回退为旧版本终态并告警 | 54003 |

### 7.3 版本管理与 DDL 修订（v1.1）

ARPP 契约要求 message_id 唯一键 upsert，v1.0 DDL 缺唯一约束，本次补齐：

```sql
ALTER TABLE answer_annotations
    ADD UNIQUE KEY uk_message (message_id),          -- 幂等 upsert 基础
    ADD COLUMN reprocess_reason VARCHAR(200) NULL;   -- 重跑原因审计

CREATE TABLE annotation_revision_logs (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    annotation_id VARCHAR(36) NOT NULL,
    annotation_version INT NOT NULL COMMENT '该修订产生的版本号',
    change_source VARCHAR(20) NOT NULL COMMENT 'deep_run|user_feedback|manual_review|reprocess',
    operator_id VARCHAR(36) NOT NULL COMMENT '用户ID或管理员ID，system=自动',
    snapshot JSON NOT NULL COMMENT '本版本 points+references+recommendations 全量快照',
    change_note VARCHAR(500) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_ann_ver (annotation_id, annotation_version),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='标注版本修订日志：R6 回滚与审计依据';
```

快照写入时机：每次 version+1 的写路径（persist/feedback/review/reprocess）同事务插入对应版本快照；存储按《服务端数据归档与生命周期管理策略》180 天后转储。

---

## 8. 事件与下游扇出（Outbox）

### 8.1 annotation_outbox 表

```sql
CREATE TABLE annotation_outbox (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    event_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    aggregate_type VARCHAR(32) NOT NULL DEFAULT 'annotation',
    aggregate_id VARCHAR(36) NOT NULL,
    payload JSON NOT NULL,
    trace_id VARCHAR(64) NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING|PUBLISHED|DEAD',
    retry_count INT NOT NULL DEFAULT 0,
    next_retry_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    published_at DATETIME(3) NULL,
    UNIQUE KEY uk_event_id (event_id),
    INDEX idx_status_next (status, next_retry_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 8.2 事件定义（Topic：`annotation.domain.events`，与 royalty/cs/tr 命名对齐）

| event_type | 时机 | payload 关键字段 |
| --- | --- | --- |
| annotation.quick.completed | 快速标注返回后（对话引擎主链路） | message_id, user_id, kp_codes[] |
| annotation.deep.completed | Phase7 事务提交 | annotation_id, message_id, user_id, annotation_version, kp_ids[], kp_count, ref_count, rec_count, avg_confidence |
| annotation.deep.partial | mark_partial | annotation_id, message_id, kp_count |
| annotation.deep.failed | mark_failed | annotation_id, message_id, error |
| annotation.updated | 反馈/复核/重跑 version+1 后 | annotation_id, message_id, annotation_version, change_source, kp_ids[] |
| annotation.review.required | 升级复核（R3） | annotation_id, subject_code, reason, sample_message_id |

信封格式与《消息队列与事件驱动架构》统一：`{event_id, event_type, occurred_at, producer:"annotation-svc", trace_id, payload}`。

### 8.3 消费方与幂等

| 消费方 | 订阅事件 | 消费动作 | 幂等键 |
| --- | --- | --- | --- |
| AI辅导对话知识点掌握度实时更新与能力维度同步引擎 | deep.completed / annotation.updated | 复用 KPAnnotation 更新掌握度 | (event_id) 或 (annotation_id, version) |
| 学习记录与进度追踪服务 | deep.completed | 知识曝光写入学习流水 | (user_id, message_id, kp_id) |
| 学情分析与用户画像 / 学生画像特征工程平台 | deep.completed / annotation.updated | 触发覆盖度重建、隐式兴趣信号 | (user_id, subject, date) 粒度去重 |
| 学习内容推荐排序融合层 | deep.completed | recommendations 进候选池 & 曝光登记 | (rec_id) |
| AI对话质量抽样审核工作台 | review.required | 进人工复核样本池 | (annotation_id) |
| 教育学科术语词典 | 未解析实体（非事件，周聚合任务拉表） | 术语候选评审扩充 | (entity_text, subject_code) |

消费幂等统一按《消息队列》§5 幂等表 + Redis SETNX 双层实现。

### 8.4 发布器与补偿

独立线程 500ms 批量拉 PENDING（≤200 条/批）发 Kafka；失败指数退避（1s/2m/10m/1h，5 次后置 DEAD 并告警）。日终对账任务扫描：`created_at < NOW()-5min AND status='PENDING'` 积压 >1000 告警（54017 兑底）。

---

## 9. SSE knowledge_ref 补推协议

对齐《AI回答后处理与智能优化管线》§3.8 的 `knowledge_ref` 事件（连接仍在时补推；quick 阶段同事件名，`phase` 字段区分）：

```json
{
  "event": "knowledge_ref",
  "data": {
    "messageId": "msg_9f2c",
    "annotationId": "ann_71b0",
    "annotationVersion": 2,
    "phase": "quick | deep",
    "knowledgePoints": [
      {"kpId": "kp_1001", "name": "一元二次方程求根公式", "code": "MATH-G8-ALG-QE-02",
       "mentionType": "explicit", "confidence": 0.92,
       "chapterPath": "第2章 > 2.2 一元二次方程"}
    ],
    "references": [
      {"refType": "textbook", "title": "人教版数学八年级下 · 2.2", "pageNumber": 32,
       "jumpUrl": "primetop://reader/chapter/ch_88?anchor=kp_1001"}
    ]
  }
}
```

**客户端幂等契约**：以 (messageId, annotationVersion) 为准——收到低于已渲染版本的事件直接丢弃；quick(∅版本) → deep(v2) → 复核 updated(v3) 依次替换渲染。断线错过补推的兜底：重连后客户端主动 `GET /annotations/messages/{id}` 拉全量。渲染交互（芯片点击/跳转/反馈入口）由《富文本与学科内容渲染引擎》与客户端组件层实现，本系统只保证数据契约。

---

## 10. 错误处理与降级矩阵

| 编号 | 故障 | 影响 | 降级动作 | 用户感知 |
| --- | --- | --- | --- | --- |
| D1 | 快速标注超预算(>200ms) | 无即时芯片 | 直接返回空 quick 结果，仍入深度队列 | 芯片晚几秒出现 |
| D2 | NER 服务不可用 | 缺 ner 来源 | 跳过 Phase1，仅 RAG+关键词+向量 | 标注数量可能变少 |
| D3 | Embedding/向量库超时 | 缺语义来源/实体兜底 | 跳过相应路径；实体解析仅词典 | 同上 |
| D4 | LLM 辅助失败/限流 | 无 LLM 解析 | 返回空（默认本就关闭） | 无感 |
| D5 | 教材映射查询失败 | 缺教材引用 | 该来源跳过，其他来源照常 | 引用少一条 |
| D6 | 课标库读失败 | 缺考点引用 | 跳过（对方文档已约定降级） | 无感 |
| D7 | 题库查询失败 | 缺例题引用 | 跳过 | 无感 |
| D8 | 掌握度/复习队列缓存失败 | 缺前置补弱/复习提醒推荐 | 对应推荐类型不生成 | 无感 |
| D9 | 推荐依赖全部失败 | 无推荐 | 返回空列表，标注主流程不受影响 | 无感 |
| D10 | Redis 写失败 | 缓存/倒排/覆盖度缺失 | 仅记日志，落库为准；覆盖度下次读时重建 | 无感 |
| D11 | DB 主库写失败 | 持久化失败 | 任务重试（max_retries=2），仍失败 mark_failed，quick 结果兜底展示 | 芯片显示但无引用/推荐 |
| D12 | Outbox 发布失败 | 下游无事件 | 补偿扫描器重发（§8.4） | 掌握度更新延迟 |

核心原则：**标注链路任何子依赖故障都不阻塞 AI 回答主链路**（quick 在对话引擎预算内，超预算即放奔）；深度链路宁可 partial 不可丢消息。

---

## 11. 监控与告警

### 11.1 指标

| 指标 | 类型 | 目标/阈值 |
| --- | --- | --- |
| annotation_quick_duration_ms | Histogram (P99) | <200ms；>250ms 持续 5min 告警 |
| annotation_deep_pipeline_duration_ms | Histogram 分 phase（ner/embedding/map/ref/rec/persist） | P99 < 15s |
| annotation_deep_queue_lag | Gauge（Celery 队列积压） | >5000 或消费延迟>5min 告警（P1） |
| annotation_coverage_rate | 日比：deep 终态消息 / AI 消息总量 | >95%；<90% 连续 2 日告警 |
| annotation_avg_confidence_psi | 日度置信度分布 PSI | PSI>0.2 告警（NER/词库/模型变更信号） |
| annotation_reject_rate | 否定反馈 / 总反馈 | >5% 告警（标注质量回归） |
| annotation_ref_ctr | 引用点击率分 ref_type | 看板观测（无告警） |
| annotation_unresolved_ratio | 未解析实体 / NER 实体总量 | 周看板；>15% 触发音序词典补录评审 |
| annotation_outbox_backlog | Gauge | >1000 告警（54017） |
| annotation_knowledge_ref_push_fail | Counter | 看板（客户端有拉取兜底） |

### 11.2 容量估算（DAU 50 万基线）

- AI 消息 ~200 万/日 → quick 全量 + deep 全量（拍题/作文场景可配仅 quick）；
- deep 峰值 ~150 QPS 入队，NER 批推理（batch=8）4 实例可支撑；embedding 复用 RAG 基础设施不单独估；
- 存储：annotation 主子表 ~200 万 × 23 行 ≈ 4600 万行/日增量 → 按归档策略 180 天热存 + ClickHouse 冷存；unresolved_entities ~5 万行/日；
- Redis：快照 200 万 key × ~4KB ≈ 8GB（24h TTL 稳态滚动）。

---

## 12. 安全与合规设计

1. **版权红线**：textbook/knowledge_doc 引用仅存元数据 + ≤50 字摘要 + 页码定位，不落正文全文；跳转由内容服务实时鉴权（会员权益决策引擎二次校验）。external_resource 引用 P2 开启，仅允许安全过滤 URL 白名单域名。
2. **最小化存储**：text_segment 仅存命中片段（≤100 字），回答全文不重复存储（对话引擎已有 message 表）；payload 不含 PII。
3. **未成年人保护**：标注数据不用于广告/营销定向（仅学习域消费）；覆盖度等画像数据对家长端可见度遵守家庭共享可见度分级策略。
4. **越权防护**：所有学生端接口校验资源归属（annotation.user_id == token user_id，54004）；管理端复核需角色权限（54020）。
5. **注入防御**：LLM 辅助解析的实体列表仅作词典编码匹配，不拼入任何 Prompt 自由文本段；候选编码列表来自服务端配置。
6. **审计**：复核/重跑/反馈全量落 revision_logs（operator_id + 快照），满足内容可追溯要求。
7. **AIGC 溯源**：引用芯片与《AIGC 内容标识与生成内容溯源水印系统》联动，AI 回答本体已带标识，本系统补充知识点级溯源锚点。
8. **模型数据合规**：review_required 样本与否定反馈回流 RLHF/术语词典前需经匿名化管线去标识。

---

## 13. 与关联文档契约对齐

| 关联文档 | 契约点 | 对方章节 |
| --- | --- | --- |
| AI回答后处理与智能优化管线 | annotate_deep 同步门面（text/subject_id/stage/textbook_version/max_kps/min_confidence/candidate_kps）；knowledge_ref SSE；pipeline.tagging.retry；message_id upsert 幂等 | §3.8 |
| AI辅导对话知识点掌握度实时更新与能力维度同步引擎 | annotation.deep.completed/updated 事件 → KPAnnotation{knowledgePointId, relevanceScore=confidence, annotationSource:AUTO\|MANUAL} | §1.4/§525 |
| 知识点体系与教材映射引擎 | get_textbook_mapping(kp_id, textbook_id)/get_by_keyword_id/get_prerequisites/get_siblings | 本文 §3.2/§3.3 |
| 课程标准数据库与课标条目结构化管理服务 | exam_point_ids 读 items（读失败降级跳过课标对齐） | 对方 §1129 双向约定 |
| RAG 检索增强生成系统 | rag_context.knowledge_point_ids 复用；共享向量库 collection=knowledge_points | 本文 §3.2/§3.3 |
| 题目与题库服务 | find_representative/find_similar 引用与推荐查询 | §3.3 Phase5/6 |
| 富文本与学科内容渲染引擎 | knowledge_ref 渲染契约（芯片/跳转/反馈入口/分龄文案） | §9 |
| 学习记录与进度追踪服务 | deep.completed → 知识曝光流水 | §8.3 |
| 学生画像特征工程平台 / 学情分析 | 覆盖度 gRPC BatchCoverage；隐式反馈信号 | §6.2.2/§8.3 |
| 间隔重复算法与遗忘曲线复习调度引擎 | review_queue.due_within 复习提醒推荐 | §3.3 Phase6 |
| 教育学科术语词典与智能词汇表自动构建管理引擎 | 未解析实体周聚合回流术语候选；term_dict.lookup 别名解析 | 对方 §1688 |
| AI对话质量抽样审核与标注工作台服务 | review.required 样本推送 | §8.3 |
| 服务端数据归档与生命周期管理策略 | 主子表/revision_logs/outbox 180 天归档 ClickHouse | §7.3/§11.2 |

---

## 14. 验收场景

1. AI 回答流式结束后 200ms 内前端收到 quick 芯片（RAG 命中场景）；
2. deep 完成后 SSE 收到 phase=deep 的 knowledge_ref，版本高于 quick，芯片刷新且引用/推荐出现；
3. RAG 与关键词均未命中、NER 命中“配方法”实体：经术语词典解析成功，confidence 含 +0.15 加分；
4. NER 实体无法解析：写入 annotation_unresolved_entities，标注不失败；
5. 高中物理回答含超纲大学概念且为 explicit：降权保留（conf×0.7）；非 explicit 超纲：被剔除；
6. 幼儿段回答：知识点 ≤2、无题库引用、推荐仅 related_knowledge；
7. 前置知识展开：映射 Top3 的一层前置出现在结果中且 mention_type=prerequisite、conf=weight×0.8；
8. 教材映射超时：该来源引用缺失，其余来源正常，指标 annotation.ref.textbook.degraded +1；
9. deep 任务 soft_time_limit：状态=partial，partial 事件发出，quick 结果仍展示；
10. 重试耗尽：状态=failed，failed 事件发出，告警不触发（低于覆盖率阈值时）；
11. 用户 reject 同一标注的 2 个知识点：状态→review_required，review.required 事件，样本进审核工作台；
12. 管理员 modify 复核：version+1，annotation_source=manual_review，SSE 重推 v+1，掌握度引擎消费 annotation.updated；
13. 31 天前的标注提交反馈：返回 54019；
14. reprocess 与在途任务冲突：返回 54021；无冲突时新版本生成且 revision_logs 快照可回溯；
15. ARPP 超时转 pipeline.tagging.retry 重发：Idempotency-Key=message_id 命中，不产生重复版本；
16. 非本人访问倒排接口：54004；复核接口无权限：54020；
17. 日终对账发现 outbox 积压 1500 条：告警触发，补偿扫描器在下一周期内清空；
18. 覆盖度缓存 miss：同步重建 <500ms；重建失败返回空集 + degraded:true（非 5xx）。

---

## 15. 修订记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v1.0 | 2026-08-13 | 初版：模块概述/数据结构/快速与深度标注前半 |
| v1.1 | 2026-08-16 | 补全烂尾：原文件截断于 §3.3 _merge_all_sources 尾部。本次补齐 Phase4-8（知识体系映射含实体解析/学段过滤/前置展开、溯源引用四来源、规则式推荐四类、Outbox 同事务持久化、缓存三件套）、双入口模式（ARPP 同步门面/Celery）、LLM 辅助成本门控、§4 分龄粒度表、§5 反馈-复核-重跑修正闭环、§6 API+54000-54099、§7 状态机守卫 G1-G8+uk_message DDL 修订+revision_logs、§8 Outbox 六事件与六消费方、§9 SSE 幂等协议、§10 降级矩阵 D1-D12、§11 监控容量、§12 合规 8 条、§13 契约 13 项、§14 验收 18 条 |