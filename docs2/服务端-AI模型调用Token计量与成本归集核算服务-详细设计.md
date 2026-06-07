# AI模型调用Token计量与成本归集核算服务 - 详细设计

> **版本**: v1.0 | **日期**: 2026-06-07 | **状态**: 初稿
> **关联文档**: 多模型调度与成本治理、用户额度与API调用管控系统、支付与会员订阅、服务端统一限流熔断与流量防护体系、数据埋点与关键指标系统

---

## 1. 概述

### 1.1 设计目标

为启硕 PrimeTop 提供精确到每次 AI 模型调用的 Token 用量计量、成本计算、归集分摊和报表输出能力，使运营和财务团队能够：

1. **实时掌握**每位用户、每个功能模块、每种模型供应商的 AI 调用成本
2. **精细化控制**免费用户与付费用户的额度消耗，支撑 Freemium 商业模式
3. **异常预警**成本突增或模型供应商调价带来的影响
4. **多维分析**按用户、功能、学段、教材版本等维度归集成本，指导产品策略

### 1.2 范围

| 包含 | 不包含 |
|------|--------|
| Token 用量采集（prompt_tokens / completion_tokens） | 模型供应商账单对账（见支付对账服务） |
| 成本单价管理与多供应商价格配置 | 前端额度展示 UI（见会员中心客户端设计） |
| 用户级 / 功能级 / 模型级成本归集 | 模型路由策略（见多模型调度与成本治理） |
| 每日 / 每月成本聚合与预算告警 | 用户额度扣减流程（见用户额度管控系统） |
| 成本数据 API 与运营看板数据源 | 计费出账（见支付与会员订阅） |

### 1.3 核心术语

| 术语 | 说明 |
|------|------|
| **Token** | AI 模型处理文本的基本单位，不同模型分词方式不同 |
| **MeteringRecord** | 一次 AI 调用的计量记录 |
| **CostUnit** | 成本核算单元，包含单价与币种 |
| **CostCenter** | 成本中心，可以是用户、功能模块、学段或租户 |
| **PriceTier** | 价格档位，模型供应商按 token 用量的阶梯价格 |

---

## 2. 数据模型

### 2.1 模型供应商价格配置表 `ai_model_price`

存储各模型供应商、模型版本的价格信息，支持阶梯定价。

```sql
CREATE TABLE ai_model_price (
    id              BIGSERIAL PRIMARY KEY,
    provider        VARCHAR(64)  NOT NULL,          -- 供应商: openai, anthropic, zhipu, baidu, aliyun 等
    model_code      VARCHAR(128) NOT NULL,          -- 模型标识: gpt-4o, claude-3.5-sonnet, glm-4 等
    tier_type       VARCHAR(32)  NOT NULL DEFAULT 'flat', -- 定价方式: flat(固定), tiered(阶梯)
    
    -- Token 单价（单位：元 / 千Token）
    input_price_per_1k   DECIMAL(10,6) NOT NULL,    -- 输入 token 单价
    output_price_per_1k  DECIMAL(10,6) NOT NULL,    -- 输出 token 单价
    
    -- 阶梯定价（tier_type = tiered 时使用）
    tier_config     JSONB,                          -- [{ "min_tokens": 0, "input_price": 0.03, "output_price": 0.06 }]
    
    -- 缓存 token 折扣（部分供应商支持）
    cache_discount_rate DECIMAL(3,2) DEFAULT 0.5,   -- 缓存命中 token 的价格折扣率 (0.5 = 半价)
    
    currency        VARCHAR(8)   NOT NULL DEFAULT 'CNY',
    effective_from  TIMESTAMPTZ  NOT NULL,          -- 生效开始时间
    effective_to    TIMESTAMPTZ,                     -- 生效结束时间（NULL = 当前有效）
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    
    CONSTRAINT uq_model_price_effective UNIQUE (provider, model_code, effective_from)
);

COMMENT ON TABLE ai_model_price IS 'AI模型供应商价格配置表';
COMMENT ON COLUMN ai_model_price.input_price_per_1k IS '输入Token单价（元/千Token）';
COMMENT ON COLUMN ai_model_price.output_price_per_1k IS '输出Token单价（元/千Token）';
COMMENT ON COLUMN ai_model_price.cache_discount_rate IS '缓存Token折扣率，如 prompt caching 命中';
```

### 2.2 Token 计量记录表 `ai_token_metering`

记录每次 AI 调用的 Token 用量和计算出的成本。

```sql
CREATE TABLE ai_token_metering (
    id              BIGSERIAL PRIMARY KEY,
    trace_id        VARCHAR(64)  NOT NULL,          -- 分布式追踪 ID，关联请求链路
    
    -- 调用标识
    user_id         BIGINT       NOT NULL,          -- 用户 ID
    session_id      VARCHAR(64),                    -- 学习会话 ID
    conversation_id VARCHAR(64),                    -- AI 对话 ID
    request_id      VARCHAR(64)  NOT NULL,          -- 本次请求唯一标识
    
    -- 模型信息
    provider        VARCHAR(64)  NOT NULL,          -- 实际调用供应商
    model_code      VARCHAR(128) NOT NULL,          -- 实际使用模型
    routed_model    VARCHAR(128),                    -- 路由目标模型（降级时可能不同）
    is_fallback     BOOLEAN      DEFAULT FALSE,     -- 是否为降级调用
    
    -- 业务场景
    feature_code    VARCHAR(64)  NOT NULL,          -- 功能编码: ai_tutoring, photo_search, essay_correction 等
    subject_code    VARCHAR(32),                    -- 学科编码
    grade_code      VARCHAR(16),                    -- 年级编码
    
    -- Token 用量
    prompt_tokens       INT      NOT NULL DEFAULT 0,
    completion_tokens   INT      NOT NULL DEFAULT 0,
    total_tokens        INT      NOT NULL DEFAULT 0,
    cached_tokens       INT      DEFAULT 0,          -- 缓存命中的 token 数（如有）
    
    -- 成本计算
    input_cost      DECIMAL(12,6) NOT NULL DEFAULT 0,   -- 输入成本（元）
    output_cost     DECIMAL(12,6) NOT NULL DEFAULT 0,   -- 输出成本（元）
    total_cost      DECIMAL(12,6) NOT NULL DEFAULT 0,   -- 总成本（元）
    price_snapshot  JSONB,                               -- 计算时的价格快照，避免价格变动影响历史数据
    
    -- 响应信息
    latency_ms      INT,                              -- 模型响应延迟（毫秒）
    status_code     SMALLINT    NOT NULL,             -- HTTP 状态码或业务状态码
    is_streaming    BOOLEAN     DEFAULT FALSE,        -- 是否流式调用
    finish_reason   VARCHAR(32),                      -- stop, length, error 等
    
    -- 时间
    called_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (called_at);

-- 按月分区
CREATE TABLE ai_token_metering_2026_06 PARTITION OF ai_token_metering
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE ai_token_metering_2026_07 PARTITION OF ai_token_metering
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
-- 后续分区由定时任务自动创建

-- 索引
CREATE INDEX idx_metering_user_date ON ai_token_metering (user_id, called_at);
CREATE INDEX idx_metering_feature_date ON ai_token_metering (feature_code, called_at);
CREATE INDEX idx_metering_provider_model ON ai_token_metering (provider, model_code, called_at);
CREATE INDEX idx_metering_trace ON ai_token_metering (trace_id);
CREATE INDEX idx_metering_request ON ai_token_metering (request_id);

COMMENT ON TABLE ai_token_metering IS 'AI模型Token计量记录表（按月分区）';
COMMENT ON COLUMN ai_token_metering.feature_code IS '功能编码，用于按模块归集成本';
COMMENT ON COLUMN ai_token_metering.price_snapshot IS '计算时的价格快照，保证历史数据可追溯';
```

### 2.3 每日成本汇总表 `ai_cost_daily_summary`

预聚合每日成本数据，加速查询。

```sql
CREATE TABLE ai_cost_daily_summary (
    id              BIGSERIAL PRIMARY KEY,
    summary_date    DATE         NOT NULL,
    dimension_type  VARCHAR(32)  NOT NULL,          -- 维度类型: user, feature, provider, model, grade
    dimension_key   VARCHAR(128) NOT NULL,          -- 维度值: user_id, feature_code, provider 等
    
    -- 聚合统计
    total_calls     INT          NOT NULL DEFAULT 0,
    success_calls   INT          NOT NULL DEFAULT 0,
    failed_calls    INT          NOT NULL DEFAULT 0,
    
    total_prompt_tokens      BIGINT       NOT NULL DEFAULT 0,
    total_completion_tokens  BIGINT       NOT NULL DEFAULT 0,
    total_tokens             BIGINT       NOT NULL DEFAULT 0,
    
    total_input_cost   DECIMAL(14,4) NOT NULL DEFAULT 0,
    total_output_cost  DECIMAL(14,4) NOT NULL DEFAULT 0,
    total_cost         DECIMAL(14,4) NOT NULL DEFAULT 0,
    
    avg_latency_ms    INT,                           -- 平均响应延迟
    max_latency_ms    INT,                           -- 最大响应延迟
    
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    
    CONSTRAINT uq_daily_summary UNIQUE (summary_date, dimension_type, dimension_key)
);

CREATE INDEX idx_daily_date_type ON ai_cost_daily_summary (summary_date, dimension_type);

COMMENT ON TABLE ai_cost_daily_summary IS 'AI成本每日汇总表，按多维度预聚合';
```

### 2.4 成本预算与告警配置表 `ai_cost_budget`

```sql
CREATE TABLE ai_cost_budget (
    id              BIGSERIAL PRIMARY KEY,
    scope_type      VARCHAR(32)  NOT NULL,           -- global, feature, user_tier
    scope_key       VARCHAR(128) NOT NULL,           -- 'all', feature_code, 'free'|'premium'
    period_type     VARCHAR(16)  NOT NULL,           -- daily, monthly
    
    budget_amount   DECIMAL(12,2) NOT NULL,          -- 预算金额（元）
    warn_threshold  DECIMAL(3,2)  NOT NULL DEFAULT 0.8,  -- 预警阈值百分比 (0.8 = 80%)
    
    enabled         BOOLEAN       NOT NULL DEFAULT TRUE,
    notify_channels JSONB         NOT NULL DEFAULT '["email","webhook"]',
    notify_targets  JSONB,                              -- [{ "type": "email", "value": "ops@example.com" }]
    
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ai_cost_budget IS 'AI成本预算与告警配置';
```

---

## 3. 功能编码体系

### 3.1 功能编码定义

所有 AI 调用必须携带 `feature_code`，用于成本归集到具体业务模块。

```typescript
/**
 * AI 功能编码枚举
 * 用于 Token 计量和成本归集
 */
export enum AIFeatureCode {
  // ---- P0 核心功能 ----
  AI_TUTORING         = 'ai_tutoring',          // AI 智能辅导对话
  PHOTO_SEARCH        = 'photo_search',          // 拍照搜题答疑
  STEP_BY_STEP_SOLVE  = 'step_solve',            // 分步解题推导
  KNOWLEDGE_EXPLAIN   = 'knowledge_explain',     // 知识点讲解
  
  // ---- P1 增强功能 ----
  ESSAY_CORRECTION    = 'essay_correction',      // 作文批改
  ESSAY_OUTLINE       = 'essay_outline',          // 作文提纲生成
  EXERCISE_GENERATE   = 'exercise_generate',     // 练习题生成
  WRONG_REASON_ANALYZE = 'wrong_reason',          // 错因分析
  STUDY_PLAN_GENERATE = 'study_plan',             // 学习计划生成
  RECITATION_DETECT   = 'recitation_detect',     // 背诵检测
  ORAL_PRACTICE       = 'oral_practice',          // 口语陪练
  RAG_RETRIEVAL       = 'rag_retrieval',          // RAG 知识库检索
  
  // ---- P2 扩展功能 ----
  SIMILAR_QUESTION    = 'similar_question',       // 同类题推荐
  KNOWLEDGE_GRAPH_QA  = 'knowledge_graph_qa',    // 知识图谱问答
  REPORT_GENERATE     = 'report_generate',        // 学情报告生成
  CONTENT_MODERATION  = 'content_moderation',     // 内容安全审核
  PROMPT_PREVIEW      = 'prompt_preview',         // Prompt 模板预览测试
}
```

### 3.2 功能编码 → 成本中心映射

```typescript
/**
 * 功能编码到成本中心的映射规则
 * 用于运营看板的多维度归集
 */
export const FEATURE_COST_CENTER_MAP: Record<AIFeatureCode, {
  costCenter: string;
  billable: boolean;        // 是否对用户计费
  freeQuotaDaily: number;   // 免费用户每日额度（次数）
  premiumQuotaDaily: number; // 付费用户每日额度（次数）
}> = {
  [AIFeatureCode.AI_TUTORING]: {
    costCenter: 'core_tutoring',
    billable: true,
    freeQuotaDaily: 10,
    premiumQuotaDaily: 200,
  },
  [AIFeatureCode.PHOTO_SEARCH]: {
    costCenter: 'photo_search',
    billable: true,
    freeQuotaDaily: 5,
    premiumQuotaDaily: 100,
  },
  [AIFeatureCode.STEP_BY_STEP_SOLVE]: {
    costCenter: 'core_tutoring',
    billable: true,
    freeQuotaDaily: 5,
    premiumQuotaDaily: 80,
  },
  [AIFeatureCode.KNOWLEDGE_EXPLAIN]: {
    costCenter: 'core_tutoring',
    billable: true,
    freeQuotaDaily: 15,
    premiumQuotaDaily: 300,
  },
  [AIFeatureCode.ESSAY_CORRECTION]: {
    costCenter: 'essay辅导',
    billable: true,
    freeQuotaDaily: 1,
    premiumQuotaDaily: 20,
  },
  // ... 其余功能类似
};
```

---

## 4. 核心流程设计

### 4.1 Token 计量采集流程

每次 AI 调用的计量数据在 **AI 输出完成后异步写入**，不阻塞主请求路径。

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   客户端请求   │────>│  AI 服务网关   │────>│  模型供应商    │────>│  流式/同步返回  │
│ (携带 trace_id)│     │ (路由/限流)    │     │  API 调用     │     │  Token 报告    │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                            │                                          │
                            │          ┌───────────────────────────────┘
                            │          │ Token 用量数据
                            ▼          ▼
                     ┌──────────────────────┐
                     │  MeteringCollector    │ ◄── 异步收集，不阻塞响应
                     │  (内存队列 → 批量写入)  │
                     └──────────┬───────────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
              ┌──────────┐ ┌────────┐ ┌──────────────┐
              │ 计量记录表 │ │ Redis  │ │  成本计算     │
              │ (持久化)   │ │ 实时计数│ │ (单价×用量)   │
              └──────────┘ └────────┘ └──────────────┘
```

### 4.2 计量采集器实现

```typescript
/**
 * MeteringCollector - Token 计量采集器
 * 
 * 设计要点：
 * 1. 内存缓冲队列，批量写入数据库（每 500ms 或累积 100 条）
 * 2. 通过 Redis INCR 实时更新用户/功能的当日用量计数
 * 3. 成本计算使用调用时刻的价格快照
 */
import { Redis } from 'ioredis';
import { Pool } from 'pg';

interface MeteringEvent {
  traceId: string;
  userId: number;
  sessionId?: string;
  conversationId?: string;
  requestId: string;
  provider: string;
  modelCode: string;
  routedModel?: string;
  isFallback: boolean;
  featureCode: string;
  subjectCode?: string;
  gradeCode?: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  latencyMs: number;
  statusCode: number;
  isStreaming: boolean;
  finishReason?: string;
  calledAt: Date;
}

interface MeteringRecord extends MeteringEvent {
  totalTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  priceSnapshot: object;
}

export class MeteringCollector {
  private buffer: MeteringEvent[] = [];
  private flushInterval: NodeJS.Timer | null = null;
  private readonly BUFFER_SIZE = 100;
  private readonly FLUSH_INTERVAL_MS = 500;

  constructor(
    private readonly db: Pool,
    private readonly redis: Redis,
    private readonly priceService: ModelPriceService,
  ) {}

  async start(): Promise<void> {
    this.flushInterval = setInterval(() => this.flush(), this.FLUSH_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (this.flushInterval) clearInterval(this.flushInterval);
    await this.flush(); // 最后一次刷盘
  }

  /**
   * 收集一次 AI 调用的计量数据
   * 非阻塞：放入内存缓冲区后立即返回
   */
  collect(event: MeteringEvent): void {
    this.buffer.push(event);
    
    // 实时更新 Redis 计数（同步操作，但很快）
    this.updateRealtimeCounters(event).catch(err => {
      console.error('[MeteringCollector] Redis counter update failed', err);
      // 不影响主流程，仅记录日志
    });

    if (this.buffer.length >= this.BUFFER_SIZE) {
      // 超过缓冲区大小，立即刷盘
      setImmediate(() => this.flush());
    }
  }

  /**
   * 批量写入数据库
   */
  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const events = this.buffer.splice(0, this.buffer.length);
    
    try {
      // 1. 批量计算成本
      const records = await Promise.all(
        events.map(e => this.calculateCost(e))
      );

      // 2. 批量插入数据库
      await this.batchInsert(records);

    } catch (err) {
      console.error('[MeteringCollector] Flush failed, re-enqueueing', err);
      // 写入失败时，将数据重新放回缓冲区（限制重试）
      if (this.buffer.length + events.length < this.BUFFER_SIZE * 5) {
        this.buffer.unshift(...events);
      }
      // 超过重试限制则写入死信队列
      else {
        await this.writeToDeadLetterQueue(events, err);
      }
    }
  }

  /**
   * 成本计算核心逻辑
   */
  private async calculateCost(event: MeteringEvent): Promise<MeteringRecord> {
    const price = await this.priceService.getPrice(
      event.provider,
      event.modelCode,
      event.calledAt
    );

    let inputCost: number;
    let outputCost: number;

    if (price.tierType === 'flat') {
      // 固定单价
      inputCost = (event.promptTokens / 1000) * price.inputPricePer1k;
      outputCost = (event.completionTokens / 1000) * price.outputPricePer1k;
      
      // 缓存 token 折扣
      if (event.cachedTokens > 0 && price.cacheDiscountRate < 1) {
        const cachedSavings = (event.cachedTokens / 1000) * price.inputPricePer1k 
                              * (1 - price.cacheDiscountRate);
        inputCost -= cachedSavings;
      }
    } else {
      // 阶梯定价
      inputCost = this.calculateTieredCost(
        event.promptTokens, price.tierConfig!, 'input'
      );
      outputCost = this.calculateTieredCost(
        event.completionTokens, price.tierConfig!, 'output'
      );
    }

    // 四舍五入到 6 位小数
    inputCost = Math.round(inputCost * 1_000_000) / 1_000_000;
    outputCost = Math.round(outputCost * 1_000_000) / 1_000_000;

    return {
      ...event,
      totalTokens: event.promptTokens + event.completionTokens,
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      priceSnapshot: {
        provider: price.provider,
        modelCode: price.modelCode,
        inputPricePer1k: price.inputPricePer1k,
        outputPricePer1k: price.outputPricePer1k,
        cacheDiscountRate: price.cacheDiscountRate,
        effectiveFrom: price.effectiveFrom,
      },
    };
  }

  /**
   * 阶梯定价计算
   */
  private calculateTieredCost(
    tokens: number,
    tierConfig: Array<{ min_tokens: number; input_price: number; output_price: number }>,
    priceField: 'input' | 'output'
  ): number {
    const sorted = [...tierConfig].sort((a, b) => a.min_tokens - b.min_tokens);
    let remaining = tokens;
    let cost = 0;

    for (let i = 0; i < sorted.length; i++) {
      const tier = sorted[i];
      const nextMin = i + 1 < sorted.length ? sorted[i + 1].min_tokens : Infinity;
      const tierWidth = nextMin - tier.min_tokens;
      const tokensInTier = Math.min(remaining, tierWidth);
      
      if (tokensInTier <= 0) break;
      
      const price = priceField === 'input' ? tier.input_price : tier.output;
      cost += (tokensInTier / 1000) * price;
      remaining -= tokensInTier;
    }

    return cost;
  }

  /**
   * 实时更新 Redis 计数器
   * 用于额度检查和实时仪表盘
   */
  private async updateRealtimeCounters(event: MeteringEvent): Promise<void> {
    const today = event.calledAt.toISOString().slice(0, 10); // YYYY-MM-DD
    const month = today.slice(0, 7); // YYYY-MM
    const pipeline = this.redis.pipeline();

    // 用户维度：当日 token 用量
    const userDailyKey = `meter:user:${event.userId}:${today}`;
    pipeline.incrbyfloat(`${userDailyKey}:prompt`, event.promptTokens);
    pipeline.inr(`${userDailyKey}:calls`);
    pipeline.expire(`${userDailyKey}:prompt`, 172800); // 2 天 TTL

    // 功能维度：当日 token 用量
    const featureDailyKey = `meter:feature:${event.featureCode}:${today}`;
    pipeline.incrbyfloat(`${featureDailyKey}:total`, event.promptTokens + event.completionTokens);
    pipeline.inr(`${featureDailyKey}:calls`);
    pipeline.expire(`${featureDailyKey}:total`, 172800);

    // 全局维度：当日总成本
    const globalDailyKey = `meter:global:${today}`;
    pipeline.inr(`${globalDailyKey}:calls`);
    pipeline.expire(`${globalDailyKey}:calls`, 172800);

    // 用户月度成本（用于预算检查）
    const userMonthlyKey = `meter:user_monthly:${event.userId}:${month}`;
    // totalCost 在 flush 后异步更新（此时还未计算）
    // 这里先记录 token 数，成本在 flush 时通过单独的 key 更新
    pipeline.inr(`${userMonthlyKey}:calls`);
    pipeline.expire(`${userMonthlyKey}:calls`, 2592000); // 30 天 TTL

    await pipeline.exec();
  }

  /**
   * 批量插入数据库
   */
  private async batchInsert(records: MeteringRecord[]): Promise<void> {
    if (records.length === 0) return;

    const values = records.map(r => [
      r.traceId, r.userId, r.sessionId, r.conversationId, r.requestId,
      r.provider, r.modelCode, r.routedModel, r.isFallback,
      r.featureCode, r.subjectCode, r.gradeCode,
      r.promptTokens, r.completionTokens, r.totalTokens, r.cachedTokens,
      r.inputCost, r.outputCost, r.totalCost, JSON.stringify(r.priceSnapshot),
      r.latencyMs, r.statusCode, r.isStreaming, r.finishReason,
      r.calledAt,
    ]);

    const placeholders = values.map((_, i) => {
      const offset = i * 25;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5},
        $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9},
        $${offset + 10}, $${offset + 11}, $${offset + 12},
        $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16},
        $${offset + 17}, $${offset + 18}, $${offset + 19}, $${offset + 20},
        $${offset + 21}, $${offset + 22}, $${offset + 23}, $${offset + 24},
        $${offset + 25})`;
    }).join(', ');

    const flatValues = values.flat();

    await this.db.query(`
      INSERT INTO ai_token_metering (
        trace_id, user_id, session_id, conversation_id, request_id,
        provider, model_code, routed_model, is_fallback,
        feature_code, subject_code, grade_code,
        prompt_tokens, completion_tokens, total_tokens, cached_tokens,
        input_cost, output_cost, total_cost, price_snapshot,
        latency_ms, status_code, is_streaming, finish_reason,
        called_at
      ) VALUES ${placeholders}
    `, flatValues);

    // 更新用户月度成本到 Redis
    const pipeline = this.redis.pipeline();
    const monthKey = new Date().toISOString().slice(0, 7);
    for (const r of records) {
      const key = `meter:user_monthly:${r.userId}:${monthKey}:cost`;
      pipeline.incrbyfloat(key, r.totalCost);
      pipeline.expire(key, 2592000);
    }
    await pipeline.exec();
  }

  /**
   * 死信队列写入（计量数据丢失的最后保障）
   */
  private async writeToDeadLetterQueue(events: MeteringEvent[], error: unknown): Promise<void> {
    const payload = JSON.stringify({
      events,
      error: String(error),
      timestamp: new Date().toISOString(),
    });
    // 写入 Redis List 作为简易死信队列
    await this.redis.rpush('metering:dead_letter', payload);
    console.error(`[MeteringCollector] ${events.length} events written to dead letter queue`);
  }
}
```