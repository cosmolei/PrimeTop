# API 网关统一接口规范与实现指南 - 详细设计

## 1. 概述

### 1.1 设计目标

API 网关作为 PrimeTop 系统的统一入口，负责请求路由、鉴权、限流、监控、日志和协议转换等横切关注点。本文档定义：

1. 统一的接口规范（请求格式、响应格式、错误码）
2. 网关层的技术实现细节
3. 与业务服务的协作规范
4. 接口文档自动化和契约测试规范

### 1.2 技术选型

| 组件 | 选型 | 说明 |
|------|------|------|
| 网关框架 | Kong / APISIX | 云原生、高性能、插件丰富 |
| 反向代理 | Nginx | 静态资源、WebSocket |
| 服务发现 | Consul | 服务注册与发现 |
| 配置中心 | Consul KV | 动态配置、热更新 |
| 限流算法 | 令牌桶 + 滑动窗口 | 精细化限流 |
| 日志采集 | Loki / ELK | 链路追踪和审计日志 |
| 监控 | Prometheus + Grafana | 实时监控大盘 |

### 1.3 系统边界

```
                              ┌─────────────────┐
                              │   外部世界        │
                              │ (客户端/Web/API) │
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │   API 网关       │
                              │  (Kong/APISIX)  │
                              └────────┬────────┘
                                       │
                  ┌────────────────────┼────────────────────┐
                  │                    │                    │
         ┌────────▼─────────┐  ┌─────▼──────┐  ┌──────────▼─────────┐
         │   用户服务        │  │  AI 服务    │  │   学习服务          │
         │ (user-service)    │  │ (ai-service)│  │ (learning-service)  │
         └───────────────────┘  └────────────┘  └────────────────────┘
```

---

## 2. 统一接口规范

### 2.1 请求格式

#### 2.1.1 HTTP 方法规范

| 方法 | 用途 | 示例 |
|------|------|------|
| GET | 获取资源（幂等） | `GET /api/v1/users/123` |
| POST | 创建资源 | `POST /api/v1/questions` |
| PUT | 完全更新资源（幂等） | `PUT /api/v1/users/123` |
| PATCH | 部分更新资源 | `PATCH /api/v1/users/123` |
| DELETE | 删除资源（幂等） | `DELETE /api/v1/questions/456` |

#### 2.1.2 请求头规范

```http
# 标准请求头
Content-Type: application/json
Accept: application/json
User-Agent: PrimeTop/1.0.0 (Build/100; Android; 13)

# 认证头
Authorization: Bearer <JWT_TOKEN>

# 客户端标识
X-Device-ID: <device_uuid>
X-Platform: android | ios | web
X-App-Version: 1.0.0
X-Request-ID: <uuid>          # 可选，用于链路追踪

# 分页
X-Page: 1
X-Page-Size: 20

# 时间戳（防重放）
X-Timestamp: 1672531200000
```

#### 2.1.3 请求体规范

```json
{
  "data": {
    // 业务数据
  },
  "meta": {
    // 元数据（可选）
  }
}
```

**示例：创建题目**

```json
POST /api/v1/questions
Content-Type: application/json

{
  "data": {
    "subject": "math",
    "grade": "小学三年级",
    "content": "计算：12 + 34 = ?",
    "options": ["46", "45", "47", "44"],
    "answer": 0,
    "knowledge_points": ["加法运算", "两位数计算"]
  },
  "meta": {
    "source": "photo_recognition",
    "confidence": 0.95
  }
}
```

---

### 2.2 响应格式

#### 2.2.1 成功响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    // 业务数据
  },
  "meta": {
    "timestamp": 1672531200000,
    "request_id": "550e8400-e29b-41d4-a716-446655440000",
    "trace_id": "a1b2c3d4e5f6"
  }
}
```

#### 2.2.2 分页响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [
      // 数据列表
    ],
    "pagination": {
      "page": 1,
      "page_size": 20,
      "total": 100,
      "total_pages": 5,
      "has_next": true,
      "has_prev": false
    }
  },
  "meta": {
    "timestamp": 1672531200000,
    "request_id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

#### 2.2.3 错误响应

```json
{
  "code": 40001,
  "message": "参数错误：手机号格式不正确",
  "data": null,
  "errors": [
    {
      "field": "phone",
      "message": "手机号格式不正确",
      "code": "INVALID_PHONE_FORMAT"
    }
  ],
  "meta": {
    "timestamp": 1672531200000,
    "request_id": "550e8400-e29b-41d4-a716-446655440000",
    "trace_id": "a1b2c3d4e5f6"
  }
}
```

---

### 2.3 统一错误码体系

#### 2.3.1 错误码结构

错误码采用 5 位数字格式：`XXXYY`

- **前三位（XXX）**：模块标识
- **后两位（YY）**：具体错误类型

| 模块码 | 模块名称 |
|--------|---------|
| 100 | 通用系统 |
| 200 | 认证授权 |
| 300 | 用户管理 |
| 400 | 学习服务 |
| 500 | AI 服务 |
| 600 | 题库服务 |
| 700 | 支付服务 |
| 800 | 内容服务 |
| 900 | 运营管理 |

| 类型码 | 类型说明 |
|--------|---------|
| 00-09 | 参数错误 |
| 10-19 | 资源不存在 |
| 20-29 | 权限不足 |
| 30-39 | 业务规则错误 |
| 40-49 | 第三方服务错误 |
| 50-59 | 系统错误 |
| 90-99 | 未知错误 |

#### 2.3.2 通用错误码

| 错误码 | HTTP 状态码 | 说明 |
|--------|-----------|------|
| 10000 | 400 | 请求参数错误 |
| 10001 | 400 | 必填参数缺失 |
| 10002 | 400 | 参数格式错误 |
| 10003 | 400 | 参数值超出范围 |
| 10010 | 404 | 资源不存在 |
| 10020 | 403 | 未授权访问 |
| 10021 | 401 | 未登录 |
| 10022 | 403 | Token 过期 |
| 10023 | 403 | Token 无效 |
| 10030 | 409 | 资源冲突 |
| 10031 | 429 | 请求过于频繁 |
| 10040 | 502 | 第三方服务不可用 |
| 10050 | 500 | 系统内部错误 |
| 10099 | 500 | 未知错误 |

#### 2.3.3 业务错误码示例

| 错误码 | 说明 | HTTP 状态码 |
|--------|------|-----------|
| 20001 | 手机号已注册 | 409 |
| 20002 | 验证码错误 | 400 |
| 20003 | 验证码已过期 | 400 |
| 30010 | 用户不存在 | 404 |
| 30011 | 用户已被禁用 | 403 |
| 50001 | AI 服务调用失败 | 502 |
| 50002 | AI 内容被安全拦截 | 451 |
| 50003 | AI 调用额度不足 | 429 |
| 70001 | 订单不存在 | 404 |
| 70002 | 订单已支付 | 409 |

---

## 3. API 网关实现细节

### 3.1 基础架构

```yaml
# Kong 配置示例
_format_version: "3.0"

services:
  - name: user-service
    url: http://user-service:8080
    routes:
      - name: user-api
        paths:
          - /api/v1/users
        strip_path: false
        methods:
          - GET
          - POST
          - PUT
          - DELETE

  - name: ai-service
    url: http://ai-service:8080
    routes:
      - name: ai-api
        paths:
          - /api/v1/ai
        strip_path: false

  - name: learning-service
    url: http://learning-service:8080
    routes:
      - name: learning-api
        paths:
          - /api/v1/learning
        strip_path: false
```

### 3.2 插件配置

#### 3.2.1 JWT 认证插件

```yaml
plugins:
  - name: jwt
    route: user-api
    config:
      key_claim_name: kid
      claims_to_verify:
        - exp
      secret_is_base64: false
```

#### 3.2.2 限流插件

```yaml
plugins:
  # 令牌桶限流（粗粒度）
  - name: rate-limiting
    config:
      minute: 100              # 每分钟 100 次
      hour: 1000               # 每小时 1000 次
      policy: redis
      redis_host: redis
      redis_port: 6379
      redis_database: 0

  # 滑动窗口限流（细粒度，按接口）
  - name: request-transformer
    route: ai-api
    config:
      add:
        headers:
          - X-Rate-Limit-Window:60
```

#### 3.2.3 CORS 插件

```yaml
plugins:
  - name: cors
    config:
      origins:
        - https://app.primetop.cn
        - https://staging.primetop.cn
      methods:
        - GET
        - POST
        - PUT
        - DELETE
        - OPTIONS
      headers:
        - Accept
        - Accept-Version
        - Content-Length
        - Content-MD5
        - Content-Type
        - Date
        - Authorization
        - X-Device-ID
        - X-Platform
      exposed_headers:
        - X-Request-ID
        - X-Trace-ID
      max_age: 3600
      credentials: true
```

#### 3.2.4 请求/响应转换插件

```yaml
plugins:
  # 统一添加请求头
  - name: request-transformer
    config:
      add:
        headers:
          - X-Request-ID:$(uuid)
          - X-Timestamp:$(now ts)

  # 统一响应格式
  - name: response-transformer
    config:
      add:
        headers:
          - X-Response-Time:$(latency ms)
```

#### 3.2.5 日志插件

```yaml
plugins:
  - name: file-log
    config:
      path: /var/log/kong/access.log
     reopen: false
```

### 3.3 路由规则设计

#### 3.3.1 版本路由

```
/api/v1/users/123      # V1 版本
/api/v2/users/123      # V2 版本
/api/users/123         # 默认指向最新稳定版本
```

#### 3.3.2 权重路由（灰度发布）

```yaml
services:
  - name: user-service-v2
    url: http://user-service-v2:8080
    routes:
      - name: user-api-canary
        paths:
          - /api/v1/users
        hosts:
          - api.primetop.cn
        plugins:
          - name: canary
            config:
              percentage: 20        # 20% 流量到 V2
              upstream:
                name: user-service-v2
                host_header: user-service-v2
```

#### 3.3.3 按客户端类型路由

```yaml
routes:
  - name: user-api-mobile
    paths:
      - /api/v1/users
    hosts:
      - mobile-api.primetop.cn
    plugins:
      - name: request-transformer
        config:
          add:
            headers:
              - X-Client-Type:mobile

  - name: user-api-web
    paths:
      - /api/v1/users
    hosts:
      - web-api.primetop.cn
    plugins:
      - name: request-transformer
        config:
          add:
            headers:
              - X-Client-Type:web
```

### 3.4 监控与可观测性

#### 3.4.1 Prometheus 指标

```yaml
plugins:
  - name: prometheus
    config:
      per_consumer: true
```

**关键指标：**

- `kong_http_status` (按状态码分组)
- `kong_latency_ms` (响应时间)
- `kong_bandwidth` (带宽使用)
- `kong_request_count` (请求数)

#### 3.4.2 链路追踪

```yaml
plugins:
  - name: zipkin
    config:
      http_endpoint: http://jaeger:9411/api/v2/spans
      sample_ratio: 0.1      # 10% 采样
      include_credential: false
```

#### 3.4.3 健康检查端点

```http
GET /health
Status: 200

Response:
{
  "status": "ok",
  "version": "2.8.1",
  "timestamp": 1672531200000,
  "services": {
    "user-service": "healthy",
    "ai-service": "healthy",
    "learning-service": "healthy"
  }
}
```

---

## 4. 业务服务接入规范

### 4.1 服务注册

```typescript
// 服务启动时注册到 Consul
import { Consul } from 'consul';

const consul = new Consul({
  host: 'consul',
  port: 8500
});

await consul.agent.service.register({
  name: 'user-service',
  id: 'user-service-1',
  address: 'user-service-1',
  port: 8080,
  check: {
    http: 'http://user-service-1:8080/health',
    interval: '10s',
    timeout: '5s',
    deregister_critical_service_after: '30s'
  },
  tags: ['v1', 'production']
});
```

### 4.2 服务间调用规范

```typescript
// 使用服务发现调用其他服务
import { ConsulServiceDiscovery } from './consul-discovery';

const discovery = new ConsulServiceDiscovery();

async function getUserInfo(userId: string) {
  const instance = await discovery.discover('user-service');

  const response = await fetch(`http://${instance.address}:${instance.port}/api/v1/users/${userId}`, {
    headers: {
      'Authorization': `Bearer ${getCurrentToken()}`,
      'X-Request-ID': generateRequestId(),
      'X-Source-Service': 'learning-service'
    }
  });

  return response.json();
}
```

### 4.3 服务级限流与熔断

```typescript
import { CircuitBreaker } from 'opossum';

const options = {
  timeout: 3000,           // 超时时间
  errorThresholdPercentage: 50,  // 错误率阈值
  resetTimeout: 30000,     // 熔断重置时间
};

const breaker = new CircuitBreaker(asyncAIRequest, options);

breaker.on('open', () => {
  console.warn('AI 服务熔断器已打开');
});

breaker.on('halfOpen', () => {
  console.warn('AI 服务熔断器半开，尝试恢复');
});

async function callAIWithFallback(question: string) {
  try {
    return await breaker.fire(question);
  } catch (error) {
    // 降级策略：返回缓存答案或友好提示
    return {
      code: 10050,
      message: 'AI 服务暂时不可用，请稍后重试'
    };
  }
}
```

---

## 5. 接口文档自动化

### 5.1 OpenAPI 规范

```yaml
openapi: 3.0.0
info:
  title: PrimeTop API
  version: 1.0.0
  description: 全学段 AI 辅助学习软件 API 文档

servers:
  - url: https://api.primetop.cn/api/v1
    description: 生产环境
  - url: https://staging-api.primetop.cn/api/v1
    description: 测试环境

paths:
  /users/{id}:
    get:
      summary: 获取用户信息
      tags:
        - User
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        '200':
          description: 成功
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UserResponse'
        '404':
          description: 用户不存在
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'

components:
  schemas:
    UserResponse:
      type: object
      properties:
        code:
          type: integer
          example: 0
        message:
          type: string
          example: success
        data:
          $ref: '#/components/schemas/User'

    User:
      type: object
      properties:
        id:
          type: integer
        phone:
          type: string
        nickname:
          type: string
        avatar_url:
          type: string

    ErrorResponse:
      type: object
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
```

### 5.2 TypeScript 类型生成

```bash
# 使用 openapi-typescript 生成类型定义
npx openapi-typescript openapi.yaml -o src/types/api.d.ts
```

```typescript
// src/types/api.d.ts
export interface paths {
  '/users/{id}': {
    get: operations['getUser'];
  };
}

export interface components {
  schemas: {
    UserResponse: {
      code: number;
      message: string;
      data: User;
    };
    User: {
      id: number;
      phone: string;
      nickname?: string;
      avatar_url?: string;
    };
  };
}
```

### 5.3 客户端 SDK 生成

```bash
# 使用 openapi-generator 生成客户端 SDK
java -jar openapi-generator-cli.jar generate \
  -i openapi.yaml \
  -g typescript-axios \
  -o client-sdk
```

### 5.4 契约测试

```typescript
// tests/contract/users.spec.ts
import { validateResponse } from '@openapi-contracts/testing';
import { openapiSpec } from '../openapi';

describe('User API 契约测试', () => {
  it('GET /users/:id 应符合 OpenAPI 规范', async () => {
    const response = await request(app).get('/api/v1/users/123');

    expect(response.status).toBe(200);

    const result = validateResponse(response.body, {
      path: '/users/{id}',
      method: 'get',
      statusCode: 200,
      spec: openapiSpec
    });

    expect(result.valid).toBe(true);
  });
});
```

---

## 6. 安全加固

### 6.1 SQL 注入防护

```typescript
// 使用参数化查询
import { Pool } from 'pg';

const pool = new Pool();

async function getUserById(userId: string) {
  // ✅ 正确：参数化查询
  const result = await pool.query(
    'SELECT * FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0];

  // ❌ 错误：字符串拼接（SQL 注入风险）
  // const result = await pool.query(
  //   `SELECT * FROM users WHERE id = '${userId}'`
  // );
}
```

### 6.2 XSS 防护

```typescript
import DOMPurify from 'dompurify';

function sanitizeUserInput(input: string): string {
  // 清理 HTML 内容
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: ['b', 'i', 'u', 'strong', 'em'],
    ALLOWED_ATTR: []
  });
}
```

### 6.3 CSRF 防护

```typescript
import csrf from 'csurf';

const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    secure: true,        // 生产环境
    sameSite: 'strict'
  }
});

app.post('/api/v1/users', csrfProtection, (req, res) => {
  // 业务逻辑
});
```

### 6.4 敏感数据脱敏

```typescript
function maskPhone(phone: string): string {
  // 138****5678
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
}

function maskIdCard(idCard: string): string {
  // 110101********1234
  return idCard.replace(/(\d{6})\d{8}(\d{4})/, '$1********$2');
}
```

---

## 7. 性能优化

### 7.1 响应缓存

```yaml
# Kong 响应缓存插件
plugins:
  - name: proxy-cache
    route: user-api
    config:
      cache_ttl: 300              # 缓存 5 分钟
      strategy: memory
      request_method:
        - GET
        - HEAD
      cache_control: true
      storage_ttl: 600
```

### 7.2 Gzip 压缩

```yaml
plugins:
  - name: compression
    config:
      mime_types:
        - application/json
        - text/plain
        - text/html
        - text/css
        - application/javascript
      min_length: 1000
      level: 6
```

### 7.3 连接池配置

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  host: 'postgres',
  port: 5432,
  database: 'primetop',
  user: 'primetop',
  password: process.env.DB_PASSWORD,
  min: 5,                   // 最小连接数
  max: 20,                  // 最大连接数
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});
```

---

## 8. 错误处理最佳实践

### 8.1 全局错误处理中间件

```typescript
import { Request, Response, NextFunction } from 'express';
import { ApiError } from './errors';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  if (err instanceof ApiError) {
    // 业务错误
    return res.status(err.statusCode).json({
      code: err.code,
      message: err.message,
      data: null,
      errors: err.errors,
      meta: {
        timestamp: Date.now(),
        request_id: req.headers['x-request-id'],
        trace_id: req.headers['x-trace-id']
      }
    });
  }

  // 系统错误
  console.error('Unhandled error:', err);
  return res.status(500).json({
    code: 10050,
    message: '系统内部错误',
    data: null,
    meta: {
      timestamp: Date.now(),
      request_id: req.headers['x-request-id']
    }
  });
}
```

### 8.2 自定义错误类

```typescript
export class ApiError extends Error {
  public code: number;
  public statusCode: number;
  public errors?: any[];

  constructor(
    code: number,
    message: string,
    statusCode: number = 400,
    errors?: any[]
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

// 便捷方法
export class BadRequestError extends ApiError {
  constructor(message: string, errors?: any[]) {
    super(10000, message, 400, errors);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message: string = '未授权') {
    super(10021, message, 401);
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string) {
    super(10010, `${resource} 不存在`, 404);
  }
}

// 使用示例
throw new BadRequestError('手机号格式不正确', [
  {
    field: 'phone',
    message: '手机号格式不正确',
    code: 'INVALID_PHONE_FORMAT'
  }
]);
```

---

## 9. 接口版本管理策略

### 9.1 URL 路径版本

```http
/api/v1/users/123    # V1 版本
/api/v2/users/123    # V2 版本
```

**优点：**
- 清晰明确，易于理解
- 可独立部署不同版本

**缺点：**
- URL 变化需要客户端配合

### 9.2 请求头版本

```http
GET /api/users/123
Accept: application/vnd.primetop.v2+json
```

**优点：**
- URL 不变，向后兼容
- 版本控制更灵活

**缺点：**
- 实现复杂度较高
- 调试不太直观

### 9.3 推荐策略：混合使用

```
- 大版本变更（不兼容）：使用 URL 路径版本
  /api/v1/users → /api/v2/users

- 小版本变更（向后兼容）：使用查询参数
  /api/v1/users?version=1.1

- 实验性功能：使用 Feature Flag
  /api/v1/ai/chat?feature=multi_modal
```

---

## 10. 监控大盘设计

### 10.1 关键监控指标

```yaml
# Grafana Dashboard 配置

# 1. 请求总量
 panels:
   - title: API 请求总量 (QPS)
     targets:
       - expr: sum(rate(kong_http_status[1m])) by (route)

# 2. 响应时间
   - title: API 平均响应时间
     targets:
       - expr: avg(kong_latency_ms) by (route)

# 3. 错误率
   - title: API 错误率
     targets:
       - expr: sum(rate(kong_http_status{status=~"5.."}[1m])) / sum(rate(kong_http_status[1m]))

# 4. 限流触发
   - title: 限流触发次数
     targets:
       - expr: sum(rate(kong_request_blocked[1m]))

# 5. Top N 慢接口
   - title: Top 10 慢接口
     targets:
       - expr: topk(10, avg(kong_latency_ms) by (route))
```

### 10.2 告警规则

```yaml
groups:
  - name: api_gateway_alerts
    interval: 30s
    rules:
      # 错误率过高
      - alert: HighErrorRate
        expr: |
          sum(rate(kong_http_status{status=~"5.."}[5m]))
          /
          sum(rate(kong_http_status[5m])) > 0.05
        for: 5m
        annotations:
          summary: "API 错误率超过 5%"
          description: "路由 {{ $labels.route }} 错误率: {{ $value }}%"

      # 响应时间过长
      - alert: HighLatency
        expr: avg(kong_latency_ms) by (route) > 2000
        for: 5m
        annotations:
          summary: "API 响应时间超过 2s"
          description: "路由 {{ $labels.route }} 平均响应时间: {{ $value }}ms"

      # 限流触发
      - alert: RateLimitTriggered
        expr: rate(kong_request_blocked[1m]) > 100
        annotations:
          summary: "限流触发次数过多"
          description: "当前限流触发速率: {{ $value }}/s"
```

---

## 11. 实施检查清单

### 11.1 MVP 阶段（第 1 期）

- [x] API 网关基础部署（Kong）
- [x] 统一响应格式
- [x] JWT 认证插件
- [x] 基础限流插件
- [x] CORS 配置
- [x] 基础错误码体系
- [x] 日志记录

### 11.2 V1.0 阶段（第 2 期）

- [ ] OpenAPI 文档自动化
- [ ] 接口版本管理
- [ ] 灰度发布支持
- [ ] 链路追踪集成
- [ ] 监控大盘完善
- [ ] 告警规则配置
- [ ] 契约测试框架

### 11.3 V1.5 阶段（第 3 期）

- [ ] 服务间调用规范完善
- [ ] 熔断降级机制
- [ ] 响应缓存优化
- [ ] 请求/响应压缩
- [ ] 安全加固审计

---

## 附录 A：完整的错误码列表

### A.1 通用系统（100XX）

| 错误码 | HTTP 状态码 | 说明 | 解决建议 |
|--------|-----------|------|---------|
| 10000 | 400 | 请求参数错误 | 检查请求参数格式 |
| 10001 | 400 | 必填参数缺失 | 补充必填参数 |
| 10002 | 400 | 参数格式错误 | 修正参数格式 |
| 10003 | 400 | 参数值超出范围 | 调整参数值 |
| 10010 | 404 | 资源不存在 | 检查资源 ID |
| 10020 | 403 | 未授权访问 | 检查权限 |
| 10021 | 401 | 未登录 | 先登录 |
| 10022 | 403 | Token 过期 | 重新登录 |
| 10023 | 403 | Token 无效 | 重新登录 |
| 10030 | 409 | 资源冲突 | 检查资源状态 |
| 10031 | 429 | 请求过于频繁 | 降低请求频率 |
| 10040 | 502 | 第三方服务不可用 | 稍后重试 |
| 10050 | 500 | 系统内部错误 | 联系客服 |
| 10099 | 500 | 未知错误 | 联系客服 |

### A.2 认证授权（200XX）

| 错误码 | HTTP 状态码 | 说明 | 解决建议 |
|--------|-----------|------|---------|
| 20001 | 409 | 手机号已注册 | 使用其他手机号或登录 |
| 20002 | 400 | 验证码错误 | 重新输入验证码 |
| 20003 | 400 | 验证码已过期 | 重新获取验证码 |
| 20004 | 401 | 密码错误 | 重新输入密码 |
| 20005 | 401 | 账号已被禁用 | 联系客服 |

### A.3 用户管理（300XX）

| 错误码 | HTTP 状态码 | 说明 | 解决建议 |
|--------|-----------|------|---------|
| 30010 | 404 | 用户不存在 | 检查用户 ID |
| 30011 | 403 | 用户已被禁用 | 联系客服 |
| 30012 | 409 | 昵称已被占用 | 使用其他昵称 |
| 30013 | 403 | 无权限操作该用户 | 检查权限 |

### A.4 学习服务（400XX）

| 错误码 | HTTP 状态码 | 说明 | 解决建议 |
|--------|-----------|------|---------|
| 40010 | 404 | 学习记录不存在 | 检查记录 ID |
| 40020 | 403 | 已达到今日学习时长上限 | 稍后再学习 |
| 40030 | 403 | 权益不足 | 升级会员 |

### A.5 AI 服务（500XX）

| 错误码 | HTTP 状态码 | 说明 | 解决建议 |
|--------|-----------|------|---------|
| 50001 | 502 | AI 服务调用失败 | 稍后重试 |
| 50002 | 451 | AI 内容被安全拦截 | 检查提问内容 |
| 50003 | 429 | AI 调用额度不足 | 升级会员或等待重置 |
| 50004 | 503 | AI 服务繁忙 | 稍后重试 |

### A.6 题库服务（600XX）

| 错误码 | HTTP 状态码 | 说明 | 解决建议 |
|--------|-----------|------|---------|
| 60010 | 404 | 题目不存在 | 检查题目 ID |
| 60011 | 404 | 知识点不存在 | 检查知识点 ID |
| 60020 | 400 | 题目格式错误 | 检查题目格式 |

### A.7 支付服务（700XX）

| 错误码 | HTTP 状态码 | 说明 | 解决建议 |
|--------|-----------|------|---------|
| 70001 | 404 | 订单不存在 | 检查订单 ID |
| 70002 | 409 | 订单已支付 | 不要重复支付 |
| 70003 | 402 | 余额不足 | 充值后重试 |
| 70004 | 400 | 支付参数错误 | 检查支付参数 |
| 70005 | 502 | 支付渠道异常 | 稍后重试 |

### A.8 内容服务（800XX）

| 错误码 | HTTP 状态码 | 说明 | 解决建议 |
|--------|-----------|------|---------|
| 80010 | 404 | 内容不存在 | 检查内容 ID |
| 80011 | 403 | 内容无权限访问 | 检查权限 |
| 80012 | 403 | 内容需要会员权益 | 升级会员 |

### A.9 运营管理（900XX）

| 错误码 | HTTP 状态码 | 说明 | 解决建议 |
|--------|-----------|------|---------|
| 90010 | 403 | 无操作权限 | 检查角色权限 |
| 90020 | 409 | 操作冲突 | 稍后重试 |
| 90030 | 400 | 操作参数错误 | 检查操作参数 |

---

## 附录 B：接口命名规范

### B.1 资源命名

- 使用名词复数：`/users`, `/questions`, `/mistakes`
- 层级关系使用 `/` 分隔：`/users/123/questions`
- 关联资源使用查询参数：`/questions?subject=math&grade=小学三年级`

### B.2 接口命名示例

| 功能 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 获取用户列表 | GET | `/api/v1/users` | 分页查询 |
| 获取用户详情 | GET | `/api/v1/users/:id` | 单个用户 |
| 创建用户 | POST | `/api/v1/users` | 新建用户 |
| 更新用户 | PUT | `/api/v1/users/:id` | 完整更新 |
| 部分更新用户 | PATCH | `/api/v1/users/:id` | 部分字段 |
| 删除用户 | DELETE | `/api/v1/users/:id` | 删除用户 |
| 获取用户题目 | GET | `/api/v1/users/:id/questions` | 用户的题目 |
| 提交答案 | POST | `/api/v1/questions/:id/answers` | 提交答案 |

---

## 附录 C：测试用例示例

### C.1 获取用户信息测试

```typescript
describe('GET /api/v1/users/:id', () => {
  it('应返回用户信息', async () => {
    const response = await request(app)
      .get('/api/v1/users/1')
      .set('Authorization', `Bearer ${validToken}`)
      .expect(200);

    expect(response.body.code).toBe(0);
    expect(response.body.data.id).toBe(1);
    expect(response.body.data.phone).toBeDefined();
  });

  it('未登录应返回 401', async () => {
    const response = await request(app)
      .get('/api/v1/users/1')
      .expect(401);

    expect(response.body.code).toBe(10021);
  });

  it('用户不存在应返回 404', async () => {
    const response = await request(app)
      .get('/api/v1/users/99999')
      .set('Authorization', `Bearer ${validToken}`)
      .expect(404);

    expect(response.body.code).toBe(30010);
  });
});
```

### C.2 创建用户测试

```typescript
describe('POST /api/v1/users', () => {
  it('应创建用户', async () => {
    const userData = {
      phone: '13800138000',
      password: 'Test@123456',
      nickname: '测试用户'
    };

    const response = await request(app)
      .post('/api/v1/users')
      .send(userData)
      .expect(200);

    expect(response.body.code).toBe(0);
    expect(response.body.data.id).toBeDefined();
  });

  it('手机号已注册应返回 409', async () => {
    const userData = {
      phone: '13800138001',  // 已存在的手机号
      password: 'Test@123456',
      nickname: '测试用户'
    };

    const response = await request(app)
      .post('/api/v1/users')
      .send(userData)
      .expect(409);

    expect(response.body.code).toBe(20001);
  });

  it('参数错误应返回 400', async () => {
    const userData = {
      phone: 'invalid',  // 无效手机号
      password: '123',   // 密码过短
      nickname: '测试用户'
    };

    const response = await request(app)
      .post('/api/v1/users')
      .send(userData)
      .expect(400);

    expect(response.body.code).toBe(10000);
    expect(response.body.errors).toHaveLength(2);
  });
});
```