# 服务端-开放API平台与第三方教育应用生态管理引擎 详细设计

## 1. 概述

### 1.1 模块定位

开放 API 平台是 PrimeTop 从封闭产品向开放教育生态演进的核心基础设施。该模块为第三方教育应用开发者、学校/机构系统管理员、教辅内容合作方提供统一的 API 接入入口，实现教育数据互通、能力开放和生态共建。

### 1.2 核心职责

| 职责 | 说明 |
| --- | --- |
| 开发者门户 | 第三方开发者注册、应用创建、密钥管理、文档浏览 |
| API 网关扩展 | 面向第三方请求的鉴权、限流、配额、审计 |
| OAuth2 授权 | 用户授权第三方应用访问其学习数据 |
| 能力开放 | 将内部 AI 辅导、题目检索、知识图谱等能力安全暴露 |
| Webhook 事件订阅 | 向第三方推送学习事件、成绩变化等订阅消息 |
| 应用审核与上架 | 第三方应用安全审核、合规检查、灰度发布 |
| 用量计量与计费 | API 调用计量、套餐管理、账单生成 |
| 沙箱环境 | 第三方开发测试用的隔离环境与 Mock 数据 |

### 1.3 依赖关系

```
┌─────────────────────────────────────────────────────────────┐
│                    开放 API 平台引擎                          │
├──────────────┬──────────────┬──────────────┬────────────────┤
│  开发者门户   │  API 网关层   │  OAuth2 授权  │  Webhook 引擎   │
├──────────────┴──────────────┴──────────────┴────────────────┤
│  应用审核服务  │  用量计量服务  │  套餐计费服务  │  沙箱环境服务   │
└──────────────┴──────────────┴──────────────┴────────────────┘
        │              │              │              │
        ▼              ▼              ▼              ▼
   用户服务      AI 能力层        内容服务层      支付服务
   (用户/租户)   (模型调用)      (题库/知识点)   (账单/结算)
```

### 1.4 与现有模块的关系

| 现有模块 | 关系 |
| --- | --- |
| `API网关与通用接口规范` | 开放平台在通用网关之上增加第三方专用鉴权层和配额管控 |
| `第三方服务集成与供应商管理` | 互为逆向：前者是 PrimeTop 调用外部，本模块是外部调用 PrimeTop |
| `统一认证授权与令牌管理体系` | 复用 JWT 基础设施，扩展 OAuth2 授权码模式 |
| `统一限流熔断与流量防护体系` | 复用限流框架，增加按应用维度的配额管控 |
| `统一审计日志与操作追溯系统` | 第三方 API 调用全量审计 |
| `B端合作与机构接入方案` | 开放 API 是 B 端合作的技术实现底座 |

---

## 2. 数据模型

### 2.1 核心实体 ER 图

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│   Developer  │────<│ Application  │────<│  AppScopeGrant   │
│  (开发者账号)  │     │  (第三方应用)  │     │ (应用-权限范围)   │
└──────────────┘     └──────┬───────┘     └──────────────────┘
                            │
                     ┌──────┴───────┐
                     │              │
                     ▼              ▼
┌──────────────┐     ┌──────────────┐
│ ApiKey       │     │ OAuthGrant   │
│ (API密钥)     │     │ (用户授权记录) │
└──────────────┘     └──────────────┘
                     ┌──────────────┐
                     │ AccessToken  │
                     │ (访问令牌)    │
                     └──────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│ ApiResource  │────<│ ApiEndpoint  │     │ WebhookSubscription│
│ (API资源组)   │     │ (具体接口)    │     │ (事件订阅)         │
└──────────────┘     └──────────────┘     └──────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│ UsageRecord  │     │ ApiPackage   │────<│ Subscription     │
│ (调用计量记录) │     │ (套餐定义)    │     │ (应用订阅)        │
└──────────────┘     └──────────────┘     └──────────────────┘

┌──────────────┐     ┌──────────────┐
│ AppReview    │     │ SandboxEnv   │
│ (应用审核记录) │     │ (沙箱环境)    │
└──────────────┘     └──────────────┘
```

### 2.2 数据库表结构

#### 2.2.1 `open_developer` — 开发者账号

```sql
CREATE TABLE `open_developer` (
    `id`                BIGINT       NOT NULL AUTO_INCREMENT,
    `user_id`           BIGINT       NOT NULL COMMENT '关联平台用户ID（可为null，纯外部开发者）',
    `external_email`    VARCHAR(128) NULL COMMENT '外部开发者邮箱（无平台账号时使用）',
    `developer_name`    VARCHAR(64)  NOT NULL COMMENT '开发者真实姓名/企业名称',
    `developer_type`    TINYINT      NOT NULL DEFAULT 1 COMMENT '1=个人 2=企业 3=学校 4=机构',
    `org_license_url`   VARCHAR(512) NULL COMMENT '营业执照/办学许可证文件URL',
    `contact_phone`    VARCHAR(32)  NULL COMMENT '联系电话',
    `status`            TINYINT      NOT NULL DEFAULT 0 COMMENT '0=待审核 1=正常 2=冻结 3=注销',
    `verified_at`      DATETIME      NULL COMMENT '实名认证时间',
    `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_id` (`user_id`),
    UNIQUE KEY `uk_external_email` (`external_email`),
    KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='开放平台开发者账号';
```

#### 2.2.2 `open_application` — 第三方应用

```sql
CREATE TABLE `open_application` (
    `id`                BIGINT       NOT NULL AUTO_INCREMENT,
    `app_key`           VARCHAR(64)  NOT NULL COMMENT '应用唯一标识 (AppKey)',
    `app_name`          VARCHAR(128) NOT NULL COMMENT '应用名称',
    `app_type`          TINYINT      NOT NULL DEFAULT 1 COMMENT '1=Web应用 2=移动应用 3=服务端应用 4=小程序',
    `developer_id`      BIGINT       NOT NULL COMMENT '创建者开发者ID',
    `description`       TEXT         NULL COMMENT '应用描述',
    `logo_url`          VARCHAR(512) NULL COMMENT '应用图标URL',
    `homepage_url`      VARCHAR(512) NULL COMMENT '应用主页URL',
    `callback_url`      VARCHAR(512) NULL COMMENT 'OAuth2 回调地址',
    `privacy_policy_url` VARCHAR(512) NULL COMMENT '隐私政策URL',
    `status`            TINYINT      NOT NULL DEFAULT 0 COMMENT '0=开发中 1=待审核 2=已上线 3=已下架 4=审核拒绝',
    `visibility`        TINYINT      NOT NULL DEFAULT 0 COMMENT '0=私有 1=公开（应用市场可见）',
    `category`          VARCHAR(64)  NULL COMMENT '应用分类：ai_tutor/homework/exam/content_mgmt/school_admin',
    `risk_level`        TINYINT      NOT NULL DEFAULT 2 COMMENT '1=低风险 2=中风险 3=高风险',
    `review_score`      DECIMAL(3,2) NOT NULL DEFAULT 0.00 COMMENT '用户评分',
    `installed_count`   INT          NOT NULL DEFAULT 0 COMMENT '安装数',
    `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `published_at`      DATETIME     NULL COMMENT '上线时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_app_key` (`app_key`),
    KEY `idx_developer_id` (`developer_id`),
    KEY `idx_status_visibility` (`status`, `visibility`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='第三方应用';
```

#### 2.2.3 `open_api_key` — API 密钥

```sql
CREATE TABLE `open_api_key` (
    `id`                BIGINT       NOT NULL AUTO_INCREMENT,
    `application_id`    BIGINT       NOT NULL COMMENT '所属应用ID',
    `key_prefix`        VARCHAR(16)  NOT NULL COMMENT '密钥前缀（明文，用于识别）',
    `key_hash`          VARCHAR(128) NOT NULL COMMENT '密钥哈希值 (SHA-256)',
    `key_name`          VARCHAR(64)  NOT NULL DEFAULT 'default' COMMENT '密钥名称/备注',
    `environment`       TINYINT      NOT NULL DEFAULT 0 COMMENT '0=沙箱 1=生产',
    `status`            TINYINT      NOT NULL DEFAULT 1 COMMENT '0=禁用 1=启用',
    `expires_at`        DATETIME     NULL COMMENT '过期时间（null=永不过期）',
    `last_used_at`     DATETIME      NULL COMMENT '最后使用时间',
    `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_key_hash` (`key_hash`),
    KEY `idx_application_id` (`application_id`),
    KEY `idx_environment` (`environment`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='API密钥';
```

#### 2.2.4 `open_oauth_grant` — OAuth2 用户授权记录

```sql
CREATE TABLE `open_oauth_grant` (
    `id`                BIGINT       NOT NULL AUTO_INCREMENT,
    `user_id`           BIGINT       NOT NULL COMMENT '授权用户ID（平台用户）',
    `application_id`    BIGINT       NOT NULL COMMENT '被授权的应用ID',
    `scope_codes`       JSON         NOT NULL COMMENT '授权范围列表 ["question:read","ai:tutor"]',
    `grant_type`        VARCHAR(32)  NOT NULL DEFAULT 'authorization_code' COMMENT '授权码模式',
    `code`              VARCHAR(128) NULL COMMENT '授权码（一次性）',
    `code_expires_at`  DATETIME      NULL COMMENT '授权码过期时间',
    `redirect_uri`     VARCHAR(512) NULL COMMENT '回调地址',
    `status`            TINYINT      NOT NULL DEFAULT 0 COMMENT '0=授权码已发 1=已换令牌 2=用户撤销 3=过期',
    `revoked_at`       DATETIME      NULL COMMENT '撤销时间',
    `expires_at`       DATETIME      NULL COMMENT '授权过期时间（refresh token过期）',
    `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_code` (`code`),
    KEY `idx_user_app` (`user_id`, `application_id`),
    KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='OAuth2授权记录';
```

#### 2.2.5 `open_access_token` — 访问令牌

```sql
CREATE TABLE `open_access_token` (
    `id`                BIGINT       NOT NULL AUTO_INCREMENT,
    `grant_id`          BIGINT       NOT NULL COMMENT '关联授权记录ID',
    `user_id`           BIGINT       NOT NULL COMMENT '令牌代表的用户ID',
    `application_id`    BIGINT       NOT NULL COMMENT '使用令牌的应用ID',
    `token_hash`        VARCHAR(128) NOT NULL COMMENT 'Access Token 哈希',
    `refresh_token_hash` VARCHAR(128) NULL COMMENT 'Refresh Token 哈希',
    `scope_codes`       JSON         NOT NULL COMMENT '实际授予的权限范围',
    `expires_at`       DATETIME      NOT NULL COMMENT 'Access Token 过期时间',
    `refresh_expires_at` DATETIME    NULL COMMENT 'Refresh Token 过期时间',
    `status`            TINYINT      NOT NULL DEFAULT 1 COMMENT '0=已撤销 1=有效 2=已过期 3=已刷新',
    `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_token_hash` (`token_hash`),
    KEY `idx_grant_id` (`grant_id`),
    KEY `idx_user_app` (`user_id`, `application_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='OAuth2访问令牌';
```

#### 2.2.6 `open_api_resource` — API 资源定义

```sql
CREATE TABLE `open_api_resource` (
    `id`                BIGINT       NOT NULL AUTO_INCREMENT,
    `resource_code`     VARCHAR(64)  NOT NULL COMMENT '资源代码，如 question, ai_tutor, knowledge',
    `resource_name`     VARCHAR(128) NOT NULL COMMENT '资源中文名',
    `description`       TEXT         NULL,
    `base_path`         VARCHAR(128) NOT NULL COMMENT '资源基础路径，如 /open/v1/questions',
    `scope_code`        VARCHAR(64)  NOT NULL COMMENT '对应权限范围代码',
    `risk_level`        TINYINT      NOT NULL DEFAULT 1 COMMENT '1=低 2=中 3=高',
    `rate_limit_per_min` INT         NOT NULL DEFAULT 60 COMMENT '默认每分钟调用上限',
    `daily_quota`       INT          NOT NULL DEFAULT 1000 COMMENT '默认每日配额',
    `status`            TINYINT      NOT NULL DEFAULT 1 COMMENT '0=下线 1=上线 2=灰度',
    `min_app_status`   TINYINT       NOT NULL DEFAULT 2 COMMENT '所需最低应用状态(2=已上线)',
    `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_resource_code` (`resource_code`),
    UNIQUE KEY `uk_scope_code` (`scope_code`),
    KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='API资源定义';
```

#### 2.2.7 `open_api_endpoint` — 具体接口端点

```sql
CREATE TABLE `open_api_endpoint` (
    `id`                BIGINT       NOT NULL AUTO_INCREMENT,
    `resource_id`       BIGINT       NOT NULL COMMENT '所属API资源',
    `method`            VARCHAR(8)   NOT NULL COMMENT 'HTTP方法',
    `path`              VARCHAR(256) NOT NULL COMMENT '接口路径（相对basePath）',
    `summary`           VARCHAR(256) NOT NULL COMMENT '接口摘要',
    `auth_required`     TINYINT      NOT NULL DEFAULT 1 COMMENT '是否需要用户授权',
    `scope_codes`       JSON         NOT NULL COMMENT '所需权限范围',
    `request_schema`    JSON         NULL COMMENT '请求参数Schema (OpenAPI格式)',
    `response_schema`   JSON         NULL COMMENT '响应Schema',
    `example_request`  TEXT         NULL COMMENT '请求示例',
    `example_response` TEXT         NULL COMMENT '响应示例',
    `deprecated`        TINYINT      NOT NULL DEFAULT 0 COMMENT '是否已废弃',
    `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_resource_id` (`resource_id`),
    KEY `idx_path_method` (`path`, `method`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='API端点定义';
```

#### 2.2.8 `open_usage_record` — API 调用计量记录

```sql
CREATE TABLE `open_usage_record` (
    `id`                BIGINT       NOT NULL AUTO_INCREMENT,
    `application_id`    BIGINT       NOT NULL,
    `api_key_id`       BIGINT        NOT NULL,
    `user_id`           BIGINT       NULL COMMENT '关联用户（用户级调用时）',
    `endpoint_path`    VARCHAR(256) NOT NULL COMMENT '调用接口路径',
    `method`            VARCHAR(8)   NOT NULL,
    `status_code`       INT          NOT NULL COMMENT 'HTTP状态码',
    `response_time_ms` INT          NOT NULL COMMENT '响应耗时',
    `request_id`        VARCHAR(64)  NOT NULL COMMENT '请求追踪ID',
    `ip_address`        VARCHAR(64)  NULL COMMENT '调用方IP',
    `tokens_consumed`  INT           NOT NULL DEFAULT 0 COMMENT '消耗的AI Token数（如适用）',
    `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_app_created` (`application_id`, `created_at`),
    KEY `idx_api_key_created` (`api_key_id`, `created_at`),
    KEY `idx_user_created` (`user_id`, `created_at`),
    KEY `idx_request_id` (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='API调用计量记录'
PARTITION BY RANGE (TO_DAYS(created_at)) (
    PARTITION p_20260701 VALUES LESS THAN (TO_DAYS('2026-08-01')),
    PARTITION p_20260801 VALUES LESS THAN (TO_DAYS('2026-09-01')),
    PARTITION p_max VALUES LESS THAN MAXVALUE
);
```

> **注意：** `usage_record` 表按月分区，定期归档到 ClickHouse 进行 OLAP 分析。生产环境仅保留近 3 个月热数据。

#### 2.2.9 `open_api_package` — API 套餐

```sql
CREATE TABLE `open_api_package` (
    `id`                BIGINT       NOT NULL AUTO_INCREMENT,
    `package_code`      VARCHAR(64)  NOT NULL,
    `package_name`      VARCHAR(128) NOT NULL,
    `tier`              TINYINT      NOT NULL COMMENT '1=免费 2=基础 3=专业 4=企业',
    `daily_quota`       INT          NOT NULL COMMENT '每日调用配额',
    `rate_limit_per_min` INT         NOT NULL COMMENT '每分钟调用上限',
    `concurrent_limit`  INT          NOT NULL DEFAULT 10 COMMENT '并发上限',
    `available_scopes`  JSON         NOT NULL COMMENT '可用权限范围',
    `price_monthly`     DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '月费(元)',
    `price_yearly`      DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '年费(元)',
    `ai_tokens_daily`  INT           NOT NULL DEFAULT 0 COMMENT '每日AI Token额度',
    `webhook_events_limit` INT       NOT NULL DEFAULT 10000 COMMENT '每日Webhook推送上限',
    `sandbox_enabled`  TINYINT       NOT NULL DEFAULT 1 COMMENT '是否提供沙箱环境',
    `status`            TINYINT      NOT NULL DEFAULT 1 COMMENT '0=下架 1=上架',
    `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_package_code` (`package_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='API套餐';
```

#### 2.2.10 `open_subscription` — 应用订阅

```sql
CREATE TABLE `open_subscription` (
    `id`                BIGINT       NOT NULL AUTO_INCREMENT,
    `application_id`    BIGINT       NOT NULL,
    `package_id`        BIGINT       NOT NULL,
    `environment`       TINYINT      NOT NULL DEFAULT 0 COMMENT '0=沙箱 1=生产',
    `status`            TINYINT      NOT NULL DEFAULT 0 COMMENT '0=待生效 1=有效 2=已过期 3=已取消',
    `start_date`        DATE         NOT NULL,
    `end_date`          DATE         NULL COMMENT 'null=永久有效',
    `auto_renew`        TINYINT      NOT NULL DEFAULT 0 COMMENT '自动续费',
    `order_id`          BIGINT       NULL COMMENT '关联订单ID',
    `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_app_env` (`application_id`, `environment`),
    KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='应用API订阅';
```

#### 2.2.11 `open_webhook_subscription` — Webhook 事件订阅

```sql
CREATE TABLE `open_webhook_subscription` (
    `id`                BIGINT       NOT NULL AUTO_INCREMENT,
    `application_id`    BIGINT       NOT NULL,
    `event_types`       JSON         NOT NULL COMMENT '订阅事件类型列表',
    `callback_url`      VARCHAR(512) NOT NULL COMMENT '回调地址',
    `secret_token`      VARCHAR(128) NOT NULL COMMENT '签名密钥(用于HMAC校验)',
    `status`            TINYINT      NOT NULL DEFAULT 1 COMMENT '0=暂停 1=启用',
    `retry_policy`      JSON         NOT NULL COMMENT '重试策略 {"maxRetries":5,"backoff":"exponential"}',
    `success_count`    INT           NOT NULL DEFAULT 0,
    `fail_count`       INT           NOT NULL DEFAULT 0,
    `last_triggered_at` DATETIME     NULL,
    `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_app_status` (`application_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Webhook事件订阅';
```

#### 2.2.12 `open_webhook_delivery` — Webhook 投递记录

```sql
CREATE TABLE `open_webhook_delivery` (
    `id`                BIGINT       NOT NULL AUTO_INCREMENT,
    `subscription_id`   BIGINT       NOT NULL,
    `event_id`          VARCHAR(64)  NOT NULL COMMENT '事件唯一ID',
    `event_type`        VARCHAR(64)  NOT NULL,
    `payload`           JSON         NOT NULL COMMENT '事件载荷',
    `request_header`    JSON         NULL COMMENT '请求头（含签名）',
    `response_status`   INT          NULL COMMENT '回调响应状态码',
    `response_body`    TEXT          NULL COMMENT '回调响应体',
    `attempt_count`    INT           NOT NULL DEFAULT 0,
    `status`            TINYINT      NOT NULL DEFAULT 0 COMMENT '0=待发送 1=成功 2=失败 3=重试中 4=放弃',
    `next_retry_at`    DATETIME      NULL,
    `delivered_at`     DATETIME      NULL,
    `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_sub_status` (`subscription_id`, `status`),
    KEY `idx_event_type` (`event_type`),
    KEY `idx_next_retry` (`status`, `next_retry_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Webhook投递记录';
```

#### 2.2.13 `open_app_review` — 应用审核记录

```sql
CREATE TABLE `open_app_review` (
    `id`                BIGINT       NOT NULL AUTO_INCREMENT,
    `application_id`    BIGINT       NOT NULL,
    `review_type`       VARCHAR(32)  NOT NULL COMMENT 'first_publish/major_update/compliance_check',
    `reviewer_id`       BIGINT       NULL COMMENT '审核人ID',
    `status`            TINYINT      NOT NULL DEFAULT 0 COMMENT '0=待审核 1=通过 2=拒绝 3=需补充材料',
    `checklist_result` JSON          NOT NULL COMMENT '检查清单结果',
    `risk_assessment`  TEXT          NULL COMMENT '风险评估说明',
    `reject_reason`    TEXT          NULL COMMENT '拒绝原因',
    `submitted_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `reviewed_at`      DATETIME      NULL,
    PRIMARY KEY (`id`),
    KEY `idx_app_status` (`application_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='应用审核记录';
```

### 2.3 Redis 缓存策略

| 缓存键 | 类型 | TTL | 说明 |
| --- | --- | --- | --- |
| `open:apikey:{key_hash}` | Hash | 5min | API Key → 应用映射、套餐信息 |
| `open:quota:app:{app_id}:daily:{date}` | String(INCR) | 48h | 每日调用计数 |
| `open:quota:app:{app_id}:min:{minute}` | String(INCR) | 120s | 每分钟调用计数 |
| `open:token:{token_hash}` | Hash | 与Token同步 | Access Token → 用户+应用+Scope |
| `open:scope:app:{app_id}` | Set | 10min | 应用已获授权范围集合 |
| `open:ratelimit:app:{app_id}:window` | Sorted Set | 60s | 滑动窗口限流 |
| `open:webhook:retry:{delivery_id}` | String | 24h | Webhook重试去重 |

---

## 3. API 接口设计

### 3.1 接口总览

所有开放 API 统一前缀 `/open/v1/`，与内部 API `/api/v1/` 隔离。

| 分类 | 路径 | 方法 | Scope | 说明 |
| --- | --- | --- | --- | --- |
| **OAuth2 授权** | | | | |
| 获取授权码 | `/open/oauth/authorize` | GET/POST | — | 用户授权页面 |
| 换取令牌 | `/open/oauth/token` | POST | — | 授权码→Access Token |
| 刷新令牌 | `/open/oauth/token` | POST | — | Refresh Token→新Token |
| 撤销令牌 | `/open/oauth/revoke` | POST | — | 撤销Access/Refresh Token |
| 用户信息 | `/open/v1/user/info` | GET | `user:profile` | 获取已授权用户基本信息 |
| **题目服务** | | | | |
| 题目搜索 | `/open/v1/questions/search` | GET | `question:read` | 按知识点/题型/难度搜索题目 |
| 题目详情 | `/open/v1/questions/{id}` | GET | `question:read` | 获取单个题目详情 |
| 题目解析 | `/open/v1/questions/{id}/solution` | GET | `question:read` | 获取题目解析步骤 |
| **AI 辅导** | | | | |
| AI 问答 | `/open/v1/ai/tutor` | POST | `ai:tutor` | 发起AI辅导问答(SSE流式) |
| 作文批改 | `/open/v1/ai/essay-grading` | POST | `ai:essay` | 提交作文获取批改结果 |
| **知识图谱** | | | | |
| 知识点查询 | `/open/v1/knowledge/points` | GET | `knowledge:read` | 按学段/学科/章节查询知识点 |
| 知识点关系 | `/open/v1/knowledge/points/{id}/relations` | GET | `knowledge:read` | 获取知识点前置/后继关系 |
| **学习数据** | | | | |
| 学习记录 | `/open/v1/learning/records` | GET | `learning:read` | 获取已授权学生的学习记录 |
| 错题列表 | `/open/v1/learning/mistakes` | GET | `learning:read` | 获取学生错题本 |
| 学情报告 | `/open/v1/learning/report` | GET | `learning:report` | 获取学情分析报告 |
| **Webhook 管理** | | | | |
| 创建订阅 | `/open/v1/webhooks/subscriptions` | POST | `webhook:manage` | 创建事件订阅 |
| 查看订阅 | `/open/v1/webhooks/subscriptions` | GET | `webhook:manage` | 查看订阅列表 |
| 删除订阅 | `/open/v1/webhooks/subscriptions/{id}` | DELETE | `webhook:manage` | 删除订阅 |
| 测试投递 | `/open/v1/webhooks/subscriptions/{id}/test` | POST | `webhook:manage` | 发送测试事件 |

### 3.2 OAuth2 授权流程

#### 3.2.1 获取授权码

```
GET /open/oauth/authorize
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `response_type` | string | 是 | 固定值 `code` |
| `client_id` | string | 是 | 应用 AppKey |
| `redirect_uri` | string | 是 | 回调地址（需与注册一致） |
| `scope` | string | 是 | 申请权限范围，空格分隔，如 `question:read learning:read` |
| `state` | string | 是 | 防 CSRF 随机串 |

**响应（302重定向）：**

```
HTTP/1.1 302 Found
Location: {redirect_uri}?code={AUTH_CODE}&state={STATE}
```

授权码有效期 **10 分钟**，仅可使用一次。

#### 3.2.2 换取访问令牌

```
POST /open/oauth/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic {Base64(AppKey:AppSecret)}
```

**请求体：**

```
grant_type=authorization_code
code={AUTH_CODE}
redirect_uri={REDIRECT_URI}
```

**成功响应：**

```json
{
    "code": 0,
    "data": {
        "access_token": "pt_open_at_xxxxxxxxxxxxxxxxxxxxxxxx",
        "token_type": "Bearer",
        "expires_in": 7200,
        "refresh_token": "pt_open_rt_yyyyyyyyyyyyyyyyyyyyy",
        "refresh_expires_in": 2592000,
        "scope": "question:read learning:read"
    }
}
```

| 字段 | 说明 |
| --- | --- |
| `access_token` | Access Token，有效期 **2 小时** |
| `refresh_token` | Refresh Token，有效期 **30 天** |
| `scope` | 实际授予的权限范围（可能与申请不同，用户可缩减） |

#### 3.2.3 刷新令牌

```
POST /open/oauth/token
Authorization: Basic {Base64(AppKey:AppSecret)}
```

```
grant_type=refresh_token
refresh_token={REFRESH_TOKEN}
```

#### 3.2.4 权限范围 (Scope) 体系

| Scope Code | 说明 | 风险等级 | 数据范围 |
| --- | --- | --- | --- |
| `user:profile` | 用户基本资料（昵称、学段、年级） | 低 | 基础信息 |
| `question:read` | 题目与解析只读访问 | 低 | 公开题库 |
| `knowledge:read` | 知识点体系只读访问 | 低 | 公开知识图谱 |
| `ai:tutor` | AI 辅导问答调用 | 中 | 消耗AI资源 |
| `ai:essay` | AI 作文批改调用 | 中 | 消耗AI资源 |
| `learning:read` | 学生学习记录与错题读取 | 高 | 用户隐私数据 |
| `learning:report` | 学情报告读取 | 高 | 用户隐私数据 |
| `webhook:manage` | Webhook 订阅管理 | 低 | 应用自身配置 |

> **高风险 Scope** 需要应用审核通过后才可申请用户授权；用户授权页面需明确展示数据访问范围。

### 3.3 统一请求与响应格式

#### 3.3.1 请求头规范

```
Authorization: Bearer {access_token}    # OAuth2 用户级调用
X-Api-Key: {api_key}                     # API Key 应用级调用（无需用户授权时）
X-Request-Id: {uuid}                     # 请求追踪ID（自动生成）
X-Timestamp: {epoch_ms}                  # 时间戳
X-Signature: {hmac_sha256}              # 请求签名（可选，高风险接口必填）
```

#### 3.3.2 统一响应结构

```json
{
    "code": 0,
    "message": "success",
    "data": { ... },
    "request_id": "req_xxxxxxxxxxxx",
    "timestamp": 1783200000000
}
```

#### 3.3.3 分页响应

```json
{
    "code": 0,
    "data": {
        "items": [ ... ],
        "pagination": {
            "page": 1,
            "page_size": 20,
            "total": 156,
            "has_more": true
        }
    }
}
```

### 3.4 核心接口示例

#### 3.4.1 题目搜索

```
GET /open/v1/questions/search?subject=math&grade=7&knowledge_point=KP_10042&page=1&page_size=20
Authorization: Bearer pt_open_at_xxxxx
```

**响应：**

```json
{
    "code": 0,
    "data": {
        "items": [
            {
                "id": "Q_20260001",
                "subject": "math",
                "grade": 7,
                "type": "single_choice",
                "difficulty": 3,
                "content": "已知 $x^2 - 5x + 6 = 0$，则 $x$ 的值为",
                "options": ["$x=1$", "$x=2$", "$x=2$ 或 $x=3$", "$x=6$"],
                "knowledge_points": ["KP_10042", "KP_10043"],
                "source": "人教版七年级下册",
                "created_at": "2026-01-15T08:00:00Z"
            }
        ],
        "pagination": {
            "page": 1,
            "page_size": 20,
            "total": 42,
            "has_more": true
        }
    }
}
```

#### 3.4.2 AI 辅导问答 (SSE 流式)

```
POST /open/v1/ai/tutor
Authorization: Bearer pt_open_at_xxxxx
Content-Type: application/json
```

```json
{
    "question": "请解释一元二次方程的求根公式",
    "context": {
        "subject": "math",
        "grade": 8,
        "textbook_version": "renjiao"
    },
    "stream": true
}
```

**SSE 响应：**

```
event: meta
data: {"answer_id":"ans_xxx","model":"glm-5"}

event: delta
data: {"content":"一元二次方程 $ax^2+bx+c=0$"}

event: delta
data: {"content":"的求根公式为：\n\n$$x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}$$"}

event: delta
data: {"content":"\n\n**推导思路：**\n1. 对方程两边同除以 $a$\n2. 配方..."}

event: knowledge
data: {"knowledge_points":["KP_10042"],"difficulty":"grade_8"}

event: done
data: {"answer_id":"ans_xxx","tokens_used":156,"finish_reason":"stop"}
```

### 3.5 Webhook 事件类型

| 事件类型 | 触发时机 | 载荷摘要 |
| --- | --- | --- |
| `learning.answer_submitted` | 学生提交答题 | student_id, question_id, correct, subject |
| `learning.mistake_added` | 新错题收录 | student_id, question_id, error_type |
| `learning.session_completed` | 学习会话结束 | student_id, duration, subject, accuracy |
| `learning.report_generated` | 学情报告生成 | student_id, report_id, period |
| `ai.tutor_completed` | AI 辅导完成 | student_id, tokens, satisfaction |
| `user.grade_changed` | 用户年级变更 | user_id, old_grade, new_grade |
| `system.maintenance_scheduled` | 计划维护通知 | start_time, end_time, impact |

**Webhook 载荷示例：**

```json
{
    "event_id": "evt_20260704_aBcDeF",
    "event_type": "learning.mistake_added",
    "created_at": "2026-07-04T00:59:00Z",
    "data": {
        "student_id": 10086,
        "student_name": "小明",
        "question_id": "Q_20260001",
        "subject": "math",
        "knowledge_points": ["KP_10042"],
        "error_type": "concept_misunderstanding",
        "grade": 7
    }
}
```

**HMAC-SHA256 签名验证：**

```
Header: X-Webhook-Signature: sha256={hmac_hex}

签名计算:
hmac_sha256(secret_token, event_id + timestamp + raw_body)
```

### 3.6 错误码定义

| 错误码 | HTTP状态码 | 说明 |
| --- | --- | --- |
| `OPEN_00000` | 200 | 成功 |
| `OPEN_40001` | 400 | 请求参数错误 |
| `OPEN_40002` | 400 | 无效的 grant_type |
| `OPEN_40003` | 400 | 无效的 redirect_uri |
| `OPEN_40004` | 400 | scope 参数非法 |
| `OPEN_40101` | 401 | 缺少 Access Token |
| `OPEN_40102` | 401 | Access Token 无效或已过期 |
| `OPEN_40103` | 401 | Refresh Token 无效或已过期 |
| `OPEN_40104` | 401 | API Key 无效 |
| `OPEN_40301` | 403 | 权限不足（缺少所需 scope） |
| `OPEN_40302` | 403 | 应用未上线，无法调用生产环境 |
| `OPEN_40303` | 403 | 应用已被下架或冻结 |
| `OPEN_40304` | 403 | 用户已撤销授权 |
| `OPEN_42901` | 429 | 请求频率超限（rate limit） |
| `OPEN_42902` | 429 | 每日调用配额已耗尽（quota exceeded） |
| `OPEN_42903` | 429 | AI Token 额度已耗尽 |
| `OPEN_42904` | 429 | 并发数超限 |
| `OPEN_45101` | 451 | 内容不合规，拒绝访问 |
| `OPEN_50001` | 500 | 服务内部错误 |
| `OPEN_50201` | 502 | 下游 AI 服务不可用 |
| `OPEN_50301` | 503 | 服务暂不可用（维护中） |

---

## 4. 业务逻辑

### 4.1 第三方应用生命周期状态机

```
┌─────────┐  提交审核   ┌─────────┐  审核通过   ┌─────────┐
│ 开发中   │───────────>│ 待审核   │───────────>│ 已上线   │
│ DEVELOPING│           │ REVIEWING│           │ PUBLISHED│
└────┬────┘            └────┬────┘            └────┬────┘
     │                      │                      │
     │                      │ 审核拒绝              │ 平台下架
     │                      ▼                      ▼
     │                 ┌─────────┐            ┌─────────┐
     │                 │ 审核拒绝  │            │ 已下架   │
     │                 │ REJECTED │            │ ARCHIVED │
     │                 └─────────┘            └─────────┘
     │                                               │
     │ 重新编辑提交                                    │ 重新申请上线
     └───────────────────────────────────────────────┘
```

| 状态 | 可调用环境 | 可创建API Key | 可申请用户授权 |
| --- | --- | --- | --- |
| DEVELOPING | 沙箱 | 沙箱密钥 | ❌ |
| REVIEWING | 沙箱 | 沙箱密钥 | ❌ |
| REJECTED | 沙箱 | 沙箱密钥 | ❌ |
| PUBLISHED | 生产 + 沙箱 | 生产 + 沙箱密钥 | ✅ |
| ARCHIVED | 仅沙箱(只读) | ❌ | ❌ |

### 4.2 OAuth2 完整授权流程

```
第三方应用                PrimeTop开放平台              平台用户(学生/家长)
    │                         │                              │
    │  1. 引导用户跳转授权      │                              │
    │────────────────────────>│                              │
    │                         │  2. 展示授权确认页面           │
    │                         │─────────────────────────────>│
    │                         │                              │
    │                         │  3. 用户登录(如未登录)         │
    │                         │<─────────────────────────────│
    │                         │                              │
    │                         │  4. 展示申请的权限范围        │
    │                         │  用户确认/缩减授权范围         │
    │                         │<─────────────────────────────│
    │                         │                              │
    │  5. 回调 redirect_uri    │                              │
    │   带 code & state       │                              │
    │<────────────────────────│                              │
    │                         │                              │
    │  6. 服务端用 code 换 token                              │
    │────────────────────────>│                              │
    │                         │  7. 返回 access_token         │
    │<────────────────────────│                              │
    │                         │                              │
    │  8. 携带 token 调用 API  │                              │
    │────────────────────────>│                              │
    │                         │  9. 鉴权后返回数据             │
    │<────────────────────────│                              │
```

**安全要点：**
- `state` 参数必须校验，防止 CSRF
- 授权码 10 分钟过期，一次性使用
- Access Token 通过 Bearer 方式传递，必须 HTTPS
- Refresh Token 轮转：每次刷新后旧 Refresh Token 失效
- 高风险 Scope 授权时需用户二次确认（短信/生物验证）

### 4.3 API 请求处理管道

```
请求到达
   │
   ▼
┌──────────────┐
│ 1. HTTPS检查  │ ── 非HTTPS → 403
└──────┬───────┘
       ▼
┌──────────────┐
│ 2. 提取凭证   │ ── Authorization Bearer / X-Api-Key
└──────┬───────┘
       ▼
┌──────────────┐
│ 3. 身份解析   │ ── Token/ApiKey → Application + User + Scope
│              │ ── 缓存未命中 → 查DB → 写缓存
└──────┬───────┘
       ▼
┌──────────────┐
│ 4. 状态检查   │ ── 应用是否上线? 用户授权是否有效?
└──────┬───────┘
       ▼
┌──────────────┐
│ 5. 权限校验   │ ── 接口所需scope ⊆ 已授scope ?
└──────┬───────┘
       ▼
┌──────────────┐
│ 6. 限流检查   │ ── 滑动窗口 / 并发数 / 每日配额
│              │ ── Redis: INCR + EXPIRE
└──────┬───────┘
       ▼
┌──────────────┐
│ 7. 参数校验   │ ── JSON Schema 验证请求参数
└──────┬───────┘
       ▼
┌──────────────┐
│ 8. 业务处理   │ ── 路由到内部服务
└──────┬───────┘
       ▼
┌──────────────┐
│ 9. 响应封装   │ ── 统一格式 + request_id
└──────┬───────┘
       ▼
┌──────────────┐
│10. 异步计量   │ ── MQ: 写usage_record (非阻塞)
└──────────────┘
```

### 4.4 Webhook 投递流程

```
内部事件产生
      │
      ▼
┌────────────────┐
│ 事件发布到 MQ   │  (topic: open.webhook.events)
└───────┬────────┘
        ▼
┌────────────────────────────────────────┐
│ Webhook Dispatcher Worker              │
│ 1. 查询匹配的 subscriptions            │
│ 2. 创建 delivery 记录 (status=待发送)  │
│ 3. 构造请求:                            │
│    - POST callback_url                 │
│    - Body: event payload (JSON)        │
│    - Header: X-Webhook-Signature       │
│    - X-Webhook-Event-Id                │
│    - X-Webhook-Timestamp               │
│ 4. 发送请求 (timeout: 10s)             │
│ 5. 记录响应                             │
└───────┬────────────────────────────────┘
        │
   ┌────┴────┐
   │         │
   ▼         ▼
 2xx/3xx   4xx/5xx/超时
   │         │
   │         ▼
   │    ┌──────────────────────┐
   │    │ 重试调度器            │
   │    │ 策略: 指数退避         │
   │    │ 1m → 5m → 30m → 2h → 6h │
   │    │ 最多 5 次             │
   │    │ 超过 → status=放弃   │
   │    │ → 告警通知开发者      │
   │    └──────────────────────┘
   ▼
 status=成功
 success_count++
```

### 4.5 应用审核流程

```
开发者提交审核
      │
      ▼
┌──────────────────────────────────────────┐
│ 自动检查 (自动化)                         │
│ ✓ 隐私政策URL 可访问                     │
│ ✓ 回调地址可用                            │
│ ✓ 应用图标尺寸合规                        │
│ ✓ 应用名称无违规词                        │
│ ✓ API调用测试（沙箱环境冒烟测试）         │
│ ✓ 敏感Scope使用合理性检查                 │
│ ✓ 数据存储声明检查                        │
└─────────────────┬────────────────────────┘
                  │
            自动检查通过?
            /        \
          是          否
           │           │
           ▼           ▼
   ┌───────────┐  自动拒绝 + 退回
   │ 人工审核   │
   │ (1-3工作日)│
   └─────┬─────┘
         │
   ┌─────┴─────┐
   │           │
   ▼           ▼
 审核通过     审核拒绝
   │        (附拒绝原因)
   ▼
 应用状态 → PUBLISHED
 发送通知给开发者
```

**人工审核检查清单 (Checklist)：**

```json
{
    "checks": [
        {"item": "应用描述准确完整", "required": true, "result": null},
        {"item": "隐私政策包含数据使用说明", "required": true, "result": null},
        {"item": "无收集用户数据转售行为", "required": true, "result": null},
        {"item": "未成年人保护措施到位", "required": true, "result": null},
        {"item": "API使用场景与申请Scope匹配", "required": true, "result": null},
        {"item": "无诱导消费或误导性内容", "required": true, "result": null},
        {"item": "技术安全评估(签名验证/HTTPS)", "required": true, "result": null},
        {"item": "服务器实名备案信息", "required": false, "result": null}
    ]
}
```

---

## 5. 关键代码示例

### 5.1 开放平台核心类图

```
┌─────────────────────────────────────────────────────────────────┐
│                    OpenApiGatewayFilter                         │
│  (Spring Cloud Gateway Global Filter)                           │
├─────────────────────────────────────────────────────────────────┤
│  - filter(): Mono<Void>                                        │
│  - extractCredential(request): ApiCredential                   │
│  - resolveIdentity(credential): IdentityContext                │
│  - checkQuota(identityCtx, endpoint): void                     │
│  - routeToInternal(request, identityCtx): Mono<Response>      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    OAuth2Service                                │
├─────────────────────────────────────────────────────────────────┤
│  + generateAuthCode(appId, userId, scopes): AuthCode           │
│  + exchangeToken(code, appKey, appSecret): TokenPair           │
│  + refreshToken(refreshToken, appKey): TokenPair               │
│  + revokeToken(token): void                                    │
│  + validateToken(tokenHash): AccessTokenContext                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    QuotaManager                                  │
├─────────────────────────────────────────────────────────────────┤
│  + checkAndConsume(appId, endpoint, cost): QuotaResult         │
│  + getUsage(appId, date): UsageSummary                         │
│  + resetDailyQuota(appId): void                                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    WebhookDispatcher                             │
├─────────────────────────────────────────────────────────────────┤
│  + dispatch(event: OpenEvent): void                            │
│  - findMatchingSubscriptions(event): List<Subscription>        │
│  - sendDelivery(subscription, event): DeliveryResult           │
│  + retryFailedDeliveries(): void                               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    AppReviewService                              │
├─────────────────────────────────────────────────────────────────┤
│  + submitReview(appId, reviewType): Review                     │
│  + runAutoChecks(appId): ChecklistResult                       │
│  + approve(reviewId, reviewerId): void                         │
│  + reject(reviewId, reason): void                              │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 API 网关过滤器 (Spring Cloud Gateway)

```java
/**
 * 开放平台 API 网关全局过滤器
 * 负责第三方请求的鉴权、限流、计量
 */
@Component
@Order(-1) // 在通用限流过滤器之前执行
public class OpenApiGatewayFilter implements GlobalFilter {

    private final ApiKeyService apiKeyService;
    private final OAuth2Service oauth2Service;
    private final QuotaManager quotaManager;
    private final UsageRecorder usageRecorder;

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();
        String path = request.getURI().getPath();

        // 仅处理 /open/ 前缀请求
        if (!path.startsWith("/open/")) {
            return chain.filter(exchange);
        }

        // OAuth2 端点放行
        if (path.startsWith("/open/oauth/")) {
            return chain.filter(exchange);
        }

        return authenticate(request)
            .flatMap(identity -> authorize(identity, path, request.getMethod()))
            .flatMap(identity -> checkQuota(identity, path))
            .flatMap(identity -> {
                // 将身份信息注入下游请求头
                injectIdentityHeaders(exchange, identity);
                long startTime = System.currentTimeMillis();
                return chain.filter(exchange)
                    .doOnSuccess(v -> recordUsage(exchange, identity, startTime, true))
                    .doOnError(e -> recordUsage(exchange, identity, startTime, false));
            })
            .onErrorResume(OpenApiException.class, e -> rejectResponse(exchange, e));
    }

    /**
     * 身份认证：解析 Bearer Token 或 API Key
     */
    private Mono<IdentityContext> authenticate(ServerHttpRequest request) {
        String authHeader = request.getHeaders().getFirst("Authorization");
        String apiKeyHeader = request.getHeaders().getFirst("X-Api-Key");

        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring(7);
            return oauth2Service.validateTokenAsync(sha256(token))
                .map(ctx -> {
                    ctx.setAuthMethod(AuthMethod.OAUTH2);
                    return ctx;
                });
        } else if (apiKeyHeader != null) {
            return apiKeyService.validateAsync(sha256(apiKeyHeader))
                .map(ctx -> {
                    ctx.setAuthMethod(AuthMethod.API_KEY);
                    return ctx;
                });
        } else {
            return Mono.error(new OpenApiException("OPEN_40101", "Missing authentication credentials"));
        }
    }

    /**
     * 权限校验：检查应用状态和 Scope
     */
    private Mono<IdentityContext> authorize(IdentityContext identity, String path, HttpMethod method) {
        // 应用状态检查
        if (identity.getAppStatus() != AppStatus.PUBLISHED && identity.getEnvironment() != Env.SANDBOX) {
            return Mono.error(new OpenApiException("OPEN_40302",
                "Application is not published"));
        }

        // Scope 检查
        ApiEndpoint endpoint = endpointRegistry.find(path, method.name());
        if (endpoint == null) {
            return Mono.error(new OpenApiException("OPEN_40001", "Unknown API endpoint"));
        }

        Set<String> requiredScopes = endpoint.getRequiredScopes();
        if (!identity.getScopes().containsAll(requiredScopes)) {
            return Mono.error(new OpenApiException("OPEN_40301",
                "Insufficient scope. Required: " + requiredScopes));
        }

        return Mono.just(identity);
    }

    /**
     * 配额检查
     */
    private Mono<IdentityContext> checkQuota(IdentityContext identity, String path) {
        return quotaManager.checkAndConsumeAsync(
            identity.getApplicationId(),
            path,
            identity.getEnvironment()
        ).map(result -> {
            if (result.getStatus() == QuotaStatus.RATE_LIMITED) {
                throw new OpenApiException("OPEN_42901", "Rate limit exceeded");
            }
            if (result.getStatus() == QuotaStatus.QUOTA_EXCEEDED) {
                throw new OpenApiException("OPEN_42902", "Daily quota exceeded");
            }
            // 注入配额信息到响应头
            identity.setQuotaInfo(result);
            return identity;
        });
    }

    private void injectIdentityHeaders(ServerWebExchange exchange, IdentityContext identity) {
        ServerHttpRequest mutable = exchange.getRequest().mutate()
            .header("X-Open-App-Id", String.valueOf(identity.getApplicationId()))
            .header("X-Open-App-Name", identity.getAppName())
            .header("X-Open-User-Id", identity.getUserId() != null
                ? String.valueOf(identity.getUserId()) : "")
            .header("X-Open-Auth-Method", identity.getAuthMethod().name())
            .header("X-Open-Scopes", String.join(",", identity.getScopes()))
            .build();
        exchange.setRequest(mutable);
    }

    private void recordUsage(ServerWebExchange exchange, IdentityContext identity,
                             long startTime, boolean success) {
        int responseTime = (int) (System.currentTimeMillis() - startTime);
        int statusCode = exchange.getResponse().getStatusCode() != null
            ? exchange.getResponse().getStatusCode().value() : 500;
        usageRecorder.recordAsync(UsageRecord.builder()
            .applicationId(identity.getApplicationId())
            .userId(identity.getUserId())
            .endpointPath(exchange.getRequest().getURI().getPath())
            .method(exchange.getRequest().getMethod().name())
            .statusCode(statusCode)
            .responseTimeMs(responseTime)
            .requestId(exchange.getRequest().getId())
            .ipAddress(exchange.getRequest().getRemoteAddress() != null
                ? exchange.getRequest().getRemoteAddress().getAddress().getHostAddress() : null)
            .tokensConsumed(identity.getTokensConsumed())
            .build());
    }

    private Mono<Void> rejectResponse(ServerWebExchange exchange, OpenApiException e) {
        HttpStatus httpStatus = mapErrorCodeToHttpStatus(e.getCode());
        exchange.getResponse().setStatusCode(httpStatus);
        exchange.getResponse().getHeaders().setContentType(MediaType.APPLICATION_JSON);
        String body = String.format(
            "{\"code\":\"%s\",\"message\":\"%s\",\"request_id\":\"%s\",\"timestamp\":%d}",
            e.getCode(), e.getMessage(), exchange.getRequest().getId(),
            System.currentTimeMillis()
        );
        DataBuffer buffer = exchange.getResponse().bufferFactory().wrap(body.getBytes(StandardCharsets.UTF_8));
        return exchange.getResponse().writeWith(Mono.just(buffer));
    }
}
```

### 5.3 OAuth2 服务核心实现

```java
@Service
@Transactional
public class OAuth2ServiceImpl implements OAuth2Service {

    private final OpenOauthGrantMapper grantMapper;
    private final OpenAccessTokenMapper tokenMapper;
    private final OpenApplicationMapper appMapper;
    private final RedisTemplate<String, Object> redisTemplate;

    private static final int CODE_EXPIRE_SECONDS = 600;          // 10分钟
    private static final int ACCESS_TOKEN_EXPIRE_SECONDS = 7200;  // 2小时
    private static final int REFRESH_TOKEN_EXPIRE_SECONDS = 2592000; // 30天
    private static final String TOKEN_CACHE_PREFIX = "open:token:";

    @Override
    public String generateAuthCode(Long appId, Long userId, Set<String> requestedScopes,
                                    String redirectUri) {
        // 1. 校验应用回调地址
        OpenApplication app = appMapper.selectById(appId);
        validateRedirectUri(app, redirectUri);

        // 2. 过滤scope：仅保留应用被允许申请的范围
        Set<String> allowedScopes = getAllowedScopes(appId);
        Set<String> grantedScopes = requestedScopes.stream()
            .filter(allowedScopes::contains)
            .collect(Collectors.toSet());

        if (grantedScopes.isEmpty()) {
            throw new OpenApiException("OPEN_40004", "No valid scope requested");
        }

        // 3. 生成授权码
        String code = "pt_open_code_" + SecureRandomStringUtils.randomAlphanumeric(32);

        // 4. 存储授权记录
        OpenOauthGrant grant = new OpenOauthGrant();
        grant.setUserId(userId);
        grant.setApplicationId(appId);
        grant.setScopeCodes(new ArrayList<>(grantedScopes));
        grant.setGrantType("authorization_code");
        grant.setCode(code);
        grant.setCodeExpiresAt(LocalDateTime.now().plusSeconds(CODE_EXPIRE_SECONDS));
        grant.setRedirectUri(redirectUri);
        grant.setStatus(0);
        grantMapper.insert(grant);

        return code;
    }

    @Override
    public TokenPair exchangeToken(String code, String appKey, String appSecret) {
        // 1. 验证应用凭证
        OpenApplication app = validateAppCredentials(appKey, appSecret);

        // 2. 查询并校验授权码
        OpenOauthGrant grant = grantMapper.selectByCode(code);
        if (grant == null || !grant.getApplicationId().equals(app.getId())) {
            throw new OpenApiException("OPEN_40001", "Invalid authorization code");
        }
        if (grant.getCodeExpiresAt().isBefore(LocalDateTime.now())) {
            grant.setStatus(3); // 过期
            grantMapper.updateById(grant);
            throw new OpenApiException("OPEN_40001", "Authorization code expired");
        }
        if (grant.getStatus() != 0) {
            throw new OpenApiException("OPEN_40001", "Authorization code already used");
        }

        // 3. 生成 Token 对
        String accessToken = "pt_open_at_" + SecureRandomStringUtils.randomAlphanumeric(48);
        String refreshToken = "pt_open_rt_" + SecureRandomStringUtils.randomAlphanumeric(48);

        LocalDateTime now = LocalDateTime.now();
        LocalDateTime accessExpiry = now.plusSeconds(ACCESS_TOKEN_EXPIRE_SECONDS);
        LocalDateTime refreshExpiry = now.plusSeconds(REFRESH_TOKEN_EXPIRE_SECONDS);

        // 4. 持久化 Token
        OpenAccessToken token = new OpenAccessToken();
        token.setGrantId(grant.getId());
        token.setUserId(grant.getUserId());
        token.setApplicationId(grant.getApplicationId());
        token.setTokenHash(sha256(accessToken));
        token.setRefreshTokenHash(sha256(refreshToken));
        token.setScopeCodes(grant.getScopeCodes());
        token.setExpiresAt(accessExpiry);
        token.setRefreshExpiresAt(refreshExpiry);
        token.setStatus(1);
        tokenMapper.insert(token);

        // 5. 更新授权记录状态
        grant.setStatus(1);
        grantMapper.updateById(grant);

        // 6. 缓存 Access Token
        cacheToken(token, accessToken);

        return TokenPair.builder()
            .accessToken(accessToken)
            .tokenType("Bearer")
            .expiresIn(ACCESS_TOKEN_EXPIRE_SECONDS)
            .refreshToken(refreshToken)
            .refreshExpiresIn(REFRESH_TOKEN_EXPIRE_SECONDS)
            .scope(String.join(" ", grant.getScopeCodes()))
            .build();
    }

    @Override
    public AccessTokenContext validateToken(String tokenHash) {
        // 1. 查缓存
        String cacheKey = TOKEN_CACHE_PREFIX + tokenHash;
        AccessTokenContext cached = (AccessTokenContext) redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            return cached;
        }

        // 2. 查数据库
        OpenAccessToken token = tokenMapper.selectByTokenHash(tokenHash);
        if (token == null || token.getStatus() != 1) {
            return null; // 无效
        }
        if (token.getExpiresAt().isBefore(LocalDateTime.now())) {
            token.setStatus(2); // 过期
            tokenMapper.updateById(token);
            return null;
        }

        // 3. 构建上下文并缓存
        AccessTokenContext ctx = AccessTokenContext.builder()
            .userId(token.getUserId())
            .applicationId(token.getApplicationId())
            .scopes(new HashSet<>(token.getScopeCodes()))
            .expiresAt(token.getExpiresAt())
            .build();

        long ttl = Duration.between(LocalDateTime.now(), token.getExpiresAt()).getSeconds();
        redisTemplate.opsForValue().set(cacheKey, ctx, ttl, TimeUnit.SECONDS);

        return ctx;
    }

    private void cacheToken(OpenAccessToken token, String rawToken) {
        String cacheKey = TOKEN_CACHE_PREFIX + token.getTokenHash();
        AccessTokenContext ctx = AccessTokenContext.builder()
            .userId(token.getUserId())
            .applicationId(token.getApplicationId())
            .scopes(new HashSet<>(token.getScopeCodes()))
            .expiresAt(token.getExpiresAt())
            .build();
        long ttl = Duration.between(LocalDateTime.now(), token.getExpiresAt()).getSeconds();
        redisTemplate.opsForValue().set(cacheKey, ctx, ttl, TimeUnit.SECONDS);
    }
}
```

### 5.4 配额管理器

```java
@Service
public class QuotaManagerImpl implements QuotaManager {

    private final RedisTemplate<String, String> redisTemplate;
    private final OpenSubscriptionMapper subscriptionMapper;
    private final OpenApiPackageMapper packageMapper;

    private static final String RATE_WINDOW_KEY = "open:ratelimit:app:%d:window";
    private static final String DAILY_QUOTA_KEY = "open:quota:app:%d:daily:%s";
    private static final String CONCURRENT_KEY = "open:concurrent:app:%d";

    @Override
    public Mono<QuotaResult> checkAndConsumeAsync(Long appId, String endpoint, Env env) {
        return Mono.fromCallable(() -> checkAndConsume(appId, endpoint, env))
            .subscribeOn(Schedulers.boundedElastic());
    }

    public QuotaResult checkAndConsume(Long appId, String endpoint, Env env) {
        // 1. 获取应用套餐
        OpenApiPackage pkg = getAppPackage(appId, env);
        if (pkg == null) {
            return QuotaResult.blocked("No active subscription");
        }

        // 2. 滑动窗口限流（每分钟）
        String rateKey = String.format(RATE_WINDOW_KEY, appId);
        long now = System.currentTimeMillis();
        long windowStart = now - 60_000;

        // 清除窗口外记录
        redisTemplate.opsForZSet().removeRangeByScore(rateKey, 0, windowStart);
        Long currentCount = redisTemplate.opsForZSet().zCard(rateKey);
        if (currentCount != null && currentCount >= pkg.getRateLimitPerMin()) {
            return QuotaResult.rateLimited(pkg.getRateLimitPerMin());
        }
        // 加入窗口
        redisTemplate.opsForZSet().add(rateKey, UUID.randomUUID().toString(), now);
        redisTemplate.expire(rateKey, 70, TimeUnit.SECONDS);

        // 3. 每日配额检查
        String today = LocalDate.now().format(DateTimeFormatter.ISO_DATE);
        String quotaKey = String.format(DAILY_QUOTA_KEY, appId, today);
        String countStr = redisTemplate.opsForValue().get(quotaKey);
        long dailyCount = countStr != null ? Long.parseLong(countStr) : 0;
        if (dailyCount >= pkg.getDailyQuota()) {
            return QuotaResult.quotaExceeded(pkg.getDailyQuota());
        }
        // 原子递增
        Long newCount = redisTemplate.opsForValue().increment(quotaKey);
        if (newCount == 1) {
            redisTemplate.expire(quotaKey, 48, TimeUnit.HOURS);
        }

        return QuotaResult.allowed(pkg.getDailyQuota(), newCount.intValue(), pkg.getRateLimitPerMin());
    }

    private OpenApiPackage getAppPackage(Long appId, Env env) {
        OpenSubscription sub = subscriptionMapper.selectActiveByAppAndEnv(appId, env.getValue());
        if (sub == null) {
            return null;
        }
        return packageMapper.selectById(sub.getPackageId());
    }
}
```

### 5.5 Webhook 投递服务

```java
@Service
public class WebhookDispatcherImpl implements WebhookDispatcher {

    private final OpenWebhookSubscriptionMapper subMapper;
    private final OpenWebhookDeliveryMapper deliveryMapper;
    private final WebClient webClient;
    private final RabbitTemplate rabbitTemplate;

    private static final int MAX_RETRIES = 5;
    private static final Duration[] BACKOFF_INTERVALS = {
        Duration.ofMinutes(1),
        Duration.ofMinutes(5),
        Duration.ofMinutes(30),
        Duration.ofHours(2),
        Duration.ofHours(6)
    };

    @Override
    @RabbitListener(queues = "open.webhook.events")
    public void dispatch(OpenEvent event) {
        // 1. 查找匹配的订阅
        List<OpenWebhookSubscription> subs = subMapper.selectByEventType(
            event.getType(), event.getTargetAppIds());

        if (subs.isEmpty()) {
            return;
        }

        // 2. 逐个投递
        for (OpenWebhookSubscription sub : subs) {
            if (sub.getStatus() != 1) continue; // 暂停的跳过

            sendDelivery(sub, event);
        }
    }

    private void sendDelivery(OpenWebhookSubscription sub, OpenEvent event) {
        // 创建投递记录
        OpenWebhookDelivery delivery = new OpenWebhookDelivery();
        delivery.setSubscriptionId(sub.getId());
        delivery.setEventId(event.getEventId());
        delivery.setEventType(event.getType());
        delivery.setPayload(event.getPayload());
        delivery.setAttemptCount(0);
        delivery.setStatus(0); // 待发送

        try {
            // 构造请求
            String rawBody = JSON.toJSONString(event.getPayload());
            String timestamp = String.valueOf(System.currentTimeMillis() / 1000);
            String signature = hmacSha256(sub.getSecretToken(),
                event.getEventId() + timestamp + rawBody);

            WebClient.ResponseSpec response = webClient.post()
                .uri(sub.getCallbackUrl())
                .header("Content-Type", "application/json")
                .header("X-Webhook-Event-Id", event.getEventId())
                .header("X-Webhook-Event-Type", event.getType())
                .header("X-Webhook-Timestamp", timestamp)
                .header("X-Webhook-Signature", "sha256=" + signature)
                .bodyValue(rawBody)
                .retrieve();

            String responseBody = response.bodyToMono(String.class)
                .timeout(Duration.ofSeconds(10))
                .block();

            delivery.setResponseStatus(200);
            delivery.setResponseBody(responseBody);
            delivery.setStatus(1); // 成功
            delivery.setDeliveredAt(LocalDateTime.now());

            sub.setSuccessCount(sub.getSuccessCount() + 1);
            subMapper.updateById(sub);

        } catch (Exception e) {
            delivery.setAttemptCount(delivery.getAttemptCount() + 1);
            delivery.setStatus(3); // 重试中
            delivery.setNextRetryAt(calculateNextRetry(delivery.getAttemptCount()));

            if (delivery.getAttemptCount() >= MAX_RETRIES) {
                delivery.setStatus(4); // 放弃
                sub.setFailCount(sub.getFailCount() + 1);
                subMapper.updateById(sub);

                // 发送告警
                alertDeveloper(sub.getApplicationId(),
                    "Webhook delivery failed after " + MAX_RETRIES + " attempts: " + sub.getCallbackUrl());
            }
        }

        deliveryMapper.insert(delivery);
    }

    /**
     * 定时重试失败投递
     */
    @Scheduled(fixedDelay = 60_000)
    public void retryFailedDeliveries() {
        List<OpenWebhookDelivery> pending = deliveryMapper.selectRetryCandidates(
            LocalDateTime.now(), 100);

        for (OpenWebhookDelivery delivery : pending) {
            OpenWebhookSubscription sub = subMapper.selectById(delivery.getSubscriptionId());
            if (sub == null || sub.getStatus() != 1) continue;

            OpenEvent event = OpenEvent.builder()
                .eventId(delivery.getEventId())
                .type(delivery.getEventType())
                .payload(delivery.getPayload())
                .build();

            sendDelivery(sub, event);
        }
    }

    private LocalDateTime calculateNextRetry(int attempt) {
        int idx = Math.min(attempt, BACKOFF_INTERVALS.length - 1);
        return LocalDateTime.now().plus(BACKOFF_INTERVALS[idx]);
    }

    private String hmacSha256(String secret, String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] hash = mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (Exception e) {
            throw new RuntimeException("HMAC computation failed", e);
        }
    }
}
```

### 5.6 开发者门户前端 API 调用示例 (第三方视角)

```typescript
// === 第三方应用示例：调用 PrimeTop 开放 API ===

const APP_KEY = 'pt_open_ak_your_app_key';
const APP_SECRET = 'pt_open_sk_your_app_secret';

// Step 1: 引导用户授权
function buildAuthorizeUrl(state: string): string {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: APP_KEY,
        redirect_uri: 'https://yourapp.com/callback',
        scope: 'question:read learning:read ai:tutor',
        state: state,
    });
    return `https://api.primetop.com/open/oauth/authorize?${params}`;
}

// Step 2: 回调处理，用 code 换 token
async function handleCallback(code: string): Promise<TokenPair> {
    const basicAuth = btoa(`${APP_KEY}:${APP_SECRET}`);
    const res = await fetch('https://api.primetop.com/open/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: 'https://yourapp.com/callback',
        }),
    });
    const json = await res.json();
    return json.data;
}

// Step 3: 调用业务 API
async function searchQuestions(accessToken: string, params: QuestionSearchParams) {
    const query = new URLSearchParams({
        subject: params.subject,
        grade: String(params.grade),
        knowledge_point: params.knowledgePoint || '',
        page: String(params.page || 1),
        page_size: String(params.pageSize || 20),
    });
    const res = await fetch(`https://api.primetop.com/open/v1/questions/search?${query}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    return res.json();
}

// Step 4: AI 辅导 (SSE 流式)
async function aiTutorStream(accessToken: string, question: string, grade: number) {
    const res = await fetch('https://api.primetop.com/open/v1/ai/tutor', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            question,
            context: { grade, subject: 'math' },
            stream: true,
        }),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (line.startsWith('event: ')) {
                const eventType = line.slice(7);
            } else if (line.startsWith('data: ')) {
                const data = JSON.parse(line.slice(6));
                // 处理数据...
            }
        }
    }
}
```

---

## 6. 错误处理

### 6.1 异常分类与处理策略

| 异常类型 | 触发场景 | HTTP状态码 | 是否计费 | 是否告警 |
| --- | --- | --- | --- | --- |
| 认证失败 | Token无效/过期/被撤销 | 401 | 否 | 否 |
| 权限不足 | Scope不匹配/应用未上线 | 403 | 否 | 高频时告警 |
| 参数错误 | 请求体不合法/缺少必填字段 | 400 | 否 | 否 |
| 频率超限 | 超过每分钟调用上限 | 429 | 否 | 连续触发时告警 |
| 配额耗尽 | 超过每日调用配额 | 429 | 否 | 告警开发者 |
| 内部错误 | 下游服务异常 | 500/502 | 否 | 立即告警 |
| 维护中 | 计划维护期间 | 503 | 否 | 提前通知 |

### 6.2 限流降级策略

```
┌──────────────────────────────────────────────────┐
│              限流降级层级                         │
├──────────────────────────────────────────────────┤
│                                                  │
│  Level 1: 接口级限流 (滑动窗口)                   │
│  - 默认: 60次/分钟/应用                           │
│  - 套餐配置: 免费30/基础100/专业300/企业1000      │
│  - 超限: HTTP 429 + Retry-After 头               │
│                                                  │
│  Level 2: 每日配额 (日计数器)                     │
│  - 默认: 1000次/天/应用                           │
│  - 套餐配置: 免费100/基础5000/专业50000/企业不限  │
│  - 超限: HTTP 429 + 告知次日重置                  │
│                                                  │
│  Level 3: AI Token 配额                          │
│  - 按套餐分配每日 AI Token 上限                   │
│  - 超限: 返回降级模型 或 429                      │
│                                                  │
│  Level 4: 全局保护 (熔断器)                       │
│  - 整体开放API错误率 > 10% → 熔断                 │
│  - 恢复: 30秒后半开探测                           │
│  - 降级: 返回缓存数据/简化结果                    │
│                                                  │
└──────────────────────────────────────────────────┘
```

### 6.3 Webhook 投递失败处理

```java
/**
 * Webhook 投递失败时的降级策略
 */
public class WebhookFailureHandler {

    /**
     * 连续失败告警阈值
     */
    private static final int CONSECUTIVE_FAIL_THRESHOLD = 10;

    /**
     * 处理投递失败
     */
    public void handleFailure(OpenWebhookSubscription sub, OpenWebhookDelivery delivery) {
        int failCount = sub.getFailCount();

        // 连续失败超过阈值 → 自动暂停订阅
        if (failCount >= CONSECUTIVE_FAIL_THRESHOLD) {
            sub.setStatus(0); // 暂停
            subMapper.updateById(sub);

            // 通知开发者
            notificationService.notifyDeveloper(sub.getApplicationId(),
                "Webhook订阅已自动暂停：连续" + CONSECUTIVE_FAIL_THRESHOLD + "次投递失败。" +
                "回调地址: " + sub.getCallbackUrl() + "\n" +
                "请在开发者中心检查回调地址可用性后手动恢复。");
        }

        // 投递最终失败 → 事件入死信队列
        if (delivery.getStatus() == 4) { // 放弃
            rabbitTemplate.convertAndSend("open.webhook.dead_letter", delivery);
        }
    }
}
```

---

## 7. 性能优化

### 7.1 缓存层级

```
请求 → CDN (API文档静态资源)
         │
         ▼
       API Gateway
         │
         ▼
    Token/ApiKey 解析 → Redis (5min TTL)
         │              ↗ 缓存未命中查 DB
         ▼
    Scope/权限查询 → Redis (10min TTL)
         │
         ▼
    配额检查 → Redis (实时 INCR)
         │
         ▼
    业务路由 → 内部服务
         │
         ▼
    数据返回 → 本地缓存 (热点题目/知识点, 1min TTL)
```

### 7.2 数据库优化

| 优化项 | 方案 |
| --- | --- |
| usage_record 分区 | 按月 RANGE 分区，3个月前数据归档 ClickHouse |
| 读写分离 | 开放平台查询走只读副本 |
| 连接池 | HikariCP，max-pool-size=50，开放平台独立连接池 |
| 慢查询 | usage_record 查询必须走索引 (app_id + created_at) |
| 批量写入 | usage_record 批量异步写入 (每500条或每5秒flush) |

### 7.3 并发控制

```yaml
# 开放平台并发限制
open-api:
  gateway:
    max-concurrent-requests: 2000      # 网关总并发
    per-app-concurrent-default: 10     # 单应用默认并发
    per-app-concurrent-enterprise: 100 # 企业套餐并发
  webhook:
    dispatcher-pool-size: 20           # Webhook投递线程池
    max-retry-per-event: 5             # 单事件最大重试
    retry-batch-size: 100              # 每轮重试批量
  oauth:
    token-cache-ttl: 7200s             # Token缓存与过期同步
    code-cache-ttl: 600s               # 授权码缓存
```

---

## 8. 安全考虑

### 8.1 安全防护体系

```
┌────────────────────────────────────────────────────┐
│                 开放平台安全防护层                    │
├────────────────────────────────────────────────────┤
│                                                    │
│  Layer 1: 传输安全                                  │
│  ✓ 强制 HTTPS (HSTS)                               │
│  ✓ TLS 1.2+ 仅                                     │
│  ✓ 证书钉扎 (开发者优先)                             │
│                                                    │
│  Layer 2: 身份安全                                  │
│  ✓ API Key/Secret 分离，Secret 仅创建时展示一次      │
│  ✓ AppSecret 存储: AES-256-GCM 加密                │
│  ✓ Access Token: SHA-256 哈希存储，明文仅缓存       │
│  ✓ Refresh Token: 轮转机制（刷新即失效旧的）         │
│                                                    │
│  Layer 3: 授权安全                                  │
│  ✓ 高风险Scope需用户二次确认                        │
│  ✓ 用户可随时在"我的授权"中撤销应用授权              │
│  ✓ 应用下架时自动撤销所有用户令牌                   │
│  ✓ 授权码一次性使用 + 10分钟过期                    │
│                                                    │
│  Layer 4: 数据安全                                  │
│  ✓ 未成年人学习数据: 需家长额外授权                 │
│  ✓ 响应数据脱敏: 手机号/邮箱/真实姓名默认掩码       │
│  ✓ 第三方不可获取其他用户数据                       │
│  ✓ 审计日志: 全量记录API调用                       │
│                                                    │
│  Layer 5: 反滥用                                    │
│  ✓ 多维度限流(IP/App/User/Endpoint)                │
│  ✓ 异常调用模式检测(短时间内大量用户授权请求)       │
│  ✓ 蜜罐API检测恶意爬取                              │
│  ✓ 应用信誉评分(违规扣分→限制→封禁)                │
│                                                    │
└────────────────────────────────────────────────────┘
```

### 8.2 应用信誉评分模型

```java
/**
 * 应用信誉评分
 * 初始分100，低于60分限制调用，低于30分自动封禁
 */
@Data
public class AppCreditScore {
    private Long applicationId;
    private int score;              // 0-100
    private int violationCount;     // 累计违规次数
    private LocalDateTime lastUpdated;

    // 扣分规则
    public static final int PENALTY_USER_COMPLAINT = -5;      // 用户投诉
    public static final int PENALTY_DATA_ABUSE = -20;         // 数据滥用
    public static final int PENALTY_RATE_VIOLATION = -3;      // 频率违规
    public static final int PENALTY_CONTENT_VIOLATION = -15;  // 内容违规
    public static final int PENALTY_SECURITY_INCIDENT = -30;  // 安全事件

    // 加分规则（每月评估一次）
    public static final int BONUS_NO_VIOLATION = +2;          // 无违规月
    public static final int BONUS_HIGH_SATISFACTION = +3;     // 用户高满意
}
```

### 8.3 审计日志

```json
{
    "log_type": "open_api_call",
    "request_id": "req_1783200000_abc123",
    "timestamp": "2026-07-04T00:59:00.000Z",
    "application_id": 1001,
    "app_name": "智慧校园系统",
    "api_key_id": 5001,
    "user_id": 10086,
    "auth_method": "OAUTH2",
    "endpoint": "GET /open/v1/learning/mistakes",
    "status_code": 200,
    "response_time_ms": 156,
    "ip": "203.0.113.42",
    "user_agent": "SmartCampus/2.1.0",
    "scopes_used": ["learning:read"],
    "quota_remaining": 4998
}
```

---

## 9. 测试策略

### 9.1 单元测试重点

| 模块 | 测试重点 | 覆盖目标 |
| --- | --- | --- |
| OAuth2Service | 授权码生成/交换/过期/重放/撤销 | ≥95% |
| QuotaManager | 限流/配额/并发/边界/重置 | ≥90% |
| WebhookDispatcher | 投递/重试/签名验证/自动暂停 | ≥90% |
| AppReviewService | 审核流程/自动检查/状态流转 | ≥85% |
| OpenApiGatewayFilter | 鉴权/路由/错误响应/计量 | ≥90% |

### 9.2 集成测试场景

```
场景1: OAuth2 完整流程
  1. 创建开发者 → 创建应用 → 创建沙箱密钥
  2. 用户授权 → 获取code → 换token
  3. 携带token调用 /open/v1/user/info → 验证返回用户信息
  4. Token过期 → 刷新 → 继续调用
  5. 用户撤销授权 → 调用返回401

场景2: 配额限制
  1. 免费套餐应用，配额=100次/天
  2. 连续调用100次 → 第101次返回429
  3. 每分钟限流60次 → 第61次返回429
  4. 验证Retry-After头

场景3: Webhook投递
  1. 创建Webhook订阅 (event_types: ["learning.mistake_added"])
  2. 模拟学生添加错题 → 验证Webhook投递
  3. 模拟回调地址不可用 → 验证重试调度
  4. 连续失败10次 → 验证自动暂停

场景4: 应用审核
  1. 开发者提交应用审核
  2. 自动检查通过 → 人工审核通过 → 状态变为PUBLISHED
  3. 生产环境API Key生效
  4. 模拟审核拒绝 → 应用保持REJECTED状态

场景5: 安全测试
  1. 伪造Token → 返回401
  2. 越权访问其他用户数据 → 返回403
  3. 篡改Webhook签名 → 回调被拒绝
  4. CSRF攻击授权接口 → state校验拦截
```

### 9.3 压力测试目标

| 指标 | 目标 |
| --- | --- |
| OAuth2 Token验证 | ≥5000 QPS |
| API Gateway 总吞吐 | ≥3000 QPS |
| Webhook 并发投递 | ≥500 events/s |
| Token缓存命中率 | ≥95% |
| P99 响应延迟(网关层) | ≤50ms |

---

## 10. 开发者门户功能设计

### 10.1 页面结构

```
开发者门户 (developer.primetop.com)
├── 首页 (概览、公告、快速入口)
├── 应用管理
│   ├── 应用列表
│   ├── 创建应用
│   ├── 应用详情
│   │   ├── 基本信息
│   │   ├── API密钥管理 (创建/查看/禁用)
│   │   ├── 权限范围配置
│   │   ├── Webhook订阅管理
│   │   ├── 用量统计 (调用趋势/接口分布/错误率)
│   │   └── 审核记录
│   └── 应用审核提交
├── API文档
│   ├── 快速开始指南
│   ├── 接口列表 (可在线调试)
│   ├── 错误码参考
│   ├── OAuth2 授权流程说明
│   └── SDK下载
├── 套餐与计费
│   ├── 当前套餐
│   ├── 升级/降级
│   ├── 账单记录
│   └── 充值/支付
├── 沙箱环境
│   ├── 测试数据管理
│   ├── Mock 接口配置
│   └── 调试日志
└── 设置
    ├── 开发者资料
    ├── 实名认证
    └── 消息通知
```

### 10.2 API 文档在线调试

集成 Swagger UI / OpenAPI 渲染器，支持：

1. **在线试用**：直接在文档页面发起 API 调用（沙箱环境）
2. **Token 自动填充**：使用沙箱环境 Token 自动授权
3. **多语言代码生成**：Java / Python / Node.js / cURL / Go
4. **请求/响应示例**：每个接口提供至少 2 个场景示例
5. **错误场景模拟**：可模拟 401/403/429 等错误响应

---

## 11. 部署架构

```
                        ┌─────────────────────┐
                        │   开发者门户 (Web)   │
                        │  developer.primetop  │
                        └──────────┬──────────┘
                                   │
┌────────────┐            ┌───────┴────────┐
│ 第三方应用  │───────────>│  API Gateway   │
│ (外部)     │            │  /open/* 路由   │
└────────────┘            └───────┬────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │              │
                    ▼             ▼              ▼
          ┌──────────────┐ ┌───────────┐ ┌──────────────┐
          │ OAuth2 Service│ │ 开放API    │ │ Webhook      │
          │ (鉴权中心)    │ │ 业务路由   │ │ Dispatcher   │
          └──────┬───────┘ └─────┬─────┘ └──────┬───────┘
                 │               │              │
                 ▼               ▼              ▼
          ┌──────────────────────────────────────────┐
          │              Redis Cluster                │
          │  (Token缓存 / 配额计数 / 限流窗口)         │
          └──────────────────────────────────────────┘
                 │               │              │
                 ▼               ▼              ▼
          ┌──────────────────────────────────────────┐
          │            MySQL (主从)                   │
          │  开发者/应用/密钥/授权/订阅/审核           │
          └──────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                    ▼
          ┌──────────────┐      ┌──────────────┐
          │ RabbitMQ     │      │ ClickHouse   │
          │ (Webhook MQ) │      │ (用量分析)    │
          └──────────────┘      └──────────────┘
```

**部署要求：**

| 组件 | 副本数 | CPU | 内存 | 说明 |
| --- | --- | --- | --- | --- |
| API Gateway | 4+ | 2C | 4G | 可水平扩展 |
| OAuth2 Service | 2+ | 1C | 2G | 无状态 |
| Webhook Dispatcher | 3+ | 1C | 2G | Worker 模式 |
| Redis | 3 (集群) | 2C | 8G | 主从+哨兵 |
| MySQL | 1主1从 | 4C | 16G | 独立实例或逻辑库 |
| RabbitMQ | 3 (集群) | 1C | 4G | 镜像队列 |
| ClickHouse | 1 | 4C | 16G | 用量分析 |

> **注意：** 开放平台数据库建议与主业务数据库物理隔离，避免第三方流量影响内部服务质量。

---

## 12. 版本演进路线

### 12.1 Phase 1: MVP (V2.0)

- 开发者注册与实名认证
- 应用创建与沙箱密钥管理
- OAuth2 授权码模式
- 基础 API 开放：题目搜索、知识点查询、用户信息
- API 文档门户 (Swagger)
- 基础配额管控 (免费套餐)
- Webhook 基础投递

### 12.2 Phase 2: 成长期 (V2.5)

- 应用审核流程 (自动+人工)
- 应用市场 (公开可搜索)
- 更多 API：AI 辅导、学情报告、错题数据
- 分层套餐与在线支付
- Webhook 重试与告警
- API 在线调试工具
- 多语言 SDK (Java/Python)

### 12.3 Phase 3: 成熟期 (V3.0)

- 联邦学习与隐私计算集成
- 教育数据互操作标准 (IMS Caliper / xAPI) 适配
- 第三方内容插件框架
- 学校 SSO 集成 (SAML / CAS)
- 应用信誉体系与自动风控
- GraphQL 查询接口
- 实时数据流 (WebSocket / SSE) 开放

---

## 附录 A: 权限范围 (Scope) 完整定义

| Scope Code | 资源 | 可访问接口 | 数据粒度 | 审核要求 |
| --- | --- | --- | --- | --- |
| `user:profile` | 用户基本资料 | `/user/info` | 昵称、学段、年级 | 自动审核 |
| `question:read` | 题目库 | `/questions/*` | 公开题库，不含会员专享题 | 自动审核 |
| `knowledge:read` | 知识图谱 | `/knowledge/*` | 公开知识点体系 | 自动审核 |
| `ai:tutor` | AI 辅导 | `/ai/tutor` | 消耗 AI 资源 | 人工审核 |
| `ai:essay` | 作文批改 | `/ai/essay-grading` | 消耗 AI 资源 | 人工审核 |
| `learning:read` | 学习记录 | `/learning/records`, `/learning/mistakes` | 仅授权用户自身数据 | 人工审核 + 数据保护声明 |
| `learning:report` | 学情报告 | `/learning/report` | 授权用户学情分析 | 人工审核 + 数据保护声明 |
| `webhook:manage` | Webhook 管理 | `/webhooks/*` | 应用自身配置 | 自动审核 |

## 附录 B: 环境对照

| 维度 | 沙箱环境 | 生产环境 |
| --- | --- | --- |
| API Base URL | `https://api-sandbox.primetop.com/open/` | `https://api.primetop.com/open/` |
| 数据 | Mock 数据 + 有限脱敏样本 | 真实数据 |
| 配额 | 宽松（免费1000次/天） | 按套餐 |
| 速率限制 | 120次/分钟 | 按套餐（默认60次/分钟） |
| AI 模型 | 降级模型/缓存结果 | 完整模型 |
| Webhook | 投递到模拟回调 | 真实投递 |
| 计费 | 不计费 | 按套餐计费 |
| 可用性 | 99% (工作日工作时间) | 99.9% |
