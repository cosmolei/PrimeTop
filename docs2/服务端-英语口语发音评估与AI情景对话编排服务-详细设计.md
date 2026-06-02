# 服务端-英语口语发音评估与AI情景对话编排服务 - 详细设计

> 模块负责人：待定 | 版本：1.0 | 日期：2026-06-03

## 1. 模块概述

### 1.1 定位

本服务为英语口语陪练提供 **全链路服务端支撑**，涵盖口语对话编排、实时语音流处理、发音评估打分、AI情景对话管理、口语能力建模五大核心能力。作为「英语专项学习与口语陪练」模块的服务端核心，向上承接客户端语音交互页面，向下编排 ASR/TTS/大模型/Audio Scoring 等底层能力。

### 1.2 与其他模块的关系

| 关联模块 | 关系 | 交互方式 |
|---------|------|---------|
| 语音服务(ASR-TTS) | 依赖 ASR 识别、TTS 合成、发音评分 | gRPC 同步调用 |
| AI智能辅导 / AI对话引擎 | 复用多轮对话上下文管理、Prompt 编排 | 内部方法调用 |
| AI-Prompt编排 | 使用英语口语陪练专属 Prompt 模板 | 配置读取 |
| 英语词汇记忆与单词本系统 | 消费词汇掌握度数据，输出口语练习关联词汇 | RPC |
| 学情分析 / 用户学习画像 | 输出口语练习行为与发音评分数据 | 事件消息 |
| RAG与知识库 | 检索英语情景对话素材、话题语料、语法条目 | RPC |
| 用户额度与API调用管控 | 消费用户口语练习额度 | RPC |
| 多模型调度与成本治理 | 按场景路由至不同模型 | 内部调用 |
| SSE流式响应引擎 | TTS 合成后流式推送音频片段 | 事件推送 |

### 1.3 适用学段与差异化策略

| 学段 | 口语练习重点 | CEFR 目标 | 话题范围 | 对话复杂度 |
|------|-------------|----------|---------|-----------|
| 小学(3-6年级) | 跟读模仿、简单问答、日常用语 | A1-A2 | 家庭、学校、食物、动物、颜色 | 单轮+短句 |
| 初中 | 情景对话、话题表达、听力口语联动 | A2-B1 | 兴趣爱好、旅行、健康、节日 | 多轮+复合句 |
| 高中 | 深度讨论、观点陈述、辩论式对话 | B1-B2 | 社会话题、科技、文化、未来规划 | 多轮+逻辑论述 |

---

## 2. 功能清单

| 功能 | 说明 | 优先级 | MVP |
|------|------|--------|-----|
| 情景对话会话管理 | 创建/恢复/结束口语练习会话 | P0 | ✅ |
| AI角色扮演编排 | 按场景配置AI角色、对话策略 | P0 | ✅ |
| 实时语音流处理 | 接收客户端音频流，转交ASR | P0 | ✅ |
| 发音评估打分 | 音素级/单词级/句子级发音评分 | P0 | ✅ |
| 发音纠错反馈 | 定位发音错误音素，给出纠正建议 | P0 | ✅ |
| 对话上下文管理 | 维护口语会话的多轮上下文 | P0 | ✅ |
| 口语话题推荐 | 基于学习进度推荐适合的口语话题 | P1 | ❌ |
| 口语练习报告 | 会话结束后生成练习总结报告 | P1 | ❌ |
| 口语能力建模 | 持续追踪用户口语能力维度变化 | P1 | ❌ |
| 朗读评估模式 | 课本/短文朗读，整体流利度评分 | P1 | ❌ |
| 模拟口语考试 | 按中高考口语考试模式编排练习 | P2 | ❌ |

---

## 3. 数据结构设计

### 3.1 口语练习会话表 `oral_practice_session`

```sql
CREATE TABLE oral_practice_session (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '会话ID',
    user_id             BIGINT NOT NULL COMMENT '用户ID',
    student_profile_id  BIGINT NOT NULL COMMENT '学生档案ID',
    scenario_type       VARCHAR(50) NOT NULL COMMENT '场景类型: free_talk/role_play/reading_aloud/topic_discussion',
    topic_id            BIGINT COMMENT '话题ID（关联 oral_topic）',
    difficulty_level    TINYINT NOT NULL DEFAULT 1 COMMENT '难度等级 1-10',
    cefr_target         CHAR(2) COMMENT '目标CEFR等级',
    status              TINYINT NOT NULL DEFAULT 1 COMMENT '会话状态: 1-进行中 2-已结束 3-已中断 4-超时关闭',
    turn_count          SMALLINT NOT NULL DEFAULT 0 COMMENT '对话轮次',
    total_duration_sec  INT NOT NULL DEFAULT 0 COMMENT '总时长（秒）',
    total_speaking_sec  INT NOT NULL DEFAULT 0 COMMENT '用户实际说话时长（秒）',
    overall_score       DECIMAL(4,1) COMMENT '综合评分 0-100',
    fluency_score       DECIMAL(4,1) COMMENT '流利度评分',
    pronunciation_score DECIMAL(4,1) COMMENT '发音准确度评分',
    grammar_score       DECIMAL(4,1) COMMENT '语法正确度评分',
    vocabulary_score    DECIMAL(4,1) COMMENT '词汇丰富度评分',
    ai_model_used       VARCHAR(50) COMMENT '使用的AI模型标识',
    context_snapshot    JSON COMMENT '上下文快照（用于断点恢复）',
    started_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at            DATETIME COMMENT '结束时间',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_status (user_id, status),
    INDEX idx_user_created (user_id, created_at),
    INDEX idx_scenario (scenario_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='口语练习会话';
```

### 3.2 对话轮次记录表 `oral_conversation_turn`

```sql
CREATE TABLE oral_conversation_turn (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '轮次ID',
    session_id          BIGINT NOT NULL COMMENT '会话ID',
    turn_index          SMALLINT NOT NULL COMMENT '轮次序号（从1开始）',
    speaker             VARCHAR(20) NOT NULL COMMENT '说话方: user / ai',
    
    -- 用户输入侧
    audio_url           VARCHAR(500) COMMENT '用户录音音频URL（对象存储）',
    audio_duration_ms   INT COMMENT '音频时长（毫秒）',
    asr_text            TEXT COMMENT 'ASR识别出的英文文本',
    asr_confidence      DECIMAL(3,2) COMMENT 'ASR识别置信度 0.00-1.00',
    
    -- 发音评估侧（仅 speaker=user 时有值）
    pronunciation_score DECIMAL(4,1) COMMENT '本句发音评分 0-100',
    fluency_score       DECIMAL(4,1) COMMENT '本句流利度评分',
    completeness_score  DECIMAL(4,1) COMMENT '完整度评分（是否念完）',
    phoneme_detail      JSON COMMENT '音素级评估详情',
    word_scores         JSON COMMENT '单词级评分列表',
    error_phonemes      JSON COMMENT '发音错误音素列表',
    
    -- AI回复侧
    ai_response_text    TEXT COMMENT 'AI回复的英文文本',
    ai_response_zh      TEXT COMMENT 'AI回复的中文翻译（低年级用）',
    ai_audio_url        VARCHAR(500) COMMENT 'AI回复的TTS音频URL',
    ai_audio_duration_ms INT COMMENT 'AI音频时长（毫秒）',
    
    -- 语法与词汇分析
    grammar_issues      JSON COMMENT '语法问题列表',
    vocabulary_analysis  JSON COMMENT '词汇使用分析',
    suggested_correction TEXT COMMENT '改进建议文本',
    
    -- 元数据
    response_latency_ms INT COMMENT '端到端响应延迟（毫秒）',
    model_used          VARCHAR(50) COMMENT '本次轮次使用的模型',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_session (session_id, turn_index),
    INDEX idx_created (session_id, created_at),
    FOREIGN KEY (session_id) REFERENCES oral_practice_session(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='口语对话轮次记录';
```

### 3.3 口语话题库表 `oral_topic`

```sql
CREATE TABLE oral_topic (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '话题ID',
    title_en            VARCHAR(200) NOT NULL COMMENT '话题英文标题',
    title_zh            VARCHAR(200) NOT NULL COMMENT '话题中文标题',
    description         TEXT COMMENT '话题描述',
    category            VARCHAR(50) NOT NULL COMMENT '话题分类: daily_life/school/travel/culture/technology/... ',
    cefr_level          CHAR(2) NOT NULL COMMENT '推荐CEFR等级',
    grade_range         VARCHAR(100) NOT NULL COMMENT '适用学段JSON: ["primary5","primary6","junior1",...]',
    difficulty_level    TINYINT NOT NULL COMMENT '难度 1-10',
    
    -- 对话配置
    scenario_config     JSON NOT NULL COMMENT '情景配置',
    -- scenario_config 结构示例:
    -- {
    --   "aiRole": "coffee shop barista",
    --   "aiRoleDescription": "You are a friendly barista at a coffee shop...",
    --   "openingLine": "Hi there! What can I get for you today?",
    --   "targetVocabulary": ["order", "latte", "size", "sugar"],
    --   "targetGrammar": ["would like", "can I have"],
    --   "conversationGoals": ["order a drink", "specify size", "pay"],
    --   "maxTurns": 8,
    --   "timeLimitMinutes": 5
    -- }
    
    key_expressions     JSON COMMENT '核心表达/句型列表',
    sample_dialogue     JSON COMMENT '示范对话',
    cover_image_url     VARCHAR(500) COMMENT '封面图URL',
    tags                JSON COMMENT '标签',
    use_count           INT NOT NULL DEFAULT 0 COMMENT '使用次数',
    avg_score           DECIMAL(4,1) COMMENT '平均得分',
    status              TINYINT NOT NULL DEFAULT 1 COMMENT '1-启用 0-禁用',
    sort_order          INT NOT NULL DEFAULT 0 COMMENT '排序权重',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cefr (cefr_level),
    INDEX idx_category (category),
    INDEX idx_grade (grade_range(50)),
    INDEX idx_status_sort (status, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='口语话题库';
```

### 3.4 用户口语能力档案表 `user_oral_profile`

```sql
CREATE TABLE user_oral_profile (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '档案ID',
    user_id             BIGINT NOT NULL UNIQUE COMMENT '用户ID',
    student_profile_id  BIGINT NOT NULL COMMENT '学生档案ID',
    cefr_estimated      CHAR(2) COMMENT '系统评估CEFR等级',
    cefr_last_updated   DATETIME COMMENT 'CEFR评估更新时间',
    
    -- 能力维度评分（0-100，加权滑动平均）
    pronunciation_avg   DECIMAL(4,1) NOT NULL DEFAULT 0 COMMENT '发音准确度均值',
    fluency_avg         DECIMAL(4,1) NOT NULL DEFAULT 0 COMMENT '流利度均值',
    grammar_avg         DECIMAL(4,1) NOT NULL DEFAULT 0 COMMENT '语法正确度均值',
    vocabulary_avg      DECIMAL(4,1) NOT NULL DEFAULT 0 COMMENT '词汇丰富度均值',
    interaction_avg     DECIMAL(4,1) NOT NULL DEFAULT 0 COMMENT '互动响应能力均值',
    
    -- 统计数据
    total_sessions      INT NOT NULL DEFAULT 0 COMMENT '总练习次数',
    total_turns         INT NOT NULL DEFAULT 0 COMMENT '总对话轮次',
    total_speaking_sec  BIGINT NOT NULL DEFAULT 0 COMMENT '总口语时长（秒）',
    total_words_spoken  INT NOT NULL DEFAULT 0 COMMENT '总说出的单词数',
    
    -- 薄弱项
    weak_phonemes       JSON COMMENT '薄弱音素列表',
    weak_grammar_points JSON COMMENT '薄弱语法点列表',
    
    -- 最近练习
    last_session_id     BIGINT COMMENT '最近一次会话ID',
    last_practice_at    DATETIME COMMENT '最近练习时间',
    
    -- 进步趋势
    score_trend_30d     JSON COMMENT '近30天评分趋势',
    
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_cefr (cefr_estimated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户口语能力档案';
```

### 3.5 发音错误记录表 `pronunciation_error_log`

```sql
CREATE TABLE pronunciation_error_log (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '记录ID',
    user_id             BIGINT NOT NULL COMMENT '用户ID',
    session_id          BIGINT NOT NULL COMMENT '会话ID',
    turn_id             BIGINT NOT NULL COMMENT '轮次ID',
    
    -- 错误定位
    target_phoneme      VARCHAR(20) NOT NULL COMMENT '目标音素（IPA）',
    actual_phoneme      VARCHAR(20) COMMENT '实际发出的音素（IPA）',
    target_word         VARCHAR(100) COMMENT '所在单词',
    word_position       TINYINT COMMENT '在单词中的位置: 0-词首 1-词中 2-词尾',
    confidence          DECIMAL(3,2) NOT NULL COMMENT '错误置信度',
    severity            TINYINT NOT NULL COMMENT '严重程度: 1-轻微 2-明显 3-严重',
    
    -- 纠正建议
    correction_tip      VARCHAR(500) COMMENT '纠正提示文本',
    similar_sound_zh    VARCHAR(100) COMMENT '近似中文发音参考',
    practice_words      JSON COMMENT '推荐练习单词列表',
    
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id, created_at),
    INDEX idx_phoneme (target_phoneme),
    INDEX idx_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='发音错误记录';
```

### 3.6 关键 JSON 字段结构

#### phoneme_detail（音素级评估详情）

```json
{
  "phonemes": [
    {
      "phoneme": "ð",
      "expected": "ð",
      "actual": "d",
      "score": 35.2,
      "startTime": 0.23,
      "endTime": 0.31,
      "severity": "high"
    }
  ],
  "totalPhonemes": 12,
  "correctPhonemes": 10,
  "errorPhonemes": ["ð", "θ"]
}
```

#### word_scores（单词级评分）

```json
{
  "words": [
    {
      "word": "the",
      "score": 45.0,
      "phonemeErrors": ["ð→d"],
      "suggestedFix": "咬舌音 /ð/，舌尖轻触上门牙"
    },
    {
      "word": "weather",
      "score": 92.5,
      "phonemeErrors": []
    }
  ]
}
```

#### grammar_issues（语法问题）

```json
{
  "issues": [
    {
      "type": "tense_error",
      "originalText": "I go to school yesterday",
      "correctedText": "I went to school yesterday",
      "explanation": "yesterday 表示过去时间，应使用一般过去时 went",
      "severity": "medium"
    }
  ]
}
```

---

## 4. API 接口设计

### 4.1 接口总览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/oral/sessions` | 创建口语练习会话 |
| GET | `/api/v1/oral/sessions/{sessionId}` | 获取会话详情 |
| POST | `/api/v1/oral/sessions/{sessionId}/audio` | 上传一轮语音（流式） |
| POST | `/api/v1/oral/sessions/{sessionId}/text` | 文本输入（调试/降级模式） |
| GET | `/api/v1/oral/sessions/{sessionId}/turns` | 获取会话所有轮次 |
| GET | `/api/v1/oral/sessions/{sessionId}/report` | 获取练习报告 |
| POST | `/api/v1/oral/sessions/{sessionId}/end` | 结束会话 |
| GET | `/api/v1/oral/topics` | 获取可用话题列表 |
| GET | `/api/v1/oral/topics/{topicId}` | 获取话题详情 |
| GET | `/api/v1/oral/profile` | 获取用户口语能力档案 |
| GET | `/api/v1/oral/profile/weak-points` | 获取薄弱项分析 |
| GET | `/api/v1/oral/history` | 获取练习历史 |
| POST | `/api/v1/oral/pronunciation/evaluate` | 单独的发音评估接口 |

### 4.2 创建口语练习会话

```
POST /api/v1/oral/sessions
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**
```json
{
  "scenarioType": "role_play",
  "topicId": 10042,
  "difficultyLevel": 3
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| scenarioType | string | 是 | 场景类型: free_talk / role_play / reading_aloud / topic_discussion |
| topicId | long | 否 | 话题ID，free_talk 时可不传 |
| difficultyLevel | int | 否 | 难度 1-10，不传则根据用户能力自动推断 |

**响应体：**
```json
{
  "code": 0,
  "data": {
    "sessionId": 20260603150001,
    "scenarioType": "role_play",
    "topic": {
      "titleEn": "Ordering at a Coffee Shop",
      "titleZh": "在咖啡店点单",
      "aiRole": "Coffee Shop Barista",
      "openingLine": "Hi there! Welcome to our coffee shop! What can I get for you today?",
      "openingAudioUrl": "https://cdn.example.com/oral/topics/10042/opening.mp3"
    },
    "targetVocabulary": ["order", "latte", "cappuccino", "size", "sugar", "cream"],
    "targetGrammar": ["would like", "can I have", "I'd like"],
    "maxTurns": 8,
    "timeLimitMinutes": 5,
    "estimatedCeFR": "A2",
    "status": "active",
    "createdAt": "2026-06-03T15:00:01.000Z"
  }
}
```

### 4.3 上传语音并获取AI回复（核心接口）

```
POST /api/v1/oral/sessions/{sessionId}/audio
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| audio | file | 是 | 音频文件（WAV/PCM/WebM/Opus，时长 ≤ 60s） |
| audioFormat | string | 是 | 音频格式: wav / pcm / webm / opus |
| sampleRate | int | 否 | 采样率，默认 16000 |
| turnIndex | int | 是 | 当前轮次序号 |

**响应体：**
```json
{
  "code": 0,
  "data": {
    "turnIndex": 3,
    "asrResult": {
      "text": "I would like a latte please",
      "confidence": 0.92,
      "words": [
        {"word": "I", "start": 0.0, "end": 0.12, "confidence": 0.98},
        {"word": "would", "start": 0.12, "end": 0.35, "confidence": 0.95},
        {"word": "like", "start": 0.35, "end": 0.58, "confidence": 0.94},
        {"word": "a", "start": 0.58, "end": 0.65, "confidence": 0.99},
        {"word": "latte", "start": 0.65, "end": 1.05, "confidence": 0.88},
        {"word": "please", "start": 1.05, "end": 1.40, "confidence": 0.91}
      ]
    },
    "pronunciationEval": {
      "overallScore": 82.5,
      "fluencyScore": 85.0,
      "completenessScore": 95.0,
      "pronunciationScore": 78.0,
      "wordScores": [
        {"word": "I", "score": 98.0, "errors": []},
        {"word": "would", "score": 90.0, "errors": []},
        {"word": "like", "score": 88.0, "errors": []},
        {"word": "a", "score": 95.0, "errors": []},
        {"word": "latte", "score": 62.0, "errors": [
          {"phoneme": "æ", "actual": "e", "tip": "嘴唇张大，发 /æ/ 时下巴下拉"}
        ]},
        {"word": "please", "score": 75.0, "errors": [
          {"phoneme": "iː", "actual": "ɪ", "tip": "/iː/ 是长元音，嘴角向两侧拉伸"}
        ]}
      ],
      "errorPhonemes": ["æ", "iː"]
    },
    "aiResponse": {
      "text": "Great choice! What size would you like — small, medium, or large?",
      "textZh": "好选择！请问您要什么杯型——小杯、中杯还是大杯？",
      "audioUrl": "https://cdn.example.com/oral/responses/20260603150001_t3_ai.mp3",
      "audioDurationMs": 2800
    },
    "correctionTip": "注意 latte 中的 /æ/ 音要张大嘴发，类似中文'啊'的口型。试试再读一遍？",
    "grammarIssues": [],
    "sessionStatus": "active",
    "remainingTurns": 5
  }
}
```

### 4.4 结束会话并获取报告

```
POST /api/v1/oral/sessions/{sessionId}/end
Authorization: Bearer <token>
```

**响应体：**
```json
{
  "code": 0,
  "data": {
    "sessionId": 20260603150001,
    "sessionSummary": {
      "totalTurns": 8,
      "totalDurationSec": 245,
      "speakingTimeSec": 120,
      "aiSpeakingTimeSec": 80,
      "silenceTimeSec": 45,
      "wordsSpoken": 68,
      "uniqueWords": 42
    },
    "scores": {
      "overall": 79.5,
      "pronunciation": 76.0,
      "fluency": 82.0,
      "grammar": 85.0,
      "vocabulary": 72.0,
      "interaction": 80.0
    },
    "highlights": [
      "发音流利度不错，整体节奏感好",
      "正确使用了 Would like 句型"
    ],
    "improvements": [
      {
        "area": "pronunciation",
        "detail": "注意 /θ/ 和 /ð/ 的咬舌发音",
        "examples": ["think", "the", "weather"],
        "practiceSuggestion": "每天跟读3个含 th 的单词"
      },
      {
        "area": "vocabulary",
        "detail": "表达略显单一，可增加同义替换",
        "examples": ["可用 I'd prefer 代替 I'd like"],
        "practiceSuggestion": "学习点单场景的5种表达方式"
      }
    ],
    "cefrEstimate": "A2",
    "progressFromLast": 2.5,
    "recommendedNextTopics": [10056, 10078, 10089]
  }
}
```

### 4.5 获取话题列表

```
GET /api/v1/oral/topics?category=daily_life&cefrLevel=A2&page=1&size=20
Authorization: Bearer <token>
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| category | string | 否 | 话题分类筛选 |
| cefrLevel | string | 否 | CEFR等级筛选 |
| grade | string | 否 | 学段筛选: primary5 / junior1 等 |
| page | int | 否 | 页码，默认 1 |
| size | int | 否 | 每页数量，默认 20，最大 50 |

**响应体（列表项）：**
```json
{
  "code": 0,
  "data": {
    "total": 156,
    "page": 1,
    "size": 20,
    "items": [
      {
        "id": 10042,
        "titleEn": "Ordering at a Coffee Shop",
        "titleZh": "在咖啡店点单",
        "category": "daily_life",
        "cefrLevel": "A2",
        "difficultyLevel": 3,
        "coverImageUrl": "https://cdn.example.com/oral/topics/10042/cover.jpg",
        "avgScore": 72.5,
        "useCount": 1520,
        "completed": true,
        "lastScore": 79.5,
        "targetVocabulary": ["order", "latte", "size"],
        "estimatedMinutes": 5
      }
    ]
  }
}
```

### 4.6 单独发音评估接口

```
POST /api/v1/oral/pronunciation/evaluate
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| audio | file | 是 | 音频文件 |
| referenceText | string | 是 | 参考文本（标准文本） |
| audioFormat | string | 是 | 音频格式 |
| granularity | string | 否 | 评估粒度: phoneme / word / sentence，默认 word |

**说明：** 该接口不依赖会话，可用于朗读评估、单词发音练习等独立场景。

---

## 5. 核心流程设计

### 5.1 口语练习会话主流程

```
┌─────────┐    ┌──────────────┐    ┌──────────────────┐    ┌───────────┐
│ 客户端    │    │ 口语编排服务   │    │ 外部服务          │    │ 数据层     │
└────┬────┘    └──────┬───────┘    └───────┬──────────┘    └─────┬─────┘
     │                │                     │                    │
     │ 1. 创建会话     │                     │                    │
     │───────────────>│                     │                    │
     │                │ 1a. 加载话题配置      │                    │
     │                │─────────────────────────────────────────>│
     │                │ 1b. 检查额度         │                    │
     │                │─────────────────────────────────────────>│
     │                │ 1c. 创建会话记录      │                    │
     │                │─────────────────────────────────────────>│
     │  返回开场白     │                     │                    │
     │<───────────────│                     │                    │
     │                │                     │                    │
     │ 2. 上传音频     │                     │                    │
     │───────────────>│                     │                    │
     │                │ 2a. 保存音频到OSS    │                    │
     │                │─────────────────────────────────────────>│
     │                │                     │                    │
     │                │ 2b. ASR 识别         │                    │
     │                │──────────────────>  │                    │
     │                │<──────────────────│                    │
     │                │                     │                    │
     │                │ 2c. 发音评估         │                    │
     │                │──────────────────>  │                    │
     │                │<──────────────────│                    │
     │                │                     │                    │
     │                │ 2d. 构造对话Prompt    │                    │
     │                │ 2e. 调用大模型        │                    │
     │                │──────────────────>  │                    │
     │                │<──────────────────│                    │
     │                │                     │                    │
     │                │ 2f. TTS 合成AI回复   │                    │
     │                │──────────────────>  │                    │
     │                │<──────────────────│                    │
     │                │                     │                    │
     │                │ 2g. 保存轮次记录      │                    │
     │                │─────────────────────────────────────────>│
     │  返回全部结果    │                     │                    │
     │<───────────────│                     │                    │
     │                │                     │                    │
     │ 3. 结束会话     │                     │                    │
     │───────────────>│                     │                    │
     │                │ 3a. 生成练习报告      │                    │
     │                │ 3b. 更新口语能力档案   │                    │
     │                │ 3c. 更新学情数据      │                    │
     │                │─────────────────────────────────────────>│
     │  返回报告       │                     │                    │
     │<───────────────│                     │                    │
```

### 5.2 发音评估处理流程

```
原始音频
   │
   ▼
┌────────────┐
│ 音频预处理   │  降噪、音量归一化、VAD端点检测
└─────┬──────┘
      │
      ▼
┌────────────┐
│ ASR 识别    │  语音→文本，带词级时间戳和置信度
└─────┬──────┘
      │
      ▼
┌────────────┐
│ 强制对齐    │  将音频帧与参考文本的音素序列对齐
└─────┬──────┘
      │
      ▼
┌────────────┐
│ 音素级评分   │  每个音素独立评分（GOP分数）
└─────┬──────┘
      │
      ▼
┌────────────┐
│ 聚合评分     │  音素→单词→句子 三级聚合
│              │  流利度：语速、停顿频率、停顿时长
│              │  完整度：是否念完所有词
│              │  发音准确度：音素评分加权平均
└─────┬──────┘
      │
      ▼
┌────────────┐
│ 错误诊断     │  识别低分音素，生成纠错建议
│              │  关联用户历史薄弱音素
└─────┬──────┘
      │
      ▼
评估结果（phoneme_detail + word_scores + error_phonemes）
```

### 5.3 AI对话编排策略

口语陪练的AI对话与普通AI辅导有显著差异：

1. **角色固定**：AI扮演特定角色（如咖啡师、医生、同学）
2. **对话目标明确**：每个场景有预设的沟通目标
3. **回复简短**：口语对话中AI回复应短于书面问答
4. **适度纠错**：在对话自然流转中嵌入温和纠错
5. **推进对话**：当用户卡住时主动引导

#### Prompt 模板结构

```yaml
oral_practice_role_play:
  system: |
    你是一位英语口语陪练老师，当前正在扮演{aiRole}。
    
    ## 角色设定
    {aiRoleDescription}
    
    ## 对话规则
    1. 始终保持角色，不要跳出角色
    2. 每次回复控制在 1-3 句话，口语化、自然
    3. 用户的英语水平为 {cefrLevel}（{gradeRange}），使用匹配难度的词汇和句型
    4. 如果用户使用中文，温和地鼓励其用英语表达
    5. 如果用户表达有语法错误，在自然回应中用正确形式重复（隐性纠错）
    6. 推进对话向目标发展，但不要强制要求
    
    ## 本次对话目标
    {conversationGoals}
    
    ## 目标词汇（自然融入对话中）
    {targetVocabulary}
    
    ## 用户最近的发音问题（可在适当时机温和提醒）
    {recentPronunciationIssues}
    
    ## 回复格式（严格遵守）
    回复 JSON：
    {
      "responseEn": "英文回复",
      "responseZh": "中文翻译",
      "correctionTip": "纠错提示（仅当有明显错误时给出，否则为空字符串）",
      "dialogueAction": "continue|encourage|redirect|wrap_up",
      "goalProgress": ["已完成的目标1", ...]
    }

  context_template: |
    对话历史：
    {conversationHistory}
    
    用户刚才说了："{userText}"
    发音评估：发音准确度 {pronunciationScore}/100，主要问题：{errorSummary}
    
    请回复。
```

### 5.4 会话状态机

```
                  ┌──────────┐
    创建会话 ────> │ CREATED   │
                  └─────┬────┘
                        │ 客户端确认，播放开场白
                        ▼
                  ┌──────────┐
                  │ ACTIVE    │ <─────── 继续对话轮次
                  └─────┬────┘
                        │
            ┌───────────┼────────────┐
            │           │            │
            ▼           ▼            ▼
     ┌──────────┐ ┌──────────┐ ┌──────────┐
     │ PAUSED   │ │ ENDED    │ │ TIMEOUT  │
     │ 用户暂停  │ │ 正常结束  │ │ 超时关闭  │
     └─────┬────┘ └──────────┘ └──────────┘
           │                      │
           │ 恢复                  │ 自动结束
           └──────> ACTIVE         └────> ENDED
```

状态枚举值：

| 值 | 状态 | 说明 |
|----|------|------|
| 1 | CREATED | 已创建，等待客户端确认 |
| 2 | ACTIVE | 进行中 |
| 3 | PAUSED | 用户暂停（如切换后台） |
| 4 | ENDED | 已结束 |
| 5 | TIMEOUT | 超时关闭（> timeLimitMinutes 无活动） |

---

## 6. 服务内部设计

### 6.1 分层架构

```
┌────────────────────────────────────────────────────────────┐
│                    Controller 层                            │
│  OralPracticeController  OralTopicController  OralProfileController  │
├────────────────────────────────────────────────────────────┤
│                    Service 层                               │
│  ┌──────────────┐  ┌───────────────┐  ┌────────────────┐  │
│  │ SessionManager│  │ DialogueEngine│  │EvaluationEngine│  │
│  └──────────────┘  └───────────────┘  └────────────────┘  │
│  ┌──────────────┐  ┌───────────────┐  ┌────────────────┐  │
│  │ TopicService  │  │ProfileService │  │ ReportGenerator│  │
│  └──────────────┘  └───────────────┘  └────────────────┘  │
├────────────────────────────────────────────────────────────┤
│                    Integration 层                           │
│  ┌────────────┐  ┌────────────┐  ┌──────────┐  ┌───────┐ │
│  │AsrClient   │  │TtsClient   │  │AiClient  │  │Scoring│ │
│  │(语音识别)   │  │(语音合成)   │  │(大模型)   │  │Client │ │
│  └────────────┘  └────────────┘  └──────────┘  │(发音) │ │
│                                                 └───────┘ │
├────────────────────────────────────────────────────────────┤
│                    Data 层                                  │
│  OralSessionRepo  OralTurnRepo  OralTopicRepo  ProfileRepo │
└────────────────────────────────────────────────────────────┘
```

### 6.2 核心服务类设计

#### SessionManager（会话管理器）

```java
@Service
public class OralSessionManager {

    /**
     * 创建口语练习会话
     * - 校验用户额度
     * - 加载话题配置
     * - 推断难度（如未指定）
     * - 生成开场白（AI角色的第一句话）
     */
    public OralSessionDTO createSession(Long userId, CreateSessionRequest request) {
        // 1. 查询用户口语能力档案，推断难度
        UserOralProfile profile = profileService.getOrCreate(userId);
        int difficulty = request.getDifficultyLevel() != null
            ? request.getDifficultyLevel()
            : inferDifficulty(profile);

        // 2. 查询话题配置
        OralTopic topic = topicService.getById(request.getTopicId());
        validateTopicForUser(topic, userId, difficulty);

        // 3. 检查口语练习额度
        quotaService.checkOralQuota(userId);

        // 4. 生成开场白音频（TTS预合成）
        String openingAudioUrl = ttsClient.synthesize(
            topic.getScenarioConfig().getOpeningLine(),
            "en-US", "female", "standard"
        );

        // 5. 创建会话记录
        OralPracticeSession session = new OralPracticeSession();
        session.setUserId(userId);
        session.setScenarioType(request.getScenarioType());
        session.setTopicId(request.getTopicId());
        session.setDifficultyLevel(difficulty);
        session.setCefrTarget(topic.getCefrLevel());
        session.setStatus(SessionStatus.CREATED.getCode());
        session.setAiModelUsed(selectModel(difficulty));
        sessionMapper.insert(session);

        return OralSessionDTO.builder()
            .sessionId(session.getId())
            .topic(mapTopic(topic))
            .openingAudioUrl(openingAudioUrl)
            .build();
    }

    /**
     * 处理一轮语音交互（核心方法）
     *
     * 处理链路：音频存储 → ASR → 发音评估 → 构造Prompt → 大模型 → TTS → 持久化
     */
    @Transactional
    public TurnResultDTO processAudioTurn(Long sessionId, AudioUploadRequest request) {
        OralPracticeSession session = getActiveSession(sessionId);

        // 1. 存储音频到对象存储
        String audioUrl = ossClient.upload(
            "oral/" + sessionId + "/turn_" + request.getTurnIndex() + ".wav",
            request.getAudioData()
        );

        // 2. ASR 识别（带词级时间戳）
        AsrResult asrResult = asrClient.recognizeWithTimestamps(
            request.getAudioData(), request.getAudioFormat(), "en-US"
        );

        // 3. 发音评估（需要参考文本时传入，自由对话时基于ASR结果）
        PronunciationEvalResult evalResult = scoringClient.evaluate(
            request.getAudioData(),
            asrResult.getText(),  // ASR文本作为参考
            request.getAudioFormat(),
            EvalGranularity.WORD  // 单词级粒度
        );

        // 4. 构造对话上下文，调用AI生成回复
        DialogueContext context = dialogueEngine.buildContext(session, asrResult, evalResult);
        AiDialogueResponse aiResponse = dialogueEngine.generateResponse(context);

        // 5. TTS 合成AI回复
        String aiAudioUrl = ttsClient.synthesize(
            aiResponse.getResponseEn(), "en-US",
            determineVoice(session), determineSpeed(session)
        );

        // 6. 持久化轮次记录
        OralConversationTurn turn = new OralConversationTurn();
        turn.setSessionId(sessionId);
        turn.setTurnIndex(request.getTurnIndex());
        turn.setSpeaker("user");
        turn.setAudioUrl(audioUrl);
        turn.setAsrText(asrResult.getText());
        turn.setAsrConfidence(asrResult.getConfidence());
        turn.setPronunciationScore(evalResult.getPronunciationScore());
        // ... 填充其他字段
        turnMapper.insert(turn);

        // 更新会话统计
        session.setTurnCount(session.getTurnCount() + 1);
        sessionMapper.updateById(session);

        // 7. 异步：记录发音错误、更新薄弱项
        asyncTaskExecutor.execute(() -> {
            pronunciationErrorService.recordErrors(sessionId, turn.getId(), evalResult);
            profileService.updateWeakPhonemes(session.getUserId(), evalResult);
        });

        return TurnResultDTO.builder()
            .turnIndex(request.getTurnIndex())
            .asrResult(mapAsr(asrResult))
            .pronunciationEval(mapEval(evalResult))
            .aiResponse(mapAiResponse(aiResponse, aiAudioUrl))
            .correctionTip(aiResponse.getCorrectionTip())
            .remainingTurns(session.getMaxTurns() - session.getTurnCount())
            .build();
    }
}
```

#### DialogueEngine（对话引擎）

```java
@Service
public class OralDialogueEngine {

    /**
     * 构造口语对话上下文
     */
    public DialogueContext buildContext(
        OralPracticeSession session,
        AsrResult asrResult,
        PronunciationEvalResult evalResult
    ) {
        List<OralConversationTurn> history = turnMapper
            .selectBySessionId(session.getId(), 10); // 最近10轮

        OralTopic topic = topicService.getById(session.getTopicId());
        UserOralProfile profile = profileService.getByUserId(session.getUserId());

        return DialogueContext.builder()
            .scenarioConfig(topic.getScenarioConfig())
            .conversationHistory(formatHistory(history))
            .userText(asrResult.getText())
            .pronunciationScore(evalResult.getPronunciationScore())
            .errorSummary(formatErrors(evalResult.getErrorPhonemes()))
            .cefrLevel(session.getCefrTarget())
            .recentIssues(profile.getWeakPhonemes())
            .turnIndex(session.getTurnCount() + 1)
            .maxTurns(topic.getScenarioConfig().getMaxTurns())
            .build();
    }

    /**
     * 生成AI回复
     */
    public AiDialogueResponse generateResponse(DialogueContext context) {
        // 渲染 Prompt 模板
        String systemPrompt = promptRenderer.render(
            "oral_practice_role_play", context.toMap()
        );
        String userPrompt = promptRenderer.render(
            "oral_practice_context", context.toMap()
        );

        // 调用大模型
        String rawResponse = aiClient.chat(
            AiRequest.builder()
                .model(selectModel(context.getCefrLevel()))
                .systemPrompt(systemPrompt)
                .userPrompt(userPrompt)
                .temperature(0.7)  // 口语对话需要一定灵活性
                .maxTokens(300)    // 控制回复长度
                .responseFormat("json")
                .timeout(5000)
                .build()
        );

        // 解析JSON响应
        return parseDialogueResponse(rawResponse);
    }

    /**
     * 根据CEFR等级选择模型
     * - A1-A2: 使用通用对话模型（成本较低）
     * - B1-B2: 使用更强的推理模型（理解更复杂表达）
     */
    private String selectModel(String cefrLevel) {
        return switch (cefrLevel) {
            case "A1", "A2" -> "gpt-4o-mini";
            case "B1", "B2" -> "gpt-4o";
            default -> "gpt-4o-mini";
        };
    }
}
```

#### EvaluationEngine（发音评估引擎）

```java
@Service
public class PronunciationEvaluationEngine {

    /**
     * 评估发音质量
     *
     * @param audioData    原始音频数据
     * @param referenceText 参考文本（ASR结果或预设文本）
     * @param format       音频格式
     * @param granularity  评估粒度
     */
    public PronunciationEvalResult evaluate(
        byte[] audioData,
        String referenceText,
        String format,
        EvalGranularity granularity
    ) {
        // 调用发音评分服务（外部ASR引擎通常自带评分能力）
        ScoringRequest scoringRequest = ScoringRequest.builder()
            .audio(audioData)
            .referenceText(referenceText)
            .format(format)
            .granularity(granularity.name().toLowerCase())
            .dimension(ScoringDimension.ALL) // pronunciation + fluency + completeness
            .build();

        ScoringResponse scoringResponse = scoringClient.score(scoringRequest);

        // 后处理：补充中文纠错建议
        List<PhonemeError> enrichedErrors = enrichErrorTips(
            scoringResponse.getPhonemeErrors()
        );

        // 聚合评分
        return PronunciationEvalResult.builder()
            .pronunciationScore(scoringResponse.getPronunciationScore())
            .fluencyScore(scoringResponse.getFluencyScore())
            .completenessScore(scoringResponse.getCompletenessScore())
            .phonemeDetail(scoringResponse.getPhonemeDetail())
            .wordScores(scoringResponse.getWordScores())
            .errorPhonemes(enrichedErrors)
            .build();
    }

    /**
     * 为发音错误补充中文纠错建议
     * 基于预设的音素纠错知识库
     */
    private List<PhonemeError> enrichErrorTips(List<PhonemeError> errors) {
        return errors.stream().map(error -> {
            PhonemeCorrectionTip tip = correctionTipRepository
                .findByPhoneme(error.getTargetPhoneme());
            if (tip != null) {
                error.setCorrectionTip(tip.getTipZh());
                error.setSimilarSoundZh(tip.getSimilarSoundZh());
                error.setPracticeWords(tip.getPracticeWords());
            }
            return error;
        }).collect(Collectors.toList());
    }
}
```

### 6.3 ProfileService（口语能力建模）

```java
@Service
public class OralProfileService {

    private static final double SCORE_DECAY = 0.3;  // 历史权重衰减因子
    private static final int RECENT_SESSIONS = 5;    // 取最近N次会话

    /**
     * 更新用户口语能力档案
     * - 加权滑动平均更新各维度评分
     * - 更新薄弱音素列表
     * - 更新CEFR估算
     * - 更新30天趋势数据
     */
    @Transactional
    public void updateProfile(Long userId, OralPracticeSession completedSession) {
        UserOralProfile profile = getOrCreate(userId);

        // 加权滑动平均
        double weight = 1.0 - SCORE_DECAY;
        profile.setPronunciationAvg(applyDecay(
            profile.getPronunciationAvg(),
            completedSession.getPronunciationScore(),
            weight
        ));
        profile.setFluencyAvg(applyDecay(
            profile.getFluencyAvg(),
            completedSession.getFluencyScore(),
            weight
        ));
        // ... 其他维度

        // 更新统计数据
        profile.setTotalSessions(profile.getTotalSessions() + 1);
        profile.setTotalSpeakingSec(
            profile.getTotalSpeakingSec() + completedSession.getTotalSpeakingSec()
        );
        profile.setLastSessionId(completedSession.getId());
        profile.setLastPracticeAt(LocalDateTime.now());

        // CEFR 估算
        profile.setCefrEstimated(estimateCefr(profile));
        profile.setCefrLastUpdated(LocalDateTime.now());

        // 更新趋势数据
        updateScoreTrend(profile, completedSession);

        profileMapper.updateById(profile);

        // 发送学情事件
        eventPublisher.publishEvent(new OralProfileUpdatedEvent(userId, profile));
    }

    /**
     * 根据综合能力估算 CEFR 等级
     */
    private String estimateCefr(UserOralProfile profile) {
        double composite = profile.getPronunciationAvg() * 0.3
                         + profile.getFluencyAvg() * 0.25
                         + profile.getGrammarAvg() * 0.2
                         + profile.getVocabularyAvg() * 0.15
                         + profile.getInteractionAvg() * 0.1;

        if (composite >= 85) return "B2";
        if (composite >= 70) return "B1";
        if (composite >= 55) return "A2";
        return "A1";
    }

    private double applyDecay(double historical, double current, double weight) {
        return historical * SCORE_DECAY + current * weight;
    }
}
```

---

## 7. 额度与限流设计

### 7.1 口语练习额度规则

| 用户类型 | 每日口语练习次数 | 单次最长时长 | 并发会话数 |
---------|---------------|------------|----------|
| 免费用户 | 3 次/天 | 3 分钟 | 1 |
| 月度会员 | 20 次/天 | 10 分钟 | 1 |
| 年度会员 | 不限 | 15 分钟 | 2 |
| 专项会员 | 不限 | 20 分钟 | 2 |

### 7.2 限流策略

```java
@Component
public class OralRateLimiter {

    /**
     * 频次限流：基于 Redis 滑动窗口
     * Key: oral:rate:{userId}:{date}
     */
    public boolean checkDailyLimit(Long userId, MembershipType membership) {
        String key = "oral:rate:" + userId + ":" + LocalDate.now();
        int maxCount = getDailyLimit(membership);

        Long current = redisTemplate.opsForValue().increment(key);
        if (current == 1) {
            redisTemplate.expire(key, Duration.ofDays(1));
        }
        return current <= maxCount;
    }

    /**
     * 并发限流：防止同一用户同时进行多个口语会话
     * Key: oral:active:{userId}
     */
    public boolean checkConcurrency(Long userId, MembershipType membership) {
        String key = "oral:active:" + userId;
        int maxConcurrent = getMaxConcurrent(membership);

        Long active = redisTemplate.opsForValue().increment(key);
        // TTL 设为会话最大时长的2倍，防止泄漏
        redisTemplate.expire(key, Duration.ofMinutes(40));
        return active <= maxConcurrent;
    }
}
```

---

## 8. 错误处理与降级策略

### 8.1 错误码体系

| 错误码 | HTTP状态码 | 说明 | 处理策略 |
|-------|-----------|------|---------|
| ORAL_001 | 400 | 音频格式不支持 | 提示用户支持的格式 |
| ORAL_002 | 400 | 音频时长超限（>60s） | 提示缩短录音 |
| ORAL_003 | 400 | 音频过短（<0.5s） | 提示重新录音 |
| ORAL_004 | 429 | 每日口语练习次数已达上限 | 引导升级会员 |
| ORAL_005 | 409 | 存在并发会话 | 提示结束当前会话 |
| ORAL_006 | 404 | 会话不存在或已结束 | 引导创建新会话 |
| ORAL_007 | 422 | 话题不适用于当前学段 | 推荐适合的话题 |
| ORAL_010 | 503 | ASR 服务不可用 | 降级为纯文本对话模式 |
| ORAL_011 | 503 | 发音评估服务不可用 | 跳过评分，仅返回ASR+AI回复 |
| ORAL_012 | 503 | TTS 服务不可用 | 仅返回文本回复 |
| ORAL_013 | 504 | 大模型调用超时 | 重试1次，仍超时则返回预设回复 |
| ORAL_014 | 500 | ASR 识别置信度过低（<0.3） | 提示用户重新说一遍 |

### 8.2 降级链路

```
正常链路: 音频 → ASR → 发音评估 → AI对话 → TTS → 完整响应

降级1 (评分服务挂): 音频 → ASR → AI对话 → TTS → 响应(无发音评分)
降级2 (TTS挂):     音频 → ASR → 发音评估 → AI对话 → 响应(仅文本)
降级3 (ASR挂):     切换到文本输入模式，用户手动输入英语句子
降级4 (大模型挂):  返回预设回复 + 发音评分仍正常
降级5 (全部挂):    返回 ORAL_010，提示稍后重试
```

```java
@Service
public class OralDegradationHandler {

    public TurnResultDTO processWithDegradation(Long sessionId, AudioUploadRequest request) {
        OralPracticeSession session = sessionManager.getActiveSession(sessionId);
        TurnResultDTO.TurnResultDTOBuilder resultBuilder = TurnResultDTO.builder();
        resultBuilder.turnIndex(request.getTurnIndex());

        // Step 1: ASR（必须成功）
        AsrResult asrResult;
        try {
            asrResult = asrClient.recognizeWithTimestamps(
                request.getAudioData(), request.getAudioFormat(), "en-US"
            );
        } catch (ServiceUnavailableException e) {
            // 降级：切换为文本模式
            throw new OralException(ORAL_010, "语音识别暂时不可用，请切换到文本输入模式");
        }
        resultBuilder.asrResult(mapAsr(asrResult));

        // Step 2: 发音评估（可降级）
        PronunciationEvalResult evalResult = null;
        try {
            evalResult = evaluationEngine.evaluate(
                request.getAudioData(), asrResult.getText(),
                request.getAudioFormat(), EvalGranularity.WORD
            );
            resultBuilder.pronunciationEval(mapEval(evalResult));
        } catch (ServiceUnavailableException e) {
            log.warn("Pronunciation scoring unavailable for session {}, degrading", sessionId);
            // 跳过评分，继续对话
        }

        // Step 3: AI对话（可降级）
        String aiText;
        String aiTextZh = "";
        String correctionTip = "";
        try {
            DialogueContext ctx = dialogueEngine.buildContext(session, asrResult, evalResult);
            AiDialogueResponse aiResp = dialogueEngine.generateResponse(ctx);
            aiText = aiResp.getResponseEn();
            aiTextZh = aiResp.getResponseZh();
            correctionTip = aiResp.getCorrectionTip();
        } catch (Exception e) {
            log.error("AI dialogue failed for session {}", sessionId, e);
            aiText = getFallbackResponse(session);
        }

        // Step 4: TTS（可降级）
        String aiAudioUrl = null;
        try {
            aiAudioUrl = ttsClient.synthesize(aiText, "en-US", "female", "standard");
        } catch (ServiceUnavailableException e) {
            log.warn("TTS unavailable, returning text-only response");
        }

        resultBuilder.aiResponse(AiResponseDTO.builder()
            .text(aiText)
            .textZh(aiTextZh)
            .audioUrl(aiAudioUrl)
            .build());
        resultBuilder.correctionTip(correctionTip);

        return resultBuilder.build();
    }
}
```

---

## 9. 缓存设计

### 9.1 缓存策略

| 缓存项 | Key 格式 | TTL | 说明 |
|-------|---------|-----|------|
| 话题详情 | `oral:topic:{id}` | 1 小时 | 话题配置较稳定 |
| 用户口语档案 | `oral:profile:{userId}` | 10 分钟 | 练习中频繁读取 |
| 会话活跃状态 | `oral:session:active:{sessionId}` | 会话时长+5分钟 | 快速校验会话有效性 |
| 每日练习次数 | `oral:rate:{userId}:{date}` | 至当日 23:59 | 频次限流 |
| 并发会话数 | `oral:active:{userId}` | 40 分钟 | 并发控制 |
| 话题列表 | `oral:topics:{cefr}:{page}` | 30 分钟 | 分页缓存 |
| 音素纠错知识库 | `oral:phoneme:tip:{phoneme}` | 24 小时 | 静态数据 |

### 9.2 缓存更新策略

- **话题/音素纠错库**：Cache-Aside，后台修改时主动失效
- **用户档案**：Write-Through，更新数据库时同步更新缓存
- **会话状态**：Write-Behind，Redis 作为主存储，异步持久化到 DB

---

## 10. 异步处理与事件设计

### 10.1 异步任务

| 任务 | 触发时机 | 处理内容 | 优先级 |
|------|---------|---------|--------|
| 发音错误记录 | 每轮对话后 | 解析并存储音素错误到 pronunciation_error_log | 普通 |
| 薄弱音素更新 | 每轮对话后 | 更新 user_oral_profile.weak_phonemes | 普通 |
| 能力档案更新 | 会话结束后 | 加权滑动平均更新各维度评分 | 普通 |
| 练习报告生成 | 会话结束后 | 调用AI生成综合练习报告 | 普通 |
| 学情事件推送 | 会话结束后 | 推送 OralProfileUpdatedEvent 到学情系统 | 高 |
| TTS预合成 | 话题创建/修改时 | 预合成话题开场白音频 | 低 |

### 10.2 领域事件

```java
// 口语练习完成事件
public class OralSessionCompletedEvent {
    private Long userId;
    private Long sessionId;
    private double overallScore;
    private double pronunciationScore;
    private double fluencyScore;
    private int durationSeconds;
    private int turnCount;
    private String cefrEstimate;
}

// 发音错误事件
public class PronunciationErrorDetectedEvent {
    private Long userId;
    private Long sessionId;
    private String targetPhoneme;
    private String actualPhoneme;
    private double severity;
}
```

---

## 11. 性能与延迟目标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 单轮端到端延迟 | ≤ 4s | 从音频上传到AI音频返回 |
| ASR 识别延迟 | ≤ 1.5s | 含音频传输 |
| 发音评估延迟 | ≤ 1s | 音素级评分 |
| AI 对话生成延迟 | ≤ 2s | 含 Prompt 构造 |
| TTS 合成延迟 | ≤ 1s | 短句合成 |
| 并发口语会话 | 500/s | MVP 阶段 |

**延迟优化策略：**

1. **流水线并行**：ASR 和发音评估可部分并行（ASR 出文本后立即启动评估，ASR 出时间戳后再补充细粒度评分）
2. **TTS 流式推送**：AI 回复生成后立即分句 TTS，不等待全部合成完成
3. **开场白预合成**：创建会话时即预合成开场白音频
4. **常用话题音频缓存**：高频话题的 AI 角色台词可预缓存

---

## 12. 监控指标

### 12.1 业务指标

| 指标 | 采集方式 | 告警阈值 |
|------|---------|---------|
| 日活口语练习用户数 | 聚合统计 | 日环比下降 > 20% |
| 平均单次练习时长 | 聚合统计 | — |
| 平均轮次完成率 | 聚合统计 | < 50% |
| 平均发音评分 | 聚合统计 | — |
| ASR 低置信度比例 | 实时统计 | > 15% |

### 12.2 技术指标

| 指标 | 采集方式 | 告警阈值 |
|------|---------|---------|
| 端到端延迟 P95 | Metrics | > 6s |
| ASR 调用成功率 | Metrics | < 99% |
| 发音评估调用成功率 | Metrics | < 99% |
| AI 模型调用成功率 | Metrics | < 98% |
| TTS 合成成功率 | Metrics | < 99% |
| 降级触发次数 | Metrics | 单小时 > 10 次 |
| 音频上传失败率 | Metrics | > 2% |

---

## 13. 数据安全与隐私

| 数据项 | 保护措施 |
|-------|---------|
| 用户录音音频 | 加密存储于 OSS，30天后自动清理；仅用户本人和关联家长可访问 |
| ASR识别文本 | 会话结束后90天归档，1年自动删除 |
| 发音评估数据 | 脱敏后可用于模型优化，需剔除用户身份信息 |
| 口语能力档案 | 归属于用户个人数据，支持导出和删除 |
| 未成年人语音 | 额外遵守儿童隐私保护法规，家长可随时删除 |

---

## 14. 后续演进方向

| 阶段 | 能力 |
|------|------|
| V1.0 | 基础情景对话 + 发音评估 + 单词级纠错 |
| V1.5 | 多轮上下文优化 + 口语能力建模 + 个性化话题推荐 |
| V2.0 | 流式音频交互（WebSocket）+ 实时发音反馈 + 中高考口语模拟 |
| V3.0 | 端侧 ASR 预处理 + 离线口语练习 + 语音情感分析 |
