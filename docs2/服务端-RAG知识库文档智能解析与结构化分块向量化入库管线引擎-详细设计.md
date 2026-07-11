# 服务端-RAG知识库文档智能解析与结构化分块向量化入库管线引擎 详细设计

## 1. 概述

### 1.1 模块定位

RAG 知识库文档智能解析与结构化分块向量化入库管线引擎（以下简称"文档入库管线"或"Pipeline"）是 PrimeTop AI 辅导系统的**知识供给基础设施**。它负责将原始教育内容（教材 PDF、教辅 Word、题库图片、HTML 课件等）转化为可直接用于 RAG 检索的结构化向量知识块。

本引擎位于内容生产与 RAG 检索之间，是知识从"人读"到"机读"的关键转换层：

```
内容生产层                文档入库管线                    RAG 检索层
┌──────────┐     ┌──────────────────────────┐     ┌──────────────┐
│ 教材 PDF │     │  ① 文档采集与格式检测     │     │              │
│ 教辅 Word│ ──▶ │  ② 多模态内容提取         │ ──▶ │  向量数据库   │
│ 题库图片 │     │  ③ 教育实体识别           │     │  (Milvus)    │
│ HTML 课件│     │  ④ 智能分块               │     │              │
│ Markdown │     │  ⑤ 元数据标注             │ ──▶ │  搜索引擎     │
│ 手写扫描 │     │ ⑥ 向量嵌入生成             │     │  (ES)        │
└──────────┘     │  ⑦ 质量校验与人工审核     │     └──────────────┘
                 │  ⑧ 入库与索引构建         │
                 └──────────────────────────┘
```

### 1.2 核心职责

| 职责 | 说明 |
|------|------|
| 多格式文档接入 | 支持 PDF、Word、图片、HTML、Markdown 等格式的教育文档自动接入 |
| 结构化内容提取 | 从文档中提取纯文本、数学公式、表格、图片说明、代码块等内容 |
| 教育实体识别 | 识别知识点、考点、学科术语、公式、章节结构等教育领域实体 |
| 智能分块 | 按语义边界、知识粒度对内容进行合理切分，避免破坏知识完整性 |
| 元数据标注 | 为每个知识块标注学科、学段、年级、教材版本、章节、知识点等元数据 |
| 向量嵌入 | 调用嵌入模型将文本块转换为高维向量 |
| 质量校验 | 自动检测分块质量、向量质量、内容完整性 |
| 增量更新 | 支持教材修订、题库更新时的增量解析与向量更新 |

### 1.3 依赖关系

**上游依赖（数据源）：**
- 内容管理服务（CMS）：提供待处理的原始文档及元数据
- 教材版本管理服务：提供教材章节树结构
- 知识点体系服务：提供知识点图谱与关联关系

**下游消费方：**
- RAG 检索引擎：消费向量块进行语义检索
- 全文搜索服务：消费结构化文本进行关键词检索
- AI 辅导引擎：通过 RAG 获取增强知识上下文

**外部服务依赖：**
- OCR 服务（百度 OCR / 腾讯 OCR / 自建 PaddleOCR）
- 嵌入模型 API（OpenAI text-embedding-3 / BGE / M3E）
- 对象存储（MinIO / 阿里云 OSS）：存储原始文档与中间产物

---

## 2. 数据模型

### 2.1 核心实体关系

```
Document (文档)
  │ 1:N
  ▼
DocumentChunk (文档分块)
  │ 1:N
  ▼
KnowledgeBlock (知识向量块) ──▶ VectorRecord (向量记录)
  │                                    │
  │ M:N                                │
  ▼                                    ▼
KnowledgePoint (知识点)           EmbeddingTask (嵌入任务)
```

### 2.2 数据库表结构

#### 2.2.1 document_parse_task（文档解析任务表）

```sql
CREATE TABLE document_parse_task (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_id         VARCHAR(64) NOT NULL UNIQUE COMMENT '任务唯一ID (UUID)',
    document_id     BIGINT NOT NULL COMMENT '内容管理系统中的文档ID',
    document_type   VARCHAR(32) NOT NULL COMMENT '文档类型: PDF/WORD/IMAGE/HTML/MARKDOWN',
    source_url      VARCHAR(1024) NOT NULL COMMENT '原始文档存储URL',
    source_meta     JSON COMMENT '文档来源元数据 {uploader, textbook_id, chapter_ids...}',
    
    -- 任务状态
    status          VARCHAR(32) NOT NULL DEFAULT 'PENDING' COMMENT '任务状态: PENDING/PARSING/EXTRACTING/CHUNKING/EMBEDDING/VALIDATING/COMPLETED/FAILED/REVIEWING',
    priority        INT NOT NULL DEFAULT 5 COMMENT '优先级 1(最高)-10(最低)',
    retry_count     INT NOT NULL DEFAULT 0 COMMENT '重试次数',
    max_retry       INT NOT NULL DEFAULT 3 COMMENT '最大重试次数',
    
    -- 处理进度
    current_step    VARCHAR(64) COMMENT '当前处理步骤',
    progress        DECIMAL(5,2) DEFAULT 0.00 COMMENT '完成进度 0-100',
    
    -- 结果统计
    total_chunks    INT DEFAULT 0 COMMENT '生成分块总数',
    total_vectors   INT DEFAULT 0 COMMENT '生成向量总数',
    total_tokens    INT DEFAULT 0 COMMENT '消耗Token总数',
    error_message   TEXT COMMENT '错误信息',
    
    -- 时间
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    started_at      DATETIME COMMENT '开始处理时间',
    completed_at    DATETIME COMMENT '完成处理时间',
    
    INDEX idx_status_priority (status, priority, created_at),
    INDEX idx_document_id (document_id),
    INDEX idx_task_id (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='文档解析任务表';
```

#### 2.2.2 document_chunk（文档分块表）

```sql
CREATE TABLE document_chunk (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    chunk_id            VARCHAR(64) NOT NULL UNIQUE COMMENT '分块唯一ID (UUID)',
    task_id             VARCHAR(64) NOT NULL COMMENT '关联解析任务ID',
    document_id         BIGINT NOT NULL COMMENT '源文档ID',
    
    -- 分块内容
    chunk_index         INT NOT NULL COMMENT '分块在文档中的序号(从0开始)',
    chunk_type          VARCHAR(32) NOT NULL COMMENT '块类型: TEXT/FORMULA/TABLE/IMAGE_DESC/CODE/EXERCISE/SUMMARY',
    content_text        MEDIUMTEXT NOT NULL COMMENT '分块纯文本内容',
    content_markdown    MEDIUMTEXT COMMENT '分块Markdown格式内容(含公式/格式)',
    content_hash        VARCHAR(64) NOT NULL COMMENT '内容哈希(SHA-256)用于去重',
    
    -- 位置信息
    page_number         INT COMMENT '所在页码(图片/PDF)',
    section_path        VARCHAR(512) COMMENT '章节路径: "第1章 > 1.2 函数 > 1.2.1 函数概念"',
    
    -- 教育元数据
    subject             VARCHAR(32) COMMENT '学科: MATH/PHYSICS/CHEMISTRY/BIOLOGY/CHINESE/ENGLISH/HISTORY/GEOGRAPHY/POLITICS',
    stage               VARCHAR(16) COMMENT '学段: KINDERGARTEN/PRIMARY/JUNIOR/SENIOR',
    grade_level         INT COMMENT '年级 1-12',
    textbook_version    VARCHAR(64) COMMENT '教材版本: PEP/SUJIAO/BSJ/FLTRP...',
    chapter_id          VARCHAR(64) COMMENT '章节ID',
    
    -- 知识点关联
    knowledge_point_ids JSON COMMENT '关联知识点ID列表 ["kp_001","kp_002"]',
    difficulty_level    VARCHAR(16) COMMENT '难度: EASY/MEDIUM/HARD',
    cognitive_level     VARCHAR(32) COMMENT '布鲁姆认知层级: REMEMBER/UNDERSTAND/APPLY/ANALYZE/EVALUATE/CREATE',
    
    -- 分块元信息
    token_count         INT COMMENT 'Token数量',
    char_count          INT COMMENT '字符数',
    language           VARCHAR(16) DEFAULT 'zh-CN' COMMENT '内容语言',
    
    -- 向量状态
    vector_status       VARCHAR(32) DEFAULT 'PENDING' COMMENT '向量化状态: PENDING/EMBEDDING/COMPLETED/FAILED/SKIP',
    vector_id           VARCHAR(128) COMMENT '向量数据库中的记录ID',
    embedding_model     VARCHAR(64) COMMENT '使用的嵌入模型',
    embedding_dim       INT COMMENT '向量维度',
    
    -- 质量信息
    quality_score       DECIMAL(4,2) COMMENT '分块质量评分 0-100',
    quality_issues      JSON COMMENT '质量问题列表 ["OVERLAP_TOO_LONG","FORMULA_BROKEN"]',
    needs_review        BOOLEAN DEFAULT FALSE COMMENT '是否需要人工审核',
    reviewed_by         VARCHAR(64) COMMENT '审核人',
    reviewed_at         DATETIME COMMENT '审核时间',
    
    -- 生命周期
    is_active           BOOLEAN DEFAULT TRUE COMMENT '是否激活(软删除标记)',
    version             INT DEFAULT 1 COMMENT '版本号(教材修订时递增)',
    
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_chunk_id (chunk_id),
    INDEX idx_task_id (task_id),
    INDEX idx_document_id (document_id),
    INDEX idx_subject_chapter (subject, chapter_id),
    INDEX idx_knowledge_points ((CAST(knowledge_point_ids AS CHAR(256)))),
    INDEX idx_vector_status (vector_status),
    INDEX idx_content_hash (content_hash),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='文档分块表';
```

#### 2.2.3 parse_pipeline_log（管线处理日志表）

```sql
CREATE TABLE parse_pipeline_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_id         VARCHAR(64) NOT NULL COMMENT '关联任务ID',
    step_name       VARCHAR(64) NOT NULL COMMENT '步骤名: PARSE/EXTRACT/NER/CHUNK/TAG/EMBED/VALIDATE/INDEX',
    step_index      INT NOT NULL COMMENT '步骤序号',
    
    status          VARCHAR(32) NOT NULL COMMENT 'SUCCESS/FAILED/SKIP',
    duration_ms     INT COMMENT '耗时(毫秒)',
    
    input_summary   JSON COMMENT '输入摘要 {page_count, char_count...}',
    output_summary  JSON COMMENT '输出摘要 {chunk_count, vector_count...}',
    
    error_type      VARCHAR(64) COMMENT '错误类型',
    error_detail    TEXT COMMENT '错误详情',
    error_stack     TEXT COMMENT '错误堆栈',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_task_id_step (task_id, step_name),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管线处理日志表';
```

#### 2.2.4 chunk_dedup_index（分块去重索引表）

```sql
CREATE TABLE chunk_dedup_index (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    content_hash    VARCHAR(64) NOT NULL COMMENT '内容SHA-256哈希',
    chunk_id        VARCHAR(64) NOT NULL COMMENT '关联分块ID',
    document_id     BIGINT NOT NULL COMMENT '文档ID',
    subject         VARCHAR(32) COMMENT '学科',
    similarity_hash VARCHAR(64) COMMENT 'SimHash/MinHash用于近似去重',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_content_hash_chunk (content_hash, chunk_id),
    INDEX idx_content_hash (content_hash),
    INDEX idx_similarity_hash (similarity_hash),
    INDEX idx_subject (subject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='分块去重索引表';
```

### 2.3 缓存策略

| 缓存键 | 用途 | TTL | 淘汰策略 |
|--------|------|-----|----------|
| `pipeline:task:{taskId}` | 任务运行状态缓存 | 24h | 任务完成后自动过期 |
| `pipeline:doc:{docId}:parsed` | 文档解析结果缓存 | 7d | 文档更新时失效 |
| `pipeline:chapter:{chapterId}:chunks` | 章节分块列表缓存 | 1h | 分块变更时失效 |
| `pipeline:model:{modelId}:config` | 解析模型配置缓存 | 30min | 配置变更时主动失效 |
| `pipeline:dedup:bloom` | 去重布隆过滤器 | 永久 | 每日重建 |

### 2.4 向量数据库 Schema（Milvus）

```python
# Milvus Collection: knowledge_chunks
collection_schema = {
    "name": "knowledge_chunks",
    "description": "教育知识向量块集合",
    "fields": [
        {
            "name": "chunk_id",
            "dtype": "VARCHAR",
            "max_length": 64,
            "is_primary": True
        },
        {
            "name": "embedding",
            "dtype": "FLOAT_VECTOR",
            "dim": 1024  # BGE-large-zh: 1024维
        },
        {
            "name": "subject",         # 学科（标量过滤）
            "dtype": "VARCHAR",
            "max_length": 32
        },
        {
            "name": "stage",           # 学段
            "dtype": "VARCHAR",
            "max_length": 16
        },
        {
            "name": "grade_level",     # 年级
            "dtype": "INT64"
        },
        {
            "name": "textbook_version",# 教材版本
            "dtype": "VARCHAR",
            "max_length": 64
        },
        {
            "name": "chapter_id",      # 章节ID
            "dtype": "VARCHAR",
            "max_length": 64
        },
        {
            "name": "chunk_type",      # 块类型
            "dtype": "VARCHAR",
            "max_length": 32
        },
        {
            "name": "difficulty_level",# 难度
            "dtype": "VARCHAR",
            "max_length": 16
        },
        {
            "name": "document_id",     # 文档ID
            "dtype": "INT64"
        },
        {
            "name": "version",         # 内容版本
            "dtype": "INT64"
        }
    ],
    "index_params": {
        "index_type": "HNSW",
        "metric_type": "COSINE",
        "params": {
            "M": 16,
            "efConstruction": 256
        }
    }
}
```

---

## 3. 管线架构与核心流程

### 3.1 管线总体状态机

```
                          ┌─────────┐
                 ┌───────│ PENDING │◀──── 新任务提交
                 │       └────┬────┘
                 │            ▼
                 │     ┌────────────┐
                 │     │  PARSING   │ (格式检测 + 结构解析)
                 │     └─────┬──────┘
                 │           │成功
                 │           ▼
                 │   ┌──────────────┐
                 │   │ EXTRACTING   │ (多模态内容提取)
                 │   └──────┬───────┘
                 │          │成功
                 │          ▼
                 │   ┌──────────────┐
                 │   │   NER        │ (教育实体识别)
                 │   └──────┬───────┘
                 │          │成功
                 │          ▼
                 │   ┌──────────────┐
                 │   │  CHUNKING    │ (智能分块)
                 │   └──────┬───────┘
                 │          │成功
                 │          ▼
                 │   ┌──────────────┐
                 │   │   TAGGING    │ (元数据标注)
                 │   └──────┬───────┘
                 │          │成功
                 │          ▼
                 │   ┌──────────────┐
                 │   │  EMBEDDING   │ (向量嵌入)
                 │   └──────┬───────┘
                 │          │成功
                 │          ▼
                 │   ┌──────────────┐
                 │   │ VALIDATING   │ (质量校验)
                 │   └──────┬───────┘
                 │          │
                 │     ┌────┴────┐
                 │     │自动通过  │需人工
                 │     ▼         ▼
                 │ ┌─────────┐ ┌───────────┐
                 │ │ INDEXING│ │ REVIEWING │
                 │ └────┬────┘ └─────┬─────┘
                 │      │            │审核完成
                 │      ▼            ▼
                 │           ┌──────────┐
                 └─────────▶│ COMPLETED │
                            └──────────┘
                 
                 任意步骤失败:
                 ┌────────┐
                 │ FAILED │ ──▶ retry_count < max ? → 回到失败步骤
                 └────────┘     retry_count >= max ? → 停止并告警
```

### 3.2 各步骤详细流程

#### 3.2.1 Step 1: 文档采集与格式检测（PARSING）

```python
class DocumentParser:
    """文档解析器：根据文件类型路由到对应解析器"""
    
    PARSER_REGISTRY = {
        "pdf": PDFParser,
        "docx": DocxParser,
        "doc": LegacyDocParser,
        "html": HTMLParser,
        "markdown": MarkdownParser,
        "image": ImageOCRParser,
        "pptx": PPTXParser,
    }
    
    async def parse(self, task: ParseTask) -> ParseResult:
        """
        解析入口：
        1. 从对象存储下载原始文档
        2. 检测文件格式（通过文件头，不仅依赖扩展名）
        3. 路由到对应解析器
        4. 输出统一的中间表示 ParsedDocument
        """
        file_path = await self._download_document(task.source_url)
        
        detected_format = self._detect_format(file_path)
        if detected_format != task.document_type:
            logger.warning(f"Format mismatch: expected={task.document_type}, detected={detected_format}")
            task.document_type = detected_format  # 以实际检测为准
        
        parser_cls = self.PARSER_REGISTRY.get(detected_format)
        if not parser_cls:
            raise UnsupportedFormatError(f"Unsupported format: {detected_format}")
        
        parser = parser_cls()
        parsed_doc = await parser.parse(file_path, task.source_meta)
        
        return parsed_doc
```

**ParsedDocument 统一中间表示：**

```python
@dataclass
class ParsedDocument:
    """所有格式解析后的统一中间表示"""
    document_id: int
    format: str                          # 原始格式
    total_pages: int                     # 总页数
    sections: List[DocumentSection]      # 章节结构
    content_blocks: List[ContentBlock]   # 内容块列表
    metadata: DocumentMetadata           # 文档元数据


@dataclass  
class DocumentSection:
    """文档章节结构"""
    section_id: str
    title: str
    level: int                           # 层级: 1=章, 2=节, 3=小节
    page_range: Tuple[int, int]
    parent_section_id: Optional[str]
    children: List[str]                  # 子章节ID列表


@dataclass
class ContentBlock:
    """
    内容块：文档中最小的语义单元
    一个 PDF 页面可能包含多个 ContentBlock
    """
    block_id: str
    block_type: BlockType                # TEXT / FORMULA / TABLE / IMAGE / CODE / TITLE / LIST
    page_number: int
    section_path: str                    # 所属章节路径
    
    # 文本内容
    raw_text: str                        # 原始文本
    cleaned_text: str                    # 清洗后文本
    
    # 格式化内容
    markdown: str                        # Markdown格式
    latex: Optional[str]                 # LaTeX公式（公式块/含公式文本块）
    html: Optional[str]                  # HTML（表格块）
    
    # 图片信息
    image_url: Optional[str]             # 图片OSS地址
    image_caption: Optional[str]         # 图片说明文字
    ocr_text: Optional[str]              # OCR识别文本
    
    # 位置信息（用于排版还原）
    bbox: Optional[Tuple[float, float, float, float]]  # 边界框 (x0, y0, x1, y1)
    reading_order: int                   # 阅读顺序


class BlockType(Enum):
    TEXT = "text"                        # 正文文本
    TITLE = "title"                      # 标题
    FORMULA = "formula"                  # 数学/化学公式
    TABLE = "table"                      # 表格
    IMAGE = "image"                      # 图片
    IMAGE_WITH_TEXT = "image_with_text"  # 图文混排
    CODE = "code"                        # 代码块
    LIST = "list"                        # 列表
    EXERCISE = "exercise"                # 练习题
    ANSWER = "answer"                    # 答案
    FOOTNOTE = "footnote"               # 脚注
    HEADER = "header"                    # 页眉
    FOOTER = "footer"                    # 页脚
```

#### 3.2.2 Step 2: 多模态内容提取（EXTRACTING）

针对不同内容类型的提取策略：

```python
class MultiModalExtractor:
    """多模态内容提取器"""
    
    def __init__(self, ocr_service: OCRService, formula_recognizer: FormulaRecognizer):
        self.ocr = ocr_service
        self.formula_recognizer = formula_recognizer
    
    async def extract(self, parsed_doc: ParsedDocument) -> ParsedDocument:
        """
        对已解析的内容块进行深度提取：
        1. 公式识别：LaTeX 表达式提取
        2. 表格结构化：HTML 表格还原
        3. 图片 OCR：图片中文字提取
        4. 图表理解：图表内容描述生成
        """
        enhanced_blocks = []
        for block in parsed_doc.content_blocks:
            enhanced = await self._enhance_block(block)
            enhanced_blocks.append(enhanced)
        
        parsed_doc.content_blocks = enhanced_blocks
        return parsed_doc
    
    async def _enhance_block(self, block: ContentBlock) -> ContentBlock:
        if block.block_type == BlockType.FORMULA:
            # 公式块：识别 LaTeX
            if not block.latex:
                block.latex = await self.formula_recognizer.recognize(block.image_url or block.raw_text)
        
        elif block.block_type == BlockType.TABLE:
            # 表格块：确保有 HTML 结构
            if not block.html and block.image_url:
                block.html = await self.ocr.recognize_table(block.image_url)
                block.cleaned_text = self._table_to_text(block.html)
        
        elif block.block_type in (BlockType.IMAGE, BlockType.IMAGE_WITH_TEXT):
            # 图片块：OCR 提取文字
            if block.image_url and not block.ocr_text:
                block.ocr_text = await self.ocr.recognize_text(block.image_url)
        
        elif block.block_type == BlockType.TEXT:
            # 文本块：检测内嵌公式
            inline_formulas = self._detect_inline_formulas(block.cleaned_text)
            if inline_formulas:
                block.markdown = self._render_with_formulas(block.cleaned_text, inline_formulas)
        
        return block
    
    def _detect_inline_formulas(self, text: str) -> List[Dict]:
        """
        检测文本中的内嵌公式
        策略：正则匹配常见数学符号模式 + 上下文启发式判断
        """
        patterns = [
            # LaTeX 内联公式 $...$
            r'\$([^$]+)\$',
            # 分数/根号模式
            r'[√∫∑∏≤≥≠±×÷]',
            # 化学方程式模式
            r'\d*[A-Z][a-z]?\d*(?:[→↑↓⇌]|\+(?![\d])|->)',
            # 上下标模式
            r'[a-zA-Z](?:\^[0-9{}+-]+|_[0-9{}+-]+)',
        ]
        results = []
        for pattern in patterns:
            matches = re.finditer(pattern, text)
            for m in matches:
                results.append({
                    "text": m.group(),
                    "start": m.start(),
                    "end": m.end(),
                })
        return results
```

**公式识别器关键设计：**

```python
class FormulaRecognizer:
    """数学/化学公式识别器"""
    
    STRATEGY_PIXEL = "pixel"       # 像素级识别（图片公式）
    STRATEGY_TEXT = "text"         # 文本级识别（已有文本提取LaTeX）
    STRATEGY_HYBRID = "hybrid"     # 混合策略
    
    async def recognize(self, source: str, strategy: str = "hybrid") -> str:
        """
        识别公式并返回 LaTeX 字符串
        """
        if strategy == self.STRATEGY_TEXT:
            return await self._text_to_latex(source)
        elif strategy == self.STRATEGY_PIXEL:
            return await self._image_to_latex(source)
        else:
            # 混合：先尝试文本级，失败则像素级
            try:
                return await self._text_to_latex(source)
            except FormulaParseError:
                if self._is_url(source):
                    return await self._image_to_latex(source)
                raise
    
    async def _image_to_latex(self, image_url: str) -> str:
        """
        图片公式 → LaTeX
        优先级：Pix2Tex(本地) → MathPix API(高精度) → GPT-4V(兜底)
        """
        # 第一优先级：本地 Pix2Tex 模型（速度快，免费）
        try:
            latex = await self._pix2tex(image_url)
            if self._validate_latex(latex):
                return latex
        except Exception:
            pass
        
        # 第二优先级：MathPix API（精度高，收费）
        try:
            latex = await self._mathpix(image_url)
            if self._validate_latex(latex):
                return latex
        except Exception:
            pass
        
        # 第三优先级：多模态大模型（兜底）
        latex = await self._mllm_formula(image_url)
        return latex
    
    def _validate_latex(self, latex: str) -> bool:
        """LaTeX 基础语法校验"""
        if not latex or len(latex) < 2:
            return False
        # 括号匹配检查
        stack = []
        pairs = {'{': '}', '(': ')', '[': ']'}
        for char in latex:
            if char in pairs:
                stack.append(char)
            elif char in pairs.values():
                if not stack or pairs[stack.pop()] != char:
                    return False
        return len(stack) == 0
```

#### 3.2.3 Step 3: 教育实体识别（NER）

```python
class EducationNER:
    """教育领域命名实体识别"""
    
    ENTITY_TYPES = {
        "KNOWLEDGE_POINT": "知识点",       # 函数、光合作用、牛顿第二定律
        "EXAM_POINT": "考点",              # 高频考点、考试大纲
        "FORMULA": "公式",                 # 勾股定理、欧姆定律
        "THEOREM": "定理/定律",            # 勾股定理、动能定理
        "EXPERIMENT": "实验",              # 伏安法测电阻
        "FIGURE": "图表",                  # 函数图象、电路图
        "PERSON": "人物",                  # 牛顿、李白
        "TERM": "学科术语",                # 化合价、加速度
        "CHAPTER_REF": "章节引用",         # "见第3章第2节"
        "GRADE_REF": "年级引用",           # "高一上学期"
    }
    
    def __init__(self, llm_client: LLMClient, kp_service: KnowledgePointService):
        self.llm = llm_client
        self.kp_service = kp_service
        self._entity_cache = {}  # 实体识别结果缓存
    
    async def recognize(self, block: ContentBlock) -> List[EducationEntity]:
        """
        识别内容块中的教育实体
        策略：规则匹配 + 知识图谱查询 + LLM 辅助
        """
        text = block.cleaned_text
        if text in self._entity_cache:
            return self._entity_cache[text]
        
        entities = []
        
        # 1. 知识点图谱精确匹配
        kp_matches = await self.kp_service.match_knowledge_points(
            text, 
            subject=block.metadata.get("subject"),
            threshold=0.85
        )
        entities.extend([
            EducationEntity(type="KNOWLEDGE_POINT", text=m.name, kp_id=m.id, 
                          confidence=m.score, span=m.span)
            for m in kp_matches
        ])
        
        # 2. 正则规则匹配公式、定理
        formula_patterns = self._compile_formula_patterns(block.metadata.get("subject"))
        for pattern in formula_patterns:
            for match in pattern.finditer(text):
                entities.append(EducationEntity(
                    type="FORMULA",
                    text=match.group(),
                    span=(match.start(), match.end()),
                    confidence=0.95
                ))
        
        # 3. 对复杂/模糊内容使用 LLM 辅助识别
        if len(entities) < 2 and len(text) > 100:
            llm_entities = await self._llm_extract_entities(text, block.metadata)
            entities.extend(llm_entities)
        
        # 去重与合并
        entities = self._merge_overlapping_entities(entities)
        
        self._entity_cache[text] = entities
        return entities
```

#### 3.2.4 Step 4: 智能分块（CHUNKING）

这是整个管线最核心的步骤——将文档内容切分为合适大小的知识块，既要保证语义完整性，又要适配向量检索的粒度。

```python
class SmartChunker:
    """
    教育内容智能分块器
    
    核心原则：
    1. 不在一个知识点/公式/表格中间切断
    2. 保持章节结构的层次性
    3. 控制每个 chunk 的 token 数在 [128, 512] 范围
    4. 相邻 chunk 保留适量重叠（overlap）以维持上下文
    5. 不同内容类型使用不同分块策略
    """
    
    # 分块参数
    MIN_TOKENS = 128                    # 最小 token 数
    MAX_TOKENS = 512                    # 最大 token 数  
    TARGET_TOKENS = 350                 # 目标 token 数
    OVERLAP_TOKENS = 50                 # 重叠 token 数
    OVERLAP_RATIO = 0.15                # 重叠比例（相对于 chunk 大小）
    
    # 特殊块不拆分：完整保留
    ATOMIC_BLOCK_TYPES = {
        BlockType.FORMULA,
        BlockType.TABLE,
        BlockType.CODE,
        BlockType.EXERCISE,
        BlockType.ANSWER,
    }
    
    async def chunk(self, parsed_doc: ParsedDocument) -> List[DocumentChunk]:
        """
        主分块流程：
        1. 按章节边界预分割
        2. 对每个章节段落进行内容块分组
        3. 合并/拆分到目标 token 范围
        4. 添加重叠窗口
        5. 为每个 chunk 标注元数据
        """
        chunks = []
        
        # Step 1: 按章节预分割
        section_groups = self._group_blocks_by_section(parsed_doc)
        
        for section_path, blocks in section_groups.items():
            # Step 2: 原子块单独成 chunk
            atomic_blocks = [b for b in blocks if b.block_type in self.ATOMIC_BLOCK_TYPES]
            text_blocks = [b for b in blocks if b.block_type not in self.ATOMIC_BLOCK_TYPES]
            
            # 原子块处理
            for block in atomic_blocks:
                chunk = self._create_chunk_from_atomic(block, section_path, parsed_doc)
                chunks.append(chunk)
            
            # Step 3: 文本块合并分块
            text_chunks = self._chunk_text_blocks(text_blocks, section_path, parsed_doc)
            chunks.extend(text_chunks)
        
        # Step 4: 编号与后处理
        for i, chunk in enumerate(chunks):
            chunk.chunk_index = i
        
        return chunks
    
    def _chunk_text_blocks(
        self, blocks: List[ContentBlock], section_path: str, doc: ParsedDocument
    ) -> List[DocumentChunk]:
        """
        文本块合并分块算法：
        - 使用滑动窗口，逐步累积内容块
        - 达到目标 token 数时输出一个 chunk
        - 下一个 chunk 从上一个 chunk 的尾部 overlap 处开始
        """
        chunks = []
        current_blocks = []
        current_tokens = 0
        
        i = 0
        while i < len(blocks):
            block = blocks[i]
            block_tokens = self._count_tokens(block.cleaned_text)
            
            # 单个块已超过最大 token 数 → 需要拆分
            if block_tokens > self.MAX_TOKENS:
                # 先输出当前累积的 chunk
                if current_blocks:
                    chunk = self._assemble_chunk(current_blocks, section_path, doc)
                    chunks.append(chunk)
                    current_blocks = []
                    current_tokens = 0
                
                # 拆分超大块
                sub_blocks = self._split_oversized_block(block)
                for sub in sub_blocks:
                    chunk = self._assemble_chunk([sub], section_path, doc)
                    chunks.append(chunk)
                i += 1
                continue
            
            # 累积后未超上限 → 继续累积
            if current_tokens + block_tokens <= self.MAX_TOKENS:
                current_blocks.append(block)
                current_tokens += block_tokens
                i += 1
            else:
                # 超上限 → 输出当前 chunk
                chunk = self._assemble_chunk(current_blocks, section_path, doc)
                chunks.append(chunk)
                
                # 计算重叠：保留尾部部分块
                overlap_blocks, overlap_tokens = self._compute_overlap(current_blocks)
                current_blocks = overlap_blocks
                current_tokens = overlap_tokens
        
        # 输出剩余内容
        if current_blocks:
            chunk = self._assemble_chunk(current_blocks, section_path, doc)
            chunks.append(chunk)
        
        return chunks
    
    def _compute_overlap(self, blocks: List[ContentBlock]) -> Tuple[List[ContentBlock], int]:
        """从块列表尾部计算重叠窗口"""
        overlap_blocks = []
        overlap_tokens = 0
        
        for block in reversed(blocks):
            block_tokens = self._count_tokens(block.cleaned_text)
            if overlap_tokens + block_tokens > self.OVERLAP_TOKENS:
                break
            overlap_blocks.insert(0, block)
            overlap_tokens += block_tokens
        
        return overlap_blocks, overlap_tokens
    
    def _split_oversized_block(self, block: ContentBlock) -> List[ContentBlock]:
        """
        拆分超大文本块
        策略优先级：
        1. 按自然段落拆分
        2. 按句号/问号拆分
        3. 按目标 token 数强制截断
        """
        text = block.cleaned_text
        
        # 策略1：按段落拆分
        paragraphs = text.split('\n\n')
        if len(paragraphs) > 1:
            return self._merge_splits(paragraphs, block)
        
        # 策略2：按句子拆分
        sentences = re.split(r'(?<=[。！？.!?])\s*', text)
        if len(sentences) > 1:
            return self._merge_splits(sentences, block)
        
        # 策略3：强制截断（最后手段）
        return self._force_split(block, self.TARGET_TOKENS)
    
    def _merge_splits(self, parts: List[str], original_block: ContentBlock) -> List[ContentBlock]:
        """将拆分后的片段重新合并为目标大小的块"""
        result = []
        current_text = ""
        current_tokens = 0
        
        for part in parts:
            part_tokens = self._count_tokens(part)
            if current_tokens + part_tokens > self.MAX_TOKENS and current_text:
                # 输出当前累积
                sub_block = self._create_sub_block(current_text, original_block)
                result.append(sub_block)
                current_text = ""
                current_tokens = 0
            current_text += part
            current_tokens += part_tokens
        
        if current_text:
            sub_block = self._create_sub_block(current_text, original_block)
            result.append(sub_block)
        
        return result
    
    def _create_chunk_from_atomic(
        self, block: ContentBlock, section_path: str, doc: ParsedDocument
    ) -> DocumentChunk:
        """从原子块（公式/表格/练习题等）创建独立 chunk"""
        content = block.markdown or block.cleaned_text
        
        # 对于公式块，确保 LaTeX 包裹完整
        if block.block_type == BlockType.FORMULA and block.latex:
            content = f"$$${block.latex}$$$"
        
        # 对于表格，同时保留 HTML 和文本
        if block.block_type == BlockType.TABLE:
            text_repr = self._table_to_text(block.html or block.cleaned_text)
            content = f"{text_repr}\n\n<!-- HTML: {block.html} -->"
        
        return DocumentChunk(
            chunk_id=str(uuid.uuid4()),
            chunk_type=block.block_type.value.upper(),
            content_text=content,
            content_markdown=block.markdown or content,
            section_path=section_path,
            page_number=block.page_number,
            token_count=self._count_tokens(content),
            char_count=len(content),
        )
    
    def _count_tokens(self, text: str) -> int:
        """
        Token 计数
        中文：约 1 字 = 1-2 token
        英文：约 4 字符 = 1 token
        公式：LaTeX 约 2-3 字符 = 1 token
        """
        # 粗略估算（生产环境用 tiktoken 精确计算）
        chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
        other_chars = len(text) - chinese_chars
        return int(chinese_chars * 1.5 + other_chars / 4)
```

**分块策略矩阵：**

| 内容类型 | 分块策略 | 目标大小 | 重叠 | 特殊处理 |
|----------|----------|----------|------|----------|
| 正文讲解 | 按段落→句子递进合并 | 300-400 token | 50 token | 保持段落完整性 |
| 数学公式 | 原子块不拆分 | 不限 | 无 | LaTeX 完整包裹 |
| 表格 | 原子块不拆分 | 不限（大表单独索引） | 无 | HTML + 文本双格式 |
| 练习题 | 题目+选项合一，答案分离 | 单题独立 | 无 | 选项不可与题干分离 |
| 图表说明 | 图文合并为一块 | ≤512 token | 30 token | OCR 文本与说明合并 |
| 章节标题 | 与后续内容合并 | 合并到后续块 | 无 | 标题作为块开头 |
| 代码示例 | 原子块不拆分 | 不限 | 无 | 保持代码缩进/格式 |

#### 3.2.5 Step 5: 元数据标注（TAGGING）

```python
class MetadataTagger:
    """分块元数据标注器"""
    
    def __init__(
        self,
        ner: EducationNER,
        kp_service: KnowledgePointService,
        chapter_service: ChapterService,
        difficulty_classifier: DifficultyClassifier,
        bloom_classifier: BloomClassifier,
    ):
        self.ner = ner
        self.kp_service = kp_service
        self.chapter_service = chapter_service
        self.difficulty_classifier = difficulty_classifier
        self.bloom_classifier = bloom_classifier
    
    async def tag(self, chunk: DocumentChunk, doc_meta: DocumentMetadata) -> DocumentChunk:
        """
        为分块标注完整的教育元数据
        """
        # 1. 继承文档级元数据
        chunk.subject = doc_meta.subject
        chunk.stage = doc_meta.stage
        chunk.grade_level = doc_meta.grade_level
        chunk.textbook_version = doc_meta.textbook_version
        
        # 2. 章节归属
        chapter = await self.chapter_service.find_by_path(chunk.section_path)
        if chapter:
            chunk.chapter_id = chapter.id
        
        # 3. 知识点关联（NER + 图谱匹配）
        entities = await self.ner.recognize(ContentBlock(
            block_id="temp",
            block_type=BlockType.TEXT,
            page_number=chunk.page_number or 0,
            section_path=chunk.section_path or "",
            raw_text=chunk.content_text,
            cleaned_text=chunk.content_text,
            markdown=chunk.content_markdown,
            latex=None, html=None,
            image_url=None, image_caption=None, ocr_text=None,
            bbox=None, reading_order=0
        ))
        
        kp_ids = [e.kp_id for e in entities if e.type == "KNOWLEDGE_POINT" and e.kp_id]
        chunk.knowledge_point_ids = list(set(kp_ids))  # 去重
        
        # 4. 难度评级
        if chunk.chunk_type in ("EXERCISE", "TABLE"):
            chunk.difficulty_level = await self.difficulty_classifier.classify(chunk.content_text)
        
        # 5. 认知层级
        chunk.cognitive_level = await self.bloom_classifier.classify(chunk.content_text)
        
        return chunk
```

#### 3.2.6 Step 6: 向量嵌入生成（EMBEDDING）

```python
class EmbeddingGenerator:
    """
    向量嵌入生成器
    将文本分块转换为高维向量，用于后续语义检索
    """
    
    MODEL_CONFIG = {
        "bge-large-zh-v1.5": {"dim": 1024, "max_tokens": 512, "lang": "zh"},
        "bge-m3": {"dim": 1024, "max_tokens": 8192, "lang": "multilingual"},
        "text-embedding-3-large": {"dim": 3072, "max_tokens": 8191, "lang": "multilingual"},
        "m3e-base": {"dim": 768, "max_tokens": 512, "lang": "zh"},
    }
    
    def __init__(
        self,
        model_name: str = "bge-large-zh-v1.5",
        batch_size: int = 32,
        rate_limiter: RateLimiter = None,
    ):
        self.model_name = model_name
        self.config = self.MODEL_CONFIG[model_name]
        self.batch_size = batch_size
        self.rate_limiter = rate_limiter or RateLimiter(max_calls=50, period=60)
    
    async def embed_chunks(self, chunks: List[DocumentChunk]) -> List[EmbeddingResult]:
        """
        批量生成分块向量
        """
        # 1. 检查 token 限制
        for chunk in chunks:
            if chunk.token_count and chunk.token_count > self.config["max_tokens"]:
                logger.warning(
                    f"Chunk {chunk.chunk_id} exceeds max tokens "
                    f"({chunk.token_count} > {self.config['max_tokens']}), truncating"
                )
                chunk.content_text = chunk.content_text[:self.config["max_tokens"] * 3]
        
        # 2. 构建嵌入输入：为内容添加上下文前缀，提升检索效果
        embed_inputs = [self._build_embed_input(chunk) for chunk in chunks]
        
        # 3. 分批调用嵌入模型
        all_embeddings = []
        for i in range(0, len(embed_inputs), self.batch_size):
            batch = embed_inputs[i:i + self.batch_size]
            async with self.rate_limiter:
                embeddings = await self._call_embedding_api(batch)
            all_embeddings.extend(embeddings)
        
        # 4. 组装结果
        results = []
        for chunk, embedding in zip(chunks, all_embeddings):
            results.append(EmbeddingResult(
                chunk_id=chunk.chunk_id,
                vector=embedding,
                model=self.model_name,
                dim=len(embedding),
            ))
        
        return results
    
    def _build_embed_input(self, chunk: DocumentChunk) -> str:
        """
        构建嵌入输入文本
        关键优化：加入学科/学段上下文前缀，使同知识点不同年级的块可区分
        """
        prefix_parts = []
        if chunk.subject:
            prefix_parts.append(f"[学科:{chunk.subject}]")
        if chunk.stage:
            prefix_parts.append(f"[学段:{chunk.stage}]")
        if chunk.section_path:
            prefix_parts.append(f"[章节:{chunk.section_path}]")
        
        prefix = " ".join(prefix_parts)
        return f"{prefix}\n{chunk.content_text}" if prefix else chunk.content_text
    
    async def _call_embedding_api(self, texts: List[str]) -> List[List[float]]:
        """
        调用嵌入模型 API
        支持多供应商切换：本地模型 / OpenAI / 智谱 / 百度
        """
        try:
            # 优先使用本地部署模型（成本低、延迟低）
            return await self._local_embed(texts)
        except Exception as e:
            logger.warning(f"Local embedding failed: {e}, falling back to API")
            # 降级到 API 调用
            return await self._api_embed(texts)
    
    async def _local_embed(self, texts: List[str]) -> List[List[float]]:
        """本地模型推理（使用 sentence-transformers）"""
        import asyncio
        loop = asyncio.get_event_loop()
        # 在线程池中运行（避免阻塞事件循环）
        embeddings = await loop.run_in_executor(
            None,
            self._local_model.encode,
            texts
        )
        return embeddings.tolist()
```

#### 3.2.7 Step 7: 质量校验（VALIDATING）

```python
class QualityValidator:
    """分块与向量质量校验器"""
    
    async def validate(self, chunks: List[DocumentChunk], embeddings: List[EmbeddingResult]) -> ValidationResult:
        """
        自动质量校验
        """
        issues = []
        
        for chunk, emb in zip(chunks, embeddings):
            chunk_issues = []
            
            # 1. 内容完整性检查
            if len(chunk.content_text.strip()) < 20:
                chunk_issues.append({"type": "TOO_SHORT", "severity": "WARN"})
            
            if chunk.content_text.count('\n') / max(len(chunk.content_text), 1) > 0.3:
                chunk_issues.append({"type": "EXCESSIVE_NEWLINES", "severity": "WARN"})
            
            # 2. 公式完整性检查
            if chunk.chunk_type == "FORMULA":
                if '$$' not in chunk.content_markdown and '$' not in chunk.content_markdown:
                    chunk_issues.append({"type": "FORMULA_MARKER_MISSING", "severity": "ERROR"})
            
            # 3. 知识点覆盖率检查
            if not chunk.knowledge_point_ids:
                chunk_issues.append({"type": "NO_KNOWLEDGE_POINT", "severity": "INFO"})
            
            # 4. 向量质量检查
            if emb and self._check_vector_quality(emb.vector):
                chunk_issues.append({"type": "VECTOR_ANOMALY", "severity": "WARN"})
            
            # 5. 重复内容检查
            content_hash = hashlib.sha256(chunk.content_text.encode()).hexdigest()
            if await self._is_duplicate(content_hash, chunk.subject):
                chunk_issues.append({"type": "DUPLICATE_CONTENT", "severity": "WARN"})
            
            # 6. 编码问题检查
            if '\ufffd' in chunk.content_text:  # Unicode 替换字符
                chunk_issues.append({"type": "ENCODING_ERROR", "severity": "ERROR"})
            
            if chunk_issues:
                chunk.quality_issues = [i["type"] for i in chunk_issues]
                chunk.quality_score = self._compute_quality_score(chunk_issues)
                chunk.needs_review = any(i["severity"] == "ERROR" for i in chunk_issues)
                issues.extend([(chunk, i) for i in chunk_issues])
            else:
                chunk.quality_score = 100.0
                chunk.needs_review = False
        
        return ValidationResult(
            total_chunks=len(chunks),
            clean_chunks=len(chunks) - len(set(c.chunk_id for c, _ in issues)),
            flagged_chunks=len(set(c.chunk_id for c, _ in issues)),
            needs_review_count=sum(1 for c in chunks if c.needs_review),
            issues=issues,
        )
    
    def _check_vector_quality(self, vector: List[float]) -> bool:
        """
        向量异常检测：
        - 零向量
        - 全相同值
        - 范数过大/过小
        """
        import numpy as np
        v = np.array(vector)
        norm = np.linalg.norm(v)
        if norm < 1e-6:
            return True  # 零向量
        if np.std(v) < 1e-6:
            return True  # 全相同值
        if norm < 0.1 or norm > 100:
            return True  # 范数异常
        return False
    
    def _compute_quality_score(self, issues: List[Dict]) -> float:
        """根据问题列表计算质量评分"""
        score = 100.0
        for issue in issues:
            if issue["severity"] == "ERROR":
                score -= 30
            elif issue["severity"] == "WARN":
                score -= 10
            elif issue["severity"] == "INFO":
                score -= 2
        return max(score, 0)
```

#### 3.2.8 Step 8: 入库与索引构建（INDEXING）

```python
class IndexingService:
    """入库与索引构建服务"""
    
    def __init__(
        self,
        vector_db: MilvusClient,
        search_engine: ElasticsearchClient,
        db: AsyncSession,
        dedup_service: DeduplicationService,
    ):
        self.vector_db = vector_db
        self.search_engine = search_engine
        self.db = db
        self.dedup_service = dedup_service
    
    async def index(
        self, chunks: List[DocumentChunk], embeddings: List[EmbeddingResult]
    ) -> IndexResult:
        """
        将分块和向量写入多个存储：
        1. MySQL: 结构化分块数据
        2. Milvus: 向量数据
        3. Elasticsearch: 全文搜索索引
        4. 去重索引表
        """
        indexed_chunks = []
        indexed_vectors = 0
        skipped_duplicates = 0
        
        # 批量准备
        mysql_records = []
        milvus_records = []
        es_records = []
        dedup_records = []
        
        for chunk, emb in zip(chunks, embeddings):
            # 去重检查
            if await self.dedup_service.is_exact_duplicate(chunk.content_hash):
                skipped_duplicates += 1
                continue
            
            # MySQL 记录
            mysql_records.append(self._to_mysql_dict(chunk, emb))
            
            # Milvus 记录
            milvus_records.append({
                "chunk_id": chunk.chunk_id,
                "embedding": emb.vector,
                "subject": chunk.subject,
                "stage": chunk.stage,
                "grade_level": chunk.grade_level or 0,
                "textbook_version": chunk.textbook_version or "",
                "chapter_id": chunk.chapter_id or "",
                "chunk_type": chunk.chunk_type,
                "difficulty_level": chunk.difficulty_level or "",
                "document_id": chunk.document_id,
                "version": chunk.version,
            })
            
            # ES 记录
            es_records.append({
                "_id": chunk.chunk_id,
                "_source": {
                    "chunk_id": chunk.chunk_id,
                    "content_text": chunk.content_text,
                    "content_markdown": chunk.content_markdown,
                    "subject": chunk.subject,
                    "stage": chunk.stage,
                    "chapter_id": chunk.chapter_id,
                    "knowledge_point_ids": chunk.knowledge_point_ids,
                    "section_path": chunk.section_path,
                    "chunk_type": chunk.chunk_type,
                    "difficulty_level": chunk.difficulty_level,
                    "is_active": True,
                }
            })
            
            # 去重记录
            dedup_records.append({
                "content_hash": chunk.content_hash,
                "chunk_id": chunk.chunk_id,
                "document_id": chunk.document_id,
                "subject": chunk.subject,
            })
            
            indexed_chunks.append(chunk)
            indexed_vectors += 1
        
        # 批量写入（事务性）
        await self._batch_write(mysql_records, milvus_records, es_records, dedup_records)
        
        return IndexResult(
            indexed_chunks=len(indexed_chunks),
            indexed_vectors=indexed_vectors,
            skipped_duplicates=skipped_duplicates,
        )
    
    async def _batch_write(
        self,
        mysql_records: List[Dict],
        milvus_records: List[Dict],
        es_records: List[Dict],
        dedup_records: List[Dict],
    ):
        """
        批量写入多个存储系统
        使用最终一致性策略：先写 MySQL，成功后异步写入 Milvus 和 ES
        """
        # Step 1: MySQL 写入（强一致性）
        async with self.db.begin():
            await self.db.execute(
                insert(DocumentChunk),
                mysql_records
            )
        
        # Step 2: Milvus 写入（异步，可重试）
        try:
            await self.vector_db.insert(collection_name="knowledge_chunks", data=milvus_records)
        except Exception as e:
            logger.error(f"Milvus insert failed: {e}")
            # 记录补偿任务
            await self._record_compensation("milvus_insert", milvus_records)
        
        # Step 3: ES 写入（异步，可重试）
        try:
            await self.search_engine.bulk_index(index="knowledge_chunks", documents=es_records)
        except Exception as e:
            logger.error(f"ES bulk index failed: {e}")
            await self._record_compensation("es_index", es_records)
        
        # Step 4: 去重索引写入
        if dedup_records:
            await self.db.execute(
                insert(ChunkDedupIndex),
                dedup_records
            )
```

---

## 4. 管线编排引擎

### 4.1 Pipeline Orchestrator

```python
class PipelineOrchestrator:
    """
    管线编排器：协调各步骤执行，管理状态流转、错误处理与补偿
    """
    
    # 步骤定义（顺序执行）
    STEPS = [
        ("PARSING",     DocumentParser),
        ("EXTRACTING",  MultiModalExtractor),
        ("NER",         EducationNER),
        ("CHUNKING",    SmartChunker),
        ("TAGGING",     MetadataTagger),
        ("EMBEDDING",   EmbeddingGenerator),
        ("VALIDATING",  QualityValidator),
        ("INDEXING",    IndexingService),
    ]
    
    def __init__(
        self,
        task_repo: TaskRepository,
        log_repo: PipelineLogRepository,
        notifier: ProgressNotifier,
        compensation_manager: CompensationManager,
    ):
        self.task_repo = task_repo
        self.log_repo = log_repo
        self.notifier = notifier
        self.compensation = compensation_manager
    
    async def execute(self, task_id: str) -> PipelineResult:
        """
        执行完整管线
        """
        task = await self.task_repo.get_by_task_id(task_id)
        if not task:
            raise TaskNotFoundError(f"Task not found: {task_id}")
        
        await self._update_status(task, "PARSING")
        
        context = PipelineContext(task=task)
        
        for step_name, processor_cls in self.STEPS:
            step_start = time.monotonic()
            
            try:
                processor = self._get_processor(processor_cls)
                context = await self._execute_step(processor, step_name, context)
                
                duration_ms = int((time.monotonic() - step_start) * 1000)
                await self._log_step(task, step_name, "SUCCESS", duration_ms, context)
                await self._update_progress(task, step_name)
                
            except RetryableError as e:
                # 可重试错误
                duration_ms = int((time.monotonic() - step_start) * 1000)
                await self._log_step(task, step_name, "FAILED", duration_ms, context, e)
                
                if task.retry_count < task.max_retry:
                    task.retry_count += 1
                    await self._retry_step(task, step_name, processor_cls, context)
                else:
                    await self._fail_task(task, step_name, e)
                    return PipelineResult(success=False, error=str(e))
                    
            except FatalError as e:
                # 不可恢复错误
                duration_ms = int((time.monotonic() - step_start) * 1000)
                await self._log_step(task, step_name, "FAILED", duration_ms, context, e)
                await self._fail_task(task, step_name, e)
                return PipelineResult(success=False, error=str(e))
        
        await self._complete_task(task, context)
        return PipelineResult(success=True, context=context)
    
    async def _execute_step(
        self, processor: Any, step_name: str, context: PipelineContext
    ) -> PipelineContext:
        """执行单个步骤，带超时控制"""
        timeout = self._get_step_timeout(step_name)
        
        async with asyncio.timeout(timeout):
            if step_name == "PARSING":
                context.parsed_doc = await processor.parse(context.task)
            elif step_name == "EXTRACTING":
                context.parsed_doc = await processor.extract(context.parsed_doc)
            elif step_name == "NER":
                context.entities = await self._batch_ner(processor, context.parsed_doc)
            elif step_name == "CHUNKING":
                context.chunks = await processor.chunk(context.parsed_doc)
            elif step_name == "TAGGING":
                context.chunks = await self._batch_tag(processor, context.chunks, context.parsed_doc.metadata)
            elif step_name == "EMBEDDING":
                context.embeddings = await processor.embed_chunks(context.chunks)
            elif step_name == "VALIDATING":
                context.validation = await processor.validate(context.chunks, context.embeddings)
            elif step_name == "INDEXING":
                context.index_result = await processor.index(context.chunks, context.embeddings)
        
        return context
    
    def _get_step_timeout(self, step_name: str) -> int:
        """各步骤超时配置（秒）"""
        timeouts = {
            "PARSING": 120,      # PDF 解析可能较慢
            "EXTRACTING": 180,   # OCR + 公式识别
            "NER": 60,
            "CHUNKING": 30,
            "TAGGING": 120,      # 知识点匹配可能较慢
            "EMBEDDING": 300,    # 批量嵌入调用
            "VALIDATING": 30,
            "INDEXING": 120,     # 多存储写入
        }
        return timeouts.get(step_name, 60)


@dataclass
class PipelineContext:
    """管线上下文：在各步骤间传递中间结果"""
    task: 'ParseTask'
    parsed_doc: Optional[ParsedDocument] = None
    entities: Dict[str, List[EducationEntity]] = None
    chunks: List[DocumentChunk] = None
    embeddings: List[EmbeddingResult] = None
    validation: Optional[ValidationResult] = None
    index_result: Optional[IndexResult] = None
```

### 4.2 步骤超时与重试策略

| 步骤 | 超时(秒) | 最大重试 | 重试退避策略 | 降级方案 |
|------|----------|----------|-------------|----------|
| PARSING | 120 | 3 | 指数退避 5s/10s/20s | 跳过无法解析的页，记录告警 |
| EXTRACTING | 180 | 2 | 固定 10s | 跳过 OCR，仅保留已有文本 |
| NER | 60 | 3 | 指数退避 3s/6s/12s | 跳过 LLM NER，仅用规则匹配 |
| CHUNKING | 30 | 1 | 固定 5s | 回退到固定长度切分 |
| TAGGING | 120 | 3 | 指数退避 5s/10s/20s | 知识点标注为空，后续人工补 |
| EMBEDDING | 300 | 3 | 指数退避 10s/30s/60s | 切换备用嵌入模型 |
| VALIDATING | 30 | 1 | 无 | 全部标记 needs_review |
| INDEXING | 120 | 3 | 指数退避 5s/10s/20s | 分存储独立重试，补偿任务保证最终一致 |

---

## 5. API 接口设计

### 5.1 提交解析任务

```
POST /api/v1/pipeline/tasks
```

**请求体：**
```json
{
    "document_id": 12345,
    "document_type": "PDF",
    "source_url": "https://oss.primetop.edu/docs/textbook/math/grade7/chapter3.pdf",
    "source_meta": {
        "uploader": "admin_001",
        "textbook_id": "tb_pep_math_7a",
        "chapter_ids": ["ch_3_1", "ch_3_2", "ch_3_3"],
        "subject": "MATH",
        "stage": "JUNIOR",
        "grade_level": 7,
        "textbook_version": "PEP"
    },
    "priority": 3,
    "callback_url": "https://cms.primetop.edu/api/pipeline/callback"
}
```

**响应：**
```json
{
    "code": 0,
    "data": {
        "task_id": "550e8400-e29b-41d4-a716-446655440000",
        "status": "PENDING",
        "created_at": "2026-07-12T10:00:00Z"
    }
}
```

### 5.2 查询任务状态

```
GET /api/v1/pipeline/tasks/{task_id}
```

**响应：**
```json
{
    "code": 0,
    "data": {
        "task_id": "550e8400-e29b-41d4-a716-446655440000",
        "status": "EMBEDDING",
        "progress": 75.0,
        "current_step": "EMBEDDING",
        "total_chunks": 142,
        "total_vectors": 98,
        "started_at": "2026-07-12T10:00:05Z",
        "steps": [
            {"name": "PARSING",     "status": "SUCCESS", "duration_ms": 3500, "completed_at": "2026-07-12T10:00:09Z"},
            {"name": "EXTRACTING",  "status": "SUCCESS", "duration_ms": 12000, "completed_at": "2026-07-12T10:00:21Z"},
            {"name": "NER",         "status": "SUCCESS", "duration_ms": 2300,  "completed_at": "2026-07-12T10:00:23Z"},
            {"name": "CHUNKING",    "status": "SUCCESS", "duration_ms": 800,   "completed_at": "2026-07-12T10:00:24Z"},
            {"name": "TAGGING",     "status": "SUCCESS", "duration_ms": 5600,  "completed_at": "2026-07-12T10:00:30Z"},
            {"name": "EMBEDDING",   "status": "RUNNING", "progress": "68%"},
            {"name": "VALIDATING",  "status": "PENDING"},
            {"name": "INDEXING",    "status": "PENDING"}
        ]
    }
}
```

### 5.3 查询分块列表

```
GET /api/v1/pipeline/tasks/{task_id}/chunks?page=1&page_size=20
```

### 5.4 人工审核分块

```
PUT /api/v1/pipeline/chunks/{chunk_id}/review
```

**请求体：**
```json
{
    "action": "APPROVE",           // APPROVE / REJECT / EDIT
    "edited_content": null,         // action=EDIT 时提供修改后的内容
    "edited_metadata": null,        // 修改后的元数据
    "review_comment": "公式渲染正确，知识点标注准确"
}
```

### 5.5 增量更新

```
POST /api/v1/pipeline/documents/{document_id}/reprocess
```

**请求体：**
```json
{
    "new_source_url": "https://oss.primetop.edu/docs/textbook/math/grade7/chapter3_v2.pdf",
    "update_reason": "教材修订版 v2.1",
    "diff_mode": true,             // 仅处理变更部分
    "deactivate_old": true          // 旧版本分块标记为 inactive
}
```

### 5.6 批量重嵌入

```
POST /api/v1/pipeline/re-embed
```

**请求体：**
```json
{
    "filter": {
        "subject": "MATH",
        "embedding_model": "bge-large-zh-v1.5"
    },
    "new_model": "bge-m3",
    "batch_size": 100,
    "dry_run": false
}
```

### 5.7 错误码定义

| 错误码 | HTTP状态码 | 说明 |
|--------|-----------|------|
| 30001 | 400 | 不支持的文档格式 |
| 30002 | 400 | 文档下载失败 |
| 30003 | 400 | 文档已损坏或加密 |
| 30004 | 409 | 任务已存在（重复提交） |
| 30005 | 404 | 任务不存在 |
| 30006 | 409 | 任务正在处理中，不可重复提交 |
| 30007 | 422 | OCR 服务不可用 |
| 30008 | 422 | 嵌入模型服务不可用 |
| 30009 | 422 | 公式识别失败 |
| 30010 | 500 | 向量数据库写入失败 |
| 30011 | 500 | 搜索引擎索引失败 |
| 30012 | 422 | 分块质量校验未通过（ERROR级别） |
| 30013 | 403 | 无权限操作该文档 |
| 30014 | 429 | 提交频率超限 |

---

## 6. 增量更新与教材修订处理

### 6.1 教材修订检测

```python
class TextbookRevisionHandler:
    """教材修订内容变更处理"""
    
    async def handle_revision(
        self, document_id: int, new_source_url: str, old_task_id: str
    ) -> str:
        """
        处理教材修订：
        1. 重新解析新版本文档
        2. 与旧版本分块进行内容对比
        3. 标记变更类型: ADDED / MODIFIED / DELETED / UNCHANGED
        4. 仅对变更分块重新生成向量
        5. 旧版本标记为 inactive
        """
        # 解析新版本
        new_task_id = await self.pipeline.submit_task(
            document_id=document_id,
            source_url=new_source_url,
            document_type="PDF",
        )
        
        # 等待解析完成
        await self.pipeline.wait_for_completion(new_task_id)
        
        # 获取新旧分块
        old_chunks = await self.chunk_repo.get_by_document(document_id, active_only=True)
        new_chunks = await self.chunk_repo.get_by_task(new_task_id)
        
        # 内容差异对比
        diff_result = self._diff_chunks(old_chunks, new_chunks)
        
        # 处理变更
        async with self.db.begin():
            # 标记旧分块
            for chunk in diff_result.deleted:
                chunk.is_active = False
                chunk.version += 1
                await self.chunk_repo.update(chunk)
            
            # 激活新分块
            for chunk in diff_result.added:
                chunk.is_active = True
                await self.chunk_repo.update(chunk)
            
            # 重新嵌入修改的分块
            for old_chunk, new_chunk in diff_result.modified:
                old_chunk.is_active = False
                await self.chunk_repo.update(old_chunk)
                new_chunk.is_active = True
                await self.chunk_repo.update(new_chunk)
        
        # 删除旧向量
        deleted_ids = [c.chunk_id for c in diff_result.deleted]
        deleted_ids += [old.chunk_id for old, _ in diff_result.modified]
        if deleted_ids:
            await self.vector_db.delete(ids=deleted_ids)
            await self.search_engine.delete(ids=deleted_ids)
        
        return new_task_id
    
    def _diff_chunks(
        self, old_chunks: List[DocumentChunk], new_chunks: List[DocumentChunk]
    ) -> DiffResult:
        """
        分块内容差异对比
        策略：先按 content_hash 精确匹配，再按位置+语义相似度模糊匹配
        """
        old_by_hash = {c.content_hash: c for c in old_chunks}
        new_by_hash = {c.content_hash: c for c in new_chunks}
        
        # 精确匹配（内容完全相同）
        exact_match_hashes = set(old_by_hash.keys()) & set(new_by_hash.keys())
        
        added = [new_by_hash[h] for h in set(new_by_hash.keys()) - exact_match_hashes]
        deleted = [old_by_hash[h] for h in set(old_by_hash.keys()) - exact_match_hashes]
        
        # 对未精确匹配的分块做语义相似度匹配（检测"修改"的分块）
        modified = []
        unmatched_new = added[:]
        unmatched_old = deleted[:]
        
        for old_chunk in list(unmatched_old):
            best_match = None
            best_score = 0
            for new_chunk in list(unmatched_new):
                if old_chunk.section_path != new_chunk.section_path:
                    continue
                score = self._text_similarity(old_chunk.content_text, new_chunk.content_text)
                if score > best_score:
                    best_score = score
                    best_match = new_chunk
            
            if best_match and best_score > 0.6:
                modified.append((old_chunk, best_match))
                unmatched_old.remove(old_chunk)
                unmatched_new.remove(best_match)
        
        added = unmatched_new
        deleted = unmatched_old
        
        return DiffResult(
            added=added,
            deleted=deleted,
            modified=modified,
            unchanged=[old_by_hash[h] for h in exact_match_hashes],
        )
```

---

## 7. 监控与告警

### 7.1 核心指标

| 指标 | 说明 | 告警阈值 |
|------|------|----------|
| `pipeline.task.pending_count` | 待处理任务积压数 | > 50 |
| `pipeline.task.failure_rate` | 任务失败率（24h） | > 5% |
| `pipeline.step.duration.{step}` | 各步骤平均耗时 | PARSING > 30s, EMBEDDING > 120s |
| `pipeline.chunk.quality_avg` | 分块平均质量评分 | < 80 |
| `pipeline.chunk.needs_review_rate` | 需人工审核比例 | > 15% |
| `pipeline.embedding.api_error_rate` | 嵌入 API 错误率 | > 3% |
| `pipeline.ocr.api_error_rate` | OCR API 错误率 | > 5% |
| `pipeline.dedup.duplicate_rate` | 重复内容比例 | > 20%（可能解析异常） |
| `pipeline.vector_db.write_latency` | 向量库写入延迟 | P99 > 5s |
| `pipeline.es.index_latency` | ES 索引延迟 | P99 > 3s |

### 7.2 监控看板

```
┌─────────────────────────────────────────────────────────┐
│              文档入库管线监控看板                          │
├──────────────┬──────────────┬───────────────────────────┤
│ 今日处理文档  │ 待处理任务    │ 失败任务                    │
│    156       │     3        │     2                     │
├──────────────┼──────────────┼───────────────────────────┤
│ 今日生成分块  │ 待审核分块    │ 重复率                     │
│   8,420      │    127       │   12.3%                   │
├──────────────┴──────────────┴───────────────────────────┤
│ 各步骤平均耗时 (24h)                                      │
│ PARSING     ████████████  2.3s                          │
│ EXTRACTING  ████████████████████  4.1s                  │
│ NER         ████  0.8s                                    │
│ CHUNKING    ██  0.4s                                      │
│ TAGGING     ██████████  1.9s                             │
│ EMBEDDING   ██████████████████████████  6.2s             │
│ VALIDATING  █  0.2s                                       │
│ INDEXING    ████████  1.5s                               │
├─────────────────────────────────────────────────────────┤
│ 各学科分块分布                                            │
│ MATH 35% | CHINESE 22% | ENGLISH 18% | PHYSICS 10% |... │
└─────────────────────────────────────────────────────────┘
```

---

## 8. 性能优化

### 8.1 并发与并行处理

```python
class ParallelPipelineExecutor:
    """
    并行管线执行器
    对于大型文档（>50页），将解析和提取阶段并行化
    """
    
    MAX_CONCURRENT_PAGES = 8     # 同时处理的页数
    MAX_CONCURRENT_OCR = 4       # 同时 OCR 的图片数（受 API 限流约束）
    MAX_CONCURRENT_EMBED = 2     # 同时嵌入批次（受 API 限流约束）
    
    async def parallel_extract(self, parsed_doc: ParsedDocument) -> ParsedDocument:
        """并行提取多页内容"""
        # 按页分组
        pages = self._group_blocks_by_page(parsed_doc.content_blocks)
        
        semaphore = asyncio.Semaphore(self.MAX_CONCURRENT_PAGES)
        
        async def process_page(page_num: int, blocks: List[ContentBlock]):
            async with semaphore:
                return await self.extractor.extract_page(blocks)
        
        tasks = [process_page(pn, blocks) for pn, blocks in pages.items()]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # 合并结果，处理异常
        all_blocks = []
        for result in results:
            if isinstance(result, Exception):
                logger.error(f"Page extraction failed: {result}")
                continue
            all_blocks.extend(result)
        
        parsed_doc.content_blocks = all_blocks
        return parsed_doc
    
    async def parallel_embed(self, chunks: List[DocumentChunk]) -> List[EmbeddingResult]:
        """并行批量嵌入"""
        batches = self._split_batches(chunks, self.embedder.batch_size)
        semaphore = asyncio.Semaphore(self.MAX_CONCURRENT_EMBED)
        
        async def embed_batch(batch):
            async with semaphore:
                return await self.embedder.embed_chunks(batch)
        
        results = await asyncio.gather(*[embed_batch(b) for b in batches])
        
        # 展平结果
        return [item for sublist in results for item in sublist]
```

### 8.2 嵌入缓存

```python
class EmbeddingCache:
    """
    向量嵌入缓存
    避免相同内容重复嵌入
    """
    
    def __init__(self, redis: RedisClient, ttl: int = 86400 * 30):  # 30天
        self.redis = redis
        self.ttl = ttl
        self.prefix = "embed:cache"
    
    async def get_or_compute(
        self, text: str, model: str, compute_fn: Callable
    ) -> List[float]:
        """缓存优先，避免重复嵌入"""
        cache_key = f"{self.prefix}:{model}:{hashlib.sha256(text.encode()).hexdigest()}"
        
        cached = await self.redis.get(cache_key)
        if cached:
            return json.loads(cached)
        
        vector = await compute_fn(text)
        await self.redis.setex(cache_key, self.ttl, json.dumps(vector))
        return vector
```

### 8.3 批量入库优化

```python
class BulkIndexOptimizer:
    """
    批量入库优化器
    将小任务合并为大批次，减少写入次数
    """
    
    BATCH_SIZE_MILVUS = 500     # Milvus 单次插入上限
    BATCH_SIZE_ES = 1000        # ES 批量索引上限
    FLUSH_INTERVAL = 30         # 积攒窗口（秒）
    
    async def batch_flush(self):
        """定时刷新积攒的待入库分块"""
        while True:
            await asyncio.sleep(self.FLUSH_INTERVAL)
            
            pending = await self.queue.drain(max_items=self.BATCH_SIZE_MILVUS)
            if not pending:
                continue
            
            # 按学科分组（减少索引碎片）
            groups = self._group_by_subject(pending)
            
            for subject, items in groups.items():
                try:
                    await self.indexer.index(items["chunks"], items["embeddings"])
                except Exception as e:
                    logger.error(f"Bulk index failed for {subject}: {e}")
                    await self.compensation.record(items)
```

---

## 9. 安全考虑

### 9.1 文档安全

- **下载鉴权**：从 OSS 下载原始文档时使用 STS 临时凭证，凭证有效期 15 分钟
- **敏感内容检测**：解析过程中检测是否包含答案/解析等需要权限管控的内容，自动标记 `contains_answer=True`
- **水印保留**：从原始 PDF 中提取水印信息，保留到元数据中

### 9.2 数据安全

- **向量脱敏**：嵌入向量本身不包含原始文本，但元数据中的 `section_path` 可能包含教材细节，检索 API 需校验用户是否有权访问对应教材版本
- **审计日志**：所有文档解析、修改、删除操作记录审计日志
- **PII 检测**：自动检测分块中是否包含个人身份信息（如教材中如有学生姓名），进行脱敏

---

## 10. 测试策略

### 10.1 单元测试

```python
class TestSmartChunker(unittest.IsolatedAsyncioTestCase):
    
    async def test_chunk_text_basic(self):
        """测试基础文本分块"""
        blocks = [
            ContentBlock(block_id="1", block_type=BlockType.TEXT, cleaned_text="函数是数学中的基本概念。"*50),
            ContentBlock(block_id="2", block_type=BlockType.TEXT, cleaned_text="一次函数 y=kx+b。"*30),
        ]
        chunker = SmartChunker()
        chunks = chunker._chunk_text_blocks(blocks, "第3章 > 3.1 函数", ParsedDocument(...))
        
        self.assertTrue(len(chunks) >= 1)
        for chunk in chunks:
            self.assertLessEqual(chunk.token_count, SmartChunker.MAX_TOKENS)
    
    async def test_atomic_block_not_split(self):
        """测试原子块不被拆分"""
        blocks = [
            ContentBlock(block_id="1", block_type=BlockType.FORMULA, 
                        cleaned_text="E = mc^2", latex="E = mc^2"),
        ]
        chunker = SmartChunker()
        parsed_doc = ParsedDocument(...)
        parsed_doc.content_blocks = blocks
        chunks = await chunker.chunk(parsed_doc)
        
        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].chunk_type, "FORMULA")
    
    async def test_overlap_between_chunks(self):
        """测试分块间的重叠窗口"""
        long_text = "这是一段很长的教育内容。" * 200
        blocks = [ContentBlock(block_id="1", block_type=BlockType.TEXT, cleaned_text=long_text)]
        chunker = SmartChunker()
        chunks = chunker._chunk_text_blocks(blocks, "test", ParsedDocument(...))
        
        if len(chunks) >= 2:
            # 验证第二个 chunk 的开头出现在第一个 chunk 的尾部
            overlap_text = chunks[1].content_text[:20]
            self.assertIn(overlap_text, chunks[0].content_text)
    
    async def test_oversized_block_split(self):
        """测试超大块拆分"""
        huge_text = "这是第一句话。" * 500 + "这是第二句话。" * 500
        block = ContentBlock(block_id="1", block_type=BlockType.TEXT, cleaned_text=huge_text)
        chunker = SmartChunker()
        sub_blocks = chunker._split_oversized_block(block)
        
        self.assertTrue(len(sub_blocks) > 1)
        for sub in sub_blocks:
            self.assertLessEqual(chunker._count_tokens(sub.cleaned_text), SmartChunker.MAX_TOKENS)
```

### 10.2 集成测试

| 测试场景 | 输入 | 预期结果 |
|----------|------|----------|
| PDF 教材完整解析 | 人教版七年级数学上册 PDF (80页) | 生成 300-500 个有效分块，所有分块有学科/章节标注 |
| 含公式文档解析 | 高中物理教材（含大量 LaTeX 公式） | 公式块 LaTeX 完整率 > 95% |
| 图片 OCR 解析 | 扫描版古诗文（纯图片 PDF） | OCR 文本准确率 > 90% |
| 表格结构化 | 化学元素周期表页面 | 表格结构完整，可还原为 HTML |
| 增量更新 | 教材 v1 → v2（变更 15% 内容） | 仅变更部分重新向量化，旧版本正确标记 inactive |
| 去重检测 | 同一文档重复提交 | 第二次提交去重率 > 80% |
| 多格式混合 | 含文本+图片+公式的综合文档 | 各类型内容正确识别和分块 |
| 大文件压力 | 200 页综合教材 | 30 分钟内完成全流程 |
| 嵌入模型切换 | 从 bge-large 切换到 bge-m3 | 批量重嵌入成功，检索功能正常 |
| OCR 降级 | OCR 服务不可用 | 文本提取正常部分不受影响，图片块标记 needs_review |

### 10.3 性能基准

| 指标 | 目标值 | 测试条件 |
|------|--------|----------|
| PDF 解析速度 | ≥ 5 页/秒 | 标准教材 PDF（文字版，非扫描） |
| OCR 速度 | ≥ 2 页/秒 | 扫描版页面（百度/腾讯 OCR API） |
| 分块速度 | ≥ 1000 块/秒 | 纯文本处理 |
| 嵌入速度 | ≥ 50 块/秒 | BGE-large-zh 本地推理 |
| 全流程吞吐 | ≥ 10 文档/分钟 | 平均 50 页文档 |
| 端到端延迟 | < 5 分钟 | 100 页教材 PDF |

---

## 11. 部署架构

### 11.1 服务部署

```
┌────────────────────────────────────────────────────────┐
│                    Kubernetes 集群                       │
│                                                        │
│  ┌─────────────────────┐                               │
│  │ pipeline-api        │  (3 replicas)                 │
│  │ REST API / 任务管理  │                               │
│  └──────────┬──────────┘                               │
│             │                                          │
│  ┌──────────▼──────────┐                               │
│  │ pipeline-worker     │  (2-10 replicas, HPA)         │
│  │ 管线执行引擎         │  CPU密集型，按队列深度自动伸缩   │
│  └──────────┬──────────┘                               │
│             │                                          │
│  ┌──────────▼──────────┐                               │
│  │ embedding-worker    │  (1-4 replicas)               │
│  │ GPU 节点，本地模型推理│  需要 GPU 资源               │
│  └─────────────────────┘                               │
│                                                        │
│  ┌─────────────────────┐                               │
│  │ review-service      │  (2 replicas)                 │
│  │ 人工审核工作台后端    │                               │
│  └─────────────────────┘                               │
│                                                        │
│  外部依赖:                                              │
│  ├── MySQL (分块/任务/日志)                             │
│  ├── Redis (缓存/队列)                                  │
│  ├── Milvus (向量数据库)                                │
│  ├── Elasticsearch (全文索引)                           │
│  ├── MinIO/OSS (文档存储)                              │
│  └── OCR API (百度/腾讯/PaddleOCR)                      │
└────────────────────────────────────────────────────────┘
```

### 11.2 配置参数

```yaml
# pipeline-config.yaml
pipeline:
  worker:
    min_replicas: 2
    max_replicas: 10
    hpa_target_cpu: 70
    hpa_target_queue_depth: 20
    
  parsing:
    max_file_size_mb: 200
    supported_formats: ["pdf", "docx", "doc", "html", "markdown", "image", "pptx"]
    page_timeout_sec: 30
    
  chunking:
    target_tokens: 350
    min_tokens: 128
    max_tokens: 512
    overlap_tokens: 50
    
  embedding:
    model: "bge-large-zh-v1.5"
    fallback_model: "m3e-base"
    batch_size: 32
    max_concurrent: 2
    cache_ttl_days: 30
    
  ocr:
    provider: "baidu"          # baidu / tencent / paddle
    fallback_provider: "paddle"
    max_concurrent: 4
    rate_limit_per_min: 50
    
  quality:
    min_quality_score: 60
    auto_approve_threshold: 85
    mandatory_review_types: ["EXERCISE", "ANSWER"]
    
  indexing:
    batch_size: 500
    flush_interval_sec: 30
    compensation_retry_max: 5
```

---

## 12. 版本演进路线

| 阶段 | 目标 | 关键能力 |
|------|------|----------|
| V1.0 (MVP) | 基础管线运转 | PDF/Word 解析、文本分块、基础嵌入、入库 |
| V1.5 | 多模态增强 | OCR 集成、公式识别、表格结构化、图片描述 |
| V2.0 | 智能化提升 | LLM 辅助 NER、自动难度评级、语义去重、增量更新 |
| V2.5 | 质量闭环 | 自动质量评分、人工审核工作台、A/B 嵌入模型对比 |
| V3.0 | 规模化运营 | 多租户隔离、跨语言支持、实时增量入库、PaaS 化 |
