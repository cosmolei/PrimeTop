# 客户端-错题打印与PDF导出页面架构与交互设计

## 1. 文档概述

### 1.1 文档目的

本文档详细设计错题打印与 PDF 导出功能的客户端页面架构、交互流程、组件设计和状态管理，为前端开发人员提供可直接编码落地的技术规范。

### 1.2 功能定位

学生（或家长）可从错题本中选择错题，配置打印/导出选项，预览 PDF 效果，最终生成 PDF 文件用于下载、分享或直接打印。核心场景包括：

1. **错题打印练习**：导出空白试卷供学生线下重做，强化记忆。
2. **错题复习手册**：导出含解析的错题集用于考前回顾。
3. **家长查看报告**：家长端导出孩子错题统计 PDF。
4. **教师批量导出**：教师端导出班级/学生错题统计（B 端扩展）。

### 1.3 依赖关系

| 依赖模块 | 说明 |
| --- | --- |
| 错题整理模块 | 提供错题数据源、筛选能力 |
| 学习内容PDF导出与打印服务 | 服务端 PDF 渲染与生成 |
| 题目展示与答题交互组件库 | 复用题目渲染组件 |
| 文件与资源存储服务 | PDF 文件存储与下载链接 |
| 收藏与笔记系统 | 可从笔记/收藏中导出 |
| 客户端文件上传服务与断点续传机制 | 大文件下载管理 |

### 1.4 学段适配策略

| 学段 | 导出能力 | 交互特点 |
| --- | --- | --- |
| 幼儿 | 仅家长可操作 | 大图标、简单操作、家长验证 |
| 小学 | 学生+家长可操作 | 引导式操作、推荐模板 |
| 初中 | 学生为主 | 完整功能、快捷操作 |
| 高中 | 学生自主 | 高级选项、批量操作、自定义排版 |

---

## 2. 页面架构

### 2.1 页面流程图

```
错题本页面 ─────────────────────┐
  │  [导出/打印] 按钮           │
  ▼                             │
┌─────────────────────┐         │
│  错题选择页面        │◄─ 收藏/笔记等入口
│  (多选 + 筛选)       │
└────────┬────────────┘
         │ [下一步]
         ▼
┌─────────────────────┐
│  导出配置页面        │
│  (模板/选项/排版)    │
└────────┬────────────┘
         │ [预览]
         ▼
┌─────────────────────┐
│  PDF预览页面         │
│  (翻页预览 + 编辑)   │
└────────┬────────────┘
         │ [导出/打印]
         ▼
┌─────────────────────┐
│  导出结果页面        │
│  (下载/分享/打印)    │
└─────────────────────┘
```

### 2.2 页面清单

| 页面 | 路由 | 说明 |
| --- | --- | --- |
| 错题选择页面 | `/export/select` | 选择要导出的错题 |
| 导出配置页面 | `/export/config` | 配置导出格式与选项 |
| PDF 预览页面 | `/export/preview` | 预览生成效果 |
| 导出结果页面 | `/export/result` | 下载/分享/打印入口 |

---

## 3. 错题选择页面

### 3.1 页面布局

```
┌─────────────────────────────────┐
│  ◀ 选择错题            [全选]   │  ← 导航栏
├─────────────────────────────────┤
│  📂 学科: 全部 ▾   章节: 全部 ▾ │  ← 筛选栏
│  🏷️ 错因: 全部 ▾   难度: 全部 ▾ │
├─────────────────────────────────┤
│  已选 12 题   推荐上限 50 题    │  ← 选择状态栏
├─────────────────────────────────┤
│  ┌─────────────────────────┐    │
│  │ ☑ [数学] 二次函数最值问题 │    │
│  │    错因: 计算失误 · 2026.03 │    │
│  │    ─────────────────────│    │
│  │    已知 f(x)=-x²+4x+3... │    │  ← 错题卡片（可多选）
│  └─────────────────────────┘    │
│  ┌─────────────────────────┐    │
│  │ ☐ [物理] 牛顿第二定律    │    │
│  │    错因: 概念不清 · 2026.03 │    │
│  │    ─────────────────────│    │
│  │    质量为 m 的物体在...   │    │
│  └─────────────────────────┘    │
│           ...                    │
├─────────────────────────────────┤
│  [快速选择: 薄弱知识点] [按日期] │  ← 快捷操作栏
├─────────────────────────────────┤
│  ████████ 下一步 (12题已选) ████ │  ← 底部操作栏
└─────────────────────────────────┘
```

### 3.2 筛选器组件

#### 3.2.1 筛选维度

```dart
/// 错题筛选条件数据模型
class MistakeFilter {
  /// 学科ID列表
  final List<String>? subjectIds;
  
  /// 章节ID列表（依赖学科选择联动）
  final List<String>? chapterIds;
  
  /// 知识点ID列表
  final List<String>? knowledgePointIds;
  
  /// 错因标签
  final List<MistakeCause> causes;
  
  /// 难度范围 [min, max] (1-5)
  final (int, int)? difficultyRange;
  
  /// 日期范围
  final DateRange? dateRange;
  
  /// 掌握状态
  final MasteryStatus? masteryStatus;
  
  /// 题目类型
  final List<QuestionType>? questionTypes;
}
```

#### 3.2.2 筛选交互

1. **学科选择**：下拉多选，选择后联动刷新章节选项
2. **章节选择**：树形结构展示（学期 → 单元 → 章节），支持展开折叠
3. **错因筛选**：标签式多选（概念不清 / 计算失误 / 审题错误 / 方法错误 / 粗心大意 / 其他）
4. **难度筛选**：滑块选择范围（1星~5星）
5. **日期范围**：快捷选项（近7天 / 近30天 / 本学期 / 自定义）
6. **掌握状态**：未掌握 / 部分掌握 / 已掌握

#### 3.2.3 智能推荐选择

```dart
/// 快速选择策略
enum QuickSelectStrategy {
  /// 薄弱知识点：选择掌握度最低的知识点关联错题
  weakKnowledgePoints,
  /// 高频错题：选择错误次数最多的题目
  highFrequency,
  /// 待复习：选择到期的复习错题
  dueForReview,
  /// 近期错题：最近7天新增错题
  recentMistakes,
  /// 考前冲刺：与目标考试相关的错题
  examRelated,
}
```

### 3.3 选择状态管理

```dart
/// 错题选择状态
class MistakeSelectionState {
  /// 已选题目ID集合
  final Set<String> selectedIds;
  
  /// 当前筛选结果总数
  final int totalCount;
  
  /// 最大可选数量（限制50题，避免PDF过大）
  static const int maxSelection = 50;
  
  /// 推荐数量（根据知识点覆盖推荐）
  final int recommendedCount;
  
  /// 是否全选
  bool get isAllSelected => selectedIds.length == totalCount;
  
  /// 选择数量是否达到上限
  bool get isAtLimit => selectedIds.length >= maxSelection;
  
  /// 预估PDF页数
  int get estimatedPages => (selectedIds.length / 4).ceil(); // 约每页4题
}
```

### 3.4 列表虚拟化

由于错题列表可能很长（数百至数千条），采用虚拟滚动 + 分页加载：

```dart
/// 分页参数
class MistakeListPagination {
  static const int pageSize = 20;
  int currentPage = 0;
  bool hasMore = true;
  
  /// 滚动到距离底部 200px 时触发加载更多
  static const double loadMoreThreshold = 200.0;
}
```

---

## 4. 导出配置页面

### 4.1 页面布局

```
┌─────────────────────────────────┐
│  ◀ 导出配置                     │
├─────────────────────────────────┤
│                                 │
│  📋 选择模板                    │
│  ┌──────┐ ┌──────┐ ┌──────┐    │
│  │练习册│ │复习册│ │错题报│    │  ← 模板卡片横滑选择
│  │(空白)│ │(含解析)│ │告   │    │
│  │  ✅  │ │      │ │      │    │
│  └──────┘ └──────┘ └──────┘    │
│                                 │
│  ── 排版设置 ─────────────────  │
│                                 │
│  纸张方向:  ○ 纵向  ● 横向      │
│  每页题数:  [2] [3] [●4] [6]   │
│  字体大小:  ○ 小  ● 中  ○ 大    │
│                                 │
│  ── 内容选项 ─────────────────  │
│                                 │
│  ● 题目内容              默认开启│
│  ☑ 答题空间/横线         默认开启│
│  ☐ 解题步骤              默认关闭│
│  ☐ 知识点标签            默认关闭│
│  ☐ 错因记录              默认关闭│
│  ☑ 学生订正记录          默认开启│
│  ☐ 同类练习题            默认关闭│
│                                 │
│  ── 页眉页脚 ─────────────────  │
│                                 │
│  页眉: ☑ 姓名  ☑ 日期  ☐ 班级  │
│  页脚: ☑ 页码  ☐ 总题数        │
│                                 │
├─────────────────────────────────┤
│  📄 预估: 12题 / 约3页 / A4纸   │
│  ████████████ 预览 PDF ████████ │
└─────────────────────────────────┘
```

### 4.2 导出模板定义

#### 4.2.1 模板数据结构

```dart
/// 导出模板
class ExportTemplate {
  final String id;
  final String name;
  final String description;
  final String icon; // 模板图标
  
  /// 模板预设配置
  final ExportPreset preset;
  
  /// 适用学段
  final List<GradeLevel> applicableLevels;
  
  /// 是否为系统预设
  final bool isSystem;
}

/// 导出预设配置
class ExportPreset {
  /// 纸张方向
  final PageOrientation orientation;
  
  /// 每页题数
  final int questionsPerPage;
  
  /// 字体大小级别
  final FontSizeLevel fontSize;
  
  /// 内容选项
  final ContentOptions contentOptions;
  
  /// 页眉配置
  final HeaderConfig header;
  
  /// 页脚配置
  final FooterConfig footer;
  
  /// 页边距 (mm)
  final EdgeInsets margins;
}

/// 内容选项
class ContentOptions {
  /// 显示题目内容
  final bool showQuestion;
  
  /// 显示答题空间
  final bool showAnswerSpace;
  
  /// 显示解题步骤
  final bool showSolution;
  
  /// 显示知识点标签
  final bool showKnowledgeTags;
  
  /// 显示错因记录
  final bool showMistakeCause;
  
  /// 显示学生订正记录
  final bool showCorrection;
  
  /// 显示同类练习题
  final bool showSimilarQuestions;
  
  /// 答题空间行数
  final int answerSpaceLines;
}
```

#### 4.2.2 系统预设模板

| 模板ID | 名称 | 适用场景 | 核心配置 |
| --- | --- | --- | --- |
| `tpl_practice_blank` | 练习册（空白） | 线下重做 | 无解析、有答题空间、无错因 |
| `tpl_review_guide` | 复习手册 | 考前复习 | 含解析、含知识点、含错因 |
| `tpl_mistake_report` | 错题分析报告 | 家长/教师查看 | 含统计图表、含错因、含趋势 |
| `tpl_exam_sim` | 模拟试卷格式 | 考试模拟 | 试卷排版、密封线、分值标注 |
| `tpl_flash_card` | 知识卡片 | 随身复习 | 单题单卡、正面题目背面解析 |
| `tpl_weekly_summary` | 周错题汇总 | 每周回顾 | 按日期分组、含掌握度变化 |

### 4.3 配置项详细说明

#### 4.3.1 纸张与排版

```dart
/// 纸张方向
enum PageOrientation {
  portrait,  // 纵向 - 默认，适合文字题
  landscape, // 横向 - 适合含图的理科题
}

/// 每页题数选项（根据纸张方向和题目复杂度动态调整）
extension on int {
  static const Map<PageOrientation, List<int>> questionsPerPageOptions = {
    PageOrientation.portrait: [2, 3, 4, 6],
    PageOrientation.landscape: [2, 4, 6, 8],
  };
}

/// 字体大小级别
enum FontSizeLevel {
  small,  // 10pt - 高中/题目量大
  medium, // 12pt - 默认
  large,  // 14pt - 小学/视力辅助
}
```

#### 4.3.2 页眉页脚配置

```dart
/// 页眉配置
class HeaderConfig {
  /// 显示姓名（打印后填写）
  final bool showName;
  
  /// 显示日期
  final bool showDate;
  
  /// 显示班级（教师端）
  final bool showClass;
  
  /// 自定义标题文本
  final String? customTitle;
  
  /// 显示学科标签
  final bool showSubjectLabel;
}

/// 页脚配置
class FooterConfig {
  /// 显示页码
  final bool showPageNumber;
  
  /// 显示总题数
  final bool showTotalCount;
  
  /// 显示导出时间
  final bool showExportTime;
  
  /// 自定义底部文字
  final String? customText;
}
```

### 4.4 配置持久化

```dart
/// 用户导出配置偏好（本地持久化）
class ExportPreferences {
  /// 上次使用的模板ID
  String lastTemplateId;
  
  /// 上次的排版设置
  ExportPreset lastPreset;
  
  /// 上次的内容选项
  ContentOptions lastContentOptions;
  
  /// 存储键
  static const String storageKey = 'export_preferences';
  
  /// 保存到本地
  Future<void> save();
  
  /// 从本地加载
  static Future<ExportPreferences?> load();
}
```

---

## 5. PDF 预览页面

### 5.1 页面布局

```
┌─────────────────────────────────┐
│  ◀ 预览              [重新配置] │
├─────────────────────────────────┤
│  ┌─────────────────────────┐    │
│  │                         │    │
│  │    [第1页 PDF 渲染]     │    │  ← PDF 页面渲染区
│  │                         │    │
│  │   姓名____ 日期____     │    │
│  │                         │    │
│  │   1. (数学) 已知...     │    │
│  │      ─────────────      │    │
│  │      ─────────────      │    │
│  │                         │    │
│  │   2. (物理) 质量...     │    │
│  │      ─────────────      │    │
│  │                         │    │
│  └─────────────────────────┘    │
│                                 │
│         ◀ 1/3 ▶                 │  ← 页码导航
│                                 │
│  [缩放: -]  100%  [缩放: +]    │  ← 缩放控制
│                                 │
├─────────────────────────────────┤
│  💾 下载PDF   📤 分享   🖨️ 打印 │  ← 操作栏
└─────────────────────────────────┘
```

### 5.2 预览渲染架构

#### 5.2.1 渲染方案

采用 **服务端渲染 + 客户端预览** 模式：

1. 客户端将配置发送到服务端
2. 服务端生成 PDF（使用 Puppeteer/wkhtmltopdf 或专业 PDF 库）
3. 返回 PDF 二进制流 + 页面缩略图
4. 客户端使用 PDF 渲染组件展示预览

```dart
/// PDF预览控制器
class PdfPreviewController {
  /// PDF文档数据
  Uint8List? _pdfData;
  
  /// 页面缩略图缓存
  final Map<int, Uint8List> _thumbnailCache = {};
  
  /// 当前页码（1-indexed）
  int currentPage = 1;
  
  /// 总页数
  int totalPages = 0;
  
  /// 缩放比例
  double zoomLevel = 1.0;
  
  /// 是否正在生成
  bool isGenerating = false;
  
  /// 生成进度 (0.0 ~ 1.0)
  double generationProgress = 0.0;
}

/// PDF预览渲染方式
enum PdfRenderMode {
  /// 完整PDF渲染（适合iOS/Android原生）
  nativePdf,
  
  /// 图片序列渲染（将PDF页转为图片展示）
  imageSequence,
  
  /// WebView内嵌渲染（降级方案）
  webViewEmbed,
}
```

#### 5.2.2 页面缩略图预生成

```dart
/// 页面缩略图管理
class PdfThumbnailManager {
  /// 缩略图尺寸
  static const int thumbnailWidth = 400;
  static const int thumbnailHeight = 566; // A4 比例
  
  /// 最大缓存页数
  static const int maxCachePages = 20;
  
  /// 预加载范围：当前页 ± 2
  static const int preloadRange = 2;
  
  /// 获取缩略图
  Future<Uint8List?> getThumbnail(int pageIndex);
  
  /// 预加载相邻页
  Future<void> preloadAdjacent(int currentPage, int totalPages);
  
  /// 清除缓存
  void clearCache();
}
```

### 5.3 PDF 生成请求

#### 5.3.1 请求数据结构

```json
{
  "requestId": "uuid-xxx",
  "templateId": "tpl_practice_blank",
  "selectedQuestionIds": ["q1", "q2", "..."],
  "preset": {
    "orientation": "portrait",
    "questionsPerPage": 4,
    "fontSize": "medium",
    "margins": { "top": 15, "right": 15, "bottom": 15, "left": 15 }
  },
  "contentOptions": {
    "showQuestion": true,
    "showAnswerSpace": true,
    "showSolution": false,
    "showKnowledgeTags": false,
    "showMistakeCause": false,
    "showCorrection": true,
    "showSimilarQuestions": false,
    "answerSpaceLines": 4
  },
  "header": {
    "showName": true,
    "showDate": true,
    "customTitle": "数学错题练习"
  },
  "footer": {
    "showPageNumber": true,
    "showTotalCount": true
  },
  "outputFormat": "pdf",
  "quality": "high",
  "locale": "zh-CN"
}
```

#### 5.3.2 响应数据结构

```json
{
  "requestId": "uuid-xxx",
  "status": "completed",
  "pdfUrl": "https://cdn.example.com/exports/xxx.pdf",
  "pdfSize": 524288,
  "pageCount": 3,
  "thumbnails": [
    {
      "pageIndex": 1,
      "thumbnailUrl": "https://cdn.example.com/exports/xxx/page1_thumb.png"
    },
    {
      "pageIndex": 2,
      "thumbnailUrl": "https://cdn.example.com/exports/xxx/page2_thumb.png"
    }
  ],
  "expiresAt": "2026-06-01T03:50:00Z",
  "questionCount": 12,
  "generatedAt": "2026-05-30T03:50:00Z"
}
```

### 5.4 预览加载状态

```dart
/// 预览加载状态机
enum PreviewLoadState {
  /// 初始状态
  idle,
  
  /// 正在提交生成请求
  submitting,
  
  /// PDF 生成中（服务端处理）
  generating,
  
  /// 正在下载 PDF 数据
  downloading,
  
  /// 正在渲染预览
  rendering,
  
  /// 预览就绪
  ready,
  
  /// 生成失败
  failed,
}

/// 加载状态 → UI 映射
extension PreviewStateUI on PreviewLoadState {
  String get displayText => switch (this) {
    PreviewLoadState.idle => '',
    PreviewLoadState.submitting => '正在准备...',
    PreviewLoadState.generating => '正在生成PDF...',
    PreviewLoadState.downloading => '正在下载...',
    PreviewLoadState.rendering => '正在渲染预览...',
    PreviewLoadState.ready => '',
    PreviewLoadState.failed => '生成失败',
  };
}
```

---

## 6. 导出结果页面

### 6.1 页面布局

```
┌─────────────────────────────────┐
│  ◀ 导出完成                     │
├─────────────────────────────────┤
│                                 │
│         ✅ PDF已生成             │
│    📄 数学错题练习_20260530.pdf  │
│         12题 / 3页 / 512KB      │
│                                 │
├─────────────────────────────────┤
│                                 │
│  ┌─────────────────────────┐    │
│  │  📥  保存到本地          │    │  ← 主操作
│  │     下载PDF文件到设备     │    │
│  └─────────────────────────┘    │
│  ┌─────────────────────────┐    │
│  │  📤  分享                │    │
│  │     发送给微信/QQ/邮件等  │    │
│  └─────────────────────────┘    │
│  ┌─────────────────────────┐    │
│  │  🖨️  打印               │    │
│  │     连接打印机直接打印    │    │
│  └─────────────────────────┘    │
│                                 │
├─────────────────────────────────┤
│  📋 导出详情                    │
│  模板: 练习册（空白）           │
│  学科: 数学                     │
│  题目: 12题 (选择题3/填空题4/   │
│        解答题5)                  │
│  时间: 2026-05-30 11:50         │
│  有效期: 7天                    │
├─────────────────────────────────┤
│  [重新导出]    [返回错题本]      │
└─────────────────────────────────┘
```

### 6.2 操作详情

#### 6.2.1 保存到本地

```dart
/// 下载管理
class PdfDownloadManager {
  /// 下载PDF到本地
  /// 
  /// [url] PDF文件URL
  /// [fileName] 本地文件名
  /// 返回本地文件路径
  Future<String> downloadToLocal({
    required String url,
    required String fileName,
  }) async {
    // 1. 检查存储权限
    // 2. 选择保存目录（Android: Downloads, iOS: Documents）
    // 3. 断点续传下载（复用文件上传服务的下载模块）
    // 4. 下载完成后通知系统媒体库扫描
    // 5. 返回本地路径
  }
  
  /// 生成默认文件名
  /// 格式: {学科}错题{模板名}_{日期}.pdf
  /// 示例: 数学错题练习册_20260530.pdf
  static String generateFileName(ExportConfig config) {
    final subject = config.subjectName;
    final template = config.templateName;
    final date = DateFormat('yyyyMMdd').format(DateTime.now());
    return '${subject}错题$template\_$date.pdf';
  }
}
```

#### 6.2.2 分享

```dart
/// 分享目标
enum ShareTarget {
  wechat,      // 微信好友
  wechatMoment,// 朋友圈
  qq,          // QQ
  email,       // 邮件
  airDrop,     // AirDrop (iOS)
  systemShare, // 系统分享面板
  linkCopy,    // 复制链接
}

/// 分享服务
class PdfShareService {
  /// 通过系统分享面板分享
  Future<void> sharePdf({
    required String filePath,
    String? text,
    ShareTarget? target,
  }) async {
    // 使用 share_plus 或系统 Intent/UIActivityViewController
  }
  
  /// 分享临时链接（有效期7天）
  Future<String> shareAsLink({
    required String pdfId,
    int expireDays = 7,
  }) async {
    // 生成带有效期的临时下载链接
  }
}
```

#### 6.2.3 打印

```dart
/// 打印服务
class PdfPrintService {
  /// 检查打印能力
  Future<bool> isPrintingAvailable();
  
  /// 发起打印
  Future<void> printPdf({
    required String filePath,
    int copies = 1,
    PageOrientation orientation = PageOrientation.portrait,
    bool duplex = true, // 双面打印
  }) async {
    // Android: 使用 PrintManager / PrintService
    // iOS: 使用 UIPrintInteractionController
  }
}
```

---

## 7. API 接口设计

### 7.1 提交导出任务

```
POST /api/v1/export/pdf
```

**请求体：**

```json
{
  "templateId": "tpl_practice_blank",
  "questionIds": ["q_001", "q_002", "q_003"],
  "preset": {
    "orientation": "portrait",
    "questionsPerPage": 4,
    "fontSize": "medium",
    "margins": { "top": 15, "right": 15, "bottom": 15, "left": 15 }
  },
  "contentOptions": {
    "showQuestion": true,
    "showAnswerSpace": true,
    "showSolution": false,
    "showKnowledgeTags": false,
    "showMistakeCause": false,
    "showCorrection": true,
    "showSimilarQuestions": false,
    "answerSpaceLines": 4
  },
  "header": {
    "showName": true,
    "showDate": true,
    "customTitle": "数学错题练习"
  },
  "footer": {
    "showPageNumber": true,
    "showTotalCount": true
  }
}
```

**成功响应 (200)：**

```json
{
  "code": 0,
  "data": {
    "taskId": "task_uuid_xxx",
    "status": "processing",
    "estimatedSeconds": 10
  }
}
```

**错误响应：**

| 错误码 | 场景 | HTTP状态码 |
| --- | --- | --- |
| `EXPORT_QUANTITY_EXCEEDED` | 超过最大题目数(50) | 400 |
| `EXPORT_QUESTION_NOT_FOUND` | 题目不存在或无权访问 | 400 |
| `EXPORT_TEMPLATE_INVALID` | 模板ID无效 | 400 |
| `EXPORT_QUOTA_EXCEEDED` | 导出次数配额用尽 | 429 |
| `EXPORT_GENERATION_FAILED` | PDF 生成失败 | 500 |

### 7.2 查询导出任务状态

```
GET /api/v1/export/pdf/{taskId}
```

**响应 (200)：**

```json
{
  "code": 0,
  "data": {
    "taskId": "task_uuid_xxx",
    "status": "completed",
    "progress": 100,
    "result": {
      "pdfUrl": "https://cdn.example.com/exports/xxx.pdf",
      "pdfSize": 524288,
      "pageCount": 3,
      "thumbnails": [
        {
          "pageIndex": 1,
          "thumbnailUrl": "https://cdn.example.com/exports/xxx/p1.png"
        }
      ],
      "expiresAt": "2026-06-06T03:50:00Z"
    }
  }
}
```

**任务状态流转：**

```
pending → processing → completed
                    → failed
```

### 7.3 获取导出历史

```
GET /api/v1/export/history?page=1&pageSize=20
```

**响应 (200)：**

```json
{
  "code": 0,
  "data": {
    "total": 15,
    "items": [
      {
        "taskId": "task_uuid_xxx",
        "templateName": "练习册（空白）",
        "subjectName": "数学",
        "questionCount": 12,
        "pageCount": 3,
        "status": "completed",
        "pdfUrl": "https://cdn.example.com/exports/xxx.pdf",
        "expiresAt": "2026-06-06T03:50:00Z",
        "createdAt": "2026-05-30T03:50:00Z"
      }
    ]
  }
}
```

### 7.4 获取模板列表

```
GET /api/v1/export/templates?gradeLevel=senior_high
```

**响应 (200)：**

```json
{
  "code": 0,
  "data": {
    "templates": [
      {
        "id": "tpl_practice_blank",
        "name": "练习册（空白）",
        "description": "只含题目和答题空间，适合线下重做",
        "icon": "📝",
        "preset": { ... },
        "isRecommended": true
      }
    ]
  }
}
```

### 7.5 下载 PDF 文件

```
GET /api/v1/export/pdf/{taskId}/download
```

**响应：** PDF 二进制流（`application/pdf`）

支持 `Range` 请求头用于断点续传。

---

## 8. 状态管理

### 8.1 全局状态模型

```dart
/// 导出功能全局状态
class ExportState {
  /// 当前步骤
  ExportStep currentStep;
  
  /// 选中的题目ID
  Set<String> selectedIds;
  
  /// 筛选条件
  MistakeFilter filter;
  
  /// 当前模板
  ExportTemplate? selectedTemplate;
  
  /// 导出配置
  ExportConfig config;
  
  /// PDF预览状态
  PreviewLoadState previewState;
  
  /// 生成任务ID
  String? taskId;
  
  /// 生成结果
  ExportResult? result;
  
  /// 错误信息
  String? errorMessage;
}
```

### 8.2 状态流转

```dart
/// 导出步骤
enum ExportStep {
  /// 选择题目
  select,
  
  /// 配置导出选项
  config,
  
  /// 预览PDF
  preview,
  
  /// 导出完成
  result,
}

/// 步骤流转规则
final stepTransitions = <ExportStep, Set<ExportStep>>{
  ExportStep.select: {ExportStep.config},
  ExportStep.config: {ExportStep.select, ExportStep.preview},
  ExportStep.preview: {ExportStep.config, ExportStep.result},
  ExportStep.result: {ExportStep.config, ExportStep.select},
};
```

### 8.3 Riverpod Provider 设计

```dart
/// 导出步骤 Provider
final exportStepProvider = StateProvider<ExportStep>((ref) => ExportStep.select);

/// 已选题目 Provider
final selectedQuestionsProvider = StateNotifierProvider<SelectedQuestionsNotifier, 
    Set<String>>((ref) => SelectedQuestionsNotifier());

/// 筛选条件 Provider
final mistakeFilterProvider = StateNotifierProvider<MistakeFilterNotifier, 
    MistakeFilter>((ref) => MistakeFilterNotifier());

/// 筛选结果 Provider（依赖筛选条件）
final filteredMistakesProvider = FutureProvider<List<MistakeItem>>((ref) async {
  final filter = ref.watch(mistakeFilterProvider);
  final repository = ref.watch(mistakeRepositoryProvider);
  return repository.getMistakes(filter: filter);
});

/// 导出模板 Provider
final exportTemplatesProvider = FutureProvider<List<ExportTemplate>>((ref) async {
  final api = ref.watch(exportApiProvider);
  return api.getTemplates();
});

/// 当前模板 Provider
final selectedTemplateProvider = StateProvider<ExportTemplate?>((ref) => null);

/// 导出配置 Provider
final exportConfigProvider = StateNotifierProvider<ExportConfigNotifier, 
    ExportConfig>((ref) => ExportConfigNotifier());

/// PDF预览 Provider
final pdfPreviewProvider = FutureProvider<PdfPreviewData>((ref) async {
  final config = ref.watch(exportConfigProvider);
  final selectedIds = ref.watch(selectedQuestionsProvider);
  final api = ref.watch(exportApiProvider);
  
  final task = await api.submitExport(
    questionIds: selectedIds.toList(),
    config: config,
  );
  
  // 轮询任务状态
  return _pollTaskStatus(api, task.taskId);
});

/// 导出历史 Provider
final exportHistoryProvider = FutureProvider<List<ExportHistoryItem>>((ref) async {
  final api = ref.watch(exportApiProvider);
  return api.getHistory();
});
```

---

## 9. 错题报告模板特殊设计

### 9.1 报告模板结构

错题分析报告模板（`tpl_mistake_report`）与其他模板不同，除题目内容外还包含统计图表：

```
┌─────────────────────────────────┐
│  ◆ 错题分析报告 ◆              │
│  学生: 张三    年级: 高一        │
│  学科: 数学    时间: 2026.03     │
├─────────────────────────────────┤
│  ── 错题概况 ──                 │
│  本月新增: 12题   待复习: 8题    │
│  已掌握: 4题      掌握率: 33%    │
├─────────────────────────────────┤
│  ── 错因分布 ──                 │
│  ┌─────────────────────────┐    │
│  │  [柱状图: 各错因数量]    │    │
│  │  概念不清 ████████ 5     │    │
│  │  计算失误 █████ 3        │    │
│  │  审题错误 ███ 2          │    │
│  │  方法错误 ██ 2           │    │
│  └─────────────────────────┘    │
├─────────────────────────────────┤
│  ── 知识点掌握度 ──             │
│  ┌─────────────────────────┐    │
│  │  [雷达图: 5个维度]       │    │
│  │  函数    ████░░ 60%      │    │
│  │  几何    ██████ 80%      │    │
│  │  概率    ██░░░░ 40%      │    │
│  │  向量    █████░ 70%      │    │
│  └─────────────────────────┘    │
├─────────────────────────────────┤
│  ── 错题详情 ──                 │
│  1. (二次函数) 已知...          │
│     错因: 计算失误              │
│     正确解法: ...               │
│     掌握度: ●●●○○               │
│  ──────────────────────────     │
│  2. (三角函数) 在△ABC中...      │
│     错因: 概念不清              │
│     正确解法: ...               │
│     掌握度: ●●○○○               │
└─────────────────────────────────┘
```

### 9.2 报告特有配置

```dart
/// 报告模板额外配置
class ReportTemplateConfig {
  /// 包含统计概览
  final bool includeSummary;
  
  /// 包含错因分布图
  final bool includeCauseChart;
  
  /// 包含知识点掌握雷达图
  final bool includeMasteryRadar;
  
  /// 包含错题趋势折线图
  final bool includeTrendChart;
  
  /// 包含每题掌握度评分
  final bool includeMasteryScore;
  
  /// 时间范围（报告统计周期）
  final ReportTimeRange timeRange;
}

/// 报告时间范围
enum ReportTimeRange {
  week,   // 近一周
  month,  // 近一月
  semester, // 本学期
  custom, // 自定义
}
```

---

## 10. 关键交互细节

### 10.1 题目选择交互

#### 10.1.1 多选模式

1. 点击卡片任意区域 → 切换选中/取消
2. 长按卡片 → 进入批量选择模式
3. 批量模式中，上下滑动可连续选中
4. 全选按钮仅选中当前筛选结果内的题目
5. 选中数量达到上限时，未选中项显示半透明遮罩并禁止选中

#### 10.1.2 智能推荐弹窗

```
┌─────────────────────────────────┐
│  ✨ 智能推荐                    │
├─────────────────────────────────┤
│                                 │
│  📌 薄弱知识点 (推荐15题)       │
│     掌握度 < 60% 的知识点错题    │
│     [选择]                      │
│                                 │
│  🔥 高频错题 (推荐8题)          │
│     错误次数 ≥ 3次的题目        │
│     [选择]                      │
│                                 │
│  ⏰ 待复习 (推荐12题)           │
│     按遗忘曲线应复习的错题       │
│     [选择]                      │
│                                 │
│  📅 近期错题 (推荐10题)         │
│     最近7天新增的错题            │
│     [选择]                      │
│                                 │
│  🎯 考前冲刺 (推荐20题)         │
│     与下次考试相关的错题         │
│     [选择]                      │
│                                 │
└─────────────────────────────────┘
```

### 10.2 配置页面交互动画

1. 模板切换时，预览区域平滑过渡
2. 选项变更实时更新底部"预估"信息（题数/页数）
3. 内容选项开关带弹性动画
4. 排版调整（每页题数）时，迷你预览实时变化

### 10.3 预览手势交互

| 手势 | 操作 |
| --- | --- |
| 左右滑动 | 翻页 |
| 双指缩放 | 放大/缩小 |
| 单指拖动（放大后） | 平移查看 |
| 双击 | 在100%和适合宽度间切换 |
| 长按 | 弹出该页操作菜单 |

### 10.4 导出结果页反馈

1. 下载进度条（使用 SnackBar 或底部进度条）
2. 下载完成后系统通知
3. 分享成功/失败 Toast 提示
4. 打印状态实时反馈（连接中 → 打印中 → 完成）

---

## 11. 权限与配额

### 11.1 导出配额

| 用户类型 | 每日导出次数 | 单次最大题目数 | PDF保留天数 |
| --- | --- | --- | --- |
| 免费用户 | 2次 | 20题 | 3天 |
| 月度会员 | 10次 | 50题 | 7天 |
| 年度会员 | 无限 | 50题 | 30天 |
| 考试专项会员 | 无限 | 50题 | 30天 |

### 11.2 配额检查

```dart
/// 导出配额服务
class ExportQuotaService {
  /// 检查是否可以导出
  Future<QuotaCheckResult> checkQuota({
    required int questionCount,
  }) async {
    final quota = await _fetchQuota();
    
    // 检查日次数限制
    if (quota.dailyRemaining <= 0) {
      return QuotaCheckResult(
        allowed: false,
        reason: QuotaExceededReason.dailyLimit,
        remaining: 0,
        resetAt: quota.resetAt,
      );
    }
    
    // 检查题目数量限制
    if (questionCount > quota.maxQuestionsPerExport) {
      return QuotaCheckResult(
        allowed: false,
        reason: QuotaExceededReason.questionLimit,
        maxQuestions: quota.maxQuestionsPerExport,
      );
    }
    
    return QuotaCheckResult(allowed: true);
  }
  
  /// 消耗配额
  Future<void> consumeQuota();
}
```

### 11.3 配额不足时的引导

```
┌─────────────────────────────────┐
│  ⚠️ 今日导出次数已用完          │
│                                 │
│  免费用户每日可导出 2 次         │
│  升级会员可享受更多导出次数      │
│                                 │
│  [查看会员权益]  [明天再来]      │
└─────────────────────────────────┘
```

---

## 12. 错误处理

### 12.1 错误场景与处理

| 错误场景 | 用户提示 | 处理策略 |
| --- | --- | --- |
| 网络断开 | "网络连接失败，请检查网络" | 缓存配置，恢复后重试 |
| PDF生成超时 | "生成时间较长，请稍后查看" | 后台继续生成，推送通知 |
| 题目数据不完整 | "部分题目数据异常，已自动跳过" | 跳过异常题，生成剩余 |
| 存储空间不足 | "设备存储空间不足" | 引导清理空间 |
| 打印机未连接 | "未找到可用打印机" | 引导连接或改用下载 |
| 配额不足 | "导出次数已达上限" | 引导升级会员 |
| 文件下载失败 | "下载失败，点击重试" | 支持断点续传重试 |
| 分享平台异常 | "分享失败，请稍后重试" | 提供复制链接备选 |
| PDF过期 | "文件已过期，请重新生成" | 引导重新导出 |

### 12.2 重试策略

```dart
/// 导出任务重试配置
class ExportRetryConfig {
  /// 最大重试次数
  static const int maxRetries = 3;
  
  /// 重试间隔（指数退避）
  static const List<Duration> retryIntervals = [
    Duration(seconds: 2),
    Duration(seconds: 4),
    Duration(seconds: 8),
  ];
  
  /// 可重试的错误码
  static const Set<String> retryableErrors = {
    'EXPORT_GENERATION_FAILED',
    'NETWORK_ERROR',
    'TIMEOUT',
  };
}
```

---

## 13. 性能优化

### 13.1 列表性能

1. **虚拟滚动**：错题列表采用 `SliverList` + `RecyclerView` 方案
2. **图片懒加载**：题目中的图片仅在可见区域加载
3. **选择状态轻量化**：仅维护 ID 集合，不持有完整数据

### 13.2 PDF 预览性能

1. **缩略图优先**：先加载缩略图展示，用户停留时加载高清
2. **预加载**：预加载当前页 ± 2 页
3. **内存管理**：离开预览页时释放 PDF 渲染资源
4. **流式下载**：PDF 数据边下载边渲染

### 13.3 配置缓存

```dart
/// 配置缓存策略
class ExportConfigCache {
  /// 本地缓存用户最近配置
  static const int maxCachedConfigs = 5;
  
  /// 缓存 key 前缀
  static const String cacheKeyPrefix = 'export_config_';
  
  /// 保存配置（按学科+模板维度缓存）
  static Future<void> saveConfig(String key, ExportConfig config);
  
  /// 加载最近配置
  static Future<ExportConfig?> loadConfig(String key);
}
```

---

## 14. 无障碍适配

### 14.1 辅助功能

1. 所有按钮提供语义标签（Semantics）
2. 选中/未选中状态通过 `Semantics.selected` 声明
3. PDF 预览页提供文本摘要模式（将 PDF 内容转为纯文本供屏幕阅读器朗读）
4. 筛选器支持键盘导航
5. 导出进度通过 `Semantics.liveRegion` 实时播报

### 14.2 视觉辅助

1. 高对比度模式下确保选中态清晰可辨
2. 字体大小选择同时影响 UI 控件（遵循系统字号设置）
3. 色盲友好的选中态（图标+颜色双重提示）

---

## 15. 测试用例

### 15.1 核心测试场景

| 编号 | 场景 | 前置条件 | 操作步骤 | 预期结果 |
| --- | --- | --- | --- | --- |
| E-001 | 选择题目导出 | 错题本有数据 | 选3题 → 选模板 → 预览 → 下载 | PDF 包含3题，内容正确 |
| E-002 | 全选导出 | 错题本有40题 | 全选 → 选择练习册模板 → 导出 | 全部40题正常导出 |
| E-003 | 超限选择 | 错题本有60题 | 全选 | 提示最多选50题，禁止继续选中 |
| E-004 | 空错题本导出 | 错题本为空 | 点击导出 | 提示"暂无错题"，禁用导出按钮 |
| E-005 | 含图片题目 | 题目含几何图形 | 导出含图片题目 | PDF 中图片清晰完整 |
| E-006 | 含公式题目 | 题目含 LaTeX 公式 | 导出含公式题目 | PDF 中公式正确渲染 |
| E-007 | 配额不足 | 免费用户已用完配额 | 尝试导出 | 提示升级会员 |
| E-008 | 网络断开导出 | 网络断开 | 尝试生成 PDF | 提示网络错误，可重试 |
| E-009 | PDF 预览翻页 | 3页 PDF | 左右滑动 | 正确切换页面 |
| E-010 | 下载后分享 | PDF 已下载 | 点击分享 → 选择微信 | 跳转微信分享成功 |
| E-011 | 打印输出 | 连接打印机 | 点击打印 → 选择打印机 | 打印输出正确 |
| E-012 | 模板切换 | 在配置页 | 切换模板类型 | 预览实时更新 |
| E-013 | 错题报告模板 | 选择报告模板 | 配置统计范围 → 导出 | PDF 含统计图表 |
| E-014 | 导出历史 | 有历史记录 | 查看导出历史 | 列表正确，可重新下载 |
| E-015 | 文件过期 | PDF 已过期 | 从历史中下载 | 提示文件已过期，引导重新生成 |

### 15.2 性能测试

| 编号 | 场景 | 指标 | 目标值 |
| --- | --- | --- | --- |
| P-001 | 50题导出 | PDF 生成时间 | ≤ 15秒 |
| P-002 | 错题列表加载 | 首屏渲染 | ≤ 1秒 |
| P-003 | PDF 预览翻页 | 页面切换 | ≤ 300ms |
| P-004 | 批量选中50题 | 选中操作响应 | ≤ 100ms |
| P-005 | 缩略图加载 | 单张加载 | ≤ 500ms |

---

## 16. 后续扩展

### 16.1 V1.5 阶段

1. **自定义模板**：用户可保存自定义模板配置
2. **批量导出**：按学科/章节一键导出整组错题
3. **定时导出**：设置每周自动导出并发送邮件
4. **家长端报告推送**：定期生成错题报告推送给家长

### 16.2 V2.0 阶段

1. **教师端班级导出**：导出班级错题统计
2. **答题卡模板**：OMR 兼容的答题卡 PDF
3. **多语言导出**：支持英文题目双语导出
4. **协作标注**：教师可在 PDF 上批注后回传
5. **题目录入扫描件**：从纸质试卷拍照生成结构化题目并入错题本
