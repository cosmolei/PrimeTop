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
-- ARGV[4] = current timestamp (for TTL check)
-- Returns: {allowed, remaining, warning_level}
--   allowed: 1=yes, 0=no
--   remaining: remaining count (-1=unlimited)
--   warning_level: 0=normal, 1=warning, 2=critical, 3=exceeded

local counter_key = KEYS[1]
local overdraft_key = KEYS[2]
local limit = tonumber(ARGV[1])
local overdraft_limit = tonumber(ARGV[2])
local amount = tonumber(ARGV[3])

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
    local grace_threshold = math.floor(limit * 0.8)
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
    
    storedPeriod, _ = s.redis.HGet(ctx, metaKey, "period_key").Result()
    
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
        for _, feat := range AllFeatureTypes() {
            s.redis.Set(ctx, 
                fmt.Sprintf("pending_tier:%d:%s", userID, feat),
                string(newTier),
                0) // 无TTL，重置时消费
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
                "purchase_url": "/api/v1/store/addon/