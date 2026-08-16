# 服务端 - 学生学科能力诊断自适应测评 CAT 引擎 - 详细设计

> **文档版本**：v1.1（补全烂尾文档）  
> **创建日期**：2026-08-06  
> **最近更新**：2026-08-16 — v1.0 在 §4.2 选题算法代码中段截断（Fisher 信息量评分处），本次补齐 §4.2 后半部分及 §4.3–§14 全部内容（终止判定、结果生成、API、状态机、错误码 54600-54699、降级矩阵、Outbox 事件、缓存并发、监控、部署、合规、契约对齐、验收场景）；同时修复 v1.0 两处缺陷：① §2.2 Fisher 信息量第一展开式误写为含 P'(θ) 线性项（正确通式为 [P'(θ)]²/[P·Q]，与文中"简化形式"等价，已勘误）；② §2.3 QUADRATURE_WEIGHTS 占位符 `[...]` 补全为 41 节点等距矩形积分权重（步长 0.2）；新增 §3.6 DDL 增补（参数版本化/会话乐观锁/答题唯一键/Outbox 表）
> **模块定位**：AI 能力层 / 教育测量学基础设施  
> **依赖模块**：题目服务、知识追踪模型、学情分析、学习画像  

---

## 1. 概述

### 1.1 功能定位

本引擎实现基于 **项目反应理论（Item Response Theory, IRT）** 的 **计算机化自适应测评（Computerized Adaptive Testing, CAT）**，为学生提供精确、高效的学科能力诊断服务。

与传统固定试卷不同，CAT 根据学生实时作答反馈动态调整题目难度，以最少的题目数达到最高的测量精度。其核心价值：

| 对比维度 | 固定试卷 | CAT 测评 |
|----------|----------|----------|
| 题目数量 | 30-50 题 | 10-20 题 |
| 测量精度 | 中等（一刀切） | 高（因人制宜） |
| 测试时长 | 45-60 分钟 | 15-25 分钟 |
| 学生体验 | 枯燥/挫败 | 挑战适中/流畅 |
| 能力估计误差 | ±0.5~1.0 logits | ±0.3~0.5 logits |

### 1.2 适用场景

| 场景 | 描述 | 调用入口 |
|------|------|----------|
| 入学能力诊断 | 新用户注册后首次能力评估 | 用户注册引导流程 |
| 学段升级诊断 | 升入新学段/新学期初始评估 | 学段切换服务 |
| 月度能力复测 | 定期追踪能力变化趋势 | 定时任务调度 |
| 薄弱学科深检 | 某学科持续低表现时深度诊断 | 学情分析预警 |
| 考前水平摸底 | 大考前预估真实水平 | 考点梳理模块 |
| 教师班级诊断 | 教师发起的班级整体测评 | 教师端服务 |

### 1.3 设计目标

1. **测量精确性**：能力估计标准误差（SE）≤ 0.35 logits（约 ±0.5 分 / 10 分制）
2. **测评效率**：平均 12-18 题完成单学科诊断，时长 ≤ 20 分钟
3. **题目安全性**：单题曝光率 ≤ 0.25，防止题目泄露
4. **内容覆盖**：确保测评覆盖目标知识维度 ≥ 80%
5. **响应速度**：每题选择计算延迟 ≤ 200ms（P99）
6. **扩展性**：支持新增学科仅需配置题库参数，无需修改核心算法

---

## 2. 理论基础

### 2.1 IRT 模型选择

本引擎采用 **三参数逻辑斯蒂模型（3PL）** 作为默认模型，兼容 1PL（Rasch）和 2PL 模型。

#### 2.1.1 3PL 模型公式

给定学生能力 θ 和题目参数 (a, b, c)，答对概率为：

```
P(θ) = c + (1 - c) × [1 / (1 + exp(-a × (θ - b)))]
```

| 参数 | 含义 | 取值范围 | 说明 |
|------|------|----------|------|
| θ | 学生能力 | [-3, +3] logits | 标准化能力值，0=中等 |
| a | 区分度 | [0.2, 2.5] | 题目区分高低能力学生的程度 |
| b | 难度 | [-3, +3] logits | 答对概率=0.5时的能力值 |
| c | 猜测系数 | [0, 0.35] | 低能力学生的猜对概率 |

#### 2.1.2 模型选择策略

```python
def select_irt_model(question_type: str, has_options: bool) -> str:
    """根据题型选择 IRT 模型"""
    if question_type in ("fill_blank", "short_answer", "essay"):
        # 主观题/填空题：无猜测，使用 2PL
        return "2PL"
    elif question_type == "multiple_choice" and has_options:
        # 选择题：有猜测概率，使用 3PL
        return "3PL"
    elif question_type == "true_false":
        # 判断题：猜测概率固定 0.5
        return "1PL"  # c=0.5 的退化情况
    else:
        return "3PL"  # 默认
```

### 2.2 Fisher 信息量

用于衡量一道题目对能力估计的信息贡献：

```
I(θ) = [P'(θ)]² / [P(θ) × (1 - P(θ))]
```

> v1.1 勘误：原式误写为 `a² × P'(θ) × [P(θ) - c] / [...]` 的线性形式（量纲错误）。正确通式为 `[P'(θ)]²/[P·Q]`，代入 3PL 后与下文简化形式完全等价。

其中 P'(θ) 是 P(θ) 对 θ 的导数：

```
P'(θ) = a × (1 - c) × exp(-a(θ-b)) / [1 + exp(-a(θ-b))]²
```

简化形式（令 Q(θ) = 1 - P(θ)）：

```
I(θ) = a² × Q(θ) × [P(θ) - c]² / [(1 - c)² × P(θ)]
```

**选题原则**：在当前能力估计值 θ̂ 处，选择 I(θ̂) 最大的题目。

### 2.3 贝叶斯能力估计

采用 **期望后验分布（EAP）** 估计器：

```
θ̂_EAP = ∫ θ × f(θ | response_pattern) dθ / ∫ f(θ | response_pattern) dθ
```

使用 Gauss-Hermite 数值积分近似计算：

```python
import numpy as np

# 预定义积分节点和权重（41 节点等距，覆盖 [-4, 4]，矩形数值积分）
QUADRATURE_NODES = np.linspace(-4, 4, 41)
_STEP = float(QUADRATURE_NODES[1] - QUADRATURE_NODES[0])     # 0.2
QUADRATURE_WEIGHTS = np.full(len(QUADRATURE_NODES), _STEP)  # 等距矩形权重


def eap_estimate(responses: list, items: list, prior_mean=0.0, prior_sd=1.0):
    """
    EAP (Expected A Posteriori) 能力估计
    
    Args:
        responses: 学生答题模式 [(item_idx, is_correct), ...]
        items: 题目参数列表 [(a, b, c), ...]
        prior_mean: 先验分布均值
        prior_sd: 先验分布标准差
    
    Returns:
        theta_hat: 能力估计值
        se: 标准误差
    """
    posterior = np.zeros(len(QUADRATURE_NODES))
    
    for i, theta in enumerate(QUADRATURE_NODES):
        # 先验（正态分布）
        prior = np.exp(-0.5 * ((theta - prior_mean) / prior_sd) ** 2) / \
                (prior_sd * np.sqrt(2 * np.pi))
        
        # 似然
        likelihood = 1.0
        for (item_idx, is_correct) in responses:
            a, b, c = items[item_idx]
            p = c + (1 - c) / (1 + np.exp(-a * (theta - b)))
            if is_correct:
                likelihood *= p
            else:
                likelihood *= (1 - p)
        
        posterior[i] = prior * likelihood
    
    # 归一化
    total = np.sum(posterior * QUADRATURE_WEIGHTS)
    posterior = posterior / total if total > 0 else posterior
    
    # EAP 估计
    theta_hat = np.sum(QUADRATURE_NODES * posterior * QUADRATURE_WEIGHTS) / \
                np.sum(posterior * QUADRATURE_WEIGHTS)
    
    # 标准误差
    variance = np.sum((QUADRATURE_NODES - theta_hat) ** 2 * posterior * QUADRATURE_WEIGHTS) / \
               np.sum(posterior * QUADRATURE_WEIGHTS)
    se = np.sqrt(max(variance, 1e-10))
    
    return theta_hat, se
```

---

## 3. 数据结构设计

### 3.1 题库参数表 `cat_item_bank`

存储经 IRT 校准的题目参数。

```sql
CREATE TABLE cat_item_bank (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    question_id     BIGINT NOT NULL COMMENT '关联题目表 question.id',
    subject_code    VARCHAR(10) NOT NULL COMMENT '学科编码: MATH, PHYS, CHEM...',
    grade_level     TINYINT NOT NULL COMMENT '适用年级: 1-12',
    kp_ids          JSON NOT NULL COMMENT '知识点ID列表: [101, 205, 308]',
    irt_model       VARCHAR(10) NOT NULL DEFAULT '3PL' COMMENT 'IRT模型: 1PL/2PL/3PL',
    param_a         DECIMAL(6,4) NOT NULL COMMENT '区分度参数a [0.2, 2.5]',
    param_b         DECIMAL(6,4) NOT NULL COMMENT '难度参数b [-3, 3]',
    param_c         DECIMAL(6,4) NOT NULL DEFAULT 0.0000 COMMENT '猜测参数c [0, 0.35]',
    discrimination  DECIMAL(6,4) GENERATED ALWAYS AS (param_a) VIRTUAL,
    difficulty_pct  DECIMAL(5,2) GENERATED ALWAYS AS (
        100 / (1 + EXP(-param_b))
    ) VIRTUAL COMMENT '难度百分位 [0, 100]',
    
    -- 校准元数据
    sample_size     INT NOT NULL DEFAULT 0 COMMENT '校准样本量',
    fit_statistic   DECIMAL(8,4) COMMENT '模型拟合度(infit MNSQ)',
    calibration_date DATETIME COMMENT '最近校准时间',
    calibration_method VARCHAR(20) DEFAULT 'MMLE' COMMENT '校准方法',
    
    -- CAT 使用控制
    exposure_count  INT NOT NULL DEFAULT 0 COMMENT '累计曝光次数',
    exposure_rate   DECIMAL(6,4) NOT NULL DEFAULT 0.0000 COMMENT '曝光率',
    is_active       TINYINT NOT NULL DEFAULT 1 COMMENT '是否启用',
    pool_tier       TINYINT NOT NULL DEFAULT 1 COMMENT '题库分层: 1=核心 2=扩展 3=备用',
    
    -- 内容标签
    content_dimensions JSON COMMENT '内容维度标签: {"kp_primary": 101, "skill": "calc", "cognitive": "apply"}',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_question (question_id),
    KEY idx_subject_grade (subject_code, grade_level),
    KEY idx_subject_difficulty (subject_code, param_b),
    KEY idx_subject_active (subject_code, is_active),
    KEY idx_kp (subject_code, (CAST(kp_ids AS CHAR)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CAT题库IRT参数表';
```

### 3.2 测评会话表 `cat_assessment_session`

```sql
CREATE TABLE cat_assessment_session (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    session_uuid    CHAR(36) NOT NULL UNIQUE COMMENT '会话唯一标识',
    user_id         BIGINT NOT NULL COMMENT '学生用户ID',
    subject_code    VARCHAR(10) NOT NULL COMMENT '测评学科',
    grade_level     TINYINT NOT NULL COMMENT '测评时年级',
    
    -- 测评配置
    assessment_type VARCHAR(30) NOT NULL COMMENT '测评类型: ENROLL/UPGRADE/MONTHLY/WEAK_DEEP/EXAM_PREP/TEACHER_CLASS',
    target_kp_ids   JSON COMMENT '目标知识点范围(可空=全学科)',
    max_items       INT NOT NULL DEFAULT 20 COMMENT '最大题数',
    min_items       INT NOT NULL DEFAULT 8 COMMENT '最小题数',
    target_se       DECIMAL(4,3) NOT NULL DEFAULT 0.350 COMMENT '目标标准误差',
    time_limit_min  INT COMMENT '时间限制(分钟), NULL=不限',
    
    -- 测评状态
    status          VARCHAR(20) NOT NULL DEFAULT 'INIT' COMMENT '状态: INIT/IN_PROGRESS/COMPLETED/EXPIRED/ABANDONED',
    current_theta   DECIMAL(6,3) COMMENT '当前能力估计值',
    current_se      DECIMAL(6,3) COMMENT '当前标准误差',
    items_administered INT NOT NULL DEFAULT 0 COMMENT '已答题目数',
    items_correct   INT NOT NULL DEFAULT 0 COMMENT '答对题目数',
    
    -- 先验信息
    prior_theta     DECIMAL(6,3) NOT NULL DEFAULT 0.000 COMMENT '先验能力值(来自历史画像)',
    prior_source    VARCHAR(20) NOT NULL DEFAULT 'DEFAULT' COMMENT '先验来源: DEFAULT/HISTORY/TEACHER/RECENT',
    prior_sd        DECIMAL(4,3) NOT NULL DEFAULT 1.000 COMMENT '先验标准差',
    
    -- 结果
    final_theta     DECIMAL(6,3) COMMENT '最终能力估计',
    final_se        DECIMAL(6,3) COMMENT '最终标准误差',
    ability_level   VARCHAR(20) COMMENT '能力等级: BELOW_BASIC/BASIC/PROFICIENT/ADVANCED/MASTER',
    ability_score   DECIMAL(5,2) COMMENT '百分制能力分数 [0, 100]',
    
    -- 元数据
    started_at      DATETIME COMMENT '开始答题时间',
    completed_at    DATETIME COMMENT '完成时间',
    expired_at      DATETIME COMMENT '过期时间(自动计算)',
    duration_sec    INT COMMENT '实际答题时长(秒)',
    device_type     VARCHAR(20) COMMENT '设备类型',
    app_version     VARCHAR(20) COMMENT 'APP版本',
    
    -- 诊断结论
    diagnosis_summary JSON COMMENT 'AI生成的诊断摘要',
    weak_kp_ids     JSON COMMENT '诊断薄弱知识点列表',
    strong_kp_ids   JSON COMMENT '诊断优势知识点列表',
    recommended_actions JSON COMMENT '推荐后续动作',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_uuid (session_uuid),
    KEY idx_user (user_id, subject_code),
    KEY idx_user_created (user_id, created_at),
    KEY idx_status (status),
    KEY idx_subject_type (subject_code, assessment_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CAT测评会话表';
```

### 3.3 测评答题记录表 `cat_response_record`

```sql
CREATE TABLE cat_response_record (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    session_id      BIGINT NOT NULL COMMENT '关联测评会话',
    user_id         BIGINT NOT NULL,
    sequence_num    INT NOT NULL COMMENT '答题顺序(1-based)',
    question_id     BIGINT NOT NULL,
    item_params     JSON NOT NULL COMMENT '快照题目IRT参数: {"a":1.2,"b":0.5,"c":0.1}',
    
    -- 作答数据
    student_answer  JSON COMMENT '学生答案',
    is_correct      TINYINT NOT NULL COMMENT '是否正确',
    partial_score   DECIMAL(4,2) COMMENT '部分得分(主观题)',
    response_time_ms INT NOT NULL COMMENT '答题耗时(毫秒)',
    
    -- 选题时的状态快照
    theta_before    DECIMAL(6,3) NOT NULL COMMENT '选题时的能力估计',
    se_before       DECIMAL(6,3) NOT NULL COMMENT '选题时的标准误差',
    theta_after     DECIMAL(6,3) NOT NULL COMMENT '答题后的能力估计',
    se_after        DECIMAL(6,3) NOT NULL COMMENT '答题后的标准误差',
    info_value      DECIMAL(8,4) NOT NULL COMMENT '该题Fisher信息量',
    
    -- 选题原因
    selection_reason VARCHAR(100) COMMENT '选题原因: MAX_INFO/CONTENT_BALANCE/EXPOSURE_CONTROL/COVERAGE',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    KEY idx_session (session_id, sequence_num),
    KEY idx_user (user_id),
    KEY idx_question (question_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CAT测评答题记录表';
```

### 3.4 题目曝光控制表 `cat_exposure_log`

```sql
CREATE TABLE cat_exposure_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    question_id     BIGINT NOT NULL,
    subject_code    VARCHAR(10) NOT NULL,
    exposure_date   DATE NOT NULL,
    daily_count     INT NOT NULL DEFAULT 0 COMMENT '当日曝光次数',
    weekly_count    INT NOT NULL DEFAULT 0 COMMENT '当周累计曝光',
    
    UNIQUE KEY uk_question_date (question_id, exposure_date),
    KEY idx_subject_date (subject_code, exposure_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CAT题目曝光日志(按天聚合)';
```

### 3.5 内容维度配置表 `cat_content_dimension`

用于确保测评内容覆盖多个维度。

```sql
CREATE TABLE cat_content_dimension (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    subject_code    VARCHAR(10) NOT NULL,
    grade_level     TINYINT NOT NULL,
    dimension_type  VARCHAR(30) NOT NULL COMMENT '维度类型: KP/BLOOM/SKILL/QUESTION_TYPE',
    dimension_key   VARCHAR(50) NOT NULL COMMENT '维度键: 如 kp_id=101, bloom=apply',
    dimension_label VARCHAR(100) NOT NULL COMMENT '维度标签: 如"一元二次方程"',
    target_weight   DECIMAL(4,3) NOT NULL DEFAULT 0.100 COMMENT '目标覆盖权重',
    min_items       INT NOT NULL DEFAULT 1 COMMENT '该维度最少题数',
    max_items       INT NOT NULL DEFAULT 5 COMMENT '该维度最多题数',
    is_active       TINYINT NOT NULL DEFAULT 1,
    
    KEY idx_subject_grade (subject_code, grade_level),
    KEY idx_dimension (subject_code, dimension_type, dimension_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CAT内容维度配置表';
```

### 3.6 DDL 增补（v1.1）

v1.0 五张核心表基础上增补以下结构，支撑参数版本化、并发裁决与 Outbox 事件（详见 §8/§9）：

```sql
-- 题目参数版本化：校准发布滚动更新，进行中会话沿用作答时快照参数，防回放漂移
ALTER TABLE cat_item_bank
    ADD COLUMN param_version INT NOT NULL DEFAULT 1 COMMENT 'IRT参数版本号',
    ADD KEY idx_subject_version (subject_code, param_version);

-- 会话乐观锁：多端同时作答裁决（CAS）；结果置信度标记
ALTER TABLE cat_assessment_session
    ADD COLUMN version INT NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
    ADD COLUMN result_confidence VARCHAR(10) NULL
        COMMENT '结果置信度: HIGH/MEDIUM/LOW/DEGRADED';

-- 答题记录防重（幂等第二层，第一层为 Redis 抢占）
ALTER TABLE cat_response_record
    ADD UNIQUE KEY uk_session_seq (session_id, sequence_num);

-- CAT 事件 Outbox（同事务写、异步投递 cat.domain.events Topic）
CREATE TABLE cat_outbox (
    id            BIGINT PRIMARY KEY AUTO_INCREMENT,
    event_id      CHAR(36) NOT NULL COMMENT '全局唯一事件ID',
    event_type    VARCHAR(60) NOT NULL COMMENT 'cat.assessment.started/completed/expired/abandoned',
    aggregate_id  CHAR(36) NOT NULL COMMENT 'session_uuid',
    payload       JSON NOT NULL,
    status        TINYINT NOT NULL DEFAULT 0 COMMENT '0=待发送 1=已发送 2=死信',
    retry_count   INT NOT NULL DEFAULT 0,
    next_retry_at DATETIME NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at  DATETIME NULL,
    UNIQUE KEY uk_event (event_id),
    KEY idx_status_retry (status, next_retry_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CAT事件Outbox表';
```

---

## 4. 核心算法设计

### 4.1 CAT 测评主流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    CAT 测评引擎主流程                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. 初始化                                                       │
│     ├─ 获取先验能力 θ₀ (历史画像/默认值)                          │
│     ├─ 加载目标题库池 (学科+年级+活跃题目)                        │
│     ├─ 初始化内容覆盖计数器                                       │
│     └─ 初始化已用题目集合                                         │
│                                                                  │
│  2. 选题循环 (while not should_stop)                              │
│     ├─ 计算候选题集 (排除已用 + 曝光过滤)                         │
│     ├─ 计算每题 Fisher 信息量 I(θ̂)                               │
│     ├─ 内容平衡约束调整                                           │
│     ├─ 曝光率控制过滤                                             │
│     ├─ 选择最优题目 → 推送前端                                    │
│     ├─ 等待学生作答                                               │
│     ├─ 判题 → 更新答题记录                                        │
│     ├─ 更新能力估计 θ̂ (EAP)                                      │
│     ├─ 更新标准误差 SE                                            │
│     ├─ 更新内容覆盖计数器                                         │
│     └─ 检查终止条件                                               │
│                                                                  │
│  3. 结果生成                                                     │
│     ├─ 最终能力估计 θ̂_final                                      │
│     ├─ 能力等级映射                                               │
│     ├─ 知识点掌握度推算                                           │
│     ├─ 诊断摘要生成                                               │
│     └─ 推荐动作生成                                               │
│                                                                  │
│  4. 后处理                                                       │
│     ├─ 更新学生能力画像                                           │
│     ├─ 更新知识追踪模型                                           │
│     ├─ 更新题库曝光统计                                           │
│     └─ 生成测评报告                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 选题算法（核心）

选题是多目标优化问题，需同时考虑：信息量最大化、内容覆盖均衡、曝光率控制、题型多样性。

```python
import numpy as np
from typing import List, Dict, Set, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum


class SelectionReason(str, Enum):
    MAX_INFO = "MAX_INFO"
    CONTENT_BALANCE = "CONTENT_BALANCE"
    EXPOSURE_CONTROL = "EXPOSURE_CONTROL"
    COVERAGE = "COVERAGE"


@dataclass
class CatItem:
    """CAT 题目"""
    question_id: int
    subject_code: str
    a: float          # 区分度
    b: float          # 难度
    c: float          # 猜测系数
    kp_ids: List[int]
    dimension_tags: Dict[str, str]  # {"bloom": "apply", "skill": "calc", ...}
    exposure_rate: float
    pool_tier: int    # 1=核心, 2=扩展, 3=备用


@dataclass
class CatState:
    """CAT 测评运行时状态"""
    theta: float                    # 当前能力估计
    se: float                       # 当前标准误差
    items_administered: int         # 已答题数
    items_correct: int             # 答对数
    administered_qids: Set[int]    # 已用题目ID
    content_coverage: Dict[str, Dict[str, int]]  # 维度覆盖计数
    response_history: List[Tuple[int, bool]]     # (question_id, is_correct)
    item_history: List[CatItem]                   # 已答题目列表


def select_next_item(
    state: CatState,
    candidate_pool: List[CatItem],
    config: 'CatConfig',
    content_dims: List['ContentDimension']
) -> Tuple[CatItem, SelectionReason]:
    """
    核心选题算法
    
    步骤:
    1. 过滤候选池 (已用题 + 曝光限制 + 时间限制)
    2. 计算每题 Fisher 信息量
    3. 内容平衡加权
    4. 多目标排序选最优
    
    Returns:
        (选中的题目, 选题原因)
    """
    
    # ── Step 1: 过滤候选池 ──
    available = [
        item for item in candidate_pool
        if item.question_id not in state.administered_qids
        and item.exposure_rate < config.max_exposure_rate
    ]
    
    if not available:
        raise RuntimeError("候选题库耗尽，无法继续选题")
    
    # ── Step 2: 计算信息量 + 综合评分 ──
    scored_items = []
    for item in available:
        # Fisher 信息量
        info = fisher_information(state.theta, item.a, item.b, item.c)
        
        # 内容平衡加权（维度缺口放大 / 超额衰减 / 硬上限排除）
        balance_weight, dim_capped = compute_content_balance_weight(
            item, state, content_dims)
        if dim_capped:
            continue  # 所属维度已达题数上限，直接排除
        
        # 曝光软惩罚（超出软上限后 sigmoid 衰减，二级防线）
        exposure_penalty = compute_exposure_penalty(item, config)
        
        # 题型多样性惩罚（连续 3 题同题型 → ×0.3）
        type_penalty = compute_type_diversity_penalty(item, state)
        
        # 综合评分 = Fisher 信息量 × 内容权重 × 曝光因子 × 题型因子
        score = info * balance_weight * exposure_penalty * type_penalty
        scored.append(_Scored(
            item=item, score=score, info=info,
            balance_weight=balance_weight,
            exposure_penalty=exposure_penalty))
    
    # ── 降级：曝光硬过滤后候选耗尽 → 放宽上限 20% 重评一次 ──
    if not scored:
        scored = _rescore_with_relaxed_exposure(
            state, candidate_pool, config, content_dims)
    if not scored:
        raise CatPoolExhaustedError(
            code=54609,
            message=f"候选题库耗尽 subject={state.subject_code} "
                    f"administered={state.items_administered} "
                    f"pool_size={len(candidate_pool)}")
    
    # ── Step 3: Randomesque 随机层（Top-K 内随机，破坏固定出题序）──
    scored.sort(key=lambda s: s.score, reverse=True)
    top_k = scored[:config.randomesque_k]
    chosen = random.choice(top_k)
    
    # ── Step 4: 选题原因标注（写入 cat_response_record.selection_reason）──
    best = scored[0]
    if chosen.item.question_id == best.item.question_id:
        reason = SelectionReason.MAX_INFO
    elif chosen.balance_weight > 1.0:
        reason = SelectionReason.CONTENT_BALANCE
    elif chosen.exposure_penalty < 0.6:
        reason = SelectionReason.EXPOSURE_CONTROL
    else:
        reason = SelectionReason.COVERAGE
    
    return chosen.item, reason


@dataclass
class _Scored:
    """评分中间对象"""
    item: 'CatItem'
    score: float
    info: float
    balance_weight: float
    exposure_penalty: float


def fisher_information(theta: float, a: float, b: float, c: float) -> float:
    """
    3PL Fisher 信息量（数值稳定实现）
    I(θ) = [P'(θ)]²/[P·Q] = a²·Q·(P-c)²/[(1-c)²·P]
    """
    z = min(max(a * (theta - b), -35.0), 35.0)   # 防 exp 溢出
    L = 1.0 / (1.0 + math.exp(-z))
    p = c + (1.0 - c) * L
    p = min(max(p, 1e-10), 1.0 - 1e-10)          # 防 0 除
    if 1.0 - c < 1e-6:                           # c≈1 无鉴别力
        return 0.0
    q = 1.0 - p
    return a * a * q * (p - c) ** 2 / ((1.0 - c) ** 2 * p)


def compute_content_balance_weight(item, state, content_dims):
    """
    内容平衡权重：
    target_n = target_weight × max(items_administered + 1, 1)
    - 实际覆盖 < target_n      → ×2.0（缺口放大，引导补齐）
    - 实际覆盖 > target_n + 1  → ×0.5（超额衰减，抑制扎堆）
    - 实际覆盖 ≥ max_items     → 返回 (1.0, True) 硬排除
    未命中任何配置维度的题目权重恒为 1.0（中性）。
    """
    weight = 1.0
    n = max(state.items_administered + 1, 1)
    for dim in content_dims:
        if not dim.matches(item):
            continue
        actual = state.content_coverage.get(
            dim.dimension_type, {}).get(dim.dimension_key, 0)
        if actual >= dim.max_items:
            return 1.0, True
        target_n = dim.target_weight * n
        if actual < target_n:
            weight *= 2.0
        elif actual > target_n + 1:
            weight *= 0.5
    return weight, False


def compute_exposure_penalty(item, config, k: float = 6.0) -> float:
    """简化 Sympson-Hetter：soft_cap = 0.8 × max_exposure_rate，sigmoid 衰减"""
    soft_cap = config.max_exposure_rate * 0.8
    return 1.0 / (1.0 + math.exp(k * (item.exposure_rate - soft_cap)))


def compute_type_diversity_penalty(item, state, streak: int = 3) -> float:
    """连续 streak 题同题型时，该题型权重 ×0.3"""
    if len(state.item_history) >= streak:
        recent = {it.dimension_tags.get("question_type")
                  for it in state.item_history[-streak:]}
        if (len(recent) == 1
                and item.dimension_tags.get("question_type") in recent):
            return 0.3
    return 1.0


def _rescore_with_relaxed_exposure(state, candidate_pool, config, content_dims):
    """
    降级重评：曝光上限放宽至 max_exposure_rate × 1.2，仅用信息量 × 内容权重
    （降级路径允许评分近似，可解释性记录 EXPOSURE_CONTROL）
    """
    scored = []
    for item in candidate_pool:
        if (item.question_id in state.administered_qids
                or item.exposure_rate > config.max_exposure_rate * 1.2):
            continue
        balance_weight, capped = compute_content_balance_weight(
            item, state, content_dims)
        if capped:
            continue
        info = fisher_information(state.theta, item.a, item.b, item.c)
        scored.append(_Scored(item=item, score=info * balance_weight,
                              info=info, balance_weight=balance_weight,
                              exposure_penalty=1.0))
    return scored
```

#### 4.2.1 选题复杂度与延迟预算

| 环节 | 复杂度 | 预算（候选池 N=800） |
| --- | --- | --- |
| 候选过滤（已用/曝光/维度上限） | O(N) | ≤ 20ms |
| 信息量 + 四因子评分 | O(N) | ≤ 60ms |
| 排序 + Top-K 随机 | O(N log N) | ≤ 20ms |
| **合计（P99 目标 ≤ 200ms）** | — | **≤ 120ms（含 80ms 余量）** |

选题热路径全程只读缓存（题池加载见 §9.1），不触达数据库。

### 4.3 能力更新与终止判定

每题判题（复用《服务端-多题型统一判题引擎》同步模式）成功后，执行以下管线：

```
客户端 POST /answers
   │
   ├─→ 判题（gRPC 同步，isCorrect + partialScore）
   ├─→ 写 cat_response_record（θ/SE 前后快照 + info_value + selection_reason）
   ├─→ EAP 重估 θ/SE（§2.3；含先验回退，见下）
   ├─→ CAS 更新会话 current_theta/current_se/version
   ├─→ should_stop() ?
   │      ├─ 否 → select_next_item() → 响应下一题
   │      └─ 是 → finalize_assessment()（§4.4）→ 响应 COMPLETED
```

```python
def should_stop(state, config, now_ms: int) -> tuple[bool, str]:
    """
    终止条件（满足任一即停，返回原因码）：
    R1 精度达标: items >= min_items 且 se <= target_se
    R2 题数上限: items >= max_items
    R3 时间耗尽: 超过 time_limit_min（配置了才生效）
    R4 极端收敛: 连续 5 题全对/全错，θ 已贴边且 SE 无改善空间
    R5 题池耗尽: 由 CatPoolExhaustedError 异常路径触发提前 finalize
    """
    if (state.items_administered >= config.min_items
            and state.se <= config.target_se):
        return True, "SE_REACHED"
    if state.items_administered >= config.max_items:
        return True, "MAX_ITEMS"
    if config.time_limit_min and state.elapsed_sec(now_ms) > config.time_limit_min * 60:
        return True, "TIME_UP"
    last5 = state.response_history[-5:]
    if (state.items_administered >= config.min_items
            and len(last5) == 5
            and (all(ok for _, ok in last5) or not any(ok for _, ok in last5))
            and state.se > config.target_se * 1.5):
        return True, "EXTREME_PATTERN"
    return False, ""
```

**EAP 数值防护**（对应降级 D7）：

1. 全对/全错极端模式 → 后验质量堆积在积分边界，θ 截断至 `[-3, +3]`，SE 固定 0.5，`result_confidence=LOW`；
2. 似然下溢（`total < 1e-30`）→ 回退先验 `(prior_theta, prior_sd)`，标记 `LOW_CONFIDENCE` 并计入监控 `cat.eap.divergence.count`。

**主观题 partial_score 参与规则**：`[0.75, 1]` → correct；`[0, 0.25)` → incorrect；`(0.25, 0.75)` → 不纳入似然计算（信息量低且引入噪声），仅存档。

### 4.4 结果生成（finalize_assessment）

#### 4.4.1 能力等级映射

θ 已按「学科 × 年级」常模标准化（0 = 同龄均值），默认切分支持运营配置覆盖（`cat.ability-level-cuts`）：

| ability_level | θ 区间 | 语义 |
| --- | --- | --- |
| BELOW_BASIC | θ ≤ -1.5 | 显著落后于同龄常模 |
| BASIC | -1.5 < θ ≤ -0.5 | 基础水平 |
| PROFICIENT | -0.5 < θ ≤ 0.5 | 达标（常模中位附近） |
| ADVANCED | 0.5 < θ ≤ 1.5 | 优于常模 |
| MASTER | θ > 1.5 | 显著拔尖 |

百分制能力分数：`ability_score = round(100 / (1 + exp(-θ_final)), 1)`（θ=0 → 50 分，θ=±3 → 95.3/4.7 分）。

#### 4.4.2 知识点掌握度推算

对目标范围内每个知识点 KP，按 `cat_item_bank` 中该 KP 关联**活跃**题目参数取均值得到 `(a_kp, b_kp)`，由 θ 推断先验掌握度：`P(kp|θ) = c̄ + (1-c̄)·sigmoid(a_kp·(θ - b_kp))`（c̄ 取均值猜测系数）。再与实测融合：

| 情形 | 公式 | confidence |
| --- | --- | --- |
| 该 KP 已作答 ≥ 2 题 | `0.7 × 实答正确率 + 0.3 × P(kp|θ)` | HIGH |
| 该 KP 已作答 1 题 | `0.5 × 实答正确率 + 0.5 × P(kp|θ)` | MEDIUM |
| 该 KP 未作答 | `P(kp|θ)`（纯推断） | LOW |

- **strong_kp**：`mastery ≥ 0.75`；
- **weak_kp**：`mastery < 0.45 且 confidence ∈ {HIGH, MEDIUM}`，或已作答 KP 实答正确率 `< 0.4`；
- weak_kp 列表按 `mastery × confidence 权重` 升序输出，默认最多 8 个。

`result_confidence` 判定：题数 ≥ 12 且 SE ≤ 0.35 → HIGH；题数 ≥ min_items → MEDIUM；触发 R4/R5 或 D7 → LOW；触发 D10 固定顺序降级 → DEGRADED。

#### 4.4.3 诊断摘要与推荐动作

- **AI 生成**：经 AI 编排层调用 LLM，输入为脱敏结构化摘要（学段/学科/等级/强弱 KP 标签/作答统计，**不含**姓名、手机号等 PII），输出 ≤ 200 字诊断 + ≤ 3 条推荐动作，超时 3s；输出必须过《教育场景敏感词多层次过滤》`scene=ASSESSMENT` 校验；
- **降级（D3）**：LLM 失败/超时 → 按 `ability_level × top3_weak_kp` 套用模板文案库，报告即时返回，异步补生成（成功后覆盖 `diagnosis_summary` 并刷新缓存）；
- **推荐动作白名单**（枚举，防 LLM 幻觉产物）：`START_TARGETED_PRACTICE`（发起靶向训练，联动《学生薄弱点识别与靶向训练推荐服务》）、`ADD_TO_REVIEW_PLAN`（加入错题复习计划）、`GENERATE_STUDY_PLAN`（生成学习计划）、`REVIEW_CHAPTER`（回看章节内容）、`RECOMMEND_TUTORIAL`（推荐微课）。非白名单输出直接丢弃。

### 4.5 后处理扇出

finalize 与 Outbox 同事务提交（§8），曝光计数走内存 + 定时回写，不入 Outbox：

| 事件 | 消费方 | 消费动作 |
| --- | --- | --- |
| cat.assessment.completed | 知识追踪模型引擎（KTE） | 按 kpMasteries upsert `kte_knowledge_mastery`（source=CAT） |
| cat.assessment.completed | 学习画像服务 | 更新学科能力维度分数，触发画像快照 |
| cat.assessment.completed | 学情分析 | 失效薄弱点缓存，标记待刷新 |
| cat.assessment.completed | 冷启动引擎 | ENROLL 类型 → 结束冷启动阶段，落初始画像 |
| （本地聚合）cat.item.exposure | 曝光统计 Job（分钟级） | 回写 cat_item_bank.exposure_count/rate 与 cat_exposure_log |

---

## 5. API 接口设计

### 5.1 学生端 REST（`/api/v1/cat/assessments`）

#### POST `/api/v1/cat/assessments` 创建测评会话

```json
// 请求
{
  "subjectCode": "MATH",
  "assessmentType": "ENROLL",
  "gradeLevel": 7,
  "targetKpIds": [101, 205, 308],     // 可空 = 全学科范围（WEAK_DEEP 必填）
  "clientRequestId": "c1e8f0a2-..."    // 幂等键，同键重复请求返回同一会话
}
// 响应 201
{
  "sessionId": "3f2a9c7e-...",         // session_uuid
  "firstItem": {
    "sequenceNum": 1,
    "questionId": 90123,
    "question": { /* 题干/选项/图片，答案与解析字段由题目服务投影剔除 */ },
    "selectionReason": "MAX_INFO",
    "timeLimitSec": 180                // 单题建议时长（软限制）
  },
  "session": { "maxItems": 20, "minItems": 8, "timeLimitMin": null }
}
```

前置校验：题池就绪（活跃题量 ≥ 3 × max_items，否则 54601）；同学科同类型进行中会话唯一（否则 54602 返回既有 sessionId）。创建即选题（INIT → IN_PROGRESS，G1）。

#### GET `/{sessionId}/current` 断线重连取当前题

返回与 `firstItem` 同构的当前题 + `serverQuestionStartedTs`（服务端出题时间戳，客户端恢复计时）。仅 IN_PROGRESS 状态可用。

#### POST `/{sessionId}/answers` 提交答案（核心）

```json
// 请求
{
  "sequenceNum": 1,
  "questionId": 90123,
  "answer": { "type": "option", "value": "B" },
  "costMs": 45230
}
// 响应
{
  "judged": true,
  "isCorrect": true,
  "feedback": { "kpIds": [101], "brief": "涉及一元二次方程判别式" },
  "next": {
    "item": { "sequenceNum": 2, "questionId": 90456, "question": { },
              "selectionReason": "CONTENT_BALANCE", "timeLimitSec": 180 },
    "sessionStatus": "IN_PROGRESS"     // 或 COMPLETED 且 item=null
  },
  "progress": { "itemsAdministered": 2, "estimatedProgressPct": 18 }
}
```

**安全红线**：测评进行中**不向前端返回 θ、SE、题目 IRT 参数**（防逆向构造作答序列刷分），仅返回进度百分比估值（按 `max(items/max_items, (target_se 初始SE − SE)/(初始SE − target_se))` 取大者）。

- 即时正误反馈按学段分级开关：幼儿/小学低年级关闭 isCorrect（防挫败），高中默认开启；
- 幂等：`(sessionId, sequenceNum)` 重复提交返回首答结果（54610 语义，HTTP 200 + `duplicate: true`）；
- 单题硬超时（`timeLimitSec × 3`）→ 54607，该题按未作答计 0 分并推进。

#### POST `/{sessionId}/abandon` 主动放弃

仅 IN_PROGRESS 可调用；已答 ≥ min_items 时仍执行 finalize（结果标记 LOW confidence）供画像参考。

#### GET `/{sessionId}/result` 查询结果（仅 COMPLETED，否则 54611）

```json
{
  "abilityLevel": "PROFICIENT",
  "abilityScore": 62.5,
  "resultConfidence": "HIGH",
  "itemStats": { "administered": 14, "correct": 9, "durationSec": 780 },
  "weakKps": [
    { "kpId": 205, "label": "一元二次方程", "mastery": 0.38, "confidence": "HIGH" }
  ],
  "strongKps": [ { "kpId": 101, "label": "有理数运算", "mastery": 0.86, "confidence": "HIGH" } ],
  "diagnosisSummary": "...",
  "recommendedActions": [
    { "action": "START_TARGETED_PRACTICE", "params": { "kpId": 205 } }
  ]
}
```

#### GET `/history?subjectCode=&page=&size=` 历史测评列表

返回用户本人该学科历史 COMPLETED/ABANDONED 会话摘要（等级/分数/时间），支持趋势对比。

### 5.2 内部 gRPC（`cat.v1.CatEngineService`）

```protobuf
service CatEngineService {
  // 冷启动引擎 Layer3 / 教师班级纸质测评批量回传作答，复用同一 EAP+finalize 管线
  rpc ReportExternalResponses(ExternalResponsesRequest) returns (ReportResult);
  // 查询某学生某学科最近一次 COMPLETED 结果（内部可见 θ/SE）
  rpc GetAbilitySnapshot(AbilitySnapshotRequest) returns (AbilitySnapshot);
}

message ExternalResponsesRequest {
  string user_id = 1;
  string subject_code = 2;
  string assessment_type = 3;      // ENROLL / TEACHER_CLASS
  string client_request_id = 4;    // 幂等键
  repeated ExternalItemResponse responses = 5;  // [{questionId, isCorrect, partialScore, costMs}]
}
message ReportResult {
  string session_id = 1;
  double final_theta = 2;
  double final_se = 3;
  string ability_level = 4;
  repeated KpMastery kp_masteries = 5;
}
message AbilitySnapshotRequest { string user_id = 1; string subject_code = 2; }
message AbilitySnapshot {
  string session_id = 1;
  double final_theta = 2; double final_se = 3;
  string ability_level = 4; double ability_score = 5;
  int64 completed_at = 6; bool found = 7;
}
```

调用方鉴权：内网 mTLS + 服务账号（越权返回 54615）。

### 5.3 管理端 API（`/api/v1/admin/cat/…`，权限：题库运营/教研管理员）

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/calibrations` | POST | 触发题库 IRT 校准任务（离线 Spark MMLE），body: `{subjectCode, gradeLevel, minSampleSize:500}` |
| `/calibrations/{id}` | GET | 校准任务状态与结果摘要（拟合异常清单） |
| `/item-bank` | GET | 参数/曝光率/拟合度分页查询 |
| `/item-bank/{questionId}/status` | PUT | 启用/停用（软下架，进行中会话不受影响） |
| `/exposure/report` | GET | 日/周曝光率报告（TOP 曝光题与超限预警） |

**校准流程**：消费判题域 Outbox 作答明细 + cat_response_record → 单题样本量 ≥ 500 才参与 MMLE 估计 → `infit MNSQ ∉ [0.7, 1.3]` 标记 fit 异常 → 人工审核 → 发布（`param_version+1`，旧参数保留供回放对照）。校准期间线上继续使用当前版本参数，发布即生效于**新会话**，进行中会话沿用 `item_params` 快照（D 场景见验收 15）。

---

## 6. 状态机设计

### 6.1 会话状态机

```
         start(G1)
INIT ────────────────→ IN_PROGRESS ── meet_stop_rule(G3) ──→ COMPLETED
                          │      │
                          │      ├── 24h 无活动(G4) ──→ EXPIRED
                          │      └── 用户放弃(G5) ────→ ABANDONED
                          └─（创建即出第一题，INIT 为瞬时态）
```

| 守卫 | 当前状态 | 事件 | 目标状态 | 附加条件 / 动作 |
| --- | --- | --- | --- | --- |
| G1 | INIT | START | IN_PROGRESS | 写 started_at；version=1；出第一题 |
| G2 | IN_PROGRESS | ANSWER | IN_PROGRESS | sequence_num 严格 +1；CAS version+1；写答题记录 |
| G3 | IN_PROGRESS | MEET_STOP_RULE | COMPLETED | finalize：θ/SE/等级/掌握度/摘要 + Outbox cat.assessment.completed |
| G4 | IN_PROGRESS | TIMEOUT(24h Job 扫描) | EXPIRED | 已答 ≥ min_items → 补 finalize（LOW）；否则仅归档 + cat.assessment.expired |
| G5 | IN_PROGRESS | ABANDON | ABANDONED | 已答 ≥ min_items → 补 finalize（LOW）；发 cat.assessment.abandoned |
| G6 | COMPLETED/EXPIRED/ABANDONED | 任意 | — | 终态不可变；新测评开新会话，历史结果可被覆盖性引用 |

### 6.2 校准任务状态机（管理端）

`PENDING → RUNNING → REVIEW → PUBLISHED`；异常分支：`RUNNING → FAILED`（数据/算力故障）、`PENDING/REVIEW → CANCELLED`（人工取消）。REVIEW 态需人工确认拟合异常清单后方可 PUBLISHED。

---

## 7. 错误处理

### 7.1 错误码表（段位 54600-54699）

| 错误码 | HTTP | 场景 | 说明 | 客户端处理 |
| --- | --- | --- | --- | --- |
| 54600 | 500 | 通用 | CAT 引擎内部错误 | 重试一次，仍失败则提示 |
| 54601 | 503 | 创建会话 | 题池未就绪（活跃题 < 3×max_items） | 提示稍后再试 |
| 54602 | 409 | 创建会话 | 同学科同类型进行中会话已存在 | 拉起既有 sessionId 续答 |
| 54603 | 400 | 创建会话 | assessmentType 非法 / 年级越界 / WEAK_DEEP 未传 targetKpIds | 表单提示 |
| 54604 | 404 | 答题/查询 | 会话不存在或非本人 | 返回测评列表页 |
| 54605 | 409 | 答题 | 会话状态非 IN_PROGRESS | 调 GET /current 对齐 |
| 54606 | 409 | 答题 | sequenceNum 不匹配（多端并发或乱序） | 调 GET /current 单端续答 |
| 54607 | 408 | 答题 | 单题硬超时（timeLimitSec×3） | 该题计 0 分，自动推进 |
| 54608 | 422 | 答题 | 判题下游失败（重试 3 次后） | 该题作废重选，不计入题数 |
| 54609 | 500 | 选题 | 候选题池耗尽（CatPoolExhaustedError） | 提前 finalize，提示结果精度受限 |
| 54610 | 200 | 答题 | 重复提交同题（幂等命中，非错误） | 展示首答结果 |
| 54611 | 403 | 查询结果 | 会话未 COMPLETED | 引导继续答题或查看历史 |
| 54612 | 429 | 创建会话 | 单用户进行中会话 > 3 学科 | 排队/完成后再开 |
| 54613 | 503 | 管理端校准 | 校准服务不可用 | 管理端重试 |
| 54614 | 422 | 管理端校准 | 样本量不足（< minSampleSize） | 提示补充数据 |
| 54615 | 403 | gRPC | 非授权内部调用方 | — |

### 7.2 降级矩阵

| 编号 | 故障 | 影响 | 降级策略 | 恢复方式 |
| --- | --- | --- | --- | --- |
| D1 | 题池 Redis 不可用 | 选题失败 | 本地 Caffeine 兜底副本（启动预热 + 10min 刷新） | Redis 恢复后回源 |
| D2 | 判题引擎超时 > 3s | 无法推进 | 该题作废不计入，重选题；连续 3 次 → 按 R5 提前 finalize | 判题引擎恢复 |
| D3 | LLM 摘要失败/超时 | 报告缺 AI 摘要 | ability_level × top3_weak_kp 模板文案即时返回，异步补生成 | 补生成成功后覆盖 |
| D4 | KTE/画像事件消费失败 | 掌握度不同步 | Outbox 指数退避重试（上限 24h，超限转死信 + 告警） | 自动 / 人工重放 |
| D5 | 曝光统计回写延迟 | 曝光率偏低 | 容忍 ≤ 10% 误差窗口；超窗自动切换 pool_tier=2 题池轮换 | 统计追平后切回 |
| D6 | 常模配置缺失 | 等级映射失败 | 使用内置默认切分（§4.4.1），日志告警 | 配置中心修复 |
| D7 | EAP 数值下溢/发散 | θ 不可信 | 回退先验 θ₀，SE=1.0，result_confidence=LOW | — |
| D8 | 会话 CAS 冲突 | 双端同时作答 | 后提交方收 54606，强制单端续答 | — |
| D9 | 答题记录落库失败 | 记录延迟 | 内存态最多续答 3 题（Redis Stream 缓冲），后台对账 Job 补写；超限暂停等恢复 | 对账修复 |
| D10 | 单学科活跃题 < 3×max_items | 自适应精度不足 | 自动降级固定顺序测评（按难度中位数排序选题）+ result_confidence=DEGRADED | 题库扩容后自动恢复 |

---

## 8. 事件设计（Outbox）

Topic：`cat.domain.events`（信封复用全局规范：eventId / eventType / occurredAt / version / payload）。

| 事件 | 触发守卫 | payload 关键字段 | 消费方（幂等键） |
| --- | --- | --- | --- |
| cat.assessment.started | G1 | sessionId, userId, subjectCode, assessmentType, priorTheta, priorSource | 数据分析（eventId） |
| cat.assessment.completed | G3/G4/G5 补算 | theta, se, abilityLevel, abilityScore, resultConfidence, kpMasteries[], weakKpIds[], strongKpIds[], degraded | KTE（eventId）、画像（eventId）、学情（eventId）、冷启动（eventId+userId+ENROLL） |
| cat.assessment.expired | G4 | sessionId, itemsAdministered | 数据分析（eventId） |
| cat.assessment.abandoned | G5 | sessionId, itemsAdministered, itemsCorrect | 数据分析（eventId） |

**与 KTE 的写回契约**：`kpMasteries = [{"kpId":205, "mastery":0.38, "confidence":"MEDIUM", "source":"CAT"}]`，KTE 以 `(userId, kpId, source=CAT, sessionId)` 幂等 upsert `kte_knowledge_mastery`；冲突时保留 confidence 更高者，同级取时间新者（不盲覆盖 BKT 在线更新）。

**投递保证**：Outbox 投递线程 500ms 轮询 + 重试指数退避（1s/2s/4s…上限 24h），超限置 status=2 死信并触发 `cat.outbox.lag` 告警；消费方必须以 eventId 做幂等表（uk(eventId, consumer)）。

---

## 9. 性能、缓存与并发

### 9.1 选题热路径缓存（三级）

| 层 | 内容 | 策略 |
| --- | --- | --- |
| L1 本地 Caffeine | 学科×年级题池（CatItem：参数+维度标签+曝光率） | 启动预热 + 10min 定时刷新 + 管理端变更广播失效（版本号比对） |
| L2 Redis | 曝光率分钟聚合（`cat:exp:{subject}:{date}` Hash）、答题幂等抢占键、会话θ/SE 热副本 | 60s 滑动窗口；幂等键 TTL 30s |
| L3 MySQL | cat_item_bank / 维度配置 / 会话 / 记录 / Outbox | 仅 L1/L2 miss 与写入路径触达 |

答题记录写库异步化：先入 Redis Stream，Worker 100ms 批量刷 `cat_response_record`（D9 补偿）；**会话 θ/SE 走 CAS 同步更新**，保证终止判定一致性。

### 9.2 并发与幂等（三层）

1. **Redis 抢占**：`SETNX cat:answer:{sessionId}:{seq}` 30s，抢占失败直接查首答缓存返回（54610）；
2. **DB 唯一键**：`uk_session_seq(session_id, sequence_num)` 兜底；
3. **会话 CAS**：`UPDATE … SET version=version+1 … WHERE id=? AND version=?`，失败方收 54606（D8）。

曝光计数：选题命中即 `HINCRBY cat:exp:{subject}:{date} {questionId} 1`，分钟级 Job 聚合回写 `cat_exposure_log` 与 `cat_item_bank.exposure_rate`（分母取近 30 日同学科年级测评会话数×人均题数的滑动估计）。

### 9.3 容量估算

- 假设 DAU 50 万、月度复测参与率 40%、新用户 5 万/月：日均会话 ≈ 8,300 场；
- 晚高峰（20:00-21:00 集中 20%）：提交 ≈ 17 QPS，选题 ≈ 17 QPS（CPU 密集，单次 ≤ 5ms numpy 向量化）；
- 部署：2C4G × 4 实例（无状态）+ 1 个 Outbox/曝光 Worker + 1 个 24h 过期扫描 Job（分片）；
- Redis 内存：单学科×年级题池 ~800 条 × 2KB ≈ 1.6MB，按 LRU 按需加载全量 ~200MB，可接受。

---

## 10. 监控指标

| 指标 | 类型 | 告警阈值（级别） |
| --- | --- | --- |
| cat.item.select.latency P99 | 延迟 | > 200ms 持续 5min（P2） |
| cat.session.avg_items | 业务效率 | > 20（P3，选题策略退化排查） |
| cat.finalize.se_achieved_rate | 测量质量 | < 80%（P3） |
| cat.item.exposure.max_rate | 题目安全 | > 0.25（P2，联动 D5 轮换） |
| cat.pool.exhausted.count | 可用性 | > 0 次/h（P1，题库告急） |
| cat.judge.timeout.rate | 依赖 | > 2%（联动判题引擎告警） |
| cat.outbox.lag | 一致性 | > 60s（P2） |
| cat.eap.divergence.count | 算法稳定 | > 5 次/h（P3） |
| cat.llm.summary.degrade.rate | 依赖 | > 30%（P3） |
| cat.session.completion_rate | 业务漏斗 | 周环比 -15%（P3，体验回溯） |

---

## 11. 部署与配置

- **服务名**：`cat-engine`，无状态多实例（K8s Deployment，HPA 按 CPU 60%）；
- **依赖**：MySQL（会话/记录/题库/Outbox）、Redis（题池/曝光/幂等/Stream）、Kafka（cat.domain.events）、判题引擎 gRPC、LLM 网关、配置中心；
- **关键配置项**（配置中心热更）：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| cat.max-exposure-rate | 0.25 | 曝光硬上限 |
| cat.randomesque-k | 5 | Top-K 随机层宽度 |
| cat.target-se | 0.35 | 目标标准误差 |
| cat.min-items / cat.max-items | 8 / 20 | 题数上下限 |
| cat.item.hard-timeout-factor | 3 | 单题硬超时倍数 |
| cat.ability-level-cuts | -1.5/-0.5/0.5/1.5 | 等级切分（按学科×年级可覆盖） |
| cat.llm.timeout-ms | 3000 | AI 摘要超时 |
| cat.session.expire-hours | 24 | 无活动过期 |
| cat.calibration.min-sample | 500 | 校准最小样本量 |

---

## 12. 合规与安全要点

1. **不泄露测量参数**：客户端全程不可见 θ/SE/IRT 参数/`selectionReason` 之外的选择依据；答案与解析由题目服务投影剔除，联动《答案管控与渐进式提示引擎》测评模式；
2. **未成年人数据**：诊断结论属敏感学习数据，家长端可见性遵循《学生学习数据家庭共享可见度分级与隐私边界管控引擎》分级策略；测评结果**不得用于任何公开排名/ leaderboard**；
3. **题目安全**：曝光率控制即题目安全机制（§4.2），题库参数表仅管理端可见；Randomesque 层防止题序固定被刷题农场逆向；
4. **AI 摘要**：输入脱敏（无 PII），输出过敏感词过滤（scene=ASSESSMENT），AIGC 内容按《AIGC 内容标识与生成内容溯源水印系统》要求在报告页角标标识；
5. **数据保留**：`cat_response_record` 按《服务端-数据归档与生命周期管理策略》180 天后归档至冷存；测评结果报告长期保留（用户可删，联动账户注销流程）；
6. **防沉迷联动**：`duration_sec` 计入每日使用时长统计（上报统一埋点平台）。

---

## 13. 契约对齐表

| 关联方 | 契约点 | 对齐说明 |
| --- | --- | --- |
| 用户学习画像冷启动引擎（Layer3） | `assessmentType=ENROLL` + gRPC ReportExternalResponses | 在线路径统一委托本引擎；冷启动内嵌 EAP 仅作离线兜底，避免双实现漂移 |
| 统一判题引擎 | 同步判题 gRPC（isCorrect + partialScore） | 主观题 partial 三段规则见 §4.3 |
| 知识追踪模型引擎（KTE） | cat.assessment.completed → kte_knowledge_mastery | §8 写回契约；KTE 冲突裁决不盲覆盖 |
| 学习画像服务 | 能力维度分数更新 | ability_score 直写学科能力维度，触发画像快照 |
| 学情分析 | 薄弱点缓存失效 + 报告引用 | weak_kp_ids 供学情报告「诊断来源」标注 |
| 学科核心素养评估引擎（V2.5 规划） | 预留 GetAbilitySnapshot gRPC | 对方文档已列入集成路线图，本期仅预留接口 |
| 管理后台题库工作台 | item-bank CRUD / 校准任务 / 曝光报告 | §5.3；权限走管理后台统一 RBAC |
| 服务端-学生画像特征工程平台 | 事件消费特征源 | cat.assessment.completed 作为能力特征事件之一 |
| 防沉迷系统 | duration_sec 上报 | §12.6 |

---

## 14. 验收场景

1. 新用户注册后创建 ENROLL 测评 → 首题难度 |b − prior θ₀| ≤ 0.5（历史画像先验生效）；
2. 连续答对 4 题 → 第 5、6、7 题 b 参数单调递增；
3. 连续答错 4 题 → 后续题目 b 单调递减；
4. SE 提前达标 → 会话在题数 < max_items 时正常 COMPLETED（R1）；
5. 题数 < min_items 时调 GET /result → 54611；
6. 杀进程重连 → GET /current 恢复同题且计时基于 serverQuestionStartedTs；
7. 同一 (sessionId, seq) 重复提交 → 返回首答结果 + duplicate=true，会话不推进；
8. 双端并发提交不同题 → 后到方收 54606，会话数据无损坏（对账零差异）；
9. 24h 无活动 → EXPIRED；已答 ≥ min_items 时补出 LOW confidence 报告；
10. 主动 abandon → ABANDONED；已答 ≥ min_items 仍生成报告并标记；
11. 构造题池耗尽（max_items 调大）→ 54609 + 提前 finalize，result_confidence=LOW；
12. 统计 1000 场会话 → 任一题目曝光率 ≤ 0.25（曝光报告验证）；
13. LLM 网关注入 5s 延迟 → 报告 3s 内返回模板摘要，异步补生成成功后覆盖；
14. Outbox 投递中断后恢复 → KTE/画像幂等消费，无重复 upsert；
15. 校准发布新参数版本 → 进行中会话沿用旧快照参数作答完毕，新会话用新版本；
16. 配置某维度 max_items=2 → 该维度出题数 ≤ 2，selection_reason 含 CONTENT_BALANCE/COVERAGE 记录；
17. WEAK_DEEP 携带 targetKpIds → 候选池仅含目标 KP 关联题目（响应题目标注验证）；
18. 教师班级测评经 ReportExternalResponses 批量回传 30 名学生纸质作答 → 全部产出报告并写入 KTE（抽查 kte_knowledge_mastery source=CAT 记录）。