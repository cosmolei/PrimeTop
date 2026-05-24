# 客户端端侧 AI 推理与端智能引擎 - 详细设计

## 1. 模块概述

### 1.1 功能定位

客户端端侧 AI 推理引擎（On-Device AI Engine，代号 EdgeAI）是 PrimeTop 客户端的本地智能能力层，负责在设备端执行轻量级 AI 推理任务，为离线场景提供基础 AI 能力、为在线场景提供低延迟预处理，并作为云端 AI 服务的降级备份。

### 1.2 设计动机

| 场景 | 痛点 | 端侧 AI 价值 |
|------|------|-------------|
| 弱网/离线环境 | 用户无法使用 AI 功能 | 提供基础离线 AI 能力（文字识别、分类等） |
| 拍题场景 | OCR 端到端延迟 > 3s | 端侧预处理（裁剪、增强、文字区域检测）降低云端负担 |
| 数学公式输入 | 手写公式识别依赖网络 | 端侧手写识别，< 200ms 响应 |
| 内容安全 | 全量上传云端审核增加延迟 | 端侧预过滤，拦截明显违规内容 |
| 成本控制 | 云端 AI 调用费用高 | 高频低复杂度任务下沉到端侧 |
| 隐私保护 | 敏感数据不应出设备 | 某些推理结果不出端 |

### 1.3 与其他模块的关系

| 关联模块 | 交互方式 |
|----------|----------|
| 图片处理与 OCR 识别管线 | 端侧预处理 → 云端精识别；离线时端侧兜底 |
| 数学公式与学科符号输入系统 | 端侧手写识别（TFLite）|
| AI 输入安全与教育对话护栏引擎 | 端侧预审过滤（敏感词、图片裸检）|
| 客户端本地持久层与数据管理 | 模型文件存储、版本管理 |
| 客户端资源包下载管理器 | 模型包下载、增量更新 |
| 多模型调度与成本治理 | 端侧推理作为模型路由的一个"供应商" |
| 离线缓存与数据同步 | 离线模式下端侧 AI 能力激活 |
| 客户端网络请求治理与弱网适配 | 网络状态感知，动态切换端/云推理 |
| 语音服务(ASR-TTS) | 端侧 VAD（语音活动检测）|

### 1.4 设计原则

1. **渐进增强**：端侧推理不替代云端能力，而是作为增强层
2. **设备分级**：根据设备性能自动选择推理策略，低端设备不做端侧推理
3. **模型轻量**：所有端侧模型必须 ≤ 50MB，推理时间 ≤ 500ms
4. **隐私优先**：涉及用户敏感数据的推理优先在端侧完成
5. **统一抽象**：对上层业务提供统一推理接口，屏蔽端/云切换细节

---

## 2. 端侧 AI 能力矩阵

### 2.1 能力全景

| 能力 | 模型类型 | 模型大小 | 推理延迟 | 优先级 | 覆盖场景 |
|------|----------|----------|----------|--------|----------|
| 文字区域检测（Text Detection） | CNN | ~5MB | < 50ms | P0 | 拍题预处理 |
| 印刷体文字识别（OCR Lite） | CRNN + CTC | ~15MB | < 200ms | P0 | 离线基础识别 |
| 手写数学符号识别 | CNN + LSTM | ~8MB | < 150ms | P0 | 公式输入 |
| 图像分类（内容类型） | MobileNetV3 | ~5MB | < 30ms | P1 | 拍题分类 |
| 敏感内容预检 | 分类模型 | ~3MB | < 50ms | P1 | 内容安全 |
| 语音活动检测（VAD） | RNN | ~1MB | < 10ms | P0 | 语音输入 |
| 文本分类（意图预判） | BERT-Tiny | ~15MB | < 100ms | P2 | AI对话预路由 |
| 手势识别 | MediaPipe | ~8MB | < 30ms | P2 | 交互增强 |
| 简单数学计算验证 | 规则引擎 | 0 | < 5ms | P0 | 答案校验 |

### 2.2 设备分级策略

根据设备性能将端侧推理分为三个等级：

```python
# 设备分级标准（伪代码）
class DeviceTier:
    TIER_HIGH = "high"      # 旗舰设备：8GB+ RAM, 骁龙8系/A15+
    TIER_MID = "mid"        # 中端设备：4-8GB RAM, 骁龙6系/A12+
    TIER_LOW = "low"        # 低端设备：<4GB RAM 或 3 年前硬件

# 分级规则
def classify_device(device_info):
    score = 0
    score += min(device_info.total_ram_gb * 2, 16)      # RAM 权重
    score += min(device_info.cpu_cores * 1.5, 12)        # CPU 核数
    if device_info.gpu_supports_fp16: score += 8         # GPU 半精度支持
    if device_info.neural_engine_available: score += 10  # NPU/ANE 可用
    if device_info.os_version >= latest_minus_2: score += 5  # 系统版本
    
    if score >= 30: return DeviceTier.TIER_HIGH
    elif score >= 18: return DeviceTier.TIER_MID
    else: return DeviceTier.TIER_LOW
```

### 2.3 能力-设备矩阵

| 能力 | TIER_HIGH | TIER_MID | TIER_LOW |
|------|-----------|----------|----------|
| 文字区域检测 | ✅ GPU/NPU | ✅ GPU | ✅ CPU |
| OCR Lite | ✅ GPU/NPU | ✅ GPU | ⚠️ 降精度 |
| 手写公式识别 | ✅ GPU/NPU | ✅ GPU | ❌ 仅云端 |
| 图像分类 | ✅ GPU | ✅ GPU | ❌ 仅云端 |
| 敏感内容预检 | ✅ CPU | ✅ CPU | ✅ CPU |
| VAD | ✅ CPU | ✅ CPU | ✅ CPU |
| 文本分类 | ✅ NPU | ⚠️ 降精度 | ❌ 仅云端 |
| 手势识别 | ✅ GPU | ❌ 仅云端 | ❌ 仅云端 |
| 数学计算验证 | ✅ CPU | ✅ CPU | ✅ CPU |

---

## 3. 架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                     业务调用层                                │
│  (拍题模块 / 公式输入 / 语音服务 / AI对话 / 内容安全)          │
└──────────────────────────┬──────────────────────────────────┘
                           │ 统一推理 API
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              EdgeAI Manager (Dart 层)                        │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐      │
│  │ 能力注册表 │  │ 设备分级引擎  │  │  端/云路由决策器    │      │
│  └──────────┘  └──────────────┘  └───────────────────┘      │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐      │
│  │ 模型生命周期│  │ 推理调度器    │  │  性能监控 & 降级    │      │
│  └──────────┘  └──────────────┘  └───────────────────┘      │
└──────────────────────────┬──────────────────────────────────┘
                           │ FFI / Platform Channel
                           ▼
┌─────────────────────────────────────────────────────────────┐
│            Platform Layer (原生层)                           │
│  ┌─────────────┐  ┌───────────────┐  ┌──────────────┐       │
│  │ TFLite       │  │ CoreML (iOS)   │  │ NNAPI        │       │
│  │ Runtime      │  │ Delegate       │  │ Delegate     │       │
│  │ (Android/iOS)│  │ (iOS only)     │  │ (Android 8+) │       │
│  └─────────────┘  └───────────────┘  └──────────────┘       │
│  ┌─────────────┐  ┌───────────────┐                          │
│  │ GPU Delegate │  │ MediaPipe     │                          │
│  │ (OpenCL/GLES)│  │ (手势/人脸)    │                          │
│  └─────────────┘  └───────────────┘                          │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  模型存储层                                   │
│  本地模型包目录 / Hive 元数据 / 热更新管理                     │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 核心组件职责

#### 3.2.1 EdgeAI Manager（Dart 层）

统一入口，管理端侧 AI 能力的生命周期和调度。

```dart
/// 端侧 AI 引擎核心管理器
class EdgeAIManager {
  final _registry = InferenceCapabilityRegistry();
  final _deviceProfiler = DeviceProfiler();
  final _router = InferenceRouter();
  final _modelManager = ModelLifecycleManager();
  final _scheduler = InferenceScheduler();
  final _monitor = PerformanceMonitor();

  static EdgeAIManager? _instance;
  static EdgeAIManager get instance => _instance ??= EdgeAIManager._();

  EdgeAIManager._();

  /// 初始化（App启动阶段，异步非阻塞）
  Future<void> initialize() async {
    // 1. 设备性能评测（首次安装时执行，结果缓存）
    await _deviceProfiler.evaluate();
    
    // 2. 注册所有端侧能力
    _registerCapabilities();
    
    // 3. 加载已下载的模型元数据
    await _modelManager.loadMetadata();
    
    // 4. 预加载必要模型（根据设备分级决定）
    await _scheduler.preloadCriticalModels();
  }

  /// 统一推理入口
  Future<InferenceResult> infer(InferenceRequest request) async {
    // 1. 检查能力是否可用
    final capability = _registry.get(request.capabilityId);
    if (capability == null) {
      return InferenceResult.unavailable(
        reason: 'Capability not registered: ${request.capabilityId}',
      );
    }

    // 2. 路由决策：端侧 or 云端
    final decision = _router.decide(
      request: request,
      deviceTier: _deviceProfiler.currentTier,
      networkStatus: await _getNetworkStatus(),
      capability: capability,
    );

    // 3. 执行推理
    switch (decision.target) {
      case InferenceTarget.local:
        return await _executeLocal(capability, request);
      case InferenceTarget.cloud:
        return InferenceResult.redirectToCloud();
      case InferenceTarget.localThenCloud:
        final local = await _executeLocal(capability, request);
        if (local.confidence >= decision.confidenceThreshold) {
          return local;
        }
        return InferenceResult.redirectToCloud(localResult: local);
    }
  }
}
```

#### 3.2.2 能力注册表

```dart
/// 端侧推理能力定义
class InferenceCapability {
  final String id;
  final String name;
  final String modelAssetPath;      // 本地模型文件路径
  final String modelVersion;
  final int modelSizeBytes;
  final DeviceTier minTier;          // 最低设备等级
  final Set<DelegateType> preferredDelegates;  // 首选加速器
  final Duration maxInferenceTime;
  final bool preloadOnStartup;       // 是否启动时预加载
  final bool supportOffline;         // 是否支持离线使用

  const InferenceCapability({
    required this.id,
    required this.name,
    required this.modelAssetPath,
    required this.modelVersion,
    required this.modelSizeBytes,
    required this.minTier,
    required this.preferredDelegates,
    required this.maxInferenceTime,
    this.preloadOnStartup = false,
    this.supportOffline = true,
  });
}

/// 注册表实现
class InferenceCapabilityRegistry {
  final Map<String, InferenceCapability> _capabilities = {};

  void register(InferenceCapability capability) {
    _capabilities[capability.id] = capability;
  }

  InferenceCapability? get(String id) => _capabilities[id];

  List<InferenceCapability> get all => _capabilities.values.toList();

  /// 按设备等级过滤可用能力
  List<InferenceCapability> availableForTier(DeviceTier tier) {
    return _capabilities.values
        .where((c) => tier.index >= c.minTier.index)
        .toList();
  }
}

/// 能力 ID 常量
class CapabilityId {
  static const textDetection = 'text_detection';
  static const ocrLite = 'ocr_lite';
  static const handwritingMath = 'handwriting_math';
  static const imageClassify = 'image_classify';
  static const contentSafety = 'content_safety';
  static const vad = 'voice_activity_detection';
  static const textIntent = 'text_intent';
  static const gestureRecognize = 'gesture_recognize';
  static const mathVerifier = 'math_verifier';
}
```

#### 3.2.3 端/云路由决策器

```dart
/// 推理路由决策器
class InferenceRouter {
  /// 路由决策核心逻辑
  InferenceDecision decide({
    required InferenceRequest request,
    required DeviceTier deviceTier,
    required NetworkStatus networkStatus,
    required InferenceCapability capability,
  }) {
    // 离线模式：必须走端侧
    if (networkStatus == NetworkStatus.offline) {
      if (capability.supportOffline && deviceTier.index >= capability.minTier.index) {
        return InferenceDecision(
          target: InferenceTarget.local,
          reason: 'offline_mode',
          confidenceThreshold: 0.0,
        );
      }
      return InferenceDecision(
        target: InferenceTarget.unavailable,
        reason: 'offline_and_no_local_model',
      );
    }

    // 根据场景策略路由
    switch (request.routingStrategy) {
      case RoutingStrategy.localOnly:
        return InferenceDecision.local(reason: 'strategy_local_only');

      case RoutingStrategy.cloudOnly:
        return InferenceDecision.cloud(reason: 'strategy_cloud_only');

      case RoutingStrategy.localFirst:
        // 端侧优先，低置信度时回退云端
        if (deviceTier.index >= capability.minTier.index) {
          return InferenceDecision.localThenCloud(
            confidenceThreshold: request.confidenceThreshold ?? 0.85,
            reason: 'local_first_with_cloud_fallback',
          );
        }
        return InferenceDecision.cloud(reason: 'device_below_minimum_tier');

      case RoutingStrategy.cloudFirst:
        // 云端优先，网络差时回退端侧
        if (networkStatus.latencyMs > 2000 || !networkStatus.isStable) {
          if (deviceTier.index >= capability.minTier.index) {
            return InferenceDecision.local(reason: 'poor_network_fallback');
          }
        }
        return InferenceDecision.cloud(reason: 'cloud_first_stable_network');

      case RoutingStrategy.adaptive:
        return _adaptiveDecision(request, deviceTier, networkStatus, capability);
    }
  }

  /// 自适应路由：综合考虑设备、网络、模型特性
  InferenceDecision _adaptiveDecision(
    InferenceRequest request,
    DeviceTier deviceTier,
    NetworkStatus networkStatus,
    InferenceCapability capability,
  ) {
    final score = _calculateLocalScore(deviceTier, networkStatus, capability);
    
    if (score >= 0.8) {
      return InferenceDecision.local(reason: 'adaptive_high_score');
    } else if (score >= 0.5) {
      return InferenceDecision.localThenCloud(
        confidenceThreshold: 0.80,
        reason: 'adaptive_medium_score',
      );
    } else {
      return InferenceDecision.cloud(reason: 'adaptive_low_score');
    }
  }

  /// 本地推理适宜度评分 (0.0 ~ 1.0)
  double _calculateLocalScore(
    DeviceTier deviceTier,
    NetworkStatus networkStatus,
    InferenceCapability capability,
  ) {
    double score = 0.0;
    
    // 设备性能得分 (0~0.4)
    switch (deviceTier) {
      case DeviceTier.high: score += 0.4;
      case DeviceTier.mid: score += 0.25;
      case DeviceTier.low: score += 0.05;
    }
    
    // 网络质量得分 (0~0.3) — 网络越差越倾向本地
    if (networkStatus == NetworkStatus.offline) {
      score += 0.3;
    } else if (networkStatus.latencyMs > 1000) {
      score += 0.25;
    } else if (networkStatus.latencyMs > 300) {
      score += 0.15;
    } else {
      score += 0.05;
    }
    
    // 模型置信度得分 (0~0.3) — 根据历史统计
    final avgConfidence = PerformanceMonitor.instance
        .getAverageConfidence(capability.id);
    score += (avgConfidence ?? 0.5) * 0.3;
    
    return score.clamp(0.0, 1.0);
  }
}

/// 路由策略枚举
enum RoutingStrategy {
  localOnly,      // 仅端侧（隐私场景）
  cloudOnly,      // 仅云端（复杂推理）
  localFirst,     // 端侧优先（高频低延迟场景）
  cloudFirst,     // 云端优先（高质量优先场景）
  adaptive,       // 自适应（综合判断）
}

/// 路由决策结果
class InferenceDecision {
  final InferenceTarget target;
  final String reason;
  final double? confidenceThreshold; // localThenCloud 时使用

  const InferenceDecision({
    required this.target,
    required this.reason,
    this.confidenceThreshold,
  });

  factory InferenceDecision.local({required String reason}) =>
      InferenceDecision(target: InferenceTarget.local, reason: reason);

  factory InferenceDecision.cloud({required String reason}) =>
      InferenceDecision(target: InferenceTarget.cloud, reason: reason);

  factory InferenceDecision.localThenCloud({
    required double confidenceThreshold,
    required String reason,
  }) => InferenceDecision(
    target: InferenceTarget.localThenCloud,
    reason: reason,
    confidenceThreshold: confidenceThreshold,
  );

  factory InferenceDecision.unavailable({required String reason}) =>
      InferenceDecision(target: InferenceTarget.unavailable, reason: reason);
}

enum InferenceTarget { local, cloud, localThenCloud, unavailable }
```

---

## 4. 核心能力详细设计

### 4.1 文字区域检测（Text Detection）

#### 4.1.1 模型规格

| 属性 | 值 |
|------|-----|
| 模型名称 | `text_detect_v2.tflite` |
| 架构 | DBNet-Lite（可微分二值化） |
| 输入 | `[1, 640, 640, 3]` uint8 图片 |
| 输出 | `[1, 640, 640, 1]` float32 概率图 |
| 模型大小 | 4.2MB（量化后） |
| 推理延迟 | 30-80ms（GPU）/ 80-200ms（CPU） |
| 最低设备等级 | TIER_LOW |

#### 4.1.2 处理流程

```
输入图片 → 缩放至 640×640 → 推理 → 概率图二值化 → 轮廓提取 → 文字框坐标映射
```

#### 4.1.3 关键代码

```dart
class TextDetectionCapability {
  static const modelPath = 'assets/ai/text_detect_v2.tflite';
  
  Future<List<TextRegion>> detect(ui.Image image) async {
    final interpreter = await _getInterpreter();
    
    // 预处理：缩放 + 归一化
    final inputTensor = await _preprocess(image, targetSize: 640);
    
    // 推理
    final outputTensor = List.filled(1 * 640 * 640 * 1, 0.0)
        .reshape([1, 640, 640, 1]);
    final stopwatch = Stopwatch()..start();
    interpreter.run(inputTensor, outputTensor);
    stopwatch.stop();
    
    // 后处理：概率图 → 文字框
    final regions = _postprocess(outputTensor, 
      originalSize: Size(image.width.toDouble(), image.height.toDouble()));
    
    // 上报性能指标
    PerformanceMonitor.instance.reportInference(
      capabilityId: CapabilityId.textDetection,
      latencyMs: stopwatch.elapsedMilliseconds,
      regionCount: regions.length,
    );
    
    return regions;
  }

  List<TextRegion> _postprocess(List<dynamic> probMap, {required Size originalSize}) {
    const threshold = 0.3; // 二值化阈值
    final scaleX = originalSize.width / 640;
    final scaleY = originalSize.height / 640;
    
    // 提取高于阈值的连通区域
    final contours = _findContours(probMap, threshold);
    
    return contours.map((contour) {
      final rect = _boundingRect(contour);
      return TextRegion(
        rect: Rect.fromLTWH(rect.left * scaleX, rect.top * scaleY, 
                             rect.width * scaleX, rect.height * scaleY),
        confidence: _regionConfidence(probMap, contour),
        angle: _estimateRotation(contour),
      );
    }).toList();
  }
}

/// 文字区域数据结构
class TextRegion {
  final Rect rect;          // 文字框坐标（原图坐标系）
  final double confidence;  // 检测置信度
  final double angle;       // 旋转角度（度）

  const TextRegion({
    required this.rect,
    required this.confidence,
    required this.angle,
  });
}
```

### 4.2 印刷体 OCR Lite

#### 4.2.1 模型规格

| 属性 | 值 |
|------|-----|
| 模型名称 | `ocr_lite_v3.tflite` |
| 架构 | CRNN + CTC Loss |
| 输入 | `[1, 32, 320, 3]` uint8 文字行图片 |
| 输出 | `[1, 80, 5530]` float32 CTC 概率矩阵 |
| 词表大小 | 5,530 字符（中文常用字 + 英文 + 数字 + 符号） |
| 模型大小 | 12.8MB（动态量化） |
| 推理延迟 | 50-150ms/行 |
| 最低设备等级 | TIER_MID（TIER_LOW 降精度） |

#### 4.2.2 与云端 OCR 协作流程

```
拍照图片
  │
  ├── [端侧] 文字区域检测 → 得到文字行区域
  │
  ├── 网络判断
  │     │
  │     ├── 在线 → 将原图+区域信息发送云端精识别
  │     │         （端侧预处理减少云端计算量）
  │     │
  │     └── 离线/弱网 → 端侧 OCR Lite 逐行识别
  │                       （准确率 ~85%，满足基本需求）
  │
  └── 结果合并 → 输出结构化文字
```

#### 4.2.3 关键代码

```dart
class OcrLiteCapability {
  static const modelPath = 'assets/ai/ocr_lite_v3.tflite';
  
  Future<List<OcrLineResult>> recognize(List<ui.Image> lineImages) async {
    final interpreter = await _getInterpreter();
    final results = <OcrLineResult>[];
    
    for (final lineImg in lineImages) {
      // 预处理：缩放到 32×N，保持宽高比
      final resized = _resizeKeepingRatio(lineImg, height: 32);
      final input = _normalize(resized);
      
      // 推理
      final output = List.filled(1 * 80 * 5530, 0.0).reshape([1, 80, 5530]);
      interpreter.run(input, output);
      
      // CTC 解码
      final (text, confidence) = _ctcDecode(output, vocabulary: _vocab);
      results.add(OcrLineResult(text: text, confidence: confidence));
    }
    
    return results;
  }

  /// CTC 贪心解码
  (String, double) _ctcDecode(List<dynamic> output, {required List<String> vocabulary}) {
    final seqLen = output[0].length;
    final chars = <String>[];
    final confidences = <double>[];
    int prevIdx = 0; // blank index = 0
    
    for (int t = 0; t < seqLen; t++) {
      // 找到最大概率的字符索引
      int maxIdx = 0;
      double maxProb = output[0][t][0];
      for (int c = 1; c < vocabulary.length; c++) {
        if (output[0][t][c] > maxProb) {
          maxProb = output[0][t][c];
          maxIdx = c;
        }
      }
      
      // CTC 合并重复和 blank
      if (maxIdx != 0 && maxIdx != prevIdx) {
        chars.add(vocabulary[maxIdx]);
        confidences.add(maxProb);
      }
      prevIdx = maxIdx;
    }
    
    final avgConf = confidences.isEmpty 
        ? 0.0 
        : confidences.reduce((a, b) => a + b) / confidences.length;
    return (chars.join(), avgConf);
  }
}

class OcrLineResult {
  final String text;
  final double confidence;
  
  const OcrLineResult({required this.text, required this.confidence});
}
```

### 4.3 手写数学符号识别

#### 4.3.1 模型规格

| 属性 | 值 |
|------|-----|
| 模型名称 | `handwrite_math_v2.tflite` |
| 架构 | CNN + BiLSTM + Attention |
| 输入 | 笔画序列 `[N, 4]`（x, y, pressure, time_delta） |
| 输出 | LaTeX token 序列 |
| 符号集 | 180 个数学符号/结构 |
| 模型大小 | 6.5MB（int8 量化） |
| 推理延迟 | 50-150ms |
| 最低设备等级 | TIER_MID |

#### 4.3.2 关键代码

```dart
class HandwritingMathCapability {
  static const modelPath = 'assets/ai/handwrite_math_v2.tflite';
  
  /// 从笔画数据生成 LaTeX
  Future<HandwritingResult> recognize(List<Stroke> strokes) async {
    final interpreter = await _getInterpreter();
    
    // 笔迹预处理：归一化坐标、重采样、分组
    final input = _encodeStrokes(strokes);
    
    // 推理
    final output = <int>[];
    final state = _initState();
    
    // 自回归解码（最大 128 tokens）
    for (int step = 0; step < 128; step++) {
      final (token, newState) = _decodeStep(interpreter, input, state, step);
      if (token == _eosToken) break;
      output.add(token);
      state = newState;
    }
    
    // Token → LaTeX 字符串
    final latex = _tokensToLatex(output);
    
    return HandwritingResult(
      latex: latex,
      confidence: _calculateConfidence(state),
    );
  }
}

class Stroke {
  final List<Offset> points;
  final List<double> pressures;
  final List<int> timestamps;
  
  const Stroke({required this.points, required this.pressures, required this.timestamps});
}

class HandwritingResult {
  final String latex;
  final double confidence;
  
  const HandwritingResult({required this.latex, required this.confidence});
}
```

### 4.4 内容安全预检

#### 4.4.1 模型规格

| 属性 | 值 |
|------|-----|
| 模型名称 | `content_safety_v1.tflite` |
| 架构 | MobileNetV3-Small 分类头 |
| 输入 | `[1, 224, 224, 3]` uint8 图片 |
| 输出 | `[1, 4]` float32 分类概率（safe/unsafe_borderline/unsafe/review_required） |
| 模型大小 | 2.8MB |
| 推理延迟 | 20-50ms |
| 最低设备等级 | TIER_LOW |

#### 4.4.2 协作流程

```
用户上传图片
  │
  ├── [端侧] 内容安全预检（20-50ms）
  │     │
  │     ├── safe → 正常提交云端处理
  │     ├── unsafe → 直接拦截，不上传（保护隐私）
  │     ├── review_required → 提交云端精审
  │     └── unsafe_borderline → 提交云端精审，标记优先级
  │
  └── 云端精审（完整内容安全管线）
```

#### 4.4.3 关键代码

```dart
class ContentSafetyCapability {
  static const modelPath = 'assets/ai/content_safety_v1.tflite';
  
  Future<SafetyCheckResult> check(ui.Image image) async {
    final interpreter = await _getInterpreter();
    final input = await _preprocess(image, size: 224);
    
    final output = List.filled(4, 0.0).reshape([1, 4]);
    interpreter.run(input, output);
    
    final probs = output[0] as List<double>;
    final maxIdx = _argmax(probs);
    
    return SafetyCheckResult(
      level: SafetyLevel.values[maxIdx],
      confidence: probs[maxIdx],
      probabilities: {
        SafetyLevel.safe: probs[0],
        SafetyLevel.unsafeBorderline: probs[1],
        SafetyLevel.unsafe: probs[2],
        SafetyLevel.reviewRequired: probs[3],
      },
    );
  }
}

enum SafetyLevel {
  safe,              // 安全，无需审核
  unsafeBorderline,  // 边缘内容，需云端复审
  unsafe,            // 不安全，直接拦截
  reviewRequired,    // 需人工/云端审核
}

class SafetyCheckResult {
  final SafetyLevel level;
  final double confidence;
  final Map<SafetyLevel, double> probabilities;
  
  const SafetyCheckResult({
    required this.level,
    required this.confidence,
    required this.probabilities,
  });
  
  bool get shouldBlock => level == SafetyLevel.unsafe;
  bool get needsCloudReview => 
      level == SafetyLevel.reviewRequired || 
      level == SafetyLevel.unsafeBorderline;
}
```

### 4.5 语音活动检测（VAD）

#### 4.5.1 模型规格

| 属性 | 值 |
|------|-----|
| 模型名称 | `vad_silero_v4.tflite` |
| 架构 | Silero VAD（基于 RNN） |
| 输入 | `[1, 512]` float32 音频特征（16kHz, 30ms 帧） |
| 输出 | `[1, 1]` float32 语音概率 |
| 模型大小 | 0.9MB |
| 推理延迟 | < 2ms/帧 |
| 最低设备等级 | TIER_LOW |

#### 4.5.2 关键代码

```dart
class VadCapability {
  static const modelPath = 'assets/ai/vad_silero_v4.tflite';
  static const speechThreshold = 0.5;
  static const silenceDurationMs = 600; // 静音超时判定
  static const maxSpeechDurationMs = 30000; // 最长单次语音
  
  final _audioStream = StreamController<AudioFrame>.broadcast();
  StreamSubscription? _subscription;
  
  /// 启动 VAD 监听
  Stream<VadEvent> start() {
    final eventStream = StreamController<VadEvent>();
    bool isSpeaking = false;
    int silenceStart = 0;
    int speechStart = 0;
    
    _subscription = _audioStream.stream.listen((frame) {
      final probability = _infer(frame);
      final now = DateTime.now().millisecondsSinceEpoch;
      
      if (probability > speechThreshold) {
        if (!isSpeaking) {
          isSpeaking = true;
          speechStart = now;
          eventStream.add(VadEvent.speechStart);
        }
        silenceStart = 0;
      } else {
        if (isSpeaking) {
          if (silenceStart == 0) silenceStart = now;
          
          // 静音超时 → 语音结束
          if (now - silenceStart > silenceDurationMs) {
            isSpeaking = false;
            eventStream.add(VadEvent.speechEnd(
              durationMs: silenceStart - speechStart,
            ));
          }
          
          // 单次语音超时
          if (now - speechStart > maxSpeechDurationMs) {
            isSpeaking = false;
            eventStream.add(VadEvent.speechEnd(
              durationMs: now - speechStart,
              reason: 'max_duration_reached',
            ));
          }
        }
      }
    });
    
    return eventStream.stream;
  }
}

class VadEvent {
  final String type;
  final int? durationMs;
  final String? reason;
  
  const VadEvent({required this.type, this.durationMs, this.reason});
  
  factory VadEvent.speechStart() => const VadEvent(type: 'speech_start');
  factory VadEvent.speechEnd({int? durationMs, String? reason}) =>
      VadEvent(type: 'speech_end', durationMs: durationMs, reason: reason);
}
```

### 4.6 数学计算验证（规则引擎）

#### 4.6.1 设计说明

不需要 AI 模型，基于纯规则的本地数学计算验证引擎。用于：
- AI 回答中数学计算结果的快速校验
- 练习答题的即时批改
- 防止 AI 数学幻觉

#### 4.6.2 关键代码

```dart
class MathVerifier {
  /// 验证数学表达式计算结果
  MathVerifyResult verify(String expression, String claimedResult) {
    try {
      // 1. 表达式归一化
      final normalized = _normalize(expression);
      
      // 2. 安全解析（防注入）
      final parsed = _safeParse(normalized);
      if (parsed == null) {
        return MathVerifyResult.unverifiable('Failed to parse expression');
      }
      
      // 3. 计算精确结果
      final computed = _evaluate(parsed);
      
      // 4. 数值比较（考虑浮点误差）
      final resultNum = _parseNumber(claimedResult);
      if (resultNum == null) {
        return MathVerifyResult.unverifiable('Cannot parse claimed result');
      }
      
      final diff = (computed - resultNum).abs();
      final tolerance = computed.abs() * 1e-8 + 1e-12;
      
      if (diff < tolerance) {
        return MathVerifyResult.correct(computedValue: computed);
      } else {
        return MathVerifyResult.incorrect(
          computedValue: computed, 
          claimedValue: resultNum,
          deviation: diff,
        );
      }
    } catch (e) {
      return MathVerifyResult.unverifiable(e.toString());
    }
  }
  
  /// 安全表达式解析（白名单字符集）
  dynamic _safeParse(String expr) {
    // 仅允许：数字、运算符、括号、小数点、常见数学函数
    final allowed = RegExp(r'^[\d+\-*/().^%\s,sincotaglqrtpewbELPI]+$');
    if (!allowed.hasMatch(expr)) return null;
    return _shuntingYard(expr);
  }
}

class MathVerifyResult {
  final bool isCorrect;
  final double? computedValue;
  final double? claimedValue;
  final double? deviation;
  final String? unverifiableReason;
  
  const MathVerifyResult({
    required this.isCorrect,
    this.computedValue,
    this.claimedValue,
    this.deviation,
    this.unverifiableReason,
  });
  
  factory MathVerifyResult.correct({required double computedValue}) =>
      MathVerifyResult(isCorrect: true, computedValue: computedValue);
  
  factory MathVerifyResult.incorrect({
    required double computedValue,
    required double claimedValue,
    required double deviation,
  }) => MathVerifyResult(
    isCorrect: false,
    computedValue: computedValue,
    claimedValue: claimedValue,
    deviation: deviation,
  );
  
  factory MathVerifyResult.unverifiable(String reason) =>
      MathVerifyResult(isCorrect: false, unverifiableReason: reason);
}
```

---

## 5. 模型生命周期管理

### 5.1 模型包结构

```
assets/ai/
├── manifest.json                        # 模型清单
├── text_detect_v2.tflite               # 文字区域检测
├── ocr_lite_v3.tflite                  # 印刷体 OCR
├── handwrite_math_v2.tflite            # 手写数学
├── content_safety_v1.tflite            # 内容安全
├── vad_silero_v4.tflite                # VAD
├── image_classify_v1.tflite            # 图像分类
├── text_intent_v1.tflite               # 文本意图
├── vocab_ocr_lite.txt                  # OCR 词表
├── vocab_handwrite_math.txt            # 手写数学词表
└── labels_image_classify.txt           # 图像分类标签
```

### 5.2 模型清单文件（manifest.json）

```json
{
  "version": "2.3.0",
  "models": [
    {
      "id": "text_detection",
      "fileName": "text_detect_v2.tflite",
      "version": "2.0.0",
      "sizeBytes": 4404016,
      "sha256": "a1b2c3d4...",
      "minTier": "low",
      "preloadOnStartup": true,
      "delegate": "gpu_preferred",
      "updatePriority": "normal",
      "requiredForOffline": true
    },
    {
      "id": "ocr_lite",
      "fileName": "ocr_lite_v3.tflite",
      "version": "3.0.0",
      "sizeBytes": 13434880,
      "sha256": "e5f6g7h8...",
      "minTier": "mid",
      "preloadOnStartup": false,
      "delegate": "gpu_preferred",
      "updatePriority": "normal",
      "requiredForOffline": true
    },
    {
      "id": "handwriting_math",
      "fileName": "handwrite_math_v2.tflite",
      "version": "2.0.0",
      "sizeBytes": 6815744,
      "sha256": "i9j0k1l2...",
      "minTier": "mid",
      "preloadOnStartup": false,
      "delegate": "gpu_preferred",
      "updatePriority": "normal",
      "requiredForOffline": false
    },
    {
      "id": "content_safety",
      "fileName": "content_safety_v1.tflite",
      "version": "1.0.0",
      "sizeBytes": 2936012,
      "sha256": "m3n4o5p6...",
      "minTier": "low",
      "preloadOnStartup": true,
      "delegate": "cpu_only",
      "updatePriority": "high",
      "requiredForOffline": true
    },
    {
      "id": "vad",
      "fileName": "vad_silero_v4.tflite",
      "version": "4.0.0",
      "sizeBytes": 943718,
      "sha256": "q7r8s9t0...",
      "minTier": "low",
      "preloadOnStartup": true,
      "delegate": "cpu_only",
      "updatePriority": "normal",
      "requiredForOffline": true
    }
  ],
  "totalSizeBytes": 28521270,
  "compatibleAppMinVersion": "1.5.0"
}
```

### 5.3 模型下载与更新流程

```
App 启动
  │
  ├── 检查本地 manifest.json
  │     │
  │     ├── 不存在（首次安装）→ 下载完整模型包
  │     │
  │     └── 已存在 → 比对服务端 manifest
  │           │
  │           ├── 版本一致 → 跳过
  │           │
  │           └── 有更新 → 按优先级下载差异模型
  │
  ├── 下载策略
  │     ├── WiFi 环境：后台静默下载
  │     ├── 蜂窝网络：仅下载 high priority 模型
  │     └── 离线：跳过，使用现有版本
  │
  └── 模型加载
        ├── TIER_HIGH：预加载全部已下载模型到内存
        ├── TIER_MID：按需加载，LRU 缓存 3 个
        └── TIER_LOW：按需加载，不缓存
```

### 5.4 模型管理器实现

```dart
class ModelLifecycleManager {
  final _metadataBox = Hive.box('ai_model_metadata');
  
  /// 检查并更新模型
  Future<void> checkUpdates() async {
    final localManifest = await _loadLocalManifest();
    final remoteManifest = await _fetchRemoteManifest();
    
    if (remoteManifest == null) return; // 网络不可用
    
    if (localManifest == null || localManifest.version != remoteManifest.version) {
      await _downloadUpdates(
        localModels: localManifest?.models ?? [],
        remoteModels: remoteManifest.models,
      );
    }
  }
  
  Future<void> _downloadUpdates({
    required List<ModelEntry> localModels,
    required List<ModelEntry> remoteModels,
  }) async {
    final networkStatus = await _getNetworkStatus();
    
    for (final remote in remoteModels) {
      final local = localModels.where((m) => m.id == remote.id).firstOrNull;
      
      // 检查是否需要更新
      if (local != null && local.version == remote.version) continue;
      
      // 检查设备是否支持
      final deviceTier = DeviceProfiler.instance.currentTier;
      if (deviceTier.index < _tierIndex(remote.minTier)) continue;
      
      // 蜂窝网络只下载高优先级模型
      if (!networkStatus.isWifi && remote.updatePriority != 'high') continue;
      
      // 检查存储空间
      if (!await _hasEnoughSpace(remote.sizeBytes)) continue;
      
      // 下载 + 校验
      await _downloadAndVerify(remote);
    }
  }
  
  Future<void> _downloadAndVerify(ModelEntry entry) async {
    // 通过资源包下载管理器下载
    final filePath = await ResourceDownloadManager.instance.download(
      url: '${Config.cdnBase}/ai-models/${entry.fileName}',
      targetPath: 'ai/${entry.fileName}',
      expectedSize: entry.sizeBytes,
    );
    
    // SHA-256 校验
    final hash = await _computeSha256(filePath);
    if (hash != entry.sha256) {
      await File(filePath).delete();
      throw ModelIntegrityError(entry.id, 'SHA256 mismatch');
    }
    
    // 更新元数据
    _metadataBox.put('model_${entry.id}', {
      'version': entry.version,
      'filePath': filePath,
      'downloadedAt': DateTime.now().toIso8601String(),
      'verified': true,
    });
  }
  
  /// 加载模型（懒加载）
  Future<Interpreter> loadModel(String capabilityId) async {
    final metadata = _metadataBox.get('model_$capabilityId');
    if (metadata == null) throw ModelNotFoundError(capabilityId);
    
    final options = InterpreterOptions();
    
    // 根据设备选择 delegate
    final capability = InferenceCapabilityRegistry.instance.get(capabilityId)!;
    final tier = DeviceProfiler.instance.currentTier;
    
    for (final delegateType in capability.preferredDelegates) {
      if (await _isDelegateAvailable(delegateType, tier)) {
        options.addDelegate(_createDelegate(delegateType));
        break;
      }
    }
    
    return Interpreter.fromFile(
      File(metadata['filePath']),
      options: options,
    );
  }
}
```

---

## 6. 推理调度与性能管理

### 6.1 推理调度器

```dart
class InferenceScheduler {
  final _runningInferences = <String, Future<InferenceResult>>{};
  final _queue = PriorityQueue<InferenceRequest>(
    (a, b) => a.priority.index.compareTo(b.priority.index),
  );
  
  /// 提交推理任务
  Future<InferenceResult> submit(InferenceRequest request) async {
    // 防止同一能力的重复推理（取最新请求）
    if (_runningInferences.containsKey(request.capabilityId)) {
      // 如果是同一输入的重复请求，共享结果
      if (request.dedupKey != null) {
        return _runningInferences[request.capabilityId]!;
      }
    }
    
    // 检查并发限制
    final maxConcurrent = _getMaxConcurrentForTier();
    if (_runningInferences.length >= maxConcurrent) {
      if (request.priority == InferencePriority.low) {
        return InferenceResult.deferred('Too many concurrent inferences');
      }
      // 高优先级：排队等待
      _queue.add(request);
      return _processQueue();
    }
    
    return _execute(request);
  }
  
  Future<InferenceResult> _execute(InferenceRequest request) async {
    final future = EdgeAIManager.instance.infer(request);
    _runningInferences[request.capabilityId] = future;
    
    try {
      final result = await future.timeout(request.timeout);
      return result;
    } on TimeoutException {
      return InferenceResult.timeout(request.capabilityId);
    } finally {
      _runningInferences.remove(request.capabilityId);
      _processQueue(); // 处理队列中的下一个
    }
  }
  
  int _getMaxConcurrentForTier() {
    switch (DeviceProfiler.instance.currentTier) {
      case DeviceTier.high: return 3;
      case DeviceTier.mid: return 2;
      case DeviceTier.low: return 1;
    }
  }
}

enum InferencePriority { high, normal, low }

class InferenceRequest {
  final String capabilityId;
  final Map<String, dynamic> input;
  final InferencePriority priority;
  final RoutingStrategy routingStrategy;
  final Duration timeout;
  final String? dedupKey;
  final double? confidenceThreshold;
  
  const InferenceRequest({
    required this.capabilityId,
    required this.input,
    this.priority = InferencePriority.normal,
    this.routingStrategy = RoutingStrategy.adaptive,
    this.timeout = const Duration(seconds: 2),
    this.dedupKey,
    this.confidenceThreshold,
  });
}
```

### 6.2 性能监控

```dart
class PerformanceMonitor {
  static PerformanceMonitor get instance => _instance;
  static final PerformanceMonitor _instance = PerformanceMonitor._();
  
  final _metrics = <String, List<InferenceMetric>>{};
  
  void reportInference({
    required String capabilityId,
    required int latencyMs,
    int? regionCount,
    double? confidence,
    DelegateType? delegateUsed,
    bool? success,
  }) {
    final metric = InferenceMetric(
      capabilityId: capabilityId,
      latencyMs: latencyMs,
      regionCount: regionCount,
      confidence: confidence,
      delegateUsed: delegateUsed,
      success: success ?? true,
      timestamp: DateTime.now(),
    );
    
    _metrics.putIfAbsent(capabilityId, () => []).add(metric);
    
    // 保留最近 100 条
    if (_metrics[capabilityId]!.length > 100) {
      _metrics[capabilityId]!.removeAt(0);
    }
    
    // 性能告警
    _checkAlerts(metric);
  }
  
  double? getAverageConfidence(String capabilityId) {
    final metrics = _metrics[capabilityId];
    if (metrics == null || metrics.isEmpty) return null;
    return metrics.map((m) => m.confidence ?? 0.5).reduce((a, b) => a + b) / metrics.length;
  }
  
  void _checkAlerts(InferenceMetric metric) {
    // 推理超时告警
    if (metric.latencyMs > 1000) {
      _reportSlowInference(metric);
    }
    
    // 低置信度告警
    if (metric.confidence != null && metric.confidence! < 0.5) {
      _reportLowConfidence(metric);
    }
    
    // 推理失败告警
    if (!metric.success) {
      _reportInferenceFailure(metric);
    }
  }
}

class InferenceMetric {
  final String capabilityId;
  final int latencyMs;
  final int? regionCount;
  final double? confidence;
  final DelegateType? delegateUsed;
  final bool success;
  final DateTime timestamp;
  
  const InferenceMetric({
    required this.capabilityId,
    required this.latencyMs,
    this.regionCount,
    this.confidence,
    this.delegateUsed,
    required this.success,
    required this.timestamp,
  });
}
```

---

## 7. 离线模式集成

### 7.1 离线能力矩阵

| 场景 | 在线行为 | 离线行为 |
|------|----------|----------|
| 拍题搜题 | 云端 OCR + AI 解析 | 端侧 OCR Lite → 缓存解析结果提示 |
| AI 问答 | 云端 LLM 生成 | 提示"需要网络"，引导离线工具使用 |
| 公式输入 | 端侧手写识别（默认） | 不受影响（纯端侧） |
| 语音输入 | 端侧 VAD + 云端 ASR | 端侧 VAD + 本地缓存提示 |
| 内容安全 | 端侧预检 + 云端精审 | 仅端侧预检，严格模式 |
| 练习答题 | 云端批改 | 端侧批改（客观题完整，主观题降级） |
| 数学验证 | 端侧规则引擎（默认） | 不受影响（纯端侧） |

### 7.2 离线模式管理器

```dart
class OfflineAIManager {
  final _connectivity = Connectivity();
  
  /// 获取当前可用的端侧 AI 能力
  Future<Set<String>> getAvailableOfflineCapabilities() async {
    final deviceTier = DeviceProfiler.instance.currentTier;
    final allCapabilities = InferenceCapabilityRegistry.instance.all;
    
    final available = <String>{};
    for (final cap in allCapabilities) {
      if (!cap.supportOffline) continue;
      if (deviceTier.index < _tierIndex(cap.minTier)) continue;
      if (!await _isModelDownloaded(cap.id)) continue;
      
      available.add(cap.id);
    }
    return available;
  }
  
  /// 离线模式下的降级提示
  OfflineFallbackHint getFallbackHint(String capabilityId) {
    switch (capabilityId) {
      case CapabilityId.ocrLite:
        return OfflineFallbackHint(
          message: '当前为离线模式，识别准确率可能降低',
          suggestion: '连接网络后可获取更精准的解析',
          severity: HintSeverity.warning,
        );
      case CapabilityId.textDetection:
        return OfflineFallbackHint(
          message: '离线模式可识别文字区域',
          suggestion: '连接网络后可获取完整解析',
          severity: HintSeverity.info,
        );
      default:
        return OfflineFallbackHint(
          message: '此功能需要网络连接',
          suggestion: '请连接网络后重试',
          severity: HintSeverity.error,
        );
    }
  }
}
```

---

## 8. 与云端 AI 的协作模式

### 8.1 协作模式总览

```
┌──────────────────────────────────────────────────┐
│                  协作模式                          │
├─────────────┬────────────────────────────────────┤
│ 端侧预处理   │ 端侧完成低级预处理，云端做高级推理     │
│ 端侧优先     │ 端侧推理，低置信度时请求云端           │
│ 云端优先     │ 云端推理，网络差时回退端侧             │
│ 端侧兜底     │ 离线时端侧提供降级能力                │
│ 端侧校验     │ 云端推理后，端侧做结果校验             │
└─────────────┴────────────────────────────────────┘
```

### 8.2 端侧校验云端结果

```dart
class CloudResultVerifier {
  /// 用端侧模型校验云端 AI 的数学计算结果
  Future<VerificationResult> verifyMathResult(
    String expression,
    String cloudAnswer,
  ) async {
    final localResult = MathVerifier().verify(expression, cloudAnswer);
    
    switch (localResult) {
      case MathVerifyResult(:final isCorrect) when isCorrect:
        return VerificationResult.verified();
      
      case MathVerifyResult(:final isCorrect, :final computedValue) 
          when !isCorrect && computedValue != null:
        // 端侧计算与云端不一致 → 标记存疑
        return VerificationResult.conflict(
          localValue: computedValue,
          cloudValue: double.tryParse(cloudAnswer),
          recommendation: '建议二次确认计算结果',
        );
      
      default:
        // 无法验证
        return VerificationResult unverifiable();
    }
  }
}
```

---

## 9. API 接口设计

### 9.1 客户端内部 API（Dart）

所有端侧 AI 能力通过 `EdgeAIManager` 统一调用：

```dart
// 示例 1：拍题场景 - 文字区域检测
final regions = await EdgeAIManager.instance.infer(
  InferenceRequest(
    capabilityId: CapabilityId.textDetection,
    input: {'image': capturedImage},
    routingStrategy: RoutingStrategy.localOnly,
    timeout: Duration(milliseconds: 200),
  ),
);

// 示例 2：离线 OCR 识别
final ocrResult = await EdgeAIManager.instance.infer(
  InferenceRequest(
    capabilityId: CapabilityId.ocrLite,
    input: {'lineImages': lineImages},
    routingStrategy: RoutingStrategy.localFirst,
    confidenceThreshold: 0.85,
  ),
);

// 示例 3：内容安全预检
final safetyResult = await EdgeAIManager.instance.infer(
  InferenceRequest(
    capabilityId: CapabilityId.contentSafety,
    input: {'image': uploadImage},
    routingStrategy: RoutingStrategy.localOnly,
    priority: InferencePriority.high,
  ),
);

// 示例 4：手写公式识别
final mathResult = await EdgeAIManager.instance.infer(
  InferenceRequest(
    capabilityId: CapabilityId.handwritingMath,
    input: {'strokes': currentStrokes},
    routingStrategy: RoutingStrategy.localOnly,
  ),
);

// 示例 5：语音活动检测（流式）
final vadStream = VadCapability().start();
vadStream.listen((event) {
  if (event.type == 'speech_end') {
    // 语音结束，发送给 ASR
    _sendToASR(audioBuffer);
  }
});
```

### 9.2 推理结果统一结构

```dart
class InferenceResult {
  final bool success;
  final Map<String, dynamic>? data;
  final double? confidence;
  final InferenceTarget actualTarget; // 实际执行位置
  final int latencyMs;
  final String? errorMessage;
  final bool redirectToCloud;
  final InferenceResult? localResult; // localThenCloud 时的端侧结果

  const InferenceResult({
    required this.success,
    this.data,
    this.confidence,
    required this.actualTarget,
    required this.latencyMs,
    this.errorMessage,
    this.redirectToCloud = false,
    this.localResult,
  });

  factory InferenceResult.ok({
    required Map<String, dynamic> data,
    required double confidence,
    required InferenceTarget target,
    required int latencyMs,
  }) => InferenceResult(
    success: true,
    data: data,
    confidence: confidence,
    actualTarget: target,
    latencyMs: latencyMs,
  );

  factory InferenceResult.unavailable({required String reason}) =>
      InferenceResult(
        success: false,
        actualTarget: InferenceTarget.unavailable,
        latencyMs: 0,
        errorMessage: reason,
      );

  factory InferenceResult.redirectToCloud({InferenceResult? localResult}) =>
      InferenceResult(
        success: true,
        actualTarget: InferenceTarget.local,
        redirectToCloud: true,
        localResult: localResult,
        latencyMs: localResult?.latencyMs ?? 0,
      );

  factory InferenceResult.timeout(String capabilityId) => InferenceResult(
    success: false,
    actualTarget: InferenceTarget.local,
    latencyMs: 0,
    errorMessage: 'Inference timeout: $capabilityId',
  );

  factory InferenceResult.deferred(String reason) => InferenceResult(
    success: false,
    actualTarget: InferenceTarget.unavailable,
    latencyMs: 0,
    errorMessage: 'Deferred: $reason',
  );
}
```

---

## 10. 错误处理

### 10.1 错误码体系

| 错误码 | 含义 | 处理策略 |
|--------|------|----------|
| `EDGE_MODEL_NOT_FOUND` | 模型文件不存在 | 降级到云端 |
| `EDGE_MODEL_INTEGRITY` | 模型 SHA-256 校验失败 | 删除并重新下载 |
| `EDGE_MODEL_LOAD_FAIL` | 模型加载失败 | 降级到云端，上报监控 |
| `EDGE_INFER_TIMEOUT` | 推理超时 | 降级到云端 |
| `EDGE_INFER_OOM` | 推理内存不足 | 释放缓存，降级到云端 |
| `EDGE_DELEGATE_FAIL` | 加速器不可用 | 回退到 CPU 推理 |
| `EDGE_TIER_UNSUPPORTED` | 设备等级不支持该能力 | 直接走云端 |
| `EDGE_INPUT_INVALID` | 输入格式错误 | 返回错误，不入队列 |
| `EDGE_OFFLINE_NO_MODEL` | 离线且无本地模型 | 提示用户需要网络 |

### 10.2 错误处理流程

```dart
Future<InferenceResult> _executeLocal(
  InferenceCapability capability,
  InferenceRequest request,
) async {
  try {
    final interpreter = await ModelLifecycleManager.instance.loadModel(capability.id);
    // ... 推理逻辑
    return result;
    
  } on FileSystemException {
    // 模型文件丢失
    _reportError(EdgeError(EdgeErrorCode.modelNotFound, capability.id));
    return InferenceResult.redirectToCloud();
    
  } on PlatformException catch (e) {
    if (e.code == 'DELEGATE_NOT_AVAILABLE') {
      // GPU/NPU 不可用，回退 CPU
      _reportError(EdgeError(EdgeErrorCode.delegateFail, capability.id));
      return await _executeWithCpuFallback(capability, request);
    }
    if (e.message?.contains('OOM') == true) {
      // 内存不足，释放缓存
      _reportError(EdgeError(EdgeErrorCode.inferOom, capability.id));
      InferenceScheduler.instance.releaseIdleModels();
      return InferenceResult.redirectToCloud();
    }
    return InferenceResult.unavailable(reason: e.message ?? 'Unknown platform error');
    
  } on TimeoutException {
    _reportError(EdgeError(EdgeErrorCode.inferTimeout, capability.id));
    return InferenceResult.redirectToCloud();
    
  } catch (e, stack) {
    _reportError(EdgeError(EdgeErrorCode.unknown, capability.id, 
        detail: e.toString(), stackTrace: stack.toString()));
    return InferenceResult.unavailable(reason: e.toString());
  }
}
```

---

## 11. 性能指标与监控

### 11.1 核心指标

| 指标 | 采集方式 | 目标值 |
|------|----------|--------|
| 端侧推理成功率 | 客户端埋点 | ≥ 99% |
| 端侧推理平均延迟 | PerformanceMonitor | 按能力目标 |
| 端云切换率 | 路由决策统计 | < 20%（在线时） |
| 模型加载时间 | 模型管理器埋点 | < 500ms（热加载） |
| 模型更新成功率 | 下载管理器统计 | ≥ 95% |
| 离线 AI 可用率 | 离线场景测试 | ≥ 90%（TIER_MID+） |
| 内存峰值增量 | 内存监控 | < 100MB |
| CPU 峰值占用 | 性能监控 | < 80%（推理期间） |

### 11.2 监控上报

```dart
class EdgeAIMetricsReporter {
  static const _batchSize = 20;
  static const _flushInterval = Duration(minutes: 5);
  
  final _buffer = <EdgeAIMetric>[];
  Timer? _flushTimer;
  
  void record(EdgeAIMetric metric) {
    _buffer.add(metric);
    
    if (_buffer.length >= _batchSize) {
      _flush();
    } else {
      _flushTimer ??= Timer(_flushInterval, _flush);
    }
  }
  
  void _flush() {
    _flushTimer?.cancel();
    _flushTimer = null;
    
    if (_buffer.isEmpty) return;
    
    final batch = List<EdgeAIMetric>.from(_buffer);
    _buffer.clear();
    
    // 上报到数据埋点系统
    DataTracker.instance.trackBatch(
      event: 'edge_ai_inference',
      properties: batch.map((m) => {
        'capability_id': m.capabilityId,
        'target': m.actualTarget.name,
        'latency_ms': m.latencyMs,
        'confidence': m.confidence,
        'success': m.success,
        'delegate': m.delegateUsed?.name ?? 'none',
        'device_tier': DeviceProfiler.instance.currentTier.name,
        'routing_reason': m.routingReason,
      }).toList(),
    );
  }
}
```

---

## 12. 客户端 Flutter 集成指南

### 12.1 依赖配置

```yaml
# pubspec.yaml
dependencies:
  tflite_flutter: ^0.11.0     # TFLite 运行时
  path_provider: ^2.1.0        # 文件路径
  hive: ^2.2.3                 # 本地元数据存储
  connectivity_plus: ^6.0.0    # 网络状态检测
  device_info_plus: ^10.0.0    # 设备信息采集
  flutter_cache_manager: ^3.4.0 # 缓存管理
```

### 12.2 初始化流程

```dart
// 在 main.dart 中初始化
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // 初始化本地存储
  await Hive.initFlutter();
  await Hive.openBox('ai_model_metadata');
  
  // 初始化端侧 AI（异步，不阻塞启动）
  EdgeAIManager.instance.initialize().catchError((e) {
    // 初始化失败不影响 App 启动
    debugPrint('EdgeAI init failed: $e');
  });
  
  runApp(const PrimeTopApp());
}
```

### 12.3 业务模块集成示例

```dart
// 拍题模块集成示例
class PhotoQuestionBloc extends Bloc<PhotoQuestionEvent, PhotoQuestionState> {
  
  Future<void> _onPhotoCaptured(PhotoCaptured event, Emitter emit) async {
    // Step 1: 端侧内容安全预检
    final safetyResult = await EdgeAIManager.instance.infer(
      InferenceRequest(
        capabilityId: CapabilityId.contentSafety,
        input: {'image': event.image},
        routingStrategy: RoutingStrategy.localOnly,
        priority: InferencePriority.high,
      ),
    );
    
    if (safetyResult.success && safetyResult.data?['shouldBlock'] == true) {
      emit(PhotoQuestionState.contentBlocked());
      return;
    }
    
    // Step 2: 端侧文字区域检测
    final detectionResult = await EdgeAIManager.instance.infer(
      InferenceRequest(
        capabilityId: CapabilityId.textDetection,
        input: {'image': event.image},
        routingStrategy: RoutingStrategy.localOnly,
      ),
    );
    
    if (!detectionResult.success || detectionResult.data?['regions'] == null) {
      emit(PhotoQuestionState.detectionFailed());
      return;
    }
    
    final regions = detectionResult.data!['regions'] as List<TextRegion>;
    
    // Step 3: 显示检测区域让用户选择
    emit(PhotoQuestionState.regionsDetected(regions: regions));
  }
}
```

---

## 13. 容量与存储规划

### 13.1 模型包体积

| 分级 | 必需模型 | 可选模型 | 总体积 |
|------|----------|----------|--------|
| TIER_LOW | VAD + 内容安全 + 文字检测 + 数学验证 | 无 | ~8MB |
| TIER_MID | 全部必需 + OCR Lite + 手写数学 | 图像分类 + 文本意图 | ~35MB |
| TIER_HIGH | 全部模型 | 无 | ~50MB |

### 13.2 运行时内存估算

| 场景 | 模型占用内存 | 推理临时内存 | 合计 |
|------|-------------|-------------|------|
| 文字检测 | ~15MB | ~10MB | ~25MB |
| OCR Lite | ~40MB | ~20MB | ~60MB |
| 手写数学 | ~20MB | ~10MB | ~30MB |
| 内容安全 | ~10MB | ~5MB | ~15MB |
| VAD | ~3MB | ~2MB | ~5MB |
| 并发最大（TIER_HIGH） | ~80MB | ~40MB | ~120MB |

---

## 14. 安全考量

### 14.1 模型安全

1. **完整性校验**：所有模型下载后必须通过 SHA-256 校验
2. **来源验证**：模型只从官方 CDN 下载，支持 HTTPS 证书锁定
3. **版本管控**：模型版本与 App 版本绑定，防止版本不匹配
4. **防篡改**：模型文件存储在 App 私有目录，拒绝外部访问

### 14.2 推理安全

1. **输入验证**：所有推理输入经过大小、格式、范围校验
2. **超时保护**：所有推理操作必须设置超时，防止无限阻塞
3. **内存保护**：推理前检查可用内存，不足时拒绝推理
4. **隐私保护**：端侧推理产生的临时数据使用后立即清除

### 14.3 ZIP 炸弹 / 恶意模型防护

```dart
class ModelSecurityChecker {
  /// 校验模型文件安全性
  Future<bool> validateModelFile(String path, ModelEntry entry) async {
    final file = File(path);
    
    // 1. 大小校验（不超过声明大小的 110%）
    final actualSize = await file.length();
    if (actualSize > entry.sizeBytes * 1.1) {
      return false;
    }
    
    // 2. SHA-256 完整性校验
    final hash = await _computeSha256(path);
    if (hash != entry.sha256) {
      return false;
    }
    
    // 3. TFLite 文件头魔数校验
    final header = await _readFileHeader(path, 4);
    if (!_isValidTfliteHeader(header)) {
      return false;
    }
    
    return true;
  }
}
```
