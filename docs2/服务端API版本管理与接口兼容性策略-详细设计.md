# 服务端API版本管理与接口兼容性策略 - 详细设计

> **模块定位**：基础设施层 — 所有对外API（客户端/B端/管理后台）的版本生命周期管理
> **优先级**：P0（MVP 阶段即需确立规范，否则后期改动成本极高）
> **前置依赖**：API网关与通用接口规范、客户端版本管理与升级策略、灰度发布与特性开关系统

---

## 1. 概述

### 1.1 问题背景

启硕 PrimeTop 是一个长期演进的跨端产品（Android/iOS/Web/小程序），客户端版本碎片化严重。若缺乏统一的 API 版本管理策略，将导致：

1. **新旧客户端不兼容**：服务端改动导致旧版 APP 崩溃或功能异常
2. **不敢改 API**：因恐惧影响旧客户端而无法优化接口设计
3. **客户端强更依赖**：每次接口变更都需强制用户升级，损害体验
4. **B 端合作困难**：机构接入的 API 缺乏稳定性承诺

### 1.2 设计目标

| 目标 | 描述 |
|------|------|
| 向后兼容 | 服务端改动不破坏已发布的客户端版本 |
| 平滑演进 | 支持渐进式 API 升级，避免大爆炸式迁移 |
| 透明治理 | API 版本生命周期可追踪、可度量、可回滚 |
| 多端适配 | 同一接口可针对不同端（APP/Web/小程序）返回差异化数据 |
| B 端稳定 | 为 B 端合作方提供明确的稳定性承诺和迁移周期 |

### 1.3 核心原则

1. **非破坏性变更直接发布**：新增字段、新增接口、扩展枚举值等不升级版本号
2. **破坏性变更走新版本**：删除字段、修改语义、变更数据类型等必须创建新版本
3. **最少共存版本数**：同时在线版本不超过 3 个（N、N-1、N-2），避免维护成本失控
4. **版本有生命周期**：设计 → Alpha → Stable → Deprecated → Sunset，每个阶段有明确 SLA

---

## 2. 版本方案选型

### 2.1 方案对比

| 方案 | 示例 | 优点 | 缺点 |
|------|------|------|------|
| URI Path | `/api/v1/users` | 直观、易缓存、易路由 | 改动 URI，客户端需更新 |
| Query Param | `/api/users?version=1` | URI 不变 | 易遗漏、缓存不友好 |
| Header | `Accept: application/vnd.primetop.v1+json` | URI 干净 | 不直观、调试困难 |
| Content-Type | `Content-Type: application/vnd.primetop.v1+json` | RESTful 标准 | 复杂度高 |

### 2.2 选定方案：URI Path + Header 辅助

**主版本通过 URI Path 传递**，客户端元信息通过 Header 传递：

```
# URI 中携带主版本号
GET /api/v1/users/profile
GET /api/v2/users/profile

# Header 中携带客户端元信息（用于兼容性决策，不影响路由）
X-Client-Version: 1.2.3
X-Client-Platform: android
X-Client-OS: 14.2
X-Device-Id: abc123
```

**理由**：
- URI Path 是业界最广泛使用的方案，团队认知成本低
- 网关层可直接基于 URI 前缀路由到对应版本的 Service
- Header 传递客户端版本用于灰度判断和兼容性降级，不污染 URL

### 2.3 版本号规则

```
/api/v{MAJOR}
```

- **只使用 MAJOR 版本号**，不使用 `v1.2` 这样的格式
- MAJOR 版本变更意味着存在破坏性改动
- 非破坏性改动在同版本内通过新增字段/接口实现，不升级版本号

---

## 3. 破坏性变更 vs 非破坏性变更

### 3.1 非破坏性变更（可直接发布）

| 变更类型 | 示例 | 说明 |
|----------|------|------|
| 新增可选请求字段 | 添加 `source` 参数 | 旧客户端不传，不影响行为 |
| 新增响应字段 | 响应中添加 `badgeUrl` | 旧客户端忽略未知字段 |
| 新增 API 端点 | `/api/v1/study/weekly-report` | 不影响已有端点 |
| 扩展枚举值 | `status` 新增 `ARCHIVED` | 旧客户端应兼容未知枚举 |
| 放宽约束 | 必选参数改为可选 | 更宽容的输入 |
| 新增错误码 | 新增 `402001` 错误码 | 旧客户端按未知错误处理 |
| 优化内部逻辑 | 排序算法升级 | 输出格式不变 |

### 3.2 破坏性变更（必须创建新版本）

| 变更类型 | 示例 | 说明 |
|----------|------|------|
| 删除字段 | 移除 `nickname` 字段 | 旧客户端解析失败 |
| 重命名字段 | `name` → `displayName` | 旧客户端找不到字段 |
| 修改数据类型 | `age: int` → `age: string` | 反序列化失败 |
| 修改语义 | `status=1` 含义从"活跃"改为"冻结" | 逻辑错误 |
| 必选化字段 | 可选字段改为必选 | 旧客户端不传导致校验失败 |
| 删除/修改错误码 | 删除 `400001` | 旧客户端错误处理逻辑失效 |
| 变更分页协议 | `page/size` → `cursor/limit` | 分页逻辑完全不兼容 |

### 3.3 变更评审流程

```
开发者提交 API 变更 PR
        │
        ▼
  ┌─────────────────┐
  │ 变更类型自动检测  │ ← CI 脚本比对 OpenAPI diff
  └────────┬────────┘
           │
     ┌─────┴─────┐
     │           │
 非破坏性     破坏性
     │           │
     ▼           ▼
  直接合并   创建新版本分支
     │           │
     ▼           ▼
  发布到当前   进入版本生命周期
  版本的      (见第4节)
  next 环境
```

---

## 4. 版本生命周期

### 4.1 生命周期阶段

```
DRAFT → ALPHA → STABLE → DEPRECATED → SUNSET → REMOVED
```

| 阶段 | 持续时间 | SLA | 可用环境 | 说明 |
|------|----------|-----|----------|------|
| DRAFT | ≤ 2 周 | 无 | dev | 内部设计阶段，接口随时可能变动 |
| ALPHA | ≤ 4 周 | 无 | dev + staging | 内测阶段，接口可能调整，需指定客户端版本 |
| STABLE | ≥ 6 个月 | 99.9% | staging + prod | 正式发布，承诺向后兼容 |
| DEPRECATED | 3-6 个月 | 99.9% | staging + prod | 标记废弃，文档标注迁移指南，仍然正常服务 |
| SUNSET | 2 周 | 尽力而为 | prod | 返回 `299` 警告头 + 响应体提示即将下线 |
| REMOVED | - | - | 无 | 完全下线，返回 `410 Gone` |

### 4.2 版本状态机

```python
# 版本状态枚举
class ApiVersionStatus(str, Enum):
    DRAFT = "draft"
    ALPHA = "alpha"
    STABLE = "stable"
    DEPRECATED = "deprecated"
    SUNSET = "sunset"
    REMOVED = "removed"

# 状态转换规则
TRANSITIONS = {
    ApiVersionStatus.DRAFT:      [ApiVersionStatus.ALPHA],
    ApiVersionStatus.ALPHA:      [ApiVersionStatus.STABLE, ApiVersionStatus.DRAFT],  # 可回退
    ApiVersionStatus.STABLE:     [ApiVersionStatus.DEPRECATED],
    ApiVersionStatus.DEPRECATED: [ApiVersionStatus.SUNSET],
    ApiVersionStatus.SUNSET:     [ApiVersionStatus.REMOVED],
    ApiVersionStatus.REMOVED:    [],  # 终态
}
```

### 4.3 版本共存策略

```
时间轴示意：

         v1 (Stable)           v1 (Deprecated)       v1 (Sunset)  v1 (Removed)
         ├─────────────────────┤──────────────────────┤────────────┤
                     v2 (Stable)           v2 (Deprecated)        v2 (Sunset)
                     ├─────────────────────┤──────────────────────┤────────────┤
                              v3 (Stable)
                              ├─────────────────────→
```

**规则**：
- 最多同时存在 **3 个 Stable/Deprecated 版本**
- 新版本进入 Stable 后，最旧版本必须在 3 个月内进入 Deprecated
- Deprecated 版本至少保留 6 个月再进入 Sunset

---

## 5. API 网关路由设计

### 5.1 版本路由规则

网关层（Nginx / Kong / Spring Cloud Gateway）基于 URI 前缀路由：

```yaml
# 网关路由配置示例
routes:
  - id: primetop-api-v1
    uri: /api/v1/**
    predicates:
      - Path=/api/v1/**
    filters:
      - StripPrefix=1  # 去掉 /api/v1 前缀
    metadata:
      service: primetop-service-v1
      version: v1
      status: stable

  - id: primetop-api-v2
    uri: /api/v2/**
    predicates:
      - Path=/api/v2/**
    filters:
      - StripPrefix=1
    metadata:
      service: primetop-service-v2
      version: v2
      status: stable
```

### 5.2 版本降级路由

当请求的版本不存在或已下线时的处理策略：

```python
class VersionRouter:
    """版本路由决策"""

    def route(self, request_version: str, client_version: str, platform: str) -> str:
        """
        路由决策逻辑：
        1. 请求版本存在且在线 → 直接路由
        2. 请求版本已移除 → 路由到最低可用版本 + 返回迁移提示
        3. 客户端版本过低 → 返回强制升级响应
        """

        version_info = self.get_version_info(request_version)

        if version_info is None:
            # 版本完全不存在 → 410 Gone
            raise VersionGoneException(
                version=request_version,
                min_supported=self.get_min_supported_version(),
                migration_guide_url=f"/docs/api-migration/{request_version}-to-current"
            )

        if version_info.status == ApiVersionStatus.REMOVED:
            raise VersionGoneException(
                version=request_version,
                min_supported=self.get_min_supported_version()
            )

        if version_info.status == ApiVersionStatus.SUNSET:
            # 允许请求但附加警告
            return request_version, self._build_sunset_warning(version_info)

        # 检查客户端是否需要强制升级
        if self._need_force_upgrade(client_version, platform):
            raise ForceUpgradeRequired(
                min_version=self._get_min_client_version(platform),
                download_url=self._get_download_url(platform)
            )

        return request_version, None

    def _build_sunset_warning(self, version_info: ApiVersion) -> dict:
        return {
            "code": 299,
            "message": f"API v{version_info.major} 将于 {version_info.sunset_date} 下线，请尽快迁移",
            "migration_guide": version_info.migration_guide_url,
            "deadline": version_info.sunset_date.isoformat()
        }
```

### 5.3 网关层拦截响应格式

```json
// 410 Gone — 版本已下线
HTTP/1.1 410 Gone
Content-Type: application/json

{
  "code": 410001,
  "message": "API 版本 v1 已下线，请升级客户端或使用 v2 接口",
  "data": {
    "removedVersion": "v1",
    "minSupportedVersion": "v2",
    "migrationGuide": "https://docs.primetop.com/api-migration/v1-to-v2",
    "forceUpgrade": true,
    "downloadUrl": "https://primetop.com/download"
  }
}
```

```json
// 426 Upgrade Required — 客户端版本过低
HTTP/1.1 426 Upgrade Required
Content-Type: application/json

{
  "code": 426001,
  "message": "当前客户端版本过低，请升级到最新版本",
  "data": {
    "minClientVersion": "2.0.0",
    "currentClientVersion": "1.3.2",
    "platform": "android",
    "downloadUrl": "https://primetop.com/download",
    "forceUpgrade": true
  }
}
```

---

## 6. 接口契约与 OpenAPI 规范

### 6.1 OpenAPI 文档结构

```
docs/api/
├── openapi.yaml                    # 根文档（引用各版本）
├── v1/
│   ├── openapi.yaml               # v1 完整 OpenAPI 定义
│   ├── schemas/                   # 数据模型定义
│   │   ├── user.yaml
│   │   ├── question.yaml
│   │   └── study-record.yaml
│   └── paths/                     # 接口路径定义
│       ├── users-profile.yaml
│       ├── ai-chat.yaml
│       └── questions-search.yaml
├── v2/
│   ├── openapi.yaml
│   ├── schemas/
│   └── paths/
└── migrations/                    # 版本迁移指南
    ├── v1-to-v2.md
    └── CHANGELOG.md
```

### 6.2 OpenAPI 版本定义示例

```yaml
# v2/openapi.yaml
openapi: 3.1.0
info:
  title: PrimeTop API
  version: 2.0.0
  x-api-status: stable
  x-api-since: "2026-06-01"
  x-sunset-date: null
  x-deprecated-date: null

servers:
  - url: https://api.primetop.com/api/v2
    description: 生产环境
  - url: https://api-staging.primetop.com/api/v2
    description: 预发环境

paths:
  /users/profile:
    get:
      operationId: getUserProfileV2
      summary: 获取用户画像（含能力维度）
      description: |
        v2 变更说明：
        - 新增 `abilityDimensions` 字段（能力维度分析）
        - `grade` 类型从 `string` 改为 `object`（包含年级编号和名称）
        - 移除 `gradeText` 字段（合并到 `grade.name`）
      tags: [用户]
      parameters:
        - name: X-Client-Version
          in: header
          schema:
            type: string
          description: 客户端版本号，用于兼容性决策
      responses:
        '200':
          description: 成功
          content:
            application/json:
              schema:
                $ref: './schemas/user-profile-v2.yaml'
        '410':
          $ref: '#/components/responses/VersionGone'
        '426':
          $ref: '#/components/responses/UpgradeRequired'
```

### 6.3 CI 自动检测 OpenAPI Diff

```yaml
# .github/workflows/api-diff-check.yml
name: API Compatibility Check

on:
  pull_request:
    paths:
      - 'docs/api/**'

jobs:
  api-diff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install oasdiff
        run: npm install -g oasdiff

      - name: Check Breaking Changes
        run: |
          # 对比 PR 分支与主分支的 OpenAPI 定义
          oasdiff breaking \
            docs/api/v2/openapi.yaml \
            docs/api/v2/openapi.yaml \
            --base-branch origin/main \
            --format text \
            --fail-on ERR

      - name: Generate Changelog
        if: success()
        run: |
          oasdiff changelog \
            docs/api/v2/openapi.yaml \
            docs/api/v2/openapi.yaml \
            --base-branch origin/main \
            > docs/api/migrations/CHANGELOG.md
```

**检测的破坏性变更**：

| 规则 ID | 检测内容 | 严重级别 |
|---------|---------|---------|
| `api-removed` | 删除了已有的 API 端点 | ERROR |
| `api-operation-id-removed` | 删除了 operationId | ERROR |
| `request-parameter-removed` | 删除了请求参数 | ERROR |
| `request-property-removed` | 删除了请求体属性 | ERROR |
| `response-property-removed` | 删除了响应体属性 | WARN |
| `request-property-type-changed` | 修改了请求体属性类型 | ERROR |
| `response-property-type-changed` | 修改了响应体属性类型 | ERROR |
| `response-required-property-added` | 响应体新增了必选属性 | WARN |
| `enum-value-removed` | 删除了枚举值 | ERROR |
| `new-request-required-property` | 新增了必选请求参数 | WARN |

---

## 7. 客户端版本与 API 版本映射

### 7.1 映射关系

```
客户端版本          最低 API 版本    推荐 API 版本
───────────────────────────────────────────────
1.0.0 - 1.4.x      v1              v1
1.5.0 - 1.9.x      v1              v2（自动升级）
2.0.0+              v2              v2
```

### 7.2 映射配置存储

```json
// Redis/配置中心
{
  "clientApiMapping": {
    "android": [
      { "minClientVersion": "1.0.0", "maxClientVersion": "1.4.99", "apiVersion": "v1", "forceUpgrade": false },
      { "minClientVersion": "1.5.0", "maxClientVersion": "1.9.99", "apiVersion": "v2", "forceUpgrade": false },
      { "minClientVersion": "2.0.0", "maxClientVersion": null,    "apiVersion": "v2", "forceUpgrade": false }
    ],
    "ios": [
      { "minClientVersion": "1.0.0", "maxClientVersion": "1.4.99", "apiVersion": "v1", "forceUpgrade": false },
      { "minClientVersion": "1.5.0", "maxClientVersion": "1.9.99", "apiVersion": "v2", "forceUpgrade": false },
      { "minClientVersion": "2.0.0", "maxClientVersion": null,    "apiVersion": "v2", "forceUpgrade": false }
    ],
    "web": [
      { "minClientVersion": "1.0.0", "maxClientVersion": null, "apiVersion": "v2", "forceUpgrade": false }
    ],
    "miniapp": [
      { "minClientVersion": "1.0.0", "maxClientVersion": null, "apiVersion": "v2", "forceUpgrade": false }
    ]
  ]
}
```

### 7.3 客户端 API 版本协商流程

```
客户端启动 / 请求
        │
        ▼
┌──────────────────┐
│ 读取本地存储的    │
│ API 版本号       │
└────────┬─────────┘
         │
         ▼
┌──────────────────────┐
│ GET /api/bootstrap   │ ← 启动时一次性请求
│ X-Client-Version     │
│ X-Client-Platform    │
└────────┬─────────────┘
         │
         ▼
┌────────────────────────────────┐
│ 服务端返回:                     │
│ {                              │
│   "apiVersion": "v2",         │
│   "minClientVersion": "1.5.0",│
│   "forceUpgrade": false,      │
│   "deprecatedWarning": null,  │
│   "features": { ... }         │
│ }                              │
└────────┬───────────────────────┘
         │
    ┌────┴─────┐
    │          │
 版本不变   版本变化
    │          │
    ▼          ▼
 继续使用   更新本地
            API 版本号
            后续请求
            使用新版本
```

### 7.4 Bootstrap 接口设计

```java
@RestController
@RequestMapping("/api")
public class BootstrapController {

    @GetMapping("/bootstrap")
    public ApiResponse<BootstrapVO> bootstrap(
            @RequestHeader("X-Client-Version") String clientVersion,
            @RequestHeader("X-Client-Platform") String platform,
            @RequestHeader(value = "X-Device-Id", required = false) String deviceId) {

        // 1. 查找匹配的 API 版本
        String apiVersion = clientApiMappingService.resolveApiVersion(platform, clientVersion);

        // 2. 检查是否需要强制升级
        boolean forceUpgrade = clientApiMappingService.needForceUpgrade(platform, clientVersion);

        // 3. 获取当前最低支持客户端版本
        String minClientVersion = clientApiMappingService.getMinClientVersion(platform);

        // 4. 检查 API 版本是否即将废弃
        String deprecatedWarning = apiVersionService.getDeprecatedWarning(apiVersion);

        // 5. 获取特性开关配置
        Map<String, Boolean> features = featureFlagService.getClientFeatures(platform, clientVersion);

        return ApiResponse.success(BootstrapVO.builder()
                .apiVersion(apiVersion)
                .minClientVersion(minClientVersion)
                .forceUpgrade(forceUpgrade)
                .deprecatedWarning(deprecatedWarning)
                .features(features)
                .build());
    }
}
```

```java
@Data
@Builder
public class BootstrapVO {
    /** 推荐使用的 API 版本 */
    private String apiVersion;

    /** 最低支持的客户端版本 */
    private String minClientVersion;

    /** 是否需要强制升级 */
    private boolean forceUpgrade;

    /** API 版本废弃警告（null 表示当前版本正常） */
    private String deprecatedWarning;

    /** 特性开关 */
    private Map<String, Boolean> features;
}
```

---

## 8. 版本管理数据库设计

### 8.1 版本注册表

```sql
CREATE TABLE api_version (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    major           INT          NOT NULL COMMENT '主版本号，如 1, 2',
    status          VARCHAR(20)  NOT NULL DEFAULT 'DRAFT'
        COMMENT 'DRAFT/ALPHA/STABLE/DEPRECATED/SUNSET/REMOVED',
    base_url        VARCHAR(100) NOT NULL COMMENT '/api/v{major}',
    openapi_spec_url VARCHAR(255) COMMENT 'OpenAPI 文档地址',

    -- 时间节点
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    alpha_at        DATETIME     NULL COMMENT '进入 ALPHA 的时间',
    stable_at       DATETIME     NULL COMMENT '进入 STABLE 的时间',
    deprecated_at   DATETIME     NULL COMMENT '进入 DEPRECATED 的时间',
    sunset_at       DATETIME     NULL COMMENT '进入 SUNSET 的时间',
    removed_at      DATETIME     NULL COMMENT '进入 REMOVED 的时间',

    -- SLA 与配置
    min_client_android VARCHAR(20) COMMENT '最低支持 Android 客户端版本',
    min_client_ios     VARCHAR(20) COMMENT '最低支持 iOS 客户端版本',
    min_client_web     VARCHAR(20) COMMENT '最低支持 Web 客户端版本',
    migration_guide    VARCHAR(500) COMMENT '迁移指南 URL',

    -- 审计
    created_by      VARCHAR(50),
    updated_by      VARCHAR(50),
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_major (major)
) COMMENT 'API 版本注册表';
```

### 8.2 接口变更日志表

```sql
CREATE TABLE api_changelog (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    api_version     INT          NOT NULL COMMENT 'API 主版本号',
    change_type     VARCHAR(20)  NOT NULL COMMENT 'BREAKING/NON_BREAKING',
    endpoint        VARCHAR(255) NOT NULL COMMENT '接口路径，如 GET /users/profile',
    description     TEXT         NOT NULL COMMENT '变更描述',
    before_spec     JSON         NULL COMMENT '变更前的 schema 片段',
    after_spec      JSON         NULL COMMENT '变更后的 schema 片段',
    migration_note  TEXT         NULL COMMENT '迁移说明',
    jira_ticket     VARCHAR(50)  NULL COMMENT '关联的需求/缺陷编号',
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by      VARCHAR(50),

    INDEX idx_version_type (api_version, change_type),
    INDEX idx_created (created_at)
) COMMENT 'API 接口变更日志';
```

### 8.3 客户端-版本映射表

```sql
CREATE TABLE client_api_mapping (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    platform        VARCHAR(20)  NOT NULL COMMENT 'android/ios/web/miniapp',
    min_client_ver  VARCHAR(20)  NOT NULL COMMENT '最低客户端版本',
    max_client_ver  VARCHAR(20)  NULL COMMENT '最高客户端版本（null 表示无上限）',
    api_version     INT          NOT NULL COMMENT '对应的 API 版本',
    force_upgrade   TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '是否需要强制升级',
    effective_at    DATETIME     NOT NULL COMMENT '生效时间',
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uk_platform_range (platform, min_client_ver, max_client_ver),
    INDEX idx_platform (platform, effective_at)
) COMMENT '客户端版本与 API 版本映射';
```

---

## 9. B 端 API 版本策略

### 9.1 与 C 端策略的差异

| 维度 | C 端（APP/Web/小程序） | B 端（机构接入） |
|------|----------------------|-----------------|
| 版本控制 | 客户端自动升级 + 强制升级 | 合作方主动对接，不可强制 |
| Deprecated 周期 | 3-6 个月 | **12 个月** |
| 通知方式 | APP 内提示 | 邮件 + 站内信 + Webhook |
| 文档要求 | 内部 + 面向开发者 | **面向第三方开发者** |
| SLA | 99.9% | **99.95%**（合同承诺） |

### 9.2 B 端版本通知机制

```java
@Service
public class BPartnerVersionNotifier {

    /**
     * 当 API 版本进入 DEPRECATED 时，通知所有 B 端合作方
     */
    @Async
    public void notifyDeprecation(ApiVersion version) {
        List<BPartner> partners = partnerService.getActivePartners();

        for (BPartner partner : partners) {
            // 1. 站内信
            notificationService.send(
                partner.getAdminUserId(),
                "API 版本即将下线",
                buildDeprecationMessage(version, partner)
            );

            // 2. 邮件
            emailService.send(
                partner.getContactEmail(),
                "PrimeTop API 版本下线通知",
                buildDeprecationEmail(version, partner)
            );

            // 3. Webhook（如果配置了）
            if (partner.getWebhookUrl() != null) {
                webhookService.send(
                    partner.getWebhookUrl(),
                    "api.version.deprecated",
                    Map.of(
                        "apiVersion", version.getMajor(),
                        "deprecatedDate", version.getDeprecatedAt(),
                        "sunsetDate", calculateSunsetDate(version),
                        "migrationGuide", version.getMigrationGuide()
                    )
                );
            }
        }
    }
}
```

### 9.3 B 端 API 沙箱环境

为 B 端合作方提供独立的沙箱环境，供新版本对接测试：

```
https://sandbox-api.primetop.com/api/v2/  ← B端沙箱
https://api.primetop.com/api/v2/          ← 生产环境
```

沙箱特性：
- 独立的测试数据集（模拟学生、题目、学习记录）
- 支持数据重置
- 请求日志完全开放（可查看完整请求/响应）
- 无调用次数限制（但有速率限制）

---

## 10. 版本迁移实践

### 10.1 迁移指南模板

每个版本升级必须提供迁移指南，存放在 `docs/api/migrations/` 目录：

```markdown
# API v1 → v2 迁移指南

## 变更概览

| 类型 | 数量 |
|------|------|
| 破坏性变更 | 5 |
| 新增接口 | 12 |
| 新增字段 | 8 |
| 废弃字段 | 3 |

## 破坏性变更清单

### 1. 用户画像接口响应格式变更

**影响接口**: `GET /users/profile`

**v1 响应**:
```json
{
  "grade": "七年级",
  "gradeText": "初中一年级",
  "subjects": ["数学", "英语"]
}
```

**v2 响应**:
```json
{
  "grade": {
    "code": "G7",
    "name": "七年级",
    "stage": "junior"
  },
  "subjects": [
    { "code": "MATH", "name": "数学" },
    { "code": "ENG", "name": "英语" }
  ]
}
```

**迁移步骤**:
1. 将 `grade` 字符串解析改为 `grade.name` 属性访问
2. 移除对 `gradeText` 的依赖，使用 `grade.name` 替代
3. 科目从字符串数组改为对象数组，使用 `code` 做映射

### 2. 分页协议变更
...
```

### 10.2 版本适配层（客户端）

客户端应封装 API 版本适配层，降低迁移成本：

```dart
// Flutter 示例：API 版本适配层
class ApiVersionAdapter {
  static const String _currentApiVersion = 'v2';

  /// 获取用户画像
  /// 内部处理 v1/v2 的差异，对外暴露统一模型
  Future<UserProfile> getUserProfile() async {
    final response = await _dio.get('/$_currentApiVersion/users/profile');

    // 根据当前 API 版本解析响应
    return _parseUserProfile(response.data);
  }

  UserProfile _parseUserProfile(Map<String, dynamic> data) {
    // v2 格式
    if (data['grade'] is Map) {
      return UserProfile(
        gradeCode: data['grade']['code'],
        gradeName: data['grade']['name'],
        stage: data['grade']['stage'],
        subjects: (data['subjects'] as List)
            .map((s) => Subject(code: s['code'], name: s['name']))
            .toList(),
        abilityDimensions: (data['abilityDimensions'] as List?)
                ?.map((a) => AbilityDimension.fromJson(a))
                .toList() ??
            [],
      );
    }

    // v1 兼容格式
    return UserProfile(
      gradeCode: _gradeToCode(data['grade']),
      gradeName: data['gradeText'] ?? data['grade'],
      stage: _inferStage(data['grade']),
      subjects: (data['subjects'] as List)
          .map((s) => Subject(code: _subjectToCode(s), name: s))
          .toList(),
      abilityDimensions: [],
    );
  }
}
```

### 10.3 版本适配层（服务端）

服务端可使用适配器模式，让同一业务逻辑同时服务多个 API 版本：

```java
/**
 * API 版本适配器接口
 * 每个 API 版本实现自己的适配器，将领域模型转换为对应版本的 VO
 */
public interface UserProfileAdapter {
    String getApiVersion();
    UserProfileVO adapt(UserProfile domain);
}

// v1 适配器
@Component
@ConditionalOnProperty(name = "api.version", havingValue = "v1")
public class UserProfileAdapterV1 implements UserProfileAdapter {

    @Override
    public String getApiVersion() { return "v1"; }

    @Override
    public UserProfileVO adapt(UserProfile domain) {
        return UserProfileVO.builder()
                .grade(domain.getGradeName())
                .gradeText(domain.getGradeFullName())
                .subjects(domain.getSubjects().stream()
                        .map(Subject::getName)
                        .collect(Collectors.toList()))
                .build();
    }
}

// v2 适配器
@Component
@ConditionalOnProperty(name = "api.version", havingValue = "v2")
public class UserProfileAdapterV2 implements UserProfileAdapter {

    @Override
    public String getApiVersion() { return "v2"; }

    @Override
    public UserProfileVO adapt(UserProfile domain) {
        return UserProfileVO.builder()
                .grade(GradeVO.builder()
                        .code(domain.getGradeCode())
                        .name(domain.getGradeName())
                        .stage(domain.getStage().getCode())
                        .build())
                .subjects(domain.getSubjects().stream()
                        .map(s -> SubjectVO.builder()
                                .code(s.getCode())
                                .name(s.getName())
                                .build())
                        .collect(Collectors.toList()))
                .abilityDimensions(domain.getAbilityDimensions().stream()
                        .map(this::toAbilityDimensionVO)
                        .collect(Collectors.toList()))
                .build();
    }
}
```

**架构分层**：

```
Controller (v1) ──→ Adapter (v1) ──→ Service ──→ Repository
Controller (v2) ──→ Adapter (v2) ──↗
```

> Service 层只操作领域模型，不了解 API 版本差异。Adapter 负责领域模型 → VO 的版本化转换。

---

## 11. 版本管理后台功能

### 11.1 管理后台页面

| 页面 | 功能 |
|------|------|
| 版本列表 | 查看所有 API 版本及其状态、SLA、时间节点 |
| 版本详情 | 查看单个版本的接口清单、OpenAPI 文档、变更日志 |
| 版本生命周期 | 手动推进版本状态（DRAFT → ALPHA → STABLE 等） |
| 客户端映射管理 | 配置客户端版本与 API 版本的映射关系 |
| 变更日历 | 展示各版本的上线、废弃、下线时间线 |
| 迁移指南编辑 | 在线编写和发布版本迁移指南 |
| B 端通知记录 | 查看 B 端合作方的版本通知送达情况 |

### 11.2 版本状态推进 API

```java
@RestController
@RequestMapping("/admin/api-versions")
public class ApiVersionAdminController {

    @PostMapping("/{major}/transition")
    public ApiResponse<Void> transition(
            @PathVariable int major,
            @RequestBody VersionTransitionRequest request) {

        // 校验状态转换合法性
        apiVersionService.validateTransition(major, request.getTargetStatus());

        // 执行状态转换
        apiVersionService.transition(major, request.getTargetStatus(), request.getReason());

        // 触发副作用（通知、告警等）
        eventPublisher.publishEvent(new ApiVersionTransitionEvent(major, request.getTargetStatus()));

        return ApiResponse.success();
    }
}

@Data
public class VersionTransitionRequest {
    /** 目标状态 */
    private ApiVersionStatus targetStatus;

    /** 变更原因 */
    private String reason;

    /** 预计下线时间（进入 DEPRECATED 时必填） */
    private LocalDate sunsetDate;
}
```

### 11.3 版本使用率监控

```java
@Service
public class ApiVersionMetrics {

    /**
     * 统计各 API 版本的请求量占比
     */
    public Map<String, VersionMetrics> getVersionMetrics(LocalDate startDate, LocalDate endDate) {
        // 从日志/监控系统获取
        // 返回: {
        //   "v1": { requestCount: 150000, percentage: 15.2%, uniqueClients: 12000 },
        //   "v2": { requestCount: 835000, percentage: 84.8%, uniqueClients: 68000 }
        // }
    }

    /**
     * 判断是否可以安全下线某个版本
     * 条件：请求量占比 < 5% 且持续下降
     */
    public boolean canSafelySunset(int major) {
        VersionMetrics metrics = getVersionMetrics(
            LocalDate.now().minusDays(7),
            LocalDate.now()
        ).get("v" + major);

        return metrics != null && metrics.getPercentage() < 5.0;
    }
}
```

---

## 12. 错误码定义

### 12.1 版本相关错误码

| 错误码 | HTTP 状态码 | 含义 | 触发条件 |
|--------|------------|------|----------|
| `410001` | 410 | API 版本已下线 | 请求已移除的 API 版本 |
| `410002` | 410 | 接口已下线 | 请求已移除的具体接口 |
| `426001` | 426 | 客户端版本过低 | 客户端版本低于最低支持版本 |
| `426002` | 426 | 需要升级以使用此功能 | 客户端版本不支持请求的功能 |
| `400101` | 400 | 不支持的 API 版本 | URI 中的版本号不存在 |
| `400102` | 400 | 版本头缺失 | 缺少必需的版本相关 Header |
| `299001` | 200 | 版本废弃提示（附在正常响应中） | 使用已废弃的 API 版本 |

### 12.2 错误响应统一格式

```json
{
  "code": "410001",
  "message": "API v1 已于 2027-01-01 下线",
  "data": {
    "removedVersion": "v1",
    "removedDate": "2027-01-01",
    "currentVersion": "v2",
    "migrationGuide": "https://docs.primetop.com/api-migration/v1-to-v2",
    "clientAction": {
      "type": "FORCE_UPGRADE",
      "minClientVersion": "2.0.0",
      "downloadUrl": "https://primetop.com/download",
      "message": "请升级到最新版本以继续使用"
    }
  },
  "timestamp": "2027-03-15T10:30:00+08:00",
  "requestId": "req_abc123"
}
```

---

## 13. 关键流程时序图

### 13.1 版本升级全流程

```
开发者        API审查组       服务端         网关          客户端
  │              │             │             │             │
  │ 提交新版本PR  │             │             │             │
  ├─────────────→│             │             │             │
  │              │ OpenAPI diff │             │             │
  │              │ 评审变更     │             │             │
  │              │─────────→   │             │             │
  │              │  合并+打标签  │             │             │
  │              │─────────────→│             │             │
  │              │              │ 部署到 staging│             │
  │              │              │─────────────→│             │
  │              │              │              │ ALPHA 测试  │
  │              │              │              │─────────────→│
  │              │              │              │             │
  │              │              │              │ 测试通过反馈  │
  │              │              │              │←─────────────│
  │              │              │              │             │
  │              │ 确认 STABLE   │             │             │
  │              │─────────────→│             │             │
  │              │              │ 部署到 prod   │             │
  │              │              │─────────────→│             │
  │              │              │              │ 灰度推送更新 │
  │              │              │              │─────────────→│
  │              │              │              │             │
  │              │              │              │  Bootstrap  │
  │              │              │              │←─────────────│
  │              │              │              │ 返回 v2 配置 │
  │              │              │              │─────────────→│
  │              │              │              │             │
  │              │              │              │ 使用 v2 API  │
  │              │              │←─────────────│←─────────────│
```

### 13.2 旧版本下线流程

```
版本管理       监控系统       网关          客户端        B端合作方
  │              │             │             │             │
  │ 检查使用率    │             │             │             │
  ├─────────────→│             │             │             │
  │  <5% 确认可下线│             │             │             │
  │←─────────────│             │             │             │
  │              │             │             │             │
  │ 标记 DEPRECATED│            │             │             │
  │──────────────────────────→│             │             │
  │              │             │ 添加响应头警告│             │
  │              │             │─────────────→│             │
  │              │             │             │             │
  │ 发送通知      │             │             │             │
  │─────────────────────────────────────────────────────→│
  │              │             │             │             │
  │ 6个月后检查   │             │             │             │
  │              │             │             │             │
  │ 标记 SUNSET   │             │             │             │
  │──────────────────────────→│             │             │
  │              │             │ 返回299警告  │             │
  │              │             │─────────────→│             │
  │              │             │             │             │
  │ 2周后标记REMOVED│            │             │             │
  │──────────────────────────→│             │             │
  │              │             │ 返回410 Gone│             │
  │              │             │─────────────→│             │
```

---

## 14. 监控与告警

### 14.1 核心监控指标

| 指标 | 含义 | 告警阈值 |
|------|------|----------|
| `api_version_request_total{version}` | 各版本请求总量 | - |
| `api_version_request_ratio{version}` | 各版本请求占比 | Deprecated 版本 > 20% 时告警 |
| `api_version_error_total{version}` | 各版本错误量 | 410 错误 > 100/小时 告警 |
| `api_version_avg_latency{version}` | 各版本平均延迟 | - |
| `api_client_version_distribution` | 客户端版本分布 | 旧版本 > 30% 时告警 |
| `api_force_upgrade_total` | 强制升级触发次数 | 短时间激增时告警 |

### 14.2 Grafana 看板配置

```yaml
# 版本使用率看板
apiVersion: 1
dashboards:
  - title: API 版本治理
    panels:
      - title: 版本请求量分布
        type: piechart
        targets:
          - expr: sum(rate(api_version_request_total[5m])) by (version)

      - title: 版本请求量趋势
        type: timeseries
        targets:
          - expr: sum(rate(api_version_request_total[1h])) by (version)

      - title: 客户端版本分布
        type: barchart
        targets:
          - expr: sum(api_client_version_distribution) by (client_version)

      - title: 强制升级触发次数
        type: stat
        targets:
          - expr: sum(rate(api_force_upgrade_total[1h]))
        thresholds:
          - value: 50
            color: red

      - title: Deprecated 版本使用率
        type: gauge
        targets:
          - expr: |
              sum(rate(api_version_request_total{version=~"deprecated_versions"}[1d]))
              / sum(rate(api_version_request_total[1d]))
        thresholds:
          - value: 20
            color: yellow
          - value: 5
            color: green
```

---

## 15. 最佳实践清单

### 15.1 开发者 Checklist

**发布新接口时**：
- [ ] OpenAPI 文档已同步更新
- [ ] 接口已添加到对应版本的 paths 目录
- [ ] 非破坏性变更：直接合并到当前版本
- [ ] 破坏性变更：创建新版本分支 + 编写迁移指南
- [ ] 响应体中的新字段设为可选
- [ ] 枚举扩展时，客户端能兼容未知值

**修改已有接口时**：
- [ ] 通过 CI 自动检测变更类型
- [ ] 破坏性变更必须经 API 审查组评审
- [ ] 更新 api_changelog 表
- [ ] 同步更新迁移指南

**下线旧版本时**：
- [ ] 监控旧版本使用率 < 5%
- [ ] 迁移指南已完成并通过审核
- [ ] B 端合作方已收到通知并确认迁移
- [ ] 按生命周期推进：STABLE → DEPRECATED → SUNSET → REMOVED
- [ ] 每个阶段保留足够的缓冲期

### 15.2 客户端开发者 Checklist

- [ ] 启动时调用 `/api/bootstrap` 获取推荐 API 版本
- [ ] 所有 API 调用使用动态版本号，不硬编码
- [ ] 响应解析使用 `JsonDeserializer` 容忍未知字段
- [ ] 枚举类预留 `UNKNOWN` 值，处理新增枚举
- [ ] 监听 `410` 和 `426` 响应，触发升级流程
- [ ] 本地缓存 Bootstrap 配置，离线时使用缓存值

---

## 16. 与其他模块的协作关系

```
┌──────────────────────────────────────────────────┐
│               API 版本管理（本文档）               │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌─────────────┐  读取版本路由  ┌──────────────┐ │
│  │  API 网关    │←────────────│ 版本注册表    │ │
│  └─────────────┘              └──────────────┘ │
│         ↑                            ↑          │
│  路由配置 │                     状态推进 │          │
│         │                            │          │
│  ┌─────────────┐              ┌──────────────┐ │
│  │  灰度发布    │              │ 管理后台     │ │
│  └─────────────┘              └──────────────┘ │
│                                       ↑         │
│                              通知推送  │         │
│  ┌─────────────┐              ┌──────────────┐ │
│  │ 客户端升级   │←────────────│ B端合作管理   │ │
│  └─────────────┘              └──────────────┘ │
│                                                  │
│  依赖的外部模块：                                 │
│  • API网关与通用接口规范 → 网关层路由配置          │
│  • 客户端版本管理与升级策略 → 客户端版本号定义      │
│  • 灰度发布与特性开关系统 → 灰度版本路由           │
│  • 消息与推送服务 → B端版本下线通知               │
│  • B端合作与机构接入方案 → B端API SLA承诺          │
└──────────────────────────────────────────────────┘
```

---

## 附录 A：版本号与客户端版本对应关系速查表

| API 版本 | 客户端范围（Android） | 客户端范围（iOS） | 状态 | 关键变更 |
|----------|---------------------|------------------|------|----------|
| v1 | 1.0.0 - 1.9.x | 1.0.0 - 1.9.x | Stable（MVP） | 初始版本，核心学习闭环 |
| v2 | 2.0.0+ | 2.0.0+ | Planned | 领域模型重构，新增能力维度 |

> 随产品迭代持续更新此表。

---

## 附录 B：OpenAPI 自动生成代码配置

```yaml
# openapi-generator-config.yaml
generatorName: java
library: resttemplate
apiPackage: com.primetop.api.v2.client
modelPackage: com.primetop.api.v2.model
invokerPackage: com.primetop.api.v2

# 仅生成模型类（接口由服务端自行实现）
globalProperties:
  apis: ""
  supportingFiles: ""
  models: ""

typeMappings:
  date-time: OffsetDateTime
  date: LocalDate

additionalProperties:
  useTags: true
  useBeanValidation: true
  performBeanValidation: true
  openApiNullable: true
  serializationLibrary: jackson
```

```yaml
# Flutter 客户端生成配置
generatorName: dart-dio
additionalProperties:
  nullableFields: true
  enumUnknownDefaultCase: true
  useNameX: true
```