# 学习数据仓库与 BI 分析平台 - 详细设计

## 1. 概述

### 1.1 目标

构建离线数据仓库与 BI 分析平台，将客户端埋点事件、业务数据库变更、AI 调用日志等原始数据经过清洗、加工、聚合后，形成面向分析的主题数据模型，为运营决策、产品迭代、商业分析和学习效果评估提供数据支撑。

### 1.2 设计原则

| 原则 | 说明 |
|------|------|
| 分层解耦 | ODS → DWD → DWS → ADS 四层架构，每层职责明确 |
| 幂等可重跑 | 所有 ETL 任务支持指定日期重跑，不产生重复数据 |
| 数据质量先行 | 每层入库前执行质量校验，异常数据不入库并告警 |
| 成本可控 | 使用 ClickHouse + MySQL 混合架构，避免重度依赖商业 BI 工具 |
| 渐进建设 | 先覆盖核心主题域（用户、学习、营收），后续扩展内容、AI 质量等 |

### 1.3 技术选型

| 组件 | 选型 | 说明 |
|------|------|------|
| 数据仓库引擎 | ClickHouse | 已用于实时指标，复用为离线分析存储 |
| ETL 调度 | Airflow (自建) 或 Celery + 定时任务 | 与现有 Celery 基础设施统一 |
| 数据同步 | Debezium CDC + 自研 Batch Sync | 实时表用 CDC，历史表用批量 |
| 数据湖存储 | MinIO / 阿里云 OSS | 存放原始日志 Parquet 文件 |
| BI 查询层 | Metabase (开源) | 嵌入式看板 + 自助分析 |
| 数据质量 | Great Expectations / 自研校验框架 | 规则化数据质量检查 |
| 报表导出 | WeasyPrint (PDF) + OpenPyXL (Excel) | 定时报表生成 |

---

## 2. 数据仓库分层架构

### 2.1 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      数据源层 (Source)                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ 业务DB   │ │ 埋点事件 │ │ AI调用日志│ │ 第三方数据│       │
│  │ (MySQL)  │ │(ClickHouse)│(ClickHouse)│  (OSS)   │       │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘       │
│       │            │            │            │              │
│  ┌────▼────────────▼────────────▼────────────▼─────┐       │
│  │              ODS 层 (操作数据存储)                │       │
│  │         原始数据 1:1 同步，不做加工               │       │
│  └────────────────────┬────────────────────────────┘       │
│                       │                                     │
│  ┌────────────────────▼────────────────────────────┐       │
│  │             DWD 层 (明细宽表)                     │       │
│  │        清洗、标准化、维度关联、去重                │       │
│  └────────────────────┬────────────────────────────┘       │
│                       │                                     │
│  ┌────────────────────▼────────────────────────────┐       │
│  │             DWS 层 (汇总层)                       │       │
│  │      按主题域预聚合：日/周/月粒度汇总              │       │
│  └────────────────────┬────────────────────────────┘       │
│                       │                                     │
│  ┌────────────────────▼────────────────────────────┐       │
│  │             ADS 层 (应用数据存储)                  │       │
│  │      直接服务 BI 看板、报表、API 查询              │       │
│  └─────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 各层详细说明

#### 2.2.1 ODS 层 (Operational Data Store)

**职责**：原始数据 1:1 同步，不做任何加工，保留完整历史。

**命名规范**：`ods_{source}_{table_name}`

| ODS 表名 | 来源 | 同步方式 | 分区键 | 保留周期 |
|----------|------|----------|--------|----------|
| `ods_mysql_user` | MySQL user 表 | CDC 实时 | `dt` (日期) | 365 天 |
| `ods_mysql_student_profile` | MySQL 学生档案 | CDC 实时 | `dt` | 365 天 |
| `ods_mysql_order` | MySQL 订单表 | CDC 实时 | `dt` | 3 年 |
| `ods_mysql_membership` | MySQL 会员表 | CDC 实时 | `dt` | 3 年 |
| `ods_mysql_question` | MySQL 题目表 | 批量每日 | `dt` | 永久 |
| `ods_mysql_mistake_record` | MySQL 错题记录 | CDC 实时 | `dt` | 2 年 |
| `ods_mysql_learning_session` | MySQL 学习会话 | CDC 实时 | `dt` | 2 年 |
| `ods_event_app_event` | ClickHouse 埋点 | 批量每小时 | `dt` + `hour` | 180 天 |
| `ods_event_ai_call_log` | ClickHouse AI 调用 | 批量每小时 | `dt` + `hour` | 365 天 |
| `ods_event_push_log` | ClickHouse 推送日志 | 批量每日 | `dt` | 180 天 |
| `ods_oss_textbook_resource` | OSS 教材资源清单 | 批量每周 | `dt` | 永久 |

**同步策略**：

```python
# ODS 同步任务基类
class ODSSyncTask:
    """ODS 数据同步基类"""

    sync_type: str  # "cdc" | "batch_hourly" | "batch_daily" | "batch_weekly"
    source_table: str
    target_table: str
    primary_keys: list[str]
    unique_keys: list[str]  # 去重键 = primary_keys + dt
    ttl_days: int

    def execute(self, dt: str):
        """
        执行同步：
        1. CDC 模式：从 Kafka topic 消费当日变更，按主键去重写入
        2. Batch 模式：从源表抽取增量，写入 ODS 表
        3. 写入前校验数据量（与昨日对比，偏差 >50% 则告警）
        """
        source_count = self._count_source(dt)
        yesterday_count = self._count_yesterday()

        # 数据量波动校验
        if yesterday_count > 0:
            ratio = source_count / yesterday_count
            if ratio < 0.5 or ratio > 2.0:
                alert(
                    level="warning",
                    msg=f"{self.target_table} 数据量波动异常: "
                        f"昨日={yesterday_count}, 今日={source_count}, "
                        f"比例={ratio:.2f}"
                )

        # 增量同步
        data = self._extract(dt)
        deduped = self._deduplicate(data)
        self._load(deduped, dt)

        # 质量校验
        self._quality_check(dt)
```

#### 2.2.2 DWD 层 (Data Warehouse Detail)

**职责**：清洗、标准化、维度关联，形成明细级事实宽表。

**命名规范**：`dwd_{domain}__{fact_name}`

**核心明细表**：

##### dwd_learning__session_detail (学习会话明细)

```sql
CREATE TABLE dwd_learning__session_detail
(
    -- 主键
    session_id          String,          -- 学习会话 ID
    user_id             UInt64,          -- 用户 ID
    dt                  Date,            -- 日期分区

    -- 用户维度
    student_grade       LowCardinality(String),  -- 年级编码
    grade_group         LowCardinality(String),  -- 学段: kindergarten/primary/junior_senior/senior
    textbook_version    LowCardinality(String),  -- 教材版本

    -- 会话维度
    session_type        LowCardinality(String),  -- ai_tutor|photo_search|sync_class|practice|review|mistake_review
    subject_code        LowCardinality(String),  -- 学科编码
    chapter_id          Nullable(String),        -- 章节 ID
    knowledge_point_ids Array(String),           -- 关联知识点列表

    -- AI 维度
    ai_model_used       Nullable(String),        -- 使用的 AI 模型
    ai_prompt_template  Nullable(String),        -- Prompt 模板 ID
    ai_call_count       UInt32 DEFAULT 0,        -- AI 调用次数
    ai_input_tokens     UInt32 DEFAULT 0,        -- 输入 token 数
    ai_output_tokens    UInt32 DEFAULT 0,        -- 输出 token 数
    ai_cost_cents       UInt32 DEFAULT 0,        -- AI 成本 (分)

    -- 学习指标
    duration_seconds    UInt32,                  -- 学习时长 (秒)
    question_count      UInt32 DEFAULT 0,        -- 做题数量
    correct_count       UInt32 DEFAULT 0,        -- 正确数量
    hint_used_count     UInt32 DEFAULT 0,        -- 使用提示次数

    -- 终端维度
    app_version         String,                  -- APP 版本
    platform            LowCardinality(String),  -- android|ios|web|mini_app
    device_id           String,                  -- 设备 ID

    -- 时间维度
    start_time          DateTime,                -- 会话开始时间
    end_time            Nullable(DateTime),       -- 会话结束时间
    hour_of_day         UInt8,                   -- 小时 (0-23)
    day_of_week         UInt8,                   -- 星期 (1-7)

    -- 质量标记
    is_valid            UInt8 DEFAULT 1,         -- 有效会话标记 (过滤 <5s)
    quality_flag        LowCardinality(String) DEFAULT 'normal'  -- normal|suspicious|bot
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(dt)
ORDER BY (user_id, dt, session_id)
TTL dt + INTERVAL 2 YEAR
```

##### dwd_user__event_detail (用户事件明细)

```sql
CREATE TABLE dwd_user__event_detail
(
    event_id            String,          -- 事件唯一 ID
    user_id             UInt64,
    dt                  Date,

    -- 事件维度
    event_name          LowCardinality(String),   -- 事件名
    event_category      LowCardinality(String),   -- 事件分类
    screen_name         Nullable(String),          -- 页面名称
    element_name        Nullable(String),          -- 元素名称

    -- 事件属性 (JSON)
    event_properties    String,                    -- JSON 格式事件属性

    -- 用户维度 (冗余，减少 JOIN)
    student_grade       LowCardinality(String),
    grade_group         LowCardinality(String),
    membership_level    LowCardinality(String) DEFAULT 'free',  -- free|monthly|annual|exam_prep

    -- 终端维度
    app_version         String,
    platform            LowCardinality(String),
    device_id           String,

    -- 时间维度
    event_time          DateTime,
    hour_of_day         UInt8,
    day_of_week         UInt8
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(dt)
ORDER BY (user_id, dt, event_time)
TTL dt + INTERVAL 180 DAY
```

##### dwd_revenue__order_detail (订单明细)

```sql
CREATE TABLE dwd_revenue__order_detail
(
    order_id            String,
    user_id             UInt64,
    dt                  Date,

    -- 订单维度
    order_type          LowCardinality(String),   -- subscription|addon|bundle
    product_id          String,
    product_name        String,
    membership_level    Nullable(String),          -- 购买的会员等级

    -- 金额 (分)
    original_amount     UInt32,                   -- 原价
    paid_amount         UInt32,                   -- 实付金额
    discount_amount     UInt32 DEFAULT 0,         -- 优惠金额
    ai_cost_allocated   UInt32 DEFAULT 0,         -- 分摊的 AI 成本

    -- 渠道
    payment_channel     LowCardinality(String),   -- wechat|alipay|apple_iap
    sales_channel       LowCardinality(String),   -- app|web|mini_app|promotion

    -- 状态
    order_status        LowCardinality(String),   -- paid|refunded|cancelled
    refund_amount       UInt32 DEFAULT 0,
    refund_reason       Nullable(String),

    -- 用户维度
    student_grade       LowCardinality(String),
    is_first_purchase   UInt8,                    -- 首次购买标记
    previous_level      Nullable(String),         -- 升级前等级

    -- 时间维度
    order_time          DateTime,
    pay_time            Nullable(DateTime)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(dt)
ORDER BY (user_id, dt, order_id)
TTL dt + INTERVAL 3 YEAR
```

##### dwd_content__question_usage_detail (题目使用明细)

```sql
CREATE TABLE dwd_content__question_usage_detail
(
    usage_id            String,          -- 使用记录 ID
    question_id         String,
    user_id             UInt64,
    dt                  Date,

    -- 来源
    source_type         LowCardinality(String),   -- practice|exam|mistake_review|ai_generated
    session_id          Nullable(String),

    -- 题目维度
    subject_code        LowCardinality(String),
    grade_code          LowCardinality(String),
    knowledge_point_ids Array(String),
    difficulty_level    LowCardinality(String),   -- easy|medium|hard|expert
    question_type       LowCardinality(String),   -- choice|fill|short_answer|essay|...

    -- 答题结果
    is_correct          UInt8,
    time_spent_seconds  UInt32,                   -- 答题耗时
    attempt_count       UInt32 DEFAULT 1,         -- 尝试次数
    hint_used           UInt8 DEFAULT 0,          -- 是否使用提示

    -- 用户维度
    student_grade       LowCardinality(String),
    membership_level    LowCardinality(String)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(dt)
ORDER BY (question_id, dt, user_id)
TTL dt + INTERVAL 2 YEAR
```

**DWD 清洗规则**：

```python
class DWDCleanser:
    """DWD 数据清洗引擎"""

    @staticmethod
    def cleanse_session(raw: dict) -> dict:
        """清洗学习会话记录"""
        # 1. 过滤无效会话 (时长 < 5秒)
        duration = raw.get("duration_seconds", 0)
        is_valid = 1 if duration >= 5 else 0

        # 2. 标记可疑会话 (同一用户 1 小时内 >100 次)
        # （由后续批量检测任务完成）

        # 3. 标准化学段分组
        grade_group = GradeMapper.to_group(raw["student_grade"])

        # 4. 补充缺失维度
        subject_code = raw.get("subject_code") or SubjectInferrer.from_session(raw)

        # 5. 计算衍生字段
        hour_of_day = raw["start_time"].hour
        day_of_week = raw["start_time"].isoweekday()

        return {
            **raw,
            "grade_group": grade_group,
            "is_valid": is_valid,
            "hour_of_day": hour_of_day,
            "day_of_week": day_of_week,
        }

    @staticmethod
    def cleanse_event(raw: dict) -> dict:
        """清洗埋点事件"""
        # 1. 去重 (基于 event_id)
        # 2. 过滤内部测试用户 (user_id IN test_user_set)
        # 3. 解析 event_properties JSON
        # 4. 补充用户维度
        return {
            **raw,
            "event_category": EventClassifier.category(raw["event_name"]),
            "grade_group": GradeMapper.to_group(raw.get("student_grade", "")),
        }
```

#### 2.2.3 DWS 层 (Data Warehouse Summary)

**职责**：按主题域预聚合，日/周/月粒度。

**命名规范**：`dws_{domain}__{metric}_{granularity}`

##### 核心汇总表清单

| DWS 表名 | 粒度 | 维度 | 核心指标 |
|----------|------|------|----------|
| `dws_user__daily_active` | 日 | grade_group, platform, membership_level | DAU, 新增用户, 活跃时长 |
| `dws_user__weekly_retention` | 周 | grade_group, cohort_week | 留存率 (次周~12周) |
| `dws_user__monthly_profile` | 月 | grade_group, membership_level | 月活, 人均使用天数, 人均时长 |
| `dws_learning__daily_summary` | 日 | user_id, subject_code, session_type | 学习时长, 做题数, 正确率 |
| `dws_learning__daily_user_agg` | 日 | user_id | 汇总当日全部学习指标 |
| `dws_learning__weekly_subject` | 周 | user_id, subject_code | 周学习时长, 周做题数, 正确率趋势 |
| `dws_learning__monthly_knowledge` | 月 | user_id, knowledge_point_id | 掌握度, 做题数, 错误数 |
| `dws_revenue__daily_summary` | 日 | product_id, sales_channel, membership_level | 订单数, GMV, 退款率 |
| `dws_revenue__monthly_cohort` | 月 | cohort_month, membership_level | LTV, 续费率, 流失率 |
| `dws_content__daily_question_stats` | 日 | question_id | 使用次数, 正确率, 平均耗时 |
| `dws_content__weekly_knowledge_coverage` | 周 | subject_code, grade_code | 知识点覆盖率, 题目充足率 |
| `dws_ai__daily_cost_summary` | 日 | model_id, scene_type | 调用次数, token 用量, 成本 |
| `dws_ai__monthly_user_cost` | 月 | user_id | 人均 AI 成本, 成本/收入比 |

##### dws_user__daily_active 建表示例

```sql
CREATE TABLE dws_user__daily_active
(
    dt                      Date,
    grade_group             LowCardinality(String),
    platform                LowCardinality(String),
    membership_level        LowCardinality(String),

    -- 核心指标
    dau                     UInt64,           -- 日活用户数
    new_users               UInt64,           -- 新增用户数
    returning_users         UInt64,           -- 回归用户数 (>7天未活跃)
    avg_session_duration    Float32,          -- 人均学习时长 (分钟)
    avg_sessions_per_user   Float32,          -- 人均会话数

    -- 留存指标 (需要 T+1 计算)
    retention_d1            Nullable(Float32), -- 次日留存率
    retention_d7            Nullable(Float32), -- 7日留存率

    -- 会员指标
    new_paid_users          UInt32,            -- 新付费用户
    paid_user_count         UInt32,            -- 付费用户总数
    paid_ratio              Float32            -- 付费率
)
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(dt)
ORDER BY (dt, grade_group, platform, membership_level)
```

##### dws_learning__daily_user_agg 建表示例

```sql
CREATE TABLE dws_learning__daily_user_agg
(
    dt                      Date,
    user_id                 UInt64,

    -- 汇总维度
    grade_group             LowCardinality(String),
    membership_level        LowCardinality(String),

    -- 学习指标
    total_duration_minutes  Float32,          -- 总学习时长 (分钟)
    session_count           UInt32,           -- 会话总数
    active_subjects         UInt8,            -- 涉及学科数
    question_count          UInt32,           -- 做题总数
    correct_rate            Float32,          -- 总正确率

    -- AI 指标
    ai_call_count           UInt32,           -- AI 调用次数
    ai_cost_cents           UInt32,           -- AI 成本 (分)

    -- 细分时长
    ai_tutor_duration       Float32 DEFAULT 0,   -- AI 辅导时长
    practice_duration       Float32 DEFAULT 0,   -- 练习时长
    sync_class_duration     Float32 DEFAULT 0,   -- 同步课堂时长
    mistake_review_duration Float32 DEFAULT 0,   -- 错题复习时长
    other_duration          Float32 DEFAULT 0    -- 其他时长
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(dt)
ORDER BY (user_id, dt)
TTL dt + INTERVAL 1 YEAR
```

#### 2.2.4 ADS 层 (Application Data Store)

**职责**：直接服务 BI 看板、管理后台 API、定时报表，按需查询优化。

**命名规范**：`ads_{app}__{report_name}`

| ADS 表/视图 | 服务对象 | 刷新频率 | 说明 |
|-------------|----------|----------|------|
| `ads_bi__user_funnel` | BI 看板 | 每日 | 注册→激活→付费漏斗 |
| `ads_bi__revenue_dashboard` | BI 看板 | 每日 | 营收总览、ARPU、LTV |
| `ads_bi__learning_overview` | BI 看板 | 每日 | 学习数据总览 |
| `ads_bi__content_quality` | BI 看板 | 每日 | 题目质量、覆盖率 |
| `ads_bi__ai_cost_report` | BI 看板 | 每日 | AI 成本分析 |
| `ads_ops__daily_brief` | 运营日报 | 每日 | 核心指标汇总 (自动推送) |
| `ads_ops__weekly_report` | 运营周报 | 每周 | 周级趋势 + 异常分析 |
| `ads_ops__cohort_analysis` | 运营分析 | 每月 | 同期群分析 |
| `ads_admin__user_stats` | 管理后台 API | 实时 | 用户统计查询 |
| `ads_admin__revenue_stats` | 管理后台 API | 准实时 | 营收统计查询 |

##### ads_bi__user_funnel 示例

```sql
-- 用户转化漏斗 (物化视图，每日刷新)
CREATE MATERIALIZED VIEW ads_bi__user_funnel
ENGINE = MergeTree()
PARTITION BY toYYYYMM(dt)
ORDER BY (dt, grade_group)
AS SELECT
    dt,
    grade_group,
    -- 漏斗各层
    countDistinctIf(user_id, event_name = 'app_open')                                          AS uv_app_open,
    countDistinctIf(user_id, event_name = 'session_start')                                     AS uv_session_start,
    countDistinctIf(user_id, event_name = 'ai_call')                                           AS uv_ai_used,
    countDistinctIf(user_id, event_name = 'practice_submit')                                   AS uv_practice,
    countDistinctIf(user_id, event_name = 'order_paid')                                        AS uv_paid,
    -- 转化率
    uv_session_start / nullIf(uv_app_open, 0)                                                  AS rate_open_to_session,
    uv_ai_used / nullIf(uv_session_start, 0)                                                   AS rate_session_to_ai,
    uv_practice / nullIf(uv_session_start, 0)                                                  AS rate_session_to_practice,
    uv_paid / nullIf(uv_app_open, 0)                                                           AS rate_open_to_paid
FROM dwd_user__event_detail
GROUP BY dt, grade_group
```

---

## 3. ETL 调度与任务编排

### 3.1 调度架构

采用 Celery Beat + 自研 DAG 管理器，复用现有 Celery 基础设施（参考《异步任务与事件驱动架构-详细设计》）。

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│  Celery Beat  │────▶│  DAG Scheduler   │────▶│  Task Queue  │
│  (定时触发)   │     │  (依赖解析/调度)  │     │  (Celery)    │
└──────────────┘     └──────────────────┘     └──────┬───────┘
                                                       │
                     ┌─────────────────────────────────┤
                     │                                 │
              ┌──────▼──────┐                   ┌──────▼──────┐
              │ ODS Worker  │                   │ DWD Worker  │
              └──────┬──────┘                   └──────┬──────┘
                     │                                 │
              ┌──────▼──────┐                   ┌──────▼──────┐
              │ DWS Worker  │                   │ ADS Worker  │
              └─────────────┘                   └─────────────┘
```

### 3.2 DAG 定义

```python
# warehouse/dags/daily_learning_dag.py

class DailyLearningDAG(BaseDAG):
    """每日学习数据仓库 ETL"""

    dag_id = "daily_learning_etl"
    schedule = "0 3 * * *"  # 每日 03:00
    max_active_runs = 1

    def build(self) -> list[TaskNode]:
        return [
            # ---- ODS 层 ----
            TaskNode(
                task_id="ods_sync_events",
                task=ods_sync_events.s(),
                timeout_minutes=60,
            ),
            TaskNode(
                task_id="ods_sync_business_db",
                task=ods_sync_business_db.s(),
                timeout_minutes=30,
            ),

            # ---- DWD 层 (依赖 ODS) ----
            TaskNode(
                task_id="dwd_cleanse_sessions",
                task=dwd_cleanse_sessions.s(),
                depends_on=["ods_sync_events", "ods_sync_business_db"],
                timeout_minutes=90,
            ),
            TaskNode(
                task_id="dwd_cleanse_events",
                task=dwd_cleanse_events.s(),
                depends_on=["ods_sync_events"],
                timeout_minutes=60,
            ),
            TaskNode(
                task_id="dwd_cleanse_orders",
                task=dwd_cleanse_orders.s(),
                depends_on=["ods_sync_business_db"],
                timeout_minutes=30,
            ),

            # ---- DWS 层 (依赖 DWD) ----
            TaskNode(
                task_id="dws_agg_user_daily",
                task=dws_agg_user_daily.s(),
                depends_on=["dwd_cleanse_events", "dwd_cleanse_sessions"],
                timeout_minutes=120,
            ),
            TaskNode(
                task_id="dws_agg_learning_daily",
                task=dws_agg_learning_daily.s(),
                depends_on=["dwd_cleanse_sessions"],
                timeout_minutes=90,
            ),
            TaskNode(
                task_id="dws_agg_revenue_daily",
                task=dws_agg_revenue_daily.s(),
                depends_on=["dwd_cleanse_orders"],
                timeout_minutes=30,
            ),

            # ---- ADS 层 (依赖 DWS) ----
            TaskNode(
                task_id="ads_refresh_bi_views",
                task=ads_refresh_bi_views.s(),
                depends_on=["dws_agg_user_daily", "dws_agg_learning_daily", "dws_agg_revenue_daily"],
                timeout_minutes=60,
            ),

            # ---- 报表生成 (依赖 ADS) ----
            TaskNode(
                task_id="generate_daily_brief",
                task=generate_daily_brief.s(),
                depends_on=["ads_refresh_bi_views"],
                timeout_minutes=15,
            ),

            # ---- 质量校验 ----
            TaskNode(
                task_id="quality_check_all_layers",
                task=quality_check_all_layers.s(),
                depends_on=["ads_refresh_bi_views"],
                timeout_minutes=30,
            ),
        ]
```

### 3.3 DAG 管理器核心实现

```python
# warehouse/dag_manager.py

from dataclasses import dataclass, field
from typing import Callable
from enum import Enum


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class TaskNode:
    task_id: str
    task: Callable                  # Celery task signature
    depends_on: list[str] = field(default_factory=list)
    timeout_minutes: int = 60
    retry_count: int = 3
    retry_delay_minutes: int = 5


@dataclass
class TaskExecution:
    task_id: str
    run_id: str
    dt: str                         # 业务日期
    status: TaskStatus = TaskStatus.PENDING
    started_at: float | None = None
    finished_at: float | None = None
    error_msg: str | None = None
    celery_task_id: str | None = None


class DAGExecutor:
    """DAG 执行器 - 管理任务依赖和执行状态"""

    def __init__(self, dag: BaseDAG):
        self.dag = dag
        self.nodes = {n.task_id: n for n in dag.build()}
        self.executions: dict[str, TaskExecution] = {}

    def run(self, dt: str, run_id: str | None = None):
        """执行整个 DAG"""
        run_id = run_id or f"{self.dag.dag_id}_{dt}_{int(time.time())}"
        self._init_executions(run_id, dt)

        # 拓扑排序执行
        ready = self._get_ready_tasks()
        while ready:
            for task_id in ready:
                self._execute_task(task_id, dt)
            ready = self._get_ready_tasks()

        # 检查是否有失败
        failed = [e for e in self.executions.values() if e.status == TaskStatus.FAILED]
        if failed:
            alert(
                level="error",
                msg=f"DAG {self.dag.dag_id} 执行完成但有 {len(failed)} 个任务失败",
                details=[{"task_id": e.task_id, "error": e.error_msg} for e in failed]
            )

    def _get_ready_tasks(self) -> list[str]:
        """获取当前可执行的任务（所有依赖已完成）"""
        ready = []
        for task_id, node in self.nodes.items():
            if task_id in self.executions and self.executions[task_id].status != TaskStatus.PENDING:
                continue
            deps_met = all(
                self.executions.get(dep, None)