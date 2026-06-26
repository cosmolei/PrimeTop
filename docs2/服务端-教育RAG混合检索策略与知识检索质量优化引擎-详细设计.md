# 教育RAG混合检索策略与知识检索质量优化引擎 - 详细设计

## 1. 概述

### 1.1 模块定位

本模块是 PrimeTop AI 辅导能力的核心检索增强层，负责在用户提问后从教育知识库中高精度、低延迟地召回最相关的教材内容、知识点、题目解析和考点说明，为大模型生成提供高质量上下文。

本模块在现有 `RAG与知识库系统` 基础架构之上，聚焦于**检索策略优化、混合检索、质量评估与持续调优**，是连接知识库存储与 AI 生成引擎之间的关键中间层。

### 1.2 核心职责

| 职责 | 说明 |
| --- | --- |
| 查询理解与改写 | 对学生原始提问进行意图识别、关键词提取、查询扩展和改写 |
| 混合检索执行 | 融合稠密向量检索、稀疏关键词检索和结构化过滤的多路召回 |
| 检索结果重排 | 使用交叉编码器对召回结果进行精排，提升 Top-K 精度 |
| 上下文组装 | 将检索结果按 token 预算、多样性和教学逻辑组装为最终 Prompt 上下文 |
| 质量评估 | 对每次检索结果进行实时质量打分和离线质量分析 |
| 检索缓存 | 对高频查询的检索结果进行缓存，降低延迟和向量库压力 |
| 策略 A/B 测试 | 支持多套检索策略并行运行和效果对比 |

### 1.3 依赖关系

```
用户提问
    │
    ▼
┌─────────────────────────┐
│  查询理解与改写服务      │ ← 依赖: NLP模型、学科分类服务
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  混合检索执行器          │ ← 依赖: 向量数据库(Milvus/pgvector)、
│  (Dense + Sparse +      │          Elasticsearch、结构化过滤服务
│   Structured)           │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  重排序器 (Reranker)     │ ← 依赖: Cross-Encoder模型
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  上下文组装器            │ ← 依赖: Token计量服务、教材结构服务
└───────────┬─────────────┘
            │
            ▼
      AI 大模型生成
```

**上游调用方：** AI 对话引擎、拍题答疑服务、同步课堂问答

**下游依赖：**
- 向量数据库（Milvus 集群 / pgvector）
- Elasticsearch / OpenSearch（全文检索）
- Redis 集群（检索缓存）
- Cross-Encoder 重排模型服务
- 教材知识库结构化数据（MySQL）

---

## 2. 数据模型

### 2.1 核心实体定义

#### 2.1.1 检索查询记录 (RetrievalQuery)

```java
/**
 * 检索查询记录 - 记录每次RAG检索请求的完整信息
 */
@Data
@TableName("rag_retrieval_query")
public class RetrievalQuery {
    /** 主键ID */
    private Long id;
    
    /** 查询唯一追踪ID（用于全链路追踪） */
    private String traceId;
    
    /** 用户ID */
    private Long userId;
    
    /** 学生档案快照（年级、学段、教材版本） */
    private String profileSnapshot;
    
    /** 原始查询文本 */
    private String rawQuery;
    
    /** 改写后查询文本 */
    private String rewrittenQuery;
    
    /** 检索意图标签：EXPLAIN / SOLVE / COMPARE / REVIEW / PRACTICE */
    private String intent;
    
    /** 学科 */
    private String subject;
    
    /** 检索策略版本号 */
    private String strategyVersion;
    
    /** 召回文档总数 */
    private Integer totalCandidates;
    
    /** 最终送入LTM的文档数 */
    private Integer contextDocCount;
    
    /** 检索总耗时(ms) */
    private Long retrievalCostMs;
    
    /** 缓存命中标记 */
    private Boolean cacheHit;
    
    /** 检索质量评分（0-100） */
    private Double qualityScore;
    
    /** 用户反馈：有用/无用（若用户点击了反馈按钮） */
    private String userFeedback;
    
    /** 创建时间 */
    private LocalDateTime createdAt;
}
```

#### 2.1.2 检索文档块 (RetrievalChunk)

```java
/**
 * 检索文档块 - 知识库中每条可被检索的内容单元
 */
@Data
@TableName("rag_knowledge_chunk")
public class KnowledgeChunk {
    /** 主键ID */
    private Long id;
    
    /** 知识库文档类型：TEXTBOOK / KNOWLEDGE_POINT / QUESTION / ANALYSIS / EXAM_POINT */
    private String docType;
    
    /** 关联实体ID（教材章节ID/知识点ID/题目ID等） */
    private Long entityId;
    
    /** 学科 */
    private String subject;
    
    /** 学段 */
    private String stage;
    
    /** 教材版本 */
    private String textbookVersion;
    
    /** 年级 */
    private String gradeLevel;
    
    /** 章节ID路径（如 "1.2.3"） */
    private String chapterPath;
    
    /** 知识点ID列表（JSON数组） */
    private String knowledgePointIds;
    
    /** 原始文本内容 */
    private String content;
    
    /** 分块文本（若内容过长则按语义切块） */
    private String chunkText;
    
    /** 块在原文中的偏移量 */
    private Integer chunkOffset;
    
    /** 稠密向量（嵌入模型输出） */
    private float[] denseVector;
    
    /** 稀疏向量（BM25/TF-IDF权重） */
    private String sparseVector;
    
    /** 内容难度等级（1-12，对应教材年级） */
    private Integer difficultyLevel;
    
    /** 布鲁姆认知层级 */
    private String bloomLevel;
    
    /** 内容状态：ACTIVE / DEPRECATED / UNDER_REVIEW */
    private String status;
    
    /** 质量评分（内容质量） */
    private Double contentQualityScore;
    
    /** 创建时间 */
    private LocalDateTime createdAt;
    
    /** 更新时间 */
    private LocalDateTime updatedAt;
}
```

#### 2.1.3 检索策略配置 (RetrievalStrategy)

```java
/**
 * 检索策略配置 - 支持多套策略并行A/B测试
 */
@Data
@TableName("rag_retrieval_strategy")
public class RetrievalStrategy {
    /** 主键ID */
    private Long id;
    
    /** 策略名称 */
    private String name;
    
    /** 策略版本号 */
    private String version;
    
    /** 是否激活 */
    private Boolean active;
    
    /** 灰度比例（0-100） */
    private Integer rolloutPercent;
    
    /** 稠密检索权重（0-1） */
    private Double denseWeight;
    
    /** 稀疏检索权重（0-1） */
    private Double sparseWeight;
    
    /** 结构化过滤权重（0-1） */
    private Double structuredWeight;
    
    /** 第一阶段召回数量 */
    private Integer firstStageK;
    
    /** 重排后保留数量 */
    private Integer finalStageK;
    
    /** 是否启用查询改写 */
    private Boolean enableQueryRewrite;
    
    /** 是否启用缓存 */
    private Boolean enableCache;
    
    /** Token预算上限 */
    private Integer tokenBudget;
    
    /** 多样性惩罚因子（MMR lambda） */
    private Double mmrLambda;
    
    /** 重排模型名称 */
    private String rerankerModel;
    
    /** 嵌入模型名称 */
    private String embeddingModel;
    
    /** 策略配置JSON（完整参数） */
    private String configJson;
    
    /** 创建时间 */
    private LocalDateTime createdAt;
}
```

### 2.2 数据库表结构

#### 2.2.1 rag_retrieval_query 表

```sql
CREATE TABLE rag_retrieval_query (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    trace_id        VARCHAR(64) NOT NULL COMMENT '查询追踪ID',
    user_id         BIGINT NOT NULL COMMENT '用户ID',
    profile_snapshot JSON COMMENT '学生档案快照',
    raw_query       TEXT NOT NULL COMMENT '原始查询',
    rewritten_query TEXT COMMENT '改写后查询',
    intent          VARCHAR(32) COMMENT '检索意图',
    subject         VARCHAR(16) COMMENT '学科',
    strategy_version VARCHAR(32) COMMENT '策略版本',
    total_candidates INT DEFAULT 0 COMMENT '候选文档数',
    context_doc_count INT DEFAULT 0 COMMENT '上下文文档数',
    retrieval_cost_ms BIGINT DEFAULT 0 COMMENT '检索耗时',
    cache_hit       TINYINT(1) DEFAULT 0 COMMENT '缓存命中',
    quality_score   DECIMAL(5,2) COMMENT '质量评分',
    user_feedback   VARCHAR(16) COMMENT '用户反馈',
    created_at      DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
    
    INDEX idx_user_time (user_id, created_at),
    INDEX idx_trace (trace_id),
    INDEX idx_strategy (strategy_version),
    INDEX idx_quality (quality_score)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RAG检索查询记录';
```

#### 2.2.2 rag_knowledge_chunk 表

```sql
CREATE TABLE rag_knowledge_chunk (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    doc_type            VARCHAR(32) NOT NULL COMMENT '文档类型',
    entity_id           BIGINT NOT NULL COMMENT '关联实体ID',
    subject             VARCHAR(16) NOT NULL COMMENT '学科',
    stage               VARCHAR(16) NOT NULL COMMENT '学段',
    textbook_version    VARCHAR(64) COMMENT '教材版本',
    grade_level         VARCHAR(16) COMMENT '年级',
    chapter_path        VARCHAR(128) COMMENT '章节路径',
    knowledge_point_ids JSON COMMENT '知识点ID列表',
    content             MEDIUMTEXT NOT NULL COMMENT '原始内容',
    chunk_text          TEXT NOT NULL COMMENT '分块文本',
    chunk_offset        INT DEFAULT 0 COMMENT '块偏移',
    sparse_vector       JSON COMMENT '稀疏向量权重',
    difficulty_level    INT COMMENT '难度等级',
    bloom_level         VARCHAR(16) COMMENT '布鲁姆认知层级',
    status              VARCHAR(16) DEFAULT 'ACTIVE',
    content_quality_score DECIMAL(5,2),
    created_at          DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
    updated_at          DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    
    INDEX idx_entity (doc_type, entity_id),
    INDEX idx_subject_stage (subject, stage),
    INDEX idx_status (status),
    INDEX idx_textbook (textbook_version, grade_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RAG知识块';
-- 注：稠密向量存储在 Milvus 向量数据库中，通过 entity_id 关联
```

#### 2.2.3 rag_retrieval_strategy 表

```sql
CREATE TABLE rag_retrieval_strategy (
    id                BIGINT PRIMARY KEY AUTO_INCREMENT,
    name              VARCHAR(128) NOT NULL COMMENT '策略名称',
    version           VARCHAR(32) NOT NULL COMMENT '版本号',
    active            TINYINT(1) DEFAULT 1,
    rollout_percent   INT DEFAULT 100 COMMENT '灰度比例',
    dense_weight      DECIMAL(3,2) DEFAULT 0.50,
    sparse_weight     DECIMAL(3,2) DEFAULT 0.30,
    structured_weight DECIMAL(3,2) DEFAULT 0.20,
    first_stage_k     INT DEFAULT 50 COMMENT '第一阶段召回数',
    final_stage_k     INT DEFAULT 8 COMMENT '最终保留数',
    enable_query_rewrite TINYINT(1) DEFAULT 1,
    enable_cache      TINYINT(1) DEFAULT 1,
    token_budget      INT DEFAULT 3000 COMMENT 'Token预算',
    mmr_lambda        DECIMAL(3,2) DEFAULT 0.70 COMMENT 'MMR多样性因子',
    reranker_model    VARCHAR(128) DEFAULT 'bge-reranker-v2',
    embedding_model   VARCHAR(128) DEFAULT 'bge-large-zh-v1.5',
    config_json       JSON COMMENT '扩展配置',
    created_at        DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
    
    UNIQUE INDEX uk_version (version),
    INDEX idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RAG检索策略配置';
```

#### 2.2.4 rag_retrieval_feedback 表（检索质量标注）

```sql
CREATE TABLE rag_retrieval_feedback (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    query_id        BIGINT NOT NULL COMMENT '关联查询记录',
    chunk_id        BIGINT NOT NULL COMMENT '被标注的文档块',
    relevance_label TINYINT COMMENT '相关性标注：0不相关 1部分相关 2相关 3高度相关',
    annotator_type  VARCHAR(16) COMMENT '标注来源：USER/EXPERT/AUTO',
    annotator_id    BIGINT COMMENT '标注者ID',
    note            VARCHAR(512) COMMENT '标注备注',
    created_at      DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
    
    INDEX idx_query (query_id),
    INDEX idx_chunk (chunk_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='检索质量标注数据';
```

### 2.3 缓存策略

| 缓存层 | 存储 | TTL | 用途 |
| --- | --- | --- | --- |
| L1 查询结果缓存 | Redis | 30min | 完全相同查询的检索结果直接返回 |
| L2 嵌入向量缓存 | Redis | 24h | 查询文本的向量表示缓存 |
| L3 稀疏检索缓存 | Redis | 1h | BM25检索结果缓存 |
| 本地 LRU 缓存 | JVM | 5min | 热门查询的本地快速缓存 |

```java
/**
 * 多级检索缓存管理器
 */
@Component
public class RetrievalCacheManager {
    
    private final Cache<String, RetrievalResult> localCache = 
        Caffeine.newBuilder()
            .maximumSize(5_000)
            .expireAfterWrite(5, TimeUnit.MINUTES)
            .recordStats()
            .build();
    
    @Resource
    private RedisTemplate<String, Object> redisTemplate;
    
    private static final String L1_KEY_PREFIX = "rag:l1:";
    private static final String L2_KEY_PREFIX = "rag:l2:";
    private static final String L3_KEY_PREFIX = "rag:l3:";
    
    /**
     * 多级缓存查询
     */
    public RetrievalResult tryCache(RetrievalContext ctx) {
        String cacheKey = buildCacheKey(ctx);
        
        // L1: 本地缓存
        RetrievalResult local = localCache.getIfPresent(cacheKey);
        if (local != null) {
            local.setCacheLevel("L1_LOCAL");
            return local;
        }
        
        // L2: Redis查询结果缓存
        RetrievalResult redis = (RetrievalResult) redisTemplate
            .opsForValue().get(L1_KEY_PREFIX + cacheKey);
        if (redis != null) {
            localCache.put(cacheKey, redis); // 回填本地缓存
            redis.setCacheLevel("L2_REDIS");
            return redis;
        }
        
        return null;
    }
    
    /**
     * 写入缓存
     */
    public void putCache(RetrievalContext ctx, RetrievalResult result) {
        String cacheKey = buildCacheKey(ctx);
        localCache.put(cacheKey, result);
        redisTemplate.opsForValue().set(
            L1_KEY_PREFIX + cacheKey, 
            result, 
            30, TimeUnit.MINUTES
        );
    }
    
    /**
     * 缓存键设计：策略版本 + 学科 + 学段 + 查询归一化
     */
    private String buildCacheKey(RetrievalContext ctx) {
        return DigestUtils.md5Hex(
            ctx.getStrategyVersion() + ":" +
            ctx.getSubject() + ":" +
            ctx.getStage() + ":" +
            normalizeQuery(ctx.getRawQuery())
        );
    }
    
    /**
     * 查询归一化：去空格、去标点、转小写、同义词替换
     */
    private String normalizeQuery(String query) {
        return query.trim()
            .toLowerCase()
            .replaceAll("[\\s\\p{Punct}]+", "")
            .replaceAll("(什么是|什么叫|解释一下|讲一下|帮我理解)", "");
    }
}
```

---

## 3. API 接口设计

### 3.1 核心检索接口

#### 3.1.1 POST /api/v1/rag/retrieve

执行一次完整的混合检索请求。

**请求体：**

```json
{
  "query": "二次函数的顶点坐标怎么求",
  "userId": 100123,
  "subject": "math",
  "stage": "middle",
  "gradeLevel": "初三",
  "textbookVersion": "人教版",
  "intent": "SOLVE",
  "strategyVersion": null,
  "contextHistory": [
    {"role": "user", "content": "我在学二次函数"},
    {"role": "assistant", "content": "二次函数的一般形式是..."}
  ],
  "options": {
    "enableCache": true,
    "enableRerank": true,
    "tokenBudget": 3000,
    "excludeDocIds": []
  }
}
```

**响应体：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "traceId": "ret-20260626-abc123",
    "rewrittenQuery": "二次函数顶点坐标公式 配方法求顶点",
    "intent": "SOLVE",
    "expandedTerms": ["顶点公式", "配方法", "对称轴", "最值"],
    "candidates": [
      {
        "chunkId": 50021,
        "docType": "KNOWLEDGE_POINT",
        "entityId": 1023,
        "subject": "math",
        "score": 0.9532,
        "rerankScore": 0.8921,
        "content": "二次函数 y=ax²+bx+c (a≠0) 的顶点坐标为 (-b/2a, (4ac-b²)/4a)...",
        "knowledgePoints": ["二次函数顶点", "配方法"],
        "chapterPath": "数学/九年级上册/二次函数/顶点公式",
        "difficultyLevel": 9,
        "bloomLevel": "APPLY",
        "tokenCount": 156
      },
      {
        "chunkId": 50156,
        "docType": "QUESTION",
        "entityId": 8042,
        "subject": "math",
        "score": 0.8891,
        "rerankScore": 0.8234,
        "content": "已知二次函数 y=x²-4x+3，求其顶点坐标和对称轴...",
        "knowledgePoints": ["二次函数顶点", "对称轴"],
        "chapterPath": "数学/九年级上册/二次函数/习题",
        "difficultyLevel": 9,
        "bloomLevel": "APPLY",
        "tokenCount": 98
      }
    ],
    "contextBlock": "【教材知识】二次函数 y=ax²+bx+c...\n【典型例题】已知二次函数...",
    "totalTokens": 1280,
    "retrievalCostMs": 87,
    "cacheHit": false,
    "qualityScore": 87.5,
    "strategyVersion": "v2.3.1"
  }
}
```

#### 3.1.2 POST /api/v1/rag/feedback

提交对检索结果的反馈。

```json
{
  "traceId": "ret-20260626-abc123",
  "userId": 100123,
  "feedback": "HELPFUL",
  "badChunks": [],
  "missingContent": "我希望看到更多关于配方法的推导过程"
}
```

#### 3.1.3 GET /api/v1/rag/strategy/list

查询当前所有检索策略配置。

#### 3.1.4 PUT /api/v1/rag/strategy/{version}

更新检索策略参数（管理后台调用）。

#### 3.1.5 GET /api/v1/rag/quality/report

查询检索质量报告（支持按时间范围、学科、策略版本筛选）。

### 3.2 错误码定义

| 错误码 | 含义 | HTTP状态码 | 处理建议 |
| --- | --- | --- | --- |
| RAG_001 | 查询文本为空或过短 | 400 | 前端校验，最小3个字符 |
| RAG_002 | 嵌入模型服务不可用 | 503 | 降级到稀疏检索 |
| RAG_003 | 向量数据库连接超时 | 503 | 降级到Elasticsearch全文检索 |
| RAG_004 | 重排模型推理超时 | 504 | 跳过重排，直接返回粗排结果 |
| RAG_005 | Token预算超限（检索结果过长） | 200(警告) | 截断并标记 `truncated: true` |
| RAG_006 | 策略版本不存在 | 404 | 回退到默认策略 |
| RAG_007 | 学科/学段不支持 | 400 | 检查请求参数 |
| RAG_008 | 缓存服务不可用 | 200(降级) | 直接执行检索，不影响主流程 |

---

## 4. 业务逻辑

### 4.1 核心检索流程

```
┌──────────────────────────────────────────────────────────────────┐
│                     RAG检索完整流水线                              │
└──────────────────────────────────────────────────────────────────┘

用户查询
  │
  ├─① 查询预处理
  │   ├─ 文本清洗（去噪、纠错）
  │   ├─ 语言检测（中文/英文/混合）
  │   └─ 学科自动识别
  │
  ├─② 查询理解与改写
  │   ├─ 意图分类（EXPLAIN/SOLVE/COMPARE/REVIEW/PRACTICE）
  │   ├─ 关键词/实体提取（公式名、定理名、章节名）
  │   ├─ 查询扩展（同义词、上下位概念、相关术语）
  │   ├─ 多轮对话查询改写（结合历史消解代词、补全省略）
  │   └─ 复杂查询拆分（多子问题分解）
  │
  ├─③ 结构化过滤条件生成
  │   ├─ 学段过滤（primary/middle/high）
  │   ├─ 教材版本过滤
  │   ├─ 年级范围过滤
  │   ├─ 学科过滤
  │   └─ 难度范围过滤
  │
  ├─④ 多路并行召回（第一阶段）
  │   ├─ [Dense] 向量相似度检索 → TopK₁
  │   ├─ [Sparse] BM25全文检索 → TopK₁
  │   └─ [Structured] 知识点直接映射 → 精确匹配集
  │
  ├─⑤ 候选合并与去重
  │   ├─ 三路结果合并
  │   ├─ 基于entityId去重
  │   └─ 保留 TopK₂ 候选
  │
  ├─⑥ 重排序（第二阶段）
  │   ├─ Cross-Encoder精排打分
  │   ├─ 教学维度加权（年级匹配度、难度适配度、内容质量）
  │   └─ MMR多样性选择
  │
  ├─⑦ 上下文组装
  │   ├─ Token预算分配
  │   ├─ 内容排序优化（知识→例题→拓展）
  │   ├─ 截断与引用标记
  │   └─ 生成contextBlock
  │
  ├─⑧ 质量评估
  │   ├─ 实时质量打分
  │   ├─ 记录检索日志
  │   └─ 更新缓存
  │
  └─► 返回检索结果
```

### 4.2 查询理解与改写

#### 4.2.1 意图分类器

```java
/**
 * 检索意图分类
 */
public enum RetrievalIntent {
    EXPLAIN("概念解释、知识讲解"),
    SOLVE("解题、计算、推导"),
    COMPARE("对比、异同分析"),
    REVIEW("复习、总结、梳理"),
    PRACTICE("练习、出题、同类题"),
    CHECK("检查、批改、纠错");
}

/**
 * 意图分类器 - 基于规则+轻量模型
 */
@Component
public class IntentClassifier {
    
    // 规则模式库
    private static final Map<RetrievalIntent, List<Pattern>> INTENT_PATTERNS = Map.of(
        RetrievalIntent.EXPLAIN, List.of(
            Pattern.compile("(什么是|什么叫|解释|含义|意思|概念|定义).*"),
            Pattern.compile("(为什么|为何|原因|原理).*")
        ),
        RetrievalIntent.SOLVE, List.of(
            Pattern.compile("(怎么解|如何求|计算|求解|证明|推导).*"),
            Pattern.compile("(求|解|证明).+[＝=].+")  // 含等式的求解
        ),
        RetrievalIntent.COMPARE, List.of(
            Pattern.compile("(区别|联系|异同|对比|不同|差异).*")
        ),
        RetrievalIntent.PRACTICE, List.of(
            Pattern.compile("(出题|练习|同类题|类似题|模拟题).*")
        ),
        RetrievalIntent.CHECK, List.of(
            Pattern.compile("(对不对|是否正确|帮我看看|检查|批改).*")
        )
    );
    
    /**
     * 分类主入口
     */
    public RetrievalIntent classify(String query) {
        // 1. 优先使用规则匹配（快速路径）
        for (Map.Entry<RetrievalIntent, List<Pattern>> entry : INTENT_PATTERNS.entrySet()) {
            for (Pattern p : entry.getValue()) {
                if (p.matcher(query).find()) {
                    return entry.getKey();
                }
            }
        }
        
        // 2. 模型分类（兜底）
        return intentModel.predict(query);
    }
}
```

#### 4.2.2 查询扩展器

```java
/**
 * 查询扩展器 - 同义词、相关术语、上下位概念扩展
 */
@Component
public class QueryExpander {
    
    @Resource
    private EducationalSynonymDictionary synonymDict;  // 教育领域同义词词典
    
    @Resource
    private KnowledgeGraphService knowledgeGraphService; // 知识图谱服务
    
    /**
     * 执行查询扩展
     * @param originalQuery 原始查询
     * @param subject 学科
     * @return 扩展后的查询对象
     */
    public ExpandedQuery expand(String originalQuery, String subject) {
        ExpandedQuery result = new ExpandedQuery();
        result.setOriginal(originalQuery);
        
        // 1. 同义词扩展
        List<String> synonyms = synonymDict.findSynonyms(originalQuery, subject);
        result.setSynonyms(synonyms);
        
        // 2. 教育术语归一化
        //    "二次函数顶点" → "二次函数 + 顶点坐标 + 顶点公式"
        List<String> normalizedTerms = normalizeEducationalTerms(originalQuery, subject);
        result.setNormalizedTerms(normalizedTerms);
        
        // 3. 知识图谱关联扩展
        //    识别查询中的知识点实体，获取上下位和相关知识点
        List<KnowledgeEntity> entities = knowledgeGraphService
            .extractEntities(originalQuery, subject);
        for (KnowledgeEntity entity : entities) {
            result.addRelatedTerm(entity.getName());
            // 加入直接前置知识点
            result.addPrerequisite(
                knowledgeGraphService.getPrerequisites(entity.getId())
            );
        }
        
        // 4. 公式/符号LaTeX归一化
        //    "y=ax2+bx+c" → "y = ax^2 + bx + c"
        result.setNormalizedQuery(LatexNormalizer.normalize(originalQuery));
        
        // 5. 构建扩展查询文本（用于向量化和BM25）
        result.setExpandedText(buildExpandedText(result));
        
        return result;
    }
    
    private String buildExpandedText(ExpandedQuery eq) {
        StringBuilder sb = new StringBuilder(eq.getNormalizedQuery());
        if (!eq.getSynonyms().isEmpty()) {
            sb.append(" ").append(String.join(" ", eq.getSynonyms()));
        }
        // 加入关键相关术语（限制数量避免查询过宽）
        eq.getRelatedTerms().stream()
            .limit(5)
            .forEach(t -> sb.append(" ").append(t));
        return sb.toString();
    }
}
```

#### 4.2.3 多轮对话查询改写

```java
/**
 * 多轮对话查询改写器
 * 将依赖上下文的追问改写为独立完整的查询
 */
@Component
public class ConversationalQueryRewriter {
    
    @Resource
    private LlmClient llmClient;  // 轻量LLM客户端
    
    private static final String REWRITE_PROMPT = """
        你是一个查询改写助手。根据对话历史，将学生的最新提问改写为一个独立、完整、可检索的查询。
        
        规则：
        1. 补全省略的主语和宾语
        2. 解析代词引用（"它"、"这个"、"那个"等）
        3. 保持学生原始表达风格
        4. 如果提问已经是完整的，直接返回原文
        5. 输出格式：仅输出改写后的查询，不要任何解释
        
        对话历史：
        %s
        
        最新提问：%s
        
        改写后的查询：""";
    
    /**
     * 改写查询
     */
    public String rewrite(String currentQuery, List<ChatMessage> history) {
        if (history == null || history.isEmpty()) {
            return currentQuery;  // 无上下文，无需改写
        }
        
        // 检查是否需要改写（简单查询不改写，省Token）
        if (isSelfContained(currentQuery)) {
            return currentQuery;
        }
        
        String historyText = formatHistory(history);
        String prompt = String.format(REWRITE_PROMPT, historyText, currentQuery);
        
        try {
            String rewritten = llmClient.complete(prompt, 
                LlmModel.QWEN_TURBO,  // 使用快速模型
                Temperature.of(0.0),   // 确定性输出
                MaxTokens.of(100)
            );
            return rewritten.trim();
        } catch (Exception e) {
            log.warn("查询改写失败，使用原始查询: {}", e.getMessage());
            return currentQuery;  // 失败降级
        }
    }
    
    /**
     * 判断查询是否自包含（无需上下文即可理解）
     */
    private boolean isSelfContained(String query) {
        // 不含代词且长度足够
        return !query.matches(".*(它|这个|那个|这种|这类|上面|前面|刚才).*") 
            && query.length() >= 8;
    }
}
```

### 4.3 混合检索执行器

#### 4.3.1 多路并行检索

```java
/**
 * 混合检索执行器
 * 协调 Dense、Sparse、Structured 三路检索并行执行
 */
@Component
public class HybridRetrievalExecutor {
    
    @Resource
    private DenseRetrievalService denseService;      // 向量检索
    
    @Resource
    private SparseRetrievalService sparseService;     // BM25检索
    
    @Resource
    private StructuredRetrievalService structuredService; // 结构化检索
    
    @Resource
    private RetrievalStrategyService strategyService;
    
    /**
     * 执行混合检索
     */
    public HybridRetrievalResult retrieve(RetrievalContext ctx) {
        RetrievalStrategy strategy = ctx.getStrategy();
        int firstStageK = strategy.getFirstStageK();
        
        // 构建结构化过滤条件
        MetadataFilter filter = MetadataFilter.builder()
            .subject(ctx.getSubject())
            .stage(ctx.getStage())
            .gradeLevel(ctx.getGradeLevel())
            .textbookVersion(ctx.getTextbookVersion())
            .status("ACTIVE")
            .build();
        
        // 三路并行召回
        CompletableFuture<List<RetrievalCandidate>> denseFuture = 
            CompletableFuture.supplyAsync(() -> 
                denseService.search(
                    ctx.getExpandedQuery().getExpandedText(),
                    filter,
                    firstStageK
                ),
                retrievalThreadPool
            ).exceptionally(ex -> {
                log.error("稠密检索失败，降级跳过", ex);
                metrics.counter("rag.dense.failure").increment();
                return Collections.emptyList();
            });
        
        CompletableFuture<List<RetrievalCandidate>> sparseFuture = 
            CompletableFuture.supplyAsync(() -> 
                sparseService.search(
                    ctx.getExpandedQuery().getExpandedText(),
                    filter,
                    firstStageK
                ),
                retrievalThreadPool
            ).exceptionally(ex -> {
                log.error("稀疏检索失败，降级跳过", ex);
                metrics.counter("rag.sparse.failure").increment();
                return Collections.emptyList();
            });
        
        CompletableFuture<List<RetrievalCandidate>> structuredFuture = 
            CompletableFuture.supplyAsync(() -> 
                structuredService.search(
                    ctx.getExpandedQuery().getRelatedTerms(),
                    ctx.getIntent(),
                    filter,
                    firstStageK / 2  // 结构化检索召回量减半
                ),
                retrievalThreadPool
            ).exceptionally(ex -> {
                log.error("结构化检索失败，降级跳过", ex);
                return Collections.emptyList();
            });
        
        // 等待全部完成（设置超时）
        try {
            CompletableFuture.allOf(denseFuture, sparseFuture, structuredFuture)
                .get(2, TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            log.warn("部分检索路超时，使用已完成的结果");
            metrics.counter("rag.retrieval.timeout").increment();
        } catch (Exception e) {
            log.error("检索执行异常", e);
        }
        
        // 合并三路结果
        List<RetrievalCandidate> merged = mergeCandidates(
            denseFuture.getNow(Collections.emptyList()),
            sparseFuture.getNow(Collections.emptyList()),
            structuredFuture.getNow(Collections.emptyList()),
            strategy
        );
        
        return HybridRetrievalResult.builder()
            .candidates(merged)
            .denseCount(denseFuture.getNow(Collections.emptyList()).size())
            .sparseCount(sparseFuture.getNow(Collections.emptyList()).size())
            .structuredCount(structuredFuture.getNow(Collections.emptyList()).size())
            .build();
    }
    
    /**
     * 多路结果合并与加权打分
     */
    private List<RetrievalCandidate> mergeCandidates(
            List<RetrievalCandidate> dense,
            List<RetrievalCandidate> sparse,
            List<RetrievalCandidate> structured,
            RetrievalStrategy strategy) {
        
        // 归一化各路分数到 [0,1]
        normalizeScores(dense);
        normalizeScores(sparse);
        normalizeScores(structured);
        
        // 按 entityId 合并
        Map<Long, RetrievalCandidate> mergedMap = new LinkedHashMap<>();
        
        // Dense 加权
        for (RetrievalCandidate c : dense) {
            c.setMergedScore(c.getScore() * strategy.getDenseWeight());
            mergedMap.put(c.getChunkId(), c);
        }
        
        // Sparse 加权 & 合并
        for (RetrievalCandidate c : sparse) {
            mergedMap.merge(c.getChunkId(), c, (existing, incoming) -> {
                existing.setMergedScore(
                    existing.getMergedScore() + incoming.getScore() * strategy.getSparseWeight()
                );
                return existing;
            });
            if (!mergedMap.containsKey(c.getChunkId())) {
                c.setMergedScore(c.getScore() * strategy.getSparseWeight());
                mergedMap.put(c.getChunkId(), c);
            }
        }
        
        // Structured 加权 & 合并
        for (RetrievalCandidate c : structured) {
            mergedMap.merge(c.getChunkId(), c, (existing, incoming) -> {
                existing.setMergedScore(
                    existing.getMergedScore() + incoming.getScore() * strategy.getStructuredWeight()
                );
                // 结构化检索命中的内容提升优先级
                existing.setStructuredHit(true);
                return existing;
            });
        }
        
        // 按合并分数排序，取 TopK
        return mergedMap.values().stream()
            .sorted(Comparator.comparingDouble(RetrievalCandidate::getMergedScore).reversed())
            .limit(strategy.getFirstStageK())
            .collect(Collectors.toList());
    }
    
    /**
     * 分数归一化到 [0,1]
     */
    private void normalizeScores(List<RetrievalCandidate> candidates) {
        if (candidates.isEmpty()) return;
        double max = candidates.stream().mapToDouble(RetrievalCandidate::getScore).max().orElse(1.0);
        double min = candidates.stream().mapToDouble(RetrievalCandidate::getScore).min().orElse(0.0);
        double range = max - min;
        if (range < 1e-6) {
            candidates.forEach(c -> c.setScore(1.0));
        } else {
            candidates.forEach(c -> c.setScore((c.getScore() - min) / range));
        }
    }
}
```

### 4.4 重排序器 (Reranker)

```java
/**
 * 交叉编码器重排服务
 * 对混合检索召回的候选项进行精细化打分重排
 */
@Component
public class CrossEncoderReranker {
    
    @Resource
    private RerankModelClient rerankClient;  // 重排模型推理服务
    
    @Resource
    private StrategyManager strategyManager;
    
    /**
     * 执行重排
     * @param query 查询文本
     * @param candidates 粗排候选列表
     * @param strategy 检索策略
     * @return 重排后的候选列表
     */
    public List<RetrievalCandidate> rerank(
            String query, 
            List<RetrievalCandidate> candidates,
            RetrievalStrategy strategy) {
        
        if (candidates.size() <= 3) {
            return candidates;  // 候选量太少无需重排
        }
        
        // 批量构建 Query-Document 对
        List<Pair<String, String>> pairs = candidates.stream()
            .map(c -> Pair.of(query, truncate(c.getContent(), 512)))
            .collect(Collectors.toList());
        
        // 批量推理
        List<Double> rerankScores;
        try {
            rerankScores = rerankClient.batchScore(
                pairs,
                strategy.getRerankerModel(),
                Duration.ofMillis(500)  // 超时500ms
            );
        } catch (TimeoutException e) {
            log.warn("重排模型超时，跳过重排使用粗排结果");
            metrics.counter("rag.rerank.timeout").increment();
            return candidates;  // 超时降级
        }
        
        // 设置重排分数
        for (int i = 0; i < candidates.size(); i++) {
            candidates.get(i).setRerankScore(rerankScores.get(i));
        }
        
        // 教学维度加权调整
        applyEducationalBoost(candidates, strategy);
        
        // MMR多样性选择
        List<RetrievalCandidate> selected = mmrSelect(
            candidates, 
            strategy.getFinalStageK(),
            strategy.getMmrLambda()
        );
        
        return selected;
    }
    
    /**
     * 教学维度加权调整
     * 在纯相关性分数基础上叠加教学适宜性因素
     */
    private void applyEducationalBoost(
            List<RetrievalCandidate> candidates,
            RetrievalStrategy strategy) {
        
        for (RetrievalCandidate c : candidates) {
            double boost = 1.0;
            
            // 年级匹配加分：完全匹配+5%，差距1级+2%
            if (c.getDifficultyLevel() != null) {
                int targetGrade = strategy.getTargetGradeLevel();
                int diff = Math.abs(c.getDifficultyLevel() - targetGrade);
                if (diff == 0) boost += 0.05;
                else if (diff == 1) boost += 0.02;
                else if (diff > 2) boost -= 0.03;  // 差距过大降权
            }
            
            // 布鲁姆层级匹配
            // 解题意图优先 APPLY/ANALYZE 层级内容
            // 讲解意图优先 UNDERSTAND/REMEMBER 层级内容
            if (c.getBloomLevel() != null) {
                double bloomScore = bloomMatchScore(
                    strategy.getIntent(), c.getBloomLevel()
                );
                boost += bloomScore * 0.03;
            }
            
            // 内容质量分加分
            if (c.getContentQualityScore() != null) {
                boost += (c.getContentQualityScore() - 0.8) * 0.1;
            }
            
            // 结构化精确命中额外加分
            if (c.isStructuredHit()) {
                boost += 0.05;
            }
            
            c.setFinalScore(c.getRerankScore() * boost);
        }
    }
    
    /**
     * MMR (Maximal Marginal Relevance) 多样性选择
     * 平衡相关性与结果多样性，避免返回高度相似的内容
     */
    private List<RetrievalCandidate> mmrSelect(
            List<RetrievalCandidate> candidates,
            int k,
            double lambda) {
        
        if (candidates.size() <= k) {
            return candidates.stream()
                .sorted(Comparator.comparingDouble(
                    RetrievalCandidate::getFinalScore).reversed())
                .collect(Collectors.toList());
        }
        
        List<RetrievalCandidate> selected = new ArrayList<>();
        List<RetrievalCandidate> remaining = new ArrayList<>(candidates);
        
        // 第一个选分数最高的
        remaining.stream()
            .max(Comparator.comparingDouble(RetrievalCandidate::getFinalScore))
            .ifPresent(c -> {
                selected.add(c);
                remaining.remove(c);
            });
        
        while (selected.size() < k && !remaining.isEmpty()) {
            RetrievalCandidate best = null;
            double bestScore = Double.NEGATIVE_INFINITY;
            
            for (RetrievalCandidate candidate : remaining) {
                // 与已选集合的最大相似度
                double maxSimilarity = selected.stream()
                    .mapToDouble(s -> cosineSimilarity(
                        candidate.getDenseVector(), 
                        s.getDenseVector()))
                    .max()
                    .orElse(0.0);
                
                // MMR 分数 = λ * 相关性 - (1-λ) * 冗余度
                double mmrScore = lambda * candidate.getFinalScore() 
                    - (1 - lambda) * maxSimilarity;
                
                if (mmrScore > bestScore) {
                    bestScore = mmrScore;
                    best = candidate;
                }
            }
            
            if (best != null) {
                selected.add(best);
                remaining.remove(best);
            }
        }
        
        return selected;
    }
}
```

### 4.5 上下文组装器

```java
/**
 * RAG上下文组装器
 * 将检索结果组装为大模型可用的结构化上下文
 */
@Component
public class ContextAssembler {
    
    @Resource
    private TokenEstimator tokenEstimator;
    
    /**
     * 组装上下文
     */
    public AssembledContext assemble(
            List<RetrievalCandidate> candidates,
            RetrievalContext ctx) {
        
        int tokenBudget = ctx.getStrategy().getTokenBudget();
        
        // 分配Token预算：知识讲解 50% + 例题 30% + 拓展 20%
        int knowledgeBudget = (int)(tokenBudget * 0.5);
        int exampleBudget = (int)(tokenBudget * 0.3);
        int extensionBudget = tokenBudget - knowledgeBudget - exampleBudget;
        
        // 按类型分组
        Map<String, List<RetrievalCandidate>> grouped = candidates.stream()
            .collect(Collectors.groupingBy(RetrievalCandidate::getDocType));
        
        StringBuilder context = new StringBuilder();
        int totalTokens = 0;
        List<Long> usedChunkIds = new ArrayList<>();
        
        // 第一部分：知识讲解
        context.append("=== 教材知识 ===\n");
        List<RetrievalCandidate> knowledgeDocs = grouped.getOrDefault("KNOWLEDGE_POINT", List.of());
        for (RetrievalCandidate doc : knowledgeDocs) {
            int docTokens = tokenEstimator.estimate(doc.getContent());
            if (totalTokens + docTokens > knowledgeBudget) {
                String truncated = truncateToTokens(doc.getContent(), 
                    knowledgeBudget - totalTokens);
                context.append(truncated).append("\n[...]\n");
                totalTokens += tokenEstimator.estimate(truncated);
                break;
            }
            context.append(doc.getContent()).append("\n\n");
            context.append("[来源: ").append(doc.getChapterPath()).append("]\n\n");
            totalTokens += docTokens;
            usedChunkIds.add(doc.getChunkId());
        }
        
        // 第二部分：典型例题
        context.append("=== 典型例题 ===\n");
        totalTokens = assembleSection(context, 
            grouped.getOrDefault("QUESTION", List.of()),
            totalTokens, totalTokens + exampleBudget, usedChunkIds);
        
        // 第三部分：考点/拓展
        context.append("=== 考点要点 ===\n");
        totalTokens = assembleSection(context,
            grouped.getOrDefault("EXAM_POINT", List.of()),
            totalTokens, totalTokens + extensionBudget, usedChunkIds);
        
        return AssembledContext.builder()
            .contextBlock(context.toString())
            .totalTokens(totalTokens)
            .usedChunkIds(usedChunkIds)
            .truncated(totalTokens >= tokenBudget * 0.95)
            .build();
    }
    
    private int assembleSection(StringBuilder sb, 
            List<RetrievalCandidate> docs,
            int currentTokens, int sectionBudget,
            List<Long> usedIds) {
        int tokens = currentTokens;
        for (RetrievalCandidate doc : docs) {
            if (tokens >= sectionBudget) break;
            int docTokens = tokenEstimator.estimate(doc.getContent());
            if (tokens + docTokens > sectionBudget) {
                String truncated = truncateToTokens(doc.getContent(),
                    sectionBudget - tokens);
                sb.append(truncated).append("\n\n");
                tokens += tokenEstimator.estimate(truncated);
            } else {
                sb.append(doc.getContent()).append("\n\n");
                tokens += docTokens;
            }
            usedIds.add(doc.getChunkId());
        }
        return tokens;
    }
}
```

### 4.6 质量评估器

```java
/**
 * 检索质量实时评估器
 * 对每次检索结果进行自动质量打分
 */
@Component
public class RetrievalQualityEvaluator {
    
    /**
     * 实时质量打分（不打扰主流程，异步执行）
     */
    @Async
    public CompletableFuture<QualityReport> evaluate(
            RetrievalContext ctx,
            HybridRetrievalResult retrievalResult,
            AssembledContext assembled) {
        
        QualityReport report = new QualityReport();
        
        // 1. 分数维度：Top-K平均相关性分数
        double avgScore = retrievalResult.getCandidates().stream()
            .limit(ctx.getStrategy().getFinalStageK())
            .mapToDouble(RetrievalCandidate::getFinalScore)
            .average()
            .orElse(0.0);
        report.setAvgRelevanceScore(avgScore);
        
        // 2. 分数维度：分数分布（标准差，越大越好说明区分度高）
        double scoreStdDev = calculateStdDev(
            retrievalResult.getCandidates().stream()
                .mapToDouble(RetrievalCandidate::getFinalScore)
                .toArray()
        );
        report.setScoreDiscrimination(scoreStdDev);
        
        // 3. 分数维度：多样性（内容类型覆盖度）
        long distinctTypes = retrievalResult.getCandidates().stream()
            .map(RetrievalCandidate::getDocType)
            .distinct()
            .count();
        report.setContentTypeDiversity(distinctTypes);
        
        // 4. 分数维度：知识点覆盖度
        long distinctKP = retrievalResult.getCandidates().stream()
            .flatMap(c -> c.getKnowledgePoints().stream())
            .distinct()
            .count();
        report.setKnowledgePointCoverage(distinctKP);
        
        // 5. 分数维度：年级匹配度
        double gradeMatchRatio = calculateGradeMatch(
            retrievalResult.getCandidates(),
            ctx.getGradeLevel()
        );
        report.setGradeMatchRatio(gradeMatchRatio);
        
        // 6. 综合质量评分（0-100）
        double overallScore = calculateOverallScore(report);
        report.setOverallScore(overallScore);
        
        // 7. 低质量告警
        if (overallScore < 60.0) {
            log.warn("检索质量较低 [traceId={}]: score={}, query={}", 
                ctx.getTraceId(), overallScore, ctx.getRawQuery());
            metrics.counter("rag.quality.low").increment();
        }
        
        // 8. 质量趋势记录
        metrics.gauge("rag.quality.score").value(overallScore);
        metrics.gauge("rag.quality.relevance").value(avgScore);
        metrics.gauge("rag.quality.diversity").value(distinctTypes);
        
        return CompletableFuture.completedFuture(report);
    }
    
    /**
     * 综合质量评分计算
     */
    private double calculateOverallScore(QualityReport r) {
        // 加权公式
        double score = 0;
        score += r.getAvgRelevanceScore() * 35;       // 相关性 35%
        score += r.getScoreDiscrimination() * 100 * 15; // 区分度 15%
        score += Math.min(r.getContentTypeDiversity() * 10, 15); // 多样性 15%
        score += Math.min(r.getKnowledgePointCoverage() * 8, 15); // 知识覆盖 15%
        score += r.getGradeMatchRatio() * 20;          // 年级匹配 20%
        return Math.min(score, 100.0);
    }
}
```

---

## 5. 关键流程：状态流转

### 5.1 检索请求状态机

```
                     ┌──────────┐
                     │ RECEIVED │ ← 请求到达
                     └────┬─────┘
                          │
                     ┌────▼─────┐
                ┌───►│ CACHE    │
                │    │ CHECK    │
                │    └────┬─────┘
                │         │
                │    ┌────▼─────┐    miss
                │    │ CACHE    │──────────►
                │    │ HIT      │
                │    └────┬─────┘
                │         │ hit
                │    ┌────▼─────┐
                │    │ RETURN   │ ──► 完成
                │    │ CACHED   │
                │    └──────────┘
                │
                ▼ miss
           ┌──────────┐
           │ PREPROCESS│ ← 查询清洗、学科识别
           └────┬─────┘
                │
           ┌────▼─────┐
           │ QUERY     │ ← 意图识别、查询扩展、改写
           │ UNDERSTAND│
           └────┬─────┘
                │
           ┌────▼─────┐
           │ FILTER    │ ← 结构化过滤条件构建
           │ BUILD     │
           └────┬─────┘
                │
           ┌────▼─────┐
           │ HYBRID    │ ← Dense + Sparse + Structured 并行
           │ RETRIEVE  │    (超时2s, 可部分降级)
           └────┬─────┘
                │
           ┌────▼─────┐
           │ MERGE &   │ ← 去重、加权合并
           │ DEDUP     │
           └────┬─────┘
                │
           ┌────▼─────┐
           │ RERANK    │ ← Cross-Encoder精排 (超时500ms)
           │           │    失败→跳过
           └────┬─────┘
                │
           ┌────▼─────┐
           │ CONTEXT   │ ← Token预算分配与组装
           │ ASSEMBLE  │
           └────┬─────┘
                │
           ┌────▼─────┐
           │ QUALITY   │ ← 异步质量评估
           │ EVALUATE  │
           └────┬─────┘
                │
           ┌────▼─────┐
           │ CACHE     │ ← 写入缓存
           │ WRITE     │
           └────┬─────┘
                │
           ┌────▼─────┐
           │ RESPONSE  │ ← 返回结果
           └──────────┘
```

### 5.2 降级策略

```
正常流程: Query Understand → Hybrid(3路) → Rerank → Assemble → Quality
                                                          ↑
                                               全部正常   │
──────────────────────────────────────────────────────────┼─────────
                                                          │
降级Level 1: Rerank超时/失败                              │
    → 跳过Rerank，使用粗排结果                             │
    → 记录指标 rag.rerank.degraded                        │
                                                          │
降级Level 2: Dense检索超时/失败                            │
    → 仅使用Sparse + Structured                           │
    → 记录指标 rag.dense.degraded                         │
                                                          │
降级Level 3: Dense + Sparse 均失败                         │
    → 仅使用 Structured（知识点直接映射）                   │
    → 标记 retrieval_degraded=true                        │
    → AI生成时附加提示："未检索到充分参考资料，请谨慎回答"     │
                                                          │
降级Level 4: 全部检索失败                                   │
    → 跳过RAG，直接调用大模型（Zero-shot）                  │
    → 标记 rag_fallback=true                              │
    → 告警：检查向量库和ES状态                              │
```

---

## 6. 代码示例：核心编排入口

```java
/**
 * RAG检索编排服务 - 对外统一入口
 */
@Service
@Slf4j
public class RagRetrievalOrchestrator {
    
    @Resource private IntentClassifier intentClassifier;
    @Resource private QueryExpander queryExpander;
    @Resource private ConversationalQueryRewriter queryRewriter;
    @Resource private HybridRetrievalExecutor retrievalExecutor;
    @Resource private CrossEncoderReranker reranker;
    @Resource private ContextAssembler contextAssembler;
    @Resource private RetrievalQualityEvaluator qualityEvaluator;
    @Resource private RetrievalCacheManager cacheManager;
    @Resource private StrategyManager strategyManager;
    @Resource private RetrievalQueryRepository queryRepository;
    
    /**
     * 执行完整的RAG检索流程
     * 
     * @param request 检索请求
     * @return 检索结果（包含上下文块和候选列表）
     */
    public RagRetrievalResponse retrieve(RagRetrievalRequest request) {
        long startTime = System.currentTimeMillis();
        String traceId = generateTraceId();
        
        // 1. 加载检索策略（支持A/B测试灰度路由）
        RetrievalStrategy strategy = strategyManager.resolveStrategy(
            request.getUserId(), 
            request.getStrategyVersion()
        );
        
        // 2. 构建检索上下文
        RetrievalContext ctx = RetrievalContext.builder()
            .traceId(traceId)
            .rawQuery(request.getQuery())
            .subject(request.getSubject())
            .stage(request.getStage())
            .gradeLevel(request.getGradeLevel())
            .textbookVersion(request.getTextbookVersion())
            .strategy(strategy)
            .build();
        
        // 3. 缓存检查
        if (strategy.getEnableCache() && request.getOptions().getEnableCache()) {
            RetrievalResult cached = cacheManager.tryCache(ctx);
            if (cached != null) {
                log.info("[{}] RAG缓存命中, level={}", traceId, cached.getCacheLevel());
                return buildResponse(traceId, cached, true, 
                    System.currentTimeMillis() - startTime);
            }
        }
        
        // 4. 查询理解
        //    4a. 意图分类
        RetrievalIntent intent = intentClassifier.classify(request.getQuery());
        ctx.setIntent(intent);
        
        //    4b. 多轮查询改写（若提供了上下文历史）
        String rewrittenQuery = request.getContextHistory() != null 
            ? queryRewriter.rewrite(request.getQuery(), request.getContextHistory())
            : request.getQuery();
        ctx.setRewrittenQuery(rewrittenQuery);
        
        //    4c. 查询扩展
        ExpandedQuery expanded = queryExpander.expand(rewrittenQuery, request.getSubject());
        ctx.setExpandedQuery(expanded);
        
        // 5. 混合检索（多路并行召回 + 合并去重）
        HybridRetrievalResult retrievalResult = retrievalExecutor.retrieve(ctx);
        
        // 6. 重排序
        List<RetrievalCandidate> reranked;
        if (request.getOptions().getEnableRerank() && retrievalResult.hasCandidates()) {
            reranked = reranker.rerank(
                expanded.getExpandedText(), 
                retrievalResult.getCandidates(),
                strategy
            );
        } else {
            reranked = retrievalResult.getCandidates();
        }
        
        // 7. 上下文组装
        AssembledContext assembled = contextAssembler.assemble(reranked, ctx);
        
        // 8. 构建结果
        RetrievalResult result = RetrievalResult.builder()
            .rewrittenQuery(rewrittenQuery)
            .intent(intent.name())
            .expandedTerms(expanded.getSynonyms())
            .candidates(reranked)
            .contextBlock(assembled.getContextBlock())
            .totalTokens(assembled.getTotalTokens())
            .truncated(assembled.isTruncated())
            .build();
        
        result.setCacheLevel("MISS");
        
        // 9. 异步：质量评估 + 缓存写入 + 日志记录
        CompletableFuture.runAsync(() -> {
            qualityEvaluator.evaluate(ctx, retrievalResult, assembled);
        });
        
        if (strategy.getEnableCache()) {
            cacheManager.putCache(ctx, result);
        }
        
        // 10. 异步：记录检索日志
        CompletableFuture.runAsync(() -> {
            saveQueryLog(ctx, request, result, startTime);
        });
        
        long costMs = System.currentTimeMillis() - startTime;
        log.info("[{}] RAG检索完成, cost={}ms, candidates={}, cache=MISS", 
            traceId, costMs, reranked.size());
        
        return buildResponse(traceId, result, false, costMs);
    }
    
    private void saveQueryLog(RetrievalContext ctx, RagRetrievalRequest req, 
            RetrievalResult result, long startTime) {
        try {
            RetrievalQuery log = new RetrievalQuery();
            log.setTraceId(ctx.getTraceId());
            log.setUserId(req.getUserId());
            log.setRawQuery(req.getQuery());
            log.setRewrittenQuery(ctx.getRewrittenQuery());
            log.setIntent(ctx.getIntent().name());
            log.setSubject(req.getSubject());
            log.setStrategyVersion(ctx.getStrategy().getVersion());
            log.setTotalCandidates(result.getCandidates().size());
            log.setRetrievalCostMs(System.currentTimeMillis() - startTime);
            log.setCacheHit(false);
            queryRepository.insert(log);
        } catch (Exception e) {
            log.warn("保存检索日志失败: {}", e.getMessage());
        }
    }
}
```

---

## 7. 性能优化

### 7.1 性能指标目标

| 指标 | P50 目标 | P95 目标 | P99 目标 |
| --- | --- | --- | --- |
| 端到端检索延迟 | ≤ 80ms | ≤ 150ms | ≤ 300ms |
| Dense 检索单路 | ≤ 30ms | ≤ 60ms | ≤ 100ms |
| Sparse 检索单路 | ≤ 20ms | ≤ 40ms | ≤ 80ms |
| Rerank 延迟 | ≤ 50ms | ≤ 100ms | ≤ 200ms |
| 缓存命中率 | ≥ 25% | - | - |
| 检索质量评分 | ≥ 75 | ≥ 75 | ≥ 70 |

### 7.2 向量检索优化

```yaml
# Milvus 集群配置建议
milvus:
  collections:
    - name: knowledge_chunks_v2
      # 使用 IVF_PQ 索引，平衡精度和内存
      index_type: IVF_PQ
      params:
        nlist: 4096        # 聚类中心数
        m: 32              # 子向量数
        nbits: 8           # 每个子向量编码位数
      metric_type: IP      # 内积（向量需归一化后等同余弦）
      
      # 分区策略：按学科分区，减少扫描范围
      partitions:
        - math
        - chinese
        - english
        - physics
        - chemistry
        - biology
        - history
        - geography
        - politics
```

### 7.3 异步预加载策略

```java
/**
 * 检索结果预加载器
 * 根据用户当前学习上下文，预计算可能的下一步查询
 */
@Component
public class RetrievalPreloader {
    
    /**
     * 在用户浏览学习内容时异步预加载
     */
    @EventListener
    @Async
    public void onContentViewed(ContentViewedEvent event) {
        // 获取当前章节的关联知识点
        List<String> relatedKP = knowledgeGraphService
            .getRelatedKnowledgePoints(event.getChapterId());
        
        // 为每个关联知识点预执行检索
        for (String kp : relatedKP) {
            String cacheKey = buildPreloadKey(event.getUserId(), kp);
            if (!cacheManager.exists(cacheKey)) {
                RagRetrievalRequest preloadReq = RagRetrievalRequest.builder()
                    .query(kp)
                    .userId(event.getUserId())
                    .subject(event.getSubject())
                    .stage(event.getStage())
                    .gradeLevel(event.getGradeLevel())
                    .textbookVersion(event.getTextbookVersion())
                    .build();
                // 预检索并写入缓存（标记为预加载）
                ragOrchestrator.retrieve(preloadReq);
            }
        }
    }
}
```

### 7.4 批量嵌入优化

```java
/**
 * 批量嵌入服务 - 减少多次调用嵌入模型的网络开销
 */
@Component
public class BatchEmbeddingService {
    
    @Resource
    private EmbeddingModelClient embeddingClient;
    
    @Resource
    private CacheManager cacheManager;
    
    private static final int BATCH_SIZE = 32;
    
    @Cacheable(value = "embeddings", key = "#text.hashCode()")
    public float[] embed(String text) {
        return embeddingClient.embed(text);
    }
    
    /**
     * 批量嵌入（用于知识库索引构建）
     */
    public List<float[]> batchEmbed(List<String> texts) {
        List<float[]> results = new ArrayList<>(texts.size());
        
        // 分批处理
        for (int i = 0; i < texts.size(); i += BATCH_SIZE) {
            int end = Math.min(i + BATCH_SIZE, texts.size());
            List<String> batch = texts.subList(i, end);
            List<float[]> batchResults = embeddingClient.batchEmbed(batch);
            results.addAll(batchResults);
        }
        
        return results;
    }
}
```

---

## 8. 安全考虑

### 8.1 检索安全

| 安全点 | 措施 |
| --- | --- |
| 跨用户数据泄露 | 检索结果仅返回当前用户学段/年级权限范围内的内容 |
| 敏感内容过滤 | 检索结果经过内容安全过滤器，拦截不适宜内容 |
| 答案管控 | 考试期间可开启"答案延迟"模式，检索不返回直接答案 |
| 查询注入防护 | 对查询文本进行转义和清洗，防止向量库/ES注入 |
| 速率限制 | 单用户RAG检索频率限制：≤10次/分钟 |

### 8.2 答案管控集成

```java
/**
 * 答案管控过滤器
 * 根据用户场景决定是否在检索结果中包含直接答案
 */
@Component
public class AnswerControlFilter {
    
    /**
     * 过滤检索结果
     * @param candidates 检索候选
     * @param userContext 用户上下文
     * @return 过滤后的候选列表
     */
    public List<RetrievalCandidate> filter(
            List<RetrievalCandidate> candidates,
            UserLearningContext userContext) {
        
        AnswerPolicy policy = userContext.getAnswerPolicy();
        
        return candidates.stream()
            .map(c -> {
                // 只提示模式：对ANSWER类型内容进行遮蔽
                if (policy == AnswerPolicy.HINT_ONLY 
                        && "ANSWER".equals(c.getContentType())) {
                    c.setContent(maskAnswer(c.getContent()));
                    c.setMasked(true);
                }
                // 渐进式模式：保留但在内容前加提示标签
                if (policy == AnswerPolicy.PROGRESSIVE
                        && "ANSWER".equals(c.getContentType())) {
                    c.setContent("【最终答案，建议先尝试自己推导】\n" + c.getContent());
                }
                return c;
            })
            .collect(Collectors.toList());
    }
    
    private String maskAnswer(String content) {
        // 将关键答案部分用███替换
        return content.replaceAll(
            "(?:答案|解|结果)[是为：:]+\\s*[^\\n。]+",
            "答案：███（请先尝试自己推导）"
        );
    }
}
```

---

## 9. 测试策略

### 9.1 单元测试

| 测试目标 | 覆盖率要求 | 关键测试点 |
| --- | --- | --- |
| IntentClassifier | ≥ 90% | 各意图模式匹配、边界case、混合意图 |
| QueryExpander | ≥ 85% | 同义词扩展、术语归一化、LaTeX处理 |
| HybridRetrievalExecutor | ≥ 85% | 多路合并、加权计算、去重逻辑 |
| CrossEncoderReranker | ≥ 80% | MMR选择、教学Boost、降级处理 |
| ContextAssembler | ≥ 85% | Token预算分配、截断、章节排序 |
| RetrievalCacheManager | ≥ 80% | 多级缓存读写、缓存键构建 |

```java
/**
 * 混合检索合并测试
 */
@ExtendWith(MockitoExtension.class)
class HybridRetrievalExecutorTest {
    
    @InjectMocks
    private HybridRetrievalExecutor executor;
    
    @Mock private DenseRetrievalService denseService;
    @Mock private SparseRetrievalService sparseService;
    @Mock private StructuredRetrievalService structuredService;
    
    @Test
    @DisplayName("三路合并：同一文档在多路命中时分数应叠加")
    void shouldMergeScoresFromMultipleRoutes() {
        // Given
        RetrievalCandidate shared = RetrievalCandidate.builder()
            .chunkId(100L).score(0.9).build();
        RetrievalCandidate denseOnly = RetrievalCandidate.builder()
            .chunkId(200L).score(0.8).build();
        
        when(denseService.search(any(), any(), anyInt()))
            .thenReturn(List.of(shared, denseOnly));
        when(sparseService.search(any(), any(), anyInt()))
            .thenReturn(List.of(shared));  // shared也出现在sparse结果中
        when(structuredService.search(any(), any(), any(), anyInt()))
            .thenReturn(List.of());
        
        RetrievalStrategy strategy = defaultStrategy();
        RetrievalContext ctx = mockContext(strategy);
        
        // When
        HybridRetrievalResult result = executor.retrieve(ctx);
        
        // Then
        RetrievalCandidate mergedShared = result.getCandidates().stream()
            .filter(c -> c.getChunkId() == 100L).findFirst().orElseThrow();
        
        // shared的合并分数 = 0.9*denseWeight + (normalized sparse score)*sparseWeight
        assertThat(mergedShared.getMergedScore())
            .isGreaterThan(denseOnly.getMergedScore());  // 多路命中的应排前面
    }
    
    @Test
    @DisplayName("降级：Dense检索超时时应返回Sparse+Structured结果")
    void shouldDegradeWhenDenseTimeout() {
        when(denseService.search(any(), any(), anyInt()))
            .thenThrow(new RuntimeException("connection timeout"));
        when(sparseService.search(any(), any(), anyInt()))
            .thenReturn(List.of(mockCandidate(1L, 0.85)));
        when(structuredService.search(any(), any(), any(), anyInt()))
            .thenReturn(List.of());
        
        HybridRetrievalResult result = executor.retrieve(mockContext(defaultStrategy()));
        
        assertThat(result.getDenseCount()).isZero();
        assertThat(result.getSparseCount()).isEqualTo(1);
        assertThat(result.getCandidates()).isNotEmpty();  // 有降级结果
    }
}
```

### 9.2 集成测试

```java
/**
 * RAG检索全链路集成测试
 */
@SpringBootTest
class RagRetrievalIntegrationTest {
    
    @Autowired private RagRetrievalOrchestrator orchestrator;
    
    @Test
    @DisplayName("完整流程：初中数学二次函数查询应返回相关知识点和例题")
    void testCompleteRetrievalFlow() {
        RagRetrievalRequest request = RagRetrievalRequest.builder()
            .query("二次函数的顶点坐标怎么求")
            .userId(100123L)
            .subject("math")
            .stage("middle")
            .gradeLevel("初三")
            .textbookVersion("人教版")
            .intent("SOLVE")
            .build();
        
        RagRetrievalResponse response = orchestrator.retrieve(request);
        
        // 基本断言
        assertThat(response.getCode()).isEqualTo(0);
        assertThat(response.getData().getCandidates()).isNotEmpty();
        assertThat(response.getData().getContextBlock()).isNotBlank();
        assertThat(response.getData().getRewrittenQuery()).isNotNull();
        
        // 内容相关性断言
        List<RetrievalCandidate> candidates = response.getData().getCandidates();
        assertThat(candidates.get(0).getKnowledgePoints())
            .anyMatch(kp -> kp.contains("二次函数") || kp.contains("顶点"));
        
        // Token预算断言
        assertThat(response.getData().getTotalTokens())
            .isLessThanOrEqualTo(3000);
    }
    
    @Test
    @DisplayName("缓存：相同查询第二次应命中缓存")
    void testCacheHit() {
        RagRetrievalRequest request = createTestRequest("什么是勾股定理");
        
        // 第一次：MISS
        RagRetrievalResponse r1 = orchestrator.retrieve(request);
        assertThat(r1.getData().isCacheHit()).isFalse();
        
        // 第二次：HIT
        RagRetrievalResponse r2 = orchestrator.retrieve(request);
        assertThat(r2.getData().isCacheHit()).isTrue();
        assertThat(r2.getData().getCandidates())
            .hasSize(r1.getData().getCandidates().size());
    }
}
```

### 9.3 离线质量评测

```python
# offline_eval.py - 离线检索质量评测脚本

"""
使用标注数据集评估不同检索策略的效果
指标：MRR, Recall@K, NDCG@K
"""

import json
import numpy as np
from pathlib import Path

EVAL_DATASET_PATH = "eval/labeled_queries_v3.json"

def evaluate_strategy(strategy_version: str, eval_data: list):
    """
    对指定策略版本进行评估
    """
    mrr_scores = []
    recall_at_5 = []
    ndcg_at_5 = []
    
    for item in eval_data:
        query = item["query"]
        relevant_chunks = set(item["relevant_chunk_ids"])
        
        # 调用检索API
        results = call_retrieval_api(query, strategy_version)
        retrieved_ids = [r["chunkId"] for r in results["candidates"]]
        
        # MRR
        mrr = calculate_mrr(retrieved_ids, relevant_chunks)
        mrr_scores.append(mrr)
        
        # Recall@5
        recall = calculate_recall_at_k(retrieved_ids, relevant_chunks, k=5)
        recall_at_5.append(recall)
        
        # NDCG@5
        ndcg = calculate_ndcg_at_k(retrieved_ids, relevant_chunks, k=5)
        ndcg_at_5.append(ndcg)
    
    return {
        "strategy": strategy_version,
        "sample_count": len(eval_data),
        "MRR": np.mean(mrr_scores),
        "Recall@5": np.mean(recall_at_5),
        "NDCG@5": np.mean(ndcg_at_5)
    }

def calculate_mrr(retrieved, relevant):
    for i, doc_id in enumerate(retrieved, 1):
        if doc_id in relevant:
            return 1.0 / i
    return 0.0

def calculate_recall_at_k(retrieved, relevant, k):
    top_k = set(retrieved[:k])
    return len(top_k & relevant) / len(relevant) if relevant else 0

def calculate_ndcg_at_k(retrieved, relevant, k):
    dcg = sum(
        1.0 / np.log2(i + 2) if doc_id in relevant else 0.0
        for i, doc_id in enumerate(retrieved[:k])
    )
    idcg = sum(1.0 / np.log2(i + 2) for i in range(min(len(relevant), k)))
    return dcg / idcg if idcg > 0 else 0

if __name__ == "__main__":
    eval_data = json.loads(Path(EVAL_DATASET_PATH).read_text())
    
    for version in ["v2.2.0", "v2.3.0", "v2.3.1"]:
        report = evaluate_strategy(version, eval_data)
        print(f"\n=== Strategy {version} ===")
        for k, v in report.items():
            print(f"  {k}: {v:.4f}" if isinstance(v, float) else f"  {k}: {v}")
```

---

## 10. 监控告警

### 10.1 关键指标看板

| 指标名 | 类型 | 告警阈值 | 说明 |
| --- | --- | --- | --- |
| rag.retrieval.latency.p95 | Gauge | > 200ms | 检索延迟P95 |
| rag.retrieval.error_rate | Counter | > 1% | 检索失败率 |
| rag.cache.hit_rate | Gauge | < 15% | 缓存命中率 |
| rag.quality.score.avg | Gauge | < 65 | 平均检索质量 |
| rag.dense.failure_rate | Counter | > 5% | 向量检索失败率 |
| rag.rerank.timeout_rate | Counter | > 10% | 重排超时率 |
| rag.degradation.level3+ | Counter | > 0.5% | 严重降级比例 |

### 10.2 Grafana 面板配置片段

```json
{
  "panels": [
    {
      "title": "RAG检索延迟分布",
      "targets": [{
        "expr": "histogram_quantile(0.95, rag_retrieval_latency_bucket)",
        "legendFormat": "P95"
      }]
    },
    {
      "title": "检索质量趋势",
      "targets": [{
        "expr": "avg(rag_quality_score)",
        "legendFormat": "平均质量分"
      }]
    },
    {
      "title": "缓存命中率",
      "targets": [{
        "expr": "rag_cache_hit_total / (rag_cache_hit_total + rag_cache_miss_total)",
        "legendFormat": "命中率"
      }]
    }
  ]
}
```

---

## 11. 策略A/B测试框架

### 11.1 流量分配

```java
/**
 * 策略灰度路由器
 */
@Component
public class StrategyRolloutRouter {
    
    /**
     * 根据用户ID和策略灰度比例决定使用哪个策略版本
     */
    public RetrievalStrategy resolveStrategy(Long userId, String forcedVersion) {
        // 强制指定版本（调试用）
        if (forcedVersion != null) {
            return strategyRepository.findByVersion(forcedVersion);
        }
        
        // 获取所有活跃策略
        List<RetrievalStrategy> activeStrategies = strategyRepository
            .findByActiveTrueOrderByRolloutPercentDesc();
        
        if (activeStrategies.size() == 1) {
            return activeStrategies.get(0);
        }
        
        // 基于用户ID的确定性分流（同一用户始终进入同一组）
        int bucket = Math.abs(userId.hashCode()) % 100;
        int cumulative = 0;
        
        for (RetrievalStrategy strategy : activeStrategies) {
            cumulative += strategy.getRolloutPercent();
            if (bucket < cumulative) {
                return strategy;
            }
        }
        
        return activeStrategies.get(0);  // 兜底
    }
}
```

### 11.2 效果对比

```sql
-- 对比不同策略的检索质量（过去7天）
SELECT 
    strategy_version,
    COUNT(*) AS total_queries,
    ROUND(AVG(quality_score), 2) AS avg_quality,
    ROUND(AVG(retrieval_cost_ms), 0) AS avg_latency,
    ROUND(AVG(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END) * 100, 1) AS cache_hit_pct,
    ROUND(AVG(CASE WHEN user_feedback = 'HELPFUL' THEN 1 ELSE 0 END) * 100, 1) AS helpful_pct
FROM rag_retrieval_query
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY strategy_version
ORDER BY avg_quality DESC;
```

---

## 12. 迭代规划

### 12.1 近期优化方向

| 方向 | 预期收益 | 复杂度 |
| --- | --- | --- |
| 引入 ColBERT token-level 检索 | 提升细粒度匹配能力 | 高 |
| 基于用户反馈的检索结果自学习 | 自动优化排序 | 中 |
| 多模态检索（图文混合查询） | 支持图片题目检索 | 高 |
| 教师标注数据融入重排 | 教学专业性提升 | 中 |
| 查询意图大模型直接分类 | 替代规则，提升泛化 | 低 |

### 12.2 评测数据集建设

```
标注数据集建设计划：
├── v1: 500条核心查询（教研团队标注）     ← MVP阶段
├── v2: 2000条覆盖全学科查询               ← V1.0阶段  
├── v3: 5000条含多轮对话场景               ← V1.5阶段
└── v4: 10000条含跨学科和长尾查询           ← V2.0阶段
```

每条标注包含：
- 原始查询文本
- 学生上下文（学段、年级、教材版本）
- 相关文档块ID列表（3-10个）
- 不相关但易混淆的文档块ID列表（2-5个，用于检验区分度）
- 标注者专业评级（教研专家/普通教师/学生）

---

## 附录

### A. 教育同义词词典结构示例

```json
{
  "math": {
    "二次函数": ["抛物线", "二次函数图像", "quadratic function"],
    "顶点坐标": ["顶点", "顶点公式", "极值点", "对称中心"],
    "配方法": ["完全平方法", "配方", "completing the square"],
    "勾股定理": ["毕达哥拉斯定理", "勾股", "直角三角形边长关系"]
  },
  "physics": {
    "牛顿第二定律": ["F=ma", "牛顿定律", "力与加速度"],
    "欧姆定律": ["I=U/R", "电阻电流电压关系"]
  }
}
```

### B. Cross-Encoder 模型选型对比

| 模型 | 推理速度 | 中文效果 | 部署方式 | 推荐场景 |
| --- | --- | --- | --- | --- |
| bge-reranker-v2-m3 | 中 | 优 | 本地GPU | 默认选择 |
| bge-reranker-base | 快 | 良 | CPU可跑 | 低配环境 |
| ms-marco-MiniLM-L-12 | 慢 | 中 | GPU | 英文为主 |
| Cohere rerank API | 快 | 良 | API | 无GPU环境 |

### C. 参考文档

- [RAG与知识库系统-详细设计](./RAG与知识库系统-详细设计.md) - 基础架构
- [AI-Prompt编排与场景模板系统-详细设计](./AI-Prompt编排与场景模板系统-详细设计.md) - Prompt 模板
- [多模态输入统一处理与智能路由引擎-详细设计](./多模态输入统一处理与智能路由引擎-详细设计.md) - 多模态处理
- [知识点体系与教材映射引擎-详细设计](./知识点体系与教材映射引擎-详细设计.md) - 知识体系
- [SSE流式响应与AI增量渲染引擎-详细设计](./SSE流式响应与AI增量渲染引擎-详细设计.md) - 流式响应
