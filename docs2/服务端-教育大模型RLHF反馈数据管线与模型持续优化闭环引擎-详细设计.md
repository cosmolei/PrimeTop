# 服务端-教育大模型RLHF反馈数据管线与模型持续优化闭环引擎 详细设计

## 1. 概述

### 1.1 模块定位

本引擎是 PrimeTop AI 教育能力的"进化中枢"，负责将分散在各业务模块中的用户反馈信号、学习行为数据和教育效果指标，汇聚为高质量的强化学习/直接偏好优化（RLHF/DPO）训练数据，驱动教育大模型在教育场景中的持续对齐与质量提升。

**与传统 AI 质量监控的区别**：质量监控只负责"发现问题"，本引擎负责"收集信号 → 构造训练数据 → 触发优化 → 验证效果 → 上线迭代"的完整闭环。

### 1.2 核心职责

| 职责 | 说明 |
|------|------|
| 多源反馈信号采集 | 从 AI 对话、拍题解析、作文批改等场景收集显式/隐式反馈 |
| 反馈数据清洗与标注 | 去噪、去重、质量分级、人工标注编排 |
| 偏好对构造 | 将反馈信号转化为 RLHF/DPO 训练所需的偏好对格式 |
| 训练任务编排 | 管理微调/对齐训练任务的生命周期 |
| 模型版本评估 | 教育场景多维 benchmark 自动化评测 |
| 灰度发布决策 | 基于 A/B 实验数据驱动模型上线决策 |
| 闭环效果追踪 | 模型上线后持续追踪教育效果指标变化 |

### 1.3 依赖关系

```
                    ┌─────────────────────────────────────────────────┐
                    │            本引擎 (RLHF Pipeline)                │
                    └──────────────────────┬──────────────────────────┘
                           ↑ 输入信号        ↓ 输出模型版本
            ┌──────────────┼──────────────┐        │
            │              │              │        ▼
   ┌────────┴───┐  ┌───────┴────┐ ┌──────┴───┐  ┌─┴──────────────┐
   │ AI 对话引擎 │  │ 拍题答疑   │ │ 作文批改  │  │ AI模型版本     │
   │ (反馈采集)  │  │ (解析反馈) │ │ (批改反馈)│  │ 生命周期管理   │
   └────────────┘  └────────────┘ └──────────┘  └────────────────┘
           │              │              │              │
           ▼              ▼              ▼              ▼
   ┌──────────────────────────────────────────────────────────────┐
   │              用户学习行为数据库 (Learning Events)              │
   └──────────────────────────────────────────────────────────────┘
           │
           ▼
   ┌───────────────┐     ┌──────────────────┐
   │ 人工标注工作台  │────▶│ 训练数据集管理    │
   │ (Label Studio) │     │ (Dataset Store)  │
   └───────────────┘     └──────────────────┘
```

**上游依赖（数据来源）：**
- AI 对话引擎 → 对话质量评分、用户点赞/踩、追问深度
- 拍题答疑服务 → 解析正确率、用户纠错反馈
- 作文批改引擎 → 批改满意度、教师复核结果
- 学习效果追踪 → 答题正确率变化、知识点掌握度变化
- AI 质量监控系统 → 幻觉检测、事实校验结果

**下游依赖（模型输出）：**
- AI 模型版本生命周期管理 → 接收新模型版本进行灰度发布
- AI 模型调用多供应商容灾 → 更新模型路由权重
- Prompt 编排系统 → 配合模型更新调整 Prompt 模板

---

## 2. 数据模型

### 2.1 核心实体 ER 图

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────────────┐
│   feedback_signal   │     │  preference_pair     │     │   training_dataset      │
├─────────────────────┤     ├──────────────────────┤     ├─────────────────────────┤
│ id (PK)             │◄──┐ │ id (PK)              │◄──┐ │ id (PK)                 │
│ source_module       │   │ │ dataset_id (FK)      │   │ │ name                    │
│ signal_type         │   │ │ prompt               │   │ │ version                 │
│ signal_value        │   └─│ chosen_response       │   │ │ task_type               │
│ user_id             │     │ rejected_response     │   │ │ status                  │
│ session_id          │     │ quality_score         │   └─│ sample_count            │
│ ai_response_id      │     │ annotator_type        │     │ created_at              │
│ metadata (JSON)     │     │ annotator_id          │     │ metadata (JSON)         │
│ collected_at        │     │ created_at            │     └─────────────────────────┘
│ processed_status    │     └──────────────────────┘
└─────────────────────┘                │
                                       │
          ┌────────────────────────────┤
          │                            │
          ▼                            ▼
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────────────┐
│  training_job       │     │  model_evaluation    │     │   model_version         │
├─────────────────────┤     ├──────────────────────┤     ├─────────────────────────┤
│ id (PK)             │     │ id (PK)              │     │ id (PK)                 │
│ dataset_id (FK)     │     │ model_version_id(FK) │     │ model_name              │
│ job_type            │     │ benchmark_id (FK)    │     │ version_tag             │
│ base_model          │     │ score_json (JSON)    │     │ base_model              │
│ hyperparams (JSON)  │     │ passed               │     │ training_job_id (FK)    │
│ status              │     │ evaluated_at         │     │ status                  │
│ started_at          │     └──────────────────────┘     │ metrics_json (JSON)     │
│ completed_at        │                                  │ deployed_at             │
│ artifacts_path      │                                  │ traffic_percent         │
│ error_message       │                                  └─────────────────────────┘
└─────────────────────┘
```

### 2.2 数据库表结构

#### 2.2.1 feedback_signal（反馈信号表）

```sql
CREATE TABLE feedback_signal (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    signal_id       VARCHAR(64) NOT NULL UNIQUE COMMENT '业务信号ID，雪花算法生成',
    source_module   VARCHAR(32) NOT NULL COMMENT '信号来源模块: ai_dialog/photo_search/essay_grading/practice/exam',
    signal_type     VARCHAR(32) NOT NULL COMMENT '信号类型: thumbs_up/down/regrade/correction/comprehension_indicator/retention_metric/teacher_review/hallucination_detected',
    signal_value    FLOAT NOT NULL DEFAULT 0 COMMENT '信号值: [-1.0, 1.0]，正值表示正向反馈，负值表示负向反馈',
    user_id         BIGINT NOT NULL COMMENT '用户ID',
    session_id      VARCHAR(64) COMMENT '学习会话ID',
    ai_response_id  VARCHAR(64) COMMENT '关联的AI响应记录ID',
    prompt_text     TEXT COMMENT '用户原始输入(截断至2000字符)',
    response_text   TEXT COMMENT 'AI原始输出(截断至4000字符)',
    context_json    JSON COMMENT '上下文信息: 学段/年级/学科/教材版本/知识点等',
    metadata        JSON COMMENT '附加元数据: 设备/网络/响应耗时等',
    collected_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    processed_status ENUM('PENDING','PROCESSING','COMPLETED','REJECTED','ARCHIVED')
                    NOT NULL DEFAULT 'PENDING',
    processed_at    DATETIME(3) NULL,
    reject_reason   VARCHAR(256) NULL COMMENT '被拒绝原因: low_quality/duplicate/out_of_scope',
    INDEX idx_source_type (source_module, signal_type),
    INDEX idx_user_time (user_id, collected_at),
    INDEX idx_status_time (processed_status, collected_at),
    INDEX idx_response (ai_response_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI反馈信号原始采集表';
```

#### 2.2.2 preference_pair（偏好对表）

```sql
CREATE TABLE preference_pair (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    pair_id             VARCHAR(64) NOT NULL UNIQUE COMMENT '偏好对唯一ID',
    dataset_id          BIGINT NOT NULL COMMENT '所属训练数据集ID',
    source_signal_ids   JSON NOT NULL COMMENT '来源反馈信号ID列表',
    prompt              TEXT NOT NULL COMMENT '系统提示+用户输入拼接',
    prompt_hash         VARCHAR(64) NOT NULL COMMENT 'prompt的SHA256哈希，用于去重',
    chosen_response     TEXT NOT NULL COMMENT '偏好(更好)的回答',
    rejected_response   TEXT NOT NULL COMMENT '不偏好(更差)的回答',
    chosen_source       VARCHAR(64) NOT NULL COMMENT 'chosen来源: original_ai/human_expert/model_revision',
    rejected_source     VARCHAR(64) NOT NULL COMMENT 'rejected来源: original_ai/low_quality_model/known_bad',
    quality_score       FLOAT NOT NULL DEFAULT 0.5 COMMENT '偏好对质量评分[0,1]',
    domain_tags         JSON COMMENT '领域标签: ["math_junior","physics_senior"]',
    difficulty_level    TINYINT COMMENT '难度等级1-5',
    annotator_type      ENUM('AUTO_SIGNAL','LLM_JUDGE','HUMAN_EXPERT','TEACHER_REVIEW')
                        NOT NULL DEFAULT 'AUTO_SIGNAL',
    annotator_id        VARCHAR(64) NULL COMMENT '标注者ID(人工标注时)',
    annotation_notes    TEXT NULL COMMENT '标注备注',
    status              ENUM('DRAFT','REVIEWED','APPROVED','REJECTED','USED')
                        NOT NULL DEFAULT 'DRAFT',
    created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    reviewed_at         DATETIME(3) NULL,
    INDEX idx_dataset (dataset_id, status),
    INDEX idx_prompt_hash (prompt_hash),
    INDEX idx_domain (CAST(domain_tags AS CHAR(255))),
    INDEX idx_annotator (annotator_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RLHF/DPO偏好对数据表';
```

#### 2.2.3 training_dataset（训练数据集表）

```sql
CREATE TABLE training_dataset (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    name            VARCHAR(128) NOT NULL COMMENT '数据集名称',
    version         VARCHAR(32) NOT NULL COMMENT '版本号: v1.0.0',
    task_type       ENUM('SFT','DPO','PPO','RM','EVAL') NOT NULL COMMENT '训练任务类型',
    description     TEXT NULL,
    status          ENUM('BUILDING','READY','LOCKED','DEPRECATED') NOT NULL DEFAULT 'BUILDING',
    sample_count    INT NOT NULL DEFAULT 0 COMMENT '样本数量',
    storage_path    VARCHAR(512) NULL COMMENT '对象存储路径',
    file_format     VARCHAR(16) NULL DEFAULT 'jsonl' COMMENT '数据格式: jsonl/parquet',
    size_bytes      BIGINT NULL COMMENT '数据集文件大小',
    checksum        VARCHAR(64) NULL COMMENT 'SHA256校验和',
    metadata        JSON NULL COMMENT '统计信息: 学科分布/学段分布/难度分布等',
    created_by      BIGINT NOT NULL COMMENT '创建者用户ID',
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    locked_at       DATETIME(3) NULL COMMENT '锁定时间(锁定后不可修改)',
    UNIQUE KEY uk_name_version (name, version),
    INDEX idx_task_status (task_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='训练数据集管理表';
```

#### 2.2.4 training_job（训练任务表）

```sql
CREATE TABLE training_job (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    job_id          VARCHAR(64) NOT NULL UNIQUE COMMENT '训练任务唯一ID',
    dataset_id      BIGINT NOT NULL COMMENT '训练数据集ID',
    job_type        ENUM('SFT','DPO','PPO','RM') NOT NULL,
    base_model      VARCHAR(128) NOT NULL COMMENT '基础模型标识: qwen2.5-7b-instruct',
    target_model    VARCHAR(128) NOT NULL COMMENT '目标模型名称: primetop-edu-v2.3',
    hyperparams     JSON NOT NULL COMMENT '超参数配置',
    status          ENUM('QUEUED','PREPARING','TRAINING','EVALUATING','COMPLETED','FAILED','CANCELLED')
                    NOT NULL DEFAULT 'QUEUED',
    progress        FLOAT NOT NULL DEFAULT 0 COMMENT '训练进度[0,1]',
    worker_node     VARCHAR(128) NULL COMMENT '训练节点地址',
    gpu_type        VARCHAR(32) NULL COMMENT 'GPU型号: A100/H800',
    gpu_count       TINYINT NULL COMMENT 'GPU数量',
    started_at      DATETIME(3) NULL,
    completed_at    DATETIME(3) NULL,
    duration_sec    INT NULL COMMENT '训练耗时(秒)',
    artifacts_path  VARCHAR(512) NULL COMMENT '模型产物存储路径',
    log_path        VARCHAR(512) NULL COMMENT '训练日志路径',
    metrics_json    JSON NULL COMMENT '训练指标: loss/reward/kl_divergence等',
    error_message   TEXT NULL,
    created_by      BIGINT NOT NULL,
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_status (status),
    INDEX idx_base_model (base_model, status),
    INDEX idx_dataset (dataset_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='模型训练任务表';
```

#### 2.2.5 model_evaluation（模型评估表）

```sql
CREATE TABLE model_evaluation (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    eval_id             VARCHAR(64) NOT NULL UNIQUE,
    model_version_id    BIGINT NOT NULL COMMENT '被评估的模型版本ID',
    benchmark_id        BIGINT NOT NULL COMMENT '评估基准集ID',
    benchmark_name      VARCHAR(128) NOT NULL COMMENT '基准集名称',
    total_questions     INT NOT NULL COMMENT '基准题目总数',
    scores_json         JSON NOT NULL COMMENT '各维度评分明细',
    overall_score       FLOAT NOT NULL COMMENT '综合得分[0,100]',
    passed              BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否通过质量门槛',
    passing_threshold   FLOAT NOT NULL COMMENT '通过分数线',
    comparison_json     JSON NULL COMMENT '与基线模型的对比数据',
    cost_usd            DECIMAL(10,4) NULL COMMENT '评估API成本',
    duration_sec        INT NULL,
    evaluated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_model (model_version_id),
    INDEX idx_passed (passed, overall_score)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='模型评估记录表';
```

#### 2.2.6 model_version（模型版本表）

```sql
CREATE TABLE model_version (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    model_name          VARCHAR(128) NOT NULL COMMENT '模型名称',
    version_tag         VARCHAR(32) NOT NULL COMMENT '版本标签: v2.3.1',
    base_model          VARCHAR(128) NOT NULL COMMENT '基础模型',
    training_job_id     BIGINT NULL COMMENT '训练任务ID(基线模型为NULL)',
    model_type          ENUM('BASELINE','SFT','DPO','PPO','ENSEMBLE') NOT NULL,
    status              ENUM('DRAFT','EVALUATING','STAGING','CANARY','PRODUCTION','ROLLED_BACK','ARCHIVED')
                        NOT NULL DEFAULT 'DRAFT',
    description         TEXT NULL,
    artifacts_path      VARCHAR(512) NOT NULL COMMENT '模型权重存储路径',
    config_json         JSON NOT NULL COMMENT '推理配置: temperature/top_p/max_tokens等',
    metrics_json        JSON NULL COMMENT '关键指标摘要',
    deployed_at         DATETIME(3) NULL,
    traffic_percent     FLOAT NOT NULL DEFAULT 0 COMMENT '流量分配百分比[0,100]',
    rollback_reason     VARCHAR(256) NULL,
    created_by          BIGINT NOT NULL,
    created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_name_version (model_name, version_tag),
    INDEX idx_status_traffic (status, traffic_percent)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI模型版本生命周期管理表';
```

#### 2.2.7 feedback_aggregation（反馈聚合统计表 - 预计算）

```sql
CREATE TABLE feedback_aggregation (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    model_version   VARCHAR(64) NOT NULL COMMENT '模型版本标签',
    source_module   VARCHAR(32) NOT NULL COMMENT '来源模块',
    stat_date       DATE NOT NULL COMMENT '统计日期',
    total_responses INT NOT NULL DEFAULT 0 COMMENT 'AI响应总数',
    positive_count  INT NOT NULL DEFAULT 0 COMMENT '正向反馈数',
    negative_count  INT NOT NULL DEFAULT 0 COMMENT '负向反馈数',
    neutral_count   INT NOT NULL DEFAULT 0 COMMENT '中性反馈数',
    satisfaction_rate FLOAT NOT NULL DEFAULT 0 COMMENT '满意率[0,1]',
    hallucination_rate FLOAT NOT NULL DEFAULT 0 COMMENT '幻觉检出率[0,1]',
    avg_followup_depth FLOAT NOT NULL DEFAULT 0 COMMENT '平均追问深度',
    knowledge_mastery_delta FLOAT NOT NULL DEFAULT 0 COMMENT '知识点掌握度变化均值',
    metadata        JSON NULL,
    UNIQUE KEY uk_model_module_date (model_version, source_module, stat_date),
    INDEX idx_date (stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='反馈信号预聚合统计表';
```

### 2.3 缓存策略

| 缓存对象 | Redis Key 前缀 | TTL | 说明 |
|----------|----------------|-----|------|
| 反馈信号计数器 | `rlhf:signal:count:{module}:{date}` | 7天 | 每日各模块反馈量原子计数 |
| 数据集统计摘要 | `rlhf:dataset:stats:{dataset_id}` | 1小时 | 数据集样本数/分布等统计 |
| 模型评估结果 | `rlhf:eval:result:{model_version_id}` | 永久 | 评估结果缓存（直到新评估覆盖） |
| 训练任务状态 | `rlhf:job:status:{job_id}` | 5分钟 | 训练任务实时状态（短TTL，从训练节点心跳刷新） |
| 偏好对去重布隆过滤器 | `rlhf:bloom:prompt_hash` | 永久 | Redisson布隆过滤器，防止相同prompt重复入库 |

---

## 3. API 接口设计

### 3.1 反馈信号采集 API

#### POST `/api/v1/rlhf/feedback/signals`

**功能**：接收来自各业务模块的 AI 反馈信号。支持批量提交。

**请求体**：
```json
{
  "signals": [
    {
      "source_module": "ai_dialog",
      "signal_type": "thumbs_up",
      "signal_value": 1.0,
      "user_id": 10086,
      "session_id": "sess_abc123",
      "ai_response_id": "resp_xyz789",
      "prompt_text": "什么是牛顿第二定律？",
      "response_text": "牛顿第二定律表述为...",
      "context": {
        "grade": "高一",
        "subject": "physics",
        "textbook_version": "renjiaoban",
        "knowledge_points": ["力学", "牛顿运动定律"]
      },
      "metadata": {
        "response_latency_ms": 1200,
        "response_model": "qwen2.5-7b-edu-v2.2",
        "device": "android"
      }
    }
  ]
}
```

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "accepted": 1,
    "rejected": 0,
    "signal_ids": ["sig_20260628_001"]
  }
}
```

**校验规则**：
- `source_module` 必须在枚举范围内
- `signal_value` 范围 [-1.0, 1.0]
- `prompt_text` 不超过 2000 字符
- 单次批量不超过 100 条
- 频率限制：同一 `ai_response_id` 同类型信号 60 秒内仅接受一次

#### POST `/api/v1/rlhf/feedback/implicit`

**功能**：接收隐式反馈信号（基于用户行为推断的反馈）。

```json
{
  "signal_type": "comprehension_indicator",
  "user_id": 10086,
  "ai_response_id": "resp_xyz789",
  "behavior_data": {
    "followup_count": 3,
    "followup_types": ["explain_simpler", "give_example", "generate_practice"],
    "time_to_next_action_sec": 45,
    "copy_action": false,
    "share_action": false,
    "add_to_mistake_book": true
  },
  "inferred_score": -0.3,
  "inference_rule_version": "v1.2"
}
```

**隐式评分推理规则**：

| 行为信号 | 推理分值 | 说明 |
|----------|----------|------|
| 追问"讲简单点" | -0.3 | 当前回答可能过难 |
| 追问"详细一点" | +0.1 | 当前回答偏简略但方向正确 |
| 加入错题本 | -0.2 | 答题错误，关联AI讲解可能不够清晰 |
| 复制内容 | +0.3 | 用户认为内容有价值 |
| 分享内容 | +0.5 | 高度认可 |
| 连续追问 >5 次 | -0.4 | 理解困难 |
| 快速关闭（<3秒） | -0.2 | 回答无关或不可读 |
| 生成同类题并答对 | +0.6 | 讲解有效，真正掌握 |

### 3.2 偏好对管理 API

#### GET `/api/v1/rlhf/preference-pairs`

**查询参数**：
| 参数 | 类型 | 说明 |
|------|------|------|
| dataset_id | Long | 数据集ID |
| domain | String | 领域标签过滤 |
| annotator_type | String | 标注类型 |
| status | String | 状态 |
| page / size | Int | 分页 |

**响应**：
```json
{
  "code": 0,
  "data": {
    "total": 15234,
    "page": 1,
    "size": 20,
    "items": [
      {
        "pair_id": "pp_20260628_0001",
        "dataset_id": 5,
        "prompt": "[系统提示] 你是一名初中物理老师...\n[用户] 什么是惯性？",
        "chosen_response": "惯性是物体保持原有运动状态的性质...",
        "rejected_response": "惯性就是物体不愿意动...",
        "chosen_source": "human_expert",
        "rejected_source": "original_ai",
        "quality_score": 0.92,
        "domain_tags": ["physics_junior", "mechanics"],
        "difficulty_level": 2,
        "annotator_type": "HUMAN_EXPERT",
        "status": "APPROVED"
      }
    ]
  }
}
```

#### POST `/api/v1/rlhf/preference-pairs/auto-generate`

**功能**：根据反馈信号自动构造偏好对。

**请求体**：
```json
{
  "source_signals": {
    "time_range": {
      "start": "2026-06-01T00:00:00Z",
      "end": "2026-06-28T23:59:59Z"
    },
    "modules": ["ai_dialog", "photo_search"],
    "min_signal_value": -0.5
  },
  "generation_config": {
    "strategy": "negative_signal_revision",
    "revision_model": "qwen2.5-72b-instruct",
    "llm_judge_enabled": true,
    "llm_judge_model": "gpt-4o",
    "min_quality_score": 0.7,
    "dedup_by_prompt_hash": true
  },
  "target_dataset_id": 5
}
```

**响应**（异步任务）：
```json
{
  "code": 0,
  "data": {
    "task_id": "gen_task_20260628_001",
    "status": "PROCESSING",
    "estimated_pairs": 3200,
    "estimated_duration_sec": 600
  }
}
```

### 3.3 训练任务管理 API

#### POST `/api/v1/rlhf/training/jobs`

```json
{
  "dataset_id": 5,
  "job_type": "DPO",
  "base_model": "primetop-edu-v2.2",
  "target_model_name": "primetop-edu-v2.3-dpo",
  "hyperparams": {
    "learning_rate": 5e-7,
    "beta": 0.1,
    "batch_size": 32,
    "gradient_accumulation_steps": 4,
    "num_epochs": 3,
    "warmup_ratio": 0.1,
    "max_length": 2048,
    "max_prompt_length": 1024,
    "lora_r": 16,
    "lora_alpha": 32,
    "lora_dropout": 0.05
  },
  "resource_config": {
    "gpu_type": "A100",
    "gpu_count": 4,
    "priority": "NORMAL"
  },
  "auto_evaluate_after_training": true,
    "evaluation_benchmark_ids": [1, 2, 3]
}
```

#### GET `/api/v1/rlhf/training/jobs/{job_id}/status`

```json
{
  "code": 0,
  "data": {
    "job_id": "train_job_001",
    "status": "TRAINING",
    "progress": 0.45,
    "current_epoch": 2,
    "total_epochs": 3,
    "current_step": 1350,
    "total_steps": 3000,
    "latest_metrics": {
      "loss": 0.234,
      "rewards/accuracies": 0.78,
      "rewards/margins": 1.23