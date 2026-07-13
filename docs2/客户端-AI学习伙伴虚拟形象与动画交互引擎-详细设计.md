# 客户端-AI学习伙伴虚拟形象与动画交互引擎 详细设计

## 1. 概述

### 1.1 模块定位

AI 学习伙伴虚拟形象与动画交互引擎是 PrimeTop 客户端的核心体验层组件，负责在 AI 辅导对话、学习鼓励、引导提示等场景中渲染可交互的虚拟角色。该引擎将 AI 的"文字大脑"具象化为有温度、有表情、有肢体语言的数字伙伴，显著提升低龄用户的亲近感和学习动机。

### 1.2 核心职责

| 职责 | 说明 |
| --- | --- |
| 角色渲染 | 在客户端高效渲染 2D/3D 虚拟角色形象 |
| 表情驱动 | 根据 AI 回复的情感语义实时驱动角色表情 |
| 动画调度 | 管理待机、说话、高兴、思考、鼓励等动画状态的切换 |
| 口型同步 | 将 TTS 音频流与角色嘴型动画精确同步 |
| 交互响应 | 响应用户触摸（点击、拖拽），产生角色反馈动画 |
| 形象定制 | 支持用户选择/换装/主题切换角色外观 |
| 性能管控 | 在低端设备上自动降级，保证帧率与内存安全 |

### 1.3 依赖关系

```
┌─────────────────────────────────────────────────────┐
│                 AI 学习伙伴虚拟形象引擎                 │
├─────────┬──────────┬──────────┬──────────┬──────────┤
│  TTS    │ AI对话   │ 学习激励  │ 用户偏好  │ 资源管理  │
│  引擎   │ 消息流    │ 事件总线  │ 配置中心  │ 下载器    │
└─────────┴──────────┴──────────┴──────────┴──────────┘
```

- **上游输入**：AI 对话消息流（情感标签、文本内容）、TTS 音频流、学习激励事件（答对/答错/完成里程碑）
- **下游输出**：渲染画面（Surface/Texture）、触觉反馈、音频（角色专属音效）
- **配置依赖**：用户角色偏好设置、学段自适应配置、资源包版本

### 1.4 设计目标

1. **首屏渲染 ≤ 500ms**：角色贴图 + 骨骼数据加载完成后半秒内可见。
2. **动画帧率 ≥ 30fps（低端设备）/ 60fps（中高端）**：通过 LOD 策略自动适配。
3. **内存占用 ≤ 50MB**：含贴图、骨骼、动画数据的总内存预算。
4. **口型同步误差 ≤ 80ms**：音频与嘴型动作的可感知延迟控制在人类察觉阈值以下。
5. **资源包增量 ≤ 5MB/角色**：单个角色完整资源的下载体积控制。

---

## 2. 技术选型与架构

### 2.1 渲染技术选型

| 方案 | 优势 | 劣势 | 适用场景 | PrimeTop 选择 |
| --- | --- | --- | --- | --- |
| **Live2D Cubism** | 2D 纹理模拟 3D 效果，资源体积小，表现力强，日系教育/游戏行业成熟 | 复杂物理效果有限，需要专用编辑器制作 | 幼儿/小学阶段角色 | ✅ 主方案 |
| **Spine 2D** | 骨骼动画成熟，运行时轻量，Flutter 生态支持好 | 表现力不如 Live2D，无原生口型同步 | 全阶段通用备选 | ✅ 备选方案 |
| **Lottie (After Effects)** | 设计师友好，动效精美 | 交互性弱，无法实时驱动表情 | UI 动效、过场动画 | ⚠️ 辅助使用 |
| **Three.js / Flutter GL** | 真 3D 渲染，自由度高 | 资源体积大，性能消耗高，低端机不友好 | 高端机型 / 高中阶段 | 🔮 远期探索 |
| **平台原生 AvatarKit** | 系统级优化 | 平台差异大，定制受限 | 不适用 | ❌ |

**决策**：MVP 阶段采用 **Live2D Cubism SDK**（iOS/Android 均有原生 SDK）+ Flutter Platform Channel 桥接；备选 **Spine** 用于轻量场景。

### 2.2 整体架构

```text
┌─────────────────────────────────────────────────────────────┐
│                    应用层 (Flutter UI)                        │
│  ┌───────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │ AI对话页面 │  │ 学习激励弹窗  │  │ 角色定制页面        │    │
│  └─────┬─────┘  └──────┬───────┘  └─────────┬──────────┘    │
│        │               │                     │                │
├────────┼───────────────┼─────────────────────┼────────────────┤
│        ▼               ▼                     ▼                │
│  ┌──────────────────────────────────────────────────────┐    │
│  │            CompanionEngine (Dart 核心层)               │    │
│  │  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌─────────┐ │    │
│  │  │ 状态机   │ │ 情感驱动器 │ │ 动画调度器│ │资源管理器│ │    │
│  │  │StateMachine│ │EmotionDriver│ │AnimBlender│ │AssetMgr │ │    │
│  │  └──────────┘ └───────────┘ └──────────┘ └─────────┘ │    │
│  │  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌─────────┐ │    │
│  │  │ 口型同步 │ │ 交互响应器 │ │ LOD策略器 │ │配置中心  │ │    │
│  │  │LipSync   │ │InteractionH│ │ LODMgr   │ │ConfigMgr│ │    │
│  │  └──────────┘ └───────────┘ └──────────┘ └─────────┘ │    │
│  └──────────────────────────────────────────────────────┘    │
│                             │                                 │
├─────────────────────────────┼─────────────────────────────────┤
│                    Platform Channel (桥接层)                   │
│                             │                                 │
├─────────────────────────────┼─────────────────────────────────┤
│              原生渲染层 (Native SDK)                           │
│  ┌────────────────────┐    ┌────────────────────┐            │
│  │ Live2D Cubism SDK  │    │ Spine Runtime SDK  │            │
│  │ (iOS / Android)    │    │ (iOS / Android)    │            │
│  └────────────────────┘    └────────────────────┘            │
│  ┌────────────────────┐    ┌────────────────────┐            │
│  │ OpenGL ES / Metal  │    │ Vulkan / Skia      │            │
│  │ 渲染管线            │    │ 渲染管线            │            │
│  └────────────────────┘    └────────────────────┘            │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. 数据模型

### 3.1 角色模型定义

```dart
/// AI 学习伙伴角色模型
class CompanionModel {
  /// 角色 ID（唯一标识）
  final String companionId;

  /// 角色显示名称
  final String displayName;

  /// 角色类型
  final CompanionType type;

  /// 适配学段范围
  final List<GradePhase> applicablePhases;

  /// 默认情感状态
  final CompanionEmotion defaultEmotion;

  /// Live2D 模型资源配置
  final Live2DModelConfig modelConfig;

  /// Spine 备选模型配置（可选）
  final SpineModelConfig? spineConfig;

  /// 角色个性参数
  final CompanionPersonality personality;

  /// 语音音色 ID（关联 TTS 引擎）
  final String voiceProfileId;

  /// 解锁条件
  final CompanionUnlockCondition? unlockCondition;

  /// 资源包下载地址
  final String assetBundleUrl;

  /// 资源包版本号
  final String assetVersion;

  /// 资源包大小（字节）
  final int assetSizeBytes;
}

enum CompanionType {
  /// 学者猫 - 默认角色，活泼好奇
  scholarCat,
  /// 知识精灵 - 幼儿启蒙专用
  knowledgeFairy,
  /// 学霸狮 - 小学阶段
  studyLion,
  /// 智慧鹰 - 初高中阶段
  wisdomOwl,
  /// 限时/活动角色
  seasonal,
  /// 付费角色
  premium,
}

enum GradePhase {
  kindergarten,  // 幼儿
  primaryLower,  // 小学低年级
  primaryUpper,  // 小学高年级
  juniorHigh,    // 初中
  seniorHigh,    // 高中
}
```

### 3.2 情感状态定义

```dart
/// 角色情感状态枚举
enum CompanionEmotion {
  /// 待机/默认
  idle,
  /// 开心（答对题、完成任务）
  happy,
  /// 鼓励（答错题后安慰）
  encouraging,
  /// 思考（AI 正在生成回复）
  thinking,
  /// 惊喜（完成里程碑、连续答对）
  surprised,
  /// 专注（学生在长时间学习中）
  focused,
  /// 困惑（检测到学生犹豫）
  confused,
  /// 庆祝（完成章节、通过考试）
  celebrating,
  /// 睡眠（长时间无操作）
  sleeping,
  /// 挥手问候（启动时）
  greeting,
}

/// 情感强度（0.0 ~ 1.0）
typedef EmotionIntensity = double;

/// 情感状态数据类
class EmotionState {
  final CompanionEmotion emotion;
  final EmotionIntensity intensity;
  final DateTime timestamp;

  /// 情感混合权重（用于过渡动画）
  /// 例：从 happy → idle 的过渡期间，两个状态的权重各 0.5
  final Map<CompanionEmotion, double>? blendWeights;

  const EmotionState({
    required this.emotion,
    this.intensity = 1.0,
    required this.timestamp,
    this.blendWeights,
  });
}
```

### 3.3 动画片段定义

```dart
/// 动画片段元数据
class AnimationClip {
  /// 动画 ID
  final String clipId;

  /// 关联的情感状态
  final CompanionEmotion triggerEmotion;

  /// 动画类型
  final AnimationType type;

  /// 动画时长（毫秒）
  final int durationMs;

  /// 是否循环
  final bool isLooping;

  /// 优先级（数值越大优先级越高，可打断低优先级动画）
  final int priority;

  /// 入场过渡时间（毫秒）
  final int fadeInMs;

  /// 出场过渡时间（毫秒）
  final int fadeOutMs;

  /// 触发音效路径（可选）
  final String? soundEffectPath;
}

enum AnimationType {
  idle,        // 待机呼吸
  talk,        // 说话口型
  emotion,     // 情绪表达
  reaction,    // 交互反应
  transition,  // 状态过渡
  special,     // 特殊（庆祝、睡眠等）
}
```

### 3.4 用户偏好与角色配置

```dart
/// 用户对学习伙伴的偏好配置
class CompanionUserPreference {
  /// 用户 ID
  final String userId;

  /// 当前选择的角色 ID
  final String activeCompanionId;

  /// 是否启用角色显示
  final bool enabled;

  /// 角色显示尺寸
  final CompanionSize size;

  /// 角色在屏幕上的位置
  final CompanionPosition position;

  /// 是否启用语音（TTS）
  final bool voiceEnabled;

  /// 是否启用互动音效
  final bool soundEffectsEnabled;

  /// 是否启用触觉反馈
  final bool hapticEnabled;

  /// 动画质量等级
  final AnimationQuality quality;

  /// 互动敏感度（0.0 无互动 ~ 1.0 频繁互动）
  final double interactionSensitivity;

  /// 已解锁的角色 ID 列表
  final Set<String> unlockedCompanionIds;

  /// 各角色的使用统计
  final Map<String, CompanionUsageStats> usageStats;
}

enum CompanionSize {
  small,   // 占屏幕高度 20%
  medium,  // 占屏幕高度 30%（默认）
  large,   // 占屏幕高度 40%
}

enum CompanionPosition {
  bottomRight,  // 右下角（默认，AI 对话场景）
  bottomLeft,   // 左下角
  topRight,     // 右上角（不遮挡内容时）
  floating,     // 悬浮（可拖拽）
}

enum AnimationQuality {
  /// 低画质：帧率限制 30fps，禁用粒子特效
  low,
  /// 中画质：帧率 30fps，简单特效
  medium,
  /// 高画质：帧率 60fps，全特效
  high,
  /// 自动（根据设备性能动态调整）
  auto,
}

/// 角色使用统计
class CompanionUsageStats {
  final String companionId;
  int totalInteractions;
  int totalDisplayTimeMs;
  DateTime lastUsedAt;
  double userRating;  // 用户对角色的评分 1-5
}
```

### 3.5 资源包元数据

```dart
/// Live2D 模型资源包描述
class Live2DModelConfig {
  /// 模型文件路径 (.moc3)
  final String modelPath;

  /// 纹理文件路径列表
  final List<String> texturePaths;

  /// 物理演算文件路径
  final String? physicsPath;

  /// 表情文件路径映射 (表情名 → 文件路径)
  final Map<String, String> expressionPaths;

  /// 动画文件路径映射 (动画名 → .motion3.json 路径)
  final Map<String, String> motionPaths;

  /// 姿势文件路径
  final String? posePath;

  /// 眼球追踪参数文件
  final String? eyeBlinkConfigPath;

  /// 口型参数映射配置
  final LipSyncConfig lipSyncConfig;

  /// 模型缩放参数
  final double modelScale;

  /// 模型锚点坐标
  final Offset modelAnchor;
}

/// 口型同步配置
class LipSyncConfig {
  /// 音素到模型参数的映射
  /// Live2D 通过 Parameters (ParamMouthOpenY, ParamMouthForm) 控制嘴型
  final Map<Phoneme, MouthParam> phonemeMapping;

  /// 嘴型张开参数名
  final String mouthOpenParam;

  /// 嘴型形状参数名
  final String mouthFormParam;

  /// 平滑系数（0.0 ~ 1.0，值越大越平滑但延迟越高）
  final double smoothingFactor;

  /// 静默阈值（音量低于此值时闭嘴）
  final double silenceThreshold;
}

/// 音素枚举（汉语拼音方案）
enum Phoneme {
  // 声母
  b, p, m, f, d, t, n, l, g, k, h, j, q, x,
  zh, ch, sh, r, z, c, s, y, w,
  // 韵母
  a, o, e, i, u, ü, ai, ei, ui, ao, ou, iu,
  ie, üe, er, an, en, in, un, ün,
  ang, eng, ing, ong,
  // 静默
  silence,
}

/// 嘴型参数
class MouthParam {
  final double openValue;   // 嘴巴张开度 0-1
  final double formValue;   // 嘴型形状 -1~1（-1=闭嘴微笑, 0=中性, 1=张大）

  const MouthParam({required this.openValue, required this.formValue});
}
```

---

## 4. 核心子系统设计

### 4.1 有限状态机 — 角色状态流转

角色行为由一个分层有限状态机（HFSM）驱动，管理宏观情感状态和微观动画状态。

```text
┌─────────────────────────────────────────────────────────────┐
│                      宏观情感状态层                            │
│                                                             │
│   ┌─────────┐    ┌──────────┐    ┌──────────┐             │
│   │ SLEEPING│◄──►│  IDLE    │◄──►│ TALKING  │             │
│   └─────────┘    └────┬─────┘    └────┬─────┘             │
│                       │               │                     │
│              ┌────────┼────────┐      │                     │
│              ▼        ▼        ▼      ▼                     │
│        ┌──────┐ ┌──────┐ ┌─────────┐ ┌──────┐              │
│        │HAPPY │ │THINK-│ │ENCOURAG-│ │FOCUSED│              │
│        │      │ │ING   │ │ING      │ │      │              │
│        └──┬───┘ └──────┘ └─────────┘ └──────┘              │
│           │                                                  │
│           ▼                                                  │
│     ┌───────────┐                                           │
│     │CELEBRATING│                                           │
│     └───────────┘                                           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    微观动画状态层                              │
│                                                             │
│  TALKING 状态下的子状态：                                     │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌──────────┐  │
│  │LipSync   │  │Gesture   │  │Blink     │  │Breath    │  │
│  │(嘴型同步) │  │(手势动画) │  │(眨眼)    │  │(呼吸)    │  │
│  └──────────┘  └───────────┘  └──────────┘  └──────────┘  │
│                                                             │
│  所有状态共享的子状态：                                        │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐                │
│  │EyeTrack  │  │Physics    │  │IdleMotion│                │
│  │(眼球追踪) │  │(物理模拟)  │  │(微动作)   │                │
│  └──────────┘  └───────────┘  └──────────┘                │
└─────────────────────────────────────────────────────────────┘
```

```dart
/// 角色状态机核心实现
class CompanionStateMachine {
  final _stateController = BehaviorSubject<CompanionEmotion>.seeded(
    CompanionEmotion.idle,
  );

  /// 当前状态
  Stream<CompanionEmotion> get currentState => _stateController.stream;

  /// 状态转移规则
  static const Map<CompanionEmotion, Set<CompanionEmotion>> _transitions = {
    CompanionEmotion.idle: {
      CompanionEmotion.talking,
      CompanionEmotion.thinking,
      CompanionEmotion.happy,
      CompanionEmotion.greeting,
      CompanionEmotion.sleeping,
      CompanionEmotion.focused,
    },
    CompanionEmotion.talking: {
      CompanionEmotion.idle,
      CompanionEmotion.happy,
      CompanionEmotion.encouraging,
    },
    CompanionEmotion.thinking: {
      CompanionEmotion.talking,
      CompanionEmotion.idle,
    },
    CompanionEmotion.happy: {
      CompanionEmotion.idle,
      CompanionEmotion.celebrating,
      CompanionEmotion.talking,
    },
    CompanionEmotion.encouraging: {
      CompanionEmotion.idle,
      CompanionEmotion.talking,
    },
    CompanionEmotion.celebrating: {
      CompanionEmotion.idle,
      CompanionEmotion.happy,
    },
    CompanionEmotion.sleeping: {
      CompanionEmotion.idle,
      CompanionEmotion.greeting,
    },
    CompanionEmotion.greeting: {
      CompanionEmotion.idle,
    },
    CompanionEmotion.focused: {
      CompanionEmotion.idle,
      CompanionEmotion.thinking,
    },
    CompanionEmotion.confused: {
      CompanionEmotion.idle,
      CompanionEmotion.encouraging,
    },
    CompanionEmotion.surprised: {
      CompanionEmotion.celebrating,
      CompanionEmotion.happy,
      CompanionEmotion.idle,
    },
  };

  /// 请求状态转移
  void transitionTo(CompanionEmotion target, {Duration? overrideDuration}) {
    final current = _stateController.value;
    if (current == target) return;

    final allowed = _transitions[current] ?? {};
    if (!allowed.contains(target)) {
      // 非法转移，回退到 idle 作为中间状态
      _stateController.add(CompanionEmotion.idle);
      Future.delayed(const Duration(milliseconds: 300), () {
        _stateController.add(target);
      });
      return;
    }

    _stateController.add(target);

    // 自动回归 idle（对于非持续状态）
    if (_autoReturnStates.contains(target)) {
      final duration = overrideDuration ?? _defaultDuration[target]!;
      Future.delayed(duration, () {
        if (_stateController.value == target) {
          _stateController.add(CompanionEmotion.idle);
        }
      });
    }
  }

  /// 会自动回归 idle 的状态
  static const _autoReturnStates = {
    CompanionEmotion.happy,
    CompanionEmotion.surprised,
    CompanionEmotion.celebrating,
    CompanionEmotion.greeting,
    CompanionEmotion.confused,
  };

  /// 各状态默认持续时间
  static const Map<CompanionEmotion, Duration> _defaultDuration = {
    CompanionEmotion.happy: Duration(seconds: 3),
    CompanionEmotion.surprised: Duration(seconds: 2),
    CompanionEmotion.celebrating: Duration(seconds: 5),
    CompanionEmotion.greeting: Duration(seconds: 2),
    CompanionEmotion.confused: Duration(seconds: 3),
  };
}
```

### 4.2 情感驱动器

情感驱动器负责分析 AI 回复内容、学习事件和用户行为，输出对应的情感指令。

```dart
/// 情感驱动器：将外部事件映射为角色情感状态
class EmotionDriver {
  final CompanionStateMachine _stateMachine;
  final EmotionAnalyzer _analyzer;

  EmotionDriver(this._stateMachine, this._analyzer);

  /// 处理 AI 对话消息，提取情感倾向
  void processAIMessage(AIResponseMessage message) {
    // 1. 如果 AI 正在生成（thinking），驱动思考动画
    if (message.status == AIResponseStatus.generating) {
      _stateMachine.transitionTo(CompanionEmotion.thinking);
      return;
    }

    // 2. AI 回复完成，切换到 talking
    if (message.status == AIResponseStatus.completed) {
      _stateMachine.transitionTo(CompanionEmotion.talking);
      return;
    }

    // 3. AI 回复出错，切换到 confused
    if (message.status == AIResponseStatus.error) {
      _stateMachine.transitionTo(CompanionEmotion.confused);
      return;
    }
  }

  /// 处理答题事件
  void processAnswerEvent(AnswerResultEvent event) {
    switch (event.result) {
      case AnswerResult.correct:
        if (event.consecutiveCorrect >= 5) {
          _stateMachine.transitionTo(CompanionEmotion.celebrating);
        } else {
          _stateMachine.transitionTo(CompanionEmotion.happy);
        }
        break;
      case AnswerResult.incorrect:
        _stateMachine.transitionTo(CompanionEmotion.encouraging);
        break;
      case AnswerResult.partial:
        _stateMachine.transitionTo(CompanionEmotion.encouraging);
        break;
    }
  }

  /// 处理学习里程碑事件
  void processMilestoneEvent(MilestoneEvent event) {
    switch (event.type) {
      case MilestoneType.chapterCompleted:
      case MilestoneType.examPassed:
        _stateMachine.transitionTo(
          CompanionEmotion.celebrating,
          overrideDuration: const Duration(seconds: 6),
        );
        break;
      case MilestoneType.streakReached:
        _stateMachine.transitionTo(CompanionEmotion.surprised);
        break;
      case MilestoneType.dailyGoalCompleted:
        _stateMachine.transitionTo(CompanionEmotion.happy);
        break;
    }
  }

  /// 处理空闲超时
  void processIdleTimeout(Duration idleDuration) {
    if (idleDuration.inMinutes >= 5) {
      _stateMachine.transitionTo(CompanionEmotion.sleeping);
    } else if (idleDuration.inSeconds >= 30) {
      // 长时间学习中显示专注状态
      _stateMachine.transitionTo(CompanionEmotion.focused);
    }
  }

  /// 处理应用启动
  void processAppLaunch() {
    _stateMachine.transitionTo(CompanionEmotion.greeting);
  }
}
```

### 4.3 口型同步引擎

口型同步是实现"角色在说话"感觉的关键技术环节。

```dart
/// 口型同步引擎
class LipSyncEngine {
  final LipSyncConfig _config;
  final TtsAudioStreamController _audioController;

  /// 音频频率分析窗口大小
  static const int _fftWindowSize = 1024;

  /// 音频采样率
  static const int _sampleRate = 22050;

  /// 当前嘴型张开度 (0.0 ~ 1.0)
  double _currentMouthOpen = 0.0;

  /// 目标嘴型张开度
  double _targetMouthOpen = 0.0;

  /// 当前嘴型形状 (-1.0 ~ 1.0)
  double _currentMouthForm = 0.0;

  /// 目标嘴型形状
  double _targetMouthForm = 0.0;

  /// 平滑后的振幅
  double _smoothedAmplitude = 0.0;

  LipSyncEngine(this._config, this._audioController);

  /// 主驱动循环：从 TTS 音频流提取振幅和频率，驱动嘴型参数
  ///
  /// 调用频率：每帧（约 16ms @ 60fps）
  void update(double deltaTime) {
    // 1. 获取当前音频帧的振幅
    final amplitude = _audioController.currentAmplitude;
    final frequency = _audioController.dominantFrequency;

    // 2. 振幅平滑处理（一阶低通滤波）
    final alpha = 1.0 - exp(-deltaTime / _config.smoothingFactor * 0.01);
    _smoothedAmplitude = _smoothedAmplitude * (1 - alpha) + amplitude * alpha;

    // 3. 判断是否静默
    if (_smoothedAmplitude < _config.silenceThreshold) {
      _targetMouthOpen = 0.0;
      _targetMouthForm = 0.0;
    } else {
      // 4. 根据频率范围估计元音类型
      final vowelEstimate = _estimateVowelFromFrequency(frequency);

      // 5. 计算目标嘴型参数
      _targetMouthOpen = (_smoothedAmplitude * 1.2).clamp(0.0, 1.0);
      _targetMouthForm = vowelEstimate;
    }

    // 6. 插值过渡（嘴型平滑变化）
    final lerpSpeed = 15.0 * deltaTime; // 过渡速度系数
    _currentMouthOpen += (_targetMouthOpen - _currentMouthOpen) * lerpSpeed.clamp(0.0, 1.0);
    _currentMouthForm += (_targetMouthForm - _currentMouthForm) * lerpSpeed.clamp(0.0, 1.0);

    // 7. 输出到渲染层
    _notifyRenderParams();
  }

  /// 根据频率分布粗略估计元音类型
  /// 返回值 -1.0 (闭嘴/i/) ~ 1.0 (张大/a/)
  double _estimateVowelFromFrequency(double freq) {
    if (freq < 300) return -0.8;   // 低频 → 类似 /a/ 但偏保守
    if (freq < 800) return 0.3;    // 中低频 → /o/, /e/
    if (freq < 1500) return -0.3;  // 中频 → /e/, /i/
    return -0.7;                   // 高频 → /i/, /u/
  }

  void _notifyRenderParams() {
    // 通过 Platform Channel 传递到原生 Live2D 渲染层
    PlatformChannel.instance.invokeMethod('updateLipSync', {
      'mouthOpen': _currentMouthOpen,
      'mouthForm': _currentMouthForm,
    });
  }
}
```

#### 拼音音素到嘴型的精确映射方案（高级模式）

对于需要精确口型同步的场景（如古诗朗读示范），采用基于拼音音素的查表驱动：

```dart
/// 精确口型同步：基于拼音序列的查表驱动
class PreciseLipSyncDriver {
  final LipSyncConfig _config;

  /// 当前正在播放的拼音音素队列
  final List<_PhonemeTiming> _phonemeQueue = [];

  /// 预处理：将 TTS 文本转换为拼音音素时间序列
  ///
  /// 示例输入："你好世界"
  /// 示例输出：[
  ///   {phoneme: n, startMs: 0, durationMs: 80},
  ///   {phoneme: i, startMs: 80, durationMs: 120},
  ///   {phoneme: h, startMs: 200, durationMs: 60},
  ///   {phoneme: ao, startMs: 260, durationMs: 200},
  ///   ...
  /// ]
  List<_PhonemeTiming> _textToPhonemeTimings(String text, List<int> wordBoundaries) {
    final pinyinList = PinyinConverter.convert(text);
    final timings = <_PhonemeTiming>[];

    int cursor = 0;
    for (final pinyin in pinyinList) {
      final phonemes = _splitPinyin(pinyin);
      final totalDuration = wordBoundaries[cursor + 1] - wordBoundaries[cursor];
      final perPhoneme = (totalDuration / phonemes.length).round();

      for (int i = 0; i < phonemes.length; i++) {
        timings.add(_PhonemeTiming(
          phoneme: phonemes[i],
          startMs: wordBoundaries[cursor] + i * perPhoneme,
          durationMs: perPhoneme,
        ));
      }
      cursor++;
    }
    return timings;
  }

  /// 根据时间戳查找当前应该应用的嘴型
  MouthParam? getMouthAt(int timestampMs) {
    // 二分查找当前时间对应的音素
    final active = _binarySearchActive(_phonemeQueue, timestampMs);
    if (active == null) return null;

    final param = _config.phonemeMapping[active.phoneme];
    if (param == null) return MouthParam(openValue: 0.0, formValue: 0.0);

    // 在音素持续时间内的渐入渐出
    final progress = (timestampMs - active.startMs) / active.durationMs;
    final envelope = _calculateEnvelope(progress);

    return MouthParam(
      openValue: param.openValue * envelope,
      formValue: param.formValue,
    );
  }

  /// 渐入渐出包络（避免嘴型突变）
  double _calculateEnvelope(double progress) {
    // 使用升余弦窗
    if (progress <= 0.0 || progress >= 1.0) return 0.0;
    return 0.5 * (1 - cos(2 * pi * progress));
  }

  List<Phoneme> _splitPinyin(String pinyin) {
    // 简化的拼音切分逻辑
    // 实际实现应使用完整的拼音词典匹配
    final result = <Phoneme>[];
    // ... 切分逻辑 ...
    return result;
  }

  _PhonemeTiming? _binarySearchActive(
    List<_PhonemeTiming> queue,
    int timestampMs,
  ) {
    int left = 0, right = queue.length - 1;
    while (left <= right) {
      final mid = (left + right) ~/ 2;
      final item = queue[mid];
      if (timestampMs >= item.startMs && timestampMs < item.startMs + item.durationMs) {
        return item;
      } else if (timestampMs < item.startMs) {
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }
    return null;
  }
}

class _PhonemeTiming {
  final Phoneme phoneme;
  final int startMs;
 