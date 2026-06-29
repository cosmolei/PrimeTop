# 客户端-数学手写公式识别与LaTeX实时转换引擎 详细设计

## 1. 概述

### 1.1 模块定位

数学手写公式识别与 LaTeX 实时转换引擎是 PrimeTop 客户端的核心学科交互组件之一。它允许学生通过手指或触控笔在屏幕上手写数学公式（分式、根号、上下标、积分、求和、矩阵等），系统实时将手写笔迹转换为标准 LaTeX 代码并进行渲染预览，供 AI 辅导、拍题补录、错题订正、作文公式插入等场景使用。

### 1.2 核心职责

| 职责 | 说明 |
| --- | --- |
| 笔迹采集 | 高精度采集触控/手写笔的笔迹轨迹（坐标、压感、时间戳） |
| 实时渲染 | 将原始笔迹以墨迹效果实时绘制在 Canvas 上，提供自然书写体验 |
| 笔迹预处理 | 平滑、去噪、归一化、笔画分割 |
| 识别请求 | 将笔迹数据发送至识别服务（端侧轻量模型 + 云端高精度模型双层策略） |
| LaTeX 转换 | 将识别结果转换为标准 LaTeX 字符串 |
| 候选选择 | 提供多候选识别结果供用户选择/修正 |
| 实时预览 | 将 LaTeX 渲染为数学公式进行实时预览 |
| 结果输出 | 将最终 LaTeX 输出至 AI 对话、题目编辑器等下游模块 |

### 1.3 依赖关系

```
┌─────────────────────────────────────────────────────┐
│              手写公式识别与转换引擎                     │
├─────────────┬───────────────┬───────────────────────┤
│  笔迹采集层  │  识别与转换层  │     渲染与交互层       │
│ (Flutter    │ (端侧推理 +   │ (Flutter Canvas +    │
│  Ink/Canvas)│  云端API)     │  flutter_math_fork)  │
└──────┬──────┴───────┬───────┴───────────┬───────────┘
       │              │                   │
       ▼              ▼                   ▼
  触控/手写笔     识别服务网关         下游模块
  硬件事件       /api/hwr/recognize   (AI对话, 题目编辑器,
                                       错题本, 作文等)
```

**上游依赖：**
- Flutter 框架的 GestureDetector / Pointer 事件系统
- 设备触控硬件（支持压感的优先）

**下游消费方：**
- AI 对话页面：手写公式插入到提问输入框
- 拍题补录：手动补写无法 OCR 识别的公式部分
- 错题订正：学生手写解题过程并提交批改
- 作文/笔记编辑器：插入数学公式
- 理科解题页面：手写输入方程式

### 1.4 与现有模块的边界

| 现有模块 | 边界说明 |
| --- | --- |
| `数学公式与学科符号输入系统` | 该模块负责**符号面板/键盘式**的公式输入（LaTeX 编辑器 + 符号选择器）。本模块负责**手写笔迹**的实时识别与转换，产出 LaTeX 后交付给该系统进行后续编辑 |
| `图片处理与OCR识别管线` | 该模块负责对**拍照图片**中的印刷/手写内容进行 OCR。本模块负责**实时手写过程**的笔迹识别，数据形态不同（矢量笔迹 vs 位图像素） |
| `客户端-AI对话消息Markdown流式渲染与学科公式排版引擎` | 该模块负责将 LaTeX/Markdown **渲染展示**。本模块负责**生成** LaTeX |
| `服务端-学生手写答案识别与手写体智能批改引擎` | 该模块负责对学生**拍照上传的答题图片**进行整页识别和批改。本模块是**客户端实时交互式**的公式输入工具 |

---

## 2. 数据模型

### 2.1 核心数据结构

#### 2.1.1 笔迹点（InkPoint）

```dart
/// 单个笔迹采样点
class InkPoint {
  final double x;          // X 坐标（逻辑像素，相对于画布左上角）
  final double y;          // Y 坐标
  final double pressure;   // 压感值 [0.0, 1.0]，无压感设备默认 0.5
  final int timestamp;     // 相对时间戳（毫秒，从笔画开始计时）

  const InkPoint({
    required this.x,
    required this.y,
    this.pressure = 0.5,
    required this.timestamp,
  });

  Map<String, dynamic> toJson() => {
    'x': x,
    'y': y,
    'p': pressure,
    't': timestamp,
  };
}
```

#### 2.1.2 笔画（InkStroke）

```dart
/// 一条连续笔画（从笔尖落下到抬起）
class InkStroke {
  final String id;                    // 笔画唯一ID（UUID v4）
  final List<InkPoint> points;        // 采样点序列
  final int startTimestamp;           // 笔画起始绝对时间戳（ms）
  final int duration;                 // 笔画持续时长（ms）
  final StrokeStyle style;            // 笔迹样式

  const InkStroke({
    required this.id,
    required this.points,
    required this.startTimestamp,
    required this.duration,
    required this.style,
  });

  Map<String, dynamic> toJson() => {
    'id': id,
    'pts': points.map((p) => p.toJson()).toList(),
    'ts': startTimestamp,
    'dur': duration,
    'style': style.toJson(),
  };
}

/// 笔迹渲染样式
class StrokeStyle {
  final double strokeWidth;   // 笔迹宽度（像素）
  final int color;            // ARGB 颜色值
  final bool isStylus;        // 是否来自手写笔（影响渲染平滑度）

  const StrokeStyle({
    this.strokeWidth = 2.5,
    this.color = 0xFF1A1A2E,
    this.isStylus = false,
  });

  Map<String, dynamic> toJson() => {
    'w': strokeWidth,
    'c': color,
    'stylus': isStylus,
  };
}
```

#### 2.1.3 笔迹画布（InkCanvas）

```dart
/// 完整的手写画布数据（一次手写公式的全部笔迹）
class InkCanvasData {
  final String id;                     // 画布ID
  final List<InkStroke> strokes;       // 全部笔画
  final Size canvasSize;               // 画布逻辑尺寸
  final DateTime createdAt;            // 创建时间
  final String? deviceId;              // 设备标识（用于多端同步）
  HandwritingStatus status;            // 当前状态

  InkCanvasData({
    required this.id,
    required this.strokes,
    required this.canvasSize,
    required this.createdAt,
    this.deviceId,
    this.status = HandwritingStatus.drawing,
  });
}

/// 手写识别状态
enum HandwritingStatus {
  drawing,           // 正在书写
  recognizing,       // 识别中
  recognized,        // 识别完成（有待确认）
  editing,           // 用户正在编辑候选结果
  confirmed,         // 已确认输出
  error,             // 识别失败
}
```

#### 2.1.4 识别结果（RecognitionResult）

```dart
/// 手写公式识别结果
class RecognitionResult {
  final String requestId;              // 请求ID
  final List<RecognitionCandidate> candidates; // 候选结果列表（按置信度排序）
  final RecognitionSource source;      // 识别来源（端侧/云端）
  final int latency;                   // 识别耗时（ms）
  final String? rawModelOutput;        // 原始模型输出（调试用）

  RecognitionResult({
    required this.requestId,
    required this.candidates,
    required this.source,
    required this.latency,
    this.rawModelOutput,
  });
}

/// 单个识别候选
class RecognitionCandidate {
  final String latex;                  // LaTeX 字符串
  final double confidence;             // 置信度 [0.0, 1.0]
  final String? renderedSvg;           // 预渲染SVG（可选，减少客户端渲染开销）
  final CandidateType type;            // 候选类型

  RecognitionCandidate({
    required this.latex,
    required this.confidence,
    this.renderedSvg,
    required this.type,
  });
}

enum CandidateType {
  primary,     // 主候选（置信度最高）
  alternative, // 替代候选
  corrected,   // 用户修正后的结果
}

enum RecognitionSource {
  onDevice,    // 端侧模型
  cloud,       // 云端模型
  fallback,    // 降级符号面板
}
```

### 2.2 本地持久化

手写画布数据仅在会话期间有效，不需要长期持久化。但识别结果（LaTeX）应跟随上下文保存（如 AI 对话草稿、错题订正记录）。

| 存储位置 | 内容 | 生命周期 |
| --- | --- | --- |
| 内存（InkEngine） | InkCanvasData 原始笔迹 | 页面存活期间 |
| SharedPreferences | 最近 5 次识别结果（LaTeX） | 30 天自动清理 |
| 临时文件 | 导出的 PNG/SVG 图片 | 下次启动清理 |

### 2.3 网络传输格式

笔迹数据上传识别服务的 JSON 格式：

```json
{
  "canvasId": "ink_20260630_001",
  "canvasSize": {"w": 360, "h": 200},
  "deviceInfo": {
    "platform": "android",
    "stylusSupported": true,
    "screenDpi": 420
  },
  "context": {
    "grade": "初三",
    "subject": "math",
    "scene": "ai_dialog"
  },
  "strokes": [
    {
      "id": "stroke_001",
      "ts": 1719705600000,
      "dur": 850,
      "style": {"w": 2.5, "c": 4279023342, "stylus": false},
      "pts": [
        {"x": 45.2, "y": 80.0, "p": 0.5, "t": 0},
        {"x": 47.8, "y": 79.5, "p": 0.6, "t": 16},
        {"x": 50.3, "y": 79.8, "p": 0.7, "t": 32}
      ]
    }
  ]
}
```

**优化策略：** 坐标精度保留 1 位小数；时间戳用增量编码（首点绝对值，后续点用差值）；空闲笔画不传输。

---

## 3. API 接口设计

### 3.1 识别服务接口

#### 3.1.1 云端识别 API

```
POST /api/v1/hwr/recognize
```

**请求头：**
```
Authorization: Bearer {access_token}
Content-Type: application/json
X-Client-Version: 1.0.0
X-Device-Id: {device_id}
```

**请求体：** 见 2.3 网络传输格式

**成功响应（200）：**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "requestId": "hwr_req_20260630_001",
    "candidates": [
      {
        "latex": "\\frac{x^2 - 1}{x + 1} = x - 1",
        "confidence": 0.96,
        "renderedSvg": "<svg>...</svg>"
      },
      {
        "latex": "\\frac{x^2 - I}{x + 1} = x - 1",
        "confidence": 0.72,
        "renderedSvg": "<svg>...</svg>"
      }
    ],
    "source": "cloud",
    "latency": 1280,
    "modelVersion": "hwr-math-v2.3"
  }
}
```

**错误响应：**

| HTTP 状态码 | code | 说明 | 处理策略 |
| --- | --- | --- | --- |
| 400 | 40001 | 笔迹数据格式错误 | 提示重新书写 |
| 401 | 40101 | 未授权/Token 过期 | 触发刷新 Token |
| 413 | 41301 | 笔迹数据过大（超过 500 笔画） | 截断或分段识别 |
| 429 | 42901 | 识别请求过于频繁 | 客户端节流，降级端侧模型 |
| 500 | 50001 | 识别服务内部错误 | 降级端侧模型或符号面板 |
| 503 | 50301 | 识别服务不可用 | 降级端侧模型或符号面板 |

#### 3.1.2 端侧识别（本地推理）

无需网络请求，通过 ONNX Runtime / TensorFlow Lite 在端侧执行：

```dart
// 端侧识别调用伪代码
final result = await _onnxSession.run({
  'input_strokes': strokeTensor,
  'input_lengths': lengthTensor,
});
final latexTokens = _decodeOutput(result['output_logits']);
```

端侧模型规格：
- 模型格式：ONNX（量化后 INT8）
- 模型大小：约 12-18 MB
- 支持符号集：约 120 个常用数学符号（覆盖小学至高中 90% 场景）
- 推理延迟：< 300ms（中端设备）
- 内存占用：< 50MB

### 3.2 内部 Dart API

```dart
/// 手写识别引擎对外暴露的统一接口
abstract class HandwritingRecognitionEngine {
  /// 初始化引擎（加载端侧模型等）
  Future<void> initialize({required HwrConfig config});

  /// 提交笔迹进行识别
  ///
  /// [strokes] - 全部笔画数据
  /// [context] - 上下文信息（年级、学科等）
  /// [strategy] - 识别策略（端侧优先/云端优先/仅端侧）
  Future<RecognitionResult> recognize({
    required List<InkStroke> strokes,
    required HwrContext context,
    RecognizeStrategy strategy = RecognizeStrategy.cloudFirst,
  });

  /// 实时增量识别（边写边识别）
  ///
  /// 在用户书写过程中，每新增 N 个笔画触发一次轻量识别，
  /// 提前预加载候选结果，减少最终识别延迟。
  Stream<RecognitionResult> recognizeStream({
    required Stream<List<InkStroke>> strokeStream,
    required HwrContext context,
  });

  /// 用户反馈：标记正确/错误的识别结果
  ///
  /// 用于模型持续优化（联邦学习/数据回流）
  Future<void> submitFeedback({
    required String requestId,
    required String correctedLatex,
    required bool isCorrect,
  });

  /// 释放资源
  void dispose();
}
```

#### 3.2.1 策略枚举

```dart
/// 识别策略
enum RecognizeStrategy {
  /// 云端优先：先请求云端，超时降级端侧（默认）
  cloudFirst,

  /// 端侧优先：先端侧识别，低置信度时再请求云端
  onDeviceFirst,

  /// 仅端侧：离线模式或用户选择省流量
  onDeviceOnly,

  /// 仅云端：端侧模型不可用时
  cloudOnly,
}
```

#### 3.2.2 上下文信息

```dart
/// 手写识别上下文
class HwrContext {
  final String grade;        // 用户年级，如 "初三"
  final String subject;      // 学科，如 "math", "physics"
  final HwrScene scene;     // 使用场景
  final String? hintLatex;   // 上文已有的 LaTeX（辅助上下文识别）

  const HwrContext({
    required this.grade,
    required this.subject,
    required this.scene,
    this.hintLatex,
  });
}

/// 使用场景
enum HwrScene {
  aiDialog,        // AI 对话输入
  problemEdit,     // 题目编辑
  mistakeCorrect,  // 错题订正
  essayEdit,       // 作文/笔记编辑
  freeInput,       // 自由输入（公式计算器等）
}
```

---

## 4. 业务逻辑

### 4.1 核心流程

#### 4.1.1 手写识别全流程

```
用户开始书写
      │
      ▼
┌─────────────────┐
│  笔迹采集层       │  Pointer 事件 → InkPoint → InkStroke
│  (实时墨迹渲染)   │  每帧重绘 Canvas
└────────┬────────┘
         │ 用户抬笔（空闲超过 1500ms）
         ▼
┌─────────────────┐
│  笔迹预处理       │  平滑、去噪、归一化
│                 │  笔画分组（基于时空邻近性）
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  策略决策         │  根据 RecognizeStrategy 决定端侧/云端
│                 │  检查网络状态、节流窗口
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌───────┐
│端侧推理│ │云端API │
│(ONNX) │ │(HTTP) │
└───┬───┘ └───┬───┘
    │         │
    └────┬────┘
         ▼
┌─────────────────┐
│  结果合并与排序   │  多候选按置信度排序
│                 │  低置信度(<0.6)触发云端二次确认
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  候选展示         │  主候选实时预览 + 备选列表
│  (LaTeX 渲染)    │  用户可选择/修正
└────────┬────────┘
         │ 用户确认（或自动确认，置信度 > 0.95 且空闲 3s）
         ▼
┌─────────────────┐
│  结果输出         │  LaTeX → 下游模块
│                 │  笔迹数据 → 反馈池（脱敏后）
└─────────────────┘
```

#### 4.1.2 增量预识别流程

为减少用户等待感，采用增量预识别：

```
笔画数    触发动作
─────────────────────────────────
1-3       不触发（数据太少）
4-6       端侧预识别（静默，结果不展示）
7+        端侧预识别 + 展示候选预览
抬笔 1.5s  最终识别（端侧/云端策略）
```

#### 4.1.3 增量预识别时序

```
时间 ──────────────────────────────────────────────►

用户书写:  [笔画1][笔画2][笔画3][笔画4]  [笔画5]  [停笔]
              │      │      │      │       │       │
端侧预识别:   ×      ×      ×      ✓       ✓       │
                                          │       │
                          预览候选:  ◄────┘       │
                                               │  │
最终识别:                                      ◄──┘ │
                                                    │
确认输出:                                      ◄────┘
```

### 4.2 状态机

```
                    ┌──────────┐
          初始化 ──►│  idle    │◄──────────────────────┐
                    │  (空闲)   │                       │
                    └────┬─────┘                        │
                         │ onPointerDown                │
                         ▼                              │
                    ┌──────────┐                        │
                    │ drawing  │                        │
                    │ (书写中)  │                        │
                    └────┬─────┘                        │
                         │ onPointerUp + idle 1500ms    │
                         ▼                              │
                    ┌──────────┐    超时(5s)     ┌──────┴───┐
                    │recognizing├──────────────►│  error   │
                    │ (识别中)  │               │ (失败)    │
                    └────┬─────┘                └──────┬───┘
                         │                              │
              ┌──────────┴──────────┐                   │
              │                     │                   │
              ▼                     ▼                   │
     置信度 ≥ 0.6          置信度 < 0.6                 │
              │                     │                   │
              ▼                     ▼                   │
     ┌────────────┐       ┌──────────────┐             │
     │ recognized │       │ cloud_retry  │             │
     │(识别完成)   │       │(云端二次确认) │             │
     └─────┬──────┘       └──────┬───────┘             │
           │                     │                     │
           │              ┌──────┴───────┐             │
           │              ▼              ▼              │
           │         成功(合并结果)   失败/超时          │
           │              │              │              │
           ▼              ▼              ▼              │
     ┌────────────────────────────────────────┐        │
     │           候选展示 (candidates)         │        │
     │  用户选择候选 / 手动修正 / 重新书写      │        │
     └───────────────────┬────────────────────┘        │
                         │ onConfirm                    │
                         ▼                              │
                    ┌──────────┐                        │
                    │ confirmed│───dispose──────────────┘
                    │ (已确认)  │     (资源清理)
                    └──────────┘
```

### 4.3 笔迹预处理算法

#### 4.3.1 笔迹平滑（Moving Average + Catmull-Rom）

```dart
/// 笔迹平滑处理
///
/// 使用移动平均去高频抖动，再用 Catmull-Rom 样条插值
/// 生成平滑曲线控制点
List<InkPoint> _smoothStroke(InkStroke stroke) {
  if (stroke.points.length < 3) return stroke.points;

  // Step 1: 移动平均（窗口大小 3）
  final smoothed = <InkPoint>[];
  for (int i = 0; i < stroke.points.length; i++) {
    final p0 = stroke.points[max(0, i - 1)];
    final p1 = stroke.points[i];
    final p2 = stroke.points[min(stroke.points.length - 1, i + 1)];

    smoothed.add(InkPoint(
      x: (p0.x + p1.x + p2.x) / 3,
      y: (p0.y + p1.y + p2.y) / 3,
      pressure: (p0.pressure + p1.pressure + p2.pressure) / 3,
      timestamp: p1.timestamp,
    ));
  }

  return smoothed;
}
```

#### 4.3.2 笔画分割（时空邻近性分组）

数学公式中，不同笔画之间可能存在时空上的关联关系。笔画分割的目标是将属于同一数学结构元素（如分式的分子和分数线）的笔画分组。

```dart
/// 笔画分组算法
///
/// 基于以下启发式规则：
/// 1. 时间间隔 < 2000ms 的相邻笔画可能属于同一结构
/// 2. 空间距离 < 阈值（基于平均笔画高度）的笔画可能关联
/// 3. 垂直对齐的笔画可能是上下标或分式
List<StrokeGroup> _groupStrokes(List<InkStroke> strokes) {
  if (strokes.isEmpty) return [];

  // 计算每个笔画的包围盒
  final bounds = strokes.map(_computeBoundingBox).toList();

  // 计算全局平均笔画高度（用于自适应距离阈值）
  final avgHeight = bounds.map((b) => b.height).reduce((a, b) => a + b) / bounds.length;
  final proximityThreshold = avgHeight * 1.5; // 邻近性阈值

  // 基于时空邻近性进行聚类
  final groups = <StrokeGroup>[];
  final assigned = List.filled(strokes.length, false);

  for (int i = 0; i < strokes.length; i++) {
    if (assigned[i]) continue;

    final group = StrokeGroup(strokes: [strokes[i]]);
    assigned[i] = true;

    for (int j = i + 1; j < strokes.length; j++) {
      if (assigned[j]) continue;

      final timeGap = strokes[j].startTimestamp -
          (strokes[group.strokes.last].startTimestamp +
           strokes[group.strokes.last].duration);

      final spatialDist = _boundingBoxDistance(bounds[i], bounds[j]);

      if (timeGap < 2000 && spatialDist < proximityThreshold) {
        group.strokes.add(strokes[j]);
        assigned[j] = true;
      }
    }

    groups.add(group);
  }

  return groups;
}
```

#### 4.3.3 归一化

```dart
/// 坐标归一化
///
/// 将笔迹坐标缩放到模型期望的输入空间 [0, 1] × [0, 1]
/// 同时保持纵横比，避免形变
NormalizedInk _normalize(List<InkStroke> strokes, Size canvasSize) {
  // 合并所有点找出全局包围盒
  final allPoints = strokes.expand((s) => s.points).toList();
  final minX = allPoints.map((p) => p.x).reduce(min);
  final maxX = allPoints.map((p) => p.x).reduce(max);
  final minY = allPoints.map((p) => p.y).reduce(min);
  final maxY = allPoints.map((p) => p.y).reduce(max);

  final width = maxX - minX;
  final height = maxY - minY;
  final scale = 1.0 / max(width, height); // 保持纵横比

  // 平移到原点并缩放
  final normalized = strokes.map((stroke) {
    return InkStroke(
      id: stroke.id,
      points: stroke.points.map((p) => InkPoint(
        x: (p.x - minX) * scale,
        y: (p.y - minY) * scale,
        pressure: p.pressure,
        timestamp: p.timestamp,
      )).toList(),
      startTimestamp: stroke.startTimestamp,
      duration: stroke.duration,
      style: stroke.style,
    );
  }).toList();

  return NormalizedInk(
    strokes: normalized,
    aspectRatio: width / height,
  );
}
```

### 4.4 端云协同策略

```dart
/// 端云协同识别决策器
class RecognitionStrategyResolver {
  final NetworkInfo _network;
  final UserPreferences _prefs;
  final OnDeviceModelState _modelState;

  RecognizeStrategy resolve({
    required HwrContext context,
    required bool isIncremental,
  }) {
    // 1. 离线状态 → 仅端侧
    if (!_network.isOnline) {
      return RecognizeStrategy.onDeviceOnly;
    }

    // 2. 用户开启省流量 → 端侧优先
    if (_prefs.dataSaverEnabled) {
      return RecognizeStrategy.onDeviceFirst;
    }

    // 3. 增量预识别 → 仅端侧（避免频繁网络请求）
    if (isIncremental) {
      return RecognizeStrategy.onDeviceOnly;
    }

    // 4. 端侧模型不可用 → 仅云端
    if (!_modelState.isLoaded) {
      return RecognizeStrategy.cloudOnly;
    }

    // 5. 弱网环境（RTT > 800ms）→ 端侧优先
    if (_network.isWeakConnection) {
      return RecognizeStrategy.onDeviceFirst;
    }

    // 6. 默认 → 云端优先
    return RecognizeStrategy.cloudFirst;
  }
}
```

---

## 5. 关键代码示例

### 5.1 手写画布 Widget

```dart
/// 手写公式画布 Widget
///
/// 负责笔迹采集、实时渲染、手势处理
class HandwritingCanvas extends StatefulWidget {
  final HandwritingRecognitionEngine engine;
  final HwrContext context;
  final ValueChanged<String> onLatexConfirmed; // LaTeX 确认回调
  final double canvasHeight;

  const HandwritingCanvas({
    super.key,
    required this.engine,
    required this.context,
    required this.onLatexConfirmed,
    this.canvasHeight = 200,
  });

  @override
  State<HandwritingCanvas> createState() => _HandwritingCanvasState();
}

class _HandwritingCanvasState extends State<HandwritingCanvas>
    with SingleTickerProviderStateMixin {
  final List<InkStroke> _strokes = [];
  final List<Offset> _currentPoints = [];
  final GlobalKey _canvasKey = GlobalKey();

  // 实时渲染控制器
  late final AnimationController _repaintController;
  // 空闲检测计时器
  Timer? _idleTimer;
  // 当前状态
  HandwritingStatus _status = HandwritingStatus.drawing;
  // 识别结果
  RecognitionResult? _result;

  /// 空闲超时（用户停笔多久后触发识别）
  static const _idleTimeout = Duration(milliseconds: 1500);
  /// 笔画采样最小间隔（毫秒，降低高频设备采样率）
  static const _sampleIntervalMs = 16; // ~60fps

  int? _lastSampleTime;

  @override
  void initState() {
    super.initState();
    _repaintController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 16),
    )..addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _idleTimer?.cancel();
    _repaintController.dispose();
    super.dispose();
  }

  void _onPointerDown(PointerDownEvent event) {
    if (_status == HandwritingStatus.recognizing) return;

    _idleTimer?.cancel();
    _currentPoints.clear();
    _currentPoints.add(_toCanvasOffset(event.localPosition));

    _lastSampleTime = DateTime.now().millisecondsSinceEpoch;
  }

  void _onPointerMove(PointerMoveEvent event) {
    if (_status == HandwritingStatus.recognizing) return;

    final now = DateTime.now().millisecondsSinceEpoch;
    if (now - (_lastSampleTime ?? 0) < _sampleIntervalMs) return;
    _lastSampleTime = now;

    _currentPoints.add(_toCanvasOffset(event.localPosition));
    _repaintController.forward(from: 0);
  }

  void _onPointerUp(PointerUpEvent event) {
    if (_status == HandwritingStatus.recognizing) return;
    if (_currentPoints.isEmpty) return;

    _currentPoints.add(_toCanvasOffset(event.localPosition));

    // 构建笔画对象
    final stroke = _buildStroke(_currentPoints);
    _strokes.add(stroke);
    _currentPoints.clear();
    _repaintController.forward(from: 0);

    // 重启空闲计时器
    _idleTimer?.cancel();
    _idleTimer = Timer(_idleTimeout, _onIdle);
  }

  /// 空闲触发识别
  Future<void> _onIdle() async {
    if (_strokes.isEmpty) return;

    setState(() => _status = HandwritingStatus.recognizing);

    try {
      final result = await widget.engine.recognize(
        strokes: _strokes,
        context: widget.context,
        strategy: _resolveStrategy(),
      );

      setState(() {
        _result = result;
        _status = HandwritingStatus.recognized;
      });

      // 高置信度自动确认
      if (result.candidates.isNotEmpty &&
          result.candidates.first.confidence >= 0.95) {
        _confirmCandidate(result.candidates.first);
      }
    } catch (e) {
      setState(() => _status = HandwritingStatus.error);
      // 错误处理见第 7 节
    }
  }

  void _confirmCandidate(RecognitionCandidate candidate) {
    widget.onLatexConfirmed(candidate.latex);
    setState(() => _status = HandwritingStatus.confirmed);
  }

  Offset _toCanvasOffset(Offset localPosition) {
    final renderBox = _canvasKey.currentContext?.findRenderObject() as RenderBox?;
    if (renderBox == null) return localPosition;
    return renderBox.globalToLocal(localPosition);
  }

  InkStroke _buildStroke(List<Offset> points) {
    final now = DateTime.now().millisecondsSinceEpoch;
    final inkPoints = points.asMap().entries.map((e) {
      return InkPoint(
        x: e.value.dx,
        y: e.value.dy,
        pressure: 0.5, // 可从 PointerEvent.pressure 获取
        timestamp: e.key * _sampleIntervalMs,
      );
    }).toList();

    return InkStroke(
      id: const Uuid().v4(),
      points: inkPoints,
      startTimestamp: now - inkPoints.last.timestamp,
      duration: inkPoints.last.timestamp,
      style: StrokeStyle(
        strokeWidth: 2.5,
        color: Theme.of(context).brightness == Brightness.dark
            ? 0xFFE0E0E0
            : 0xFF1A1A2E,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // 画布区域
        Container(
          height: widget.canvasHeight,
          decoration: BoxDecoration(
            color: Theme.of(context).brightness == Brightness.dark
                ? const Color(0xFF1E1E2E)
                : const Color(0xFFF8F9FA),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: const Color(0xFFE0E0E0),
              width: 1,
            ),
          ),
          child: Listener(
            onPointerDown: _onPointerDown,
            onPointerMove: _onPointerMove,
            onPointerUp: _onPointerUp,
            child: CustomPaint(
              key: _canvasKey,
              painter: InkPainter(
                strokes: _strokes,
                currentPoints: _currentPoints,
              ),
              child: _strokes.isEmpty && _currentPoints.isEmpty
                  ? _buildPlaceholder()
                  : const SizedBox.expand(),
            ),
          ),
        ),

        // 候选结果区域
        if (_result != null && _status == HandwritingStatus.recognized)
          _buildCandidatesPanel(),

        // 操作栏
        _buildToolbar(),
      ],
    );
  }

  Widget _buildPlaceholder() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.edit, size: 32, color: Colors.grey[400]),
          const SizedBox(height: 8),
          Text(
            '在此区域手写公式',
            style: TextStyle(color: Colors.grey[400], fontSize: 14),
          ),
        ],
      ),
    );
  }

  Widget _buildToolbar() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // 撤销
          IconButton(
            icon: const Icon(Icons.undo),
            onPressed: _strokes.isEmpty
                ? null
                : () => setState(() => _strokes.removeLast()),
          ),
          // 清空
          TextButton.icon(
            icon: const Icon(Icons.clear, size: 18),
            label: const Text('清空'),
            onPressed: _strokes.isEmpty
                ? null
                : () => setState(() {
                      _strokes.clear();
                      _result = null;
                      _status = HandwritingStatus.drawing;
                    }),
          ),
          // 切换到键盘输入
          TextButton.icon(
            icon: const Icon(Icons.keyboard, size: 18),
            label: const Text('键盘输入'),
            onPressed: () => _switchToKeyboard(),
          ),
        ],
      ),
    );
  }

  Widget _buildCandidatesPanel() {
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceVariant.withOpacity(0.3),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('识别结果（点击选择）', style: Theme.of(context).textTheme.labelMedium),
          const SizedBox(height: 8),
          ...(_result!.candidates.take(3).map((candidate) {
            return ListTile(
              dense: true,
              leading: _buildConfidenceBadge(candidate.confidence),
              title: MathTex(
                tex: candidate.latex,
                textStyle: const TextStyle(fontSize: 16),
              ),
              onTap: () => _confirmCandidate(candidate),
            );
          })),
          // 手动修正入口
          TextButton.icon(
            icon: const Icon(Icons.edit, size: 16),
            label: const Text('手动修正'),
            onPressed: _showManualCorrectDialog,
          ),
        ],
      ),
    );
  }

  Widget _buildConfidenceBadge(double confidence) {
    final color = confidence >= 0.85
        ? Colors.green
        : confidence >= 0.6
            ? Colors.orange
            : Colors.red;
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(shape: BoxShape.circle, color: color),
    );
  }

  void _showManualCorrectDialog() {
    // 弹出 LaTeX 手动编辑弹窗（复用数学公式输入系统的符号面板）
    // ... 实现省略
  }

  void _switchToKeyboard() {
    // 切换到数学公式与学科符号输入系统的键盘模式
    // ... 实现省略
  }

  RecognizeStrategy _resolveStrategy() {
    // 委托给 RecognitionStrategyResolver
    return RecognizeStrategy.cloudFirst;
  }
}
```

### 5.2 笔迹渲染器

```dart
/// 笔迹渲染器（CustomPainter）
class InkPainter extends CustomPainter {
  final List<InkStroke> strokes;
  final List<Offset> currentPoints;

  InkPainter({required this.strokes, this.currentPoints = const []});

  @override
  void paint(Canvas canvas, Size size) {
    // 绘制已完成笔画
    for (final stroke in strokes) {
      _drawStroke(canvas, stroke);
    }

    // 绘制当前正在书写的笔画（实时反馈）
    if (currentPoints.length > 1) {
      final paint = Paint()
        ..color = const Color(0xFF1A1A2E)
        ..strokeWidth = 2.5
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..style = PaintingStyle.stroke
        ..isAntiAlias = true;

      // 使用 Catmull-Rom 样条平滑当前笔画
      final path = _buildSmoothPath(currentPoints);
      canvas.drawPath(path, paint);
    }
  }

  void _drawStroke(Canvas canvas, InkStroke stroke) {
    final paint = Paint()
      ..color = Color(stroke.style.color)
      ..strokeWidth = stroke.style.strokeWidth
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke
      ..isAntiAlias = true;

    final points = stroke.points.map((p) => Offset(p.x, p.y)).toList();
    if (points.length > 1) {
      final path = _buildSmoothPath(points);
      canvas.drawPath(path, paint);
    } else if (points.length == 1) {
      canvas.drawPoints(PointMode.points, points, paint);
    }
  }

  /// Catmull-Rom 样条曲线生成
  ///
  /// 将离散的点序列转换为平滑的二次贝塞尔曲线路径
  Path _buildSmoothPath(List<Offset> points) {
    final path = Path();

    if (points.length < 2) {
      if (points.isNotEmpty) {
        path.moveTo(points[0].dx, points[0].dy);
      }
      return path;
    }

    path.moveTo(points[0].dx, points[0].dy);

    for (int i = 0; i < points.length - 1; i++) {
      final p0 = i > 0 ? points[i - 1] : points[i];
      final p1 = points[i];
      final p2 = points[i + 1];
      final p3 = i < points.length - 2 ? points[i + 2] : points[i + 1];

      // Catmull-Rom → 三次贝塞尔转换
      // 控制点：c1 = p1 + (p2 - p0) / 6, c2 = p2 - (p3 - p1) / 6
      final c1 = Offset(
        p1.dx + (p2.dx - p0.dx) / 6,
        p1.dy + (p2.dy - p0.dy) / 6,
      );
      final c2 = Offset(
        p2.dx - (p3.dx - p1.dx) / 6,
        p2.dy - (p3.dy - p1.dy) / 6,
      );

      path.cubicTo(c1.dx, c1.dy, c2.dx, c2.dy, p2.dx, p2.dy);
    }

    return path;
  }

  @override
  bool shouldRepaint(covariant InkPainter oldDelegate) {
    return strokes != oldDelegate.strokes ||
        currentPoints != oldDelegate.currentPoints;
  }
}
```

### 5.3 识别引擎实现

```dart
/// 手写识别引擎实现
class HandwritingRecognitionEngineImpl
    implements HandwritingRecognitionEngine {
  final Dio _httpClient;
  final OnDeviceModelRunner _onDeviceRunner;
  final NetworkMonitor _networkMonitor;
  final FeedbackCollector _feedbackCollector;

  // 请求节流
  final _requestLimiter = RateLimiter(
    maxRequests: 10,
    window: const Duration(minutes: 1),
  );

  // 增量预识别控制器
  StreamSubscription? _incrementalSub;

  @override
  Future<void> initialize({required HwrConfig config}) async {
    // 预加载端侧模型（异步，不阻塞 UI）
    if (config.enableOnDeviceModel) {
      await _onDeviceRunner.loadModel(
        modelPath: config.onDeviceModelPath,
        // 使用 isolate 避免阻塞主线程
        useIsolate: true,
      );
    }
  }

  @override
  Future<RecognitionResult> recognize({
    required List<InkStroke> strokes,
    required HwrContext context,
    RecognizeStrategy strategy = RecognizeStrategy.cloudFirst,
  }) async {
    if (strokes.isEmpty) {
      throw const HwrException(code: HwrErrorCode.emptyStrokes);
    }

    // 超过最大笔画数，截断
    if (strokes.length > kMaxStrokes) {
      strokes = strokes.sublist(strokes.length - kMaxStrokes);
    }

    // 预处理
    final preprocessed = _preprocess(strokes);

    switch (strategy) {
      case RecognizeStrategy.cloudFirst:
        return _recognizeCloudFirst(preprocessed, context);

      case RecognizeStrategy.onDeviceFirst:
        return _recognizeOnDeviceFirst(preprocessed, context);

      case RecognizeStrategy.onDeviceOnly:
        return _recognizeOnDevice(preprocessed, context);

      case RecognizeStrategy.cloudOnly:
        return _recognizeCloud(preprocessed, context);
    }
  }

  /// 云端优先策略
  Future<RecognitionResult> _recognizeCloudFirst(
    PreprocessedInk ink,
    HwrContext context,
  ) async {
    try {
      // 设置 3 秒超时，超时降级端侧
      return await _recognizeCloud(ink, context)
          .timeout(const Duration(seconds: 3));
    } on TimeoutException {
      // 降级端侧
      if (_onDeviceRunner.isLoaded) {
        return _recognizeOnDevice(ink, context);
      }
      rethrow;
    } on DioException catch (e) {
      if (e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.connectionError) {
        // 网络异常，降级端侧
        if (_onDeviceRunner.isLoaded) {
          return _recognizeOnDevice(ink, context);
        }
      }
      rethrow;
    }
  }

  /// 端侧优先策略
  Future<RecognitionResult> _recognizeOnDeviceFirst(
    PreprocessedInk ink,
    HwrContext context,
  ) async {
    final onDeviceResult = await _recognizeOnDevice(ink, context);

    // 置信度足够，直接返回
    if (onDeviceResult.candidates.isNotEmpty &&
        onDeviceResult.candidates.first.confidence >= 0.75) {
      return onDeviceResult;
    }

    // 置信度低，请求云端二次确认
    if (await _networkMonitor.isOnline) {
      try {
        final cloudResult = await _recognizeCloud(ink, context)
            .timeout(const Duration(seconds: 5));

        // 合并端侧和云端结果
        return _mergeResults(onDeviceResult, cloudResult);
      } catch (_) {
        return onDeviceResult; // 云端失败，使用端侧结果
      }
    }

    return onDeviceResult;
  }

  /// 端侧识别
  Future<RecognitionResult> _recognizeOnDevice(
    PreprocessedInk ink,
    HwrContext context,
  ) async {
    if (!_onDeviceRunner.isLoaded) {
      throw const HwrException(code: HwrErrorCode.onDeviceModelNotAvailable);
    }

    final stopwatch = Stopwatch()..start();

    // 构建 ONNX 输入张量
    final inputTensor = _buildInputTensor(ink);

    // 执行推理（在 Isolate 中运行，避免 jank）
    final output = await _onDeviceRunner.run(inputTensor);

    // 解码输出为 LaTeX
    final candidates = _decodeOutput(output);

    stopwatch.stop();

    return RecognitionResult(
      requestId: 'hwr_local_${DateTime.now().millisecondsSinceEpoch}',
      candidates: candidates,
      source: RecognitionSource.onDevice,
      latency: stopwatch.elapsedMilliseconds,
    );
  }

  /// 云端识别
  Future<RecognitionResult> _recognizeCloud(
    PreprocessedInk ink,
    HwrContext context,
  ) async {
    // 节流检查
    if (!_requestLimiter.tryAcquire()) {
      throw const HwrException(code: HwrErrorCode.rateLimited);
    }

    final requestBody = _buildRequestBody(ink, context);

    final response = await _httpClient.post(
      '/api/v1/hwr/recognize',
      data: requestBody,
      options: Options(
        sendTimeout: const Duration(seconds: 5),
        receiveTimeout: const Duration(seconds: 8),
      ),
    );

    final data = response.data['data'] as Map<String, dynamic>;

    return RecognitionResult(
      requestId: data['requestId'],
      candidates: (data['candidates'] as List)
          .map((c) => RecognitionCandidate(
                latex: c['latex'],
                confidence: (c['confidence'] as num).toDouble(),
                renderedSvg: c['renderedSvg'],
                type: CandidateType.alternative,
              ))
          .toList()
        ..first.type = CandidateType.primary,
      source: RecognitionSource.cloud,
      latency: data['latency'] as int,
    );
  }

  /// 合并端侧和云端结果
  RecognitionResult _mergeResults(
    RecognitionResult onDevice,
    RecognitionResult cloud,
  ) {
    final allCandidates = <RecognitionCandidate>[...cloud.candidates];

    // 将端侧独有的高置信度候选加入列表
    for (final od in onDevice.candidates) {
      if (!allCandidates.any((c) => c.latex == od.latex)) {
        allCandidates.add(od);
      }
    }

    // 按置信度排序
    allCandidates.sort((a, b) => b.confidence.compareTo(a.confidence));

    return RecognitionResult(
      requestId: cloud.requestId,
      candidates: allCandidates.take(5).toList(),
      source: RecognitionSource.cloud,
      latency: max(onDevice.latency, cloud.latency),
    );
  }

  /// 预处理流水线
  PreprocessedInk _preprocess(List<InkStroke> strokes) {
    // 1. 平滑每条笔画
    final smoothed = strokes.map((s) {
      final points = _smoothStroke(s);
      return InkStroke(
        id: s.id,
        points: points,
        startTimestamp: s.startTimestamp,
        duration: s.duration,
        style: s.style,
      );
    }).toList();

    // 2. 去噪：移除长度过短的笔画（噪点）
    final filtered = smoothed
        .where((s) => _strokeLength(s) > kMinStrokeLength)
        .toList();

    // 3. 归一化
    final normalized = _normalize(filtered);

    return PreprocessedInk(
      strokes: normalized.strokes,
      aspectRatio: normalized.aspectRatio,
    );
  }

  @override
  Stream<RecognitionResult> recognizeStream({
    required Stream<List<InkStroke>> strokeStream,
    required HwrContext context,
  }) async* {
    int lastRecognizedCount = 0;

    await for (final strokes in strokeStream) {
      // 至少新增 3 个笔画才触发增量识别
      if (strokes.length - lastRecognizedCount < 3) continue;
      lastRecognizedCount = strokes.length;

      // 仅使用端侧进行增量预识别
      try {
        final result = await recognize(
          strokes: strokes,
          context: context,
          strategy: RecognizeStrategy.onDeviceOnly,
        );
        yield result;
      } catch (_) {
        // 增量识别失败静默忽略，不影响最终识别
      }
    }
  }

  @override
  Future<void> submitFeedback({
    required String requestId,
    required String correctedLatex,
    required bool isCorrect,
  }) async {
    await _feedbackCollector.collect(
      type: FeedbackType.handwritingRecognition,
      requestId: requestId,
      data: {
        'correctedLatex': correctedLatex,
        'isCorrect': isCorrect,
        'timestamp': DateTime.now().toIso8601String(),
      },
    );
  }

  @override
  void dispose() {
    _incrementalSub?.cancel();
    _onDeviceRunner.dispose();
  }

  static const kMaxStrokes = 200;
  static const kMinStrokeLength = 2.0; // 逻辑像素
}
```

### 5.4 端侧 ONNX 模型封装

```dart
/// ONNX Runtime 端侧推理封装
class OnDeviceModelRunner {
  final String modelPath;
  OrtSession? _session;
  OrtEnv? _env;
  Isolate? _isolate;
  SendPort? _sendPort;

  bool get isLoaded => _session != null;

  /// 在 Isolate 中加载模型，避免阻塞 UI 线程
  Future<void> loadModel({
    required String modelPath,
    required bool useIsolate,
  }) async {
    if (useIsolate) {
      final receivePort = ReceivePort();
      _isolate = await Isolate.spawn(
        _modelIsolateEntry,
        _ModelIsolateParams(
          modelPath: modelPath,
          sendPort: receivePort.sendPort,
        ),
      );
      _sendPort = await receivePort.first as SendPort;
    } else {
      // 同步加载（仅用于调试）
      _env = OrtEnv.fromFile(modelPath);
      _session = OrtSession.fromFile(_env!, modelPath);
    }
  }

  /// 执行推理
  Future<Map<String, dynamic>> run(Map<String, dynamic> inputs) async {
    if (_sendPort != null) {
      // 通过 Isolate 通信
      final responsePort = ReceivePort();
      _sendPort!.send(_InferenceRequest(
        inputs: inputs,
        responsePort: responsePort.sendPort,
      ));
      return await responsePort.first as Map<String, dynamic>;
    } else {
      // 主线程直接推理
      return _runDirect(inputs);
    }
  }

  void dispose() {
    _session?.close();
    _env?.close();
    _isolate?.kill(priority: Isolate.beforeNextEvent);
  }

  static void _modelIsolateEntry(_ModelIsolateParams params) {
    final env = OrtEnv.fromFile(params.modelPath);
    final session = OrtSession.fromFile(env, params.modelPath);

    final receivePort = ReceivePort();
    params.sendPort.send(receivePort.sendPort);

    receivePort.listen((message) {
      if (message is _InferenceRequest) {
        // 执行推理并返回结果
        final result = _runInSession(session, message.inputs);
        message.responsePort.send(result);
      }
    });
  }

  // ... 其余实现省略
}
```

---

## 6. LaTeX 渲染与预览

### 6.1 渲染方案

使用 `flutter_math_fork`（或 `mathlingo`）进行纯 Flutter LaTeX 公式渲染，避免 WebView 依赖：

```dart
/// 公式预览 Widget
class MathPreview extends StatelessWidget {
  final String latex;
  final double fontSize;
  final Color? color;

  const MathPreview({
    super.key,
    required this.latex,
    this.fontSize = 18,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    // 清理 LaTeX：移除手写识别可能产生的多余空格和换行
    final cleanedLatex = latex.trim().replaceAll(RegExp(r'\s+'), ' ');

    return Math.tex(
      cleanedLatex,
      textStyle: TextStyle(
        fontSize: fontSize,
        color: color ?? Theme.of(context).textTheme.bodyMedium?.color,
      ),
      onErrorFallback: (error) {
        // LaTeX 解析失败时的降级显示
        return Text(
          latex,
          style: TextStyle(
            fontSize: fontSize,
            fontFamily: 'monospace',
            color: Colors.red,
          ),
        );
      },
    );
  }
}
```

### 6.2 支持的 LaTeX 符号集

端侧模型支持的数学符号映射表（部分示例）：

```dart
/// LaTeX 符号映射表
///
/// 定义手写笔迹特征 → LaTeX 符号的映射
/// 用于端侧模型的后处理修正
const Map<String, String> kSymbolMap = {
  // 基础运算
  '+': r'+',
  '-': r'-',
  '×': r'\times',
  '÷': r'\div',
  '±': r'\pm',

  // 关系运算
  '=': '=',
  '≠': r'\neq',
  '<': '<',
  '>': '>',
  '≤': r'\leq',
  '≥': r'\geq',
  '≈': r'\approx',

  // 分式与根号
  'frac': r'\frac{#1}{#2}',
  'sqrt': r'\sqrt{#1}',
  'nthroot': r'\sqrt[#1]{#2}',

  // 上下标
  'sup': '^{#1}',
  'sub': '_{#1}',

  // 微积分
  'int': r'\int',
  'oint': r'\oint',
  'sum': r'\sum',
  'prod': r'\prod',
  'lim': r'\lim',
  'partial': r'\partial',
  'nabla': r'\nabla',
  'infty': r'\infty',

  // 集合
  'in': r'\in',
  'notin': r'\notin',
  'subset': r'\subset',
  'supset': r'\supset',
  'union': r'\cup',
  'intersect': r'\cap',
  'empty': r'\emptyset',

  // 希腊字母
  'alpha': r'\alpha',
  'beta': r'\beta',
  'gamma': r'\gamma',
  'delta': r'\delta',
  'theta': r'\theta',
  'lambda': r'\lambda',
  'mu': r'\mu',
  'pi': r'\pi',
  'sigma': r'\sigma',
  'phi': r'\phi',
  'omega': r'\omega',

  // 矩阵
  'matrix': r'\begin{pmatrix} #1 \end{pmatrix}',

  // 函数
  'sin': r'\sin',
  'cos': r'\cos',
  'tan': r'\tan',
  'log': r'\log',
  'ln': r'\ln',
  'exp': r'\exp',

  // 几何
  'angle': r'\angle',
  'degree': r'^{\circ}',
  'perp': r'\perp',
  'parallel': r'\parallel',
  'triangle': r'\triangle',
  'cong': r'\cong',
  'sim': r'\sim',

  // 箭头
  'rightarrow': r'\rightarrow',
  'leftarrow': r'\leftarrow',
  'leftrightarrow': r'\leftrightarrow',
  'Rightarrow': r'\Rightarrow',
  'mapsto': r'\mapsto',
};
```

---

## 7. 错误处理

### 7.1 异常类型定义

```dart
/// 手写识别错误码
enum HwrErrorCode {
  /// 空笔画
  emptyStrokes,

  /// 笔画数超过限制
  tooManyStrokes,

  /// 笔迹数据格式错误
  invalidStrokeData,

  /// 端侧模型未加载
  onDeviceModelNotAvailable,

  /// 端侧模型推理失败
  onDeviceInferenceFailed,

  /// 云端识别请求失败
  cloudRequestFailed,

  /// 云端识别超时
  cloudTimeout,

  /// 识别服务不可用
  serviceUnavailable,

  /// 请求被限流
  rateLimited,

  /// 识别结果为空
  emptyResult,

  /// LaTeX 渲染失败
  latexRenderFailed,
}

/// 手写识别异常
class HwrException implements Exception {
  final HwrErrorCode code;
  final String? detail;

  const HwrException({required this.code, this.detail});

  @override
  String toString() => 'HwrException($code): $detail';
}
```

### 7.2 错误处理策略矩阵

| 错误场景 | 用户感知 | 处理策略 | 恢复方式 |
| --- | --- | --- | --- |
| 端侧模型加载失败 | 无感知（静默降级） | 自动切换为云端策略 | 下次启动重试加载 |
| 端侧推理失败 | 无感知（自动切换） | 3 秒内自动切换为云端识别 | 无需用户操作 |
| 云端请求超时（>3s） | 等待提示 | 显示加载动画 → 超时后降级端侧 | 自动 |
| 云端请求超时（>8s） | "识别超时" Toast | 降级端侧或提示重试 | 用户手动重试 |
| 云端服务不可用（503） | "服务暂时不可用" | 降级端侧 | 自动 |
| 网络断开 | 自动切换离线模式 | 仅使用端侧模型 | 网络恢复后自动切换回 |
| 请求被限流（429） | 无感知（节流丢弃） | 使用上一次增量预识别结果 | 等待节流窗口结束 |
| LaTeX 渲染失败 | 候选显示为原始文本 | 降级为等宽字体显示 LaTeX 源码 | 用户手动修正 |
| 识别结果为空 | "未能识别，请重新书写" | 清空画布提示重写 | 用户重新书写 |
| 笔画数超限（>200） | 提示"内容过多" | 建议分段输入 | 用户删减笔画 |

### 7.3 全局错误处理器

```dart
/// 手写识别全局错误处理器
class HwrErrorHandler {
  final ToastService _toast;
  final CrashlyticsReporter _crashlytics;

  /// 处理识别过程中的异常
  ///
  /// 返回是否已消化该错误（true 表示不需要继续向上抛出）
  bool handle(Object error, StackTrace stack, {required BuildContext context}) {
    if (error is! HwrException) {
      _crashlytics.recordError(error, stack, reason: 'HWR unexpected error');
      return false;
    }

    switch (error.code) {
      case HwrErrorCode.cloudTimeout:
        _toast.show(context, message: '识别超时，已切换离线模式', duration: 2);
        return true;

      case HwrErrorCode.serviceUnavailable:
        _toast.show(context, message: '识别服务暂时不可用，请稍后重试', duration: 3);
        return true;

      case HwrErrorCode.emptyResult:
        _toast.show(context, message: '未能识别，请重新书写', duration: 2);
        return true;

      case HwrErrorCode.tooManyStrokes:
        _toast.show(context, message: '内容较多，建议分段输入', duration: 3);
        return true;

      case HwrErrorCode.rateLimited:
        // 静默处理，不提示用户
        return true;

      case HwrErrorCode.onDeviceInferenceFailed:
        // 静默处理，已自动降级云端
        return true;

      case HwrErrorCode.latexRenderFailed:
        // 静默处理，已有 fallback 显示
        return true;

      default:
        _crashlytics.recordError(error, stack, reason: 'HWR unhandled');
        return false;
    }
  }
}
```

---

## 8. 性能优化

### 8.1 性能指标目标

| 指标 | 目标值 | 说明 |
| --- | --- | --- |
| 笔迹渲染帧率 | ≥ 60 fps | 书写过程中无明显卡顿 |
| 端侧推理延迟 | < 300ms | 中端设备（骁龙 7 系列同级） |
| 云端识别延迟 | < 2s（P95） | 含网络传输 |
| 端侧+云端总延迟 | < 3.5s | 端侧优先 + 云端确认场景 |
| 内存占用峰值 | < 80MB | 含端侧模型 + 笔迹数据 |
| 包体积增量 | < 20MB | 端侧 ONNX 模型 + 依赖库 |

### 8.2 关键优化点

#### 8.2.1 渲染层优化

```dart
/// 使用 RepaintBoundary 隔离手写画布的重绘
RepaintBoundary(
  child: HandwritingCanvas(...),
)

/// 使用 PictureRecorder 缓存已完成笔画的光栅化结果
/// 仅重绘新增笔画 + 当前笔画
class CachedInkPainter extends CustomPainter {
  ui.Picture? _cachedPicture;
  int _cachedStrokeCount = 0;

  @override
  void paint(Canvas canvas, Size size) {
    // 绘制缓存
    if (_cachedPicture != null) {
      canvas.drawPicture(_cachedPicture!);
    }

    // 仅绘制新增笔画（自上次缓存后）
    final newStrokes = strokes.sublist(_cachedStrokeCount);
    for (final stroke in newStrokes) {
      _drawStroke(canvas, stroke);
    }

    // 绘制当前笔画
    _drawCurrentStroke(canvas);

    // 笔画数变化时更新缓存
    if (strokes.length != _cachedStrokeCount && currentPoints.isEmpty) {
      _updateCache(canvas, size);
    }
  }

  void _updateCache(Canvas canvas, Size size) {
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    for (final stroke in strokes) {
      _drawStroke(canvas, stroke);
    }
    _cachedPicture?.dispose();
    _cachedPicture = recorder.endRecording();
    _cachedStrokeCount = strokes.length;
  }
}
```

#### 8.2.2 采样优化

```dart
/// 自适应采样率控制
///
/// 高刷新率设备（120Hz/144Hz）会产生过多采样点
/// 根据设备能力和书写速度自适应调整
class AdaptiveSampler {
  final int _targetFps;
  int _lastSampleTime = 0;

  AdaptiveSampler({int targetFps = 60}) : _targetFps = targetFps;

  bool shouldSample(int currentTime) {
    final minInterval = 1000 ~/ _targetFps;
    if (currentTime - _lastSampleTime < minInterval) {
      return false;
    }
    _lastSampleTime = currentTime;
    return true;
  }

  /// 道格拉斯-普克算法（Douglas-Peucker）抽稀
  ///
  /// 在保持笔画形状的前提下减少点数
  List<InkPoint> simplify(List<InkPoint> points, {double tolerance = 1.0}) {
    if (points.length < 3) return points;

    final keep = List.filled(points.length, false);
    keep[0] = true;
    keep[points.length - 1] = true;

    _douglasPeucker(points, 0, points.length - 1, tolerance, keep);

    return points.asMap()
        .entries
        .where((e) => keep[e.key])
        .map((e) => e.value)
        .toList();
  }

  void _douglasPeucker(
    List<InkPoint> points,
    int start,
    int end,
    double tolerance,
    List<bool> keep,
  ) {
    if (end <= start + 1) return;

    double maxDist = 0;
    int maxIdx = start;

    final p1 = Offset(points[start].x, points[start].y);
    final p2 = Offset(points[end].x, points[end].y);

    for (int i = start + 1; i < end; i++) {
      final p = Offset(points[i].x, points[i].y);
      final dist = _pointToLineDistance(p, p1, p2);
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }

    if (maxDist > tolerance) {
      keep[maxIdx] = true;
      _douglasPeucker(points, start, maxIdx, tolerance, keep);
      _douglasPeucker(points, maxIdx, end, tolerance, keep);
    }
  }

  double _pointToLineDistance(Offset p, Offset a, Offset b) {
    final ab = b - a;
    final ap = p - a;
    if (ab.dx == 0 && ab.dy == 0) return (p - a).distance;
    final t = (ap.dx * ab.dx + ap.dy * ab.dy) / (ab.dx * ab.dx + ab.dy * ab.dy);
    final projection = Offset(a.dx + t * ab.dx, a.dy + t * ab.dy);
    return (p - projection).distance;
  }
}
```

#### 8.2.3 网络层优化

```dart
/// 网络请求优化配置
class HwrDioConfig {
  static Options get recognizeOptions => Options(
    // 连接超时
    sendTimeout: const Duration(seconds: 3),
    // 响应超时
    receiveTimeout: const Duration(seconds: 8),
    // 启用 HTTP/2 多路复用
    // (Dio 5.x 通过底层 HTTP 客户端支持)
    headers: {
      'Accept-Encoding': 'gzip',
      'Content-Type': 'application/json',
    },
    // 响应类型
    responseType: ResponseType.json,
  );
}

/// 笔迹数据压缩传输
///
/// 将笔迹 JSON 压缩为 Gzip 后传输，减少约 60-70% 体积
class CompressedHwrInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (options.path == '/api/v1/hwr/recognize' && options.data != null) {
      final jsonStr = jsonEncode(options.data);
      final compressed = gzip.encode(utf8.encode(jsonStr));

      options.headers['Content-Encoding'] = 'gzip';
      options.headers['Content-Length'] = compressed.length.toString();
      options.data = compressed;
    }
    handler.next(options);
  }
}
```

### 8.3 端侧模型优化

| 优化手段 | 效果 | 说明 |
| --- | --- | --- |
| INT8 量化 | 模型体积减小 75%，推理速度提升 30-50% | 使用 ONNX Runtime 动态量化 |
| Isolate 推理 | 消除 UI 线程 jank | 模型推理在独立 Isolate 中执行 |
| 模型预加载 | 首次识别零延迟 | App 启动后异步预加载模型到内存 |
| 懒加载符号映射 | 减少内存占用 | LaTeX 符号映射表按需加载 |
| 结果缓存 | 相同笔迹不重复识别 | LRU 缓存（key = 笔迹哈希，capacity = 10） |

---

## 9. 安全考虑

### 9.1 数据安全

| 维度 | 措施 |
| --- | --- |
| 笔迹数据传输 | HTTPS/TLS 1.2+ 加密传输，Gzip 压缩 |
| 笔迹数据存储 | 笔迹原始数据不持久化到磁盘，仅内存中存活 |
| 识别结果存储 | 仅缓存最近 5 条 LaTeX 结果到 SharedPreferences |
| 用户反馈数据 | 脱敏后通过统一反馈管线上传（不包含用户身份信息） |

### 9.2 权限控制

```dart
/// 手写识别功能权限检查
class HwrPermissionChecker {
  final UserEntitlementService _entitlement;

  /// 检查用户是否有权使用手写识别
  ///
  /// 规则：
  /// - 免费用户：每日 10 次云端识别（端侧不限）
  /// - 会员用户：每日 100 次云端识别（端侧不限）
  /// - VIP 用户：无限次云端识别
  Future<HwrPermission> check(String userId) async {
    final entitlement = await _entitlement.get(userId);

    final isMember = entitlement.isMember;
    final dailyUsed = await _getDailyUsage(userId);

    if (!isMember) {
      if (dailyUsed >= 10) {
        return HwrPermission(
          allowed: true,
          cloudAllowed: false,
          reason: '免费用户每日云端识别已达上限，已切换离线模式',
        );
      }
    } else if (entitlement.tier == MembershipTier.vip) {
      return const HwrPermission(allowed: true, cloudAllowed: true);
    } else {
      if (dailyUsed >= 100) {
        return HwrPermission(
          allowed: true,
          cloudAllowed: false,
          reason: '今日云端识别已达上限，已切换离线模式',
        );
      }
    }

    return const HwrPermission(allowed: true, cloudAllowed: true);
  }

  Future<int> _getDailyUsage(String userId) async {
    // 查询 Redis 计数器：hwr:daily:{userId}:{date}
    // ...
    return 0;
  }
}

class HwrPermission {
  final bool allowed;
  final bool cloudAllowed;
  final String? reason;

  const HwrPermission({
    required this.allowed,
    required this.cloudAllowed,
    this.reason,
  });
}
```

### 9.3 审计日志

```dart
/// 手写识别审计事件
///
/// 上报至统一埋点平台（复用客户端埋点体系）
void _logHwrEvent({
  required String eventName,
  required Map<String, dynamic> properties,
}) {
  AnalyticsTracker.track('hwr_$eventName', properties: {
    ...properties,
    'timestamp': DateTime.now().millisecondsSinceEpoch,
  });
}

// 关键埋点事件
// - hwr_start:        用户开始书写
// - hwr_submit:       提交识别请求
// - hwr_result:       识别结果返回
// - hwr_confirm:      用户确认结果
// - hwr_correct:      用户修正结果
// - hwr_clear:        用户清空画布
// - hwr_switch_input: 用户切换到键盘输入
// - hwr_error:        识别错误
```

---

## 10. 与其他模块的集成

### 10.1 集成接口定义

```dart
/// 对外暴露的手写识别服务接口
///
/// 其他模块通过此接口调用手写识别功能
abstract class HandwritingService {
  /// 打开手写输入面板
  ///
  /// [onConfirmed] - 用户确认 LaTeX 后的回调
  /// [context] - 场景上下文
  void openHandwritingPanel({
    required BuildContext context,
    required HwrScene scene,
    required ValueChanged<String> onConfirmed,
  });

  /// 获取最近识别历史
  List<String> getRecentHistory({int limit = 5});

  /// 检查功能是否可用
  bool get isAvailable;
}
```

### 10.2 AI 对话页面集成

```dart
// 在 AI 对话页面底部输入栏中添加手写入口
class AiDialogInputBar extends StatelessWidget {
  final HandwritingService _hwService = ServiceLocator.get<HandwritingService>();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        // ... 文本输入框 ...

        // 手写公式按钮
        IconButton(
          icon: const Icon(Icons.draw),
          tooltip: '手写公式',
          onPressed: () => _hwService.openHandwritingPanel(
            context: context,
            scene: HwrScene.aiDialog,
            onConfirmed: (latex) {
              // 将 LaTeX 插入到输入框
              _insertLatexToInput(latex);
            },
          ),
        ),
      ],
    );
  }
}
```

### 10.3 错题订正页面集成

```dart
// 错题订正页面的手写解题过程
class MistakeCorrectionPage extends StatefulWidget {
  @override
  State<MistakeCorrectionPage> createState() => _MistakeCorrectionPageState();
}

class _MistakeCorrectionPageState extends State<MistakeCorrectionPage> {
  String? _studentLatex;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text('请手写你的解题过程'),
        const SizedBox(height: 16),

        // 手写画布
        HandwritingCanvas(
          engine: ServiceLocator.get<HandwritingRecognitionEngine>(),
          context: const HwrContext(
            grade: '初三', // 从用户档案获取
            subject: 'math',
            scene: HwrScene.mistakeCorrect,
          ),
          onLatexConfirmed: (latex) {
            setState(() => _studentLatex = latex);
            // 自动提交 AI 批改
            _submitForCorrection(latex);
          },
        ),

        // LaTeX 预览
        if (_studentLatex != null)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: MathPreview(latex: _studentLatex!),
            ),
          ),
      ],
    );
  }
}
```

### 10.4 与数学公式输入系统的协作

当手写识别置信度较低时，用户可选择切换到符号面板编辑。两模块通过统一的 LaTeX 中间格式交互：

```
手写画布 ──(LaTeX)──► 数学公式输入系统(符号面板)
                          │
                    (LaTeX 确认)
                          │
                          ▼
                    下游模块 (AI 对话/题库/错题)
```

```dart
/// 手写 → 符号面板的无缝切换
class HybridFormulaInput extends StatefulWidget {
  @override
  State<HybridFormulaInput> createState() => _HybridFormulaInputState();
}

class _HybridFormulaInputState extends State<HybridFormulaInput> {
  _InputMode _mode = _InputMode.handwriting;
  String _currentLatex = '';

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        if (_mode == _InputMode.handwriting)
          HandwritingCanvas(
            engine: ServiceLocator.get<HandwritingRecognitionEngine>(),
            context: const HwrContext(grade: '初三', subject: 'math', scene: HwrScene.freeInput),
            onLatexConfirmed: (latex) {
              setState(() {
                _currentLatex = latex;
                _mode = _InputMode.edit; // 切换到符号面板编辑
              });
            },
          )
        else
          FormulaEditor(
            initialLatex: _currentLatex, // 将手写结果传入符号面板继续编辑
            onChanged: (latex) => setState(() => _currentLatex = latex),
          ),

        // 模式切换按钮
        TextButton.icon(
          icon: Icon(_mode == _InputMode.handwriting ? Icons.keyboard : Icons.draw),
          label: Text(_mode == _InputMode.handwriting ? '键盘编辑' : '手写输入'),
          onPressed: () => setState(() {
            _mode = _mode == _InputMode.handwriting
                ? _InputMode.edit
                : _InputMode.handwriting;
          }),
        ),
      ],
    );
  }
}

enum _InputMode { handwriting, edit }
```

---

## 11. 测试策略

### 11.1 单元测试

| 测试对象 | 测试重点 | 覆盖目标 |
| --- | --- | --- |
| InkPoint / InkStroke | 序列化/反序列化正确性 | 100% |
| AdaptiveSampler | 高频采样过滤、Douglas-Peucker 抽稀精度 | ≥ 90% |
| 笔迹平滑算法 | 平滑后曲线无异常尖角 | ≥ 90% |
| 笔画分组算法 | 时空邻近性判断正确 | ≥ 85% |
| RecognitionStrategyResolver | 各网络/用户偏好场景下策略选择正确 | 100% |
| LaTeX 后处理修正 | 常见误识别修正（如 l→1, O→0） | ≥ 80% |

```dart
// 单元测试示例
 group('AdaptiveSampler', () {
    test('should filter high-frequency samples', () {
      final sampler = AdaptiveSampler(targetFps: 60);
      final now = 1000;

      expect(sampler.shouldSample(now), isTrue);
      expect(sampler.shouldSample(now + 8), isFalse);  // < 16ms, 过滤
      expect(sampler.shouldSample(now + 17), isTrue);   // > 16ms, 通过
    });

    test('Douglas-Peucker should preserve shape', () {
      final sampler = AdaptiveSampler();
      final points = [
        InkPoint(x: 0, y: 0, timestamp: 0),
        InkPoint(x: 5, y: 0.5, timestamp: 16),
        InkPoint(x: 10, y: 0, timestamp: 32),
        InkPoint(x: 15, y: 5, timestamp: 48),  // 偏离点
        InkPoint(x: 20, y: 0, timestamp: 64),
      ];

      final simplified = sampler.simplify(points, tolerance: 2.0);
      expect(simplified.length, lessThan(points.length));
      expect(simplified.first.x, equals(0));
      expect(simplified.last.x, equals(20));
    });
  });
```

### 11.2 Widget 测试

| 测试场景 | 验证点 |
| --- | --- |
| 基本书写交互 | 笔迹在画布上正确渲染、抬笔后笔画保存 |
| 撤销/清空 | 撤销移除最后一笔、清空移除所有笔画 |
| 候选结果展示 | 多候选列表正确渲染、点击候选触发确认回调 |
| 模式切换 | 手写 → 键盘切换时 LaTeX 数据正确传递 |
| 空状态 | 空画布显示引导文案 |

### 11.3 集成测试

| 测试场景 | 前置条件 | 验证点 |
| --- | --- | --- |
| 端侧识别完整流程 | 端侧模型已加载 | 书写 → 等待 → 候选出现 → 确认 → LaTeX 输出 |
| 云端识别完整流程 | 网络可用 | 书写 → 等待 → 云端候选出现 → 确认 |
| 云端超时降级 | 模拟云端 >3s 延迟 | 自动降级端侧识别 |
| 离线模式 | 关闭网络 | 仅端侧识别，无云端请求 |
| AI 对话页集成 | 进入 AI 对话 | 手写按钮可触达，确认后 LaTeX 插入输入框 |

### 11.4 性能测试

| 指标 | 测试方法 | 目标 |
| --- | --- | --- |
| 书写帧率 | Flutter DevTools Performance 面板 | ≥ 60fps，无 jank |
| 端侧推理耗时 | Stopwatch 计时（100 笔画） | < 300ms |
| 内存峰值 | Flutter DevTools Memory 面板 | 增量 < 80MB |
| 包体积 | 构建 APK 对比增量 | < 20MB |

### 11.5 识别准确率测试

准备标准测试集（按年级和学科分类）：

| 测试集 | 笔迹样本数 | 符号覆盖 | 目标 Top-1 准确率 |
| --- | --- | --- | --- |
| 小学算术 | 500 | +−×÷=<> 分数 | ≥ 92% |
| 初中代数 | 500 | 方程、不等式、函数、指数 | ≥ 88% |
| 初中几何 | 300 | 三角函数、角度、相似符号 | ≥ 85% |
| 高中数学 | 500 | 极限、导数、积分、矩阵 | ≥ 82% |
| 物理公式 | 300 | 单位、向量、矢量符号 | ≥ 80% |

---

## 12. 配置参数汇总

```yaml
# config/handwriting_config.yaml

handwriting:
  # 端侧模型
  on_device:
    enabled: true
    model_path: "assets/models/hwr_math_v2.onnx"
    model_size_mb: 15
    quantized: true
    max_strokes: 200
    inference_timeout_ms: 3000

  # 云端识别
  cloud:
    endpoint: "/api/v1/hwr/recognize"
    timeout_ms: 8000
    fallback_timeout_ms: 3000  # 降级端侧的触发超时
    max_requests_per_minute: 10
    max_requests_per_day_free: 10
    max_requests_per_day_member: 100

  # 笔迹采集
  capture:
    target_fps: 60
    max_sample_interval_ms: 16
    idle_timeout_ms: 1500
    pressure_sensitive: true  # 支持压感设备

  # 预处理
  preprocess:
    smoothing_window: 3
    min_stroke_length_px: 2.0
    douglas_peucker_tolerance: 1.0
    normalization_target_size: 1.0

  # 增量预识别
  incremental:
    enabled: true
    min_new_strokes: 3
    strategy: on_device_only

  # 候选结果
  candidates:
    max_display: 3
    auto_confirm_threshold: 0.95
    auto_confirm_delay_ms: 3000

  # 缓存
  cache:
    result_cache_size: 10
    history_cache_size: 5
    history_ttl_days: 30
```

---

## 13. 未来演进方向

| 阶段 | 演进内容 |
| --- | --- |
| V1.0 | 端侧基础模型（120 符号）+ 云端高精度模型 |
| V1.5 | 增加化学方程式手写识别（→ mhchem LaTeX） |
| V2.0 | 多字混合手写（中英文 + 公式 + 标点的混合输入） |
| V2.5 | 端侧模型持续学习（基于用户反馈数据微调个性化模型） |
| V3.0 | 3D 手写（空间几何体绘制 → 3D 模型生成） |