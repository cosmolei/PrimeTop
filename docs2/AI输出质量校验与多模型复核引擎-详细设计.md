# AI 输出质量校验与多模型复核引擎 - 详细设计

> 版本：v1.1 | 日期：2026-08-19 | 状态：已补全（v1.0 因生成截断于 §4.6 中断，本版补齐其后全部章节并修复四处 v1.0 缺陷）

## 1. 模块概述

### 1.1 背景

PrimeTop 作为面向全学段的教育产品，AI 生成的解题过程、知识讲解、作文评语等内容直接面向学生。AI 输出中的事实性错误（如数学计算错误、化学方程式配平错误、历史年代错误）会误导学习，严重损害产品信任度和教育价值。

原始设计文档（12.2.2）明确提出"优化理科复杂推理准确性，引入校验和多模型复核机制"，（12.2.3）提出"建立 AI 回答质量评分体系，对错误解析进行回流修正"。

| 现有文档 | 覆盖范围 | 本文档补充 |
|---------|---------|-----------|
| 用户反馈与AI质量评估 | 用户点赞/点踩、纠错标注、人工审核 | 自动化校验管线、多模型复核 |
| 多模型调度与成本治理 | 模型路由、成本计量、降级 | 以质量为目标的复核调度 |
| AI-Prompt编排与场景模板 | Prompt 组装、安全护栏 | 输出侧的校验与纠错 |
| 理科解题 | 条件提取、解题模型、分步推导 | 解题结果的自动化验证 |

### 1.2 设计目标

| 目标 | 量化指标 |
|------|---------|
| 事实性错误拦截率 | 数学/理科计算错误 ≥ 95% 拦截 |
| 高风险内容复核率 | 高中数学/物理/化学 100% 经过复核 |
| 校验延迟 | 同步校验 ≤ 100ms，不增加用户感知延迟 |
| 误拦率 | 正确内容被误判 < 2% |
| 成本占比 | 复核模型调用占总 AI 成本 < 15% |

### 1.3 设计原则

1. **分层校验**：快速同步校验 + 深度异步复核，平衡速度与质量
2. **学科定制**：不同学科采用不同校验策略
3. **渐进式严格度**：小学宽容度高，高中严格度高
4. **成本可控**：复核调用控制在合理范围
5. **闭环修正**：校验发现的问题回流到 Prompt 优化和知识库更新

---

## 2. 整体架构

### 2.1 校验管线全景

```
AI 模型输出
    │
    ▼
┌──────────────────────────────────────────────────────┐
│              Stage 1: 同步快速校验 (≤100ms)            │
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ 格式校验  │ │ 安全过滤  │ │ 数学快检  │ │ 事实快查 │ │
│  └──────────┘ └──────────┘ └──────────┘ └─────────┘ │
│        ↓            ↓           ↓           ↓        │
│     [校验结果合并 → 决策：通过 / 标记待复核 / 拦截]    │
└─────────────────────────┬────────────────────────────┘
                          │
             ┌────────────┼────────────┐
             ▼            ▼            ▼
        直接通过      标记+放行      立即拦截
        (低风险)     (中风险)      (高风险错误)
             │            │            │
             │            ▼            ▼
             │   ┌─────────────────┐  返回错误提示
             │   │ Stage 2: 异步   │  + 触发重试
             │   │ 深度复核        │
             │   │                 │
             │   │ • 多模型交叉验证│
             │   │ • 知识库比对    │
             │   │ • 符号计算引擎  │
             │   │ • 逻辑一致性    │
             │   └────────┬────────┘
             │            ▼
             │   ┌─────────────────┐
             │   │ 复核结果处理     │
             │   │ 通过 → 确认      │
             │   │ 疑似 → 推送纠错  │
             │   │ 错误 → 标记+回流 │
             │   └─────────────────┘
             ▼
       内容正常呈现给用户
```

### 2.2 学科校验策略矩阵

| 学科 | 同步校验 | 异步复核 | 触发条件 | 严格度 |
|------|---------|---------|---------|--------|
| 数学（计算题） | 格式+数学快检 | 符号计算+多模型验证 | 所有含计算的回答 | 高 |
| 数学（证明题） | 格式+逻辑结构 | 多模型交叉验证 | 高中证明题 | 高 |
| 物理 | 公式格式+单位检查 | 多模型验证+常数核对 | 含公式/计算 | 高 |
| 化学 | 方程式格式+配平 | 符号验证+多模型 | 含化学方程式 | 高 |
| 生物 | 事实快查 | 知识库比对 | 含专有名词/数据 | 中 |
| 语文/英语 | 安全过滤+适度性 | 无（低风险） | — | 低 |
| 历史/地理 | 事实快查（年代/地名） | 知识库比对 | 含具体日期/数据 | 中 |

### 2.3 分龄严格度策略

```python
class StrictnessLevel(str, Enum):
    TOLERANT = "tolerant"    # 幼儿/小学低年级：允许近似表述
    NORMAL = "normal"        # 小学高年级/初中：关键事实必须准确
    STRICT = "strict"        # 初中关键题/高中：全面校验
    RIGOROUS = "rigorous"    # 高考真题/考试模拟：等同于考试标准


def get_strictness(phase: str, grade: int, context: str) -> StrictnessLevel:
    """根据学段、年级和场景确定校验严格度"""
    if context == "exam_simulation":
        return StrictnessLevel.RIGOROUS
    if phase == "kindergarten":
        return StrictnessLevel.TOLERANT
    if phase == "primary":
        return StrictnessLevel.TOLERANT if grade <= 3 else StrictnessLevel.NORMAL
    if phase == "junior":
        return StrictnessLevel.NORMAL
    if phase == "senior":
        return StrictnessLevel.STRICT
    return StrictnessLevel.NORMAL
```

---

## 3. 数据结构设计

### 3.1 校验任务模型

```python
from enum import Enum
from typing import Optional
from pydantic import BaseModel
from datetime import datetime


class ValidationStage(str, Enum):
    SYNC_QUICK = "sync_quick"          # 同步快速校验
    ASYNC_DEEP = "async_deep"          # 异步深度复核
    MANUAL_REVIEW = "manual_review"    # 人工审核


class ValidationStatus(str, Enum):
    PENDING = "pending"
    PASSED = "passed"
    FAILED = "failed"
    SUSPICIOUS = "suspicious"
    ERROR = "error"                     # 校验系统自身异常


class RiskLevel(str, Enum):
    LOW = "low"           # 低风险：文科讲解、知识科普
    MEDIUM = "medium"     # 中风险：理科概念、公式展示
    HIGH = "high"         # 高风险：计算结果、方程式配平、考试答案


class ValidationTask(BaseModel):
    """校验任务"""
    id: str                              # UUID
    conversation_id: str                 # 对话ID
    message_id: str                      # AI回复消息ID
    user_id: int
    session_id: Optional[str] = None

    # 请求上下文
    subject: str                         # 学科
    phase: str                           # 学段
    grade: int                           # 年级
    scene: str                           # 场景: tutoring/photo_solve/practice/exam
    strictness: StrictnessLevel

    # AI 输出
    ai_output: str
    ai_model: str
    ai_prompt_hash: Optional[str] = None

    # 结构化提取
    extracted_claims: list[dict] = []    # 提取的事实声明
    extracted_formulas: list[dict] = []  # 提取的公式
    extracted_calculations: list[dict] = []  # 提取的计算过程
    final_answer: Optional[str] = None

    # 校验结果
    stage: ValidationStage = ValidationStage.SYNC_QUICK
    status: ValidationStatus = ValidationStatus.PENDING
    risk_level: RiskLevel = RiskLevel.LOW
    checks: list["CheckResult"] = []
    overall_score: Optional[float] = None  # 0-1

    # 复核信息
    review_model: Optional[str] = None
    review_output: Optional[str] = None
    review_score: Optional[float] = None

    # 时间
    created_at: datetime = datetime.now()
    sync_completed_at: Optional[datetime] = None
    async_completed_at: Optional[datetime] = None

    # 处置
    action_taken: Optional[str] = None  # pass/flag/retry/block/notify
    corrected_output: Optional[str] = None
```

### 3.2 单项校验结果

```python
class CheckType(str, Enum):
    FORMAT = "format"
    SAFETY = "safety"
    MATH_COMPUTE = "math_compute"
    MATH_FORMULA = "math_formula"
    CHEMICAL_EQUATION = "chem_equation"
    PHYSICS_UNIT = "physics_unit"
    FACT_CHECK = "fact_check"
    LOGIC_CONSISTENCY = "logic"
    COMPLETENESS = "completeness"
    AGE_APPROPRIATENESS = "age_approp"
    MULTI_MODEL_AGREE = "multi_model"


class CheckResult(BaseModel):
    """单项校验结果"""
    check_type: CheckType
    status: ValidationStatus
    confidence: float = 0.0              # 0-1
    details: Optional[str] = None
    issues: list[str] = []
    suggestions: list[str] = []
    latency_ms: int = 0
```

### 3.3 数据库表设计

#### 3.3.1 校验任务表 `validation_task`

```sql
CREATE TABLE validation_task (
    id              VARCHAR(36) PRIMARY KEY COMMENT 'UUID',
    conversation_id VARCHAR(36) NOT NULL,
    message_id      VARCHAR(36) NOT NULL,
    user_id         BIGINT NOT NULL,
    session_id      VARCHAR(64) NULL,

    subject         VARCHAR(16) NOT NULL COMMENT '学科',
    phase           VARCHAR(16) NOT NULL COMMENT '学段',
    grade           INT NOT NULL COMMENT '年级',
    scene           VARCHAR(32) NOT NULL COMMENT '场景',
    strictness      VARCHAR(16) NOT NULL COMMENT '严格度',
    risk_level      VARCHAR(8) NOT NULL DEFAULT 'low',

    ai_model        VARCHAR(32) NOT NULL,
    ai_prompt_hash  VARCHAR(64) NULL,
    final_answer    TEXT NULL COMMENT '提取的最终答案',

    stage           VARCHAR(16) NOT NULL DEFAULT 'sync_quick',
    status          VARCHAR(16) NOT NULL DEFAULT 'pending',
    overall_score   DECIMAL(5,4) NULL COMMENT '综合质量分0-1',

    review_model    VARCHAR(32) NULL,
    review_score    DECIMAL(5,4) NULL,
    action_taken    VARCHAR(16) NULL,

    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    sync_completed_at   DATETIME(3) NULL,
    async_completed_at  DATETIME(3) NULL,

    INDEX idx_message (message_id),
    INDEX idx_conversation (conversation_id),
    INDEX idx_user_created (user_id, created_at),
    INDEX idx_subject_status (subject, status),
    INDEX idx_risk_status (risk_level, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI输出校验任务';
```

#### 3.3.2 校验明细表 `validation_check_result`

```sql
CREATE TABLE validation_check_result (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_id         VARCHAR(36) NOT NULL,
    check_type      VARCHAR(32) NOT NULL,
    status          VARCHAR(16) NOT NULL,
    confidence      DECIMAL(5,4) NOT NULL DEFAULT 0,
    details         TEXT NULL,
    issues          JSON NULL,
    suggestions     JSON NULL,
    latency_ms      INT NOT NULL DEFAULT 0,
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX idx_task (task_id),
    INDEX idx_type_status (check_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='校验明细结果';
```

#### 3.3.3 错误回流表 `validation_error_feedback`

```sql
CREATE TABLE validation_error_feedback (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_id         VARCHAR(36) NOT NULL,
    message_id      VARCHAR(36) NOT NULL,
    user_id         BIGINT NOT NULL,

    error_type      VARCHAR(32) NOT NULL COMMENT 'compute/formula/fact/logic/other',
    error_category  VARCHAR(32) NOT NULL COMMENT '学科分类',
    error_detail    TEXT NOT NULL,

    ai_output       TEXT NOT NULL COMMENT '原始AI输出',
    corrected_output TEXT NULL COMMENT '修正后输出',

    source          VARCHAR(16) NOT NULL COMMENT 'auto_validation/user_report/manual_review',

    prompt_template_id VARCHAR(64) NULL,
    knowledge_point_id VARCHAR(64) NULL,

    status          VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/confirmed/fixed/ignored',

    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    resolved_at     DATETIME(3) NULL,

    INDEX idx_task (task_id),
    INDEX idx_type_status (error_type, status),
    INDEX idx_source (source),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI输出错误回流记录';
```

#### 3.3.4 Prompt 问题追踪表 `prompt_issue_tracking`

```sql
CREATE TABLE prompt_issue_tracking (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    prompt_hash     VARCHAR(64) NOT NULL,
    subject         VARCHAR(16) NOT NULL,
    scene           VARCHAR(32) NOT NULL,

    total_outputs   INT NOT NULL DEFAULT 0,
    flagged_count   INT NOT NULL DEFAULT 0,
    error_rate      DECIMAL(5,4) NOT NULL DEFAULT 0,

    last_issue_at   DATETIME(3) NULL,
    action_taken    VARCHAR(32) NULL COMMENT 'none/flagged/adjusted/deprecated',

    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_prompt (prompt_hash),
    INDEX idx_error_rate (error_rate DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Prompt模板问题追踪';
```

---

## 4. Stage 1：同步快速校验

### 4.1 概述

同步快速校验在 AI 输出完成后立即执行，目标 **≤100ms** 内完成基础校验，决定内容是否可以直接呈现。

### 4.2 校验器接口

```python
from abc import ABC, abstractmethod


class BaseValidator(ABC):
    """校验器基类"""

    @abstractmethod
    async def validate(self, context: "ValidationContext") -> CheckResult:
        ...

    @property
    @abstractmethod
    def check_type(self) -> CheckType:
        ...

    @property
    def priority(self) -> int:
        """优先级，数值越小越先执行"""
        return 100

    @property
    def estimated_latency_ms(self) -> int:
        return 50

    def should_run(self, context: "ValidationContext") -> bool:
        """是否需要执行此校验（学科/场景过滤）"""
        return True


class ValidationContext(BaseModel):
    """校验上下文"""
    task: ValidationTask
    ai_output: str
    subject: str
    phase: str
    grade: int
    scene: str
    strictness: StrictnessLevel
    previous_results: list[CheckResult] = []
```

### 4.3 格式校验器（FormatterValidator）

```python
import re


class FormatterValidator(BaseValidator):
    """格式校验器 - 检查输出格式完整性和可解析性"""

    check_type = CheckType.FORMAT
    priority = 10  # 最先执行
    estimated_latency_ms = 10

    async def validate(self, context: ValidationContext) -> CheckResult:
        issues = []

        # 1. LaTeX 公式闭合检查
        for delimiter in ['$$', '\\(', '\\)', '\\[', '\\]']:
            count = context.ai_output.count(delimiter)
            if count % 2 != 0:
                issues.append(f"unclosed_latex: {delimiter}")

        # 2. 步骤编号连续性（理科）
        if context.subject in ("math", "physics", "chemistry"):
            steps = re.findall(r'(?:步骤\s*|Step\s*|第\s*)(\d+)', context.ai_output)
            if steps:
                nums = [int(s) for s in steps]
                expected = list(range(1, max(nums) + 1))
                if sorted(nums) != expected:
                    issues.append(f"step_sequence_broken: {nums}")

        # 3. 截断检测
        text = context.ai_output.rstrip()
        if len(text) > 100:
            if text.endswith(('：', ':', '所以', '因此', '综上', '则')):
                issues.append("output_truncated")

        return CheckResult(
            check_type=self.check_type,
            status=ValidationStatus.SUSPICIOUS if issues else ValidationStatus.PASSED,
            confidence=0.6 if issues else 0.95,
            issues=issues,
            latency_ms=5
        )
```

### 4.4 数学快速校验器（MathQuickValidator）

```python
class MathQuickValidator(BaseValidator):
    """数学快速校验器 - 验证计算等式正确性"""

    check_type = CheckType.MATH_COMPUTE
    priority = 20
    estimated_latency_ms = 50

    def should_run(self, context: ValidationContext) -> bool:
        return context.subject in ("math", "physics", "chemistry")

    async def validate(self, context: ValidationContext) -> CheckResult:
        issues = []
        suggestions = []

        # 1. 提取计算等式
        calculations = self._extract_calculations(context.ai_output)

        # 2. 逐个验证
        for calc in calculations:
            try:
                correct = self._verify_arithmetic(calc["left"], calc["right"])
                if not correct:
                    expected = self._compute_result(calc["left"])
                    issues.append(
                        f"计算错误: {calc['left']} = {calc['right']}, "
                        f"正确应为 {expected}"
                    )
                    suggestions.append(f"将 {calc['right']} 修正为 {expected}")
            except Exception:
                # 无法验证的等式，交给异步复核
                pass

        # 3. 最终答案一致性检查
        final = self._extract_final_answer(context.ai_output)
        if final and calculations:
            if not self._check_answer_consistency(final, calculations):
                issues.append("最终答案与计算过程不一致")

        return CheckResult(
            check_type=self.check_type,
            status=ValidationStatus.FAILED if issues else ValidationStatus.PASSED,
            confidence=0.0 if issues else 0.9,
            issues=issues,
            suggestions=suggestions,
            latency_ms=30
        )

    def _extract_calculations(self, text: str) -> list[dict]:
        """提取数值计算等式"""
        results = []
        # 匹配: 3 × 5 = 15 或 3*5=15（v1.1 修复：支持负数与负结果，如 -3 × 5 = -15）
        for m in re.finditer(
            r'(-?\d+(?:\.\d+)?)\s*([×x*÷/\+\-])\s*(-?\d+(?:\.\d+)?)\s*=\s*(-?\d+(?:\.\d+)?)',
            text
        ):
            left_expr = f"{m.group(1)} {m.group(2)} {m.group(3)}"
            results.append({"left": left_expr, "right": m.group(4), "raw": m.group(0)})
        return results

    def _verify_arithmetic(self, left_expr: str, right_value: str) -> bool:
        """验证简单算术表达式"""
        import operator
        ops = {'×': operator.mul, 'x': operator.mul, '*': operator.mul,
               '÷': operator.truediv, '/': operator.truediv,
               '+': operator.add, '-': operator.sub}
        parts = left_expr.split()
        if len(parts) == 3:
            a, op, b = float(parts[0]), parts[1], float(parts[2])
            if op in ops:
                result = ops[op](a, b)
                return abs(result - float(right_value)) < 1e-6
        return True  # 无法验证的不报错

    def _compute_result(self, left_expr: str) -> str:
        """计算表达式结果"""
        import operator
        ops = {'×': operator.mul, 'x': operator.mul, '*': operator.mul,
               '÷': operator.truediv, '/': operator.truediv,
               '+': operator.add, '-': operator.sub}
        parts = left_expr.split()
        if len(parts) == 3:
            a, op, b = float(parts[0]), parts[1], float(parts[2])
            if op in ops:
                result = ops[op](a, b)
                if result == int(result):
                    return str(int(result))
                return f"{result:.4f}".rstrip('0').rstrip('.')
        return "?"

    def _extract_final_answer(self, text: str) -> Optional[str]:
        """提取最终答案"""
        for p in [r'答案[是为：:]\s*(.+?)(?:\n|$)',
                  r'故[答案]*[是为]\s*(.+?)(?:\n|$)']:
            m = re.search(p, text)
            if m:
                return m.group(1).strip()
        return None

    def _check_answer_consistency(self, answer: str, calcs: list) -> bool:
        """检查最终答案是否与计算结果一致"""
        answer_nums = set(re.findall(r'\d+(?:\.\d+)?', answer))
        for calc in calcs:
            right_nums = set(re.findall(r'\d+(?:\.\d+)?', calc["right"]))
            if answer_nums & right_nums:
                return True
        # 如果答案中有任何数字没出现在计算过程中，可能不一致
        return len(answer_nums) == 0  # 纯文字答案视为一致
```

### 4.5 化学方程式校验器（ChemEquationValidator）

```python
class ChemEquationValidator(BaseValidator):
    """化学方程式校验器 - 检查配平、格式"""

    check_type = CheckType.CHEMICAL_EQUATION
    priority = 25
    estimated_latency_ms = 40

    def should_run(self, context: ValidationContext) -> bool:
        return context.subject == "chemistry"

    async def validate(self, context: ValidationContext) -> CheckResult:
        issues = []

        equations = self._extract_equations(context.ai_output)
        for eq in equations:
            balance_result = self._check_balance(eq)
            if not balance_result.is_balanced:
                issues.append(
                    f"化学方程式未配平: {eq}\n"
                    f"原因: {balance_result.reason}"
                )

        return CheckResult(
            check_type=self.check_type,
            status=ValidationStatus.FAILED if issues else ValidationStatus.PASSED,
            confidence=0.0 if issues else 0.85,
            issues=issues,
            latency_ms=20
        )

    def _extract_equations(self, text: str) -> list[str]:
        """提取化学方程式"""
        # 匹配含箭头的方程式: A + B → C 或 A + B == C
        return re.findall(
            r'[A-Z][a-z]?(?:\d*[A-Z][a-z]?\d*)*(?:\s*\+\s*[A-Z][a-z]?(?:\d*[A-Z][a-z]?\d*)*)*\s*[→=⟶]+\s*.*?(?=\n|$)',
            text
        )

    def _check_balance(self, equation: str) -> "BalanceResult":
        """检查化学方程式配平"""
        # 常见元素原子数统计
        # 将方程式分为反应物和生成物
        sides = re.split(r'[→=⟶]+', equation)
        if len(sides) != 2:
            return BalanceResult(is_balanced=True)  # 无法解析则跳过

        reactant_atoms = self._count_atoms(sides[0])
        product_atoms = self._count_atoms(sides[1])

        for element in set(list(reactant_atoms.keys()) + list(product_atoms.keys())):
            r = reactant_atoms.get(element, 0)
            p = product_atoms.get(element, 0)
            if r != p:
                return BalanceResult(
                    is_balanced=False,
                    reason=f"元素 {element} 不配平: 反应物={r}, 生成物={p}"
                )

        return BalanceResult(is_balanced=True)

    def _count_atoms(self, side: str) -> dict[str, int]:
        """统计一侧的原子数（v1.1 重写：按分子解析，前置计量数作用于整个分子）"""
        atoms: dict[str, int] = {}
        # v1.0 缺陷：r'([A-Z][a-z]?)(\d*)' 逐元素匹配忽略前置化学计量数，
        # "2H2 + O2 → 2H2O" 被算成左 H=2/O=2、右 H=2/O=1（真实两侧均为 H=4/O=2），
        # 已配平方程被误判未配平。修复：先按 "+" 切分子，分子级前置系数乘以全部元素。
        for molecule in re.split(r'\s*\+\s*', side):
            m = re.match(r'\s*(?:(\d+)\s*)?(.*)', molecule)
            coefficient = int(m.group(1)) if m.group(1) else 1
            for em in re.finditer(r'([A-Z][a-z]?)(\d*)', m.group(2)):
                subscript = int(em.group(2)) if em.group(2) else 1
                atoms[em.group(1)] = atoms.get(em.group(1), 0) + coefficient * subscript
        return atoms


class BalanceResult(BaseModel):
    is_balanced: bool
    reason: str = ""
```

### 4.6 事实快查校验器（FactCheckValidator）

```python
class FactCheckValidator(BaseValidator):
    """事实快查校验器 - 快速核查关键事实"""

    check_type = CheckType.FACT_CHECK
    priority = 30
    estimated_latency_ms = 80

    # 需要事实核查的学科
    TARGET_SUBJECTS = {"history", "geography", "biology", "chemistry", "physics"}

    def should_run(self, context: ValidationContext) -> bool:
        return context.subject in self.TARGET_SUBJECTS

    def __init__(self, redis_client, db_session):
        self.redis = redis_client
        self.db = db_session

    async def validate(self, context: ValidationContext) -> CheckResult:
        issues = []

        # 1. 提取可验证的事实声明
        claims = self._extract_claims(context.ai_output, context.subject)

        for claim in claims:
            # 2. 在 Redis 缓存的事实库中快速查找
            cached = await self._check_cache(claim)
            if cached is not None:
                if not cached["correct"]:
                    issues.append(f"事实错误: {claim['text']} — {cached['correction']}")
                continue

            # 3. 缓存未命中，标记为待异步复核
            # 不在这里做耗时查询
            pass

        return CheckResult(
            check_type=self.check_type,
            status=ValidationStatus.SUSPICIOUS if issues else ValidationStatus.PASSED,
            confidence=0.0 if issues else 0.7,  # 快查不全面，置信度中等
            issues=issues,
            latency_ms=60
        )

    def _extract_claims(self, text: str, subject: str) -> list[dict]:
        """提取可验证的事实声明"""
        claims = []

        if subject == "history":
            # 匹配年代声明: "1949年", "公元前221年"
            for m in re.finditer(r'((?:公元前)?\d{3,4})年(.+?)', text):
                claims.append({"type": "year", "text": m.group(0), "value": m.group(1)})

        elif subject in ("physics", "chemistry"):
            # 匹配物理常数: "光速约3×10^8 m/s"
            for m in re.finditer(
                r'(光速|引力常数|普朗克常数|电子质量|阿伏伽德罗常数)\s*[约为约等于]*\s*(.+?)(?:\n|$)',
                text
            ):
                claims.append({"type": "constant", "text": m.group(0),
                               "name": m.group(1), "value": m.group(2).strip()})

        elif subject == "geography":
            # 匹配地理数据声明: "长江约6300千米"、"珠穆朗玛峰海拔8848米"
            for m in re.finditer(
                r'([\u4e00-\u9fa5]{2,10})(?:全)?(?:长|面积|海拔|深度|人口)[约为约等于之]*\s*'
                r'(\d+(?:\.\d+)?)(万|千|百万)?(千米|公里|米|平方千米|平方公里|人)',
                text
            ):
                claims.append({"type": "geo_data", "text": m.group(0), "entity": m.group(1),
                               "value": m.group(2), "unit": (m.group(3) or "") + m.group(4)})

        elif subject == "biology":
            # 匹配生物结构/功能声明（仅高频可核查句式，宁缺勿滥防误拦）
            ORGANELLES = "线粒体|叶绿体|细胞核|核糖体|内质网|高尔基体|液泡|溶酶体|中心体"
            for m in re.finditer(rf'({ORGANELLES})[是含有]{1,2}(.+?)(?:[，。；\n]|$)', text):
                claims.append({"type": "bio_structure", "text": m.group(0),
                               "entity": m.group(1), "desc": m.group(2).strip()})

        return claims

    async def _check_cache(self, claim: dict) -> Optional[dict]:
        """Redis 事实库快查：命中返回 {correct, correction, source}，未命中返回 None。

        事实库内容：
          - 历史年代表（历史事件→年份，与课程标准服务课表数据同源）
          - 物理常数表（SI 2018 定义值，允许表述误差如 3×10^8 vs 2.998×10^8）
          - 地理极值/主干数据表
          - 生物结构与功能对照表
        Key 规则见 §9.3；TTL 7 天，夜间任务刷新（与幻觉检测引擎共享事实库，
        幻觉引擎负责生产与维护，本引擎只读消费，避免双写不一致）。
        """
        claim_hash = hashlib.md5(
            json.dumps(claim, ensure_ascii=False, sort_keys=True).encode()
        ).hexdigest()
        raw = await self.redis.get(f"fact:claim:{claim_hash}")
        return json.loads(raw) if raw else None
```

> **边界说明（事实快查 vs 幻觉检测）**：`AI幻觉检测与教育事实校验引擎` 负责事实库的生产、
> 维护与深度事实性校验（知识层“对错”）；本引擎的 FACT_CHECK 仅做**已缓存事实的毫秒级快查**，
> 缓存未命中的声明一律不打分、不拦截，标记后交由 Stage 2 深度复核按需委托
> （gRPC `FactGateway/VerifyClaims`，见 §5.5），保证两个引擎不会对同一事实给出冲突结论。

### 4.7 物理单位校验器（PhysicsUnitValidator）

```python
class PhysicsUnitValidator(BaseValidator):
    """物理单位校验器 - 量纲一致性快检（v1.1 新增）"""

    check_type = CheckType.PHYSICS_UNIT
    priority = 28
    estimated_latency_ms = 25

    def should_run(self, context: ValidationContext) -> bool:
        return context.subject == "physics"

    # 物理量 → 量纲（M质量/L长度/T时间/I电流）
    QUANTITY_DIMS = {
        "速度": "L/T", "加速度": "L/T2", "力": "ML/T2", "重力": "ML/T2",
        "功": "ML2/T2", "能量": "ML2/T2", "热量": "ML2/T2", "功率": "ML2/T3",
        "压强": "M/LT2", "密度": "M/L3", "动量": "ML/T", "频率": "1/T",
        "电流": "I", "电压": "ML2/IT3", "电阻": "ML2/I2T3", "比热容": "L2/T2K",
    }

    # 常见单位 → 量纲（复合单位用/和·表示）
    UNIT_DIMS = {
        "m/s": "L/T", "km/h": "L/T", "m/s2": "L/T2", "cm/s2": "L/T2", "N/kg": "L/T2",
        "N": "ML/T2", "kN": "ML/T2", "J": "ML2/T2", "kJ": "ML2/T2", "W": "ML2/T3",
        "kW": "ML2/T3", "Pa": "M/LT2", "kPa": "M/LT2", "MPa": "M/LT2",
        "kg/m3": "M/L3", "g/cm3": "M/L3", "kg·m/s": "ML/T", "Hz": "1/T",
        "A": "I", "V": "ML2/IT3", "Ω": "ML2/I2T3", "J/(kg·°C)": "L2/T2K",
    }

    def _dims_equal(self, d1: str, d2: str) -> bool:
        """量纲字符串等价判定（M/L/T/I 指数逐项比较）"""
        def parse(dim: str) -> dict[str, int]:
            result = {"M": 0, "L": 0, "T": 0, "I": 0, "K": 0}
            # 分子/分母分别解析，指数直接取后缀数字
            num, *den = dim.split("/")
            def apply(s: str, sign: int):
                for m in re.finditer(r'([MLTIK])(\d*)', s):
                    result[m.group(1)] += sign * (int(m.group(2)) if m.group(2) else 1)
            apply(num, 1)
            for d in den:
                apply(d, -1)
            return result
        return parse(d1) == parse(d2)

    async def validate(self, context: ValidationContext) -> CheckResult:
        issues = []

        # 1. 物理量-单位量纲匹配: "速度为 30 m/s2" → 量纲冲突
        for m in re.finditer(
            r'(速度|加速度|力|重力|功|能量|热量|功率|压强|密度|动量|频率|电流|电压|电阻|比热容)'
            r'[约为是达到]{1,3}\s*(-?[×\d.+eE^/·]+)\s*([a-zA-ZμΩ°]+(?:/[a-zA-Z2 3]+|·[a-zA-Z°]+)*)',
            context.ai_output
        ):
            quantity, unit = m.group(1), m.group(3).strip()
            q_dim = self.QUANTITY_DIMS.get(quantity)
            u_dim = self.UNIT_DIMS.get(unit)
            if q_dim and u_dim and not self._dims_equal(q_dim, u_dim):
                issues.append(f"量纲不一致: {quantity}的单位 {unit} 量纲为 {u_dim}，应为 {q_dim}")

        # 2. 等式两侧单位一致: "F = 6 kg·m/s2 = 6 J"（右侧应同为 N）
        for m in re.finditer(
            r'=\s*[\d.]+\s*([a-zA-ZμΩ°][a-zA-Z0-9/·°^2 3]*)[^=\n]*=\s*[\d.]+\s*'
            r'([a-zA-ZμΩ°][a-zA-Z0-9/·°^2 3]*)',
            context.ai_output
        ):
            d1, d2 = self.UNIT_DIMS.get(m.group(1).strip()), self.UNIT_DIMS.get(m.group(2).strip())
            if d1 and d2 and not self._dims_equal(d1, d2):
                issues.append(f"等式两侧单位量纲冲突: {m.group(1)} vs {m.group(2)}")

        return CheckResult(
            check_type=self.check_type,
            status=ValidationStatus.SUSPICIOUS if issues else ValidationStatus.PASSED,
            confidence=0.15 if issues else 0.75,   # 单位快检误报率偏高，仅标记不 FAILED
            issues=issues,
            latency_ms=20
        )
```

> 单位快检的已知局限：单位拼写变体（如 `kg·m/s²` 上标形式）与非常用单位不在字典内时跳过，
> 不报错；置信度上限 0.75，保证单位类 issue 不会单独触达 BLOCK（见 §4.9 决策矩阵）。

### 4.8 完整性校验器（CompletenessValidator）

```python
class CompletenessValidator(BaseValidator):
    """完整性校验器 - 检查回答对提问要求的覆盖度（v1.1 新增）"""

    check_type = CheckType.COMPLETENESS
    priority = 15
    estimated_latency_ms = 10

    # 疑问词 → 回答应包含的响应特征
    INTERROGATIVE_RULES = [
        (r'为什么|为何|原因是什么', [r'因为|由于|原因是', r'所以|因此|所以']),
        (r'是多少|等于几|求[\w\s的]+值|计算', [r'[-\d.]+', r'=']),
        (r'怎么|如何|怎样|步骤', [r'第[一二三四五1-5]|步骤\s*[1-5]|首先|然后|接着|最后']),
        (r'证明|求证', [r'证毕|得证|故.{0,10}成立|∴|所以.{0,20}成立']),
        (r'比较|哪个更|谁更', [r'大于|小于|>|<|更|相比|而']),
    ]

    async def validate(self, context: ValidationContext) -> CheckResult:
        issues = []

        question = getattr(context.task, "question", "")  # 由调用方注入原始提问
        if question:
            for pattern, expected in self.INTERROGATIVE_RULES:
                if re.search(pattern, question):
                    if not any(re.search(e, context.ai_output) for e in expected):
                        issues.append(f"回答未覆盖提问要求: {pattern} 类问题缺少对应响应特征")

        # 理科解答格式: 有“解:”应有结论（“答:”/“综上”/“所以…即为所求”）
        if context.subject in ("math", "physics", "chemistry"):
            if re.search(r'^解[:：]', context.ai_output, re.M):
                if not re.search(r'答[:：]|综上|所以.{0,15}(为|是|得)|即所求', context.ai_output):
                    issues.append("解答有始无终: 有『解』无结论性表述")

        # 承诺未兑现: “下面我们来看…”后无实质内容（与截断检测互补的段落级检测）
        tail = context.ai_output[-400:]
        if re.search(r'(下面我们|接下来|首先我们).{0,20}(来看|介绍|分析|计算)', tail):
            issues.append("尾部承诺未兑现: 引导句后内容缺失")

        return CheckResult(
            check_type=self.check_type,
            status=ValidationStatus.SUSPICIOUS if issues else ValidationStatus.PASSED,
            confidence=0.3 if issues else 0.8,
            issues=issues,
            latency_ms=8
        )
```

### 4.9 同步决策合并器（SyncDecisionEngine）

所有校验器**并行执行**（`asyncio.gather` + 全局 100ms 截止时间），延迟取各校验器最大值
而非求和；超预算的校验器被取消并计入 `degraded` 列表，对应能力转入 Stage 2 异步补做。

#### 4.9.1 100ms 预算分配

| 阶段 | 预算 | 说明 |
|------|------|------|
| 上下文准备 + 任务落库（异步先行） | 10ms | 落库走 Outbox 化异步，不阻塞 |
| 并行校验窗口 | 75ms | 单校验器上限 60ms，窗口剩余 <15ms 时取消未完成者 |
| 结果合并与决策 | 10ms | 纯内存计算 |
| 预留抖动 | 5ms | GC/网络毛刺 |

#### 4.9.2 加权合成与严格度阈值矩阵

综合分 `score = Σ(check.weight × check.confidence × status_factor) / Σ(check.weight)`，
其中 `status_factor`: PASSED=1.0 / SUSPICIOUS=0.4 / FAILED=0 / 跳过时该项不参与归一。

| 严格度 | PASS（直接放行） | FLAG（标记放行+入异步队列） | BLOCK（拦截+触发重试） |
|--------|------------------|------------------------------|------------------------|
| TOLERANT | score ≥ 0.50 | 0.30 ≤ score < 0.50 | score < 0.30 且存在硬错误 |
| NORMAL   | score ≥ 0.65 | 0.45 ≤ score < 0.65 | score < 0.45 或存在硬错误 |
| STRICT   | score ≥ 0.75 | 0.55 ≤ score < 0.75 | score < 0.55 或存在硬错误 |
| RIGOROUS | score ≥ 0.85 | 0.65 ≤ score < 0.85 | score < 0.65 或**任意** FAILED 项 |

**硬错误（无视总分直达 BLOCK）**：
1. `MATH_COMPUTE=FAILED` 且 confidence ≥ 0.9（等式验算确凿不成立）
2. `CHEMICAL_EQUATION=FAILED` 且 confidence ≥ 0.85
3. `FACT_CHECK` 命中事实缓存且 `correct=false`（年代/常数硬错）

> SAFETY 检查项说明：流式链路的安全过滤权威在《服务端-大模型流式输出实时安全过滤中间件》，
> 本引擎的 SAFETY 检查器仅作为**非流式链路兜底**（如异步报告生成、批处理内容）存在，
> 不在流式路径重复拦截，避免双重门控语义冲突。

#### 4.9.3 决策实现

```python
class SyncDecisionEngine:
    HARD_BLOCK_RULES = [
        (CheckType.MATH_COMPUTE, 0.90),
        (CheckType.CHEMICAL_EQUATION, 0.85),
        (CheckType.FACT_CHECK, 0.95),
    ]

    THRESHOLDS = {
        StrictnessLevel.TOLERANT: (0.50, 0.30),
        StrictnessLevel.NORMAL:   (0.65, 0.45),
        StrictnessLevel.STRICT:   (0.75, 0.55),
        StrictnessLevel.RIGOROUS: (0.85, 0.65),
    }

    def decide(self, task: ValidationTask, degraded: list[str]) -> tuple[str, float]:
        score = self._weighted_score(task.checks)
        pass_line, flag_line = self.THRESHOLDS[task.strictness]

        # 硬错误检查（RIGOROUS 下任意 FAILED 也直达）
        for check in task.checks:
            if check.status == ValidationStatus.FAILED:
                if task.strictness == StrictnessLevel.RIGOROUS:
                    return "BLOCK", score
                for check_type, min_conf in self.HARD_BLOCK_RULES:
                    if check.check_type == check_type and check.confidence >= min_conf:
                        return "BLOCK", score

        if score >= pass_line:
            return "PASS", score
        if score >= flag_line:
            return "FLAG", score
        return ("BLOCK", score) if task.risk_level == RiskLevel.HIGH else ("FLAG", score)

    def _weighted_score(self, checks: list[CheckResult]) -> float:
        WEIGHTS = {CheckType.MATH_COMPUTE: 0.30, CheckType.CHEMICAL_EQUATION: 0.20,
                   CheckType.FACT_CHECK: 0.20, CheckType.FORMAT: 0.10,
                   CheckType.PHYSICS_UNIT: 0.10, CheckType.COMPLETENESS: 0.05,
                   CheckType.LOGIC_CONSISTENCY: 0.05}
        STATUS_FACTOR = {ValidationStatus.PASSED: 1.0, ValidationStatus.SUSPICIOUS: 0.4,
                         ValidationStatus.FAILED: 0.0}
        num = den = 0.0
        for c in checks:
            w = WEIGHTS.get(c.check_type)
            if w is None:
                continue
            num += w * c.confidence * STATUS_FACTOR[c.status]
            den += w * c.confidence if c.status != ValidationStatus.ERROR else 0
            # 注：ERROR(校验器自身故障)不参与计分，防质量守卫自身故障污染内容分
        return round(num / den, 4) if den > 0 else 0.5  # 全部校验器故障时给中性分，走异步
```

**三路决策的去向**：

| 决策 | 用户侧表现 | 后续动作 |
|------|-----------|----------|
| PASS | 正常渲染 | 若命中抽样(sample_flag)仍入异步队列 |
| FLAG | 正常渲染 + 消息角标无感知（不展示给用户） | 入 Stage 2 异步队列 |
| BLOCK | 返回重试话术（理科链路 P5：“让我重新计算一下…”） | 触发上游重生成(最多 1 次)；同时入队复核对比原输出 |

---

## 5. Stage 2：异步深度复核

### 5.1 复核触发与优先级队列

入队来源三路：同步 FLAG、同步 BLOCK（拦截后复核留证）、抽样 PASS（默认 2%，
RIGOROUS 场景 10%，配置中心可调）。队列基于 Redis Stream `vq:review:stream`，
消费组 `vq-reviewer`，消息体仅含 `review_request.id`，负载落库后拉取。

| 优先级 | 来源 | 目标延迟 |
|--------|------|----------|
| P0 | exam_simulation 场景全部 + BLOCK 留证 | ≤ 2min |
| P1 | HIGH 风险 FLAG（数学/物理/化学计算类） | ≤ 10min |
| P2 | MEDIUM 风险 FLAG + 抽样 PASS | ≤ 30min |

> 配额红线：复核触发率（复核条数 / AI 输出总条数）≤ 15%（对齐《项目风险管理与应对策略》
> 监控阈值）。超限时 P2 停止消费（review_request 置 `skipped`，skip_reason=quota），
> P0/P1 不受限（宁超成本不漏高风险，超限部分触发 56510 告警而非拒绝）。

### 5.2 复核策略矩阵

| 策略 | 做法 | 适用 | 成本 | 决策权重 |
|------|------|------|------|----------|
| RE_SOLVE | 换模型重新完整解题，比对最终答案 | 计算题/证明题骨架 | 高 | 强 |
| VERIFY_ONLY | 给复核模型原题+原答案，要求校验并指出错误 | 概念解释/步骤检查 | 低 | 中 |
| SYMBOLIC | SymPy/配平矩阵符号验算（无模型参与） | 数值等式/化学配平 | 极低 | **仲裁级** |
| KB_COMPARE | 委托事实校验引擎比对知识库 | 事实声明类 | 中 | 中 |

路由规则：理科含计算 → SYMBOLIC + RE_SOLVE 双跑；理科无计算 → RE_SOLVE；
文科事实类 → KB_COMPARE；其余 → VERIFY_ONLY。一次 review_request 只承载一个策略，
同任务多策略时拆多条（幂等键 `task_id:strategy:attempt` 唯一索引约束）。

### 5.3 多模型交叉验证

#### 5.3.1 复核模型选择（守卫 G10）

```python
class ReviewModelSelector:
    """复核模型选择器：必须与原模型异供应商，防同源偏见"""

    # 能力档位 → 候选模型（与《多模型调度与成本治理》模型注册表同源，热更新）
    REVIEW_POOL = {
        "strong":  ["glm-4-plus", "qwen-max", "gpt-4o"],      # RE_SOLVE 用
        "light":  ["glm-4-flash", "qwen-turbo", "gpt-4o-mini"], # VERIFY_ONLY 用
    }

    async def select(self, original_model: str, strategy: str) -> str:
        tier = "strong" if strategy == "RE_SOLVE" else "light"
        original_vendor = self._vendor_of(original_model)
        # 1. 过滤同供应商；2. 按近期质量分(滑动窗口错误率)降序；3. 剩余预算优先
        candidates = [m for m in self.REVIEW_POOL[tier] if self._vendor_of(m) != original_vendor]
        if not candidates:
            raise NoReviewerAvailableError(56511)
        return await self._rank_by_quality_and_budget(candidates)
```

所有复核调用**必须**经《服务端-大模型推理统一适配层》统一入口发起（计量标签
`scene=quality_review`），禁止直连供应商——成本归集与容灾切换由适配层与
《服务端-AI模型调用多供应商容灾切换与自动降级引擎》统一治理。

#### 5.3.2 复核协议（V1-V5 校验）

复核 Prompt 要求模型输出严格 JSON（非自然语言），落库前过五道校验：

```json
{
  "answer": "x=3",
  "verdict": "disagree",
  "confidence": 0.88,
  "issues": [
    {"location": "step3", "type": "compute", "detail": "2×(−3) 应为 −6 而非 6"}
  ],
  "corrected_answer": "x=−1"
}
```

| 校验 | 规则 | 不通过处置 |
|------|------|-----------|
| V1 | JSON 可解析 | 重试 1 次（temperature=0），仍败则 56513 |
| V2 | verdict ∈ {agree, disagree, unsure} | 同上 |
| V3 | confidence ∈ [0,1] 数值 | 越界截断到 [0,1] 并降 0.05 权重 |
| V4 | verdict=disagree 时 issues 非空 | 补问 1 次，仍缺则降级为 unsure |
| V5 | answer 与 corrected_answer 长度 ≤ 2KB 且不含系统提示词类内容 | 截断+标记协议异常 |

#### 5.3.3 答案等价归一化比较器

RE_SOLVE 的答案比对不能直接字符串相等，需归一化：

```python
def answers_equivalent(a: str, b: str) -> bool:
    """答案等价判定：归一化后严格相等，或数值容差/集合无序/区间等价"""
    def normalize(s: str) -> str:
        s = unicodedata.normalize("NFKC", s)          # 全半角
        s = s.replace(" ", "").replace("\u2212", "-")  # Unicode 负号
        s = re.sub(r'x\s*=\s*', "x=", s)
        s = re.sub(r'\{(.*?)\}', lambda m: "{" + ",".join(sorted(m.group(1).split(","))) + "}", s)
        return s

    na, nb = normalize(a), normalize(b)
    if na == nb:
        return True
    # 数值容差：分数/小数/百分数互认（1/2 ≡ 0.5 ≡ 50%）
    fa, fb = _to_float_maybe(na), _to_float_maybe(nb)
    if fa is not None and fb is not None:
        return abs(fa - fb) < 1e-9
    # 兜底：字符级相似度 ≥ 0.92（仅记账 agree_low，供审计）
    return difflib.SequenceMatcher(None, na, nb).ratio() >= 0.92
```

### 5.4 符号计算仲裁（SYMBOLIC）

符号引擎结果优先级最高（守卫 G11）：判 incorrect 即终审 confirm_error；
判 correct 不能单独推翻 disagree（可能原题理解分歧），需与第三方模型决胜。

```python
import sympy as sp

class SymbolicArbiter:
    """符号仲裁器：数学等式验算 + 化学配平矩阵"""

    async def verify_math(self, calc: dict) -> str:
        """返回 correct / incorrect / unparseable"""
        try:
            lhs = sp.sympify(calc["left"].replace("×", "*").replace("÷", "/").replace("^", "**"))
            rhs = sp.sympify(str(calc["right"]))
            return "correct" if sp.simplify(lhs - rhs) == 0 else "incorrect"
        except (sp.SympifyError, ValueError, TypeError, ZeroDivisionError):
            return "unparseable"

    async def verify_chem_balance(self, equation: str) -> str:
        """化学配平仲裁：元素矩阵零空间整数解（rdkit 不可用时降级自研高斯消元）"""
        sides = re.split(r'[→=⟶]+', equation)
        if len(sides) != 2:
            return "unparseable"
        try:
            matrix = self._build_element_matrix(sides[0], sides[1])  # 行=元素,列=物种
            nullspace = matrix.nullspace()                             # sympy Matrix
            if not nullspace:
                return "correct"  # 唯一零解 → 已配平（原子守恒的齐次系统）
            # 存在非零解 → 可配平；再验证 AI 给出的系数向量是否为一组解
            vec = self._extract_coefficients(equation)
            return "correct" if vec is not None and matrix * vec == sp.zeros(matrix.rows, 1) \
                else "incorrect"
        except Exception:
            return "unparseable"
```

> 预算：单条 SYMBOLIC 仲裁 ≤ 800ms（超时即 skipped，按模型一致性继续，见 D2）；
> 符号引擎部署为独立 gRPC 服务（复用《服务端-统一学科计算引擎与符号推理服务》算力池），
> 本引擎不自行驻留 SymPy 进程池。

### 5.5 知识库比对（KB_COMPARE）

KB_COMPARE 不自建检索，直接委托事实权威：

```proto
service FactGateway {  // 服务方：教育内容事实性校验与知识准确性验证引擎
  rpc VerifyClaims(VerifyClaimsRequest) returns (VerifyClaimsResponse);
}
message VerifyClaimsRequest {
  repeated Claim claims = 1;   // 复用 §4.6 提取的 claims 结构
  string scene = 2;            // quality_review
  int32 timeout_ms = 3;        // 上限 3000
}
message VerifyClaimsResponse {
  repeated ClaimVerdict verdicts = 1;  // correct/incorrect/unverifiable + evidence
}
```

边界：`AI幻觉检测与教育事实校验引擎` 与 `教育内容事实性校验引擎` 的分工以其文档
§边界表为准——幻觉引擎管“生成内容的事实性幻觉”，事实校验引擎管“知识库事实对错”，
本引擎仅消费 verdict，不二次判读，避免三方结论冲突。

### 5.6 复核决策矩阵

| 模型一致性 | 符号仲裁 | KB verdict | 最终裁决 | 动作 |
|------------|----------|-----------|----------|------|
| agree | correct / skipped / unparseable | — | PASS | 确认通过，关闭任务 |
| agree | incorrect | — | CONFIRM_ERROR（符号反杀） | 进 §5.7 纠错闭环 |
| disagree | incorrect | — | CONFIRM_ERROR | 双证据成立，进纠错闭环 |
| disagree | correct | — | PASS + 记复核方质量负分 | 复核模型错，不误导用户 |
| disagree | unparseable / skipped | — | 第三方模型决胜（异于前两家供应商） | 2/3 多数；仍平 → INCONCLUSIVE |
| unsure | — | correct | PASS | 弱确认 |
| unsure | — | incorrect | CONFIRM_ERROR | KB 证据成立 |
| unsure | — | unverifiable | INCONCLUSIVE | 转人工队列（G6） |
| 任意（exam 场景 disagree） | — | — | INCONCLUSIVE + 人工优先 | 考试链路宁人工勿自动 |

CONFIRM_ERROR 的证据链要求（守卫 G5）：至少两条**独立**证据
（checker+reviewer / reviewer+symbolic / reviewer+KB），单证据仅可 INCONCLUSIVE。

### 5.7 纠错生成与推送闭环

```mermaid-like 时序（文字版）：
1. 复核裁决 CONFIRM_ERROR
2. 修正生成器调用原供应商模型 + 修正 Prompt（注入错误定位 issues + 原输出），
   重新生成 corrected_output（预算 = 原生成 1.2 倍 token）
3. corrected_output 先过本引擎同步快检 + VERIFY_ONLY 复核抽审（G7，防二次错误）
4. 通过 → validation_task.corrected_output 落库 + message 状态置 superseded_candidate
5. Outbox 事件 validation.correction.pushed → 消息服务生成纠错卡片消息
6. SSE 推送协议（对齐《SSE流式响应与AI增量渲染引擎》事件通道）：
   event: correction
   data: {"messageId":"m_123","type":"AI_CORRECTION","summary":"已修正第 3 步计算",
          "correctedMessageId":"m_124","correctionVersion":1}
7. 客户端：原消息折叠展示 + 顶部纠错卡片（成长型话术，见 C4）；用户可见“查看修正”
8. 推送失败 → 站内信兑底（D7），3 次重试后告警
```

### 5.8 复核结果回填 ARPP

异步复核完成后：
1. `overall_score`（deep 权威分）回填《AI回答后处理与智能优化管线》的
   `ai_response_process_log.quality_score_deep`（其文档 §3.7 双轨约定）；
2. deep 分 < 阈值的消息若已进入《AI输出缓存与智能复用引擎》，发缓存失效通知；
3. confirm_error 样本打 `vq_confirmed` 标签，供《教育大模型RLHF反馈数据管线》
   拉取偏好对（corrected > original），日上限 5000 对（频控见 §6.4）。

---

## 6. 错误回流与持续优化闭环

### 6.1 error_feedback 生命周期

三来源写入 `validation_error_feedback`：auto_validation（本引擎自动确认）、
user_report（用户点踩/纠错，来自《用户反馈与AI质量评估》）、manual_review
（抽样审核工作台人工确认）。user_report 到达时不直接确认，先触发一次复核比对
（复用本引擎队列，P1 优先级），复核支持后才 confirm——防用户误报污染回流数据。

状态机：`pending → confirmed → fixed | ignored`（+`disputed` 申诉分支），守卫见 §8。

### 6.2 Prompt 问题追踪

日终聚合任务（02:30，游标分片断点续跑）：

```sql
INSERT INTO prompt_issue_tracking (prompt_hash, subject, scene, total_outputs,
                                   flagged_count, error_rate, last_issue_at)
SELECT t.ai_prompt_hash, t.subject, t.scene, COUNT(*),
       SUM(t.status IN ('suspicious','failed')),
       SUM(t.status IN ('suspicious','failed')) / COUNT(*), MAX(t.created_at)
FROM validation_task t
WHERE t.created_at >= ? AND t.ai_prompt_hash IS NOT NULL
GROUP BY t.ai_prompt_hash, t.subject, t.scene
ON DUPLICATE KEY UPDATE total_outputs = VALUES(total_outputs) + total_outputs,
  flagged_count = VALUES(flagged_count) + flagged_count,
  error_rate = (flagged_count) / (total_outputs),
  last_issue_at = GREATEST(last_issue_at, VALUES(last_issue_at));
```

| 阈值（样本 ≥ 50） | action | 后续 |
|-------------------|--------|------|
| error_rate > 5% | flagged | Outbox 事件 validation.prompt.flagged → Prompt 版本管理引擎告警 |
| error_rate > 10% | adjusted（建议） | 生成 Prompt 修订建议单（错误样本 Top3 摘要） |
| error_rate > 20% 且样本 ≥ 200 | deprecated（候选） | 双人审批后通知编排引擎下线该模板 |

### 6.3 供应商质量信号

按 model 滚动 7 天窗口计算 `confirm_error_rate`（confirm_error 数 / 复核数），
写入 Redis `vq:model:quality:{model}`（ZSET 滑窗）。超 8% 时发布事件
`validation.model.quality.signal`（payload: model, window_error_rate, sample_size），
由《服务端-AI模型调用多供应商容灾切换与自动降级引擎》决策降权/切换——本引擎
只发信号不执行切换（单向边界）。

### 6.4 RLHF 数据回流

confirmed 样本日终导出偏好对（prompt_hash, original, corrected, issues），
T+1 04:00 推送 RLHF 管线专用 Topic。频控：日 ≤ 5000 对、单 prompt_hash 日 ≤ 50 对
（防单一模板刷屏污染训练分布）；导出数据先过 PII 打码（复用统一脱敏规则引擎）。

---

## 7. API 设计

### 7.1 同步校验入口（内部）

`POST /internal/v1/quality/validations:sync`（调用方：ARPP 后处理管线、
批处理内容生成器；鉴权：内部服务间 mTLS + 服务账号）

```json
// 请求
{
  "messageId": "m_9f3a",
  "conversationId": "c_17c2",
  "userId": 100234,
  "subject": "math", "phase": "senior", "grade": 10, "scene": "tutoring",
  "question": "已知 f(x)=2x-3，求 f(5)…",
  "aiOutput": "…解：f(5)=2×5-3=8…",
  "aiModel": "glm-4-plus", "promptHash": "sha256:ab12…",
  "budgetMs": 100
}
// 响应（200）
{
  "taskId": "vt_5c81",
  "decision": "BLOCK",
  "score": 0.31,
  "riskLevel": "HIGH",
  "degraded": ["fact_check"],
  "blockReason": {"check": "math_compute", "code": 56512,
                  "detail": "计算错误: 2 × 5 - 3 = 8 无该等式成立…"},
  "retryHint": "RETRY_REGENERATE"
}
```

幂等：`Idempotency-Key=messageId`，重复调用返回首次结果（56503 语义，响应带
`duplicate: true`）。

### 7.2 消息维度质量查询

`GET /api/v1/quality/messages/{messageId}`（用户端，仅本人消息）：返回
`{status, overallScore, correction: {correctedMessageId, summary} | null}`；
不暴露内部校验明细与复核过程（防逆向规避）。

### 7.3 管理端接口

| 接口 | 方法 | 说明 |
|------|------|------|
| /admin/v1/quality/tasks | GET | 校验任务分页（筛选 subject/status/risk/decision） |
| /admin/v1/quality/tasks/{id}/review | POST | 手工触发深度复核（P1 插队） |
| /admin/v1/quality/error-feedbacks | GET/POST | 列表 / 确认·忽略·驳回处置（双人审计） |
| /admin/v1/quality/prompt-issues | GET | Prompt 问题榜（error_rate 排序） |
| /admin/v1/quality/config | GET/PUT | 阈值/抽样率/复核池配置（变更双人审批，56561 越界校验） |
| /admin/v1/quality/stats | GET | 看板：拦截率/复核率/一致率/成本（对齐运营驾驶舱） |

### 7.4 gRPC 接口

```proto
service QualityValidationService {
  rpc QuickCheck(QuickCheckRequest) returns (QuickCheckResponse);      // 同步快检（流式生成场景的收尾钩子）
  rpc DeepReview(DeepReviewRequest) returns (DeepReviewResponse);      // 显式触发复核（步级引擎/幻觉引擎联动）
  rpc QueryByMessage(QueryByMessageRequest) returns (ValidationSummary); // 消息维度汇总
}
```

### 7.5 限流与幂等总表

| 入口 | 限流 | 幂等 |
|------|------|------|
| :sync | 调用方服务级 2000 QPS（网关侧） | messageId 唯一 + Redis 10s 去重窗 |
| DeepReview | 每源 100 QPS | uk(task_id, strategy, attempt) |
| 管理端 | 账号级 10 QPS | PUT 幂等（If-Match version） |
| 事件消费 | 消费组级 | (event_id, consumer) 唯一 |

---

## 8. 状态机与守卫

### 8.1 validation_task 生命周期

```
pending ──sync──▶ passed(终)            [PASS]
   │        └────▶ failed(终)            [BLOCK，附 retry_hint]
   │        └────▶ suspicious ──async──▶ passed(终)
   │                          ├─────────▶ failed(终)        [CONFIRM_ERROR → 纠错]
   │                          ├─────────▶ manual_review ──▶ passed/failed(终)
   │                          └─────────▶ error(终)          [复核系统自身故障]
   └──系统故障──▶ error(终)  [fail-open 放行 + 异步补偿校验，D6]
```

### 8.2 review_request 状态机

`queued → running → completed | failed(重试≤2, 2^n 退避) | skipped(quota/budget/circuit)`

### 8.3 error_feedback 状态机

`pending → confirmed → fixed | ignored`；`pending → disputed（申诉）→ confirmed | ignored`

### 8.4 prompt_issue_tracking action 单向流转

`none → flagged → adjusted → deprecated`（每步留痕 audit log，deprecated 双人审批）

### 8.5 守卫总表 G1-G12

| 守卫 | 规则 | 违反后果 |
|------|------|----------|
| G1 | task 仅 pending 可进 sync；终态任务重跑须管理端新建任务 | 56531 |
| G2 | scene=exam_simulation 且 BLOCK 时必须拦截+重试，禁止降级 FLAG | 审计告警 |
| G3 | suspicious 必须入队 async（配额熔断除外，记 skip_reason） | P2 告警 |
| G4 | passed(sync) 不自动升级复核；仅 sample_flag 或显式 DeepReview 可入队 | 56531 |
| G5 | confirm_error 需 ≥2 条独立证据（checker+reviewer/reviewer+symbolic/reviewer+KB） | 56532 |
| G6 | manual_review 仅可由 async INCONCLUSIVE 或 feedback 争议触发 | 56531 |
| G7 | corrected_output 推送前必须过同步快检 + VERIFY_ONLY 抽审 | 56533 拦停 |
| G8 | error_feedback 仅 pending 可 confirm；confirmed 单向到 fixed/ignored | 56531 |
| G9 | prompt_issue action 单向流转；deprecated 双人审批 | 56541 |
| G10 | 复核模型必须与原模型异供应商 | 自动换选，无候选则 56511 |
| G11 | SYMBOLIC incorrect 为终审；SYMBOLIC correct 不足以单独推翻 disagree（需第三方决胜） | 决策矩阵强制 |
| G12 | 未成年人消息纠错卡片话术必须走成长型模板白名单 | 推送拦截 + 审计 |

---

## 9. DDL 增补与存储设计

### 9.1 v1.0 缺陷修复：validation_task 缺列

v1.0 的 Pydantic 模型含 ai_output/extracted_*/corrected_output 字段但 DDL 无对应列，
且模型与 DDL 均缺 question（RE_SOLVE 复核需要原题重新解题）——v1.1 补列：

```sql
ALTER TABLE validation_task
    ADD COLUMN question MEDIUMTEXT NULL COMMENT '原始提问(RE_SOLVE 复核与 §4.8 完整性校验依赖,同步入库)',
    ADD COLUMN ai_output MEDIUMTEXT NULL COMMENT 'AI原始输出(异步复核依赖)',
    ADD COLUMN extracted_claims JSON NULL,
    ADD COLUMN extracted_formulas JSON NULL,
    ADD COLUMN extracted_calculations JSON NULL,
    ADD COLUMN skip_reason VARCHAR(32) NULL COMMENT 'quota/budget/circuit/degraded',
    ADD COLUMN sample_flag TINYINT NOT NULL DEFAULT 0 COMMENT '抽样复核标记',
    ADD INDEX idx_status_stage (status, stage);
```

### 9.2 新增表

```sql
CREATE TABLE review_request (
    id               BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_id          VARCHAR(36) NOT NULL,
    message_id       VARCHAR(36) NOT NULL,
    priority         TINYINT NOT NULL DEFAULT 2 COMMENT '0 exam/1 high/2 sampled',
    strategy         VARCHAR(16) NOT NULL COMMENT 'RE_SOLVE/VERIFY_ONLY/SYMBOLIC/KB_COMPARE',
    status           VARCHAR(16) NOT NULL DEFAULT 'queued',
    reviewer_model   VARCHAR(32) NULL,
    reviewer_vendor  VARCHAR(32) NULL,
    raw_review_output MEDIUMTEXT NULL,
    agreement        VARCHAR(16) NULL COMMENT 'agree/disagree/unsure',
    symbolic_verdict VARCHAR(16) NULL COMMENT 'correct/incorrect/unparseable/skipped',
    final_verdict    VARCHAR(16) NULL COMMENT 'pass/confirm_error/inconclusive',
    cost_cents       INT NULL,
    attempt          INT NOT NULL DEFAULT 0,
    idempotency_key  VARCHAR(80) NOT NULL,
    created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    completed_at     DATETIME(3) NULL,
    UNIQUE KEY uk_idem (idempotency_key),
    UNIQUE KEY uk_task_strategy_attempt (task_id, strategy, attempt),
    INDEX idx_status_priority (status, priority, created_at),
    INDEX idx_message (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='异步深度复核请求';

CREATE TABLE vq_outbox (
    id           BIGINT PRIMARY KEY AUTO_INCREMENT,
    event_id     VARCHAR(64) NOT NULL,
    event_type   VARCHAR(64) NOT NULL,
    aggregate_id VARCHAR(36) NOT NULL,
    payload      JSON NOT NULL,
    created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    published_at DATETIME(3) NULL,
    UNIQUE KEY uk_event (event_id),
    INDEX idx_type_published (event_type, published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='质量校验事件发件箱';
```

另：`prompt_issue_tracking` 的 `UNIQUE KEY uk_prompt(prompt_hash)` 与
subject/scene 统计维度矛盾（同哈希多场景会互相覆盖）——v1.1 修复为
`UNIQUE KEY uk_hash_scene (prompt_hash, subject, scene)`（存量重建脚本略）。

ClickHouse `vq_check_log`（TTL 180 天）：逐校验器延迟/状态明细，供监控与阈值回归。

### 9.3 Redis Key 总表

| Key | 类型 | TTL | 用途 |
|-----|------|-----|------|
| fact:claim:{md5} | String(JSON) | 7d | 事实快查缓存（幻觉引擎生产，本引擎只读） |
| vq:dedup:sync:{messageId} | String | 10s | 同步入口防重 |
| vq:budget:{yyyyMMdd} | Counter | 48h | 复核日配额 |
| vq:cost:{yyyyMM} | Counter | 35d | 月成本熔断（分单位） |
| vq:circuit | Hash | — | 引擎/符号服务熔断状态 |
| vq:review:stream | Stream | — | 复核队列（消费组 vq-reviewer） |
| vq:model:quality:{model} | ZSET(score=ts) | 7d | 模型滑动窗口质量 |
| vq:correction:push:{messageId} | String | 24h | 纠错推送幂等 |

---

## 10. 幂等与并发控制

1. 同步入口：messageId 唯一 + 10s Redis 去重窗（双保险）；
2. 复核执行：`uk(task_id, strategy, attempt)` 防重复入队；执行前 CAS
   `queued→running` 抢占，失败即他者已执行；
3. 纠错推送：`vq:correction:push:{messageId}` SETNX，防 SSE+站内信双通道重复；
4. 事件消费：消费方以 `(event_id, consumer)` 唯一约束幂等；
5. 并发复核同任务：以 task_id 分布式锁（10s）串行裁决落库，防双复核双写 verdict；
6. 管理端处置：If-Match 乐观锁（version 列）；
7. 日终聚合：游标断点 + 幂等 upsert（§6.2 SQL）；
8. 熔断恢复：半开探测单流量 → 全量（复用统一熔断组件规范）。

---

## 11. Outbox 事件（vq.domain.events）

| 事件 | 触发 | 主要消费方（幂等键） |
|------|------|---------------------|
| validation.sync.blocked | 同步 BLOCK | ARPP（重试编排）、RLHF 管线（负面样本） |
| validation.suspicious.raised | 同步 FLAG 入队 | 监控看板、抽样审核工作台（抽样加签） |
| validation.error.confirmed | 复核 CONFIRM_ERROR | 抽样审核工作台（高优任务）、ARPP（deep 分回填）、缓存引擎（失效）、RLHF（偏好对） |
| validation.correction.pushed | 纠错推送成功 | 消息服务（纠错卡片）、埋点平台 |
| validation.review.skipped | 配额/预算/熔断跳过 | 成本治理（预算联动）、监控告警 |
| validation.prompt.flagged | Prompt 阈值命中 | Prompt 版本管理与效果回归评估引擎 |
| validation.model.quality.signal | 模型滑窗错误率超阈 | 模型容灾切换与自动降级引擎 |

Relay 进程 500ms 批量投递 + 日终对账（未发布事件积压 > 1000 告警）。

---

## 12. 错误码（56500-56599，本引擎专属段）

| 码 | 含义 | 说明 |
|----|------|------|
| 56500 | VALIDATION_INTERNAL | 引擎内部错误（fail-open，D6） |
| 56501 | VALIDATION_PARAM_INVALID | 参数缺失/格式非法 |
| 56502 | VALIDATION_MESSAGE_NOT_FOUND | 消息不存在或已删除 |
| 56503 | VALIDATION_DUPLICATE | 幂等命中（返回首次结果，非故障） |
| 56504 | VALIDATION_OUTPUT_TOO_LONG | 输出 > 32KB 拒绝（转异步专用通道） |
| 56505 | VALIDATION_SUBJECT_UNSUPPORTED | 学科不在策略矩阵 |
| 56510 | REVIEW_QUOTA_EXCEEDED | 日复核配额耗尽（P2 停止） |
| 56511 | REVIEW_MODEL_UNAVAILABLE | 异供应商无可用复核模型 |
| 56512 | REVIEW_TIMEOUT | 复核超时（>3 次重试） |
| 56513 | REVIEW_PROTOCOL_INVALID | 复核输出 V1-V5 校验失败 |
| 56514 | REVIEW_BUDGET_EXCEEDED | 月成本预算熔断 |
| 56520 | SYMBOLIC_ENGINE_ERROR | 符号服务异常 |
| 56521 | SYMBOLIC_PARSE_FAILED | 表达式解析失败（不判内容错） |
| 56530 | FEEDBACK_NOT_FOUND | 回流记录不存在 |
| 56531 | FEEDBACK_STATE_CONFLICT | 状态机守卫拒绝 |
| 56532 | FEEDBACK_EVIDENCE_INSUFFICIENT | 证据不足不可确认（G5） |
| 56533 | CORRECTION_GENERATION_FAILED | 修正生成失败/二次质检未过（G7） |
| 56534 | CORRECTION_PUSH_FAILED | 推送失败（重试后告警） |
| 56540 | PROMPT_ISSUE_NOT_FOUND | — |
| 56541 | PROMPT_TRACKING_CONFLICT | action 流转守卫拒绝（G9） |
| 56550 | KB_GATEWAY_TIMEOUT | 事实网关超时（D5，不判错） |
| 56551 | KB_GATEWAY_UNAVAILABLE | 事实网关不可用 |
| 56560 | ADMIN_PERMISSION_DENIED | 管理端越权 |
| 56561 | ADMIN_CONFIG_INVALID | 策略配置越界（如抽样率>50%） |
| 56599 | VALIDATION_CIRCUIT_OPEN | 引擎熔断中（快速失败） |

> 客户端映射：学生端仅感知 56512/56513 的统一文案「重新组织语言中，请稍后再试」，
> 内部明细不出端（防逆向规避校验）。

---

## 13. 降级矩阵 D1-D10

| 编号 | 故障 | 降级行为 | 红线 |
|------|------|----------|------|
| D1 | Redis 事实缓存不可用 | 快查跳过全走异步 | 不因缺缓存放行已知错误 |
| D2 | 符号引擎超时(800ms) | 放弃仲裁按模型一致性 | 数学硬错误仍由 checker 闪拦 |
| D3 | 复核模型全部不可用 | 队列挂起 15min→转人工 | P0 考试场景不静默丢弃 |
| D4 | 日配额耗尽 | 仅 P0/P1 复核 | 触发率≤15% 红线优先 |
| D5 | KB 网关超时 | verdict=unverifiable | 不判错不拦截（宁漏勿误拦） |
| D6 | 同步校验自身故障 | fail-open 放行+异步补偿 | 仅限系统自身故障，内容错误仍拦截 |
| D7 | SSE 推送失败 | 站内信兑底，3 次重试 | 纠错必达（含重放队列） |
| D8 | ClickHouse 写失败 | 本地缓冲夜间重放 | 监控数据可缺不可阻塞主链路 |
| D9 | Outbox 消费方不可达 | Relay 对账补偿（1h） | 事件不丢（at-least-once） |
| D10 | 月成本熔断 | RE_SOLVE→VERIFY_ONLY 降档 | P0 不降档，超支走特批通道 |

---

## 14. 监控与容量

### 14.1 监控指标（10 项）

| 指标 | 目标 | 告警阈值 |
|------|------|----------|
| sync_latency_p99 | ≤ 100ms | >120ms 持续 5min（P2） |
| 计算错误拦截率（抽检反推） | ≥ 95% | <90%（P1） |
| 误拦率（人工抽审反推） | < 2% | >3%（P1） |
| 复核触发率 | ≤ 15% | >15% 持续 1h（P2） |
| 复核一致率（agree 占比） | 80-95% | <70% 查复核池污染（P1） |
| confirm_error 率 | 1%-5% | >8%（P1，模型质量恶化） |
| 纠错推送到达率 | ≥ 99% | <97%（P1） |
| 队列积压 | < 5min | P0 积压>2min（P1） |
| prompt flagged 新增 | 监控 | 单日>10（P2） |
| 引擎熔断状态 | closed | open 即 P1 |

### 14.2 容量估算（DAU 50 万）

- 日 AI 输出约 200 万条（辅导/拍题/练习链路合计），同步校验峰值 QPS ≈ 600
  （晚高峰 19:00-22:00 占 45%），均值 25 QPS——纯 CPU/缓存路径，4C8G×4 实例；
- HIGH 风险占比 ~35% = 70 万条；复核触发率 12% ≈ 24 万条/日，其中 RE_SOLVE
  30%（7.2 万）、VERIFY_ONLY 55%、SYMBOLIC/KB 15%；
- 复核成本：加权平均 ¥0.015/条 → 日 ≈ ¥3,600，月 ≈ ¥10.8 万，占 AI 总成本
  ~12%（<15% 目标，D10 熔断线设 14%）；
- validation_task 日增 200 万行 → 按月分区，在线 6 个月 + 归档 24 个月
  （注册统一存储清理引擎）；review_request 日增 24 万，在线 12 个月；
- Redis ≈ 1.2GB（事实库 600MB + 滑窗/去重/队列）；ClickHouse 日增 ~8GB（TTL 180 天）。

---

## 15. 合规红线 C1-C8

| 编号 | 红线 |
|------|------|
| C1 | 校验与复核调用不得外传用户 PII：题面/输出先过统一脱敏（复用脱敏规则引擎）再出域 |
| C2 | 原始输出仅用于质量目的，保留遵守统一数据保留策略，账户注销级联删除 |
| C3 | 未成年人纠错推送须家长可见性遵循家庭共享可见度分级引擎的边界 |
| C4 | 纠错卡片话术白名单（成长型表述：“这道题有了更准确的解法”，禁用“AI 之前教错了”） |
| C5 | 复核样本回流 RLHF/评测前必须 PII 打码 + k 匿名检查 |
| C6 | AIGC 标识链路不受纠错覆盖影响，corrected_output 同样携带生成标识 |
| C7 | 管理端查看原始错误输出需权限 + 审计留痕（最小必要） |
| C8 | 误拦申诉通道：用户可对拦截结果申诉（feedback disputed 分支），48h 内人工复核 |

---

## 16. 契约对齐（15 项）

| # | 对端文档 | 契约点 |
|---|----------|--------|
| 1 | AI回答后处理与智能优化管线 | ARPP 完成后调 :sync；deep 分回填 ai_response_process_log（其 §3.7 双轨） |
| 2 | AI幻觉检测与教育事实校验引擎 | 事实库生产权归幻觉引擎，本引擎只读 fact:claim:* |
| 3 | 教育内容事实性校验与知识准确性验证引擎 | KB_COMPARE 消费 FactGateway/VerifyClaims verdict |
| 4 | AI回答分步质量校验与推理链完整性评估引擎 | 步级引擎发现链路断裂可调 DeepReview；粒度边界：步级 vs 篇级 |
| 5 | AI对话质量抽样审核与标注工作台服务 | error.confirmed 事件生成高优审核任务（字段以其任务 schema 为准） |
| 6 | AI模型调用多供应商容灾切换与自动降级引擎 | quality.signal 单向通知，切换执行权在对端 |
| 7 | 多模型调度与成本治理 | 复核调用走统一适配层，计量 scene=quality_review，预算熔断联动 |
| 8 | 大模型推理统一适配层 | 复核不直连供应商；模型注册表同源热更新 |
| 9 | Prompt版本管理与效果回归评估引擎 | prompt.flagged 事件 + error_rate 数据供其回归评估 |
| 10 | 教育大模型RLHF反馈数据管线 | 偏好对日 ≤5000，T+1 04:00 Topic 投递 |
| 11 | AI输出缓存与智能复用引擎 | deep 分超阈值禁入缓存；confirm_error 触发失效 |
| 12 | 端到端流程设计-理科解题完整链路 | P5 VALIDATION_CALC_ERROR → BLOCK 重试协议与“让我重新计算一下…”话术 |
| 13 | 端到端流程设计-拍照搜题答疑完整链路 | P4 AI_LOW_QUALITY 路由到本引擎复核 |
| 14 | 用户反馈与AI质量评估 | 点踩/纠错 → error_feedback(source=user_report) 先复核后 confirm |
| 15 | SSE流式响应与AI增量渲染引擎 | correction 事件通道协议（§5.7） |

---

## 17. 验收场景（18 条）

1. 高中数学“2×5-3=8”计算错误 → 同步 MATH_COMPUTE FAILED → BLOCK + 重试话术，任务 failed；
2. 同题重试生成“2×5-3=7” → PASS，同一 conversation 两条任务记录均留存；
3. 化学“2H2 + O2 → 2H2O”正确配平（v1.0 会误拦的样例）→ 化学快检 PASSED（回归用例）；
4. 化学“H2 + O2 → H2O”未配平 → BLOCK，suggestions 含建议系数；
5. 历史输出“唐朝建立于 618 年”缓存命中 correct → PASS 不入队；
6. 历史“安史之乱发生在 965 年”缓存命中 incorrect → 硬错误 BLOCK；
7. 物理输出“速度为 30 m/s2”→ PHYSICS_UNIT SUSPICIOUS → FLAG，异步复核确认措辞错误并纠错推送；
8. 幼儿场景近似表述“小猴子有好多好多香蕉”→ TOLERANT，无事实声明，PASS；
9. 同步窗口内 FACT_CHECK 超预算被取消 → degraded=[fact_check]，决策仍出，事实转异步；
10. 复核 RE_SOLVE 答案“x=-1”vs 原“x=−1”→ 归一化等价 → agree；
11. 复核 disagree + SYMBOLIC incorrect → 双证据 CONFIRM_ERROR → 纠错卡片 SSE 到达，消息 superseded；
12. 复核 disagree + SYMBOLIC correct → 第三方模型决胜（2/3）；仍平 → manual_review 队列；
13. 日配额耗尽 → P2 skipped(skip_reason=quota)，P0 考试场景仍复核，56510 告警；
14. 复核池与原模型同供应商唯一候选 → NoReviewerAvailable → 56511，队列挂起计时；
15. 用户对拦截结果申诉 → feedback disputed → 人工确认误拦 → 误拦率统计 + 阈值回溯；
16. prompt 模板 7 天 error_rate 6%（样本 120）→ flagged 事件到 Prompt 版本管理；
17. 某模型滑窗错误率 9% → quality.signal 事件 → 容灾引擎降权（本引擎不切换）；
18. 注销账户 → validation_task/review_request/error_feedback 级联清理（保留策略对账）。

---

## 18. 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-05-23 | 初稿：§1-§4.6 前半（因生成截断未完成，尾部停在 _extract_claims 代码中段） |
| v1.1 | 2026-08-19 | 补全烂尾：完成 §4.6（地理/生物声明 + Redis 事实快查协议与幻觉引擎只读边界）；新增 §4.7 物理量纲校验、§4.8 完整性校验、§4.9 同步决策合并器（并行预算取消/严格度阈值矩阵/硬错误直达 BLOCK）；§5 异步深度复核八节（优先级队列/四策略/异供应商选择 G10/复核协议 V1-V5/答案等价归一化/SymPy+配平矩阵符号仲裁 G11/三维决策矩阵含第三方决胜/纠错生成与 SSE 推送闭环/ARPP deep 分回填）；§6 错误回流闭环（user_report 先复核后确认/Prompt 阈值 5%-10%-20% 单向流转/供应商质量信号单向/RLHF 日 5000 对频控）；§7 API 六节；§8 四状态机 + G1-G12；§9 DDL 增补与 Redis 八类 Key；§10 幂等并发八场景；§11 七事件消费方矩阵；§12 错误码 56500-56599 共 24 项；§13 降级 D1-D10；§14 监控 10 指标与 DAU50 万容量（复核成本占比 12%<15% 红线）；§15 合规 C1-C8；§16 契约对齐 15 项；§17 验收 18 条。修复 v1.0 四处缺陷：①DDL 缺 question/ai_output 等八列（RE_SOLVE 复核缺原题、模型有字段而表无列，异步复核无原始输出可用）；②化学配平 _count_atoms 忽略前置计量数致已配平方程误拦；③数学等式正则不支持负数；④prompt_issue_tracking uk_prompt 与 subject/scene 维度矛盾改复合唯一键 |