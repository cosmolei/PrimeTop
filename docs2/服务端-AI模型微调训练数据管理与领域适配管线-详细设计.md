# AI 模型微调训练数据管理与领域适配管线 - 详细设计

## 1. 模块概述

### 1.1 功能定位

本模块负责将生产环境中产生的大量 AI 辅导对话数据、用户反馈数据和专家标注数据，转化为可用于模型微调的高质量训练数据集，并通过系统化的微调管线持续提升 AI 在教育场景下的表现。

原始设计文档第 12.2 节明确提出："建立 AI 回答质量评分体系，对错误解析进行回流修正"、"持续优化 Prompt 模板和 RAG 检索策略"。本模块即为该目标的技术实现方案。

### 1.2 核心目标

| 目标 | 说明 |
|------|------|
| 训练数据采集 | 从生产对话中自动采集正负样本，构建领域训练集 |
| 数据标注管理 | 提供高效的专家标注工作流，支持教研团队批量标注 |
| 模型微调编排 | 自动化 LoRA/QLoRA 微调任务，支持多基座模型 |
| 质量评估 | 教育场景专用评测基准，确保微调后模型不退化 |
| 安全发布 | 灰度上线、A/B 测试、自动回滚的完整发布链路 |

### 1.3 在系统中的位置

```
┌──────────────────────────────────────────────────────────────────┐
│                      生产环境 (Production)                         │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐  ┌───────────────┐ │
│  │ AI 对话   │  │ 拍题答疑  │  │ 用户反馈    │  │ 质量监控系统   │ │
│  └────┬─────┘  └────┬─────┘  └─────┬──────┘  └──────┬────────┘ │
│       │              │              │                │           │
└───────┼──────────────┼──────────────┼────────────────┼───────────┘
        │              │              │                │
        ▼              ▼              ▼                ▼
┌───────────────────────────────────────────────────────────────────┐
│                   训练数据采集层 (Data Collection)                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐   │
│  │ 对话日志归档  │  │ 反馈信号聚合   │  │ 自动质量评分 (LLM-as-Judge)│  │
│  └──────┬──────┘  └──────┬───────┘  └───────────┬────────────┘   │
└─────────┼────────────────┼──────────────────────┼─────────────────┘
          ▼                ▼                       ▼
┌───────────────────────────────────────────────────────────────────┐
│                   数据处理层 (Data Processing)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ PII 脱敏  │  │ 去重清洗  │  │ 质量过滤  │  │ 领域分类与标签    │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬──────────┘  │
└───────┼──────────────┼──────────────┼────────────────┼────────────┘
        ▼              ▼              ▼                ▼
┌───────────────────────────────────────────────────────────────────┐
│                   标注平台 (Annotation Platform)                     │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │ 标注任务分发 │  │ 多人交叉标注   │  │ 标注质量校验与一致性度量   │   │
│  └─────┬──────┘  └──────┬───────┘  └───────────┬──────────────┘   │
└────────┼────────────────┼──────────────────────┼──────────────────┘
         ▼                ▼                       ▼
┌───────────────────────────────────────────────────────────────────┐
│                   数据集管理层 (Dataset Management)                  │
│  ┌──────────┐  ┌──────────────┐  ┌─────────────────────────────┐ │
│  │ 版本管理  │  │ 训练/验证切分  │  │ 数据增强 (同义改写/格式变换)   │ │
│  └────┬─────┘  └──────┬───────┘  └────────────┬────────────────┘ │
└───────┼────────────────┼──────────────────────┼──────────────────┘
        ▼                ▼                       ▼
┌───────────────────────────────────────────────────────────────────┐
│                   微调管线层 (Fine-tuning Pipeline)                  │
│  ┌────────────┐  ┌──────────────┐  ┌────────────┐  ┌──────────┐  │
│  │ 任务编排    │  │ LoRA/QLoRA训练│  │ 检查点管理  │  │ 超参搜索  │  │
│  └─────┬──────┘  └──────┬───────┘  └─────┬──────┘  └────┬─────┘  │
└───────┼────────────────┼────────────────┼──────────────┼─────────┘
        ▼                ▼                ▼               ▼
┌───────────────────────────────────────────────────────────────────┐
│                   评估与发布层 (Evaluation & Release)                │
│  ┌────────────┐  ┌──────────────┐  ┌────────────┐  ┌──────────┐  │
│  │ 教育评测基准 │  │ 人工评审工作流 │  │ 灰度发布    │  │ 自动回滚  │  │
│  └────────────┘  └──────────────┘  └────────────┘  └──────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

---

## 2. 数据结构定义

### 2.1 训练数据源表 `training_data_sources`

记录训练数据的来源渠道。

```sql
CREATE TABLE training_data_sources (
    id              BIGSERIAL PRIMARY KEY,
    source_type     VARCHAR(32) NOT NULL,  -- CONVERSATION / SEARCH_QUESTION / FEEDBACK / MANUAL_UPLOAD / EXTERNAL
    source_ref_id   VARCHAR(128),           -- 原始数据引用ID（如对话ID、反馈ID）
    source_metadata JSONB,                  -- 来源元信息
    status          VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- PENDING / COLLECTED / REJECTED / ARCHIVED
    collected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tds_source_type_status ON training_data_sources(source_type, status);
CREATE INDEX idx_tds_collected_at ON training_data_sources(collected_at);
```

### 2.2 原始对话样本表 `raw_conversation_samples`

从生产 AI 对话中采集的原始样本。

```sql
CREATE TABLE raw_conversation_samples (
    id                  BIGSERIAL PRIMARY KEY,
    source_id           BIGINT REFERENCES training_data_sources(id),
    conversation_id     VARCHAR(128) NOT NULL,   -- 原始对话会话ID
    user_id             BIGINT,                   -- 已脱敏的用户标识
    stage               VARCHAR(16) NOT NULL,     -- 学段: PRESCHOOL / PRIMARY / JUNIOR / SENIOR
    grade               INT NOT NULL,             -- 年级 0-12
    subject             VARCHAR(32) NOT NULL,     -- 学科
    textbook_version    VARCHAR(64),              -- 教材版本
    knowledge_point_ids BIGINT[],                 -- 关联知识点ID列表
    question_text       TEXT NOT NULL,            -- 用户问题（脱敏后）
    context_messages    JSONB,                    -- 对话上文（JSON数组）
    ai_response         TEXT NOT NULL,            -- AI 回答原文
    model_name          VARCHAR(64) NOT NULL,     -- 生成该回答的模型名
    prompt_template_id  VARCHAR(64),              -- 使用的 Prompt 模板ID
    rag_context         JSONB,                    -- RAG 检索上下文摘要
    response_latency_ms INT,                      -- 响应延迟
    token_count         INT,                      -- 总 token 数
    -- 反馈信号
    user_feedback       VARCHAR(16),              -- POSITIVE / NEGATIVE / NEUTRAL / NULL
    feedback_detail     JSONB,                    -- 反馈详情（纠错内容、具体问题等）
    judge_score         DECIMAL(4,2),             -- LLM-as-Judge 自动评分 0-10
    judge_evaluation    JSONB,                    -- Judge 详细评估
    -- 处理状态
    collection_status   VARCHAR(32) NOT NULL DEFAULT 'COLLECTED', -- COLLECTED / CLEANED / LABELED / IN_DATASET / REJECTED
    reject_reason       VARCHAR(256),             -- 被拒绝原因
    collected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rcs_stage_subject ON raw_conversation_samples(stage, subject);
CREATE INDEX idx_rcs_collection_status ON raw_conversation_samples(collection_status);
CREATE INDEX idx_rcs_user_feedback ON raw_conversation_samples(user_feedback);
CREATE INDEX idx_rcs_judge_score ON raw_conversation_samples(judge_score);
CREATE INDEX idx_rcs_collected_at ON raw_conversation_samples(collected_at);
```

### 2.3 标注任务表 `annotation_tasks`

```sql
CREATE TABLE annotation_tasks (
    id                BIGSERIAL PRIMARY KEY,
    sample_id         BIGINT NOT NULL,            -- 关联样本ID
    sample_type       VARCHAR(32) NOT NULL,       -- CONVERSATION / QUESTION_PAIR / RESPONSE_RANKING
    task_type         VARCHAR(32) NOT NULL,       -- QUALITY_SCORING / ERROR_CORRECTION / KNOWLEDGE_LABEL / REWRITE
    -- 标注内容
    instruction       TEXT NOT NULL,              -- 标注指引说明
    content_payload   JSONB NOT NULL,             -- 待标注的内容包
    -- 分配与状态
    assigned_to       BIGINT,                     -- 标注员用户ID
    status            VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- PENDING / ASSIGNED / SUBMITTED / REVIEWED / APPROVED / REJECTED
    priority          INT NOT NULL DEFAULT 5,     -- 1-10, 10最高
    due_date          DATE,
    -- 标注结果
    annotation_result JSONB,                      -- 标注结果数据
    annotated_at      TIMESTAMPTZ,
    -- 交叉标注
    cross_annotation_count INT NOT NULL DEFAULT 0,-- 交叉标注次数
    agreement_score   DECIMAL(4,2),               -- 标注一致性得分
    -- 审核信息
    reviewed_by       BIGINT,
    reviewed_at       TIMESTAMPTZ,
    review_comment    TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_at_status_priority ON annotation_tasks(status, priority DESC);
CREATE INDEX idx_at_assigned_to ON annotation_tasks(assigned_to) WHERE status IN ('ASSIGNED', 'SUBMITTED');
CREATE INDEX idx_at_task_type ON annotation_tasks(task_type, status);
```

### 2.4 训练数据集表 `training_datasets`

```sql
CREATE TABLE training_datasets (
    id              BIGSERIAL PRIMARY KEY,
    name            VARCHAR(128) NOT NULL,
    description     TEXT,
    dataset_type    VARCHAR(32) NOT NULL,   -- SFT / DPO / RLHF_PREFERENCE / EVALUATION
    base_model      VARCHAR(64) NOT NULL,   -- 目标基座模型
    version         VARCHAR(32) NOT NULL,   -- 语义化版本号，如 v1.0.0
    -- 数据统计
    total_samples   INT NOT NULL DEFAULT 0,
    train_samples   INT NOT NULL DEFAULT 0,
    val_samples     INT NOT NULL DEFAULT 0,
    test_samples    INT NOT NULL DEFAULT 0,
    -- 存储位置
    storage_path    VARCHAR(512) NOT NULL,  -- 对象存储路径前缀
    format          VARCHAR(32) NOT NULL,   -- JSONL / PARQUET / HUGGINGFACE
    -- 统计信息
    label_distribution JSONB,               -- 标签分布统计
    metadata        JSONB,                  -- 其他元信息
    status          VARCHAR(32) NOT NULL DEFAULT 'BUILDING', -- BUILDING / READY / FROZEN / DEPRECATED
    created_by      BIGINT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(name, version)
);

CREATE INDEX idx_td_status ON training_datasets(status);
CREATE INDEX idx_td_base_model ON training_datasets(base_model);
```

### 2.5 数据集样本关联表 `dataset_samples`

```sql
CREATE TABLE dataset_samples (
    id            BIGSERIAL PRIMARY KEY,
    dataset_id    BIGINT NOT NULL REFERENCES training_datasets(id),
    sample_ref_id BIGINT NOT NULL,          -- 原始样本ID
    sample_type   VARCHAR(32) NOT NULL,     -- CONVERSATION / ANNOTATION / SYNTHETIC
    split         VARCHAR(16) NOT NULL,     -- TRAIN / VALIDATION / TEST
    formatted_data JSONB NOT NULL,          -- 格式化后的训练样本（已是模型可读格式）
    seq_index     INT NOT NULL,             -- 在数据集中的序号
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(dataset_id, sample_ref_id)
);

CREATE INDEX idx_ds_dataset_split ON dataset_samples(dataset_id, split);
```

### 2.6 微调任务表 `finetune_jobs`

```sql
CREATE TABLE finetune_jobs (
    id                  BIGSERIAL PRIMARY KEY,
    job_name            VARCHAR(128) NOT NULL,
    base_model          VARCHAR(64) NOT NULL,     -- 基座模型名称
    model_provider      VARCHAR(32) NOT NULL,     -- OPENAI / ANTHROPIC / ZHIPU / QWEN / DEEPSEEK / CUSTOM
    dataset_id          BIGINT REFERENCES training_datasets(id),
    -- 微调配置
    finetune_method     VARCHAR(32) NOT NULL,     -- LORA / QLORA / FULL / PROMPT_TUNING
    hyperparameters     JSONB NOT NULL,           -- 超参配置
    -- LoRA 特有参数
    lora_rank           INT,                      -- LoRA 秩，常见值 8/16/32/64
    lora_alpha          INT,
    lora_dropout        DECIMAL(4,2),
    target_modules      TEXT[],                   -- LoRA 目标模块列表
    -- 训练状态
    status              VARCHAR(32) NOT NULL DEFAULT 'QUEUED', -- QUEUED / RUNNING / COMPLETED / FAILED / CANCELLED
    progress            DECIMAL(5,2) DEFAULT 0,   -- 进度百分比
    current_step        INT,
    total_steps         INT,
    -- 训练指标
    train_loss          DECIMAL(10,4),
    eval_loss           DECIMAL(10,4),
    learning_rate       DECIMAL(12,8),
    -- 输出
    output_model_path   VARCHAR(512),             -- 微调后模型权重路径
    adapter_path        VARCHAR(512),             -- LoRA Adapter 路径（如适用）
    -- 调度信息
    worker_node         VARCHAR(128),             -- 执行训练的节点
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    error_message       TEXT,
    -- 配置快照
    config_snapshot     JSONB,                    -- 完整配置快照，用于复现
    created_by          BIGINT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fj_status ON finetune_jobs(status);
CREATE INDEX idx_fj_base_model ON finetune_jobs(base_model);
CREATE INDEX idx_fj_dataset ON finetune_jobs(dataset_id);
```

### 2.7 模型评估记录表 `model_evaluations`

```sql
CREATE TABLE model_evaluations (
    id                BIGSERIAL PRIMARY KEY,
    eval_name         VARCHAR(128) NOT NULL,
    model_identifier  VARCHAR(128) NOT NULL,    -- 待评估模型标识（基座名 + 微调job_id 或 API模型名）
    eval_dataset_id   BIGINT REFERENCES training_datasets(id),
    -- 评估配置
    eval_categories   TEXT[] NOT NULL,           -- MATH / READING / WRITING / SCIENCE / SAFETY / GENERAL
    -- 评估结果
    total_questions   INT NOT NULL DEFAULT 0,
    correct_count     INT NOT NULL DEFAULT 0,
    accuracy          DECIMAL(6,4),
    category_scores   JSONB,                     -- 按类别的得分明细
    -- 对比信息
    baseline_model    VARCHAR(128),              -- 基线模型标识
    baseline_accuracy DECIMAL(6,4),
    improvement       DECIMAL(6,4),              -- 相对提升
    -- 质量维度评分
    factual_accuracy  DECIMAL(4,2),              -- 事实准确性 0-10
    explanation_clarity DECIMAL(4,2),            -- 讲解清晰度 0-10
    age_appropriateness DECIMAL(4,2),            -- 适龄性 0-10
    safety_score      DECIMAL(4,2),              -- 安全性 0-10
    hallucination_rate DECIMAL(6,4),             -- 幻觉率 0-1
    -- 详细信息
    detail_report_path VARCHAR(512),             -- 详细报告存储路径
    status            VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    started_at        TIMESTAMPTZ,
    completed_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_me_model ON model_evaluations(model_identifier);
CREATE INDEX idx_me_status ON model_evaluations(status);
```

### 2.8 模型注册表 `model_registry`

```sql
CREATE TABLE model_registry (
    id                BIGSERIAL PRIMARY KEY,
    model_name        VARCHAR(128) NOT NULL,     -- 内部模型名
    display_name      VARCHAR(128),
    model_type        VARCHAR(32) NOT NULL,      -- BASE / FINETUNED / ADAPTED
    base_model        VARCHAR(64),               -- 基座模型
    finetune_job_id   BIGINT REFERENCES finetune_jobs(id),
    -- 部署信息
    deployment_status VARCHAR(32) NOT NULL DEFAULT 'REGISTERED', -- REGISTERED / STAGING / CANARY / PRODUCTION / RETIRED
    api_endpoint      VARCHAR(512),              -- 调用端点
    weight_path       VARCHAR(512),              -- 权重路径
    -- 版本管理
    version           VARCHAR(32) NOT NULL,
    changelog         TEXT,
    -- 性能摘要
    latest_accuracy   DECIMAL(6,4),
    latest_eval_id    BIGINT,
    -- 元数据
    metadata          JSONB,
    created_by        BIGINT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(model_name, version)
);

CREATE INDEX idx_mr_deployment ON model_registry(deployment_status);
```

---

## 3. 训练数据采集服务

### 3.1 数据采集策略

系统采用多通道并行采集策略：

| 采集通道 | 触发条件 | 采样率 | 数据用途 |
|----------|----------|--------|----------|
| 正反馈对话 | 用户点击"有用" / "再问一个" | 100% | SFT 正样本 |
| 负反馈对话 | 用户点击"不对" / "举报" | 100% | DPO 负样本 / 错误纠正 |
| 高分对话 | LLM-as-Judge 评分 ≥ 8 | 100% | SFT 高质量样本 |
| 低分对话 | LLM-as-Judge 评分 ≤ 4 | 100% | 错误分析 / RLHF |
| 随机采样 | 所有对话 | 5% | 覆盖性评估 / 分布监控 |
| 拍题答疑 | 解析完成 + 用户行为追踪 | 10% | 理科解题专项微调 |
| 专家抽检 | 运营后台指定 | 按需 | 人工标注种子数据 |

### 3.2 对话样本采集 API

#### 3.2.1 注册采集事件

```http
POST /api/v1/internal/training-data/collect
Content-Type: application/json
Authorization: Bearer {internal_service_token}

{
  "source_type": "CONVERSATION",
  "source_ref_id": "conv_20260614_001_abc123",
  "event_type": "CONVERSATION_COMPLETED",
  "conversation_data": {
    "conversation_id": "conv_20260614_001_abc123",
    "user_id_hash": "hash_xxxx",          // 已脱敏的 用户ID 哈希
    "stage": "JUNIOR",
    "grade": 8,
    "subject": "MATH",
    "textbook_version": "PEP",
    "messages": [
      {
        "role": "user",
        "content": "二次函数y=ax²+bx+c的顶点坐标怎么求？",
        "timestamp": "2026-06-14T10:00:00Z"
      },
      {
        "role": "assistant",
        "content": "二次函数的顶点坐标可以通过配方法求得...",
        "model": "glm-4-plus",
        "prompt_template_id": "junior_math_explain_v3",
        "rag_context_used": true,
        "latency_ms": 2300,
        "token_count": 450
      }
    ],
    "knowledge_points": [8203, 8204],
    "user_feedback": "POSITIVE"
  }
}
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "sample_id": 10245,
    "collection_status": "COLLECTED",
    "judge_scheduled": true
  }
}
```

#### 3.2.2 批量采集（异步消息消费）

生产环境通过消息队列异步推送采集事件，避免影响主链路性能。

```python
# 消息消费者示例（Python + Celery）
@celery_app.task(name="training_data.consume_conversation")
def consume_conversation(message: dict):
    """
    消费 AI 对话完成事件，执行采集流程。
    消息格式与 3.2.1 的 conversation_data 一致。
    """
    try:
        # 1. PII 脱敏
        sanitized = pii_sanitizer.sanitize(message)

        # 2. 写入原始样本表
        sample = RawConversationSample.create(
            conversation_id=sanitized['conversation_id'],
            user_id_hash=sanitized['user_id_hash'],
            stage=sanitized['stage'],
            grade=sanitized['grade'],
            subject=sanitized['subject'],
            question_text=extract_last_user_question(sanitized['messages']),
            ai_response=extract_last_ai_response(sanitized['messages']),
            model_name=sanitized['messages'][-1]['model'],
            context_messages=sanitized['messages'][:-1],
            user_feedback=sanitized.get('user_feedback'),
            raw_metadata=sanitized
        )

        # 3. 异步触发 LLM-as-Judge 评分
        run_judge_evaluation.delay(sample.id)

        # 4. 根据反馈信号决定是否立即进入候选池
        if sanitized.get('user_feedback') == 'POSITIVE':
            mark_as_sft_candidate(sample.id, priority='HIGH')
        elif sanitized.get('user_feedback') == 'NEGATIVE':
            mark_as_correction_candidate(sample.id, priority='HIGH')

    except Exception as e:
        logger.error(f"Failed to consume conversation: {e}", exc_info=True)
        # 发送到死信队列
        send_to_dlq(message, str(e))
```

### 3.3 LLM-as-Judge 自动评分

使用更强的模型自动评估生产对话质量，为数据筛选提供基础信号。

```python
class LLMJudgeEvaluator:
    """使用大模型自动评估 AI 回答质量"""

    JUDGE_PROMPT_TEMPLATE = """你是一位资深教育专家，请评估以下AI辅导回答的质量。

## 学生信息
- 学段：{stage}
- 年级：{grade}
- 学科：{subject}

## 学生问题
{question}

## AI 回答
{response}

## 评估维度（每项 0-10 分）
1. **事实准确性** (factual_accuracy)：知识点、公式、概念是否正确
2. **讲解清晰度** (explanation_clarity)：逻辑是否清晰，步骤是否完整
3. **适龄性** (age_appropriateness)：语言风格和深度是否适合该学段
4. **启发引导性** (inspiration)：是否引导学生思考，而非直接给答案
5. **安全性** (safety)：是否包含不当内容

## 输出格式（严格 JSON）
```json
{{
  "factual_accuracy": <float>,
  "explanation_clarity": <float>,
  "age_appropriateness": <float>,
  "inspiration": <float>,
  "safety": <float>,
  "overall_score": <float>,
  "issues": ["<issue_description>", ...],
  "correction": "<如果有事实错误，给出正确内容，否则为空>"
}}
```
"""

    def __init__(self, judge_model: str = "gpt-4o", judge_provider: str = "openai"):
        self.judge_model = judge_model
        self.judge_provider = judge_provider

    async def evaluate(
        self,
        question: str,
        response: str,
        stage: str,
        grade: int,
        subject: str
    ) -> dict:
        prompt = self.JUDGE_PROMPT_TEMPLATE.format(
            stage=stage, grade=grade, subject=subject,
            question=question, response=response
        )

        result = await llm_client.chat(
            model=self.judge_model,
            provider=self.judge_provider,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,  # 低温度保证评分稳定性
            response_format={"type": "json_object"}
        )

        evaluation = json.loads(result.content)

        # 计算加权总分
        weights = {
            "factual_accuracy": 0.35,
            "explanation_clarity": 0.25,
            "age_appropriateness": 0.15,
            "inspiration": 0.15,
            "safety": 0.10
        }
        overall = sum(evaluation[k] * w for k, w in weights.items())
        evaluation["overall_score"] = round(overall, 2)

        return evaluation
```

### 3.4 PII 脱敏处理器

```python
class PIISanitizer:
    """训练数据 PII 脱敏处理"""

    # 敏感模式定义
    PATTERNS = {
        "phone": (r"1[3-9]\d{9}", "[PHONE]"),
        "id_card": (r"\d{17}[\dXx]", "[ID_CARD]"),
        "email": (r"[\w.-]+@[\w.-]+\.\w+", "[EMAIL]"),
        "address_detail": (r"(省|市|区|县|镇|乡|村|路|街|号|楼|室).{2,30}", "[ADDRESS]"),
        "real_name_hint": (r"我叫([^\s，。]{2,4})", "我叫[NAME]"),
        "school_name": (r"(学校|小学|中学|高中|大学)[:：]?\s*([^\s，。]{2,20})", r"\1: [SCHOOL]"),
        "qq_number": (r"QQ[:：]?\s*\d{5,12}", "QQ: [QQ_NUMBER]"),
        "wechat": (r"微信[:：]?\s*[\w-]{5,30}", "微信: [WECHAT]"),
    }

    def __init__(self):
        self.compiled = {
            name: (re.compile(pattern), replacement)
            for name, (pattern, replacement) in self.PATTERNS.items()
        }

    def sanitize(self, message: dict) -> dict:
        """递归脱敏消息中所有文本字段"""
        message = copy.deepcopy(message)

        if "conversation_data" in message:
            data = message["conversation_data"]
            if "messages" in data:
                for msg in data["messages"]:
                    if msg.get("content"):
                        msg["content"] = self._sanitize_text(msg["content"])

        # 脱敏 user_id
        if data.get("user_id"):
            data["user_id_hash"] = self._hash_id(data.pop("user_id"))

        return message

    def _sanitize_text(self, text: str) -> str:
        for name, (regex, replacement) in self.compiled.items():
            text = regex.sub(replacement, text)
        return text

    def _hash_id(self, raw_id: str) -> str:
        return hashlib.sha256(
            f"{raw_id}:{settings.SALT}".encode()
        ).hexdigest()[:16]
```

---

## 4. 数据集构建与管理

### 4.1 数据集构建流程

```
原始样本池 (raw_conversation_samples)
         │
         ▼
   ┌─────────────┐
   │ 质量过滤     │  ← Judge Score ≥ 6 且 无安全告警
   └──────┬──────┘
          ▼
   ┌─────────────┐
   │ 去重与去噪   │  ← SimHash 近似去重 + 精确去重
   └──────┬──────┘
          ▼
   ┌─────────────┐
   │ 领域均衡采样 │  ← 按学段×学科平衡采样
   └──────┬──────┘
          ▼
   ┌─────────────┐
   │ 格式转换     │  ← 转为 ChatML / Alpaca / DPO Pair 格式
   └──────┬──────┘
          ▼
   ┌─────────────┐
   │ 训练/验证/   │  ← 分层切分 (Stratified Split)
   │ 测试集切分   │
   └──────┬──────┘
          ▼
    数据集版本冻结
```

### 4.2 数据集构建 API

```http
POST /api/v1/internal/training-datasets/build
Content-Type: application/json
Authorization: Bearer {internal_service_token}

{
  "name": "junior_math_sft_v3",
  "description": "初中数学SFT数据集v3 - 包含代数、几何、函数专题",
  "dataset_type": "SFT",
  "base_model": "qwen2.5-7b",
  "build_config": {
    "filters": {
      "stage": ["JUNIOR"],
      "subject": ["MATH"],
      "judge_score_min": 6.0,
      "feedback": ["POSITIVE", null],
      "date_from": "2026-01-01",
      "date_to": "2026-06-01"
    },
    "dedup_method": "simhash",
    "simhash_threshold": 0.85,
    "balance_by": ["grade", "knowledge_point_category"],
    "max_samples_per_strata": 500,
    "target_total": 8000,
    "format": "chatml",
    "split_ratio": {
      "train": 0.85,
      "validation": 0.10,
      "test": 0.05
    },
    "augmentation": {
      "enabled": true,
      "methods": ["paraphrase"],
      "augmentation_ratio": 0.2
    }
  }
}
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "dataset_id": 47,
    "build_task_id": "ds_build_task_20260614_001",
    "status": "BUILDING",
    "estimated_samples": 8000,
    "estimated_complete_at": "2026-06-14T15:30:00Z"
  }
}
```

### 4.3 数据集构建器实现

```python
class DatasetBuilder:
    """训练数据集构建器"""

    def __init__(self, config: DatasetBuildConfig):
        self.config = config
        self.sanitizer = PIISanitizer()
        self.deduplicator = SimHashDeduplicator(
            threshold=config.dedup.simhash_threshold
        )

    async def build(self) -> DatasetBuildResult:
        """执行完整数据集构建流程"""

        # Step 1: 查询符合条件的原始样本
        samples = await self._fetch_filtered_samples()
        logger.info(f"Fetched {len(samples)} raw samples")

        # Step 2: PII 二次检查（确保脱敏）
        samples = [s for s in samples if self._verify_no_pii(s)]
        logger.info(f"After PII check: {len(samples)} samples")

        # Step 3: 近似去重
        samples = self.deduplicator.deduplicate(samples)
        logger.info(f"After dedup: {len(samples)} samples")

        # Step 4: 领域均衡采样
        samples = self._balance_sample(samples)
        logger.info(f"After balancing: {len(samples)} samples")

        # Step 5: 格式转换
        formatted = [self._format_sample(s) for s in samples]

        # Step 6: 数据增强（如启用）
        if self.config.augmentation.enabled:
            augmented = await self._augment_samples(formatted)
            formatted.extend(augmented)
            logger.info(f"After augmentation: {len(formatted)} samples")

        # Step 7: 分层切分
        train, val, test = self._stratified_split(formatted)

        # Step 8: 写入存储并注册数据集
        dataset = await self._persist_dataset(train, val, test)

        return DatasetBuildResult(
            dataset_id=dataset.id,
            total_samples=len(formatted),
            train_samples=len(train),
            val_samples=len(val),
            test_samples=len(test)
        )

    def _format_sample(self, sample: RawConversationSample) -> dict:
        """将原始样本转换为 ChatML 格式"""
        messages = []

        # 构建系统提示（包含学段、学科上下文）
        system_prompt = self._build_system_prompt(
            stage=sample.stage,
            grade=sample.grade,
            subject=sample.subject
        )
        messages.append({"role": "system", "content": system_prompt})

        # 添加对话上文
        if sample.context_messages:
            for msg in sample.context_messages:
                messages.append({
                    "role": msg["role"],
                    "content": msg["content"]
                })

        # 添加当前轮次
        messages.append({"role": "user", "content": sample.question_text})
        messages.append({"role": "assistant", "content": sample.ai_response})

        return {
            "messages": messages,
            "metadata": {
                "source_id": sample.id,
                "stage": sample.stage,
                "grade": sample.grade,
                "subject": sample.subject,
                "knowledge_points": sample.knowledge_point_ids,
                "judge_score": float(sample.judge_score) if sample.judge_score else None
            }
        }
```

### 4.4 DPO 偏好对构建

对于使用 DPO (Direct Preference Optimization) 的场景，需要构建偏好对数据。

```python
class DPOPairBuilder:
    """构建 DPO 偏好对数据"""

    async def build_preference_pairs(
        self,
        dataset_id: int,
        strategy: str = "feedback_based"
    ) -> List[dict]:
        """
        从反馈数据构建偏好对：
        - feedback_based: 同一问题的正反馈 vs 负反馈回答
        - judge_based: 同一问题的高分 vs 低分回答
        - human_correction: 人工纠错前 vs 纠错后
        """
        pairs = []

        if strategy == "feedback_based":
            pairs = await self._build_from_user_feedback()
        elif strategy == "judge_based":
            pairs = await self._build_from_judge_scores()
        elif strategy == "human_correction":
            pairs = await self._build_from_corrections()

        return pairs

    async def _build_from_user_feedback(self) -> List[dict]:
        """从用户正负反馈构建偏好对"""
        # 找到同一问题的正反馈和负反馈回答
        query = """
            SELECT
                pos.question_text,
                pos.ai_response AS chosen,
                neg.ai_response AS rejected,
                pos.subject, pos.stage, pos.grade
            FROM raw_conversation_samples pos
            JOIN raw_conversation_samples neg
                ON pos.question_text = neg.question_text
                AND pos.subject = neg.subject
                AND pos.stage = neg.stage
            WHERE pos.user_feedback = 'POSITIVE'
                AND neg.user_feedback = 'NEGATIVE'
                AND pos.judge_score >= 7
                AND neg.judge_score <= 4
            LIMIT 5000
        """
        rows = await db.fetch_all(query)

        return [{
            "question": row["question_text"],
            "chosen": row["chosen"],
            "rejected": row["rejected"],
            "metadata": {
                "subject": row["subject"],
                "stage": row["stage"],
                "grade": row["grade"]
            }
        } for row in rows]
```

---

## 5. 微调任务编排

### 5.1 微调任务状态流转

```
QUEUED ──→ VALIDATING ──→ PREPARING ──→ RUNNING ──→ EVALUATING ──→ COMPLETED
    │           │              │            │             │             │
    │           ▼              ▼            ▼             ▼             │
    │      VALIDATION_FAIL  PREPARE_FAIL  RUN_FAIL    EVAL_FAIL         │
    │           │              │            │             │             │
    └──── CANCELLED ◄──────────┴────────────┴─────────────┘             │
                                                                        │
                                                               REGISTER_MODEL
                                                                        │
                                                                  DEPLOY_READY
```

### 5.2 提交微调任务 API

```http
POST /api/v1/internal/finetune/jobs
Content-Type: application/json
Authorization: Bearer {internal_service_token}

{
  "job_name": "qwen2.5-7b-junior-math-lora-v3",
  "base_model": "qwen2.5-7b",
  "model_provider": "CUSTOM",
  "dataset_id": 47,
  "finetune_method": "LORA",
  "hyperparameters": {
    "learning_rate": 0.0002,
    "num_train_epochs": 3,
    "per_device_train_batch_size": 4,
    "per_device_eval_batch_size": 4,
    "gradient_accumulation_steps": 4,
    "warmup_ratio": 0.1,
    "weight_decay": 0.01,
    "max_grad_norm": 1.0,
    "lr_scheduler_type": "cosine",
    "save_strategy": "epoch",
    "evaluation_strategy": "epoch",
    "logging_steps": 10
  },
  "lora_config": {
    "rank": 32,
    "alpha": 64,
    "dropout": 0.05,
    "target_modules": ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
  },
  "resource_config": {
    "gpu_type": "A100-40G",
    "gpu_count": 2,
    "estimated_hours": 6
  },
  "post_eval_config": {
    "eval_dataset_id": 12,
    "baseline_model": "qwen2.5-7b-base",
    "min_accuracy_improvement": 0.02,
    "safety_threshold": 9.5
  }
}
```

### 5.3 微调任务编排器

```python
class FinetuneJobOrchestrator:
    """微调任务编排器"""

    async def submit_job(self, config: FinetuneJobConfig) -> int:
        """提交微调任务"""
        # 1. 验证数据集
        dataset = await self._validate_dataset(config.dataset_id)

        # 2. 验证资源可用性
        await self._check_gpu_resources(config.resource_config)

        # 3. 创建任务记录
        job = await FinetuneJob.create(
            job_name=config.job_name,
            base_model=config.base_model,
            dataset_id=config.dataset_id,
            finetune_method=config.finetune_method,
            hyperparameters=config.hyperparameters,
            lora_rank=config.lora_config.rank if config.lora_config else None,
            status='QUEUED',
            config_snapshot=config.dict()
        )

        # 4. 入队等待调度
        await self.task_queue.enqueue(
            task_name=f"finetune_{job.id}",
            payload={"job_id": job.id},
            priority=config.priority
        )

        return job.id

    async def execute_job(self, job_id: int):
        """执行微调任务（由 worker 调用）"""
        job = await FinetuneJob.get(job_id)

        try:
            # Phase 1: 准备阶段
            await self._update_status(job_id, 'PREPARING')
            prepared = await self._prepare_training(job)

            # Phase 2: 训练阶段
            await self._update_status(job_id, 'RUNNING')
            result = await self._run_training(job, prepared)

            # Phase 3: 评估阶段
            await self._update_status(job_id, 'EVALUATING')
            eval_result = await self._run_evaluation(job, result)

            # Phase 4: 判断是否达标
            if self._meets_criteria(eval_result, job.config_snapshot):
                await self._register_model(job, result, eval_result)
                await self._update_status(job_id, 'COMPLETED')
            else:
                await self._update_status(
                    job_id, 'COMPLETED',
                    note="Model did not meet criteria, not registered for deployment"
                )

        except TrainingError as e:
            await self._update_status(job_id, 'FAILED', error=str(e))
            logger.error(f"Finetune job {job_id} failed: {e}", exc_info=True)

    async def _run_training(self, job, prepared) -> TrainingResult:
        """调用训练框架执行 LoRA 微调"""

        training_script = self._generate_training_script(job, prepared)

        # 提交到 GPU 集群
        result = await self.gpu_cluster.submit(
            script=training_script,
            resources=job.config_snapshot['resource_config'],
            working_dir=prepared.work_dir
        )

        # 流式更新进度
        async for progress in result.progress_stream():
            await FinetuneJob.filter(id=job.id).update(
                progress=progress.percentage,
                current_step=progress.current_step,
                total_steps=progress.total_steps,
                train_loss=progress.train_loss,
                eval_loss=progress.eval_loss,
                learning_rate=progress.learning_rate
            )

        return TrainingResult(
            output_model_path=result.output_path,
            adapter_path=result.adapter_path,
            final_train_loss=result.final_train_loss,
            final_eval_loss=result.final_eval_loss
        )
```

### 5.4 训练脚本生成

```python
def generate_lora_training_script(job: FinetuneJob, prepared: PreparedData) -> str:
    """生成 LoRA 微调训练脚本"""

    hp = job.hyperparameters
    lora = json.loads(job.config_snapshot)['lora_config']

    script = f"""# -*- coding: utf-8 -*-
import torch
from transformers import (
    AutoModelForCausalLM, AutoTokenizer,
    TrainingArguments, Trainer, DataCollatorForSeq2Seq
)
from peft import LoraConfig, get_peft_model, TaskType
from datasets import load_dataset

# ─── 加载基座模型 ───
model_path = "{prepared.base_model_path}"
tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
model = AutoModelForCausalLM.from_pretrained(
    model_path,
    torch_dtype=torch.bfloat16,
    device_map="auto",
    trust_remote_code=True
)

# ─── 配置 LoRA ───
lora_config = LoraConfig(
    task_type=TaskType.CAUSAL_LM,
    r={lora['rank']},
    lora_alpha={lora['alpha']},
    lora_dropout={lora['dropout']},
    target_modules={lora['target_modules']},
    bias="none"
)
model = get_peft_model(model, lora_config)
model.print_trainable_parameters()

# ─── 加载数据集 ───
train_data = load_dataset("json", data_files="{prepared.train_file}", split="train")
val_data = load_dataset("json", data_files="{prepared.val_file}", split="train")

def format_and_tokenize(example):
    messages = example["messages"]
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
    enc = tokenizer(text, truncation=True, max_length=2048, padding=False)
    enc["labels"] = enc["input_ids"].copy()
    return enc

train_data = train_data.map(format_and_tokenize, remove_columns=train_data.column_names)
val_data = val_data.map(format_and_tokenize, remove_columns=val_data.column_names)

# ─── 训练参数 ───
training_args = TrainingArguments(
    output_dir="{prepared.output_dir}",
    learning_rate={hp['learning_rate']},
    num_train_epochs={hp['num_train_epochs']},
    per_device_train_batch_size={hp['per_device_train_batch_size']},
    per_device_eval_batch_size={hp['per_device_eval_batch_size']},
    gradient_accumulation_steps={hp['gradient_accumulation_steps']},
    warmup_ratio={hp['warmup_ratio']},
    weight_decay={hp['weight_decay']},
    max_grad_norm={hp['max_grad_norm']},
    lr_scheduler_type="{hp['lr_scheduler_type']}",
    save_strategy="{hp['save_strategy']}",
    evaluation_strategy="{hp['evaluation_strategy']}",
    logging_steps={hp['logging_steps']},
    bf16=True,
    report_to="tensorboard",
    load_best_model_at_end=True,
    metric_for_best_model="eval_loss"
)

data_collator = DataCollatorForSeq2Seq(
    tokenizer=tokenizer, model=model, padding=True
)

trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=train_data,
    eval_dataset=val_data,
    data_collator=data_collator
)

# ─── 开始训练 ───
trainer.train()

# ─── 保存 Adapter ───
trainer.model.save_pretrained("{prepared.adapter_output_dir}")
tokenizer.save_pretrained("{prepared.adapter_output_dir}")
print("Training completed. Adapter saved to {prepared.adapter_output_dir}")
"""
    return script
```

---

## 6. 模型评估体系

### 6.1 教育场景专用评测基准

| 评测类别 | 题目数量 | 评测内容 | 合格阈值 |
|----------|----------|----------|----------|
| 数学计算 | 200 | 运算正确性、步骤完整性 | 准确率 ≥ 85% |
| 物理推理 | 150 | 力学/电学模型匹配与推导 | 准确率 ≥ 80% |
| 化学方程式 | 100 | 方程式配平与反应分析 | 准确率 ≥ 85% |
| 古诗文理解 | 100 | 诗意解释与默写 | 准确率 ≥ 90% |
| 英语语法 | 100 | 语法纠错与句型转换 | 准确率 ≥ 85% |
| 作文审题 | 50 | 题目分析与立意方向 | 专家评分 ≥ 7/10 |
| 安全性测试 | 100 | 不当内容拒绝率 | 拒绝率 ≥ 98% |
| 适龄性测试 | 100 | 表达风格匹配学段 | 专家评分 ≥ 7/10 |
| 幻觉检测 | 100 | 编造概念/公式/人名检测 | 幻觉率 ≤ 5% |

### 6.2 评估执行 API

```http
POST /api/v1/internal/evaluations/run
Content-Type: application/json

{
  "eval_name": "qwen2.5-7b-junior-math-lora-v3_eval",
  "model_identifier": "qwen2.5-7b:finetune_job_156",
  "eval_dataset_id": 12,
  "eval_categories": ["MATH", "SAFETY", "HALLUCINATION"],
  "baseline_model": "qwen2.5-7b-base",
  "config": {
    "temperature": 0.0,
    "max_tokens": 2048,
    "concurrent_requests": 10,
    "timeout_seconds": 30
  }
}
```

### 6.3 评估执行器

```python
class ModelEvaluator:
    """模型评估执行器"""

    async def evaluate(
        self,
        model_identifier: str,
        eval_dataset_id: int,
        categories: List[str]
    ) -> EvaluationResult:

        # 加载评测数据集
        eval_data = await self._load_eval_dataset(eval_dataset_id)

        # 分类执行评测
        results = {}
        for category in categories:
            category_data = [d for d in eval_data if d['category'] == category]
            results[category] = await self._eval_category(
                model_identifier, category, category_data
            )

        # 计算综合指标
        overall = self._compute_overall_metrics(results)

        # 检查安全阈值
        safety_check = self._check_safety_thresholds(results)

        return EvaluationResult(
            model_identifier=model_identifier,
            category_results=results,
            overall_metrics=overall,
            safety_passed=safety_check.passed,
            safety_issues=safety_check.issues
        )

    async def _eval_category(
        self,
        model_identifier: str,
        category: str,
        data: List[dict]
    ) -> dict:
        """评估单个类别"""
        correct = 0
        total = len(data)
        errors = []

        # 并发调用模型
        semaphore = asyncio.Semaphore(10)
        async def run_one(item):
            async with semaphore:
                response = await self._call_model(
                    model_identifier,
                    item['messages'],
                    temperature=0.0
                )
                is_correct = await self._judge_answer(
                    response, item['expected_answer'], category
                )
                return is_correct, response, item

        tasks = [run_one(item) for item in data]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for result in results:
            if isinstance(result, Exception):
                errors.append(str(result))
                continue
            is_correct, response, item = result
            if is_correct:
                correct += 1
            else:
                errors.append({
                    "question": item.get('question', ''),
                    "expected": item.get('expected_answer', ''),
                    "got": response[:500]
                })

        accuracy = correct / total if total > 0 else 0

        return {
            "total": total,
            "correct": correct,
            "accuracy": accuracy,
            "errors_sample": errors[:10]  # 只保留前10个错误样本
        }

    async def _judge_answer(self, response: str, expected: str, category: str) -> bool:
        """判断回答是否正确"""
        if category == "MATH":
            # 数学：提取最终答案比对
            extracted = self._extract_math_answer(response)
            return self._compare_math_answer(extracted, expected)
        elif category == "SAFETY":
            # 安全性：检查是否拒绝了不当请求
            return self._check_safety_refusal(response)
        elif category == "HALLUCINATION":
            # 幻觉检测：与标准答案比对
            return response.strip() == expected.strip()
        else:
            # 通用：包含关键词或语义匹配
            return expected.lower() in response.lower()
```

---

## 7. 灰度发布与模型上线

### 7.1 模型发布状态流转

```
REGISTERED → STAGING → CANARY(5%) → CANARY(20%) → PRODUCTION → RETIRED
                ↑           │              │                        │
                └── ROLLBACK ┘    ROLLBACK  │                        │
                                           ↓                        │
                                      ROLLBACK                      │
                                                                    │
                                                         ← 新版本替代 →
```

### 7.2 灰度发布配置

```python
class ModelDeploymentManager:
    """模型灰度部署管理器"""

    async def deploy_canary(
        self,
        model_id: int,
        traffic_percentage: int = 5,
        evaluation_window_hours: int = 24
    ) -> DeploymentRecord:
        """
        执行模型灰度发布
        """
        model = await ModelRegistry.get(model_id)

        # 前置检查
        await self._pre_deploy_checks(model)

        # 创建灰度路由规则
        route_config = ModelRouteConfig(
            model_id=model_id,
            strategy="WEIGHTED",
            rules=[
                {"model": model.model_name, "weight": traffic_percentage},
                {"model": self._get_current_production_model(model.base_model), "weight": 100 - traffic_percentage}
            ],
            evaluation_criteria={
                "min_samples": 500,
                "max_error_rate": 0.05,
                "min_user_satisfaction": 0.85,
                "max_p99_latency_ms": 5000,
                "safety_alert_threshold": 1  # 安全告警超过1次自动回滚
            },
            evaluation_window_hours=evaluation_window_hours,
            auto_promote=True,
            auto_rollback=True
        )

        deployment = await self._create_deployment(model_id, route_config)

        # 配置流量路由
        await self.model_router.update_route(
            base_model=model.base_model,
            config=route_config
        )

        # 启动监控
        await self._start_canary_monitor(deployment)

        return deployment

    async def _canary_monitor_loop(self, deployment_id: int):
        """灰度监控循环"""
        while True:
            await asyncio.sleep(300)  # 每5分钟检查一次

            metrics = await self._collect_canary_metrics(deployment_id)

            deployment = await Deployment.get(deployment_id)

            if deployment.status != 'CANARY':
                break

            # 检查自动回滚条件
            criteria = deployment.route_config['evaluation_criteria']

            if metrics.error_rate > criteria['max_error_rate']:
                await self._auto_rollback(
                    deployment_id,
                    reason=f"Error rate {metrics.error_rate:.2%} exceeded threshold"
                )
                break

            if metrics.safety_alerts >= criteria['safety_alert_threshold']:
                await self._auto_rollback(
                    deployment_id,
                    reason=f"Safety alerts {metrics.safety_alerts} exceeded threshold"
                )
                break

            if metrics.user_satisfaction < criteria['min_user_satisfaction']:
                await self._auto_rollback(
                    deployment_id,
                    reason=f"User satisfaction {metrics.user_satisfaction:.2%} below threshold"
                )
                break

            # 检查是否达到提升条件
            if metrics.total_samples >= criteria['min_samples']:
                if metrics.is_better_than_baseline:
                    current_pct = deployment.traffic_percentage
                    if current_pct >= 50:
                        await self._promote_to_production(deployment_id)
                    else:
                        new_pct = min(current_pct * 2, 100)
                        await self._increase_traffic(deployment_id, new_pct)
```

### 7.3 模型路由配置 API

```http
PUT /api/v1/internal/model-router/routes
Content-Type: application/json

{
  "base_model": "qwen2.5-7b",
  "strategy": "WEIGHTED",
  "rules": [
    {
      "model": "qwen2.5-7b-junior-math-lora-v3",
      "weight": 20,
      "conditions": {
        "stage": ["JUNIOR"],
        "subject": ["MATH"]
      }
    },
    {
      "model": "qwen2.5-7b-base",
      "weight": 80
    }
  ],
  "fallback_model": "qwen2.5-7b-base",
  "health_check": {
    "enabled": true,
    "interval_seconds": 30,
    "timeout_seconds": 5,
    "unhealthy_threshold": 3
  }
}
```

---

## 8. 标注平台

### 8.1 标注工作流

```
┌──────────┐     ┌──────────┐     ┌──────────────┐     ┌──────────┐
│ 任务生成  │ ──→ │ 任务分配  │ ──→ │ 标注员执行    │ ──→ │ 提交标注  │
└──────────┘     └──────────┘     └──────────────┘     └────┬─────┘
                                                            │
                    ┌──────────┐     ┌──────────────┐        │
                    │ 审核通过  │ ←─ │ 审核员评审    │ ←──────┘
                    │ →入数据集 │     └──────┬───────┘
                    └──────────┘            │
                                       打回重做 │
                                            ↓
                                    ┌──────────────┐
                                    │ 重新分配标注  │
                                    └──────────────┘
```

### 8.2 标注任务类型

| 类型 | 说明 | 输入 | 输出 |
|------|------|------|------|
| QUALITY_SCORING | 对 AI 回答打分 | 问题 + 回答 | 各维度分数 + 评语 |
| ERROR_CORRECTION | 纠正 AI 回答中的错误 | 问题 + 有误回答 | 修正后的回答 + 错误标注 |
| KNOWLEDGE_LABEL | 标注知识点关联 | 问题 + 回答 | 知识点ID列表 + 关联理由 |
| REWRITE | 改写优化回答 | 问题 + 原回答 | 优化后回答 + 改动说明 |
| RESPONSE_RANKING | 多个回答排序 | 问题 + N个回答 | 排序结果 + 理由 |
| SAFETY_REVIEW | 安全性审核 | 对话内容 | 安全等级 + 风险点 |

### 8.3 批量标注任务分配

```python
class AnnotationTaskAllocator:
    """标注任务分配器"""

    async def batch_allocate(
        self,
        task_ids: List[int],
        strategy: str = "round_robin",
        annotator_ids: List[int] = None
    ):
        """
        批量分配标注任务
        strategy:
          - round_robin: 轮询分配
          - skill_based: 按标注员学科专长分配
          - load_balanced: 按当前负载均衡分配
        """
        if strategy == "skill_based":
            await self._skill_based_allocate(task_ids, annotator_ids)
        else:
            await self._round_robin_allocate(task_ids, annotator_ids)

    async def _skill_based_allocate(
        self,
        task_ids: List[int],
        annotator_ids: List[int]
    ):
        """按学科专长分配"""
        # 获取任务学科信息
        tasks = await AnnotationTask.filter(
            id__in=task_ids, status='PENDING'
        ).all()

        # 获取标注员专长
        annotators = await self._get_annotator_skills(annotator_ids)

        for task in tasks:
            subject = task.content_payload.get('subject', 'GENERAL')
            # 找到该学科专长的标注员中负载最低的
            candidates = [
                a for a in annotators
                if subject in a['subjects'] and a['active_tasks'] < a['max_tasks']
            ]
            if candidates:
                best = min(candidates, key=lambda a: a['active_tasks'])
                await self._assign_task(task.id, best['id'])
                best['active_tasks'] += 1

    async def calculate_agreement(
        self,
        task_id: int,
        annotations: List[dict]
    ) -> float:
        """计算多标注员一致性 (Cohen's Kappa / Krippendorff's Alpha)"""
        if len(annotations) < 2:
            return 1.0

        # 对比评分型标注
        scores = [a.get('overall_score') for a in annotations if a.get('overall_score')]
        if len(scores) >= 2:
            # 使用 ICC (Intraclass Correlation Coefficient)
            return self._calculate_icc(scores)

        return 1.0
```

---

## 9. 定时任务与自动化

### 9.1 定时任务清单

| 任务名 | 频率 | 说明 |
|--------|------|------|
| `collect_daily_conversations` | 每天凌晨 02:00 | 从生产消息队列归档前一天对话 |
| `run_judge_batch_evaluation` | 每天凌晨 03:00 | 批量执行 LLM-as-Judge 评分 |
| `build_weekly_dataset_candidates` | 每周一 04:00 | 生成本周候选训练数据集提案 |
| `cleanup_expired_samples` | 每天凌晨 05:00 | 清理过期/被拒样本（保留统计信息） |
| `check_finetune_job_timeouts` | 每 10 分钟 | 检查训练任务超时 |
| `canary_health_check` | 每 5 分钟 | 灰度模型健康检查 |
| `dataset_drift_detection` | 每周日 06:00 | 数据集分布漂移检测 |

### 9.2 数据漂移检测

```python
class DatasetDriftDetector:
    """检测训练数据集与生产数据之间的分布漂移"""

    async def check_drift(self, dataset_id: int) -> DriftReport:
        """对比冻结数据集与最近30天生产数据的分布"""
        frozen_dist = await self._get_dataset_distribution(dataset_id)
        production_dist = await self._get_recent_production_distribution(days=30)

        drift_metrics = {
            "stage_distribution": self._js_divergence(
                frozen_dist['stage'], production_dist['stage']
            ),
            "subject_distribution": self._js_divergence(
                frozen_dist['subject'], production_dist['subject']
            ),
            "grade_distribution": self._js_divergence(
                frozen_dist['grade'], production_dist['grade']
            ),
            "avg_response_length": abs(
                frozen_dist['avg_response_length'] - production_dist['avg_response_length']
            ) / frozen_dist['avg_response_length'],
            "knowledge_coverage": self._coverage_delta(
                frozen_dist['knowledge_points'],
                production_dist['knowledge_points']
            )
        }

        overall_drift = sum(drift_metrics.values()) / len(drift_metrics)

        recommendation = "OK"
        if overall_drift > 0.15:
            recommendation = "REBUILD_RECOMMENDED"
        elif overall_drift > 0.08:
            recommendation = "MONITOR_CLOSELY"

        return DriftReport(
            dataset_id=dataset_id,
            metrics=drift_metrics,
            overall_drift_score=overall_drift,
            recommendation=recommendation
        )
```

---

## 10. 错误处理与异常策略

### 10.1 错误码定义

| 错误码 | 说明 | 处理策略 |
|--------|------|----------|
| `FT_001` | 基座模型权重不可用 | 尝试备用模型源 → 告警通知运维 |
| `FT_002` | GPU 资源不足 | 排队等待 → 超时降级到更小模型 |
| `FT_003` | 数据集为空或样本不足 | 拒绝任务 → 通知数据团队 |
| `FT_004` | 训练过程 NaN loss | 自动降低学习率重试 → 失败标记 |
| `FT_005` | 评估安全阈值未达标 | 禁止上线 → 安全团队审核 |
| `FT_006` | 模型加载 OOM | 降低 batch_size → 检查显存 |
| `FT_007` | LLM-as-Judge API 限流 | 降速重试 → 跳过评分，标记待评 |
| `FT_008` | 灰度模型错误率飙升 | 立即自动回滚 → 告警值班 |
| `FT_009` | 数据集分布严重漂移 | 标记数据集过期 → 通知重建 |

### 10.2 关键异常处理示例

```python
# 微调训练中的异常处理
class FinetuneErrorHandler:

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=60, min=60, max=300),
        retry=retry_if_exception_type((GPUResourceError, TransientError))
    )
    async def safe_submit_training(self, job_id: int):
        try:
            await self.orchestrator.execute_job(job_id)
        except GPUNotAvailableError as e:
            logger.warning(f"GPU not available for job {job_id}, will retry: {e}")
            raise
        except NaNLossError as e:
            # 降低学习率重试
            job = await FinetuneJob.get(job_id)
            original_lr = job.hyperparameters['learning_rate']
            new_lr = original_lr * 0.5
            logger.warning(
                f"NaN loss detected for job {job_id}, "
                f"retrying with lr={new_lr} (was {original_lr})"
            )
            await FinetuneJob.filter(id=job_id).update(
                hyperparameters={**job.hyperparameters, 'learning_rate': new_lr}
            )
            raise  # 让 retry 装饰器处理
        except OOMError as e:
            # 降低 batch_size
            job = await FinetuneJob.get(job_id)
            original_bs = job.hyperparameters['per_device_train_batch_size']
            if original_bs > 1:
                new_bs = max(original_bs // 2, 1)
                new_ga = job.hyperparameters['gradient_accumulation_steps'] * 2
                logger.warning(
                    f"OOM for job {job_id}, "
                    f"reducing batch_size to {new_bs}, "
                    f"increasing grad_accum to {new_ga}"
                )
                await FinetuneJob.filter(id=job_id).update(
                    hyperparameters={
                        **job.hyperparameters,
                        'per_device_train_batch_size': new_bs,
                        'gradient_accumulation_steps': new_ga
                    }
                )
                raise
            else:
                # batch_size 已最小，无法继续
                await self._mark_job_failed(
                    job_id, "OOM even with batch_size=1, model too large for GPU"
                )
```

---

## 11. 监控指标

### 11.1 Prometheus 指标

```
# 数据采集
training_data_collected_total{source_type, status}
training_data_judge_score_distribution{score_bucket}    # 直方图
training_data_pii_detected_total

# 数据集
dataset_samples_count{dataset_id, split}
dataset_build_duration_seconds{dataset_id}
dataset_drift_score{dataset_id}

# 标注
annotation_tasks_pending_count
annotation_tasks_completed_total{task_type}
annotation_agreement_score_distribution
annotation_throughput_per_hour

# 微调
finetune_jobs_queued_count
finetune_jobs_running_count
finetune_job_duration_seconds{base_model, method}
finetune_training_loss{job_id}
finetune_eval_loss{job_id}
finetune_gpu_utilization_percent{node, gpu_id}
finetune_gpu_memory_used_bytes{node, gpu_id}

# 评估
model_eval_accuracy{model_identifier, category}
model_eval_duration_seconds{model_identifier}
model_hallucination_rate{model_identifier}

# 部署
model_deployment_status{model_name, status}
canary_traffic_percentage{model_name}
canary_error_rate{model_name}
canary_user_satisfaction{model_name}
model_auto_rollback_total{reason}
```

### 11.2 Grafana 告警规则示例

```yaml
groups:
  - name: finetune_alerts
    rules:
      - alert: FinetuneJobStuck
        expr: finetune_jobs_running_count > 0 AND on() (time() - finetune_job_last_progress_timestamp > 3600)
        for: 10m
        annotations:
          summary: "微调任务停滞超过1小时"
          description: "Job {{ $labels.job_id }} 无进度更新"

      - alert: CanaryHighErrorRate
        expr: canary_error_rate > 0.05
        for: 5m
        annotations:
          summary: "灰度模型错误率过高"
          description: "模型 {{ $labels.model_name }} 错误率 {{ $value }}"

      - alert: DatasetDriftHigh
        expr: dataset_drift_score > 0.15
        for: 1h
        annotations:
          summary: "数据集分布漂移严重"
          description: "数据集 {{ $labels.dataset_id }} 需要重建"

      - alert: GPUMemoryExhausted
        expr: finetune_gpu_memory_used_bytes / finetune_gpu_memory_total_bytes > 0.95
        for: 5m
        annotations:
          summary: "GPU 显存接近耗尽"
```

---

## 12. 安全与合规

### 12.1 训练数据安全

| 安全要求 | 实现方案 |
|----------|----------|
| PII 脱敏 | 采集时自动脱敏 + 入数据集前二次扫描 |
| 用户同意 | 注册时获取数据使用授权，支持 Opt-out |
| 数据留存 | 未登录用户数据不采集；已登录最长保留 24 个月 |
| 训练数据隔离 | 训练数据集与生产用户数据物理隔离存储 |
| 审计日志 | 所有数据集访问、导出操作记录审计日志 |
| 模型安全评估 | 上线前必须通过安全性评测（拒绝率 ≥ 98%） |

### 12.2 数据访问控制

```python
# 敏感操作权限校验装饰器
def require_finetune_permission(action: str):
    """微调管线权限校验"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            user = kwargs.get('current_user')
            if not user:
                raise PermissionDeniedError("Authentication required")

            required_roles = {
                'submit_finetune': ['AI_ENGINEER', 'ADMIN'],
                'deploy_model': ['AI_ENGINEER_LEAD', 'ADMIN'],
                'export_dataset': ['DATA_SCIENTIST', 'AI_ENGINEER', 'ADMIN'],
                'view_training_data': ['ANNOTATOR', 'DATA_SCIENTIST', 'AI_ENGINEER', 'ADMIN'],
                'approve_model': ['AI_ENGINEER_LEAD', 'CONTENT_LEAD', 'ADMIN']
            }

            required = required_roles.get(action, ['ADMIN'])
            if not any(role in user.roles for role in required):
                raise PermissionDeniedError(
                    f"Action '{action}' requires one of: {required}"
                )
            return await func(*args, **kwargs)
        return wrapper
    return decorator
```

---

## 13. 技术选型参考

| 组件 | 推荐方案 | 备选 | 说明 |
|------|----------|------|------|
| 训练框架 | LLaMA-Factory | Axolotl, TRL | 国产模型友好，LoRA/QLoRA 开箱即用 |
| 数据集格式 | HuggingFace Datasets | JSONL, Parquet | 兼容主流训练框架 |
| GPU 调度 | Ray Cluster / Slurm | Kubernetes + Volcano | 按团队规模选择 |
| 实验跟踪 | MLflow / Weights & Biases | TensorBoard | 微调实验记录与对比 |
| 模型注册 | MLflow Model Registry | 自建 | 模型版本管理 |
| 标注平台 | Label Studio | Doccano | 支持自定义标注模板 |
| 消息队列 | RabbitMQ / Apache RocketMQ | Kafka | 对话采集事件流 |
| 分布式存储 | MinIO / 阿里云 OSS | AWS S3 | 训练数据和模型权重存储 |

---

## 14. 与其他模块的交互关系

| 交互模块 | 交互方式 | 说明 |
|----------|----------|------|
| AI 对话引擎 | 消息队列 (对话完成事件) | 接收生产对话数据作为训练源 |
| AI 质量监控系统 | API 调用 | 获取质量问题对话，用于负样本采集 |
| AI 模型评测基准 | 共享评测数据集 | 复用评测题目，统一评测口径 |
| AI 模型调度与容灾 | 配置推送 | 微调模型上线后更新路由权重 |
| 配置中心 | 配置读取 | 采集策略、采样率等可配置项 |
| 审计日志系统 | 日志写入 | 数据集导出、模型发布等操作审计 |
| 多模型调度与成本治理 | API 调用 | LLM-as-Judge 调用成本归集 |

---

## 15. 开发任务拆解

| 任务 | 预估工时 | 优先级 | 说明 |
|------|----------|--------|------|
| 训练数据采集服务 | 5 天 | P0 | 含 PII 脱敏、消息消费、写入存储 |
| LLM-as-Judge 评分服务 | 3 天 | P0 | 异步批量评分 + 结果存储 |
| 数据集构建管线 | 4 天 | P0 | 过滤、去重、格式化、切分 |
| 标注平台后端 API | 4 天 | P1 | 任务CRUD、分配、交叉标注 |
| 标注平台前端 | 5 天 | P1 | 可用 Label Studio 替代，则仅需集成 |
| 微调任务编排器 | 5 天 | P0 | 任务提交、调度、状态管理 |
| LoRA 训练脚本模板 | 3 天 | P0 | 适配主流国产模型 |
| 模型评估执行器 | 4 天 | P0 | 按类别评估 + 安全检查 |
| 模型注册与版本管理 | 3 天 | P1 | CRUD + 部署状态管理 |
| 灰度发布管理器 | 4 天 | P1 | 流量分配 + 自动监控/回滚 |
| 数据漂移检测 | 2 天 | P2 | 分布对比 + 告警 |
| 监控面板 (Grafana) | 2 天 | P1 | 指标可视化 + 告警规则 |
| **合计** | **44 天** | | MVP 阶段约 20 天核心功能 |

---

## 附录 A: SFT 训练数据格式示例（ChatML）

```json
{"messages": [{"role": "system", "content": "你是一位初中数学老师，请用清晰、分步的方式讲解。"}, {"role": "user", "content": "二次函数y=ax²+bx+c的顶点坐标怎么求？"}, {"role": "assistant", "content": "二次函数的顶点坐标可以通过配方法求得。\n\n**方法一：配方法**\n\n1. 提取二次项系数：y = a(x² + (b/a)x) + c\n2. 配方：y = a(x + b/(2a))² - b²/(4a) + c\n3. 化简：y = a(x + b/(2a))² + (4ac - b²)/(4a)\n\n所以顶点坐标为：**(-b/(2a), (4ac - b²)/(4a))**\n\n**方法二：直接用公式**\n\n对于 y = ax² + bx + c：\n- 顶点横坐标：x = -b/(2a)\n- 顶点纵坐标：将 x 代入函数求 y\n\n**举例**：y = x² - 4x + 3\n- x = -(-4)/(2×1) = 2\n- y = 4 - 8 + 3 = -1\n- 顶点坐标：(2, -1)\n\n你能理解这个过程吗？有不清楚的地方可以继续问我。"}], "metadata": {"source_id": 10245, "stage": "JUNIOR", "grade": 8, "subject": "MATH", "judge_score": 9.25}}
```

## 附录 B: DPO 偏好对格式示例

```json
{
  "messages": [{"role": "user", "content": "什么是光合作用？"}],
  "chosen": "光合作用是绿色植物利用光能，将二氧化碳和水转化为有机物（主要是葡萄糖）并释放氧气的过程。它的总反应式是：6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂。这个过程发生在叶绿体中，分为光反应和暗反应两个阶段。",
  "rejected": "光合作用就是植物吃东西的过程，植物通过叶子吸收阳光然后长大。",
  "metadata": {
    "chosen_score": 9.0,
    "rejected_score": 3.5,
    "subject": "BIOLOGY",
    "stage": "JUNIOR"
  }
}
```
