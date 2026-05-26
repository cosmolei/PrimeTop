# 客户端 - 全局浮窗 AI 助手与跨页面学习辅助 详细设计

## 1. 模块概述

### 1.1 功能定位

全局浮窗 AI 助手是一个可在 APP 内任意页面悬浮显示的交互入口，学生无需离开当前学习页面即可快速发起 AI 提问、拍照搜题、剪贴板内容识别等操作。浮窗以半透明气泡形式常驻，支持拖拽定位、展开为迷你对话面板、收起为气泡等交互状态。

**核心价值：**
1. **降低操作成本**：任意页面 1 次点击即可触发 AI 辅助，无需切换到 AI 对话页
2. **保持学习上下文**：在同步课堂、错题本等页面直接提问，不丢失当前页面状态
3. **提升高频场景效率**：做题时遇到问题一键求助，形成"做题→疑问→解答→继续"的流畅闭环

### 1.2 目标用户

| 学段 | 典型场景 |
|------|----------|
| 小学 | 在同步课堂页遇到不懂的知识点，点击浮窗提问 |
| 初中 | 在练习页面遇到不会的题目，点击浮窗拍照搜题 |
| 高中 | 在错题本复习时想看类似题，点击浮窗获取推荐 |

### 1.3 设计原则

1. **非侵入式**：浮窗不遮挡核心学习内容，可拖拽至任意边缘位置
2. **轻量快速**：展开面板 300ms 内完成渲染，首 token 响应 < 2s
3. **状态感知**：根据当前页面上下文自动填充学科、知识点等辅助信息
4. **可关闭**：用户可在设置中彻底关闭浮窗功能
5. **安全合规**：浮窗不支持在考试模式、家长管控时段内使用

---

## 2. 功能范围

### 2.1 功能清单

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 悬浮气泡显示 | 半透明气泡常驻屏幕右下角 | P0 |
| 拖拽定位 | 长按拖拽至屏幕任意边缘，自动吸附 | P0 |
| 展开迷你对话面板 | 点击气泡展开半屏对话面板 | P0 |
| 快捷入口 | 展开时显示"拍照搜题""语音提问""文字输入"快捷按钮 | P0 |
| 页面上下文感知 | 自动获取当前页面学科、知识点、题目等信息 | P1 |
| 剪贴板识别 | 检测剪贴板中的题目文本并提示是否需要解答 | P2 |
| 收起/最小化 | 面板收起为气泡，保持对话状态 | P0 |
| 全屏跳转 | 从迷你面板跳转到完整 AI 对话页 | P1 |
| 历史对话保留 | 迷你面板内保留最近一次对话上下文 | P1 |
| 设置开关 | 在设置中控制浮窗显示/隐藏 | P0 |

### 2.2 不在范围内

| 排除功能 | 原因 |
|----------|------|
| 系统级全局浮窗（跨 APP） | 需要系统 overlay 权限，合规风险高，V2.0 再评估 |
| 浮窗内完整 AI 对话 | 迷你面板仅支持单轮问答，多轮对话跳转至 AI 对话页 |
| 浮窗内做题/练习 | 浮窗不承载复杂交互，仅作为快捷入口 |

---

## 3. 交互设计

### 3.1 状态流转

```
                        ┌──────────────────────────┐
                        │    浮窗功能已关闭(隐藏)     │
                        └─────────┬────────────────┘
                                  │ 设置中开启
                                  ▼
┌─────────┐  点击气泡  ┌──────────────────┐  点击全屏按钮  ┌───────────────┐
│  气泡态   │ ────────▶ │  迷你对话面板展开  │ ─────────────▶ │ 完整AI对话页   │
│ (Bubble) │ ◀──────── │ (MiniPanel)      │ ◀──────────── │ (FullChat)    │
└─────────┘  收起面板  └──────────────────┘  返回迷你面板   └───────────────┘
     │                                                        ▲
     │                   长按气泡拖拽                            │
     └────────────────────────────────────────────────────────┘
                         (拖拽中跟随手指)
```

### 3.2 状态枚举

```dart
enum FloatingAssistantState {
  hidden,      // 浮窗已关闭（设置关闭或合规限制）
  bubble,      // 气泡态：右下角悬浮显示
  expanding,   // 展开动画中
  miniPanel,   // 迷你面板展开态
  collapsing,  // 收起动画中
  dragging,    // 用户正在拖拽气泡
}
```

### 3.3 气泡态 (Bubble) 交互

| 操作 | 行为 |
|------|------|
| 单击 | 展开迷你对话面板 |
| 长按(>500ms) | 进入拖拽模式 |
| 拖拽释放 | 自动吸附至最近屏幕边缘，纵向保持释放位置 |
| 无操作 30s | 气泡半透明度降至 30%（仅显示轮廓），点击恢复 |

### 3.4 迷你对话面板 (MiniPanel) 交互

**面板尺寸：**
- 宽度：屏幕宽度 × 0.85（最大 400dp）
- 高度：屏幕高度 × 0.55（最大 480dp）
- 位置：屏幕底部居中，底边距底部导航栏顶部 8dp

**面板布局（从上到下）：**

```
┌────────────────────────────────────────┐
│  PrimeTop AI助手            [全屏] [×] │  ← 标题栏
├────────────────────────────────────────┤
│                                        │
│  (对话内容区域)                          │  ← 消息气泡展示
│  AI: 这个问题涉及一元二次方程...          │
│                                        │
├────────────────────────────────────────┤
│  [📷拍照]  [🎤语音]  [📋粘贴板]         │  ← 快捷入口
├────────────────────────────────────────┤
│  [输入框: 请输入你的问题...]    [发送]   │  ← 输入区
└────────────────────────────────────────┘
```

**面板内快捷入口行为：**

| 入口 | 行为 |
|------|------|
| 📷 拍照 | 调起相机 → 拍照/选图 → OCR 识别 → 在面板内显示解析结果 |
| 🎤 语音 | 调起语音识别 → 文本填入输入框 → 自动发送 |
| 📋 粘贴板 | 检测剪贴板文本 → 预填入输入框（不自动发送） |
| 全屏按钮 | 关闭迷你面板，携带当前对话上下文跳转至完整 AI 对话页 |
| × 关闭 | 收起为气泡态，保留对话上下文（下次打开可继续） |

### 3.5 页面上下文感知

当用户在特定页面点击浮窗时，系统自动提取当前页面上下文，作为 AI 请求的辅助信息：

| 来源页面 | 提取的上下文信息 |
|----------|-----------------|
| 同步课堂页 | 学科、教材版本、年级、当前章节、知识点 |
| 错题本详情 | 学科、题目内容、知识点、错误原因标签 |
| 练习页面 | 学科、当前题目、题目类型 |
| 考点梳理页 | 学科、当前考点、相关知识点 |
| AI 对话页 | （浮窗自动隐藏，直接使用对话页） |
| 首页 | 无额外上下文，使用用户默认年级学科 |

**上下文数据结构：**

```dart
class PageContext {
  final String source;        // 来源页面标识: 'sync_class'|'mistake'|'practice'|...
  final String? subject;      // 学科: 'math'|'physics'|...
  final String? chapterId;    // 当前章节 ID
  final String? knowledgeId;  // 当前知识点 ID
  final String? questionId;   // 当前题目 ID（如有）
  final String? extraPrompt;  // 附加提示信息
}
```

---

## 4. 技术架构

### 4.1 客户端架构（Flutter）

```
┌──────────────────────────────────────────────────┐
│                    APP 层                         │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ 同步课堂  │  │ 错题本    │  │ 练习/其他页面  │  │
│  └────┬─────┘  └────┬─────┘  └──────┬────────┘  │
│       │              │               │           │
│       └──────────────┼───────────────┘           │
│                      ▼                           │
│  ┌───────────────────────────────────────────┐   │
│  │     FloatingAssistantOverlay (全局 Overlay) │   │
│  │  ┌───────────┐   ┌──────────────────────┐ │   │
│  │  │ BubbleWidget│  │  MiniPanelWidget    │ │   │
│  │  └───────────┘   └──────────────────────┘ │   │
│  └───────────────────────────────────────────┘   │
│                      │                           │
│                      ▼                           │
│  ┌───────────────────────────────────────────┐   │
│  │      FloatingAssistantController           │   │
│  │  - 状态管理 (state / position)             │   │
│  │  - 上下文感知 (PageContext)                │   │
│  │  - AI 请求代理                             │   │
│  │  - 拖拽手势处理                            │   │
│  └───────────────────────────────────────────┘   │
│                      │                           │
│                      ▼                           │
│  ┌───────────────────────────────────────────┐   │
│  │         底层服务层                          │   │
│  │  AI对话服务 │ 拍照搜题服务 │ 语音服务       │   │
│  └───────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

### 4.2 核心类设计

#### 4.2.1 FloatingAssistantController

```dart
/// 全局浮窗控制器 - 管理浮窗生命周期和状态
class FloatingAssistantController extends ChangeNotifier {
  // ── 状态 ──
  FloatingAssistantState _state = FloatingAssistantState.hidden;
  Offset _bubblePosition = const Offset(double.infinity, double.infinity); // infinity 表示使用默认位置
  PageContext? _currentPageContext;

  // ── 对话数据 ──
  final List<ChatMessage> _messages = [];
  String? _currentConversationId; // 用于跳转全屏时传递
  bool _isLoading = false;

  // ── 持久化 ──
  final FloatingAssistantStorage _storage;
  final AIService _aiService;
  final ContextExtractor _contextExtractor;

  // ── Getters ──
  FloatingAssistantState get state => _state;
  Offset get bubblePosition => _position;
  List<ChatMessage> get messages => List.unmodifiable(_messages);
  bool get isEnabled => _storage.isEnabled;
  PageContext? get pageContext => _currentPageContext;

  /// 初始化 - 从本地存储恢复状态
  Future<void> init() async {
    await _storage.load();
    if (_storage.isEnabled) {
      _bubblePosition = _storage.lastPosition ?? _defaultPosition();
      _state = FloatingAssistantState.bubble;
    }
    notifyListeners();
  }

  /// 展开迷你面板
  void expand() {
    if (_state != FloatingAssistantState.bubble) return;
    _state = FloatingAssistantState.expanding;
    notifyListeners();
    // 动画完成后
    Future.delayed(const Duration(milliseconds: 300), () {
      _state = FloatingAssistantState.miniPanel;
      notifyListeners();
    });
  }

  /// 收起迷你面板
  void collapse() {
    if (_state != FloatingAssistantState.miniPanel) return;
    _state = FloatingAssistantState.collapsing;
    notifyListeners();
    Future.delayed(const Duration(milliseconds: 250), () {
      _state = FloatingAssistantState.bubble;
      notifyListeners();
    });
  }

  /// 更新气泡位置（拖拽后）
  void updatePosition(Offset newPosition) {
    _bubblePosition = _snapToEdge(newPosition);
    _storage.savePosition(_bubblePosition);
    notifyListeners();
  }

  /// 更新页面上下文（页面切换时调用）
  void updatePageContext(PageContext? context) {
    _currentPageContext = context;
  }

  /// 发送消息（迷你面板内）
  Future<void> sendMessage(String content, {InputMode mode = InputMode.text}) async {
    final userMsg = ChatMessage.user(content, mode: mode);
    _messages.add(userMsg);
    _isLoading = true;
    notifyListeners();

    try {
      // 构建请求，附加页面上下文
      final request = AIChatRequest(
        messages: _buildRequestMessages(),
        pageContext: _currentPageContext,
        mode: FloatingMode.mini, // 标记为浮窗模式，AI 可调整回答长度
      );

      await for (final chunk in _aiService.streamChat(request)) {
        if (_state != FloatingAssistantState.miniPanel) {
          break; // 面板已关闭，停止接收
        }
        // 流式更新最后一条 AI 消息
        _appendChunk(chunk);
        notifyListeners();
      }
    } catch (e) {
      _messages.add(ChatMessage.error(_formatError(e)));
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// 跳转到完整 AI 对话页
  Future<void> openFullChat(BuildContext context) async {
    collapse();
    final conversationId = await _ensureConversationId();
    // 通过路由携带对话 ID 跳转
    Navigator.of(context).pushNamed(
      '/ai-chat',
      arguments: {'conversationId': conversationId, 'messages': _messages},
    );
  }

  /// 开关浮窗功能
  Future<void> toggleEnabled(bool enabled) async {
    await _storage.setEnabled(enabled);
    _state = enabled ? FloatingAssistantState.bubble : FloatingAssistantState.hidden;
    notifyListeners();
  }

  // ── 私有方法 ──
  Offset _defaultPosition() {
    // 默认右下角，距底部导航栏 120dp，距右边 16dp
    return const Offset(double.infinity, double.infinity);
  }

  Offset _snapToEdge(Offset position) {
    // 吸附至最近的左/右边缘，纵向 clamp 在安全区域内
    final screenW = WidgetsBinding.instance.platformDispatcher.views.first.physicalSize.width
        / WidgetsBinding.instance.platformDispatcher.views.first.devicePixelRatio;
    final snappedX = position.dx > screenW / 2 ? screenW - 56 : 8; // 56 = 气泡直径 + margin
    final snappedY = position.dy.clamp(80.0, screenW * 1.5); // 纵向安全区
    return Offset(snappedX, snappedY);
  }
}
```

#### 4.2.2 FloatingAssistantOverlay

```dart
/// 全局浮窗 Overlay - 通过 Navigator 的 overlay 插入
class FloatingAssistantOverlay extends StatelessWidget {
  final Widget child;
  final FloatingAssistantController controller;

  const FloatingAssistantOverlay({
    super.key,
    required this.child,
    required this.controller,
  });

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        child,
        AnimatedBuilder(
          animation: controller,
          builder: (context, _) {
            if (controller.state == FloatingAssistantState.hidden) {
              return const SizedBox.shrink();
            }
            return _buildOverlayContent(context);
          },
        ),
      ],
    );
  }

  Widget _buildOverlayContent(BuildContext context) {
    return Stack(
      children: [
        // 气泡态
        if (controller.state == FloatingAssistantState.bubble ||
            controller.state == FloatingAssistantState.dragging)
          _BubbleWidget(
            position: controller.bubblePosition,
            onTap: controller.expand,
            onDragEnd: controller.updatePosition,
          ),

        // 迷你面板态
        if (controller.state == FloatingAssistantState.miniPanel ||
            controller.state == FloatingAssistantState.expanding ||
            controller.state == FloatingAssistantState.collapsing)
          _MiniPanelWidget(
            controller: controller,
            isExpanding: controller.state == FloatingAssistantState.expanding,
            isCollapsing: controller.state == FloatingAssistantState.collapsing,
          ),
      ],
    );
  }
}
```

#### 4.2.3 气泡拖拽手势处理

```dart
class _BubbleWidget extends StatefulWidget {
  final Offset position;
  final VoidCallback onTap;
  final ValueChanged<Offset> onDragEnd;

  const _BubbleWidget({
    required this.position,
    required this.onTap,
    required this.onDragEnd,
  });

  @override
  State<_BubbleWidget> createState() => _BubbleWidgetState();
}

class _BubbleWidgetState extends State<_BubbleWidget>
    with SingleTickerProviderStateMixin {
  Offset _currentPosition = Offset.zero;
  bool _isDragging = false;
  late AnimationController _idleAnimation; // 空闲时轻微呼吸动画
  DateTime? _lastInteraction;
  Timer? _fadeTimer;

  @override
  void initState() {
    super.initState();
    _currentPosition = widget.position;
    _idleAnimation = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2000),
    )..repeat(reverse: true);

    _startFadeTimer();
  }

  void _startFadeTimer() {
    _fadeTimer?.cancel();
    _fadeTimer = Timer(const Duration(seconds: 30), () {
      if (mounted) setState(() {}); // 触发半透明重建
    });
  }

  double get _opacity {
    final idle = _lastInteraction == null ||
        DateTime.now().difference(_lastInteraction!).inSeconds > 30;
    return idle && !_isDragging ? 0.3 : 1.0;
  }

  @override
  Widget build(BuildContext context) {
    return Positioned(
      left: _currentPosition.dx,
      top: _currentPosition.dy,
      child: GestureDetector(
        onTap: _isDragging ? null : () {
          _lastInteraction = DateTime.now();
          _startFadeTimer();
          widget.onTap();
        },
        onLongPressStart: (_) {
          _isDragging = true;
          _lastInteraction = DateTime.now();
          HapticFeedback.mediumImpact();
        },
        onLongPressMoveUpdate: (details) {
          setState(() {
            _currentPosition = details.globalPosition - const Offset(28, 28);
          });
        },
        onLongPressEnd: (_) {
          _isDragging = false;
          widget.onDragEnd(_currentPosition);
        },
        child: AnimatedOpacity(
          opacity: _opacity,
          duration: const Duration(milliseconds: 500),
          child: AnimatedBuilder(
            animation: _idleAnimation,
            builder: (context, child) {
              final scale = _isDragging ? 1.1 : 1.0 + _idleAnimation.value * 0.05;
              return Transform.scale(
                scale: scale,
                child: child,
              );
            },
            child: Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF6C63FF), Color(0xFF4ECDC4)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFF6C63FF).withOpacity(0.3),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: const Icon(
                Icons.auto_awesome,
                color: Colors.white,
                size: 28,
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    _idleAnimation.dispose();
    _fadeTimer?.cancel();
    super.dispose();
  }
}
```

### 4.3 迷你面板动画

```dart
class _MiniPanelWidget extends StatefulWidget {
  final FloatingAssistantController controller;
  final bool isExpanding;
  final bool isCollapsing;

  const _MiniPanelWidget({
    required this.controller,
    this.isExpanding = false,
    this.isCollapsing = false,
  });

  @override
  State<_MiniPanelWidget> createState() => _MiniPanelWidgetState();
}

class _MiniPanelWidgetState extends State<_MiniPanelWidget>
    with SingleTickerProviderStateMixin {
  late AnimationController _animController;
  late Animation<double> _scaleAnim;
  late Animation<double> _opacityAnim;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 300),
    );
    _scaleAnim = CurvedAnimation(
      parent: _animController,
      curve: Curves.easeOutCubic,
    );
    _opacityAnim = CurvedAnimation(
      parent: _animController,
      curve: Curves.easeOut,
    );

    if (widget.isExpanding) {
      _animController.forward();
    } else if (widget.isCollapsing) {
      _animController.reverse();
    } else {
      _animController.value = 1.0;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: GestureDetector(
        onTap: () => widget.controller.collapse(), // 点击遮罩收起
        behavior: HitTestBehavior.opaque,
        child: Container(
          color: Colors.black26,
          child: Align(
            alignment: Alignment.bottomCenter,
            child: GestureDetector(
              onTap: () {}, // 阻止事件冒泡
              child: ScaleTransition(
                scale: _scaleAnim,
                child: FadeTransition(
                  opacity: _opacityAnim,
                  child: _buildPanelContent(context),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPanelContent(BuildContext context) {
    final screenW = MediaQuery.of(context).size.width;
    final panelW = (screenW * 0.85).clamp(300.0, 400.0);
    final panelH = (MediaQuery.of(context).size.height * 0.55).clamp(350.0, 480.0);

    return Container(
      width: panelW,
      height: panelH,
      margin: const EdgeInsets.only(bottom: 72), // 底部导航栏高度 + 间距
      decoration: BoxDecoration(
        color: Theme.of(context).scaffoldBackgroundColor,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.15),
            blurRadius: 24,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: Column(
        children: [
          _buildTitleBar(context),
          Expanded(child: _buildMessageList(context)),
          _buildQuickActions(context),
          _buildInputBar(context),
        ],
      ),
    );
  }

  // ... 各子组件实现省略，见下方各节
}
```

---

## 5. 页面上下文感知机制

### 5.1 ContextExtractor

```dart
/// 页面上下文提取器 - 在路由切换时自动提取当前页面上下文
class ContextExtractor {
  /// 从路由信息提取上下文
  PageContext? extract(RouteSettings routeSettings, Object? arguments) {
    final path = routeSettings.name;
    if (path == null) return null;

    // 同步课堂页
    if (path.startsWith('/sync-class/chapter')) {
      final args = arguments as Map<String, dynamic>?;
      return PageContext(
        source: 'sync_class',
        subject: args?['subject'] as String?,
        chapterId: args?['chapterId'] as String?,
        knowledgeId: args?['knowledgeId'] as String?,
      );
    }

    // 错题本详情页
    if (path.startsWith('/mistake/detail')) {
      final args = arguments as Map<String, dynamic>?;
      return PageContext(
        source: 'mistake',
        subject: args?['subject'] as String?,
        questionId: args?['questionId'] as String?,
        knowledgeId: args?['knowledgeId'] as String?,
        extraPrompt: '这是一道错题，请重点讲解易错点和解题思路。',
      );
    }

    // 练习页面
    if (path.startsWith('/practice')) {
      final args = arguments as Map<String, dynamic>?;
      return PageContext(
        source: 'practice',
        subject: args?['subject'] as String?,
        questionId: args?['questionId'] as String?,
      );
    }

    // AI 对话页 - 隐藏浮窗
    if (path.startsWith('/ai-chat')) {
      return null; // 返回 null 表示不需要浮窗
    }

    // 默认（首页等）
    return PageContext(source: 'home');
  }
}
```

### 5.2 路由监听集成

```dart
/// 在 MaterialApp 的 navigatorObservers 中注册
class FloatingAssistantRouteObserver extends NavigatorObserver {
  final FloatingAssistantController controller;
  final ContextExtractor contextExtractor;

  FloatingAssistantRouteObserver(this.controller, this.contextExtractor);

  @override
  void didPush(Route route, Route? previousRoute) {
    _updateContext(route.settings);
  }

  @override
  void didReplace({Route? newRoute, Route? oldRoute}) {
    if (newRoute != null) _updateContext(newRoute.settings);
  }

  @override
  void didPop(Route route, Route? previousRoute) {
    if (previousRoute != null) _updateContext(previousRoute.settings);
  }

  void _updateContext(RouteSettings settings) {
    final context = contextExtractor.extract(settings, null);
    controller.updatePageContext(context);

    // AI 对话页隐藏浮窗
    if (settings.name?.startsWith('/ai-chat') == true) {
      controller.collapse();
    }
  }
}
```

---

## 6. AI 请求适配

### 6.1 浮窗模式 AI Prompt 策略

浮窗迷你面板空间有限，AI 回答需要更紧凑：

```dart
class FloatingAssistantPromptDecorator {
  /// 为浮窗模式生成系统提示词
  static String buildSystemPrompt(PageContext? context) {
    final buffer = StringBuffer();
    buffer.writeln('你是启硕 PrimeTop 的 AI 学习助手。当前用户正在使用浮窗迷你面板提问。');
    buffer.writeln('');
    buffer.writeln('## 回答格式要求（浮窗模式）');
    buffer.writeln('- 回答控制在 200 字以内');
    buffer.writeln('- 优先给出关键结论或解题思路，再补充简要说明');
    buffer.writeln('- 使用短段落，每段不超过 3 句话');
    buffer.writeln('- 如需详细解答，提示用户"点击全屏查看完整解析"');
    buffer.writeln('');

    if (context != null) {
      buffer.writeln('## 当前页面上下文');
      if (context.subject != null) {
        buffer.writeln('- 学科：${_subjectLabel(context.subject!)}');
      }
      if (context.chapterId != null) {
        buffer.writeln('- 当前章节ID：${context.chapterId}');
      }
      if (context.knowledgeId != null) {
        buffer.writeln('- 当前知识点ID：${context.knowledgeId}');
      }
      if (context.questionId != null) {
        buffer.writeln('- 当前题目ID：${context.questionId}');
      }
      if (context.extraPrompt != null) {
        buffer.writeln('- 附加提示：${context.extraPrompt}');
      }
    }

    return buffer.toString();
  }

  static String _subjectLabel(String code) {
    const map = {
      'chinese': '语文', 'math': '数学', 'english': '英语',
      'physics': '物理', 'chemistry': '化学', 'biology': '生物',
      'history': '历史', 'geography': '地理', 'politics': '政治',
    };
    return map[code] ?? code;
  }
}
```

### 6.2 AI 服务请求结构

```dart
class AIChatRequest {
  final List<ChatMessage> messages;
  final PageContext? pageContext;
  final FloatingMode mode; // mini | full

  AIChatRequest({
    required this.messages,
    this.pageContext,
    this.mode = FloatingMode.mini,
  });

  // 转换为 API 请求体
  Map<String, dynamic> toApiBody(String userId, String studentStage) {
    return {
      'userId': userId,
      'studentStage': studentStage,
      'mode': mode.name,
      'context': pageContext?.toJson(),
      'messages': messages.map((m) => m.toApiBody()).toList(),
      'streaming': true, // 浮窗始终使用流式响应
    };
  }
}

enum FloatingMode { mini, full }
```

---

## 7. 服务端接口设计

### 7.1 迷你面板对话接口

复用 AI 对话引擎的流式接口，增加浮窗模式标识：

**请求：**
```
POST /api/v1/ai/chat/stream
```

```json
{
  "conversationId": "conv_xxx",
  "messages": [
    {
      "role": "user",
      "content": "一元二次方程的求根公式是什么？",
      "mode": "text"
    }
  ],
  "context": {
    "source": "practice",
    "subject": "math",
    "chapterId": "ch_math_09_02",
    "questionId": "q_12345"
  },
  "mode": "mini",
  "streaming": true
}
```

**响应（SSE 流式）：**
```
event: message_start
data: {"conversationId": "conv_xxx", "messageId": "msg_xxx"}

event: content_delta
data: {"delta": "一元二次方程 ax²+bx+c=0 (a≠0) 的求根公式为：\n\n"}

event: content_delta
data: {"delta": "x = (-b ± √(b²-4ac)) / 2a\n\n"}

event: content_delta
data: {"delta": "其中判别式 Δ=b²-4ac 决定根的情况。\n\n👉 点击全屏查看详细推导过程。"}

event: message_end
data: {"usage": {"tokens": 85}, "finishReason": "stop"}
```

### 7.2 浮窗对话转全屏接口

**请求：**
```
POST /api/v1/ai/conversation/upgrade
```

```json
{
  "tempConversationId": "temp_conv_xxx",
  "mode": "full"
}
```

**响应：**
```json
{
  "conversationId": "conv_yyy",
  "messages": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ],
  "summary": "浮窗对话摘要，用于完整对话上下文"
}
```

> **说明**：浮窗对话可能使用临时 ID（`temp_conv_` 前缀），转全屏时服务端创建正式会话并迁移消息历史。

---

## 8. 本地存储设计

### 8.1 存储结构（SharedPreferences + SQLite）

**SharedPreferences 键值：**

| 键 | 类型 | 说明 |
|----|------|------|
| `floating_assistant_enabled` | bool | 浮窗开关状态 |
| `floating_assistant_bubble_x` | double | 气泡最后 X 坐标 |
| `floating_assistant_bubble_y` | double | 气泡最后 Y 坐标 |
| `floating_assistant_last_interaction` | int | 最后交互时间戳 |

**SQLite 迷你面板对话缓存表：**

```sql
CREATE TABLE floating_chat_cache (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    role        TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'error')),
    content     TEXT NOT NULL,
    mode        TEXT NOT NULL DEFAULT 'text',  -- text | image | voice
    context_src TEXT,                          -- 来源页面
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),

    INDEX idx_fcc_user_time (user_id, created_at DESC)
);

-- 仅保留最近 50 条记录（启动时清理）
DELETE FROM floating_chat_cache
WHERE id NOT IN (
    SELECT id FROM floating_chat_cache
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 50
);
```

### 8.2 FloatingAssistantStorage

```dart
class FloatingAssistantStorage {
  final SharedPreferences _prefs;
  final AppDatabase _db;

  static const _keyEnabled = 'floating_assistant_enabled';
  static const _keyBubbleX = 'floating_assistant_bubble_x';
  static const _keyBubbleY = 'floating_assistant_bubble_y';

  bool get isEnabled => _prefs.getBool(_keyEnabled) ?? true;
  Offset? get lastPosition {
    final x = _prefs.getDouble(_keyBubbleX);
    final y = _prefs.getDouble(_keyBubbleY);
    if (x == null || y == null) return null;
    return Offset(x, y);
  }

  Future<void> setEnabled(bool value) => _prefs.setBool(_keyEnabled, value);
  Future<void> savePosition(Offset pos) async {
    await _prefs.setDouble(_keyBubbleX, pos.dx);
    await _prefs.setDouble(_keyBubbleY, pos.dy);
  }

  Future<void> load() async {
    // 初始化加载，清理过期缓存
    await _cleanOldCache();
  }

  Future<void> _cleanOldCache() async {
    await _db.customUpdate(
      'DELETE FROM floating_chat_cache WHERE id NOT IN '
      '(SELECT id FROM floating_chat_cache ORDER BY created_at DESC LIMIT 50)',
    );
  }
}
```

---

## 9. 合规与安全限制

### 9.1 浮窗关闭场景

| 场景 | 行为 | 恢复条件 |
|------|------|----------|
| 用户手动关闭 | 立即隐藏，直到用户在设置中重新开启 | 设置中开启 |
| 家长管控时段 | 自动隐藏，不响应展开 | 管控时段结束 |
| 防沉迷超时 | 自动隐藏（学习时间已达上限） | 休息后重置 |
| 考试模式（如有） | 自动隐藏 | 考试模式退出 |
| AI 对话页面 | 自动隐藏（使用完整对话页替代） | 离开 AI 对话页 |

### 9.2 合规检查逻辑

```dart
class FloatingAssistantCompliance {
  final ParentalControlService _parentalControl;
  final AntiAddictionService _antiAddiction;
  final UserSettingsService _userSettings;

  /// 检查浮窗是否可用
  Future<bool> canShowFloatingAssistant(String userId) async {
    // 1. 检查用户设置
    if (!_userSettings.isFloatingAssistantEnabled(userId)) {
      return false;
    }

    // 2. 检查家长管控时段
    if (await _parentalControl.isRestrictedTime(userId)) {
      return false;
    }

    // 3. 检查防沉迷
    if (await _antiAddiction.isTimeLimitReached(userId)) {
      return false;
    }

    return true;
  }
}
```

---

## 10. 性能优化

### 10.1 内存控制

| 策略 | 说明 |
|------|------|
| 迷你面板消息上限 | 面板内最多保留最近 10 条消息，更早的丢弃 |
| 图片缩略图 | 拍照搜题结果中的图片使用缩略图，全屏查看时加载原图 |
| 对话上下文裁剪 | 发送 AI 请求时仅携带最近 3 轮对话 + 系统提示 |
| 面板关闭释放 | 收起面板后释放图片资源和网络连接 |

### 10.2 渲染优化

```dart
/// 迷你面板消息列表使用 ListView.builder 懒加载
/// + AutomaticKeepAliveClientMixin 保持列表状态
class _MessageListWidget extends StatefulWidget {
  final List<ChatMessage> messages;
  final ScrollController scrollController;

  @override
  State<_MessageListWidget> createState() => _MessageListWidgetState();
}

class _MessageListWidgetState extends State<_MessageListWidget>
    with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return ListView.builder(
      controller: widget.scrollController,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      itemCount: widget.messages.length,
      itemBuilder: (context, index) {
        return _MessageBubble(message: widget.messages[index]);
      },
    );
  }
}
```

### 10.3 启动时序

```
APP 启动
    │
    ▼ (200ms)
首页渲染完成
    │
    ▼ (100ms)
FloatingAssistantController.init()
    │
    ├── 加载 SharedPreferences（同步） ─── 5ms
    ├── 检查合规状态 ──────────────── 50ms（异步，可并发）
    └── 气泡渲染 ─────────────────── 16ms（一帧）
    │
    ▼
气泡可见（总延迟 < 350ms）
```

---

## 11. 测试要点

### 11.1 功能测试

| 测试场景 | 预期结果 |
|----------|----------|
| 首次安装后打开 APP | 气泡显示在默认位置（右下角） |
| 点击气泡 | 展开迷你面板，显示快捷入口 |
| 拖拽气泡至左边缘 | 释放后吸附至左侧 |
| 拖拽气泡至右边缘 | 释放后吸附至右侧 |
| 在迷你面板输入问题 | AI 流式返回回答 |
| 点击全屏按钮 | 跳转至 AI 对话页，携带对话上下文 |
| 在 AI 对话页 | 浮窗自动隐藏 |
| 返回其他页面 | 浮窗自动恢复 |
| 设置中关闭浮窗 | 立即隐藏，重启后仍隐藏 |
| 家长管控时段 | 浮窗自动隐藏 |
| 浮窗 30s 无操作 | 气泡半透明度降至 30% |

### 11.2 性能测试

| 指标 | 目标 |
|------|------|
| 气泡渲染耗时 | < 16ms (60fps) |
| 面板展开动画 | 300ms, 60fps |
| AI 首 token 延迟 | < 2s |
| 面板内存增量 | < 8MB |
| 拖拽跟手延迟 | < 1帧 (16ms) |

### 11.3 兼容性测试

| 测试项 | 说明 |
|--------|------|
| 刘海屏/药丸屏 | 气泡和安全区域避让 |
| 全面屏手势 | 气泡不与系统手势冲突 |
| 横屏模式 | 浮窗自动隐藏（学习场景不横屏，后续按需支持） |
| 低端设备 | 拖拽不掉帧，面板渲染流畅 |
| Android/iOS 双端 | 行为一致 |

---

## 12. 接入指南

### 12.1 在 APP 入口集成

```dart
// main.dart 或 app.dart
class PrimeTopApp extends StatelessWidget {
  final FloatingAssistantController _floatingController = FloatingAssistantController();

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorObservers: [
        FloatingAssistantRouteObserver(_floatingController, ContextExtractor()),
      ],
      home: FloatingAssistantOverlay(
        controller: _floatingController,
        child: const HomePage(),
      ),
    );
  }
}
```

### 12.2 在各页面中无需额外代码

浮窗通过全局 Overlay + RouteObserver 自动工作，各业务页面无需感知浮窗存在。如需向浮窗传递上下文，在路由参数中携带即可（由 ContextExtractor 自动提取）。
