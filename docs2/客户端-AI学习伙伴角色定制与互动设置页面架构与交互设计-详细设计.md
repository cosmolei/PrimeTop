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
           