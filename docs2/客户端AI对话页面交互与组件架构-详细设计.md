# 客户端 AI 对话页面交互与组件架构 - 详细设计

> **版本**: v1.0 | **日期**: 2026-05-25 | **状态**: 初稿
> **关联文档**: AI对话引擎与会话管理、SSE流式响应与AI增量渲染引擎、富文本与学科内容渲染引擎、客户端架构与前端框架、答案管控与渐进式提示引擎、语音服务(ASR-TTS)

---

## 1. 文档定位与目标

### 1.1 为什么需要这份文档

AI 对话页是 PrimeTop APP 中**使用频率最高、用户停留时间最长**的核心页面。原始设计文档 §9.4 定义了交互思路，docs2 中已有服务端的对话引擎、SSE 流式渲染和富文本渲染的详细设计，但**缺少客户端 Flutter 侧的页面级组件架构和交互实现方案**。

本文档回答以下问题：

1. 对话页的 Widget 树如何组织？各组件的职责边界是什么？
2. 消息气泡如何渲染不同类型的内容（文本、公式、图片、步骤卡、表格）？
3. 底部输入栏如何统一处理文字、语音、拍照三种输入模态？
4. 流式回答时，UI 如何做增量渲染、进度指示和打字光标动画？
5. 快捷操作按钮（"换个讲法"、"再讲简单点"、"练一道"、"加入错题本"）如何动态呈现？
6. 长对话列表如何做性能优化？消息分页加载策略是什么？
7. 离线时消息如何排队？发送失败如何重试？
8. 不同学段的对话页 UI 如何自适应？

### 1.2 适用读者

- **Flutter 客户端开发**：直接实现对话页面组件
- **UI/UX 设计师**：理解技术约束和组件边界
- **测试工程师**：设计对话页测试用例
- **AI 工程师**：理解客户端如何消费和渲染 AI 流式输出

### 1.3 核心页面一览

```
┌──────────────────────────────────┐
│  AppBar: 对话标题 / 场景标签      │
│  [⋯] 更多操作菜单                │
├──────────────────────────────────┤
│                                  │
│  ┌──────────────────────┐        │
│  │ 用户消息气泡          │        │
│  │ 文字 / 图片缩略图      │        │
│  └──────────────────────┘        │
│                                  │
│  ┌──────────────────────┐        │
│  │ AI 回答卡片            │        │
│  │ ┌──────────────────┐  │        │
│  │ │ 理解确认卡片      │  │        │
│  │ └──────────────────┘  │        │
│  │ ┌──────────────────┐  │        │
│  │ │ 思路提示卡片      │  │        │
│  │ └──────────────────┘  │        │
│  │ ┌──────────────────┐  │        │
│  │ │ 详细步骤 + 公式   │  │        │
│  │ └──────────────────┘  │        │
│  │ ┌──────────────────┐  │        │
│  │ │ 知识点总结        │  │        │
│  │ └──────────────────┘  │        │
│  │ [换个讲法][再简单点]   │        │
│  │ [练一道][加错题本]    │        │
│  │ [👍][👎][⋯]          │        │
│  └──────────────────────┘        │
│                                  │
│  ┌──────────────────────┐        │
│  │ 建议追问芯片           │        │
│  └──────────────────────┘        │
│                                  │
├──────────────────────────────────┤
│  输入栏                          │
│  [🎤][📷] 文字输入框... [发送▶]   │
└──────────────────────────────────┘
```

---

## 2. Widget 树架构

### 2.1 顶层 Widget 树

```dart
ConversationPage          // 页面入口
├── Scaffold
│   ├── AppBar             // 标题栏：对话标题 + 操作菜单
│   ├── Body
│   │   ├── _EmptyStateView          // 空对话引导
│   │   └── _MessageList             // 消息列表（核心）
│   │       └── ListView.builder
│   │           ├── UserMessageBubble   // 用户消息气泡
│   │           ├── AiResponseCard      // AI 回答卡片
│   │           ├── SuggestionChips     // 建议追问
│   │           └── DateSeparator       // 日期分隔线
│   ├── _ScrollToBottomFab  // 滚动到底部 FAB
│   └── _InputBar            // 底部输入栏
│       ├── _VoiceInputButton    // 语音输入
│       ├── _PhotoInputButton    // 拍照/选图
│       ├── _TextInputField      // 文字输入框
│       └── _SendButton          // 发送按钮
└── _PhotoPreviewSheet     // 图片预览 BottomSheet
```

### 2.2 页面入口实现

```dart
// features/ai_tutor/presentation/conversation_page.dart

class ConversationPage extends ConsumerStatefulWidget {
  final int? conversationId; // null = 新对话
  final String? initialMessage; // 从首页快捷提问传入
  final String? scene; // 场景标识（如 'homework', 'exam_prep'）
  final String? photoPath; // 从拍照页传入的图片路径

  const ConversationPage({
    super.key,
    this.conversationId,
    this.initialMessage,
    this.scene,
    this.photoPath,
  });

  @override
  ConsumerState<ConversationPage> createState() => _ConversationPageState();
}

class _ConversationPageState extends ConsumerState<ConversationPage> {
  late final ScrollController _scrollController;
  final _inputBarController = InputBarController();
  bool _showScrollFab = false;

  @override
  void initState() {
    super.initState();
    _scrollController = ScrollController();
    _scrollController.addListener(_onScroll);

    // 初始化对话状态
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _initConversation();
    });
  }

  Future<void> _initConversation() async {
    final notifier = ref.read(conversationChatProvider.notifier);

    if (widget.conversationId != null) {
      // 恢复已有对话
      await notifier.loadConversation(widget.conversationId!);
    } else {
      // 创建新对话
      await notifier.createConversation(scene: widget.scene);
    }

    // 处理快捷提问 / 拍照传入
    if (widget.initialMessage != null) {
      notifier.sendMessage(widget.initialMessage!);
    }
    if (widget.photoPath != null) {
      notifier.sendPhotoMessage(widget.photoPath!);
    }
  }

  void _onScroll() {
    final show = _scrollController.offset > 300;
    if (show != _showScrollFab) {
      setState(() => _showScrollFab = show);
    }
  }

  void _scrollToBottom() {
    _scrollController.animateTo(
      _scrollController.position.maxScrollExtent,
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeOut,
    );
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _inputBarController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final chatState = ref.watch(conversationChatProvider);
    final ageTheme = ref.watch(ageThemeProvider);

    return Scaffold(
      appBar: _buildAppBar(chatState),
      body: Column(
        children: [
          // 网络状态横幅
          const _ConnectivityBanner(),
          // 消息列表
          Expanded(
            child: chatState.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => ErrorView(
                message: '加载对话失败',
                onRetry: () => ref.invalidate(conversationChatProvider),
              ),
              data: (state) => state.messages.isEmpty
                  ? _EmptyStateView(scene: state.conversation.scene)
                  : _MessageList(
                      messages: state.messages,
                      streamingState: state.streamingState,
                      suggestions: state.suggestions,
                      scrollController: _scrollController,
                      onRetryMessage: _onRetryMessage,
                      onQuickAction: _onQuickAction,
                      onFeedback: _onFeedback,
                    ),
            ),
          ),
          // 输入栏
          _InputBar(
            controller: _inputBarController,
            ageTheme: ageTheme,
            onSendText: _onSendText,
            onSendVoice: _onSendVoice,
            onSendPhoto: _onSendPhoto,
            onAttachFormula: _onAttachFormula,
            isStreaming: chatState.value?.streamingState == StreamingState.streaming,
          ),
        ],
      ),
      // 滚动到底部
      floatingActionButton: _showScrollFab
          ? FloatingActionButton.small(
              onPressed: _scrollToBottom,
              child: const Icon(Icons.keyboard_arrow_down),
            )
          : null,
    );
  }

  // ... 事件处理方法见后续章节
}
```

---

## 3. 消息列表组件

### 3.1 _MessageList 实现

```dart
class _MessageList extends ConsumerStatefulWidget {
  final List<Turn> messages;
  final StreamingState streamingState;
  final List<SuggestionItem>? suggestions;
  final ScrollController scrollController;
  final void Function(int turnId) onRetryMessage;
  final void Function(String action, int turnId) onQuickAction;
  final void Function(int turnId, bool positive) onFeedback;

  const _MessageList({
    required this.messages,
    required this.streamingState,
    this.suggestions,
    required this.scrollController,
    required this.onRetryMessage,
    required this.onQuickAction,
    required this.onFeedback,
  });

  @override
  ConsumerState<_MessageList> createState() => _MessageListState();
}

class _MessageListState extends ConsumerState<_MessageList> {
  bool _shouldAutoScroll = true;

  @override
  Widget build(BuildContext context) {
    final itemCount = widget.messages.length
        + (widget.suggestions != null && widget.suggestions!.isNotEmpty ? 1 : 0);

    return ListView.builder(
      controller: widget.scrollController,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      itemCount: itemCount,
      // 反向列表：新消息从底部追加，避免整体重建
      reverse: false,
      // 缓存扩展：保持已滚动过的消息不被回收
      cacheExtent: 500,
      itemBuilder: (context, index) {
        // 最后一个位置放建议芯片
        if (index == widget.messages.length) {
          return _SuggestionChips(
            suggestions: widget.suggestions!,
            onTap: (text) => _onSuggestionTap(text),
          );
        }

        final turn = widget.messages[index];
        final isLast = index == widget.messages.length - 1;
        final isStreaming = isLast && widget.streamingState == StreamingState.streaming;

        // 插入日期分隔线
        final showDate = _shouldShowDateSeparator(index);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (showDate)
              _DateSeparator(date: turn.createdAt),
            _buildTurnWidget(turn, isStreaming),
            const SizedBox(height: 12),
          ],
        );
      },
    );
  }

  Widget _buildTurnWidget(Turn turn, bool isStreaming) {
    // 用户消息
    if (turn.isUserOnly) {
      return UserMessageBubble(turn: turn);
    }
    // AI 回答（含流式状态）
    return AiResponseCard(
      turn: turn,
      isStreaming: isStreaming,
      onQuickAction: (action) => widget.onQuickAction(action, turn.id),
      onFeedback: (positive) => widget.onFeedback(turn.id, positive),
      onRetry: () => widget.onRetryMessage(turn.id),
    );
  }

  bool _shouldShowDateSeparator(int index) {
    if (index == 0) return true;
    final current = widget.messages[index].createdAt;
    final previous = widget.messages[index - 1].createdAt;
    return !_isSameDay(current, previous);
  }

  bool _isSameDay(DateTime a, DateTime b) {
    return a.year == b.year && a.month == b.month && a.day == b.day;
  }

  void _onSuggestionTap(String text) {
    // 通过 inputBarController 填入文本并触发发送
    ref.read(conversationChatProvider.notifier).sendMessage(text);
  }

  @override
  void didUpdateWidget(covariant _MessageList oldWidget) {
    super.didUpdateWidget(oldWidget);
    // 新消息追加时自动滚动到底部
    if (widget.messages.length > oldWidget.messages.length && _shouldAutoScroll) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (widget.scrollController.hasClients) {
          widget.scrollController.animateTo(
            widget.scrollController.position.maxScrollExtent,
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
          );
        }
      });
    }
  }
}
```

### 3.2 日期分隔线

```dart
class _DateSeparator extends StatelessWidget {
  final DateTime date;

  const _DateSeparator({required this.date});

  @override
  Widget build(BuildContext context) {
    final text = _formatDate(date);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surfaceVariant.withOpacity(0.5),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(
            text,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
        ),
      ),
    );
  }

  String _formatDate(DateTime d) {
    final now = DateTime.now();
    if (_isSameDay(d, now)) return '今天';
    if (_isSameDay(d, now.subtract(const Duration(days: 1)))) return '昨天';
    return '${d.month}月${d.day}日';
  }

  bool _isSameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;
}
```

---

## 4. 用户消息气泡

### 4.1 UserMessageBubble

```dart
class UserMessageBubble extends StatelessWidget {
  final Turn turn;

  const UserMessageBubble({super.key, required this.turn});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Align(
      alignment: Alignment.centerRight,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.75,
        ),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: theme.colorScheme.primary,
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(16),
              topRight: Radius.circular(16),
              bottomLeft: Radius.circular(16),
              bottomRight: Radius.circular(4), // 右下小圆角 = 发送侧
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              // 文字内容
              if (turn.userContent != null)
                Text(
                  turn.userContent!,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onPrimary,
                  ),
                ),
              // 图片附件
              if (turn.userImages != null && turn.userImages!.isNotEmpty)
                _ImageAttachments(imageUrls: turn.userImages!),
              // 语音播放条
              if (turn.userContentType == 'audio')
                _VoicePlaybackBar(audioUrl: turn.userAudioUrl!),
              // 时间戳
              const SizedBox(height: 4),
              Text(
                _formatTime(turn.createdAt),
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onPrimary.withOpacity(0.7),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _formatTime(DateTime dt) => '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
}
```

### 4.2 图片附件组件

```dart
class _ImageAttachments extends StatelessWidget {
  final List<String> imageUrls;

  const _ImageAttachments({required this.imageUrls});

  @override
  Widget build(BuildContext context) {
    if (imageUrls.length == 1) {
      // 单图：大图展示
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 200),
            child: CachedNetworkImage(
              imageUrl: imageUrls.first,
              fit: BoxFit.cover,
              placeholder: (_, __) => Container(
                height: 120,
                color: Colors.white.withOpacity(0.2),
                child: const Center(child: CircularProgressIndicator(strokeWidth: 2)),
              ),
              errorWidget: (_, __, ___) => Container(
                height: 80,
                color: Colors.white.withOpacity(0.2),
                child: const Icon(Icons.broken_image, color: Colors.white54),
              ),
            ),
          ),
        ),
      );
    }

    // 多图：2列网格
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Wrap(
        spacing: 4,
        runSpacing: 4,
        children: imageUrls.map((url) => ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: SizedBox(
            width: 100,
            height: 100,
            child: CachedNetworkImage(imageUrl: url, fit: BoxFit.cover),
          ),
        )).toList(),
      ),
    );
  }
}
```

---

## 5. AI 回答卡片

### 5.1 AiResponseCard 组件架构

AI 回答是整个对话页最复杂的组件，需要支持：

1. **分段卡片式渲染**：一个 AI 回答可能包含多个语义段落（理解确认 → 思路提示 → 详细步骤 → 总结）
2. **流式增量渲染**：SSE 流边接收边渲染
3. **富文本内容**：Markdown + LaTeX 公式 + 代码块 + 表格 + 图片
4. **快捷操作按钮**：根据回答类型动态展示
5. **反馈入口**：点赞/点踩
6. **加载与错误状态**

```dart
class AiResponseCard extends ConsumerStatefulWidget {
  final Turn turn;
  final bool isStreaming;
  final void Function(String action) onQuickAction;
  final void Function(bool positive) onFeedback;
  final VoidCallback? onRetry;

  const AiResponseCard({
    super.key,
    required this.turn,
    required this.isStreaming,
    required this.onQuickAction,
    required this.onFeedback,
    this.onRetry,
  });

  @override
  ConsumerState<AiResponseCard> createState() => _AiResponseCardState();
}

class _AiResponseCardState extends ConsumerState<AiResponseCard> {
  bool _showFeedbackButtons = true;
  bool _hasPositiveFeedback = false;
  bool _hasNegativeFeedback = false;

  @override
  Widget build(BuildContext context) {
    final ageTheme = ref.watch(ageThemeProvider);
    final theme = Theme.of(context);

    return Align(
      alignment: Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.85,
        ),
        child: Container(
          padding: EdgeInsets.all(ageTheme.spacing),
          decoration: BoxDecoration(
            color: theme.colorScheme.surfaceVariant.withOpacity(0.3),
            borderRadius: BorderRadius.only(
              topLeft: Radius.circular(4), // 左上小圆角 = 接收侧
              topRight: Radius.circular(16),
              bottomLeft: Radius.circular(16),
              bottomRight: Radius.circular(16),
            ),
            border: Border.all(
              color: theme.colorScheme.outline.withOpacity(0.1),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 内容渲染区
              _buildContent(theme, ageTheme),

              // 流式加载指示器
              if (widget.isStreaming) ...[
                const SizedBox(height: 8),
                const _TypingIndicator(),
              ],

              // 错误状态
              if (widget.turn.assistantStatus == 'error') ...[
                const SizedBox(height: 8),
                _buildErrorState(theme),
              ],

              // 操作区（流式完成后显示）
              if (!widget.isStreaming &&
                  widget.turn.assistantStatus != 'error' &&
                  widget.turn.assistantContent.isNotEmpty) ...[
                const SizedBox(height: 12),
                _buildQuickActions(ageTheme),
                const SizedBox(height: 8),
                _buildFeedbackRow(theme),
              ],

              // 时间戳
              if (!widget.isStreaming) ...[
                const SizedBox(height: 4),
                Text(
                  _formatTime(widget.turn.createdAt),
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildContent(ThemeData theme, AgeTheme ageTheme) {
    final content = widget.turn.assistantContent;
    if (content.isEmpty && !widget.isStreaming) {
      // 加载骨架屏
      return const _ShimmerPlaceholder();
    }

    // 使用分段渲染器，将回答拆分为语义段落
    return SegmentedContentRenderer(
      rawContent: content,
      isStreaming: widget.isStreaming,
      ageTheme: ageTheme,
    );
  }

  Widget _buildErrorState(ThemeData theme) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.errorContainer.withOpacity(0.3),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(Icons.error_outline, size: 18, color: theme.colorScheme.error),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              widget.turn.errorMessage ?? '回答生成失败',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.error,
              ),
            ),
          ),
          if (widget.onRetry != null)
            TextButton(
              onPressed: widget.onRetry,
              child: const Text('重试'),
            ),
        ],
      ),
    );
  }

  Widget _buildQuickActions(AgeTheme ageTheme) {
    // 根据对话场景和回答类型决定显示哪些快捷操作
    final actions = _getApplicableActions();

    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: actions.map((action) => ActionChip(
        avatar: Icon(action.icon, size: 16),
        label: Text(action.label, style: TextStyle(fontSize: ageTheme.bodyFontSize - 2)),
        onPressed: () => widget.onQuickAction(action.id),
        visualDensity: VisualDensity.compact,
      )).toList(),
    );
  }

  List<_QuickAction> _getApplicableActions() {
    final actions = <_QuickAction>[
      _QuickAction('rephrase', '换个讲法', Icons.refresh),
      _QuickAction('simpler', '再讲简单点', Icons.trending_down),
      _QuickAction('similar', '练一道', Icons.fitness_center),
    ];

    // 有题目结构时才显示"加入错题本"
    if (widget.turn.hasQuestionContext == true) {
      actions.add(_QuickAction('add_mistake', '加入错题本', Icons.bookmark_add_outlined));
    }

    // 有公式/推导过程时显示"看详细步骤"
    if (widget.turn.hasDetailedSteps == true) {
      actions.add(_QuickAction('expand_steps', '展开步骤', Icons.expand));
    }

    // 作文场景
    if (widget.turn.scene == 'essay') {
      actions.add(_QuickAction('polish', '润色建议', Icons.auto_fix_high));
    }

    return actions;
  }

  Widget _buildFeedbackRow(ThemeData theme) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        // 点赞
        _FeedbackButton(
          icon: Icons.thumb_up_outlined,
          activeIcon: Icons.thumb_up,
          isActive: _hasPositiveFeedback,
          onTap: () {
            setState(() {
              _hasPositiveFeedback = !_hasPositiveFeedback;
              if (_hasPositiveFeedback) _hasNegativeFeedback = false;
            });
            widget.onFeedback(true);
          },
        ),
        const SizedBox(width: 4),
        // 点踩
        _FeedbackButton(
          icon: Icons.thumb_down_outlined,
          activeIcon: Icons.thumb_down,
          isActive: _hasNegativeFeedback,
          onTap: () {
            setState(() {
              _hasNegativeFeedback = !_hasNegativeFeedback;
              if (_hasNegativeFeedback) _hasPositiveFeedback = false;
            });
            widget.onFeedback(false);
          },
        ),
        const SizedBox(width: 8),
        // 复制
        _IconButton(
          icon: Icons.copy_outlined,
          tooltip: '复制',
          onTap: () => _copyContent(context),
        ),
        const SizedBox(width: 4),
        // 分享
        _IconButton(
          icon: Icons.share_outlined,
          tooltip: '分享',
          onTap: () => _shareContent(context),
        ),
        const SizedBox(width: 4),
        // 举报
        _IconButton(
          icon: Icons.flag_outlined,
          tooltip: '举报',
          onTap: () => _reportContent(context),
        ),
      ],
    );
  }

  Future<void> _copyContent(BuildContext context) async {
    await Clipboard.setData(ClipboardData(text: widget.turn.assistantContent));
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已复制'), duration: Duration(seconds: 1)),
      );
    }
  }

  void _shareContent(BuildContext context) {
    // 调用分享服务
    ShareService.share(
      title: '启硕 AI 解答',
      text: widget.turn.assistantContent,
    );
  }

  void _reportContent(BuildContext context) {
    showDialog(
      context: context,
      builder: (_) => ReportDialog(
        targetType: 'ai_response',
        targetId: widget.turn.id.toString(),
      ),
    );
  }

  String _formatTime(DateTime dt) =>
      '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
}

/// 快捷操作数据类
class _QuickAction {
  final String id;
  final String label;
  final IconData icon;
  const _QuickAction(this.id, this.label, this.icon);
}
```

---

## 6. 分段内容渲染器

### 6.1 SegmentedContentRenderer

AI 回答在原始设计中被设计为"分段卡片式结构"（理解确认 → 思路提示 → 详细步骤 → 总结）。渲染器需要将 Markdown 文本拆分为语义段落并分别渲染。

```dart
/// 分段内容渲染器 — 将 AI 回答拆分为语义段落分别渲染
class SegmentedContentRenderer extends StatelessWidget {
  final String rawContent;
  final bool isStreaming;
  final AgeTheme ageTheme;

  const SegmentedContentRenderer({
    super.key,
    required this.rawContent,
    required this.isStreaming,
    required this.ageTheme,
  });

  @override
  Widget build(BuildContext context) {
    // 流式场景：直接渲染原始 Markdown（不做分段，避免频繁重建）
    if (isStreaming) {
      return _StreamingMarkdownView(
        content: rawContent,
        ageTheme: ageTheme,
      );
    }

    // 非流式：解析为语义段落并分段渲染
    final segments = ContentSegmenter.parse(rawContent);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: segments.map((seg) => _buildSegment(context, seg)).toList(),
    );
  }

  Widget _buildSegment(BuildContext context, ContentSegment segment) {
    return switch (segment.type) {
      SegmentType.understanding => _UnderstandingCard(content: segment.content),
      SegmentType.hint => _HintCard(content: segment.content),
      SegmentType.steps => _StepsCard(content: segment.content, ageTheme: ageTheme),
      SegmentType.summary => _SummaryCard(content: segment.content),
      SegmentType.formula => _FormulaBlock(formula: segment.content),
      SegmentType.table => _TableBlock(content: segment.content),
      SegmentType.code => _CodeBlock(content: segment.content),
      SegmentType.plain => _PlainMarkdown(content: segment.content, ageTheme: ageTheme),
    };
  }
}
```

### 6.2 内容分段解析器

```dart
/// 内容分段解析器 — 识别 AI 回答中的语义结构
///
/// AI 回答的 Markdown 格式规范：
/// - **【理解确认】** ... → understanding
/// - **【思路提示】** ... → hint
/// - **【详细步骤】** ... → steps (有序/无序列表)
/// - **【总结】** ... → summary
/// - 独立 $$...$$ 块 → formula
/// - Markdown 表格 → table
/// - 代码块 → code
/// - 其余 → plain
class ContentSegmenter {
  static List<ContentSegment> parse(String rawMarkdown) {
    final segments = <ContentSegment>[];
    final lines = rawMarkdown.split('\n');
    final buffer = StringBuffer();
    SegmentType currentType = SegmentType.plain;
    bool inCodeBlock = false;
    bool inMathBlock = false;

    for (int i = 0; i < lines.length; i++) {
      final line = lines[i];

      // 代码块处理
      if (line.trimLeft().startsWith('```')) {
        if (inCodeBlock) {
          buffer.writeln(line);
          segments.add(ContentSegment(
            type: SegmentType.code,
            content: buffer.toString().trim(),
          ));
          buffer.clear();
          inCodeBlock = false;
          currentType = SegmentType.plain;
          continue;
        } else {
          if (buffer.isNotEmpty) {
            segments.add(ContentSegment(type: currentType, content: buffer.toString().trim()));
            buffer.clear();
          }
          buffer.writeln(line);
          inCodeBlock = true;
          currentType = SegmentType.code;
          continue;
        }
      }
      if (inCodeBlock) {
        buffer.writeln(line);
        continue;
      }

      // 独立数学公式块
      if (line.trim() == '\$\$') {
        if (inMathBlock) {
          segments.add(ContentSegment(
            type: SegmentType.formula,
            content: buffer.toString().trim(),
          ));
          buffer.clear();
          inMathBlock = false;
          continue;
        } else {
          if (buffer.isNotEmpty) {
            segments.add(ContentSegment(type: currentType, content: buffer.toString().trim()));
            buffer.clear();
          }
          inMathBlock = true;
          continue;
        }
      }
      if (inMathBlock) {
        buffer.writeln(line);
        continue;
      }

      // 语义标签识别
      final semanticMatch = _matchSemanticTag(line);
      if (semanticMatch != null) {
        if (buffer.isNotEmpty) {
          segments.add(ContentSegment(type: currentType, content: buffer.toString().trim()));
          buffer.clear();
        }
        currentType = semanticMatch;
        // 标签行本身可能包含内容
        final cleaned = _removeSemanticTag(line);
        if (cleaned.isNotEmpty) buffer.writeln(cleaned);
        continue;
      }

      // 表格检测
      if (line.contains('|') && line.trim().startsWith('|')) {
        if (currentType != SegmentType.table) {
          if (buffer.isNotEmpty) {
            segments.add(ContentSegment(type: currentType, content: buffer.toString().trim()));
            buffer.clear();
          }
          currentType = SegmentType.table;
        }
        buffer.writeln(line);
        continue;
      }

      buffer.writeln(line);
    }

    // 处理剩余内容
    if (buffer.isNotEmpty) {
      segments.add(ContentSegment(type: currentType, content: buffer.toString().trim()));
    }

    return segments;
  }

  static SegmentType? _matchSemanticTag(String line) {
    final trimmed = line.trim();
    // 匹配 Prompt 输出的语义标签（加粗或标题形式）
    if (trimmed.contains('【理解') || trimmed.contains('**理解') || trimmed.startsWith('# 理解')) {
      return SegmentType.understanding;
    }
    if (trimmed.contains('【思路') || trimmed.contains('**思路') || trimmed.startsWith('# 思路')) {
      return SegmentType.hint;
    }
    if (trimmed.contains('【步骤') || trimmed.contains('**步骤') || trimmed.startsWith('# 步')) {
      return SegmentType.steps;
    }
    if (trimmed.contains('【总结') || trimmed.contains('**总结') || trimmed.startsWith('# 总结')) {
      return SegmentType.summary;
    }
    return null;
  }

  static String _removeSemanticTag(String line) {
    return line
        .replaceAll(RegExp(r'【[^】]*】\s*'), '')
        .replaceAll(RegExp(r'\*\*[^*]*\*\*\s*'), '')
        .replaceAll(RegExp(r'^#+\s*'), '')
        .trim();
  }
}

enum SegmentType {
  understanding, // 理解确认
  hint,          // 思路提示
  steps,         // 详细步骤
  summary,       // 知识点总结
  formula,       // 独立公式块
  table,         // 表格
  code,          // 代码块
  plain,         // 普通文本
}

class ContentSegment {
  final SegmentType type;
  final String content;
  const ContentSegment({required this.type, required this.content});
}
```

### 6.3 各段落卡片组件

```dart
/// 理解确认卡片 — 简洁展示 AI 对问题的理解
class _UnderstandingCard extends StatelessWidget {
  final String content;
  const _UnderstandingCard({required this.content});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.primaryContainer.withOpacity(0.2),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.check_circle_outline, size: 18,
            color: Theme.of(context).colorScheme.primary),
          const SizedBox(width: 8),
          Expanded(
            child: MarkdownBody(
              data: content,
              selectable: true,
              styleSheet: MarkdownStyleSheet.fromTheme(Theme.of(context)).copyWith(
                p: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 思路提示卡片 — 灯泡图标，鼓励先思考
class _HintCard extends StatelessWidget {
  final String content;
  const _HintCard({required this.content});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.amber.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.amber.withOpacity(0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.lightbulb_outline, size: 18, color: Colors.amber),
          const SizedBox(width: 8),
          Expanded(
            child: MarkdownBody(data: content, selectable: true),
          ),
        ],
      ),
    );
  }
}

/// 详细步骤卡片 — 有序步骤，支持展开/折叠
class _StepsCard extends ConsumerStatefulWidget {
  final String content;
  final AgeTheme ageTheme;
  const _StepsCard({required this.content, required this.ageTheme});

  @override
  ConsumerState<_StepsCard> createState() => _StepsCardState();
}

class _StepsCardState extends ConsumerState<_StepsCard> {
  bool _expanded = true;

  @override
  Widget build(BuildContext context) {
    // 长步骤（>5 步）默认折叠
    final stepCount = '•'.allMatches(widget.content).length +
        RegExp(r'^\d+[\.\、]', multiLine: true).allMatches(widget.content).length;
    if (stepCount > 5 && _expanded == true && mounted) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) setState(() => _expanded = false);
      });
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Theme.of(context).colorScheme.outline.withOpacity(0.15)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            child: Row(
              children: [
                Icon(
                  _expanded ? Icons.expand_less : Icons.expand_more,
                  size: 20,
                ),
                const SizedBox(width: 4),
                Text(
                  '详细步骤',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                if (!_expanded) ...[
                  const SizedBox(width: 8),
                  Text(
                    '共 $stepCount 步',
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (_expanded) ...[
            const SizedBox(height: 8),
            MarkdownBody(
              data: widget.content,
              selectable: true,
              builders: {
                'math': _MathBlockBuilder(),
                'math_inline': _MathInlineBuilder(),
              },
            ),
          ],
        ],
      ),
    );
  }
}

/// 总结卡片 — 底部高亮
class _SummaryCard extends StatelessWidget {
  final String content;
  const _SummaryCard({required this.content});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            Theme.of(context).colorScheme.primary.withOpacity(0.05),
            Theme.of(context).colorScheme.primary.withOpacity(0.1),
          ],
        ),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.summarize, size: 16, color: Theme.of(context).colorScheme.primary),
              const SizedBox(width: 6),
              Text(
                '要点总结',
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: Theme.of(context).colorScheme.primary,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          MarkdownBody(data: content, selectable: true),
        ],
      ),
    );
  }
}

/// 公式块 — LaTeX 渲染
class _FormulaBlock extends StatelessWidget {
  final String formula;
  const _FormulaBlock({required this.formula});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Center(
        child: Math.tex(
          formula,
          textStyle: TextStyle(
            fontSize: 16,
            color: Theme.of(context).colorScheme.onSurface,
          ),
          onError: (err) => Text(
            formula,
            style: const TextStyle(color: Colors.red, fontSize: 14),
          ),
        ),
      ),
    );
  }
}

/// 普通文本段 — Markdown 渲染
class _PlainMarkdown extends StatelessWidget {
  final String content;
  final AgeTheme ageTheme;
  const _PlainMarkdown({required this.content, required this.ageTheme});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: MarkdownBody(
        data: content,
        selectable: true,
        styleSheet: MarkdownStyleSheet(
          p: TextStyle(fontSize: ageTheme.bodyFontSize),
          h2: TextStyle(fontSize: ageTheme.titleFontSize, fontWeight: FontWeight.w600),
          code: TextStyle(
            fontSize: ageTheme.bodyFontSize - 1,
            backgroundColor: Theme.of(context).colorScheme.surfaceVariant,
          ),
        ),
        builders: {
          'math': _MathBlockBuilder(),
          'math_inline': _MathInlineBuilder(),
        },
      ),
    );
  }
}
```

---

## 7. 流式渲染组件

### 7.1 _StreamingMarkdownView

流式场景下不做分段解析，直接逐字符追加到 Markdown 渲染器。关键优化点：

- **节流渲染**：不是每个 SSE delta 都触发 setState，而是每 50ms 合并一次
- **公式缓冲**：遇到未闭合的 `$$` 或 `$` 时，暂缓渲染直到闭合
- **打字光标**：在流式内容末尾显示闪烁光标

```dart
class _StreamingMarkdownView extends StatefulWidget {
  final String content;
  final AgeTheme ageTheme;

  const _StreamingMarkdownView({
    required this.content,
    required this.ageTheme,
  });

  @override
  State<_StreamingMarkdownView> createState() => _StreamingMarkdownViewState();
}

class _StreamingMarkdownViewState extends State<_StreamingMarkdownView> {
  @override
  Widget build(BuildContext context) {
    // 检测是否有未闭合的数学公式
    final displayMathOpen = '```'.allMatches(widget.content).length.isOdd ? false :
        '\$\$'.allMatches(widget.content).length.isOdd;

    // 安全渲染的内容（截断到最后一个完整的块级元素）
    final safeContent = displayMathOpen
        ? _truncateToLastCompleteBlock(widget.content)
        : widget.content;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        MarkdownBody(
          data: safeContent,
          selectable: false, // 流式中不可选中，避免频繁重建导致选中丢失
          builders: {
            'math': _MathBlockBuilder(),
            'math_inline': _MathInlineBuilder(),
          },
        ),
        // 打字光标
        const SizedBox(width: 2, height: 18,
          child: _TypingCursor()),
      ],
    );
  }

  String _truncateToLastCompleteBlock(String content) {
    // 找到最后一个 $$ 之后的位置，截断
    final lastDollar = content.lastIndexOf('\$\$');
    if (lastDollar >= 0) {
      return content.substring(0, lastDollar);
    }
    return content;
  }
}

/// 打字光标 — 闪烁动画
class _TypingCursor extends StatefulWidget {
  const _TypingCursor();

  @override
  State<_TypingCursor> createState() => _TypingCursorState();
}

class _TypingCursorState extends State<_TypingCursor>
    with SingleTickerProviderStateMixin {
  late final _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 530),
  )..repeat(reverse: true);

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
        height: 18,
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.primary,
          borderRadius: BorderRadius.circular(1),
        ),
      ),
    );
  }
}
```

### 7.2 打字指示器（三点跳动）

```dart
class _TypingIndicator extends StatefulWidget {
  const _TypingIndicator();

  @override
  State<_TypingIndicator> createState() => _TypingIndicatorState();
}

class _TypingIndicatorState extends State<_TypingIndicator>
    with SingleTickerProviderStateMixin {
  late final _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(3, (i) {
        final offset = _controller.value * 2 * pi + (i * 2 * pi / 3);
        final y = sin(offset) * 3;
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 2),
          child: Transform.translate(
            offset: Offset(0, -y),
            child: Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primary.withOpacity(0.5),
                shape: BoxShape.circle,
              ),
            ),
          ),
        );
      }),
    );
  }
}
```

---

## 8. 底部输入栏

### 8.1 InputBar 组件架构

输入栏是对话页最复杂的交互组件之一，需要支持：

- 文字输入（支持多行）
- 语音输入（长按录音，松开发送）
- 拍照/相册选择（附图后预览）
- 公式输入（调起公式键盘）
- 发送按钮（根据输入状态变化）
- 流式回答时禁用发送

```dart
class _InputBar extends ConsumerStatefulWidget {
  final InputBarController controller;
  final AgeTheme ageTheme;
  final void Function(String text) onSendText;
  final void Function(String audioPath, int durationMs) onSendVoice;
  final void Function(String imagePath) onSendPhoto;
  final VoidCallback? onAttachFormula;
  final bool isStreaming;

  const _InputBar({
    required this.controller,
    required this.ageTheme,
    required this.onSendText,
    required this.onSendVoice,
    required this.onSendPhoto,
    this.onAttachFormula,
    required this.isStreaming,
  });

  @override
  ConsumerState<_InputBar> createState() => _InputBarState();
}

class _InputBarState extends ConsumerState<_InputBar> {
  final _textController = TextEditingController();
  final _focusNode = FocusNode();
  bool _hasText = false;
  String? _pendingPhoto; // 已选但未发送的图片预览
  bool _isRecording = false;

  @override
  void initState() {
    super.initState();
    _textController.addListener(() {
      final hasText = _textController.text.trim().isNotEmpty;
      if (hasText != _hasText) {
        setState(() => _hasText = hasText);
      }
    });
    widget.controller._bind(this);
  }

  @override
  void dispose() {
    _textController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final stage = ref.watch(currentStageProvider);

    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(
          top: BorderSide(color: theme.colorScheme.outlineVariant, width: 0.5),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // 已选图片预览条
          if (_pendingPhoto != null) _buildPhotoPreviewBar(),

          // 安全提示（首次使用时）
          // _buildSafetyHint(),

          // 主输入行
          Padding(
            padding: EdgeInsets.symmetric(
              horizontal: widget.ageTheme.spacing,
              vertical: 8,
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                // 语音按钮
                _VoiceInputButton(
                  isRecording: _isRecording,
                  onStart: _onVoiceStart,
                  onCancel: _onVoiceCancel,
                  onEnd: _onVoiceEnd,
                ),
                const SizedBox(width: 6),

                // 文本输入框
                Expanded(
                  child: _buildTextField(theme),
                ),
                const SizedBox(width: 6),

                // 拍照按钮（未输入文字时显示）或 发送按钮
                if (!_hasText && _pendingPhoto == null) ...[
                  _PhotoInputButton(
                    onPhotoTaken: _onPhotoSelected,
                    ageTheme: widget.ageTheme,
                  ),
                  // 公式输入按钮（初中及以上）
                  if (stage.uiLevel.index >= UILevel.teen.index &&
                      widget.onAttachFormula != null)
                    Padding(
                      padding: const EdgeInsets.only(left: 6),
                      child: _FormulaInputButton(
                        onTap: widget.onAttachFormula!,
                        ageTheme: widget.ageTheme,
                      ),
                    ),
                ],

                // 发送按钮（有文字或有待发送图片时显示）
                if (_hasText || _pendingPhoto != null)
                  _SendButton(
                    onPressed: widget.isStreaming ? null : _onSend,
                    ageTheme: widget.ageTheme,
                  ),
              ],
            ),
          ),

          // 底部安全区
          SizedBox(height: MediaQuery.of(context).padding.bottom),
        ],
      ),
    );
  }

  Widget _buildTextField(ThemeData theme) {
    return Container(
      constraints: const BoxConstraints(maxHeight: 120),
      child: TextField(
        controller: _textController,
        focusNode: _focusNode,
        maxLines: null, // 自适应多行
        keyboardType: TextInputType.multiline,
        textInputAction: TextInputAction.newline,
        enabled: !widget.isStreaming,
        style: TextStyle(fontSize: widget.ageTheme.bodyFontSize),
        decoration: InputDecoration(
          hintText: widget.isStreaming ? 'AI 正在思考...' : '输入你的问题...',
          hintStyle: TextStyle(
            color: theme.colorScheme.onSurfaceVariant.withOpacity(0.5),
          ),
          filled: true,
          fillColor: theme.colorScheme.surfaceVariant.withOpacity(0.3),
          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(20),
            borderSide: BorderSide.none,
          ),
        ),
      ),
    );
  }

  Widget _buildPhotoPreviewBar() {
    return Container(
      height: 72,
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: Row(
        children: [
          Stack(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.file(
                  File(_pendingPhoto!),
                  width: 56,
                  height: 56,
                  fit: BoxFit.cover,
                ),
              ),
              Positioned(
                top: -4,
                right: -4,
                child: GestureDetector(
                  onTap: () => setState(() => _pendingPhoto = null),
                  child: Container(
                    padding: const EdgeInsets.all(2),
                    decoration: const BoxDecoration(
                      color: Colors.black54,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.close, size: 14, color: Colors.white),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(width: 8),
          Expanded(
            child: TextField(
              controller: _textController,
              decoration: const InputDecoration(
                hintText: '添加描述（可选）...',
                border: InputBorder.none,
                isDense: true,
              ),
              style: const TextStyle(fontSize: 14),
            ),
          ),
        ],
      ),
    );
  }

  void _onSend() {
    final text = _textController.text.trim();
    if (_pendingPhoto != null) {
      widget.onSendPhoto(_pendingPhoto!);
      if (text.isNotEmpty) {
        widget.onSendText(text);
      }
      setState(() => _pendingPhoto = null);
    } else if (text.isNotEmpty) {
      widget.onSendText(text);
    }
    _textController.clear();
    _focusNode.unfocus();
  }

  void _onPhotoSelected(String path) {
    setState(() => _pendingPhoto = path);
    _focusNode.requestFocus();
  }

  Future<void> _onVoiceStart() async {
    setState(() => _isRecording = true);
    await ref.read(voiceRecorderProvider.notifier).start();
  }

  void _onVoiceCancel() {
    setState(() => _isRecording = false);
    ref.read(voiceRecorderProvider.notifier).cancel();
  }

  Future<void> _onVoiceEnd() async {
    setState(() => _isRecording = false);
    final result = await ref.read(voiceRecorderProvider.notifier).stop();
    if (result != null) {
      widget.onSendVoice(result.path, result.durationMs);
    }
  }
}
```

### 8.2 InputBarController

```dart
/// 输入栏控制器 — 允许外部控制输入栏状态
class InputBarController {
  _InputBarState? _state;

  void _bind(_InputBarState state) => _state = state;

  /// 填入文本并聚焦
  void setText(String text) {
    _state?._textController.text = text;
    _state?._focusNode.requestFocus();
  }

  /// 设置待发送图片
  void setPendingPhoto(String path) {
    _state?.setState(() => _state?._pendingPhoto = path);
  }

  /// 触发发送
  void send() => _state?._onSend();

  /// 清空输入
  void clear() {
    _state?._textController.clear();
    _state?.setState(() => _state?._pendingPhoto = null);
  }

  void dispose() => _state = null;
}
```

### 8.3 语音输入按钮

```dart
class _VoiceInputButton extends StatefulWidget {
  final bool isRecording;
  final VoidCallback onStart;
  final VoidCallback onCancel;
  final void Function(String path, int durationMs) onEnd;

  const _VoiceInputButton({
    required this.isRecording,
    required this.onStart,
    required this.onCancel,
    required this.onEnd,
  });

  @override
  State<_VoiceInputButton> createState() => _VoiceInputButtonState();
}

class _VoiceInputButtonState extends State<_VoiceInputButton> {
  Offset _startPosition = Offset.zero;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onLongPressStart: (details) {
        _startPosition = details.globalPosition;
        widget.onStart();
        HapticFeedback.mediumImpact();
      },
      onLongPressMoveUpdate: (details) {
        // 上滑取消
        final dy = _startPosition.dy - details.globalPosition.dy;
        if (dy > 60) {
          widget.onCancel();
        }
      },
      onLongPressEnd: (_) {
        if (widget.isRecording) {
          // 正常结束（不是取消）
          // onEnd 由 _InputBarState._onVoiceEnd 处理
        }
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: widget.isRecording
              ? Theme.of(context).colorScheme.error.withOpacity(0.1)
              : Colors.transparent,
          shape: BoxShape.circle,
        ),
        child: Icon(
          widget.isRecording ? Icons.mic : Icons.mic_none_outlined,
          size: 24,
          color: widget.isRecording
              ? Theme.of(context).colorScheme.error
              : Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      ),
    );
  }
}
```

### 8.4 拍照与图片选择按钮

```dart
class _PhotoInputButton extends StatelessWidget {
  final void Function(String path) onPhotoTaken;
  final AgeTheme ageTheme;

  const _PhotoInputButton({
    required this.onPhotoTaken,
    required this.ageTheme,
  });

  @override
  Widget build(BuildContext context) {
    return IconButton(
      icon: Icon(Icons.camera_alt_outlined, size: 24),
      onPressed: () => _showPhotoOptions(context),
      tooltip: '拍照搜题',
    );
  }

  void _showPhotoOptions(BuildContext context) {
    showModalBottomSheet(
      context: context,
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.camera_alt),
              title: const Text('拍照'),
              onTap: () async {
                Navigator.pop(context);
                final path = await _takePhoto();
                if (path != null) onPhotoTaken(path);
              },
            ),
            ListTile(
              leading: const Icon(Icons.photo_library),
              title: const Text('从相册选择'),
              onTap: () async {
                Navigator.pop(context);
                final path = await _pickFromGallery();
                if (path != null) onPhotoTaken(path);
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<String?> _takePhoto() async {
    final picker = ImagePicker();
    final xFile = await picker.pickImage(
      source: ImageSource.camera,
      maxWidth: 1920,
      maxHeight: 1920,
      imageQuality: 85,
    );
    return xFile?.path;
  }

  Future<String?> _pickFromGallery() async {
    final picker = ImagePicker();
    final xFile = await picker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 1920,
      maxHeight: 1920,
      imageQuality: 85,
    );
    return xFile?.path;
  }
}
```

### 8.5 发送按钮

```dart
class _SendButton extends StatelessWidget {
  final VoidCallback? onPressed;
  final AgeTheme ageTheme;

  const _SendButton({
    required this.onPressed,
    required this.ageTheme,
  });

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      child: IconButton.filled(
        icon: Icon(Icons.send, size: 20),
        onPressed: onPressed,
        style: IconButton.styleFrom(
          backgroundColor: onPressed != null
              ? Theme.of(context).colorScheme.primary
              : Theme.of(context).colorScheme.surfaceVariant,
          foregroundColor: onPressed != null
              ? Theme.of(context).colorScheme.onPrimary
              : Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      ),
    );
  }
}
```

---

## 9. 建议追问芯片

### 9.1 SuggestionChips

```dart
class _SuggestionChips extends StatelessWidget {
  final List<SuggestionItem> suggestions;
  final void Function(String text) onTap;

  const _SuggestionChips({
    required this.suggestions,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '你可以继续问：',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: suggestions.map((item) => ActionChip(
              label: Text(item.text),
              avatar: item.icon != null ? Icon(_iconForType(item.type), size: 14) : null,
              onPressed: () => onTap(item.text),
              side: BorderSide(
                color: Theme.of(context).colorScheme.outline.withOpacity(0.3),
              ),
            )).toList(),
          ),
        ],
      ),
    );
  }

  IconData _iconForType(String type) => switch (type) {
    'follow_up' => Icons.chat_bubble_outline,
    'similar' => Icons.content_copy,
    'deeper' => Icons.psychology_outlined,
    'practice' => Icons.edit_note,
    _ => Icons.arrow_forward,
  };
}
```

---

## 10. 空对话引导页

### 10.1 _EmptyStateView

新对话或无历史消息时，展示引导内容帮助用户快速开始。

```dart
class _EmptyStateView extends ConsumerWidget {
  final String? scene;

  const _EmptyStateView({this.scene});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ageTheme = ref.watch(ageThemeProvider);
    final stage = ref.watch(currentStageProvider);

    return SingleChildScrollView(
      padding: EdgeInsets.all(ageTheme.spacing),
      child: Column(
        children: [
          SizedBox(height: MediaQuery.of(context).size.height * 0.08),

          // AI 助手头像
          _buildAvatar(context, ageTheme),
          SizedBox(height: ageTheme.spacing),

          // 问候语
          Text(
            _greeting(stage),
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            _subGreeting(stage),
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            textAlign: TextAlign.center,
          ),
          SizedBox(height: ageTheme.spacing * 2),

          // 场景快捷入口
          if (scene != null)
            _buildSceneQuickStart(context, scene!, ageTheme)
          else
            _buildDefaultQuickStart(context, stage, ageTheme),
        ],
      ),
    );
  }

  Widget _buildAvatar(BuildContext context, AgeTheme ageTheme) {
    return Container(
      width: 72,
      height: 72,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            Theme.of(context).colorScheme.primary,
            Theme.of(context).colorScheme.tertiary,
          ],
        ),
        shape: BoxShape.circle,
      ),
      child: const Icon(Icons.smart_toy, color: Colors.white, size: 36),
    );
  }

  String _greeting(Stage stage) => switch (stage.uiLevel) {
    UILevel.toddler => '你好呀，小朋友！👋',
    UILevel.child => '你好！我是你的学习助手 🤖',
    UILevel.teen => '有什么学习问题？尽管问我',
    UILevel.youngAdult => '随时提问，我来帮你分析',
  };

  String _subGreeting(Stage stage) => switch (stage.uiLevel) {
    UILevel.toddler => '和我一起学拼音、认汉字吧！',
    UILevel.child => '拍照、打字、说话都可以哦',
    UILevel.teen => '拍照搜题、解题辅导、知识点讲解',
    UILevel.youngAdult => '解题推导、考点梳理、作文批改',
  };

  Widget _buildDefaultQuickStart(BuildContext context, Stage stage, AgeTheme ageTheme) {
    final items = _quickStartItems(stage);
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      alignment: WrapAlignment.center,
      children: items.map((item) => ActionChip(
        avatar: Icon(item.icon, size: 18),
        label: Text(item.label),
        onPressed: () {
          // 注入到输入栏并发送
          ref.read(conversationChatProvider.notifier).sendMessage(item.prompt);
        },
      )).toList(),
    );
  }

  List<({IconData icon, String label, String prompt})> _quickStartItems(Stage stage) {
    return switch (stage) {
      Stage(kindergarten: _) => [
        (icon: Icons.record_voice_over, label: '学拼音', prompt: '我想学拼音'),
        (icon: Icons.text_fields, label: '认汉字', prompt: '教我认几个汉字'),
        (icon: Icons.queue_music, label: '读古诗', prompt: '教我读一首古诗'),
      ],
      Stage(primaryLow: _) || Stage(primaryHigh: _) => [
        (icon: Icons.calculate, label: '数学题不会', prompt: '帮我看看这道数学题'),
        (icon: Icons.menu_book, label: '语文辅导', prompt: '帮我讲讲这篇课文'),
        (icon: Icons.camera_alt, label: '拍照搜题', prompt: '[OPEN_CAMERA]'),
        (icon: Icons.edit, label: '作文辅导', prompt: '我想写一篇作文'),
      ],
      _ => [
        (icon: Icons.camera_alt, label: '拍照搜题', prompt: '[OPEN_CAMERA]'),
        (icon: Icons.functions, label: '理科解题', prompt: '帮我解一道理科题'),
        (icon: Icons.auto_stories, label: '作文批改', prompt: '帮我批改作文'),
        (icon: Icons.psychology, label: '考点梳理', prompt: '帮我梳理一下重点考点'),
        (icon: Icons.record_voice_over, label: '背诵检查', prompt: '我想练习背诵'),
      ],
    };
  }

  Widget _buildSceneQuickStart(BuildContext context, String scene, AgeTheme ageTheme) {
    // 根据特定场景（如作业、考前冲刺等）显示不同的快捷入口
    return const SizedBox.shrink(); // 由具体场景文档定义
  }
}
```

---

## 11. AppBar 与更多操作

### 11.1 AppBar 实现

```dart
PreferredSizeWidget _buildAppBar(ChatState? chatState) {
  return AppBar(
    title: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          chatState?.conversation.title ?? 'AI 辅导',
          style: const TextStyle(fontSize: 16),
        ),
        if (chatState?.conversation.sceneLabel != null)
          Text(
            chatState!.conversation.sceneLabel!,
            style: TextStyle(
              fontSize: 11,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
      ],
    ),
    actions: [
      // 新建对话
      IconButton(
        icon: const Icon(Icons.add_comment_outlined),
        tooltip: '新建对话',
        onPressed: () => context.push(AppRoutes.aiNewChat),
      ),
      // 更多操作
      PopupMenuButton<String>(
        onSelected: _onMenuAction,
        itemBuilder: (_) => [
          const PopupMenuItem(value: 'history', child: Text('历史对话')),
          const PopupMenuItem(value: 'export', child: Text('导出对话')),
          const PopupMenuItem(value: 'clear', child: Text('清空当前对话')),
          const PopupMenuItem(value: 'report', child: Text('举报问题')),
        ],
      ),
    ],
  );
}

void _onMenuAction(String action) {
  switch (action) {
    case 'history':
      context.push(AppRoutes.aiConversationList);
    case 'export':
      _exportConversation();
    case 'clear':
      _confirmClearConversation();
    case 'report':
      showDialog(
        context: context,
        builder: (_) => ReportDialog(
          targetType: 'conversation',
          targetId: widget.conversationId?.toString() ?? '',
        ),
      );
  }
}
```

---

## 12. 事件处理与状态流转

### 12.1 核心事件处理方法

```dart
// _ConversationPageState 中的事件处理方法

/// 发送文字消息
void _onSendText(String text) {
  if (text.trim().isEmpty) return;
  ref.read(conversationChatProvider.notifier).sendMessage(text);
}

/// 发送语音消息
void _onSendVoice(String audioPath, int durationMs) async {
  // 1. 显示本地语音消息
  // 2. 上传音频文件
  // 3. 发送语音消息到 AI
  final uploadedUrl = await ref.read(fileUploadProvider.notifier).uploadAudio(audioPath);
  if (uploadedUrl != null) {
    ref.read(conversationChatProvider.notifier).sendMessage(
      '[语音消息]',
      contentType: 'audio',
      audioUrl: uploadedUrl,
    );
  }
}

/// 发送图片消息
void _onSendPhoto(String imagePath) async {
  // 1. 上传图片
  // 2. 发送图片消息到 AI（触发 OCR + 解题）
  final uploadedUrl = await ref.read(fileUploadProvider.notifier).uploadImage(imagePath);
  if (uploadedUrl != null) {
    ref.read(conversationChatProvider.notifier).sendMessage(
      '请帮我解答图片中的题目',
      contentType: 'image',
      images: [uploadedUrl],
    );
  }
}

/// 附加公式输入
void _onAttachFormula() {
  // 打开公式输入键盘/对话框
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    builder: (_) => FormulaInputDialog(
      onInsert: (latex) {
        _inputBarController.setText('$$latex\$');
      },
    ),
  );
}

/// 快捷操作回调
void _onQuickAction(String action, int turnId) {
  switch (action) {
    case 'rephrase':
      ref.read(conversationChatProvider.notifier).sendMessage(
        '请用不同的方式再讲解一遍',
        replyToTurnId: turnId,
      );
    case 'simpler':
      ref.read(conversationChatProvider.notifier).sendMessage(
        '请讲得更简单一些，我有点没听懂',
        replyToTurnId: turnId,
      );
    case 'similar':
      ref.read(conversationChatProvider.notifier).sendMessage(
        '给我出一道类似的题目练练手',
        replyToTurnId: turnId,
      );
    case 'add_mistake':
      ref.read(mistakeBookProvider.notifier).addFromTurn(turnId);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('已加入错题本'),
          duration: Duration(seconds: 1),
        ),
      );
    case 'expand_steps':
      ref.read(conversationChatProvider.notifier).sendMessage(
        '请展开详细的解题步骤',
        replyToTurnId: turnId,
      );
    case 'polish':
      ref.read(conversationChatProvider.notifier).sendMessage(
        '请给我一些润色建议',
        replyToTurnId: turnId,
      );
  }
}

/// 反馈回调
void _onFeedback(int turnId, bool positive) {
  ref.read(conversationChatProvider.notifier).submitFeedback(
    turnId: turnId,
    positive: positive,
  );
}

/// 重试失败消息
void _onRetryMessage(int turnId) {
  ref.read(conversationChatProvider.notifier).retryTurn(turnId);
}

/// 导出对话
Future<void> _exportConversation() async {
  final chatState = ref.read(conversationChatProvider).valueOrNull;
  if (chatState == null) return;

  final exportText = StringBuffer();
  for (final turn in chatState.messages) {
    if (turn.userContent != null) {
      exportText.writeln('【学生】${turn.userContent}');
    }
    if (turn.assistantContent != null) {
      exportText.writeln('【AI】${turn.assistantContent}');
    }
    exportText.writeln();
  }

  await ShareService.shareText(
    title: '对话记录',
    text: exportText.toString(),
  );
}

/// 确认清空对话
void _confirmClearConversation() {
  showDialog(
    context: context,
    builder: (_) => AlertDialog(
      title: const Text('清空对话'),
      content: const Text('确定要清空当前对话的所有消息吗？此操作不可撤销。'),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed: () {
            Navigator.pop(context);
            ref.read(conversationChatProvider.notifier).clearConversation();
          },
          child: const Text('确定'),
        ),
      ],
    ),
  );
}
```

### 12.2 状态流转图

```
┌─────────────────────────────────────────────────┐
│                ConversationPage                  │
│                                                  │
│  ChatState:                                      │
│  ┌──────────┐    sendMessage    ┌───────────┐   │
│  │  idle     │ ──────────────▶ │ streaming │   │
│  └──────────┘                   └─────┬─────┘   │
│       ▲                               │         │
│       │                    ┌──────────┤         │
│       │                    │          │         │
│       │               ┌────▼───┐  ┌───▼────┐   │
│       │               │  done  │  │ error  │   │
│       │               └────┬───┘  └───┬────┘   │
│       │                    │          │         │
│       └────────────────────┘    retry │         │
│                                  ┌────▼───┐    │
│                                  │ retry  │    │
│                                  └────┬───┘    │
│                                       │         │
│                       re-send ────────┘         │
└─────────────────────────────────────────────────┘

消息级状态：
  pending → sending → sent → [AI回复] → streaming → completed
                                        ↘ error → retry → sending
```

---

## 13. 网络状态横幅

### 13.1 _ConnectivityBanner

```dart
class _ConnectivityBanner extends ConsumerWidget {
  const _ConnectivityBanner();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connectivity = ref.watch(connectivityStateProvider);

    if (connectivity == ConnectivityStatus.online) {
      return const SizedBox.shrink();
    }

    return MaterialBanner(
      content: Text(
        connectivity == ConnectivityStatus.offline
            ? '网络已断开，消息将在恢复后自动发送'
            : '网络连接不稳定',
        style: TextStyle(
          color: Theme.of(context).colorScheme.onErrorContainer,
          fontSize: 13,
        ),
      ),
      backgroundColor: Theme.of(context).colorScheme.errorContainer,
      actions: [
        if (connectivity == ConnectivityStatus.offline)
          TextButton(
            onPressed: () {
              // 手动触发离线队列刷新
              ref.read(offlineQueueProvider.notifier).flush();
            },
            child: Text(
              '重试',
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
      ],
    );
  }
}
```

---

## 14. 骨架屏与加载占位

### 14.1 ShimmerPlaceholder

```dart
class _ShimmerPlaceholder extends StatelessWidget {
  const _ShimmerPlaceholder();

  @override
  Widget build(BuildContext context) {
    return Shimmer.fromColors(
      baseColor: Colors.grey[300]!,
      highlightColor: Colors.grey[100]!,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(width: double.infinity, height: 14, decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(4))),
          const SizedBox(height: 8),
          Container(width: MediaQuery.of(context).size.width * 0.6, height: 14, decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(4))),
          const SizedBox(height: 8),
          Container(width: double.infinity, height: 14, decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(4))),
          const SizedBox(height: 8),
          Container(width: MediaQuery.of(context).size.width * 0.4, height: 14, decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(4))),
        ],
      ),
    );
  }
}
```

---

## 15. 性能优化

### 15.1 消息列表虚拟化策略

```dart
/// 对话页性能关键点：
/// 1. 长对话（100+ 条消息）需要虚拟化，避免一次性渲染所有消息
/// 2. 已滚过的消息应被回收，但保持状态（如展开/折叠）
/// 3. 图片使用 CachedNetworkImage 避免重复加载
/// 4. Markdown 渲染是性能瓶颈，需要缓存

// 方案一：cacheExtent + AutomaticKeepAlive
class _MessageList extends ConsumerStatefulWidget {
  // ... 已在上文实现
  // 通过 cacheExtent: 500 保持上下文窗口
  // 通过 AutomaticKeepAliveClientMixin 保持关键消息状态
}

// 方案二：Markdown 渲染缓存
class MarkdownCache {
  static final _cache = LruCache<String, Widget>(maxSize: 50);

  /// 对相同内容的 Markdown 渲染结果做缓存
  static Widget build(
    String content, {
    required MarkdownStyleSheet styleSheet,
    required Map<String, MarkdownElementBuilder> builders,
  }) {
    final key = content.hashCode ^ styleSheet.hashCode;
    return _cache.getOrPut(key, () => _buildWidget(content, styleSheet, builders));
  }

  static Widget _buildWidget(String content, MarkdownStyleSheet styleSheet, Map<String, MarkdownElementBuilder> builders) {
    // 实际 Markdown 解析和 Widget 构建
    return MarkdownBody(data: content, styleSheet: styleSheet, builders: builders);
  }
}
```

### 15.2 流式渲染节流

```dart
/// SSE delta 节流 — 避免每个 token 都触发 Widget 重建
///
/// 在 ConversationChat Provider 层实现节流
@riverpod
class ConversationChat extends _$ConversationChat {
  Timer? _throttleTimer;
  String _pendingDelta = '';

  // ... build() 等方法见 AI对话引擎与会话管理 文档

  void _onSseDelta(String delta) {
    _pendingDelta += delta;

    // 50ms 节流
    _throttleTimer ??= Timer(const Duration(milliseconds: 50), () {
      final lastIdx = state.value!.messages.length - 1;
      final updated = state.value!.messages[lastIdx].copyWith(
        assistantContent: state.value!.messages[lastIdx].assistantContent + _pendingDelta,
      );
      state = state.value!.copyWith(
        messages: [...state.value!.messages.sublist(0, lastIdx), updated],
      );
      _pendingDelta = '';
      _throttleTimer = null;
    });
  }
}
```

### 15.3 图片懒加载与内存控制

```dart
/// 图片内存优化策略
class ChatImageConfig {
  /// 列表中图片最大显示高度
  static const double maxInListHeight = 200.0;

  /// 缩略图质量
  static const int thumbnailQuality = 60;

  /// 图片缓存上限
  static const int maxCacheSize = 50; // 张
  static const int maxCacheBytes = 50 * 1024 * 1024; // 50MB
}
```

---

## 16. 离线消息处理

### 16.1 离线消息队列（对话场景）

```dart
/// 对话页离线场景处理
extension ConversationOfflineExtension on ConversationChat {
  /// 处理离线发送
  Future<void> sendOfflineMessage(String content, {
    String contentType = 'text',
    List<String>? images,
  }) async {
    // 1. 本地立即展示消息（乐观更新）
    final tempTurn = Turn(
      id: -DateTime.now().millisecondsSinceEpoch,
      userContent: content,
      userContentType: contentType,
      userImages: images,
      createdAt: DateTime.now(),
      status: 'pending', // 待发送状态
    );

    // 2. 写入离线队列
    await ref.read(offlineQueueProvider.notifier).enqueue(PendingAction(
      id: const Uuid().v4(),
      type: 'ai.message',
      params: {
        'conversationId': conversationId,
        'content': content,
        'contentType': contentType,
        if (images != null) 'images': images,
      },
      createdAt: DateTime.now(),
    ));

    // 3. 消息气泡显示"发送中"状态
    state = state.value!.copyWith(
      messages: [...state.value!.messages, tempTurn],
    );
  }
}
```

### 16.2 消息状态指示器

```dart
/// 消息气泡上显示发送状态
enum MessageStatus {
  pending,   // 排队中
  sending,   // 发送中
  sent,      // 已发送
  failed,    // 发送失败
  delivered, // 已送达
}

class _MessageStatusIndicator extends StatelessWidget {
  final MessageStatus status;

  const _MessageStatusIndicator({required this.status});

  @override
  Widget build(BuildContext context) {
    return switch (status) {
      MessageStatus.pending => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(width: 12, height: 12,
            child: CircularProgressIndicator(strokeWidth: 1.5,
              color: Theme.of(context).colorScheme.onSurfaceVariant)),
          const SizedBox(width: 4),
          Text('排队中', style: Theme.of(context).textTheme.labelSmall),
        ],
      ),
      MessageStatus.sending => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(width: 12, height: 12,
            child: CircularProgressIndicator(strokeWidth: 1.5,
              color: Theme.of(context).colorScheme.onSurfaceVariant)),
          const SizedBox(width: 4),
          Text('发送中', style: Theme.of(context).textTheme.labelSmall),
        ],
      ),
      MessageStatus.sent => Icon(Icons.check, size: 14,
          color: Theme.of(context).colorScheme.onSurfaceVariant),
      MessageStatus.failed => GestureDetector(
        onTap: () {}, // 触发重试
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 14, color: Theme.of(context).colorScheme.error),
            const SizedBox(width: 4),
            Text('发送失败，点击重试',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: Theme.of(context).colorScheme.error,
              )),
          ],
        ),
      ),
      MessageStatus.delivered => Icon(Icons.done_all, size: 14,
          color: Theme.of(context).colorScheme.primary),
    };
  }
}
```

---

## 17. 分龄 UI 适配策略

### 17.1 对话页分龄差异

| 维度 | 幼儿 | 小学 | 初中 | 高中 |
|------|------|------|------|------|
| **气泡圆角** | 24px | 20px | 16px | 12px |
| **字号** | 18px | 16px | 15px | 14px |
| **快捷操作** | 仅"再讲一遍" | "换个讲法"、"再简单点" | 全部快捷操作 | 全部 + "展开步骤" |
| **建议芯片** | 图标为主 | 图标+简短文字 | 文字为主 | 简洁文字 |
| **输入栏** | 语音为主，大按钮 | 语音+文字+拍照 | 文字+拍照+公式 | 文字+拍照+公式 |
| **空引导** | 大图标+卡通风格 | 卡片式入口 | 列表式入口 | 简洁列表 |
| **公式渲染** | 不显示原始LaTeX | 渲染公式+简要说明 | 完整公式渲染 | 公式+推导过程 |
| **步骤卡片** | 默认展开 | 默认展开 | >5步折叠 | >5步折叠 |
| **反馈按钮** | 仅表情反馈 | 👍👎 | 👍👎+复制+分享 | 全部操作 |
| **AI头像** | 可爱卡通 | 圆形图标 | 简约图标 | 无头像 |

### 17.2 分龄组件选择器

```dart
/// 根据 UILevel 选择不同的 Widget 实现
class AgeAdaptiveChatComponents {
  final UILevel level;

  AgeAdaptiveChatComponents(this.level);

  /// 输入栏高度
  double get inputBarHeight => switch (level) {
    UILevel.toddler => 64,
    UILevel.child => 56,
    UILevel.teen => 48,
    UILevel.youngAdult => 44,
  };

  /// 是否显示公式输入
  bool get showFormulaInput => level.index >= UILevel.teen.index;

  /// 步骤折叠阈值
  int get stepsFoldThreshold => switch (level) {
    UILevel.toddler => 999, // 永不折叠
    UILevel.child => 999,
    UILevel.teen => 5,
    UILevel.youngAdult => 5,
  };

  /// 快捷操作白名单
  List<String> get quickActionWhitelist => switch (level) {
    UILevel.toddler => ['rephrase'],
    UILevel.child => ['rephrase', 'simpler', 'similar'],
    UILevel.teen => ['rephrase', 'simpler', 'similar', 'add_mistake', 'expand_steps'],
    UILevel.youngAdult => ['rephrase', 'simpler', 'similar', 'add_mistake', 'expand_steps', 'polish'],
  };

  /// 消息气泡圆角
  double get bubbleRadius => switch (level) {
    UILevel.toddler => 24,
    UILevel.child => 20,
    UILevel.teen => 16,
    UILevel.youngAdult => 12,
  };
}
```

---

## 18. 可访问性

### 18.1 语义标注

```dart
// 为屏幕阅读器添加语义标注

Semantics(
  label: 'AI 回答，共 3 个步骤',
  child: AiResponseCard(turn: turn, ...),
);

Semantics(
  label: '你的消息：${turn.userContent}',
  child: UserMessageBubble(turn: turn),
);

Semantics(
  button: true,
  label: '发送消息',
  child: _SendButton(onPressed: _onSend, ageTheme: ageTheme),
);
```

### 18.2 键盘导航

```dart
// 焦点顺序：输入框 → 发送按钮 → 语音按钮 → 拍照按钮
FocusTraversalGroup(
  policy: OrderedTraversalPolicy(),
  child: Column(
    children: [
      FocusTraversalOrder(order: const NumericFocusOrder(1), child: _textInputField),
      FocusTraversalOrder(order: const NumericFocusOrder(2), child: _sendButton),
      FocusTraversalOrder(order: const NumericFocusOrder(3), child: _voiceButton),
      FocusTraversalOrder(order: const NumericFocusOrder(4), child: _photoButton),
    ],
  ),
);
```

---

## 19. 关键数据模型

### 19.1 Turn 扩展字段

```dart
@freezed
class Turn with _$Turn {
  const factory Turn({
    required int id,
    String? userContent,
    @Default('text') String userContentType,  // text | image | audio
    List<String>? userImages,
    String? userAudioUrl,
    String? assistantContent,
    @Default('pending') String assistantStatus, // pending | streaming | completed | error
    String? errorMessage,
    String? scene,                // 对话场景标识
    String? modelId,              // 使用的模型 ID
    bool? hasQuestionContext,     // 是否包含题目上下文
    bool? hasDetailedSteps,       // 是否包含详细步骤
    List<String>? knowledgePoints,// 涉及的知识点
    List<String>? tags,           // 消息标签
    required DateTime createdAt,
    MessageStatus status = MessageStatus.sent,
  }) = _Turn;
}
```

### 19.2 SuggestionItem

```dart
@freezed
class SuggestionItem with _$SuggestionItem {
  const factory SuggestionItem({
    required String text,    // 建议文本
    required String type,    // follow_up | similar | deeper | practice
    String? icon,            // 可选图标标识
    String? sceneHint,       // 场景提示
  }) = _SuggestionItem;

  factory SuggestionItem.fromJson(Map<String, dynamic> json) =>
      _$SuggestionItemFromJson(json);
}
```

---

## 20. 测试用例

### 20.1 Widget 测试矩阵

| 编号 | 场景 | 验证点 | 优先级 |
|------|------|--------|--------|
| TC-CHAT-01 | 空对话页展示 | 问候语、快捷入口正确显示 | P0 |
| TC-CHAT-02 | 发送文字消息 | 消息立即出现在列表，状态变为 streaming | P0 |
| TC-CHAT-03 | 接收流式回答 | 增量渲染、打字光标、完成后显示快捷操作 | P0 |
| TC-CHAT-04 | 发送图片消息 | 图片缩略图显示，上传进度，发送成功 | P0 |
| TC-CHAT-05 | 语音输入 | 长按录音、松开发送、上滑取消 | P1 |
| TC-CHAT-06 | 快捷操作 | 点击"换个讲法"触发新消息 | P0 |
| TC-CHAT-07 | 反馈操作 | 点赞/点踩状态切换、API 调用 | P1 |
| TC-CHAT-08 | 消息重试 | 错误状态显示、点击重试 | P0 |
| TC-CHAT-09 | 网络断开 | 离线横幅、消息排队 | P1 |
| TC-CHAT-10 | 网络恢复 | 队列自动发送、状态更新 | P1 |
| TC-CHAT-11 | 长对话滚动 | 100+ 条消息不卡顿、自动滚动到底 | P1 |
| TC-CHAT-12 | 日期分隔线 | 跨天消息正确分隔 | P2 |
| TC-CHAT-13 | 分龄适配 | 不同学段 UI 差异正确呈现 | P1 |
| TC-CHAT-14 | 公式渲染 | LaTeX 正确渲染、公式块布局 | P0 |
| TC-CHAT-15 | 步骤折叠 | >5 步自动折叠、点击展开 | P2 |
| TC-CHAT-16 | 复制内容 | 复制到剪贴板、提示反馈 | P2 |
| TC-CHAT-17 | 清空对话 | 确认弹窗、清空后回到空状态 | P2 |
| TC-CHAT-18 | 导出对话 | 分享面板弹出、内容格式正确 | P3 |
| TC-CHAT-19 | 建议追问 | 流式完成后显示、点击触发发送 | P1 |
| TC-CHAT-20 | 流式中禁用发送 | 发送按钮不可点击、输入框提示文案变化 | P1 |

### 20.2 关键 Widget 测试示例

```dart
// test/widget/features/ai_tutor/conversation_page_test.dart

void main() {
  group('ConversationPage', () {
    testWidgets('空对话页显示引导和快捷入口', (tester) async {
      final container = ProviderContainer(overrides: [
        conversationChatProvider.overrideWith(() => MockConversationChat(
          initialState: ChatState(
            conversation: Conversation(id: 1, title: '新对话'),
            messages: [],
            streamingState: StreamingState.idle,
          ),
        )),
        currentStageProvider.overrideWithValue(Stage.junior),
      ]);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(home: ConversationPage(conversationId: 1)),
        ),
      );

      // 验证问候语
      expect(find.text('有什么学习问题？尽管问我'), findsOneWidget);
      // 验证快捷入口
      expect(find.text('拍照搜题'), findsOneWidget);
      expect(find.text('理科解题'), findsOneWidget);
    });

    testWidgets('发送消息后列表更新', (tester) async {
      // ... 类似模式，验证 sendMessage 触发后 messages 列表变化
    });

    testWidgets('流式回答显示打字光标', (tester) async {
      // ... 验证 isStreaming=true 时 _TypingCursor 可见
    });
  });
}
```

---

## 21. 监控埋点

### 21.1 关键事件

| 事件名 | 触发时机 | 参数 |
|--------|----------|------|
| `chat_page_view` | 进入对话页 | conversation_id, scene, is_new |
| `chat_send_text` | 发送文字消息 | conversation_id, text_length |
| `chat_send_image` | 发送图片消息 | conversation_id, image_count |
| `chat_send_voice` | 发送语音消息 | conversation_id, duration_ms |
| `chat_stream_start` | 流式回答开始 | conversation_id, turn_id |
| `chat_stream_complete` | 流式回答完成 | conversation_id, turn_id, duration_ms, token_count |
| `chat_stream_error` | 流式回答失败 | conversation_id, turn_id, error_code |
| `chat_quick_action` | 点击快捷操作 | conversation_id, turn_id, action_id |
| `chat_feedback` | 反馈 | conversation_id, turn_id, positive |
| `chat_copy` | 复制内容 | conversation_id, turn_id |
| `chat_share` | 分享内容 | conversation_id, turn_id |
| `chat_scroll_to_bottom` | 点击滚动到底部 | conversation_id, scroll_distance |
| `chat_suggestion_tap` | 点击建议追问 | conversation_id, suggestion_type |

### 21.2 性能指标

| 指标 | 采集方式 | 告警阈值 |
|------|----------|---------|
| 对话页首帧渲染 | Tracing (initState → first paint) | > 500ms |
| 消息列表帧率 | Flutter Performance Overlay | < 55fps |
| 单条消息渲染耗时 | Stopwatch 包裹 MarkdownBody.build | > 100ms |
| 图片加载耗时 | CachedNetworkImage 回调 | > 3s |
| 流式渲染延迟 | SSE delta 到 setState 到 paint | > 200ms |
| 长对话内存占用 | Dart DevTools | > 150MB (500 条) |
