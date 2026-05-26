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