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
  /// 说话（TTS 音频播放中，口型同步激活）
  /// v1.0 缺陷修复: 状态机 _transitions 与情感驱动器均引用 talking，但枚举漏定义
  talking,
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
    // v1.0 缺陷修复: 原公式 alpha ≈ deltaTime/(smoothingFactor×100)，在 60fps 下
    // alpha ≈ 2×10⁻⁴，滤波器近似直通，平滑失效（嘴型随振幅噪声抖动）。
    // 修正为时间常数映射: tau = 50ms + smoothingFactor × 150ms（0~1 → 50~200ms）
    final tauSeconds = 0.05 + _config.smoothingFactor * 0.15;
    final alpha = 1.0 - exp(-deltaTime / tauSeconds);
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

  /// 根据第一共振峰（F1）粗略估计元音类型（振幅驱动模式的降级近似）
  /// 返回值 -1.0 (闭嘴收拢 /i/, /u/) ~ 1.0 (张大 /a/)
  /// v1.0 缺陷修复: 原映射注释与声学理论相反——/a/ 的 F1 约在 700-1000Hz（高频），
  /// /i/, /u/ 的 F1 约在 250-350Hz（低频），原实现低频返回闭嘴值却标注 /a/。
  double _estimateVowelFromFrequency(double freq) {
    if (freq < 350) return -0.7;   // 低 F1 → /i/, /u/（开口度小、唇形收拢）
    if (freq < 650) return -0.1;   // 中低 F1 → /o/, /e/（半开）
    if (freq < 1000) return 0.5;   // 中高 F1 → 向 /a/ 过渡
    return 0.8;                    // 高 F1 → /a/（张大）
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
  final int durationMs;

  const _PhonemeTiming({
    required this.phoneme,
    required this.startMs,
    required this.durationMs,
  });
}
```

#### 4.3.1 汉语拼音音素 → 嘴型参数基准映射表

精确口型同步依赖音素到嘴型参数的标准映射。下表为美术与动画制作基准（Live2D 参数坐标系），随角色资源包内置（`LipSyncConfig.phonemeMapping`），引擎内置同值兑底表用于资源缺失时兜底：

| 音素类别 | 音素 | openValue（开口度） | formValue（唇形） | 口型描述 |
| --- | --- | --- | --- | --- |
| 声母（清塞音） | b, p | 0.15 | 0.0 | 双唇闭合后瞬间微开 |
| 声母（清擦音） | f, h | 0.10 | -0.1 | 唇齿/喉部窄缝 |
| 声母（鼻音） | m, n | 0.15 | 0.0 | 双唇/舌尖轻闭鼻腔出声 |
| 声母（边音） | l | 0.20 | 0.1 | 舌尖抵齿龈微开 |
| 声母（舌尖中音） | d, t | 0.20 | 0.1 | 舌尖弹开微张 |
| 声母（舌根音） | g, k | 0.25 | 0.15 | 舌根抬起半开 |
| 声母（面音） | j, q, x | 0.20 | -0.2 | 唇角收窄前突 |
| 声母（翘舌音） | zh, ch, sh, r | 0.20 | -0.1 | 唇微突 |
| 声母（平舌音） | z, c, s | 0.15 | -0.2 | 唇角收窄 |
| 声母（半元音） | y, w | 0.20 | 0.2 | 向后续韵母过渡 |
| 韵母（低元音） | a | 1.00 | 0.8 | 大张 |
| 韵母（中元音） | o | 0.70 | 0.5 | 圆唇半开 |
| 韵母（中元音） | e | 0.60 | 0.3 | 扁唇半开 |
| 韵母（高元音） | i | 0.35 | -0.6 | 扁唇窄缝 |
| 韵母（高元音） | u | 0.30 | -0.4 | 圆唇窄缝（嘬嘴） |
| 韵母（高元音） | ü | 0.30 | -0.5 | 圆唇前突窄缝 |
| 韵母（二合） | ai, ao | 0.90 | 0.7 | 大张向半开滑动 |
| 韵母（二合） | ei, ou | 0.65 | 0.25 | 半开滑动 |
| 韵母（二合） | ui, iu, ie, üe | 0.45 | -0.3 | 半开向窄缝滑动 |
| 韵母（卷舌） | er | 0.45 | 0.0 | 半开卷舌 |
| 韵母（鼻韵尾） | an, ang | 0.75 | 0.55 | 半开鼻腔收音 |
| 韵母（鼻韵尾） | en, eng | 0.65 | 0.35 | 半开鼻腔收音 |
| 韵母（鼻韵尾） | in, ing | 0.50 | -0.15 | 窄开鼻腔收音 |
| 韵母（鼻韵尾） | un, ün, ong | 0.50 | -0.25 / 0.2 | 窄开/圆唇鼻腔收音 |
| 静默 | silence | 0.00 | 0.0 | 闭嘴 |

> 美术制作约束：formValue 的语义为 `-1 闭嘴微笑 ~ 0 中性 ~ 1 张大`，与 Live2D `ParamMouthForm` 坐标系一致；角色换装不得改变嘴型参数 ID（`ParamMouthOpenY` / `ParamMouthForm`），否则资源校验失败（COMP_005）。

```dart
/// 引擎内置兑底映射（与上表基准值一致）
/// 资源包未携带 phonemeMapping 或校验失败时使用
const Map<Phoneme, MouthParam> kFallbackPhonemeMapping = {
  Phoneme.a: MouthParam(openValue: 1.00, formValue: 0.8),
  Phoneme.o: MouthParam(openValue: 0.70, formValue: 0.5),
  Phoneme.e: MouthParam(openValue: 0.60, formValue: 0.3),
  Phoneme.i: MouthParam(openValue: 0.35, formValue: -0.6),
  Phoneme.u: MouthParam(openValue: 0.30, formValue: -0.4),
  Phoneme.ai: MouthParam(openValue: 0.90, formValue: 0.7),
  Phoneme.ao: MouthParam(openValue: 0.85, formValue: 0.6),
  // ... 其余音素同基准表 ...
  Phoneme.silence: MouthParam(openValue: 0.0, formValue: 0.0),
};
```

#### 4.3.2 音素时间轴与音频播放时钟对齐

精确口型同步的时间基准必须以**音频播放器的输出时钟**为唯一事实源（SSOT），禁止使用 Dart `DateTime.now()` 或引擎墙钟——两者与音频输出存在不可控漂移。

**数据来源契约**：《客户端-AI语音对话实时交互与流式语音合成播放引擎》的 `VoiceOutputController` 在流式 TTS 播放时需透出逐词边界事件 `WordBoundaryEvent{word, startMs, durationMs}` 与播放时钟查询 `currentPositionMs`（若 TTS 供应商不支持逐词时间戳，事件流为空 → 触发降级 D3 回落振幅驱动模式，见 §8.3）。

```dart
/// 音素队列驱动的时钟对齐与漂移校正
mixin PhonemeClockAlignment on PreciseLipSyncDriver {
  /// 播放时钟（来自音频输出引擎，SSOT）
  AudioPlaybackClock get playbackClock;

  /// 播放开始时刻的锚点（首帧对齐用）
  int _anchorPositionMs = -1;

  /// 漂移重锚计数（超过阈值上报 COMP_007）
  int _driftReanchorCount = 0;

  static const int _maxDriftMs = 120;   // 允许漂移上限
  static const int _hardDriftMs = 200;  // 硬漂移阈值（触发重锚）

  /// 每帧计算嘴型：t = 播放时钟当前值
  MouthParam? tick() {
    final nowMs = playbackClock.currentPositionMs;

    if (_anchorPositionMs < 0) {
      _anchorPositionMs = nowMs; // 首帧锚定
    } else {
      // 漂移检测: 音素队列的预测推进与真实播放时钟比对
      final predicted = _predictQueuePositionMs();
      final drift = (nowMs - predicted).abs();
      if (drift > _hardDriftMs) {
        // 硬漂移: 以播放时钟为准重锚（音频永远胜出，G10/G12 相关）
        _reanchorTo(nowMs);
        if (++_driftReanchorCount > 3) {
          reportLipSyncDrift(driftMs: drift, reanchors: _driftReanchorCount);
        }
      } else if (drift > _maxDriftMs) {
        // 软漂移: 前向微调（每帧最多追 8ms，避免嘴型跳变）
        _nudgeQueueForward(nowMs - predicted > 0 ? 8 : -8);
      }
    }

    return getMouthAt(nowMs);
  }

  int _predictQueuePositionMs() {
    // 队列推进位置 = 上次 tick 的播放时钟 + 帧间隔累计（由子类维护）
    throw UnimplementedError();
  }
  void _reanchorTo(int nowMs) {/* 重置队列游标到 nowMs 对应音素 */}
  void _nudgeQueueForward(int deltaMs) {/* 游标微调 */}
  void reportLipSyncDrift({required int driftMs, required int reanchors}) {}
}
```

**双模式互斥（守卫 G1）**：同一时刻 `LipSyncEngine`（振幅驱动）与 `PreciseLipSyncDriver`（音素查表）只能有一个持有嘴型参数写权。切换规则：

| 场景 | 激活模式 | 切换时机 |
| --- | --- | --- |
| 常规 AI 对话回答 | 振幅驱动 | TTS 首帧音频到达 |
| 古诗朗读示范 / 发音陪练 / 课文点读 | 音素查表 | `WordBoundaryEvent` 首个事件到达且 quality ≥ medium |
| WordBoundary 流为空 / 拼音转换失败 | 振幅驱动 | 300ms 内未收到首事件自动回落（D3） |
| 用户语音打断（barge-in） | 均停用 | 立即闭嘴 + 清空音素队列（G12） |

#### 4.3.3 嘴型参数帧输出与结束收敛规则

1. **帧输出节流**：嘴型参数合帧后每 vsync 至多向原生层下发一次（§5.5 `ParameterBatcher`），禁止一帧多次 `updateLipSync` 调用。
2. **参数限幅**：openValue ∈ [0,1]、formValue ∈ [-1,1]，越界值截断并埋点（COMP_012 的前置校验）。
3. **静默收敛红线（G10）**：TTS 流结束事件（`onStreamCompleted`）或音频静默超过 180ms，必须在 200ms 内将 openValue 收敛到 0（闭嘴）并允许状态机回落 idle。
4. **打断收敛红线（G12）**：用户语音打断时同步执行：闭嘴（≤80ms 快速收敛）→ 清空 `_phonemeQueue` → 状态机转移 thinking。

---

### 4.4 动画混合器与调度器（AnimBlender / AnimScheduler）

动画系统采用**六层叠加混合模型**：底层为持久基础姿态，上层为瞬态表现，各层独立更新、按序混合，避免单一动画状态独占导致的“僵直感”。

```text
混合顺序（自底向上，后混合的层覆盖先混合的层）:

L0 BasePose      基础姿态（模型默认姿势，常驻）           [Override]
L1 IdleMotion    待机微动作（呼吸/摇拽晃动/视线微动）     [Additive]  循环
L2 Physics       物理模拟（头发/耳朵/尾巴/饰品摆动）      [Additive]  常驻
L3 EmotionMotion 情绪动画（happy/encouraging/celebrating…）[Override]  瞬态，自动回落
L4 Gesture       手势动画（指向/摊手/点头/摸头反应）        [Additive]  瞬态
L5 LipSync       嘴型参数（openY/form + 表情微调）         [Override]  仅参数级

规则:
- L3 Override 期间 L1/L2 仍然运行（背景层不冻结）
- L5 只写参数不播 motion，与 L3/L4 天然兼容
- 每层独立维护 fadeIn/fadeOut 权重，crossfade 交叉溶解
```

**优先级与打断矩阵**（数值大者可打断小者；同级仅同动画重触发刷新，不自我打断）：

| 动画类型 | priority | 可被谁打断 | 打断处理 |
| --- | --- | --- | --- |
| special（庆祝/睡眠进入） | 100 | 仅强制指令（资源卸载/页面销毁） | 不允许业务打断 |
| reaction（交互反应，摸头/戳） | 80 | special | 立即 fadeOut 120ms 溶出 |
| emotion（情绪表达） | 60 | special, reaction | crossfade 200ms |
| gesture（手势） | 40 | special, reaction, emotion | crossfade 150ms |
| talk（说话循环） | 30 | 同上 + TTS 结束 | fadeOut 后回落 idle |
| idle（待机呼吸） | 10 | 任意 | 永远可用作回落目标 |

```dart
/// 动画调度器：层叠混合 + 优先级打断 + crossfade
 class AnimScheduler {
  final Map<AnimationType, _ActiveClip> _activeByType = {};
  final List<AnimSlotListener> _listeners = [];

  /// 请求播放动画片段（守卫 G4/G5）
  void play(AnimationClip clip, {bool restartIfSame = true}) {
    // 1. 资源守卫: 模型未加载完成时拒绝播放（G2），回落静态形象
    if (!modelReady) {
      _reportBlocked(clip, reason: 'model_not_ready');
      return;
    }

    // 2. 优先级裁决: 遍历当前活跃片段，低优先级一律让位
    final evicted = <AnimationClip>[];
    for (final entry in _activeByType.entries) {
      final active = entry.value.clip;
      if (active.priority > clip.priority) {
        // 存在更高优先级活跃片段 → 本次请求按类型决定排队或丢弃
        if (clip.type == AnimationType.emotion && _queueLength < 2) {
          _enqueue(clip); // 情绪动画允许最多排 1 个（队列上限 2 含正在播放）
        } else {
          _reportBlocked(clip, reason: 'priority_preempted');
        }
        return;
      }
      if (active.priority < clip.priority ||
          (active.clipId == clip.clipId && restartIfSame)) {
        evicted.add(active);
      }
    }

    // 3. 被打断片段执行快速溶出，新片段 fadeIn 进入
    for (final e in evicted) {
      _fadeOut(e, durationMs: e.fadeOutMs.clamp(80, 200));
    }
    _fadeIn(clip);
  }

  /// 原生层 motionFinished 回调入口（EventChannel，见 §5.3）
  void onMotionFinished(String clipId) {
    final slot = _findByClipId(clipId);
    if (slot == null) return;
    if (!slot.clip.isLooping) {
      _activeByType.remove(slot.clip.type);
      _notifyLayerChanged(slot.clip.type); // 触发状态机回落判定
    }
  }

  int get _queueLength => _emotionQueue.length;
  void _fadeIn(AnimationClip clip) {/* 注册槽位并通知原生层 playMotion(fadeIn) */}
  void _fadeOut(AnimationClip clip, {required int durationMs}) {/* 通知原生层 stopMotion(fadeOut) */}
  void _enqueue(AnimationClip clip) {/* 情绪队列尾部入队，溢出丢弃最低优先级并埋点 */}
  // ...
}
```

**队列与回落规则**：

1. 情绪动画队列上限 2（含正在播放的 1 个），溢出时丢弃队尾最低优先级并埋点 `companion_anim_queue_drop`。
2. 非循环 motion 的 `motionFinished` 回调后，若该层无排队片段，层权重归零，状态机按 §4.1 规则自动回归 idle（守卫 G11：`Future.delayed` 回调必须校验状态未被更高优先级打断）。
3. 循环动画（idle/talk/sleeping 循环段）只能被更高优先级打断或显式 `stopMotion`，不参与自动回落。

---

### 4.5 交互响应器（InteractionHandler）

**命中区域定义**（随角色资源包内置，Live2D 命中组 `HitAreas`）：

| 区域 ID | 名称 | 默认反应动画 | 音效 | 触觉 |
| --- | --- | --- | --- | --- |
| head | 头部 | 摸头：眯眼享受 + 摇尾 | 咕噜声 | lightImpact |
| body | 身体 | 戳一下：惊讶后仰 | 哎呀 | selection |
| ear | 耳朵 | 耳朵抖动 + 歪头 | 噗 | none |
| tail | 尾巴 | 尾巴甩动 + 回头看 | 咻 | none |
| anywhere（未命中上述） | 兜底 | 挥手致意 | - | none |

**手势类型矩阵**：

| 手势 | 判定条件 | 触发 | 备注 |
| --- | --- | --- | --- |
| 单击 | tap ≤ 200ms 无移动 | 命中区域反应动画 | 冷却见下公式 |
| 双击 | 300ms 内两次 tap | 惊喜跳（reaction） | 与单击互斥，双击胜出 |
| 长按 | press ≥ 600ms | 睡意渐起（闭眼） | 松手后 1.5s 内回弹 |
| 拖拽 | 移动 > 18px | 物理摆动跟随（L2 物理） | 松手回弹，不播专门动画 |
| 快速划过 | 滑动速度 > 800px/s | 躲闪/痒笑 | 仅 head/body 区域 |

**互动冷却公式**（消费 `CompanionUserPreference.interactionSensitivity`）：

```text
cooldownMs = 3000 / max(interactionSensitivity, 0.1)

interactionSensitivity:  0.0（关闭互动） / 0.2（低频，15s） / 0.5（默认，6s） / 1.0（频繁，3s）
冷却期内命中仅更新埋点 hit_ignored，不触发动画/音效/触觉
```

```dart
/// 交互响应器：命中检测 + 手势分发 + 冷却控制
class InteractionHandler {
  final AnimScheduler _scheduler;
  final CompanionUserPreference _prefs;
  final HapticService _haptic;
  final SoundEffectPlayer _sfx;

  DateTime _lastReactionAt = DateTime.fromMillisecondsSinceEpoch(0);
  Offset? _dragOrigin;

  /// 原生层命中检测结果回调（§5.2 hitTest）
  void onPointerDown(Offset localPos, double viewScale) {
    if (_prefs.interactionSensitivity <= 0.0) return; // 互动已关闭
    final region = nativeBridge.hitTest(localPos.dx, localPos.dy);
    _trackHit(region);

    final now = DateTime.now();
    final cooldown = Duration(
      milliseconds: (3000 / _prefs.interactionSensitivity.clamp(0.1, 1.0)).round(),
    );
    if (now.difference(_lastReactionAt) < cooldown) return; // 冷却期内忽略

    final reaction = _reactionFor(region);
    if (reaction == null) return;

    _lastReactionAt = now;
    _scheduler.play(reaction.clip);            // priority 80 (reaction 层)
    if (reaction.soundPath != null && _prefs.soundEffectsEnabled) {
      _sfx.play(reaction.soundPath!, volume: 0.6);
    }
    if (_prefs.hapticEnabled && reaction.haptic != HapticKind.none) {
      _haptic.fire(reaction.haptic);
    }
  }

  /// 拖拽 → 注入物理冲量（不播动画，仅物理层响应，G5 例外说明）
  void onDragUpdate(Offset delta) {
    nativeBridge.applyImpulse(dx: delta.dx * 0.12, dy: delta.dy * 0.12);
  }

  void onDragEnd() => nativeBridge.releaseImpulse(); // 松手回弹
}
```

**红线**：交互反应动画优先级固定为 reaction(80)，**不得**升到 special(100)——避免高频互动打断庆祝/睡眠等重要叙事动画（未成年人场景中庆祝动画被交互打断会削弱成就感知）。

---

### 4.6 LOD 策略器（LodManager）

#### 4.6.1 设备分级

| 分级 | 判定标准（启动时一次性评估） | 目标画质 | 帧率目标 |
| --- | --- | --- | --- |
| Tier A（高端） | 内存 ≥ 8GB 且 GPU benchmark 得分前 30% | high | 60fps |
| Tier B（中端） | 内存 ≥ 6GB 或得分中间 40% | medium | 30~60fps |
| Tier C（低端） | 其余设备 | low | 30fps |

> 设备分级结果缓存本地，仅在系统升级（OS 版本变化）后重测；`AnimationQuality.auto` 时以分级结果为初始档，用户显式设置的画质优先于 auto。

#### 4.6.2 画质 × 特性矩阵

| 特性 | low | medium | high |
| --- | --- | --- | --- |
| 渲染帧率上限 | 30fps | 30fps | 60fps |
| 渲染分辨率（相对设计稿） | 0.5× | 0.75× | 1.0× |
| 粒子特效 | 关闭 | 简化（≤ 8 粒子/Emitter） | 全开 |
| 物理模拟（L2） | 关闭（静态绑定姿态） | 30Hz 步进 | 60Hz 步进 |
| 眼球追踪 | 关闭 | 开启 | 开启 |
| 呼吸/微动作（L1） | 保留（低频 0.5Hz） | 开启 | 开启 |
| 口型模式 | 仅振幅 | 振幅/音素均可 | 振幅/音素均可 |
| 阴影/后处理 | 关闭 | 基础 | 全开 |

#### 4.6.3 动态降档与升档

```dart
/// 动态档位调节：帧率监测 + 系统资源压力联动
class LodManager {
  AnimationQuality _current;
  DateTime _lastDowngradeAt = DateTime.fromMillisecondsSinceEpoch(0);
  static const _downgradeWindow = Duration(seconds: 5);
  static const _upgradeCooldown = Duration(minutes: 10);

  /// 由渲染统计回调驱动（EventChannel renderStats，每 1s 一帧汇总）
  void onRenderStats(RenderStats stats) {
    // 降档: 连续 5s 帧率低于 24fps（守卫 G13 特性裁剪顺序红线）
    if (stats.fps < 24 && stats.lowFpsDuration >= _downgradeWindow) {
      downgrade(reason: 'fps_low(${stats.fps})');
    }
    // 升档: 帧率充裕（≥ 目标帧率-2）持续 10min 冷却后，且不在省电模式
    if (stats.fps >= _targetFps - 2 &&
        DateTime.now().difference(_lastDowngradeAt) >= _upgradeCooldown &&
        !powerSaverActive) {
      upgrade(reason: 'headroom');
    }
  }

  /// 订阅《客户端-系统资源压力感知与智能降级调度引擎》全局压力等级
  void onSystemPressure(PressureLevel level) {
    switch (level) {
      case PressureLevel.green: break;
      case PressureLevel.orange: downgrade(reason: 'system_orange');   // 降一档
      case PressureLevel.red:
        suspendEngine(reason: 'system_red');  // D10: 仅保留静态头像气泡
    }
  }

  void downgrade({required String reason}) {
    if (_current == AnimationQuality.low) return;
    _current = _current.previous;
    _lastDowngradeAt = DateTime.now();
    nativeBridge.setRenderQuality(_current);
    trackLodChange(to: _current, reason: reason);
  }
}
```

**特性裁剪顺序红线（G13）**：帧预算超支时按 `粒子 → 后处理 → 物理步进降频 → 渲染分辨率` 顺序逐级裁剪，禁止先降分辨率（会导致整体模糊感，用户感知最强）。

#### 4.6.4 内存预算

| 预算项 | 上限 | 超限处理 |
| --- | --- | --- |
| 活跃角色贴图（GPU 显存） | 24MB | 换用 0.75× 纹理 |
| 骨骼/动画数据 | 8MB | 裁剪非活跃动画 |
| 物理配置与状态 | 2MB | 关闭物理 |
| 音效缓冲 | 4MB | LRU 淘汰音效 |
| **引擎总预算** | **50MB**（§1.4 目标） | 卸载非活跃角色（G8/D5） |

---

### 4.7 资源管理器（CompanionAssetManager）

#### 4.7.1 角色资源包生命周期状态机

```text
not_installed ──download_requested──► downloading ──verify_ok──► installing ──install_ok──► installed
      ▲                                   │                                            ││
      │                            verify_failed                              outdated││corrupted
      │                                   ▼                                    (新版可用)││(校验失败)
      └────────── re-download ◄────── verify_failed                            │        ▼
      │                                                                              ▼        re-download
      └────────────────── evicted(LRU 淘汰) ◄── installed(unused, 超配额) ◄───────┘

规则:
- downloading/installing 状态下禁止删除与升级请求（CAS 守卫 G6）
- installed 且非活跃角色才可被 LRU 淘汰（active_companion_id 永不淘汰）
- corrupted 包必须整体重下，不做增量修复
```

#### 4.7.2 与《客户端资源包下载管理器》的契约

| 职责 | 归属 |
| --- | --- |
| 下载调度/断点续传/网络策略（蜂窝管控） | 资源包下载管理器（包类型 `companion_preset`） |
| SHA-256 完整性校验 | 资源包下载管理器（下载完成时） |
| **安装装载**（解压/原子替换/manifest 写入） | 本引擎 §4.7.3 |
| **LRU 淘汰与配额管理** | 本引擎 §4.7.4 |
| 版本检测与升级触发 | 本引擎（元数据比对）→ 委托下载管理器 |

#### 4.7.3 安装管线（原子安装）

```dart
/// 资源包安装：解压到临时目录 → 校验结构 → 原子 rename → 写 manifest
Future<InstallResult> installBundle(String companionId, String downloadedZipPath) async {
  final staging = await _stagingDir(companionId); // …/.staging/{companionId}
  try {
    // 1. 解压到临时目录（zip slip 防护: 条目路径必须落在 staging 内）
    await SafeUnzip.extract(downloadedZipPath, staging,
        onEntry: (entry) => _assertInside(staging, entry));

    // 2. 结构校验: moc3 + 纹理 + 必需 motion(idle/talk) + phonemeMapping 齐全
    final manifest = CompanionManifest.parseFrom(staging);
    final missing = manifest.validateRequired(
        requiredMotions: ['idle', 'talk'], requiredParams: ['ParamMouthOpenY', 'ParamMouthForm']);
    if (missing.isNotEmpty) {
      return InstallResult.corrupt(reason: 'missing:${missing.join(",")}'); // COMP_002
    }

    // 3. 原子安装: 目标目录不存在 → rename；存在 → 先 rename 旧目录为 .trash 再落位
    final target = await _installedDir(companionId);
    final trash = '${target.path}.trash';
    if (await target.exists()) await target.rename(trash);
    await staging.rename(target.path);
    await _purge(trash); // 异步清理旧版（延迟 30s，防热切换闪烁，见 §4.7.5）

    // 4. 写入本地 manifest（版本/安装时间/文件清单哈希）
    await _manifestStore.upsert(companionId, manifest);
    return InstallResult.ok;
  } catch (e) {
    await _purge(staging);
    return InstallResult.corrupt(reason: e.toString());
  }
}
```

#### 4.7.4 LRU 淘汰与存储配额

1. 已安装角色包配额默认 **3 个**（用户可在设置页调整 1~5，幼儿段固定 2 并由家长中心管理）。
2. 超配额时淘汰最久未使用且非当前活跃的角色包（依据 `CompanionUsageStats.lastUsedAt`）。
3. 淘汰只删安装目录与 manifest，**不删**用户对该角色的解锁状态与使用统计（云端权威）。
4. 被淘汰角色再次选用时自动触发重新下载流程，期间使用占位静态形象（D9）。

#### 4.7.5 首屏 500ms 加载管线与版本热切换

| 阶段 | 动作 | 预算 |
| --- | --- | --- |
| 冷启动预热 | 登录成功后后台预载活跃角色（纹理异步上传 GPU） | 不阻塞 UI |
| 页面进入 | 已预热 → 直接绑定纹理；未预热 → 显示静态 PNG 占位 + 骨架光晕 | 首帧 ≤ 500ms（预热命中）/ ≤ 1500ms（未命中） |
| 版本热切换 | 新版本安装后不立即重载，等当前动画回落 idle 后切换，旧纹理延迟 30s 卸载 | 无闪烁 |

---

## 5. Platform Channel 桥接层设计

### 5.1 通道总览

| 通道 | 类型 | 方向 | 职责 |
| --- | --- | --- | --- |
| `companion/render` | MethodChannel | Dart → Native | 模型装载/纹理管理/渲染参数/快照 |
| `companion/control` | MethodChannel | Dart → Native | 语义指令（动画/表情/物理/暂停） |
| `companion/events` | EventChannel | Native → Dart | motionFinished/hitTest/渲染统计/异常事件 |

### 5.2 `companion/render` 接口表

| 方法 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `loadModel` | companionId, modelDir, textures[], physics?, pose? | textureId | 装载模型并注册外接纹理，失败返回错误码 |
| `unloadModel` | textureId | bool | 卸载模型与纹理（账号切换/淘汰时调用） |
| `setRenderQuality` | tier(low/medium/high), scale | bool | LOD 档位下发 |
| `updateLipSync` | mouthOpen, mouthForm | void | 嘴型参数（合帧后 ≤ 1 次/vsync，见 §5.5） |
| `hitTest` | x, y（视图坐标） | region(head/body/ear/tail/none) | 命中检测（同步返回） |
| `applyImpulse` / `releaseImpulse` | dx, dy | void | 拖拽物理冲量注入/释放 |
| `snapshot` | width, height, transparent | filePath | 离屏渲染导出 PNG（§6.4） |
| `onLowMemory` | - | void | 系统低内存通知转发（卸载非活跃纹理） |

### 5.3 `companion/control` 接口表

| 方法 | 参数 | 说明 |
| --- | --- | --- |
| `playMotion` | clipId, fadeInMs, fadeOutMs, loop, priority | 播放动画（§4.4 调度器裁决后下发） |
| `stopMotion` | clipId, fadeOutMs | 停止动画溶出 |
| `setExpression` | expId, weight | 设置表情（与 motion 正交叠加） |
| `setPhysicsEnabled` | enabled | 物理开关（LOD 联动） |
| `setEyeTrackTarget` | x, y | 眼球追踪目标（跟随用户触点/学习卡片焦点） |
| `pause` / `resume` | reason | 渲染循环暂停/恢复（§5.6） |

### 5.3.1 `companion/events` 事件表

| 事件 | payload | 消费方 |
| --- | --- | --- |
| `modelLoaded` | textureId, loadCostMs | 资源管理器（首屏埋点） |
| `modelLoadFailed` | errorCode, detail | 降级链（D1）入口 |
| `motionFinished` | clipId | AnimScheduler（§4.4 回落判定） |
| `hitRegion` | region, x, y | InteractionHandler（异步命中兜底） |
| `renderStats` | fps, drawCalls, gpuMemMB, lowFpsDurationMs | LodManager（每 1s 汇总一帧） |
| `renderThreadCrashed` | lastClipId, stackDigest | 引擎自愈（重装载载纹理，D1） |

### 5.4 外接纹理嵌入模式

```text
Flutter 侧                        原生侧
┌──────────────────┐   textureId  ┌──────────────────────────────┐
│ Texture(textureId)│◄───────────►│ Live2D 渲染到独立 GL/Metal 纹理 │
│ 嵌入 Widget 树    │  每帧合成    │ (FBO / MTLTexture 离屏目标)      │
└──────────────────┘             └──────────────────────────────┘

选择 Texture 模式而非 PlatformView 的原因:
- PlatformView 在 Android 上有合成层叠开销与裁剪 bug，低端机掉帧明显
- Texture 模式由原生自驱动渲染（vsync 回调在原生侧），Dart 不参与每帧调用
- 命中检测用 hitTest 方法回传区域，无需真实视图层级
```

### 5.5 帧驱动与线程模型

**核心原则：原生侧 vsync 自驱动渲染，Dart 只发语义指令与合帧参数。** Dart 侧任何 MethodChannel 调用都不在渲染关键路径上。

```dart
/// 参数合帧器：多个参数源（嘴型/表情/眼球）合并后每 vsync 至多下发一次
class ParameterBatcher {
  final Map<String, double> _pending = {};
  bool _flushScheduled = false;

  void set(String key, double value) {
    _pending[key] = value;
    _scheduleFlush();
  }

  void _scheduleFlush() {
    if (_flushScheduled) return;
    _flushScheduled = true;
    SchedulerBinding.instance.addPostFrameCallback((_) {
      _flushScheduled = false;
      if (_pending.isEmpty) return;
      // 单次 invokeMethod 携带全部脏参数（对应 §4.3 的 updateLipSync 调用点收敛）
      nativeBatch.updateParams(Map.of(_pending));
      _pending.clear();
    });
  }
}
```

线程模型：

1. **原生渲染线程**：Live2D 更新（Update）+ 绘制（Draw）+ 物理步进，串行执行。
2. **Dart UI 线程**：状态机/调度器/交互逻辑，仅通过 channel 与渲染线程通信。
3. **纹理合成**：由 Flutter 合成器完成，不占用 Dart 线程。
4. 渲染线程崩溃时（`renderThreadCrashed`），原生侧自动重建 GL 上下文并重载当前模型，Dart 侧仅收到事件用于埋点，不中断用户界面（静态形象兜底，D1）。

### 5.6 生命周期同步

| 系统事件 | 引擎动作 | 恢复条件 |
| --- | --- | --- |
| App 进入后台 | `pause(reason: background)`，≤1s 内释放 GL 资源（iOS didEnterBackground 红线） | 回前台自动 `resume` + 纹理重建 |
| 页面不可见（路由遮挡） | 暂停渲染循环，保留纹理 60s；60s 后卸载纹理仅留静态图 | 60s 内返回 → 无缝恢复 |
| iOS memoryWarning / Android onTrimMemory | 卸载**非活跃**角色纹理与音效缓冲（活跃角色降一档，G8/D5） | 压力解除后按 LOD 重建 |
| 账号切换/退出登录 | 立即 `unloadModel` + 清理 LRU 缓存目录（G8，共用设备隐私） | 新账号重新预载 |
| 省电模式开启 | 冻结在 low 档，禁止升档 | 省电模式关闭 |

---

## 6. 页面集成与组件 API

### 6.1 CompanionAvatarWidget

对上层（AI 对话页/定制页预览/激励弹窗）统一暴露的渲染组件，是《客户端-AI学习伙伴角色定制与互动设置页面架构与交互设计》§15 契约中约定的头像/动画渲染提供方：

```dart
/// 伙伴形象统一渲染组件
class CompanionAvatarWidget extends StatefulWidget {
  /// 渲染模式
  final CompanionRenderMode mode;

  /// 渲染尺寸（默认 medium = 屏高 30%）
  final CompanionSize size;

  /// 是否启用触摸交互（AI 对话页 true / 定制页预览 true / 激励弹窗 false）
  final bool interactive;

  /// 情感状态外部驱动入口（由 EmotionDriver 桥接）
  final Stream<EmotionState>? emotionStream;

  /// TTS 音频流（激活口型同步；null 则仅动画）
  final TtsAudioStreamController? ttsStream;

  /// 快照就绪回调（学习报告卡片消费，§6.4）
  final void Function(String pngPath)? onSnapshotReady;

  const CompanionAvatarWidget({
    required this.mode,
    this.size = CompanionSize.medium,
    this.interactive = true,
    this.emotionStream,
    this.ttsStream,
    this.onSnapshotReady,
    super.key,
  });

  @override
  State<CompanionAvatarWidget> createState() => _CompanionAvatarState();
}

enum CompanionRenderMode {
  /// 完整模式: 动画 + 口型 + 交互 + 物理
  full,
  /// 预览模式: 定制页底部预览条（动画 + 口型，无交互拖拽）
  preview,
  /// 静态模式: 单帧表情图（消息气泡旁的小头像，30×30）
  mini,
  /// 静态 PNG 占位（加载中/降级中）
  placeholder,
}
```

组件内部持有引擎单例 `CompanionEngine.instance`（模型/纹理全局唯一，多页面共享同一 textureId，避免重复装载）。页面销毁仅解绑监听，不卸载模型（卸载统一由资源管理器生命周期管理）。

### 6.2 场景消费矩阵

| 场景 | 模式 | 位置 | 情感驱动源 | 口型 |
| --- | --- | --- | --- | --- |
| AI 对话页 | full | 底部固定区（不遮挡输入框） | AI 消息流 + 答题事件 | 开启 |
| 首页问候卡 | preview | 卡片右侧 | 启动 greeting → idle | 关闭（无 TTS） |
| 学习激励弹窗 | preview | 弹窗内嵌 | 激励事件总线（celebrating） | 关闭 |
| 定制页预览条 | preview | 底部 | 预览 SSE 流（talking） | 开启 |
| 番茄钟专注页 | full(降交互) | 右下角 | focused / 提醒 surprised | 关闭 |
| 消息气泡头像 | mini | 气泡左上 | 随消息情感快照 | 关闭 |

### 6.3 全局呈现与浮窗互斥

1. 伙伴形象**不进入**全局浮窗体系：《客户端-全局浮窗AI助手与跨页面学习辅助》的浮窗为轻量问答入口，与伙伴形象同屏会双主体竞争注意力并叠加两层渲染成本。
2. 互斥规则：全局浮窗激活（展开/拖拽中）时，当前页面的伙伴形象自动折叠为 mini 模式；浮窗收起后 800ms 恢复。
3. 伙伴形象仅出现在 §6.2 列举的页面位置，禁止全屏漂浮（与产品「学习优先，减少干扰」原则冲突）。

### 6.4 快照导出（供社交分享消费）

1. 快照通过 `snapshot(width, height, transparent)` 离屏渲染导出 PNG（默认 512×512 透明底），**不走系统截屏**（G14：避免截入用户其他页面内容与防截屏管控冲突）。
2. 快照内容为当前角色形象 + 可选表情，**不含**任何用户数据（昵称/成绩由消费方在卡片层叠加，脱敏责任归《客户端-学习报告卡片生成与社交分享图片渲染引擎》）。
3. 快照缓存 24h，同一角色+表情组合去重；失败时返回预置静态形象图（D9）。
4. 消费方：学习报告分享卡片（形象立绘位）、成长档案封面、邀请裂变海报。

---

## 7. 状态机守卫与并发控制

| 编号 | 守卫规则 | 违反后果/裁决 |
| --- | --- | --- |
| G1 | 嘴型参数单写者：LipSyncEngine 与 PreciseLipSyncDriver 二选一持写权 | 双写检测到即丢弃后写者参数并埋点，300ms 内未收敛强制双停用 |
| G2 | 模型未 loaded 禁止 playMotion/setExpression | 请求丢弃 + 埋点 model_not_ready，静态形象兜底 |
| G3 | 状态机非法转移必须经 idle 中转（300ms） | 直连转移被拦截，走 idle 缓冲（§4.1 已实现，固化守卫） |
| G4 | 动画打断必须遵循优先级矩阵，低不可打断高 | 低优先级请求排队（emotion 限 1 个）或丢弃 + 埋点 |
| G5 | 同一时刻每层仅一个活跃片段；交互反应固定 reaction(80) 不得升 special | 升级请求在代码层拒绝（const 断言） |
| G6 | downloading/installing 包禁止删除/升级/淘汰（CAS：状态比对后动作） | 请求延迟到状态回调后重试，冲突时后到者胜并埋点 |
| G7 | 页面不可见/后台时暂停渲染循环与音频分析 | 不可见 ≥ 60s 卸载纹理；恢复后无缝重建 |
| G8 | 账号切换/退出登录必须卸载模型 + 清理缓存目录 | 未清理属 P1 缺陷（共用设备隐私），启动时二次兜底清理 |
| G9 | 引擎对偏好只读：写入归定制页 Provider，同步冲突以服务端为准 | 引擎检测到本地偏好被同步覆盖时热应用新值（不重启页面） |
| G10 | TTS 流结束/静默 > 180ms 必须 200ms 内闭嘴并回落 idle | 超时强制闭嘴参数注入 + 埋点 mouth_stuck |
| G11 | 自动回归 idle 的延迟回调必须校验当前状态未被更高优先级打断 | 已被抢占则放弃回归（§4.1 value==target 检查固化） |
| G12 | 用户语音打断（barge-in）立即清空音素队列 + ≤80ms 闭嘴 + 转 thinking | 迟到音频帧到达时队列已空，自然忽略 |
| G13 | 帧预算超支按 粒子→后处理→物理降频→分辨率 顺序裁剪 | 跳序裁剪属实现缺陷，code review 检查项 |
| G14 | 快照只走离屏渲染，禁止系统截屏 API | 违反则可能截入无关内容/触发防截屏黑屏，验收项 |

---

## 8. 错误处理与降级

### 8.1 本地错误码（仅埋点，不弹窗）

| 错误码 | 场景 | 处理 |
| --- | --- | --- |
| COMP_001 | Live2D SDK 初始化失败 | 进入 D1 降级链 |
| COMP_002 | 模型文件缺失/结构校验失败 | 标记 corrupted → 重下 |
| COMP_003 | 纹理解码失败 | 跳过该纹理 + 降渲染分辨率 |
| COMP_004 | motion 文件缺失 | 跳过该动画回落 idle（D8） |
| COMP_005 | 表情/参数 ID 校验失败 | 资源包内置映射失效 → 兑底表 |
| COMP_006 | 物理配置无效 | 关闭物理 |
| COMP_007 | 音素时钟漂移重锚 > 3 次/句 | 记录 driftMs，灰度采样上报 |
| COMP_008 | 安装校验失败 | 保留旧版本（D2）+ 重下 |
| COMP_009 | channel invoke 超时（> 500ms） | 重试 1 次 → 降级静态 |
| COMP_010 | 快照导出失败 | 预置静态形象（D9） |
| COMP_011 | 帧预算持续超支（> 30s） | 强制降档 + 上报设备画像 |
| COMP_012 | 参数越界/textureId 失效 | 截断/重建纹理 |

### 8.2 渲染四级降级链（D1）

| 级别 | 渲染方案 | 触发 | 能力 |
| --- | --- | --- | --- |
| L1 | Live2D（主方案） | 正常 | 全部能力 |
| L2 | Spine Runtime（备选） | Live2D SDK init/装载失败 ×2 次 | 骨骼动画 + 振幅口型；无物理/眼球追踪 |
| L3 | Lottie 循环动效 | Spine 资源亦缺失 | 预录循环动画（待机/说话/开心 3 态）；无交互命中 |
| L4 | 静态 PNG 分层帧 | 全部失败/系统压力红区 | 按情感切换静态图（≥ 2Hz 切换不闪烁）；仅此一级可被 D10 触发 |

降级链单向下行，会话内不自动升级；下次冷启动重新从 L1 尝试。降级发生时全部埋点并附带失败原因。

### 8.3 降级矩阵 D1-D10

| 编号 | 场景 | 降级行为 | 用户感知 |
| --- | --- | --- | --- |
| D1 | 渲染 SDK/模型失败 | 四级降级链（§8.2） | 形象表现力下降，功能不中断 |
| D2 | 资源包下载/安装失败 | 保留旧版本继续使用；无旧版则静态形象 | 轻提示“新形象下载失败，稍后重试” |
| D3 | WordBoundary 缺失/拼音转换失败 | 音素模式 → 振幅模式 | 无感知（口型精度略降） |
| D4 | 低端机/帧率不足 | LOD 降档（G13 顺序） | 特效减少，无卡顿 |
| D5 | 系统内存告警 | 卸载非活跃角色纹理 + 活跃降档 | 极端情况静态图 |
| D6 | 音频流中断/播放器异常 | 闭嘴 + 回落 idle + 状态机复位 | 伙伴安静，下次播放恢复 |
| D7 | 偏好读取/同步失败 | 本地默认偏好渲染，后台重试 | 无感知 |
| D8 | 单个动画资源缺失 | 跳过该动画回落 idle + 埋点 | 该场景动作减少 |
| D9 | 快照导出失败 | 预置静态形象图 | 分享卡片用默认图 |
| D10 | 系统资源压力红区 | 引擎完全暂停，仅保留 mini 静态头像（气泡旁） | 学习功能不受影响 |

---

## 9. 埋点与性能监控

### 9.1 事件清单（module=companion，对齐《客户端埋点事件体系与数据采集规范》模块注册）

| 事件名 | 触发时机 | 关键属性 |
| --- | --- | --- |
| companion_face_first_frame | 模型首帧渲染完成 | loadCostMs, preheated(bool), tier |
| companion_face_fallback | 渲染降级链切换 | fromLevel, toLevel, errorCode |
| companion_anim_play | 动画片段开始播放 | clipId, type, priority, source(event/interaction) |
| companion_anim_preempted | 动画被更高优先级打断 | clipId, byClipId, playedMs |
| companion_anim_queue_drop | 队列溢出丢弃 | clipId, queueLen |
| companion_anim_motion_missing | D8 触发 | clipId, companionId |
| companion_lipsync_mode_switch | 口型模式切换 | from(amplitude/phoneme), to, reason |
| companion_lipsync_drift | 漂移重锚 > 3 次 | driftMs, reanchors（灰度 1% 采样） |
| companion_interaction_hit | 命中区域点击 | region, inCooldown(bool) |
| companion_interaction_drag | 拖拽物理触发 | durationMs, distancePx |
| companion_asset_download_request | 请求下载角色包 | companionId, sizeBytes, version |
| companion_asset_install_result | 安装结果 | companionId, result(ok/corrupt), costMs |
| companion_asset_evicted | LRU 淘汰 | companionId, idleDays |
| companion_lod_change | 档位变化 | from, to, reason(fps_low/system_orange/upgrade) |
| companion_snapshot_result | 快照导出结果 | success, costMs, cacheHit |
| companion_engine_suspend | D10/后台暂停 | reason, resumeLatencyMs（恢复时补发） |

### 9.2 指标与告警阈值

| 指标 | 口径 | 目标/阈值 |
| --- | --- | --- |
| M1 首屏渲染耗时 | first_frame.loadCostMs P90（预热命中样本） | ≤ 500ms；P90 > 800ms 告警 |
| M2 渲染帧率达标率 | renderStats 中 fps ≥ 24 的样本占比 | ≥ 95%；< 90% 按机型分组告警 |
| M3 口型同步误差 | 漂移采样 P90（灰度） | ≤ 80ms；> 120ms 告警 |
| M4 渲染降级率 | fallback 事件/L1 会话占比 | ≤ 5%；Tier C 机型单独基线 ≤ 15% |
| M5 内存超预算率 | gpuMemMB > 50MB 样本占比 | ≤ 1%；> 3% P2 告警 |
| M6 互动响应及时率 | hit → 动画播报 < 100ms 占比 | ≥ 99% |
| M7 引擎崩溃率 | renderThreadCrashed/会话 | ≤ 0.05%；> 0.2% P1 告警 |
| M8 快照成功率 | snapshot_result.success 占比 | ≥ 99% |

---

## 10. 合规红线

| 编号 | 红线 |
| --- | --- |
| C1 | 角色形象不得出现在任何诱导消费弹窗/付费强提示中（商业化与形象叙事隔离，对齐总体设计 11.4） |
| C2 | 幼儿段角色语音（角色专属音效/语声）默认受家长中心开关管控，家长未开启则仅动画无声音 |
| C3 | 快照导出内容仅角色形象本身，不含用户昵称/成绩/头像等个人信息（脱敏责任链见 §6.4） |
| C4 | 角色资源版权合规：Live2D Cubism SDK 商用授权、角色美术素材需在《第三方SDK与开源依赖治理体系》登记授权凭证 |
| C5 | 账号切换/退出必须清理本地角色资源与缓存（G8），防止共用设备家庭成员间形象与解锁状态串显 |
| C6 | encouraging/celebrating 等情感动画配套话术与《学情诊断报告成长型话术红线》一致：鼓励动作不得搭配否定式文案 |
| C7 | sleeping 状态仅用于空闲超时提示，不得作为“熬夜陪伴/再学一会”的挽留暗示（不绕过防沉迷，对齐 C4 主动提醒约束） |
| C8 | 付费/限定角色在定制页展示时必须明示解锁条件，禁止“限时即将失去”类焦虑式倒计时动画 |

---

## 11. 契约对齐

| # | 对齐项 | 裁决 |
| --- | --- | --- |
| 1 | 与《客户端-AI学习伙伴角色定制与互动设置页面架构与交互设计》 | 本引擎提供 `CompanionAvatarWidget`（§6.1）供定制页预览条复用；偏好读写归定制页 Provider，引擎只读（G9）；解锁状态展示归定制页，引擎不做解锁判定 |
| 2 | 与《客户端-AI语音对话实时交互与流式语音合成播放引擎》 | TTS 音频流、振幅/主频、`WordBoundaryEvent`、播放时钟 `currentPositionMs`、barge-in 打断信号均由语音引擎提供，本引擎消费；WordBoundary 事件列为语音引擎 v1.1 扩展需求 |
| 3 | 与《服务端-学生个性化虚拟形象系统与装扮解锁引擎》 | 装扮/解锁/过期服务端权威（40001-40060）；本引擎不实现解锁逻辑，仅按服务端下发的外观配置渲染；服务端 40050 渲染失败时其快照 PNG 作为本引擎 D9 兑底素材 |
| 4 | 与《客户端资源包下载管理器》 | 下载/断点续传/SHA-256 校验归下载管理器（包类型 companion_preset）；本引擎负责安装装载/LRU/淘汰（§4.7 边界表） |
| 5 | 与《客户端-系统资源压力感知与智能降级调度引擎》 | 本引擎为全局压力等级订阅者（绿/橙/红 → §4.6.3 联动），不自行探测系统级压力 |
| 6 | 与《端到端流程设计-学生AI学习伙伴全生命周期互动与成长进化完整链路》 | 全生命周期时序以 E2E 文档为准；本引擎负责其中形象渲染段落（创建时的首次亮相动画/进化升级的进阶特效/里程碑庆祝） |
| 7 | 与《客户端-学习报告卡片生成与社交分享图片渲染引擎》 | 分享卡片形象立绘位由本引擎快照提供（§6.4）；卡片排版/脱敏/水印责任归卡片引擎 |
| 8 | 与《客户端-AI对话页面交互与组件架构》 | 对话页伙伴形象区由本 Widget 提供；对话气泡/输入框布局归对话页；伙伴区高度变化不得挤压消息列表可视区 |
| 9 | 与《客户端-全局浮窗AI助手与跨页面学习辅助》 | 浮窗激活时伙伴形象折叠 mini（§6.3 互斥规则）；两者不得同屏全形态渲染 |
| 10 | 与《客户端埋点事件体系与数据采集规范》 | companion 模块事件已注册（§9.1），companion_face 为渲染域、companion_anim 为动画域、companion_asset 为资源域子前缀 |
| 11 | 与《防沉迷与未成年人保护机制》 | 引擎暂停/恢复不作为防沉迷时长计量边界；夜间 22:00 后 sleeping 状态展示需同时呈现休息引导（不反向鼓励使用） |
| 12 | 与《客户端-主题引擎与动态外观系统》 | 角色形象不随 App 主题换色（美术资产固定配色）；仅舞台光晕/背景氛围层跟随主题 |

---

## 12. 验收场景

1. **首屏预热命中**：杀进程冷启动 → 登录后进入 AI 对话页，角色首帧 ≤ 500ms，`companion_face_first_frame.preheated=true`。
2. **首屏未预热**：清除缓存后进入，静态 PNG 占位即时显示，模型就绪后无缝切换（≤ 1500ms），无白屏闪烁。
3. **四级降级链**：模拟 Live2D 装载失败 → 自动落到 Spine；再模拟 Spine 缺失 → Lottie 循环动效；全部失败 → 静态分层帧，各层级埋点 `fallback` 逐级上报。
4. **振幅→音素模式切换**：常规对话走振幅模式；发起古诗朗读示范且收到 WordBoundary 首事件 → 切音素模式，`lipsync_mode_switch` 上报。
5. **WordBoundary 缺失降级**：TTS 供应商不返回词边界 → 300ms 后自动回落振幅模式（D3），无错误弹窗。
6. **打断收敛**：TTS 播放中用户语音打断 → ≤ 80ms 闭嘴、音素队列清空、状态转 thinking（G10/G12）。
7. **时钟漂移重锚**：注入 + 250ms 漂移的音频流 → 队列硬重锚，3 次以上触发 `lipsync_drift` 采样上报（COMP_007）。
8. **庆祝不被打断**：五连击答对触发 celebrating(6s) 期间连点角色 → 交互请求被优先级矩阵拦截，庆祝动画完整播放（G4/G5）。
9. **非法转移缓冲**：构造 sleeping → celebrating 直连请求 → 经 idle 300ms 中转后达 celebrating，无跳变撕裂（G3）。
10. **低端机 LOD**：Tier C 设备启动 → 自动 low 档（30fps/粒子关/物理关）；模拟连续 5s < 24fps → 降档且 10min 内不升档（§4.6.3）。
11. **交互冷却**：默认敏感度下 6s 内第二次点击头部 → 无动画/音效/触觉，`interaction_hit.inCooldown=true`；调敏感度至 1.0 → 冷却变 3s。
12. **拖拽物理回弹**：拖拽角色身体 → 物理摆动跟随，松手回弹，无动画抢占（§4.5）。
13. **LRU 淘汰**：已装 3 个角色时装第 4 个 → 最久未使用者被淘汰且 `asset_evicted` 上报；当前活跃角色在任意情况下不被淘汰。
14. **下载失败保留旧版**：升级包下载校验失败 → 旧版本继续可用，仅轻提示（D2）。
15. **账号切换清理**：设备 A 账号切换后 → 旧账号角色纹理卸载、缓存目录清空，新账号重新预载（G8）。
16. **前后台切换**：后台 3s 后回前台 → 纹理重建无黑块、动画从 idle 续播；后台期间 renderStats 停止上报（G7）。
17. **快照导出**：透明底 512×512 PNG 导出成功且不含任何用户信息；模拟导出失败 → 返回预置静态图（D9/G14）。
18. **浮窗互斥**：激活全局浮窗 AI 助手 → 伙伴形象折叠为 mini；浮窗收起 800ms 后恢复 full（§6.3）。

---

## 13. 关联文档

| 文档 | 关系 |
| --- | --- |
| 客户端-AI学习伙伴角色定制与互动设置页面架构与交互设计 | 上层设置页，消费本引擎 CompanionAvatarWidget 与偏好只读契约 |
| 客户端-AI语音对话实时交互与流式语音合成播放引擎 | 上游音频流/时钟/打断信号提供方 |
| 服务端-学生个性化虚拟形象系统与装扮解锁引擎 | 外观配置与解锁的服务端权威 |
| 客户端资源包下载管理器 | 角色资源包下载与校验的执行方 |
| 客户端-系统资源压力感知与智能降级调度引擎 | 全局资源压力等级提供方 |
| 客户端-学习报告卡片生成与社交分享图片渲染引擎 | 快照消费方 |
| 客户端-全局浮窗AI助手与跨页面学习辅助 | 同屏互斥裁决对象 |
| 端到端流程设计-学生AI学习伙伴全生命周期互动与成长进化完整链路 | 全生命周期时序权威 |
| 客户端埋点事件体系与数据采集规范 | companion 模块事件注册 |
| 客户端-Flutter平台通道与原生能力桥接层 | 通道注册/编解码规范来源 |

---

## 维护记录

- **v1.0** (2026-08-14): 初版，覆盖 §1-§4.3 前半（概述/架构/数据模型/状态机/情感驱动/口型同步振幅模式与音素查表开篇）。
- **v1.1** (2026-08-19): 补全烂尾文档。原文件 850 行截断于 §4.3 `_PhonemeTiming` 类 `final int startMs;` 字符处（围栏 23 奇），§4.3 之后内容全部缺失。本次补齐: §4.3 收尾（`_PhonemeTiming` 完整定义/音素→嘴型基准映射表 25 组与兑底表/音素时间轴与音频播放时钟 SSOT 对齐及漂移重锚/嘴型帧输出与结束收敛四规则）；新增 §4.4 动画混合器与调度器（六层叠加混合模型/优先级打断矩阵/crossfade/队列上限与回落规则）、§4.5 交互响应器（五区域命中表/五手势矩阵/冷却公式消费 interactionSensitivity/拖拽物理）、§4.6 LOD 策略器（设备三级分档/画质×特性 8 行矩阵/动态升降档与 G13 裁剪顺序红线/内存预算表）、§4.7 资源管理器（七态生命周期状态机/与下载管理器职责边界表/zip slip 防护原子安装管线/LRU 配额淘汰/首屏 500ms 管线与版本热切换）、§5 Platform Channel 桥接层（三通道划分/render+control 接口表/events 六事件/外接纹理模式裁决/原生 vsync 自驱动与 ParameterBatcher 合帧/生命周期五场景同步）、§6 页面集成（CompanionAvatarWidget 四模式 API/六场景消费矩阵/浮窗互斥规则/快照导出四条约束）、§7 守卫 G1-G14、§8 错误码 COMP_001~012 与四级渲染降级链及降级矩阵 D1-D10、§9 埋点 16 事件与指标 M1-M8、§10 合规红线 C1-C8、§11 契约对齐 12 项、§12 验收场景 18 条、§13 关联文档。修复 v1.0 三处缺陷：①§3.2 `CompanionEmotion` 枚举漏定义 `talking`（状态机 `_transitions` 与情感驱动器均已引用）②§4.3 `_estimateVowelFromFrequency` 共振峰映射与声学理论相反（低频标注 /a/ 却返回闭嘴值；按 F1 理论修正为低 F1→/i/,/u/、高 F1→/a/）③§4.3 振幅平滑公式 alpha ≈ 2×10⁻⁴ 近似直通致平滑失效（修正为 tau=50~200ms 时间常数映射）。
 