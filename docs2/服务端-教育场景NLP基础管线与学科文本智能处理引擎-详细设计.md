# 服务端-教育场景NLP基础管线与学科文本智能处理引擎-详细设计

## 1. 概述

### 1.1 功能定位

教育场景 NLP 基础管线是 PrimeTop 平台的底层文本处理基础设施，为上层所有 AI 能力（智能辅导、题目解析、知识点标注、难度评估、内容审核、搜索推荐等）提供统一的自然语言预处理、学科实体识别、公式解析、文本难度评估和意图分类能力。

本引擎是跨模块复用的基础服务，不直接面向终端用户，而是作为共享 SDK + 微服务对外提供能力。

### 1.2 设计目标

| 目标 | 说明 |
| --- | --- |
| 统一预处理 | 所有 AI 模块共享同一套文本清洗、分词、实体识别管线，避免重复建设 |
| 学科感知 | 针对 K12 教育场景的数学公式、化学方程式、物理符号、英语语法做专门解析 |
| 高性能 | 单文本预处理 < 50ms（排除 LLM 调用），支持批处理 1000 条/秒 |
| 可组合 | 各子模块可独立调用，也可编排为 DAG 流水线 |
| 多语言 | 支持中文（简体/繁体）和英文文本处理，适配双语教学场景 |

### 1.3 适用范围

| 调用方 | 典型场景 |
| --- | --- |
| AI 辅导对话 | 用户输入预处理、意图识别、学科路由 |
| 拍照搜题 | OCR 后文本清洗、公式结构化、题目分割 |
| 题库管理 | 题目知识点自动标注、难度评估、题型识别 |
| 内容服务 | 教材内容分段、摘要生成预处理、术语提取 |
| 搜索引擎 | 查询理解、同义词扩展、学科分类 |
| 学情分析 | 答题文本分析、错因关键词提取 |
| 作文批改 | 文本纠错预处理、语法分析、词汇丰富度评估 |
| 内容审核 | 敏感词检测、变体识别、上下文语义审核 |

---

## 2. 系统架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        调用方（AI辅导 / 题库 / 搜索 / 审核）           │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ gRPC / REST API
┌──────────────────────────────▼──────────────────────────────────────┐
│                      NLP 管线编排层 (Pipeline Orchestrator)           │
│                   ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│                   │ 预设管线  │ │ 自定义DAG │ │ 单步调用  │            │
│                   └────┬─────┘ └────┬─────┘ └────┬─────┘            │
└────────────────────────┼────────────┼────────────┼─────────────────┘
                         │            │            │
┌────────────────────────▼────────────▼────────────▼─────────────────┐
│                           NLP 核心处理层                              │
│                                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ 文本清洗  │ │ 中文分词  │ │ 实体识别  │ │ 公式解析  │ │ 难度评估  │ │
│  │ 标准化    │ │ 词典管理  │ │ 学科路由  │ │ 符号处理  │ │ 可读性    │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
│                                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ 意图分类  │ │ 语法分析  │ │ 术语提取  │ │ 文本摘要  │ │ 语义相似  │ │
│  │ 问题路由  │ │ 依存句法  │ │ 词汇表    │ │ 预处理    │ │ 度计算    │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
└────────────────────────────────────────────────────────────────────-┘
                         │
┌────────────────────────▼───────────────────────────────────────────┐
│                        基础设施层                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ 模型仓库  │ │ 词典仓库  │ │ 规则仓库  │ │ 缓存层    │ │ 指标监控  │ │
│  │ HanLP    │ │ 学科词典  │ │ 正则库    │ │ Redis    │ │ Prometheus│ │
│  │ spaCy    │ │ 停用词    │ │ OCR纠错   │ │ L1/L2    │ │ Grafana  │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 技术选型

| 组件 | 选型 | 理由 |
| --- | --- | --- |
| 中文分词 | HanLP 2.x / Jieba | HanLP 学术实体识别强，Jieba 轻量兜底 |
| 英文处理 | spaCy (en_core_web_md) | 工业级 NLP，语法分析完善 |
| 数学公式 | KaTeX parser + 自研 LaTeX 规范化器 | 兼容 OCR 输出的半结构化公式 |
| 化学方程式 | 自研 ChemFormula Parser | 教育场景需配平方程式、状态标注 |
| 深度模型 | ONNX Runtime + Transformer（BERT/RoBERTa） | 意图分类、文本分类 |
| 向量计算 | FAISS / pgvector | 语义相似度计算 |
| 编排引擎 | 自研 DAG Executor（轻量） | 避免引入 Airflow 重型调度 |
| 缓存 | Redis（二级：L1 进程内 LRU + L2 Redis） | 高频短文本重复处理 |

---

## 3. 核心数据结构

### 3.1 NLP 处理请求与响应

```python
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field
from datetime import datetime


class NLPTaskType(str, Enum):
    """NLP 任务类型枚举"""
    FULL_PIPELINE = "full_pipeline"          # 完整管线
    TEXT_CLEAN = "text_clean"                # 仅文本清洗
    TOKENIZE = "tokenize"                    # 仅分词
    ENTITY_RECOGNITION = "ner"               # 实体识别
    FORMULA_PARSE = "formula_parse"          # 公式解析
    DIFFICULTY_ASSESS = "difficulty"         # 难度评估
    INTENT_CLASSIFY = "intent"               # 意图分类
    SYNTAX_ANALYSIS = "syntax"               # 语法分析
    TERM_EXTRACT = "term_extract"            # 术语提取
    READABILITY = "readability"              # 可读性评估
    SUBJECT_CLASSIFY = "subject"             # 学科分类


class SubjectType(str, Enum):
    """学科类型"""
    CHINESE = "chinese"
    MATH = "math"
    ENGLISH = "english"
    PHYSICS = "physics"
    CHEMISTRY = "chemistry"
    BIOLOGY = "biology"
    HISTORY = "history"
    GEOGRAPHY = "geography"
    POLITICS = "politics"
    INFORMATION_TECH = "information_tech"
    GENERAL = "general"                      # 通用/未分类


class NLPRequest(BaseModel):
    """NLP 处理请求"""
    request_id: str = Field(..., description="请求唯一ID")
    text: str = Field(..., max_length=10000, description="待处理文本")
    task_type: NLPTaskType = Field(default=NLPTaskType.FULL_PIPELINE)
    subject_hint: Optional[SubjectType] = Field(
        None, description="学科提示（可选，提升处理精度）"
    )
    grade_hint: Optional[str] = Field(
        None, description="年级提示，如 'grade_7', 'high_school_2'"
    )
    enable_formula: bool = Field(True, description="是否启用公式解析")
    enable_syntax: bool = Field(
        False, description="是否启用语法分析（较慢，按需开启）"
    )
    enable_cache: bool = Field(True, description="是否启用缓存")
    custom_config: Optional[dict] = Field(
        None, description="自定义配置覆盖（词典版本、模型版本等）"
    )


class NLPToken(BaseModel):
    """分词 Token"""
    text: str = Field(..., description="词/字")
    pos: str = Field("", description="词性标注")
    lemma: str = Field("", description="词元/原形")
    is_stop: bool = Field(False, description="是否停用词")
    start: int = Field(..., description="起始字符偏移")
    end: int = Field(..., description="结束字符偏移")


class NLPEntity(BaseModel):
    """命名实体"""
    text: str = Field(..., description="实体文本")
    entity_type: str = Field(..., description="实体类型")
    subject: SubjectType = Field(
        SubjectType.GENERAL, description="所属学科"
    )
    start: int = Field(..., description="起始偏移")
    end: int = Field(..., description="结束偏移")
    confidence: float = Field(..., ge=0.0, le=1.0)
    metadata: dict = Field(
        default_factory=dict, description="实体附加信息"
    )


class FormulaNode(BaseModel):
    """数学公式解析节点"""
    raw_latex: str = Field(..., description="原始 LaTeX 字符串")
    normalized_latex: str = Field(..., description="规范化后的 LaTeX")
    formula_type: str = Field(
        ..., description="公式类型: equation/inequality/expression/fraction/etc"
    )
    variables: list[str] = Field(
        default_factory=list, description="变量列表"
    )
    constants: list[str] = Field(
        default_factory=list, description="常数列表"
    )
    has_integral: bool = False
    has_derivative: bool = False
    has_matrix: bool = False
    has_summation: bool = False


class ChemicalEquation(BaseModel):
    """化学方程式解析结果"""
    raw_text: str = Field(..., description="原始文本")
    reactants: list[str] = Field(default_factory=list, description="反应物")
    products: list[str] = Field(default_factory=list, description="生成物")
    conditions: list[str] = Field(
        default_factory=list, description="反应条件（催化剂/温度/压强等）"
    )
    is_balanced: Optional[bool] = Field(
        None, description="是否已配平"
    )
    equation_type: str = Field(
        "", description="反应类型: synthesis/decomposition/replacement/etc"
    )


class DifficultyAssessment(BaseModel):
    """难度评估结果"""
    difficulty_score: float = Field(
        ..., ge=0.0, le=1.0, description="难度分（0=最易, 1=最难）"
    )
    difficulty_level: str = Field(
        ..., description="难度档位: easy/medium/hard/expert"
    )
    estimated_grade: str = Field(
        ..., description="估算适用年级"
    )
    factors: dict = Field(
        default_factory=dict,
        description="难度因子分解: {vocab_complexity, sentence_length, concept_density, ...}",
    )
    confidence: float = Field(..., ge=0.0, le=1.0)


class IntentResult(BaseModel):
    """意图分类结果"""
    primary_intent: str = Field(
        ..., description="主意图: question/solve/explain/summarize/translate/chat/feedback"
    )
    secondary_intent: Optional[str] = Field(None, description="次意图")
    confidence: float = Field(..., ge=0.0, le=1.0)
    is_off_topic: bool = Field(
        False, description="是否判定为脱离学习场景"
    )
    detected_subject: SubjectType = Field(
        SubjectType.GENERAL, description="自动检测到的学科"
    )


class NLPResponse(BaseModel):
    """NLP 处理响应"""
    request_id: str
    task_type: NLPTaskType
    success: bool
    processed_text: str = Field(
        "", description="清洗后的标准化文本"
    )
    tokens: list[NLPToken] = Field(default_factory=list)
    entities: list[NLPEntity] = Field(default_factory=list)
    formulas: list[FormulaNode] = Field(default_factory=list)
    chemical_equations: list[ChemicalEquation] = Field(
        default_factory=list
    )
    difficulty: Optional[DifficultyAssessment] = None
    intent: Optional[IntentResult] = None
    detected_subject: SubjectType = SubjectType.GENERAL
    readability_score: Optional[float] = None
    processing_time_ms: float = Field(0.0, description="处理耗时(ms)")
    cache_hit: bool = False
    errors: list[str] = Field(default_factory=list)
    timestamp: datetime = Field(default_factory=datetime.utcnow)
```

### 3.2 词典与规则数据结构

```sql
-- 学科领域词典
CREATE TABLE nlp_subject_dictionary (
    id              BIGSERIAL PRIMARY KEY,
    term            VARCHAR(200) NOT NULL,         -- 术语/词汇
    term_normalized VARCHAR(200) NOT NULL,         -- 规范化形式
    subject         VARCHAR(50)  NOT NULL,         -- 学科
    term_type       VARCHAR(50)  NOT NULL,         -- concept/person/formula/law/etc
    grade_min       VARCHAR(20),                   -- 最低适用年级
    grade_max       VARCHAR(20),                   -- 最高适用年级
    definition      TEXT,                          -- 术语释义
    synonyms        JSONB DEFAULT '[]',            -- 同义词/近义词
    related_terms   JSONB DEFAULT '[]',            -- 关联术语
    source          VARCHAR(100) DEFAULT 'manual', -- manual/auto/imported
    confidence      FLOAT DEFAULT 1.0,
    status          VARCHAR(20) DEFAULT 'active',  -- active/deprecated
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(term_normalized, subject)
);

CREATE INDEX idx_dict_term ON nlp_subject_dictionary(term);
CREATE INDEX idx_dict_subject ON nlp_subject_dictionary(subject, status);
CREATE INDEX idx_dict_term_gin ON nlp_subject_dictionary USING gin(to_tsvector('simple', term));

-- 意图分类训练样本
CREATE TABLE nlp_intent_training_data (
    id              BIGSERIAL PRIMARY KEY,
    text            TEXT NOT NULL,
    label           VARCHAR(50) NOT NULL,
    subject         VARCHAR(50),
    grade           VARCHAR(20),
    confidence      FLOAT DEFAULT 1.0,
    is_verified     BOOLEAN DEFAULT FALSE,
    annotator       VARCHAR(100),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 难度评估特征样本
CREATE TABLE nlp_difficulty_sample (
    id              BIGSERIAL PRIMARY KEY,
    text_hash       VARCHAR(64) NOT NULL,
    text            TEXT NOT NULL,
    subject         VARCHAR(50) NOT NULL,
    grade           VARCHAR(20) NOT NULL,
    human_rating    FLOAT,                        -- 人工标注难度 0-1
    auto_rating     FLOAT,                        -- 算法评估难度 0-1
    features        JSONB NOT NULL,               -- 特征向量
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(text_hash, subject)
);

-- 管线配置版本
CREATE TABLE nlp_pipeline_config (
    id              BIGSERIAL PRIMARY KEY,
    version         VARCHAR(50) NOT NULL UNIQUE,
    config          JSONB NOT NULL,               -- 完整管线配置
    description     TEXT,
    is_active       BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 4. NLP 管线核心模块

### 4.1 文本预处理与标准化（TextNormalizer）

负责将输入文本统一为标准化格式，处理 OCR 噪声、全半角混用、特殊字符等问题。

```python
import re
import unicodedata
from typing import Optional


class TextNormalizer:
    """文本标准化处理器"""

    # OCR 常见错误映射表
    OCR_FIX_MAP = {
        '．': '.', '，': ',', '：': ':', '；': ';',
        '（': '(', '）': ')', '＜': '<', '＞': '>',
        '＝': '=', '＋': '+', '－': '-', '×': '×',
        '÷': '÷', '≤': '≤', '≥': '≥', '≠': '≠',
        '∼': '~', '≈': '≈', '∞': '∞',
        # OCR 易混淆字符
        'l': '1',  # 仅在数学上下文
        'O': '0',  # 仅在数学上下文
        'rn': 'm',  # OCR 断字修复
    }

    # 数学上下文关键词（用于判断是否执行数字修正）
    MATH_CONTEXT_MARKERS = {
        '计算', '求解', '方程', '函数', '已知', '求',
        '等于', '加', '减', '乘', '除', '证明', '化简',
        'calculate', 'solve', 'equation', 'function', 'prove',
    }

    # 全角→半角转换
    @staticmethod
    def fullwidth_to_halfwidth(text: str) -> str:
        result = []
        for char in text:
            code = ord(char)
            if code == 0x3000:          # 全角空格
                result.append(' ')
            elif 0xFF01 <= code <= 0xFF5E:  # 全角字符
                result.append(chr(code - 0xFEE0))
            else:
                result.append(char)
        return ''.join(result)

    # Unicode NFC 规范化
    @staticmethod
    def unicode_normalize(text: str) -> str:
        return unicodedata.normalize('NFC', text)

    # 清除不可见字符与控制字符
    @staticmethod
    def remove_invisible_chars(text: str) -> str:
        # 保留换行符、制表符
        cleaned = []
        for char in text:
            cat = unicodedata.category(char)
            if cat == 'Cc' and char not in ('\n', '\r', '\t'):
                continue
            if cat in ('Cf',):           # 格式字符（零宽空格等）
                continue
            if cat in ('Mn', 'Me') and ord(char) > 0x0300:
                # 保留部分有意义的组合附加符号
                continue
            cleaned.append(char)
        return ''.join(cleaned)

    # 多余空白合并
    @staticmethod
    def collapse_whitespace(text: str) -> str:
        # 保留段落间换行，合并行内多空格
        lines = text.split('\n')
        cleaned_lines = [re.sub(r'[ \t]+', ' ', line.strip()) for line in lines]
        # 合并连续空行
        result = '\n'.join(cleaned_lines)
        result = re.sub(r'\n{3,}', '\n\n', result)
        return result.strip()

    # OCR 纠错（上下文感知）
    def fix_ocr_errors(self, text: str, is_math_context: bool = False) -> str:
        # 全角标点统一
        for full, half in self.OCR_FIX_MAP.items():
            if not is_math_context and full in ('l', 'O', 'rn'):
                continue  # 非数学上下文不修正字母
            text = text.replace(full, half)

        # 修复常见 OCR 断裂
        text = re.sub(r'([！-~])\s+([！-~])', r'\1\2', text)  # 英文/数字间多余空格
        return text

    # LaTeX 定界符标准化
    @staticmethod
    def normalize_latex_delimiters(text: str) -> str:
        # $...$ 和 \(...\) 统一为 \(...\)
        text = re.sub(r'(?<!\\)\$([^$]+?)(?<!\\)\$', r'\\(\1\\)', text)
        # $$...$$ 和 \[...\] 统一为 \[...\]
        text = re.sub(r'\$\$([^$]+?)\$\$', r'\\[\1\\]', text)
        return text

    # 主入口
    def normalize(
        self,
        text: str,
        is_math_context: Optional[bool] = None,
        fix_latex: bool = True,
    ) -> str:
        if not text or not text.strip():
            return ""

        # 自动检测数学上下文
        if is_math_context is None:
            is_math_context = any(
                marker in text for marker in self.MATH_CONTEXT_MARKERS
            )

        text = self.unicode_normalize(text)
        text = self.fullwidth_to_halfwidth(text)
        text = self.remove_invisible_chars(text)
        text = self.fix_ocr_errors(text, is_math_context)
        text = self.collapse_whitespace(text)

        if fix_latex:
            text = self.normalize_latex_delimiters(text)

        return text
```

### 4.2 中文分词与学科词典管理（Tokenizer）

```python
import hashlib
from typing import Protocol


class TokenizerBackend(Protocol):
    """分词后端接口"""

    def tokenize(self, text: str, subject: str | None = None) -> list[dict]:
        ...

    def add_words(self, words: list[tuple[str, str]]) -> None:
        ...


class HanLPBackend:
    """HanLP 后端：学术场景、实体识别强"""

    def __init__(self, config_path: str):
        import hanlp
        self.tokenizer = hanlp.load(hanlp.pretrained.tok.CTB9_BERT_BASE)
        self.pos_tagger = hanlp.load(hanlp.pretrained.pos.CTB9_BERT_BASE)
        self.ner = hanlp.load(hanlp.pretrained.ner.MSRA_BERT_BASE_ZH)
        self._custom_words: set[str] = set()

    def tokenize(self, text: str, subject: str | None = None) -> list[dict]:
        tokens = self.tokenizer(text)
        pos_tags = self.pos_tagger(tokens)
        entities = self.ner(text)

        result = []
        offset = 0
        for word, pos in zip(tokens, pos_tags):
            start = text.find(word, offset)
            end = start + len(word)
            offset = end
            result.append({
                'text': word,
                'pos': pos,
                'start': start,
                'end': end,
                'is_stop': word in self._custom_words,
            })
        return result

    def add_words(self, words: list[tuple[str, str]]) -> None:
        for word, pos in words:
            self._custom_words.add(word)
            # HanLP 动态词典插入
        # 实际实现中调用 hanlp 的自定义词典接口


class JiebaBackend:
    """Jieba 后端：轻量快速兜底"""

    def __init__(self):
        import jieba
        import jieba.posseg as pseg
        self.jieba = jieba
        self.pseg = pseg

    def tokenize(self, text: str, subject: str | None = None) -> list[dict]:
        result = []
        offset = 0
        for word, flag in self.pseg.cut(text):
            if not word.strip():
                continue
            start = text.find(word, offset)
            if start == -1:
                start = offset
            end = start + len(word)
            offset = end
            result.append({
                'text': word,
                'pos': flag,
                'start': start,
                'end': end,
                'is_stop': False,
            })
        return result

    def add_words(self, words: list[tuple[str, str]]) -> None:
        for word, freq in words:
            self.jieba.add_word(word, freq=int(freq) or 1000)


class SubjectAwareTokenizer:
    """学科感知分词器：根据学科加载不同词典"""

    def __init__(
        self,
        primary: TokenizerBackend,
        fallback: TokenizerBackend,
        dict_loader: "SubjectDictLoader",
    ):
        self.primary = primary
        self.fallback = fallback
        self.dict_loader = dict_loader
        self._loaded_subjects: set[str] = set()

    def ensure_subject_dict(self, subject: str) -> None:
        """确保对应学科的词典已加载"""
        if subject in self._loaded_subjects:
            return
        words = self.dict_loader.load_terms(subject)
        if words:
            self.primary.add_words(words)
        self._loaded_subjects.add(subject)

    def tokenize(
        self,
        text: str,
        subject: str | None = None,
    ) -> list[dict]:
        if subject:
            self.ensure_subject_dict(subject)
        try:
            return self.primary.tokenize(text, subject)
        except Exception:
            return self.fallback.tokenize(text, subject)


class SubjectDictLoader:
    """学科词典加载器"""

    def __init__(self, db_conn_str: str, cache_ttl: int = 3600):
        import redis
        self.redis = redis.from_url(db_conn_str)
        self.cache_ttl = cache_ttl
        # 数据库连接初始化...

    def load_terms(self, subject: str) -> list[tuple[str, str]]:
        """从数据库加载学科术语词典"""
        cache_key = f"nlp:dict:{subject}"
        cached = self.redis.get(cache_key)
        if cached:
            import json
            return [tuple(item) for item in json.loads(cached)]

        # 数据库查询
        # SELECT term, term_type FROM nlp_subject_dictionary
        #     WHERE subject = %s AND status = 'active'
        terms = self._query_db(subject)
        if terms:
            import json
            self.redis.setex(
                cache_key, self.cache_ttl,
                json.dumps(terms),
            )
        return terms

    def refresh_cache(self, subject: str) -> None:
        """强制刷新学科词典缓存"""
        self.redis.delete(f"nlp:dict:{subject}")
        self.load_terms(subject)

    def _query_db(self, subject: str) -> list[list[str]]:
        # 实际数据库查询
        ...
```

### 4.3 学科实体识别（SubjectEntityRecognizer）

```python
import re
from dataclasses import dataclass


@dataclass
class EntityPattern:
    """实体匹配规则"""
    entity_type: str
    pattern: str                          # 正则表达式
    subject: str                          # 学科
    extractor: callable = None            # 自定义提取逻辑


class SubjectEntityRecognizer:
    """学科命名实体识别器"""

    # 数学实体模式
    MATH_PATTERNS = [
        EntityPattern(
            entity_type="math_formula",
            pattern=r'\\\[.*?\\\]|\\\(.*?\\\)','=',$',
            subject="math",
        ),
        EntityPattern(
            entity_type="math_fraction",
            pattern=r'\d+\s*/\s*\d+',
            subject="math",
        ),
        EntityPattern(
            entity_type="math_percentage",
            pattern=r'\d+(\.\d+)?%',
            subject="math",
        ),
        EntityPattern(
            entity_type="math_power",
            pattern=r'\w+\^[\d\-]+',
            subject="math",
        ),
        EntityPattern(
            entity_type="math_coordinate",
            pattern=r'\(\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*\)',
            subject="math",
        ),
    ]

    # 化学实体模式
    CHEMISTRY_PATTERNS = [
        EntityPattern(
            entity_type="chemical_formula",
            pattern=r'(?:[A-Z][a-z]?\d*){2,}',
            subject="chemistry",
        ),
        EntityPattern(
            entity_type="chemical_equation",
            pattern=r'.+?\s*(?:→|->|=)\s*.+',
            subject="chemistry",
        ),
    ]

    # 物理实体模式
    PHYSICS_PATTERNS = [
        EntityPattern(
            entity_type="physics_unit",
            pattern=r'\d+(\.\d+)?\s*(?:m/s|kg|N|J|W|V|A|Ω|Hz|Pa|Wb|T|F|H|eV|cd|lm|lx|Bq|Gy|Sv|kat|mol|K|℃|°C)',
            subject="physics",
        ),
        EntityPattern(
            entity_type="physics_vector",
            pattern=r'[→←↑↓↗↘↙↖]',
            subject="physics",
        ),
    ]

    # 英语语法模式
    ENGLISH_PATTERNS = [
        EntityPattern(
            entity_type="en_tense_marker",
            pattern=r'\b(has|have|had|will|would|shall|should|is|am|are|was|were)\b',
            subject="english",
        ),
        EntityPattern(
            entity_type="en_phrase",
            pattern=r'\b\w+\s+(?:to|of|for|in|on|at|by|with|from)\s+\w+\b',
            subject="english",
        ),
    ]

    # 中文古诗文模式
    CHINESE_PATTERNS = [
        EntityPattern(
            entity_type="classical_quote",
            pattern=r'["""].*?[""]',
            subject="chinese",
        ),
        EntityPattern(
            entity_type="dynasty_ref",
            pattern=r'(?:唐|宋|元|明|清|汉|魏晋|南北朝|春秋|战国)(?:代|朝)?',
            subject="chinese",
        ),
        EntityPattern(
            entity_type="poem_title",
            pattern=r'《.+?》',
            subject="chinese",
        ),
    ]

    def __init__(self):
        self._all_patterns = {
            "math": self.MATH_PATTERNS,
            "chemistry": self.CHEMISTRY_PATTERNS,
            "physics": self.PHYSICS_PATTERNS,
            "english": self.ENGLISH_PATTERNS,
            "chinese": self.CHINESE_PATTERNS,
        }
        self._compiled = self._compile_all()

    def _compile_all(self) -> dict[str, list[tuple[str, re.Pattern, str]]]:
        compiled = {}
        for subject, patterns in self._all_patterns.items():
            compiled[subject] = [
                (p.entity_type, re.compile(p.pattern, re.MULTILINE), p.subject)
                for p in patterns
            ]
        return compiled

    def recognize(
        self,
        text: str,
        subject_hint: str | None = None,
    ) -> list[dict]:
        """识别文本中的学科实体"""
        entities = []

        # 如果有学科提示，优先处理该学科
        subjects_to_check = (
            [subject_hint] if subject_hint
            else list(self._compiled.keys())
        )

        for subject in subjects_to_check:
            patterns = self._compiled.get(subject, [])
            for entity_type, regex, subj in patterns:
                for match in regex.finditer(text):
                    entities.append({
                        'text': match.group(),
                        'entity_type': entity_type,
                        'subject': subj,
                        'start': match.start(),
                        'end': match.end(),
                        'confidence': 0.85,  # 规则匹配置信度
                    })

        # 按位置排序，移除重叠实体（保留置信度更高的）
        entities = self._resolve_overlaps(entities)
        return entities

    @staticmethod
    def _resolve_overlaps(
        entities: list[dict],
    ) -> list[dict]:
        """解决重叠实体冲突"""
        if not entities:
            return []
        # 按起始位置排序
        entities.sort(key=lambda e: (e['start'], -(e['end'] - e['start'])))
        result = [entities[0]]
        for entity in entities[1:]:
            last = result[-1]
            if entity['start'] >= last['end']:
                result.append(entity)
            elif entity['end'] > last['end'] and entity.get('confidence', 0) > last.get('confidence', 0):
                result[-1] = entity  # 替换为更优匹配
        return result
```

### 4.4 数学公式解析与规范化（FormulaParser）

```python
import re
from typing import Optional


class FormulaParser:
    """LaTeX 公式解析与规范化引擎"""

    # LaTeX 环境检测
    LATEX_INLINE_RE = re.compile(r'\\\((.+?)\\\)', re.DOTALL)
    LATEX_BLOCK_RE = re.compile(r'\\\[(.+?)\\\]', re.DOTALL)
    LATEX_DOLLAR_RE = re.compile(r'(?<!\\)\$(.+?)(?<!\\)\$', re.DOTALL)

    # 变量/符号模式
    GREEK_LETTERS = {
        r'\\alpha': 'α', r'\\beta': 'β', r'\\gamma': 'γ',
        r'\\delta': 'δ', r'\\epsilon': 'ε', r'\\theta': 'θ',
        r'\\lambda': 'λ', r'\\mu': 'μ', r'\\pi': 'π',
        r'\\sigma': 'σ', r'\\omega': 'ω', r'\\Delta': 'Δ',
        r'\\Sigma': 'Σ', r'\\Omega': 'Ω', r'\\Phi': 'Φ',
    }

    def parse(self, text: str) -> list[dict]:
        """从文本中提取并解析所有公式"""
        formulas = []

        # 提取块级公式
        for match in self.LATEX_BLOCK_RE.finditer(text):
            formula = self._parse_single(match.group(1), "block")
            formulas.append(formula)

        # 提取行内公式
        for match in self.LATEX_INLINE_RE.finditer(text):
            formula = self._parse_single(match.group(1), "inline")
            formulas.append(formula)

        # 提取 $...$ 格式（兼容）
        for match in self.LATEX_DOLLAR_RE.finditer(text):
            formula = self._parse_single(match.group(1), "inline")
            formulas.append(formula)

        return formulas

    def _parse_single(
        self,
        raw_latex: str,
        env: str,
    ) -> dict:
        """解析单个 LaTeX 公式"""
        normalized = self._normalize(raw_latex)
        formula_type = self._classify_type(normalized)
        variables = self._extract_variables(normalized)
        constants = self._extract_constants(normalized)

        return {
            'raw_latex': raw_latex.strip(),
            'normalized_latex': normalized,
            'formula_type': formula_type,
            'variables': variables,
            'constants': constants,
            'has_integral': '\\int' in normalized,
            'has_derivative': '\\frac{d' in normalized or "d/dx" in normalized,
            'has_matrix': '\\begin{matrix' in normalized or '\\begin{pmatrix' in normalized,
            'has_summation': '\\sum' in normalized,
        }

    def _normalize(self, latex: str) -> str:
        """LaTeX 规范化"""
        result = latex.strip()
        # 统一空格
        result = re.sub(r'\s+', ' ', result)
        # 统一乘号（\times → \cdot 可选）
        # 统一分式格式
        result = re.sub(r'\\frac\s*', r'\\frac', result)
        # 去除多余大括号
        result = re.sub(r'\{(\w)\}', r'\1', result)
        return result

    def _classify_type(self, latex: str) -> str:
        """分类公式类型"""
        if '=' in latex and '==' not in latex:
            if '\\leq' in latex or '\\geq' in latex or '<' in latex or '>' in latex:
                return "inequality"
            return "equation"
        elif '\\leq' in latex or '\\geq' in latex:
            return "inequality"
        elif '\\frac' in latex:
            return "fraction"
        elif '\\sqrt' in latex:
            return "radical"
        elif '\\int' in latex:
            return "integral"
        elif '\\sum' in latex:
            return "summation"
        elif '\\lim' in latex:
            return "limit"
        elif '\\begin{matrix' in latex or '\\begin{pmatrix' in latex:
            return "matrix"
        else:
            return "expression"

    def _extract_variables(self, latex: str) -> list[str]:
        """提取变量（单字母或带下标）"""
        # 移除 LaTeX 命令
        cleaned = re.sub(r'\\[a-zA-Z]+', '', latex)
        cleaned = re.sub(r'[0-9{}^_/()\[\]+\-*=<>.,]', '', cleaned)
        vars_found = set()
        current = ""
        for char in cleaned:
            if char.isalpha():
                current += char
            else:
                if current and len(current) <= 3:
                    vars_found.add(current)
                current = ""
        if current and len(current) <= 3:
            vars_found.add(current)
        return sorted(vars_found)

    def _extract_constants(self, latex: str) -> list[str]:
        """提取常数"""
        constants = set()
        # 数字常数
        for match in re.finditer(r'(?<!\w)(\d+(?:\.\d+)?)', latex):
            constants.add(match.group(1))
        # 常见数学常数符号
        if '\\pi' in latex:
            constants.append('π') if 'π' not in constants else None
            constants.add('π') if '\\pi' in latex else None
        if 'e' in latex and '\\exp' not in latex:
            # 仅当下文无变量修饰时
            pass
        return sorted(constants)
```

### 4.5 化学方程式解析器（ChemicalEquationParser）

```python
import re
from collections import Counter


class ChemicalEquationParser:
    """化学方程式解析器"""

    # 化学式模式（如 H2O, CO2, H2SO4, Ca(OH)2）
    FORMULA_RE = re.compile(
        r'(?:[A-Z][a-z]?\d*)+(?:\([^)]*\)\d+)*',
    )

    # 反应箭头模式
    ARROW_RE = re.compile(
        r'(?:→|->|⟶|=|⇌|⇋)',
    )

    # 反应条件模式
    CONDITION_RE = re.compile(
        r'(?:催化剂|高温|低压|高压|点燃|加热|通电|催化剂|'
        r'Ni|Pt|Pd|Fe\b|MnO2|Cu\b|条件)',
    )

    def parse(self, text: str) -> list[dict]:
        """从文本中识别并解析化学方程式"""
        equations = []

        # 查找包含化学箭头的片段
        segments = self._find_equation_segments(text)

        for segment in segments:
            parsed = self._parse_equation(segment)
            if parsed:
                equations.append(parsed)

        return equations

    def _find_equation_segments(self, text: str) -> list[str]:
        """查找包含化学反应模式的文本段"""
        segments = []
        # 按行/标点分割
        lines = re.split(r'[。；\n]', text)
        for line in lines:
            line = line.strip()
            if self.ARROW_RE.search(line) and self.FORMULA_RE.search(line):
                segments.append(line)
        return segments

    def _parse_equation(self, segment: str) -> dict | None:
        """解析单个化学方程式"""
        # 分割反应物和生成物
        arrow_match = self.ARROW_RE.search(segment)
        if not arrow_match:
            return None

        left = segment[:arrow_match.start()].strip()
        right = segment[arrow_match.end():].strip()

        # 提取反应条件
        conditions = self._extract_conditions(segment)

        # 解析反应物和生成物
        reactants = self._split_compounds(left)
        products = self._split_compounds(right)

        # 检查是否配平
        is_balanced = self._check_balanced(reactants, products)

        return {
            'raw_text': segment,
            'reactants': reactants,
            'products': products,
            'conditions': conditions,
            'is_balanced': is_balanced,
            'equation_type': self._classify_reaction(reactants, products),
        }

    def _split_compounds(self, text: str) -> list[str]:
        """分割化合物列表"""
        # 按 + 分割，但要区分上下标中的 +
        parts = re.split(r'\s*\+\s*', text)
        return [p.strip() for p in parts if p.strip()]

    def _extract_conditions(self, text: str) -> list[str]:
        """提取反应条件"""
        conditions = []
        for match in self.CONDITION_RE.finditer(text):
            conditions.append(match.group())
        return list(set(conditions))  # 去重

    def _parse_formula(self, formula: str) -> Counter:
        """解析化学式为元素计数"""
        counts = Counter()
        # 处理括号
        def expand_parentheses(s):
            result = s
            # 从内到外处理括号
            while '(' in result or '[' in result:
                result = re.sub(
                    r'[\(\[]([A-Za-z0-9]+)[\]\)](\d*)',
                    lambda m: m.group(1) * (int(m.group(2)) if m.group(2) else 1),
                    result,
                )
            return result

        expanded = expand_parentheses(formula)

        # 匹配元素和数量
        for match in re.finditer(r'([A-Z][a-z]?)(\d*)', expanded):
            element = match.group(1)
            count = int(match.group(2)) if match.group(2) else 1
            counts[element] += count

        return counts

    def _check_balanced(
        self,
        reactants: list[str],
        products: list[str],
    ) -> bool:
        """检查方程式是否配平"""
        reactant_counts = Counter()
        product_counts = Counter()

        for formula in reactants:
            # 去除系数
            m = re.match(r'^(\d+)?(.*)', formula.strip())
            coef = int(m.group(1)) if m.group(1) else 1
            counts = self._parse_formula(m.group(2))
            for elem, cnt in counts.items():
                reactant_counts[elem] += cnt * coef

        for formula in products:
            m = re.match(r'^(\d+)?(.*)', formula.strip())
            coef = int(m.group(1)) if m.group(1) else 1
            counts = self._parse_formula(m.group(2))
            for elem, cnt in counts.items():
                product_counts[elem] += cnt * coef

        return reactant_counts == product_counts

    @staticmethod
    def _classify_reaction(
        reactants: list[str],
        products: list[str],
    ) -> str:
        """分类反应类型"""
        if len(reactants) == 1 and len(products) > 1:
            return "decomposition"
        elif len(reactants) > 1 and len(products) == 1:
            return "synthesis"
        elif len(reactants) == 2 and len(products) == 2:
            return "replacement"
        else:
            return "complex"
```

### 4.6 文本难度评估引擎（DifficultyAssessor）

```python
import math
from typing import Optional


class DifficultyAssessor:
    """教育文本难度评估引擎

    结合多维特征评估文本难度：
    - 词汇复杂度（生词率、词频分布）
    - 句法复杂度（句长、从句密度）
    - 概念密度（学科术语占比）
    - 认知负载（信息熵）
    - 公式复杂度（数学/化学公式复杂度）
    """

    # 年级对应预期难度范围
    GRADE_RANGES = {
        "kindergarten": (0.0, 0.15),
        "grade_1": (0.05, 0.20),
        "grade_2": (0.10, 0.25),
        "grade_3": (0.15, 0.30),
        "grade_4": (0.20, 0.35),
        "grade_5": (0.25, 0.40),
        "grade_6": (0.30, 0.45),
        "grade_7": (0.35, 0.55),
        "grade_8": (0.40, 0.60),
        "grade_9": (0.45, 0.65),
        "high_school_1": (0.50, 0.70),
        "high_school_2": (0.55, 0.80),
        "high_school_3": (0.60, 0.90),
    }

    def __init__(self, vocab_freq_table: dict[str, int]):
        """
        Args:
            vocab_freq_table: 词频表 {word: frequency_rank}
                              rank 越高表示越常见/简单
        """
        self.vocab_freq = vocab_freq_table
        self._max_freq = max(vocab_freq_table.values()) if vocab_freq_table else 1

    def assess(
        self,
        text: str,
        tokens: list[dict],
        entities: list[dict],
        formulas: list[dict],
        subject_hint: Optional[str] = None,
        grade_hint: Optional[str] = None,
    ) -> dict:
        """评估文本难度"""
        if not text.strip():
            return self._default_result()

        # 1. 词汇复杂度
        vocab_score = self._vocab_complexity(tokens)

        # 2. 句法复杂度
        syntax_score = self._syntax_complexity(text)

        # 3. 概念密度
        concept_score = self._concept_density(tokens, entities)

        # 4. 信息熵
        entropy_score = self._information_entropy(text)

        # 5. 公式复杂度
        formula_score = self._formula_complexity(formulas)

        # 加权综合难度
        weights = self._get_weights(subject_hint)
        difficulty = (
            vocab_score * weights['vocab']
            + syntax_score * weights['syntax']
            + concept_score * weights['concept']
            + entropy_score * weights['entropy']
            + formula_score * weights['formula']
        )

        # 年级提示校准
        if grade_hint:
            difficulty = self._calibrate_to_grade(difficulty, grade_hint)

        difficulty = max(0.0, min(1.0, difficulty))

        return {
            'difficulty_score': round(difficulty, 4),
            'difficulty_level': self._score_to_level(difficulty),
            'estimated_grade': self._estimate_grade(difficulty),
            'factors': {
                'vocab_complexity': round(vocab_score, 4),
                'sentence_complexity': round(syntax_score, 4),
                'concept_density': round(concept_score, 4),
                'information_entropy': round(entropy_score, 4),
                'formula_complexity': round(formula_score, 4),
            },
            'confidence': self._estimate_confidence(
                text, tokens, entities,
            ),
        }

    def _vocab_complexity(self, tokens: list[dict]) -> float:
        """词汇复杂度评分"""
        if not tokens:
            return 0.3
        rare_count = 0
        total = 0
        for tok in tokens:
            word = tok.get('text', '')
            if len(word) < 1 or tok.get('is_stop'):
                continue
            total += 1
            freq = self.vocab_freq.get(word, 0)
            if freq == 0:
                rare_count += 1  # 未登录词视为高难度
            elif freq < self._max_freq * 0.1:
                rare_count += 0.7  # 低频词
            elif freq < self._max_freq * 0.3:
                rare_count += 0.3  # 中频词

        if total == 0:
            return 0.3
        return min(1.0, rare_count / total)

    @staticmethod
    def _syntax_complexity(text: str) -> float:
        """句法复杂度评分（基于句长和标点密度）"""
        sentences = re.split(r'[。！？.!?；;]', text)
        sentences = [s for s in sentences if s.strip()]
        if not sentences:
            return 0.3

        avg_length = sum(len(s) for s in sentences) / len(sentences)
        # 句长标准化（中文 20 字 / 英文 15 词 为中等难度）
        length_score = min(1.0, avg_length / 40.0)

        # 从句密度（逗号数/句子数）
        comma_count = text.count('，') + text.count(',')
        clause_density = comma_count / max(len(sentences), 1)
        clause_score = min(1.0, clause_density / 3.0)

        return (length_score * 0.6 + clause_score * 0.4)

    @staticmethod
    def _concept_density(
        tokens: list[dict],
        entities: list[dict],
    ) -> float:
        """概念密度（学科术语占比）"""
        if not tokens:
            return 0.0
        entity_chars = sum(
            len(e.get('text', '')) for e in entities
        )
        total_chars = sum(len(t.get('text', '')) for t in tokens)
        if total_chars == 0:
            return 0.0
        return min(1.0, entity_chars / total_chars * 2)

    @staticmethod
    def _information_entropy(text: str) -> float:
        """信息熵评分"""
        if not text:
            return 0.0
        # 字符级熵
        char_counts = Counter(text)
        total = len(text)
        entropy = 0.0
        for count in char_counts.values():
            p = count / total
            entropy -= p * math.log2(p)
        # 归一化（中文最大熵 ~ log2(6763) ≈ 12.7）
        return min(1.0, entropy / 8.0)

    @staticmethod
    def _formula_complexity(formulas: list[dict]) -> float:
        """公式复杂度评分"""
        if not formulas:
            return 0.0
        total_score = 0.0
        for f in formulas:
            score = 0.2  # 基础分
            if f.get('has_integral'):
                score += 0.3
            if f.get('has_derivative'):
                score += 0.25
            if f.get('has_matrix'):
                score += 0.2
            if f.get('has_summation'):
                score += 0.15
            var_count = len(f.get('variables', []))
            score += min(0.2, var_count * 0.05)
            total_score += min(1.0, score)
        return min(1.0, total_score / max(len(formulas), 1))

    @staticmethod
    def _get_weights(subject: Optional[str]) -> dict[str, float]:
        """获取学科特定权重"""
        default = {
            'vocab': 0.25,
            'syntax': 0.20,
            'concept': 0.20,
            'entropy': 0.15,
            'formula': 0.20,
        }
        if subject in ('math', 'physics', 'chemistry'):
            return {**default, 'formula': 0.35, 'concept': 0.25, 'vocab': 0.15}
        elif subject in ('chinese', 'history', 'politics'):
            return {**default, 'vocab': 0.35, 'syntax': 0.25, 'formula': 0.05}
        elif subject == 'english':
            return {**default, 'vocab': 0.40, 'syntax': 0.30, 'formula': 0.05}
        return default

    @staticmethod
    def _calibrate_to_grade(
        difficulty: float,
        grade: str,
    ) -> float:
        """根据年级提示校准难度"""
        grade_range = DifficultyAssessor.GRADE_RANGES.get(grade)
        if not grade_range:
            return difficulty
        low, high = grade_range
        # 如果难度在合理范围内，不做调整
        if low <= difficulty <= high:
            return difficulty
        # 轻微向年级范围中心拉
        center = (low + high) / 2
        return difficulty * 0.8 + center * 0.2

    @staticmethod
    def _score_to_level(score: float) -> str:
        if score < 0.25:
            return "easy"
        elif score < 0.50:
            return "medium"
        elif score < 0.75:
            return "hard"
        else:
            return "expert"

    @staticmethod
    def _estimate_grade(score: float) -> str:
        """根据难度分估算适用年级"""
        for grade, (low, high) in sorted(
            DifficultyAssessor.GRADE_RANGES.items(),
            key=lambda x: x[1][0],
        ):
            if score <= high:
                return grade
        return "high_school_3+"

    @staticmethod
    def _estimate_confidence(
        text: str,
        tokens: list[dict],
        entities: list[dict],
    ) -> float:
        """估算评估置信度"""
        # 文本越长，评估越可靠
        text_len = len(text)
        length_confidence = min(1.0, text_len / 200.0)

        # token 数量
        token_confidence = min(1.0, len(tokens) / 50.0)

        return round((length_confidence + token_confidence) / 2, 3)

    @staticmethod
    def _default_result() -> dict:
        return {
            'difficulty_score': 0.0,
            'difficulty_level': 'easy',
            'estimated_grade': 'kindergarten',
            'factors': {},
            'confidence': 0.0,
        }
```

### 4.7 意图分类器（IntentClassifier）

```python
from typing import Optional
import numpy as np


class IntentClassifier:
    """用户输入意图分类器

    分类体系：
    - question:      知识提问（"什么是光合作用？"）
    - solve:         解题请求（"帮我解这道方程"）
    - explain:       解释请求（"为什么选C不选B？"）
    - summarize:     摘要/总结（"总结这一章的重点"）
    - translate:     翻译请求（"把这段翻译成英文"）
    - practice:      练习请求（"给我出几道练习题"）
    - feedback:      反馈/纠错（"这个答案不对"）
    - chat:          闲聊/非学习
    - guidance:      学习方法指导（"怎么背单词更高效？"）
    """

    INTENT_KEYWORDS = {
        "question": [
            "什么是", "为什么", "什么是", "如何理解", "什么叫",
            "定义", "概念", "含义", "区别", "关系",
            "what is", "why", "how to understand",
        ],
        "solve": [
            "解", "求解", "计算", "算", "证明", "化简",
            "因式分解", "求导", "积分", "解方程",
            "solve", "calculate", "prove",
        ],
        "explain": [
            "解释", "讲解", "说明", "分析", "为什么不",
            "为什么选", "为什么错", "帮我看看",
            "explain", "analyze",
        ],
        "summarize": [
            "总结", "归纳", "概括", "重点", "要点",
            "知识点", "考点", "核心内容",
            "summarize", "key points",
        ],
        "translate": [
            "翻译", "译成", "英文怎么说", "中文意思",
            "translate",
        ],
        "practice": [
            "出题", "练习", "做题", "同类题", "类似的题",
            "考考我", "测验",
            "practice", "exercise", "quiz",
        ],
        "feedback": [
            "不对", "错了", "有误", "纠正", "反馈",
            "答错了", "不准确", "有问题",
            "wrong", "incorrect", "error",
        ],
        "guidance": [
            "怎么学", "怎么背", "学习方法", "技巧",
            "提高", "怎么记", "复习方法",
            "how to study", "tips",
        ],
    }

    # 非学习类关键词（用于 off-topic 检测）
    OFF_TOPIC_KEYWORDS = [
        "游戏", "小说", "追剧", "八卦", "明星",
        "天气", "笑话", "故事", "情书",
        "写诗", "写小说", "写歌词",
        # 非学习闲聊
        "你好", "你是谁", "你叫什么", "聊天",
    ]

    def __init__(
        self,
        bert_model_path: Optional[str] = None,
    ):
        """
        Args:
            bert_model_path: 微调 BERT 模型路径（可选）
                             未提供时使用规则+关键词匹配
        """
        self._model = None
        if bert_model_path:
            try:
                from transformers import AutoModelForSequenceClassification, AutoTokenizer
                import torch
                self._tokenizer = AutoTokenizer.from_pretrained(bert_model_path)
                self._model = AutoModelForSequenceClassification.from_pretrained(
                    bert_model_path,
                )
                self._device = torch.device(
                    'cuda' if torch.cuda.is_available() else 'cpu',
                )
                self._model.to(self._device)
                self._model.eval()
            except ImportError:
                pass  # 降级为规则匹配

    def classify(
        self,
        text: str,
        subject_hint: Optional[str] = None,
    ) -> dict:
        """分类用户意图"""
        if self._model is not None:
            return self._classify_with_model(text)
        else:
            return self._classify_with_rules(text, subject_hint)

    def _classify_with_model(self, text: str) -> dict:
        """使用 BERT 模型分类"""
        import torch

        inputs = self._tokenizer(
            text,
            return_tensors='pt',
            truncation=True,
            max_length=128,
            padding=True,
        ).to(self._device)

        with torch.no_grad():
            outputs = self._model(**inputs)
            probs = torch.softmax(outputs.logits, dim=-1)
            pred_idx = probs.argmax(dim=-1).item()
            confidence = probs[0][pred_idx].item()

        intent_labels = list(self.INTENT_KEYWORDS.keys())
        primary_intent = intent_labels[pred_idx]

        return {
            'primary_intent': primary_intent,
            'secondary_intent': None,
            'confidence': round(confidence, 4),
            'is_off_topic': primary_intent == 'chat' and self._is_off_topic(text),
            'detected_subject': 'general',
        }

    def _classify_with_rules(
        self,
        text: str,
        subject_hint: Optional[str],
    ) -> dict:
        """规则匹配意图分类（降级方案）"""
        text_lower = text.lower().strip()
        scores = {}

        for intent, keywords in self.INTENT_KEYWORDS.items():
            score = 0.0
            for kw in keywords:
                if kw in text_lower:
                    # 考虑关键词位置权重（句首权重更高）
                    pos = text_lower.find(kw)
                    position_weight = 1.0 if pos <= 10 else 0.6
                    score += position_weight
            scores[intent] = score

        if not any(scores.values()):
            # 无匹配，默认 chat
            return {
                'primary_intent': 'chat',
                'secondary_intent': None,
                'confidence': 0.3,
                'is_off_topic': self._is_off_topic(text),
                'detected_subject': subject_hint or 'general',
            }

        # 排序取最高
        ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        primary = ranked[0][0]
        secondary = ranked[1][0] if len(ranked) > 1 and ranked[1][1] > 0 else None

        # 归一化置信度
        total_score = sum(s for _, s in ranked if s > 0)
        confidence = round(ranked[0][1] / total_score if total_score > 0 else 0.3, 4)

        return {
            'primary_intent': primary,
            'secondary_intent': secondary,
            'confidence': min(0.95, confidence),
            'is_off_topic': self._is_off_topic(text),
            'detected_subject': subject_hint or 'general',
        }

    @staticmethod
    def _is_off_topic(text: str) -> bool:
        """检测是否脱离学习场景"""
        off_topic_count = sum(
            1 for kw in IntentClassifier.OFF_TOPIC_KEYWORDS
            if kw in text
        )
        # 多个非学习关键词同时出现 → 判定 off-topic
        return off_topic_count >= 2
```

---

## 5. 管线编排器（Pipeline Orchestrator）

### 5.1 DAG 编排引擎

```python
from enum import Enum
from typing import Callable, Any
import time
import hashlib
import json


class NodeStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"


class PipelineNode:
    """管线节点"""

    def __init__(
        self,
        name: str,
        processor: Callable,
        depends_on: list[str] = None,
        condition: Callable[[dict], bool] = None,
        timeout_ms: int = 5000,
    ):
        self.name = name
        self.processor = processor
        self.depends_on = depends_on or []
        self.condition = condition
        self.timeout_ms = timeout_ms
        self.status = NodeStatus.PENDING
        self.result: Any = None
        self.error: str = ""
        self.duration_ms: float = 0.0


class PipelineOrchestrator:
    """管线 DAG 编排器"""

    def __init__(self, cache_client=None):
        self.nodes: dict[str, PipelineNode] = {}
        self.cache = cache_client

    def register_node(self, node: PipelineNode) -> None:
        self.nodes[node.name] = node

    def execute(
        self,
        input_data: dict,
        use_cache: bool = True,
    ) -> dict:
        """执行完整管线"""
        # 缓存检查
        cache_key = ""
        if use_cache and self.cache:
            cache_key = self._make_cache_key(input_data)
            cached = self.cache.get(cache_key)
            if cached:
                result = json.loads(cached)
                result['_cache_hit'] = True
                return result

        # 拓扑排序
        execution_order = self._topological_sort()
        context = {"input": input_data, "results": {}}

        # 按序执行
        for node_name in execution_order:
            node = self.nodes[node_name]

            # 条件检查
            if node.condition and not node.condition(context):
                node.status = NodeStatus.SKIPPED
                continue

            # 依赖检查
            failed_deps = [
                d for d in node.depends_on
                if self.nodes[d].status == NodeStatus.FAILED
            ]
            if failed_deps:
                node.status = NodeStatus.SKIPPED
                node.error = f"Skipped due to failed deps: {failed_deps}"
                continue

            # 执行
            node.status = NodeStatus.RUNNING
            start = time.perf_counter()
            try:
                node.result = node.processor(context)
                node.status = NodeStatus.SUCCESS
                context['results'][node_name] = node.result
            except Exception as e:
                node.status = NodeStatus.FAILED
                node.error = str(e)
                context['results'][node_name] = {'error': str(e)}
            finally:
                node.duration_ms = (time.perf_counter() - start) * 1000

        # 缓存写入
        output = self._build_output(context)
        if use_cache and self.cache and cache_key:
            self.cache.setex(
                cache_key, 3600,
                json.dumps(output, ensure_ascii=False, default=str),
            )

        output['_cache_hit'] = False
        return output

    def _topological_sort(self) -> list[str]:
        """Kahn 拓扑排序"""
        in_degree = {name: 0 for name in self.nodes}
        for node in self.nodes.values():
            for dep in node.depends_on:
                if dep in in_degree:
                    in_degree[node.name] += 1

        queue = [n for n, d in in_degree.items() if d == 0]
        result = []

        while queue:
            node_name = queue.pop(0)
            result.append(node_name)
            for other in self.nodes.values():
                if node_name in other.depends_on:
                    in_degree[other.name] -= 1
                    if in_degree[other.name] == 0:
                        queue.append(other.name)

        if len(result) != len(self.nodes):
            raise ValueError("Pipeline has circular dependency")
        return result

    @staticmethod
    def _make_cache_key(input_data: dict) -> str:
        raw = json.dumps(input_data, sort_keys=True, ensure_ascii=False)
        return f"nlp:pipeline:{hashlib.sha256(raw.encode()).hexdigest()}"

    @staticmethod
    def _build_output(context: dict) -> dict:
        output = {}
        for name, result in context.get('results', {}).items():
            if isinstance(result, dict):
                output.update(result)
            else:
                output[name] = result
        return output


def build_default_pipeline(
    normalizer: TextNormalizer,
    tokenizer: SubjectAwareTokenizer,
    recognizer: SubjectEntityRecognizer,
    formula_parser: FormulaParser,
    chem_parser: ChemicalEquationParser,
    difficulty_assessor: DifficultyAssessor,
    intent_classifier: IntentClassifier,
    cache_client=None,
) -> PipelineOrchestrator:
    """构建默认 NLP 管线"""

    orch = PipelineOrchestrator(cache_client)

    def process_normalize(ctx):
        text = ctx['input'].get('text', '')
        result = normalizer.normalize(text)
        return {'processed_text': result, '_normalized_text': result}

    def process_tokenize(ctx):
        text = ctx['results'].get('_normalized_text', '')
        subject = ctx['input'].get('subject_hint')
        tokens = tokenizer.tokenize(text, subject)
        return {'tokens': tokens}

    def process_ner(ctx):
        text = ctx['results'].get('_normalized_text', '')
        subject = ctx['input'].get('subject_hint')
        entities = recognizer.recognize(text, subject)
        return {'entities': entities}

    def process_formula(ctx):
        if not ctx['input'].get('enable_formula', True):
            return {'formulas': []}
        text = ctx['results'].get('_normalized_text', '')
        formulas = formula_parser.parse(text)
        return {'formulas': formulas}

    def process_chem(ctx):
        if not ctx['input'].get('enable_formula', True):
            return {'chemical_equations': []}
        text = ctx['results'].get('_normalized_text', '')
        equations = chem_parser.parse(text)
        return {'chemical_equations': equations}

    def process_difficulty(ctx):
        text = ctx['results'].get('_normalized_text', '')
        tokens = ctx['results'].get('tokens', [])
        entities = ctx['results'].get('entities', [])
        formulas = ctx['results'].get('formulas', [])
        subject = ctx['input'].get('subject_hint')
        grade = ctx['input'].get('grade_hint')
        return {'difficulty': difficulty_assessor.assess(
            text, tokens, entities, formulas, subject, grade,
        )}

    def process_intent(ctx):
        text = ctx['results'].get('_normalized_text', '')
        subject = ctx['input'].get('subject_hint')
        return {'intent': intent_classifier.classify(text, subject)}

    def process_subject_detection(ctx):
        entities = ctx['results'].get('entities', [])
        intent = ctx['results'].get('intent', {})
        # 基于实体和意图推断学科
        if entities:
            subject_counts = {}
            for e in entities:
                s = e.get('subject', 'general')
                subject_counts[s] = subject_counts.get(s, 0) + 1
            detected = max(subject_counts, key=subject_counts.get)
        else:
            detected = intent.get('detected_subject', 'general')
        return {'detected_subject': detected}

    orch.register_node(PipelineNode(
        'normalize', process_normalize,
    ))
    orch.register_node(PipelineNode(
        'tokenize', process_tokenize,
        depends_on=['normalize'],
    ))
    orch.register_node(PipelineNode(
        'ner', process_ner,
        depends_on=['normalize'],
    ))
    orch.register_node(PipelineNode(
        'formula', process_formula,
        depends_on=['normalize'],
    ))
    orch.register_node(PipelineNode(
        'chem', process_chem,
        depends_on=['normalize'],
    ))
    orch.register_node(PipelineNode(
        'difficulty', process_difficulty,
        depends_on=['tokenize', 'ner', 'formula'],
    ))
    orch.register_node(PipelineNode(
        'intent', process_intent,
        depends_on=['normalize'],
    ))
    orch.register_node(PipelineNode(
        'subject_detection', process_subject_detection,
        depends_on=['ner', 'intent'],
    ))

    return orch
```

### 5.2 管线 DAG 可视化

```
              ┌──────────┐
              │ normalize │
              └────┬──────┘
        ┌─────────┼─────────┬──────────┐
        ▼         ▼         ▼          ▼
  ┌──────────┐ ┌──────┐ ┌────────┐ ┌───────┐
  │ tokenize │ │ ner  │ │formula │ │ chem  │
  └────┬─────┘ └──┬───┘ └───┬────┘ └───┬───┘
       │          │         │           │
       │    ┌─────┘    ┌────┘           │
       ▼    ▼          ▼                │
  ┌────────────┐  ┌──────────┐          │
  │ difficulty │  │  intent  │          │
  └────────────┘  └────┬─────┘          │
                       │                │
                  ┌────▼─────────────────┘
                  │ subject_detection
                  └──────────────────
```

---

## 6. API 接口设计

### 6.1 RESTful API

#### 6.1.1 完整管线处理

```
POST /api/v1/nlp/process
```

**请求体：**
```json
{
  "request_id": "req_20260731_001",
  "text": "已知函数 f(x) = 2x² + 3x - 1，求 f'(x) 并计算 f'(2) 的值。",
  "task_type": "full_pipeline",
  "subject_hint": "math",
  "grade_hint": "high_school_1",
  "enable_formula": true,
  "enable_syntax": false,
  "enable_cache": true
}
```

**响应体：**
```json
{
  "request_id": "req_20260731_001",
  "task_type": "full_pipeline",
  "success": true,
  "processed_text": "已知函数 f(x) = 2x² + 3x - 1, 求 f'(x) 并计算 f'(2) 的值.",
  "tokens": [
    {"text": "已知", "pos": "v", "start": 0, "end": 2, "is_stop": false},
    {"text": "函数", "pos": "n", "start": 2, "end": 4, "is_stop": false},
    {"text": "f(x)", "pos": "n", "start": 5, "end": 9, "is_stop": false}
  ],
  "entities": [
    {"text": "2x² + 3x - 1", "entity_type": "math_formula", "subject": "math", "start": 12, "end": 24, "confidence": 0.85}
  ],
  "formulas": [
    {
      "raw_latex": "f(x) = 2x^2 + 3x - 1",
      "normalized_latex": "f(x)=2x^2+3x-1",
      "formula_type": "equation",
      "variables": ["f", "x"],
      "constants": ["2", "3", "1"],
      "has_integral": false,
      "has_derivative": false,
      "has_matrix": false,
      "has_summation": false
    },
    {
      "raw_latex": "f'(x)",
      "normalized_latex": "f'(x)",
      "formula_type": "expression",
      "variables": ["f", "x"],
      "constants": [],
      "has_derivative": true
    }
  ],
  "chemical_equations": [],
  "difficulty": {
    "difficulty_score": 0.62,
    "difficulty_level": "hard",
    "estimated_grade": "high_school_1",
    "factors": {
      "vocab_complexity": 0.25,
      "sentence_complexity": 0.45,
      "concept_density": 0.60,
      "information_entropy": 0.55,
      "formula_complexity": 0.75
    },
    "confidence": 0.82
  },
  "intent": {
    "primary_intent": "solve",
    "secondary_intent": "explain",
    "confidence": 0.91,
    "is_off_topic": false,
    "detected_subject": "math"
  },
  "detected_subject": "math",
  "readability_score": 0.58,
  "processing_time_ms": 23.4,
  "cache_hit": false,
  "errors": [],
  "timestamp": "2026-07-31T05:56:00Z"
}
```

#### 6.1.2 单步任务调用

```
POST /api/v1/nlp/tokenize
POST /api/v1/nlp/ner
POST /api/v1/nlp/formula
POST /api/v1/nlp/difficulty
POST /api/v1/nlp/intent
POST /api/v1/nlp/normalize
```

**示例 - 意图分类：**
```
POST /api/v1/nlp/intent

Request:
{
  "request_id": "req_001",
  "text": "这道题为什么不选B？",
  "subject_hint": "math"
}

Response:
{
  "request_id": "req_001",
  "success": true,
  "intent": {
    "primary_intent": "explain",
    "secondary_intent": "feedback",
    "confidence": 0.88,
    "is_off_topic": false,
    "detected_subject": "math"
  },
  "processing_time_ms": 3.2
}
```

#### 6.1.3 批量处理

```
POST /api/v1/nlp/batch
```

```json
{
  "batch_id": "batch_001",
  "items": [
    {
      "request_id": "item_001",
      "text": "光合作用的方程式是什么？",
      "subject_hint": "biology"
    },
    {
      "request_id": "item_002",
      "text": "解方程 3x + 5 = 14",
      "subject_hint": "math"
    }
  ],
  "task_type": "full_pipeline"
}
```

#### 6.1.4 词典管理

```
GET    /api/v1/nlp/dictionary?subject=math&page=1&size=20
POST   /api/v1/nlp/dictionary                    # 新增术语
PUT    /api/v1/nlp/dictionary/{id}                # 修改术语
DELETE /api/v1/nlp/dictionary/{id}                # 停用术语
POST   /api/v1/nlp/dictionary/import              # 批量导入
POST   /api/v1/nlp/dictionary/{subject}/refresh   # 刷新缓存
```

### 6.2 gRPC 接口（内部服务调用）

```protobuf
syntax = "proto3";

package primetop.nlp.v1;

service NLPService {
  rpc Process(NLPRequest) returns (NLPResponse);
  rpc BatchProcess(BatchNLPRequest) returns (BatchNLPResponse);
  rpc StreamProcess(stream NLPRequest) returns (stream NLPResponse);
}

message NLPRequest {
  string request_id = 1;
  string text = 2;
  string task_type = 3;
  optional string subject_hint = 4;
  optional string grade_hint = 5;
  bool enable_formula = 6;
  bool enable_syntax = 7;
  bool enable_cache = 8;
}

message NLPResponse {
  string request_id = 1;
  bool success = 2;
  string processed_text = 3;
  repeated Token tokens = 4;
  repeated Entity entities = 5;
  repeated Formula formulas = 6;
  repeated ChemicalEquation chemical_equations = 7;
  optional DifficultyAssessment difficulty = 8;
  optional IntentResult intent = 9;
  string detected_subject = 10;
  double processing_time_ms = 11;
  bool cache_hit = 12;
  repeated string errors = 13;
}
```

---

## 7. 预设管线配置

### 7.1 管线预设模板

```json
{
  "presets": {
    "ai_tutor_pre": {
      "description": "AI辅导对话前置处理",
      "nodes": ["normalize", "tokenize", "ner", "intent", "subject_detection"],
      "skip": ["formula", "difficulty", "chem"],
      "timeout_ms": 30
    },
    "question_parse": {
      "description": "题目解析前置处理",
      "nodes": ["normalize", "tokenize", "ner", "formula", "chem", "difficulty"],
      "skip": ["intent"],
      "timeout_ms": 50
    },
    "content_tag": {
      "description": "内容自动标注",
      "nodes": ["normalize", "tokenize", "ner", "subject_detection", "difficulty"],
      "skip": ["formula", "chem", "intent"],
      "timeout_ms": 40
    },
    "search_query": {
      "description": "搜索查询理解",
      "nodes": ["normalize", "tokenize", "intent", "subject_detection"],
      "skip": ["ner", "formula", "chem", "difficulty"],
      "timeout_ms": 15
    },
    "full": {
      "description": "完整管线",
      "nodes": "all",
      "timeout_ms": 100
    }
  }
}
```

### 7.2 场景与管线映射

| 调用场景 | 推荐管线 | 说明 |
| --- | --- | --- |
| AI 辅导对话 | `ai_tutor_pre` | 意图识别 + 学科路由，不评估难度 |
| 拍照搜题 OCR 后 | `question_parse` | 公式解析 + 难度评估 |
| 题库入库 | `content_tag` | 实体标注 + 难度标定 + 学科分类 |
| 搜索框输入 | `search_query` | 轻量意图 + 学科路由 |
| 内容审核 | `full` | 全维度分析 |
| 作文批改预处理 | `full` | 需要语法、难度、实体的全量数据 |

---

## 8. 错误处理与降级策略

### 8.1 错误码定义

| 错误码 | 含义 | 处理策略 |
| --- | --- | --- |
| `NLP_001` | 输入文本为空 | 直接返回空结果 |
| `NLP_002` | 输入文本超长（>10000字符） | 截断至 10000 字符并标记 warning |
| `NLP_003` | 分词后端不可用 | 降级到 fallback 分词器 |
| `NLP_004` | BERT 模型加载失败 | 降级到规则匹配 |
| `NLP_005` | 公式解析异常 | 跳过公式解析，继续其他节点 |
| `NLP_006` | 化学方程式解析异常 | 跳过化学解析，继续其他节点 |
| `NLP_007` | 缓存不可用 | 直接执行管线，不报错 |
| `NLP_008` | 管线节点超时 | 跳过该节点，记录错误 |
| `NLP_009` | 管线循环依赖 | 抛出致命错误 |
| `NLP_010` | 不支持的学科类型 | 使用通用处理 |

### 8.2 降级策略代码

```python
class NLPErrorHandler:
    """NLP 管线错误处理与降级"""

    MAX_RETRIES = 1
    FALLBACK_CHAIN = {
        "tokenizer": ["hanlp", "jieba", "char_split"],
        "intent": ["bert", "keyword_rule", "default_chat"],
        "ner": ["rule_based", "skip"],
    }

    @staticmethod
    def handle_node_error(
        node_name: str,
        error: Exception,
        context: dict,
    ) -> dict:
        """处理节点错误，返回降级结果"""
        error_type = type(error).__name__

        if node_name == "tokenize":
            return NLPErrorHandler._fallback_tokenize(context)
        elif node_name == "ner":
            return {"entities": []}  # 实体识别失败 → 空实体
        elif node_name == "formula":
            return {"formulas": []}  # 公式解析失败 → 跳过
        elif node_name == "chem":
            return {"chemical_equations": []}
        elif node_name == "difficulty":
            return NLPErrorHandler._default_difficulty()
        elif node_name == "intent":
            return {
                'intent': {
                    'primary_intent': 'question',
                    'confidence': 0.3,
                    'is_off_topic': False,
                    'detected_subject': 'general',
                }
            }
        else:
            return {node_name: None}

    @staticmethod
    def _fallback_tokenize(context: dict) -> dict:
        """最简分词降级：字级分割"""
        text = context.get('results', {}).get('_normalized_text', '')
        tokens = []
        for i, char in enumerate(text):
            if char.strip():
                tokens.append({
                    'text': char,
                    'pos': 'x',
                    'start': i,
                    'end': i + 1,
                    'is_stop': False,
                })
        return {'tokens': tokens}

    @staticmethod
    def _default_difficulty() -> dict:
        return {
            'difficulty': {
                'difficulty_score': 0.5,
                'difficulty_level': 'medium',
                'estimated_grade': 'grade_6',
                'factors': {},
                'confidence': 0.1,
            }
        }
```

### 8.3 超时与熔断

```python
import signal
from functools import wraps


class TimeoutError(Exception):
    pass


def with_timeout(seconds: float):
    """节点超时装饰器（基于 signal）"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            def handler(signum, frame):
                raise TimeoutError(
                    f"{func.__name__} timed out after {seconds}s"
                )
            # 仅 Unix 支持 signal.alarm
            # 生产环境推荐使用 asyncio.wait_for 或 concurrent.futures
            old_handler = signal.signal(signal.SIGALRM, handler)
            signal.setitimer(signal.ITIMER_REAL, seconds)
            try:
                return func(*args, **kwargs)
            finally:
                signal.alarm(0)
                signal.signal(signal.SIGALRM, old_handler)
        return wrapper
    return decorator


class CircuitBreaker:
    """简单熔断器"""

    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: int = 60,
    ):
        self.failure_count = 0
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.last_failure_time = 0.0
        self.state = "closed"  # closed / open / half_open

    def can_execute(self) -> bool:
        import time
        if self.state == "open":
            if time.time() - self.last_failure_time > self.recovery_timeout:
                self.state = "half_open"
                return True
            return False
        return True

    def record_success(self) -> None:
        self.failure_count = 0
        self.state = "closed"

    def record_failure(self) -> None:
        import time
        self.failure_count += 1
        self.last_failure_time = time.time()
        if self.failure_count >= self.failure_threshold:
            self.state = "open"
```

---

## 9. 性能优化

### 9.1 多级缓存策略

```
请求 → L1 进程内 LRU (1000条, 1min)
         ↓ miss
       L2 Redis (100000条, 1h)
         ↓ miss
       执行管线 → 写入 L2 → 写入 L1
```

```python
from collections import OrderedDict
import threading
import json
import hashlib


class TwoLevelCache:
    """二级缓存：进程内 LRU + Redis"""

    L1_MAX_SIZE = 1000
    L1_TTL_SECONDS = 60
    L2_TTL_SECONDS = 3600

    def __init__(self, redis_client):
        self.redis = redis_client
        self._l1: OrderedDict = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str):
        # L1 检查
        with self._lock:
            if key in self._l1:
                value, expire_at = self._l1[key]
                import time
                if time.time() < expire_at:
                    self._l1.move_to_end(key)
                    return value
                else:
                    del self._l1[key]

        # L2 检查
        cached = self.redis.get(f"nlp:l2:{key}")
        if cached:
            value = json.loads(cached)
            self._set_l1(key, value)
            return value

        return None

    def set(self, key: str, value: dict) -> None:
        self._set_l1(key, value)
        self.redis.setex(
            f"nlp:l2:{key}",
            self.L2_TTL_SECONDS,
            json.dumps(value, ensure_ascii=False, default=str),
        )

    def _set_l1(self, key: str, value: dict) -> None:
        import time
        with self._lock:
            self._l1[key] = (value, time.time() + self.L1_TTL_SECONDS)
            self._l1.move_to_end(key)
            while len(self._l1) > self.L1_MAX_SIZE:
                self._l1.popitem(last=False)

    @staticmethod
    def make_key(text: str, task_type: str, subject: str = "", grade: str = "") -> str:
        raw = f"{text}|{task_type}|{subject}|{grade}"
        return hashlib.md5(raw.encode()).hexdigest()
```

### 9.2 批处理优化

```python
import asyncio
from typing import Coroutine


class BatchProcessor:
    """NLP 批处理优化器"""

    def __init__(
        self,
        max_concurrency: int = 10,
        batch_timeout_ms: int = 50,
    ):
        self.semaphore = asyncio.Semaphore(max_concurrency)
        self.batch_timeout = batch_timeout_ms / 1000.0

    async def process_batch(
        self,
        items: list[dict],
        process_func: callable,
    ) -> list[dict]:
        """并发处理批量请求"""
        async def process_single(item: dict) -> dict:
            async with self.semaphore:
                try:
                    # 对 CPU 密集型任务使用 run_in_executor
                    loop = asyncio.get_event_loop()
                    result = await asyncio.wait_for(
                        loop.run_in_executor(None, process_func, item),
                        timeout=5.0,
                    )
                    return {'request_id': item.get('request_id'), 'success': True, **result}
                except asyncio.TimeoutError:
                    return {
                        'request_id': item.get('request_id'),
                        'success': False,
                        'error': 'timeout',
                    }
                except Exception as e:
                    return {
                        'request_id': item.get('request_id'),
                        'success': False,
                        'error': str(e),
                    }

        tasks = [process_single(item) for item in items]
        results = await asyncio.gather(*tasks)
        return results
```

### 9.3 性能基准

| 指标 | 目标 | 实测预期 |
| --- | --- | --- |
| normalize 单次 | < 2ms | ~1ms |
| tokenize 单次（HanLP） | < 15ms | ~8ms |
| tokenize 单次（Jieba） | < 5ms | ~2ms |
| ner 规则匹配 | < 5ms | ~2ms |
| formula_parse | < 10ms | ~5ms |
| difficulty | < 5ms | ~2ms |
| intent 规则匹配 | < 3ms | ~1ms |
| intent BERT 模型 | < 50ms | ~30ms |
| 完整管线（规则模式） | < 50ms | ~25ms |
| 完整管线（BERT模式） | < 100ms | ~60ms |
| 批处理 100 条 | < 2s | ~800ms |

---

## 10. 状态流转

### 10.1 管线节点状态机

```
                 ┌──────────┐
     ──────────→ │ PENDING  │
                 └────┬─────┘
                      │ 条件检查
            ┌─────────┼─────────┐
            ▼                   ▼
     ┌────────────┐     ┌──────────┐
     │  RUNNING   │     │ SKIPPED  │
     └────┬───────┘     └──────────┘
          │ 执行完成
    ┌─────┼──────┐
    ▼            ▼
┌─────────┐ ┌─────────┐
│ SUCCESS │ │ FAILED  │
└─────────┘ └────┬────┘
                 │ 降级处理
                 ▼
            ┌──────────┐
            │  降级成功 │ → SUCCESS (degraded)
            │  降级失败 │ → FAILED (final)
            └──────────┘
```

### 10.2 词典更新状态流

```
内容运营新增/修改术语
        │
        ▼
┌──────────────┐     ┌──────────────┐
│ DB 写入(status │ ──→ │ 审核通过     │
│ = pending)    │     │ status=active│
└──────────────┘     └──────┬───────┘
                            │
                     ┌──────▼───────┐
                     │ 刷新 Redis   │
                     │ 缓存         │
                     └──────┬───────┘
                            │
                     ┌──────▼───────┐
                     │ 广播事件      │
                     │ NLP_DICT_    │
                     │ UPDATED      │
                     └──────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ 各服务    │ │ L1缓存   │ │ 监控告警  │
        │ 刷新词典  │ │ 清除     │ │ 指标更新  │
        └──────────┘ └──────────┘ └──────────┘
```

---

## 11. 监控与告警

### 11.1 关键指标

| 指标 | 类型 | 告警阈值 |
| --- | --- | --- |
| `nlp_pipeline_duration_ms` | Histogram | P99 > 200ms |
| `nlp_pipeline_error_rate` | Gauge | > 5% |
| `nlp_node_duration_ms{node}` | Histogram | 单节点 P99 > 100ms |
| `nlp_node_error_count{node}` | Counter | 5分钟内 > 50 |
| `nlp_cache_hit_rate` | Gauge | < 30%（异常低） |
| `nlp_circuit_breaker_state` | Gauge | state=open → 告警 |
| `nlp_model_load_status` | Gauge | model=failed → 告警 |
| `nlp_batch_queue_size` | Gauge | > 500 → 告警 |

### 11.2 Prometheus 指标定义

```python
from prometheus_client import Histogram, Counter, Gauge

# 管线总耗时
pipeline_duration = Histogram(
    'nlp_pipeline_duration_ms',
    'NLP pipeline processing duration',
    ['task_type', 'subject'],
    buckets=(1, 5, 10, 25, 50, 100, 200, 500, 1000),
)

# 节点级耗时
node_duration = Histogram(
    'nlp_node_duration_ms',
    'NLP node processing duration',
    ['node_name'],
    buckets=(0.5, 1, 5, 10, 25, 50, 100),
)

# 错误计数
error_counter = Counter(
    'nlp_errors_total',
    'Total NLP processing errors',
    ['node_name', 'error_type'],
)

# 缓存命中率
cache_hit_rate = Gauge(
    'nlp_cache_hit_rate',
    'NLP cache hit rate',
)

# 熔断器状态
circuit_state = Gauge(
    'nlp_circuit_breaker_state',
    'Circuit breaker state (0=closed, 1=half_open, 2=open)',
    ['component'],
)
```

---

## 12. 部署与集成

### 12.1 部署架构

```
                    ┌─────────────────┐
                    │   Load Balancer │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │ NLP Pod 1│  │ NLP Pod 2│  │ NLP Pod N│
        │ (FastAPI) │  │ (FastAPI) │  │ (FastAPI) │
        └─────┬────┘  └─────┬────┘  └─────┬────┘
              │              │              │
              ┌──────────────┼──────────────┐
              │              │              │
        ┌─────▼──────┐ ┌────▼───────┐ ┌───▼──────────┐
        │   Redis    │ │ PostgreSQL │ │ Model Server │
        │   (Cache)  │ │  (Dict DB) │ │  (ONNX/BERT) │
        └────────────┘ └────────────┘ └──────────────┘
```

### 12.2 Docker 部署

```dockerfile
FROM python:3.11-slim AS base

# 系统依赖
RUN apt-get update && apt-get install -y \
    gcc g++ libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Python 依赖
COPY requirements-nlp.txt .
RUN pip install --no-cache-dir -r requirements-nlp.txt

# 预下载模型（减少冷启动时间）
RUN python -c "import hanlp; hanlp.load(hanlp.pretrained.tok.CTB9_BERT_BASE)" || true
RUN python -c "import jieba; jieba.initialize()" || true

COPY . /app/nlp
WORKDIR /app/nlp

EXPOSE 8200
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8200", "--workers", "4"]
```

### 12.3 作为 SDK 集成

```python
# 对于 Python 服务，可直接引入 SDK
from primetop.nlp import NLPEngine

engine = NLPEngine(
    redis_url="redis://localhost:6379/0",
    db_url="postgresql://user:pass@localhost:5432/primetop",
    model_base_path="/models/nlp",
)

result = engine.process(
    text="求函数 y = x³ - 2x² + x - 3 的极值",
    subject_hint="math",
    grade_hint="high_school_2",
)
```

### 12.4 微服务集成（非 Python 服务）

```java
// Java 服务通过 gRPC 调用
NLPServiceGrpc.NLPServiceBlockingStub stub =
    NLPServiceGrpc.newBlockingStub(channel);

NLPRequest request = NLPRequest.newBuilder()
    .setRequestId("req_001")
    .setText("解方程 2x + 5 = 13")
    .setSubjectHint("math")
    .setTaskType("full_pipeline")
    .build();

NLPResponse response = stub.process(request);
```

---

## 13. 安全与合规

### 13.1 数据安全

| 方面 | 措施 |
| --- | --- |
| 文本长度限制 | 单请求最大 10000 字符，防 DoS |
| 敏感信息过滤 | normalize 阶段自动脱敏手机号、身份证号 |
| 日志脱敏 | 请求日志仅记录文本摘要（前 100 字符 hash），不记录全文 |
| 缓存隔离 | 不同租户/用户的数据使用独立缓存命名空间 |
| 传输加密 | gRPC 使用 TLS，REST 使用 HTTPS |

### 13.2 敏感信息自动脱敏

```python
class TextSanitizer:
    """文本敏感信息脱敏器"""

    PHONE_RE = re.compile(r'1[3-9]\d{9}')
    ID_CARD_RE = re.compile(r'\d{17}[\dXx]')
    EMAIL_RE = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')

    @classmethod
    def sanitize_for_log(cls, text: str) -> str:
        """日志脱敏：仅保留前50字符的hash"""
        import hashlib
        text_hash = hashlib.sha256(text.encode()).hexdigest()[:16]
        length = len(text)
        return f"[hash:{text_hash} len:{length}]"

    @classmethod
    def mask_pii(cls, text: str) -> str:
        """脱敏 PII 信息"""
        text = cls.PHONE_RE.sub('[手机号]', text)
        text = cls.ID_CARD_RE.sub('[身份证]', text)
        text = cls.EMAIL_RE.sub('[邮箱]', text)
        return text
```

---

## 14. 版本管理与演进

### 14.1 模型/词典版本管理

```python
class NLPVersionManager:
    """NLP 资源版本管理"""

    def __init__(self, db_conn, cache):
        self.db = db_conn
        self.cache = cache

    def get_active_config(self) -> dict:
        """获取当前活跃管线配置"""
        cached = self.cache.get("nlp:active_config")
        if cached:
            return cached

        # 查询数据库
        config = self.db.query(
            "SELECT config FROM nlp_pipeline_config WHERE is_active = true LIMIT 1"
        )
        if config:
            self.cache.setex("nlp:active_config", 300, config)
        return config or {}

    def publish_new_version(
        self,
        version: str,
        config: dict,
        description: str = "",
    ) -> None:
        """发布新版本配置"""
        self.db.execute(
            "INSERT INTO nlp_pipeline_config (version, config, description, is_active) "
            "VALUES (%s, %s, %s, false)",
            version, config, description,
        )

    def activate_version(self, version: str) -> None:
        """激活指定版本"""
        self.db.execute(
            "UPDATE nlp_pipeline_config SET is_active = "
            "CASE WHEN version = %s THEN true ELSE false END",
            version,
        )
        self.cache.delete("nlp:active_config")
```

### 14.2 演进路线

| 阶段 | 内容 | 优先级 |
| --- | --- | --- |
| V1 | 规则匹配 + Jieba 分词 + 基础实体识别 | P0（MVP） |
| V1.5 | HanLP 替换 + 学科词典 + 公式解析 + 难度评估 | P1 |
| V2 | BERT 意图分类 + 化学方程式解析 + 批处理 | P1 |
| V2.5 | 微调学科实体识别模型 + 难度模型校准 | P2 |
| V3 | 多语言支持（繁体/英文） + 跨模态文本理解 | P2 |
| V3.5 | 端侧轻量 NLP（减少网络依赖） | P3 |

---

## 15. 附录

### 15.1 学科实体类型完整清单

| 学科 | 实体类型 | 示例 |
| --- | --- | --- |
| 数学 | math_formula | `f(x) = ax² + bx + c` |
| 数学 | math_fraction | `3/4` |
| 数学 | math_percentage | `85%` |
| 数学 | math_power | `x³` |
| 数学 | math_coordinate | `(3, 5)` |
| 数学 | math_set | `{x \| x > 0}` |
| 数学 | math_interval | `[0, +∞)` |
| 数学 | math_angle | `45°` |
| 物理 | physics_unit | `9.8 m/s²` |
| 物理 | physics_vector | `→F` |
| 物理 | physics_constant | `g = 9.8 N/kg` |
| 化学 | chemical_formula | `H₂SO₄` |
| 化学 | chemical_equation | `2H₂ + O₂ → 2H₂O` |
| 化学 | chemical_element | `Fe`, `Cu`, `Na` |
| 化学 | chemical_bond | `C=O`, `C-H` |
| 英语 | en_tense_marker | `has been working` |
| 英语 | en_phrase | `in front of` |
| 英语 | en_clause | `which means that...` |
| 语文 | classical_quote | `"学而时习之"` |
| 语文 | dynasty_ref | `唐代` |
| 语文 | poem_title | `《静夜思》` |
| 语文 | figure_of_speech | `比喻`, `拟人`, `排比` |
| 生物 | bio_term | `光合作用`, `线粒体` |
| 历史 | hist_event | `五四运动` |
| 历史 | hist_date | `1949年10月1日` |
| 地理 | geo_location | `长江三角洲` |
| 地理 | geo_coordinate | `30°N, 120°E` |

### 15.2 难度等级对照表

| 难度分 | 等级 | 对标 | 说明 |
| --- | --- | --- | --- |
| 0.0 - 0.15 | easy | 幼儿-小学低年级 | 简单词汇、短句、基础概念 |
| 0.15 - 0.30 | easy | 小学中年级 | 基础知识、简单运算 |
| 0.30 - 0.45 | medium | 小学高年级-初一 | 中等概念密度、基础公式 |
| 0.45 - 0.55 | medium | 初二-初三 | 多步推理、中等句法复杂度 |
| 0.55 - 0.70 | hard | 高一-高二 | 复杂公式、高概念密度 |
| 0.70 - 0.85 | hard | 高三 | 综合应用、抽象概念 |
| 0.85 - 1.00 | expert | 竞赛/超纲 | 极高认知负荷、多模态推理 |

### 15.3 依赖清单

```
# requirements-nlp.txt
hanlp>=2.1.0
jieba>=0.42.1
spacy>=3.7.0
en-core-web-md>=3.7.0
transformers>=4.36.0
torch>=2.1.0
onnxruntime>=1.16.0
faiss-cpu>=1.7.4
redis>=5.0.0
pydantic>=2.0.0
prometheus-client>=0.19.0
```
