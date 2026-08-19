# 客户端-AI学习伙伴角色定制与互动设置页面架构与交互设计 详细设计

## 1. 概述

### 1.1 模块定位

AI 学习伙伴是 PrimeTop 中面向学生的虚拟学习助手角色。本模块负责学生在客户端侧对 AI 学习伙伴进行**角色选择、性格定制、外观设置、互动风格调节、关系进度查看**等全部交互操作。

该模块是以下服务端引擎的客户端展示与操作层：
- `服务端-学生AI学习伙伴角色个性化与对话风格自适应引擎`
- `服务端-学生AI学习伙伴长期记忆库与跨会话关系建构引擎`
- `服务端-AI辅导对话情感感知与自适应回应策略引擎`

### 1.2 核心职责

| 职责 | 说明 |
|------|------|
| 角色选择与切换 | 提供可选择的 AI 伙伴角色卡，支持预览与切换 |
| 性格维度调节 | 允许学生在预设范围内调整伙伴的辅导风格 |
| 外观自定义 | 头像、主题色、聊天气泡风格的选择 |
| 互动偏好设置 | 主动提醒频率、称呼方式、语言风格 |
| 关系进度管理 | 展示伙伴等级、亲密度、解锁里程碑 |
| 记忆管理 | 查看和管理 AI 伙伴记住的关于学生的信息 |
| 互动入口集成 | 在 AI 对话页、首页等位置呈现伙伴形象 |

### 1.3 依赖关系

```
本模块
├── 依赖 → 用户服务（学生身份、学段信息）
├── 依赖 → AI对话服务（伙伴风格应用于对话）
├── 依赖 → 学习画像服务（伙伴行为参考学生画像）
├── 依赖 → 消息推送服务（伙伴主动提醒触达）
└── 依赖 → 本地缓存层（离线展示伙伴状态）
```

### 1.4 设计原则

1. **适龄化**：幼儿/小学/初中/高中不同学段的 UI 复杂度和可调项数量不同
2. **渐进式**：初次使用默认角色，随使用深度逐步解锁更多定制项
3. **低门槛**：关键设置项不超过 3 步操作
4. **即时预览**：每次调整后提供 AI 对话预览，让用户直观感知效果
5. **可重置**：所有定制均可一键恢复默认

---

## 2. 页面架构与导航设计

### 2.1 入口设计

```
┌─────────────────────────────────────────────┐
│  我的页面                                    │
│  ├── 学习伙伴  → [入口卡片] ──────────────┐ │
│  │     ┌──────────────────────────┐        │ │
│  │     │ 🤖 伙伴名: 小启           │        │ │
│  │     │ Lv.5 亲密度 ██████░░ 75% │        │ │
│  │     │ 点击管理 →               │        │ │
│  │     └──────────────────────────┘        │ │
│  ├── ...                                    │ │
│                                             │ │
│  AI对话页  → [顶部头像点击] ────────────────┤─┤
│  首页      → [伙伴问候卡片头像点击] ────────┤─┘
│                                             │
│  设置页面 → 个性化设置 → 学习伙伴 ──────────┘
└─────────────────────────────────────────────┘
                                                    ↓
                    ┌─────────────────────────────────┐
                    │     学习伙伴管理页面 (主页)       │
                    │  ┌─────┬─────┬─────┬─────┬────┐ │
                    │  │角色 │性格 │外观 │互动 │记忆 │ │
                    │  │选择 │调节 │定制 │偏好 │管理 │ │
                    │  └─────┴─────┴─────┴─────┴────┘ │
                    │  ┌─────────────────────────────┐│
                    │  │     伙伴预览区 (实时)        ││
                    │  │   [对话气泡 + 伙伴头像]     ││
                    │  └─────────────────────────────┘│
                    └─────────────────────────────────┘
```

### 2.2 页面层级

```
学习伙伴管理 (CompanionHome)
├── Tab 1: 角色选择 (CharacterSelect)
│   ├── 角色卡片列表
│   ├── 角色详情预览
│   └── 角色切换确认
├── Tab 2: 性格调节 (PersonalityTuning)
│   ├── 辅导严格度滑块
│   ├── 语言风格选择
│   ├── 鼓励频率滑块
│   └── 幽默感滑块
├── Tab 3: 外观定制 (AppearanceCustom)
│   ├── 头像选择
│   ├── 主题色选择
│   ├── 气泡风格选择
│   └── 称呼设置
├── Tab 4: 互动偏好 (InteractionPrefs)
│   ├── 主动提醒开关与频率
│   ├── 学习建议推送
│   ├── 问候语时段设置
│   └── 声音/TTS偏好
├── Tab 5: 关系与记忆 (RelationMemory)
│   ├── 等级与亲密度展示
│   ├── 里程碑成就列表
│   ├── 记忆条目管理
│   └── 互动统计概览
└── 预览区 (PreviewArea) - 常驻底部
```

### 2.3 路由定义

```dart
// Flutter 路由定义
class CompanionRoutes {
  static const String home = '/companion';
  static const String characterSelect = '/companion/character';
  static const String personality = '/companion/personality';
  static const String appearance = '/companion/appearance';
  static const String interaction = '/companion/interaction';
  static const String memory = '/companion/memory';
  static const String preview = '/companion/preview';
  static const String milestone = '/companion/milestone';
}
```

---

## 3. 数据模型

### 3.1 客户端核心数据结构

```dart
/// AI 学习伙伴配置 (客户端缓存模型)
class CompanionProfile {
  final String companionId;          // 伙伴唯一ID
  final String characterId;          // 角色模板ID
  final String characterName;        // 角色显示名 (如 "小启"、"学霸猫")
  final String nickName;             // 用户自定义昵称
  final String userAlias;            // 伙伴对用户的称呼

  // 角色信息
  final CharacterTemplate character;

  // 性格维度 (0.0 ~ 1.0)
  final PersonalityDimensions personality;

  // 外观配置
  final AppearanceConfig appearance;

  // 互动偏好
  final InteractionPreferences interaction;

  // 关系数据
  final CompanionRelation relation;

  // 元数据
  final DateTime createdAt;
  final DateTime updatedAt;
  final int version;                 // 配置版本号

  CompanionProfile({
    required this.companionId,
    required this.characterId,
    required this.characterName,
    required this.nickName,
    required this.userAlias,
    required this.character,
    required this.personality,
    required this.appearance,
    required this.interaction,
    required this.relation,
    required this.createdAt,
    required this.updatedAt,
    required this.version,
  });

  factory CompanionProfile.fromJson(Map<String, dynamic> json) {
    return CompanionProfile(
      companionId: json['companionId'] as String,
      characterId: json['characterId'] as String,
      characterName: json['characterName'] as String,
      nickName: json['nickName'] as String? ?? json['characterName'] as String,
      userAlias: json['userAlias'] as String? ?? '同学',
      character: CharacterTemplate.fromJson(json['character'] as Map<String, dynamic>),
      personality: PersonalityDimensions.fromJson(json['personality'] as Map<String, dynamic>),
      appearance: AppearanceConfig.fromJson(json['appearance'] as Map<String, dynamic>),
      interaction: InteractionPreferences.fromJson(json['interaction'] as Map<String, dynamic>),
      relation: CompanionRelation.fromJson(json['relation'] as Map<String, dynamic>),
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
      version: json['version'] as int? ?? 1,
    );
  }

  Map<String, dynamic> toJson() => {
    'companionId': companionId,
    'characterId': characterId,
    'characterName': characterName,
    'nickName': nickName,
    'userAlias': userAlias,
    'character': character.toJson(),
    'personality': personality.toJson(),
    'appearance': appearance.toJson(),
    'interaction': interaction.toJson(),
    'relation': relation.toJson(),
    'createdAt': createdAt.toIso8601String(),
    'updatedAt': updatedAt.toIso8601String(),
    'version': version,
  };
}

/// 角色模板
class CharacterTemplate {
  final String id;
  final String name;
  final String description;
  final String avatarUrl;            // 默认头像
  final String themeColor;           // 默认主题色 (hex)
  final List<String> personalityTags; // 性格标签 ["温柔","严谨","幽默"]
  final String defaultGreeting;       // 默认问候语
  final String voiceProfile;          // 默认语音配置ID
  final int minGradeLevel;            // 适用最低学段 (0=幼儿,1=小学,2=初中,3=高中)
  final int maxGradeLevel;
  final bool isLocked;               // 是否锁定 (需达成条件解锁)
  final String? unlockCondition;     // 解锁条件描述

  CharacterTemplate({
    required this.id,
    required this.name,
    required this.description,
    required this.avatarUrl,
    required this.themeColor,
    required this.personalityTags,
    required this.defaultGreeting,
    required this.voiceProfile,
    required this.minGradeLevel,
    required this.maxGradeLevel,
    this.isLocked = false,
    this.unlockCondition,
  });

  factory CharacterTemplate.fromJson(Map<String, dynamic> json) {
    return CharacterTemplate(
      id: json['id'] as String,
      name: json['name'] as String,
      description: json['description'] as String,
      avatarUrl: json['avatarUrl'] as String,
      themeColor: json['themeColor'] as String,
      personalityTags: (json['personalityTags'] as List).cast<String>(),
      defaultGreeting: json['defaultGreeting'] as String,
      voiceProfile: json['voiceProfile'] as String,
      minGradeLevel: json['minGradeLevel'] as int,
      maxGradeLevel: json['maxGradeLevel'] as int,
      isLocked: json['isLocked'] as bool? ?? false,
      unlockCondition: json['unlockCondition'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'description': description,
    'avatarUrl': avatarUrl,
    'themeColor': themeColor,
    'personalityTags': personalityTags,
    'defaultGreeting': defaultGreeting,
    'voiceProfile': voiceProfile,
    'minGradeLevel': minGradeLevel,
    'maxGradeLevel': maxGradeLevel,
    'isLocked': isLocked,
    'unlockCondition': unlockCondition,
  };
}

/// 性格维度 (5个可调维度)
class PersonalityDimensions {
  /// 辅导严格度: 0.0=非常包容(只夸奖) ~ 1.0=非常严格(指出每个错误)
  final double strictness;

  /// 鼓励频率: 0.0=极少鼓励 ~ 1.0=非常频繁鼓励
  final double encouragement;

  /// 幽默感: 0.0=严肃正式 ~ 1.0=活泼幽默
  final double humor;

  /// 讲解详细度: 0.0=精简直接 ~ 1.0=非常详细
  final double verbosity;

  /// 启发式程度: 0.0=直接给答案思路 ~ 1.0=引导自己思考
  final double heuristics;

  PersonalityDimensions({
    required this.strictness,
    required this.encouragement,
    required this.humor,
    required this.verbosity,
    required this.heuristics,
  });

  /// 默认值 (基于角色模板)
  factory PersonalityDimensions.defaultFor(CharacterTemplate template) {
    // 每个角色模板有不同的默认性格
    switch (template.id) {
      case 'gentle_tutor':
        return PersonalityDimensions(strictness: 0.3, encouragement: 0.8, humor: 0.4, verbosity: 0.7, heuristics: 0.6);
      case 'strict_scholar':
        return PersonalityDimensions(strictness: 0.8, encouragement: 0.4, humor: 0.2, verbosity: 0.8, heuristics: 0.7);
      case 'playful_cat':
        return PersonalityDimensions(strictness: 0.4, encouragement: 0.9, humor: 0.9, verbosity: 0.5, heuristics: 0.5);
      case 'cool_senior':
        return PersonalityDimensions(strictness: 0.6, encouragement: 0.5, humor: 0.7, verbosity: 0.4, heuristics: 0.8);
      default:
        return PersonalityDimensions(strictness: 0.5, encouragement: 0.6, humor: 0.5, verbosity: 0.6, heuristics: 0.6);
    }
  }

  factory PersonalityDimensions.fromJson(Map<String, dynamic> json) {
    return PersonalityDimensions(
      strictness: (json['strictness'] as num).toDouble(),
      encouragement: (json['encouragement'] as num).toDouble(),
      humor: (json['humor'] as num).toDouble(),
      verbosity: (json['verbosity'] as num).toDouble(),
      heuristics: (json['heuristics'] as num).toDouble(),
    );
  }

  Map<String, dynamic> toJson() => {
    'strictness': strictness,
    'encouragement': encouragement,
    'humor': humor,
    'verbosity': verbosity,
    'heuristics': heuristics,
  };
}

/// 外观配置
class AppearanceConfig {
  final String avatarId;             // 头像ID
  final String avatarUrl;            // 头像资源URL
  final String themeColor;           // 主题色 hex (如 "#4A90D9")
  final String bubbleStyle;          // 气泡风格 ("rounded"|"square"|"comic")
  final String fontTheme;            // 字体主题 ("default"|"rounded"|"handwriting")
  final String? customBadge;         // 自定义徽章/挂件 (解锁项)

  AppearanceConfig({
    required this.avatarId,
    required this.avatarUrl,
    required this.themeColor,
    required this.bubbleStyle,
    required this.fontTheme,
    this.customBadge,
  });

  factory AppearanceConfig.fromJson(Map<String, dynamic> json) {
    return AppearanceConfig(
      avatarId: json['avatarId'] as String,
      avatarUrl: json['avatarUrl'] as String,
      themeColor: json['themeColor'] as String,
      bubbleStyle: json['bubbleStyle'] as String? ?? 'rounded',
      fontTheme: json['fontTheme'] as String? ?? 'default',
      customBadge: json['customBadge'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
    'avatarId': avatarId,
    'avatarUrl': avatarUrl,
    'themeColor': themeColor,
    'bubbleStyle': bubbleStyle,
    'fontTheme': fontTheme,
    if (customBadge != null) 'customBadge': customBadge,
  };
}

/// 互动偏好
class InteractionPreferences {
  final bool proactiveEnabled;       // 是否允许主动提醒
  final ProactiveFrequency frequency; // 主动提醒频率
  final bool morningGreeting;        // 早上问候
  final bool eveningSummary;         // 晚间总结
  final String greetingTimeRange;    // 问候时间段 ("07:00-09:00")
  final bool voiceResponse;          // 是否使用语音回复
  final String voiceSpeed;           // 语音速度 ("slow"|"normal"|"fast")
  final bool emojiInResponse;        // 回复中是否使用表情

  InteractionPreferences({
    required this.proactiveEnabled,
    required this.frequency,
    required this.morningGreeting,
    required this.eveningSummary,
    required this.greetingTimeRange,
    required this.voiceResponse,
    required this.voiceSpeed,
    required this.emojiInResponse,
  });

  factory InteractionPreferences.defaults() {
    return InteractionPreferences(
      proactiveEnabled: true,
      frequency: ProactiveFrequency.moderate,
      morningGreeting: true,
      eveningSummary: false,
      greetingTimeRange: '07:00-09:00',
      voiceResponse: false,
      voiceSpeed: 'normal',
      emojiInResponse: true,
    );
  }

  factory InteractionPreferences.fromJson(Map<String, dynamic> json) {
    return InteractionPreferences(
      proactiveEnabled: json['proactiveEnabled'] as bool? ?? true,
      frequency: ProactiveFrequency.fromString(json['frequency'] as String? ?? 'moderate'),
      morningGreeting: json['morningGreeting'] as bool? ?? true,
      eveningSummary: json['eveningSummary'] as bool? ?? false,
      greetingTimeRange: json['greetingTimeRange'] as String? ?? '07:00-09:00',
      voiceResponse: json['voiceResponse'] as bool? ?? false,
      voiceSpeed: json['voiceSpeed'] as String? ?? 'normal',
      emojiInResponse: json['emojiInResponse'] as bool? ?? true,
    );
  }

  Map<String, dynamic> toJson() => {
    'proactiveEnabled': proactiveEnabled,
    'frequency': frequency.name,
    'morningGreeting': morningGreeting,
    'eveningSummary': eveningSummary,
    'greetingTimeRange': greetingTimeRange,
    'voiceResponse': voiceResponse,
    'voiceSpeed': voiceSpeed,
    'emojiInResponse': emojiInResponse,
  };
}

/// 主动提醒频率
enum ProactiveFrequency {
  minimal,   // 极少: 每天最多1次
  moderate,  // 适中: 每天最多3次
  active,    // 活跃: 每天最多5次
  eager;     // 热情: 每天最多8次

  static ProactiveFrequency fromString(String value) {
    return values.firstWhere(
      (e) => e.name == value,
      orElse: () => moderate,
    );
  }
}

/// 伙伴关系数据
class CompanionRelation {
  final int level;                   // 伙伴等级
  final int currentExp;              // 当前经验值
  final int nextLevelExp;            // 升级所需经验值
  final double intimacyScore;        // 亲密度 (0.0 ~ 100.0)
  final int totalInteractions;       // 总互动次数
  final int studyDaysTogether;       // 一起学习的天数
  final List<Milestone> unlockedMilestones; // 已解锁里程碑
  final DateTime bondedAt;           // 结成伙伴的日期

  CompanionRelation({
    required this.level,
    required this.currentExp,
    required this.nextLevelExp,
    required this.intimacyScore,
    required this.totalInteractions,
    required this.studyDaysTogether,
    required this.unlockedMilestones,
    required this.bondedAt,
  });

  factory CompanionRelation.fromJson(Map<String, dynamic> json) {
    return CompanionRelation(
      level: json['level'] as int? ?? 1,
      currentExp: json['currentExp'] as int? ?? 0,
      nextLevelExp: json['nextLevelExp'] as int? ?? 100,
      intimacyScore: (json['intimacyScore'] as num?)?.toDouble() ?? 0.0,
      totalInteractions: json['totalInteractions'] as int? ?? 0,
      studyDaysTogether: json['studyDaysTogether'] as int? ?? 0,
      unlockedMilestones: (json['unlockedMilestones'] as List?)
          ?.map((e) => Milestone.fromJson(e as Map<String, dynamic>))
          .toList() ?? [],
      bondedAt: json['bondedAt'] != null
          ? DateTime.parse(json['bondedAt'] as String)
          : DateTime.now(),
    );
  }

  Map<String, dynamic> toJson() => {
    'level': level,
    'currentExp': currentExp,
    'nextLevelExp': nextLevelExp,
    'intimacyScore': intimacyScore,
    'totalInteractions': totalInteractions,
    'studyDaysTogether': studyDaysTogether,
    'unlockedMilestones': unlockedMilestones.map((e) => e.toJson()).toList(),
    'bondedAt': bondedAt.toIso8601String(),
  };

  /// 计算等级进度百分比 (0.0 ~ 1.0)
  double get levelProgress => currentExp / nextLevelExp;
}

/// 里程碑
class Milestone {
  final String id;
  final String title;
  final String description;
  final String iconUrl;
  final DateTime unlockedAt;
  final String category;             // "bond"|"study"|"social"|"special"

  Milestone({
    required this.id,
    required this.title,
    required this.description,
    required this.iconUrl,
    required this.unlockedAt,
    required this.category,
  });

  factory Milestone.fromJson(Map<String, dynamic> json) {
    return Milestone(
      id: json['id'] as String,
      title: json['title'] as String,
      description: json['description'] as String,
      iconUrl: json['iconUrl'] as String,
      unlockedAt: DateTime.parse(json['unlockedAt'] as String),
      category: json['category'] as String,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'description': description,
    'iconUrl': iconUrl,
    'unlockedAt': unlockedAt.toIso8601String(),
    'category': category,
  };
}

/// AI 伙伴记忆条目
class CompanionMemoryItem {
  final String memoryId;
  final String category;             // "preference"|"habit"|"goal"|"event"|"person"
  final String content;              // 记忆内容描述
  final DateTime recordedAt;
  final String source;               // 来源 ("dialogue"|"survey"|"inferred")
  final bool userEditable;           // 用户可编辑/删除
  final int confidence;              // 置信度 (0-100)

  CompanionMemoryItem({
    required this.memoryId,
    required this.category,
    required this.content,
    required this.recordedAt,
    required this.source,
    required this.userEditable,
    required this.confidence,
  });

  factory CompanionMemoryItem.fromJson(Map<String, dynamic> json) {
    return CompanionMemoryItem(
      memoryId: json['memoryId'] as String,
      category: json['category'] as String,
      content: json['content'] as String,
      recordedAt: DateTime.parse(json['recordedAt'] as String),
      source: json['source'] as String,
      userEditable: json['userEditable'] as bool? ?? true,
      confidence: json['confidence'] as int? ?? 80,
    );
  }

  Map<String, dynamic> toJson() => {
    'memoryId': memoryId,
    'category': category,
    'content': content,
    'recordedAt': recordedAt.toIso8601String(),
    'source': source,
    'userEditable': userEditable,
    'confidence': confidence,
  };
}
```

### 3.2 本地数据库表结构 (Isar / SQLite)

```dart
// Isar 集合定义 (Flutter 端推荐 Isar 或 Drift)

@collection
class CompanionProfileEntity {
  Id id = Isar.autoIncrement;

  @Index(unique: true)
  late String companionId;

  late String userId;

  late String characterId;
  late String characterName;
  late String nickName;
  late String userAlias;

  // 性格维度 (JSON 字符串)
  late String personalityJson;

  // 外观配置 (JSON 字符串)
  late String appearanceJson;

  // 互动偏好 (JSON 字符串)
  late String interactionJson;

  // 关系数据 (JSON 字符串)
  late String relationJson;

  // 同步元数据
  late DateTime lastSyncedAt;
  late int serverVersion;
  late bool isDirty;              // 本地修改未同步标记

  DateTime createdAt = DateTime.now();
  DateTime updatedAt = DateTime.now();
}

@collection
class CompanionMemoryEntity {
  Id id = Isar.autoIncrement;

  @Index(unique: true)
  late String memoryId;

  late String userId;
  late String companionId;

  late String category;
  late String content;
  late DateTime recordedAt;
  late String source;
  late bool userEditable;
  late int confidence;

  // 本地删除标记 (软删除)
  late bool isDeleted;
  late DateTime? deletedAt;

  late bool isDirty;
  late DateTime lastSyncedAt;
}

@collection
class CompanionCacheEntity {
  Id id = Isar.autoIncrement;

  @Index(unique: true)
  late String cacheKey;          // 如 "characters_list", "preview_response_{hash}"

  late String cacheValue;
  late DateTime cachedAt;
  late int ttlSeconds;

  bool isValid() {
    return DateTime.now().isBefore(cachedAt.add(Duration(seconds: ttlSeconds)));
  }
}
```

### 3.3 服务端数据表参考 (已在服务端引擎文档中定义，此处仅列引用)

```sql
-- 引用: 服务端-学生AI学习伙伴角色个性化与对话风格自适应引擎
CREATE TABLE companion_profile (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    companion_id VARCHAR(64) NOT NULL UNIQUE,
    user_id BIGINT NOT NULL,
    character_id VARCHAR(64) NOT NULL,
    nick_name VARCHAR(32),
    user_alias VARCHAR(32) DEFAULT '同学',
    personality_json JSON NOT NULL,
    appearance_json JSON NOT NULL,
    interaction_json JSON NOT NULL,
    version INT DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id)
);

-- 引用: 服务端-学生AI学习伙伴长期记忆库与跨会话关系建构引擎
CREATE TABLE companion_memory (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    memory_id VARCHAR(64) NOT NULL UNIQUE,
    companion_id VARCHAR(64) NOT NULL,
    user_id BIGINT NOT NULL,
    category VARCHAR(32) NOT NULL,
    content TEXT NOT NULL,
    source VARCHAR(32) NOT NULL DEFAULT 'dialogue',
    confidence INT DEFAULT 80,
    is_active TINYINT(1) DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_companion_user (companion_id, user_id),
    INDEX idx_category (category)
);

CREATE TABLE companion_relation (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    companion_id VARCHAR(64) NOT NULL UNIQUE,
    user_id BIGINT NOT NULL,
    level INT DEFAULT 1,
    current_exp INT DEFAULT 0,
    next_level_exp INT DEFAULT 100,
    intimacy_score DECIMAL(5,2) DEFAULT 0.00,
    total_interactions INT DEFAULT 0,
    study_days_together INT DEFAULT 0,
    bonded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id)
);

CREATE TABLE companion_milestone (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    companion_id VARCHAR(64) NOT NULL,
    milestone_id VARCHAR(64) NOT NULL,
    unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_companion_milestone (companion_id, milestone_id)
);
```

---

## 4. API 接口设计

### 4.1 接口总览

| # | 接口 | 方法 | 路径 | 说明 |
|---|------|------|------|------|
| 1 | 获取伙伴配置 | GET | `/api/v1/companion/profile` | 获取当前用户的伙伴完整配置 |
| 2 | 更新伙伴配置 | PUT | `/api/v1/companion/profile` | 全量或增量更新配置 |
| 3 | 重置伙伴配置 | POST | `/api/v1/companion/reset` | 恢复默认配置 |
| 4 | 角色列表 | GET | `/api/v1/companion/characters` | 获取可选角色模板列表 |
| 5 | 切换角色 | POST | `/api/v1/companion/character/switch` | 切换到新角色 |
| 6 | 对话预览 | POST | `/api/v1/companion/preview` | 根据当前配置生成预览对话 |
| 7 | 关系数据 | GET | `/api/v1/companion/relation` | 获取等级/亲密度/里程碑 |
| 8 | 里程碑列表 | GET | `/api/v1/companion/milestones` | 获取全部里程碑(含锁定/解锁) |
| 9 | 记忆列表 | GET | `/api/v1/companion/memories` | 获取伙伴记忆条目 |
| 10 | 更新记忆 | PUT | `/api/v1/companion/memories/{id}` | 编辑记忆内容 |
| 11 | 删除记忆 | DELETE | `/api/v1/companion/memories/{id}` | 删除指定记忆条目 |
| 12 | 外观资源列表 | GET | `/api/v1/companion/appearance-options` | 获取可选头像/主题色/气泡列表 |

### 4.2 详细接口定义

#### 4.2.1 获取伙伴配置

```
GET /api/v1/companion/profile
```

**请求头：**
```
Authorization: Bearer {token}
```

**响应 200：**
```json
{
  "code": 0,
  "data": {
    "companionId": "comp_20260601_a1b2c3",
    "characterId": "gentle_tutor",
    "characterName": "小启",
    "nickName": "小启",
    "userAlias": "小明",
    "character": {
      "id": "gentle_tutor",
      "name": "小启",
      "description": "温柔耐心的学习伙伴，擅长用简单的方式讲解复杂知识",
      "avatarUrl": "https://cdn.primetop.edu/companion/gentle_tutor_v2.png",
      "themeColor": "#4A90D9",
      "personalityTags": ["温柔", "耐心", "善于鼓励"],
      "defaultGreeting": "你好呀！今天我们一起学点什么有趣的呢？",
      "voiceProfile": "female_gentle_01",
      "minGradeLevel": 0,
      "maxGradeLevel": 3,
      "isLocked": false
    },
    "personality": {
      "strictness": 0.3,
      "encouragement": 0.8,
      "humor": 0.4,
      "verbosity": 0.7,
      "heuristics": 0.6
    },
    "appearance": {
      "avatarId": "gentle_tutor_v2",
      "avatarUrl": "https://cdn.primetop.edu/companion/gentle_tutor_v2.png",
      "themeColor": "#4A90D9",
      "bubbleStyle": "rounded",
      "fontTheme": "default",
      "customBadge": null
    },
    "interaction": {
      "proactiveEnabled": true,
      "frequency": "moderate",
      "morningGreeting": true,
      "eveningSummary": false,
      "greetingTimeRange": "07:00-09:00",
      "voiceResponse": false,
      "voiceSpeed": "normal",
      "emojiInResponse": true
    },
    "relation": {
      "level": 5,
      "currentExp": 340,
      "nextLevelExp": 500,
      "intimacyScore": 72.5,
      "totalInteractions": 156,
      "studyDaysTogether": 28,
      "unlockedMilestones": [
        {
          "id": "first_meeting",
          "title": "初次见面",
          "description": "与学习伙伴首次相遇",
          "iconUrl": "https://cdn.primetop.edu/milestone/first_meeting.png",
          "unlockedAt": "2026-06-01T10:30:00Z",
          "category": "bond"
        },
        {
          "id": "seven_days",
          "title": "一周伙伴",
          "description": "与学习伙伴共同学习满7天",
          "iconUrl": "https://cdn.primetop.edu/milestone/seven_days.png",
          "unlockedAt": "2026-06-08T10:30:00Z",
          "category": "bond"
        }
      ],
      "bondedAt": "2026-06-01T10:30:00Z"
    },
    "createdAt": "2026-06-01T10:30:00Z",
    "updatedAt": "2026-06-30T08:15:00Z",
    "version": 8
  }
}
```

**响应 404 (未创建伙伴)：**
```json
{
  "code": 40401,
  "message": "尚未创建学习伙伴，请先选择角色",
  "data": null
}
```

#### 4.2.2 更新伙伴配置

```
PUT /api/v1/companion/profile
```

**请求体（支持增量更新，只传需要修改的字段）：**
```json
{
  "nickName": "小启启",
  "userAlias": "小明同学",
  "personality": {
    "strictness": 0.5,
    "humor": 0.7
  },
  "appearance": {
    "themeColor": "#FF6B9D",
    "bubbleStyle": "comic"
  },
  "interaction": {
    "frequency": "active",
    "eveningSummary": true
  }
}
```

**响应 200：**
```json
{
  "code": 0,
  "data": {
    "version": 9,
    "updatedAt": "2026-06-30T13:00:00Z",
    "appliedFields": [
      "nickName", "userAlias",
      "personality.strictness", "personality.humor",
      "appearance.themeColor", "appearance.bubbleStyle",
      "interaction.frequency", "interaction.eveningSummary"
    ]
  }
}
```

**响应 400 (参数校验失败)：**
```json
{
  "code": 40001,
  "message": "参数校验失败",
  "errors": [
    { "field": "personality.strictness", "message": "取值必须在 0.0 到 1.0 之间" }
  ]
}
```

#### 4.2.3 角色列表

```
GET /api/v1/companion/characters?gradeLevel={gradeLevel}
```

**查询参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| gradeLevel | int | 否 | 学段过滤 (0=幼儿,1=小学,2=初中,3=高中)，不传则返回全部 |

**响应 200：**
```json
{
  "code": 0,
  "data": {
    "characters": [
      {
        "id": "gentle_tutor",
        "name": "小启",
        "description": "温柔耐心的学习伙伴，擅长用简单的方式讲解复杂知识",
        "avatarUrl": "https://cdn.primetop.edu/companion/gentle_tutor_v2.png",
        "themeColor": "#4A90D9",
        "personalityTags": ["温柔", "耐心", "善于鼓励"],
        "defaultGreeting": "你好呀！今天我们一起学点什么有趣的呢？",
        "minGradeLevel": 0,
        "maxGradeLevel": 3,
        "isLocked": false
      },
      {
        "id": "strict_scholar",
        "name": "严师",
        "description": "严谨认真的学术派伙伴，追求知识的深度与准确",
        "avatarUrl": "https://cdn.primetop.edu/companion/strict_scholar_v1.png",
        "themeColor": "#2C3E50",
        "personalityTags": ["严谨", "博学", "追求卓越"],
        "defaultGreeting": "知识改变命运。准备好了吗？今天的目标是什么？",
        "minGradeLevel": 2,
        "maxGradeLevel": 3,
        "isLocked": false
      },
      {
        "id": "playful_cat",
        "name": "学霸猫",
        "description": "活泼好动的猫咪伙伴，让学习变得像游戏一样有趣",
        "avatarUrl": "https://cdn.primetop.edu/companion/playful_cat_v1.png",
        "themeColor": "#FF9F43",
        "personalityTags": ["活泼", "幽默", "充满好奇"],
        "defaultGreeting": "喵~！又见面啦！今天有什么好玩的题目吗？",
        "minGradeLevel": 0,
        "maxGradeLevel": 1,
        "isLocked": false
      },
      {
        "id": "cool_senior",
        "name": "学长",
        "description": "帅气的学长伙伴，既会辅导学习又懂你的心事",
        "avatarUrl": "https://cdn.primetop.edu/companion/cool_senior_v1.png",
        "themeColor": "#6C5CE7",
        "personalityTags": ["酷", "有经验", "善解人意"],
        "defaultGreeting": "呦，来了。今天有什么需要我帮忙的？",
        "minGradeLevel": 2,
        "maxGradeLevel": 3,
        "isLocked": true,
        "unlockCondition": "伙伴等级达到 10 级解锁"
      }
    ],
    "currentCharacterId": "gentle_tutor"
  }
}
```

#### 4.2.4 切换角色

```
POST /api/v1/companion/character/switch
```

**请求体：**
```json
{
  "characterId": "playful_cat"
}
```

**响应 200：**
```json
{
  "code": 0,
  "data": {
    "companionId": "comp_20260601_a1b2c3",
    "characterId": "playful_cat",
    "characterName": "学霸猫",
    "personality": {
      "strictness": 0.4,
      "encouragement": 0.9,
      "humor": 0.9,
      "verbosity": 0.5,
      "heuristics": 0.5
    },
    "appearance": {
      "avatarId": "playful_cat_v1",
      "avatarUrl": "https://cdn.primetop.edu/companion/playful_cat_v1.png",
      "themeColor": "#FF9F43",
      "bubbleStyle": "rounded",
      "fontTheme": "default",
      "customBadge": null
    },
    "version": 10,
    "updatedAt": "2026-06-30T13:10:00Z"
  }
}
```

**响应 403 (角色锁定)：**
```json
{
  "code": 40301,
  "message": "该角色尚未解锁",
  "data": {
    "unlockCondition": "伙伴等级达到 10 级解锁"
  }
}
```

**注意**：切换角色后，性格维度会重置为新角色的默认值，但用户自定义的昵称、互动偏好（提醒频率等）和关系数据（等级、亲密度）保持不变。

#### 4.2.5 对话预览

```
POST /api/v1/companion/preview
```

**请求体：**
```json
{
  "personality": {
    "strictness": 0.8,
    "encouragement": 0.3,
    "humor": 0.2,
    "verbosity": 0.8,
    "heuristics": 0.7
  },
  "sampleQuestion": "什么是勾股定理？",
  "gradeLevel": 2
}
```

**响应 200 (SSE 流式)：**
```
event: token
data: {"content": "勾股定理"}

event: token
data: {"content": "是几何学中"}

event: token
data: {"content": "一个非常基础且重要的定理。"}

event: token
data: {"content": "\n\n它描述了**直角三角形**中三条边的关系："}

event: token
data: {"content": "\n\n**a² + b² = c²**\n\n其中 a 和 b 是两条直角边，c 是斜边。"}

event: done
data: {"totalTokens": 48}
```

#### 4.2.6 记忆管理

```
GET /api/v1/companion/memories?category={category}&page=1&pageSize=20
```

**响应 200：**
```json
{
  "code": 0,
  "data": {
    "memories": [
      {
        "memoryId": "mem_001",
        "category": "preference",
        "content": "喜欢用画图的方式理解数学概念",
        "recordedAt": "2026-06-15T14:20:00Z",
        "source": "inferred",
        "userEditable": true,
        "confidence": 85
      },
      {
        "memoryId": "mem_002",
        "category": "goal",
        "content": "目标是期末考试数学达到90分以上",
        "recordedAt": "2026-06-20T09:00:00Z",
        "source": "dialogue",
        "userEditable": true,
        "confidence": 95
      },
      {
        "memoryId": "mem_003",
        "category": "habit",
        "content": "通常在晚上8-10点学习，偏好在安静环境中学习",
        "recordedAt": "2026-06-25T20:30:00Z",
        "source": "inferred",
        "userEditable": true,
        "confidence": 72
      }
    ],
    "total": 12,
    "page": 1,
    "pageSize": 20
  }
}
```

#### 4.2.7 错误码定义

| 错误码 | HTTP状态 | 说明 | 处理策略 |
|--------|----------|------|----------|
| 40401 | 404 | 尚未创建学习伙伴 | 引导用户进入角色选择流程 |
| 40301 | 403 | 角色未解锁 | 显示解锁条件，引导完成任务 |
| 40001 | 400 | 参数校验失败 | 表单内联显示具体错误 |
| 40901 | 409 | 配置版本冲突 | 拉取最新配置后合并重试 |
| 42901 | 429 | 预览请求过于频繁 | 客户端节流，最少间隔3秒 |
| 50001 | 500 | 服务端内部错误 | 使用本地缓存展示，后台重试 |

---

## 5. 页面详细交互设计

### 5.1 学习伙伴管理主页 (CompanionHomePage)

#### 5.1.1 页面结构

```
┌──────────────────────────────────────────────┐
│  [← 返回]   学习伙伴                    [⋮]  │  ← AppBar
├──────────────────────────────────────────────┤
│                                              │
│  ┌──────────────────────────────────────┐    │  ← 伙伴概览卡片
│  │     [伙伴头像]  小启 (Lv.5)          │    │     (点击可查看详情)
│  │                  "你好呀！"           │    │
│  │     亲密度 ████████████░░ 72%       │    │
│  │     已陪伴学习 28 天                 │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  ┌──────────────────────────────────────┐    │  ← Tab 导航
│  │  [角色]  [性格]  [外观]  [互动] [记忆] │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  ┌──────────────────────────────────────┐    │  ← Tab 内容区
│  │                                      │    │
│  │         (当前 Tab 内容)              │    │
│  │                                      │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  ┌──────────────────────────────────────┐    │  ← 底部预览区
│  │  💬 预览效果:                        │    │     (常驻)
│  │  "你好呀！今天我们一起学点什么？😊"  │    │
│  │                          [点击试对话] │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

#### 5.1.2 核心代码 - 页面骨架

```dart
class CompanionHomePage extends ConsumerStatefulWidget {
  const CompanionHomePage({super.key});

  @override
  ConsumerState<CompanionHomePage> createState() => _CompanionHomePageState();
}

class _CompanionHomePageState extends ConsumerState<CompanionHomePage>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 5, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final profileAsync = ref.watch(companionProfileProvider);

    return Scaffold(
      appBar: PrimeTopAppBar(
        title: '学习伙伴',
        leading: const BackButton(),
        actions: [
          PopupMenuButton<CompanionMenuAction>(
            icon: const Icon(Icons.more_vert),
            onSelected: _handleMenuAction,
            itemBuilder: (context) => [
              const PopupMenuItem(
                value: CompanionMenuAction.reset,
                child: Text('恢复默认设置'),
              ),
              const PopupMenuItem(
                value: CompanionMenuAction.report,
                child: Text('问题反馈'),
              ),
            ],
          ),
        ],
      ),
      body: profileAsync.when(
        loading: () => const CompanionLoadingSkeleton(),
        error: (error, stack) => CompanionErrorView(
          error: error,
          onRetry: () => ref.invalidate(companionProfileProvider),
        ),
        data: (profile) => Column(
          children: [
            // 伙伴概览卡片
            CompanionOverviewCard(profile: profile),
            // Tab 导航
            CompanionTabBar(controller: _tabController),
            // Tab 内容区
            Expanded(
              child: TabBarView(
                controller: _tabController,
                children: [
                  CharacterSelectTab(profile: profile),
                  PersonalityTuningTab(profile: profile),
                  AppearanceCustomTab(profile: profile),
                  InteractionPrefsTab(profile: profile),
                  RelationMemoryTab(profile: profile),
                ],
              ),
            ),
            // 底部预览区
            CompanionPreviewBar(profile: profile),
          ],
        ),
      ),
    );
  }

  void _handleMenuAction(CompanionMenuAction action) {
    switch (action) {
      case CompanionMenuAction.reset:
        _showResetConfirmDialog();
      case CompanionMenuAction.report:
        context.push('/feedback?topic=companion');
    }
  }

  void _showResetConfirmDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('恢复默认设置'),
        content: const Text(
          '将重置性格、外观和互动偏好为默认值。\n'
          '伙伴等级、亲密度和记忆不会被重置。\n\n'
          '确定要继续吗？',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('取消')),
          TextButton(
            onPressed: () async {
              Navigator.pop(context);
              await ref.read(companionViewModelProvider.notifier).resetConfig();
              if (mounted) {
                PrimeTopToast.show(context, message: '已恢复默认设置');
              }
            },
            child: const Text('确定'),
          ),
        ],
      ),
    );
  }
}

enum CompanionMenuAction { reset, report }
```

### 5.2 角色选择 Tab (CharacterSelectTab)

#### 5.2.1 交互流程

```
用户进入角色选择 Tab
        │
        ▼
  ┌─────────────────┐     失败    ┌──────────────┐
  │ 加载角色列表API  │─────────────│ 显示重试按钮  │
  └────────┬────────┘             └──────────────┘
           │ 成功
           ▼
  ┌─────────────────────────────────────┐
  │  水平滑动卡片列表                     │
  │  ┌────┐ ┌────┐ ┌────┐ ┌────┐        │
  │  │小启 │ │严师 │ │学霸猫│ │🔒学长│     │
  │  │(当前)│ │    │ │    │ │     │     │
  │  └────┘ └────┘ └────┘ └────┘        │
  └─────────────────────────────────────┘
           │ 点击卡片
           ▼
  ┌─────────────────────────────────────┐
  │  角色详情弹窗                         │
  │  ┌─────────────────────────────────┐ │
  │  │    [大头像]                     │ │
  │  │    名字: 学霸猫                  │ │
  │  │    标签: [活泼] [幽默] [好奇]    │ │
  │  │    描述: 活泼好动的猫咪伙伴...   │ │
  │  │    预览对话: "喵~！..."          │ │
  │  │    适用学段: 幼儿~小学           │ │
  │  │                                 │ │
  │  │    [取消]      [切换到此角色]   │ │
  │  └─────────────────────────────────┘ │
  └─────────────────────────────────────┘
           │ 确认切换
           ▼
  ┌─────────────────────────────────────┐
  │  调用切换API                         │
  │  显示切换动画 (旧头像 → 新头像)      │
  │  更新所有依赖伙伴形象的页面          │
  └─────────────────────────────────────┘
```

#### 5.2.2 核心代码 - 角色卡片

```dart
class CharacterCard extends StatelessWidget {
  final CharacterTemplate character;
  final bool isCurrent;
  final bool isLocked;
  final VoidCallback onTap;

  const CharacterCard({
    super.key,
    required this.character,
    required this.isCurrent,
    required this.isLocked,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return GestureDetector(
      onTap: isLocked ? null : onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        width: 140,
        margin: const EdgeInsets.symmetric(horizontal: 6),
        decoration: BoxDecoration(
          color: isCurrent
              ? Color(int.parse(character.themeColor.replaceAll('#', '0xFF')))
              : theme.colorScheme.surface,
          borderRadius: BorderRadius.circular(16),
          border: isCurrent
              ? Border.all(color: theme.colorScheme.primary, width: 2)
              : null,
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.08),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Stack(
          children: [
            Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                // 头像
                Container(
                  width: 72,
                  height: 72,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: isLocked ? Colors.grey.shade300 : null,
                  ),
                  child: isLocked
                      ? const Icon(Icons.lock, size: 32, color: Colors.grey)
                      : CachedNetworkImage(
                          imageUrl: character.avatarUrl,
                          placeholder: (_, __) => const CircularProgressIndicator(),
                          errorWidget: (_, __, ___) => const Icon(Icons.person, size: 36),
                        ),
                ),
                const SizedBox(height: 8),
                // 名字
                Text(
                  character.name,
                  style: theme.textTheme.titleSmall?.copyWith(
                    color: isCurrent ? Colors.white : null,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 4),
                // 标签
                Wrap(
                  spacing: 4,
                  runSpacing: 4,
                  children: character.personalityTags
                      .take(2)
                      .map((tag) => _buildTag(tag, isCurrent, theme))
                      .toList(),
                ),
              ],
            ),
            // 当前选择标记
            if (isCurrent)
              Positioned(
                top: 8,
                right: 8,
                child: Container(
                  padding: const EdgeInsets.all(4),
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(Icons.check, size: 16, color: theme.colorScheme.primary),
                ),
              ),
            // 锁定标记条件
            if (isLocked)
              Positioned(
                bottom: 8,
                left: 0,
                right: 0,
                child: Text(
                  character.unlockCondition ?? '',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: Colors.grey,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildTag(String tag, bool isCurrent, ThemeData theme) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: isCurrent
            ? Colors.white.withOpacity(0.2)
            : theme.colorScheme.primaryContainer.withOpacity(0.3),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        tag,
        style: theme.textTheme.labelSmall?.copyWith(
          color: isCurrent ? Colors.white : null,
        ),
      ),
    );
  }
}
```

### 5.3 性格调节 Tab (PersonalityTuningTab)

#### 5.3.1 页面布局

```
┌──────────────────────────────────────────────┐
│  性格调节                                     │
│                                              │
│  调节伙伴的性格，让辅导更贴合你的学习风格      │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ 📐 辅导严格度                          │  │
│  │ 宽容 ●━━━━━━━━━━○━━━━ 严格             │  │
│  │ 当前: 适中偏宽容                       │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ 💪 鼓励频率                            │  │
│  │ 偶尔 ●━━━━━━━━━━━━━━○━━━ 非常频繁      │  │
│  │ 当前: 高频鼓励                          │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ 😄 幽默感                              │  │
│  │ 严肃 ●━━━━○━━━━━━━━━━━━ 活泼            │  │
│  │ 当前: 偏严肃                            │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ 📝 讲解详细度                          │  │
│  │ 精简 ●━━━━━━━━━━━━○━━━━ 非常详细       │  │
│  │ 当前: 详细                              │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ 💡 启发式引导                          │  │
│  │ 直接 ●━━━━━━━━━━○━━━━━ 引导思考        │  │
│  │ 当前: 适中                              │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  💬 预览效果                            │  │
│  │  "这道题我们可以先看看已知条件..."     │  │
│  │                          [换一条预览]   │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

#### 5.3.2 核心代码 - 性格滑块组件

```dart
class PersonalitySlider extends StatelessWidget {
  final String title;
  final String icon;
  final String leftLabel;
  final String rightLabel;
  final double value; // 0.0 ~ 1.0
  final String description;
  final ValueChanged<double> onChanged;

  const PersonalitySlider({
    super.key,
    required this.title,
    required this.icon,
    required this.leftLabel,
    required this.rightLabel,
    required this.value,
    required this.description,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 6,
            offset: const Offset(0, 1),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(icon, style: const TextStyle(fontSize: 20)),
              const SizedBox(width: 8),
              Text(title, style: theme.textTheme.titleMedium),
            ],
          ),
          const SizedBox(height: 12),
          // 滑块
          Row(
            children: [
              Text(leftLabel, style: theme.textTheme.bodySmall),
              Expanded(
                child: SliderTheme(
                  data: SliderTheme.of(context).copyWith(
                    activeTrackColor: theme.colorScheme.primary,
                    inactiveTrackColor: theme.colorScheme.outlineVariant,
                    thumbColor: theme.colorScheme.primary,
                    overlayColor: theme.colorScheme.primary.withOpacity(0.12),
                    trackHeight: 6,
                  ),
                  child: Slider(
                    value: value,
                    min: 0.0,
                    max: 1.0,
                    divisions: 10, // 0.1 精度
                    onChanged: onChanged,
                  ),
                ),
              ),
              Text(rightLabel, style: theme.textTheme.bodySmall),
            ],
          ),
          const SizedBox(height: 4),
          // 当前描述
          Text(
            description,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

/// 根据滑块值生成描述文案
String personalityDescription(String dimension, double value) {
  String level;
  if (value < 0.2) level = '极低';
  else if (value < 0.4) level = '偏低';
  else if (value < 0.6) level = '适中';
  else if (value < 0.8) level = '偏高';
  else level = '极高';

  switch (dimension) {
    case 'strictness':
      if (value < 0.3) return '当前: 非常宽容，以鼓励为主';
      if (value < 0.5) return '当前: 适中偏宽容';
      if (value < 0.7) return '当前: 适中，会指出问题但不批评';
      return '当前: 严格，会认真指出每个错误';
    case 'encouragement':
      return '当前: ${level}鼓励频率';
    case 'humor':
      if (value < 0.3) return '当前: 严肃正式的学术风格';
      if (value < 0.5) return '当前: 偏严肃';
      if (value < 0.7) return '当前: 适中，偶尔开个玩笑';
      return '当前: 非常活泼幽默';
    case 'verbosity':
      if (value < 0.3) return '当前: 精简直接，直击要点';
      if (value < 0.5) return '当前: 偏精简';
      if (value < 0.7) return '当前: 适中详细';
      return '当前: 非常详细，不遗漏任何步骤';
    case 'heuristics':
      if (value < 0.3) return '当前: 偏向直接讲解';
      if (value < 0.5) return '当前: 适中，讲解为主';
      if (value < 0.7) return '当前: 适中偏启发';
      return '当前: 强启发式，引导自主思考';
    default:
      return '当前: $level';
  }
}
```

#### 5.3.3 性格调节防抖保存

```dart
class PersonalityTuningTab extends ConsumerStatefulWidget {
  final CompanionProfile profile;
  const PersonalityTuningTab({super.key, required this.profile});

  @override
  ConsumerState<PersonalityTuningTab> createState() =>
      _PersonalityTuningTabState();
}

class _PersonalityTuningTabState extends ConsumerState<PersonalityTuningTab> {
  late PersonalityDimensions _dimensions;
  Timer? _debounceTimer;
  Timer? _previewTimer;

  @override
  void initState() {
    super.initState();
    _dimensions = widget.profile.personality;
  }

  @override
  void dispose() {
    _debounceTimer?.cancel();
    _previewTimer?.cancel();
    super.dispose();
  }

  void _onDimensionChanged(String key, double value) {
    setState(() {
      _dimensions = _dimensions.copyWith(
        strictness: key == 'strictness' ? value : _dimensions.strictness,
        encouragement: key == 'encouragement' ? value : _dimensions.encouragement,
        humor: key == 'humor' ? value : _dimensions.humor,
        verbosity: key == 'verbosity' ? value : _dimensions.verbosity,
        heuristics: key == 'heuristics' ? value : _dimensions.heuristics,
      );
    });

    // 防抖保存: 停止操作 1.5 秒后自动保存
    _debounceTimer?.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 1500), () {
      _savePersonality();
    });

    // 防抖更新预览: 停止操作 1 秒后刷新预览
    _previewTimer?.cancel();
    _previewTimer = Timer(const Duration(milliseconds: 1000), () {
      ref.read(companionPreviewProvider.notifier).refreshPreview(
        personality: _dimensions,
        gradeLevel: widget.profile.character.minGradeLevel,
      );
    });
  }

  Future<void> _savePersonality() async {
    try {
      await ref.read(companionViewModelProvider.notifier).updateConfig(
        personality: _dimensions,
      );
      // 静默保存成功，不需要 toast
    } catch (e) {
      if (mounted) {
        PrimeTopToast.show(context, message: '保存失败，请稍后重试', type: ToastType.error);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '调节伙伴的性格，让辅导更贴合你的学习风格',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 16),
          PersonalitySlider(
            title: '辅导严格度',
            icon: '📐',
            leftLabel: '宽容',
            rightLabel: '严格',
            value: _dimensions.strictness,
            description: personalityDescription('strictness', _dimensions.strictness),
            onChanged: (v) => _onDimensionChanged('strictness', v),
          ),
          PersonalitySlider(
            title: '鼓励频率',
            icon: '💪',
            leftLabel: '偶尔',
            rightLabel: '非常频繁',
            value: _dimensions.encouragement,
            description: personalityDescription('encouragement', _dimensions.encouragement),
            onChanged: (v) => _onDimensionChanged('encouragement', v),
          ),
          PersonalitySlider(
            title: '幽默感',
            icon: '😄',
            leftLabel: '严肃',
            rightLabel: '活泼',
            value: _dimensions.humor,
            description: personalityDescription('humor', _dimensions.humor),
            onChanged: (v) => _onDimensionChanged('humor', v),
          ),
          PersonalitySlider(
            title: '讲解详细度',
            icon: '📝',
            leftLabel: '精简',
            rightLabel: '非常详细',
            value: _dimensions.verbosity,
            description: personalityDescription('verbosity', _dimensions.verbosity),
            onChanged: (v) => _onDimensionChanged('verbosity', v),
          ),
          PersonalitySlider(
            title: '启发式引导',
            icon: '💡',
            leftLabel: '直接',
            rightLabel: '引导思考',
            value: _dimensions.heuristics,
            description: personalityDescription('heuristics', _dimensions.heuristics),
            onChanged: (v) => _onDimensionChanged('heuristics', v),
          ),
          const SizedBox(height: 16),
          // 预览区
          PersonalityPreviewCard(dimensions: _dimensions),
        ],
      ),
    );
  }
}
```

### 5.4 外观定制 Tab (AppearanceCustomTab)

#### 5.4.1 交互设计

```
┌──────────────────────────────────────────────┐
│  外观定制                                     │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  头像选择                               │  │
│  │  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐             │  │
│  │  │😊│ │🐱│ │🦊│ │🐼│ │🔒│             │  │
│  │  └──┘ └──┘ └──┘ └──┘ └──┘             │  │
│  │  当前选择: 😊                           │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  主题色                                 │  │
│  │  ●  ●  ●  ●  ●  ●  ●                  │  │
│  │  蓝  紫  绿  橙  粉  青  深蓝            │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  聊天气泡风格                           │  │
│  │  ┌──────┐  ┌──────┐  ┌──────┐          │  │
│  │  │圆角   │  │方形   │  │漫画风 │          │  │
│  │  │(当前) │  │      │  │      │          │  │
│  │  └──────┘  └──────┘  └──────┘          │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  伙伴对你的称呼                         │  │
│  │  ┌────────────────────────────┐        │  │
│  │  │ 小明                        │        │  │
│  │  └────────────────────────────┘        │  │
│  │  💡 伙伴在对话中会用这个称呼叫你        │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  伙伴昵称                               │  │
│  │  ┌────────────────────────────┐        │  │
│  │  │ 小启                        │        │  │
│  │  └────────────────────────────┘        │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

### 5.5 互动偏好 Tab (InteractionPrefsTab)

#### 5.5.1 交互设计

```
┌──────────────────────────────────────────────┐
│  互动偏好                                     │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ 🔔 主动提醒                             │  │
│  │ 伙伴会主动给你发学习建议和提醒           │  │
│  │                              [开关 ON] │  │
│  │                                         │  │
│  │   提醒频率                              │  │
│  │   ○ 极少 (每天最多1次)                  │  │
│  │   ● 适中 (每天最多3次)                  │  │
│  │   ○ 活跃 (每天最多5次)                  │  │
│  │   ○ 热情 (每天最多8次)                  │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ 🌅 早晨问候                             │  │
│  │ 每天早上伙伴会给你打招呼                │  │
│  │                              [开关 ON] │  │
│  │   问候时段: 07:00 - 09:00  [修改]       │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ 🌙 晚间总结                             │  │
│  │ 每天晚上伙伴会总结今天的学习             │  │
│  │                              [开关 OFF]│  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ 🔊 语音回复                             │  │
│  │ 伙伴的回复可以朗读出来                  │  │
│  │                              [开关 OFF]│  │
│  │                                         │  │
│  │   语速                                  │  │
│  │   ○ 慢速   ● 正常   ○ 快速              │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ 😀 回复中使用表情                       │  │
│  │                              [开关 ON] │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

### 5.6 关系与记忆 Tab (RelationMemoryTab)

#### 5.6.1 关系概览区域

```
┌──────────────────────────────────────────────┐
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │     [伙伴大头像]                       │  │
│  │                                        │  │
│  │     小启  Lv.5                          │  │
│  │                                        │  │
│  │     经验: 340 / 500                    │  │
│  │     ████████████░░░░░░░░ 68%          │  │
│  │                                        │  │
│  │     亲密度: 72.5 / 100                 │  │
│  │     ██████████████░░░░░░░░░            │  │
│  │                                        │  │
│  │  ┌──────┬──────┬──────┐               │  │
│  │  │ 156  │ 28天  │ 12个  │               │  │
│  │  │总互动 │陪伴日 │里程碑  │               │  │
│  │  └──────┴──────┴──────┘               │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  🏆 里程碑成就                               │
│  ┌────────────────────────────────────────┐  │
│  │ ✅ 初次见面    ┃ ✅ 一周伙伴  ┃ ✅ 百题里程碑│
│  │ 📅 6月1日     ┃ 📅 6月8日   ┃ 📅 6月20日 │
│  ├────────────────────────────────────────┤  │
│  │ 🔒 十级达成   ┃ 🔒 月度全勤 ┃ 🔒 默契搭档  │
│  │ Lv.10解锁     ┃ 连续30天   ┃ 亲密度≥90   │
│  └────────────────────────────────────────┘  │
│                                              │
│  ── 分隔线 ──                                │
│                                              │
│  🧠 伙伴的记忆                               │
│  ┌────────────────────────────────────────┐  │
│  │ 📌 [偏好] 喜欢用画图的方式理解数学概念   │  │
│  │          来源: 智能推断  置信度: 85%     │  │
│  │                              [编辑] [×] │  │
│  ├────────────────────────────────────────┤  │
│  │ 🎯 [目标] 期末考试数学达到90分以上       │  │
│  │          来源: 对话记录  置信度: 95%     │  │
│  │                              [编辑] [×] │  │
│  ├────────────────────────────────────────┤  │
│  │ ⏰ [习惯] 晚8-10点学习，偏好安静环境     │  │
│  │          来源: 智能推断  置信度: 72%     │  │
│  │                              [编辑] [×] │  │
│  └────────────────────────────────────────┘  │
│  [查看全部记忆 →]                            │
└──────────────────────────────────────────────┘
```

#### 5.6.2 记忆管理交互

```dart
class MemoryItemTile extends StatelessWidget {
  final CompanionMemoryItem memory;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const MemoryItemTile({
    super.key,
    required this.memory,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    return Dismissible(
      key: ValueKey(memory.memoryId),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        color: Colors.red,
        child: const Icon(Icons.delete, color: Colors.white),
      ),
      confirmDismiss: (_) async {
        return await showDialog(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('删除记忆'),
            content: Text('伙伴将不再记住：「${memory.content}」\n\n确定删除吗？'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('取消')),
              TextButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('删除', style: TextStyle(color: Colors.red)),
              ),
            ],
          ),
        );
      },
      onDismissed: (_) => onDelete(),
      child: Card(
        margin: const EdgeInsets.only(bottom: 8),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildCategoryIcon(memory.category),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(memory.content, style: Theme.of(context).textTheme.bodyMedium),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Text(
                          _sourceLabel(memory.source),
                          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                color: Theme.of(context).colorScheme.onSurfaceVariant,
                              ),
                        ),
                        const SizedBox(width: 8),
                        // 低置信度推断记忆标橙，提示"可能不准"，引导用户核对
                        Text(
                          '置信度: ${memory.confidence}%',
                          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                color: memory.confidence >= 70
                                    ? Theme.of(context).colorScheme.onSurfaceVariant
                                    : Colors.orange.shade700,
                              ),
                        ),
                        const Spacer(),
                        // 仅 userEditable=true 的记忆允许编辑/删除 (合规 C1)
                        if (memory.userEditable) ...[
                          _buildActionButton(Icons.edit_outlined, onEdit),
                          _buildActionButton(Icons.delete_outline, onDelete),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildActionButton(IconData icon, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.all(6),
        child: Icon(icon, size: 18, color: Theme.of(context).colorScheme.outline),
      ),
    );
  }

  Widget _buildCategoryIcon(String category) {
    final (icon, label) = switch (category) {
      'preference' => ('📌', '偏好'),
      'goal'       => ('🎯', '目标'),
      'habit'      => ('⏰', '习惯'),
      'event'      => ('📅', '事件'),
      'person'     => ('👤', '人物'),
      _            => ('💭', '其他'),
    };
    return Column(
      children: [
        Text(icon, style: const TextStyle(fontSize: 20)),
        const SizedBox(height: 2),
        Text(label, style: Theme.of(context).textTheme.labelSmall),
      ],
    );
  }

  String _sourceLabel(String source) {
    return switch (source) {
      'dialogue' => '来源: 对话记录',
      'survey'   => '来源: 问卷设置',
      'inferred' => '来源: 智能推断',
      _          => '来源: $source',
    };
  }
}
```

#### 5.6.3 记忆编辑弹窗 (MemoryEditDialog)

```dart
class MemoryEditDialog extends StatefulWidget {
  final CompanionMemoryItem memory;
  final Future<String?> Function(String newContent) onSubmit; // 返回错误信息, null=成功

  const MemoryEditDialog({super.key, required this.memory, required this.onSubmit});

  @override
  State<MemoryEditDialog> createState() => _MemoryEditDialogState();
}

class _MemoryEditDialogState extends State<MemoryEditDialog> {
  late final TextEditingController _controller;
  bool _submitting = false;
  String? _errorText;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.memory.content);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  /// 客户端预校验 (合规 C9): 长度 2-100, 本地敏感词快检, 正式拦截以服务端为准
  String? _validate(String value) {
    final trimmed = value.trim();
    if (trimmed.length < 2) return '内容太短啦，至少 2 个字';
    if (trimmed.length > 100) return '内容过长，最多 100 字';
    if (SensitiveWordChecker.instance.quickCheck(trimmed)) return '内容包含不适宜词汇，请修改';
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('修改记忆'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '修改后，伙伴会按新内容来了解你。',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _controller,
            maxLength: 100,
            minLines: 2,
            maxLines: 4,
            enabled: widget.memory.userEditable && !_submitting,
            decoration: InputDecoration(
              border: const OutlineInputBorder(),
              errorText: _errorText,
              counterText: '',
            ),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: _submitting ? null : () => Navigator.pop(context), child: const Text('取消')),
        FilledButton(
          onPressed: _submitting ? null : _submit,
          child: _submitting
              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('保存'),
        ),
      ],
    );
  }

  Future<void> _submit() async {
    final error = _validate(_controller.text);
    if (error != null) {
      setState(() => _errorText = error);
      return;
    }
    setState(() {
      _submitting = true;
      _errorText = null;
    });
    final serverError = await widget.onSubmit(_controller.text.trim());
    if (!mounted) return;
    if (serverError == null) {
      Navigator.pop(context, true);
    } else {
      setState(() {
        _submitting = false;
        _errorText = serverError;
      });
    }
  }
}
```

#### 5.6.4 全部记忆列表页 (CompanionMemoryListPage)

关系与记忆 Tab 内「查看全部记忆 →」进入独立页面，支持分类筛选与分页加载：

```dart
class CompanionMemoryListPage extends ConsumerStatefulWidget {
  const CompanionMemoryListPage({super.key});

  @override
  ConsumerState<CompanionMemoryListPage> createState() => _CompanionMemoryListPageState();
}

class _CompanionMemoryListPageState extends ConsumerState<CompanionMemoryListPage> {
  String? _activeCategory; // null = 全部
  final ScrollController _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    // 滚动至底部 200px 内触发加载下一页
    _scrollController.addListener(() {
      if (_scrollController.position.pixels >=
          _scrollController.position.maxScrollExtent - 200) {
        ref.read(companionMemoriesProvider(_activeCategory).notifier).loadNextPage();
      }
    });
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _onDelete(CompanionMemoryItem memory) async {
    // 乐观移除 + 本地墓碑标记; 离线时进入同步队列 (见 §7)
    await ref.read(companionViewModelProvider.notifier).deleteMemory(memory);
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(companionMemoriesProvider(_activeCategory));

    return Scaffold(
      appBar: PrimeTopAppBar(title: '伙伴的记忆'),
      body: Column(
        children: [
          // 分类筛选 Chip 行
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: [
                _buildChip('全部', null),
                _buildChip('📌 偏好', 'preference'),
                _buildChip('🎯 目标', 'goal'),
                _buildChip('⏰ 习惯', 'habit'),
                _buildChip('📅 事件', 'event'),
                _buildChip('👤 人物', 'person'),
              ],
            ),
          ),
          if (state.hasPendingSync)
            const SyncPendingBanner(message: '部分修改尚未同步，联网后自动上传'),
          Expanded(
            child: state.memories.isEmpty && !state.isLoading
                ? EmptyStateView(
                    icon: '🧠',
                    title: '伙伴还没有记住什么',
                    subtitle: '多和伙伴聊聊你的学习习惯和目标吧',
                  )
                : ListView.builder(
                    controller: _scrollController,
                    itemCount: state.memories.length + (state.hasMore ? 1 : 0),
                    itemBuilder: (context, index) {
                      if (index >= state.memories.length) {
                        return const Padding(
                          padding: EdgeInsets.all(16),
                          child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
                        );
                      }
                      final memory = state.memories[index];
                      return MemoryItemTile(
                        memory: memory,
                        onEdit: () => _showEditDialog(memory),
                        onDelete: () => _onDelete(memory),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildChip(String label, String? value) {
    final selected = _activeCategory == value;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: FilterChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) => setState(() {
          _activeCategory = value;
          ref.read(companionMemoriesProvider(value).notifier).reload();
        }),
      ),
    );
  }

  void _showEditDialog(CompanionMemoryItem memory) {
    showDialog(
      context: context,
      builder: (context) => MemoryEditDialog(
        memory: memory,
        onSubmit: (newContent) => ref
            .read(companionViewModelProvider.notifier)
            .updateMemory(memory, newContent),
      ),
    );
  }
}
```

> 分类筛选切换时按 `companionMemoriesProvider(category)` family 重建，避免分类间列表状态串页；页大小 20，与接口 `pageSize` 上限一致。

### 5.7 底部预览区 (CompanionPreviewBar)

预览区常驻主页底部，是"即时预览"设计原则的核心载体。性格/外观/互动偏好任意调整后，预览文案随之刷新：

```dart
class CompanionPreviewBar extends ConsumerWidget {
  final CompanionProfile profile;
  const CompanionPreviewBar({super.key, required this.profile});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final previewState = ref.watch(companionPreviewProvider);

    return Container(
      margin: const EdgeInsets.fromLTRB(12, 4, 12, 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.secondaryContainer,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          // 伙伴头像 (随外观定制实时变化)
          CircleAvatar(
            radius: 20,
            backgroundColor: Color(int.parse(
              profile.appearance.themeColor.replaceAll('#', '0xFF'),
            )),
            child: CompanionAvatarWidget(avatarId: profile.appearance.avatarId, size: 32),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('预览效果', style: theme.textTheme.labelSmall),
                const SizedBox(height: 2),
                _buildPreviewText(context, previewState),
              ],
            ),
          ),
          TextButton.icon(
            onPressed: previewState.isStreaming ? null : () => _refresh(context, ref),
            icon: const Icon(Icons.refresh, size: 16),
            label: const Text('换一条'),
          ),
        ],
      ),
    );
  }

  Widget _buildPreviewText(BuildContext context, PreviewState state) {
    if (state.isStreaming) {
      // 流式逐字渲染, 打字机效果
      return StreamingText(
        text: state.buffer,
        caretShow: true,
        style: Theme.of(context).textTheme.bodyMedium,
      );
    }
    if (state.error != null) {
      // 降级 D2: 展示角色预设静态预览文案, 不暴露错误给低龄用户
      return Text(
        state.fallbackText,
        style: Theme.of(context).textTheme.bodyMedium,
      );
    }
    return Text(state.text, style: Theme.of(context).textTheme.bodyMedium);
  }

  void _refresh(BuildContext context, WidgetRef ref) {
    final profile = ref.read(companionProfileProvider).value;
    if (profile == null) return;
    // 42901 节流: 客户端本地 3s 冷却, 与服务端限流对齐
    if (!PreviewThrottler.instance.tryAcquire()) {
      PrimeTopToast.show(context, message: '稍等一下再试~', type: ToastType.info);
      return;
    }
    ref.read(companionPreviewProvider.notifier).refresh(
      personality: profile.personality,
      gradeLevel: profile.character.minGradeLevel,
    );
  }
}
```

预览请求链路关键规则：

1. **缓存键**：`preview:{characterId}:{五维性格值哈希}:{gradeLevel}`，相同配置 10 分钟内直接命中本地缓存（Isar `CompanionCacheEntity`），不消耗服务端预览额度；
2. **SSE 消费**：`token` 事件追加到 buffer 触发打字机渲染，`done` 事件结束流；断流按 D2 降级为静态预设文案（每角色 3 条内置文案，随包发布）；
3. **防抖**：滑块拖动期间由 §5.3.3 的 `_previewTimer`（1s 防抖）触发，避免拖动过程中频繁请求；
4. **不计费**：预览走独立的轻量预览额度（服务端每用户每日 50 次），不占用学生 AI 辅导对话额度（见 §13 契约对齐第 9 项）。

---

## 6. 状态管理与数据流

### 6.1 Provider 架构 (Riverpod)

§5 中引用的全部 Provider 在此定义。采用 Riverpod 2.x AsyncNotifier，本地优先（local-first）：

```dart
/// 手写 Provider 声明 (避免与 §3.1 数据模型 CompanionProfile 类名冲突)
final companionProfileProvider =
    AsyncNotifierProvider<CompanionProfileNotifier, CompanionProfile>(
      CompanionProfileNotifier.new,
    );

class CompanionProfileNotifier extends AsyncNotifier<CompanionProfile> {
  @override
  Future<CompanionProfile> build() async {
    // 1. 先读本地 (离线可用, 见 D1)
    final local = await CompanionLocalRepo.instance.loadProfile();
    if (local != null) {
      // 2. 本地有值: 先返回渲染, 再静默刷新
      ref.read(companionSyncServiceProvider).refreshInBackground();
      return local;
    }
    // 3. 本地无值: 首次联网拉取 (40401 → 引导角色选择流程)
    return ref.read(companionViewModelProvider.notifier).fetchRemote();
  }
}

/// 角色列表 Provider: 24h 本地缓存, 失败回退缓存列表 (D3)
@riverpod
class CompanionCharacters extends AsyncNotifier<List<CharacterTemplate>> {
  @override
  Future<List<CharacterTemplate>> build() async {
    final cache = await CompanionLocalRepo.instance.loadCache('characters_list');
    if (cache != null && !cache.isExpired) return cache.characters;
    return ref.read(companionViewModelProvider.notifier).fetchCharacters();
  }
}

/// 记忆列表 Provider: family(category) 分分类分页, 墓碑过滤在 notify 前
@riverpod
class CompanionMemories extends FamilyNotifier<String?, MemoriesState> {
  @override
  MemoriesState build(String? category) => MemoriesState.initial(category);

  Future<void> reload() { /* 重置到第 1 页 */ }
  Future<void> loadNextPage() { /* hasMore 才请求 page+1 */ }
  void applyLocalMutation(MemoryMutation mutation) { /* 乐观更新 + hasPendingSync=true */ }
}

/// 预览 Provider: SSE 流式状态机 idle→streaming→done|error
@riverpod
class CompanionPreview extends Notifier<PreviewState> {
  @override
  PreviewState build() => const PreviewState.initial();

  Future<void> refresh({required PersonalityDimensions personality, required int gradeLevel}) async {
    final cacheKey = 'preview:${personality.hash}:$gradeLevel';
    final cached = await CompanionLocalRepo.instance.loadCache(cacheKey);
    if (cached != null) {
      state = PreviewState.done(cached.text);
      return;
    }
    state = const PreviewState.streaming();
    // SSE 消费, token → buffer 追加, done → 写入缓存(10min TTL)
  }
}
```

### 6.2 ViewModel 与写操作幂等

```dart
class CompanionViewModel extends Notifier<CompanionViewState> {
  /// 配置更新 (性格/外观/互动偏好/昵称/称呼)
  /// 幂等: 请求体带 baseVersion; 服务端冲突返回 40901
  Future<bool> updateConfig({PersonalityDimensions? personality, AppearanceConfig? appearance,
      InteractionPreferences? interaction, String? nickName, String? userAlias}) async {
    final profile = ref.read(companionProfileProvider).value!;
    // 乐观写本地 (isDirty=true)
    await CompanionLocalRepo.instance.saveProfile(
      profile.copyWith(...), markDirty: true,
    );
    try {
      final resp = await companionApi.updateProfile(
        baseVersion: profile.version,
        patch: buildPatch(...),
      );
      await CompanionLocalRepo.instance.saveProfile(
        profile.copyWith(version: resp.version), markDirty: false,
      );
      return true;
    } on VersionConflictException catch (e) {
      // 40901 → §6.3 冲突合并流程
      return _resolveConflict(e.serverProfile, localIntention: buildPatch(...));
    } on DioException {
      // 网络失败: 保持 isDirty, 进入同步队列 (§7), 不打断用户
      return false;
    }
  }

  /// 切换角色: 强制在线操作 (见 D4), 幂等由服务端 companion 唯一约束保证
  Future<CharacterSwitchResult> switchCharacter(String characterId) async {
    final online = await ConnectivityService.instance.isOnline();
    if (!online) {
      return CharacterSwitchResult.offline();
    }
    try {
      final data = await companionApi.switchCharacter(characterId);
      await CompanionLocalRepo.instance.replaceProfile(CompanionProfile.fromSwitch(data));
      // 广播角色切换事件: AI对话页头像/首页问候卡/桌面小组件同步刷新
      EventBus.instance.fire(CompanionCharacterChangedEvent(data));
      return CharacterSwitchResult.success(data);
    } on ApiException catch (e) {
      return CharacterSwitchResult.failure(e.code, e.message); // 40301 → 展示解锁条件
    }
  }
}
```

### 6.3 配置版本冲突处理 (40901)

多端同时修改配置（如手机调了性格、平板换了头像）时触发。处理原则——**分域裁决，不让用户重填**：

| 字段域 | 裁决方 | 理由 |
|--------|--------|------|
| `relation` / `version` / 元数据 | 服务端胜 | 关系数据服务端权威，客户端只读 (合规 C12 关联) |
| `personality` / `appearance` / `interaction` / 昵称 / 称呼 | 本端意图胜 | 用户刚刚的操作优先，字段级覆盖 |
| 记忆条目 | 双向合并 | 删除以墓碑为准，编辑以时间新者为准（§7.3） |

```dart
Future<bool> _resolveConflict(CompanionProfile server, Map<String, dynamic> localIntention) async {
  // 1. 以服务端数据为基底 (relation/version 元数据对齐)
  var merged = server;
  // 2. 本端意图字段级覆盖
  merged = merged.applyPatch(localIntention);
  // 3. 本地落地 + 携带新 baseVersion 重试一次
  await CompanionLocalRepo.instance.saveProfile(merged, markDirty: true);
  final retried = await companionApi.updateProfile(
    baseVersion: server.version, patch: localIntention,
  );
  await CompanionLocalRepo.instance.saveProfile(
    merged.copyWith(version: retried.version), markDirty: false,
  );
  return true;
}
```

> 重试仅一次；再次冲突则放弃自动合并，提示「配置在其他设备已修改，已为你保留最新设置」并以服务端数据为准（防冲突风暴）。

### 6.4 数据流总览

```
┌──────────┐   读    ┌───────────┐  未命中   ┌──────────┐
│   UI     │────────▶│  Isar 本地 │─────────▶│  服务端   │
│ (5 Tab)  │◀────────│  (缓存层)  │◀─────────│  BFF API │
└────┬─────┘  先渲染  └───────────┘  后台刷新  └──────────┘
     │ 写(乐观)
     ▼
┌────────────────┐  成功   isDirty=false
│ 本地落地+墓碑队列 │────────▶ 同步完成
│ isDirty=true    │ 失败/离线 → 前台/网络恢复时批量补推 (§7)
└────────────────┘
```

---

## 7. 离线与同步策略

### 7.1 可用性分级

| 操作 | 离线可用 | 说明 |
|------|:---:|------|
| 查看配置/角色/关系/记忆 | ✅ | 全量走 Isar 缓存 |
| 性格/外观/互动偏好修改 | ✅ | 乐观写本地，联网补推 |
| 记忆编辑/删除 | ✅ | 墓碑/变更队列补推 |
| 切换角色 | ❌ (D4) | 涉及服务端默认性格重置，必须在线 |
| 对话预览 (新请求) | ❌ (D2) | 降级为内置静态预设文案 |
| 重置配置 | ❌ | 在线操作，防离线重置与服务端状态漂移 |
| 恢复默认设置 | ❌ | 同上 |

### 7.2 同步服务

```dart
class CompanionSyncService {
  /// 触发时机: App 前台恢复 / 网络恢复 / 页面进入 / 手动下拉刷新
  Future<void> syncNow() async {
    if (_syncing) return; // 单飞
    _syncing = true;
    try {
      // 1. 推送脏配置 (含 baseVersion, 40901 走 §6.3 合并)
      final dirty = await CompanionLocalRepo.instance.loadDirtyProfile();
      if (dirty != null) {
        await _pushProfile(dirty);
      }
      // 2. 推送记忆变更队列 (编辑+删除, 每批 ≤20 条)
      final mutations = await CompanionLocalRepo.instance.dequeueMemoryMutations(limit: 20);
      for (final m in mutations) {
        final ok = await _pushMemoryMutation(m);
        if (!ok) {
          await CompanionLocalRepo.instance.requeue(m); // 失败回队, 指数退避
          break; // 首条失败即停批, 保序推送
        }
      }
      // 3. 拉取服务端最新 (增量: updatedAt 水位)
      await ref.read(companionViewModelProvider.notifier).refreshRemoteIncremental();
    } finally {
      _syncing = false;
    }
  }
}
```

同步状态机：`idle → syncing → (conflict | pending | idle)`；`pending`（有未推送变更）在 UI 上以 `SyncPendingBanner` 呈现（见 §5.6.4），不弹模态打扰。

### 7.3 记忆变更队列与墓碑

```dart
/// 记忆变更记录 (Isar: CompanionMemoryMutationEntity)
sealed class MemoryMutation {
  String get mutationId;   // UUID, 客户端生成, 服务端幂等键
  String get memoryId;
}
class MemoryEdit extends MemoryMutation {  // payload: newContent
  String get mutationId; String get memoryId; String get newContent;
}
class MemoryDelete extends MemoryMutation { // 服务端 DELETE 幂等: 重复删除返回 404 视为成功
  String get mutationId; String get memoryId;
}
```

- **幂等**：编辑以 `mutationId` 为幂等键（服务端 `companion_memory_edit_log` 去重）；删除重复推送返回 40404 时按成功处理（目标态已达成）；
- **保序**：同一 memoryId 的变更严格按队列顺序推送，后进不对先进造成覆盖乱序；
- **服务端新建记忆的下行**：增量拉取时新增记忆按 `recordedAt` 归并进本地列表，已在本地以相同 `memoryId` 存在则跳过（服务端权威字段覆盖）。

---

## 8. 分龄适配设计

### 8.1 学段 × 能力矩阵

| 能力 | 幼儿 (0) | 小学 (1) | 初中 (2) | 高中 (3) |
|------|:---:|:---:|:---:|:---:|
| 可见 Tab | 角色 + 互动(受限) | 全部 5 Tab | 全部 5 Tab | 全部 5 Tab |
| 角色池 | 小熊/小兔/小恐龙 3 选 1 (E2E 对齐) | 全学段角色 | 初高中角色 | 初高中角色 |
| 性格滑块 | 隐藏 (家长代设) | 3 维 (严格度/鼓励/幽默) | 全部 5 维 | 全部 5 维 |
| 记忆管理 | 仅查看 (只读) | 查看 + 删除 | 全功能 | 全功能 |
| 预览方式 | 语音播放优先 | 文字 + TTS 可选 | 文字 | 文字 |
| 角色切换 | 需家长确认 (persona 引擎 parent-approve) | 自由 | 自由 | 自由 |
| 主动提醒 | 默认关闭, 家长开启 | 默认 moderate | 默认 moderate | 默认 minimal (防打扰) |

### 8.2 实现方式

```dart
class CompanionStageAdapter {
  static CompanionTabSpec tabSpecFor(int gradeLevel) {
    if (gradeLevel == 0) {
      return CompanionStageAdapter(
        visibleTabs: const [TabId.character, TabId.interaction],
        personalityDimensions: const [],
        memoryEditable: false,
        previewVoiceFirst: true,
        switchRequiresParent: true,
      );
    }
    if (gradeLevel == 1) {
      return CompanionStageAdapter(
        visibleTabs: TabId.all,
        personalityDimensions: const ['strictness', 'encouragement', 'humor'],
        memoryEditable: true,
        previewVoiceFirst: false,
        switchRequiresParent: false,
      );
    }
    return CompanionStageAdapter(
      visibleTabs: TabId.all,
      personalityDimensions: PersonalityDimensions.allKeys,
      memoryEditable: true,
      previewVoiceFirst: false,
      switchRequiresParent: false,
    );
  }
}
```

> 学段数据来自用户服务的用户画像（`gradeLevel`），学段升迁后下次进入本页面自动应用新规格；性格维度增减只影响滑块可见性，服务端配置仍保存全 5 维（隐藏维度保持原值），避免升段后维度丢失。

---

## 9. 埋点事件设计

模块简称 `companion`（需在《客户端埋点事件体系与数据采集规范》模块简称表中注册，见 §13 第 8 项）。

### 9.1 事件清单

| 事件名 | 触发时机 | 关键参数 |
|--------|----------|----------|
| `page_companion_enter` | 进入学习伙伴管理主页 | `source` (mine/ai_chat/home), `character_id`, `level` |
| `page_companion_tab_view` | Tab 切换 | `tab` (character/personality/appearance/interaction/memory) |
| `expose_companion_preview` | 预览区曝光 | `character_id` |
| `click_companion_character` | 点击角色卡片 | `character_id`, `is_locked` |
| `biz_companion_switch` | 角色切换结果 | `character_id`, `result` (success/fail/offline/locked), `fail_code` |
| `biz_companion_personality_change` | 性格滑块保存 | `dimension`, `from`, `to`, `save_result` |
| `biz_companion_appearance_change` | 外观项修改 | `field` (avatar/theme_color/bubble/alias/nickname), `value_id` |
| `biz_companion_interaction_change` | 互动偏好修改 | `field`, `from`, `to` |
| `click_companion_preview_refresh` | 点击"换一条"预览 | `character_id`, `cache_hit` |
| `biz_companion_preview_stream` | 预览流结束 | `result` (done/error/timeout), `duration_ms`, `tokens` |
| `page_companion_memory_view` | 进入全部记忆页 | `total_shown`, `category` |
| `biz_companion_memory_edit` | 记忆编辑结果 | `memory_id`, `result`, `fail_reason` |
| `biz_companion_memory_delete` | 记忆删除结果 | `memory_id`, `source` (inferred/dialogue/survey), `result` |
| `biz_companion_reset` | 恢复默认设置 | `result` |
| `biz_companion_conflict` | 40901 版本冲突触发 | `resolution` (auto_merge/server_wins), `retry_result` |
| `perf_companion_load` | 主页首帧渲染完成 | `duration_ms`, `from_cache` |

### 9.2 核心漏斗与指标

- **定制漏斗**：`page_companion_enter` → `page_companion_tab_view(personality)` → `biz_companion_personality_change` → 次周留存（评估定制功能粘性）；
- **预览质量**：`biz_companion_preview_stream` 的 `result=done` 占比 ≥ 95%，P95 `duration_ms` ≤ 3000ms；
- **记忆信任度**：`biz_companion_memory_delete(source=inferred)` 占比连续 7 天 > 40% 时告警——推断记忆质量可能存在问题，反馈给记忆引擎优化抽取置信度阈值；
- **冲突率**：`biz_companion_conflict` 日占比 > 1% 时检查多端同步链路。

---

## 10. 性能优化

| 项 | 措施 | 目标 |
|----|------|------|
| 主页首帧 | Isar 本地缓存直渲 + 骨架屏 | 冷启动 ≤ 800ms, 缓存命中 ≤ 200ms |
| 预览请求 | 配置哈希缓存 10min + 3s 节流 + 1s 防抖 | 重复配置 0 请求 |
| 角色列表 | 24h 缓存 + 头像预缓存（页面进入时预取当前学段全部角色头像） | 滑动列表零加载占位 |
| 记忆长列表 | `ListView.builder` 懒构建 + 分页 20 条 + 墓碑内存过滤 | 500 条记忆滚动 60fps |
| 滑块交互 | 拖动仅 setState 局部刷新, 不触发 Provider 全局 rebuild | 拖动过程 60fps |
| 动画 | 低端机降级: 切换动画简化为淡入淡出 (per `ClientPerformanceProfile`) | 低端设备 30fps 可接受 |

---

## 11. 降级与错误处理矩阵

| 编号 | 故障场景 | 表现 | 客户端策略 | 用户感知 |
|------|----------|------|------------|----------|
| D1 | profile API 失败 (首次) | 无本地缓存 | 错误页 + 重试按钮 | 明确提示网络问题 |
| D2 | 预览 SSE 断流/超时 (10s) | 流中断 | 角色内置 3 条静态预设文案轮换, 记录 `biz_companion_preview_stream(error)` | 无感, 文案稍显简单 |
| D3 | 角色列表 API 失败 | - | 回退 24h 本地缓存列表; 均无则仅显示当前角色 | 列表可能缺新角色 |
| D4 | 离线切换角色 | - | Toast「联网后才能切换伙伴哦」+ 按钮置灰逻辑 | 明确提示 |
| D5 | 记忆列表 API 失败 | - | 本地缓存渲染 + 顶部同步横幅 | 可浏览, 知道未同步 |
| D6 | 记忆删除离线 | - | 本地墓碑立即消失 + 入变更队列 | 无感, 联网自动同步 |
| D7 | 40901 版本冲突 | - | §6.3 字段级自动合并, 重试一次 | 无感; 二次冲突提示已保留最新 |
| D8 | 42901 预览限流 | - | 客户端 3s 本地节流前置拦截; 命中服务端限流则静默走 D2 静态文案 | Toast「稍等一下再试~」 |
| D9 | 头像 CDN 失败 | 图片空白 | 兜底本地内置资源 `assets/companion/fallback_{id}.png`, 未知 id 用通用占位 | 头像为兜底图 |
| D10 | 关系数据 API 失败 | 等级/亲密度空白 | 渲染缓存关系数据; 无缓存则隐藏进度条仅显示伙伴名 | 不显示错误弹窗 |

---

## 12. 合规红线

| 编号 | 红线 | 实现要点 |
|------|------|----------|
| C1 | 学生可见记忆必须可管理 | 面向学生展示的记忆条目 `userEditable` 强制为 true; 服务端返回 false 的条目不得进入记忆列表 (过滤而非置灰) |
| C2 | 推断记忆须显著标注 | `source=inferred` 记忆固定展示「智能推断」标签; 置信度 < 70 标橙提示「可能不准」 |
| C3 | 家长可见度分级 | 家长端对伙伴记忆的可见范围遵循《学生学习数据家庭共享可见度分级引擎》: 默认家长仅见记忆数量统计, 逐条内容须学生侧开启分享 (L3) |
| C4 | 主动提醒受全局约束 | 本页频率设置 (1/3/5/8 次/日) 仅为上限; 实际触发还受防沉迷时段 (22:00-07:00 不触发)、统一通知频控引擎、免打扰中心联合约束, 页面文案需说明「最多」语义 |
| C5 | 幼儿段家长代管 | gradeLevel=0 时角色切换提交后进入家长确认流程 (persona 引擎 parent-approve), 客户端展示「等待家长确认」状态而非直接生效 |
| C6 | 删除即时生效 | 删除记忆本地立即移除; 服务端 DELETE 成功或 40404 均视为终态; 不得出现"删除后又复活"(下行同步跳过已墓碑 memoryId) |
| C7 | 语音默认关闭 | `voiceResponse` 默认 false; 幼儿段开启需家长操作 |
| C8 | 预览不入学习记录 | 预览对话不写入 AI 对话历史、不计入学情统计、不触发掌握度更新; 走独立预览额度 |
| C9 | 昵称/称呼输入安全 | 2-16 字, 本地敏感词快检 + 服务端 UGC 复检; 输入框禁用粘贴超长内容 | 
| C10 | 分享脱敏 | 关系页生成的分享图仅含等级/陪伴天数/里程碑图标, 不含昵称真实姓名、记忆明细、成绩数据 |

---

## 13. 契约对齐

| # | 对齐项 | 约定 |
|---|--------|------|
| 1 | 接口归属 | 本文 `/api/v1/companion/*` 为 **BFF 聚合层接口**, 由 BFF 聚合下游三个引擎; 客户端只对接 BFF, 不直连引擎接口 |
| 2 | 角色域 | BFF `GET /characters` / `POST /character/switch` ↔ persona 引擎 `GET /api/v1/persona/available` + `POST /api/v1/persona/bind` + `PUT /api/v1/persona/switch`; 学段过滤参数 BFF 透传 `
| 3 | 性格维度 | 客户端 5 维 float 是**展示抽象**; BFF 将其编译为 persona 引擎 prompt-layer 的人格参数 (persona 引擎内部 personality 枚举 lively/calm/humorous/gentle 与 5 维映射表由 persona 引擎维护), 客户端不感知枚举 |
| 4 | 记忆域 | BFF `GET /memories` / `PUT /memories/{id}` / `DELETE /memories/{id}` ↔ 记忆引擎 `GET /api/v1/memory/list/{studentId}` / `DELETE /api/v1/memory/{memoryId}` / `DELETE /api/v1/memory/batch`; 编辑接口为 BFF 扩展, 记忆引擎需增加 `PUT /api/v1/memory/{memoryId}` (mutationId 幂等), 已列入对记忆引擎的 v1.1 扩展需求 |
| 5 | 关系与里程碑 | BFF `GET /relation` / `GET /milestones` ↔ 成长等级引擎 `GET /api/v1/companion/status` + `GET /api/v1/companion/achievements`; 亲密度/等级数据权威归成长等级引擎, 客户端只读缓存 (D10) |
| 6 | 主动提醒偏好 | 本页 `proactiveEnabled` + `frequency` 由 BFF 同步至主动对话触发引擎的 `StudentProactivePreference` 与 `proactive_dialogue_quota` 日额度 (1/3/5/8); 关闭 proactiveEnabled 时 BFF 发偏好变更事件, 引擎侧熔断全部主动触发 |
| 7 | 幼儿家长确认 | 幼儿段角色切换走 persona 引擎 `POST /api/v1/persona/parent-approve`; 客户端轮询审批状态 (30s × 10 次) 或接收 WS 推送后生效 |
| 8 | 埋点注册 | 模块简称 `companion` 需补登记进《客户端埋点事件体系与数据采集规范》§2.2.3 模块简称表; 本文 §9 事件名均按其命名规范生成 |
| 9 | SSE 协议 | 预览 SSE 帧格式 (`event: token/done`) 对齐《SSE流式响应与AI增量渲染引擎》统一协议; 预览走独立轻量额度 (50 次/日), 不占用 AI 辅导对话额度, 由 BFF 侧路由到轻量模型 |
| 10 | 错误码 | 本文 6 个业务码 (40401/40301/40001/40901/42901/50001) 为客户端局部展示码段; 服务端真实错误码以《服务端统一业务异常码与错误分类体系》为准, BFF 负责映射, 客户端不感知内部码 |
| 11 | 首次创建 | E2E 文档 `POST /api/v1/companion` 创建流程与本页 40401 引导一致: 40401 → 进入角色选择 Tab → 选择并 bind → 创建成功返回完整 profile |
| 12 | 数据权威边界 | relation/milestone/version 服务端权威 (客户端永不本地修改); personality/appearance/interaction 客户端可写; 冲突裁决见 §6.3 分域表 |

---

## 14. 验收场景

1. 首次进入 (无伙伴): profile 返回 40401, 自动定位到角色选择 Tab, 选择角色后创建成功, 全页面数据就绪
2. 角色切换全流程: 点击学霸猫 → 详情弹窗预览对话 → 确认 → 切换动画 → 首页问候卡/AI对话页头像同步刷新
3. 切换锁定角色: 点击「学长」卡片 → 弹窗展示解锁条件「伙伴等级达到 10 级」, 无切换按钮
4. 幼儿段切换角色: 提交后展示「等待家长确认」, 家长在家长端确认前角色不变更, 确认后 30s 内生效
5. 性格滑块防抖: 连续拖动严格度滑块 3 秒, 仅触发 1 次保存请求与 1 次预览刷新
6. 性格保存后 AI 对话生效: 严格度调至 0.9, 在 AI 对话页提问错题, 回复风格变为严格指出错误 (prompt-layer 生效)
7. 预览缓存: 相同配置连续点击「换一条」3 次 (间隔 >3s), 第 1 次走 SSE, 后续命中本地缓存零请求 (cache_hit=true)
8. 预览降级: 断网状态下调整性格滑块 → 预览区展示内置静态文案, 无错误弹窗
9. 版本冲突自动合并: 平板修改主题色后, 手机 (旧版本缓存) 修改昵称并保存 → 自动合并两者变更, 无用户操作
10. 二次冲突回退: 构造持续冲突场景, 第二次 40901 后提示「已保留最新设置」, 本端昵称变更被服务端值覆盖
11. 离线记忆删除: 飞行模式删除 1 条记忆 → 列表立即消失 + 同步横幅出现 → 恢复网络 → 横幅消失, 其他端该记忆同步消失
12. 记忆删除幂等: 同一记忆的删除变更被推送 2 次, 服务端仅处理 1 次, 第二次返回 40404 按成功收敛
13. 推断记忆展示: source=inferred 且 confidence=60 的记忆显示「智能推断 + 置信度 60% (橙色)」双标注
14. userEditable 过滤: 服务端返回 1 条 userEditable=false 的记忆, 客户端列表不显示该条 (C1)
15. 幼儿段分龄: gradeLevel=0 用户进入页面仅见 2 个 Tab, 无性格滑块, 记忆页无编辑/删除按钮
16. 学段升迁: 小学升初中后进入页面, 性格滑块从 3 维扩展为 5 维, 原 3 维值保留
17. 关系数据降级: relation API 500 → 等级/亲密度展示缓存值, 无错误弹窗 (D10)
18. 主动提醒关闭: 关闭 proactiveEnabled 后, BFF 事件到达, 当日起不再收到任何伙伴主动消息 (验证引擎侧熔断)

---

## 15. 关联文档

| 文档 | 关系 |
|------|------|
| 服务端-学生AI学习伙伴角色个性化与对话风格自适应引擎 | 角色域下游权威 (persona 接口/家长审批/prompt-layer 编译) |
| 服务端-学生AI学习伙伴长期记忆库与跨会话关系建构引擎 | 记忆域下游权威 (记忆列表/删除/编码) |
| 服务端-学生AI学习伙伴成长等级体系与学习激励联动进化引擎 | 关系/里程碑下游权威 (status/achievements) |
| 服务端-学生AI学习伙伴主动对话触发与智能关怀策略引擎 | 互动偏好转消费者 (quota/偏好熔断) |
| 客户端-AI学习伙伴虚拟形象与动画交互引擎 | 头像/动画渲染组件 `CompanionAvatarWidget` 提供方 |
| 客户端-AI对话页面交互与组件架构-详细设计 | 伙伴形象/气泡风格在对话页的消费方 |
| 端到端流程设计-学生AI学习伙伴全生命周期互动与成长进化完整链路 | 全链路时序 (首次创建/成长/进化) |
| 客户端埋点事件体系与数据采集规范 | §9 事件命名规范来源 (companion 模块注册) |
| SSE流式响应与AI增量渲染引擎 | 预览 SSE 帧协议与 StreamingText 渲染 |
| 防沉迷与未成年人保护机制 | 主动提醒全局时段约束 (C4) |

---

## 维护记录

- **v1.0** (2026-08-14): 初版, 覆盖 §1-§5.6.2 前半 (页面架构/数据模型/API/五个 Tab 交互)。
- **v1.1** (2026-08-19): 补全烂尾文档。原文件 2011 行截断于 §5.6.2 `MemoryItemTile` Dart 代码 `copyWith(` 中途 (围栏 73 奇)。本次补齐: §5.6.2 收尾 (置信度标注/编辑删除按钮/分类图标/来源标签) 与 `userEditable` 渲染守卫; 新增 §5.6.3 记忆编辑弹窗 (客户端预校验 C9)、§5.6.4 全部记忆列表页 (分类筛选/分页/墓碑过滤/同步横幅)、§5.7 底部预览区 (SSE 消费/缓存键/节流/D2 静态降级)、§6 状态管理 (Riverpod Provider 全集/40901 分域裁决自动合并/单次重试防冲突风暴)、§7 离线同步 (可用性分级/单飞同步服务/记忆墓碑与保序队列/mutationId 幂等)、§8 分龄适配 (学段×能力矩阵/幼儿家长代管/维度增减不丢值)、§9 埋点 16 事件与漏斗指标 (推断记忆删除率告警)、§10 性能 6 项、§11 降级矩阵 D1-D10、§12 合规红线 C1-C10、§13 契约对齐 12 项 (BFF 聚合定位/persona-prompt-layer 映射/记忆编辑接口为引擎 v1.1 扩展需求/companion 埋点模块注册)、§14 验收 18 条、§15 关联文档。
