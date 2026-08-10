# 服务端 - 教育内容智能创作辅助与 AI Copilot 内容生产工具链引擎 详细设计

## 1. 概述

### 1.1 功能定位

本模块为 PrimeTop 平台的内容教研团队、外部内容供应商和 UGC 审核人员提供 **AI 辅助创作能力**，将大模型能力嵌入到内容生产工作流中，帮助创作者更快、更高质量地完成题目编写、解析撰写、知识点标注、难度评估、格式化排版等工作。

与已有的"AI 自动生成引擎"（如 `AI题目智能生成引擎`、`教育内容可视化素材智能生成` 等）不同，本模块的定位是 **人机协同的 Copilot 模式**：

| 维度 | 自动生成引擎 | AI Copilot（本模块） |
| --- | --- | --- |
| 交互模式 | 输入参数 → 输出结果 | 实时建议 → 人确认 → 采纳/修改/拒绝 |
| 人的角色 | 审核最终结果 | 全程参与创作，AI 辅助 |
| 质量控制 | 后置审核 | 前置引导 + 实时纠错 |
| 适用场景 | 批量生产、模板化内容 | 高质量、需要教研判断的内容 |
| 创作者自主性 | 低 | 高 |

### 1.2 设计目标

1. **提升创作效率**：将单道题目的编写时间从 15 分钟缩短至 5-8 分钟。
2. **保障内容质量**：在创作过程中实时检测错误、不一致和规范性问题。
3. **降低专业门槛**：非资深教研人员也能在 AI 辅助下产出合格内容。
4. **统一内容规范**：通过 AI 规则约束，确保所有内容符合平台标准。
5. **积累创作知识**：将优秀创作者的经验沉淀为 AI 辅助规则。

### 1.3 适用范围

| 用户角色 | 使用场景 |
| --- | --- |
| 内部教研人员 | 日常题目编写、解析撰写、教案制作 |
| 外部内容供应商 | 按合同交付题目和解析 |
 |兼职内容标注员 | 知识点标注、难度评估、标签维护 |
| 审核人员 | 内容质量审核、纠错修改 |
| 运营人员 | 活动专题内容编辑、推荐文案撰写 |

---

## 2. 系统架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    内容创作者工作台 (Web)                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ 题目编辑器│ │ 解析编辑器│ │ 标签编辑器│ │ Copilot 面板 │  │
│  └─────┬────┘ └─────┬────┘ └─────┬────┘ └──────┬───────┘  │
└────────┼────────────┼────────────┼──────────────┼───────────┘
         │            │            │              │
         ▼            ▼            ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Copilot Gateway (API 层)                   │
│   /suggest  /autocomplete  /check  /rewrite  /explain       │
└───────────────────────┬─────────────────────────────────────┘
                        │
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
┌─────────────┐ ┌──────────────┐ ┌──────────────┐
│ Suggestion  │ │ Quality      │ │ Generation   │
│ Engine      │ │ Checker      │ │ Engine       │
│ (建议引擎)   │ │ (质量检查器)  │ │ (生成引擎)    │
└──────┬──────┘ └──────┬───────┘ └──────┬───────┘
       │               │                │
       ▼               ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│                    AI 能力调度层                              │
│   大模型 API │ RAG 检索 │ 知识库查询 │ 规则引擎 │ NLP 管线    │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心子系统

| 子系统 | 职责 | 关键能力 |
| --- | --- | --- |
| Suggestion Engine（建议引擎） | 在创作者编辑过程中实时提供上下文建议 | 智能补全、关联推荐、素材推荐 |
| Quality Checker（质量检查器） | 对创作中的内容进行实时质量检测 | 错误检测、规范性检查、一致性校验 |
| Generation Engine（生成引擎） | 根据创作者指令生成草稿内容 | 解析草稿生成、选项生成、变式生成 |
| Copilot Gateway（网关） | 统一管理 Copilot 会话和请求编排 | 会话管理、上下文维护、结果聚合 |

---

## 3. 数据结构定义

### 3.1 Copilot 会话表 `copilot_session`

```sql
CREATE TABLE copilot_session (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    session_id      VARCHAR(64) NOT NULL UNIQUE COMMENT '会话唯一标识',
    user_id         BIGINT NOT NULL COMMENT '创作者用户ID',
    work_type       VARCHAR(32) NOT NULL COMMENT '工作类型: QUESTION_AUTHOR / EXPLANATION_WRITE / TAG_ANNOTATE / REVIEW_CHECK',
    content_id      BIGINT COMMENT '关联的内容ID（题目ID/解析ID等）',
    content_type    VARCHAR(32) COMMENT '内容类型: QUESTION / EXPLANATION / KNOWLEDGE_POINT / LESSON',
    subject         VARCHAR(16) COMMENT '学科',
    grade_range     VARCHAR(32) COMMENT '适用学段年级',
    textbook_id     BIGINT COMMENT '教材版本ID',
    status          VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE / COMPLETED / ABANDONED',
    context_snapshot JSON COMMENT '创作上下文快照（当前编辑状态）',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    expired_at      DATETIME COMMENT '会话过期时间',
    INDEX idx_user (user_id, status),
    INDEX idx_content (content_id, content_type)
) COMMENT='Copilot创作会话';
```

### 3.2 AI 建议记录表 `copilot_suggestion`

```sql
CREATE TABLE copilot_suggestion (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    suggestion_id   VARCHAR(64) NOT NULL UNIQUE COMMENT '建议唯一标识',
    session_id      VARCHAR(64) NOT NULL COMMENT '关联的会话ID',
    trigger_type    VARCHAR(32) NOT NULL COMMENT '触发类型: AUTO / MANUAL / BATCH',
    suggestion_type VARCHAR(48) NOT NULL COMMENT '建议类型（见 3.3）',
    trigger_context JSON COMMENT '触发上下文（当前编辑内容、光标位置等）',
    suggestion_body JSON NOT NULL COMMENT '建议内容体（含文本、操作指令等）',
    confidence      DECIMAL(4,3) COMMENT '置信度 0-1',
    model_name      VARCHAR(64) COMMENT '生成建议的模型名',
    prompt_hash     VARCHAR(64) COMMENT 'Prompt 模板哈希',
    latency_ms      INT COMMENT '生成耗时（毫秒）',
    token_cost      INT COMMENT 'Token 消耗',
    feedback        VARCHAR(16) COMMENT '用户反馈: ACCEPTED / REJECTED / MODIFIED / IGNORED',
    feedback_detail JSON COMMENT '反馈详情（修改后的内容等）',
    rating          TINYINT COMMENT '用户评分 1-5',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_session (session_id),
    INDEX idx_type (suggestion_type, feedback),
    INDEX idx_created (created_at)
) COMMENT='AI建议记录';
```

### 3.3 建议类型枚举

```python
from enum import Enum

class SuggestionType(str, Enum):
    # === 题目编写辅助 ===
    QUESTION_STEM_AUTOCOMPLETE = "question_stem_autocomplete"      # 题干智能补全
    QUESTION_OPTION_GENERATE = "question_option_generate"          # 选项智能生成
    QUESTION_DISTRACTOR_GENERATE = "question_distractor_generate"  # 干扰项生成
    QUESTION_CONDITION_SUGGEST = "question_condition_suggest"      # 条件补充建议
    QUESTION_VARIANT_GENERATE = "question_variant_generate"        # 题目变式生成
    QUESTION_DIFFICULTY_ASSESS = "question_difficulty_assess"      # 难度预评估

    # === 解析撰写辅助 ===
    EXPLANATION_DRAFT = "explanation_draft"                        # 解析草稿生成
    EXPLANATION_STEP_COMPLETE = "explanation_step_complete"        # 步骤补全
    EXPLANATION_FORMULA_INSERT = "explanation_formula_insert"      # 公式插入建议
    EXPLANATION_SIMPLIFY = "explanation_simplify"                  # 表达简化建议
    EXPLANATION_AGE_ADAPT = "explanation_age_adapt"                # 适龄化改写建议

    # === 知识点标注辅助 ===
    KNOWLEDGE_POINT_AUTO_TAG = "knowledge_point_auto_tag"          # 知识点自动标注
    KNOWLEDGE_POINT_VERIFY = "knowledge_point_verify"              # 标注准确性验证
    COURSE_STANDARD_ALIGN = "course_standard_align"                # 课标对齐建议
    PREREQUISITE_SUGGEST = "prerequisite_suggest"                  # 前置知识点建议

    # === 质量检查 ===
    ERROR_DETECTION = "error_detection"                            # 错误检测
    TYPO_CHECK = "typo_check"                                      # 错别字检查
    TERMINOLOGY_CHECK = "terminology_check"                        # 术语规范性检查
    CONSISTENCY_CHECK = "consistency_check"                        # 题目与解析一致性
    FORMAT_CHECK = "format_check"                                  # 格式规范检查

    # === 素材推荐 ===
    SIMILAR_QUESTION_RECOMMEND = "similar_question_recommend"      # 同类题推荐参考
    EXAMPLE_SUGGEST = "example_suggest"                            # 例题/案例推荐
    DIAGRAM_SUGGEST = "diagram_suggest"                            # 配图建议
```

### 3.4 质量检查规则配置表 `copilot_quality_rule`

```sql
CREATE TABLE copilot_quality_rule (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    rule_id         VARCHAR(64) NOT NULL UNIQUE COMMENT '规则唯一标识',
    rule_name       VARCHAR(128) NOT NULL COMMENT '规则名称',
    rule_category   VARCHAR(32) NOT NULL COMMENT 'ERROR / WARNING / SUGGESTION',
    rule_type       VARCHAR(48) NOT NULL COMMENT '检查类型: TYPO / TERMINOLOGY / CONSISTENCY / FORMAT / LOGIC / PEDAGOGY',
    subject         VARCHAR(16) COMMENT '适用学科（空=全部）',
    grade_range     VARCHAR(32) COMMENT '适用学段（空=全部）',
    rule_pattern    TEXT COMMENT '规则模式（正则/JSON Schema/自然语言描述）',
    rule_config     JSON COMMENT '规则配置参数',
    severity        VARCHAR(16) NOT NULL DEFAULT 'WARNING' COMMENT 'ERROR / WARNING / INFO',
    auto_fix_enabled TINYINT DEFAULT 0 COMMENT '是否支持自动修复',
    enabled         TINYINT NOT NULL DEFAULT 1,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_category (rule_category, rule_type, enabled),
    INDEX idx_subject (subject, grade_range, enabled)
) COMMENT='质量检查规则配置';
```

### 3.5 创作者反馈统计表 `copilot_creator_stats`

```sql
CREATE TABLE copilot_creator_stats (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id         BIGINT NOT NULL,
    stat_date       DATE NOT NULL,
    subject         VARCHAR(16),
    work_type       VARCHAR(32),
    total_sessions  INT DEFAULT 0 COMMENT '总会话数',
    total_suggestions_received INT DEFAULT 0 COMMENT '收到的建议总数',
    total_suggestions_accepted INT DEFAULT 0 COMMENT '采纳的建议数',
    total_suggestions_modified INT DEFAULT 0 COMMENT '修改后采纳的建议数',
    total_suggestions_rejected INT DEFAULT 0 COMMENT '拒绝的建议数',
    avg_rating      DECIMAL(3,2) COMMENT '平均评分',
    total_content_produced INT DEFAULT 0 COMMENT '生产的内容总数',
    avg_quality_score DECIMAL(4,2) COMMENT '平均质量分',
    total_time_saved_minutes INT DEFAULT 0 COMMENT '预估节省时间（分钟）',
    token_cost_total INT DEFAULT 0 COMMENT 'Token总消耗',
    UNIQUE KEY uk_user_date (user_id, stat_date, subject, work_type),
    INDEX idx_date (stat_date)
) COMMENT='创作者Copilot使用统计';
```

---

## 4. API 接口设计

### 4.1 会话管理

#### 创建 Copilot 会话

```
POST /api/v1/copilot/sessions
```

**请求体：**
```json
{
    "workType": "QUESTION_AUTHOR",
    "contentType": "QUESTION",
    "subject": "MATH",
    "gradeRange": "GRADE_7_9",
    "textbookId": 1024,
    "contentId": null,
    "context": {
        "currentDraft": "",
        "cursorPosition": 0,
        "editorMode": "RICH_TEXT"
    }
}
```

**响应体：**
```json
{
    "code": 0,
    "data": {
        "sessionId": "copilot-2026-0811-001",
        "status": "ACTIVE",
        "capabilities": [
            "question_stem_autocomplete",
            "question_option_generate",
            "question_distractor_generate",
            "question_difficulty_assess",
            "knowledge_point_auto_tag",
            "error_detection",
            "terminology_check"
        ],
        "presetRules": [
            {"ruleId": "MATH-TERM-001", "ruleName": "数学术语规范"},
            {"ruleId": "FORMAT-001", "ruleName": "公式格式检查"}
        ]
    }
}
```

#### 更新创作上下文

```
PUT /api/v1/copilot/sessions/{sessionId}/context
```

**请求体：**
```json
{
    "currentDraft": "已知二次函数 y = ax² + bx + c 的图像经过点 (1,0)、(3,0)...",
    "cursorPosition": 45,
    "selection": {"start": 10, "end": 20, "text": "ax² + bx + c"},
    "metadata": {
        "questionType": "FILL_BLANK",
        "difficulty": "MEDIUM"
    }
}
```

### 4.2 智能建议

#### 获取实时建议

```
POST /api/v1/copilot/sessions/{sessionId}/suggest
```

**请求体：**
```json
{
    "triggerType": "AUTO",
    "context": {
        "field": "question_stem",
        "textBefore": "已知二次函数 y = ax² + bx + c 的图像经过点",
        "textAfter": "，求该二次函数的解析式。",
        "cursorOffset": 22
    },
    "maxSuggestions": 3
}
```

**响应体：**
```json
{
    "code": 0,
    "data": {
        "requestId": "req-001",
        "suggestions": [
            {
                "suggestionId": "sug-001",
                "type": "question_condition_suggest",
                "confidence": 0.92,
                "insertText": "(1, 0)、(3, 0)、(0, -3)",
                "replaceRange": null,
                "explanation": "补充三个已知点，使二次函数解析式可唯一确定",
                "alternatives": [
                    "(−1, 0)、(2, 0)、(0, 2)",
                    "(0, 1)、(1, 2)、(2, 5)"
                ]
            },
            {
                "suggestionId": "sug-002",
                "type": "question_stem_autocomplete",
                "confidence": 0.78,
                "insertText": "(0, 3) 和 (2, 0)",
                "replaceRange": null,
                "explanation": "两个已知点配合对称轴条件可求解"
            }
        ],
        "latencyMs": 820
    }
}
```

#### 批量生成草稿

```
POST /api/v1/copilot/sessions/{sessionId}/generate
```

**请求体：**
```json
{
    "instruction": "根据以下知识点生成一道中等难度的选择题",
    "params": {
        "knowledgePoints": ["一元二次方程的根与系数关系", "韦达定理"],
        "questionType": "MULTIPLE_CHOICE",
        "difficulty": "MEDIUM",
        "gradeRange": "GRADE_9",
        "textbookId": 1024,
        "optionsCount": 4
    }
}
```

**响应体：**
```json
{
    "code": 0,
    "data": {
        "draft": {
            "stem": "已知 x₁、x₂ 是方程 x² - 5x + 6 = 0 的两根，则 x₁² + x₂² 的值为（  ）",
            "options": [
                {"key": "A", "text": "13"},
                {"key": "B", "text": "11"},
                {"key": "C", "text": "25"},
                {"key": "D", "text": "7"}
            ],
            "answer": "A",
            "explanation": "由韦达定理，x₁ + x₂ = 5，x₁x₂ = 6。\n x₁² + x₂² = (x₁ + x₂)² - 2x₁x₂ = 25 - 12 = 13。",
            "knowledgePoints": ["一元二次方程的根与系数关系", "韦达定理"],
            "difficultyEstimate": 0.45
        },
        "warnings": [
            {
                "type": "SIMILAR_QUESTION_EXISTS",
                "message": "题库中存在相似度 87% 的题目 (QID: 203847)",
                "similarQuestionId": 203847
            }
        ]
    }
}
```

### 4.3 质量检查

#### 实时质量检查

```
POST /api/v1/copilot/sessions/{sessionId}/check
```

**请求体：**
```json
{
    "scope": "FULL",
    "content": {
        "stem": "已知二次函数 y=ax²+bx+c 过点(1,0),(3,0),(0,-3)，求该函数解析式。",
        "options": null,
        "answer": "y = x² - 4x + 3",
        "explanation": "将三个点代入得 a+b+c=0, 9a+3b+c=0, c=-3，解得 a=1, b=-4, c=3"
    }
}
```

**响应体：**
```json
{
    "code": 0,
    "data": {
        "overallScore": 82,
        "issues": [
            {
                "issueId": "iss-001",
                "severity": "WARNING",
                "category": "FORMAT",
                "ruleId": "MATH-FORMAT-002",
                "message": "数学公式建议使用 LaTeX 格式",
                "location": {"field": "stem", "start": 4, "end": 18},
                "suggestion": "使用 $y = ax^2 + bx + c$ 替代 y=ax²+bx+c",
                "autoFixable": true,
                "fixSuggestion": "已知二次函数 $y = ax^2 + bx + c$ 过点 $(1,0)$、$(3,0)$、$(0,-3)$，求该函数解析式。"
            },
            {
                "issueId": "iss-002",
                "severity": "WARNING",
                "category": "FORMAT",
                "ruleId": "PUNCT-001",
                "message": "坐标点之间建议使用顿号分隔",
                "location": {"field": "stem", "start": 21, "end": 35},
                "autoFixable": true,
                "fixSuggestion": "将 (1,0),(3,0),(0,-3) 改为 $(1,0)$、$(3,0)$、$(0,-3)$"
            },
            {
                "issueId": "iss-003",
                "severity": "ERROR",
                "category": "LOGIC",
                "ruleId": "ANSWER-VERIFY-001",
                "message": "答案验证失败：代入点 (1,0) 得 1-4+3=0 ✓，代入点 (3,0) 得 9-12+3=0 ✓，代入点 (0,-3) 得 0-0+3=3 ≠ -3",
                "location": {"field": "answer"},
                "autoFixable": false,
                "fixSuggestion": "请检查：c 应为 -3 而非 3。正确答案应为 y = x² - 4x - 3"
            }
        ],
        "passedChecks": [
            "terminology_check",
            "age_appropriateness",
            "knowledge_point_coverage"
        ]
    }
}
```

### 4.4 建议反馈

#### 提交建议反馈

```
POST /api/v1/copilot/suggestions/{suggestionId}/feedback
```

**请求体：**
```json
{
    "feedback": "MODIFIED",
    "rating": 4,
    "modifiedContent": "已知点改为 (0, 3) 和 (2, 0)",
    "comment": "原建议的点太难计算了，换了一组更简单的"
}
```

### 4.5 创作统计

#### 获取创作者 Copilot 使用统计

```
GET /api/v1/copilot/stats?userId={userId}&startDate={startDate}&endDate={endDate}
```

**响应体：**
```json
{
    "code": 0,
    "data": {
        "summary": {
            "totalSessions": 142,
            "totalSuggestionsReceived": 1287,
            "acceptRate": 0.68,
            "modifyRate": 0.15,
            "rejectRate": 0.17,
            "avgRating": 4.2,
            "estimatedTimeSavedMinutes": 1860,
            "qualityScoreAvg": 88.5
        },
        "byWorkType": [
            {
                "workType": "QUESTION_AUTHOR",
                "sessionCount": 80,
                "contentProduced": 156,
                "acceptRate": 0.72
            },
            {
                "workType": "EXPLANATION_WRITE",
                "sessionCount": 42,
                "contentProduced": 98,
                "acceptRate": 0.61
            }
        ],
        "suggestionTypeBreakdown": [
            {"type": "question_stem_autocomplete", "count": 320, "acceptRate": 0.75},
            {"type": "error_detection", "count": 280, "acceptRate": 0.89},
            {"type": "explanation_draft", "count": 195, "acceptRate": 0.55}
        ]
    }
}
```

---

## 5. 核心流程设计

### 5.1 实时建议流（WebSocket）

创作者在编辑器中输入时，系统通过 WebSocket 连接提供低延迟建议。

```
客户端                          Copilot Gateway                    AI调度层
  │                                  │                               │
  │──── ws: connect ────────────────►│                               │
  │◄─── ws: connected ──────────────│                               │
  │                                  │                               │
  │──── ws: edit_event ─────────────►│                               │
  │     {field, text, cursor}        │                               │
  │                                  │── 判断是否需要触发建议 ──►   │
  │                                  │◄── 触发决策结果 ─────────────│
  │                                  │                               │
  │                                  │──── 调用建议引擎 ──────────►│
  │                                  │     (去抖 300ms)              │
  │                                  │◄── 建议结果 ─────────────────│
  │◄─── ws: suggestion ─────────────│                               │
  │     {suggestions[]}              │                               │
  │                                  │                               │
  │──── ws: accept_suggestion ──────►│                               │
  │     {suggestionId}               │── 记录反馈 ──►               │
  │◄─── ws: ack ────────────────────│                               │
```

### 5.2 建议触发策略

不是每次按键都触发 AI 建议（成本太高），而是采用智能触发策略：

```python
import time
from typing import Optional
from dataclasses import dataclass

@dataclass
class TriggerPolicy:
    """建议触发策略"""
    debounce_ms: int = 300           # 去抖延迟
    min_text_length: int = 10        # 最小触发文本长度
    max_concurrent: int = 3          # 最大并发建议请求数
    cooldown_ms: int = 500           # 同类型建议冷却时间
    pause_threshold_ms: int = 800    # 输入暂停触发阈值


class SuggestionTriggerManager:
    """建议触发管理器"""

    def __init__(self, policy: TriggerPolicy):
        self.policy = policy
        self._last_trigger_time: dict[str, float] = {}  # type -> timestamp
        self._pending_timer: Optional[asyncio.Task] = None
        self._last_text: str = ""

    def should_trigger(
        self,
        suggestion_type: str,
        current_text: str,
        cursor_position: int,
        pause_duration_ms: int
    ) -> bool:
        """判断是否应该触发建议"""

        # 1. 文本长度不足，不触发
        if len(current_text) < self.policy.min_text_length:
            return False

        # 2. 同类型建议冷却中
        now = time.time()
        last = self._last_trigger_time.get(suggestion_type, 0)
        if (now - last) * 1000 < self.policy.cooldown_ms:
            return False

        # 3. 文本未变化，不触发
        if current_text == self._last_text:
            return False

        # 4. 检查触发条件
        if suggestion_type == "question_stem_autocomplete":
            # 补全建议：输入暂停超过阈值时触发
            return pause_duration_ms >= self.policy.pause_threshold_ms

        elif suggestion_type == "error_detection":
            # 错误检测：标点符号、换行或段落结束时触发
            if current_text and cursor_position > 0:
                char = current_text[cursor_position - 1]
                return char in '。.？?！!；;\n'

        elif suggestion_type == "terminology_check":
            # 术语检查：输入空格或标点时触发
            if current_text and cursor_position > 0:
                char = current_text[cursor_position - 1]
                return char in ' \t，,。.；;'

        elif suggestion_type == "knowledge_point_auto_tag":
            # 知识点标注：内容变化超过一定比例时触发
            text_diff_ratio = self._calculate_diff_ratio(current_text, self._last_text)
            return text_diff_ratio > 0.2

        return False

    def mark_triggered(self, suggestion_type: str):
        """标记建议已触发"""
        self._last_trigger_time[suggestion_type] = time.time()
        self._last_text = ""  # Reset for next comparison

    @staticmethod
    def _calculate_diff_ratio(text1: str, text2: str) -> float:
        """计算文本变化比例"""
        if not text2:
            return 1.0
        from difflib import SequenceMatcher
        return 1.0 - SequenceMatcher(None, text1, text2).ratio()
```

### 5.3 质量检查管线

质量检查采用多阶段管线设计：

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List

@dataclass
class QualityIssue:
    issue_id: str
    severity: str        # ERROR / WARNING / INFO
    category: str        # FORMAT / LOGIC / TERMINOLOGY / TYPO / PEDAGOGY
    rule_id: str
    message: str
    location: dict
    auto_fixable: bool
    fix_suggestion: str | None


class QualityCheckStage(ABC):
    """质量检查阶段基类"""

    @abstractmethod
    async def check(self, content: dict, context: dict) -> List[QualityIssue]:
        ...


class FormatCheckStage(QualityCheckStage):
    """格式规范检查"""

    async def check(self, content: dict, context: dict) -> List[QualityIssue]:
        issues = []
        stem = content.get("stem", "")

        # 检查数学公式格式
        if "ax²" in stem or "bx²" in stem:
            issues.append(QualityIssue(
                issue_id=self._gen_id(),
                severity="WARNING",
                category="FORMAT",
                rule_id="MATH-FORMAT-002",
                message="数学公式应使用 LaTeX 格式",
                location={"field": "stem"},
                auto_fixable=True,
                fix_suggestion=self._convert_to_latex(stem)
            ))

        # 检查标点规范
        punctuation_issues = self._check_punctuation(stem)
        issues.extend(punctuation_issues)

        return issues

    @staticmethod
    def _convert_to_latex(text: str) -> str:
        import re
        # 将 ax² 转为 $ax^2$
        text = re.sub(r'([a-z])²', r'$\1^2$', text)
        text = re.sub(r'([a-z])³', r'$\1^3$', text)
        return text

    @staticmethod
    def _check_punctuation(text: str) -> List[QualityIssue]:
        issues = []
        # 检查中英文标点混用
        # 检查坐标点分隔符
        # ...
        return issues

    @staticmethod
    def _gen_id() -> str:
        import uuid
        return f"iss-{uuid.uuid4().hex[:8]}"


class TerminologyCheckStage(QualityCheckStage):
    """术语规范性检查"""

    # 学科术语规范映射
    TERM_MAPPING = {
        "MATH": {
            "等差数列的公差": ["公差d", "common difference"],
            "等比数列的公比": ["公比q", "common ratio"],
            "二次函数的顶点": ["顶点坐标", "vertex"],
        },
        "PHYSICS": {
            "摩擦力": ["friction force"],
            "加速度": ["acceleration"],
        }
    }

    async def check(self, content: dict, context: dict) -> List[QualityIssue]:
        issues = []
        subject = context.get("subject", "MATH")
        term_mapping = self.TERM_MAPPING.get(subject, {})
        full_text = " ".join(filter(None, [
            content.get("stem", ""),
            content.get("explanation", "")
        ]))

        for standard_term, variants in term_mapping.items():
            for variant in variants:
                if variant in full_text and standard_term not in full_text:
                    issues.append(QualityIssue(
                        issue_id=f"term-{hash(variant) % 100000:05d}",
                        severity="WARNING",
                        category="TERMINOLOGY",
                        rule_id=f"TERM-{subject}-001",
                        message=f"建议使用规范术语「{standard_term}」替代「{variant}」",
                        location={"field": "stem"},
                        auto_fixable=True,
                        fix_suggestion=standard_term
                    ))

        return issues


class LogicCheckStage(QualityCheckStage):
    """逻辑一致性检查（题目与答案的一致性）"""

    async def check(self, content: dict, context: dict) -> List[QualityIssue]:
        issues = []
        answer = content.get("answer")
        stem = content.get("stem", "")
        explanation = content.get("explanation", "")

        if not answer:
            issues.append(QualityIssue(
                issue_id="logic-no-answer",
                severity="ERROR",
                category="LOGIC",
                rule_id="ANSWER-EXIST-001",
                message="题目缺少答案",
                location={},
                auto_fixable=False,
                fix_suggestion=None
            ))
            return issues

        # 如果有解析，验证解析逻辑是否推出相同答案
        if explanation:
            answer_verified = await self._verify_answer_from_explanation(
                stem, explanation, answer, context
            )
            if not answer_verified:
                issues.append(QualityIssue(
                    issue_id="logic-mismatch",
                    severity="ERROR",
                    category="LOGIC",
                    rule_id="ANSWER-VERIFY-001",
                    message="解析推导结果与标注答案不一致",
                    location={"field": "answer"},
                    auto_fixable=False,
                    fix_suggestion="请检查答案和解析的推导过程"
                ))

        return issues

    async def _verify_answer_from_explanation(
        self, stem: str, explanation: str, answer: str, context: dict
    ) -> bool:
        """使用 AI 验证解析推导是否与答案一致"""
        # 调用 AI 模型进行验证
        prompt = f"""
        题目：{stem}
        标注答案：{answer}
        解析过程：{explanation}

        请验证：解析的推导过程是否能正确得到标注的答案？
        只返回 true 或 false，并简要说明原因。
        """
        result = await self._call_verification_model(prompt)
        return result


class QualityCheckPipeline:
    """质量检查管线"""

    def __init__(self):
        self.stages: List[QualityCheckStage] = [
            FormatCheckStage(),       # 1. 格式检查（最快）
            TerminologyCheckStage(),  # 2. 术语检查
            LogicCheckStage(),        # 3. 逻辑检查（最慢，需要AI）
        ]

    async def run(self, content: dict, context: dict) -> dict:
        all_issues: List[QualityIssue] = []

        # 并行执行不依赖AI的检查
        fast_stages = [s for s in self.stages if not isinstance(s, LogicCheckStage)]
        slow_stages = [s for s in self.stages if isinstance(s, LogicCheckStage)]

        import asyncio
        fast_results = await asyncio.gather(
            *[stage.check(content, context) for stage in fast_stages]
        )
        for result in fast_results:
            all_issues.extend(result)

        # 如果快速检查发现 ERROR，跳过慢速检查
        has_blocking_error = any(i.severity == "ERROR" for i in all_issues)
        if not has_blocking_error:
            slow_results = await asyncio.gather(
                *[stage.check(content, context) for stage in slow_stages]
            )
            for result in slow_results:
                all_issues.extend(result)

        # 计算质量分
        score = self._calculate_score(all_issues)

        return {
            "overallScore": score,
            "issues": [issue.__dict__ for issue in all_issues],
            "passedChecks": self._get_passed_checks(all_issues)
        }

    @staticmethod
    def _calculate_score(issues: List[QualityIssue]) -> int:
        """根据问题数量和严重程度计算质量分"""
        base_score = 100
        deductions = {"ERROR": 15, "WARNING": 5, "INFO": 1}
        for issue in issues:
            base_score -= deductions.get(issue.severity, 0)
        return max(0, base_score)

    @staticmethod
    def _get_passed_checks(issues: List[QualityIssue]) -> List[str]:
        """获取通过的检查项"""
        all_checks = {"format_check", "terminology_check", "logic_check",
                      "typo_check", "consistency_check"}
        failed = {issue.category.lower() for issue in issues}
        return list(all_checks - failed)
```

### 5.4 AI 草稿生成流程

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class GenerationRequest:
    """内容生成请求"""
    instruction: str                    # 创作者自然语言指令
    content_type: str                   # QUESTION / EXPLANATION / TAG
    subject: str
    grade_range: str
    textbook_id: int
    knowledge_points: list[str]
    question_type: Optional[str] = None # CHOICE / FILL_BLANK / SHORT_ANSWER
    difficulty: Optional[str] = None    # EASY / MEDIUM / HARD
    reference_content_id: Optional[int] = None  # 参考的已有题目ID
    constraints: Optional[dict] = None  # 其他约束条件


class ContentDraftGenerator:
    """内容草稿生成器"""

    # 各场景的 Prompt 模板
    PROMPT_TEMPLATES = {
        "QUESTION_MULTIPLE_CHOICE": """
你是一位专业的{subject}教研专家。请根据以下要求生成一道选择题：

【学科】{subject}
【学段年级】{grade_range}
【知识点】{knowledge_points}
【难度】{difficulty}
【教材版本】{textbook_name}

要求：
1. 题干表述清晰、规范，符合{grade_range}学生认知水平
2. 提供4个选项（A/B/C/D）
3. 只有一个正确答案
4. 干扰项要有合理性，基于常见错误设计
5. 提供标准答案和详细解析
6. 解析要分步骤，逻辑清晰
7. 标注本题考察的知识点和能力维度

请以 JSON 格式输出：
{{
    "stem": "题干文本（LaTeX公式用$$包裹）",
    "options": [
        {{"key": "A", "text": "选项A"}},
        {{"key": "B", "text": "选项B"}},
        {{"key": "C", "text": "选项C"}},
        {{"key": "D", "text": "选项D"}}
    ],
    "answer": "正确答案字母",
    "explanation": "解析文本",
    "knowledge_points": ["知识点1", "知识点2"],
    "difficulty_estimate": 0.0-1.0的难度估计值,
    "cognitive_level": "记忆/理解/应用/分析/评价/创造"
}}
""",

        "EXPLANATION_DRAFT": """
你是一位专业的{subject}教研专家。请为以下题目撰写详细的解析：

【题目】
{question_stem}

【答案】
{answer}

【学段年级】{grade_range}

要求：
1. 解析要分步骤展开，每步标注「步骤N：」
2. 关键公式用 LaTeX 格式 $$包裹$$
3. 在适当位置标注「易错点提醒」
4. 最后总结本题的解题方法和思路
5. 语言要{age_appropriate_description}
""",

        "QUESTION_VARIANT": """
请基于以下原题，生成一道同知识点、同等难度但情境不同的变式题：

【原题】
{original_question}

【要求】
1. 保持知识点和难度一致
2. 更换题目情境和数据
3. 确保解题方法相似但答案不同
4. 输出格式与原题一致
"""
    }

    async def generate(self, request: GenerationRequest) -> dict:
        """生成内容草稿"""

        # 1. 构建 Prompt
        prompt = self._build_prompt(request)

        # 2. RAG 检索相关知识（确保内容准确性）
        rag_context = await self._retrieve_knowledge(request)

        # 3. 检查相似题（避免重复）
        similar_questions = await self._check_similar(request)

        # 4. 调用大模型生成
        raw_output = await self._call_model(prompt, rag_context)

        # 5. 解析和结构化
        draft = self._parse_output(raw_output)

        # 6. 自动质量检查
        quality = await self._auto_quality_check(draft, request)

        # 7. 附加警告信息
        warnings = []
        if similar_questions:
            warnings.append({
                "type": "SIMILAR_QUESTION_EXISTS",
                "message": f"题库中存在相似度 {similar_questions[0]['similarity']:.0%} 的题目",
                "similarQuestionId": similar_questions[0]["question_id"]
            })

        return {
            "draft": draft,
            "qualityReport": quality,
            "warnings": warnings
        }

    def _build_prompt(self, request: GenerationRequest) -> str:
        """根据请求构建 Prompt"""
        template_key = f"{request.content_type}_{
            request.question_type or 'DEFAULT'
        }"
        template = self.PROMPT_TEMPLATES.get(template_key, "")

        # 填充模板变量
        return template.format(
            subject=self._subject_name(request.subject),
            grade_range=request.grade_range,
            knowledge_points="、".join(request.knowledge_points),
            difficulty=request.difficulty or "中等",
            textbook_name=self._get_textbook_name(request.textbook_id),
            age_appropriate_description=self._age_description(request.grade_range),
        )

    async def _retrieve_knowledge(self, request: GenerationRequest) -> str:
        """从知识库检索相关知识"""
        # 调用 RAG 检索服务
        query = f"{' '.join(request.knowledge_points)} {request.subject} {request.grade_range}"
        # ... RAG retrieval logic
        return rag_context_text

    async def _check_similar(self, request: GenerationRequest) -> list:
        """检查题库中的相似题"""
        # 调用题目相似度服务
        # ... similarity check logic
        return similar_results

    async def _call_model(self, prompt: str, rag_context: str) -> str:
        """调用大模型"""
        full_prompt = f"{rag_context}\n\n{prompt}" if rag_context else prompt
        # 调用多模型调度服务
        response = await self._model_dispatcher.dispatch(
            prompt=full_prompt,
            task_type="CONTENT_GENERATION",
            preferred_models=["reasoning-model-v1", "general-model-v2"],
            temperature=0.7,
            max_tokens=2000
        )
        return response.content

    def _parse_output(self, raw_output: str) -> dict:
        """解析模型输出为结构化内容"""
        import json
        try:
            # 尝试直接解析 JSON
            return json.loads(raw_output)
        except json.JSONDecodeError:
            # 如果不是纯 JSON，尝试提取 JSON 块
            import re
            match = re.search(r'\{[\s\S]*\}', raw_output)
            if match:
                return json.loads(match.group())
            # 如果都无法解析，返回原始文本
            return {"raw_text": raw_output, "parse_error": True}
```

---

## 6. 状态流转

### 6.1 Copilot 会话状态机

```
                    ┌──────────┐
      create        │          │  timeout/expired
     ──────────────►│  ACTIVE  │────────────────►┌──────────┐
                    │          │                  │ EXPIRED  │
                    └────┬─────┘                  └──────────┘
                         │
              user close │     user complete
                    ┌────┴─────┐
                    ▼          ▼
              ┌──────────┐  ┌──────────┐
              │ABANDONED │  │ COMPLETED│
              └──────────┘  └──────────┘
```

### 6.2 建议生命周期

```
GENERATED → DELIVERED → [ACCEPTED | REJECTED | MODIFIED | IGNORED]
     │          │
     │          └── 30s 无操作 → EXPIRED
     │
     └── 生成失败 → FAILED
```

### 6.3 质量检查状态

```
PENDING → CHECKING → [PASSED | ISSUES_FOUND | CHECK_FAILED]
                         │            │
                         │            └── 创作者修复后 → RECHECKING → ...
                         │
                         └── 内容发布条件：无 ERROR 级别问题
```

---

## 7. 关键技术实现

### 7.1 WebSocket 长连接管理

```python
import asyncio
import json
from typing import Dict, Set

class CopilotWebSocketManager:
    """Copilot WebSocket 连接管理器"""

    def __init__(self):
        # session_id -> set of websocket connections
        self._connections: Dict[str, Set] = {}
        # session_id -> trigger manager
        self._triggers: Dict[str, SuggestionTriggerManager] = {}

    async def handle_connection(self, websocket, session_id: str):
        """处理 WebSocket 连接"""
        if session_id not in self._connections:
            self._connections[session_id] = set()
            self._triggers[session_id] = SuggestionTriggerManager(
                TriggerPolicy()
            )
        self._connections[session_id].add(websocket)

        try:
            async for message in websocket:
                data = json.loads(message)
                msg_type = data.get("type")

                if msg_type == "edit_event":
                    await self._handle_edit_event(websocket, session_id, data)
                elif msg_type == "accept_suggestion":
                    await self._handle_accept(session_id, data)
                elif msg_type == "reject_suggestion":
                    await self._handle_reject(session_id, data)

        except Exception as e:
            logger.error(f"WS error: {e}")
        finally:
            self._connections[session_id].discard(websocket)
            if not self._connections[session_id]:
                # 会话无活跃连接，清理资源
                await self._cleanup_session(session_id)

    async def _handle_edit_event(
        self, websocket, session_id: str, data: dict
    ):
        """处理编辑事件"""
        trigger = self._triggers[session_id]
        text = data.get("text", "")
        cursor = data.get("cursorPosition", 0)
        pause_ms = data.get("pauseDurationMs", 0)

        # 检查各类型建议是否应该触发
        suggestion_types = [
            "question_stem_autocomplete",
            "error_detection",
            "terminology_check",
        ]

        tasks = []
        for sug_type in suggestion_types:
            if trigger.should_trigger(sug_type, text, cursor, pause_ms):
                trigger.mark_triggered(sug_type)
                tasks.append(
                    self._generate_and_send_suggestion(
                        websocket, session_id, sug_type, data
                    )
                )

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _generate_and_send_suggestion(
        self, websocket, session_id: str, sug_type: str, edit_data: dict
    ):
        """生成并发送建议"""
        try:
            # 调用建议引擎
            suggestion = await self._suggestion_engine.generate(
                session_id=session_id,
                suggestion_type=sug_type,
                context=edit_data
            )

            if suggestion:
                await websocket.send(json.dumps({
                    "type": "suggestion",
                    "data": suggestion
                }, ensure_ascii=False))

        except Exception as e:
            logger.error(f"Suggestion generation error: {e}")
            # 静默失败，不影响创作者编辑体验
```

### 7.2 成本控制策略

```python
class CopilotCostController:
    """Copilot 成本控制器"""

    # 每日 Token 预算配置
    DAILY_BUDGET = {
        "QUESTION_AUTHOR": 50_000,      # 题目创作
        "EXPLANATION_WRITE": 80_000,    # 解析撰写
        "TAG_ANNOTATE": 20_000,         # 标注
        "REVIEW_CHECK": 30_000,         # 审核
    }

    # 模型优先级（便宜模型优先）
    MODEL_PRIORITY = [
        ("lightweight-model-v1", 0.5),   # 轻量任务
        ("general-model-v2", 1.0),        # 通用任务
        ("reasoning-model-v1", 3.0),      # 复杂推理
    ]

    async def check_budget(self, user_id: int, work_type: str) -> bool:
        """检查是否还有预算"""
        today = datetime.now().strftime("%Y-%m-%d")
        used = await self._get_daily_usage(user_id, today, work_type)
        budget = self.DAILY_BUDGET.get(work_type, 30_000)
        return used < budget

    async def select_model(self, task_type: str, complexity: float) -> str:
        """根据任务复杂度选择模型"""
        if complexity < 0.3:
            return self.MODEL_PRIORITY[0][0]  # 轻量模型
        elif complexity < 0.7:
            return self.MODEL_PRIORITY[1][0]  # 通用模型
        else:
            return self.MODEL_PRIORITY[2][0]  # 推理模型

    async def estimate_cost(self, task_type: str, input_tokens: int) -> int:
        """估算任务成本"""
        # 根据任务类型估算输出 token 数
        output_multiplier = {
            "autocomplete": 0.5,      # 补全：输出约为输入的50%
            "generate_draft": 3.0,     # 生成草稿：输出约为输入的3倍
            "quality_check": 1.0,      # 质量检查：1:1
        }
        multiplier = output_multiplier.get(task_type, 1.0)
        estimated_output = int(input_tokens * multiplier)
        return input_tokens + estimated_output
```

### 7.3 缓存策略

```python
class CopilotCacheManager:
    """Copilot 缓存管理器"""

    def __init__(self, redis_client):
        self.redis = redis_client

    # 建议 TTL 配置（秒）
    CACHE_TTL = {
        "suggestion": 300,           # 建议结果缓存5分钟
        "quality_check": 600,        # 质量检查结果缓存10分钟
        "knowledge_retrieval": 1800, # 知识检索结果缓存30分钟
        "similar_question": 3600,    # 相似题查询缓存1小时
    }

    async def get_cached_suggestion(
        self, suggestion_type: str, content_hash: str
    ) -> dict | None:
        """获取缓存的建议"""
        key = f"copilot:sug:{suggestion_type}:{content_hash}"
        cached = await self.redis.get(key)
        if cached:
            import json
            return json.loads(cached)
        return None

    async def cache_suggestion(
        self, suggestion_type: str, content_hash: str, suggestion: dict
    ):
        """缓存建议结果"""
        key = f"copilot:sug:{suggestion_type}:{content_hash}"
        ttl = self.CACHE_TTL.get("suggestion", 300)
        import json
        await self.redis.setex(key, ttl, json.dumps(suggestion, ensure_ascii=False))

    async def invalidate_for_content(self, content_id: int):
        """内容修改时使相关缓存失效"""
        pattern = f"copilot:sug:*:{content_id}*"
        keys = []
        async for key in self.redis.scan_iter(match=pattern):
            keys.append(key)
        if keys:
            await self.redis.delete(*keys)
```

---

## 8. 错误处理与降级策略

### 8.1 错误码定义

| 错误码 | HTTP | 含义 | 处理建议 |
| --- | --- | --- | --- |
| COPILOT_SESSION_NOT_FOUND | 404 | 会话不存在或已过期 | 提示用户重新创建会话 |
| COPILOT_SESSION_EXPIRED | 401 | 会话已过期 | 自动创建新会话 |
| COPILOT_BUDGET_EXCEEDED | 429 | 当日 Token 预算耗尽 | 提示用户明日再试或联系管理员 |
| COPILOT_MODEL_TIMEOUT | 504 | AI 模型响应超时 | 降级到轻量模型或返回缓存结果 |
| COPILOT_MODEL_ERROR | 502 | AI 模型返回错误 | 返回部分结果 + 错误提示 |
| COPILOT_RATE_LIMIT | 429 | 请求频率过高 | 增加去抖时间，降低请求频率 |
| COPILOT_CONTENT_TOO_LONG | 413 | 输入内容超出长度限制 | 提示用户分段处理 |
| COPILOT_INVALID_INSTRUCTION | 400 | 创作者指令无法理解 | 提供指令示例和模板 |

### 8.2 降级策略

```python
class CopilotFallbackChain:
    """Copilot 降级链"""

    async def get_suggestion_with_fallback(
        self, request: dict, context: dict
    ) -> dict | None:
        """带降级的建议获取"""

        fallback_steps = [
            # Step 1: 尝试主模型（推理模型）
            ("reasoning-model-v1", 3.0, 5000),

            # Step 2: 降级到通用模型
            ("general-model-v2", 1.0, 3000),

            # Step 3: 降级到轻量模型（快速但质量较低）
            ("lightweight-model-v1", 0.5, 1500),

            # Step 4: 尝试缓存
            ("cache_lookup", 0, 100),

            # Step 5: 返回规则建议（无AI）
            ("rule_based", 0, 50),
        ]

        for model, cost, timeout_ms in fallback_steps:
            try:
                if model == "cache_lookup":
                    result = await self._try_cache(request)
                elif model == "rule_based":
                    result = await self._rule_based_suggestion(request)
                else:
                    result = await self._call_model_with_timeout(
                        model, request, timeout_ms
                    )

                if result and self._is_valid_suggestion(result):
                    return result

            except asyncio.TimeoutError:
                logger.warning(f"Copilot model {model} timed out")
                continue
            except Exception as e:
                logger.error(f"Copilot model {model} error: {e}")
                continue

        # 所有降级方案都失败
        return None

    async def _rule_based_suggestion(self, request: dict) -> dict:
        """基于规则的建议（无 AI 依赖）"""
        suggestions = []

        # 基本格式检查
        text = request.get("text", "")
        if "  " in text:  # 双空格
            suggestions.append({
                "type": "format_check",
                "message": "检测到多余空格",
                "autoFixable": True
            })

        # 基本术语检查
        # ...

        return {"suggestions": suggestions} if suggestions else None
```

---

## 9. 安全与合规

### 9.1 权限控制

```python
# Copilot 功能权限矩阵
COPILOT_PERMISSIONS = {
    "CONTENT_CREATOR": [
        "copilot:sessions:create",
        "copilot:sessions:own:update",
        "copilot:suggest:request",
        "copilot:generate:draft",
        "copilot:check:quality",
        "copilot:feedback:submit",
    ],
    "CONTENT_REVIEWER": [
        "copilot:sessions:create",
        "copilot:check:quality",
        "copilot:generate:rewrite",
        "copilot:stats:view",
    ],
    "CONTENT_ADMIN": [
        "copilot:*",
        "copilot:rules:manage",
        "copilot:stats:all",
        "copilot:budget:adjust",
    ],
    "EXTERNAL_SUPPLIER": [
        "copilot:sessions:create",
        "copilot:suggest:request",
        "copilot:generate:draft",
        "copilot:check:quality",
        # 外部供应商不能查看全局统计
    ],
}
```

### 9.2 内容安全

- 所有 AI 生的内容必须经过安全过滤后才能展示给创作者
- 创作者采纳的建议在保存到内容库前仍需走标准内容审核流程
- AI 生成内容标记 `generated_by_ai: true`，便于后续溯源

### 9.3 成本控制

- 每个创作者每日有 Token 使用预算
- 超出预算后降级到规则检查模式
- 管理后台可调整预算配置和单模型配比

---

## 10. 监控指标

### 10.1 业务指标

| 指标名 | 说明 | 告警阈值 |
| --- | --- | --- |
| copilot.suggestion.accept_rate | 建议采纳率 | < 40% 告警 |
| copilot.suggestion.avg_latency_ms | 建议平均延迟 | > 2000ms 告警 |
| copilot.quality.error_detect_rate | 错误检出率 | < 60% 告警 |
| copilot.cost.daily_token_usage | 日 Token 消耗 | > 预算 90% 预警 |
| copilot.session.avg_duration_min | 平均会话时长 | - |
| copilot.content.quality_score_avg | 产出内容平均质量分 | < 75 告警 |

### 10.2 系统指标

| 指标名 | 说明 | 告警阈值 |
| --- | --- | --- |
| copilot.ws.active_connections | WebSocket 活跃连接数 | - |
| copilot.model.error_rate | 模型调用错误率 | > 5% 告警 |
| copilot.model.p99_latency_ms | 模型 P99 延迟 | > 5000ms 告警 |
| copilot.cache.hit_rate | 缓存命中率 | < 30% 告警 |
| copilot.fallback.trigger_rate | 降级触发率 | > 10% 告警 |

---

## 11. 与现有系统的集成关系

```
                    ┌─────────────────┐
                    │  Copilot Engine │
                    │   (本模块)       │
                    └───────┬─────────┘
                            │
           ┌────────────────┼────────────────┐
           ▼                ▼                ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │ 内容协同创作  │ │ 内容审核工作流│ │ 题库管理系统  │
    │  生产线引擎   │ │  与多级审核   │ │              │
    │     ←读取→   │ │    ←读取→    │ │   ←写入→    │
    └──────────────┘ └──────────────┘ └──────────────┘
           │                │                │
           ▼                ▼                ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │ RAG检索系统  │ │ 多模型调度层  │ │ 知识图谱系统  │
    │   ←检索→    │ │   ←调用→    │ │   ←查询→    │
    └──────────────┘ └──────────────┘ └──────────────┘
           │                │                │
           ▼                ▼                ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │ 题目相似度   │ │ 教育内容语义  │ │ 课标对齐系统  │
    │  计算服务    │ │  标签体系     │ │              │
    │   ←查询→    │ │   ←查询→    │ │   ←查询→    │
    └──────────────┘ └──────────────┘ └──────────────┘
```

### 集成接口清单

| 对接系统 | 调用方向 | 用途 |
| --- | --- | --- |
| 多模型调度与成本治理 | → 调用 | 统一的模型调用入口 |
| RAG 检索增强生成系统 | → 调用 | 检索教材知识点确保内容准确 |
| 知识图谱系统 | → 调用 | 查询知识点关联关系和前置依赖 |
| 题目相似度计算服务 | → 调用 | 检查生成内容与题库重复度 |
| 教育内容语义标签体系 | → 查询 | 获取学科术语规范 |
| 题库管理系统 | ← 写入 | 采纳的内容写入题库 |
| 内容审核工作流 | ← 触发 | 生成的内容进入审核流程 |
| 教育内容协同创作生产线 | ↔ 读写 | 与协同创作工作流集成 |
| 课标数据库 | → 查询 | 校验内容与课标对齐度 |
| 统一计费账单中心 | ← 上报 | 上报 Token 消耗 |

---

## 12. 部署与配置

### 12.1 服务配置

```yaml
copilot:
  service:
    name: copilot-engine
    port: 8400
    instances: 2              # 初始实例数
    max_instances: 8          # 最大扩容数

  websocket:
    max_connections: 500      # 单实例最大 WS 连接数
    heartbeat_interval: 30    # 心跳间隔（秒）
    idle_timeout: 300         # 空闲超时（秒）

  suggestion:
    debounce_ms: 300          # 建议去抖延迟
    max_concurrent: 3         # 单会话最大并发建议
    cooldown_ms: 500          # 同类型建议冷却时间
    cache_ttl_s: 300          # 建议缓存时间

  quality_check:
    enabled_stages:           # 启用的检查阶段
      - format
      - terminology
      - logic
      - consistency
    parallel_fast_checks: true
    skip_slow_on_error: true

  cost_control:
    daily_budget_per_user: 100000  # 每人每日 Token 预算
    alert_threshold: 0.85          # 预算预警阈值
    fallback_enabled: true         # 启用降级

  model:
    default_temperature: 0.7
    max_tokens: 2000
    timeout_s: 15
```

### 12.2 数据库与缓存

| 存储类型 | 用途 | 容量预估 |
| --- | --- | --- |
| MySQL | Copilot 会话、建议记录、规则配置 | 日均 5-10 万条记录 |
| Redis | 建议缓存、会话状态、去抖队列 | 2-4 GB |
| Elasticsearch | 建议反馈全文检索 | 按月归档 |

---

## 13. 演进规划

### Phase 1 (MVP)
- 基础会话管理 + RESTful API
- 题目编写建议（补全、选项生成）
- 基础质量检查（格式、术语）
- 成本控制和预算管理

### Phase 2 (V1.0)
- WebSocket 实时建议推送
- 解析撰写辅助（草稿生成、步骤补全）
- 逻辑一致性检查（AI 验证）
- 知识点智能标注
- 创作者使用统计面板

### Phase 3 (V1.5)
- 个性化建议（学习创作者偏好）
- 基于历史反馈的建议优化
- 批量内容辅助生产（批量检查、批量标注）
- 多人协作场景下的 Copilot 支持

### Phase 4 (V2.0+)
- Fine-tuned 专用模型（基于平台内容数据微调）
- 创作者画像和能力评估
- 内容质量预测模型
- 跨语言内容创作辅助
