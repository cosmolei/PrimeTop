# 客户端 Flutter 渲染性能优化与低端设备适配 - 详细设计

## 1. 概述

### 1.1 文档目的

本文档为开发人员提供 Flutter 渲染性能优化的具体编码指南，以及低端设备适配策略的完整设计方案。不同于「客户端性能监控与用户体验度量系统」侧重于度量采集，本文档聚焦于**如何写出高性能 Flutter 代码**，以及**如何在低端设备上保障可用性**。

### 1.2 背景与问题

PrimeTop 面向全学段学生用户，学生群体使用的设备性能差异极大：

| 设备层级 | 代表机型 | 内存 | SoC | 占比估算 |
|---------|---------|------|-----|---------|
| 旗舰 | iPhone 15 Pro、骁龙 8 Gen3 | ≥8GB | 旗舰 SoC | 15% |
| 中端 | 骁龙 778G、天玑 8100 | 6-8GB | 中端 SoC | 40% |
| 低端 | 骁龙 480、联发科 G系列 | 4GB | 入门 SoC | 35% |
| 极低端 | Android Go、2GB 机型 | ≤3GB | 低端 SoC | 10% |

关键性能痛点：
1. **首屏渲染慢**：低端设备冷启动 > 5s，首页 > 3s
2. **列表卡顿**：错题列表、题目列表滚动掉帧（< 30fps）
3. **内存溢出**：大量图片/公式的页面 OOM
4. **AI 对话流式渲染**：SSE 流式文本 + LaTeX 公式导致渲染阻塞
5. **动画卡顿**：分龄 UI 动画在低端设备上掉帧
6. **Shader 编译卡顿**：首次使用复杂组件时 jank（如 Canvas 绘制）

### 1.3 设计目标

| 指标 | 目标值 | 度量方式 |
|------|--------|---------|
| 冷启动时间 | 旗舰 < 2s，中端 < 3s，低端 < 5s | `flutter drive` timeline |
| 首屏渲染 | 旗舰 < 1s，中端 < 1.5s，低端 < 2.5s | FCP (First Contentful Paint) |
| 滚动帧率 | 旗舰 ≥ 58fps，中端 ≥ 50fps，低端 ≥ 30fps | Flutter DevTools FPS |
| 内存峰值 | 旗舰 ≤ 300MB，中端 ≤ 250MB，低端 ≤ 180MB | DevTools Memory |
| 无 jank 帧 | 旗舰 99%，中端 95%，低端 85% | jank frame ratio |
| AI 对话首字渲染 | < 16ms (单帧) | custom trace |

### 1.4 与其他文档的关系

| 关联文档 | 关系 |
|---------|------|
| 客户端架构与前端框架 | 本文档是架构文档的性能专项深化 |
| 客户端性能监控与用户体验度量系统 | 度量系统负责采集，本文档定义优化策略 |
| 客户端组件库与设计系统 | 组件设计需遵循本文档的性能规范 |
| 分龄UI适配与交互设计规范 | 动画性能需遵循本文档的动画规范 |
| 富文本与学科内容渲染引擎 | LaTeX/公式渲染优化策略 |
| 客户端应用启动流程与初始化管线 | 启动优化策略 |
| 客户端图片处理与缓存 | 图片加载优化策略 |

---

## 2. 设备分级与特性降级体系

### 2.1 设备分级模型

```dart
/// 设备性能等级
enum DeviceTier {
  /// 旗舰设备：≥8GB RAM, 旗舰SoC
  flagship,
  /// 中端设备：6-8GB RAM, 中端SoC
  midRange,
  /// 低端设备：4-6GB RAM, 入门SoC
  lowEnd,
  /// 极低端：≤3GB RAM, Android Go等
  ultraLowEnd,
}

/// 设备能力特性
class DeviceCapabilities {
  final DeviceTier tier;
  final int totalMemoryMB;
  final int cpuCoreCount;
  final double cpuMaxFreqGHz;
  final double gpuBenchmark; // 自定义GPU基准分
  final double screenRefreshRate;
  final bool supportsNeon;
  final bool supportsVulkan;

  const DeviceCapabilities({
    required this.tier,
    required this.totalMemoryMB,
    required this.cpuCoreCount,
    required this.cpuMaxFreqGHz,
    required this.gpuBenchmark,
    required this.screenRefreshRate,
    this.supportsNeon = true,
    this.supportsVulkan = true,
  });

  /// 从设备信息推断性能等级
  factory DeviceCapabilities.detect() {
    final plugin = DeviceInfoPlugin();
    // 同步实现见下文 DeviceProfiler
    throw UnimplementedError('Use DeviceProfiler.detect()');
  }
}
```

### 2.2 设备性能探测器

```dart
/// 设备性能探测与分级
///
/// 启动时执行一次，结果缓存至 SharedPreferences
class DeviceProfiler {
  static const _cacheKey = 'device_tier_v2';
  static DeviceCapabilities? _cached;

  /// 获取设备能力（优先缓存）
  static Future<DeviceCapabilities> getCapabilities() async {
    if (_cached != null) return _cached!;

    final prefs = await SharedPreferences.getInstance();
    final cachedJson = prefs.getString(_cacheKey);
    if (cachedJson != null) {
      _cached = _fromJson(cachedJson);
      return _cached!;
    }

    _cached = await detect();
    await prefs.setString(_cacheKey, _toJson(_cached!));
    return _cached!;
  }

  /// 执行设备探测（耗时约500ms，仅在首次启动执行）
  static Future<DeviceCapabilities> detect() async {
    final deviceInfo = DeviceInfoPlugin();

    // 并行采集设备信息
    final results = await Future.wait([
      _getMemoryInfo(),
      _getCpuInfo(),
      _getGpuBenchmark(),
      _getScreenInfo(),
    ]);

    final memMB = results[0] as int;
    final cpuInfo = results[1] as ({int cores, double maxFreq});
    final gpuScore = results[2] as double;
    final refreshRate = results[3] as double;

    // 综合评分分级
    final tier = _classifyTier(
      memoryMB: memMB,
      cpuCores: cpuInfo.cores,
      cpuFreq: cpuInfo.maxFreq,
      gpuScore: gpuScore,
    );

    return DeviceCapabilities(
      tier: tier,
      totalMemoryMB: memMB,
      cpuCoreCount: cpuInfo.cores,
      cpuMaxFreqGHz: cpuInfo.maxFreq,
      gpuBenchmark: gpuScore,
      screenRefreshRate: refreshRate,
    );
  }

  /// 综合评分分级算法
  static DeviceTier _classifyTier({
    required int memoryMB,
    required int cpuCores,
    required double cpuFreq,
    required double gpuScore,
  }) {
    // 加权评分：内存40% + CPU 30% + GPU 30%
    final memScore = _normalizeMem(memoryMB);
    final cpuScore = _normalizeCpu(cpuCores, cpuFreq);
    final total = memScore * 0.4 + cpuScore * 0.3 + gpuScore * 0.3;

    if (total >= 0.75) return DeviceTier.flagship;
    if (total >= 0.50) return DeviceTier.midRange;
    if (total >= 0.30) return DeviceTier.lowEnd;
    return DeviceTier.ultraLowEnd;
  }

  static double _normalizeMem(int mb) {
    if (mb >= 8192) return 1.0;
    if (mb >= 6144) return 0.75;
    if (mb >= 4096) return 0.50;
    if (mb >= 3072) return 0.30;
    return 0.15;
  }

  static double _normalizeCpu(int cores, double freqGHz) {
    final score = (cores / 8) * 0.5 + (freqGHz / 3.0) * 0.5;
    return score.clamp(0.0, 1.0);
  }

  /// GPU 微基准测试：渲染一个简单场景测量帧时间
  static Future<double> _getGpuBenchmark() async {
    // 使用 Flutter Scheduler 绑定测量
    final stopwatch = Stopwatch()..start();
    int frameCount = 0;
    const targetFrames = 30;

    final completer = Completer<double>();
    final binding = SchedulerBinding.instance;

    void frameCallback(Duration timestamp) {
      frameCount++;
      if (frameCount >= targetFrames) {
        stopwatch.stop();
        final avgFrameTimeMs = stopwatch.elapsedMilliseconds / targetFrames;
        // 归一化：16ms(60fps) = 1.0, 33ms(30fps) = 0.5
        final score = (16.0 / avgFrameTimeMs).clamp(0.0, 1.0);
        completer.complete(score);
      } else {
        binding.scheduleFrameCallback(frameCallback);
      }
    }

    binding.scheduleFrameCallback(frameCallback);
    return completer.future;
  }
}
```

### 2.3 特性降级矩阵

```dart
/// 功能特性配置 - 根据设备等级降级
class FeatureProfile {
  final DeviceTier tier;

  const FeatureProfile(this.tier);

  // === 动画相关 ===

  /// 是否启用页面转场动画
  bool get pageTransitions => tier.index >= DeviceTier.lowEnd.index;

  /// 是否启用 Hero 动画
  bool get heroAnimations => tier.index >= DeviceTier.midRange.index;

  /// 动画时长乘数（低端设备缩短动画）
  Duration animationDuration(Duration base) {
    switch (tier) {
      case DeviceTier.flagship:
        return base;
      case DeviceTier.midRange:
        return base;
      case DeviceTier.lowEnd:
        return Duration(milliseconds: (base.inMilliseconds * 0.7).round());
      case DeviceTier.ultraLowEnd:
        return Duration(milliseconds: (base.inMilliseconds * 0.4).round());
    }
  }

  /// 是否启用弹性动画（低端设备改用线性）
  bool get springAnimations => tier.index >= DeviceTier.midRange.index;

  // === 渲染相关 ===

  /// 图片缓存最大条目数
  int get maxImageCacheCount {
    switch (tier) {
      case DeviceTier.flagship: return 200;
      case DeviceTier.midRange: return 100;
      case DeviceTier.lowEnd: return 50;
      case DeviceTier.ultraLowEnd: return 25;
    }
  }

  /// 图片最大缓存尺寸（MB）
  int get maxImageCacheSizeMB {
    switch (tier) {
      case DeviceTier.flagship: return 256;
      case DeviceTier.midRange: return 128;
      case DeviceTier.lowEnd: return 64;
      case DeviceTier.ultraLowEnd: return 32;
    }
  }

  /// 图片目标质量（0.0-1.0）
  double get imageQuality {
    switch (tier) {
      case DeviceTier.flagship: return 1.0;
      case DeviceTier.midRange: return 0.85;
      case DeviceTier.lowEnd: return 0.7;
      case DeviceTier.ultraLowEnd: return 0.5;
    }
  }

  /// 是否启用图片缩略图优先加载
  bool get useThumbnailFirst => tier.index <= DeviceTier.lowEnd.index;

  /// 列表预加载区域倍数
  double get listCacheExtentMultiplier {
    switch (tier) {
      case DeviceTier.flagship: return 3.0;
      case DeviceTier.midRange: return 2.0;
      case DeviceTier.lowEnd: return 1.5;
      case DeviceTier.ultraLowEnd: return 1.0;
    }
  }

  // === LaTeX / 公式渲染 ===

  /// 公式渲染质量级别
  FormulaRenderQuality get formulaRenderQuality {
    switch (tier) {
      case DeviceTier.flagship:
      case DeviceTier.midRange:
        return FormulaRenderQuality.high;
      case DeviceTier.lowEnd:
        return FormulaRenderQuality.medium;
      case DeviceTier.ultraLowEnd:
        return FormulaRenderQuality.low;
    }
  }

  /// 是否启用公式预缓存
  bool get formulaPreCache => tier.index >= DeviceTier.midRange.index;

  /// AI 对话最大同时渲染公式数
  int get maxSimultaneousFormulas {
    switch (tier) {
      case DeviceTier.flagship: return 20;
      case DeviceTier.midRange: return 10;
      case DeviceTier.lowEnd: return 5;
      case DeviceTier.ultraLowEnd: return 3;
    }
  }

  // === AI 对话流式渲染 ===

  /// SSE 流式渲染批量大小（字符数）
  int get sseRenderBatchSize {
    switch (tier) {
      case DeviceTier.flagship: return 1;  // 逐字符
      case DeviceTier.midRange: return 3;
      case DeviceTier.lowEnd: return 5;
      case DeviceTier.ultraLowEnd: return 10;
    }
  }

  /// 流式渲染节流间隔
  Duration get sseRenderThrottle {
    switch (tier) {
      case DeviceTier.flagship: return Duration.zero;
      case DeviceTier.midRange: return const Duration(milliseconds: 16);
      case DeviceTier.lowEnd: return const Duration(milliseconds: 33);
      case DeviceTier.ultraLowEnd: return const Duration(milliseconds: 50);
    }
  }

  // === 通用 ===

  /// 是否启用骨架屏（低端设备建议启用减少白屏感）
  bool get enableSkeletonLoading => true;

  /// 是否启用阴影效果
  bool get enableShadows => tier.index >= DeviceTier.midRange.index;

  /// 是否启用模糊效果（BackdropFilter）
  bool get enableBlur => tier.index >= DeviceTier.midRange.index;

  /// 最大并发图片解码数
  int get maxConcurrentDecodes {
    switch (tier) {
      case DeviceTier.flagship: return 8;
      case DeviceTier.midRange: return 4;
      case DeviceTier.lowEnd: return 2;
      case DeviceTier.ultraLowEnd: return 1;
    }
  }
}

/// 公式渲染质量
enum FormulaRenderQuality {
  /// 高清：SVG 渲染，子像素精度
  high,
  /// 中等：缓存位图，2x 分辨率
  medium,
  /// 低清：缓存位图，1x 分辨率，简化排版
  low,
}
```

### 2.4 Provider 注册与全局访问

```dart
/// 全局 Provider 注册
///
/// 在 main.dart 或应用初始化时注册
final deviceCapabilitiesProvider = FutureProvider<DeviceCapabilities>((ref) {
  return DeviceProfiler.getCapabilities();
});

final featureProfileProvider = Provider<FeatureProfile>((ref) {
  final capabilities = ref.watch(deviceCapabilitiesProvider).valueOrNull;
  final tier = capabilities?.tier ?? DeviceTier.midRange; // 默认中端
  return FeatureProfile(tier);
});

/// 快捷扩展：在任何 Widget 中访问特性配置
extension FeatureProfileContext on BuildContext {
  FeatureProfile get featureProfile =>
      ProviderScope.containerOf(this).read(featureProfileProvider);
}
```

---

## 3. Widget 树优化规范

### 3.1 const Widget 强制规范

**规则：所有无状态的纯展示组件必须标记为 const**

```dart
// ❌ 错误：每次 rebuild 都创建新实例
class SubjectBadge extends StatelessWidget {
  final String name;
  final Color color;

  const SubjectBadge({super.key, required this.name, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        name,
        style: TextStyle(color: color, fontSize: 12),
      ),
    );
  }
}

// ✅ 正确：尽可能使用 const 构造函数和 const 子组件
class SubjectBadge extends StatelessWidget {
  final String name;
  final Color color;

  const SubjectBadge({super.key, required this.name, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4), // const!
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: const BorderRadius.circular(12), // const!
      ),
      child: Text(
        name,
        style: TextStyle(color: color, fontSize: 12),
      ),
    );
  }
}
```

### 3.2 RepaintBoundary 隔离策略

**规则：独立动画区域、高频更新区域必须用 RepaintBoundary 隔离**

```dart
/// AI 对话消息列表 - RepaintBoundary 隔离策略
class AiChatMessageList extends ConsumerWidget {
  const AiChatMessageList({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final messages = ref.watch(chatMessagesProvider);

    return ListView.builder(
      itemCount: messages.length,
      itemBuilder: (context, index) {
        final msg = messages[index];

        // 每条消息隔离重绘边界
        // 当流式文本更新时，只重绘当前正在输入的消息
        return RepaintBoundary(
          key: ValueKey('msg_${msg.id}'),
          child: _MessageBubble(message: msg),
        );
      },
    );
  }
}

/// 流式渲染的消息气泡 - 独立重绘区域
class _StreamingMessageBubble extends ConsumerWidget {
  final ChatMessage message;

  const _StreamingMessageBubble({required this.message});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return RepaintBoundary(
      // 流式文本与静态文本隔离
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 静态头部（不会随流式更新重绘）
          RepaintBoundary(
            child: _MessageHeader(message: message),
          ),
          // 流式内容（频繁更新）
          RepaintBoundary(
            child: _StreamingContent(stream: message.stream),
          ),
          // 操作按钮（流式结束后才显示）
          if (message.isComplete)
            RepaintBoundary(
              child: _MessageActions(message: message),
            ),
        ],
      ),
    );
  }
}
```

**RepaintBoundary 放置原则：**

| 场景 | 放置位置 | 原因 |
|------|---------|------|
| AI 对话列表 | 每条消息外层 | 流式更新只重绘单条消息 |
| 错题列表 | 每个错题卡片外层 | 展开收起不影响其他卡片 |
| 首页工作台 | 每个功能区域外层 | 倒计时/进度更新不影响其他区域 |
| 学习进度条 | 进度条组件外层 | 动画进度不影响页面其余部分 |
| 公式渲染区域 | 每个公式组件外层 | 公式渲染完成不触发父级重绘 |
| 底部导航栏 | 整个 BottomNavigationBar | 内容滚动不影响导航 |

### 3.3 避免 rebuild 的关键模式

```dart
/// 模式1：使用 Selector 精确订阅状态变化
class LearningProgressCard extends ConsumerWidget {
  const LearningProgressCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // ❌ 错误：订阅整个 UserLearningState，任何字段变化都触发 rebuild
    // final state = ref.watch(userLearningProvider);

    // ✅ 正确：只订阅需要的字段
    final progress = ref.watch(
      userLearningProvider.select((s) => s.todayProgress),
    );
    final streak = ref.watch(
      userLearningProvider.select((s) => s.streakDays),
    );

    return Card(
      child: Column(
        children: [
          LinearProgressIndicator(value: progress),
          Text('连续学习 $streak 天'),
        ],
      ),
    );
  }
}

/// 模式2：子组件抽取 + 参数透传避免父级 rebuild
class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // 首页只需要用户基本信息
    final userName = ref.watch(userProvider.select((u) => u.name));

    return Column(
      children: [
        // ✅ 每个区域独立 Widget，各自管理自己的状态订阅
        const _QuickActions(),           // 快捷操作（无状态，纯 const）
        const _TodayTasksSection(),      // 今日任务（独立订阅任务列表）
        const _WeakPointsReminder(),     // 薄弱点（独立订阅错题数据）
        const _ContinueLearningSection(),// 继续学习（独立订阅进度）
      ],
    );
  }
}

/// 模式3：使用 AutoDispose 防止 Provider 内存泄漏
final chatMessagesProvider = StateNotifierProvider.autoDispose
    .family<ChatMessagesNotifier, List<ChatMessage>, String>(
  (ref, conversationId) {
    return ChatMessagesNotifier(
      conversationId: conversationId,
      chatService: ref.watch(chatServiceProvider),
    );
  },
);
```

---

## 4. 图片加载与缓存优化

### 4.1 图片加载管线

```dart
/// 高性能图片加载服务
///
/// 根据设备等级自动调整加载策略
class OptimizedImageLoader {
  final FeatureProfile _profile;
  final ImageCache _cache;

  OptimizedImageLoader({
    required FeatureProfile profile,
    ImageCache? cache,
  })  : _profile = profile,
        _cache = cache ?? PaintingBinding.instance.imageCache;

  /// 初始化图片缓存配置
  void configureCache() {
    _cache.maximumSize = _profile.maxImageCacheCount;
    _cache.maximumSizeBytes = _profile.maxImageCacheSizeMB * 1024 * 1024;
  }

  /// 加载图片，根据设备等级选择策略
  Widget loadImage(
    String url, {
    double? width,
    double? height,
    BoxFit fit = BoxFit.cover,
    Widget? placeholder,
    Widget? errorWidget,
  }) {
    return _OptimizedImage(
      imageUrl: url,
      profile: _profile,
      width: width,
      height: height,
      fit: fit,
      placeholder: placeholder,
      errorWidget: errorWidget,
    );
  }
}

/// 优化的图片 Widget
class _OptimizedImage extends ConsumerStatefulWidget {
  final String imageUrl;
  final FeatureProfile profile;
  final double? width;
  final double? height;
  final BoxFit fit;
  final Widget? placeholder;
  final Widget? errorWidget;

  const _OptimizedImage({
    required this.imageUrl,
    required this.profile,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    this.placeholder,
    this.errorWidget,
  });

  @override
  ConsumerState<_OptimizedImage> createState() => _OptimizedImageState();
}

class _OptimizedImageState extends ConsumerState<_OptimizedImage> {
  bool _useThumbnail = true;

  @override
  void initState() {
    super.initState();
    _useThumbnail = widget.profile.useThumbnailFirst;
  }

  @override
  Widget build(BuildContext context) {
    // 低端设备：先加载缩略图，再加载高清图
    if (_useThumbnail && widget.profile.useThumbnailFirst) {
      return _buildThumbnailTransition();
    }

    return _buildFullImage(widget.imageUrl);
  }

  Widget _buildThumbnailTransition() {
    final thumbUrl = _toThumbnailUrl(widget.imageUrl);

    return Stack(
      fit: StackFit.expand,
      children: [
        // 缩略图层（快速显示）
        _buildFullImage(thumbUrl),
        // 高清图层（加载完成后覆盖）
        if (!_useThumbnail)
          _buildFullImage(widget.imageUrl),
      ],
    );
  }

  Widget _buildFullImage(String url) {
    return CachedNetworkImage(
      imageUrl: url,
      width: widget.width,
      height: widget.height,
      fit: widget.fit,
      memCacheWidth: _calculateMemCacheWidth(),
      memCacheHeight: _calculateMemCacheHeight(),
      // 低端设备降低图片质量减少内存
      colorBlendMode: null,
      placeholder: (context, url) =>
          widget.placeholder ?? const _ShimmerPlaceholder(),
      errorWidget: (context, url, error) =>
          widget.errorWidget ?? const _ErrorPlaceholder(),
      // 加载完成回调：切换到高清图
      imageBuilder: (context, imageProvider) {
        if (_useThumbnail && widget.profile.useThumbnailFirst) {
          // 延迟切换，确保缩略图先显示
          Future.microtask(() {
            if (mounted) setState(() => _useThumbnail = false);
          });
        }
        return Image(image: imageProvider, fit: widget.fit);
      },
    );
  }

  /// 根据设备等级计算内存缓存尺寸
  /// 低端设备使用较小的解码尺寸减少内存占用
  int? _calculateMemCacheWidth() {
    if (widget.width == null) return null;
    final ratio = MediaQuery.maybeOf(context)?.devicePixelRatio ?? 2.0;
    final qualityFactor = widget.profile.imageQuality;
    final targetWidth = (widget.width! * ratio * qualityFactor).toInt();
    return targetWidth;
  }

  int? _calculateMemCacheHeight() {
    if (widget.height == null) return null;
    final ratio = MediaQuery.maybeOf(context)?.devicePixelRatio ?? 2.0;
    final qualityFactor = widget.profile.imageQuality;
    final targetHeight = (widget.height! * ratio * qualityFactor).toInt();
    return targetHeight;
  }

  String _toThumbnailUrl(String originalUrl) {
    // CDN 缩略图参数（示例：阿里云 OSS 缩略图处理）
    final uri = Uri.parse(originalUrl);
    if (uri.host.contains('aliyuncs.com')) {
      return '$originalUrl?x-oss-process=image/resize,w_200,q_50';
    }
    // 其他 CDN 的缩略图策略
    return originalUrl;
  }
}

/// 骨架屏占位
class _ShimmerPlaceholder extends StatefulWidget {
  const _ShimmerPlaceholder();

  @override
  State<_ShimmerPlaceholder> createState() => _ShimmerPlaceholderState();
}

class _ShimmerPlaceholderState extends State<_ShimmerPlaceholder>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment(-1.0 + 2.0 * _controller.value, 0),
              end: Alignment(1.0 + 2.0 * _controller.value, 0),
              colors: [
                Colors.grey[200]!,
                Colors.grey[100]!,
                Colors.grey[200]!,
              ],
            ),
          ),
        );
      },
    );
  }
}
```

### 4.2 图片加载 Provider 管理器

```dart
/// 图片加载全局配置 Provider
final imageLoaderProvider = Provider<OptimizedImageLoader>((ref) {
  final profile = ref.watch(featureProfileProvider);
  final loader = OptimizedImageLoader(profile: profile);
  loader.configureCache();
  return loader;
});

/// 图片预加载工具（用于题目列表等已知即将显示的图片）
class ImagePreloader {
  final OptimizedImageLoader _loader;

  ImagePreloader(this._loader);

  /// 预加载一组图片
  /// 在列表即将滚动到该区域时调用
  Future<void> preloadImages(List<String> urls) async {
    await Future.wait(
      urls.map((url) => precacheImage(
        CachedNetworkImageProvider(url),
        // 实际使用通过 PreloadContext widget 传入
        // 参见下方 PreloadZone 实现
        _dummyContext!,
      )),
    );
  }

  static BuildContext? _dummyContext;
  static void init(BuildContext context) {
    _dummyContext = context;
  }
}
```

---

## 5. 列表滚动性能优化

### 5.1 ListView 优化规范

```dart
/// 高性能列表配置基类
/// 所有列表页面应使用此基类或遵循其规范
abstract class OptimizedListScreen extends ConsumerWidget {
  const OptimizedListScreen({super.key});

  FeatureProfile getProfile(WidgetRef ref) =>
      ref.read(featureProfileProvider);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = getProfile(ref);
    return ListView.builder(
      cacheExtent: MediaQuery.sizeOf(context).height *
          profile.listCacheExtentMultiplier,
      addAutomaticKeepAlives: true,
      addRepaintBoundaries: true,
      addSemanticIndexes: true,
      physics: profile.tier == DeviceTier.ultraLowEnd
          ? const ClampingScrollPhysics()
          : const BouncingScrollPhysics(),
      itemCount: itemCount,
      itemBuilder: (context, index) => buildItem(context, ref, index),
    );
  }

  int get itemCount;
  Widget buildItem(BuildContext context, WidgetRef ref, int index);
}
```

### 5.2 错题列表优化示例

```dart
class MistakeListScreen extends OptimizedListScreen {
  const MistakeListScreen({super.key});
  @override int get itemCount => _items.length;
  List<MistakeItem> get _items => []; // 实际从 provider 获取

  @override
  Widget buildItem(BuildContext context, WidgetRef ref, int index) {
    return _MistakeCard(
      key: ValueKey('mistake_${_items[index].id}'),
      item: _items[index],
    );
  }
}

class _MistakeCard extends ConsumerStatefulWidget {
  final MistakeItem item;
  const _MistakeCard({super.key, required this.item});
  @override ConsumerState<_MistakeCard> createState() => _MistakeCardState();
}

class _MistakeCardState extends ConsumerState<_MistakeCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: Card(
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: InkWell(
          onTap: () => setState(() => _expanded = !_expanded),
          child: AnimatedCrossFade(
            firstChild: _buildCollapsed(),
            secondChild: _buildExpanded(),
            crossFadeState: _expanded
                ? CrossFadeState.showSecond
                : CrossFadeState.showFirst,
            duration: context.featureProfile
                .animationDuration(const Duration(milliseconds: 300)),
          ),
        ),
      ),
    );
  }

  Widget _buildCollapsed() => /* 折叠态 */ Container();
  Widget _buildExpanded() => /* 展开态含公式、图片 */ Container();
}
```

### 5.3 分页加载通用组件

```dart
@immutable
class PaginatedState<T> {
  final List<T> items;
  final bool isLoading;
  final bool hasMore;
  final int currentPage;
  const PaginatedState({
    this.items = const [],
    this.isLoading = false,
    this.hasMore = true,
    this.currentPage = 0,
  });
}

class PaginatedListView<T> extends ConsumerWidget {
  final AsyncNotifierProvider<dynamic, PaginatedState<T>> provider;
  final Widget Function(BuildContext, T) itemBuilder;
  final ScrollController? controller;

  const PaginatedListView({
    super.key,
    required this.provider,
    required this.itemBuilder,
    this.controller,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(provider);
    final profile = ref.watch(featureProfileProvider);

    return NotificationListener<ScrollNotification>(
      onNotification: (notification) {
        if (notification is ScrollEndNotification &&
            notification.metrics.pixels >=
                notification.metrics.maxScrollExtent * 0.8 &&
            state.hasMore && !state.isLoading) {
          ref.read(provider.notifier).loadMore();
        }
        return false;
      },
      child: ListView.builder(
        controller: controller,
        cacheExtent: MediaQuery.sizeOf(context).height *
            profile.listCacheExtentMultiplier,
        itemCount: state.items.length + (state.hasMore ? 1 : 0),
        itemBuilder: (context, index) {
          if (index == state.items.length) {
            return const Padding(
              padding: EdgeInsets.all(16),
              child: Center(
                child: SizedBox(
                  width: 24, height: 24,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            );
          }
          return itemBuilder(context, state.items[index]);
        },
      ),
    );
  }
}
```

---

## 6. AI 对话流式渲染优化

### 6.1 SSE 流式文本节流策略

```dart
/// AI 对话流式渲染控制器
class StreamingTextController extends ChangeNotifier {
  final FeatureProfile _profile;
  final StringBuffer _buffer = StringBuffer();
  String _displayText = '';
  bool _isStreaming = false;
  Timer? _throttleTimer;
  String _pendingText = '';

  StreamingTextController({required FeatureProfile profile})
      : _profile = profile;

  String get displayText => _displayText;
  bool get isStreaming => _isStreaming;

  void appendChunk(String chunk) {
    if (!_isStreaming) _isStreaming = true;
    _buffer.write(chunk);
    _pendingText += chunk;

    if (_profile.sseRenderThrottle == Duration.zero) {
      _flush(); // 旗舰：立即渲染
    } else if (_pendingText.length >= _profile.sseRenderBatchSize) {
      _scheduleFlush(); // 低端：积攒后批量渲染
    }
  }

  void complete() {
    _isStreaming = false;
    _throttleTimer?.cancel();
    _flush();
  }

  void _scheduleFlush() {
    _throttleTimer?.cancel();
    _throttleTimer = Timer(_profile.sseRenderThrottle, _flush);
  }

  void _flush() {
    if (_pendingText.isEmpty) return;
    _displayText = _buffer.toString();
    _pendingText = '';
    notifyListeners();
  }

  @override
  void dispose() {
    _throttleTimer?.cancel();
    super.dispose();
  }
}
```

### 6.2 公式懒渲染

```dart
/// 流式消息中的公式延迟渲染
/// 低端设备：先显示占位符，流式结束后渲染公式
class LazyFormulaText extends ConsumerStatefulWidget {
  final String content;
  final bool isStreaming;

  const LazyFormulaText({super.key, required this.content, this.isStreaming = false});
  @override ConsumerState<LazyFormulaText> createState() => _LazyFormulaTextState();
}

class _LazyFormulaTextState extends ConsumerState<LazyFormulaText> {
  final Set<int> _renderedFormulas = {};

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(featureProfileProvider);
    final segments = _parseContent(widget.content);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: segments.asMap().entries.map((entry) {
        final idx = entry.key;
        final seg = entry.value;
        if (seg.isText) return Text(seg.content);

        // 低端设备：限制同时渲染公式数
        if (_renderedFormulas.length >= profile.maxSimultaneousFormulas &&
            !_renderedFormulas.contains(idx)) {
          return _buildPlaceholder();
        }

        _renderedFormulas.add(idx);
        return RepaintBoundary(
          key: ValueKey('formula_$idx'),
          child: FormulaWidget(latex: seg.content, quality: profile.formulaRenderQuality),
        );
      }).toList(),
    );
  }

  Widget _buildPlaceholder() => Container(
    height: 40, margin: const EdgeInsets.symmetric(vertical: 4),
    padding: const EdgeInsets.all(8),
    decoration: BoxDecoration(color: Colors.grey[100], borderRadius: BorderRadius.circular(8)),
    child: Row(children: [
      Icon(Icons.functions, size: 16, color: Colors.grey[400]),
      const SizedBox(width: 4),
      Text('公式', style: TextStyle(color: Colors.grey[400], fontSize: 12)),
    ]),
  );

  List<_Segment> _parseContent(String content) {
    // 解析 $...$ 和 $$...$$ 为文本段和公式段
    final segments = <_Segment>[];
    final regex = RegExp(r'\$\$?(.+?)\$\$?', dotAll: true);
    var last = 0;
    for (final m in regex.allMatches(content)) {
      if (m.start > last) segments.add(_Segment(true, content.substring(last, m.start)));
      segments.add(_Segment(false, m.group(1)!));
      last = m.end;
    }
    if (last < content.length) segments.add(_Segment(true, content.substring(last)));
    return segments.isEmpty ? [_Segment(true, content)] : segments;
  }
}

class _Segment {
  final bool isText;
  final String content;
  const _Segment(this.isText, this.content);
}
```

---

## 7. Shader 预编译与 SkSL 预热

```dart
/// SkSL 预热管理器 - 启动后后台预热常用 Shader
class SkslWarmupManager {
  static Future<void> warmupInBackground(GlobalKey<NavigatorState> navKey) async {
    await Future.delayed(const Duration(seconds: 2)); // 不阻塞首页
    if (navKey.currentContext == null) return;

    final overlay = Overlay.of(navKey.currentContext!);
    final entry = OverlayEntry(
      builder: (_) => const Positioned(
        left: -9999, top: -9999,
        child: SizedBox(width: 1, height: 1, child: _WarmupWidgets()),
      ),
      opaque: false,
    );
    overlay.insert(entry);
    await Future.delayed(const Duration(milliseconds: 100));
    entry.remove();
  }
}

/// 预热组件：阴影、模糊、渐变、Canvas绘制
@visibleForTesting
class _WarmupWidgets extends StatelessWidget {
  const _WarmupWidgets();
  @override
  Widget build(BuildContext context) => Column(children: [
    Container(width: 10, height: 10,
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(4),
        boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 4)])),
    Container(width: 10, height: 10,
      decoration: const BoxDecoration(gradient: LinearGradient(colors: [Colors.blue, Colors.purple]))),
    CustomPaint(size: const Size(10, 10), painter: _WarmupPainter()),
  ]);
}

class _WarmupPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()..color = Colors.blue..strokeWidth = 1..style = PaintingStyle.stroke;
    canvas.drawLine(Offset.zero, Offset(size.width, size.height), p);
    canvas.drawArc(Rect.fromLTWH(0, 0, size.width, size.height), 0, 3.14, false, p);
  }
  @override
  bool shouldRepaint(covariant CustomPainter old) => false;
}
```

---

## 8. 内存管理与泄漏防护

### 8.1 内存泄漏检测

```dart
class MemoryLeakDetector {
  static void install() {
    if (!kDebugMode) return;
    PaintingBinding.instance.imageCache.addListener(() {
      final c = PaintingBinding.instance.imageCache;
      if (c.currentSize > c.maximumSize * 0.8) {
        debugPrint('[MemoryWarning] Image cache: ${c.currentSize}/${c.maximumSize}');
      }
    });
  }
}
```

### 8.2 内存压力响应

```dart
class MemoryPressureHandler with WidgetsBindingObserver {
  final FeatureProfile _profile;
  MemoryPressureHandler(this._profile);

  void install() => WidgetsBinding.instance.addObserver(this);
  void dispose() => WidgetsBinding.instance.removeObserver(this);

  @override
  void didHaveMemoryPressure() {
    final cache = PaintingBinding.instance.imageCache;
    cache.clearLiveImages();
    // 清理 70% 的图片缓存
    final toRemove = (cache.currentSize * 0.7).toInt();
    for (var i = 0; i < toRemove; i++) cache.evict(cache.currentSize); // LRU

    if (_profile.tier == DeviceTier.ultraLowEnd) {
      // 极低端：清空公式缓存
    }
    debugPrint('[Memory] Pressure handled. Cache: ${cache.currentSize}');
  }
}

final memoryPressureHandlerProvider = FutureProvider<void>((ref) async {
  final profile = ref.watch(featureProfileProvider);
  final handler = MemoryPressureHandler(profile)..install();
  ref.onDispose(() => handler.dispose());
});
```

---

## 9. 动画性能规范

### 9.1 动画分级策略

```dart
class AnimationConfigFactory {
  final FeatureProfile _profile;
  AnimationConfigFactory(this._profile);

  CustomTransitionPage<void> pageTransition({
    required Widget child, required GoRouterState state,
  }) {
    if (!_profile.pageTransitions) {
      return CustomTransitionPage(
        key: state.pageKey, child: child,
        transitionDuration: Duration.zero,
        transitionsBuilder: (_, __, ___, child) => child,
      );
    }

    return CustomTransitionPage(
      key: state.pageKey, child: child,
      transitionDuration: _profile.animationDuration(const Duration(milliseconds: 400)),
      transitionsBuilder: (ctx, anim, _, child) => FadeTransition(
        opacity: CurvedAnimation(parent: anim, curve: Curves.easeOutCubic),
        child: SlideTransition(
          position: Tween<Offset>(begin: const Offset(0.05, 0), end: Offset.zero)
              .animate(CurvedAnimation(parent: anim, curve: Curves.easeOutCubic)),
          child: child,
        ),
      ),
    );
  }
}
```

### 9.2 动画禁忌清单

| 禁忌 | 替代方案 |
|------|----------|
| 动画中 rebuild 整个页面 | AnimatedWidget / AnimatedBuilder |
| setState 驱动高频动画 | AnimationController + Listener |
| 列表项复杂进入动画 | 首屏限制动画数量 |
| BackdropFilter 实时模糊 | 静态模糊图片或关闭 |
| 动画回调中执行网络请求 | 动画结束后再发请求 |
| 同时 > 3 个弹性动画 | 改用线性/缓动动画 |

---

## 10. 性能测试与基准

### 10.1 性能基线

| 场景 | 旗舰 | 中端 | 低端 | 极低端 |
|------|------|------|------|--------|
| 冷启动→首页可见 | < 2s | < 3s | < 5s | < 8s |
| 首页→AI对话页转场 | < 300ms | < 500ms | < 800ms | 无动画 |
| 流式渲染100字+5公式 | < 1s | < 2s | < 4s | < 6s |
| 错题列表滚动（50项） | 60fps | 55fps | 30fps | 25fps |
| 拍照→识别结果 | < 5s | < 5s | < 7s | < 10s |
| 首页全区域加载 | < 1s | < 1.5s | < 2.5s | < 4s |

### 10.2 DevTools 分析流程

1. `flutter run --profile --trace-skia` 启动 profile 模式
2. DevTools → Performance → 录制操作场景（10-30s）
3. Flame Chart 查找超长帧（> 16ms）
4. Widget Rebuild Info 找高频 rebuild Widget
5. Memory 面板检查泄漏趋势
6. 修复后重新录制对比

### 10.3 CI/CD 性能门禁

```yaml
# .github/workflows/performance_gate.yml
name: Performance Gate
on:
  pull_request:
    paths: ['lib/**']
jobs:
  performance:
    runs-on: [self-hosted, flutter-performance]
    steps:
      - uses: actions/checkout@v4
      - run: flutter test integration_test/performance/ --reporter=json > perf_results.json
      - run: dart tools/check_performance_regression.dart --threshold=10%
```

---

## 11. 低端设备专项优化

### 11.1 极低端设备（Android Go / 2GB）禁用列表

| 功能 | 原因 |
|------|------|
| Hero 动画 | GPU 开销大 |
| 页面转场动画 | 延迟感强于卡顿感 |
| BackdropFilter 模糊 | GPU 开销极大 |
| 阴影效果 | 增加绘制层 |
| 公式预缓存 | 内存不足 |
| 图片预加载 | 带宽/内存有限 |
| 离线内容全量同步 | 存储空间不足 |

### 11.2 开发自查清单

| 检查项 | 要求 | 方式 |
|--------|------|------|
| 新 Widget 使用 const | 纯展示组件必须 | Lint 规则 |
| 列表使用 builder | 禁止 ListView(children:) | Code review |
| 图片指定缓存尺寸 | memCacheWidth/Height | Code review |
| 流式渲染节流 | StreamingTextController | Code review |
| 动画低端降级 | FeatureProfile 控制 | 测试 |
| Provider autoDispose | 页面级 Provider 必须自动释放 | Riverpod DevTools |
| RepaintBoundary | 动画/高频更新区域隔离 | DevTools Rebuild |
| 大图用缩略图 | OptimizedImage 组件 | Code review |
| 公式渲染数量限制 | 遵循 maxSimultaneousFormulas | 测试 |

---

## 12. 依赖包版本

| 包名 | 用途 | 推荐版本 |
|------|------|----------|
| `cached_network_image` | 图片缓存加载 | ^3.3.0 |
| `flutter_riverpod` | 状态管理 + select 优化 | ^2.4.0 |
| `integration_test` | 性能测试 | SDK内置 |
| `device_info_plus` | 设备信息采集 | ^9.0.0 |
| `shared_preferences` | 设备分级缓存 | ^2.2.0 |
| `flutter_cache_manager` | 文件缓存管理 | ^3.3.0 |

---

## 13. 总结

### 核心原则

1. **const 一切**：纯展示 Widget 必须标记 const
2. **隔离重绘**：动画、流式文本、公式必须 RepaintBoundary
3. **精确订阅**：`.select()` 只订阅需要的字段
4. **懒加载**：builder 列表、缩略图图片、延迟公式渲染
5. **按设备分级**：FeatureProfile 统一管控降级策略
6. **内存有责**：每个页面负责自己的资源释放

### 性能分析命令

```bash
# Profile 模式运行
flutter run --profile --trace-skia --dump-skp-on-shader-compilation

# 构建体积分析
flutter build apk --analyze-size --target-platform android-arm64

# DevTools
flutter pub global activate devtools
flutter pub global run devtools
```

---

*本文档由 PrimeTop 项目设计文档细化生成，供 Flutter 开发团队参考编码。*