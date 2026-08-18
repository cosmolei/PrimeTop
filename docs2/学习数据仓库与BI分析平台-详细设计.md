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
                self.executions[dep].status in (TaskStatus.SUCCESS, TaskStatus.SKIPPED)
                for dep in node.depends_on
            )
            if deps_met:
                ready.append(task_id)
        return ready

    def _execute_task(self, task_id: str, dt: str):
        """执行单个任务：CAS 抢占 → Celery 派发 → 超时/重试 → 终态回写"""
        node = self.nodes[task_id]
        execution = self.executions[task_id]

        # CAS 抢占：仅 PENDING -> RUNNING 成功才继续，防止调度器多副本重复派发
        if not self._cas_status(execution, TaskStatus.PENDING, TaskStatus.RUNNING):
            return
        execution.started_at = time.time()

        for attempt in range(1, node.retry_count + 1):
            execution.attempt = attempt  # v1.1 增补字段：TaskExecution 增加 attempt/rows_processed
            try:
                async_result = node.task.apply_async(
                    kwargs={"dt": dt, "run_id": execution.run_id, "attempt": attempt}
                )
                # 等待结果，超时视为失败（Celery SoftTimeLimitExceeded / result.get timeout）
                async_result.get(timeout=node.timeout_minutes * 60)
                execution.rows_processed = self._read_rows_processed(execution)
                self._cas_status(execution, TaskStatus.RUNNING, TaskStatus.SUCCESS)
                execution.finished_at = time.time()
                return
            except Exception as exc:
                execution.error_msg = str(exc)[:2000]
                if attempt < node.retry_count:
                    # 指数退避重试：5min -> 10min -> 20min（attempt 递增，状态保持 RUNNING）
                    time.sleep(node.retry_delay_minutes * 60 * (2 ** (attempt - 1)))
        self._cas_status(execution, TaskStatus.RUNNING, TaskStatus.FAILED)
        execution.finished_at = time.time()
        # 失败即阻断下游：所有传递依赖本任务的 PENDING 任务标记 SKIPPED
        self._skip_blocked_downstream(task_id)

    def _skip_blocked_downstream(self, failed_task_id: str):
        """BFS 标记因上游失败而被阻断的下游任务为 SKIPPED（不再轮询）"""
        queue = [failed_task_id]
        while queue:
            current = queue.pop(0)
            for task_id, node in self.nodes.items():
                if current in node.depends_on and \
                        self.executions[task_id].status == TaskStatus.PENDING:
                    # SKIPPED 视为“依赖已满足”，允许更下游任务按 G6 语义继续判断
                    self._cas_status(self.executions[task_id],
                                     TaskStatus.PENDING, TaskStatus.SKIPPED)
                    queue.append(task_id)

    def _mark_stale_pending_as_skipped(self):
        """run 收尾：仍为 PENDING 的任务（处于失败/取消传播盲区）统一标记 SKIPPED"""
        for execution in self.executions.values():
            if execution.status == TaskStatus.PENDING:
                self._cas_status(execution, TaskStatus.PENDING, TaskStatus.SKIPPED)

    def _cas_status(self, execution: TaskExecution,
                    expect: TaskStatus, target: TaskStatus) -> bool:
        """
        状态 CAS 回写（MySQL 权威）：
        UPDATE dw_task_execution SET status = :target, ...
        WHERE run_id = :run_id AND task_id = :task_id
          AND attempt = :attempt AND status = :expect
        受影响行数 = 1 视为成功；0 视为并发冲突（他副本已处理），返回 False。
        内存态 executions 仅作调度缓存，重启后从 dw_task_execution 重建。
        """
        raise NotImplementedError  # 实现见 3.3.2 元数据存储
```

#### 3.3.1 调度元数据存储（MySQL 权威）

DAG/任务执行状态以 MySQL 为权威存储，调度器内存态仅作缓存，重启后可从元数据表重建现场（见 D4 降级）。

```sql
CREATE TABLE dw_dag_definition (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    dag_id          VARCHAR(64) NOT NULL COMMENT 'DAG 标识，如 daily_learning_etl',
    name            VARCHAR(128) NOT NULL,
    schedule_cron   VARCHAR(64) NOT NULL COMMENT '5 字段 cron（Asia/Shanghai）',
    owner           VARCHAR(64) NOT NULL COMMENT '责任人域账号',
    enabled         TINYINT(1) DEFAULT 1,
    max_active_runs INT DEFAULT 1 COMMENT '同 DAG 最大并行 run 数（默认 1，串行）',
    timeout_minutes INT DEFAULT 240 COMMENT '整个 run 超时',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_dag_id (dag_id)
) ENGINE=InnoDB COMMENT='DAG 定义表（与代码内 BaseDAG 注册同步，后台可停用）';

CREATE TABLE dw_dag_run (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    run_id          VARCHAR(96) NOT NULL COMMENT 'scheduled 固定为 {dag_id}_{dt}；manual/backfill 追加 _{8位随机}',
    dag_id          VARCHAR(64) NOT NULL,
    dt              DATE NOT NULL COMMENT '业务日期',
    trigger_type    VARCHAR(16) NOT NULL DEFAULT 'scheduled' COMMENT 'scheduled|manual|backfill',
    status          VARCHAR(24) NOT NULL DEFAULT 'pending' COMMENT '见 §6.1 状态机',
    started_at      DATETIME(3) NULL,
    finished_at     DATETIME(3) NULL,
    duration_ms     BIGINT DEFAULT 0,
    error_summary   VARCHAR(2000) NULL,
    created_by      BIGINT UNSIGNED DEFAULT 0 COMMENT '0=系统调度',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_run_id (run_id),
    KEY idx_dag_dt (dag_id, dt, status)
) ENGINE=InnoDB COMMENT='DAG 运行实例表（scheduled 固定 run_id 实现触发幂等）';

CREATE TABLE dw_task_execution (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    run_id          VARCHAR(96) NOT NULL,
    task_id         VARCHAR(64) NOT NULL,
    dt              DATE NOT NULL,
    attempt         INT NOT NULL DEFAULT 1,
    status          VARCHAR(24) NOT NULL DEFAULT 'pending' COMMENT '见 §6.2 状态机',
    celery_task_id  VARCHAR(64) NULL,
    started_at      DATETIME(3) NULL,
    finished_at     DATETIME(3) NULL,
    duration_ms     BIGINT DEFAULT 0,
    rows_processed  BIGINT DEFAULT 0 COMMENT '处理行数（质量勾稽与容量统计用）',
    error_msg       TEXT NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_run_task_attempt (run_id, task_id, attempt),
    KEY idx_dt_status (dt, status)
) ENGINE=InnoDB COMMENT='任务执行实例表（CAS 状态机权威表）';

CREATE TABLE dw_scheduler_heartbeat (
    worker_id       VARCHAR(64) PRIMARY KEY,
    last_beat_at    DATETIME(3) NOT NULL,
    metadata        JSON NULL COMMENT '负载/队列长度等'
) ENGINE=InnoDB COMMENT='调度器心跳表（漏触发补偿检测用）';
```

#### 3.3.2 并发与多副本防护

| 防护点 | 机制 |
|--------|------|
| 调度触发幂等 | scheduled run_id 固定为 `{dag_id}_{dt}`，uk_run_id 撞键即返回已有 run（G1） |
| 同 DAG 串行 | `max_active_runs=1`：Redis `SETNX dw:dag_lock:{dag_id}` TTL 4h；锁丢失时以 dw_dag_run 中未终态 run 为准拒绝新 run（G2） |
| 任务重复派发 | dw_task_execution CAS（仅 pending→running / running→success|failed） |
| 回刷与调度互斥 | 同 (dag_id, dt) 存在未终态 run 时，backfill 排队等待（G7） |
| Celery 任务幂等 | 所有任务以 (dt, task_id) 为幂等键，重复执行结果一致（§3.5 分区重跑保证） |

#### 3.3.3 心跳与漏触发补偿（Catchup）

- 调度器每 30s 写心跳表；心跳延迟 >3min 告警 P1。
- 补偿协程每分钟扫描：对每个 enabled 的 DAG，若 `计划触发时刻 + 10min < now` 且 dw_dag_run 无对应 (dag_id, dt) 记录，自动补发 scheduled run 并告警（允许通过配置关闭某 DAG 的自动补发，改为仅告警）。

### 3.4 业务日期与数据归属口径

| 数据域 | 归属时间字段 | 跨界处理 |
|--------|--------------|----------|
| 埋点事件 | `event_time`（自然日，Asia/Shanghai） | 迟到事件按实际 dt 落地；若迟到 >24h 且影响已发布指标，登记回刷建议（WARN） |
| 学习会话 | `start_time` | 跨 0 点会话按时长秒数分摊到两日（单段 <60s 不拆） |
| 订单 | `pay_time` | 退款按 refund 完成时间归属退款日 |
| 题目使用 | 答题提交时间 | 重提交以最后一次为准 |
| CDC 变更 | `updated_at` | 同日多次变更取最新（ODS 按主键去重） |

**数据就绪屏障（Watermark）**：调度触发（03:00）时检查 `events.clean` 中目标 dt 的最大 `event_time`，≥ `dt 23:59:50` 视为完整；未达标仅告警不阻断（迟到事件由 T+1 补偿窗口吸收，见 D2）。

### 3.5 幂等写入与分区重跑

所有 DWD/DWS/ADS 任务必须满足：**同一 (table, dt) 重复执行任意次，结果与首次一致**。

**DWS/ADS 层（每日分区原子替换）**：

```
① INSERT INTO {table}__staging_{dt} SELECT ...        -- 写入同结构 staging 表
② QualityGate.check(staging)                            -- 质量门禁（§4），BLOCK 则任务失败，生产分区未被触碰
③ ALTER TABLE {table} REPLACE PARTITION '{dt}'
     FROM {table}__staging_{dt}                          -- 原子替换生产分区
④ 登记血缘变更 + 清理 staging
```

> **v1.0 DDL 勘误（3 处，本节修正，§2 示例以本节为准）**：
> 1. `dws_user__daily_active` 等日刷新 DWS 表原示例 `PARTITION BY toYYYYMM(dt)`，月分区下无法按日幂等重跑（DROP PARTITION 会误删整月）——统一修正为 `PARTITION BY dt`（ClickHouse 支持 Date 直接分区，日分区 TTL 滚动删除同样生效）；
> 2. `dws_user__daily_active` 原用 SummingMergeTree，后台 merge 会对留存率等 Nullable(Float32) 指标列做跨批求和，产生错误值——日分区整写场景改用普通 MergeTree；
> 3. `ads_bi__user_funnel` 原为普通 MATERIALIZED VIEW，CH MV 逐 insert 块触发，`countDistinctIf` 无法跨批合并，重跑/迟到数据会造成 UV 重复计数——改为由 `ads_refresh_bi_views` 任务按日分区重建的普通表（表结构不变），或升级为 `REFRESH EVERY 1 DAY` 物化视图（CH ≥22.8）。

**DWD 明细层（月分区 + Mutation 重跑）**：

```sql
-- 重跑某日明细：先删后写，mutation 同步等待完成后再 INSERT
ALTER TABLE dwd_learning__session_detail DELETE WHERE dt = '2026-08-18';
-- 轮询 system.mutations WHERE table = ... AND is_done = 1 后执行写入
INSERT INTO dwd_learning__session_detail SELECT ... ;
```

- DWD 重跑频率低（通常仅质量修复），保留月分区降低小文件压力；DELETE mutation 期间该 dt 查询可能读到中间态，因此 **ADS 刷新任务必须排在 DWD 全部任务之后**（§3.2 DAG 已满足该顺序约束）。
- ODS CDC 类表采用 ReplacingMergeTree(updated_at)，按主键去重，重放安全。

### 3.6 回刷（Backfill）

**场景**：口径变更、源数据修复、迟到数据补算、质量事故重算。

```sql
CREATE TABLE dw_backfill_job (
    id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    job_no            VARCHAR(32) NOT NULL COMMENT 'BF+yyyyMMdd+4位序列',
    dag_id            VARCHAR(64) NOT NULL,
    dt_start          DATE NOT NULL,
    dt_end            DATE NOT NULL,
    reason            VARCHAR(500) NOT NULL,
    skip_warn_gate    TINYINT(1) DEFAULT 0 COMMENT '仅可跳过 WARN 级门禁，BLOCK 级不可跳（G10）',
    status            VARCHAR(24) NOT NULL DEFAULT 'pending' COMMENT '见 §6.3',
    total_days        INT DEFAULT 0,
    finished_days     INT DEFAULT 0,
    created_by        BIGINT UNSIGNED NOT NULL,
    approved_by       BIGINT UNSIGNED NULL,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_job_no (job_no)
) ENGINE=InnoDB COMMENT='回刷任务表';
```

**执行流程与安全护栏**：

1. 提交校验：`dt_start ≤ dt_end`、不含未来日期、不超出各表保留期（超期部分自动截断并提示）；
2. 范围 >7 天或覆盖“已推送报表日期”→ 双人审批（G8）；≤7 天单人提交即排队；
3. 单次范围 ≤31 天，更大范围拆多单；
4. 逐日串行执行（复用 scheduled DAG 定义，trigger_type=backfill），与当日 scheduled run 天然错峰（03:00 前完成或排队）；
5. 回刷期间受影响报表对外标记 `recalculating`，查询 API 返回该标记，**禁止新旧分区混合导出**（G11）；
6. 完成后自动触发受影响 ADS 全量刷新 + 质量勾稽，失败自动停止剩余天数并告警。

---

## 4. 数据质量门禁

### 4.1 规则分级

| 级别 | 语义 | 动作 |
|------|------|------|
| BLOCK | 数据不可信，宁可延迟不可错数 | staging 校验不过→任务 FAILED（57118），生产分区不被替换 |
| WARN | 可疑但可入库 | 入库 + 告警 + 结果登记，人工确认 |
| INFO | 口径观测 | 仅记录，供质量看板分析 |

### 4.2 规则清单

| 规则码 | 类别 | 规则 | 级别 |
|--------|------|------|------|
| DQ-B01 | 行数波动 | ODS 表当日行数 vs 7 日均值偏差 >±50% | BLOCK |
| DQ-B02 | 主键唯一 | DWD 主键唯一（session_id / event_id / order_id / usage_id） | BLOCK |
| DQ-B03 | 核心空值 | user_id / subject_code 等核心维度空值率 >1% | BLOCK |
| DQ-B04 | 枚举合法 | 枚举字段值域校验（grade_group / session_type / order_status） | WARN（越界值归 `other`） |
| DQ-B05 | 跨层勾稽 | DWS 聚合值 = DWD 明细重算值（当日全量对账，容忍率 0） | BLOCK |
| DQ-B06 | 漏斗单调 | ads_bi__user_funnel 各层 UV 单调不减 | BLOCK |
| DQ-B07 | 值域 | 留存率/付费率/正确率 ∈ [0,1]，时长 ≥0 | WARN |
| DQ-B08 | 完整性 | 源 topic watermark 覆盖率 <99.5% | WARN（触发 T+1 补偿重跑建议） |
| DQ-W01 | 指标波动 | DAU / GMV / 人均时长 日环比波动 >30% | WARN（管理端确认后可忽略当日） |

### 4.3 勾稽校验实现示例（DQ-B05）

```sql
-- dws_learning__daily_user_agg vs dwd_learning__session_detail 明细重算
SELECT a.user_id,
       a.total_duration_minutes  AS agg_min,
       round(b.detail_sec / 60, 4) AS detail_min
FROM dws_learning__daily_user_agg AS a
INNER JOIN (
    SELECT user_id, sum(duration_seconds) AS detail_sec
    FROM dwd_learning__session_detail
    WHERE dt = {dt:Date} AND is_valid = 1
    GROUP BY user_id
) AS b USING (user_id)
WHERE abs(a.total_duration_minutes - b.detail_sec / 60) > 0.01
LIMIT 100   -- 命中任一行即 BLOCK
```

### 4.4 质量结果存储

```sql
CREATE TABLE dw_quality_check_result (
    id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    run_id         VARCHAR(96) NOT NULL,
    table_name     VARCHAR(128) NOT NULL,
    dt             DATE NOT NULL,
    rule_code      VARCHAR(16) NOT NULL,
    rule_level     VARCHAR(8) NOT NULL COMMENT 'BLOCK|WARN|INFO',
    checked_rows   BIGINT DEFAULT 0,
    violated_rows  BIGINT DEFAULT 0,
    violation_rate DECIMAL(8,6) DEFAULT 0,
    status         VARCHAR(8) NOT NULL COMMENT 'passed|warned|blocked',
    detail         JSON NULL COMMENT '样本/SQL/差异明细',
    checked_at     DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_run_table_rule (run_id, table_name, rule_code),
    KEY idx_dt_level (dt, rule_level, status)
) ENGINE=InnoDB COMMENT='质量门禁结果表';
```

同步写 ClickHouse `dw_quality_log`（TTL 1 年）供质量趋势看板；BLOCK/WARN 样本（去 PII）回流《数据质量监控与异常数据自动检测修复引擎》做根因分析。

### 4.5 与《数据质量监控引擎》的边界

- 本仓质量门禁 = **管线内建、面向阻断**（数据入库前，决定“能不能进”）；
- 数据质量监控引擎 = **业务数据质量、面向修复**（数据入库后，发现并修复异常）；
- 门禁 BLOCK/WARN 结果通过事件 `dw.quality.blocked` / `dw.quality.warned` 推送该引擎汇聚看板，不重复建模。

---

## 5. BI 查询与数据服务

### 5.1 Metabase 嵌入与 SSO

- 管理后台通过 iframe 嵌入 Metabase 看板，使用 **locked JWT（HS256）** 签名，TTL 10min，过期返回 57121 触发前端刷新重签；
- 账号映射：管理后台登录态 → 平台角色 → Metabase 权限组（见 5.5 矩阵），不开放 Metabase 原生注册；
- Metabase 连接数仓使用**只读账号**，仅授予 L3/L4 层表与沙箱库；L2 明细查询只经自建 API（5.2），不经 Metabase。

### 5.2 数据集查询 API（自建查询网关）

**数据集注册表**：

```sql
CREATE TABLE dw_bi_dataset (
    id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    dataset_code   VARCHAR(64) NOT NULL COMMENT '如 learning_daily / revenue_overview',
    name           VARCHAR(128) NOT NULL,
    source_tables  JSON NOT NULL COMMENT '允许访问的物理表白名单',
    metrics        JSON NOT NULL COMMENT '指标定义（引用指标中心语义 ID）',
    dimensions     JSON NOT NULL COMMENT '维度白名单',
    min_level      VARCHAR(4) NOT NULL DEFAULT 'L3' COMMENT '最低数据分级 L1-L4',
    owner          VARCHAR(64) NOT NULL,
    status         VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT 'active|paused|deprecated',
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_dataset_code (dataset_code)
) ENGINE=InnoDB COMMENT='BI 数据集白名单注册表';
```

**接口**：`POST /api/v1/bi/datasets/{dataset_code}/query`（管理后台网关，需 ops 角色）

```json
// 请求
{
    "dimensions": ["grade_group", "dt"],
    "metrics": ["dau", "avg_session_duration"],
    "filters": [{"field": "platform", "op": "eq", "value": "android"}],
    "dateRange": {"start": "2026-08-01", "end": "2026-08-18"},
    "granularity": "day",
    "limit": 1000
}
// 响应
{
    "code": 0,
    "data": {
        "columns": ["dt", "grade_group", "dau", "avg_session_duration"],
        "rows": [["2026-08-18", "primary", 182344, 23.7], "..."],
        "metadata": {
            "rowCount": 18, "elapsedMs": 341, "fromCache": true,
            "recalculating": false,
            "dataWatermark": "2026-08-18"
        }
    }
}
```

**SQL 生成硬约束**：

1. 仅生成 `SELECT ... FROM <白名单表>`，禁在于多表（JOIN 仅允许注册时声明的固定关联）；
2. 过滤值全部参数绑定，字段必须命中维度/指标白名单，否则 57113；
3. 按调用者数据分级自动注入行级权限过滤（L3 自动强制聚合粒度 ≥ k=5 桶）；
4. 超时 30s（57114），单用户 5 QPS、单数据集并发 10（超出 57115），返回行数 ≤10000——更大结果走《统一文件生成与异步报表导出中心服务》异步导出。

**审计**：

```sql
CREATE TABLE dw_bi_query_audit (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    operator_id  BIGINT UNSIGNED NOT NULL,
    dataset_code VARCHAR(64) NOT NULL,
    query_hash   CHAR(64) NOT NULL COMMENT '归一化 SQL SHA256',
    has_sensitive TINYINT(1) DEFAULT 0,
    row_count    INT DEFAULT 0,
    elapsed_ms   INT DEFAULT 0,
    success      TINYINT(1) DEFAULT 1,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_op_time (operator_id, created_at),
    KEY idx_ds_time (dataset_code, created_at)
) ENGINE=InnoDB COMMENT='BI 查询审计表（保留 2 年，到期注册存储清理引擎归档）';
```

### 5.3 报表订阅与自动推送

- 数据来源：`ads_ops__daily_brief`（08:00 生成）/ `ads_ops__weekly_report`（周一 09:00）；
- 文件生成（PDF/Excel）复用《统一文件生成与异步报表导出中心服务》，本仓仅负责数据组装与模板渲染；
- 推送渠道复用《统一通知消息模板引擎与多渠道内容适配渲染服务》，收件人偏好与免打扰静默时段遵循《统一通知偏好授权中心》——静默时段内日报延迟至次日 09:00 补推，不丢弃；
- 订阅关系表 `dw_report_subscribe`（uk(report_code, operator_id)，单人同报表仅一份，订阅总数上限 200）。

### 5.4 分析沙箱（即席查询）

- 数据集由《教育数据匿名化与去标识化处理管线引擎》产出（`ch_sbx__*` 库，伪匿 ID + k≥5 抑制）；
- 沙箱 CH 用户独立资源池：`max_memory_usage=4GB`、`max_threads=4`、`max_execution_time=120s`，与生产查询物理隔离；
- 即席 SQL 经校验器（仅 SELECT、表白名单=沙箱库、禁 `url()`/文件函数/字典外联）后执行；
- 沙箱结果导出需审批（57117），导出文件打水印并登记到期清理（C4）；
- 匿名化数据集未就绪时新查询拒绝（57122），已发布数据集只读可用（D9）。

### 5.5 数据分级与角色权限矩阵

| 分级 | 内容 | 示例对象 | 可见角色 | 出口策略 |
|------|------|----------|----------|----------|
| L1 | 原始含 PII 明细 | dwd 明细（device_id/手机号） | 数据平台管理员（双人审批 + 全量审计） | 禁导出，仅排查会话内查看 |
| L2 | 去标识明细 | 伪匿 user_key 映射层 | 数据分析师 | 出口经《数据脱敏规则引擎》动态脱敏 |
| L3 | 聚合统计 | dws / ads | 运营、产品、教研、管理层 | k≥5 聚合桶 |
| L4 | 公开汇总口径 | 对外披露数据 | 全员（内部） | 按对外披露规范 |

---

## 6. 状态机设计

### 6.1 DAG Run 状态机

```
pending → running → success
                 ↘ partial_success   （非关键任务存在 FAILED/SKIPPED，关键路径全部成功）
                 ↘ failed            （任一 critical=true 任务 FAILED）
running → cancelling → cancelled    （手动取消；下游 pending → skipped）
```

- **关键路径**：`TaskNode(critical=True)` 标记；§3.2 中 dwd_cleanse_* / dws_agg_* / ads_refresh_bi_views / quality_check_all_layers 为关键任务，generate_daily_brief 为非关键；
- scheduled run 的终态回写伴随 `dw.dag.run.finished` 事件（Outbox），消费方见 §12。

### 6.2 Task Execution 状态机

```
pending → running → success | failed
pending → skipped            （上游失败/取消传播，或显式跳过条件命中：当日无数据、特性开关关闭）
```

- failed 后允许人工 `retry_task`：新建 attempt+1 记录，从 failed → pending（仅同一 run 内，G4）；
- skipped 分 `skip_reason`: upstream_failed / upstream_skipped / no_data / feature_disabled / cancelled。

### 6.3 Backfill Job 状态机

```
pending → waiting_approval → approved → queued → running → success | partial_failed
pending → rejected（终态）
queued/running → cancelling → cancelled（已完成天数保留成果，不回滚）
partial_failed →（人工修复后续跑，从失败日继续）
```

### 6.4 守卫总表

| 守卫 | 规则 |
|------|------|
| G1 | scheduled run_id 固定 `{dag_id}_{dt}`，重复触发返回已有 run（幂等） |
| G2 | 同 DAG 存在未终态 run 时，新 scheduled 触发延迟等待，>4h 告警 |
| G3 | 任务状态流转仅允许 CAS 成功路径（pending→running→success/failed） |
| G4 | retry 仅在 failed 后由人工/API 触发，attempt 严格递增且 ≤ retry_count+3（人工上限） |
| G5 | 依赖存在 FAILED → 下游永久 SKIPPED，不自动重试 |
| G6 | 依赖 SKIPPED 视为满足（skip 传播不阻断更下游的独立分支） |
| G7 | 同 (dag_id, dt) 存在未终态 run 时 backfill 排队，不并发执行 |
| G8 | 回刷范围 >7 天或覆盖已推送报表日期 → 双人审批 |
| G9 | 质量门禁 BLOCK → staging 不替换生产分区，任务 FAILED |
| G10 | 回刷仅可跳过 WARN 级门禁，BLOCK 级永不可跳 |
| G11 | 回刷/重跑期间查询返回 `recalculating` 标记，禁止新旧分区混合导出 |
| G12 | REPLACE PARTITION 仅允许持有该表当日写锁的任务执行（DAG 串行性天然保证，跨 DAG 表冲突由注册表互斥） |

---

## 7. 错误码定义（57100-57199）

> 本段为数仓/BI 内部错误码，仅管理后台与运维工具展示；不对学生/家长/教师端直接暴露。

| 错误码 | 含义 | 处理建议 |
|--------|------|----------|
| 57101 | DAG 不存在 | 检查 dag_id |
| 57102 | DAG 已停用 | 启用后重试 |
| 57103 | run_id 冲突（幂等命中） | 返回已有 run 信息，非错误语义 |
| 57104 | 超过同 DAG 最大并行 run 数 | 等待当前 run 终态 |
| 57105 | 任务不存在 | 检查 task_id |
| 57106 | 任务状态不满足操作条件（CAS 失败） | 刷新状态后重试 |
| 57107 | 回刷日期范围非法 | start≤end、不含未来、不超保留期 |
| 57108 | 回刷范围超限（>31 天） | 拆分多单 |
| 57109 | 回刷需双人审批 | 提交审批流 |
| 57110 | 回刷审批未通过 / 待审批 | 查看审批意见 |
| 57111 | 同 DAG 回刷互斥中 | 排队等待 |
| 57112 | 数据集不存在或已停用 | 检查 dataset_code |
| 57113 | 查询含非白名单表/字段 | 修正查询条件 |
| 57114 | 查询超时（30s） | 缩小范围或异步导出 |
| 57115 | 超出查询行数/并发限额 | 走异步导出或稍后重试 |
| 57116 | 数据分级权限不足 | 申请对应分级权限 |
| 57117 | 敏感数据导出未审批/被拒 | 走导出审批流 |
| 57118 | 质量门禁 BLOCK | 查看质量结果明细修复后重跑 |
| 57119 | CH 写入失败（重试中） | 查看 CH 集群健康 |
| 57120 | 报表订阅已存在/超上限 | 勿重复订阅 |
| 57121 | Metabase 嵌入签名失效 | 前端刷新重签 |
| 57122 | 沙箱数据集未就绪 | 等待匿名化管线产出 |
| 57123 | 取消操作非法（非 running 态） | 刷新状态 |
| 57124 | 迟到事件超出补偿窗口 | 登记回刷任务 |

---

## 8. 降级与容灾（D1-D10）

| 编号 | 故障场景 | 降级策略 |
|------|----------|----------|
| D1 | 源 MySQL 不可用 | ODS CDC 任务暂停，Kafka offset 由 CDC 总线保留 7 天，恢复后续传；超 7 天未恢复走批量补拉 |
| D2 | 埋点流中断/迟到 | 03:00 以已到数据先跑并标记 `incomplete`；迟到事件于次日重跑前日（T+1 补偿），累计迟到 >0.5% 登记回刷建议 |
| D3 | CH 写入失败 | 任务级重试 3 次→FAILED；staging 未 REPLACE，生产分区保持旧版本，**不产生半成品数据** |
| D4 | 调度器宕机 | 心跳检测告警；新副本从 dw_dag_run/dw_task_execution 重建现场继续执行；漏触发由 Catchup 补发 |
| D5 | 质量门禁引擎自身故障 | **FAIL-CLOSED**：门禁不可用时阻断入库（宁可延迟不可错数），告警 P1 |
| D6 | Metabase 不可用 | 嵌入看板降级为自建 API 拉数静态表格渲染 |
| D7 | BI 查询过载 | 排队 + 30s 快速失败（57114），提示稍后；只读副本分流重查询 |
| D8 | 报表生成失败 | 重试 2 次后跳过并告警，次日补发，不阻塞主链路 ETL |
| D9 | 匿名化引擎不可用 | 沙箱新即席查询拒绝（57122），已发布数据集只读可用 |
| D10 | 出口脱敏引擎不可用 | **fail-secure**：L2 明细查询直接拒绝，聚合（L3/L4）不受影响 |

---

## 9. 监控与告警（M1-M10）

| 指标 | 口径 | 目标 / 告警 |
|------|------|------|
| M1 dag_success_rate | 日终态 success+partial 占比 | ≥98%；<90% P1 |
| M2 关键任务 P95 耗时 | dwd/dws 各任务 duration_ms | 超预算 1.5 倍告警 |
| M3 端到端完成时刻 | dag finished_at | 目标 07:00 前；06:30 未完成告警 |
| M4 质量门禁 BLOCK 次数 | dw_quality_check_result | 周环比突增 P2 |
| M5 ODS 波动告警数 | DQ-B01 命中 | 单日 >3 张表 P2 |
| M6 CH 集群健康 | 写入延迟/磁盘水位/merge 积压 | 磁盘 >80% P2、>90% P1 |
| M7 BI 查询 P95 延迟 / 超时率 | 审计表统计 | P95 >5s P3；超时率 >1% P2 |
| M8 回刷积压 | 未终态 backfill 数 | >3 单 P3 |
| M9 迟到事件占比 | watermark 统计 | >0.5% 告警 |
| M10 报表推送成功率 | 推送回执 | <95% P2 |

---

## 10. 容量规划（DAU 50 万假设）

| 项目 | 估算 |
|------|------|
| 日埋点事件量 | 人均 120 事件 ≈ 6000 万/日，峰值 5k EPS |
| ODS 事件存储（180 天） | 压缩后 ≈24GB/日 × 180 ≈ 4.3TB（含副本 ×2 ≈ 8.6TB） |
| DWD 明细（会话 2 年 + 事件 180 天） | 会话 ≈300 万行/日 ≈ 3GB/日 → 2 年 ≈ 2.2TB；事件层同 ODS 规模 |
| DWS / ADS | <200GB（日分区 + TTL 滚动） |
| CH 集群规格 | 3 分片 × 2 副本，单节点 4TB NVMe + 16C64G 起步 |
| ETL 窗口预算 | 03:00-07:00；ods_sync_events 60min / dwd_cleanse_sessions 90min（300 万行）/ dws_agg_user_daily 120min（6000 万事件聚合） |
| BI 查询并发 | 内部用户 ≈200，峰值并发查询 ≈40，QPS ≈80（缓存命中率 >70% 后 CH 实际压力 <25 QPS） |

---

## 11. 合规红线（C1-C8）

| 编号 | 红线 |
|------|------|
| C1 | 个体级明细查询最小化：仅质量排障/工单取证可申请，双人审批 + 全量审计留痕 |
| C2 | 分析与建模默认使用匿名化引擎产出的去标识数据集，禁止逆向重识别（含跨数据集拼合尝试） |
| C3 | 未成年人相关指标对外/跨部门披露必须聚合且 k≥5，禁个体排名类口径 |
| C4 | 导出文件强制水印（操作人+时间），登记到期自动删除（对接存储生命周期清理引擎） |
| C5 | 各层 TTL 到期自动清理（ODS 事件 180 天 / DWD 会话 2 年 / 订单 3 年），清理规则注册统一清理引擎，删除动作登记血缘平台 |
| C6 | 数仓为单向离线链路：分析结果不直接回流线上业务决策（个性化推荐等仍以线上实时链路为准） |
| C7 | 涉及 AIGC 内容的统计分析遵循《AIGC 内容标识与溯源水印系统》口径，不在数仓新增标识义务 |
| C8 | 第三方投放回传/归因数据入仓前必须完成设备哈希去 PII（口径对齐《效果投放归因引擎》） |

---

## 12. 契约对齐（与关联文档边界）

| # | 关联文档 | 边界与契约 |
|---|----------|------------|
| 1 | 统一埋点数据治理与事件质量保障引擎 | 入仓事件**仅消费 `events.clean`**；其示例表名 `dwd.event_question_answered_di` 为示意命名，本仓物理表为 `dwd_user__event_detail` / `dwd_learning__session_detail`，event_key↔event_name 映射登记指标中心 |
| 2 | 统一变更数据捕获 CDC 管道 | ODS CDC 类表消费 `cdc.primetop.{table}`，offset 管理归 CDC 总线，ODS 任务仅落地去重（ReplacingMergeTree） |
| 3 | 统一指标中心与数据语义查询引擎 | 指标口径权威归指标中心；本仓 DWS/ADS 是其 L3 物理载体之一；其示例 `dws_user_retention_di` 对应本仓 `dws_user__weekly_retention`，接入时由血缘平台登记映射；物化调度优先复用本仓 DAG |
| 4 | 管理后台数据分析看板与运营驾驶舱服务 / 实时聚合引擎 | **当日实时指标权威 = 实时聚合引擎**；T+1 对账以本仓为准，偏差 >2% 双向告警；`ads_admin__*` 标记“实时/准实时”的表由看板服务侧维护，本仓 T+1 重算仅作对账，不双写 |
| 5 | 数据质量监控与异常数据自动检测修复引擎 | 管线内建门禁（阻断面）归本仓，业务数据质量（修复面）归该引擎；BLOCK/WARN 样本经 `dw.quality.*` 事件回流 |
| 6 | 数据血缘追踪与元数据治理平台 | 建表/任务/分区替换自动注册血缘；DROP/REPLACE PARTITION 与 TTL 清理登记变更事件 |
| 7 | 教育数据匿名化与去标识化处理管线 | 沙箱数据集生产方；本仓 5.4 仅消费其产出，重识别风险评估复用其能力 |
| 8 | 数据脱敏规则引擎 | L2 明细查询出口动态脱敏（手机号/设备号等），引擎不可用时 fail-secure 拒绝（D10） |
| 9 | 统一文件生成与异步报表导出中心服务 | 报表文件的生成调度/进度/下载托管归该中心；本仓仅组装数据与渲染模板 |
| 10 | 统一通知消息模板引擎 / 通知偏好授权中心 | 日报周报推送渠道、模板渲染、免打扰静默时段与退订遵循通知域两文档，本仓不直连推送通道 |
| 11 | 效果投放归因引擎 / 用户转化漏斗分析引擎 | 渠道维度与多触点归因**结果**作为维度表入仓（ods 层同步其结果表），本仓不重复建模归因逻辑 |
| 12 | 学习效果量化追踪与教育价值归因分析系统 | 教育价值类指标消费本仓 DWS 学习主题表，指标定义以其为准并登记指标中心 |
| 13 | 存储资源统一生命周期清理引擎 | 各层 TTL 清理统一注册到该引擎执行（见 C5），本仓不自建清理任务 |
| 14 | 学习数据可视化与图表渲染引擎 | 运营后台大盘图表渲染层，数据来自本仓 ADS 查询 API（5.2） |

---

## 13. 验收场景（18 条）

1. 03:00 自动触发 daily_learning_etl，07:00 前全链完成，dw_dag_run 终态 success；
2. 重复触发同 (dag_id, dt) 的 scheduled run，返回同一 run_id，不产生重复执行；
3. 人为杀死 dws_agg_learning_daily 进程：重试 3 次后 FAILED，下游 SKIPPED，run=failed，告警含 task_id 与 error 摘要；
4. 对昨日执行 rerun：staging + REPLACE PARTITION 后行数与首跑一致，双跑无重复（幂等验证）；
5. 提交 7 天内回刷单无需审批即排队；8 天回刷单强制双人审批（G8）；
6. 回刷执行期间 BI 查询响应含 `recalculating: true`，且无法导出新旧分区混合数据；
7. 注入主键重复数据：DQ-B02 BLOCK，任务 FAILED（57118），生产分区未被替换；
8. 注入 DAU 日环比 -40%：DQ-W01 WARN 入库并告警，任务继续；
9. DQ-B05 勾稽：人为篡改 staging 一行聚合值后校验 BLOCK，修正后通过；
10. 漏斗表某层 UV 大于上层：DQ-B06 BLOCK 拦截；
11. dataset 查询引用未注册表：57113 拒绝并落审计；
12. L3 角色请求 L2 明细数据集：57116 拒绝；
13. L2 查询命中手机号字段：出口自动脱敏（脱敏引擎联动验证）；
14. 查询 >30s：57114 快速失败；单用户并发超 5 QPS：57115 限流；
15. 匿名化数据集未就绪：沙箱新查询 57122 拒绝，已发布数据集仍可只读查询；
16. Metabase 嵌入 JWT 过期：前端收到 57121 并自动重签恢复；
17. 日报在静默时段生成：延迟至次日 09:00 补推，订阅人收到完整报表（含水印）；
18. DWD 事件表 180 天到期分区被自动清理，清理事件登记血缘平台与质量看板。

---

## 14. 关联文档

- 服务端-统一埋点数据治理与事件质量保障引擎-详细设计
- 服务端-统一变更数据捕获 CDC 管道与数据同步总线-详细设计
- 服务端-统一指标中心与数据语义查询引擎-详细设计
- 服务端-管理后台数据分析看板与运营驾驶舱服务-详细设计
- 学习数据实时聚合与统计预计算引擎-详细设计
- 服务端-数据质量监控与异常数据自动检测修复引擎-详细设计
- 服务端-数据血缘追踪与元数据治理平台-详细设计
- 服务端-教育数据匿名化与去标识化处理管线引擎-详细设计
- 服务端-数据脱敏规则引擎与敏感信息动态遮蔽服务-详细设计
- 统一文件生成与异步报表导出中心服务-详细设计
- 服务端-统一通知消息模板引擎与多渠道内容适配渲染服务-详细设计
- 服务端-存储资源统一生命周期管理与过期数据自动清理引擎-详细设计
- 效果投放点击归因与买量 ROI 分析引擎-详细设计
- 学习数据可视化与图表渲染引擎-详细设计

---

## 维护记录

- **v1.0（2026-08-14）**：初稿，完成分层架构（ODS/DWD/DWS/ADS）、核心建表、DAG 定义与执行器框架；§3.3 执行器代码写作中途截断，调度元数据/幂等重跑/质量门禁/BI 服务/状态机/错误码/降级/监控/容量/合规/契约/验收章节缺失。
- **v1.1（2026-08-19）**：补全烂尾文档（695→1316 行）。补齐：§3.3 执行器实现（CAS 抢占/重试退避/失败下游 SKIPPED 传播/多副本防护/心跳 Catchup）；新增 §3.3.1 四张调度元数据 DDL、§3.4 业务日期与就绪屏障、§3.5 幂等写入（staging + REPLACE PARTITION 原子替换）与分区重跑规范、§3.6 回刷安全护栏、§4 质量门禁（BLOCK/WARN 分级 + 九规则 + 勾稽 SQL + 结果表 + 与质量监控引擎边界）、§5 BI 数据服务（Metabase 嵌入/数据集白名单查询网关/报表订阅/分析沙箱/L1-L4 权限矩阵）、§6 四状态机与守卫 G1-G12、§7 错误码 57100-57199 共 24 项、§8 降级 D1-D10（门禁 FAIL-CLOSED/脱敏 fail-secure 两条红线）、§9 监控 M1-M10、§10 容量规划、§11 合规红线 C1-C8、§12 契约对齐 14 项、§13 验收 18 条。修复 v1.0 三处缺陷：①DWS/ADS 日刷新表月分区无法按日幂等重跑，统一改 `PARTITION BY dt`；②`dws_user__daily_active` SummingMergeTree 对 Nullable 指标列跨批求和产生错误值，改普通 MergeTree；③`ads_bi__user_funnel` 普通物化视图 countDistinctIf 无法跨批合并导致 UV 重复计数，改任务重建普通表。