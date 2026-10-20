# 用户额度与API调用管控系统 - 详细设计

## 1. 概述

### 1.1 文档目标

本文档详细设计 PrimeTop 的用户额度与 API 调用管控系统，定义每个用户在每个功能上的调用次数限制、实时计数方案、配额消耗与会员权益联动、超额处理策略以及多级限流机制，确保 AI 调用成本可控的同时为用户提供流畅的使用体验。

### 1.2 系统定位

本系统是连接「支付与会员订阅」和「多模型调度与成本治理」之间的桥梁：

```
用户请求 → API网关 → [额度管控系统] → 业务服务 → 多模型调度 → AI模型
                         ↓                                ↑
                    会员权益服务 ←→ 额度计数器          成本治理
```

### 1.3 核心职责

| 职责 | 说明 |
|------|------|
| 额度定义 | 按功能维度、会员等级定义调用配额 |
| 实时计数 | 高性能分布式计数，支持秒级精度 |
| 配额校验 | 请求前校验剩余额度，决定放行/拒绝/降级 |
| 配额消耗 | 请求完成后扣减额度（异步/同步） |
| 额度重置 | 按周期自动重置配额 |
| 用量展示 | 向客户端暴露剩余额度信息 |
| 超额引导 | 额度耗尽时引导升级会员 |
| 多级限流 | 全局→用户→功能→接口多级保护 |

---

## 2. 额度模型设计

### 2.1 功能维度定义

系统按「功能」维度管理额度，每个功能有独立的配额和计数逻辑：

```go
// FeatureType 功能类型枚举
type FeatureType string

const (
    FeatureAIQA           FeatureType = "ai_qa"            // AI文字问答
    FeatureAIStream       FeatureType = "ai_stream"        // AI流式问答（单次对话含多轮）
    FeaturePhotoOCR       FeatureType = "photo_ocr"        // 拍照识题
    FeaturePhotoSolve     FeatureType = "photo_solve"      // 拍照解题（含OCR+解析）
    FeatureEssayReview    FeatureType = "essay_review"     // 作文批改
    FeatureVoiceASR       FeatureType = "voice_asr"        // 语音识别
    FeatureVoiceTTS       FeatureType = "voice_tts"        // 语音合成
    FeatureReciteCheck    FeatureType = "recite_check"     // 背诵检测
    FeatureQuestionGen    FeatureType = "question_gen"     // AI题目生成
    FeatureSimilarQ       FeatureType = "similar_question" // 同类题推荐
    FeatureStudyReport    FeatureType = "study_report"     // 学习报告生成
    FeatureDeepAnalysis   FeatureType = "deep_analysis"    // 深度学情分析
)
```

### 2.2 会员等级配额矩阵

```go
// QuotaConfig 额度配置
type QuotaConfig struct {
    ID           string       `json:"id"`
    FeatureType  FeatureType  `json:"feature_type"`
    Tier         MemberTier   `json:"tier"`
    Quota        int          `json:"quota"`          // 周期内额度，-1表示无限
    Period       QuotaPeriod  `json:"period"`         // 额度周期
    Overdraft    int          `json:"overdraft"`       // 允许透支次数
    GracePercent int          `json:"grace_percent"`   // 额度预警阈值百分比（如80）
    RetryWindow  int          `json:"retry_window_sec"` // 超额后重试窗口（秒）
}
```

#### 配额表（默认值，可通过配置中心动态调整）

| 功能 | 免费用户 | 月度会员 | 年度会员 | 专项会员 | 周期 |
|------|---------|---------|---------|---------|------|
| AI文字问答 | 5次/天 | 100次/天 | 无限 | 无限 | 日 |
| AI流式问答（多轮） | 3次/天 | 50次/天 | 无限 | 无限 | 日 |
| 拍照识题 | 3次/天 | 30次/天 | 50次/天 | 无限 | 日 |
| 拍照解题 | 2次/天 | 20次/天 | 40次/天 | 无限 | 日 |
| 作文批改 | 1次/天 | 5次/天 | 10次/天 | 20次/天 | 日 |
| 语音识别 | 5次/天 | 50次/天 | 无限 | 无限 | 日 |
| 语音合成 | 10次/天 | 100次/天 | 无限 | 无限 | 日 |
| 背诵检测 | 0次 | 10次/天 | 30次/天 | 无限 | 日 |
| AI题目生成 | 0次 | 5次/天 | 10次/天 | 20次/天 | 日 |
| 同类题推荐 | 3次/天 | 20次/天 | 50次/天 | 无限 | 日 |
| 学习报告 | 1次/周 | 1次/天 | 3次/天 | 5次/天 | 按需 |
| 深度学情分析 | 0次 | 1次/周 | 1次/天 | 3次/天 | 按需 |

### 2.3 会员等级枚举

```go
type MemberTier string

const (
    TierFree       MemberTier = "free"        // 免费用户
    TierMonthly    MemberTier = "monthly"     // 月度会员
    TierYearly     MemberTier = "yearly"      // 年度会员
    TierExamPrep   MemberTier = "exam_prep"   // 中高考专项会员
    TierVIP        MemberTier = "vip"         // 终身VIP（预留）
)
```

### 2.4 额度周期

```go
type QuotaPeriod string

const (
    PeriodDaily   QuotaPeriod = "daily"    // 自然日
    PeriodWeekly  QuotaPeriod = "weekly"   // 自然周（周一开始）
    PeriodMonthly QuotaPeriod = "monthly"  // 自然月
)
```

---

## 3. 数据结构设计

### 3.1 核心数据表

#### 3.1.1 用户额度快照表 `user_quota_snapshot`

存储用户当前周期的额度使用情况，作为 Redis 的持久化后盾。

```sql
CREATE TABLE user_quota_snapshot (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id         BIGINT NOT NULL COMMENT '用户ID',
    feature_type    VARCHAR(32) NOT NULL COMMENT '功能类型',
    tier            VARCHAR(16) NOT NULL COMMENT '当前会员等级',
    period_type     VARCHAR(16) NOT NULL COMMENT '额度周期',
    period_key      VARCHAR(16) NOT NULL COMMENT '周期标识(如20260522)',
    quota_limit     INT NOT NULL DEFAULT 0 COMMENT '周期总额度，-1=无限',
    used_count      INT NOT NULL DEFAULT 0 COMMENT '已使用次数',
    overdraft_used  INT NOT NULL DEFAULT 0 COMMENT '已透支次数',
    last_reset_at   DATETIME NOT NULL COMMENT '上次重置时间',
    last_used_at    DATETIME NULL COMMENT '上次使用时间',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_user_feature_period (user_id, feature_type, period_key),
    INDEX idx_user_id (user_id),
    INDEX idx_period_key (period_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户额度快照';
```

#### 3.1.2 额度消耗日志表 `quota_usage_log`

记录每次额度消耗的详细信息，用于对账、分析和异常排查。

```sql
CREATE TABLE quota_usage_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id         BIGINT NOT NULL COMMENT '用户ID',
    feature_type    VARCHAR(32) NOT NULL COMMENT '功能类型',
    session_id      VARCHAR(64) NULL COMMENT '会话ID/请求ID',
    cost_amount     INT NOT NULL DEFAULT 1 COMMENT '消耗额度（通常为1）',
    model_used      VARCHAR(32) NULL COMMENT '实际调用的AI模型',
    model_cost_ms   INT NULL COMMENT '模型响应耗时(ms)',
    result_code     VARCHAR(16) NOT NULL COMMENT '结果：success/fail/timeout/fallback',
    client_version  VARCHAR(16) NULL COMMENT '客户端版本',
    platform        VARCHAR(8) NULL COMMENT '平台：android/ios/web',
    ip_address      VARCHAR(45) NULL COMMENT '客户端IP',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_user_created (user_id, created_at),
    INDEX idx_feature_created (feature_type, created_at),
    INDEX idx_session_id (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='额度消耗日志';
```

#### 3.1.3 额度配置表 `quota_config`

可通过管理后台动态调整的额度配置。

```sql
CREATE TABLE quota_config (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    feature_type    VARCHAR(32) NOT NULL COMMENT '功能类型',
    tier            VARCHAR(16) NOT NULL COMMENT '会员等级',
    quota           INT NOT NULL COMMENT '额度(-1=无限)',
    period          VARCHAR(16) NOT NULL COMMENT '周期',
    overdraft       INT NOT NULL DEFAULT 0 COMMENT '透支上限',
    grace_percent   INT NOT NULL DEFAULT 80 COMMENT '预警阈值%',
    retry_window_sec INT NOT NULL DEFAULT 300 COMMENT '超额重试窗口(秒)',
    is_active       TINYINT NOT NULL DEFAULT 1 COMMENT '是否启用',
    effective_from  DATETIME NULL COMMENT '生效时间',
    effective_to    DATETIME NULL COMMENT '失效时间',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_feature_tier (feature_type, tier),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='额度配置';
```

### 3.2 Redis 数据结构

额度计数完全依赖 Redis 实现，MySQL 作为持久化后盾。

#### 3.2.1 用户功能计数器

```
Key格式: quota:{user_id}:{feature_type}:{period_key}
Type: String (integer)
TTL: 根据周期设置（日=48h，周=8d，月=32d）
Example: quota:100001:ai_qa:20260522 → "3"
```

#### 3.2.2 用户功能额度元信息

```
Key格式: quota:meta:{user_id}:{feature_type}
Type: Hash
Fields:
  tier         → "monthly"
  limit        → "100"
  period       → "daily"
  overdraft    → "2"
  overdraft_used → "0"
  grace_pct    → "80"
  last_reset   → "2026-05-22T00:00:00+08:00"
TTL: 同周期
```

#### 3.2.3 全局功能计数器（用于平台级监控）

```
Key格式: global:quota:{feature_type}:{period_key}
Type: String (integer)
TTL: 同上
```

#### 3.2.4 用户级别限流计数器

```
Key格式: ratelimit:{user_id}:{window}
Type: String (integer)
TTL: window 秒数
Example: ratelimit:100001:60 → "5"  (每分钟请求数)
```

---

## 4. 核心流程设计

### 4.1 额度校验主流程

每次用户发起需要消耗额度的请求时，API 网关拦截并执行校验：

```
用户请求
  │
  ▼
API网关 (拦截器)
  │
  ├─ 1. 解析请求，确定 feature_type
  ├─ 2. 查询用户会员等级（本地缓存/Redis）
  ├─ 3. 获取该功能对应会员等级的配额配置
  │
  ▼
配额检查（Redis原子操作）
  │
  ├─ quota = -1 (无限) ──────────────────► 放行 → 业务服务
  │
  ├─ 当前用量 < quota × grace_pct ──────► 放行 + 异步记录
  │
  ├─ quota × grace_pct ≤ 用量 < quota ──► 放行 + 附加预警标记
  │                                        （响应头携带 X-Quota-Warning）
  │
  ├─ quota ≤ 用量 < quota + overdraft ──► 放行 + 扣减透支额度
  │                                        （响应头携带 X-Quota-Critical）
  │
  ├─ 用量 ≥ quota + overdraft ───────────► 拒绝 → 返回额度不足
  │                                        + 引导升级/购买加油包
  │
  └─ Redis不可用（降级）────────────────► 查本地缓存配额
                                          → 未超本地阈值则放行
                                          → 超出则拒绝（保守策略）
```

### 4.2 额度消耗流程

```go
// QuotaService 额度服务接口
type QuotaService interface {
    // CheckAndReserve 检查并预占额度（原子操作）
    CheckAndReserve(ctx context.Context, req *QuotaRequest) (*QuotaResult, error)
    
    // ConfirmUsage 确认消耗（请求成功后）
    ConfirmUsage(ctx context.Context, req *ConfirmRequest) error
    
    // Rollback 回滚预占额度（请求失败时）
    Rollback(ctx context.Context, req *RollbackRequest) error
    
    // GetQuotaStatus 查询用户额度状态
    GetQuotaStatus(ctx context.Context, userID int64) ([]*FeatureQuotaStatus, error)
}

// QuotaRequest 额度请求
type QuotaRequest struct {
    UserID       int64       `json:"user_id"`
    FeatureType  FeatureType `json:"feature_type"`
    Amount       int         `json:"amount"`        // 消耗量，默认1
    RequestID    string      `json:"request_id"`     // 幂等键
    AllowOverdraft bool       `json:"allow_overdraft"`
}

// QuotaResult 额度检查结果
type QuotaResult struct {
    Allowed      bool   `json:"allowed"`
    Reason       string `json:"reason,omitempty"`
    Remaining    int    `json:"remaining"`       // 剩余额度，-1=无限
    QuotaLimit   int    `json:"quota_limit"`     // 总额度
    Used         int    `json:"used"`            // 已用量
    WarningLevel string `json:"warning_level"`   // none/warning/critical/exceeded
    RetryAfter   int    `json:"retry_after_sec,omitempty"`
}
```

#### 4.2.1 Redis 原子操作实现

使用 Lua 脚本保证检查+扣减的原子性：

```lua
-- check_and_deduct.lua
-- KEYS[1] = quota counter key (quota:{uid}:{feat}:{period})
-- KEYS[2] = overdraft counter key (overdraft:{uid}:{feat}:{period})
-- ARGV[1] = quota limit (-1 for unlimited)
-- ARGV[2] = overdraft limit
-- ARGV[3] = deduct amount (usually 1)
-- ARGV[4] = grace percent (e.g. 80，来自 quota_config.grace_percent)
-- Returns: {allowed, remaining, warning_level}
--   allowed: 1=yes, 0=no
--   remaining: remaining count (-1=unlimited)
--   warning_level: 0=normal, 1=warning, 2=critical, 3=exceeded

local counter_key = KEYS[1]
local overdraft_key = KEYS[2]
local limit = tonumber(ARGV[1])
local overdraft_limit = tonumber(ARGV[2])
local amount = tonumber(ARGV[3])
local grace_pct = tonumber(ARGV[4]) or 80

-- 无限额度
if limit == -1 then
    local current = tonumber(redis.call('GET', counter_key) or '0')
    redis.call('INCRBY', counter_key, amount)
    return {1, -1, 0}
end

local current = tonumber(redis.call('GET', counter_key) or '0')
local new_count = current + amount

-- 正常额度内
if new_count <= limit then
    redis.call('INCRBY', counter_key, amount)
    local remaining = limit - new_count
    local grace_threshold = math.floor(limit * grace_pct / 100)
    local warning = 0
    if remaining <= 0 then
        warning = 2
    elseif new_count >= grace_threshold then
        warning = 1
    end
    return {1, remaining, warning}
end

-- 检查透支额度
local overdraft_used = tonumber(redis.call('GET', overdraft_key) or '0')
if overdraft_used < overdraft_limit then
    redis.call('INCRBY', counter_key, amount)
    redis.call('INCRBY', overdraft_key, amount)
    return {1, 0, 2}
end

-- 额度完全耗尽
return {0, 0, 3}
```

### 4.3 额度重置机制

#### 4.3.1 重置调度

```go
// QuotaResetScheduler 额度重置调度器
type QuotaResetScheduler struct {
    redis    redis.Client
    db       *gorm.DB
    logger   *zap.Logger
}

// ResetDailyQuotas 每日额度重置（cron: 0 0 * * *）
func (s *QuotaResetScheduler) ResetDailyQuotas(ctx context.Context) error {
    today := time.Now().Format("20060102")
    yesterday := time.Now().AddDate(0, 0, -1).Format("20060102")
    
    // 1. 扫描昨日的日周期计数器
    pattern := fmt.Sprintf("quota:*:*:%s", yesterday)
    iter := s.redis.Scan(ctx, 0, pattern, 1000).Iterator()
    
    var archived int64
    for iter.Next(ctx) {
        key := iter.Val()
        
        // 提取 user_id 和 feature_type
        parts := strings.Split(key, ":")
        if len(parts) < 4 { continue }
        userID := parts[1]
        featureType := parts[2]
        
        // 2. 持久化到 user_quota_snapshot
        count, _ := s.redis.Get(ctx, key).Int()
        s.persistSnapshot(ctx, userID, featureType, yesterday, count)
        
        // 3. 删除旧计数器
        s.redis.Del(ctx, key)
        s.redis.Del(ctx, fmt.Sprintf("overdraft:%s:%s:%s", userID, featureType, yesterday))
        s.redis.Del(ctx, fmt.Sprintf("quota:meta:%s:%s", userID, featureType))

        // 3.1 消费待降级标记：降级会员在新周期开始时生效（修复 F3：v1.0 标记无消费逻辑）
        pendingKey := fmt.Sprintf("pending_tier:%s:%s", userID, featureType)
        if pendingTier, err := s.redis.Get(ctx, pendingKey).Result(); err == nil && pendingTier != "" {
            newConfig := s.getConfig(MemberTier(pendingTier), FeatureType(featureType))
            s.redis.HSet(ctx, fmt.Sprintf("quota:meta:%s:%s", userID, featureType),
                "tier", pendingTier,
                "limit", strconv.Itoa(newConfig.Quota),
                "period", string(newConfig.Period),
                "period_key", today,
                "overdraft", strconv.Itoa(newConfig.Overdraft),
                "overdraft_used", "0",
                "grace_pct", strconv.Itoa(newConfig.GracePercent),
                "last_reset", time.Now().Format(time.RFC3339),
            )
            s.redis.Del(ctx, pendingKey)
        }

        archived++
    }
    
    s.logger.Info("daily quota reset completed",
        zap.String("period", yesterday),
        zap.Int64("archived", archived))
    return nil
}

// ResetWeeklyQuotas 每周额度重置（cron: 0 0 * * 1）
func (s *QuotaResetScheduler) ResetWeeklyQuotas(ctx context.Context) error {
    // 类似日重置，但处理 period=weekly 的计数器
    // ...
    return nil
}
```

#### 4.3.2 惰性重置（兜底）

用户请求时发现计数器 period_key 与当前周期不匹配，自动重置：

```go
func (s *QuotaServiceImpl) ensureCurrentPeriod(ctx context.Context, userID int64, feat FeatureType) error {
    metaKey := fmt.Sprintf("quota:meta:%d:%s", userID, feat)
    periodKey := s.getCurrentPeriodKey(feat) // e.g., "20260522" for daily
    
    storedPeriod, err := s.redis.HGet(ctx, metaKey, "period_key").Result()
    if err == redis.Nil {
        // 无元信息（新用户或 Key 已过期）：按当前周期初始化，不做归档
        return s.initMeta(ctx, userID, feat, metaKey, periodKey)
    }
    if err != nil {
        return fmt.Errorf("read quota meta failed: %w", err)
    }

    if storedPeriod != periodKey {
        // 周期已切换，重建计数器
        oldCounterKey := fmt.Sprintf("quota:%d:%s:%s", userID, feat, storedPeriod)
        count, _ := s.redis.Get(ctx, oldCounterKey).Int()
        
        // 异步归档
        go s.persistSnapshot(context.Background(), 
            strconv.FormatInt(userID, 10), string(feat), storedPeriod, count)
        
        // 删除旧key
        s.redis.Del(ctx, oldCounterKey)
        
        // 更新meta
        s.redis.HSet(ctx, metaKey, "period_key", periodKey)
    }
    return nil
}

// initMeta 初始化用户功能额度元信息（新用户首次访问该功能时）
func (s *QuotaServiceImpl) initMeta(ctx context.Context, userID int64, feat FeatureType, metaKey, periodKey string) error {
    config := s.getConfig(s.getUserTier(ctx, userID), feat)
    return s.redis.HSet(ctx, metaKey,
        "tier", string(config.Tier),
        "limit", strconv.Itoa(config.Quota),
        "period", string(config.Period),
        "period_key", periodKey,
        "overdraft", strconv.Itoa(config.Overdraft),
        "overdraft_used", "0",
        "grace_pct", strconv.Itoa(config.GracePercent),
        "last_reset", time.Now().Format(time.RFC3339),
    ).Err()
}
```

### 4.4 会员等级变更处理

用户升级/降级会员时，需要重新计算额度：

```go
// HandleTierChange 会员等级变更处理器
func (s *QuotaServiceImpl) HandleTierChange(ctx context.Context, event *TierChangeEvent) error {
    userID := event.UserID
    oldTier := event.OldTier
    newTier := event.NewTier
    
    // 策略：升级立即生效，降级下个周期生效
    if IsUpgrade(oldTier, newTier) {
        // 升级：刷新所有功能额度到新等级
        for _, feat := range AllFeatureTypes() {
            config := s.getConfig(newTier, feat)
            metaKey := fmt.Sprintf("quota:meta:%d:%s", userID, feat)
            
            // 不重置已用计数，只提升上限
            s.redis.HSet(ctx, metaKey,
                "tier", string(newTier),
                "limit", strconv.Itoa(config.Quota),
                "overdraft", strconv.Itoa(config.Overdraft),
            )
        }
        
        // 清除客户端缓存
        s.notifyClientRefresh(ctx, userID)
    } else {
        // 降级：标记待降级，下个周期生效
        // TTL 32 天兜底：即使重置任务长时间异常，标记也不会永久残留（守卫 G3）
        for _, feat := range AllFeatureTypes() {
            s.redis.Set(ctx,
                fmt.Sprintf("pending_tier:%d:%s", userID, feat),
                string(newTier),
                32*24*time.Hour)
        }
    }
    
    return nil
}
```

---

## 5. 多级限流设计

### 5.1 限流层级

系统实现四级限流保护：

```
Level 1: 全局限流 (Nginx/API网关层)
  │     保护后端整体不被压垮
      │
Level 2: 用户级限流 (网关→限流服务)
  │     单用户总请求频率限制
      │
Level 3: 功能级限流 (额度管控)
  │     单用户单功能配额限制
      │
Level 4: 接口级限流 (业务服务)
        特定接口精细控制（如AI调用频率）
```

### 5.2 限流配置

```go
// RateLimitConfig 限流配置
type RateLimitConfig struct {
    // Level 1: 全局
    GlobalRPS          int `json:"global_rps"`           // 全局每秒请求数上限（如 5000）
    GlobalConcurrent   int `json:"global_concurrent"`    // 全局并发连接上限（如 2000）
    
    // Level 2: 用户级
    UserRPS            int `json:"user_rps"`             // 单用户每秒请求上限（如 10）
    UserRPM            int `json:"user_rpm"`             // 单用户每分钟请求上限（如 60）
    UserConcurrent     int `json:"user_concurrent"`      // 单用户并发连接上限（如 5）
    
    // Level 3: 功能级（已在额度配置中定义）
    
    // Level 4: 接口级
    AIRPSCap           int `json:"ai_rps_cap"`           // AI相关接口单用户RPS上限（如 2）
    PhotoRPSCap        int `json:"photo_rps_cap"`        // 拍照接口单用户RPS上限（如 1）
}

// DefaultRateLimitConfig 默认限流配置
var DefaultRateLimitConfig = RateLimitConfig{
    GlobalRPS:        5000,
    GlobalConcurrent: 2000,
    UserRPS:          10,
    UserRPM:          60,
    UserConcurrent:   5,
    AIRPSCap:         2,
    PhotoRPSCap:      1,
}
```

### 5.3 限流算法选择

| 层级 | 算法 | 实现 | 说明 |
|------|------|------|------|
| Level 1 | 令牌桶 | Nginx limit_req | 精确控制全流量 |
| Level 2 | 滑动窗口 | Redis + Lua | 按用户精确计数 |
| Level 3 | 计数器 | Redis INCR | 额度管控已覆盖 |
| Level 4 | 令牌桶 | 业务服务本地 | 防止AI接口突发 |

### 5.4 用户级滑动窗口限流实现

```lua
-- user_rate_limit.lua
-- KEYS[1] = ratelimit:{uid}:{window_sec}
-- ARGV[1] = max requests in window
-- ARGV[2] = current timestamp (ms)
-- ARGV[3] = window size (ms)
-- Returns: {allowed, remaining, retry_after_ms}

local key = KEYS[1]
local limit = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local window = tonumber(ARGV[3])

-- 清除窗口外的记录
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

-- 当前窗口请求数
local count = redis.call('ZCARD', key)

if count < limit then
    -- 添加当前请求
    redis.call('ZADD', key, now, now .. ':' .. math.random(1000000))
    redis.call('PEXPIRE', key, window)
    return {1, limit - count - 1, 0}
else
    -- 计算最早请求的过期时间
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local retry_after = 0
    if #oldest > 0 then
        retry_after = tonumber(oldest[2]) + window - now
    end
    return {0, 0, retry_after}
end
```

---

## 6. API 接口设计

### 6.1 客户端接口

#### 6.1.1 查询额度状态

```
GET /api/v1/quota/status
```

**响应：**
```json
{
    "code": 0,
    "data": {
        "tier": "monthly",
        "tier_display": "月度会员",
        "tier_expire_at": "2026-06-22T00:00:00+08:00",
        "features": [
            {
                "feature_type": "ai_qa",
                "feature_name": "AI文字问答",
                "quota_limit": 100,
                "quota_used": 23,
                "quota_remaining": 77,
                "period": "daily",
                "period_reset_at": "2026-05-23T00:00:00+08:00",
                "warning_level": "none"
            },
            {
                "feature_type": "photo_solve",
                "feature_name": "拍照解题",
                "quota_limit": 20,
                "quota_used": 18,
                "quota_remaining": 2,
                "period": "daily",
                "period_reset_at": "2026-05-23T00:00:00+08:00",
                "warning_level": "critical"
            },
            {
                "feature_type": "essay_review",
                "feature_name": "作文批改",
                "quota_limit": 5,
                "quota_used": 5,
                "quota_remaining": 0,
                "period": "daily",
                "period_reset_at": "2026-05-23T00:00:00+08:00",
                "warning_level": "exceeded"
            }
        ],
        "daily_reset_at": "2026-05-23T00:00:00+08:00"
    }
}
```

#### 6.1.2 额度不足响应格式

当请求被额度系统拦截时，返回统一格式：

```
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1716393600
Retry-After: 28800
```

```json
{
    "code": 42901,
    "message": "今日AI问答次数已用完",
    "data": {
        "feature_type": "ai_qa",
        "feature_name": "AI文字问答",
        "quota_limit": 5,
        "quota_used": 5,
        "period": "daily",
        "reset_at": "2026-05-23T00:00:00+08:00",
        "retry_after_sec": 28800,
        "upgrade_suggestion": {
            "tier": "monthly",
            "tier_display": "月度会员",
            "new_limit": 100,
            "price": "¥29.9/月",
            "upgrade_url": "/api/v1/subscription/plans"
        },
        "add_on_available": [
            {
                "product_id": "addon_ai_qa_10",
                "name": "AI问答10次加油包",
                "price": "¥2.9",
                "purchase_url": "/api/v1/store/addon/ai_qa_10/purchase"
            },
            {
                "product_id": "addon_ai_qa_30",
                "name": "AI问答30次加油包",
                "price": "¥6.9",
                "purchase_url": "/api/v1/store/addon/ai_qa_30/purchase"
            }
        ],
        "daily_reset_at": "2026-05-23T00:00:00+08:00"
    }
}
```

**响应说明：**

| 字段 | 说明 |
|------|------|
| code | 42901=额度耗尽（客户端统一文案），42902=触发限流，42903=功能仅限会员 |
| retry_after_sec | 到下个重置周期的秒数，客户端据此显示倒计时 |
| upgrade_suggestion | 升级引导，会员用户此字段为 null |
| add_on_available | 可用加油包列表，无可用时为空数组（加油包售卖权威归增值服务系统，本系统只读引用） |

> 合规红线：额度不足引导文案禁止学习焦虑式营销（如"再不升级就要落后了"），仅陈述事实与权益差异。

#### 6.1.3 加油包额度查询（只读引用）

```
GET /api/v1/quota/addons
```

**响应：**
```json
{
    "code": 0,
    "data": {
        "addons": [
            {
                "product_id": "addon_ai_qa_10",
                "name": "AI问答10次加油包",
                "remaining": 7,
                "expire_at": "2026-06-22T00:00:00+08:00"
            }
        ]
    }
}
```

> 裁决：加油包余额 SSOT 归增值服务系统，本接口为 BFF 聚合只读转发，不维护加油包计数（契约 R6）。

### 6.2 内部接口（服务间）

#### 6.2.1 gRPC 服务定义

```protobuf
syntax = "proto3";
package quota.v1;

service QuotaService {
    // 校验并扣减额度（同步，AI/拍题等实时链路调用）
    rpc CheckAndConsume(CheckAndConsumeRequest) returns (CheckAndConsumeResponse);
    // 批量查询额度状态（BFF 聚合首页数据）
    rpc BatchGetQuotaStatus(BatchGetQuotaStatusRequest) returns (BatchGetQuotaStatusResponse);
    // 会员等级变更事件回流确认（消费 membership.changed 后确认处理完成）
    rpc ConfirmTierProcessed(ConfirmTierProcessedRequest) returns (ConfirmTierProcessedResponse);
}

message CheckAndConsumeRequest {
    int64 user_id = 1;
    string feature_type = 2;
    int32 amount = 3;              // 默认 1
    string request_id = 4;         // 幂等键：调用方请求唯一ID
    bool allow_overdraft = 5;      // 是否允许透支（默认 true，按配置）
    string scene = 6;              // 调用场景：api / cron / internal
}

message CheckAndConsumeResponse {
    bool allowed = 1;
    string reason = 2;             // 拒绝原因码：QUOTA_EXCEEDED / RATE_LIMITED / INTERNAL
    int32 remaining = 3;           // -1 = 无限
    int32 quota_limit = 4;
    int32 used = 5;
    string warning_level = 6;      // none / warning / critical / exceeded
    int32 retry_after_sec = 7;
}

message BatchGetQuotaStatusRequest {
    repeated int64 user_ids = 1;   // ≤ 200
    repeated string feature_types = 2;
}

message BatchGetQuotaStatusResponse {
    repeated FeatureQuota quotas = 1;
}

message FeatureQuota {
    int64 user_id = 1;
    string feature_type = 2;
    int32 quota_limit = 3;
    int32 used = 4;
    int32 remaining = 5;
    string period = 6;
    string period_reset_at = 7;
    string warning_level = 8;
}

message ConfirmTierProcessedRequest {
    int64 user_id = 1;
    string event_id = 2;           // membership.changed 事件ID，幂等键
    string new_tier = 3;
}

message ConfirmTierProcessedResponse {
    bool success = 1;
}
```

#### 6.2.2 调用方集成约定

| 调用方 | 接口 | 说明 |
|--------|------|------|
| AI 对话引擎 | CheckAndConsume(ai_qa/ai_stream) | 首 token 前同步校验；流式中断不回滚（一次会话计一次，裁决 R3） |
| 拍照搜题编排 | CheckAndConsume(photo_ocr) + CheckAndConsume(photo_solve) | OCR 与解题分开计费；OCR 失败不计 photo_solve（契约 R4） |
| 作文批改引擎 | CheckAndConsume(essay_review) | 提交时校验，批改失败 30s 内可回滚 |
| 语音服务网关 | CheckAndConsume(voice_asr/voice_tts) | ASR 按次，TTS 按次（不按字符） |
| BFF 首页聚合 | BatchGetQuotaStatus | 首页工作台卡片数据，缓存 30s |
| 会员服务 | ConfirmTierProcessed | 等级变更回执，未完成确认事件按幂等重投 |

### 6.3 管理端接口

```
PUT    /admin/api/v1/quota/config/{feature_type}/{tier}     # 调整配额配置（双人审批 G8）
GET    /admin/api/v1/quota/config                           # 配置列表
POST   /admin/api/v1/quota/manual-reset                     # 手动重置指定用户额度（审计）
GET    /admin/api/v1/quota/usage-log                        # 消耗日志查询（分页，user_id 脱敏展示）
GET    /admin/api/v1/quota/alert-config                     # 告警阈值配置
GET    /admin/api/v1/quota/health                           # 额度服务健康度（Redis 命中率/降级率）
```

**配置调整请求：**
```json
{
    "quota": 120,
    "period": "daily",
    "overdraft": 2,
    "grace_percent": 80,
    "retry_window_sec": 300,
    "effective_from": "2026-05-25T00:00:00+08:00",
    "change_reason": "月度会员 AI 问答配额上调",
    "approval_ticket": "TICKET-20260522-001"
}
```

> 配置热更新：quota_config 变更经审批后写 MySQL + 发布配置变更事件，各节点本地 Caffeine 缓存 30s 内失效重建；进行中的周期不追溯调整（本周期仍按旧 limit 执行，新 limit 下个周期生效，G6 裁决）。

### 6.4 幂等与限流总表

| 接口 | 幂等键 | 限流（单用户） |
|------|--------|----------------|
| GET /quota/status | 天然只读 | 30 次/分 |
| GET /quota/addons | 天然只读 | 30 次/分 |
| CheckAndConsume | request_id（24h 内同键返回首次结果） | AI 类 2 RPS |
| BatchGetQuotaStatus | 只读 | 内部服务 100 次/分 |
| PUT /admin/config | approval_ticket 唯一 | 管理员 10 次/分 |
| POST /admin/manual-reset | (user_id, feature_type, period_key) 唯一 | 管理员 10 次/分 |

---

## 7. 状态机与守卫

### 7.1 额度周期状态机

```
            周期开始                用量达到 grace%           用量达到 limit
[UNTOUCHED] ────────→ [NORMAL] ──────────────→ [WARNING] ────────────→ [EXHAUSTED]
                                              （预警标记，       （可透支，标记 critical）
                                                不拦截）
                                              │                      │
                                              │ 继续消耗              │ overdraft 耗尽
                                              ▼                      ▼
                                        〔仍 NORMAL 周期内〕      [BLOCKED] ──周期重置──→ [NORMAL]
                                                                （拦截+引导）
```

状态为读时派生（由 used/limit/overdraft_used 计算），不落库，多端展示一致。

### 7.2 守卫规则

| 编号 | 规则 | 级别 |
|------|------|------|
| G1 | CheckAndConsume 检查+扣减必须 Lua 原子执行，禁止 GET 后 INCRBY 两步操作（降级 D4 除外） | P0 |
| G2 | Redis 宕机降级 DB 计数时，单用户单功能分钟级上限 10 次硬顶（防降级窗口超扣放大） | P0 |
| G3 | pending_tier 标记必须带 TTL（32 天），禁止无过期残留 | P1 |
| G4 | 额度不足响应必须携带 reset_at 与 retry_after_sec，禁止只报"次数用完" | P1 |
| G5 | 已扣额度不因业务失败自动回滚：仅作文批改/拍照解题类显式声明可回滚的功能支持 Rollback，且回滚窗口 ≤ 30s | P1 |
| G6 | 配置调整不追溯当前周期（见 §6.3），防止周期中途额度突变的对账混乱 | P1 |
| G7 | 注销用户：quota Redis 键 24h 内删除、user_quota_snapshot 与 quota_usage_log 匿名化保留 180 天后物理删除（契约 R9） | P0 |
| G8 | 配额配置调整必须双人审批 + approval_ticket 留痕 | P0 |
| G9 | 未成年人额度拦截文案不展示"购买"按钮，仅提示"请家长协助"（合规 C4） | P0 |
| G10 | 无限额度（quota=-1）也必须计数并写 quota_usage_log（成本对账需要） | P1 |

---

## 8. 幂等与并发场景

| 场景 | 裁决 |
|------|------|
| 同 request_id 重复扣减（客户端重试） | 24h 窗口返回首次结果，不重复扣（Redis SETNX request_id → result snapshot） |
| 并发请求同时到达限值边界 | Lua 原子裁决，先到者成功，后到者获 QUOTA_EXCEEDED |
| 重置任务与惰性重置并发 | 均以 period_key 为准：新周期键已存在则跳过；归档使用 INSERT IGNORE（uk_user_feature_period 幂等） |
| 会员升级与消耗并发 | 升级刷新 meta 使用 HSET 整字段重写，消耗读 meta 在 Lua 内完成，天然串行 |
| 降级标记与周期重置并发 | pending_tier 由重置任务单线程消费（扫描时 DELETE 后处理，Lua 原子），重复消费幂等 |
| 管理端手动重置与正常消耗并发 | manual-reset 获取 per-user 分布式锁（SETNX 10s），重置期间请求按 G2 降级阈值处理 |
| 回滚与再次消耗并发 | Rollback 仅允许对未超过 30s 窗口且 result_code=success 的记录执行，CAS 状态防双回滚 |
| 加油包购买成功事件与额度查询并发 | 本系统不感知加油包扣减（R6），无并发写冲突 |

---

## 9. 事件 Outbox

### 9.1 quota_outbox 表

```sql
CREATE TABLE quota_outbox (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    event_type      VARCHAR(48) NOT NULL COMMENT '事件类型',
    event_id        VARCHAR(64) NOT NULL COMMENT '事件唯一ID（幂等键）',
    user_id         BIGINT NOT NULL,
    payload         JSON NOT NULL COMMENT '事件载荷',
    status          TINYINT NOT NULL DEFAULT 0 COMMENT '0待投递 1已投递 2失败',
    retry_count     INT NOT NULL DEFAULT 0,
    next_retry_at   DATETIME NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uk_event_id (event_id),
    INDEX idx_status_retry (status, next_retry_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='额度域Outbox';
```

### 9.2 发布事件清单

| 事件 | 触发时机 | 消费方 |
|------|---------|--------|
| quota.warning.triggered | 用量达 grace% 首次越线 | 通知系统（额度预警，频控 1 次/天） |
| quota.exhausted | 额度耗尽首次进入 BLOCKED | 通知系统（引导升级，未成年人转家长提醒 G9）、客户端刷新推送 |
| quota.period.archived | 周期归档完成 | 数据分析（用量统计）、成本治理（单用户成本归集） |
| quota.tier.applied | 等级变更生效（升级即时/降级新周期） | 会员服务（回执确认）、BFF（缓存失效） |

### 9.3 上游订阅

| 事件 | 来源 | 处理 |
|------|------|------|
| membership.changed | 会员服务 | HandleTierChange（§4.4），升级即时生效/降级打 pending_tier 标记 |
| membership.expired | 会员服务 | 按到期时间线处理：到期未续费 → 新周期降级（复用 pending_tier 路径） |
| user.account.deleted | 用户服务 | G7 注销清理（Redis 键删除 + 表匿名化任务） |
| addon.consumed | 增值服务系统 | 不消费（加油包独立计数，R6）；仅订阅 addon.purchased 用于 BFF 聚合缓存失效 |

---

## 10. 错误码

### 10.1 客户端错误码（4xx 语义，与全库已有 42901 共用）

| 错误码 | HTTP | 说明 |
|--------|------|------|
| 42901 | 429 | 额度已耗尽（附 reset_at 与升级引导） |
| 42902 | 429 | 触发用户级限流（附 retry_after_sec） |
| 42903 | 403 | 该功能仅限会员（QUOTA_MEMBER_ONLY） |

### 10.2 内部错误码（50400-50499，全库段位扫描确认空闲，不透传客户端）

| 错误码 | 说明 | 语义 |
|--------|------|------|
| 50400 | QUOTA_REDIS_UNAVAILABLE | Redis 宕机，走 G2 DB 降级 |
| 50401 | QUOTA_LUA_EXEC_FAILED | Lua 执行失败，回退两步操作（降级 D4） |
| 50402 | QUOTA_CONFIG_MISSING | 配置缺失，按最严 free 默认兜底 |
| 50403 | QUOTA_META_INCONSISTENT | meta 与 counter 不一致，触发对账修复 |
| 50404 | QUOTA_PERSIST_SNAPSHOT_FAILED | 归档写库失败，重试队列（不阻塞重置） |
| 50405 | QUOTA_RESET_LOCK_TIMEOUT | 重置任务抢锁超时，本轮跳过（下轮兜底） |
| 50406 | QUOTA_TIER_EVENT_DUPLICATE | 重复等级变更事件，幂等忽略 |
| 50407 | QUOTA_BATCH_OVERFLOW | BatchGetQuotaStatus 超 200 上限 |
| 50408 | QUOTA_MANUAL_RESET_CONFLICT | 手动重置与消耗冲突，稍后重试（200 语义） |

---

## 11. 降级矩阵

| 编号 | 故障场景 | 降级方案 | 红线 |
|------|---------|---------|------|
| D1 | Redis 完全不可用 | DB 计数降级（SELECT ... FOR UPDATE），叠加 G2 分钟级 10 次硬顶 | 降级窗口禁止无限放行 |
| D2 | 配置中心不可用 | 内存默认配置表兜底（Free=5 次/日 AI 问答等），恢复后 30s 内刷新 | 兜底配置只能更严不能更松 |
| D3 | 会员服务不可用 | 按 free 等级处理（宁限勿放），已缓存 tier 30s 内可用 | 禁止按上一次会员等级长期放行 |
| D4 | Lua 脚本执行失败 | 回退 GET+INCRBY 两步操作，accept 短暂超扣；单实例连续 10 次失败熔断走 D1 | 超扣率纳入监控 M6，>0.5% 告警 |
| D5 | 归档写库失败 | 归档进本地重试队列（最多 10 次），Redis 键按 TTL 自然过期不丢最终一致 | 禁止因归档失败阻塞重置主流程 |
| D6 | 通知 Outbox 失败 | 事件本地磁盘队列补投（24h），额度功能不受影响 | — |
| D7 | gRPC 超时（调用方侧） | 调用方按 fail-closed 处理（AI 类）或 fail-open 提示（查询类） | AI/拍题扣费类校验禁止 fail-open |
| D8 | 管理端不可用 | 配置只读不可改，运行态配置继续生效 | — |
| D9 | 周期重置任务僵死 | 惰性重置（§4.3.2）兜底用户侧体验；04:10 看门狗告警 M4 | 禁止双重置（period_key 裁决） |
| D10 | 总红线 | 任何降级不得突破 G1/G2/G7/G9；体验降级（预警/引导缺失）可接受，额度失控不可接受 | — |

---

## 12. 监控与容量

### 12.1 监控指标（M1-M10）

| 编号 | 指标 | 告警阈值 |
|------|------|---------|
| M1 | CheckAndConsume P99 延迟 | > 50ms 持续 5min（P1） |
| M2 | Redis 额度键命中率 | < 99%（P2，可能误走 DB 降级） |
| M3 | 额度拦截率（按功能） | 免费用户 ai_qa 拦截率 > 40% 持续 3 天（P2，可能配额过紧） |
| M4 | 周期重置任务耗时 | > 30min 或未执行（P1，D9 看门狗） |
| M5 | 降级发生率（D1-D4 任一） | > 0.1%（P1） |
| M6 | Lua 回退超扣率 | > 0.5%（P2） |
| M7 | quota_outbox 积压 | > 10 万（P2） |
| M8 | 额度耗尽引导升级转化率 | 日环比跌 > 30%（P3，商业观察） |
| M9 | meta/counter 对账差异率 | > 0.01%（P2，触发 50403 修复） |
| M10 | 单日全功能调用总量 | 超成本预算 85%（P1，联动成本治理熔断策略） |

### 12.2 容量估算（DAU 50 万）

| 项 | 估算 |
|----|------|
| 日 CheckAndConsume 调用 | 峰值 QPS 3000（拍题+AI 问答为主），日均 1200 万次 |
| Redis 内存 | 活跃计数键约 300 万 × 100B ≈ 300MB；meta Hash 约 150 万 × 200B ≈ 300MB；合计 < 1GB |
| MySQL | quota_usage_log 日增 1200 万行，按月分区保留 6 个月在线，归档 ClickHouse（TTL 180 天，user_id 盐化） |
| user_quota_snapshot | 每用户每功能每周期 1 行，DAU50 万 × 12 功能 ≈ 日增 600 万行（仅活跃功能才建快照，实际约 200 万），月分区保留 13 个月 |
| 重置任务 | 日扫描 300 万键，游标分批 1000，约 5min 完成 |

---

## 13. 合规红线（C1-C10）

| 编号 | 红线 |
|------|------|
| C1 | quota_usage_log 中 ip_address 仅存哈希或脱敏，手机号等 PII 绝不落此表 |
| C2 | 管理端消耗日志查询按角色控权，跨用户批量导出需二次审批 |
| C3 | 额度计数数据禁止用于营销定向推送（仅可用于额度预警与升级引导，频控见 §9.2） |
| C4 | 未成年人（<14 岁）额度耗尽仅提示"请家长协助开通"，不展示价格与购买按钮 |
| C5 | 注销用户数据清理按 G7 执行，匿名化后 180 天物理删除 |
| C6 | 额度预警推送遵守通知静默时段（学生 21:00 后不发），频控 1 次/天 |
| C7 | 审计日志（配置调整/手动重置）保留 3 年，不可篡改 |
| C8 | 无限额度会员同样计数（G10），成本异常波动可追踪到单用户 |
| C9 | 加油包售卖页价格与权益展示以增值服务系统为准，本系统禁止本地硬编码价格 |
| C10 | 危机信号让位：任何额度/限流逻辑不得拦截心理危机通道与安全上报接口 |

---

## 14. 契约对齐（R1-R12）

| 编号 | 裁决 |
|------|------|
| R1 | 功能门控（灰度/学段/年龄限制）权威归《服务端-用户额度管控与功能门控引擎》，本系统只做"次数配额"，两层网关串行执行 |
| R2 | 计费账本与资金核扣权威归《服务端-统一计费账单中心》，本系统 quota_usage_log 只做次数审计，不做金额 |
| R3 | AI 流式会话按"一次会话一次扣减"计，流式中断不回滚；多轮追问在同一会话内不重复扣（ai_stream 维度） |
| R4 | 拍照链路 OCR 失败不计 photo_solve：编排服务先扣 photo_ocr，确认识别成功后再扣 photo_solve |
| R5 | 42901 错误码全库共用（会员订阅 E2E/防沉迷等多文档引用），语义与本表一致 |
| R6 | 加油包（addon）余额 SSOT 归增值服务系统，本系统 BFF 只读聚合，不维护加油包计数 |
| R7 | 会员等级枚举与会员服务一致（free/monthly/yearly/exam_prep/vip），新增等级需双端同步 |
| R8 | 降级后额度展示：客户端展示"额度刷新中"而非旧数据（防止用户看到已失效的剩余次数） |
| R9 | 用户注销清理链路消费 user.account.deleted，执行窗口 24h，失败重试 10 次后 P2 告警 |
| R10 | 周期重置时间统一 Asia/Shanghai 自然日，与会员生效周期一致，禁止按 UTC 重置 |
| R11 | 额度配置默认值与《盈利模式与定价策略》中 Freemium 权益表一致，调整需产品侧同步 |
| R12 | 成本侧联动：M10 触发成本熔断策略的决策权归《服务端-教育平台资源使用量监控与成本优化决策引擎》，本系统只上报 |

---

## 15. 验收场景（AC01-AC16）

| 编号 | 场景 | 预期 |
|------|------|------|
| AC01 | 免费用户第 5 次 AI 问答成功 | 第 6 次返回 42901，附 reset_at 与升级引导 |
| AC02 | 会员用户 AI 问答无限制调用 | 无限额度正常放行且计数累加（G10） |
| AC03 | 用量达 80% 首次越线 | 响应头 X-Quota-Warning，触发 quota.warning.triggered（仅 1 次） |
| AC04 | 用量达 limit 后继续请求 | 透支额度内放行（X-Quota-Critical），超透支后 42901 |
| AC05 | Redis 宕机 | 走 DB 降级 + G2 硬顶，M5/M2 告警触发 |
| AC06 | 重复 request_id 扣费重试 | 返回首次结果，不重复扣减 |
| AC07 | 边界并发 10 线程同刻扣最后 1 次 | 1 成功 9 失败（Lua 原子） |
| AC08 | 日切瞬间请求 | period_key 切换正确，旧周期归档新周期从零计 |
| AC09 | 会员升级瞬间 | 新 limit 立即生效，已用计数保留 |
| AC10 | 会员降级 | 当前周期不变，新周期生效新 tier（pending_tier 路径） |
| AC11 | 注销用户 | 24h 内 Redis 键清除，180 天后表物理删除 |
| AC12 | 未成年人额度耗尽 | 无价格无购买按钮，提示家长协助（G9/C4） |
| AC13 | 管理端配置调整未审批 | 拒绝并返回审批工单要求 |
| AC14 | 配置调整后当前周期 | 仍按旧 limit 执行，下周期生效（G6） |
| AC15 | OCR 失败后请求解题 | 不扣 photo_solve（R4） |
| AC16 | 作文批改失败 30s 内回滚 | 额度恢复，日志记 rollback |

---

## 16. 关联文档

- 《服务端-用户额度管控与功能门控引擎-详细设计》（功能门控层，R1 边界）
- 《服务端-统一计费账单中心与实时用量核扣引擎-详细设计》（资金账本，R2 边界）
- 《服务端-统一限流熔断与流量防护体系-详细设计》（Level 1/2 限流底座）
- 《盈利模式与定价策略-详细设计》（配额默认值来源，R11）
- 《端到端流程设计-会员订阅与增值服务购买完整链路-详细设计》（42901 引用源，R5）
- 《服务端-教育平台资源使用量监控与成本优化决策引擎-详细设计》（成本熔断，R12）

---

## 17. 维护记录

### v1.1（2026-10-20）

原文件 707 行截断于 §6.1.2 响应 JSON `"purchase_url": "/api/v1/store/addon/` 处（围栏未闭合），§6.1.2 后半及内部接口/管理端接口/状态机/幂等/事件/错误码/降级/监控/合规/契约/验收全部缺失。本次补齐：

1. §6.1.2 JSON 收尾 + 字段说明表 + 营销文案红线；
2. 新增 §6.1.3 加油包额度查询（R6 只读裁决）；
3. 新增 §6.2 gRPC 三方法 proto 契约 + 调用方集成约定表；
4. 新增 §6.3 管理端六接口（含双人审批 G8 与配置热更新 G6 语义）；
5. 新增 §6.4 幂等限流总表；
6. 新增 §7 额度周期状态机（读时派生不落库）+ 守卫 G1-G10；
7. 新增 §8 幂等并发八场景；
8. 新增 §9 quota_outbox DDL + 四发布事件 + 四上游订阅；
9. 新增 §10 错误码：客户端 42901-42903（42901 全库共用对齐 R5）+ 内部 50400-50499（全库段位扫描确认空闲）；
10. 新增 §11 降级矩阵 D1-D10（D10 总红线）；
11. 新增 §12 监控 M1-M10 + DAU50 万容量估算；
12. 新增 §13 合规 C1-C10（C4 未成年人无购买按钮）；
13. 新增 §14 契约对齐 R1-R12（最关键裁决：与功能门控引擎 R1 分层、与计费中心 R2 分账）；
14. 新增 §15 验收 AC01-AC16；
15. 新增 §16 关联文档；
16. 全文围栏奇数修复（49→偶数 BALANCED），UTF-8 无 BOM 核验通过，零 TODO 占位。