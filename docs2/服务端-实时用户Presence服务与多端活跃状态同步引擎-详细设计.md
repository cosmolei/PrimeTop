# 服务端-实时用户 Presence 服务与多端活跃状态同步引擎 详细设计

## 1. 概述

### 1.1 模块定位

实时 Presence 服务是 PrimeTop 平台的**核心基础设施层**组件，负责统一管理全平台用户在线状态、当前学习活动上下文以及多端设备活跃状态。它为在线自习室、家长实时监控、教师班级仪表盘、智能通知调度、AI 助手上下文感知等上层业务提供底层的"谁在线、在做什么"状态支撑。

### 1.2 核心职责

| 职责 | 说明 |
| --- | --- |
| 在线状态管理 | 维护用户在所有终端（App/Web/小程序）的实时在线/离线状态 |
| 活动上下文追踪 | 记录用户当前正在进行的学习活动（科目、模块、具体内容） |
| 多端状态同步 | 当用户在多设备同时在线时，维护设备优先级与最新活动状态 |
| 状态变更广播 | 将用户状态变更事件实时推送给订阅方（家长端、教师端、自习室同伴等） |
| 心跳保活与超时回收 | 管理客户端心跳，自动检测静默掉线并回收状态 |
| 活跃度数据输出 | 为数据分析系统提供实时活跃用户数（DAU/PCU）等指标信号 |

### 1.3 依赖关系

```
                        ┌──────────────────────────────────────┐
                        │       Presence Service               │
                        │  (Redis + WebSocket + Event Bus)     │
                        └──────────┬───────────────────────────┘
                                   │
          ┌────────────────────────┼────────────────────────────┐
          │                        │                             │
  ┌───────▼────────┐    ┌──────────▼──────────┐    ┌────────────▼──────────┐
  │  WebSocket      │    │  Learning Service    │    │  Notification Service │
  │  Gateway        │    │  (活动上下文来源)     │    │  (通知时机优化)        │
  │  (心跳通道)      │    └─────────────────────┘    └───────────────────────┘
  └───────┬────────┘
          │
  ┌───────▼────────┐    ┌──────────────────────┐    ┌──────────────────────┐
  │  Client (App/   │    │  Parent Monitor       │    │  Teacher Dashboard   │
  │  Web/MiniApp)   │    │  (家长实时查看)         │    │  (教师实时查看)        │
  └────────────────┘    └──────────────────────┘    └──────────────────────┘
```

**上游依赖：**
- WebSocket 长连接管理与实时双向通信引擎：提供心跳通道和消息推送能力
- 用户服务：提供用户基本信息、学段、年级
- 学习会话编排与上下文管理引擎：提供当前学习活动上下文

**下游消费方：**
- 在线自习室与虚拟学习空间实时同步引擎：房间内成员在线状态
- 家长中心：家长查看孩子实时学习状态
- 教师端班级管理：查看学生在线与活跃情况
- 统一通知消息调度：避免用户活跃时频繁推送
- AI 智能辅导对话：感知用户当前学习场景，增强对话上下文
- 数据分析平台：实时DAU/PCU统计

---

## 2. 数据模型

### 2.1 Redis 核心数据结构

Presence 服务以 **Redis** 为核心存储，利用其丰富的数据结构和过期机制实现高性能状态管理。

#### 2.1.1 用户在线状态 Hash

```
Key:  presence:user:{userId}
Type: Hash
Fields:
  - status          : "online" | "idle" | "offline"
  - last_active_ts  : 最后活动时间戳 (Unix ms)
  - last_heartbeat  : 最后心跳时间戳 (Unix ms)
  - device_count    : 当前在线设备数
  - current_module  : 当前活跃模块 (如 "ai_chat", "practice", "study_room")
  - current_subject : 当前学习科目 (如 "math", "english")
  - current_content : 当前学习内容标识 (如 chapter_id / question_id / room_id)
  - platform        : 主设备平台 ("android" | "ios" | "web" | "miniapp")
  - app_version     : App 版本号
TTL:  无 (通过心跳超时机制主动清理)
```

#### 2.1.2 设备会话 Hash（每设备一条）

```
Key:  presence:device:{userId}:{deviceId}
Type: Hash
Fields:
  - status          : "online" | "idle" | "offline"
  - platform        : "android" | "ios" | "web" | "miniapp"
  - app_version     : App 版本号
  - connect_ts      : WebSocket 连接建立时间
  - last_active_ts  : 最后活动时间戳
  - last_heartbeat  : 最后心跳时间戳
  - current_module  : 当前模块
  - current_subject : 当前科目
  - current_content : 当前内容标识
  - push_token      : 推送 Token (可选，用于在线时不推推送)
  - network_type    : "wifi" | "4g" | "5g" | "unknown"
TTL:  120s (心跳间隔的 2 倍，超时自动清除)
```

#### 2.1.3 用户设备列表 Set

```
Key:  presence:user_devices:{userId}
Type: Set
Members: deviceId 列表
TTL:  无 (设备下线时主动移除)
```

#### 2.1.4 在线用户集合（按维度分桶）

```
# 全局在线用户集合
Key:  presence:online:all
Type: Set (或 HyperLogLog 用于粗略计数)
Members: userId

# 按学段分桶
Key:  presence:online:stage:{stageCode}    # 如 primary, junior, senior
Type: Set

# 按科目分桶（当前正在学习某科目的用户）
Key:  presence:online:subject:{subjectCode}
Type: Set

# 按模块分桶
Key:  presence:online:module:{moduleCode}
Type: Set
```

#### 2.1.5 Presence 订阅频道

```
# 用户状态变更发布/订阅频道
Channel: presence:events:{userId}
Type: Pub/Sub
Messages: PresenceEvent JSON

# 批量状态变更频道（用于系统级监控）
Channel: presence:events:batch
Type: Pub/Sub
```

#### 2.1.6 自习室/群组成员在线状态

```
Key:  presence:room:{roomId}
Type: Hash
Fields:
  - {userId} : JSON { "deviceId": "xxx", "lastActive": 1234567890, "module": "study" }
TTL:  无 (房间关闭时主动删除)
```

### 2.2 MySQL 持久化模型（历史记录与分析）

```sql
-- 用户每日活跃记录表（T+1 批量写入，用于数据分析）
CREATE TABLE `user_presence_daily` (
  `id`              BIGINT       NOT NULL AUTO_INCREMENT,
  `user_id`         BIGINT       NOT NULL,
  `date`            DATE         NOT NULL,
  `first_online_ts`  DATETIME     DEFAULT NULL COMMENT '当日首次在线时间',
  `last_online_ts`   DATETIME     DEFAULT NULL COMMENT '当日最后在线时间',
  `total_online_sec` INT          DEFAULT 0    COMMENT '当日总在线秒数',
  `total_active_sec` INT          DEFAULT 0    COMMENT '当日活跃学习秒数',
  `max_concurrent_devices` TINYINT DEFAULT 1  COMMENT '当日最大同时在线设备数',
  `platforms`       VARCHAR(64)  DEFAULT ''   COMMENT '使用过的平台，逗号分隔',
  `modules_used`    VARCHAR(256) DEFAULT ''   COMMENT '使用过的模块，逗号分隔',
  `subjects_studied` VARCHAR(128) DEFAULT ''  COMMENT '学习过的科目，逗号分隔',
  `heartbeat_count` INT          DEFAULT 0    COMMENT '心跳次数',
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_date` (`user_id`, `date`),
  KEY `idx_date` (`date`),
  KEY `idx_user_date` (`user_id`, `date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户每日Presence记录';

-- 用户会话明细表（用于行为分析，保留 90 天）
CREATE TABLE `user_presence_session` (
  `id`              BIGINT       NOT NULL AUTO_INCREMENT,
  `user_id`         BIGINT       NOT NULL,
  `device_id`       VARCHAR(128) NOT NULL,
  `platform`        VARCHAR(16)  NOT NULL,
  `app_version`     VARCHAR(32)  DEFAULT NULL,
  `connect_ts`      DATETIME     NOT NULL COMMENT '会话开始时间',
  `disconnect_ts`   DATETIME     DEFAULT NULL COMMENT '会话结束时间',
  `duration_sec`    INT          DEFAULT 0 COMMENT '会话时长(秒)',
  `last_module`     VARCHAR(32)  DEFAULT NULL COMMENT '最后活跃模块',
  `last_subject`    VARCHAR(16)  DEFAULT NULL COMMENT '最后学习科目',
  `network_type`    VARCHAR(8)   DEFAULT NULL,
  `disconnect_reason` VARCHAR(32) DEFAULT NULL COMMENT '主动/超时/踢出/异常',
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_connect` (`user_id`, `connect_ts`),
  KEY `idx_connect_ts` (`connect_ts`),
  KEY `idx_device` (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户Presence会话明细'
PARTITION BY RANGE (TO_DAYS(connect_ts)) (
  -- 按月分区，自动清理90天以前数据
);

-- Presence 事件流表（可选，用于事件回放和调试）
CREATE TABLE `presence_event_log` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT       NOT NULL,
  `device_id`   VARCHAR(128) DEFAULT NULL,
  `event_type`  VARCHAR(32)  NOT NULL COMMENT 'online/offline/idle/active/module_change/subject_change',
  `old_value`   VARCHAR(256) DEFAULT NULL,
  `new_value`   VARCHAR(256) DEFAULT NULL,
  `metadata`    JSON         DEFAULT NULL,
  `created_ts`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_user_ts` (`user_id`, `created_ts`),
  KEY `idx_event_type` (`event_type`),
  KEY `idx_created_ts` (`created_ts`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Presence事件日志';
```

---

## 3. API 接口设计

### 3.1 心跳上报接口

**通过 WebSocket 消息帧**而非 HTTP 接口实现，避免额外连接开销。

```
WebSocket Message Type: "heartbeat"
Direction: Client → Server

Payload:
{
  "type": "heartbeat",
  "deviceId": "abc-123-def",
  "platform": "android",
  "appVersion": "1.2.0",
  "module": "ai_chat",          // 当前模块，可选
  "subject": "math",            // 当前科目，可选
  "contentId": "ch_7_2_3",     // 当前内容ID，可选
  "networkType": "wifi"         // 网络类型，可选
}

Server Response:
{
  "type": "heartbeat_ack",
  "serverTs": 1700000000000,   // 服务器时间戳
  "status": "online",          // 当前状态
  "interval": 30                // 下次心跳间隔(秒)
}
```

### 3.2 活动状态更新接口

```
WebSocket Message Type: "presence_update"
Direction: Client → Server

Payload:
{
  "type": "presence_update",
  "deviceId": "abc-123-def",
  "module": "practice",         // 切换到的模块
  "subject": "english",         // 切换到的科目
  "contentId": "quiz_456",     // 切换到的内容
  "action": "enter"             // enter | leave
}
```

### 3.3 HTTP 查询接口

#### 3.3.1 查询单个用户状态

```
GET /api/v1/presence/{userId}
```

**Response:**
```json
{
  "code": 0,
  "data": {
    "userId": 10001,
    "status": "online",
    "platform": "android",
    "module": "ai_chat",
    "subject": "math",
    "contentId": "ch_7_2_3",
    "lastActiveAt": "2026-07-07T05:30:00+08:00",
    "onlineDuration": 1800,
    "devices": [
      {
        "deviceId": "abc-123",
        "platform": "android",
        "status": "online",
        "lastActiveAt": "2026-07-07T05:30:00+08:00"
      }
    ]
  }
}
```

#### 3.3.2 批量查询用户状态

```
POST /api/v1/presence/batch
```

**Request:**
```json
{
  "userIds": [10001, 10002, 10003],
  "fields": ["status", "module", "subject"]  // 可选，指定返回字段
}
```

**Response:**
```json
{
  "code": 0,
  "data": {
    "users": [
      { "userId": 10001, "status": "online", "module": "ai_chat", "subject": "math" },
      { "userId": 10002, "status": "offline", "module": null, "subject": null },
      { "userId": 10003, "status": "idle", "module": "practice", "subject": "english" }
    ]
  }
}
```

#### 3.3.3 查询房间/群组在线成员

```
GET /api/v1/presence/room/{roomId}/members
```

**Response:**
```json
{
  "code": 0,
  "data": {
    "roomId": "study_room_123",
    "onlineCount": 5,
    "members": [
      {
        "userId": 10001,
        "nickname": "小明",
        "avatar": "https://...",
        "status": "online",
        "module": "study",
        "joinedAt": "2026-07-07T05:00:00+08:00"
      }
    ]
  }
}
```

#### 3.3.4 查询在线统计

```
GET /api/v1/presence/stats
```

**Query Params:**
- `dimension` : `all` | `stage` | `subject` | `module`
- `granularity` : `realtime` | `hourly` | `daily`

**Response:**
```json
{
  "code": 0,
  "data": {
    "totalOnline": 12580,
    "byStage": {
      "kindergarten": 320,
      "primary": 5800,
      "junior": 4200,
      "senior": 2260
    },
    "byModule": {
      "ai_chat": 3800,
      "practice": 2900,
      "sync_classroom": 2100,
      "study_room": 850,
      "mistake_review": 530,
      "other": 2400
    },
    "timestamp": "2026-07-07T05:39:00+08:00"
  }
}
```

#### 3.3.5 订阅用户状态变更（服务端推送）

```
WebSocket Message Type: "presence_subscribe"
Direction: Client → Server

Payload:
{
  "type": "presence_subscribe",
  "userIds": [10001, 10002],   // 订阅的用户列表
  "events": ["online", "offline", "module_change"]  // 订阅的事件类型
}

# 服务端推送变更事件
Direction: Server → Client
{
  "type": "presence_event",
  "userId": 10001,
  "event": "module_change",
  "data": {
    "oldModule": "ai_chat",
    "newModule": "practice",
    "subject": "math",
    "timestamp": "2026-07-07T05:35:00+08:00"
  }
}
```

---

## 4. 业务逻辑

### 4.1 核心流程：设备上线

```
┌────────────┐     ┌─────────────────┐     ┌──────────────────┐
│   Client    │     │  WS Gateway      │     │  Presence        │
│  (App/Web)  │     │                  │     │  Service         │
└──────┬─────┘     └────────┬─────────┘     └────────┬─────────┘
       │                    │                         │
       │ 1. WebSocket       │                         │
       │    CONNECT         │                         │
       │───────────────────>│                         │
       │                    │                         │
       │                    │ 2. onOpen(deviceId,     │
       │                    │    userId, platform)    │
       │                    │────────────────────────>│
       │                    │                         │
       │                    │                 ┌───────┴────────┐
       │                    │                 │ 3. 写入设备Hash  │
       │                    │                 │    presence:    │
       │                    │                 │    device:{uid} │
       │                    │                 │    {deviceId}   │
       │                    │                 ├────────────────┤
       │                    │                 │ 4. 加入设备列表  │
       │                    │                 │    SADD         │
       │                    │                 │    user_devices │
       │                    │                 ├────────────────┤
       │                    │                 │ 5. 更新用户状态  │
       │                    │                 │    presence:    │
       │                    │                 │    user:{uid}   │
       │                    │                 ├────────────────┤
       │                    │                 │ 6. 加入在线集合  │
       │                    │                 │    SADD         │
       │                    │                 │    online:all   │
       │                    │                 ├────────────────┤
       │                    │                 │ 7. 发布事件      │
       │                    │                 │    PUBLISH      │
       │                    │                 │    presence:    │
       │                    │                 │    events:{uid} │
       │                    │                 └───────┬────────┘
       │                    │                         │
       │                    │ 8. ack + interval       │
       │<───────────────────│<────────────────────────│
       │                    │                         │
```

### 4.2 核心流程：心跳保活

```
Client                    WS Gateway              Presence Service
   │                           │                           │
   │  heartbeat (every 30~60s) │                           │
   │──────────────────────────>│                           │
   │                           │                           │
   │                           │  updateHeartbeat(uid,     │
   │                           │    deviceId, activity)    │
   │──────────────────────────>│──────────────────────────>│
   │                           │                           │
   │                           │              ┌────────────┴───────────┐
   │                           │              │ 1. 更新 device Hash     │
   │                           │              │    EXPIRE 120s         │
   │                           │              │ 2. 更新 user Hash       │
   │                           │              │    last_heartbeat       │
   │                           │              │    last_active_ts       │
   │                           │              │ 3. 更新活动上下文        │
   │                           │              │    (如携带 module 信息)  │
   │                           │              │ 4. 更新分桶集合          │
   │                           │              │    (如科目变更)          │
   │                           │              └────────────┬───────────┘
   │                           │                           │
   │  heartbeat_ack            │                           │
   │<──────────────────────────│<──────────────────────────│
```

### 4.3 核心流程：设备下线

```
Client                    WS Gateway              Presence Service
   │                           │                           │
   │  WS CLOSE / 异常断开        │                           │
   │──────────────────────────>│                           │
   │                           │                           │
   │                           │  onClose(deviceId, uid)   │
   │                           │──────────────────────────>│
   │                           │                           │
   │                           │              ┌────────────┴───────────┐
   │                           │              │ 1. 删除设备 Hash         │
   │                           │              │    DEL presence:device: │
   │                           │              │    {uid}:{deviceId}     │
   │                           │              │ 2. 从设备列表移除        │
   │                           │              │    SREM user_devices    │
   │                           │              │ 3. 检查剩余设备数        │
   │                           │              │    SCARD user_devices   │
   │                           │              ├────────────────────────┤
   │                           │              │ IF device_count == 0:   │
   │                           │              │   4a. 设用户 offline     │
   │                           │              │   5a. 移出在线集合       │
   │                           │              │   6a. 发布 offline 事件  │
   │                           │              │   7a. 写入会话明细       │
   │                           │              │ ELSE:                    │
   │                           │              │   4b. 保持 online        │
   │                           │              │   5b. 主设备切换         │
   │                           │              │      (选最新活跃设备)     │
   │                           │              └────────────┬───────────┘
```

### 4.4 核心流程：心跳超时回收

```
┌─────────────────────────────────────────────────────────┐
│                   Presence Reaper (定时扫描)              │
│                 (每 15 秒执行一次)                        │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
           ┌──────────────────────────────┐
           │ 1. 扫描 SCARD online:all     │
           │    获取所有在线 userId       │
           └──────────────┬───────────────┘
                          │
           ┌──────────────▼───────────────┐
           │ 2. 对每个 userId:             │
           │    HGET presence:user:{uid}  │
           │    last_heartbeat            │
           └──────────────┬───────────────┘
                          │
           ┌──────────────▼───────────────┐
           │ 3. IF now - last_heartbeat   │
           │      > 120s (心跳超时):      │
           │    → 触发静默掉线处理         │
           └──────────────────────────────┘
```

**静默掉线处理逻辑：**

```java
public void handleSilentDisconnect(Long userId) {
    // 1. 获取该用户所有设备
    Set<String> deviceIds = redis.smembers(
        keyBuilder.userDevices(userId)
    );

    long now = System.currentTimeMillis();
    List<String> expiredDevices = new ArrayList<>();
    List<String> aliveDevices = new ArrayList<>();

    // 2. 逐设备检查心跳
    for (String deviceId : deviceIds) {
        String deviceKey = keyBuilder.deviceKey(userId, deviceId);
        Map<Object, Object> deviceData = redis.opsForHash()
            .entries(deviceKey);

        if (deviceData.isEmpty()) {
            expiredDevices.add(deviceId);
            continue;
        }

        long lastHeartbeat = Long.parseLong(
            (String) deviceData.getOrDefault("last_heartbeat", "0")
        );

        if (now - lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
            expiredDevices.add(deviceId);
            // 删除过期设备
            redis.delete(deviceKey);
        } else {
            aliveDevices.add(deviceId);
        }
    }

    // 3. 从设备列表移除过期设备
    if (!expiredDevices.isEmpty()) {
        redis.opsForSet().remove(
            keyBuilder.userDevices(userId),
            expiredDevices.toArray()
        );
    }

    // 4. 根据存活设备数更新用户状态
    if (aliveDevices.isEmpty()) {
        // 全部设备超时 → 用户离线
        setUserOffline(userId, "heartbeat_timeout");
    } else {
        // 部分设备超时 → 更新主设备
        updatePrimaryDevice(userId, aliveDevices);
    }
}
```

### 4.5 状态机定义

```
                    ┌─────────────────────────────────────┐
                    │           用户 Presence 状态机       │
                    └─────────────────────────────────────┘

    ┌─────────┐  CONNECT    ┌─────────┐  心跳超时 (>120s)   ┌──────────┐
    │         │────────────>│         │────────────────────>│          │
    │ OFFLINE │             │ ONLINE  │                     │ OFFLINE  │
    │         │<────────────│         │<────────────────────│          │
    └─────────┘  RECONNECT  └────┬────┘  RECONNECT          └──────────┘
                               │ │
                  活动间隔>60s  │ │ 用户操作(点击/输入/
                  ├────────────┘ │ 滑动/提交答案)
                  │              │
                  ▼              ▼
            ┌─────────┐   ┌──────────┐
            │         │   │          │
            │  IDLE   │   │  ACTIVE  │
            │         │   │          │
            └────┬────┘   └──────────┘
                 │              │
                 │ 用户操作      │ 活动间隔>60s
                 │──────────────>│<──────────│
                 │              │            │
                 └──────────────┴────────────┘
```

**状态定义：**

| 状态 | 条件 | 含义 |
| --- | --- | --- |
| `OFFLINE` | 无任何在线设备 | 用户完全离线 |
| `ONLINE` | 至少一个设备有心跳 | 用户至少在一个设备上在线 |
| `IDLE` | 在线但 60s 内无任何操作 | 用户在线但未操作（可能分心或离开） |
| `ACTIVE` | 在线且 60s 内有操作 | 用户正在活跃使用 |

### 4.6 模块切换上下文流转

当用户在 App 内切换页面/模块时，客户端通过 WebSocket 发送 `presence_update` 消息：

```javascript
// 客户端：页面切换时上报
function onModuleChanged(newModule, subject, contentId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'presence_update',
      deviceId: getDeviceId(),
      module: newModule,        // "ai_chat" | "practice" | "sync_classroom" ...
      subject: subject,         // "math" | "english" ...
      contentId: contentId,    // "ch_7_2_3" | "quiz_456"
      action: 'enter'
    }));
  }
}

// 页面离开时上报
function onModuleLeft(module) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'presence_update',
      deviceId: getDeviceId(),
      module: module,
      action: 'leave'
    }));
  }
}
```

**服务端处理：**

```java
public void handlePresenceUpdate(Long userId, String deviceId,
                                  PresenceUpdateRequest req) {
    String deviceKey = keyBuilder.deviceKey(userId, deviceId);

    // 1. 获取旧的活动上下文
    Map<Object, Object> oldData = redis.opsForHash().entries(deviceKey);
    String oldModule = (String) oldData.get("current_module");
    String oldSubject = (String) oldData.get("current_subject");

    // 2. 更新设备活动上下文
    Map<String, Object> updates = new HashMap<>();
    updates.put("current_module", req.getModule());
    updates.put("current_subject", req.getSubject());
    updates.put("current_content", req.getContentId());
    updates.put("last_active_ts", String.valueOf(System.currentTimeMillis()));
    redis.opsForHash().putAll(deviceKey, updates);

    // 3. 更新用户聚合状态
    redis.opsForHash().put(keyBuilder.userKey(userId), "current_module",
                           req.getModule());

    // 4. 更新分桶集合（科目变更时）
    if (oldSubject != null && !oldSubject.equals(req.getSubject())) {
        redis.opsForSet().remove(
            keyBuilder.onlineSubjectKey(oldSubject), userId.toString()
        );
    }
    if (req.getSubject() != null) {
        redis.opsForSet().add(
            keyBuilder.onlineSubjectKey(req.getSubject()), userId.toString()
        );
    }

    // 5. 发布模块切换事件
    if (oldModule != null && !oldModule.equals(req.getModule())) {
        PresenceEvent event = PresenceEvent.builder()
            .userId(userId)
            .eventType("module_change")
            .oldValue(oldModule)
            .newValue(req.getModule())
            .timestamp(System.currentTimeMillis())
            .build();
        eventPublisher.publish(event);
    }

    // 6. 写入事件日志（异步）
    eventLogService.asyncLog(userId, deviceId, "module_change",
                              oldModule, req.getModule());
}
```

---

## 5. 关键代码示例

### 5.1 服务端核心类：PresenceService

```java
/**
 * Presence 核心服务
 * 管理用户在线状态、设备会话、活动上下文
 */
@Service
@Slf4j
public class PresenceService {

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private PresenceEventPublisher eventPublisher;

    @Autowired
    private PresenceSessionService sessionService;

    @Autowired
    private PresenceMetricsService metricsService;

    @Value("${presence.heartbeat.interval:30}")
    private int heartbeatIntervalSec;

    @Value("${presence.heartbeat.timeout:120}")
    private int heartbeatTimeoutSec;

    @Value("${presence.idle.threshold:60}")
    private int idleThresholdSec;

    private static final long HEARTBEAT_TIMEOUT_MS = 120_000L;
    private static final long IDLE_THRESHOLD_MS = 60_000L;

    private final PresenceKeyBuilder keyBuilder = new PresenceKeyBuilder();

    /**
     * 设备上线
     */
    public void deviceOnline(Long userId, String deviceId,
                             String platform, String appVersion,
                             String pushToken) {
        long now = System.currentTimeMillis();
        String deviceKey = keyBuilder.deviceKey(userId, deviceId);
        String userKey = keyBuilder.userKey(userId);

        // 1. 写入设备 Hash
        Map<String, String> deviceData = new HashMap<>();
        deviceData.put("status", "online");
        deviceData.put("platform", platform);
        deviceData.put("app_version", appVersion);
        deviceData.put("connect_ts", String.valueOf(now));
        deviceData.put("last_active_ts", String.valueOf(now));
        deviceData.put("last_heartbeat", String.valueOf(now));
        if (pushToken != null) deviceData.put("push_token", pushToken);
        redis.opsForHash().putAll(deviceKey,
            StringRedisSerializer.toHash(deviceData));
        // 设备 Hash 设置 TTL = 心跳超时的 2 倍
        redis.expire(deviceKey, heartbeatTimeoutSec * 2, TimeUnit.SECONDS);

        // 2. 加入用户设备列表
        redis.opsForSet().add(keyBuilder.userDevices(userId), deviceId);

        // 3. 更新用户聚合状态
        Long deviceCount = redis.opsForSet()
            .size(keyBuilder.userDevices(userId));
        Map<String, String> userUpdates = new HashMap<>();
        userUpdates.put("status", "online");
        userUpdates.put("last_active_ts", String.valueOf(now));
        userUpdates.put("last_heartbeat", String.valueOf(now));
        userUpdates.put("device_count", String.valueOf(deviceCount));
        userUpdates.put("platform", platform);
        userUpdates.put("app_version", appVersion);
        redis.opsForHash().putAll(userKey,
            StringRedisSerializer.toHash(userUpdates));

        // 4. 加入在线集合
        redis.opsForSet().add(keyBuilder.onlineAllKey(), userId.toString());

        // 5. 发布上线事件
        eventPublisher.publish(PresenceEvent.builder()
            .userId(userId)
            .deviceId(deviceId)
            .eventType("online")
            .newValue(platform)
            .timestamp(now)
            .build());

        // 6. 更新实时计数
        metricsService.incrementOnlineCount(platform);

        log.info("User {} device {} online on {}", userId, deviceId, platform);
    }

    /**
     * 设备下线
     */
    public void deviceOffline(Long userId, String deviceId,
                               String reason) {
        String deviceKey = keyBuilder.deviceKey(userId, deviceId);
        String userDevicesKey = keyBuilder.userDevices(userId);

        // 1. 读取设备会话信息（用于写历史记录）
        Map<Object, Object> deviceData = redis.opsForHash().entries(deviceKey);

        // 2. 删除设备 Hash
        redis.delete(deviceKey);

        // 3. 从设备列表移除
        redis.opsForSet().remove(userDevicesKey, deviceId);

        // 4. 检查剩余设备
        Long remainingDevices = redis.opsForSet().size(userDevicesKey);
        long now = System.currentTimeMillis();

        if (remainingDevices == null || remainingDevices == 0) {
            // 5a. 全部设备下线 → 用户离线
            setUserOffline(userId, now);

            // 写入会话历史
            sessionService.recordSessionEnd(userId, deviceId, deviceData,
                                             now, reason);
        } else {
            // 5b. 仍有设备在线 → 更新主设备
            promotePrimaryDevice(userId, now);
            log.info("User {} device {} offline, {} devices remaining",
                     userId, deviceId, remainingDevices);
        }

        // 6. 发布下线事件
        eventPublisher.publish(PresenceEvent.builder()
            .userId(userId)
            .deviceId(deviceId)
            .eventType("offline")
            .newValue(reason)
            .timestamp(now)
            .build());

        // 7. 更新实时计数
        metricsService.decrementOnlineCount(
            (String) deviceData.get("platform"));
    }

    /**
     * 设置用户完全离线
     */
    private void setUserOffline(Long userId, long ts) {
        String userKey = keyBuilder.userKey(userId);

        // 更新用户状态
        redis.opsForHash().put(userKey, "status", "offline");
        redis.opsForHash().put(userKey, "device_count", "0");
        redis.opsForHash().put(userKey, "last_active_ts",
                               String.valueOf(ts));

        // 从在线集合移除
        redis.opsForSet().remove(keyBuilder.onlineAllKey(),
                                  userId.toString());

        // 从分桶集合移除
        removeFromAllBuckets(userId);

        log.info("User {} fully offline", userId);
    }

    /**
     * 选择最新活跃设备作为主设备
     */
    private void promotePrimaryDevice(Long userId, long now) {
        Set<String> devices = redis.opsForSet()
            .members(keyBuilder.userDevices(userId));

        if (devices == null || devices.isEmpty()) return;

        String latestDevice = null;
        long latestTs = 0;

        for (String deviceId : devices) {
            Map<Object, Object> devData = redis.opsForHash().entries(
                keyBuilder.deviceKey(userId, deviceId));
            String lastActive = (String) devData.get("last_active_ts");
            if (lastActive != null) {
                long ts = Long.parseLong(lastActive);
                if (ts > latestTs) {
                    latestTs = ts;
                    latestDevice = deviceId;
                }
            }
        }

        if (latestDevice != null) {
            Map<Object, Object> devData = redis.opsForHash().entries(
                keyBuilder.deviceKey(userId, latestDevice));

            String userKey = keyBuilder.userKey(userId);
            redis.opsForHash().put(userKey, "platform",
                                   devData.get("platform"));
            redis.opsForHash().put(userKey, "current_module",
                                   devData.get("current_module"));
            redis.opsForHash().put(userKey, "current_subject",
                                   devData.get("current_subject"));
        }
    }

    /**
     * 从所有分桶集合中移除用户
     */
    private void removeFromAllBuckets(Long userId) {
        String userKey = keyBuilder.userKey(userId);
        Map<Object, Object> userData = redis.opsForHash().entries(userKey);

        String subject = (String) userData.get("current_subject");
        if (subject != null && !subject.isEmpty()) {
            redis.opsForSet().remove(
                keyBuilder.onlineSubjectKey(subject),
                userId.toString());
        }

        String module = (String) userData.get("current_module");
        if (module != null && !module.isEmpty()) {
            redis.opsForSet().remove(
                keyBuilder.onlineModuleKey(module),
                userId.toString());
        }

        // 学段信息从用户 Profile 获取
        // 此处可异步处理
    }

    /**
     * 心跳更新
     */
    public void heartbeat(Long userId, String deviceId,
                           HeartbeatPayload payload) {
        long now = System.currentTimeMillis();
        String deviceKey = keyBuilder.deviceKey(userId, deviceId);
        String userKey = keyBuilder.userKey(userId);

        // 1. 更新设备心跳
        Map<String, String> updates = new HashMap<>();
        updates.put("last_heartbeat", String.valueOf(now));
        updates.put("last_active_ts", String.valueOf(now));
        updates.put("status", "online");
        if (payload.getNetworkType() != null) {
            updates.put("network_type", payload.getNetworkType());
        }
        redis.opsForHash().putAll(deviceKey,
            StringRedisSerializer.toHash(updates));
        // 刷新 TTL
        redis.expire(deviceKey, heartbeatTimeoutSec * 2, TimeUnit.SECONDS);

        // 2. 更新用户聚合状态
        redis.opsForHash().put(userKey, "last_heartbeat",
                               String.valueOf(now));
        redis.opsForHash().put(userKey, "status", "online");

        // 3. 更新活动上下文（如果携带了新信息）
        if (payload.getModule() != null) {
            handlePresenceUpdate(userId, deviceId, payload);
        }
    }

    /**
     * 批量查询用户状态
     */
    public List<PresenceInfo> batchQueryPresence(List<Long> userIds) {
        List<PresenceInfo> result = new ArrayList<>(userIds.size());

        // 使用 Pipeline 批量查询
        List<Object> responses = redis.executePipelined((RedisCallback<Object>) connection -> {
            StringRedisConnection stringConn = (StringRedisConnection) connection;
            for (Long userId : userIds) {
                stringConn.hGetAll(keyBuilder.userKey(userId).getBytes());
            }
            return null;
        });

        for (int i = 0; i < userIds.size(); i++) {
            @SuppressWarnings("unchecked")
            Map<String, String> data = (Map<String, String>) responses.get(i);
            result.add(PresenceInfo.fromRedisMap(userIds.get(i), data));
        }

        return result;
    }

    /**
     * 获取在线统计
     */
    public PresenceStats getOnlineStats() {
        long totalOnline = redis.opsForSet().size(keyBuilder.onlineAllKey());

        Map<String, Long> byStage = new HashMap<>();
        Map<String, Long> byModule = new HashMap<>();
        Map<String, Long> bySubject = new HashMap<>();

        // 并行查询各维度
        for (String stage : Arrays.asList("kindergarten", "primary",
                                           "junior", "senior")) {
            Long count = redis.opsForSet().size(
                keyBuilder.onlineStageKey(stage));
            byStage.put(stage, count != null ? count : 0);
        }

        for (String module : Arrays.asList("ai_chat", "practice",
                "sync_classroom", "study_room", "mistake_review")) {
            Long count = redis.opsForSet().size(
                keyBuilder.onlineModuleKey(module));
            byModule.put(module, count != null ? count : 0);
        }

        return PresenceStats.builder()
            .totalOnline(totalOnline)
            .byStage(byStage)
            .byModule(byModule)
            .bySubject(bySubject)
            .timestamp(System.currentTimeMillis())
            .build();
    }
}
```

### 5.2 Presence Reaper（超时回收定时任务）

```java
/**
 * Presence 超时回收器
 * 每 15 秒扫描一次，检测心跳超时的设备和用户
 */
@Component
@Slf4j
public class PresenceReaper {

    @Autowired
    private PresenceService presenceService;

    @Autowired
    private StringRedisTemplate redis;

    @Value("${presence.reaper.batch-size:500}")
    private int batchSize;

    private final PresenceKeyBuilder keyBuilder = new PresenceKeyBuilder();

    /**
     * 每 15 秒执行一次
     */
    @Scheduled(fixedDelay = 15_000)
    public void reapExpiredSessions() {
        String onlineKey = keyBuilder.onlineAllKey();
        long now = System.currentTimeMillis();

        // 使用 SSCAN 分批扫描在线用户集合
        ScanOptions scanOptions = ScanOptions.scanOptions()
            .count(batchSize).build();

        try (Cursor<String> cursor = redis.opsForSet()
                .scan(onlineKey, scanOptions)) {

            int checkedCount = 0;
            int reapedCount = 0;

            while (cursor.hasNext()) {
                String userIdStr = cursor.next();
                checkedCount++;

                String userKey = keyBuilder.userKey(Long.parseLong(userIdStr));
                String lastHeartbeatStr = (String) redis.opsForHash()
                    .get(userKey, "last_heartbeat");

                if (lastHeartbeatStr == null) {
                    // 数据异常，直接清除
                    redis.opsForSet().remove(onlineKey, userIdStr);
                    reapedCount++;
                    continue;
                }

                long lastHeartbeat = Long.parseLong(lastHeartbeatStr);
                if (now - lastHeartbeat > PresenceService.HEARTBEAT_TIMEOUT_MS) {
                    // 心跳超时，触发静默掉线
                    Long userId = Long.parseLong(userIdStr);
                    presenceService.handleSilentDisconnect(userId);
                    reapedCount++;
                }
            }

            if (reapedCount > 0) {
                log.info("Presence reaper: checked={}, reaped={}",
                         checkedCount, reapedCount);
            }

        } catch (Exception e) {
            log.error("Presence reaper error", e);
        }
    }
}
```

### 5.3 Presence Key Builder

```java
/**
 * Redis Key 构建工具
 * 统一管理 Presence 相关的 Redis Key 命名
 */
public class PresenceKeyBuilder {

    private static final String PREFIX = "presence";

    /** presence:user:{userId} */
    public String userKey(Long userId) {
        return PREFIX + ":user:" + userId;
    }

    /** presence:device:{userId}:{deviceId} */
    public String deviceKey(Long userId, String deviceId) {
        return PREFIX + ":device:" + userId + ":" + deviceId;
    }

    /** presence:user_devices:{userId} */
    public String userDevices(Long userId) {
        return PREFIX + ":user_devices:" + userId;
    }

    /** presence:online:all */
    public String onlineAllKey() {
        return PREFIX + ":online:all";
    }

    /** presence:online:stage:{stage} */
    public String onlineStageKey(String stage) {
        return PREFIX + ":online:stage:" + stage;
    }

    /** presence:online:subject:{subject} */
    public String onlineSubjectKey(String subject) {
        return PREFIX + ":online:subject:" + subject;
    }

    /** presence:online:module:{module} */
    public String onlineModuleKey(String module) {
        return PREFIX + ":online:module:" + module;
    }

    /** presence:room:{roomId} */
    public String roomKey(String roomId) {
        return PREFIX + ":room:" + roomId;
    }

    /** presence:events:{userId} (Pub/Sub channel) */
    public String eventChannel(Long userId) {
        return PREFIX + ":events:" + userId;
    }
}
```

### 5.4 Presence Event Publisher & Subscriber

```java
/**
 * Presence 事件发布器
 */
@Component
@Slf4j
public class PresenceEventPublisher {

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private PresenceKeyBuilder keyBuilder;

    @Autowired
    @Qualifier("presenceEventExecutor")
    private ThreadPoolTaskExecutor executor;

    public void publish(PresenceEvent event) {
        // 1. 发布到用户频道（供订阅方实时接收）
        String channel = keyBuilder.eventChannel(event.getUserId());
        redis.convertAndSend(channel, event.toJson());

        // 2. 异步写入事件日志
        executor.execute(() -> {
            // 写入 MySQL presence_event_log
            // ...
        });
    }
}

/**
 * Presence 事件订阅管理器
 * 管理哪些会话订阅了哪些用户的状态变更
 */
@Component
@Slf4j
public class PresenceSubscriptionManager {

    // sessionId -> Set<userId> 订阅关系
    private final ConcurrentHashMap<String, Set<Long>> sessionSubscriptions
        = new ConcurrentHashMap<>();

    // userId -> Set<sessionId> 反向索引
    private final ConcurrentHashMap<Long, Set<String>> userSubscribers
        = new ConcurrentHashMap<>();

    /**
     * WebSocket 会话订阅用户状态
     */
    public void subscribe(String sessionId, List<Long> userIds,
                           List<String> eventTypes) {
        Set<Long> existing = sessionSubscriptions
            .computeIfAbsent(sessionId, k -> ConcurrentHashMap.newKeySet());
        existing.addAll(userIds);

        for (Long userId : userIds) {
            userSubscribers
                .computeIfAbsent(userId, k -> ConcurrentHashMap.newKeySet())
                .add(sessionId);
        }
    }

    /**
     * 取消订阅（会话关闭时调用）
     */
    public void unsubscribeAll(String sessionId) {
        Set<Long> userIds = sessionSubscriptions.remove(sessionId);
        if (userIds != null) {
            for (Long userId : userIds) {
                Set<String> subscribers = userSubscribers.get(userId);
                if (subscribers != null) {
                    subscribers.remove(sessionId);
                    if (subscribers.isEmpty()) {
                        userSubscribers.remove(userId);
                    }
                }
            }
        }
    }

    /**
     * 获取某用户的所有订阅会话（用于广播）
     */
    public Set<String> getSubscribers(Long userId) {
        Set<String> subscribers = userSubscribers.get(userId);
        return subscribers != null ? subscribers : Collections.emptySet();
    }
}
```

### 5.5 WebSocket Gateway 集成

```java
/**
 * WebSocket 连接生命周期处理器
 * 将 WebSocket 连接事件桥接到 Presence 服务
 */
@Component
@Slf4j
public class PresenceWebSocketHandler extends TextWebSocketHandler {

    @Autowired
    private PresenceService presenceService;

    @Autowired
    private PresenceSubscriptionManager subscriptionManager;

    @Autowired
    private PresenceEventRouter eventRouter;

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        Long userId = (Long) session.getAttributes().get("userId");
        String deviceId = (String) session.getAttributes().get("deviceId");
        String platform = (String) session.getAttributes().get("platform");
        String appVersion = (String) session.getAttributes().get("appVersion");
        String pushToken = (String) session.getAttributes().get("pushToken");

        if (userId != null && deviceId != null) {
            presenceService.deviceOnline(userId, deviceId, platform,
                                          appVersion, pushToken);
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession session,
                                      TextMessage message) throws Exception {
        JsonNode payload = objectMapper.readTree(message.getPayload());
        String type = payload.get("type").asText();

        Long userId = (Long) session.getAttributes().get("userId");
        String deviceId = (String) session.getAttributes().get("deviceId");

        switch (type) {
            case "heartbeat":
                HeartbeatPayload hb = objectMapper.treeToValue(
                    payload, HeartbeatPayload.class);
                presenceService.heartbeat(userId, deviceId, hb);

                // 回复 ack
                session.sendMessage(new TextMessage(objectMapper.writeValueAsString(
                    Map.of("type", "heartbeat_ack",
                           "serverTs", System.currentTimeMillis(),
                           "status", "online",
                           "interval", 30)
                )));
                break;

            case "presence_update":
                PresenceUpdateRequest update = objectMapper.treeToValue(
                    payload, PresenceUpdateRequest.class);
                presenceService.handlePresenceUpdate(userId, deviceId, update);
                break;

            case "presence_subscribe":
                List<Long> targetUserIds = objectMapper.convertValue(
                    payload.get("userIds"),
                    new TypeReference<List<Long>>() {});
                List<String> events = objectMapper.convertValue(
                    payload.get("events"),
                    new TypeReference<List<String>>() {});
                subscriptionManager.subscribe(session.getId(), targetUserIds, events);
                break;

            default:
                // 交给其他 handler 处理
                break;
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session,
                                       CloseStatus status) {
        Long userId = (Long) session.getAttributes().get("userId");
        String deviceId = (String) session.getAttributes().get("deviceId");

        if (userId != null && deviceId != null) {
            String reason = switch (status.getCode()) {
                case 1000 -> "normal_close";
                case 1001 -> "going_away";
                case 1006 -> "abnormal_disconnect";
                default -> "unknown_" + status.getCode();
            };
            presenceService.deviceOffline(userId, deviceId, reason);
        }

        // 清理订阅
        subscriptionManager.unsubscribeAll(session.getId());
    }

    @Override
    public void handleTransportError(WebSocketSession session,
                                      Throwable exception) {
        log.warn("WebSocket transport error for session {}: {}",
                 session.getId(), exception.getMessage());
        // 传输错误后连接通常已断开，afterConnectionClosed 会被调用
    }
}
```

### 5.6 Presence Event Router（事件路由到订阅方）

```java
/**
 * Presence 事件路由器
 * 监听 Redis Pub/Sub 频道，将事件路由到订阅方的 WebSocket 会话
 */
@Component
@Slf4j
public class PresenceEventRouter implements MessageListener {

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private PresenceSubscriptionManager subscriptionManager;

    @Autowired
    @Qualifier("wsSessionRegistry")
    private WebSocketSessionRegistry sessionRegistry;

    @Override
    public void onMessage(Message message, byte[] pattern) {
        try {
            String body = new String(message.getBody(), StandardCharsets.UTF_8);
            PresenceEvent event = objectMapper.readValue(body, PresenceEvent.class);

            // 找到订阅了该用户的所有 WebSocket 会话
            Set<String> subscriberSessionIds = subscriptionManager
                .getSubscribers(event.getUserId());

            if (subscriberSessionIds.isEmpty()) return;

            String wsMessage = objectMapper.writeValueAsString(Map.of(
                "type", "presence_event",
                "userId", event.getUserId(),
                "event", event.getEventType(),
                "data", Map.of(
                    "oldValue", event.getOldValue() != null
                        ? event.getOldValue() : "",
                    "newValue", event.getNewValue() != null
                        ? event.getNewValue() : "",
                    "timestamp", event.getTimestamp()
                )
            ));

            // 并行推送到所有订阅会话
            for (String sessionId : subscriberSessionIds) {
                WebSocketSession session = sessionRegistry.getSession(sessionId);
                if (session != null && session.isOpen()) {
                    try {
                        synchronized (session) {
                            session.sendMessage(new TextMessage(wsMessage));
                        }
                    } catch (Exception e) {
                        log.warn("Failed to send presence event to session {}: {}",
                                 sessionId, e.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            log.error("Error routing presence event", e);
        }
    }
}
```

---

## 6. 多端状态同步策略

### 6.1 多设备冲突处理

```
场景：用户在手机上学习数学，同时在平板上学习英语

策略：每设备独立维护活动上下文，用户聚合状态取"最后活跃设备"的上下文

┌──────────┐     ┌──────────────────┐     ┌──────────────────┐
│  手机     │     │  Presence Service │     │  平板             │
│ (android) │     │                  │     │  (ios)           │
└─────┬────┘     └────────┬─────────┘     └────────┬─────────┘
      │                   │                         │
      │ heartbeat(module= │                         │
      │ "practice",       │                         │
      │ subject="math")   │                         │
      │──────────────────>│                         │
      │                   │  user.current =         │
      │                   │  "practice" + "math"    │
      │                   │                         │
      │                   │         heartbeat(module=│
      │                   │         "ai_chat",      │
      │                   │         subject="english")│
      │                   │<────────────────────────│
      │                   │                         │
      │                   │  user.current =         │
      │                   │  "ai_chat" + "english"  │
      │                   │  (覆盖，因为时间更晚)     │
      │                   │                         │
```

**规则：**
1. 用户级 `current_module` / `current_subject` 始终取**最后活跃设备**的值
2. 设备级状态各自独立维护
3. 查询接口返回设备列表，让调用方知道多设备情况
4. 家长端展示"正在英语学习中（平板）"

### 6.2 离线推送决策

```java
/**
 * 通知服务调用 Presence 判断是否跳过推送
 */
public class NotificationDeliveryService {

    @Autowired
    private PresenceService presenceService;

    public DeliveryDecision decideDelivery(Long userId, NotificationMessage msg) {
        PresenceInfo presence = presenceService.queryPresence(userId);

        if ("online".equals(presence.getStatus())) {
            String currentModule = presence.getModule();

            // 用户正在关键学习模块中，转为站内消息
            if (isLearningModule(currentModule)) {
                return DeliveryDecision.builder()
                    .action("in_app_only")  // 仅站内，不推送
                    .reason("user_active_in_learning")
                    .build();
            }

            // 用户在线但不在学习，延迟30秒后判断
            return DeliveryDecision.builder()
                .action("delayed_push")
                .delaySeconds(30)
                .reason("user_online_non_learning")
                .build();
        }

        // 用户离线，正常推送
        return DeliveryDecision.builder()
            .action("push")
            .reason("user_offline")
            .build();
    }

    private boolean isLearningModule(String module) {
        return Set.of("practice", "sync_classroom", "study_room",
                       "mistake_review", "exam").contains(module);
    }
}
```

---

## 7. 错误处理

### 7.1 异常类型与处理策略

| 异常场景 | 处理策略 | 降级方案 |
| --- | --- | --- |
| Redis 连接闪断 | 自动重连 + 本地缓存最近状态 | 查询接口返回上次已知状态 |
| Redis 大面积故障 | 降级为"未知"状态 | 所有查询返回 `status: "unknown"` |
| WebSocket 网关异常 | 心跳超时回收机制兜底 | Reaper 定时扫描清理 |
| 事件发布失败 | 异步重试 3 次 | 丢弃事件，不影响核心状态 |
| 设备 Hash 自然过期 | 正常行为 | Reaper 兜底清理用户级状态 |
| 并发写冲突（多网关） | Redis 原子操作 + 乐观锁 | 最后写入胜出（LWW） |

### 7.2 错误码定义

```java
public enum PresenceErrorCode {

    USER_NOT_FOUND(40401, "用户不存在"),
    DEVICE_NOT_FOUND(40402, "设备会话不存在"),
    SUBSCRIPTION_LIMIT_EXCEEDED(42901, "订阅数量超限(最多500用户)"),
    HEARTBEAT_INVALID(40001, "心跳请求格式无效"),
    PRESENCE_UPDATE_REJECTED(40301, "状态更新被拒绝"),
    REDIS_UNAVAILABLE(50301, "Presence服务暂时不可用"),
    RATE_LIMIT_EXCEEDED(42902, "查询频率超限");

    private final int code;
    private final String message;

    PresenceErrorCode(int code, String message) {
        this.code = code;
        this.message = message;
    }
}
```

### 7.3 重试与降级策略

```java
/**
 * Presence 查询降级策略
 */
@Service
public class PresenceQueryService {

    @Autowired
    private PresenceService presenceService;

    @Autowired
    private CaffeineCache<Long, PresenceInfo> localCache;

    /**
     * 查询用户状态（带降级）
     */
    public PresenceInfo queryPresenceSafe(Long userId) {
        try {
            PresenceInfo info = presenceService.queryPresence(userId);
            // 成功查询后更新本地缓存
            localCache.put(userId, info);
            return info;
        } catch (Exception e) {
            log.warn("Presence query failed for user {}, using cache", userId, e);
            // 降级：返回本地缓存
            PresenceInfo cached = localCache.getIfPresent(userId);
            if (cached != null) {
                // 检查缓存时效性
                long age = System.currentTimeMillis() - cached.getTimestamp();
                if (age < 300_000) {  // 5 分钟内的缓存
                    return cached.toBuilder()
                        .stale(true)
                        .build();
                }
            }
            // 完全无法确定状态
            return PresenceInfo.unknown(userId);
        }
    }
}
```

---

## 8. 性能优化

### 8.1 心跳频率动态调节

```java
/**
 * 根据用户当前活动动态调整心跳间隔
 * - 活跃学习场景：30s（需要精确状态）
 * - 后台运行：60s（节省电量和带宽）
 * - 弱网环境：90s（容忍更长的超时窗口）
 */
public class DynamicHeartbeatStrategy {

    public int calculateInterval(HeartbeatContext ctx) {
        int baseInterval = 30; // 默认 30 秒

        // 后台模式
        if (ctx.isAppInBackground()) {
            baseInterval = 60;
        }

        // 弱网模式
        if ("4g".equals(ctx.getNetworkType()) || "3g".equals(ctx.getNetworkType())) {
            baseInterval += 30;
        }

        // 低端设备
        if (ctx.isLowEndDevice()) {
            baseInterval += 15;
        }

        // 自习室场景需要更精确
        if ("study_room".equals(ctx.getCurrentModule())) {
            baseInterval = Math.min(baseInterval, 20);
        }

        return Math.min(baseInterval, 120); // 最大 120 秒
    }
}
```

### 8.2 批量查询优化

```java
/**
 * 使用 Redis Pipeline 批量查询，减少网络往返
 */
public List<PresenceInfo> batchQuery(List<Long> userIds) {
    List<PresenceInfo> results = new ArrayList<>(userIds.size());

    // 分批 Pipeline 查询，每批 100 个
    int batchSize = 100;
    for (int i = 0; i < userIds.size(); i += batchSize) {
        List<Long> batch = userIds.subList(i,
            Math.min(i + batchSize, userIds.size()));

        List<Object> pipeResults = redis.executePipelined((connection) -> {
            for (Long userId : batch) {
                connection.hashCommands().hGetAll(
                    keyBuilder.userKey(userId).getBytes()
                );
            }
            return null;
        });

        for (int j = 0; j < batch.size(); j++) {
            Map<String, String> data = deserializeHash(
                (Map<byte[], byte[]>) pipeResults.get(j));
            results.add(PresenceInfo.fromRedisMap(batch.get(j), data));
        }
    }

    return results;
}
```

### 8.3 内存与容量估算

| 指标 | 单用户内存 | 10万在线 | 50万在线 | 100万在线 |
| --- | --- | --- | --- | --- |
| 用户状态 Hash | ~300B | ~30MB | ~150MB | ~300MB |
| 设备状态 Hash (均值1.2设备) | ~400B | ~48MB | ~240MB | ~480MB |
| 在线集合 (Set) | ~40B | ~4MB | ~20MB | ~40MB |
| 分桶集合 (4个维度) | ~160B | ~16MB | ~80MB | ~160MB |
| **合计** | **~900B** | **~98MB** | **~490MB** | **~980MB** |

> **结论：** 单 Redis 实例（4GB）可支撑约 200 万并发在线用户。建议使用 Redis Cluster 分片部署，按 `userId % shardCount` 分片。

### 8.4 Reaper 扫描优化

```java
/**
 * 分片扫描策略：将在线用户集合按 userId 哈希分片
 * 每个 Reaper 节点只扫描自己负责的分片
 * 避免全量扫描造成的性能瓶颈
 */
@Scheduled(fixedDelay = 15_000)
public void reapExpiredSessionsSharded() {
    int shardCount = clusterConfig.getPresenceShardCount();
    int myShard = clusterConfig.getLocalShardIndex();

    // 扫描时跳过不属于本节点的 userId
    try (Cursor<String> cursor = redis.opsForSet()
            .scan(keyBuilder.onlineAllKey(), scanOptions)) {

        while (cursor.hasNext()) {
            String userIdStr = cursor.next();
            long userId = Long.parseLong(userIdStr);

            // 分片路由：只处理属于本节点的用户
            if (userId % shardCount != myShard) {
                continue;
            }

            // 检查心跳...
            checkAndReap(userId);
        }
    }
}
```

---

## 9. 安全考虑

### 9.1 访问权限控制

```java
/**
 * Presence 查询权限校验
 */
public class PresenceAccessControl {

    /**
     * 检查查询者是否有权查看目标用户的状态
     */
    public void checkQueryPermission(Long requesterId, Long targetUserId) {
        // 1. 查自己 → 允许
        if (requesterId.equals(targetUserId)) return;

        // 2. 家长查孩子 → 检查绑定关系
        if (parentBindingService.isParentOf(requesterId, targetUserId)) return;

        // 3. 教师查学生 → 检查班级关系
        if (teacherService.isStudentOf(requesterId, targetUserId)) return;

        // 4. 自习室同伴 → 检查是否在同一房间
        if (studyRoomService.areRoommates(requesterId, targetUserId)) return;

        throw new AccessDeniedException("无权查看该用户状态");
    }

    /**
     * 批量查询权限校验
     */
    public List<Long> filterQueryable(Long requesterId, List<Long> targetUserIds) {
        // 同上逻辑的批量版本
    }
}
```

### 9.2 数据隐私

| 数据项 | 可见范围 | 说明 |
| --- | --- | --- |
| 在线/离线状态 | 自己、家长（绑定）、教师（班级）、自习室同伴 | 不对外公开 |
| 当前学习模块 | 同上 | 模块名称可对外（如"正在学习中"） |
| 当前学习内容 | 仅自己、家长 | 具体章节/题目不对外 |
| 设备列表 | 仅自己 | 设备型号、平台信息 |
| 在线时长统计 | 自己、家长 | 汇总数据可分享 |

### 9.3 防滥用

- 单个 WebSocket 会话最多订阅 500 个用户的状态变更
- 批量查询接口限流：100次/分钟/用户
- 心跳消息限流：每 10 秒最多 1 次（防刷）
- 异常频繁的状态变更上报触发告警

---

## 10. 监控与告警

### 10.1 关键指标

| 指标 | 说明 | 告警阈值 |
| --- | --- | --- |
| `presence.online.total` | 当前在线用户总数 | 下降>30% → 告警 |
| `presence.online.by_stage` | 分学段在线数 | - |
| `presence.heartbeat.qps` | 心跳消息QPS | >预期2倍 → 检查 |
| `presence.reaper.reaped` | 每轮回收的过期会话数 | 持续>5000 → 检查 |
| `presence.event.publish.failed` | 事件发布失败数 | >1% → 告警 |
| `presence.redis.latency` | Redis 操作延迟 | P99>10ms → 告警 |
| `presence.query.latency` | 查询接口延迟 | P99>50ms → 告警 |
| `presence.websocket.connections` | 当前WebSocket连接数 | - |

### 10.2 Prometheus 指标定义

```java
@Component
public class PresenceMetrics {

    private final Counter heartbeatCounter = Counter.builder()
        .name("presence_heartbeat_total")
        .description("Total heartbeat messages received")
        .tag("platform", "")
        .register(meterRegistry);

    private final Gauge onlineGauge = Gauge.builder()
        .name("presence_online_users")
        .description("Current online user count")
        .register(meterRegistry);

    private final Counter reaperCounter = Counter.builder()
        .name("presence_reaper_reaped_total")
        .description("Sessions reaped by presence reaper")
        .register(meterRegistry);

    private final Timer queryTimer = Timer.builder()
        .name("presence_query_duration")
        .description("Presence query latency")
        .register(meterRegistry);

    public void recordHeartbeat(String platform) {
        heartbeatCounter.withTag("platform", platform).increment();
    }

    public void updateOnlineCount(long count) {
        onlineGauge.set(count);
    }
}
```

---

## 11. 部署架构

```
                    ┌─────────────────────────────────────┐
                    │           Load Balancer (LB)         │
                    │           (Sticky Session)           │
                    └────────────────┬────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                       │
    ┌─────────▼──────────┐ ┌────────▼─────────┐  ┌──────────▼────────┐
    │  WS Gateway #1      │ │  WS Gateway #2    │  │  WS Gateway #N    │
    │  + Presence Handler │ │  + Presence       │  │  + Presence       │
    │                     │ │    Handler        │  │    Handler        │
    └─────────┬──────────┘ └────────┬─────────┘  └──────────┬────────┘
              │                      │                       │
              └──────────────────────┼───────────────────────┘
                                     │
                    ┌────────────────▼────────────────────┐
                    │        Redis Cluster (6 nodes)       │
                    │   ┌─────────┐  ┌─────────┐         │
                    │   │ Master 1│  │ Master 2│  ...     │
                    │   │ + Slave │  │ + Slave │          │
                    │   └─────────┘  └─────────┘         │
                    └─────────────────────────────────────┘
                                     │
                    ┌────────────────▼────────────────────┐
                    │       MySQL (读写分离)               │
                    │   Primary: presence_session (写入)   │
                    │   Replica: 查询/分析                  │
                    └─────────────────────────────────────┘
```

**部署要点：**
1. WS Gateway 无状态，可水平扩展，通过 LB 分配
2. Redis Cluster 按userId分片，3主3从起步
3. MySQL 仅写入历史记录，非实时路径，不构成瓶颈
4. Reaper 逻辑部署在独立 worker 节点或嵌入 Gateway 节点（通过分片协调）

---

## 12. 测试策略

### 12.1 单元测试

```java
@ExtendWith(MockitoExtension.class)
class PresenceServiceTest {

    @Mock
    private StringRedisTemplate redis;

    @Mock
    private PresenceEventPublisher eventPublisher;

    @InjectMocks
    private PresenceService presenceService;

    @Test
    @DisplayName("设备上线 - 首个设备")
    void deviceOnline_firstDevice() {
        // Given
        Long userId = 10001L;
        String deviceId = "dev-001";

        when(redis.opsForSet().size(anyString())).thenReturn(1L);

        // When
        presenceService.deviceOnline(userId, deviceId,
            "android", "1.0.0", "token123");

        // Then
        verify(redis.opsForHash(), times(1))
            .putAll(eq("presence:device:10001:dev-001"), anyMap());
        verify(redis.opsForSet(), times(1))
            .add("presence:user_devices:10001", deviceId);
        verify(redis.opsForSet(), times(1))
            .add("presence:online:all", "10001");
        verify(eventPublisher, times(1)).publish(any(PresenceEvent.class));
    }

    @Test
    @DisplayName("设备下线 - 最后一个设备 → 用户离线")
    void deviceOffline_lastDevice() {
        Long userId = 10001L;
        String deviceId = "dev-001";

        when(redis.opsForSet().size(anyString())).thenReturn(0L);
        when(redis.opsForHash().entries(anyString()))
            .thenReturn(Map.of(
                "platform", "android",
                "connect_ts", "1700000000000"
            ));

        presenceService.deviceOffline(userId, deviceId, "normal_close");

        // 验证用户被设为离线
        verify(redis.opsForHash()).put(
            "presence:user:10001", "status", "offline");
        verify(redis.opsForSet()).remove(
            "presence:online:all", "10001");
    }

    @Test
    @DisplayName("心跳超时回收 - 多设备部分超时")
    void reap_partialTimeout() {
        Long userId = 10001L;
        Set<String> devices = Set.of("dev-001", "dev-002");
        long now = System.currentTimeMillis();

        when(redis.opsForSet().members(anyString())).thenReturn(devices);
        when(redis.opsForHash().entries("presence:device:10001:dev-001"))
            .thenReturn(Map.of(
                "last_heartbeat", String.valueOf(now - 200000), // 超时
                "platform", "android"
            ));
        when(redis.opsForHash().entries("presence:device:10001:dev-002"))
            .thenReturn(Map.of(
                "last_heartbeat", String.valueOf(now - 10000), // 正常
                "platform", "ios"
            ));

        presenceService.handleSilentDisconnect(userId);

        // 验证只有超时设备被清除
        verify(redis).delete("presence:device:10001:dev-001");
        verify(redis, never()).delete("presence:device:10001:dev-002");
        // 用户状态保持在线
        verify(redis.opsForHash(), never())
            .put(eq("presence:user:10001"), eq("status"), eq("offline"));
    }
}
```

### 12.2 压力测试场景

| 场景 | 目标 | 方法 |
| --- | --- | --- |
| 10万并发在线 | 心跳 QPS ~3300，Redis延迟 P99<5ms | 模拟 10万 WebSocket 连接，每 30s 发心跳 |
| 状态变更广播 | 1万订阅者同时接收事件 | 模拟 1 个用户状态变更，推送到 1万 订阅会话 |
| 突发流量 | 上课/下课高峰在线数突增 | 模拟 5分钟内 10万 用户同时上线 |
| Reaper 性能 | 50万在线用户扫描一轮 < 5s | 填充 50万 userId 到在线集合，测量扫描时间 |
| 故障恢复 | Redis 主从切换不影响状态 | 杀掉 Redis Master，验证服务是否降级而非崩溃 |

---

## 13. 与其他模块的集成指南

### 13.1 集成：通知服务

```java
// 通知发送前查询 Presence，决定推送策略
@Autowired
private PresenceQueryService presenceQuery;

public void sendNotification(Long userId, NotificationMessage msg) {
    PresenceInfo presence = presenceQuery.queryPresenceSafe(userId);

    if (presence.isOnline() && isLearningModule(presence.getModule())) {
        // 用户正在学习中 → 仅站内消息
        notificationService.sendInAppOnly(userId, msg);
    } else if (presence.isOnline()) {
        // 用户在线但不在学习 → 延迟推送
        notificationService.scheduleDelayedPush(userId, msg, 30);
    } else {
        // 用户离线 → 立即推送
        notificationService.sendPush(userId, msg);
    }
}
```

### 13.2 集成：家长中心

```java
// 家长端实时查看孩子学习状态
@GetMapping("/api/v1/parent/child/{childId}/presence")
public ApiResponse<ChildPresenceVO> getChildPresence(
        @PathVariable Long childId,
        @RequestAttribute Long parentId) {

    accessControl.checkParentChild(parentId, childId);
    PresenceInfo presence = presenceQuery.queryPresenceSafe(childId);

    return ApiResponse.success(ChildPresenceVO.builder()
        .online("online".equals(presence.getStatus()))
        .currentModule(presence.getModule())
        .currentModuleDesc(translateModule(presence.getModule()))
        .currentSubject(presence.getSubject())
        .lastActiveAt(presence.getLastActiveAt())
        .onlineDurationToday(presence.getOnlineDuration())
        .build());
}
```

### 13.3 集成：在线自习室

```java
// 自习室房间成员状态
public List<RoomMemberVO> getRoomMembers(String roomId) {
    Map<Object, Object> roomPresence = redis.opsForHash()
        .entries(keyBuilder.roomKey(roomId));

    return roomPresence.entrySet().stream()
        .map(e -> {
            Long userId = Long.parseLong((String) e.getKey());
            RoomPresenceData data = json.parse((String) e.getValue(),
                                                RoomPresenceData.class);
            return RoomMemberVO.builder()
                .userId(userId)
                .status(data.getStatus())
                .lastActive(data.getLastActive())
                .build();
        })
        .collect(Collectors.toList());
}
```

### 13.4 集成：AI 辅导对话

```java
// AI 对话时感知用户当前学习上下文
public AIResponse chat(Long userId, String question) {
    PresenceInfo presence = presenceQuery.queryPresenceSafe(userId);

    // 将用户当前学习上下文注入 AI Prompt
    if (presence.getSubject() != null) {
        promptBuilder.appendContext(String.format(
            "学生当前正在学习%s（模块：%s，内容：%s）",
            presence.getSubject(),
            presence.getModule(),
            presence.getContentId()
        ));
    }

    // 如果用户在"练习"模块，AI 回答可以引用当前题目
    if ("practice".equals(presence.getModule())) {
        promptBuilder.appendContext(
            "学生正在做题，请优先给出引导性提示而非直接答案");
    }

    return aiService.chat(promptBuilder.build());
}
```

---

## 14. 配置参考

### application.yml

```yaml
presence:
  heartbeat:
    interval: 30              # 默认心跳间隔(秒)
    timeout: 120              # 心跳超时阈值(秒)
    idle-threshold: 60        # IDLE 状态判定阈值(秒)

  reaper:
    enabled: true
    interval-ms: 15000        # Reaper 扫描间隔(毫秒)
    batch-size: 500           # 每批扫描数量
    shard-count: 1            # 分片数(集群模式下>1)
    shard-index: 0            # 本节点分片索引

  subscription:
    max-per-session: 500      # 单会话最大订阅用户数

  query:
    batch-size: 100           # 批量查询每批大小
    cache-ttl-sec: 10         # 本地缓存TTL(秒)
    stale-cache-ttl-sec: 300  # 降级缓存最大有效期(秒)

  redis:
    key-prefix: "presence"
    default-ttl-sec: 120      # 设备 Hash 默认 TTL

  metrics:
    enabled: true
    detailed-stats-interval-ms: 60000  # 详细统计刷新间隔
```

---

## 15. 版本演进路线

| 版本 | 功能 | 说明 |
| --- | --- | --- |
| v1.0 | 基础 Presence | 在线/离线状态 + 心跳 + 基本查询 |
| v1.1 | 活动上下文 | 模块/科目/内容追踪 + 状态变更事件 |
| v1.2 | 多端同步 | 多设备管理 + 主设备切换 |
| v1.3 | 统计分析 | 在线统计 + 分维度聚合 + Prometheus 指标 |
| v1.4 | 智能通知联动 | 与通知服务集成 + 推送决策 |
| v2.0 | 分布式扩展 | Redis Cluster 分片 + Reaper 分片协调 |
| v2.1 | Presence Analytics | 活跃度热力图 + 行为模式分析 + 预测 |

---

*文档版本: 1.0 | 创建日期: 2026-07-07 | 模块: 服务端-实时Presence服务*
