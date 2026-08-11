# 客户端-学习内容阅读器内AI即时问答悬浮窗与上下文感知辅导引擎-详细设计

## 1. 概述

### 1.1 功能定位

在学生学习内容阅读器（教材章节、知识点讲解、解析文章等）中，提供**选中文本即可发起AI问答**的悬浮窗交互能力。系统自动携带当前阅读上下文（章节、知识点、学段年级、教材版本、阅读位置等），使AI回答精准贴合学生当前学习场景，避免脱离上下文的泛泛解答。

### 1.2 与现有模块的边界

| 模块 | 职责 | 与本模块关系 |
| --- | --- | --- |
| 全局浮窗AI助手 | App级浮窗，跨页面通用AI对话 | 本模块是阅读器内的**深度集成**，携带阅读上下文 |
| AI对话引擎 | 完整的AI对话会话管理 | 本模块调用AI对话能力，但提供场景化快捷入口 |
| 阅读器批注系统 | 文本高亮、笔记 | 本模块可与批注联动：AI回答后可保存为笔记 |
| 即时查词引擎 | 单词/术语快速解释 | 本模块处理更复杂的问答，不限于词语解释 |
| 即时练习嵌入 | 阅读中插入练习题 | 互补关系：练习检测理解，问答解决疑惑 |

### 1.3 设计目标

1. **零摩擦提问**：选中文本 → 悬浮菜单弹出 → 点击"问AI" → 3秒内首Token响应
2. **上下文感知**：自动携带章节、知识点、年级等12维上下文
3. **渐进式展开**：先给简短回答，用户可展开查看详细解析
4. **学习闭环**：AI回答可直接保存为笔记/加入错题/生成练习题
5. **不打断阅读心流**：悬浮窗设计，回答后可快速关闭继续阅读

### 1.4 适用学段

| 学段 | 交互策略 |
| --- | --- |
| 幼儿 | 语音提问为主，悬浮窗以图文+语音回答 |
| 小学 | 简化菜单，大按钮，回答语言简明 |
| 初中 | 完整功能，支持追问和同类题 |
| 高中 | 支持深度追问、公式推导、考点关联 |

---

## 2. 数据结构定义

### 2.1 阅读上下文模型 (ReadingContext)

```typescript
interface ReadingContext {
  // === 内容标识 ===
  contentId: string;           // 当前阅读内容ID
  contentType: ContentType;    // 内容类型
  chapterId: string;           // 所属章节ID
  knowledgePointIds: string[]; // 关联知识点ID列表

  // === 学习者画像 ===
  userId: string;
  gradeLevel: GradeLevel;      // 年级: 'k3'|'g1'|'g2'|...|'g12'
  stage: SchoolStage;          // 学段: 'kindergarten'|'primary'|'junior'|'senior'
  subject: Subject;            // 学科
  textbookVersionId: string;   // 教材版本ID

  // === 阅读状态 ===
  readingProgress: number;     // 阅读进度 0.0~1.0
  scrollPosition: number;      // 滚动位置（像素）
  sessionDuration: number;     // 本次阅读时长（秒）

  // === 选中文本信息 ===
  selectedText: string;        // 用户选中的文本
  selectionStart: number;      // 选区起始偏移量
  selectionEnd: number;        // 选区结束偏移量
  surroundingText: string;     // 选中文本前后各200字的上下文
  selectionType: SelectionType;// 选区类型

  // === 元数据 ===
  timestamp: number;           // 时间戳
  deviceId: string;            // 设备ID
  appVersion: string;          // App版本
}

enum ContentType {
  TEXTBOOK_CHAPTER = 'textbook_chapter',    // 教材章节
  KNOWLEDGE_POINT = 'knowledge_point',      // 知识点讲解
  QUESTION_ANALYSIS = 'question_analysis',  // 题目解析
  COURSE_NOTE = 'course_note',              // 课程笔记
  ERROR_REVIEW = 'error_review',            // 错题复习
  ARTICLE = 'article',                      // 文章/阅读材料
}

enum SelectionType {
  TEXT = 'text',                  // 普通文本
  FORMULA = 'formula',            // 数学公式
  CHEMICAL_EQUATION = 'chemical', // 化学方程式
  ENGLISH_WORD = 'english_word',  // 英语单词
  CHINESE_IDIOM = 'idiom',        // 中文成语
  CODE_SNIPPET = 'code',          // 代码片段
  UNKNOWN = 'unknown',
}
```

### 2.2 悬浮问答会话模型 (ReaderQASession)

```typescript
interface ReaderQASession {
  sessionId: string;            // 会话ID，唯一标识一次悬浮问答
  readingContext: ReadingContext;// 阅读上下文快照
  
  // === 问答交互 ===
  userQuestion: string;         // 用户提问内容（选中文本+可选补充）
  questionType: ReaderQuestionType; // 问题类型
  aiResponse: ReaderAIResponse;  // AI回答
  
  // === 后续操作 ===
  followUpActions: FollowUpAction[]; // 用户可执行的后续操作
  savedToNotes: boolean;        // 是否已保存为笔记
  convertedToExercise: boolean; // 是否已生成练习题
  
  // === 分析数据 ===
  responseTimeMs: number;       // 首Token响应时间
  userSatisfied: boolean | null;// 用户是否满意（点赞/点踩）
  expandCount: number;          // 展开"详细解析"次数
  
  // === 生命周期 ===
  status: ReaderQASessionStatus;
  createdAt: number;
  closedAt: number | null;
}

enum ReaderQuestionType {
  EXPLAIN = 'explain',            // "讲解一下"
  WHY = 'why',                    // "为什么"
  SIMPLIFY = 'simplify',          // "再简单点"
  EXAMPLE = 'example',            // "举个例子"
  PRACTICE = 'practice',          // "练一道题"
  RELATED = 'related',            // "相关知识"
  CUSTOM = 'custom',              // 自定义问题
}

enum ReaderQASessionStatus {
  INITIATED = 'initiated',       // 已发起
  STREAMING = 'streaming',       // AI回答流式输出中
  COMPLETED = 'completed',       // 回答完成
  FAILED = 'failed',             // 回答失败
  EXPANDED = 'expanded',         // 已展开详细解析
  CLOSED = 'closed',             // 用户已关闭
}

interface ReaderAIResponse {
  briefAnswer: string;           // 简短回答（Markdown，限200字内）
  detailedAnswer: string | null; // 详细解析（Markdown，按需展开）
  knowledgePoints: string[];     // 涉及的知识点名称
  relatedFormulas: string[];     // 相关公式（LaTeX）
  suggestedQuestions: string[];  // 建议的追问问题（最多3个）
  confidenceScore: number;       // AI置信度 0.0~1.0
}

interface FollowUpAction {
  actionType: FollowUpActionType;
  label: string;                 // 按钮文案
  icon: string;                  // 图标标识
  enabled: boolean;
}

enum FollowUpActionType {
  SAVE_NOTE = 'save_note',        // 保存为笔记
  GENERATE_EXERCISE = 'exercise', // 生成练习题
  ASK_FOLLOWUP = 'followup',      // 继续追问
  SIMPLIFY = 'simplify',          // 再讲简单点
  FULL_DIALOGUE = 'full_dialogue',// 进入完整AI对话
  REPORT_ERROR = 'report_error',  // 回答报错
}
```

### 2.3 客户端本地缓存表 (SQLite)

```sql
-- 阅读器AI问答历史本地缓存
CREATE TABLE reader_qa_cache (
  id TEXT PRIMARY KEY,              -- sessionId
  content_id TEXT NOT NULL,         -- 阅读内容ID
  chapter_id TEXT,                  -- 章节ID
  selected_text TEXT NOT NULL,      -- 选中文本
  user_question TEXT NOT NULL,      -- 用户问题
  ai_brief_answer TEXT NOT NULL,    -- AI简短回答
  ai_detailed_answer TEXT,          -- AI详细回答
  knowledge_points TEXT,            -- 知识点JSON数组
  created_at INTEGER NOT NULL,      -- 创建时间戳
  synced INTEGER DEFAULT 0,         -- 是否已同步到服务端
  satisfied INTEGER                 -- 满意度: null/0/1
);

-- 按内容ID+章节查询索引
CREATE INDEX idx_reader_qa_content ON reader_qa_cache(content_id, chapter_id);
CREATE INDEX idx_reader_qa_sync ON reader_qa_cache(synced);
```

---

## 3. API 接口设计

### 3.1 发起阅读器内AI问答

**POST** `/api/v1/reader/qa/ask`

**请求体：**
```json
{
  "contentId": "ch_7_3_math_senior_001",
  "contentType": "textbook_chapter",
  "chapterId": "ch_007_003",
  "knowledgePointIds": ["kp_trig_law_of_cosines", "kp_trig_application"],
  "selectedText": "余弦定理 c²=a²+b²-2ab·cosC",
  "surroundingText": "在三角形ABC中，已知两边及其夹角，求第三边。根据余弦定理 c²=a²+b²-2ab·cosC，代入数值...",
  "selectionType": "formula",
  "questionType": "explain",
  "customQuestion": "",
  "readingProgress": 0.35,
  "sessionDuration": 420
}
```

**响应（SSE流式）：**
```
event: meta
data: {"sessionId":"rqa_20260812_001","confidenceScore":0.92,"knowledgePoints":["余弦定理","解三角形"]}

event: brief
data: {"content":"余弦定理是三角形中**边与角**关系的定理。它描述了任意三角形中，三条边与其中一个角之间的关系。\n\n**公式**：$c^2 = a^2 + b^2 - 2ab\\cos C$\n\n当已知两边和夹角时，可以求出第三边。"}

event: suggestions
data: {"questions":["正弦定理和余弦定理有什么区别？","什么时候用余弦定理更方便？","能给一道例题吗？"]}

event: actions
data: {"actions":["save_note","exercise","followup","simplify","full_dialogue"]}

event: detailed
data: {"content":"**详细推导**：\n\n1. 建立坐标系：以C为原点...\n2. 利用距离公式...\n3. 化简得到 $c^2 = a^2 + b^2 - 2ab\\cos C$\n\n**特殊情况**：\n- 当C=90°时，cosC=0，退化为勾股定理\n- 当C=0°时，三点共线\n\n**适用场景**：\n- SSS（已知三边求角）\n- SAS（已知两边及夹角）"}

event: done
data: {"sessionId":"rqa_20260812_001","responseTimeMs":1280}
```

### 3.2 用户反馈接口

**POST** `/api/v1/reader/qa/{sessionId}/feedback`

```json
{
  "satisfied": true,
  "expandCount": 2,
  "followUpAction": "save_note",
  "feedbackText": ""
}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "sessionId": "rqa_20260812_001",
    "processed": true
  }
}
```

### 3.3 获取阅读内容的AI问答历史

**GET** `/api/v1/reader/qa/history?contentId={contentId}&page=1&pageSize=20`

**响应：**
```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "sessionId": "rqa_20260812_001",
        "selectedText": "余弦定理 c²=a²+b²-2ab·cosC",
        "questionType": "explain",
        "briefAnswer": "余弦定理是三角形中...",
        "knowledgePoints": ["余弦定理", "解三角形"],
        "createdAt": 1723420800000,
        "satisfied": true
      }
    ],
    "total": 1,
    "page": 1
  }
}
```

### 3.4 批量同步本地缓存问答

**POST** `/api/v1/reader/qa/sync`

```json
{
  "sessions": [
    {
      "clientSessionId": "local_rqa_001",
      "contentId": "ch_7_3_math_senior_001",
      "selectedText": "...",
      "userQuestion": "...",
      "aiBriefAnswer": "...",
      "createdAt": 1723420800000,
      "satisfied": 1
    }
  ]
}
```

### 3.5 错误码定义

| 错误码 | HTTP状态 | 说明 | 客户端处理 |
| --- | --- | --- | --- |
| 40001 | 400 | 选中文本为空 | 提示用户重新选择 |
| 40002 | 400 | 问题类型不合法 | 使用默认类型 EXPLAIN |
| 42901 | 429 | AI调用频率超限 | 显示"休息一下，稍后再试" |
| 42902 | 429 | 每日AI问答次数用尽 | 引导开通会员 |
| 50301 | 503 | AI服务暂时不可用 | 自动降级到备用模型或提示稍后重试 |
| 50302 | 503 | 上下文构建失败 | 退化为通用AI对话（不带上下文） |
| 40003 | 400 | 内容安全拦截 | 显示"这个问题暂时无法回答，换个方式试试" |

---

## 4. 核心流程设计

### 4.1 用户交互全流程

```
用户在阅读器中阅读
        │
        ▼
┌──────────────────────┐
│  长按选中文本        │
│  (触发文本选择模式)   │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  系统识别选区类型    │
│  (公式/单词/普通文本) │
└──────────┬───────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌─────────┐ ┌──────────────┐
│ 单词/术语│ │ 普通文本/公式 │
└────┬────┘ └──────┬───────┘
     │              │
     ▼              ▼
┌─────────────┐ ┌──────────────────────────┐
│ 显示查词浮窗 │ │ 显示操作菜单:             │
│ (已有模块)   │ │ [问AI] [高亮] [笔记] [复制]│
└─────────────┘ └────────────┬─────────────┘
                              │ 用户点击"问AI"
                              ▼
               ┌──────────────────────────┐
               │ 构建ReadingContext       │
               │ (收集12维上下文)          │
               └────────────┬─────────────┘
                            │
                            ▼
               ┌──────────────────────────┐
               │ 显示预设问题快捷按钮     │
               │ [讲解一下] [为什么?]     │
               │ [举个例子] [练一道题]    │
               │ [自定义输入框]           │
               └────────────┬─────────────┘
                            │
                     ┌──────┴──────┐
                     │             │
              快捷问题 ▼    自定义问题▼
                     │             │
                     └──────┬──────┘
                            │
                            ▼
               ┌──────────────────────────┐
               │ POST /reader/qa/ask     │
               │ (SSE流式)                │
               └────────────┬─────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌──────────┐ ┌──────────┐ ┌───────────┐
        │ meta事件 │ │brief事件│ │suggestion │
        │ 知识点   │ │ 简短回答 │ │ 追问建议  │
        │ 置信度   │ │ 流式渲染 │ │ 操作按钮  │
        └──────────┘ └──────────┘ └───────────┘
                            │
                            ▼
               ┌──────────────────────────┐
               │ 用户阅读简短回答         │
               │ 可选: [展开详细解析]     │
               │ 可选: [追问] [保存笔记]  │
               │ 可选: [生成练习] [关闭]  │
               └────────────┬─────────────┘
                            │
                    ┌───────┴───────┐
                    │               │
              继续操作▼         关闭悬浮窗▼
                    │               │
                    ▼               ▼
           ┌──────────────┐ ┌──────────────┐
           │ 执行后续操作  │ │ 上报反馈     │
           │ (追问/练习等)│ │ 关闭会话     │
           └──────────────┘ │ 恢复阅读     │
                            └──────────────┘
```

### 4.2 选区类型智能识别

```dart
/// 选区类型识别器
class SelectionTypeDetector {
  /// 根据选中文本和上下文判断选区类型
  static SelectionType detect(String selectedText, String surroundingText) {
    // 1. 匹配LaTeX/数学公式标记
    if (_isFormula(selectedText)) return SelectionType.FORMULA;
    
    // 2. 匹配化学方程式
    if (_isChemicalEquation(selectedText)) return SelectionType.CHEMICAL_EQUATION;
    
    // 3. 匹配单个英文单词
    if (_isEnglishWord(selectedText)) return SelectionType.ENGLISH_WORD;
    
    // 4. 匹配中文成语（4字成语库）
    if (_isChineseIdiom(selectedText)) return SelectionType.CHINESE_IDIOM;
    
    // 5. 匹配代码片段
    if (_isCodeSnippet(selectedText, surroundingText)) return SelectionType.CODE_SNIPPET;
    
    return SelectionType.TEXT;
  }
  
  static bool _isFormula(String text) {
    // 匹配 $...$, $$...$$, 包含 ^、_、\frac 等LaTeX标记
    final formulaPattern = RegExp(
      r'^\$.*\$$|\\\w+|[\^_]{1}|[\d]+\s*[±×÷=]\s*[\d]+'
    );
    return formulaPattern.hasMatch(text.trim());
  }
  
  static bool _isChemicalEquation(String text) {
    // 匹配化学方程式特征：元素符号+数字、→、催化剂等
    final chemPattern = RegExp(
      r'[A-Z][a-z]?\d*|→|催化剂|反应|沉淀|气体'
    );
    return chemPattern.hasMatch(text) && text.length < 100;
  }
  
  static bool _isEnglishWord(String text) {
    final wordPattern = RegExp(r'^[a-zA-Z]{1,30}$');
    return wordPattern.hasMatch(text.trim());
  }
  
  static bool _isChineseIdiom(String text) {
    return text.trim().length == 4 && _containsOnlyChinese(text);
  }
  
  static bool _containsOnlyChinese(String text) {
    return RegExp(r'^[\u4e00-\u9fa5]+$').hasMatch(text);
  }
  
  static bool _isCodeSnippet(String text, String context) {
    // 检测代码特征：缩进、括号、分号、关键字
    final codePattern = RegExp(
      r'(print|def|class|function|var|let|const|if|for|while|return|\{\s*$|;\s*$)'
    );
    return codePattern.hasMatch(text) || codePattern.hasMatch(context);
  }
}
```

### 4.3 上下文构建器

```dart
/// 阅读上下文构建器
class ReadingContextBuilder {
  final UserRepository _userRepo;
  final ContentRepository _contentRepo;
  final ReadingSessionManager _sessionManager;
  
  /// 从当前阅读状态和选区信息构建完整上下文
  Future<ReadingContext> build({
    required String contentId,
    required String selectedText,
    required int selectionStart,
    required int selectionEnd,
    required String surroundingText,
  }) async {
    // 并行获取用户画像和内容信息
    final results = await Future.wait([
      _userRepo.getCurrentUser(),
      _contentRepo.getContentMeta(contentId),
      _sessionManager.getCurrentSession(),
    ]);
    
    final user = results[0] as UserModel;
    final contentMeta = results[1] as ContentMeta;
    final session = results[2] as ReadingSession;
    
    // 检测选区类型
    final selectionType = SelectionTypeDetector.detect(
      selectedText, 
      surroundingText,
    );
    
    return ReadingContext(
      contentId: contentId,
      contentType: contentMeta.type,
      chapterId: contentMeta.chapterId,
      knowledgePointIds: contentMeta.knowledgePointIds,
      userId: user.id,
      gradeLevel: user.gradeLevel,
      stage: user.stage,
      subject: contentMeta.subject,
      textbookVersionId: user.textbookVersionId,
      readingProgress: session.progress,
      scrollPosition: session.scrollPosition,
      sessionDuration: session.duration.inSeconds,
      selectedText: selectedText,
      selectionStart: selectionStart,
      selectionEnd: selectionEnd,
      surroundingText: surroundingText,
      selectionType: selectionType,
      timestamp: DateTime.now().millisecondsSinceEpoch,
      deviceId: await _getDeviceId(),
      appVersion: await _getAppVersion(),
    );
  }
}
```

### 4.4 服务端上下文增强Prompt构建

```python
class ReaderContextualPromptBuilder:
    """
    根据阅读上下文构建场景化AI Prompt
    """
    
    def build_prompt(self, ctx: ReadingContext, question_type: str, 
                     custom_question: str = "") -> str:
        # 基础角色设定
        role_prompt = self._build_role(ctx.stage, ctx.subject)
        
        # 场景约束
        scene_prompt = self._build_scene(ctx.contentType, question_type)
        
        # 上下文注入
        context_prompt = self._build_context(ctx)
        
        # 回答格式要求
        format_prompt = self._build_format(question_type, ctx.stage)
        
        # 用户问题
        user_question = self._build_question(
            ctx.selectedText, question_type, custom_question, ctx.surroundingText
        )
        
        return f"{role_prompt}\n\n{scene_prompt}\n\n{context_prompt}\n\n{format_prompt}\n\n{user_question}"
    
    def _build_role(self, stage: str, subject: str) -> str:
        stage_map = {
            "primary": "你是一位耐心亲切的小学{subject}老师，善于用简单的生活例子讲解",
            "junior": "你是一位经验丰富的初中{subject}老师，注重知识体系的建立",
            "senior": "你是一位专业的高中{subject}老师，注重考点的准确性和方法的总结",
        }
        return stage_map.get(stage, "你是一位专业的{subject}辅导老师").format(subject=subject)
    
    def _build_scene(self, content_type: str, question_type: str) -> str:
        scene_templates = {
            ("textbook_chapter", "explain"): "学生正在阅读教材内容，对其中一段文字不太理解。请针对选中的内容进行讲解。",
            ("textbook_chapter", "why"): "学生在阅读教材时遇到了不理解的原因。请解释为什么是这样。",
            ("knowledge_point", "simplify"): "学生在学习知识点时觉得当前讲解偏难。请用更简单的方式重新解释。",
            ("question_analysis", "example"): "学生在看题目解析时想要更多例子。请给出1-2个类似例子。",
            ("error_review", "practice"): "学生在复习错题时想要练习相关题目。请出一道同类练习题。",
        }
        return scene_templates.get(
            (content_type, question_type),
            "学生在阅读学习内容时提出了问题。"
        )
    
    def _build_context(self, ctx: ReadingContext) -> str:
        return f"""【学习上下文】
- 学段年级：{ctx.stage_label} {ctx.grade_label}
- 学科：{ctx.subject}
- 教材版本：{ctx.textbook_version_name}
- 当前章节：{ctx.chapter_title}
- 关联知识点：{', '.join(ctx.knowledge_point_names)}
- 阅读进度：{ctx.reading_progress_percent}%
- 选中文本："{ctx.selected_text}"
- 文本上下文：...{ctx.surrounding_text}..."""
    
    def _build_format(self, question_type: str, stage: str) -> str:
        max_brief = 150 if stage == "primary" else 200 if stage == "junior" else 250
        return f"""【回答要求】
1. 先给出简短回答（{max_brief}字以内），直接回应学生的问题
2. 语言要符合{stage}学生的理解水平
3. 如果涉及公式，使用LaTeX格式
4. 如果选中内容是公式或定理，先解释含义再说明用途
5. 提供2-3个追问建议
6. 回答格式使用Markdown"""
    
    def _build_question(self, selected_text: str, question_type: str,
                        custom_question: str, surrounding: str) -> str:
        if question_type == "custom" and custom_question:
            return f'学生提问："{custom_question}"\n（针对选中的内容："{selected_text}"）'
        
        question_templates = {
            "explain": f'请讲解一下这段内容："{selected_text}"',
            "why": f'请解释为什么："{selected_text}" 是这样的',
            "simplify": f'请用更简单的方式解释："{selected_text}"',
            "example": f'请针对"{selected_text}"举一个具体的例子',
            "practice": f'请根据"{selected_text}"出一道同类练习题',
            "related": f'请介绍与"{selected_text}"相关的其他知识点',
        }
        return question_templates.get(question_type, f'请讲解："{selected_text}"')
```

---

## 5. 客户端架构设计

### 5.1 组件树结构

```
ReaderScreen (阅读器主页面)
├── ReaderAppBar (顶部导航栏)
├── ReaderContentArea (内容展示区)
│   ├── ContentRenderer (富文本渲染器)
│   └── TextSelectionHandler (文本选择处理器)
│       └── SelectionToolbar (选择工具栏)
│           ├── HighlightButton (高亮)
│           ├── NoteButton (笔记)
│           ├── CopyButton (复制)
│           └── AskAIButton (问AI) ← 本模块入口
│
├── ReaderQAOverlay (AI问答悬浮层) ← 核心组件
│   ├── QAPanel (问答面板)
│   │   ├── QAHeader (头部：选中文本预览 + 关闭)
│   │   ├── QuickQuestionBar (快捷问题栏)
│   │   │   ├── ExplainButton ("讲解一下")
│   │   │   ├── WhyButton ("为什么")
│   │   │   ├── ExampleButton ("举个例子")
│   │   │   └── PracticeButton ("练一道题")
│   │   ├── CustomQuestionInput (自定义输入框，可折叠)
│   │   ├── AnswerDisplay (回答展示区)
│   │   │   ├── BriefAnswerView (简短回答，Markdown渲染)
│   │   │   ├── DetailedAnswerView (详细解析，可展开)
│   │   │   └── StreamingIndicator (流式输出指示器)
│   │   ├── SuggestionChips (追问建议标签)
│   │   └── ActionBar (操作栏)
│   │       ├── SaveNoteButton (保存笔记)
│   │       ├── ExerciseButton (生成练习)
│   │       ├── FullDialogueButton (完整对话)
│   │       ├── SimplifyButton ("再简单点")
│   │       ├── LikeButton (有用)
│   │       └── DislikeButton (无用)
│   └── QABackdrop (半透明背景，点击关闭)
│
└── ReaderBottomBar (底部工具栏)
```

### 5.2 状态管理 (RiverRiverpod StateNotifier)

```dart
/// 阅读器AI问答状态
class ReaderQAState {
  final ReaderQAMode mode;              // 当前模式
  final ReadingContext? context;        // 当前上下文
  final ReaderQASessionStatus status;   // 会话状态
  final String briefAnswer;             // 简短回答（流式累积）
  final String? detailedAnswer;         // 详细回答
  final List<String> suggestions;       // 追问建议
  final List<FollowUpAction> actions;   // 可用操作
  final List<String> knowledgePoints;   // 涉及知识点
  final String? errorMessage;           // 错误信息
  final int? activeSessionId;           // 当前会话ID
  
  // ... copyWith方法
}

enum ReaderQAMode {
  hidden,           // 隐藏
  selectionMenu,    // 显示选择菜单
  quickQuestion,    // 显示快捷问题
  streaming,        // AI回答中
  completed,        // 回答完成
  expanded,         // 已展开详细解析
  error,            // 错误状态
}

class ReaderQANotifier extends StateNotifier<ReaderQAState> {
  final ReadingContextBuilder _contextBuilder;
  final ReaderQARepository _repository;
  final NotesRepository _notesRepo;
  
  /// 选中文本后显示菜单
  void onTextSelected(TextSelection selection, String surroundingText) {
    final type = SelectionTypeDetector.detect(selection.text, surroundingText);
    
    // 单词/术语 → 走查词引擎
    if (type == SelectionType.ENGLISH_WORD || 
        type == SelectionType.CHINESE_IDIOM) {
      _showWordLookup(selection.text);
      return;
    }
    
    // 其他类型 → 显示"问AI"按钮
    state = state.copyWith(
      mode: ReaderQAMode.selectionMenu,
      context: null, // 延迟构建
    );
  }
  
  /// 用户点击"问AI"
  Future<void> onAskAITapped(ReadingContext context) async {
    state = state.copyWith(
      mode: ReaderQAMode.quickQuestion,
      context: context,
    );
  }
  
  /// 发起问答请求
  Future<void> askQuestion(ReaderQuestionType type, {String? custom}) async {
    if (state.context == null) return;
    
    state = state.copyWith(
      mode: ReaderQAMode.streaming,
      status: ReaderQASessionStatus.STREAMING,
      briefAnswer: '',
      errorMessage: null,
    );
    
    try {
      await _repository.askReaderQuestion(
        context: state.context!,
        questionType: type,
        customQuestion: custom,
        onMeta: (meta) {
          state = state.copyWith(
            knowledgePoints: meta.knowledgePoints,
            activeSessionId: meta.sessionId,
          );
        },
        onBriefChunk: (chunk) {
          // 流式累积简短回答
          state = state.copyWith(
            briefAnswer: state.briefAnswer + chunk,
          );
        },
        onSuggestions: (suggestions) {
          state = state.copyWith(suggestions: suggestions);
        },
        onActions: (actions) {
          state = state.copyWith(actions: actions);
        },
        onDetailed: (detailed) {
          state = state.copyWith(detailedAnswer: detailed);
        },
        onDone: (sessionId, responseTimeMs) {
          state = state.copyWith(
            mode: ReaderQAMode.completed,
            status: ReaderQASessionStatus.COMPLETED,
          );
          _cacheSessionLocally(sessionId);
        },
        onError: (error) {
          state = state.copyWith(
            mode: ReaderQAMode.error,
            status: ReaderQASessionStatus.FAILED,
            errorMessage: error.message,
          );
          // 降级策略
          _handleError(error);
        },
      );
    } catch (e) {
      state = state.copyWith(
        mode: ReaderQAMode.error,
        errorMessage: '网络异常，请稍后重试',
      );
    }
  }
  
  /// 展开/收起详细解析
  void toggleDetailed() {
    final isExpanded = state.mode == ReaderQAMode.expanded;
    state = state.copyWith(
      mode: isExpanded ? ReaderQAMode.completed : ReaderQAMode.expanded,
    );
  }
  
  /// 关闭悬浮窗
  void close() {
    // 上报反馈
    if (state.activeSessionId != null) {
      _repository.reportFeedback(
        sessionId: state.activeSessionId!,
        expandCount: state.mode == ReaderQAMode.expanded ? 1 : 0,
      );
    }
    state = ReaderQAState.initial();
  }
  
  /// 保存为笔记
  Future<void> saveAsNote() async {
    if (state.context == null) return;
    await _notesRepo.createNote(
      contentId: state.context!.contentId,
      selectedText: state.context!.selectedText,
      aiAnswer: state.briefAnswer,
      knowledgePoints: state.knowledgePoints,
    );
    // 更新操作状态
    state = state.copyWith(
      actions: state.actions.map((a) =>
        a.actionType == FollowUpActionType.SAVE_NOTE 
          ? a.copyWith(enabled: false) : a
      ).toList(),
    );
  }
  
  /// 降级错误处理
  void _handleError(ReaderQAError error) {
    switch (error.code) {
      case 42901: // 频率限制
        // 提示稍后重试，不降级
        break;
      case 42902: // 次数用尽
        // 引导开通会员
        _showMemberPrompt();
        break;
      case 50301: // AI不可用
        // 降级：从FAQ知识库搜索
        _fallbackToKnowledgeBase();
        break;
      case 50302: // 上下文构建失败
        // 降级：退化为通用AI对话（不携带阅读上下文）
        _fallbackToGenericDialogue();
        break;
    }
  }
}
```

### 5.3 SSE流式响应处理

```dart
class ReaderQARepository {
  final ApiClient _apiClient;
  final LocalCache _cache;
  
  /// 发起阅读器AI问答（SSE流式）
  Future<void> askReaderQuestion({
    required ReadingContext context,
    required ReaderQuestionType questionType,
    String? customQuestion,
    required void Function(QAMeta) onMeta,
    required void Function(String) onBriefChunk,
    required void Function(List<String>) onSuggestions,
    required void Function(List<FollowUpAction>) onActions,
    required void Function(String) onDetailed,
    required void Function(String, int) onDone,
    required void Function(ReaderQAError) onError,
  }) async {
    final request = ReaderQARequest(
      contentId: context.contentId,
      contentType: context.contentType,
      chapterId: context.chapterId,
      knowledgePointIds: context.knowledgePointIds,
      selectedText: context.selectedText,
      surroundingText: context.surroundingText,
      selectionType: context.selectionType,
      questionType: questionType,
      customQuestion: customQuestion ?? '',
      readingProgress: context.readingProgress,
      sessionDuration: context.sessionDuration,
    );
    
    try {
      await _apiClient.postSSE(
        '/api/v1/reader/qa/ask',
        body: request.toJson(),
        onEvent: (eventType, data) {
          switch (eventType) {
            case 'meta':
              onMeta(QAMeta.fromJson(jsonDecode(data)));
              break;
            case 'brief':
              final parsed = jsonDecode(data);
              onBriefChunk(parsed['content'] as String);
              break;
            case 'suggestions':
              final parsed = jsonDecode(data);
              onSuggestions((parsed['questions'] as List).cast<String>());
              break;
            case 'actions':
              final parsed = jsonDecode(data);
              final actions = (parsed['actions'] as List)
                  .map((e) => FollowUpAction(
                    actionType: FollowUpActionType.values.firstWhere(
                      (t) => t.value == e,
                      orElse: () => FollowUpActionType.FOLLOW_UP,
                    ),
                    label: _actionLabel(e),
                    icon: _actionIcon(e),
                    enabled: true,
                  ))
                  .toList();
              onActions(actions);
              break;
            case 'detailed':
              final parsed = jsonDecode(data);
              onDetailed(parsed['content'] as String);
              break;
            case 'done':
              final parsed = jsonDecode(data);
              onDone(parsed['sessionId'] as String, parsed['responseTimeMs'] as int);
              break;
            case 'error':
              final parsed = jsonDecode(data);
              onError(ReaderQAError(
                code: parsed['code'] as int,
                message: parsed['message'] as String,
              ));
              break;
          }
        },
      );
    } on DioException catch (e) {
      onError(ReaderQAError(
        code: e.response?.statusCode ?? 0,
        message: _networkErrorMessage(e),
      ));
    }
  }
}
```

### 5.4 悬浮窗UI核心实现

```dart
class ReaderQAOverlay extends ConsumerStatefulWidget {
  final Widget child; // 下层阅读器内容
  
  @override
  ConsumerState<ReaderQAOverlay> createState() => _ReaderQAOverlayState();
}

class _ReaderQAOverlayState extends ConsumerState<ReaderQAOverlay>
    with SingleTickerProviderStateMixin {
  late AnimationController _animController;
  late Animation<double> _scaleAnim;
  late Animation<Offset> _slideAnim;
  
  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      duration: const Duration(milliseconds: 250),
      vsync: this,
    );
    _scaleAnim = CurvedAnimation(
      parent: _animController,
      curve: Curves.easeOutBack,
    );
    _slideAnim = Tween<Offset>(
      begin: const Offset(0, 0.1),
      end: Offset.zero,
    ).animate(CurvedAnimation(
      parent: _animController,
      curve: Curves.easeOut,
    ));
  }
  
  @override
  Widget build(BuildContext context) {
    final qaState = ref.watch(readerQAProvider);
    
    return Stack(
      children: [
        // 下层：阅读器内容
        widget.child,
        
        // 上层：AI问答悬浮窗
        if (qaState.mode != ReaderQAMode.hidden) ...[
          // 半透明背景
          if (qaState.mode == ReaderQAMode.streaming ||
              qaState.mode == ReaderQAMode.completed ||
              qaState.mode == ReaderQAMode.expanded)
            GestureDetector(
              onTap: () => ref.read(readerQAProvider.notifier).close(),
              child: Container(color: Colors.black.withOpacity(0.15)),
            ),
          
          // 悬浮面板
          Positioned(
            left: 12,
            right: 12,
            bottom: _calculateBottom(qaState),
            child: SlideTransition(
              position: _slideAnim,
              child: ScaleTransition(
                scale: _scaleAnim,
                alignment: Alignment.bottomCenter,
                child: _buildPanel(qaState),
              ),
            ),
          ),
        ],
      ],
    );
  }
  
  Widget _buildPanel(ReaderQAState state) {
    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.55,
        minHeight: 120,
      ),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: const BorderRadius.vertical(
          top: Radius.circular(20),
          bottom: Radius.circular(16),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.12),
            blurRadius: 20,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // 拖拽指示器
          _buildDragHandle(),
          
          // 根据模式渲染不同内容
          Flexible(
            child: switch (state.mode) {
              ReaderQAMode.selectionMenu => _buildSelectionMenu(state),
              ReaderQAMode.quickQuestion => _buildQuickQuestionBar(state),
              ReaderQAMode.streaming => _buildStreamingView(state),
              ReaderQAMode.completed => _buildCompletedView(state),
              ReaderQAMode.expanded => _buildExpandedView(state),
              ReaderQAMode.error => _buildErrorView(state),
              _ => const SizedBox.shrink(),
            },
          ),
        ],
      ),
    );
  }
  
  /// 快捷问题栏
  Widget _buildQuickQuestionBar(ReaderQAState state) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // 选中文本预览
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  '"${state.context?.selectedText}"',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 13,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                    fontStyle: FontStyle.italic,
                  ),
                ),
              ),
            ],
          ),
        ),
        const Divider(height: 1),
        // 快捷按钮
        Padding(
          padding: const EdgeInsets.all(12),
          child: Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _quickChip('讲解一下', Icons.lightbulb_outline, () {
                ref.read(readerQAProvider.notifier)
                  .askQuestion(ReaderQuestionType.EXPLAIN);
              }),
              _quickChip('为什么？', Icons.help_outline, () {
                ref.read(readerQAProvider.notifier)
                  .askQuestion(ReaderQuestionType.WHY);
              }),
              _quickChip('举个例子', Icons.school_outlined, () {
                ref.read(readerQAProvider.notifier)
                  .askQuestion(ReaderQuestionType.EXAMPLE);
              }),
              _quickChip('练一道题', Icons.assignment_outlined, () {
                ref.read(readerQAProvider.notifier)
                  .askQuestion(ReaderQuestionType.PRACTICE);
              }),
            ],
          ),
        ),
        // 自定义输入
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          child: TextField(
            decoration: InputDecoration(
              hintText: '或者输入你的问题...',
              suffixIcon: IconButton(
                icon: const Icon(Icons.send),
                onPressed: () { /* 发送自定义问题 */ },
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              contentPadding: const EdgeInsets.symmetric(horizontal: 12),
              isDense: true,
            ),
            onSubmitted: (text) {
              if (text.isNotEmpty) {
                ref.read(readerQAProvider.notifier)
                  .askQuestion(ReaderQuestionType.CUSTOM, custom: text);
              }
            },
          ),
        ),
      ],
    );
  }
  
  /// 流式回答渲染
  Widget _buildStreamingView(ReaderQAState state) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // 头部
        _buildHeader(state),
        const Divider(height: 1),
        // 回答内容
        Flexible(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Markdown流式渲染
                MarkdownBody(
                  data: state.briefAnswer,
                  selectable: false,
                  extensionSet: md.ExtensionSet(
                    md.ExtensionSet.gitHubFlavored.blockSyntaxes,
                    [md.ExtensionSet.gitHubFlavored.inlineSyntaxes,
                     LatexInlineSyntax(), LatexBlockSyntax()].expand((e) => e).toList(),
                  ),
                  builders: {
                    'latex': LatexElementBuilder(),
                  },
                ),
                if (state.mode == ReaderQAMode.streaming)
                  const Padding(
                    padding: EdgeInsets.only(top: 8),
                    child: LoadingDots(),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
```

---

## 6. 服务端处理流程

### 6.1 请求处理管线

```python
class ReaderQARequestPipeline:
    """
    阅读器AI问答请求处理管线
    """
    
    async def process(self, request: ReaderQARequest) -> AsyncGenerator[SSEEvent, None]:
        # 1. 参数校验
        validated = self._validate(request)
        
        # 2. 构建完整上下文（补充服务端信息）
        context = await self._enrich_context(validated)
        
        # 3. 内容安全检查（选中文本）
        safety_result = await self._check_content_safety(context.selected_text)
        if not safety_result.passed:
            yield SSEEvent("error", {"code": 40003, "message": "内容安全拦截"})
            return
        
        # 4. 频率限制检查
        rate_limit = await self._check_rate_limit(context.user_id)
        if rate_limit.exceeded:
            yield SSEEvent("error", {"code": 42901, "message": "提问频率过高"})
            return
        
        # 5. 每日额度检查
        quota = await self._check_daily_quota(context.user_id)
        if quota.exhausted:
            yield SSEEvent("error", {"code": 42902, "message": "今日AI问答次数已用完"})
            return
        
        # 6. RAG知识检索（可选增强）
        rag_context = await self._retrieve_knowledge(context)
        
        # 7. 构建Prompt
        prompt = self._prompt_builder.build_prompt(
            context, request.question_type, request.custom_question
        )
        if rag_context:
            prompt = self._inject_rag_context(prompt, rag_context)
        
        # 8. 生成会话ID
        session_id = self._generate_session_id()
        
        # 9. 发送元数据事件
        yield SSEEvent("meta", {
            "sessionId": session_id,
            "confidenceScore": None,  # 等回答完成后回填
            "knowledgePoints": context.knowledge_point_names,
        })
        
        # 10. 调用大模型（流式）
        brief_answer = ""
        start_time = time.monotonic()
        
        try:
            async for chunk in self._call_llm_stream(prompt, context):
                brief_answer += chunk
                yield SSEEvent("brief", {"content": chunk})
            
            response_time_ms = int((time.monotonic() - start_time) * 1000)
            
        except LLMUnavailableError:
            # 降级：尝试备用模型
            try:
                async for chunk in self._call_llm_stream(
                    prompt, context, model_tier="fallback"
                ):
                    brief_answer += chunk
                    yield SSEEvent("brief", {"content": chunk})
                response_time_ms = int((time.monotonic() - start_time) * 1000)
            except Exception:
                yield SSEEvent("error", {"code": 50301, "message": "AI服务暂时不可用"})
                return
        
        # 11. 后处理：生成追问建议
        suggestions = await self._generate_suggestions(context, brief_answer)
        yield SSEEvent("suggestions", {"questions": suggestions})
        
        # 12. 后处理：生成详细解析（异步，不阻塞主流程）
        detailed = await self._generate_detailed(context, brief_answer, prompt)
        if detailed:
            yield SSEEvent("detailed", {"content": detailed})
        
        # 13. 后处理：计算置信度
        confidence = self._calculate_confidence(brief_answer, rag_context, context)
        
        # 14. 可用操作列表
        actions = self._determine_actions(context, request.question_type)
        yield SSEEvent("actions", {"actions": actions})
        
        # 15. 持久化会话记录
        await self._persist_session(
            session_id, context, request, brief_answer, detailed,
            suggestions, confidence, response_time_ms
        )
        
        # 16. 完成事件
        yield SSEEvent("done", {
            "sessionId": session_id,
            "responseTimeMs": response_time_ms,
        })
        
        # 17. 异步上报学习行为
        asyncio.create_task(
            self._record_learning_behavior(session_id, context, request)
        )
    
    async def _call_llm_stream(self, prompt: str, context: ReadingContext,
                                model_tier: str = "primary"):
        """调用大模型，流式返回"""
        model = self._select_model(context, model_tier)
        
        messages = [
            {"role": "system", "content": prompt["system"]},
            {"role": "user", "content": prompt["user"]},
        ]
        
        async for chunk in self.llm_gateway.chat_stream(
            model=model,
            messages=messages,
            temperature=0.3,  # 教育场景低温度，保证准确性
            max_tokens=500,   # 简短回答限制Token数
            timeout=15,
        ):
            yield chunk
    
    def _select_model(self, context: ReadingContext, tier: str) -> str:
        """根据上下文和层级选择模型"""
        if tier == "fallback":
            return self.config.FALLBACK_MODEL
        
        # 根据学科和问题复杂度选择
        if context.selection_type in ["formula", "chemical_equation"]:
            return self.config.REASONING_MODEL  # 推理增强模型
        
        if context.stage == "primary":
            return self.config.LIGHTWEIGHT_MODEL  # 轻量模型，低延迟
        
        return self.config.DEFAULT_MODEL
```

### 6.2 RAG上下文增强

```python
class ReaderQARagEnhancer:
    """
    为阅读器问答提供RAG检索增强
    """
    
    async def retrieve(self, context: ReadingContext) -> Optional[RagContext]:
        """检索与选中内容和问题相关的知识库内容"""
        
        # 构建检索查询
        query = self._build_query(context)
        
        # 并行检索：知识点详情 + 相似题目 + 相关讲解
        results = await asyncio.gather(
            self._search_knowledge_points(context.knowledge_point_ids),
            self._vector_search(query, top_k=3),
            self._search_related_explanations(context),
            return_exceptions=True,
        )
        
        kp_results = results[0] if not isinstance(results[0], Exception) else []
        vec_results = results[1] if not isinstance(results[1], Exception) else []
        expl_results = results[2] if not isinstance(results[2], Exception) else []
        
        if not kp_results and not vec_results and not expl_results:
            return None
        
        return RagContext(
            knowledge_points=kp_results,
            similar_content=vec_results,
            related_explanations=expl_results,
        )
    
    def _build_query(self, context: ReadingContext) -> str:
        """构建向量检索查询"""
        parts = [
            context.selectedText,
            context.surroundingText[:100],
        ]
        if context.knowledge_point_names:
            parts.append(" ".join(context.knowledge_point_names))
        return " ".join(parts)
```

---

## 7. 状态流转

### 7.1 客户端状态机

```
                    ┌─────────┐
                    │ HIDDEN  │ (初始状态/关闭后)
                    └────┬────┘
                         │ 用户选中文本
                         ▼
                ┌─────────────────┐
                │ SELECTION_MENU  │
                └────────┬────────┘
                         │ 点击"问AI"
                         ▼
                ┌─────────────────┐
                │ QUICK_QUESTION  │
                └────────┬────────┘
                         │ 选择快捷问题或输入自定义问题
                         ▼
                ┌─────────────────┐
                │   STREAMING     │ ◄─── 网络异常 ──┐
                └────────┬────────┘                │
                         │                         │
            ┌────────────┼────────────┐            │
            │            │            │            │
            ▼            ▼            ▼            │
     AI回答完成    AI回答失败    超时(15s)       │
            │            │            │            │
            ▼            ▼            ▼            │
    ┌─────────────┐ ┌─────────┐ ┌──────────┐    │
    │  COMPLETED  │ │  ERROR  │ │  ERROR   │    │
    └──────┬──────┘ └────┬────┘ └────┬─────┘    │
           │              │           │           │
           │ 展开详细       │ 重试 ─────┼───────────┘
           ▼              │           
    ┌─────────────┐      │           
    │  EXPANDED   │      │           
    └──────┬──────┘      │           
           │              │           
           │ 收起         │           
           ▼              │           
    ┌─────────────┐      │           
    │  COMPLETED  │      │           
    └──────┬──────┘      │           
           │              │           
           ├──────────────┤           
           │              │           
           ▼              ▼           
    ┌─────────────────────────┐      
    │ 关闭 → 上报反馈 → HIDDEN│      
    └─────────────────────────┘      
```

### 7.2 错误恢复策略

| 错误场景 | 状态变化 | 恢复策略 |
| --- | --- | --- |
| 网络超时 | → ERROR | 自动重试1次，失败后显示"点击重试" |
| AI服务不可用 | → ERROR | 自动降级备用模型，仍失败则提示稍后重试 |
| SSE连接断开 | → STREAMING(保持) | 自动重连，续接已接收的内容 |
| 内容安全拦截 | → ERROR | 显示友好提示，建议换种问法 |
| 频率限制 | → ERROR | 显示倒计时，到期后自动恢复 |
| 次数用尽 | → ERROR | 引导开通/升级会员 |

---

## 8. 性能优化

### 8.1 首Token延迟优化

| 优化点 | 策略 | 目标 |
| --- | --- | --- |
| 上下文构建 | 并行获取用户/内容/会话数据 | < 50ms |
| Prompt组装 | 缓存角色/场景/格式模板 | < 10ms |
| RAG检索 | 设置100ms超时，超时跳过 | 可选步骤 |
| 模型选择 | 小学优先使用轻量模型 | 降低TTFT |
| SSE连接 | 预热连接池 | < 100ms建连 |
| **总目标** | **选中文本到首Token** | **< 3秒** |

### 8.2 客户端渲染优化

```dart
/// 流式Markdown渲染优化
class OptimizedStreamingMarkdown extends StatefulWidget {
  final String content;
  final bool isStreaming;
  
  @override
  State<OptimizedStreamingMarkdown> createState() => 
    _OptimizedStreamingMarkdownState();
}

class _OptimizedStreamingMarkdownState 
    extends State<OptimizedStreamingMarkdown> {
  String _renderedContent = '';
  int _lastRenderLength = 0;
  Timer? _renderTimer;
  
  @override
  void initState() {
    super.initState();
    _startThrottledRender();
  }
  
  /// 节流渲染：每100ms最多渲染一次，避免逐字符重建Widget
  void _startThrottledRender() {
    _renderTimer?.cancel();
    _renderTimer = Timer.periodic(const Duration(milliseconds: 100), (_) {
      if (_lastRenderLength < widget.content.length) {
        setState(() {
          _renderedContent = widget.content;
          _lastRenderLength = widget.content.length;
        });
      }
    });
  }
  
  @override
  void dispose() {
    _renderTimer?.cancel();
    super.dispose();
  }
  
  @override
  Widget build(BuildContext context) {
    return MarkdownBody(
      data: _renderedContent,
      // ... extension配置
    );
  }
}
```

### 8.3 缓存策略

| 缓存层 | Key | TTL | 说明 |
| --- | --- | --- | --- |
| 客户端内存 | `reader_qa_{contentId}_{selectedTextHash}` | 会话内 | 同一选中文本不重复请求 |
| 客户端SQLite | `reader_qa_cache` 表 | 30天 | 历史问答本地缓存 |
| 服务端Redis | `reader_qa:{userId}:{contentId}:{textHash}` | 1小时 | 相同上下文+选中文本的回答复用 |
| 服务端Redis | `reader_context:{userId}:{contentId}` | 10分钟 | 阅读上下文预构建缓存 |

---

## 9. 错误处理与降级策略

### 9.1 降级链路

```
正常流程：选中文本 → 构建上下文 → RAG增强 → 大模型回答（SSE流式）
                                                    │
                                              失败/超时
                                                    ▼
                                     降级1：跳过RAG，直接大模型回答
                                                    │
                                              失败/超时
                                                    ▼
                                     降级2：切换备用模型回答
                                                    │
                                              失败/超时
                                                    ▼
                                     降级3：知识库关键词检索 + 模板回答
                                                    │
                                              失败/超时
                                                    ▼
                                     降级4：提示用户"换个问法"或"进入完整AI对话"
```

### 9.2 服务端异常处理

```python
class ReaderQAErrorHandler:
    """阅读器AI问答错误处理器"""
    
    async def handle(self, error: Exception, context: ReadingContext) -> SSEEvent:
        if isinstance(error, ContentSafetyError):
            logger.warning(f"Content safety blocked: {error.detail}")
            return SSEEvent("error", {
                "code": 40003,
                "message": "这个问题暂时无法回答，试试换个问法",
            })
        
        elif isinstance(error, RateLimitError):
            return SSEEvent("error", {
                "code": 42901,
                "message": "提问频率过高，请稍后再试",
                "retryAfter": error.retry_after,
            })
        
        elif isinstance(error, QuotaExhaustedError):
            return SSEEvent("error", {
                "code": 42902,
                "message": "今日AI问答次数已用完",
                "upgradeUrl": "/membership",
            })
        
        elif isinstance(error, LLMTimeoutError):
            # 自动降级到备用模型
            logger.warning(f"LLM timeout for user {context.user_id}")
            return await self._fallback_to_secondary_model(context)
        
        elif isinstance(error, ContextBuildError):
            # 降级：退化为通用AI对话
            logger.warning(f"Context build failed: {error.detail}")
            return await self._fallback_to_generic_dialogue(context)
        
        else:
            logger.error(f"Unexpected error in reader QA: {error}", exc_info=True)
            return SSEEvent("error", {
                "code": 50000,
                "message": "服务异常，请稍后重试",
            })
```

---

## 10. 安全与合规

### 10.1 内容安全

1. **选中文本安全检查**：提交前对选中文本进行敏感词过滤
2. **AI输出审核**：回答经过教育场景内容安全中间件
3. **未成年人保护**：低龄段自动过滤复杂/敏感话题
4. **Prompt注入防护**：选中文本作为数据而非指令传入，使用分隔符包裹

### 10.2 隐私保护

1. **上下文最小化**：仅传递必要的上下文字段，不传完整阅读内容
2. **surroundingText截断**：上下文前后各最多200字，防止信息泄露
3. **本地缓存加密**：SQLite中的问答记录使用SQLCipher加密
4. **数据同步**：离线缓存同步时使用HTTPS+Token认证

### 10.3 Prompt注入防御

```python
class PromptInjectionGuard:
    """防御通过选中文本注入恶意指令"""
    
    SAFE_DELIMITER = "<<<STUDENT_SELECTED_TEXT>>>"
    
    @classmethod
    def wrap_selected_text(cls, text: str) -> str:
        """用明确分隔符包裹用户选中文本，标识为数据而非指令"""
        return f"{cls.SAFE_DELIMITER}\n{text}\n{cls.SAFE_DELIMITER}"
    
    @classmethod  
    def detect_injection(cls, text: str) -> bool:
        """检测选中文本中是否包含指令注入模式"""
        injection_patterns = [
            r"ignore.*(?:previous|above|system).*instruction",
            r"忘记.*(?:之前|上面|系统).*指令",
            r"你(?:现在|其实)是",
            r"(?:role|system|assistant)\s*[:：]",
            r"<\|im_start\|>",
        ]
        for pattern in injection_patterns:
            if re.search(pattern, text, re.IGNORECASE):
                return True
        return False
```

---

## 11. 数据分析与运营

### 11.1 关键埋点事件

| 事件名 | 触发时机 | 关键参数 |
| --- | --- | --- |
| `reader_qa_select` | 用户选中文本并看到菜单 | contentId, selectionType, textLength |
| `reader_qa_ask` | 用户发起AI问答 | contentId, questionType, hasCustom |
| `reader_qa_first_token` | 首Token到达 | responseTimeMs, model |
| `reader_qa_complete` | AI回答完成 | totalTokens, responseTimeMs |
| `reader_qa_expand` | 用户展开详细解析 | sessionId |
| `reader_qa_followup` | 用户点击追问 | sessionId, followUpQuestion |
| `reader_qa_action` | 用户执行后续操作 | sessionId, actionType |
| `reader_qa_feedback` | 用户反馈满意度 | sessionId, satisfied |
| `reader_qa_close` | 用户关闭悬浮窗 | sessionId, dwellTime |

### 11.2 质量监控指标

| 指标 | 计算方式 | 目标值 |
| --- | --- | --- |
| 首Token响应P95 | 从请求到首Token的95分位 | < 3秒 |
| 回答完成率 | 完成事件/请求事件 | > 95% |
| 用户满意率 | satisfied=true / 有反馈的会话 | > 80% |
| 详细解析展开率 | 展开事件 / 完成事件 | 30%-50% |
| 追问率 | 有追问的会话 / 总会话 | 15%-30% |
| 笔记保存率 | 保存笔记 / 完成事件 | 10%-20% |
| 降级率 | 走降级链路的请求 / 总请求 | < 5% |
| 平均会话时长 | 关闭时间 - 发起时间 | 30-90秒 |

---

## 12. 分学段交互适配

### 12.1 幼儿/小学低年级适配

```
特殊处理：
1. 不显示"自定义输入框"，只保留快捷按钮（图标+文字）
2. 快捷按钮减少为3个：[讲解] [语音播放] [换个说法]
3. AI回答自动播放语音TTS
4. 回答内容以卡片+图片为主，减少纯文字
5. 悬浮窗占据屏幕60%，大字体
6. 关闭按钮更大（44x44pt触控区）
```

### 12.2 初中/高中适配

```
特殊处理：
1. 完整快捷按钮 + 自定义输入框
2. AI回答支持LaTeX公式、化学方程式渲染
3. 追问建议显示3个
4. 可切换到"完整AI对话"模式
5. 支持生成练习题并直接作答
6. 悬浮窗支持上下拖拽调整大小
7. 历史问答可在阅读器侧边栏查看
```

---

## 13. 与其他模块的集成

### 13.1 集成接口清单

| 目标模块 | 集成方式 | 触发场景 |
| --- | --- | --- |
| 批注/笔记系统 | 调用 `NoteService.create()` | 用户点击"保存为笔记" |
| 练习测评系统 | 调用 `ExerciseService.generate()` | 用户点击"生成练习题" |
| AI对话引擎 | 跳转 `AIDialoguePage` 携带上下文 | 用户点击"进入完整对话" |
| 错题本 | 调用 `MistakeBookService.add()` | 练习题答错时 |
| 知识图谱 | 调用 `KnowledgeGraphService.highlight()` | 用户点击"相关知识" |
| 学情分析 | 发送行为事件到 `BehaviorTracker` | 所有交互事件 |
| 学习计时器 | 不额外计时（已包含在阅读时长中） | N/A |

### 13.2 阅读器集成代码示例

```dart
/// 在现有阅读器中集成AI问答悬浮窗
class ReaderScreen extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: ReaderQAOverlay(  // 包裹在悬浮窗组件中
        child: ReadingContentArea(
          onTextSelected: (selection, surrounding) {
            // 文本选择回调 → 通知QA状态管理器
            ref.read(readerQAProvider.notifier).onTextSelected(
              selection, surrounding,
            );
          },
          content: currentContent,
        ),
      ),
    );
  }
}

/// 文本选择处理器 — 集成到富文本渲染器
class SelectableContentRenderer extends StatelessWidget {
  final ContentData content;
  final void Function(TextSelection, String) onTextSelected;
  
  String _extractSurrounding(TextSelection selection) {
    final fullText = content.plainText;
    final start = max(0, selection.start - 200);
    final end = min(fullText.length, selection.end + 200);
    return fullText.substring(start, end);
  }
  
  @override
  Widget build(BuildContext context) {
    return SelectionArea(
      onSelectionChanged: (selection) {
        if (selection != null && selection.plainText.isNotEmpty) {
          final surrounding = _extractSurrounding(selection);
          onTextSelected(selection, surrounding);
        }
      },
      child: _buildRichContent(),
    );
  }
}
```

---

## 14. 测试要点

### 14.1 功能测试用例

| 场景 | 操作 | 预期结果 |
| --- | --- | --- |
| 普通文本选择 | 长按选择一段文字 | 出现菜单含"问AI"按钮 |
| 公式选择 | 选择LaTeX公式 | 自动识别为公式类型，AI回答含公式渲染 |
| 快捷问题 | 点击"讲解一下" | 3秒内开始流式输出回答 |
| 自定义问题 | 输入"这个概念和XX有关系吗" | AI理解并回答 |
| 展开详细 | 点击"展开详细解析" | 显示更深入的推导/解释 |
| 保存笔记 | 点击"保存为笔记" | 笔记创建成功，按钮变灰 |
| 追问 | 点击追问建议 | 发起新一轮问答，携带前文上下文 |
| 完整对话 | 点击"进入完整对话" | 跳转到AI对话页面，携带阅读上下文 |
| 网络异常 | 断网后发起问答 | 显示错误提示和重试按钮 |
| 频率限制 | 连续快速发起10次 | 触发限流提示 |
| 离线场景 | 离线状态选择文本 | 不显示"问AI"按钮，仅显示本地功能 |

### 14.2 性能测试指标

| 测试项 | 方法 | 通过标准 |
| --- | --- | --- |
| 首Token延迟 | 100次请求取P95 | < 3000ms |
| 流式渲染帧率 | DevTools监测 | > 55fps |
| 内存占用 | 连续10次问答后 | 增量 < 20MB |
| 悬浮窗弹出动画 | 高速摄像/帧分析 | < 300ms完成 |
| SQLite写入延迟 | 单次问答缓存写入 | < 50ms |

---

## 15. 后续演进方向

| 阶段 | 功能 | 说明 |
| --- | --- | --- |
| V1.5 | 语音提问 | 选中文本后可用语音追问 |
| V1.5 | 图片截图提问 | 在阅读器中截图区域直接问AI |
| V2.0 | 协作批注 | 同一内容的AI问答回答可被其他同学看到（班级模式） |
| V2.0 | 知识图谱集成 | AI回答中的知识点可直接跳转到知识图谱浏览 |
| V2.0 | 教师介入 | 教师可查看班级学生的高频阅读疑问 |
| V2.5 | 多模态回答 | 回答中包含图表、动画、交互式组件 |
| V2.5 | 上下文记忆 | 记住学生在同一章节的历次提问，避免重复解释 |
