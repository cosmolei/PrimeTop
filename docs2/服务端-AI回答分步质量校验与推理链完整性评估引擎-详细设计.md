# AI 回答分步质量校验与推理链完整性评估引擎 — 详细设计

## 1. 概述

### 1.1 模块定位

本模块是 AI 能力层的**推理质量守卫**，专注于对 AI 生成的多步推理过程进行**逐步校验**，而非仅检查最终答案的正确性。与现有的 `AI 输出质量校验与多模型复核引擎`（聚焦最终输出校验）和 `AI 幻觉检测与教育事实校验引擎`（聚焦事实性幻觉检测）形成互补——本引擎将校验粒度下沉到**每一个推理步骤**，能够在多步解题过程中精确定位哪一步出了错、缺了哪一步、哪一步逻辑不连贯。

### 1.2 问题背景

教育场景下，AI 回答的质量问题往往不在最终答案，而在中间过程：

| 问题类型 | 示例 | 危害 |
| --- | --- | --- |
| 中间步骤计算错误 | 第 3 步 `-2 × 3 = 5`（应为 -6） | 后续步骤全错，学生被误导 |
| 跳步 | 从条件直接到结论，缺少关键推导 | 学生无法理解，降低学习效果 |
| 逻辑断裂 | 前一步说"因此"，但前后无因果关系 | 学生产生认知混乱 |
| 方法不一致 | 教材教的是配方法，AI 用了公式法 | 偏离课标要求，增加学习负担 |
| 公式误用 | 力学题中用错受力分析方向 | 知识点误植，影响长期理解 |
| 单位遗漏/不一致 | 中间步骤漏写单位或单位换算错误 | 理科严谨性下降 |

传统整体验证只能判断"答案对不对"，无法发现这些**过程性缺陷**。本引擎通过对推理链的精细化拆解与逐步校验，解决这一核心痛点。

### 1.3 核心职责

| 职责 | 说明 |
| --- | --- |
| 推理链拆解 | 将 AI 生成的自然语言回答解析为有序推理步骤序列 |
| 逐步校验 | 对每个步骤进行数学正确性、逻辑一致性、事实准确性检查 |
| 完整性检测 | 检测是否存在跳步、关键步骤缺失、逻辑断裂 |
| 课标对齐校验 | 检查推理方法是否符合学生所在学段的课标要求 |
| 置信度评分 | 为每个步骤和整体推理链生成置信度分数 |
| 定向重试 | 当某步骤校验失败时，仅重新生成该步骤及后续内容 |
| 质量画像 | 按学科/知识点/题型统计推理质量分布，反馈给 Prompt 优化 |

### 1.4 依赖关系

```
┌──────────────────────────────────────────────────────────┐
│        AI 回答分步质量校验与推理链完整性评估引擎            │
├──────────────┬────────────────┬──────────────────────────┤
│   依赖上游     │   依赖内部      │      依赖下游             │
├──────────────┼────────────────┼──────────────────────────┤
│ SSE 流式响应  │ Redis 集群     │ AI 对话引擎（重试决策）    │
│ 引擎          │ PostgreSQL     │ AI 辅导全链路请求编排      │
│ 大模型 API    │ 消息队列 (MQ)   │ Prompt 版本管理系统        │
│ AI-Prompt    │ 对象存储       │ AI 回答质量监控            │
│ 编排系统      │                │ 用户反馈与 AI 质量评估      │
│ 知识点体系    │                │ AI 模型评测基准            │
│ 教材映射引擎  │                │ 内容安全审核管线           │
│ RAG 检索系统  │                │                            │
└──────────────┴────────────────┴──────────────────────────┘
```

### 1.5 设计目标

1. **过程可审计**：每一道多步推理题的每个步骤都有独立的校验记录
2. **错误可定位**：精确到步骤级别的错误定位，而非笼统的"回答不正确"
3. **反馈可闭环**：校验结果自动反馈到 Prompt 优化和模型选择流程
4. **性能可接受**：校验过程不显著增加用户等待时间（流式校验 + 后台深度校验分层）
5. **覆盖可扩展**：支持数学、物理、化学、生物等理科学科逐步扩展

---

## 2. 核心概念

### 2.1 推理链模型

```
ReasoningChain (推理链)
  ├── Step 1: 条件提取与问题理解
  │     ├── type: CONDITION_EXTRACTION
  │     ├── content: "已知 x² + 2x - 3 = 0，求 x"
  │     ├── dependencies: []
  │     └── verification: ✅
  │
  ├── Step 2: 解题方法选择
  │     ├── type: METHOD_SELECTION
  │     ├── content: "使用配方法：x² + 2x = 3"
  │     ├── dependencies: [Step 1]
  │     └── verification: ✅
  │
  ├── Step 3: 中间推导
  │     ├── type: DERIVATION
  │     ├── content: "x² + 2x + 1 = 3 + 1 = 4"
  │     ├── dependencies: [Step 2]
  │     └── verification: ✅
  │
  ├── Step 4: 因式分解/开方
  │     ├── type: TRANSFORMATION
  │     ├── content: "(x + 1)² = 4"
  │     ├── dependencies: [Step 3]
  │     └── verification: ✅
  │
  ├── Step 5: 最终求解
  │     ├── type: SOLUTION
  │     ├── content: "x + 1 = ±2，所以 x₁ = 1, x₂ = -3"
  │     ├── dependencies: [Step 4]
  │     └── verification: ✅
  │
  └── Step 6: 验证与总结
        ├── type: VERIFICATION_SUMMARY
        ├── content: "代入检验：1²+2×1-3=0 ✓，(-3)²+2×(-3)-3=0 ✓"
        ├── dependencies: [Step 5, Step 1]
        └── verification: ✅
```

### 2.2 步骤类型枚举

```typescript
enum ReasoningStepType {
  /** 条件提取：从题目中提取已知条件和求解目标 */
  CONDITION_EXTRACTION = 'CONDITION_EXTRACTION',

  /** 方法选择：确定解题策略和方法 */
  METHOD_SELECTION = 'METHOD_SELECTION',

  /** 公式应用：套用数学/物理/化学公式 */
  FORMULA_APPLICATION = 'FORMULA_APPLICATION',

  /** 推导变换：代数变形、等价转换、逻辑推导 */
  DERIVATION = 'DERIVATION',

  /** 计算求解：数值计算、方程求解 */
  CALCULATION = 'CALCULATION',

  /** 图形分析：几何图形性质应用、受力分析 */
  GRAPHICAL_ANALYSIS = 'GRAPHICAL_ANALYSIS',

  /** 形式转换：如配方、因式分解、单位换算 */
  TRANSFORMATION = 'TRANSFORMATION',

  /** 最终答案：给出结论 */
  SOLUTION = 'SOLUTION',

  /** 验证总结：代回检验、方法总结 */
  VERIFICATION_SUMMARY = 'VERIFICATION_SUMMARY',

  /** 概念解释：知识点讲解（非计算步骤） */
  EXPLANATION = 'EXPLANATION',
}
```

### 2.3 校验结果等级

| 等级 | 含义 | 处理策略 |
| --- | --- | --- |
| `PASS` | 步骤正确，逻辑连贯 | 正常展示 |
| `WARN` | 存在轻微问题（如表述不严谨），不影响正确性 | 正常展示，后台记录 |
| `FAIL` | 步骤存在错误（计算错误、逻辑断裂） | 触发定向重试 |
| `SKIP` | 检测到跳步，缺少关键中间步骤 | 触发补充生成 |
| `BLOCK` | 步骤无法校验（超出校验能力范围） | 标记为"未经校验"，降级到整体验证 |

### 2.4 生命周期状态机

```
┌─────────────┐
│  PENDING    │  ← 推理链已拆解，等待校验
└──────┬──────┘
       │ 开始校验
       ▼
┌─────────────┐
│ VERIFYING   │  ← 逐步校验中
└──────┬──────┘
       │
       ├── 全部通过 ──────► ┌─────────────┐
       │                    │   PASSED     │
       │                    └─────────────┘
       │
       ├── 存在 WARN ──────► ┌─────────────┐
       │                    │ PASSED_WARN  │
       │                    └─────────────┘
       │
       ├── 存在 FAIL ──────► ┌─────────────┐
       │                    │  RETRYING    │  ← 触发定向重试
       │                    └──────┬───────┘
       │                           │ 重试完成
       │                           ▼
       │                    ┌─────────────┐
       │                    │  REVERIFIED  │
       │                    └─────────────┘
       │
       └── 重试超限/无法修复 ► ┌─────────────┐
                              │   FAILED     │  ← 降级处理
                              └─────────────┘
```

---

## 3. 数据模型

### 3.1 核心实体关系

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ ReasoningChain  │1---*│ ReasoningStep    │1---1│ StepVerification    │
│ (推理链)         │     │ (推理步骤)        │     │ (步骤校验记录)       │
└────────┬────────┘     └──────────────────┘     └─────────────────────┘
         │
         │1
         │
         │*
┌────────┴────────┐     ┌──────────────────┐
│ ChainSummary    │     │ RetryRecord      │
│ (链级汇总评估)    │     │ (重试记录)        │
└─────────────────┘     └──────────────────┘
```

### 3.2 数据库表结构

#### 3.2.1 reasoning_chains（推理链表）

```sql
CREATE TABLE reasoning_chains (
    id              BIGINT PRIMARY KEY,
    chain_uuid      VARCHAR(64) NOT NULL UNIQUE COMMENT '推理链唯一标识',
    
    -- 关联信息
    conversation_id BIGINT NOT NULL COMMENT 'AI对话记录ID',
    message_id      BIGINT NOT NULL COMMENT 'AI消息ID',
    user_id         BIGINT NOT NULL COMMENT '用户ID',
    
    -- 学科与知识点上下文
    subject         VARCHAR(20) NOT NULL COMMENT '学科: MATH/PHYSICS/CHEMISTRY/BIOLOGY',
    grade_level     VARCHAR(20) NOT NULL COMMENT '学段: PRIMARY/JUNIOR/SENIOR',
    knowledge_point_ids JSON COMMENT '关联知识点ID列表',
    question_type   VARCHAR(30) COMMENT '题型: SINGLE_CHOICE/MULTI_CHOICE/FILL_BLANK/SHORT_ANSDER/PROOF/CALCULATION',
    
    -- 推理链元信息
    step_count      INT NOT NULL DEFAULT 0 COMMENT '步骤总数',
    model_id        VARCHAR(50) NOT NULL COMMENT '生成模型标识',
    prompt_version  VARCHAR(30) COMMENT 'Prompt版本号',
    
    -- 校验状态
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/VERIFYING/PASSED/PASSED_WARN/RETRYING/REVERIFIED/FAILED',
    overall_score   DECIMAL(5,2) COMMENT '整体置信度评分 0-100',
    has_step_error  BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否存在步骤级错误',
    has_skip        BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否存在跳步',
    retry_count     INT NOT NULL DEFAULT DEFAULT 0 COMMENT '重试次数',
    
    -- 时间信息
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    verification_completed_at TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- 索引
    INDEX idx_conversation (conversation_id),
    INDEX idx_user_subject (user_id, subject),
    INDEX idx_status (status),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI回答推理链记录';
```

#### 3.2.2 reasoning_steps（推理步骤表）

```sql
CREATE TABLE reasoning_steps (
    id              BIGINT PRIMARY KEY,
    chain_id        BIGINT NOT NULL COMMENT '推理链ID',
    step_index      INT NOT NULL COMMENT '步骤序号(从1开始)',
    
    -- 步骤内容
    step_type       VARCHAR(30) NOT NULL COMMENT '步骤类型',
    content         TEXT NOT NULL COMMENT '步骤原始文本',
    content_struct  JSON COMMENT '结构化内容(公式LaTeX/数学表达式/逻辑关系)',
    
    -- 依赖关系
    depends_on      JSON COMMENT '依赖的前置步骤序号列表',
    
    -- 提取的元数据
    formulas_used   JSON COMMENT '使用的公式列表',
    concepts_ref    JSON COMMENT '涉及的知识概念',
    calculations    JSON COMMENT '计算过程记录 [{expression, result}]',
    
    -- 流式位置（用于实时校验定位）
    stream_start_pos INT COMMENT '在流式输出中的起始字符位置',
    stream_end_pos   INT COMMENT '在流式输出中的结束字符位置',
    
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_chain (chain_id),
    INDEX idx_chain_step (chain_id, step_index),
    
    FOREIGN KEY (chain_id) REFERENCES reasoning_chains(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='推理步骤明细';
```

#### 3.2.3 step_verifications（步骤校验记录表）

```sql
CREATE TABLE step_verifications (
    id              BIGINT PRIMARY KEY,
    chain_id        BIGINT NOT NULL COMMENT '推理链ID',
    step_index      INT NOT NULL COMMENT '步骤序号',
    verification_round INT NOT NULL DEFAULT 1 COMMENT '校验轮次(重试后递增)',
    
    -- 校验结果
    result_level    VARCHAR(10) NOT NULL COMMENT 'PASS/WARN/FAIL/SKIP/BLOCK',
    confidence_score DECIMAL(5,2) NOT NULL COMMENT '置信度 0-100',
    
    -- 校验维度明细
    math_correct    BOOLEAN COMMENT '数学计算是否正确',
    logic_consistent BOOLEAN COMMENT '逻辑是否一致',
    formula_correct BOOLEAN COMMENT '公式使用是否正确',
    method_aligned  BOOLEAN COMMENT '方法是否与课标对齐',
    unit_correct    BOOLEAN COMMENT '单位是否正确',
    
    -- 错误详情
    error_type      VARCHAR(40) COMMENT '错误类型',
    error_detail    TEXT COMMENT '错误描述',
    error_position  JSON COMMENT '错误位置 {start, end, snippet}',
    expected_value  TEXT COMMENT '期望的正确值/表达式',
    actual_value    TEXT COMMENT '实际的错误值/表达式',
    
    -- 校验方式
    verified_by     VARCHAR(20) NOT NULL COMMENT 'RULE_BASED/MODEL_BASED/SYMBOLIC_ENGINE/HYBRID',
    verifier_model  VARCHAR(50) COMMENT '校验模型标识(如使用模型校验)',
    verification_latency_ms INT COMMENT '校验耗时(毫秒)',
    
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_chain_step (chain_id, step_index),
    INDEX idx_result (result_level),
    
    FOREIGN KEY (chain_id) REFERENCES reasoning_chains(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='步骤校验记录';
```

#### 3.2.4 chain_retry_records（重试记录表）

```sql
CREATE TABLE chain_retry_records (
    id              BIGINT PRIMARY KEY,
    chain_id        BIGINT NOT NULL COMMENT '推理链ID',
    retry_round     INT NOT NULL COMMENT '重试轮次',
    
    -- 重试范围
    retry_from_step INT NOT NULL COMMENT '从第几步开始重试',
    retry_to_step   INT COMMENT '重试到第几步(空表示到最后)',
    retry_reason    VARCHAR(40) NOT NULL COMMENT 'CALCULATION_ERROR/LOGIC_BREAK/METHOD_MISMATCH/SKIP_DETECTED',
    
    -- 重试策略
    strategy        VARCHAR(20) NOT NULL COMMENT 'PARTIAL_REGEN/FULL_REGEN/METHOD_SWITCH',
    prompt_adjust   TEXT COMMENT 'Prompt调整内容',
    model_switch    VARCHAR(50) COMMENT '切换到的模型(如有)',
    
    -- 重试结果
    original_score  DECIMAL(5,2) COMMENT '原始评分',
    retry_score     DECIMAL(5,2) COMMENT '重试后评分',
    improved        BOOLEAN COMMENT '是否改善',
    
    latency_ms      INT COMMENT '重试耗时(毫秒)',
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_chain (chain_id),
    
    FOREIGN KEY (chain_id) REFERENCES reasoning_chains(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='推理链重试记录';
```

#### 3.2.5 reasoning_quality_profile（推理质量画像表）

```sql
CREATE TABLE reasoning_quality_profile (
    id              BIGINT PRIMARY KEY,
    
    -- 维度键
    model_id        VARCHAR(50) NOT NULL COMMENT '模型标识',
    subject         VARCHAR(20) NOT NULL COMMENT '学科',
    grade_level     VARCHAR(20) NOT NULL COMMENT '学段',
    knowledge_area  VARCHAR(50) NOT NULL COMMENT '知识领域(如:代数/几何/力学/电学)',
    
    -- 统计指标
    total_chains    INT NOT NULL DEFAULT 0 COMMENT '推理链总数',
    pass_rate       DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT '通过率%',
    avg_score       DECIMAL(5,2) COMMENT '平均置信度',
    avg_step_count  DECIMAL(5,1) COMMENT '平均步骤数',
    skip_rate       DECIMAL(5,2) COMMENT '跳步率%',
    common_errors   JSON COMMENT '常见错误类型统计 [{type, count, rate}]',
    
    -- 时间窗口
    stat_period     VARCHAR(10) NOT NULL COMMENT '统计周期: DAILY/WEEKLY/MONTHLY',
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_profile (model_id, subject, grade_level, knowledge_area, stat_period, period_start),
    INDEX idx_model_subject (model_id, subject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='推理质量统计画像';
```

### 3.3 缓存策略

| 缓存项 | Redis Key 格式 | TTL | 说明 |
| --- | --- | --- | --- |
| 推理链校验状态 | `rc:status:{chainUuid}` | 24h | 校验状态快速查询 |
| 步骤校验结果 | `rc:step:{chainId}:{stepIndex}` | 24h | 单步校验结果缓存 |
| 常见题型校验模板 | `rc:template:{subject}:{questionType}` | 7d | 校验规则模板缓存 |
| 模型质量画像 | `rc:profile:{modelId}:{subject}` | 1h | 质量画像缓存（短TTL保证时效性） |
| 符号计算结果 | `rc:symbolic:{hash(expression)}` | 7d | 数学表达式计算结果缓存 |

---

## 4. API 接口设计

### 4.1 接口总览

| 接口 | 方法 | 路径 | 说明 |
| --- | --- | --- | --- |
| 提交推理链校验 | POST | `/api/v1/reasoning/verify` | 提交 AI 回答进行分步校验 |
| 查询校验结果 | GET | `/api/v1/reasoning/{chainUuid}` | 获取推理链校验详情 |
| 流式校验回调 | POST | `/api/v1/reasoning/verify/stream` | SSE 流式校验（实时反馈） |
| 触发定向重试 | POST | `/api/v1/reasoning/{chainUuid}/retry` | 对失败步骤触发重试 |
| 批量校验提交 | POST | `/api/v1/reasoning/verify/batch` | 批量提交（离线场景） |
| 质量画像查询 | GET | `/api/v1/reasoning/profile` | 查询模型推理质量统计 |
| 错误模式分析 | GET | `/api/v1/reasoning/errors/analysis` | 错误类型聚合分析 |

### 4.2 提交推理链校验

```
POST /api/v1/reasoning/verify
```

**请求体：**

```json
{
  "conversationId": 123456789,
  "messageId": 987654321,
  "userId": 100001,
  "subject": "MATH",
  "gradeLevel": "SENIOR",
  "questionType": "CALCULATION",
  "knowledgePointIds": ["kp_math_alg_quadratic", "kp_math_alg_factoring"],
  "modelId": "gpt-4-turbo",
  "promptVersion": "1.3.0",
  "answerContent": "已知 x² + 2x - 3 = 0\\n\\n第一步：移项得 x² + 2x = 3\\n\\n第二步：配方得 x² + 2x + 1 = 4\\n第三步：(x + 1)² = 4\\n\\n第四步：x + 1 = ±2\\n第五步：x₁ = 1, x₂ = -3\\n\\n检验：代入 x = 1：1 + 2 - 3 = 0 ✓",
  "context": {
    "textbookVersion": "PEP_v2",
    "preferredMethod": "COMPLETING_SQUARE",
    "userAbilityLevel": "INTERMEDIATE"
  },
  "verificationMode": "STREAM",  // STREAM（实时流式） | BATCH（后台批量） | HYBRID
  "options": {
    "enableSymbolicEngine": true,
    "enableMethodAlignment": true,
    "maxRetries": 2,
    "retryStrategy": "PARTIAL_REGEN",
    "strictness": "NORMAL"  // STRICT | NORMAL | LENIENT
  }
}
```

**响应体：**

```json
{
  "code": 0,
  "data": {
    "chainUuid": "rc_20260715_a1b2c3d4e5f6",
    "status": "VERIFYING",
    "estimatedTimeMs": 3000,
    "streamCallbackUrl": "/api/v1/reasoning/rc_20260715_a1b2c3d4e5f6/stream"
  }
}
```

### 4.3 查询校验结果

```
GET /api/v1/reasoning/{chainUuid}
```

**响应体：**

```json
{
  "code": 0,
  "data": {
    "chainUuid": "rc_20260715_a1b2c3d4e5f6",
    "status": "PASSED",
    "overallScore": 92.5,
    "stepCount": 6,
    "hasStepError": false,
    "hasSkip": false,
    "retryCount": 0,
    "steps": [
      {
        "stepIndex": 1,
        "stepType": "CONDITION_EXTRACTION",
        "content": "已知 x² + 2x - 3 = 0",
        "verification": {
          "resultLevel": "PASS",
          "confidenceScore": 98.0,
          "mathCorrect": true,
          "logicConsistent": true,
          "verifiedBy": "RULE_BASED",
          "latencyMs": 15
        }
      },
      {
        "stepIndex": 2,
        "stepType": "TRANSFORMATION",
        "content": "移项得 x² + 2x = 3",
        "verification": {
          "resultLevel": "PASS",
          "confidenceScore": 100.0,
          "mathCorrect": true,
          "logicConsistent": true,
          "verifiedBy": "SYMBOLIC_ENGINE",
          "calculations": [
            { "expression": "x² + 2x - 3 = 0 → x² + 2x = 3", "valid": true }
          ],
          "latencyMs": 32
        }
      },
      {
        "stepIndex": 3,
        "stepType": "TRANSFORMATION",
        "content": "配方得 x² + 2x + 1 = 4",
        "verification": {
          "resultLevel": "PASS",
          "confidenceScore": 100.0,
          "mathCorrect": true,
          "logicConsistent": true,
          "formulaCorrect": true,
          "methodAligned": true,
          "verifiedBy": "SYMBOLIC_ENGINE",
          "calculations": [
            { "expression": "x² + 2x + 1 = 3 + 1 = 4", "valid": true }
          ],
          "latencyMs": 28
        }
      },
      {
        "stepIndex": 4,
        "stepType": "TRANSFORMATION",
        "content": "(x + 1)² = 4",
        "verification": {
          "resultLevel": "PASS",
          "confidenceScore": 100.0,
          "mathCorrect": true,
          "verifiedBy": "SYMBOLIC_ENGINE",
          "calculations": [
            { "expression": "x² + 2x + 1 = (x + 1)²", "valid": true }
          ],
          "latencyMs": 30
        }
      },
      {
        "stepIndex": 5,
        "stepType": "SOLUTION",
        "content": "x + 1 = ±2，x₁ = 1, x₂ = -3",
        "verification": {
          "resultLevel": "PASS",
          "confidenceScore": 100.0,
          "mathCorrect": true,
          "verifiedBy": "SYMBOLIC_ENGINE",
          "calculations": [
            { "expression": "x + 1 = 2 → x = 1", "valid": true },
            { "expression": "x + 1 = -2 → x = -3", "valid": true }
          ],
          "latencyMs": 25
        }
      },
      {
        "stepIndex": 6,
        "stepType": "VERIFICATION_SUMMARY",
        "content": "检验：1 + 2 - 3 = 0 ✓",
        "verification": {
          "resultLevel": "PASS",
          "confidenceScore": 95.0,
          "mathCorrect": true,
          "verifiedBy": "RULE_BASED",
          "latencyMs": 12
        }
      }
    ],
    "qualityAssessment": {
      "completeness": 100.0,
      "correctness": 100.0,
      "coherence": 95.0,
      "pedagogicalValue": 88.0,
      "methodAlignment": 100.0
    }
  }
}
```

### 4.4 流式校验回调（SSE）

```
GET /api/v1/reasoning/{chainUuid}/stream
Accept: text/event-stream
```

**SSE 事件流示例：**

```
event: chain_started
data: {"chainUuid":"rc_20260715_a1b2c3d4e5f6","stepCount":6}

event: step_verified
data: {"stepIndex":1,"result":"PASS","score":98.0,"latencyMs":15}

event: step_verified
data: {"stepIndex":2,"result":"PASS","score":100.0,"latencyMs":32}

event: step_verified
data: {"stepIndex":3,"result":"FAIL","score":0.0,"errorType":"CALCULATION_ERROR","errorDetail":"3+1应为4，但AI输出为5","expectedValue":"4","actualValue":"5"}

event: retry_triggered
data: {"retryRound":1,"fromStep":3,"strategy":"PARTIAL_REGEN"}

event: retry_completed
data: {"retryRound":1,"fromStep":3,"newScore":100.0,"improved":true}

event: chain_completed
data: {"chainUuid":"rc_20260715_a1b2c3d4e5f6","status":"REVERIFIED","overallScore":95.0,"totalLatencyMs":2800}
```

### 4.5 触发定向重试

```
POST /api/v1/reasoning/{chainUuid}/retry
```

**请求体：**

```json
{
  "fromStep": 3,
  "toStep": null,
  "reason": "CALCULATION_ERROR",
  "strategy": "PARTIAL_REGEN",
  "options": {
    "modelSwitch": null,
    "promptAdjust": "请在第3步重新计算 3+1，注意正确结果为4",
    "temperature": 0.1
  }
}
```

### 4.6 错误码定义

| 错误码 | 含义 | 处理建议 |
| --- | --- | --- |
| `40001` | 推理链不存在 | 检查 chainUuid |
| `40002` | 步骤解析失败 | AI 回答格式不规范，无法提取步骤 |
| `40003` | 校验超时 | 降级到整体验证 |
| `40004` | 重试次数超限 | 降级处理，展示原始回答+免责提示 |
| `40005` | 符号引擎不支持该学科 | 跳过符号校验，仅使用规则校验 |
| `40006` | 模型校验服务不可用 | 降级到规则校验 |
| `40007` | 步骤内容为空 | 检查 AI 回答是否完整 |

---

## 5. 核心业务逻辑

### 5.1 整体处理流程

```
                        ┌──────────────────┐
                        │ AI 回答完成生成    │
                        └────────┬─────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │  步骤拆解器        │
                        │ (StepParser)      │
                        └────────┬─────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
          ┌──────────────────┐    ┌──────────────────┐
          │  快速规则校验      │    │  深度模型校验      │
          │ (RuleVerifier)   │    │ (ModelVerifier)  │
          │  并行执行 <500ms  │    │  串行执行 <3s     │
          └────────┬─────────┘    └────────┬─────────┘
                   │                       │
                   └──────────┬────────────┘
                              │
                              ▼
                   ┌──────────────────┐
                   │  结果聚合器        │
                   │ (ResultAggregator)│
                   └────────┬─────────┘
                            │
                 ┌──────────┴──────────┐
                 │                     │
                 ▼                     ▼
       ┌─────────────────┐   ┌──────────────────┐
       │  全部通过/仅WARN │   │   存在FAIL/SKIP  │
       │  正常展示        │   │  触发重试决策     │
       └─────────────────┘   └────────┬─────────┘
                                      │
                                      ▼
                            ┌──────────────────┐
                            │  重试执行器        │
                            │ (RetryExecutor)   │
                            └────────┬─────────┘
                                     │
                              ┌──────┴──────┐
                              │             │
                              ▼             ▼
                    ┌──────────────┐ ┌──────────────┐
                    │ 重试成功      │ │ 重试失败      │
                    │ 重新校验      │ │ 降级处理      │
                    └──────────────┘ └──────────────┘
```

### 5.2 步骤拆解器（StepParser）

步骤拆解是整个引擎的入口，需要将 AI 生成的自然语言回答解析为结构化的步骤序列。

#### 5.2.1 拆解策略

```python
class StepParser:
    """推理步骤拆解器"""

    # 步骤标识模式
    STEP_PATTERNS = [
        # 显式编号：第一步/第1步/Step 1/1./1)
        r'(?:第[一二三四五六七八九十\d]+步|Step\s*(\d+)|(\d+)[\.\)）]\s*)',

        # 隐式分隔：换行+连接词
        r'(?:^|\n)\s*(?:因此|所以|由此|于是|那么|接下来|然后|因为|由于)',

        # 数学符号开头
        r'(?:^|\n)\s*(?:[≤≥≠±×÷√∑∫]|[a-zA-Z]\s*[=≠<>])',

        # 公式块分隔（LaTeX）
        r'(?:\$\$.*?\$\$)',
    ]

    def parse(self, answer_content: str, subject: str, context: ParseContext) -> List[ReasoningStep]:
        """
        解析AI回答为推理步骤序列

        Args:
            answer_content: AI生成的完整回答文本
            subject: 学科
            context: 解析上下文（题型、知识点等）

        Returns:
            推理步骤列表
        """
        # 1. 预处理：统一格式
        normalized = self._normalize_content(answer_content)

        # 2. 按显式标记拆分
        steps = self._split_by_explicit_markers(normalized)

        # 3. 如果显式标记不足3步，尝试隐式拆分
        if len(steps) < 3:
            steps = self._split_by_implicit_markers(normalized)

        # 4. 步骤分类与结构化
        structured_steps = []
        for i, (step_content, start_pos, end_pos) in enumerate(steps):
            step_type = self._classify_step_type(step_content, subject)
            formulas = self._extract_formulas(step_content)
            calculations = self._extract_calculations(step_content)

            structured_steps.append(ReasoningStep(
                step_index=i + 1,
                step_type=step_type,
                content=step_content.strip(),
                content_struct={
                    'formulas': formulas,
                    'calculations': calculations,
                },
                stream_start_pos=start_pos,
                stream_end_pos=end_pos,
            ))

        # 5. 依赖关系推断
        self._infer_dependencies(structured_steps)

        return structured_steps

    def _classify_step_type(self, content: str, subject: str) -> ReasoningStepType:
        """分类步骤类型"""
        content_lower = content.lower().strip()

        # 条件提取类
        if any(kw in content for kw in ['已知', '设', '令', '题目要求', '根据题意']):
            return ReasoningStepType.CONDITION_EXTRACTION

        # 方法选择类
        if any(kw in content for kw in ['使用', '采用', '运用', '由...定理', '根据...公式']):
            return ReasoningStepType.METHOD_SELECTION

        # 验证总结类
        if any(kw in content for kw in ['检验', '验证', '综上', '因此', '所以最终', '总结']):
            return ReasoningStepType.VERIFICATION_SUMMARY

        # 最终答案类
        if any(kw in content for kw in ['答案', '解为', '结果', '故']):
            return ReasoningStepType.SOLUTION

        # 公式应用类
        if '=' in content and any(c in content for c in '²³√∑'):
            return ReasoningStepType.FORMULA_APPLICATION

        # 计算类
        if any(op in content for op in ['+', '-', '×', '÷', '=', '≈']):
            return ReasoningStepType.CALCULATION

        # 默认推导
        return ReasoningStepType.DERIVATION
```

#### 5.2.2 拆解质量保障

拆解质量直接影响校验准确性，采用**多策略投票**机制：

```python
class RobustStepParser:
    """鲁棒步骤拆解器 - 多策略融合"""

    def parse(self, content: str, context: ParseContext) -> ParseResult:
        # 策略1: 规则正则拆分
        rule_steps = self._rule_based_parse(content)

        # 策略2: 使用轻量模型拆分（如 fast tokenizer + sequence labeling）
        model_steps = self._model_based_parse(content, model='step-parser-lite')

        # 策略3: 结构化标记拆分（Markdown/LaTeX 结构）
        struct_steps = self._structure_based_parse(content)

        # 投票融合
        return self._merge_and_vote(rule_steps, model_steps, struct_steps)
```

### 5.3 校验引擎（VerificationEngine）

#### 5.3.1 多层级校验架构

```python
class VerificationEngine:
    """推理步骤校验引擎 - 多层级架构"""

    def __init__(self):
        # 第一层：规则校验器（快，<50ms/步）
        self.rule_verifier = RuleBasedVerifier()

        # 第二层：符号计算引擎（准确，<200ms/步）
        self.symbolic_verifier = SymbolicEngineVerifier()

        # 第三层：模型校验器（强，<1s/步）
        self.model_verifier = ModelBasedVerifier()

    async def verify_step(
        self,
        step: ReasoningStep,
        prev_steps: List[ReasoningStep],
        context: VerificationContext,
    ) -> StepVerification:
        """校验单个推理步骤"""

        results = []

        # 第一层：规则校验（总是执行）
        rule_result = await self.rule_verifier.verify(step, prev_steps, context)
        results.append(('RULE_BASED', rule_result))

        # 如果规则校验发现问题，提前返回（快路径）
        if rule_result.result_level == VerificationLevel.FAIL:
            return self._aggregate_result(results)

        # 第二层：符号计算校验（仅对计算/公式步骤）
        if step.step_type in [
            ReasoningStepType.CALCULATION,
            ReasoningStepType.TRANSFORMATION,
            ReasoningStepType.FORMULA_APPLICATION,
            ReasoningStepType.SOLUTION,
        ]:
            try:
                symbolic_result = await self.symbolic_verifier.verify(
                    step, prev_steps, context
                )
                results.append(('SYMBOLIC_ENGINE', symbolic_result))

                if symbolic_result.result_level == VerificationLevel.FAIL:
                    return self._aggregate_result(results)
            except SymbolicEngineNotSupported:
                pass  # 降级到模型校验

        # 第三层：模型校验（仅对复杂步骤或前两层不确定时）
        if self._needs_model_verification(results, step):
            model_result = await self.model_verifier.verify(
                step, prev_steps, context
            )
            results.append(('MODEL_BASED', model_result))

        return self._aggregate_result(results)

    def _needs_model_verification(
        self, current_results: List, step: ReasoningStep
    ) -> bool:
        """判断是否需要模型校验"""
        # 如果前两层结果不一致，需要仲裁
        levels = [r.result_level for _, r in current_results]
        if len(set(levels)) > 1:
            return True

        # 如果置信度低于阈值
        avg_confidence = sum(r.confidence_score for _, r in current_results) / len(current_results)
        if avg_confidence < 85.0:
            return True

        # 逻辑推导和概念解释类步骤，规则难以校验
        if step.step_type in [ReasoningStepType.DERIVATION, ReasoningStepType.EXPLANATION]:
            return True

        return False
```

#### 5.3.2 规则校验器（RuleBasedVerifier）

```python
class RuleBasedVerifier:
    """基于规则的快速校验器"""

    # 数学基本规则
    MATH_RULES = {
        'arithmetic': ArithmeticRule(),       # 四则运算校验
        'sign_rule': SignRule(),              # 正负号校验
        'fraction_rule': FractionRule(),      # 分数运算校验
        'exponent_rule': ExponentRule(),      # 指数运算校验
        'unit_consistency': UnitConsistencyRule(),  # 单位一致性校验
    }

    # 逻辑规则
    LOGIC_RULES = {
        'causality': CausalityRule(),         # 因果关系校验
        'dependency': DependencyRule(),       # 步骤依赖校验
        'completeness': CompletenessRule(),   # 完整性校验
    }

    async def verify(
        self,
        step: ReasoningStep,
        prev_steps: List[ReasoningStep],
        context: VerificationContext,
    ) -> StepVerification:
        """执行规则校验"""
        issues = []

        # 1. 数学计算校验
        for calc in step.content_struct.get('calculations', []):
            result = self._verify_calculation(calc)
            if not result.valid:
                issues.append(VerificationIssue(
                    type='CALCULATION_ERROR',
                    detail=f"计算错误：{calc['expression']}，正确结果应为 {result.expected}",
                    expected_value=result.expected,
                    actual_value=result.actual,
                ))

        # 2. 公式校验
        for formula in step.content_struct.get('formulas', []):
            if not self._verify_formula(formula, context.subject):
                issues.append(VerificationIssue(
                    type='FORMULA_ERROR',
                    detail=f"公式使用不当：{formula}",
                ))

        # 3. 逻辑一致性校验
        if prev_steps:
            logic_issue = self._verify_logic_chain(step, prev_steps[-1])
            if logic_issue:
                issues.append(logic_issue)

        # 4. 单位校验（物理/化学）
        if context.subject in ['PHYSICS', 'CHEMISTRY']:
            unit_issue = self._verify_units(step)
            if unit_issue:
                issues.append(unit_issue)

        # 5. 课标方法对齐校验
        if context.preferred_method:
            method_issue = self._verify_method_alignment(step, context.preferred_method)
            if method_issue:
                issues.append(method_issue)

        # 汇总
        if any(i.type == 'CALCULATION_ERROR' for i in issues):
            return StepVerification(
                result_level=VerificationLevel.FAIL,
                confidence_score=0.0,
                issues=issues,
                verified_by='RULE_BASED',
            )
        elif issues:
            return StepVerification(
                result_level=VerificationLevel.WARN,
                confidence_score=75.0,
                issues=issues,
                verified_by='RULE_BASED',
            )
        else:
            return StepVerification(
                result_level=VerificationLevel.PASS,
                confidence_score=95.0,
                issues=[],
                verified_by='RULE_BASED',
            )
```

#### 5.3.3 符号计算校验器（SymbolicEngineVerifier）

```python
class SymbolicEngineVerifier:
    """基于符号计算引擎的数学校验器，使用 SymPy 进行精确数学验证"""

    async def verify(
        self,
        step: ReasoningStep,
        prev_steps: List[ReasoningStep],
        context: VerificationContext,
    ) -> StepVerification:
        """使用符号计算引擎校验数学步骤"""

        try:
            # 提取步骤中的数学表达式
            expressions = self._extract_math_expressions(step.content)

            for expr_info in expressions:
                # 解析表达式
                lhs = sympy.sympify(expr_info['lhs'])
                rhs = sympy.sympify(expr_info['rhs'])

                # 判断等式是否成立
                if not sympy.simplify(lhs - rhs) == 0:
                    # 尝试理解变换意图
                    transform_type = self._identify_transform_type(
                        lhs, rhs, prev_steps
                    )

                    if transform_type == 'substitution':
                        # 代入校验
                        valid = self._verify_substitution(lhs, rhs, prev_steps)
                    elif transform_type == 'factoring':
                        # 因式分解校验
                        valid = self._verify_factoring(lhs, rhs)
                    elif transform_type == 'completing_square':
                        # 配方法校验
                        valid = self._verify_completing_square(lhs, rhs)
                    else:
                        valid = False

                    if not valid:
                        # 计算正确结果
                        correct_rhs = self._compute_correct(lhs, expr_info['operation'])
                        return StepVerification(
                            result_level=VerificationLevel.FAIL,
                            confidence_score=0.0,
                            error_type='MATHEMATICAL_ERROR',
                            error_detail=f"等式不成立：{lhs} ≠ {rhs}",
                            expected_value=str(correct_rhs),
                            actual_value=str(rhs),
                            verified_by='SYMBOLIC_ENGINE',
                        )

            return StepVerification(
                result_level=VerificationLevel.PASS,
                confidence_score=100.0,
                verified_by='SYMBOLIC_ENGINE',
            )

        except sympy.SympifyError as e:
            # 表达式无法解析，降级
            raise SymbolicEngineNotSupported(
                f"无法解析表达式: {e}"
            )
```

#### 5.3.4 模型校验器（ModelBasedVerifier）

```python
class ModelBasedVerifier:
    """使用大模型进行深层语义校验，处理规则和符号引擎无法覆盖的场景"""

    VERIFICATION_PROMPT_TEMPLATE = """你是一个严谨的教育内容校验专家。请校验以下推理步骤是否正确。

## 学科与学段
- 学科：{subject}
- 学段：{grade_level}
- 课标要求方法：{preferred_method}

## 题目上下文
{question_context}

## 前置步骤
{previous_steps}

## 待校验步骤（第{step_index}步）
{step_content}

## 校验维度
请从以下维度逐一校验：
1. **数学正确性**：计算是否准确，等式是否成立
2. **逻辑一致性**：与前序步骤的因果关系是否成立
3. **公式准确性**：使用的公式/定理是否正确引用
4. **方法适当性**：解题方法是否符合{grade_level}学段课标要求
5. **表述规范性**：是否有歧义、跳步或表述不当

## 输出格式（严格JSON）
```json
{{
  "math_correct": true/false,
  "logic_consistent": true/false,
  "formula_correct": true/false,
  "method_appropriate": true/false,
  "expression_clear": true/false,
  "result": "PASS/WARN/FAIL",
  "confidence": 0.0-1.0,
  "error_type": "错误类型(如FAIL)",
  "error_detail": "详细说明(如有错误)",
  "expected": "正确内容(如有错误)",
  "suggestion": "改进建议"
}}
```"""

    async def verify(
        self,
        step: ReasoningStep,
        prev_steps: List[ReasoningStep],
        context: VerificationContext,
    ) -> StepVerification:
        """使用模型进行深度校验"""

        prompt = self.VERIFICATION_PROMPT_TEMPLATE.format(
            subject=context.subject,
            grade_level=context.grade_level,
            preferred_method=context.preferred_method or '不限',
            question_context=context.question_text,
            previous_steps=self._format_prev_steps(prev_steps),
            step_index=step.step_index,
            step_content=step.content,
        )

        # 使用低温度保证确定性
        response = await self.llm_client.chat(
            model=self.config.verifier_model,  # 推荐使用不同于生成的模型
            messages=[{'role': 'user', 'content': prompt}],
            temperature=0.0,
            max_tokens=500,
            response_format={'type': 'json_object'},
        )

        result = json.loads(response.content)

        return StepVerification(
            result_level=VerificationLevel(result['result']),
            confidence_score=result['confidence'] * 100,
            math_correct=result.get('math_correct'),
            logic_consistent=result.get('logic_consistent'),
            formula_correct=result.get('formula_correct'),
            method_aligned=result.get('method_appropriate'),
            error_type=result.get('error_type'),
            error_detail=result.get('error_detail'),
            expected_value=result.get('expected'),
            verified_by='MODEL_BASED',
            verifier_model=self.config.verifier_model,
        )
```

### 5.4 完整性检测器（CompletenessDetector）

专门检测**跳步**和**逻辑断裂**，这是逐步校验中的难点。

```python
class CompletenessDetector:
    """推理链完整性检测器"""

    # 学科-题型-最小步骤数 知识库
    MIN_STEPS_MATRIX = {
        'MATH': {
            'LINEAR_EQUATION': 3,      # 一元一次方程最少3步
            'QUADRATIC_EQUATION': 4,    # 一元二次方程最少4步
            'SYSTEM_EQUATIONS': 5,      # 方程组最少5步
            'INEQUALITY': 4,            # 不等式最少4步
            'GEOMETRY_PROOF': 5,        # 几何证明最少5步
            'FUNCTION_ANALYSIS': 5,     # 函数分析最少5步
        },
        'PHYSICS': {
            'KINEMATICS': 4,            # 运动学最少4步
            'DYNAMICS': 5,              # 动力学最少5步（受力分析→方程→求解）
            'ENERGY': 5,                # 能量问题最少5步
            'CIRCUIT': 5,              # 电路分析最少5步
        },
        'CHEMISTRY': {
            'EQUATION_BALANCING': 3,    # 方程式配平最少3步
            'STOICHIOMETRY': 5,         # 化学计算最少5步
            'REACTION_TYPE': 3,         # 反应类型判断最少3步
        },
    }

    def detect(
        self,
        steps: List[ReasoningStep],
        context: DetectionContext,
    ) -> CompletenessReport:
        """检测推理链完整性"""

        issues = []

        # 1. 步骤数量检查
        min_steps = self._get_min_steps(context.subject, context.question_type)
        if len(steps) < min_steps:
            issues.append(CompletenessIssue(
                type='INSUFFICIENT_STEPS',
                detail=f'步骤数({len(steps)})少于该题型建议最少步骤数({min_steps})',
                severity='WARN',
                expected_steps=min_steps,
                actual_steps=len(steps),
            ))

        # 2. 关键步骤存在性检查
        required_types = self._get_required_step_types(context)
        existing_types = {s.step_type for s in steps}
        missing_types = required_types - existing_types
        if missing_types:
            issues.append(CompletenessIssue(
                type='MISSING_STEP_TYPE',
                detail=f'缺少必要的步骤类型: {missing_types}',
                severity='WARN',
                missing_types=list(missing_types),
            ))

        # 3. 逻辑连贯性检查
        for i in range(1, len(steps)):
            gap = self._detect_logic_gap(steps[i - 1], steps[i], context)
            if gap:
                issues.append(gap)

        # 4. 首尾完整性检查
        if steps[0].step_type != ReasoningStepType.CONDITION_EXTRACTION:
            # 容忍，不是硬性要求
            pass

        if not any(s.step_type == ReasoningStepType.SOLUTION for s in steps):
            issues.append(CompletenessIssue(
                type='NO_SOLUTION_STEP',
                detail='推理链缺少明确的结论/答案步骤',
                severity='FAIL',
            ))

        if not any(s.step_type == ReasoningStepType.VERIFICATION_SUMMARY for s in steps):
            # 提醒而非错误
            issues.append(CompletenessIssue(
                type='NO_VERIFICATION',
                detail='推理链缺少验证/检验步骤',
                severity='INFO',
            ))

        return CompletenessReport(
            is_complete=len([i for i in issues if i.severity == 'FAIL']) == 0,
            issues=issues,
            step_count=len(steps),
            expected_min_steps=min_steps,
        )

    def _detect_logic_gap(
        self,
        prev_step: ReasoningStep,
        curr_step: ReasoningStep,
        context: DetectionContext,
    ) -> Optional[CompletenessIssue]:
        """检测两个相邻步骤之间的逻辑断裂"""

        # 检查因果连接词
        causal_indicators = ['因此', '所以', '由此', '于是', '代入', '化简', '整理得']
        has_causal = any(ind in curr_step.content for ind in causal_indicators)

        # 如果当前步骤声称依赖前一步，检查是否真的有逻辑联系
        if has_causal:
            # 提取前一步的关键数学对象
            prev_objects = self._extract_math_objects(prev_step.content)
            curr_objects = self._extract_math_objects(curr_step.content)

            # 检查是否有共享的数学对象
            if prev_objects and curr_objects:
                shared = prev_objects & curr_objects
                if not shared:
                    return CompletenessIssue(
                        type='LOGIC_BREAK',
                        detail=f'步骤{curr_step.step_index}声称承接前一步，但未发现数学对象上的关联',
                        severity='WARN',
                        step_index=curr_step.step_index,
                    )

        return None
```

### 5.5 重试执行器（RetryExecutor）

当步骤校验失败时，进行智能重试。

```python
class RetryExecutor:
    """推理链定向重试执行器"""

    MAX_RETRIES = 2
    MAX_RETRY_LATENCY_MS = 5000  # 单次重试最大耗时

    async def execute_retry(
        self,
        chain: ReasoningChain,
        failed_step_index: int,
        verification: StepVerification,
        context: RetryContext,
    ) -> RetryResult:
        """
        对失败的步骤执行定向重试

        策略优先级：
        1. PARTIAL_REGEN - 仅重新生成失败步骤及之后内容（首选，成本低）
        2. METHOD_SWITCH - 切换解题方法（当方法不对齐时）
        3. FULL_REGEN - 整题重新生成（最后手段）
        """

        retry_record = ChainRetryRecord(
            chain_id=chain.id,
            retry_round=chain.retry_count + 1,
            retry_from_step=failed_step_index,
            retry_reason=self._map_error_to_reason(verification.error_type),
        )

        start_time = time.monotonic()

        try:
            if self._should_switch_method(verification, context):
                # 方法切换重试
                retry_record.strategy = RetryStrategy.METHOD_SWITCH
                new_answer = await self._retry_with_method_switch(
                    chain, failed_step_index, context
                )
            elif chain.retry_count >= 1:
                # 已经重试过一次，升级为全文重生成
                retry_record.strategy = RetryStrategy.FULL_REGEN
                new_answer = await self._retry_full_regeneration(chain, context)
            else:
                # 默认：部分重生成
                retry_record.strategy = RetryStrategy.PARTIAL_REGEN
                new_answer = await self._retry_partial(
                    chain, failed_step_index, verification, context
                )

            # 对重试结果重新校验
            new_chain = await self.verification_engine.verify_chain(new_answer, context)
            retry_record.retry_score = new_chain.overall_score
            retry_record.improved = new_chain.overall_score > chain.overall_score

        except Exception as e:
            retry_record.improved = False
            logger.error(f'重试执行失败: {e}', exc_info=True)
            new_chain = None

        finally:
            retry_record.latency_ms = int((time.monotonic() - start_time) * 1000)

        return RetryResult(
            record=retry_record,
            new_chain=new_chain,
            success=retry_record.improved,
        )

    async def _retry_partial(
        self,
        chain: ReasoningChain,
        failed_step: int,
        verification: StepVerification,
        context: RetryContext,
    ) -> str:
        """部分重生成：仅重新生成失败步骤及其后续步骤"""

        # 保留失败步骤之前的内容
        prefix = self._extract_prefix(chain, failed_step)

        # 构建定向重试 Prompt
        retry_prompt = f"""以下是解题过程的前半部分，但在第{failed_step}步出现了错误。

## 正确的前序步骤
{prefix}

## 错误信息
- 错误类型：{verification.error_type}
- 错误详情：{verification.error_detail}
- 正确结果应为：{verification.expected_value or '请重新计算'}

## 要求
请从第{failed_step}步开始，修正错误并继续完成解题过程。
保持与前序步骤相同的解题方法和表述风格。
确保每一步计算正确，步骤间逻辑连贯。"""

        response = await self.llm_client.chat(
            model=context.model_id,
            messages=[
                {'role': 'system', 'content': context.system_prompt},
                {'role': 'assistant', 'content': prefix},
                {'role': 'user', 'content': retry_prompt},
            ],
            temperature=0.1,  # 低温度提高确定性
        )

        return prefix + '\n\n' + response.content
```

### 5.6 质量画像聚合器

```python
class QualityProfileAggregator:
    """推理质量画像聚合器 - 定期统计各维度质量指标"""

    async def aggregate_period(
        self, period_start: date, period_end: date
    ) -> None:
        """聚合指定时间段的质量数据"""

        # 按模型+学科+学段+知识领域 聚合
        sql = """
        INSERT INTO reasoning_quality_profile (
            model_id, subject, grade_level, knowledge_area,
            total_chains, pass_rate, avg_score, avg_step_count,
            skip_rate, common_errors, stat_period, period_start, period_end
        )
        SELECT
            rc.model_id,
            rc.subject,
            rc.grade_level,
            kp.area as knowledge_area,
            COUNT(*) as total_chains,
            ROUND(SUM(CASE WHEN rc.status IN ('PASSED','PASSED_WARN','REVERIFIED') THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as pass_rate,
            ROUND(AVG(rc.overall_score), 2) as avg_score,
            ROUND(AVG(rc.step_count), 1) as avg_step_count,
            ROUND(SUM(CASE WHEN rc.has_skip THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as skip_rate,
            JSON_OBJECTAGgr(sv.error_type, COUNT(*)) as common_errors,
            'DAILY', %s, %s
        FROM reasoning_chains rc
        LEFT JOIN reasoning_steps rs ON rs.chain_id = rc.id
        LEFT JOIN step_verifications sv ON sv.chain_id = rc.id AND sv.result_level = 'FAIL'
        LEFT JOIN knowledge_point kp ON JSON_CONTAINS(rc.knowledge_point_ids, kp.id)
        WHERE rc.created_at BETWEEN %s AND %s
        GROUP BY rc.model_id, rc.subject, rc.grade_level, kp.area
        """

        await self.db.execute(sql, [period_start, period_end, period_start, period_end])

    async def get_model_quality_ranking(
        self, subject: str, grade_level: str
    ) -> List[Dict]:
        """获取模型质量排名，为模型路由提供依据"""
        # 查询最近7天各模型的质量数据
        # 返回按质量评分排序的模型列表
        ...
```

---

## 6. 流式校验架构

### 6.1 流式校验时序

在 SSE 流式输出场景下，校验与生成**并行进行**，不阻塞用户看到内容：

```
时间轴 →

AI生成:    [Token流] →→→ [步骤1完整] →→→→→→ [步骤2完整] →→→→→→→→ [步骤3完整] ...
                            │                           │                        │
校验:                       ▼                           ▼                        ▼
                     [快速校验步骤1]            [快速校验步骤2]           [快速校验步骤3]
                     (<500ms)                  (<500ms)                  (<500ms)
                     │                          │                        │
展示:                 ▼                          ▼                        ▼
                     ✅ 标记步骤1可信           ✅ 标记步骤2可信          ❌ 步骤3错误！
                                                                        │
                                                                        ▼
                                                              [触发后台重试]
                                                                        │
                                              前台展示原始内容     ←─── [重试完成后]
                                              + 底部追加"已修正"        替换错误部分
```

### 6.2 流式校验实现

```python
class StreamingVerificationPipeline:
    """流式校验管线 - 与AI生成并行执行"""

    def __init__(self):
        self.step_buffer = StepBuffer()
        self.current_step_text = ""
        self.step_boundary_detector = StepBoundaryDetector()

    async def on_token(self, token: str):
        """每收到一个token时调用"""
        self.current_step_text += token

        # 检测是否到达步骤边界
        if self.step_boundary_detector.is_boundary(self.current_step_text):
            await self._on_step_complete()

    async def _on_step_complete(self):
        """一个完整步骤生成完毕"""
        step_index = self.step_buffer.next_index()
        step = ReasoningStep(
            step_index=step_index,
            content=self.current_step_text.strip(),
            step_type=self._classify_type(self.current_step_text),
        )
        self.step_buffer.add(step)

        # 异步执行快速校验（不阻塞流式输出）
        asyncio.create_task(self._async_verify_step(step))

        # 重置缓冲
        self.current_step_text = ""

    async def _async_verify_step(self, step: ReasoningStep):
        """异步校验单个步骤"""
        try:
            prev_steps = self.step_buffer.get_steps_before(step.step_index)
            verification = await self.verification_engine.verify_step(
                step=step,
                prev_steps=prev_steps,
                context=self.context,
            )

            # 通过 SSE 推送校验结果到客户端
            await self.sse_emitter.emit('step_verified', {
                'stepIndex': step.step_index,
                'result': verification.result_level.value,
                'score': verification.confidence_score,
            })

            # 如果失败，记录并决定是否重试
            if verification.result_level == VerificationLevel.FAIL:
                await self.retry_scheduler.schedule_if_needed(step, verification)

        except Exception as e:
            logger.error(f'步骤校验异常: {e}', exc_info=True)
            # 校验异常不应影响用户看到回答
```

### 6.3 步骤边界检测

```python
class StepBoundaryDetector:
    """检测流式输出中的步骤边界"""

    # 步骤结束标记
    BOUNDARY_MARKERS = [
        '\n\n第',       # "第一步"等
        '\n\nStep',
        '\n\n**第',
        '\n\n---',
        '\n\n所以',
        '\n\n因此',
        '\n\n综上',
        '\n\n检验',
        '$$\n\n',       # LaTeX 公式块结束
    ]

    # 软边界标记（可能是步骤边界，需要更多token确认）
    SOFT_MARKERS = [
        '\n\n',
        '。\n',
        '；\n',
    ]

    def is_boundary(self, accumulated_text: str) -> bool:
        """判断当前累积文本是否到达步骤边界"""
        # 检查硬边界
        for marker in self.BOUNDARY_MARKERS:
            if accumulated_text.endswith(marker) or \
               accumulated_text.rstrip().endswith(marker.rstrip()):
                return True
        return False
```

---

## 7. 关键代码示例

### 7.1 核心服务类

```python
# reasoning_verification_service.py

from dataclasses import dataclass
from typing import List, Optional
import asyncio

@dataclass
class VerificationRequest:
    conversation_id: int
    message_id: int
    user_id: int
    subject: str
    grade_level: str
    question_type: str
    knowledge_point_ids: List[str]
    model_id: str
    prompt_version: str
    answer_content: str
    context: dict
    verification_mode: str  # STREAM | BATCH | HYBRID
    options: dict


class ReasoningVerificationService:
    """推理链校验服务 - 对外统一入口"""

    def __init__(self):
        self.step_parser = RobustStepParser()
        self.verification_engine = VerificationEngine()
        self.completeness_detector = CompletenessDetector()
        self.retry_executor = RetryExecutor()
        self.quality_aggregator = QualityProfileAggregator()
        self.chain_repo = ReasoningChainRepository()
        self.event_emitter = VerificationEventEmitter()

    async def verify(self, request: VerificationRequest) -> VerificationResult:
        """主入口：提交推理链校验"""

        # 1. 创建推理链记录
        chain = await self.chain_repo.create_chain(
            conversation_id=request.conversation_id,
            message_id=request.message_id,
            user_id=request.user_id,
            subject=request.subject,
            grade_level=request.grade_level,
            knowledge_point_ids=request.knowledge_point_ids,
            model_id=request.model_id,
            prompt_version=request.prompt_version,
        )

        try:
            # 2. 步骤拆解
            steps = self.step_parser.parse(
                content=request.answer_content,
                subject=request.subject,
                context=ParseContext(
                    question_type=request.question_type,
                    knowledge_point_ids=request.knowledge_point_ids,
                ),
            )

            await self.chain_repo.save_steps(chain.id, steps)
            await self.chain_repo.update_chain(chain.id, step_count=len(steps))

            # 3. 逐步校验
            verifications = []
            for i, step in enumerate(steps):
                prev_steps = steps[:i]
                verification = await self.verification_engine.verify_step(
                    step=step,
                    prev_steps=prev_steps,
                    context=VerificationContext(
                        subject=request.subject,
                        grade_level=request.grade_level,
                        question_text=request.context.get('question_text', ''),
                        preferred_method=request.context.get('preferred_method'),
                        textbook_version=request.context.get('textbook_version'),
                        strictness=request.options.get('strictness', 'NORMAL'),
                    ),
                )
                verifications.append(verification)

                await self.chain_repo.save_verification(chain.id, step.step_index, verification)

                # 推送进度
                await self.event_emitter.emit_step_result(chain.chain_uuid, step.step_index, verification)

                # 首次遇到FAIL，触发重试
                if verification.result_level == 'FAIL' and chain.retry_count < request.options.get('maxRetries', 2):
                    retry_result = await self.retry_executor.execute_retry(
                        chain=chain,
                        failed_step_index=step.step_index,
                        verification=verification,
                        context=RetryContext(
                            model_id=request.model_id,
                            system_prompt=request.context.get('system_prompt', ''),
                        ),
                    )

                    if retry_result.success and retry_result.new_chain:
                        # 用重试结果替换原推理链
                        chain = retry_result.new_chain
                        verifications = retry_result.new_verifications
                        await self.chain_repo.update_chain_status(
                            chain.id, 'REVERIFIED'
                        )
                        break  # 重新校验完成，退出循环

            # 4. 完整性检测
            completeness = self.completeness_detector.detect(
                steps=steps,
                context=DetectionContext(
                    subject=request.subject,
                    question_type=request.question_type,
                    grade_level=request.grade_level,
                ),
            )

            # 5. 汇总评估
            summary = self._compute_summary(verifications, completeness)
            await self.chain_repo.update_chain(
                chain.id,
                status=summary.status,
                overall_score=summary.overall_score,
                has_step_error=summary.has_error,
                has_skip=summary.has_skip,
                verification_completed_at=datetime.now(),
            )

            return VerificationResult(
                chain_uuid=chain.chain_uuid,
                status=summary.status,
                overall_score=summary.overall_score,
                steps=[
                    StepResult(step=s, verification=v)
                    for s, v in zip(steps, verifications)
                ],
                completeness=completeness,
            )

        except Exception as e:
            logger.error(f'推理链校验失败: {e}', exc_info=True)
            await self.chain_repo.update_chain_status(chain.id, 'FAILED')
            raise

    def _compute_summary(
        self,
        verifications: List[StepVerification],
        completeness: CompletenessReport,
    ) -> ChainSummary:
        """计算推理链级汇总"""
        if not verifications:
            return ChainSummary(status='FAILED', overall_score=0)

        has_fail = any(v.result_level == 'FAIL' for v in verifications)
        has_warn = any(v.result_level == 'WARN' for v in verifications)
        has_skip = not completeness.is_complete and any(
            i.severity == 'FAIL' for i in completeness.issues
        )

        avg_score = sum(v.confidence_score for v in verifications) / len(verifications)

        if has_fail or has_skip:
            status = 'FAILED'
        elif has_warn:
            status = 'PASSED_WARN'
        else:
            status = 'PASSED'

        return ChainSummary(
            status=status,
            overall_score=round(avg_score, 2),
            has_error=has_fail,
            has_skip=has_skip,
        )
```

### 7.2 Spring Boot 服务端实现骨架

```java
// ReasoningVerificationController.java
package com.primetop.ai.reasoning.controller;

@RestController
@RequestMapping("/api/v1/reasoning")
@RequiredArgsConstructor
public class ReasoningVerificationController {

    private final ReasoningVerificationService service;

    @PostMapping("/verify")
    public Result<VerifyResponse> verify(@RequestBody @Valid VerifyRequest request) {
        VerifyResponse response = service.submitVerification(request);
        return Result.ok(response);
    }

    @GetMapping("/{chainUuid}")
    public Result<ChainDetailVO> getChain(@PathVariable String chainUuid) {
        return Result.ok(service.getChainDetail(chainUuid));
    }

    @GetMapping(value = "/{chainUuid}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamVerification(@PathVariable String chainUuid) {
        SseEmitter emitter = new SseEmitter(60_000L);
        service.subscribeStream(chainUuid, emitter);
        return emitter;
    }

    @PostMapping("/{chainUuid}/retry")
    public Result<RetryResponse> retry(
            @PathVariable String chainUuid,
            @RequestBody @Valid RetryRequest request) {
        return Result.ok(service.triggerRetry(chainUuid, request));
    }

    @GetMapping("/profile")
    public Result<QualityProfileVO> getProfile(
            @RequestParam String modelId,
            @RequestParam String subject,
            @RequestParam(required = false) String gradeLevel) {
        return Result.ok(service.getQualityProfile(modelId, subject, gradeLevel));
    }
}

// ReasoningVerificationService.java
@Service
@RequiredArgsConstructor
public class ReasoningVerificationService {

    private final StepParser stepParser;
    private final VerificationEngine verificationEngine;
    private final CompletenessDetector completenessDetector;
    private final RetryExecutor retryExecutor;
    private final ReasoningChainRepository chainRepo;

    @Async
    public VerifyResponse submitVerification(VerifyRequest request) {
        // 1. 创建推理链
        ReasoningChain chain = chainRepo.create(request);

        // 2. 步骤拆解
        List<ReasoningStep> steps = stepParser.parse(
            request.getAnswerContent(),
            ParseContext.from(request)
        );
        chainRepo.saveSteps(chain.getId(), steps);

        // 3. 异步执行校验
        CompletableFuture.runAsync(() -> {
            try {
                executeVerification(chain, steps, request);
            } catch (Exception e) {
                log.error("推理链校验异常 chainId={}", chain.getId(), e);
                chainRepo.updateStatus(chain.getId(), "FAILED");
            }
        });

        return VerifyResponse.builder()
            .chainUuid(chain.getChainUuid())
            .status("VERIFYING")
            .build();
    }

    private void executeVerification(
            ReasoningChain chain,
            List<ReasoningStep> steps,
            VerifyRequest request) {

        VerificationContext context = VerificationContext.from(request);
        List<StepVerification> verifications = new ArrayList<>();

        for (int i = 0; i < steps.size(); i++) {
            ReasoningStep step = steps.get(i);
            List<ReasoningStep> prevSteps = steps.subList(0, i);

            StepVerification verification = verificationEngine
                .verifyStep(step, prevSteps, context)
                .join(); // 异步转同步等待

            verifications.add(verification);
            chainRepo.saveVerification(chain.getId(), step.getStepIndex(), verification);

            // SSE 推送
            eventPublisher.publishEvent(
                new StepVerifiedEvent(chain.getChainUuid(), step.getStepIndex(), verification)
            );

            // 首次失败触发重试
            if (verification.getResultLevel() == ResultLevel.FAIL
                    && chain.getRetryCount() < request.getMaxRetries()) {
                RetryResult retryResult = retryExecutor.executeRetry(
                    chain, step.getStepIndex(), verification, context
                ).join();

                if (retryResult.isSuccess()) {
                    chainRepo.updateStatus(chain.getId(), "REVERIFIED");
                    return;
                }
            }
        }

        // 完整性检测
        CompletenessReport completeness = completenessDetector.detect(steps, context);

        // 汇总
        ChainSummary summary = computeSummary(verifications, completeness);
        chainRepo.updateChain(chain.getId(), summary);
    }
}
```

---

## 8. 错误处理与降级策略

### 8.1 分层降级策略

```
正常流程：
  规则校验 + 符号引擎 + 模型校验 → 高精度结果

降级 Level 1（符号引擎不可用）：
  规则校验 + 模型校验 → 较高精度

降级 Level 2（模型校验不可用）：
  规则校验 + 符号引擎 → 中等精度（无法校验逻辑推导类步骤）

降级 Level 3（规则校验异常）：
  仅模型校验 → 依赖模型能力

降级 Level 4（全部校验不可用）：
  跳过校验 → 原始回答直接展示 + "未经AI质量校验"标记

熔底策略：
  校验超时 → 原始回答展示 + 底部免责声明
```

### 8.2 异常处理矩阵

| 异常场景 | 检测方式 | 处理策略 | 用户影响 |
| --- | --- | --- | --- |
| 步骤拆解失败（无法识别步骤） | StepParser 返回空或步骤<2 | 降级到整体验证 | 无感知 |
| 符号引擎解析失败 | SymPy 抛出异常 | 跳过符号校验，使用模型校验 | 无感知 |
| 模型校验 API 超时 | 超时 > 3s | 跳过模型校验，仅使用规则结果 | 无感知 |
| 重试 LLM 调用失败 | API 返回错误 | 使用原始回答，标记警告 | 底部显示"部分步骤未经校验" |
| 全链路超时 > 10s | 总计时器 | 立即终止校验，返回已校验结果 | 底部显示"校验未完成" |
| 步骤内容为空/异常 | 内容长度检查 | 标记为 BLOCK，跳过该步 | 无感知 |
| 数据库写入失败 | 异常捕获 | 记录到本地日志，不影响校验流程 | 无感知 |

### 8.3 超时控制

```python
class VerificationTimeoutManager:
    """校验超时控制"""

    # 各层超时配置
    TIMEOUTS = {
        'rule_verify_per_step': 0.1,      # 100ms
        'symbolic_verify_per_step': 0.3,   # 300ms
        'model_verify_per_step': 2.0,      # 2s
        'step_total': 3.0,                 # 单步总校验 3s
        'chain_total': 10.0,               # 整链校验 10s
        'retry_single': 5.0,               # 单次重试 5s
    }

    async def verify_with_timeout(
        self, coro, timeout_key: str
    ):
        timeout = self.TIMEOUTS[timeout_key]
        try:
            return await asyncio.wait_for(coro, timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning(f'校验超时: {timeout_key} ({timeout}s)')
            raise VerificationTimeoutError(timeout_key)
```

---

## 9. 性能优化

### 9.1 性能指标目标

| 场景 | 步骤数 | 目标延迟 | 说明 |
| --- | --- | --- | --- |
| 简单计算题（3-4步） | 3-4 | < 500ms | 规则+符号校验 |
| 中等复杂度（5-8步） | 5-8 | < 2s | 规则+符号+部分模型校验 |
| 复杂综合题（10+步） | 10+ | < 5s | 分层校验+并行化 |
| 流式校验单步 | 1 | < 500ms | 快速规则校验 |
| 后台批量校验 | 100题 | < 5min | 批量并行处理 |

### 9.2 并行优化策略

```python
class ParallelVerificationOptimizer:
    """并行校验优化器"""

    async def verify_chain_parallel(
        self, steps: List[ReasoningStep], context: VerificationContext
    ) -> List[StepVerification]:
        """并行校验优化策略"""

        # 策略1：独立步骤并行校验
        # 如果某些步骤之间没有依赖关系，可以并行校验
        independent_groups = self._find_independent_step_groups(steps)

        tasks = []
        for group in independent_groups:
            if len(group) == 1:
                # 单步骤，直接校验
                step = group[0]
                prev = [s for s in steps if s.step_index < step.step_index]
                tasks.append(self.verification_engine.verify_step(step, prev, context))
            else:
                # 多个独立步骤，并行校验
                group_tasks = [
                    self.verification_engine.verify_step(step, steps[:step.step_index-1], context)
                    for step in group
                ]
                tasks.append(asyncio.gather(*group_tasks))

        results = await asyncio.gather(*tasks)
        return self._flatten_and_sort(results, steps)

    def _find_independent_step_groups(
        self, steps: List[ReasoningStep]
    ) -> List[List[ReasoningStep]]:
        """
        找出可以并行校验的步骤组
        例如：分情况讨论时，每种情况的推导是独立的
        """
        groups = []
        current_group = []

        for step in steps:
            if not step.depends_on or len(step.depends_on) == 0:
                if current_group:
                    groups.append(current_group)
                current_group = [step]
            else:
                current_group.append(step)

        if current_group:
            groups.append(current_group)

        return groups
```

### 9.3 缓存优化

```python
class VerificationCacheManager:
    """校验结果缓存管理"""

    async def get_cached_verification(
        self, step: ReasoningStep, context_hash: str
    ) -> Optional[StepVerification]:
        """获取缓存的校验结果"""
        cache_key = f"rc:step:{context_hash}:{step.step_index}"
        cached = await self.redis.get(cache_key)
        if cached:
            return StepVerification.from_json(cached)
        return None

    async def cache_verification(
        self,
        step: ReasoningStep,
        context_hash: str,
        verification: StepVerification,
        ttl: int = 86400,
    ):
        """缓存校验结果"""
        cache_key = f"rc:step:{context_hash}:{step.step_index}"
        await self.redis.setex(
            cache_key, ttl,
            json.dumps(verification.to_dict())
        )

    def compute_context_hash(
        self, step: ReasoningStep, prev_steps: List[ReasoningStep], context: VerificationContext
    ) -> str:
        """计算校验上下文哈希（用于缓存命中判断）"""
        content = {
            'step_content': step.content,
            'prev_summary': ''.join(s.content[:50] for s in prev_steps[-2:]),
            'subject': context.subject,
            'grade': context.grade_level,
            'method': context.preferred_method,
        }
        return hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()[:16]
```

---

## 10. 监控与告警

### 10.1 关键监控指标

| 指标名 | 类型 | 说明 | 告警阈值 |
| --- | --- | --- | --- |
| `reasoning.verify.pass_rate` | Gauge | 推理链通过率 | < 85% |
| `reasoning.verify.avg_score` | Gauge | 平均置信度 | < 80 |
| `reasoning.verify.step.fail_rate` | Gauge | 单步失败率 | > 15% |
| `reasoning.verify.retry.rate` | Gauge | 重试触发率 | > 20% |
| `reasoning.verify.retry.success_rate` | Gauge | 重试成功率 | < 60% |
| `reasoning.verify.latency.p50` | Gauge | 校验P50延迟 | > 2s |
| `reasoning.verify.latency.p99` | Gauge | 校验P99延迟 | > 8s |
| `reasoning.verify.degraded.rate` | Gauge | 降级处理比例 | > 10% |
| `reasoning.step.parse.failure_rate` | Gauge | 步骤拆解失败率 | > 5% |
| `reasoning.model.verify.error_rate` | Gauge | 模型校验异常率 | > 5% |

### 10.2 Prometheus 指标定义

```yaml
# prometheus-rules-reasoning.yml
groups:
  - name: reasoning_verification
    rules:
      - alert: ReasoningPassRateLow
        expr: |
          avg(reasoning_verify_pass_rate{period="daily"}) by (model_id, subject) < 85
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "推理链通过率低于85% ({{ $labels.model_id }} / {{ $labels.subject }})"
          description: "当前通过率: {{ $value }}%"

      - alert: ReasoningVerifyLatencyHigh
        expr: |
          histogram_quantile(0.99, reasoning_verify_latency_bucket) > 8
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "推理链校验P99延迟超过8秒"
          description: "当前P99: {{ $value }}秒"

      - alert: ReasoningRetryRateHigh
        expr: |
          reasoning_verify_retry_rate > 0.2
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "重试触发率超过20%"
          description: "可能存在模型质量下降或Prompt问题"
```

---

## 11. 安全考虑

### 11.1 数据安全

- 推理链中可能包含学生用户信息，需脱敏存储校验日志
- 模型校验发送给第三方模型时，需移除用户身份信息
- 重试记录中不保留完整学生题目原文（仅保留步骤内容）

### 11.2 权限控制

| 操作 | 所需权限 | 说明 |
| --- | --- | --- |
| 提交校验 | 系统内部调用 | 仅 AI 引擎服务可调用 |
| 查询校验结果 | 用户自己的数据 | 用户只能查看自己的推理链 |
| 查询质量画像 | 运营/管理员 | 用于质量监控 |
| 触发重试 | 系统内部调用 | 自动触发或管理员手动 |
| 批量校验 | 管理员 | 离线质量评估 |

### 11.3 审计日志

```json
{
  "eventType": "REASONING_VERIFICATION_COMPLETED",
  "chainUuid": "rc_20260715_a1b2c3d4e5f6",
  "userId": 100001,
  "subject": "MATH",
  "modelId": "gpt-4-turbo",
  "status": "REVERIFIED",
  "overallScore": 92.5,
  "retryCount": 1,
  "latencyMs": 2800,
  "timestamp": "2026-07-15T10:30:00Z"
}
```

---

## 12. 测试策略

### 12.1 单元测试

| 模块 | 测试重点 | 示例用例 |
| --- | --- | --- |
| StepParser | 各种格式的步骤拆解 | 显式编号/隐式连接词/公式块 |
| RuleBasedVerifier | 数学规则校验准确性 | 四则运算错误/符号错误/单位不一致 |
| SymbolicEngineVerifier | 符号计算准确性 | 多项式运算/因式分解/方程求解 |
| ModelBasedVerifier | Prompt 模板输出解析 | 模型返回非JSON/部分字段缺失 |
| CompletenessDetector | 跳步检测 | 方程组缺少代入步骤/几何证明缺条件 |
| RetryExecutor | 定向重试逻辑 | 部分重生成/方法切换/全量重生成 |

### 12.2 Golden Dataset 测试

```python
# golden_dataset structure
{
  "id": "golden_math_001",
  "subject": "MATH",
  "grade_level": "SENIOR",
  "question_type": "CALCULATION",
  "question": "解方程 x² + 2x - 3 = 0",
  "ai_answer": "第一步：x² + 2x = 3...",
  "expected_steps": 5,
  "expected_errors": [
    {
      "step_index": 3,
      "error_type": "CALCULATION_ERROR",
      "expected": "4",
      "actual": "5"
    }
  ],
  "expected_overall_status": "FAIL"
}
```

### 12.3 集成测试场景

| 场景 | 输入 | 期望输出 |
| --- | --- | --- |
| 完美推理链 | 5步全正确的数学解答 | status=PASSED, score>90 |
| 中间步骤计算错误 | 第3步 `3+1=5` | step3=FAIL, 触发重试 |
| 跳步检测 | 直接从条件到答案 | has_skip=True, status=WARN |
| 方法不对齐 | 课标要求配方法但AI用了公式法 | method_aligned=False |
| 重试成功 | 首次FAIL→重试后PASS | status=REVERIFIED |
| 重试失败 | 重试2次仍FAIL | status=FAILED, 展示免责提示 |
| 流式校验 | SSE流式输出 | 每步边界触发校验事件 |
| 降级场景 | 符号引擎不可用 | 仅使用规则+模型校验 |

### 12.4 性能测试

```python
# performance_test.py
class ReasoningVerificationPerfTest:
    """性能基准测试"""

    @pytest.mark.parametrize("step_count,expected_latency", [
        (3, 0.5),   # 3步 < 500ms
        (5, 2.0),   # 5步 < 2s
        (10, 5.0),  # 10步 < 5s
        (20, 8.0),  # 20步 < 8s
    ])
    async def test_verification_latency(self, step_count, expected_latency):
        """测试不同步骤数下的校验延迟"""
        chain = generate_test_chain(steps=step_count)
        start = time.monotonic()
        await service.verify(chain)
        latency = time.monotonic() - start
        assert latency < expected_latency

    async def test_concurrent_verification(self):
        """测试并发校验性能"""
        chains = [generate_test_chain(steps=5) for _ in range(50)]
        start = time.monotonic()
        results = await asyncio.gather(*[service.verify(c) for c in chains])
        total_time = time.monotonic() - start
        # 50个推理链并发校验应 < 15s
        assert total_time < 15.0
        assert all(r.status in ['PASSED', 'PASSED_WARN', 'FAILED', 'REVERIFIED'] for r in results)
```

---

## 13. 与现有系统的集成方案

### 13.1 与 AI 辅导全链路集成

```python
# 在 AI 辅导全链路请求处理中嵌入校验
class AITutoringPipeline:

    async def process_request(self, request: TutoringRequest) -> AsyncIterator[str]:
        # ... AI 生成回答的流程 ...

        # 在 AI 回答生成完成后，触发推理链校验
        if self._is_multi_step_question(request):
            verification_request = VerificationRequest(
                conversation_id=request.conversation_id,
                message_id=request.message_id,
                user_id=request.user_id,
                subject=request.subject,
                grade_level=request.grade_level,
                answer_content=full_answer,
                verification_mode='STREAM' if request.is_streaming else 'BATCH',
                context=request.context,
                options={'maxRetries': 2, 'strictness': 'NORMAL'},
            )
            await self.reasoning_service.verify(verification_request)

        # 流式场景下，校验与生成并行
        if request.is_streaming:
            pipeline = StreamingVerificationPipeline()
            async for token in llm_stream:
                yield token
                await pipeline.on_token(token)
```

### 13.2 与 Prompt 版本管理集成

```python
# 当推理链校验发现系统性问题时，反馈给 Prompt 管理
class PromptFeedbackIntegration:

    async def on_quality_issue_detected(
        self, chain: ReasoningChain, common_error: ErrorPattern
    ):
        """当检测到系统性错误模式时，通知Prompt管理系统"""
        if common_error.occurrence_count > 10:  # 同类错误超过10次
            await self.prompt_manager.report_issue(
                prompt_version=chain.prompt_version,
                issue_type=common_error.type,
                affected_subject=chain.subject,
                affected_grade=chain.grade_level,
                detail=f"在推理链校验中发现系统性问题: {common_error.description}",
                suggestion=common_error.prompt_fix_suggestion,
            )
```

### 13.3 与 AI 模型评测基准集成

```python
# 将推理链校验数据纳入模型评测
class ModelBenchmarkIntegration:

    async def export_benchmark_dataset(self) -> Dataset:
        """导出带标注的推理链数据集，用于模型评测"""
        chains = await self.chain_repo.find_verified_chains(
            min_steps=3,
            has_verification=True,
            limit=10000,
        )
        return Dataset(
            items=[
                BenchmarkItem(
                    question=chain.question_text,
                    ai_answer=chain.answer_content,
                    step_scores=[v.confidence_score for v in chain.verifications],
                    overall_status=chain.status,
                    error_types=[v.error_type for v in chain.verifications if v.error_type],
                )
                for chain in chains
            ]
        )
```

---

## 14. 部署与配置

### 14.1 部署架构

```
                    ┌────────────────────┐
                    │   API Gateway      │
                    │   /api/v1/reasoning│
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │ Verification Service│  ← 独立部署，可独立扩缩容
                    │ (Spring Boot)      │
                    └─────────┬──────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
    ┌─────────▼──────┐ ┌─────▼──────┐ ┌──────▼───────┐
    │ Rule Engine    │ │ SymPy      │ │ Model Verify │
    │ (内置)          │ │ Service    │ │ Service      │
    │                │ │ (Python)   │ │ (LLM Proxy)  │
    └────────────────┘ └────────────┘ └──────────────┘
```

### 14.2 关键配置

```yaml
# application-reasoning.yml
reasoning:
  verification:
    # 模式：STREAM(实时) | BATCH(批量) | HYBRID(混合)
    default-mode: HYBRID

    # 规则校验
    rule:
      enabled: true
      timeout-ms: 100

    # 符号引擎
    symbolic:
      enabled: true
      timeout-ms: 300
      engine: sympy  # sympy | mathematica
      service-url: http://symbolic-service:8080

    # 模型校验
    model:
      enabled: true
      timeout-ms: 2000
      # 使用与生成不同的模型，避免同模型盲区
      verifier-model: deepseek-v3
      temperature: 0.0
      max-tokens: 500

    # 重试
    retry:
      max-retries: 2
      single-timeout-ms: 5000
      default-strategy: PARTIAL_REGEN

    # 完整性检测
    completeness:
      strict-mode: false
      check-method-alignment: true

    # 流式校验
    streaming:
      enabled: true
      step-boundary-detection: true
      parallel-verification: true

    # 质量画像
    profile:
      aggregation-cron: "0 0 * * * *"  # 每天聚合一次
      retention-days: 90
```

---

## 15. 演进路线

### Phase 1: MVP（1-2周）
- 实现步骤拆解器（规则为主）
- 实现规则校验器（四则运算、单位校验）
- 实现整链校验流程
- 仅支持数学学科

### Phase 2: V1.0（3-4周）
- 接入 SymPy 符号引擎
- 实现模型校验器
- 实现流式校验
- 扩展到物理、化学学科
- 实现定向重试

### Phase 3: V1.5（5-8周）
- 实现并行校验优化
- 实现质量画像聚合
- 对接 Prompt 管理系统
- 对接模型评测基准
- 扩展到生物学科

### Phase 4: V2.0（长期）
- 训练专用步骤校验轻量模型（替代通用大模型校验，降低成本和延迟）
- 支持几何证明题的形式化验证
- 接入知识图谱进行步骤级知识溯源
- 实现跨语言的推理链校验（支持中英文混合推理）
