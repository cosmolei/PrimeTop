# 生产事故应急响应与 OnCall 值班调度体系 - 详细设计

> 所属领域：运维保障 / 研发效能
> 上游文档：`docs/design/启硕-PrimeTop-全学段AI辅助学习软件项目设计文档.md`（14.2 节"正式上线：完成监控、客服、运营和应急预案"、15 节风险应对策略）
> 相关文档：`日志与监控告警体系`、`服务端-智能故障检测与自动恢复自愈引擎`、`排障根因分析与系统故障复盘引擎`、`服务端-SLO服务等级目标管理与可靠性工程平台`、`服务端-统一通知偏好授权中心与消息频率智能管控引擎`、`管理后台-系统监控与运维管理工作台`

---

## 1. 模块概述

### 1.1 功能定位

本模块是 PrimeTop 平台的**生产事故"人 + 流程"响应中枢**，负责从"告警触达值班人"到"事故恢复并对外公告"的全生命周期人工协同调度，核心解决三类问题：

1. **谁来响应**：值班排班（OnCall Schedule）、值班名册（Roster）、换班/代班、节假日与寒暑假高峰强化值班。
2. **如何响应**：事故分级标准（SEV1~SEV4，按教育业务影响定义）、响应时限（MTTA 目标）、升级策略（Escalation Policy，超时自动升级）、事故指挥角色（IC/沟通/记录）。
3. **如何收口**：事故状态机、时间线记录、状态页（Status Page）与 App 内用户公告、复盘闭环衔接（SEV1/SEV2 强制关联复盘）。

### 1.2 与相关模块的边界（关键，避免职责重叠）

| 模块 | 职责 | 与本模块的分工 |
| --- | --- | --- |
| 日志与监控告警体系 | 指标采集、告警规则、Alertmanager 通知路由 | 本模块是告警的**下游消费者**：通过 Alertmanager Webhook 接收告警，负责人工响应调度；告警本身的技术路由、抑制、静默仍归告警体系 |
| 智能故障检测与自动恢复自愈引擎 | 机器自动诊断、自动执行修复 Playbook | 自愈引擎处理"机器可自愈"故障；本模块处理"需要人介入"的故障。自愈失败或自愈策略标记 `need_human=true` 时自动流转到本模块创建事故 |
| 排障根因分析与系统故障复盘引擎 | 事后根因分析、复盘报告、改进项追踪 | 本模块负责"事中"响应与恢复，事故 `RESOLVED` 后按严重度决定是否强制进入复盘引擎；复盘实体通过 `incident_id` 关联 |
| SLO 管理平台 | SLO 定义、错误预算消耗、 burn rate 告警 | SLO 快速燃尽告警是本模块的告警源之一；事故影响时长反哺 SLO 误差统计 |
| 通知中心 / 多通道推送 | 站内信、App 推送、短信等用户侧触达 | 本模块面向**内部值班人员**（电话/IM/短信），用户侧公告通过通知中心发布，两者通道隔离 |
| 教育内容紧急下线与安全事故应急响应工作流引擎 | 内容安全类专项工作流（内容下线、替换、追责） | 内容安全类事故在本模块完成**统一受理与分级**后，按类型分发到该引擎执行专项流程 |
| 管理后台-系统监控与运维管理工作台 | 运维操作的 Web UI | 本模块的管理界面（排班管理、值班台、事故列表、状态页配置）挂载在该工作台下 |

### 1.3 设计目标（量化）

| 指标 | 定义 | 目标 |
| --- | --- | --- |
| MTTA | 告警触发 → 值班人认领 的中位耗时 | SEV1 ≤ 5min，SEV2 ≤ 15min |
| MTTR | 事故创建 → MITIGATED 的中位耗时 | SEV1 ≤ 60min |
| 升级触发率 | 超时未认领而触发自动升级的事故占比 | < 10%（反映排班质量） |
| 值班响应失联率 | L1/L2 均未响应需触达 L3 的事故占比 | < 2% |
| 状态页公告及时率 | SEV1 事故 30min 内发布首条用户公告的比例 | ≥ 95% |
| 复盘闭环率 | SEV1/SEV2 事故 5 个工作日内完成复盘的比例 | 100% |

### 1.4 核心用户与角色

| 角色 | 说明 | 关键操作 |
| --- | --- | --- |
| 值班工程师（L1） | 按排班表轮值的一线研发/运维 | 认领事故、初判分级、执行人工预案、升级申请 |
| 备班工程师（L2） | 与 L1 同一时段的后备 | L1 超时后代接 |
| 值班经理（L2） | 当周值班负责人，通常为团队 TL | 资源协调、批准换班、确认对外公告口径 |
| 技术负责人 / CTO（L3） | 最终升级层 | 重大决策（如全站降级、切换机房、监管上报决策） |
| 事故指挥官（IC） | SEV1 事故启动后由 L1/L2 担任，可转移 | 统一指挥、任务分解、指定沟通/记录角色 |
| 沟通负责人（COMMS） | SEV1/SEV2 指定 | 对内通报节奏、状态页与用户公告、客服口径同步 |
| 记录员（SCRIBE） | SEV1 指定 | 维护事故时间线，保证复盘素材完整 |

---

## 2. 事故分级标准（教育业务特化）

分级依据 = **影响面 × 业务关键度 × 数据/合规风险**。判定规则由"自动预判 + 值班人确认"两步完成：系统按规则给出建议级别，值班人认领后 10 分钟内确认或调整（调整留痕）。

### 2.1 严重度定义

| 级别 | 名称 | 判定条件（满足任一，高峰时段定义见 2.3） | 响应要求 | 公告要求 |
| --- | --- | --- | --- | --- |
| SEV1 | 灾难级 | ① App 核心链路（登录/AI 问答/拍题）整体不可用 ≥5min 或高峰期可用性 <70%；② 支付下单/回调整体失败 ≥10min；③ 确认发生数据泄露、未成年人个人信息违规暴露；④ AI 输出违法违规内容且已被大范围（≥1000 用户）消费 | 电话 5min 内接通，全员战时，IC 就位 | 状态页 + App 开屏公告，30min 内首条；此后每 30min 更新 |
| SEV2 | 严重级 | ① 核心功能高峰期可用性 70%~90% 或 P95 首字耗时劣化 >3 倍持续 15min；② 某教材版本章节内容出现批量错误/错版且已曝光；③ 推送通道整体故障致学习提醒/家长提醒中断 ≥30min；④ 单一核心依赖（单家大模型供应商）故障且降级容量不足 | 认领 ≤15min | 状态页发布；视影响决定是否 App 内公告 |
| SEV3 | 一般级 | ① 非核心功能（报告导出、商城、排行榜等）故障；② 局部用户（<1%）功能异常且有绕行方案；③ 性能劣化未达 SEV2 阈值 | 工作时间 1h 内认领 | 状态页记录（不影响用户则不公告） |
| SEV4 | 轻微级 | 单用户问题、咨询类、边角 bug，可走工单 | 下一工作日处理 | 不公告 |

### 2.2 特殊类别处理

1. **数据安全/未成年人隐私事件（自动 SEV1）**：涉及未成年人个人信息（姓名、学校、学习数据、对话记录）泄露或违规暴露的，立即拉入法务与合规负责人；对监管机构与受影响个人的告知**时限与口径以法务合规评估为准**（依据《个人信息保护法》《未成年人网络保护条例》及教育主管部门要求），本模块只负责流程编排与留痕，不代做法务决策。
2. **内容安全事件**：AI 输出或 UGC 出现违法违规内容的，本模块统一受理定级后分发至"教育内容紧急下线与安全事故应急响应工作流引擎"执行专项处置。
3. **心理危机误报/漏报**：涉及"学生AI对话心理危机信号检测"引擎的争议事件，按 SEV2 起步，需 AI 安全负责人会商。

### 2.3 教育业务高峰时段（值班强化窗口）

| 窗口 | 时间（Asia/Shanghai） | 说明 |
| --- | --- | --- |
| 学期日晚高峰 | 18:00–22:00 | 放学作业高峰，AI 问答/拍题流量峰值 |
| 学期日晨读 | 06:30–08:00 | 背诵/听力使用高峰 |
| 周末全天 | 09:00–22:00 | 周末学习流量整体抬升 |
| 寒暑假 | 全天 08:00–22:00 强化 | 专题学习营期间按"学期日晚高峰"标准值守 |
| 考试季 | 中高考前 30 天 | 变更冻结窗口 + 双人值班 |

高峰时段内 SEV2 判定阈值下调一档（如可用性阈值从 90% 放宽到 85% 即判 SEV2），由配置中心 `oncall.peak-policy` 下发，支持运营按寒暑假时间表预先配置。

---

## 3. 整体架构

### 3.1 架构图

```text
┌──────────────────────────── 告警源 ────────────────────────────┐
│ Prometheus/Alertmanager   SLO平台(burn rate)   自愈引擎(need_human) │
│ 合成监控巡检   客服工单升级   内容安全监测   人工上报(值班台/CLI)      │
└───────────────┬────────────────────────────────────────────┘
                │ Webhook / API（统一事件网关）
                ▼
┌────────────────────────────────────────────────────────────────┐
│                 应急响应调度服务（本模块）incident-svc              │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌─────────────────┐  │
│  │ 事件网关   │ │ 聚合去重  │ │ 严重度预判 │ │ 事故生命周期管理   │  │
│  │ (webhook) │ │ (fingerprint)│ (规则引擎) │ │ (状态机)         │  │
│  └──────────┘ └──────────┘ └───────────┘ └─────────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌─────────────────┐  │
│  │ 值班排班   │ │ 升级调度器 │ │ 角色与协同  │ │ 状态页与公告      │  │
│  │ (schedule)│ │ (escalator)│ │ (战时群)   │ │ (status page)   │  │
│  └──────────┘ └──────────┘ └───────────┘ └─────────────────┘  │
└───────┬───────────────┬───────────────────┬──────────────────┘
        │               │                   │
        ▼               ▼                   ▼
  内部触达通道       协同工具            用户侧通道（隔离）
  电话/IM机器人/短信   飞书/钉钉战时群      通知中心(运营弹窗/公告)
                                        → 状态页 H5
支撑存储：MySQL(排班/事故) Redis(升级定时器/去重窗口/心跳)
```

### 3.2 技术选型

| 组件 | 选型 | 说明 |
| --- | --- | --- |
| 服务实现 | Go（Gin），随运维域独立部署 `incident-svc` | 与主业务服务隔离部署，避免业务故障时应急体系同时不可用 |
| 升级定时器 | Redis ZSET + 独立 worker 轮询 | 秒级精度；DB 持久化兜底，Redis 不可用时降级为 DB 轮询 |
| 去重窗口 | Redis `SETNX + TTL`（fingerprint 键） | 5 分钟窗口内同指纹告警合并 |
| 内部触达 | 电话（运营商语音 API）、IM 机器人（飞书/钉钉/企微）、短信 | 通道降级链见第 8 节 |
| 状态页 | 静态化 H5（CDN 分发）+ 管理后台配置 | 状态页必须与主站基础设施隔离，主站全挂时状态页仍可访问 |
| 时钟 | 全部使用 UTC 存储，展示层按 Asia/Shanghai | 排班计算统一在 UTC+8 业务时区语义下进行 |

### 3.3 设计原则

1. **自身高可用优先**：调度服务双实例部署 + 通道多云；调度服务自身故障由"死人的开关"兜底——告警直连预警电话号码广播（见 10.5）。
2. **一切留痕**：分级调整、角色指定、公告发布、关闭操作全部写入 `incident_timeline`，供复盘与合规审计。
3. **机器优先，人兜底**：能自愈的先走自愈引擎；本模块只对需要人判断的事故做调度，避免告警疲劳。
4. **值班动作最小化**：值班人手机端（IM 机器人卡片）完成认领/升级/关闭，不强制开电脑。

---

## 4. 数据结构定义

以下 DDL 基于 MySQL 8.0（utf8mb4）。所有表含通用字段 `created_at`、`updated_at`（下略）。

### 4.1 值班域

```sql
-- 值班团队：按域拆分（业务域/AI域/基础设施域/内容安全域）
CREATE TABLE oncall_team (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  team_code     VARCHAR(32)  NOT NULL UNIQUE COMMENT '如 biz-core / ai-platform / infra / content-safety',
  team_name     VARCHAR(64)  NOT NULL,
  description   VARCHAR(255) DEFAULT NULL,
  enabled       TINYINT(1)   NOT NULL DEFAULT 1,
  KEY idx_enabled (enabled)
) COMMENT '值班团队';

-- 值班名册成员
CREATE TABLE oncall_roster_member (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  team_id       BIGINT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL COMMENT '关联内部账号体系',
  member_name   VARCHAR(64)  NOT NULL,
  level         TINYINT      NOT NULL DEFAULT 1 COMMENT '可承担层级 1=一线 2=备班/经理 3=负责人',
  phone         VARCHAR(32)  NOT NULL COMMENT 'AES加密存储',
  im_webhook    VARCHAR(512) DEFAULT NULL COMMENT '个人 IM 机器人 webhook',
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  max_consecutive_shifts TINYINT NOT NULL DEFAULT 2 COMMENT '最大连续班次数，防过劳',
  UNIQUE KEY uk_team_user (team_id, user_id),
  KEY idx_team_active (team_id, active)
) COMMENT '值班名册';

-- 班次定义
CREATE TABLE oncall_shift (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  team_id       BIGINT UNSIGNED NOT NULL,
  shift_code    VARCHAR(32)  NOT NULL COMMENT '如 weekday-day / weekday-night / weekend / holiday',
  shift_name    VARCHAR(64)  NOT NULL,
  tz_offset     VARCHAR(8)   NOT NULL DEFAULT '+08:00',
  start_time    TIME NOT NULL COMMENT '当日起始，如 09:00',
  end_time      TIME NOT NULL COMMENT '结束时间，跨天用 >24h 语义，夜班 22:00 写 22:00，end 08:00 次日',
  cross_day     TINYINT(1)   NOT NULL DEFAULT 0,
  UNIQUE KEY uk_team_code (team_id, shift_code)
) COMMENT '班次定义（缺省模板：日班09-22 / 夜班22-09）';

-- 排班表（生成的每一班一行）
CREATE TABLE oncall_schedule (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  team_id       BIGINT UNSIGNED NOT NULL,
  shift_id      BIGINT UNSIGNED NOT NULL,
  shift_date    DATE NOT NULL COMMENT '班次起始日',
  start_at      DATETIME(3) NOT NULL,
  end_at        DATETIME(3) NOT NULL,
  primary_member_id  BIGINT UNSIGNED NOT NULL COMMENT 'L1 值班人',
  secondary_member_id BIGINT UNSIGNED DEFAULT NULL COMMENT 'L2 备班',
  status        TINYINT NOT NULL DEFAULT 0 COMMENT '0=待生效 1=生效中 2=已完成 3=已换班',
  source        TINYINT NOT NULL DEFAULT 0 COMMENT '0=自动生成 1=手动指定 2=换班产生',
  UNIQUE KEY uk_team_date_shift (team_id, shift_date, shift_id),
  KEY idx_time (start_at, end_at),
  KEY idx_primary (primary_member_id, shift_date)
) COMMENT '值班排班';

-- 换班/代班申请
CREATE TABLE oncall_swap_request (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  schedule_id   BIGINT UNSIGNED NOT NULL,
  requester_id  BIGINT UNSIGNED NOT NULL,
  substitute_member_id BIGINT UNSIGNED NOT NULL,
  reason        VARCHAR(255) NOT NULL,
  status        TINYINT NOT NULL DEFAULT 0 COMMENT '0=待对方确认 1=待值班经理审批 2=通过 3=驳回 4=取消',
  approver_id   BIGINT UNSIGNED DEFAULT NULL,
  KEY idx_schedule (schedule_id), KEY idx_status (status)
) COMMENT '换班申请';

-- 值班交接记录（换班/交班时填写，沉淀上下文）
CREATE TABLE oncall_handover (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  schedule_id   BIGINT UNSIGNED NOT NULL,
  from_member_id BIGINT UNSIGNED NOT NULL,
  to_member_id  BIGINT UNSIGNED NOT NULL,
  open_incidents VARCHAR(2048) DEFAULT NULL COMMENT '未关闭事故清单 JSON [{incidentId,sev,note}]',
  risk_notes    VARCHAR(2048) DEFAULT NULL COMMENT '在途变更/灰度/风险提示',
  checklist     JSON DEFAULT NULL COMMENT '交接检查项 [{"item":"告警静默已复核","done":true}]',
  KEY idx_schedule (schedule_id)
) COMMENT '值班交接记录';
```

### 4.2 升级策略域

```sql
-- 升级策略：一个团队可配多条，按严重度匹配
CREATE TABLE escalation_policy (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  team_id       BIGINT UNSIGNED NOT NULL,
  policy_name   VARCHAR(64) NOT NULL,
  match_sevs    VARCHAR(32) NOT NULL COMMENT '匹配严重度 CSV，如 SEV1,SEV2',
  repeat_rounds TINYINT NOT NULL DEFAULT 1 COMMENT '最后一级无人响应时重复通知轮数',
  enabled       TINYINT(1) NOT NULL DEFAULT 1,
  KEY idx_team (team_id, enabled)
) COMMENT '升级策略';

-- 升级层级
CREATE TABLE escalation_level (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  policy_id     BIGINT UNSIGNED NOT NULL,
  level_no      TINYINT NOT NULL COMMENT '1,2,3',
  timeout_sec   INT NOT NULL COMMENT '本级认领超时秒数，如 SEV1 L1=300',
  notify_channels VARCHAR(64) NOT NULL COMMENT 'CSV: phone,im,sms',
  member_ids    JSON NOT NULL COMMENT '指定成员；为空则取排班表对应层级',
  role_label    VARCHAR(64) DEFAULT NULL COMMENT '如 一线值班/值班经理/技术负责人',
  UNIQUE KEY uk_policy_level (policy_id, level_no)
) COMMENT '升级层级';

-- 升级任务（运行态，含定时器持久化）
CREATE TABLE escalation_task (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  incident_id   BIGINT UNSIGNED NOT NULL,
  policy_id     BIGINT UNSIGNED NOT NULL,
  current_level TINYINT NOT NULL DEFAULT 1,
  round_no      TINYINT NOT NULL DEFAULT 1,
  deadline_at   DATETIME(3) NOT NULL COMMENT '本级认领截止时间',
  status        TINYINT NOT NULL DEFAULT 0 COMMENT '0=等待认领 1=已认领 2=已升级 3=已重复通知 4=已结束(终态)',
  notified_log  JSON DEFAULT NULL COMMENT '[{"level":1,"channel":"phone","at":"...","ok":true}]',
  UNIQUE KEY uk_incident_active (incident_id, status),
  KEY idx_deadline (status, deadline_at)
) COMMENT '升级任务';
```

### 4.3 事故域

```sql
-- 告警事件（原始入库，供聚合与审计）
CREATE TABLE alert_event (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  fingerprint   CHAR(64) NOT NULL COMMENT 'sha256(source+group_key+首条label)',
  source        VARCHAR(32) NOT NULL COMMENT 'alertmanager/slo/selfheal/synthetic/manual/ticket',
  group_key     VARCHAR(512) DEFAULT NULL,
  labels        JSON NOT NULL,
  annotations   JSON DEFAULT NULL,
  starts_at     DATETIME(3) DEFAULT NULL,
  dedup_count   INT NOT NULL DEFAULT 1 COMMENT '窗口内合并次数',
  incident_id   BIGINT UNSIGNED DEFAULT NULL COMMENT '聚合归入的事故',
  KEY idx_fp_time (fingerprint, created_at),
  KEY idx_incident (incident_id)
) COMMENT '告警事件';

-- 事故主表
CREATE TABLE incident (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  incident_no   VARCHAR(20) NOT NULL UNIQUE COMMENT '对外编号 INC-20260814-001',
  title         VARCHAR(128) NOT NULL,
  severity      VARCHAR(8)  NOT NULL COMMENT 'SEV1~SEV4',
  severity_final VARCHAR(8) DEFAULT NULL COMMENT '值班人确认后的终判级别（留痕对比）',
  category      VARCHAR(32) NOT NULL COMMENT 'availability/performance/payment/content_safety/data_security/dependency/push/other',
  team_id       BIGINT UNSIGNED NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'TRIGGERED' COMMENT '状态机见 6.1',
  impact_desc   VARCHAR(1024) DEFAULT NULL COMMENT '影响面描述：用户量/功能/学段',
  affected_components JSON DEFAULT NULL COMMENT '受影响组件ID CSV/JSON，联动状态页',
  source        VARCHAR(32) NOT NULL,
  auto_remediated TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否经过自愈引擎尝试',
  merged_into   BIGINT UNSIGNED DEFAULT NULL,
  commander_id  BIGINT UNSIGNED DEFAULT NULL COMMENT 'IC',
  comms_id      BIGINT UNSIGNED DEFAULT NULL,
  scribe_id     BIGINT UNSIGNED DEFAULT NULL,
  trigger_at    DATETIME(3) NOT NULL,
  ack_at        DATETIME(3) DEFAULT NULL,
  ack_by        BIGINT UNSIGNED DEFAULT NULL,
  mitigated_at  DATETIME(3) DEFAULT NULL,
  resolved_at   DATETIME(3) DEFAULT NULL,
  closed_at     DATETIME(3) DEFAULT NULL,
  resolve_note  VARCHAR(1024) DEFAULT NULL,
  postmortem_id BIGINT UNSIGNED DEFAULT NULL COMMENT '复盘引擎关联ID',
  KEY idx_status_sev (status, severity),
  KEY idx_time (trigger_at),
  KEY idx_team_time (team_id, trigger_at)
) COMMENT '生产事故';

-- 事故时间线（自动事件 + 人工记录统一存储）
CREATE TABLE incident_timeline (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  incident_id   BIGINT UNSIGNED NOT NULL,
  event_type    VARCHAR(32) NOT NULL COMMENT 'created/alert_merged/acked/severity_changed/status_changed/role_assigned/action_note/comms/published/escalated/remediation',
  actor_id      BIGINT UNSIGNED DEFAULT NULL COMMENT '为空表示系统',
  actor_name    VARCHAR(64) DEFAULT NULL,
  content       VARCHAR(2048) NOT NULL,
  extra         JSON DEFAULT NULL,
  event_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_incident_time (incident_id, event_at)
) COMMENT '事故时间线';

-- 认领记录（升级审计）
CREATE TABLE ack_record (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  incident_id   BIGINT UNSIGNED NOT NULL,
  escalation_task_id BIGINT UNSIGNED DEFAULT NULL,
  member_id     BIGINT UNSIGNED NOT NULL,
  via_channel   VARCHAR(16) NOT NULL COMMENT 'phone-keypress/im-btn/sms-link/web',
  latency_ms    INT NOT NULL,
  KEY idx_incident (incident_id)
) COMMENT '认领记录';
```

### 4.4 状态页与公告域

```sql
-- 状态页组件（对外展示的服务清单）
CREATE TABLE status_component (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  comp_code     VARCHAR(32) NOT NULL UNIQUE COMMENT 'ai-tutor/snap-question/sync-class/mistake-book/payment/push/report',
  comp_name     VARCHAR(64) NOT NULL,
  group_name    VARCHAR(32) DEFAULT NULL COMMENT '分组：核心学习/交易/消息',
  sort_order    INT NOT NULL DEFAULT 0
) COMMENT '状态页组件';

-- 状态页事故（对外）
CREATE TABLE status_page_incident (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  incident_id   BIGINT UNSIGNED NOT NULL,
  external_visibility TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否对外可见',
  banner_text   VARCHAR(255) DEFAULT NULL,
  UNIQUE KEY uk_incident (incident_id)
) COMMENT '状态页事故映射';

-- 状态页更新（多轮公告）
CREATE TABLE status_page_update (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  sp_incident_id BIGINT UNSIGNED NOT NULL,
  update_stage  VARCHAR(16) NOT NULL COMMENT 'investigating/identified/monitoring/resolved',
  body          VARCHAR(2048) NOT NULL,
  published_at  DATETIME(3) DEFAULT NULL COMMENT '为空=草稿',
  publish_channels JSON DEFAULT NULL COMMENT '["status_page","app_banner","push"]',
  KEY idx_sp (sp_incident_id, published_at)
) COMMENT '状态页更新';
```

### 4.5 人工应急预案（区别于自愈引擎的自动 Playbook）

```sql
CREATE TABLE response_playbook (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  pb_code       VARCHAR(32) NOT NULL UNIQUE COMMENT 'MANUAL-PB-001',
  title         VARCHAR(128) NOT NULL,
  category      VARCHAR(32) NOT NULL,
  match_sevs    VARCHAR(32) DEFAULT NULL,
  severity_hint VARCHAR(8)  DEFAULT NULL COMMENT '建议定级',
  content_md    MEDIUMTEXT NOT NULL COMMENT 'Markdown：现象/判断步骤/处置步骤/回滚/上报要求',
  owner_team_id BIGINT UNSIGNED NOT NULL,
  reviewed_at   DATETIME DEFAULT NULL COMMENT '季度复审时间',
  enabled       TINYINT(1) NOT NULL DEFAULT 1,
  KEY idx_cat (category, enabled)
) COMMENT '人工应急预案手册';
```

预置预案清单（首批 10 篇，内容示例见附录 A）：

| 编号 | 主题 | 建议定级 |
| --- | --- | --- |
| MANUAL-PB-001 | 大模型供应商整体故障：全量切换备选模型与只读降级 | SEV1 |
| MANUAL-PB-002 | 数据库主库宕机：主从切换与连接排空 | SEV1 |
| MANUAL-PB-003 | 支付回调持续失败：渠道排查与补单方案 | SEV1/2 |
| MANUAL-PB-004 | AI 输出违法违规内容扩散：熔断模型、内容下线、留存证据 | SEV1 |
| MANUAL-PB-005 | 疑似数据泄露：止血、取证、法务上报流程 | SEV1 |
| MANUAL-PB-006 | 推送通道整体故障：厂商通道切换与本地通知兜底 | SEV2 |
| MANUAL-PB-007 | 教材内容批量错版：紧急隐藏章节与公告口径 | SEV2 |
| MANUAL-PB-008 | Redis 集群故障：多级缓存降级与热点保护 | SEV2 |
| MANUAL-PB-009 | K8s 节点池异常：封锁节点与驱逐转移 | SEV2 |
| MANUAL-PB-010 | App 发版事故：渠道撤包与热修决策树 | SEV1/2 |

### 4.6 指标汇总

```sql
CREATE TABLE incident_metrics_daily (
  stat_date     DATE NOT NULL,
  team_id       BIGINT UNSIGNED NOT NULL,
  sev           VARCHAR(8) NOT NULL,
  incident_cnt  INT NOT NULL DEFAULT 0,
  mtta_p50_ms   INT DEFAULT NULL, mtta_p90_ms INT DEFAULT NULL,
  mttr_p50_ms   INT DEFAULT NULL, mttr_p90_ms INT DEFAULT NULL,
  escalated_cnt INT NOT NULL DEFAULT 0,
  PRIMARY KEY (stat_date, team_id, sev)
) COMMENT '事故指标日汇总（T+1 由定时任务计算）';
```

---

## 5. API 接口设计

统一前缀 `/api/v1/ops/incident-svc`，鉴权走内部账号体系 + 角色权限（`OPS_ONCALL` / `OPS_ADMIN`）；Webhook 接口走内网 + HMAC 签名。响应对齐《服务端统一响应封装与分页查询规范》。

### 5.1 值班管理

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| GET | `/oncall/schedules?teamId=&from=&to=&mine=true` | 查询排班（`mine=true` 只看我的） | 全部值班角色 |
| POST | `/oncall/schedules/generate` | 批量生成排班 `{teamId, fromDate, weeks, shiftCodes[]}` | OPS_ADMIN |
| PUT | `/oncall/schedules/{id}` | 手动改班（指定 primary/secondary） | OPS_ADMIN |
| POST | `/oncall/swap-requests` | 发起换班 | 值班成员 |
| POST | `/oncall/swap-requests/{id}/approve` | 审批（双方确认后由值班经理审批） | 值班经理 |
| POST | `/oncall/handovers` | 提交交接记录 | 值班成员 |
| GET | `/oncall/current?teamId=` | 查询当前在值人员（含 L1/L2，供其他系统调用） | 内部服务 |

`GET /oncall/current` 响应示例：

```json
{
  "code": 0,
  "data": {
    "teamId": 1,
    "shift": { "code": "weekday-night", "startAt": "2026-08-14T22:00:00+08:00", "endAt": "2026-08-15T09:00:00+08:00" },
    "primary":  { "memberId": 1001, "name": "张工", "phone": "+86138****1234" },
    "secondary": { "memberId": 1002, "name": "李经理", "phone": "+86139****5678" }
  }
}
```

### 5.2 告警接入

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/internal/webhooks/alertmanager` | Alertmanager Webhook（HMAC 签名校验） |
| POST | `/internal/webhooks/selfheal` | 自愈引擎上报（`need_human` 或自愈失败） |
| POST | `/internal/webhooks/slo` | SLO 平台 burn rate 事件 |
| POST | `/internal/manual` | 人工上报事故（值班台/CLI：`primetop incident create ...`） |

请求体（Alertmanager 标准格式 + 扩展 label）关键字段约定：

```json
{
  "alerts": [
    {
      "status": "firing",
      "labels": {
        "alertname": "HighErrorRate",
        "service": "ai-tutor-svc",
        "severity": "SEV2",              // 约定 label，映射建议定级
        "team": "ai-platform",           // 路由到值班团队
        "component": "ai-tutor",         // 联动状态页组件
        "playbook_hint": "MANUAL-PB-001" // 可选：建议预案
      },
      "annotations": { "summary": "AI问答错误率 12% 持续 5 分钟" },
      "startsAt": "2026-08-14T13:42:00Z"
    }
  ]
}
```

处理语义：**幂等**。同一 `fingerprint` 在 5 分钟窗口内的重复告警仅累计 `dedup_count` 并合并进既有事故，不重复创建、不重复电话。

### 5.3 事故生命周期

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/incidents?status=&severity=&teamId=&from=&to=&page=` | 事故列表（分页） |
| GET | `/incidents/{incidentNo}` | 事故详情（含时间线、当前升级状态） |
| POST | `/incidents/{incidentNo}/ack` | 认领 `{viaChannel:"im-btn"}` |
| POST | `/incidents/{incidentNo}/severity` | 调整定级 `{severity:"SEV1", reason:"..."}`（留痕） |
| POST | `/incidents/{incidentNo}/mitigate` | 标记已缓解 `{note:"已切换备用模型"}` |
| POST | `/incidents/{incidentNo}/resolve` | 标记已恢复 `{resolveNote:"..."}`；SEV1/2 校验 postmortemId 非空才能 CLOSED |
| POST | `/incidents/{incidentNo}/close` | 关闭（SEV1 关闭需二次确认参数 `confirm=true`） |
| POST | `/incidents/{incidentNo}/merge` | 并入 `{targetIncidentNo}` |
| POST | `/incidents/{incidentNo}/cancel` | 误报关闭 `{reason}` |
| POST | `/incidents/{incidentNo}/roles` | 指定角色 `{role:"commander", memberId:1001}` |
| POST | `/incidents/{incidentNo}/timeline` | 追加人工记录 `{content}` |
| POST | `/incidents/{incidentNo}/escalate` | 主动升级（不等超时） |

错误码（节选，挂接统一错误码体系）：

| 错误码 | 场景 |
| --- | --- |
| ONC-409-01 | 事故状态不允许该操作（状态机拦截） |
| ONC-409-02 | 已被他人认领（返回当前认领人） |
| ONC-412-01 | SEV1/SEV2 关闭但未关联复盘 |
| ONC-412-02 | SEV1 关闭未传 `confirm=true` |
| ONC-404-01 | 事故编号不存在 |
| ONC-403-01 | 非当值人员尝试认领（允许，但需带 `force=true` 并记录） |

### 5.4 状态页与公告

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/public/status` | 公开接口：组件健康 + 进行中事故（CDN 缓存 30s） |
| POST | `/statuspage/incidents` | 创建状态页事故（绑定 incidentId） |
| POST | `/statuspage/updates` | 发布/保存草稿 `{spIncidentId, stage, body, channels[]}` |
| POST | `/statuspage/updates/{id}/publish` | 发布（触发状态页静态化 + 通知中心公告） |

### 5.5 指标查询

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/metrics/summary?from=&to=&teamId=` | MTTA/MTTR/升级率汇总（供运维工作台看板） |
| GET | `/metrics/oncall-quality?memberId=&quarter=` | 个人值班质量（认领率/平均响应/换班次数） |

---

## 6. 状态流转设计

### 6.1 事故状态机

```text
                    ┌────────────┐
   告警/人工创建 ──▶│ TRIGGERED  │──误报──▶ CANCELLED
                    │ (待认领)    │
                    └─────┬──────┘
                     认领(ack)
                    ┌─────▼──────┐   并入他单
                    │ACKNOWLEDGED│──────────▶ MERGED
                    │ (处理中)    │
                    └─────┬──────┘
                  缓解(影响消除)
                    ┌─────▼──────┐
              ┌────▶│ MITIGATED  │
              │     │ (已缓解)    │
              │     └─────┬──────┘
              │ 影响复现回退  │ 确认恢复(resolve)
              │           ▼
              │     ┌──────────┐  关闭(复盘达标) ──▶ CLOSED(终态)
              └─────│ RESOLVED │
                    └──────────┘
```

| 当前态 | 事件 | 目标态 | 守卫条件 / 副作用 |
| --- | --- | --- | --- |
| TRIGGERED | ack | ACKNOWLEDGED | 写 ack_at、ack_record；终止升级定时器；启动 SEV 时限 SLA 计时 |
| TRIGGERED | cancel(误报) | CANCELLED | 记录 reason；同指纹 1h 内再触发告警时**提高预判级别**（防误判反复） |
| ACKNOWLEDGED | mitigate | MITIGATED | 写 mitigated_at；SEV1/2 自动提醒 COMMS 发布"恢复观察"公告 |
| ACKNOWLEDGED | resolve | RESOLVED | 允许直达（无需 mitigate）；写 resolved_at |
| MITIGATED | resolve | RESOLVED | 写 resolved_at |
| MITIGATED | regress | ACKNOWLEDGED | 影响复现；自动通知原值班链；时间线标记"回退" |
| RESOLVED | close | CLOSED | SEV1/2 必须已关联 postmortem_id；SEV1 需 `confirm=true` |
| ACKNOWLEDGED | merge | MERGED | 目标事故必须非终态；源事故告警重定向；时间线互链 |
| 任意活跃态 | severity change | 原状态保持 | 仅改 severity + 时间线留痕；升级到 SEV1 时重新按 SEV1 升级策略补发电话 |

实现约束：状态迁移以 MySQL 行锁 `SELECT ... FOR UPDATE` + 状态条件更新实现乐观并发（`UPDATE incident SET status=? WHERE id=? AND status=?`，影响行数=0 则抛 ONC-409-01）。

### 6.2 升级流程（超时驱动）

```text
创建事故(SEV∈策略匹配) 
  → escalation_task(level=1, deadline=now+timeout_1)
  → L1 多通道通知(phone+im)
  → [认领] task→已认领, 停止
  → [超时未认领] level=2, deadline=now+timeout_2 → 通知 L2(值班经理+备班, phone)
  → [仍超时] level=3 → 通知技术负责人/CTO(phone+sms)
  → [L3 超时] round+1 重复通知(repeat_rounds 次, 间隔 min(timeout_3, 5min))
  → 全部轮次耗尽 → 广播兜底号码组 + 时间线记录 ESCALATION_EXHAUSTED（每小时重复直至人工介入）
```

关键参数默认值：

| 严重度 | L1 超时 | L2 超时 | L3 超时 | L1 通道 |
| --- | --- | --- | --- | --- |
| SEV1 | 300s | 300s | 300s | phone + im + sms |
| SEV2 | 900s | 900s | 1800s | im + sms（认领超时后 phone） |
| SEV3 | 3600s | — | — | im |
| SEV4 | 不建升级任务（工作队列） | — | — | im |

### 6.3 值班班次状态机

`待生效(0) → 生效中(1) → 已完成(2)`；`已换班(3)` 仅可从 0/1 迁入，换班通过后生成新排班行并原行标记 3。交接时若存在未 `RESOLVED` 事故，交接接口强制要求 `open_incidents` 字段非空（防止事故被"交接失踪"）。

---

## 7. 关键代码示例

### 7.1 告警 Webhook 接收与事故自动创建（Go）

```go
// internal/webhook/alertmanager.go
func (h *WebhookHandler) Alertmanager(c *gin.Context) {
	var payload struct {
		Alerts []Alert `json:"alerts"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(400, gin.H{"code": 40000, "msg": "bad payload"})
		return
	}
	for _, a := range payload.Alerts {
		if a.Status != "firing" {
			continue // resolved 事件仅更新状态页组件健康
		}
		h.ingestSvc.Ingest(c.Request.Context(), a)
	}
	c.JSON(200, gin.H{"code": 0}) // 先落库再异步处理，快速返回防 Alertmanager 重试风暴
}

func (s *IngestService) Ingest(ctx context.Context, a Alert) {
	fp := fingerprint(a) // sha256(source + groupKey + alertname + service)
	// 1. 去重窗口：5 分钟内同指纹合并
	ok, err := s.Redis.SetNX(ctx, "oncall:fp:"+fp, 1, 5*time.Minute).Result()
	if err != nil {
		s.log.Warn("redis down, fallback to db dedup", zap.Error(err))
		ok = s.dbDedupFallback(ctx, fp) // Redis 故障降级：查 alert_event 近 5min
	}
	ev := s.saveAlertEvent(ctx, a, fp)
	if !ok { // 已存在：并入既有事故
		s.mergeIntoExisting(ctx, fp, ev)
		return
	}
	// 2. 严重度预判（规则引擎，配置中心可调）
	sev, category := s.ruleEngine.Evaluate(a) // label severity + 高峰策略加成
	if sev == "" || sev == "SEV4" {
		s.notifyIMOnly(ctx, ev) // 轻微告警仅 IM 通告，不建事故
		return
	}
	// 3. 创建事故 + 启动升级
	teamID := s.teamRouter.Route(a.Labels["team"], a.Labels["service"])
	inc, err := s.createIncident(ctx, CreateIncidentInput{
		Title:      a.Annotations["summary"],
		Severity:   sev, Category: category, TeamID: teamID,
		Source: "alertmanager", AlertEventID: ev.ID,
		Components: []string{a.Labels["component"]},
		PlaybookHint: a.Labels["playbook_hint"],
	})
	if err != nil {
		s.deadman.Notify(err) // 创建失败走死人开关兜底
		return
	}
	s.timeline.Append(ctx, inc.ID, "created", nil, "系统",
		fmt.Sprintf("自动创建事故，预判级别 %s（来源 %s）", sev, a.Source))
	if inc.Severity == "SEV1" || inc.Severity == "SEV2" {
		s.escalator.Start(ctx, inc)          // 启动升级定时器
		s.warroom.Create(ctx, inc)           // 自动创建战时群（SEV1）
		if inc.Severity == "SEV1" {
			s.statusPage.CreateDraft(ctx, inc) // 预生成公告草稿，COMMS 只需补口径
		}
	}
}
```

### 7.2 升级调度器（Redis ZSET + DB 兜底）

```go
// internal/escalator/worker.go —— 单实例每秒扫描，多实例以 DB 乐观锁抢任务
func (w *EscalationWorker) Loop(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			now := float64(time.Now().UnixMilli())
			ids, _ := w.Redis.ZRangeByScore(ctx, "oncall:esc:zset",
				&redis.ZRangeBy{Min: "0", Max: fmt.Sprintf("%f", now), Count: 50}).Result()
			for _, taskID := range ids {
				w.Redis.ZRem(ctx, "oncall:esc:zset", taskID)
				if err := w.OnDue(ctx, taskID); err != nil {
					w.log.Error("escalation due failed", zap.String("task", taskID), zap.Error(err))
					w.Redis.ZAdd(ctx, "oncall:esc:zset", redis.Z{ // 30s 后重试
						Score: float64(time.Now().Add(30 * time.Second).UnixMilli()),
						Member: taskID})
				}
			}
			// Redis 不可用时的 DB 轮询兜底由 standby worker 负责（部署两个，互备）
		}
	}
}

func (w *EscalationWorker) OnDue(ctx context.Context, taskID string) error {
	// DB 乐观锁抢占：防止双 worker 重复升级
	res, err := w.DB.ExecContext(ctx, `
		UPDATE escalation_task SET current_level = current_level + 1,
		       deadline_at = DATE_ADD(NOW(3), INTERVAL ? SECOND)
		WHERE id = ? AND status = 0`, nextTimeoutSec, taskID)
	if err != nil { return err }
	if n, _ := res.RowsAffected(); n == 0 {
		return nil // 已被认领/已结束/被其他 worker 处理
	}
	task := w.load(ctx, taskID)
	if task.CurrentLevel > w.maxLevel(task.PolicyID) {
		return w.roundRepeatOrExhausted(ctx, task) // 重复轮次或广播兜底
	}
	members := w.resolveTargets(ctx, task) // 排班表实时取人：L2=备班+值班经理
	for _, m := range members {
		w.notifier.Notify(ctx, m, task.IncidentID, channelsFor(task.CurrentLevel))
	}
	w.timeline.Append(ctx, task.IncidentID, "escalated", nil, "系统",
		fmt.Sprintf("超时未认领，升级至 L%d，通知 %s", task.CurrentLevel, names(members)))
	return nil
}

func (w *EscalationWorker) Start(ctx context.Context, inc *Incident) {
	lv1 := w.firstLevel(inc.TeamID, inc.Severity)
	taskID := w.createTask(ctx, inc.ID, lv1)
	w.Redis.ZAdd(ctx, "oncall:esc:zset",
		redis.Z{Score: float64(lv1.Deadline.UnixMilli()), Member: taskID})
	w.notifyLevel(ctx, taskID, 1) // 立即通知 L1
}
```

### 7.3 排班生成器（轮换 + 约束，Python）

```python
# scripts/oncall_schedule_generator.py
from datetime import date, timedelta
from zhdate import ZhDate  # 或使用预置节假日表，避免农历依赖复杂化

HOLIDAYS_2026 = {"2026-01-01", "2026-02-16", ..., "2026-10-01"}  # 配置中心维护
EXAM_FREEZE = (date(2026, 5, 8), date(2026, 6, 8))               # 高考冻结期：双班

def generate(team, weeks=8, start=date.today()):
    """轮换生成排班：公平性约束 + 连班上限 + 冻结期双班"""
    roster = [m for m in team.members if m.active]          # 按 order 排序
    cursor, schedule = 0, []
    streak = {}                                              # member_id -> 连续班次
    d = start
    while d < start + timedelta(weeks=7):
        is_holiday = d.isoformat() in HOLIDAYS_2026 or d.weekday() >= 5
        shift_codes = ["weekend" if is_holiday else "weekday-day"]
        if in_freeze(d, EXAM_FREEZE):
            shift_codes.append("weekday-night")              # 冻结期加夜班双值守
        for sc in shift_codes:
            # 选择下一人：跳过连班超限与请假成员
            for _ in range(len(roster)):
                cand = roster[cursor % len(roster)]
                cursor += 1
                if streak.get(cand.id, 0) < cand.max_consecutive_shifts and not cand.on_leave(d):
                    break
            streak = {k: (v + 1 if k == cand.id else 0) for k, v in streak.items()}
            schedule.append(make_row(team, d, sc, primary=cand,
                                     secondary=team.manager_of_week(d)))
        d += timedelta(days=1)
    return schedule  # 写库 upsert：uk(team_id, shift_date, shift_id) 幂等

def validate_gap(schedule):
    """上线前校验：禁止排班空档（相邻班次 end < 下一班 start 即告警）"""
    gaps = [(a, b) for a, b in zip(schedule, schedule[1:])
            if b.start_at > a.end_at]
    assert not gaps, f"存在值班空档: {gaps}"   # 空档即阻断发布
```

### 7.4 认领回调（IM 机器人卡片）

```go
// IM 卡片按钮回调 → 最小路径认领（值班人手机一步完成）
func (h *BotHandler) OnAckCallback(c *gin.Context) {
	var cb struct{ IncidentNo, MemberID, Channel string }
	_ = c.ShouldBindJSON(&cb)
	// 非当值人认领：允许但 force 留痕
	res, err := h.incidentSvc.Ack(c, cb.IncidentNo, cb.MemberID, AckOpt{
		Via: cb.Channel, ForceIfNotOnDuty: true, // ONC-403-01 语义
	})
	if errors.Is(err, ErrAlreadyAcked) {
		c.JSON(200, gin.H{"code": 0, "msg": "已被 " + res.AckedBy + " 认领"}) // 竞态友好
		return
	}
	h.bot.ReplyCard(c, fmt.Sprintf("✅ %s 已认领 %s（耗时 %ds），预案入口：%s",
		res.AckName, cb.IncidentNo, res.LatencySec, res.PlaybookURL))
}
```

### 7.5 状态页静态化与 App 公告联动

```python
# worker/status_page_publisher.py
def publish_update(sp_incident, update):
    if update.stage not in ("investigating", "identified", "monitoring", "resolved"):
        raise ValueError("invalid stage")
    # 1) 落库置 published
    repo.publish(update)
    # 2) 状态页静态化：独立对象桶 + 独立CDN（与主站隔离），失败重试 3 次后告警
    html = render("status.html", components=repo.component_health(),
                  incidents=repo.active_sp_incidents())
    for attempt in range(3):
        if cdn.publish(html, key="status/index.html"):
            break
        sleep(2 ** attempt)
    else:
        notify_ops("状态页发布失败", sp_incident.incident_id)
    # 3) 用户侧触达：调用通知中心“系统公告”接口（走运营弹窗/公告位，不做推送轰炸）
    if "app_banner" in update.publish_channels:
        notice_center.publish_system_banner(
            audience="all", title=sp_incident.banner_text, body=update.body,
            expire_at=sp_incident.eta_resolve or default_eta())
    # 4) 客服口径同步：写入客服知识库“当前故障公告”，坐席与AI客服自动引用
    kb.upsert("incident-" + sp_incident.incident_id, build_faq(update))
```

---

## 8. 内部触达通道矩阵与降级链

| 通道 | 用途 | 失败降级 |
| --- | --- | --- |
| 语音电话（按 1 确认接警，按 2 转人工） | SEV1 全级、SEV2 L2+ | 运营商 A → 运营商 B → 短信轰炸 + IM `@手机号` |
| IM 机器人（飞书/钉钉）卡片 | 所有级别首选；认领按钮 | 主平台 → 备用平台 → 短信带认领短链 |
| 短信（带认领短链） | 补充通道 | 通道失败计入 notified_log，升级逻辑不依赖单通道成功 |

约束：
1. **升级判定只看"是否认领"，不看"通知是否成功"**——某通道失败不阻塞升级，只记日志并触发通道告警，避免通知故障吞掉升级。
2. 同一人 15 分钟内电话不超过 3 通（防骚扰熔断），但 SEV1 广播兜底不受限。
3. 所有通知内容脱敏：不携带用户数据，仅含指标摘要与系统名（对齐《服务端-数据脱敏规则引擎》）。

---

## 9. 状态页与用户公告规范

1. **组件健康模型**：`operational / degraded / partial_outage / major_outage / maintenance` 五态；组件状态既可被事故联动修改，也可被值班手动覆盖（覆盖留痕）。
2. **公告阶段模板**（多轮更新，禁止只发一条就沉默）：
   - investigating：`我们监测到【组件】可能出现异常，正在紧急排查，影响范围为…。给您带来不便深表歉意。`
   - identified：`问题原因已定位（可脱敏描述），正在实施修复，预计 …`
   - monitoring：`修复措施已生效，正在观察稳定性。`
   - resolved：`问题已于 HH:MM 恢复，持续 N 分钟，原因与改进措施将在复盘后公示。`（SEV1 须公示复盘摘要，兑现"透明可信"）
3. **未成年人产品语气要求**：公告措辞避免制造学习焦虑（不出现"您的学习计划将中断无法恢复"类表述），面向学生的文案与面向家长的文案分版（家长版附学习数据不受影响的说明）。
4. **App 内触达优先级**：开屏公告（SEV1）> 首页 Banner（SEV2）> 仅状态页（SEV3/4），复用运营弹窗引擎的频控，防止公告叠加骚扰。

---

## 10. 错误处理与容错设计

| # | 故障场景 | 处理策略 |
| --- | --- | --- |
| 10.1 | Webhook 重复投递 | fingerprint 幂等；Alertmanager 重试不产生重复事故 |
| 10.2 | 告警风暴（如机房抖动引发 200+ 告警） | 按 `(team, category, 5min)` 聚合为单一"风暴事故"，时间线折叠展示；聚合事故自动降级通知频率；联动告警体系抑制规则 |
| 10.3 | 通知全通道失败 | 升级逻辑不依赖通道；通道健康自身有探活，连续失败即触发元告警（走独立短信网关直发 OPS_ADMIN） |
| 10.4 | 排班空档（换班审批悬空、名册不足） | 排班发布前强制 `validate_gap`；每日 08:00 巡检未来 72h 排班，空档即告警给值班经理；名册 `<2` 活跃成员的团队禁止发布排班 |
| 10.5 | 调度服务自身宕机（元问题） | ① 双实例部署；② 心跳缺失 > 2min 触发"死人开关"：Alertmanager 备用路由直接电话广播预置号码组（不经过本服务）；③ 状态页退化为"最后已知状态 + 手动更新开关" |
| 10.6 | MySQL 不可用 | 事故核心字段冗余写 Redis（AOF），恢复后回放；期间认领走 IM 回调内存态 + 异步补录 |
| 10.7 | 时钟/时区错乱 | 全链路 UTC 存储；排班计算显式 `Asia/Shanghai`；跨夏令时无影响（国内无夏令时，海外成员界面本地化显示） |
| 10.8 | 误关事故（未恢复即 resolve） | MITIGATED→RESOLVED 需 10min 观察期（可跳过但留痕）；regress 回退自动重开并升级一级通知 |
| 10.9 | 恶意/误操作关闭 SEV1 | 二次确认 + 仅 IC/值班经理可关闭 + 审计日志 |
| 10.10 | 升级任务泄漏（事故已结束但定时器仍在） | 终态写入时同步 ZREM + task 置 4；每日对账 `escalation_task(status=0)` 与活跃事故集合 diff，孤儿任务自动终结 |

---

## 11. 监控与自身可观测性

本服务自身暴露指标（纳入统一监控，标签：`team/severity`）：

| 指标 | 类型 | 告警阈值 |
| --- | --- | --- |
| `incident_webhook_lag_seconds` | Histogram | p95 > 5s（告警积压） |
| `escalation_task_pending` | Gauge | > 0 且最老任务超 deadline 60s（调度器僵死，元告警） |
| `notify_channel_fail_total{channel}` | Counter | 5min 失败率 > 20% |
| `incident_create_total{source,sev}` | Counter | 突增 5 倍 → 疑似告警风暴 |
| `oncall_schedule_gap_hours` | Gauge（巡检任务产出） | > 0 即告警 |
| `svc_heartbeat` | Gauge | 缺失 2min 触发死人开关 |

值班质量报表（季度，用于排班优化与绩效参考，不做单次惩罚）：认领率、平均 MTTA、换班率、复盘改进项完成率。

---

## 12. 安全与权限

1. 角色矩阵：`OPS_ONCALL`（认领/时间线/换班）、`OPS_MANAGER`（审批/公告发布/强制操作）、`OPS_ADMIN`（排班/策略/预案管理）；RBC 挂接《权限管理与角色访问控制》。
2. 全部管理操作审计：`who/when/what/before→after` 写审计日志服务；分级调整与公告发布为必审项。
3. 电话号码 AES 加密存储，展示层脱敏（`+86138****1234`）；IM webhook 定期轮转（对齐《服务端密钥管理与敏感配置安全策略》）。
4. Webhook 入口：内网网段 + HMAC-SHA256 签名（`X-Signature`，时间戳防重放，容差 5min）。
5. 状态页公开接口只暴露组件状态与已发布公告，严禁泄漏内部服务名、拓扑、指标数值。

---

## 13. 实施路线

| 齐阶段 | 范围 | 验收标准 |
| --- | --- | --- |
| MVP（2 周） | 手动排班表 + IM 认领 + 电话升级（固定顺序）+ incident 表 + 时间线 | 任意 SEV1 演练：5min 内电话触达、10min 内认领 |
| V1（+3 周） | 自动排班生成/换班审批、升级策略配置化、状态页 H5、App Banner 公告、指标日报 | 换班全流程线上化；状态页 30min 公告达标率 ≥95% |
| V2（+4 周） | 战时群自动创建、告警风暴聚合、死人开关、与自愈引擎/SLO/复盘引擎全链路自动衔接、月度 GameDay 演练机制 | 演练注入 10 类故障（含调度服务自身宕机）100% 走通预案 |

GameDay 演练（配合混沌工程平台）：每月一次，从预案库随机抽取场景注入，验证 MTTA/MTTR 与预案有效性，演练结果自动生成时间线并计入复盘。

---

## 14. 附录 A：人工应急预案模板（MANUAL-PB-005 示例骨架）

```markdown
# MANUAL-PB-005 疑似数据泄露应急预案（SEV1）
## 1. 判定（5 分钟内）
- 证据类型：异常导出日志 / 外部泄露情报 / 内部误配置发现
- 影响数据分级：是否含未成年人个人信息（姓名/学校/对话记录/学习数据）
## 2. 止血（并行）
- [ ] 关闭泄露入口（API/导出/分享链接），必要时整服务只读
- [ ] 吊销相关凭据与 Token（密钥管理系统一键轮转）
- [ ] 保全证据：日志快照、DB binlog、对象存储访问记录 → 只读归档桶
## 3. 上报（法务合规主导，本系统仅编排与留痕）
- [ ] 15min 内通知：安全负责人 + 法务 + DPO；拉入战时群
- [ ] 监管与个人告知：按法务合规评估执行（时限以最新法规与公司政策为准）
## 4. 用户侧
- [ ] 状态页 SEV1 公告（口径由法务确认后发布）
- [ ] 如需强制下线/改密：通知中心全量公告 + 登录态失效策略
## 5. 收口
- [ ] 置 MITIGATED → 等待法务确认后 RESOLVED
- [ ] 强制复盘（含安全专项复盘），改进项录入跟踪
```

## 15. 附录 B：与相关文档的衔接清单

| 衔接点 | 方向 | 契约 |
| --- | --- | --- |
| Alertmanager → 本服务 | 入 | Webhook + HMAC；label 约定 `severity/team/component/playbook_hint` |
| 自愈引擎 → 本服务 | 入 | `POST /internal/webhooks/selfheal`，`need_human=true` 或 playbook 执行失败 |
| SLO 平台 → 本服务 | 入 | burn rate 超阈事件（fast/slow burn 两档分别映射 SEV2/SEV3） |
| 本服务 → 通知中心 | 出 | SEV1/2 用户公告（系统公告/Banner），幂等键 `incident-{id}-update-{n}` |
| 本服务 → 复盘引擎 | 出 | `RESOLVED` 后创建复盘任务；回写 `postmortem_id` |
| 本服务 → 客服知识库 | 出 | 故障公告同步（坐席/AI 客服口径） |
| 运维工作台 → 本服务 | UI | 排班/值班台/事故/状态页四个管理页面挂载 |
```
