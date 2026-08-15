# 用户调研问卷与NPS满意度度量平台 - 详细设计

> 模块代号：`survey-svc`（归属用户体验度量 / 增长域）
> 文档版本：v1.0
> 关联原始设计：《启硕-PrimeTop-全学段AI辅助学习软件项目设计文档》§16 关键指标设计（§16.4.1 "AI 回答用户满意率"）、§14.2.8 数据复盘（活跃、留存、付费、AI 成本和学习效果）、§12.4.5 建立用户反馈与纠错机制、§8.4 数据分析服务/消息服务
> 关联细化文档：《用户反馈与AI质量评估-详细设计》（被动点赞点踩，本平台为**主动定向调研**，二者互补）、《服务端-统一指标中心与数据语义查询引擎-详细设计》、《数据埋点与关键指标系统-详细设计》、《用户标签与智能分群引擎-详细设计》（人群圈选）、《服务端-积分获取规则计算与虚拟资产交易结算服务-详细设计》（激励发放）、《服务端-运营弹窗规则引擎与个性化消息卡片调度服务-详细设计》（弹窗通道）、《服务端-统一延迟任务调度与到期事件触发引擎-详细设计》、《服务端-教师专业发展画像与教学能力成长追踪评估引擎-详细设计》（消费本平台 `SURVEY_SUBMITTED` 事件与评教问卷数据）、《B端合作与机构接入方案-详细设计》（消费 `avg_nps` 指标）、《管理后台-学情数据分析与教育运营驾驶舱工作台-详细设计》（消费 NPS 展示）、《服务端-教育场景NLP基础管线与学科文本智能处理引擎-详细设计》（开放题分词/情感）、《服务端-用户生成内容安全审核与未成年人社交保护引擎-详细设计》（开放题文本审核）、《服务端-学生知识掌握度数据可信度评估与最小样本量保障引擎-详细设计》（最小样本量方法论复用）、《客户端-动态化运营活动页面与JSON驱动渲染引擎-详细设计》（JSON 渲染范式参考）

## 1. 模块概述

### 1.1 定位与背景

`survey-svc` 是平台**主动式用户体验度量基础设施**，负责问卷全生命周期管理、投放触达、答卷回收、NPS/CSAT 指标计算与对外供给。

建设动机（当前缺口）：

1. **指标无生产方**：多份既有文档把 NPS / 满意率当作**输入数据**引用——B 端合作方案对外返回 `"avg_nps": 72`，运营驾驶舱术语表定义 NPS，分龄 UI 规范设定 "NPS ≥ 4.0/5.0" 目标，AI 质量文档计算"回答满意率"，但全库没有任何文档设计这些数据如何采集、计算、治理。
2. **事件无发布方**：《服务端-教师专业发展画像与教学能力成长追踪评估引擎》已订阅 `SURVEY_SUBMITTED` 事件，并配置了 `survey_based` 型评估规则（`teacher_satisfaction` / `parent_teacher_eval`），依赖一个尚不存在的"问卷服务"。
3. **反馈体系缺主动侧**：《用户反馈与AI质量评估》覆盖用户被动点赞/点踩（单点、即时、AI 回答域）；产品改版调研、学习效果主观度量、家长满意度、教师评教等**多题、定向、有配额与激励**的调研场景无承载系统。

平台覆盖四类调研形态：

| 形态 | 说明 | 典型场景 |
| --- | --- | --- |
| FORM 综合问卷 | 3~30 题，支持逻辑跳转 | 新版本功能调研、寒暑假营期反馈、内容需求调研 |
| NPS 标准问卷 | 固定 0-10 推荐意愿题 + 可选开放理由 | 季度 NPS、分学段 NPS、B 端机构 NPS |
| CSAT 满意度微调研 | 1 题 1-5 分（可附 1 开放题） | AI 讲解满意率、拍题解析满意率、客服工单结单评价 |
| EVAL 评教问卷 | 教师评价专项（学生版/家长版） | 学期评教，对接教师专业发展画像 |

### 1.2 与其他模块的关系

| 模块 | 关系 |
| --- | --- |
| 用户反馈与AI质量评估 | 被动即时反馈（赞/踩） vs 本平台主动定向调研；CSAT 微调研题可挂在 AI 回答卡片"其他反馈"入口，数据落本平台 |
| 统一指标中心 | 本平台是 `nps_score`、`csat_score`、`survey_response_rate` 等指标的定义方与推送方 |
| 用户标签与智能分群引擎 | 投放定向消费其标签圈选结果；答卷行为反哺"愿意反馈用户"标签 |
| 积分获取规则计算与虚拟资产交易结算服务 | 答卷激励经积分规则入账（业务类型 `SURVEY_REWARD`），失败走补偿 |
| 运营弹窗规则引擎 | 弹窗型问卷的**展示通道**由弹窗引擎承载，本平台输出"可投放卡片"供给其调度，避免双弹窗冲突 |
| 通知疲劳度管控 / 注意力预算引擎 | 触达决策必须扣减全局打扰预算，本平台仅是预算消费方之一 |
| 统一延迟任务调度引擎 | 邀写过期、激励延迟结算、问卷定时开始/结束 |
| 教师专业发展画像引擎 | 本平台发布 `SURVEY_SUBMITTED` 事件（含 survey_code 维度），评教规则消费 |
| 内容安全审核（UGC） | 开放题文本入库前同步机审，命中敏感/隐私内容掩码并上报 |
| NLP 基础管线 | 开放题分析（分词、情感极性、聚类主题）复用其管线 |
| AB 测试与实验平台 | 投放计划支持挂实验分组（仅对实验组投放），指标回流实验平台 |
| 统一文件生成中心 | 调研数据导出（Excel/CSV）走异步报表导出，导出需审批 |
| 数据脱敏规则引擎 | 导出与后台查询时的手机号/姓名等字段动态遮蔽 |

### 1.3 设计原则

1. **最小打扰**：调研是"向用户借时间"，默认频控（单用户 30 天 ≤ 2 份、7 天 ≤ 1 份、同问卷仅 1 次），并纳入全局注意力预算，绝不与营销弹窗叠加出现。
2. **未成年人合规优先**：学生端问卷默认**匿名统计模式**；涉及个人信息采集的问卷仅可投向家长端/教师端账号；开放题文本过安全审核。详见 §11。
3. **样本科学性**：配额抽样（按学段/会员/渠道分桶）+ 抽样比例控制 + 最小样本量标注（n≥30 方可信输出），避免"谁活跃谁答题"的幸存者偏差污染决策。
4. **防刷与反套利**：有激励问卷必须人机验证 + 设备指纹去重，激励 T+1 延迟结算 + 抽样复核，可回滚。
5. **幂等与最终一致**：答卷提交以客户端幂等键去重；激励发放、事件发布、指标推送均补偿重试。
6. **可降级**：问卷服务任何故障不得影响学习主链路——`pending` 接口超时即返回空列表，客户端静默跳过。

### 1.4 业务边界

本平台负责：问卷定义与版本、投放计划与定向、触达资格判定、答卷收集与质量标记、激励发放协同、NPS/CSAT 计算与指标供给、`SURVEY_SUBMITTED` 事件发布、调研分析看板数据。

本平台不负责：AI 回答点赞点踩（《用户反馈与AI质量评估》）、弹窗展示与优先级仲裁（《运营弹窗规则引擎》）、积分账务（《积分获取规则计算》）、文本审核模型本身（内容安全审核）、A/B 实验分组计算（实验平台）、工单满意度闭环（客服工单系统——工单结单评价题由本平台 CSAT 形态承载，结果回写工单评分字段）。

---

## 2. 核心概念与数据模型

### 2.1 概念模型

```text
SurveyDefinition (问卷定义聚合根)
├── SurveyVersion            发布时固化的不可变问卷版本（schema 快照）
│     └── SurveyQuestion     从 schema 物化的题目投影（分析友好）
└── SurveyCampaign (投放计划)
      ├── TargetingRule      定向圈选（标签/学段/会员/抽样比例）
      ├── TriggerRule        触发时机（场景/事件/定时）
      ├── QuotaBucket        配额桶（维度分桶目标量）
      └── SurveyInvitation   触达实例（一人一次）
            └── SurveyResponse (答卷)
                  ├── SurveyAnswer          答题明细
                  └── IncentiveRecord       激励发放记录

NpsDailySnapshot / CsatDailySnapshot  (指标快照，按维度)
```

关键规则：

- **问卷定义可反复修改草稿，但发布即冻结**：`SurveyVersion.schema_json` 不可变，分析永远绑定 `version_no`，避免"题目改了历史数据对不上"。
- **投放计划是执行单元**：同一问卷可有多份投放（不同人群/渠道/时间），回收数据靠 `campaign_id` 区分来源。
- **答卷与邀请绑定**：每份答卷来自一个邀请实例（匿名 Web 问卷除外，用 `anon_token` 关联），保证一人一卷可追溯。

### 2.2 问卷定义表 `survey_definition`

```sql
CREATE TABLE survey_definition (
    id              BIGSERIAL PRIMARY KEY,
    code            VARCHAR(64)  NOT NULL UNIQUE,       -- 问卷编码，如 nps_quarterly / teacher_satisfaction
    title           VARCHAR(128) NOT NULL,
    type            VARCHAR(16)  NOT NULL,              -- FORM / NPS / CSAT / EVAL
    description     VARCHAR(512) NOT NULL DEFAULT '',
    status          VARCHAR(16)  NOT NULL DEFAULT 'DRAFT',  -- DRAFT/PENDING_REVIEW/PUBLISHED/CLOSED/ARCHIVED
    current_version INTEGER      NOT NULL DEFAULT 0,    -- 最新发布版本号，0=从未发布
    owner_id        BIGINT       NOT NULL,              -- 创建人（运营/教研）
    anonymous_mode  BOOLEAN      NOT NULL DEFAULT TRUE, -- TRUE=答卷不落 user_id 关联（推荐默认）
    pii_level       VARCHAR(16)  NOT NULL DEFAULT 'NONE', -- NONE/CONTACT（CONTACT 禁止投放学生端）
    estimate_min    INTEGER      NOT NULL DEFAULT 2,    -- 预计答题分钟数（客户端展示）
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

### 2.3 问卷版本表 `survey_version`

```sql
CREATE TABLE survey_version (
    id           BIGSERIAL PRIMARY KEY,
    survey_id    BIGINT       NOT NULL REFERENCES survey_definition(id),
    version_no   INTEGER      NOT NULL,
    schema_json  JSONB        NOT NULL,                 -- 问卷 DSL 全量，见 §3
    published_by BIGINT       NOT NULL,
    published_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (survey_id, version_no)
);
CREATE INDEX idx_survey_version_survey ON survey_version(survey_id, version_no DESC);
```

### 2.4 题目投影表 `survey_question`

```sql
CREATE TABLE survey_question (
    id           BIGSERIAL PRIMARY KEY,
    survey_id    BIGINT      NOT NULL,
    version_no   INTEGER     NOT NULL,
    question_key VARCHAR(64) NOT NULL,              -- schema 内唯一键，如 q1 / nps_score / open_reason
    seq          INTEGER     NOT NULL,              -- 展示顺序
    type         VARCHAR(24) NOT NULL,              -- 题型，见 §3.1
    title        TEXT        NOT NULL,              -- 题干（纯文本索引版）
    required     BOOLEAN     NOT NULL DEFAULT TRUE,
    options_json JSONB       NOT NULL DEFAULT '[]', -- 选项（含 value/score 映射）
    UNIQUE (survey_id, version_no, question_key)
);
```

> `schema_json` 是唯一事实来源；本表在发布事务内由服务端从 schema 物化生成，仅供统计 JOIN 与后台列表，**不允许反向修改**。

### 2.5 投放计划表 `survey_campaign`

```sql
CREATE TABLE survey_campaign (
    id             BIGSERIAL PRIMARY KEY,
    campaign_code  VARCHAR(64) NOT NULL UNIQUE,     -- 如 CMP-202609-NPS-Q3
    survey_id      BIGINT      NOT NULL REFERENCES survey_definition(id),
    version_no     INTEGER     NOT NULL,            -- 锁定投放的问卷版本
    name           VARCHAR(128) NOT NULL,
    channel        VARCHAR(24) NOT NULL,            -- APP_SCENE/APP_POPUP/REPORT_FOOTER/MESSAGE_CARD/WEB_LINK/API_B2B
    audience_role  VARCHAR(16) NOT NULL DEFAULT 'STUDENT', -- STUDENT/PARENT/TEACHER/B2B_CLIENT
    targeting_json JSONB       NOT NULL DEFAULT '{}',  -- 定向规则，见 §6.1
    trigger_json   JSONB       NOT NULL DEFAULT '{}',  -- 触发规则
    quota_json     JSONB       NOT NULL DEFAULT '[]',  -- 配额桶定义
    incentive_json JSONB       NOT NULL DEFAULT '{}',  -- {"points":50,"delaySettle":true,"needCaptcha":true}
    begin_time     TIMESTAMPTZ NOT NULL,
    end_time       TIMESTAMPTZ NOT NULL,
    status         VARCHAR(16) NOT NULL DEFAULT 'DRAFT', -- DRAFT/SCHEDULED/RUNNING/PAUSED/FINISHED
    experiment_id  VARCHAR(64),                     -- 关联 AB 实验（可选，仅实验组投放）
    created_by     BIGINT      NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_campaign_status_time ON survey_campaign(status, begin_time, end_time);
```

### 2.6 配额桶表 `survey_quota`

```sql
CREATE TABLE survey_quota (
    id          BIGSERIAL PRIMARY KEY,
    campaign_id BIGINT      NOT NULL REFERENCES survey_campaign(id),
    dimension   VARCHAR(32) NOT NULL,          -- quota 维度：GRADE/MEMBER_TIER/CHANNEL/SEGMENT_TAG
    bucket_key  VARCHAR(64) NOT NULL,          -- 维度值，如 grade_7 / member_annual / channel_ios
    target_cnt  INTEGER     NOT NULL,          -- 目标回收量
    got_cnt     INTEGER     NOT NULL DEFAULT 0,
    UNIQUE (campaign_id, dimension, bucket_key)
);
```

并发扣减使用乐观锁：`UPDATE survey_quota SET got_cnt = got_cnt + 1 WHERE id = ? AND got_cnt < target_cnt`，影响行数为 0 视为该桶满。

### 2.7 触达实例表 `survey_invitation`

```sql
CREATE TABLE survey_invitation (
    id           BIGSERIAL PRIMARY KEY,
    campaign_id  BIGINT      NOT NULL,
    user_id      BIGINT,                          -- 匿名模式可为 NULL
    anon_token   VARCHAR(64),                     -- WEB_LINK 匿名渠道的令牌
    device_id    VARCHAR(64),
    status       VARCHAR(16) NOT NULL DEFAULT 'CREATED', -- CREATED/SHOWN/STARTED/SUBMITTED/DISMISSED/EXPIRED
    shown_at     TIMESTAMPTZ,
    started_at   TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    expire_at    TIMESTAMPTZ NOT NULL,            -- 触达后有效期，默认 72h
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (campaign_id, user_id),                -- 一人一卷（匿名渠道用 (campaign_id, anon_token) 唯一索引）
    UNIQUE (campaign_id, anon_token)
);
CREATE INDEX idx_invitation_expire ON survey_invitation(status, expire_at) WHERE status IN ('CREATED','SHOWN','STARTED');
```

### 2.8 答卷表 `survey_response`

```sql
CREATE TABLE survey_response (
    id                 BIGSERIAL PRIMARY KEY,
    response_no        VARCHAR(40) NOT NULL UNIQUE,        -- 业务单号 R + 雪花ID
    survey_id          BIGINT      NOT NULL,
    version_no         INTEGER     NOT NULL,
    campaign_id        BIGINT      NOT NULL,
    invitation_id      BIGINT,
    user_id            BIGINT,                              -- 匿名模式为 NULL
    client_response_id VARCHAR(64) NOT NULL,                -- 客户端幂等键（UUID）
    role               VARCHAR(16) NOT NULL,                -- STUDENT/PARENT/TEACHER/B2B_CLIENT
    grade              SMALLINT,                            -- 答题时学段年级快照（分析维度，匿名模式保留）
    member_tier        VARCHAR(16),                         -- 答题时会员等级快照
    channel_snapshot   VARCHAR(24) NOT NULL,                -- 渠道快照
    status             VARCHAR(16) NOT NULL DEFAULT 'DRAFT', -- DRAFT/SUBMITTED/REJECTED/ARCHIVED_MASKED
    submitted_at       TIMESTAMPTZ,
    duration_ms        INTEGER     NOT NULL DEFAULT 0,      -- start→submit 时长
    quality_flag       VARCHAR(24) NOT NULL DEFAULT 'OK',   -- OK/TOO_FAST/STRAIGHT_LINING/OPEN_TEXT_SPAM/SUSPECT_DUPLICATE
    incentive_status   VARCHAR(16) NOT NULL DEFAULT 'NONE', -- NONE/PENDING/GRANTED/SETTLED/ROLLED_BACK
    client_meta        JSONB       NOT NULL DEFAULT '{}',   -- appVersion/platform/deviceModel/network
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uk_response_client ON survey_response(client_response_id);
CREATE INDEX idx_response_survey_time ON survey_response(survey_id, campaign_id, submitted_at DESC) WHERE status = 'SUBMITTED';
```

### 2.9 答题明细表 `survey_answer`

```sql
CREATE TABLE survey_answer (
    id           BIGSERIAL PRIMARY KEY,
    response_id  BIGINT      NOT NULL REFERENCES survey_response(id) ON DELETE CASCADE,
    question_key VARCHAR(64) NOT NULL,
    option_ids   JSONB       NOT NULL DEFAULT '[]',   -- 选中选项 key 数组
    number_value SMALLINT,                            -- NPS(0-10)/CSAT(1-5)/量表分值
    text_value   TEXT,                                -- 开放题文本（已过审核掩码）
    text_sentiment VARCHAR(8),                        -- POS/NEG/NEU（NLP 异步回填）
    answered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (response_id, question_key)
);
CREATE INDEX idx_answer_question ON survey_answer(question_key, number_value);
```

### 2.10 激励发放记录表 `survey_incentive_record`

```sql
CREATE TABLE survey_incentive_record (
    id          BIGSERIAL PRIMARY KEY,
    response_id BIGINT      NOT NULL UNIQUE REFERENCES survey_response(id),
    user_id     BIGINT      NOT NULL,
    points      INTEGER     NOT NULL,
    status      VARCHAR(16) NOT NULL DEFAULT 'PENDING',  -- PENDING/GRANTED/SETTLED/ROLLED_BACK/REJECTED
    settle_at   TIMESTAMPTZ,                            -- T+1 复核结算时间
    reject_reason VARCHAR(128),
    biz_no      VARCHAR(64),                            -- 积分服务流水号
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.11 NPS 日快照表 `nps_daily_snapshot`

```sql
CREATE TABLE nps_daily_snapshot (
    id           BIGSERIAL PRIMARY KEY,
    survey_code  VARCHAR(64) NOT NULL,
    stat_date    DATE        NOT NULL,
    dimension    VARCHAR(32) NOT NULL DEFAULT 'ALL',   -- ALL/GRADE/MEMBER_TIER/CHANNEL/ORG(B2B)
    dim_value    VARCHAR(64) NOT NULL DEFAULT 'ALL',
    window_days  SMALLINT    NOT NULL DEFAULT 1,       -- 1=当日，30=滚动30天
    promoters    INTEGER     NOT NULL DEFAULT 0,       -- 9-10 分
    passives     INTEGER     NOT NULL DEFAULT 0,       -- 7-8 分
    detractors   INTEGER     NOT NULL DEFAULT 0,       -- 0-6 分
    responses    INTEGER     NOT NULL DEFAULT 0,
    nps_score    SMALLINT    NOT NULL DEFAULT 0,       -- (promoters - detractors) / responses * 100
    confidence   VARCHAR(16) NOT NULL DEFAULT 'LOW',   -- HIGH(n>=30)/LOW
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (survey_code, stat_date, dimension, dim_value, window_days)
);
```

CSAT 快照复用同结构（`csat_daily_snapshot`：`satisfied(4-5)` / `neutral(3)` / `dissatisfied(1-2)`，`csat_score = satisfied/responses*100`），DDL 略。

### 2.12 核心枚举定义

| 枚举 | 取值 |
| --- | --- |
| SurveyType | FORM（综合问卷）、NPS、CSAT、EVAL（评教） |
| Channel | APP_SCENE（场景内嵌卡片）、APP_POPUP（弹窗，经弹窗引擎）、REPORT_FOOTER（学情报告页尾）、MESSAGE_CARD（消息中心卡片）、WEB_LINK（匿名链接/二维码）、API_B2B（B 端机构定向下发） |
| AudienceRole | STUDENT、PARENT、TEACHER、B2B_CLIENT |
| InvitationStatus | CREATED → SHOWN → STARTED → SUBMITTED；DISMISSED（拒答终态）、EXPIRED（过期终态） |
| ResponseStatus | DRAFT → SUBMITTED；REJECTED（质量否决，不进统计）、ARCHIVED_MASKED（保留期届满脱敏归档） |
| QualityFlag | OK、TOO_FAST（时长 < 题数×1.5s）、STRAIGHT_LINING（量表题同分直线）、OPEN_TEXT_SPAM（开放题乱码/广告，由审核回调标记）、SUSPECT_DUPLICATE（同设备多账号） |
| Confidence | HIGH（n≥30）、LOW |

---

## 3. 问卷 DSL 设计

### 3.1 题型清单

| type | 说明 | 数据落点 |
| --- | --- | --- |
| `single_choice` | 单选 | option_ids[1] |
| `multi_choice` | 单选多选（可配 min/max） | option_ids[n] |
| `scale` | 1-5/1-7 同意度量表 | number_value |
| `nps` | 0-10 推荐意愿（0-6/7-8/9-10 着色） | number_value |
| `csat` | 1-5 满意度（表情脸） | number_value |
| `star` | 1-5 星 | number_value |
| `matrix` | 矩阵单选（行×列） | 每行展开为 `{question_key}:{row_key}` 子题 |
| `boolean` | 是/否 | option_ids |
| `open_text` | 开放题（可配 maxLength、placeholder） | text_value |
| `notice` | 说明页（不收集数据） | 无 |

### 3.2 schema_json 结构示例（NPS + 开放理由）

```json
{
  "schemaVersion": "1.0",
  "meta": { "title": "第三季度产品体验调研", "estimateMin": 2, "submitText": "提交" },
  "questions": [
    {
      "key": "nps_score",
      "type": "nps",
      "title": "你会把启硕推荐给同学或朋友吗？（0=完全不推荐，10=非常推荐）",
      "required": true,
      "randomizeOptions": false
    },
    {
      "key": "open_reason",
      "type": "open_text",
      "title": "打这个分数的主要原因是？（选填）",
      "required": false,
      "maxLength": 300,
      "placeholder": "比如：讲解很清楚 / 题目有点难找…",
      "displayWhen": { "op": "range", "question": "nps_score", "gte": 0 }
    },
    {
      "key": "usage_freq",
      "type": "single_choice",
      "title": "你最近两周使用启硕的频率是？",
      "required": true,
      "options": [
        { "id": "a1", "text": "几乎每天" },
        { "id": "a2", "text": "每周 3-4 次" },
        { "id": "a3", "text": "每周 1-2 次" },
        { "id": "a4", "text": "更少" }
      ]
    },
    {
      "key": "like_features",
      "type": "multi_choice",
      "title": "你最喜欢哪些功能？（可多选，最多 3 项）",
      "required": true,
      "minSelect": 1,
      "maxSelect": 3,
      "options": [
        { "id": "f1", "text": "AI 问答讲解" },
        { "id": "f2", "text": "拍照搜题" },
        { "id": "f3", "text": "错题本复习" },
        { "id": "f4", "text": "学习计划" },
        { "id": "f5", "text": "同步课堂" }
      ],
      "displayWhen": { "op": "in", "question": "usage_freq", "values": ["a1", "a2", "a3"] }
    }
  ]
}
```

### 3.3 displayWhen 逻辑表达式

```text
displayWhen := { op, question, ... }
  op = "eq"    { question, value }          等于某选项
  op = "in"    { question, values: [] }     属于选项集合
  op = "range" { question, gte?, lte? }     数值区间（量表/NPS）
  op = "notnull" { question }               已作答
  op = "and"/"or" { children: [displayWhen...] }
```

客户端本地求值（据此显隐题目），**服务端提交时按同一规则二次求值**：被 displayWhen 隐藏的题目若提交了答案 → 记 `REJECTED`（防脚本伪造）；必填题缺答且未被隐藏 → 拒绝提交。

### 3.4 发布时服务端校验（发布接口的强校验，全部不过则拒绝）

1. JSON Schema 结构校验（ajv 同构规则）。
2. `question.key` 全局唯一、`[a-z][a-z0-9_]{1,63}`。
3. `displayWhen.question` 必须引用**更靠前**的题目（禁止循环依赖，发布时做拓扑检查）。
4. NPS/CSAT 类型问卷必须恰含一个 `nps`/`csat` 题型题。
5. `open_text.maxLength ≤ 500`；EVAL 类型必须绑定 `teacher_id` 参数（见 §6.6）。
6. `pii_level=CONTACT` 的问卷，题目不得包含自由文本以外的联系方式引导文案豁免项（机审 + 人工复审双确认）。

---

## 4. 状态流转

### 4.1 问卷定义状态机

```text
DRAFT ──提交审核──▶ PENDING_REVIEW ──审核通过+发布──▶ PUBLISHED
  ▲                    │审核驳回                          │
  └────────────────────┘                                  ├─close─▶ CLOSED ──archive(180d)─▶ ARCHIVED
                                             PUBLISHED ◀──┘（新版本发布，current_version+1）
```

- PUBLISHED 后编辑 → 生成新草稿副本，发布后 `current_version + 1`；历史投放与答卷永远绑定其原 `version_no`。
- `PENDING_REVIEW`：`pii_level=CONTACT` 或投放含未成年人的问卷**强制人工合规复审**（复用内容审核工作流的审核管线，`biz_type=SURVEY_SCHEMA`），纯匿名统计问卷可配置自动过审。

### 4.2 投放计划状态机

```text
DRAFT ─▶ SCHEDULED ─(到达 begin_time，定时任务激活)─▶ RUNNING ─┬─pause─▶ PAUSED ─resume─▶ RUNNING
                                                          ├─finish─▶ FINISHED
                                                          └─(end_time 到 / 全配额满，自动)─▶ FINISHED
```

FINISHED 后未过期的 CREATED/SHOWN 邀请批量置 EXPIRED（延迟任务批量扫描，1000 条/批）。

### 4.3 邀请状态机（触达实例）

```text
CREATED ─show─▶ SHOWN ─start─▶ STARTED ─submit─▶ SUBMITTED
   │              │
   │              └─dismiss─▶ DISMISSED（记录 dismiss_source：关闭/稍后/无兴趣）
   └─(expire_at 到)─▶ EXPIRED
SHOWN/STARTED 也可因投放 FINISHED 被批量置 EXPIRED
```

### 4.4 答卷状态机

```text
DRAFT ─submit─▶ SUBMITTED ─┬─(质量复核不通过)─▶ REJECTED（激励 ROLLED_BACK，数据不进统计）
                           └─(保留期 180 天届满)─▶ ARCHIVED_MASKED（text_value 置空、client_meta 只留 platform）
```

### 4.5 激励状态机

```text
NONE（无激励） 
PENDING ─(提交通过初筛，发券式预授)─▶ GRANTED ─(T+1 复核通过，调积分服务)─▶ SETTLED
   │                                       └─(复核发现刷量)─▶ ROLLED_BACK
   └─(提交即判定 SUSPECT_DUPLICATE/TOO_FAST)─▶ REJECTED
```

---

## 5. API 接口设计

统一走 API 网关，鉴权/限流/响应封装遵循《服务端-统一响应封装与分页查询规范-详细设计》。错误码使用 41900-41999 号段（需在《服务端-统一业务异常码与错误分类体系》登记）。

### 5.1 客户端接口

#### 5.1.1 拉取当前可答问卷

`GET /api/v1/surveys/pending?scene={sceneKey}`

- sceneKey：`home` / `after_ai_answer` / `report_viewed` / `wrongbook_review_done` 等（对应 trigger_json 的 scene）。
- 响应通常 0~1 条（同屏只出一份，服务端已按优先级与频控裁决）。

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "invitationId": "9127453",
        "surveyCode": "csat_ai_answer",
        "title": "这次的讲解对你有帮助吗？",
        "type": "CSAT",
        "estimateMin": 1,
        "incentive": { "points": 10, "notice": "完成后送 10 学豆" },
        "expireAt": "2026-09-12T18:00:00+08:00"
      }
    ]
  }
}
```

失败/超时一律返回空 items（客户端静默），不弹错误。

#### 5.1.2 获取问卷详情（进入答题）

`GET /api/v1/surveys/invitations/{invitationId}` → 返回完整 schema_json（客户端按 DSL 渲染）+ 已保存草稿答案。同时服务端把邀请置 STARTED（首次）。

#### 5.1.3 分步保存草稿

`PUT /api/v1/surveys/responses/{responseNo}/draft`

```json
{ "answers": { "nps_score": 9, "open_reason": "讲解分步很清楚" }, "progressSeq": 2 }
```

#### 5.1.4 提交答卷（幂等）

`POST /api/v1/surveys/responses/{responseNo}/submit`

```json
{ "clientResponseId": "3f2b8c1e-uuid", "durationMs": 86000, "answers": { "nps_score": 9, "usage_freq": "a1" } }
```

- `clientResponseId` 全局唯一索引兜底，重复提交返回首次结果（含激励授予状态）。
- 成功响应：

```json
{ "code": 0, "data": { "result": "SUBMITTED", "incentive": { "status": "GRANTED", "points": 10 } } }
```

#### 5.1.5 拒答

`POST /api/v1/surveys/invitations/{invitationId}/dismiss`  body：`{"source":"LATER"|"NOT_INTERESTED"|"CLOSE"}`

### 5.2 管理端接口（运营工作台）

| 方法 & 路径 | 说明 |
| --- | --- |
| `POST /admin/v1/surveys` | 创建问卷（草稿） |
| `PUT /admin/v1/surveys/{id}/draft` | 编辑草稿 schema |
| `POST /admin/v1/surveys/{id}/submit-review` | 提交合规审核 |
| `POST /admin/v1/surveys/{id}/publish` | 发布（校验 §3.4，物化版本与题目投影） |
| `POST /admin/v1/surveys/{id}/close` | 关闭问卷（进行中投放级联 FINISH） |
| `GET /admin/v1/surveys/{id}/versions` | 版本列表与 schema Diff |
| `POST /admin/v1/campaigns` | 创建投放（含定向/触发/配额/激励配置） |
| `POST /admin/v1/campaigns/{id}/estimate` | 人群预估（调标签分群引擎 count，返回各配额桶预估量与预期回收率） |
| `POST /admin/v1/campaigns/{id}/pause` / `resume` / `finish` | 投放控制 |
| `POST /admin/v1/campaigns/{id}/anon-links` | 生成匿名 Web 链接/二维码（走统一短链服务），返回 token 列表 |
| `GET /admin/v1/surveys/{id}/analytics/summary` | 回收概览：曝光/开始/提交漏斗、完成率、中位时长、质量分布 |
| `GET /admin/v1/surveys/{id}/analytics/question/{questionKey}` | 单题分布（选项占比/分值直方图/NPS 分段） |
| `POST /admin/v1/surveys/{id}/analytics/crosstab` | 交叉透视（维度×题目，如学段×NPS 分段） |
| `GET /admin/v1/surveys/{id}/analytics/open-text` | 开放题列表（含情感标注，分页） |
| `POST /admin/v1/surveys/{id}/export` | 导出申请（异步，走统一文件生成中心；CONTACT 级数据需二级审批） |

### 5.3 匿名 Web 问卷（家长会/线下/B 端场景）

`GET /w/survey/{anonToken}`（无需登录，H5 渲染同一份 DSL）
`POST /w/survey/{anonToken}/submit`（同 5.1.4 语义，response 以 anon_token 关联，不落 user_id）

限流：单 token 每分钟 ≤ 10 次提交尝试；提交前如配置了人机验证则强制。

### 5.4 内部服务接口（Feign/RPC）

| 接口 | 方向 | 说明 |
| --- | --- | --- |
| `POST /internal/v1/surveys/eligible` | 供运营弹窗引擎/消息卡片调度调用 | 传入 userId+scene，返回可投放问卷卡片或空（触达裁决的唯一入口，见 §6.1） |
| `POST /internal/v1/surveys/events` | → 消息总线 | 发布 `SURVEY_SUBMITTED`（含 surveyCode/type/role/grade/npsScore 摘要），教师画像、指标中心消费 |
| `POST /internal/v1/surveys/nps/query` | 供 B 端合作/驾驶舱查询 | 入参 surveyCode+dimension+dateRange，返回快照序列（`avg_nps` 由 0-100 分制换算） |
| `POST /internal/v1/incentive/settle-result` | ← 积分服务回调 | 结算结果回写 SETTLED/ROLLED_BACK |
| `POST /internal/v1/surveys/text-audit-callback` | ← 内容安全审核回调 | 开放题掩码结果与 QualityFlag 标记 |

---

## 6. 核心业务流程

### 6.1 触达决策流程（可答判定，责任链）

任何渠道想向用户出示问卷，必须经过统一裁决（`POST /internal/v1/surveys/eligible` 或客户端 `pending` 接口内部同链路）：

```text
输入: userId, scene
 ①投放候选集: status=RUNNING 且 trigger.scene 匹配 且 begin≤now≤end
 ②全局开关: survey.enabled 且用户未关闭"帮助改进"设置（设置页可关，默认开）
 ③频控闸门（Redis）:
     survey:freq:{userId}:30d  计数 < 2
     survey:freq:{userId}:7d   计数 < 1
     survey:cooldown:{userId}:{surveyCode} 不存在（同问卷冷却 90 天）
 ④定向匹配: targeting_json 圈选（调标签分群引擎的位图/标签快照，本地缓存 5min）
 ⑤一人一卷: survey_invitation 无该 campaign 的有效记录（含 SUBMITTED/DISMISSED）
 ⑥配额判定: 用户所属配额桶 got_cnt < target_cnt（缓存计数 + DB 乐观锁兜底）
 ⑦注意力预算: 调通知疲劳/注意力预算引擎预算扣减检查（本问卷列为"低优先级打扰"）
 ⑧未成年保护: STUDENT 角色仅放行 anonymous_mode=true 且 pii_level=NONE 的问卷；
            22:00-08:00 不投放（与推送静默期一致）
输出: 0~1 份问卷 + 创建 invitation（CREATED，expire_at=now+72h）
```

裁决结果缓存 Redis 60s（key：`survey:elig:{userId}:{scene}`），弹窗引擎与客户端共用，避免重复建邀请。

### 6.2 答卷提交流程

```text
客户端 submit(clientResponseId)
 ①幂等检查: uk_response_client 命中 → 直接返回首次结果
 ②锁 invitation（FOR UPDATE），校验状态 STARTED 且未过期、投放仍 RUNNING
 ③服务端答案校验（按 version_no 的 schema）:
    - 必填题缺答且未被 displayWhen 隐藏 → 41903 SCHEMA_REQUIRED_MISSING
    - 选项 id 非法 / 数值越界 → 41904 ANSWER_INVALID
    - 提交了被隐藏题的答案 → 整卷 REJECTED + 41905 LOGIC_VIOLATION
 ④质量初筛（同步）: TOO_FAST / STRAIGHT_LINING → 打 flag，激励暂 PENDING
 ⑤开放题文本 → 内容安全机审（异步 mq，掩码结果回调前 text_value 存临时密文）
 ⑥事务落库: response(SUBMITTED) + answers 批量 insert + quota 乐观扣减 + invitation SUBMITTED
 ⑦事务后异步: 发 SURVEY_SUBMITTED 事件、写频控计数(+1)、CSAT/NPS 即时增量（快照仍以日终为准）
 ⑧激励: 按 incentive_json → PENDING，进延迟队列 T+1 复核
```

### 6.3 NPS/CSAT 计算管线（日终）

```text
每日 02:10 NpsAggregateJob（延迟任务调度引擎注册，可重跑、幂等）:
 ①扫描昨日 SUBMITTED 且 quality_flag=OK 的 nps 题 answer
 ②按维度组合切分（ALL / GRADE / MEMBER_TIER / CHANNEL / ORG）
 ③分段计数: promoters(9-10) / passives(7-8) / detractors(0-6)
 ④nps_score = round((promoters - detractors) * 100 / responses)
 ⑤confidence: responses ≥ 30 → HIGH
 ⑥UPSERT nps_daily_snapshot（含 window_days=30 滚动窗口重算）
 ⑦推送统一指标中心: metric=nps_score{survey=...,dim=...}（Gauge）
 ⑧B 端机构维度（ORG）额外校验最小样本，n<10 不对外返回（合同隐私约定）
```

### 6.4 激励发放与反刷

```text
T+1 复核 Job（settle_at 到期）:
 ①条件: SUBMITTED + quality_flag=OK + 无 SUSPECT_DUPLICATE + 设备指纹当日答卷 ≤ 2
 ②GRANTED → 调积分服务（业务类型 SURVEY_REWARD，biz_no=response_no）
 ③成功回调 → SETTLED；失败 → 重试 3 次（退避 10min/1h/6h）→ 仍失败告警人工
 ④复核发现刷量（多账号同设备/开放题灌水）→ ROLLED_BACK + response→REJECTED + 设备入风控名单
高价值激励（≥200 积分）: 提交前强制人机验证（统一人机验证引擎）
```

### 6.5 未成年人合规流程（关键流）

```text
发布侧:
  pii_level=CONTACT 或含个人信息诱导题 → 强制 PENDING_REVIEW 人工合规复审
投放侧:
  audience_role=STUDENT → 仅 anonymous_mode=true + pii_level=NONE 可投放
  家长端 CONTACT 问卷 → 仅 PARENT 角色账号可见
收集侧:
  学生答卷不采集姓名/联系方式/精确位置；grade 仅到年级粒度
  开放题 → UGC 机审（未成年人可能在文本中暴露隐私：手机号正则掩码、住址关键词掩码、自伤类关键词转《学生AI对话心理危机信号检测》同款上报通道）
存储侧:
  答卷保留 180 天 → ARCHIVED_MASKED；匿名模式答卷不可反查 user_id（response 无 user_id，invitation 过期清理）
```

### 6.6 教师评教联动（EVAL 类型）

1. 教务/运营创建 EVAL 问卷（学生版、家长版各一份 survey），题干支持 `{{teacherName}}` 占位。
2. 投放 `targeting_json.classIds=[...]`：按班级圈选学生/家长；提交时客户端在 `meta` 传 `teacherId`，服务端校验该教师在班级任课关系内（调教师班级管理服务），否则 `41906 EVAL_TARGET_INVALID`。
3. 提交成功 → `SURVEY_SUBMITTED` 事件携带 `surveyCode=teacher_satisfaction` / `parent_teacher_eval` 与分数摘要，教师专业发展画像引擎按其 `survey_based` 规则消费计算。
4. 评教结果对教师本人延迟可见（学期结束后统一开放），明细永远仅维度聚合可见（不暴露单人答卷，n<5 的班级聚合不返回）。

### 6.7 与运营弹窗引擎的协同

- 本平台向弹窗引擎注册"问卷卡片"类型资源（含 priority=SURVEY、expiry、频控元信息）。
- 弹窗引擎按其全局优先级仲裁决定是否真正展示；展示后回调本平台 `invitation → SHOWN`。
- 用户点击卡片 → 深链 `primetop://survey/{invitationId}` 进入问卷页（复用客户端路由与深链接系统）。

---

## 7. 关键代码实现

### 7.1 模块结构（Spring Boot 单模块，归属 growth 域）

```text
survey-svc
├── controller/        (ClientSurveyController / AdminSurveyController / InternalController / WebAnonController)
├── service/
│   ├── EligibilityService        触达裁决责任链编排
│   ├── SurveyPublishService      发布校验+版本物化
│   ├── ResponseSubmitService     提交（幂等+校验+事务）
│   ├── QualityService            质量初筛
│   ├── IncentiveService          激励状态机
│   └── NpsAggregateService       快照聚合与指标推送
├── domain/            (SurveyDefinition / SurveyCampaign / SurveyResponse 聚合 + 状态机)
├── repo/              (Spring Data JPA + 少量原生 SQL)
├── mq/                (SurveyEventPublisher / TextAuditCallbackListener / IncentiveSettleCallbackListener)
├── job/               (NpsAggregateJob / IncentiveSettleJob / InvitationExpireJob / CampaignLifecycleJob)
└── client/            (TagCenterClient / PointsClient / AttentionBudgetClient / TextAuditClient)
```

### 7.2 触达裁决责任链（核心）

```java
@Component
public class EligibilityService {

    private final List<EligibilityFilter> filters; // 顺序: 开关→频控→定向→一人一卷→配额→注意力→未成年
    private final InvitationRepository invitationRepo;
    private final RedisTemplate<String, String> redis;

    public Optional<PendingSurveyVO> decide(Long userId, String scene) {
        List<SurveyCampaign> candidates = campaignRepo.findRunningByScene(scene);
        for (SurveyCampaign c : candidates) {
            EligibilityContext ctx = EligibilityContext.of(userId, scene, c);
            if (filters.stream().allMatch(f -> f.pass(ctx))) {
                SurveyInvitation inv = invitationRepo.createIfAbsent(c, userId, expiry(c)); // 唯一冲突→下一个候选
                if (inv != null) {
                    cacheDecision(userId, scene, inv);   // Redis 60s，弹窗引擎与客户端共用
                    return Optional.of(PendingSurveyVO.of(inv, c));
                }
            }
        }
        return Optional.empty();
    }
}

/** 频控闸门：30天≤2份、7天≤1份、同问卷90天冷却 */
@Component
public class FrequencyFilter implements EligibilityFilter {
    public boolean pass(EligibilityContext ctx) {
        String u = "survey:freq:" + ctx.userId();
        if (Long.parseLong(redis.opsForValue().get(u + ":30d") == null ? "0" : ...) >= 2) return false;
        if (...get(u + ":7d") >= 1) return false;
        if (redis.hasKey("survey:cooldown:" + ctx.userId() + ":" + ctx.survey().getCode())) return false;
        return true;
    }
}

/** 未成年保护：学生端仅匿名统计型问卷，且夜间不投放 */
@Component
public class MinorProtectionFilter implements EligibilityFilter {
    public boolean pass(EligibilityContext ctx) {
        if (ctx.role() != Role.STUDENT) return true;
        if (LocalTime.now().isAfter(NIGHT_START) || LocalTime.now().isBefore(NIGHT_END)) return false;
        SurveyDefinition s = ctx.survey();
        return s.isAnonymousMode() && s.getPiiLevel() == PiiLevel.NONE;
    }
}
```

### 7.3 提交服务（幂等 + 逻辑校验 + 事务）

```java
@Service
public class ResponseSubmitService {

    @Transactional
    public SubmitResultVO submit(String responseNo, SubmitCmd cmd) {
        // ① 幂等（唯一索引兜底）
        SurveyResponse exist = responseRepo.findByClientResponseId(cmd.clientResponseId());
        if (exist != null) return SubmitResultVO.of(exist);

        SurveyResponse resp = responseRepo.findByResponseNoForUpdate(responseNo); // SELECT ... FOR UPDATE
        Assert.isTrue(resp.getStatus() == ResponseStatus.DRAFT, () -> new BizException(41902, "SURVEY_RESPONSE_STATE"));

        SurveyVersion ver = versionRepo.get(resp.getSurveyId(), resp.getVersionNo());
        SurveySchema schema = SurveySchema.parse(ver.getSchemaJson());

        // ② 服务端二次校验：必填/选项/逻辑一致性
        Violation v = schema.validate(cmd.answers());
        switch (v.type()) {
            case REQUIRED_MISSING -> throw new BizException(41903, "SURVEY_REQUIRED_MISSING");
            case ANSWER_INVALID   -> throw new BizException(41904, "SURVEY_ANSWER_INVALID");
            case LOGIC_VIOLATION  -> { resp.reject(); return SubmitResultVO.rejected(); } // 隐藏题有答案：整卷拒
        }

        // ③ 落库
        resp.submit(cmd.durationMs(), qualityService.preScreen(schema, cmd));
        answerRepo.bulkInsert(resp.getId(), schema.materializeAnswers(cmd.answers()));
        quotaService.tryConsume(resp);                 // 乐观锁，桶满仅告警不回滚（答卷有效）
        invitationRepo.markSubmitted(resp.getInvitationId());

        // ④ 事务后异步（TransactionSynchronization）
        afterCommit(() -> {
            eventPublisher.publishSurveySubmitted(resp, schema, cmd);
            freqCounter.increment(resp.getUserId());
            incentiveService.onSubmitted(resp);
            textAuditClient.submitAsync(schema.openTexts(cmd.answers()), resp);
        });
        return SubmitResultVO.of(resp);
    }
}
```

### 7.4 NPS 日聚合 SQL

```sql
-- 幂等重跑：先删当日快照再写
WITH seg AS (
  SELECT r.grade, r.member_tier, r.channel_snapshot AS channel,
         a.number_value,
         CASE WHEN a.number_value >= 9 THEN 'P' WHEN a.number_value >= 7 THEN 'N' ELSE 'D' END AS seg
  FROM survey_response r
  JOIN survey_answer a ON a.response_id = r.id AND a.question_key = 'nps_score'
  WHERE r.survey_id = $1 AND r.status = 'SUBMITTED'
    AND r.quality_flag = 'OK'
    AND a.number_value BETWEEN 0 AND 10
    AND r.submitted_at >= date_trunc('day', $2::date)
    AND r.submitted_at <  date_trunc('day', $2::date) + interval '1 day'
)
INSERT INTO nps_daily_snapshot
  (survey_code, stat_date, dimension, dim_value, window_days,
   promoters, passives, detractors, responses, nps_score, confidence)
SELECT $3, $2::date, 'ALL', 'ALL', 1,
       COUNT(*) FILTER (WHERE seg='P'), COUNT(*) FILTER (WHERE seg='N'),
       COUNT(*) FILTER (WHERE seg='D'), COUNT(*),
       ROUND((COUNT(*) FILTER (WHERE seg='P') - COUNT(*) FILTER (WHERE seg='D')) * 100.0 / COUNT(*)),
       CASE WHEN COUNT(*) >= 30 THEN 'HIGH' ELSE 'LOW' END
FROM seg
ON CONFLICT (survey_code, stat_date, dimension, dim_value, window_days)
DO UPDATE SET promoters = EXCLUDED.promoters, passives = EXCLUDED.passives,
              detractors = EXCLUDED.detractors, responses = EXCLUDED.responses,
              nps_score = EXCLUDED.nps_score, confidence = EXCLUDED.confidence;
```

### 7.5 客户端问卷渲染引擎（Flutter，核心思路）

```dart
/// 问卷页 = 分组分页的题目流；displayWhen 本地求值决定显隐
class SurveyPage extends StatefulWidget { final SurveySchema schema; /* ... */ }

abstract class QuestionWidget extends StatelessWidget {
  factory QuestionWidget.forType(Question q, AnswerNotifier notifier) =>
      switch (q.type) {
        'nps'          => NpsScaleWidget(q, notifier),      // 0-10 色带（红→绿）
        'csat'         => CsatFacesWidget(q, notifier),     // 1-5 表情脸
        'single_choice' => SingleChoiceWidget(q, notifier),
        'multi_choice'  => MultiChoiceWidget(q, notifier, maxSelect: q.maxSelect),
        'scale'        => ScaleWidget(q, notifier),
        'open_text'    => OpenTextWidget(q, notifier, maxLength: q.maxLength),
        'matrix'       => MatrixWidget(q, notifier),
        _              => NoticeWidget(q),
      };
}

/// 显隐求值与服务端 displayWhen 同构（同一 JSON 规则，Dart/Java 双端实现 + 用例对齐）
bool evaluateDisplay(Map<String, dynamic> when, Map<String, AnswerValue> answered) {
  return switch (when['op'] as String) {
    'eq'       => answered[when['question']] == AnswerValue.opt(when['value']),
    'in'       => (when['values'] as List).any((v) => answered[when['question']] == AnswerValue.opt(v)),
    'range'    => _inRange(answered[when['question']], when['gte'], when['lte']),
    'notnull'  => answered.containsKey(when['question']),
    'and'      => (when['children'] as List).every((c) => evaluateDisplay(c, answered)),
    'or'       => (when['children'] as List).any((c) => evaluateDisplay(c, answered)),
    _          => true,
  };
}
```

客户端细节（分页策略、键盘避让、无障碍、断网草稿本地持久化）遵循《客户端-动态化运营活动页面与JSON驱动渲染引擎》《客户端本地持久层与数据管理》《客户端-页面状态模式》既有规范，本文不重复展开。

---

## 8. 错误处理

### 8.1 统一错误码（41900-41999，登记入统一异常码体系）

| 错误码 | 场景 | 用户文案 | 处理策略 |
| --- | --- | --- | --- |
| 41900 SURVEY_NOT_FOUND | 问卷/版本不存在 | 问卷不存在或已下线 | 引导返回，终态 |
| 41901 SURVEY_INVITATION_INVALID | 邀请已过期/已答/已拒 | 该问卷已结束 | 终态，清本地入口 |
| 41902 SURVEY_RESPONSE_STATE | 答卷状态非法（重复提交且非同幂等键） | 请勿重复提交 | 返回首次结果 |
| 41903 SURVEY_REQUIRED_MISSING | 必填题缺答 | 还有必填题未完成 | 客户端定位到该题 |
| 41904 SURVEY_ANSWER_INVALID | 选项/数值非法 | 答案格式不正确 | 客户端刷新 schema |
| 41905 SURVEY_LOGIC_VIOLATION | 提交了隐藏题答案（疑似脚本） | 提交失败，请重试 | 整卷 REJECTED + 风控记录 |
| 41906 SURVEY_EVAL_TARGET_INVALID | 评教对象与班级不符 | —— | 终态 |
| 41907 SURVEY_QUOTA_FULL | 配额已满（提交时兜底） | 名额已满，感谢参与 | 记参与安慰积分（可配） |
| 41908 SURVEY_FREQ_LIMIT | 高频请求 eligible | —— | 限流 429 |
| 41910 SURVEY_INCENTIVE_SETTLE_FAIL | 积分结算失败 | 奖励发放中，稍后到账 | 补偿重试+告警 |
| 41911 SURVEY_SCHEMA_INVALID | 发布校验失败（管理端） | —— | 返回具体校验项 |

### 8.2 并发与一致性场景

| 场景 | 机制 |
| --- | --- |
| 同一答卷并发提交 | `uk_response_client` 幂等 + `FOR UPDATE` 状态锁 |
| 配额并发扣减 | 乐观锁 `got_cnt < target_cnt`；扣减失败答卷仍有效（仅影响投放停止） |
| 一人一卷并发建邀请 | `UNIQUE(campaign_id, user_id)`，冲突即放弃 |
| 快照重跑 | UPSERT 幂等，Job 以 `(survey_code, date)` 分布式锁防并发 |
| 事件重复投递 | 消费方按 `response_no` 幂等（事件契约含唯一键） |

### 8.3 降级策略

- eligible/pending 接口 P99 > 300ms 或异常 → 返回空列表（问卷永远不该阻塞首页/AI 链路）。
- 标签分群引擎不可用 → 跳过定向要求不高的全量投放（targeting 为空时），定向投放直接判定不适配。
- 积分服务不可用 → 激励停留 GRANTED，延迟任务自动重试，用户侧提示"发放中"。
- 审核回调超时（>10min）→ 开放题文本保持密文、分析看板该字段显示"审核中"，不阻塞其他题目统计。

---

## 9. 缓存与性能设计

| Key / 手段 | 内容 | TTL | 说明 |
| --- | --- | --- | --- |
| `survey:schema:{surveyId}:{ver}` | 完整 schema_json | 24h | 发布/关闭时主动失效 |
| `survey:elig:{userId}:{scene}` | 裁决结果 | 60s | 弹窗引擎与客户端共用 |
| `survey:freq:{userId}:30d / :7d` | 计数 | 30d / 7d | 提交成功后 INCR |
| `survey:cooldown:{userId}:{code}` | "1" | 90d | 同问卷冷却 |
| `survey:answered:bloom:{surveyCode}` | 已答用户布隆 | 投放期 | 一人一卷预过滤，防 DB 扫描（误判率 1%，兜底仍查 DB 唯一约束） |
| 配额桶计数本地缓存 | got_cnt | 10s | 展示用，扣减以 DB 为准 |

容量估算（DAU 50 万）：同时在线投放 ≤ 20 份；eligible QPS 峰值 ≈ DAU×10%×2 ≈ 10 万/日，全部走缓存命中；答卷提交峰值 5 万/日，单表月增 ≈ 150 万行——`survey_response`/`survey_answer` 按 `submitted_at` 月分表（复用存储资源生命周期管理引擎的归档策略：18 个月归档至对象存储 Parquet）。

---

## 10. 数据统计与运营分析

### 10.1 平台自身运营指标（接入统一指标中心）

| 指标 | 口径 | 告警阈值 |
| --- | --- | --- |
| 曝光→开始率 | STARTED/SHOWN | < 10% 触发问卷体验复盘 |
| 开始→完成率 | SUBMITTED/STARTED | < 60%（FORM 型） |
| 中位答题时长 | median(duration_ms) | 偏离 estimate_min×2 倍预警 |
| 质量否决率 | REJECTED/SUBMITTED | > 5% 触发风控策略复核 |
| 激励成本 | SUM(points settled)/月 | 超预算 20% 告警 |
| 样本代表性偏差 | 各配额桶 got/target 离散度 | 单桶 > 1.5× 或 < 0.3× 预警 |

### 10.2 对外产出指标（本平台为定义方）

| 指标 | 语义 | 消费方 |
| --- | --- | --- |
| `nps_score{survey, dim}` | 0-100，滚动 30 天窗口优先 | 驾驶舱、B 端 API（avg_nps）、管理层周报 |
| `csat_score{scene}` | 满意(4-5)占比 0-100 | AI 质量看板（与点赞满意率交叉验证） |
| `survey_response_rate` | 回收率 | 运营复盘 |

置信度规则：`confidence=LOW`（n<30）的快照在驾驶舱标注"样本不足"，不进入对外 API 返回（B 端合同约定 n≥10）。

### 10.3 开放题分析

1. 机审掩码 → NLP 管线分词 + 情感极性（POS/NEG/NEU 回填 `text_sentiment`）。
2. 高频词 Top50 + 否定词共现（"找不到 错题"）自动生成主题摘要供运营看板。
3. 命中产品缺陷关键词（崩溃/闪退/错题丢失）→ 自动转《用户反馈数据深度分析》工单池。

### 10.4 数据导出

走统一文件生成中心异步导出；`pii_level=NONE` 问卷一级审批，`CONTACT` 级二级审批 + 导出水印 + 7 天链接有效期；导出行为全量审计日志。

---

## 11. 安全与未成年人合规

| 主题 | 要求 | 实现点 |
| --- | --- | --- |
| 匿名默认 | 学生端问卷默认不关联身份 | `anonymous_mode=true` 强制、response 不落 user_id |
| 最小化采集 | 禁止采集与调研目的无关字段 | 发布校验 §3.4-6 + 人工复审 |
| 监护人同意 | 涉及未成年人个人信息的调研需监护人同意 | CONTACT 级仅投家长端账号 |
| 开放题风险 | 未成年人文本中暴露隐私/负面情绪 | 机审掩码 + 心理危机关键词转上报通道（复用既有分级预警编排） |
| 保留期限 | 答卷明细 180 天 | ARCHIVED_MASKED 定时任务；归档数据仅保留聚合 |
| 越权防护 | 只能查自己有权限的投放数据 | 管理端数据权限走统一数据权限框架（运营仅见自己域） |
| 防套利 | 激励刷量 | 人机验证 + 设备指纹 + T+1 结算 + 黑名单回滚 |

---

## 12. 部署与配置

### 12.1 部署形态

无状态服务 ×2 起步（CPU 2C/4G），依赖：PostgreSQL（主存储）、Redis（频控/缓存）、RocketMQ（事件）、调度引擎（Job）。无 GPU 依赖；NLP/审核全部外调。

### 12.2 配置项（配置中心，支持热更）

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `survey.enabled` | true | 全局开关（事故止血） |
| `survey.freq.userPer30d` | 2 | 单用户 30 天可答份数 |
| `survey.freq.userPer7d` | 1 | 单用户 7 天可答份数 |
| `survey.freq.surveyCooldownDays` | 90 | 同问卷冷却 |
| `survey.invitation.expireHours` | 72 | 邀请有效期 |
| `survey.retention.days` | 180 | 答卷保留期 |
| `survey.night.quiet` | 22:00-08:00 | 学生端静默窗口 |
| `survey.incentive.captchaThreshold` | 200 | 需人机验证的积分数 |
| `survey.eligible.cacheSeconds` | 60 | 裁决缓存 |

---

## 13. 测试要点

1. DSL 校验单测：循环 displayWhile 拓扑、NPS 缺题、key 冲突、超长开放题。
2. 提交幂等：同 clientResponseId 并发 10 连发仅 1 条落库。
3. 逻辑一致性：脚本提交隐藏题答案 → REJECTED + 41905。
4. 配额并发：100 并发抢 target=50 桶，got_cnt ≤ 50，超配答卷仍有效。
5. 频控：30 天第 3 份被拦；冷却期内同问卷不再触达。
6. 未成年拦截：STUDENT 角色 + CONTACT 问卷 → 不投放；夜间窗口不出邀请。
7. NPS 聚合重跑幂等；n=29 → LOW、n=30 → HIGH；B 端 n<10 不返回。
8. 激励链路：积分服务超时 → GRANTED 停留 + 重试 3 次 + 告警；刷量 → ROLLED_BACK。
9. 降级：eligible 依赖故障时首页无感（返回空）。
10. 双端 displayWhen 求值一致性：同一组用例 JSON 在 Java 与 Dart 单测中对齐（CI 交叉运行用例集）。

---

## 14. 灰度与演进

1. **灰度**：首月仅 CSAT 微调研（AI 讲解满意率）上线，特征开关 `survey.csat.enabled`；稳定后放开 NPS 季度调研与 FORM。
2. **演进方向**：
   - 问卷模板库（NPS/CSAT/评教/开学调研预置模板，运营一键创建）；
   - 回答驱动的分支调研（根据 NPS 低分自动触发深度归因小问卷，最多一层，防套娃）；
   - 语音开放题（复用 ASR，面向低学段）；
   - 埋点联动：`survey_dismiss` 事件回流用户标签，优化投放人群。
3. **对接清单（本文档落地时需同步登记）**：
   - 统一异常码体系：登记 41900-41999；
   - 统一指标中心：注册 `nps_score` / `csat_score` / `survey_response_rate` 语义；
   - 教师画像引擎：确认 `SURVEY_SUBMITTED` 事件契约字段（surveyCode/teacherId/score 摘要）；
   - B 端 API 网关：`avg_nps` 取数切换为本平台 `/internal/v1/surveys/nps/query`。
