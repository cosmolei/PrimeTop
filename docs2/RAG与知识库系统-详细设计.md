# RAG 与知识库系统 - 详细设计

> 模块定位：PrimeTop AI 辅助学习的核心基础设施，负责教育内容的结构化存储、向量检索、知识图谱构建和 RAG 增强生成流水线。

---

## 1. 模块概述

### 1.1 核心职责

1. **知识库构建**：将教材、题库、解析、考点等教育内容结构化并入库
2. **向量化管道**：将文本内容 embedding 后存入向量数据库，支持语义检索
3. **检索增强生成（RAG）**：根据用户问题检索相关知识片段，增强大模型回答质量
4. **知识图谱**：构建知识点之间的前置/关联/包含关系，支持导航和推理
5. **内容版本管理**：教材版本、知识点、题目的版本化管理与增量更新

### 1.2 设计目标

| 目标 | 指标 |
|------|------|
| 检索延迟 | P95 < 200ms（单次向量检索） |
| 检索准确率 | Top-10 召回率 > 90%（知识点级别） |
| 知识库容量 | 初期支持 50 万+ 知识片段 |
| 更新时效 | 新内容入库后 < 5 分钟可检索 |
| 可用性 | 99.9%（检索服务） |

### 1.3 系统边界

```
┌─────────────────────────────────────────────────────────┐
│                   RAG 与知识库系统                        │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ 内容摄入  │  │ 向量管道  │  │ 检索服务  │  │图谱服务│  │
│  │ Pipeline │  │ Pipeline │  │  Router  │  │ Graph  │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘  │
│       │              │              │             │       │
│  ┌────▼──────────────▼──────────────▼─────────────▼────┐ │
│  │              存储层 (MySQL + Milvus + ES)            │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
         ▲                    ▲                    ▲
         │                    │                    │
   内容运营后台          AI 辅导服务           同步课堂服务
   (内容入库)          (RAG 检索)          (章节/知识点查询)
```

---

## 2. 核心数据结构

### 2.1 知识片段（Knowledge Chunk）

知识片段是 RAG 检索的基本单元，由原始内容切分而来。

```sql
-- 知识片段表
CREATE TABLE knowledge_chunk (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    chunk_uuid          VARCHAR(36) NOT NULL UNIQUE COMMENT '片段唯一标识 UUID',
    
    -- 来源追溯
    source_type         VARCHAR(32) NOT NULL COMMENT '来源类型: textbook/exam_point/question_analysis/teaching_material/knowledge_summary',
    source_id           BIGINT NOT NULL COMMENT '来源记录 ID',
    source_version      INT NOT NULL DEFAULT 1 COMMENT '来源内容版本号',
    
    -- 知识定位
    subject_code        VARCHAR(16) NOT NULL COMMENT '学科编码: CHN/MATH/ENG/PHY/CHE/BIO/HIS/GEO/POL',
    stage_code          VARCHAR(16) NOT NULL COMMENT '学段: K/PRIMARY/JUNIOR/SENIOR',
    grade_range         VARCHAR(32) COMMENT '适用年级范围: 1-6/7-9/10-12',
    textbook_id         BIGINT COMMENT '关联教材 ID (nullable，部分内容不绑定教材)',
    chapter_id          BIGINT COMMENT '关联章节 ID',
    knowledge_point_id  BIGINT COMMENT '关联知识点 ID',
    
    -- 内容
    content_text        TEXT NOT NULL COMMENT '片段文本内容',
    content_hash        VARCHAR(64) NOT NULL COMMENT '内容 SHA256 哈希，用于去重',
    chunk_index         INT NOT NULL COMMENT '在来源文档中的片段序号 (0-based)',
    token_count         INT NOT NULL COMMENT '文本 token 数',
    char_count          INT NOT NULL COMMENT '字符数',
    
    -- 向量信息
    embedding_id        VARCHAR(64) COMMENT '向量数据库中的 ID',
    embedding_model     VARCHAR(64) COMMENT '使用的 embedding 模型标识',
    embedding_status    TINYINT NOT NULL DEFAULT 0 COMMENT '0=待嵌入 1=已嵌入 2=嵌入失败 3=已过期',
    embedded_at         DATETIME COMMENT '嵌入完成时间',
    
    -- 元数据
    tags                JSON COMMENT '标签数组，如 ["三角函数","诱导公式","高二"]',
    difficulty_level    TINYINT COMMENT '难度等级 1-5',
    language            VARCHAR(8) NOT NULL DEFAULT 'zh-CN' COMMENT '内容语言',
    
    -- 状态管理
    status              TINYINT NOT NULL DEFAULT 1 COMMENT '0=禁用 1=启用 2=待审核',
    is_latest           TINYINT NOT NULL DEFAULT 1 COMMENT '是否为最新版本 (同一 source_id 下)',
    
    -- 审计
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by          VARCHAR(64) NOT NULL,
    
    INDEX idx_source (source_type, source_id, source_version),
    INDEX idx_knowledge (subject_code, stage_code, knowledge_point_id),
    INDEX idx_textbook_chapter (textbook_id, chapter_id),
    INDEX idx_embedding_status (embedding_status, is_latest),
    INDEX idx_hash (content_hash),
    INDEX idx_tags ((CAST(tags AS CHAR(512))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 2.2 知识点（Knowledge Point）

```sql
-- 知识点表
CREATE TABLE knowledge_point (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    point_uuid          VARCHAR(36) NOT NULL UNIQUE,
    
    -- 归属
    subject_code        VARCHAR(16) NOT NULL,
    stage_code          VARCHAR(16) NOT NULL,
    
    -- 层级结构（树形，最多 4 级）
    parent_id           BIGINT COMMENT '父知识点 ID',
    level               TINYINT NOT NULL COMMENT '层级: 1=领域 2=专题 3=知识点 4=细粒度技能',
    path                VARCHAR(512) NOT NULL COMMENT '物化路径: /数学/初中/函数/一次函数/',
    sort_order          INT NOT NULL DEFAULT 0,
    
    -- 内容
    name                VARCHAR(128) NOT NULL COMMENT '知识点名称',
    short_name          VARCHAR(64) COMMENT '简称',
    description         TEXT COMMENT '知识点描述',
    keywords            JSON COMMENT '搜索关键词数组 ["一元二次方程","求根公式","判别式"]',
    
    -- 关联
    exam_weight         DECIMAL(5,2) COMMENT '考试权重 (0-100)，用于考点梳理',
    difficulty_default  TINYINT COMMENT '默认难度 1-5',
    
    -- 状态
    status              TINYINT NOT NULL DEFAULT 1 COMMENT '0=禁用 1=启用',
    
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_subject_stage (subject_code, stage_code),
    INDEX idx_parent (parent_id),
    INDEX idx_path (path),
    FULLTEXT INDEX ft_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 2.3 知识点关系（Knowledge Edge）

```sql
-- 知识点关系图（有向图）
CREATE TABLE knowledge_edge (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    from_point_id       BIGINT NOT NULL COMMENT '起始知识点',
    to_point_id         BIGINT NOT NULL COMMENT '目标知识点',
    edge_type           VARCHAR(32) NOT NULL COMMENT '关系类型: prerequisite/contains/related/similar/applied_in',
    
    -- 关系属性
    strength            TINYINT COMMENT '关联强度 1-5',
    description         VARCHAR(256) COMMENT '关系描述',
    
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE INDEX idx_edge (from_point_id, to_point_id, edge_type),
    INDEX idx_from (from_point_id),
    INDEX idx_to (to_point_id),
    
    FOREIGN KEY (from_point_id) REFERENCES knowledge_point(id),
    FOREIGN KEY (to_point_id) REFERENCES knowledge_point(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**关系类型说明：**

| edge_type | 含义 | 方向 | 示例 |
|-----------|------|------|------|
| `prerequisite` | 前置依赖 | A→B 表示学习B需先掌握A | 乘法→因式分解 |
| `contains` | 包含关系 | 父→子 | 函数→一次函数 |
| `related` | 相关关联 | 双向 | 一元二次方程→二次函数 |
| `similar` | 易混淆 | 双向 | 排列→组合 |
| `applied_in` | 应用场景 | 知识点→场景 | 勾股定理→三角形面积计算 |

### 2.4 教材章节-知识点映射

```sql
-- 教材版本下，章节与知识点的多对多映射
CREATE TABLE chapter_knowledge_mapping (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    textbook_id         BIGINT NOT NULL,
    chapter_id          BIGINT NOT NULL,
    knowledge_point_id  BIGINT NOT NULL,
    
    -- 映射属性
    importance          TINYINT NOT NULL DEFAULT 3 COMMENT '该知识点在本章的重要程度 1-5',
    is_exam_focus       TINYINT NOT NULL DEFAULT 0 COMMENT '是否为考试重点',
    
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE INDEX idx_mapping (textbook_id, chapter_id, knowledge_point_id),
    INDEX idx_kp (knowledge_point_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 2.5 向量集合元数据

```sql
-- 向量集合版本管理
CREATE TABLE embedding_collection (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    collection_name     VARCHAR(128) NOT NULL UNIQUE COMMENT 'Milvus collection 名称',
    embedding_model     VARCHAR(64) NOT NULL COMMENT '模型标识: bge-large-zh-v1.5',
    dimension           INT NOT NULL COMMENT '向量维度: 1024',
    
    -- 范围
    subject_code        VARCHAR(16) COMMENT '学科 (null = 全学科)',
    stage_code          VARCHAR(16) COMMENT '学段 (null = 全学段)',
    
    -- 统计
    total_vectors       BIGINT NOT NULL DEFAULT 0 COMMENT '向量总数',
    last_sync_at        DATETIME COMMENT '最近一次同步时间',
    
    status              TINYINT NOT NULL DEFAULT 1 COMMENT '0=禁用 1=活跃 2=重建中',
    
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

## 3. 系统架构

### 3.1 整体架构

```
                          ┌─────────────────┐
                          │   内容运营后台    │
                          │  (人工录入/批量导入) │
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │   内容摄入服务    │
                          │  Ingestion Svc  │
                          │                 │
                          │ · 格式校验       │
                          │ · 文本清洗       │
                          │ · 智能切片       │
                          │ · 去重检测       │
                          └────────┬────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
           ┌────────▼──────┐ ┌────▼────────┐ ┌───▼──────────┐
           │   MySQL 写入   │ │ 异步消息队列  │ │ ES 索引更新   │
           │ (knowledge_   │ │ (chunk.task  │ │ (全文检索)    │
           │  chunk 表)     │ │  topic)      │ │              │
           └───────────────┘ └────┬────────┘ └──────────────┘
                                 │
                          ┌──────▼──────────┐
                          │   向量管道 Worker │
                          │  Embedding Pipe  │
                          │                 │
                          │ · 批量 embedding │
                          │ · Milvus 写入    │
                          │ · 状态回调       │
                          └─────────────────┘


         ──────── 检索侧（在线服务）────────

                          ┌─────────────────┐
                          │    用户问题       │
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │   检索路由服务    │
                          │  Retrieval Svc  │
                          │                 │
                          │ · Query 理解     │
                          │ · 多路召回       │
                          │ · 融合排序       │
                          └────────┬────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
           ┌────────▼──────┐ ┌────▼────────┐ ┌───▼──────────┐
           │   Milvus      │ │ Elasticsearch│ │ MySQL 知识点  │
           │  (向量相似度)   │ │ (BM25 全文)  │ │  (精确匹配)   │
           └───────────────┘ └──────────────┘ └──────────────┘
                    │              │              │
                    └──────────────┼──────────────┘
                                   │
                          ┌────────▼────────┐
                          │    RRF 融合排序   │
                          │ + 知识图谱增强   │
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │   Prompt 组装    │
                          │  → LLM 生成     │
                          └─────────────────┘
```

### 3.2 服务拆分

| 服务 | 职责 | 部署形态 |
|------|------|----------|
| IngestionService | 内容摄入、切片、去重 | Spring Boot 微服务 |
| EmbeddingWorker | 消费切片任务，调用 embedding API，写入 Milvus | 异步 Worker（可多实例） |
| RetrievalService | 检索路由、多路召回、融合排序 | Spring Boot 微服务 |
| KnowledgeGraphService | 知识点 CRUD、图关系查询、路径推导 | Spring Boot 微服务 |
| KnowledgeSyncJob | 定时同步 MySQL → ES / Milvus 的一致性校验 | Cron Job |

---

## 4. 内容摄入管道（Ingestion Pipeline）

### 4.1 切片策略

不同来源的内容采用不同的切片策略：

| 来源类型 | 切片策略 | 目标片段大小 | 重叠 |
|----------|----------|-------------|------|
| `textbook` | 按标题层级切分（章→节→知识点） | 300-500 字 | 50 字 |
| `exam_point` | 按考点条目切分，每条一个片段 | 不限 | 0 |
| `question_analysis` | 一道题的完整解析为一个片段 | 不限 | 0 |
| `teaching_material` | 按段落 + 语义边界切分 | 400-600 字 | 100 字 |
| `knowledge_summary` | 按知识点粒度切分 | 200-400 字 | 0 |

### 4.2 切片算法

```java
/**
 * 智能文本切片器
 * 基于 heading + 语义边界的混合切片策略
 */
public class SmartTextChunker {
    
    // 最大 chunk token 数（中文约 2 字/token）
    private static final int MAX_CHUNK_TOKENS = 400;
    // 最小 chunk token 数，低于此值的 chunk 尝试合并
    private static final int MIN_CHUNK_TOKENS = 80;
    // 重叠 token 数
    private static final int OVERLAP_TOKENS = 40;
    
    /**
     * 对富文本文档进行切片
     * @param document 输入文档（已解析为结构化节点树）
     * @param strategy 切片策略
     * @return 切片结果列表
     */
    public List<ChunkResult> chunk(DocumentNode document, ChunkStrategy strategy) {
        List<ChunkResult> results = new ArrayList<>();
        
        switch (strategy) {
            case HEADING_BASED:
                // 按标题层级切分
                results = chunkByHeading(document);
                break;
            case SEMANTIC_BOUNDARY:
                // 按语义边界切分（段落 + token 限制）
                results = chunkBySemanticBoundary(document);
                break;
            case FIXED_SIZE:
                // 固定大小切分（带重叠）
                results = chunkByFixedSize(document);
                break;
            case WHOLE_DOCUMENT:
                // 整篇作为一个 chunk（适合考点条目）
                results = Collections.singletonList(toChunk(document, 0));
                break;
        }
        
        // 后处理：合并过小的 chunk
        return mergeSmallChunks(results, MIN_CHUNK_TOKENS);
    }
    
    /**
     * 按标题层级切分
     * 标题（H1-H6）作为自然分界点
     */
    private List<ChunkResult> chunkByHeading(DocumentNode document) {
        List<ChunkResult> chunks = new ArrayList<>();
        StringBuilder currentChunk = new StringBuilder();
        int currentTokens = 0;
        int chunkIndex = 0;
        String currentHeading = "";
        
        for (DocumentNode node : document.flatten()) {
            if (node.isHeading()) {
                // 遇到新标题，保存当前 chunk
                if (currentTokens >= MIN_CHUNK_TOKENS) {
                    chunks.add(buildChunk(currentChunk.toString(), 
                                          chunkIndex++, currentHeading));
                    // 添加重叠内容
                    currentChunk = new StringBuilder(getTailOverlap(currentChunk.toString()));
                    currentTokens = estimateTokens(getTailOverlap(currentChunk.toString()));
                }
                currentHeading = node.getText();
            }
            
            // 如果加上新节点会超出限制，先保存
            int nodeTokens = estimateTokens(node.getText());
            if (currentTokens + nodeTokens > MAX_CHUNK_TOKENS && currentTokens >= MIN_CHUNK_TOKENS) {
                chunks.add(buildChunk(currentChunk.toString(), chunkIndex++, currentHeading));
                currentChunk = new StringBuilder(getTailOverlap(currentChunk.toString()));
                currentTokens = estimateTokens(getTailOverlap(currentChunk.toString()));
            }
            
            currentChunk.append(node.getText()).append("\n");
            currentTokens += nodeTokens;
        }
        
        // 保存最后一个 chunk
        if (currentTokens > 0) {
            chunks.add(buildChunk(currentChunk.toString(), chunkIndex, currentHeading));
        }
        
        return chunks;
    }
    
    /**
     * Token 数估算（中文约 2 字符/token，英文约 4 字符/token）
     */
    private int estimateTokens(String text) {
        if (text == null || text.isEmpty()) return 0;
        int cjkCount = 0;
        for (char c : text.toCharArray()) {
            if (isCJK(c)) cjkCount++;
        }
        int nonCjk = text.length() - cjkCount;
        return (int) Math.ceil(cjkCount / 1.5 + nonCjk / 4.0);
    }
    
    private boolean isCJK(char c) {
        Character.UnicodeBlock block = Character.UnicodeBlock.of(c);
        return block == Character.UnicodeBlock.CJK_UNIFIED_IDEOGRAPHS
            || block == Character.UnicodeBlock.CJK_SYMBOLS_AND_PUNCTUATION
            || block == Character.UnicodeBlock.HIRAGANA
            || block == Character.UnicodeBlock.KATAKANA;
    }
}
```

### 4.3 去重策略

```java
/**
 * 内容去重服务
 * 基于 content_hash + 语义相似度的双重去重
 */
public class DeduplicationService {
    
    /**
     * 检查内容是否重复
     * @return true 表示是重复内容，应跳过
     */
    public boolean isDuplicate(KnowledgeChunk chunk) {
        // 第一层：精确哈希去重
        Optional<KnowledgeChunk> exactMatch = chunkRepository
            .findByContentHashAndSourceTypeAndSourceId(
                chunk.getContentHash(), 
                chunk.getSourceType(), 
                chunk.getSourceId());
        if (exactMatch.isPresent()) {
            return true;
        }
        
        // 第二层：相似度去重（仅对同一知识点下的 chunk）
        // 取该知识点下已有的 top-3 chunk，计算语义相似度
        // 如果 sim > 0.95 则认为重复
        // 这一步是可选的，因为调用 embedding 比较耗时
        // 实际生产中可以用 SimHash 等轻量方案替代
        
        return false;
    }
    
    /**
     * 生成内容哈希
     * 先 normalize（去空白、统一标点、小写），再 SHA256
     */
    public String computeContentHash(String content) {
        String normalized = content
            .replaceAll("\\s+", "")
            .replaceAll("[，。！？、；：""''（）【】]", "")
            .toLowerCase();
        return DigestUtils.sha256Hex(normalized);
    }
}
```

### 4.4 摄入 API

```
POST /api/v1/knowledge/chunks/batch
Content-Type: application/json
Authorization: Bearer <service-token>

Request:
{
    "source_type": "textbook",
    "source_id": 1024,
    "source_version": 3,
    "subject_code": "MATH",
    "stage_code": "JUNIOR",
    "textbook_id": 15,
    "chapter_id": 237,
    "items": [
        {
            "content_text": "一元二次方程的一般形式为 ax² + bx + c = 0 (a ≠ 0)...",
            "knowledge_point_id": 5823,
            "tags": ["一元二次方程", "一般形式", "初三"],
            "difficulty_level": 2,
            "chunk_index": 0
        }
    ]
}

Response 200:
{
    "code": 0,
    "data": {
        "accepted": 12,
        "duplicates_skipped": 2,
        "failed": 0,
        "chunk_ids": [100251, 100252, ...],
        "pending_embedding_count": 12
    }
}
```

```
POST /api/v1/knowledge/chunks/{chunkId}/re-embed
# 手动触发重新嵌入（模型升级或嵌入失败后）
```

---

## 5. 向量嵌入管道（Embedding Pipeline）

### 5.1 模型选型

| 模型 | 维度 | 中文效果 | 推理速度 | 成本 | 适用场景 |
|------|------|---------|---------|------|---------|
| bge-large-zh-v1.5 | 1024 | ★★★★★ | 中 | 自部署 | **主力模型** |
| bge-m3 | 1024 | ★★★★☆ | 快 | 自部署 | 多语言场景备用 |
| text-embedding-3-large (OpenAI) | 3072 | ★★★★☆ | 中 | API | 备用/对比测试 |

**推荐方案**：自部署 bge-large-zh-v1.5 作为主力模型，支持批量和低延迟推理。

### 5.2 批量嵌入流程

```java
/**
 * 向量嵌入 Worker
 * 消费消息队列中的 embedding 任务，批量调用模型
 */
@Component
public class EmbeddingWorker {
    
    @Value("${embedding.batch-size:32}")
    private int batchSize;
    
    @Value("${embedding.model:bge-large-zh-v1.5}")
    private String modelName;
    
    @RabbitListener(queues = "knowledge.chunk.embed")
    public void processEmbeddingTask(EmbeddingTaskMessage message) {
        // 1. 从数据库批量取出待嵌入的 chunk
        List<KnowledgeChunk> chunks = chunkRepository
            .findPendingEmbedding(batchSize);
        
        if (chunks.isEmpty()) {
            return;
        }
        
        // 2. 提取文本，调用 embedding 服务
        List<String> texts = chunks.stream()
            .map(KnowledgeChunk::getContentText)
            .collect(Collectors.toList());
        
        EmbeddingResponse response = embeddingClient.embed(texts, modelName);
        
        // 3. 写入 Milvus
        List<Point> points = new ArrayList<>();
        for (int i = 0; i < chunks.size(); i++) {
            KnowledgeChunk chunk = chunks.get(i);
            float[] vector = response.getVectors().get(i);
            
            points.add(Point.builder()
                .id(chunk.getChunkUuid())
                .vector(vector)
                .payload(Map.of(
                    "chunk_id", chunk.getId(),
                    "source_type", chunk.getSourceType(),
                    "subject_code", chunk.getSubjectCode(),
                    "stage_code", chunk.getStageCode(),
                    "knowledge_point_id", chunk.getKnowledgePointId(),
                    "chapter_id", chunk.getChapterId(),
                    "tags", chunk.getTags(),
                    "difficulty_level", chunk.getDifficultyLevel()
                ))
                .build());
        }
        
        milvusClient.upsert(collectionName, points);
        
        // 4. 更新 chunk 状态
        chunkRepository.updateEmbeddingStatus(
            chunks.stream().map(KnowledgeChunk::getId).collect(Collectors.toList()),
            EmbeddingStatus.EMBEDDED,
            modelName,
            LocalDateTime.now()
        );
        
        log.info("Embedded {} chunks with model {}", chunks.size(), modelName);
    }
}
```

### 5.3 Milvus Collection 设计

```python
# Milvus Collection Schema
from pymilvus import CollectionSchema, FieldSchema, DataType

fields = [
    FieldSchema(name="chunk_uuid", dtype=DataType.VARCHAR, max_length=36, is_primary=True),
    FieldSchema(name="vector", dtype=DataType.FLOAT_VECTOR, dim=1024),
    
    # 过滤字段（标量索引，加速混合检索）
    FieldSchema(name="subject_code", dtype=DataType.VARCHAR, max_length=16),
    FieldSchema(name="stage_code", dtype=DataType.VARCHAR, max_length=16),
    FieldSchema(name="knowledge_point_id", dtype=DataType.INT64),
    FieldSchema(name="chapter_id", dtype=DataType.INT64),
    FieldSchema(name="source_type", dtype=DataType.VARCHAR, max_length=32),
    FieldSchema(name="difficulty_level", dtype=DataType.INT8),
]

schema = CollectionSchema(fields, description="PrimeTop 知识片段向量集合")

# 索引配置
index_params = {
    "field_name": "vector",
    "index_type": "IVF_FLAT",       # 或 HNSW (更快的检索，更高内存)
    "metric_type": "COSINE",         # 余弦相似度
    "params": {"nlist": 2048}        # IVF 聚类数
}

# 推荐生产环境使用 HNSW
index_params_hnsw = {
    "field_name": "vector",
    "index_type": "HNSW",
    "metric_type": "COSINE",
    "params": {"M": 32, "efConstruction": 256}
}
```

**混合检索表达式示例**（向量 + 标量过滤）：

```python
# 检索初中数学中难度 ≤ 3 的知识片段
search_params = {
    "collection_name": "knowledge_chunks",
    "data": [query_vector],
    "anns_field": "vector",
    "param": {"metric_type": "COSINE", "params": {"ef": 128}},
    "limit": 20,
    "expr": 'subject_code == "MATH" and stage_code == "JUNIOR" and difficulty_level <= 3',
    "output_fields": ["chunk_uuid", "source_type", "knowledge_point_id"]
}
```

### 5.4 嵌入模型升级策略

当需要切换 embedding 模型时（如 bge-large-zh-v1.5 → bge-m3）：

```
1. 创建新 Milvus Collection（新模型维度可能不同）
2. 后台批量重新嵌入全量 chunk（写入新 collection）
3. 新 collection 构建索引并验证检索质量
4. 原子切换：RetrievalService 配置指向新 collection
5. 保留旧 collection 7 天后删除
```

```java
/**
 * 模型升级切换配置
 */
@Configuration
@ConfigurationProperties(prefix = "retrieval.embedding")
public class EmbeddingConfig {
    /** 当前活跃的 collection */
    private String activeCollection = "knowledge_chunks_v2";
    /** 活跃 embedding 模型 */
    private String activeModel = "bge-large-zh-v1.5";
    /** 是否允许自动降级到旧 collection */
    private boolean fallbackEnabled = true;
    /** 降级 collection */
    private String fallbackCollection = "knowledge_chunks_v1";
}
```

---

## 6. 检索服务（Retrieval Service）

### 6.1 检索流程

```
用户问题 + 上下文 (年级/学科/教材版本)
        │
        ▼
┌───────────────────┐
│  Step 1: Query 理解 │
│  · 学科分类         │
│  · 知识点识别       │
│  · 意图判断         │
│  · Query 改写/扩展  │
└────────┬──────────┘
         │
         ▼
┌───────────────────────────────────────┐
│  Step 2: 多路召回 (Parallel)           │
│                                       │
│  路径 A: Milvus 向量检索 (Top-30)       │
│    expr: subject_code == X            │
│          && stage_code == Y           │
│                                       │
│  路径 B: ES BM25 全文检索 (Top-30)      │
│    query: match(content_text, keywords)│
│    filter: subject_code, stage_code   │
│                                       │
│  路径 C: MySQL 精确知识点匹配 (Top-10)   │
│    WHERE name LIKE '%keyword%'        │
│      AND subject_code = X             │
└────────┬──────────────────────────────┘
         │
         ▼
┌───────────────────┐
│  Step 3: RRF 融合   │
│  · Reciprocal Rank  │
│    Fusion 排序      │
│  · 去 + 重排序      │
│  · Top-K 截断       │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Step 4: 图谱增强   │
│  · 补充前置知识点   │
│  · 补充关联知识点   │
│  · 过滤已掌握的     │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Step 5: 组装 Prompt │
│  · 系统提示词模板    │
│  + 检索到的知识片段  │
│  + 用户问题          │
│  + 上下文信息        │
└───────────────────┘
```

### 6.2 Query 理解

```java
/**
 * 查询理解服务
 * 将用户的自然语言问题解析为结构化检索条件
 */
@Service
public class QueryUnderstandingService {
    
    /**
     * 解析用户查询
     * @param rawQuery 用户原始问题
     * @param context  用户上下文（年级、学科等）
     * @return 结构化查询
     */
    public ParsedQuery parse(String rawQuery, UserContext context) {
        ParsedQuery query = new ParsedQuery();
        query.setRawQuery(rawQuery);
        
        // 1. 学科推断：优先用用户当前学科，如果没有则用 LLM 轻量推断
        query.setSubjectCode(inferSubject(rawQuery, context));
        
        // 2. 关键词提取
        List<String> keywords = extractKeywords(rawQuery);
        query.setKeywords(keywords);
        
        // 3. 知识点识别：用关键词去知识图谱中匹配
        List<KnowledgePoint> matchedPoints = knowledgeGraphService
            .matchByKeywords(keywords, query.getSubjectCode(), context.getStageCode());
        query.setMatchedKnowledgePoints(matchedPoints);
        
        // 4. Query 改写：为检索优化，生成同义/扩展查询
        List<String> expandedQueries = expandQuery(rawQuery, keywords);
        query.setExpandedQueries(expandedQueries);
        
        // 5. 难度推断：根据用户年级 + 问题关键词推断
        query.setInferredDifficulty(inferDifficulty(rawQuery, context));
        
        return query;
    }
    
    /**
     * 关键词提取（基于jieba分词 + 停用词过滤 + 教育领域词典）
     */
    private List<String> extractKeywords(String text) {
        // 1. jieba 分词
        List<String> tokens = jiebaTokenizer.tokenize(text);
        // 2. 过滤停用词
        tokens = stopwordFilter.filter(tokens);
        // 3. 加权：教育领域专用词典中的词权重加倍
        //    如 "函数"、"方程"、"定积分"、"光合作用" 等
        return tokens.stream()
            .filter(t -> t.length() >= 2)
            .collect(Collectors.toList());
    }
    
    /**
     * Query 扩展：生成检索友好的变体
     * 例: "怎么求二次函数的最大值" → ["二次函数 最大值", "抛物线 顶点", "配方法"]
     */
    private List<String> expandQuery(String rawQuery, List<String> keywords) {
        List<String> expanded = new ArrayList<>();
        expanded.add(rawQuery); // 原始查询始终保留
        
        // 用轻量 LLM 生成 2-3 个变体查询
        String prompt = String.format(
            "将以下学习问题改写为适合知识库检索的简短关键词查询（2-3个变体，每行一个）：\n%s",
            rawQuery
        );
        String llmResult = lightweightLlm.generate(prompt, 200);
        // 解析 LLM 输出，每行作为一个扩展查询
        for (String line : llmResult.split("\n")) {
            String trimmed = line.trim().replaceAll("^\\d+\\.\\s*", "");
            if (!trimmed.isEmpty() && !trimmed.equals(rawQuery)) {
                expanded.add(trimmed);
            }
        }
        
        return expanded;
    }
}
```

### 6.3 多路召回与 RRF 融合

```java
/**
 * 多路召回 + RRF 融合排序
 */
@Service
public class RetrievalOrchestrator {
    
    private static final int TOP_K = 8;            // 最终返回给 Prompt 的片段数
    private static final int RECALL_PER_PATH = 30;  // 每路召回数量
    private static final double RRF_K = 60.0;       // RRF 参数 k
    
    /**
     * 执行多路召回并融合排序
     */
    public RetrievalResult retrieve(ParsedQuery query, UserContext context) {
        
        // === 并行多路召回 ===
        CompletableFuture<List<RecallItem>> vectorFuture = 
            CompletableFuture.supplyAsync(() -> vectorRecall(query, context));
        CompletableFuture<List<RecallItem>> bm25Future = 
            CompletableFuture.supplyAsync(() -> bm25Recall(query, context));
        CompletableFuture<List<RecallItem>> exactFuture = 
            CompletableFuture.supplyAsync(() -> exactMatchRecall(query, context));
        
        // 等待所有路完成（最多 500ms）
        CompletableFuture.allOf(vectorFuture, bm25Future, exactFuture)
            .orTimeout(500, TimeUnit.MILLISECONDS)
            .exceptionally(ex -> null)  // 超时不阻塞，用已有的结果
            .join();
        
        List<RecallItem> vectorResults = safeGet(vectorFuture, Collections.emptyList());
        List<RecallItem> bm25Results = safeGet(bm25Future, Collections.emptyList());
        List<RecallItem> exactResults = safeGet(exactFuture, Collections.emptyList());
        
        // === RRF 融合 ===
        Map<String, Double> rrfScores = new HashMap<>();
        Map<String, RecallItem> itemMap = new HashMap<>();
        
        // 向量检索路（权重 0.5）
        for (int i = 0; i < vectorResults.size(); i++) {
            RecallItem item = vectorResults.get(i);
            double score = 0.5 / (RRF_K + i + 1);
            rrfScores.merge(item.getChunkId(), score, Double::sum);
            itemMap.putIfAbsent(item.getChunkId(), item);
        }
        
        // BM25 全文检索路（权重 0.3）
        for (int i = 0; i < bm25Results.size(); i++) {
            RecallItem item = bm25Results.get(i);
            double score = 0.3 / (RRF_K + i + 1);
            rrfScores.merge(item.getChunkId(), score, Double::sum);
            itemMap.putIfAbsent(item.getChunkId(), item);
        }
        
        // 精确匹配路（权重 0.2）
        for (int i = 0; i < exactResults.size(); i++) {
            RecallItem item = exactResults.get(i);
            double score = 0.2 / (RRF_K + i + 1);
            rrfScores.merge(item.getChunkId(), score, Double::sum);
            itemMap.putIfAbsent(item.getChunkId(), item);
        }
        
        // === 排序 + 截断 ===
        List<String> rankedIds = rrfScores.entrySet().stream()
            .sorted(Map.Entry.<String, Double>comparingByValue().reversed())
            .limit(TOP_K)
            .map(Map.Entry::getKey)
            .collect(Collectors.toList());
        
        List<RecallItem> finalResults = rankedIds.stream()
            .map(itemMap::get)
            .filter(Objects::nonNull)
            .collect(Collectors.toList());
        
        return RetrievalResult.builder()
            .items(finalResults)
            .totalRecalled(vectorResults.size() + bm25Results.size() + exactResults.size())
            .build();
    }
    
    /**
     * 向量召回
     */
    private List<RecallItem> vectorRecall(ParsedQuery query, UserContext context) {
        // 对扩展查询分别检索，合并结果
        Set<String> seen = new HashSet<>();
        List<RecallItem> allItems = new ArrayList<>();
        
        for (String expandedQuery : query.getExpandedQueries()) {
            float[] queryVector = embeddingClient.embed(expandedQuery);
            
            String filterExpr = buildFilterExpr(query.getSubjectCode(), context.getStageCode());
            
            SearchResults results = milvusClient.search(
                activeCollection,
                Collections.singletonList(queryVector),
                "vector",
                filterExpr,
                RECALL_PER_PATH,
                Map.of("metric_type", "COSINE", "params", Map.of("ef", 128))
            );
            
            for (SearchResult hit : results.getResults()) {
                if (seen.add(hit.getId())) {
                    allItems.add(new RecallItem(
                        hit.getId(),
                        hit.getScore(),
                        "vector",
                        hit.getPayload()
                    ));
                }
            }
        }
        
        return allItems;
    }
    
    /**
     * BM25 全文召回
     */
    private List<RecallItem> bm25Recall(ParsedQuery query, UserContext context) {
        BoolQueryBuilder boolQuery = QueryBuilders.boolQuery();
        
        // 关键词匹配
        for (String keyword : query.getKeywords()) {
            boolQuery.should(QueryBuilders.matchQuery("content_text", keyword));
        }
        // 扩展查询匹配（权重降低）
        for (String expanded : query.getExpandedQueries()) {
            boolQuery.should(QueryBuilders.matchQuery("content_text", expanded).boost(0.5f));
        }
        
        // 过滤条件
        boolQuery.filter(QueryBuilders.termQuery("subject_code", query.getSubjectCode()));
        boolQuery.filter(QueryBuilders.termQuery("stage_code", context.getStageCode()));
        
        SearchRequest searchRequest = SearchRequest.builder()
            .index("knowledge_chunks")
            .query(boolQuery)
            .size(RECALL_PER_PATH)
            .build();
        
        // ... 执行搜索并转换为 RecallItem
        return executeSearch(searchRequest);
    }
    
    private String buildFilterExpr(String subjectCode, String stageCode) {
        return String.format(
            "subject_code == \"%s\" && stage_code == \"%s\"",
            subjectCode, stageCode
        );
    }
}
```

### 6.4 知识图谱增强

```java
/**
 * 检索后知识图谱增强
 * 补充用户可能需要的前置知识和关联知识
 */
@Service
public class GraphEnhancementService {
    
    /**
     * 为检索结果补充图谱上下文
     */
    public EnhancedResult enhance(RetrievalResult retrieval, UserContext context) {
        // 收集所有命中的知识点 ID
        Set<Long> hitPointIds = retrieval.getItems().stream()
            .map(RecallItem::getKnowledgePointId)
            .filter(Objects::nonNull)
            .collect(Collectors.toSet());
        
        // 查询前置知识点（最多补充 3 个，避免 Prompt 过长）
        Set<KnowledgePoint> prerequisites = new LinkedHashSet<>();
        for (Long pointId : hitPointIds) {
            List<KnowledgeEdge> edges = knowledgeEdgeRepository
                .findByToPointIdAndEdgeType(pointId, "prerequisite");
            for (KnowledgeEdge edge : edges) {
                if (prerequisites.size() >= 3) break;
                // 过滤掉用户已掌握的知识点
                if (!isMastered(edge.getFromPointId(), context.getUserId())) {
                    prerequisites.add(knowledgePointRepository.findById(edge.getFromPointId()).orElse(null));
                }
            }
        }
        
        // 查询易混淆知识点（如果有）
        Set<KnowledgePoint> confusables = new LinkedHashSet<>();
        for (Long pointId : hitPointIds) {
            List<KnowledgeEdge> edges = knowledgeEdgeRepository
                .findByFromPointIdAndEdgeType(pointId, "similar");
            for (KnowledgeEdge edge : edges) {
                if (confusables.size() >= 2) break;
                confusables.add(knowledgePointRepository.findById(edge.getToPointId()).orElse(null));
            }
        }
        
        return EnhancedResult.builder()
            .retrievalItems(retrieval.getItems())
            .prerequisites(prerequisites.stream().filter(Objects::nonNull).collect(Collectors.toList()))
            .confusables(confusables.stream().filter(Objects::nonNull).collect(Collectors.toList()))
            .build();
    }
    
    /**
     * 检查用户是否已掌握某知识点
     * 基于学情分析中的掌握度数据
     */
    private boolean isMastered(Long pointId, Long userId) {
        MasteryLevel mastery = masteryService.getMasteryLevel(userId, pointId);
        return mastery != null && mastery.getScore() >= 0.8;
    }
}
```

### 6.5 Prompt 组装

```java
/**
 * RAG Prompt 组装器
 * 将检索结果组装为结构化 Prompt
 */
@Service
public class RAGPromptAssembler {
    
    @Value("${rag.prompt.max-context-tokens:3000}")
    private int maxContextTokens;
    
    /**
     * 组装 RAG Prompt
     */
    public String assemble(EnhancedResult enhanced, ParsedQuery query, 
                           UserContext context, String sceneTemplate) {
        StringBuilder prompt = new StringBuilder();
        
        // 1. 系统角色（根据学段选择模板）
        prompt.append(getRolePrompt(context.getStageCode())).append("\n\n");
        
        // 2. 参考知识（从检索结果中按 token 预算选取）
        prompt.append("## 参考知识\n\n");
        int usedTokens = 0;
        
        for (RecallItem item : enhanced.getRetrievalItems()) {
            String block = formatKnowledgeBlock(item);
            int blockTokens = estimateTokens(block);
            if (usedTokens + blockTokens > maxContextTokens) {
                break; // 超出 token 预算，截断
            }
            prompt.append(block).append("\n");
            usedTokens += blockTokens;
        }
        
        // 3. 前置知识提醒（如果有）
        if (!enhanced.getPrerequisites().isEmpty()) {
            prompt.append("## 前置知识提醒\n");
            prompt.append("学生可能需要先了解以下知识点：\n");
            for (KnowledgePoint p : enhanced.getPrerequisites()) {
                prompt.append("- ").append(p.getName()).append("\n");
            }
            prompt.append("\n");
        }
        
        // 4. 易混淆提醒（如果有）
        if (!enhanced.getConfusables().isEmpty()) {
            prompt.append("## 易混淆概念\n");
            for (KnowledgePoint c : enhanced.getConfusables()) {
                prompt.append("- ").append(c.getName()).append("\n");
            }
            prompt.append("\n");
        }
        
        // 5. 场景特定指令（解题/作文/背诵 等）
        prompt.append("## 指导原则\n");
        prompt.append(getSceneInstruction(sceneTemplate, context)).append("\n\n");
        
        // 6. 用户问题
        prompt.append("## 学生问题\n");
        prompt.append(query.getRawQuery()).append("\n");
        
        return prompt.toString();
    }
    
    private String formatKnowledgeBlock(RecallItem item) {
        return String.format("【%s·%s】%s",
            item.getSourceType(),
            item.getKnowledgePointName() != null ? item.getKnowledgePointName() : "综合",
            item.getContentText()
        );
    }
    
    /**
     * 学段对应角色提示词
     */
    private String getRolePrompt(String stageCode) {
        switch (stageCode) {
            case "K":
                return "你是一位温柔的启蒙老师，正在跟幼儿园/小学低年级小朋友聊天。"
                     + "用最简单的语言，多举生活中的例子，多用鼓励的语气。";
            case "PRIMARY":
                return "你是一位耐心的小学老师，正在辅导小学生。"
                     + "语言简洁明了，每步讲解不超过2句话，多用比喻。";
            case "JUNIOR":
                return "你是一位专业的初中辅导老师。"
                     + "讲解要有条理，先分析再解答，注重方法总结。";
            case "SENIOR":
                return "你是一位经验丰富的高中辅导老师。"
                     + "注重考点分析、方法归纳和易错点提醒，讲解严谨完整。";
            default:
                return "你是一位专业的学习辅导老师。";
        }
    }
}
```

### 6.6 检索 API

```
POST /api/v1/knowledge/retrieve
Content-Type: application/json
Authorization: Bearer <token>

Request:
{
    "query": "一元二次方程求根公式是怎么推导的？",
    "subject_code": "MATH",
    "stage_code": "JUNIOR",
    "grade": 9,
    "textbook_id": 15,
    "chapter_id": 237,
    "scene": "tutoring",
    "top_k": 8,
    "include_graph_context": true
}

Response 200:
{
    "code": 0,
    "data": {
        "query_id": "qry_8f3a2b1c",
        "parsed_query": {
            "keywords": ["一元二次方程", "求根公式", "推导"],
            "matched_knowledge_points": [
                {"id": 5823, "name": "一元二次方程的解法", "confidence": 0.95}
            ],
            "expanded_queries": [
                "一元二次方程求根公式推导",
                "配方法解一元二次方程",
                "一元二次方程公式法"
            ]
        },
        "results": [
            {
                "chunk_id": 100251,
                "source_type": "textbook",
                "knowledge_point_name": "一元二次方程的解法·公式法",
                "content_preview": "一元二次方程 ax²+bx+c=0 的求根公式...",
                "relevance_score": 0.94,
                "recall_source": "vector"
            }
        ],
        "graph_context": {
            "prerequisites": [
                {"id": 5820, "name": "配方法"}
            ],
            "confusables": []
        },
        "retrieval_stats": {
            "vector_hits": 18,
            "bm25_hits": 12,
            "exact_hits": 3,
            "final_count": 8,
            "latency_ms": 145
        }
    }
}
```

---

## 7. 知识图谱服务

### 7.1 知识点树形结构查询

```java
/**
 * 获取某学科某学段下的知识点树
 * 用于同步课堂的章节-知识点导航、考点梳理等
 */
@GetMapping("/api/v1/knowledge/points/tree")
public KnowledgePointTree getKnowledgeTree(
    @RequestParam String subjectCode,
    @RequestParam String stageCode,
    @RequestParam(required = false) Long textbookId,
    @RequestParam(required = false) Long chapterId
) {
    // 查询该范围下的所有知识点
    List<KnowledgePoint> points;
    if (chapterId != null) {
        // 通过 chapter_knowledge_mapping 反查
        points = knowledgePointRepository.findByChapterMapping(
            textbookId, chapterId);
    } else {
        points = knowledgePointRepository.findBySubjectAndStage(
            subjectCode, stageCode);
    }
    
    // 构建树形结构
    return buildTree(points);
}
```

### 7.2 学习路径推导

```java
/**
 * 基于知识图谱推导学习路径
 * 从当前知识点出发，沿着 prerequisite 关系找到最短学习路径
 */
public LearningPath deriveLearningPath(Long targetPointId, Long userId) {
    List<Long> unmasteredPrerequisites = new ArrayList<>();
    Set<Long> visited = new HashSet<>();
    Queue<Long> queue = new LinkedList<>();
    queue.add(targetPointId);
    visited.add(targetPointId);
    
    // BFS 遍历前置依赖
    while (!queue.isEmpty()) {
        Long current = queue.poll();
        
        List<KnowledgeEdge> prereqs = knowledgeEdgeRepository
            .findByToPointIdAndEdgeType(current, "prerequisite");
        
        for (KnowledgeEdge edge : prereqs) {
            Long prereqId = edge.getFromPointId();
            if (visited.add(prereqId)) {
                // 只收集未掌握的前置知识点
                if (!isMastered(prereqId, userId)) {
                    unmasteredPrerequisites.add(prereqId);
                    queue.add(prereqId);
                }
            }
        }
    }
    
    // 按 level 排序（低 level 先学）+ 拓扑排序保证依赖顺序
    return buildOrderedPath(unmasteredPrerequisites, targetPointId);
}
```

### 7.3 知识图谱 API

```
# 获取知识点详情及关联关系
GET /api/v1/knowledge/points/{pointId}
Response: {
    "code": 0,
    "data": {
        "id": 5823,
        "name": "一元二次方程的解法",
        "level": 3,
        "path": "/数学/初中/方程与不等式/一元二次方程/",
        "description": "...",
        "parents": [{"id": 5819, "name": "一元二次方程", "edge_type": "contains"}],
        "children": [
            {"id": 5824, "name": "公式法", "edge_type": "contains"},
            {"id": 5825, "name": "因式分解法", "edge_type": "contains"},
            {"id": 5826, "name": "配方法", "edge_type": "contains"}
        ],
        "prerequisites": [
            {"id": 5815, "name": "因式分解", "edge_type": "prerequisite"},
            {"id": 5818, "name": "平方根", "edge_type": "prerequisite"}
        ],
        "related": [
            {"id": 5830, "name": "二次函数", "edge_type": "related"}
        ],
        "stats": {
            "chunk_count": 45,
            "question_count": 230,
            "exam_weight": 85.0
        }
    }
}

# 搜索知识点
GET /api/v1/knowledge/points/search?keyword=一元二次&subject=MATH&stage=JUNIOR
Response: {
    "code": 0,
    "data": {
        "items": [
            {"id": 5819, "name": "一元二次方程", "level": 2, "path": "/数学/初中/方程与不等式/"},
            {"id": 5823, "name": "一元二次方程的解法", "level": 3, "path": "/数学/初中/方程与不等式/一元二次方程/"}
        ]
    }
}

# 获取学习路径
GET /api/v1/knowledge/points/{pointId}/learning-path?userId=10086
Response: {
    "code": 0,
    "data": {
        "target": {"id": 5823, "name": "一元二次方程的解法"},
        "path": [
            {"id": 5818, "name": "平方根", "status": "unmastered", "order": 1},
            {"id": 5815, "name": "因式分解", "status": "unmastered", "order": 2},
            {"id": 5826, "name": "配方法", "status": "unmastered", "order": 3},
            {"id": 5823, "name": "一元二次方程的解法", "status": "target", "order": 4}
        ]
    }
}
```

---

## 8. 一致性与同步机制

### 8.1 数据一致性保障

```
写入路径:
  内容后台 → IngestionService → MySQL (knowledge_chunk) 
                              → MQ (embedding task)
                              → ES (异步索引)

向量路径:
  MQ → EmbeddingWorker → Embedding API → Milvus
                       → MySQL (更新 embedding_status)

同步校验:
  KnowledgeSyncJob (每小时)
    · 校验 MySQL vs ES 文档数一致性
    · 校验 MySQL vs Milvus 向量数一致性
    · 修复不一致的记录（重新索引/嵌入）
```

### 8.2 定时同步 Job

```java
/**
 * 数据一致性校验与修复 Job
 */
@Scheduled(fixedRate = 3600_000) // 每小时
public void syncConsistencyCheck() {
    // 1. 统计 MySQL 中启用的 chunk 数量
    long mysqlCount = chunkRepository.countByStatusAndIsLatest(1, 1);
    
    // 2. 统计 Milvus 中向量数量
    long milvusCount = milvusClient.count(activeCollection);
    
    // 3. 统计 ES 中文档数量
    long esCount = esClient.count("knowledge_chunks");
    
    log.info("Consistency check: MySQL={}, Milvus={}, ES={}", 
             mysqlCount, milvusCount, esCount);
    
    // 4. 如果 Milvus 缺失向量，找出未嵌入的 chunk 重新入队
    if (milvusCount < mysqlCount) {
        List<KnowledgeChunk> missingEmbeddings = chunkRepository
            .findByEmbeddingStatusAndIsLatest(EmbeddingStatus.PENDING, 1, 1000);
        
        for (KnowledgeChunk chunk : missingEmbeddings) {
            mqProducer.sendEmbeddingTask(chunk.getId());
        }
        log.warn("Found {} chunks missing embeddings, re-queued", missingEmbeddings.size());
    }
    
    // 5. 如果 ES 缺失文档，触发增量同步
    if (esCount < mysqlCount) {
        esSyncService.syncRecentChanges(Duration.ofHours(2));
    }
}
```

---

## 9. 缓存策略

### 9.1 缓存分层

| 层级 | 存储内容 | TTL | 更新策略 |
|------|---------|-----|---------|
| L1 - 本地缓存 (Caffeine) | 热门知识点详情、学科配置 | 5 min | 写入时失效 |
| L2 - Redis | 检索结果缓存、向量 ID→内容映射 | 30 min | LRU 淘汰 |
| L3 - MySQL + Milvus | 全量数据 | 持久 | 主数据源 |

### 9.2 缓存 Key 设计

```
# 知识点详情
knowledge:point:{pointId}                         → KnowledgePoint JSON, TTL=5min

# 检索结果缓存（基于 query hash）
knowledge:retrieve:{sha256(query+subject+stage)}  → List<RecallItem>, TTL=30min

# 知识点树（整棵树缓存）
knowledge:tree:{subjectCode}:{stageCode}          → Tree JSON, TTL=10min

# Embedding 缓存（避免重复嵌入）
knowledge:embedding:{sha256(text)}                 → float[], TTL=24h
```

```java
/**
 * 检索结果缓存
 * 相同查询在一定时间内直接返回缓存结果
 */
@Cacheable(value = "knowledge-retrieve", key = "T(java.util.Base64).getUrlEncoder().encodeToString(T(java.security.MessageDigest).getInstance('SHA-256').digest(#request.query.bytes)) + ':' + #request.subjectCode + ':' + #request.stageCode",
           unless = "#result.data.retrievalStats.latencyMs < 50") // 太快的查询不需要缓存
public RetrievalResponse retrieve(RetrievalRequest request) {
    // ... 实际检索逻辑
}
```

---

## 10. 错误处理

### 10.1 错误码定义

| 错误码 | 含义 | HTTP 状态 | 处理建议 |
|--------|------|----------|---------|
| `KN_001` | 向量检索超时 | 200 (降级) | 降级到 BM25 单路检索 |
| `KN_002` | ES 全文检索失败 | 200 (降级) | 降级到向量单路检索 |
| `KN_003` | Embedding API 失败 | 202 | 异步重试，最多 3 次 |
| `KN_004` | Milvus 写入失败 | 500 | 记录失败，SyncJob 修复 |
| `KN_005` | 知识点不存在 | 404 | 返回空结果 |
| `KN_006` | 切片内容为空或过短 | 400 | 跳过该片段 |
| `KN_007` | 内容重复 | 200 | 跳过，返回 duplicates_skipped |
| `KN_008` | 检索服务全面降级 | 200 | 跳过 RAG，直接 LLM 对话 |

### 10.2 降级策略

```java
/**
 * 检索降级策略
 */
@Service
public class RetrievalFallback {
    
    /**
     * 降级策略：
     * Level 0: 多路召回 + 图谱增强 (正常)
     * Level 1: 仅向量检索（ES 故障）
     * Level 2: 仅 BM25 检索（Milvus 故障）
     * Level 3: 跳过 RAG，直接 LLM（全面故障）
     */
    public String retrieveWithFallback(ParsedQuery query, UserContext context) {
        try {
            // 尝试完整的多路召回
            return fullRetrieval(query, context);
        } catch (MilvusException e) {
            log.warn("Milvus unavailable, falling back to BM25 only", e);
            try {
                return bm25OnlyRetrieval(query, context);
            } catch (ElasticsearchException e2) {
                log.error("Both Milvus and ES unavailable, skipping RAG", e2);
                return null; // 返回 null 表示跳过 RAG
            }
        }
    }
}
```

---

## 11. 监控与指标

### 11.1 关键监控指标

```
# 检索性能
knowledge_retrieve_latency_ms          -- 检索延迟分布 (P50/P95/P99)
knowledge_retrieve_recall_paths        -- 各路召回命中数 (vector/bm25/exact)

# 向量管道
knowledge_embedding_pending_count      -- 待嵌入 chunk 积压数
knowledge_embedding_latency_ms         -- 单次 embedding 延迟
knowledge_embedding_batch_size         -- 每批嵌入数量
knowledge_embedding_error_rate         -- 嵌入失败率

# 数据一致性
knowledge_sync_mysql_milvus_gap        -- MySQL vs Milvus 数量差
knowledge_sync_mysql_es_gap            -- MySQL vs ES 数量差
knowledge_chunk_orphan_count           -- 无效/孤立 chunk 数

# 检索质量
knowledge_retrieve_zero_result_rate    -- 零结果率
knowledge_retrieve_avg_relevance       -- 平均相关性得分
knowledge_rag_usage_rate               -- RAG 使用率（vs 纯 LLM）
```

### 11.2 告警规则

| 告警 | 条件 | 级别 |
|------|------|------|
| 向量检索延迟过高 | P95 > 500ms 持续 5 分钟 | WARNING |
| 嵌入任务积压 | pending_count > 10000 持续 30 分钟 | WARNING |
| 嵌入失败率过高 | error_rate > 5% 持续 10 分钟 | CRITICAL |
| 检索全面降级 | 连续 10 次降级到 BM25 | CRITICAL |
| 数据不一致 | MySQL-Milvus 差 > 1000 | WARNING |
| 零结果率过高 | zero_result_rate > 20% 持续 1 小时 | WARNING |

---

## 12. 部署架构

### 12.1 存储资源规划（初期）

| 组件 | 规格 | 说明 |
|------|------|------|
| MySQL (knowledge 库) | 4C8G × 2 (主从) | 知识点、chunk 元数据 |
| Milvus | 8C16G × 2 (集群) | 向量存储，预计 50 万向量 ≈ 4GB |
| Elasticsearch | 4C8G × 3 (集群) | 全文检索索引 |
| Redis | 4C8G × 2 (哨兵) | 缓存 |

### 12.2 检索服务部署

```yaml
# RetrievalService 部署配置
retrieval-service:
  replicas: 3                    # 3 副本
  resources:
    requests: { cpu: "2", memory: "4Gi" }
    limits:   { cpu: "4", memory: "8Gi" }
  
  # Milvus 连接池
  milvus:
    pool-size: 10
    connect-timeout: 3000
    search-timeout: 500          # 检索超时 500ms
  
  # ES 连接池
  elasticsearch:
    pool-size: 5
    connect-timeout: 2000
    search-timeout: 500
  
  # 缓存配置
  cache:
    caffeine-max-size: 10000
    redis-ttl: 1800              # 30 min
  
  # 降级配置
  fallback:
    vector-timeout-ms: 500
    bm25-timeout-ms: 500
    total-timeout-ms: 1000
    enable-level3-fallback: true  # 允许跳过 RAG 直接 LLM
```

---

## 13. 与其他模块的交互

### 13.1 被依赖关系

| 调用方 | 场景 | 调用接口 |
|--------|------|---------|
| AI 智能辅导 | RAG 增强问答 | `POST /knowledge/retrieve` |
| 拍照搜题 | 题目知识点匹配 | `GET /knowledge/points/search` |
| 同步课堂 | 章节-知识点目录 | `GET /knowledge/points/tree` |
| 考点梳理 | 考点清单 + 知识图谱 | `GET /knowledge/points/{id}` + 学习路径 |
| 学习规划 | 生成学习路径 | `GET /knowledge/points/{id}/learning-path` |
| 错题整理 | 错题知识点关联 | `GET /knowledge/points/{id}` |
| 学情分析 | 知识点掌握度聚合 | `GET /knowledge/points/tree` |
| 内容后台 | 内容入库 | `POST /knowledge/chunks/batch` |

### 13.2 数据流图

```
内容后台 ──入库──→ IngestionService ──写入──→ MySQL
                       │                       │
                       ├──发MQ──→ EmbeddingWorker ──嵌入──→ Milvus
                       │                                         ▲
                       └──索引──→ ES                             │
                                                                 │
AI辅导服务 ──检索请求──→ RetrievalService ──向量检索──→ Milvus ──┘
                                │                    ──BM25──→ ES
                                │                    ──精确──→ MySQL
                                │
                                └──RAG结果──→ Prompt组装 ──→ LLM
```

---

## 14. 扩展性设计

### 14.1 新学科接入

新增学科时（如信息技术、通用技术）：

```
1. 在 knowledge_point 表中创建该学科的知识点树
2. 录入教材章节映射
3. 内容入库 → 自动触发切片和嵌入
4. 无需修改检索服务代码（基于 subject_code 过滤）
```

### 14.2 新教材版本适配

```
1. 新建 Textbook 记录
2. 新建 Chapter 目录
3. 通过 chapter_knowledge_mapping 映射到已有知识点
4. （大部分知识点跨版本共用，仅章节结构不同）
```

### 14.3 多语言支持

```
1. knowledge_chunk 增加 language 字段
2. 检索时按 language 过滤
3. 英文内容使用 bge-m3 模型嵌入（支持多语言）
4. 为英文内容创建独立 Milvus Collection（不同 embedding 维度）
```

---

## 15. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-05-19 | 初始版本：完整 RAG 管道、知识图谱、检索服务、部署方案 |
