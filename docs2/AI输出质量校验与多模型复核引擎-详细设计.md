# AI 输出质量校验与多模型复核引擎 - 详细设计

> 版本：v1.0 | 日期：2026-05-23 | 状态：初稿

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
        # 匹配: 3 × 5 = 15 或 3*5=15
        for m in re.finditer(
            r'(\d+(?:\.\d+)?)\s*([×x*÷/\+\-])\s*(\d+(?:\.\d+)?)\s*=\s*(\d+(?:\.\d+)?)',
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
        """统计一侧的原子数"""
        atoms = {}
        # 简化实现：匹配元素符号和下标
        for m in re.finditer(r'([A-Z][a-z]?)(\d*)', side):
            element = m.group(1)
            count = int(m.group(2)) if m.group(2) else 1
            atoms[element] = atoms.get(element, 0) + count
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