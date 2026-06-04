# 服务端 - AI模型调用多供应商容灾切换与自动降级引擎 详细设计

## 1. 文档概述

### 1.1 文档目的

本文档详细设计 PrimeTop 系统中 AI 模型调用的多供应商容灾切换与自动降级引擎。该引擎是 AI 能力层的高可用基础设施，确保在大模型供应商出现故障、超时、限流或质量下降时，系统能自动切换到备用供应商、降级到更轻量的模型、或进入优雅降级模式，保障学生学习体验的连续性。

### 1.2 设计背景

PrimeTop 的核心功能（AI 辅导、拍照搜题、作文批改、背诵检测等）深度依赖大模型 API。目前系统可能接入多家供应商（如 OpenAI、Anthropic、百度文心、阿里通义、讯飞星火、智谱 GLM 等），每家供应商的稳定性、延迟、限流策略各不相同。单一供应商的故障可能导致大面积功能不可用，直接影响用户体验和付费转化。

### 1.3 设计目标

| 目标 | 指标 |
| --- | --- |
| 单供应商故障时切换延迟 | < 2 秒（用户无感知） |
| 全供应商故障时优雅降级 | < 5 秒内返回降级响应 |
| 熔断器检测到故障的时间 | < 30 秒 |
| 自动恢复探测周期 | 60-300 秒可配置 |
| 降级决策准确率 | > 95%（不误触发） |
| 降级状态数据不丢失 | 所有降级请求可追溯 |

### 1.4 与已有文档的关系

| 已有文档 | 关系 |
| --- | --- |
| 多模型调度与成本治理-详细设计.md | 本文档是其在故障场景下的补充，专注于异常路径的容灾处理 |
| 错误处理与服务降级策略-详细设计.md | 本文档是其在 AI 模型领域的垂直深化 |
| AI输出质量校验与多模型复核引擎-详细设计.md | 复核引擎的输出可触发本引擎的供应商质量降级 |
| SSE流式响应与AI增量渲染引擎-详细设计.md | 流式场景下的降级需与 SSE 引擎协同 |

---

## 2. 系统架构

### 2.1 整体架构

```
                         ┌──────────────────────────────┐
                         │    AI 辅导请求入口             │
                         │  (用户问题 + 场景 + 上下文)     │
                         └──────────┬───────────────────┘
                                    │
                         ┌──────────▼───────────────────┐
                         │   请求预处理 & 场景识别         │
                         │   (意图分类 + 参数标准化)       │
                         └──────────┬───────────────────┘
                                    │
                    ┌───────────────▼───────────────────┐
                    │     容灾降级决策引擎 (核心)         │
                    │                                    │
                    │  ┌─────────────────────────────┐   │
                    │  │  供应商健康状态管理器          │   │
                    │  │  (Circuit Breaker + Metrics)  │   │
                    │  └────────────┬────────────────┘   │
                    │               │                    │
                    │  ┌────────────▼────────────────┐   │
                    │  │  降级策略评估器               │   │
                    │  │  (规则 + 评分 + 优先级)       │   │
                    │  └────────────┬────────────────┘   │
                    │               │                    │
                    │  ┌────────────▼────────────────┐   │
                    │  │  供应商选择 & 路由器          │   │
                    │  │  (降级上下文感知路由)         │   │
                    │  └─────────────────────────────┘   │
                    └───────────────┬───────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
    ┌─────────▼──────┐   ┌─────────▼──────┐   ┌─────────▼──────┐
    │  供应商 A 适配器 │   │  供应商 B 适配器 │   │  供应商 C 适配器 │
    │  (Primary)      │   │  (Secondary)    │   │  (Tertiary)    │
    └─────────┬──────┘   └─────────┬──────┘   └─────────┬──────┘
              │                     │                     │
              └─────────────────────┼─────────────────────┘
                                    │
                         ┌──────────▼───────────────────┐
                         │   响应后处理 & 降级记录        │
                         │   (质量追踪 + 事件发布)        │
                         └──────────────────────────────┘
```

### 2.2 核心组件清单

| 组件 | 职责 | 关键接口 |
| --- | --- | --- |
| FailoverEngine | 容灾降级决策引擎主入口 | `executeWithFailover()` |
| ProviderHealthManager | 供应商健康状态管理 | `reportResult()`, `getState()` |
| CircuitBreaker | 熔断器（每供应商每场景） | `allowRequest()`, `recordSuccess()`, `recordFailure()` |
| DegradationStrategyEvaluator | 降级策略评估 | `evaluate()`, `selectFallback()` |
| ProviderRouter | 供应商选择路由 | `route()`, `getNextProvider()` |
| ProviderAdapter | 供应商 API 适配器 | `call()`, `callStreaming()` |
| FallbackResponseBuilder | 降级响应构建器 | `buildCacheResponse()`, `buildOfflineResponse()` |
| FailoverEventPublisher | 降级事件发布 | `publish()`, `subscribe()` |
| HealthProbeScheduler | 健康探测调度器 | `scheduleProbe()`, `cancelProbe()` |

---

## 3. 数据结构定义

### 3.1 供应商健康状态

```typescript
/**
 * 单个供应商的健康状态
 * 按 (providerId, sceneType) 维度维护
 */
interface ProviderHealthState {
  /** 供应商唯一标识 */
  providerId: string;                    // e.g., "openai", "anthropic", "zhipu"
  /** 场景类型 */
  sceneType: AiSceneType;                // e.g., "tutoring", "math_solving", "essay_grading"

  // ---- 熔断器状态 ----
  /** 当前熔断器状态 */
  circuitState: CircuitState;            // CLOSED | OPEN | HALF_OPEN
  /** 连续失败次数 */
  consecutiveFailures: number;
  /** 连续成功次数（HALF_OPEN 状态下使用） */
  consecutiveSuccesses: number;
  /** 熔断器打开时间戳 (ms) */
  circuitOpenedAt: number | null;
  /** 下次允许探测时间 (ms) */
  nextProbeAllowedAt: number | null;

  // ---- 滑动窗口统计 ----
  /** 滑动窗口内的调用记录（最近 N 秒） */
  slidingWindow: SlidingWindowBucket[];

  // ---- 质量指标 ----
  /** 最近 1 分钟平均延迟 (ms) */
  avgLatencyMs1m: number;
  /** 最近 5 分钟平均延迟 (ms) */
  avgLatencyMs5m: number;
  /** 最近 1 分钟错误率 (0-1) */
  errorRate1m: number;
  /** 最近 5 分钟错误率 (0-1) */
  errorRate5m: number;
  /** 最近 1 分钟超时率 (0-1) */
  timeoutRate1m: number;
  /** 最近 1 分钟 P99 延迟 (ms) */
  p99LatencyMs1m: number;

  // ---- 限流指标 ----
  /** 当前 RPM（每分钟请求数） */
  currentRpm: number;
  /** 供应商声明的 RPM 上限 */
  rpmLimit: number;
  /** 当前 TPM（每分钟 Token 数） */
  currentTpm: number;
  /** 供应商声明的 TPM 上限 */
  tpmLimit: number;
  /** 最近一次 429 响应时间 */
  lastRateLimitedAt: number | null;

  // ---- 质量降级指标 ----
  /** 最近 1 小时平均质量评分 (0-100) */
  avgQualityScore1h: number;
  /** 最近 1 小时幻觉率 (0-1) */
  hallucinationRate1h: number;
  /** 最近 1 小时用户负面反馈率 (0-1) */
  negativeFeedbackRate1h: number;

  // ---- 元数据 ----
  /** 最后一次状态更新时间 */
  lastUpdatedAt: number;
  /** 手动禁用标记 */
  manuallyDisabled: boolean;
  /** 禁用原因 */
  disableReason: string | null;
}

enum CircuitState {
  /** 正常状态 - 允许所有请求通过 */
  CLOSED = 'CLOSED',
  /** 熔断状态 - 拒绝请求，直接降级 */
  OPEN = 'OPEN',
  /** 半开状态 - 允许少量探测请求 */
  HALF_OPEN = 'HALF_OPEN'
}

/** 滑动窗口桶 */
interface SlidingWindowBucket {
  /** 时间窗口起始 (ms) */
  windowStart: number;
  /** 总请求数 */
  totalRequests: number;
  /** 成功请求数 */
  successCount: number;
  /** 失败请求数 */
  failureCount: number;
  /** 超时请求数 */
  timeoutCount: number;
  /** 429 限流次数 */
  rateLimitedCount: number;
  /** 总延迟 (ms)，用于计算平均 */
  totalLatencyMs: number;
  /** 延迟分布 (P50, P90, P99) */
  latencyHistogram: number[];
}
```

### 3.2 降级策略配置

```typescript
/**
 * 降级策略配置
 * 按 (sceneType) 维度配置，每个场景有独立的降级链
 */
interface DegradationPolicy {
  /** 场景类型 */
  sceneType: AiSceneType;
  /** 策略版本号 */
  version: number;
  /** 是否启用 */
  enabled: boolean;

  /** 供应商优先级链（有序列表，索引 0 为最高优先级） */
  providerChain: ProviderChainEntry[];

  /** 熔断器配置 */
  circuitBreakerConfig: CircuitBreakerConfig;

  /** 降级阈值配置 */
  degradationThresholds: DegradationThresholds;

  /** 最终兜底策略（所有供应商不可用时的响应策略） */
  ultimateFallback: UltimateFallbackConfig;

  /** 全局降级开关（人工紧急降级） */
  globalDegradationOverride: GlobalDegradationOverride | null;
}

/** 供应商优先级链条目 */
interface ProviderChainEntry {
  /** 供应商 ID */
  providerId: string;
  /** 该供应商的模型列表（按优先级） */
  models: ModelEntry[];
  /** 该供应商的最大并发降级数（限制同时切换的流量比例） */
  maxConcurrentDegradationPercent: number;   // 0-100
  /** 该供应商在该场景下的降级条件（覆盖全局） */
  customDegradationTriggers?: DegradationTrigger[];
}

interface ModelEntry {
  /** 模型标识 */
  modelId: string;
  /** 是否为主要模型（优先使用） */
  isPrimary: boolean;
  /** 最大 Token 数 */
  maxTokens: number;
  /** 预估延迟 (ms) */
  estimatedLatencyMs: number;
  /** 预估质量评分 (0-100) */
  estimatedQualityScore: number;
  /** 成本权重 (用于成本感知降级) */
  costWeight: number;
}

/** 熔断器配置 */
interface CircuitBreakerConfig {
  /** 触发熔断的连续失败次数 */
  failureThreshold: number;                  // 默认: 5
  /** 触发熔断的错误率阈值 (0-1) */
  errorRateThreshold: number;                // 默认: 0.5
  /** 熔断器错误率计算的窗口大小 (秒) */
  errorRateWindowSeconds: number;            // 默认: 60
  /** 熔断器保持 OPEN 状态的时长 (秒) */
  openDurationSeconds: number;               // 默认: 60
  /** HALF_OPEN 状态下允许通过的探测请求数 */
  halfOpenMaxProbeRequests: number;          // 默认: 3
  /** HALF_OPEN 状态下判定恢复的连续成功次数 */
  halfOpenRecoveryThreshold: number;         // 默认: 3
  /** 触发熔断的超时率阈值 (0-1) */
  timeoutRateThreshold: number;              // 默认: 0.3
  /** 触发熔断的延迟阈值 (ms) */
  latencyThresholdMs: number;                // 默认: 30000
}

/** 降级阈值 */
interface DegradationThresholds {
  /** 错误率阈值 - 超过此值触发主动降级 */
  errorRateDegradation: number;              // 默认: 0.3
  /** 超时率阈值 */
  timeoutRateDegradation: number;            // 默认: 0.2
  /** P99 延迟阈值 (ms) */
  p99LatencyDegradationMs: number;           // 默认: 15000
  /** 质量评分下降阈值 - 低于此值触发质量降级 */
  qualityScoreDegradation: number;           // 默认: 60
  /** 幻觉率上升阈值 */
  hallucinationRateDegradation: number;      // 默认: 0.1
  /** 限流占比阈值 - 429 占总请求比例 */
  rateLimitDegradation: number;              // 默认: 0.2
}

/** 最终兜底配置 */
interface UltimateFallbackConfig {
  /** 兜底策略类型 */
  type: UltimateFallbackType;
  /** 缓存匹配的相似度阈值 */
  cacheSimilarityThreshold: number;          // 默认: 0.85
  /** 最大等待重试时间 (ms) */
  maxRetryWaitMs: number;                    // 默认: 10000
  /** 降级提示消息模板 */
  degradedMessageTemplate: string;
  /** 是否允许排队等待 */
  allowQueueing: boolean;                    // 默认: false
}

enum UltimateFallbackType {
  /** 返回缓存中最相似的历史回答 */
  CACHE_FALLBACK = 'CACHE_FALLBACK',
  /** 返回预制的场景化降级响应 */
  PREBUILT_RESPONSE = 'PREBUILT_RESPONSE',
  /** 排队等待供应商恢复 */
  QUEUE_AND_RETRY = 'QUEUE_AND_RETRY',
  /** 直接返回服务降级提示 */
  SERVICE_DEGRADED_NOTICE = 'SERVICE_DEGRADED_NOTICE'
}

/** 全局降级覆盖（人工触发） */
interface GlobalDegradationOverride {
  /** 是否激活 */
  activated: boolean;
  /** 操作人 */
  operator: string;
  /** 降级级别 */
  level: GlobalDegradationLevel;
  /** 原因 */
  reason: string;
  /** 生效时间 */
  activatedAt: number;
  /** 预计恢复时间（null 表示未知） */
  estimatedRecoveryAt: number | null;
}

enum GlobalDegradationLevel {
  /** 仅降级非核心场景（背诵检测、类题推荐等） */
  NON_CRITICAL_ONLY = 'NON_CRITICAL_ONLY',
  /** 降级到最低可用模型 */
  MINIMAL_MODEL = 'MINIMAL_MODEL',
  /** 仅保留缓存响应 */
  CACHE_ONLY = 'CACHE_ONLY',
  /** 完全停止 AI 服务 */
  FULL_STOP = 'FULL_STOP'
}
```

### 3.3 降级事件与日志

```typescript
/** 降级事件 */
interface FailoverEvent {
  /** 事件唯一 ID */
  eventId: string;
  /** 事件时间戳 */
  timestamp: number;
  /** 事件类型 */
  eventType: FailoverEventType;
  /** 关联的原始请求 ID */
  requestId: string;
  /** 用户 ID */
  userId: string;
  /** 场景类型 */
  sceneType: AiSceneType;
  /** 原始供应商 */
  fromProviderId: string | null;
  /** 原始模型 */
  fromModelId: string | null;
  /** 降级到供应商 */
  toProviderId: string | null;
  /** 降级到模型 */
  toModelId: string | null;
  /** 降级原因 */
  reason: FailoverReason;
  /** 降级原因详情 */
  reasonDetail: string;
  /** 降级耗时 (ms) */
  failoverLatencyMs: number;
  /** 降级后响应质量预估 (0-100) */
  estimatedQuality: number;
  /** 熔断器状态快照 */
  circuitBreakerSnapshot: {
    state: CircuitState;
    consecutiveFailures: number;
    errorRate: number;
    avgLatencyMs: number;
  };
}

enum FailoverEventType {
  /** 供应商间切换 */
  PROVIDER_SWITCH = 'PROVIDER_SWITCH',
  /** 模型降级（同供应商内） */
  MODEL_DEGRADATION = 'MODEL_DEGRADATION',
  /** 熔断器打开 */
  CIRCUIT_OPENED = 'CIRCUIT_OPENED',
  /** 熔断器恢复 */
  CIRCUIT_CLOSED = 'CIRCUIT_CLOSED',
  /** 进入最终兜底模式 */
  ULTIMATE_FALLBACK = 'ULTIMATE_FALLBACK',
  /** 全局降级触发 */
  GLOBAL_DEGRADATION = 'GLOBAL_DEGRADATION',
  /** 全局降级解除 */
  GLOBAL_DEGRADATION_LIFTED = 'GLOBAL_DEGRADATION_LIFTED'
}

enum FailoverReason {
  /** 连续失败 */
  CONSECUTIVE_FAILURES = 'CONSECUTIVE_FAILURES',
  /** 错误率过高 */
  HIGH_ERROR_RATE = 'HIGH_ERROR_RATE',
  /** 超时率过高 */
  HIGH_TIMEOUT_RATE = 'HIGH_TIMEOUT_RATE',
  /** 延迟过高 */
  HIGH_LATENCY = 'HIGH_LATENCY',
  /** 供应商限流 (429) */
  PROVIDER_RATE_LIMITED = 'PROVIDER_RATE_LIMITED',
  /** 供应商返回 5xx */
  PROVIDER_SERVER_ERROR = 'PROVIDER_SERVER_ERROR',
  /** 供应商返回认证失败 */
  PROVIDER_AUTH_ERROR = 'PROVIDER_AUTH_ERROR',
  /** 质量评分下降 */
  QUALITY_DEGRADATION = 'QUALITY_DEGRADATION',
  /** 幻觉率上升 */
  HIGH_HALLUCINATION_RATE = 'HIGH_HALLUCINATION_RATE',
  /** 手动触发 */
  MANUAL_TRIGGER = 'MANUAL_TRIGGER',
  /** 全局降级策略 */
  GLOBAL_POLICY = 'GLOBAL_POLICY'
}

/** 降级执行结果 */
interface FailoverResult {
  /** 是否成功获得响应 */
  success: boolean;
  /** 最终使用的供应商 */
  finalProviderId: string;
  /** 最终使用的模型 */
  finalModelId: string;
  /** 是否发生了降级 */
  degraded: boolean;
  /** 降级链路（可能经过多次切换） */
  failoverChain: FailoverHop[];
  /** 总耗时 (ms) */
  totalLatencyMs: number;
  /** AI 响应内容 */
  response: AiResponse | null;
  /** 降级/兜底响应 */
  fallbackResponse: FallbackResponse | null;
  /** 所有降级事件 ID */
  eventIds: string[];
}

interface FailoverHop {
  hopIndex: number;
  providerId: string;
  modelId: string;
  result: 'SUCCESS' | 'FAILURE' | 'TIMEOUT' | 'RATE_LIMITED' | 'SKIPPED';
  latencyMs: number;
  errorCode?: string;
  errorMessage?: string;
}

/** 兜底响应 */
interface FallbackResponse {
  type: UltimateFallbackType;
  /** 缓存来源（如有） */
  cacheSourceId?: string;
  /** 相似度（如有） */
  cacheSimilarity?: number;
  /** 展示给用户的消息 */
  displayMessage: string;
  /** 是否需要标记为降级内容 */
  isDegraded: boolean;
}
```

---

## 4. API 接口设计

### 4.1 核心调用接口

```java
/**
 * AI 模型调用容灾执行器
 * 所有 AI 模型调用必须通过此接口，自动处理容灾和降级
 */
public interface FailoverExecutor {

    /**
     * 带容灾的 AI 调用（同步，非流式）
     *
     * @param request  AI 请求（包含场景、提示词、参数等）
     * @return 容灾执行结果（包含最终响应和降级链路信息）
     */
    FailoverResult executeWithFailover(AiRequest request);

    /**
     * 带容灾的 AI 调用（SSE 流式）
     * 流式场景下，降级逻辑在首个 token 之前决策
     * 如果首个供应商在 TTFB 超时前未返回，自动切换
     *
     * @param request  AI 请求
     * @param streamConsumer 流式内容消费者
     * @return 容灾执行结果
     */
    FailoverResult executeStreamingWithFailover(
        AiRequest request,
        StreamConsumer streamConsumer
    );
}
```

### 4.2 管理接口

```java
/**
 * 容灾引擎管理接口
 * 供运维/管理后台使用
 */
public interface FailoverManagement {

    /**
     * 查询所有供应商当前健康状态
     * GET /api/v1/admin/failover/health-status
     */
    List<ProviderHealthStatusVO> getProviderHealthStatus(
        @RequestParam(required = false) AiSceneType sceneType
    );

    /**
     * 查询指定供应商的详细健康指标
     * GET /api/v1/admin/failover/health-status/{providerId}
     */
    ProviderHealthDetailVO getProviderHealthDetail(
        @PathVariable String providerId,
        @RequestParam(required = false) AiSceneType sceneType
    );

    /**
     * 手动启用/禁用供应商
     * POST /api/v1/admin/failover/providers/{providerId}/toggle
     */
    void toggleProvider(
        @PathVariable String providerId,
        @RequestBody ProviderToggleRequest request   // { enabled, reason }
    );

    /**
     * 手动触发全局降级
     * POST /api/v1/admin/failover/global-degradation
     */
    void activateGlobalDegradation(
        @RequestBody GlobalDegradationRequest request
    );

    /**
     * 解除全局降级
     * POST /api/v1/admin/failover/global-degradation/lift
     */
    void liftGlobalDegradation(@RequestBody String reason);

    /**
     * 查询降级事件历史
     * GET /api/v1/admin/failover/events
     */
    PageResult<FailoverEventVO> getFailoverEvents(
        @RequestParam(required = false) AiSceneType sceneType,
        @RequestParam(required = false) String providerId,
        @RequestParam(required = false) FailoverEventType eventType,
        @RequestParam(required = false) Long startTime,
        @RequestParam(required = false) Long endTime,
        @RequestParam(defaultValue = "1") int page,
        @RequestParam(defaultValue = "20") int pageSize
    );

    /**
     * 查询降级统计摘要
     * GET /api/v1/admin/failover/statistics
     */
    FailoverStatisticsVO getFailoverStatistics(
        @RequestParam(required = false) AiSceneType sceneType,
        @RequestParam(required = false) Long startTime,
        @RequestParam(required = false) Long endTime
    );

    /**
     * 更新降级策略配置
     * PUT /api/v1/admin/failover/policies/{sceneType}
     */
    void updateDegradationPolicy(
        @PathVariable AiSceneType sceneType,
        @RequestBody DegradationPolicy policy
    );

    /**
     * 手动重置供应商熔断器
     * POST /api/v1/admin/failover/providers/{providerId}/circuit-breaker/reset
     */
    void resetCircuitBreaker(
        @PathVariable String providerId,
        @RequestParam(required = false) AiSceneType sceneType
    );
}
```

### 4.3 内部事件接口

```java
/**
 * 容灾事件发布/订阅
 * 用于通知其他服务降级状态变化
 */
public interface FailoverEventPublisher {

    /**
     * 发布降级事件
     * 事件通过内部消息总线（Redis Pub/Sub 或 Kafka）广播
     */
    void publish(FailoverEvent event);

    /**
     * 订阅降级事件
     * 监控告警服务、日志服务、运营看板等可订阅
     */
    void subscribe(FailoverEventHandler handler);
}

// 事件 topic: "failover:events"
// 多实例部署时通过 Redis/Kafka 广播，确保所有节点状态一致
```

---

## 5. 核心流程设计

### 5.1 主调用流程（executeWithFailover）

```
输入: AiRequest (场景 + Prompt + 参数)
输出: FailoverResult

1.  请求预处理
    ├── 检查全局降级覆盖
    │   ├── FULL_STOP → 直接返回 SERVICE_DEGRADED_NOTICE
    │   ├── CACHE_ONLY → 直接返回缓存兜底
    │   ├── MINIMAL_MODEL → 强制使用最低优先级模型
    │   └── NON_CRITICAL_ONLY → 检查场景优先级
    └── 标准化请求参数

2.  获取降级策略配置
    └── 按 sceneType 加载 DegradationPolicy

3.  供应商路由循环 (最多 N 次, N = providerChain.length + 1)
    │
    ├── 3.1 选择当前最优供应商+模型
    │   ├── 遍历 providerChain
    │   ├── 检查每个供应商的 circuitState
    │   │   ├── CLOSED → 可用
    │   │   ├── OPEN → 跳过，记录事件
    │   │   └── HALF_OPEN → 允许探测（受限并发）
    │   ├── 检查手动禁用状态
    │   ├── 检查限流状态 (429 冷却期)
    │   └── 选出第一个可用的 (providerId, modelId)
    │
    ├── 3.2 若无可