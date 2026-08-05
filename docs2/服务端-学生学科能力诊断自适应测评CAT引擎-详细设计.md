# 服务端 - 学生学科能力诊断自适应测评 CAT 引擎 - 详细设计

> **文档版本**：v1.0  
> **创建日期**：2026-08-06  
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
I(θ) = a² × P'(θ) × [P(θ) - c] / [(1 - c)² × P(θ) × (1 - P(θ))]
```

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

# 预定义积分节点和权重（41 节点，覆盖 [-4, 4]）
QUADRATURE_NODES = np.linspace(-4, 4, 41)
QUADRATURE_WEIGHTS = np.array([...])  # 对应权重


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
        
        # 内容平衡加