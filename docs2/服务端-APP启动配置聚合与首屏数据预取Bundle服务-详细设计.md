# 服务端-APP启动配置聚合与首屏数据预取Bundle服务-详细设计

## 1. 概述

### 1.1 功能定位

APP 启动配置聚合服务（Boot Config Bundle Service）是 PrimeTop 移动端启动流程中的**关键基础设施**，负责在 APP 冷启动 / 热启动时，通过**单一聚合端点**一次性返回客户端初始化所需的全部配置与首屏数据，避免客户端在启动阶段发起大量串行请求，从而显著降低首屏加载时间。

### 1.2 设计目标

| 目标 | 指标 |
| --- | --- |
| 聚合端点响应时间 (P99) | ≤ 300ms |
| 首屏数据完整度 | ≥ 95%（非异常情况下） |
| Payload 大小 (压缩后) | ≤ 80KB |
| 缓存命中率 | ≥ 90% |
| 降级容错 | 单数据源故障不影响整体响应 |

### 1.3 适用范围

- PrimeTop 移动端 APP（Android / iOS）
- 后续 Web 端、小程序端启动流程可参照复用

---

## 2. 整体架构

### 2.1 架构定位图

```text
┌─────────────────────────────────────────────────────────┐
│                    客户端 APP                            │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Application.onCreate()                           │  │
│  │    ├─ Flutter Engine Init                         │  │
│  │    ├─ Local Cache Read (last boot config)         │  │
│  │    ├─ → Boot Config Bundle API ◄──────────────────┼──┼── 请求
│  │    ├─ Merge: Remote > Local                      │  │
│  │    ├─ Initialize Services (auth, push, tracking)  │  │
│  │    └─ Render First Screen                         │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   API Gateway                            │
│  ┌───────────────────────────────────────────────────┐  │
│  │  鉴权 → 限流(100 req/min/user) → 路由到BCB服务   │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Boot Config Bundle Service                  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  1. 解析客户端上下文 (版本/设备/用户/场景)        │  │
│  │  2. 优先级分级 (Critical / High / Normal / Lazy)  │  │
│  │  3. 并行拉取多数据源 (CompletableFuture)          │  │
│  │  4. ETag 条件请求判断 → 命中则返回 304            │  │
│  │  5. 组装响应 + GZIP 压缩                          │  │
│  │  6. 异步刷新本地缓存                              │  │
│  └───────────────────────────────────────────────────┘  │
└──────────┬────────┬────────┬────────┬────────┬──────────┘
           │        │        │        │        │
           ▼        ▼        ▼        ▼        ▼
      ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
      │User  │ │App   │ │Study │ │Notif │ │Membr │
      │Svc   │ │Config│ │Svc   │ │Svc   │ │Svc   │
      └──────┘ └──────┘ └──────┘ └──────┘ └──────┘
```

### 2.2 核心设计原则

1. **单一端点聚合**：客户端启动时只需调用一个 API，减少连接建立和串行等待开销
2. **优先级分级返回**：Critical 级数据必须在主响应中，Lazy 级数据可通过独立延迟接口获取
3. **条件请求优化**：通过 ETag + If-None-Match 实现 304 Not Empty Response，节省带宽
4. **并行编排**：服务端使用 CompletableFuture 并行拉取各数据源，设置超时降级
5. **缓存优先**：Redis 缓存 + 客户端本地缓存，双层缓存兜底
6. **渐进降级**：任一数据源超时/异常，返回该部分默认值并标记 `stale: true`，不影响整体响应

---

## 3. 数据结构定义

### 3.1 请求参数

```typescript
interface BootConfigRequest {
  /** 客户端版本号，如 "1.5.2" */
  appVersion: string;
  /** 平台：android / ios / web / mini_program */
  platform: string;
  /** 客户端生成的唯一设备标识 */
  deviceId: string;
  /** 系统版本，如 "Android 14" / "iOS 17.2" */
  osVersion?: string;
  /** 设备型号，如 "Pixel 8" / "iPhone 15 Pro" */
  deviceModel?: string;
  /** 屏幕宽度 dp */
  screenWidth?: number;
  /** 屏幕高度 dp */
  screenHeight?: number;
  /** 网络类型：wifi / 4g / 5g / 3g / unknown */
  networkType?: string;
  /** 当前语言，如 "zh-CN" */
  locale?: string;
  /** 用户 Token（已登录时传入），游客启动可不传 */
  token?: string;
  /** 上一次启动返回的 ETag 值（条件请求） */
  ifNoneMatch?: string;
  /** 客户端本地缓存的配置版本号 */
  lastConfigVersion?: string;
  /** 启动场景：cold / warm / background */
  launchType?: 'cold' | 'warm' | 'background';
}
```

### 3.2 响应数据结构

```typescript
interface BootConfigResponse {
  /** 本次配置的版本号，客户端需存储用于下次条件请求 */
  configVersion: string;
  /** 配置生成时间戳 (ms) */
  generatedAt: number;
  /** 服务端时间戳，用于客户端时间校准 */
  serverTime: number;
  /** 强制更新信息 */
  forceUpdate?: ForceUpdateInfo;
  /** 全局特性开关 */
  featureFlags: Record<string, boolean>;
  /** 全局实验分组（AB测试） */
  experiments: ExperimentAssignment[];
  /** 系统公告 */
  announcements: Announcement[];
  /** 运营弹窗（启动弹窗） */
  popup?: PopupConfig;
  /** 当前用户信息（已登录） */
  user?: UserInfo;
  /** 用户会员权益（已登录） */
  membership?: MembershipInfo;
  /** 用户学生档案（已登录） */
  studentProfile?: StudentProfile;
  /** 首页学习工作台数据 */
  homeWorkspace?: HomeWorkspaceData;
  /** 未读消息统计 */
  unreadStats?: UnreadStats;
  /** 今日学习任务摘要 */
  todayTasks?: TodayTaskSummary;
  /** AI 对话未读（AI学习伙伴主动消息） */
  aiBuddyUnread?: number;
  /** 错题复习提醒 */
  mistakeReviewReminder?: MistakeReviewReminder;
  /** 学习计划进度摘要 */
  studyPlanSummary?: StudyPlanSummary;
  /** 教材版本信息 */
  textbookInfo?: TextbookInfo;
  /** 远程配置开关（覆盖客户端默认值） */
  remoteConfig?: Record<string, any>;
  /** 数据源状态（标记哪些数据源降级了） */
  sourceStatus?: Record<string, 'ok' | 'stale' | 'error'>;
  /** 下一次建议拉取时间间隔 (ms)，客户端可据此定时刷新 */
  nextRefreshIntervalMs?: number;
}

interface ForceUpdateInfo {
  /** 是否需要强制更新 */
  required: boolean;
  /** 最低允许版本，低于此版本必须更新 */
  minVersion: string;
  /** 最新版本号 */
  latestVersion: string;
  /** 下载地址（Android APK直链或应用市场） */
  downloadUrl: string;
  /** iOS App Store 地址 */
  iosStoreUrl?: string;
  /** 更新标题 */
  title: string;
  /** 更新说明 */
  changelog: string[];
  /** 是否可取消（false则锁死弹窗） */
  dismissible: boolean;
}

interface ExperimentAssignment {
  /** 实验KEY */
  experimentKey: string;
  /** 分配的变体 */
  variant: string;
  /** 实验参数 */
  params: Record<string, any>;
}

interface Announcement {
  id: string;
  type: 'system' | 'activity' | 'maintenance';
  title: string;
  content: string;
  /** 展示级别：弹窗 / 通知栏 / 静默 */
  displayLevel: 'popup' | 'banner' | 'silent';
  /** 是否已读（基于服务端记录） */
  read: boolean;
  /** 过期时间 */
  expireAt?: number;
  /** 跳转链接 */
  actionUrl?: string;
  /** 跳转类型 */
  actionType?: 'webview' | 'native' | 'deeplink';
}

interface PopupConfig {
  popupId: string;
  /** 弹窗类型 */
  type: 'image' | 'html' | 'native_card';
  /** 图片资源地址 */
  imageUrl?: string;
  /** HTML内容 */
  htmlContent?: string;
  /** 原生卡片配置 */
  nativeConfig?: any;
  /** 展示优先级 */
  priority: number;
  /** 展示频率控制：每天最多展示次数 */
  maxShowPerDay: number;
  /** 跳转配置 */
  action?: {
    type: 'webview' | 'native' | 'deeplink';
    url: string;
  };
  /** 关闭按钮配置 */
  dismissible: boolean;
  /** 过期时间 */
  expireAt?: number;
}

interface UserInfo {
  userId: string;
  nickname: string;
  avatar?: string;
  /** 是否已实名认证 */
  realNameVerified: boolean;
  /** 是否未成年 */
  isMinor: boolean;
  /** 家长是否已绑定 */
  parentBound: boolean;
}

interface MembershipInfo {
  /** 会员等级 */
  level: 'free' | 'monthly' | 'quarterly' | 'annual' | 'exam_prep';
  /** 会员到期时间 */
  expireAt?: number;
  /** 剩余天数 */
  daysRemaining?: number;
  /** 今日剩余 AI 问答次数 */
  aiQuotaRemaining: number;
  /** 今日剩余拍题次数 */
  photoSearchQuotaRemaining: number;
  /** 权益列表 */
  benefits: string[];
  /** 是否即将到期（7天内） */
  expiringSoon: boolean;
}

interface StudentProfile {
  /** 学段 */
  stage: 'preschool' | 'primary' | 'junior' | 'senior';
  /** 年级 */
  grade: string;
  /** 学期 */
  term: 'first' | 'second';
  /** 教材版本ID */
  textbookVersionId: string;
  /** 教材版本名称 */
  textbookVersionName: string;
  /** 主修学科列表 */
  subjects: string[];
  /** 学习目标 */
  studyGoal?: string;
}

interface HomeWorkspaceData {
  /** 继续学习入口 */
  continueLearning?: {
    type: 'ai_chat' | 'textbook' | 'practice' | 'mistake_review';
    title: string;
    chapterId?: string;
    conversationId?: string;
    progress?: number;
    iconUrl?: string;
  };
  /** 快捷操作列表 */
  quickActions: {
    type: string;
    label: string;
    iconUrl: string;
    deeplink: string;
    /** 角标（如未读数） */
    badge?: number;
  }[];
  /** 薄弱知识点提醒（最多3个） */
  weakPointAlerts?: {
    knowledgePointId: string;
    knowledgePointName: string;
    subject: string;
    mastery: number;
  }[];
}

interface UnreadStats {
  /** 系统通知未读数 */
  systemNotification: number;
  /** 学习提醒未读数 */
  learningReminder: number;
  /** 家长消息未读数 */
  parentMessage: number;
  /** 总未读数 */
  total: number;
}

interface TodayTaskSummary {
  /** 今日任务总数 */
  totalCount: number;
  /** 已完成数 */
  completedCount: number;
  /** 待完成任务摘要（最多3条） */
  pendingTasks: {
    taskId: string;
    title: string;
    type: string;
    estimatedMinutes: number;
    subject?: string;
  }[];
  /** 今日学习时长 (分钟) */
  todayStudyMinutes: number;
  /** 今日目标学习时长 (分钟) */
  targetStudyMinutes: number;
}

interface MistakeReviewReminder {
  /** 待复习错题数 */
  pendingReviewCount: number;
  /** 今日已复习数 */
  todayReviewedCount: number;
  /** 距离上次复习天数 */
  daysSinceLastReview?: number;
  /** 最紧急的复习科目 */
  urgentSubject?: string;
}

interface StudyPlanSummary {
  /** 当前周期计划ID */
  planId?: string;
  /** 计划名称 */
  planName?: string;
  /** 本周完成率 */
  weeklyCompletionRate?: number;
  /** 连续打卡天数 */
  streakDays: number;
  /** 下一个任务时间 */
  nextTaskTime?: number;
}

interface TextbookInfo {
  /** 当前教材版本ID */
  versionId: string;
  /** 教材版本名称 */
  versionName: string;
  /** 当前学期 */
  currentTerm: string;
  /** 是否有教材更新 */
  hasUpdate: boolean;
  /** 最新章节列表版本号 */
  chapterVersion: number;
}
```

### 3.3 数据库表设计

启动配置聚合服务本身不直接管理核心业务数据，但需要维护以下辅助表：

#### 3.3.1 客户端版本管理表

```sql
CREATE TABLE app_version (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    platform        VARCHAR(20) NOT NULL COMMENT 'android/ios',
    version_code    INT NOT NULL COMMENT '版本号数值，用于比较',
    version_name    VARCHAR(20) NOT NULL COMMENT '版本号显示名，如 1.5.2',
    channel         VARCHAR(50) NOT NULL DEFAULT 'official' COMMENT '发布渠道',
    download_url    VARCHAR(500) NOT NULL COMMENT '下载地址',
    ios_store_url   VARCHAR(500) COMMENT 'iOS App Store地址',
    changelog       TEXT COMMENT '更新日志JSON数组',
    min_supported   INT NOT NULL COMMENT '最低支持的版本号，低于此值强制更新',
    force_update    TINYINT NOT NULL DEFAULT 0 COMMENT '是否强制更新此版本',
    rollout_percent INT NOT NULL DEFAULT 100 COMMENT '灰度发布比例',
    status          VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active/inactive/deprecated',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_platform_version (platform, version_code),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='APP版本管理表';
```

#### 3.3.2 远程配置表

```sql
CREATE TABLE remote_config (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    config_key      VARCHAR(100) NOT NULL UNIQUE COMMENT '配置键',
    config_value    TEXT NOT NULL COMMENT '配置值(JSON)',
    value_type      VARCHAR(20) NOT NULL DEFAULT 'json' COMMENT 'json/string/number/boolean',
    description     VARCHAR(500) COMMENT '描述',
    /** 目标平台，null表示全部 */
    platform        VARCHAR(20) COMMENT 'android/ios/null=all',
    /** 目标版本范围，null表示全部；支持语义化版本表达式 */
    version_range   VARCHAR(100) COMMENT '如 ">=1.0.0 <2.0.0"',
    /** 灰度比例 */
    rollout_percent INT NOT NULL DEFAULT 100,
    status          VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active/inactive',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_key_status (config_key, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='远程配置表';
```

#### 3.3.3 用户启动配置缓存表（Redis）

使用 Redis Hash 存储用户维度的启动配置缓存：

```
Key:   boot_config:user:{userId}
Type:  Hash
TTL:   300s (5分钟)
Fields:
  config_version    -> "20260728_001"     // 配置版本号
  generated_at      -> "1722145800000"    // 生成时间
  payload           -> "<compressed_json>" // 完整响应JSON（GZIP压缩后Base64）
  source_status     -> "{\"user\":\"ok\"}" // 各数据源状态

Key:   boot_config:guest:{deviceId}
Type:  Hash
TTL:   600s (10分钟，游客缓存更久)
Fields: 同上
```

#### 3.3.4 全局配置缓存（Redis）

```
Key:   boot_config:global:{platform}:{versionRange}
Type:  Hash
TTL:   120s
Fields:
  feature_flags     -> "{\"enable_ai_buddy\":true,...}"
  remote_config     -> "{\"max_upload_size\":10485760,...}"
  force_update      -> "{...}"
  announcements     -> "[...]"
  experiments_seed  -> "..."
```

---

## 4. API 接口设计

### 4.1 启动配置聚合接口（核心）

```
POST /api/v1/boot/config
```

**请求头：**

| Header | 说明 | 必填 |
| --- | --- | --- |
| Content-Type | application/json | 是 |
| Authorization | Bearer {token}（已登录时） | 否 |
| X-Device-Id | 设备唯一标识 | 是 |
| X-App-Version | 客户端版本号 | 是 |
| X-Platform | android / ios | 是 |
| If-None-Match | 上次响应的 ETag | 否 |

**请求体：** `BootConfigRequest`

**响应：**

| 场景 | HTTP状态码 | 说明 |
| --- | --- | --- |
| 正常返回 | 200 | 返回完整 BootConfigResponse |
| 配置未变更 | 304 | 无响应体，客户端使用本地缓存 |
| 强制更新 | 200 | 响应体中 `forceUpdate.required = true`，客户端锁定 |

**响应头：**

```
ETag: "boot-v2-20260728-a1b2c3"
Content-Encoding: gzip
Cache-Control: no-cache
X-Config-Version: 20260728_001
```

#### 请求示例

```json
{
  "appVersion": "1.5.2",
  "platform": "android",
  "deviceId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "osVersion": "Android 14",
  "deviceModel": "Pixel 8 Pro",
  "screenWidth": 412,
  "screenHeight": 915,
  "networkType": "wifi",
  "locale": "zh-CN",
  "token": "eyJhbGciOiJSUzI1NiIs...",
  "ifNoneMatch": "\"boot-v2-20260728-a1b2c3\"",
  "lastConfigVersion": "20260728_001",
  "launchType": "cold"
}
```

#### 响应示例（完整）

```json
{
  "configVersion": "20260728_002",
  "generatedAt": 1722145800000,
  "serverTime": 1722145800123,
  "forceUpdate": {
    "required": false,
    "minVersion": "1.0.0",
    "latestVersion": "1.5.3",
    "downloadUrl": "https://cdn.primetop.cn/apk/primetop-1.5.3.apk",
    "title": "发现新版本",
    "changelog": ["优化AI对话响应速度", "新增物理实验模拟", "修复若干已知问题"],
    "dismissible": true
  },
  "featureFlags": {
    "enable_ai_buddy": true,
    "enable_live_class": false,
    "enable_study_room": true,
    "enable_pinyin_module": true,
    "enable_parent_dashboard_v2": true,
    "enable_offline_mode": true,
    "enable_dark_mode": true,
    "enable_tablet_layout": false
  },
  "experiments": [
    {
      "experimentKey": "home_recommend_algo",
      "variant": "variant_b",
      "params": { "use_knowledge_tracing": true }
    }
  ],
  "announcements": [
    {
      "id": "ann_001",
      "type": "activity",
      "title": "暑假专题学习营开启",
      "content": "7月15日-8月31日，每日打卡赢积分",
      "displayLevel": "banner",
      "read": false,
      "expireAt": 1722451200000,
      "actionUrl": "primetop://summer_camp",
      "actionType": "deeplink"
    }
  ],
  "popup": {
    "popupId": "popup_20260728",
    "type": "image",
    "imageUrl": "https://cdn.primetop.cn/popup/summer_promo.png",
    "priority": 10,
    "maxShowPerDay": 1,
    "action": {
      "type": "deeplink",
      "url": "primetop://membership/promo"
    },
    "dismissible": true,
    "expireAt": 1722537600000
  },
  "user": {
    "userId": "u_123456",
    "nickname": "小明",
    "avatar": "https://cdn.primetop.cn/avatar/u_123456.png",
    "realNameVerified": true,
    "isMinor": true,
    "parentBound": true
  },
  "membership": {
    "level": "annual",
    "expireAt": 1764528000000,
    "daysRemaining": 145,
    "aiQuotaRemaining": 50,
    "photoSearchQuotaRemaining": 30,
    "benefits": ["unlimited_ai", "full_resolution", "priority_model", "ad_free"],
    "expiringSoon": false
  },
  "studentProfile": {
    "stage": "junior",
    "grade": "初二",
    "term": "second",
    "textbookVersionId": "tb_renjiao_v3",
    "textbookVersionName": "人教版",
    "subjects": ["语文", "数学", "英语", "物理"],
    "studyGoal": "期末考试"
  },
  "homeWorkspace": {
    "continueLearning": {
      "type": "textbook",
      "title": "第八章 压强",
      "chapterId": "ch_physics_08",
      "progress": 0.45,
      "iconUrl": "https://cdn.primetop.cn/icon/physics.png"
    },
    "quickActions": [
      { "type": "photo_search", "label": "拍题答疑", "iconUrl": "...", "deeplink": "primetop://photo_search", "badge": 0 },
      { "type": "ai_chat", "label": "问AI", "iconUrl": "...", "deeplink": "primetop://ai_chat", "badge": 0 },
      { "type": "mistake_review", "label": "错题复习", "iconUrl": "...", "deeplink": "primetop://mistake_review", "badge": 12 },
      { "type": "study_plan", "label": "学习计划", "iconUrl": "...", "deeplink": "primetop://study_plan", "badge": 0 }
    ],
    "weakPointAlerts": [
      { "knowledgePointId": "kp_001", "knowledgePointName": "浮力计算", "subject": "物理", "mastery": 0.35 },
      { "knowledgePointId": "kp_002", "knowledgePointName": "一次函数图像", "subject": "数学", "mastery": 0.42 }
    ]
  },
  "unreadStats": {
    "systemNotification": 2,
    "learningReminder": 1,
    "parentMessage": 0,
    "total": 3
  },
  "todayTasks": {
    "totalCount": 5,
    "completedCount": 2,
    "pendingTasks": [
      { "taskId": "t_001", "title": "复习浮力知识点", "type": "mistake_review", "estimatedMinutes": 15, "subject": "物理" },
      { "taskId": "t_002", "title": "完成数学第八章练习", "type": "practice", "estimatedMinutes": 30, "subject": "数学" },
      { "taskId": "t_003", "title": "背诵《岳阳楼记》", "type": "recitation", "estimatedMinutes": 10, "subject": "语文" }
    ],
    "todayStudyMinutes": 45,
    "targetStudyMinutes": 120
  },
  "aiBuddyUnread": 1,
  "mistakeReviewReminder": {
    "pendingReviewCount": 12,
    "todayReviewedCount": 3,
    "daysSinceLastReview": 0,
    "urgentSubject": "物理"
  },
  "studyPlanSummary": {
    "planId": "plan_2026_summer",
    "planName": "暑假冲刺计划",
    "weeklyCompletionRate": 0.72,
    "streakDays": 7,
    "nextTaskTime": 1722153000000
  },
  "textbookInfo": {
    "versionId": "tb_renjiao_v3",
    "versionName": "人教版",
    "currentTerm": "2026春季",
    "hasUpdate": false,
    "chapterVersion": 15
  },
  "remoteConfig": {
    "max_upload_size": 10485760,
    "ai_stream_timeout_ms": 30000,
    "ocr_max_image_size": 4096,
    "min_study_session_minutes": 10,
    "max_daily_ai_questions_free": 10,
    "max_daily_photo_search_free": 5,
    "cache_ttl_seconds": 3600,
    "cdn_base_url": "https://cdn.primetop.cn"
  },
  "sourceStatus": {
    "user": "ok",
    "membership": "ok",
    "home": "ok",
    "notification": "ok",
    "study_plan": "ok",
    "textbook": "ok"
  },
  "nextRefreshIntervalMs": 1800000
}
```

### 4.2 延迟加载接口（Lazy Data）

对于非紧急数据，客户端可在首屏渲染后异步请求：

```
GET /api/v1/boot/lazy?sections=hot_topics,recommended_courses,seasonal_events
```

**响应：**

```json
{
  "hotTopics": [...],
  "recommendedCourses": [...],
  "seasonalEvents": [...]
}
```

### 4.3 配置变更推送（WebSocket）

当服务端配置发生变更时，通过 WebSocket 通道主动通知客户端刷新：

```json
{
  "type": "config_changed",
  "changedSections": ["feature_flags", "remote_config"],
  "newConfigVersion": "20260728_003",
  "timestamp": 1722146000000
}
```

客户端收到后可决定是否重新拉取 `/boot/config`。

---

## 5. 核心服务端实现

### 5.1 服务层架构

```java
/**
 * 启动配置聚合服务主入口
 */
@Service
@Slf4j
public class BootConfigBundleService {

    @Autowired private UserAggregateService userAggregateService;
    @Autowired private AppVersionService appVersionService;
    @Autowired private FeatureFlagService featureFlagService;
    @Autowired private RemoteConfigService remoteConfigService;
    @Autowired private AnnouncementService announcementService;
    @Autowired private PopupService popupService;
    @Autowired private HomeWorkspaceService homeWorkspaceService;
    @Autowired private NotificationAggregateService notificationService;
    @Autowired private StudyPlanAggregateService studyPlanService;
    @Autowired private MistakeReviewService mistakeReviewService;
    @Autowired private TextbookAggregateService textbookService;
    @Autowired private ExperimentService experimentService;
    @Autowired private BootConfigCacheManager cacheManager;

    /**
     * 构建启动配置聚合响应
     * 
     * @param request 客户端请求
     * @return 聚合配置结果（含ETag）
     */
    public BootConfigResult buildBootConfig(BootConfigRequest request) {
        long startTime = System.currentTimeMillis();
        String cacheKey = buildCacheKey(request);

        // 1. 检查缓存（ETag 匹配则直接返回 304）
        BootConfigCacheEntry cached = cacheManager.get(cacheKey);
        if (cached != null && isCacheFresh(cached, request)) {
            return BootConfigResult.notModified(cached.getEtag());
        }

        // 2. 构建上下文
        BootConfigContext ctx = BootConfigContext.from(request);

        // 3. 并行编排各数据源
        Map<String, DataFetchResult<?>> results = parallelFetch(ctx);

        // 4. 组装响应
        BootConfigResponse response = assembleResponse(ctx, results);

        // 5. 生成 ETag
        String etag = generateETag(response);

        // 6. 缓存结果
        cacheManager.put(cacheKey, etag, response, getCacheTtl(ctx));

        // 7. 记录指标
        recordMetrics(ctx, results, System.currentTimeMillis() - startTime);

        return BootConfigResult.ok(response, etag);
    }

    /**
     * 并行拉取所有数据源，每个数据源独立超时降级
     */
    private Map<String, DataFetchResult<?>> parallelFetch(BootConfigContext ctx) {
        // 定义数据源及优先级
        List<DataFetchTask> tasks = List.of(
            // --- Critical 优先级（必须成功，超时200ms） ---
            new DataFetchTask("force_update", Priority.CRITICAL, 200,
                () -> appVersionService.checkForceUpdate(ctx)),
            new DataFetchTask("feature_flags", Priority.CRITICAL, 200,
                () -> featureFlagService.getFlags(ctx)),
            new DataFetchTask("remote_config", Priority.CRITICAL, 200,
                () -> remoteConfigService.getConfig(ctx)),

            // --- High 优先级（已登录用户必须，超时300ms） ---
            new DataFetchTask("user", Priority.HIGH, 300,
                () -> userAggregateService.getUserInfo(ctx), ctx.isLoggedIn()),
            new DataFetchTask("membership", Priority.HIGH, 300,
                () -> userAggregateService.getMembership(ctx), ctx.isLoggedIn()),
            new DataFetchTask("student_profile", Priority.HIGH, 300,
                () -> userAggregateService.getStudentProfile(ctx), ctx.isLoggedIn()),

            // --- Normal 优先级（首屏需要，超时300ms） ---
            new DataFetchTask("home_workspace", Priority.NORMAL, 300,
                () -> homeWorkspaceService.getWorkspace(ctx), ctx.isLoggedIn()),
            new DataFetchTask("announcements", Priority.NORMAL, 300,
                () -> announcementService.getActiveAnnouncements(ctx)),
            new DataFetchTask("popup", Priority.NORMAL, 300,
                () -> popupService.getApplicablePopup(ctx)),
            new DataFetchTask("unread_stats", Priority.NORMAL, 300,
                () -> notificationService.getUnreadStats(ctx), ctx.isLoggedIn()),
            new DataFetchTask("today_tasks", Priority.NORMAL, 300,
                () -> studyPlanService.getTodayTasks(ctx), ctx.isLoggedIn()),
            new DataFetchTask("mistake_reminder", Priority.NORMAL, 300,
                () -> mistakeReviewService.getReminder(ctx), ctx.isLoggedIn()),
            new DataFetchTask("study_plan", Priority.NORMAL, 300,
                () -> studyPlanService.getPlanSummary(ctx), ctx.isLoggedIn()),
            new DataFetchTask("textbook", Priority.NORMAL, 300,
                () -> textbookService.getTextbookInfo(ctx), ctx.isLoggedIn()),

            // --- Lazy 优先级（可降级跳过，不阻塞主响应） ---
            new DataFetchTask("experiments", Priority.LAZY, 150,
                () -> experimentService.getAssignments(ctx)),
            new DataFetchTask("ai_buddy_unread", Priority.LAZY, 150,
                () -> notificationService.getAiBuddyUnread(ctx), ctx.isLoggedIn())
        );

        // 过滤不需要执行的任务
        List<DataFetchTask> activeTasks = tasks.stream()
            .filter(t -> t.shouldExecute(ctx))
            .collect(Collectors.toList());

        // 并行执行
        return ParallelFetcher.execute(activeTasks);
    }

    private String buildCacheKey(BootConfigRequest request) {
        // 缓存维度：用户ID(或guest) + 平台 + 大版本号 + 语言
        String userKey = request.getToken() != null ? extractUserId(request.getToken()) 
                                                     : "guest:" + request.getDeviceId();
        return String.format("boot:%s:%s:v%s:%s", 
            userKey, 
            request.getPlatform(),
            getMajorVersion(request.getAppVersion()),
            request.getLocale() != null ? request.getLocale() : "default"
        );
    }

    private String generateETag(BootConfigResponse response) {
        String raw = response.getConfigVersion() + ":" + response.getGeneratedAt();
        String hash = DigestUtils.md5Hex(raw);
        return String.format("\"boot-v2-%s\"", hash.substring(0, 12));
    }
}
```

### 5.2 并行拉取器（ParallelFetcher）

```java
/**
 * 基于 CompletableFuture 的并行数据拉取器
 * 每个数据源独立超时，互不影响
 */
public class ParallelFetcher {

    private static final ExecutorService executor = new ThreadPoolExecutor(
        16, 32, 60L, TimeUnit.SECONDS,
        new LinkedBlockingQueue<>(256),
        new ThreadFactoryBuilder().setNameFormat("boot-fetch-%d").build(),
        new ThreadPoolExecutor.CallerRunsPolicy()
    );

    public static Map<String, DataFetchResult<?>> execute(List<DataFetchTask> tasks) {
        // 为每个任务创建 CompletableFuture，独立超时控制
        Map<String, CompletableFuture<DataFetchResult<?>>> futures = new LinkedHashMap<>();

        for (DataFetchTask task : tasks) {
            CompletableFuture<DataFetchResult<?>> future = CompletableFuture
                .supplyAsync(() -> {
                    long s = System.currentTimeMillis();
                    try {
                        Object data = task.getSupplier().get();
                        long elapsed = System.currentTimeMillis() - s;
                        return DataFetchResult.ok(task.getName(), data, elapsed);
                    } catch (Exception e) {
                        long elapsed = System.currentTimeMillis() - s;
                        log.warn("[BootConfig] Data source '{}' failed in {}ms: {}", 
                            task.getName(), elapsed, e.getMessage());
                        return DataFetchResult.error(task.getName(), e, elapsed);
                    }
                }, executor)
                // 每个数据源独立超时
                .orTimeout(task.getTimeoutMs(), TimeUnit.MILLISECONDS)
                // 超时/异常降级
                .exceptionally(ex -> {
                    log.warn("[BootConfig] Data source '{}' degraded: {}", 
                        task.getName(), ex.getMessage());
                    return DataFetchResult.degraded(task.getName(), task.getPriority());
                });

            futures.put(task.getName(), future);
        }

        // 等待所有任务完成（总超时不超过 500ms）
        CompletableFuture.allOf(futures.values().toArray(new CompletableFuture[0]))
            .join();  // 总等待，但每个future自己有超时

        return futures.entrySet().stream()
            .collect(Collectors.toMap(
                Map.Entry::getKey,
                e -> e.getValue().getNow(DataFetchResult.degraded(e.getKey(), Priority.LAZY))
            ));
    }
}
```

### 5.3 响应组装器

```java
/**
 * 将各数据源的结果组装为统一的 BootConfigResponse
 * 处理降级：失败的源返回默认值并标记 stale
 */
public class BootConfigAssembler {

    public BootConfigResponse assemble(BootConfigContext ctx, 
                                        Map<String, DataFetchResult<?>> results) {
        BootConfigResponse resp = new BootConfigResponse();
        resp.setConfigVersion(generateConfigVersion(ctx));
        resp.setGeneratedAt(System.currentTimeMillis());
        resp.setServerTime(System.currentTimeMillis());

        // 全局配置（Critical 优先级 - 必须成功）
        DataFetchResult<?> forceUpdateR = results.get("force_update");
        if (forceUpdateR.isOk()) {
            resp.setForceUpdate((ForceUpdateInfo) forceUpdateR.getData());
        } else {
            // 降级：不强制更新
            resp.setForceUpdate(ForceUpdateInfo.noUpdate());
        }

        DataFetchResult<?> flagsR = results.get("feature_flags");
        if (flagsR.isOk()) {
            resp.setFeatureFlags((Map<String, Boolean>) flagsR.getData());
        } else {
            // 降级：返回最小默认配置
            resp.setFeatureFlags(FeatureFlagDefaults.get());
        }

        DataFetchResult<?> configR = results.get("remote_config");
        if (configR.isOk()) {
            resp.setRemoteConfig((Map<String, Object>) configR.getData());
        } else {
            resp.setRemoteConfig(RemoteConfigDefaults.get());
        }

        // 用户相关数据（已登录时）
        if (ctx.isLoggedIn()) {
            assembleUserData(ctx, resp, results);
        }

        // 公共数据
        assemblePublicData(ctx, resp, results);

        // 源状态
        Map<String, String> sourceStatus = new LinkedHashMap<>();
        results.forEach((name, result) -> {
            sourceStatus.put(name, result.getStatusString());
        });
        resp.setSourceStatus(sourceStatus);

        // 下次刷新间隔（基于用户状态动态计算）
        resp.setNextRefreshIntervalMs(calculateNextRefresh(ctx, results));

        return resp;
    }

    private void assembleUserData(BootConfigContext ctx, BootConfigResponse resp,
                                   Map<String, DataFetchResult<?>> results) {
        // 用户信息
        DataFetchResult<?> userR = results.get("user");
        if (userR.isOk()) {
            resp.setUser((UserInfo) userR.getData());
        }

        // 会员信息
        DataFetchResult<?> memberR = results.get("membership");
        if (memberR.isOk()) {
            resp.setMembership((MembershipInfo) memberR.getData());
        }

        // 学生档案
        DataFetchResult<?> profileR = results.get("student_profile");
        if (profileR.isOk()) {
            resp.setStudentProfile((StudentProfile) profileR.getData());
        }

        // 首页工作台
        DataFetchResult<?> homeR = results.get("home_workspace");
        if (homeR.isOk()) {
            resp.setHomeWorkspace((HomeWorkspaceData) homeR.getData());
        }

        // 未读统计
        DataFetchResult<?> unreadR = results.get("unread_stats");
        if (unreadR.isOk()) {
            resp.setUnreadStats((UnreadStats) unreadR.getData());
        }

        // 今日任务
        DataFetchResult<?> tasksR = results.get("today_tasks");
        if (tasksR.isOk()) {
            resp.setTodayTasks((TodayTaskSummary) tasksR.getData());
        }

        // 错题提醒
        DataFetchResult<?> mistakeR = results.get("mistake_reminder");
        if (mistakeR.isOk()) {
            resp.setMistakeReviewReminder((MistakeReviewReminder) mistakeR.getData());
        }

        // 学习计划
        DataFetchResult<?> planR = results.get("study_plan");
        if (planR.isOk()) {
            resp.setStudyPlanSummary((StudyPlanSummary) planR.getData());
        }

        // 教材信息
        DataFetchResult<?> textbookR = results.get("textbook");
        if (textbookR.isOk()) {
            resp.setTextbookInfo((TextbookInfo) textbookR.getData());
        }

        // AI伙伴未读
        DataFetchResult<?> buddyR = results.get("ai_buddy_unread");
        if (buddyR.isOk()) {
            resp.setAiBuddyUnread((Integer) buddyR.getData());
        }
    }

    private void assemblePublicData(BootConfigContext ctx, BootConfigResponse resp,
                                     Map<String, DataFetchResult<?>> results) {
        // 公告
        DataFetchResult<?> annR = results.get("announcements");
        if (annR.isOk()) {
            resp.setAnnouncements((List<Announcement>) annR.getData());
        } else {
            resp.setAnnouncements(Collections.emptyList());
        }

        // 弹窗
        DataFetchResult<?> popupR = results.get("popup");
        if (popupR.isOk()) {
            resp.setPopup((PopupConfig) popupR.getData());
        }

        // 实验分组
        DataFetchResult<?> expR = results.get("experiments");
        if (expR.isOk()) {
            resp.setExperiments((List<ExperimentAssignment>) expR.getData());
        } else {
            resp.setExperiments(Collections.emptyList());
        }
    }

    /**
     * 动态计算下次刷新间隔
     * - 学习时段（用户活跃）：15-30分钟
     * - 非活跃时段：60分钟
     * - 有未读消息时：缩短至15分钟
     */
    private long calculateNextRefresh(BootConfigContext ctx,
                                       Map<String, DataFetchResult<?>> results) {
        UnreadStats unread = getIfOk(results, "unread_stats", UnreadStats.class);
        if (unread != null && unread.getTotal() > 0) {
            return 15 * 60 * 1000L; // 15分钟
        }
        
        int hour = LocalTime.now().getHour();
        if (hour >= 7 && hour <= 22) {
            return 30 * 60 * 1000L; // 30分钟（活跃时段）
        }
        return 60 * 60 * 1000L; // 60分钟（非活跃时段）
    }
}
```

### 5.4 缓存管理

```java
/**
 * 多级缓存管理
 * L1: 本地内存缓存（Caffeine）—— 超快，容量小
 * L2: Redis 集群缓存 —— 跨实例共享，容量大
 */
@Component
@Slf4j
public class BootConfigCacheManager {

    /** L1: 本地缓存，1分钟过期，最大1000条 */
    private final Cache<String, BootConfigCacheEntry> l1Cache = Caffeine.newBuilder()
        .maximumSize(1000)
        .expireAfterWrite(Duration.ofMinutes(1))
        .recordStats()
        .build();

    @Autowired private StringRedisTemplate redis;

    private static final String REDIS_PREFIX = "boot_config:";
    private static final int REDIS_TTL_SECONDS = 300;

    /**
     * 获取缓存
     */
    public BootConfigCacheEntry get(String key) {
        // L1
        BootConfigCacheEntry entry = l1Cache.getIfPresent(key);
        if (entry != null && !entry.isExpired()) {
            return entry;
        }

        // L2
        try {
            String json = redis.opsForValue().get(REDIS_PREFIX + key);
            if (json != null) {
                entry = JsonUtils.parse(json, BootConfigCacheEntry.class);
                l1Cache.put(key, entry);
                return entry;
            }
        } catch (Exception e) {
            log.warn("[BootConfig] Redis cache read failed for key {}: {}", key, e.getMessage());
        }

        return null;
    }

    /**
     * 写入缓存
     */
    public void put(String key, String etag, BootConfigResponse response, int ttlSeconds) {
        BootConfigCacheEntry entry = new BootConfigCacheEntry(
            etag, response, System.currentTimeMillis(), ttlSeconds
        );

        // L1
        l1Cache.put(key, entry);

        // L2
        try {
            String json = JsonUtils.stringify(entry);
            // 如果响应太大，先压缩
            if (json.length() > 50_000) {
                json = compressAndEncode(json);
                entry.setCompressed(true);
            }
            redis.opsForValue().set(
                REDIS_PREFIX + key,
                json,
                ttlSeconds,
                TimeUnit.SECONDS
            );
        } catch (Exception e) {
            log.warn("[BootConfig] Redis cache write failed for key {}: {}", key, e.getMessage());
        }
    }

    /**
     * 批量失效缓存（配置变更时触发）
     */
    public void invalidateByPattern(String pattern) {
        // 清除 L1 中匹配的
        l1Cache.asMap().keySet()
            .stream()
            .filter(k -> k.contains(pattern))
            .forEach(l1Cache::invalidate);

        // 清除 L2 中匹配的（使用 SCAN 避免阻塞）
        Set<String> keys = redis.scan(REDIS_PREFIX + "*" + pattern + "*");
        if (!keys.isEmpty()) {
            redis.delete(keys);
            log.info("[BootConfig] Invalidated {} cache entries for pattern: {}", keys.size(), pattern);
        }
    }
}
```

---

## 6. 数据源详细设计

### 6.1 用户聚合服务（UserAggregateService）

```java
@Service
public class UserAggregateService {

    @DubboReference private UserApi userApi;
    @DubboReference private MembershipApi membershipApi;
    @DubboReference private StudentProfileApi profileApi;

    /**
     * 获取用户基础信息
     */
    public UserInfo getUserInfo(BootConfigContext ctx) {
        UserDTO user = userApi.getById(ctx.getUserId());
        if (user == null) {
            throw new BootConfigException("USER_NOT_FOUND", "用户不存在");
        }

        UserInfo info = new UserInfo();
        info.setUserId(user.getId());
        info.setNickname(user.getNickname());
        info.setAvatar(user.getAvatar());
        info.setRealNameVerified(user.isRealNameVerified());
        info.setIsMinor(user.isMinor());
        info.setParentBound(user.getParentId() != null);
        return info;
    }

    /**
     * 获取会员信息（含今日剩余额度）
     */
    public MembershipInfo getMembership(BootConfigContext ctx) {
        MembershipDTO member = membershipApi.getActiveMembership(ctx.getUserId());
        QuotaDTO quota = membershipApi.getTodayQuota(ctx.getUserId());

        MembershipInfo info = new MembershipInfo();
        if (member != null) {
            info.setLevel(member.getLevel());
            info.setExpireAt(member.getExpireAt().getTime());
            info.setDaysRemaining(ChronoUnit.DAYS.between(
                LocalDate.now(), 
                member.getExpireAt().toInstant().atZone(ZoneId.systemDefault()).toLocalDate()
            ));
            info.setBenefits(member.getBenefits());
            info.setExpiringSoon(info.getDaysRemaining() != null && info.getDaysRemaining() <= 7);
        } else {
            info.setLevel("free");
            info.setBenefits(Collections.emptyList());
            info.setExpiringSoon(false);
        }
        info.setAiQuotaRemaining(quota.getAiQuestionsRemaining());
        info.setPhotoSearchQuotaRemaining(quota.getPhotoSearchRemaining());
        return info;
    }

    /**
     * 获取学生档案
     */
    public StudentProfile getStudentProfile(BootConfigContext ctx) {
        ProfileDTO profile = profileApi.getByUserId(ctx.getUserId());
        if (profile == null) {
            // 档案未设置，返回空壳
            return null;
        }

        StudentProfile sp = new StudentProfile();
        sp.setStage(profile.getStage());
        sp.setGrade(profile.getGrade());
        sp.setTerm(profile.getTerm());
        sp.setTextbookVersionId(profile.getTextbookVersionId());
        sp.setTextbookVersionName(profile.getTextbookVersionName());
        sp.setSubjects(profile.getSubjects());
        sp.setStudyGoal(profile.getStudyGoal());
        return sp;
    }
}
```

### 6.2 首页工作台服务（HomeWorkspaceService）

```java
@Service
public class HomeWorkspaceService {

    @DubboReference private LearningRecordApi learningRecordApi;
    @DubhoReference private KnowledgeMasteryApi masteryApi;
    @DubboReference private MistakeApi mistakeApi;

    public HomeWorkspaceData getWorkspace(BootConfigContext ctx) {
        HomeWorkspaceData data = new HomeWorkspaceData();

        // 1. 继续学习入口
        data.setContinueLearning(getContinueLearning(ctx));

        // 2. 快捷操作（配置化，从远程配置读取）
        data.setQuickActions(getQuickActions(ctx));

        // 3. 薄弱知识点提醒（最多3个）
        data.setWeakPointAlerts(getWeakPoints(ctx));

        return data;
    }

    private ContinueLearning getContinueLearning(BootConfigContext ctx) {
        LastLearningDTO last = learningRecordApi.getLastLearning(ctx.getUserId());
        if (last == null || isExpired(last, 7)) {
            return null; // 超过7天没有学习记录，不显示
        }

        ContinueLearning cl = new ContinueLearning();
        cl.setType(last.getType());
        cl.setTitle(last.getTitle());
        cl.setChapterId(last.getChapterId());
        cl.setConversationId(last.getConversationId());
        cl.setProgress(last.getProgress());
        cl.setIconUrl(last.getIconUrl());
        return cl;
    }

    private List<WeakPointAlert> getWeakPoints(BootConfigContext ctx) {
        // 从知识掌握度服务获取掌握度低于50%的知识点
        List<MasteryDTO> weakList = masteryApi.getWeakPoints(
            ctx.getUserId(), 
            0.50,  // mastery threshold
            3      // limit
        );

        return weakList.stream().map(m -> {
            WeakPointAlert alert = new WeakPointAlert();
            alert.setKnowledgePointId(m.getKpId());
            alert.setKnowledgePointName(m.getKpName());
            alert.setSubject(m.getSubject());
            alert.setMastery(m.getMastery());
            return alert;
        }).collect(Collectors.toList());
    }
}
```

### 6.3 版本检查服务（AppVersionService）

```java
@Service
public class AppVersionService {

    @Autowired private AppVersionMapper versionMapper;
    @Autowired private StringRedisTemplate redis;

    private static final String CACHE_KEY = "app_version:latest:";

    /**
     * 检查是否需要强制更新
     */
    public ForceUpdateInfo checkForceUpdate(BootConfigContext ctx) {
        // 从缓存获取最新版本信息
        String platform = ctx.getPlatform();
        int clientVersionCode = parseVersionCode(ctx.getAppVersion());

        // 获取最低支持版本
        Integer minSupported = getCachedMinSupported(platform);
        if (minSupported == null) {
            minSupported = versionMapper.findMinSupported(platform);
            cacheMinSupported(platform, minSupported);
        }

        // 获取最新版本
        AppVersion latest = getCachedLatest(platform);

        ForceUpdateInfo info = new ForceUpdateInfo();
        if (latest != null) {
            info.setLatestVersion(latest.getVersionName());
            info.setDownloadUrl(latest.getDownloadUrl());
            info.setIosStoreUrl(latest.getIosStoreUrl());
            info.setChangelog(parseChangelog(latest.getChangelog()));
            info.setTitle("发现新版本");
            info.setCancelable(true);
        }

        // 判断是否强制更新
        if (minSupported != null && clientVersionCode < minSupported) {
            info.setRequired(true);
            info.setCancelable(false);
            info.setTitle("请更新到最新版本");
            return info;
        }

        // 检查灰度发布（可能不返回最新版给非灰度用户）
        if (latest != null && latest.getRolloutPercent() < 100) {
            boolean inRollout = isUserInRollout(ctx.getUserIdOrDeviceId(), 
                latest.getVersionCode(), latest.getRolloutPercent());
            if (!inRollout) {
                // 用户不在灰度范围，返回上一个稳定版
                latest = getCachedStable(platform);
            }
        }

        info.setRequired(false);
        info.setMinVersion(intToVersionName(minSupported != null ? minSupported : 1));
        return info;
    }

    /**
     * 判断用户是否在灰度范围内
     * 使用一致性哈希确保同一用户每次结果一致
     */
    private boolean isUserInRollout(String userIdOrDevice, int versionCode, int rolloutPercent) {
        String key = userIdOrDevice + ":" + versionCode;
        int hash = Math.abs(key.hashCode()) % 100;
        return hash < rolloutPercent;
    }
}
```

---

## 7. 优先级与超时策略

### 7.1 数据源优先级矩阵

| 优先级 | 数据源 | 超时(ms) | 降级策略 | 是否阻塞响应 |
| --- | --- | --- | --- | --- |
| **CRITICAL** | force_update | 200 | 返回"无更新"默认值 | 是（但默认值即安全） |
| **CRITICAL** | feature_flags | 200 | 返回最小Feature集 | 是（安全默认值） |
| **CRITICAL** | remote_config | 200 | 返回默认配置 | 是（安全默认值） |
| **HIGH** | user | 300 | 跳过（游客模式数据） | 仅已登录用户 |
| **HIGH** | membership | 300 | 返回free等级 | 仅已登录用户 |
| **HIGH** | student_profile | 300 | 跳过 | 仅已登录用户 |
| **NORMAL** | home_workspace | 300 | 返回空工作台 | 否 |
| **NORMAL** | announcements | 300 | 返回空列表 | 否 |
| **NORMAL** | popup | 300 | 不返回弹窗 | 否 |
| **NORMAL** | unread_stats | 300 | 全返回0 | 否 |
| **NORMAL** | today_tasks | 300 | 返回空任务 | 否 |
| **NORMAL** | mistake_reminder | 300 | 返回空提醒 | 否 |
| **NORMAL** | study_plan | 300 | 返回streak=0 | 否 |
| **NORMAL** | textbook | 300 | 跳过 | 否 |
| **LAZY** | experiments | 150 | 返回空列表 | 否 |
| **LAZY** | ai_buddy_unread | 150 | 返回0 | 否 |

### 7.2 总体超时控制

```java
/**
 * 整体超时策略：
 * - CRITICAL 数据源全部完成或超时后进入组装阶段
 * - NORMAL 数据源最多等待 350ms（比单个超时多50ms缓冲）
 * - LAZY 数据源最多等待 200ms
 * - 总体从请求到响应不超过 500ms
 */
public class BootConfigTimeoutPolicy {
    
    public static final int CRITICAL_PHASE_TIMEOUT_MS = 250;  // Critical阶段
    public static final int HIGH_PHASE_TIMEOUT_MS = 350;      // High阶段（含Critical）
    public static final int NORMAL_PHASE_TIMEOUT_MS = 400;    // Normal阶段
    public static final int TOTAL_TIMEOUT_MS = 500;           // 总超时
    public static final int LAZY_TIMEOUT_MS = 200;            // Lazy阶段
}
```

---

## 8. ETag 与条件请求

### 8.1 ETag 生成策略

ETag 由以下维度组合后取 MD5：

```java
public class ETagGenerator {
    
    public static String generate(BootConfigContext ctx, BootConfigResponse resp) {
        // 组合影响配置内容的关键维度
        String[] dimensions = {
            ctx.getUserIdOrGuest(),       // 用户维度
            ctx.getPlatform(),            // 平台维度
            ctx.getAppVersion(),          // 版本维度
            resp.getConfigVersion(),      // 配置版本
            String.valueOf(resp.getGeneratedAt() / 60000) // 分钟级时间桶
        };
        
        String raw = String.join("|", dimensions);
        String hash = DigestUtils.md5Hex(raw);
        return String.format("\"boot-v2-%s\"", hash.substring(0, 16));
    }
}
```

### 8.2 条件请求处理流程

```text
客户端                              服务端
  │                                    │
  │  POST /api/v1/boot/config          │
  │  If-None-Match: "boot-v2-a1b2"    │
  │  ├─────────────────────────────────►│
  │                                    │
  │                          ┌─────────┤
  │                          │ 1. 计算当前ETag
  │                          │ 2. 与If-None-Match比较
  │                          │ 3a. 匹配 → 返回 304
  │                          │ 3b. 不匹配 → 返回 200 + 新ETag
  │                          └─────────┤
  │  ◄────────────────────────────────┤
  │  304 Not Modified (无Body)         │
  │  或 200 + 完整Body                 │
  │                                    │
```

### 8.3 客户端缓存策略

```dart
// Flutter 客户端缓存处理伪代码
class BootConfigCache {
  static final _storage = LocalStorage('boot_config');
  
  static Future<BootConfigResponse?> getLocal() async {
    final json = _storage.read('boot_config');
    if (json == null) return null;
    final cached = BootConfigResponse.fromJson(jsonDecode(json));
    // 检查本地缓存是否在有效期内（30分钟）
    if (DateTime.now().millisecondsSinceEpoch - cached.generatedAt > 30 * 60 * 1000) {
      return null; // 过期
    }
    return cached;
  }
  
  static Future<void> save(BootConfigResponse response) async {
    _storage.write('boot_config', jsonEncode(response.toJson()));
    _storage.write('boot_etag', response.etag);
  }
}

// 启动流程
Future<BootConfigResponse> loadBootConfig() async {
  // 1. 先读本地缓存作为兜底
  final local = await BootConfigCache.getLocal();
  if (local != null) {
    // 后台异步刷新
    _refreshInBackground(etag: local.etag);
    return local; // 立即用本地缓存渲染首屏
  }
  
  // 2. 无缓存，同步请求（带 loading 动画）
  final remote = await api.post('/boot/config', body: request);
  await BootConfigCache.save(remote);
  return remote;
}
```

---

## 9. 错误处理与降级策略

### 9.1 错误分级与处理矩阵

| 场景 | 错误码 | HTTP状态 | 处理方式 |
| --- | --- | --- | --- |
| 请求参数缺失/非法 | 40001 | 400 | 返回错误详情 |
| Token 非法/过期 | 40101 | 401 | 返回需登录标记，客户端走游客模式 |
| 单数据源超时 | - | 200 | 该数据源标记 stale，使用默认值 |
| 单数据源异常 | - | 200 | 该数据源标记 error，使用默认值 |
| 全部数据源异常 | 50001 | 500 | 返回最小可用配置 |
| 服务限流 | 42901 | 429 | 返回 Retry-After 头 |
| 服务不可用 | 50301 | 503 | 返回降级配置（仅含 force_update + feature_flags） |

### 9.2 降级响应示例

```json
{
  "configVersion": "emergency-fallback",
  "generatedAt": 1722145800000,
  "serverTime": 1722145800123,
  "forceUpdate": {
    "required": false,
    "minVersion": "1.0.0"
  },
  "featureFlags": {
    "enable_ai_chat": true,
    "enable_photo_search": true,
    "enable_textbook": true,
    "enable_mistake_book": true
  },
  "remoteConfig": {
    "ai_stream_timeout_ms": 30000,
    "cdn_base_url": "https://cdn.primetop.cn"
  },
  "announcements": [],
  "experiments": [],
  "sourceStatus": {
    "user": "error",
    "membership": "error",
    "home": "error",
    "notification": "error",
    "study_plan": "error",
    "textbook": "error"
  },
  "_meta": {
    "degraded": true,
    "message": "部分服务暂时不可用，已使用默认配置"
  }
}
```

### 9.3 熔断器保护

```java
/**
 * 启动配置聚合服务使用熔断器保护下游服务
 * 当某个下游服务连续超时/异常时，自动熔断并走降级逻辑
 */
@Configuration
public class CircuitBreakerConfig {

    @Bean
    public CircuitBreakerRegistry circuitBreakerRegistry() {
        return CircuitBreakerRegistry.of(
            CircuitBreakerConfig.custom()
                .failureRateThreshold(50)           // 失败率阈值50%
                .slowCallRateThreshold(60)          // 慢调用率阈值60%
                .slowCallDurationThreshold(Duration.ofMillis(300))
                .waitDurationInOpenState(Duration.ofSeconds(30))
                .permittedNumberOfCallsInHalfOpenState(5)
                .slidingWindowSize(20)
                .minimumNumberOfCalls(10)
                .build()
        );
    }
}

// 在各数据源调用处应用熔断器
@CircuitBreaker(name = "userInfo", fallbackMethod = "getUserInfoFallback")
public UserInfo getUserInfo(BootConfigContext ctx) {
    return userApi.getById(ctx.getUserId()).toUserInfo();
}

public UserInfo getUserInfoFallback(BootConfigContext ctx, Exception e) {
    log.warn("[BootConfig] User service circuit breaker open, using fallback");
    return null; // 降级为游客视角
}
```

---

## 10. 配置变更通知机制

### 10.1 配置变更事件总线

当管理后台修改了配置（Feature Flag、远程配置、公告等），需要通知所有服务实例刷新缓存：

```java
/**
 * 配置变更事件监听器
 * 通过 Redis Pub/Sub 广播配置变更
 */
@Component
@Slf4j
public class ConfigChangeListener {

    @Autowired private BootConfigCacheManager cacheManager;
    @Autowired private StringRedisTemplate redis;

    /**
     * 监听配置变更消息
     */
    @PostConstruct
    public void subscribe() {
        redis.listenToChannel("config_change", (message, pattern) -> {
            ConfigChangeEvent event = JsonUtils.parse(message, ConfigChangeEvent.class);
            log.info("[BootConfig] Received config change: {}", event.getChangeType());

            switch (event.getChangeType()) {
                case "feature_flag":
                    cacheManager.invalidateByPattern("feature_flags");
                    break;
                case "remote_config":
                    cacheManager.invalidateByPattern("remote_config");
                    break;
                case "announcement":
                    cacheManager.invalidateByPattern("announcements");
                    break;
                case "popup":
                    cacheManager.invalidateByPattern("popup");
                    break;
                case "app_version":
                    cacheManager.invalidateByPattern("force_update");
                    cacheManager.invalidateByPattern("app_version");
                    break;
                case "all":
                    cacheManager.invalidateAll();
                    break;
            }

            // 通过 WebSocket 通知在线客户端
            notifyOnlineClients(event);
        });
    }

    /**
     * 通过 WebSocket 通知在线客户端刷新配置
     */
    private void notifyOnlineClients(ConfigChangeEvent event) {
        WebSocketMessage msg = new WebSocketMessage();
        msg.setType("config_changed");
        msg.setData(Map.of(
            "changedSections", event.getChangedSections(),
            "newConfigVersion", event.getNewConfigVersion(),
            "timestamp", System.currentTimeMillis()
        ));
        // 广播给所有在线客户端
        webSocketService.broadcast(msg);
    }
}
```

### 10.2 管理后台触发示例

```java
/**
 * 管理后台修改 Feature Flag 后触发缓存刷新
 */
@RestController
@RequestMapping("/admin/feature-flags")
public class FeatureFlagAdminController {

    @Autowired private FeatureFlagService flagService;
    @Autowired private StringRedisTemplate redis;

    @PutMapping("/{key}")
    public Result<Void> updateFlag(@PathVariable String key, @RequestBody FlagUpdateDTO dto) {
        flagService.update(key, dto);

        // 发布配置变更事件
        ConfigChangeEvent event = new ConfigChangeEvent();
        event.setChangeType("feature_flag");
        event.setChangedSections(List.of("feature_flags"));
        event.setNewConfigVersion(generateVersion());
        
        redis.convertAndSend("config_change", JsonUtils.stringify(event));

        return Result.success();
    }
}
```

---

## 11. 安全设计

### 11.1 接口安全

```java
/**
 * 启动配置接口安全策略
 */
// 1. 接口限流：单设备每分钟最多100次
@RateLimiter(name = "bootConfig", fallbackMethod = "rateLimitFallback")
// 2. 设备ID校验
@DeviceIdRequired
// 3. 版本号校验（防止恶意探测）
@VersionValidation
@PostMapping("/api/v1/boot/config")
public ResponseEntity<BootConfigResponse> bootConfig(
    @RequestBody @Valid BootConfigRequest request,
    @RequestHeader(value = "If-None-Match", required = false) String ifNoneMatch
) {
    request.setIfNoneMatch(ifNoneMatch);
    BootConfigResult result = bundleService.buildBootConfig(request);
    
    if (result.isNotModified()) {
        return ResponseEntity.status(HttpStatus.NOT_MODIFIED)
            .eTag(result.getEtag())
            .build();
    }

    return ResponseEntity.ok()
        .eTag(result.getEtag())
        .header("X-Config-Version", result.getResponse().getConfigVersion())
        .body(result.getResponse());
}
```

### 11.2 数据最小化原则

```java
/**
 * 根据用户身份返回不同精度的数据
 * - 游客：仅返回全局配置 + 游客引导
 * - 已认证未成年用户：完整数据，但过滤敏感字段
 * - 家长端请求：返回家长可见范围内的数据
 */
public class DataPrivacyFilter {

    public BootConfigResponse filter(BootConfigResponse response, BootConfigContext ctx) {
        if (!ctx.isLoggedIn()) {
            // 游客：移除所有用户相关数据
            response.setUser(null);
            response.setMembership(null);
            response.setStudentProfile(null);
            response.setHomeWorkspace(null);
            response.setTodayTasks(null);
            response.setMistakeReviewReminder(null);
            response.setStudyPlanSummary(null);
            response.setAiBuddyUnread(null);
            return response;
        }

        // 已登录用户：移除手机号等敏感字段（本来就不包含）
        // 青少年模式：过滤不当内容公告
        if (ctx.isMinor()) {
            response.setAnnouncements(filterAnnouncementsForMinor(response.getAnnouncements()));
            response.setPopup(filterPopupForMinor(response.getPopup()));
        }

        return response;
    }
}
```

---

## 12. 性能优化策略

### 12.1 响应体压缩

```java
/**
 * 响应体优化策略
 */
public class ResponseOptimizer {

    /**
     * 移除空值字段，减少 Payload 大小
     */
    public String optimizeToJson(BootConfigResponse response) {
        ObjectMapper mapper = new ObjectMapper();
        mapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);
        mapper.setSerializationInclusion(JsonInclude.Include.NON_EMPTY);

        String json = mapper.writeValueAsString(response);

        // 大响应体进一步压缩字段名（可选，通过 GZIP 已足够）
        return json;
    }

    /**
     * 字段精简映射表（减少长字段名）
     * 仅在 Payload 超过 50KB 时启用
     */
    private static final Map<String, String> FIELD_COMPRESS_MAP = Map.of(
        "configVersion", "cv",
        "generatedAt", "ga",
        "serverTime", "st",
        "forceUpdate", "fu",
        "featureFlags", "ff",
        "announcements", "an",
        "membership", "mb",
        "studentProfile", "sp",
        "homeWorkspace", "hw",
        "unreadStats", "us",
        "todayTasks", "tt",
        "sourceStatus", "ss"
    );
}
```

### 12.2 GZIP 压缩配置

```yaml
# Spring Boot application.yml
server:
  compression:
    enabled: true
    mime-types: application/json
    min-response-size: 1024  # 超过1KB才压缩
```

### 12.3 预计算策略

对于计算密集型数据源，采用预计算 + 定时刷新：

```java
/**
 * 首页工作台数据预计算
 * 每5分钟为活跃用户预计算一次，避免实时查询
 */
@Scheduled(fixedRate = 5 * 60 * 1000)
public void preComputeHomeWorkspace() {
    // 获取最近7天活跃的用户
    List<Long> activeUserIds = userService.getActiveUserIds(7);
    
    int batchSize = 500;
    Lists.partition(activeUserIds, batchSize).forEach(batch -> {
        CompletableFuture.runAsync(() -> {
            for (Long userId : batch) {
                try {
                    HomeWorkspaceData data = computeHomeWorkspace(userId);
                    // 存入 Redis 预计算缓存
                    redis.opsForValue().set(
                        "pre_compute:home:" + userId,
                        JsonUtils.stringify(data),
                        10, TimeUnit.MINUTES
                    );
                } catch (Exception e) {
                    log.warn("Pre-compute failed for user {}: {}", userId, e.getMessage());
                }
            }
        }, preComputeExecutor);
    });
}

// 启动配置聚合时，直接读取预计算结果
public HomeWorkspaceData getWorkspace(BootConfigContext ctx) {
    String cached = redis.opsForValue().get("pre_compute:home:" + ctx.getUserId());
    if (cached != null) {
        return JsonUtils.parse(cached, HomeWorkspaceData.class);
    }
    // 缓存未命中，实时计算（可能稍慢）
    return computeHomeWorkspace(ctx.getUserId());
}
```

---

## 13. 监控与告警

### 13.1 关键监控指标

| 指标名 | 类型 | 告警阈值 | 说明 |
| --- | --- | --- | --- |
| boot_config_request_total | Counter | - | 请求总数 |
| boot_config_request_duration | Histogram | P99 > 500ms | 请求耗时分布 |
| boot_config_cache_hit_rate | Gauge | < 80% | 缓存命中率 |
| boot_config_source_degraded | Counter | 单源降级率 > 10% | 数据源降级次数 |
| boot_config_source_duration{source} | Histogram | 单源 P99 > 300ms | 各数据源耗时 |
| boot_config_payload_size | Histogram | P99 > 80KB | 响应体大小 |
| boot_config_304_rate | Gauge | - | 304 响应占比 |
| boot_config_etag_match_rate | Gauge | - | ETag 匹配率 |
| boot_config_force_update_rate | Gauge | - | 强制更新触发率 |

### 13.2 Prometheus 指标定义

```java
@Component
public class BootConfigMetrics {

    private final MeterRegistry registry;

    private final Counter requestTotal;
    private final Timer requestDuration;
    private final Counter sourceDegraded;
    private final Gauge cacheHitRate;

    public BootConfigMetrics(MeterRegistry registry) {
        this.registry = registry;
        this.requestTotal = Counter.builder("boot_config_request_total")
            .description("Boot config request total count")
            .register(registry);
        this.requestDuration = Timer.builder("boot_config_request_duration")
            .description("Boot config request duration")
            .publishPercentiles(0.5, 0.95, 0.99)
            .register(registry);
        this.sourceDegraded = Counter.builder("boot_config_source_degraded")
            .description("Data source degraded count")
            .tag("source", "")
            .register(registry);
    }

    public void recordRequest(long durationMs, boolean cacheHit, boolean notModified) {
        requestTotal.increment();
        requestDuration.record(durationMs, TimeUnit.MILLISECONDS);
        // ... record other metrics
    }

    public void recordSourceResult(String source, String status, long durationMs) {
        if (!"ok".equals(status)) {
            registry.counter("boot_config_source_degraded", "source", source, "status", status)
                .increment();
        }
        registry.timer("boot_config_source_duration", "source", source)
            .record(durationMs, TimeUnit.MILLISECONDS);
    }
}
```

### 13.3 告警规则（Prometheus AlertManager）

```yaml
groups:
  - name: boot_config
    rules:
      - alert: BootConfigHighLatency
        expr: histogram_quantile(0.99, boot_config_request_duration_seconds_bucket) > 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Boot config P99 latency > 500ms"
          
      - alert: BootConfigLowCacheHit
        expr: boot_config_cache_hit_rate < 0.8
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Boot config cache hit rate < 80%"
          
      - alert: BootConfigHighDegradation
        expr: rate(boot_config_source_degraded_total[5m]) / rate(boot_config_request_total[5m]) > 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Boot config data source degradation rate > 10%"
```

---

## 14. 状态流转

### 14.1 请求处理状态机

```text
                    ┌──────────┐
                    │ RECEIVED │
                    └────┬─────┘
                         │
                    ┌────▼─────┐
              ┌─────│ PARSE    │
              │     └────┬─────┘
              │          │
              │     ┌────▼─────┐
              │     │ AUTH     │─────► 401 (Token无效→游客模式继续)
              │     └────┬─────┘
              │          │
              │     ┌────▼─────┐
              │     │ CACHE    │─────► 304 (ETag匹配)
              │     │ CHECK    │
              │     └────┬─────┘
              │          │ (缓存未命中或过期)
              │     ┌────▼─────┐
              │     │ PARALLEL │
              │     │ FETCH    │
              │     └────┬─────┘
              │          │
   429 ◄─────┤     ┌────▼─────┐
   (限流)     │     │ ASSEMBLE │
              │     └────┬─────┘
              │          │
              │     ┌────▼─────┐
              │     │ COMPRESS │
              │     └────┬─────┘
              │          │
              │     ┌────▼─────┐
              │     │ RESPONSE │─────► 200 + Body
              │     └──────────┘
              │
   503 ◄──────┤
   (服务不可用)
```

### 14.2 数据源拉取状态流转

```text
每个数据源独立状态流转：

    ┌──────────┐  调用下游服务   ┌──────────────┐
    │ PENDING  │──────────────►│ FETCHING     │
    └──────────┘                └──────┬───────┘
                                       │
                           ┌───────────┼───────────┐
                           │           │           │
                     成功  │     超时  │    异常   │
                           ▼           ▼           ▼
                    ┌──────────┐ ┌──────────┐ ┌──────────┐
                    │ SUCCESS  │ │ TIMEOUT  │ │ ERROR    │
                    └──────────┘ └──────────┘ └──────────┘
                         │           │           │
                         │           ▼           ▼
                         │    ┌──────────────────────┐
                         │    │ DEGRADED             │
                         │    │ (使用默认值/降级值)   │
                         │    └──────────────────────┘
                         │           │
                         ▼           ▼
                    ┌──────────────────────┐
                    │ ASSEMBLED            │
                    │ (数据组装到最终响应)  │
                    └──────────────────────┘
```

---

## 15. 客户端集成指南

### 15.1 客户端调用时序

```text
App启动
  │
  ├─► [同步] 读取本地缓存的 boot config
  │         │
  │         ├─► 有缓存 ──► 用缓存数据初始化 → 渲染首屏
  │         │                              │
  │         │                              └─► [后台] 请求最新 boot config
  │         │                                    │
  │         │                                    ├─► 304 → 静默忽略
  │         │                                    ├─► 200 → 更新缓存 + 增量刷新UI
  │         │                                    └─► Error → 保持本地缓存
  │         │
  │         └─► 无缓存 ──► 显示启动Loading
  │                          │
  │                          └─► [同步] 请求 boot config
  │                                │
  │                                ├─► 200 → 渲染首屏 + 缓存
  │                                └─► Error → 显示重试页面
  │                                        │
  │                                        └─► 重试 → 成功则正常流程
  │
  ├─► 首屏渲染完成
  │         │
  │         └─► [后台] 请求 lazy data
  │
  └─► WebSocket 连接建立（监听配置变更）
```

### 15.2 Flutter 客户端核心实现

```dart
/// 启动配置管理器
class BootConfigManager {
  static final BootConfigManager _instance = BootConfigManager._();
  factory BootConfigManager() => _instance;
  BootConfigManager._();

  BootConfigResponse? _current;
  String? _etag;

  BootConfigResponse? get current => _current;

  /// 初始化启动配置（在 App 启动时调用）
  Future<BootConfigResponse> initialize() async {
    // 1. 尝试读取本地缓存
    final local = await _readLocalCache();
    
    if (local != null) {
      _current = local;
      // 后台静默刷新
      _refreshInBackground();
      return local;
    }

    // 2. 无缓存，同步请求
    try {
      final response = await _fetchFromServer();
      _current = response;
      await _saveLocalCache(response);
      return response;
    } catch (e) {
      // 3. 请求失败，使用兜底配置
      return _fallbackConfig();
    }
  }

  Future<BootConfigResponse> _fetchFromServer() async {
    final request = BootConfigRequest(
      appVersion: await PackageInfo.getVersion(),
      platform: Platform.isAndroid ? 'android' : 'ios',
      deviceId: await _getDeviceId(),
      osVersion: '${Platform.operatingSystem} ${Platform.operatingSystemVersion}',
      locale: LocaleUtils.currentLocale,
      token: AuthManager.token,
      ifNoneMatch: _etag,
      launchType: _detectLaunchType(),
    );

    final dio = Dio();
    dio.options.headers['If-None-Match'] = _etag;
    
    final response = await dio.post(
      '${Environment.apiBaseUrl}/api/v1/boot/config',
      data: request.toJson(),
      options: Options(responseType: ResponseType.json),
    );

    if (response.statusCode == 304) {
      // 配置未变更，保持当前配置
      return _current!;
    }

    final bootResponse = BootConfigResponse.fromJson(response.data);
    _etag = response.headers.value('etag');
    _current = bootResponse;
    
    return bootResponse;
  }

  void _refreshInBackground() async {
    try {
      final fresh = await _fetchFromServer();
      if (fresh.configVersion != _current?.configVersion) {
        _current = fresh;
        await _saveLocalCache(fresh);
        // 通知UI更新
        EventBus.instance.emit(BootConfigUpdatedEvent(fresh));
      }
    } catch (e) {
      // 后台刷新失败，静默忽略
      debugPrint('[BootConfig] Background refresh failed: $e');
    }
  }

  /// 监听 WebSocket 配置变更通知
  void onConfigChanged(WebSocketMessage msg) {
    if (msg.type == 'config_changed') {
      _refreshInBackground();
    }
  }

  /// 兜底配置（网络完全不可用时）
  BootConfigResponse _fallbackConfig() {
    return BootConfigResponse(
      configVersion: 'fallback',
      generatedAt: DateTime.now().millisecondsSinceEpoch,
      serverTime: DateTime.now().millisecondsSinceEpoch,
      forceUpdate: ForceUpdateInfo.noUpdate(),
      featureFlags: FeatureFlagDefaults.allEnabled(),
      announcements: [],
      experiments: [],
    );
  }
}
```

---

## 16. 测试策略

### 16.1 单元测试

| 测试范围 | 重点 |
| --- | --- |
| ParallelFetcher | 各数据源独立超时、异常隔离、降级返回 |
| BootConfigAssembler | 数据源缺失时使用默认值、sourceStatus 正确标记 |
| ETagGenerator | 相同输入生成相同ETag、不同输入生成不同ETag |
| CacheManager | L1/L2 读写一致性、过期淘汰、批量失效 |
| AppVersionService | 强制更新判断、灰度发布范围、版本号比较 |

### 16.2 集成测试

| 场景 | 验证点 |
| --- | --- |
| 冷启动-已登录用户 | 响应包含完整用户数据，响应时间 < 300ms |
| 冷启动-游客 | 响应不含用户数据，功能开关正确 |
| ETag 命中 | 返回 304，无响应体 |
| 单数据源超时 | 响应中该源标记 stale，不影响其他数据 |
| 全部数据源异常 | 返回降级配置，HTTP 200 |
| 管理后台改配置 | WebSocket 通知客户端刷新 |
| 限流 | 第101次请求返回 429 |

### 16.3 压测场景

```
场景1：10万用户同时冷启动
- 目标：P99 < 500ms，错误率 < 0.1%
- 策略：缓存预热 + 连接池预热 + 自动伸缩

场景2：配置全局变更（清空所有缓存）
- 目标：5秒内恢复缓存命中率 > 80%
- 策略：渐进式缓存重建 + 请求合并

场景3：下游服务故障
- 目标：聚合服务正常返回，降级标记正确
- 策略：熔断器 + 降级兜底
```

---

## 17. 部署与容量规划

### 17.1 资源规划

| 并发量 | CPU | 内存 | 实例数 | Redis | 备注 |
| --- | --- | --- | --- | --- | --- |
| 1万 QPS | 4C | 8G | 4 | 3主3从 | 初期规模 |
| 5万 QPS | 8C | 16G | 8 | 5主5从 | 增长期 |
| 10万 QPS | 8C | 16G | 16 | 集群模式 | 成熟期 |

### 17.2 连接池配置

```yaml
# 下游服务调用连接池
dubbo:
  protocol:
    threads: 200       # 线程池大小
    iothreads: 4       # IO线程数
  consumer:
    threadpool: cached
    connections: 50    # 每提供者连接数
    timeout: 5000      # 默认超时（实际由 ParallelFetcher 控制）

# HTTP 客户端连接池（调用内部 REST 服务时）
http-client:
  max-connections: 200
  connect-timeout: 500ms
  read-timeout: 300ms
  connection-pool-size: 100
```

---

## 18. 附录

### 18.1 错误码表

| 错误码 | HTTP | 含义 | 客户端处理 |
| --- | --- | --- | --- |
| 40001 | 400 | 请求参数非法 | 检查参数后重试 |
| 40101 | 401 | Token无效/过期 | 刷新Token或走游客模式 |
| 42901 | 429 | 请求限流 | 读取Retry-After头等待 |
| 50001 | 500 | 服务内部错误 | 使用本地缓存 |
| 50301 | 503 | 服务不可用 | 使用兜底配置 |

### 18.2 配置版本号规则

```
格式：{yyyyMMdd}_{sequence}
示例：20260728_001、20260728_002

生成规则：
- 每次服务端配置变更，sequence +1
- 每天零点重置 sequence
- 紧急降级配置使用 "emergency-fallback" 特殊标识
```

### 18.3 与其他服务的关系图

```text
                    ┌────────────────────┐
                    │ Boot Config Bundle │
                    │     Service        │
                    └────────┬───────────┘
                             │
           ┌─────────────────┼─────────────────────┐
           │                 │                      │
    ┌──────▼──────┐  ┌──────▼──────┐      ┌────────▼────────┐
    │ 用户服务     │  │ 版本管理服务 │      │  Feature Flag   │
    │ UserSvc     │  │ VersionSvc  │      │  Service        │
    └──────┬──────┘  └─────────────┘      └─────────────────┘
           │
    ┌──────▼──────┐  ┌──────────────┐      ┌─────────────────┐
    │ 会员服务     │  │ 公告/弹窗服务 │      │ Remote Config   │
    │ MemberSvc   │  │ ContentSvc   │      │ Service         │
    └─────────────┘  └──────────────┘      └─────────────────┘

    ┌──────────────┐  ┌──────────────┐      ┌─────────────────┐
    │ 学习记录服务  │  │ 通知服务     │      │ 实验平台(AB)     │
    │ LearnSvc     │  │ NotifySvc    │      │ ExperimentSvc   │
    └──────────────┘  └──────────────┘      └─────────────────┘

    ┌──────────────┐  ┌──────────────┐      ┌─────────────────┐
    │ 错题服务     │  │ 学习计划服务 │      │ 教材服务         │
    │ MistakeSvc   │  │ PlanSvc      │      │ TextbookSvc     │
    └──────────────┘  └──────────────┘      └─────────────────┘
```

### 18.4 文档变更记录

| 日期 | 版本 | 变更内容 |
| --- | --- | --- |
| 2026-07-28 | v1.0 | 初始版本 |
