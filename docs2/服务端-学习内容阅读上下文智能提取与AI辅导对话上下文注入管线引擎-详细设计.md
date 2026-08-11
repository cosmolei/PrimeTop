# 服务端-学习内容阅读上下文智能提取与AI辅导对话上下文注入管线引擎-详细设计

## 1. 概述

### 1.1 功能定位

本引擎是客户端「学习内容阅读器内 AI 即时问答悬浮窗」的服务端配套核心服务。当学生在阅读教材章节、微课讲义、知识卡片等学习内容时，可以通过悬浮窗直接向 AI 提问。本引擎负责**接收客户端传递的阅读上下文信号，智能提取和压缩相关知识点，构建结构化的上下文窗口，注入到 AI 辅导对话的 Prompt 管线中**，使 AI 回答精准感知学生当前正在阅读的内容位置、学科背景和认知焦点。

### 1.2 设计目标

| 目标 | 说明 |
| --- | --- |
| **精准感知** | 准确识别学生当前阅读的章节、段落、知识点，将其注入 AI 对话上下文 |
| **Token 预算控制** | 阅读上下文与对话历史共享 Token 预算，动态分配，避免超出模型上下文窗口 |
| **低延迟** | 上下文提取 + 注入全流程 < 200ms（不含模型推理时间） |
| **知识增强** | 结合知识图谱与 RAG 检索，提供超越当前页面内容的深度知识关联 |
| **多场景适配** | 支持教材阅读、错题复习、考点梳理等多种阅读场景的上下文提取 |

### 1.3 适用范围

- 学习内容阅读器内 AI 悬浮窗问答（主场景）
- 知识图谱浏览页内即时提问
- 错题本复习页内追问辅导
- 考点梳理页内深度提问
- 任何需要将页面上下文注入 AI 对话的场景

### 1.4 架构位置

```
客户端阅读器
    │
    ▼ (阅读上下文信号)
┌─────────────────────────────────┐
│   上下文注入管线引擎 (本文档)      │
│                                 │
│  ┌─────────┐  ┌──────────────┐  │
│  │上下文接收│→│信号解析与标准化│  │
│  └─────────┘  └──────────────┘  │
│       │                         │
│  ┌─────────┐  ┌──────────────┐  │
│  │知识关联 │←│ RAG 检索增强  │  │
│  └─────────┘  └──────────────┘  │
│       │                         │
│  ┌─────────┐  ┌──────────────┐  │
│  │Token压缩│→│ Prompt 装配   │  │
│  └─────────┘  └──────────────┘  │
│       │                         │
└───────┼─────────────────────────┘
        ▼ (结构化上下文Prompt段)
   AI 对话编排服务 → 大模型
```

---

## 2. 数据结构定义

### 2.1 阅读上下文信号（客户端上报）

客户端在发起阅读器内 AI 提问时，携带的上下文信号：

```typescript
interface ReadingContextSignal {
  // ── 基础定位信息 ──
  contentId: string;           // 学习内容 ID
  contentType: ContentType;    // 内容类型
  chapterId: string;           // 所属章节 ID
  knowledgePointIds: string[]; // 当前内容关联的知识点 ID 列表
  subject: Subject;            // 学科
  gradeLevel: GradeLevel;      // 学生年级
  textbookVersionId: string;   // 教材版本 ID

  // ── 精细位置信息 ──
  readingPosition: {
    sectionIndex: number;      // 当前小节序号（从0开始）
    paragraphIndex: number;    // 段落序号
    scrollPercentage: number;  // 滚动百分比 0-100
    visibleTextRange?: {       // 可见文本范围
      startOffset: number;     // 起始字符偏移
      endOffset: number;       // 结束字符偏移
    };
  };

  // ── 上下文内容片段 ──
  visibleContentSnippet: string;  // 当前可见区域文本（已截断，≤2000字符）
  surroundingParagraphs: string;  // 前后段落拼接文本（≤3000字符）

  // ── 学习行为信号 ──
  readingDurationSec: number;     // 当前页面已阅读时长（秒）
  isReReading: boolean;           // 是否在回看（重复阅读标记）
  hasAnnotation: boolean;         // 当前区域是否有标注/高亮
  recentAnnotations?: string[];   // 最近的标注内容摘要

  // ── 用户提问 ──
  userQuestion: string;           // 学生的提问文本
  questionIntent?: QuestionIntent; // 提问意图（可选，客户端预分类）

  // ── 会话信息 ──
  conversationId?: string;        // 如果在已有对话中追问
  messageId?: string;             // 当前消息 ID
}

enum ContentType {
  TEXTBOOK_CHAPTER = 'textbook_chapter',   // 教材章节
  KNOWLEDGE_CARD = 'knowledge_card',       // 知识卡片
  MICRO_LESSON = 'micro_lesson',           // 微课讲义
  EXAM_REVIEW = 'exam_review',             // 试卷讲评
  ERROR_REVIEW = 'error_review',           // 错题复习
  EXAM_PREP = 'exam_prep',                 // 考点梳理
  READING_MATERIAL = 'reading_material',   // 课外阅读
}

enum QuestionIntent {
  CONCEPT_EXPLANATION = 'concept_explanation',     // "这个概念是什么意思"
  STEP_BY_STEP_SOLUTION = 'step_by_step_solution', // "这道题怎么解"
  WHY_THIS_ANSWER = 'why_this_answer',             // "为什么选C"
  COMPARE_CONCEPTS = 'compare_concepts',           // "A和B有什么区别"
  EXTEND_KNOWLEDGE = 'extend_knowledge',           // "还有其他方法吗"
  CONFIRM_UNDERSTANDING = 'confirm_understanding', // "我这样理解对吗"
  GENERAL_QUESTION = 'general_question',            // 通用提问
}
```

### 2.2 处理后的结构化上下文（内部模型）

经过引擎处理后的结构化上下文对象：

```typescript
interface StructuredReadingContext {
  // ── 场景元数据 ──
  sceneMeta: {
    contentType: ContentType;
    subject: Subject;
    gradeLevel: GradeLevel;
    textbookVersionId: string;
    chapterTitle: string;
    sectionTitle: string;
    knowledgePointNames: string[];
  };

  // ── 核心上下文段（直接注入Prompt）──
  contextSegments: ContextSegment[];

  // ── RAG 检索增强段 ──
  ragEnhancement: {
    enabled: boolean;
    retrievedChunks: RetrievedChunk[];
    totalTokens: number;
  };

  // ── 知识图谱关联 ──
  knowledgeGraphContext: {
    prerequisitePoints: KnowledgePointBrief[];  // 前置知识点
    relatedPoints: KnowledgePointBrief[];        // 关联知识点
    parentTopic?: string;                         // 所属主题
  };

  // ── Token 预算分配 ──
  tokenBudget: TokenBudgetPlan;

  // ── Prompt 段文本（最终产物）──
  promptContextBlock: string;  // 拼接好的上下文文本块
  estimatedTokens: number;
}

interface ContextSegment {
  type: SegmentType;
  priority: number;          // 优先级 1-5，1=最高
  content: string;           // 段内容
  estimatedTokens: number;
  source: string;            // 来源标识
}

enum SegmentType {
  VISIBLE_CONTENT = 'visible_content',       // 当前可见内容
  CHAPTER_CONTEXT = 'chapter_context',         // 章节背景信息
  KNOWLEDGE_DEFINITION = 'knowledge_definition', // 知识点定义
  PREREQUISITE = 'prerequisite',               // 前置知识
  RELATED_CONCEPT = 'related_concept',         // 关联概念
  RAG_RETRIEVAL = 'rag_retrieval',             // RAG检索结果
  READING_BEHAVIOR = 'reading_behavior',       // 阅读行为信号
  ANNOTATION = 'annotation',                   // 用户标注
}

interface RetrievedChunk {
  chunkId: string;
  content: string;
  score: number;            // 相关度分数 0-1
  source: string;           // 来源（知识库/题库/教材）
  estimatedTokens: number;
}

interface KnowledgePointBrief {
  kpId: string;
  name: string;
  definition: string;       // 简要定义（≤200字符）
  cognitiveLevel?: string;  // 认知层级（布鲁姆分类）
}

interface TokenBudgetPlan {
  totalBudget: number;        // 总Token预算
  conversationHistory: number; // 对话历史分配
  readingContext: number;      // 阅读上下文分配
  ragRetrieval: number;        // RAG检索分配
  systemPrompt: number;        // 系统提示词分配
  responseReserve: number;     // 响应预留
}
```

### 2.3 数据库表设计

#### 2.3.1 阅读上下文缓存表 `reading_context_cache`

用于缓存已处理的上下文，避免重复计算（同一内容 + 同一位置的上下文可复用）。

```sql
CREATE TABLE reading_context_cache (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    cache_key       VARCHAR(128) NOT NULL COMMENT '缓存键: SHA256(contentId+sectionIndex+paragraphIndex+scrollBucket)',
    content_id      VARCHAR(64)  NOT NULL COMMENT '内容ID',
    chapter_id      VARCHAR(64)  NOT NULL COMMENT '章节ID',
    section_index   INT          NOT NULL COMMENT '小节序号',
    paragraph_index INT          DEFAULT NULL COMMENT '段落序号',
    scroll_bucket   INT          NOT NULL COMMENT '滚动百分比桶(0-19, 每5%一个桶)',
    subject         VARCHAR(16)  NOT NULL COMMENT '学科',
    grade_level     VARCHAR(16)  NOT NULL COMMENT '年级',

    -- 缓存的结构化上下文（JSON）
    structured_context JSON      NOT NULL COMMENT '处理后的结构化上下文',
    kp_ids          JSON         NOT NULL COMMENT '关联知识点ID列表',
    estimated_tokens INT         NOT NULL COMMENT '估算Token数',

    -- 生命周期
    hit_count       INT          DEFAULT 0 COMMENT '命中次数',
    expires_at      DATETIME     NOT NULL COMMENT '过期时间',
    created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_cache_key (cache_key),
    INDEX idx_content_section (content_id, section_index, scroll_bucket),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='阅读上下文缓存表';
```

#### 2.3.2 上下文注入日志表 `context_injection_log`

记录每次上下文注入的详情，用于效果分析和优化。

```sql
CREATE TABLE context_injection_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    log_id          VARCHAR(64)  NOT NULL COMMENT '日志唯一ID(UUID)',
    user_id         VARCHAR(64)  NOT NULL COMMENT '用户ID',
    conversation_id VARCHAR(64)  DEFAULT NULL COMMENT '对话ID',
    message_id      VARCHAR(64)  NOT NULL COMMENT '消息ID',

    -- 输入信号
    content_id      VARCHAR(64)  NOT NULL COMMENT '内容ID',
    content_type    VARCHAR(32)  NOT NULL COMMENT '内容类型',
    chapter_id      VARCHAR(64)  DEFAULT NULL COMMENT '章节ID',
    subject         VARCHAR(16)  NOT NULL COMMENT '学科',

    -- 处理结果
    context_segments_count INT   NOT NULL COMMENT '上下文段数量',
    total_injected_tokens  INT   NOT NULL COMMENT '注入总Token数',
    rag_chunks_count       INT   DEFAULT 0 COMMENT 'RAG检索块数',
    cache_hit              BOOLEAN DEFAULT FALSE COMMENT '是否命中缓存',

    -- 处理耗时
    extract_duration_ms INT      NOT NULL COMMENT '提取耗时(ms)',
    rag_duration_ms     INT      DEFAULT 0 COMMENT 'RAG检索耗时(ms)',
    total_duration_ms   INT      NOT NULL COMMENT '总耗时(ms)',

    -- Token预算分配（JSON）
    token_budget_plan   JSON     NOT NULL COMMENT 'Token预算分配',

    -- 效果标记（后异步填充）
    user_satisfied      BOOLEAN  DEFAULT NULL COMMENT '用户是否满意(点赞/点踩)',
    model_response_quality VARCHAR(32) DEFAULT NULL COMMENT '模型回答质量评分',

    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_user_time (user_id, created_at),
    INDEX idx_conversation (conversation_id),
    INDEX idx_content (content_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='上下文注入日志表';
```

#### 2.3.3 内容位置→知识点映射表 `content_position_kp_mapping`

预计算的映射表，将内容的具体位置（章节+段落）映射到知识点：

```sql
CREATE TABLE content_position_kp_mapping (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    content_id      VARCHAR(64)  NOT NULL COMMENT '内容ID',
    section_index   INT          NOT NULL COMMENT '小节序号',
    paragraph_start INT          NOT NULL COMMENT '起始段落',
    paragraph_end   INT          NOT NULL COMMENT '结束段落',

    kp_id           VARCHAR(64)  NOT NULL COMMENT '知识点ID',
    kp_name         VARCHAR(256) NOT NULL COMMENT '知识点名称',
    relevance_score DECIMAL(3,2) DEFAULT 1.00 COMMENT '相关度(0-1)',

    -- 上下文段落摘要
    paragraph_summary VARCHAR(512) DEFAULT NULL COMMENT '该段落区域的知识摘要',
    key_terms       JSON           NOT NULL COMMENT '关键术语列表',

    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_content_section (content_id, section_index),
    INDEX idx_kp (kp_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='内容位置知识点映射表';
```

---

## 3. API 接口设计

### 3.1 核心接口：构建阅读上下文

**接口路径：** `POST /api/v1/reading-context/build`

**请求参数：**

```json
{
  "contentId": "ch_2024_math_g7_v2_ch3_s2",
  "contentType": "textbook_chapter",
  "chapterId": "ch_math_g7_v2_ch3",
  "knowledgePointIds": ["kp_linear_equation", "kp_one_unknown"],
  "subject": "math",
  "gradeLevel": "grade_7",
  "textbookVersionId": "tb_people_edition_2024",
  "readingPosition": {
    "sectionIndex": 2,
    "paragraphIndex": 5,
    "scrollPercentage": 45,
    "visibleTextRange": {
      "startOffset": 1200,
      "endOffset": 1800
    }
  },
  "visibleContentSnippet": "一元一次方程的标准形式为 ax+b=0 (a≠0)...",
  "surroundingParagraphs": "前面：我们已经学习了等式的基本性质...后面：例题：解方程 2x+3=7...",
  "readingDurationSec": 120,
  "isReReading": false,
  "hasAnnotation": true,
  "recentAnnotations": ["ax+b=0中a为什么不能等于0"],
  "userQuestion": "为什么 a 不能等于0？",
  "questionIntent": "concept_explanation",
  "conversationId": "conv_abc123",
  "messageId": "msg_def456"
}
```

**响应参数：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "contextId": "rctx_202608120001",
    "promptContextBlock": "【学习场景】\n学科：数学 | 年级：七年级 | 教材：人教版2024\n章节：第三章 一元一次方程 > 3.2 一元一次方程的概念\n当前阅读位置：第2小节 第5段落 (滚动45%)\n关联知识点：一元一次方程、标准形式\n\n【当前阅读内容】\n一元一次方程的标准形式为 ax+b=0 (a≠0)...\n\n【学生标注】\n用户在此段落标注了疑问：「ax+b=0中a为什么不能等于0」\n\n【前置知识回顾】\n• 等式的基本性质：等式两边同时加/减/乘/除同一个数（除数不为0），等式仍然成立\n• 方程：含有未知数的等式\n\n【知识关联】\n• 二元一次方程（后续学习）\n• 一元二次方程（高中学习）",
    "estimatedTokens": 380,
    "tokenBudgetPlan": {
      "totalBudget": 4096,
      "conversationHistory": 1500,
      "readingContext": 600,
      "ragRetrieval": 500,
      "systemPrompt": 800,
      "responseReserve": 696
    },
    "contextSegments": [
      {
        "type": "visible_content",
        "priority": 1,
        "estimatedTokens": 80
      },
      {
        "type": "chapter_context",
        "priority": 2,
        "estimatedTokens": 50
      },
      {
        "type": "annotation",
        "priority": 1,
        "estimatedTokens": 30
      },
      {
        "type": "prerequisite",
        "priority": 3,
        "estimatedTokens": 60
      },
      {
        "type": "related_concept",
        "priority": 4,
        "estimatedTokens": 40
      }
    ],
    "cacheHit": false,
    "processingTimeMs": 156
  }
}
```

### 3.2 批量预构建接口

用于客户端预加载多个位置的上下文（如章节切换前预热）：

**接口路径：** `POST /api/v1/reading-context/pre-build`

```json
{
  "requests": [
    {
      "contentId": "ch_2024_math_g7_v2_ch3_s2",
      "sectionIndex": 2,
      "scrollBucket": 9,
      "subject": "math",
      "gradeLevel": "grade_7",
      "textbookVersionId": "tb_people_edition_2024"
    },
    {
      "contentId": "ch_2024_math_g7_v2_ch3_s3",
      "sectionIndex": 3,
      "scrollBucket": 0,
      "subject": "math",
      "gradeLevel": "grade_7",
      "textbookVersionId": "tb_people_edition_2024"
    }
  ]
}
```

### 3.3 上下文效果反馈接口

**接口路径：** `POST /api/v1/reading-context/feedback`

```json
{
  "contextId": "rctx_202608120001",
  "messageId": "msg_def456",
  "userSatisfied": true,
  "qualityScore": 0.85,
  "feedbackNote": "回答准确解释了a≠0的原因"
}
```

### 3.4 管理接口：上下文模板配置查询

**接口路径：** `GET /api/v1/admin/reading-context/templates`

返回各内容类型对应的上下文提取策略和 Prompt 模板配置。

---

## 4. 核心处理流程

### 4.1 主处理流程（Pipeline）

```
                         ReadingContextSignal
                                │
                 ┌──────────────▼──────────────┐
                 │     Step 1: 信号校验与标准化   │
                 │  • 参数合法性校验              │
                 │  • 文本片段清洗（去HTML标签等）  │
                 │  • 位置信息标准化              │
                 └──────────────┬──────────────┘
                                │
                 ┌──────────────▼──────────────┐
                 │     Step 2: 缓存查询          │
                 │  • 计算 cache_key             │
                 │  • 命中 → 直接返回（跳到Step7）│
                 │  • 未命中 → 继续              │
                 └──────────────┬──────────────┘
                                │
                 ┌──────────────▼──────────────┐
                 │     Step 3: 上下文提取        │
                 │  • 查询内容位置→知识点映射     │
                 │  • 查询知识点定义和属性        │
                 │  • 查询章节标题和层级路径      │
                 │  • 查询前置知识点             │
                 │  • 查询关联知识点             │
                 └──────────────┬──────────────┘
                                │
                 ┌──────────────▼──────────────┐
                 │     Step 4: RAG 检索增强     │
                 │  • 基于用户问题+可见内容构建   │
                 │    检索query                  │
                 │  • 向量检索相关知识库内容     │
                 │  • 相关度排序与截断           │
                 └──────────────┬──────────────┘
                                │
                 ┌──────────────▼──────────────┐
                 │     Step 5: Token 预算分配   │
                 │  • 计算对话历史Token占用      │
                 │  • 按优先级分配上下文段Token  │
                 │  • 压缩/裁剪低优先级段        │
                 └──────────────┬──────────────┘
                                │
                 ┌──────────────▼──────────────┐
                 │     Step 6: Prompt 段装配    │
                 │  • 按模板拼装上下文文本块     │
                 │  • 插入场景元数据             │
                 │  • 格式化知识点和定义         │
                 └──────────────┬──────────────┘
                                │
                 ┌──────────────▼──────────────┐
                 │     Step 7: 写缓存 + 日志    │
                 │  • 异步写入上下文缓存         │
                 │  • 异步写入注入日志           │
                 │  • 返回结构化上下文           │
                 └─────────────────────────────┘
```

### 4.2 关键算法

#### 4.2.1 缓存键计算

```python
import hashlib

def compute_cache_key(signal: ReadingContextSignal) -> str:
    """
    计算上下文缓存键。
    将滚动百分比量化为5%的桶，避免频繁缓存未命中。
    """
    scroll_bucket = signal.reading_position.scroll_percentage // 5

    raw = f"{signal.content_id}|{signal.reading_position.section_index}|{signal.reading_position.paragraph_index}|{scroll_bucket}"

    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
```

#### 4.2.2 Token 预算分配算法

```python
from dataclasses import dataclass
from typing import List

@dataclass
class SegmentWithTokens:
    segment: ContextSegment
    estimated_tokens: int
    min_tokens: int        # 最少需要的Token数
    desired_tokens: int    # 理想Token数

def allocate_token_budget(
    segments: List[SegmentWithTokens],
    conversation_history_tokens: int,
    model_max_context: int = 4096,
    response_reserve_ratio: float = 0.25,
    system_prompt_tokens: int = 800,
) -> TokenBudgetPlan:
    """
    按优先级为各上下文段分配Token预算。
    """
    response_reserve = int(model_max_context * response_reserve_ratio)
    available = model_max_context - system_prompt_tokens - conversation_history_tokens - response_reserve

    if available <= 0:
        # 对话历史过长，触发历史压缩
        return _trigger_history_compression(
            segments, conversation_history_tokens,
            model_max_context, system_prompt_tokens, response_reserve
        )

    # 按优先级排序
    sorted_segs = sorted(segments, key=lambda s: s.segment.priority)

    remaining = available
    allocations = {}

    # 第一轮：满足每个段的 min_tokens
    for seg in sorted_segs:
        alloc = min(seg.min_tokens, remaining)
        allocations[seg.segment.type] = alloc
        remaining -= alloc

    # 第二轮：将剩余Token按优先级分配给 desired_tokens
    for seg in sorted_segs:
        if remaining <= 0:
            break
        current = allocations.get(seg.segment.type, 0)
        additional = min(seg.desired_tokens - current, remaining)
        allocations[seg.segment.type] = current + additional
        remaining -= additional

    return TokenBudgetPlan(
        total_budget=model_max_context,
        conversation_history=conversation_history_tokens,
        reading_context=sum(allocations.get(t, 0) for t in [
            SegmentType.VISIBLE_CONTENT,
            SegmentType.CHAPTER_CONTEXT,
            SegmentType.ANNOTATION,
            SegmentType.READING_BEHAVIOR,
        ]),
        rag_retrieval=allocations.get(SegmentType.RAG_RETRIEVAL, 0),
        system_prompt=system_prompt_tokens,
        response_reserve=response_reserve,
    )
```

#### 4.2.3 RAG 检索查询构建

```python
def build_rag_query(signal: ReadingContextSignal) -> str:
    """
    基于阅读上下文信号构建RAG检索查询。
    将可见内容 + 用户问题 + 知识点名称组合为检索query。
    """
    parts = []

    # 用户问题（最高权重）
    parts.append(signal.user_question)

    # 可见内容关键句（截取前200字符）
    snippet = signal.visible_content_snippet[:200]
    parts.append(snippet)

    # 知识点名称
    if signal.knowledge_point_ids:
        kp_names = _fetch_kp_names(signal.knowledge_point_ids)
        parts.extend(kp_names)

    # 如果用户有标注，也加入查询
    if signal.recent_annotations:
        parts.extend(signal.recent_annotations[:2])  # 最多取2条

    return " ".join(parts)
```

#### 4.2.4 上下文段优先级排序

```python
# 内容类型 → 段类型权重映射
CONTENT_TYPE_WEIGHTS: dict[ContentType, dict[SegmentType, int]] = {
    ContentType.TEXTBOOK_CHAPTER: {
        SegmentType.VISIBLE_CONTENT: 1,    # 当前内容最重要
        SegmentType.ANNOTATION: 1,         # 学生标注代表困惑
        SegmentType.CHAPTER_CONTEXT: 2,    # 章节背景
        SegmentType.PREREQUISITE: 3,       # 前置知识
        SegmentType.RELATED_CONCEPT: 4,    # 关联概念
        SegmentType.RAG_RETRIEVAL: 2,      # 检索补充
        SegmentType.KNOWLEDGE_DEFINITION: 2,
        SegmentType.READING_BEHAVIOR: 5,   # 行为信号最低
    },
    ContentType.ERROR_REVIEW: {
        SegmentType.VISIBLE_CONTENT: 1,
        SegmentType.ANNOTATION: 1,
        SegmentType.KNOWLEDGE_DEFINITION: 2,  # 错题复习重点在知识定义
        SegmentType.PREREQUISITE: 2,
        SegmentType.RAG_RETRIEVAL: 3,
        SegmentType.RELATED_CONCEPT: 4,
        SegmentType.CHAPTER_CONTEXT: 5,
        SegmentType.READING_BEHAVIOR: 5,
    },
    ContentType.EXAM_PREP: {
        SegmentType.VISIBLE_CONTENT: 1,
        SegmentType.RAG_RETRIEVAL: 1,       # 考点梳理需要更多检索
        SegmentType.RELATED_CONCEPT: 2,
        SegmentType.KNOWLEDGE_DEFINITION: 2,
        SegmentType.ANNOTATION: 3,
        SegmentType.PREREQUISITE: 3,
        SegmentType.CHAPTER_CONTEXT: 4,
        SegmentType.READING_BEHAVIOR: 5,
    },
    # ... 其他内容类型
}

def get_segment_priority(content_type: ContentType, segment_type: SegmentType) -> int:
    """获取段在特定内容类型下的优先级（1=最高）"""
    weights = CONTENT_TYPE_WEIGHTS.get(content_type, CONTENT_TYPE_WEIGHTS[ContentType.TEXTBOOK_CHAPTER])
    return weights.get(segment_type, 5)
```

### 4.3 Prompt 上下文块模板

按内容类型使用不同的 Prompt 模板装配上下文块：

#### 4.3.1 教材章节阅读模板

```python
TEXTBOOK_CHAPTER_TEMPLATE = """【学习场景】
学科：{subject_name} | 年级：{grade_name} | 教材：{textbook_name}
章节：{chapter_path}
当前阅读位置：第{section_index_plus_1}小节 第{paragraph_index_plus_1}段落 (滚动{scroll_percentage}%)

【当前阅读内容】
{visible_content}

{annotation_block}

{prerequisite_block}

{related_concept_block}

{rag_block}"""

def render_textbook_context(ctx: StructuredReadingContext, signal: ReadingContextSignal) -> str:
    # 标注块
    annotation_block = ""
    if signal.recent_annotations:
        annotation_lines = "\n".join(f"  • {a}" for a in signal.recent_annotations[:3])
        annotation_block = f"【学生标注】\n用户在此区域标注了：\n{annotation_lines}\n"

    # 前置知识块
    prerequisite_block = ""
    prereqs = ctx.knowledge_graph_context.prerequisite_points
    if prereqs:
        prereq_lines = "\n".join(f"  • {p.name}：{p.definition}" for p in prereqs[:3])
        prerequisite_block = f"【前置知识回顾】\n{prereq_lines}\n"

    # 关联概念块
    related_block = ""
    related = ctx.knowledge_graph_context.related_points
    if related:
        related_lines = "\n".join(f"  • {r.name}" for r in related[:3])
        related_block = f"【知识关联】\n{related_lines}\n"

    # RAG检索块
    rag_block = ""
    if ctx.rag_enancement.enabled and ctx.rag_enancement.retrieved_chunks:
        chunk_lines = "\n".join(
            f"  • {chunk.content[:150]}"
            for chunk in ctx.rag_enancement.retrieved_chunks[:2]
        )
        rag_block = f"【补充参考】\n{chunk_lines}\n"

    return TEXTBOOK_CHAPTER_TEMPLATE.format(
        subject_name=_subject_display_name(signal.subject),
        grade_name=_grade_display_name(signal.grade_level),
        textbook_name=_textbook_display_name(signal.textbook_version_id),
        chapter_path=_fetch_chapter_path(signal.chapter_id),
        section_index_plus_1=signal.reading_position.section_index + 1,
        paragraph_index_plus_1=signal.reading_position.paragraph_index + 1,
        scroll_percentage=signal.reading_position.scroll_percentage,
        visible_content=signal.visible_content_snippet[:500],
        annotation_block=annotation_block,
        prerequisite_block=prerequisite_block,
        related_concept_block=related_block,
        rag_block=rag_block,
    )
```

#### 4.3.2 错题复习模板

```python
ERROR_REVIEW_TEMPLATE = """【学习场景：错题复习】
学科：{subject_name} | 年级：{grade_name}
错题关联知识点：{kp_names}

【当前错题内容】
{visible_content}

【学生标注】
{annotation_block}

【知识点详解】
{knowledge_definitions}

【易错点提醒】
{common_mistakes}

【相关知识点】
{related_concepts}"""
```

---

## 5. 服务架构与代码结构

### 5.1 分层架构

```
com.primetop.readingcontext
├── controller
│   └── ReadingContextController.java       # API 入口
├── service
│   ├── ReadingContextService.java          # 核心服务编排
│   ├── ContextExtractionService.java       # 上下文提取
│   ├── TokenBudgetService.java             # Token 预算分配
│   ├── RagEnhancementService.java          # RAG 检索增强
│   ├── KnowledgeGraphContextService.java   # 知识图谱关联
│   ├── PromptAssemblyService.java          # Prompt 段装配
│   ├── ContextCacheService.java            # 缓存服务
│   └── ContextLogService.java              # 日志服务
├── model
│   ├── ReadingContextSignal.java           # 输入信号
│   ├── StructuredReadingContext.java       # 输出模型
│   ├── ContextSegment.java                 # 上下文段
│   └── TokenBudgetPlan.java                # Token 预算
├── repository
│   ├── ReadingContextCacheRepository.java
│   ├── ContextInjectionLogRepository.java
│   └── ContentPositionKpMappingRepository.java
├── config
│   ├── ContentTypeWeightConfig.java        # 内容类型权重配置
│   └── TokenBudgetConfig.java              # Token 预算配置
└── util
    ├── TokenEstimator.java                 # Token 估算工具
    ├── TextCleaner.java                    # 文本清洗工具
    └── CacheKeyUtil.java                   # 缓存键工具
```

### 5.2 核心服务实现

```java
@Service
@RequiredArgsConstructor
@Slf4j
public class ReadingContextService {

    private final ContextExtractionService extractionService;
    private final RagEnhancementService ragService;
    private final TokenBudgetService tokenBudgetService;
    private final PromptAssemblyService promptAssemblyService;
    private final ContextCacheService cacheService;
    private final ContextLogService logService;

    /**
     * 构建阅读上下文（主入口）
     */
    public StructuredReadingContext buildContext(ReadingContextSignal signal) {
        long startTime = System.currentTimeMillis();

        // Step 1: 校验与标准化
        validateAndNormalize(signal);

        // Step 2: 缓存查询
        String cacheKey = CacheKeyUtil.compute(signal);
        Optional<StructuredReadingContext> cached = cacheService.get(cacheKey);
        if (cached.isPresent()) {
            logService.asyncLog(signal, cached.get(), true, startTime);
            return cached.get();
        }

        // Step 3: 上下文提取
        long extractStart = System.currentTimeMillis();
        List<ContextSegment> segments = extractionService.extract(signal);
        long extractDuration = System.currentTimeMillis() - extractStart;

        // Step 4: RAG 检索增强
        long ragStart = System.currentTimeMillis();
        List<RetrievedChunk> ragChunks = ragService.search(signal);
        long ragDuration = System.currentTimeMillis() - ragStart;
        segments.addAll(ragChunks.stream()
            .map(c -> ContextSegment.fromRag(c))
            .toList());

        // Step 5: Token 预算分配
        int historyTokens = estimateConversationHistory(signal.getConversationId());
        TokenBudgetPlan budget = tokenBudgetService.allocate(segments, historyTokens);

        // 裁剪超出预算的段
        List<ContextSegment> trimmed = tokenBudgetService.trimSegments(segments, budget);

        // Step 6: Prompt 段装配
        StructuredReadingContext result = promptAssemblyService.assemble(
            signal, trimmed, budget
        );

        // Step 7: 写缓存 + 日志
        cacheService.putAsync(cacheKey, result, Duration.ofMinutes(30));
        logService.asyncLog(signal, result, false, startTime);

        return result;
    }

    private void validateAndNormalize(ReadingContextSignal signal) {
        if (signal.getUserQuestion() == null || signal.getUserQuestion().isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_QUESTION, "用户问题不能为空");
        }
        if (signal.getVisibleContentSnippet().length() > 2000) {
            signal.setVisibleContentSnippet(
                signal.getVisibleContentSnippet().substring(0, 2000)
            );
        }
        if (signal.getSurroundingParagraphs() != null
            && signal.getSurroundingParagraphs().length() > 3000) {
            signal.setSurroundingParagraphs(
                signal.getSurroundingParagraphs().substring(0, 3000)
            );
        }
    }

    private int estimateConversationHistory(String conversationId) {
        if (conversationId == null) return 0;
        return aiConversationService.estimateHistoryTokens(conversationId);
    }
}
```

### 5.3 Token 预算服务

```java
@Service
@RequiredArgsConstructor
public class TokenBudgetService {

    private final TokenBudgetConfig config;

    // 各段类型的默认 Token 需求
    private static final Map<SegmentType, int[]> DEFAULT_TOKEN_BOUNDS = Map.of(
        // {min, desired}
        SegmentType.VISIBLE_CONTENT,     new int[]{80, 300},
        SegmentType.CHAPTER_CONTEXT,     new int[]{30, 100},
        SegmentType.KNOWLEDGE_DEFINITION,new int[]{60, 200},
        SegmentType.PREREQUISITE,        new int[]{40, 150},
        SegmentType.RELATED_CONCEPT,     new int[]{30, 100},
        SegmentType.RAG_RETRIEVAL,       new int[]{0, 300},
        SegmentType.READING_BEHAVIOR,    new int[]{0, 50},
        SegmentType.ANNOTATION,          new int[]{0, 100}
    );

    public TokenBudgetPlan allocate(
        List<ContextSegment> segments,
    int conversationHistoryTokens
    ) {
        int modelMax = config.getModelMaxContext();      // 默认 4096
        int systemPrompt = config.getSystemPromptTokens(); // 默认 800
        double reserveRatio = config.getResponseReserveRatio(); // 默认 0.25

        int responseReserve = (int) (modelMax * reserveRatio);
        int available = modelMax - systemPrompt - conversationHistoryTokens - responseReserve;

        if (available < 200) {
            // 可用空间过小，触发对话历史压缩
            return allocateWithCompression(
                segments, conversationHistoryTokens, modelMax, systemPrompt, responseReserve
            );
        }

        // 按优先级排序
        List<ContextSegment> sorted = segments.stream()
            .sorted(Comparator.comparingInt(ContextSegment::getPriority))
            .toList();

        int remaining = available;
        Map<SegmentType, Integer> allocations = new EnumMap<>(SegmentType.class);

        // 第一轮：满足最小需求
        for (ContextSegment seg : sorted) {
            int[] bounds = DEFAULT_TOKEN_BOUNDS.getOrDefault(seg.getType(), new int[]{0, 100});
            int alloc = Math.min(bounds[0], remaining);
            allocations.merge(seg.getType(), alloc, Integer::sum);
            remaining -= alloc;
        }

        // 第二轮：满足理想需求
        for (ContextSegment seg : sorted) {
            if (remaining <= 0) break;
            int[] bounds = DEFAULT_TOKEN_BOUNDS.getOrDefault(seg.getType(), new int[]{0, 100});
            int current = allocations.getOrDefault(seg.getType(), 0);
            int additional = Math.min(bounds[1] - current, remaining);
            if (additional > 0) {
                allocations.merge(seg.getType(), additional, Integer::sum);
                remaining -= additional;
            }
        }

        return TokenBudgetPlan.builder()
            .totalBudget(modelMax)
            .conversationHistory(conversationHistoryTokens)
            .readingContext(sumReadingTokens(allocations))
            .ragRetrieval(allocations.getOrDefault(SegmentType.RAG_RETRIEVAL, 0))
            .systemPrompt(systemPrompt)
            .responseReserve(responseReserve)
            .build();
    }

    /**
     * 裁剪段内容以适应Token预算
     */
    public List<ContextSegment> trimSegments(
        List<ContextSegment> segments,
    TokenBudgetPlan budget
    ) {
        int readingBudget = budget.getReadingContext();
        int ragBudget = budget.getRagRetrieval();

        List<ContextSegment> result = new ArrayList<>();
        int readingUsed = 0;
        int ragUsed = 0;

        // 按优先级处理
        List<ContextSegment> sorted = segments.stream()
            .sorted(Comparator.comparingInt(ContextSegment::getPriority))
            .toList();

        for (ContextSegment seg : sorted) {
            if (seg.getType() == SegmentType.RAG_RETRIEVAL) {
                if (ragUsed + seg.getEstimatedTokens() <= ragBudget) {
                    result.add(seg);
                    ragUsed += seg.getEstimatedTokens();
                } else if (ragBudget - ragUsed > 20) {
                    // 截断RAG内容
                    result.add(truncateSegment(seg, ragBudget - ragUsed));
                    ragUsed = ragBudget;
                }
            } else {
                if (readingUsed + seg.getEstimatedTokens() <= readingBudget) {
                    result.add(seg);
                    readingUsed += seg.getEstimatedTokens();
                } else if (readingBudget - readingUsed > 20) {
                    result.add(truncateSegment(seg, readingBudget - readingUsed));
                    readingUsed = readingBudget;
                }
            }
        }

        return result;
    }

    private ContextSegment truncateSegment(ContextSegment seg, int maxTokens) {
        // 粗略估算：1 Token ≈ 1.5 个中文字符或 0.75 个英文单词
        int maxChars = (int) (maxTokens * 1.5);
        String truncated = seg.getContent();
        if (truncated.length() > maxChars) {
            truncated = truncated.substring(0, maxChars) + "...";
        }
        return ContextSegment.builder()
            .type(seg.getType())
            .priority(seg.getPriority())
            .content(truncated)
            .estimatedTokens(maxTokens)
            .source(seg.getSource())
            .build();
    }

    private TokenBudgetPlan allocateWithCompression(
        List<ContextSegment> segments,
    int historyTokens, int modelMax, int systemPrompt, int responseReserve
    ) {
        // 对话历史压缩到原来的40%
        int compressedHistory = (int) (historyTokens * 0.4);
        int freedTokens = historyTokens - compressedHistory;
        int available = modelMax - systemPrompt - compressedHistory - responseReserve;

        // 标记需要历史压缩
        log.warn("对话历史过长({}tokens)，触发压缩至{}tokens", historyTokens, compressedHistory);

        // 重新分配
        TokenBudgetPlan plan = allocate(segments, compressedHistory);
        plan.setConversationHistory(compressedHistory);
        plan.setHistoryCompressed(true);
        return plan;
    }
}
```

### 5.4 RAG 检索增强服务

```java
@Service
@RequiredArgsConstructor
public class RagEnhancementService {

    private final VectorSearchClient vectorSearchClient;
    private final KnowledgeBaseRepository knowledgeBaseRepo;
    private final TokenEstimator tokenEstimator;

    // 检索结果数量
    private static final int TOP_K = 5;
    // 最低相关度阈值
    private static final float MIN_SCORE = 0.65f;
    // 最大RAG Token总量
    private static final int MAX_RAG_TOKENS = 300;

    public List<RetrievedChunk> search(ReadingContextSignal signal) {
        // 构建检索查询
        String query = buildRagQuery(signal);

        // 向量检索
        List<VectorSearchResult> results = vectorSearchClient.search(
            query,
            signal.getSubject(),
            signal.getGradeLevel(),
            TOP_K,
            MIN_SCORE
        );

        // 过滤：排除当前可见内容本身（避免重复）
        results = results.stream()
            .filter(r -> !r.getSource().equals(signal.getContentId()))
            .toList();

        // 转换为 RetrievedChunk 并估算Token
        List<RetrievedChunk> chunks = results.stream()
            .map(r -> RetrievedChunk.builder()
                .chunkId(r.getChunkId())
                .content(r.getContent())
                .score(r.getScore())
                .source(r.getSource())
                .estimatedTokens(tokenEstimator.estimate(r.getContent()))
                .build())
            .toList();

        // Token 总量控制
        return truncateByTokenBudget(chunks, MAX_RAG_TOKENS);
    }

    private String buildRagQuery(ReadingContextSignal signal) {
        StringBuilder sb = new StringBuilder();
        sb.append(signal.getUserQuestion());

        if (signal.getVisibleContentSnippet() != null) {
            sb.append(" ").append(signal.getVisibleContentSnippet(), 0,
                Math.min(200, signal.getVisibleContentSnippet().length()));
        }

        if (signal.getRecentAnnotations() != null && !signal.getRecentAnnotations().isEmpty()) {
            for (String ann : signal.getRecentAnnotations()) {
                sb.append(" ").append(ann);
            }
        }

        return sb.toString();
    }

    private List<RetrievedChunk> truncateByTokenBudget(
        List<RetrievedChunk> chunks, int maxTokens
    ) {
        List<RetrievedChunk> result = new ArrayList<>();
        int used = 0;
        for (RetrievedChunk chunk : chunks) {
            if (used + chunk.getEstimatedTokens() <= maxTokens) {
                result.add(chunk);
                used += chunk.getEstimatedTokens();
            } else {
                break;
            }
        }
        return result;
    }
}
```

### 5.5 上下文提取服务

```java
@Service
@RequiredArgsConstructor
public class ContextExtractionService {

    private final ContentPositionKpMappingRepository mappingRepo;
    private final KnowledgePointRepository kpRepo;
    private final ChapterRepository chapterRepo;
    private final KnowledgeGraphService knowledgeGraphService;

    public List<ContextSegment> extract(ReadingContextSignal signal) {
        List<ContextSegment> segments = new ArrayList<>();

        // 1. 可见内容段（直接来自客户端）
        segments.add(ContextSegment.builder()
            .type(SegmentType.VISIBLE_CONTENT)
            .priority(getPriority(signal.getContentType(), SegmentType.VISIBLE_CONTENT))
            .content(signal.getVisibleContentSnippet())
            .estimatedTokens(estimateTokens(signal.getVisibleContentSnippet()))
            .source("client_visible")
            .build());

        // 2. 章节上下文段
        ChapterPath chapterPath = chapterRepo.findPath(signal.getChapterId());
        if (chapterPath != null) {
            String chapterContext = String.format("%s > %s",
                chapterPath.getUnitTitle(),
                chapterPath.getChapterTitle());
            segments.add(ContextSegment.builder()
                .type(SegmentType.CHAPTER_CONTEXT)
                .priority(getPriority(signal.getContentType(), SegmentType.CHAPTER_CONTEXT))
                .content(chapterContext)
                .estimatedTokens(estimateTokens(chapterContext))
                .source("chapter_hierarchy")
                .build());
        }

        // 3. 位置→知识点映射查询
        List<ContentPositionKpMapping> positionMappings =
            mappingRepo.findByContentAndSection(
                signal.getContentId(),
                signal.getReadingPosition().getSectionIndex()
            );

        // 4. 知识点定义段
        for (ContentPositionKpMapping mapping : positionMappings) {
            if (mapping.getRelevanceScore().compareTo(BigDecimal.valueOf(0.7)) > 0) {
                KnowledgePoint kp = kpRepo.findById(mapping.getKpId());
                if (kp != null) {
                    String definition = String.format("%s：%s", kp.getName(), kp.getDefinition());
                    segments.add(ContextSegment.builder()
                        .type(SegmentType.KNOWLEDGE_DEFINITION)
                        .priority(getPriority(signal.getContentType(),
                            SegmentType.KNOWLEDGE_DEFINITION))
                        .content(definition)
                        .estimatedTokens(estimateTokens(definition))
                        .source("knowledge_base")
                        .build());
                }
            }
        }

        // 5. 前置知识点段
        List<KnowledgePointBrief> prereqs = knowledgeGraphService
            .getPrerequisites(signal.getKnowledgePointIds(), 3);
        for (KnowledgePointBrief prereq : prereqs) {
            String content = String.format("%s：%s", prereq.getName(), prereq.getDefinition());
            segments.add(ContextSegment.builder()
                .type(SegmentType.PREREQUISITE)
                .priority(getPriority(signal.getContentType(), SegmentType.PREREQUISITE))
                .content(content)
                .estimatedTokens(estimateTokens(content))
                .source("knowledge_graph")
                .build());
        }

        // 6. 关联知识点段
        List<KnowledgePointBrief> related = knowledgeGraphService
            .getRelatedPoints(signal.getKnowledgePointIds(), 3);
        for (KnowledgePointBrief rel : related) {
            segments.add(ContextSegment.builder()
                .type(SegmentType.RELATED_CONCEPT)
                .priority(getPriority(signal.getContentType(),
                    SegmentType.RELATED_CONCEPT))
                .content(rel.getName())
                .estimatedTokens(estimateTokens(rel.getName()))
                .source("knowledge_graph")
                .build());
        }

        // 7. 用户标注段
        if (signal.getRecentAnnotations() != null) {
            for (String ann : signal.getRecentAnnotations()) {
                segments.add(ContextSegment.builder()
                    .type(SegmentType.ANNOTATION)
                    .priority(getPriority(signal.getContentType(), SegmentType.ANNOTATION))
                    .content(ann)
                    .estimatedTokens(estimateTokens(ann))
                    .source("user_annotation")
                    .build());
            }
        }

        // 8. 阅读行为信号段（低优先级，用于AI感知学生状态）
        if (signal.getReadingDurationSec() > 180 || signal.isReReading()) {
            String behavior = buildBehaviorHint(signal);
            segments.add(ContextSegment.builder()
                .type(SegmentType.READING_BEHAVIOR)
                .priority(getPriority(signal.getContentType(),
                    SegmentType.READING_BEHAVIOR))
                .content(behavior)
                .estimatedTokens(estimateTokens(behavior))
                .source("reading_behavior")
                .build());
        }

        return segments;
    }

    private String buildBehaviorHint(ReadingContextSignal signal) {
        if (signal.isReReading() && signal.getReadingDurationSec() > 300) {
            return "学生正在反复阅读此段落超过5分钟，可能对内容理解有困难";
        } else if (signal.isReReading()) {
            return "学生正在回看此段落";
        } else if (signal.getReadingDurationSec() > 180) {
            return "学生在此段落停留较久";
        }
        return "";
    }

    private int getPriority(ContentType contentType, SegmentType segmentType) {
        return ContentTypeWeightConfig.getWeight(contentType, segmentType);
    }

    private int estimateTokens(String text) {
        // 粗略估算：中文≈1.5字/Token，英文≈0.75词/Token
        return (int) Math.ceil(text.length() / 1.5);
    }
}
```

---

## 6. 状态流转

### 6.1 上下文处理状态机

```
                    ┌──────────┐
         请求进入 ──→│ RECEIVED │
                    └────┬─────┘
                         │
                ┌────────▼────────┐
                │    VALIDATING   │
                └────────┬────────┘
                         │
              ┌──────────┼──────────┐
              │校验失败   │校验通过   │
              ▼          ▼          │
        ┌──────────┐ ┌──────────┐  │
        │  FAILED  │ │CACHING   │  │
        └──────────┘ │ _CHECK   │  │
                     └────┬─────┘  │
                   ┌──────┼──────┐│
                   │命中   │未命中││
                   ▼      ▼      ││
            ┌────────┐ ┌─────────▼▼┐
            │CACHED  │ │EXTRACTING │
            │_HIT    │ │           │
            └───┬────┘ └─────┬─────┘
                │            │
                │     ┌──────▼──────┐
                │     │RAG_SEARCHING│
                │     └──────┬──────┘
                │            │
                │     ┌──────▼──────┐
                │     │BUDGETING    │
                │     └──────┬──────┘
                │            │
                │     ┌──────▼──────┐
                │     │ASSEMBLING   │
                │     └──────┬──────┘
                │            │
                │     ┌──────▼──────┐
                │     │CACHING      │
                │     │_WRITE       │
                │     └──────┬──────┘
                │            │
                └────────────┘
                      │
                ┌─────▼─────┐
                │ COMPLETED │
                └───────────┘
```

### 6.2 异常状态处理

```java
public enum ContextBuildStatus {
    RECEIVED,        // 已接收
    VALIDATING,      // 校验中
    CACHE_CHECK,     // 缓存查询中
    CACHE_HIT,       // 缓存命中
    EXTRACTING,      // 上下文提取中
    RAG_SEARCHING,   // RAG检索中
    BUDGETING,       // Token预算分配中
    ASSEMBLING,      // Prompt装配中
    CACHE_WRITING,   // 写缓存中
    COMPLETED,       // 完成
    FAILED,          // 失败
    DEGRADED,        // 降级（RAG失败但仍有基本上下文）
    TIMEOUT          // 超时
}
```

---

## 7. 错误处理与降级策略

### 7.1 错误码定义

| 错误码 | 含义 | 处理策略 |
| --- | --- | --- |
| `CTX_001` | 用户问题为空 | 返回参数错误提示 |
| `CTX_002` | 内容ID无效 | 返回参数错误提示 |
| `CTX_003` | 可见内容超长 | 自动截断至2000字符 |
| `CTX_101` | 缓存服务不可用 | 跳过缓存，直接处理 |
| `CTX_201` | 知识点映射查询超时 | 跳过知识点段，继续处理 |
| `CTX_202` | 知识点映射未找到 | 使用客户端传入的knowledgePointIds兜底 |
| `CTX_301` | RAG检索服务不可用 | 降级为无RAG模式（DEGRADED状态） |
| `CTX_302` | RAG检索超时（>500ms） | 返回已有上下文，不等待RAG结果 |
| `CTX_401` | Token预算不足 | 触发对话历史压缩或裁剪低优先级段 |
| `CTX_501` | Prompt装配失败 | 使用简化模板兜底 |
| `CTX_999` | 未知系统异常 | 返回基础上下文（仅可见内容） |

### 7.2 降级策略代码

```java
@Service
@Slf4j
public class ReadingContextService {

    // ...

    public StructuredReadingContext buildContextSafe(ReadingContextSignal signal) {
        try {
            return buildContext(signal);
        } catch (ContextException e) {
            log.warn("上下文构建异常，执行降级: {}", e.getMessage());
            return degrade(signal, e);
        } catch (Exception e) {
            log.error("上下文构建系统异常", e);
            return minimalContext(signal);
        }
    }

    /**
     * 分级降级策略
     */
    private StructuredReadingContext degrade(ReadingContextSignal signal, ContextException e) {
        StructuredReadingContext.StructuredReadingContextBuilder builder =
            StructuredReadingContext.builder();

        switch (e.getErrorCode()) {
            case "CTX_301": // RAG不可用
            case "CTX_302": // RAG超时
                // 降级：跳过RAG，保留其他上下文段
                builder.sceneMeta(extractSceneMeta(signal));
                builder.contextSegments(extractBasicSegments(signal));
                builder.ragEnhancement(RagEnhancement.disabled());
                builder.promptContextBlock(
                    promptAssemblyService.assembleWithoutRag(signal)
                );
                builder.degraded(true);
                builder.degradeReason("RAG检索降级");
                break;

            case "CTX_201": // 知识图谱查询失败
                // 降级：仅使用客户端传入的知识点ID
                builder.sceneMeta(extractSceneMeta(signal));
                builder.contextSegments(extractSegmentsWithoutKp(signal));
                builder.ragEnhancement(RagEnhancement.disabled());
                builder.promptContextBlock(
                    promptAssemblyService.assembleSimple(signal)
                );
                builder.degraded(true);
                builder.degradeReason("知识图谱查询降级");
                break;

            default:
                return minimalContext(signal);
        }

        return builder.build();
    }

    /**
     * 最小可用上下文（仅可见内容）
     */
    private StructuredReadingContext minimalContext(ReadingContextSignal signal) {
        String minimalBlock = String.format(
            "【学习场景】\n学科：%s | 年级：%s\n\n【当前阅读内容】\n%s",
            signal.getSubject(),
            signal.getGradeLevel(),
            signal.getVisibleContentSnippet().substring(0,
                Math.min(500, signal.getVisibleContentSnippet().length()))
        );

        return StructuredReadingContext.builder()
            .sceneMeta(extractSceneMeta(signal))
            .contextSegments(List.of(
                ContextSegment.builder()
                    .type(SegmentType.VISIBLE_CONTENT)
                    .priority(1)
                    .content(signal.getVisibleContentSnippet())
                    .estimatedTokens(estimateTokens(signal.getVisibleContentSnippet()))
                    .source("fallback_minimal")
                    .build()
            ))
            .ragEnhancement(RagEnhancement.disabled())
            .promptContextBlock(minimalBlock)
            .estimatedTokens(estimateTokens(minimalBlock))
            .degraded(true)
            .degradeReason("最小降级模式")
            .build();
    }
}
```

### 7.3 超时保护

```java
@Retryable(value = TimeoutException.class, maxAttempts = 1)
@Timeout annotation(value = 500, unit = TimeUnit.MILLISECONDS)
public StructuredReadingContext buildContext(ReadingContextSignal signal) {
    // 使用 CompletableFuture 实现分步超时
    CompletableFuture<StructuredReadingContext> pipeline = CompletableFuture
        .supplyAsync(() -> validateAndNormalize(signal))
        .thenApplyAsync(this::checkCache)
        .orTimeout(50, TimeUnit.MILLISECONDS)
        .thenComposeAsync(signal2 -> {
            // 缓存未命中，继续处理
            if (signal2.getCached() != null) {
                return CompletableFuture.completedFuture(signal2.getCached());
            }
            return CompletableFuture
                .supplyAsync(() -> extractionService.extract(signal))
                .thenCombineAsync(
                    CompletableFuture.supplyAsync(() -> ragService.search(signal))
                        .completeOnTimeout(List.of(), 300, TimeUnit.MILLISECONDS)
                        .exceptionally(ex -> {
                            log.warn("RAG检索异常降级", ex);
                            return List.of();
                        }),
                    (segments, ragChunks) -> {
                        segments.addAll(toRagSegments(ragChunks));
                        TokenBudgetPlan budget = tokenBudgetService.allocate(
                            segments, estimateHistory(signal)
                        );
                        return promptAssemblyService.assemble(signal, segments, budget);
                    }
                )
                .orTimeout(450, TimeUnit.MILLISECONDS);
        });

    try {
        return pipeline.get(500, TimeUnit.MILLISECONDS);
    } catch (TimeoutException e) {
        throw new ContextException("CTX_999", "上下文构建超时");
    }
}
```

---

## 8. 性能优化

### 8.1 多级缓存策略

| 缓存层 | TTL | 命中率预期 | 说明 |
| --- | --- | --- | --- |
| L1 本地缓存 (Caffeine) | 5分钟 | ~30% | 热门内容位置缓存 |
| L2 Redis 缓存 | 30分钟 | ~50% | 全局共享缓存 |
| L3 数据库缓存表 | 24小时 | ~70% | 持久化缓存，过期自动清理 |

```java
@Cacheable(cacheNames = "readingContext",
           key = "#cacheKey",
           unless = "#result == null || #result.degraded")
public StructuredReadingContext getCached(String cacheKey) {
    return null; // 缓存未命中时返回null，触发实际计算
}

// 写入缓存（异步）
@CachePut(cacheNames = "readingContext", key = "#cacheKey")
@Async
public void putCache(String cacheKey, StructuredReadingContext context) {
    // 同时写入数据库缓存表
    readingContextCacheRepository.save(
        ReadingContextCacheEntity.builder()
            .cacheKey(cacheKey)
            .structuredContext(objectMapper.writeValueAsString(context))
            .expiresAt(LocalDateTime.now().plusMinutes(30))
            .build()
    );
}
```

### 8.2 预加载策略

客户端在阅读过程中，可以提前请求下一个位置的上下文预构建：

```java
@PostMapping("/pre-build")
public ResponseEntity<Void> preBuild(@RequestBody PreBuildRequest request) {
    // 低优先级异步处理
    request.getRequests().forEach(req -> {
        readingContextQueue.offer(
            ReadingContextPreBuildTask.builder()
                .contentId(req.getContentId())
                .sectionIndex(req.getSectionIndex())
                .scrollBucket(req.getScrollBucket())
                .subject(req.getSubject())
                .gradeLevel(req.getGradeLevel())
                .build(),
            MessagePriority.LOW
        );
    });

    return ResponseEntity.accepted().build();
}
```

### 8.3 Token 估算优化

使用预估公式而非精确 Tokenizer，减少计算开销：

```java
@Component
public class TokenEstimator {

    // 经验系数：中文约 1.5 字符/Token，英文约 4 字符/Token
    private static final double CN_CHARS_PER_TOKEN = 1.5;
    private static final double EN_CHARS_PER_TOKEN = 4.0;

    public int estimate(String text) {
        if (text == null || text.isEmpty()) return 0;

        int cnCount = 0;
        int enCount = 0;
        int otherCount = 0;

        for (char c : text.toCharArray()) {
            if (isChinese(c)) {
                cnCount++;
            } else if (isEnglish(c)) {
                enCount++;
            } else {
                otherCount++;
            }
        }

        return (int) Math.ceil(
            cnCount / CN_CHARS_PER_TOKEN +
            enCount / EN_CHARS_PER_TOKEN +
            otherCount / 2.0  // 其他字符（标点、数字等）平均 2 字符/Token
        );
    }

    // 高频内容可缓存估算结果
    @Cacheable(cacheNames = "tokenEstimate", key = "#text.hashCode()")
    public int estimateCached(String text) {
        return estimate(text);
    }
}
```

---

## 9. 与其他模块的集成

### 9.1 集成关系图

```
┌──────────────────────────────────────────────────────────┐
│                   上游信号来源                            │
│                                                          │
│  客户端阅读器 ──→ ReadingContextSignal                    │
│  AI对话编排服务 ──→ 对话历史Token估算                     │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  上下文注入管线引擎      │
              │  (本服务)               │
              └──────────┬─────────────┘
                          │
           ┌──────────────┼──────────────┐
           ▼              ▼              ▼
    ┌────────────┐ ┌────────────┐ ┌────────────┐
    │ 知识图谱    │ │ RAG检索    │ │ 教材内容    │
    │ 服务       │ │ 服务       │ │ 服务       │
    └────────────┘ └────────────┘ └────────────┘
                          │
                          ▼
              ┌────────────────────────┐
              │  AI对话编排服务          │
              │  (接收promptContextBlock)│
              └──────────┬─────────────┘
                          │
                          ▼
                   ┌──────────────┐
                   │  大模型 API   │
                   └──────────────┘
```

### 9.2 与 AI 对话编排服务的集成

```java
// AI对话编排服务调用本服务的示例
@Service
public class AiConversationOrchestrator {

    private final ReadingContextService readingContextService;

    public AiResponse processMessage(ConversationMessage message) {
        // 1. 判断是否有阅读上下文
        if (message.hasReadingContext()) {
            // 2. 构建阅读上下文
            ReadingContextSignal signal = buildSignalFromMessage(message);
            StructuredReadingContext ctx = readingContextService.buildContextSafe(signal);

            // 3. 拼装最终Prompt（系统提示 + 上下文块 + 对话历史 + 用户问题）
            String fullPrompt = PromptBuilder.create()
                .system(systemPromptForSubject(message.getSubject(), message.getGradeLevel()))
                .context(ctx.getPromptContextBlock())  // 注入阅读上下文
                .history(getHistory(message.getConversationId(), ctx.getTokenBudgetPlan()))
                .user(message.getContent())
                .build();

            // 4. 调用大模型
            return callModel(fullPrompt, message.getStreamMode());
        } else {
            // 无阅读上下文的普通对话
            return processNormalMessage(message);
        }
    }
}
```

### 9.3 与知识图谱服务的集成

```java
@FeignClient(name = "knowledge-graph-service")
public interface KnowledgeGraphClient {

    @GetMapping("/api/v1/kp/{kpId}/prerequisites")
    List<KnowledgePointBrief> getPrerequisites(
        @PathVariable String kpId,
        @RequestParam(defaultValue = "3") int limit
    );

    @GetMapping("/api/v1/kp/{kpId}/related")
    List<KnowledgePointBrief> getRelatedPoints(
        @PathVariable String kpId,
        @RequestParam(defaultValue = "3") int limit
    );
}
```

### 9.4 与 RAG 检索服务的集成

```java
@FeignClient(name = "rag-search-service")
public interface RagSearchClient {

    @PostMapping("/api/v1/search")
    VectorSearchResponse search(@RequestBody VectorSearchRequest request);
}
```

---

## 10. 监控与可观测性

### 10.1 关键指标

| 指标名 | 类型 | 说明 |
| --- | --- | --- |
| `reading_context.build.total` | Counter | 上下文构建总次数 |
| `reading_context.build.duration` | Histogram | 构建耗时分布 |
| `reading_context.cache.hit_rate` | Gauge | 缓存命中率 |
| `reading_context.rag.duration` | Histogram | RAG检索耗时 |
| `reading_context.rag.timeout_count` | Counter | RAG超时次数 |
| `reading_context.degrade.count` | Counter | 降级次数（按原因分类） |
| `reading_context.token.budget_used` | Histogram | Token预算使用率 |
| `reading_context.token.history_compressed` | Counter | 对话历史压缩次数 |
| `reading_context.segments.dropped` | Counter | 因预算不足被丢弃的段数 |

### 10.2 告警规则

```yaml
groups:
  - name: reading_context
    rules:
      - alert: ReadingContextHighLatency
        expr: histogram_quantile(0.95, reading_context_build_duration_seconds_bucket) > 0.3
        for: 5m
        annotations:
          summary: "阅读上下文构建P95延迟 > 300ms"

      - alert: ReadingContextLowCacheHitRate
        expr: reading_context_cache_hit_rate < 0.3
        for: 30m
        annotations:
          summary: "阅读上下文缓存命中率 < 30%"

      - alert: ReadingContextHighDegradeRate
        expr: rate(reading_context_degrade_count_total[5m]) > 0.1
        for: 5m
        annotations:
          summary: "阅读上下文降级率过高"
```

### 10.3 日志埋点示例

```java
@Slf4j
@Aspect
@Component
public class ReadingContextLogAspect {

    @AfterReturning(
        pointcut = "execution(* ReadingContextService.buildContext(..))",
        returning = "result"
    )
    public void logBuildResult(JoinPoint joinPoint, StructuredReadingContext result) {
        ReadingContextSignal signal = (ReadingContextSignal) joinPoint.getArgs()[0];

        MDC.put("userId", signal.getUserId());
        MDC.put("contentId", signal.getContentId());
        MDC.put("subject", signal.getSubject());

        log.info(
            "reading_context_built | segments={} | tokens={} | cacheHit={} | degraded={} | durationMs={}",
            result.getContextSegments().size(),
            result.getEstimatedTokens(),
            result.isCacheHit(),
            result.isDegraded(),
            result.getProcessingTimeMs()
        );

        MDC.clear();
    }
}
```

---

## 11. 安全与合规

### 11.1 数据安全

- **学生内容脱敏**：注入到上下文的文本片段经过敏感词过滤，不包含学生姓名、手机号等隐私信息
- **Token 截断保护**：所有客户端上报的文本片段在服务端再次截断，防止超大 payload 攻击
- **内容安全审核**：用户标注（recentAnnotations）在注入前经过敏感内容过滤

### 11.2 权限控制

```java
@PreAuthorize("hasRole('STUDENT') and @accessChecker.canAccessContent(#signal.contentId)")
public StructuredReadingContext buildContext(ReadingContextSignal signal) {
    // ...
}
```

### 11.3 数据生命周期

| 数据 | 保留期限 | 清理方式 |
| --- | --- | --- |
| 上下文缓存表 | 24小时 | 定时任务清理过期记录 |
| 注入日志表 | 90天 | 按月分区，自动归档 |
| 位置→知识点映射 | 长期 | 内容更新时增量刷新 |

---

## 12. 测试策略

### 12.1 单元测试

```java
@ExtendWith(MockitoExtension.class)
class TokenBudgetServiceTest {

    @InjectMocks
    private TokenBudgetService service;

    @Test
    @DisplayName("对话历史过长时触发压缩")
    void shouldCompressHistoryWhenTooLong() {
        // Given
        List<ContextSegment> segments = createTestSegments(5);
        int historyTokens = 3000; // 接近模型上限
        int modelMax = 4096;

        // When
        TokenBudgetPlan plan = service.allocate(segments, historyTokens);

        // Then
        assertTrue(plan.isHistoryCompressed());
        assertThat(plan.getConversationHistory()).isLessThan(historyTokens);
        assertThat(plan.getReadingContext()).isGreaterThan(0);
    }

    @Test
    @DisplayName("高优先级段应优先获得Token预算")
    void shouldAllocateHigherPriorityFirst() {
        // Given
        List<ContextSegment> segments = Arrays.asList(
            createSegment(SegmentType.RELATED_CONCEPT, 5, 100),
            createSegment(SegmentType.VISIBLE_CONTENT, 1, 100),
            createSegment(SegmentType.PREREQUISITE, 3, 100)
        );
        int historyTokens = 500;

        // When
        TokenBudgetPlan plan = service.allocate(segments, historyTokens);
        List<ContextSegment> trimmed = service.trimSegments(segments, plan);

        // Then
        // VISIBLE_CONTENT (priority 1) 应保留
        assertTrue(trimmed.stream().anyMatch(s -> s.getType() == SegmentType.VISIBLE_CONTENT));
    }
}
```

### 12.2 集成测试

```java
@SpringBootTest
@AutoConfigureMockMvc
class ReadingContextControllerIT {

    @Autowired
    private MockMvc mockMvc;

    @Test
    @DisplayName("构建教材章节阅读上下文")
    void shouldBuildContextForTextbookChapter() throws Exception {
        mockMvc.perform(post("/api/v1/reading-context/build")
                .contentType(MediaType.APPLICATION_JSON)
                .content(loadJson("test-data/textbook-context-request.json")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(0))
            .andExpect(jsonPath("$.data.promptContextBlock").isNotEmpty())
            .andExpect(jsonPath("$.data.estimatedTokens").isNumber())
            .andExpect(jsonPath("$.data.tokenBudgetPlan.totalBudget").value(4096));
    }

    @Test
    @DisplayName("RAG不可用时降级返回")
    void shouldDegradeWhenRagUnavailable() throws Exception {
        // Given: 模拟RAG服务不可用
        mockRagServiceToFail();

        mockMvc.perform(post("/api/v1/reading-context/build")
                .contentType(MediaType.APPLICATION_JSON)
                .content(loadJson("test-data/textbook-context-request.json")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.degraded").value(true));
    }
}
```

### 12.3 性能基准测试

| 场景 | 目标 P50 | 目标 P95 | 目标 P99 |
| --- | --- | --- | --- |
| 缓存命中 | 5ms | 15ms | 30ms |
| 缓存未命中（无RAG） | 50ms | 100ms | 150ms |
| 缓存未命中（有RAG） | 120ms | 200ms | 300ms |
| 降级模式 | 20ms | 50ms | 80ms |

---

## 13. 配置参数

### 13.1 应用配置 `application.yml`

```yaml
primetop:
  reading-context:
    # Token 模型上下文窗口大小
    model-max-context: 4096
    # 系统提示词 Token 预留
    system-prompt-tokens: 800
    # 响应预留比例
    response-reserve-ratio: 0.25
    # RAG 检索配置
    rag:
      enabled: true
      top-k: 5
      min-score: 0.65
      max-tokens: 300
      timeout-ms: 300
    # 缓存配置
    cache:
      l1-ttl-minutes: 5
      l2-ttl-minutes: 30
      l3-ttl-hours: 24
      l1-max-size: 5000
    # 文本限制
    limits:
      max-visible-snippet-chars: 2000
      max-surrounding-paragraphs-chars: 3000
      max-annotations: 3
      max-annotation-length: 200
    # 超时配置
    timeout-ms: 500
```

### 13.2 动态配置（Apollo/Nacos）

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `reading_context.rag.enabled` | true | 是否启用RAG增强 |
| `reading_context.rag.top_k` | 5 | RAG检索返回数量 |
| `reading_context.rag.min_score` | 0.65 | RAG最低相关度阈值 |
| `reading_context.cache.l2_ttl_minutes` | 30 | Redis缓存TTL |
| `reading_context.timeout_ms` | 500 | 总超时时间 |

---

## 14. 版本演进路线

| 版本 | 特性 | 说明 |
| --- | --- | --- |
| v1.0 | 基础管线 | 实现完整的上下文提取→RAG→Token分配→Prompt装配流程 |
| v1.1 | 预加载优化 | 客户端联动预加载下一位置上下文 |
| v1.2 | 效果闭环 | 接入用户反馈数据，基于满意度自动调优权重 |
| v1.3 | 多模态扩展 | 支持图片/公式/图表等非文本上下文提取 |
| v2.0 | 自适应权重 | 基于A/B实验数据自动优化各段类型权重 |
| v2.0 | 流式注入 | 支持在AI流式回答过程中动态补充上下文 |
