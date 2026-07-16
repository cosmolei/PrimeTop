# API 网关服务详细设计

## 1. 概述

### 1.1 模块定位

API 网关是 PrimeTop 系统的统一入口，位于客户端与业务服务层之间，负责请求路由、协议转换、安全防护、流量控制等核心功能。网关采用轻量级高性能网关框架，为移动端、Web端、小程序等所有客户端提供统一的接口访问入口。

### 1.2 核心职责

1. **统一接入**：作为所有外部请求的单一入口，隐藏后端服务复杂度
2. **认证鉴权**：统一处理用户认证、权限校验、令牌管理
3. **请求路由**：根据业务规则将请求路由到正确的后端服务
4. **流量控制**：实现限流、熔断、降级等流量治理能力
5. **协议转换**：支持 HTTP/HTTPS、WebSocket 等多种协议
6. **安全防护**：防重放攻击、参数校验、敏感信息过滤
7. **监控日志**：统一记录请求日志、性能指标、错误追踪
8. **版本管理**：支持 API 版本控制和兼容性管理

### 1.3 依赖关系

```
客户端 -> API网关 -> 业务服务层
                 ↓
           认证服务
           配置中心
           监控系统
           日志系统
           Redis缓存
```

## 2. 数据模型

### 2.1 核心实体定义

```typescript
// API 配置实体
interface APIRouteConfig {
  id: string;
  path: string;                    // 路由路径
  method: string;                  // HTTP方法
  service: string;                 // 目标服务名称
  targetPath: string;              // 目标路径
  authRequired: boolean;           // 是否需要认证
  permission: string[];            // 需要的权限列表
  rateLimit: RateLimitConfig;      // 限流配置
  timeout: number;                 // 超时时间(ms)
  retry: RetryConfig;              // 重试配置
  cache: CacheConfig;              // 缓存配置
  version: string;                 // API版本
  deprecated: boolean;             // 是否已废弃
  enabled: boolean;                // 是否启用
  createdAt: Date;
  updatedAt: Date;
}

// 限流配置
interface RateLimitConfig {
  enabled: boolean;
  algorithm: 'token-bucket' | 'sliding-window' | 'fixed-window';
  rate: number;                    // 每秒请求数
  burst: number;                   // 突发流量
  keyGenerator: string;            // 限流key生成器
  message: string;                 // 限流提示消息
}

// 重试配置
interface RetryConfig {
  enabled: boolean;
  maxAttempts: number;             // 最大重试次数
  backoffMs: number;               // 重试间隔
  retryableErrors: number[];       // 可重试的错误码
}

// 缓存配置
interface CacheConfig {
  enabled: boolean;
  ttl: number;                     // 缓存时间(秒)
  keyGenerator: string;            // 缓存key生成器
  cacheEmpty: boolean;             // 是否缓存空结果
}

// 令牌桶限流算法
interface TokenBucket {
  capacity: number;                // 桶容量
  tokens: number;                  // 当前令牌数
  refillRate: number;              // 令牌补充率
  lastRefill: number;              // 上次补充时间
}

// 熔断器配置
interface CircuitBreakerConfig {
  enabled: boolean;
  failureThreshold: number;        // 失败阈值
  successThreshold: number;        // 成功阈值
  timeout: number;                 // 熔断超时时间
  halfOpenMaxCalls: number;        // 半开状态最大调用数
}

// 请求日志
interface RequestLog {
  id: string;
  requestId: string;
  userId: string;
  ip: string;
  userAgent: string;
  method: string;
  path: string;
  statusCode: number;
  latency: number;                 // 响应时间(ms)
  service: string;                 // 目标服务
  error: string;
  timestamp: Date;
}

// API 密钥配置
interface APIKey {
  id: string;
  key: string;
  secret: string;
  name: string;
  permissions: string[];
  rateLimit: number;
  expiresAt: Date;
  createdAt: Date;
  status: 'active' | 'revoked' | 'expired';
}
```

### 2.2 数据库表结构

```sql
-- API 路由配置表
CREATE TABLE api_route_configs (
    id VARCHAR(64) PRIMARY KEY,
    path VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    service VARCHAR(64) NOT NULL,
    target_path VARCHAR(255) NOT NULL,
    auth_required BOOLEAN DEFAULT TRUE,
    permissions JSON,
    rate_limit JSON,
    timeout INT DEFAULT 30000,
    retry JSON,
    cache JSON,
    version VARCHAR(20) DEFAULT 'v1',
    deprecated BOOLEAN DEFAULT FALSE,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_path_method (path, method),
    INDEX idx_service (service)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- API 密钥表
CREATE TABLE api_keys (
    id VARCHAR(64) PRIMARY KEY,
    key_hash VARCHAR(255) NOT NULL UNIQUE,
    secret_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    permissions JSON,
    rate_limit INT DEFAULT 1000,
    expires_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('active', 'revoked', 'expired') DEFAULT 'active',
    INDEX idx_key_hash (key_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 请求日志表 (按时间分表)
CREATE TABLE request_logs (
    id VARCHAR(64) PRIMARY KEY,
    request_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64),
    ip VARCHAR(64) NOT NULL,
    user_agent VARCHAR(500),
    method VARCHAR(10) NOT NULL,
    path VARCHAR(500) NOT NULL,
    status_code INT NOT NULL,
    latency INT NOT NULL,
    service VARCHAR(64),
    error TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_timestamp (timestamp),
    INDEX idx_user_id (user_id),
    INDEX idx_request_id (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 2.3 缓存策略

```typescript
// Redis 缓存策略配置
interface CacheStrategy {
  // 用户会话缓存
  userSession: {
    key: (userId: string) => `session:${userId}`;
    ttl: 3600; // 1小时
  };

  // 限流计数器
  rateLimit: {
    key: (identifier: string) => `ratelimit:${identifier}`;
    ttl: 60; // 1分钟
  };

  // API 响应缓存
  apiResponse: {
    key: (method: string, path: string, params: string) =>
      `api:${method}:${path}:${hash(params)}`;
    ttl: 300; // 5分钟
  };

  // 熔断器状态
  circuitBreaker: {
    key: (service: string) => `circuit:${service}`;
    ttl: 300; // 5分钟
  };

  // 路由配置缓存
  routeConfig: {
    key: (path: string, method: string) => `route:${method}:${path}`;
    ttl: 600; // 10分钟
  };
}
```

## 3. API 接口设计

### 3.1 网关内部接口

#### 3.1.1 路由配置管理

```typescript
// 查询路由配置
GET /admin/api/routes
Response: {
  code: number;
  data: APIRouteConfig[];
  total: number;
}

// 创建路由配置
POST /admin/api/routes
Request: {
  path: string;
  method: string;
  service: string;
  targetPath: string;
  authRequired: boolean;
  rateLimit: RateLimitConfig;
  // ...其他配置
}

// 更新路由配置
PUT /admin/api/routes/:id
Request: Partial<APIRouteConfig>

// 删除路由配置
DELETE /admin/api/routes/:id
```

#### 3.1.2 限流配置管理

```typescript
// 查询限流状态
GET /admin/api/rate-limit/status/:identifier
Response: {
  code: number;
  data: {
    identifier: string;
    current: number;
    limit: number;
    resetAt: number;
  };
}

// 重置限流
DELETE /admin/api/rate-limit/:identifier
```

#### 3.1.3 熔断器管理

```typescript
// 查询熔断器状态
GET /admin/api/circuit-breakers/:service
Response: {
  code: number;
  data: {
    service: string;
    state: 'closed' | 'open' | 'half-open';
    failureCount: number;
    lastFailureTime: number;
  };
}

// 手动重置熔断器
POST /admin/api/circuit-breakers/:service/reset
```

### 3.2 代理转发接口

网关对所有外部请求进行透明代理转发：

```typescript
// 通用代理转发
* /api/v1/*
Request: {
  headers: {
    Authorization: string;      // JWT令牌
    X-Request-ID: string;       // 请求ID
    X-Client-Version: string;   // 客户端版本
    X-Device-ID: string;        // 设备ID
  };
}

Response: {
  code: number;
  message: string;
  data: any;
  traceId: string;              // 链路追踪ID
}
```

### 3.3 错误码定义

```typescript
enum GatewayErrorCode {
  // 通用错误 (4xxx)
  BAD_REQUEST = 4000,           // 请求参数错误
  UNAUTHORIZED = 4001,          // 未认证
  FORBIDDEN = 4003,             // 无权限
  NOT_FOUND = 4004,             // 路由不存在
  METHOD_NOT_ALLOWED = 4005,    // 方法不允许
  RATE_LIMIT_EXCEEDED = 4009,   // 超过限流
  SERVICE_UNAVAILABLE = 4008,   // 服务不可用

  // 网关错误 (5xxx)
  GATEWAY_TIMEOUT = 5004,       // 网关超时
  UPSTREAM_ERROR = 5002,        // 上游服务错误
  CIRCUIT_BREAKER_OPEN = 5003,  // 熔断器打开
  INTERNAL_ERROR = 5000,        // 内部错误
}

interface ErrorResponse {
  code: number;
  message: string;
  details?: any;
  traceId: string;
  timestamp: number;
}
```

## 4. 业务逻辑

### 4.1 核心流程

#### 4.1.1 请求处理主流程

```typescript
async function handleRequest(ctx: Context): Promise<void> {
  const startTime = Date.now();

  try {
    // 1. 生成请求ID
    const requestId = generateRequestId();
    ctx.set('X-Request-ID', requestId);

    // 2. 路由匹配
    const route = await matchRoute(ctx.method, ctx.path);
    if (!route) {
      throw new NotFoundError('Route not found');
    }

    // 3. 认证鉴权
    if (route.authRequired) {
      await authenticate(ctx, route);
    }

    // 4. 限流检查
    await checkRateLimit(ctx, route);

    // 5. 熔断检查
    await checkCircuitBreaker(route.service);

    // 6. 缓存检查
    const cached = await checkCache(ctx, route);
    if (cached) {
      ctx.body = cached;
      return;
    }

    // 7. 请求转发
    const response = await proxyRequest(ctx, route);

    // 8. 缓存响应
    await cacheResponse(ctx, route, response);

    // 9. 返回响应
    ctx.body = response;

  } catch (error) {
    // 错误处理
    await handleError(ctx, error);
  } finally {
    // 记录日志
    const latency = Date.now() - startTime;
    await logRequest(ctx, latency);
  }
}
```

#### 4.1.2 认证鉴权流程

```typescript
async function authenticate(ctx: Context, route: APIRouteConfig): Promise<void> {
  const token = ctx.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    throw new UnauthorizedError('Missing authorization token');
  }

  // 验证JWT令牌
  try {
    const payload = await verifyJWT(token);

    // 检查令牌有效期
    if (payload.exp < Date.now()) {
      throw new UnauthorizedError('Token expired');
    }

    // 设置用户上下文
    ctx.user = {
      id: payload.userId,
      role: payload.role,
      permissions: payload.permissions
    };

    // 检查路由权限
    if (route.permissions && route.permissions.length > 0) {
      const hasPermission = route.permissions.some(perm =>
        payload.permissions.includes(perm)
      );

      if (!hasPermission) {
        throw new ForbiddenError('Insufficient permissions');
      }
    }

  } catch (error) {
    throw new UnauthorizedError('Invalid token');
  }
}
```

#### 4.1.3 限流检查流程

```typescript
async function checkRateLimit(ctx: Context, route: APIRouteConfig): Promise<void> {
  if (!route.rateLimit.enabled) {
    return;
  }

  // 生成限流标识符
  const identifier = generateRateLimitKey(ctx, route.rateLimit.keyGenerator);

  // 根据算法执行限流检查
  switch (route.rateLimit.algorithm) {
    case 'token-bucket':
      await checkTokenBucketLimit(identifier, route.rateLimit);
      break;
    case 'sliding-window':
      await checkSlidingWindowLimit(identifier, route.rateLimit);
      break;
    case 'fixed-window':
      await checkFixedWindowLimit(identifier, route.rateLimit);
      break;
  }
}

// 令牌桶算法实现
async function checkTokenBucketLimit(
  identifier: string,
  config: RateLimitConfig
): Promise<void> {
  const key = `ratelimit:token:${identifier}`;

  const bucket = await redis.hgetall(key);

  let tokens = bucket.tokens
    ? parseInt(bucket.tokens)
    : config.burst;
  let lastRefill = bucket.lastRefill
    ? parseInt(bucket.lastRefill)
    : Date.now();

  // 补充令牌
  const now = Date.now();
  const elapsed = (now - lastRefill) / 1000; // 秒
  const refillAmount = elapsed * config.rate;

  tokens = Math.min(config.burst, tokens + refillAmount);

  // 检查令牌是否足够
  if (tokens < 1) {
    throw new RateLimitError('Rate limit exceeded', {
      retryAfter: Math.ceil((1 - tokens) / config.rate)
    });
  }

  // 消耗令牌
  tokens -= 1;

  // 更新令牌桶状态
  await redis.hset(key, {
    tokens: tokens.toString(),
    lastRefill: now.toString()
  });

  await redis.expire(key, 3600);
}
```

#### 4.1.4 熔断器状态管理

```typescript
enum CircuitBreakerState {
  CLOSED = 'closed',       // 正常状态
  OPEN = 'open',           // 熔断打开
  HALF_OPEN = 'half-open'  // 半开状态
}

class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private nextAttemptTime: number = 0;

  constructor(private config: CircuitBreakerConfig, private service: string) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // 检查是否应该尝试请求
    if (this.state === CircuitBreakerState.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        throw new ServiceUnavailableError('Circuit breaker is open');
      }
      this.state = CircuitBreakerState.HALF_OPEN;
      this.successCount = 0;
    }

    try {
      const result = await fn();

      // 成功时的处理
      this.onSuccess();
      return result;

    } catch (error) {
      // 失败时的处理
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.successCount++;

      if (this.successCount >= this.config.halfOpenMaxCalls) {
        this.state = CircuitBreakerState.CLOSED;
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitBreakerState.OPEN;
      this.nextAttemptTime = Date.now() + this.config.timeout * 1000;
    }
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  async reset(): Promise<void> {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    this.nextAttemptTime = 0;

    await redis.del(`circuit:${this.service}`);
  }
}
```

### 4.2 状态机

#### 4.2.1 熔断器状态机

```
          failureCount >= failureThreshold
      ┌──────────────────────────────────────┐
      │                                      ▼
┌───────────────┐                   ┌──────────────┐
│    CLOSED     │───────────────────│     OPEN     │
│               │                   │              │
└───────────────┘                   └──────────────┘
      ▲                                      │
      │                                      │ timeout
      │                                      │
      │                              ┌───────────────┐
      │                              │               │
      └──────────────────────────────│   HALF_OPEN    │
         successCount >=               │               │
         halfOpenMaxCalls             └───────────────┘
```

#### 4.2.2 请求处理状态机

```
┌─────────────┐
│   Start     │
└──────┬──────┘
       │
       ├─► Route Match
       │    ├─► Found → Continue
       │    └─► Not Found → 404 Error
       │
       ├─► Authentication
       │    ├─► Success → Continue
       │    └─► Failed → 401 Error
       │
       ├─► Rate Limit Check
       │    ├─► Allowed → Continue
       │    └─► Exceeded → 429 Error
       │
       ├─► Circuit Breaker Check
       │    ├─► Closed → Continue
       │    ├─► Open → 503 Error
       │    └─► Half-Open → Continue
       │
       ├─► Cache Check
       │    ├─► Hit → Return Cached
       │    └─► Miss → Continue
       │
       ├─► Proxy Request
       │    ├─► Success → Cache & Return
       │    └─► Failed → Error Handling
       │
       └─► Log Request
            └─► End
```

### 4.3 关键算法

#### 4.3.1 令牌桶限流算法

```typescript
class TokenBucket {
  private capacity: number;
  private tokens: number;
  private refillRate: number;
  private lastRefill: number;

  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  async consume(tokens: number = 1): Promise<boolean> {
    await this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }

    return false;
  }

  private async refill(): Promise<void> {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // 秒

    const refillAmount = elapsed * this.refillRate;
    this.tokens = Math.min(this.capacity, this.tokens + refillAmount);
    this.lastRefill = now;
  }

  getAvailableTokens(): number {
    return this.tokens;
  }
}
```

#### 4.3.2 滑动窗口限流算法

```typescript
class SlidingWindowRateLimiter {
  private windowSize: number; // 窗口大小(秒)
  private maxRequests: number;

  constructor(windowSize: number, maxRequests: number) {
    this.windowSize = windowSize;
    this.maxRequests = maxRequests;
  }

  async isAllowed(identifier: string): Promise<boolean> {
    const now = Date.now();
    const windowStart = now - this.windowSize * 1000;

    // 清理过期的请求记录
    await redis.zremrangebyscore(
      `ratelimit:sliding:${identifier}`,
      0,
      windowStart
    );

    // 统计当前窗口内的请求数
    const count = await redis.zcard(`ratelimit:sliding:${identifier}`);

    if (count >= this.maxRequests) {
      return false;
    }

    // 记录当前请求
    await redis.zadd(`ratelimit:sliding:${identifier}`, now, `${now}-${Math.random()}`);
    await redis.expire(`ratelimit:sliding:${identifier}`, this.windowSize);

    return true;
  }
}
```

#### 4.3.3 一致性哈希路由算法

```typescript
class ConsistentHash {
  private ring: Map<number, string> = new Map();
  private sortedHashes: number[] = [];
  private virtualNodes: number = 150; // 虚拟节点数

  addNode(node: string): void {
    for (let i = 0; i < this.virtualNodes; i++) {
      const virtualNode = `${node}:${i}`;
      const hash = this.hash(virtualNode);
      this.ring.set(hash, node);
    }

    this.sortedHashes = Array.from(this.ring.keys()).sort((a, b) => a - b);
  }

  removeNode(node: string): void {
    for (let i = 0; i < this.virtualNodes; i++) {
      const virtualNode = `${node}:${i}`;
      const hash = this.hash(virtualNode);
      this.ring.delete(hash);
    }

    this.sortedHashes = Array.from(this.ring.keys()).sort((a, b) => a - b);
  }

  getNode(key: string): string | null {
    if (this.sortedHashes.length === 0) {
      return null;
    }

    const hash = this.hash(key);

    // 查找第一个大于等于hash的节点
    const index = this.binarySearch(hash);

    return this.ring.get(this.sortedHashes[index]);
  }

  private hash(str: string): number {
    // 使用MurmurHash或其他哈希算法
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash >>> 0;
  }

  private binarySearch(hash: number): number {
    let left = 0;
    let right = this.sortedHashes.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);

      if (this.sortedHashes[mid] >= hash) {
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }

    return left % this.sortedHashes.length;
  }
}
```

## 5. 代码示例

### 5.1 核心类定义

```typescript
// 网关主类
class APIGateway {
  private router: Router;
  private authenticator: Authenticator;
  private rateLimiter: RateLimiter;
  private circuitBreaker: CircuitBreakerManager;
  private proxy: ProxyService;
  private logger: Logger;
  private cache: Cache;

  constructor(config: GatewayConfig) {
    this.router = new Router(config.routes);
    this.authenticator = new Authenticator(config.auth);
    this.rateLimiter = new RateLimiter(config.rateLimit);
    this.circuitBreaker = new CircuitBreakerManager(config.circuitBreaker);
    this.proxy = new ProxyService(config.proxy);
    this.logger = new Logger(config.logging);
    this.cache = new Cache(config.cache);
  }

  async start(): Promise<void> {
    // 初始化中间件
    this.setupMiddleware();

    // 启动HTTP服务器
    const server = createServer(this.handleRequest.bind(this));
    server.listen(config.port, () => {
      this.logger.info(`API Gateway started on port ${config.port}`);
    });
  }

  private setupMiddleware(): void {
    // 请求日志中间件
    this.use(async (ctx, next) => {
      const startTime = Date.now();
      await next();
      const latency = Date.now() - startTime;
      ctx.set('X-Response-Time', `${latency}ms`);
    });

    // 错误处理中间件
    this.use(async (ctx, next) => {
      try {
        await next();
      } catch (error) {
        await this.handleError(ctx, error);
      }
    });
  }

  private async handleRequest(ctx: Context): Promise<void> {
    // 路由匹配
    const route = this.router.match(ctx.method, ctx.path);
    if (!route) {
      throw new NotFoundError('Route not found');
    }

    // 执行中间件链
    await this.executeMiddleware(ctx, route);

    // 代理转发
    await this.proxy.forward(ctx, route);
  }
}

// 路由器类
class Router {
  private routes: Map<string, APIRouteConfig> = new Map();

  constructor(routes: APIRouteConfig[]) {
    this.loadRoutes(routes);
  }

  private loadRoutes(routes: APIRouteConfig[]): void {
    routes.forEach(route => {
      const key = `${route.method}:${route.path}`;
      this.routes.set(key, route);
    });
  }

  match(method: string, path: string): APIRouteConfig | null {
    const key = `${method}:${path}`;

    // 精确匹配
    if (this.routes.has(key)) {
      return this.routes.get(key)!;
    }

    // 模式匹配
    for (const [routeKey, route] of this.routes.entries()) {
      if (this.matchPattern(route.path, path)) {
        return route;
      }
    }

    return null;
  }

  private matchPattern(pattern: string, path: string): boolean {
    const patternParts = pattern.split('/');
    const pathParts = path.split('/');

    if (patternParts.length !== pathParts.length) {
      return false;
    }

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];
      const pathPart = pathParts[i];

      // 参数匹配
      if (patternPart.startsWith(':')) {
        continue;
      }

      // 通配符匹配
      if (patternPart === '*') {
        continue;
      }

      // 精确匹配
      if (patternPart !== pathPart) {
        return false;
      }
    }

    return true;
  }
}
```

### 5.2 关键方法实现

```typescript
// 认证器实现
class Authenticator {
  private jwtVerifier: JWTVerifier;

  constructor(config: AuthConfig) {
    this.jwtVerifier = new JWTVerifier(config.jwtSecret);
  }

  async authenticate(ctx: Context, route: APIRouteConfig): Promise<void> {
    const token = this.extractToken(ctx);

    if (!token && route.authRequired) {
      throw new UnauthorizedError('Missing authorization token');
    }

    if (token) {
      try {
        const payload = await this.jwtVerifier.verify(token);

        // 验证令牌有效期
        if (payload.exp < Date.now()) {
          throw new UnauthorizedError('Token expired');
        }

        // 设置用户上下文
        ctx.user = {
          id: payload.userId,
          role: payload.role,
          permissions: payload.permissions
        };

        // 检查权限
        this.checkPermissions(ctx.user, route.permissions);

      } catch (error) {
        throw new UnauthorizedError('Invalid token');
      }
    }
  }

  private extractToken(ctx: Context): string | null {
    const authHeader = ctx.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    return null;
  }

  private checkPermissions(user: UserContext, requiredPermissions?: string[]): void {
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return;
    }

    const hasPermission = requiredPermissions.some(perm =>
      user.permissions.includes(perm)
    );

    if (!hasPermission) {
      throw new ForbiddenError('Insufficient permissions');
    }
  }
}

// 限流器实现
class RateLimiter {
  private strategies: Map<string, RateLimitStrategy> = new Map();

  constructor(config: RateLimitConfig) {
    this.strategies.set('token-bucket', new TokenBucketStrategy(config));
    this.strategies.set('sliding-window', new SlidingWindowStrategy(config));
    this.strategies.set('fixed-window', new FixedWindowStrategy(config));
  }

  async checkLimit(ctx: Context, config: RateLimitConfig): Promise<void> {
    if (!config.enabled) {
      return;
    }

    const strategy = this.strategies.get(config.algorithm);
    if (!strategy) {
      throw new Error(`Unknown rate limit algorithm: ${config.algorithm}`);
    }

    const identifier = this.generateIdentifier(ctx, config.keyGenerator);
    const allowed = await strategy.check(identifier, config);

    if (!allowed) {
      throw new RateLimitError('Rate limit exceeded', {
        retryAfter: strategy.getRetryAfter(identifier, config)
      });
    }
  }

  private generateIdentifier(ctx: Context, keyGenerator: string): string {
    switch (keyGenerator) {
      case 'user-id':
        return ctx.user?.id || ctx.ip;
      case 'ip':
        return ctx.ip;
      case 'api-key':
        return ctx.apiKey || ctx.ip;
      default:
        return ctx.ip;
    }
  }
}
```

### 5.3 配置示例

```typescript
// 网关配置文件 config/gateway.ts
export const gatewayConfig: GatewayConfig = {
  server: {
    port: 8080,
    host: '0.0.0.0'
  },

  routes: [
    {
      path: '/api/v1/auth/login',
      method: 'POST',
      service: 'user-service',
      targetPath: '/auth/login',
      authRequired: false,
      rateLimit: {
        enabled: true,
        algorithm: 'sliding-window',
        rate: 10,
        burst: 20,
        keyGenerator: 'ip'
      },
      timeout: 5000
    },
    {
      path: '/api/v1/questions/:id',
      method: 'GET',
      service: 'question-service',
      targetPath: '/questions/:id',
      authRequired: true,
      permissions: ['question:read'],
      rateLimit: {
        enabled: true,
        algorithm: 'token-bucket',
        rate: 100,
        burst: 200,
        keyGenerator: 'user-id'
      },
      cache: {
        enabled: true,
        ttl: 300,
        cacheEmpty: false
      },
      timeout: 10000
    }
  ],

  auth: {
    jwtSecret: process.env.JWT_SECRET!,
    jwtExpiresIn: '7d'
  },

  rateLimit: {
    defaultAlgorithm: 'token-bucket',
    defaultRate: 1000,
    defaultBurst: 2000
  },

  circuitBreaker: {
    enabled: true,
    defaultFailureThreshold: 5,
    defaultSuccessThreshold: 3,
    defaultTimeout: 60,
    defaultHalfOpenMaxCalls: 3
  },

  services: {
    'user-service': {
      baseUrl: 'http://user-service:8081',
      healthCheck: '/health',
      timeout: 5000
    },
    'question-service': {
      baseUrl: 'http://question-service:8082',
      healthCheck: '/health',
      timeout: 10000
    },
    'ai-service': {
      baseUrl: 'http://ai-service:8083',
      healthCheck: '/health',
      timeout: 30000
    }
  },

  logging: {
    level: 'info',
    format: 'json',
    output: 'stdout'
  },

  cache: {
    enabled: true,
    redis: {
      host: process.env.REDIS_HOST!,
      port: parseInt(process.env.REDIS_PORT!),
      password: process.env.REDIS_PASSWORD
    }
  }
};
```

## 6. 错误处理

### 6.1 异常类型

```typescript
// 基础异常类
class GatewayError extends Error {
  constructor(
    message: string,
    public code: number,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

// 认证异常
class UnauthorizedError extends GatewayError {
  constructor(message: string = 'Unauthorized', details?: any) {
    super(message, GatewayErrorCode.UNAUTHORIZED, 401, details);
  }
}

// 权限异常
class ForbiddenError extends GatewayError {
  constructor(message: string = 'Forbidden', details?: any) {
    super(message, GatewayErrorCode.FORBIDDEN, 403, details);
  }
}

// 路由不存在异常
class NotFoundError extends GatewayError {
  constructor(message: string = 'Not Found', details?: any) {
    super(message, GatewayErrorCode.NOT_FOUND, 404, details);
  }
}

// 限流异常
class RateLimitError extends GatewayError {
  constructor(
    message: string = 'Rate Limit Exceeded',
    details?: { retryAfter?: number }
  ) {
    super(message, GatewayErrorCode.RATE_LIMIT_EXCEEDED, 429, details);
  }
}

// 服务不可用异常
class ServiceUnavailableError extends GatewayError {
  constructor(message: string = 'Service Unavailable', details?: any) {
    super(message, GatewayErrorCode.SERVICE_UNAVAILABLE, 503, details);
  }
}

// 熔断器异常
class CircuitBreakerOpenError extends GatewayError {
  constructor(service: string, details?: any) {
    super(
      `Circuit breaker open for service: ${service}`,
      GatewayErrorCode.CIRCUIT_BREAKER_OPEN,
      503,
      details
    );
  }
}
```

### 6.2 错误处理中间件

```typescript
async function errorHandler(ctx: Context, next: Function): Promise<void> {
  try {
    await next();
  } catch (error) {
    await handleError(ctx, error);
  }
}

async function handleError(ctx: Context, error: Error): Promise<void> {
  // 生成错误响应
  const errorResponse: ErrorResponse = {
    code: 5000,
    message: 'Internal server error',
    traceId: ctx.requestId,
    timestamp: Date.now()
  };

  // 处理已知错误类型
  if (error instanceof GatewayError) {
    errorResponse.code = error.code;
    errorResponse.message = error.message;
    errorResponse.details = error.details;
    ctx.status = error.statusCode;
  } else {
    // 处理未知错误
    ctx.status = 500;
  }

  // 记录错误日志
  logger.error('Request error', {
    error: error.message,
    stack: error.stack,
    traceId: ctx.requestId,
    path: ctx.path,
    method: ctx.method
  });

  // 返回错误响应
  ctx.body = errorResponse;
}
```

### 6.3 重试策略

```typescript
class RetryStrategy {
  async execute<T>(
    fn: () => Promise<T>,
    config: RetryConfig
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= config.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        // 检查是否可重试
        if (!this.isRetryable(error, config)) {
          throw error;
        }

        // 最后一次尝试不再重试
        if (attempt === config.maxAttempts) {
          throw error;
        }

        // 等待后重试
        const delay = this.calculateDelay(attempt, config.backoffMs);
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private isRetryable(error: Error, config: RetryConfig): boolean {
    // 检查错误码是否在可重试列表中
    if (error instanceof GatewayError) {
      return config.retryableErrors.includes(error.code);
    }

    // 检查网络错误
    if (error.message.includes('ECONNREFUSED') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('ENOTFOUND')) {
      return true;
    }

    return false;
  }

  private calculateDelay(attempt: number, baseDelay: number): number {
    // 指数退避
    return baseDelay * Math.pow(2, attempt);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 6.4 降级方案

```typescript
class FallbackStrategy {
  private fallbacks: Map<string, FallbackHandler> = new Map();

  register(service: string, handler: FallbackHandler): void {
    this.fallbacks.set(service, handler);
  }

  async executeWithFallback<T>(
    service: string,
    fn: () => Promise<T>
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const handler = this.fallbacks.get(service);

      if (handler) {
        logger.warn(`Executing fallback for service: ${service}`);
        return await handler.execute(error);
      }

      throw error;
    }
  }
}

// 降级处理器接口
interface FallbackHandler {
  execute(error: Error): Promise<any>;
}

// 示例：AI服务降级处理器
class AIServiceFallbackHandler implements FallbackHandler {
  async execute(error: Error): Promise<any> {
    // 返回缓存的结果
    return {
      code: 0,
      message: 'Service busy, please try again later',
      data: null,
      fallback: true
    };
  }
}
```

## 7. 性能优化

### 7.1 缓存策略

```typescript
class CacheStrategy {
  private cache: Cache;
  private config: CacheConfig;

  constructor(cache: Cache, config: CacheConfig) {
    this.cache = cache;
    this.config = config;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.cache.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Cache get error', { error, key });
      return null;
    }
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      await this.cache.set(key, serialized, ttl || this.config.defaultTTL);
    } catch (error) {
      logger.error('Cache set error', { error, key });
    }
  }

  async invalidate(pattern: string): Promise<void> {
    try {
      const keys = await this.cache.keys(pattern);
      if (keys.length > 0) {
        await this.cache.del(...keys);
      }
    } catch (error) {
      logger.error('Cache invalidate error', { error, pattern });
    }
  }

  // 生成缓存键
  generateCacheKey(ctx: Context, route: APIRouteConfig): string {
    const parts = [
      route.service,
      route.method,
      route.path,
      JSON.stringify(ctx.query),
      JSON.stringify(ctx.body)
    ];

    return `cache:${hash(parts.join(':'))}`;
  }
}
```

### 7.2 并发控制

```typescript
class ConcurrencyController {
  private semaphores: Map<string, Semaphore> = new Map();

  getSemaphore(key: string, limit: number): Semaphore {
    if (!this.semaphores.has(key)) {
      this.semaphores.set(key, new Semaphore(limit));
    }

    return this.semaphores.get(key)!;
  }

  async execute<T>(
    key: string,
    limit: number,
    fn: () => Promise<T>
  ): Promise<T> {
    const semaphore = this.getSemaphore(key, limit);

    return semaphore.acquire(async () => {
      return await fn();
    });
  }
}

// 信号量实现
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.release();
        }
      };

      if (this.permits > 0) {
        this.permits--;
        execute();
      } else {
        this.queue.push(execute);
      }
    });
  }

  private release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.permits++;
    }
  }
}
```

### 7.3 资源限制

```typescript
class ResourceLimiter {
  private limits: Map<string, ResourceLimit> = new Map();

  register(resource: string, limit: ResourceLimit): void {
    this.limits.set(resource, limit);
  }

  async check(resource: string): Promise<boolean> {
    const limit = this.limits.get(resource);

    if (!limit) {
      return true;
    }

    const current = await this.getCurrentUsage(resource);

    return current < limit.max;
  }

  async acquire(resource: string): Promise<boolean> {
    const limit = this.limits.get(resource);

    if (!limit) {
      return true;
    }

    const key = `resource:${resource}`;
    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, limit.window);
    }

    if (current > limit.max) {
      await redis.decr(key);
      return false;
    }

    return true;
  }

  async release(resource: string): Promise<void> {
    const key = `resource:${resource}`;
    await redis.decr(key);
  }

  private async getCurrentUsage(resource: string): Promise<number> {
    const key = `resource:${resource}`;
    const value = await redis.get(key);

    return value ? parseInt(value) : 0;
  }
}

interface ResourceLimit {
  max: number;      // 最大值
  window: number;   // 时间窗口(秒)
}
```

## 8. 安全考虑

### 8.1 权限控制

```typescript
class PermissionManager {
  private rolePermissions: Map<string, string[]> = new Map();
  private resourcePermissions: Map<string, string[]> = new Map();

  constructor() {
    this.initPermissions();
  }

  private initPermissions(): void {
    // 角色权限映射
    this.rolePermissions.set('student', [
      'question:read',
      'question:answer',
      'mistake:read',
      'mistake:create',
      'studyplan:read',
      'studyplan:create'
    ]);

    this.rolePermissions.set('parent', [
      'student:read',
      'report:read',
      'control:manage'
    ]);

    this.rolePermissions.set('teacher', [
      'class:read',
      'class:manage',
      'student:read',
      'assignment:create',
      'assignment:manage'
    ]);

    this.rolePermissions.set('admin', ['*']);
  }

  hasPermission(user: UserContext, permission: string): boolean {
    // 管理员拥有所有权限
    if (user.role === 'admin') {
      return true;
    }

    const permissions = this.rolePermissions.get(user.role) || [];

    // 支持通配符权限
    if (permissions.includes('*')) {
      return true;
    }

    return permissions.includes(permission);
  }

  hasAnyPermission(user: UserContext, permissions: string[]): boolean {
    return permissions.some(perm => this.hasPermission(user, perm));
  }
}
```

### 8.2 数据验证

```typescript
class RequestValidator {
  private schemas: Map<string, ValidationSchema> = new Map();

  registerSchema(route: string, schema: ValidationSchema): void {
    this.schemas.set(route, schema);
  }

  validate(route: string, data: any): ValidationResult {
    const schema = this.schemas.get(route);

    if (!schema) {
      return { valid: true, errors: [] };
    }

    return this.validateSchema(data, schema);
  }

  private validateSchema(data: any, schema: ValidationSchema): ValidationResult {
    const errors: string[] = [];

    // 验证必填字段
    for (const field of schema.required || []) {
      if (data[field] === undefined || data[field] === null) {
        errors.push(`Field ${field} is required`);
      }
    }

    // 验证字段类型
    for (const [field, type] of Object.entries(schema.properties || {})) {
      if (data[field] !== undefined) {
        if (!this.validateType(data[field], type)) {
          errors.push(`Field ${field} must be of type ${type}`);
        }
      }
    }

    // 验证字段格式
    if (schema.patterns) {
      for (const [field, pattern] of Object.entries(schema.patterns)) {
        if (data[field] && !pattern.test(data[field])) {
          errors.push(`Field ${field} has invalid format`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  private validateType(value: any, type: string): boolean {
    switch (type) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number';
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && value !== null;
      default:
        return true;
    }
  }
}

interface ValidationSchema {
  required?: string[];
  properties?: Record<string, string>;
  patterns?: Record<string, RegExp>;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}
```

### 8.3 审计日志

```typescript
class AuditLogger {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  log(event: AuditEvent): void {
    this.logger.info('Audit event', {
      timestamp: event.timestamp,
      userId: event.userId,
      action: event.action,
      resource: event.resource,
      details: event.details,
      ip: event.ip,
      userAgent: event.userAgent
    });
  }

  logAuthentication(userId: string, success: boolean, ip: string): void {
    this.log({
      timestamp: new Date(),
      userId,
      action: success ? 'AUTH_SUCCESS' : 'AUTH_FAILURE',
      resource: 'auth',
      ip,
      success
    });
  }

  logAuthorization(userId: string, action: string, resource: string, success: boolean): void {
    this.log({
      timestamp: new Date(),
      userId,
      action,
      resource,
      success
    });
  }

  logDataAccess(userId: string, resource: string, operation: string): void {
    this.log({
      timestamp: new Date(),
      userId,
      action: 'DATA_ACCESS',
      resource,
      operation
    });
  }
}

interface AuditEvent {
  timestamp: Date;
  userId: string;
  action: string;
  resource: string;
  ip?: string;
  userAgent?: string;
  success?: boolean;
  details?: any;
}
```

## 9. 测试策略

### 9.1 单元测试

```typescript
// 路由器测试
describe('Router', () => {
  let router: Router;
  let mockRoutes: APIRouteConfig[];

  beforeEach(() => {
    mockRoutes = [
      {
        id: '1',
        path: '/api/v1/users',
        method: 'GET',
        service: 'user-service',
        targetPath: '/users',
        authRequired: true,
        rateLimit: { enabled: false } as any,
        timeout: 5000,
        retry: { enabled: false } as any,
        cache: { enabled: false } as any,
        version: 'v1',
        deprecated: false,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    router = new Router(mockRoutes);
  });

  test('should match exact route', () => {
    const route = router.match('GET', '/api/v1/users');
    expect(route).not.toBeNull();
    expect(route?.service).toBe('user-service');
  });

  test('should return null for non-existent route', () => {
    const route = router.match('GET', '/api/v1/nonexistent');
    expect(route).toBeNull();
  });

  test('should match parameterized route', () => {
    const route = router.match('GET', '/api/v1/users/123');
    expect(route).not.toBeNull();
  });
});

// 限流器测试
describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;
  let mockRedis: jest.Mocked<Redis>;

  beforeEach(() => {
    mockRedis = {
      hgetall: jest.fn(),
      hset: jest.fn(),
      expire: jest.fn()
    } as any;

    rateLimiter = new RateLimiter({
      defaultAlgorithm: 'token-bucket',
      defaultRate: 10,
      defaultBurst: 20
    });
  });

  test('should allow request within limit', async () => {
    mockRedis.hgetall.mockResolvedValue({
      tokens: '10',
      lastRefill: Date.now().toString()
    });

    const config = {
      enabled: true,
      algorithm: 'token-bucket',
      rate: 10,
      burst: 20,
      keyGenerator: 'ip'
    } as RateLimitConfig;

    const ctx = { ip: '192.168.1.1' } as any;

    await expect(rateLimiter.checkLimit(ctx, config)).resolves.not.toThrow();
  });

  test('should reject request exceeding limit', async () => {
    mockRedis.hgetall.mockResolvedValue({
      tokens: '0',
      lastRefill: Date.now().toString()
    });

    const config = {
      enabled: true,
      algorithm: 'token-bucket',
      rate: 10,
      burst: 20,
      keyGenerator: 'ip'
    } as RateLimitConfig;

    const ctx = { ip: '192.168.1.1' } as any;

    await expect(rateLimiter.checkLimit(ctx, config)).rejects.toThrow(RateLimitError);
  });
});
```

### 9.2 集成测试

```typescript
// API网关集成测试
describe('API Gateway Integration', () => {
  let gateway: APIGateway;
  let testServer: any;
  let mockUserService: any;

  beforeAll(async () => {
    // 启动模拟服务
    mockUserService = await startMockService('user-service', 8081);

    // 启动网关
    gateway = new APIGateway(gatewayConfig);
    await gateway.start();

    testServer = request(gateway.getApp());
  });

  afterAll(async () => {
    await gateway.stop();
    await mockUserService.close();
  });

  test('should proxy request to user service', async () => {
    const response = await testServer
      .get('/api/v1/users/123')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(response.body).toHaveProperty('data');
  });

  test('should enforce rate limiting', async () => {
    const requests = Array(15).fill(null).map(() =>
      testServer
        .get('/api/v1/users/123')
        .set('Authorization', 'Bearer valid-token')
    );

    const responses = await Promise.all(requests);

    const rateLimitResponses = responses.filter(r => r.status === 429);
    expect(rateLimitResponses.length).toBeGreaterThan(0);
  });

  test('should handle circuit breaker', async () => {
    // 停止模拟服务触发熔断
    await mockUserService.close();

    const response = await testServer
      .get('/api/v1/users/123')
      .set('Authorization', 'Bearer valid-token')
      .expect(503);

    expect(response.body.code).toBe(GatewayErrorCode.CIRCUIT_BREAKER_OPEN);
  });
});
```

### 9.3 性能测试

```typescript
// 性能测试
describe('API Gateway Performance', () => {
  let gateway: APIGateway;

  beforeAll(async () => {
    gateway = new APIGateway(gatewayConfig);
    await gateway.start();
  });

  afterAll(async () => {
    await gateway.stop();
  });

  test('should handle 1000 concurrent requests', async () => {
    const requests = Array(1000).fill(null).map((_, i) =>
      request(gateway.getApp())
        .get(`/api/v1/users/${i}`)
        .set('Authorization', 'Bearer valid-token')
    );

    const startTime = Date.now();
    const responses = await Promise.all(requests);
    const duration = Date.now() - startTime;

    expect(responses.every(r => r.status === 200)).toBe(true);
    expect(duration).toBeLessThan(5000); // 5秒内完成
  });

  test('should maintain low latency under load', async () => {
    const latencies: number[] = [];

    for (let i = 0; i < 100; i++) {
      const startTime = Date.now();
      await request(gateway.getApp())
        .get(`/api/v1/users/${i}`)
        .set('Authorization', 'Bearer valid-token');
      const latency = Date.now() - startTime;
      latencies.push(latency);
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];

    expect(avgLatency).toBeLessThan(100); // 平均延迟 < 100ms
    expect(p95Latency).toBeLessThan(200);  // P95延迟 < 200ms
  });
});
```

## 10. 部署与运维

### 10.1 Docker 配置

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm ci --only=production

# 复制源代码
COPY . .

# 构建应用
RUN npm run build

# 暴露端口
EXPOSE 8080

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# 启动应用
CMD ["node", "dist/index.js"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  api-gateway:
    build: .
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV=production
      - JWT_SECRET=${JWT_SECRET}
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    depends_on:
      - redis
    restart: unless-stopped
    networks:
      - gateway-network

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped
    networks:
      - gateway-network

volumes:
  redis-data:

networks:
  gateway-network:
    driver: bridge
```

### 10.2 Kubernetes 配置

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-gateway
  labels:
    app: api-gateway
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-gateway
  template:
    metadata:
      labels:
        app: api-gateway
    spec:
      containers:
      - name: api-gateway
        image: primetop/api-gateway:latest
        ports:
        - containerPort: 8080
        env:
        - name: NODE_ENV
          value: "production"
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: api-gateway-secrets
              key: jwt-secret
        - name: REDIS_HOST
          value: "redis-service"
        - name: REDIS_PORT
          value: "6379"
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5

---
apiVersion: v1
kind: Service
metadata:
  name: api-gateway-service
spec:
  selector:
    app: api-gateway
  ports:
  - protocol: TCP
    port: 80
    targetPort: 8080
  type: LoadBalancer

---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-gateway-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-gateway
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

### 10.3 监控配置

```typescript
// 监控指标收集
class MetricsCollector {
  private prometheus: Prometheus;

  constructor() {
    this.prometheus = new Prometheus({
      prefix: 'api_gateway_'
    });

    this.registerMetrics();
  }

  private registerMetrics(): void {
    // 请求总数
    this.prometheus.register('requests_total', 'counter', 'Total number of requests', [
      'method', 'path', 'status'
    ]);

    // 请求延迟
    this.prometheus.register('request_duration_seconds', 'histogram', 'Request duration in seconds', [
      'method', 'path'
    ]);

    // 限流触发次数
    this.prometheus.register('rate_limit_exceeded_total', 'counter', 'Total number of rate limit violations', [
      'identifier'
    ]);

    // 熔断器状态
    this.prometheus.register('circuit_breaker_state', 'gauge', 'Circuit breaker state', [
      'service'
    ]);
  }

  recordRequest(method: string, path: string, status: number, duration: number): void {
    this.prometheus.increment('requests_total', {
      method,
      path,
      status: status.toString()
    });

    this.prometheus.observe('request_duration_seconds', duration / 1000, {
      method,
      path
    });
  }

  recordRateLimitExceeded(identifier: string): void {
    this.prometheus.increment('rate_limit_exceeded_total', { identifier });
  }

  updateCircuitBreakerState(service: string, state: number): void {
    this.prometheus.set('circuit_breaker_state', state, { service });
  }
}

// Grafana 面板配置示例
const grafanaDashboard = {
  dashboard: {
    title: 'API Gateway Monitoring',
    panels: [
      {
        title: 'Request Rate',
        targets: [
          {
            expr: 'rate(api_gateway_requests_total[5m])',
            legendFormat: '{{method}} {{path}}'
          }
        ]
      },
      {
        title: 'Request Latency',
        targets: [
          {
            expr: 'histogram_quantile(0.95, api_gateway_request_duration_seconds)',
            legendFormat: 'P95 Latency'
          }
        ]
      },
      {
        title: 'Error Rate',
        targets: [
          {
            expr: 'rate(api_gateway_requests_total{status=~"5.."}[5m])',
            legendFormat: '{{path}}'
          }
        ]
      }
    ]
  }
};
```

## 11. 总结

API 网关作为 PrimeTop 系统的核心组件，承担着请求路由、安全防护、流量控制等重要职责。本详细设计文档涵盖了网关服务的完整技术实现方案，包括：

1. **数据模型设计**：定义了路由配置、限流配置、熔断器配置等核心实体
2. **API 接口设计**：提供了管理接口和代理接口的完整规范
3. **业务逻辑实现**：详细描述了认证鉴权、限流控制、熔断保护等核心流程
4. **代码示例**：提供了可直接参考的核心类和方法实现
5. **错误处理机制**：建立了完善的异常处理和降级方案
6. **性能优化策略**：实现了缓存、并发控制、资源限制等优化手段
7. **安全防护措施**：包含了权限控制、数据验证、审计日志等安全机制
8. **测试策略**：制定了单元测试、集成测试、性能测试的完整方案
9. **部署运维方案**：提供了 Docker、Kubernetes、监控等运维支持

通过本设计文档，开发团队可以快速搭建起高性能、高可用的 API 网关服务，为 PrimeTop 平台的稳定运行提供坚实基础。