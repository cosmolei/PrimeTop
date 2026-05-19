# B端合作与机构接入方案 - 详细设计

> 版本：v1.0 | 更新日期：2026-05-20 | 状态：✅ 已完成

## 目录

1. [概述](#1-概述)
2. [系统架构](#2-系统架构)
3. [多租户数据模型](#3-多租户数据模型)
4. [机构注册与认证](#4-机构注册与认证)
5. [机构管理后台](#5-机构管理后台)
6. [批量用户管理](#6-批量用户管理)
7. [数据隔离策略](#7-数据隔离策略)
8. [机构API开放平台](#8-机构api开放平台)
9. [计费与套餐](#9-计费与套餐)
10. [私有化部署方案](#10-私有化部署方案)
11. [安全与合规](#11-安全与合规)
12. [关键代码示例](#12-关键代码示例)
13. [接口清单](#13-接口清单)
14. [错误码](#14-错误码)
15. [监控与运营](#15-监控与运营)

---

## 1. 概述

### 1.1 设计目标

为学校、教培机构、教育区域平台等B端客户（机构）提供标准化的接入方案，支持机构独立管理师生账号、查看班级学情、配置教学资源，并保证不同机构间的数据隔离与隐私合规。

### 1.2 核心原则

| 原则 | 说明 |
|------|------|
| 数据隔离优先 | 机构间学习数据严格隔离，禁止越权访问 |
| 最小侵入接入 | 机构可通过API对接自有系统，无需改变内部流程 |
| 渐进式合作 | 从SaaS轻量接入 → 深度API对接 → 私有化部署逐级递进 |
| 合规内建 | 满足《个人信息保护法》《未成年人保护法》《数据安全法》要求 |
| 成本透明 | 按用量计费，机构可实时查看用量与成本 |

### 1.3 接入模式

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| **SaaS标准接入** | 机构在PrimeTop平台注册，通过管理后台使用 | 单校/小型机构 |
| **API深度对接** | 通过OpenAPI与机构自有教务系统打通 | 有教务系统的中大型机构 |
| **专属实例部署** | 独立的PrimeTop实例，可定制品牌 | 大型连锁机构/区域教育局 |
| **私有化部署** | 部署在客户自有服务器或私有云 | 有数据主权要求的政府/学校 |

### 1.4 术语定义

| 术语 | 含义 |
|------|------|
| Tenant | 租户，即一个机构（学校/培训机构/教育局） |
| Institution | 机构实体，包含机构基础信息、认证状态、套餐等 |
| Org Admin | 机构管理员，机构内部的超级管理员 |
| Teacher | 教师角色，归属某个机构 |
| Student | 学生角色，可归属机构（班级）或个人用户 |
| OpenAPI | 面向机构开发者的REST API，用于系统对接 |

---

## 2. 系统架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                       B端接入层                               │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ 机构管理  │  │  OpenAPI     │  │  Webhook回调         │   │
│  │ 后台(前端)│  │  Gateway     │  │  通知服务            │   │
│  └────┬─────┘  └──────┬───────┘  └──────────┬───────────┘   │
│       │               │                      │               │
│  ─────┴───────────────┴──────────────────────┴───────────── │
│                       API 网关                                │
│              (鉴权 / 限流 / 租户识别 / 审计日志)               │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────┐
│                      租户服务层                               │
│  ┌────────────┐  ┌────────────┐  ┌───────────────────────┐  │
│  │ 机构服务    │  │ 租户隔离   │  │ 开放平台服务          │  │
│  │ Institution│  │ Middleware │  │ OpenPlatform          │  │
│  │ Service    │  │            │  │ Service               │  │
│  └─────┬──────┘  └─────┬──────┘  └──────────┬────────────┘  │
│        │               │                      │              │
│  ┌─────┴──────┐  ┌─────┴──────┐  ┌──────────┴────────────┐  │
│  │ 认证服务   │  │ 用量计量   │  │ API Key管理           │  │
│  │ Verify     │  │ Metering   │  │ Credential            │  │
│  │ Service    │  │ Service    │  │ Service               │  │
│  └────────────┘  └────────────┘  └───────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────┐
│                      业务服务层 (复用现有)                     │
│  用户服务 │ 学习服务 │ 题目服务 │ AI服务 │ 支付服务 │ ...     │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────┐
│                      数据层                                  │
│  MySQL(租户前缀隔离) │ Redis(租户命名空间) │ ClickHouse      │
│  MinIO(机构资源)     │ ES(租户索引)         │ Kafka           │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 租户识别流程

每次API请求经网关时，通过以下任一方式识别租户：

```
请求到达 API Gateway
       │
       ├── 1. 检查 Header: X-Tenant-ID（管理后台请求）
       │
       ├── 2. 检查 API Key → 反查 tenant_id（OpenAPI请求）
       │
       ├── 3. 检查 JWT Token 中的 tenant_id 字段（已登录用户）
       │
       └── 无租户标识 → 视为个人用户(tenant_id = NULL)
```

### 2.3 新增服务清单

| 服务 | 职责 | 技术栈 |
|------|------|--------|
| `institution-service` | 机构CRUD、认证审核、套餐管理 | FastAPI + SQLAlchemy |
| `tenant-middleware` | 租户识别、数据隔离注入 | FastAPI Middleware |
| `open-platform-service` | API Key管理、调用计量、Webhook | FastAPI + Redis |
| `metering-service` | 用量采集、聚合、账单生成 | FastAPI + ClickHouse |

---

## 3. 多租户数据模型

### 3.1 数据隔离策略选择

经过评估，选择 **共享数据库 + 租户ID字段隔离** 方案，原因：

| 方案 | 优点 | 缺点 | 选择 |
|------|------|------|------|
| 独立数据库 | 完全隔离，可按库备份 | 运维成本高，连接池膨胀 | ❌ |
| 共享数据库+租户ID字段 | 成本低，易扩展 | 需严格过滤 | ✅ |
| Schema隔离 | 中等隔离 | 跨Schema查询复杂 | ❌ |

**隔离保证机制：**
1. ORM层面自动注入 `tenant_id` 过滤条件
2. 中间件层拦截无 `tenant_id` 的查询请求（开发/测试环境强制）
3. 数据库层面可选加 Row-Level Security (RLS) 作为最终防线

### 3.2 核心表结构

#### 3.2.1 机构表 `institutions`

```sql
CREATE TABLE institutions (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id       VARCHAR(32) NOT NULL UNIQUE COMMENT '租户唯一标识，如 TEN001',
    name            VARCHAR(128) NOT NULL COMMENT '机构名称',
    short_name      VARCHAR(64) COMMENT '机构简称',
    type            ENUM('school', 'training_center', 'education_bureau', 'enterprise')
                    NOT NULL COMMENT '机构类型',
    level           ENUM('kindergarten', 'primary', 'middle', 'high', 'vocational', 'comprehensive')
                    COMMENT '学校层级',
    license_no      VARCHAR(64) COMMENT '办学许可证号',
    unified_credit  VARCHAR(32) COMMENT '统一社会信用代码',
    province        VARCHAR(32) NOT NULL COMMENT '省份',
    city            VARCHAR(32) NOT NULL COMMENT '城市',
    district        VARCHAR(32) COMMENT '区县',
    address         VARCHAR(256) COMMENT '详细地址',
    contact_name    VARCHAR(64) NOT NULL COMMENT '联系人姓名',
    contact_phone   VARCHAR(20) NOT NULL COMMENT '联系电话',
    contact_email   VARCHAR(128) COMMENT '联系邮箱',
    logo_url        VARCHAR(512) COMMENT '机构Logo URL',
    brand_config    JSON COMMENT '品牌定制配置(颜色/名称/Logo等)',
    status          ENUM('pending', 'verifying', 'active', 'suspended', 'terminated')
                    NOT NULL DEFAULT 'pending' COMMENT '状态',
    plan_code       VARCHAR(32) COMMENT '当前套餐编码',
    plan_expires_at DATETIME COMMENT '套餐过期时间',
    max_students    INT UNSIGNED DEFAULT 0 COMMENT '最大学生数(0=无限)',
    max_teachers    INT UNSIGNED DEFAULT 0 COMMENT '最大教师数(0=无限)',
    settings        JSON COMMENT '机构级配置(功能开关/自定义参数)',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_status (status),
    INDEX idx_type_province (type, province),
    INDEX idx_plan_expires (plan_expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='机构/租户表';
```

#### 3.2.2 机构认证记录表 `institution_verifications`

```sql
CREATE TABLE institution_verifications (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    institution_id  BIGINT UNSIGNED NOT NULL COMMENT '机构ID',
    tenant_id       VARCHAR(32) NOT NULL COMMENT '租户ID',
    round           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '审核轮次',
    status          ENUM('submitted', 'reviewing', 'approved', 'rejected')
                    NOT NULL DEFAULT 'submitted',
    license_url     VARCHAR(512) COMMENT '许可证附件URL',
    cert_url        VARCHAR(512) COMMENT '资质证书附件URL',
    id_card_front   VARCHAR(512) COMMENT '法人身份证正面',
    id_card_back    VARCHAR(512) COMMENT '法人身份证反面',
    submitted_at    DATETIME,
    reviewed_by     BIGINT UNSIGNED COMMENT '审核人(平台管理员)',
    reviewed_at     DATETIME,
    reject_reason   VARCHAR(512) COMMENT '驳回原因',
    notes           TEXT COMMENT '审核备注',

    INDEX idx_institution (institution_id),
    INDEX idx_status (status),
    FOREIGN KEY (institution_id) REFERENCES institutions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='机构认证审核记录';
```

#### 3.2.3 机构-用户关联表 `institution_members`

```sql
CREATE TABLE institution_members (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    institution_id  BIGINT UNSIGNED NOT NULL COMMENT '机构ID',
    tenant_id       VARCHAR(32) NOT NULL COMMENT '租户ID',
    user_id         BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
    role            ENUM('org_admin', 'admin', 'teacher', 'student')
                    NOT NULL DEFAULT 'student' COMMENT '机构内角色',
    dept_name       VARCHAR(64) COMMENT '部门/年级组',
    invited_by      BIGINT UNSIGNED COMMENT '邀请人ID',
    joined_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status          ENUM('invited', 'active', 'disabled', 'left')
                    NOT NULL DEFAULT 'invited',
    expired_at      DATETIME COMMENT '成员资格过期时间(学生毕业等)',

    UNIQUE KEY uk_inst_user (institution_id, user_id),
    INDEX idx_tenant_role (tenant_id, role),
    INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='机构成员关系表';
```

#### 3.2.4 机构班级表 `institution_classes`

```sql
CREATE TABLE institution_classes (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    institution_id  BIGINT UNSIGNED NOT NULL COMMENT '机构ID',
    tenant_id       VARCHAR(32) NOT NULL COMMENT '租户ID',
    name            VARCHAR(64) NOT NULL COMMENT '班级名称，如"三年二班"',
    grade           VARCHAR(32) COMMENT '年级',
    subject         VARCHAR(32) COMMENT '学科(培训机构用)',
    head_teacher_id BIGINT UNSIGNED COMMENT '班主任/主教师ID',
    academic_year   VARCHAR(9) COMMENT '学年，如 2026-2027',
    status          ENUM('active', 'archived') NOT NULL DEFAULT 'active',
    settings        JSON COMMENT '班级级配置',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_institution (institution_id),
    INDEX idx_teacher (head_teacher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='机构班级表';
```

#### 3.2.5 班级-学生关联表 `class_students`

```sql
CREATE TABLE class_students (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    class_id        BIGINT UNSIGNED NOT NULL,
    student_id      BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
    tenant_id       VARCHAR(32) NOT NULL,
    student_no      VARCHAR(32) COMMENT '学号',
    enrolled_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status          ENUM('active', 'transferred', 'graduated') DEFAULT 'active',

    UNIQUE KEY uk_class_student (class_id, student_id),
    INDEX idx_student (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='班级学生关联';
```

#### 3.2.6 API密钥表 `api_keys`

```sql
CREATE TABLE api_keys (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    institution_id  BIGINT UNSIGNED NOT NULL,
    tenant_id       VARCHAR(32) NOT NULL,
    key_hash        VARCHAR(128) NOT NULL UNIQUE COMMENT 'SHA256(api_key)',
    key_prefix      VARCHAR(8) NOT NULL COMMENT '前缀用于识别，如 pt_xxxx',
    name            VARCHAR(64) NOT NULL COMMENT '密钥名称/用途',
    permissions     JSON COMMENT '权限范围，如 ["student:read","learning:read"]',
    rate_limit      INT UNSIGNED DEFAULT 1000 COMMENT '每分钟请求限制',
    ip_whitelist    JSON COMMENT 'IP白名单',
    status          ENUM('active', 'disabled', 'expired') DEFAULT 'active',
    last_used_at    DATETIME,
    expires_at      DATETIME,
    created_by      BIGINT UNSIGNED NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_institution (institution_id),
    INDEX idx_hash (key_hash),
    INDEX idx_prefix (key_prefix)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='机构API密钥';
```

#### 3.2.7 用量计量表 `metering_records`

```sql
-- ClickHouse 表（高吞吐写入）
CREATE TABLE metering_records (
    tenant_id       String,
    api_key_id      Nullable(UInt64),
    user_id         Nullable(UInt64),
    resource_type   String COMMENT 'ai_call, ocr_call, asr_call, storage, etc.',
    operation       String COMMENT '具体操作',
    quantity        UInt64 COMMENT '用量数量(调用次数/存储字节等)',
    cost_cents      UInt32 COMMENT '成本(分)',
    request_id      String,
    timestamp       DateTime,
    metadata        String COMMENT 'JSON格式附加信息'
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (tenant_id, resource_type, timestamp)
TTL timestamp + INTERVAL 13 MONTH;
```

#### 3.2.8 机构账单表 `institution_bills`

```sql
CREATE TABLE institution_bills (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    institution_id  BIGINT UNSIGNED NOT NULL,
    tenant_id       VARCHAR(32) NOT NULL,
    period_start    DATE NOT NULL COMMENT '账单周期起始',
    period_end      DATE NOT NULL COMMENT '账单周期结束',
    plan_fee_cents  UINT NOT NULL COMMENT '套餐基础费用(分)',
    usage_fee_cents UINT NOT NULL COMMENT '用量超额费用(分)',
    total_cents     UINT NOT NULL COMMENT '总金额(分)',
    status          ENUM('draft', 'issued', 'paid', 'overdue', 'cancelled')
                    DEFAULT 'draft',
    issued_at       DATETIME,
    paid_at         DATETIME,
    pdf_url         VARCHAR(512) COMMENT '账单PDF下载地址',

    INDEX idx_institution (institution_id),
    INDEX idx_period (period_start, period_end),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='机构账单';
```

### 3.3 现有表扩展

在已有的 `users` 表上新增字段：

```sql
ALTER TABLE users ADD COLUMN tenant_id VARCHAR(32) DEFAULT NULL COMMENT '所属租户ID';
ALTER TABLE users ADD INDEX idx_tenant (tenant_id);
```

在已有业务表上统一新增 `tenant_id` 字段（需增量迁移）：

```sql
-- 示例：学习记录表
ALTER TABLE learning_sessions ADD COLUMN tenant_id VARCHAR(32) DEFAULT NULL;
ALTER TABLE learning_sessions ADD INDEX idx_tenant (tenant_id);

-- 错题表
ALTER TABLE mistake_records ADD COLUMN tenant_id VARCHAR(32) DEFAULT NULL;
ALTER TABLE mistake_records ADD INDEX idx_tenant (tenant_id);

-- AI对话表
ALTER TABLE ai_conversations ADD COLUMN tenant_id VARCHAR(32) DEFAULT NULL;
ALTER TABLE ai_conversations ADD INDEX idx_tenant (tenant_id);

-- 答题记录表
ALTER TABLE answer_records ADD COLUMN tenant_id VARCHAR(32) DEFAULT NULL;
ALTER TABLE answer_records ADD INDEX idx_tenant (tenant_id);
```

---

## 4. 机构注册与认证

### 4.1 注册流程

```
机构联系人注册 → 填写机构基本信息 → 提交认证材料 → 平台审核
     │                    │                    │
     ▼                    ▼                    ▼
 创建institution    status=pending      status=verifying
 分配tenant_id      上传许可证/          平台管理员审核
 分配org_admin角色  资质证书
```

**状态流转：**

```
pending ──→ verifying ──→ active ──→ suspended ──→ active(恢复)
               │                        ↑
               └──→ rejected ──→ pending(重新提交)   terminated
```

### 4.2 注册API

```
POST /api/v1/institution/register
```

**请求体：**

```json
{
  "name": "启明教育培训中心",
  "short_name": "启明教育",
  "type": "training_center",
  "province": "广东省",
  "city": "深圳市",
  "district": "南山区",
  "address": "科技园路88号3楼",
  "contact_name": "张主任",
  "contact_phone": "13800138000",
  "contact_email": "zhang@qiming.edu",
  "admin_user": {
    "name": "张主任",
    "phone": "13800138000",
    "verify_code": "123456"
  }
}
```

**响应体：**

```json
{
  "code": 0,
  "data": {
    "institution_id": 1024,
    "tenant_id": "TEN1024",
    "status": "pending",
    "next_step": "submit_verification"
  }
}
```

### 4.3 认证材料提交

```
POST /api/v1/institution/{institution_id}/verification
Content-Type: multipart/form-data
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| license_file | File | 是 | 办学许可证扫描件 |
| cert_file | File | 否 | 其他资质证书 |
| id_card_front | File | 是 | 法人身份证正面 |
| id_card_back | File | 是 | 法人身份证反面 |
| supplementary | File[] | 否 | 补充材料 |

**文件要求：** JPG/PNG/PDF，单文件不超过 10MB。

### 4.4 审核回调

机构认证状态变更时，通过Webhook通知机构：

```json
{
  "event": "institution.verification.status_changed",
  "timestamp": "2026-05-20T10:00:00+08:00",
  "data": {
    "institution_id": 1024,
    "tenant_id": "TEN1024",
    "old_status": "verifying",
    "new_status": "active",
    "reject_reason": null
  }
}
```

---

## 5. 机构管理后台

### 5.1 功能模块

```
机构管理后台
├── 仪表盘 (Dashboard)
│   ├── 学生活跃数据
│   ├── AI调用统计
│   ├── 存储用量
│   └── 本月账单概览
├── 成员管理
│   ├── 管理员列表
│   ├── 教师管理 (CRUD/批量导入)
│   ├── 学生管理 (CRUD/批量导入)
│   └── 邀请链接管理
├── 班级管理
│   ├── 班级CRUD
│   ├── 班级成员分配
│   └── 班级学情概览
├── 学情分析
│   ├── 机构级概览
│   ├── 班级对比分析
│   ├── 教师工作量统计
│   └── 知识点薄弱热力图
├── 资源配置
│   ├── 教材版本设置
│   ├── 学科开关
│   └── AI功能权限控制
├── 开放平台
│   ├── API Key管理
│   ├── Webhook配置
│   ├── 调用日志
│   └── 用量统计
├── 财务中心
│   ├── 套餐信息
│   ├── 用量明细
│   ├── 账单历史
│   └── 续费/升级
└── 系统设置
    ├── 品牌定制(Logo/名称/颜色)
    ├── 安全设置
    └── 操作日志
```

### 5.2 仪表盘API

```
GET /api/v1/institution/dashboard
```

**响应体：**

```json
{
  "code": 0,
  "data": {
    "summary": {
      "total_students": 1250,
      "active_students_7d": 890,
      "total_teachers": 45,
      "total_classes": 32
    },
    "usage": {
      "ai_calls_month": 45600,
      "ai_calls_limit": 100000,
      "storage_mb": 2048,
      "storage_limit_mb": 10240
    },
    "billing": {
      "plan_name": "学校专业版",
      "plan_fee_cents": 299900,
      "usage_overage_cents": 0,
      "next_billing_date": "2026-06-01"
    },
    "recent_alerts": [
      {
        "type": "usage_warning",
        "message": "AI调用量已达月限额的75%",
        "timestamp": "2026-05-19T08:00:00+08:00"
      }
    ]
  }
}
```

---

## 6. 批量用户管理

### 6.1 批量导入流程

```
上传Excel/CSV → 模板校验 → 数据预览 → 确认导入 → 异步处理 → 结果通知
     │              │           │           │           │           │
     ▼              ▼           ▼           ▼           ▼           ▼
  文件暂存     格式+必填项   展示前10行   创建异步任务  逐行处理   成功/失败统计
              校验          预览         返回task_id
```

### 6.2 导入模板格式

| 字段 | 必填 | 说明 | 示例 |
|------|------|------|------|
| name | 是 | 姓名 | 张三 |
| phone | 是* | 手机号(与学生phone/email二选一) | 13800138001 |
| email | 是* | 邮箱 | zhangsan@school.edu |
| student_no | 否 | 学号 | 2024001 |
| grade | 否 | 年级 | 三年级 |
| class_name | 否 | 班级名称 | 三年二班 |
| gender | 否 | 性别 | 男/女 |
| role | 是 | 角色(teacher/student) | student |

### 6.3 批量导入API

```
POST /api/v1/institution/members/batch-import
Content-Type: multipart/form-data
```

| 字段 | 类型 | 说明 |
|------|------|------|
| file | File | Excel/CSV文件 |
| default_role | String | 默认角色 (student/teacher) |
| auto_create_class | Boolean | 班级不存在时自动创建 (默认true) |
| send_notification | Boolean | 是否发送邀请通知 (默认true) |

**响应体：**

```json
{
  "code": 0,
  "data": {
    "task_id": "batch_import_TEN1024_20260520150000",
    "total_rows": 200,
    "status": "processing"
  }
}
```

### 6.4 导入结果查询

```
GET /api/v1/institution/members/batch-import/{task_id}/result
```

**响应体：**

```json
{
  "code": 0,
  "data": {
    "task_id": "batch_import_TEN1024_20260520150000",
    "status": "completed",
    "total": 200,
    "success": 185,
    "failed": 15,
    "skipped": 0,
    "errors": [
      {
        "row": 12,
        "name": "李四",
        "phone": "1380013800",
        "error": "手机号格式不正确"
      },
      {
        "row": 34,
        "name": "王五",
        "phone": "13800138001",
        "error": "该手机号已属于其他机构"
      }
    ],
    "error_file_url": "/downloads/batch_import_TEN1024_errors.xlsx"
  }
}
```

### 6.5 关键代码示例 - 批量导入任务

```python
# services/institution/batch_import.py

import asyncio
import uuid
from dataclasses import dataclass
from typing import Optional

import openpyxl
from celery import shared_task
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.tenant import tenant_context
from models.institution import InstitutionMember, InstitutionClass
from models.user import User
from services.user import UserService


@dataclass
class ImportRow:
    row_num: int
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    student_no: Optional[str] = None
    grade: Optional[str] = None
    class_name: Optional[str] = None
    gender: Optional[str] = None
    role: str = "student"


@dataclass
class ImportError:
    row: int
    name: str
    phone: Optional[str]
    error: str


class BatchImportService:
    """机构成员批量导入服务"""

    def __init__(self, db: AsyncSession, tenant_id: str, institution_id: int):
        self.db = db
        self.tenant_id = tenant_id
        self.institution_id = institution_id

    def parse_file(self, file_path: str) -> list[ImportRow]:
        """解析上传的Excel/CSV文件"""
        rows = []
        wb = openpyxl.load_workbook(file_path, read_only=True)
        ws = wb.active

        headers = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
        header_map = self._build_header_map(headers)

        for idx, row in enumerate(ws.iter_rows(min_row=2), start=2):
            values = [cell.value for cell in row]
            row_data = self._map_row(idx, values, header_map)
            if row_data:
                rows.append(row_data)

        wb.close()
        return rows

    def validate_rows(self, rows: list[ImportRow]) -> tuple[list[ImportRow], list[ImportError]]:
        """校验行数据，返回有效行和错误列表"""
        valid_rows = []
        errors = []
        seen_phones = set()

        for row in rows:
            # 必填校验
            if not row.name or not row.name.strip():
                errors.append(ImportError(row.row_num, "", row.phone, "姓名不能为空"))
                continue
            if not row.phone and not row.email:
                errors.append(ImportError(row.row_num, row.name, row.phone, "手机号或邮箱至少填写一项"))
                continue

            # 手机号格式校验
            if row.phone:
                if not self._is_valid_phone(row.phone):
                    errors.append(ImportError(row.row_num, row.name, row.phone, "手机号格式不正确"))
                    continue
                if row.phone in seen_phones:
                    errors.append(ImportError(row.row_num, row.name, row.phone, "文件中存在重复手机号"))
                    continue
                seen_phones.add(row.phone)

            valid_rows.append(row)

        return valid_rows, errors

    async def execute_import(
        self,
        rows: list[ImportRow],
        auto_create_class: bool = True,
        send_notification: bool = True,
    ) -> dict:
        """执行导入"""
        success_count = 0
        errors = []
        class_cache: dict[str, int] = {}  # class_name -> class_id

        with tenant_context(self.tenant_id):
            for row in rows:
                try:
                    # 1. 查找或创建用户
                    user = await self._get_or_create_user(row, send_notification)

                    # 2. 添加到机构
                    await self._add_to_institution(user.id, row.role)

                    # 3. 添加到班级
                    if row.class_name and row.role == "student":
                        class_id = await self._resolve_class(
                            row.class_name, row.grade, auto_create_class, class_cache
                        )
                        if class_id:
                            await self._add_to_class(class_id, user.id, row.student_no)

                    success_count += 1

                except Exception as e:
                    errors.append(ImportError(row.row_num, row.name, row.phone, str(e)))

            await self.db.commit()

        return {
            "total": len(rows),
            "success": success_count,
            "failed": len(errors),
            "errors": [
                {"row": e.row, "name": e.name, "phone": e.phone, "error": e.error}
                for e in errors
            ],
        }

    async def _get_or_create_user(self, row: ImportRow, send_notification: bool) -> User:
        """查找已有用户或创建新用户"""
        user_service = UserService(self.db)

        if row.phone:
            user = await user_service.get_by_phone(row.phone)
        else:
            user = await user_service.get_by_email(row.email)

        if user is None:
            # 创建新用户，生成随机初始密码
            user = await user_service.create(
                name=row.name,
                phone=row.phone,
                email=row.email,
                gender=row.gender,
                send_invite=send_notification,
                tenant_id=self.tenant_id,
            )
        return user

    async def _resolve_class(
        self,
        class_name: str,
        grade: Optional[str],
        auto_create: bool,
        cache: dict,
    ) -> Optional[int]:
        """查找或创建班级"""
        if class_name in cache:
            return cache[class_name]

        stmt = select(InstitutionClass).where(
            InstitutionClass.institution_id == self.institution_id,
            InstitutionClass.name == class_name,
            InstitutionClass.status == "active",
        )
        result = await self.db.execute(stmt)
        class_obj = result.scalar_one_or_none()

        if class_obj is None and auto_create:
            class_obj = InstitutionClass(
                institution_id=self.institution_id,
                tenant_id=self.tenant_id,
                name=class_name,
                grade=grade,
                status="active",
            )
            self.db.add(class_obj)
            await self.db.flush()
            cache[class_name] = class_obj.id
            return class_obj.id

        if class_obj:
            cache[class_name] = class_obj.id
        return cache.get(class_name)

    @staticmethod
    def _is_valid_phone(phone: str) -> bool:
        """简单手机号校验"""
        import re
        return bool(re.match(r"^1[3-9]\d{9}$", str(phone).strip()))

    @staticmethod
    def _build_header_map(headers: list) -> dict[str, int]:
        """构建列名到列号的映射"""
        canonical = {
            "姓名": "name", "name": "name",
            "手机号": "phone", "phone": "phone",
            "邮箱": "email", "email": "email",
            "学号": "student_no", "student_no": "student_no",
            "年级": "grade", "grade": "grade",
            "班级": "class_name", "class_name": "class_name",
            "性别": "gender", "gender": "gender",
            "角色": "role", "role": "role",
        }
        return {canonical.get(h.strip(), h.strip()): i for i, h in enumerate(headers) if h}

    @staticmethod
    def _map_row(row_num: int, values: list, header_map: dict) -> Optional[ImportRow]:
        def get(field: str) -> Optional[str]:
            idx = header_map.get(field)
            if idx is not None and idx < len(values) and values[idx]:
                return str(values[idx]).strip()
            return None

        name = get("name")
        if not name:
            return None

        return ImportRow(
            row_num=row_num,
            name=name,
            phone=get("phone"),
            email=get("email"),
            student_no=get("student_no"),
            grade=get("grade"),
            class_name=get("class_name"),
            gender=get("gender"),
            role=get("role") or "student",
        )


@shared_task(bind=True, max_retries=2)
def batch_import_task(
    self,
    task_id: str,
    file_path: str,
    tenant_id: str,
    institution_id: int,
    auto_create_class: bool = True,
    send_notification: bool = True,
):
    """Celery异步任务：批量导入"""
    import asyncio
    from core.database import get_db_context
    from services.institution.batch_import import BatchImportService

    async def _run():
        async with get_db_context() as db:
            service = BatchImportService(db, tenant_id, institution_id)
            rows = service.parse_file(file_path)
            valid_rows, validation_errors = service.validate_rows(rows)
            result = await service.execute_import(
                valid_rows, auto_create_class, send_notification
            )
            # 合并校验错误
            result["validation_errors"] = len(validation_errors)
            result["errors"].extend([
                {"row": e.row, "name": e.name, "phone": e.phone, "error": e.error}
                for e in validation_errors
            ])
            result["failed"] = result["failed"] + len(validation_errors)
            return result

    result = asyncio.run(_run())
    # 更新任务状态到Redis
    from core.redis import get_redis
    redis = get_redis()
    redis.hset(f"batch_import:{task_id}", mapping={
        "status": "completed",
        "result": json.dumps(result, ensure_ascii=False),
    })
    redis.expire(f"batch_import:{task_id}", 86400)  # 24h过期
    return result
```

---

## 7. 数据隔离策略

### 7.1 租户中间件

```python
# middleware/tenant.py

from contextvars import ContextVar
from typing import Optional

from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy import event
from sqlalchemy.orm import Session

# 当前请求的租户ID上下文
_current_tenant_id: ContextVar[Optional[str]] = ContextVar("tenant_id", default=None)


def get_current_tenant_id() -> Optional[str]:
    """获取当前请求的租户ID"""
    return _current_tenant_id.get()


class TenantContext:
    """租户上下文管理器（用于非请求场景，如Celery任务）"""

    def __init__(self, tenant_id: str):
        self.tenant_id = tenant_id
        self._token = None

    def __enter__(self):
        self._token = _current_tenant_id.set(self.tenant_id)
        return self

    def __exit__(self, *args):
        _current_tenant_id.reset(self._token)


class TenantMiddleware(BaseHTTPMiddleware):
    """租户识别中间件"""

    async def dispatch(self, request: Request, call_next):
        tenant_id = None

        # 方式1: 从自定义Header获取（管理后台）
        tenant_id = request.headers.get("X-Tenant-ID")

        # 方式2: 从JWT Token获取
        if not tenant_id:
            user = getattr(request.state, "user", None)
            if user and hasattr(user, "tenant_id"):
                tenant_id = user.tenant_id

        # 方式3: 从API Key获取（OpenAPI请求）
        if not tenant_id:
            api_key = request.headers.get("X-API-Key") or request.query_params.get("api_key")
            if api_key:
                tenant_id = await self._resolve_api_key(api_key, request)

        _current_tenant_id.set(tenant_id)
        request.state.tenant_id = tenant_id

        response = await call_next(request)
        return response

    @staticmethod
    async def _resolve_api_key(api_key: str, request: Request) -> Optional[str]:
        """通过API Key反查tenant_id"""
        import hashlib
        from core.redis import get_redis

        redis = get_redis()
        key_hash = hashlib.sha256(api_key.encode()).hexdigest()
        cache_key = f"apikey_tenant:{key_hash}"

        # 缓存查找
        cached = redis.get(cache_key)
        if cached:
            return cached.decode()

        # 数据库查找
        from core.database import get_db_context
        async with get_db_context() as db:
            from sqlalchemy import select, text
            from models.institution import ApiKey

            stmt = select(ApiKey.tenant_id).where(
                ApiKey.key_hash == key_hash,
                ApiKey.status == "active",
            )
            result = await db.execute(stmt)
            tenant_id = result.scalar_one_or_none()

            if tenant_id:
                redis.setex(cache_key, 300, tenant_id)  # 缓存5分钟
            return tenant_id


class TenantQueryFilter:
    """
    SQLAlchemy 事件监听器：自动为查询添加 tenant_id 过滤条件。
    仅对包含 tenant_id 列的模型生效。
    """

    def __init__(self):
        self._enabled = True

    def install(self, session_factory):
        """安装到SQLAlchemy Session事件"""
        event.listen(session_factory, "before_flush", self._before_flush)
        event.listen(session_factory, "do_orm_execute", self._do_orm_execute)

    def _do_orm_execute(self, execute_state):
        """SELECT 查询自动添加 tenant_id 过滤"""
        if not self._enabled:
            return

        tenant_id = get_current_tenant_id()
        if not tenant_id:
            return

        # 仅处理 SELECT
        if not execute_state.is_select:
            return

        for entity in execute_state.select_statement.column_descriptions:
            model = entity.get("entity")
            if model and hasattr(model, "tenant_id"):
                # 自动注入 WHERE tenant_id = ?
                from sqlalchemy import and_
                execute_state.select_statement = execute_state.select_statement.where(
                    model.tenant_id == tenant_id
                )

    def _before_flush(self, session, flush_context, instances):
        """INSERT/UPDATE 自动设置 tenant_id"""
        if not self._enabled:
            return

        tenant_id = get_current_tenant_id()
        if not tenant_id:
            return

        for obj in session.new:
            if hasattr(obj, "tenant_id") and obj.tenant_id is None:
                obj.tenant_id = tenant_id
```

### 7.2 隔离验证测试

```python
# tests/test_tenant_isolation.py

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_cross_tenant_data_isolation(client: AsyncClient, db):
    """验证不同租户间数据严格隔离"""
    # 创建两个机构
    tenant_a = "TEN_A"
    tenant_b = "TEN_B"

    # 租户A创建班级
    resp = await client.post(
        "/api/v1/institution/classes",
        headers={"X-Tenant-ID": tenant_a},
        json={"name": "A校班级", "grade": "三年级"},
    )
    assert resp.status_code == 200
    class_a_id = resp.json()["data"]["id"]

    # 租户B创建班级
    resp = await client.post(
        "/api/v1/institution/classes",
        headers={"X-Tenant-ID": tenant_b},
        json={"name": "B校班级", "grade": "三年级"},
    )
    assert resp.status_code == 200
    class_b_id = resp.json()["data"]["id"]

    # 租户A查询班级列表，不应看到B的班级
    resp = await client.get(
        "/api/v1/institution/classes",
        headers={"X-Tenant-ID": tenant_a},
    )
    classes = resp.json()["data"]["items"]
    class_ids = [c["id"] for c in classes]
    assert class_a_id in class_ids
    assert class_b_id not in class_ids

    # 租户A尝试直接访问B的班级资源 → 403
    resp = await client.get(
        f"/api/v1/institution/classes/{class_b_id}",
        headers={"X-Tenant-ID": tenant_a},
    )
    assert resp.status_code == 403
```

### 7.3 Redis 隔离

```
# Redis Key 命名空间规范
{prefix}:{tenant_id}:{resource}:{key}

示例：
cache:TEN1024:user:12345
session:TEN1024:learning:abc-def
ratelimit:TEN1024:api:ai_call
quota:TEN1024:usage:ai_calls_monthly
```

### 7.4 ClickHouse/ES 隔离

```sql
-- ClickHouse: 查询时强制带 tenant_id
SELECT count() FROM metering_records
WHERE tenant_id = 'TEN1024'
  AND timestamp >= '2026-05-01'
  AND resource_type = 'ai_call';

-- Elasticsearch: 使用 alias + filter 或索引前缀
# 方案A: 共享索引 + tenant_id filter
GET learning_logs/_search
{
  "query": {
    "bool": {
      "filter": [
        {"term": {"tenant_id": "TEN1024"}}
      ],
      "must": [
        {"match": {"content": "数学"}}
      ]
    }
  }
}

# 方案B: 按租户分索引（大型机构）
GET learning_logs_TEN1024/_search
```

---

## 8. 机构API开放平台

### 8.1 OpenAPI 概览

为机构提供RESTful API，用于与其自有教务系统、家校沟通平台等对接。

**鉴权方式：** API Key + HMAC签名

```
Authorization: Bearer pt_live_xxxxxxxxxxxxx
X-Timestamp: 2026-05-20T15:00:00Z
X-Signature: hmac_sha256(api_key_secret, method + path + timestamp + body_hash)
```

### 8.2 API 权限范围

| 权限编码 | 说明 | 适用场景 |
|----------|------|----------|
| `student:read` | 读取学生信息 | 教务系统同步 |
| `student:write` | 创建/更新学生 | 批量导入 |
| `class:read` | 读取班级信息 | 班级管理 |
| `class:write` | 创建/更新班级 | 排课系统对接 |
| `learning:read` | 读取学习记录/学情 | 数据看板 |
| `learning:write` | 写入学习任务 | 作业系统 |
| `mistake:read` | 读取错题数据 | 教学分析 |
| `analytics:read` | 读取统计分析 | 校长看板 |
| `ai:call` | 调用AI能力 | 嵌入式辅导 |
| `webhook:manage` | 管理Webhook | 事件订阅 |

### 8.3 核心 OpenAPI 端点

```
# ===== 学生管理 =====
GET    /openapi/v1/students                    # 学生列表(分页)
GET    /openapi/v1/students/{id}               # 学生详情
POST   /openapi/v1/students                    # 创建学生
PUT    /openapi/v1/students/{id}               # 更新学生
DELETE /openapi/v1/students/{id}               # 删除学生

# ===== 班级管理 =====
GET    /openapi/v1/classes                     # 班级列表
GET    /openapi/v1/classes/{id}                # 班级详情
POST   /openapi/v1/classes                     # 创建班级
POST   /openapi/v1/classes/{id}/students       # 添加学生到班级
DELETE /openapi/v1/classes/{id}/students/{sid}  # 从班级移除学生

# ===== 学习数据 =====
GET    /openapi/v1/learning/records            # 学习记录查询
GET    /openapi/v1/learning/stats              # 学习统计(按日/周/月)
GET    /openapi/v1/learning/knowledge-mastery   # 知识掌握度

# ===== 错题数据 =====
GET    /openapi/v1/mistakes                    # 错题列表
GET    /openapi/v1/mistakes/stats              # 错题统计

# ===== 学情分析 =====
GET    /openapi/v1/analytics/class-report/{id} # 班级学情报告
GET    /openapi/v1/analytics/student-report/{id} # 学生学情报告
GET    /openapi/v1/analytics/knowledge-heatmap  # 知识点热力图

# ===== Webhook =====
GET    /openapi/v1/webhooks                    # Webhook列表
POST   /openapi/v1/webhooks                    # 创建Webhook
PUT    /openapi/v1/webhooks/{id}               # 更新Webhook
DELETE /openapi/v1/webhooks/{id}               # 删除Webhook
POST   /openapi/v1/webhooks/{id}/test          # 测试Webhook

# ===== 用量 =====
GET    /openapi/v1/usage                       # 当前用量查询
GET    /openapi/v1/usage/history               # 历史用量
```

### 8.4 Webhook 事件列表

| 事件 | 触发时机 | 数据包含 |
|------|----------|----------|
| `student.created` | 新学生加入机构 | student_id, name, class_id |
| `student.deactivated` | 学生被禁用 | student_id, reason |
| `class.created` | 新班级创建 | class_id, name, grade |
| `learning.session.completed` | 学习会话结束 | student_id, duration, knowledge_points |
| `learning.plan.completed` | 学习计划完成 | student_id, plan_id, completion_rate |
| `mistake.new` | 新错题收录 | student_id, question_id, mistake_type |
| `usage.threshold` | 用量达到阈值 | resource_type, current, limit |
| `billing.invoice` | 新账单生成 | invoice_id, amount, due_date |

### 8.5 OpenAPI 网关限流

```python
# services/open_platform/rate_limiter.py

from core.redis import get_redis
from fastapi import HTTPException

class TenantRateLimiter:
    """租户级API限流器"""

    def __init__(self):
        self.redis = get_redis()

    async def check(self, tenant_id: str, api_key_id: int, limit: int) -> None:
        """检查分钟级限流"""
        key = f"ratelimit:{tenant_id}:apikey:{api_key_id}:{self._current_minute()}"
        current = self.redis.incr(key)
        if current == 1:
            self.redis.expire(key, 120)  # 2分钟过期

        if current > limit:
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "RATE_LIMIT_EXCEEDED",
                    "message": f"API调用超过每分钟{limit}次限制",
                    "retry_after": 60,
                },
            )

    @staticmethod
    def _current_minute() -> int:
        import time
        return int(time.time()) // 60
```

### 8.6 API调用日志

```python
# services/open_platform/access_logger.py

import time
import json
from dataclasses import dataclass, asdict


@dataclass
class ApiAccessLog:
    request_id: str
    tenant_id: str
    api_key_id: int
    method: str
    path: str
    query_params: str
    status_code: int
    response_time_ms: int
    user_agent: str
    client_ip: str
    timestamp: str


async def log_api_access(log: ApiAccessLog):
    """异步写入API调用日志到ClickHouse"""
    from core.clickhouse import get_clickhouse_client

    client = get_clickhouse_client()
    client.insert(
        "api_access_logs",
        [[
            log.request_id,
            log.tenant_id,
            log.api_key_id,
            log.method,
            log.path,
            log.query_params,
            log.status_code,
            log.response_time_ms,
            log.user_agent,
            log.client_ip,
            log.timestamp,
        ]],
        column_names=[
            "request_id", "tenant_id", "api_key_id", "method", "path",
            "query_params", "status_code", "response_time_ms",
            "user_agent", "client_ip", "timestamp",
        ],
    )
```

---

## 9. 计费与套餐

### 9.1 套餐定义

| 套餐 | 编码 | 适用 | 月费(元) | 学生上限 | AI调用量 | 存储 | OpenAPI |
|------|------|------|----------|----------|----------|------|---------|
| 体验版 | `trial` | 小型试用 | 0 | 50 | 5,000/月 | 500MB | ❌ |
| 基础版 | `basic` | 小型机构 | 999 | 500 | 50,000/月 | 5GB | 只读 |
| 专业版 | `professional` | 中型机构 | 2,999 | 2,000 | 200,000/月 | 20GB | 读写 |
| 旗舰版 | `flagship` | 大型机构 | 9,999 | 10,000 | 1,000,000/月 | 100GB | 全部 |
| 定制版 | `custom` | 区域教育局 | 面议 | 无限 | 面议 | 面议 | 全部+定制 |

### 9.2 用量计量模型

```python
# services/metering/collector.py

from dataclasses import dataclass
from enum import Enum
from typing import Optional


class ResourceType(str, Enum):
    AI_CALL = "ai_call"
    OCR_CALL = "ocr_call"
    ASR_CALL = "asr_call"
    TTS_CALL = "tts_call"
    STORAGE = "storage"


@dataclass
class MeteringEvent:
    tenant_id: str
    resource_type: ResourceType
    operation: str
    quantity: int = 1
    cost_cents: int = 0
    user_id: Optional[int] = None
    request_id: Optional[str] = None
    metadata: Optional[dict] = None


class MeteringCollector:
    """用量采集器 - 写入Kafka由消费者落盘ClickHouse"""

    TOPIC = "metering_events"

    async def collect(self, event: MeteringEvent) -> None:
        """采集用量事件"""
        from core.kafka import get_kafka_producer

        producer = get_kafka_producer()
        message = {
            "tenant_id": event.tenant_id,
            "resource_type": event.resource_type.value,
            "operation": event.operation,
            "quantity": event.quantity,
            "cost_cents": event.cost_cents,
            "user_id": event.user_id,
            "request_id": event.request_id,
            "metadata": event.metadata or {},
            "timestamp": self._now_iso(),
        }
        await producer.send_and_wait(
            self.TOPIC,
            key=event.tenant_id.encode(),
            value=json.dumps(message).encode(),
        )

    @staticmethod
    def _now_iso() -> str:
        from datetime import datetime, timezone
        return datetime.now(timezone.utc).isoformat()


# 装饰器：自动计量AI调用
def meter_ai_call(func):
    """装饰器：自动为AI调用添加计量"""
    async def wrapper(*args, **kwargs):
        tenant_id = get_current_tenant_id()
        result = await func(*args, **kwargs)

        if tenant_id:
            collector = MeteringCollector()
            # 从result中提取模型和token信息
            model = getattr(result, "model", "unknown")
            tokens = getattr(result, "total_tokens", 0)
            await collector.collect(MeteringEvent(
                tenant_id=tenant_id,
                resource_type=ResourceType.AI_CALL,
                operation=f"chat:{model}",
                quantity=1,
                cost_cents=calculate_ai_cost(model, tokens),
                metadata={"tokens": tokens, "model": model},
            ))

        return result
    return wrapper
```

### 9.3 用量查询API

```
GET /api/v1/institution/usage?period=2026-05
```

**响应体：**

```json
{
  "code": 0,
  "data": {
    "period": "2026-05",
    "plan": {
      "code": "professional",
      "name": "专业版",
      "limits": {
        "ai_calls": 200000,
        "ocr_calls": 50000,
        "storage_mb": 20480
      }
    },
    "usage": {
      "ai_calls": {
        "used": 45600,
        "limit": 200000,
        "percentage": 22.8
      },
      "ocr_calls": {
        "used": 3200,
        "limit": 50000,
        "percentage": 6.4
      },
      "storage_mb": {
        "used": 2048,
        "limit": 20480,
        "percentage": 10.0
      }
    },
    "overage_charges": [],
    "daily_trend": [
      {"date": "2026-05-01", "ai_calls": 1200, "ocr_calls": 80},
      {"date": "2026-05-02", "ai_calls": 980, "ocr_calls": 65}
    ]
  }
}
```

---

## 10. 私有化部署方案

### 10.1 部署架构

```
┌─────────────────────────────────────────┐
│           客户私有环境                    │
│                                          │
│  ┌──────────┐    ┌──────────────────┐   │
│  │ Nginx    │───→│ PrimeTop Server  │   │
│  │ (TLS)    │    │ (Docker)         │   │
│  └──────────┘    └────────┬─────────┘   │
│                           │              │
│  ┌────────────┐  ┌───────┴───────┐      │
│  │ MySQL      │  │ Redis         │      │
│  │ (主从)     │  │ (哨兵)        │      │
│  └────────────┘  └───────────────┘      │
│                                          │
│  ┌────────────┐  ┌───────────────┐      │
│  │ MinIO      │  │ ClickHouse    │      │
│  │ (对象存储) │  │ (可选)        │      │
│  └────────────┘  └───────────────┘      │
└─────────────────────────────────────────┘
        │
        │ (可选) VPN/专线
        ▼
┌─────────────────────────────────────────┐
│     PrimeTop 云端 (AI能力)               │
│  ┌──────────┐  ┌──────────┐            │
│  │ AI网关   │  │ 安全审核 │            │
│  └──────────┘  └──────────┘            │
└─────────────────────────────────────────┘
```

### 10.2 部署模式对比

| 模式 | 数据存储位置 | AI调用链路 | 适用场景 |
|------|-------------|-----------|----------|
| 全托管SaaS | PrimeTop云 | PrimeTop云→模型商 | 大多数机构 |
| 混合部署 | 客户私有 | 客户→PrimeTop云→模型商 | 数据敏感型 |
| 全私有化 | 客户私有 | 客户环境直接调用模型商API | 政府/大型学校 |
| 全离线 | 客户私有 | 本地模型(GPU服务器) | 断网环境 |

### 10.3 Docker Compose (私有化最小部署)

```yaml
# docker-compose.yml (私有化部署版)

version: "3.8"

services:
  primetop-server:
    image: primetop/server:${VERSION:-latest}
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=mysql+asyncmy://root:${DB_PASSWORD}@mysql:3306/primetop
      - REDIS_URL=redis://redis:6379/0
      - MINIO_ENDPOINT=minio:9000
      - MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}
      - MINIO_SECRET_KEY=${MINIO_SECRET_KEY}
      - AI_GATEWAY_URL=${AI_GATEWAY_URL}  # PrimeTop云端AI网关
      - AI_GATEWAY_TOKEN=${AI_GATEWAY_TOKEN}
      - TENANT_ID=${TENANT_ID}  # 该实例的固定租户ID
      - DEPLOYMENT_MODE=private
    depends_on:
      - mysql
      - redis
      - minio
    restart: unless-stopped

  primetop-worker:
    image: primetop/server:${VERSION:-latest}
    command: celery -A core.celery worker -l info -c 4
    environment:
      - DATABASE_URL=mysql+asyncmy://root:${DB_PASSWORD}@mysql:3306/primetop
      - REDIS_URL=redis://redis:6379/0
      - TENANT_ID=${TENANT_ID}
      - DEPLOYMENT_MODE=private
    depends_on:
      - mysql
      - redis
    restart: unless-stopped

  mysql:
    image: mysql:8.0
    environment:
      - MYSQL_ROOT_PASSWORD=${DB_PASSWORD}
      - MYSQL_DATABASE=primetop
    volumes:
      - mysql_data:/var/lib/mysql
    command: --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      - MINIO_ROOT_USER=${MINIO_ACCESS_KEY}
      - MINIO_ROOT_PASSWORD=${MINIO_SECRET_KEY}
    volumes:
      - minio_data:/data
    ports:
      - "9001:9001"

volumes:
  mysql_data:
  redis_data:
  minio_data:
```

### 10.4 许可证管理

私有化实例通过许可证控制功能范围和有效期：

```python
# services/license.py

import json
import time
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding, utils


class LicenseManager:
    """私有化部署许可证管理"""

    PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MIIBIjANBg... (PrimeTop 公钥)
-----END PUBLIC KEY-----"""

    @staticmethod
    def validate(license_str: str) -> dict:
        """
        验证许可证签名并解析内容。
        license格式: base64(json_payload).base64(signature)
        """
        parts = license_str.split(".")
        if len(parts) != 2:
            raise ValueError("许可证格式错误")

        payload_b64, sig_b64 = parts

        # 验证签名
        import base64
        public_key = serialization.load_pem_public_key(
            LicenseManager.PUBLIC_KEY_PEM.encode()
        )
        try:
            public_key.verify(
                base64.b64decode(sig_b64),
                payload_b64.encode(),
                padding.PKCS1v15(),
                hashes.SHA256(),
            )
        except Exception:
            raise ValueError("许可证签名验证失败")

        # 解析payload
        payload = json.loads(base64.b64decode(payload_b64))

        # 检查过期
        if payload["expires_at"] < time.time():
            raise ValueError("许可证已过期")

        # 检查功能范围
        if "features" not in payload:
            raise ValueError("许可证缺少功能声明")

        return payload

    @staticmethod
    def get_license_info(license_str: str) -> dict:
        """获取许可证摘要信息（不验证签名，用于展示）"""
        import base64
        payload_b64 = license_str.split(".")[0]
        return json.loads(base64.b64decode(payload_b64))
```

**许可证payload结构：**

```json
{
  "tenant_id": "TEN1024",
  "institution_name": "XX市第一中学",
  "deployment_id": "deploy_abc123",
  "issued_at": 1747785600,
  "expires_at": 1779321600,
  "max_students": 5000,
  "max_teachers": 200,
  "features": [
    "ai_tutoring",
    "photo_search",
    "mistake_book",
    "learning_analytics",
    "class_management",
    "openapi"
  ],
  "model_providers": ["openai", "zhipu"],
  "allowed_domains": ["*.xxyizhong.edu.cn"]
}
```

---

## 11. 安全与合规

### 11.1 安全措施矩阵

| 风险 | 措施 | 实现层 |
|------|------|--------|
| 越权访问其他机构数据 | 租户中间件自动过滤 + 接口层校验 | 中间件+业务 |
| API Key泄露 | Key只显示一次 + IP白名单 + 速率限制 | OpenAPI网关 |
| 学生数据泄露 | 最小化返回字段 + 日志脱敏 | API层 |
| 批量导出风险 | 导出审批流 + 水印 + 限制频率 | 业务层 |
| 第三方系统入侵 | HMAC签名校验 + HTTPS强制 | OpenAPI网关 |

### 11.2 数据导出审批

机构导出批量学生数据时，需经过审批：

```
教师申请导出 → org_admin审批 → 生成加密下载链接(72h有效) → 操作审计记录
```

```
POST /api/v1/institution/data-export/request
```

```json
{
  "export_type": "student_learning_records",
  "filters": {
    "class_id": 100,
    "date_range": ["2026-03-01", "2026-05-20"]
  },
  "format": "xlsx",
  "reason": "期中教学总结"
}
```

### 11.3 审计日志

```sql
CREATE TABLE institution_audit_logs (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id       VARCHAR(32) NOT NULL,
    operator_id     BIGINT UNSIGNED NOT NULL COMMENT '操作人',
    operator_role   VARCHAR(32) NOT NULL COMMENT '操作人角色',
    action          VARCHAR(64) NOT NULL COMMENT '操作类型',
    resource_type   VARCHAR(64) NOT NULL COMMENT '资源类型',
    resource_id     VARCHAR(64) COMMENT '资源ID',
    detail          JSON COMMENT '变更详情(before/after)',
    client_ip       VARCHAR(45) NOT NULL,
    user_agent      VARCHAR(256),
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_tenant_time (tenant_id, created_at),
    INDEX idx_operator (operator_id),
    INDEX idx_action (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='机构操作审计日志';
```

**必须记录审计的操作：**

| 操作 | action值 | 说明 |
|------|----------|------|
| 成员导入 | `member.batch_import` | 含文件哈希和结果 |
| 成员移除 | `member.remove` | 含被移除者ID |
| 角色变更 | `member.role_change` | 含变更前后角色 |
| 数据导出 | `data.export` | 含导出范围和审批状态 |
| API Key创建 | `apikey.create` | 含权限范围 |
| API Key删除 | `apikey.delete` | - |
| 班级删除 | `class.delete` | - |
| 机构设置变更 | `institution.settings_update` | 含变更前后 |

---

## 12. 关键代码示例

### 12.1 机构注册完整流程

```python
# api/v1/institution.py

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from pydantic import BaseModel, Field, validator
from typing import Optional

from services.institution import InstitutionService
from middleware.auth import get_current_user
from middleware.tenant import get_current_tenant_id

router = APIRouter(prefix="/api/v1/institution", tags=["institution"])


class RegisterRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=128)
    short_name: Optional[str] = Field(None, max_length=64)
    type: str = Field(..., pattern=r"^(school|training_center|education_bureau|enterprise)$")
    province: str = Field(..., min_length=2, max_length=32)
    city: str = Field(..., min_length=2, max_length=32)
    district: Optional[str] = Field(None, max_length=32)
    address: Optional[str] = Field(None, max_length=256)
    contact_name: str = Field(..., min_length=2, max_length=64)
    contact_phone: str = Field(..., pattern=r"^1[3-9]\d{9}$")
    contact_email: Optional[str] = Field(None, max_length=128)
    admin_user: "AdminUserCreate"

    @validator("type")
    def validate_type(cls, v):
        allowed = {"school", "training_center", "education_bureau", "enterprise"}
        if v not in allowed:
            raise ValueError(f"机构类型必须是 {allowed} 之一")
        return v


class AdminUserCreate(BaseModel):
    name: str
    phone: str = Field(..., pattern=r"^1[3-9]\d{9}$")
    verify_code: str = Field(..., min_length=4, max_length=6)


@router.post("/register")
async def register_institution(
    req: RegisterRequest,
    service: InstitutionService = Depends(),
):
    """机构注册"""
    # 1. 验证手机验证码
    if not await service.verify_sms_code(req.admin_user.phone, req.admin_user.verify_code):
        raise HTTPException(status_code=400, detail="验证码错误或已过期")

    # 2. 检查手机号是否已有账号
    existing = await service.get_user_by_phone(req.admin_user.phone)
    if existing:
        raise HTTPException(status_code=409, detail="该手机号已注册")

    # 3. 检查机构名重复
    dup = await service.get_institution_by_name(req.name)
    if dup:
        raise HTTPException(status_code=409, detail="该机构名称已被注册")

    # 4. 创建机构和管理员
    result = await service.register_institution(
        name=req.name,
        short_name=req.short_name,
        inst_type=req.type,
        province=req.province,
        city=req.city,
        district=req.district,
        address=req.address,
        contact_name=req.contact_name,
        contact_phone=req.contact_phone,
        contact_email=req.contact_email,
        admin_name=req.admin_user.name,
        admin_phone=req.admin_user.phone,
    )

    return {"code": 0, "data": result}
```

### 12.2 学情分析 API（机构维度）

```python
# api/v1/institution_analytics.py

from fastapi import APIRouter, Depends, Query
from typing import Optional

from services.institution.analytics import InstitutionAnalyticsService
from middleware.auth import require_org_admin

router = APIRouter(prefix="/api/v1/institution/analytics", tags=["institution-analytics"])


@router.get("/overview")
async def get_institution_overview(
    period: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="统计周期，如 2026-05"),
    _: None = Depends(require_org_admin),
    service: InstitutionAnalyticsService = Depends(),
):
    """机构级学情概览"""
    return await service.get_overview(period)


@router.get("/class-report/{class_id}")
async def get_class_report(
    class_id: int,
    period: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    _: None = Depends(require_org_admin),
    service: InstitutionAnalyticsService = Depends(),
):
    """班级学情报告"""
    return await service.get_class_report(class_id, period)


@router.get("/knowledge-heatmap")
async def get_knowledge_heatmap(
    subject: Optional[str] = Query(None),
    grade: Optional[str] = Query(None),
    _: None = Depends(require_org_admin),
    service: InstitutionAnalyticsService = Depends(),
):
    """知识点薄弱热力图"""
    return await service.get_knowledge_heatmap(subject=subject, grade=grade)


@router.get("/teacher-workload")
async def get_teacher_workload(
    period: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    _: None = Depends(require_org_admin),
    service: InstitutionAnalyticsService = Depends(),
):
    """教师工作量统计"""
    return await service.get_teacher_workload(period)
```

### 12.3 机构学情聚合查询

```python
# services/institution/analytics.py

from datetime import datetime, date
from typing import Optional

from sqlalchemy import select, func, and_, case
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db_context
from models.institution import InstitutionMember, InstitutionClass, ClassStudent
from models.user import User
from models.learning import LearningSession, LearningRecord
from models.mistake import MistakeRecord


class InstitutionAnalyticsService:
    """机构级学情分析服务"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_overview(self, period: str) -> dict:
        """机构级概览"""
        tenant_id = get_current_tenant_id()
        year, month = map(int, period.split("-"))
        start = date(year, month, 1)
        end = date(year, month + 1, 1) if month < 12 else date(year + 1, 1, 1)

        # 学生活跃统计
        active_students = await self.db.scalar(
            select(func.count(func.distinct(LearningSession.user_id)))
            .where(
                LearningSession.tenant_id == tenant_id,
                LearningSession.created_at >= start,
                LearningSession.created_at < end,
            )
        )

        # 总学习时长(分钟)
        total_duration = await self.db.scalar(
            select(func.coalesce(func.sum(LearningSession.duration_seconds), 0))
            .where(
                LearningSession.tenant_id == tenant_id,
                LearningSession.created_at >= start,
                LearningSession.created_at < end,
            )
        )

        # 错题总数
        total_mistakes = await self.db.scalar(
            select(func.count(MistakeRecord.id))
            .where(
                MistakeRecord.tenant_id == tenant_id,
                MistakeRecord.created_at >= start,
                MistakeRecord.created_at < end,
            )
        )

        # 错题复习率
        reviewed_mistakes = await self.db.scalar(
            select(func.count(MistakeRecord.id))
            .where(
                MistakeRecord.tenant_id == tenant_id,
                MistakeRecord.created_at >= start,
                MistakeRecord.created_at < end,
                MistakeRecord.review_count > 0,
            )
        )

        # 班级数和学生总数
        total_classes = await self.db.scalar(
            select(func.count(InstitutionClass.id))
            .where(
                InstitutionClass.tenant_id == tenant_id,
                InstitutionClass.status == "active",
            )
        )

        total_students = await self.db.scalar(
            select(func.count(InstitutionMember.id))
            .where(
                InstitutionMember.tenant_id == tenant_id,
                InstitutionMember.role == "student",
                InstitutionMember.status == "active",
            )
        )

        avg_duration = (total_duration / active_students / 60) if active_students else 0
        review_rate = (reviewed_mistakes / total_mistakes * 100) if total_mistakes else 0

        return {
            "period": period,
            "total_students": total_students,
            "active_students": active_students,
            "active_rate": round(active_students / total_students * 100, 1) if total_students else 0,
            "total_classes": total_classes,
            "total_duration_minutes": round(total_duration / 60),
            "avg_duration_minutes_per_student": round(avg_duration, 1),
            "total_mistakes": total_mistakes,
            "mistake_review_rate": round(review_rate, 1),
        }

    async def get_class_report(self, class_id: int, period: str) -> dict:
        """班级报告"""
        tenant_id = get_current_tenant_id()
        year, month = map(int, period.split("-"))
        start = date(year, month, 1)
        end = date(year, month + 1, 1) if month < 12 else date(year + 1, 1, 1)

        # 验证班级归属
        class_obj = await self.db.get(InstitutionClass, class_id)
        if not class_obj or class_obj.tenant_id != tenant_id:
            raise HTTPException(status_code=403, detail="无权访问该班级")

        # 获取班级学生列表
        student_ids = (
            await self.db.execute(
                select(ClassStudent.student_id)
                .where(ClassStudent.class_id == class_id, ClassStudent.status == "active")
            )
        ).scalars().all()

        # 按学生聚合学习数据
        student_stats = []
        for sid in student_ids:
            duration = await self.db.scalar(
                select(func.coalesce(func.sum(LearningSession.duration_seconds), 0))
                .where(
                    LearningSession.user_id == sid,
                    LearningSession.tenant_id == tenant_id,
                    LearningSession.created_at >= start,
                    LearningSession.created_at < end,
                )
            )
            mistakes = await self.db.scalar(
                select(func.count(MistakeRecord.id))
                .where(
                    MistakeRecord.user_id == sid,
                    MistakeRecord.tenant_id == tenant_id,
                    MistakeRecord.created_at >= start,
                    MistakeRecord.created_at < end,
                )
            )
            student_stats.append({
                "student_id": sid,
                "duration_minutes": round(duration / 60, 1),
                "mistake_count": mistakes,
            })

        return {
            "class_id": class_id,
            "class_name": class_obj.name,
            "period": period,
            "total_students": len(student_ids),
            "student_stats": student_stats,
        }

    async def get_knowledge_heatmap(
        self, subject: Optional[str] = None, grade: Optional[str] = None
    ) -> dict:
        """知识点薄弱热力图"""
        tenant_id = get_current_tenant_id()

        # 从ClickHouse查询知识点掌握度聚合
        from core.clickhouse import get_clickhouse_client
        client = get_clickhouse_client()

        query = """
        SELECT
            knowledge_point_id,
            knowledge_point_name,
            avg(mastery_rate) as avg_mastery,
            count(distinct student_id) as student_count
        FROM knowledge_mastery_snapshots
        WHERE tenant_id = %(tenant_id)s
          AND snapshot_date >= today() - 30
        """
        params = {"tenant_id": tenant_id}

        if subject:
            query += " AND subject = %(subject)s"
            params["subject"] = subject
        if grade:
            query += " AND grade = %(grade)s"
            params["grade"] = grade

        query += """
        GROUP BY knowledge_point_id, knowledge_point_name
        ORDER BY avg_mastery ASC
        LIMIT 100
        """

        result = client.query(query, parameters=params)

        return {
            "subject": subject,
            "grade": grade,
            "weak_points": [
                {
                    "knowledge_point_id": row[0],
                    "knowledge_point_name": row[1],
                    "avg_mastery": round(row[2], 2),
                    "student_count": row[3],
                }
                for row in result.result_rows
            ],
        }
```

---

## 13. 接口清单

### 13.1 机构管理接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/v1/institution/register` | 机构注册 | 公开 |
| GET | `/api/v1/institution/profile` | 获取机构信息 | org_admin+ |
| PUT | `/api/v1/institution/profile` | 更新机构信息 | org_admin |
| POST | `/api/v1/institution/{id}/verification` | 提交认证材料 | org_admin |
| GET | `/api/v1/institution/{id}/verification` | 查看认证状态 | org_admin |
| GET | `/api/v1/institution/dashboard` | 仪表盘数据 | org_admin+ |

### 13.2 成员管理接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/v1/institution/members` | 成员列表(分页/筛选) | org_admin+ |
| POST | `/api/v1/institution/members` | 添加单个成员 | org_admin+ |
| PUT | `/api/v1/institution/members/{id}` | 更新成员信息 | org_admin+ |
| DELETE | `/api/v1/institution/members/{id}` | 移除成员 | org_admin |
| POST | `/api/v1/institution/members/batch-import` | 批量导入 | org_admin+ |
| GET | `/api/v1/institution/members/batch-import/{task_id}/result` | 导入结果 | org_admin+ |
| POST | `/api/v1/institution/members/invite-link` | 生成邀请链接 | org_admin+ |

### 13.3 班级管理接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/v1/institution/classes` | 班级列表 | org_admin+teacher |
| POST | `/api/v1/institution/classes` | 创建班级 | org_admin+ |
| GET | `/api/v1/institution/classes/{id}` | 班级详情 | org_admin+teacher |
| PUT | `/api/v1/institution/classes/{id}` | 更新班级 | org_admin |
| DELETE | `/api/v1/institution/classes/{id}` | 删除班级 | org_admin |
| GET | `/api/v1/institution/classes/{id}/students` | 班级学生列表 | org_admin+teacher |
| POST | `/api/v1/institution/classes/{id}/students` | 添加学生到班级 | org_admin+ |
| DELETE | `/api/v1/institution/classes/{id}/students/{sid}` | 移除学生 | org_admin |

### 13.4 开放平台接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/openapi/v1/students` | 学生列表 | api_key:student:read |
| POST | `/openapi/v1/students` | 创建学生 | api_key:student:write |
| GET | `/openapi/v1/classes` | 班级列表 | api_key:class:read |
| GET | `/openapi/v1/learning/stats` | 学习统计 | api_key:learning:read |
| GET | `/openapi/v1/analytics/class-report/{id}` | 班级学情 | api_key:analytics:read |
| GET | `/openapi/v1/usage` | 用量查询 | api_key:任意 |
| POST | `/openapi/v1/webhooks` | 创建Webhook | api_key:webhook:manage |

### 13.5 管理接口（平台管理员）

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/v1/admin/institutions` | 机构列表(分页) | platform_admin |
| PUT | `/api/v1/admin/institutions/{id}/status` | 变更机构状态 | platform_admin |
| POST | `/api/v1/admin/institutions/{id}/verify` | 审核认证 | platform_admin |
| PUT | `/api/v1/admin/institutions/{id}/plan` | 变更套餐 | platform_admin |

---

## 14. 错误码

### 14.1 机构相关错误码

| 错误码 | HTTP状态码 | 说明 | 处理建议 |
|--------|-----------|------|----------|
| `INST_001` | 409 | 机构名称已注册 | 修改名称或联系客服 |
| `INST_002` | 400 | 认证材料不完整 | 补全必填材料 |
| `INST_003` | 403 | 机构未通过认证 | 等待审核或重新提交 |
| `INST_004` | 403 | 机构已被暂停 | 联系平台管理员 |
| `INST_005` | 403 | 非机构成员 | 加入机构后重试 |
| `INST_006` | 403 | 权限不足(非org_admin) | 联系机构管理员 |
| `INST_010` | 409 | 学生已属于其他机构 | 先从原机构移除 |
| `INST_011` | 400 | 超出学生数量上限 | 升级套餐 |
| `INST_012` | 400 | 超出教师数量上限 | 升级套餐 |

### 14.2 OpenAPI相关错误码

| 错误码 | HTTP状态码 | 说明 | 处理建议 |
|--------|-----------|------|----------|
| `OAPI_001` | 401 | API Key无效 | 检查Key是否正确 |
| `OAPI_002` | 401 | API Key已过期 | 重新生成Key |
| `OAPI_003` | 403 | API Key权限不足 | 检查Key的权限范围 |
| `OAPI_004` | 403 | IP不在白名单 | 添加IP到白名单 |
| `OAPI_005` | 429 | 超过速率限制 | 降低调用频率或升级套餐 |
| `OAPI_006` | 401 | 签名验证失败 | 检查签名算法和密钥 |
| `OAPI_007` | 400 | Webhook URL不可达 | 检查URL有效性 |
| `OAPI_008` | 402 | 机构用量超额 | 升级套餐或等待下月 |

### 14.3 错误响应格式

```json
{
  "code": "INST_010",
  "message": "该学生已属于其他机构",
  "detail": {
    "student_id": 12345,
    "current_institution": "TEN2048",
    "suggestion": "请联系原机构管理员将该学生移除后重试"
  },
  "request_id": "req_abc123",
  "timestamp": "2026-05-20T15:00:00+08:00"
}
```

---

## 15. 监控与运营

### 15.1 关键监控指标

| 指标 | 采集方式 | 告警阈值 |
|------|----------|----------|
| 机构API成功率 | Prometheus counter | < 99% (5min) |
| 机构API P99延迟 | Prometheus histogram | > 3s |
| 租户查询性能 | Slow query log | > 500ms |
| 批量导入队列积压 | Celery queue length | > 100 |
| API Key调用频率 | Redis counter | > 限额80% 预警 |
| 存储用量增长 | 定时任务 | > 配额80% 预警 |
| 机构活跃度 | 每日统计 | 连续7天0活跃告警 |

### 15.2 运营看板

平台管理员可查看B端运营数据：

```
GET /api/v1/admin/b2b/dashboard
```

```json
{
  "code": 0,
  "data": {
    "total_institutions": 156,
    "active_institutions": 128,
    "by_type": {
      "school": 45,
      "training_center": 89,
      "education_bureau": 12,
      "enterprise": 20
    },
    "by_plan": {
      "trial": 48,
      "basic": 52,
      "professional": 38,
      "flagship": 18,
      "custom": 0
    },
    "monthly_revenue": {
      "subscription": 298000,
      "overage": 12400,
      "total": 310400
    },
    "total_students_served": 185000,
    "churn_rate_30d": 0.032,
    "avg_nps": 72
  }
}
```

### 15.3 机构生命周期管理

```
注册(7天免费体验) ──→ 认证通过 ──→ 正式使用 ──→ 续费/升级
                          │                          │
                          └── 认证驳回 ──→ 重新提交    └── 降级/到期
                                                        │
                                              宽限期(7天) ──→ 冻结 ──→ 注销(30天)
```

| 阶段 | 功能限制 | 通知策略 |
|------|----------|----------|
| 体验期 | 50学生上限，基础功能 | 到期前3天提醒 |
| 正式期 | 按套餐 | 用量达80%预警 |
| 宽限期 | 只读 | 每日提醒续费 |
| 冻结期 | 禁止AI调用 | 每周提醒 |
| 注销期 | 数据保留30天 | 最终提醒 |

---

## 附录A：机构品牌定制配置Schema

```json
{
  "brand_config": {
    "app_name": "启明AI学习",
    "primary_color": "#1E88E5",
    "secondary_color": "#42A5F5",
    "logo_url": "https://cdn.primetop.com/tenants/TEN1024/logo.png",
    "favicon_url": "https://cdn.primetop.com/tenants/TEN1024/favicon.ico",
    "login_background": "https://cdn.primetop.com/tenants/TEN1024/bg.jpg",
    "welcome_text": "欢迎来到启明AI学习中心",
    "contact_info": {
      "phone": "400-123-4567",
      "email": "support@qiming.edu"
    },
    "features": {
      "hide_primetop_branding": false,
      "custom_footer": "© 2026 启明教育培训中心"
    }
  }
}
```

## 附录B：机构-现有模块集成点

| 现有模块 | 集成方式 | 说明 |
|----------|----------|------|
| 用户账号体系 | 扩展tenant_id | 用户可同时属于个人和机构 |
| 权限管理(RBAC) | 新增机构角色 | org_admin/admin/teacher(机构内) |
| 学情分析 | 机构维度聚合 | 班级/年级/全校维度 |
| 错题整理 | 机构错题统计 | 班级高频错题、教师可查看 |
| 学习记录 | 租户过滤 | 机构内学习记录独立统计 |
| AI智能辅导 | 用量计量 | 按机构统计AI调用量 |
| 支付与会员 | 套餐绑定 | 机构套餐与个人会员独立 |
| 数据埋点 | 租户标签 | 事件增加tenant_id维度 |
| 首页与工作台 | 品牌定制 | 机构版本可定制首页 |
| 内容安全 | 机构级配置 | 机构可设置额外内容过滤规则 |
