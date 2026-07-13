# RAG 检索增强生成系统 - 详细设计

> 细化日期：2026-07-03
> 原始文档：`docs/design/启硕-PrimeTop-全学段AI辅助学习软件项目设计文档.md` §8.5.2 RAG 检索增强生成

## 1. 模块概述

RAG (Retrieval-Augmented Generation) 检索增强生成系统是 PrimeTop AI 辅导的核心基础设施，负责将用户问题与教材知识库、题库、知识点、考点等内容进行智能检索，将检索结果作为上下文输入大模型，确保 AI 回答贴合教材课标、准确可靠。

### 1.1 核心职责

| 职责 | 说明 |
|------|------|
| 知识库管理 | 维护教材、知识点、考点、题库解析等结构化内容 |
| 向量化存储 | 将文本内容转换为向量表示并存储到向量数据库 |
| 语义检索 | 基于用户问题进行语义相似度检索 |
| 多路召回 | 同时从多个数据源（知识库、题库、历史对话）召回相关内容 |
| 结果重排序 | 对检索结果进行相关性和质量评分，选择最优内容 |
| 上下文构建 | 将检索结果组织成结构化的 Prompt 上下文 |
| 引用溯源 | 在 AI 回答中标记内容来源，支持用户查看原文 |
| 质量监控 | 监控检索质量，反馈优化检索策略 |

### 1.2 与其他模块的关系

```
RAG 检索增强生成系统
    ├──→ AI 对话服务（提供检索上下文）
    ├──→ 拍照搜题服务（提供题目解析和类似题）
    ├──→ 同步课堂服务（提供章节知识讲解）
    ├──→ 理科解题服务（提供解题方法和例题）
    ├──→ 作文辅导服务（提供写作素材和范文）
    └→ 文科背诵服务（提供知识点总结和背诵材料）
```

---

## 2. 数据结构设计

### 2.1 核心实体定义

#### 2.1.1 知识库文档表 (knowledge_documents)

```sql
CREATE TABLE knowledge_documents (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '文档ID',
    doc_type ENUM('textbook_chapter', 'knowledge_point', 'exam_point', 'question_analysis', 'method_summary', 'common_mistake', 'example') NOT NULL COMMENT '文档类型',
    doc_source VARCHAR(50) DEFAULT NULL COMMENT '来源标识（如：textbook_rj_math_ch1_1）',

    -- 分类字段
    subject_id INT UNSIGNED NOT NULL COMMENT '学科ID',
    grade_id SMALLINT UNSIGNED NOT NULL COMMENT '年级ID',
    textbook_id INT UNSIGNED DEFAULT NULL COMMENT '教材版本ID',
    chapter_id INT UNSIGNED DEFAULT NULL COMMENT '章节ID',
    knowledge_point_id INT UNSIGNED DEFAULT NULL COMMENT '知识点ID',

    -- 内容字段
    title VARCHAR(255) NOT NULL COMMENT '文档标题',
    content TEXT NOT NULL COMMENT '文档内容（Markdown格式）',
    content_html TEXT DEFAULT NULL COMMENT '渲染后的HTML',
    summary TEXT DEFAULT NULL COMMENT '文档摘要',
    tags JSON DEFAULT NULL COMMENT '标签列表',
    keywords JSON DEFAULT NULL COMMENT '关键词列表',

    -- 向量相关
    embedding_model VARCHAR(50) DEFAULT 'text-embedding-3-small' COMMENT '嵌入模型',
    embedding_dim INT UNSIGNED DEFAULT 1536 COMMENT '向量维度',
    embedding_updated_at DATETIME DEFAULT NULL COMMENT '向量更新时间',

    -- 质量指标
    quality_score DECIMAL(3,2) DEFAULT 0.80 COMMENT '质量评分（0.00-1.00）',
    relevance_feedback_count INT UNSIGNED DEFAULT 0 COMMENT '相关反馈次数',
    relevance_feedback_positive INT UNSIGNED DEFAULT 0 COMMENT '正面反馈次数',

    -- 使用统计
    retrieval_count INT UNSIGNED DEFAULT 0 COMMENT '被检索次数',
    click_count INT UNSIGNED DEFAULT 0 COMMENT '被点击查看次数',
    last_retrieved_at DATETIME DEFAULT NULL COMMENT '最后检索时间',

    -- 状态与时间
    status ENUM('draft', 'published', 'deprecated') NOT NULL DEFAULT 'draft' COMMENT '状态',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    PRIMARY KEY (id),
    KEY idx_doc_type (doc_type),
    KEY idx_subject_grade (subject_id, grade_id),
    KEY idx_textbook_chapter (textbook_id, chapter_id),
    KEY idx_knowledge_point (knowledge_point_id),
    KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识库文档表';
```

#### 2.1.2 向量索引表 (vector_index)

使用 Milvus 或 pgvector 管理向量索引，以下为概念定义：

```sql
-- Milvus Collection 定义（伪代码）
{
    "collection_name": "knowledge_vectors",
    "dimension": 1536,
    "metric_type": "COSINE",
    "fields": [
        {"name": "id", "type": "INT64", "is_primary": true},
        {"name": "doc_id", "type": "INT64"},
        {"name": "chunk_id", "type": "INT64"},
        {"name": "embedding", "type": "FLOAT_VECTOR", "dim": 1536},
        {"name": "subject_id", "type": "INT64"},
        {"name": "grade_id", "type": "INT64"},
        {"name": "chapter_id", "type": "INT64"},
        {"name": "chunk_index", "type": "INT64"},
        {"name": "chunk_text", "type": "VARCHAR", "max_length": 1000}
    ],
    "indexes": [
        {
            "type": "IVF_FLAT",
            "metric_type": "COSINE",
            "params": {"nlist": 1024}
        }
    ]
}
```

#### 2.1.3 文档分块表 (document_chunks)

```sql
CREATE TABLE document_chunks (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '分块ID',
    doc_id BIGINT UNSIGNED NOT NULL COMMENT '文档ID（关联 knowledge_documents）',
    chunk_index INT UNSIGNED NOT NULL COMMENT '分块序号（从0开始）',
    chunk_text TEXT NOT NULL COMMENT '分块文本内容',
    chunk_length INT UNSIGNED NOT NULL COMMENT '分块长度（字符数）',
    is_boundary BOOLEAN DEFAULT FALSE COMMENT '是否为边界分块（如章节标题）',

    -- 语义位置
    position_in_doc DECIMAL(5,2) DEFAULT NULL COMMENT '在文档中的位置（0.00-1.00）',

    -- 质量指标
    quality_score DECIMAL(3,2) DEFAULT 0.80 COMMENT '分块质量评分',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    PRIMARY KEY (id),
    UNIQUE KEY uk_doc_chunk (doc_id, chunk_index),
    KEY idx_doc_id (doc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档分块表';
```

#### 2.1.4 检索日志表 (retrieval_logs)

```sql
CREATE TABLE retrieval_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '日志ID',
    session_id VARCHAR(64) DEFAULT NULL COMMENT '会话ID',
    user_id BIGINT UNSIGNED DEFAULT NULL COMMENT '用户ID',

    -- 查询信息
    query_text TEXT NOT NULL COMMENT '用户查询文本',
    query_vector JSON DEFAULT NULL COMMENT '查询向量（可选，用于分析）',
    query_intent ENUM('question', 'concept', 'method', 'example', 'review') DEFAULT NULL COMMENT '查询意图',

    -- 上下文信息
    subject_id INT UNSIGNED DEFAULT NULL COMMENT '学科ID',
    grade_id SMALLINT UNSIGNED DEFAULT NULL COMMENT '年级ID',
    textbook_id INT UNSIGNED DEFAULT NULL COMMENT '教材版本ID',
    conversation_context TEXT DEFAULT NULL COMMENT '对话上下文摘要',

    -- 检索参数
    top_k INT UNSIGNED DEFAULT 10 COMMENT '召回数量',
    score_threshold DECIMAL(3,2) DEFAULT 0.70 COMMENT '相似度阈值',
    retrieval_sources JSON DEFAULT NULL COMMENT '检索源配置',

    -- 检索结果
    retrieved_doc_ids JSON DEFAULT NULL COMMENT '检索到的文档ID列表',
    retrieved_scores JSON DEFAULT NULL COMMENT '对应的相似度分数',
    retrieval_latency_ms INT UNSIGNED DEFAULT NULL COMMENT '检索耗时（毫秒）',

    -- 质量反馈
    user_feedback ENUM('helpful', 'not_helpful', 'inaccurate', NULL) DEFAULT NULL COMMENT '用户反馈',
    feedback_at DATETIME DEFAULT NULL COMMENT '反馈时间',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    PRIMARY KEY (id),
    KEY idx_session_id (session_id),
    KEY idx_user_id (user_id),
    KEY idx_created_at (created_at),
    KEY idx_query_intent (query_intent)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='检索日志表';
```

#### 2.1.5 检索结果反馈表 (retrieval_feedback)

```sql
CREATE TABLE retrieval_feedback (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '反馈ID',
    log_id BIGINT UNSIGNED NOT NULL COMMENT '检索日志ID',
    doc_id BIGINT UNSIGNED NOT NULL COMMENT '文档ID',
    chunk_id BIGINT UNSIGNED DEFAULT NULL COMMENT '分块ID',

    -- 反馈信息
    is_helpful BOOLEAN NOT NULL COMMENT '是否有帮助',
    relevance_score INT UNSIGNED DEFAULT NULL COMMENT '相关性评分（1-5）',
    feedback_text TEXT DEFAULT NULL COMMENT '反馈文本',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    PRIMARY KEY (id),
    KEY idx_log_id (log_id),
    KEY idx_doc_id (doc_id),
    KEY idx_is_helpful (is_helpful)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='检索结果反馈表';
```

---

## 3. API 接口设计

**基础路径：** `/api/v1/rag`

### 3.1 语义检索接口

```
POST /api/v1/rag/retrieve
```

**请求体：**

```json
{
  "query": "什么是平行四边形的判定定理？",
  "context": {
    "subject_id": 1,
    "grade_id": 8,
    "textbook_id": 1,
    "chapter_id": 10
  },
  "retrieval_config": {
    "top_k": 10,
    "score_threshold": 0.70,
    "sources": ["textbook", "knowledge_point", "question_analysis"]
  },
  "conversation_history": [
    {
      "role": "user",
      "content": "我在学习几何图形"
    }
  ]
}
```

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "query_id": "req_1234567890",
    "retrieval_id": "rag_9876543210",
    "results": [
      {
        "doc_id": 1001,
        "doc_type": "textbook_chapter",
        "title": "平行四边形的判定",
        "content": "平行四边形的判定定理：两组对边分别平行的四边形是平行四边形...",
        "chunk_id": 501,
        "chunk_text": "平行四边形的判定定理：两组对边分别平行的四边形是平行四边形...",
        "score": 0.92,
        "source": "textbook",
        "metadata": {
          "subject_id": 1,
          "grade_id": 8,
          "chapter_id": 10,
          "knowledge_point_ids": [101, 102]
        }
      },
      {
        "doc_id": 2005,
        "doc_type": "knowledge_point",
        "title": "平行四边形判定方法",
        "content": "判定平行四边形的四种方法：① 两组对边分别平行...",
        "chunk_id": 1005,
        "chunk_text": "判定平行四边形的四种方法：① 两组对边分别平行...",
        "score": 0.88,
        "source": "knowledge_point",
        "metadata": {
          "subject_id": 1,
          "grade_id": 8,
          "knowledge_point_ids": [101]
        }
      }
    ],
    "stats": {
      "total_retrieved": 10,
      "above_threshold": 8,
      "retrieval_time_ms": 45,
      "sources_used": ["textbook", "knowledge_point"]
    }
  }
}
```

### 3.2 批量向量化接口

```
POST /api/v1/rag/embeddings/batch
```

**请求体：**

```json
{
  "documents": [
    {
      "doc_id": 1001,
      "text": "平行四边形的判定定理：两组对边分别平行的四边形是平行四边形",
      "metadata": {
        "subject_id": 1,
        "grade_id": 8,
        "chapter_id": 10
      }
    }
  ],
  "model": "text-embedding-3-small",
  "chunk_config": {
    "chunk_size": 500,
    "chunk_overlap": 50
  }
}
```

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "batch_id": "batch_1234567890",
    "total_chunks": 25,
    "processed": 25,
    "failed": 0,
    "embedding_model": "text-embedding-3-small",
    "embedding_dim": 1536
  }
}
```

### 3.3 检索结果反馈接口

```
POST /api/v1/rag/feedback
```

**请求体：**

```json
{
  "retrieval_id": "rag_9876543210",
  "doc_id": 1001,
  "chunk_id": 501,
  "is_helpful": true,
  "relevance_score": 5,
  "feedback_text": "这个解答很清楚"
}
```

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "feedback_id": 12345
  }
}
```

### 3.4 上下文构建接口

```
POST /api/v1/rag/context/build
```

**请求体：**

```json
{
  "query": "什么是平行四边形的判定定理？",
  "retrieval_results": [
    {
      "doc_id": 1001,
      "title": "平行四边形的判定",
      "content": "平行四边形的判定定理：两组对边分别平行的四边形是平行四边形...",
      "score": 0.92,
      "metadata": {
        "source": "textbook",
        "chapter": "第10章 平行四边形"
      }
    }
  ],
  "context_template": "student_math"
}
```

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "context": "【教材参考】平行四边形的判定（第10章 平行四边形）\n\n平行四边形的判定定理：两组对边分别平行的四边形是平行四边形...",
    "context_tokens": 150,
    "sources": [
      {
        "doc_id": 1001,
        "title": "平行四边形的判定",
        "source": "textbook"
      }
    ]
  }
}
```

---

## 4. 核心业务逻辑

### 4.1 RAG 检索流程

```
用户提问
    │
    ▼
[1] 查询预处理
    ├── 提取查询文本
    ├── 识别查询意图（问题/概念/方法/例题/复习）
    ├── 提取上下文信息（学科、年级、章节）
    └── 查询扩展（同义词、相关词）
    │
    ▼
[2] 多路召回
    ├── 向量检索（语义相似度）
    ├── 关键词检索（BM25）
    ├── 知识图谱检索（关系路径）
    └── 历史对话检索（上下文延续）
    │
    ▼
[3] 结果融合与重排序
    ├── 合并多路召回结果
    ├── 去重（相同文档的不同分块）
    ├── 相关性评分（综合向量分数、关键词匹配、上下文匹配）
    ├── 质量评分（文档质量、时效性、权威性）
    └── 多样性保证（避免单一来源）
    │
    ▼
[4] 上下文构建
    ├── 选择 Top-N 结果
    ├── 组装 Prompt 模板
    ├── 插入引用标记
    └── 控制 Token 数量
    │
    ▼
[5] 返回检索结果
    ├── 检索结果列表
    ├── 构建的上下文
    └── 元数据（检索时间、来源统计）
```

### 4.2 查询预处理

```python
class QueryPreprocessor:
    def __init__(self, embedding_model, nlp_model):
        self.embedding_model = embedding_model
        self.nlp_model = nlp_model

    def preprocess(self, query, context):
        """
        预处理用户查询
        """
        # 1. 提取和清洗文本
        cleaned_text = self._clean_text(query)

        # 2. 识别查询意图
        intent = self._classify_intent(cleaned_text)

        # 3. 提取关键信息
        keywords = self._extract_keywords(cleaned_text)

        # 4. 生成查询向量
        query_vector = self.embedding_model.encode(cleaned_text)

        # 5. 查询扩展
        expanded_queries = self._expand_query(cleaned_text, context)

        return {
            "query": cleaned_text,
            "query_vector": query_vector,
            "intent": intent,
            "keywords": keywords,
            "expanded_queries": expanded_queries,
            "context": context
        }

    def _clean_text(self, text):
        """文本清洗"""
        # 移除特殊字符、多余空格
        text = re.sub(r'[^\w\s，。、？！；：""''（）]', ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text

    def _classify_intent(self, query):
        """分类查询意图"""
        # 使用规则或模型分类
        if '什么是' in query or '定义' in query:
            return 'concept'
        elif '怎么做' in query or '如何' in query:
            return 'method'
        elif '例题' in query or '练习' in query:
            return 'example'
        elif '复习' in query or '总结' in query:
            return 'review'
        else:
            return 'question'

    def _extract_keywords(self, query):
        """提取关键词"""
        # 使用 NLP 模型提取关键词
        doc = self.nlp_model(query)
        keywords = [token.text for token in doc if token.pos_ in ['NOUN', 'VERB']]
        return keywords

    def _expand_query(self, query, context):
        """查询扩展"""
        expanded = []

        # 同义词扩展
        synonyms = self._get_synonyms(query)
        expanded.extend(synonyms)

        # 上下文相关扩展
        if context and context.get('chapter_id'):
            chapter_keywords = self._get_chapter_keywords(context['chapter_id'])
            expanded.extend(chapter_keywords)

        return expanded
```

### 4.3 向量检索实现

```python
class VectorRetriever:
    def __init__(self, milvus_client):
        self.milvus_client = milvus_client

    def retrieve(self, query_vector, context, top_k=10, threshold=0.70):
        """
        向量检索
        """
        # 1. 构建过滤条件
        filter_expr = self._build_filter(context)

        # 2. 执行向量搜索
        search_params = {
            "metric_type": "COSINE",
            "params": {"nprobe": 10}
        }

        results = self.milvus_client.search(
            collection_name="knowledge_vectors",
            data=[query_vector],
            anns_field="embedding",
            param=search_params,
            limit=top_k * 2,  # 召回更多，后续筛选
            expr=filter_expr,
            output_fields=[
                "doc_id", "chunk_id", "subject_id", "grade_id",
                "chapter_id", "chunk_text", "chunk_index"
            ]
        )

        # 3. 过滤低相似度结果
        filtered_results = [
            {
                "doc_id": result['entity']['doc_id'],
                "chunk_id": result['entity']['chunk_id'],
                "chunk_text": result['entity']['chunk_text'],
                "score": result['distance'],
                "metadata": {
                    "subject_id": result['entity']['subject_id'],
                    "grade_id": result['entity']['grade_id'],
                    "chapter_id": result['entity']['chapter_id'],
                    "chunk_index": result['entity']['chunk_index']
                }
            }
            for result in results[0]
            if result['distance'] >= threshold
        ]

        # 4. 按文档分组，避免同一文档多个分块
        grouped_results = self._group_by_document(filtered_results)

        return grouped_results[:top_k]

    def _build_filter(self, context):
        """构建过滤条件"""
        conditions = []

        if context and context.get('subject_id'):
            conditions.append(f"subject_id == {context['subject_id']}")

        if context and context.get('grade_id'):
            conditions.append(f"grade_id == {context['grade_id']}")

        if context and context.get('chapter_id'):
            conditions.append(f"chapter_id == {context['chapter_id']}")

        return " && ".join(conditions) if conditions else ""

    def _group_by_document(self, results):
        """按文档分组，取每个文档的最佳分块"""
        from collections import defaultdict

        doc_groups = defaultdict(list)
        for result in results:
            doc_groups[result['doc_id']].append(result)

        # 每个文档取分数最高的分块
        best_chunks = []
        for doc_id, chunks in doc_groups.items():
            best = max(chunks, key=lambda x: x['score'])
            best_chunks.append(best)

        # 按分数排序
        best_chunks.sort(key=lambda x: x['score'], reverse=True)

        return best_chunks
```

### 4.4 结果融合与重排序

```python
class ResultReranker:
    def __init__(self, lambda_vec=0.6, lambda_kw=0.3, lambda_ctx=0.1):
        self.lambda_vec = lambda_vec  # 向量相似度权重
        self.lambda_kw = lambda_kw    # 关键词匹配权重
        self.lambda_ctx = lambda_ctx  # 上下文匹配权重

    def rerank(self, vector_results, keyword_results, context, query):
        """
        融合并重排序结果
        """
        # 1. 合并结果
        all_results = self._merge_results(vector_results, keyword_results)

        # 2. 计算综合分数
        for result in all_results:
            score = self._calculate_composite_score(
                result, vector_results, keyword_results, context, query
            )
            result['composite_score'] = score

        # 3. 排序
        all_results.sort(key=lambda x: x['composite_score'], reverse=True)

        # 4. 多样性保证
        diversified_results = self._diversify_results(all_results)

        return diversified_results

    def _merge_results(self, vector_results, keyword_results):
        """合并向量检索和关键词检索结果"""
        merged = {}

        # 添加向量检索结果
        for result in vector_results:
            doc_id = result['doc_id']
            merged[doc_id] = result.copy()
            merged[doc_id]['vector_score'] = result['score']
            merged[doc_id]['keyword_score'] = 0.0

        # 合并关键词检索结果
        for result in keyword_results:
            doc_id = result['doc_id']
            if doc_id in merged:
                merged[doc_id]['keyword_score'] = result['score']
            else:
                merged[doc_id] = result.copy()
                merged[doc_id]['vector_score'] = 0.0
                merged[doc_id]['keyword_score'] = result['score']

        return list(merged.values())

    def _calculate_composite_score(self, result, vector_results, keyword_results, context, query):
        """计算综合分数"""
        # 归一化分数
        vector_score = self._normalize(result['vector_score'])
        keyword_score = self._normalize(result['keyword_score'])

        # 上下文匹配分数
        context_score = self._calculate_context_score(result, context)

        # 质量分数
        quality_score = result.get('quality_score', 0.8)

        # 加权综合
        composite = (
            self.lambda_vec * vector_score +
            self.lambda_kw * keyword_score +
            self.lambda_ctx * context_score
        ) * quality_score

        return composite

    def _normalize(self, score, min_score=0.0, max_score=1.0):
        """归一化分数到 [0, 1]"""
        return (score - min_score) / (max_score - min_score) if max_score > min_score else 0.5

    def _calculate_context_score(self, result, context):
        """计算上下文匹配分数"""
        if not context:
            return 1.0

        score = 1.0

        # 学科匹配
        if context.get('subject_id') and result['metadata'].get('subject_id'):
            if result['metadata']['subject_id'] == context['subject_id']:
                score *= 1.0
            else:
                score *= 0.7

        # 年级匹配
        if context.get('grade_id') and result['metadata'].get('grade_id'):
            grade_diff = abs(result['metadata']['grade_id'] - context['grade_id'])
            if grade_diff == 0:
                score *= 1.0
            elif grade_diff <= 1:
                score *= 0.9
            else:
                score *= 0.7

        # 章节匹配
        if context.get('chapter_id') and result['metadata'].get('chapter_id'):
            if result['metadata']['chapter_id'] == context['chapter_id']:
                score *= 1.0
            else:
                score *= 0.8

        return score

    def _diversify_results(self, results, diversity_threshold=0.1):
        """多样性保证，避免相似内容过多"""
        diversified = []

        for result in results:
            # 检查与已选结果的相似度
            is_diverse = True
            for selected in diversified:
                similarity = self._calculate_similarity(result, selected)
                if similarity > diversity_threshold:
                    is_diverse = False
                    break

            if is_diverse:
                diversified.append(result)

        return diversified

    def _calculate_similarity(self, result1, result2):
        """计算两个结果的相似度"""
        # 基于文档类型、章节、知识点的相似度
        similarity = 0.0

        if result1['doc_type'] == result2['doc_type']:
            similarity += 0.3

        if result1['metadata'].get('chapter_id') == result2['metadata'].get('chapter_id'):
            similarity += 0.4

        kp1 = set(result1['metadata'].get('knowledge_point_ids', []))
        kp2 = set(result2['metadata'].get('knowledge_point_ids', []))
        if kp1 and kp2:
            jaccard = len(kp1 & kp2) / len(kp1 | kp2)
            similarity += 0.3 * jaccard

        return similarity
```

### 4.5 上下文构建

```python
class ContextBuilder:
    def __init__(self, template_manager):
        self.template_manager = template_manager

    def build(self, query, retrieval_results, context):
        """
        构建用于 LLM 的上下文
        """
        # 1. 选择模板
        template = self._select_template(context)

        # 2. 选择和排序检索结果
        selected_results = self._select_results(
            retrieval_results, max_tokens=2000
        )

        # 3. 组装上下文
        context_text = self._assemble_context(
            query, selected_results, template
        )

        # 4. 插入引用标记
        context_text = self._insert_citations(context_text, selected_results)

        return {
            "context": context_text,
            "sources": [r['metadata'] for r in selected_results],
            "token_count": self._estimate_tokens(context_text)
        }

    def _select_template(self, context):
        """选择合适的 Prompt 模板"""
        if not context:
            return "default"

        # 根据学科和学段选择模板
        template_key = f"{context.get('subject_id', 'default')}_{context.get('grade_id', 'default')}"
        return self.template_manager.get_template(template_key, "default")

    def _select_results(self, results, max_tokens=2000):
        """选择检索结果，控制 Token 数量"""
        selected = []
        total_tokens = 0

        for result in results:
            # 估算结果文本的 Token 数
            result_tokens = self._estimate_tokens(result['chunk_text'])

            if total_tokens + result_tokens <= max_tokens:
                selected.append(result)
                total_tokens += result_tokens
            else:
                break

        return selected

    def _assemble_context(self, query, results, template):
        """组装上下文"""
        context_parts = []

        # 添加参考信息
        for i, result in enumerate(results, 1):
            source_type = self._get_source_type_label(result['doc_type'])
            context_parts.append(
                f"【参考资料{i}】{source_type}：{result['title']}\n"
                f"{result['chunk_text']}"
            )

        # 组装完整上下文
        context = template.format(
            query=query,
            references="\n\n".join(context_parts)
        )

        return context

    def _get_source_type_label(self, doc_type):
        """获取文档类型标签"""
        labels = {
            'textbook_chapter': '教材',
            'knowledge_point': '知识点',
            'exam_point': '考点',
            'question_analysis': '题目解析',
            'method_summary': '方法总结',
            'common_mistake': '常见错误',
            'example': '例题'
        }
        return labels.get(doc_type, '资料')

    def _insert_citations(self, context, results):
        """插入引用标记"""
        # 在每个参考资料后插入引用标记
        for i, result in enumerate(results, 1):
            citation = f"[参考{i}]"
            context = context.replace(result['chunk_text'][:20], f"{result['chunk_text'][:20]} {citation}", 1)

        return context

    def _estimate_tokens(self, text):
        """估算 Token 数（粗略估算：中文约 1.5 字符 = 1 Token）"""
        return len(text) // 1.5
```

---

## 5. 向量化与索引管理

### 5.1 文档分块策略

```python
class DocumentChunker:
    def __init__(self, chunk_size=500, chunk_overlap=50):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def chunk(self, document):
        """
        将文档分块
        """
        text = document['content']
        chunks = []

        # 1. 按段落分割
        paragraphs = text.split('\n\n')

        # 2. 递归分割，优先在句子边界
        current_chunk = []
        current_length = 0

        for para in paragraphs:
            para_length = len(para)

            # 如果单个段落超过 chunk_size，进一步分割
            if para_length > self.chunk_size:
                # 先保存当前 chunk
                if current_chunk:
                    chunks.append(''.join(current_chunk))
                    current_chunk = []
                    current_length = 0

                # 分割长段落
                sub_chunks = self._split_long_paragraph(para)
                chunks.extend(sub_chunks)
            else:
                # 检查是否超过 chunk_size
                if current_length + para_length > self.chunk_size:
                    if current_chunk:
                        chunks.append(''.join(current_chunk))
                        # 保留重叠部分
                        overlap_text = self._get_overlap(''.join(current_chunk))
                        current_chunk = [overlap_text]
                        current_length = len(overlap_text)

                current_chunk.append(para)
                current_length += para_length

        # 保存最后一个 chunk
        if current_chunk:
            chunks.append(''.join(current_chunk))

        # 3. 生成 chunk 对象
        chunk_objects = []
        for i, chunk_text in enumerate(chunks):
            chunk_objects.append({
                'chunk_index': i,
                'chunk_text': chunk_text,
                'chunk_length': len(chunk_text),
                'is_boundary': self._is_boundary_chunk(chunk_text)
            })

        return chunk_objects

    def _split_long_paragraph(self, paragraph):
        """分割长段落"""
        chunks = []
        sentences = re.split(r'[。！？；]', paragraph)

        current_chunk = ''
        for sentence in sentences:
            if len(current_chunk) + len(sentence) > self.chunk_size:
                if current_chunk:
                    chunks.append(current_chunk)
                current_chunk = sentence
            else:
                current_chunk += sentence

        if current_chunk:
            chunks.append(current_chunk)

        return chunks

    def _get_overlap(self, text):
        """获取重叠部分"""
        words = text.split()
        if len(words) <= self.chunk_overlap:
            return text
        return ' '.join(words[-self.chunk_overlap:])

    def _is_boundary_chunk(self, chunk_text):
        """判断是否为边界分块（如包含章节标题）"""
        boundary_patterns = [
            r'^第[一二三四五六七八九十\d]+[章节篇]',
            r'^[一二三四五六七八九十\d]+[\.、、]',
            r'^【.+】'
        ]
        for pattern in boundary_patterns:
            if re.match(pattern, chunk_text.strip()):
                return True
        return False
```

### 5.2 批量向量化

```python
class EmbeddingService:
    def __init__(self, embedding_model, batch_size=100):
        self.embedding_model = embedding_model
        self.batch_size = batch_size

    async def embed_documents_batch(self, documents):
        """
        批量向量化文档
        """
        all_embeddings = []
        all_chunk_ids = []

        # 分批处理
        for i in range(0, len(documents), self.batch_size):
            batch = documents[i:i + self.batch_size]
            texts = [doc['chunk_text'] for doc in batch]
            chunk_ids = [doc['chunk_id'] for doc in batch]

            # 调用嵌入模型
            embeddings = await self.embedding_model.embed_batch(texts)

            all_embeddings.extend(embeddings)
            all_chunk_ids.extend(chunk_ids)

        return list(zip(all_chunk_ids, all_embeddings))

    async def embed_query(self, query):
        """
        向量化查询
        """
        embedding = await self.embedding_model.embed(query)
        return embedding

    def get_embedding_dimension(self):
        """获取向量维度"""
        return self.embedding_model.dimension
```

---

## 6. 质量监控与优化

### 6.1 检索质量监控

```python
class RetrievalQualityMonitor:
    def __init__(self, db_client):
        self.db_client = db_client

    def log_retrieval(self, log_data):
        """
        记录检索日志
        """
        return self.db_client.insert('retrieval_logs', log_data)

    def calculate_metrics(self, time_range='7d'):
        """
        计算检索质量指标
        """
        # 1. 检索成功率
        success_rate = self._calculate_success_rate(time_range)

        # 2. 平均相似度分数
        avg_score = self._calculate_avg_score(time_range)

        # 3. 检索延迟
        avg_latency = self._calculate_avg_latency(time_range)

        # 4. 用户反馈率
        feedback_rate = self._calculate_feedback_rate(time_range)

        # 5. 有帮助比例
        helpful_ratio = self._calculate_helpful_ratio(time_range)

        return {
            "success_rate": success_rate,
            "avg_score": avg_score,
            "avg_latency_ms": avg_latency,
            "feedback_rate": feedback_rate,
            "helpful_ratio": helpful_ratio
        }

    def _calculate_success_rate(self, time_range):
        """计算检索成功率"""
        query = f"""
            SELECT
                COUNT(CASE WHEN JSON_LENGTH(retrieved_doc_ids) > 0 THEN 1 END) * 100.0 / COUNT(*) as success_rate
            FROM retrieval_logs
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL {time_range})
        """
        result = self.db_client.execute(query)
        return result[0]['success_rate']

    def _calculate_avg_score(self, time_range):
        """计算平均相似度分数"""
        query = f"""
            SELECT
                AVG(
                    JSON_UNQUOTE(
                        JSON_EXTRACT(retrieved_scores, '$[0]')
                    )
                ) as avg_score
            FROM retrieval_logs
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL {time_range})
            AND JSON_LENGTH(retrieved_scores) > 0
        """
        result = self.db_client.execute(query)
        return float(result[0]['avg_score'])

    def _calculate_avg_latency(self, time_range):
        """计算平均检索延迟"""
        query = f"""
            SELECT
                AVG(retrieval_latency_ms) as avg_latency
            FROM retrieval_logs
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL {time_range})
        """
        result = self.db_client.execute(query)
        return float(result[0]['avg_latency'])

    def _calculate_feedback_rate(self, time_range):
        """计算用户反馈率"""
        query = f"""
            SELECT
                COUNT(CASE WHEN user_feedback IS NOT NULL THEN 1 END) * 100.0 / COUNT(*) as feedback_rate
            FROM retrieval_logs
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL {time_range})
        """
        result = self.db_client.execute(query)
        return result[0]['feedback_rate']

    def _calculate_helpful_ratio(self, time_range):
        """计算有帮助比例"""
        query = f"""
            SELECT
                COUNT(CASE WHEN user_feedback = 'helpful' THEN 1 END) * 100.0 /
                COUNT(CASE WHEN user_feedback IS NOT NULL THEN 1 END) as helpful_ratio
            FROM retrieval_logs
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL {time_range})
        """
        result = self.db_client.execute(query)
        return result[0]['helpful_ratio']
```

### 6.2 反馈驱动的优化

```python
class FeedbackDrivenOptimizer:
    def __init__(self, db_client, vector_client):
        self.db_client = db_client
        self.vector_client = vector_client

    def process_feedback(self, feedback_data):
        """
        处理用户反馈
        """
        doc_id = feedback_data['doc_id']
        is_helpful = feedback_data['is_helpful']

        # 1. 更新文档质量分数
        self._update_document_quality(doc_id, is_helpful)

        # 2. 如果反馈为负面，分析原因
        if not is_helpful:
            self._analyze_negative_feedback(feedback_data)

    def _update_document_quality(self, doc_id, is_helpful):
        """更新文档质量分数"""
        # 获取当前统计数据
        query = """
            SELECT
                retrieval_count,
                relevance_feedback_count,
                relevance_feedback_positive
            FROM knowledge_documents
            WHERE id = %s
        """
        result = self.db_client.execute(query, (doc_id,))
        if not result:
            return

        stats = result[0]
        new_count = stats['relevance_feedback_count'] + 1
        new_positive = stats['relevance_feedback_positive'] + (1 if is_helpful else 0)

        # 计算新质量分数
        new_quality_score = new_positive / new_count if new_count > 0 else stats['quality_score']

        # 更新数据库
        update_query = """
            UPDATE knowledge_documents
            SET
                relevance_feedback_count = %s,
                relevance_feedback_positive = %s,
                quality_score = %s
            WHERE id = %s
        """
        self.db_client.execute(update_query, (new_count, new_positive, new_quality_score, doc_id))

    def _analyze_negative_feedback(self, feedback_data):
        """分析负面反馈"""
        # 记录到分析队列，后续人工审核或自动调整
        pass
```

---

## 7. 错误处理与降级

### 7.1 错误处理策略

| 错误场景 | 处理策略 |
|----------|----------|
| 向量检索超时 | 降级到关键词检索 |
| 向量数据库不可用 | 使用缓存的历史检索结果 |
| 检索结果为空 | 返回通用提示，建议用户重新表述 |
| 上下文过长 | 截断或减少检索结果数量 |
| 向量化失败 | 返回错误但不影响对话，仅不使用检索增强 |

### 7.2 降级方案实现

```python
class RetrievalServiceWithFallback:
    def __init__(self, vector_retriever, keyword_retriever, cache_client):
        self.vector_retriever = vector_retriever
        self.keyword_retriever = keyword_retriever
        self.cache_client = cache_client

    async def retrieve_with_fallback(self, query, context, config):
        """
        带降级的检索
        """
        # 1. 尝试向量检索
        try:
            results = await self.vector_retriever.retrieve(
                query, context, config['top_k'], config['threshold']
            )
            if results:
                return results, "vector"
        except Exception as e:
            print(f"Vector retrieval failed: {e}")

        # 2. 降级到关键词检索
        try:
            results = await self.keyword_retriever.retrieve(
                query, context, config['top_k']
            )
            if results:
                return results, "keyword"
        except Exception as e:
            print(f"Keyword retrieval failed: {e}")

        # 3. 使用缓存结果
        try:
            cached_results = self._get_cached_results(query, context)
            if cached_results:
                return cached_results, "cache"
        except Exception as e:
            print(f"Cache retrieval failed: {e}")

        # 4. 返回空结果
        return [], "none"

    def _get_cached_results(self, query, context):
        """获取缓存的检索结果"""
        cache_key = f"retrieval:{hash(query)}:{hash(str(context))}"
        cached_data = self.cache_client.get(cache_key)
        if cached_data:
            return json.loads(cached_data)
        return None
```

---

## 8. 性能优化

### 8.1 缓存策略

```python
class RetrievalCache:
    def __init__(self, redis_client, ttl=3600):
        self.redis_client = redis_client
        self.ttl = ttl

    def get(self, query, context):
        """获取缓存"""
        cache_key = self._build_cache_key(query, context)
        cached = self.redis_client.get(cache_key)
        if cached:
            return json.loads(cached)
        return None

    def set(self, query, context, results):
        """设置缓存"""
        cache_key = self._build_cache_key(query, context)
        self.redis_client.setex(
            cache_key,
            self.ttl,
            json.dumps(results)
        )

    def _build_cache_key(self, query, context):
        """构建缓存 Key"""
        key_parts = [
            "retrieval",
            hash(query),
            hash(str(context))
        ]
        return ":".join(str(part) for part in key_parts)
```

### 8.2 批量检索优化

```python
class BatchRetriever:
    def __init__(self, vector_retriever):
        self.vector_retriever = vector_retriever

    async def retrieve_batch(self, queries, context, config):
        """
        批量检索，减少网络往返
        """
        # 1. 批量生成查询向量
        query_vectors = [
            self.vector_retriever.embedding_model.encode(q)
            for q in queries
        ]

        # 2. 批量执行检索
        all_results = await self.vector_retriever.search_batch(
            query_vectors, context, config['top_k']
        )

        return all_results
```

---

## 9. 配置示例

### 9.1 检索配置

```yaml
retrieval:
  # 向量检索配置
  vector:
    model: "text-embedding-3-small"
    dimension: 1536
    metric_type: "COSINE"
    index_type: "IVF_FLAT"
    nlist: 1024
    nprobe: 10

  # 分块配置
  chunking:
    chunk_size: 500
    chunk_overlap: 50

  # 检索参数
  default:
    top_k: 10
    score_threshold: 0.70
    max_context_tokens: 2000

  # 重排序权重
  reranking:
    lambda_vec: 0.6
    lambda_kw: 0.3
    lambda_ctx: 0.1

  # 缓存配置
  cache:
    enabled: true
    ttl: 3600

  # 降级配置
  fallback:
    enable_keyword_fallback: true
    enable_cache_fallback: true
```

### 9.2 Prompt 模板示例

```yaml
prompt_templates:
  default: |
    你是启硕 PrimeTop 的 AI 学习助手。请基于以下参考资料回答学生的问题。

    学生问题：{query}

    参考资料：
    {references}

    请用简单易懂的语言解释，避免使用过于专业的术语。如果参考资料不足以回答问题，请诚实告知。

  math_junior: |
    你是启硕 PrimeTop 的数学辅导老师，专门帮助初中学生理解数学概念。

    学生问题：{query}

    参考资料：
    {references}

    请按照以下结构回答：
    1. 直接回答问题
    2. 解释关键概念
    3. 给出例题
    4. 提醒常见错误
```

---

## 10. 部署与运维

### 10.1 Docker Compose 配置

```yaml
version: '3.8'

services:
  milvus:
    image: milvusdb/milvus:latest
    ports:
      - "19530:19530"
    environment:
      - ETCD_ENDPOINTS=etcd:2379
      - MINIO_ADDRESS=minio:9000
    depends_on:
      - etcd
      - minio

  etcd:
    image: quay.io/coreos/etcd:latest
    environment:
      - ETCD_AUTO_COMPACTION_MODE=revision
      - ETCD_AUTO_COMPACTION_RETENTION=1000
      - ETCD_QUOTA_BACKEND_BYTES=4294967296

  minio:
    image: minio/minio:latest
    environment:
      - MINIO_ACCESS_KEY=minioadmin
      - MINIO_SECRET_KEY=minioadmin
    command: server /data

  rag-service:
    build: ./rag-service
    ports:
      - "8001:8000"
    environment:
      - MILVUS_HOST=milvus
      - MILVUS_PORT=19530
      - MYSQL_HOST=mysql
      - REDIS_HOST=redis
    depends_on:
      - milvus
      - mysql
      - redis
```

### 10.2 监控指标

| 指标 | 告警阈值 |
|------|----------|
| 检索延迟 P99 | > 200ms |
| 检索成功率 | < 95% |
| 平均相似度分数 | < 0.70 |
| 向量数据库 QPS | > 1000 |
| 缓存命中率 | < 80% |
| 用户反馈率 | < 5% |

---

## 11. 测试策略

### 11.1 单元测试

```python
import pytest

class TestQueryPreprocessor:
    def test_clean_text(self):
        preprocessor = QueryPreprocessor(None, None)
        text = "什么是  平行四边形？"
        cleaned = preprocessor._clean_text(text)
        assert cleaned == "什么是 平行四边形"

    def test_classify_intent(self):
        preprocessor = QueryPreprocessor(None, None)
        assert preprocessor._classify_intent("什么是平行四边形") == "concept"
        assert preprocessor._classify_intent("如何判定平行四边形") == "method"
        assert preprocessor._classify_intent("平行四边形的例题") == "example"

class TestResultReranker:
    def test_normalize(self):
        reranker = ResultReranker()
        assert reranker._normalize(0.5) == 0.5
        assert reranker._normalize(0.0) == 0.0
        assert reranker._normalize(1.0) == 1.0

    def test_calculate_context_score(self):
        reranker = ResultReranker()
        result = {
            'metadata': {
                'subject_id': 1,
                'grade_id': 8,
                'chapter_id': 10
            }
        }
        context = {
            'subject_id': 1,
            'grade_id': 8,
            'chapter_id': 10
        }
        score = reranker._calculate_context_score(result, context)
        assert score == 1.0
```

### 11.2 集成测试

```python
import pytest
import asyncio

class TestRetrievalIntegration:
    @pytest.mark.asyncio
    async def test_retrieve_with_feedback(self):
        # 初始化服务
        retrieval_service = RetrievalService(...)

        # 执行检索
        results = await retrieval_service.retrieve(
            query="什么是平行四边形的判定定理？",
            context={'subject_id': 1, 'grade_id': 8},
            config={'top_k': 10, 'threshold': 0.70}
        )

        # 验证结果
        assert len(results) > 0
        assert all(r['score'] >= 0.70 for r in results)

        # 提交反馈
        await retrieval_service.submit_feedback({
            'doc_id': results[0]['doc_id'],
            'is_helpful': True,
            'relevance_score': 5
        })
```

---

## 12. 总结

本详细设计文档涵盖了 RAG 检索增强生成系统的核心实现细节，包括：

1. **数据结构设计**：知识库文档、向量索引、文档分块、检索日志等核心表结构
2. **API 接口设计**：语义检索、批量向量化、反馈提交、上下文构建等接口
3. **核心业务逻辑**：查询预处理、向量检索、结果融合与重排序、上下文构建
4. **向量化与索引管理**：文档分块策略、批量向量化
5. **质量监控与优化**：检索质量监控、反馈驱动的优化
6. **错误处理与降级**：多级降级策略
7. **性能优化**：缓存策略、批量检索
8. **配置示例**：检索配置、Prompt 模板
9. **部署与运维**：Docker Compose、监控指标
10. **测试策略**：单元测试、集成测试

该设计可以直接用于开发实现，确保 RAG 系统能够为 AI 辅导提供准确、可靠的知识支持。