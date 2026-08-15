# 第三方SDK与开源依赖治理体系 - 详细设计

> 版本：v1.0
> 状态：初稿（可直接指导编码）
> 上游文档：《启硕-PrimeTop-全学段AI辅助学习软件项目设计文档》§8.4 服务端架构、§8.5.1 大模型接入、§8.7 安全与合规架构、§13.3 安全需求、§13.4 可维护性需求
> 关联文档：《CI-CD流水线与自动化构建发布系统》《测试策略与质量保障体系》《数据安全与隐私合规体系》《服务端-密钥管理与敏感配置安全策略》《第三方服务集成与供应商管理》《客户端应用启动流程与初始化管线》《客户端应用包体积优化与资源管理策略》《服务端统一业务异常码与错误分类体系》《配置中心与动态配置管理》《客户端远程配置同步与本地配置管理引擎》《生产事故应急响应与OnCall值班调度体系》

---

## 1. 模块概述

### 1.1 定位与背景

PrimeTop 作为集成大量外部能力的未成年人教育产品，第三方件（含客户端 SDK、服务端开源库、AI 服务 SDK、工具链依赖）的规模在同类产品中属于高位：

| 集成域 | 典型三方件 | 数量级 |
| --- | --- | --- |
| 大模型供应商 | 通用问答 / 推理增强 / 多模态 / 嵌入 / 语音模型 SDK（多供应商并行） | 5~10 |
| 语音视觉 | OCR、ASR、TTS、发音评测、手写识别 SDK | 5~8 |
| 推送 | 华为 / 小米 / OPPO / vivo / 荣耀 / APNs / FCM 厂商通道 SDK | 5~7 |
| 账号与支付 | 微信开放平台、QQ、Apple Sign-In、一键登录、微信支付 / 支付宝 / IAP | 6~8 |
| 数据与监控 | 埋点 SDK、崩溃收集 SDK、性能监控 SDK | 2~4 |
| 服务端开源库 | FastAPI 生态、SQLAlchemy、Celery、Redis 客户端、向量库客户端等 | 80~150（含传递依赖） |
| 客户端开源包 | Flutter pub 依赖（含传递依赖） | 100~200 |

现有文档对本域的覆盖是碎片化的：《CI-CD 流水线》将"依赖漏洞扫描"作为构建环节（P2 优先级）、《测试策略》提供了 Semgrep/依赖扫描片段、《数据安全与隐私合规体系》仅用约 10 行描述"隐私政策中列出第三方 SDK"的合规要求、《第三方服务集成与供应商管理》只治理**服务供应商**（SLA/计费/容灾），不治理**代码依赖**（版本/License/漏洞/体积）。

本设计补齐这块空白，建立覆盖第三方件**全生命周期**的治理体系：

```text
引入准入 ──▶ 台账登记 ──▶ 构建期卡点（SBOM对账/漏洞/License/体积）──▶ 运行期监控 ──▶ 漏洞应急 ──▶ 升级/替换 ──▶ 退役退出
     ▲                                                                                        │
     └────────────────────────── 评审工单闭环  ◀──────────────────────────────────────────────┘
```

### 1.2 设计目标

| 目标 | 度量 |
| --- | --- |
| 台账完备 | 生产构建产物中 100% 三方件（含传递依赖）可追溯到台账记录与 Owner |
| 准入受控 | 新依赖无评审工单不允许合入主干（CI 硬卡点） |
| 漏洞可响应 | Critical 漏洞从情报到处置方案 ≤ 24h，≤ 7d 完成修复或缓解 |
| 披露合规 | 隐私政策"第三方共享清单"与实际初始化的 SDK 集合 100% 一致（自动对账） |
| License 零传染 | 生产制品不含 GPL/AGPL 类传染性许可证组件（CI 硬卡点） |
| 体积受控 | 单个 SDK 增量体积超预算必须评审；客户端包总体积有基线看板 |
| 运行可观测 | 每个 L0/L1 SDK 的调用成功率、耗时、崩溃归因有监控 |

### 1.3 不做什么（边界）

- **不做**服务供应商商务/SLA 治理（见《第三方服务集成与供应商管理》，两者以 `vendor_id` 关联）；
- **不做**模型调用质量与成本治理（见《多模型调度与成本治理》）；本体系只管模型 SDK 这个"依赖本体"的版本与安全；
- **不做**密钥与凭据管理（见《服务端-密钥管理与敏感配置安全策略》），台账仅记录"该依赖需要哪些密钥类别"；
- **不做**代码自有模块的质量卡口（Lint/单测见《CI-CD 流水线》），本体系是其中"安全扫描"阶段的**深化与数据化**。

---

## 2. 术语

| 术语 | 定义 |
| --- | --- |
| 三方件（Artifact） | 不由本项目团队维护源码、以二进制或源码包形式引入的外部组件，含 SDK 与开源库 |
| SDK | 客户端/服务端中带运行时行为、常伴随外部服务通信的三方件（如厂商推送 SDK） |
| 直接依赖 / 传递依赖 | manifest 显式声明 / 由直接依赖引入的间接依赖 |
| SBOM | Software Bill of Materials，软件物料清单（CycloneDX 格式） |
| CVE / GHSA / CNVD | 漏洞编号体系：通用漏洞库 / GitHub 通告 / 中国国家漏洞库 |
| OSV | Open Source Vulnerabilities 漏洞数据库与查询 API |
| 许可证传染性 | GPL/AGPL 等要求衍生作品以相同许可证开源的法律属性 |
| 准入（Access） | 新三方件进入代码库前的评审-登记流程 |
| 台账（Registry） | 全量三方件的权威登记数据库 |
| 热禁用 | 通过远程配置在运行时关闭某 SDK 初始化与调用 |

---

## 3. 整体架构

### 3.1 系统组成

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                        依赖治理平台（本设计核心）                            │
│                                                                           │
│  ┌───────────────┐  ┌───────────────┐  ┌──────────────────────────────┐  │
│  │ 台账服务       │  │ 评审工作流     │  │ 漏洞响应引擎                  │  │
│  │ dependency_    │  │ review_ticket │  │ 情报轮询→事件→升级任务         │  │
│  │ registry      │  │ (准入/升级)    │  │ vulnerability_event          │  │
│  └───────┬───────┘  └───────┬───────┘  └──────────────┬───────────────┘  │
│          │                  │                         │                  │
│  ┌───────▼──────────────────▼─────────────────────────▼───────────────┐  │
│  │              对账引擎（SBOM diff / 披露清单 diff / 体积 diff）          │  │
│  └───────┬───────────────────────────────────────────────────────┬────┘  │
│          │                                                       │       │
│  ┌───────▼────────┐  ┌────────────────────┐  ┌─────────────────▼────┐  │
│  │ 披露管线         │  │ License 合规审查    │  │ 管理后台工作台         │  │
│  │ PIPL 第三方共享  │  │ license_review     │  │ 依赖治理控制台         │  │
│  │ 清单自动生成     │  │ + NOTICE 生成      │  │                      │  │
│  └────────────────┘  └────────────────────┘  └──────────────────────┘  │
└───────────────┬─────────────────────────────────────────┬───────────────┘
                │ CI 查询 API（卡点判定）                    │ 事件/指标
┌───────────────▼───────────────┐             ┌───────────▼───────────────┐
│  CI/CD 流水线                  │             │  客户端运行时治理            │
│  SBOM生成→台账对账→漏洞/License │             │  初始化编排/健康度/热禁用     │
│  /体积扫描→卡点判定             │             │  （远程配置联动）            │
└───────────────────────────────┘             └───────────────────────────┘
```

### 3.2 与现有文档的分工

| 关注点 | 归属文档 | 本体系职责 |
| --- | --- | --- |
| CI 流水线阶段编排 | 《CI-CD流水线》 | 提供其中"安全扫描/依赖检查"阶段的实现细节与判定数据源 |
| SAST 代码扫描 | 《测试策略》 | 互补：SAST 管自有代码，本体系管三方件（SCA） |
| 供应商 SLA/计费/容灾 | 《第三方服务集成与供应商管理》 | 以 `vendor_id` 关联；本体系管代码依赖本体 |
| 隐私合规总纲 | 《数据安全与隐私合规体系》 | 落地其"第三方 SDK 披露"条款的工程实现 |
| 密钥轮换与托管 | 《密钥管理》 | 台账仅标注依赖所需密钥类别（KMS ref） |
| 启动初始化编排 | 《客户端应用启动流程》 | 本体系提供 SDK 级懒加载与热禁用决策输入 |
| 生产事故响应 | 《生产事故OnCall》 | 漏洞应急沿用工单分级与值班机制 |

---

## 4. 依赖分级分类模型

### 4.1 治理级别定义

| 级别 | 定义 | 判定规则（满足其一） | 示例 |
| --- | --- | --- | --- |
| **L0 关键** | 故障直接影响资损/合规/核心闭环 | ① 涉及支付、账号鉴权；② 处理未成年人个人信息；③ 出现在 MVP-P0 链路 | 微信支付 SDK、一键登录 SDK、大模型 SDK、埋点 SDK |
| **L1 重要** | 故障导致明显功能退化 | 核心功能依赖且无服务端降级路径 | 厂商推送 SDK、OCR SDK、ASR/TTS SDK |
| **L2 一般** | 故障影响局部体验 | 有替代实现或可降级 | Flutter 社区 UI 组件、工具类库 |
| **L3 可替换** | 构建期/开发期依赖 | 不进入运行时 | 代码生成器、Lint 插件、构建工具链 |

### 4.2 分级治理策略矩阵

| 治理动作 | L0 | L1 | L2 | L3 |
| --- | --- | --- | --- | --- |
| 准入评审 | 委员会评审（安全+法务+架构） | 安全+架构双人审 | 架构单人审 | 登记即可 |
| 漏洞扫描频率 | 每次构建 + 每日定时 | 每次构建 | 每周 | 每月 |
| Critical 漏洞修复 SLA | 24h 评估 / 7d 修复 | 48h / 14d | 7d / 30d | 下一迭代 |
| 强制 Owner | 是（必须在职团队成对） | 是（单人可） | 建议 | 否 |
| 版本升级窗口 | 灰度验证后推进 | 回归测试后推进 | 随迭代 | 随工具链 |
| 运行时监控 | 调用成功率+耗时+崩溃归因 | 成功率+耗时 | 无 | 无 |
| 隐私披露 | 必须（字段级） | 必须 | 仅本地库不披露 | 否 |
| 允许热禁用 | 是（支付类除外，需风控确认） | 是 | 是 | - |

### 4.3 本项目初始分级种子（示例，台账 seed 数据）

| 三方件 | 类别 | 级别 | 平台 | 披露需求 |
| --- | --- | --- | --- | --- |
| 大模型适配 SDK（多供应商） | AI 服务 | L0 | 服务端 | 是（出域数据：题目文本） |
| OCR 识别 SDK | 语音视觉 | L1 | 服务端/端侧 | 是（出域数据：题目图片） |
| ASR/TTS SDK | 语音视觉 | L1 | 服务端/端侧 | 是（出域数据：语音） |
| 华为/小米/OPPO/vivo/荣耀推送 SDK | 消息通道 | L1 | Android | 是（设备标识符） |
| 微信开放平台 SDK（登录/分享） | 账号 | L0 | 全端 | 是（OpenID） |
| 一键登录 SDK（号码认证） | 账号 | L0 | Android/iOS | 是（手机号） |
| 微信支付 / 支付宝 / StoreKit | 支付 | L0 | 全端 | 是（订单信息） |
| 埋点 SDK | 数据 | L0 | 全端 | 是（行为事件） |
| 崩溃收集 SDK | 监控 | L1 | 全端 | 是（设备信息） |
| Flutter pub 社区包（UI/工具类） | 开源库 | L2/L3 | 客户端 | 否（本地库） |
| FastAPI / SQLAlchemy / Celery 生态 | 开源库 | L1 | 服务端 | 否（不分发） |

---

## 5. 数据结构定义

### 5.1 ER 关系

```text
vendor (供应商, 复用《供应商管理》)
   │ 1
   │
   ▼ n
dependency_registry (三方件台账主表) ──1:n──▶ dependency_version_snapshot (版本快照)
   │ 1                                        │
   │ n                                        │
   ▼                                          ▼
sdk_privacy_declaration (隐私披露条目)    vulnerability_event (漏洞事件)
   │ 1                                          │ 1
   │                                            │
   ▼ n                                          ▼ n
license_review_record (License审查)        upgrade_task (升级任务)
        review_ticket (评审工单：准入/升级/退役，关联 dependency_registry)
```

### 5.2 台账主表 `dependency_registry`

```sql
CREATE TABLE `dependency_registry` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `artifact_key`        VARCHAR(255) NOT NULL COMMENT '规范坐标：mvn:group:artifact / pub:package / pypi:name / native:sdk-name',
  `display_name`        VARCHAR(128) NOT NULL COMMENT '展示名，如「华为推送 SDK」',
  `category`            VARCHAR(32)  NOT NULL COMMENT 'AI_SERVICE/VOICE_VISION/PUSH/ACCOUNT/PAYMENT/DATA_MONITOR/OPENSOURCE_LIB/TOOLCHAIN',
  `platform`            VARCHAR(32)  NOT NULL COMMENT 'SERVER/ANDROID/IOS/FLUTTER/WEB/CROSS',
  `level`               VARCHAR(4)   NOT NULL COMMENT 'L0/L1/L2/L3',
  `vendor_id`           BIGINT UNSIGNED NULL COMMENT '关联供应商表（服务型 SDK 必填）',
  `repo_url`            VARCHAR(512) NULL COMMENT '官方源码/发布仓库',
  `license_spdx`        VARCHAR(64)  NULL COMMENT '主许可证 SPDX 标识，多许可逗号分隔',
  `license_risk`        VARCHAR(8)   NULL COMMENT 'FORBIDDEN/CONDITIONAL/PERMISSIVE',
  `owner_user_ids`      JSON         NULL COMMENT '责任团队 uid 数组，L0/L1 必填',
  `status`              VARCHAR(16)  NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/REVIEWING/APPROVED/DEPRECATED/RETIRED',
  `current_version`     VARCHAR(64)  NULL COMMENT '当前生产使用的锁定版本',
  `introduced_version`  VARCHAR(32)  NULL COMMENT '引入的应用版本，如 app-1.2.0',
  `init_mode`           VARCHAR(16)  NOT NULL DEFAULT 'LAZY' COMMENT 'EAGER启动即初始化/LAZY按需/ON_CONSENT同意后/NEVER纯库',
  `remote_disable_key`  VARCHAR(128) NULL COMMENT '热禁用远程配置键，如 sdk.disable.hms_push',
  `size_bytes`          INT UNSIGNED NULL COMMENT '对包体积增量（KB 级记录，客户端）',
  `privacy_scope`       JSON         NULL COMMENT '收集字段/权限/出域数据摘要（冗余，权威在披露表）',
  `replacement_plan`    VARCHAR(512) NULL COMMENT '可替代性说明：替代候选或锁定理由',
  `note`                VARCHAR(1024) NULL,
  `created_at`          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_artifact` (`artifact_key`),
  KEY `idx_status_level` (`status`, `level`),
  KEY `idx_vendor` (`vendor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='三方件台账主表';
```

### 5.3 版本快照表 `dependency_version_snapshot`

每次发布构建落一条快照，支撑"任一历史版本用了什么依赖"的追溯（漏洞爆发时反查影响面）。

```sql
CREATE TABLE `dependency_version_snapshot` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dependency_id`  BIGINT UNSIGNED NOT NULL,
  `app_release`    VARCHAR(32)  NOT NULL COMMENT '应用/服务发布版本号',
  `component`      VARCHAR(64)  NOT NULL COMMENT 'app/server/admin-web',
  `version`        VARCHAR(64)  NOT NULL COMMENT '该次构建实际锁定的依赖版本',
  `is_direct`      TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1=直接依赖 0=传递依赖',
  `sbom_digest`    CHAR(64)     NOT NULL COMMENT '本次构建 SBOM 文件 sha256，同次构建共用',
  `created_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_dep_release` (`dependency_id`, `app_release`, `component`, `version`),
  KEY `idx_sbom` (`sbom_digest`),
  KEY `idx_version` (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='依赖版本构建快照';
```

### 5.4 隐私披露表 `sdk_privacy_declaration`（PIPL 第三方共享清单数据源）

```sql
CREATE TABLE `sdk_privacy_declaration` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dependency_id`       BIGINT UNSIGNED NOT NULL,
  `vendor_cert_name`    VARCHAR(128) NOT NULL COMMENT '运营商备案主体全称（商店/监管要求）',
  `purpose`             VARCHAR(255) NOT NULL COMMENT '处理目的，面向用户可读',
  `collected_fields`    JSON NOT NULL COMMENT '收集的个人信息字段，如 ["设备IMEI","位置(粗略)"]',
  `collect_frequency`   VARCHAR(32)  NOT NULL COMMENT 'ONCE单次/PER_CALL每次调用/BACKGROUND后台周期',
  `permissions_used`    JSON NOT NULL COMMENT '申请的系统权限，如 ["android.permission.READ_PHONE_STATE"]',
  `data_outbound`       TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '是否存在数据出域（离开设备/本服务）',
  `retention_days`      INT NOT NULL DEFAULT 90 COMMENT '第三方侧数据保留期（合同约定）',
  `disclosure_status`   VARCHAR(16)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/PUBLISHED/OFFLINE',
  `policy_version`      VARCHAR(32)  NULL COMMENT '披露生效的隐私政策版本，如 v3.1',
  `effective_at`        DATETIME(3)  NULL,
  `created_at`          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_dep` (`dependency_id`),
  KEY `idx_status` (`disclosure_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='SDK 隐私披露条目';
```

### 5.5 License 审查表 `license_review_record`

```sql
CREATE TABLE `license_review_record` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dependency_id`   BIGINT UNSIGNED NOT NULL,
  `spdx_list`       VARCHAR(255) NOT NULL COMMENT '识别到的全部许可证',
  `risk_level`      VARCHAR(8)   NOT NULL COMMENT 'FORBIDDEN/CONDITIONAL/PERMISSIVE',
  `usage_context`   VARCHAR(16)  NOT NULL COMMENT 'SERVER_SaaS不分发/CLIENT随App分发/TOOL构建期',
  `decision`        VARCHAR(16)  NOT NULL COMMENT 'APPROVE/REJECT/NEEDS_LAWYER',
  `conditions`      JSON NULL COMMENT 'CONDITIONAL 时的满足条件清单（动态链接/隔离进程/保留声明等）',
  `reviewer`        VARCHAR(64)  NOT NULL,
  `reviewed_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_dep` (`dependency_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='License 审查记录';
```

### 5.6 漏洞事件表 `vulnerability_event`

```sql
CREATE TABLE `vulnerability_event` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `vuln_id`          VARCHAR(64)  NOT NULL COMMENT 'CVE-2025-XXXX / GHSA-xxxx / CNVD-2025-XXXX',
  `source`           VARCHAR(16)  NOT NULL COMMENT 'OSV/NVD/GHSA/CNVD/MANUAL',
  `dependency_id`    BIGINT UNSIGNED NOT NULL,
  `affected_range`   VARCHAR(128) NOT NULL COMMENT '受影响版本区间，如 >=2.0.0,<2.3.1',
  `fixed_version`    VARCHAR(64)  NULL COMMENT '修复版本',
  `cvss_score`       DECIMAL(3,1) NOT NULL COMMENT 'CVSS v3.1 基础分',
  `severity`         VARCHAR(16)  NOT NULL COMMENT 'CRITICAL/HIGH/MEDIUM/LOW',
  `exploitability`   VARCHAR(16)  NOT NULL DEFAULT 'UNKNOWN' COMMENT '是否已有在野利用: POC/EXPLOITED/UNKNOWN（加权依据）',
  `reachability`     VARCHAR(16)  NOT NULL DEFAULT 'UNCONFIRMED' COMMENT '本项目是否实际调用受影响代码路径: CONFIRMED_REACHED/UNCONFIRMED',
  `effective_score`  DECIMAL(3,1) NOT NULL COMMENT '加权分 = cvss × 利用加权和可达性系数（见§8.2）',
  `event_status`     VARCHAR(16)  NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN/TRIAGING/MITIGATED/FIXED/ACCEPTED_RISK/FALSE_POSITIVE',
  `deadline_at`      DATETIME(3)  NULL COMMENT '按级别 SLA 计算的处置截止时间',
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_vuln_dep` (`vuln_id`, `dependency_id`),
  KEY `idx_status_sev` (`event_status`, `effective_score`),
  KEY `idx_deadline` (`deadline_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='漏洞事件表';
```

### 5.7 升级任务表 `upgrade_task`

```sql
CREATE TABLE `upgrade_task` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dependency_id`   BIGINT UNSIGNED NOT NULL,
  `from_version`    VARCHAR(64) NOT NULL,
  `to_version`      VARCHAR(64) NOT NULL,
  `reason`          VARCHAR(16)  NOT NULL COMMENT 'SECURITY/FEATURE/DEPRECATE/MAINTENANCE',
  `risk_level`      VARCHAR(8)   NOT NULL COMMENT 'MAJOR跨大版本/MINOR/PATCH',
  `state`           VARCHAR(16)  NOT NULL DEFAULT 'PLANNED' COMMENT 'PLANNED/DEVELOPING/TESTING/CANARY/ROLLOUT/DONE/ROLLED_BACK/ABANDONED',
  `canary_pct`      TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '灰度百分比',
  `rollback_plan`   VARCHAR(512) NOT NULL COMMENT '回滚方案（MAJOR 必填）',
  `ticket_id`       BIGINT UNSIGNED NULL COMMENT '关联评审工单',
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_dep` (`dependency_id`),
  KEY `idx_state` (`state`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='依赖升级任务';
```

### 5.8 评审工单表 `review_ticket`

```sql
CREATE TABLE `review_ticket` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ticket_type`     VARCHAR(16)  NOT NULL COMMENT 'INTRO准入/UPGRADE升级/RETIRE退役/DOWNGRADE降级',
  `dependency_id`   BIGINT UNSIGNED NULL COMMENT '准入时可为空（尚无台账记录）',
  `proposer_uid`    VARCHAR(64)  NOT NULL,
  `score_total`     DECIMAL(5,2) NULL COMMENT '量化评分模型输出（§6.3）',
  `score_detail`    JSON NULL COMMENT '六维得分明细',
  `checklist_result` JSON NOT NULL COMMENT '检查单逐项结果',
  `reviewers`       JSON NOT NULL COMMENT '评审人 uid 与角色',
  `state`           VARCHAR(16)  NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/IN_REVIEW/CHANGE_REQUESTED/APPROVED/REJECTED/CANCELLED',
  `final_decision`  VARCHAR(1024) NULL,
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_state` (`state`),
  KEY `idx_dep` (`dependency_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='三方件评审工单';
```

### 5.9 核心状态机

**台账准入状态机**（`dependency_registry.status`）：

```text
DRAFT ──提交评审──▶ REVIEWING ──通过──▶ APPROVED ──主动淘汰/替代完成──▶ DEPRECATED ──代码移除+最后一个版本不再发布──▶ RETIRED
                      │                                                        ▲
                      └────驳回 REJECTED（工单可修改后重新进入 REVIEWING）          │
                                            重新引入（新工单） ──────────────────┘
约束：
- APPROVED 才允许出现在生产构建（CI 对账失败 otherwise）
- DEPRECATED：仍可构建（存量版本），但新版本发布被阻断
- RETIRED：只读归档，保留供历史 SBOM 追溯
```

**漏洞事件状态机**（`vulnerability_event.event_status`）：

```text
OPEN ──自动富化(cvss/利用/可达性)──▶ TRIAGING ──确认需处置──▶ (创建 upgrade_task) ──修复版本上线──▶ FIXED
                                      │
                                      ├────不可利用且风险可接受(记录理由+审批)──▶ ACCEPTED_RISK（每季度复审）
                                      ├────不适用本项目（版本区间不符等）──────▶ FALSE_POSITIVE
                                      └────暂无升级但已缓解(禁用功能/WAF/隔离)──▶ MITIGATED（跟踪上游修复）
超时规则：deadline_at 到期未离开 TRIAGING → 升级事件级别并通知 OnCall（复用《生产事故OnCall》值班表）
```

**升级任务状态机**（`upgrade_task.state`）：PLANNED → DEVELOPING → TESTING → CANARY → ROLLOUT → DONE；任一阶段发现问题 → ROLLED_BACK 或 ABANDONED（记录根因回工单）。

---

## 6. 依赖准入评审流程

### 6.1 流程总览

```text
开发者                         评审人(安全/架构/法务)                治理平台
  │ 提出《引入申请》工单                                            │
  ├───────────────────────────────────────────────────────────────▶│ 1.校验重复性（artifact_key 唯一）
  │ 2.填写检查单+跑本地预检脚本                                      │    （可替换性预检：候选库≥2对比）
  │ ◀─ 自动预检：License识别/包体积/维护活跃度/已知漏洞数 ────────────┤ 2.生成 score_total
  ├───────────────────────────────────────────────────────────────▶│ 3.按 level 路由评审人
  │        3.评审（L0: 三方会审 / L1: 双人 / L2: 单人 / L3: 备案）     │
  │ ◀── 4.结论：APPROVED / CHANGE_REQUESTED / REJECTED ─────────────┤ 4.写台账(status=APPROVED)
  │ 5.代码合入（manifest 变更 + 台账ID 注释）                        │    5.CI 对账通过才可合入主干
```

### 6.2 评审检查单（六维）

| 维度 | 检查项 | 不通过示例 |
| --- | --- | --- |
| 安全 | ① 无未修复 Critical/High 漏洞；② 传输使用 TLS；③ 无硬编码后门/可疑远端域名；④ 混淆/加固不影响审计 | 组件存在 CVE-2024-xxxx(CVSS 9.8) 未修复 |
| 隐私 | ① 收集字段最小化并登记；② 无后台自启动/关联启动（Android）；③ 数据出域目的地明确；④ 提供隐私配置能力（延迟初始化/关闭遥测） | SDK 默认上报精确位置且无法关闭 |
| 性能/体积 | ① 客户端增量体积 ≤ 预算（§11）；② 初始化耗时 ≤ 预算；③ 无常驻后台线程/定时唤醒滥用 | 引入后 APK 增量 8MB（预算 2MB） |
| License | ① 非 FORBIDDEN 级；② CONDITIONAL 级满足条件；③ NOTICE 义务可履行 | 含 AGPL-3.0 传递依赖 |
| 可维护性 | ① 最近 6 个月有发布/响应 issue；② 文档齐全；② 团队具备排障能力；④ 锁定版本可复现构建 | 上游 2 年未更新，issue 无人响应 |
| 可替代性 | ① L0/L1 必须给出替代候选与切换成本；② 优先选择有抽象层隔离的接入方式（见 §12.1） | 直连厂商私有 API 无适配层 |

### 6.3 量化评分模型

总分 100 = 安全(30) + 隐私(25) + 性能体积(15) + License(15) + 可维护性(10) + 可替代性(5)；任一维度得 0 分则一票否决。

```python
# scoring.py —— 评审评分模型（服务端 FastAPI 内实现）
SECURITY, PRIVACY, PERF, LICENSE, MAINTAIN, REPLACE = 30, 25, 15, 15, 10, 5

VETO = "ANY_DIMENSION_ZERO"

def score_security(critical: int, high: int, has_pinned_tls: bool, suspicious_domains: int) -> int:
    if critical > 0: return 0                      # 一票否决
    if suspicious_domains > 0: return 0
    s = SECURITY
    s -= min(high * 5, 15)
    if not has_pinned_tls: s -= 10
    return max(s, 0)

def score_privacy(fields_minimal: bool, can_disable_telemetry: bool,
                  background_start: bool, outbound_declared: bool) -> int:
    if background_start and not can_disable_telemetry: return 0   # 工信部通报典型场景
    if not outbound_declared: return 0
    s = PRIVACY
    if not fields_minimal: s -= 10
    if not can_disable_telemetry: s -= 8
    return max(s, 0)

def score_perf(size_mb: float, budget_mb: float, init_ms: int, init_budget_ms: int) -> int:
    if size_mb > budget_mb * 2: return 0
    s = PERF
    s -= int((size_mb / max(budget_mb, 0.1) - 1) * 10) if size_mb > budget_mb else 0
    s -= (init_ms // init_budget_ms - 1) * 3 if init_ms > init_budget_ms else 0
    return max(s, 0)

def score_license(risk: str, conditions_met: bool) -> int:
    return {\"FORBIDDEN\": 0,
            \"CONDITIONAL\": LICENSE - (0 if conditions_met else 8),
            \"PERMISSIVE\": LICENSE}[risk]

def score_maintenance(months_since_release: int, issue_answer_rate: float) -> int:
    if months_since_release > 18: return 0
    s = MAINTAIN
    s -= max(0, (months_since_release - 6) // 3)
    s -= int((1 - issue_answer_rate) * 5)
    return max(s, 0)

def score_replaceable(has_alternative: bool, behind_adapter: bool) -> int:
    s = REPLACE
    if not has_alternative: s -= 3
    if not behind_adapter: s -= 2
    return max(s, 0)
```

| 总分 | 结论 |
| --- | --- |
| ≥ 80 且无否决 | APPROVED |
| 60~79 | CHANGE_REQUESTED（列明整改项，可复审） |
| < 60 或存在否决项 | REJECTED（60 天冷却期后可带新证据重提） |

### 6.4 准入 API

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/admin/dep-gov/tickets` | POST | 创建准入/升级/退役工单（body 含检查单与预检产物） |
| `/api/admin/dep-gov/tickets/{id}` | GET | 工单详情（含评分明细） |
| `/api/admin/dep-gov/tickets/{id}/review` | POST | 提交评审结论 `{decision, dimension_scores, comment}` |
| `/api/admin/dep-gov/registry` | GET/POST | 台账查询（分页/按 level、status、category 过滤）与登记 |
| `/api/admin/dep-gov/registry/{id}` | PATCH | 更新 Owner、级别、热禁用键等 |
| `/api/admin/dep-gov/registry/{id}/deprecate` | POST | 进入 DEPRECATED（需附替代方案说明） |
| `/api/admin/dep-gov/disclosure/export` | GET | 导出隐私政策第三方共享清单（JSON/Markdown，§9.2） |
| `/api/ci/dep-gov/gate` | POST | CI 卡点查询（内部）：入参 SBOM digest，返回放行/阻断与原因（§7.4） |

权限遵循《权限管理与角色访问控制》：以上接口限定 `security_admin` / `architect` / `legal` / `dev_lead` 组合（见 §13.3）。

---

## 7. SBOM 对账与构建期卡点

### 7.1 SBOM 生成方案

| 构建 | 工具 | 格式 |
| --- | --- | --- |
| Flutter 客户端 | `flutter pub deps --json` + 自研转 CycloneDX；Android 原生 aar 用 `cyclonedx-maven-plugin`；iOS Pods 用 `sbom-tool` | CycloneDX 1.5 |
| 服务端 Python | `cyclonedx-py`（读 `pyproject.toml` + `requirements.lock`） | CycloneDX 1.5 |
| Admin Web | `npm ci --package-lock-only` + `cyclonedx-npm` | CycloneDX 1.5 |
| 容器镜像 | `syft <image>` | CycloneDX 1.5 |

所有 SBOM 以构建号命名归档对象存储：`s3://pt-sbom/{component}/{release}/{build_id}.cdx.json`，`sha256` 写入 `dependency_version_snapshot.sbom_digest`。

### 7.2 台账-SBOM 对账引擎

构建产物中每个组件必须在台账中处于 `APPROVED`（或存量 `DEPRECATED` 且版本未变）：

```python
# reconcile.py —— CI 内运行的 SBOM 对账
from cyclonedx_py.parser import parse as parse_sbom  # 伪依赖，实现按所选语言库调整

ALLOWED_STATUS = {"APPROVED", "DEPRECATED"}          # DEPRECATED 仅允许存量版本

def reconcile(sbom_path: str, registry_api: str, token: str) -> dict:
    comps = parse_sbom(sbom_path)                     # [{purl, version, scope}, ...]
    known = fetch_registry(registry_api, token)       # artifact_key -> {status, level, current_version}
    blockers: list[str] = []
    for c in comps:
        key = purl_to_artifact_key(c.purl)            # purl -> mvn:/pub:/pypi: 规范坐标
        rec = known.get(key)
        if rec is None:
            blockers.append(f"UNKNOWN:{key}@{c.version} 未登记，先提交准入工单")
        elif rec["status"] not in ALLOWED_STATUS:
            blockers.append(f"STATUS:{key} 状态 {rec['status']} 不允许进入构建")
        elif rec["status"] == "DEPRECATED" and c.version != rec["current_version"]:
            blockers.append(f"DEPRECATED_UPGRADE:{key} 已弃用，禁止升级到 {c.version}")
    return {"pass": not blockers, "blockers": blockers}
```

### 7.3 漏洞 / License / 体积卡点规则

| Gate | 工具 | 阻断条件 | 放行条件（豁免） |
| --- | --- | --- | --- |
| G1 台账对账 | §7.2 | 存在 UNKNOWN / 非 APPROVED 组件 | 紧急 Hotfix：security_admin 在平台审批 72h 临时豁免（自动生成补登记工单） |
| G2 漏洞 | `osv-scanner`（全端）/ `trivy`（镜像） | effective_score 对应 CRITICAL 且 reachability=CONFIRMED_REACHED | ACCEPTED_RISK 状态事件附审批号 |
| G3 License | `scancode` / `licensee` | SPDX 命中 FORBIDDEN 清单（GPL-2/3、AGPL、SSPL、CC-NC） | 无豁免（法务书面特批除外） |
| G4 体积 | §11.2 产物对比 | 单依赖增量超预算 2 倍，或包总体积超基线 5% | 评审工单 APPROVED 中明确记录本次豁免 |
| G5 锁文件 | `pnpm-lock`/`requirements.lock`/`pubspec.lock` diff 校验 | manifest 变更但锁文件未同步提交 | - |

### 7.4 CI 集成示例（GitHub Actions）

```yaml
# .github/workflows/dep-gate.yml
name: dependency-gate
on: [pull_request, workflow_dispatch]

jobs:
  sbom-and-gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }

      # 服务端 SBOM + 台账对账 + 漏洞扫描
      - name: Server SBOM
        run: |
          pip install cyclonedx-py
          cyclonedx-py requirements -o server.cdx.json --validate
      - name: Registry Reconcile (G1)
        run: python tools/dep_gov/reconcile.py server.cdx.json
        env:
          DEP_GOV_API: ${{ secrets.DEP_GOV_API }}
          DEP_GOV_TOKEN: ${{ secrets.DEP_GOV_TOKEN }}
      - name: Vuln Scan (G2)
        run: |
          curl -sSfL https://raw.githubusercontent.com/google/osv-scanner/main/install.sh | bash -s -- -b /usr/local/bin
          osv-scanner --lockfile=server/requirements.lock --format=json -o osv.json || true
          python tools/dep_gov/osv_gate.py osv.json   # 按 effective_score+豁免清单判定退出码
      - name: License Scan (G3)
        run: python tools/dep_gov/license_gate.py server.cdx.json

      # 客户端 SBOM（Flutter）
      - uses: subosito/flutter-action@v2
        with: { flutter-version: "3.24.0" }
      - name: Flutter SBOM + Reconcile
        run: |
          flutter pub get
          flutter pub deps --json > pub_deps.json
          python tools/dep_gov/pub_to_cdx.py pub_deps.json app.cdx.json
          python tools/dep_gov/reconcile.py app.cdx.json
        env:
          DEP_GOV_API: ${{ secrets.DEP_GOV_API }}
          DEP_GOV_TOKEN: ${{ secrets.DEP_GOV_TOKEN }}

      # 卡点结果统一回写平台（工单/PR comment）
      - name: Report Gate Result
        if: always()
        run: python tools/dep_gov/report_gate.py --build ${{ github.run_id }} --pr ${{ github.event.number }}
```

### 7.5 版本锁定规范（承接《项目技术选型》§锁定策略）

- 客户端 `pubspec.yaml`：直接依赖用精确版本（`x.y.z`），锁文件必入库；
- 服务端 `pyproject.toml` 声明兼容区间，CI 用 `pip-compile` 生成 `requirements.lock`（含 hash），部署只认 lock；
- 版本升级 = `upgrade_task` + 锁文件变更 PR（自动关联工单号，CI 校验 PR 描述含 `UpgradeTask:#id`）；
- 禁止 `latest`、`*`、`main` 分支引用；Git 依赖必须 pin commit hash。

---

## 8. 漏洞监测与应急响应

### 8.1 情报源与轮询

| 情报源 | 覆盖 | 接入方式 |
| --- | --- | --- |
| OSV.dev | PyPI/pub/npm/Maven 全覆盖，含 GHSA | `osv-scanner` 定时全量扫描 + OSV API 按 package 订阅 |
| NVD | CVE 权威数据（CVSS） | NVD API 2.0 增量拉取（每日） |
| CNVD/CNNVD | 国内通报 | 人工录入 + 每周安全例会同步 |
| GitHub Dependabot | 仓库级通告 | `dependabot.yml`（已有配置，告警 webhook 转发本平台） |
| 厂商公告（推送/微信/支付 SDK） | 私有 SDK 通告 | 供应商接口人邮件 → 安全值班录入 |

### 8.2 事件分级与加权

基础 CVSS 不能完全反映本项目风险，采用**有效分**：

```text
effective_score = cvss × E × R
E（利用加权）：EXPLOITED=1.3   POC=1.15   UNKNOWN=1.0
R（可达性系数）：CONFIRMED_REACHED=1.0   UNCONFIRMED=0.6（通过调用图/入口分析确认）
```

| effective_score | 事件级别 | 响应 SLA（自情报进入起） | 升级修复 SLA |
| --- | --- | --- | --- |
| ≥ 9.0 | S1 | 2h 内完成 Triaging，通知安全负责人 | 24h 出处置方案，7d 修复或缓解 |
| 7.0~8.9 | S2 | 8h | 48h 方案，14d 修复 |
| 4.0~6.9 | S3 | 24h | 30d |
| < 4.0 | S4 | 72h | 下一迭代 |

**可达性判定**：L0/L1 依赖维护"调用面清单"（`privacy_scope` 同级字段 `call_surface`：本项目中实际调用的 API 列表），漏洞披露的受影响函数与 `call_surface` 求交，非空即 `CONFIRMED_REACHED`。静态调用图（服务端 `semgrep` 自定义规则 / 客户端 Dart 调用分析）辅助自动判定。

### 8.3 应急流程

```text
[情报进入] ──▶ 自动富化（CVSS/利用状态/受影响区间/可达性）──▶ 分级
                                                            │
              ┌─────────────────────────────────────────────┤
              ▼                                             ▼
           S3/S4：进入漏洞看板，排入迭代                      S1/S2：
                                                          ① 值班复用《生产事故OnCall》通道拉群
                                                          ② 三个并行选项评估：
                                                             a) 升级 fixed_version（优先）
                                                             b) 缓解：热禁用/功能降级/WAF规则/网络阻断出域
                                                             c) ACCEPTED_RISK（需书面审批，S1 级需 CTO 会签）
                                                          ③ 创建 upgrade_task，MAJOR 版本走灰度
                                                          ④ 修复后回归：复测 + 披露评估（是否触发改版隐私清单）
                                                          ⑤ 复盘：为何引入时未拦截（检查单是否需增项）
```

### 8.4 定时轮询服务（Celery Beat）

```python
# tasks/vuln_poll.py
from celery import Celery
import requests, datetime

app = Celery("dep_gov", broker="redis://redis:6379/5")

OSV_QUERY = "https://api.osv.dev/v1/query"

@app.task(name="dep_gov.poll_osv")
def poll_osv():
    """每日 06:00 对台账全量 APPROVED 依赖执行 OSV 查询（beat: crontab(hour=6, minute=0)）"""
    for dep in registry_iter(status="APPROVED"):          # 台账游标分页
        resp = requests.post(OSV_QUERY, json={
            "package": {"name": dep.osv_package_name, "ecosystem": dep.ecosystem},
            "version": dep.current_version,
        }, timeout=15)
        for vuln in resp.json().get("vulns", []):
            upsert_vulnerability_event(
                vuln_id=vuln["id"],
                dependency_id=dep.id,
                affected_range=extract_range(vuln, dep.current_version),
                fixed_version=extract_fixed(vuln),
                cvss=extract_cvss(vuln),                  # 无 CVSS 时用 severity 映射估计
                source="OSV",
            )
    # 超时 SLA 巡检：deadline_at 临近/逾期事件 → 告警升级
    escalate_overdue_events()

def upsert_vulnerability_event(**kw):
    """幂等写入：uk(vuln_id, dependency_id) 冲突则仅更新 exploitability/固定版本等新信息"""
    ...
```

### 8.5 升级风险与回滚

| 风险 | 控制手段 |
| --- | --- |
| 大版本 API 不兼容 | MAJOR 升级强制走适配层（§12.1）+ 回归测试集（该 SDK 的契约测试） |
| 支付/登录类升级 | 沙箱环境全链路验证 + 5%→20%→50%→100% 灰度（复用《灰度发布与特性开关系统》） |
| 传递依赖连带升级 | 锁文件 diff 必须附在 upgrade_task，连带项逐一过 G1~G3 |
| 回滚窗口 | 客户端依赖回滚 = 回退构建版本；服务端 = 回退镜像 tag；均需在 rollback_plan 写明步骤与数据兼容性检查 |

---

## 9. 隐私合规披露管线（PIPL / 工信部要求落地）

### 9.1 披露数据流

```text
sdk_privacy_declaration（权威源）
        │  disclosure_status=PUBLISHED 且依赖 init_mode != NEVER
        ▼
披露装配服务 ──▶ /privacy/third-party-list.json（H5 隐私政策页面渲染数据）
        │              │
        │              └──▶ 应用商店备案表导出（CSV：SDK名/运营商/用途/字段/频次）
        └──▶ 客户端内置快照（随包发布，离线可查）+ 启动时与线上 diff 提示更新
```

### 9.2 共享清单 JSON Schema 与生成逻辑

```json
{
  "policy_version": "v3.1",
  "generated_at": "2026-08-15T03:00:00Z",
  "items": [
    {
      "sdk_name": "华为推送服务 SDK",
      "vendor_cert_name": "华为软件技术有限公司",
      "purpose": "向您的设备推送学习提醒与系统通知",
      "collected_fields": ["设备标识符(AAID)", "应用列表(仅推送通道注册)"],
      "collect_frequency": "PER_CALL",
      "permissions_used": [],
      "data_outbound": true,
      "retention_days": 90,
      "opt_out_path": "设置-消息通知-渠道管理"
    }
  ]
}
```

```python
# disclosure.py
def build_third_party_list(session) -> dict:
    rows = (session.query(SdkPrivacyDeclaration, DependencyRegistry)
            .join(DependencyRegistry,
                  SdkPrivacyDeclaration.dependency_id == DependencyRegistry.id)
            .filter(SdkPrivacyDeclaration.disclosure_status == "PUBLISHED")
            .filter(DependencyRegistry.init_mode != "NEVER")     # 纯本地库不披露
            .filter(DependencyRegistry.status.in_(["APPROVED", "DEPRECATED"]))
            .all())
    return {"policy_version": current_policy_version(),
            "generated_at": utcnow_iso(),
            "items": [to_item(decl, dep) for decl, dep in rows]}
```

### 9.3 客户端"同意先于初始化"门控

隐私同意（含 SDK 清单）**必须发生在任何采集型 SDK 初始化之前**（监管通报高频问题）：

```dart
// lib/bootstrap/sdk_orchestrator.dart
enum SdkInitMode { eager, lazy, onConsent, never }

class SdkDescriptor {
  final String key;                 // 与台账 artifact_key 对应
  final SdkInitMode mode;
  final Future<void> Function() initializer;
  final String? remoteDisableKey;   // 台账 remote_disable_key
  const SdkDescriptor(this.key, this.mode, this.initializer, this.remoteDisableKey);
}

class SdkOrchestrator {
  /// [consentGranted] 来自隐私弹窗结果持久化（首启流程见《客户端-登录注册与入门引导》）
  static Future<void> bootstrap({
    required bool consentGranted,
    required RemoteConfig rc,       // 《客户端-远程配置同步》
  }) async {
    for (final d in registry) {
      // 1) 热禁用检查 2) 同意门控 3) 初始化
      if (d.remoteDisableKey != null && rc.getBool(d.remoteDisableKey!)) continue;
      switch (d.mode) {
        case SdkInitMode.eager:
          if (consentGranted) await d.initializer();   // 未同意：挂起，待同意后补初始化
          break;
        case SdkInitMode.onConsent:
          if (consentGranted) await d.initializer();
          break;
        case SdkInitMode.lazy:      // 首次使用时初始化，见 §12.1
        case SdkInitMode.never:
          break;
      }
    }
    // 上报本次实际初始化集合 → 服务端与披露清单对账（§9.4）
    reportInitializedSet(registry.where(_initialized).map((d) => d.key).toList());
  }
}
```

### 9.4 一致性对账（披露 vs 实际）

- 客户端每次冷启动上报 `initialized_sdk_keys`（脱敏、仅键集合）；
- 服务端比对 `initialized_sdk_keys ⊆ PUBLISHED 披露集 ∪ 本地白名单`；
- **偏差处置**：出现未披露即初始化的 SDK → S2 级合规事件 → 自动创建披露更新工单 + 通知法务；72h 未闭环则触发该 SDK 热禁用（保守策略）。

### 9.5 违规场景自检清单（每次发版跑一遍）

| # | 检查项（对应工信部通报高频问题） | 检测方式 |
| --- | --- | --- |
| 1 | 未在隐私政策中披露的 SDK 收集信息 | §9.4 对账 |
| 2 | 用户同意前初始化采集型 SDK | 集成测试：拒绝同意后抓包验证零出域流量 |
| 3 | 频繁自启动/关联启动 | Android：静态扫描 manifest + `MobSF` 动态检测 |
| 4 | 超范围收集（申请权限与功能无关） | 权限-用途映射表（`permissions_used`）人工+自动校验 |
| 5 | 无法关闭的遥测 | 检查单"隐私②"+ 回归用例验证开关生效 |
| 6 | 强制索权（不授权闪退/不可用核心功能） | 权限拒绝路径自动化测试 |

---

## 10. License 合规

### 10.1 风险分级

| 风险级 | 许可证 | 政策 |
| --- | --- | --- |
| FORBIDDEN | GPL-2.0/3.0、AGPL-3.0、SSPL-1.0、CC-NC/ND、未声明 | 禁止出现在任何构建制品（G3 硬卡点）；"未声明"按 FORBIDDEN 处理直到上游澄清 |
| CONDITIONAL | LGPL-2/3、MPL-2.0、EPL、Apache-2.0(专利条款注意) | 允许，须满足条件：动态链接/文件级隔离、保留原始声明、NOTICE 分发；客户端分发场景必须法务确认 |
| PERMISSIVE | MIT、BSD、ISC、Apache-2.0、Zlib | 允许，履行 NOTICE 义务 |

### 10.2 分发场景差异（关键）

- **服务端**（SaaS，不向用户分发二进制）：GPL 类通过"网络服务"边界通常不触发开源义务，但 AGPL 明确覆盖网络交互 → 服务端同样禁 AGPL；策略上全线禁 GPL 系以消除认知负担与未来私有化部署风险（见《私有化部署交付与许可管控体系》）；
- **客户端**（App 商店分发 = 二进制分发）：LGPL 需满足可替换性（动态链接或提供重链接能力），静态链接需法务特批；
- **私有化部署交付物**：等同分发，交付前跑完整 License 扫描并在交付包附带 THIRD-PARTY-NOTICES。

### 10.3 NOTICE 自动生成

```python
# notices.py —— 构建期生成 THIRD-PARTY-NOTICES.txt（随客户端包/私有化交付物分发）
def render_notices(sbom, license_texts_dir) -> str:
    out = ["This product includes software developed by third parties:",
           ""]
    for comp in sorted(sbom.components, key=lambda c: c.name):
        lic = comp.licenses or "NOASSERTION"
        out += [f"== {comp.name} {comp.version} ({lic}) ==",
                f"homepage: {comp.homepage or 'N/A'}",
                license_texts_dir.copyright_of(comp),   # 版权声明行
                ""]
    return "\n".join(out)
```

---

## 11. 体积与性能预算

### 11.1 预算表（初始值，随基线看板季度校准）

| 预算项 | 阈值 | 说明 |
| --- | --- | --- |
| 单个 L0/L1 SDK 客户端增量 | ≤ 2 MB（压缩后） | 超 2 倍即 G4 阻断 |
| 单个 SDK 初始化耗时（主线程） | ≤ 50 ms；总量 ≤ 300 ms | 与《客户端应用启动流程》TTI 预算联动 |
| 每版本客户端总体积增幅 | ≤ 5%（对上一 release） | 基线存于平台 |
| 服务端镜像增量（单依赖） | ≤ 20 MB | 跑批对比 |

### 11.2 构建产物监控

```bash
# Flutter：pub 依赖体积归因（写入版本快照 size_bytes）
flutter build apk --analyze-size --target-platform android-arm64 2>&1 | \
  python tools/dep_gov/parse_apk_size.py --out size_report.json

# Android 原生 aar：解包 class.jar 与 so 体积
# iOS Pods：pod install 后 Pods_*.framework 体积
# 服务端：docker image 与 pip wheel 体积 diff（CI job artifacts 对比）
```

### 11.3 超预算处置

超预算不直接否决，但必须走 CHANGE_REQUESTED：申请者在工单中说明（不可替代性论证 / 拆分按需引入 / 资源下放远端）。连续两个版本超基线 → 体积治理周会（对接《客户端应用包体积优化》）。

---

## 12. 客户端 SDK 运行时治理

### 12.1 适配层与懒加载原则

所有 L0/L1 SDK **禁止业务代码直接调用**，必须经适配层（对应《服务端-大模型推理统一适配层》同款思想在客户端落地）：

```dart
// 抽象示例：推送通道适配层（厂商 SDK 在 impl 内部才 import）
abstract class PushChannel {
  Future<String?> register();
  Future<void> bindUser(String uid);
}

class HuaweiPushChannel implements PushChannel { /* hms SDK 仅在此文件出现 */ }
class OppoPushChannel  implements PushChannel { /* ... */ }

class PushService {
  final List<PushChannel> channels;
  /// 懒初始化：首次调用 register 时才触发厂商 SDK init（SdkInitMode.lazy）
  Future<void> ensureInitialized(String channelKey) async { ... }
}
```

懒加载价值：未进入对应功能的用户不付出该 SDK 的初始化成本与数据出域风险（披露对账按"实际初始化"口径，见 §9.4）。

### 12.2 SDK 健康度监控

每个 L0/L1 SDK 的适配层统一埋点（复用《客户端性能监控与用户体验度量系统》通道）：

| 指标 | 采集点 |
| --- | --- |
| `sdk_call_total{sdk, api, code}` | 适配层出入口计数器 |
| `sdk_call_duration_ms{sdk, api}` | 耗时直方图 |
| `sdk_init_result{sdk, ok}` | 初始化成败 |
| 崩溃归因 | 崩溃栈中 SDK 包名前缀匹配 → `sdk_crash_total{sdk}`（崩溃 SDK 上报回传） |

服务端聚合规则：单 SDK 成功率 5 分钟窗口 < 95%（L0）/ < 90%（L1）→ 告警 SDK Owner；崩溃归因占比 > 5% → 自动建议热禁用评审。

### 12.3 热禁用

- 台账 `remote_disable_key` → 远程配置中心下发（客户端经 `SdkOrchestrator` 生效）；
- 禁用语义：不初始化 + 适配层调用返回降级错误码（业务按 §15 错误码降级），**不卸载**已初始化实例的静态引用（避免运行时异常），下次冷启动彻底不加载；
- 支付类 SDK 热禁用需风控会签（防止支付链路被误关）；热禁用操作审计日志入《服务端审计日志与操作追溯系统》。

---

## 13. 管理后台设计

### 13.1 页面清单（工作台名：依赖治理中心）

| 页面 | 核心功能 |
| --- | --- |
| 台账总览 | 全量列表（level/status/category/platform 过滤）、详情页（版本历史、快照、Owner、关联供应商） |
| 评审工作台 | 待办工单、检查单填写、评分详情、评审结论留痕 |
| 漏洞看板 | Open 事件列表（按 effective_score 排序）、SLA 倒计时、超时红警、事件详情（可达性证据） |
| 升级日历 | 进行中 upgrade_task 状态流、灰度进度 |
| 披露管理 | 第三方共享清单编辑与发布（发布走审批流）、商店备案表导出、对账差异列表 |
| 体积看板 | 版本间依赖体积变化 Top N、基线趋势 |
| 豁免审批 | G1~G4 临时豁免的审批与有效期管理 |

### 13.2 权限矩阵

| 操作 | security_admin | architect | legal | dev_lead | developer |
| --- | --- | --- | --- | --- | --- |
| 创建工单 | ✓ | ✓ | ✓ | ✓ | ✓ |
| L0 评审结论 | ✓(必选) | ✓(必选) | ✓(必选) | ✓ | - |
| L1 评审结论 | ✓ | ✓ | - | ✓ | - |
| L2/L3 备案 | - | ✓ | - | ✓ | - |
| 豁免审批 | ✓ | ✓(非安全类) | - | - | - |
| ACCEPTED_RISK（S1） | ✓ | ✓ | - | - | -（另需 CTO 会签） |
| 披露发布 | ✓ | - | ✓ | - | - |
| 热禁用 | ✓ | ✓ | - | ✓ | - |

### 13.3 管理后台 API 汇总

见 §6.4 与上述页面对应的 REST 资源（`/api/admin/dep-gov/*`），统一走《API 网关统一接口规范》鉴权与审计；CI 内部接口 `/api/ci/dep-gov/*` 使用构建令牌（独立鉴权域，见《服务端-密钥管理》）。

---

## 14. 监控指标与告警

### 14.1 指标定义（Prometheus）

```text
# 治理平台自身
dep_gov_gate_decision_total{gate,result}      # G1~G4 判定次数（result=pass/block/exempt）
dep_gov_vuln_events{severity,status}          # 漏洞事件存量（gauge）
dep_gov_vuln_sla_breach_total                 # SLA 超时事件数
dep_gov_disclosure_mismatch_total             # 披露对账偏差数（目标恒为 0）
dep_gov_unknown_components_total{component}   # 构建中未登记组件数（目标恒为 0）
# SDK 运行时（客户端聚合，§12.2）
sdk_call_total / sdk_call_duration_ms / sdk_crash_total{sdk}
```

### 14.2 告警规则

| 规则 | 条件 | 级别 | 通知 |
| --- | --- | --- | --- |
| 漏洞 SLA 即将超时 | S1 剩余 < 4h | P2 | Owner + 安全群 |
| 漏洞 SLA 已超时 | deadline_at < now 且 status ∈ {OPEN, TRIAGING} | P1 | 升级 OnCall（复用值班体系） |
| 披露对账偏差 | dep_gov_disclosure_mismatch_total > 0 持续 5min | P1 | 法务 + 安全（合规风险） |
| CI 出现未登记组件 | dep_gov_unknown_components_total > 0 | P3 | 提交人 + 架构群 |
| SDK 成功率跌破阈值 | §12.2 规则 | P2/P3 | SDK Owner |
| 热禁用生效异常 | 下发禁用后 initialized 上报仍包含该 key（2 个采样周期） | P2 | 客户端架构组 |

---

## 15. 错误处理

### 15.1 异常码（沿用《服务端统一业务异常码与错误分类体系》，占用内部基础设施段 90xxxx，场景码 12 = 依赖治理）

| 异常码 | 场景.错误 | HTTP | 严重度 | message | 处理 |
| --- | --- | --- | --- | --- | --- |
| 901201 | 工单.重复提交 | 409 | LOW | 该组件已存在进行中的评审工单 | 引导查看已有工单 |
| 901202 | 工单.状态非法流转 | 400 | LOW | 工单当前状态不允许该操作 | 前端禁用按钮 |
| 901203 | 台账.未登记组件 | 422 | HIGH | 构建包含未登记组件 | CI 阻断，附 artifact 列表 |
| 901204 | 台账.状态不允许构建 | 422 | HIGH | 组件状态不允许进入构建 | 同上 |
| 901205 | 漏洞.阻断未豁免 | 422 | HIGH | 存在未处置的阻断级漏洞 | CI 阻断，链接事件详情 |
| 901206 | License.禁用许可 | 422 | HIGH | 组件包含禁用许可证 | CI 阻断，不可豁免 |
| 901207 | 披露.清单不一致 | 500 | CRITICAL | 实际初始化 SDK 超出披露范围 | 触发 §9.4 合规事件流 |
| 901208 | 豁免.过期 | 410 | HIGH | 临时豁免已过期 | 重新走审批 |
| 901209 | 热禁用.支付类需会签 | 412 | MEDIUM | 支付类 SDK 禁用需风控会签 | 引转会签流 |
| 901210 | OSV.情报源不可用 | 200(异步告警) | MEDIUM | 漏洞情报源连续失败 | 降级：切换备用源 + 人工周扫 |

### 15.2 关键失败场景

| 场景 | 影响 | 处置 |
| --- | --- | --- |
| 治理平台不可用导致 CI 无法判定 | 构建停滞 | CI 本地缓存上次判定结果（TTL 24h）放行非安全类；G2/G3 用本地离线规则兜底判定 |
| OSV/NVD API 限流 | 漏洞延迟发现 | 轮询退避 + 备用源；连续 3 日失败升级人工 |
| SBOM 工具链漏报（原生 aar 未覆盖） | 台账缺口 | 四路 SBOM 来源交叉验证；发布前"包内容物扫描"（so/jar 符号抽取）兜底 |
| 客户端旧版本长期不升级 | 旧漏洞持续暴露 | 版本快照反查影响面 → 推送强更（复用《客户端版本管理与升级策略》强更通道） |
| 紧急 Hotfix 需未评审依赖 | 上线阻塞 | 72h 临时豁免通道（security_admin 审批 + 自动补登记工单 + 到期未闭环自动阻断下次构建） |

---

## 16. 实施路线

| 阶段 | 范围 | 验收 |
| --- | --- | --- |
| MVP（2 周） | 台账表 + 准入工单（表单版）+ G1 对账卡点 + 存量依赖全量登记 | 主干 CI 未登记组件数 = 0 |
| V1（+3 周） | G2 漏洞卡点 + OSV 轮询服务 + 漏洞看板 + SLA 告警 | S1 漏洞告警链路演练通过 |
| V1.5（+3 周） | 披露管线（清单生成 + 客户端同意门控 + 对账）+ 商店备案导出 | §9.5 自检清单 6/6 通过 |
| V2（+4 周） | License 审查流 + NOTICE 生成 + 体积看板 + 热禁用 + SDK 健康度 | 管理后台工作台全部页面可用 |

## 17. 附录 A：准入检查单模板（工单内嵌）

```yaml
ticket_type: INTRO
artifact:
  key: pub:crypto_x
  platform: FLUTTER
  level: L2
checklist:
  security:
    known_critical_high: 0
    tls_pinned: true
    suspicious_domains: 0
  privacy:
    fields_minimal: true
    can_disable_telemetry: true
    background_start: false
    outbound_declared: true
  perf:
    size_mb: 0.3
    budget_mb: 2.0
    init_ms: 8
  license:
    spdx: MIT
    risk: PERMISSIVE
    usage_context: CLIENT
  maintainability:
    months_since_release: 2
    issue_answer_rate: 0.9
  replaceability:
    has_alternative: true
    behind_adapter: true
score: { total: 96, veto: false }
```

## 18. 附录 B：与《数据安全与隐私合规体系》条款映射

| 合规体系条款 | 本设计落地点 |
| --- | --- |
| "隐私政策中列出所有第三方 SDK 及其收集的信息" | §5.4 披露表 + §9.2 清单生成 |
| "第三方 SDK 遵守最小必要原则" | §6.2 隐私检查单① + §9.5-4 权限映射校验 |
| "SDK 选型时评估数据收集范围" | §6.3 评分模型隐私维度（25 分） |
| 未成年人产品特殊要求 | L0 分级将"处理未成年人个人信息"自动纳入最高治理档 |
