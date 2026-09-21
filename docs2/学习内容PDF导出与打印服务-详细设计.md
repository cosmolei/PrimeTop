# 学习内容PDF导出与打印服务 - 详细设计

## 1. 模块概述

### 1.1 定位与边界

学习内容PDF导出与打印服务（PDF Export Service, PES）为 PrimeTop 提供统一的学习内容导出能力，支持将错题本、学习报告、知识点总结、笔记、练习册等多种学习资料导出为排版精美的 PDF 文件，方便打印、分享和离线复习。

**与相邻模块的关系：**

| 模块 | 交互方式 |
|------|---------|
| 错题整理 | PES 消费错题数据，按学科/章节/时间范围导出错题本 PDF |
| 学习报告生成与交付服务 | 学习报告本身支持 PDF 渲染，PES 提供共享渲染基础设施 |
| 收藏与笔记系统 | PES 消费笔记数据，导出结构化笔记 PDF |
| 知识点体系与教材映射引擎 | PES 消费知识点树和考点清单，导出知识图谱/考点总结 |
| 练习与测评系统 | PES 消费练习/试卷数据，导出可打印练习卷 |
| 会员与权益系统 | PDF 导出次数受会员等级控制，非会员有配额限制 |
| 文件与资源存储服务 | 生成的 PDF 通过 OSS 存储，返回 CDN 下载链接 |
| 作文辅导 | 支持导出作文批改报告（含批注、评分、范文对照） |

**一句话边界：PES = 模板管理 + 内容聚合 + PDF渲染引擎 + 配额管控 + 打印优化。**

### 1.2 设计目标

| 目标 | 说明 |
|------|------|
| 排版精美 | PDF 输出符合教育场景排版规范，公式、图表、步骤清晰可辨 |
| 类型丰富 | 支持 6+ 种导出内容类型，覆盖主要学习资料场景 |
| 打印友好 | 支持 A4/B5 纸张，含标准页眉页脚、页码、装订留白 |
| 异步可靠 | 大量内容导出采用异步任务，支持进度查询和失败重试 |
| 配额管控 | PDF 导出受会员等级配额限制，防止滥用 |
| 分龄适配 | 幼儿/小学导出内容使用大字体、多彩排版；初中/高中使用紧凑排版 |

### 1.3 非目标

1. 不负责内容生成（内容由各业务模块提供）
2. 不负责在线 PDF 编辑或批注
3. 不负责物理打印机对接（用户自行打印导出的文件）

---

## 2. 导出内容类型与模板体系

### 2.1 导出内容类型枚举

```python
class ExportContentType(str, Enum):
    """PDF导出内容类型"""
    MISTAKE_BOOK = "mistake_book"             # 错题本
    STUDY_REPORT = "study_report"             # 学习报告（周报/月报）
    KNOWLEDGE_SUMMARY = "knowledge_summary"   # 知识点/考点总结
    NOTE_COLLECTION = "note_collection"       # 笔记合集
    EXERCISE_SHEET = "exercise_sheet"         # 练习卷/试卷
    ESSAY_REVIEW = "essay_review"             # 作文批改报告
    STUDY_PLAN = "study_plan"                 # 学习计划表
```

### 2.2 导出模板定义

每种内容类型对应一套模板，模板定义包含：

```python
class ExportTemplate(BaseModel):
    """导出模板"""
    template_id: str                          # 模板唯一ID
    content_type: ExportContentType           # 内容类型
    name: str                                 # 模板名称
    description: str                          # 模板描述
    
    # 页面配置
    page_config: PageConfig
    
    # 样式配置
    style_config: StyleConfig
    
    # 内容区段定义
    sections: list[TemplateSection]
    
    # 水印配置
    watermark: WatermarkConfig | None
    
    # 版本与状态
    version: int                              # 模板版本号
    is_active: bool                           # 是否启用
    min_age_group: AgeGroup | None            # 最低适用学段
    max_age_group: AgeGroup | None            # 最高适用学段


class PageConfig(BaseModel):
    """页面配置"""
    paper_size: PaperSize = PaperSize.A4      # 纸张大小
    orientation: PageOrientation = PageOrientation.PORTRAIT  # 纸张方向
    margin_top: float = 20.0                  # 上边距 mm
    margin_bottom: float = 20.0
    margin_left: float = 15.0
    margin_right: float = 15.0
    header_height: float = 12.0               # 页眉高度 mm
    footer_height: float = 10.0               # 页脚高度 mm
    binding_margin: float = 0.0               # 装订留白 mm（双面打印时）
    dpi: int = 150                            # 渲染DPI


class PaperSize(str, Enum):
    A4 = "a4"           # 210mm × 297mm
    B5 = "b5"           # 176mm × 250mm
    A5 = "a5"           # 148mm × 210mm（口袋尺寸）
    LETTER = "letter"   # 8.5" × 11"（北美标准）


class PageOrientation(str, Enum):
    PORTRAIT = "portrait"     # 纵向
    LANDSCAPE = "landscape"   # 横向（适合含大量图表的内容）


class StyleConfig(BaseModel):
    """样式配置"""
    font_family: str = "NotoSansSC"           # 主字体
    font_size_body: float = 10.5              # 正文字号 pt
    font_size_title: float = 18.0             # 标题字号
    font_size_subtitle: float = 14.0          # 副标题
    font_size_caption: float = 8.0            # 注释字号
    line_height: float = 1.6                  # 行高倍数
    primary_color: str = "#1A73E8"            # 主色调
    accent_color: str = "#FF6D00"             # 强调色
    bg_color: str = "#FFFFFF"                 # 背景色
    text_color: str = "#333333"               # 正文色
    use_color: bool = True                    # 是否使用彩色（可关闭以节省墨水）


class TemplateSection(BaseModel):
    """模板区段"""
    section_id: str                           # 区段ID
    section_type: SectionType                 # 区段类型
    title: str | None                         # 区段标题
    order: int                                # 排序序号
    break_before: bool = False                # 是否在此区段前分页
    config: dict                              # 区段特定配置


class SectionType(str, Enum):
    COVER = "cover"                           # 封面
    TABLE_OF_CONTENTS = "toc"                 # 目录
    SUMMARY = "summary"                       # 概要统计
    CONTENT_LIST = "content_list"             # 内容列表（题目/笔记等）
    CHART = "chart"                           # 图表区段
    TEXT = "text"                             # 纯文本区段
    GRID_TABLE = "grid_table"                 # 表格区段
    KNOWLEDGE_MAP = "knowledge_map"           # 知识图谱可视化
    BLANK_ANSWER_SHEET = "blank_answer"       # 空白答题区
    FOOTER = "footer"                         # 结尾


class WatermarkConfig(BaseModel):
    """水印配置"""
    enabled: bool = False
    text: str = ""                            # 水印文字
    opacity: float = 0.1                      # 透明度
    angle: float = -45.0                      # 旋转角度
    font_size: float = 24.0
```

### 2.3 各类型模板详情

#### 2.3.1 错题本导出模板

```python
MISTAKE_BOOK_TEMPLATE = ExportTemplate(
    template_id="tpl_mistake_book_v1",
    content_type=ExportContentType.MISTAKE_BOOK,
    name="错题本打印版",
    page_config=PageConfig(
        paper_size=PaperSize.A4,
        orientation=PageOrientation.PORTRAIT,
        margin_top=20, margin_bottom=20,
        margin_left=20, margin_right=15,
        binding_margin=10,  # 左侧装订留白
    ),
    sections=[
        TemplateSection(section_id="cover", section_type=SectionType.COVER, order=1),
        TemplateSection(section_id="stats", section_type=SectionType.SUMMARY, order=2,
                       title="错题统计概览"),
        TemplateSection(section_id="toc", section_type=SectionType.TABLE_OF_CONTENTS, order=3),
        TemplateSection(section_id="mistakes", section_type=SectionType.CONTENT_LIST, order=4,
                       title="错题详情", break_before=True),
        TemplateSection(section_id="review_plan", section_type=SectionType.GRID_TABLE, order=5,
                       title="复习计划"),
    ],
)
```

**封面内容：**
- 学生姓名（可选脱敏）
- 学科名称 + 教材版本
- 时间范围（如"2026年春季学期"）
- 错题数量统计
- 导出日期

**错题详情区段渲染规则：**
- 每道错题占一个独立卡片块
- 排版顺序：题干 → 我的答案（红色标注错误处）→ 正确答案（绿色）→ 解析步骤 → 知识点标签 → 错因标签
- 数学公式使用 LaTeX 渲染
- 几何图形/化学结构图以矢量方式嵌入
- 如果含图片（拍题原图），缩放至合适尺寸嵌入
- 每题之间以分隔线区分
- 同一知识点错题归组显示

#### 2.3.2 练习卷导出模板

```python
EXERCISE_SHEET_TEMPLATE = ExportTemplate(
    template_id="tpl_exercise_sheet_v1",
    content_type=ExportContentType.EXERCISE_SHEET,
    name="练习卷打印版",
    page_config=PageConfig(
        paper_size=PaperSize.A4,
        orientation=PageOrientation.PORTRAIT,
        margin_top=25, margin_bottom=20,
        margin_left=20, margin_right=20,
    ),
    sections=[
        TemplateSection(section_id="header", section_type=SectionType.COVER, order=1),
        TemplateSection(section_id="questions", section_type=SectionType.CONTENT_LIST, order=2),
        TemplateSection(section_id="answer_sheet", section_type=SectionType.BLANK_ANSWER_SHEET, order=3,
                       break_before=True, title="答题卡"),
    ],
)
```

**练习卷头部：**
- 标题（如"数学-函数专题-练习卷"）
- 副标题（知识范围、题目数量、预计用时）
- 学生信息栏（姓名____ 班级____ 日期____ 得分____）
- 注意事项（如"考试时间：45分钟"）

**题目区段规则：**
- 题目编号自动生成（一、二、三... 或 1、2、3...）
- 按题型分组排列（选择 → 填空 → 计算 → 证明）
- 选择题选项竖排，每行一个选项
- 大题预留答题空白区域（可配置高度）
- 数学公式渲染为标准印刷格式

**答题卡区段（可选）：**
- 选择题涂卡区域（标准 15×4 grid）
- 填空题答题框
- 可通过模板配置关闭

#### 2.3.3 知识点总结模板

```python
KNOWLEDGE_SUMMARY_TEMPLATE = ExportTemplate(
    template_id="tpl_knowledge_summary_v1",
    content_type=ExportContentType.KNOWLEDGE_SUMMARY,
    name="知识点总结打印版",
    page_config=PageConfig(
        paper_size=PaperSize.A4,
        orientation=PageOrientation.PORTRAIT,
    ),
    sections=[
        TemplateSection(section_id="cover", section_type=SectionType.COVER, order=1),
        TemplateSection(section_id="map", section_type=SectionType.KNOWLEDGE_MAP, order=2,
                       title="知识点关联图"),
        TemplateSection(section_id="points", section_type=SectionType.CONTENT_LIST, order=3,
                       title="知识点详解"),
        TemplateSection(section_id="formulas", section_type=SectionType.GRID_TABLE, order=4,
                       title="公式速查表", break_before=True),
        TemplateSection(section_id="common_mistakes", section_type=SectionType.CONTENT_LIST, order=5,
                       title="常见易错点"),
    ],
)
```

---

## 3. 数据结构设计

### 3.1 导出任务表

```sql
CREATE TABLE pdf_export_tasks (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_id         VARCHAR(36) NOT NULL UNIQUE COMMENT '任务UUID',
    user_id         BIGINT NOT NULL COMMENT '发起用户ID',
    content_type    VARCHAR(32) NOT NULL COMMENT '导出内容类型(ExportContentType)',
    template_id     VARCHAR(64) NOT NULL COMMENT '使用的模板ID',
    
    -- 导出参数
    export_params   JSON NOT NULL COMMENT '导出参数(类型相关)',
    /* mistake_book: {"subject_id":"math","chapter_ids":[1,2,3],"date_from":"2026-01-01","date_to":"2026-05-25","include_analysis":true,"include_images":true}
       exercise_sheet: {"exercise_ids":[101,102,103],"show_answer":false,"show_analysis":false,"blank_answer_sheet":true}
       study_report: {"report_id":"rpt_xxx","include_charts":true}
       knowledge_summary: {"subject_id":"math","chapter_id":5,"include_formulas":true,"include_map":true}
       note_collection: {"note_ids":["n1","n2"],"sort_by":"created_at"}
       essay_review: {"essay_id":"e123","include_original":true,"include_model":true}
       study_plan: {"plan_id":"p456","date_range":"week"}
    */
    
    -- 纸张与打印选项
    paper_size      VARCHAR(8) DEFAULT 'a4' COMMENT '纸张大小',
    orientation     VARCHAR(16) DEFAULT 'portrait' COMMENT '纸张方向',
    use_color       BOOLEAN DEFAULT TRUE COMMENT '是否彩色',
    include_answer  BOOLEAN DEFAULT TRUE COMMENT '是否包含答案(练习卷场景)',
    
    -- 任务状态
    status          VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/processing/completed/failed/cancelled',
    progress_pct    TINYINT DEFAULT 0 COMMENT '进度百分比0-100',
    current_step    VARCHAR(64) DEFAULT NULL COMMENT '当前处理步骤描述',
    
    -- 结果
    file_key        VARCHAR(256) DEFAULT NULL COMMENT 'OSS文件key',
    file_size_bytes BIGINT DEFAULT NULL COMMENT '文件大小(字节)',
    page_count      SMALLINT DEFAULT NULL COMMENT '页数',
    download_url    VARCHAR(512) DEFAULT NULL COMMENT 'CDN下载链接',
    expires_at      DATETIME DEFAULT NULL COMMENT '下载链接过期时间',
    
    -- 配额追踪
    quota_consumed  BOOLEAN DEFAULT FALSE COMMENT '是否已扣减配额',
    
    -- 错误信息
    error_code      VARCHAR(32) DEFAULT NULL COMMENT '错误码',
    error_message   TEXT DEFAULT NULL COMMENT '错误详情',
    retry_count     TINYINT DEFAULT 0 COMMENT '重试次数',
    
    -- 时间戳
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at      DATETIME DEFAULT NULL,
    completed_at    DATETIME DEFAULT NULL,
    
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_created (created_at),
    INDEX idx_content_type (content_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PDF导出任务表';
```

### 3.2 导出配额表

```sql
CREATE TABLE pdf_export_quotas (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id         BIGINT NOT NULL UNIQUE COMMENT '用户ID',
    
    -- 月度配额
    monthly_limit   SMALLINT NOT NULL DEFAULT 3 COMMENT '每月导出上限',
    monthly_used    SMALLINT NOT NULL DEFAULT 0 COMMENT '本月已用次数',
    period_start    DATE NOT NULL COMMENT '当前计费周期起始日',
    
    -- 累计统计
    total_exports   INT NOT NULL DEFAULT 0 COMMENT '历史总导出次数',
    
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_period (period_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PDF导出配额表';
```

### 3.3 导出模板管理表

```sql
CREATE TABLE pdf_export_templates (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    template_id     VARCHAR(64) NOT NULL UNIQUE COMMENT '模板唯一标识',
    content_type    VARCHAR(32) NOT NULL COMMENT '内容类型',
    name            VARCHAR(128) NOT NULL COMMENT '模板名称',
    description     VARCHAR(512) DEFAULT NULL COMMENT '模板描述',
    
    -- 模板配置(JSON存储完整模板定义)
    template_config JSON NOT NULL COMMENT '完整模板配置(ExportTemplate序列化)',
    
    -- 适用范围
    min_age_group   VARCHAR(16) DEFAULT NULL COMMENT '最低适用学段',
    max_age_group   VARCHAR(16) DEFAULT NULL COMMENT '最高适用学段',
    is_premium      BOOLEAN DEFAULT FALSE COMMENT '是否仅会员可用',
    
    -- 状态与版本
    version         INT NOT NULL DEFAULT 1 COMMENT '版本号',
    is_active       BOOLEAN DEFAULT TRUE COMMENT '是否启用',
    is_default      BOOLEAN DEFAULT FALSE COMMENT '是否为该类型的默认模板',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_content_type (content_type),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PDF导出模板管理表';
```

### 3.4 核心数据流模型

```python
class ExportRequest(BaseModel):
    """导出请求（客户端 → 服务端）"""
    content_type: ExportContentType           # 导出类型
    template_id: str | None = None            # 模板ID（空则使用默认模板）
    export_params: dict                       # 类型相关参数
    paper_size: PaperSize = PaperSize.A4
    orientation: PageOrientation = PageOrientation.PORTRAIT
    use_color: bool = True
    include_answer: bool = True               # 练习卷是否含答案


class ExportResult(BaseModel):
    """导出结果"""
    task_id: str
    status: str                               # pending/processing/completed/failed
    progress_pct: int = 0
    current_step: str | None = None
    file: FileInfo | None = None
    error: ErrorInfo | None = None


class FileInfo(BaseModel):
    """文件信息"""
    download_url: str
    file_size_bytes: int
    page_count: int
    filename: str
    expires_at: datetime


class ErrorInfo(BaseModel):
    """错误信息"""
    code: str
    message: str
    retryable: bool
```

---

## 4. API 接口设计

### 4.1 创建导出任务

```
POST /api/v1/pdf-exports
```

**请求体：**
```json
{
    "content_type": "mistake_book",
    "export_params": {
        "subject_id": "math",
        "chapter_ids": [101, 102, 103],
        "date_from": "2026-01-01",
        "date_to": "2026-05-25",
        "include_analysis": true,
        "include_images": true,
        "sort_by": "chapter",
        "group_by_knowledge_point": true
    },
    "paper_size": "a4",
    "orientation": "portrait",
    "use_color": true,
    "include_answer": true
}
```

**响应 202 Accepted：**
```json
{
    "code": 0,
    "data": {
        "task_id": "550e8400-e29b-41d4-a716-446655440000",
        "status": "pending",
        "progress_pct": 0,
        "current_step": "排队中",
        "estimated_wait_seconds": 15,
        "quota_remaining": 7
    }
}
```

**错误码：**

| 错误码 | 说明 | HTTP状态码 |
|--------|------|-----------|
| EXPORT_QUOTA_EXCEEDED | 本月导出配额已用完 | 429 |
| EXPORT_CONTENT_EMPTY | 导出内容为空（如无错题） | 422 |
| EXPORT_CONTENT_TOO_LARGE | 内容超过最大限制（100页/50MB） | 422 |
| EXPORT_INVALID_PARAMS | 参数不合法 | 400 |
| EXPORT_PREMIUM_ONLY | 该模板仅会员可用 | 403 |

### 4.2 查询导出进度

```
GET /api/v1/pdf-exports/{task_id}
```

**响应 200：**
```json
{
    "code": 0,
    "data": {
        "task_id": "550e8400-e29b-41d4-a716-446655440000",
        "status": "processing",
        "progress_pct": 45,
        "current_step": "正在渲染第3页/共约7页",
        "estimated_wait_seconds": 10
    }
}
```

**完成状态响应：**
```json
{
    "code": 0,
    "data": {
        "task_id": "550e8400-e29b-41d4-a716-446655440000",
        "status": "completed",
        "progress_pct": 100,
        "current_step": "导出完成",
        "file": {
            "download_url": "https://cdn.primetop.com/exports/550e8400.pdf?sign=xxx",
            "file_size_bytes": 2457600,
            "page_count": 7,
            "filename": "错题本-数学-2026春季.pdf",
            "expires_at": "2026-05-26T12:00:00+08:00"
        }
    }
}
```

### 4.3 导出历史列表

```
GET /api/v1/pdf-exports?page=1&page_size=20&content_type=mistake_book&status=completed
```

**响应 200：**
```json
{
    "code": 0,
    "data": {
        "items": [
            {
                "task_id": "550e8400-...",
                "content_type": "mistake_book",
                "status": "completed",
                "file": {
                    "download_url": "...",
                    "file_size_bytes": 2457600,
                    "page_count": 7,
                    "filename": "错题本-数学-2026春季.pdf",
                    "expires_at": "2026-05-26T12:00:00+08:00"
                },
                "created_at": "2026-05-25T19:30:00+08:00"
            }
        ],
        "total": 15,
        "page": 1,
        "page_size": 20
    }
}
```

### 4.4 获取导出配额

```
GET /api/v1/pdf-exports/quota
```

**响应 200：**
```json
{
    "code": 0,
    "data": {
        "monthly_limit": 20,
        "monthly_used": 3,
        "monthly_remaining": 17,
        "period_start": "2026-05-01",
        "period_end": "2026-05-31",
        "membership_tier": "annual"
    }
}
```

### 4.5 获取可用模板列表

```
GET /api/v1/pdf-exports/templates?content_type=mistake_book
```

**响应 200：**
```json
{
    "code": 0,
    "data": {
        "items": [
            {
                "template_id": "tpl_mistake_book_v1",
                "name": "标准错题本",
                "description": "按章节分组，含解析和知识点标签",
                "is_default": true,
                "is_premium": false,
                "preview_url": "https://cdn.primetop.com/templates/preview/mistake_v1.png"
            },
            {
                "template_id": "tpl_mistake_book_compact_v1",
                "name": "紧凑错题本",
                "description": "每题更紧凑，适合大量错题打印",
                "is_default": false,
                "is_premium": true,
                "preview_url": "https://cdn.primetop.com/templates/preview/mistake_compact_v1.png"
            }
        ]
    }
}
```

### 4.6 取消导出任务

```
POST /api/v1/pdf-exports/{task_id}/cancel
```

**响应 200：**
```json
{
    "code": 0,
    "data": {
        "task_id": "550e8400-...",
        "status": "cancelled"
    }
}
```

### 4.7 预览导出内容（预估）

```
POST /api/v1/pdf-exports/preview
```

**请求体：** 与创建导出任务相同

**响应 200：**
```json
{
    "code": 0,
    "data": {
        "estimated_page_count": 7,
        "estimated_file_size_bytes": 2400000,
        "content_summary": {
            "total_items": 23,
            "by_chapter": {
                "第三章 函数": 8,
                "第四章 三角函数": 15
            }
        },
        "will_consume_quota": true,
        "quota_remaining_after": 16
    }
}
```

---

## 5. PDF 渲染引擎设计

### 5.1 技术选型

| 方案 | 说明 | 选定 |
|------|------|------|
| WeasyPrint | Python 原生，HTML/CSS → PDF，支持 CSS Paged Media | ✅ 主渲染引擎 |
| ReportLab | Python，编程式 PDF 生成，精确控制排版 | 备选，用于复杂图表 |


**选型理由：**

1. WeasyPrint 对 CSS Paged Media 规范支持最完整（@page 规则、named pages、running headers/footers、page counters），是"打印友好"需求的最佳匹配。
2. 纯 Python 技术栈，与现有数据聚合服务（Python/FastAPI）同构，无需额外引入 Node 运行时。
3. KaTeX 服务端渲染快于 MathJax（单次 <5ms/公式），且输出 SVG 可无损缩放嵌入 PDF。
4. matplotlib 输出 SVG 矢量图嵌入 HTML，随 WeasyPrint 一并转为 PDF 矢量对象。

**渲染服务部署形态：** 独立微服务 `pdf-render-service`（Python 3.11 + FastAPI + WeasyPrint），与任务编排层通过 Redis Stream 解耦。渲染为 CPU 密集型操作，单页渲染约 200-800ms。

### 5.2 渲染管线架构

```text
导出任务(pending)
    │
    ▼
[Stage 1: 内容聚合]  ──► 按 content_type 调用对应内容聚合器，拉取原始数据
    │                      （错题/报告/笔记/知识点/练习/作文/计划）
    ▼
[Stage 2: 内容适配]  ──► 数据 → 模板区段模型（SectionData）
    │                      公式转 LaTeX、图片转内嵌资源、文本清洗
    ▼
[Stage 3: HTML 生成] ──► Jinja2 模板 + 样式配置 → 完整 HTML 文档
    │
    ▼
[Stage 4: 公式/图表渲染] ──► KaTeX(matplotlib) 渲染 → SVG 内联
    │
    ▼
[Stage 5: PDF 合成]  ──► WeasyPrint HTML→PDF（分页、页眉页脚、目录）
    │
    ▼
[Stage 6: 后处理]    ──► 元数据写入（标题/作者/页数）、水印叠加、文件大小检查
    │
    ▼
[Stage 7: 上传存储]  ──► 流式上传 OSS → 生成 CDN 签名 URL
    │
    ▼
任务(completed) + 下发下载通知
```

**各阶段延迟预算（A4 约 20 页典型任务）：**

| 阶段 | 预算 | 说明 |
|------|------|------|
| Stage 1 内容聚合 | ≤2s | 批量 RPC 拉取，并行进行 |
| Stage 2 内容适配 | ≤1s | 纯计算 |
| Stage 3 HTML 生成 | ≤500ms | Jinja2 渲染 |
| Stage 4 公式/图表 | ≤3s | 公式数量相关，KaTeX 单公式 <5ms |
| Stage 5 PDF 合成 | ≤15s | 页数相关，约 500ms/页 |
| Stage 6 后处理 | ≤1s | pypdf 元数据 |
| Stage 7 上传存储 | ≤2s | 流式上传 |
| **总计 P99** | **≤30s** | 超预算任务标记 slow_render |

### 5.3 HTML 中间表示

渲染引擎不直接操作原始数据，而是经"内容适配层"将各类型数据转换为统一的中间模型：

```python
class SectionData(BaseModel):
    """渲染区段统一中间模型"""
    section_id: str
    section_type: SectionType
    title: str | None
    items: list[BlockItem]                    # 有序块列表

class BlockItem(BaseModel):
    """块级元素（题目/段落/表格/图表等）"""
    block_type: BlockType                     # QUESTION / PARAGRAPH / FORMULA / TABLE / CHART / IMAGE / DIVIDER / TAG_ROW
    content: str                              # 主内容（HTML 安全文本或 LaTeX）
    sub_content: str | None = None            # 次级内容（如解析步骤）
    metadata: dict = {}                       # 扩展信息（难度、知识点、错因等）
    children: list["BlockItem"] = []          # 嵌套块（题目→选项/解析）
    page_break_before: bool = False           # 强制分页

class RenderContext(BaseModel):
    """渲染上下文"""
    task_id: str
    template: ExportTemplate
    student_name: str                         # 可脱敏
    student_grade: str | None
    generated_at: datetime
    content_meta: dict                        # 类型相关元数据
```

**内容聚合器注册表（按 content_type 路由）：**

```python
class ContentAggregator(Protocol):
    async def aggregate(self, user_id: int, params: dict) -> list[SectionData]: ...

AGGREGATOR_REGISTRY: dict[ExportContentType, ContentAggregator] = {
    ExportContentType.MISTAKE_BOOK: MistakeBookAggregator(),           # → 错题服务 RPC
    ExportContentType.STUDY_REPORT: StudyReportAggregator(),           # → 学习报告服务 RPC
    ExportContentType.KNOWLEDGE_SUMMARY: KnowledgeSummaryAggregator(), # → 知识点服务 RPC
    ExportContentType.NOTE_COLLECTION: NoteCollectionAggregator(),     # → 笔记服务 RPC
    ExportContentType.EXERCISE_SHEET: ExerciseSheetAggregator(),       # → 练习服务 RPC
    ExportContentType.ESSAY_REVIEW: EssayReviewAggregator(),           # → 作文服务 RPC
    ExportContentType.STUDY_PLAN: StudyPlanAggregator(),               # → 规划服务 RPC
}
```

### 5.4 数学公式渲染

- 源数据中的公式以 LaTeX 字符串存储（与《学科公式 LaTeX 统一解析与多端渲染管线引擎》契约一致）。
- 渲染管线用 **KaTeX 服务端渲染**输出 SVG，内联进 HTML。
- KaTeX 不支持的环境自动降级为 matplotlib mathtext 渲染 PNG @300dpi。
- **渲染失败兜底：** 公式渲染异常时原样输出 LaTeX 源码文本（不做静默丢弃），并在 PDF 页脚统计区记录 degraded_formulas 数量。

```python
class FormulaRenderer:
    async def render(self, latex: str, display_mode: bool) -> str:
        try:
            return katex.render_to_string(latex, display_mode=display_mode)
        except KaTeXError:
            return self._matplotlib_fallback(latex, display_mode)
        except Exception:
            # 绝不静默丢弃：原样输出 + 标记
            return f'<code class="latex-fallback">{html.escape(latex)}</code>'
```

### 5.5 图表渲染

| 图表类型 | 引擎 | 输出 |
|----------|------|------|
| 学习时长/正确率统计图 | matplotlib | SVG 内联 |
| 能力雷达图 | matplotlib (polar) | SVG 内联 |
| 知识图谱关系图 | networkx 布局 + matplotlib | SVG 内联 |
| 进度曲线 | matplotlib | SVG 内联 |

所有图表使用与模板一致的配色（primary_color/accent_color），DPI≥150，字体使用与正文一致的 NotoSansSC 保证视觉统一。

### 5.6 打印优化

1. **字体嵌入：** NotoSansSC 子集化嵌入（仅导出内容用到的字形，通常 <1MB），公式字体（KaTeX fonts）按需嵌入。
2. **灰度安全：** `use_color=false` 时全部转为灰度配色（primary_color → #333333），图表同步转灰度，保证黑白打印可读。
3. **分页控制：**
   - 题目块不允许跨页截断（`break-inside: avoid`）；
   - 区段标题与首块保持同页（`break-after: avoid`）；
   - 长解析自动在步骤边界分页，步骤内容不截断。
4. **页眉页脚：** 每页页眉显示导出类型+学生（脱敏）+日期；页脚显示页码（第 X / 共 Y 页）+ 平台水印信息。
5. **装订留白：** `binding_margin>0` 时左/右边距按奇偶页交替（CSS `@page :left/:right` 实现双面打印）。
6. **文件体积控制：** 图片超过 300KB 自动重采样至 150dpi JPEG；单文件硬上限 50MB（超出即失败 EXPORT_CONTENT_TOO_LARGE）。

---

## 6. 核心处理流程

### 6.1 导出任务创建时序

```text
客户端            API网关           ExportOrchestrator      配额服务        Redis Stream      Render Worker
  │ 创建导出         │                  │                     │                │                │
  ├─────────────────►│ 鉴权/参数校验     │                     │                │                │
  │                  ├─────────────────►│                     │                │                │
  │                  │                  ├─ 1. 配额预检(remaining>0)              │                │
  │                  │                  ├────────────────────►│                │                │
  │                  │                  │◄──── monthly_remaining│                │                │
  │                  │                  ├─ 2. 模板校验/默认模板选择              │                │
  │                  │                  ├─ 3. 落库 task(status=pending)          │                │
  │                  │                  ├─ 4. XADD render:queue                    │                │
  │                  │◄─────────────────┤                     │                │                │
  │◄─────────────────┤ 202 {task_id}    │                     │                │                │
  │                  │                  │                     │                │ XREADGROUP     │
  │                  │                  │                     │                ├───────────────►│
  │  轮询进度        │                  │                     │                │                │
  ├─ GET /{task_id}►│                  │                     │                │                │
  │◄─────────────────┤ status/progress  │                     │                │                │
```

### 6.2 渲染 Worker 处理流程

```python
async def process_render_task(task_id: str):
    task = await db.get_task(task_id)
    # CAS 抢占：pending → processing（防多 Worker 重复消费）
    if not await db.cas_status(task_id, "pending", "processing", expected_version=task.version):
        return
    try:
        await db.update_progress(task_id, 5, "正在聚合内容")
        sections = await aggregate_content(task)           # Stage 1-2

        await db.update_progress(task_id, 30, "正在生成文档")
        html = await render_html(task.template, sections)   # Stage 3-4

        await db.update_progress(task_id, 60, "正在渲染 PDF")
        pdf_bytes = await render_pdf(html, task.template)   # Stage 5-6

        await db.update_progress(task_id, 85, "正在上传")
        file_key, download_url = await upload_to_oss(task, pdf_bytes)  # Stage 7

        # 事务：状态完成 + 配额扣减 + Outbox 事件
        async with db.transaction():
            await db.cas_status(task_id, "processing", "completed")
            await db.fill_result(task_id, file_key, download_url, page_count, size)
            if not task.quota_consumed:
                await quota_service.consume(task.user_id, task_id)
            await outbox.insert("pdf_export.completed", {...})
    except QuotaExceededError as e:
        await fail_task(task_id, "EXPORT_QUOTA_EXCEEDED", e)
    except ContentEmptyError as e:
        await fail_task(task_id, "EXPORT_CONTENT_EMPTY", e)
    except RenderTimeoutError:
        # 超时：允许重试一次，仍失败则标记 failed
        if task.retry_count < 1:
            await retry_task(task_id)
        else:
            await fail_task(task_id, "EXPORT_RENDER_TIMEOUT", ...)
    except Exception as e:
        await fail_task(task_id, "EXPORT_INTERNAL_ERROR", e)
```

### 6.3 配额扣减时机（关键裁决）

**裁决：配额在任务创建时"预占"，渲染成功后"确认"，失败/取消时"释放"。** 避免"渲染半天最后因配额失败"的糟糕体验，也避免刷接口消耗配额。

```text
创建任务 ──► 预占配额（monthly_used+1, reserved=true）──► 渲染成功 ──► 确认（reserved=false）
                                    │
                                    └──► 失败/取消 ──► 释放配额（monthly_used-1）
```

- 预占与释放在同一事务内更新 `pdf_export_quotas`；
- 任务 TTL：pending 超过 30 分钟未消费自动释放配额并标记 expired；
- 释放幂等：`quota_release_log (task_id)` 唯一键，重复释放请求直接返回成功。

---

## 7. 导出任务状态机与守卫

### 7.1 状态机

```text
              创建成功                 渲染成功                OSS上传成功
                 │                       │                       │
  ┌────┐    ┌────▼─────┐    ┌─────────┐  │   ┌──────────┐   ┌────▼──────┐
  │pending├──►processing├──►│completed│◄─┴──►│completed │──►│completed  │
  └─┬──┘    └────┬─────┘    └─────────┘      └──────────┘   └───────────┘
    │            │
    │ 取消/超时  │ 渲染失败(可重试且retry_count<1)
    ▼            ▼
  cancelled    retrying ──► processing
    │            │
    │            │ 重试仍失败
    │            ▼
    │          failed
    │
    │ 配额预占超时(30min未消费)
    └────► expired（自动释放配额）
```

状态集合：`pending / processing / retrying / completed / failed / cancelled / expired`

### 7.2 状态守卫表

| 守卫 | 规则 | 说明 |
|------|------|------|
| G1 | pending→processing 需 CAS 抢占 | 仅一个 Worker 可领取任务 |
| G2 | completed 为终态，不可逆 | 文件已生成不可变更 |
| G3 | cancelled 仅允许自 pending/retrying | processing 中取消需先中断 Worker 并回收配额 |
| G4 | failed 允许客户端"重新导出"（创建新任务） | 不重跑旧任务，保证审计链完整 |
| G5 | expired 仅由扫描器产生 | 用户不可见 expired，列表查询映射为 failed |
| G6 | 配额预占/释放/确认必须与状态迁移同事务 | 防配额泄漏 |
| G7 | include_answer=false 的练习卷 completed 后，若用户再次请求含答案版本，视为新任务 | 答案属敏感内容，不缓存复用 |

### 7.3 幂等设计

- **创建幂等：** 客户端携带 `Idempotency-Key`（或 client_token），服务端按 `(user_id, client_token)` 唯一约束 24h 去重，命中直接返回已有任务。
- **取消幂等：** cancel 操作重复调用返回当前状态，不报错。
- **配额操作幂等：** `quota_release_log(task_id)` 唯一键。
- **上传幂等：** OSS key = `exports/{user_id}/{task_id}.pdf`，天然幂等（覆盖写安全，内容确定性）。

---

## 8. API 错误码总表

| 错误码 | HTTP | 客户端提示 | 可重试 |
|--------|------|-----------|--------|
| EXPORT_QUOTA_EXCEEDED | 429 | 本月导出次数已用完，升级会员获得更多次数 | 否 |
| EXPORT_CONTENT_EMPTY | 422 | 所选范围内没有可导出的内容 | 否 |
| EXPORT_CONTENT_TOO_LARGE | 422 | 内容过多（超100页/50MB），请缩小时间范围或章节 | 否 |
| EXPORT_INVALID_PARAMS | 400 | 参数有误，请检查选择项 | 否 |
| EXPORT_PREMIUM_ONLY | 403 | 该模板为会员专属 | 否 |
| EXPORT_TASK_NOT_FOUND | 404 | 任务不存在或已过期 | 否 |
| EXPORT_TASK_ALREADY_CANCELLED | 409 | 任务已取消 | 否 |
| EXPORT_RENDER_TIMEOUT | 500 | 生成超时，请稍后重试 | 是 |
| EXPORT_INTERNAL_ERROR | 500 | 系统繁忙，请稍后重试 | 是 |
| EXPORT_UPSTREAM_UNAVAILABLE | 503 | 内容服务暂不可用，请稍后重试 | 是 |

**错误码段：** 服务端内部占用 `50500-50599`；客户端映射 `0305xx` 段（030501-030509）。

---

## 9. 事件设计

### 9.1 Outbox 事件（producer = pdf-export-service）

| 事件 | 时机 | 关键载荷 | 消费方 |
|------|------|----------|--------|
| pdf_export.completed | 导出成功 | task_id, user_id, content_type, page_count, file_size | 通知中心（"你的资料已生成"站内信）、埋点平台 |
| pdf_export.failed | 导出失败 | task_id, user_id, error_code | 通知中心（失败提醒+重试引导）、监控告警 |
| pdf_export.quota_consumed | 配额确认 | user_id, task_id, monthly_used | 会员权益统计 |

### 9.2 消费的上游事件

| 事件 | 用途 |
|------|------|
| membership.activated / membership.expired | 刷新月度配额上限（免费 3 次/月，月度会员 20 次/月，年度会员 50 次/月） |
| user.data_erasure_requested | 注销时清理未过期导出文件与配额记录（延迟 7 天执行，对齐数据导出与账户注销链路） |

---

## 10. 监控与告警

| 指标 | 口径 | 告警阈值 |
|------|------|----------|
| render_success_rate | 成功任务/完成任务 | <95% 持续 15min → P2 |
| render_p99_seconds | 渲染总耗时 P99 | >45s 持续 10min → P2 |
| queue_backlog | render:queue 未消费条数 | >500 → P2；>2000 → P1 |
| dlq_count | 渲染失败入死信数 | 任意增加 → P2 |
| quota_release_leak | reserved=true 超过 1h 的配额记录数 | >0 → P2（配额泄漏） |
| slow_render_ratio | 超 30s 任务占比 | >10% → P3 |
| oss_upload_fail | 上传失败率 | >1% → P2 |

**容量估算（DAU 50 万，导出渗透率 3%）：**
- 日导出任务 ≈ 1.5 万，峰值 ≈ 3 QPS；
- 平均任务 20 页/2MB → 日新增 OSS 存储 ≈ 30GB；文件保留 30 天 → 在线存储 ≈ 900GB；
- Render Worker：3 QPS × 平均 8s/任务 ≈ 24 并发 → 部署 8 实例（2C4G）留 3 倍余量。

---

## 11. 安全与合规

1. **未成年人内容安全：** 导出内容均来自平台内容；笔记导出前校验 UGC 审核状态，未过审笔记不导出。
2. **个人信息脱敏：** 封面学生姓名默认输出，导出参数 `student_name_mode` = `full / first_only / anonymous` 控制；分享场景建议 `anonymous`。
3. **下载链接安全：** CDN URL 携带 HMAC 签名，有效期 24h（`expires_at`），过期重新请求获取新链接（不消耗配额）。
4. **水印：** 免费用户导出添加浅水印 "PrimeTop 免费导出"；会员导出无可见水印。PDF 元数据（Creator/Producer）不含内部系统信息。
5. **数据保留：** 导出文件 OSS 保留 30 天后转低频存储，90 天后删除；任务记录保留（下载链接失效）。
6. **答案管控对齐：** 练习卷导出 `include_answer` 默认 false，传 true 仅会员可用且答案页单独分页（便于教师收答案页），与《答案管控与渐进式提示引擎》红线一致。
7. **防刷：** 同一用户同内容类型 1 分钟内限创建 3 个任务（Redis 计数），超限返回 429。

---

## 12. 验收场景

| # | 场景 | 预期 |
|---|------|------|
| 1 | 导出数学错题本（含公式/图片） | PDF 公式清晰、图片清晰、按章节分组、含错因标签 |
| 2 | 导出无错题的错题本 | 返回 EXPORT_CONTENT_EMPTY |
| 3 | 免费用户导出第 4 次 | 返回 EXPORT_QUOTA_EXCEEDED，提示会员权益 |
| 4 | 会员导出超月度上限 | 同上 |
| 5 | 取消 pending 任务 | 状态 cancelled，配额释放 |
| 6 | 取消 processing 任务 | Worker 中断，配额释放，状态 cancelled |
| 7 | 重复点击创建（同 client_token） | 返回同一 task_id，不产生重复任务 |
| 8 | 渲染超时 | 自动重试 1 次；仍失败标记 failed 并通知 |
| 9 | 下载链接过期后重新请求 | 返回新链接，不扣配额 |
| 10 | 练习卷 include_answer=false | PDF 无答案内容，含独立答题卡 |
| 11 | 黑白打印模式（use_color=false） | 输出灰度 PDF，图表灰度可读 |
| 12 | 双面打印（binding_margin=10） | 奇偶页边距交替正确 |
| 13 | 大量错题（>100 页） | 返回 EXPORT_CONTENT_TOO_LARGE |
| 14 | 模板渲染中图片 >300KB | 自动重采样至 150dpi，文件不超限 |
| 15 | KaTeX 不支持的公式 | 降级 matplotlib 渲染，不静默丢弃 |
| 16 | OSS 上传失败 | 任务 failed，可重试，配额已释放 |
| 17 | 注销用户的数据擦除 | 7 天内导出文件删除，任务记录清除下载链接 |
| 18 | 同模板并发 10 任务 | 队列正常消化，无任务丢失或重复渲染 |

---

## 13. 关联文档

- 《客户端-错题打印与PDF导出页面架构与交互设计.md》— 客户端发起导出与进度展示
- 《统一文件生成与异步报表导出中心服务-详细设计.md》— 通用异步文件生成协议（复用其任务进度查询协议）
- 《答案管控与渐进式提示引擎-详细设计.md》— 练习卷答案管控红线
- 《教育内容数字版权保护与内容安全分发系统-详细设计.md》— 水印与分发安全
- 《用户学习画像与能力维度模型-详细设计.md》— 报告数据来源
- 《数据导出与账户注销服务-详细设计.md》— 注销数据擦除联动

---

**v1.1 维护记录（2026-09-20）**：本文档原版本截断于 §5.1 技术选型表结束处，§5.2 及之后全部缺失。本次补全：§5.1 补选型理由与部署形态、§5.2 七阶段渲染管线图与延迟预算表、§5.3 SectionData 中间模型与聚合器注册表、§5.4 KaTeX 公式渲染与失败兜底、§5.5 图表渲染矩阵、§5.6 打印优化六条、§6 创建时序图与 Worker 处理代码（CAS 抢占/配额同事务）、§6.3 配额预占-确认-释放三段式裁决、§7 七态状态机与守卫 G1-G7 与四层幂等、§8 错误码总表（50500-50599/0305xx 映射）、§9 Outbox 三事件与两上游订阅、§10 监控七指标与 DAU50 万容量估算、§11 合规七条、§12 验收场景 18 条、§13 关联文档。
