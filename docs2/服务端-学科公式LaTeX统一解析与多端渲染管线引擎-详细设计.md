# 服务端 - 学科公式 LaTeX 统一解析与多端渲染管线引擎

## 1. 概述

### 1.1 模块定位

学科公式 LaTeX 统一解析与多端渲染管线引擎是 PrimeTop 教育平台的基础设施级服务，负责将数学公式、化学方程式、物理表达式等学科特殊内容从 LaTeX/MathML 源文本统一解析、规范化、渲染为多端可用的输出格式（SVG、PNG、MathML、HTML），并提供公式检索、知识点关联、缓存加速、无障碍描述生成等能力。

### 1.2 设计目标

| 目标 | 说明 |
| --- | --- |
| 统一解析 | 提供唯一入口，解析 LaTeX、AMSmath、ChemFig 等学科标记语言 |
| 多端渲染 | 一次输入，输出 SVG / PNG / MathML / 纯文本 / HTML 多种格式 |
| 高性能 | 公式渲染结果缓存命中率 ≥ 95%，P99 响应 < 50ms（缓存命中）/ < 300ms（首次渲染） |
| 知识点关联 | 公式实体与知识图谱节点双向关联，支持"公式→知识点""知识点→公式集"查询 |
| 批量处理 | 支持内容导入时的批量公式解析与预渲染 |
| 无障碍 | 自动生成公式的自然语言描述（alt text），支持屏幕阅读器 |

### 1.3 适用范围

- AI 辅导对话中的公式渲染（SSE 流式输出场景）
- 题库题目与解析中的公式展示
- 同步课堂教材内容中的公式嵌入
- 学习报告、学情分析中的数学表达式
- 内容管理后台的公式编辑器预览
- 错题本中错题的公式展示

### 1.4 与现有模块的边界

| 现有模块 | 边界说明 |
| --- | --- |
| 数学公式与学科符号输入系统（客户端） | 负责用户端**输入**（虚拟键盘、手写识别）；本引擎负责**服务端解析与渲染** |
| 客户端-数学手写公式识别与LaTeX实时转换引擎 | 负责端侧手写→LaTeX转换；本引擎接收 LaTeX 后做服务端处理 |
| 服务端-统一学科计算引擎与符号推理服务 | 负责公式的**计算与推理**（求值、化简、证明）；本引擎负责**解析、渲染、存储、检索** |
| 服务端-理科题目图形智能识别与几何图形结构化提取引擎 | 负责几何**图形**的识别与提取；本引擎处理的是**公式与符号表达式** |
| 富文本与学科内容渲染引擎（客户端） | 负责客户端富文本整体渲染；本引擎为其提供公式渲染的**数据源** |

---

## 2. 系统架构

### 2.1 整体架构

```
                    ┌─────────────────────────────────┐
                    │        API Gateway / BFF         │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │   Formula Pipeline Service       │
                    │  (公式解析渲染统一服务)            │
                    │                                  │
                    │  ┌─────────┐  ┌──────────────┐  │
                    │  │ Parser  │→ │  Normalizer  │  │
                    │  │ (解析器) │  │  (规范化器)   │  │
                    │  └─────────┘  └──────┬───────┘  │
                    │                      │          │
                    │  ┌─────────┐  ┌──────▼───────┐  │
                    │  │ Renderer│← │   Cacher     │  │
                    │  │ (渲染器) │  │  (缓存层)    │  │
                    │  └────┬────┘  └──────────────┘  │
                    │       │                         │
                    │  ┌────▼──────────────────────┐  │
                    │  │   Post-Processor           │  │
                    │  │  (后处理:alt-text/关联/索引)│  │
                    │  └────────────────────────────┘  │
                    └──────────────────────────────────┘
                                   │
              ┌──────────┬─────────┼──────────┬──────────┐
              │          │         │          │          │
         ┌────▼───┐ ┌────▼───┐ ┌───▼───┐ ┌────▼───┐ ┌────▼────┐
         │ MySQL  │ │ Redis  │ │  S3   │ │ ES     │ │ Neo4j   │
         │(元数据) │ │(缓存)  │ │(图片) │ │(搜索)  │ │(图谱)   │
         └────────┘ └────────┘ └───────┘ └────────┘ └─────────┘
```

### 2.2 核心组件

| 组件 | 职责 | 技术选型 |
| --- | --- | --- |
| **Parser（解析器）** | 将 LaTeX / MathML / ChemFig 源文本解析为统一的 AST（抽象语法树） | Python: `latex2mathml` + 自研 ChemFig parser；或 Node.js: `temml` + `mathjax` |
| **Normalizer（规范化器）** | 对 AST 进行规范化：统一宏定义、修正常见语法错误、统一变量命名、生成 canonical LaTeX | 自研规则引擎 |
| **Renderer（渲染器）** | 将 AST 渲染为目标格式（SVG/PNG/MathML/HTML/纯文本） | MathJax-node / KaTeX SSR / Puppeteer headless |
| **Cacher（缓存层）** | 基于公式 canonical hash 的渲染结果缓存 | Redis (SVG/MathML/HTML 字符串) + S3 (PNG/SVG 文件) |
| **Post-Processor（后处理器）** | 生成 alt text、知识点关联、搜索索引、批量预处理 | NLP 模型 + 图谱查询 |

### 2.3 请求处理流程

```
客户端请求 (LaTeX + targetFormat + context)
    │
    ▼
[1] 接收请求 → 参数校验 → 鉴权
    │
    ▼
[2] LaTeX 规范化 → 生成 canonical_hash (SHA-256)
    │
    ▼
[3] 缓存查询: Redis GET formula:{canonical_hash}:{format}
    │
    ├── 命中 ──→ 返回缓存结果
    │
    └── 未命中 ──→ [4] AST 解析
                       │
                       ▼
                   [5] 渲染为目标格式
                       │
                       ▼
                   [6] 后处理 (alt-text / 关联)
                       │
                       ▼
                   [7] 写入缓存 (Redis + S3)
                       │
                       ▼
                   [8] 返回渲染结果
```

---

## 3. 数据结构定义

### 3.1 公式实体表 `formula_entities`

存储每个唯一公式实体的元数据。

```sql
CREATE TABLE formula_entities (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    canonical_hash  VARCHAR(64) NOT NULL UNIQUE COMMENT 'SHA-256(canonical_latex)',
    canonical_latex VARCHAR(2048) NOT NULL COMMENT '规范化后的LaTeX源文本',
    raw_latex       VARCHAR(2048) COMMENT '原始输入LaTeX（首次提交版本）',
    formula_type    ENUM('math', 'chemistry', 'physics', 'logic', 'other') NOT NULL DEFAULT 'math',
    complexity      TINYINT NOT NULL DEFAULT 0 COMMENT '复杂度等级 0-5',
    alt_text        VARCHAR(500) COMMENT '无障碍自然语言描述',
    alt_text_zh     VARCHAR(500) COMMENT '中文无障碍描述',
    variables       JSON COMMENT '变量列表 ["x","y","n"]',
    subject         VARCHAR(20) COMMENT '学科标签 math/physics/chemistry',
    topic_tags      JSON COMMENT '主题标签 ["quadratic","algebra"]',
    kp_ids          JSON COMMENT '关联知识点ID列表 ["KP_10023","KP_10045"]',
    render_count    INT NOT NULL DEFAULT 0 COMMENT '被引用渲染次数',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_hash (canonical_hash),
    INDEX idx_type_subject (formula_type, subject),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utfmb4 COMMENT='公式实体表';
```

### 3.2 公式渲染缓存表 `formula_render_cache`

```sql
CREATE TABLE formula_render_cache (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    formula_id      BIGINT NOT NULL COMMENT '关联formula_entities.id',
    canonical_hash  VARCHAR(64) NOT NULL COMMENT '冗余hash用于快速查找',
    output_format   ENUM('svg', 'png', 'mathml', 'html', 'plaintext', 'speech') NOT NULL,
    content         MEDIUMTEXT COMMENT '渲染结果(svg/mathml/html文本)',
    s3_url          VARCHAR(500) COMMENT 'S3存储URL(png/svg大图)',
    width           INT COMMENT '渲染宽度(px)',
    height          INT COMMENT '渲染高度(px)',
    baseline        INT COMMENT '基线偏移量(px)，用于行内对齐',
    font_size       INT NOT NULL DEFAULT 16 COMMENT '渲染字号',
    theme           VARCHAR(20) NOT NULL DEFAULT 'light' COMMENT 'light/dark/high-contrast',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at      DATETIME COMMENT '过期时间(NULL=永不过期)',
    
    UNIQUE KEY uk_formula_render (canonical_hash, output_format, font_size, theme),
    INDEX idx_formula_id (formula_id),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utfmb4 COMMENT='公式渲染缓存表';
```

### 3.3 公式使用引用表 `formula_references`

追踪公式在哪些内容中被使用。

```sql
CREATE TABLE formula_references (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    formula_id      BIGINT NOT NULL,
    ref_type        ENUM('question', 'answer', 'content', 'dialogue', 'report') NOT NULL,
    ref_id          BIGINT NOT NULL COMMENT '引用源ID(题目ID/内容ID/对话ID)',
    position        INT COMMENT '在内容中的位置索引',
    context_text    VARCHAR(200) COMMENT '公式周围的上下文文本',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_formula (formula_id),
    INDEX idx_ref (ref_type, ref_id)
) ENGINE=InnoDB DEFAULT CHARSET=utfmb4 COMMENT='公式使用引用追踪表';
```

### 3.4 公式AST节点（Redis存储）

解析后的 AST 以 JSON 格式存储在 Redis，用于快速二次处理。

```json
{
  "hash": "a1b2c3d4e5f6...",
  "type": "math",
  "latex": "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
  "ast": {
    "type": "equation",
    "lhs": { "type": "variable", "name": "x" },
    "rhs": {
      "type": "fraction",
      "numerator": {
        "type": "binop",
        "operator": "±",
        "left": { "type": "negate", "operand": { "type": "variable", "name": "b" } },
        "right": {
          "type": "sqrt",
          "radicand": {
            "type": "subtraction",
            "left": { "type": "power", "base": { "type": "variable", "name": "b" }, "exponent": { "type": "number", "value": 2 } },
            "right": {
              "type": "product",
              "factors": [
                { "type": "number", "value": 4 },
                { "type": "variable", "name": "a" },
                { "type": "variable", "name": "c" }
              ]
            }
          }
        }
      },
      "denominator": {
        "type": "product",
        "factors": [
          { "type": "number", "value": 2 },
          { "type": "variable", "name": "a" }
        ]
      }
    }
  },
  "variables": ["a", "b", "c", "x"],
  "complexity": 4,
  "topicTags": ["quadratic-formula", "algebra"]
}
```

### 3.5 统一响应数据结构

```typescript
// 单个公式渲染结果
interface FormulaRenderResult {
  formulaId: number;           // 公式实体ID
  hash: string;                // canonical hash
  format: RenderFormat;        // 渲染格式
  content: string;             // 渲染内容(svg/html/mathml文本 或 base64图片)
  url?: string;                // 图片URL(png/svg大图场景)
  width: number;               // 宽度px
  height: number;              // 高度px  
  baseline: number;            // 基线偏移px
  altText: string;             // 无障碍描述
  altTextZh: string;           // 中文无障碍描述
  variables: string[];         // 变量列表
  kpIds: string[];             // 关联知识点ID
}

type RenderFormat = 'svg' | 'png' | 'mathml' | 'html' | 'plaintext' | 'speech';

// 批量渲染请求
interface BatchRenderRequest {
  formulas: Array<{
    latex: string;             // LaTeX源文本
    context?: string;          // 上下文（帮助alt-text生成）
  }>;
  format: RenderFormat;
  fontSize?: number;           // 默认16
  theme?: 'light' | 'dark' | 'high-contrast';
  subject?: string;            // 学科提示
}

// 批量渲染响应
interface BatchRenderResponse {
  results: FormulaRenderResult[];
  errors: Array<{
    index: number;
    latex: string;
    errorCode: string;
    message: string;
  }>;
}
```

---

## 4. API 接口设计

### 4.1 单公式渲染

**POST** `/api/v1/formula/render`

渲染单个公式为指定格式。

**请求参数：**

```json
{
  "latex": "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
  "format": "svg",
  "fontSize": 16,
  "theme": "light",
  "subject": "math",
  "context": "二次方程求根公式",
  "generateAltText": true
}
```

**响应（200）：**

```json
{
  "code": 0,
  "data": {
    "formulaId": 10234,
    "hash": "a1b2c3d4e5f67890...",
    "format": "svg",
    "content": "<svg xmlns='http://www.w3.org/2000/svg' ...>...</svg>",
    "width": 280,
    "height": 64,
    "baseline": 48,
    "altText": "x equals negative b plus or minus the square root of b squared minus four a c, all divided by two a",
    "altTextZh": "x等于负b加减根号下b的平方减4ac，再除以2a",
    "variables": ["a", "b", "c", "x"],
    "kpIds": ["KP_2041", "KP_2042"]
  }
}
```

### 4.2 批量公式渲染

**POST** `/api/v1/formula/render/batch`

批量渲染多个公式，适用于内容导入、题目展示等场景。

**请求参数：**

```json
{
  "formulas": [
    { "latex": "E = mc^2", "context": "质能方程" },
    { "latex": "\\int_0^1 x^2 dx = \\frac{1}{3}", "context": "定积分" },
    { "latex": "\\ce{2H2 + O2 -> 2H2O}", "context": "水的化合" }
  ],
  "format": "svg",
  "fontSize": 16,
  "theme": "light"
}
```

**响应（200）：**

```json
{
  "code": 0,
  "data": {
    "results": [
      {
        "formulaId": 10001,
        "hash": "f1e2d3c4...",
        "format": "svg",
        "content": "<svg ...>...</svg>",
        "width": 120,
        "height": 32,
        "baseline": 24,
        "altText": "E equals m c squared",
        "altTextZh": "E等于mc的平方",
        "variables": ["E", "m", "c"],
        "kpIds": ["KP_3021"]
      },
      // ...
    ],
    "errors": []
  }
}
```

### 4.3 富文本公式提取与批量渲染

**POST** `/api/v1/formula/extract`

从混合富文本中提取所有公式标记并批量渲染，返回替换后的富文本和公式位置映射。

**请求参数：**

```json
{
  "content": "根据二次方程 $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$，当 $\\Delta = b^2 - 4ac > 0$ 时方程有两个不同实根。",
  "format": "svg",
  "fontSize": 16,
  "theme": "light"
}
```

**响应（200）：**

```json
{
  "code": 0,
  "data": {
    "processedContent": "根据二次方程 [[FORMULA:0]]，当 [[FORMULA:1]] 时方程有两个不同实根。",
    "formulas": [
      {
        "index": 0,
        "latex": "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
        "renderResult": { "...": "FormulaRenderResult" }
      },
      {
        "index": 1,
        "latex": "\\Delta = b^2 - 4ac > 0",
        "renderResult": { "...": "FormulaRenderResult" }
      }
    ]
  }
}
```

### 4.4 公式搜索

**GET** `/api/v1/formula/search?latex={latex}&subject={subject}&page={page}&size={size}`

通过 LaTeX 源文本或规范化哈希搜索已有公式实体。

**响应（200）：**

```json
{
  "code": 0,
  "data": {
    "total": 42,
    "items": [
      {
        "formulaId": 10234,
        "canonicalLatex": "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
        "formulaType": "math",
        "subject": "math",
        "topicTags": ["quadratic-formula", "algebra"],
        "kpIds": ["KP_2041", "KP_2042"],
        "renderCount": 15283,
        "references": {
          "questions": 234,
          "contents": 18,
          "dialogues": 5031
        }
      }
    ]
  }
}
```

### 4.5 公式知识点关联

**POST** `/api/v1/formula/{formulaId}/knowledge-points`

将公式与知识点建立关联。

**请求参数：**

```json
{
  "kpIds": ["KP_2041", "KP_2042", "KP_2043"],
  "relationType": "derivation",
  "confidence": 0.95
}
```

### 4.6 内容公式预处理（异步）

**POST** `/api/v1/formula/preprocess`

提交大段内容进行异步公式提取、渲染和缓存预热。

**请求参数：**

```json
{
  "contentType": "question",
  "contentId": "Q_12345678",
  "content": "题目全文...包含 $公式$ 和 $$块公式$$ ...",
  "priority": "normal"
}
```

**响应（202）：**

```json
{
  "code": 0,
  "data": {
    "taskId": "formula_preprocess_d8e7f6g5",
    "status": "processing"
  }
}
```

通过 `GET /api/v1/formula/preprocess/{taskId}` 查询处理结果。

---

## 5. 核心模块详细设计

### 5.1 LaTeX 解析器（Parser）

#### 5.1.1 解析流程

```python
class LatexFormulaParser:
    """
    LaTeX 公式解析器
    将 LaTeX 源文本解析为统一 AST
    """
    
    # 支持的 LaTeX 包/宏
    SUPPORTED_PACKAGES = {
        'amsmath',    # align, gather, cases
        'amssymb',    # 数学符号
        'mathbb',     # 黑板粗体
        'mathcal',    # 花体
        'chemfig',    # 化学结构式
        'mhchem',     # 化学方程式 \ce{}
        'tikz',       # 简单图形(basic only)
    }
    
    # 不支持的命令黑名单
    BLOCKED_COMMANDS = {
        '\\input', '\\include', '\\write',     # 文件操作
        '\\immediate', '\\openout',             # IO操作
        '\\shell', '\\system',                  # 系统调用
        '\\def', '\\edef', '\\let',             # 宏定义(防注入)
    }
    
    def parse(self, latex: str, context: ParseContext = None) -> FormulaAST:
        """
        解析 LaTeX 为 AST
        """
        # 1. 安全检查：过滤危险命令
        self._security_check(latex)
        
        # 2. 预处理：统一空白、修复常见错误
        cleaned = self._preprocess(latex)
        
        # 3. 检测公式类型
        formula_type = self._detect_type(cleaned)
        
        # 4. 分发到对应解析器
        if formula_type == 'chemistry':
            ast = self._parse_chemistry(cleaned)
        elif formula_type == 'math':
            ast = self._parse_math(cleaned)
        else:
            ast = self._parse_generic(cleaned)
        
        # 5. 提取变量和元信息
        ast.variables = self._extract_variables(ast)
        ast.complexity = self._calculate_complexity(ast)
        
        return ast
    
    def _security_check(self, latex: str) -> None:
        """检查 LaTeX 安全性，阻止注入攻击"""
        for cmd in self.BLOCKED_COMMANDS:
            if cmd in latex:
                raise FormulaSecurityError(
                    f"Blocked command '{cmd}' in LaTeX input"
                )
        # 检查嵌套深度，防止DoS
        depth = 0
        for ch in latex:
            if ch == '{': depth += 1
            elif ch == '}': depth -= 1
            if depth > 30:
                raise FormulaSecurityError("Expression nesting too deep")
        # 检查总长度
        if len(latex) > 2000:
            raise FormulaSecurityError("LaTeX too long (max 2000 chars)")
```

#### 5.1.2 公式类型检测

```python
def _detect_type(self, latex: str) -> str:
    """自动检测公式学科类型"""
    # 化学方程式标记
    if r'\ce{' in latex or r'\chemfig' in latex:
        return 'chemistry'
    
    # 物理常见符号
    physics_patterns = [
        r'\\vec', r'\\hat', r'\\overline',
        r'\b(F|E|B|v|a|p|m|W|Q|I|R|L|C)\b.*=',
        r'\\Delta', r'\\nabla', r'\\oint', r'\\oiint',
    ]
    for pattern in physics_patterns:
        if re.search(pattern, latex):
            # 需要更多证据，单变量名不足以判定
            if self._count_physics_indicators(latex) >= 2:
                return 'physics'
    
    # 逻辑表达式
    logic_patterns = [r'\\forall', r'\\exists', r'\\implies', r'\\iff']
    for pattern in logic_patterns:
        if pattern in latex:
            return 'logic'
    
    return 'math'
```

#### 5.1.3 LaTeX 规范化器

```python
class LatexNormalizer:
    """
    LaTeX 规范化器
    将不同写法的 LaTeX 统一为 canonical 形式
    """
    
    # 常见等价替换
    EQUIVALENT_MAP = {
        # 空格规范化
        r'\s+': ' ',
        # 乘法符号统一
        r'\times': r'\times',
        r'\cdot': r'\cdot',
        # 分数统一
        r'\\frac\s*': r'\\frac',
        # 上标统一: x^2 → x^{2}, x^{ab}不变
        r'(?<!\^)\^([a-zA-Z0-9])(?!\})': r'^{\1}',
        # 下标统一: x_2 → x_{2}
        r'(?<!_)_([a-zA-Z0-9])(?!\})': r'_{\1}',
        # 去除多余空格
        r'\s*([{}])\s*': r'\1',
        # 去除尾部换行
        r'\n+$': '',
    }
    
    def normalize(self, latex: str) -> Tuple[str, str]:
        """
        规范化 LaTeX，返回 (canonical_latex, hash)
        """
        result = latex.strip()
        
        for pattern, replacement in self.EQUIVALENT_MAP.items():
            result = re.sub(pattern, replacement, result)
        
        # 统一宏展开（展开常见自定义宏为标准命令）
        result = self._expand_macros(result)
        
        # 生成哈希
        canonical_hash = hashlib.sha256(result.encode('utf-8')).hexdigest()
        
        return result, canonical_hash
```

### 5.2 渲染器（Renderer）

#### 5.2.1 渲染策略选择

```python
class FormulaRenderer:
    """
    公式渲染器
    根据目标格式选择最优渲染策略
    """
    
    def __init__(self):
        self.svg_renderer = KaTeXSSRRenderer()       # SVG 优先用 KaTeX
        self.png_renderer = MathJaxNodeRenderer()      # PNG 用 MathJax-node
        self.mathml_renderer = MathJaxNodeRenderer()   # MathML 用 MathJax-node  
        self.html_renderer = KaTeXSSRRenderer()        # HTML 用 KaTeX
        self.speech_renderer = SpeechRenderer()        # 语音/文本描述
    
    def render(self, ast: FormulaAST, 
               format: RenderFormat, 
               options: RenderOptions) -> RenderOutput:
        """
        渲染 AST 到目标格式
        """
        renderer = self._get_renderer(format)
        
        try:
            output = renderer.render(ast, options)
        except RenderError as e:
            # 降级策略：尝试备用渲染器
            logger.warning(f"Primary renderer failed: {e}, falling back")
            fallback = self._get_fallback_renderer(format)
            output = fallback.render(ast, options)
        
        # 计算尺寸
        output.width, output.height, output.baseline = \
            self._calculate_dimensions(output, options.font_size)
        
        return output
```

#### 5.2.2 KaTeX SSR 渲染器（主渲染器）

```javascript
// renderer/katex-ssr.js
const katex = require('katex');

class KatexSSRRenderer {
    /**
     * 使用 KaTeX 进行服务端渲染
     * 优点：速度极快（<5ms/公式）
     * 缺点：不支持所有 AMSmath 环境
     */
    render(latex, options = {}) {
        const { fontSize = 16, theme = 'light', displayMode = false } = options;
        
        try {
            // 渲染为 HTML+CSS
            const html = katex.renderToString(latex, {
                displayMode,
                throwOnError: true,
                strict: 'warn',
                trust: false,    // 禁止危险扩展
                macros: this._getDefaultMacros(),
            });
            
            // 渲染为 MathML（KaTeX 同时输出）
            const mathml = katex.renderToString(latex, {
                displayMode,
                output: 'mathml',
                throwOnError: true,
            });
            
            return {
                format: 'html',
                content: html,
                mathml: mathml,
                fontSize,
                theme,
            };
        } catch (error) {
            if (error instanceof katex.ParseError) {
                throw new FormulaParseError(
                    `LaTeX parse error: ${error.message}`,
                    { position: error.position, latex }
                );
            }
            throw error;
        }
    }
    
    _getDefaultMacros() {
        // 平台自定义宏定义
        return {
            '\\R': '\\mathbb{R}',
            '\\N': '\\mathbb{N}',
            '\\Z': '\\mathbb{Z}',
            '\\Q': '\\mathbb{Q}',
            '\\C': '\\mathbb{C}',
            '\\vec': '\\overrightarrow{#1}',
        };
    }
}
```

#### 5.2.3 MathJax Node 渲染器（高保真渲染器）

```javascript
// renderer/mathjax-node.js
const { mathjax } = require('mathjax-full/js/mathjax');
const { TeX } = require('mathjax-full/js/input/tex');
const { SVG } = require('mathjax-full/js/output/svg');
const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor');
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html');

class MathJaxNodeRenderer {
    /**
     * 使用 MathJax 进行高保真渲染
     * 优点：支持完整 AMSmath，渲染质量最高
     * 缺点：速度较慢（50-200ms/公式）
     * 适用场景：KaTeX 无法处理的复杂公式、SVG 输出
     */
    constructor() {
        this.adaptor = liteAdaptor();
        this.input = new TeX({
            packages: AllPackages,
            inlineMath: [['$', '$'], ['\\(', '\\)']],
            displayMath: [['$$', '$$'], ['\\[', '\\]']],
        });
        this.output = new SVG({ fontCache: 'local' });
        this.document = mathjax.document('', {
            InputJax: this.input,
            OutputJax: this.output,
        });
    }
    
    renderSVG(latex, options = {}) {
        const { fontSize = 16, displayMode = false } = options;
        
        const node = this.document.convert(latex, {
            display: displayMode,
            em: fontSize,
            ex: fontSize / 2,
            containerWidth: 800,
        });
        
        const svg = this.adaptor.innerHTML(node);
        const { w, h, d } = node.attributes;
        
        return {
            format: 'svg',
            content: svg,
            width: parseFloat(w) * fontSize,
            height: parseFloat(h) * fontSize,
            baseline: parseFloat(d || 0) * fontSize,
        };
    }
    
    renderPNG(latex, options = {}) {
        // 先渲染为 SVG，再转为 PNG
        const svgResult = this.renderSVG(latex, options);
        return this._svgToPng(svgResult, options);
    }
    
    async _svgToPng(svgResult, options) {
        // 使用 sharp 进行 SVG → PNG 转换
        const sharp = require('sharp');
        const scale = options.scale || 2;  // 2x for retina
        
        const pngBuffer = await sharp(Buffer.from(svgResult.content))
            .resize(svgResult.width * scale, svgResult.height * scale)
            .png()
            .toBuffer();
        
        // 上传到 S3
        const s3Url = await this.s3Client.upload(
            `formulas/${options.hash}.png`,
            pngBuffer
        );
        
        return {
            format: 'png',
            url: s3Url,
            width: svgResult.width * scale,
            height: svgResult.height * scale,
            baseline: svgResult.baseline * scale,
        };
    }
}
```

### 5.3 缓存层（Cacher）

#### 5.3.1 多级缓存架构

```python
class FormulaCacheManager:
    """
    公式缓存管理器
    L1: 本地内存缓存（LRU, 最热的1000条）
    L2: Redis 分布式缓存（全量文本缓存）
    L3: S3 对象存储（PNG/SVG大图）
    """
    
    L1_MAX_SIZE = 1000
    L1_TTL_SECONDS = 300  # 5分钟本地缓存
    L2_TTL_SECONDS = 7 * 24 * 3600  # 7天Redis缓存
    
    def __init__(self):
        self.l1_cache = LRUCache(maxsize=self.L1_MAX_SIZE)
        self.redis = RedisClient()
        self.s3 = S3Client()
    
    async def get(self, hash: str, format: str, 
                  font_size: int, theme: str) -> Optional[FormulaRenderResult]:
        """多级缓存查询"""
        cache_key = self._build_key(hash, format, font_size, theme)
        
        # L1: 本地内存
        result = self.l1_cache.get(cache_key)
        if result:
            return self._mark_cache_hit(result, 'L1')
        
        # L2: Redis
        redis_key = f'formula:{cache_key}'
        redis_data = await self.redis.get(redis_key)
        if redis_data:
            result = FormulaRenderResult.from_json(redis_data)
            # 回填 L1
            self.l1_cache.set(cache_key, result, ttl=self.L1_TTL_SECONDS)
            return self._mark_cache_hit(result, 'L2')
        
        # L3: S3（仅图片格式）
        if format in ('png', 'svg_file'):
            s3_url = f's3://formula-cache/{cache_key}.{format}'
            exists = await self.s3.exists(s3_url)
            if exists:
                # S3命中，重建缓存
                result = await self._rebuild_from_s3(hash, format, s3_url)
                await self._set_l2(cache_key, result)
                return self._mark_cache_hit(result, 'L3')
        
        return None  # Cache miss
    
    async def set(self, hash: str, format: str, 
                  font_size: int, theme: str,
                  result: FormulaRenderResult) -> None:
        """写入多级缓存"""
        cache_key = self._build_key(hash, format, font_size, theme)
        
        # L1
        self.l1_cache.set(cache_key, result, ttl=self.L1_TTL_SECONDS)
        
        # L2: Redis
        redis_key = f'formula:{cache_key}'
        await self.redis.setex(
            redis_key, 
            self.L2_TTL_SECONDS,
            result.to_json()
        )
        
        # L3: S3（仅大文件）
        if format in ('png',) and result.url:
            # 已经在渲染时上传
            pass
    
    def _build_key(self, hash: str, format: str, 
                   font_size: int, theme: str) -> str:
        """构建缓存键"""
        return f'{hash}:{format}:{font_size}:{theme}'
```

#### 5.3.2 缓存预热策略

```python
class FormulaCacheWarmer:
    """
    公式缓存预热器
    在低峰期预先渲染高频公式
    """
    
    async def warmup_daily(self):
        """每日缓存预热任务"""
        # 1. 获取Top 1000高频公式（根据render_count）
        hot_formulas = await self._get_hot_formulas(limit=1000)
        
        # 2. 预渲染为所有常用格式
        formats = ['svg', 'html', 'mathml']
        font_sizes = [14, 16, 18, 20, 24]  # 常用字号
        
        for formula in hot_formulas:
            for fmt in formats:
                for size in font_sizes:
                    for theme in ['light', 'dark']:
                        await self._render_and_cache(
                            formula.canonical_latex,
                            fmt, size, theme
                        )
        
        logger.info(f'Cache warmup complete: {len(hot_formulas)} formulas × '
                    f'{len(formats)} formats × {len(font_sizes)} sizes × 2 themes')
    
    async def warmup_for_content(self, content_ids: List[str]):
        """为指定内容预热公式缓存"""
        for content_id in content_ids:
            formulas = await self._extract_formulas_from_content(content_id)
            for formula in formulas:
                # 预渲染学生端最常用格式
                await self._render_and_cache(
                    formula.latex, 'svg', 16, 'light'
                )
```

### 5.4 公式提取与富文本处理

#### 5.4.1 富文本公式提取器

```python
class FormulaExtractor:
    """
    从混合富文本中提取公式标记
    支持: $行内公式$, $$块级公式$$, \(行内\), \[块级\], \ce{化学方程式}
    """
    
    # 公式标记正则（按优先级排序）
    PATTERNS = [
        # $$...$$ 块级公式（最先匹配，避免被$...$截断）
        (r'\$\$(.+?)\$\$', 'display'),
        # \[...\] 块级公式
        (r'\\\[(.+?)\\\]', 'display'),
        # $...$ 行内公式
        (r'\$([^$]+?)\$', 'inline'),
        # \(...\) 行内公式
        (r'\\\((.+?)\\\)', 'inline'),
        # \ce{...} 化学方程式
        (r'\\ce\{([^}]+)\}', 'inline'),
    ]
    
    def extract(self, content: str) -> ExtractResult:
        """
        从富文本中提取所有公式
        返回: 替换后的内容 + 公式列表
        """
        formulas = []
        positions = []
        
        for pattern, mode in self.PATTERNS:
            for match in re.finditer(pattern, content, re.DOTALL):
                latex = match.group(1).strip()
                formula_info = {
                    'latex': latex,
                    'mode': mode,
                    'start': match.start(),
                    'end': match.end(),
                    'original': match.group(0),
                }
                formulas.append(formula_info)
        
        # 按位置排序
        formulas.sort(key=lambda f: f['start'])
        
        # 生成占位符替换
        processed = content
        offset = 0
        for i, formula in enumerate(formulas):
            placeholder = f'[[FORMULA:{i}]]'
            start = formula['start'] + offset
            end = formula['end'] + offset
            processed = processed[:start] + placeholder + processed[end:]
            offset += len(placeholder) - (end - start)
        
        return ExtractResult(
            original_content=content,
            processed_content=processed,
            formulas=formulas,
        )
```

#### 5.4.2 SSE 流式输出中的公式处理

```python
class StreamFormulaProcessor:
    """
    处理 SSE 流式 AI 输出中的公式
    实时检测公式边界，流式渲染
    """
    
    BUFFER_SIZE = 200  # 公式缓冲区大小
    
    def __init__(self, render_service: FormulaPipelineService):
        self.render_service = render_service
        self.buffer = ''
        self.in_formula = False
        self.formula_start_marker = None
    
    async def process_chunk(self, chunk: str) -> AsyncIterator[StreamChunk]:
        """
        处理流式输出中的一个文本块
        """
        self.buffer += chunk
        
        while self.buffer:
            if not self.in_formula:
                # 检测公式开始标记
                marker = self._detect_formula_start(self.buffer)
                if marker:
                    # 输出公式前的普通文本
                    before = self.buffer[:marker['pos']]
                    if before:
                        yield StreamChunk(type='text', content=before)
                    
                    self.buffer = self.buffer[marker['pos'] + len(marker['open']):]
                    self.in_formula = True
                    self.formula_start_marker = marker
                else:
                    # 没有公式标记，输出缓冲区（保留可能的不完整标记）
                    safe_length = self._safe_output_length(self.buffer)
                    if safe_length > 0:
                        yield StreamChunk(
                            type='text', 
                            content=self.buffer[:safe_length]
                        )
                        self.buffer = self.buffer[safe_length:]
                    break
            else:
                # 在公式内部，检测结束标记
                end_pos = self._find_formula_end(self.buffer, self.formula_start_marker)
                if end_pos is not None:
                    # 公式完整，提取并渲染
                    latex = self.buffer[:end_pos]
                    self.buffer = self.buffer[end_pos + len(self.formula_start_marker['close']):]
                    self.in_formula = False
                    
                    # 异步渲染公式
                    render_result = await self.render_service.render_single(
                        latex=latex,
                        format='html',  # 流式优先输出HTML
                        font_size=16,
                    )
                    yield StreamChunk(
                        type='formula',
                        content=render_result.content,
                        formula_id=render_result.formula_id,
                    )
                    self.formula_start_marker = None
                else:
                    # 公式尚未结束，继续缓冲
                    if len(self.buffer) > 2000:
                        # 防止超长缓冲，可能是误识别
                        yield StreamChunk(type='text', content=self.buffer)
                        self.buffer = ''
                        self.in_formula = False
                    break
    
    def _detect_formula_start(self, text: str) -> Optional[dict]:
        """检测公式开始标记"""
        markers = [
            {'open': '$$', 'close': '$$', 'mode': 'display'},
            {'open': '\\[', 'close': '\\]', 'mode': 'display'},
            {'open': '$', 'close': '$', 'mode': 'inline'},
            {'open': '\\(', 'close': '\\)', 'mode': 'inline'},
        ]
        earliest = None
        for marker in markers:
            pos = text.find(marker['open'])
            if pos >= 0:
                if earliest is None or pos < earliest['pos']:
                    earliest = {**marker, 'pos': pos}
        return earliest
```

### 5.5 无障碍描述生成器（Alt-Text Generator）

```python
class AltTextGenerator:
    """
    为公式生成自然语言描述
    用于屏幕阅读器和语音播报
    """
    
    def __init__(self, llm_client, cache_manager):
        self.llm = llm_client  # 轻量级LLM实例
        self.cache = cache_manager
    
    async def generate(self, ast: FormulaAST, 
                       language: str = 'zh',
                       context: str = None) -> str:
        """生成公式的自然语言描述"""
        
        # 1. 简单公式：规则引擎
        simple_desc = self._rule_based_describe(ast)
        if simple_desc:
            return simple_desc
        
        # 2. 复杂公式：LLM 生成
        llm_desc = await self._llm_describe(ast, language, context)
        return llm_desc
    
    def _rule_based_describe(self, ast: FormulaAST) -> Optional[str]:
        """
        规则驱动的公式描述（覆盖90%的简单公式）
        """
        # 基础元素翻译表
        MATH_VOCAB = {
            '+': '加', '-': '减', '\\times': '乘以', '\\div': '除以',
            '=': '等于', '\\neq': '不等于', '\\approx': '约等于',
            '<': '小于', '>': '大于', '\\leq': '小于等于', '\\geq': '大于等于',
            '\\pm': '加减', '\\mp': '减加',
            '\\sqrt': '根号', '\\frac': '分式',
            '^': '的', '_': '下标',
            '\\infty': '无穷', '\\pi': '圆周率π',
            '\\sum': '求和', '\\int': '积分',
            '\\Delta': '德尔塔', '\\Sigma': '西格玛',
            '\\partial': '偏导',
        }
        
        # 仅处理简单AST（深度≤3，节点数≤20）
        if ast.complexity > 2:
            return None
        
        # 简单线性表达式的直接翻译
        if ast.root.type == 'equation':
            lhs = self._describe_node(ast.root.lhs, MATH_VOCAB)
            rhs = self._describe_node(ast.root.rhs, MATH_VOCAB)
            return f"{lhs}等于{rhs}"
        
        return None
    
    async def _llm_describe(self, ast: FormulaAST, 
                            language: str, context: str) -> str:
        """
        使用LLM生成复杂公式的自然语言描述
        """
        prompt = f"""请用简洁的{ '中文' if language == 'zh' else 'English'}描述以下数学公式，适合语音朗读：

LaTeX: {ast.latex}
变量: {', '.join(ast.variables)}
上下文: {context or '无'}

要求：
1. 使用口语化表达，便于朗读
2. 按照从左到右、先分子后分母、先被开方再开方的顺序
3. 不超过100字
4. 不要解释公式含义，只描述公式内容

示例：
输入: x = \\frac{{-b \\pm \\sqrt{{b^2 - 4ac}}}}{{2a}}
输出: x等于负b加减根号下b的平方减4ac，再除以2a
"""
        result = await self.llm.complete(
            prompt=prompt,
            max_tokens=100,
            temperature=0.1,  # 低温度保证一致性
        )
        
        return result.strip()
```

### 5.6 化学方程式处理

```python
class ChemistryFormulaHandler:
    """
    化学方程式专用处理器
    使用 mhchem / chemfig 语法
    """
    
    # 化学方程式常见模式
    REACTION_PATTERNS = [
        # 化学反应: A + B -> C + D
        (r'^[\w\s\(\)]+(\s*\+\s*[\w\s\(\)]+)*\s*->\s*', 'reaction'),
        # 可逆反应
        (r'<=>', 'equilibrium'),
        # 沉淀/气体标记
        (r'\\downarrow|\\uparrow|\\rightarrow', 'marker'),
    ]
    
    def parse(self, latex: str) -> ChemistryAST:
        """解析化学方程式"""
        if r'\ce{' in latex:
            return self._parse_mhchem(latex)
        elif r'\chemfig' in latex:
            return self._parse_chemfig(latex)
        else:
            raise FormulaParseError(f"Unknown chemistry format: {latex}")
    
    def _parse_mhchem(self, latex: str) -> ChemistryAST:
        """
        解析 mhchem 语法: \ce{2H2 + O2 -> 2H2O}
        """
        # 提取 \ce{} 内容
        match = re.search(r'\\ce\{([^}]+)\}', latex)
        if not match:
            raise FormulaParseError("Invalid \\ce{} syntax")
        
        equation = match.group(1)
        
        # 解析反应物和生成物
        if '->' in equation or '\\rightarrow' in equation:
            sides = re.split(r'(?:->|\\rightarrow)', equation)
            reactants = self._parse_compounds(sides[0])
            products = self._parse_compounds(sides[1]) if len(sides) > 1 else []
            
            return ChemistryAST(
                type='reaction',
                reactants=reactants,
                products=products,
                conditions=self._extract_conditions(equation),
                raw=equation,
            )
        
        # 单个化学式
        return ChemistryAST(
            type='compound',
            compound=self._parse_compound(equation.strip()),
            raw=equation,
        )
    
    def render_chemistry(self, ast: ChemistryAST, 
                         format: str) -> RenderOutput:
        """
        渲染化学方程式
        化学方程式不使用KaTeX，使用专用渲染器
        """
        # 转换为 MathJax 可识别的 mhchem 格式
        mathjax_latex = f'\\ce{{{ast.raw}}}'
        
        # 使用 MathJax mhchem 扩展渲染
        renderer = MathJaxNodeRenderer()
        renderer.input = TeX({
            packages: [...AllPackages, 'mhchem'],
        })
        
        if format == 'svg':
            return renderer.renderSVG(mathjax_latex)
        elif format == 'html':
            return renderer.renderHTML(mathjax_latex)
        else:
            return renderer.render(mathjax_latex, format)
```

---

## 6. 批量内容预处理管线

### 6.1 内容导入时的公式预处理

当大量题目、教材内容导入时，需要批量提取和预渲染公式。

```python
class FormulaBatchPipeline:
    """
    内容批量公式预处理管线
    用于: 题库导入、教材内容入库、AI生成内容后处理
    """
    
    BATCH_SIZE = 50  # 每批处理50条内容
    
    async def process_content_batch(
        self, 
        content_items: List[ContentItem],
        priority: str = 'normal'
    ) -> BatchProcessResult:
        """
        批量处理内容中的公式
        """
        results = []
        
        for item in content_items:
            try:
                # 1. 提取公式
                extracted = self.extractor.extract(item.content)
                
                # 2. 批量渲染（去重后）
                unique_formulas = self._deduplicate(extracted.formulas)
                render_results = await self._batch_render(unique_formulas)
                
                # 3. 记录公式引用关系
                for i, formula in enumerate(extracted.formulas):
                    render = render_results[formula.latex]
                    await self._record_reference(
                        formula_id=render.formula_id,
                        ref_type=item.type,
                        ref_id=item.id,
                        position=i,
                    )
                
                # 4. 预热缓存
                # 已在渲染时自动缓存
                
                results.append(ContentProcessResult(
                    content_id=item.id,
                    status='success',
                    formula_count=len(extracted.formulas),
                ))
                
            except Exception as e:
                logger.error(f"Failed to process content {item.id}: {e}")
                results.append(ContentProcessResult(
                    content_id=item.id,
                    status='error',
                    error=str(e),
                ))
        
        return BatchProcessResult(results=results)
    
    def _deduplicate(self, formulas: List[dict]) -> Dict[str, str]:
        """公式去重，同一LaTeX只渲染一次"""
        unique = {}
        for f in formulas:
            normalized = self.normalizer.normalize(f['latex'])
            if normalized.hash not in unique:
                unique[normalized.hash] = normalized.latex
        return unique
```

### 6.2 异步任务定义

```yaml
# Celery 任务定义
formula_batch_task:
  queue: formula_pipeline
  max_retries: 3
  retry_backoff: 30
  time_limit: 3600
  
formula_warmup_task:
  queue: formula_maintenance
  schedule: '0 3 * * *'   # 每日凌晨3点
  max_retries: 1
```

---

## 7. 公式知识点关联

### 7.1 自动关联策略

```python
class FormulaKnowledgeLinker:
    """
    将公式与知识图谱节点自动关联
    """
    
    async def auto_link(self, formula: FormulaEntity) -> List[str]:
        """
        根据公式内容自动关联知识点
        """
        kp_ids = []
        
        # 1. 基于主题标签的规则匹配
        if formula.topic_tags:
            rule_kps = await self._match_by_tags(formula.topic_tags, formula.subject)
            kp_ids.extend(rule_kps)
        
        # 2. 基于公式结构的模式匹配
        pattern_kps = await self._match_by_pattern(formula)
        kp_ids.extend(pattern_kps)
        
        # 3. 基于使用上下文的共现分析
        context_kps = await self._match_by_context(formula.id)
        kp_ids.extend(context_kps)
        
        # 去重
        unique_kp_ids = list(set(kp_ids))
        
        # 写入关联关系
        await self._save_links(formula.id, unique_kp_ids)
        
        return unique_kp_ids
    
    FORMULA_PATTERNS = {
        # 二次方程求根公式 → 二次方程知识点
        r'\\frac\{-b\s*\\pm\s*\\sqrt\{b\^2\s*-\s*4ac\}\}\{2a\}': 'KP_QUADRATIC_FORMULA',
        # 勾股定理 → 勾股定理知识点
        r'a\^2\s*\+\s*b\^2\s*=\s*c\^2': 'KP_PYTHAGOREAN',
        # 牛顿第二定律
        r'F\s*=\s*ma': 'KP_NEWTON_SECOND_LAW',
        # 质能方程
        r'E\s*=\s*mc\^2': 'KP_MASS_ENERGY',
        # 欧姆定律
        r'I\s*=\s*\\frac\{U\}\{R\}': 'KP_OHM_LAW',
    }
    
    async def _match_by_pattern(self, formula: FormulaEntity) -> List[str]:
        """通过公式模式匹配知识点"""
        kp_ids = []
        for pattern, kp_code in self.FORMULA_PATTERNS.items():
            if re.search(pattern, formula.canonical_latex):
                kp_id = await self._get_kp_id_by_code(kp_code)
                if kp_id:
                    kp_ids.append(kp_id)
        return kp_ids
```

---

## 8. 错误处理

### 8.1 错误码定义

| 错误码 | HTTP状态 | 含义 | 处理策略 |
| --- | --- | --- | --- |
| `FORMULA_001` | 400 | LaTeX 语法错误 | 返回错误位置和修正建议 |
| `FORMULA_002` | 400 | 包含危险命令（安全拦截） | 拒绝渲染，记录安全日志 |
| `FORMULA_003` | 400 | LaTeX 过长（>2000字符） | 拒绝处理 |
| `FORMULA_004` | 400 | 嵌套深度超限（>30层） | 拒绝处理 |
| `FORMULA_005` | 422 | 不支持的 LaTeX 宏/包 | 尝试降级渲染或返回原始文本 |
| `FORMULA_006` | 500 | 渲染引擎内部错误 | 降级到备用渲染器 |
| `FORMULA_007` | 500 | 渲染超时（>5秒） | 返回纯文本降级 |
| `FORMULA_008` | 503 | 缓存服务不可用 | 直接渲染（降级运行） |
| `FORMULA_009` | 500 | PNG 转换失败 | 返回 SVG 降级 |
| `FORMULA_010` | 422 | 化学方程式语法错误 | 返回错误位置 |

### 8.2 降级策略

```python
class FormulaErrorHandler:
    """
    公式渲染错误处理与降级策略
    """
    
    DEGRADATION_CHAIN = {
        'svg': ['svg', 'html', 'mathml', 'plaintext'],
        'png': ['png', 'svg', 'html', 'plaintext'],
        'html': ['html', 'mathml', 'plaintext'],
        'mathml': ['mathml', 'html', 'plaintext'],
    }
    
    async def render_with_fallback(
        self, latex: str, target_format: str, options: dict
    ) -> RenderResult:
        """
        按降级链尝试渲染
        """
        chain = self.DEGRADATION_CHAIN.get(target_format, ['plaintext'])
        
        for fmt in chain:
            try:
                result = await self.renderer.render(latex, fmt, options)
                if fmt != target_format:
                    logger.info(
                        f"Formula degraded: {target_format} → {fmt} "
                        f"for latex={latex[:50]}..."
                    )
                    result.degraded = True
                    result.original_format = target_format
                return result
                
            except FormulaSecurityError:
                raise  # 安全错误不可降级
                
            except (RenderError, TimeoutError) as e:
                logger.warning(f"Render failed for format {fmt}: {e}")
                continue
        
        # 所有格式都失败，返回纯文本
        return RenderResult(
            format='plaintext',
            content=self._latex_to_plaintext(latex),
            degraded=True,
            degraded_reason='all_renderers_failed',
        )
    
    def _latex_to_plaintext(self, latex: str) -> str:
        """LaTeX 降级为纯文本（去除命令，保留文字内容）"""
        # 移除 LaTeX 命令前缀
        text = re.sub(r'\\[a-zA-Z]+', '', latex)
        # 移除特殊字符
        text = re.sub(r'[{}^_]', '', text)
        return text.strip()
```

### 8.3 安全防护

```python
class FormulaSecurityValidator:
    """
    公式输入安全验证
    防止 LaTeX 注入攻击
    """
    
    # 危险命令（永远阻止）
    DANGEROUS_COMMANDS = [
        r'\\input',
        r'\\include',
        r'\\write\d?',
        r'\\openin',
        r'\\openout',
        r'\\closein',
        r'\\closeout',
        r'\\read\d?',
        r'\\immediate',
        r'\\special',
        r'\\shipout',
        r'\\bashEnvironment',
        r'\\url',
        r'\\href',
        r'\\run',
    ]
    
    # 限制命令（仅特定上下文允许）
    RESTRICTED_COMMANDS = [
        r'\\def',
        r'\\edef',
        r'\\let',
        r'\\newcommand',
        r'\\renewcommand',
        r'\\DeclareMathOperator',
    ]
    
    def validate(self, latex: str) -> ValidationResult:
        """验证 LaTeX 输入安全性"""
        # 1. 检查危险命令
        for cmd in self.DANGEROUS_COMMANDS:
            if re.search(cmd, latex):
                return ValidationResult(
                    valid=False,
                    error_code='FORMULA_002',
                    message=f'Blocked dangerous command: {cmd}',
                )
        
        # 2. 检查嵌套深度
        depth = 0
        max_depth = 0
        for char in latex:
            if char == '{':
                depth += 1
                max_depth = max(max_depth, depth)
            elif char == '}':
                depth -= 1
            if max_depth > 30:
                return ValidationResult(
                    valid=False,
                    error_code='FORMULA_004',
                    message=f'Nesting depth {max_depth} exceeds limit 30',
                )
        
        # 3. 检查总长度
        if len(latex) > 2000:
            return ValidationResult(
                valid=False,
                error_code='FORMULA_003',
                message=f'LaTeX length {len(latex)} exceeds limit 2000',
            )
        
        # 4. 检查非ASCII字符（可能包含隐藏攻击）
        non_ascii = sum(1 for c in latex if ord(c) > 127)
        if non_ascii > 100:
            return ValidationResult(
                valid=False,
                error_code='FORMULA_002',
                message=f'Too many non-ASCII characters: {non_ascii}',
            )
        
        return ValidationResult(valid=True)
```

---

## 9. 性能优化

### 9.1 性能指标

| 指标 | 目标值 | 说明 |
| --- | --- | --- |
| 缓存命中响应 P99 | < 20ms | Redis 查询 + 序列化 |
| 首次渲染响应 P99 | < 300ms | 解析 + 渲染 + 缓存写入 |
| 批量渲染吞吐 | ≥ 100 公式/秒 | 单节点 |
| 化学方程式渲染 P99 | < 500ms | mhchem 解析较慢 |
| PNG 生成 P99 | < 800ms | 含 S3 上传 |
| 并发渲染能力 | 200 并发 | 单节点连接池 |

### 9.2 关键优化措施

```python
# 1. 公式去重（同一内容中大量重复公式）
class FormulaDeduplicator:
    """
    在批量处理时，对相同canonical hash的公式只渲染一次
    """
    def deduplicate_and_render(self, formulas: List[str], format: str):
        # 规范化并去重
        unique_map = {}
        for latex in formulas:
            normalized = self.normalizer.normalize(latex)
            if normalized.hash not in unique_map:
                unique_map[normalized.hash] = normalized.latex
        
        # 只渲染唯一的
        render_results = {}
        for hash_val, canonical_latex in unique_map.items():
            result = self.renderer.render(canonical_latex, format)
            render_results[hash_val] = result
        
        # 映射回原始顺序
        return [
            render_results[self.normalizer.normalize(latex).hash]
            for latex in formulas
        ]

# 2. 预连接池管理
class RendererPool:
    """
    MathJax 渲染器连接池
    Puppeteer/MathJax-node 实例复用
    """
    def __init__(self, pool_size=4):
        self.pool = asyncio.Semaphore(pool_size)
        self.renderers = asyncio.Queue()
        for _ in range(pool_size):
            await self.renderers.put(self._create_renderer())
    
    async def acquire(self):
        await self.pool.acquire()
        return await self.renderers.get()
    
    async def release(self, renderer):
        await self.renderers.put(renderer)
        self.pool.release()

# 3. 异步并行渲染
async def parallel_render(formulas: List[str], format: str, max_concurrency=10):
    """
    并行渲染多个公式
    """
    semaphore = asyncio.Semaphore(max_concurrency)
    
    async def render_one(latex):
        async with semaphore:
            return await render_service.render(latex, format)
    
    return await asyncio.gather(*[render_one(f) for f in formulas])
```

### 9.3 Redis 缓存配置建议

```yaml
# Redis 配置建议
formula_cache:
  maxmemory: 512mb
  maxmemory-policy: allkeys-lru
  eviction_policy: volatile-ttl
  
  # 公式缓存key前缀
  key_prefix: "formula:"
  
  # 默认TTL
  default_ttl: 604800  # 7天
  
  # 热点公式永不过期
  hot_formula_ttl: null  # 永不过期
```

---

## 10. 部署架构

### 10.1 服务部署

```yaml
# Kubernetes Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: formula-pipeline-service
spec:
  replicas: 3                    # 3副本起步
  template:
    spec:
      containers:
        - name: formula-service
          image: primetop/formula-pipeline:latest
          resources:
            requests:
              cpu: 500m
              memory: 1Gi
            limits:
              cpu: 2000m
              memory: 2Gi
          env:
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: formula-secrets
                  key: redis-url
            - name: S3_BUCKET
              value: primetop-formula-cache
            - name: MATHJAX_POOL_SIZE
              value: "4"
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 30
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            initialDelaySeconds: 10
```

### 10.2 依赖服务

| 依赖 | 规格 | 用途 |
| --- | --- | --- |
| Redis | 512MB-1GB | 公式渲染缓存 |
| MySQL | 公式实体表、渲染缓存表、引用表 | 持久化存储 |
| S3/MinIO | 10GB起步 | PNG/SVG 图片存储 |
| Elasticsearch | formula_entities索引 | 公式全文搜索 |

---

## 11. 监控指标

### 11.1 核心指标

| 指标名 | 类型 | 说明 |
| --- | --- | --- |
| `formula.render.total` | Counter | 渲染请求总数 |
| `formula.render.cache.hit_rate` | Gauge | 缓存命中率 |
| `formula.render.duration` | Histogram | 渲染耗时分布 |
| `formula.render.error.rate` | Gauge | 渲染错误率 |
| `formula.parse.duration` | Histogram | 解析耗时分布 |
| `formula.batch.items` | Counter | 批量处理公式数 |
| `formula.degradation.rate` | Gauge | 降级渲染比例 |
| `formula.security.block.count` | Counter | 安全拦截次数 |
| `formula.alttext.llm.call` | Counter | LLM生成alt-text调用次数 |
| `formula.entity.total` | Gauge | 已入库公式实体总数 |

### 11.2 告警规则

```yaml
groups:
  - name: formula_pipeline
    rules:
      - alert: FormulaCacheHitRateLow
        expr: formula.render.cache.hit_rate < 0.80
        for: 10m
        annotations:
          summary: "公式缓存命中率低于80%"
      
      - alert: FormulaRenderLatencyHigh
        expr: histogram_quantile(0.99, formula.render.duration) > 0.5
        for: 5m
        annotations:
          summary: "公式渲染P99延迟超过500ms"
      
      - alert: FormulaErrorRateHigh
        expr: formula.render.error.rate > 0.05
        for: 5m
        annotations:
          summary: "公式渲染错误率超过5%"
      
      - alert: FormulaSecurityBlock
        expr: rate(formula.security.block.count[5m]) > 10
        for: 2m
        annotations:
          summary: "公式安全拦截频繁触发，可能存在攻击"
```

---

## 12. 开发任务拆解

### 12.1 开发排期建议

| 阶段 | 任务 | 工作量 | 优先级 |
| --- | --- | --- | --- |
| P0-W1 | LaTeX 解析器 + 规范化器 | 3天 | P0 |
| P0-W1 | KaTeX SSR 渲染器集成 | 2天 | P0 |
| P0-W1 | Redis 缓存层 | 2天 | P0 |
| P0-W2 | 单公式渲染API | 1天 | P0 |
| P0-W2 | 公式安全验证器 | 1天 | P0 |
| P0-W2 | 富文本公式提取器 | 2天 | P0 |
| P0-W2 | 批量渲染API | 2天 | P0 |
| P1-W3 | MathJax 备用渲染器 | 3天 | P1 |
| P1-W3 | 化学方程式渲染 | 2天 | P1 |
| P1-W3 | 数据库表设计与迁移 | 1天 | P1 |
| P1-W4 | SSE流式公式处理 | 3天 | P1 |
| P1-W4 | 公式知识点自动关联 | 2天 | P1 |
| P2-W5 | Alt-text 规则引擎 | 2天 | P2 |
| P2-W5 | Alt-text LLM生成 | 2天 | P2 |
| P2-W5 | 公式搜索接口 | 2天 | P2 |
| P2-W6 | 批量预处理管线 | 3天 | P2 |
| P2-W6 | 缓存预热调度 | 2天 | P2 |
| P2-W6 | 监控指标埋点 | 1天 | P2 |

### 12.2 测试要点

| 测试项 | 说明 |
| --- | --- |
| LaTeX 解析覆盖率 | 覆盖中小学全学段常见数学公式 |
| 化学方程式覆盖 | 初中化学到高中化学常见方程式 |
| 安全验证 | SQL注入、LaTeX注入、XSS注入测试 |
| 缓存一致性 | 规范化后不同写法的公式缓存命中 |
| 降级链验证 | 每个降级路径可达且正确 |
| 并发性能 | 200并发下的响应时间和错误率 |
| 批量处理准确性 | 提取→渲染→替换的完整性验证 |
| SSE流式处理 | 公式跨多个chunk到达时的正确处理 |
| 公式搜索 | LaTeX相似度搜索的准确率 |

---

## 13. 附录

### 13.1 常见学科公式 LaTeX 示例

```latex
% --- 数学 ---
% 二次方程求根公式
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}

% 勾股定理
a^2 + b^2 = c^2

% 三角函数
\sin^2\theta + \cos^2\theta = 1

% 微积分
\int_0^{\infty} e^{-x^2} dx = \frac{\sqrt{\pi}}{2}

% 矩阵
A = \begin{pmatrix} a_{11} & a_{12} \\ a_{21} & a_{22} \end{pmatrix}

% --- 物理 ---
% 牛顿第二定律
\vec{F} = m\vec{a}

% 麦克斯韦方程组
\nabla \cdot \vec{E} = \frac{\rho}{\varepsilon_0}

% --- 化学 ---
% 水的化合
\ce{2H2 + O2 -> 2H2O}

% 氧化还原
\ce{Fe^{2+} -> Fe^{3+} + e^-}

% 有机化学结构
\chemfig{C(-[2]H)(-[6]H)(-[4]H)-[0]H}
```

### 13.2 规范化对照表

| 原始写法 | 规范化结果 | Hash |
| --- | --- | --- |
| `x^2` | `x^{2}` | 同 |
| `x ^ 2` | `x^{2}` | 同 |
| `$x=1$` | `x=1` | 同（去除定界符） |
| `\frac 1 2` | `\frac{1}{2}` | 同 |
| `x _ { n }` | `x_{n}` | 同 |
| `\alpha+\beta` | `\alpha+\beta` | 同 |

### 13.3 字号渲染对照

| 字号 | 场景 | width(px)示例 | height(px)示例 |
| --- | --- | --- | --- |
| 14 | 行内小字 | ~80 | ~20 |
| 16 | 默认行内 | ~100 | ~24 |
| 18 | 题目正文 | ~120 | ~28 |
| 20 | 重要公式 | ~140 | ~32 |
| 24 | 块级展示 | ~180 | ~40 |

---

*文档版本：v1.0*
*创建日期：2026-08-11*
*模块负责：PrimeTop 后端团队*
