# API 网关与通用接口规范 - 详细设计

## 1. 概述

### 1.1 文档目的

本文档对 PrimeTop 系统的 API 网关层和通用接口规范进行详细设计，包括网关架构、认证鉴权、请求响应格式、错误码体系、限流策略、接口版本管理等。所有业务模块的开发均应遵循本规范。

### 1.2 设计目标

1. **统一入口**：所有客户端请求通过 API 网关统一接入，屏蔽后端服务细节。
2. **安全可靠**：实现身份认证、权限校验、内容安全、防刷限流。
3. **开发友好**：提供一致的接口风格、错误处理和文档规范。
4. **可观测性**：全链路日志、指标采集、链路追踪。
5. **高可用**：网关无状态部署，支持水平扩展，具备降级熔断能力。

---

## 2. 网关架构设计

### 2.1 总体架构

```
┌─────────────────────────────────────────────────────┐
│                    客户端 (APP / Web / 小程序)         │
└─────────────────────────┬───────────────────────────┘
                          │ HTTPS
┌─────────────────────────▼───────────────────────────┐
│                   CDN / WAF (可选)                     │
└─────────────────────────┬───────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────┐
│              API Gateway (Nginx / Kong / APISIX)      │
│  ┌──────────┬──────────┬──────────┬───────────────┐  │
│  │ SSL终止   │ 路由分发  │ 负载均衡  │ 健康检查       │  │
│  └──────────┴──────────┴──────────┴───────────────┘  │
│  ┌──────────┬──────────┬──────────┬───────────────┐  │
│  │ 认证鉴权  │ 限流熔断  │ 日志采集  │ 请求转换       │  │
│  └──────────┴──────────┴──────────┴───────────────┘  │
└─────────────────────────┬───────────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         │                │                │
    ┌────▼────┐     ┌────▼────┐     ┌────▼────┐
    │ 用户服务 │     │ 学习服务 │     │  AI服务  │  ...
    └─────────┘     └─────────┘     └─────────┘
```

### 2.2 技术选型建议

| 方案 | 优势 | 适用场景 |
|------|------|---------|
| **APISIX** | 高性能、插件丰富、动态路由、云原生 | 推荐，适合快速迭代 |
| **Kong** | 成熟稳定、企业级插件、社区活跃 | 适合有 Kong 经验的团队 |
| **自建 Nginx + Lua** | 极致性能、灵活定制 | 适合有 Nginx 深度运维能力的团队 |
| **Spring Cloud Gateway** | Java 生态一致性好 | 如果后端全部使用 Java/Spring |

**MVP 阶段建议**：使用 Nginx 反向代理 + 轻量网关层（如 APISIX），兼顾性能和开发效率。

### 2.3 网关核心功能

```yaml
# 网关功能清单
functions:
  - 路由管理:
      - 基于 path prefix 的路由分发
      - 基于 header/query 的条件路由
      - 动态路由更新（无需重启）
  
  - 认证鉴权:
      - JWT 令牌校验
      - API Key 校验（管理后台）
      - 设备指纹校验（防多设备共享）
  
  - 限流控制:
      - 全局 QPS 限流
      - 用户级限流
      - 接口级限流
      - 会员差异化限流
  
  - 可观测性:
      - 访问日志（JSON 格式）
      - Prometheus 指标暴露
      - 分布式链路追踪 (Trace ID 注入)
      - 慢请求告警
  
  - 安全防护:
      - SSL/TLS 终止
      - 请求体大小限制
      - SQL 注入 / XSS 过滤（基础）
      - IP 黑名单 / 地域封禁
  
  - 降级熔断:
      - 后端服务健康检查
      - 超时控制
      - 熔断器（连续失败触发）
      - 降级响应（返回友好提示）
```

---

## 3. 接口通用规范

### 3.1 URL 规范

```
基础路径: /api/{version}/{module}/{resource}[/{id}][/{action}]

示例:
  GET    /api/v1/user/profile              # 获取用户信息
  POST   /api/v1/user/profile              # 创建/更新用户信息
  GET    /api/v1/learning/progress         # 查询学习进度
  POST   /api/v1/ai/chat                   # AI 对话
  POST   /api/v1/question/ocr              # 拍题 OCR
  GET    /api/v1/mistake/list              # 错题列表
  POST   /api/v1/order/create              # 创建订单
```

**命名规则**：
- 全部使用小写字母，单词间用连字符 `-` 连接
- 模块名使用名词，操作使用动词（仅对非 CRUD 操作）
- 列表用复数名词，单条资源用 `{id}` 路径参数

### 3.2 HTTP 方法使用

| 方法 | 语义 | 幂等性 | 示例 |
|------|------|--------|------|
| GET | 查询资源 | 是 | `GET /api/v1/mistake/list?subject=math` |
| POST | 创建资源 / 执行操作 | 否 | `POST /api/v1/order/create` |
| PUT | 全量更新资源 | 是 | `PUT /api/v1/user/profile` |
| PATCH | 部分更新资源 | 否 | `PATCH /api/v1/user/settings` |
| DELETE | 删除资源 | 是 | `DELETE /api/v1/mistake/{id}` |

### 3.3 请求头规范

```http
# 必需请求头
Content-Type: application/json; charset=utf-8
Authorization: Bearer {access_token}
X-Request-ID: {uuid}                    # 客户端生成的请求唯一 ID
X-Device-ID: {device_fingerprint}       # 设备指纹
X-App-Version: {app_version}            # APP 版本号，如 1.2.0
X-Platform: {ios|android|web|miniprogram} # 客户端平台

# 可选请求头
X-Timezone: Asia/Shanghai               # 客户端时区
Accept-Language: zh-CN                  # 语言偏好
X-Trace-ID: {trace_id}                  # 链路追踪 ID（网关自动注入）
```

### 3.4 通用请求格式

```json
// POST/PUT/PATCH 请求体
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": 1716076800000,
  "data": {
    // 业务数据
  }
}
```

**GET 请求**参数通过 query string 传递，复杂过滤条件使用 JSON 编码：

```
GET /api/v1/mistake/list?subject=math&grade=7&page=1&pageSize=20&filter=%7B%22errorType%22%3A%22concept%22%7D
```

### 3.5 通用响应格式

#### 3.5.1 成功响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    // 业务数据
  },
  "meta": {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": 1716076800000,
    "traceId": "abc123def456"
  }
}
```

#### 3.5.2 分页响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [
      { "id": 1, "title": "..." },
      { "id": 2, "title": "..." }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 156,
      "totalPages": 8,
      "hasMore": true
    }
  },
  "meta": {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": 1716076800000,
    "traceId": "abc123def456"
  }
}
```

#### 3.5.3 错误响应

```json
{
  "code": 40001,
  "message": "参数校验失败",
  "errors": [
    {
      "field": "grade",
      "message": "年级值无效，有效范围: 1-12",
      "rejectedValue": 15
    }
  ],
  "meta": {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": 1716076800000,
    "traceId": "abc123def456"
  }
}
```

### 3.6 SSE 流式响应（AI 对话专用）

AI 问答接口使用 Server-Sent Events (SSE) 进行流式输出：

**请求**：
```http
POST /api/v1/ai/chat
Accept: text/event-stream
Content-Type: application/json

{
  "data": {
    "conversationId": "conv_001",
    "message": "请解释勾股定理",
    "stream": true
  }
}
```

**响应**：
```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"type":"thinking","content":"正在分析问题...","sessionId":"sess_001"}

data: {"type":"content","content":"勾股定理是","index":0}

data: {"type":"content","content":"直角三角形中","index":1}

data: {"type":"content","content":"两直角边的平方和等于斜边的平方","index":2}

data: {"type":"done","usage":{"promptTokens":120,"completionTokens":85,"totalTokens":205},"knowledgePoints":["勾股定理"]}

data: {"type":"error","code":50001,"message":"模型响应超时，请稍后重试"}
```

**SSE 事件类型定义**：

| type | 说明 | 必需字段 |
|------|------|---------|
| `thinking` | AI 正在思考/检索 | `content` |
| `content` | 流式文本片段 | `content`, `index` |
| `done` | 生成完成 | `usage`, `knowledgePoints` |
| `error` | 生成中断/出错 | `code`, `message` |
| `rate_limit` | 触发限流提醒 | `remaining`, `resetAt` |

---

## 4. 认证鉴权设计

### 4.1 认证流程

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  客户端   │     │   网关    │     │ 用户服务  │
└─────┬────┘     └────┬─────┘     └────┬─────┘
      │               │                │
      │ POST /auth/login               │
      │──────────────►│                │
      │               │ 验证手机号/验证码│
      │               │───────────────►│
      │               │                │
      │               │ 返回 Token 对   │
      │               │◄───────────────│
      │               │                │
      │ {accessToken, refreshToken}    │
      │◄──────────────│                │
      │               │                │
      │ GET /api/v1/xxx (带 accessToken)│
      │──────────────►│                │
      │               │ JWT 校验（本地） │
      │               │ 注入 userId     │
      │               │──────────────►│
      │               │                │
```

### 4.2 Token 设计

#### Access Token

```json
// JWT Payload
{
  "sub": "user_123456",           // 用户 ID
  "type": "student",              // 用户类型: student | parent | admin
  "grade": 7,                     // 年级（学生）
  "membership": "annual",         // 会员等级: free | monthly | annual
  "deviceId": "dev_abc123",       // 绑定设备 ID
  "iat": 1716076800,              // 签发时间
  "exp": 1716163200,              // 过期时间（24h）
  "jti": "token_550e8400"         // Token 唯一 ID（用于吊销）
}
```

- **有效期**：24 小时
- **签名算法**：RS256（非对称，服务端私钥签名，网关公钥验签）
- **存储位置**：客户端 Keychain (iOS) / Keystore (Android)

#### Refresh Token

```json
// JWT Payload
{
  "sub": "user_123456",
  "type": "refresh",
  "family": "family_abc123",      // Token 族 ID（用于检测 Token 盗用）
  "iat": 1716076800,
  "exp": 1718755200               // 过期时间（30d）
}
```

- **有效期**：30 天
- **存储位置**：服务端 Redis（支持主动吊销）
- **轮换策略**：每次刷新时签发新的 Refresh Token，旧的立即失效

### 4.3 Token 刷新接口

```
POST /api/v1/auth/refresh
```

**请求**：
```json
{
  "data": {
    "refreshToken": "eyJhbGciOiJSUzI1NiIs..."
  }
}
```

**成功响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJSUzI1NiIs...(新的)",
    "expiresIn": 86400
  }
}
```

**Token 盗用检测**：如果检测到已失效的 Refresh Token 被使用，说明可能存在 Token 泄露，应吊销该 Token 族下所有 Token，强制用户重新登录。

### 4.4 设备管理

```json
// Redis 设备绑定数据结构
{
  "device:binding:user_123456": {
    "currentDeviceId": "dev_abc123",
    "lastSwitchAt": 1716076800,
    "allowedDevices": 2    // 会员允许设备数
  }
}
```

- **免费用户**：允许 1 台设备
- **月度会员**：允许 2 台设备
- **年度会员**：允许 3 台设备
- 切换设备需重新登录验证

### 4.5 管理后台认证

管理后台使用 API Key + RBAC 权限模型：

```http
Authorization: ApiKey {api_key}
X-Admin-Role: {role_id}
```

**角色权限矩阵**：

| 角色 | 用户管理 | 内容管理 | AI 配置 | 审核管理 | 数据看板 | 系统设置 |
|------|---------|---------|--------|---------|---------|---------|
| super_admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| content_admin | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ |
| ai_admin | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| reviewer | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| viewer | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |

---

## 5. 错误码体系

### 5.1 错误码结构

错误码为 5 位数字，结构如下：

```
  A BB CC
  │  │  │
  │  │  └── 具体错误编号 (00-99)
  │  └───── 子模块编号 (01-99)
  └──────── 错误类别 (1-9)
```

### 5.2 错误类别

| 范围 | 类别 | 说明 |
|------|------|------|
| 1xxxx | 系统级错误 | 网关、基础设施、未知异常 |
| 2xxxx | 认证授权错误 | 登录、Token、权限 |
| 3xxxx | 用户模块错误 | 账号、档案、设备 |
| 4xxxx | 参数与校验错误 | 入参校验、数据格式 |
| 5xxxx | AI 服务错误 | 模型调用、RAG、OCR |
| 6xxxx | 学习模块错误 | 同步课堂、错题、规划 |
| 7xxxx | 内容模块错误 | 教材、题库、知识点 |
| 8xxxx | 支付模块错误 | 订单、会员、权益 |
| 9xxxx | 消息模块错误 | 推送、通知 |

### 5.3 详细错误码表

#### 系统级错误 (1xxxx)

| 错误码 | HTTP 状态 | message | 说明 | 客户端处理 |
|--------|----------|---------|------|-----------|
| 10001 | 500 | 系统内部错误 | 未捕获异常 | 弹出通用错误提示 |
| 10002 | 503 | 服务暂时不可用 | 后端服务宕机/维护 | 显示维护页面 |
| 10003 | 504 | 请求超时 | 后端处理超时 | 提示稍后重试 |
| 10004 | 429 | 请求过于频繁 | 触发限流 | 显示倒计时，延迟重试 |
| 10005 | 502 | 网关错误 | 上游服务异常 | 提示稍后重试 |
| 10006 | 426 | 需要升级客户端 | APP 版本过低 | 强制更新弹窗 |

#### 认证授权错误 (2xxxx)

| 错误码 | HTTP 状态 | message | 说明 | 客户端处理 |
|--------|----------|---------|------|-----------|
| 20001 | 401 | 未登录或 Token 已过期 | accessToken 无效/过期 | 自动调用 refresh |
| 20002 | 401 | Refresh Token 已失效 | refreshToken 过期或被吊销 | 跳转登录页 |
| 20003 | 401 | Token 已被吊销 | Token 主动注销或安全事件 | 跳转登录页 |
| 20004 | 403 | 无权限访问 | 角色权限不足 | 提示无权限 |
| 20005 | 403 | 设备未授权 | 非绑定设备访问 | 设备验证流程 |
| 20006 | 403 | 账号已被冻结 | 违规/安全原因冻结 | 联系客服提示 |
| 20007 | 400 | 验证码错误 | 短信验证码不匹配 | 提示重新输入 |
| 20008 | 400 | 验证码已过期 | 验证码超时（5分钟） | 重新发送 |
| 20009 | 429 | 验证码发送过于频繁 | 60秒内重复发送 | 显示倒计时 |
| 20010 | 400 | 手机号格式无效 | 国际/国内号码校验失败 | 提示格式错误 |

#### AI 服务错误 (5xxxx)

| 错误码 | HTTP 状态 | message | 说明 | 客户端处理 |
|--------|----------|---------|------|-----------|
| 50001 | 504 | AI 响应超时 | 模型调用超时 (>30s) | 提示稍后重试 |
| 50002 | 503 | AI 服务暂时不可用 | 模型供应商故障 | 切换备用模型或提示 |
| 50003 | 400 | 输入内容不合规 | 触发安全审核 | 提示内容不合规 |
| 50004 | 400 | 对话上下文过长 | Token 数超限 | 提示开始新对话 |
| 50005 | 429 | AI 调用次数已达上限 | 超出会员每日额度 | 提示升级会员 |
| 50006 | 429 | AI 并发请求过多 | 同时进行的 AI 请求超限 | 排队等待提示 |
| 50007 | 500 | OCR 识别失败 | 图片识别异常 | 提示重新拍照 |
| 50008 | 400 | 图片格式不支持 | 非法图片格式/过大 | 提示图片要求 |
| 50009 | 500 | ASR 识别失败 | 语音转文字异常 | 提示重新录音 |
| 50010 | 500 | AI 输出审核拦截 | 回复被安全系统拦截 | 换一种方式提问 |

#### 支付模块错误 (8xxxx)

| 错误码 | HTTP 状态 | message | 说明 | 客户端处理 |
|--------|----------|---------|------|-----------|
| 80001 | 400 | 订单已存在 | 重复创建订单 | 查询已有订单 |
| 80002 | 400 | 订单已过期 | 支付超时 | 重新创建订单 |
| 80003 | 400 | 订单已支付 | 重复支付 | 查询订单状态 |
| 80004 | 400 | 支付渠道异常 | 第三方支付失败 | 更换支付方式 |
| 80005 | 400 | 会员权益冲突 | 已有更高级别会员 | 提示当前权益 |
| 80006 | 403 | 未成年人支付限制 | 未成年人大额消费限制 | 家长授权流程 |
| 80007 | 400 | 退款申请失败 | 不符合退款条件 | 联系客服 |

### 5.4 客户端错误处理策略

```typescript
// 客户端通用错误处理伪代码
async function handleResponse(response: ApiResponse): Promise<void> {
  if (response.code === 0) return response.data;

  switch (true) {
    // Token 过期 → 自动刷新
    case response.code === 20001:
      const refreshed = await refreshToken();
      if (refreshed) return retryOriginalRequest();
      break;

    // Token 彻底失效 → 跳转登录
    case [20002, 20003].includes(response.code):
      navigateToLogin();
      break;

    // 版本过低 → 强制更新
    case response.code === 10006:
      showForceUpdateDialog();
      break;

    // AI 限流 → 提示升级
    case response.code === 50005:
      showUpgradePrompt();
      break;

    // 参数校验 → 显示字段错误
    case response.code >= 40000 && response.code < 50000:
      showFieldErrors(response.errors);
      break;

    // 限流 → 显示倒计时
    case response.code === 10004:
      showRateLimitCountdown(response.meta?.retryAfter);
      break;

    // 其他 → 通用错误提示
    default:
      showToast(response.message || '操作失败，请稍后重试');
  }
}
```

---

## 6. 限流策略设计

### 6.1 限流层级

```
┌──────────────────────────────────────────────┐
│  L1: 全局限流 - 保护网关和后端整体容量          │
│  ┌──────────────────────────────────────────┐ │
│  │  L2: 接口限流 - 保护高成本接口 (AI/OCR)    │ │
│  │  ┌──────────────────────────────────────┐│ │
│  │  │  L3: 用户限流 - 会员差异化配额         ││ │
│  │  └──────────────────────────────────────┘│ │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

### 6.2 限流规则配置

```json
// Redis 限流配置
{
  "rate_limit": {
    "global": {
      "totalQPS": 10000,
      "description": "网关全局 QPS 上限"
    },
    "per_ip": {
      "qps": 50,
      "burst": 100,
      "description": "单 IP 限流"
    },
    "per_user": {
      "qps": 20,
      "burst": 40,
      "description": "单用户通用接口限流"
    },
    "endpoints": {
      "/api/v1/ai/chat": {
        "free":    { "daily": 10,  "hourly": 3 },
        "monthly": { "daily": 100, "hourly": 20 },
        "annual":  { "daily": -1,  "hourly": 50 }
      },
      "/api/v1/question/ocr": {
        "free":    { "daily": 5,   "hourly": 2 },
        "monthly": { "daily": 50,  "hourly": 10 },
        "annual":  { "daily": 200, "hourly": 30 }
      },
      "/api/v1/essay/grade": {
        "free":    { "daily": 1,   "hourly": 1 },
        "monthly": { "daily": 10,  "hourly": 3 },
        "annual":  { "daily": 30,  "hourly": 10 }
      },
      "/api/v1/auth/login": {
        "all":     { "daily": 20,  "hourly": 10, "perIp": { "hourly": 50 } }
      },
      "/api/v1/auth/sms-code": {
        "all":     { "daily": 10,  "hourly": 5, "perIp": { "hourly": 20 } }
      }
    }
  }
}
```

> `daily: -1` 表示不限制。

### 6.3 限流响应头

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 100          # 当前窗口总额度
X-RateLimit-Remaining: 87       # 剩余额度
X-RateLimit-Reset: 1716080400   # 窗口重置时间（Unix 时间戳）
X-RateLimit-Daily: 100          # 每日总额度
X-RateLimit-Daily-Remaining: 45 # 每日剩余

# 触发限流时
HTTP/1.1 429 Too Many Requests
Retry-After: 3600               # 建议重试等待秒数
X-RateLimit-Remaining: 0
```

### 6.4 限流实现方案

使用 Redis + 滑动窗口算法：

```python
# 限流检查伪代码（Python）

import time
import redis

def check_rate_limit(user_id: str, endpoint: str, membership: str) -> dict:
    """
    滑动窗口限流检查
    
    Returns:
        {"allowed": bool, "remaining": int, "resetAt": int}
    """
    r = redis.Redis()
    now = time.time()
    
    # 获取该用户+接口+会员等级对应的限流配置
    config = get_limit_config(endpoint, membership)
    daily_limit = config["daily"]
    
    if daily_limit == -1:
        return {"allowed": True, "remaining": -1, "resetAt": 0}
    
    # 每日窗口 key（按日期切割）
    today = time.strftime("%Y-%m-%d", time.localtime(now))
    daily_key = f"rl:{user_id}:{endpoint}:daily:{today}"
    
    # 滑动窗口：score 为请求时间戳
    pipe = r.pipeline()
    window_start = now - 86400  # 24h 窗口
    
    # 移除窗口外记录
    pipe.zremrangebyscore(daily_key, 0, window_start)
    # 获取当前窗口计数
    pipe.zcard(daily_key)
    # 添加当前请求（score=时间戳）
    pipe.zadd(daily_key, {f"{now:.3f}": now})
    # 设置 key 过期（48h 保底清理）
    pipe.expire(daily_key, 172800)
    
    results = pipe.execute()
    current_count = results[1]
    remaining = max(0, daily_limit - current_count - 1)
    
    # 计算窗口重置时间（最早的请求过期时间）
    reset_at = int(now + 86400)
    
    if current_count >= daily_limit:
        return {
            "allowed": False,
            "remaining": 0,
            "resetAt": reset_at
        }
    
    return {
        "allowed": True,
        "remaining": remaining,
        "resetAt": reset_at
    }
```

---

## 7. 接口版本管理

### 7.1 版本策略

- **URL 路径版本**：`/api/v1/`, `/api/v2/`
- **兼容性承诺**：同一大版本内保证向后兼容
- **版本生命周期**：
  - **Current**：当前使用版本，完整维护
  - **Deprecated**：标记废弃，仍可使用 6 个月，响应头加 `Sunset` 和 `Deprecation`
  - **Retired**：已下线，返回 `410 Gone`

```http
# 废弃版本响应头示例
HTTP/1.1 200 OK
Deprecation: true
Sunset: Sat, 01 Nov 2025 00:00:00 GMT
Link: </api/v2/user/profile>; rel="successor-version"
```

### 7.2 版本升级原则

| 变更类型 | 示例 | 是否需要新版本 |
|---------|------|-------------|
| 新增字段 | 响应增加 `nickname` 字段 | 否（旧客户端忽略） |
| 新增接口 | 新增 `/api/v1/essay/grade` | 否 |
| 新增枚举值 | `subject` 增加 `politics` | 否（旧客户端容错） |
| 删除字段 | 移除 `avatar` 字段 | 是 |
| 修改字段类型 | `grade` 从 int 改 string | 是 |
| 修改字段语义 | `score` 含义变更 | 是 |
| 删除接口 | 移除某个 endpoint | 是 |
| 修改 URL 路径 | 接口路径变更 | 是 |

---

## 8. 日志与可观测性

### 8.1 访问日志格式

网关输出的 JSON 格式访问日志：

```json
{
  "timestamp": "2024-05-19T12:00:00.000Z",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "traceId": "abc123def456",
  "clientId": "app_ios_1.2.0",
  "userId": "user_123456",
  "deviceId": "dev_abc123",
  "method": "POST",
  "path": "/api/v1/ai/chat",
  "query": {},
  "statusCode": 200,
  "responseTime": 2340,
  "requestSize": 512,
  "responseSize": 2048,
  "userAgent": "PrimeTop/1.2.0 (iOS 17.4; iPhone 15)",
  "clientIp": "116.25.xxx.xxx",
  "upstream": "ai-service:8080",
  "membership": "annual",
  "rateLimitRemaining": 45,
  "error": null
}
```

### 8.2 链路追踪

使用 OpenTelemetry 标准：

- 网关注入 `traceparent` header
- 后端服务传播 trace context
- 所有日志关联 `traceId` 和 `requestId`

```
traceparent: 00-abcdef1234567890-1234567890123456-01
```

### 8.3 关键监控指标

```yaml
# Prometheus 指标命名规范
gateway_http_requests_total:
  type: counter
  labels: [method, path, status, membership]
  description: 网关请求总数

gateway_http_request_duration_seconds:
  type: histogram
  labels: [method, path, upstream]
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30]
  description: 请求耗时分布

gateway_rate_limit_rejected_total:
  type: counter
  labels: [path, membership, limit_type]
  description: 限流拒绝数

gateway_upstream_errors_total:
  type: counter
  labels: [upstream, error_type]
  description: 上游服务错误数

gateway_active_connections:
  type: gauge
  description: 当前活跃连接数

# AI 专项指标
ai_model_call_duration_seconds:
  type: histogram
  labels: [model, provider, task_type]
  description: AI 模型调用耗时

ai_model_tokens_total:
  type: counter
  labels: [model, provider, token_type]
  description: Token 消耗总量

ai_model_cost_total:
  type: counter
  labels: [model, provider]
  description: AI 调用成本（元）
```

---

## 9. 安全策略

### 9.1 请求安全

```json
// 请求体大小限制
{
  "maxBodySize": {
    "default": "1MB",
    "/api/v1/ai/chat": "10KB",
    "/api/v1/question/ocr": "10MB",
    "/api/v1/essay/grade": "5MB"
  }
}

// 请求频率异常检测
{
  "anomaly_detection": {
    "sameEndpointPerMinute": 60,
    "loginAttemptsPerHour": 20,
    "newDeviceLoginsPerDay": 5
  }
}
```

### 9.2 响应安全头

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Content-Security-Policy: default-src 'none'
Referrer-Policy: strict-origin-when-cross-origin
```

### 9.3 敏感数据脱敏

```json
// 日志脱敏规则
{
  "masking": {
    "phone": { "pattern": "(\\d{3})\\d{4}(\\d{4})", "replacement": "$1****$2" },
    "email": { "pattern": "(.{2}).*(@.*)", "replacement": "$1***$2" },
    "idCard": { "pattern": "(\\d{4})\\d{10}(\\d{4})", "replacement": "$1**********$2" },
    "token": { "action": "truncate", "length": 8 }
  }
}
```

---

## 10. 降级与熔断

### 10.1 降级策略

```yaml
circuit_breaker:
  ai_service:
    # 连续失败 5 次触发熔断
    failureThreshold: 5
    # 熔断后等待 30s 尝试恢复
    recoveryTimeout: 30s
    # 半开状态允许 2 个探测请求
    halfOpenRequests: 2
    fallback:
      type: "static_response"
      response:
        code: 50002
        message: "AI 服务暂时不可用，请稍后重试"
  
  ocr_service:
    failureThreshold: 5
    recoveryTimeout: 20s
    fallback:
      type: "static_response"
      response:
        code: 50007
        message: "识别服务暂时不可用，请稍后重试"
  
  payment_service:
    failureThreshold: 3
    recoveryTimeout: 60s
    fallback:
      type: "static_response"
      response:
        code: 80004
        message: "支付服务暂时不可用，请稍后重试"
```

### 10.2 超时配置

```yaml
timeouts:
  default: 10s
  endpoints:
    "/api/v1/ai/chat": 60s          # AI 流式响应
    "/api/v1/question/ocr": 15s      # OCR 识别
    "/api/v1/auth/login": 5s         # 登录
    "/api/v1/auth/sms-code": 3s      # 验证码发送
    "/api/v1/essay/grade": 30s       # 作文批改
    "/api/v1/mistake/list": 5s       # 错题列表查询
    "/api/v1/order/create": 10s      # 创建订单
    "/api/v1/sync/chapters": 5s      # 章节目录
```

---

## 11. 跨域与多端适配

### 11.1 CORS 配置（Web 端）

```json
{
  "cors": {
    "allowedOrigins": [
      "https://app.primetop.com",
      "https://admin.primetop.com"
    ],
    "allowedMethods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    "allowedHeaders": [
      "Authorization",
      "Content-Type",
      "X-Request-ID",
      "X-Device-ID",
      "X-App-Version",
      "X-Platform"
    ],
    "exposedHeaders": [
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset"
    ],
    "maxAge": 86400,
    "allowCredentials": true
  }
}
```

### 11.2 多端请求适配

网关根据 `X-Platform` 头进行差异化处理：

| 平台 | 差异处理 |
|------|---------|
| ios | 推送走 APNs，支付走 Apple IAP |
| android | 推送走 FCM + HMS，支付走各安卓商店 |
| web | CORS 校验，无推送降级为 WebSocket |
| miniprogram | 登录走微信 code2session，限制功能子集 |

---

## 12. 接口文档生成

### 12.1 OpenAPI 规范

所有接口应维护 OpenAPI 3.0 文档：

```yaml
# openapi.yaml 示例片段
openapi: "3.0.3"
info:
  title: PrimeTop API
  version: "1.0.0"
  description: 启硕 PrimeTop 全学段 AI 辅助学习软件 API

servers:
  - url: https://api.primetop.com/api/v1
    description: 生产环境
  - url: https://api-staging.primetop.com/api/v1
    description: 预发布环境

security:
  - BearerAuth: []

paths:
  /auth/login:
    post:
      summary: 用户登录
      tags: [Auth]
      security: []   # 登录不需要 Token
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [phone, code]
              properties:
                phone:
                  type: string
                  pattern: "^1[3-9]\\d{9}$"
                  example: "13800138000"
                code:
                  type: string
                  pattern: "^\\d{6}$"
                  example: "123456"
                deviceId:
                  type: string
                  example: "dev_abc123"
      responses:
        "200":
          description: 登录成功
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/LoginResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "429":
          $ref: "#/components/responses/RateLimited"

components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  schemas:
    LoginResponse:
      type: object
      properties:
        code:
          type: integer
          example: 0
        message:
          type: string
          example: "success"
        data:
          type: object
          properties:
            accessToken:
              type: string
            refreshToken:
              type: string
            expiresIn:
              type: integer
              example: 86400
            user:
              $ref: "#/components/schemas/UserBrief"

    UserBrief:
      type: object
      properties:
        userId:
          type: string
          example: "user_123456"
        nickname:
          type: string
          example: "小明"
        avatar:
          type: string
          format: uri
        type:
          type: string
          enum: [student, parent]
        grade:
          type: integer
          example: 7

    Error:
      type: object
      required: [code, message]
      properties:
        code:
          type: integer
        message:
          type: string
        errors:
          type: array
          items:
            type: object
            properties:
              field:
                type: string
              message:
                type: string
              rejectedValue:
                type: string

  responses:
    BadRequest:
      description: 参数校验失败
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
          example:
            code: 40001
            message: "参数校验失败"

    Unauthorized:
      description: 未授权
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
          example:
            code: 20001
            message: "未登录或 Token 已过期"

    RateLimited:
      description: 请求过于频繁
      headers:
        Retry-After:
          schema:
            type: integer
          description: 建议重试等待秒数
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
          example:
            code: 10004
            message: "请求过于频繁"
```

### 12.2 文档管理

- 使用 Swagger UI 或 Redoc 托管在线文档
- 每个接口标注：所属模块、负责人、上线版本、废弃状态
- 文档变更纳入 Git 版本管理
- CI 自动校验 OpenAPI 规范合法性

---

## 13. 完整接口清单总览

以下是 PrimeTop 各模块的核心接口汇总，供开发人员快速定位。

### 13.1 认证模块

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/auth/sms-code` | 发送短信验证码 |
| POST | `/api/v1/auth/login` | 手机号+验证码登录 |
| POST | `/api/v1/auth/refresh` | 刷新 Token |
| POST | `/api/v1/auth/logout` | 退出登录 |
| POST | `/api/v1/auth/device/verify` | 设备验证 |

### 13.2 用户模块

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/user/profile` | 获取用户信息 |
| PUT | `/api/v1/user/profile` | 更新用户信息 |
| PATCH | `/api/v1/user/settings` | 更新用户设置 |
| GET | `/api/v1/user/subjects` | 获取学科列表 |
| PUT | `/api/v1/user/textbook` | 设置教材版本 |

### 13.3 AI 辅导模块

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/ai/chat` | AI 对话（SSE 流式） |
| GET | `/api/v1/ai/conversations` | 对话列表 |
| GET | `/api/v1/ai/conversations/{id}` | 对话详情 |
| DELETE | `/api/v1/ai/conversations/{id}` | 删除对话 |
| GET | `/api/v1/ai/quota` | 查询 AI 调用配额 |

### 13.4 拍题模块

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/question/ocr` | 拍题 OCR 识别 |
| GET | `/api/v1/question/{id}` | 获取题目解析 |
| POST | `/api/v1/question/{id}/similar` | 获取同类题 |

### 13.5 同步课堂模块

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/sync/textbooks` | 教材版本列表 |
| GET | `/api/v1/sync/chapters` | 章节目录 |
| GET | `/api/v1/sync/chapters/{id}/content` | 章节学习内容 |
| GET | `/api/v1/sync/progress` | 学习进度 |
| PUT | `/api/v1/sync/progress/{chapterId}` | 更新学习进度 |

### 13.6 错题模块

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/mistake/add` | 添加错题 |
| GET | `/api/v1/mistake/list` | 错题列表 |
| GET | `/api/v1/mistake/{id}` | 错题详情 |
| PUT | `/api/v1/mistake/{id}/tag` | 标记错因 |
| POST | `/api/v1/mistake/{id}/review` | 订正提交 |
| GET | `/api/v1/mistake/report` | 错题报告 |

### 13.7 学情模块

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/analytics/overview` | 学情概览 |
| GET | `/api/v1/analytics/subjects` | 学科掌握度 |
| GET | `/api/v1/analytics/weakness` | 薄弱知识点 |
| GET | `/api/v1/analytics/report` | 学情报告 |
| GET | `/api/v1/analytics/trend` | 学习趋势 |

### 13.8 学习规划模块

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/plan/create` | 创建学习计划 |
| GET | `/api/v1/plan/current` | 当前计划 |
| GET | `/api/v1/plan/tasks/today` | 今日任务 |
| PUT | `/api/v1/plan/tasks/{id}/complete` | 完成任务 |
| POST | `/api/v1/plan/adjust` | 智能调整计划 |

### 13.9 支付模块

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/membership/plans` | 会员方案列表 |
| POST | `/api/v1/order/create` | 创建订单 |
| GET | `/api/v1/order/{id}` | 订单详情 |
| POST | `/api/v1/order/{id}/callback` | 支付回调 |
| GET | `/api/v1/membership/status` | 会员状态 |

### 13.10 家长中心模块

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/parent/bind` | 绑定孩子 |
| GET | `/api/v1/parent/children` | 孩子列表 |
| GET | `/api/v1/parent/child/{id}/report` | 孩子学情报告 |
| PUT | `/api/v1/parent/child/{id}/controls` | 设置使用管控 |

---

## 14. 附录

### 14.1 HTTP 状态码使用规范

| 状态码 | 使用场景 |
|--------|---------|
| 200 | 请求成功 |
| 201 | 资源创建成功 |
| 204 | 删除成功（无响应体） |
| 400 | 参数校验失败 |
| 401 | 未认证（Token 无效/过期） |
| 403 | 无权限 |
| 404 | 资源不存在 |
| 409 | 资源冲突（如重复创建） |
| 410 | 接口已下线 |
| 429 | 请求限流 |
| 500 | 服务端内部错误 |
| 502 | 网关错误 |
| 503 | 服务不可用 |
| 504 | 网关超时 |

### 14.2 通用字段命名约定

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 资源唯一标识（使用 snowflake 或 UUID） |
| `createdAt` | long | 创建时间（毫秒时间戳） |
| `updatedAt` | long | 更新时间（毫秒时间戳） |
| `createdBy` | string | 创建人 ID |
| `deleted` | boolean | 软删除标记 |
| `version` | integer | 乐观锁版本号 |
| `page` | integer | 页码（从 1 开始） |
| `pageSize` | integer | 每页大小（默认 20，最大 100） |
| `sortBy` | string | 排序字段 |
| `sortOrder` | string | 排序方向：`asc` / `desc` |

> **注意**：所有时间字段统一使用 **毫秒 Unix 时间戳**（long），前端根据时区自行格式化展示。
