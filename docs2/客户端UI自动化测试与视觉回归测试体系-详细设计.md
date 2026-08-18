# 客户端UI自动化测试与视觉回归测试体系 - 详细设计

## 1. 概述

### 1.1 模块定位

客户端 UI 自动化测试与视觉回归测试体系（Client UI Automation & Visual Regression Testing System，简称 **UIAT**）是 PrimeTop 客户端质量工程的基础设施。它解决三个问题：

1. **回归靠人肉**：核心用户路径（登录、AI 问答、拍题、错题本、同步课堂、订阅支付）目前依赖手工回归，发版前一轮全量回归约需 3 人日。
2. **UI 无守护**：分龄主题（幼儿/小学/初中/高中四套视觉语言）、深浅色、动态字号下，组件样式回归只能靠肉眼比对，设计系统改动的影响面无法评估。
3. **AI 场景不可测**：AI 对话是流式输出、内容不确定，传统断言无法编写稳定用例，导致占比最高的页面（AI 对话页）自动化覆盖率为 0。

《测试策略与质量保障体系》§2.3 与《单元测试与集成测试策略》§4.2 已给出 Flutter integration_test 的入门示例（直接 `find.textContaining` 断言、`pumpAndSettle` 等待），但没有解决工程化问题：控件定位治理、分层驱动、确定性 Mock、真机矩阵、Flaky 治理、视觉基线管理、CI 门禁。本文档补齐这些空白，**逻辑层（单元/Widget）测试不在本文档范围**。

### 1.2 设计目标

| 目标 | 度量 | 达成时间 |
|------|------|---------|
| P0 用户路径自动化覆盖 100% | E2E-001~E2E-008 全部自动化 | V1.0 上线前 |
| PR 冒烟回归 ≤ 25 分钟 | 4 分片并行 P0 用例 | 上线即达成 |
| 夜间全量回归 ≤ 90 分钟 | 全部用例 × 冒烟设备组 | 上线即达成 |
| 视觉回归基线覆盖核心页面 | 首页/AI 对话/拍题/错题本/我的 ≥ 20 个基线场景 | V1.0 上线前 |
| Flaky 率 < 3% | 近 14 天 `FLAKY / (PASS+FAIL+FLAKY)` | 运行 4 周后 |
| 视觉基线误报率 < 5% | 人工判定为误报的差异次数 / 总差异次数 | 运行 4 周后 |
| 自动化逃逸缺陷 ≤ 1 个/月 | 生产反馈且属于已覆盖路径的缺陷 | 稳定期 |

### 1.3 与已有模块的边界与关系

| 已有模块 | 边界与关系 |
|----------|-----------|
| 测试策略与质量保障体系 | 上位文档，定义测试金字塔与质量目标；本文档细化客户端 UI 层的工程化实现 |
| 单元测试与集成测试策略 | 覆盖逻辑层单测/Widget 单测；本文档从 Screen/Robot 分层开始接管，不重复 |
| 种子数据管理与自动化测试数据生成引擎 | 提供测试账号与业务数据构造；本文档的 Staging 模式消费其接口，Hermetic 模式不依赖 |
| MVP-P0功能验收标准与端到端测试场景 | 提供验收场景清单；本文档的用例注册表以它为需求来源 |
| 客户端组件库与设计系统 | 本文档的 Key 规范与其组件命名对齐；视觉回归是其样例页的守护 |
| 客户端主题引擎与动态外观系统 | 视觉基线矩阵的"主题"维度来自其主题 Token 定义 |
| 客户端字体资源注册与动态加载引擎 | 视觉回归的字体确定性约束（§7.5）依赖其字体版本机制 |
| SSE流式响应与AI增量渲染引擎 | 本文 §6.2 的 SSE 回放 Mock 按其数据帧协议构造 |
| CI-CD流水线与自动化构建发布系统 | 本文档的 Workflow 挂接其流水线阶段定义 |
| 客户端网络请求治理与弱网适配方案 | 本文 §6.5 弱网注入与其弱网分级参数保持一致 |
| 服务端-统一业务异常码与错误分类体系 | 本文 §11.2 申请新错误码段 56900-56999（测试支撑平台） |

---

## 2. 整体架构

### 2.1 架构总览

```text
┌──────────────────────────────────────────────────────────────────┐
│                          用例层（Flow）                            │
│   登录流 / AI问答流 / 拍题流 / 错题本流 / 订阅支付流 / 启蒙互动流     │
├──────────────────────────────────────────────────────────────────┤
│                     页面对象层（Screen + Robot）                    │
│   finder 封装 · 动作方法 · 断言方法 · 页面状态等待                   │
├──────────────────────────────────────────────────────────────────┤
│                        驱动适配层（Driver）                        │
│   integration_test 绑定 · Patrol Native 能力 · 设备信息上报         │
├──────────────────────────────────────────────────────────────────┤
│                        环境供给层（Environment）                    │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ Hermetic 模式 │  │ Staging 模式  │  │ 真机/云真机（WeTest 等） │  │
│  │ Dio拦截+SSE回放│  │ 种子数据+账号池│  │ 冒烟组/全量组分组执行     │  │
│  └──────────────┘  └──────────────┘  └────────────────────────┘  │
├──────────────────────────────────────────────────────────────────┤
│                     结果与工件层（Reporting）                       │
│   执行记录上报 · 截图/录屏/日志工件 · 差异热力图 · Flaky 判定        │
├──────────────────────────────────────────────────────────────────┤
│                    测试支撑平台（服务端，§11）                       │
│   用例注册表 · 执行流水 · Golden 基线库 · Flaky 台账 · 报告 API      │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 分层职责

| 层 | 职责 | 禁止事项 |
|----|------|---------|
| Flow | 组合多个 Robot 完成一条业务路径，一个 Flow 对应一个用例编号 | 禁止出现具体 finder |
| Robot | 封装某页面的动作与断言（如 `tapSend()`、`expectAnswerContains()`） | 禁止跨页面操作 |
| Screen | 持有该页面全部 finder 与页面状态判断（`isLoading`、`isReady`） | 禁止执行动作 |
| Driver | 绑定 `IntegrationTestWidgetsFlutterBinding` / `PatrolTester`，统一超时与重试参数 | 禁止业务断言 |
| Environment | 决定 Mock 策略、测试账号、数据重置、网络条件 | —— |
| Reporting | 逐用例结果 JSON 落盘并上报，收集工件 | —— |

### 2.3 技术选型

| 事项 | 选型 | 理由 | 备选与否决原因 |
|------|------|------|---------------|
| 驱动框架 | `integration_test`（官方） | 官方维护、可直接跑在 CI 与 Firebase Test Lab、单进程内嵌 | Appium：跨进程 UIAutomator 稳定性差、用例速度慢 5-10 倍 |
| 原生交互增强 | `patrol` 3.x（`patrolTest`） | 系统权限弹窗、通知栏、键盘等 Native 场景官方 integration_test 无能为力；Patrol 在同进程内提供 `$.native.*` 能力 | Maestro：YAML 编写快但断言能力弱、无法复用 Dart Mock 层、复杂流程（AI 流式）表达困难 |
| 视觉回归 | `matchesGoldenFile` + 自研 Failsafe 执行器（§7.2） | 零额外依赖；基线治理（审批/过期）需要自研平台支撑 | alchemist/golden_toolkit：变体机制好用但基线管理弱、维护趋缓；可作为参考不引入 |
| 报告格式 | 自研 JSON Schema（§4.2）→ 上报测试支撑平台 | 需要支撑 Flaky 判定与趋势统计，ALLURE 等通用格式表达不了 golden 基线字段 | —— |
| 云真机 | 腾讯优测 WeTest + 阿里云移动测试（国内）、Firebase Test Lab（海外发布链路） | 国内厂商 ROM 覆盖（华为/荣耀/小米/OPPO/vivo）只有国内农场齐全 | —— |
| CI | GitHub Actions matrix 分片 | 与现有流水线一致 | —— |

---

## 3. 工程结构与命名规范

### 3.1 目录结构

```text
primetop/
├── integration_test/                     # UI 自动化用例根目录（非 test/，避免误跑进单测）
│   ├── _bootstrap/                       # 启动装配（选环境、装载 Mock、登录态注入）
│   │   ├── env_config.dart               # 环境变量解析：UIAT_ENV=hermetic|staging
│   │   ├── app_bootstrapper.dart         # 包装 main()：按环境注入 Provider overrides
│   │   └── patrol_setup.dart             # Patrol binding 初始化
│   ├── screens/                          # Screen 层
│   │   ├── home_screen.dart
│   │   ├── ai_chat_screen.dart
│   │   ├── photo_search_screen.dart
│   │   └── ...
│   ├── robots/                           # Robot 层
│   │   ├── home_robot.dart
│   │   ├── ai_chat_robot.dart
│   │   └── ...
│   ├── flows/                            # Flow 层 = 用例
│   │   ├── auth_flow_test.dart           # E2E-001 注册/引导/首页
│   │   ├── ai_chat_flow_test.dart        # E2E-002 AI 问答
│   │   ├── photo_search_flow_test.dart   # E2E-003 拍题答疑
│   │   ├── sync_class_flow_test.dart     # E2E-004 同步课堂
│   │   ├── mistake_book_flow_test.dart   # E2E-005 错题本
│   │   ├── parent_flow_test.dart         # E2E-006 家长绑定管控
│   │   ├── purchase_flow_test.dart       # E2E-007 会员订阅
│   │   └── offline_flow_test.dart        # E2E-008 离线同步
│   ├── mocks/                            # 确定性环境
│   │   ├── hermetic_interceptor.dart     # Dio 拦截器（§6.2）
│   │   ├── sse_replay.dart               # SSE 回放器（§6.2）
│   │   ├── native_ability_mock.dart      # 相机/麦克风/推送平台通道 Mock（§6.3）
│   │   └── clock_override.dart           # 时钟注入（§6.4）
│   ├── fixtures/                         # 数据夹具
│   │   ├── api/                          # REST 响应 JSON（路径=URL 模板）
│   │   │   ├── api__v1__home__cards.json
│   │   │   └── api__v1__mistakes.json
│   │   └── sse/                          # SSE 回放脚本（§6.2.2）
│   │       ├── ai_chat__pythagoras.sse.json
│   │       └── ai_chat__network_error.sse.json
│   ├── golden/                           # 视觉回归（§7）
│   │   ├── golden_runner.dart            # Failsafe 执行器
│   │   ├── golden_device.dart            # 虚拟设备参数（分辨率/DPR/平台）
│   │   └── scenes/                       # 场景定义（代码即场景）
│   │       ├── home_golden_test.dart
│   │       ├── ai_chat_golden_test.dart
│   │       └── ...
│   ├── support/                          # 支撑工具
│   │   ├── case_meta.dart                # 用例元数据注解（§4.1）
│   │   ├── result_reporter.dart          # 结果落盘与上报
│   │   ├── waiters.dart                  # waitUntil / settleFor 等待工具（§12.2）
│   │   └── shard_planner.dart            # CI 分片器（§10.2）
│   └── run_all_test.dart                 # 全量入口（CI 调用）
└── test/                                 # 单测/Widget 测试（已有，不属于本文档）
```

依赖注入（`pubspec.yaml` dev_dependencies）：

```yaml
dev_dependencies:
  integration_test:
    sdk: flutter
  flutter_test:
    sdk: flutter
  patrol: ^3.11.0
```

### 3.2 用例命名与注册规范

用例是资产，必须先注册后运行：

1. **用例 ID**：`UIAT-{模块码}-{三位序号}`，模块码：`AUTH`/`CHAT`/`PHOTO`/`SYNC`/`MIST`/`PARENT`/`PAY`/`OFFLINE`/`UIEK`（启蒙）/`GOLD`（视觉）。
2. **一个 `testWidgets` = 一个用例**，标题格式：`'[UIAT-CHAT-001] P0 提问后收到流式回答并可追问'`。标题以方括号 ID 开头是硬性约束——`result_reporter` 依赖它解析归属。
3. **优先级**：P0（冒烟，PR 必跑）/ P1（nightly）/ P2（发布前专项）。
4. **元数据注解**：每个用例必须标注 `@CaseMeta`（见 §4.1），CI 从注解生成/校验注册表。

```dart
// flows/ai_chat_flow_test.dart
@CaseMeta(
  id: 'UIAT-CHAT-001',
  module: 'CHAT',
  priority: CasePriority.p0,
  entry: CaseEntry.deepLink('/ai-chat'),
  env: CaseEnv.hermetic,
  smoke: true,
  owner: 'client-team-a',
  tags: ['ai', 'streaming'],
)
patrolTest('[UIAT-CHAT-001] P0 提问后收到流式回答并可追问', config: uiatConfig, ($) async {
  final flow = AiChatFlow($);
  await flow.run();
});
```

### 3.3 控件定位治理（Key 规范）

**禁止默认使用文本/图标/索引定位**——分龄主题下文案、字号、图标全部会变化，文本定位是 Flaky 的第一大来源。强制 Key 优先级：

1. `ValueKey`（业务语义 Key，首选）
2. `Key`（系统对话框等兜底）
3. `find.byType`（仅限自定义组件根）
4. `find.text`（仅允许出现在"文案本身就是被测对象"的断言中，如分龄文案检查用例）
5. `find.byIndex/at`（禁止）

Key 命名规范：`{模块}__{页面}__{语义名}`，双下划线分段，全小写下划线词。例如 `ai__chat__input_field`、`mistake__list__filter_chip`、`home__workbench__task_card`。

工程内提供常量类避免散落字符串（与《客户端组件库与设计系统》的组件命名一一对应）：

```dart
// lib/testing/uiat_keys.dart（随主工程发布，体积可忽略）
class UiatKeys {
  // AI 对话页
  static const aiChatInputField    = Key('ai__chat__input_field');
  static const aiChatSendButton    = Key('ai__chat__send_button');
  static const aiChatAnswerBubble  = Key('ai__chat__answer_bubble');
  static const aiChatAnswerDone    = Key('ai__chat__answer_done');   // 流式完成标记
  static const aiChatRetryChip     = Key('ai__chat__retry_chip');
  // ...
}
```

CI 静态检查（`scripts/check_uiat_keys.dart`，挂 pre-commit）：扫描 `lib/` 与 `integration_test/`，报告"使用了未被 UiatKeys 引用的裸字符串 Key"与"UiatKeys 中无人引用的 Key"，防止双向腐烂。

---

## 4. 核心数据结构定义

### 4.1 用例元数据（客户端注解）

```dart
// integration_test/support/case_meta.dart
enum CasePriority { p0, p1, p2 }

enum CaseEntry { coldStart, deepLink, hotSwitch }  // 冷启动 / 深链直达 / 热切换

enum CaseEnv { hermetic, staging }

class CaseMeta {
  final String id;            // UIAT-CHAT-001
  final String module;        // CHAT
  final CasePriority priority;
  final CaseEntry entry;
  final String deepLinkPath;  // entry=deepLink 时必填
  final CaseEnv env;
  final bool smoke;           // 是否进入 PR 冒烟集
  final String owner;         // 责任团队
  final List<String> tags;
  const CaseMeta({
    required this.id, required this.module, required this.priority,
    required this.entry, required this.env, required this.smoke,
    required this.owner, this.deepLinkPath = '/', this.tags = const [],
  });
}
```

### 4.2 执行结果记录（客户端落盘 → 上报服务端）

单用例执行结果 JSON：

```json
{
  "caseId": "UIAT-CHAT-001",
  "runId": "gha-12345-shard2-1692345678",
  "shard": 2,
  "device": {
    "deviceGroupId": "smoke-android",
    "platform": "android",
    "osVersion": "13",
    "model": "Pixel 6 (emulator)",
    "screenPx": "1080x2400",
    "dpr": 2.75,
    "locale": "zh-CN"
  },
  "appVersion": "1.0.0+42",
  "env": "hermetic",
  "status": "FLAKY",
  "attempts": [
    { "attempt": 1, "status": "FAILED", "durationMs": 18230,
      "failureClass": "WIDGET_NOT_FOUND",
      "failureMessage": "Finder \"ai__chat__answer_done\" not found within 15s",
      "screenshotRef": "gs://uiat-artifacts/run-123/UIAT-CHAT-001-a1.png",
      "logExcerpt": "..." },
    { "attempt": 2, "status": "PASSED", "durationMs": 15102, "screenshotRef": null }
  ],
  "finalDurationMs": 15102,
  "startedAt": "2026-08-18T10:00:00Z"
}
```

`status` 枚举与状态机见 §9.2；`failureClass` 枚举见 §12.1。

### 4.3 Golden 基线元数据

```json
{
  "baselineId": "GB-000123",
  "sceneId": "GOLD-HOME-001",
  "sceneName": "首页工作台-高中-浅色",
  "deviceProfile": "pixel6_1080x2400@2.75",
  "platform": "android",
  "stage": "SENIOR",
  "theme": "LIGHT",
  "fontScale": 1.0,
  "fontBundleVersion": "primetop-fonts@1.4.0",
  "assetHash": "sha256:9f2c...",
  "imageRef": "gs://uiat-golden/GB-000123.png",
  "state": "APPROVED",
  "approvedBy": "ui-reviewer-a",
  "approvedAt": "2026-08-10T03:00:00Z",
  "staleSince": null
}
```

### 4.4 服务端支撑表 DDL（测试支撑平台）

MySQL 8、`utf8mb4`，独立库 `primetop_uiat`（与业务库物理隔离，避免测试平台故障影响生产监控口径）。

```sql
-- 用例注册表（CI 启动时与客户端 @CaseMeta 对账）
CREATE TABLE `test_case_registry` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `case_id`        VARCHAR(32)  NOT NULL COMMENT 'UIAT-CHAT-001',
  `title`          VARCHAR(255) NOT NULL,
  `module`         VARCHAR(16)  NOT NULL,
  `priority`       ENUM('P0','P1','P2') NOT NULL,
  `entry_type`     ENUM('COLD_START','DEEP_LINK','HOT_SWITCH') NOT NULL,
  `deep_link_path` VARCHAR(255) NOT NULL DEFAULT '/',
  `env`            ENUM('HERMETIC','STAGING') NOT NULL,
  `is_smoke`       TINYINT(1)   NOT NULL DEFAULT 0,
  `owner`          VARCHAR(64)  NOT NULL,
  `tags`           VARCHAR(255) NOT NULL DEFAULT '',
  `lifecycle`      ENUM('DRAFT','ACTIVE','QUARANTINED','RETIRED') NOT NULL DEFAULT 'DRAFT',
  `quarantine_reason` VARCHAR(500) DEFAULT NULL,
  `created_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_case_id` (`case_id`),
  KEY `idx_smoke_module` (`is_smoke`, `module`, `priority`),
  KEY `idx_lifecycle` (`lifecycle`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='UIAT 用例注册表';

-- 执行流水（一次 CI Job × 一台设备 = 一条）
CREATE TABLE `test_run` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_uid`        VARCHAR(64)  NOT NULL COMMENT 'gha-12345-shard2-1692345678',
  `trigger_type`   ENUM('PR','NIGHTLY','RELEASE','MANUAL') NOT NULL,
  `git_ref`        VARCHAR(128) NOT NULL,
  `commit_sha`     CHAR(40)     NOT NULL,
  `app_version`    VARCHAR(32)  NOT NULL,
  `env`            ENUM('HERMETIC','STAGING') NOT NULL,
  `device_group`   VARCHAR(32)  NOT NULL COMMENT 'smoke-android / full-android / smoke-ios ...',
  `shard_count`    INT NOT NULL DEFAULT 1,
  `shard_index`    INT NOT NULL DEFAULT 0,
  `status`         ENUM('RUNNING','SUCCESS','FAILED','ABORTED') NOT NULL DEFAULT 'RUNNING',
  `started_at`     DATETIME(3) NOT NULL,
  `finished_at`    DATETIME(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_run_uid` (`run_uid`),
  KEY `idx_started` (`started_at`),
  KEY `idx_ref` (`git_ref`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='UIAT 执行流水';

-- 单用例执行记录（含重试 attempts JSON）
CREATE TABLE `test_case_execution` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_uid`        VARCHAR(64) NOT NULL,
  `case_id`        VARCHAR(32) NOT NULL,
  `status`         ENUM('PASSED','FAILED','FLAKY','SKIPPED') NOT NULL,
  `attempts`       JSON NOT NULL COMMENT '[{attempt,status,durationMs,failureClass,...}]',
  `final_duration_ms` INT NOT NULL,
  `flaky_score_delta` DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT '本次对 flaky 分数的贡献',
  `created_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_run_case` (`run_uid`, `case_id`),
  KEY `idx_case_created` (`case_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='UIAT 用例执行记录';

-- Golden 基线库
CREATE TABLE `golden_baseline` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scene_id`       VARCHAR(32)  NOT NULL COMMENT 'GOLD-HOME-001',
  `platform`       ENUM('ANDROID','IOS') NOT NULL,
  `device_profile` VARCHAR(64)  NOT NULL,
  `stage`          ENUM('KINDERGARTEN','PRIMARY','JUNIOR','SENIOR') NOT NULL,
  `theme`          ENUM('LIGHT','DARK') NOT NULL,
  `font_scale`     DECIMAL(3,1) NOT NULL DEFAULT 1.0,
  `font_bundle_version` VARCHAR(32) NOT NULL,
  `asset_hash`     CHAR(71)     NOT NULL,
  `image_ref`      VARCHAR(255) NOT NULL,
  `state`          ENUM('DRAFT','APPROVED','STALE','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  `approved_by`    VARCHAR(64)  DEFAULT NULL,
  `approved_at`    DATETIME(3)  DEFAULT NULL,
  `stale_since`    DATETIME(3)  DEFAULT NULL,
  `created_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_scene_matrix` (`scene_id`, `platform`, `device_profile`, `stage`, `theme`, `font_scale`),
  KEY `idx_state` (`state`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视觉回归基线库';

-- Flaky 台账（QUARANTINE 决策与复盘）
CREATE TABLE `flaky_case` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `case_id`        VARCHAR(32) NOT NULL,
  `window_start`   DATE NOT NULL,
  `flaky_count_14d` INT NOT NULL DEFAULT 0,
  `fail_count_14d` INT NOT NULL DEFAULT 0,
  `pass_count_14d` INT NOT NULL DEFAULT 0,
  `flaky_rate`     DECIMAL(5,4) NOT NULL DEFAULT 0,
  `top_failure_class` VARCHAR(48) DEFAULT NULL,
  `action`         ENUM('WATCHING','AUTO_RETRY','QUARANTINE','FIXING') NOT NULL DEFAULT 'WATCHING',
  `ticket_url`     VARCHAR(255) DEFAULT NULL,
  `updated_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_case_window` (`case_id`, `window_start`),
  KEY `idx_action` (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Flaky 治理台账';

-- 隔离区操作审计
CREATE TABLE `quarantine_audit` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `case_id`    VARCHAR(32) NOT NULL,
  `action`     ENUM('QUARANTINE','RESTORE','RETIRE') NOT NULL,
  `operator`   VARCHAR(64) NOT NULL,
  `reason`     VARCHAR(500) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_case` (`case_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='隔离区操作审计';
```

---

## 5. 分层驱动模型（Screen / Robot / Flow）

### 5.1 三层模型

以"AI 对话页"为例说明三层如何协作。核心原则：**Flow 只讲业务语言，Screen 只讲控件语言，Robot 是翻译层**。

### 5.2 Screen 层

```dart
// integration_test/screens/ai_chat_screen.dart
import 'package:flutter/widgets.dart';
import 'package:primetop/testing/uiat_keys.dart';

class AiChatScreen {
  const AiChatScreen();

  Finder get inputField   => find.byKey(UiatKeys.aiChatInputField);
  Finder get sendButton   => find.byKey(UiatKeys.aiChatSendButton);
  Finder get answerBubble => find.byKey(UiatKeys.aiChatAnswerBubble);
  Finder get answerDone   => find.byKey(UiatKeys.aiChatAnswerDone); // 流式结束打点控件
  Finder get followUpChip => find.byKey(UiatKeys.aiChatRetryChip);
  Finder get loadingDots  => find.byKey(UiatKeys.aiChatLoadingDots);

  /// 页面就绪判定：输入框可见且可聚焦（路由动画已结束）
  Finder get readyMark => inputField;

  /// 页面级状态谓词，供 Robot 组合
  bool isLoadingVisible(WidgetTester t) => anyVisible(t, loadingDots);
}

bool anyVisible(WidgetTester t, Finder f) =>
    t.any(f.hitTestable(at: Alignment.center));
```

> 设计要点：`readyMark` 供通用等待器（§12.2）使用；所有 finder 必须 hit-testable，避免"控件在树上但被遮挡"导致的假通过。

### 5.3 Robot 层

```dart
// integration_test/robots/ai_chat_robot.dart
import 'package:patrol/patrol.dart';
import '../screens/ai_chat_screen.dart';
import '../support/waiters.dart';

class AiChatRobot {
  AiChatRobot(this.$) : screen = const AiChatScreen();
  final PatrolTester $;
  final AiChatScreen screen;

  /// 从任意页面进入 AI 对话页（深链直达）
  Future<void> open() async {
    await $.tester.pumpWidget(await $.broker.app()); // Patrol 提供的真实 App 宿主
    // 深链由 app_bootstrapper 注入初始路由，Robot 只负责确认就绪
    await waitVisible($.tester, screen.readyMark);
  }

  Future<void> askQuestion(String question) async {
    await $.enterText(screen.inputField, question);
    await $.tap(screen.sendButton);
  }

  /// 等待流式回答完成：以"完成标记"控件为准，绝不 pumpAndSettle（§12.2）
  Future<void> waitForAnswerDone({Duration timeout = const Duration(seconds: 20)}) async {
    await waitVisible($.tester, screen.answerDone, timeout: timeout);
  }

  Future<void> expectAnswerContains(String expectToken) async {
    final bubbleText = $.tester.widget<Text>(
      find.descendant(of: screen.answerBubble, matching: find.byType(Text)).first,
    );
    // 断言语义 token 而非整句文案（AI 内容来自回放夹具，token 稳定）
    if (!bubbleText.data!.contains(expectToken)) {
      fail('回答未包含期望 token "$expectToken"，实际：${bubbleText.data}');
    }
  }

  Future<void> tapFollowUp() async {
    await $.tap(screen.followUpChip);
    await waitVisible($.tester, screen.readyMark);
  }
}
```

### 5.4 Flow 层（用例正文）

```dart
// integration_test/flows/ai_chat_flow_test.dart
import 'package:patrol/patrol.dart';
import '../robots/ai_chat_robot.dart';
import '../support/case_meta.dart';
import '../_bootstrap/app_bootstrapper.dart';

class AiChatFlow {
  AiChatFlow(this.$);
  final PatrolTester $;

  Future<void> run() async {
    final chat = AiChatRobot($);

    await chat.open();
    await chat.askQuestion('什么是勾股定理？');
    await chat.waitForAnswerDone();
    await chat.expectAnswerContains('直角三角形');

    await chat.tapFollowUp();
    await chat.askQuestion('能举个例子吗？');
    await chat.waitForAnswerDone();
    await chat.expectAnswerContains('例子');
  }
}

@CaseMeta(id: 'UIAT-CHAT-001', /* ...同 §3.2 */)
patrolTest('[UIAT-CHAT-001] P0 提问后收到流式回答并可追问',
    config: uiatConfig, ($) async {
  await AiChatFlow($).run();
});
```

### 5.5 与既有 E2E 编号的映射

用例注册表以《MVP-P0功能验收标准与端到端测试场景》的 E2E-001~E2E-008 为需求源，映射关系：

| E2E 编号 | UIAT 用例前缀 | 拆分数 | 优先级 |
|----------|--------------|--------|--------|
| E2E-001 注册引导 | UIAT-AUTH | 5 | P0 |
| E2E-002 AI 问答 | UIAT-CHAT | 8 | P0 |
| E2E-003 拍题答疑 | UIAT-PHOTO | 6 | P0 |
| E2E-004 同步课堂 | UIAT-SYNC | 4 | P0 |
| E2E-005 错题本 | UIAT-MIST | 5 | P1（其中查看路径 2 条为 P0） |
| E2E-006 家长管控 | UIAT-PARENT | 6 | P1 |
| E2E-007 订阅支付 | UIAT-PAY | 5 | P1 |
| E2E-008 离线同步 | UIAT-OFFLINE | 4 | P2 |

---

## 6. 确定性环境与 Mock 体系

### 6.1 双模式环境

| 模式 | 数据来源 | 网络 | 适用 | 特点 |
|------|---------|------|------|------|
| Hermetic | 本地 fixtures 文件 | Dio 拦截器全拦截，零外联 | PR 冒烟、视觉回归、P0 大部分用例 | 快、稳、可重放错误场景 |
| Staging | 测试支撑平台 + 种子数据服务 | 真实网络打到 staging 集群 | 支付回调全链路、推送触达、多端同步类用例 | 真、慢、需账号池 |

环境由 `UIAT_ENV` 环境变量决定，`app_bootstrapper` 装配：

```dart
// integration_test/_bootstrap/app_bootstrapper.dart
Future<Widget> buildTestableApp() async {
  final env = EnvConfig.fromPlatform();          // UIAT_ENV / UIAT_STAGE 等
  final overrides = <Override>[
    // 1. 时钟注入（§6.4）
    systemClockProvider.overrideWithValue(FixedClock(env.frozenNow)),
    // 2. Hermetic：网络层换拦截器
    if (env.isHermetic)
      dioClientProvider.overrideWith((ref) {
        final dio = Dio(BaseOptions(baseUrl: env.apiBaseUrl));
        dio.interceptors.add(HermeticInterceptor(fixturesRoot: 'integration_test/fixtures'));
        return DioClient(dio);
      }),
    // 3. Staging：测试账号登录态预置（§6.6）
    if (env.isStaging) authSessionProvider.overrideWithValue(env.stagedSession),
    // 4. 平台能力 Mock（§6.3）
    ...nativeAbilityOverrides(env),
  ];
  return ProviderScope(
    overrides: overrides,
    child: const PrimeTopApp(),
  );
}
```

### 6.2 SSE 流式回放 Mock（AI 场景可测性的核心）

AI 对话走 SSE 流式接口（《SSE流式响应与AI增量渲染引擎》定义了帧协议）。Hermetic 模式通过 Dio 拦截器把 `POST /api/v1/ai/chat/stream` 的响应流替换为本地回放脚本，实现**确定性 token 序列 + 可编排故障**。

#### 6.2.1 拦截器

```dart
// integration_test/mocks/hermetic_interceptor.dart
class HermeticInterceptor extends Interceptor {
  HermeticInterceptor({required this.fixturesRoot});
  final String fixturesRoot;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    // SSE 请求 → 回放流
    if (options.uri.path.contains('/ai/chat/stream')) {
      final scriptName = options.headers['x-uiat-script'] as String? ?? 'ai_chat__default';
      handler.resolve(_replaySse(options, scriptName));
      return;
    }
    // 普通请求 → fixtures/api/{path.json}（双下划线编码斜杠与查询）
    final file = _resolveFixture(options);
    if (file != null) {
      handler.resolve(Response(
        requestOptions: options,
        statusCode: file.statusCode,
        data: file.statusCode == 200 ? file.bodyBytes : null,
      ));
      return;
    }
    handler.reject(DioException(
      requestOptions: options,
      type: DioExceptionType.unknown,
      error: 'UIAT fixture missing: ${options.uri}',
    )); // fixture 缺失直接 FAIL，禁止静默穿透外网
  }

  Response _replaySse(RequestOptions options, String scriptName) {
    final script = SseReplayScript.load('$fixturesRoot/sse/$scriptName.sse.json');
    final stream = script.toByteStream();          // 按帧 delayMs 逐块产出
    return Response(
      requestOptions: options..responseType = ResponseType.stream,
      statusCode: 200,
      data: Stream<Uint8List>.fromIterable(stream),
    );
  }
}
```

#### 6.2.2 回放脚本格式

```json
// integration_test/fixtures/sse/ai_chat__pythagoras.sse.json
{
  "meta": { "scene": "勾股定理讲解", "totalTokens": 126 },
  "firstTokenDelayMs": 800,
  "frames": [
    { "type": "meta",     "event": "message", "data": "{\"convId\":\"c-1\",\"msgId\":\"m-1\"}" },
    { "type": "delta",    "event": "message", "data": "勾股定理（", "delayMs": 40 },
    { "type": "delta",    "event": "message", "data": "Pythagorean theorem）", "delayMs": 40 },
    { "type": "formula",  "event": "message", "data": "a^2 + b^2 = c^2", "delayMs": 60 },
    { "type": "delta",    "event": "message", "data": "描述了直角三角形三边关系……", "delayMs": 40 },
    { "type": "done",     "event": "message", "data": "{\"usage\":{\"promptTokens\":312,\"completionTokens\":126}}" },
    { "type": "ui_done",  "event": "message", "data": "" }
  ]
}
```

故障编排脚本（错误场景是 P0 用例的一部分）：

```json
// integration_test/fixtures/sse/ai_chat__network_error.sse.json
{
  "meta": { "scene": "流中断-重试" },
  "firstTokenDelayMs": 500,
  "frames": [
    { "type": "meta",  "event": "message", "data": "{\"convId\":\"c-1\",\"msgId\":\"m-9\"}" },
    { "type": "delta", "event": "message", "data": "我们来看", "delayMs": 40 },
    { "type": "abort", "abortAfterFrames": 2, "abortKind": "CONNECTION_RESET" }
  ]
}
```

脚本选择：Robot 在提问前通过请求头 `x-uiat-script` 指定（`askQuestion(q, script: 'ai_chat__pythagoras')`），拦截器读取。**该请求头仅在 debug/test 构建生效**（`--dart-define=UIAT_BUILD=true`），生产构建编译期排除。

### 6.3 平台能力 Mock（相机/麦克风/推送/剪贴板）

拍题、语音、推送三类 P0 依赖原生能力，模拟器/农场不稳定。通过 `TestDefaultBinaryMessengerBinding` 拦截平台通道：

```dart
// integration_test/mocks/native_ability_mock.dart
const _cameraChannel = MethodChannel('primetop/camera');
const _pushChannel   = MethodChannel('primetop/push');

List<Override> nativeAbilityOverrides(EnvConfig env) => [
  // 相机：拍题页"拍照"直接返回预置题目图片字节，跳过真实相机
  // （走 asset: test_assets/question_photos/pythagoras_printed.png）
  testCameraProvider.overrideWith((_) => MockCameraCapture(
    nextPhotoAsset: 'test_assets/question_photos/pythagoras_printed.png',
  )),
  // 推送：收到推送 → 只验证本地通知展示，不接厂商通道
  pushGatewayProvider.overrideWith((_) => const NoopPushGateway()),
];

/// MethodChannel 级兜底（覆盖未走 Provider 的原生调用）
void installChannelMocks(TestWidgetsFlutterBinding binding) {
  binding.defaultBinaryMessenger.setMockMethodCallHandler(_cameraChannel, (call) async {
    if (call.method == 'takePhoto') {
      return {'bytes': await rootBundle.loadAssetBytes(kUiatNextPhotoAsset),
              'width': 1080, 'height': 1920};
    }
    return null;
  });
  binding.defaultBinaryMessenger.setMockMethodCallHandler(_pushChannel, (_) async => true);
}
```

> 权限弹窗：Hermetic 模式下 Mock 已绕过相机调用，通常不触发弹窗；Staging 真机模式用 Patrol 原生能力处理：`await $.native.grantPermissionWhenInUse();`（仅在 `entry=COLD_START` 的拍题用例使用）。

### 6.4 时钟注入

打卡、番茄钟、验证码倒计时、复习提醒都依赖时间。产品代码统一走 `systemClockProvider`（`package:clock` 封装，这在《客户端状态管理架构》的 Provider 清单中注册），测试注入 `FixedClock` / `TickClock`：

```dart
class TickClock extends Fake {
  TickClock(this.start);
  DateTime start;
  DateTime now() => start;
  void advance(Duration d) => start = start.add(d);
}
```

用例内推进时间：`env.clock.advance(const Duration(minutes: 25)); await $.tester.pump();`——不依赖 `tester.pump(duration)` 的动画语义，语义清晰且不受帧率影响。

### 6.5 弱网与故障注入

Hermetic 模式在拦截器内实现，参数与《客户端网络请求治理与弱网适配方案》的弱网分级一致：

```dart
class NetworkProfile {
  final Duration? extraLatency;
  final double lossRate;      // 0.0~1.0，按 chunk 掷骰丢弃
  final Duration? stallAt;    // 在第 N 帧后挂起
  const NetworkProfile.normal()
      : extraLatency = null, lossRate = 0, stallAt = null;
  const NetworkProfile.weak2G()
      : extraLatency = const Duration(milliseconds: 1200), lossRate = 0.05, stallAt = null;
  const NetworkProfile.stallAfter10()
      : extraLatency = null, lossRate = 0, stallAt = const Duration(seconds: 30);
}
// 用例：UIAT-CHAT-005 弱网下提问 → 骨架屏 → 恢复
```

### 6.6 Staging 模式：测试账号池与数据重置

| 项 | 约定 |
|----|------|
| 账号池 | `uiat_p0_000~049`（P0 冒烟，每次执行前重置）、`uiat_pay_000~009`（支付专用）、`uiat_parent_00x`+`uiat_stu_00x`（绑定对），共约 70 个 |
| 获取 | `POST /test-support/v1/accounts/acquire`（租约制，15 分钟自动释放，防并行分片撞号） |
| 重置 | 用例开始前 `POST /test-support/v1/env/reset`，按 `presetKey` 重置到《种子数据管理》定义的命名场景（如 `mistake_book_20_items`） |
| 验证码 | staging 环境短信验证码固定 `888888`（与《项目技术选型与工程化体系》本地环境红线一致） |
| 支付 | 只用沙箱渠道（微信沙箱/支付宝沙箱/IAP Sandbox），回调走 staging 回调中心 |

---

## 7. 视觉回归测试（Golden）设计

### 7.1 基线矩阵

视觉回归的价值在"矩阵"而非"单图"。基线维度：

| 维度 | 取值 | 来源 |
|------|------|------|
| 学段 stage | KINDERGARTEN / PRIMARY / JUNIOR / SENIOR | 《分龄UI适配与交互设计规范》四套视觉语言 |
| 主题 theme | LIGHT / DARK | 《客户端主题引擎与动态外观系统》Token |
| 字号 fontScale | 1.0 / 1.3 | 无障碍大字号档 |
| 平台 platform | ANDROID / IOS | 像素差异按平台分基线 |
| 设备 profile | pixel6_1080x2400@2.75 / iphone15_1179x2556@3.0 | 固定两个虚拟档，禁用随机物理设备 |

**全笛卡尔积不可取**（4×2×2×2=32 组/场景 × 20 场景 = 640 基线，维护不动）。策略：

- **核心场景**（首页、AI 对话、拍题解析、错题本、我的、登录页）：`stage` 取 PRIMARY+SENIOR 两档（分龄差异最大端点），theme 两档，fontScale 1.0 → 8 基线/场景。
- **次级场景**（同步课堂目录、订阅页、家长报告、启蒙识字卡）：仅 PRIMARY×LIGHT×1.0 单基线。
- `fontScale 1.3` 仅覆盖首页与 AI 对话两场景（大字号最易破版处）。
- iOS 基线仅覆盖核心场景的 LIGHT 档（差异主要来自字体渲染，控制数量）。

首批规模：核心 6 场景 × 8 + 次级 4 × 1 + 大字号 2×2×2 + iOS 6×1 = **78 张**，逐步增长，上限 200 张（超出必须退役旧场景）。

### 7.2 Failsafe Golden 执行器

目标：基线缺失时**失败而非跳过**（防"基线悄悄丢了"）；基线存在但运行环境不符（字体版本变了）时**报 STALE 而非误报差异**。

```dart
// integration_test/golden/golden_runner.dart
class GoldenScene {
  final String sceneId;          // GOLD-HOME-001
  final String stage;            // PRIMARY
  final String theme;            // LIGHT
  final double fontScale;
  final WidgetBuilder builder;   // 已装配主题/学段/数据的页面
  const GoldenScene(this.sceneId, this.stage, this.theme, this.fontScale, this.builder);
}

Future<void> runGoldenScene(WidgetTester tester, GoldenScene scene) async {
  await pumpGoldenScene(tester, scene);   // 固定分辨率+DPR+字体加载（§7.5）+禁用动画
  final file = _baselinePath(scene);      // goldens/__snapshots__/{platform}/GOLD-HOME-001__primary__light__1.0.png
  final exists = File(file).existsSync();

  if (!exists) {
    // 允许本地 --update-goldens 生成；CI 中直接失败并提示走基线 PR 流程
    if (const bool.fromEnvironment('UPDATE_GOLDENS')) {
      await expectLater(find.byWidgetPredicate((w) => true),
          matchesGoldenFile(file));  // 首次会写出
      return;
    }
    fail('基线缺失: $file。请执行 `flutter test integration_test/golden '
         '--update-goldens --dart-define=UPDATE_GOLDENS=true` 并提交基线 PR（§7.4）');
  }

  await expectLater(
    find.byWidgetPredicate((w) => true),
    matchesGoldenFile(file),
  );
}

/// 设备参数固定：视觉测试不跑真机，全部在固定 DPR 的虚拟surface上
Future<void> pumpGoldenScene(WidgetTester tester, GoldenScene scene) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 2.75;
  tester.platformDispatcher.textScaleFactorTestValue = scene.fontScale;
  await loadGoldenFonts();                 // §7.5 固定字体包
  await tester.pumpWidget(
    MediaQuery.fromView(
      view: tester.view,
      child: ThemeEngine(appStage: stageOf(scene.stage), brightness: brightnessOf(scene.theme),
        child: scene.builder(context)),
    ),
  );
  await disableAnimations(tester);         // 关闭 Hero/Lottie/shimmer，帧内静态
  await tester.pumpAndSettle(const Duration(milliseconds: 300));
  tester.platformDispatcher.clearTextScaleFactorTestValue();
  tester.view.resetPhysicalSize();
  tester.view.resetDevicePixelRatio();
}
```

### 7.3 差异判定与阈值

1. 一级判定：`matchesGoldenFile` 的字节级比较，任何像素差异即 FAIL。
2. 二级判定（FAIL 后自动执行）：自研像素差异器输出**差异率**（差异像素/总像素）与**热力图 PNG** 工件：
   - 差异率 < 0.05% 且差异区域集中在边缘 2px（抗锯齿抖动）→ 判定 `FLAKY_PIXEL`，自动重跑一次，仍 <0.05% 记 PASSED 并登记 `pixel_noise`（累计 3 次更换基线渲染设置）。
   - 其余 → FAILED，热力图与双图上传工件库，PR comment 展示并排对比。
3. 差异率 ≥ 0.05% 时**禁止 CI 自动更新基线**，必须人工（§7.4）。

### 7.4 基线更新流程（PR 评审）

```text
开发者改 UI
  → flutter test integration_test/golden --update-goldens（本地生成新基线）
  → git add goldens/ && 提交 PR，标题前缀 [golden]
  → CI 上传 新旧基线 + 差异热力图 到支撑平台
  → Bot 评论生成对比九宫格（场景 × 变体）
  → 评审人（UI 设计系统负责人 + 场景 owner）逐张打 ✅
  → 全部 ✅ + approve → 合并即基线生效（DRAFT→APPROVED，§9.3）
  → 任一 ❌ → 开发者修 UI 或调整场景定义，不允许"更新基线了事"
```

评审清单（PR 模板自动渲染）：① 差异是否预期内的设计变更（有设计稿链接）；② 分龄四档是否都看过；③ 深色档是否检查；④ 字号 1.3 是否溢出；⑤ 是否应新增/退役场景而非改图。

### 7.5 字体与图标确定性

- Golden 环境强制加载**版本锁定的字体包**（`primetop-fonts@x.y.z`，来自《客户端字体资源注册与动态加载引擎》的字体仓库），禁止落到系统字体（不同 CI 机器渲染不同）。
- `loadGoldenFonts()` 用 `FontLoader` 注册字体包内全部字体族；基线元数据记录 `fontBundleVersion`，与当前依赖版本不一致 → 直接判 `STALE`（提示更新基线 PR），不做像素比较。
- 图标：统一 IconFont，随字体包锁定；禁用平台差异 emoji（文本 fixture 中不出现 emoji）。
- 时钟类控件（首页问候语"早上好"）：场景装配时固定 `stage` 的数据 fixture，问候语随注入时钟固定。

---

## 8. 真机与设备农场执行

### 8.1 设备矩阵与分组

| 组 | 设备 | 用途 | 执行时机 |
|----|------|------|---------|
| smoke-android | Pixel 6 模拟器（API 33）+ Redmi Note 12 真机（API 31，本地 Mac mini runner） | P0 冒烟 | 每个 PR |
| smoke-ios | iPhone 15 模拟器（iOS 17.5） | P0 冒烟（iOS-only 行为） | 每个 PR |
| full-android | 华为 Mate 60 / 荣耀 X50 / 小米 14 / OPPO Reno11 / vivo Y100（WeTest 云真机） | 全量 + ROM 兼容 | nightly |
| full-ios | iPhone SE2(iOS 15) / iPhone 14(iOS 17)（本地 + Firebase Test Lab） | 全量 | nightly |
| low-end | Android API 24 低内存档（2GB RAM 模拟器） | 性能红线用例（启动/帧率） | nightly |

分组注册在支撑平台 `device_group` 配置中，CI 引用组名，不硬编码机型。

### 8.2 云真机执行

- Android：CI 产出 `app-debug.apk` + `app-debug-androidTest.apk`（integration_test 标准产物），`gcloud firebase test android run --type instrumentation`（海外）或 WeTest CLI（国内，`wetest apirun --apk ... --test-apk ... --device-model full-android`）。
- iOS：`xcodebuild test -scheme Runner -destination 'platform=iOS Simulator'` 本地 runner；云侧仅 nightly 用 Firebase Test Lab XCTest 通道。
- 云真机执行成本高（按分钟计费）：**只跑 P0+P1、每用例超时 3 分钟、失败即停该设备后续 P2 用例**（P2 留本地）。

### 8.3 执行产物管理

| 工件 | 采集时机 | 存储路径（对象存储桶 `uiat-artifacts`） | 保留期 |
|------|---------|--------------------------------------|--------|
| 失败截图 | 每次 FAILED attempt 结束 | `run/{runUid}/{caseId}-a{n}.png` | 90 天 |
| 录屏 | 真机组全程、模拟器组仅失败时 | `run/{runUid}/{caseId}.mp4` | 30 天 |
| logcat/系统日志 | 真机组全程 | `run/{runUid}/logs/` | 30 天 |
| Golden 三图 | 视觉差异时（基线/实际/热力图） | `golden-diff/{sceneId}/{runUid}/` | 180 天 |
| Timeline JSON | 帧率红线用例 | `run/{runUid}/timeline/` | 30 天 |

PR comment 由 Bot 汇总：失败用例数、逐条失败原因分类、工件直链（预签名 URL，48h 有效）。

---

## 9. 状态机设计

### 9.1 用例生命周期状态机

```text
DRAFT ──注册校验通过──▶ ACTIVE ◀──修复+复跑10次全绿── QUARANTINED
                         │  ▲                            │
              连续5次FLAKY│  │恢复(RESTORE,需审计)          │彻底废弃/被替代
                         ▼  │                            ▼
                    QUARANTINED ───────────────────▶ RETIRED
```

| 守卫 | 规则 |
|------|------|
| G1 DRAFT→ACTIVE | CI 对账通过：`@CaseMeta` 与注册表一致、fixture/脚本存在、该 caseId 无历史 ACTIVE 记录 |
| G2 ACTIVE→QUARANTINED | 近 14 天 FLAKY ≥ 5 次且 flaky_rate ≥ 10%（`flaky_case` 表自动判定），或人工标记；必须填写 quarantine_reason；自动建 JIRA 工单 |
| G3 QUARANTINED→ACTIVE（RESTORE） | 修复后连跑 10 次全绿（`MANUAL` 触发专项 run）+ owner 审批；写 `quarantine_audit` |
| G4 →RETIRED | 路径下线/需求移除；用例代码同 PR 删除；注册表保留历史供追溯 |
| G5 QUARANTINED 不计分母 | 冒烟集计算覆盖率时排除 QUARANTINED/RETIRED 用例，防止"隔离区里躺着一堆 P0"粉饰覆盖率 |

### 9.2 单次执行状态机（一个用例在一次 run 内）

```text
PENDING ──调度──▶ RUNNING ──断言通过──▶ PASSED
                    │
                    ├─断言失败/超时──▶ FAILED ──重试策略命中(§10.3)──▶ RETRYING ──▶ RUNNING
                    │                                                        │
                    │                              第2次通过──判定FLAKY ◀──────┤（attempts≥2）
                    │                              第2次仍失败──▶ FAILED(终态) ◀┘
                    └─环境故障(设备失联/OOM/构建错)──▶ SKIPPED(不计入通过率，单独告警)
```

| 守卫 | 规则 |
|------|------|
| E1 | 重试仅对 `failureClass ∈ {WIDGET_NOT_FOUND, TIMEOUT, PIXEL_NOISE}` 生效；断言语义错误（ASSERT_MISMATCH）不重试，快速失败 |
| E2 | 单用例最多重试 1 次（共 2 次尝试）；P2 不重试 |
| E3 | SKIPPED 占比 > 5% 的 run 视为环境事故，流水线标黄并告警测试平台值班 |
| E4 | FAILED(终态) 的 P0 用例 → 阻断 PR（§10.5） |

### 9.3 Golden 基线状态机

```text
DRAFT ──基线PR评审通过──▶ APPROVED ──字体包/设计Token版本变更──▶ STALE
  │                                                        │
  └──PR关闭/超时7天未评审──▶ ARCHIVED ◀──新基线APPROVED后自动──┘
```

| 守卫 | 规则 |
|------|------|
| B1 | 同一场景矩阵键同时只允许一个 APPROVED（唯一键 `uk_scene_matrix` + 状态过滤） |
| B2 | STALE 基线对应场景的比较跳过但计为 `SKIPPED_GOLDEN`，>3 个场景 STALE 触发告警（防止视觉回归长期空转） |
| B3 | APPROVED→STALE 仅由"依赖版本变更事件"驱动（字体包升级、主题 Token 语义版本、Flutter 大版本），自动触发基线 PR 机器人生成对比供人工确认 |

### 9.4 Flaky 治理流程

```text
run 产生 FLAKY 记录
  → 夜间 Job 聚合 14 天窗口 → 更新 flaky_case 台账
  → flaky_rate ≥ 5% 且 FLAKY ≥ 3 次 → action=AUTO_RETRY（允许重试，不阻断）
  → flaky_rate ≥ 10% 且 FLAKY ≥ 5 次 → action=QUARANTINE（自动隔离 + 工单 + 周报点名）
  → 工单 owner 一周内提修复 PR → 连跑 10 次全绿 → RESTORE
```

根因分类（`top_failure_class`）沉淀到周报，指导系统性治理：

| 根因类别 | 典型治理 |
|---------|---------|
| WAIT_LOGIC（等待策略错误） | 补 waiters、替换 pumpAndSettle |
| NONDET_DATA（数据不确定） | 补 fixture、改 Hermetic |
| ANIMATION（动画永不 settle） | disableAnimations / 等待完成标记 |
| DEVICE_FRAG（ROM 差异） | 移到特定 device_group、加平台分支断言 |
| ENV_RACE（staging 数据竞争） | 账号租约化、数据重置加锁 |
| BUG_REAL（真缺陷） | 转产品缺陷工单，用例保持 FAIL 守护 |

---

## 10. CI/CD 集成与门禁

### 10.1 流水线编排

| 流水线 | 触发 | 内容 | 预算 |
|--------|------|------|------|
| `uiat-smoke` | PR 同步/推送 | smoke-android + smoke-ios，P0 用例（Hermetic 为主），4 分片 | ≤ 25 min |
| `uiat-golden` | PR 改动 `lib/` 或 `goldens/` 时 | 全部 Golden 场景 | ≤ 10 min |
| `uiat-nightly` | cron 每日 02:00（主分支） | 全量用例 × full 组（含云真机）+ Flaky 聚合 Job | ≤ 90 min |
| `uiat-release` | 发版分支 | 全量 + 低端机组性能红线 + 支付沙箱全链路（Staging） | ≤ 150 min |

### 10.2 并行分片策略

自研分片器 `shard_planner.dart`（不使用 `--total-shards` 随机分片，避免慢用例堆积）：

1. 读取注册表中本流水线目标用例集（冒烟=P0+smoke，全量=P0+P1+P2）。
2. 按最近 14 天 `final_duration_ms` 中位数排序，**贪心装入** N 个分片（N=4）。
3. 无历史数据的新用例默认记 60s。
4. 输出 `shard-{i}-cases.txt`（用例文件列表），各分片 Job 只执行清单内文件。

### 10.3 重试与 Flaky 判定（执行器内实现）

`run_all_test.dart` 包装每个 `testWidgets`：

- 捕获失败 → 分类 failureClass（§12.1 规则）→ 符合 E1 则重跑一次。
- 两次结果合并写结果 JSON（§4.2）→ `result_reporter` 上报支撑平台。
- **进程级熔断**：连续 5 个用例因 `ENV_BROKEN` 失败 → 终止分片，run 标 ABORTED，避免环境故障烧掉 90 分钟预算。

### 10.4 GitHub Actions Workflow（PR 冒烟）

```yaml
# .github/workflows/uiat-smoke.yml
name: uiat-smoke
on:
  pull_request:
    paths: ['lib/**', 'integration_test/**', 'pubspec.lock']

jobs:
  plan:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.plan.outputs.matrix }}
      cases_changed: ${{ steps.plan.outputs.smoke_count }}
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
        with: { flutter-version: '3.24.x', cache: true }
      - name: 分片规划（拉取注册表+近期耗时）
        id: plan
        run: |
          curl -s -H "Authorization: Bearer $UIAT_TOKEN" \
            "$UIAT_API/test-support/v1/shards/plan?pipeline=smoke&shards=4" -o plan.json
          echo "matrix=$(jq -c '.shards' plan.json)" >> "$GITHUB_OUTPUT"

  shard:
    needs: plan
    strategy:
      fail-fast: false
      matrix:
        shard: ${{ fromJson(needs.plan.outputs.matrix) }}
    runs-on: [self-hosted, flutter-emulator]   # 预装模拟器的常驻 runner
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
        with: { flutter-version: '3.24.x', cache: true }
      - run: flutter pub get
      - run: flutter test integration_test/run_all_test.dart
          --dart-define=UIAT_BUILD=true --dart-define=UIAT_ENV=hermetic
          --dart-define=UIAT_RUN_UID=${{ github.run_id }}-shard${{ matrix.shard.index }}
          --dart-define=UIAT_SHARD_FILE=shard-${{ matrix.shard.index }}.txt
          --reporter json | tee test-output.jsonl
      - name: 上报与工件
        if: always()
        run: dart run integration_test/support/report_upload.dart
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: uiat-shard-${{ matrix.shard.index }}, path: artifacts/ }

  gate:
    needs: shard
    runs-on: ubuntu-latest
    steps:
      - name: 门禁裁决
        run: |
          RESULT=$(curl -s -H "Authorization: Bearer $UIAT_TOKEN" \
            "$UIAT_API/test-support/v1/runs/gha-${{ github.run_id }}/gate?policy=smoke")
          echo "通过率: $RESULT"
          test "$(jq -r '.gatePassed' <<<"$RESULT")" = "true"
```

支撑平台 `gate` 接口按策略裁决（P0 全 PASS 或 FLAKY 才放行；QUARANTINED 用例按 G5 排除），避免在 YAML 里写复杂条件。

### 10.5 门禁规则表

| 流水线 | 阻断条件 | 提醒（不阻断） |
|--------|---------|---------------|
| uiat-smoke | 任一 P0 FAILED(终态)；用例对账失败（注册表≠代码）；分片 ABORTED | FLAKY 计数；新增用例未标注 owner |
| uiat-golden | 任一场景差异 ≥ 0.05% 未评审 | STALE 场景清单 |
| uiat-nightly | ——（不阻断任何人） | 全量通过率 < 95%；flaky 率 > 3%；云真机 SKIPPED > 5% |
| uiat-release | 任一用例 FAILED；性能红线用例超阈值 | —— |

---

## 11. 服务端支撑接口设计（测试支撑平台）

### 11.1 API 列表

统一前缀 `/test-support/v1`，仅 staging 内网 + CI Token 鉴权（`Authorization: Bearer $UIAT_TOKEN`，token 与流水线环境绑定，scoped to test-support），生产网关不暴露该前缀（网关路由黑名单）。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/env/reset` | 重置账号到种子场景。Body: `{account, presetKey}`。幂等（按 account+preset 5min 内重复返回同 resultId） |
| POST | `/accounts/acquire` | 租用账号。Body: `{pool, leaseMinutes, purpose}`。返回 `{account, password, leaseId}`；池空返回 56902 |
| POST | `/accounts/release` | 释放租约。Body: `{leaseId}` |
| GET | `/runs/{runUid}` | 查询 run 状态与用例结果汇总 |
| POST | `/runs/{runUid}/cases/batch-report` | 分片结束批量上报结果（≤200 条/批） |
| GET | `/runs/{runUid}/gate?policy=` | 门禁裁决（§10.5） |
| GET | `/shards/plan?pipeline=&shards=` | 分片规划（消费 §10.2） |
| POST | `/golden-baselines` | 基线 PR 时登记 DRAFT 基线与差异工件 |
| POST | `/golden-baselines/{id}/approve` | 评审通过（需 `golden-reviewer` 角色） |
| GET | `/flaky/report?window=14d` | Flaky 台账周报数据 |

`batch-report` 请求体即 §4.2 JSON 数组；服务端写入 `test_case_execution` 并同步累计 `flaky_case` 计数（当日窗口）。

### 11.2 错误码段

向《服务端-统一业务异常码与错误分类体系》申请登记 **56900-56999（测试支撑平台）**：

| 错误码 | 含义 | HTTP |
|--------|------|------|
| 56901 | 环境重置进行中，稍后重试 | 409 |
| 56902 | 账号池耗尽 | 503 |
| 56903 | presetKey 未定义 | 400 |
| 56904 | runUid 不存在 | 404 |
| 56905 | 上报条数超限 / 字段校验失败 | 400 |
| 56906 | 账号租约已过期或非持有者 | 409 |
| 56907 | 基线矩阵键冲突（同键存在 APPROVED） | 409 |
| 56908 | 无 golden-reviewer 权限 | 403 |
| 56909 | CI Token 无效/过期 | 401 |
| 56910 | 分片规划请求的 pipeline 未注册 | 400 |

### 11.3 权限与安全

- 三类角色：`ci-bot`（上报/查询/租约）、`qa`（+隔离区操作、run 手动触发）、`golden-reviewer`（+基线审批）。隔离区操作必写 `quarantine_audit`。
- 测试账号数据全为合成数据（《种子数据管理》生成器产出），不复制生产脱敏数据进 staging 账号池——规避"截图工件带真实数据"的合规风险。
- 工件桶私有读写，预签名 URL 48h 过期；PR comment 中链接到期后回退到平台页面。

---

## 12. 错误处理与常见失败诊断

### 12.1 失败分类与自动归因表

`result_reporter` 在捕获异常时按规则打 `failureClass`：

| failureClass | 识别规则 | 典型原因 | 是否可重试(E1) |
|--------------|---------|---------|---------------|
| WIDGET_NOT_FOUND | `Finder` 异常且消息含 `too few` | 等待不足/页面未就绪/Key 改名 | ✅ |
| TIMEOUT | 自定义 waiters 超时 | 接口慢/流式卡住 | ✅ |
| PIXEL_NOISE | Golden 差异率 < 0.05% | 抗锯齿抖动 | ✅ |
| ASSERT_MISMATCH | `expect` 失败但控件都在 | 业务真回归或 fixture 漂移 | ❌ |
| FIXTURE_MISSING | Hermetic 拦截器 reject 标记 | fixture 文件缺失/路径错误 | ❌ |
| NATIVE_ERROR | 平台通道抛错 | 权限未授/ROM 差异 | ❌ |
| ENV_BROKEN | 设备失联/OOM/构建崩溃/Runner 退出码 137 | 基础设施故障 | ❌（run 级熔断计数） |

归因数据进周报，指导 §9.4 的系统性治理。

### 12.2 pumpAndSettle 陷阱与等待策略

AI 流式页有打字机动画、光标闪烁、Lottie 常驻动画——**`pumpAndSettle` 会 10s 超时假失败**。统一等待策略：

| 场景 | 策略 |
|------|------|
| 路由转场后 | `await t.pumpAndSettle(const Duration(milliseconds: 500));`（仅转场场景，动画有终点） |
| 流式回答中 | 等待业务完成标记控件：`waitVisible(t, screen.answerDone)`；流式过程用 `settleFor(t, 300ms)` 只推进固定时长 |
| 轮询页面（首页卡片流） | `waitUntil(t, () => t.any(find.byKey(...)), timeout: 15s, interval: 500ms)` |
| 骨架屏 | `waitGone(t, skeletonFinder)`（消失即就绪，不猜时长） |

```dart
// integration_test/support/waiters.dart
Future<void> waitUntil(
  WidgetTester t,
  bool Function() predicate, {
  Duration timeout = const Duration(seconds: 15),
  Duration interval = const Duration(milliseconds: 500),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    if (predicate()) return;
    await t.pump(interval);
  }
  fail('waitUntil 超时 ${timeout.inSeconds}s');
}

Future<void> settleFor(WidgetTester t, int ms) async {
  // 固定推进若干帧，用于"过程态"观察点（截图/中间断言），不依赖动画结束
  for (var i = 0; i < ms ~/ 100; i++) {
    await t.pump(const Duration(milliseconds: 100));
  }
}
```

### 12.3 系统弹窗与权限处理

| 弹窗 | Hermetic 模拟器 | Staging 真机 |
|------|----------------|--------------|
| 相机/麦克风权限 | 已被 §6.3 Mock 绕过，不出现 | `await $.native.grantPermissionWhenInUse();` |
| 通知权限（首启引导） | 引导弹窗是 App 内 Widget，正常 Key 驱动 | 同左 |
| iOS 系统键盘遮挡输入框 | `tester.view` 固定视口；Robot `enterText` 不触发软键盘 | Patrol `$.native` 可处理键盘 dismiss |
| 系统级中断（来电/低电） | 不模拟 | 农场设备开勿扰；低电中断归 ENV_BROKEN |

### 12.4 执行器异常兜底

- 单用例异常不终止分片（框架默认行为 + `run_all_test.dart` 捕获记录）。
- 用例间状态隔离：每个 `testWidgets` 重新装配 `ProviderScope`（`app_bootstrapper` 每次 fresh 构建），禁止用例间共享登录态——需要登录态的用例在 Flow 内显式 `LoginFlow.quickLogin()`。
- 设备侧 watchdog：runner 每 60s 上报心跳，支撑平台 3 分钟无心跳自动将 run 标 ABORTED 并告警（防"云真机挂死占额度"）。

---

## 13. 监控与度量

### 13.1 指标定义与 SQL

| 指标 | 口径 | 查询（`primetop_uiat` 库） |
|------|------|--------------------------|
| P0 自动化覆盖率 | ACTIVE 的 P0 用例数 / 注册表中 P0 需求点数 | `SELECT COUNT(*) FROM test_case_registry WHERE priority='P0' AND lifecycle='ACTIVE'` |
| 冒烟通过率 | PASSED+FLAKY / (PASSED+FAILED+FLAKY)（排除 SKIPPED/QUARANTINED） | 按 run 聚合 `test_case_execution` |
| Flaky 率(14d) | §9.4 窗口 | `SELECT flaky_rate FROM flaky_case WHERE window_start = CURDATE() - INTERVAL 13 DAY` |
| 用例平均耗时 | 近 14 天 `final_duration_ms` 中位数（分片调度依据） | 同上分位数 |
| 隔离区规模 | QUARANTINED 数量 | `lifecycle='QUARANTINED'` 计数，>5 告警 |
| 视觉基线健康 | STALE 场景数 | `golden_baseline WHERE state='STALE'` |
| 逃逸缺陷 | 生产缺陷中路径已被覆盖的数量（人工标注 case 关联） | 缺陷平台字段回流，周报人工维护 |

### 13.2 告警阈值

| 告警 | 阈值 | 级别 | 通知 |
|------|------|------|------|
| 冒烟门禁失败率突增 | 同一 PR 重跑后仍失败 P0 ≥ 2 | P1 | PR comment + client 群 |
| nightly 通过率 | < 95% | P2 | 群消息 |
| Flaky 率 | > 3%（周口径） | P2 | 周报点名 |
| 环境事故 | SKIPPED > 5% 或 run ABORTED | P1 | 测试平台值班（复用《生产事故应急响应》值班体系，测试平台时段轮值） |
| 隔离区超限 | QUARANTINED > 5 个 | P2 | 周报 |
| 基线长期空转 | STALE 场景 > 3 | P2 | 设计系统 owner |

### 13.3 周报模板（每周一 09:00 自动生成）

```markdown
## UIAT 周报 2026-W33
- 执行量：PR 冒烟 86 次 / nightly 7 次 / 云真机 7 次
- 冒烟通过率 98.2%（上周 96.5%↑）；平均耗时 18m32s（分片4）
- Flaky：新增 2 例（UIAT-PHOTO-003 等待策略 / UIAT-PAY-002 staging 数据竞争）
- 隔离区：当前 3 例（明细+工单链接）；本周恢复 1 例
- 视觉回归：新增基线 6 张；差异拦截 4 次（2 次真回归、1 次设计变更、1 次误报）
- 逃逸缺陷：0
- Top 根因：WAIT_LOGIC 41% / NONDET_DATA 27% / ...
```

---

## 14. 合规与安全红线

1. **生产数据禁入**：测试账号池与 Golden 场景数据一律合成（§11.3），禁止从生产库拷贝任何用户数据（含脱敏数据）到 UIAT 环境与工件。
2. **截图工件审计**：所有上传工件先过敏感词与 PII 正则扫描（复用《服务端-教育场景敏感词多层次过滤》管线），命中即拦截上传并告警。
3. **凭证隔离**：`UIAT_TOKEN` 仅存 CI 密钥库；staging 支付沙箱凭证与生产凭证物理隔离（《服务端密钥管理与敏感配置安全策略》约束）。
4. **云真机残留清理**：租约结束自动卸载 APK + 清除应用数据（农场 API 调用，纳入 release 流程的 finally 步骤）。
5. **未成年人合规联动**：涉及未成年人账号的用例（家长绑定、防沉迷）使用合成"虚拟未成年人"档案，实名信息全部使用测试证件号段（与《用户实名认证与未成年人身份核验》staging 约定一致）。
6. **`x-uiat-script` 请求头仅测试构建存在**：生产构建经编译期排除，杜绝被外部利用定向 Mock。

---

## 15. 验收场景

| # | 场景 | 预期 |
|---|------|------|
| 1 | 新增 `UIAT-CHAT-009` 用例但未注册 `@CaseMeta` | CI 对账 FAIL，提示注册步骤 |
| 2 | PR 改动 `ai__chat__send_button` Key 命名但未更新 UiatKeys | pre-commit 检查报双向不一致 |
| 3 | UIAT-CHAT-001 首次失败(WIDGET_NOT_FOUND)、重试通过 | 状态 FLAKY，attempts=2，进 flaky 台账 |
| 4 | 连续 14 天 UIAT-PHOTO-003 FLAKY≥5 次且 rate≥10% | 自动 QUARANTINE + 工单 + 覆盖率分母剔除 |
| 5 | QUARANTINED 用例修复后手动触发 10 连跑 | 全绿才允许 RESTORE，写审计 |
| 6 | Hermetic 缺 fixture 文件 | 用例 FAIL( FIXTURE_MISSING )，不静默发真实网络请求 |
| 7 | SSE 回放脚本 `abortAfterFrames=2` | UIAT-CHAT-005 验证骨架屏→错误提示→重试成功链路 |
| 8 | 修改首页卡片背景色并提交 | uiat-golden FAIL，PR 出现对比九宫格；未评审不可合并 |
| 9 | 字体包 1.4.0→1.5.0 升级 | 全部基线自动 STALE，机器人生成基线 PR，人工确认后恢复比较 |
| 10 | 分片规划请求 4 片 | 各片预估耗时差 < 15%，无历史数据新用例按 60s 估 |
| 11 | 云真机 run 中设备失联 | 3 分钟心跳超时 → run ABORTED + P1 告警，不烧完整预算 |
| 12 | 连续 5 用例 ENV_BROKEN | 分片熔断终止，run 标 ABORTED |
| 13 | `POST /accounts/acquire` 池空 | 返回 56902，流水线等待 60s 重试一次后降级跳过 STAGING 组用例（记 SKIPPED） |
| 14 | 夜间 Flaky 聚合执行 | flaky_case 周窗口更新，周报周一 09:00 产出 |
| 15 | 生产构建产物 grep `x-uiat-script` | 无该符号（编译期排除验证） |

---

## 16. 关联文档

| 文档 | 关联点 |
|------|--------|
| 测试策略与质量保障体系 | 上位策略，本文档实现其 §2.3/§2.4 工程化 |
| 单元测试与集成测试策略 | 逻辑层测试边界，本文档不含单测 |
| MVP-P0功能验收标准与端到端测试场景 | 用例需求源（E2E-001~008 映射表 §5.5） |
| 种子数据管理与自动化测试数据生成引擎 | Staging presetKey 数据供给 |
| 客户端组件库与设计系统 | UiatKeys 命名对齐、Golden 场景来源 |
| 客户端主题引擎与动态外观系统 | 基线矩阵 theme 维度 |
| 分龄UI适配与交互设计规范 | 基线矩阵 stage 维度 |
| 客户端字体资源注册与动态加载引擎 | 字体包版本锁定（§7.5） |
| SSE流式响应与AI增量渲染引擎 | SSE 回放帧协议（§6.2） |
| 客户端网络请求治理与弱网适配方案 | 弱网档参数（§6.5） |
| 客户端状态管理架构 | Provider override 注入点（§6.1） |
| CI-CD流水线与自动化构建发布系统 | Workflow 挂接与 runner 复用 |
| 服务端-统一业务异常码与错误分类体系 | 56900-56999 错误码段登记 |
| 服务端密钥管理与敏感配置安全策略 | CI Token 与沙箱凭证管理 |
| 服务端-教育场景敏感词多层次过滤与内容安全规则引擎 | 工件上传前内容扫描（§14.2） |
