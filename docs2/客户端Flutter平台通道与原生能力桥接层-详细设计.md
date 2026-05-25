# 客户端 Flutter 平台通道与原生能力桥接层 - 详细设计

## 1. 概述

### 1.1 设计目标

PrimeTop 作为一款 Flutter 跨平台教育应用，需要大量原生平台能力支撑：相机拍照搜题、语音录制与播放、本地推送通知、生物识别认证、文件系统访问、设备信息采集等。本文档定义 Flutter 端与原生平台（Android/iOS）之间的桥接架构，确保：

1. **统一抽象**：Flutter 层通过统一接口调用原生能力，无需关心平台差异
2. **安全可控**：所有原生调用经过权限校验、参数验证和异常兜底
3. **可测试性**：原生能力可 Mock 替换，支持单元测试和集成测试
4. **可扩展性**：新增原生能力遵循标准注册流程，零改动接入
5. **降级容错**：原生能力不可用时自动降级到 Dart 纯实现或友好提示

### 1.2 适用范围

覆盖所有需要与原生平台交互的场景：

| 能力域 | 典型场景 | 涉及模块 |
|--------|----------|----------|
| 相机与图片 | 拍照搜题、头像上传、图片裁剪 | 拍题答疑、个人中心 |
| 音频录制 | 语音提问、背诵检测、口语陪练 | AI辅导、文科背诵、英语专项 |
| 音频播放 | TTS朗读、播放题目音频 | AI辅导、同步课堂 |
| 本地通知 | 学习提醒、任务到期、家长消息 | 学习提醒、通知中心 |
| 生物识别 | 应用锁、家长验证 | 防沉迷、家长中心 |
| 文件系统 | 离线资源读写、导出文件、缓存清理 | 离线缓存、学习报告 |
| 设备信息 | 设备指纹、性能分级、网络状态 | 风控引擎、性能监控 |
| 剪贴板 | 复制题目文本、分享链接 | 分享系统 |
| 网络状态 | 弱网检测、离线判断 | 网络治理 |
| 屏幕亮度 | 护眼模式 | 护眼管理 |
| 应用商店 | 版本更新、评分引导 | 版本管理 |

### 1.3 设计原则

```
┌─────────────────────────────────────┐
│         Flutter 业务层              │
│  (AI辅导 / 拍题 / 背诵 / ...)      │
├─────────────────────────────────────┤
│      NativeCapability              │  ← 统一抽象层
│  (Riverpod Provider + Facade)      │
├─────────────────────────────────────┤
│   MethodChannel / EventChannel     │  ← 通信通道
├──────────┬──────────────────────────┤
│ Android  │         iOS              │  ← 原生实现
│ (Kotlin) │      (Swift)             │
└──────────┴──────────────────────────┘
```

---

## 2. 架构设计

### 2.1 分层架构

```dart
/// lib/native/ 架构分层
///
/// native/
/// ├── core/                          # 核心框架
/// │   ├── native_channel.dart        # 通道注册中心
/// │   ├── native_capability.dart     # 能力抽象基类
/// │   ├── native_result.dart         # 统一结果封装
/// │   └── native_registry.dart       # 能力注册表
/// ├── capabilities/                  # 各能力实现
│   ├── camera/
│   │   ├── camera_capability.dart
│   │   ├── camera_config.dart
│   │   └── camera_result.dart
│   ├── audio_recorder/
│   ├── audio_player/
│   ├── local_notification/
│   ├── biometric/
│   ├── file_system/
│   ├── device_info/
│   ├── clipboard/
│   ├── network/
│   ├── screen/
│   └── app_store/
/// ├── providers/                     # Riverpod Provider 集合
│   └── native_providers.dart
└── mock/                            # Mock 实现（测试用）
    ├── mock_camera.dart
    ├── mock_audio_recorder.dart
    └── ...
```

### 2.2 核心类型定义

```dart
/// lib/native/core/native_result.dart

/// 原生调用的统一结果封装
sealed class NativeResult<T> {
  const NativeResult();

  /// 成功
  const factory NativeResult.success(T data) = NativeSuccess<T>;

  /// 失败
  const factory NativeResult.failure(NativeError error) = NativeFailure<T>;

  /// 需要权限
  const factory NativeResult.permissionRequired(String permission) =
      NativePermissionRequired<T>;
}

class NativeSuccess<T> extends NativeResult<T> {
  final T data;
  const NativeSuccess(this.data);
}

class NativeFailure<T> extends NativeResult<T> {
  final NativeError error;
  const NativeFailure(this.error);
}

class NativePermissionRequired<T> extends NativeResult<T> {
  final String permission;
  const NativePermissionRequired(this.permission);
}

/// 原生错误类型
enum NativeErrorCode {
  /// 平台不支持该能力
  unsupportedPlatform,

  /// 原生插件未安装
  pluginNotFound,

  /// 权限被拒绝
  permissionDenied,

  /// 权限永久拒绝（需要去设置页开启）
  permissionPermanentlyDenied,

  /// 参数无效
  invalidArgument,

  /// 原生端执行异常
  executionError,

  /// 用户取消操作
  userCancelled,

  /// 超时
  timeout,

  /// 设备不支持（如无相机、无指纹传感器）
  hardwareUnavailable,

  /// 能力正在被占用
  capabilityBusy,

  /// 未知错误
  unknown,
}

class NativeError {
  final NativeErrorCode code;
  final String message;
  final String? nativeStackTrace;
  final Map<String, dynamic>? details;

  const NativeError({
    required this.code,
    required this.message,
    this.nativeStackTrace,
    this.details,
  });

  @override
  String toString() => 'NativeError($code): $message';
}
```

### 2.3 能力抽象基类

```dart
/// lib/native/core/native_capability.dart

/// 原生能力抽象基类
///
/// 所有原生能力都必须继承此基类，通过 [channel] 与原生端通信。
/// 子类需要实现 [name] 和 [isAvailable]。
abstract class NativeCapability {
  NativeCapability({required this.channel});

  /// MethodChannel 实例
  final MethodChannel channel;

  /// 能力唯一标识
  String get name;

  /// 能力描述（用于日志和降级提示）
  String get description;

  /// 检查当前平台是否支持该能力
  Future<bool> isAvailable();

  /// 检查该能力所需的权限是否已授权
  Future<PermissionStatus> checkPermission();

  /// 请求该能力所需的权限
  Future<PermissionStatus> requestPermission();

  /// 统一的 MethodChannel 调用封装
  ///
  /// 所有子类通过此方法调用原生功能，自动处理：
  /// - MissingPluginException → unsupportedPlatform
  /// - PlatformException → 对应 NativeErrorCode
  /// - 超时控制
  @protected
  Future<NativeResult<T>> invoke<T>(
    String method, {
    Map<String, dynamic>? arguments,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    try {
      final result = await channel
          .invokeMethod<T>(method, arguments)
          .timeout(timeout);
      return NativeResult.success(result as T);
    } on MissingPluginException {
      _log.warning('[$name] 插件未找到: $method');
      return NativeResult.failure(
        const NativeError(
          code: NativeErrorCode.pluginNotFound,
          message: '该功能在当前平台不可用',
        ),
      );
    } on PlatformException catch (e) {
      _log.warning('[$name] 平台异常: $method, code=${e.code}');
      return NativeResult.failure(
        NativeError(
          code: _mapPlatformException(e),
          message: e.message ?? '未知平台错误',
          nativeStackTrace: e.stacktrace,
          details: {
            'platformCode': e.code,
            if (e.details != null) 'platformDetails': e.details,
          },
        ),
      );
    } on TimeoutException {
      _log.warning('[$name] 调用超时: $method');
      return NativeResult.failure(
        NativeError(
          code: NativeErrorCode.timeout,
          message: '操作超时，请重试',
        ),
      );
    } catch (e, st) {
      _log.severe('[$name] 未知异常: $method', e, st);
      return NativeResult.failure(
        NativeError(
          code: NativeErrorCode.unknown,
          message: e.toString(),
        ),
      );
    }
  }

  /// 平台异常码映射
  NativeErrorCode _mapPlatformException(PlatformException e) {
    switch (e.code) {
      case 'PERMISSION_DENIED':
        return NativeErrorCode.permissionDenied;
      case 'PERMISSION_PERMANENTLY_DENIED':
        return NativeErrorCode.permissionPermanentlyDenied;
      case 'CAMERA_NOT_AVAILABLE':
      case 'BIOMETRIC_NOT_AVAILABLE':
      case 'MICROPHONE_NOT_AVAILABLE':
        return NativeErrorCode.hardwareUnavailable;
      case 'BUSY':
        return NativeErrorCode.capabilityBusy;
      case 'CANCELLED':
        return NativeErrorCode.userCancelled;
      case 'INVALID_ARGUMENT':
        return NativeErrorCode.invalidArgument;
      default:
        return NativeErrorCode.executionError;
    }
  }

  static final _log = Logger('NativeCapability');
}

/// 权限状态
enum PermissionStatus {
  /// 已授权
  granted,

  /// 已拒绝（可再次请求）
  denied,

  /// 永久拒绝（需前往设置）
  permanentlyDenied,

  /// 该权限对本平台不适用
  notApplicable,

  /// 受限状态（如家长控制）
  restricted,
}
```

### 2.4 能力注册表

```dart
/// lib/native/core/native_registry.dart

/// 原生能力注册表
///
/// 全局单例，管理所有已注册的 NativeCapability 实例。
/// 通过 Riverpod Provider 注入，避免全局可变状态。
class NativeRegistry {
  final Map<String, NativeCapability> _capabilities = {};

  /// 注册一个原生能力
  void register(NativeCapability capability) {
    if (_capabilities.containsKey(capability.name)) {
      throw StateError('原生能力已注册: ${capability.name}');
    }
    _capabilities[capability.name] = capability;
    _log.info('注册原生能力: ${capability.name} (${capability.description})');
  }

  /// 获取已注册的原生能力
  T get<T extends NativeCapability>(String name) {
    final cap = _capabilities[name];
    if (cap == null) {
      throw StateError('原生能力未注册: $name');
    }
    return cap as T;
  }

  /// 尝试获取（可能为 null）
  T? tryGet<T extends NativeCapability>(String name) {
    final cap = _capabilities[name];
    return cap != null ? cap as T : null;
  }

  /// 获取所有已注册的能力名称
  List<String> get registeredNames => _capabilities.keys.toList();

  static final _log = Logger('NativeRegistry');
}
```

---

## 3. 各能力详细设计

### 3.1 相机能力（CameraCapability）

#### 3.1.1 数据结构

```dart
/// lib/native/capabilities/camera/camera_config.dart

/// 相机配置
class CameraConfig {
  /// 目标分辨率（宽）
  final int targetWidth;

  /// 目标分辨率（高）
  final int targetHeight;

  /// 图片质量 (0-100)
  final int quality;

  /// 最大文件大小（字节），超过则压缩
  final int maxFileSizeBytes;

  /// 是否允许相册选择
  final bool allowGallery;

  /// 是否允许拍照
  final bool allowCamera;

  /// 裁剪配置
  final CropConfig? cropConfig;

  /// 相机方向
  final CameraLensDirection lensDirection;

  const CameraConfig({
    this.targetWidth = 1920,
    this.targetHeight = 1080,
    this.quality = 85,
    this.maxFileSizeBytes = 5 * 1024 * 1024, // 5MB
    this.allowGallery = true,
    this.allowCamera = true,
    this.cropConfig,
    this.lensDirection = CameraLensDirection.back,
  });

  /// 拍题专用配置
  static const question = CameraConfig(
    targetWidth: 2048,
    targetHeight: 2048,
    quality: 90,
    maxFileSizeBytes: 8 * 1024 * 1024,
    allowGallery: true,
    allowCamera: true,
    cropConfig: CropConfig(
      aspectRatio: CropAspectRatiRatio.free,
      maxResultWidth: 2048,
      maxResultHeight: 2048,
    ),
    lensDirection: CameraLensDirection.back,
  );

  /// 头像专用配置
  static const avatar = CameraConfig(
    targetWidth: 512,
    targetHeight: 512,
    quality: 80,
    maxFileSizeBytes: 2 * 1024 * 1024,
    allowGallery: true,
    allowCamera: true,
    cropConfig: CropConfig(
      aspectRatio: CropAspectRatio.square,
      maxResultWidth: 512,
      maxResultHeight: 512,
    ),
    lensDirection: CameraLensDirection.front,
  );
}

/// 裁剪配置
class CropConfig {
  final CropAspectRatio aspectRatio;
  final int maxResultWidth;
  final int maxResultHeight;

  const CropConfig({
    required this.aspectRatio,
    required this.maxResultWidth,
    required this.maxResultHeight,
  });
}

enum CropAspectRatio { square, free, ratio_3_4, ratio_4_3, ratio_16_9 }
enum CameraLensDirection { front, back }
```

```dart
/// lib/native/capabilities/camera/camera_result.dart

/// 拍照结果
class CameraResult {
  /// 图片本地路径
  final String filePath;

  /// 图片字节数据（可能为空，大图建议用 filePath）
  final Uint8List? bytes;

  /// 图片宽度
  final int width;

  /// 图片高度
  final int height;

  /// 文件大小（字节）
  final int fileSizeBytes;

  /// 来源
  final CameraResultSource source;

  /// 原始文件路径（裁剪前，可能为空）
  final String? originalFilePath;

  const CameraResult({
    required this.filePath,
    this.bytes,
    required this.width,
    required this.height,
    required this.fileSizeBytes,
    required this.source,
    this.originalFilePath,
  });

  /// 文件大小格式化
  String get formattedSize {
    if (fileSizeBytes < 1024) return '$fileSizeBytes B';
    if (fileSizeBytes < 1024 * 1024) {
      return '${(fileSizeBytes / 1024).toStringAsFixed(1)} KB';
    }
    return '${(fileSizeBytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}

enum CameraResultSource { camera, gallery }
```

#### 3.1.2 能力实现

```dart
/// lib/native/capabilities/camera/camera_capability.dart

class CameraCapability extends NativeCapability {
  CameraCapability()
      : super(channel: const MethodChannel('com.primetop.app/camera'));

  @override
  String get name => 'camera';

  @override
  String get description => '相机拍照与图片选择';

  @override
  Future<bool> isAvailable() async {
    // 检查平台是否支持相机
    if (!Platform.isAndroid && !Platform.isIOS) return false;
    try {
      return await invoke<bool>('isAvailable') then((r) => r.when(
            success: (data) => data,
            failure: (_) => false,
            permissionRequired: (_) => true, // 能力存在但需要权限
          ));
    } catch (_) {
      return false;
    }
  }

  @override
  Future<PermissionStatus> checkPermission() async {
    if (!Platform.isAndroid && !Platform.isIOS) {
      return PermissionStatus.notApplicable;
    }
    final cameraStatus = await Permission.camera.status;
    if (cameraStatus.isGranted) return PermissionStatus.granted;
    if (cameraStatus.isPermanentlyDenied) {
      return PermissionStatus.permanentlyDenied;
    }
    return PermissionStatus.denied;
  }

  @override
  Future<PermissionStatus> requestPermission() async {
    final status = await Permission.camera.request();
    return _mapPermissionStatus(status);
  }

  /// 打开相机/相册选择图片
  ///
  /// 返回 [CameraResult] 包含图片路径和信息。
  /// 调用前建议先调用 [checkPermission] 确保权限已授权。
  Future<NativeResult<CameraResult>> pickImage(
    CameraConfig config,
  ) async {
    // 1. 权限检查
    final permStatus = await checkPermission();
    if (permStatus != PermissionStatus.granted) {
      // 尝试请求
      final requested = await requestPermission();
      if (requested == PermissionStatus.permanentlyDenied) {
        return NativeResult.permissionRequired('camera');
      }
      if (requested != PermissionStatus.granted) {
        return NativeResult.failure(
          const NativeError(
            code: NativeErrorCode.permissionDenied,
            message: '相机权限被拒绝，无法拍照',
          ),
        );
      }
    }

    // 2. 如果允许相册，需要检查存储权限
    if (config.allowGallery && Platform.isAndroid) {
      final storageStatus = await Permission.photos.status;
      if (!storageStatus.isGranted) {
        final requested = await Permission.photos.request();
        if (!requested.isGranted) {
          // 相册权限被拒，降级为仅拍照模式
          config = CameraConfig(
            targetWidth: config.targetWidth,
            targetHeight: config.targetHeight,
            quality: config.quality,
            maxFileSizeBytes: config.maxFileSizeBytes,
            allowGallery: false,
            allowCamera: true,
            cropConfig: config.cropConfig,
            lensDirection: config.lensDirection,
          );
        }
      }
    }

    // 3. 调用原生相机
    final result = await invoke<Map>('pickImage', arguments: {
      'targetWidth': config.targetWidth,
      'targetHeight': config.targetHeight,
      'quality': config.quality,
      'maxFileSizeBytes': config.maxFileSizeBytes,
      'allowGallery': config.allowGallery,
      'allowCamera': config.allowCamera,
      'lensDirection': config.lensDirection.name,
      if (config.cropConfig != null) 'crop': {
        'aspectRatio': config.cropConfig!.aspectRatio.name,
        'maxResultWidth': config.cropConfig!.maxResultWidth,
        'maxResultHeight': config.cropConfig!.maxResultHeight,
      },
    });

    return result.when(
      success: (data) {
        final map = data as Map;
        return NativeResult.success(CameraResult(
          filePath: map['filePath'] as String,
          bytes: map['bytes'] as Uint8List?,
          width: map['width'] as int,
          height: map['height'] as int,
          fileSizeBytes: map['fileSizeBytes'] as int,
          source: CameraResultSource.values.firstWhere(
            (s) => s.name == map['source'],
          ),
          originalFilePath: map['originalFilePath'] as String?,
        ));
      },
      failure: (e) => NativeResult.failure(e),
      permissionRequired: (p) => NativeResult.permissionRequired(p),
    );
  }

  /// 清理临时文件
  Future<NativeResult<bool>> cleanup(String filePath) {
    return invoke<bool>('cleanup', arguments: {'filePath': filePath});
  }

  PermissionStatus _mapPermissionStatus(PermissionStatus_plugin status) {
    if (status.isGranted) return PermissionStatus.granted;
    if (status.isPermanentlyDenied) return PermissionStatus.permanentlyDenied;
    if (status.isRestricted) return PermissionStatus.restricted;
    return PermissionStatus.denied;
  }
}
```

#### 3.1.3 原生端实现（Android - Kotlin）

```kotlin
// android/app/src/main/kotlin/com/primetop/app/native/CameraHandler.kt

class CameraHandler(private val activity: FragmentActivity) : MethodCallHandler {

    private var pendingResult: MethodChannel.Result? = null
    private var tempFilePaths = mutableListOf<String>()

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "isAvailable" -> handleIsAvailable(result)
            "pickImage" -> handlePickImage(call, result)
            "cleanup" -> handleCleanup(call, result)
            else -> result.notImplemented()
        }
    }

    private fun handleIsAvailable(result: MethodChannel.Result) {
        val hasCamera = activity.packageManager
            .hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
        result.success(hasCamera)
    }

    private fun handlePickImage(call: MethodCall, result: MethodChannel.Result) {
        pendingResult = result

        val config = CameraPickerConfig(
            targetWidth = call.argument<Int>("targetWidth") ?: 1920,
            targetHeight = call.argument<Int>("targetHeight") ?: 1080,
            quality = call.argument<Int>("quality") ?: 85,
            maxFileSizeBytes = call.argument<Int>("maxFileSizeBytes")
                ?.toLong() ?: 5 * 1024 * 1024,
            allowGallery = call.argument<Boolean>("allowGallery") ?: true,
            allowCamera = call.argument<Boolean>("allowCamera") ?: true,
            lensDirection = call.argument<String>("lensDirection") ?: "back",
            cropConfig = parseCropConfig(call.argument<Map<String, Any>>("crop")),
        )

        // 使用 Activity Result API
        val intent = if (config.allowCamera && config.allowGallery) {
            // 创建选择器：相机 + 相册
            createPickerIntent(config)
        } else if (config.allowCamera) {
            createCameraIntent(config)
        } else {
            createGalleryIntent(config)
        }

        try {
            cameraLauncher.launch(intent)
        } catch (e: Exception) {
            pendingResult?.error(
                "CAMERA_ERROR",
                "无法启动相机: ${e.message}",
                null
            )
            pendingResult = null
        }
    }

    private fun createCameraIntent(config: CameraPickerConfig): Intent {
        val photoFile = createTempImageFile()
        tempFilePaths.add(photoFile.absolutePath)
        val uri = FileProvider.getUriForFile(
            activity,
            "${activity.packageName}.fileprovider",
            photoFile
        )
        return Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            if (config.lensDirection == "front") {
                putExtra("android.intent.extras.CAMERA_FACING", 1)
            }
        }
    }

    private fun createGalleryIntent(config: CameraPickerConfig): Intent {
        return Intent(Intent.ACTION_PICK).apply {
            type = "image/*"
        }
    }

    /// 处理相机/相册返回结果
    fun handleActivityResult(resultCode: Int, data: Intent?) {
        val result = pendingResult ?: return
        pendingResult = null

        if (resultCode != Activity.RESULT_OK) {
            result.error("CANCELLED", "用户取消操作", null)
            return
        }

        try {
            val imageUri = data?.data
                ?: Uri.fromFile(File(tempFilePaths.last()))

            // 1. 压缩到目标尺寸
            val compressed = compressImage(imageUri, config)

            // 2. 裁剪（如果需要）
            val finalImage = if (config.cropConfig != null) {
                cropImage(compressed, config.cropConfig)
            } else {
                compressed
            }

            // 3. 返回结果
            val bitmap = BitmapFactory.decodeFile(finalImage.absolutePath)
            result.success(mapOf(
                "filePath" to finalImage.absolutePath,
                "width" to bitmap.width,
                "height" to bitmap.height,
                "fileSizeBytes" to finalImage.length(),
                "source" to if (data?.data != null) "gallery" else "camera",
            ))
            bitmap.recycle()
        } catch (e: Exception) {
            result.error("CAMERA_ERROR", "图片处理失败: ${e.message}", null)
        }
    }

    private fun compressImage(uri: Uri, config: CameraPickerConfig): File {
        val inputStream = activity.contentResolver.openInputStream(uri)!!
        val bitmap = BitmapFactory.decodeStream(inputStream)
        inputStream.close()

        // 按目标尺寸缩放
        val scaled = scaleBitmap(bitmap, config.targetWidth, config.targetHeight)

        // 质量压缩
        val outputFile = createTempImageFile()
        FileOutputStream(outputFile).use { fos ->
            scaled.compress(Bitmap.CompressFormat.JPEG, config.quality, fos)
        }

        // 超过大小限制则降低质量重新压缩
        if (outputFile.length() > config.maxFileSizeBytes) {
            var quality = config.quality
            while (outputFile.length() > config.maxFileSizeBytes && quality > 20) {
                quality -= 10
                outputFile.writeBytes(byteArrayOf())
                FileOutputStream(outputFile).use { fos ->
                    scaled.compress(Bitmap.CompressFormat.JPEG, quality, fos)
                }
            }
        }

        if (bitmap != scaled) bitmap.recycle()
        scaled.recycle()
        return outputFile
    }
}
```

#### 3.1.4 原生端实现（iOS - Swift）

```swift
// ios/Runner/Native/CameraHandler.swift

class CameraHandler: NSObject, FlutterPlugin {
    private var pendingResult: FlutterResult?
    private var config: CameraPickerConfig?

    static func register(with registrar: FlutterPluginRegistrar) {
        let channel = FlutterMethodChannel(
            name: "com.primetop.app/camera",
            binaryMessenger: registrar.messenger()
        )
        let instance = CameraHandler()
        registrar.addMethodCallDelegate(instance, channel: channel)
    }

    func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        switch call.method {
        case "isAvailable":
            result(UIImagePickerController.isSourceTypeAvailable(.camera))
        case "pickImage":
            guard let args = call.arguments as? [String: Any] else {
                result(FlutterError(code: "INVALID_ARGUMENT",
                                    message: "参数无效", details: nil))
                return
            }
            handlePickImage(args: args, result: result)
        case "cleanup":
            handleCleanup(args: call.arguments as? [String: Any], result: result)
        default:
            result(FlutterMethodNotImplemented)
        }
    }

    private func handlePickImage(args: [String: Any], result: @escaping FlutterResult) {
        guard let viewController = UIApplication.shared.keyWindow?.rootViewController else {
            result(FlutterError(code: "CAMERA_ERROR",
                                message: "无法获取ViewController", details: nil))
            return
        }

        pendingResult = result
        config = CameraPickerConfig(from: args)

        let picker = UIImagePickerController()
        picker.delegate = self
        picker.allowsEditing = false

        // 判断来源：相册/相机/选择器
        if config!.allowCamera && config!.allowGallery {
            // 使用 UIAlertController 让用户选择
            let alert = UIAlertController(title: "选择图片来源", message: nil,
                                          preferredStyle: .actionSheet)
            alert.addAction(UIAlertAction(title: "拍照", style: .default) { _ in
                picker.sourceType = .camera
                picker.cameraDevice = self.config!.lensDirection == "front"
                    ? .front : .rear
                viewController.present(picker, animated: true)
            })
            alert.addAction(UIAlertAction(title: "从相册选择", style: .default) { _ in
                picker.sourceType = .photoLibrary
                viewController.present(picker, animated: true)
            })
            alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in
                self.pendingResult?(FlutterError(code: "CANCELLED",
                    message: "用户取消", details: nil))
                self.pendingResult = nil
            })
            viewController.present(alert, animated: true)
        } else if config!.allowCamera {
            picker.sourceType = .camera
            picker.cameraDevice = config!.lensDirection == "front" ? .front : .rear
            viewController.present(picker, animated: true)
        } else {
            picker.sourceType = .photoLibrary
            viewController.present(picker, animated: true)
        }
    }
}

extension CameraHandler: UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    func imagePickerController(_ picker: UIImagePickerController,
                               didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey : Any]) {
        picker.dismiss(animated: true)

        guard let originalImage = info[.originalImage] as? UIImage else {
            pendingResult?(FlutterError(code: "CAMERA_ERROR",
                message: "无法获取图片", details: nil))
            pendingResult = nil
            return
        }

        // 1. 压缩到目标尺寸
        var image = originalImage
        if let cfg = config {
            image = resizeImage(image, targetWidth: cfg.targetWidth,
                                targetHeight: cfg.targetHeight)
        }

        // 2. JPEG 压缩
        let quality = CGFloat(config?.quality ?? 85) / 100.0
        guard let jpegData = image.jpegData(compressionQuality: quality) else {
            pendingResult?(FlutterError(code: "CAMERA_ERROR",
                message: "图片压缩失败", details: nil))
            pendingResult = nil
            return
        }

        // 3. 保存临时文件
        let tempDir = FileManager.default.temporaryDirectory
        let fileName = "primetop_\(UUID().uuidString).jpg"
        let fileURL = tempDir.appendingPathComponent(fileName)
        try? jpegData.write(to: fileURL)

        // 4. 来源判断
        let source = picker.sourceType == .camera ? "camera" : "gallery"

        pendingResult?([
            "filePath": fileURL.path,
            "width": Int(image.size.width),
            "height": Int(image.size.height),
            "fileSizeBytes": jpegData.count,
            "source": source,
        ])
        pendingResult = nil
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        pendingResult?(FlutterError(code: "CANCELLED",
            message: "用户取消", details: nil))
        pendingResult = nil
    }
}

private func resizeImage(_ image: UIImage, targetWidth: Int, targetHeight: Int) -> UIImage {
    let maxSize = CGSize(width: CGFloat(targetWidth), height: CGFloat(targetHeight))
    let renderer = UIGraphicsImageRenderer(size: maxSize)
    return renderer.image { _ in
        image.draw(in: CGRect(origin: .zero, size: maxSize))
    }
}
```

---

### 3.2 音频录制能力（AudioRecorderCapability）

#### 3.2.1 数据结构

```dart
/// lib/native/capabilities/audio_recorder/audio_recorder_config.dart

class AudioRecorderConfig {
  /// 采样率
  final int sampleRate;

  /// 编码格式
  final AudioEncoder encoder;

  /// 比特率 (bps)
  final int bitRate;

  /// 最大录制时长（秒），0 表示无限制
  final int maxDurationSeconds;

  /// 是否启用 VAD（语音活动检测）
  final bool enableVad;

  /// VAD 静音阈值（秒），超过则自动停止
  final int vadSilenceThresholdSeconds;

  const AudioRecorderConfig({
    this.sampleRate = 16000,
    this.encoder = AudioEncoder.aacLc,
    this.bitRate = 128000,
    this.maxDurationSeconds = 60,
    this.enableVad = false,
    this.vadSilenceThresholdSeconds = 3,
  });

  /// 语音提问专用配置
  static const voiceQuestion = AudioRecorderConfig(
    sampleRate: 16000,
    encoder: AudioEncoder.aacLc,
    bitRate: 128000,
    maxDurationSeconds: 120,
    enableVad: true,
    vadSilenceThresholdSeconds: 3,
  );

  /// 背诵检测专用配置
  static const recitation = AudioRecorderConfig(
    sampleRate: 16000,
    encoder: AudioEncoder.aacLc,
    bitRate: 128000,
    maxDurationSeconds: 300,
    enableVad: false,
  );

  /// 口语陪练专用配置（流式）
  static const oralPractice = AudioRecorderConfig(
    sampleRate: 16000,
    encoder: AudioEncoder.pcm16bit,
    bitRate: 256000,
    maxDurationSeconds: 30,
    enableVad: true,
    vadSilenceThresholdSeconds: 2,
  );
}

enum AudioEncoder {
  aacLc,     // .m4a — 通用性好，体积小
  pcm16bit,  // .pcm — 无损，用于 ASR
  oggVorbis, // .ogg — Android 原生
  wav,       // .wav — 无损，兼容性好
}
```

```dart
/// lib/native/capabilities/audio_recorder/audio_recorder_result.dart

class AudioRecordingResult {
  /// 文件路径
  final String filePath;

  /// 时长（毫秒）
  final int durationMs;

  /// 文件大小（字节）
  final int fileSizeBytes;

  /// 平均音量 (0.0 - 1.0)
  final double averageVolume;

  /// 峰值音量 (0.0 - 1.0)
  final double peakVolume;

  /// 停止原因
  final RecordingStopReason stopReason;

  const AudioRecordingResult({
    required this.filePath,
    required this.durationMs,
    required this.fileSizeBytes,
    this.averageVolume = 0.0,
    this.peakVolume = 0.0,
    this.stopReason = RecordingStopReason.userStop,
  });
}

enum RecordingStopReason {
  userStop,     // 用户手动停止
  maxDuration,  // 达到最大时长
  vadSilence,   // VAD 检测到静音
  error,        // 录制异常
}
```

#### 3.2.2 能力实现

```dart
/// lib/native/capabilities/audio_recorder/audio_recorder_capability.dart

class AudioRecorderCapability extends NativeCapability {
  AudioRecorderCapability()
      : super(channel: const MethodChannel('com.primetop.app/audio_recorder'));

  @override String get name => 'audio_recorder';
  @override String get description => '麦克风录制音频';

  /// 流式音频数据通道
  final EventChannel _audioStreamChannel =
      const EventChannel('com.primetop.app/audio_recorder_stream');

  /// 当前录制状态
  RecordingState _state = RecordingState.idle;
  RecordingState get state => _state;

  /// 音量流（实时音量反馈，用于 UI 显示）
  Stream<double> get volumeStream =>
      _audioStreamChannel.receiveBroadcastStream()
          .map((event) => (event as Map)['volume'] as double);

  @override
  Future<bool> isAvailable() async {
    if (!Platform.isAndroid && !Platform.isIOS) return false;
    return await invoke<bool>('isAvailable').then((r) => r.when(
          success: (d) => d,
          failure: (_) => false,
          permissionRequired: (_) => true,
        ));
  }

  @override
  Future<PermissionStatus> checkPermission() async {
    final status = await Permission.microphone.status;
    if (status.isGranted) return PermissionStatus.granted;
    if (status.isPermanentlyDenied) return PermissionStatus.permanentlyDenied;
    return PermissionStatus.denied;
  }

  @override
  Future<PermissionStatus> requestPermission() async {
    final status = await Permission.microphone.request();
    if (status.isGranted) return PermissionStatus.granted;
    if (status.isPermanentlyDenied) return PermissionStatus.permanentlyDenied;
    return PermissionStatus.denied;
  }

  /// 开始录制
  Future<NativeResult<bool>> start(AudioRecorderConfig config) async {
    if (_state == RecordingState.recording) {
      return NativeResult.failure(const NativeError(
        code: NativeErrorCode.capabilityBusy,
        message: '正在录制中',
      ));
    }

    final permResult = await _ensurePermission();
    if (permResult != null) return permResult;

    _state = RecordingState.recording;
    final result = await invoke<bool>('start', arguments: {
      'sampleRate': config.sampleRate,
      'encoder': config.encoder.name,
      'bitRate': config.bitRate,
      'maxDurationSeconds': config.maxDurationSeconds,
      'enableVad': config.enableVad,
      'vadSilenceThresholdSeconds': config.vadSilenceThresholdSeconds,
    });

    result.when(
      failure: (_) => _state = RecordingState.idle,
      permissionRequired: (_) => _state = RecordingState.idle,
      success: (_) {},
    );
    return result;
  }

  /// 停止录制
  Future<NativeResult<AudioRecordingResult>> stop() async {
    if (_state != RecordingState.recording) {
      return NativeResult.failure(const NativeError(
        code: NativeErrorCode.invalidArgument,
        message: '当前未在录制',
      ));
    }

    final result = await invoke<Map>('stop');
    _state = RecordingState.idle;

    return result.when(
      success: (data) => NativeResult.success(AudioRecordingResult(
        filePath: data['filePath'] as String,
        durationMs: data['durationMs'] as int,
        fileSizeBytes: data['fileSizeBytes'] as int,
        averageVolume: (data['averageVolume'] as num?)?.toDouble() ?? 0.0,
        peakVolume: (data['peakVolume'] as num?)?.toDouble() ?? 0.0,
        stopReason: RecordingStopReason.values.firstWhere(
          (r) => r.name == data['stopReason'],
          orElse: () => RecordingStopReason.userStop,
        ),
      )),
      failure: NativeResult.failure,
      permissionRequired: NativeResult.permissionRequired,
    );
  }

  /// 取消录制（不返回文件）
  Future<NativeResult<bool>> cancel() async {
    _state = RecordingState.idle;
    return invoke<bool>('cancel');
  }

  Future<NativeResult<bool>?> _ensurePermission() async {
    final perm = await checkPermission();
    if (perm == PermissionStatus.granted) return null;
    final requested = await requestPermission();
    if (requested == PermissionStatus.permanentlyDenied) {
      return NativeResult.permissionRequired('microphone');
    }
    if (requested != PermissionStatus.granted) {
      return NativeResult.failure(const NativeError(
        code: NativeErrorCode.permissionDenied,
        message: '麦克风权限被拒绝',
      ));
    }
    return null;
  }
}

enum RecordingState { idle, recording, paused }
```

---

### 3.3 音频播放能力（AudioPlayerCapability）

```dart
/// lib/native/capabilities/audio_player/audio_player_capability.dart

class AudioPlayerCapability extends NativeCapability {
  AudioPlayerCapability()
      : super(channel: const MethodChannel('com.primetop.app/audio_player'));

  @override String get name => 'audio_player';
  @override String get description => '音频播放（TTS、题目音频等）';

  final EventChannel _playerStreamChannel =
      const EventChannel('com.primetop.app/audio_player_stream');

  /// 播放状态流
  Stream<PlayerState> get stateStream =>
      _playerStreamChannel.receiveBroadcastStream()
          .map((e) => PlayerState.fromMap(e as Map));

  @override
  Future<bool> isAvailable() async => true; // 播放能力始终可用

  @override
  Future<PermissionStatus> checkPermission() async =>
      PermissionStatus.granted; // 播放不需要权限

  @override
  Future<PermissionStatus> requestPermission() async =>
      PermissionStatus.granted;

  /// 播放音频文件
  Future<NativeResult<bool>> play(
    String filePath, {\n    double speed = 1.0,
    double pitch = 1.0,
  }) =>
      invoke<bool>('play', arguments: {
        'filePath': filePath,
        'speed': speed,
        'pitch': pitch,
      });

  /// 播放 URL
  Future<NativeResult<bool>> playUrl(
    String url, {\n    double speed = 1.0,
    double pitch = 1.0,
  }) =>
      invoke<bool>('playUrl', arguments: {
        'url': url,
        'speed': speed,
        'pitch': pitch,
      });

  /// 暂停
  Future<NativeResult<bool>> pause() => invoke<bool>('pause');

  /// 恢复
  Future<NativeResult<bool>> resume() => invoke<bool>('resume');

  /// 停止
  Future<NativeResult<bool>> stop() => invoke<bool>('stop');

  /// 跳转（毫秒）
  Future<NativeResult<bool>> seek(int positionMs) =>
      invoke<bool>('seek', arguments: {'positionMs': positionMs});

  /// 设置播放速度
  Future<NativeResult<bool>> setSpeed(double speed) =>
      invoke<bool>('setSpeed', arguments: {'speed': speed});
}

class PlayerState {
  final PlayerStatus status;
  final int positionMs;
  final int durationMs;
  final double speed;

  const PlayerState({
    required this.status,
    this.positionMs = 0,
    this.durationMs = 0,
    this.speed = 1.0,
  });

  factory PlayerState.fromMap(Map map) => PlayerState(
        status: PlayerStatus.values.firstWhere(
          (s) => s.name == map['status'],
          orElse: () => PlayerStatus.idle,
        ),
        positionMs: map['positionMs'] as int? ?? 0,
        durationMs: map['durationMs'] as int? ?? 0,
        speed: (map['speed'] as num?)?.toDouble() ?? 1.0,
      );
}

enum PlayerStatus { idle, playing, paused, completed, error }
```

---

### 3.4 生物识别能力（BiometricCapability）

用于家长验证身份（防沉迷解锁、支付确认）和应用锁。

```dart
/// lib/native/capabilities/biometric/biometric_capability.dart

class BiometricCapability extends NativeCapability {
  BiometricCapability()
      : super(channel: const MethodChannel('com.primetop.app/biometric'));

  @override String get name => 'biometric';
  @override String get description => '指纹/Face ID 生物识别';

  @override
  Future<bool> isAvailable() async {
    if (!Platform.isAndroid && !Platform.isIOS) return false;
    return await invoke<bool>('isAvailable').then((r) => r.when(
          success: (d) => d,
          failure: (_) => false,
          permissionRequired: (_) => false,
        ));
  }

  @override
  Future<PermissionStatus> checkPermission() async => PermissionStatus.granted;

  @override
  Future<PermissionStatus> requestPermission() async => PermissionStatus.granted;

  /// 获取可用生物识别类型
  Future<NativeResult<BiometricType>> getAvailableBiometrics() =>
      invoke<String>('getAvailableBiometrics').then((r) => r.when(
            success: (data) => NativeResult.success(
              BiometricType.values.firstWhere(
                (t) => t.name == data,
                orElse: () => BiometricType.none,
              ),
            ),
            failure: NativeResult.failure,
            permissionRequired: NativeResult.permissionRequired,
          ));

  /// 触发生物识别认证
  ///
  /// [reason] 显示给用户的认证理由
  /// [fallbackToPin] 生物识别失败时是否回退到 PIN
  Future<NativeResult<bool>> authenticate({
    required String reason,
    bool fallbackToPin = true,
  bool stickyAuth = false, // 锁屏后恢复时是否保持认证
  }) =>
      invoke<bool>('authenticate', arguments: {
        'reason': reason,
        'fallbackToPin': fallbackToPin,
        'stickyAuth': stickyAuth,
      });

  /// 取消认证
  Future<NativeResult<bool>> cancelAuthentication() =>
      invoke<bool>('cancelAuthentication');
}

enum BiometricType {
  none,       // 设备不支持
  fingerprint, // 指纹
  face,       // Face ID
  iris,       // 虹膜（部分 Android）
  multiple,   // 支持多种方式
}
```

---

### 3.5 本地通知能力（LocalNotificationCapability）

```dart
/// lib/native/capabilities/local_notification/local_notification_capability.dart

class LocalNotificationCapability extends NativeCapability {
  LocalNotificationCapability()
      : super(channel: const MethodChannel('com.primetop.app/notification'));

  @override String get name => 'local_notification';
  @override String get description => '本地推送通知';

  @override Future<bool> isAvailable() async => true;
  @override
  Future<PermissionStatus> checkPermission() async {
    if (!Platform.isIOS) return PermissionStatus.granted;
    // iOS 需要请求通知权限
    final status = await Permission.notification.status;
    return status.isGranted
        ? PermissionStatus.granted
        : PermissionStatus.denied;
  }

  @override
  Future<PermissionStatus> requestPermission() async {
    final status = await Permission.notification.request();
    return status.isGranted
        ? PermissionStatus.granted
        : PermissionStatus.denied;
  }

  /// 立即显示通知
  Future<NativeResult<int>> show(NotificationContent content) =>
      invoke<int>('show', arguments: content.toMap());

  /// 定时通知
  Future<NativeResult<int>> schedule(
    NotificationContent content,
    DateTime scheduledTime,
  ) =>
      invoke<int>('schedule', arguments: {
        ...content.toMap(),
        'scheduledTimeMs': scheduledTime.millisecondsSinceEpoch,
      });

  /// 重复通知
  Future<NativeResult<int>> repeat(
    NotificationContent content,
    RepeatInterval interval,
  ) =>
      invoke<int>('repeat', arguments: {
        ...content.toMap(),
        'repeatInterval': interval.name,
      });

  /// 取消通知
  Future<NativeResult<bool>> cancel(int id) =>
      invoke<bool>('cancel', arguments: {'id': id});

  /// 取消全部通知
  Future<NativeResult<bool>> cancelAll() => invoke<bool>('cancelAll');

  /// 获取待处理通知列表
  Future<NativeResult<List<PendingNotification>>> getPending() =>
      invoke<List>('getPending').then((r) => r.when(
            success: (data) => NativeResult.success(
              data.map((e) => PendingNotification.fromMap(e as Map)).toList(),
            ),
            failure: NativeResult.failure,
            permissionRequired: NativeResult.permissionRequired,
          ));
}

class NotificationContent {
  final int? id;
  final String title;
  final String body;
  final String? icon;
  final String? channelId; // Android channel
  final Map<String, String>? payload;

  const NotificationContent({
    this.id,
    required this.title,
    required this.body,
    this.icon,
    this.channelId = 'primetop_default',
    this.payload,
  });

  Map<String, dynamic> toMap() => {
        if (id != null) 'id': id,
        'title': title,
        'body': body,
        if (icon != null) 'icon': icon,
        'channelId': channelId,
        if (payload != null) 'payload': payload,
      };
}

enum RepeatInterval { everyMinute, hourly, daily, weekly }

class PendingNotification {
  final int id;
  final String title;
  final String body;
  final DateTime? scheduledTime;

  const PendingNotification({
    required this.id,
    required this.title,
    required this.body,
    this.scheduledTime,
  });

  factory PendingNotification.fromMap(Map map) => PendingNotification(
        id: map['id'] as int,
        title: map['title'] as String,
        body: map['body'] as String,
        scheduledTime: map['scheduledTimeMs'] != null
            ? DateTime.fromMillisecondsSinceEpoch(map['scheduledTimeMs'] as int)
            : null,
      );
}
```

---

### 3.6 设备信息能力（DeviceInfoCapability）

```dart
/// lib/native/capabilities/device_info/device_info_capability.dart

class DeviceInfoCapability extends NativeCapability {
  DeviceInfoCapability()
      : super(channel: const MethodChannel('com.primetop.app/device_info'));

  @override String get name => 'device_info';
  @override String get description => '设备信息采集';

  @override Future<bool> isAvailable() async => true;
  @override Future<PermissionStatus> checkPermission() async => PermissionStatus.granted;
  @override Future<PermissionStatus> requestPermission() async => PermissionStatus.granted;

  /// 获取完整设备信息
  Future<NativeResult<PrimeTopDeviceInfo>> getDeviceInfo() =>
      invoke<Map>('getDeviceInfo').then((r) => r.when(
            success: (d) => NativeResult.success(
              PrimeTopDeviceInfo.fromMap(d),
            ),
            failure: NativeResult.failure,
            permissionRequired: NativeResult.permissionRequired,
          ));

  /// 获取设备性能等级（用于渲染策略、端侧AI分级）
  Future<NativeResult<DevicePerformanceTier>> getPerformanceTier() =>
      invoke<String>('getPerformanceTier').then((r) => r.when(
            success: (d) => NativeResult.success(
              DevicePerformanceTier.values.firstWhere(
                (t) => t.name == d,
                orElse: () => DevicePerformanceTier.medium,
              ),
            ),
            failure: NativeResult.failure,
            permissionRequired: NativeResult.permissionRequired,
          ));
}

class PrimeTopDeviceInfo {
  final String deviceId;
  final String deviceModel;
  final String osName;
  final String osVersion;
  final int totalMemoryMB;
  final int cpuCores;
  final String cpuArch;
  final int screenWidthPx;
  final int screenHeightPx;
  final double screenInches;
  final double pixelRatio;
  final int batteryLevel;
  final bool isLowPowerMode;
  final String appVersion;
  final String buildNumber;

  const PrimeTopDeviceInfo({
    required this.deviceId,
    required this.deviceModel,
    required this.osName,
    required this.osVersion,
    required this.totalMemoryMB,
    required this.cpuCores,
    required this.cpuArch,
    required this.screenWidthPx,
    required this.screenHeightPx,
    required this.screenInches,
    required this.pixelRatio,
    this.batteryLevel = -1,
    this.isLowPowerMode = false,
    required this.appVersion,
    required this.buildNumber,
  });

  factory PrimeTopDeviceInfo.fromMap(Map map) => PrimeTopDeviceInfo(
        deviceId: map['deviceId'] as String,
        deviceModel: map['deviceModel'] as String,
        osName: map['osName'] as String,
        osVersion: map['osVersion'] as String,
        totalMemoryMB: map['totalMemoryMB'] as int,
        cpuCores: map['cpuCores'] as int,
        cpuArch: map['cpuArch'] as String,
        screenWidthPx: map['screenWidthPx'] as int,
        screenHeightPx: map['screenHeightPx'] as int,
        screenInches: (map['screenInches'] as num).toDouble(),
        pixelRatio: (map['pixelRatio'] as num).toDouble(),
        batteryLevel: map['batteryLevel'] as int? ?? -1,
        isLowPowerMode: map['isLowPowerMode'] as bool? ?? false,
        appVersion: map['appVersion'] as String,
        buildNumber: map['buildNumber'] as String,
      );
}

enum DevicePerformanceTier {
  /// 低端设备（<2GB RAM, <=4核）
  low,

  /// 中端设备（2-4GB RAM, 4-6核）
  medium,

  /// 高端设备（>4GB RAM, >6核）
  high,
}
```

---

### 3.7 屏幕控制能力（ScreenCapability）

用于护眼模式（调整屏幕亮度/色温）。

```dart
/// lib/native/capabilities/screen/screen_capability.dart

class ScreenCapability extends NativeCapability {
  ScreenCapability()
      : super(channel: const MethodChannel('com.primetop.app/screen'));

  @override String get name => 'screen';
  @override String get description => '屏幕亮度与色温控制';

  @override Future<bool> isAvailable() async =>
      Platform.isAndroid || Platform.isIOS;
  @override Future<PermissionStatus> checkPermission() async => PermissionStatus.granted;
  @override Future<PermissionStatus> requestPermission() async => PermissionStatus.granted;

  /// 获取当前屏幕亮度 (0.0 - 1.0)
  Future<NativeResult<double>> getBrightness() => invoke<double>('getBrightness');

  /// 设置屏幕亮度
  Future<NativeResult<bool>> setBrightness(double brightness) =>
      invoke<bool>('setBrightness', arguments: {'brightness': brightness.clamp(0.0, 1.0)});

  /// 重置为系统亮度
  Future<NativeResult<bool>> resetBrightness() => invoke<bool>('resetBrightness');

  /// 检查是否支持蓝光过滤（护眼模式）
  Future<NativeResult<bool>> supportsEyeCare() => invoke<bool>('supportsEyeCare');

  /// 开启/关闭护眼模式（Android Only，iOS 无此API）
  Future<NativeResult<bool>> setEyeCareEnabled(bool enabled) =>
      invoke<bool>('setEyeCareEnabled', arguments: {'enabled': enabled});

  /// 保持屏幕常亮
  Future<NativeResult<bool>> setKeepScreenOn(bool keepOn) =>
      invoke<bool>('setKeepScreenOn', arguments: {'keepOn': keepOn});
}
```

---

## 4. Provider 集成与初始化

### 4.1 Riverpod Provider 定义

```dart
/// lib/native/providers/native_providers.dart

/// 原生能力注册表 Provider
@Riverpod(keepAlive: true)
NativeRegistry nativeRegistry(Ref ref) {
  final registry = NativeRegistry();

  // 注册所有原生能力
  registry.register(CameraCapability());
  registry.register(AudioRecorderCapability());
  registry.register(AudioPlayerCapability());
  registry.register(BiometricCapability());
  registry.register(LocalNotificationCapability());
  registry.register(DeviceInfoCapability());
  registry.register(ScreenCapability());

  ref.onDispose(() {
    // 清理所有能力
    registry.registeredNames; // 仅日志
  });

  return registry;
}

/// 便捷 Provider：直接获取各能力实例

@riverpod
CameraCapability camera(Ref ref) =>
    ref.watch(nativeRegistryProvider).get<CameraCapability>('camera');

@riverpod
AudioRecorderCapability audioRecorder(Ref ref) =>
    ref.watch(nativeRegistryProvider).get<AudioRecorderCapability>('audio_recorder');

@riverpod
AudioPlayerCapability audioPlayer(Ref ref) =>
    ref.watch(nativeRegistryProvider).get<AudioPlayerCapability>('audio_player');

@riverpod
BiometricCapability biometric(Ref ref) =>
    ref.watch(nativeRegistryProvider).get<BiometricCapability>('biometric');

@riverpod
LocalNotificationCapability localNotification(Ref ref) =>
    ref.watch(nativeRegistryProvider).get<LocalNotificationCapability>('local_notification');

@riverpod
DeviceInfoCapability deviceInfo(Ref ref) =>
    ref.watch(nativeRegistryProvider).get<DeviceInfoCapability>('device_info');

@riverpod
ScreenCapability screen(Ref ref) =>
    ref.watch(nativeRegistryProvider).get<ScreenCapability>('screen');
```

### 4.2 初始化流程

在应用启动管线中注册所有原生能力（参考 `客户端应用启动流程与初始化管线-详细设计.md`）：

```dart
/// lib/app/init/native_capability_init.dart

class NativeCapabilityInitializer {
  /// 初始化阶段：Stage 3（平台服务初始化阶段）
  ///
  /// 执行内容：
  /// 1. 预热 MethodChannel 连接
  /// 2. 检查所有能力可用性
  /// 3. 缓存设备信息
  /// 4. 注册通知点击回调
  static Future<void> initialize(NativeRegistry registry) async {
    final logger = Logger('NativeInit');

    // 1. 并行检查能力可用性
    final capabilities = registry.registeredNames;
    final results = await Future.wait(
      capabilities.map((name) async {
        final cap = registry.tryGet(name);
        if (cap == null) return MapEntry(name, false);
        try {
          final available = await cap.isAvailable();
          logger.info('$name: ${available ? '可用' : '不可用'}');
          return MapEntry(name, available);
        } catch (e) {
          logger.warning('$name: 检查失败 - $e');
          return MapEntry(name, false);
        }
      }),
    );

    // 2. 缓存能力可用性
    final availability = Map.fromEntries(results);
    // 可通过 SharedPreference 持久化，减少后续检查

    // 3. 缓存设备信息（如果可用）
    if (availability['device_info'] == true) {
      try {
        final deviceCap = registry.get<DeviceInfoCapability>('device_info');
        final deviceResult = await deviceCap.getDeviceInfo();
        deviceResult.when(
          success: (info) {
            logger.info('设备: ${info.deviceModel}, '
                '${info.osName} ${info.osVersion}, '
                '${info.totalMemoryMB}MB RAM, '
                '${info.cpuCores}核');
          },
          failure: (e) => logger.warning('设备信息获取失败: ${e.message}'),
          permissionRequired: (_) {},
        );
      } catch (e) {
        logger.warning('设备信息初始化异常: $e');
      }
    }

    // 4. 注册本地通知点击回调
    // 由通知模块在业务层自行注册

    logger.info('原生能力初始化完成: $availability');
  }
}
```

---

## 5. 业务层集成示例

### 5.1 拍题答疑集成

```dart
/// lib/features/question_search/widgets/camera_button.dart

class CameraButton extends ConsumerWidget {
  const CameraButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cameraCap = ref.watch(cameraProvider);

    return AsyncValueBuilder(
      // 检查相机可用性
      future: cameraCap.isAvailable(),
      builder: (context, available) {
        if (!available) {
          return const SizedBox.shrink(); // 不支持则隐藏
        }
        return IconButton(
          icon: const Icon(Icons.camera_alt),
          onPressed: () => _onTap(context, ref),
        );
      },
    );
  }

  Future<void> _onTap(BuildContext context, WidgetRef ref) async {
    final cameraCap = ref.read(cameraProvider);

    // 显示加载
    LoadingOverlay.show(context, message: '正在打开相机...');

    final result = await cameraCap.pickImage(CameraConfig.question);

    if (!context.mounted) return;
    LoadingOverlay.hide(context);

    result.when(
      success: (image) {
        // 导航到拍题解析页
        context.go('/question/analyze', extra: {
          'imagePath': image.filePath,
          'imageSize': image.fileSizeBytes,
        });
      },
      failure: (error) {
        _showError(context, error);
      },
      permissionRequired: (permission) {
        _showPermissionDialog(context, permission);
      },
    );
  }

  void _showError(BuildContext context, NativeError error) {
    final message = switch (error.code) {
      NativeErrorCode.userCancelled => null, // 用户取消，不提示
      NativeErrorCode.hardwareUnavailable => '您的设备不支持相机功能',
      NativeErrorCode.capabilityBusy => '相机正在使用中，请稍后再试',
      _ => '拍照失败，请重试',
    };
    if (message != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    }
  }

  void _showPermissionDialog(BuildContext context, String permission) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('需要相机权限'),
        content: const Text('拍照搜题需要使用相机权限。请在设置中开启。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () {
              openAppSettings();
              Navigator.pop(context);
            },
            child: const Text('去设置'),
          ),
        ],
      ),
    );
  }
}
```

### 5.2 语音提问集成

```dart
/// lib/features/ai_tutor/widgets/voice_input_button.dart

class VoiceInputButton extends ConsumerStatefulWidget {
  const VoiceInputButton({super.key});

  @override
  ConsumerState<VoiceInputButton> createState() => _VoiceInputButtonState();
}

class _VoiceInputButtonState extends ConsumerState<VoiceInputButton> {
  bool _isRecording = false;
  double _volume = 0.0;
  StreamSubscription? _volumeSub;

  @override
  void dispose() {
    _volumeSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onLongPressStart: (_) => _startRecording(),
      onLongPressEnd: (_) => _stopRecording(),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        width: _isRecording ? 64 : 48,
        height: _isRecording ? 64 : 48,
        decoration: BoxDecoration(
          color: _isRecording
              ? Theme.of(context).colorScheme.error
              : Theme.of(context).colorScheme.primaryContainer,
          shape: BoxShape.circle,
        ),
        child: Icon(
          _isRecording ? Icons.mic : Icons.mic_none,
          color: _isRecording ? Colors.white : null,
        ),
      ),
    );
  }

  Future<void> _startRecording() async {
    final recorder = ref.read(audioRecorderProvider);

    // 请求权限并开始
    final perm = await recorder.checkPermission();
    if (perm != PermissionStatus.granted) {
      final requested = await recorder.requestPermission();
      if (requested == PermissionStatus.permanentlyDenied) {
        if (mounted) _showPermissionDialog();
        return;
      }
      if (requested != PermissionStatus.granted) return;
    }

    final result = await recorder.start(AudioRecorderConfig.voiceQuestion);
    result.when(
      success: (_) {
        setState(() => _isRecording = true);
        // 监听音量
        _volumeSub = recorder.volumeStream.listen((vol) {
          setState(() => _volume = vol);
        });
      },
      failure: (e) => _showError(e.message),
      permissionRequired: (_) => _showPermissionDialog(),
    );
  }

  Future<void> _stopRecording() async {
    _volumeSub?.cancel();
    _volumeSub = null;
    setState(() => _isRecording = false);

    final recorder = ref.read(audioRecorderProvider);
    final result = await recorder.stop();

    result.when(
      success: (recording) {
        // 发送到 ASR 服务
        ref.read(aiTutorProvider.notifier).submitVoiceQuestion(
          filePath: recording.filePath,
          durationMs: recording.durationMs,
        );
      },
      failure: (e) => _showError(e.message),
      permissionRequired: (_) {},
    );
  }
}
```

### 5.3 家长验证（生物识别）

```dart
/// lib/features/parental_control/biometric_gate.dart

class BiometricGate extends ConsumerWidget {
  final Widget child;
  final String reason;

  const BiometricGate({
    super.key,
    required this.child,
    this.reason = '请验证家长身份',
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return FutureBuilder<bool>(
      future: ref.read(biometricProvider).isAvailable(),
      builder: (context, snapshot) {
        if (snapshot.data != true) {
          // 不支持生物识别，降级为 PIN 验证
          return PinGate(child: child);
        }
        return child;
      },
    );
  }

  /// 触发验证
  static Future<bool> authenticate(BuildContext context, WidgetRef ref, {
    String? reason,
  }) async {
    final biometric = ref.read(biometricProvider);

    final available = await biometric.isAvailable();
    if (!available) {
      // 降级到 PIN
      return _showPinDialog(context);
    }

    final result = await biometric.authenticate(
      reason: reason ?? '请验证家长身份',
      fallbackToPin: true,
    );

    return result.when(
      success: (authenticated) => authenticated,
      failure: (e) => false,
      permissionRequired: (_) => false,
    );
  }
}
```

---

## 6. 降级策略矩阵

| 能力 | 降级方案 | 触发条件 | 用户感知 |
|------|----------|----------|----------|
| 相机 | 显示「不支持拍照」提示 | 设备无相机 | 隐藏拍照按钮 |
| 相机 | 仅相册选择 | 相机权限被拒 | 隐藏拍照选项 |
| 音频录制 | 显示「不支持语音」提示 | 无麦克风 | 隐藏语音按钮 |
| 音频录制 | 文字输入替代 | 权限被拒 | 显示文字输入框 |
| 音频播放 | 静默降级（不播放） | 音频加载失败 | 不影响核心流程 |
| 生物识别 | PIN 码验证 | 设备不支持/权限拒绝 | 弹出 PIN 输入框 |
| 本地通知 | 仅端内消息 | 通知权限被拒 | 不影响端内提醒 |
| 设备信息 | 使用默认值 | 获取失败 | 不影响功能 |
| 屏幕控制 | 跳过亮度调整 | 平台不支持 | 不影响护眼模式其他功能 |

---

## 7. 测试策略

### 7.1 Mock 框架

```dart
/// lib/native/mock/mock_native_registry.dart

class MockNativeRegistry {
  /// 创建用于测试的注册表，所有能力使用 Mock 实现
  static NativeRegistry create({
    CameraCapability? cameraOverride,
    AudioRecorderCapability? recorderOverride,
    AudioPlayerCapability? playerOverride,
    BiometricCapability? biometricOverride,
    LocalNotificationCapability? notificationOverride,
    DeviceInfoCapability? deviceInfoOverride,
    ScreenCapability? screenOverride,
  }) {
    final registry = NativeRegistry();
    registry.register(cameraOverride ?? MockCameraCapability());
    registry.register(recorderOverride ?? MockAudioRecorderCapability());
    registry.register(playerOverride ?? MockAudioPlayerCapability());
    registry.register(biometricOverride ?? MockBiometricCapability());
    registry.register(notificationOverride ?? MockLocalNotificationCapability());
    registry.register(deviceInfoOverride ?? MockDeviceInfoCapability());
    registry.register(screenOverride ?? MockScreenCapability());
    return registry;
  }
}
```

### 7.2 Mock 能力示例

```dart
/// lib/native/mock/mock_camera.dart

class MockCameraCapability extends CameraCapability {
  bool pickImageShouldFail = false;
  bool pickImageShouldDenyPermission = false;
  CameraResult? nextResult;

  @override
  Future<bool> isAvailable() async => true;

  @override
  Future<PermissionStatus> checkPermission() async => PermissionStatus.granted;

  @override
  Future<PermissionStatus> requestPermission() async => PermissionStatus.granted;

  @override
  Future<NativeResult<CameraResult>> pickImage(CameraConfig config) async {
    await Future.delayed(const Duration(milliseconds: 500)); // 模拟延迟

    if (pickImageShouldDenyPermission) {
      return NativeResult.permissionRequired('camera');
    }
    if (pickImageShouldFail) {
      return NativeResult.failure(const NativeError(
        code: NativeErrorCode.executionError,
        message: 'Mock: 拍照失败',
      ));
    }

    return NativeResult.success(nextResult ?? CameraResult(
      filePath: '/tmp/mock_photo.jpg',
      width: config.targetWidth,
      height: config.targetHeight,
      fileSizeBytes: 1024 * 100, // 100KB mock
      source: CameraResultSource.camera,
    ));
  }
}
```

### 7.3 单元测试示例

```dart
/// test/native/camera_capability_test.dart

void main() {
  group('CameraCapability', () {
    late MockCameraCapability camera;

    setUp(() {
      camera = MockCameraCapability();
    });

    test('isAvailable returns true', () async {
      expect(await camera.isAvailable(), isTrue);
    });

    test('pickImage returns success with mock image', () async {
      final result = await camera.pickImage(CameraConfig.question);
      expect(result, isA<NativeSuccess<CameraResult>>());
    });

    test('pickImage returns failure when configured', () async {
      camera.pickImageShouldFail = true;
      final result = await camera.pickImage(CameraConfig.question);
      expect(result, isA<NativeFailure<CameraResult>>());
    });

    test('pickImage returns permission required when configured', () async {
      camera.pickImageShouldDenyPermission = true;
      final result = await camera.pickImage(CameraConfig.question);
      expect(result, isA<NativePermissionRequired<CameraResult>>());
    });
  });

  group('VoiceInputButton Widget', () {
    testWidgets('shows mic icon when not recording', (tester) async {
      final container = ProviderContainer(
        overrides: [
          nativeRegistryProvider.overrideWith((ref) =>
              MockNativeRegistry.create()),
        ],
      );

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(
            home: Scaffold(body: VoiceInputButton()),
          ),
        ),
      );

      expect(find.byIcon(Icons.mic_none), findsOneWidget);
    });
  });
}
```

---

## 8. 通道命名规范

所有 MethodChannel/EventChannel 遵循统一命名规范：

```
com.primetop.app/{capability_name}
com.primetop.app/{capability_name}_stream  // EventChannel
```

| 能力 | MethodChannel | EventChannel |
|------|--------------|--------------|
| 相机 | `com.primetop.app/camera` | - |
| 音频录制 | `com.primetop.app/audio_recorder` | `com.primetop.app/audio_recorder_stream` |
| 音频播放 | `com.primetop.app/audio_player` | `com.primetop.app/audio_player_stream` |
| 生物识别 | `com.primetop.app/biometric` | - |
| 本地通知 | `com.primetop.app/notification` | - |
| 设备信息 | `com.primetop.app/device_info` | - |
| 屏幕控制 | `com.primetop.app/screen` | - |
| 文件系统 | `com.primetop.app/file_system` | - |

**方法命名规范**：`camelCase`，动词开头
- `isAvailable` — 能力可用性检查
- `start` / `stop` — 开始/停止
- `get*` — 获取信息
- `set*` — 设置参数
- `show*` / `play*` — 展示/播放

---

## 9. 新增能力接入清单

新增一个原生能力的标准步骤：

1. **Dart 层**：在 `lib/native/capabilities/` 下创建能力目录
   - 定义 `*Config.dart` 配置类
   - 定义 `*Result.dart` 结果类
   - 实现 `*Capability.dart` 继承 `NativeCapability`

2. **注册**：在 `NativeRegistry` 初始化中添加 `registry.register(XxxCapability())`

3. **Provider**：在 `native_providers.dart` 中添加便捷 Provider

4. **原生端**：
   - Android: `android/.../native/XxxHandler.kt` 实现 `MethodCallHandler`
   - iOS: `ios/Runner/Native/XxxHandler.swift` 实现 `FlutterPlugin`
   - 在 `MainActivity.kt` / `AppDelegate.swift` 中注册插件

5. **Mock**：在 `lib/native/mock/` 下实现 Mock 类

6. **测试**：编写 Widget 测试和集成测试

7. **降级**：在降级策略矩阵中添加条目

---

## 10. 跨模块依赖关系

```
客户端应用启动流程
    └── NativeCapabilityInitializer (Stage 3)
         ├── CameraCapability ← 拍题答疑、个人中心、分享
         ├── AudioRecorderCapability ← AI辅导、文科背诵、英语专项
         ├── AudioPlayerCapability ← AI辅导、同步课堂、英语专项
         ├── BiometricCapability ← 家长中心、防沉迷、支付
         ├── LocalNotificationCapability ← 学习提醒、通知中心
         ├── DeviceInfoCapability ← 风控引擎、性能监控、端侧AI分级
         └── ScreenCapability ← 护眼模式

客户端全局异常处理
    └── NativeCapability.invoke() 异常捕获

客户端系统权限管理
    └── NativeCapability.checkPermission() / requestPermission()

客户端状态管理架构
    └── native_providers (Riverpod)

客户端网络请求治理
    └── NetworkCapability (弱网检测辅助)
```

---

## 11. 性能考量

| 指标 | 目标值 | 说明 |
|------|--------|------|
| MethodChannel 单次调用延迟 | < 5ms | 纯通信开销，不含原生执行时间 |
| 相机打开到首帧预览 | < 500ms | 依赖平台相机框架 |
| 录音启动延迟 | < 200ms | 包含权限检查 |
| 生物识别弹出延迟 | < 300ms | 平台 UI 显示时间 |
| 本地通知触发延迟 | < 100ms | 本地调度 |
| 音频播放启动延迟 | < 500ms | 首次播放，含解码器初始化 |

**优化手段**：
1. MethodChannel 使用 `BinaryMessenger` 直接传递二进制数据，减少序列化开销
2. 相机预览使用 `Texture` widget，避免通过 MethodChannel 传输帧数据
3. 音频流使用 EventChannel 推送，避免轮询
4. 设备信息在启动时一次性缓存，后续从缓存读取
5. 权限状态缓存，避免重复调用系统 API