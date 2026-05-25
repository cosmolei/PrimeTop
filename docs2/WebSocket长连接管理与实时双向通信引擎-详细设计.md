# WebSocket 长连接管理与实时双向通信引擎 — 详细设计

> **模块定位：** 服务端–客户端双向实时通信基础设施，负责 WebSocket 连接生命周期管理、设备级通道维护、实时消息推送/接收、集群广播路由，为在线状态同步、实时通知投递、AI 语音对话信令、多设备协调等场景提供统一的实时通信底座。
>
> **关联模块：** SSE流式响应与AI增量渲染引擎、消息与推送服务、用户设备管理与多端登录策略、通知中心与站内消息系统、客户端网络请求治理与弱网适配方案、客户端应用生命周期与后台任务调度

---

## 1. 背景与目标

### 1.1 问题

PrimeTop 已通过 SSE 覆盖了 AI 对话流式输出的单向推送场景。但产品中存在大量**双向实时通信**需求，SSE 无法满足：

| 场景 | 双向需求 | SSE 能否满足 |
|------|---------|-------------|
| AI 语音陪练 | 客户端实时上传音频流，服务端实时返回 AI 语音 | ❌ SSE 仅单向 |
| 在线状态同步 | 多设备在线/离线状态变更需实时广播 | ❌ 需服务端推送 |
| 实时通知投递 | 系统消息、学习提醒即时送达 | ⚠️ SSE 可行但无法上行 |
| 家长端实时监控 | 家长远程查看孩子学习状态变化 | ❌ 需双向 |
| 多设备操作协调 | 一端删除消息/收藏，其他端实时同步 | ❌ 需服务端广播 |
| AI 辅导中断/续传 | 用户中途中断 AI 回答，需发送取消指令 | ⚠️ SSE 中断需 HTTP 请求 |
| 协作学习（远期） | 多人实时协作解题 | ❌ 完全双向 |
| 实时客服对话 | 用户与客服 IM 即时通讯 | ❌ 完全双向 |

### 1.2 设计目标

| 指标 | 目标值 |
|------|--------|
| 单节点并发 WebSocket 连接数 | ≥ 50,000 |
| 消息送达延迟（同机房） | ≤ 50ms |
| 消息送达延迟（跨区域） | ≤ 200ms |
| 断线重连恢复时间 | ≤ 3s |
| 消息丢失率 | ≤ 0.01%（可接受范围内允许业务层补偿） |
| 连接建立延迟 | ≤ 500ms |
| 单连接内存占用 | ≤ 8KB |
| 集群广播扇出延迟（10K 连接） | ≤ 100ms |

### 1.3 技术选型

| 层面 | 选择 | 理由 |
|------|------|------|
| 传输协议 | WebSocket (RFC 6455) | 全双工、低开销、原生浏览器/移动端支持 |
| 升级方案 | WSS (TLS) | 安全性要求，防窃听/中间人 |
| 服务端框架 | Spring WebSocket + Netty | 与现有 Spring Boot 技术栈一致；Netty 提供高性能 NIO |
| 集群消息路由 | Redis Pub/Sub | 轻量、低延迟；与现有 Redis 基础设施复用 |
| 备选集群方案 | RocketMQ 广播消费 | 适用于超高扇出场景，消息可持久化 |
| 序列化格式 | JSON（默认）/ Protobuf（高频场景） | JSON 易调试；Protobuf 省带宽 |
| 心跳机制 | Ping/Pong + 应用层心跳 | 双层保障，快速检测死连接 |

### 1.4 与 SSE 的关系

| 维度 | SSE | WebSocket |
|------|-----|-----------|
| 方向 | 服务端 → 客户端（单向） | 双向 |
| 协议 | HTTP/1.1+ | 独立协议（HTTP 升级） |
| 重连 | 浏览器自动重连 | 需客户端实现 |
| 适用场景 | AI 流式文本输出 | 双向交互、实时通知、语音流 |
| 并发成本 | 低（复用 HTTP 连接） | 中（独立长连接） |

**策略：SSE 用于 AI 文本流式输出，WebSocket 用于所有双向实时通信场景。两者共存。**

---

## 2. 架构总览

### 2.1 整体架构图

```
┌──────────────────────────────────────────────────────────────┐
│                        客户端 (Flutter)                       │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ WS Manager│  │ Reconnect Mgr│  │ Message Serializer     │  │
│  │ (连接管理) │  │ (断线重连)    │  │ (JSON/Protobuf 序列化) │  │
│  └─────┬─────┘  └──────┬───────┘  └───────────┬────────────┘  │
│        └────────────────┼──────────────────────┘              │
│                         │ WSS                                 │
└─────────────────────────┼────────────────────────────────────┘
                          │
                    ┌─────┴─────┐
                    │  LB/Nginx │  ← sticky session or L7 routing
                    └─────┬─────┘
                          │
        ┌─────────────────┼──────────────────┐
        │                 │                  │
   ┌────┴────┐      ┌────┴────┐       ┌────┴────┐
   │ WS Node 1│     │ WS Node 2│      │ WS Node N│   ← WebSocket 服务集群
   │(Netty)   │     │(Netty)   │      │(Netty)   │
   │          │     │          │      │          │
   │ Channel  │     │ Channel  │      │ Channel  │
   │ Manager  │     │ Manager  │      │ Manager  │
   └────┬─────┘     └────┬─────┘      └────┬─────┘
        │                │                  │
        └────────────────┼──────────────────┘
                         │
              ┌──────────┴──────────┐
              │   Redis Pub/Sub     │   ← 集群内消息路由
              │   Channel: ws:push  │
              └──────────┬──────────┘
                         │
        ┌────────────────┼───────────────────┐
        │                │                   │
   ┌────┴────┐     ┌────┴────┐        ┌────┴────┐
   │ 业务服务  │    │ 通知服务  │       │ AI 服务  │
   │ (在线状态 │    │ (消息推送 │       │ (语音流  │
   │  设备协调) │    │  已读同步) │       │  信令)   │
   └─────────┘     └─────────┘        └─────────┘
```

### 2.2 核心组件

| 组件 | 职责 |
|------|------|
| **WS Gateway** | WebSocket 升级握手、TLS 终结、身份认证、限流 |
| **Channel Manager** | 连接注册/注销、用户↔通道映射、心跳检测 |
| **Message Router** | 消息分发：点对点、广播、组播 |
| **Redis Pub/Sub Bridge** | 跨节点消息路由，解决集群场景下消息可达性 |
| **Presence Service** | 在线状态管理：上线、离线、多设备状态聚合 |
| **Reconnect Manager (Client)** | 客户端断线重连：指数退避、消息补发 |

---

## 3. 连接生命周期管理

### 3.1 连接建立流程

```
客户端                                    服务端
  │                                         │
  │──── HTTP GET /ws/connect ──────────────→│  ① 升级请求
  │     Headers:                            │
  │     Upgrade: websocket                  │
  │     Connection: Upgrade                 │
  │     Sec-WebSocket-Key: xxx              │
  │     Sec-WebSocket-Version: 13           │
  │     Authorization: Bearer <JWT>         │  ② JWT 认证
  │     X-Device-Id: <device_id>            │  ③ 设备标识
  │     X-App-Version: <version>            │  ④ 客户端版本
  │     X-OS: android/ios/web               │
  │                                         │
  │←─── 101 Switching Protocols ────────────│  ⑤ 握手成功
  │                                         │
  │←──── {"type":"connected", ...} ─────────│  ⑥ 连接确认帧
  │                                         │
  │──── {"type":"heartbeat","seq":1} ──────→│  ⑦ 心跳开始
  │←──── {"type":"heartbeat_ack","seq":1} ─│
  │                                         │
```

#### 3.1.1 认证与鉴权

**JWT Token 认证流程：**

```java
@Component
public class WebSocketAuthInterceptor implements HandshakeInterceptor {

    private final JwtTokenProvider jwtTokenProvider;
    private final DeviceService deviceService;
    private final RateLimiter connectRateLimiter; // 每用户每分钟连接次数限制

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Map<String, Object> attributes) {
        // 1. 提取 Token
        String token = extractToken(request);
        if (token == null) {
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }

        // 2. 校验 JWT
        JwtClaims claims;
        try {
            claims = jwtTokenProvider.validateToken(token);
        } catch (JwtExpiredException e) {
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }

        // 3. 连接限流（每用户每分钟最多 10 次）
        String rateLimitKey = "ws:connect:rate:" + claims.getUserId();
        if (!connectRateLimiter.tryAcquire(rateLimitKey, 10, 60)) {
            response.setStatusCode(HttpStatus.TOO_MANY_REQUESTS);
            return false;
        }

        // 4. 设备校验
        String deviceId = extractHeader(request, "X-Device-Id");
        if (deviceId == null) {
            response.setStatusCode(HttpStatus.BAD_REQUEST);
            return false;
        }

        // 5. 检查设备是否被禁止（安全风控）
        if (deviceService.isDeviceBanned(deviceId)) {
            response.setStatusCode(HttpStatus.FORBIDDEN);
            return false;
        }

        // 6. 多端登录策略检查
        MultiDevicePolicy policy = deviceService.getMultiDevicePolicy(claims.getUserId());
        if (policy == MultiDevicePolicy.SINGLE_DEVICE) {
            // 踢掉旧连接
            kickExistingConnections(claims.getUserId(), deviceId);
        }

        // 7. 将认证信息写入 attributes
        attributes.put("userId", claims.getUserId());
        attributes.put("deviceId", deviceId);
        attributes.put("platform", extractHeader(request, "X-OS"));
        attributes.put("appVersion", extractHeader(request, "X-App-Version"));
        attributes.put("connectedAt", Instant.now());

        return true;
    }
}
```

#### 3.1.2 连接确认帧

握手成功后，服务端发送连接确认帧：

```json
{
  "type": "connected",
  "data": {
    "connectionId": "conn_7f3a2b1e",
    "serverTime": 1716633600000,
    "heartbeatInterval": 30000,
    "heartbeatTimeout": 90000,
    "sessionId": "ws_sess_abc123",
    "maxMessageSize": 65536,
    "supportedCodecs": ["json", "protobuf"],
    "reconnectWindow": 300
  },
  "seq": 0
}
```

| 字段 | 说明 |
|------|------|
| `connectionId` | 连接唯一标识，用于重连时恢复 |
| `heartbeatInterval` | 心跳间隔（ms），客户端据此发送心跳 |
| `heartbeatTimeout` | 心跳超时（ms），连续未收到 ack 则认为断连 |
| `reconnectWindow` | 断线后可恢复窗口（s），超过则需重新握手 |
| `supportedCodecs` | 支持的序列化格式，客户端可选 |

### 3.2 心跳机制

采用**双层心跳**策略：

| 层 | 机制 | 间隔 | 超时 |
|----|------|------|------|
| WebSocket 协议层 | Ping/Pong Frame | 60s | 120s（3次未响应） |
| 应用层 | JSON 心跳消息 | 30s | 90s（3次未响应） |

```json
// 客户端 → 服务端
{
  "type": "heartbeat",
  "seq": 42,
  "ts": 1716633630000
}

// 服务端 → 客户端
{
  "type": "heartbeat_ack",
  "seq": 42,
  "ts": 1716633630050
}
```

**心跳异常处理：**

```java
@Component
public class HeartbeatMonitor {

    private final ChannelManager channelManager;
    private final ScheduledExecutorService scheduler;

    // 每个连接维护心跳状态
    private static class HeartbeatState {
        volatile int missedCount = 0;
        volatile long lastHeartbeatTime;
        volatile int expectedSeq = 1;
    }

    @Scheduled(fixedRate = 10_000) // 每 10s 扫描一次
    public void checkHeartbeats() {
        long now = System.currentTimeMillis();

        channelManager.getAllChannels().forEach(channel -> {
            HeartbeatState state = channel.getAttribute("heartbeat");
            if (state == null) return;

            long elapsed = now - state.lastHeartbeatTime;

            // 超过3次未收到心跳，判定连接死亡
            if (state.missedCount >= 3 || elapsed > 90_000) {
                handleDeadConnection(channel, "heartbeat_timeout");
            }
            // 超过1次未收到，发送 Ping Frame 触发
            else if (elapsed > 30_000) {
                state.missedCount++;
                channel.sendPing();
            }
        });
    }

    public void onHeartbeatReceived(WebSocketChannel channel, int seq) {
        HeartbeatState state = channel.getAttribute("heartbeat");
        state.lastHeartbeatTime = System.currentTimeMillis();
        state.missedCount = 0;
        state.expectedSeq = seq + 1;
    }
}
```

### 3.3 连接关闭

#### 3.3.1 正常关闭

```json
// 客户端或服务端发起
{
  "type": "close",
  "data": {
    "reason": "user_logout",       // user_logout | server_maintenance | device_switch
    "reconnectable": false          // 是否可重连
  }
}
```

**关闭原因枚举：**

| Code | Reason | 说明 |
|------|--------|------|
| 1000 | normal | 正常关闭 |
| 1001 | user_logout | 用户主动退出 |
| 1002 | device_switch | 用户在另一设备登录 |
| 1003 | server_maintenance | 服务端维护 |
| 1008 | policy_violation | 策略违规（如发送非法消息） |
| 1011 | internal_error | 服务端内部错误 |
| 4001 | token_expired | Token 过期，需刷新 |
| 4002 | device_kicked | 设备被踢（多端策略） |
| 4003 | rate_limited | 消息发送频率超限 |
| 4004 | version_obsolete | 客户端版本过低，需强制升级 |

#### 3.3.2 异常关闭处理

```java
@Component
public class ConnectionLifecycleManager {

    private final ChannelManager channelManager;
    private final PresenceService presenceService;
    private final MessageBuffer messageBuffer;    // 离线消息缓冲
    private final RedisMessageRouter redisRouter;

    /**
     * 连接断开回调 — 无论正常关闭还是异常断连
     */
    public void onDisconnect(WebSocketChannel channel, CloseStatus status) {
        String userId = channel.getUserId();
        String deviceId = channel.getDeviceId();
        String connectionId = channel.getConnectionId();

        // 1. 从 Channel Manager 注销
        channelManager.unregister(connectionId);

        // 2. 如果是可重连的断开（异常/网络波动），保留消息缓冲
        if (status.isReconnectable()) {
            // 缓冲后续消息 5 分钟
            messageBuffer.enableBuffering(userId, deviceId, Duration.ofMinutes(5));
            // 发布设备暂时离线事件
            presenceService.updateDeviceStatus(userId, deviceId, DeviceStatus.RECONNECTING);
        } else {
            // 3. 不可重连 — 彻底下线
            messageBuffer.disableBuffering(userId, deviceId);
            presenceService.updateDeviceStatus(userId, deviceId, DeviceStatus.OFFLINE);

            // 4. 检查用户是否所有设备都离线了
            boolean allDevicesOffline = presenceService
                .areAllDevicesOffline(userId);

            if (allDevicesOffline) {
                // 5. 发布用户离线事件
                publishUserOfflineEvent(userId);

                // 6. 通知相关方（如家长端）
                notifyUserOffline(userId);
            }
        }

        // 7. 记录连接日志
        logConnectionEvent(userId, deviceId, connectionId, "disconnect", status);
    }
}
```

### 3.4 断线重连

#### 3.4.1 客户端重连策略

```dart
/// Flutter 客户端 WebSocket 重连管理器
class WebSocketReconnectManager {
  static const _maxRetries = 10;
  static const _baseDelay = Duration(seconds: 1);
  static const _maxDelay = Duration(seconds: 30);

  int _retryCount = 0;
  String? _lastConnectionId;
  int _lastReceivedSeq = 0;
  Timer? _reconnectTimer;

  /// 连接断开时调用
  Future<void> onDisconnected(DisconnectReason reason) async {
    switch (reason) {
      case DisconnectReason.tokenExpired:
        // Token 过期 → 先刷新 Token，再重连
        await _refreshToken();
        _scheduleReconnect(immediate: true);
        break;

      case DisconnectReason.deviceKicked:
        // 被踢 → 不重连，通知上层
        _notifyKicked();
        break;

      case DisconnectReason.serverMaintenance:
        // 服务端维护 → 延长重连间隔
        _scheduleReconnect(delay: const Duration(minutes: 5));
        break;

      case DisconnectReason.networkError:
      case DisconnectReason.unknown:
        // 网络/未知错误 → 指数退避重连
        _scheduleReconnect();
        break;
    }
  }

  void _scheduleReconnect({bool immediate = false, Duration? delay}) {
    _reconnectTimer?.cancel();

    if (_retryCount >= _maxRetries) {
      _notifyPermanentFailure();
      return;
    }

    final actualDelay = delay ?? _calculateBackoff();

    _reconnectTimer = Timer(actualDelay, () async {
      _retryCount++;
      await _attemptReconnect();
    });
  }

  Duration _calculateBackoff() {
    // 指数退避 + 随机抖动：1s, 2s, 4s, 8s, 16s, 30s, 30s...
    final exponential = _baseDelay * (1 << _retryCount);
    final capped = exponential > _maxDelay ? _maxDelay : exponential;
    // 加 0~50% 随机抖动，防止雷群效应
    final jitter = capped * (Random().nextDouble() * 0.5);
    return capped + jitter;
  }

  Future<void> _attemptReconnect() async {
    try {
      final ws = await _connectWithResume(
        lastConnectionId: _lastConnectionId,
        lastSeq: _lastReceivedSeq,
      );

      // 重连成功 → 重置计数
      _retryCount = 0;
      _notifyReconnected(ws);
    } catch (e) {
      // 重连失败 → 继续退避
      _scheduleReconnect();
    }
  }
}
```

#### 3.4.2 服务端重连恢复

```java
/**
 * 重连恢复处理器
 * 客户端携带 lastConnectionId + lastSeq 重连时，
 * 服务端从消息缓冲中补发缺失消息
 */
@Component
public class ReconnectResumeHandler {

    private final MessageBuffer messageBuffer;
    private final ChannelManager channelManager;
    private final PresenceService presenceService;

    public ResumeResult handleResume(String userId, String deviceId,
                                      String lastConnectionId, int lastSeq) {
        // 1. 查找是否有对应的缓冲
        List<BufferedMessage> buffered = messageBuffer
            .getBufferedMessages(userId, deviceId, lastConnectionId);

        if (buffered == null || buffered.isEmpty()) {
            // 无缓冲 → 全新连接
            return ResumeResult.fullReconnect();
        }

        // 2. 筛选出 lastSeq 之后的消息
        List<BufferedMessage> missed = buffered.stream()
            .filter(msg -> msg.getSeq() > lastSeq)
            .sorted(Comparator.comparingInt(BufferedMessage::getSeq))
            .collect(Collectors.toList());

        // 3. 检查缓冲是否完整（未被清理）
        if (missed.size() > 0 && missed.get(0).getSeq() > lastSeq + 1) {
            // 有缺口 → 无法完整恢复
            return ResumeResult.partialReconnect(missed, "buffer_gap_detected");
        }

        // 4. 恢复成功
        return ResumeResult.resumed(missed);
    }
}

@Data
@AllArgsConstructor
public class ResumeResult {
    private final boolean resumed;       // 是否成功恢复
    private final boolean fullReconnect; // 是否需要全新连接
    private final List<BufferedMessage> missedMessages; // 需补发的消息
    private final String reason;         // 无法恢复的原因

    public static ResumeResult fullReconnect() {
        return new ResumeResult(false, true, Collections.emptyList(), "no_buffer");
    }

    public static ResumeResult resumed(List<BufferedMessage> missed) {
        return new ResumeResult(true, false, missed, null);
    }

    public static ResumeResult partialReconnect(List<BufferedMessage> missed, String reason) {
        return new ResumeResult(false, false, missed, reason);
    }
}
```

---

## 4. 消息协议设计

### 4.1 消息帧格式

#### 4.1.1 JSON 格式（默认）

```json
{
  "id": "msg_7f3a2b1e_001",      // 消息唯一 ID（用于 ACK/去重）
  "type": "notification.new",     // 消息类型（点分命名空间）
  "seq": 42,                      // 服务端单调递增序列号
  "ts": 1716633630000,            // 服务端时间戳（ms）
  "data": {                       // 消息体（按 type 不同而不同）
    "notificationId": "ntf_123",
    "title": "学习提醒",
    "body": "该做今天的数学练习啦！"
  },
  "ack": true                     // 是否需要客户端确认
}
```

#### 4.1.2 Protobuf 格式（高频场景）

```protobuf
syntax = "proto3";
package primetop.ws.v1;

message WsMessage {
  string id = 1;
  string type = 2;
  uint32 seq = 3;
  int64 ts = 4;
  bytes data = 5;         // 按 type 反序列化为具体消息体
  bool ack = 6;
}

// AI 语音流帧（高频，适合 Protobuf）
message AudioFrame {
  string session_id = 1;
  uint32 frame_index = 2;
  bytes audio_data = 3;      // PCM 16bit 16kHz
  uint32 sample_rate = 4;
  bool is_final = 5;
}

// 在线状态变更
message PresenceUpdate {
  string user_id = 1;
  enum Status {
    ONLINE = 0;
    RECONNECTING = 1;
    OFFLINE = 2;
  }
  Status status = 2;
  string device_id = 3;
  string platform = 4;
}
```

### 4.2 消息类型注册表

| 类型 | 方向 | 描述 | ACK |
|------|------|------|-----|
| `system.connected` | S→C | 连接确认 | ❌ |
| `system.heartbeat` | C→S | 心跳 | ❌ |
| `system.heartbeat_ack` | S→C | 心跳确认 | ❌ |
| `system.close` | 双向 | 连接关闭 | ❌ |
| `system.error` | S→C | 服务端错误 | ❌ |
| `system.config_update` | S→C | 运行时配置变更 | ✅ |
| `notification.new` | S→C | 新通知推送 | ✅ |
| `notification.read_sync` | S→C | 多端已读同步 | ✅ |
| `presence.update` | S→C | 在线状态变更 | ❌ |
| `presence.query` | C→S | 查询指定用户在线状态 | ❌ |
| `presence.query_resp` | S→C | 在线状态查询响应 | ❌ |
| `device.kick` | S→C | 设备被踢通知 | ✅ |
| `message.sync` | S→C | 跨设备消息同步 | ✅ |
| `ai.voice.start` | C→S | 语音对话开始 | ❌ |
| `ai.voice.audio` | C→S | 音频帧上行 | ❌ |
| `ai.voice.audio_resp` | S→C | AI 音频帧下行 | ❌ |
| `ai.voice.end` | C→S | 语音对话结束 | ❌ |
| `ai.session.cancel` | C→S | 取消 AI 对话 | ❌ |
| `ai.session.cancelled` | S→C | AI 对话已取消确认 | ❌ |
| `bookmark.sync` | S→C | 收藏变更同步 | ✅ |
| `learning.progress` | S→C | 学习进度实时更新（家长端） | ❌ |
| `im.chat.message` | 双向 | IM 聊天消息 | ✅ |

### 4.3 消息确认（ACK）机制

```java
/**
 * ACK 机制 — 保证消息至少送达一次
 * 服务端发送需 ACK 的消息后，启动超时重发
 */
@Component
public class AckManager {

    // pendingAcks: msgId → (message, retryCount, sendTime)
    private final Cache<String, PendingAck> pendingAcks = Caffeine.newBuilder()
        .maximumSize(100_000)
        .expireAfterWrite(Duration.ofMinutes(5))
        .build();

    private static final int MAX_RETRY = 3;
    private static final Duration ACK_TIMEOUT = Duration.ofSeconds(5);

    /**
     * 发送需 ACK 的消息
     */
    public void sendWithAck(WebSocketChannel channel, WsMessage message) {
        channel.send(message);
        pendingAcks.put(message.getId(), new PendingAck(message, channel, 0));
    }

    /**
     * 收到客户端 ACK
     */
    public void onAckReceived(String userId, String deviceId, String messageId) {
        PendingAck pending = pendingAcks.getIfPresent(messageId);
        if (pending != null) {
            pendingAcks.invalidate(messageId);
        }
    }

    /**
     * 超时重发扫描（每秒执行）
     */
    @Scheduled(fixedRate = 1000)
    public void retryPendingAcks() {
        long now = System.currentTimeMillis();

        for (Map.Entry<String, PendingAck> entry : pendingAcks.asMap().entrySet()) {
            PendingAck pending = entry.getValue();
            long elapsed = now - pending.lastSendTime;

            if (elapsed > ACK_TIMEOUT.toMillis()) {
                if (pending.retryCount >= MAX_RETRY) {
                    // 超过最大重试 → 丢弃，记录日志
                    pendingAcks.invalidate(entry.getKey());
                    log.warn("ACK timeout, message dropped: msgId={}, userId={}",
                             entry.getKey(), pending.channel.getUserId());
                } else {
                    // 重发
                    pending.retryCount++;
                    pending.lastSendTime = now;
                    pending.channel.send(pending.message);
                }
            }
        }
    }
}
```

客户端 ACK 发送：

```json
{
  "type": "system.ack",
  "data": {
    "messageId": "msg_7f3a2b1e_001"
  }
}
```

---

## 5. 集群消息路由

### 5.1 问题

用户 A 连接在 Node-1，用户 B 连接在 Node-2。当业务服务需要给用户 A 推消息时，消息可能到达 Node-2，需要路由到 Node-1。

### 5.2 Redis Pub/Sub 路由方案

```java
/**
 * 基于 Redis Pub/Sub 的集群消息路由器
 */
@Component
public class RedisMessageRouter {

    private final RedisTemplate<String, String> redisTemplate;
    private final ChannelManager channelManager;
    private final MessageSerializer serializer;

    // 每个 WebSocket 节点订阅唯一频道
    private static final String NODE_CHANNEL_PREFIX = "ws:node:";
    private String nodeId;

    // 广播频道（所有节点都订阅）
    private static final String BROADCAST_CHANNEL = "ws:broadcast";

    @PostConstruct
    public void init() {
        this.nodeId = generateNodeId();

        // 订阅本节点频道
        redisTemplate.execute((RedisCallback<Void>) connection -> {
            connection.subscribe(
                (message, pattern) -> onNodeMessage(message),
                (NODE_CHANNEL_PREFIX + nodeId).getBytes()
            );
            return null;
        });

        // 订阅广播频道
        redisTemplate.execute((RedisCallback<Void>) connection -> {
            connection.subscribe(
                (message, pattern) -> onBroadcastMessage(message),
                BROADCAST_CHANNEL.getBytes()
            );
            return null;
        });
    }

    /**
     * 向指定用户推送消息（业务服务调用）
     * 路由策略：查找用户所在节点 → 直接投递到该节点频道
     */
    public void pushToUser(String userId, String type, Object data) {
        // 1. 从 Redis 查找用户连接在哪个节点
        String targetNodeId = findUserNode(userId);

        if (targetNodeId != null) {
            // 2. 发布到目标节点的 Redis 频道
            WsMessage msg = WsMessage.builder()
                .id(generateMessageId())
                .type(type)
                .data(data)
                .ts(System.currentTimeMillis())
                .build();

            String payload = serializer.serialize(msg);
            redisTemplate.convertAndSend(NODE_CHANNEL_PREFIX + targetNodeId, payload);
        } else {
            // 用户不在线 → 走离线消息通道（入库，等用户上线后拉取）
            handleOfflineUser(userId, type, data);
        }
    }

    /**
     * 向指定用户所有设备广播
     */
    public void broadcastToUserDevices(String userId, String type, Object data) {
        Set<String> nodeIds = findUserAllNodes(userId); // 一个用户可能多设备连不同节点

        WsMessage msg = buildMessage(type, data);
        String payload = serializer.serialize(msg);

        for (String nodeId : nodeIds) {
            redisTemplate.convertAndSend(NODE_CHANNEL_PREFIX + nodeId, payload);
        }
    }

    /**
     * 全集群广播（如系统公告、强制升级）
     */
    public void broadcastAll(String type, Object data) {
        WsMessage msg = buildMessage(type, data);
        String payload = serializer.serialize(msg);
        redisTemplate.convertAndSend(BROADCAST_CHANNEL, payload);
    }

    /**
     * 查找用户所在节点 — Redis Hash
     * key: ws:user:nodes:{userId}
     * field: deviceId
     * value: nodeId
     */
    private String findUserNode(String userId) {
        // 优先查找主设备
        Map<String, String> deviceNodeMap = redisTemplate.opsForHash()
            .entries("ws:user:nodes:" + userId);

        if (deviceNodeMap.isEmpty()) return null;
        // 返回第一个活跃节点（任意设备即可，消息会由 ChannelManager 路由到正确连接）
        return deviceNodeMap.values().iterator().next();
    }
}
```

### 5.3 Redis 数据结构

| Key | 类型 | 用途 | TTL |
|-----|------|------|-----|
| `ws:user:nodes:{userId}` | Hash | 用户各设备连接的节点映射 | 连接断开后删除 |
| `ws:node:connections:{nodeId}` | Set | 本节点所有连接的 connectionId | 节点心跳续期 |
| `ws:connection:{connectionId}` | Hash | 连接详情（userId, deviceId, seq） | 连接断开后延迟删除 |
| `ws:buffer:{userId}:{deviceId}` | Sorted Set (score=seq) | 离线消息缓冲 | 5 分钟自动过期 |
| `ws:online:users` | Set | 全局在线用户集合 | 心跳续期 |

---

## 6. 在线状态管理（Presence Service）

### 6.1 状态模型

```
                    ┌─────────┐
          连接建立   │         │  心跳超时/断连
       ┌──────────→│  ONLINE  │──────────┐
       │            │         │          │
       │            └─────────┘          │
       │                                 ↓
  ┌────┴──────┐                   ┌─────────────┐
  │           │                   │             │
  │ OFFLINE   │                   │RECONNECTING │
  │           │  重连失败/超时      │             │
  └───────────┘←──────────────────└─────────────┘
       ↑                                  │
       │          重连成功                  │
       └──────────────────────────────────┘
                (经过 ONLINE)
```

### 6.2 多设备状态聚合

一个用户可能有多个设备同时在线，对外暴露的在线状态需要聚合：

```java
@Service
public class PresenceService {

    private final RedisTemplate<String, String> redisTemplate;
    private final RedisMessageRouter messageRouter;

    /**
     * 获取用户聚合在线状态
     */
    public UserPresence getUserPresence(String userId) {
        Map<String, String> deviceNodes = redisTemplate.opsForHash()
            .entries("ws:user:nodes:" + userId);

        if (deviceNodes.isEmpty()) {
            return UserPresence.offline(userId);
        }

        List<DevicePresence> devices = deviceNodes.entrySet().stream()
            .map(entry -> {
                String deviceId = entry.getKey();
                String detail = getConnectionDetail(userId, deviceId);
                return DevicePresence.builder()
                    .deviceId(deviceId)
                    .platform(detail.get("platform"))
                    .connectedAt(Instant.parse(detail.get("connectedAt")))
                    .status(DeviceStatus.ONLINE)
                    .build();
            })
            .collect(Collectors.toList());

        return UserPresence.builder()
            .userId(userId)
            .status(UserStatus.ONLINE)
            .deviceCount(devices.size())
            .devices(devices)
            .lastActiveTime(devices.stream()
                .map(DevicePresence::getConnectedAt)
                .max(Comparator.naturalOrder())
                .orElse(Instant.EPOCH))
            .build();
    }

    /**
     * 批量查询在线状态（家长端查看孩子、教师查看学生）
     */
    public Map<String, UserStatus> batchGetPresence(List<String> userIds) {
        Pipeline pipeline = redisTemplate.pipelined();
        Map<String, UserStatus> result = new HashMap<>();

        for (String userId : userIds) {
            result.put(userId, redisTemplate.opsForHash()
                .size("ws:user:nodes:" + userId) > 0
                ? UserStatus.ONLINE : UserStatus.OFFLINE);
        }

        return result;
    }

    /**
     * 状态变更广播
     * 订阅方：家长端（监听孩子上线/离线）、教师端
     */
    public void onStatusChanged(String userId, UserStatus newStatus) {
        // 查找谁在关注这个用户的状态（家长、老师）
        List<String> watchers = findPresenceWatchers(userId);

        for (String watcherId : watchers) {
            messageRouter.pushToUser(watcherId, "presence.update",
                Map.of(
                    "userId", userId,
                    "status", newStatus.name(),
                    "timestamp", Instant.now().toString()
                ));
        }
    }
}
```

---

## 7. 核心业务场景实现

### 7.1 实时通知推送

```java
@Service
public class NotificationPushService {

    private final RedisMessageRouter messageRouter;
    private final NotificationRepository notificationRepo;

    /**
     * 发送实时通知
     * 场景：学习提醒、系统公告、作业布置、家长消息
     */
    public void pushNotification(String userId, Notification notification) {
        // 1. 入库（持久化）
        notificationRepo.save(notification);

        // 2. 实时推送
        messageRouter.broadcastToUserDevices(userId, "notification.new", Map.of(
            "notificationId", notification.getId(),
            "type", notification.getType(),
            "title", notification.getTitle(),
            "body", notification.getBody(),
            "priority", notification.getPriority(),
            "createdAt", notification.getCreatedAt().toString(),
            "extra", notification.getExtra()
        ));
    }

    /**
     * 批量推送（如全班通知）
     */
    public void batchPushNotifications(List<String> userIds, Notification notification) {
        // 批量入库
        List<Notification> notifications = userIds.stream()
            .map(uid -> notification.copyForUser(uid))
            .collect(Collectors.toList());
        notificationRepo.batchSave(notifications);

        // 分批推送（每批 100 用户，避免 Redis Pub/Sub 积压）
        Iterables.partition(notifications, 100).forEach(batch -> {
            batch.forEach(n ->
                messageRouter.pushToUser(n.getUserId(), "notification.new", n.toMap())
            );
        });
    }
}
```

### 7.2 多端已读同步

```java
@Service
public class ReadSyncService {

    /**
     * 某设备标记消息已读 → 同步到其他设备
     * 场景：手机端读了通知 → 平板端实时消失未读角标
     */
    public void onReadMarked(String userId, String deviceId, String targetId, String targetType) {
        // 1. 更新数据库已读状态
        readStatusService.markAsRead(userId, targetId, targetType);

        // 2. 推送给该用户其他设备
        messageRouter.broadcastToUserDevices(userId, "notification.read_sync", Map.of(
            "targetId", targetId,
            "targetType", targetType,
            "readAt", Instant.now().toString(),
            "sourceDeviceId", deviceId       // 排除源设备
        ));
    }
}
```

### 7.3 AI 语音对话信令

```java
@Service
public class VoiceSessionManager {

    private final RedisMessageRouter messageRouter;
    private final AIVoiceService aiVoiceService;

    /**
     * AI 语音陪练会话 — 通过 WebSocket 建立双向音频流
     *
     * 流程：
     * 1. 客户端发送 ai.voice.start → 服务端创建会话
     * 2. 客户端持续发送 ai.voice.audio（PCM 帧）
     * 3. 服务端实时 ASR → AI 处理 → TTS → 返回 ai.voice.audio_resp
     * 4. 客户端发送 ai.voice.end → 服务端清理会话
     */
    public void handleVoiceStart(WebSocketChannel channel, VoiceStartRequest request) {
        String userId = channel.getUserId();
        String sessionId = "voice_" + IdGenerator.next();

        // 1. 创建语音会话
        VoiceSession session = VoiceSession.builder()
            .sessionId(sessionId)
            .userId(userId)
            .deviceId(channel.getDeviceId())
            .subject(request.getSubject())
            .grade(request.getGrade())
            .createdAt(Instant.now())
            .build();

        voiceSessionRepo.save(session);

        // 2. 返回会话确认
        channel.send(WsMessage.builder()
            .type("ai.voice.started")
            .data(Map.of(
                "sessionId", sessionId,
                "audioFormat", "pcm_16k_16bit",
                "chunkDurationMs", 100
            ))
            .build());

        // 3. 注册音频流处理器
        channel.registerHandler("ai.voice.audio",
            payload -> handleAudioFrame(session, payload));
    }

    /**
     * 处理上行音频帧
     */
    private void handleAudioFrame(VoiceSession session, AudioFramePayload payload) {
        // 1. ASR 识别
        String text = aiVoiceService.recognize(payload.getAudioData());

        if (text == null || text.isBlank()) return; // 静音帧

        // 2. AI 生成回复（流式）
        String reply = aiVoiceService.generateReply(session, text);

        // 3. TTS 合成
        byte[] audioReply = aiVoiceService.synthesize(reply, session.getGrade());

        // 4. 通过 WebSocket 返回音频帧
        messageRouter.pushToUser(session.getUserId(), "ai.voice.audio_resp",
            Map.of(
                "sessionId", session.getSessionId(),
                "text", reply,
                "audioData", Base64.getEncoder().encodeToString(audioReply),
                "isFinal", false
            ));
    }
}
```

### 7.4 家长端实时监控

```java
@Service
public class ParentMonitorService {

    private final RedisMessageRouter messageRouter;

    /**
     * 孩子学习状态变更 → 实时推送到家长端
     *
     * 场景：
     * - 孩子开始学习某科目
     * - 孩子完成一套练习
     * - 孩子学习时长超限（防沉迷）
     * - 孩子在线/离线状态变更
     */
    public void onChildLearningEvent(String childUserId, LearningEvent event) {
        // 查找绑定的家长
        List<String> parentUserIds = parentBindingService.getParentIds(childUserId);

        for (String parentId : parentUserIds) {
            messageRouter.pushToUser(parentId, "learning.progress", Map.of(
                "childUserId", childUserId,
                "eventType", event.getType(),       // study_start | study_end | exercise_complete | duration_alert
                "subject", event.getSubject(),
                "duration", event.getDuration(),
                "timestamp", Instant.now().toString(),
                "summary", event.getSummary()
            ));
        }
    }
}
```

---

## 8. 安全设计

### 8.1 连接级安全

| 威胁 | 防护措施 |
|------|---------|
| 未授权连接 | JWT 认证 + 设备绑定校验 |
| Token 泄露 | Token 有效期短（2h）+ 绑定设备指纹 |
| 连接劫持 | WSS 强制 TLS、Origin 校验 |
| DDoS | 连接频率限制（IP + 用户双维度） |
| 恶意消息 | 消息大小限制（64KB）、频率限制、内容过滤 |

### 8.2 消息级安全

```java
@Component
public class MessageSecurityFilter {

    private final ContentModerationService contentModeration;
    private final RateLimiter messageRateLimiter;

    /**
     * 消息入站安全过滤
     */
    public FilterResult filterInbound(WebSocketChannel channel, WsMessage message) {
        // 1. 消息大小检查
        int serializedSize = message.getSerializedSize();
        if (serializedSize > 65536) { // 64KB
            return FilterResult.reject("message_too_large", serializedSize + " bytes");
        }

        // 2. 消息频率限制（每用户每秒 20 条）
        String rateKey = "ws:msg:rate:" + channel.getUserId();
        if (!messageRateLimiter.tryAcquire(rateKey, 20, 1)) {
            return FilterResult.reject("rate_limited", "消息发送频率超限");
        }

        // 3. 消息类型白名单
        if (!MessageTypeRegistry.isAllowedInbound(message.getType())) {
            return FilterResult.reject("invalid_type", message.getType());
        }

        // 4. 内容安全审核（仅文本类消息）
        if (MessageTypeRegistry.requiresContentModeration(message.getType())) {
            ModerationResult result = contentModeration.moderate(
                extractTextContent(message.getData()));
            if (result.isBlocked()) {
                return FilterResult.reject("content_blocked", result.getReason());
            }
        }

        return FilterResult.pass();
    }
}
```

---

## 9. 性能优化

### 9.1 连接池与内存优化

```java
@Configuration
public class WebSocketNettyConfig {

    @Bean
    public NettyWebSocketServerFactory webSocketServerFactory() {
        NettyWebSocketServerFactory factory = new NettyWebSocketServerFactory();

        factory.setWorkerThreads(Runtime.getRuntime().availableProcessors() * 2);
        factory.setMaxFrameSize(65536);            // 64KB
        factory.setConnectionIdleTimeout(120_000);  // 2分钟无活动则关闭

        // Netty buffer 优化
        factory.setOption(ChannelOption.ALLOCATOR, PooledByteBufAllocator.DEFAULT);
        factory.setOption(ChannelOption.SO_KEEPALIVE, true);
        factory.setOption(ChannelOption.TCP_NODELAY, true);
        factory.setOption(ChannelOption.SO_BACKLOG, 2048);
        factory.setOption(ChannelOption.WRITE_BUFFER_WATER_MARK,
            new WriteBufferWaterMark(32 * 1024, 256 * 1024)); // 32KB low, 256KB high

        return factory;
    }
}
```

### 9.2 Redis Pub/Sub 优化

| 优化项 | 策略 |
|--------|------|
| 消息序列化 | 高频场景用 Protobuf 替代 JSON |
| 批量发送 | 聚合 10ms 窗口内的消息批量 publish |
| 频道设计 | 按用户 Hash 路由到节点频道，避免全局广播 |
| 背压控制 | 节点消息队列深度 > 10K 时触发降级 |

### 9.3 关键指标监控

```java
@Component
public class WebSocketMetrics {

    private final MeterRegistry meterRegistry;

    // 连接数 Gauge
    public void recordActiveConnections(int count) {
        meterRegistry.gauge("ws.connections.active", Tags.empty(), count);
    }

    // 消息吞吐
    public void recordMessageSent(String type) {
        meterRegistry.counter("ws.message.sent", "type", type).increment();
    }

    public void recordMessageReceived(String type) {
        meterRegistry.counter("ws.message.received", "type", type).increment();
    }

    // 延迟
    public void recordMessageLatency(String type, long latencyMs) {
        meterRegistry.timer("ws.message.latency", "type", type)
            .record(latencyMs, TimeUnit.MILLISECONDS);
    }

    // 重连
    public void recordReconnect(boolean success) {
        meterRegistry.counter("ws.reconnect", "success", String.valueOf(success)).increment();
    }

    // ACK
    public void recordAckTimeout(String messageType) {
        meterRegistry.counter("ws.ack.timeout", "type", messageType).increment();
    }
}
```

---

## 10. 降级与容灾

### 10.1 降级策略

| 场景 | 降级措施 |
|------|---------|
| WebSocket 服务不可用 | 客户端自动降级为 HTTP 轮询（长轮询，5s 间隔） |
| Redis Pub/Sub 故障 | 集群内消息不可达 → 降级为数据库轮询拉取 |
| 单节点宕机 | LB 自动剔除，客户端重连到健康节点 |
| 消息堆积 | 超过阈值（10K pending）→ 丢弃低优先级消息 |
| 语音服务过载 | 返回错误码，客户端提示"语音服务繁忙，请稍后重试" |

### 10.2 客户端降级逻辑

```dart
class WebSocketManager with ConnectionStateListener {
  static const _pollingInterval = Duration(seconds: 5);

  Future<void> connect() async {
    try {
      // 尝试 WebSocket 连接
      await _connectWebSocket();
      _connectionMode = ConnectionMode.websocket;
    } catch (e) {
      log.warn('WebSocket 连接失败，降级为轮询: $e');
      _fallbackToPolling();
    }
  }

  void _fallbackToPolling() {
    _connectionMode = ConnectionMode.polling;
    _pollingTimer = Timer.periodic(_pollingInterval, (_) async {
      try {
        final messages = await _httpPollNewMessages();
        for (final msg in messages) {
          _messageDispatcher.dispatch(msg);
        }
      } catch (e) {
        log.error('轮询失败: $e');
      }
    });
  }

  /// 轮询期间周期性尝试恢复 WebSocket
  void _tryRestoreWebSocket() {
    Timer.periodic(Duration(minutes: 1), (timer) async {
      if (_connectionMode == ConnectionMode.polling) {
        try {
          await _connectWebSocket();
          _connectionMode = ConnectionMode.websocket;
          _pollingTimer?.cancel();
          timer.cancel();
          log.info('WebSocket 恢复成功');
        } catch (_) {
          // 继续轮询
        }
      } else {
        timer.cancel();
      }
    });
  }
}
```

### 10.3 容量规划

| 规模 | WebSocket 节点 | Redis | 说明 |
|------|---------------|-------|------|
| MVP (1K DAU) | 1 节点 | 单实例 | 单机即可 |
| V1.0 (50K DAU) | 3 节点 | Sentinel | 高可用 |
| V1.5 (500K DAU) | 10 节点 | Cluster | 分区 |
| V2.0 (5M DAU) | 30+ 节点 | Cluster + RocketMQ | RocketMQ 处理海量广播 |

---

## 11. 客户端 Flutter 实现

### 11.1 WebSocket 管理器

```dart
/// 全局 WebSocket 连接管理器
class WebSocketManager {
  static WebSocketManager? _instance;
  static WebSocketManager get instance => _instance ??= WebSocketManager._();

  WebSocketManager._();

  WebSocketChannel? _channel;
  String? _connectionId;
  int _lastReceivedSeq = 0;
  ConnectionMode _connectionMode = ConnectionMode.none;
  final _messageController = StreamController<WsMessage>.broadcast();
  final _reconnectManager = WebSocketReconnectManager();

  /// 消息流 — 业务层订阅此流
  Stream<WsMessage> get messageStream => _messageController.stream;

  /// 连接状态
  final _connectionState = ValueNotifier<ConnectionState>(ConnectionState.disconnected);
  ValueListenable<ConnectionState> get connectionState => _connectionState;

  /// 连接
  Future<void> connect({String? token, String? deviceId}) async {
    _connectionState.value = ConnectionState.connecting;

    final uri = Uri.parse(AppConfig.wsEndpoint)
        .replace(queryParameters: {
          'token': token ?? await _getToken(),
          'deviceId': deviceId ?? await _getDeviceId(),
          'version': await _getAppVersion(),
          'platform': Platform.operatingSystem,
        });

    try {
      _channel = WebSocketChannel.connect(uri);

      // 等待连接确认
      final firstMessage = await _channel!.stream.first
          .timeout(Duration(seconds: 10));

      final confirm = WsMessage.fromJson(jsonDecode(firstMessage));
      if (confirm.type != 'system.connected') {
        throw Exception('Unexpected first message: ${confirm.type}');
      }

      _connectionId = confirm.data['connectionId'];
      _connectionMode = ConnectionMode.websocket;
      _connectionState.value = ConnectionState.connected;

      // 开始监听消息
      _channel!.stream.listen(
        _onMessage,
        onError: _onError,
        onDone: _onDone,
        cancelOnError: false,
      );
    } catch (e) {
      _connectionState.value = ConnectionState.disconnected;
      _reconnectManager.onDisconnected(DisconnectReason.unknown);
    }
  }

  /// 发送消息
  void send(String type, Map<String, dynamic> data) {
    if (_connectionMode != ConnectionMode.websocket || _channel == null) {
      log.warn('WebSocket 未连接，消息已丢弃: type=$type');
      return;
    }

    final message = {
      'type': type,
      'data': data,
      'ts': DateTime.now().millisecondsSinceEpoch,
    };

    _channel!.sink.add(jsonEncode(message));
  }

  /// 收到消息
  void _onMessage(dynamic raw) {
    try {
      final msg = WsMessage.fromJson(jsonDecode(raw));

      // 更新序列号
      if (msg.seq != null && msg.seq! > _lastReceivedSeq) {
        _lastReceivedSeq = msg.seq!;
      }

      // ACK 确认
      if (msg.ack == true && msg.id != null) {
        send('system.ack', {'messageId': msg.id});
      }

      // 分发到业务层
      _messageController.add(msg);
    } catch (e) {
      log.error('消息解析失败: $e');
    }
  }

  /// 断开
  void disconnect({String reason = 'user_logout'}) {
    send('system.close', {'reason': reason, 'reconnectable': false});
    _channel?.sink.close();
    _connectionState.value = ConnectionState.disconnected;
  }

  @mustCallSuper
  void dispose() {
    _messageController.close();
    _channel?.sink.close();
  }
}

enum ConnectionMode { none, websocket, polling }

enum ConnectionState { disconnected, connecting, connected, reconnecting }
```

### 11.2 业务层消息分发

```dart
/// 消息分发器 — 根据消息类型路由到对应处理器
class MessageDispatcher {
  final Map<String, MessageHandler> _handlers = {};

  void registerHandler(String type, MessageHandler handler) {
    _handlers[type] = handler;
  }

  void dispatch(WsMessage message) {
    // 精确匹配
    final handler = _handlers[message.type];
    if (handler != null) {
      handler.handle(message);
      return;
    }

    // 通配匹配（如 notification.* 匹配所有通知类消息）
    final namespace = message.type.split('.').first;
    final wildcardHandler = _handlers['$namespace.*'];
    if (wildcardHandler != null) {
      wildcardHandler.handle(message);
      return;
    }

    log.warn('无处理器: type=${message.type}');
  }
}

/// 使用示例 — 在业务层注册
void setupMessageHandlers() {
  final dispatcher = MessageDispatcher();

  // 通知处理
  dispatcher.registerHandler('notification.new', (msg) {
    final notification = Notification.fromJson(msg.data);
    NotificationService.instance.onNewNotification(notification);
  });

  // 已读同步
  dispatcher.registerHandler('notification.read_sync', (msg) {
    NotificationService.instance.onReadSynced(msg.data);
  });

  // 在线状态
  dispatcher.registerHandler('presence.update', (msg) {
    PresenceService.instance.onPresenceUpdate(msg.data);
  });

  // 设备被踢
  dispatcher.registerHandler('device.kick', (msg) {
    AuthService.instance.onDeviceKicked(msg.data);
  });

  // 学习进度（家长端）
  dispatcher.registerHandler('learning.progress', (msg) {
    ParentMonitorService.instance.onChildProgress(msg.data);
  });
}
```

---

## 12. API 接口设计

### 12.1 WebSocket 连接端点

| 端点 | 方式 | 说明 |
|------|------|------|
| `wss://api.primetop.com/ws/connect` | WebSocket Upgrade | 主连接端点 |

**Query Parameters:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `token` | string | ✅ | JWT Token |
| `deviceId` | string | ✅ | 设备唯一标识 |
| `version` | string | ✅ | 客户端版本号 |
| `platform` | string | ✅ | 平台：android/ios/web/harmony |
| `codec` | string | ❌ | 序列化格式：json（默认）/ protobuf |

### 12.2 HTTP 辅助接口（降级/备用）

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/v1/ws/messages/poll` | GET | 轮询拉取未读消息（降级用） |
| `/api/v1/ws/messages/send` | POST | 通过 HTTP 发送消息（降级用） |
| `/api/v1/ws/presence/{userId}` | GET | 查询用户在线状态 |
| `/api/v1/ws/presence/batch` | POST | 批量查询在线状态 |

#### 轮询接口

```
GET /api/v1/ws/messages/poll?lastSeq=42&limit=50
Authorization: Bearer <JWT>
```

**Response:**
```json
{
  "code": 0,
  "data": {
    "messages": [
      {
        "id": "msg_xxx",
        "type": "notification.new",
        "seq": 43,
        "ts": 1716633630000,
        "data": { ... }
      }
    ],
    "hasMore": false,
    "currentSeq": 45
  }
}
```

#### 在线状态查询

```
GET /api/v1/ws/presence/{userId}
Authorization: Bearer <JWT>
```

**Response:**
```json
{
  "code": 0,
  "data": {
    "userId": "u_123",
    "status": "online",
    "deviceCount": 2,
    "devices": [
      {
        "deviceId": "dev_abc",
        "platform": "android",
        "connectedAt": "2026-05-25T10:00:00Z"
      },
      {
        "deviceId": "dev_xyz",
        "platform": "ios",
        "connectedAt": "2026-05-25T11:30:00Z"
      }
    ],
    "lastActiveTime": "2026-05-25T11:30:00Z"
  }
}
```

---

## 13. 数据库表设计

### 13.1 WebSocket 连接日志表

```sql
CREATE TABLE ws_connection_log (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    connection_id   VARCHAR(32) NOT NULL COMMENT '连接唯一标识',
    user_id         BIGINT NOT NULL COMMENT '用户ID',
    device_id       VARCHAR(64) NOT NULL COMMENT '设备ID',
    platform        VARCHAR(16) NOT NULL COMMENT '平台：android/ios/web/harmony',
    app_version     VARCHAR(16) COMMENT '客户端版本',
    node_id         VARCHAR(32) NOT NULL COMMENT '服务端节点ID',
    connected_at    DATETIME(3) NOT NULL COMMENT '连接建立时间',
    disconnected_at DATETIME(3) COMMENT '连接断开时间',
    duration_ms     BIGINT COMMENT '连接持续时间(ms)',
    close_code      INT COMMENT 'WebSocket 关闭码',
    close_reason    VARCHAR(64) COMMENT '关闭原因',
    reconnect_count INT DEFAULT 0 COMMENT '重连次数',
    client_ip       VARCHAR(45) COMMENT '客户端IP',
    INDEX idx_user_time (user_id, connected_at),
    INDEX idx_device_time (device_id, connected_at),
    INDEX idx_connected_at (connected_at)
) COMMENT 'WebSocket连接日志';
```

### 13.2 消息投递记录表（审计用）

```sql
CREATE TABLE ws_message_delivery (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    message_id      VARCHAR(64) NOT NULL COMMENT '消息唯一ID',
    user_id         BIGINT NOT NULL COMMENT '目标用户ID',
    device_id       VARCHAR(64) COMMENT '目标设备ID（空=所有设备）',
    message_type    VARCHAR(64) NOT NULL COMMENT '消息类型',
    seq             INT COMMENT '序列号',
    payload         JSON COMMENT '消息内容摘要（脱敏）',
    deliver_status  VARCHAR(16) NOT NULL COMMENT '投递状态：sent/acked/failed/buffered',
    sent_at         DATETIME(3) COMMENT '发送时间',
    acked_at        DATETIME(3) COMMENT '确认时间',
    retry_count     INT DEFAULT 0 COMMENT '重试次数',
    INDEX idx_user_status (user_id, deliver_status, sent_at),
    INDEX idx_message_id (message_id),
    INDEX idx_sent_at (sent_at)
) COMMENT 'WebSocket消息投递记录';
```

---

## 14. 部署架构

### 14.1 MVP 阶段

```
                    ┌─────────┐
                    │  Nginx  │  ← L7 WebSocket 代理 + TLS
                    └────┬────┘
                         │
                   ┌─────┴─────┐
                   │ WS Server │  ← 单节点，Spring Boot 内嵌 Netty
                   │  (50K 连接)│
                   └─────┬─────┘
                         │
                   ┌─────┴─────┐
                   │   Redis   │  ← 单实例，Pub/Sub + 在线状态
                   └───────────┘
```

### 14.2 V1.0 阶段

```
                    ┌──────────────┐
                    │ LB (L7 WSS)  │  ← sticky session by userId
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────┴─────┐┌────┴────┐┌─────┴─────┐
        │ WS Node 1 ││WS Node 2││ WS Node 3 │  ← 多节点，水平扩展
        │ (50K conn)││(50K conn││ (50K conn)│
        └─────┬─────┘└────┬────┘└─────┬─────┘
              │            │            │
              └────────────┼────────────┘
                           │
                    ┌──────┴──────┐
                    │Redis Sentinel│  ← 高可用
                    └─────────────┘
```

### 14.3 V1.5+ 阶段

```
                    ┌──────────────┐
                    │  API Gateway │  ← 统一入口
                    └──────┬───────┘
                           │
              ┌────────────┼────────────────┐
              │            │                │
     ┌────────┴──────┐    │     ┌──────────┴──────┐
     │ WS Cluster    │    │     │  HTTP Services   │
     │ (10+ nodes)   │    │     │  (常规业务)       │
     │ Netty + Spring│    │     └─────────────────┘
     └────────┬──────┘    │
              │           │
     ┌────────┴───────────┴──────────────┐
     │                                    │
     │  Redis Cluster (Pub/Sub + 状态)    │
     │  + RocketMQ (海量广播场景)          │
     └────────────────────────────────────┘
```

---

## 15. 测试策略

### 15.1 单元测试

| 测试点 | 方法 |
|--------|------|
| 消息序列化/反序列化 | JSON ↔ WsMessage 转换正确性 |
| ACK 重试逻辑 | Mock Channel，验证超时重发 |
| 重连退避算法 | 验证指数增长 + 随机抖动 |
| 消息路由 | Mock Redis，验证路由到正确节点 |

### 15.2 集成测试

| 测试点 | 方法 |
|--------|------|
| 连接生命周期 | 建连 → 心跳 → 关闭 全流程 |
| 重连恢复 | 断连 → 重连 → 补发消息 |
| 集群路由 | 两个节点 + Redis，验证跨节点消息可达 |
| 多设备推送 | 一个用户两个连接，验证都收到消息 |
| 限流 | 连接频率/消息频率超限时的行为 |

### 15.3 压力测试

```bash
# 使用 k6 + ws 模块进行压测
# k6 script 示例

import ws from 'k6/ws';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 1000 },   // 30s 内到 1000 连接
    { duration: '2m',  target: 10000 },  // 2min 内到 10000 连接
    { duration: '5m',  target: 50000 },  // 5min 内到 50000 连接
    { duration: '10m', target: 50000 },  // 稳定 10min
    { duration: '30s', target: 0 },      // 释放
  ],
};

export default function () {
  const token = generateTestToken(__VU);
  const url = `wss://api.primetop.com/ws/connect?token=${token}&deviceId=device_${__VU}&platform=test&version=1.0`;

  const res = ws.connect(url, {}, function (socket) {
    socket.on('message', (msg) => {
      const parsed = JSON.parse(msg);
      if (parsed.type === 'connected') {
        // 开始发心跳
        socket.setInterval(() => {
          socket.send(JSON.stringify({
            type: 'heartbeat',
            seq: Date.now(),
            ts: Date.now(),
          }));
        }, 30000);
      }
    });

    socket.setTimeout(function () {
      socket.close();
    }, 600000); // 10min 后关闭
  });

  check(res, { 'status is 101': (r) => r && r.status === 101 });
}
```

### 15.4 关键测试指标

| 指标 | 通过标准 |
|------|---------|
| 连接建立成功率 | ≥ 99.9% |
| 消息送达率（ACK 确认） | ≥ 99.99% |
| 消息延迟 P99 | ≤ 200ms |
| 断线重连成功率 | ≥ 99% |
| 重连恢复时间 | ≤ 3s |
| 50K 连接下 CPU 使用率 | ≤ 60% |
| 50K 连接下内存使用 | ≤ 8GB |
| 消息吞吐（入站+出站） | ≥ 100K msg/s |

---

## 16. 开放问题与后续演进

| 问题 | 状态 | 备选方案 |
|------|------|---------|
| Protobuf schema 版本管理 | 待定 | Schema Registry / 硬编码版本 |
| 语音帧传输走 WebSocket 还是 RTP | 待评估 | WebSocket 简单但延迟高；RTP 延迟低但复杂 |
| 协作学习场景的冲突解决 | 远期 | OT/CRDT 算法 |
| 消息端到端加密 | 远期 | Signal Protocol |
| WebSocket → gRPC-Web 统一 | 远期 | 如果 gRPC-Web 成熟可替代部分 WS |
| Redis Pub/Sub 消息持久化 | V1.5 | 引入 RocketMQ 广播消费 |

---

*本文档为 PrimeTop 项目 WebSocket 长连接管理与实时双向通信引擎的详细设计，开发人员可据此进行编码实现。*
