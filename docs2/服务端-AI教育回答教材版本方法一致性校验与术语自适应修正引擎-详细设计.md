# 服务端-AI教育回答教材版本方法一致性校验与术语自适应修正引擎-详细设计

## 1. 概述

### 1.1 功能定位

本引擎是 AI 教育辅导质量保障体系的关键环节，负责对大模型生成的教育内容进行**教材版本一致性**与**课标方法符合性**的实时校验和自动修正。

在中国 K12 教育场景中，不同教材版本（人教版、苏教版、北师大版、外研版等）对同一知识点的讲解方法、术语定义、公式记法、解题路径存在显著差异。例如"分数加减法"在人教版中先教通分再运算，而苏教版可能先通过图示理解算理；又如向量表示，人教版用粗体 **a**，北师大版可能用 →。如果 AI 回答使用了与学生所学教材不一致的方法或术语，不仅会增加理解负担，还可能误导学生。

**核心职责：**

1. 识别 AI 回答中涉及的学科知识点和解题方法
2. 将其与学生所使用的教材版本和课程标准进行一致性比对
3. 检测术语偏差、方法偏差、记法偏差、进度偏差
4. 自动修正或标注不一致内容
5. 输出校验报告供下游质量监控使用

### 1.2 设计目标

| 目标 | 指标 |
| --- | --- |
| 方法不一致检出率 | ≥ 95%（对已知方法偏差模式） |
| 误报率（正确内容被标记） | ≤ 3% |
| 单次校验延迟 | ≤ 200ms（常规回答），≤ 500ms（复杂推导） |
| 自动修正覆盖率 | ≥ 70%（检出问题中可自动修正的比例） |
| 支持教材版本数 | ≥ 6 种主流版本（首期） |

### 1.3 适用范围

- AI 智能辅导对话的回答后处理管线
- 拍照搜题的解析生成后处理
- 同步课堂知识讲解内容生成
- 错题订正解析生成
- 理科解题步骤推导后处理
- 文科背诵辅助内容生成

### 1.4 术语定义

| 术语 | 说明 |
| --- | --- |
| 教材版本方法集 | 某教材版本对特定知识点的规定讲解方法、解题路径、公式记法集合 |
| 课标方法约束 | 国家课程标准对某知识点教学要求的约束性规定 |
| 术语映射表 | 同一概念在不同教材版本中的术语对应关系 |
| 方法偏差 | AI 回答使用的解题方法与学生教材版本规定方法不一致 |
| 记法偏差 | 数学/物理/化学公式中的符号记法与教材不一致 |
| 进度偏差 | AI 回答引入了学生当前年级尚未学习的概念或方法 |

---

## 2. 系统架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                     AI 回答后处理管线（上游）                          │
│                     (AI回答安全过滤 → 本引擎 → 适龄化处理)              │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│              教材版本方法一致性校验与自适应修正引擎                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ 知识点   │→│ 版本规则 │→│ 偏差检测 │→│ 自动修正 │           │
│  │ 提取器   │  │ 匹配器   │  │ 引擎     │  │ 生成器   │           │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘           │
│       │              │              │              │                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ 学科NLP  │  │ 教材版本 │  │ 偏差分类│  │ 修正策略 │           │
│  │ 解析模块 │  │ 方法知识库│  │ 与定级  │  │ 执行器   │           │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘           │
│       │              │              │              │                  │
│  ┌──────────────────────────────────────────────────────┐          │
│  │              校验报告生成与质量回流模块                   │          │
│  └──────────────────────────────────────────────────────┘          │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│              下游：SSE 流式输出 / 回答缓存 / 质量监控                  │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| 知识点提取器 | 从 AI 回答中提取涉及的学科、知识点、解题方法 | AI回答文本 + 学科上下文 | 知识点列表 + 方法签名 |
| 版本规则匹配器 | 根据学生教材版本加载对应方法规则集 | 知识点列表 + 学生教材版本 | 匹配的方法规则 + 术语映射 |
| 偏差检测引擎 | 逐条比对 AI 回答方法与教材方法规则 | 方法签名 + 方法规则 | 偏差列表（类型+位置+严重度） |
| 自动修正生成器 | 对偏差内容生成修正建议或自动替换 | AI回答 + 偏差列表 + 修正策略 | 修正后文本 + 修正标注 |
| 校验报告模块 | 生成结构化校验报告，回流至质量监控 | 全流程数据 | 校验报告 JSON |

### 2.3 在 AI 后处理管线中的位置

```
AI模型原始输出
    │
    ├─→ ① 安全过滤引擎（敏感词/不当内容拦截）
    │
    ├─→ ② 幻觉检测与事实校验引擎（知识准确性验证）
    │
    ├─→ ③ ★ 本引擎：教材版本方法一致性校验与修正 ★
    │
    ├─→ ④ 推理链完整性评估引擎（解题步骤校验）
    │
    ├─→ ⑤ 适龄化处理引擎（语言风格适配）
    │
    ├─→ ⑥ 知识点自动标注引擎（打标签+溯源）
    │
    └─→ ⑦ 格式化渲染引擎（Markdown/LaTeX 输出）
```

---

## 3. 数据结构定义

### 3.1 核心数据表

#### 3.1.1 教材版本方法规则表 `textbook_method_rules`

```sql
CREATE TABLE textbook_method_rules (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    rule_id         VARCHAR(64) NOT NULL UNIQUE COMMENT '规则唯一标识 RUL-XXXX',
    subject         VARCHAR(20) NOT NULL COMMENT '学科: math/physics/chem/bio/chinese/english/...',
    textbook_ver    VARCHAR(40) NOT NULL COMMENT '教材版本: PEP/JSBN/BNU/FLTRP/...',
    grade_stage     VARCHAR(20) NOT NULL COMMENT '学段: primary/junior/senior',
    grade           VARCHAR(20) NOT NULL COMMENT '年级: G1-G12',
    chapter_code    VARCHAR(64) NOT NULL COMMENT '章节编码',
    kp_code         VARCHAR(64) NOT NULL COMMENT '知识点编码',
    
    method_name     VARCHAR(200) NOT NULL COMMENT '方法名称',
    method_category ENUM('SOLVING','EXPLAINING','DEFINING','NOTATION','PROCEDURE') NOT NULL COMMENT '方法类型',
    method_signature TEXT NOT NULL COMMENT '方法签名JSON：描述该方法的特征模式',
    
    standard_terms  JSON NOT NULL COMMENT '标准术语列表',
    standard_notation JSON NOT NULL COMMENT '标准公式记法',
    forbidden_terms JSON COMMENT '禁止使用的术语（其他版本特有）',
    forbidden_methods JSON COMMENT '禁止使用的方法（超出课标或后续年级）',
    
    alternative_methods JSON COMMENT '可接受的替代方法列表',
    priority        TINYINT DEFAULT 50 COMMENT '优先级(0-100, 越高越重要)',
    
    status          TINYINT DEFAULT 1 COMMENT '1=有效 0=失效',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_subject_version (subject, textbook_ver, grade),
    INDEX idx_kp (kp_code, textbook_ver),
    INDEX idx_chapter (chapter_code, textbook_ver)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='教材版本方法规则表';
```

#### 3.1.2 术语映射表 `term_mapping`

```sql
CREATE TABLE term_mapping (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    subject         VARCHAR(20) NOT NULL,
    concept_code    VARCHAR(64) NOT NULL COMMENT '统一概念编码',
    concept_name    VARCHAR(200) NOT NULL COMMENT '概念通用名称',
    
    textbook_ver    VARCHAR(40) NOT NULL COMMENT '教材版本',
    term_text       VARCHAR(200) NOT NULL COMMENT '该版本中的术语文字',
    term_type       ENUM('TERM','NOTATION','SYMBOL','UNIT','ABBREV') NOT NULL,
    
    grade_introduced VARCHAR(20) COMMENT '该术语首次出现年级',
    
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_concept_version (concept_code, textbook_ver, term_type),
    INDEX idx_subject (subject, textbook_ver)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='术语映射表';
```

#### 3.1.3 校验记录表 `alignment_check_logs`

```sql
CREATE TABLE alignment_check_logs (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    check_id        VARCHAR(64) NOT NULL UNIQUE COMMENT '校验唯一标识 CHK-XXXX',
    session_id      VARCHAR(64) NOT NULL COMMENT 'AI对话会话ID',
    message_id      VARCHAR(64) NOT NULL COMMENT 'AI消息ID',
    user_id         BIGINT NOT NULL COMMENT '用户ID',
    
    student_grade   VARCHAR(20) NOT NULL COMMENT '学生年级',
    textbook_ver    VARCHAR(40) NOT NULL COMMENT '学生教材版本',
    subject         VARCHAR(20) NOT NULL COMMENT '学科',
    
    kp_codes        JSON NOT NULL COMMENT '涉及的知识点列表',
    deviations      JSON NOT NULL COMMENT '检测到的偏差列表',
    deviation_count INT DEFAULT 0 COMMENT '偏差数量',
    severity_max    TINYINT DEFAULT 0 COMMENT '最高严重度 0-3',
    
    auto_corrected  TINYINT DEFAULT 0 COMMENT '是否已自动修正 0=否 1=是',
    correction_details JSON COMMENT '修正详情',
    
    check_latency_ms INT COMMENT '校验耗时(毫秒)',
    rule_version    VARCHAR(32) NOT NULL COMMENT '规则库版本',
    
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_user (user_id, created_at),
    INDEX idx_session (session_id),
    INDEX idx_severity (severity_max, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='一致性校验记录表';
```

#### 3.1.4 方法偏差模式库 `deviation_patterns`

```sql
CREATE TABLE deviation_patterns (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    pattern_id      VARCHAR(64) NOT NULL UNIQUE COMMENT 'DVP-XXXX',
    subject         VARCHAR(20) NOT NULL,
    pattern_type    ENUM('METHOD','TERM','NOTATION','PROGRESS','PROCEDURE') NOT NULL,
    pattern_name    VARCHAR(200) NOT NULL,
    
    detection_regex TEXT COMMENT '正则检测模式',
    detection_rules JSON NOT NULL COMMENT '结构化检测规则',
    
    severity_level  TINYINT NOT NULL COMMENT '严重度 1=提示 2=警告 3=严重',
    auto_fixable    TINYINT DEFAULT 0 COMMENT '是否可自动修正',
    fix_strategy    VARCHAR(100) COMMENT '修正策略标识',
    fix_template    TEXT COMMENT '修正模板',
    
    affected_versions JSON NOT NULL COMMENT '受影响的教材版本列表',
    description     TEXT,
    
    status          TINYINT DEFAULT 1,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_subject_type (subject, pattern_type),
    INDEX idx_pattern_id (pattern_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='方法偏差模式库';
```

### 3.2 核心数据模型

#### 3.2.1 方法签名模型 `MethodSignature`

```java
/**
 * 方法签名 - 描述 AI 回答中使用的方法特征
 */
@Data
@Builder
public class MethodSignature {
    /** 学科 */
    private String subject;
    
    /** 涉及的知识点编码列表 */
    private List<String> knowledgePointCodes;
    
    /** 检测到的方法关键词列表 */
    private List<MethodKeyword> methodKeywords;
    
    /** 检测到的公式/符号记法列表 */
    private List<NotationToken> notationTokens;
    
    /** 检测到的解题步骤模式 */
    private List<String> solvingProcedureSteps;
    
    /** 方法分类标签 */
    private List<String> methodTags;
    
    /** 置信度分数 0-1 */
    private double confidence;
}

@Data
@Builder
public class MethodKeyword {
    /** 关键词文本 */
    private String text;
    /** 在回答中的位置（字符偏移） */
    private int startPos;
    private int endPos;
    /** 关键词类型 */
    private KeywordType type; // TERM, METHOD_NAME, PROCEDURE, CONCEPT
}

@Data
@Builder
public class NotationToken {
    /** 符号/记法文本 */
    private String notation;
    /** LaTeX 表示 */
    private String latex;
    /** 位置 */
    private int startPos;
    private int endPos;
    /** 记法类型 */
    private NotationType type; // VECTOR, FUNCTION, OPERATOR, UNIT, VARIABLE
}
```

#### 3.2.2 偏差检测结果模型 `DeviationResult`

```java
/**
 * 偏差检测结果
 */
@Data
@Builder
public class DeviationResult {
    /** 偏差列表 */
    private List<Deviation> deviations;
    
    /** 总体一致性分数 0-100 */
    private double alignmentScore;
    
    /** 是否通过校验 */
    private boolean passed;
    
    /** 最高严重度 */
    private int maxSeverity;
    
    /** 校验耗时(ms) */
    private long latencyMs;
    
    /** 规则库版本 */
    private String ruleVersion;
}

@Data
@Builder
public class Deviation {
    /** 偏差ID */
    private String id;
    
    /** 偏差类型 */
    private DeviationType type;
    // METHOD    - 解题方法不一致
    // TERM      - 术语使用不一致
    // NOTATION  - 公式记法不一致
    // PROGRESS  - 涉及未学概念
    // PROCEDURE - 解题步骤顺序不一致
    
    /** 严重度 1=提示 2=警告 3=严重 */
    private int severity;
    
    /** 偏差描述 */
    private description;
    
    /** 偏差位置 */
    private DeviationLocation location;
    
    /** 期望内容（教材版本的标准方法） */
    private String expectedContent;
    
    /** 实际内容（AI 回答中的内容） */
    private String actualContent;
    
    /** 修正建议 */
    private CorrectionSuggestion suggestion;
    
    /** 关联知识点 */
    private String knowledgePointCode;
    
    /** 关联规则ID */
    private String ruleId;
}

@Data
@Builder
public class DeviationLocation {
    /** 起始字符位置 */
    private int startPos;
    /** 结束字符位置 */
    private int endPos;
    /** 所在段落索引 */
    private int paragraphIndex;
    /** 原文片段 */
    private String snippet;
}

@Data
@Builder
public class CorrectionSuggestion {
    /** 修正类型 */
    private CorrectionType type;
    // REPLACE     - 直接替换
    // REPHRASE    - 改写
    // ADD_NOTE    - 添加注释说明
    // RESTRUCTURE - 重构步骤
    // MANUAL      - 需人工处理
    
    /** 修正后内容 */
    private String correctedText;
    
    /** 给学生的提示注释 */
    private String studentNote;
    
    /** 修正置信度 0-1 */
    private double confidence;
}
```

#### 3.2.3 校验报告模型 `AlignmentCheckReport`

```java
/**
 * 校验报告 - 输出给质量监控系统
 */
@Data
@Builder
public class AlignmentCheckReport {
    private String checkId;
    private String sessionId;
    private String messageId;
    private Long userId;
    
    private String studentGrade;
    private String textbookVersion;
    private String subject;
    
    private List<String> knowledgePointCodes;
    
    private DeviationResult deviationResult;
    private CorrectionResult correctionResult;
    
    private long checkLatencyMs;
    private String ruleVersion;
    private LocalDateTime checkTime;
    
    /** 元数据 */
    private Map<String, String> metadata;
}
```

---

## 4. API 接口设计

### 4.1 核心校验接口

#### POST `/api/v1/alignment/check`

对 AI 回答进行教材版本方法一致性校验。

**请求体：**

```json
{
  "content": "要使得两个分数相加，首先找到它们的最小公倍数...",
  "subject": "math",
  "studentGrade": "G5",
  "textbookVersion": "PEP",
  "sessionId": "SES-20260804-001",
  "messageId": "MSG-20260804-001-003",
  "userId": 10086,
  "context": {
    "chapterCode": "MATH-PEP-G5-U3",
    "kpCodes": ["KP-FRACTION-ADD", "KP-LCM"],
    "questionType": "solving",
    "originalQuestion": "计算 1/3 + 1/4"
  },
  "options": {
    "autoCorrect": true,
    "severityThreshold": 2,
    "maxLatencyMs": 300
  }
}
```

**响应体：**

```json
{
  "code": 0,
  "data": {
    "checkId": "CHK-20260804-000001",
    "passed": false,
    "alignmentScore": 72.5,
    "maxSeverity": 2,
    "deviations": [
      {
        "id": "DEV-001",
        "type": "METHOD",
        "severity": 2,
        "description": "AI回答使用了'最小公倍数'概念进行通分，但人教版五年级上册该章节尚未正式引入'最小公倍数'术语，应使用'公分母'进行讲解",
        "location": {
          "startPos": 12,
          "endPos": 20,
          "paragraphIndex": 0,
          "snippet": "找到它们的最小公倍数"
        },
        "expectedContent": "找到它们的公分母（即两个分母的公倍数）",
        "actualContent": "找到它们的最小公倍数",
        "suggestion": {
          "type": "REPLACE",
          "correctedText": "找到它们的公分母",
          "studentNote": null,
          "confidence": 0.95
        },
        "knowledgePointCode": "KP-FRACTION-ADD",
        "ruleId": "RUL-MATH-PEP-G5-001"
      },
      {
        "id": "DEV-002",
        "type": "NOTATION",
        "severity": 1,
        "description": "公式中使用了分数线斜杠表示法 'a/b'，人教版教材中统一使用竖式分数表示",
        "location": {
          "startPos": 45,
          "endPos": 48,
          "paragraphIndex": 1,
          "snippet": "1/3 + 1/4"
        },
        "expectedContent": "³⁄₁₃ + ¹⁄₄（竖式分数）",
        "actualContent": "1/3 + 1/4",
        "suggestion": {
          "type": "REPLACE",
          "correctedText": "\\frac{1}{3} + \\frac{1}{4}",
          "studentNote": null,
          "confidence": 0.98
        },
        "knowledgePointCode": "KP-FRACTION-ADD",
        "ruleId": "RUL-MATH-PEP-G5-002"
      }
    ],
    "correctedContent": "要使得两个分数相加，首先找到它们的公分母...",
    "correctionCount": 2,
    "latencyMs": 87
  }
}
```

### 4.2 批量校验接口

#### POST `/api/v1/alignment/check/batch`

批量校验多条 AI 回答（用于异步场景或离线质检）。

**请求体：**

```json
{
  "items": [
    {
      "content": "...",
      "subject": "math",
      "studentGrade": "G5",
      "textbookVersion": "PEP",
      "messageId": "MSG-001",
      "context": { ... }
    },
    ...
  ],
  "options": {
    "autoCorrect": false,
    "severityThreshold": 2
  }
}
```

### 4.3 规则查询接口

#### GET `/api/v1/alignment/rules`

查询指定教材版本的方法规则集。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| subject | string | 是 | 学科 |
| textbookVersion | string | 是 | 教材版本 |
| grade | string | 否 | 年级筛选 |
| chapterCode | string | 否 | 章节筛选 |
| kpCode | string | 否 | 知识点筛选 |

### 4.4 偏差统计接口

#### GET `/api/v1/alignment/stats/deviations`

查询偏差统计数据，供质量监控使用。

**参数：**

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| startDate | string | 开始日期 |
| endDate | string | 结束日期 |
| subject | string | 学科 |
| textbookVersion | string | 教材版本 |
| groupBy | string | 聚合维度: subject/version/grade/deviationType |

### 4.5 术语映射查询接口

#### GET `/api/v1/alignment/terms/mapping`

查询指定概念在不同教材版本间的术语映射。

**参数：**

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| subject | string | 学科 |
| conceptCode | string | 概念编码 |
| fromVersion | string | 源教材版本 |
| toVersion | string | 目标教材版本 |

---

## 5. 核心算法与处理流程

### 5.1 整体处理流程

```
输入: AI回答文本 + 学生上下文(年级/教材版本/学科/知识点)
  │
  ├──→ Step 1: 文本预处理 & LaTeX解析
  │         - Markdown/LaTeX 结构化解析
  │         - 段落、公式、代码块分离
  │
  ├──→ Step 2: 知识点与方法提取
  │         - 学科 NLP 实体识别
  │         - 方法关键词匹配
  │         - 公式/记法 Token 提取
  │         - 解题步骤模式识别
  │
  ├──→ Step 3: 教材版本规则匹配
  │         - 加载该版本对应知识点的方法规则
  │         - 加载术语映射表
  │         - 加载年级进度约束
  │
  ├──→ Step 4: 偏差检测（多维度并行）
  │         ├── 4a. 方法一致性检测
  │         ├── 4b. 术语一致性检测
  │         ├── 4c. 记法一致性检测
  │         ├── 4d. 进度合规性检测
  │         └── 4e. 步骤顺序一致性检测
  │
  ├──→ Step 5: 偏差定级与排序
  │         - 按严重度分级 (1/2/3)
  │         - 按置信度排序
  │         - 去重与冲突消解
  │
  ├──→ Step 6: 自动修正
  │         ├── 可自动修正 → 执行替换/改写
  │         ├── 需添加注释 → 插入说明
  │         └── 需人工处理 → 标记上报
  │
  ├──→ Step 7: 一致性评分
  │         - 综合偏差数量、严重度计算分数
  │
  └──→ Step 8: 输出校验结果 + 修正后内容 + 校验报告
```

### 5.2 知识点与方法提取算法

```python
class MethodExtractor:
    """
    从 AI 回答中提取知识点和解题方法
    """
    
    def __init__(self, nlp_model, kp_index, method_index):
        self.nlp = nlp_model              # 学科专用 NER 模型
        self.kp_index = kp_index          # 知识点索引（倒排）
        self.method_index = method_index  # 方法关键词索引
    
    def extract(self, content: str, subject: str, context: dict) -> MethodSignature:
        # 1. 文本结构化解析
        structured = self._parse_structure(content)
        # structured = {
        #   'paragraphs': [...],
        #   'formulas': [...],      # LaTeX 公式列表
        #   'steps': [...],         # 识别的解题步骤
        #   'lists': [...],         # 列表/枚举
        #   'tables': [...]
        # }
        
        # 2. 学科 NER 实体识别
        entities = self.nlp.recognize(content, subject)
        # entities = [{'text': '通分', 'type': 'METHOD', 'pos': [12,14]}, ...]
        
        # 3. 知识点匹配
        kp_codes = self._match_knowledge_points(entities, context.get('kpCodes', []))
        
        # 4. 方法关键词提取
        method_keywords = self._extract_method_keywords(entities, structured)
        
        # 5. 公式记法提取
        notations = self._extract_notations(structured['formulas'])
        
        # 6. 解题步骤模式识别
        procedure = self._identify_procedure_pattern(structured['steps'])
        
        return MethodSignature(
            subject=subject,
            knowledgePointCodes=kp_codes,
            methodKeywords=method_keywords,
            notationTokens=notations,
            solvingProcedureSteps=procedure,
            methodTags=self._generate_tags(method_keywords, procedure),
            confidence=self._calculate_confidence(entities, kp_codes)
        )
    
    def _parse_structure(self, content: str) -> dict:
        """
        解析 AI 回答的结构化内容
        - Markdown 段落分割
        - LaTeX 公式提取 ($...$, $$...$$)
        - 编号步骤识别 (Step 1, 步骤一, 首先...然后...)
        """
        result = {'paragraphs': [], 'formulas': [], 'steps': [], 'lists': [], 'tables': []}
        
        # 段落分割
        paragraphs = content.split('\n\n')
        result['paragraphs'] = paragraphs
        
        # LaTeX 公式提取
        formula_pattern = r'\$\$(.+?)\$\$|\$(.+?)\$'
        result['formulas'] = re.findall(formula_pattern, content)
        
        # 编号步骤识别
        step_patterns = [
            r'(?:步骤|Step)\s*[一二三四五六七八九十\d]+[：:](.+?)(?=步骤|Step|$)',
            r'(?:首先|然后|接着|最后|第二步|第三步)[，,](.+?)(?=首先|然后|接着|最后|第\d步|$)'
        ]
        for pattern in step_patterns:
            result['steps'].extend(re.findall(pattern, content, re.DOTALL))
        
        return result
    
    def _match_knowledge_points(self, entities, hint_kps):
        """将识别到的实体匹配到知识点编码"""
        kp_scores = defaultdict(float)
        for ent in entities:
            kps = self.kp_index.search(ent['text'], ent['type'])
            for kp_code, score in kps:
                kp_scores[kp_code] += score
        # 加权上下文提示的知识点
        for hint in hint_kps:
            if hint in kp_scores:
                kp_scores[hint] *= 1.5
        return sorted(kp_scores.keys(), key=lambda k: -kp_scores[k])[:10]
    
    def _extract_method_keywords(self, entities, structured):
        """提取方法关键词"""
        keywords = []
        for ent in entities:
            if ent['type'] in ('METHOD', 'PROCEDURE', 'TERM'):
                keywords.append(MethodKeyword(
                    text=ent['text'],
                    startPos=ent['pos'][0],
                    endPos=ent['pos'][1],
                    type=KeywordType[ent['type']]
                ))
        return keywords
    
    def _extract_notations(self, formulas):
        """从 LaTeX 公式中提取记法 Token"""
        notations = []
        for i, formula in enumerate(formulas):
            tokens = self._tokenize_latex(formula)
            for tok in tokens:
                notations.append(NotationToken(
                    notation=tok['text'],
                    latex=tok['latex'],
                    startPos=tok['pos'],
                    endPos=tok['pos'] + len(tok['text']),
                    type=tok['type']
                ))
        return notations
    
    def _tokenize_latex(self, latex: str) -> list:
        """解析 LaTeX 公式中的符号 Token"""
        tokens = []
        # 向量表示: \vec{}, \boldsymbol{}, \mathbf{}
        # 分数: \frac{}{}
        # 运算符: \times, \div, \cdot
        # 下标/上标: _{}, ^{}
        patterns = [
            (r'\\vec\{([^}]+)\}', 'VECTOR'),
            (r'\\boldsymbol\{([^}]+)\}', 'VECTOR'),
            (r'\\mathbf\{([^}]+)\}', 'VECTOR'),
            (r'\\frac\{([^}]+)\}\{([^}]+)\}', 'FRACTION'),
            (r'\\times', 'OPERATOR'),
            (r'\\div', 'OPERATOR'),
            (r'\\cdot', 'OPERATOR'),
        ]
        for pattern, ntype in patterns:
            for m in re.finditer(pattern, latex):
                tokens.append({
                    'text': m.group(),
                    'latex': m.group(),
                    'pos': m.start(),
                    'type': ntype
                })
        return tokens
### 5.3 偏差检测算法

#### 5.3.1 方法一致性检测

```python
class MethodConsistencyChecker:
    """检测 AI 回答使用的解题方法是否与教材版本一致"""
    
    def check(self, signature: MethodSignature, 
              rules: List[TextbookMethodRule]) -> List[Deviation]:
        deviations = []
        
        for rule in rules:
            if rule.method_category == 'SOLVING':
                # 检查 AI 是否使用了该方法
                used = self._is_method_used(signature, rule)
                expected = self._is_method_expected(signature, rule)
                
                if rule.forbidden_methods:
                    # 检查是否使用了禁止方法
                    for forbidden in rule.forbidden_methods:
                        if self._method_matches(signature, forbidden):
                            deviations.append(self._create_deviation(
                                type='METHOD',
                                severity=3,
                                rule=rule,
                                expected=rule.method_name,
                                actual=forbidden['name'],
                                description=f"使用了教材未涉及的方法: {forbidden['name']}"
                            ))
                
                # 检查方法步骤顺序
                if rule.method_signature.get('procedure'):
                    proc_deviation = self._check_procedure_order(
                        signature.solvingProcedureSteps,
                        rule.method_signature['procedure'],
                        rule
                    )
                    if proc_deviation:
                        deviations.append(proc_deviation)
        
        return deviations
    
    def _is_method_used(self, signature, rule):
        """判断 AI 回答是否使用了某个方法"""
        method_tags = set(signature.methodTags)
        rule_tags = set(rule.method_signature.get('tags', []))
        return len(method_tags & rule_tags) > 0
    
    def _check_procedure_order(self, actual_steps, expected_steps, rule):
        """检查解题步骤顺序"""
        if len(actual_steps) < len(expected_steps):
            return None  # 步骤可能不完整，由其他检测器处理
        
        # 计算步骤序列相似度
        similarity = self._sequence_similarity(actual_steps, expected_steps)
        if similarity < 0.6:
            return Deviation(
                type=DeviationType.PROCEDURE,
                severity=2,
                description=f"解题步骤顺序与教材方法不一致 (相似度: {similarity:.0%})",
                ruleId=rule.rule_id
            )
        return None
```

#### 5.3.2 术语一致性检测

```python
class TermConsistencyChecker:
    """检测术语使用是否与教材版本一致"""
    
    def check(self, content: str, signature: MethodSignature,
              term_mappings: List[TermMapping], 
              student_version: str) -> List[Deviation]:
        deviations = []
        
        # 构建术语查找索引
        version_terms = {}  # term_text -> TermMapping
        other_version_terms = {}  # term_text -> (concept_code, source_version)
        
        for tm in term_mappings:
            if tm.textbook_ver == student_version:
                version_terms[tm.term_text.lower()] = tm
            else:
                other_version_terms[tm.term_text.lower()] = (tm.concept_code, tm.textbook_ver)
        
        # 检查 AI 回答中的每个术语关键词
        for kw in signature.methodKeywords:
            if kw.type != KeywordType.TERM:
                continue
            
            kw_lower = kw.text.lower()
            
            # 情况1: 该术语在学生版本中存在 -> OK
            if kw_lower in version_terms:
                continue
            
            # 情况2: 该术语在其他版本中存在 -> 术语偏差
            if kw_lower in other_version_terms:
                concept_code, src_ver = other_version_terms[kw_lower]
                # 查找该概念在学生版本中的对应术语
                correct_term = self._find_term_for_concept(
                    concept_code, student_version, term_mappings
                )
                if correct_term:
                    deviations.append(Deviation(
                        type=DeviationType.TERM,
                        severity=2,
                        description=f"术语'{kw.text}'为{src_ver}教材用法，"
                                  f"本教材({student_version})中应使用'{correct_term}'",
                        location=DeviationLocation(
                            startPos=kw.startPos,
                            endPos=kw.endPos,
                            snippet=kw.text
                        ),
                        expectedContent=correct_term,
                        actualContent=kw.text,
                        suggestion=CorrectionSuggestion(
                            type=CorrectionType.REPLACE,
                            correctedText=correct_term,
                            confidence=0.95
                        )
                    ))
        
        return deviations
```

#### 5.3.3 进度合规性检测

```python
class ProgressComplianceChecker:
    """检测 AI 回答是否引入了学生尚未学习的概念"""
    
    def check(self, signature: MethodSignature,
              student_grade: str, textbook_version: str,
              grade_sequence: List[str]) -> List[Deviation]:
        """
        grade_sequence: ['G1','G2',...,'G12']
        """
        deviations = []
        student_grade_idx = grade_sequence.index(student_grade)
        
        for kw in signature.methodKeywords:
            if kw.type not in (KeywordType.TERM, KeywordType.CONCEPT):
                continue
            
            # 查找该术语首次出现的年级
            introduced_grade = self._get_grade_introduced(
                kw.text, textbook_version
            )
            if introduced_grade is None:
                continue
            
            introduced_idx = grade_sequence.index(introduced_grade)
            if introduced_idx > student_grade_idx:
                # 该概念在学生当前年级之后才出现
                deviations.append(Deviation(
                    type=DeviationType.PROGRESS,
                    severity=2,
                    description=f"概念'{kw.text}'通常在{introduced_grade}才学习，"
                              f"当前学生为{student_grade}，可能造成理解困难",
                    location=DeviationLocation(
                        startPos=kw.startPos,
                        endPos=kw.endPos,
                        snippet=kw.text
                    ),
                    suggestion=CorrectionSuggestion(
                        type=CorrectionType.ADD_NOTE,
                        correctedText=kw.text,
                        studentNote=f"（{kw.text}是一个后续会学到的概念，"
                                  f"这里只需了解它的结论即可）",
                        confidence=0.8
                    )
                ))
        
        return deviations
```

#### 5.3.4 记法一致性检测

```python
class NotationConsistencyChecker:
    """检测公式记法是否与教材版本一致"""
    
    # 各版本记法偏好配置
    NOTATION_PREFERENCES = {
        'PEP': {  # 人教版
            'vector': 'bold',        # 粗体 a
            'fraction': 'vertical',  # 竖式分数
            'multiply': 'times',     # ×
            'angle_unit': 'degree',  # 角度制优先
        },
        'BNU': {  # 北师大版
            'vector': 'arrow',       # 箭头 →
            'fraction': 'vertical',
            'multiply': 'times',
            'angle_unit': 'degree',
        },
        # ...
    }
    
    def check(self, notations: List[NotationToken],
              student_version: str) -> List[Deviation]:
        deviations = []
        prefs = self.NOTATION_PREFERENCES.get(student_version, {})
        
        for notation in notations:
            if notation.type == 'VECTOR':
                expected_style = prefs.get('vector', 'bold')
                actual_style = self._detect_vector_style(notation.latex)
                if actual_style != expected_style:
                    correct_latex = self._generate_vector_latex(
                        notation.notation, expected_style
                    )
                    deviations.append(Deviation(
                        type=DeviationType.NOTATION,
                        severity=1,
                        description=f"向量记法风格不一致，本教材使用"
                                  f"{self._style_name(expected_style)}表示",
                        location=DeviationLocation(
                            startPos=notation.startPos,
                            endPos=notation.endPos,
                            snippet=notation.notation
                        ),
                        expectedContent=correct_latex,
                        actualContent=notation.latex,
                        suggestion=CorrectionSuggestion(
                            type=CorrectionType.REPLACE,
                            correctedText=correct_latex,
                            confidence=0.9
                        )
                    ))
        
        return deviations
```

### 5.4 自动修正引擎

```python
class AutoCorrectionEngine:
    """对检测到偏差的内容执行自动修正"""
    
    def correct(self, content: str, 
                deviations: List[Deviation]) -> CorrectionResult:
        """
        按位置从后往前修正（避免位置偏移）
        """
        # 按位置排序，从后往前处理
        sorted_devs = sorted(
            [d for d in deviations if d.suggestion and d.suggestion.confidence >= 0.7],
            key=lambda d: -(d.location.startPos)
        )
        
        corrected = content
        applied = []
        
        for dev in sorted_devs:
            suggestion = dev.suggestion
            
            if suggestion.type == CorrectionType.REPLACE:
                old_text = corrected[dev.location.startPos:dev.location.endPos]
                new_text = suggestion.correctedText
                corrected = (
                    corrected[:dev.location.startPos] + 
                    new_text + 
                    corrected[dev.location.endPos:]
                )
                applied.append({
                    'deviationId': dev.id,
                    'type': 'REPLACE',
                    'before': old_text,
                    'after': new_text,
                    'position': dev.location.startPos
                })
            
            elif suggestion.type == CorrectionType.ADD_NOTE:
                insert_pos = dev.location.endPos
                note = f" {suggestion.studentNote}"
                corrected = (
                    corrected[:insert_pos] + 
                    note + 
                    corrected[insert_pos:]
                )
                applied.append({
                    'deviationId': dev.id,
                    'type': 'ADD_NOTE',
                    'note': suggestion.studentNote,
                    'position': insert_pos
                })
            
            elif suggestion.type == CorrectionType.REPHRASE:
                # 使用 NLP 模型进行改写
                rephrased = self._rephrase_with_model(
                    corrected, dev.location, suggestion
                )
                corrected = (
                    corrected[:dev.location.startPos] + 
                    rephrased + 
                    corrected[dev.location.endPos:]
                )
                applied.append({
                    'deviationId': dev.id,
                    'type': 'REPHRASE',
                    'before': dev.location.snippet,
                    'after': rephrased
                })
        
        return CorrectionResult(
            correctedContent=corrected,
            appliedCorrections=applied,
            uncorrectedCount=len(deviations) - len(applied)
        )
```

---

## 6. 状态流转

### 6.1 校验任务状态机

```
                    ┌─────────┐
                    │ PENDING │ (等待校验)
                    └────┬────┘
                         │ 开始校验
                         ▼
                    ┌─────────┐
              ┌─────│CHECKING │ (校验中)
              │     └────┬────┘
              │          │
     超时     │    ┌─────┴──────┐
              │    │            │
              ▼    ▼            ▼
        ┌──────────┐    ┌───────────┐
        │ TIMEOUT  │    │ DETECTED  │ (发现偏差)
        └──────────┘    └─────┬─────┘
                              │
                   ┌──────────┴──────────┐
                   │                     │
                   ▼                     ▼
            ┌────────────┐       ┌────────────┐
            │ CORRECTING │       │  PASSED    │ (无偏差通过)
            │ (自动修正)  │       └────────────┘
            └──────┬─────┘
                   │
          ┌────────┴────────┐
          │                 │
          ▼                 ▼
    ┌──────────┐     ┌───────────┐
    │CORRECTED │     │ PARTIAL   │ (部分修正)
    │ (完全修正)│     │ (剩余需人工)│
    └──────────┘     └───────────┘
```

### 6.2 偏差处理决策流

```
偏差检出
    │
    ├── 严重度 = 3 (严重)
    │       └──→ 阻断输出, 触发重新生成 或 人工接管
    │
    ├── 严重度 = 2 (警告)
    │       ├── 可自动修正(置信度≥0.8) → 自动修正后输出
    │       ├── 可自动修正(置信度<0.8) → 添加注释后输出 + 上报
    │       └── 不可自动修正 → 添加警示标注后输出 + 上报
    │
    └── 严重度 = 1 (提示)
            ├── 可自动修正 → 静默修正
            └── 不可修正 → 忽略 (记录但不处理)
```

---

## 7. 错误处理与降级策略

### 7.1 错误码定义

| 错误码 | 说明 | 处理策略 |
| --- | --- | --- |
| ALIGN_001 | 规则库加载失败 | 降级为跳过校验，放行原始内容 |
| ALIGN_002 | NLP 模型推理异常 | 降级为仅规则匹配（无 NER） |
| ALIGN_003 | 校验超时 (>500ms) | 返回超时前已完成的检测结果 |
| ALIGN_004 | 修正引擎异常 | 放行未修正内容，记录偏差日志 |
| ALIGN_005 | 术语映射缺失 | 跳过术语检查，记录缺失概念 |
| ALIGN_006 | 知识点匹配为空 | 跳过方法检查，仅做通用检测 |

### 7.2 降级策略

```python
class AlignmentCheckService:
    
    def check_with_fallback(self, request: CheckRequest) -> CheckResponse:
        try:
            # 主流程：完整校验
            return self._full_check(request)
        except ModelInferenceError:
            # 降级1：仅规则匹配，跳过 NLP
            return self._rule_only_check(request)
        except TimeoutError:
            # 降级2：返回部分结果
            return self._partial_check_result(request)
        except RuleLoadError:
            # 降级3：跳过校验，放行
            return CheckResponse(
                checkId=generate_id(),
                passed=True,
                alignmentScore=100.0,
                deviations=[],
                degraded=True,
                degradedReason="规则库不可用，跳过校验"
            )
        except Exception:
            # 最终兜底：不阻断正常输出
            return CheckResponse(
                checkId=generate_id(),
                passed=True,
                alignmentScore=100.0,
                deviations=[],
                degraded=True,
                degradedReason="校验服务异常"
            )
```

### 7.3 核心原则

> **永远不阻断正常输出**：本引擎的任何异常都不应阻止 AI 回答送达学生。
> 质量问题通过事后监控和告警处理，不牺牲可用性。

---

## 8. 缓存策略

### 8.1 多级缓存设计

```
┌────────────────────────────────────────────────┐
│              请求级缓存 (Request Cache)          │
│   Key: hash(content + subject + version + grade)│
│   TTL: 1小时                                     │
│   命中率预估: 15-25% (相似问题复用)               │
├────────────────────────────────────────────────┤
│              规则级缓存 (Rule Cache)             │
│   Key: subject + textbook_version + grade       │
│   TTL: 30分钟 (配置变更时主动失效)                 │
│   存储: Redis Hash                               │
├────────────────────────────────────────────────┤
│              术语映射缓存 (Term Mapping Cache)   │
│   Key: subject + concept_code + version         │
│   TTL: 24小时                                    │
│   存储: 本地 Caffeine + Redis 两级               │
├────────────────────────────────────────────────┤
│              NLP 模型缓存 (Model Cache)          │
│   模型预加载到内存，避免每次推理加载               │
│   存储: 进程内单例                                │
└────────────────────────────────────────────────┘
```

### 8.2 缓存更新策略

```java
@Service
public class AlignmentCacheManager {
    
    private static final long RULE_TTL_SECONDS = 1800;
    private static final long TERM_TTL_SECONDS = 86400;
    
    @Cacheable(value = "alignment:rules", key = "#subject + ':' + #version + ':' + #grade")
    public List<TextbookMethodRule> loadRules(String subject, String version, String grade) {
        return ruleMapper.selectByConditions(subject, version, grade);
    }
    
    @Cacheable(value = "alignment:terms", key = "#subject + ':' + #conceptCode + ':' + #version")
    public TermMapping loadTermMapping(String subject, String conceptCode, String version) {
        return termMappingMapper.selectOne(subject, conceptCode, version);
    }
    
    /**
     * 规则更新时主动失效缓存
     * 通过消息队列监听规则变更事件
     */
    @EventListener
    public void onRuleUpdated(RuleUpdatedEvent event) {
        String cacheKey = event.getSubject() + ":" + event.getTextbookVersion() 
                        + ":" + event.getGrade();
        cacheManager.evict("alignment:rules", cacheKey);
    }
}
```

---

## 9. 性能优化

### 9.1 并行检测优化

四个检测器相互独立，可并行执行：

```java
@Service
public class ParallelAlignmentChecker {
    
    @Autowired private MethodConsistencyChecker methodChecker;
    @Autowired private TermConsistencyChecker termChecker;
    @Autowired private NotationConsistencyChecker notationChecker;
    @Autowired private ProgressComplianceChecker progressChecker;
    
    private final ExecutorService checkerPool = Executors.newFixedThreadPool(4);
    
    public DeviationResult parallelCheck(
            MethodSignature signature,
            String content,
            List<TextbookMethodRule> rules,
            List<TermMapping> termMappings,
            String studentVersion,
            String studentGrade,
            List<String> gradeSequence) {
        
        long startTime = System.currentTimeMillis();
        
        // 四个检测器并行执行
        CompletableFuture<List<Deviation>> methodFuture = CompletableFuture.supplyAsync(
            () -> methodChecker.check(signature, rules), checkerPool);
        
        CompletableFuture<List<Deviation>> termFuture = CompletableFuture.supplyAsync(
            () -> termChecker.check(content, signature, termMappings, studentVersion), checkerPool);
        
        CompletableFuture<List<Deviation>> notationFuture = CompletableFuture.supplyAsync(
            () -> notationChecker.check(signature.getNotationTokens(), studentVersion), checkerPool);
        
        CompletableFuture<List<Deviation>> progressFuture = CompletableFuture.supplyAsync(
            () -> progressChecker.check(signature, studentGrade, studentVersion, gradeSequence), 
            checkerPool);
        
        // 等待全部完成（设置超时）
        try {
            CompletableFuture.allOf(methodFuture, termFuture, notationFuture, progressFuture)
                .get(300, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            // 取消未完成的任务，使用已完成的结果
            log.warn("部分检测器超时，使用部分结果");
        }
        
        // 合并结果
        List<Deviation> allDeviations = new ArrayList<>();
        addIfDone(allDeviations, methodFuture);
        addIfDone(allDeviations, termFuture);
        addIfDone(allDeviations, notationFuture);
        addIfDone(allDeviations, progressFuture);
        
        // 去重与排序
        allDeviations = deduplicateAndSort(allDeviations);
        
        double score = calculateAlignmentScore(allDeviations);
        long latency = System.currentTimeMillis() - startTime;
        
        return DeviationResult.builder()
            .deviations(allDeviations)
            .alignmentScore(score)
            .passed(score >= PASS_THRESHOLD && allDeviations.stream()
                .noneMatch(d -> d.getSeverity() >= 3))
            .maxSeverity(allDeviations.stream()
                .mapToInt(Deviation::getSeverity).max().orElse(0))
            .latencyMs(latency)
            .build();
    }
}
```

### 9.2 预计算优化

对高频知识点组合预计算规则匹配结果：

```sql
-- 预计算表: 知识点→规则集的映射缓存
CREATE TABLE kp_rule_cache (
    id           BIGINT PRIMARY KEY AUTO_INCREMENT,
    cache_key    VARCHAR(200) NOT NULL UNIQUE COMMENT 'subject+version+grade+kpcodes hash',
    subject      VARCHAR(20) NOT NULL,
    textbook_ver VARCHAR(40) NOT NULL,
    grade        VARCHAR(20) NOT NULL,
    kp_codes     VARCHAR(500) NOT NULL,
    rule_ids     JSON NOT NULL COMMENT '匹配的规则ID列表',
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_lookup (subject, textbook_ver, grade)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 10. 监控与可观测性

### 10.1 核心监控指标

| 指标名 | 类型 | 说明 |
| --- | --- | --- |
| alignment.check.total | Counter | 校验总次数 |
| alignment.check.passed | Counter | 通过次数 |
| alignment.check.deviations | Counter | 检出偏差次数 |
| alignment.check.corrected | Counter | 自动修正次数 |
| alignment.check.degraded | Counter | 降级次数 |
| alignment.check.latency | Histogram | 校验耗时分布 |
| alignment.deviations.by_type | Counter(按type) | 各类偏差计数 |
| alignment.deviations.by_severity | Counter(按severity) | 各严重度计数 |
| alignment.score.distribution | Histogram | 一致性分数分布 |
| alignment.cache.hit_rate | Gauge | 缓存命中率 |

### 10.2 告警规则

```yaml
groups:
  - name: alignment_engine
    rules:
      # 偏差率突增告警
      - alert: AlignmentDeviationRateSpike
        expr: |
          rate(alignment_check_deviations_total[5m]) / 
          rate(alignment_check_total[5m]) > 0.3
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "教材版本一致性偏差率超过30%"
      
      # 校验延迟过高告警
      - alert: AlignmentCheckLatencyHigh
        expr: |
          histogram_quantile(0.95, 
            rate(alignment_check_latency_seconds_bucket[5m])) > 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "一致性校验P95延迟超过500ms"
      
      # 降级率过高告警
      - alert: AlignmentDegradeRateHigh
        expr: |
          rate(alignment_check_degraded_total[5m]) / 
          rate(alignment_check_total[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "一致性校验降级率超过5%"
```

---

## 11. 典型偏差场景示例

### 11.1 术语偏差示例

| 场景 | AI 回答 | 学生教材 | 偏差 | 修正 |
| --- | --- | --- | --- | --- |
| 数学-方程 | "含有未知数的**等式**叫方程" | 人教版五年级 | 正确 | - |
| 数学-方程 | "含有未知数的**命题**叫方程" | 人教版 | 术语错误 | 命题→等式 |
| 数学-几何 | "三角形的**高**是从顶点到底边的距离" | 北师大版 | 正确 | - |
| 数学-几何 | "三角形的**高线**是从顶点到底边的距离" | 人教版(小学) | 术语差异 | 高线→高 |
| 物理-电学 | "**电流强度**等于电压除以电阻" | 人教版九年级 | 正确 | - |
| 物理-电学 | "**电流**等于电压除以电阻" | 人教版(初中首次) | 术语差异(初期严格区分) | 电流→电流强度 |

### 11.2 方法偏差示例

```
知识点: 一元二次方程解法
学生教材: 人教版九年级上册
教材标准方法: 公式法 → x = (-b ± √(b²-4ac)) / 2a

AI 回答: "使用韦达定理直接求根..."
偏差类型: METHOD (进度偏差)
严重度: 3
说明: 韦达定理在人教版中为一元二次方程后面的拓展内容，
      学生尚未学习，应使用配方法或公式法
修正策略: 替换为公式法求解
```

### 11.3 记法偏差示例

```
知识点: 向量表示
学生教材: 北师大版
教材标准记法: 向量用箭头表示 →AB

AI 回答: "向量 **AB** = (3, 4)"
偏差类型: NOTATION
严重度: 1
修正: **AB** → →AB  (即 \overrightarrow{AB})
```

---

## 12. 数据初始化与维护

### 12.1 初始规则数据来源

| 数据来源 | 说明 | 覆盖范围 |
| --- | --- | --- |
| 教材内容解析 | 从数字化的教材内容中自动提取方法规则 | 数学、物理、化学 |
| 教研专家标注 | 由内容教研团队人工审核和补充 | 所有学科 |
| 错误案例积累 | 从实际校验中发现的偏差案例反哺规则库 | 持续迭代 |
| 课标文件解析 | 从课程标准文档中提取约束性规定 | 全学科 |

### 12.2 规则版本管理

```java
@Service
public class RuleVersionManager {
    
    /**
     * 规则库采用语义化版本管理
     * Major.Minor.Patch
     * - Major: 规则结构变更（需重新部署）
     * - Minor: 新增规则（向后兼容）
     * - Patch: 规则修正（调整阈值等）
     */
    public String getCurrentVersion() {
        return ruleVersionMapper.selectLatestVersion();
    }
    
    /**
     * 灰度发布新规则版本
     */
    public void releaseVersion(String version, double grayPercent) {
        // 1. 将新版本规则写入灰度表
        ruleMapper.insertGrayRules(version, grayPercent);
        
        // 2. 按灰度比例逐步放量
        grayRouter.updateRouting("alignment-rules", version, grayPercent);
        
        // 3. 监控偏差检出率变化
        metrics.track("alignment.rule.release", Map.of(
            "version", version,
            "grayPercent", grayPercent
        ));
    }
}
```

---

## 13. 安全与合规

### 13.1 数据安全

- 校验日志中的 AI 回答内容需脱敏处理（去除用户身份信息）
- 校验记录保留 90 天，超期自动归档至冷存储
- 规则库数据属于平台核心资产，不对外暴露原始规则

### 13.2 服务隔离

- 本引擎部署为独立微服务，与主 AI 服务隔离
- 通过 gRPC 内部调用，不暴露外部 API
- 校验失败不影响主链路（fail-open 策略）

### 13.3 审计要求

- 所有自动修正操作需记录修正前后内容
- 严重度 3 的偏差需触发告警并通知内容团队
- 规则库变更需通过审核流程

---

## 14. 部署与扩展

### 14.1 部署架构

```
                    ┌──────────────┐
                    │  Load Balancer│
                    └──────┬───────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
     ┌──────┴──────┐ ┌────┴─────┐ ┌──────┴──────┐
     │Alignment Svc│ │Alignment │ │Alignment Svc│
     │  Node 1     │ │Svc Node 2│ │  Node 3     │
     └──────┬──────┘ └────┬─────┘ └──────┬──────┘
            │              │              │
     ┌──────┴──────────────┴──────────────┴──────┐
     │              Redis Cluster                  │
     │  (规则缓存 + 术语缓存 + 结果缓存)             │
     └─────────────────────┬──────────────────────┘
                           │
     ┌─────────────────────┴──────────────────────┐
     │           MySQL (Primary/Replica)           │
     │  textbook_method_rules | term_mapping       │
     │  alignment_check_logs | deviation_patterns  │
     └─────────────────────────────────────────────┘
```

### 14.2 弹性伸缩配置

| 指标 | 扩容阈值 | 缩容阈值 | 副本范围 |
| --- | --- | --- | --- |
| CPU 使用率 | > 60% | < 20% | 3-10 |
| 请求队列长度 | > 100 | < 10 | 3-10 |
| P95 延迟 | > 250ms | < 100ms | 3-10 |

---

## 15. 与其他系统的集成

### 15.1 上游系统

| 系统 | 集成方式 | 说明 |
| --- | --- | --- |
| AI 对话引擎 | gRPC 同步调用 | 在 SSE 流式输出前执行校验 |
| 拍题解析服务 | gRPC 同步调用 | 解析生成后校验 |
| 内容生成服务 | 异步消息队列 | 离线内容校验 |
| 学生画像服务 | 读取学生教材版本 | 获取学生上下文 |

### 15.2 下游系统

| 系统 | 集成方式 | 说明 |
| --- | --- | --- |
| 质量监控系统 | Kafka 事件 | 推送校验报告 |
| 内容管理后台 | REST API | 规则库管理界面 |
| 告警系统 | Webhook | 严重偏差告警 |
| BI 分析平台 | 数据库同步 | 偏差统计分析 |

---

## 16. 迭代规划

### 16.1 V1.0 (MVP)

- 支持人教版（PEP）数学学科 G1-G9
- 方法一致性和术语一致性检测
- 基础自动修正（替换型）
- 规则管理后台基础功能

### 16.2 V1.5

- 扩展至人教版全学科
- 增加苏教版、北师大版数学
- 进度合规性检测
- 记法一致性检测
- 并行检测优化

### 16.3 V2.0

- 覆盖 6+ 主流教材版本
- 全学科支持
- NLP 模型增强（方法识别准确率 > 95%）
- 偏差预测与预防
- 规则自动发现（从教学数据中挖掘）

---

## 附录

### A. 教材版本编码表

| 编码 | 教材版本 | 覆盖学科 |
| --- | --- | --- |
| PEP | 人教版（人民教育出版社） | 全学科 |
| JSBN | 苏教版（江苏凤凰教育出版社） | 数学、科学 |
| BNU | 北师大版（北京师范大学出版社） | 数学、物理 |
| FLTRP | 外研版（外语教学与研究出版社） | 英语 |
| SWUN | 西南师大版 | 数学 |
| ESTP | 教科版（教育科学出版社） | 科学 |

### B. 偏差严重度定义

| 级别 | 名称 | 说明 | 示例 |
| --- | --- | --- | --- |
| 1 | 提示 (INFO) | 记法风格差异，不影响理解 | 向量表示方式差异 |
| 2 | 警告 (WARN) | 方法或术语不一致，可能造成困惑 | 使用了其他版本的术语 |
| 3 | 严重 (CRITICAL) | 方法完全错误或引入超纲概念 | 小学阶段引入初中方法 |

### C. 一致性评分公式

```
alignmentScore = 100 - Σ(penalty(deviation) for each deviation)

penalty(deviation) = base_penalty(severity) × confidence_factor × overlap_factor

base_penalty:
  severity 1 = 2 points
  severity 2 = 8 points
  severity 3 = 25 points

confidence_factor = deviation detection confidence (0.5-1.0)
overlap_factor = 1.0 (独立偏差) or 0.7 (重叠偏差)

最低分 = 0 (完全不一致)
最高分 = 100 (完全一致)
```

### D. 关键配置参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| alignment.pass_threshold | 70 | 通过校验的最低分数 |
| alignment.auto_correct.confidence_min | 0.7 | 自动修正的最低置信度 |
| alignment.check.timeout_ms | 500 | 单次校验最大耗时 |
| alignment.parallel.pool_size | 4 | 并行检测器线程池大小 |
| alignment.cache.rule_ttl_seconds | 1800 | 规则缓存TTL |
| alignment.cache.request_ttl_seconds | 3600 | 请求缓存TTL |
| alignment.batch.max_size | 20 | 批量校验最大数量 |
| alignment.monitor.alert.deviation_rate | 0.3 | 偏差率告警阈值 |
