# AI 题目智能生成引擎 - 详细设计

> 版本: v1.0 | 更新日期: 2026-05-22 | 状态: 初稿

## 1. 概述

### 1.1 模块定位

AI 题目智能生成引擎（Question Generation Engine, QGE）是 PrimeTop 题库生态的核心补全层。当题库中特定知识点、难度、题型的题目储备不足时，QGE 通过大模型自动生成高质量题目，确保练习、测评、错题重练等场景始终有充足的题源。

**核心职责：**
- 基于知识点、教材章节、难度要求生成新题目
- 对已有题目进行变式改编（参数替换、条件变换、逆向出题等）
- 为选择题自动生成合理干扰项
- 为生成的题目自动生成分步解析
- 对生成题目进行质量校验与自动审核
- 管理生成题目的生命周期（草稿→审核→发布→下架）

**不在本模块范围内：**
- 题目 CRUD 与题库管理 → 见 `题目与题库服务-详细设计.md`
- 练习会话管理与答题流程 → 见 `练习与测评系统-详细设计.md`
- 自适应推题算法 → 见 `自适应学习与个性化推荐引擎-详细设计.md`
- OCR 拍题识别管线 → 见 `拍照搜题与习题答疑-详细设计.md`

### 1.2 触发场景

| 场景 | 触发方 | 说明 |
|------|--------|------|
| 题源不足 | 练习系统 / 推荐引擎 | 某知识点+难度组合可用题目 < 阈值 |
| 变式训练 | 学生点击"再来一道" | 基于当前题目生成同类变式题 |
| 批量出题 | 运营后台 | 按章节/知识点/难度批量生成，补充题库 |
| 考前模拟 | 测评系统 | 按考试大纲和题型分布组卷，不足部分自动补题 |
| 错题重练 | 错题服务 | 基于错题知识点生成新的练习题（避免重复原题） |
| 新教材适配 | 内容运营 | 新教材版本上线时快速填充题库 |

### 1.3 设计目标

1. **质量可控**：生成题目通过多维度自动校验 + 人工抽检，确保题目正确率 > 95%
2. **题型全覆盖**：支持选择题、填空题、判断题、简答题、计算题、证明题、作文题、口语题
3. **难度精准**：与教学大纲对齐的难度分级（1-5），生成偏差 < 0.5 级
4. **学段适配**：根据学段、年级调整题目语言风格、复杂度和知识范围
5. **高效低成本**：单题生成成本 < ¥0.05，批量生成支持并发与缓存
6. **可追溯**：每道生成题记录生成参数、模型版本、Prompt、校验结果

---

## 2. 系统架构

### 2.1 整体架构

```
                    ┌─────────────────────────────┐
                    │         调用方               │
                    │  练习系统 / 推荐引擎 / 后台    │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │     QGE API (生成入口)        │
                    │  单题生成 / 批量生成 / 变式生成  │
                    └──────────────┬──────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
     ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
     │  Prompt 构建器  │  │   模型调度层    │  │   校验管线     │
     │  - 场景路由     │  │  - 模型选择     │  │  - 格式校验    │
     │  - 模板渲染     │  │  - 并发控制     │  │  - 答案校验    │
     │  - 约束注入     │  │  - 降级策略     │  │  - 难度评估    │
     └────────┬───────┘  └────────┬───────┘  │  - 内容安全    │
              │                   │           │  - 去重检测    │
              └───────┬───────────┘           └───────┬───────┘
                      │                               │
                      ▼                               │
              ┌───────────────┐                       │
              │  LLM 服务     │                       │
              │ (多模型调度)   │                       │
              └───────┬───────┘                       │
                      │                               │
                      └───────────┬───────────────────┘
                                  ▼
                      ┌───────────────────┐
                      │  题目入库服务       │
                      │  草稿 → 审核 → 发布 │
                      └───────────────────┘
```

### 2.2 与其他模块的关系

| 关联模块 | 交互方式 | 说明 |
|---------|---------|------|
| 题目与题库服务 | 调用 | 查询题源余量、写入生成题目、题目去重 |
| AI-Prompt 编排 | 调用 | 获取生成场景模板 |
| 多模型调度与成本治理 | 调用 | 选择适合生成的模型、成本计量 |
| 知识点体系与教材映射 | 调用 | 获取知识点详情、前置关系、教材章节结构 |
| 安全与内容合规 | 调用 | 对生成内容进行安全审核 |
| 学情分析 | 读取 | 获取用户/群体掌握度数据，辅助难度匹配 |
| RAG 与知识库 | 调用 | 检索相关知识点描述、教材原文、例题作为参考 |
| 内容与运营后台 | 被调用 | 运营人员触发批量生成、审核管理 |
| 异步任务与事件驱动 | 使用 | 批量生成走异步任务，生成完成发事件通知 |

---

## 3. 核心数据模型

### 3.1 生成任务表 `qge_generation_task`

记录每次生成任务的参数和状态。

```sql
CREATE TABLE qge_generation_task (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_uuid       CHAR(36) NOT NULL UNIQUE COMMENT '任务唯一标识',
    
    -- 触发信息
    trigger_type    VARCHAR(32) NOT NULL COMMENT '触发类型: auto_refill|variant|batch|exam_complement|mistake_regen',
    triggered_by    BIGINT COMMENT '触发者用户ID（系统触发为NULL）',
    trigger_source  VARCHAR(64) COMMENT '触发来源标识（练习会话ID/后台任务ID等）',
    
    -- 生成参数
    subject_code    VARCHAR(16) NOT NULL COMMENT '学科编码',
    grade_code      VARCHAR(16) NOT NULL COMMENT '年级编码',
    stage_code      VARCHAR(16) NOT NULL COMMENT '学段编码: preschool|primary|junior|senior',
    question_types  JSON NOT NULL COMMENT '目标题型列表: [1,3,6]',
    knowledge_point_ids JSON COMMENT '知识点ID列表',
    chapter_id      BIGINT COMMENT '教材章节ID',
    difficulty_range JSON COMMENT '难度范围: {"min":2,"max":4}',
    target_count    INT NOT NULL COMMENT '目标生成数量',
    
    -- 模型信息
    model_id        VARCHAR(64) COMMENT '使用的模型标识',
    model_version   VARCHAR(32) COMMENT '模型版本',
    prompt_template_id BIGINT COMMENT '使用的Prompt模板ID',
    
    -- 执行状态
    status          VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT '状态: pending|running|partial_success|completed|failed|cancelled',
    progress        INT DEFAULT 0 COMMENT '进度百分比 0-100',
    generated_count INT DEFAULT 0 COMMENT '已生成数量',
    passed_count    INT DEFAULT 0 COMMENT '通过校验数量',
    failed_count    INT DEFAULT 0 COMMENT '校验失败数量',
    
    -- 成本
    total_tokens    INT DEFAULT 0 COMMENT '消耗token总数',
    total_cost_yuan DECIMAL(10,6) DEFAULT 0 COMMENT '消耗成本（元）',
    
    -- 时间
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at      DATETIME,
    completed_at    DATETIME,
    
    INDEX idx_status_created (status, created_at),
    INDEX idx_trigger (trigger_type, trigger_source),
    INDEX idx_subject_kp (subject_code, grade_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='题目生成任务';
```

### 3.2 生成题目记录表 `qge_generated_question`

记录每道生成题的详细信息和校验结果。

```sql
CREATE TABLE qge_generated_question (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_id         BIGINT NOT NULL COMMENT '关联生成任务ID',
    
    -- 生成参数
    target_question_type TINYINT NOT NULL COMMENT '目标题型',
    target_difficulty    TINYINT COMMENT '目标难度 1-5',
    source_question_id   BIGINT COMMENT '变式题源题目ID（变式生成时）',
    
    -- 生成结果
    generated_stem      TEXT NOT NULL COMMENT '生成的题干',
    generated_options   JSON COMMENT '生成的选项（选择题）',
    generated_answer    TEXT NOT NULL COMMENT '生成的答案',
    generated_analysis  TEXT COMMENT '生成的解析（分步）',
    generated_raw_json  JSON NOT NULL COMMENT '模型原始输出JSON',
    
    -- 校验结果
    validation_status   VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT '校验状态: pending|format_ok|validated|failed|manual_review',
    format_check        JSON COMMENT '格式校验结果 {"stem":"pass","options":"pass","answer":"pass"}',
    answer_check        JSON COMMENT '答案校验结果 {"method":"solve","result":"pass","delta":"0"}',
    difficulty_check    JSON COMMENT '难度评估结果 {"target":3,"estimated":3,"confidence":0.85}',
    safety_check        JSON COMMENT '安全审核结果 {"safe":true,"tags":[]}',
    dedup_check         JSON COMMENT '去重检查结果 {"min_hash_dist":0.87,"is_duplicate":false}',
    overall_score       DECIMAL(3,2) COMMENT '综合质量评分 0-1.00',
    
    -- 入库状态
    question_id         BIGINT COMMENT '入库后的题目ID（通过审核后写入questions表）',
    review_status       VARCHAR(20) COMMENT '审核状态: auto_approved|pending_review|approved|rejected',
    reviewer_id         BIGINT COMMENT '人工审核人ID',
    reviewed_at         DATETIME,
    reject_reason       VARCHAR(200) COMMENT '拒绝原因',
    
    -- Prompt 信息
    final_prompt        TEXT COMMENT '最终发送给模型的完整Prompt',
    
    -- 模型信息
    model_id            VARCHAR(64) COMMENT '实际使用的模型',
    input_tokens        INT COMMENT '输入token数',
    output_tokens       INT COMMENT '输出token数',
    latency_ms          INT COMMENT '生成耗时（毫秒）',
    
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_task (task_id),
    INDEX idx_validation (validation_status),
    INDEX idx_review (review_status, created_at),
    
    FOREIGN KEY (task_id) REFERENCES qge_generation_task(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='生成题目记录';
```

### 3.3 生成模板表 `qge_prompt_template`

针对不同学科和题型的生成 Prompt 模板。

```sql
CREATE TABLE qge_prompt_template (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    template_code   VARCHAR(64) NOT NULL UNIQUE COMMENT '模板编码: math_calc_senior|chinese_essay_primary|...',
    
    -- 适用范围
    subject_code    VARCHAR(16) NOT NULL COMMENT '学科编码',
    question_type   TINYINT NOT NULL COMMENT '题型',
    stage_code      VARCHAR(16) COMMENT '适用学段（NULL表示全学段）',
    grade_range     VARCHAR(32) COMMENT '适用年级范围: "G7-G9"',
    
    -- 模板内容
    system_prompt   TEXT NOT NULL COMMENT '系统提示词',
    user_prompt_template TEXT NOT NULL COMMENT '用户Prompt模板，支持变量: {{knowledge_point}}, {{difficulty}}, {{grade}}...',
    
    -- 输出格式约束
    output_schema   JSON NOT NULL COMMENT '期望的输出JSON Schema',
    
    -- 配置
    model_preference VARCHAR(64) COMMENT '偏好模型: reasoning|general|multimodal',
    temperature     DECIMAL(3,2) DEFAULT 0.70 COMMENT '生成温度',
    max_output_tokens INT DEFAULT 2048 COMMENT '最大输出token',
    
    -- 状态
    is_active       TINYINT(1) NOT NULL DEFAULT 1,
    version         INT NOT NULL DEFAULT 1 COMMENT '模板版本',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_subject_type (subject_code, question_type, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='题目生成Prompt模板';
```

---

## 4. 核心流程设计

### 4.1 单题生成流程（同步/异步）

单题生成是最基础的调用模式，适用于"再来一道"等实时场景。

```python
from dataclasses import dataclass
from typing import Optional
from enum import Enum


class GenerationType(str, Enum):
    FRESH = "fresh"              # 全新生成（基于知识点+难度）
    VARIANT = "variant"          # 变式生成（基于已有题目）
    MISTAKE_RELATED = "mistake_related"  # 错题关联生成


@dataclass
class GenerateRequest:
    """题目生成请求"""
    generation_type: GenerationType
    subject_code: str
    grade_code: str
    stage_code: str
    question_type: int
    difficulty: int                          # 1-5
    knowledge_point_ids: list[int]           # 可选，知识点列表
    chapter_id: Optional[int] = None         # 可选，章节ID
    source_question_id: Optional[int] = None # 变式题源题ID
    variant_strategy: Optional[str] = None   # 变式策略
    context: Optional[str] = None            # 额外上下文（如学生薄弱点描述）
    count: int = 1                           # 生成数量
    async_mode: bool = False                 # 是否异步


@dataclass
class GeneratedQuestion:
    """生成结果"""
    stem: str
    options: Optional[list[dict]]  # [{"label":"A","content":"..."}]
    answer: str
    analysis: str                  # 分步解析
    question_type: int
    estimated_difficulty: float    # 模型自评难度
    quality_score: float          # 综合质量分
    validation_passed: bool
    validation_details: dict


async def generate_single(req: GenerateRequest) -> GeneratedQuestion:
    """单题生成主流程"""

    # 1. 参数校验
    validate_generate_request(req)

    # 2. 获取知识点上下文
    kp_context = await fetch_knowledge_context(
        req.knowledge_point_ids,
        req.chapter_id
    )

    # 3. 获取参考题（如有）
    reference = None
    if req.generation_type == GenerationType.VARIANT:
        reference = await fetch_source_question(req.source_question_id)

    # 4. 选择 Prompt 模板
    template = await select_prompt_template(
        subject_code=req.subject_code,
        question_type=req.question_type,
        stage_code=req.stage_code,
        grade_code=req.grade_code
    )

    # 5. 构建 Prompt
    prompt = build_generation_prompt(
        template=template,
        request=req,
        kp_context=kp_context,
        reference=reference
    )

    # 6. 调用模型
    raw_output, meta = await call_llm(
        model_preference=template.model_preference,
        system_prompt=template.system_prompt,
        user_prompt=prompt,
        temperature=template.temperature,
        max_tokens=template.max_output_tokens,
        output_schema=template.output_schema
    )

    # 7. 解析输出
    parsed = parse_llm_output(raw_output, template.output_schema)

    # 8. 校验管线
    validation = await run_validation_pipeline(
        parsed=parsed,
        request=req,
        kp_context=kp_context
    )

    # 9. 生成结果
    question = GeneratedQuestion(
        stem=parsed["stem"],
        options=parsed.get("options"),
        answer=parsed["answer"],
        analysis=parsed.get("analysis", ""),
        question_type=req.question_type,
        estimated_difficulty=validation.difficulty_check.get("estimated", req.difficulty),
        quality_score=validation.overall_score,
        validation_passed=validation.all_passed,
        validation_details=validation.to_dict()
    )

    # 10. 记录生成日志
    await log_generation(
        request=req,
        question=question,
        prompt=prompt,
        raw_output=raw_output,
        meta=meta,
        validation=validation
    )

    # 11. 通过校验 → 自动入题库草稿
    if question.validation_passed:
        await save_to_question_bank(question, req, review_status="auto_approved" if question.quality_score >= 0.9 else "pending_review")

    return question
```

### 4.2 变式题生成策略

变式题是基于已有题目的改编生成，保持知识点和考察目标一致，但改变参数、情境或条件。

```python
class VariantStrategy(str, Enum):
    PARAM_SWAP = "param_swap"          # 参数替换（数值、单位、条件值）
    CONTEXT_CHANGE = "context_change"  # 情境变换（生活场景替换）
    REVERSE = "reverse"                # 逆向出题（已知→求解互换）
    COMBINE = "combine"                # 条件组合（增删条件）
    DIFFICULTY_UP = "difficulty_up"    # 难度提升（增加中间步骤）
    DIFFICULTY_DOWN = "difficulty_down"# 难度降低（减少中间步骤）


def build_variant_prompt(
    template: QGEPromptTemplate,
    source_question: Question,
    strategy: VariantStrategy,
    target_difficulty: int
) -> str:
    """构建变式题 Prompt"""

    strategy_instructions = {
        VariantStrategy.PARAM_SWAP: (
            "保持题目结构和考察知识点不变，替换题目中的数值参数。"
            "新参数应确保答案仍然为整数或简单分数，计算过程合理。"
            "不要改变题目的解题方法。"
        ),
        VariantStrategy.CONTEXT_CHANGE: (
            "保持数学/物理/化学模型不变，替换生活场景描述。"
            "例如：将'买东西'改为'分配物品'，将'行走'改为'游泳'。"
            "新情境应贴近学生日常生活，语言自然。"
        ),
        VariantStrategy.REVERSE: (
            "将原题的条件和问题互换。原题的答案变为新题的已知条件，"
            "原题的某个已知条件变为新题的求解目标。"
            "确保新题有唯一解。"
        ),
        VariantStrategy.COMBINE: (
            "在原题基础上增加一个条件，使题目需要更多步骤才能解答。"
            "或者删除一个非必要条件，要求学生自行判断是否充分。"
        ),
        VariantStrategy.DIFFICULTY_UP: (
            "在原题基础上增加一个中间计算步骤或概念层次，"
            "使解题过程更复杂。保持核心知识点不变。"
        ),
        VariantStrategy.DIFFICULTY_DOWN: (
            "简化原题，减少中间步骤，降低计算复杂度。"
            "保持核心考察点不变，但减少需要同时运用概念的数量。"
        ),
    }

    return template.user_prompt_template.format(
        subject=source_question.subject_code,
        grade=source_question.grade_code,
        difficulty=target_difficulty,
        knowledge_point=source_question.knowledge_points_summary,
        strategy=strategy_instructions[strategy],
        source_stem=source_question.stem,
        source_answer=source_question.answer,
        source_analysis=source_question.analysis,
    )
```

### 4.3 批量生成流程（异步）

批量生成由运营后台或系统自动触发，走异步任务队列。

```python
from celery import shared_task


@shared_task(
    name="qge.batch_generate",
    bind=True,
    max_retries=2,
    time_limit=1800,  # 30分钟超时
    queue="qge_generation"
)
def batch_generate_task(self, task_uuid: str):
    """批量生成异步任务"""
    task = QGEDB.get_task(task_uuid)

    try:
        task.update_status("running")

        # 1. 解析生成参数
        params = task.parse_params()
        template = select_template(params)
        kp_list = fetch_knowledge_points(params.knowledge_point_ids)

        generated = 0
        passed = 0
        failed = 0

        # 2. 按题型分批生成
        for q_type in params.question_types:
            remaining = params.target_count - generated
            if remaining <= 0:
                break

            batch_size = min(remaining, 5)  # 每批最多5题，避免模型过载

            for kp in kp_list:
                if generated >= params.target_count:
                    break

                # 2a. 构建批量 Prompt
                prompt = build_batch_prompt(
                    template, q_type, kp,
                    params.difficulty_range,
                    count=batch_size
                )

                # 2b. 调用模型（带重试）
                try:
                    raw_results = call_llm_with_retry(
                        prompt=prompt,
                        model=template.model_preference,
                        max_retries=3
                    )
                except LLMError as e:
                    log_generation_error(task, kp, q_type, e)
                    continue

                # 2c. 逐题校验
                for raw_q in raw_results:
                    generated += 1

                    validation = run_validation(raw_q, params, kp)

                    if validation.all_passed:
                        passed += 1
                        save_to_question_bank(
                            raw_q, params,
                            review_status="pending_review"
                        )
                    else:
                        failed += 1
                        save_failed_generation(raw_q, validation)

                # 2d. 更新进度
                progress = int(generated / params.target_count * 100)
                task.update_progress(progress, generated, passed, failed)

                # 2e. 限速：避免过快调用
                rate_limit_sleep(template.model_preference)

        # 3. 完成任务
        task.update_status("completed" if passed > 0 else "failed")

    except Exception as e:
        task.update_status("failed", error=str(e))
        raise self.retry(exc=e, countdown=60)
```

### 4.4 自动补题触发逻辑

当练习/推荐系统发现某知识点题源不足时，自动触发生成。

```python
# 阈值配置
QUESTION_POOL_THRESHOLDS = {
    "chapter_practice": 15,    # 章节练习至少需要15题
    "topic_drill": 10,         # 专题训练至少需要10题
    "smart_recommend": 5,      # 智能推荐至少需要5题
    "mock_exam": 30,           # 模拟测评至少需要30题
}


async def check_and_refill(
    knowledge_point_id: int,
    subject_code: str,
    grade_code: str,
    difficulty: int,
    question_type: int,
    scenario: str,
    current_count: int
) -> bool:
    """
    检查题源并触发自动补充。
    返回 True 表示触发了补充任务。
    """
    threshold = QUESTION_POOL_THRESHOLDS.get(scenario, 10)

    if current_count >= threshold:
        return False

    deficit = threshold - current_count
    generate_count = deficit + 5  # 多生成一些余量

    # 检查是否已有进行中的补充任务（避免重复）
    existing = await QGEDB.find_active_refill_task(
        knowledge_point_id=knowledge_point_id,
        subject_code=subject_code,
        difficulty=difficulty
    )
    if existing:
        return False

    # 创建异步生成任务
    task = await QGEDB.create_task(
        trigger_type="auto_refill",
        subject_code=subject_code,
        grade_code=grade_code,
        question_types=[question_type],
        knowledge_point_ids=[knowledge_point_id],
        difficulty_range={"min": max(1, difficulty - 1), "max": min(5, difficulty + 1)},
        target_count=generate_count
    )

    # 提交到异步队列
    batch_generate_task.delay(task.task_uuid)

    return True
```

---

## 5. Prompt 模板设计

### 5.1 模板结构

每个学科 × 题型组合对应一个生成模板。以下为关键学科的模板示例。

### 5.2 数学计算题模板（初中）

```
[System Prompt]
你是一位经验丰富的中学数学教师，擅长出题。你将根据给定的知识点和难度要求，生成一道数学计算题。

要求：
1. 题目语言简洁清晰，适合{{stage_code}}学生阅读
2. 题目中的数值应便于计算（整数、简单分数或小数）
3. 题目必须有唯一确定的答案
4. 必须提供分步解析，每步说明所用公式/方法
5. 标注所考察的主要知识点和解题方法
6. 难度说明：1=直接套公式 2=一步变形 3=多步综合 4=需要辅助构造 5=竞赛级

[User Prompt]
请生成一道数学计算题：

## 约束条件
- 年级：{{grade_code}}
- 知识点：{{knowledge_point_names}}
- 难度等级：{{difficulty}}（1-5）
- 教材章节：{{chapter_name}}

## 知识点说明
{{knowledge_point_descriptions}}

## 输出格式
请严格按以下 JSON 格式输出：
{
  "stem": "题干文本，使用 $...$ 表示行内公式，$$...$$ 表示独立公式",
  "answer": "答案文本",
  "analysis": {
    "method": "解题方法名称",
    "steps": [
      {"step": 1, "content": "步骤内容", "formula": "所用公式（如有）"},
      {"step": 2, "content": "步骤内容", "formula": "所用公式"}
    ],
    "key_point": "本题关键点",
    "common_mistake": "常见错误提示"
  },
  "difficulty_self_eval": 3,
  "knowledge_tags": ["标签1", "标签2"]
}
```

### 5.3 英语选择题模板（高中）

```
[System Prompt]
你是一位高中英语教师，擅长出语法和词汇选择题。根据给定的语法点和难度，生成一道单项选择题。

要求：
1. 题干为英语（可含中文注释说明考察点）
2. 四个选项只有一个正确答案
3. 三个干扰项应具有合理的干扰性（常见错误、形近词、语法陷阱）
4. 解析需说明正确答案理由和各干扰项为何错误
5. 难度对应：1=基础语法 2=常见用法 3=综合运用 4=特殊结构 5=高阶表达

[User Prompt]
请生成一道英语单项选择题：

## 约束条件
- 年级：{{grade_code}}
- 考察点：{{knowledge_point_names}}
- 难度等级：{{difficulty}}（1-5）

## 知识点说明
{{knowledge_point_descriptions}}

## 输出格式
请严格按以下 JSON 格式输出：
{
  "stem": "题干（横线处用 _____ 标记）",
  "options": [
    {"label": "A", "content": "选项内容", "is_correct": false},
    {"label": "B", "content": "选项内容", "is_correct": true},
    {"label": "C", "content": "选项内容", "is_correct": false},
    {"label": "D", "content": "选项内容", "is_correct": false}
  ],
  "answer": "B",
  "analysis": {
    "correct_reason": "正确答案解析",
    "distractor_analysis": {
      "A": "干扰项分析（常见错误原因）",
      "C": "干扰项分析",
      "D": "干扰项分析"
    },
    "grammar_point": "核心语法点总结"
  },
  "difficulty_self_eval": 3,
  "knowledge_tags": ["标签1"]
}
```

### 5.4 语文阅读理解/填空题模板（小学）

```
[System Prompt]
你是一位小学语文教师，擅长出阅读理解和基础知识填空题。题目语言应简洁、温馨，适合小学生理解。

要求：
1. 填空题的答案应明确、唯一（考虑同义词可给多个可接受答案）
2. 阅读材料应选自适合小学生阅读的内容，积极向上
3. 避免超出年级范围的词汇和知识点
4. 解析用简单易懂的语言说明
5. 难度：1=直接提取 2=简单理解 3=概括归纳 4=推理判断 5=综合运用

[User Prompt]
请生成一道语文填空题：

## 约束条件
- 年级：{{grade_code}}
- 知识点：{{knowledge_point_names}}（如：近义词、反义词、成语填空、古诗文默写）
- 难度等级：{{difficulty}}（1-5）
- 教材单元：{{chapter_name}}

## 知识点说明
{{knowledge_point_descriptions}}

## 输出格式
{
  "stem": "题目文本，空格用 ____ 标记",
  "answer": "标准答案（多个可接受答案用 / 分隔）",
  "acceptable_answers": ["答案1", "答案2"],
  "analysis": {
    "explanation": "知识点解释",
    "tip": "记忆或答题技巧"
  },
  "difficulty_self_eval": 3,
  "knowledge_tags": ["标签1"]
}
```

### 5.5 模板变量说明

| 变量 | 来源 | 说明 |
|------|------|------|
| `{{grade_code}}` | 用户档案 | 年级编码（如 G7） |
| `{{stage_code}}` | 用户档案 | 学段编码 |
| `{{difficulty}}` | 请求参数 | 目标难度 1-5 |
| `{{knowledge_point_names}}` | 知识点服务 | 知识点名称列表 |
| `{{knowledge_point_descriptions}}` | 知识点服务 | 知识点详细描述 |
| `{{chapter_name}}` | 教材服务 | 教材章节名称 |
| `{{source_stem}}` | 题库服务 | 变式题源题干（仅变式模式） |
| `{{source_answer}}` | 题库服务 | 变式题源答案（仅变式模式） |
| `{{source_analysis}}` | 题库服务 | 变式题源解析（仅变式模式） |
| `{{strategy}}` | 请求参数 | 变式策略指令（仅变式模式） |

---

## 6. 校验管线设计

校验管线是保证生成质量的关键环节，每道生成题目必须通过所有校验关卡才能入库。

### 6.1 校验流程

```
生成题目
    │
    ▼
┌─────────────┐  失败  ┌──────────────┐
│ 1.格式校验   │───────→│ 记录失败日志  │
│ (JSON完整、  │        │ 尝试重新解析  │
│  必填字段)   │        └──────────────┘
└──────┬──────┘
       │ 通过
       ▼
┌─────────────┐  失败  ┌──────────────┐
│ 2.答案校验   │───────→│ 尝试自动修正  │
│ (计算验证、  │        │ 或标记失败    │
│  逻辑一致)   │        └──────────────┘
└──────┬──────┘
       │ 通过
       ▼
┌─────────────┐  偏差大 ┌──────────────┐
│ 3.难度评估   │───────→│ 调整或丢弃    │
│ (目标vs实际) │        └──────────────┘
└──────┬──────┘
       │ 通过
       ▼
┌─────────────┐  不安全 ┌──────────────┐
│ 4.内容安全   │───────→│ 直接丢弃      │
│ (敏感词、    │        │ 记录告警      │
|  不当内容)   │        └──────────────┘
└──────┬──────┘
       │ 通过
       ▼
┌─────────────┐  重复  ┌──────────────┐
│ 5.去重检测   │───────→│ 丢弃或修改    │
│ (SimHash/   │        └──────────────┘
│  向量相似度) │
└──────┬──────┘
       │ 通过
       ▼
┌─────────────┐
│ 6.综合评分   │
│ & 入库决策   │
└─────────────┘
```

### 6.2 格式校验

```python
class FormatValidator:
    """格式校验器"""

    REQUIRED_FIELDS = {
        1: ["stem", "options", "answer"],       # 单选
        2: ["stem", "options", "answer"],       # 多选
        3: ["stem", "answer"],                  # 填空
        4: ["stem", "answer"],                  # 判断
        5: ["stem", "answer", "analysis"],      # 简答
        6: ["stem", "answer", "analysis"],      # 计算
        7: ["stem", "answer", "analysis"],      # 证明
    }

    def validate(self, parsed: dict, question_type: int) -> FormatCheckResult:
        errors = []

        # 1. 检查必填字段
        required = self.REQUIRED_FIELDS.get(question_type, ["stem", "answer"])
        for field in required:
            if field not in parsed or not parsed[field]:
                errors.append(f"缺少必填字段: {field}")

        # 2. 选择题选项校验
        if question_type in (1, 2):
            options = parsed.get("options", [])
            if len(options) < 2:
                errors.append("选择题至少需要2个选项")
            labels = [o.get("label") for o in options]
            if len(labels) != len(set(labels)):
                errors.append("选项标签重复")
            # 检查是否有标记正确答案
            correct_count = sum(1 for o in options if o.get("is_correct"))
            if question_type == 1 and correct_count != 1:
                errors.append(f"单选题应有1个正确选项，实际{correct_count}个")
            elif question_type == 2 and correct_count < 2:
                errors.append(f"多选题应有≥2个正确选项，实际{correct_count}个")

        # 3. 题干长度校验
        stem = parsed.get("stem", "")
        if len(stem) < 5:
            errors.append("题干过短")
        elif len(stem) > 2000:
            errors.append("题干过长")

        # 4. 公式标记校验（检查 LaTeX 语法基本正确性）
        self._validate_latex(stem, errors)

        return FormatCheckResult(
            passed=len(errors) == 0,
            errors=errors
        )

    def _validate_latex(self, text: str, errors: list):
        """基本 LaTeX 语法检查"""
        import re
        # 检查未闭合的 $ 符号
        dollar_count = text.count('$') - text.count('\\$')
        if dollar_count % 2 != 0:
            errors.append("存在未闭合的公式标记 $")
```

### 6.3 答案校验（理科）

对于数学、物理、化学等理科学科，通过独立求解验证答案正确性。

```python
class AnswerValidator:
    """答案校验器"""

    async def validate(
        self,
        question: dict,
        subject_code: str,
        question_type: int
    ) -> AnswerCheckResult:
        """
        答案校验策略:
        1. 理科计算题 → 调用求解模型独立验证
        2. 选择题 → 检查选项与答案一致性
        3. 文科题 → 用另一个模型交叉验证
        """

        if question_type == 6 and subject_code in ("MATH", "PHYSICS", "CHEMISTRY"):
            # 理科计算题：独立求解
            return await self._validate_by_solving(question, subject_code)
        elif question_type in (1, 2):
            # 选择题：选项一致性
            return self._validate_choice_consistency(question)
        else:
            # 其他题型：交叉验证
            return await self._validate_by_cross_check(question, subject_code)

    async def _validate_by_solving(
        self, question: dict, subject_code: str
    ) -> AnswerCheckResult:
        """通过独立求解验证计算题答案"""

        # 使用推理模型独立求解
        verification_prompt = f"""
        请独立求解以下题目，给出你的答案。

        题目：{question['stem']}

        要求：
        1. 逐步求解
        2. 给出最终答案
        3. 如果题目条件不足或存在矛盾，请指出
        """

        result = await call_llm(
            model_preference="reasoning",  # 使用推理能力强的模型
            user_prompt=verification_prompt,
            temperature=0.1,  # 低温度确保确定性
        )

        # 比对答案
        generated_answer = normalize_answer(question["answer"])
        verified_answer = normalize_answer(extract_answer(result))

        is_consistent = compare_answers(generated_answer, verified_answer)

        return AnswerCheckResult(
            method="solve",
            passed=is_consistent,
            generated_answer=generated_answer,
            verified_answer=verified_answer,
            verification_detail=result
        )

    def _validate_choice_consistency(self, question: dict) -> AnswerCheckResult:
        """选择题选项一致性校验"""
        errors = []
        options = question.get("options", [])
        answer = question.get("answer", "")

        # 检查 answer 与 options 中 is_correct 标记一致
        correct_labels = [o["label"] for o in options if o.get("is_correct")]

        if answer not in correct_labels and len(correct_labels) > 0:
            errors.append(
                f"答案字段为 {answer}，但选项标记正确为 {','.join(correct_labels)}"
            )

        # 检查选项内容是否有重复
        contents = [normalize_text(o.get("content", "")) for o in options]
        for i in range(len(contents)):
            for j in range(i + 1, len(contents)):
                if contents[i] == contents[j]:
                    errors.append(f"选项 {options[i]['label']} 和 {options[j]['label']} 内容相同")

        return AnswerCheckResult(
            method="consistency",
            passed=len(errors) == 0,
            errors=errors
        )
```

### 6.4 难度评估

```python
class DifficultyAssessor:
    """难度评估器"""

    async def assess(
        self,
        question: dict,
        target_difficulty: int
    ) -> DifficultyCheckResult:
        """
        评估生成题目的实际难度是否与目标匹配。
        综合使用模型自评 + 规则特征 + 历史统计。
        """

        # 1. 模型自评（已包含在输出中）
        self_eval = question.get("difficulty_self_eval", target_difficulty)

        # 2. 规则特征评估
        feature_difficulty = self._assess_by_features(question)

        # 3. 综合评估
        estimated = round(
            self_eval * 0.4 + feature_difficulty * 0.6, 1
        )

        # 4. 计算与目标的偏差
        delta = abs(estimated - target_difficulty)
        confidence = 1.0 - min(delta / 3.0, 1.0)  # 偏差越大置信度越低

        return DifficultyCheckResult(
            target=target_difficulty,
            estimated=estimated,
            delta=delta,
            confidence=confidence,
            passed=(delta <= 1.0)  # 允许±1级偏差
        )

    def _assess_by_features(self, question: dict) -> float:
        """基于题目特征评估难度"""
        score = 2.0  # 基准难度

        stem = question.get("stem", "")
        analysis = question.get("analysis", {})
        steps = analysis.get("steps", [])

        # 步骤数量
        if len(steps) >= 5:
            score += 1.0
        elif len(steps) >= 3:
            score += 0.5

        # 是否涉及多个知识点
        tags = question.get("knowledge_tags", [])
        if len(tags) >= 3:
            score += 0.5

        # 题干长度（复杂度代理）
        if len(stem) > 300:
            score += 0.3

        # 是否包含公式
        if "$" in stem:
            score += 0.3

        return min(score, 5.0)
```

### 6.5 去重检测

```python
class DedupChecker:
    """题目去重检测器"""

    SIMILARITY_THRESHOLD = 0.85  # SimHash 相似度阈值

    async def check(self, question: dict, subject_code: str) -> DedupCheckResult:
        """
        多级去重检测：
        1. 精确哈希匹配（题干 MD5）
        2. SimHash 汉明距离
        3. 语义向量相似度
        """

        stem = normalize_text(question["stem"])

        # Level 1: 精确哈希
        stem_hash = hashlib.md5(stem.encode()).hexdigest()
        exact_match = await QuestionDB.exists_by_hash(stem_hash)
        if exact_match:
            return DedupCheckResult(
                is_duplicate=True,
                match_type="exact",
                matched_question_id=exact_match
            )

        # Level 2: SimHash
        sim_hash = compute_simhash(stem)
        similar_questions = await QuestionDB.find_by_simhash(
            sim_hash,
            subject_code=subject_code,
            max_hamming_distance=3
        )
        if similar_questions:
            return DedupCheckResult(
                is_duplicate=True,
                match_type="simhash",
                matched_question_id=similar_questions[0].id,
                min_hash_dist=similar_questions[0].distance
            )

        # Level 3: 语义向量
        stem_embedding = await embed(stem)
        similar_by_vector = await VectorDB.search(
            embedding=stem_embedding,
            collection=f"questions_{subject_code}",
            top_k=5,
            threshold=self.SIMILARITY_THRESHOLD
        )
        if similar_by_vector:
            return DedupCheckResult(
                is_duplicate=True,
                match_type="semantic",
                matched_question_id=similar_by_vector[0].id,
                min_hash_dist=similar_by_vector[0].score
            )

        return DedupCheckResult(is_duplicate=False)
```

### 6.6 综合质量评分

```python
def compute_overall_score(validation_results: dict) -> float:
    """
    综合质量评分 = 加权平均
    - 格式完整度: 15%
    - 答案正确性: 35%
    - 难度匹配度: 15%
    - 安全性: 10%（不安全直接 0 分）
    - 去重检测: 10%（重复直接 0 分）
    - 解析质量: 15%
    """

    if not validation_results["safety_check"]["safe"]:
        return 0.0
    if validation_results["dedup_check"]["is_duplicate"]:
        return 0.0

    weights = {
        "format": 0.15,
        "answer": 0.35,
        "difficulty": 0.15,
        "safety": 0.10,
        "dedup": 0.10,
        "analysis": 0.15,
    }

    scores = {
        "format": 1.0 if validation_results["format_check"]["passed"] else 0.0,
        "answer": 1.0 if validation_results["answer_check"]["passed"] else 0.5,
        "difficulty": validation_results["difficulty_check"].get("confidence", 0.5),
        "safety": 1.0,
        "dedup": 1.0,
        "analysis": _assess_analysis_quality(validation_results.get("analysis")),
    }

    return sum(weights[k] * scores[k] for k in weights)


def _assess_analysis_quality(analysis: dict) -> float:
    """评估解析质量"""
    if not analysis:
        return 0.0
    score = 0.5  # 基础分
    if analysis.get("steps"):
        score += 0.2
    if analysis.get("key_point"):
        score += 0.15
    if analysis.get("common_mistake"):
        score += 0.15
    return min(score, 1.0)
```

---

## 7. API 接口设计

### 7.1 单题生成

```
POST /api/v1/qge/generate
```

**请求体：**
```json
{
  "generation_type": "variant",
  "subject_code": "MATH",
  "grade_code": "G8",
  "stage_code": "junior",
  "question_type": 6,
  "difficulty": 3,
  "knowledge_point_ids": [10245, 10246],
  "chapter_id": 567,
  "source_question_id": 89012,
  "variant_strategy": "param_swap",
  "count": 1
}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "questions": [
      {
        "id": 102345,
        "stem": "已知一次函数 y = kx + b 的图像经过点 (2, 5) 和点 (4, 9)，求 k 和 b 的值。",
        "question_type": 6,
        "difficulty": 3,
        "answer": "k = 2，b = 1",
        "analysis": {
          "method": "待定系数法",
          "steps": [
            {"step": 1, "content": "将两个点代入 y = kx + b", "formula": "5 = 2k + b; 9 = 4k + b"},
            {"step": 2, "content": "两式相减消去 b", "formula": "9 - 5 = (4k + b) - (2k + b) → 4 = 2k"},
            {"step": 3, "content": "解得 k = 2，代入求 b", "formula": "5 = 2×2 + b → b = 1"}
          ],
          "key_point": "待定系数法求解一次函数解析式",
          "common_mistake": "代入坐标时容易将 x、y 写反"
        },
        "quality_score": 0.92,
        "validation_passed": true
      }
    ],
    "task_id": "uuid-xxx",
    "generation_cost_yuan": 0.012
  }
}
```

### 7.2 批量生成（异步）

```
POST /api/v1/qge/batch
```

**请求体：**
```json
{
  "subject_code": "MATH",
  "grade_code": "G8",
  "stage_code": "junior",
  "question_types": [1, 3, 6],
  "knowledge_point_ids": [10245, 10246, 10247],
  "difficulty_range": {"min": 2, "max": 4},
  "target_count": 30,
  "priority": "normal"
}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "task_id": "uuid-xxx",
    "status": "pending",
    "target_count": 30,
    "estimated_completion_sec": 120
  }
}
```

### 7.3 查询生成任务状态

```
GET /api/v1/qge/tasks/{task_id}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "task_id": "uuid-xxx",
    "status": "running",
    "progress": 60,
    "generated_count": 18,
    "passed_count": 15,
    "failed_count": 3,
    "target_count": 30,
    "started_at": "2026-05-22T10:00:00+08:00",
    "estimated_remaining_sec": 48
  }
}
```

### 7.4 查询题源余量

```
GET /api/v1/qge/pool-status
```

**查询参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| subject_code | string | 是 | 学科编码 |
| grade_code | string | 是 | 年级编码 |
| knowledge_point_id | int | 否 | 知识点ID |
| difficulty | int | 否 | 难度等级 |
| question_type | int | 否 | 题型 |

**响应：**
```json
{
  "code": 0,
  "data": {
    "total_available": 42,
    "by_difficulty": {
      "1": 15, "2": 12, "3": 8, "4": 5, "5": 2
    },
    "by_type": {
      "1": 20, "3": 10, "6": 12
    },
    "refill_needed": true,
    "deficit": {
      "difficulty_4": 5,
      "difficulty_5": 8
    }
    }
}
```

### 7.5 审核生成题目

```
PUT /api/v1/qge/generated-questions/{id}/review
```

**请求体：**
```json
{
  "action": "approve",
  "reviewer_id": 12345,
  "comment": "题目质量好，批准发布"
}
```

或拒绝：
```json
{
  "action": "reject",
  "reviewer_id": 12345,
  "reject_reason": "答案计算有误",
  "comment": "第2步公式应为 2k 而非 3k"
}
```

---

## 8. 模型选择与调度策略

### 8.1 按场景选模型

| 场景 | 偏好模型类型 | 原因 |
|------|-------------|------|
| 数学计算题生成 | reasoning | 需要强推理确保答案正确 |
| 理科变式题 | reasoning | 需要理解原题后改编 |
| 选择题+干扰项 | general | 干扰项生成需创造性，不需强推理 |
| 文科填空/简答 | general | 侧重语言表达能力 |
| 判断题 | general | 简单陈述判断 |
| 证明题 | reasoning | 需要严密逻辑链 |
| 口语题 | general | 情境设计为主 |
| 答案校验(理科) | reasoning | 独立求解验证 |

### 8.2 降级策略

```
首选模型 (reasoning)
    │
    ├─ 超时/错误 → 降级到通用模型 (general)
    │                   │
    │                   ├─ 仍然失败 → 使用本地缓存的已审核备用题
    │                   │                │
    │                   │                └─ 备用题也不足 → 返回"暂时无法生成，请稍后"
    │                   │
    │                   └─ 成功但质量分低 → 标记 pending_review
    │
    └─ 成功但答案校验失败 → 重试一次（换 prompt 措辞）
                            │
                            └─ 仍然失败 → 标记失败，不入库
```

### 8.3 成本控制

```python
# 生成成本预算配置
COST_LIMITS = {
    "per_question": 0.05,       # 单题最大成本 ¥0.05
    "daily_total": 50.0,        # 每日总预算 ¥50
    "monthly_total": 1000.0,    # 月度总预算 ¥1000
    "batch_task_max": 10.0,     # 单个批量任务最大 ¥10
}

# 模型性价比参考
MODEL_COST_TABLE = {
    "reasoning": {"input": 0.004, "output": 0.016},   # 每千token
    "general": {"input": 0.001, "output": 0.004},
    "general_fast": {"input": 0.0005, "output": 0.002},
}

# 预估单题成本
# 典型: prompt ~800 token + output ~600 token
# reasoning: 0.8*0.004 + 0.6*0.016 ≈ ¥0.013
# general: 0.8*0.001 + 0.6*0.004 ≈ ¥0.003
# 答案校验: 额外 ~¥0.01 (reasoning)
# 综合: 单题 ¥0.02~0.05
```

---

## 9. 状态流转

### 9.1 生成任务状态机

```
pending → running → completed
   │         │          │
   │         ├→ partial_success (部分通过)
   │         │
   │         └→ failed
   │
   └→ cancelled
```

### 9.2 生成题目状态流转

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│  LLM 输出 → parsed(格式解析) → validating(校验中)          │
│                                │                           │
│                     ┌──────────┴──────────┐                │
│                     │                     │                │
│                validated              failed               │
│                (校验通过)            (校验失败)              │
│                     │                     │                │
│                     ▼                     ▼                │
│            ┌──────────────┐     ┌──────────────┐           │
│            │ auto_approved│     │  discarded   │           │
│            │ (质量分≥0.9) │     │  (不入库)    │           │
│            └──────┬───────┘     └──────────────┘           │
│                   │                                        │
│                   ▼                                        │
│            published(已发布)                                │
│            (可被练习/测评使用)                               │
│                                                            │
│            OR                                              │
│                                                            │
│            pending_review(待人工审核, 质量分 0.7~0.9)       │
│                   │                                        │
│           ┌───────┴───────┐                                │
│           ▼               ▼                                │
│      approved         rejected                            │
│      (发布)          (不发布)                               │
│           │               │                                │
│           ▼               ▼                                │
│      published       archived                             │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 10. 错误处理

### 10.1 错误码定义

| 错误码 | HTTP 状态 | 说明 | 处理建议 |
|--------|----------|------|----------|
| QGE_001 | 400 | 请求参数无效 | 检查必填字段和取值范围 |
| QGE_002 | 400 | 不支持的题型 | 检查 question_type 是否在支持列表 |
| QGE_003 | 400 | 知识点不存在 | 检查 knowledge_point_ids |
| QGE_004 | 409 | 已有进行中的补充任务 | 无需重复触发 |
| QGE_005 | 429 | 生成频率超限 | 稍后重试 |
| QGE_006 | 503 | 模型服务不可用 | 降级到备选模型或稍后重试 |
| QGE_007 | 500 | 生成超时 | 减少生成数量或降低复杂度 |
| QGE_008 | 500 | 校验管线异常 | 检查校验服务状态 |
| QGE_009 | 403 | 生成预算已耗尽 | 联系管理员调整预算 |
| QGE_010 | 400 | 变式源题目不存在 | 检查 source_question_id |

### 10.2 重试策略

```python
# 不同错误的重试配置
RETRY_CONFIG = {
    "llm_timeout": {"max_retries": 2, "backoff": [5, 15]},
    "llm_error": {"max_retries": 3, "backoff": [3, 10, 30]},
    "validation_error": {"max_retries": 1, "backoff": [0]},
    "format_parse_error": {"max_retries": 2, "backoff": [1, 3]},
}

async def generate_with_retry(
    req: GenerateRequest,
    max_attempts: int = 3
) -> Optional[GeneratedQuestion]:
    """带重试的生成，失败后逐步调整策略"""

    for attempt in range(max_attempts):
        try:
            result = await generate_single(req)

            if result.validation_passed:
                return result

            # 校验失败 → 调整参数重试
            if attempt < max_attempts - 1:
                # 降低生成温度增加确定性
                req._temperature_override = max(0.3, 0.7 - attempt * 0.2)
                logger.warning(
                    f"生成校验未通过(尝试{attempt+1})，"
                    f"质量分={result.quality_score:.2f}，调整参数重试"
                )

        except LLMTimeoutError:
            if attempt < max_attempts - 1:
                logger.warning(f"生成超时(尝试{attempt+1})，重试")
                continue
            raise BusinessException("QGE_007", "生成超时")

        except LLMError as e:
            if attempt < max_attempts - 1:
                await asyncio.sleep(RETRY_CONFIG["llm_error"]["backoff"][attempt])
                continue
            raise BusinessException("QGE_006", f"模型服务不可用: {e}")

    return None  # 多次尝试仍未通过
```

---

## 11. 监控与告警

### 11.1 核心指标

| 指标 | 计算 | 告警阈值 |
|------|------|----------|
| 生成成功率 | passed_count / generated_count | < 70% 告警 |
| 平均质量分 | avg(overall_score) | < 0.75 告警 |
| 平均生成耗时 | avg(latency_ms) | > 10s 告警 |
| 单题平均成本 | avg(cost_per_question) | > ¥0.08 告警 |
| 日生成量 | count(task_id) | 异常波动告警 |
| 校验失败率 | failed_count / generated_count | > 40% 告警 |
| 人工审核拒绝率 | rejected / reviewed | > 20% 告警 |

### 11.2 质量看板指标

- 按学科的生成量 & 通过率趋势
- 按题型的生成质量分布
- 难度偏差分布（目标 vs 实际）
- 去重检测命中率
- 模型生成性价比对比

---

## 12. 缓存策略

### 12.1 预生成缓存

对高频访问的知识点+难度组合，提前生成并缓存题目。

```python
# 预生成策略
PREFILL_CONFIG = {
    # 高频知识点：提前生成并缓存
    "hot_knowledge_points": {
        "trigger": "访问量 > 100/天",
        "prefill_count": 20,
        "refresh_when_below": 10,
        "schedule": "每日 02:00 批量补充"
    },
    # 章节练习：开学季提前填充
    "seasonal_prefill": {
        "trigger": "学期开始前2周",
        "scope": "当前学期所有章节",
        "prefill_per_chapter": 15
    }
}
```

### 12.2 缓存层级

| 缓存层 | 内容 | TTL | 说明 |
|--------|------|-----|------|
| Redis | 题源余量统计 | 10 min | pool-status 接口缓存 |
| Redis | 热点预生成题目ID列表 | 1 hour | 按知识点+难度分组 |
| MySQL | 生成题目记录 | 永久 | 审计和质量追溯 |
| Redis | 进行中任务状态 | 24 hour | 批量任务进度查询 |

---

## 13. 管理后台集成

### 13.1 运营后台页面

| 页面 | 功能 |
|------|------|
| 生成任务管理 | 查看/创建/取消生成任务，查看进度和结果 |
| 生成题目审核 | 审核待审题目，批量通过/拒绝 |
| 模板管理 | CRUD 生成 Prompt 模板，预览和测试 |
| 质量看板 | 生成质量、成本、通过率等可视化 |
| 题源监控 | 各知识点/难度/题型的题目余量和告警 |

### 13.2 审核工作台界面

```
┌─────────────────────────────────────────────────────────┐
│  题目审核工作台                              筛选: 待审核  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 题目 #102345 | 数学 G8 | 难度 3 | 质量分 0.85     │   │
│  │                                                  │   │
│  │ 题干: 已知一次函数 y=kx+b 的图像经过...          │   │
│  │                                                  │   │
│  │ 答案: k=2, b=1                                   │   │
│  │ 解析: [3步] 待定系数法                            │   │
│  │                                                  │   │
│  │ 校验结果: ✅格式 ✅答案 ✅难度 ✅安全 ✅去重       │   │
│  │                                                  │   │
│  │ [✅ 通过] [❌ 拒绝] [⏭ 跳过]                      │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 题目 #102346 | 英语 G10 | 难度 2 | 质量分 0.78    │   │
│  │ ...                                              │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  待审核: 156 | 今日已审核: 43 | 通过率: 88%              │
└─────────────────────────────────────────────────────────┘
```