# 客户端 WebView 容器与 H5 混合页面框架 - 详细设计

## 1. 模块概述

### 1.1 定位与目标

WebView 容器与 H5 混合页面框架（简称 **HybridBridge**）是 PrimeTop 客户端的基础设施层，负责：

1. **统一 WebView 容器管理**：提供标准化、高性能的 WebView 实例创建、复用和销毁机制。
2. **Native ↔ H5 双向通信桥**：定义标准化的 JSBridge 协议，支持 H5 页面调用 Native 能力（拍照、语音、分享、支付等）。
3. **H5 页面路由与加载**：统一管理内嵌 H5 页面的 URL 路由、参数传递、预加载和缓存策略。
4. **安全管控**：域名白名单、内容安全校验、JS 注入防护、敏感操作拦截。
5. **性能优化**：WebView 预热池、离线资源包、页面加载速度监控。

### 1.2 应用场景

| 场景 | 说明 | 优先级 |
| --- | --- | --- |
| 教材内容页渲染 | 富文本、公式、图表的教材内容展示 | P0 |
| 运营活动页 | 营销落地页、专题活动、公告 | P0 |
| 协议与政策 | 用户协议、隐私政策、儿童保护规则 | P0 |
| 学情报告 H5 | 复杂图表和数据可视化报告 | P1 |
| 作文批改详情 | 批改标注与富文本建议展示 | P1 |
| 知识图谱可视化 | 交互式图谱展示（Web 技术优势） | P2 |
| 会员权益说明 | 权益对比、购买引导页 | P1 |
| 帮助中心/FAQ | 搜索、分类浏览 | P2 |
| 未来小程序/Web | 复用 H5 能力快速适配新端 | P3 |

### 1.3 设计约束

| 约束 | 说明 |
| --- | --- |
| Flutter 框架 | 基于官方 `webview_flutter` 插件，Android 使用 WebView，iOS 使用 WKWebView |
| 域名白名单 | 只允许加载已备案的域名下的页面，非白名单域名直接拦截 |
| 教育合规 | H5 页面内容需经审核，禁止加载外部不可控 JS |
| 性能基线 | H5 页面首屏可交互时间 < 1.5s（含预加载命中时 < 500ms） |
| 离线可用 | 核心页面（协议、基础帮助）需支持离线访问 |

### 1.4 与其他模块的关系

```
┌──────────────────────────────────────────────────────────┐
│                    客户端各业务模块                        │
│  (同步课堂 / 学情报告 / 运营活动 / 协议页面 / 作文辅导)    │
└──────────┬────────────────────────────────┬──────────────┘
           │ 页面导航                         │ 调用 Native 能力
           ▼                                 ▼
┌──────────────────────────────────────────────────────────┐
│              HybridBridge (本模块)                         │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────┐ │
│  │ WebView    │  │ JSBridge   │  │ 安全与性能管理      │ │
│  │ 容器池     │  │ 双向通信    │  │ (白名单/拦截/缓存) │ │
│  └────────────┘  └────────────┘  └────────────────────┘ │
└──────────┬───────────────────────────────────────────────┘
           │ 依赖
     ┌─────┴──────┬──────────┬──────────┐
     ▼            ▼          ▼          ▼
  客户端路由    离线缓存    文件存储    设备能力
  (GoRouter)   (Hive/DB)  (对象存储)  (拍照/语音/分享)
```

---

## 2. WebView 容器管理

### 2.1 容器实例池（WebViewPool）

WebView 创建成本高（Android 约 200-500ms），维护预热实例池降低首屏延迟。

```dart
/// lib/hybrid/webview_pool.dart

class WebViewPool {
  static final WebViewPool _instance = WebViewPool._();
  factory WebViewPool() => _instance;
  WebViewPool._();

  /// 最大缓存实例数
  static const int maxPoolSize = 3;

  /// 空闲 WebView 实例队列
  final List<WebViewController> _idlePool = [];

  /// 正在使用的 WebView 实例（trackId → controller）
  final Map<String, WebViewController> _activeMap = {};

  /// 初始化：预热 1-2 个实例（在应用启动后异步执行）
  Future<void> warmUp({int count = 2}) async {
    for (int i = 0; i < count && _idlePool.length < maxPoolSize; i++) {
      final controller = await _createRawController();
      _idlePool.add(controller);
    }
  }

  /// 获取一个 WebView 实例
  Future<WebViewController> acquire({required String trackId}) async {
    // 优先从池中取
    if (_idlePool.isNotEmpty) {
      final controller = _idlePool.removeLast();
      _activeMap[trackId] = controller;
      return controller;
    }

    // 池空则新建
    final controller = await _createRawController();
    _activeMap[trackId] = controller;
    return controller;
  }

  /// 归还实例到池中
  void release(String trackId) {
    final controller = _activeMap.remove(trackId);
    if (controller != null && _idlePool.length < maxPoolSize) {
      // 清理状态后归还
      controller.loadRequest(LoadRequestParams(
        uri: Uri.parse('about:blank'),
      ));
      _idlePool.add(controller);
    }
    // 超出池大小则直接销毁（GC 回收）
  }

  /// 创建底层 Controller（含通用配置）
  Future<WebViewController> _createRawController() async {
    final params = PlatformWebViewWidgetCreationParams(
      // Android 特定配置
      androidOnCreateWindow: (_, __, ___, ____) => false,
    );

    final controller = WebViewController.fromPlatformCreationParams(params);

    await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
    await controller.setBackgroundColor(Colors.transparent);
    await controller.setNavigationDelegate(NavigationDelegate(
      onNavigationRequest: _onNavigationRequest,
      onUrlChanged: _onUrlChanged,
      onPageFinished: _onPageFinished,
      onWebResourceError: _onWebResourceError,
    ));

    // 注入通用 JSBridge
    await _injectJSBridge(controller);

    return controller;
  }

  /// 导航拦截
  FutureOr<NavigationDecision> _onNavigationRequest(
    NavigationRequest request,
  ) async {
    final uri = Uri.parse(request.url);

    // 1. 域名白名单校验
    if (!DomainWhitelist.isAllowed(uri.host)) {
      _securityLog('BLOCKED_NAVIGATION', request.url);
      return NavigationDecision.prevent;
    }

    // 2. 非安全协议拦截
    if (!const {'https', 'about'}.contains(uri.scheme)) {
      _securityLog('BLOCKED_SCHEME', request.url);
      return NavigationDecision.prevent;
    }

    return NavigationDecision.navigate;
  }
}
```

### 2.2 容器 Widget

```dart
/// lib/hybrid/hybrid_webview.dart

class HybridWebView extends StatefulWidget {
  /// 页面 URL（必填）
  final String url;

  /// 页面标题（用于 AppBar，为空时从页面 <title> 读取）
  final String? title;

  /// 是否显示 AppBar
  final bool showAppBar;

  /// 是否启用下拉刷新
  final bool enablePullRefresh;

  /// 页面加载超时（毫秒）
  final int loadTimeoutMs;

  /// Native 能力授权范围
  final Set<NativeCapability> allowedCapabilities;

  /// 页面加载完成回调
  final VoidCallback? onPageLoaded;

  /// JSBridge 消息回调
  final void Function(JSBridgeMessage message)? onBridgeMessage;

  const HybridWebView({
    super.key,
    required this.url,
    this.title,
    this.showAppBar = true,
    this.enablePullRefresh = true,
    this.loadTimeoutMs = 15000,
    this.allowedCapabilities = const {
      NativeCapability.navigation,
      NativeCapability.share,
      NativeCapability.clipboard,
    },
    this.onPageLoaded,
    this.onBridgeMessage,
  });

  @override
  State<HybridWebView> createState() => _HybridWebViewState();
}

class _HybridWebViewState extends State<HybridWebView> {
  late final String _trackId;
  WebViewController? _controller;
  bool _isLoading = true;
  bool _loadFailed = false;
  String? _pageTitle;

  @override
  void initState() {
    super.key;
    _trackId = 'wv_${DateTime.now().millisecondsSinceEpoch}';
    _initWebView();
  }

  Future<void> _initWebView() async {
    final pool = WebViewPool();
    _controller = await pool.acquire(trackId: _trackId);

    if (!mounted) return;

    setState(() {});

    // 加载目标 URL（优先使用离线缓存）
    final effectiveUrl = await OfflineResourceManager()
        .resolveUrl(widget.url);

    await _controller!.loadRequest(LoadRequestParams(
      uri: Uri.parse(effectiveUrl),
    ));

    // 超时监控
    Future.delayed(Duration(milliseconds: widget.loadTimeoutMs), () {
      if (mounted && _isLoading) {
        _handleLoadTimeout();
      }
    });
  }

  void _onPageFinished(String url) {
    if (!mounted) return;
    setState(() {
      _isLoading = false;
      _loadFailed = false;
    });

    // 读取页面标题
    _controller?.getTitle().then((title) {
      if (mounted && title != null) {
        setState(() => _pageTitle = title);
      }
    });

    // 性能指标上报
    _reportPageLoadMetrics(url);

    widget.onPageLoaded?.call();
  }

  @override
  void dispose() {
    WebViewPool().release(_trackId);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: widget.showAppBar
          ? AppBar(
              title: Text(widget.title ?? _pageTitle ?? ''),
              // 分龄适配：幼儿/小学用大返回按钮
              leading: AgeUI.backButton(context),
            )
          : null,
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_controller == null) {
      return const Center(child: LoadingIndicator());
    }

    if (_loadFailed) {
      return _buildErrorView();
    }

    Widget webView = WebViewWidget(controller: _controller!);

    if (widget.enablePullRefresh) {
      webView = RefreshIndicator(
        onRefresh: _reload,
        child: Stack(
          children: [
            webView,
            if (_isLoading) const LinearProgressIndicator(),
          ],
        ),
      );
    }

    return webView;
  }

  Widget _buildErrorView() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.cloud_off, size: 48, color: Colors.grey[400]),
          const SizedBox(height: 16),
          Text('页面加载失败', style: Theme.of(context).textTheme.bodyLarge),
          const SizedBox(height: 8),
          Text('请检查网络后重试',
              style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 24),
          ElevatedButton(onPressed: _reload, child: const Text('重新加载')),
        ],
      ),
    );
  }

  Future<void> _reload() async {
    setState(() {
      _isLoading = true;
      _loadFailed = false;
    });
    await _controller?.reload();
  }

  Future<void> _handleLoadTimeout() async {
    setState(() {
      _isLoading = false;
      _loadFailed = true;
    });
  }
}
```

---

## 3. JSBridge 双向通信协议

### 3.1 通信架构

```
┌──────────────────────────────────────────────┐
│              H5 页面 (JavaScript)             │
│                                              │
│  window.PrimeTopBridge.call(action, params)  │
│  window.PrimeTopBridge.on(event, callback)   │
└───────────────────┬──────────────────────────┘
                    │ JavaScript Channel
                    ▼
┌──────────────────────────────────────────────┐
│           Native (Flutter/Dart)               │
│                                              │
│  JSBridgeDispatcher                          │
│  ├── Action Handlers (Native → 执行)         │
│  ├── Event Emitters (Native → H5 推送)       │
│  └── Interceptors (安全/权限/日志)            │
└──────────────────────────────────────────────┘
```

### 3.2 消息格式定义

```dart
/// lib/hybrid/jsbridge/protocol.dart

/// H5 → Native 请求消息
class JSBridgeMessage {
  /// 消息唯一 ID（用于回调匹配）
  final String msgId;

  /// 动作名称（如 "share", "takePhoto", "getUserInfo"）
  final String action;

  /// 参数（JSON）
  final Map<String, dynamic> params;

  /// 时间戳
  final int timestamp;

  JSBridgeMessage({
    required this.msgId,
    required this.action,
    required this.params,
    int? timestamp,
  }) : timestamp = timestamp ?? DateTime.now().millisecondsSinceEpoch;

  factory JSBridgeMessage.fromJson(Map<String, dynamic> json) =>
      JSBridgeMessage(
        msgId: json['msgId'] as String,
        action: json['action'] as String,
        params: (json['params'] as Map<String, dynamic>?) ?? {},
        timestamp: json['timestamp'] as int? ??
            DateTime.now().millisecondsSinceEpoch,
      );
}

/// Native → H5 响应
class JSBridgeResponse {
  final String msgId;
  final bool success;
  final dynamic data;
  final String? errorCode;
  final String? errorMessage;

  JSBridgeResponse({
    required this.msgId,
    required this.success,
    this.data,
    this.errorCode,
    this.errorMessage,
  });

  Map<String, dynamic> toJson() => {
        'msgId': msgId,
        'success': success,
        if (data != null) 'data': data,
        if (errorCode != null) 'errorCode': errorCode,
        if (errorMessage != null) 'errorMessage': errorMessage,
      };
}

/// Native → H5 事件推送
class JSBridgeEvent {
  final String event;
  final Map<String, dynamic> data;

  JSBridgeEvent({required this.event, required this.data});

  String toJs() => jsonEncode({
        'type': 'event',
        'event': event,
        'data': data,
      });
}
```

### 3.3 H5 端 JSBridge SDK

```javascript
// h5-sdk/primetop-bridge.js
// 注入到 WebView 的桥接 SDK

(function (window) {
  'use strict';

  const BRIDGE_NAME = 'PrimeTopBridge';
  const callbackMap = {};
  let eventListeners = {};

  // 调用 Native 能力
  function call(action, params = {}, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const msgId = `${action}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      callbackMap[msgId] = {
        resolve,
        reject,
        timer: setTimeout(() => {
          delete callbackMap[msgId];
          reject(new Error(`Bridge call timeout: ${action}`));
        }, timeout),
      };

      // 发送消息到 Native
      if (window.__PRIMETOP_CHANNEL__) {
        // Flutter webview_flutter channel
        window.__PRIMETOP_CHANNEL__.postMessage(
          JSON.stringify({
            msgId,
            action,
            params,
            timestamp: Date.now(),
          })
        );
      } else {
        // Fallback: console.log 用于调试
        console.warn('PrimeTopBridge: Native channel not available');
        clearTimeout(callbackMap[msgId].timer);
        delete callbackMap[msgId];
        reject(new Error('Native channel not available'));
      }
    });
  }

  // Native 回调响应
  function _onResponse(responseJson) {
    try {
      const resp = typeof responseJson === 'string'
        ? JSON.parse(responseJson)
        : responseJson;
      const cb = callbackMap[resp.msgId];
      if (!cb) return;

      clearTimeout(cb.timer);
      delete callbackMap[resp.msgId];

      if (resp.success) {
        cb.resolve(resp.data);
      } else {
        const err = new Error(resp.errorMessage || 'Unknown error');
        err.code = resp.errorCode;
        cb.reject(err);
      }
    } catch (e) {
      console.error('PrimeTopBridge._onResponse error:', e);
    }
  }

  // 注册事件监听
  function on(event, callback) {
    if (!eventListeners[event]) {
      eventListeners[event] = [];
    }
    eventListeners[event].push(callback);
  }

  // 移除事件监听
  function off(event, callback) {
    if (!eventListeners[event]) return;
    if (callback) {
      eventListeners[event] = eventListeners[event].filter(cb => cb !== callback);
    } else {
      delete eventListeners[event];
    }
  }

  // Native 推送事件触发
  function _onEvent(eventJson) {
    try {
      const evt = typeof eventJson === 'string' ? JSON.parse(eventJson) : eventJson;
      const listeners = eventListeners[evt.event] || [];
      listeners.forEach(cb => {
        try {
          cb(evt.data);
        } catch (e) {
          console.error('Event listener error:', e);
        }
      });
    } catch (e) {
      console.error('PrimeTopBridge._onEvent error:', e);
    }
  }

  // 暴露到全局
  window[BRIDGE_NAME] = {
    call,
    on,
    off,
    _onResponse,
    _onEvent,
    isNative: !!window.__PRIMETOP_CHANNEL__,
    version: '1.0.0',
  };
})(window);
```

### 3.4 Native 端 Action 注册与分发

```dart
/// lib/hybrid/jsbridge/dispatcher.dart

/// Native 能力枚举
enum NativeCapability {
  navigation,    // 页面跳转
  share,         // 分享
  clipboard,     // 剪贴板
  takePhoto,     // 拍照
  pickImage,     // 选图
  audioRecord,   // 录音
  audioPlay,     // 音频播放
  payment,       // 支付
  userInfo,      // 用户信息（脱敏）
  deviceInfo,    // 设备信息
  vibration,     // 震动反馈
  toast,         // 轻提示
  download,      // 下载文件
  openExternal,  // 打开外部浏览器
}

/// Action 处理器接口
abstract class BridgeActionHandler {
  String get action;
  Set<NativeCapability> get requiredCapabilities;
  Future<JSBridgeResponse> handle(JSBridgeMessage message);
}

/// JSBridge 消息分发器
class JSBridgeDispatcher {
  static final JSBridgeDispatcher _instance = JSBridgeDispatcher._();
  factory JSBridgeDispatcher() => _instance;
  JSBridgeDispatcher._();

  final Map<String, BridgeActionHandler> _handlers = {};

  /// 当前页面的授权能力范围
  final Map<String, Set<NativeCapability>> _pageCapabilities = {};

  void registerHandler(BridgeActionHandler handler) {
    _handlers[handler.action] = handler;
  }

  /// 设置页面授权能力
  void setPageCapabilities(String trackId, Set<NativeCapability> caps) {
    _pageCapabilities[trackId] = caps;
  }

  /// 分发 H5 消息
  Future<JSBridgeResponse> dispatch(
    String trackId,
    JSBridgeMessage message,
  ) async {
    // 1. 查找 handler
    final handler = _handlers[message.action];
    if (handler == null) {
      return JSBridgeResponse(
        msgId: message.msgId,
        success: false,
        errorCode: 'UNKNOWN_ACTION',
        errorMessage: '未知的 action: ${message.action}',
      );
    }

    // 2. 权限校验
    final allowedCaps = _pageCapabilities[trackId] ?? {};
    if (!handler.requiredCapabilities.every((c) => allowedCaps.contains(c))) {
      _securityLog('CAPABILITY_DENIED', trackId, message.action);
      return JSBridgeResponse(
        msgId: message.msgId,
        success: false,
        errorCode: 'CAPABILITY_DENIED',
        errorMessage: '当前页面无权调用: ${message.action}',
      );
    }

    // 3. 频率限制
    if (_isRateLimited(trackId, message.action)) {
      return JSBridgeResponse(
        msgId: message.msgId,
        success: false,
        errorCode: 'RATE_LIMITED',
        errorMessage: '调用频率过高，请稍后再试',
      );
    }

    // 4. 执行
    try {
      return await handler.handle(message);
    } catch (e, stack) {
      _logError(trackId, message.action, e, stack);
      return JSBridgeResponse(
        msgId: message.msgId,
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: '内部错误',
      );
    }
  }

  /// 简单频率限制：每 trackId + action，1 秒内最多 10 次
  final Map<String, List<int>> _callTimestamps = {};

  bool _isRateLimited(String trackId, String action) {
    final key = '$trackId:$action';
    final now = DateTime.now().millisecondsSinceEpoch;
    final timestamps = _callTimestamps[key] ??= [];
    timestamps.removeWhere((t) => now - t > 1000);
    if (timestamps.length >= 10) return true;
    timestamps.add(now);
    return false;
  }
}
```

### 3.5 具体 Action Handler 示例

```dart
/// lib/hybrid/jsbridge/handlers/share_handler.dart

class ShareHandler implements BridgeActionHandler {
  @override
  String get action => 'share';

  @override
  Set<NativeCapability> get requiredCapabilities => {NativeCapability.share};

  @override
  Future<JSBridgeResponse> handle(JSBridgeMessage message) async {
    final params = message.params;
    final type = params['type'] as String? ?? 'text'; // text | image | url
    final title = params['title'] as String?;
    final content = params['content'] as String?;
    final imageUrl = params['imageUrl'] as String?;
    final url = params['url'] as String?;

    // 调用客户端分享服务
    final result = await ShareService().share(ShareRequest(
      type: type,
      title: title ?? '',
      content: content ?? '',
      imageUrl: imageUrl,
      url: url,
      source: 'h5',
    ));

    return JSBridgeResponse(
      msgId: message.msgId,
      success: result.success,
      data: {
        'platform': result.platform,
        'shared': result.success,
      },
    );
  }
}

/// lib/hybrid/jsbridge/handlers/user_info_handler.dart

class UserInfoHandler implements BridgeActionHandler {
  @override
  String get action => 'getUserInfo';

  @override
  Set<NativeCapability> get requiredCapabilities => {NativeCapability.userInfo};

  @override
  Future<JSBridgeResponse> handle(JSBridgeMessage message) async {
    final user = await AuthService().currentUser;
    if (user == null) {
      return JSBridgeResponse(
        msgId: message.msgId,
        success: false,
        errorCode: 'NOT_LOGGED_IN',
        errorMessage: '用户未登录',
      );
    }

    // 只返回脱敏信息
    return JSBridgeResponse(
      msgId: message.msgId,
      success: true,
      data: {
        'userId': user.id,
        'nickname': user.nickname,
        'stage': user.stage,         // 学段
        'grade': user.grade,         // 年级
        'isVip': user.isVip,         // 是否会员
        'vipExpireDate': user.vipExpireDate?.toIso8601String(),
        // 注意：不返回手机号、真实姓名等敏感信息
      },
    );
  }
}

/// lib/hybrid/jsbridge/handlers/take_photo_handler.dart

class TakePhotoHandler implements BridgeActionHandler {
  @override
  String get action => 'takePhoto';

  @override
  Set<NativeCapability> get requiredCapabilities => {NativeCapability.takePhoto};

  @override
  Future<JSBridgeResponse> handle(JSBridgeMessage message) async {
    final quality = (message.params['quality'] as num?)?.toDouble() ?? 0.8;
    final maxWidth = (message.params['maxWidth'] as num?)?.toInt() ?? 1920;

    final image = await ImagePicker().pickImage(
      source: ImageSource.camera,
      maxWidth: maxWidth.toDouble(),
      imageQuality: (quality * 100).toInt(),
    );

    if (image == null) {
      return JSBridgeResponse(
        msgId: message.msgId,
        success: false,
        errorCode: 'CANCELLED',
        errorMessage: '用户取消拍照',
      );
    }

    // 上传图片获取 URL
    final url = await FileUploadService().upload(image);

    return JSBridgeResponse(
      msgId: message.msgId,
      success: true,
      data: {
        'url': url,
        'localPath': image.path,
        'size': await image.length(),
      },
    );
  }
}
```

### 3.6 Action 注册表

在应用启动时统一注册：

```dart
/// lib/hybrid/jsbridge/bridge_setup.dart

void setupJSBridge() {
  final dispatcher = JSBridgeDispatcher();

  // 注册所有 Action Handler
  dispatcher.registerHandler(NavigationHandler());     // navigate
  dispatcher.registerHandler(BackHandler());           // goBack
  dispatcher.registerHandler(ShareHandler());          // share
  dispatcher.registerHandler(ClipboardHandler());      // setClipboard
  dispatcher.registerHandler(TakePhotoHandler());      // takePhoto
  dispatcher.registerHandler(PickImageHandler());      // pickImage
  dispatcher.registerHandler(AudioRecordHandler());    // startRecord / stopRecord
  dispatcher.registerHandler(AudioPlayHandler());      // playAudio / stopAudio
  dispatcher.registerHandler(PaymentHandler());        // pay
  dispatcher.registerHandler(UserInfoHandler());       // getUserInfo
  dispatcher.registerHandler(DeviceInfoHandler());     // getDeviceInfo
  dispatcher.registerHandler(ToastHandler());          // showToast
  dispatcher.registerHandler(VibrationHandler());      // vibrate
  dispatcher.registerHandler(DownloadHandler());       // downloadFile
  dispatcher.registerHandler(OpenExternalHandler());   // openExternalBrowser
  dispatcher.registerHandler(GetLocationHandler());    // getLocation (需授权)
  dispatcher.registerHandler(ContactSupportHandler()); // contactSupport
}
```

### 3.7 完整 Action 列表

| Action | 能力 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- | --- |
| `navigate` | navigation | `{path, params?, replace?}` | `{success}` | 跳转 Native 页面 |
| `goBack` | navigation | `{}` | `{success}` | 返回上一页 |
| `share` | share | `{type, title?, content?, imageUrl?, url?}` | `{platform, shared}` | 调用分享 |
| `setClipboard` | clipboard | `{text}` | `{success}` | 复制到剪贴板 |
| `takePhoto` | takePhoto | `{quality?, maxWidth?}` | `{url, localPath, size}` | 拍照并上传 |
| `pickImage` | pickImage | `{maxCount?}` | `{images: [{url, localPath}]}` | 从相册选取 |
| `startRecord` | audioRecord | `{maxDuration?}` | `{recordingId}` | 开始录音 |
| `stopRecord` | audioRecord | `{recordingId}` | `{url, duration}` | 停止录音 |
| `playAudio` | audioPlay | `{url, autoplay?}` | `{playing}` | 播放音频 |
| `pay` | payment | `{planId, channel?}` | `{orderId, status}` | 发起支付 |
| `getUserInfo` | userInfo | `{}` | `{userId, nickname, stage, ...}` | 获取脱敏用户信息 |
| `getDeviceInfo` | deviceInfo | `{}` | `{os, model, appVersion, ...}` | 获取设备信息 |
| `showToast` | toast | `{message, duration?, type?}` | `{success}` | 显示轻提示 |
| `vibrate` | vibration | `{type: light|medium|heavy}` | `{success}` | 触觉反馈 |
| `downloadFile` | download | `{url, filename?}` | `{localPath}` | 下载文件到本地 |
| `openExternalBrowser` | openExternal | `{url}` | `{success}` | 打开外部浏览器 |
| `getLocation` | location | `{}` | `{lat, lng, address?}` | 获取定位（需授权） |
| `contactSupport` | navigation | `{category?, screenshot?}` | `{success}` | 联系客服 |

---

## 4. 安全管控体系

### 4.1 域名白名单

```dart
/// lib/hybrid/security/domain_whitelist.dart

class DomainWhitelist {
  /// 白名单域名配置（从服务端动态下发 + 本地硬编码兜底）
  static final Set<String> _hardcodedWhitelist = {
    // 主站
    'app.primetop.edu.cn',
    'h5.primetop.edu.cn',
    // CDN
    'cdn.primetop.edu.cn',
    'static.primetop.edu.cn',
    // 协议页面
    'legal.primetop.edu.cn',
    // 学情报告
    'report.primetop.edu.cn',
    // 运营活动
    'promo.primetop.edu.cn',
  };

  /// 动态白名单（从配置中心下发，定期刷新）
  static Set<String> _dynamicWhitelist = {};

  /// 初始化：从配置中心加载动态白名单
  static Future<void> init() async {
    try {
      final config = await ConfigCenter.get('h5_domain_whitelist');
      _dynamicWhitelist = (config as List?)?.cast<String>().toSet() ?? {};
    } catch (e) {
      // 降级：只使用硬编码白名单
    }
  }

  static bool isAllowed(String host) {
    return _hardcodedWhitelist.contains(host) ||
        _dynamicWhitelist.contains(host);
  }

  /// 检查 URL 是否在白名单内
  static bool isUrlAllowed(String url) {
    try {
      final uri = Uri.parse(url);
      return isAllowed(uri.host);
    } catch (_) {
      return false;
    }
  }
}
```

### 4.2 JS 注入安全防护

```dart
/// lib/hybrid/security/security_interceptor.dart

class SecurityInterceptor {
  /// 注入到 WebView 的安全脚本
  static const String _securityScript = '''
    // 1. 禁用 eval 和 Function 构造器（生产环境）
    // 注意：不直接覆盖 eval，因为部分合法库依赖它
    // 改为在 CSP 中限制

    // 2. 拦截可疑的 window.open / location 修改
    (function() {
      const originalOpen = window.open;
      window.open = function(url) {
        // 只允许白名单域名
        if (url && !url.startsWith('primetop://')) {
          PrimeTopBridge.call('openExternalBrowser', { url: url });
          return null;
        }
        return originalOpen.apply(this, arguments);
      };
    })();

    // 3. 拦截 XSS 向量
    document.addEventListener('DOMContentLoaded', function() {
      // 移除所有 inline event handlers
      const allElements = document.querySelectorAll('*');
      allElements.forEach(function(el) {
        const attrs = el.attributes;
        for (let i = attrs.length - 1; i >= 0; i--) {
          if (attrs[i].name.startsWith('on')) {
            el.removeAttribute(attrs[i].name);
          }
        }
      });
    });
  ''';

  static String get securityScript => _securityScript;

  /// 检测 URL 是否包含可疑参数
  static bool hasSuspiciousParams(String url) {
    final uri = Uri.tryParse(url);
    if (uri == null) return true;
    final params = uri.queryParameters;
    for (final entry in params.entries) {
      final value = entry.value.toLowerCase();
      if (value.contains('<script') ||
          value.contains('javascript:') ||
          value.contains('onerror=') ||
          value.contains('onload=')) {
        return true;
      }
    }
    return false;
  }
}
```

### 4.3 CSP（内容安全策略）响应头

服务端返回 H5 页面时必须携带 CSP 头：

```http
Content-Security-Policy: 
  default-src 'self';
  script-src 'self' https://cdn.primetop.edu.cn;
  style-src 'self' 'unsafe-inline' https://cdn.primetop.edu.cn;
  img-src 'self' data: https://cdn.primetop.edu.cn https://static.primetop.edu.cn;
  font-src 'self' https://cdn.primetop.edu.cn;
  connect-src 'self' https://api.primetop.edu.cn;
  frame-src 'none';
  object-src 'none';
  base-uri 'self';
```

---

## 5. 离线资源包管理

### 5.1 设计思路

核心 H5 页面（协议、帮助、基础教材内容）打包为离线资源包，客户端预下载后本地加载，消除网络延迟。

```
┌──────────────────────────────────────────────┐
│              离线资源包生命周期                 │
│                                              │
│  生成(CI) → 上传(CDN) → 下载(客户端)         │
│  → 解压(沙箱) → 校验(hash) → 注册(路由表)   │
│  → 增量更新 → 过期清理                       │
└──────────────────────────────────────────────┘
```

### 5.2 资源包格式

```json
// 资源包元数据 manifest.json
{
  "packageId": "legal-pages-v3",
  "version": "3.2.0",
  "minAppVersion": "1.0.0",
  "maxAppVersion": null,
  "files": [
    {
      "path": "privacy.html",
      "hash": "sha256:abc123...",
      "size": 15360
    },
    {
      "path": "terms.html",
      "hash": "sha256:def456...",
      "size": 12800
    },
    {
      "path": "children_protection.html",
      "hash": "sha256:789ghi...",
      "size": 10240
    }
  ],
  "routes": {
    "/legal/privacy": "privacy.html",
    "/legal/terms": "terms.html",
    "/legal/children": "children_protection.html"
  },
  "totalSize": 38400,
  "packageHash": "sha256:jkl012...",
  "createdAt": "2026-05-01T00:00:00Z"
}
```

### 5.3 离线资源管理器

```dart
/// lib/hybrid/offline/resource_manager.dart

class OfflineResourceManager {
  static final OfflineResourceManager _instance = OfflineResourceManager._();
  factory OfflineResourceManager() => _instance;
  OfflineResourceManager._();

  /// 资源包存储目录
  static const String _baseDir = 'hybrid_packages';

  /// 路由表：virtualPath → 本地文件路径
  final Map<String, String> _routeMap = {};

  /// 初始化：加载已有资源包的路由表
  Future<void> init() async {
    final dir = await _getPackageDir();
    if (!await dir.exists()) return;

    // 遍历所有资源包目录
    await for (final entity in dir.list()) {
      if (entity is Directory) {
        final manifestFile = File('${entity.path}/manifest.json');
        if (await manifestFile.exists()) {
          final manifest = jsonDecode(await manifestFile.readAsString());
          _registerRoutes(entity.path, manifest);
        }
      }
    }
  }

  /// 解析 URL：优先返回本地离线路径，否则返回原 URL
  Future<String> resolveUrl(String url) async {
    final uri = Uri.parse(url);
    final path = uri.path;

    if (_routeMap.containsKey(path)) {
      // 检查文件是否存在
      final localPath = _routeMap[path]!;
      if (await File(localPath).exists()) {
        return 'file://$localPath';
      }
    }

    return url;
  }

  /// 注册路由
  void _registerRoutes(String packageDir, Map<String, dynamic> manifest) {
    final routes = manifest['routes'] as Map<String, dynamic>;
    routes.forEach((virtualPath, relativePath) {
      _routeMap[virtualPath] = '$packageDir/$relativePath';
    });
  }

  /// 下载/更新资源包
  Future<void> downloadPackage({
    required String packageId,
    required String downloadUrl,
    String? version,
  }) async {
    final dir = await _getPackageDir();
    final packageDir = Directory('${dir.path}/$packageId');

    // 1. 下载 ZIP
    final zipPath = '${dir.path}/$packageId.zip';
    await _downloadFile(downloadUrl, zipPath);

    // 2. 校验 ZIP hash
    // ... (省略校验逻辑)

    // 3. 解压到临时目录
    final tempDir = await Directory('${dir.path}/tmp_$packageId').create();
    await _unzip(zipPath, tempDir.path);

    // 4. 校验 manifest 中每个文件的 hash
    final manifest = jsonDecode(
      await File('${tempDir.path}/manifest.json').readAsString(),
    );
    await _verifyFileHashes(tempDir.path, manifest);

    // 5. 原子替换：删除旧包，重命名临时目录
    if (await packageDir.exists()) {
      await packageDir.rename('${packageDir.path}.bak');
    }
    await tempDir.rename(packageDir.path);

    // 6. 注册路由
    _registerRoutes(packageDir.path, manifest);

    // 7. 清理
    await File(zipPath).delete();
    final bakDir = Directory('${packageDir.path}.bak');
    if (await bakDir.exists()) {
      await bakDir.delete(recursive: true);
    }
  }

  /// 清理过期资源包
  Future<void> cleanup() async {
    // 清理超过 30 天未使用的包
    // 清理超过 2 个版本的旧包
  }
}
```

### 5.4 资源包下发 API

```
GET /api/v1/hybrid/packages?currentVersions={packageId:version,...}
```

响应：

```json
{
  "packages": [
    {
      "packageId": "legal-pages-v3",
      "version": "3.2.0",
      "downloadUrl": "https://cdn.primetop.edu.cn/packages/legal-pages-v3-3.2.0.zip",
      "packageHash": "sha256:jkl012...",
      "totalSize": 38400,
      "forceUpdate": false
    }
  ],
  "deleted": ["old-package-id"]
}
```

---

## 6. 性能监控

### 6.1 页面加载指标

```dart
/// lib/hybrid/performance/webview_metrics.dart

class WebViewLoadMetrics {
  final String url;
  final String trackId;

  /// WebView 实例获取耗时（ms）
  int? acquireDuration;

  /// 页面开始加载到 DOMContentLoaded 的时间（ms）
  int? domContentLoadedTime;

  /// 页面开始加载到 load 事件的时间（ms）
  int? pageLoadTime;

  /// 首屏可交互时间（ms）—— 由 H5 页面上报
  int? firstInteractiveTime;

  /// 是否命中离线缓存
  bool hitOfflineCache = false;

  /// 页面大小（bytes）
  int? pageSize;

  /// JS Bridge 调用次数
  int bridgeCallCount = 0;

  /// JS Bridge 调用总耗时（ms）
  int bridgeTotalDuration = 0;

  /// 资源加载失败数
  int resourceErrorCount = 0;

  Map<String, dynamic> toAnalytics() => {
        'url': url,
        'acquire_ms': acquireDuration,
        'dom_content_loaded_ms': domContentLoadedTime,
        'page_load_ms': pageLoadTime,
        'first_interactive_ms': firstInteractiveTime,
        'offline_hit': hitOfflineCache,
        'page_size': pageSize,
        'bridge_calls': bridgeCallCount,
        'bridge_duration_ms': bridgeTotalDuration,
        'resource_errors': resourceErrorCount,
      };
}
```

### 6.2 H5 页面性能上报协议

H5 页面需在加载完成后上报性能数据：

```javascript
// H5 页面中调用
window.PrimeTopBridge.call('reportMetrics', {
  domContentLoaded: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart,
  pageLoad: performance.timing.loadEventEnd - performance.timing.navigationStart,
  firstInteractive: window.__FIRST_INTERACTIVE_TIME__ || null, // 由页面代码手动标记
  resources: performance.getEntriesByType('resource').map(r => ({
    name: r.name,
    duration: r.duration,
    transferSize: r.transferSize,
    failed: r.transferSize === 0 && r.duration > 0,
  })),
}).catch(() => {}); // 静默失败
```

---

## 7. H5 页面路由管理

### 7.1 路由注册表

```dart
/// lib/hybrid/routing/hybrid_routes.dart

class HybridRoutes {
  /// 已注册的 H5 路由
  static const Map<String, HybridRouteConfig> routes = {
    // ── 协议与政策 ──
    '/legal/privacy': HybridRouteConfig(
      url: 'https://legal.primetop.edu.cn/privacy',
      title: '隐私政策',
      offlinePackage: 'legal-pages-v3',
      capabilities: {NativeCapability.clipboard},
    ),
    '/legal/terms': HybridRouteConfig(
      url: 'https://legal.primetop.edu.cn/terms',
      title: '用户协议',
      offlinePackage: 'legal-pages-v3',
      capabilities: {NativeCapability.clipboard},
    ),
    '/legal/children': HybridRouteConfig(
      url: 'https://legal.primetop.edu.cn/children',
      title: '儿童个人信息保护规则',
      offlinePackage: 'legal-pages-v3',
      capabilities: {NativeCapability.clipboard},
    ),

    // ── 运营活动 ──
    '/promo/:id': HybridRouteConfig(
      url: 'https://promo.primetop.edu.cn/activity/{id}',
      title: '', // 动态获取
      capabilities: {
        NativeCapability.share,
        NativeCapability.payment,
        NativeCapability.clipboard,
      },
    ),

    // ── 学情报告 ──
    '/report/weekly/:id': HybridRouteConfig(
      url: 'https://report.primetop.edu.cn/weekly/{id}',
      title: '周学习报告',
      capabilities: {
        NativeCapability.share,
        NativeCapability.clipboard,
        NativeCapability.download,
      },
    ),

    // ── 教材内容 ──
    '/content/chapter/:chapterId': HybridRouteConfig(
      url: 'https://h5.primetop.edu.cn/chapter/{chapterId}',
      title: '',
      capabilities: {
        NativeCapability.audioPlay,
        NativeCapability.clipboard,
      },
    ),

    // ── 帮助中心 ──
    '/help': HybridRouteConfig(
      url: 'https://h5.primetop.edu.cn/help',
      title: '帮助中心',
      offlinePackage: 'help-pages-v1',
      capabilities: {
        NativeCapability.clipboard,
        NativeCapability.contactSupport,
      },
    ),
  };

  /// 根据路径匹配路由配置
  static HybridRouteConfig? match(String path) {
    for (final entry in routes.entries) {
      if (_pathMatch(entry.key, path)) {
        return entry.value;
      }
    }
    return null;
  }

  /// 支持简单路径参数匹配（如 /promo/:id 匹配 /promo/abc123）
  static bool _pathMatch(String pattern, String path) {
    final patternParts = pattern.split('/');
    final pathParts = path.split('/');
    if (patternParts.length != pathParts.length) return false;
    for (int i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) continue;
      if (patternParts[i] != pathParts[i]) return false;
    }
    return true;
  }
}

class HybridRouteConfig {
  final String url;
  final String title;
  final String? offlinePackage;
  final Set<NativeCapability> capabilities;

  const HybridRouteConfig({
    required this.url,
    required this.title,
    this.offlinePackage,
    required this.capabilities,
  });
}
```

### 7.2 与 GoRouter 集成

```dart
/// lib/hybrid/routing/hybrid_router_delegate.dart

// 在 GoRouter 中注册 H5 路由
GoRoute(
  path: '/legal/privacy',
  builder: (context, state) => HybridWebView(
    url: 'https://legal.primetop.edu.cn/privacy',
    title: '隐私政策',
    allowedCapabilities: {NativeCapability.clipboard},
  ),
),
GoRoute(
  path: '/legal/terms',
  builder: (context, state) => HybridWebView(
    url: 'https://legal.primetop.edu.cn/terms',
    title: '用户协议',
    allowedCapabilities: {NativeCapability.clipboard},
  ),
),
GoRoute(
  path: '/promo/:id',
  builder: (context, state) {
    final id = state.pathParameters['id']!;
    return HybridWebView(
      url: 'https://promo.primetop.edu.cn/activity/$id',
      allowedCapabilities: {
        NativeCapability.share,
        NativeCapability.payment,
        NativeCapability.clipboard,
      },
    );
  },
),
// ... 其他 H5 路由
```

---

## 8. 分龄适配策略

### 8.1 WebView 容器分龄差异

| 维度 | 幼儿(3-6) | 小学(6-12) | 初中(12-15) | 高中(15-18) |
| --- | --- | --- | --- | --- |
| 字体缩放 | 1.2x | 1.1x | 1.0x | 1.0x |
| H5 交互复杂度 | 极简(点击为主) | 简单(拖拽可选) | 中等 | 中等偏高 |
| 分享能力 | 隐藏 | 需家长确认 | 可用 | 可用 |
| 外部链接 | 全部拦截 | 需确认弹窗 | 可用 | 可用 |
| 下载能力 | 隐藏 | 隐藏 | 可用 | 可用 |
| 支付能力 | 不可用 | 需家长密码 | 需密码 | 可用 |

### 8.2 分龄参数注入

```dart
/// lib/hybrid/age_adapter.dart

class HybridAgeAdapter {
  /// 生成分龄注入脚本
  static String buildAgeScript(String stage) {
    final config = _ageConfigs[stage] ?? _ageConfigs['middle']!;

    return '''
      window.__PRIMETOP_AGE_CONFIG__ = ${jsonEncode(config)};
      
      // 动态调整根字体大小
      document.documentElement.style.fontSize = '${config['baseFontSize']}';
      
      // 禁用不符合年龄的交互
      ${config['disableExternalLinks'] ? '''
        document.querySelectorAll('a[target="_blank"]').forEach(function(a) {
          a.addEventListener('click', function(e) {
            e.preventDefault();
            PrimeTopBridge.call('showToast', { 
              message: '当前模式下无法打开外部链接' 
            });
          });
        });
      ''' : ''}
    ''';
  }

  static const Map<String, Map<String, dynamic>> _ageConfigs = {
    'kindergarten': {
      'stage': 'kindergarten',
      'baseFontSize': '19.2px',   // 16 * 1.2
      'disableExternalLinks': true,
      'disableShare': true,
      'disableDownload': true,
      'disablePayment': true,
      'interactionLevel': 'simple',
      'rewardFeedbackLevel': 5,
    },
    'primary': {
      'stage': 'primary',
      'baseFontSize': '17.6px',   // 16 * 1.1
      'disableExternalLinks': false,
      'disableShare': false,
      'shareNeedParentConfirm': true,
      'disableDownload': true,
      'disablePayment': true,
      'interactionLevel': 'moderate',
      'rewardFeedbackLevel': 4,
    },
    'middle': {
      'stage': 'middle',
      'baseFontSize': '16px',     // 16 * 1.0
      'disableExternalLinks': false,
      'disableShare': false,
      'disableDownload': false,
      'paymentNeedPassword': true,
      'interactionLevel': 'normal',
      'rewardFeedbackLevel': 2,
    },
    'senior': {
      'stage': 'senior',
      'baseFontSize': '16px',
      'disableExternalLinks': false,
      'disableShare': false,
      'disableDownload': false,
      'disablePayment': false,
      'interactionLevel': 'advanced',
      'rewardFeedbackLevel': 1,
    },
  };
}
```

---

## 9. 完整加载流程

### 9.1 页面打开时序

```
用户点击 → GoRouter 路由匹配 → HybridRouteConfig 解析
                                        │
                                    ┌────▼────┐
                                    │ URL 解析 │
                                    └────┬────┘
                                         │
                              ┌──────────▼──────────┐
                              │ 离线资源查找         │
                              │ OfflineResourceManager│
                              │ .resolveUrl(url)     │
                              └──────────┬──────────┘
                                    ┌────┴────┐
                              命中  │         │ 未命中
                              ┌─────▼──┐ ┌───▼──────┐
                              │file:// │ │https://  │
                              │本地路径 │ │在线 URL  │
                              └────┬───┘ └────┬─────┘
                                   │          │
                              ┌────▼──────────▼────┐
                              │ WebViewPool.acquire │
                              │ 获取/创建实例       │
                              └─────────┬──────────┘
                                        │
                              ┌─────────▼──────────┐
                              │ 注入安全脚本        │
                              │ 注入 JSBridge SDK   │
                              │ 注入分龄配置        │
                              └─────────┬──────────┘
                                        │
                              ┌─────────▼──────────┐
                              │ 加载 URL            │
                              │ controller.loadUrl  │
                              └─────────┬──────────┘
                                        │
                              ┌─────────▼──────────┐
                              │ onPageFinished      │
                              │ 上报加载指标        │
                              └────────────────────┘
```

### 9.2 JSBridge 调用流程

```
H5 页面:
  PrimeTopBridge.call('share', { type: 'text', content: '...' })
       │
       ▼
  JSON.stringify(message) → postMessage to Native channel
       │
       ▼
Native JSBridgeDispatcher.dispatch(trackId, message)
       │
       ├── 1. 查找 ActionHandler
       ├── 2. 权限校验 (allowedCapabilities)
       ├── 3. 频率限制检查
       ├── 4. 执行 handler.handle(message)
       │
       ▼
  ShareHandler.handle() → ShareService.share() → 返回结果
       │
       ▼
  JSBridgeResponse → controller.runJavaScript('PrimeTopBridge._onResponse(...)')
       │
       ▼
H5 页面 Promise resolve(data)
```

---

## 10. 错误处理与降级策略

### 10.1 错误码体系

| 错误码 | HTTP | 说明 | 客户端处理 |
| --- | --- | --- | --- |
| `HYBRID_001` | — | URL 格式无效 | 显示错误页面 |
| `HYBRID_002` | — | 域名不在白名单 | 拦截，不上报 |
| `HYBRID_003` | — | 页面加载超时 | 显示重试页面 |
| `HYBRID_004` | — | 网络不可用 | 尝试离线缓存，否则提示 |
| `HYBRID_005` | — | JSBridge action 未知 | 返回错误给 H5 |
| `HYBRID_006` | — | 权限不足 | 返回 CAPABILITY_DENIED |
| `HYBRID_007` | — | JSBridge 调用超时 | 返回超时错误 |
| `HYBRID_008` | — | 离线资源包校验失败 | 回退到在线加载 |
| `HYBRID_009` | — | WebView 崩溃 | 自动重建实例 |

### 10.2 降级层级

```
Level 0 (正常)  → 在线加载 + 完整 JSBridge
Level 1 (网络差) → 离线缓存命中 → 本地加载，部分 JSBridge 降级
Level 2 (完全离线) → 离线缓存 → 静态内容展示，禁用交互功能
Level 3 (资源损坏) → 显示"内容暂不可用"页面 + 重试按钮
```

### 10.3 WebView 崩溃恢复

```dart
/// lib/hybrid/webview_crash_recovery.dart

class WebViewCrashRecovery {
  int _crashCount = 0;
  static const int maxCrashRetry = 2;

  Future<void> handleCrash(String trackId, String url) async {
    _crashCount++;

    if (_crashCount > maxCrashRetry) {
      // 超过最大重试次数，上报异常
      AnalyticsService.trackEvent('webview_crash_exhausted', {
        'url': url,
        'crashCount': _crashCount,
      });

      // 显示降级 UI
      _showFallbackUI(trackId);
      return;
    }

    // 重建 WebView 实例
    WebViewPool().release(trackId);
    final newController = await WebViewPool().acquire(trackId: trackId);
    await newController.loadRequest(LoadRequestParams(uri: Uri.parse(url)));
  }

  void _showFallbackUI(String trackId) {
    // 通知 UI 层显示降级页面
    EventBus.emit('webview_fallback', {'trackId': trackId});
  }
}
```

---

## 11. 测试策略

### 11.1 单元测试

| 测试项 | 测试内容 | 工具 |
| --- | --- | --- |
| DomainWhitelist | 白名单匹配逻辑 | flutter_test |
| JSBridgeDispatcher | 消息分发、权限校验、频率限制 | flutter_test + mock |
| HybridRoutes | 路径匹配（含参数路由） | flutter_test |
| OfflineResourceManager | 路由表注册、URL 解析 | flutter_test + mock FS |
| SecurityInterceptor | XSS 检测、参数安全检查 | flutter_test |
| HybridAgeAdapter | 分龄配置生成 | flutter_test |

### 11.2 集成测试

| 测试项 | 测试内容 |
| --- | ---|
| WebView 加载 | 完整页面加载流程（含离线缓存命中/未命中） |
| JSBridge 双向通信 | H5 → Native → H5 完整调用链 |
| 域名拦截 | 非白名单域名请求被正确拦截 |
| 资源包更新 | 下载、解压、校验、路由注册全流程 |
| 崩溃恢复 | 模拟 WebView 崩溃后自动重建 |

### 11.3 H5 页面 SDK 测试

```javascript
// h5-sdk/__tests__/bridge.test.js

describe('PrimeTopBridge', () => {
  beforeEach(() => {
    // Mock native channel
    window.__PRIMETOP_CHANNEL__ = {
      postMessage: jest.fn(),
    };
  });

  test('call() sends correct message format', async () => {
    const promise = PrimeTopBridge.call('getUserInfo');
    
    // 验证 postMessage 被调用
    expect(window.__PRIMETOP_CHANNEL__.postMessage).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(window.__PRIMETOP_CHANNEL__.postMessage.mock.calls[0][0]);
    expect(sent.action).toBe('getUserInfo');
    expect(sent.msgId).toBeDefined();
    
    // 模拟 Native 回调
    PrimeTopBridge._onResponse({
      msgId: sent.msgId,
      success: true,
      data: { userId: '123' },
    });
    
    const result = await promise;
    expect(result.userId).toBe('123');
  });

  test('on/off event listeners', () => {
    const handler = jest.fn();
    PrimeTopBridge.on('pageVisible', handler);
    
    PrimeTopBridge._onEvent({ event: 'pageVisible', data: { visible: true } });
    expect(handler).toHaveBeenCalledWith({ visible: true });
    
    PrimeTopBridge.off('pageVisible', handler);
    handler.mockClear();
    PrimeTopBridge._onEvent({ event: 'pageVisible', data: { visible: false } });
    expect(handler).not.toHaveBeenCalled();
  });
});
```

---

## 12. 文件结构

```
lib/
├── hybrid/
│   ├── webview_pool.dart                 # WebView 实例池
│   ├── hybrid_webview.dart               # 统一 WebView Widget
│   ├── jsbridge/
│   │   ├── protocol.dart                 # 消息格式定义
│   │   ├── dispatcher.dart               # 消息分发器
│   │   ├── bridge_setup.dart             # Action 注册入口
│   │   └── handlers/
│   │       ├── navigation_handler.dart
│   │       ├── share_handler.dart
│   │       ├── clipboard_handler.dart
│   │       ├── take_photo_handler.dart
│   │       ├── pick_image_handler.dart
│   │       ├── audio_handler.dart
│   │       ├── payment_handler.dart
│   │       ├── user_info_handler.dart
│   │       ├── device_info_handler.dart
│   │       ├── toast_handler.dart
│   │       └── download_handler.dart
│   ├── security/
│   │   ├── domain_whitelist.dart         # 域名白名单
│   │   ├── security_interceptor.dart     # JS 注入防护
│   │   └── capability_guard.dart         # 能力授权守卫
│   ├── offline/
│   │   └── resource_manager.dart         # 离线资源包管理
│   ├── routing/
│   │   ├── hybrid_routes.dart            # H5 路由注册表
│   │   └── hybrid_router_delegate.dart   # GoRouter 集成
│   ├── performance/
│   │   └── webview_metrics.dart          # 性能指标采集
│   ├── age_adapter.dart                  # 分龄适配
│   └── webview_crash_recovery.dart       # 崩溃恢复
│
h5-sdk/
├── src/
│   ├── primetop-bridge.js                # JSBridge SDK
│   ├── types.d.ts                        # TypeScript 类型定义
│   └── utils.js                          # 辅助工具
├── __tests__/
│   └── bridge.test.js
├── package.json
└── README.md
```

---

## 13. 开发排期

| 阶段 | 内容 | 工期 | 依赖 |
| --- | --- | --- | --- |
| P0-1 | WebView 容器池 + 基础加载 + 域名白名单 | 3d | 客户端架构 |
| P0-2 | JSBridge SDK + 核心Handler(导航/剪贴板/Toast) | 3d | P0-1 |
| P0-3 | 路由注册 + GoRouter 集成 + 协议页面 | 2d | P0-2 |
| P1-1 | 分享/拍照/用户信息等扩展 Handler | 3d | P0-2 |
| P1-2 | 离线资源包管理 | 3d | P0-1 |
| P1-3 | 分龄适配 + 安全加固 | 2d | P0-2 |
| P2-1 | 性能监控 + 崩溃恢复 | 2d | P0-3 |
| P2-2 | H5 SDK 完善 + 文档 | 2d | P1-1 |
| **合计** | | **20d** | |

---

## 14. 监控指标

| 指标 | 计算方式 | 目标 | 告警阈值 |
| --- | --- | --- | --- |
| WebView 获取耗时 | acquire_duration 均值 | < 50ms (池命中) | > 200ms |
| 页面加载时间 | page_load_time P95 | < 1500ms | > 3000ms |
| 离线命中率 | offline_hit / total_loads | > 80% (协议/帮助页) | < 50% |
| JSBridge 调用成功率 | success / total_calls | > 99% | < 95% |
| JSBridge 调用延迟 | handler 执行时间 P95 | < 200ms | > 500ms |
| 域名拦截次数 | blocked count / day | 监控趋势 | 突增 > 5x |
| WebView 崩溃率 | crash / total_sessions | < 0.1% | > 0.5% |
