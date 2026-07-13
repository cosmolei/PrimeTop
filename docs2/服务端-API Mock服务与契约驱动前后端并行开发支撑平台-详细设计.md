# 服务端 - API Mock 服务与契约驱动前后端并行开发支撑平台 详细设计

## 1. 概述

### 1.1 模块定位

API Mock 平台是 PrimeTop 研发效率基础设施的核心组成部分。在前后端分离架构下，后端 API 尚未开发完成时，前端/客户端团队需要依赖 Mock 数据进行 UI 开发和联调。本平台基于 OpenAPI/Swagger 契约定义，自动生成高保真 Mock 响应，支持场景化数据、延迟模拟、错误注入等能力，打通前后端并行开发的完整链路。

### 1.2 核心职责

| 职责 | 说明 |
| --- | --- |
| 契约管理 | 统一管理 OpenAPI 3.0 规范文件，支持版本化和差异对比 |
| Mock 响应生成 | 基于契约自动生成符合 Schema 的 Mock 数据 |
| 场景化 Mock | 支持 success/error/timeout/boundary 等多种响应场景 |
| 动态数据生成 | 支持 Faker 规则、模板表达式和自定义数据工厂 |
| 录制与回放 | 代理真实 API 请求并录制响应，后续可回放复用 |
| 团队协作 | Mock 项目空间、权限控制和变更通知 |
| SDK 集成 | 提供客户端 SDK 无缝切换 Mock/真实环境 |

### 1.3 依赖关系

```
┌─────────────────────────────────────────────────────────┐
│                    Mock 平台架构                         │
│                                                         │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────┐    │
│  │ 契约管理  │──▶│ Mock 引擎 │──▶│  HTTP Mock Server │    │
│  │ (OpenAPI) │   │ (生成器)  │   │  (REST/GraphQL)  │    │
│  └──────────┘   └──────────┘   └──────────────────┘    │
│       │              │                    │              │
│       ▼              ▼                    ▼              │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────┐    │
│  │ 版本控制  │   │ 数据工厂  │   │  录制/回放代理    │    │
│  │ (Git集成) │   │ (Faker)  │   │  (Mitm/Proxy)    │    │
│  └──────────┘   └──────────┘   └──────────────────┘    │
│       │              │                    │              │
│       ▼              ▼                    ▼              │
│  ┌──────────────────────────────────────────────────┐   │
│  │            管理后台 (Web Dashboard)               │   │
│  │   项目空间 / 场景配置 / 变更通知 / 使用统计       │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**上游依赖：**
- API 网关与通用接口规范（提供 OpenAPI 基础规范）
- 接口文档自动化与契约测试规范（提供契约生成工具链）

**下游消费方：**
- 客户端团队（Flutter / Web / 小程序）
- 自动化测试团队（E2E 测试数据源）
- 服务端团队（API 契约验证）

---

## 2. 数据模型

### 2.1 核心实体 ER 图

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  MockProject    │1───*│  MockService     │1───*│  MockEndpoint   │
│  (Mock项目空间)  │     │  (服务定义)       │     │  (接口端点)      │
├─────────────────┤     ├──────────────────┤     ├─────────────────┤
│ id              │     │ id               │     │ id              │
│ name            │     │ project_id       │     │ service_id      │
│ description     │     │ name             │     │ method          │
│ base_url        │     │ openapi_spec_url │     │ path            │
│ owner_id        │     │ version          │     │ summary         │
│ team_id         │     │ status           │     │ tags            │
│ status          │     └──────────────────┘     └─────────────────┘
│ created_at      │              │                         │
└─────────────────┘              │ 1                       │ 1
       │ 1                       │                         │
       │                  ┌──────┴──────┐           ┌─────┴──────┐
       │                  │             │ *         │            │ *
┌──────┴──────┐    ┌──────┴─────────┐   │  ┌────────┴────────┐  │
│ MockMember  │    │ SpecVersion    │   │  │ MockScenario    │  │
│ (项目成员)   │    │ (规范版本)      │   │  │ (响应场景)       │  │
├─────────────┤    ├────────────────┤   │  ├─────────────────┤  │
│ id          │    │ id             │   │  │ id              │  │
│ project_id  │    │ service_id     │   │  │ endpoint_id     │  │
│ user_id     │    │ version_tag    │   │  │ name            │  │
│ role        │    │ spec_content   │   │  │ scenario_type   │  │
│ joined_at   │    │ checksum       │   │  │ http_status     │  │
└─────────────┘    │ published_by   │   │  │ response_body   │  │
                   │ created_at     │   │  │ response_headers│  │
                   └────────────────┘   │  │ delay_ms        │  │
                                        │  │ is_default      │  │
                                        │  │ conditions      │  │
                                        │  └─────────────────┘  │
                                        │           │            │
                                        │           │ 1          │
                                        │  ┌────────┴────────┐  │
                                        │  │ RecordReplay    │  │ *
                                        │  │ Session         │  │
                                        │  │ (录制回放会话)    │  │
                                        │  ├─────────────────┤  │
                                        │  │ id              │  │
                                        │  │ endpoint_id     │  │
                                        │  │ target_url      │  │
                                        │  │ status          │  │
                                        │  │ recording_data  │  │
                                        │  │ created_by      │  │
                                        │  │ expires_at      │  │
                                        │  └─────────────────┘  │
                                        └───────────────────────┘
```

### 2.2 数据库表结构

#### 2.2.1 mock_project

```sql
CREATE TABLE mock_project (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    name            VARCHAR(128) NOT NULL COMMENT '项目名称',
    description     VARCHAR(512) DEFAULT NULL COMMENT '项目描述',
    base_url        VARCHAR(256) NOT NULL COMMENT 'Mock服务基础URL，如 https://mock.primetop.cn/proj1',
    owner_id        BIGINT NOT NULL COMMENT '创建者用户ID',
    team_id         VARCHAR(64) DEFAULT NULL COMMENT '所属团队标识',
    status          TINYINT NOT NULL DEFAULT 1 COMMENT '状态: 0-归档, 1-活跃',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_base_url (base_url),
    KEY idx_owner (owner_id),
    KEY idx_team (team_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Mock项目空间';
```

#### 2.2.2 mock_service

```sql
CREATE TABLE mock_service (
    id                BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id        BIGINT NOT NULL COMMENT '所属项目ID',
    name              VARCHAR(128) NOT NULL COMMENT '服务名称，如 user-service',
    display_name      VARCHAR(256) DEFAULT NULL COMMENT '展示名称',
    openapi_spec_url  VARCHAR(512) DEFAULT NULL COMMENT 'OpenAPI规范文件URL',
    current_version   VARCHAR(32) DEFAULT NULL COMMENT '当前使用的规范版本',
    status            TINYINT NOT NULL DEFAULT 1 COMMENT '状态: 0-停用, 1-启用',
    auto_refresh      TINYINT NOT NULL DEFAULT 1 COMMENT '是否自动拉取最新规范: 0-否, 1-是',
    refresh_interval  INT DEFAULT 300 COMMENT '自动刷新间隔(秒)',
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_project (project_id),
    KEY idx_name (project_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Mock服务定义';
```

#### 2.2.3 spec_version

```sql
CREATE TABLE spec_version (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    service_id      BIGINT NOT NULL COMMENT '所属服务ID',
    version_tag     VARCHAR(64) NOT NULL COMMENT '版本标签，如 v1.2.0',
    spec_content    LONGTEXT NOT NULL COMMENT 'OpenAPI规范JSON内容',
    spec_format     VARCHAR(16) NOT NULL DEFAULT 'json' COMMENT '规范格式: json, yaml',
    checksum        VARCHAR(64) NOT NULL COMMENT '内容校验和(SHA-256)',
    diff_summary    TEXT DEFAULT NULL COMMENT '与上一版本的差异摘要',
    published_by    BIGINT NOT NULL COMMENT '发布者用户ID',
    is_active       TINYINT NOT NULL DEFAULT 1 COMMENT '是否当前活跃版本',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_service_version (service_id, version_tag),
    KEY idx_active (service_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='API规范版本';
```

#### 2.2.4 mock_endpoint

```sql
CREATE TABLE mock_endpoint (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    service_id      BIGINT NOT NULL COMMENT '所属服务ID',
    method          VARCHAR(10) NOT NULL COMMENT 'HTTP方法: GET/POST/PUT/DELETE/PATCH',
    path            VARCHAR(512) NOT NULL COMMENT '接口路径，如 /api/v1/users/{id}',
    summary         VARCHAR(256) DEFAULT NULL COMMENT '接口摘要',
    tags            JSON DEFAULT NULL COMMENT '标签数组',
    deprecated      TINYINT NOT NULL DEFAULT 0 COMMENT '是否已废弃',
    operation_id    VARCHAR(128) DEFAULT NULL COMMENT 'OpenAPI operationId',
    spec_ref        VARCHAR(512) DEFAULT NULL COMMENT '规范中的引用路径',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_endpoint (service_id, method, path),
    KEY idx_operation (operation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Mock接口端点';
```

#### 2.2.5 mock_scenario

```sql
CREATE TABLE mock_scenario (
    id                BIGINT PRIMARY KEY AUTO_INCREMENT,
    endpoint_id       BIGINT NOT NULL COMMENT '所属端点ID',
    name              VARCHAR(128) NOT NULL COMMENT '场景名称',
    scenario_type     VARCHAR(32) NOT NULL COMMENT '场景类型: success/error/timeout/boundary/custom',
    http_status       INT NOT NULL DEFAULT 200 COMMENT 'HTTP状态码',
    response_headers  JSON DEFAULT NULL COMMENT '响应头JSON',
    response_body     LONGTEXT DEFAULT NULL COMMENT '响应体(模板或固定值)',
    body_format       VARCHAR(16) NOT NULL DEFAULT 'json' COMMENT '响应体格式: json/xml/text/html/binary',
    delay_ms          INT NOT NULL DEFAULT 0 COMMENT '模拟延迟(毫秒)',
    is_default        TINYINT NOT NULL DEFAULT 0 COMMENT '是否为默认场景',
    priority          INT NOT NULL DEFAULT 0 COMMENT '匹配优先级(数字越大优先级越高)',
    match_conditions  JSON DEFAULT NULL COMMENT '触发条件规则JSON',
    dynamic_template  TINYINT NOT NULL DEFAULT 0 COMMENT '是否使用动态模板: 0-否, 1-是',
    tags              JSON DEFAULT NULL COMMENT '场景标签',
    created_by        BIGINT NOT NULL COMMENT '创建者',
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_endpoint (endpoint_id),
    KEY idx_default (endpoint_id, is_default),
    KEY idx_type (endpoint_id, scenario_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Mock响应场景';
```

#### 2.2.6 record_replay_session

```sql
CREATE TABLE record_replay_session (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    endpoint_id     BIGINT NOT NULL COMMENT '关联端点ID',
    target_url      VARCHAR(512) NOT NULL COMMENT '真实API目标地址',
    session_name    VARCHAR(128) DEFAULT NULL COMMENT '录制会话名称',
    status          VARCHAR(16) NOT NULL DEFAULT 'idle' COMMENT '状态: idle/recording/recorded/replaying/expired',
    recording_data  LONGTEXT DEFAULT NULL COMMENT '录制的请求-响应对JSON数组',
    record_count    INT NOT NULL DEFAULT 0 COMMENT '录制条目数',
    created_by      BIGINT NOT NULL COMMENT '创建者',
    expires_at      DATETIME DEFAULT NULL COMMENT '过期时间',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_endpoint (endpoint_id),
    KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='录制回放会话';
```

#### 2.2.7 mock_member

```sql
CREATE TABLE mock_member (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id      BIGINT NOT NULL COMMENT '项目ID',
    user_id         BIGINT NOT NULL COMMENT '用户ID',
    role            VARCHAR(32) NOT NULL DEFAULT 'viewer' COMMENT '角色: owner/editor/viewer',
    joined_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_project_user (project_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Mock项目成员';
```

#### 2.2.8 mock_access_log

```sql
CREATE TABLE mock_access_log (
    id              BIGINT BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id      BIGINT NOT NULL COMMENT '项目ID',
    endpoint_id     BIGINT DEFAULT NULL COMMENT '端点ID',
    method          VARCHAR(10) NOT NULL COMMENT 'HTTP方法',
    path            VARCHAR(512) NOT NULL COMMENT '请求路径',
    scenario_id     BIGINT DEFAULT NULL COMMENT '命中的场景ID',
    request_headers JSON DEFAULT NULL COMMENT '请求头',
    request_body    LONGTEXT DEFAULT NULL COMMENT '请求体',
    response_status INT DEFAULT NULL COMMENT '响应状态码',
    response_time   INT DEFAULT NULL COMMENT '响应时间(ms)',
    client_ip       VARCHAR(64) DEFAULT NULL COMMENT '客户端IP',
    user_agent      VARCHAR(256) DEFAULT NULL COMMENT 'User-Agent',
    client_tag      VARCHAR(64) DEFAULT NULL COMMENT '客户端标识(团队/个人)',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_project_time (project_id, created_at),
    KEY idx_endpoint (endpoint_id),
    KEY idx_client (client_tag)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Mock访问日志';
```

### 2.3 缓存策略

```typescript
// Redis 缓存键设计

// 1. 端点路由表缓存 — 路由匹配的高频查询
// Key: mock:routes:{projectId}
// Value: Hash { "GET:/api/v1/users/{id}" => endpointId }
// TTL: 300s (规范变更时主动失效)
const ROUTE_CACHE_KEY = (projectId: number) => `mock:routes:${projectId}`;
const ROUTE_CACHE_TTL = 300;

// 2. 场景列表缓存 — 每个端点的默认场景和自定义场景
// Key: mock:scenarios:{endpointId}
// Value: String (JSON序列化的场景列表)
// TTL: 120s (场景变更时主动失效)
const SCENARIO_CACHE_KEY = (endpointId: number) => `mock:scenarios:${endpointId}`;
const SCENARIO_CACHE_TTL = 120;

// 3. 动态数据工厂缓存 — Faker实例和自定义生成器
// Key: mock:factories:{projectId}
// Value: Hash { factoryName => compiledScript }
// TTL: 600s
const FACTORY_CACHE_KEY = (projectId: number) => `mock:factories:${projectId}`;
const FACTORY_CACHE_TTL = 600;

// 4. 录制会话缓存 — 回放数据热缓存
// Key: mock:replay:{sessionId}
// Value: List (JSON序列化的请求-响应对)
// TTL: 3600s
const REPLAY_CACHE_KEY = (sessionId: number) => `mock:replay:${sessionId}`;
const REPLAY_CACHE_TTL = 3600;

// 5. 限流计数器 — 按项目和客户端维度
// Key: mock:ratelimit:{projectId}:{clientTag}
// Value: String (计数器)
// TTL: 60s (滑动窗口)
const RATELIMIT_KEY = (projectId: number, clientTag: string) =>
    `mock:ratelimit:${projectId}:${clientTag}`;
const RATELIMIT_TTL = 60;
```

---

## 3. API 接口设计

### 3.1 接口总览

| 分组 | 接口 | 方法 | 说明 |
| --- | --- | --- | --- |
| 项目管理 | /api/v1/mock/projects | POST | 创建 Mock 项目 |
| 项目管理 | /api/v1/mock/projects/{id} | GET | 获取项目详情 |
| 项目管理 | /api/v1/mock/projects/{id} | PUT | 更新项目 |
| 项目管理 | /api/v1/mock/projects/{id}/members | GET | 获取成员列表 |
| 项目管理 | /api/v1/mock/projects/{id}/members | POST | 添加成员 |
| 服务管理 | /api/v1/mock/projects/{id}/services | POST | 注册服务（上传OpenAPI） |
| 服务管理 | /api/v1/mock/projects/{id}/services/{sid} | GET | 获取服务详情 |
| 服务管理 | /api/v1/mock/projects/{id}/services/{sid}/refresh | POST | 手动刷新规范 |
| 端点管理 | /api/v1/mock/services/{sid}/endpoints | GET | 获取端点列表 |
| 场景管理 | /api/v1/mock/endpoints/{eid}/scenarios | POST | 创建响应场景 |
| 场景管理 | /api/v1/mock/endpoints/{eid}/scenarios | GET | 获取场景列表 |
| 场景管理 | /api/v1/mock/scenarios/{sid} | PUT | 更新场景 |
| 场景管理 | /api/v1/mock/scenarios/{sid} | DELETE | 删除场景 |
| 场景管理 | /api/v1/mock/scenarios/{sid}/activate | POST | 设为默认场景 |
| 录制回放 | /api/v1/mock/endpoints/{eid}/record/start | POST | 开始录制 |
| 录制回放 | /api/v1/mock/endpoints/{eid}/record/stop | POST | 停止录制 |
| 录制回放 | /api/v1/mock/sessions/{sessionId}/replay/start | POST | 开始回放 |
| 统计 | /api/v1/mock/projects/{id}/stats | GET | 获取使用统计 |
| Mock入口 | /mock/{projectCode}/** | ALL | Mock请求实际入口 |

### 3.2 核心接口详细定义

#### 3.2.1 创建 Mock 项目

```
POST /api/v1/mock/projects
Authorization: Bearer {token}
Content-Type: application/json

Request:
{
    "name": "PrimeTop主客户端",
    "description": "Flutter客户端开发联调Mock空间",
    "team_id": "client-flutter",
    "base_url_path": "primetop-app"
}

Response 201:
{
    "code": 0,
    "data": {
        "id": 1001,
        "name": "PrimeTop主客户端",
        "base_url": "https://mock.primetop.cn/primetop-app",
        "owner_id": 50001,
        "status": 1,
        "created_at": "2026-06-29T13:00:00Z"
    }
}

Response 400 (参数校验失败):
{
    "code": 40001,
    "message": "项目名称不能为空",
    "details": [{"field": "name", "issue": "required"}]
}

Response 409 (URL冲突):
{
    "code": 40901,
    "message": "base_url_path 已被占用"
}
```

#### 3.2.2 注册服务（上传 OpenAPI 规范）

```
POST /api/v1/mock/projects/{projectId}/services
Authorization: Bearer {token}
Content-Type: multipart/form-data

Parameters:
- name: user-service (服务名称)
- spec_file: openapi.yaml (OpenAPI 3.0规范文件)
- auto_refresh: true
- spec_url: https://git.internal/primetop/api-specs/raw/main/user-service.yaml (可选，用于自动刷新)

Response 201:
{
    "code": 0,
    "data": {
        "id": 2001,
        "name": "user-service",
        "endpoint_count": 45,
        "current_version": "v1.0.0",
        "endpoints_sample": [
            {"method": "POST", "path": "/api/v1/auth/login"},
            {"method": "GET",  "path": "/api/v1/users/{id}"},
            {"method": "PUT",  "path": "/api/v1/users/{id}"}
        ],
        "parsed_at": "2026-06-29T13:05:00Z"
    }
}

Response 422 (规范解析失败):
{
    "code": 42201,
    "message": "OpenAPI规范解析失败",
    "details": [{
        "line": 42,
        "issue": "$.paths./api/v1/users/{id}.get.responses.200.content: missing schema"
    }]
}
```

#### 3.2.3 创建响应场景

```
POST /api/v1/mock/endpoints/{endpointId}/scenarios
Authorization: Bearer {token}
Content-Type: application/json

Request — 成功场景（动态模板）:
{
    "name": "获取用户信息-成功",
    "scenario_type": "success",
    "http_status": 200,
    "response_headers": {
        "Content-Type": "application/json"
    },
    "response_body": {
        "code": 0,
        "data": {
            "id": "{{request.path.id}}",
            "nickname": "{{faker.name.fullName}}",
            "avatar": "{{faker.image.avatar}}",
            "grade": "{{random.arrayElement(['一年级','二年级','三年级','四年级','五年级','六年级'])}}",
            "textbook_version": "{{random.arrayElement(['人教版','苏教版','北师大版'])}}",
            "membership": {
                "level": "{{random.arrayElement(['free','monthly','yearly'])}}",
                "expire_at": "{{date.future('yyyy-MM-dd')}}"
            },
            "created_at": "{{date.past('yyyy-MM-dd\\'T\\'HH:mm:ss\\'Z\\'')}}"
        }
    },
    "dynamic_template": true,
    "delay_ms": 200,
    "is_default": true,
    "match_conditions": null
}

Request — 错误场景（参数校验失败）:
{
    "name": "获取用户信息-用户不存在",
    "scenario_type": "error",
    "http_status": 404,
    "response_body": {
        "code": 40401,
        "message": "用户不存在",
        "request_id": "{{faker.string.uuid}}"
    },
    "dynamic_template": true,
    "delay_ms": 100,
    "match_conditions": {
        "rules": [
            {
                "type": "path_param",
                "field": "id",
                "operator": "equals",
                "value": "99999"
            }
        ],
        "logic": "AND"
    }
}

Request — 超时场景:
{
    "name": "获取用户信息-模拟超时",
    "scenario_type": "timeout",
    "http_status": 200,
    "response_body": null,
    "delay_ms": 30000,
    "match_conditions": {
        "rules": [
            {
                "type": "header",
                "field": "X-Mock-Scenario",
                "operator": "equals",
                "value": "timeout"
            }
        ]
    }
}

Response 201:
{
    "code": 0,
    "data": {
        "id": 3001,
        "name": "获取用户信息-成功",
        "is_default": true,
        "created_at": "2026-06-29T13:10:00Z"
    }
}
```

#### 3.2.4 Mock 请求入口（核心）

```
[ANY Method] /mock/{projectCode}{path}

Headers:
    X-Mock-Scenario: {scenarioName}     (可选) 指定场景
    X-Mock-Delay: {milliseconds}         (可选) 覆盖延迟
    X-Mock-No-Delay: true                (可选) 禁用延迟
    X-Mock-Client-Tag: {team/person}     (可选) 客户端标识

Example Request:
GET /mock/primetop-app/api/v1/users/12345
Host: mock.primetop.cn
X-Mock-Client-Tag: flutter-team

Matching Logic:
1. 解析 projectCode → projectId
2. 路由匹配 method + path → endpoint
3. 场景选择:
   a. 检查 X-Mock-Scenario header → 指定场景
   b. 检查 match_conditions → 条件场景（按 priority 降序）
   c. 回退到 is_default = true 的场景
4. 延迟执行: max(scenario.delay_ms, X-Mock-Delay)
5. 渲染响应模板
6. 返回响应

Example Response:
HTTP/1.1 200 OK
Content-Type: application/json
X-Mock-Scenario-Id: 3001
X-Mock-Scenario-Name: 获取用户信息-成功
X-Mock-Response-Time: 205ms

{
    "code": 0,
    "data": {
        "id": "12345",
        "nickname": "张三",
        "avatar": "https://example.com/avatar/xxx.png",
        "grade": "五年级",
        "textbook_version": "人教版",
        "membership": {
            "level": "yearly",
            "expire_at": "2027-01-15"
        },
        "created_at": "2025-09-01T08:30:00Z"
    }
}
```

#### 3.2.5 开始录制

```
POST /api/v1/mock/endpoints/{endpointId}/record/start
Authorization: Bearer {token}
Content-Type: application/json

Request:
{
    "target_base_url": "https://api-staging.primetop.cn",
    "session_name": "用户接口录制-20260629",
    "ttl_hours": 24
}

Response 200:
{
    "code": 0,
    "data": {
        "session_id": 5001,
        "status": "recording",
        "target_url": "https://api-staging.primetop.cn/api/v1/users",
        "proxy_url": "https://mock.primetop.cn/mock/primetop-app/api/v1/users",
        "instructions": "将请求指向 proxy_url，所有请求将转发至 target_url 并录制响应。使用 X-Mock-Record-Mode: off 可跳过录制。"
    }
}
```

#### 3.2.6 获取使用统计

```
GET /api/v1/mock/projects/{projectId}/stats?start_date=2026-06-22&end_date=2026-06-29
Authorization: Bearer {token}

Response 200:
{
    "code": 0,
    "data": {
        "project_id": 1001,
        "period": {"start": "2026-06-22", "end": "2026-06-29"},
        "summary": {
            "total_requests": 152834,
            "unique_endpoints_hit": 38,
            "avg_daily_requests": 19104,
            "avg_response_time_ms": 218,
            "error_scenario_hits": 8541,
            "top_client_tags": [
                {"tag": "flutter-team", "count": 89234},
                {"tag": "web-team", "count": 42103},
                {"tag": "qa-team", "count": 21497}
            ]
        },
        "top_endpoints": [
            {
                "method": "POST",
                "path": "/api/v1/ai/chat",
                "request_count": 34215,
                "avg_response_time_ms": 1500,
                "scenario_distribution": {
                    "success": 28900,
                    "error_rate_limit": 4215,
                    "timeout": 1100
                }
            },
            {
                "method": "GET",
                "path": "/api/v1/users/profile",
                "request_count": 21876,
                "avg_response_time_ms": 45
            }
        ],
        "timeline": [
            {"date": "2026-06-22", "count": 15234},
            {"date": "2026-06-23", "count": 18923},
            {"date": "2026-06-24", "count": 21045},
            {"date": "2026-06-25", "count": 19342},
            {"date": "2026-06-26", "count": 22891},
            {"date": "2026-06-27", "count": 25431},
            {"date": "2026-06-28", "count": 15968},
            {"date": "2026-06-29", "count": 14000}
        ]
    }
}
```

### 3.3 错误码定义

| 错误码 | HTTP状态 | 说明 |
| --- | --- | --- |
| 40001 | 400 | 请求参数校验失败 |
| 40101 | 401 | 未认证或Token过期 |
| 40301 | 403 | 无权限操作该项目 |
| 40401 | 404 | 项目/服务/端点不存在 |
| 40402 | 404 | Mock端点路由匹配失败（无匹配的接口定义） |
| 40403 | 404 | 场景未配置（端点存在但无默认场景） |
| 40901 | 409 | 资源冲突（base_url被占用等） |
| 42201 | 422 | OpenAPI规范解析失败 |
| 42202 | 422 | 动态模板语法错误 |
| 42203 | 422 | match_conditions 规则格式无效 |
| 42901 | 429 | Mock请求限流（超出项目QPS配额） |
| 50001 | 500 | Mock引擎内部错误 |
| 50002 | 500 | 录制代理转发失败 |

---

## 4. 业务逻辑

### 4.1 Mock 请求处理核心流程

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ HTTP Request │────▶│ Mock Gateway层    │────▶│ 项目路由解析     │
│ (任意方法)   │     │ (Nginx/Envoy)    │     │ projectCode→ID  │
└─────────────┘     └──────────────────┘     └────────┬────────┘
                                                       │
                     ┌─────────────────────────────────┘
                     ▼
              ┌──────────────────┐
              │ 端点路由匹配      │
              │ method+path匹配  │
              │ (支持路径参数)    │
              └────────┬─────────┘
                       │
               ┌───────┴───────┐
               │ 匹配成功？     │
               └───────┬───────┘
                  Yes  │  No → 返回 40402
                       ▼
              ┌──────────────────┐     ┌─────────────────┐
              │ 场景选择决策器    │────▶│ 1.Header指定场景 │
              │ (ScenarioPicker) │     │ 2.条件规则匹配   │
              └────────┬─────────┘     │ 3.默认场景       │
                       │               └─────────────────┘
                       ▼
              ┌──────────────────┐
              │ 延迟模拟器        │
              │ max(scenario,    │
              │ header override) │
              └────────┬─────────┘
                       │
              ┌────────┴─────────┐
              │ 动态模板渲染器    │
              │ (TemplateEngine) │
              └────────┬─────────┘
                       │
              ┌────────┴─────────┐
              │ 响应组装 & 返回   │
              │ + Mock追踪头     │
              └────────┬─────────┘
                       │
              ┌────────┴─────────┐
              │ 异步: 访问日志    │
              │ (写入消息队列)    │
              └──────────────────┘
```

### 4.2 场景选择决策器 — 状态流转

```
                    ┌──────────────────────┐
                    │  收到 Mock 请求       │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │ 检查 X-Mock-Scenario │
                    │ 请求头是否存在？      │
                    └──────────┬───────────┘
                          │           │
                       存在│           │不存在
                          ▼           ▼
               ┌─────────────────┐ ┌───────────────────────┐
               │ 按名称精确匹配   │ │ 遍历端点的条件场景     │
               │ scenario         │ │ (priority 降序)       │
               └────────┬────────┘ └───────────┬───────────┘
                        │                       │
               ┌────────▼────────┐     ┌────────▼───────────┐
               │ 匹配成功？       │     │ 条件规则求值       │
               │                 │     │ evaluateConditions()│
               └────────┬────────┘ └───────────┬───────────┘
                   │         │                  │
                成功│      失败│            匹配│  不匹配
                   ▼         │                  ▼
            ┌──────────┐     │     ┌──────────────────┐
            │ 使用该    │     │     │ 使用首个匹配场景  │
            │ 场景      │     │ ┌──▶│                  │
            └──────────┘     │ │   └────────┬─────────┘
                             │ │            │
                             │ │    ┌───────▼───────┐
                             └─────▶│ 匹配成功？     │
                                    └───────┬───────┘
                                       │         │
                                    成功│      失败│
                                       ▼         ▼
                               ┌──────────┐ ┌──────────────┐
                               │ 使用该    │ │ 回退到默认    │
                               │ 场景      │ │ 场景          │
                               └──────────┘ └──────┬───────┘
                                                   │
                                          ┌────────▼───────┐
                                          │ 默认场景存在？ │
                                          └────────┬───────┘
                                              │         │
                                           存在│      不存在
                                              ▼         ▼
                                        ┌──────────┐ ┌──────────┐
                                        │ 使用默认  │ │ 自动生成  │
                                        │ 场景      │ │ 默认响应  │
                                        └──────────┘ └──────────┘
```

### 4.3 OpenAPI 规范解析与端点自动注册

```
                    ┌──────────────────────────┐
                    │ 上传/更新 OpenAPI 规范    │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │ 1. 格式校验               │
                    │    - JSON/YAML语法       │
                    │    - OpenAPI 3.x结构     │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │ 2. 语义校验               │
                    │    - 路径格式合法性       │
                    │    - operationId唯一性   │
                    │    - Schema引用完整性    │
                    │    - HTTP方法合法性      │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │ 3. 解析提取               │
                    │    - paths → endpoints   │
                    │    - schemas → 数据模型   │
                    │    - examples → 示例数据   │
                    │    - parameters → 参数定义│
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │ 4. 差异计算               │
                    │    - 与前一版本对比       │
                    │    - 新增/删除/变更端点   │
                    │    - Schema变化检测      │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │ 5. 数据库同步             │
                    │    - 新端点: 插入+生成    │
                    │      默认成功场景         │
                    │    - 已有端点: 保留场景   │
                    │      但标记规范变更       │
                    │    - 删除端点: 标记废弃   │
                    │      保留30天后清理       │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │ 6. 事件通知               │
                    │    - Webhook → 项目成员  │
                    │    - 邮件/IM 通知        │
                    │    - changelog 记录      │
                    └──────────────────────────┘
```

### 4.4 录制回放状态机

```
    ┌────────┐  start录制   ┌───────────┐  stop录制   ┌──────────┐
    │  Idle  │─────────────▶│ Recording │───────────▶│ Recorded │
    └────────┘              └───────────┘            └──────────┘
         │                        │                       │
         │                        │ 异常/超时              │ replay
         │                        ▼                       │ start
         │                   ┌──────────┐                  │
         │                   │  Error   │                  ▼
         │                   ┌──────────┐            ┌──────────┐
         │                        │                  │Replaying │
         │                   手动重试                  └──────────┘
         │                        │                       │
         │                        └──────────────┐        │ stop
         │                                       │        │ replay
         ▼                                       ▼        ▼
    ┌─────────────┐                       ┌──────────────────┐
    │  Expired    │◀──────────────────────│  回到Recorded     │
    │ (TTL到期)    │    TTL到期            │  (可再次回放)     │
    └─────────────┘                       └──────────────────┘
```

---

## 5. 关键代码示例

### 5.1 项目技术栈

```yaml
# 技术选型
backend: Node.js 22 + TypeScript 5.x + NestJS
mock_engine: Fastify (高性能HTTP引擎)
spec_parser: @apidevtools/swagger-parser
template_engine: Handlebars + Faker.js (自定义扩展)
database: MySQL 8.0
cache: Redis 7.x
message_queue: RabbitMQ (日志异步写入)
frontend_dashboard: React + Ant Design + Monaco Editor
deployment: Docker + Kubernetes
```

### 5.2 Mock 请求处理核心

```typescript
// mock-engine/request-handler.ts

import { FastifyRequest, FastifyReply } from 'fastify';
import { RouteMatcher } from './route-matcher';
import { ScenarioPicker } from './scenario-picker';
import { TemplateEngine } from './template-engine';
import { DelaySimulator } from './delay-simulator';
import { AccessLogger } from './access-logger';
import { MockRequestContext, MockScenario, MatchResult } from './types';

export class MockRequestHandler {
    constructor(
        private routeMatcher: RouteMatcher,
        private scenarioPicker: ScenarioPicker,
        private templateEngine: TemplateEngine,
        private delaySimulator: DelaySimulator,
        private accessLogger: AccessLogger
    ) {}

    async handle(request: FastifyRequest, reply: FastifyReply): Promise<void> {
        const startTime = Date.now();
        const projectCode = (request.params as any).projectCode;
        const path = '/' + ((request.params as any)['*'] || '');
        const method = request.method;

        // Step 1: 构建请求上下文
        const ctx: MockRequestContext = {
            projectCode,
            method,
            path,
            headers: request.headers,
            query: request.query as Record<string, string>,
            body: request.body,
            pathParams: {},
        };

        try {
            // Step 2: 端点路由匹配
            const matchResult = await this.routeMatcher.match(ctx);
            if (!matchResult) {
                return this.sendNoMatchError(reply, ctx);
            }

            ctx.pathParams = matchResult.pathParams;
            ctx.endpointId = matchResult.endpoint.id;

            // Step 3: 场景选择
            const scenario = await this.scenarioPicker.pick(matchResult.endpoint, ctx);
            if (!scenario) {
                return this.sendNoScenarioError(reply, matchResult.endpoint);
            }

            // Step 4: 延迟模拟
            await this.delaySimulator.delay(scenario, ctx);

            // Step 5: 动态模板渲染
            const renderedResponse = await this.templateEngine.render(scenario, ctx);

            // Step 6: 组装响应头
            const responseHeaders = {
                ...scenario.responseHeaders,
                'X-Mock-Scenario-Id': String(scenario.id),
                'X-Mock-Scenario-Name': encodeURIComponent(scenario.name),
                'X-Mock-Response-Time': `${Date.now() - startTime}ms`,
            };

            // Step 7: 异步记录访问日志
            this.accessLogger.logAsync({
                projectCode,
                endpointId: ctx.endpointId,
                method,
                path,
                scenarioId: scenario.id,
                requestHeaders: ctx.headers,
                requestBody: ctx.body,
                responseStatus: scenario.httpStatus,
                responseTime: Date.now() - startTime,
                clientIp: request.ip,
                userAgent: request.headers['user-agent'] || '',
                clientTag: (ctx.headers['x-mock-client-tag'] as string) || '',
            });

            // Step 8: 返回响应
            reply.code(scenario.httpStatus).headers(responseHeaders).send(renderedResponse);

        } catch (error) {
            this.sendInternalError(reply, error, startTime);
        }
    }

    private sendNoMatchError(reply: FastifyReply, ctx: MockRequestContext): void {
        reply.code(404).headers({ 'X-Mock-Error': 'NO_MATCH' }).send({
            code: 40402,
            message: `Mock端点匹配失败: ${ctx.method} ${ctx.path}`,
            hint: '请检查请求路径是否在OpenAPI规范中定义',
            project: ctx.projectCode,
        });
    }

    private sendNoScenarioError(reply: FastifyReply, endpoint: any): void {
        reply.code(404).headers({ 'X-Mock-Error': 'NO_SCENARIO' }).send({
            code: 40403,
            message: `端点已定义但无响应场景: ${endpoint.method} ${endpoint.path}`,
            hint: '请在Mock管理后台为该端点配置至少一个响应场景',
        });
    }

    private sendInternalError(
        reply: FastifyReply,
        error: unknown,
        startTime: number
    ): void {
        const errMsg = error instanceof Error ? error.message : String(error);
        reply.code(500).headers({
            'X-Mock-Error': 'INTERNAL',
            'X-Mock-Response-Time': `${Date.now() - startTime}ms`,
        }).send({
            code: 50001,
            message: 'Mock引擎内部错误',
            detail: process.env.NODE_ENV === 'development' ? errMsg : undefined,
        });
    }
}
```

### 5.3 路由匹配器

```typescript
// mock-engine/route-matcher.ts

import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { MockEndpoint, MockRequestContext, MatchResult } from './types';
import { EndpointRepository } from '../repositories/endpoint.repository';

// 路径模板编译缓存: /api/v1/users/{id} → 正则
const pathTemplateCache = new Map<string, { regex: RegExp; paramNames: string[] }>();

/**
 * 路由匹配器 — 基于 OpenAPI 路径模板语法进行匹配
 * 支持 {param} 和 {param*} 通配符
 */
@Injectable()
export class RouteMatcher {
    constructor(
        private endpointRepo: EndpointRepository,
        @Inject(CACHE_MANAGER) private cache: Cache
    ) {}

    async match(ctx: MockRequestContext): Promise<MatchResult | null> {
        // 1. 获取项目所有端点路由表（带缓存）
        const routes = await this.getRouteTable(ctx.projectCode);
        if (!routes || routes.length === 0) {
            return null;
        }

        // 2. 先精确匹配 method + 完整路径
        const exactMatch = routes.find(
            r => r.method === ctx.method && r.path === ctx.path
        );
        if (exactMatch) {
            return { endpoint: exactMatch, pathParams: {} };
        }

        // 3. 模板匹配：遍历所有端点，用正则匹配
        for (const endpoint of routes) {
            if (endpoint.method !== ctx.method) continue;

            const compiled = this.compilePath(endpoint.path);
            const match = compiled.regex.exec(ctx.path);

            if (match) {
                const pathParams: Record<string, string> = {};
                compiled.paramNames.forEach((name, index) => {
                    pathParams[name] = decodeURIComponent(match[index + 1]);
                });
                return { endpoint, pathParams };
            }
        }

        return null;
    }

    private async getRouteTable(projectCode: string): Promise<MockEndpoint[]> {
        const cacheKey = `mock:routes:${projectCode}`;
        const cached = await this.cache.get<MockEndpoint[]>(cacheKey);
        if (cached) return cached;

        const endpoints = await this.endpointRepo.findByProjectCode(projectCode);
        await this.cache.set(cacheKey, endpoints, 300); // 5分钟缓存
        return endpoints;
    }

    /**
     * 编译 OpenAPI 路径模板为正则表达式
     * /api/v1/users/{id}           → /^\/api\/v1\/users\/([^\/]+)$/
     * /api/v1/files/{filePath*}    → /^\/api\/v1\/files\/(.+)$/
     */
    private compilePath(template: string): { regex: RegExp; paramNames: string[] } {
        const cached = pathTemplateCache.get(template);
        if (cached) return cached;

        const paramNames: string[] = [];
        let regexStr = template;

        // 匹配 {param*} 通配符 (贪婪匹配)
        regexStr = regexStr.replace(/\{(\w+)\*\}/g, (_, name) => {
            paramNames.push(name);
            return '(.+)';
        });

        // 匹配 {param} 普通参数 (非贪婪，不匹配/)
        regexStr = regexStr.replace(/\{(\w+)\}/g, (_, name) => {
            paramNames.push(name);
            return '([^/]+)';
        });

        // 转义其他特殊字符
        regexStr = regexStr.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        // 恢复被误转义的替换结果中的捕获组
        regexStr = regexStr.replace(/\\\((\[\^\/\]\+)\\\)/g, '($1)');
        regexStr = regexStr.replace(/\\\((\.\+)\\\)/g, '($1)');

        const regex = new RegExp(`^${regexStr}$`);
        const result = { regex, paramNames };
        pathTemplateCache.set(template, result);
        return result;
    }
}
```

### 5.4 场景选择器

```typescript
// mock-engine/scenario-picker.ts

import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { MockEndpoint, MockRequestContext, MockScenario } from './types';
import { ScenarioRepository } from '../repositories/scenario.repository';

@Injectable()
export class ScenarioPicker {
    constructor(
        private scenarioRepo: ScenarioRepository,
        @Inject(CACHE_MANAGER) private cache: Cache
    ) {}

    async pick(endpoint: MockEndpoint, ctx: MockRequestContext): Promise<MockScenario | null> {
        const scenarios = await this.getScenarios(ctx.endpointId!);
        if (scenarios.length === 0) return null;

        // 优先级 1: 通过 X-Mock-Scenario header 指定
        const headerScenarioName = ctx.headers['x-mock-scenario'] as string;
        if (headerScenarioName) {
            const matched = scenarios.find(
                s => s.name === headerScenarioName || s.scenario_type === headerScenarioName
            );
            if (matched) return matched;
        }

        // 优先级 2: 条件规则匹配 (按 priority 降序)
        const conditionalScenarios = scenarios
            .filter(s => s.match_conditions && Object.keys(s.match_conditions).length > 0)
            .sort((a, b) => b.priority - a.priority);

        for (const scenario of conditionalScenarios) {
            if (this.evaluateConditions(scenario.match_conditions!, ctx)) {
                return scenario;
            }
        }

        // 优先级 3: 默认场景
        const defaultScenario = scenarios.find(s => s.is_default);
        if (defaultScenario) return defaultScenario;

        // 兜底: 第一个 success 类型场景
        return scenarios.find(s => s.scenario_type === 'success') || scenarios[0];
    }

    /**
     * 条件规则求值引擎
     * 支持类型: path_param, query, header, body, method
     * 支持操作: equals, not_equals, contains, regex, in, gt, lt, exists
     */
    private evaluateConditions(conditions: any, ctx: MockRequestContext): boolean {
        const rules = conditions.rules || [];
        const logic = conditions.logic || 'AND';

        const results = rules.map((rule: any) => this.evaluateRule(rule, ctx));

        return logic === 'OR' ? results.some(Boolean) : results.every(Boolean);
    }

    private evaluateRule(rule: any, ctx: MockRequestContext): boolean {
        const sourceMap: Record<string, Record<string, any>> = {
            path_param: ctx.pathParams,
            query: ctx.query,
            header: ctx.headers,
            body: typeof ctx.body === 'object' ? ctx.body : {},
        };

        const source = sourceMap[rule.type];
        if (!source) return false;

        // 支持嵌套路径: "data.user.id" → 逐层取值
        const value = this.getNestedValue(source, rule.field);
        const target = rule.value;

        switch (rule.operator) {
            case 'equals':
                return String(value) === String(target);
            case 'not_equals':
                return String(value) !== String(target);
            case 'contains':
                return String(value ?? '').includes(String(target));
            case 'regex':
                return new RegExp(target).test(String(value ?? ''));
            case 'in':
                return Array.isArray(target) && target.includes(String(value));
            case 'gt':
                return Number(value) > Number(target);
            case 'lt':
                return Number(value) < Number(target);
            case 'exists':
                return value !== undefined && value !== null;
            default:
                return false;
        }
    }

    private getNestedValue(obj: Record<string, any>, path: string): any {
        return path.split('.').reduce((current, key) => {
            return current?.[key];
        }, obj);
    }

    private async getScenarios(endpointId: number): Promise<MockScenario[]> {
        const cacheKey = `mock:scenarios:${endpointId}`;
        const cached = await this.cache.get<MockScenario[]>(cacheKey);
        if (cached) return cached;

        const scenarios = await this.scenarioRepo.findByEndpointId(endpointId);
        await this.cache.set(cacheKey, scenarios, 120);
        return scenarios;
    }
}
```

### 5.5 动态模板渲染引擎

```typescript
// mock-engine/template-engine.ts

import { MockRequestContext, MockScenario } from './types';
import { DataFactoryRegistry } from './data-factories';

/**
 * 动态模板渲染引擎
 *
 * 支持以下模板语法:
 * 1. {{request.path.id}}          — 引用请求路径参数
 * 2. {{request.query.name}}       — 引用请求查询参数
 * 3. {{request.header.Authorization}} — 引用请求头
 * 4. {{request.body.field}}       — 引用请求体字段
 * 5. {{faker.name.fullName}}      — Faker 数据生成
 * 6. {{random.arrayElement([...])}} — 随机数组元素
 * 7. {{date.future('yyyy-MM-dd')}}— 未来日期
 * 8. {{date.past('yyyy-MM-dd')}}  — 过去日期
 * 9. {{counter.increment}}        — 自增计数器
 * 10. {{uuid}}                    — UUID生成
 */
export class TemplateEngine {
    private counter: Map<string, number> = new Map();

    constructor(private dataFactories: DataFactoryRegistry) {}

    async render(scenario: MockScenario, ctx: MockRequestContext): Promise<any> {
        if (!scenario.dynamic_template) {
            return scenario.response_body;
        }

        const bodyStr = typeof scenario.response_body === 'string'
            ? scenario.response_body
            : JSON.stringify(scenario.response_body);

        const rendered = await this.renderTemplate(bodyStr, ctx);
        return scenario.body_format === 'json'
            ? JSON.parse(rendered)
            : rendered;
    }

    private async renderTemplate(template: string, ctx: MockRequestContext): Promise<string> {
        // 1. 渲染 request 引用
        let result = template.replace(
            /\{\{request\.(\w+)\.(\w+(?:\.\w+)*)\}\}/g,
            (_, location, field) => {
                const source: Record<string, any> = {
                    path: ctx.pathParams,
                    query: ctx.query,
                    header: ctx.headers,
                    body: ctx.body || {},
                };
                return this.getNestedValueString(source[location] || {}, field);
            }
        );

        // 2. 渲染 faker 数据
        result = result.replace(
            /\{\{faker\.(\w+)\.(\w+)\}\}/g,
            (_, namespace, method) => {
                return this.dataFactories.faker(namespace, method);
            }
        );

        // 3. 渲染 random 函数
        result = result.replace(
            /\{\{random\.arrayElement\((\[.*?\])\)\}\}/g,
            (_, arrayStr) => {
                try {
                    const arr = JSON.parse(arrayStr);
                    return arr[Math.floor(Math.random() * arr.length)];
                } catch {
                    return '';
                }
            }
        );

        result = result.replace(
            /\{\{random\.int\((\d+),(\d+)\)\}\}/g,
            (_, min, max) => {
                const minN = parseInt(min);
                const maxN = parseInt(max);
                return String(Math.floor(Math.random() * (maxN - minN + 1)) + minN);
            }
        );

        result = result.replace(
            /\{\{random\.float\(([\d.]+),([\d.]+)\)\}\}/g,
            (_, min, max) => {
                return (Math.random() * (parseFloat(max) - parseFloat(min)) + parseFloat(min)).toFixed(2);
            }
        );

        // 4. 渲染 date 函数
        result = result.replace(
            /\{\{date\.future\('([^']+)'\)\}\}/g,
            (_, format) => {
                const future = new Date(Date.now() + Math.random() * 365 * 24 * 60 * 60 * 1000);
                return this.formatDate(future, format);
            }
        );

        result = result.replace(
            /\{\{date\.past\('([^']+)'\)\}\}/g,
            (_, format) => {
                const past = new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000);
                return this.formatDate(past, format);
            }
        );

        result = result.replace(
            /\{\{date\.now\('([^']+)'\)\}\}/g,
            (_, format) => {
                return this.formatDate(new Date(), format);
            }
        );

        // 5. 渲染 counter
        result = result.replace(
            /\{\{counter\.increment(?::(\w+))?\}\}/g,
            (_, key) => {
                const counterKey = key || 'default';
                const current = (this.counter.get(counterKey) || 0) + 1;
                this.counter.set(counterKey, current);
                return String(current);
            }
        );

        // 6. 渲染 UUID
        result = result.replace(
            /\{\{uuid\}\}/g,
            () => crypto.randomUUID()
        );

        return result;
    }

    private getNestedValueString(obj: Record<string, any>, path: string): string {
        const value = path.split('.').reduce((current, key) => current?.[key], obj);
        return value !== undefined && value !== null ? String(value) : '';
    }

    private formatDate(date: Date, format: string): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');

        return format
            .replace('yyyy', String(year))
            .replace('MM', month)
            .replace('dd', day)
            .replace('HH', hours)
            .replace('mm', minutes)
            .replace('ss', seconds);
    }
}
```

### 5.6 OpenAPI 规范解析器

```typescript
// spec-parser/openapi-parser.ts

import SwaggerParser from '@apidevtools/swagger-parser';
import { OpenAPIV3 } from 'openapi-types';
import { ParsedEndpoint, ParseResult, SpecDiff } from './types';
import { createHash } from 'crypto';

export class OpenApiParser {
    /**
     * 解析 OpenAPI 3.x 规范文件
     */
    async parse(specInput: string | object, format: 'json' | 'yaml' = 'json'): Promise<ParseResult> {
        // 1. 格式转换 & 基础验证
        const specObj = typeof specInput === 'string'
            ? this.parseString(specInput, format)
            : specInput;

        // 2. 使用 SwaggerParser 进行深度验证和 $ref 解析
        const validated = await SwaggerParser.validate(specObj as any, {
            continueOnError: false,
        }) as OpenAPIV3.Document;

        // 3. 提取端点
        const endpoints = this.extractEndpoints(validated);

        // 4. 提取数据模型 (用于自动生成默认Mock数据)
        const schemas = this.extractSchemas(validated);

        // 5. 提取示例数据
        const examples = this.extractExamples(validated);

        // 6. 生成校验和
        const checksum = this.generateChecksum(specInput);

        return {
            success: true,
            document: validated,
            endpoints,
            schemas,
            examples,
            checksum,
            stats: {
                endpoint_count: endpoints.length,
                schema_count: Object.keys(schemas).length,
                example_count: Object.keys(examples).length,
            },
        };
    }

    private extractEndpoints(doc: OpenAPIV3.Document): ParsedEndpoint[] {
        const endpoints: ParsedEndpoint[] = [];
        const paths = doc.paths || {};

        for (const [path, pathItem] of Object.entries(paths)) {
            if (!pathItem) continue;

            const methods: (keyof OpenAPIV3.PathItemObject)[] = [
                'get', 'post', 'put', 'delete', 'patch', 'head', 'options'
            ];

            for (const method of methods) {
                const operation = (pathItem as any)[method] as OpenAPIV3.OperationObject | undefined;
                if (!operation) continue;

                endpoints.push({
                    method: method.toUpperCase(),
                    path: path,
                    summary: operation.summary || '',
                    operationId: operation.operationId || `${method}_${path}`,
                    tags: operation.tags || [],
                    deprecated: operation.deprecated || false,
                    parameters: this.extractParameters(operation, pathItem as OpenAPIV3.PathItemObject),
                    requestBody: operation.requestBody,
                    responses: operation.responses,
                });
            }
        }

        return endpoints;
    }

    private extractParameters(
        operation: OpenAPIV3.OperationObject,
        pathItem: OpenAPIV3.PathItemObject
    ): OpenAPIV3.ParameterObject[] {
        const params = [
            ...(pathItem.parameters || []),
            ...(operation.parameters || []),
        ];
        // 去重 (path级别和operation级别可能重复)
        const seen = new Set<string>();
        return params.filter(p => {
            const key = `${p.name}:${p.in}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }) as OpenAPIV3.ParameterObject[];
    }

    private extractSchemas(doc: OpenAPIV3.Document): Record<string, OpenAPIV3.SchemaObject> {
        const components = doc.components?.schemas || {};
        const result: Record<string, OpenAPIV3.SchemaObject> = {};

        for (const [name, schema] of Object.entries(components)) {
            if (!(schema as any).$ref) {
                result[name] = schema as OpenAPIV3.SchemaObject;
            }
        }

        return result;
    }

    private extractExamples(doc: OpenAPIV3.Document): Record<string, any> {
        const examples: Record<string, any> = {};
        const components = doc.components?.examples || {};

        for (const [name, example] of Object.entries(components)) {
            const ex = example as OpenAPIV3.ExampleObject;
            if (ex.value) {
                examples[name] = ex.value;
            }
        }

        return examples;
    }

    /**
     * 自动为 Schema 生成默认 Mock 数据
     */
    generateDefaultMockData(schema: OpenAPIV3.SchemaObject, depth = 0): any {
        if (depth > 10) return null; // 防止无限递归

        // 处理 $ref (已被 SwaggerParser 解析为内联)
        if ((schema as any).$ref) {
            return null;
        }

        // 处理 enum
        if (schema.enum && schema.enum.length > 0) {
            return schema.enum[0];
        }

        // 处理 example
        if (schema.example !== undefined) {
            return schema.example;
        }

        // 处理 default
        if (schema.default !== undefined) {
            return schema.default;
        }

        switch (schema.type) {
            case 'string':
                return this.generateMockString(schema);
            case 'integer':
            case 'number':
                return schema.minimum !== undefined
                    ? schema.minimum
                    : 0;
            case 'boolean':
                return true;
            case 'array':
                return schema.items
                    ? [this.generateDefaultMockData(schema.items as OpenAPIV3.SchemaObject, depth + 1)]
                    : [];
            case 'object':
                const result: Record<string, any> = {};
                const properties = schema.properties || {};
                for (const [key, propSchema] of Object.entries(properties)) {
                    result[key] = this.generateDefaultMockData(propSchema as OpenAPIV3.SchemaObject, depth + 1);
                }
                return result;
            default:
                return null;
        }
    }

    private generateMockString(schema: OpenAPIV3.SchemaObject): string {
        const format = schema.format || '';
        switch (format) {
            case 'date-time':
                return new Date().toISOString();
            case 'date':
                return new Date().toISOString().split('T')[0];
            case 'email':
                return 'user@example.com';
            case 'uuid':
                return crypto.randomUUID();
            case 'phone':
                return '13800138000';
            default:
                if (schema.pattern) {
                    return '<pattern>'; // 简化处理
                }
                return schema.description || 'mock-string';
        }
    }

    /**
     * 计算两个版本之间的差异
     */
    diffSpecs(oldEndpoints: ParsedEndpoint[], newEndpoints: ParsedEndpoint[]): SpecDiff {
        const oldMap = new Map(oldEndpoints.map(e => [`${e.method}:${e.path}`, e]));
        const newMap = new Map(newEndpoints.map(e => [`${e.method}:${e.path}`, e]));

        const added: ParsedEndpoint[] = [];
        const removed: ParsedEndpoint[] = [];
        const changed: { endpoint: ParsedEndpoint; changes: string[] }[] = [];

        // 新增端点
        for (const [key, endpoint] of newMap) {
            if (!oldMap.has(key)) {
                added.push(endpoint);
            }
        }

        // 删除端点
        for (const [key, endpoint] of oldMap) {
            if (!newMap.has(key)) {
                removed.push(endpoint);
            }
        }

        // 变更端点 (检查 operationId / summary / 参数等)
        for (const [key, newEndpoint] of newMap) {
            const oldEndpoint = oldMap.get(key);
            if (!oldEndpoint) continue;

            const changes: string[] = [];
            if (oldEndpoint.operationId !== newEndpoint.operationId) {
                changes.push(`operationId: ${oldEndpoint.operationId} → ${newEndpoint.operationId}`);
            }
            if (oldEndpoint.summary !== newEndpoint.summary) {
                changes.push(`summary 变更`);
            }
            if (oldEndpoint.parameters.length !== newEndpoint.parameters.length) {
                changes.push(`参数数量: ${oldEndpoint.parameters.length} → ${newEndpoint.parameters.length}`);
            }

            if (changes.length > 0) {
                changed.push({ endpoint: newEndpoint, changes });
            }
        }

        return { added, removed, changed };
    }

    private parseString(input: string, format: 'json' | 'yaml'): object {
        if (format === 'yaml') {
            const yaml = require('js-yaml');
            return yaml.load(input);
        }
        return JSON.parse(input);
    }

    private generateChecksum(content: string | object): string {
        const str = typeof content === 'string' ? content : JSON.stringify(content);
        return createHash('sha256').update(str).digest('hex');
    }
}
```

### 5.7 录制回放代理

```typescript
// record-replay/recording-proxy.ts

import { FastifyRequest, FastifyReply } from 'fastify';
import { RecordReplaySession, RecordedExchange } from './types';

export class RecordingProxy {
    /**
     * 代理请求到真实API，并录制请求-响应对
     */
    async proxyAndRecord(
        request: FastifyRequest,
        reply: FastifyReply,
        session: RecordReplaySession
    ): Promise<void> {
        const targetUrl = this.buildTargetUrl(session.target_url, request);

        // 检查是否跳过录制
        const skipHeader = request.headers['x-mock-record-mode'] as string;
        if (skipHeader === 'off') {
            // 直接代理不录制
            return this.proxyOnly(request, reply, targetUrl);
        }

        const exchange: RecordedExchange = {
            timestamp: Date.now(),
            method: request.method,
            path: request.url,
            request_headers: this.sanitizeHeaders(request.headers),
            request_body: request.body,
            response_status: 0,
            response_headers: {},
            response_body: null,
        };

        try {
            // 转发请求到真实API
            const response = await fetch(targetUrl, {
                method: request.method,
                headers: this.forwardHeaders(request.headers),
                body: request.body ? JSON.stringify(request.body) : undefined,
            });

            const responseText = await response.text();
            let responseJson: any = null;
            try { responseJson = JSON.parse(responseText); } catch {}

            exchange.response_status = response.status;
            exchange.response_headers = Object.fromEntries(response.headers.entries());
            exchange.response_body = responseJson || responseText;

            // 录制到会话
            session.recording_data.push(exchange);
            session.record_count++;

            // 返回真实响应给客户端
            reply.code(response.status);
            response.headers.forEach((value, key) => reply.header(key, value));
            reply.header('X-Mock-Record', 'captured');
            reply.send(responseText);

        } catch (error) {
            exchange.response_status = 502;
            exchange.response_body = {
                error: 'PROXY_ERROR',
                message: error instanceof Error ? error.message : String(error),
            };
            session.recording_data.push(exchange);

            reply.code(502).send({
                code: 50002,
                message: '录制代理转发失败',
                target_url: targetUrl,
                detail: exchange.response_body,
            });
        }
    }

    /**
     * 回放已录制的请求-响应对
     */
    async replay(
        request: FastifyRequest,
        reply: FastifyReply,
        session: RecordReplaySession
    ): Promise<void> {
        // 匹配录制的请求
        const matched = session.recording_data.find(
            ex => ex.method === request.method && this.pathMatches(ex.path, request.url)
        );

        if (!matched) {
            reply.code(404).header('X-Mock-Replay', 'no-match').send({
                code: 40402,
                message: `回放会话中无匹配的录制记录: ${request.method} ${request.url}`,
                available_count: session.record_count,
            });
            return;
        }

        // 模拟延迟 (使用录制时的真实延迟或配置值)
        const delay = matched.response_headers['x-response-time']
            ? parseInt(matched.response_headers['x-response-time'])
            : 200;
        await new Promise(resolve => setTimeout(resolve, Math.min(delay, 5000)));

        reply.code(matched.response_status);
        Object.entries(matched.response_headers).forEach(([key, value]) => {
            reply.header(key, value as string);
        });
        reply.header('X-Mock-Replay', 'matched');
        reply.send(matched.response_body);
    }

    private async proxyOnly(
        request: FastifyRequest,
        reply: FastifyReply,
        targetUrl: string
    ): Promise<void> {
        const response = await fetch(targetUrl, {
            method: request.method,
            headers: this.forwardHeaders(request.headers),
            body: request.body ? JSON.stringify(request.body) : undefined,
        });

        const body = await response.text();
        reply.code(response.status);
        response.headers.forEach((value, key) => reply.header(key, value));
        reply.send(body);
    }

    private buildTargetUrl(baseUrl: string, request: FastifyRequest): string {
        const url = new URL(baseUrl);
        url.pathname = request.url.replace(/^\/mock\/[^/]+/, '');
        url.search = '';
        return url.toString();
    }

    private sanitizeHeaders(headers: Record<string, any>): Record<string, string> {
        const sanitized = { ...headers };
        // 移除敏感头信息
        delete sanitized['authorization'];
        delete sanitized['cookie'];
        return sanitized as Record<string, string>;
    }

    private forwardHeaders(headers: Record<string, any>): Record<string, string> {
        const forwarded = { ...headers } as Record<string, string>;
        delete forwarded['host'];
        delete forwarded['x-mock-scenario'];
        delete forwarded['x-mock-delay'];
        delete forwarded['x-mock-record-mode'];
        return forwarded;
    }

    private pathMatches(recordedPath: string, requestPath: string): boolean {
        // 去除query参数后比较路径
        const r = recordedPath.split('?')[0];
        const p = requestPath.split('?')[0];
        return r === p || r.endsWith(p) || p.endsWith(r);
    }
}
```

### 5.8 客户端 SDK — 环境切换器

```dart
// Flutter客户端: lib/core/network/mock_env_switcher.dart

import 'package:dio/dio.dart';

/// Mock环境切换器
/// 开发环境下可一键切换真实API和Mock服务
class MockEnvSwitcher {
  static const _mockBaseUrl = 'https://mock.primetop.cn/primetop-app';
  static const _stagingBaseUrl = 'https://api-staging.primetop.cn';
  static const _prodBaseUrl = 'https://api.primetop.cn';

  /// 当前环境
  static ApiEnvironment _currentEnv = ApiEnvironment.staging;

  /// Mock场景覆写 (可选)
  static String? _scenarioOverride;

  /// 获取当前Base URL
  static String get baseUrl {
    switch (_currentEnv) {
      case ApiEnvironment.mock:
        return _mockBaseUrl;
      case ApiEnvironment.staging:
        return _stagingBaseUrl;
      case ApiEnvironment.production:
        return _prodBaseUrl;
    }
  }

  /// 切换环境
  static void switchTo(ApiEnvironment env) {
    _currentEnv = env;
    _scenarioOverride = null;
    // 通知Dio实例更新baseUrl
    _notifyEnvironmentChanged();
  }

  /// 指定Mock场景
  static void setMockScenario(String scenarioName) {
    assert(_currentEnv == ApiEnvironment.mock, '只能在Mock环境下设置场景');
    _scenarioOverride = scenarioName;
  }

  /// 应用拦截器: 注入Mock相关Header
  static void applyInterceptor(Dio dio) {
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          if (_currentEnv == ApiEnvironment.mock) {
            options.baseUrl = _mockBaseUrl;
            if (_scenarioOverride != null) {
              options.headers['X-Mock-Scenario'] = _scenarioOverride;
            }
            // 开发标识
            options.headers['X-Mock-Client-Tag'] = 'flutter-dev';
            // 禁用延迟(开发调试时)
            if (_disableDelay) {
              options.headers['X-Mock-No-Delay'] = 'true';
            }
          }
          handler.next(options);
        },
      ),
    );
  }

  static bool _disableDelay = false;

  static void setDisableDelay(bool value) {
    _disableDelay = value;
  }

  static ApiEnvironment get currentEnv => _currentEnv;

  static final List<void Function()> _listeners = [];

  static void addListener(void Function() callback) {
    _listeners.add(callback);
  }

  static void _notifyEnvironmentChanged() {
    for (final callback in _listeners) {
      callback();
    }
  }
}

enum ApiEnvironment {
  mock,
  staging,
  production,
}
```

---

## 6. OpenAPI 规范到默认场景的自动生成

### 6.1 自动生成规则

当上传新的 OpenAPI 规范后，系统自动为每个端点生成默认场景：

```typescript
// spec-parser/default-scenario-generator.ts

import { OpenAPIV3 } from 'openapi-types';
import { OpenApiParser } from './openapi-parser';

export class DefaultScenarioGenerator {
    constructor(private parser: OpenApiParser) {}

    /**
     * 为端点生成默认场景集合
     */
    generate(endpoint: ParsedEndpoint): GeneratedScenario[] {
        const scenarios: GeneratedScenario[] = [];

        // 1. 成功场景 (基于200/201响应)
        const successResponse = this.findSuccessResponse(endpoint);
        if (successResponse) {
            scenarios.push({
                name: '默认成功',
                scenario_type: 'success',
                http_status: successResponse.statusCode,
                response_body: this.generateResponseJson(successResponse.schema),
                response_headers: { 'Content-Type': 'application/json' },
                delay_ms: this.estimateDelay(endpoint),
                is_default: true,
                dynamic_template: true,
            });
        }

        // 2. 参数校验错误场景
        scenarios.push({
            name: '参数校验错误',
            scenario_type: 'error',
            http_status: 400,
            response_body: {
                code: 40001,
                message: '请求参数校验失败',
                details: [{ field: 'example_field', issue: 'required' }],
            },
            delay_ms: 50,
        });

        // 3. 未认证场景
        scenarios.push({
            name: '未认证',
            scenario_type: 'error',
            http_status: 401,
            response_body: {
                code: 40101,
                message: 'Token无效或已过期',
            },
            delay_ms: 50,
        });

        // 4. 权限不足场景
        scenarios.push({
            name: '权限不足',
            scenario_type: 'error',
            http_status: 403,
            response_body: {
                code: 40301,
                message: '无权限执行此操作',
            },
            delay_ms: 50,
        });

        // 5. 资源不存在场景
        if (endpoint.path.includes('{')) {
            scenarios.push({
                name: '资源不存在',
                scenario_type: 'error',
                http_status: 404,
                response_body: {
                    code: 40401,
                    message: '请求的资源不存在',
                },
                delay_ms: 50,
            });
        }

        return scenarios;
    }

    private findSuccessResponse(endpoint: ParsedEndpoint): SuccessResponse | null {
        const responses = endpoint.responses || {};
        // 优先找200, 其次201
        for (const code of ['200', '201']) {
            const response = responses[code];
            if (response) {
                const jsonContent = (response as any).content?.['application/json'];
                if (jsonContent?.schema) {
                    return {
                        statusCode: parseInt(code),
                        schema: jsonContent.schema,
                    };
                }
            }
        }
        return null;
    }

    private generateResponseJson(schema: any): any {
        // 委托给 OpenApiParser 的 generateDefaultMockData
        return this.parser.generateDefaultMockData(schema);
    }

    private estimateDelay(endpoint: ParsedEndpoint): number {
        // AI相关接口延迟高
        const path = endpoint.path.toLowerCase();
        if (path.includes('/ai/') || path.includes('/chat') || path.includes('/ocr')) {
            return 1500;
        }
        if (endpoint.method === 'GET') {
            return 100;
        }
        return 200;
    }
}
```

---

## 7. 延迟模拟与网络状况模拟

### 7.1 延迟模拟器

```typescript
// mock-engine/delay-simulator.ts

import { MockScenario, MockRequestContext } from './types';

export class DelaySimulator {
    /**
     * 根据场景和请求上下文执行延迟
     */
    async delay(scenario: MockScenario, ctx: MockRequestContext): Promise<void> {
        // Header 覆盖检查
        const noDelay = ctx.headers['x-mock-no-delay'] === 'true';
        if (noDelay) return;

        const overrideDelay = parseInt(ctx.headers['x-mock-delay'] as string);
        if (!isNaN(overrideDelay)) {
            await this.sleep(overrideDelay);
            return;
        }

        if (scenario.delay_ms > 0) {
            // 添加 ±20% 随机抖动，模拟真实网络波动
            const jitter = scenario.delay_ms * 0.2;
            const actualDelay = scenario.delay_ms + (Math.random() - 0.5) * 2 * jitter;
            await this.sleep(Math.max(0, Math.round(actualDelay)));
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
```

### 7.2 网络状况预设

```typescript
// 预设的网络延迟配置
export const NETWORK_PROFILES = {
    wifi_fast:      { delay_ms: 30,  jitter: 5,   loss_rate: 0 },
    wifi_normal:    { delay_ms: 100, jitter: 20,  loss_rate: 0 },
    cellular_4g:    { delay_ms: 150, jitter: 40,  loss_rate: 0.01 },
    cellular_3g:    { delay_ms: 400, jitter: 100, loss_rate: 0.03 },
    weak_network:   { delay_ms: 2000, jitter: 500, loss_rate: 0.1 },
    offline:        { delay_ms: 0,   jitter: 0,   loss_rate: 1.0 },
};

// 通过请求头指定网络状况
// X-Mock-Network: weak_network
// → DelaySimulator 自动应用对应延迟和丢包率
```

---

## 8. 安全与权限控制

### 8.1 项目角色权限矩阵

| 操作 | Owner | Editor | Viewer |
| --- | --- | --- | --- |
| 查看项目 | ✅ | ✅ | ✅ |
| 查看端点/场景 | ✅ | ✅ | ✅ |
| 调用Mock接口 | ✅ | ✅ | ✅ |
| 创建/编辑场景 | ✅ | ✅ | ❌ |
| 上传/更新规范 | ✅ | ✅ | ❌ |
| 管理成员 | ✅ | ❌ | ❌ |
| 删除项目 | ✅ | ❌ | ❌ |
| 查看统计 | ✅ | ✅ | ✅ (仅汇总) |

### 8.2 Mock 接口访问安全

```typescript
// security/mock-access-guard.ts

@Injectable()
export class MockAccessGuard implements CanActivate {
    constructor(
        private configService: ConfigService,
        private redis: Redis,
    ) {}

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();

        // 1. 检查是否启用访问令牌 (可选)
        const requireToken = this.configService.get('MOCK_REQUIRE_TOKEN', 'false') === 'true';
        if (requireToken) {
            const token = request.headers['x-mock-token'];
            if (!token || !this.validateToken(token, request.params.projectCode)) {
                throw new ForbiddenException('无效的Mock访问令牌');
            }
        }

        // 2. 限流检查 (按项目和客户端维度)
        const projectCode = request.params.projectCode;
        const clientTag = request.headers['x-mock-client-tag'] || request.ip;
        const rateLimitKey = `mock:ratelimit:${projectCode}:${clientTag}`;

        return this.checkRateLimit(rateLimitKey);
    }

    private async checkRateLimit(key: string): Promise<boolean> {
        const current = await this.redis.incr(key);
        if (current === 1) {
            await this.redis.expire(key, 60); // 60秒窗口
        }
        const limit = 1000; // 每分钟1000次
        return current <= limit;
    }
}
```

### 8.3 敏感数据过滤

```typescript
// 录制时自动过滤敏感数据，防止泄露到Mock平台
const SENSITIVE_HEADER_PATTERNS = [
    /authorization/i,
    /cookie/i,
    /x-api-key/i,
    /set-cookie/i,
    /x-auth-token/i,
];

const SENSITIVE_BODY_FIELDS = [
    'password',
    'token',
    'secret',
    'api_key',
    'phone',     // 部分脱敏
    'id_card',   // 脱敏
];

function sanitizeRecordingData(data: any): any {
    // 过滤请求头
    if (data.request_headers) {
        for (const key of Object.keys(data.request_headers)) {
            if (SENSITIVE_HEADER_PATTERNS.some(p => p.test(key))) {
                data.request_headers[key] = '***REDACTED***';
            }
        }
    }
    // 过滤请求体中的敏感字段
    if (data.request_body && typeof data.request_body === 'object') {
        data.request_body = sanitizeObject(data.request_body);
    }
    return data;
}

function sanitizeObject(obj: Record<string, any>): Record<string, any> {
    const result = { ...obj };
    for (const field of SENSITIVE_BODY_FIELDS) {
        if (result[field]) {
            result[field] = maskValue(result[field], field);
        }
    }
    return result;
}

function maskValue(value: string, field: string): string {
    if (field === 'phone' && value.length >= 7) {
        return value.slice(0, 3) + '****' + value.slice(-4);
    }
    return '***REDACTED***';
}
```

---

## 9. 性能优化

### 9.1 性能指标目标

| 指标 | 目标值 | 说明 |
| --- | --- | --- |
| Mock响应延迟(P99) | < 50ms | 不含场景配置的delay_ms |
| 并发支持 | 5000 QPS/项目 | 单实例 |
| 路由匹配耗时 | < 5ms | 含缓存命中 |
| 模板渲染耗时 | < 20ms | 中等复杂度响应体 |
| 场景选择耗时 | < 10ms | 含缓存命中 |

### 9.2 路由优化策略

```typescript
// 路由匹配采用 Radix Tree 优化大规模端点场景

// 1. 按method分组，减少遍历范围
// /api/v1/users/{id} GET → GET路由树
// /api/v1/users/{id} PUT → PUT路由树

// 2. 静态路径优先匹配 (快于模板路径)
// /api/v1/health (静态) 优先于 /api/v1/{resource} (模板)

// 3. Radix Tree 构建
import { RadixRouter } from 'radix-router';

const router = new RadixRouter();

// 注册路由
endpoints.forEach(ep => {
    const pathKey = `${ep.method}:${ep.path}`;
    router.insert(pathKey, { endpointId: ep.id });
});

// 匹配路由
const match = router.lookup(`${method}:${actualPath}`);
```

### 9.3 模板预编译

```typescript
// 对于动态模板，在场景创建/更新时预编译，运行时直接执行
const compiledTemplateCache = new Map<number, CompiledTemplate>();

// 场景更新时预编译
function precompileScenario(scenario: MockScenario): void {
    if (!scenario.dynamic_template) return;

    const tokens = tokenizeTemplate(scenario.response_body);
    const compiled = compileTokens(tokens);
    compiledTemplateCache.set(scenario.id, compiled);
}

// 运行时直接使用编译后的函数
function renderCompiled(scenarioId: number, ctx: MockRequestContext): any {
    const compiled = compiledTemplateCache.get(scenarioId);
    if (!compiled) return null;
    return compiled(ctx);
}
```

### 9.4 并发模型

```yaml
# Mock Server 采用 Fastify + Worker Threads 模式

worker_pool:
  enabled: true
  worker_count: 4          # CPU核心数
  max_connections: 10000
  pipeline:
    - route_match          # 主线程: 路由匹配 (快速, 需共享路由表)
    - scenario_pick        # 主线程: 场景选择 (需Redis缓存)
    - delay_simulate       # Worker线程: 延迟模拟 (不阻塞主线程)
    - template_render      # Worker线程: 模板渲染 (CPU密集)
    - response_assemble    # 主线程: 响应组装和返回
```

---

## 10. 部署架构

### 10.1 部署拓扑

```
┌─────────────────────────────────────────────────────────┐
│                    Kubernetes 集群                       │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Ingress Controller                   │   │
│  │   mock.primetop.cn → mock-service-svc            │   │
│  │   mock-admin.primetop.cn → mock-admin-svc       │   │
│  └──────────────────────┬───────────────────────────┘   │
│                         │                               │
│  ┌──────────────────────▼───────────────────────────┐   │
│  │  Mock Engine Service (Deployment)                │   │
│  │  replicas: 3-6 (HPA: CPU > 70% 或 QPS > 4000)   │   │
│  │  image: primetop/mock-engine:v1.0.0              │   │
│  │  resources:                                      │   │
│  │    requests: cpu=500m, memory=512Mi              │   │
│  │    limits: cpu=2000m, memory=2Gi                 │   │
│  └──────────┬───────────────────────┬───────────────┘   │
│             │                       │                   │
│  ┌──────────▼────────┐   ┌──────────▼──────────────┐    │
│  │   MySQL (主从)     │   │   Redis Cluster (3节点)  │    │
│  │   mock_db          │   │   mock_cache            │    │
│  └───────────────────┘   └─────────────────────────┘    │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Mock Admin Dashboard (Deployment)               │   │
│  │  replicas: 2                                     │   │
│  │  React + Ant Design 前端                         │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  RabbitMQ Consumer (日志异步写入)                 │   │
│  │  replicas: 2                                     │   │
│  │  消费 mock-access-log 队列                       │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 10.2 Docker Compose 本地开发

```yaml
# docker-compose.mock.yml
version: '3.8'

services:
  mock-engine:
    image: primetop/mock-engine:latest
    ports:
      - "9090:8080"
    environment:
      - NODE_ENV=development
      - DB_HOST=mysql
      - DB_PORT=3306
      - DB_NAME=mock_db
      - DB_USER=mock_user
      - DB_PASS=mock_pass
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - RABBITMQ_URL=amqp://rabbitmq:5672
    depends_on:
      - mysql
      - redis
      - rabbitmq
    volumes:
      - ./mock-config:/app/config

  mock-admin:
    image: primetop/mock-admin:latest
    ports:
      - "9091:80"
    environment:
      - API_BASE=http://mock-engine:8080

  mysql:
    image: mysql:8.0
    environment:
      MYSQL_DATABASE: mock_db
      MYSQL_USER: mock_user
      MYSQL_PASSWORD: mock_pass
      MYSQL_ROOT_PASSWORD: root_pass
    ports:
      - "3320:3306"
    volumes:
      - mock-mysql-data:/var/lib/mysql

  redis:
    image: redis:7-alpine
    ports:
      - "6390:6379"

  rabbitmq:
    image: rabbitmq:3-management
    ports:
      - "5672:5672"
      - "15672:15672"  # 管理界面

volumes:
  mock-mysql-data:
```

---

## 11. 监控与告警

### 11.1 关键监控指标

| 指标类别 | 指标名 | 采集方式 | 告警阈值 |
| --- | --- | --- | --- |
| 服务健康 | Mock Engine存活 | Prometheus /health | 实例数 < 3 |
| 性能 | P99响应时间 | Histogram | > 100ms (不含scenario delay) |
| 性能 | 路由匹配耗时 | Histogram | > 10ms |
| 流量 | 总QPS | Rate Counter | > 8000/实例 |
| 错误 | 5xx错误率 | Error Counter | > 1% |
| 错误 | 路由匹配失败率 | 40402 Counter | > 5% |
| 错误 | 场景缺失率 | 40403 Counter | > 2% |
| 资源 | 内存使用率 | Container Metrics | > 85% |
| 业务 | 活跃项目数 | Gauge | - |
| 业务 | 录制会话数 | Gauge | - |

### 11.2 Prometheus 指标定义

```typescript
// monitoring/metrics.ts
import { Registry, Counter, Histogram, Gauge } from 'prom-client';

export const mockMetrics = {
    // 请求总数
    mockRequestsTotal: new Counter({
        name: 'mock_requests_total',
        help: 'Total Mock requests',
        labelNames: ['project', 'method', 'status'],
    }),

    // 响应延迟分布 (不含scenario delay)
    mockResponseDuration: new Histogram({
        name: 'mock_response_duration_ms',
        help: 'Mock response duration (excluding scenario delay)',
        labelNames: ['project', 'method'],
        buckets: [1, 5, 10, 20, 50, 100, 200, 500],
    }),

    // 路由匹配耗时
    mockRouteMatchDuration: new Histogram({
        name: 'mock_route_match_duration_ms',
        help: 'Route matching duration',
        labelNames: ['project'],
        buckets: [0.5, 1, 2, 5, 10, 20],
    }),

    // 场景匹配类型分布
    mockScenarioMatchType: new Counter({
        name: 'mock_scenario_match_total',
        help: 'Scenario match type distribution',
        labelNames: ['project', 'match_type'], // header, conditional, default, auto
    }),

    // 错误统计
    mockErrorsTotal: new Counter({
        name: 'mock_errors_total',
        help: 'Mock errors by type',
        labelNames: ['project', 'error_code'],
    }),

    // 活跃项目数
    mockActiveProjects: new Gauge({
        name: 'mock_active_projects',
        help: 'Number of active mock projects',
    }),
};
```

---

## 12. 测试策略

### 12.1 单元测试

| 测试目标 | 覆盖范围 | 关键用例 |
| --- | --- | --- |
| RouteMatcher | 路径模板匹配 | 精确路径、路径参数、通配符、无效路径 |
| ScenarioPicker | 场景选择逻辑 | Header指定、条件匹配、默认回退、无场景 |
| TemplateEngine | 模板渲染 | request引用、faker生成、random函数、date函数、counter |
| OpenApiParser | 规范解析 | 有效规范、无效规范、$ref解析、枚举处理 |
| DefaultScenarioGenerator | 默认场景生成 | 成功场景、错误场景、路径参数端点 |
| DelaySimulator | 延迟模拟 | 固定延迟、抖动、Header覆盖、禁用延迟 |
| RecordingProxy | 录制代理 | 正常录制、代理失败、敏感数据过滤 |

### 12.2 集成测试

```typescript
// test/integration/mock-flow.e2e-spec.ts

describe('Mock 请求完整流程 (E2E)', () => {
    beforeAll(async () => {
        // 初始化测试项目和服务
        await setupTestProject();
        await uploadTestSpec();
        await createTestScenarios();
    });

    it('应正确匹配路由并返回默认成功场景', async () => {
        const res = await request(mockApp)
            .get('/mock/test-project/api/v1/users/12345')
            .expect(200);

        expect(res.headers['x-mock-scenario-id']).toBeDefined();
        expect(res.body.data.id).toBe('12345');
        expect(res.body.data.nickname).toBeDefined();
    });

    it('应通过Header指定错误场景', async () => {
        const res = await request(mockApp)
            .get('/mock/test-project/api/v1/users/12345')
            .set('X-Mock-Scenario', '用户不存在')
            .expect(404);

        expect(res.body.code).toBe(40401);
    });

    it('应通过条件规则匹配特定场景', async () => {
        const res = await request(mockApp)
            .get('/mock/test-project/api/v1/users/99999')
            .expect(404);

        expect(res.body.code).toBe(40401);
        expect(res.body.message).toContain('用户不存在');
    });

    it('应正确模拟延迟', async () => {
        const start = Date.now();
        await request(mockApp)
            .post('/mock/test-project/api/v1/ai/chat')
            .send({ message: '你好' })
            .expect(200);
        const elapsed = Date.now() - start;

        // AI接口默认延迟1500ms ± 20% 抖动
        expect(elapsed).toBeGreaterThan(1200);
        expect(elapsed).toBeLessThan(1800);
    });

    it('X-Mock-No-Delay应禁用延迟', async () => {
        const start = Date.now();
        await request(mockApp)
            .post('/mock/test-project/api/v1/ai/chat')
            .set('X-Mock-No-Delay', 'true')
            .send({ message: '你好' })
            .expect(200);
        const elapsed = Date.now() - start;

        expect(elapsed).toBeLessThan(100);
    });

    it('应返回40402当请求路径不在规范中', async () => {
        const res = await request(mockApp)
            .get('/mock/test-project/api/v1/nonexistent')
            .expect(404);

        expect(res.body.code).toBe(40402);
    });

    it('录制回放应正确工作', async () => {
        // 1. 开始录制
        await request(adminApp)
            .post('/api/v1/mock/endpoints/1/record/start')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ target_base_url: 'http://real-api-test:3000', session_name: 'test' })
            .expect(200);

        // 2. 发送请求 (通过录制代理)
        const res1 = await request(mockApp)
            .get('/mock/test-project/api/v1/users/12345')
            .set('X-Mock-Record-Mode', 'on')
            .expect(200);

        // 3. 停止录制
        await request(adminApp)
            .post('/api/v1/mock/endpoints/1/record/stop')
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200);

        // 4. 开始回放
        await request(adminApp)
            .post('/api/v1/mock/sessions/1/replay/start')
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200);

        // 5. 验证回放结果
        const res2 = await request(mockApp)
            .get('/mock/test-project/api/v1/users/12345')
            .expect(200);

        expect(res2.headers['x-mock-replay']).toBe('matched');
        expect(res2.body).toEqual(res1.body);
    });
});
```

### 12.3 性能测试

```yaml
# 性能测试目标 (k6 脚本配置)
performance_targets:
  scenarios:
    - name: "常规Mock请求压测"
      target_rps: 5000
      duration: 5m
      assertions:
        - p99_response_time < 100ms
        - error_rate < 0.1%
        - cpu_usage < 80%

    - name: "动态模板渲染压测"
      target_rps: 3000
      duration: 5m
      assertions:
        - p99_response_time < 50ms  # 不含scenario delay
        - template_render_p99 < 20ms

    - name: "路由匹配压测 (1000+端点)"
      target_rps: 8000
      duration: 5m
      endpoint_count: 1000
      assertions:
        - route_match_p99 < 5ms
```

---

## 13. 与现有系统的集成

### 13.1 与 CI/CD 流水线集成

```yaml
# .gitlab-ci.yml (Mock规范自动化)

stages:
  - validate
  - publish

mock:validate:
  stage: validate
  script:
    - |
      # 验证所有OpenAPI规范文件
      for spec in api-specs/*.yaml; do
        echo "Validating $spec..."
        npx @apidevtools/swagger-parser validate $spec
      done
  rules:
    - changes:
        - api-specs/**/*

mock:publish:
  stage: publish
  script:
    - |
      # 自动推送到Mock平台
      for spec in api-specs/*.yaml; do
        service_name=$(basename $spec .yaml)
        echo "Publishing $service_name to Mock platform..."
        curl -X POST \
          https://mock-admin.primetop.cn/api/v1/mock/projects/$MOCK_PROJECT_ID/services \
          -H "Authorization: Bearer $MOCK_API_TOKEN" \
          -F "name=$service_name" \
          -F "spec_file=@$spec" \
          -F "auto_refresh=true"
      done
  rules:
    - changes:
        - api-specs/**/*
      refs:
        - main
```

### 13.2 与客户端开发工作流集成

```
┌─────────────────────────────────────────────────────────┐
│                  开发工作流集成                           │
│                                                         │
│  后端开发                  前端/客户端开发                │
│  ┌──────────┐             ┌──────────────┐             │
│  │ 编写API   │             │ 需求分析      │             │
│  │ 设计文档  │             └──────┬───────┘             │
│  └────┬─────┘                    │                      │
│       │                          ▼                      │
│       ▼                   ┌──────────────┐              │
│  ┌──────────┐             │ 前端UI开发    │              │
│  │ 编写API   │  推送规范   │ (使用Mock)    │              │
│  │ OpenAPI  │────────────▶│              │              │
│  │ 规范     │             └──────┬───────┘              │
│  └────┬─────┘                    │                      │
│       │                          ▼                      │
│       ▼                   ┌──────────────┐              │
│  ┌──────────┐             │ 前端自测完成  │              │
│  │ 后端实现  │             └──────┬───────┘              │
│  │ API      │                    │                      │
│  └────┬─────┘                    │                      │
│       │    ◀──── 联调切换 ────────┘                      │
│       ▼                          ▼                      │
│  ┌────────────────────────────────────────┐             │
│  │       切换环境: Mock → Staging 联调     │             │
│  │       MockEnvSwitcher.switchTo(staging)│             │
│  └────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────┘
```

### 13.3 与自动化测试平台集成

```typescript
// E2E测试中使用Mock平台作为测试数据源

// playwright.config.ts
export default {
    use: {
        baseURL: process.env.MOCK_BASE_URL || 'https://mock.primetop.cn/e2e-test',
        extraHTTPHeaders: {
            'X-Mock-Client-Tag': 'e2e-test',
        },
    },
    projects: [
        {
            name: 'happy-path',
            use: {
                extraHTTPHeaders: {
                    'X-Mock-Client-Tag': 'e2e-test',
                    // 使用默认成功场景
                },
            },
        },
        {
            name: 'error-handling',
            use: {
                extraHTTPHeaders: {
                    'X-Mock-Client-Tag': 'e2e-test',
                    'X-Mock-Scenario': 'server_error', // 全局错误场景
                },
            },
        },
        {
            name: 'slow-network',
            use: {
                extraHTTPHeaders: {
                    'X-Mock-Client-Tag': 'e2e-test',
                    'X-Mock-Network': 'weak_network', // 弱网模拟
                },
            },
        },
    ],
};
```

---

## 14. 版本演进规划

### 14.1 v1.0 (MVP)

- 基础 Mock Server (HTTP REST)
- OpenAPI 3.0 规范解析和自动端点注册
- 手动场景配置 (成功 + 基础错误)
- 动态模板渲染 (request引用 + faker + random)
- 项目空间和成员管理
- 基础访问日志

### 14.2 v1.5

- 录制回放功能
- 条件规则场景匹配
- 网络状况模拟预设
- 客户端SDK (Flutter / Web)
- 使用统计 Dashboard
- 规范变更自动通知

### 14.3 v2.0

- GraphQL Mock 支持
- WebSocket Mock 支持
- AI 辅助场景生成 (基于规范自动生成更丰富的测试场景)
- Mock 场景版本控制 (随API版本演进)
- 多环境并行 (同一项目支持dev/staging/prod三套Mock数据)
- Mock 数据Diff (检测前端依赖的Mock数据是否与后端实现一致)
- 团队协作增强 (评论、@提及、变更审批)

---

## 15. 附录

### 15.1 模板语法速查

| 语法 | 说明 | 示例输出 |
| --- | --- | --- |
| `{{request.path.id}}` | 路径参数引用 | 12345 |
| `{{request.query.name}}` | 查询参数引用 | 张三 |
| `{{request.header.X-Request-Id}}` | 请求头引用 | abc-123 |
| `{{request.body.title}}` | 请求体字段引用 | 如何解方程 |
| `{{faker.name.fullName}}` | 随机中文姓名 | 李明 |
| `{{faker.internet.email}}` | 随机邮箱 | test123@example.com |
| `{{faker.image.avatar}}` | 随机头像URL | https://... |
| `{{faker.lorem.sentence}}` | 随机句子 | 这是一个测试句子。 |
| `{{random.arrayElement(["A","B","C"])}}` | 随机数组元素 | B |
| `{{random.int(1,100)}}` | 随机整数 | 42 |
| `{{random.float(0,1)}}` | 随机浮点数 | 0.73 |
| `{{date.future('yyyy-MM-dd')}}` | 未来日期 | 2026-12-15 |
| `{{date.past('yyyy-MM-dd')}}` | 过去日期 | 2025-03-20 |
| `{{date.now('yyyy-MM-dd HH:mm:ss')}}` | 当前时间 | 2026-06-29 13:30:00 |
| `{{counter.increment}}` | 自增计数器 | 1, 2, 3... |
| `{{counter.increment::userId}}` | 命名计数器 | (按key独立计数) |
| `{{uuid}}` | UUID v4 | 550e8400-e29b-41d4-a716-446655440000 |

### 15.2 PrimeTop 业务专用 Faker 扩展

```typescript
// custom-fakers/education.ts

export const educationFakers = {
    grade: () => {
        const stages = ['一年级','二年级','三年级','四年级','五年级','六年级',
                       '初一','初二','初三','高一','高二','高三'];
        return stages[Math.floor(Math.random() * stages.length)];
    },
    subject: () => {
        const subjects = ['语文','数学','英语','物理','化学','生物',
                         '历史','地理','政治','科学'];
        return subjects[Math.floor(Math.random() * subjects.length)];
    },
    textbookVersion: () => {
        const versions = ['人教版','苏教版','北师大版','外研版','沪教版','鲁教版'];
        return versions[Math.floor(Math.random() * versions.length)];
    },
    knowledgePoint: () => {
        const points = ['一元二次方程','勾股定理','二次函数','圆的性质',
                       '力的合成与分解','欧姆定律','化学方程式配平',
                       '光合作用','遗传与变异','丝绸之路','洋流'];
        return points[Math.floor(Math.random() * points.length)];
    },
    questionType: () => {
        const types = ['选择题','填空题','解答题','判断题','实验题','作文题'];
        return types[Math.floor(Math.random() * types.length)];
    },
    difficulty: () => {
        const levels = ['简单','中等','较难','困难'];
        return levels[Math.floor(Math.random() * levels.length)];
    },
    membershipLevel: () => {
        const levels = ['free','monthly','quarterly','yearly','exam_sprint'];
        return levels[Math.floor(Math.random() * levels.length)];
    },
    aiModel: () => {
        const models = ['gpt-4o','claude-3.5-sonnet','qwen-max','deepseek-v3','glm-4'];
        return models[Math.floor(Math.random() * models.length)];
    },
};
```

### 15.3 参考文献

- OpenAPI Specification 3.0: https://spec.openapis.org/oas/v3.0.3
- Faker.js API: https://fakerjs.dev/api/
- PrimeTop API网关统一接口规范与实现指南-详细设计.md
- PrimeTop 接口文档自动化与契约测试规范-详细设计.md
- PrimeTop 服务端代码分层规范与通用开发模板-详细设计.md
