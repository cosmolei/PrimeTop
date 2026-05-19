# AB测试与实验平台 - 详细设计

## 1. 概述

### 1.1 目的

AB 测试与实验平台为 PrimeTop 提供数据驱动的产品决策能力，支持功能效果验证、UI 方案对比、推荐算法评估、Prompt 策略对比等场景。与灰度发布（Feature Flag）不同，AB 测试聚焦于**假设检验与统计显著性分析**，帮助团队以量化方式验证每次产品变更的实际效果。

### 1.2 适用范围

- 产品交互方案对比（如首页布局、按钮位置、答题流程）
- AI 功能策略对比（如 Prompt 模板 A vs B、不同模型效果）
- 推荐算法效果评估（如知识推荐、题目推荐策略）
- 运营活动方案对比（如激励方案、会员引导文案）
- 定价与权益方案验证

### 1.3 核心目标

| 目标 | 说明 |
|------|------|
| 低接入成本 | 客户端/服务端 SDK 一行代码接入实验 |
| 准确分流 | 一致性 Hash 分流，用户维度稳定 |
| 实时统计 | 指标实时聚合，分钟级延迟 |
| 统计严谨 | 支持贝叶斯/频率学派假设检验，自动判定显著性 |
| 安全可控 | 实验 Apollo 不影响核心学习链路 |

---

## 2. 核心概念

### 2.1 术语表

| 术语 | 说明 |
|------|------|
| Experiment（实验） | 一个待验证的假设，包含一个 Control 组和若干 Treatment 组 |
| Layer（层） | 实验的逻辑分组，同层实验互斥，不同层正交 |
| Variant（变体） | 实验组的具体方案，包括 Control 和 Treatment |
| Assignment（分流） | 将用户分配到某个 Variant 的过程 |
| Metric（指标） | 用于评估实验效果的可量化度量 |
| Exposure（曝光） | 用户被分配到实验并实际触发的记录 |
| Conversion（转化） | 用户完成目标行为（如答题、付费） |
| SRM（样本比偏差） | Sample Ratio Mismatch，分流比例异常检测 |

### 2.2 分层模型

```
┌─────────────────────────────────────────┐
│              Layer 0 (UI层)              │
│  ┌─────────────┐  ┌──────────────────┐  │
│  │ 首页布局实验 │  │ 答题流程实验     │  │
│  └─────────────┘  └──────────────────┘  │
├─────────────────────────────────────────┤
│              Layer 1 (AI层)              │
│  ┌─────────────┐  ┌──────────────────┐  │
│  │ Prompt实验   │  │ 模型路由实验     │  │
│  └─────────────┘  └──────────────────┘  │
├─────────────────────────────────────────┤
│              Layer 2 (推荐层)            │
│  ┌─────────────┐  ┌──────────────────┐  │
│  │ 题目推荐实验 │  │ 知识点推荐实验   │  │
│  └─────────────┘  └──────────────────┘  │
├─────────────────────────────────────────┤
│              Layer 3 (运营层)            │
│  ┌─────────────┐  ┌──────────────────┐  │
│  │ 激励方案实验 │  │ 定价实验         │  │
│  └─────────────┘  └──────────────────┘  │
└─────────────────────────────────────────┘
```

**正交互不干扰**：不同 Layer 的实验互不影响，同一 Layer 内实验互斥。

---

## 3. 系统架构

### 3.1 整体架构

```
┌──────────────┐     ┌──────────────┐
│  移动端 SDK   │     │  服务端 SDK   │
│ (Flutter/Dart)│     │  (Java/Go)   │
└──────┬───────┘     └──────┬───────┘
       │                     │
       └─────────┬───────────┘
                 │
        ┌────────▼────────┐
        │  实验配置服务     │  ← 管理后台配置实验
        │  (Experiment     │
        │   Config Service)│
        └────────┬────────┘
                 │
        ┌────────▼────────┐
        │  分流引擎         │
        │  (Assignment     │
        │   Engine)        │
        └────────┬────────┘
                 │
        ┌────────▼────────┐
        │  事件采集服务     │  ← 曝光/转化事件上报
        │  (Event Collector│
        │   Service)       │
        └────────┬────────┘
                 │
        ┌────────▼────────┐
        │  统计分析引擎     │
        │  (Statistics     │
        │   Engine)        │
        └────────┬────────┘
                 │
        ┌────────▼────────┐
        │  实验看板         │  ← 管理后台查看结果
        │  (Dashboard)     │
        └─────────────────┘
```

### 3.2 技术选型

| 组件 | 技术选型 | 说明 |
|------|----------|------|
| 分流算法 | 一致性 Hash (MurmurHash3) | 保证同一用户始终分配到同一组 |
| 配置存储 | MySQL + Redis | MySQL 持久化，Redis 热配置缓存 |
| 事件存储 | Kafka → ClickHouse | 高吞吐写入，列存分析友好 |
| 统计计算 | Flink / 自研批处理 | 流式实时聚合 + 定期全量校验 |
| 统计检验 | Python (SciPy) / 自研库 | 贝叶斯检验 + 频率学派 t-test / χ²-test |
| 管理后台 | React + Ant Design Pro | 复用现有后台框架 |

---

## 4. 数据结构设计

### 4.1 实验配置表

```sql
-- experiments: 实验主表
CREATE TABLE experiments (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    experiment_key  VARCHAR(128) NOT NULL UNIQUE COMMENT '实验唯一标识，如 home_layout_v2',
    name            VARCHAR(256) NOT NULL COMMENT '实验名称',
    description     TEXT COMMENT '实验描述与假设',
    layer_id        BIGINT NOT NULL COMMENT '所属层 ID',
    owner           VARCHAR(64) NOT NULL COMMENT '负责人',
    status          ENUM('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED', 'ARCHIVED')
                    NOT NULL DEFAULT 'DRAFT',
    
    -- 分流配置
    traffic_percent TINYINT NOT NULL DEFAULT 100 COMMENT '实验占总流量百分比 1-100',
    target_audience JSON COMMENT '受众定向条件，见 4.3',
    
    -- 时间配置
    start_time      DATETIME COMMENT '计划开始时间',
    end_time        DATETIME COMMENT '计划结束时间',
    min_sample_size INT COMMENT '最小样本量（每组）',
    max_duration_h  INT COMMENT '最大运行时长（小时）',
    
    -- 自动决策
    auto_stop       BOOLEAN NOT NULL DEFAULT FALSE COMMENT '达到显著性后自动停止',
    auto_stop_rule  JSON COMMENT '自动停止规则',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_layer_status (layer_id, status),
    INDEX idx_owner (owner)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 4.2 变体配置表

```sql
-- experiment_variants: 实验变体
CREATE TABLE experiment_variants (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    experiment_id   BIGINT NOT NULL COMMENT '关联实验 ID',
    variant_key     VARCHAR(64) NOT NULL COMMENT '变体标识，如 control, treatment_a',
    name            VARCHAR(128) NOT NULL COMMENT '变体名称',
    is_control      BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否为对照组',
    traffic_weight  SMALLINT NOT NULL DEFAULT 1 COMMENT '流量权重，同一实验内按比例分配',
    payload         JSON COMMENT '变体配置内容，由 SDK 解析使用',
    
    UNIQUE KEY uk_exp_variant (experiment_id, variant_key),
    INDEX idx_experiment (experiment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**payload 示例**：

```json
// 首页布局实验
{
  "layout_type": "card_grid",
  "show_quick_ai": true,
  "task_count": 5
}

// Prompt 模板实验
{
  "prompt_template_id": "math_explain_v2",
  "model_id": "glm-4",
  "temperature": 0.3
}

// 定价实验
{
  "monthly_price_cents": 2990,
  "annual_discount_rate": 0.7,
  "trial_days": 7
}
```

### 4.3 分层配置表

```sql
-- experiment_layers: 实验层
CREATE TABLE experiment_layers (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    layer_key   VARCHAR(128) NOT NULL UNIQUE COMMENT '层唯一标识',
    name        VARCHAR(256) NOT NULL,
    description TEXT,
    priority    INT NOT NULL DEFAULT 0 COMMENT '层优先级，数字越大越先处理',
    
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 初始层数据
INSERT INTO experiment_layers (layer_key, name, description, priority) VALUES
('ui', 'UI层', '界面交互方案实验', 100),
('ai', 'AI层', 'AI策略、Prompt、模型实验', 80),
('recommendation', '推荐层', '推荐算法实验', 60),
('operation', '运营层', '运营活动、定价实验', 40);
```

### 4.4 受众定向规则

```sql
-- experiment_targeting: 受众定向条件（JSON 存储在 experiments.target_audience）
-- 格式如下：
-- {
--   "include": {
--     "grade": ["G7", "G8", "G9"],          -- 年级筛选
--     "platform": ["android", "ios"],        -- 平台
--     "member_type": ["free", "monthly"],    -- 会员类型
--     "version": [">=2.1.0"],               -- APP 版本
--     "city_tier": ["tier1", "tier2"],       -- 城市线级
--     "custom": [                            -- 自定义标签
--       {"key": "is_new_user", "op": "eq", "value": true}
--     ]
--   },
--   "exclude": {
--     "user_ids": [12345, 67890]             -- 排除特定用户
--   }
-- }
```

### 4.5 曝光与事件表

```sql
-- experiment_exposures: 用户曝光记录（ClickHouse 建表）
CREATE TABLE experiment_exposures (
    experiment_key   String,
    variant_key      String,
    user_id          UInt64,
    device_id        String,
    platform         String,           -- android / ios / web
    app_version      String,
    exposed_at       DateTime,
    -- 用于 SRM 检测
    is_eligible      UInt8             -- 1=符合受众条件
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(exposed_at)
ORDER BY (experiment_key, variant_key, user_id, exposed_at);

-- experiment_events: 实验关联转化事件
CREATE TABLE experiment_events (
    experiment_key   String,
    variant_key      String,
    user_id          UInt64,
    event_name       String,           -- 如 question_answered, subscription_paid
    event_value      Nullable(Float64),-- 事件数值，如答题正确率、付费金额
    event_time       DateTime,
    properties       String            -- JSON 额外属性
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(event_time)
ORDER BY (experiment_key, event_name, variant_key, user_id, event_time);
```

### 4.6 统计结果缓存表

```sql
-- experiment_statistics: 实验统计快照（定时刷新）
CREATE TABLE experiment_statistics (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    experiment_key  VARCHAR(128) NOT NULL,
    variant_key     VARCHAR(64) NOT NULL,
    metric_name     VARCHAR(128) NOT NULL,
    
    -- 基础统计
    sample_size     INT NOT NULL COMMENT '样本数',
    mean_value      DECIMAL(18,6) COMMENT '均值（连续指标）',
    count_value     INT COMMENT '转化次数（计数指标）',
    rate_value      DECIMAL(10,6) COMMENT '转化率（比例指标）',
    std_dev         DECIMAL(18,6) COMMENT '标准差',
    
    -- 与 Control 组对比
    delta           DECIMAL(18,6) COMMENT '绝对差异',
    delta_percent   DECIMAL(10,4) COMMENT '相对差异百分比',
    p_value         DECIMAL(10,6) COMMENT 'p 值',
    confidence_low  DECIMAL(18,6) COMMENT '置信区间下界',
    confidence_high DECIMAL(18,6) COMMENT '置信区间上界',
    significance    ENUM('NOT_SIGNIFICANT', 'SIGNIFICANT_POSITIVE', 'SIGNIFICANT_NEGATIVE')
                    COMMENT '显著性判定',
    
    -- 贝叶斯指标
    prob_better     DECIMAL(6,4) COMMENT 'Treatment 优于 Control 的概率',
    expected uplift DECIMAL(18,6) COMMENT '预期提升幅度',
    
    calculated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_stat (experiment_key, variant_key, metric_name, calculated_at),
    INDEX idx_exp (experiment_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 5. 核心流程设计

### 5.1 实验生命周期状态机

```
         创建实验
            │
            ▼
      ┌──────────┐
      │  DRAFT   │ ← 可编辑配置、添加变体
      └────┬─────┘
           │ 启动实验（审批通过）
           ▼
      ┌──────────┐
      │ RUNNING  │ ← 自动分流、收集数据
      └┬───┬───┬─┘
       │   │   │
       │   │   │ 自动停止（达到显著/超时）
       │   │   ▼
       │   │ ┌───────────┐
       │   │ │ COMPLETED │ ← 结果已出，可查看报告
       │   │ └─────┬─────┘
       │   │       │ 归档
       │   │       ▼
       │   │ ┌───────────┐
       │   │ │ ARCHIVED  │ ← 历史可查
       │   │ └───────────┘
       │   │
       │   └ 手动暂停
       │     ▼
       │   ┌──────────┐
       │   │  PAUSED  │ ← 停止分流，保留数据
       │   └────┬─────┘
       │        │ 恢复
       │        └──→ RUNNING
       │
       └ 终止实验
           ▼
      ┌───────────┐
      │ COMPLETED │
      └───────────┘
```

### 5.2 分流流程

```
用户请求 → SDK.getVariant(experiment_key, user_id)
                │
                ▼
        ┌───────────────┐
        │ 查询本地缓存   │ ← 有缓存且未过期 → 直接返回
        └───────┬───────┘
                │ 未命中
                ▼
        ┌───────────────┐
        │ 请求实验配置服务│
        └───────┬───────┘
                │
        ┌───────▼────────┐
        │ 检查受众定向    │
        │ (grade/platform │
        │  /version等)    │
        └───────┬────────┘
                │
         ┌──────┴──────┐
         │ 不符合      │ 符合
         ▼             ▼
    返回 null     ┌───────────────┐
                  │ 检查实验状态    │
                  └───────┬───────┘
                          │
                  ┌───────▼────────┐
                  │ 一致性 Hash 分流│
                  │ hash(user_id   │
                  │   + layer_key) │
                  │   % 100        │
                  └───────┬────────┘
                          │
                  ┌───────▼────────┐
                  │ 选择变体        │
                  │ (按 weight 比例)│
                  └───────┬────────┘
                          │
                  ┌───────▼────────┐
                  │ 写入缓存        │
                  │ 上报曝光事件    │
                  └───────┬────────┘
                          │
                  返回 variant_key + payload
```

### 5.3 分流算法详细实现

```java
/**
 * 一致性 Hash 分流引擎
 * 保证同一用户在同一实验层内始终得到一致的分配结果
 */
public class AssignmentEngine {
    
    /**
     * 为用户分配实验变体
     * 
     * @param userId 用户 ID
     * @param layerKey 实验层标识
     * @param runningExperiments 当前层内正在运行的实验列表（已按 traffic_percent 降序排列）
     * @return AssignmentResult 包含实验和变体信息，null 表示未命中任何实验
     */
    public AssignmentResult assign(Long userId, String layerKey, 
                                    List<Experiment> runningExperiments) {
        // 1. 计算用户在该层的 Hash 桶位 (0-9999，共 10000 个桶)
        int bucket = murmurHash3(userId, layerKey) % 10000;
        
        // 2. 遍历实验，按流量配额分配桶位范围
        int consumedBuckets = 0;
        for (Experiment exp : runningExperiments) {
            int expBuckets = exp.getTrafficPercent() * 100; // 1% = 100 桶
            
            // 该实验的桶位范围 [consumedBuckets, consumedBuckets + expBuckets)
            if (bucket >= consumedBuckets && bucket < consumedBuckets + expBuckets) {
                // 命中该实验，进一步选择变体
                String variantKey = selectVariant(
                    userId, exp.getExperimentKey(), exp.getVariants()
                );
                return new AssignmentResult(exp.getExperimentKey(), variantKey, 
                                           exp.getVariantPayload(variantKey));
            }
            consumedBuckets += expBuckets;
        }
        
        // 未命中任何实验
        return null;
    }
    
    /**
     * 在实验内选择具体变体
     */
    private String selectVariant(Long userId, String experimentKey, 
                                  List<Variant> variants) {
        // 使用 user_id + experiment_key 计算 Hash，保证不同实验分配独立
        int hash = murmurHash3(userId, experimentKey) % 10000;
        
        // 计算总权重
        int totalWeight = variants.stream()
            .mapToInt(Variant::getTrafficWeight).sum();
        
        // 映射到权重空间
        int position = (int)((long)hash * totalWeight / 10000);
        
        int accumulated = 0;
        for (Variant v : variants) {
            accumulated += v.getTrafficWeight();
            if (position < accumulated) {
                return v.getVariantKey();
            }
        }
        
        // 降级返回最后一个（理论上不应到达）
        return variants.get(variants.size() - 1).getVariantKey();
    }
    
    private int murmurHash3(Long key, String salt) {
        String input = salt + ":" + key;
        return Math.abs(MurmurHash.hash32(input));
    }
}
```

### 5.4 客户端 SDK 接入（Flutter）

```dart
/// PrimeTop AB 测试 Flutter SDK
class ABTestSDK {
  static ABTestSDK? _instance;
  final ABTestApiClient _apiClient;
  final ABTestCache _cache;
  
  static Future<ABTestSDK> initialize({
    required String endpoint,
    required String appId,
  }) async {
    _instance = ABTestSDK._(
      apiClient: ABTestApiClient(endpoint: endpoint, appId: appId),
      cache: ABTestCache(),
    );
    await _instance!._prefetchExperiments();
    return _instance!;
  }
  
  /// 获取实验变体（主入口）
  /// 
  /// [experimentKey] 实验标识，如 'home_layout_v2'
  /// [defaultValue] 默认值（实验未命中时使用）
  Future<ABTestVariant?> getVariant(String experimentKey) async {
    // 1. 检查本地缓存
    final cached = _cache.get(experimentKey);
    if (cached != null && !cached.isExpired) {
      return cached;
    }
    
    // 2. 检查预加载的全量配置
    final preloaded = _preloadedAssignments[experimentKey];
    if (preloaded != null) {
      _cache.put(experimentKey, preloaded);
      return preloaded;
    }
    
    // 3. 未命中 → 返回 null（走默认逻辑）
    return null;
  }
  
  /// 获取实验 Payload 的某个字段（便捷方法）
  Future<T> getExperimentParam<T>(
    String experimentKey, 
    String paramKey, 
    T defaultValue,
  ) async {
    final variant = await getVariant(experimentKey);
    if (variant == null) return defaultValue;
    return variant.getParam(paramKey, defaultValue);
  }
  
  /// 上报曝光（SDK 内部自动调用，也可手动触发）
  Future<void> trackExposure(String experimentKey) async {
    final variant = _cache.get(experimentKey);
    if (variant == null || variant.exposureTracked) return;
    
    await _apiClient.reportExposure(
      experimentKey: experimentKey,
      variantKey: variant.variantKey,
      userId: await _getCurrentUserId(),
    );
    variant.markExposureTracked();
  }
  
  /// 批量预加载实验配置（启动时调用一次）
  Future<void> _prefetchExperiments() async {
    final userId = await _getCurrentUserId();
    final assignments = await _apiClient.batchAssign(userId);
    _preloadedAssignments = {
      for (final a in assignments) a.experimentKey: a
    };
  }
}
```

**客户端接入示例**：

```dart
// 首页布局实验接入
class HomePage extends StatefulWidget { ... }

class _HomePageState extends State<HomePage> {
  String _layoutType = 'default';
  
  @override
  void initState() {
    super.initState();
    _loadExperiment();
  }
  
  Future<void> _loadExperiment() async {
    final layoutType = await ABTestSDK.instance!
        .getExperimentParam('home_layout_v2', 'layout_type', 'default');
    setState(() => _layoutType = layoutType);
  }
  
  @override
  Widget build(BuildContext context) {
    switch (_layoutType) {
      case 'card_grid':
        return _buildCardGridLayout();
      case 'list_feed':
        return _BuildListFeedLayout();
      default:
        return _BuildDefaultLayout();
    }
  }
}
```

---

## 6. 指标体系设计

### 6.1 指标分类

| 类别 | 指标示例 | 类型 |
|------|----------|------|
| **核心指标 (OEC)** | 日活、次日留存、人均学习时长 | 连续值 |
| **功能指标** | 拍题完成率、AI 问答满意度、错题复习率 | 比例/连续 |
| **商业指标** | 付费转化率、ARPU、续费率 | 比例/连续 |
| **AI 质量指标** | 回答准确率、用户好评率、首 token 耗时 | 比例/连续 |
| **护栏指标** | 崩溃率、API 错误率、页面加载耗时 | 连续值 |

### 6.2 指标配置

```sql
-- experiment_metrics: 指标定义
CREATE TABLE experiment_metrics (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    metric_key      VARCHAR(128) NOT NULL UNIQUE,
    name            VARCHAR(256) NOT NULL,
    description     TEXT,
    metric_type     ENUM('RATIO', 'CONTINUOUS', 'COUNT') NOT NULL,
    
    -- 指标计算逻辑（SQL 片段，在 ClickHouse 中执行）
    numerator_sql   TEXT COMMENT '分子 SQL，如 COUNT(DISTINCT user_id) FROM ...',
    denominator_sql TEXT COMMENT '分母 SQL（比例指标），如实验曝光用户数',
    aggregation     ENUM('SUM', 'AVG', 'COUNT', 'COUNT_DISTINCT') NOT NULL,
    
    -- 指标方向（用于自动判定好坏）
    direction       ENUM('HIGHER_IS_BETTER', 'LOWER_IS_BETTER', 'TWO_SIDED') 
                    NOT NULL DEFAULT 'HIGHER_IS_BETTER',
    
    -- 护栏指标标记
    is_guardrail    BOOLEAN NOT NULL DEFAULT FALSE,
    guardrail_threshold DECIMAL(10,6) COMMENT '护栏阈值，低于此值触发告警',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 6.3 常用指标定义

```json
[
  {
    "metric_key": "dau_rate",
    "name": "日活率",
    "metric_type": "RATIO",
    "direction": "HIGHER_IS_BETTER",
    "description": "当日活跃用户数 / 曝光用户数"
  },
  {
    "metric_key": "retention_d1",
    "name": "次日留存率",
    "metric_type": "RATIO",
    "direction": "HIGHER_IS_BETTER"
  },
  {
    "metric_key": "avg_study_minutes",
    "name": "人均学习时长（分钟）",
    "metric_type": "CONTINUOUS",
    "direction": "HIGHER_IS_BETTER"
  },
  {
    "metric_key": "question_accuracy",
    "name": "答题正确率",
    "metric_type": "RATIO",
    "direction": "HIGHER_IS_BETTER"
  },
  {
    "metric_key": "ai_satisfaction_rate",
    "name": "AI 回答满意度",
    "metric_type": "RATIO",
    "direction": "HIGHER_IS_BETTER"
  },
  {
    "metric_key": "subscription_rate",
    "name": "付费转化率",
    "metric_type": "RATIO",
    "direction": "HIGHER_IS_BETTER"
  },
  {
    "metric_key": "crash_rate",
    "name": "崩溃率",
    "metric_type": "RATIO",
    "direction": "LOWER_IS_BETTER",
    "is_guardrail": true,
    "guardrail_threshold": 0.005
  },
  {
    "metric_key": "api_error_rate",
    "name": "API 错误率",
    "metric_type": "RATIO",
    "direction": "LOWER_IS_BETTER",
    "is_guardrail": true,
    "guardrail_threshold": 0.01
  }
]
```

---

## 7. 统计分析引擎

### 7.1 样本量估算

```python
"""
实验前样本量估算，确保实验有足够的统计功效
"""
from scipy import stats
import math

def calculate_sample_size(
    baseline_rate: float,      # 基线转化率
    mde: float,                # 最小可检测效应 (Minimum Detectable Effect)
    alpha: float = 0.05,       # 显著性水平
    power: float = 0.8,        # 统计功效
    num_variants: int = 2,     # 变体数量（含 Control）
) -> dict:
    """
    计算比例指标（转化率）所需的最小样本量
    
    Returns:
        dict with keys: sample_per_variant, total_sample, mde_absolute, mde_relative
    """
    p1 = baseline_rate
    p2 = baseline_rate * (1 + mde)  # 期望提升后的转化率
    
    # 标准正态分布的临界值
    z_alpha = stats.norm.ppf(1 - alpha / 2)  # 双侧检验
    z_beta = stats.norm.ppf(power)
    
    # 比例指标样本量公式
    p_avg = (p1 + p2) / 2
    n = ((z_alpha * math.sqrt(2 * p_avg * (1 - p_avg)) + 
          z_beta * math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2) / (p2 - p1) ** 2
    
    # 多变体 Bonferroni 校正
    n_adjusted = n * (num_variants - 1)
    
    return {
        "sample_per_variant": math.ceil(n_adjusted),
        "total_sample": math.ceil(n_adjusted * num_variants),
        "mde_absolute": round(p2 - p1, 6),
        "mde_relative": mde,
        "alpha": alpha,
        "power": power,
        "estimated_days": None  # 需结合日活数据估算
    }

# 示例：基线付费转化率 3%，期望提升 10%（相对），α=0.05，power=0.8
result = calculate_sample_size(baseline_rate=0.03, mde=0.10)
# => 每组约需 200,000 样本，总计 400,000
```

### 7.2 显著性检验

```python
"""
实验结果统计检验
"""
import numpy as np
from scipy import stats
from typing import Literal

def analyze_experiment(
    control_values: list[float],      # Control 组观测值
    treatment_values: list[float],    # Treatment 组观测值
    metric_type: Literal['continuous', 'ratio'],
    alpha: float = 0.05,
) -> dict:
    """
    执行统计检验并返回结果
    
    Returns:
        dict with keys: p_value, is_significant, delta, delta_relative, 
                        confidence_interval, effect_size, recommendation
    """
    ctrl = np.array(control_values)
    treat = np.array(treatment_values)
    
    if metric_type == 'continuous':
        # 连续指标：Welch's t-test
        t_stat, p_value = stats.ttest_ind(ctrl, treat, equal_var=False)
    else:
        # 比例指标：Z-test for proportions
        p_ctrl = ctrl.mean()
        p_treat = treat.mean()
        n_ctrl = len(ctrl)
        n_treat = len(treat)
        p_pool = (ctrl.sum() + treat.sum()) / (n_ctrl + n_treat)
        se = math.sqrt(p_pool * (1 - p_pool) * (1/n_ctrl + 1/n_treat))
        z_stat = (p_treat - p_ctrl) / se
        p_value = 2 * (1 - stats.norm.cdf(abs(z_stat)))
    
    # 效果量
    delta = treat.mean() - ctrl.mean()
    delta_relative = delta / ctrl.mean() if ctrl.mean() != 0 else 0
    
    # 置信区间
    se_diff = math.sqrt(ctrl.var()/len(ctrl) + treat.var()/len(treat))
    ci_low = delta - stats.norm.ppf(1 - alpha/2) * se_diff
    ci_high = delta + stats.norm.ppf(1 - alpha/2) * se_diff
    
    # Cohen's d
    pooled_std = math.sqrt((ctrl.var() + treat.var()) / 2)
    cohens_d = delta / pooled_std if pooled_std != 0 else 0
    
    # 建议判定
    is_significant = p_value < alpha
    if is_significant:
        if delta > 0:
            recommendation = "SHIP"          # 正向显著 → 上线
        else:
            recommendation = "REJECT"        # 负向显著 → 放弃
    else:
        recommendation = "INCONCLUSIVE"      # 不显著 → 延长或放弃
    
    return {
        "control_mean": round(ctrl.mean(), 6),
        "treatment_mean": round(treat.mean(), 6),
        "delta": round(delta, 6),
        "delta_relative": round(delta_relative, 4),
        "p_value": round(p_value, 6),
        "is_significant": is_significant,
        "confidence_interval": [round(ci_low, 6), round(ci_high, 6)],
        "effect_size_cohens_d": round(cohens_d, 4),
        "recommendation": recommendation,
    }
```

### 7.3 SRM（样本比偏差）检测

```python
def check_srm(
    expected_ratios: dict[str, float],   # 期望比例 {'control': 0.5, 'treatment': 0.5}
    observed_counts: dict[str, int],     # 实际样本数 {'control': 10050, 'treatment': 9950}
    alpha: float = 0.01,
) -> dict:
    """
    检测样本比例是否符合预期（SRM 检测）
    如果检测到偏差，说明分流可能存在问题，需要暂停实验
    """
    total = sum(observed_counts.values())
    expected_counts = {k: total * v for k, v in expected_ratios.items()}
    
    # χ² 检验
    chi2 = sum(
        (observed_counts[k] - expected_counts[k]) ** 2 / expected_counts[k]
        for k in expected_ratios.keys()
    )
    df = len(expected_ratios) - 1
    p_value = 1 - stats.chi2.cdf(chi2, df)
    
    has_srm = p_value < alpha
    
    return {
        "has_srm": has_srm,
        "p_value": round(p_value, 6),
        "expected": {k: round(v, 1) for k, v in expected_counts.items()},
        "observed": observed_counts,
        "severity": "CRITICAL" if has_srm else "OK",
        "action": "PAUSE_EXPERIMENT" if has_srm else "CONTINUE",
    }
```

---

## 8. API 接口设计

### 8.1 分流接口

```
POST /api/v1/ab/assign
```

**请求体**：
```json
{
  "user_id": 12345,
  "device_id": "abc-def-ghi",
  "experiments": ["home_layout_v2", "prompt_math_v3"],
  "context": {
    "platform": "android",
    "app_version": "2.3.1",
    "grade": "G8",
    "member_type": "monthly"
  }
}
```

**响应体**：
```json
{
  "assignments": [
    {
      "experiment_key": "home_layout_v2",
      "variant_key": "card_grid",
      "payload": {
        "layout_type": "card_grid",
        "show_quick_ai": true,
        "task_count": 5
      }
    },
    {
      "experiment_key": "prompt_math_v3",
      "variant_key": "control",
      "payload": {
        "prompt_template_id": "math_explain_v1",
        "model_id": "glm-4"
      }
    }
  ],
  "config_version": "v20260520-001",
  "ttl_seconds": 300
}
```

### 8.2 事件上报接口

```
POST /api/v1/ab/events
```

**请求体**（批量）：
```json
{
  "events": [
    {
      "type": "exposure",
      "experiment_key": "home_layout_v2",
      "variant_key": "card_grid",
      "user_id": 12345,
      "timestamp": "2026-05-20T01:30:00Z"
    },
    {
      "type": "conversion",
      "experiment_key": "home_layout_v2",
      "variant_key": "card_grid",
      "user_id": 12345,
      "event_name": "question_answered",
      "event_value": 1.0,
      "timestamp": "2026-05-20T01:35:00Z"
    }
  ]
}
```

**响应体**：
```json
{
  "accepted": 2,
  "rejected": 0
}
```

### 8.3 管理接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/v1/admin/experiments` | GET | 实验列表（分页、过滤） |
| `/api/v1/admin/experiments` | POST | 创建实验 |
| `/api/v1/admin/experiments/{key}` | GET | 实验详情 |
| `/api/v1/admin/experiments/{key}` | PUT | 更新实验配置 |
| `/api/v1/admin/experiments/{key}/start` | POST | 启动实验 |
| `/api/v1/admin/experiments/{key}/pause` | POST | 暂停实验 |
| `/api/v1/admin/experiments/{key}/complete` | POST | 结束实验 |
| `/api/v1/admin/experiments/{key}/results` | GET | 实验结果 |
| `/api/v1/admin/experiments/{key}/srm` | GET | SRM 检测结果 |
| `/api/v1/admin/layers` | GET/POST | 层管理 |
| `/api/v1/admin/metrics` | GET/POST | 指标管理 |
| `/api/v1/admin/sample-size/calculate` | POST | 样本量估算 |

---

## 9. 管理后台功能

### 9.1 实验列表页

| 列 | 说明 |
|----|------|
| 实验名称 | 可点击进入详情 |
| 状态 | DRAFT / RUNNING / PAUSED / COMPLETED |
| 层 | 所属实验层 |
| 流量占比 | 如 "20%" |
| 运行时长 | "3天 / 预计14天" |
| 样本量 | "Ctrl: 12,340 / Trt: 12,289" |
| 核心指标 | "日活率: +2.3% (p=0.032) ✅" |
| 操作 | 暂停 / 详情 / 克隆 |

### 9.2 创建实验页

分步表单：

1. **基本信息**：名称、描述、假设、负责人
2. **分层与流量**：选择层、设置流量占比
3. **变体配置**：添加 Control 和 Treatment，配置 payload
4. **受众定向**：设置年级、平台、版本等筛选条件
5. **指标绑定**：选择核心指标和护栏指标
6. **时间与样本**：设定运行时长、最小样本量（自动估算）
7. **自动决策**：是否开启自动停止

### 9.3 实验结果看板

```
┌─────────────────────────────────────────────┐
│ 📊 实验报告: home_layout_v2                 │
│ 运行时间: 2026-05-10 ~ 2026-05-24 (14天)   │
├─────────────────────────────────────────────┤
│                                              │
│ 样本量:  Control = 25,431  Treatment = 25,389│
│ SRM 检测: ✅ 正常 (p=0.673)                 │
│                                              │
│ ┌─────────────────────────────────────────┐ │
│ │ 核心指标                                 │ │
│ │                                          │ │
│ │ 日活率     Ctrl: 42.3%  Trt: 44.1%      │ │
│ │            ↑ +1.8pp  p=0.023 ✅ 显著     │ │
│ │            CI: [+0.3pp, +3.3pp]          │ │
│ │                                          │ │
│ │ 人均学习时长 Ctrl: 23.1min  Trt: 24.8min │ │
│ │              ↑ +7.4%  p=0.041 ✅ 显著    │ │
│ │              CI: [+0.3min, +3.1min]       │ │
│ └─────────────────────────────────────────┘ │
│                                              │
│ ┌─────────────────────────────────────────┐ │
│ │ 护栏指标                                 │ │
│ │ 崩溃率    Ctrl: 0.31%  Trt: 0.29%  ✅   │ │
│ │ API错误率 Ctrl: 0.82%  Trt: 0.85%  ✅   │ │
│ └─────────────────────────────────────────┘ │
│                                              │
│ 💡 建议: SHIP (正向显著且护栏指标正常)       │
└─────────────────────────────────────────────┘
```

---

## 10. 与现有系统的集成

### 10.1 与灰度发布系统的关系

| 维度 | AB 测试 | 灰度发布 |
|------|---------|----------|
| 目的 | 验证假设、量化效果 | 安全上线、降低风险 |
| 分流 | 实验组 vs 对照组 | 灰度百分比 vs 全量 |
| 周期 | 有限时间（通常 1-4 周） | 持续推进至 100% |
| 结果 | 统计报告 + 决策建议 | 无统计要求 |
| 协作 | **先 AB 验证 → 再灰度放量** | |

**推荐流程**：新功能先通过 AB 测试验证效果（5-20% 流量），确认正向后进入灰度发布流程逐步放量至 100%。

### 10.2 与数据埋点系统的集成

AB 测试的事件上报复用现有的数据埋点通道：

```dart
// 埋点 SDK 自动附带实验信息
Analytics.track('question_answered', properties: {
  'question_id': 'q12345',
  'correct': true,
  // 以下由 AB SDK 自动注入
  'exp_home_layout_v2': 'card_grid',    // 实验变体
  'exp_prompt_math_v3': 'control',
});
```

埋点系统在处理事件时，根据曝光记录自动关联实验分组，无需每次手动上报。

### 10.3 与 AI 服务集成

```python
# AI 服务调用时自动注入实验 Prompt
async def handle_ai_question(request: AIQuestionRequest):
    # 获取用户的 Prompt 实验分组
    prompt_exp = ab_client.get_variant(
        user_id=request.user_id,
        experiment_key=f"prompt_{request.subject}_{request.grade_range}"
    )
    
    if prompt_exp:
        template_id = prompt_exp.payload['prompt_template_id']
        model_id = prompt_exp.payload['model_id']
    else:
        template_id = 'default'
        model_id = 'default'
    
    # 使用实验指定的 Prompt 和模型
    prompt = prompt_service.get_template(template_id, request.context)
    response = await ai_service.chat(model_id, prompt)
    
    return response
```

---

## 11. 错误处理与降级策略

### 11.1 分流失败降级

| 场景 | 处理策略 |
|------|----------|
| 实验配置服务不可用 | 使用本地缓存的最后已知配置 |
| 本地缓存为空 | 返回 null（走默认逻辑） |
| 配置解析异常 | 记录错误日志，走默认逻辑 |
| 分流 Hash 异常 | 走 Control 组 |

### 11.2 事件上报失败

```dart
class ABEventReporter {
  final Queue<ABEvent> _retryQueue = Queue();
  static const maxRetryCount = 3;
  
  Future<void> report(ABEvent event) async {
    try {
      await _apiClient.reportEvents([event]);
    } catch (e) {
      if (event.retryCount < maxRetryCount) {
        _retryQueue.add(event.copyWith(retryCount: event.retryCount + 1));
      }
      // 超过重试次数则丢弃（非关键路径，不影响用户体验）
      _scheduleRetry();
    }
  }
  
  void _scheduleRetry() {
    // 30 秒后批量重试
    Future.delayed(Duration(seconds: 30), _flushRetryQueue);
  }
}
```

### 11.3 自动保护机制

| 机制 | 触发条件 | 动作 |
|------|----------|------|
| SRM 告警 | 样本比偏差 p < 0.01 | 自动暂停实验 + 通知负责人 |
| 护栏触发 | 核心护栏指标超阈值 | 自动暂停 + P0 告警 |
| 超时自动结束 | 超过 max_duration_h | 自动标记 COMPLETED |
| 流量溢出 | 同层实验流量总和 > 100% | 创建时拦截，拒绝启动 |

---

## 12. 典型实验场景

### 12.1 场景一：首页布局实验

```
假设：卡片式网格布局比列表布局更能提高用户点击率
实验：home_layout_v2
层：ui
流量：20%
变体：
  - Control: list_feed (现有列表布局)
  - Treatment A: card_grid (卡片网格)
  - Treatment B: hybrid (混合布局)
指标：
  - 核心：日均学习时长、首页功能点击率
  - 护栏：崩溃率、首页加载耗时
预期运行：14天
预估样本量：每组约 50,000 用户
```

### 12.2 场景二：AI 数学解题 Prompt 实验

```
假设：分步引导式 Prompt 比直接解答式 Prompt 更能提升学习效果
实验：prompt_math_scaffold_v1
层：ai
流量：15%
变体：
  - Control: 当前 Prompt（直接给解答步骤）
  - Treatment: 脚手架式 Prompt（先提问引导，再逐步揭示）
指标：
  - 核心：同类题正确率提升、追问次数
  - 护栏：AI 回答满意度、首 token 耗时
受众：初中数学用户 (G7-G9, subject=math)
预期运行：10天
```

### 12.3 场景三：会员定价实验

```
假设：年费 7 折优惠比首月半价更能提高长期订阅率
实验：pricing_annual_discount_v1
层：operation
流量：10%
变体：
  - Control: 当前定价策略
  - Treatment A: 年费 7 折
  - Treatment B: 首月半价
指标：
  - 核心：付费转化率、ARPU、30天续费率
  - 护栏：投诉率、退款率
受众：免费用户，APP版本 >= 2.1.0
预期运行：21天
注意：定价实验需法务确认合规性
```

---

## 13. 安全与合规

### 13.1 权限控制

| 操作 | 角色 |
|------|------|
| 创建/编辑实验 | 产品经理、实验负责人 |
| 启动/暂停实验 | 实验负责人 + 技术评审 |
| 查看实验结果 | 全员可读 |
| 修改层配置 | 管理员 |
| 删除实验 | 管理员 |

### 13.2 未成年人保护

- 分流时不得收集未成年人额外个人信息
- 面向幼儿/小学的实验需额外审批（涉及 UI 变更影响认知体验）
- 定价类实验不得针对未成年用户直接推送

### 13.3 数据合规

- 曝光数据保留 90 天，过期自动清理
- 实验结果聚合数据保留 2 年
- 个人级别实验数据不对外导出，仅展示聚合统计
