# AI 幻觉检测与教育事实校验引擎 - 详细设计

> 版本: v1.0 | 创建日期: 2026-05-24 | 状态: 初稿

## 1. 概述

### 1.1 背景与问题

在 PrimeTop 的教育场景中，AI 大模型可能产生以下类型的幻觉输出：

| 幻觉类型 | 示例 | 危害等级 |
| --- | --- | --- |
| **事实性错误** | "勾股定理是 a²+b²=c³" | 🔴 严重 — 直接误导学生 |
| **知识编造** | 捏造不存在的诗词、历史事件、化学方程式 | 🔴 严重 — 形成错误认知 |
| **概念混淆** | 将"通电导线在磁场中受力"说成"电磁感应" | 🟡 中等 — 干扰知识体系 |
| **步骤逻辑错误** | 数学推导跳步导致中间结论错误 | 🟡 中等 — 影响解题学习 |
| **过时信息** | 引用已废止的考纲或旧版教材内容 | 🟡 中等 — 与教学不同步 |
| **无意义内容** | 表面通顺但实质无信息量的回答 | 🟢 轻微 — 浪费学习时间 |

原始设计文档将 "AI 回答不准确" 列为第一大项目风险。本引擎作为 **AI 输出管线中的关键安全层**，在回答到达学生之前进行事实性校验，拦截或修正幻觉内容。

### 1.2 设计目标

1. **准确实时**：对 AI 输出进行事实性校验，延迟增量 ≤ 800ms
2. **分层拦截**：高置信度幻觉直接拦截，低置信度添加提示标签
3. **知识库锚定**：基于教材知识库验证关键事实陈述
4. **闭环修正**：检测到的幻觉回流至知识库，驱动持续改进
5. **可观测性**：幻觉检测率、拦截率、误报率全链路可度量

### 1.3 在系统中的位置

```
用户提问 → Prompt编排 → RAG检索 → LLM生成
                                          ↓
                              ┌───────────────────────┐
                              │  AI幻觉检测与事实校验引擎  │  ← 本文档范围
                              │  (Hallucination Guard)  │
                              └───────────────────────┘
                                          ↓
                              安全过滤 → 适龄化处理 → SSE推送到客户端
```

本引擎位于 LLM 生成之后、安全过滤之前，是输出管线中的**事实性安全屏障**。

### 1.4 与已有模块的边界

| 模块 | 职责边界 |
| --- | --- |
| **AI输出质量校验与多模型复核引擎** | 多模型交叉验证、整体输出质量评分 |
| **AI模型评测基准与质量回归测试系统** | 离线评测、Benchmark、回归测试 |
| **安全与内容合规系统** | 敏感内容过滤、涉黄涉政拦截 |
| **本引擎** | **实时幻觉检测、知识库事实校验、具体错误定位与标注** |

---

## 2. 核心概念与数据模型

### 2.1 核心概念

#### 2.1.1 声明（Claim）

AI 输出中的每一个可验证的事实陈述称为一个 **声明（Claim）**。

```typescript
interface Claim {
  /** 声明唯一ID */
  claimId: string;
  /** 声明在原文中的位置 [startOffset, endOffset] */
  span: [number, number];
  /** 声明原文 */
  text: string;
  /** 声明类型 */
  type: ClaimType;
  /** 检测结果 */
  verdict: Verdict;
  /** 置信度 0~1，越高表示越可能是幻觉 */
  hallucinationScore: number;
  /** 关联的知识库证据 */
  evidences: Evidence[];
  /** 标注来源（自动/人工） */
  source: 'auto' | 'manual';
}

type ClaimType =
  | 'mathematical'    // 数学公式、计算结果
  | 'definition'      // 概念定义
  | 'historical'      // 历史事实、时间、人物
  | 'scientific'      // 科学定律、实验结论
  | 'quotation'       // 引用（诗词、名言、文献）
  | 'procedural';     // 解题步骤、推理过程

type Verdict =
  | 'supported'       // 有知识库证据支持
  | 'contradicted'    // 与知识库矛盾
  | 'unverifiable'    // 知识库中无匹配证据
  | 'partial';        // 部分正确
```

#### 2.1.2 证据（Evidence）

从知识库中检索到的用于验证声明的证据。

```typescript
interface Evidence {
  /** 知识库文档ID */
  docId: string;
  /** 文档来源类型 */
  sourceType: 'textbook' | 'knowledge_point' | 'question_bank' | 'curriculum_standard';
  /** 证据文本 */
  snippet: string;
  /** 与声明的语义相似度 0~1 */
  similarity: number;
  /** 证据支持/反对声明 */
  stance: 'supports' | 'contradicts' | 'neutral';
  /** 教材出处 */
  reference?: {
    textbook: string;    // e.g. "人教版-数学-九年级上"
    chapter?: string;
    page?: number;
  };
}
```

#### 2.1.3 校验报告（VerificationReport）

一次完整的幻觉检测输出。

```typescript
interface VerificationReport {
  /** 报告ID */
  reportId: string;
  /** 关联的AI对话消息ID */
  messageId: string;
  /** 原始AI输出全文 */
  originalText: string;
  /** 声明列表 */
  claims: Claim[];
  /** 整体幻觉风险等级 */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  /** 处理动作 */
  action: VerificationAction;
  /** 检测耗时(ms) */
  latencyMs: number;
  /** 检测模型/策略版本 */
  detectorVersion: string;
  /** 时间戳 */
  timestamp: number;
}

type VerificationAction =
  | 'pass'              // 通过，正常输出
  | 'pass_with_warning' // 通过，附加风险提示
  | 'regenerate'        // 触发重新生成
  | 'block_and_fallback'; // 拦截，返回兜底回答
```

### 2.2 数据库表设计

#### 2.2.1 幻觉检测记录表

```sql
CREATE TABLE hallucination_detection_log (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  report_id       VARCHAR(64) NOT NULL COMMENT '校验报告ID',
  message_id      VARCHAR(64) NOT NULL COMMENT 'AI消息ID',
  user_id         BIGINT NOT NULL COMMENT '用户ID',
  session_id      VARCHAR(64) NOT NULL COMMENT '会话ID',
  subject         VARCHAR(32) NOT NULL COMMENT '学科',
  grade_level     VARCHAR(16) NOT NULL COMMENT '学段年级',
  
  -- 原始内容
  original_text   TEXT NOT NULL COMMENT 'AI原始输出',
  claim_count     INT NOT NULL DEFAULT 0 COMMENT '提取的声明数',
  
  -- 检测结果
  risk_level      ENUM('low','medium','high','critical') NOT NULL,
  action_taken    ENUM('pass','pass_with_warning','regenerate','block_and_fallback') NOT NULL,
  hallucination_score DECIMAL(5,4) COMMENT '整体幻觉评分 0~1',
  
  -- 耗时
  detection_latency_ms INT NOT NULL COMMENT '检测耗时',
  
  -- 元数据
  detector_version VARCHAR(32) NOT NULL,
  model_id        VARCHAR(64) COMMENT '生成AI消息的模型ID',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_user_created (user_id, created_at),
  INDEX idx_risk_level (risk_level, created_at),
  INDEX idx_message_id (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='幻觉检测记录';
```

#### 2.2.2 声明明细表

```sql
CREATE TABLE claim_detail (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  report_id       VARCHAR(64) NOT NULL COMMENT '关联报告ID',
  claim_id        VARCHAR(64) NOT NULL COMMENT '声明ID',
  claim_type      VARCHAR(32) NOT NULL COMMENT '声明类型',
  claim_text      TEXT NOT NULL COMMENT '声明原文',
  
  -- 判定结果
  verdict         ENUM('supported','contradicted','unverifiable','partial') NOT NULL,
  hallucination_score DECIMAL(5,4) NOT NULL COMMENT '幻觉评分',
  confidence      DECIMAL(5,4) NOT NULL COMMENT '判定置信度',
  
  -- 证据摘要
  evidence_count  INT NOT NULL DEFAULT 0,
  primary_evidence_ref VARCHAR(256) COMMENT '主要证据出处',
  
  -- 用户反馈
  user_feedback   ENUM('correct','incorrect','partial','unrated') DEFAULT 'unrated',
  
  -- 人工审核
  review_status   ENUM('pending','confirmed','overturned','skipped') DEFAULT 'skipped',
  reviewer_id     BIGINT,
  review_note     TEXT,
  reviewed_at     DATETIME,
  
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_report (report_id),
  INDEX idx_verdict (verdict, claim_type),
  INDEX idx_review (review_status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='声明检测明细';
```

#### 2.2.3 幻觉模式知识库

```sql
CREATE TABLE hallucination_pattern (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  pattern_type    VARCHAR(32) NOT NULL COMMENT '模式类型: formula/definition/quotation/etc',
  pattern_hash    VARCHAR(64) NOT NULL COMMENT '内容哈希，用于去重',
  
  -- 模式描述
  incorrect_text  TEXT NOT NULL COMMENT '错误内容',
  correct_text    TEXT NOT NULL COMMENT '正确内容',
  explanation     TEXT COMMENT '错误原因分析',
  
  -- 关联知识
  subject         VARCHAR(32) NOT NULL,
  knowledge_point_id VARCHAR(64) COMMENT '关联知识点ID',
  textbook_ref    VARCHAR(256) COMMENT '教材出处',
  
  -- 统计
  occurrence_count INT NOT NULL DEFAULT 1 COMMENT '出现次数',
  last_seen_at    DATETIME NOT NULL COMMENT '最后出现时间',
  
  -- 状态
  status          ENUM('active','deprecated','false_positive') DEFAULT 'active',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY uk_pattern_hash (pattern_hash),
  INDEX idx_subject_type (subject, pattern_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='已知幻觉模式库';
```

---

## 3. 系统架构

### 3.1 整体架构

```
                    ┌─────────────────────────────────┐
                    │      AI 输出管线 (OutputPipeline) │
                    └──────────────┬──────────────────┘
                                   │ LLM 原始输出
                                   ▼
                    ┌──────────────────────────────────┐
                    │     HallucinationGuardService     │
                    │  ┌────────────────────────────┐  │
                    │  │ 1. ClaimExtractor           │  │
                    │  │    声明提取                  │  │
                    │  └────────────┬───────────────┘  │
                    │               ▼                   │
                    │  ┌────────────────────────────┐  │
                    │  │ 2. EvidenceRetriever        │  │
                    │  │    证据检索（知识库锚定）      │  │
                    │  └────────────┬───────────────┘  │
                    │               ▼                   │
                    │  ┌────────────────────────────┐  │
                    │  │ 3. VeracityClassifier       │  │
                    │  │    真实性分类判定             │  │
                    │  └────────────┬───────────────┘  │
                    │               ▼                   │
                    │  ┌────────────────────────────┐  │
                    │  │ 4. ActionDecider            │  │
                    │  │    处置决策                  │  │
                    │  └────────────────────────────┘  │
                    └──────────────┬──────────────────┘
                                   │ VerificationReport
                                   ▼
                    ┌──────────────────────────────────┐
                    │   后续管线: 安全过滤 → 适龄化处理   │
                    └──────────────────────────────────┘
```

### 3.2 服务接口设计

#### 3.2.1 核心校验接口

```http
POST /api/v1/hallucination/verify
Content-Type: application/json
Authorization: Bearer {service_token}
```

**请求体：**
```json
{
  "messageId": "msg_20260524_abc123",
  "sessionId": "sess_xyz789",
  "userId": 100001,
  "subject": "math",
  "gradeLevel": "grade_9",
  "textContent": "根据勾股定理，在直角三角形中，两直角边的平方和等于斜边的平方。即 a² + b² = c²。例如，直角边为3和4时，斜边为 √(9+16) = √25 = 5。",
  "modelId": "zai/glm-5",
  "contextClaims": [],
  "options": {
    "strictMode": false,
    "maxLatencyMs": 800,
    "enableRegeneration": true
  }
}
```

**响应体：**
```json
{
  "reportId": "rpt_20260524_def456",
  "messageId": "msg_20260524_abc123",
  "riskLevel": "low",
  "action": "pass",
  "overallScore": 0.05,
  "claims": [
    {
      "claimId": "clm_001",
      "type": "mathematical",
      "text": "两直角边的平方和等于斜边的平方。即 a² + b² = c²",
      "verdict": "supported",
      "score": 0.02,
      "evidenceRef": "人教版-数学-九年级上-第24章-勾股定理"
    },
    {
      "claimId": "clm_002",
      "type": "mathematical",
      "text": "直角边为3和4时，斜边为 √(9+16) = √25 = 5",
      "verdict": "supported",
      "score": 0.01,
      "evidenceRef": "计算验证通过"
    }
  ],
  "latencyMs": 342,
  "detectorVersion": "v2.1.0"
}
```

#### 3.2.2 批量校验接口（用于离线回扫）

```http
POST /api/v1/hallucination/batch-verify
Content-Type: application/json
Authorization: Bearer {service_token}
```

```json
{
  "batchId": "batch_20260524_001",
  "items": [
    {
      "messageId": "msg_001",
      "textContent": "...",
      "subject": "physics",
      "gradeLevel": "grade_10"
    }
  ],
  "options": {
    "maxLatencyMs": 5000,
    "dryRun": false
  }
}
```

#### 3.2.3 用户反馈接口

```http
POST /api/v1/hallucination/feedback
Content-Type: application/json
Authorization: Bearer {user_token}
```

```json
{
  "claimId": "clm_001",
  "reportId": "rpt_20260524_def456",
  "feedback": "incorrect",
  "comment": "这个公式应该是 a²+b²=c² 而不是 a³+b³=c³",
  "correctText": "a² + b² = c²"
}
```

#### 3.2.4 幻觉统计查询接口

```http
GET /api/v1/hallucination/stats?startDate=2026-05-01&endDate=2026-05-24&subject=math&groupBy=day
Authorization: Bearer {admin_token}
```

**响应体：**
```json
{
  "period": { "start": "2026-05-01", "end": "2026-05-24" },
  "summary": {
    "totalChecks": 1582034,
    "hallucinationDetected": 12847,
    "detectionRate": 0.0081,
    "actionBreakdown": {
      "pass": 1555187,
      "pass_with_warning": 9876,
      "regenerate": 2341,
      "block_and_fallback": 630
    },
    "falsePositiveRate": 0.12,
    "avgLatencyMs": 287
  },
  "bySubject": {
    "math": { "detectionRate": 0.0062, "topErrorType": "procedural" },
    "physics": { "detectionRate": 0.0098, "topErrorType": "scientific" },
    "chinese": { "detectionRate": 0.0112, "topErrorType": "quotation" }
  },
  "dailyTrend": [
    { "date": "2026-05-01", "checks": 62345, "detected": 523, "rate": 0.0084 },
    { "date": "2026-05-02", "checks": 58901, "detected": 491, "rate": 0.0083 }
  ]
}
```

### 3.3 内部 gRPC 接口（服务间通信）

```protobuf
syntax = "proto3";
package primetop.hallucination.v1;

service HallucinationGuard {
  // 实时校验（同步，嵌入输出管线）
  rpc Verify (VerifyRequest) returns (VerifyResponse);
  
  // 异步校验（用于批量回扫）
  rpc BatchVerify (BatchVerifyRequest) returns (BatchVerifyResponse);
  
  // 查询已知幻觉模式
  rpc QueryPatterns (QueryPatternsRequest) returns (QueryPatternsResponse);
}

message VerifyRequest {
  string message_id = 1;
  string session_id = 2;
  int64 user_id = 3;
  string subject = 4;
  string grade_level = 5;
  string text_content = 6;
  string model_id = 7;
  int32 max_latency_ms = 8;
}

message VerifyResponse {
  string report_id = 1;
  string risk_level = 2;   // low/medium/high/critical
  string action = 3;        // pass/pass_with_warning/regenerate/block_and_fallback
  double overall_score = 4;
  repeated ClaimResult claims = 5;
  int32 latency_ms = 6;
}

message ClaimResult {
  string claim_id = 1;
  string type = 2;
  string text = 3;
  string verdict = 4;
  double score = 5;
  repeated string evidence_refs = 6;
}
```

---

## 4. 核心算法与处理流程

### 4.1 阶段一：声明提取（ClaimExtractor）

从 AI 输出中提取可验证的事实声明。

#### 4.1.1 提取策略

采用**规则引擎 + 轻量模型**双通道提取：

```
AI输出文本
    ├── 规则引擎通道（低延迟 ~50ms）
    │   ├── 数学公式提取（LaTeX/KaTeX 正则）
    │   ├── 数值计算结果提取
    │   ├── "定义是"/"指的是"/"等于" 等定义句式匹配
    │   ├── 引号内容提取（诗词引用）
    │   └── 年份/日期/人名 NER 提取
    │
    └── 轻量模型通道（~200ms，异步可选）
        ├── 基于 7B 级别小模型的声明边界识别
        ├── 步骤级拆分（理科解题步骤）
        └── 论点提取（文科论述）
```

#### 4.1.2 声明提取规则示例

```python
# 数学公式提取
MATH_PATTERNS = [
    r'\$([^\$]+)\$',                    # LaTeX inline
    r'\$\$([^\$]+)\$\$',                # LaTeX block
    r'([a-z]\s*[²³⁴⁵⁶⁷⁸⁹])',          # 上标
    r'(√\([^)]+\))',                    # 根号
    r'(\d+\s*[+\-×÷=]\s*\d+)',         # 简单运算
]

# 定义句式
DEFINITION_PATTERNS = [
    r'(.+?)是指(.+)',
    r'(.+?)的定义是(.+)',
    r'(.+?)，即(.+)',
    r'所谓(.+?)，就是(.+)',
    r'(.+?)叫做(.+)',
]

# 引用提取
QUOTATION_PATTERNS = [
    r'[""「」『』](.+?)[""「」『』]',     # 各类引号
    r'(.+?)在《(.+?)》中写道(.+)',
    r'(.+?)说过[""「](.+?)[""」]',
]
```

#### 4.1.3 关键代码示例

```typescript
// ClaimExtractor.ts
interface ExtractorConfig {
  maxLatencyMs: number;
  enableModelExtractor: boolean;
  minClaimLength: number;  // 最短声明长度，默认5字符
  maxClaimsPerMessage: number;  // 单条消息最大声明数，默认20
}

class ClaimExtractor {
  private ruleEngine: RuleEngine;
  private modelExtractor?: ModelExtractor;
  
  constructor(
    private readonly config: ExtractorConfig,
    private readonly logger: Logger
  ) {
    this.ruleEngine = new RuleEngine(PATTERNS);
    if (config.enableModelExtractor) {
      this.modelExtractor = new ModelExtractor('claim-extract-7b');
    }
  }

  async extract(text: string, subject: string): Promise<Claim[]> {
    const claims: Claim[] = [];
    const deadline = Date.now() + this.config.maxLatencyMs * 0.3; // 留70%时间给后续阶段

    // 1. 规则引擎提取（必走，低延迟）
    const ruleClaims = this.ruleEngine.extract(text, subject);
    claims.push(...ruleClaims);

    // 2. 模型提取（条件触发）
    if (this.modelExtractor && Date.now() < deadline) {
      try {
        const modelClaims = await this.modelExtractor.extract(
          text, subject, { timeoutMs: deadline - Date.now() }
        );
        // 合并去重
        for (const mc of modelClaims) {
          if (!this.isDuplicate(mc, claims)) {
            claims.push(mc);
          }
        }
      } catch (e) {
        this.logger.warn('Model extractor timeout, using rule results only', e);
      }
    }

    // 3. 过滤与排序
    return claims
      .filter(c => c.text.length >= this.config.minClaimLength)
      .slice(0, this.config.maxClaimsPerMessage);
  }

  private isDuplicate(claim: Claim, existing: Claim[]): boolean {
    return existing.some(e => 
      Math.abs(e.span[0] - claim.span[0]) < 10 ||
      this.similarity(e.text, claim.text) > 0.85
    );
  }
}
```

### 4.2 阶段二：证据检索（EvidenceRetriever）

从知识库中检索匹配证据，锚定教材事实。

#### 4.2.1 多源检索策略

```
声明文本
    ├── 向量语义检索
    │   ├── 教材知识点向量库 (Milvus/pgvector)
    │   ├── 题库解析向量库
    │   └── 课标考纲向量库
    │
    ├── 精确匹配检索
    │   ├── 公式精确匹配（LaTeX规范化后比对）
    │   ├── 诗词/文言文全文精确匹配
    │   ├── 化学方程式配平验证
    │   └── 历史年代/人名/地名精确匹配
    │
    └── 已知幻觉模式匹配
        ├── hallucination_pattern 表查询
        └── 常见错误模式黑名单
```

#### 4.2.2 学科特定校验器

每个学科有专门的校验器，提供确定性验证：

```typescript
// SubjectValidator.ts
interface SubjectValidator {
  subject: string;
  validate(claim: Claim): Promise<ValidationResult>;
}

interface ValidationResult {
  isValid: boolean;
  confidence: number;
  correctAnswer?: string;
  explanation?: string;
  reference?: TextbookReference;
}

// --- 数学验证器 ---
class MathValidator implements SubjectValidator {
  subject = 'math';
  
  async validate(claim: Claim): Promise<ValidationResult> {
    // 1. 提取公式和计算
    const formulas = extractMathFormulas(claim.text);
    const calculations = extractCalculations(claim.text);
    
    // 2. 公式正确性验证
    for (const formula of formulas) {
      const knownFormula = await this.formulaDB.lookup(formula.normalized);
      if (knownFormula && !formula.equals(knownFormula)) {
        return {
          isValid: false,
          confidence: 0.95,
          correctAnswer: knownFormula.canonical,
          explanation: `公式错误：${formula.raw} 应为 ${knownFormula.canonical}`,
          reference: knownFormula.reference
        };
      }
    }
    
    // 3. 数值计算验证
    for (const calc of calculations) {
      const expected = safeEval(calc.expression);
      if (expected !== null && Math.abs(expected - calc.result) > 1e-6) {
        return {
          isValid: false,
          confidence: 0.99,
          correctAnswer: `${calc.expression} = ${expected}`,
          explanation: `计算结果错误：${calc.result} 应为 ${expected}`
        };
      }
    }
    
    // 4. 几何定理验证
    // ... 定理前提条件检查
    
    return { isValid: true, confidence: 0.9 };
  }
}

// --- 语文验证器 ---
class ChineseValidator implements SubjectValidator {
  subject = 'chinese';
  
  async validate(claim: Claim): Promise<ValidationResult> {
    // 1. 诗词引用验证
    const poemQuotes = extractPoemQuotes(claim.text);
    for (const quote of poemQuotes) {
      const original = await this.poetryDB.exactMatch(quote.author, quote.title);
      if (original && original.content !== quote.text) {
        const diff = this.highlightDiff(quote.text, original.content);
        return {
          isValid: false,
          confidence: 0.95,
          correctAnswer: original.content,
          explanation: `引用错误：${diff}`,
          reference: { source: original.source, author: quote.author, title: quote.title }
        };
      }
    }
    
    // 2. 文学常识验证（作者、朝代、作品对应关系）
    const litFacts = extractLiteraryFacts(claim.text);
    for (const fact of litFacts) {
      const verified = await this.literatureKB.verify(fact);
      if (!verified.match) {
        return {
          isValid: false,
          confidence: 0.9,
          correctAnswer: verified.correct,
          explanation: verified.reason
        };
      }
    }
    
    return { isValid: true, confidence: 0.85 };
  }
}

// --- 化学验证器 ---
class ChemistryValidator implements SubjectValidator {
  subject = 'chemistry';
  
  async validate(claim: Claim): Promise<ValidationResult> {
    // 1. 化学方程式配平验证
    const equations = extractChemicalEquations(claim.text);
    for (const eq of equations) {
      const balanced = checkBalance(eq.reactants, eq.products);
      if (!balanced.isBalanced) {
        return {
          isValid: false,
          confidence: 0.98,
          correctAnswer: balanced.correctEquation,
          explanation: `方程式未配平：${balanced.reason}`
        };
      }
    }
    
    // 2. 元素符号、原子量等基本事实验证
    // 3. 反应条件验证
    return { isValid: true, confidence: 0.9 };
  }
}
```

#### 4.2.3 证据检索服务

```typescript
class EvidenceRetriever {
  constructor(
    private readonly vectorStore: VectorStoreClient,
    private readonly exactMatcher: ExactMatcher,
    private readonly patternDB: PatternRepository,
    private readonly subjectValidators: Map<string, SubjectValidator>,
    private readonly logger: Logger
  ) {}

  async retrieve(claim: Claim, context: VerifyContext): Promise<Evidence[]> {
    const evidences: Evidence[] = [];

    // 1. 学科特定确定性校验
    const validator = this.subjectValidators.get(context.subject);
    if (validator) {
      const result = await validator.validate(claim);
      if (!result.isValid && result.confidence > 0.8) {
        evidences.push({
          docId: `validator:${context.subject}`,
          sourceType: 'knowledge_point',
          snippet: result.correctAnswer || '',
          similarity: 1.0,
          stance: 'contradicts',
          reference: result.reference
        });
        // 确定性校验高置信度，直接返回
        return evidences;
      }
    }

    // 2. 向量语义检索
    const topK = 5;
    const vectorResults = await this.vectorStore.search({
      query: claim.text,
      subject: context.subject,
      gradeLevel: context.gradeLevel,
      topK,
      minScore: 0.7
    });
    
    for (const vr of vectorResults) {
      const stance = this.determineStance(claim.text, vr.snippet);
      evidences.push({
        docId: vr.docId,
        sourceType: vr.sourceType,
        snippet: vr.snippet,
        similarity: vr.score,
        stance,
        reference: vr.reference
      });
    }

    // 3. 已知幻觉模式匹配
    const patternMatch = await this.patternDB.findSimilar(
      claim.text, context.subject
    );
    if (patternMatch) {
      evidences.push({
        docId: `pattern:${patternMatch.id}`,
        sourceType: 'knowledge_point',
        snippet: patternMatch.correctText,
        similarity: patternMatch.similarity,
        stance: 'contradicts'
      });
    }

    return evidences;
  }

  private determineStance(claimText: string, evidenceSnippet: string): Evidence['stance'] {
    // 使用 NLI (Natural Language Inference) 模型判断证据与声明的关系
    // 简化版：基于语义相似度和关键词矛盾检测
    const similarity = cosineSimilarity(embed(claimText), embed(evidenceSnippet));
    
    if (similarity > 0.85) return 'supports';
    if (this.hasContradiction(claimText, evidenceSnippet)) return 'contradicts';
    return 'neutral';
  }
}
```

### 4.3 阶段三：真实性分类（VeracityClassifier）

综合所有证据，对每个声明做出最终判定。

#### 4.3.1 评分模型

```typescript
class VeracityClassifier {
  /**
   * 综合评分规则：
   * 
   * baseScore 初始值 = 0.5（不确定）
   * 
   * 证据调整：
   *   - 每个 supports 证据: -0.15 * evidence.similarity
   *   - 每个 contradicts 证据: +0.25 * evidence.similarity
   *   - 每个 neutral 证据: ±0
   * 
   * 学科验证器调整：
   *   - validator isValid=true: -0.3
   *   - validator isValid=false: +0.4
   * 
   * 已知模式调整：
   *   - 匹配已知幻觉模式: +0.35
   * 
   * 最终 score = clamp(0, 1, baseScore + adjustments)
   * 
   * 判定阈值：
   *   - score < 0.3 → supported
   *   - 0.3 ≤ score < 0.5 → partial
   *   - 0.5 ≤ score < 0.7 → unverifiable
   *   - score ≥ 0.7 → contradicted
   */
  
  classify(claim: Claim, evidences: Evidence[], validatorResult?: ValidationResult): {
    verdict: Verdict;
    hallucinationScore: number;
    confidence: number;
  } {
    let score = 0.5; // baseline: uncertain
    let confidence = 0.3;

    // Evidence adjustments
    for (const evidence of evidences) {
      switch (evidence.stance) {
        case 'supports':
          score -= 0.15 * evidence.similarity;
          confidence += 0.1;
          break;
        case 'contradicts':
          score += 0.25 * evidence.similarity;
          confidence += 0.15;
          break;
        case 'neutral':
          // no adjustment
          break;
      }
    }

    // Validator adjustments
    if (validatorResult) {
      if (validatorResult.isValid) {
        score -= 0.3;
        confidence += 0.2;
      } else {
        score += 0.4;
        confidence += 0.25;
      }
    }

    // Clamp
    score = Math.max(0, Math.min(1, score));
    confidence = Math.max(0, Math.min(1, confidence));

    // Verdict
    let verdict: Verdict;
    if (score < 0.3) verdict = 'supported';
    else if (score < 0.5) verdict = 'partial';
    else if (score < 0.7) verdict = 'unverifiable';
    else verdict = 'contradicted';

    return { verdict, hallucinationScore: score, confidence };
  }
}
```

### 4.4 阶段四：处置决策（ActionDecider）

根据所有声明的判定结果，决定最终处理动作。

#### 4.4.1 决策矩阵

```
                    │ 单条声明判定
                    ├──────────┬──────────┬────────────┬──────────────┤
                    │ supported │ partial  │ unverifiable│ contradicted │
   ─────────────────┼──────────┼──────────┼────────────┼──────────────┤
   声明数量=0       │   pass   │   pass   │    pass    │     pass     │
   所有声明supported │   pass   │    -     │     -      │      -       │
   存在partial      │    -     │ warning  │  warning   │   warning    │
   存在unverifiable │    -     │ warning  │  warning   │   warning    │
   存在1个contradicted│        │          │            │  regenerate │
   存在2+个contradicted│       │          │            │  block+fb   │
   关键声明contradicted│       │          │            │  block+fb   │
   ─────────────────┴──────────┴──────────┴────────────┴──────────────┘
   
   "关键声明" = 定义型/公式型/科学定律型 claim
```

#### 4.4.2 处置决策实现

```typescript
class ActionDecider {
  decide(report: Partial<VerificationReport>): {
    action: VerificationAction;
    riskLevel: VerificationReport['riskLevel'];
    reason: string;
  } {
    const claims = report.claims || [];
    
    // 无声明可验证 → 直接通过
    if (claims.length === 0) {
      return { action: 'pass', riskLevel: 'low', reason: 'no_verifiable_claims' };
    }

    const contradicted = claims.filter(c => c.verdict === 'contradicted');
    const partial = claims.filter(c => c.verdict === 'partial');
    const unverifiable = claims.filter(c => c.verdict === 'unverifiable');
    
    // 关键声明被反驳 → 拦截
    const criticalContradicted = contradicted.filter(c => 
      ['mathematical', 'scientific', 'definition'].includes(c.type)
    );
    
    if (criticalContradicted.length > 0) {
      return {
        action: 'block_and_fallback',
        riskLevel: 'critical',
        reason: `critical_claim_contradicted: ${criticalContradicted.map(c => c.claimId).join(',')}`
      };
    }
    
    // 多条声明被反驳 → 拦截
    if (contradicted.length >= 2) {
      return {
        action: 'block_and_fallback',
        riskLevel: 'high',
        reason: `multiple_contradicted: ${contradicted.length} claims`
      };
    }
    
    // 单条被反驳 → 重新生成
    if (contradicted.length === 1) {
      return {
        action: 'regenerate',
        riskLevel: 'high',
        reason: `single_contradicted: ${contradicted[0].claimId}`
      };
    }
    
    // 存在部分正确或无法验证 → 附加警告
    if (partial.length > 0 || unverifiable.length > 0) {
      return {
        action: 'pass_with_warning',
        riskLevel: 'medium',
        reason: `partial_or_unverifiable: ${partial.length + unverifiable.length} claims`
      };
    }
    
    // 全部通过
    return { action: 'pass', riskLevel: 'low', reason: 'all_supported' };
  }
}
```

---

## 5. 处置动作详细流程

### 5.1 pass（直接通过）

```
ActionDecider → pass
    → 原文正常输出
    → 异步写入 hallucination_detection_log（risk_level=low）
    → 无用户可见变化
```

### 5.2 pass_with_warning（附加风险提示）

```
ActionDecider → pass_with_warning
    → 原文正常输出
    → 在回答末尾追加提示卡片：
      "⚠️ 部分内容无法与教材完全匹配，建议对照课本核实"
    → 异步写入检测日志（risk_level=medium）
    → 异步触发人工审核队列（概率采样，约10%进入审核）
```

**客户端提示卡片渲染规范：**
```json
{
  "type": "hallucination_warning",
  "data": {
    "level": "info",
    "message": "部分内容无法与教材完全匹配",
    "actionText": "查看详情",
    "actionType": "expand_warning",
    "unverifiableClaims": [
      {
        "text": "...",
        "suggestion": "建议对照课本第X页核实"
      }
    ]
  }
}
```

### 5.3 regenerate（触发重新生成）

```
ActionDecider → regenerate
    → 阻止原文输出
    → 构造修正Prompt（包含错误声明和正确证据）
    → 调用LLM重新生成（最多重试2次）
    → 对重新生成的内容再次执行幻觉检测
    → 如果重试后仍然不通过 → 降级为 block_and_fallback
    → 如果重试通过 → 输出新内容
    → 写入检测日志（risk_level=high, action=regenerate）
```

**修正 Prompt 模板：**
```
[系统指令]
你之前的回答中存在事实性错误，以下是需要修正的内容：

{列出被反驳的声明及其正确信息}

请基于以上正确信息重新组织回答，确保所有事实陈述准确无误。
保持原有的讲解风格和教学方式，仅修正事实错误。

[原始问题]
{originalQuestion}

[错误声明]
{contradictedClaims}

[正确信息]
{correctEvidences}
```

### 5.4 block_and_fallback（拦截并返回兜底回答）

```
ActionDecider → block_and_fallback
    → 完全阻止原文输出
    → 返回预设兜底回答：
      "这个问题比较复杂，我暂时无法给出完全准确的回答。
       建议你向老师请教或查阅课本相关章节。"
    → 高优先级写入检测日志
    → 立即推送到人工审核队列
    → 触发告警通知（连续拦截超过阈值时）
```

**兜底回答按场景模板：**

```typescript
const FALLBACK_TEMPLATES: Record<string, string> = {
  math: "这道数学题的解答过程中可能存在计算或推导问题，建议你对照课本中的解题步骤，或向老师请教确认。",
  physics: "这个物理知识点涉及较多的推理过程，建议参考课本中的相关章节，或向老师请教以确保理解准确。",
  chemistry: "这道化学题的解答可能存在不够准确的地方，建议对照化学方程式和课本内容核实。",
  chinese: "关于这个语文知识点的回答可能存在不够准确的地方，建议查阅原文或向老师请教。",
  english: "这个英语知识点的回答可能不够准确，建议对照教材和词典核实。",
  history: "关于这个历史知识点的回答可能有需要核实的地方，建议查阅课本相关内容。",
  default: "这个问题比较复杂，我暂时无法给出完全准确的回答。建议你向老师请教或查阅课本相关章节。"
};
```

---

## 6. 异步回扫与离线处理

### 6.1 历史消息回扫

对已发出的 AI 回答进行离线回扫，发现潜在幻觉。

```typescript
// BatchScanJob.ts
interface BatchScanConfig {
  scanPeriodStart: Date;
  scanPeriodEnd: Date;
  subjects?: string[];
  gradeLevels?: string[];
  sampleRate: number;  // 采样率 0~1
  dryRun: boolean;
}

class BatchScanJob {
  async execute(config: BatchScanConfig): Promise<BatchScanResult> {
    // 1. 查询时间范围内的AI消息
    const messages = await this.messageRepo.query({
      periodStart: config.scanPeriodStart,
      periodEnd: config.scanPeriodEnd,
      subjects: config.subjects,
      gradeLevels: config.gradeLevels,
      sampleRate: config.sampleRate
    });

    const results: BatchScanResult = {
      total: messages.length,
      scanned: 0,
      hallucinationDetected: 0,
      newPatternsFound: 0,
      userNotificationsSent: 0
    };

    // 2. 批量校验
    for (const batch of chunk(messages, 50)) {
      const report = await this.hallucinationGuard.batchVerify({
        items: batch.map(m => ({
          messageId: m.id,
          textContent: m.content,
          subject: m.subject,
          gradeLevel: m.gradeLevel
        })),
        options: { maxLatencyMs: 5000, dryRun: config.dryRun }
      });

      for (const itemResult of report.results) {
        results.scanned++;
        
        if (itemResult.riskLevel === 'high' || itemResult.riskLevel === 'critical') {
          results.hallucinationDetected++;
          
          // 3. 发现新幻觉模式 → 写入模式库
          for (const claim of itemResult.claims.filter(c => c.verdict === 'contradicted')) {
            await this.patternRepo.addIfNew({
              incorrectText: claim.text,
              correctText: claim.evidences.find(e => e.stance === 'contradicts')?.snippet || '',
              subject: itemResult.subject,
              patternType: claim.type
            });
            results.newPatternsFound++;
          }

          // 4. 通知用户（严重幻觉）
          if (itemResult.riskLevel === 'critical' && !config.dryRun) {
            await this.notificationService.sendCorrection({
              userId: itemResult.userId,
              originalMessageId: itemResult.messageId,
              correctedInfo: '你之前收到的回答中存在事实性错误，已更正。'
            });
            results.userNotificationsSent++;
          }
        }
      }
    }

    return results;
  }
}
```

### 6.2 定时回扫调度

```yaml
# cron 配置
batch_scan_schedule:
  # 每日凌晨3点回扫前一天的全部消息（10%采样）
  - cron: "0 3 * * *"
    config:
      scanPeriodStart: "yesterday"
      scanPeriodEnd: "today"
      sampleRate: 0.1
      dryRun: false
    
  # 每周日凌晨2点全量回扫上周消息
  - cron: "0 2 * * 0"
    config:
      scanPeriodStart: "last_week_start"
      scanPeriodEnd: "last_week_end"
      sampleRate: 1.0
      dryRun: false
```

---

## 7. 幻觉模式库维护

### 7.1 模式入库流程

```
幻觉检测发现新错误
        ↓
生成 pattern_hash（内容去重）
        ↓
查重 → 已存在？→ 递增 occurrence_count
        ↓ 不存在
创建新 pattern 记录
        ↓
状态: active
```

### 7.2 模式匹配优化

```typescript
class PatternMatcher {
  /**
   * 匹配策略：
   * 1. 精确哈希匹配（最快）
   * 2. 模糊匹配（编辑距离 ≤ 3）
   * 3. 语义相似度匹配（≥ 0.85）
   * 
   * 匹配优先级：精确 > 模糊 > 语义
   */
  
  async match(claimText: string, subject: string): Promise<PatternMatch | null> {
    // 1. 精确匹配
    const hash = this.hash(claimText);
    const exact = await this.patternRepo.findByHash(hash, subject);
    if (exact) return { pattern: exact, matchType: 'exact', similarity: 1.0 };

    // 2. 模糊匹配（仅对短文本 < 100字符）
    if (claimText.length < 100) {
      const fuzzy = await this.patternRepo.fuzzySearch(claimText, subject, {
        maxEditDistance: 3,
        limit: 5
      });
      if (fuzzy.length > 0) {
        return { pattern: fuzzy[0], matchType: 'fuzzy', similarity: fuzzy[0].similarity };
      }
    }

    // 3. 语义匹配
    const embedding = await this.embed(claimText);
    const semantic = await this.patternRepo.vectorSearch(embedding, subject, {
      minSimilarity: 0.85,
      limit: 3
    });
    if (semantic.length > 0) {
      return { pattern: semantic[0], matchType: 'semantic', similarity: semantic[0].similarity };
    }

    return null;
  }

  private hash(text: string): string {
    // 规范化后哈希：去除空格、标点，统一全角/半角
    const normalized = text
      .replace(/[\s\.,;:!?，。；：！？、]/g, '')
      .replace(/[（(]/g, '(')
      .replace(/[）)]/g, ')')
      .toLowerCase();
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }
}
```

---

## 8. 监控与告警

### 8.1 核心指标

| 指标名 | 计算方式 | 告警阈值 |
| --- | --- | ---|
| `hallucination_detection_rate` | 检出幻觉数 / 总检测数 | > 2% 告警 |
| `hallucination_block_rate` | 拦截数 / 总检测数 | > 0.5% 告警 |
| `false_positive_rate` | 用户反馈正确的被拦截数 / 总拦截数 | > 20% 告警 |
| `detection_latency_p99` | 检测耗时 P99 | > 1000ms 告警 |
| `regeneration_success_rate` | 重生成后通过数 / 总重生成数 | < 60% 告警 |
| `consecutive_blocks` | 连续拦截次数（5分钟窗口） | > 10 次 P0 告警 |
| `pattern_growth_rate` | 新增幻觉模式数 / 天 | > 100 条/天 关注 |

### 8.2 监控看板

```
┌─────────────────────────────────────────────────────┐
│              幻觉检测实时看板                          │
├───────────────┬──────────────┬──────────────────────┤
│  今日检测总量   │  今日检出数   │  今日拦截数            │
│    64,523      │    487       │    31                │
│   ↑12%        │   ↓3%       │   ↓8%                │
├───────────────┴──────────────┴──────────────────────┤
│  [幻觉检出率趋势图 - 最近7天]                          │
│  0.8%│    ╭─╮                                        │
│  0.6%│ ╭──╯  ╰──╮                                    │
│  0.4%│╯         ╰─╮                                  │
│  0.2%│              ╰───                             │
│      └─────────────────── 周                         │
├─────────────────────────────────────────────────────┤
│  学科维度                                              │
│  数学: 0.42% ▓░░░░░░░░░░░░░                          │
│  物理: 0.68% ▓▓░░░░░░░░░░░░                          │
│  语文: 1.02% ▓▓▓▓░░░░░░░░░  ← 高于平均               │
│  英语: 0.55% ▓▓░░░░░░░░░░░░                          │
│  化学: 0.71% ▓▓▓░░░░░░░░░░░                          │
├─────────────────────────────────────────────────────┤
│  处置分布          延迟分布                             │
│  pass:    97.8%   P50: 234ms                         │
│  warning:  1.5%   P95: 612ms                         │
│  regen:    0.5%   P99: 823ms                         │
│  block:    0.2%                                        │
└─────────────────────────────────────────────────────┘
```

### 8.3 告警规则

```yaml
alerts:
  - name: hallucination_rate_spike
    condition: "hallucination_detection_rate > 0.02 for 15m"
    severity: warning
    channels: [slack, email]
    message: "AI幻觉检出率超过2%，当前值: {{.value}}"
    
  - name: consecutive_block_critical
    condition: "consecutive_blocks > 10 in 5m"
    severity: critical
    channels: [slack, email, phone]
    message: "5分钟内连续拦截{{.value}}次，可能存在模型严重异常"
    
  - name: detection_latency_degraded
    condition: "detection_latency_p99 > 1500 for 10m"
    severity: warning
    channels: [slack]
    message: "幻觉检测P99延迟升高至{{.value}}ms"
    
  - name: false_positive_high
    condition: "false_positive_rate > 0.20 for 1h"
    severity: warning
    channels: [slack]
    message: "幻觉检测误报率达到{{.value}}，需要校准阈值"
```

---

## 9. 性能设计

### 9.1 延迟预算

整个幻觉检测嵌入 AI 输出管线，总预算 **≤ 800ms**：

| 阶段 | 预算 | 占比 |
| --- | --- | --- |
| 声明提取（规则引擎） | ≤ 50ms | 6% |
| 证据检索（向量+精确） | ≤ 400ms | 50% |
| 真实性分类 | ≤ 50ms | 6% |
| 处置决策 | ≤ 10ms | 1% |
| 数据写入（异步） | 0ms（异步） | 0% |
| **总同步延迟** | **≤ 510ms** | **~64%** |
| 留余量 | 290ms | 36% |

### 9.2 优化策略

#### 9.2.1 分级检测

```typescript
// 根据场景和风险等级决定检测深度
const DETECTION_LEVELS: Record<string, DetectionConfig> = {
  // 简单问答（低风险）：仅规则引擎 + 公式验证
  simple_qa: {
    enableModelExtractor: false,
    vectorSearchTopK: 2,
    maxLatencyMs: 300,
    skipSubjects: ['chinese'] // 语文简单问答跳过深度检测
  },
  
  // 理科解题（高风险）：全流程检测
  stem_solving: {
    enableModelExtractor: true,
    vectorSearchTopK: 5,
    maxLatencyMs: 800,
    skipSubjects: []
  },
  
  // 文科背诵（中风险）：重点关注引用准确性
  recitation: {
    enableModelExtractor: false,
    vectorSearchTopK: 3,
    maxLatencyMs: 500,
    skipSubjects: [],
    focusClaimTypes: ['quotation']
  }
};
```

#### 9.2.2 缓存策略

```typescript
class HallucinationCache {
  // L1: 进程内缓存 (LRU, 1000条)
  // 相同或高度相似的问题+回答，直接返回缓存结果
  private l1Cache: LRUCache<string, VerificationReport>;
  
  // L2: Redis缓存 (TTL 1小时)
  // 按消息ID缓存，避免重复检测
  private l2Cache: RedisCache;
  
  async getOrDetect(
    messageKey: string,
    detectFn: () => Promise<VerificationReport>
  ): Promise<VerificationReport> {
    // L1
    const l1 = this.l1Cache.get(messageKey);
    if (l1) return l1;
    
    // L2
    const l2 = await this.l2Cache.get(`hallucination:${messageKey}`);
    if (l2) {
      this.l1Cache.set(messageKey, l2);
      return l2;
    }
    
    // 检测
    const report = await detectFn();
    
    // 写入缓存
    this.l1Cache.set(messageKey, report);
    await this.l2Cache.set(`hallucination:${messageKey}`, report, 3600);
    
    return report;
  }
}
```

#### 9.2.3 并行处理

```
声明提取完成 → N个声明并行检索证据
                    ↓
              ┌─────┼─────┐
              ↓     ↓     ↓
           Claim1  Claim2  Claim3    ← 并行检索
              ↓     ↓     ↓
              └─────┼─────┘
                    ↓
              汇总评分 → 处置决策
```

---

## 10. 错误处理与降级

### 10.1 错误处理矩阵

| 异常场景 | 处理策略 | 用户感知 |
| --- | --- | --- |
| 检测服务超时 | 返回 `pass`，异步补检 | 无感知（正常输出） |
| 知识库不可用 | 仅走规则引擎+学科验证器 | 无感知 |
| 向量检索失败 | 降级为精确匹配 | 无感知 |
| 模型提取超时 | 仅使用规则引擎结果 | 无感知 |
| 重生成连续失败（≥2次） | 降级为 block_and_fallback | 看到兜底回答 |
| 检测服务完全宕机 | 熔断器打开，所有消息 pass | 无感知（服务降级） |

### 10.2 熔断器配置

```typescript
const CIRCUIT_BREAKER_CONFIG = {
  // 连续5次检测失败 → 打开熔断器
  failureThreshold: 5,
  // 熔断器打开后，所有请求直接 pass（降级）
  openStateAction: 'pass' as const,
  // 30秒后半开，放行1个请求测试
  halfOpenAfter: 30_000,
  // 半开状态下成功1次 → 关闭熔断器
  successThreshold: 1,
};
```

### 10.3 降级链路

```
正常链路:
  声明提取(规则+模型) → 证据检索(向量+精确+模式) → 分类 → 决策

降级1 (知识库不可用):
  声明提取(规则) → 学科验证器(确定性校验) → 分类 → 决策

降级2 (检测服务部分超时):
  声明提取(规则) → 精确匹配 → 分类 → 决策

降级3 (检测服务完全不可用):
  熔断器打开 → 直接 pass → 异步队列补检
```

---

## 11. 安全与权限

### 11.1 接口权限

| 接口 | 调用方 | 权限要求 |
| --- | --- | --- |
| `/verify` | AI输出管线（内部服务） | service_token |
| `/batch-verify` | 定时任务/运维 | admin_token |
| `/feedback` | 客户端（学生/家长） | user_token |
| `/stats` | 运营后台 | admin_token |
| `/patterns` | 内容审核后台 | admin_token |

### 11.2 数据安全

- 检测日志中的原文内容按 AI 对话数据同等安全等级存储
- 用户反馈数据脱敏后进入人工审核流程
- 幻觉模式库不包含用户原始输入，仅存储结构化错误模式
- 批量回扫结果不向学生暴露其他用户数据

---

## 12. 部署与配置

### 12.1 服务部署

```yaml
# docker-compose.yml 片段
hallucination-guard:
  image: primetop/hallucination-guard:v2.1.0
  replicas: 4
  resources:
    cpu: "2"
    memory: "4Gi"
  env:
    - VECTOR_STORE_URL=milvus:19530
    - REDIS_URL=redis:6379
    - DB_URL=mysql:3306/primetop
    - PATTERN_DB_URL=mysql:3306/primetop
    - LOG_LEVEL=info
    - MAX_LATENCY_MS=800
    - CIRCUIT_BREAKER_ENABLED=true
  healthcheck:
    test: ["CMD", "grpc_health_probe", "-addr=:9090"]
    interval: 10s
    timeout: 5s
    retries: 3
```

### 12.2 关键配置项

```typescript
interface HallucinationGuardConfig {
  /** 总体开关 */
  enabled: boolean;
  
  /** 检测延迟预算(ms) */
  maxLatencyMs: number;
  
  /** 检测级别: simple/standard/thorough */
  defaultDetectionLevel: 'simple' | 'standard' | 'thorough';
  
  /** 触发重新生成的幻觉评分阈值 */
  regenerateThreshold: number;  // 默认 0.7
  
  /** 触发拦截的幻觉评分阈值 */
  blockThreshold: number;  // 默认 0.85
  
  /** 最大重生成次数 */
  maxRegenerateAttempts: number;  // 默认 2
  
  /** 熔断器配置 */
  circuitBreaker: {
    enabled: boolean;
    failureThreshold: number;
    halfOpenAfterMs: number;
  };
  
  /** 异步补检配置 */
  asyncReview: {
    enabled: boolean;
    sampleRate: number;  // 通过的消息采样补检比例
  };
  
  /** 人工审核队列 */
  manualReview: {
    enabled: boolean;
    autoQueueOnBlock: boolean;  // 拦截时自动入审核队列
    samplingRate: number;  // warning 消息的审核采样率
  };
}
```

---

## 13. 与其他系统的集成

### 13.1 集成点一览

| 集成系统 | 集成方式 | 说明 |
| --- | --- | --- |
| **AI 输出管线** | 同步调用（gRPC） | 嵌入 SSE 推送前 |
| **RAG 知识库** | 异步检索（向量+精确） | 获取事实证据 |
| **AI输出质量校验引擎** | 结果共享 | 互补验证 |
| **安全与内容合规系统** | 串联（本引擎在前） | 事实性→安全性 |
| **用户反馈系统** | 接收反馈 | 用户标记错误回答 |
| **通知中心** | 事件推送 | 严重幻觉用户通知 |
| **数据埋点系统** | 指标上报 | 监控看板数据源 |
| **内容管理后台** | 管理界面 | 幻觉模式管理、审核队列 |
| **日志监控体系** | 日志 + 告警 | 运维可观测性 |

### 13.2 输出管线集成时序

```
时序图:

用户提问 → [Prompt编排] → [RAG检索] → [LLM生成]
                                              │
                                              ▼
                                    [本引擎: 幻觉检测]
                                       │        │
                                    pass      regenerate
                                       │        │
                                       ▼        ▼
                              [安全过滤]     [LLM重生成]
                                       │        │
                                       ▼        ▼
                              [适龄化处理] → [幻觉检测(二次)]
                                       │              │
                                       ▼            pass/regen/block
                              [SSE推送] ←────────────┘
                                       │
                                       ▼
                                    用户看到回答
```

---

## 14. 版本规划

| 版本 | 范围 | 目标时间 |
| --- | --- | --- |
| **v1.0** | 规则引擎提取 + 数学/化学确定性校验 + 精确匹配 + 基础向量检索 | MVP 后 4 周 |
| **v1.5** | 增加语文/英语/物理学科校验器 + 模式库 + 用户反馈闭环 | v1.0 后 3 周 |
| **v2.0** | 轻量模型声明提取 + NLI立场判断 + 批量回扫 + 完整监控看板 | v1.5 后 4 周 |
| **v2.5** | 自适应阈值 + 学科特定评分模型优化 + 跨版本教材验证 | v2.0 后 4 周 |

---

## 附录 A: 数学公式验证示例

```
输入声明: "根据勾股定理，a² + b² = c³"

Step 1 - 公式提取:
  提取到公式: a² + b² = c³
  类型: mathematical

Step 2 - 公式规范化:
  规范化形式: a^2 + b^2 = c^3

Step 3 - 已知公式库匹配:
  查询: 勾股定理
  匹配到: a^2 + b^2 = c^2 (人教版-数学-九年级上-第24章)

Step 4 - 对比:
  声明: a^2 + b^2 = c^3
  正确: a^2 + b^2 = c^2
  差异: 右侧 c^3 vs c^2

Step 5 - 判定:
  verdict: contradicted
  score: 0.92
  confidence: 0.98
  correctAnswer: a² + b² = c²

处置: block_and_fallback (关键数学公式错误)
```

## 附录 B: 诗词引用验证示例

```
输入声明: "李白在《静夜思》中写道：'床前明月光，疑是地上霜。举头望明月，低头思故乡。'"

Step 1 - 引用提取:
  作者: 李白
  作品: 静夜思
  引用内容: 床前明月光，疑是地上霜。举头望明月，低头思故乡。

Step 2 - 诗词库精确匹配:
  查询: 李白《静夜思》
  原文: 床前明月光，疑是地上霜。举头望明月，低头思故乡。

Step 3 - 对比:
  完全一致 ✓

Step 4 - 判定:
  verdict: supported
  score: 0.02
  confidence: 0.99
```

## 附录 C: 化学方程式验证示例

```
输入声明: "铁在氧气中燃烧：2Fe + O₂ → Fe₂O₃"

Step 1 - 方程式提取:
  反应物: 2Fe + O₂
  生成物: Fe₂O₃

Step 2 - 配平验证:
  左侧 Fe: 2, O: 2
  右侧 Fe: 2, O: 3
  O 原子不守恒 (左2 ≠ 右3)

Step 3 - 正确方程式:
  3Fe + 2O₂ → Fe₃O₄ (铁在氧气中燃烧生成四氧化三铁)
  或
  4Fe + 3O₂ → 2Fe₂O₃ (生成三氧化二铁)

Step 4 - 判定:
  verdict: contradicted
  score: 0.88
  confidence: 0.95
  correctAnswer: "3Fe + 2O₂ → Fe₃O₄ (铁在氧气中燃烧生成四氧化三铁)"

处置: block_and_fallback
```
