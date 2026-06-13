# 客户端-AI对话消息Markdown流式渲染与学科公式排版引擎-详细设计

## 1. 概述

### 1.1 功能定位

AI 对话消息渲染引擎是 PrimeTop 客户端最核心的 UI 组件之一。它负责将 AI 辅导对话中流式返回的 Markdown 文本实时渲染为结构化的消息气泡，并支持数学公式（LaTeX）、化学方程式、代码块、表格、折叠步骤等学科特色内容的排版。

### 1.2 设计目标

| 目标 | 说明 |
|------|------|
| **流式增量渲染** | SSE token 到达即渲染，首 token 延迟 < 50ms |
| **学科内容精确排版** | 数学公式、化学方程式、物理符号渲染准确率达 99%+ |
| **流畅滚动** | 60fps 滚动体验，100 条消息列表无卡顿 |
| **内存可控** | 单条超长消息内存占用 < 2MB |
| **分龄适配** | 根据学段调整字体大小、行间距、公式复杂度展示 |

### 1.3 与相关模块的关系

```
SSE流式响应与AI增量渲染引擎（上层：SSE 连接管理、token 分发）
        │
        ▼
┌───────────────────────────────────┐
│  本模块：Markdown 流式渲染引擎     │
│  ├── 增量 Markdown 解析器         │
│  ├── 学科内容渲染器               │
│  ├── 消息气泡 Widget              │
│  └── 性能与缓存管理               │
└───────────────────────────────────┘
        │
        ▼
富文本与学科内容渲染引擎（底层：通用富文本 Widget 库）
```

---

## 2. 整体架构

### 2.1 模块分层

```
┌─────────────────────────────────────────────┐
│            ChatMessageBubble                 │  消息气泡容器
├─────────────────────────────────────────────┤
│         StreamingMarkdownWidget              │  流式 Markdown 宿主
├──────┬──────┬──────┬──────┬────────┬────────┤
│Text  │Math  │Code  │Table │Expend- │Image   │  内容渲染器
│Render│Render│Render│Render│able    │Render  │
│      │      │      │      │Section │        │
├──────┴──────┴──────┴──────┴────────┴────────┤
│       IncrementalMarkdownParser              │  增量解析器
├─────────────────────────────────────────────┤
│       MarkdownAST + RenderCache              │  AST 与缓存
└─────────────────────────────────────────────┘
```

### 2.2 数据流

```
SSE Token → TokenBuffer → IncrementalParser → AST Patch
                                                  │
                                                  ▼
                                        Widget Diff & Rebuild
                                                  │
                                                  ▼
                                          Rendered Message
```

---

## 3. 增量 Markdown 解析器（IncrementalMarkdownParser）

### 3.1 核心挑战

传统 Markdown 解析器（如 `markdown`、`commonmark`）需要完整文本才能解析。流式场景下文本逐 token 到达，需要：

1. **处理不完整语法**：如 `` ````dart\nvoid main() `` 缺少闭合的 ``` 
2. **处理跨 token 语法**：一个 `$x^2$` 可能分 3 个 token 到达
3. **最小化重建**：仅在 AST 结构变化时触发 Widget 重建

### 3.2 解析策略：滑动窗口 + 状态机

```dart
/// 增量 Markdown 解析器状态
enum ParseState {
  /// 文本模式
  text,
  /// LaTeX 行内公式模式（$...$）
  mathInline,
  /// LaTeX 块级公式模式（$$...$$）
  mathBlock,
  /// 代码块模式（```...```）
  codeBlock,
  /// 表格模式
  table,
  /// 有序/无序列表模式
  list,
  /// 引用块模式（> ...）
  blockquote,
  /// 粗体（**...**）
  bold,
  /// 斜体（*...*）
  italic,
  /// 删除线（~~...~~）
  strikethrough,
  /// 链接（[...](...)）
  link,
  /// 折叠步骤（:::steps ... :::）
  expandableSection,
}

/// 增量解析器
class IncrementalMarkdownParser {
  /// 滑动窗口大小（用于向前看lookahead）
  static const int windowSize = 4;

  /// 已确认完成的 AST 节点
  final List<ASTNode> _committedNodes = [];

  /// 当前正在构建的临时节点
  final List<ASTNode> _pendingNodes = [];

  /// 未消耗的文本缓冲
  final StringBuffer _buffer = StringBuffer();

  /// 当前解析状态栈
  final List<ParseState> _stateStack = [ParseState.text];

  /// 文本哈希缓存，用于判断是否需要重建
  int _lastHash = 0;

  /// 当前文本总长度
  int _totalLength = 0;

  /// 追加新 token 并返回 AST 补丁
  ASTPatch appendToken(String token) {
    _buffer.write(token);
    _totalLength += token.length;

    // 只有当窗口区域变化时才重新解析
    final currentHash = _buffer.length;
    if (currentHash == _lastHash) {
      return ASTPatch.empty;
    }

    return _reparseTail();
  }

  /// 标记流结束，提交所有待定节点
  ASTPatch finalize() {
    _flushBuffer();
    _commitPending();
    return ASTPatch(
      committed: List.unmodifiable(_committedNodes),
      isFinal: true,
    );
  }

  /// 重新解析缓冲区尾部
  ASTPatch _reparseTail() {
    final text = _buffer.toString();

    // 尝试从尾部识别完整的语法块
    final patches = <ASTNode>[];

    // 1. 检测块级语法（代码块、公式块、表格等）
    _detectBlockSyntax(text, patches);

    // 2. 检测行内语法（粗体、斜体、行内公式等）
    _detectInlineSyntax(text, patches);

    // 3. 计算最小重建范围
    final rebuildRange = _calculateRebuildRange(patches);

    return ASTPatch(
      committed: List.unmodifiable(_committedNodes),
      pending: patches,
      rebuildRange: rebuildRange,
      isFinal: false,
    );
  }
}
```

### 3.3 AST 节点定义

```dart
/// Markdown AST 节点基类
abstract class ASTNode {
  /// 节点类型
  String get type;
  /// 子节点
  List<ASTNode> get children;
  /// 是否完成（不会再变化）
  bool get isFinal;
  /// 唯一标识（用于 Widget 复用）
  String get id;
}

/// 文本节点
class TextNode extends ASTNode {
  @override
  String get type => 'text';

  final String content;
  final TextStyleSpec style; // bold, italic, strikethrough, link etc.

  TextNode({
    required this.content,
    this.style = const TextStyleSpec(),
    required String id,
    required bool isFinal,
  });
}

/// 数学公式节点
class MathNode extends ASTNode {
  @override
  String get type => 'math';

  final String latex; // LaTeX 源码
  final bool isBlock; // true=块级($$), false=行内($)
  final MathRenderState renderState;

  MathNode({
    required this.latex,
    required this.isBlock,
    this.renderState = MathRenderState.pending,
    required String id,
    required bool isFinal,
  });
}

/// 代码块节点
class CodeBlockNode extends ASTNode {
  @override
  String get type => 'codeBlock';

  final String language; // dart, python, json, etc.
  final String code;
  final bool showLineNumbers;

  CodeBlockNode({
    required this.language,
    required this.code,
    this.showLineNumbers = true,
    required String id,
    required bool isFinal,
  });
}

/// 表格节点
class TableNode extends ASTNode {
  @override
  String get type => 'table';

  final List<String> headers;
  final List<List<String>> rows;
  final List<TextAlign> alignments;

  TableNode({
    required this.headers,
    required this.rows,
    required this.alignments,
    required String id,
    required bool isFinal,
  });
}

/// 折叠步骤节点（PrimeTop 自定义语法）
class ExpandableSectionNode extends ASTNode {
  @override
  String get type => 'expandableSection';

  final String title; // 如 "解题步骤 1"、"思路提示"
  final int stepIndex; // 步骤序号
  final ExpandableState expandState; // collapsed / expanded / auto
  final List<ASTNode> innerNodes;

  ExpandableSectionNode({
    required this.title,
    required this.stepIndex,
    this.expandState = ExpandableState.collapsed,
    required this.innerNodes,
    required String id,
    required bool isFinal,
  });
}

/// 列表节点
class ListNode extends ASTNode {
  @override
  String get type => 'list';

  final bool ordered;
  final List<ASTNode> items;

  ListNode({
    required this.ordered,
    required this.items,
    required String id,
    required bool isFinal,
  });
}

/// 引用块节点
class BlockquoteNode extends ASTNode {
  @override
  String get type => 'blockquote';

  final List<ASTNode> children;
  final String? quoteType; // 'tip', 'warning', 'info', null=default

  BlockquoteNode({
    required this.children,
    this.quoteType,
    required String id,
    required bool isFinal,
  });
}

/// 图片节点
class ImageNode extends ASTNode {
  @override
  String get type => 'image';

  final String url;
  final String? alt;
  final double? width;
  final double? height;

  ImageNode({
    required this.url,
    this.alt,
    this.width,
    this.height,
    required String id,
    required bool isFinal,
  });
}

/// AST 补丁（增量更新描述）
class ASTPatch {
  final List<ASTNode> committed; // 已确认不变的节点
  final List<ASTNode> pending;   // 正在构建的节点
  final RebuildRange? rebuildRange; // 需要重建的范围
  final bool isFinal;            // 流是否结束

  const ASTPatch({
    required this.committed,
    this.pending = const [],
    this.rebuildRange,
    this.isFinal = false,
  });

  static const ASTPatch empty = ASTPatch(committed: []);
}

class RebuildRange {
  final int startIndex; // 开始重建的节点索引
  final int endIndex;   // 结束重建的节点索引（含）

  const RebuildRange({required this.startIndex, required this.endIndex});
}
```

### 3.4 PrimeTop 自定义 Markdown 扩展语法

| 语法 | 用途 | 示例 |
|------|------|------|
| `:::steps` ... `:::` | 折叠式解题步骤 | 渐进式提示 |
| `:::tip` ... `:::` | 提示框 | 学习技巧 |
| `:::warning` ... `:::` | 警告框 | 易错点提醒 |
| `:::think` ... `:::` | 思考引导 | 启发式提问 |
| `$$..$$` | 块级公式 | 数学推导 |
| `$..$` | 行内公式 | 文中公式 |
| `![fig](url){width=300}` | 带尺寸图片 | 几何图形 |

---

## 4. 数学公式渲染器（MathRenderer）

### 4.1 技术选型

| 方案 | 优势 | 劣势 | 选型 |
|------|------|------|------|
| **flutter_math_fork** (KaTeX 算法) | 纯 Dart，无平台依赖，性能好 | 部分高级 LaTeX 不支持 | ✅ 主选 |
| **WebView + KaTeX/MathJax** | 支持最全 | 性能差、内存高、滚动卡顿 | ❌ 不选 |
| **PlatformView + Native** | 性能好 | 双端维护成本高 | 备选（复杂公式） |
| **Canvas 自绘** | 完全可控 | 开发成本极高 | ❌ 不选 |

### 4.2 渲染流程

```
LaTeX 源码字符串
      │
      ▼
LaTeX Tokenizer（词法分析）
      │
      ▼
LaTeX Parser → MathAST（公式语法树）
      │
      ▼
Layout Engine（排版引擎：处理分数、根号、矩阵布局）
      │
      ▼
Flutter Widget Tree
      │
      ▼
CustomPaint 渲染
```

### 4.3 核心代码：MathRenderWidget

```dart
class MathRenderWidget extends StatelessWidget {
  final String latex;
  final bool isBlock;
  final MathStyle style;
  final bool isStreaming; // 是否正在流式接收

  const MathRenderWidget({
    super.key,
    required this.latex,
    required this.isBlock,
    this.style = MathStyle.display,
    this.isStreaming = false,
  });

  @override
  Widget build(BuildContext context) {
    // 流式状态下使用简化渲染，减少抖动
    if (isStreaming && _isIncompleteLatex(latex)) {
      return _buildStreamingPlaceholder(latex);
    }

    return _buildFormula(context);
  }

  Widget _buildFormula(BuildContext context) {
    try {
      final mathStyle = isBlock
          ? MathStyle.display
          : MathStyle.text;

      return Math.tex(
        latex,
        mathStyle: mathStyle,
        textStyle: _resolveTextStyle(context),
        onErrorFallback: (err) => _buildErrorFallback(latex, err),
      );
    } on LaTeXParseError catch (e) {
      return _buildErrorFallback(latex, e);
    }
  }

  /// 检测不完整的 LaTeX（流式场景）
  bool _isIncompleteLatex(String latex) {
    // 检查未闭合的花括号
    int braceCount = 0;
    for (int i = 0; i < latex.length; i++) {
      if (latex[i] == '{') braceCount++;
      if (latex[i] == '}') braceCount--;
    }
    if (braceCount > 0) return true;

    // 检查未闭合的环境
    final envPattern = RegExp(r'\\begin\{(\w+)\}');
    final endPattern = RegExp(r'\\end\{(\w+)\}');
    final begins = envPattern.allMatches(latex).map((m) => m.group(1)).toList();
    final ends = endPattern.allMatches(latex).map((m) => m.group(1)).toList();
    for (final env in begins) {
      if (!ends.contains(env)) return true;
    }

    return false;
  }

  /// 流式渲染占位符（简化显示，等公式完整后再精确渲染）
  Widget _buildStreamingPlaceholder(String latex) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceVariant.withOpacity(0.3),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            latex,
            style: TextStyle(
              fontFamily: 'monospace',
              fontSize: style.fontSize,
              color: Theme.of(context).colorScheme.onSurface,
            ),
          ),
          const SizedBox(width: 4),
          SizedBox(
            width: 12,
            height: 12,
            child: CircularProgressIndicator(
              strokeWidth: 1.5,
              color: Theme.of(context).colorScheme.primary.withOpacity(0.5),
            ),
          ),
        ],
      ),
    );
  }

  /// 错误回退显示
  Widget _buildErrorFallback(String latex, Object error) {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Colors.red.shade50,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: Colors.red.shade200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            latex,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
          ),
          const SizedBox(height: 4),
          Text(
            '公式解析异常，请点击反馈',
            style: TextStyle(fontSize: 11, color: Colors.red.shade700),
          ),
        ],
      ),
    );
  }

  TextStyle _resolveTextStyle(BuildContext context) {
    final baseStyle = Theme.of(context).textTheme.bodyLarge!;
    // 根据学段调整公式字体大小
    final grade = context.read<UserProfileCubit>().state.gradeLevel;
    final fontSize = _gradeFontSize(baseStyle.fontSize!, grade);
    return baseStyle.copyWith(fontSize: fontSize);
  }

  double _gradeFontSize(double baseSize, GradeLevel grade) {
    switch (grade) {
      case GradeLevel.kindergarten:
      case GradeLevel.primary1_3:
        return baseSize * 1.3; // 幼儿和低年级放大公式
      case GradeLevel.primary4_6:
        return baseSize * 1.15;
      case GradeLevel.junior:
        return baseSize * 1.05;
      case GradeLevel.senior:
        return baseSize; // 高中用标准大小
    }
  }
}

enum MathStyle { display, text }

class MathStyleSpec {
  final double fontSize;
  final double lineHeight;
  final Color color;

  const MathStyleSpec({
    required this.fontSize,
    this.lineHeight = 1.5,
    required this.color,
  });
}
```

### 4.4 常见学科公式渲染清单

| 学科 | 公式类型 | LaTeX 示例 | 渲染要求 |
|------|----------|-----------|---------|
| 数学 | 分数 | `\frac{a}{b}` | 上下排版 |
| 数学 | 根号 | `\sqrt[n]{x}` | 嵌套根号 |
| 数学 | 上下标 | `x^{2}`, `a_{n}` | 定位精确 |
| 数学 | 矩阵 | `\begin{pmatrix}...\end{pmatrix}` | 对齐 |
| 数学 | 求和/积分 | `\sum_{i=1}^{n}`, `\int_{a}^{b}` | 上下限 |
| 数学 | 三角函数 | `\sin^2\theta + \cos^2\theta = 1` | 函数正体 |
| 数学 | 方程组 | `\begin{cases}...\end{cases}` | 左对齐花括号 |
| 物理 | 单位 | `\text{m/s}^2`, `\text{kg·m}` | 单位正体 |
| 物理 | 矢量 | `\vec{F}`, `\overrightarrow{AB}` | 箭头 |
| 化学 | 方程式 | `2H_2 + O_2 \rightarrow 2H_2O` | 下标、箭头 |
| 化学 | 离子方程 | `Ba^{2+} + SO_4^{2-} = BaSO_4\downarrow` | 上下标 |
| 生物 | 化学式 | `C_6H_{12}O_6` | 下标 |

---

## 5. 代码块渲染器（CodeBlockRenderer）

### 5.1 功能需求

1. 支持语法高亮（至少 15 种语言）
2. 行号显示
3. 一键复制
4. 流式代码接收时的光标动画

### 5.2 核心实现

```dart
class CodeBlockWidget extends StatefulWidget {
  final String code;
  final String language;
  final bool isStreaming;
  final bool showLineNumbers;

  const CodeBlockWidget({
    super.key,
    required this.code,
    required this.language,
    this.isStreaming = false,
    this.showLineNumbers = true,
  });

  @override
  State<CodeBlockWidget> createState() => _CodeBlockWidgetState();
}

class _CodeBlockWidgetState extends State<CodeBlockWidget> {
  bool _copied = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: theme.brightness == Brightness.dark
            ? const Color(0xFF1E1E1E)
            : const Color(0xFFF5F5F5),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: theme.colorScheme.outlineVariant.withOpacity(0.3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // 头部：语言标签 + 复制按钮
          _buildHeader(context),
          // 代码内容
          _buildCodeContent(context),
        ],
      ),
    );
  }

  Widget _buildHeader(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceVariant.withOpacity(0.5),
        borderRadius: const BorderRadius.vertical(top: Radius.circular(8)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            widget.language.toUpperCase(),
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          _buildCopyButton(context),
        ],
      ),
    );
  }

  Widget _buildCopyButton(BuildContext context) {
    return InkWell(
      onTap: _copyCode,
      borderRadius: BorderRadius.circular(4),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              _copied ? Icons.check : Icons.copy,
              size: 14,
              color: _copied ? Colors.green : null,
            ),
            const SizedBox(width: 4),
            Text(
              _copied ? '已复制' : '复制',
              style: TextStyle(fontSize: 12, color: _copied ? Colors.green : null),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCodeContent(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (widget.showLineNumbers) _buildLineNumbers(),
          const SizedBox(width: 12),
          Expanded(child: _buildHighlightedCode()),
          if (widget.isStreaming) _buildCursor(),
        ],
      ),
    );
  }

  Widget _buildLineNumbers() {
    final lines = widget.code.split('\n');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: List.generate(lines.length, (i) {
        return Text(
          '${i + 1}',
          style: TextStyle(
            fontSize: 12,
            fontFamily: 'monospace',
            color: Theme.of(context).colorScheme.onSurfaceVariant.withOpacity(0.5),
            height: 1.6,
          ),
        );
      }),
    );
  }

  Widget _buildHighlightedCode() {
    // 使用 highlight 库进行语法高亮
    try {
      final highlighted = highlight.parse(widget.code, language: widget.language);
      return _buildRichTextFromNodes(highlighted.nodes!);
    } catch (_) {
      // 降级为纯文本
      return SelectableText(
        widget.code,
        style: const TextStyle(fontFamily: 'monospace', fontSize: 13, height: 1.6),
      );
    }
  }

  Widget _buildCursor() {
    return Padding(
      padding: const EdgeInsets.only(left: 2),
      child: _BlinkingCursor(),
    );
  }

  Future<void> _copyCode() async {
    await Clipboard.setData(ClipboardData(text: widget.code));
    setState(() => _copied = true);
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) setState(() => _copied = false);
    });
  }
}

/// 流式光标动画
class _BlinkingCursor extends StatefulWidget {
  @override
  State<_BlinkingCursor> createState() => _BlinkingCursorState();
}

class _BlinkingCursorState extends State<_BlinkingCursor>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 530),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _controller,
      child: Container(
        width: 2,
        height: 16,
        color: Theme.of(context).colorScheme.primary,
      ),
    );
  }
}
```

### 5.3 支持的语法高亮语言

| 类别 | 语言 |
|------|------|
| 编程 | Dart, Python, JavaScript, Java, C/C++ |
| 标记 | HTML, XML, JSON, YAML, Markdown |
| 学科 | LaTeX (数学公式源码), GNUPLOT |
| 数据库 | SQL |
| 其他 | Bash, PowerShell, Diff |

---

## 6. 流式 Markdown 宿主 Widget

### 6.1 StreamingMarkdownWidget

这是消息气泡内的核心 Widget，管理整个流式渲染生命周期。

```dart
/// 流式 Markdown 渲染宿主
class StreamingMarkdownWidget extends StatefulWidget {
  /// 消息 ID（用于缓存标识）
  final String messageId;

  /// 初始完整文本（用于非流式场景，如历史消息）
  final String? initialText;

  /// SSE Token 流
  final Stream<String>? tokenStream;

  /// 分龄样式配置
  final AgeAdaptiveStyle ageStyle;

  /// 是否显示操作按钮（复制、反馈等）
  final bool showActions;

  /// 步骤折叠策略
  final StepCollapseStrategy stepStrategy;

  const StreamingMarkdownWidget({
    super.key,
    required this.messageId,
    this.initialText,
    this.tokenStream,
    required this.ageStyle,
    this.showActions = true,
    this.stepStrategy = StepCollapseStrategy.autoCollapseAfter,
  });

  @override
  State<StreamingMarkdownWidget> createState() => _StreamingMarkdownWidgetState();
}

class _StreamingMarkdownWidgetState extends State<StreamingMarkdownWidget> {
  late final IncrementalMarkdownParser _parser;
  late final RenderCache _renderCache;

  StreamSubscription<String>? _tokenSubscription;
  List<ASTNode> _currentNodes = [];
  bool _isStreaming = false;
  bool _isFinal = false;
  String _fullText = '';

  // 性能监控
  int _tokenCount = 0;
  int _rebuildCount = 0;
  DateTime? _streamStartTime;

  @override
  void initState() {
    super.