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
    ├── 3.2 若无可用供应商 → 跳转步骤 6（最终兜底流程，见 §5.2）
    │
    ├── 3.3 执行供应商调用（带超时预算）
    │   ├── 计算本次 hop 超时预算 = min(策略 perHopTimeoutMs, 请求剩余总预算)
    │   ├── 同供应商内重试 ≤ retry_max（默认 2，来自调度层供应商配置）
    │   │   └── 仅对幂等可重试错误重试（网络抖动/偶发 5xx），429 不重试直接切换
    │   ├── 通过 ProviderAdapter.call() / callStreaming() 发起真实调用
    │   │   └── 适配层实现归《大模型推理统一适配层》，本引擎只依赖其接口
    │   └── 流式场景启动 TTFB 看门狗（见 §5.3）
    │
    ├── 3.4 降级并发闸门检查
    │   └── 切换前检查目标供应商当前承接的降级流量占比
    │       ├── 已达 maxConcurrentDegradationPercent → 跳过该供应商继续链下一家
    │       └── 目的：防止故障流量雪崩式转移到备用供应商将其也压垮
    │
    ├── 3.5 结果处理与失败分类
    │   ├── 成功 → ProviderHealthManager.reportSuccess() → 跳转步骤 4
    │   ├── 可切换类失败（超时/网络/5xx/429）→ reportFailure() →
    │   │        记录 FailoverHop(result=FAILURE/TIMEOUT/RATE_LIMITED) → 回到 3.1
    │   ├── 供应商级致命失败（认证失败 401/403）→
    │   │        reportAuthFailure()：该供应商全场景熔断 + P1 告警（见 §5.4 错误分类表）
    │   │        本请求继续切换下一供应商
    │   ├── 内容策略类失败（400/413/422，多为 Prompt 兼容性）→
    │   │        不计熔断失败，同供应商换模型重试一次，仍失败则切换
    │   └── 用户主动取消 → 终止循环，不计任何供应商失败（G10 例外）
    │
    ├── 3.6 循环上界守卫
    │   └── 总 hop 数 ≤ providerChain.length × 2（含同供应商换模型重试），
    │        超出仍无成功 → 跳转步骤 6（防止无限循环，守卫 G2）
    │
    4.  响应后处理
    ├── 计量上报：仅对最终成功 hop 计量（Token 计量服务，request_id 幂等，G11）
    ├── 质量追踪：将响应交给质量指标聚合（异步，不阻塞响应）
    └── 若发生过切换：FailoverEventPublisher 发布 PROVIDER_SWITCH 事件
         （逐请求切换事件仅入 ClickHouse 日志与指标，不走 Outbox——量级裁决见 §9.2）
    │
    5.  返回 FailoverResult
    └── 组装 failoverChain / degraded 标记 / eventIds，返回调用方

6.  最终兜底流程（ULTIMATE_FALLBACK，由步骤 3.2 / 3.6 触发）
    ├── 6.1 按场景查 UltimateFallbackConfig.type 依序尝试：
    │   ├── CACHE_FALLBACK → 委托《AI输出缓存与智能复用引擎》语义检索
    │   │     ├── 相似度阈值 = max(本策略 cacheSimilarityThreshold, 缓存引擎场景阈值)（G12，更严格者胜）
    │   │     ├── 题目类场景（拍题/解题）阈值实际生效 0.98，讲解类 0.85
    │   │     ├── 命中 → 返回缓存内容 + isDegraded=true + AIGC 标识保留（合规 C2）
    │   │     ├── 命中内容仍需过 SOSF L1 本地快检（词库更新防漏网，R3）
    │   │     └── 未命中或低于阈值 → 依序降级到下一兜底类型
    │   ├── PREBUILT_RESPONSE → 返回场景化预制降级响应（分龄文案，见 §5.9）
    │   ├── QUEUE_AND_RETRY → 仅异步可等待场景（作业批改/报告生成），
    │   │     同步辅导场景禁用（R5）；委托《大模型推理请求队列调度引擎》投递，
    │   │     客户端收排队凭证经 UTPC 进度中心查询
    │   └── SERVICE_DEGRADED_NOTICE → 直接返回降级提示 + 建议重试时间
    ├── 6.2 记录 ULTIMATE_FALLBACK 事件（Outbox，场景级聚合见 §9.2）
    └── 6.3 若场景连续 5 分钟兜底率 > 30% → 触发场景级兜底模式进入事件
          （scene.ultimate_fallback.entered，通知监控与管理后台驾驶舱）

7.  全链路预算控制
    ├── 请求级总预算：tutoring 同步场景默认 30s；考试解题 45s；异步批改 120s
    ├── 每消耗一次 hop 扣减预算，预算耗尽立即走最终兜底（不再尝试新供应商）
    └── 预算值随 DegradationPolicy 按 sceneType 配置，热生效（G14）
```

### 5.2 最终兜底决策矩阵

| 场景类型 | 兜底链（依序） | 说明 |
| --- | --- | --- |
| tutoring（AI 辅导对话） | CACHE → PREBUILT → NOTICE | 同步强交互，禁排队 |
| math_solving（理科解题） | CACHE(0.98) → PREBUILT | 宁可提示重试，不返回低相似度错解 |
| essay_grading（作文批改） | QUEUE(异步) → NOTICE | 可等待，走队列延迟处理 |
| photo_search（拍题答疑） | CACHE(0.98) → PREBUILT | 同 math_solving |
| recitation_check（背诵检测） | PREBUILT → NOTICE | 无缓存语义，直接预制 |
| report_generation（报告生成） | QUEUE → NOTICE | 后台任务，排队最优 |
| exam_sprint（考试冲刺讲解） | CACHE(0.90) → QUEUE → PREBUILT | 高价值场景给三级兜底 |

> 预制响应（PREBUILT_RESPONSE）内容为运营预置并审核过的分龄文案，文案变更走《管理后台-AI模型与Prompt模板配置工作台》审核流，本引擎只读引用。

### 5.3 流式调用容灾流程（executeStreamingWithFailover）

```text
输入: AiRequest + StreamConsumer
输出: FailoverResult（含流式语义）

1.  首 Token 决策窗（TTFB Watchdog）
    ├── 每个供应商 hop 启动时创建 TTFB 看门狗
    │   预算: 默认 5s；exam_sprint 8s；essay_grading 10s（按场景配置）
    ├── 预算内收到首 token → 看门狗取消，进入正常流式转发
    └── 预算耗尽仍未首 token → cancel 上游订阅（防止 token 空转计费，
          对齐 SOSF G13 同类红线）→ reportFailure(TIMEOUT, 权重 1.0) → 切换下一供应商
          ※ 首 token 前切换对用户完全无感（客户端仅有 typing 指示）

2.  首 Token 后中断处理（Mid-Stream Abort Policy，按场景分流）
    ├── 已产出 token 数 = 0（边界竞态）→ 按首 token 前策略切换，无损
    ├── tutoring → 完整重答策略：新供应商重新生成完整回答，
    │     客户端收到 regen_start 事件清空已渲染内容重来（SSE 引擎降级链 L2 联动），
    │     提示文案「正在换一种方式回答…」（对齐 SSE 文档 MODEL_ERROR 文案）
    ├── exam_sprint / math_solving → 差量续写策略：将已产出内容作为上下文
    │     请求新供应商「继续输出后续内容」，拼接完整性由 ARPP §3.6 格式规范化兜底；
    │     续写失败一次后降级为完整重答
    ├── 其他场景 → 交由 SSE 引擎自身降级链处理（degradation_level 0-3，R4）
    └── 中断事件 reportFailure 权重 1.5×（比 TTFB 超时更严重的信号，G10）

3.  流式结果语义（FailoverResult 补充契约，修复 v1.0 F4）
    ├── streaming.completed = true/false
    ├── streaming.emittedTokens：已投递给客户端的 token 数
    ├── streaming.regenerated：是否发生过完整重答
    └── streaming.resumeMode：NONE / REGEN / DELTA_CONTINUE（交 SSE 引擎渲染层消费）
```

### 5.4 熔断器错误分类与状态转移

#### 5.4.1 错误分类表

| 错误类别 | 判定特征 | 计入熔断 | 失败权重 | 处置动作 |
| --- | --- | --- | --- | --- |
| 超时/网络中断 | TimeoutException / ConnectException / Reset | 是 | 1.0 | 切换下一供应商 |
| 供应商 5xx | HTTP 500/502/503/504 | 是 | 1.0 | 切换 |
| 供应商限流 | HTTP 429 / quota exceeded | 是（减半） | 0.5 | 切换 + 进入 429 冷却期（30s，冷却期跳过不计熔断，G9） |
| 认证/授权失败 | 401/403/invalid_api_key | 是（供应商级全场景） | — | 全场景熔断 + P1 告警 + 不自动恢复（G5），人工 reset 或密钥轮换后探测 |
| 内容策略拒绝 | 400/413/422 | 否 | 0 | 同供应商换模型重试 1 次，仍败切换 |
| 用户主动取消 | 客户端 disconnect | 否 | 0 | 直接终止，不计失败 |
| 流式中途中断 | 首 token 后连接断开 | 是 | 1.5 | 按场景中断策略处理（§5.3-2） |
| 质量信号 | VQ 复核引擎质量事件 | 否（走质量通道） | — | §5.7 质量降级，独立状态空间（G13） |

> 失败权重作用于滑动窗口错误率加权：weightedErrorRate = Σ(weight×failures)/Σ(weight×total)，429 与中途中断按权重折算，避免单一信号类型主导熔断决策。

#### 5.4.2 状态转移规则

```text
CLOSED → OPEN    触发条件（任一，按场景敏感度参数）：
                  ① consecutiveFailures ≥ failureThreshold（默认 5，exam_* 场景 3）
                  ② 窗口错误率 ≥ errorRateThreshold（0.5，样本 ≥ 20 才生效防小样本误判）
                  ③ 超时率 ≥ timeoutRateThreshold（0.3）
                  转移动作：记录 circuitOpenedAt、发布 provider.circuit.opened（Outbox）、
                  该场景流量立即按 §5.1 步骤 3.1 跳过此供应商

OPEN → HALF_OPEN 触发条件：now ≥ circuitOpenedAt + openDurationSeconds × 2^backoffLevel
                  openDurationSeconds 默认 60s；backoffLevel 0,1,2,3…上限 600s（修复 v1.0 F8）
                  即连续恢复失败时退避 60→120→240→480→600（封顶）
                  转移动作：发布 provider.circuit.half_opened、放行探测流量

HALF_OPEN → CLOSED 条件：探测请求连续成功 ≥ halfOpenRecoveryThreshold（默认 3）
                  转移动作：backoffLevel 归零、发布 provider.circuit.closed、恢复路由权重

HALF_OPEN → OPEN  条件：任一探测请求失败
                  转移动作：立即回 OPEN、backoffLevel+1、发布 provider.circuit.opened

场景敏感度差异：exam_sprint / math_solving 等高价值场景独立熔断维度
（providerId × sceneType），同一供应商可在辅导场景 CLOSED 而考试场景 OPEN。
低敏场景（recitation_check）阈值放宽至 failureThreshold=8，减少熔断抖动。
```

#### 5.4.3 三层熔断体系边界（关键裁决）

| 层 | 归属文档 | 维度 | 冷却时长 | 职责 |
| --- | --- | --- | --- | --- |
| L1 模型级 | 多模型调度与成本治理 | model_code | 30s | 单模型异常快速隔离 |
| L2 通道级 | 大模型推理统一适配层 | channel | 60s（ChannelHealthManager） | 单接入通道（含代理/网关）异常隔离 |
| L3 供应商×场景级 | 本引擎 | providerId × sceneType | 60s×退避 | 供应商在某场景的可用性权威裁决 |

> L1/L2 状态作为本引擎输入信号聚合进 ProviderHealthState；本引擎 L3 状态为对外权威（监控看板/管理后台展示以 L3 为准）。三层互不自动互写，只读订阅（R1/R2）。

### 5.5 健康探测与恢复

```text
探测模式（优先级递减）：
1. 被动探测（首选）：HALF_OPEN 后放行真实流量作为探测
   └── halfOpenMaxProbeRequests=3 个令牌，真实请求持令牌进入，
       成功/失败均计入恢复判定（真实流量是最可靠的探针）
2. 主动探测（兜底）：供应商 HALF_OPEN 但该场景无流量（如夜间低峰）
   └── HealthProbeScheduler 每 60-300s（可配）发送轻量真实推理：
       prompt="1+1="，max_tokens=4，日预算每供应商 ¥1 封顶
   └── 探测请求不使用真实用户数据（合规 C9），固定 prompt
3. 探测单飞（G4）：SETNX FO:probe:{provider} TTL 30s，
   多节点同一供应商同时仅 1 个主动探测，避免探测风暴

恢复判定：
├── 被动探测 3 连成功 或 主动探测 3 连成功 → CLOSED
├── 认证失败型 OPEN：探测也 401 → 不再退避重试探测，
│   每日仅探测 4 次，等待人工介入（G5）
└── 探测请求结果同样上报计量（billable=false，成本归集供应商核算）
```

### 5.6 降级策略评估器

```text
评分公式（用于 CLOSED 状态供应商的优先级重排，而非仅按链序）：

  healthScore = 1 - (0.35×errorRate5m + 0.25×timeoutRate1m
                     + 0.25×min(p99LatencyMs1m/p99LatencyDegradationMs, 1.0)
                     + 0.15×rateLimitPressure)
  rateLimitPressure = max(currentRpm/rpmLimit, currentTpm/tpmLimit)

  rankScore = chainBasePriority(链序倒序) × healthScore × costPenalty
  costPenalty = 1 / (1 + 0.1×costWeight)   [仅预算紧张场景启用，
                                              日预算消耗 >80% 时 costPenalty 生效]

规则：
├── healthScore < 0.6 的供应商即使熔断 CLOSED 也移出首选位（软降级，
│   在熔断打开前提前分流，降低硬熔断触发率）
├── 软降级不影响熔断计数，事件仅记指标不记 Outbox
└── 排序每 5s 重算一次（增量），结果写本地路由缓存（1s 一致性窗口）
```

### 5.7 质量降级链路（VQ 信号驱动）

```text
信号来源：《AI输出质量校验与多模型复核引擎》§6 供应商质量回流——
          vq.supplier.quality.signal 事件单向流入本引擎（R8），
          复核引擎不直接切换供应商。

质量状态三档（quality_state 独立于 circuit_state，G13 互不自动转换）：
├── WARN：avgQualityScore1h ∈ [55,60) 或 hallucinationRate1h ∈ (0.08,0.1]
│   → 路由权重 ×0.8，仅指标记录
├── REDUCED：avgQualityScore1h < 55 或 hallucinationRate1h ≥ 0.1
│   → 该供应商移出该场景首选位（等效降链），发布 provider.quality.degraded
│   → 通知管理后台 + Prompt 工作台排查
└── QUARANTINE：REDUCED 持续 24h 未恢复 或 幻觉率 ≥ 0.2
    → 场景级摘除（等效禁用但不覆盖 manual），每日探测验证，
      连续 3 日未恢复 → 生成永久禁用工单（人工决策）

最小样本保护（R10）：该供应商该场景近 1h 有效质检样本 < 50 条时不触发
任何质量降级（防灰度新模型小样本误杀）；样本量随事件携带，本引擎不回查。
```

### 5.8 全局降级与人工干预

```text
四级降级（GlobalDegradationLevel）激活规则与审批矩阵：

| 级别 | 触发方式 | 审批要求 | 生效范围 |
| --- | --- | --- | --- |
| NON_CRITICAL_ONLY | 人工/自动（成本超支联动） | 单人 + 短信告知 SRE 群 | 非核心场景直接兜底 |
| MINIMAL_MODEL | 人工 | 单人 + 短信告知 | 全场景强制最低优先级模型 |
| CACHE_ONLY | 人工 | 双人（操作人+复核人） | 全场景仅缓存与预制响应 |
| FULL_STOP | 人工 | 双人；紧急时可单人先行，
|                |  | 10min 内双人复核否则自动回退 CACHE_ONLY | 停止一切 AI 生成 |

自动触发联动：日预算消耗 100%（多模型调度成本治理）→ 自动 NON_CRITICAL_ONLY
             + 通知；自动触发仅允许这一种（其余级别必须人工）。

自动解除条件（仅 NON_CRITICAL_ONLY 支持自动解除）：
├── 激活原因消失（预算恢复/供应商全部 CLOSED 且质量分 >70 持续 15min）
└── MINIMAL_MODEL/CACHE_ONLY/FULL_STOP 一律人工解除（lift），
    解除操作同样双人（FULL_STOP）/单人+告知（其余），发布 lifted 事件

配置中心兜底通道（R14）：管理接口不可用时，可通过配置中心
kill-switch: failover.global-level 直接生效，两通道审计统一落本引擎表。
```

### 5.9 分龄降级文案规范

| 学段 | 降级提示（PREBUILT/NOTICE）示例 | 设计原则 |
| --- | --- | --- |
| 幼儿 | 「小老师休息一下，马上回来！先看看别的好玩的吧～」 | 短句、安抚、不出现「故障/错误」字样、家长可读 |
| 小学低年级 | 「AI 老师需要休息一分钟，你可以先做一道小练习哦！」 | 正向引导、给出替代动作 |
| 小学高年级/初中 | 「AI 服务正在恢复中，预计 1 分钟后可重试。你可以先复习错题本。」 | 明确预期 + 学习闭环替代 |
| 高中 | 「AI 服务暂时不可用（已在恢复），建议先完成今日计划中的练习任务。」 | 信息完整、自助安排 |

> 文案由运营维护、审核后入库（版本化管理 degraded_copy_v{N}），本引擎按学段取用；缓存兜底响应统一追加 degraded 角标（C2），不伪装成正常回答。

---

## 6. 关键代码实现

### 6.1 FailoverEngineImpl 主循环

```java
/**
 * 容灾降级决策引擎主实现
 * 线程安全：无实例状态，所有状态委托 Redis + 本地一级缓存
 */
@Service
public class FailoverEngineImpl implements FailoverExecutor {

    private final ProviderRouter providerRouter;
    private final ProviderHealthManager healthManager;
    private final DegradationStrategyEvaluator strategyEvaluator;
    private final FallbackResponseBuilder fallbackBuilder;
    private final FailoverEventPublisher eventPublisher;
    private final ModelSchedulerClient modelSchedulerClient; // 调度层委托（R1）
    private final MeteringClient meteringClient;

    @Override
    public FailoverResult executeWithFailover(AiRequest request) {
        long deadline = System.currentTimeMillis() + budgetMs(request);
        List<FailoverHop> chain = new ArrayList<>();
        List<String> eventIds = new ArrayList<>();

        // 步骤 1: 全局降级覆盖检查
        GlobalDegradationLevel global = healthManager.getGlobalLevel();
        GlobalOverrideDecision gd = strategyEvaluator.evaluateGlobalOverride(request, global);
        if (gd.isShortCircuit()) {
            return fallbackBuilder.buildUltimate(request, gd.getFallbackType(), chain, eventIds);
        }

        // 步骤 2: 获取候选链 = 调度层路由结果，耗尽后回落静态基线链（R1）
        List<ProviderModelCandidate> candidates =
            modelSchedulerClient.routeCandidates(request);   // 复用调度层路由+限流
        candidates = strategyEvaluator.mergeWithBaselineChain(
            candidates, policyOf(request.getSceneType()));  // 静态 providerChain 兜底

        int maxHops = candidates.size() * 2;                 // 守卫 G2
        long firstChoice = -1;

        for (int hop = 0; hop < maxHops && System.currentTimeMillis() < deadline; hop++) {
            ProviderModelCandidate c = providerRouter.next(
                candidates, request.getSceneType(), hop, chain);   // §5.1-3.1/3.4
            if (c == null) break;                             // 全部不可用 → 兜底
            if (firstChoice < 0) firstChoice = c.getStableId();

            long hopBudget = Math.min(policy.perHopTimeoutMs(),
                                      deadline - System.currentTimeMillis());
            try {
                AiResponse resp = callWithRetry(c, request, hopBudget, chain);

                // 成功：计量（仅最终成功 hop，G11）+ 健康回报
                healthManager.reportSuccess(c.getProviderId(), request.getSceneType());
                meteringClient.reportSuccess(request.getRequestId(), c, resp); // request_id 幂等

                boolean degraded = c.getStableId() != firstChoice;
                if (degraded) {
                    eventIds.add(eventPublisher.publishSwitchEvent(
                        request, chain.get(0).getProviderId(), c.getProviderId(),
                        chain, System.currentTimeMillis() - request.getStartMs()));
                }
                return FailoverResult.success(c, resp, degraded, chain, eventIds);

            } catch (ProviderCallException e) {
                // 失败分类（§5.4.1）→ 健康回报 → 记录 hop → 继续循环
                healthManager.reportFailure(c.getProviderId(),
                    request.getSceneType(), e.toFailureClass());
                chain.add(FailoverHop.of(c, e));
                if (e.getFailureClass() == FailureClass.AUTH_ERROR) {
                    healthManager.tripAllScenes(c.getProviderId(), e);  // G5 全场景熔断
                }
                if (e.getFailureClass() == FailureClass.USER_CANCEL) {
                    return FailoverResult.cancelled(chain);             // 不计失败
                }
            }
        }

        // 步骤 6: 最终兜底
        return fallbackBuilder.buildUltimate(request, policy.ultimateFallback(),
                                             chain, eventIds);
    }

    private long budgetMs(AiRequest req) {
        return strategyEvaluator.policyOf(req.getSceneType()).totalBudgetMs();
    }
}
```

### 6.2 分布式熔断器（Redis + Lua 原子状态机）

```java
/**
 * 供应商×场景熔断器
 * 状态权威在 Redis（多节点一致），MySQL 快照仅用于重启恢复与审计
 */
public class ProviderCircuitBreaker {

    private static final String KEY_CB   = "FO:cb:%s:%s";        // provider:scene → Hash
    private static final String KEY_WIN  = "FO:win:%s:%s";       // 滑动窗口 ring
    private static final String KEY_429  = "FO:429cd:%s";        // 供应商级 429 冷却

    /**
     * 原子判定：当前是否允许请求通过（含 HALF_OPEN 探测令牌发放）
     * 返回 [ALLOWED, PROBE_ALLOWED, REJECTED_OPEN, REJECTED_COOLDOWN]
     */
    public AdmissionDecision admit(String providerId, String scene) {
        // Lua 保证「读状态 + OPEN→HALF_OPEN 惰性转移 + 探测令牌扣减」原子执行
        return redis.eval(ADMIT_SCRIPT,
            List.of(cbKey(providerId, scene),
                    windowKey(providerId, scene),
                    rateLimitKey(providerId)),
            List.of(String.valueOf(now()),
                    String.valueOf(cfg(scene).halfOpenMaxProbeRequests())));
    }

    // ---- 核心 Lua（节选）：状态机转移与探测令牌 ----
    private static final String ADMIT_SCRIPT = """
        local cb   = KEYS[1]
        local win  = KEYS[2]
        local cd   = KEYS[3]
        local now  = tonumber(ARGV[1])
        local probes = tonumber(ARGV[2])
        -- 429 冷却检查（供应商级，G9）
        if redis.call('EXISTS', cd) == 1 then
          return {'REJECTED_COOLDOWN'}
        end
        local state = redis.call('HGET', cb, 'state') or 'CLOSED'
        if state == 'CLOSED' then return {'ALLOWED'} end
        if state == 'OPEN' then
          local openedAt = tonumber(redis.call('HGET', cb, 'opened_at') or 0)
          local backoff  = tonumber(redis.call('HGET', cb, 'backoff') or 0)
          local duration = tonumber(redis.call('HGET', cb, 'duration') or 60000)
          local wait = duration * math.pow(2, backoff)
          if now >= openedAt + wait then
            -- 惰性转移 OPEN→HALF_OPEN，发放探测令牌
            redis.call('HSET', cb, 'state', 'HALF_OPEN',
                       'successes', 0, 'probe_left', probes)
            redis.call('PUBLISH', 'FO:transition', cb .. '|HALF_OPEN')
            return {'PROBE_ALLOWED'}
          end
          return {'REJECTED_OPEN'}
        end
        -- HALF_OPEN：令牌窗口内放行探测
        local left = tonumber(redis.call('HGET', cb, 'probe_left') or 0)
        if left > 0 then
          redis.call('HINCRBY', cb, 'probe_left', -1)
          return {'PROBE_ALLOWED'}
        end
        return {'REJECTED_OPEN'}
        """;

    /** 失败上报（带权重，§5.4.1），原子判定是否触发熔断 */
    public boolean reportFailure(String providerId, String scene,
                                 FailureClass cls, double weight) {
        if (cls == FailureClass.RATE_LIMITED) {
            redis.set(rateLimitKey(providerId), "1",
                      Duration.ofSeconds(cfg(scene).rateLimitCooldownSeconds())); // 30s
        }
        Boolean tripped = redis.eval(FAIL_SCRIPT,
            List.of(cbKey(providerId, scene), windowKey(providerId, scene)),
            List.of(String.valueOf(weight),
                    String.valueOf(cfg(scene).failureThreshold()),
                    String.valueOf(cfg(scene).errorRateThreshold()),
                    String.valueOf(cfg(scene).minSampleSize()))); // 20
        if (Boolean.TRUE.equals(tripped)) {
            // 发布 Outbox 事件 provider.circuit.opened（异步，不阻塞调用线程）
            eventOutbox.enqueue(CircuitOpenedEvent.of(providerId, scene));
        }
        return Boolean.TRUE.equals(tripped);
    }
}
```

### 6.3 供应商健康状态管理器（两级缓存）

```java
/**
 * 运行时权威 = Redis；本地 Caffeine 1s 读缓存（最终一致窗口）
 * 质量指标（quality_state）与熔断指标（circuit_state）分离存储（G13）
 */
@Service
public class ProviderHealthManagerImpl implements ProviderHealthManager {

    private final Cache<String, ProviderHealthState> localCache =
        Caffeine.newBuilder().expireAfterWrite(Duration.ofSeconds(1)).build();

    @Override
    public ProviderHealthState getState(String providerId, AiSceneType scene) {
        return localCache.get(key(providerId, scene),
            k -> loadFromRedis(providerId, scene));  // miss 时聚合 L1/L2 信号
    }

    /** VQ 质量信号消费（R8：单向流入，本引擎裁决动作） */
    @KafkaListener(topics = "vq.domain.events", groupId = "failover-engine")
    public void onQualitySignal(SupplierQualitySignalEvent evt) {
        // 最小样本保护（R10）：<50 样本直接丢弃
        if (evt.getSampleSize() < 50) return;
        qualityStateRepo.applySignal(evt);      // 滑动 1h 窗口聚合
        QualityState qs = qualityStateRepo.evaluate(evt.getProviderId(), evt.getScene());
        if (qs.isTransition()) {
            eventOutbox.enqueue(QualityDegradedEvent.of(qs));
        }
    }

    /** 多节点状态变更订阅：Redis Pub/Sub → 失效本地缓存 */
    @PostConstruct
    public void subscribeTransitions() {
        redis.subscribe("FO:transition", channel ->
            localCache.invalidate(extractKey(channel)));  // 1s 窗口内主动收敛
    }
}
```

### 6.4 流式 TTFB 看门狗与中途中断处理

```java
/**
 * 流式容灾：首 token 预算看门狗 + 中断策略路由
 */
public class StreamingFailoverHandler {

    public FailoverResult execute(AiRequest req, StreamConsumer consumer) {
        for (int hop = 0; hop < maxHops(req); hop++) {
            ProviderModelCandidate c = providerRouter.next(candidates(req), req, hop, seen);
            CompletableFuture<FirstToken> ftf = adapter.callStreamingAsync(c, req)
                .thenApply(StreamHead::firstToken)
                .orTimeout(policy.ttfbBudgetMs(req.getSceneType()), MILLIS); // 5s/8s/10s

            CompletableFuture<FirstToken> guarded = ftf.exceptionally(ex -> {
                adapter.cancelUpstream(c, req);   // 防 token 空转计费（§5.3-1）
                throw new TtfbBudgetExceededException(c, ex);
            });

            try {
                FirstToken ft = guarded.join();
                // 首 token 成功 → 交接给流转发器，注册中断回调
                return streamRelay.relay(c, req, ft, consumer,
                    onMidStreamAbort -> handleMidStreamAbort(c, req, consumer,
                                                            onMidStreamAbort));
            } catch (CompletionException e) {
                if (e.getCause() instanceof TtfbBudgetExceededException) {
                    health.reportFailure(c.getProviderId(), req.getSceneType(),
                                         FailureClass.TIMEOUT, 1.0);
                    continue;  // 首 token 前切换，用户无感
                }
                throw (RuntimeException) e.getCause();
            }
        }
        return fallbackBuilder.buildUltimate(req, policy.ultimateFallback(), seen, ids);
    }

    /** 首 token 后中断：按场景路由中断策略（§5.3-2） */
    private MidStreamRecovery handleMidStreamAbort(ProviderModelCandidate failed,
            AiRequest req, StreamConsumer consumer, AbortContext ctx) {
        health.reportFailure(failed.getProviderId(), req.getSceneType(),
                             FailureClass.MID_STREAM_ABORT, 1.5);   // G10 权重 1.5×
        return switch (policy.midStreamPolicy(req.getSceneType())) {
            case REGEN -> streamRelay.restartWith(
                providerRouter.nextSkipping(failed, req),
                req, consumer, MidStreamRecovery.REGEN);            // tutoring
            case DELTA_CONTINUE -> streamRelay.continueWith(       // exam/math
                providerRouter.nextSkipping(failed, req),
                req, ctx.emittedText(), consumer,   // 已产出内容作为续写上下文
                MidStreamRecovery.DELTA_CONTINUE,
                fallbackOnFail -> streamRelay.restartWith(          // 续写失败一次→重答
                    providerRouter.nextSkipping(ctx, req), req, consumer,
                    MidStreamRecovery.REGEN));
            case SSE_DELEGATE -> streamRelay.delegateToSseEngine(   // 其他场景
                req, ctx, MidStreamRecovery.NONE);                  // R4
        };
    }
}
```

### 6.5 缓存兜底构建器

```java
/**
 * CACHE_FALLBACK 委托《AI输出缓存与智能复用引擎》语义检索
 */
@Service
public class CacheFallbackBuilder {

    public FallbackResponse tryCacheFallback(AiRequest req,
                                             UltimateFallbackConfig cfg) {
        // G12：阈值 = max(本策略, 缓存引擎场景阈值) —— 更严格者胜
        double threshold = Math.max(
            cfg.getCacheSimilarityThreshold(),                 // 默认 0.85
            cacheEngineClient.sceneThreshold(req.getSceneType())); // 题目类 0.98

        Optional<CacheHit> hit = cacheEngineClient.semanticSearch(
            CacheSearchQuery.builder()
                .scene(req.getSceneType())
                .queryText(req.getNormalizedPrompt())
                .stage(req.getStage())          // 学段过滤，防止跨学段错配
                .subject(req.getSubject())
                .threshold(threshold)
                .hitType("DEGRADED")            // 兜底命中不写回缓存引擎命中率统计
                .build());

        if (hit.isEmpty()) {
            return FallbackResponse.miss();    // 依序降级到下一兜底类型
        }
        // SOSF L1 本地快检（<1ms，词库更新防漏网，R3）；
        // 缓存入库前已过全量过滤，故跳过 L2/L3 云端检测
        SafetyVerdict v = sosfClient.quickLocalCheck(hit.get().getContent());
        if (v.isBlocked()) return FallbackResponse.miss();

        return FallbackResponse.builder()
            .type(UltimateFallbackType.CACHE_FALLBACK)
            .cacheSourceId(hit.get().getEntryId())
            .cacheSimilarity(hit.get().getSimilarity())
            .displayContent(hit.get().getContent())
            .isDegraded(true)                  // C2：必须带 degraded 标记与 AIGC 标识
            .build();
    }
}
```

---

## 7. 状态机与守卫

### 7.1 熔断器三态状态机（每 providerId × sceneType 实例）

```text
                 failureThreshold / errorRate / timeoutRate
   ┌──────────┐ ─────────────────────────────────────────→ ┌──────────┐
   │  CLOSED  │                                              │   OPEN   │←─┐
   └──────────┘ ←─────────────────────────────────────────  └──────────┘  │ 探测失败
        ↑              探测连续成功 ≥ 3                            │       │ backoff+1
        │                                                    openedAt+60s×2^n│
   ┌──────────┐ ←─────────────────────────────────────────  ┌──────────┐
   │HALF_OPEN │        令牌耗尽前 3 连成功 → CLOSED           │ HALF_OPEN│─┘
   └──────────┘                                              └──────────┘

特殊转移：
├── AUTH_ERROR → 任意状态直接 OPEN（供应商级全场景），backoff 冻结，
│   仅人工 reset / 密钥轮换后重新探测（G5）
├── manual_disabled=true → 独立于熔断状态的硬开关（G7 优先级最高）
└── quality_state（NORMAL/WARN/REDUCED/QUARANTINE）与本状态机并行独立，
    互不自动转换（G13），QUARANTINE 效果=场景摘除但不动 circuit_state
```

### 7.2 全局降级状态机

```text
NONE → NON_CRITICAL_ONLY → MINIMAL_MODEL → CACHE_ONLY → FULL_STOP
 ↑__________________________ lift（人工，双/单人规则见 §5.8）___________↑

不变量：
├── 级别只能沿激活方向单调上升或直接 lift 回 NONE，不支持跳级下降
│   （MINIMAL_MODEL → NON_CRITICAL_ONLY 需先 lift 再重新激活，简化审计）
├── 自动触发仅允许预算联动 → NON_CRITICAL_ONLY，且可自动解除
└── FULL_STOP 单人先行 → 10min 无双人复核自动回退 CACHE_ONLY（定时器守卫）
```

### 7.3 守卫总表 G1-G14

| 守卫 | 规则 | 违反后果 |
| --- | --- | --- |
| G1 | 所有 AI 模型调用必须经 executeWithFailover，业务服务禁止直连适配层 | 架构评审卡点；调用方埋点扫描 |
| G2 | 单请求总 hop ≤ chain.length×2，禁止无限循环 | 循环上界硬编码兜底 |
| G3 | OPEN 供应商不得接收新请求，仅持探测令牌请求例外 | Lua 层拒绝，返回 REJECTED_OPEN |
| G4 | 同供应商同时仅 1 个主动探测（SETNX 单飞） | 第二个探测直接放弃 |
| G5 | 认证失败熔断不自动恢复，必须人工介入 | 探测降频至每日 4 次 + P1 告警 |
| G6 | CACHE_ONLY / FULL_STOP 双人审批；FULL_STOP 紧急单人 10min 复核 | 超时自动回退 CACHE_ONLY |
| G7 | 手动禁用优先级最高，抑制一切自动恢复探测 | 探测调度器跳过 disabled |
| G8 | 备用供应商承接降级流量 ≤ maxConcurrentDegradationPercent | 超限跳过该供应商 |
| G9 | 429 冷却期内跳过供应商且不计熔断失败 | 防限流放大为熔断 |
| G10 | 流式中途中断失败权重 1.5×；用户取消不计任何失败 | 权重表硬编码 |
| G11 | 计量仅对最终成功 hop，request_id 幂等防重复计量 | 计量服务端去重（R7） |
| G12 | 缓存兜底相似度阈值取 max(本策略, 缓存引擎场景阈值) | 更严格者胜 |
| G13 | 质量降级与可用性熔断为独立状态空间，互不自动转换 | 状态分离存储 |
| G14 | 策略配置热生效（版本号+双缓冲），不中断进行中请求 | 旧请求沿用旧策略快照 |

---

## 8. 幂等与并发控制

### 8.1 多节点状态一致性

- 熔断状态运行时权威在 Redis（Lua 原子转移），本地 Caffeine 1s 读缓存；状态变更经 Redis Pub/Sub `FO:transition` 主动失效其他节点本地缓存，一致性窗口 ≤1s（G3 由 Redis 层兜底，本地缓存过期仅影响路由软降级排序精度）。
- MySQL `ai_provider_circuit_state` 为持久化快照：状态转移时异步落库（允许 2s 滞后），服务重启时从快照恢复并按 `next_probe_at` 重算 HALF_OPEN 时机；Redis 与快照冲突时以 Redis 为准。

### 8.2 关键竞态裁决表

| 场景 | 竞态 | 裁决 |
| --- | --- |
| 两节点同时判定熔断打开 | 双写 circuit_opened | Lua 原子：仅第一笔 SET 成功方发布 Outbox 事件，第二笔返回已打开不重复发 |
| 探测与手动禁用并发 | HALF_OPEN 探测进行中管理员禁用 | 禁用胜；探测结果丢弃；发布 manual.disabled 事件携带探测中断标记 |
| 手动 reset 与失败上报并发 | reset 清零后旧失败事件到达 | 失败上报携带 epoch（reset 递增 epoch），旧 epoch 事件丢弃 |
| 全局降级激活与请求在途 | 请求已过覆盖检查、降级随后激活 | 在途请求按激活前策略完成（不中断），新请求立即生效 |
| 策略热更新与在途请求 | 版本切换 | 在途请求持有旧版本快照（G14），新请求加载新版本 |
| 降级闸门计数泄漏 | 节点崩溃未 DECR | 计数带 60s 窗口 TTL，Lua 定期重算收敛，误差 ≤1 窗口 |
| 探测令牌耗尽与恢复成功并发 | 第 4 个探测请求到达 | REJECTED_OPEN；恢复判定只看已放行的 3 个探测结果 |

### 8.3 幂等设计总表

| 操作 | 幂等键 | 机制 |
| --- | --- | --- |
| 计量上报 | request_id | 计量服务唯一索引去重（R7，对齐 Token 计量 idx_metering_request） |
| Outbox 事件消费 | (event_id, consumer) | 消费方登记表唯一键 |
| 手动操作（禁用/降级/reset） | 操作流水号 op_id | 审计表唯一键，重复提交返回首次结果 |
| 管理接口写操作 | Idempotency-Key 头 | 网关层通用幂等（对齐 API 网关规范） |
| 探测请求 | providerId + 探测时隙 | 单飞锁兜底 |

---

## 9. 数据模型与事件

### 9.1 MySQL DDL

```sql
-- 供应商×场景熔断与质量状态快照（Redis 运行时权威，本表用于恢复与审计）
CREATE TABLE ai_provider_circuit_state (
  id                   BIGINT PRIMARY KEY AUTO_INCREMENT,
  provider_id          VARCHAR(32)  NOT NULL COMMENT '供应商编码，对齐 model_providers.provider_code',
  scene_type           VARCHAR(32)  NOT NULL COMMENT '场景编码，对齐调度层 route_rules.scene_code',
  circuit_state        VARCHAR(16)  NOT NULL DEFAULT 'CLOSED' COMMENT 'CLOSED/OPEN/HALF_OPEN',
  consecutive_failures INT          NOT NULL DEFAULT 0,
  consecutive_successes INT         NOT NULL DEFAULT 0,
  circuit_opened_at    DATETIME(3)  NULL,
  open_backoff_level   TINYINT      NOT NULL DEFAULT 0 COMMENT '退避级别 0-4（修复 v1.0 F8）',
  open_reason          VARCHAR(32)  NULL COMMENT 'CONSECUTIVE/ERROR_RATE/TIMEOUT_RATE/AUTH',
  next_probe_at        DATETIME(3)  NULL COMMENT '= opened_at + duration×2^backoff（修复 v1.0 F2）',
  manually_disabled    TINYINT      NOT NULL DEFAULT 0,
  disable_reason       VARCHAR(255) NULL,
  quality_state        VARCHAR(16)  NOT NULL DEFAULT 'NORMAL' COMMENT 'NORMAL/WARN/REDUCED/QUARANTINE（G13 独立）',
  quality_entered_at   DATETIME(3)  NULL COMMENT '质量状态进入时间（QUARANTINE 24h→工单计时）',
  state_epoch          BIGINT       NOT NULL DEFAULT 0 COMMENT 'reset 递增，竞态裁决用',
  state_version        BIGINT       NOT NULL DEFAULT 0 COMMENT '乐观锁',
  updated_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_provider_scene (provider_id, scene_type),
  INDEX idx_state (circuit_state, quality_state)
) ENGINE=InnoDB COMMENT='供应商×场景熔断状态快照';

-- 降级策略配置（版本化，双缓冲热生效）
CREATE TABLE failover_policy (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  scene_type    VARCHAR(32) NOT NULL,
  version       INT         NOT NULL,
  enabled       TINYINT     NOT NULL DEFAULT 1,
  policy_json   JSON        NOT NULL COMMENT 'DegradationPolicy 序列化',
  updated_by    VARCHAR(64) NOT NULL,
  approved_by   VARCHAR(64) NULL COMMENT '双人审批：策略含 FULL_STOP 联动时必填',
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_scene_version (scene_type, version),
  INDEX idx_scene_active (scene_type, enabled)
) ENGINE=InnoDB COMMENT='降级策略配置版本';

-- 全局降级操作记录（审计 append-only）
CREATE TABLE failover_global_override (
  id                    BIGINT PRIMARY KEY AUTO_INCREMENT,
  level                 VARCHAR(32) NOT NULL COMMENT 'NON_CRITICAL_ONLY/MINIMAL_MODEL/CACHE_ONLY/FULL_STOP',
  action                VARCHAR(16) NOT NULL COMMENT 'ACTIVATE/LIFT',
  reason                VARCHAR(500) NOT NULL,
  operator              VARCHAR(64) NOT NULL,
  second_operator       VARCHAR(64) NULL COMMENT '双人审批复核人（修复 v1.0 F5）',
  approval_mode         VARCHAR(16) NOT NULL DEFAULT 'DUAL' COMMENT 'DUAL/SINGLE_EMERGENCY（后者10min复核）',
  auto_triggered        TINYINT     NOT NULL DEFAULT 0 COMMENT '预算联动自动触发标记',
  estimated_recovery_at DATETIME(3) NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_created (created_at)
) ENGINE=InnoDB COMMENT='全局降级审计';

-- 事件 Outbox
CREATE TABLE fo_outbox (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  event_id     VARCHAR(64) NOT NULL,
  event_type   VARCHAR(64) NOT NULL,
  payload_json JSON        NOT NULL,
  status       VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  retry_count  INT         NOT NULL DEFAULT 0,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  published_at DATETIME(3) NULL,
  UNIQUE KEY uk_event (event_id),
  INDEX idx_status (status, created_at)
) ENGINE=InnoDB COMMENT='容灾事件 Outbox';
```

### 9.2 事件分级与 Outbox 策略（量级裁决）

| 事件 | 量级预估（DAU 50 万） | 通道 | 说明 |
| --- | --- | --- | --- |
| 逐请求 PROVIDER_SWITCH / MODEL_DEGRADATION | 日 ~8 万条（切换率 2%） | ClickHouse 日志 + 指标直录 | **不走 Outbox**（量级过大），仅指标聚合 |
| provider.circuit.opened / half_opened / closed | 日 ~2000 条 | Outbox → Kafka | 状态变更必须可靠广播 |
| provider.manual.disabled / enabled | 低频 | Outbox | 审计+路由同步 |
| provider.quality.degraded | 低频 | Outbox | 联动 Prompt 工作台排查 |
| scene.ultimate_fallback.entered / exited | 极低频（故障期） | Outbox | P1 告警联动 |
| global.degradation.activated / lifted | 极低频 | Outbox | 全链路通知 |

> Kafka Topic：`failover.domain.events`（Outbox Relay 投递，(event_id, consumer) 幂等消费，与既有事件体系对齐）。日终对账：Outbox published 数 = Kafka 发送确认数，积压 >500 或延迟 >60s 告警（M8）。

### 9.3 消费方矩阵

| 事件 | 消费方 | 消费动作 |
| --- | --- | --- |
| provider.circuit.* | 多模型调度引擎 | 回写模型可用性输入（R1 信号互通） |
| provider.circuit.* | 监控告警（SRE） | 熔断面板 + flapping 告警（M4） |
| provider.circuit.* | 管理后台驾驶舱 | 供应商健康看板实时刷新 |
| provider.manual.* | 多模型调度引擎 | 路由表剔除/恢复 |
| provider.quality.degraded | 管理后台 + Prompt 工作台 | 质量排查工单 |
| provider.quality.degraded | 模型版本灰度引擎 | 灰度看板标注（R10 边界） |
| scene.ultimate_fallback.* | 通知中心 | P1 电话/短信值班告警 |
| scene.ultimate_fallback.* | 客服知识库 | 降级口径同步（对齐事故公告模式） |
| global.degradation.* | 全体业务服务 | 降级状态本地缓存刷新 |
| global.degradation.* | 埋点平台 | 全局降级期间指标打标（口径剔除） |

### 9.4 ClickHouse 日志表

```sql
CREATE TABLE failover_event_log ON CLUSTER '{cluster}' (
  event_time    DateTime64(3),
  event_id      String,
  event_type    LowCardinality(String),
  request_id    String,
  user_hash     String COMMENT 'userId SHA-256（修复 v1.0 F6，不落原始 userId）',
  scene_type    LowCardinality(String),
  provider_from LowCardinality(String) DEFAULT '',
  provider_to   LowCardinality(String) DEFAULT '',
  model_from    LowCardinality(String) DEFAULT '',
  model_to      LowCardinality(String) DEFAULT '',
  reason        LowCardinality(String),
  failover_latency_ms UInt32,
  estimated_quality UInt8 DEFAULT 0,
  hop_count     UInt8,
  degraded      UInt8 DEFAULT 0
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(event_time)
ORDER BY (event_time, scene_type)
TTL event_time + INTERVAL 90 DAY;
```

### 9.5 Redis Key 总表

| Key | 类型 | TTL | 用途 |
| --- | --- | --- | --- |
| FO:cb:{provider}:{scene} | Hash | 无（快照落库） | 熔断状态权威 |
| FO:win:{provider}:{scene} | Hash（60 桶×1s 或 12 桶×5s） | 70s | 滑动窗口统计 |
| FO:429cd:{provider} | String | 30s | 供应商级 429 冷却（G9） |
| FO:probe:{provider} | String(SETNX) | 30s | 主动探测单飞（G4） |
| FO:gauge:{provider}:{scene} | Counter | 60s 窗口 | 降级承接流量闸门（G8） |
| FO:global | String | 无 | 全局降级级别 |
| FO:policy:{scene} | String(JSON) | 5s | 策略热缓存（G14） |
| FO:ttfb:{requestId} | String | 15s | 流式 TTFB 看门狗辅助 |

---

## 10. 错误码（57700-57799）

| 错误码 | 标识 | HTTP | 含义与处置 |
| --- | --- | --- | --- |
| 57701 | FAILOVER_NO_PROVIDER_AVAILABLE | 503 | 全供应商不可用，已走最终兜底；响应体含 fallback 内容时不报错仅标记 degraded |
| 57702 | FAILOVER_GLOBAL_FULL_STOP | 503 | 全局停服中，返回分龄降级文案 |
| 57703 | FAILOVER_GLOBAL_CACHE_ONLY | 503 | 全局仅缓存模式且缓存未命中 |
| 57704 | FAILOVER_TTFB_BUDGET_EXCEEDED | 504 | 全链路首 token 预算耗尽（内部埋点用，客户端统一文案） |
| 57705 | FAILOVER_STREAM_ABORTED | 502 | 流式中断且恢复策略全部失败（对齐 SSE 引擎终止事件） |
| 57706 | FAILOVER_BUDGET_EXHAUSTED_FALLBACK | 200 | 请求级总预算耗尽触发兜底（200 语义码，响应正常） |
| 57707 | FAILOVER_QUEUE_NOT_ALLOWED | 200 | 同步场景请求排队被拒，改走 PREBUILT（200 语义） |
| 57711 | FAILOVER_POLICY_NOT_FOUND | 500 | 场景未配置策略，回落 DEFAULT_POLICY 并告警（D2） |
| 57712 | FAILOVER_POLICY_VERSION_CONFLICT | 409 | 策略更新版本冲突，重读后重试 |
| 57713 | FAILOVER_INVALID_PROVIDER_CHAIN | 400 | 策略校验失败：链空/引用不存在模型/首选项成环 |
| 57714 | FAILOVER_SCENE_NOT_CONFIGURED | 400 | 未知 sceneType |
| 57721 | FAILOVER_MANUAL_TOGGLE_REJECTED | 409 | 禁用操作与状态机冲突（如已禁用再禁用，幂等返回首次结果除外） |
| 57722 | FAILOVER_RESET_REJECTED | 409 | 非本人/epoch 不匹配的熔断 reset 拒绝 |
| 57723 | FAILOVER_CIRCUIT_STATE_CONFLICT | 409 | CAS 版本冲突，刷新重试 |
| 57724 | FAILOVER_PROBE_IN_PROGRESS | 409 | 探测进行中拒绝重复触发 |
| 57731 | FAILOVER_GLOBAL_DEGRADATION_ACTIVE | 409 | 重复激活全局降级（幂等：同级别返回成功，跨级别 409） |
| 57732 | FAILOVER_GLOBAL_DEGRADATION_NOT_ACTIVE | 409 | 无激活中的全局降级可解除 |
| 57733 | FAILOVER_DUAL_APPROVAL_REQUIRED | 403 | CACHE_ONLY/FULL_STOP 缺双人审批 |
| 57734 | FAILOVER_EMERGENCY_REVIEW_TIMEOUT | 200 | 单人紧急 FULL_STOP 复核超时自动回退（200 语义，审计事件） |
| 57741 | FAILOVER_EVENT_QUERY_RANGE_TOO_LARGE | 400 | 事件查询跨度 >31 天 |
| 57742 | FAILOVER_ADMIN_RATE_LIMITED | 429 | 管理接口限流 |
| 57751 | FAILOVER_CACHE_ENGINE_UNAVAILABLE | 200 | 缓存引擎故障已降级 PREBUILT（200 语义，D3） |
| 57752 | FAILOVER_QUEUE_ENGINE_UNAVAILABLE | 200 | 队列引擎故障已降级 NOTICE（200 语义，D4） |
| 57753 | FAILOVER_METERING_REPORT_FAILED | 200 | 计量上报失败转异步补偿（200 语义，D5，不阻塞响应） |
| 57754 | FAILOVER_REDIS_DEGRADED | 200 | Redis 故障降级运行标记（D1，响应头 X-FO-Degraded: redis） |

> 客户端映射红线：577xx 内部错误不透出供应商名称与内部拓扑，客户端统一映射为「AI 服务暂时不可用，正在为你换一种方式/请稍后重试」（对齐 AI 对话引擎 AIClientError 模式）；200 语义码仅供埋点与排障，不产生用户可见错误。

---

## 11. 降级矩阵 D1-D10

| 编号 | 故障 | 降级动作 |
| --- | --- | --- |
| D1 | Redis 不可用 | 本地快照只读降级运行：熔断判定改用本地窗口（阈值保守化 ×0.6）+ 标记 stale + P1 告警；恢复后状态回同步（快照覆盖 Redis，因快照滞后 2s 可接受） |
| D2 | 策略配置加载失败 | 使用代码内嵌 DEFAULT_POLICY（tutoring 链+缓存兜底），告警；管理后台只读模式 |
| D3 | 缓存引擎不可用 | CACHE_FALLBACK 直接降级 PREBUILT_RESPONSE，事件标记 57751 |
| D4 | 队列引擎不可用 | QUEUE_AND_RETRY 降级 SERVICE_DEGRADED_NOTICE，事件标记 57752 |
| D5 | 计量上报失败 | 本地缓冲异步补偿 24h，不阻塞用户响应（G11 幂等保证重试安全） |
| D6 | Outbox 写入失败 | 本地文件暂存（追加写）24h 内补偿回灌，告警 M8 |
| D7 | 健康探测连续失败 | 维持 OPEN + 退避封顶 600s；探测自身故障（网络设备问题）与供应商故障区分：探测通道不可用时冻结熔断状态机转移并告警（防误判全熔断） |
| D8 | 全供应商 OPEN 且无全局覆盖 | 场景默认兜底链（§5.2 矩阵）+ 自动建议（不自动执行）NON_CRITICAL_ONLY |
| D9 | 管理接口不可用 | 运行时不受影响；人工干预走配置中心 kill-switch 兜底通道（R14），审计事后补录 |
| D10 | 流式降级链全失败 | 返回已生成部分 + 礼貌结束语 + 重试入口（对齐 SSE 引擎终止降级），标记 57705 |

> 总红线：本引擎任何降级不得绕过 SOSF 安全过滤与答案管控（R3）；未成年人场景降级文案必须分龄且过审（C1）。

---

## 12. 监控与容量

### 12.1 指标 M1-M10 与告警

| 指标 | 定义 | 告警阈值 |
| --- | --- | --- |
| M1 failover_rate | 切换请求数/总请求数（5m 窗口） | 基线 <2%；>5% 持续 5min P2；>15% P1 |
| M2 switch_latency_p99 | 切换附加延迟（首供应商失败→次供应商首响应） | P99 >2s P2（违反 §1.3 目标） |
| M3 ultimate_fallback_rate | 兜底响应占比 | >0.5% 持续 5min P1；>5% P0（大面积不可用） |
| M4 circuit_flapping | 同供应商 1h 内 OPEN↔恢复 ≥3 次 | P2（阈值或网络抖动排查） |
| M5 probe_success_rate | HALF_OPEN 探测成功率 | <50% 且持续 3 轮 → 维持 OPEN 告警 |
| M6 ttfb_budget_breach_rate | TTFB 预算击穿率 | >10% 持续 10min P2（预算或供应商劣化） |
| M7 global_degradation_duration | 全局降级活跃时长 | >30min P1 通知值班；FULL_STOP >10min 未复核 P0 |
| M8 outbox_lag | Outbox 积压/延迟 | 积压 >500 或延迟 >60s P2 |
| M9 cache_fallback_hit_rate | 兜底请求缓存命中率 | 故障期 <30% P3（缓存策略优化信号） |
| M10 policy_reload_latency | 策略热生效延迟 | >5s P3 |

### 12.2 容量估算（DAU 50 万）

- AI 调用日 ~400 万次，峰值 QPS ~800（对齐调度层容量口径）；切换率 2% → 日切换 ~8 万次，逐请求事件仅入 ClickHouse（日 8 万行 × 90 天 ≈ 720 万行，单表无压力）。
- 状态变更 Outbox 日 ~2000 条；Redis：熔断状态 ~30 供应商×20 场景=600 Hash + 窗口 600 Key + 辅助 Key <100MB。
- 熔断判定 Lua P99 <3ms（纯 Redis 内存操作）；路由排序本地缓存命中 P99 <1ms，不构成调用链路显著开销（主链路预算由供应商调用主导）。
- 探测成本：每供应商日 ¥1 封顶 ×30 供应商 = 日 ¥30，纳入 AI 总成本预算（多模型调度成本治理对账）。

---

## 13. 合规红线 C1-C10

| 编号 | 红线 |
| --- | --- |
| C1 | 降级文案必须分龄（§5.9）且经审核入库，禁止代码硬编码临时文案；幼儿文案禁出现「故障/错误」字样 |
| C2 | 缓存兜底与预制响应必须携带 degraded 标记与 AIGC 标识，禁止伪装成正常新生成回答 |
| C3 | 平台侧故障降级不扣减用户额度（兜底响应 billable=false），会员权益不因降级缩水；自动续费扣款窗口期与 FULL_STOP 重叠时顺延扣款 |
| C4 | 手动禁用/全局降级/reset 全量审计 append-only（操作人/复核人/原因/时间），审计不可删改保留 3 年 |
| C5 | 事件与日志不落 Prompt 原文/用户输入/回复内容，userId 以 SHA-256 哈希入 ClickHouse（F6） |
| C6 | 切换目标仅限已过《第三方服务集成与供应商管理》合规与数据出境评估的供应商池；降级不得突破合规边界（供应商池外供应商禁止入链，配置校验拦截） |
| C7 | 质量降级通道与内容安全拦截通道严格分离，禁止以质量降级名义绕过 SOSF/答案管控（R3） |
| C8 | FULL_STOP 不影响历史会话读取与本地离线功能（错题本/笔记/已下载内容），降级只停止新生成 |
| C9 | 主动探测使用固定轻量 prompt，禁止携带真实用户数据 |
| C10 | 降级期间未成年人防沉迷/时长统计/家长管控照常生效，降级不构成豁免理由 |

---

## 14. 契约对齐 R1-R14

| 编号 | 对齐文档 | 裁决 |
| --- | --- | --- |
| R1 | 多模型调度与成本治理 | 正常选路归调度层：executeWithFailover 首步委托其获取候选链（复用路由+限流+模型级熔断 30s）；本引擎 providerChain 为容灾基线，运行时候选=调度层结果，耗尽后回落基线链；本引擎 L3（供应商×场景）状态为对外权威，两层状态只读互通 |
| R2 | 大模型推理统一适配层 | ProviderAdapter/ChannelHealthManager 实现归适配层；其 Channel 三态（HEALTHY/DEGRADED/CIRCUIT_OPEN）为本引擎输入信号；本引擎 CircuitState 三态（CLOSED/OPEN/HALF_OPEN）为场景级权威，词汇映射：HEALTHY↔CLOSED、DEGRADED↔软降级（healthScore<0.6）、CIRCUIT_OPEN↔OPEN |
| R3 | SOSF 流式安全过滤 | 降级/兜底/缓存复用响应仍需过 SOSF：新生成内容走 FilterStream 全量过滤；缓存兜底因入库前已全检，复用时仅过 L1 本地快检；答案管控（ACPH）权威不受降级影响 |
| R4 | SSE 流式响应引擎 | 首 token 前切换用户无感；中途失败降级链与其 degradation_level 0-3 联动；regen_start/续写协议与断点恢复归 SSE 引擎渲染层，本引擎只决策策略（REGEN/DELTA_CONTINUE/SSE_DELEGATE） |
| R5 | 大模型推理请求队列调度引擎 | QUEUE_AND_RETRY 仅限异步可等待场景（essay_grading/report_generation）；排队优先级与时长上限归队列引擎，本引擎投递时标记 source=FAILOVER；同步场景管理接口层拒绝（57707） |
| R6 | AI输出缓存与智能复用引擎 | 语义检索委托其 semanticSearch；相似度阈值 max(本策略, 其场景阈值)更严格者胜（G12）；兜底命中 hit_type=DEGRADED 不计入其正常命中率与 TTL 延长统计 |
| R7 | AI模型调用Token计量与成本归集核算 | 仅最终成功 hop 计量且 billable；中间失败 hop 记成本日志 billable=false（供应商成本仍归集）；request_id 唯一防重（对齐其 idx_metering_request 幂等） |
| R8 | AI输出质量校验与多模型复核引擎 | 供应商质量信号经 vq.supplier.quality.signal 单向流入本引擎，降级动作裁决权在本引擎（复核引擎不越权切换——对齐其 §6 设计） |
| R9 | 服务端健康检查与服务就绪探针设计规范 | 适配层 ping 探活归适配层/探针规范；本引擎主动探测为轻量真实推理（验证推理可用性而非 TCP/HTTP 可达），两者并存语义不同 |
| R10 | AI模型版本生命周期管理与灰度发布决策引擎 | 灰度中的模型受最小样本保护（<50 样本/h 不触发质量降级），防止灰度小流量误摘除 |
| R11 | 管理后台-AI模型与Prompt模板配置工作台 | 熔断面板/策略配置/全局降级操作 UI 挂载该工作台；双人审批组件与审计规范对齐管理后台通用规范 |
| R12 | 服务端统一业务异常码与错误分类体系 | 57700-57799 段注册入统一错误码登记表；200 语义码（57706/57707/57751-57754）单独标注防止误当故障 |
| R13 | 多模型调度「切换 <30s」与本引擎「<2s」口径 | <2s=单请求路由级切换附加延迟（熔断已开时跳过即达）；<30s=故障发生到熔断打开的检测时长上限；两者口径不同不矛盾 |
| R14 | 配置中心与动态配置管理 | kill-switch: failover.global-level 为管理接口故障时的兜底通道，双通道生效但审计统一落 failover_global_override 表 |

---

## 15. 验收场景（18 条）

1. 注入供应商 A 连续 5 次超时：熔断 <30s 打开，流量切至 B，用户请求 P99 附加延迟 <2s，chain 首跳记录 FAILURE。
2. 熔断打开后第 61s 新请求到达：Lua 惰性转移 HALF_OPEN，放行 3 探测令牌，3 连成功后 CLOSED，backoff 归零。
3. HALF_OPEN 首探测失败：立即回 OPEN，backoff=1（下次探测 120s 后），事件 provider.circuit.opened 再次发布。
4. 供应商返回 429：进入 30s 冷却，期间请求直接跳过且熔断失败计数不增加；冷却结束恢复路由。
5. 供应商返回 401：全场景熔断 + P1 告警；每日探测 4 次仍 401 不退避升级；人工 reset（epoch+1）后恢复正常探测节奏。
6. 流式请求 TTFB 8s 无首 token（预算 5s）：cancel 上游、切换供应商，客户端全程仅 typing 指示无 error 事件。
7. tutoring 流式已输出 200 token 后中断：客户端收 regen_start 清屏重答，提示「正在换一种方式回答…」，中断计权重 1.5 失败。
8. exam_sprint 流式中断：差量续写上下文完整拼接，ARPP 格式规范化通过；人为令续写失败一次，自动降级完整重答。
9. 全供应商 OPEN：tutoring 场景缓存兜底命中（相似度 0.87 ≥ 0.85），响应带 degraded 标记与 AIGC 标识，SOSF L1 快检通过。
10. math_solving 兜底检索最高相似度 0.95 < 0.98 场景阈值：不放出缓存，依序走 PREBUILT_RESPONSE（G12 严格者胜）。
11. 全局降级 NON_CRITICAL_ONLY 激活（自动预算联动）：tutoring 正常服务，recitation_check 返回降级；预算恢复 15min 后自动解除并发布 lifted。
12. FULL_STOP 单人紧急激活：10min 内无第二人复核，自动回退 CACHE_ONLY 并记 57734 审计事件；历史会话可读。
13. 手动禁用供应商 B 后其熔断自然恢复条件满足：不产生探测（G7），重新启用后从 CLOSED 冷启动。
14. 备用供应商 B 承接降级流量达 maxConcurrentDegradationPercent：新切换请求跳过 B 转向 C（G8），60s 窗口计数正确回收。
15. 一次三跳容灾（A超时→B限流→C成功）：仅 C 计量 billable=true 且 request_id 唯一；A/B hop 成本日志 billable=false；客户端无重复扣额。
16. 停 Redis 30s：本地快照降级运行（阈值×0.6 保守化），期间熔断判定误差可控，恢复后 MySQL 快照回灌 Redis，X-FO-Degraded 头出现后消失。
17. VQ 信号 hallucinationRate1h=0.12（样本 200）：REDUCED 生效移出首选，provider.quality.degraded 事件发布；同信号样本 30 条：不触发（R10）。
18. 双节点压测 800 QPS：节点 A 打开熔断后 ≤1s 节点 B 感知（Pub/Sub 失效+1s TTL 双保险），B 无请求漏打到 OPEN 供应商（ClickHouse 对账 REJECTED_OPEN=0 且漏打=0）。

---

## 16. 关联文档

| 文档 | 关系 |
| --- | --- |
| 多模型调度与成本治理-详细设计.md | 正常路径路由与成本（R1/R13） |
| 服务端-大模型推理统一适配层与多供应商模型调用抽象框架-详细设计.md | 适配器与通道健康（R2） |
| 服务端-大模型流式输出实时安全过滤中间件与动态拦截替换引擎-详细设计.md | 降级内容安全过滤（R3） |
| SSE流式响应与AI增量渲染引擎-详细设计.md | 流式降级链与渲染（R4） |
| 服务端-大模型推理请求队列调度与高峰期用户体验保障引擎-详细设计.md | 排队兜底（R5） |
| AI输出缓存与智能复用引擎-详细设计.md | 缓存兜底检索（R6） |
| 服务端-AI模型调用Token计量与成本归集核算服务-详细设计.md | 计量幂等（R7） |
| 服务端-AI输出质量校验与多模型复核引擎-详细设计.md | 质量信号回流（R8） |
| 错误处理与服务降级策略-详细设计.md | 降级总纲，本文档为 AI 领域垂直深化 |
| 管理后台-AI模型与Prompt模板配置工作台-详细设计.md | 运维操作 UI（R11） |
| 服务端统一业务异常码与错误分类体系-详细设计.md | 错误码段登记（R12） |

---

## 17. 维护记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v1.0 | 2026-08 初批次 | 初始版本：架构/数据结构/API。文件在 §5.1 主调用流程第 3.2 步「若无可」处截断，流式容灾/熔断转移/探测/质量降级/全局降级/代码/状态机/幂等/事件/错误码/降级/监控/合规/契约/验收全缺 |
| v1.1 | 2026-08-20 | 补全烂尾文档（670→全文）：完成 §5.1 主流程（3.2-7 步含预算控制）并新增 §5.2 场景兜底矩阵、§5.3 流式容灾（TTFB 看门狗/中途中断三策略）、§5.4 错误分类与三层熔断边界裁决、§5.5 探测与恢复、§5.6 评分排序、§5.7 质量降级三档、§5.8 全局降级审批矩阵、§5.9 分龄文案；§6 关键代码五段；§7 双状态机+守卫 G1-G14；§8 幂等七场景竞态裁决表；§9 四表 DDL+事件量级分级（逐请求事件不走 Outbox）+消费方矩阵+ClickHouse 日志+Redis 八 Key；§10 错误码 57700-57799 共 24 项（含 6 个 200 语义码）；§11 降级 D1-D10；§12 监控 M1-M10+容量；§13 合规 C1-C10；§14 契约对齐 R1-R14；§15 验收 18 条。修复 v1.0 八处缺陷：F1 providerChain 与调度层路由职责重叠→R1 裁决（运行时候选=调度层结果，耗尽回落基线）；F2 nextProbeAllowedAt 无计算口径→openedAt+duration×2^backoff；F3 QUEUE_AND_RETRY 无队列归属→R5 委托队列引擎且限异步场景；F4 FailoverResult 缺流式语义→补 streaming 四字段契约；F5 GlobalDegradationOverride 缺审批字段→DDL 补 second_operator/approval_mode；F6 FailoverEvent.userId 无脱敏策略→ClickHouse 落 user_hash；F7 质量指标字段存在但无触发链路→§5.7 补全三档与最小样本保护；F8 openDuration 固定 60s 无退避→backoff_level 列与 60→600s 指数退避 |