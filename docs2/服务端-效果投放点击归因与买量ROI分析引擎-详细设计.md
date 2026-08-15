# 服务端 - 效果投放点击归因与买量 ROI 分析引擎 - 详细设计

> 模块代号：`attrib-svc`（归属 growth 域）
> 文档版本：v1.0
> 关联原始设计：《启硕-PrimeTop-全学段AI辅助学习软件项目设计文档》§12.5 运营迭代（获客与增长）、§16.3 商业指标（免费→会员转化率、单用户 AI 调用成本、付费用户平均收入）、§14.2 研发流程建议（数据复盘：活跃、留存、付费）、§8.7 安全与合规架构（数据最小化采集）
> 补缺说明：买量归因链路是增长基建中**被两篇既有文档互相推诿的空白**——《客户端-多渠道打包与国内应用商店上架交付体系》§6.3 明确声明"渠道号仅是安装渠道信号，归因规则的最终裁决方为《服务端-用户转化漏斗分析与增长归因引擎》"，但该引擎实际只覆盖**产品内多触点归因模型**（首次/末次/线性/时间衰减/马尔可夫链），对**外部付费广告点击**的监测链接、设备标识匹配、归因窗口裁决、oCPA 转化事件回传、买量消耗对账与 ROI 报表**均为零设计**；《分享与社交裂变系统》《服务端-统一短链服务与深链接跳转编排引擎》覆盖自然量链接渠道，本引擎与其在"统一归因裁决中心"处汇合。本文档补齐付费投放侧整条链路，并落地《多渠道打包》声明的信号合并裁决规则。
> 关联细化文档：《客户端-多渠道打包与国内应用商店上架交付体系》《服务端-用户转化漏斗分析与增长归因引擎》《服务端-统一短链服务与深链接跳转编排引擎》《分享与社交裂变系统》《设备指纹与反作弊风控引擎》《客户端埋点事件体系与数据采集规范》《服务端-用户生命周期价值预测与会员升级意向评分引擎》《服务端-学习数据实时聚合与统计预计算引擎》《服务端-存储资源统一生命周期管理与过期数据自动清理引擎》《服务端-审计日志与操作追溯系统》《权限管理与角色访问控制》《服务端-统一响应封装与分页查询规范》《服务端-统一业务异常码与错误分类体系》《服务端-统一延迟任务调度与到期事件触发引擎》

## 1. 模块概述

### 1.1 定位

效果投放点击归因与买量 ROI 分析引擎（Attribution & Paid-User-Acquisition ROI Engine）是 PrimeTop 增长体系的**渠道裁决与买量度量中枢**：

1. **安装级归因唯一裁决方**：当一名新用户首次打开 App 时，判定该激活来自哪一个渠道（付费广告点击 / 分享邀请链接 / 应用商店自然安装 / 其他自然量）。渠道判定结果作为用户增长的**第一维度口径**，供漏斗分析、LTV 预测、运营驾驶舱、财务复盘统一引用，避免各系统各自归因导致口径打架。
2. **付费投放度量闭环**：对接巨量引擎、腾讯广告、百度营销、快手磁力引擎等效果广告平台与华为/小米商店 oCPD 竞价，完成"广告点击监测 → 激活匹配 → 转化事件回传（oCPA）→ 消耗采集 → CAC/LTV/ROI 报表"的完整链路，让市场团队可以按渠道/计划/创意粒度判断买量质量并决策预算。
3. **反作弊守门员**：识别点击泛滥（Click Flooding）、点击注入（Click Injection）、CTIT 分布异常等归因欺诈手法，将作弊流量排除在归因与回传之外，保护投放预算不被虚假激活吞噬。

**教育产品合规边界（决定本引擎与普通商业 App 归因的根本差异）**：

- PrimeTop 面向未成年人，**App 内不做任何广告变现**，本引擎只度量"用户从哪里来"，绝不参与"给用户推什么广告"的定向数据输出；回传给广告平台的转化事件仅包含**匿名化转化标识**，不含学生任何个人身份信息。
- 广告设备标识（OAID/CAID/IDFA/GAID）的采集遵循《客户端-多渠道打包》§隐私合规：用户同意隐私政策后方可读取，本引擎**只存哈希**，原文绝不落库、不留日志。
- 未满 14 周岁用户的激活数据仅用于渠道统计聚合，不参与任何个体级广告定向类输出。

### 1.2 与其他模块的关系

| 模块 | 关系 |
| --- | --- |
| 客户端-多渠道打包与国内应用商店上架交付体系 | 提供安装渠道信号 `install_channel`（渠道号）与首次激活幂等上报；本引擎是其声明的"归因裁决规则"的落地实现方 |
| 分享与社交裂变系统 / 统一短链服务 | 产生自然量链接渠道信号 `link_channel`（promo 短链参数）；本引擎在激活时与付费点击、安装渠道信号统一裁决 |
| 客户端埋点事件体系 | 激活（app_first_open）、注册（user_register）、付费（order_paid）等事件是归因匹配与回传的触发源，走统一埋点通道进入本引擎 |
| 设备指纹与反作弊风控引擎 | 提供设备 ID 规范化（OAID/CAID/AndroidID 获取与哈希）与设备黑名单；点击反作弊特征与其共享画像 |
| 用户转化漏斗分析与增长归因引擎 | 上游口径依赖：本引擎产出 install 级渠道归属（单触点、确定性），漏斗引擎在其上做产品内多触点模型与漏斗报表；两者通过 `attribution_id` 关联 |
| 用户生命周期价值预测与会员升级意向评分 | 消费其 LTV 预测值填充渠道 ROI 报表的预测列（LTV_30d_pred 等） |
| 支付服务与订单管理 / 统一计费账单中心 | 付费事件的交易金额来源（去退款、去道具冲正后的净收入），用于渠道收入与回传金额 |
| 学习数据实时聚合与统计预计算引擎 | 次留/7 留/30 留等留存指标按渠道维度预计算，本引擎取数拼装 ROI 报表 |
| 统一延迟任务调度引擎 | 迟到点击补归因扫描、回传死信重派、消耗对账差异提醒等定时/延迟任务 |
| 存储资源生命周期管理 | 点击日志、回传明细保留 180 天后归档清理，规则登记到其生命周期清单 |
| 审计日志与操作追溯系统 | 归因窗口调整、回传扣量规则变更、消耗手工修正等敏感操作全量审计 |
| 权限管理与角色访问控制 | `/admin/v1/ads/*` 走管理后台 RBAC（增长运营/数据分析/管理员分级） |
| 管理后台-运营活动与营销推广配置工作台 | 本引擎的管理界面宿主，渠道管理/链接生成/报表查看嵌入该工作台 |

### 1.3 设计原则

1. **裁决唯一**：一个激活有且仅有一条归因记录（`attribution_record` 以设备+App 维度唯一约束），所有下游系统引用该结果，禁止二次裁决。
2. **监测无感**：点击监测端点无论内部任何故障，都必须快速返回 302 跳转——监测链路绝不能成为用户落地商店的障碍；日志走异步管道，洪峰可丢弃排序靠后的低价值信号（如展示型曝光），点击级信号靠 Kafka 持久化兜底。
3. **回传最终一致**：转化回传失败指数退避重试、死信转人工，事件绝不静默丢失；回传以广告平台的确认响应（200 + 平台 code=0）为完成标志。
4. **作弊前置过滤**：可疑点击在**归因阶段**即被隔离（不参与匹配），而非归因后再剔除——保证回传给广告平台的转化都是被信任的，从源头抑制 oCPA 模型被污染。
5. **设备标识哈希化**：所有广告设备标识以 HMAC-SHA256 定长哈希存储，密钥由密钥管理服务托管轮换（历史哈希保留旧密钥版本号以保持可匹配）。
6. **幂等**：点击以 `click_id` 全局唯一；激活归因以 `(app_id, device_hash)` 唯一；回传以 `(event_id, platform)` 唯一。
7. **口径可解释**：每条归因记录落库 `rule_version`（裁决规则版本）与 `matched_click_id`，任何一条归因结果可回放解释"为什么归到了这个渠道"。

### 1.4 业务边界与术语

| 术语 | 定义 |
| --- | --- |
| 效果广告平台 | 巨量引擎、腾讯广告、百度营销、快手磁力等按转化出价的投放平台 |
| oCPD / oCPA | 应用商店按下载出价 / 广告平台按行为出价的智能投放模式，依赖转化数据回传 |
| 监测链接（Track Link） | 投放平台素材挂载的本方 URL，用户点击广告时先请求本方记录点击，再 302 跳转落地页/商店 |
| 宏参数（Macro） | 平台在请求监测链接时动态替换的占位符，如 `__OAID__`、`__IP__`、`__UA__`、`__CLICKID__` |
| CTIT | Click-To-Install Time，点击到激活的时间差，反作弊核心特征 |
| 归因窗口 | 点击/展示发生后允许归因到激活的时间范围（默认点击 7 天、展示 24 小时，渠道级可配置） |
| 点击泛滥 | 作弊者制造海量点击"碰瓷"自然激活，命中率随点击量上升 |
| 点击注入 | Android 恶意 SDK 在用户安装瞬间补发点击窃取归因（客户端侧防护配合） |
| 扣量 | 本文中特指"作弊流量过滤后不回传"，是反作弊的合法手段；**严禁**对真实转化做恶意扣量 |

本引擎负责：监测链接生成与点击采集、点击反作弊、激活归因裁决、转化事件回传、投放消耗采集与对账、渠道 ROI 报表。

本引擎不负责：广告投放计划管理与出价（在广告平台侧）、App 内广告变现（产品无此形态）、自然量裂变规则与奖励发放（裂变系统）、产品内多触点归因模型计算（转化漏斗引擎）、留存/收入等指标底层计算（实时聚合引擎/计费中心）。

## 2. 领域模型与信号体系

### 2.1 渠道层级模型

```text
ad_platform（投放平台）
  └── ad_account（投放账户，一个平台可多账户）
        └── track_link（监测链接，一条链接对应一组 campaign/adgroup/creative 参数）
              └── click_log（点击明细，ClickHouse）
attribution_record（激活归因，一对一指向某 click_log 或某 install_channel/link_channel 信号）
```

渠道层级与业务系统的映射约定：

| 层级 | 字段 | 说明 |
| --- | --- | --- |
| L1 渠道大类 | `channel_type` | paid（付费）/ link（裂变链接）/ store（商店渠道包）/ organic（自然） |
| L2 投放平台 | `platform_code` | oceanengine / tencent / baidu / kuaishou / huawei_ocpd / xiaomi_ocpd / … |
| L3 账户 | `account_id` | 投放账户编号（本方登记） |
| L4 计划/广告组/创意 | `campaign_id / adgroup_id / creative_id` | 由监测链接宏参数带回，透传给报表 |

### 2.2 归因信号与统一裁决优先级

一次首启激活可能同时携带多路信号，统一在本引擎裁决（落地《多渠道打包》§6.3 声明的合并原则并补全付费部分）：

| 优先级 | 信号 | 来源 | 生效条件 |
| --- | --- | --- | --- |
| P0 | 付费广告点击 | click_log 精确匹配 | 点击落在归因窗口内且未被判作弊 |
| P1 | 分享邀请/裂变链接渠道 | `link_channel`（promo 短链，激活前 7 天内点击过） | 裂变归因窗口固定 7 天（与《多渠道打包》§6.3 一致） |
| P2 | 商店安装渠道包 | `install_channel`（APK 渠道号 / 商店 referrer） | 无 P0/P1 信号时生效 |
| P3 | 自然量 | 无任何信号 | 兜底归为 organic |

裁决细则：

1. **付费优先于裂变**：用户先点了广告、安装前又点了好友分享链接，归付费渠道（买量口径不夸大：裂变带来的激活若被误归付费，会推高假 CAC；反向则会漏报。行业默认付费优先，本平台遵循）。
2. **窗口内多条付费点击**：取 **CTIT 最短** 的合规点击（Last Click 的改良：同窗口多点击时，离激活最近的点击归因权重最高，且要求 CTIT ≥ 10s 排除注入嫌疑）。
3. **精确优先于模糊**：设备 ID 精确匹配 > IP+UA+机型模糊匹配；模糊匹配仅当渠道开启 `allow_fuzzy` 时参与（商店 oCPD 默认开启，信息流平台默认关闭以控误归因）。
4. **重装不重归因**：同一设备 30 天内重复激活（卸载重装）不生成新归因记录，沿用首次归因结果并记录 `reinstall_flag`，避免刷量。

### 2.3 设备标识规范

| 标识字段 | 来源 | 存储 |
| --- | --- | --- |
| oaid_hash | 移动安全联盟 OAID（客户端同意后读取） | HMAC-SHA256(oaid, salt_v{n}) |
| caid_hash | 中国信通院 CAID（补充标识） | 同上 |
| gaid_hash / idfa_hash | Android Google Advertising ID / iOS IDFA（AT 授权后） | 同上 |
| android_id_hash | AndroidID（降级标识） | 同上 |
| ip / ua / model | 网络层原生信息 | 明文（对账与模糊匹配必需），180 天清理 |

匹配优先级：`oaid_hash > caid_hash > idfa_hash/gaid_hash > android_id_hash > (ip + ua 归一化 + model)`。

## 3. 总体架构

### 3.1 架构图

```text
  广告平台（巨量/腾讯/百度/快手/商店oCPD）          商店/裂变链接/渠道包
          │ 素材挂载监测链接                              │
          ▼                                             ▼
┌───────────────────┐   302跳转落地页    ┌─────────────────────────────┐
│  track-gateway     │──────────────────▶│  商店下载页 / App 内深链      │
│  GET /t/c          │                   └─────────────────────────────┘
│  ·宏参数解析        │
│  ·Redis限流/布隆    │
└────────┬──────────┘
         │ Kafka(topic: attrib.click.raw)
         ▼
┌───────────────────┐    反作弊特征    ┌──────────────────────┐
│  click-ingest      │◀───────────────▶│ 设备指纹与反作弊风控   │
│  ·清洗/归一化       │                └──────────────────────┘
│  ·作弊标记          │
└────────┬──────────┘
         ▼ ClickHouse: click_log
┌───────────────────────────────────────────────────────────────┐
│  attribution-core（归因裁决中心）                                │
│  ·激活事件（埋点 app_first_open）触发匹配                        │
│  ·信号裁决 P0>P1>P2>P3 → attribution_record(PG, 唯一约束)       │
└────────┬──────────────────────────────┬───────────────────────┘
         │ 归因结果                     │ 注册/次留/付费等转化事件
         ▼                             ▼
┌───────────────────┐          ┌───────────────────┐
│  postback-worker   │          │  转化漏斗/LTV 预测  │
│  ·oCPA 宏替换回传   │          │  （下游消费归因口径）│
│  ·指数退避/死信     │          └───────────────────┘
└───────────────────┘
         ▲
┌────────┴──────────┐   消耗API/手工导入   ┌───────────────────┐
│  spend-collector    │◀───────────────────│ 广告平台报表API/财务 │
│  ·消耗对账          │                    └───────────────────┘
└────────┬──────────┘
         ▼
   channel_daily_roi ──▶ /admin/v1/ads/roi-report（增长运营看板）
```

### 3.2 数据流

1. **点击流**：广告平台请求监测链接 → track-gateway 解析宏参数、限流、写 Kafka → click-ingest 清洗归一化 + 反作弊标记 → ClickHouse `click_log`（近实时，≤30s 可查）。
2. **激活流**：客户端首次打开（《多渠道打包》激活上报，携带 install_channel/link_channel/设备哈希）→ 埋点通道 `app_first_open` 事件 → attribution-core 同步匹配（SLA 200ms 内返回归因结果给客户端用于调试，超时转异步）→ 落 `attribution_record`。
3. **转化流**：注册/次留/付费事件 → 查 `attribution_record` → 付费渠道用户生成 `postback_task` → worker 宏替换调用平台 callback → 平台确认。
4. **消耗流**：每日 T+1 定时拉取平台消耗 API（无 API 的渠道用后台手工导入 Excel 模板）→ `spend_daily` → 与点击/激活/转化聚合出 `channel_daily_roi`。

### 3.3 容量预估

| 指标 | 预估（年） | 说明 |
| --- | --- | --- |
| 点击 QPS 峰值 | 3,000 | 投放放量期集中曝光；单条点击 JSON 约 1KB |
| 日均点击量 | 2000 万 | 买量为主，含部分曝光监测 |
| 日激活量 | 5-20 万 | 匹配查询按设备哈希点查，ClickHouse 主键索引足够 |
| 回传 QPS | <50 | 只对付费渠道激活回传激活/注册/付费事件 |

## 4. 数据模型设计

### 4.1 投放配置表（PostgreSQL，库：`growth_attrib`）

```sql
-- 投放平台字典
CREATE TABLE ad_platform (
    id            BIGSERIAL PRIMARY KEY,
    platform_code VARCHAR(32)  NOT NULL UNIQUE,       -- oceanengine/tencent/baidu/kuaishou/huawei_ocpd...
    platform_name VARCHAR(64)  NOT NULL,
    click_macro_map JSONB      NOT NULL,              -- 平台宏名 → 本方参数名映射
    postback_tpl  TEXT         NOT NULL,              -- 回传 URL 模板（含本方占位符）
    supports_ocpa BOOLEAN      NOT NULL DEFAULT TRUE,
    status        SMALLINT     NOT NULL DEFAULT 1,    -- 1启用 0停用
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 投放账户
CREATE TABLE ad_account (
    id            BIGSERIAL PRIMARY KEY,
    platform_id   BIGINT       NOT NULL REFERENCES ad_platform(id),
    account_no    VARCHAR(64)  NOT NULL,              -- 平台侧账户ID
    account_name  VARCHAR(128) NOT NULL,
    owner_uid     BIGINT       NOT NULL,              -- 负责人（内部用户ID）
    status        SMALLINT     NOT NULL DEFAULT 1,
    UNIQUE (platform_id, account_no)
);

-- 监测链接（一条链接 = 一组投放参数的监测入口）
CREATE TABLE track_link (
    id              BIGSERIAL PRIMARY KEY,
    link_code       VARCHAR(24)  NOT NULL UNIQUE,     -- 短码，用于 /t/c?l=xxx
    account_id      BIGINT       NOT NULL REFERENCES ad_account(id),
    campaign_id     VARCHAR(64)  NOT NULL,            -- 平台侧计划ID（宏带回，创建时手填或留占位）
    adgroup_id      VARCHAR(64)  DEFAULT NULL,
    creative_id     VARCHAR(64)  DEFAULT NULL,
    dest_url        TEXT         NOT NULL,            -- 302 目标（商店页/落地页/深链）
    attribution_window_hours INT NOT NULL DEFAULT 168, -- 归因窗口覆盖（小时），NULL走平台默认
    allow_fuzzy     BOOLEAN      NOT NULL DEFAULT FALSE,
    fraud_rule_ver  INT          NOT NULL DEFAULT 1,  -- 生效的反作弊规则版本
    status          SMALLINT     NOT NULL DEFAULT 1,  -- 1启用 0停用
    created_by      BIGINT       NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_window CHECK (attribution_window_hours BETWEEN 24 AND 720)
);
CREATE INDEX idx_track_link_account ON track_link(account_id, status);

-- 归因窗口与裁决规则（版本化配置，变更全量审计）
CREATE TABLE attribution_config (
    id              BIGSERIAL PRIMARY KEY,
    rule_version    INT          NOT NULL,
    default_click_window_hours INT NOT NULL DEFAULT 168,  -- 7天
    default_view_window_hours  INT NOT NULL DEFAULT 24,
    reinstall_hold_days         INT  NOT NULL DEFAULT 30,
    min_ctit_seconds            INT  NOT NULL DEFAULT 10, -- 低于10秒疑似注入
    arbitration_priority        JSONB NOT NULL,           -- ["paid","link","store","organic"]
    effective_from  TIMESTAMPTZ  NOT NULL,
    created_by      BIGINT       NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (rule_version)
);
```

### 4.2 点击日志（ClickHouse）

```sql
CREATE TABLE click_log
(
    click_id      String,           -- 全局唯一（snowflake）
    ts            DateTime,         -- 点击时间
    link_code     String,           -- 监测链接短码
    platform_code LowCardinality(String),
    account_id    UInt64,
    campaign_id   String,
    adgroup_id    String,
    creative_id   String,
    click_type    LowCardinality(String),   -- click / view（曝光）
    -- 设备标识（哈希；原文不落库）
    oaid_hash     String DEFAULT '',
    caid_hash     String DEFAULT '',
    gaid_hash     String DEFAULT '',
    idfa_hash     String DEFAULT '',
    android_id_hash String DEFAULT '',
    ip            String,
    ua            String,
    ua_norm       String DEFAULT '',  -- 归一化UA（去版本号）
    model         String DEFAULT '',
    os            LowCardinality(String),
    -- 反作弊
    fraud_flag    UInt8 DEFAULT 0,    -- 0合规 1疑似 2确认作弊
    fraud_rules   Array(String) DEFAULT [],  -- 命中的规则名
    -- 回传携带
    callback_params String DEFAULT '',  -- 平台宏原样保存（用于事件回传宏替换）
    clik_extra    String DEFAULT ''
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(ts)
ORDER BY (oaid_hash, ts)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;
-- 二级索引支撑按 ip/模糊匹配点查
ALTER TABLE click_log ADD INDEX idx_ip (ip) TYPE minmax GRANULARITY 4;
ALTER TABLE click_log ADD INDEX idx_caid (caid_hash) TYPE bloom_filter GRANULARITY 4;
-- TTL：180天（登记到存储生命周期引擎）
ALTER TABLE click_log MODIFY TTL ts + INTERVAL 180 DAY;
```

### 4.3 归因结果表（PostgreSQL，核心裁决产物）

```sql
CREATE TABLE attribution_record (
    id              BIGSERIAL PRIMARY KEY,
    app_id          VARCHAR(32)  NOT NULL DEFAULT 'primetop',
    device_hash     VARCHAR(64)  NOT NULL,        -- 主标识哈希（优先级最高的可用ID哈希）
    user_id         BIGINT       DEFAULT NULL,    -- 注册后回填（关联 student_uid）
    activated_at    TIMESTAMPTZ  NOT NULL,
    install_channel VARCHAR(64)  DEFAULT '',      -- 商店渠道号原始信号
    link_channel    VARCHAR(64)  DEFAULT '',      -- 裂变链接原始信号
    -- 裁决结果
    channel_type    VARCHAR(16)  NOT NULL,        -- paid/link/store/organic
    platform_code   VARCHAR(32)  DEFAULT NULL,
    account_id      BIGINT       DEFAULT NULL,
    campaign_id     VARCHAR(64)  DEFAULT NULL,
    adgroup_id      VARCHAR(64)  DEFAULT NULL,
    creative_id     VARCHAR(64)  DEFAULT NULL,
    matched_click_id VARCHAR(64) DEFAULT NULL,
    match_type      VARCHAR(16)  DEFAULT NULL,    -- oaid/caid/gaid/idfa/android_id/fuzzy_ip_ua
    ctit_seconds    INT          DEFAULT NULL,
    rule_version    INT          NOT NULL,
    status          SMALLINT     NOT NULL DEFAULT 0,  -- 0待补归因 1已归因 2作弊挂起
    reinstall_flag  BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uk_device_app UNIQUE (app_id, device_hash)   -- 一个设备一个App只归因一次
);
CREATE INDEX idx_attr_user ON attribution_record(user_id);
CREATE INDEX idx_attr_lookup ON attribution_record(platform_code, activated_at);
```

### 4.4 回传任务表（PostgreSQL）

```sql
CREATE TABLE postback_task (
    id              BIGSERIAL PRIMARY KEY,
    event_id        VARCHAR(64)  NOT NULL,     -- 幂等键：traceId/eventId
    attribution_id  BIGINT       NOT NULL REFERENCES attribution_record(id),
    platform_code   VARCHAR(32)  NOT NULL,
    event_type      VARCHAR(32)  NOT NULL,     -- activate/register/d1_retain/purchase
    event_value_cents BIGINT     DEFAULT 0,    -- purchase 时为净收入（分）
    event_ts        TIMESTAMPTZ  NOT NULL,
    callback_url    TEXT         NOT NULL,     -- 宏替换完成后的最终回传URL
    status          SMALLINT     NOT NULL DEFAULT 0,
    -- 0QUEUED 1SENT 2CONFIRMED 3FAILED_RETRY 4DEAD 5SKIPPED_FRAUD
    retry_count     INT          NOT NULL DEFAULT 0,
    next_retry_at   TIMESTAMPTZ  DEFAULT NULL,
    last_error      VARCHAR(512) DEFAULT NULL,
    platform_resp   VARCHAR(512) DEFAULT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uk_event_platform UNIQUE (event_id, platform_code, event_type)
);
CREATE INDEX idx_pb_status ON postback_task(status, next_retry_at);
```

### 4.5 消耗与 ROI 汇总

```sql
-- PostgreSQL：消耗（API 拉取 + 手工导入统一落表）
CREATE TABLE spend_daily (
    id            BIGSERIAL PRIMARY KEY,
    stat_date     DATE         NOT NULL,
    platform_code VARCHAR(32)  NOT NULL,
    account_id    BIGINT       NOT NULL,
    campaign_id   VARCHAR(64)  NOT NULL DEFAULT '',   -- 平台不支持计划级时为 ''（账户级）
    spend_cents   BIGINT       NOT NULL,
    source        SMALLINT     NOT NULL,      -- 1API自动 2手工导入 3手工修正
    batch_no      VARCHAR(64)  NOT NULL,      -- 导入批次（幂等）
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (stat_date, platform_code, account_id, campaign_id, batch_no)
);

-- ClickHouse：渠道日 ROI 聚合（T+1 由报表任务生成）
CREATE TABLE channel_daily_roi
(
    stat_date     Date,
    platform_code LowCardinality(String),
    account_id    UInt64,
    campaign_id   String,
    clicks        UInt64,
    valid_clicks  UInt64,      -- 剔除作弊
    activations   UInt64,      -- 归因激活
    registrations UInt64,
    d1_retained   UInt64,
    d7_retained   UInt64,
    d30_retained  UInt64,
    pay_users     UInt64,
    revenue_cents UInt64,      -- 净收入
    spend_cents   UInt64,
    cac_cents     UInt64 MATERIALIZED if(activations = 0, 0, cast(round(spend_cents / activations), 'UInt64')),
    roi           Float64 MATERIALIZED if(spend_cents = 0, 0, round(revenue_cents / spend_cents, 4)),
    ltv30_pred_cents UInt64 DEFAULT 0    -- LTV预测引擎填充
)
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(stat_date)
ORDER BY (stat_date, platform_code, account_id, campaign_id);
```

## 5. 点击监测服务设计

### 5.1 监测链接与宏参数

监测链接格式：`https://t.primetop.cn/t/c?l={link_code}&oaid=__OAID__&caid=__CAID__&ip=__IP__&ua=__UA__&model=__MODEL__&os=__OS__&clickid=__CLICKID__&callback=__CALLBACK__`

各平台宏名差异由 `ad_platform.click_macro_map` 配置抹平，例如：

```jsonc
// oceanengine.click_macro_map（示例）
{
  "__OAID__":   "oaid",
  "__IP__":     "ip",
  "__UA__":     "ua",
  "__CLICKID__": "clickid",
  "__CALLBACK__": "callback"   // 平台事件回传宏，URL编码后透传
}
```

生成流程：增长运营在管理工作台选择账户 → 填写计划/广告组/创意 ID 与落地 URL → 系统拼装对应平台的宏模板 → 生成短码 `link_code` → 返回完整监测链接投放到平台。

### 5.2 监测端点流程

1. `GET /t/c` 校验 `link_code` 有效且 `status=1`，无效直接 302 到兜底落地页（不报错页，避免平台审核判定监测异常）。
2. 解析宏参数 → 设备 ID 即时 HMAC 哈希（**原文不进日志**）→ UA 归一化。
3. Redis 令牌桶限流（单 IP 200 QPS，超限直接 302，点击丢弃计数）；布隆过滤器预判"全新设备"以减轻后续反作弊压力（可选优化）。
4. 组装 `click_id`（snowflake）+ 消息体投递 Kafka `attrib.click.raw`。
5. 立即 `302 Location: dest_url`。

### 5.3 洪峰保护与降级

| 故障 | 行为 |
| --- | --- |
| Kafka 不可用 | 本地内存有界队列缓冲 30s；仍失败则丢弃 `view` 型、保留 `click` 型写本地磁盘队列由 click-ingest 重放；端点 302 永不阻塞 |
| Redis 不可用 | 跳过限流（短暂放行），仅记录监控告警 |
| ClickHouse 写入堆积 | click-ingest 消费侧降级：view 型消息直接丢弃，click 型持久积压在 Kafka（保留 72h） |

### 5.4 关键代码（监测过滤器，Java/Spring）

```java
@RestController
@RequestMapping("/t")
public class TrackClickController {

    private static final String FALLBACK_URL = "https://www.primetop.cn/download";

    private final TrackLinkCache linkCache;        // Caffeine+Redis 二级缓存
    private final RateLimiter rateLimiter;         // Redis Lua 令牌桶
    private final ClickProducer clickProducer;     // Kafka
    private final Hasher hasher;                   // HMAC-SHA256

    @GetMapping("/c")
    public ResponseEntity<Void> track(@RequestParam String l,
                                      HttpServletRequest req) {
        String dest = FALLBACK_URL;
        try {
            TrackLink link = linkCache.get(l);              // null → 兜底跳转
            if (link != null && link.getStatus() == 1) {
                dest = link.getDestUrl();
                String ip = ClientIpResolver.resolve(req);
                if (rateLimiter.tryAcquire("click:" + ip, 200, 1)) {
                    ClickMsg msg = ClickMsg.builder()
                        .clickId(IdGenerator.next())
                        .ts(Instant.now())
                        .linkCode(l)
                        .platformCode(link.getPlatformCode())
                        .accountId(link.getAccountId())
                        .campaignId(link.getCampaignId())
                        .adgroupId(link.getAdgroupId())
                        .creativeId(link.getCreativeId())
                        .clickType("click")
                        .oaidHash(hasher.hash(req.getParameter("oaid")))
                        .caidHash(hasher.hash(req.getParameter("caid")))
                        .gaidHash(hasher.hash(req.getParameter("gaid")))
                        .idfaHash(hasher.hash(req.getParameter("idfa")))
                        .androidIdHash(hasher.hash(req.getParameter("androidid")))
                        .ip(ip)
                        .ua(req.getParameter("ua"))
                        .model(req.getParameter("model"))
                        .os(req.getParameter("os"))
                        .callbackParams(req.getParameter("callback"))  // 原样保存
                        .build();
                    clickProducer.sendAsync(msg);              // 异步，失败走本地缓冲
                }
            }
        } catch (Exception e) {
            log.warn("track error, link={}, fallback 302", l, e);   // 绝不抛给用户
        }
        return ResponseEntity.status(302)
            .location(URI.create(dest))
            .cacheControl(CacheControl.noStore())
            .build();
    }
}
```

Redis 令牌桶 Lua（限流，与《服务端-统一限流熔断与流量防护体系》组件复用）：

```lua
-- KEYS[1]=限流键 KEYS[2]=容量 ARGV[1]=速率/秒 ARGV[2]=当前秒 ARGV[3]=请求数
local rate  = tonumber(ARGV[1])
local cap   = tonumber(KEYS[2])
local now   = tonumber(ARGV[2])
local n     = tonumber(ARGV[3])
local b = redis.call('HMGET', KEYS[1], 'tok', 'ts')
local tok = tonumber(b[1]) or cap
local last = tonumber(b[2]) or now
tok = math.min(cap, tok + (now - last) * rate)
if tok >= n then
  redis.call('HMSET', KEYS[1], 'tok', tok - n, 'ts', now)
  redis.call('EXPIRE', KEYS[1], 120)
  return 1
end
redis.call('HMSET', KEYS[1], 'tok', tok, 'ts', now)
redis.call('EXPIRE', KEYS[1], 120)
return 0
```

## 6. 激活归因匹配引擎

### 6.1 触发时机

客户端按《客户端-多渠道打包》§首次激活上报（携带 install_channel、link_channel、设备哈希、本地点击时间戳）产生埋点事件 `app_first_open` → 埋点管线投递 `attrib.activate` 内部事件 → attribution-core 消费。同步返回调试用归因结果（≤200ms），超时转异步补偿，**不阻塞客户端启动流程**。

### 6.2 匹配算法

```text
输入：activated_at, device_hashes{oaids:..,caid:..,...}, ip, ua_norm, model,
      install_channel, link_channel, app_id
流程：
1 重装检查：attribution_record 存在 (app_id, device_hash)？
   └ 存在 → reinstall_flag=true，沿用原归因，结束（记录重装事件）
2 付费点击匹配（P0）：
   2.1 对每个可用设备哈希 h，查 ClickHouse：
       SELECT * FROM click_log
       WHERE {h} <> '' AND {h_col} = {h}          -- 对应哈希列
         AND ts BETWEEN activated_at - window_h AND activated_at
         AND click_type='click' AND fraud_flag=0
       ORDER BY ts DESC LIMIT 50
   2.2 候选中选 ctit_seconds 最小且 ≥ min_ctit_seconds 的一条
   2.3 无精确命中且 allow_fuzzy=true → (ip, ua_norm, model) 模糊匹配
       （要求同 IP 当日点击数 ≤ 20，防止大代理 IP 误归因）
3 裂变链接（P1）：link_channel 非空且其短链点击在激活前 7 天内 → channel_type=link
4 商店渠道（P2）：install_channel 非空且非 promo_ 前缀 → channel_type=store
5 兜底：channel_type=organic
输出：INSERT attribution_record（唯一约束兜底并发），status=1 或（命中疑似作弊）2
```

窗口取值：`link.attribution_window_hours`（监测链接覆盖）> `attribution_config.default_click_window_hours`（当前生效版本）。

### 6.3 反作弊过滤

click-ingest 消费时执行（规则版本化 `fraud_rule_ver`，命中即打 `fraud_rules` 标签）：

| 规则 | 判定 | 处置 |
| --- | --- | --- |
| F1 点击泛滥-设备 | 同设备哈希当日点击 > 50 | 后续点击 fraud_flag=1（疑似），>200 置 2 |
| F2 点击泛滥-IP | 同 IP 当日点击 > 500 | 同上阶梯标记 |
| F3 CTIT 异常 | 激活匹配时 CTIT < 10s（注入嫌疑）或 > 窗口×1.5 | 该点击不参与归因；激活降级下一优先级信号 |
| F4 设备黑名单 | 命中风控引擎设备黑名单（模拟器/群控特征） | fraud_flag=2，不归因不回传 |
| F5 UA/IP 特征 | 空 UA 占比、IDC IP 段、UA 与 OS 声明矛盾 | fraud_flag=1，仅统计观察 |

被标记点击：`fraud_flag=1` 不参与归因但保留报表"疑似作弊点击"列；`fraud_flag=2` 完全隔离。归因挂起（status=2）的激活 24h 后由延迟任务复审，复审仍作弊则终判 organic 并计数告警。

### 6.4 迟到点击补归因

Kafka 积压/网络延迟导致激活先于点击入库：`status=0`（未匹配到付费点击且无其他强信号）的记录保留 24h，延迟任务每 10 分钟对 `activated_at ∈ 近24h` 且 `status=0 AND channel_type='organic'` 的记录重跑 §6.2 第 2 步；命中则更新归因（`rule_version` 记录补归因标记），并正常生成回传任务。**已生成回传的记录不重归因**（避免平台侧重复转化）。

### 6.5 关键代码（匹配服务）

```java
@Service
public class AttributionMatchService {

    private final ClickHouseMapper ch;
    private final AttributionConfigService cfg;      // 当前生效 rule_version
    private final TrackLinkCache linkCache;
    private final PostbackProducer postbackProducer;

    @KafkaListener(topics = "attrib.activate", groupId = "attrib-core")
    public void onActivate(ActivateEvent evt) {
        AttributionConfig rule = cfg.current();
        // 1. 重装幂等
        var exist = repo.find(evt.getAppId(), evt.getDeviceHash());
        if (exist.isPresent()) { repo.markReinstall(exist.get().getId()); return; }

        // 2. P0 付费点击
        MatchedClick mc = matchPaidClick(evt, rule);
        AttributionRecord r;
        if (mc != null) {
            r = build(evt, "paid", mc, rule.getRuleVersion());
            enqueuePostback(r, "activate", evt.getEventId());
        } else if (isRecentPromoLink(evt)) {                  // 3. P1 裂变
            r = buildFromSignal(evt, "link", rule);
        } else if (hasStoreChannel(evt)) {                    // 4. P2 商店
            r = buildFromSignal(evt, "store", rule);
        } else {                                              // 5. P3 自然/待补归因
            r = buildFromSignal(evt, "organic", rule);
            r.setStatus(0);   // 24h 内允许迟到点击补归因
        }
        try {
            repo.insert(r);   // uk_device_app 唯一约束兜底并发重复消费
        } catch (DuplicateKeyException dup) {
            log.info("duplicate activation, device={}", evt.getDeviceHash());
        }
    }

    private MatchedClick matchPaidClick(ActivateEvent evt, AttributionConfig rule) {
        int window = rule.getDefaultClickWindowHours();
        for (IdHash h : evt.orderedHashes()) {          // oaid > caid > idfa/gaid > android_id
            List<ClickRow> rows = ch.queryClicks(h, evt.getActivatedAt().minusHours(window),
                                                 evt.getActivatedAt());
            MatchedClick m = pickBest(rows, evt.getActivatedAt(), rule.getMinCtitSeconds());
            if (m != null) return m;
        }
        if (evt.isAllowFuzzy()) {                        // 链接级 allow_fuzzy
            return pickBest(ch.queryByIpUa(evt.getIp(), evt.getUaNorm(), evt.getModel(),
                              evt.getActivatedAt().minusHours(window), evt.getActivatedAt()),
                            evt.getActivatedAt(), rule.getMinCtitSeconds());
        }
        return null;
    }

    /** 窗口内多条：CTIT 最小且 ≥ minCtit；全部 < minCtit 视为注入嫌疑返回 null（降级） */
    private MatchedClick pickBest(List<ClickRow> rows, Instant activatedAt, int minCtit) {
        return rows.stream()
            .filter(c -> c.fraudFlag == 0)
            .map(c -> new MatchedClick(c, Duration.between(c.ts, activatedAt).getSeconds()))
            .filter(m -> m.ctit >= minCtit)
            .min(Comparator.comparingLong(m -> m.ctit))
            .orElse(null);
    }
}
```

## 7. 转化事件回传（oCPA）

### 7.1 可回传事件映射

| 本方事件 | 触发源 | 回传 event_type | 说明 |
| --- | --- | --- | --- |
| app_first_open 归因完成 | attribution-core | `activate` | 付费渠道激活即回传 |
| user_register | 埋点（注册成功） | `register` | |
| 次日留存 | 留存预计算引擎日切任务 | `d1_retain` | 供平台深度出价 |
| order_paid | 计费中心支付成功事件（净额） | `purchase` | 携带 `event_value_cents`；退款冲正**不回传负值**（平台不支持），日终对账说明 |

仅 `channel_type='paid'` 且 `status=1` 的归因用户产生回传；`status=2`（作弊挂起）与 SKIPPED_FRAUD 永不回传。

### 7.2 回传模板与平台适配器

`ad_platform.postback_tpl` 示例（占位符由本方替换）：

```text
https://ad.oceanengine.com/attribution/callback?clickid={clickid}&event_type={event_type}&event_time={event_ts_unix}&event_value={event_value_cents}&conv_id={event_id}&sign={hmac_sign}
```

替换源：`attribution_record.matched_click_id → click_log.callback_params`（平台原始宏值，含 clickid 等）。`sign` 为本方密钥 HMAC（部分平台校验）。各平台 event_type 枚举差异（如 purchase 在部分平台为 `active_pay`）由 `PlatformPostbackAdapter` SPI 适配，新增平台只实现适配器 + 宏映射配置。

### 7.3 回传状态机与重试

```text
QUEUED(0) ──worker取出──▶ SENDING ──HTTP──▶ SENT(1)
SENT ──平台code=0──▶ CONFIRMED(2)          [终态]
SENT ──非0/超时──▶ FAILED_RETRY(3) ──next_retry_at到点──▶ SENDING
FAILED_RETRY ──retry_count ≥ 8──▶ DEAD(4) ──人工重派/放弃──▶ CONFIRMED / CLOSED
QUEUED ──归因被判作弊(复审)──▶ SKIPPED_FRAUD(5)            [终态]
```

退避：`next_retry_at = now + min(2^retry_count, 3600) * (1 + jitter0.3)` 秒。平台级令牌桶限速（默认 50 QPS/平台），429/Retry-After 优先遵从响应头。

### 7.4 关键代码（回传 worker）

```java
@Component
public class PostbackWorker {

    private final PostbackTaskMapper taskRepo;
    private final PlatformPostbackAdapter adapter;   // 按 platform_code 路由
    private final RestTemplate http;                 // 连接池+5s超时

    @Scheduled(fixedDelay = 2000)
    public void drain() {
        List<PostbackTask> batch = taskRepo.lockQueued(200);   // FOR UPDATE SKIP LOCKED
        for (PostbackTask t : batch) {
            try {
                ResponseEntity<String> resp = http.getForEntity(t.getCallbackUrl(), String.class);
                if (adapter.isConfirmed(t.getPlatformCode(), resp)) {
                    taskRepo.confirm(t.getId(), truncate(resp.getBody()));
                } else {
                    reschedule(t, adapter.errorHint(t.getPlatformCode(), resp));
                }
            } catch (ResourceAccessException | HttpStatusCodeException e) {
                reschedule(t, e.getMessage());
            }
        }
    }

    private void reschedule(PostbackTask t, String err) {
        if (t.getRetryCount() >= 8) {
            taskRepo.markDead(t.getId(), err);       // 死信：告警 + 工作台人工处理
        } else {
            long delay = (long) Math.min(Math.pow(2, t.getRetryCount()), 3600);
            taskRepo.reschedule(t.getId(), delay);
        }
    }
}
```

## 8. 消耗采集与 ROI 报表

### 8.1 消耗采集

1. **API 自动拉取**：T+1 06:00 定时任务按 `ad_account` 逐个调用平台报表 API（营销 API 报表权限由运营在平台侧申请），写入 `spend_daily`（source=1，batch_no=auto:date:account）。
2. **手工导入**：无 API 渠道走管理工作台上传（模板：日期/平台/账户/计划/消耗），Excel 解析复用《服务端-通用数据导入服务与批量操作引擎》，`batch_no` 幂等；同日同维度已存在 API 数据时导入为"差异候选"。
3. **手工修正**：财务月结修正需填原因，审计日志留痕。

### 8.2 ROI 指标口径

| 指标 | 口径 |
| --- | --- |
| CAC | `spend_cents / activations`（分/激活） |
| ROI | `revenue_cents / spend_cents`（净收入口径：订单支付 − 退款，来自计费中心） |
| 点击→激活率 | `activations / valid_clicks` |
| 激活→注册率 | `registrations / activations` |
| 次留/7留/30留 | 渠道维度留存（实时聚合引擎按 `attribution_id` 链路归属输出） |
| 回收周期 | 首个 `累计 revenue ≥ spend` 的自然日（报表按 7/14/30/60 天档位展示） |
| 预测 LTV30 | LTV 预测引擎批处理回填 `ltv30_pred_cents` |

### 8.3 对账差异处理

每日 10:00 对账任务：`spend_daily(API)` vs `spend_daily(导入)` vs 平台后台截图登记值，差异 > 3% 生成差异工单（接入《客服与工单系统》内部工单类型 `finance-recon`），状态机 `IMPORTED → DIFF_FOUND → RESOLVED`；未处理差异在报表中以"消耗(未对平)"列透出，不阻塞报表。

## 9. API 接口设计汇总

响应统一采用《服务端-统一响应封装与分页查询规范》`code/message/data` 结构。鉴权：`/t/*` 匿名 + 限流；`/internal/*` 服务间鉴权；`/admin/v1/ads/*` 管理后台 RBAC（角色：growth-ops / data-analyst / admin）。

### 9.1 监测与内部接口

| 接口 | 说明 |
| --- | --- |
| `GET /t/c?l=...` | 点击监测，302（§5） |
| `POST /internal/v1/attribution/activate` | 激活归因（埋点管线调用；幂等键 event_id） |
| `POST /internal/v1/attribution/events` | 转化事件接入（register/d1_retain/purchase；幂等键 event_id） |
| `GET /internal/v1/attribution/by-user?userId=` | 按用户查归因（漏斗/LTV 引擎取数） |

### 9.2 管理后台接口

| 接口 | 说明 |
| --- | --- |
| `POST /admin/v1/ads/platforms` / `accounts` / `links` | 平台/账户/监测链接 CRUD（写审计） |
| `PUT /admin/v1/ads/attribution-config` | 归因窗口/裁决优先级调整（生成新 rule_version，写审计） |
| `PUT /admin/v1/ads/fraud-rules/{ver}` | 反作弊规则阈值调整（灰度生效） |
| `GET /admin/v1/ads/roi-report?from=&to=&platform=&account=&campaign=&dim=` | ROI 报表查询（支持 drilldown 到 creative） |
| `POST /admin/v1/ads/spend/import` | 消耗手工导入（multipart，batch_no 幂等） |
| `GET /admin/v1/ads/spend/recon?date=` | 对账差异查询 |
| `GET /admin/v1/ads/postbacks?status=&platform=` | 回传任务列表 |
| `POST /admin/v1/ads/postbacks/{id}/redispatch` | 死信人工重派 |

### 9.3 错误码（本模块段：48300-48399，遵循《统一业务异常码与错误分类体系》）

| 错误码 | 场景 | 处理建议 |
| --- | --- | --- |
| 48301 | 监测链接无效/停用 | 客户端兜底 302，无需重试 |
| 48310 | 激活事件缺少设备标识哈希 | 客户端检查隐私同意后采集链路 |
| 48311 | 重复激活（唯一约束冲突） | 幂等语义，忽略即可 |
| 48320 | 转化事件无归因记录（自然量用户） | 预期行为，不回传 |
| 48330 | 回传 URL 模板渲染失败（缺宏） | 检查 click_log.callback_params 完整性 |
| 48331 | 平台回传确认失败超限 | 死信，人工核查平台资质/签名 |
| 48340 | 消耗导入模板/批次非法 | 按 message 修正后重传 |
| 48350 | 归因配置版本冲突（并发修改） | 刷新后重试 |

## 10. 状态流转汇总

### 10.1 归因记录

```text
激活事件到达
   ▼
[PENDING_MATCH 0] ──匹配付费点击──▶ [ATTRIBUTED 1] ──转化事件 enrich──▶ 仍为1（字段补齐）
[PENDING_MATCH 0] ──命中疑似作弊──▶ [FRAUD_HOLD 2] ──24h复审──▶ ATTRIBUTED(降级信号) / organic
[PENDING_MATCH 0] ──24h无迟到点击──▶ organic(status=1)
重装激活：不新建，原记录 reinstall_flag=true（终态不变）
```

### 10.2 回传任务

见 §7.3 状态机（QUEUED→SENT→CONFIRMED / FAILED_RETRY→DEAD；SKIPPED_FRAUD 终态）。

### 10.3 消耗对账

```text
[IMPORTED] ──对账任务──▶ [MATCHED]（差异≤3%）
[IMPORTED] ──对账任务──▶ [DIFF_FOUND] ──人工处理──▶ [RESOLVED]
```

## 11. 错误处理与降级策略

| 故障域 | 策略 |
| --- | --- |
| 监测端点 | 任何异常 → 兜底 302；Kafka 断 → 本地缓冲/磁盘队列重放；绝不 5xx |
| 归因匹配超时 | 200ms SLA 超时转异步，结果由客户端下次启动拉取或仅服务端落库；未匹配落 PENDING 24h 补归因 |
| ClickHouse 不可用 | 激活事件入重试队列（延迟任务引擎，5/15/60min 阶梯）；超过 24h 窗口的匹配降级 install_channel 裁决并标记 `degraded=true` |
| 回传平台 5xx/限流 | §7.3 退避重试 + 平台级令牌桶；连续 DEAD > 50/日触发告警（可能平台接口变更） |
| 消耗 API 失败 | 自动重试 3 次后转手工导入提醒（站内信给 growth-ops 角色组） |
| 数据一致性日终校验 | 归因总数 vs 埋点激活总数 vs 商店后台安装量三方差异 > 5% 告警（数据质量监控引擎接入） |

## 12. 合规与数据安全

1. **最小化采集**：仅采集归因必需的设备哈希、IP、UA、机型；不采集 IMEI/MAC；OAID/IDFA 读取以用户同意隐私政策为前置（客户端《多渠道打包》§隐私弹窗时序保障）。
2. **未成年人保护**：归因数据与学生学习数据物理隔离（独立库 `growth_attrib`）；回传事件的 `conv_id` 为单向哈希，平台侧无法反解为学生身份；不对未成年用户做个体级广告定向输出。
3. **数据保留**：click_log 180 天 TTL（已登记存储生命周期引擎）；attribution_record 长期保留（渠道口径需要），postback_task 明细 180 天后归档。
4. **审计**：归因窗口/优先级/反作弊阈值/扣量规则/消耗修正全部写审计事件（操作人、前后值、理由），保留 3 年。
5. **传输与密钥**：回传签名密钥、HMAC 盐由密钥管理服务托管（引用《服务端-密钥管理与敏感配置安全策略》），季度轮换（历史数据带 `salt_ver` 可回放校验）。

## 13. 监控与告警

| 指标 | 阈值 | 告警 |
| --- | --- | --- |
| track /t/c P99 延迟 | > 80ms | 通知（影响跳转体验） |
| Kafka attrib.click.raw 积压 | > 100 万条或 10 分钟 | 页面（洪峰/消费故障） |
| 归因匹配成功率（激活→有 paid/判定结果） | 突降 > 30% 环比 | 页面（匹配链路故障） |
| 模糊匹配占比 | > 15%（日） | 通知（误归因风险上升） |
| 回传成功率 | < 97%（日） | 页面 |
| DEAD 回传数 | > 50/日 | 通知 |
| 作弊点击占比 | > 20%（日） | 通知（联动风控复核投放渠道质量） |
| 三方安装量对账差异 | > 5% | 页面 |

埋点：`attrib_click_received / attrib_click_fraud / attrib_matched / attrib_postback_sent / attrib_postback_confirmed`（打上 platform/channel_type 维度），纳入统一指标中心。

## 14. 测试要点

1. **归因正确性用例集**：付费优先/裂变 7 天窗口/商店兜底/organic、多点击取最短 CTIT、CTIT<10s 降级、重装不重归因、迟到点击补归因、并发双激活唯一约束。
2. **反作弊用例**：设备/IP 点击泛滥阶梯标记、注入时序（CTIT 极小）、UA-OS 矛盾。
3. **回传用例**：宏替换完整性、平台确认/失败/超时三分支、退避节奏、死信人工重派、SKIPPED_FRAUD 不外呼。
4. **洪峰压测**：3000 QPS 点击监测（302 P99 < 80ms）、Kafka 断链降级、CH 写入堆积。
5. **对账用例**：API/导入/修正三源差异计算与工单生成。
6. **合规测试**：未同意隐私政策时设备哈希字段为空仍可归因（降级 IP+UA 或 organic）、回传报文不含任何学生 PII（DLP 扫描）。

## 15. 配置项汇总（配置中心 `attrib-svc` 命名空间）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| attribution.default.click.window.hours | 168 | 付费点击归因窗口 |
| attribution.link.window.days | 7 | 裂变链接归因窗口 |
| attribution.reinstall.hold.days | 30 | 重装保持期 |
| attribution.min.ctit.seconds | 10 | 注入判定下限 |
| attribution.fuzzy.enabled.global | false | 模糊匹配全局开关（链接级可开） |
| attribution.fuzzy.max.clicks.per.ip | 20 | 模糊匹配 IP 点击上限 |
| fraud.device.daily.clicks.warn / block | 50 / 200 | 点击泛滥阶梯阈值 |
| fraud.ip.daily.clicks.warn / block | 500 / 2000 | 同上 |
| postback.rate.limit.per.platform | 50 | 回传平台级 QPS |
| postback.retry.max | 8 | 死信阈值 |
| spend.recon.diff.ratio | 0.03 | 对账差异容忍度 |
| retention.click.days | 180 | 点击日志 TTL |

## 16. 上线与灰度计划

1. **阶段一（影子模式）**：仅采集点击 + 匹配计算，回传关闭（postback 全部 SKIPPED_SHADOW），与人工渠道报表对比 2 周，校准匹配率与误归因。
2. **阶段二（单平台回传）**：选择消耗最大平台开启 oCPA 激活回传，观察平台模型学习曲线与 CAC 变化。
3. **阶段三（全量）**：全平台回传 + register/d1_retain/purchase 深度事件；ROI 报表进入运营驾驶舱。
4. **回滚预案**：回传可按平台/事件类型一键暂停（配置中心热更），不影响归因采集；归因裁决规则回滚通过 `rule_version` 回退发布。
