# 服务端-学生自主讲解智能评估与费曼学习法AI辅导引擎-详细设计

## 1. 概述

### 1.1 功能定位

费曼学习法（Feynman Technique）是公认最有效的学习方法之一：学生用自己的语言将所学知识"讲授"出来，通过发现讲解中的卡点、遗漏和逻辑断裂来深度检测理解程度。本引擎为 PrimeTop 平台提供**学生自主讲解的智能接收、语义理解、多维评估与反馈引导**能力，将传统的"被动做题检测"拓展为"主动输出评估"，补全学习闭环中最关键的**知识内化输出**环节。

### 1.2 核心价值

| 维度 | 传统做题检测 | 自主讲解评估 |
| --- | --- | --- |
| 认知层次 | 识别、应用（Bloom's 1-3层） | 分析、综合、评价（Bloom's 4-6层） |
| 检测深度 | 判断对错，无法发现"伪理解" | 暴露知识盲区、逻辑断裂和浅层记忆 |
| 学习方式 | 被动应答 | 主动构建知识表达 |
| 反馈维度 | 正确率、得分 | 概念覆盖度、逻辑连贯性、表达准确度、理解深度 |

### 1.3 适用场景

| 场景 | 触发方式 | 目标用户 |
| --- | --- | --- |
| 课后知识巩固 | 学完一章/一节后系统推荐 | 小学高年级至高中 |
| 考前自查 | 复习模式下主动发起 | 初中、高中 |
| 错题订正后验证 | 错题订正完成时弹窗引导 | 全学段（非幼儿） |
| AI辅导对话中延伸 | AI对话结束后"你来给我讲讲" | 小学高年级至高中 |
| 家长共学 | 家长端发起"今天学了什么" | 小学为主 |
| 学习报告增强 | 周报中展示讲解能力趋势 | 全学段 |

### 1.4 设计目标

1. **多模态输入**：支持文字输入和语音讲解，语音自动转文字
2. **智能语义评估**：不依赖关键词匹配，采用深度语义理解
3. **概念图谱比对**：将学生讲解与标准知识图谱进行结构化比对
4. **建设性反馈**：不评判"对错"，而是指出"哪些点讲得好""哪些点可以更深入"
5. **与知识追踪联动**：评估结果回写知识掌握度模型
6. **适龄适配**：根据学段调整评估标准和反馈语言风格

---

## 2. 系统架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        客户端 / BFF                              │
│   讲解输入(文字/语音) → 展示评估报告 → 引导补充讲解              │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP / SSE
┌──────────────────────────▼──────────────────────────────────────┐
│                      API 网关 / 鉴权                            │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│              自主讲解评估服务 (Explanation Service)              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ 会话管理  │ │ 输入预处理│ │ 评估编排  │ │ 反馈生成  │          │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘          │
│       │            │            │            │                  │
│  ┌────▼────────────▼────────────▼────────────▼─────┐          │
│  │            评估结果聚合与存储                      │          │
│  └──────────────────────────────────────────────────┘          │
└────┬──────────┬──────────────────────┬───────────┬─────────────┘
     │          │                      │           │
┌────▼────┐ ┌──▼──────────┐ ┌─────────▼──┐ ┌──────▼──────┐
│ ASR 服务 │ │ LLM 评估引擎│ │ 知识图谱服务│ │ 知识追踪服务 │
│(语音转写)│ │(语义分析)   │ │(标准概念提取)│ │(掌握度回写) │
└─────────┘ └─────────────┘ └────────────┘ └────────────┘
```

### 2.2 服务定位与边界

| 职责 | 归属 |
| --- | --- |
| 讲解会话生命周期管理 | **本服务** |
| 语音转文字（ASR） | 语音服务（已有） |
| 标准知识点概念图提取 | 知识图谱服务（已有） |
| 语义理解和评估推理 | 大模型 API（已有） |
| 评估反馈文案生成 | **本服务**编排，LLM 执行 |
| 知识掌握度更新 | 知识追踪服务（已有） |
| 讲解历史记录与趋势 | **本服务** |
| 客户端讲解录制 UI | 客户端（已有组件） |

### 2.3 与已有模块的关系

```
同步课堂学习 ──→ 学完章节 ──→ 触发"试着讲一讲"
                                    │
AI辅导对话 ──→ 对话结束 ──→ 触发"你来总结一下"
                                    │
错题订正 ──→ 订正完成 ──→ 触发"讲讲为什么错"
                                    │
                                    ▼
                    ┌─── 自主讲解评估引擎 ───┐
                    │                        │
                    ▼                        ▼
              知识追踪服务              学习报告服务
            (更新掌握度)            (展示讲解能力)
```

---

## 3. 数据结构定义

### 3.1 核心数据模型

#### 3.1.1 讲解会话表 `explanation_sessions`

```sql
CREATE TABLE explanation_sessions (
    id              BIGINT PRIMARY KEY,
    session_id      VARCHAR(64) NOT NULL UNIQUE COMMENT '会话唯一标识',
    user_id         BIGINT NOT NULL COMMENT '学生用户ID',
    subject_id      INT NOT NULL COMMENT '学科ID',
    knowledge_point_id BIGINT COMMENT '关联知识点ID',
    chapter_id      BIGINT COMMENT '关联章节ID',
    textbook_id     INT COMMENT '教材版本ID',
    
    -- 触发来源
    trigger_source  VARCHAR(32) NOT NULL COMMENT '触发来源: LESSON_REVIEW/EXAM_PREP/MISTAKE_REVIEW/AI_DIALOG/MANUAL/PARENT_STUDY',
    trigger_ref_id  BIGINT COMMENT '触发来源关联ID(如错题ID/对话ID)',
    
    -- 讲解内容
    input_type      VARCHAR(16) NOT NULL COMMENT '输入方式: TEXT/VOICE',
    raw_text        TEXT COMMENT '原始文字输入',
    audio_url       VARCHAR(512) COMMENT '语音文件URL',
    asr_text        TEXT COMMENT 'ASR转写结果',
    asr_confidence  DECIMAL(4,3) COMMENT 'ASR置信度',
    duration_seconds INT COMMENT '讲解时长(秒)',
    word_count      INT COMMENT '讲解字数',
    
    -- 评估上下文
    grade_level     INT NOT NULL COMMENT '学生年级',
    stage           VARCHAR(16) NOT NULL COMMENT '学段: PRIMARY/JUNIOR/SENIOR',
    target_concepts JSON COMMENT '本次讲解应覆盖的标准概念列表',
    
    -- 状态
    status          VARCHAR(24) NOT NULL DEFAULT 'PENDING' COMMENT '状态: PENDING/EVALUATING/COMPLETED/FAILED/TIMEOUT',
    
    -- 时间
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    completed_at    TIMESTAMP COMMENT '评估完成时间',
    
    INDEX idx_user_created (user_id, created_at),
    INDEX idx_kp (knowledge_point_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生自主讲解会话';
```

#### 3.1.2 讲解评估结果表 `explanation_evaluations`

```sql
CREATE TABLE explanation_evaluations (
    id                  BIGINT PRIMARY KEY,
    session_id          VARCHAR(64) NOT NULL COMMENT '关联会话ID',
    user_id             BIGINT NOT NULL,
    
    -- 总体评分
    overall_score       DECIMAL(5,2) NOT NULL COMMENT '总体理解度评分 0-100',
    comprehension_level VARCHAR(16) NOT NULL COMMENT '理解层级: SURFACE/PARTIAL/DEEP/EXPERT',
    
    -- 多维评分
    concept_coverage_score  DECIMAL(5,2) COMMENT '概念覆盖度 0-100',
    logic_coherence_score   DECIMAL(5,2) COMMENT '逻辑连贯性 0-100',
    accuracy_score          DECIMAL(5,2) COMMENT '表述准确度 0-100',
    depth_score             DECIMAL(5,2) COMMENT '理解深度 0-100',
    expression_score        DECIMAL(5,2) COMMENT '表达清晰度 0-100',
    
    -- 概念分析
    covered_concepts    JSON COMMENT '已覆盖概念列表 [{concept_id, concept_name, coverage_quality: FULL/PARTIAL/MENTIONED}]',
    missing_concepts    JSON COMMENT '遗漏的核心概念列表 [{concept_id, concept_name, importance: HIGH/MEDIUM/LOW}]',
    incorrect_concepts  JSON COMMENT '表述有误的概念列表 [{concept_id, concept_name, error_type, student_statement, correction}]',
    
    -- 逻辑分析
    logic_gaps          JSON COMMENT '逻辑断裂点 [{position, description, missing_link}]',
    logic_flow_score    DECIMAL(5,2) COMMENT '逻辑流畅度',
    
    -- AI反馈
    feedback_summary    TEXT COMMENT '总体反馈(100-200字, 适龄化表达)',
    feedback_strengths  JSON COMMENT '亮点列表 ["...", "..."]  (最多3条)',
    feedback_suggestions JSON COMMENT '改进建议列表 [{suggestion, target_concept_id, priority}]',
    
    -- 费曼卡点
    stuck_points        JSON COMMENT '讲解中暴露的卡点 [{position, type: HESITATION/CIRCULAR/VAGUE/INCORRECT, description}]',
    
    -- 后续行动
    recommended_action  VARCHAR(32) COMMENT '推荐下一步: RE_EXPLAIN/REVIEW_CONTENT/PRACTICE/ADVANCED/GOOD_ENOUGH',
    follow_up_content_ids JSON COMMENT '推荐复习内容ID列表',
    
    -- LLM元信息
    llm_model           VARCHAR(64) COMMENT '评估使用的模型',
    llm_tokens_used     INT COMMENT '消耗token数',
    evaluation_duration_ms INT COMMENT '评估耗时(毫秒)',
    
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE INDEX uk_session (session_id),
    INDEX idx_user (user_id),
    INDEX idx_comprehension (comprehension_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='讲解评估结果';
```

#### 3.1.3 讲解能力趋势表 `explanation_proficiency`

```sql
CREATE TABLE explanation_proficiency (
    id                  BIGINT PRIMARY KEY,
    user_id             BIGINT NOT NULL,
    subject_id          INT NOT NULL,
    
    -- 统计周期
    stat_period         VARCHAR(8) NOT NULL COMMENT '统计周期: YYYYWW(周) / YYYYMM(月)',
    period_type         VARCHAR(4) NOT NULL COMMENT 'WEEKLY/MONTHLY',
    
    -- 统计数据
    total_sessions      INT NOT NULL DEFAULT 0 COMMENT '总讲解次数',
    avg_overall_score   DECIMAL(5,2) COMMENT '平均总体评分',
    avg_coverage_score  DECIMAL(5,2) COMMENT '平均概念覆盖度',
    avg_logic_score     DECIMAL(5,2) COMMENT '平均逻辑连贯性',
    avg_depth_score     DECIMAL(5,2) COMMENT '平均理解深度',
    
    -- 能力等级
    proficiency_trend   VARCHAR(8) NOT NULL COMMENT '趋势: UP/STABLE/DOWN',
    current_level       VARCHAR(16) COMMENT '当前能力等级: NOVICE/DEVELOPING/PROFICIENT/ADVANCED',
    
    -- 高频问题
    frequent_gaps       JSON COMMENT '高频遗漏概念Top5',
    frequent_errors     JSON COMMENT '高频错误类型Top5',
    
    -- 对比
    prev_period_score   DECIMAL(5,2) COMMENT '上期评分',
    score_change        DECIMAL(5,2) COMMENT '评分变化',
    
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE INDEX uk_user_subject_period (user_id, subject_id, stat_period, period_type),
    INDEX idx_user_subject (user_id, subject_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生讲解能力趋势统计';
```

#### 3.1.4 标准概念模板表 `explanation_concept_templates`

```sql
CREATE TABLE explanation_concept_templates (
    id                  BIGINT PRIMARY KEY,
    knowledge_point_id  BIGINT NOT NULL COMMENT '知识点ID',
    subject_id          INT NOT NULL,
    
    -- 标准讲解要素
    core_concepts       JSON NOT NULL COMMENT '核心概念清单 [{concept_id, name, must_cover: true/false, description}]',
    key_relationships   JSON COMMENT '关键关系/因果链 [{from_concept, to_concept, relationship_type, description}]',
    common_examples     JSON COMMENT '典型示例 ["...", "..."]',
    common_misconceptions JSON COMMENT '常见误区 ["...", "..."]',
    
    -- 评估参数
    min_concept_coverage DECIMAL(4,3) NOT NULL DEFAULT 0.600 COMMENT '最低概念覆盖率(达标线)',
    target_coverage     DECIMAL(4,3) NOT NULL DEFAULT 0.800 COMMENT '优秀覆盖率',
    
    -- 适龄化参考
    stage_references    JSON COMMENT '分学段参考 {PRIMARY: {expected_depth, vocabulary_level}, JUNIOR: {...}, SENIOR: {...}}',
    
    -- 状态
    status              VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE/DRAFT/ARCHIVED',
    version             INT NOT NULL DEFAULT 1 COMMENT '版本号',
    
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE INDEX uk_kp_version (knowledge_point_id, version),
    INDEX idx_subject (subject_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='知识点标准讲解模板';
```

### 3.2 枚举定义

```java
// 触发来源
public enum ExplanationTrigger {
    LESSON_REVIEW("课后巩固", "学完章节后系统推荐"),
    EXAM_PREP("考前自查", "复习模式下主动发起"),
    MISTAKE_REVIEW("错题反思", "错题订正后引导"),
    AI_DIALOG("对话延伸", "AI辅导对话结束后"),
    MANUAL("主动练习", "学生自行发起"),
    PARENT_STUDY("亲子共学", "家长端发起");
}

// 输入方式
public enum InputType {
    TEXT,   // 文字输入
    VOICE   // 语音讲解
}

// 会话状态
public enum SessionStatus {
    PENDING,    // 待评估
    EVALUATING, // 评估中
    COMPLETED,  // 已完成
    FAILED,     // 评估失败
    TIMEOUT     // 评估超时
}

// 理解层级
public enum ComprehensionLevel {
    SURFACE("表层理解", "仅能复述概念名称，无法展开说明"),
    PARTIAL("部分理解", "覆盖部分核心概念，存在遗漏或模糊"),
    DEEP("深度理解", "核心概念覆盖完整，逻辑清晰，能举例"),
    EXPERT("精通理解", "理解透彻，能类比迁移，发现深层联系");
}

// 概念覆盖质量
public enum ConceptCoverage {
    FULL("完整覆盖", "概念被清晰、准确地阐述"),
    PARTIAL("部分覆盖", "概念被提及但阐述不充分"),
    MENTIONED("简单提及", "仅提到关键词但未展开"),
    MISSING("未覆盖", "核心概念完全未被提及"),
    INCORRECT("错误表述", "概念被提及但表述有误")
}

// 推荐下一步
public enum RecommendedAction {
    RE_EXPLAIN("重新讲解", "遗漏较多，建议复习后重新讲解"),
    REVIEW_CONTENT("复习内容", "存在理解偏差，建议重新学习相关内容"),
    PRACTICE("针对练习", "理解基本到位，建议通过练习巩固"),
    ADVANCED("进阶学习", "理解优秀，可以学习更深层次内容"),
    GOOD_ENOUGH("讲解优秀", "讲解质量很高，可继续学习下一主题")
}

// 费曼卡点类型
public enum StuckPointType {
    HESITATION("犹豫停顿", "讲解中出现长时间停顿或不确定表述"),
    CIRCULAR("循环论述", "用概念A解释概念B，又用概念B解释概念A"),
    VAGUE("模糊表述", "使用"就是""那个"等模糊词汇替代具体解释"),
    INCORRECT("错误表述", "概念理解有误，表述与正确定义矛盾")
}

// 能力等级
public enum ProficiencyLevel {
    NOVICE("初学者", "讲解能力待提升，常见于低年级或新学内容"),
    DEVELOPING("发展中", "能覆盖部分核心内容，需要更多练习"),
    PROFICIENT("熟练", "讲解完整清晰，理解到位"),
    ADVANCED("精通", "讲解深入且有洞察力，能迁移类比")
}
```

---

## 4. API 接口设计

### 4.1 创建讲解会话

```
POST /api/v1/explanation/sessions
```

**请求体：**
```json
{
  "subjectId": 2,
  "knowledgePointId": 10245,
  "chapterId": 387,
  "triggerSource": "LESSON_REVIEW",
  "triggerRefId": 56789,
  "inputType": "VOICE",
  "gradeLevel": 7,
  "stage": "JUNIOR"
}
```

**响应体：**
```json
{
  "code": 0,
  "data": {
    "sessionId": "EXP-20260801-001234",
    "knowledgePoint": {
      "id": 10245,
      "name": "一元二次方程的求根公式",
      "subject": "数学"
    },
    "guidancePrompt": "请用你自己的话讲一讲：什么是一元二次方程的求根公式？它是怎么来的？什么时候会用到它？",
    "conceptHints": ["判别式", "公式推导", "实数根条件"],
    "timeLimitSeconds": 180,
    "status": "PENDING"
  }
}
```

### 4.2 提交讲解内容

```
POST /api/v1/explanation/sessions/{sessionId}/submit
Content-Type: multipart/form-data
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| text | String | 否 | 文字输入（TEXT类型必填） |
| audio | File | 否 | 语音文件（VOICE类型必填） |
| durationSeconds | Integer | 是 | 讲解时长 |

**响应体（异步模式）：**
```json
{
  "code": 0,
  "data": {
    "sessionId": "EXP-20260801-001234",
    "status": "EVALUATING",
    "estimatedWaitSeconds": 8,
    "resultPollUrl": "/api/v1/explanation/sessions/EXP-20260801-001234/result"
  }
}
```

### 4.3 流式提交（SSE实时反馈）

```
POST /api/v1/explanation/sessions/{sessionId}/stream
Content-Type: application/json

{
  "text": "一元二次方程就是那种有x平方的方程...",
  "isFinal": true
}
```

**SSE 响应流：**
```
event: asr_progress
data: {"transcript": "一元二次方程就是那种有x平方的方程", "confidence": 0.95}

event: asr_progress
data: {"transcript": "一元二次方程就是那种有x平方的方程，求根公式是x等于负b加减根号下b方减4ac除以2a", "confidence": 0.93}

event: evaluation_start
data: {"sessionId": "EXP-20260801-001234"}

event: evaluation_progress
data: {"step": "CONCEPT_EXTRACTION", "message": "正在分析概念覆盖..."}

event: evaluation_progress
data: {"step": "LOGIC_ANALYSIS", "message": "正在评估逻辑连贯性..."}

event: evaluation_progress
data: {"step": "FEEDBACK_GENERATION", "message": "正在生成反馈..."}

event: evaluation_complete
data: {
  "overallScore": 72.5,
  "comprehensionLevel": "PARTIAL",
  "conceptCoverageScore": 75.0,
  "logicCoherenceScore": 68.0,
  "accuracyScore": 80.0,
  "depthScore": 60.0,
  "coveredConcepts": [...],
  "missingConcepts": [...],
  "feedbackSummary": "...",
  "recommendedAction": "PRACTICE"
}
```

### 4.4 获取评估结果

```
GET /api/v1/explanation/sessions/{sessionId}/result
```

**响应体：**
```json
{
  "code": 0,
  "data": {
    "sessionId": "EXP-20260801-001234",
    "status": "COMPLETED",
    "knowledgePoint": {
      "id": 10245,
      "name": "一元二次方程的求根公式"
    },
    "asrText": "一元二次方程就是那种有x平方的方程，求根公式是x等于负b加减根号下b方减4ac除以2a",
    "durationSeconds": 45,
    "wordCount": 42,
    "evaluation": {
      "overallScore": 72.5,
      "comprehensionLevel": "PARTIAL",
      "scores": {
        "conceptCoverage": 75.0,
        "logicCoherence": 68.0,
        "accuracy": 80.0,
        "depth": 60.0,
        "expression": 70.0
      },
      "coveredConcepts": [
        {
          "conceptId": "C001",
          "name": "求根公式表达式",
          "coverageQuality": "FULL"
        },
        {
          "conceptId": "C002",
          "name": "方程一般形式 ax²+bx+c=0",
          "coverageQuality": "MENTIONED"
        }
      ],
      "missingConcepts": [
        {
          "conceptId": "C003",
          "name": "判别式 Δ=b²-4ac 的作用",
          "importance": "HIGH"
        },
        {
          "conceptId": "C004",
          "name": "公式推导过程（配方法）",
          "importance": "MEDIUM"
        }
      ],
      "incorrectConcepts": [],
      "logicGaps": [
        {
          "position": "开头部分",
          "description": "直接给出了公式，但没有说明公式是怎么来的",
          "missingLink": "缺少从一般形式到求根公式的推导逻辑"
        }
      ],
      "stuckPoints": [
        {
          "position": "提到'x平方'时",
          "type": "VAGUE",
          "description": "用'有x平方的方程'描述，未说明标准形式"
        }
      ],
      "feedback": {
        "summary": "你准确地记住了求根公式，这很好！但如果能说清楚方程的标准形式、公式是怎么推导出来的，以及判别式的作用，你的讲解会更完整、更有深度。",
        "strengths": [
          "求根公式记忆准确，没有口误",
          "讲解简洁明了，没有跑题"
        ],
        "suggestions": [
          {
            "suggestion": "试着从配方法的角度讲讲公式是怎么推导出来的",
            "targetConceptId": "C004",
            "priority": "HIGH"
          },
          {
            "suggestion": "补充说明判别式 b²-4ac 如何判断根的情况",
            "targetConceptId": "C003",
            "priority": "HIGH"
          },
          {
            "suggestion": "用标准形式 ax²+bx+c=0 来描述一元二次方程，而不是'有x平方'",
            "targetConceptId": "C002",
            "priority": "MEDIUM"
          }
        ]
      },
      "recommendedAction": "PRACTICE",
      "followUpContentIds": [201, 202, 203]
    }
  }
}
```

### 4.5 获取讲解历史

```
GET /api/v1/explanation/history?subjectId=2&knowledgePointId=10245&page=1&size=10
```

**响应体：**
```json
{
  "code": 0,
  "data": {
    "total": 5,
    "records": [
      {
        "sessionId": "EXP-20260801-001234",
        "knowledgePointName": "一元二次方程的求根公式",
        "overallScore": 72.5,
        "comprehensionLevel": "PARTIAL",
        "createdAt": "2026-08-01T10:30:00Z",
        "durationSeconds": 45,
        "triggerSource": "LESSON_REVIEW"
      }
    ]
  }
}
```

### 4.6 获取讲解能力趋势

```
GET /api/v1/explanation/proficiency?subjectId=2&periodType=WEEKLY&periods=8
```

**响应体：**
```json
{
  "code": 0,
  "data": {
    "subjectName": "数学",
    "currentLevel": "DEVELOPING",
    "trend": "UP",
    "weeklyData": [
      {
        "period": "2026W27",
        "totalSessions": 3,
        "avgOverallScore": 58.3,
        "avgCoverageScore": 55.0,
        "avgDepthScore": 52.0
      },
      {
        "period": "2026W28",
        "totalSessions": 4,
        "avgOverallScore": 65.0,
        "avgCoverageScore": 62.5,
        "avgDepthScore": 60.0
      },
      {
        "period": "2026W31",
        "totalSessions": 5,
        "avgOverallScore": 72.5,
        "avgCoverageScore": 75.0,
        "avgDepthScore": 60.0
      }
    ],
    "frequentGaps": [
      {"conceptName": "判别式", "frequency": 4},
      {"conceptName": "配方法推导", "frequency": 3}
    ]
  }
}
```

### 4.7 重新讲解

```
POST /api/v1/explanation/sessions/{sessionId}/retry
```

基于上一次评估结果，创建新的讲解会话，自动引导补充遗漏内容。

### 4.8 获取讲解引导提示

```
GET /api/v1/explanation/guidance?knowledgePointId=10245&stage=JUNIOR
```

**响应体：**
```json
{
  "code": 0,
  "data": {
    "guidancePrompts": [
      "什么是一元二次方程？它的一般形式是什么？",
      "求根公式是什么？它是怎么推导出来的？",
      "判别式是什么？它有什么作用？",
      "举一个具体的例子，用求根公式解一个方程。"
    ],
    "conceptChecklist": [
      "一般形式 ax²+bx+c=0",
      "配方法推导过程",
      "求根公式 x=(-b±√(b²-4ac))/2a",
      "判别式 Δ=b²-4ac",
      "Δ>0 两个不等实根，Δ=0 两个相等实根，Δ<0 无实根"
    ],
    "timeSuggestion": "建议讲解时长 2-3 分钟"
  }
}
```

---

## 5. 核心评估管线设计

### 5.1 评估管线总览

```
讲解内容输入
     │
     ▼
┌─────────────┐
│ 1. 输入预处理 │ ─── ASR纠错、分段、清洗
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ 2. 概念提取  │ ─── 从讲解文本中提取涉及的知识概念
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ 3. 概念覆盖比对  │ ─── 与标准概念模板比对，计算覆盖度
└──────┬──────────┘
       │
       ▼
┌─────────────┐
│ 4. 逻辑分析  │ ─── 分析讲解的逻辑链条和因果推理
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ 5. 准确性校验│ ─── 检测表述错误和概念混淆
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ 6. 深度评估  │ ─── 评估理解深度（举例/类比/迁移）
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ 7. 卡点检测     │ ─── 识别犹豫、循环、模糊等费曼卡点
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ 8. 反馈生成     │ ─── 生成适龄化、建设性反馈文案
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ 9. 结果聚合与存储│ ─── 写入评估结果、更新掌握度
└─────────────────┘
```

### 5.2 输入预处理

```python
class ExplanationPreprocessor:
    """讲解输入预处理"""
    
    def preprocess(self, raw_input: ExplanationInput) -> PreprocessedText:
        # 1. 如果是语音输入，先ASR转写
        if raw_input.input_type == InputType.VOICE:
            asr_result = self.asr_service.transcribe(
                audio_url=raw_input.audio_url,
                language="zh-CN",
                enable_punctuation=True,
                model="edu-enhanced"  # 教育场景增强模型
            )
            text = asr_result.text
            confidence = asr_result.confidence
            
            # ASR置信度过低，标记需要人工关注
            if confidence < 0.75:
                logger.warning(f"Low ASR confidence: {confidence}", 
                              extra={"session_id": raw_input.session_id})
        else:
            text = raw_input.text
            confidence = 1.0
        
        # 2. 文本清洗
        text = self._clean_text(text)
        
        # 3. 语义分段（按讲解的逻辑段落）
        segments = self._segment_by_semantic(text)
        
        # 4. 计算基础指标
        word_count = len(text)
        speaking_rate = word_count / (raw_input.duration_seconds or 1)  # 字/秒
        
        # 5. 语速异常检测
        rate_anomaly = self._detect_speaking_rate_anomaly(
            speaking_rate, raw_input.grade_level)
        
        return PreprocessedText(
            clean_text=text,
            segments=segments,
            asr_confidence=confidence,
            word_count=word_count,
            speaking_rate=speaking_rate,
            rate_anomaly=rate_anomaly
        )
    
    def _segment_by_semantic(self, text: str) -> List[TextSegment]:
        """基于语义的讲解分段"""
        prompt = f"""请将以下学生讲解内容按语义段落分段，每段标注主题：
        
讲解内容：{text}

输出JSON格式：
[{{"segment_text": "...", "topic": "概念定义|公式推导|举例说明|...", "order": 1}}]
"""
        result = self.llm_service.parse(prompt, response_format="json")
        return [TextSegment(**s) for s in result]
```

### 5.3 概念提取与覆盖比对

```python
class ConceptExtractor:
    """从学生讲解中提取知识概念"""
    
    def extract_concepts(self, text: str, kp_id: int, stage: str) -> List[ExtractedConcept]:
        # 获取标准概念模板
        template = self.template_service.get_concept_template(kp_id)
        
        prompt = self._build_extraction_prompt(text, template, stage)
        result = self.llm_service.parse(prompt, response_format="json")
        
        concepts = []
        for item in result:
            # 匹配到标准概念
            matched = self._match_standard_concept(
                item["concept_text"], 
                template.core_concepts
            )
            
            concepts.append(ExtractedConcept(
                student_text=item["concept_text"],
                matched_concept_id=matched.concept_id if matched else None,
                matched_concept_name=matched.name if matched else item["concept_text"],
                coverage_quality=self._assess_coverage(
                    item["concept_text"], 
                    item.get("elaboration_level", "mention"),
                    matched
                ),
                position=item.get("position", 0)
            ))
        
        return concepts
    
    def _build_extraction_prompt(self, text, template, stage):
        stage_desc = {
            "PRIMARY": "小学阶段，语言简单",
            "JUNIOR": "初中阶段，适度专业",
            "SENIOR": "高中阶段，专业准确"
        }.get(stage, "")
        
        return f"""分析以下学生讲解中涉及的知识概念。

标准知识点：{template.knowledge_point_name}
应覆盖的核心概念：
{json.dumps([c.dict() for c in template.core_concepts], ensure_ascii=False)}

学生讲解：
"{text}"

请提取学生讲解中涉及的每个知识概念，判断：
1. 对应哪个标准概念（如果有）
2. 覆盖质量：FULL（完整准确阐述）/ PARTIAL（提到但不充分）/ MENTIONED（仅关键词）/ INCORRECT（表述有误）
3. 在讲解中的位置

{stage_desc}

输出JSON列表：
[{{"concept_text": "学生原文中的表述", "standard_concept_id": "C001 或 null", "coverage_quality": "FULL|PARTIAL|MENTIONED|INCORRECT", "position": 段落序号}}]
"""


class CoverageCalculator:
    """计算概念覆盖度"""
    
    def calculate(self, extracted: List[ExtractedConcept], 
                  template: ConceptTemplate) -> CoverageResult:
        total_concepts = len(template.core_concepts)
        must_cover = [c for c in template.core_concepts if c.must_cover]
        
        # 统计覆盖情况
        fully_covered = [c for c in extracted if c.coverage_quality == ConceptCoverage.FULL]
        partially_covered = [c for c in extracted if c.coverage_quality == ConceptCoverage.PARTIAL]
        mentioned = [c for c in extracted if c.coverage_quality == ConceptCoverage.MENTIONED]
        incorrect = [c for c in extracted if c.coverage_quality == ConceptCoverage.INCORRECT]
        
        # 计算覆盖分数
        full_weight = 1.0
        partial_weight = 0.5
        mention_weight = 0.2
        
        weighted_coverage = (
            len(fully_covered) * full_weight +
            len(partially_covered) * partial_weight +
            len(mentioned) * mention_weight
        )
        
        coverage_score = min(100, (weighted_coverage / len(must_cover)) * 100) if must_cover else 0
        
        # 未覆盖的概念
        covered_ids = {c.matched_concept_id for c in extracted if c.matched_concept_id}
        missing = [
            c for c in template.core_concepts 
            if c.concept_id not in covered_ids and c.must_cover
        ]
        
        return CoverageResult(
            score=coverage_score,
            fully_covered=fully_covered,
            partially_covered=partially_covered,
            mentioned=mentioned,
            incorrect=incorrect,
            missing=missing,
            coverage_ratio=weighted_coverage / max(len(must_cover), 1)
        )
```

### 5.4 逻辑分析引擎

```python
class LogicAnalyzer:
    """分析讲解的逻辑连贯性"""
    
    def analyze(self, segments: List[TextSegment], 
                template: ConceptTemplate) -> LogicResult:
        
        prompt = f"""分析以下学生讲解的逻辑结构。

讲解分段：
{json.dumps([{"order": s.order, "text": s.segment_text, "topic": s.topic} for s in segments], ensure_ascii=False)}

该知识点应包含的逻辑链条：
{json.dumps([r.dict() for r in template.key_relationships], ensure_ascii=False)}

请评估：
1. 讲解的逻辑流程是否连贯（概念A→推导→结论B 的链条是否完整）
2. 是否存在逻辑断裂（跳过关键推理步骤）
3. 是否存在循环论证（用A解释B，又用B解释A）
4. 因果关系是否正确

对每个逻辑断裂点，说明：
- 在什么位置
- 缺少了什么逻辑环节
- 这个断裂的严重程度（HIGH/MEDIUM/LOW）

输出JSON：
{{
  "logic_flow_score": 0-100,
  "gaps": [{{"position": "...", "missing_link": "...", "severity": "HIGH"}}],
  "circular_reasoning": [{{"concepts": ["A", "B"], "description": "..."}}],
  "flow_description": "描述学生的讲解思路"
}}
"""
        result = self.llm_service.parse(prompt, response_format="json")
        return LogicResult(**result)
```

### 5.5 卡点检测器

```python
class StuckPointDetector:
    """费曼卡点检测 - 识别学生讲解中的理解薄弱信号"""
    
    def detect(self, text: str, segments: List[TextSegment], 
               asr_timestamps: Optional[List] = None) -> List[StuckPoint]:
        stuck_points = []
        
        # 1. 模糊表述检测
        vague_patterns = self._detect_vague_expressions(text)
        stuck_points.extend(vague_patterns)
        
        # 2. 循环论证检测
        circular = self._detect_circular_reasoning(segments)
        stuck_points.extend(circular)
        
        # 3. 犹豫停顿检测（语音）
        if asr_timestamps:
            hesitations = self._detect_hesitations(asr_timestamps)
            stuck_points.extend(hesitations)
        
        # 4. AI深度检测
        deep_stuck = self._detect_with_llm(text, segments)
        stuck_points.extend(deep_stuck)
        
        # 去重和排序
        return self._deduplicate_and_rank(stuck_points)
    
    def _detect_vague_expressions(self, text: str) -> List[StuckPoint]:
        """检测模糊表述"""
        vague_indicators = [
            r"就是.{0,4}那样",
            r"就是.{0,4}那种",
            r"反正就是",
            r"那个什么",
            r"怎么说呢",
            r"差不多就是",
            r"总之就是",
            r"\.\.\.\.\.",  # 省略号
        ]
        
        results = []
        for pattern in vague_indicators:
            matches = re.finditer(pattern, text)
            for match in matches:
                # 提取上下文
                start = max(0, match.start() - 20)
                end = min(len(text), match.end() + 20)
                context = text[start:end]
                
                results.append(StuckPoint(
                    position=context,
                    type=StuckPointType.VAGUE,
                    description=f"使用模糊表述：'{match.group()}'，未能准确表达概念"
                ))
        
        return results
    
    def _detect_circular_reasoning(self, segments: List[TextSegment]) -> List[StuckPoint]:
        """检测循环论证"""
        prompt = f"""分析以下讲解分段，检测是否存在循环论证。
        
讲解分段：
{json.dumps([{"order": s.order, "text": s.segment_text} for s in segments], ensure_ascii=False)}

循环论证是指：用概念A来解释概念B，同时又用概念B来解释概念A，实际上没有解释任何一个概念。

输出JSON：
[{{"concepts": ["概念A", "概念B"], "position": "...", "description": "..."}}]
如果没有循环论证，返回空数组 []。
"""
        result = self.llm_service.parse(prompt, response_format="json")
        return [
            StuckPoint(
                position=item["position"],
                type=StuckPointType.CIRCULAR,
                description=item["description"]
            )
            for item in result
        ]
    
    def _detect_hesitations(self, asr_timestamps: List) -> List[StuckPoint]:
        """检测语音犹豫停顿"""
        results = []
        for i in range(1, len(asr_timestamps)):
            gap = asr_timestamps[i]["start"] - asr_timestamps[i-1]["end"]
            if gap > 3.0:  # 超过3秒的停顿
                context = asr_timestamps[i-1]["text"][-20:] + " [停顿%.1f秒] " % gap + asr_timestamps[i]["text"][:20]
                results.append(StuckPoint(
                    position=context,
                    type=StuckPointType.HESITATION,
                    description=f"讲解中出现{gap:.1f}秒停顿，可能对该概念不确定"
                ))
        return results
```

### 5.6 综合评分引擎

```python
class ScoreAggregator:
    """综合评分计算"""
    
    # 各维度权重（按学段调整）
    WEIGHTS = {
        "PRIMARY": {
            "concept_coverage": 0.30,
            "logic_coherence": 0.15,
            "accuracy": 0.30,
            "depth": 0.10,
            "expression": 0.15
        },
        "JUNIOR": {
            "concept_coverage": 0.25,
            "logic_coherence": 0.25,
            "accuracy": 0.25,
            "depth": 0.15,
            "expression": 0.10
        },
        "SENIOR": {
            "concept_coverage": 0.20,
            "logic_coherence": 0.30,
            "accuracy": 0.20,
            "depth": 0.25,
            "expression": 0.05
        }
    }
    
    def aggregate(self, coverage: CoverageResult, logic: LogicResult,
                  accuracy_score: float, depth_score: float,
                  expression_score: float, stage: str) -> AggregatedScore:
        
        weights = self.WEIGHTS.get(stage, self.WEIGHTS["JUNIOR"])
        
        overall = (
            coverage.score * weights["concept_coverage"] +
            logic.logic_flow_score * weights["logic_coherence"] +
            accuracy_score * weights["accuracy"] +
            depth_score * weights["depth"] +
            expression_score * weights["expression"]
        )
        
        # 理解层级判定
        level = self._determine_level(overall, coverage, logic, depth_score)
        
        return AggregatedScore(
            overall_score=round(overall, 1),
            comprehension_level=level,
            scores={
                "concept_coverage": round(coverage.score, 1),
                "logic_coherence": round(logic.logic_flow_score, 1),
                "accuracy": round(accuracy_score, 1),
                "depth": round(depth_score, 1),
                "expression": round(expression_score, 1)
            }
        )
    
    def _determine_level(self, overall, coverage, logic, depth) -> ComprehensionLevel:
        # 存在严重错误，直接降级
        if coverage.has_critical_errors:
            return ComprehensionLevel.SURFACE
        
        if overall >= 85 and coverage.coverage_ratio >= 0.8 and depth >= 75:
            return ComprehensionLevel.EXPERT
        elif overall >= 70 and coverage.coverage_ratio >= 0.6:
            return ComprehensionLevel.DEEP
        elif overall >= 50:
            return ComprehensionLevel.PARTIAL
        else:
            return ComprehensionLevel.SURFACE
```

### 5.7 反馈生成引擎

```python
class FeedbackGenerator:
    """生成适龄化、建设性反馈"""
    
    def generate(self, evaluation: EvaluationContext, 
                 student_profile: StudentProfile) -> Feedback:
        
        # 根据学段调整反馈风格
        style = self._get_feedback_style(student_profile.stage)
        
        prompt = self._build_feedback_prompt(evaluation, student_profile, style)
        result = self.llm_service.generate(prompt, temperature=0.7)
        
        return Feedback(
            summary=result["summary"],
            strengths=result["strengths"][:3],  # 最多3条亮点
            suggestions=self._prioritize_suggestions(result["suggestions"]),
        )
    
    def _get_feedback_style(self, stage: str) -> FeedbackStyle:
        styles = {
            "PRIMARY": FeedbackStyle(
                tone="亲切鼓励",
                max_summary_length=100,
                vocab_level="简单",
                example_hint="用生活中的例子来打比方",
                praise_threshold=60  # 60分以上就大力表扬
            ),
            "JUNIOR": FeedbackStyle(
                tone="清晰务实",
                max_summary_length=150,
                vocab_level="适中",
                example_hint="结合课堂知识展开",
                praise_threshold=70
            ),
            "SENIOR": FeedbackStyle(
                tone="专业精炼",
                max_summary_length=200,
                vocab_level="学科专业",
                example_hint="用学科语言精确表达",
                praise_threshold=75
            )
        }
        return styles.get(stage, styles["JUNIOR"])
    
    def _build_feedback_prompt(self, eval_ctx, profile, style):
        return f"""你是一位有经验的教育导师，正在给一位{profile.grade_name}学生提供讲解反馈。

学生讲解的知识点：{eval_ctx.knowledge_point_name}
学生讲解内容："{eval_ctx.student_text}"

评估结果：
- 总分：{eval_ctx.overall_score}/100
- 概念覆盖：{eval_ctx.coverage_score}/100
- 逻辑连贯：{eval_ctx.logic_score}/100
- 表述准确：{eval_ctx.accuracy_score}/100
- 理解深度：{eval_ctx.depth_score}/100

已覆盖的概念：{eval_ctx.covered_concepts_summary}
遗漏的核心概念：{eval_ctx.missing_concepts_summary}
存在的错误：{eval_ctx.incorrect_concepts_summary}
逻辑断裂点：{eval_ctx.logic_gaps_summary}

反馈要求：
1. 语气：{style.tone}，字数不超过{style.max_summary_length}字
2. 先肯定讲得好的地方，再指出可以改进的点
3. 词汇水平：{style.vocab_level}
4. 给出2-3条具体可操作的改进建议
5. 不要说"你错了"，而是说"如果补充...会更完整"
6. 如果分数<{style.praise_threshold}，不要过度表扬

输出JSON：
{{
  "summary": "总体反馈文案",
  "strengths": ["亮点1", "亮点2"],
  "suggestions": [{{"suggestion": "改进建议", "priority": "HIGH|MEDIUM|LOW"}}]
}}
"""
```

---

## 6. 状态机设计

### 6.1 讲解会话状态流转

```
                    ┌──────────┐
                    │ PENDING  │ ← 会话创建
                    └────┬─────┘
                         │ 提交讲解内容
                         ▼
                    ┌──────────┐
         ┌─────────│EVALUATING│─────────┐
         │         └────┬─────┘         │
         │              │               │
    ASR失败         评估完成          超时(30s)
         │              │               │
         ▼              ▼               ▼
    ┌──────────┐  ┌──────────┐   ┌──────────┐
    │  FAILED  │  │COMPLETED │   │ TIMEOUT  │
    └──────────┘  └────┬─────┘   └────┬─────┘
                       │              │
                  用户可重新提交     用户可重新提交
                       │              │
                       ▼              ▼
                  ┌──────────┐  ┌──────────┐
                  │  重试    │  │  重试    │
                  │(新会话)  │  │(新会话)  │
                  └──────────┘  └──────────┘
```

### 6.2 状态转换规则

```java
public class ExplanationSessionStateMachine {
    
    private static final Map<Transition, SessionStatus> TRANSITIONS = Map.of(
        // PENDING
        Transition.of(PENDING, Event.SUBMIT),       EVALUATING,
        Transition.of(PENDING, Event.CANCEL),       FAILED,
        Transition.of(PENDING, Event.TIMEOUT),      TIMEOUT,
        
        // EVALUATING
        Transition.of(EVALUATING, Event.SUCCESS),   COMPLETED,
        Transition.of(EVALUATING, Event.FAIL),      FAILED,
        Transition.of(EVALUATING, Event.TIMEOUT),   TIMEOUT,
        
        // COMPLETED → 可创建新会话重试
        // FAILED → 可创建新会话重试
        // TIMEOUT → 可创建新会话重试
    );
    
    private static final Duration EVALUATION_TIMEOUT = Duration.ofSeconds(30);
    
    public boolean canTransition(SessionStatus from, Event event) {
        return TRANSITIONS.containsKey(Transition.of(from, event));
    }
}
```

---

## 7. 关键代码实现

### 7.1 评估服务核心编排

```java
@Service
@Slf4j
public class ExplanationEvaluationService {
    
    @Autowired private ExplanationPreprocessor preprocessor;
    @Autowired private ConceptExtractor conceptExtractor;
    @Autowired private CoverageCalculator coverageCalculator;
    @Autowired private LogicAnalyzer logicAnalyzer;
    @Autowired private StuckPointDetector stuckPointDetector;
    @Autowired private AccuracyChecker accuracyChecker;
    @Autowired private DepthEvaluator depthEvaluator;
    @Autowired private ScoreAggregator scoreAggregator;
    @Autowired private FeedbackGenerator feedbackGenerator;
    @Autowired private ConceptTemplateService templateService;
    @Autowired private KnowledgeTracingService knowledgeTracingService;
    @Autowired private ExplanationSessionRepository sessionRepo;
    @Autowired private ExplanationEvaluationRepository evalRepo;
    
    @Async("explanationEvalExecutor")
    public CompletableFuture<EvaluationResult> evaluate(String sessionId) {
        long startTime = System.currentTimeMillis();
        
        try {
            // 1. 加载会话和模板
            ExplanationSession session = sessionRepo.findBySessionId(sessionId);
            session.setStatus(SessionStatus.EVALUATING);
            sessionRepo.save(session);
            
            ConceptTemplate template = templateService.getTemplate(
                session.getKnowledgePointId(), session.getStage());
            
            // 2. 输入预处理
            PreprocessedText preprocessed = preprocessor.preprocess(
                ExplanationInput.from(session));
            
            // 3. 概念提取
            List<ExtractedConcept> concepts = conceptExtractor.extract(
                preprocessed.getCleanText(), 
                session.getKnowledgePointId(),
                session.getStage()
            );
            
            // 4. 概念覆盖计算
            CoverageResult coverage = coverageCalculator.calculate(concepts, template);
            
            // 5. 逻辑分析
            LogicResult logic = logicAnalyzer.analyze(
                preprocessed.getSegments(), template);
            
            // 6. 准确性校验
            AccuracyResult accuracy = accuracyChecker.check(
                preprocessed.getCleanText(), template, session.getStage());
            
            // 7. 深度评估
            DepthResult depth = depthEvaluator.evaluate(
                preprocessed.getCleanText(), 
                preprocessed.getSegments(),
                template,
                session.getStage()
            );
            
            // 8. 卡点检测
            List<StuckPoint> stuckPoints = stuckPointDetector.detect(
                preprocessed.getCleanText(),
                preprocessed.getSegments(),
                preprocessed.getAsrTimestamps()
            );
            
            // 9. 表达评分
            double expressionScore = calculateExpressionScore(
                preprocessed, stuckPoints);
            
            // 10. 综合评分
            AggregatedScore scores = scoreAggregator.aggregate(
                coverage, logic, accuracy.getScore(), 
                depth.getScore(), expressionScore, session.getStage());
            
            // 11. 生成反馈
            Feedback feedback = feedbackGenerator.generate(
                EvaluationContext.builder()
                    .knowledgePointName(template.getKnowledgePointName())
                    .studentText(preprocessed.getCleanText())
                    .overallScore(scores.getOverallScore())
                    .coverageScore(coverage.getScore())
                    .logicScore(logic.getLogicFlowScore())
                    .accuracyScore(accuracy.getScore())
                    .depthScore(depth.getScore())
                    .coveredConceptsSummary(coverage.getSummary())
                    .missingConceptsSummary(coverage.getMissingSummary())
                    .incorrectConceptsSummary(accuracy.getIncorrectSummary())
                    .logicGapsSummary(logic.getGapsSummary())
                    .build(),
                StudentProfile.from(session)
            );
            
            // 12. 推荐下一步
            RecommendedAction action = recommendAction(
                scores, coverage, stuckPoints);
            
            // 13. 组装结果
            EvaluationResult result = EvaluationResult.builder()
                .sessionId(sessionId)
                .overallScore(scores.getOverallScore())
                .comprehensionLevel(scores.getComprehensionLevel())
                .scores(scores.getScores())
                .coveredConcepts(concepts)
                .missingConcepts(coverage.getMissing())
                .incorrectConcepts(accuracy.getIncorrect())
                .logicGaps(logic.getGaps())
                .stuckPoints(stuckPoints)
                .feedback(feedback)
                .recommendedAction(action)
                .evaluationDurationMs(System.currentTimeMillis() - startTime)
                .build();
            
            // 14. 持久化
            saveEvaluationResult(session, result);
            
            // 15. 回写知识追踪
            knowledgeTracingService.updateMastery(
                session.getUserId(),
                session.getKnowledgePointId(),
                MasteryUpdate.builder()
                    .source("EXPLANATION")
                    .score(scores.getOverallScore())
                    .comprehensionLevel(scores.getComprehensionLevel())
                    .missingConcepts(coverage.getMissingConceptIds())
                    .incorrectConcepts(accuracy.getIncorrectConceptIds())
                    .build()
            );
            
            // 16. 更新会话状态
            session.setStatus(SessionStatus.COMPLETED);
            session.setCompletedAt(LocalDateTime.now());
            sessionRepo.save(session);
            
            return CompletableFuture.completedFuture(result);
            
        } catch (Exception e) {
            log.error("Explanation evaluation failed for session: {}", sessionId, e);
            sessionRepo.updateStatus(sessionId, SessionStatus.FAILED);
            throw new EvaluationException("评估失败: " + e.getMessage(), e);
        }
    }
    
    private RecommendedAction recommendAction(
            AggregatedScore scores, CoverageResult coverage,
            List<StuckPoint> stuckPoints) {
        
        double overall = scores.getOverallScore();
        int highSeverityStuck = (int) stuckPoints.stream()
            .filter(s -> s.getSeverity() == Severity.HIGH).count();
        boolean hasCriticalErrors = coverage.hasCriticalErrors();
        
        if (hasCriticalErrors || overall < 40) {
            return RecommendedAction.REVIEW_CONTENT;
        } else if (overall < 60 || coverage.getCoverageRatio() < 0.5) {
            return RecommendedAction.RE_EXPLAIN;
        } else if (overall < 80 || highSeverityStuck > 0) {
            return RecommendedAction.PRACTICE;
        } else if (overall >= 90) {
            return RecommendedAction.ADVANCED;
        } else {
            return RecommendedAction.GOOD_ENOUGH;
        }
    }
}
```

### 7.2 异步评估线程池配置

```java
@Configuration
public class ExplanationAsyncConfig {
    
    @Bean("explanationEvalExecutor")
    public ThreadPoolTaskExecutor explanationEvalExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(10);
        executor.setMaxPoolSize(30);
        executor.setQueueCapacity(200);
        executor.setKeepAliveSeconds(60);
        executor.setThreadNamePrefix("exp-eval-");
        
        // CallerRunsPolicy: 队列满时由调用线程执行，实现背压
        executor.setRejectedExecutionHandler(
            new ThreadPoolExecutor.CallerRunsPolicy());
        
        // 优雅停机
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        
        return executor;
    }
}
```

### 7.3 SSE流式推送

```java
@RestController
@RequestMapping("/api/v1/explanation")
@Slf4j
public class ExplanationStreamController {
    
    @Autowired private ExplanationEvaluationService evalService;
    @Autowired private SseEmitterManager emitterManager;
    
    @PostMapping(value = "/sessions/{sessionId}/stream", 
                 produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamEvaluation(
            @PathVariable String sessionId,
            @RequestBody ExplanationSubmitRequest request) {
        
        // 超时设置30秒
        SseEmitter emitter = new SseEmitter(30_000L);
        emitterManager.register(sessionId, emitter);
        
        // 提交内容
        submitService.submitContent(sessionId, request);
        
        // 异步评估，通过emitter推送进度
        evalService.evaluateWithProgress(sessionId, new EvaluationProgressCallback() {
            @Override
            public void onStep(EvalStep step, String message) {
                try {
                    emitter.send(SseEmitter.event()
                        .name("evaluation_progress")
                        .data(Map.of("step", step.name(), "message", message)));
                } catch (IOException e) {
                    emitter.completeWithError(e);
                }
            }
            
            @Override
            public void onComplete(EvaluationResult result) {
                try {
                    emitter.send(SseEmitter.event()
                        .name("evaluation_complete")
                        .data(result));
                    emitter.complete();
                } catch (IOException e) {
                    emitter.completeWithError(e);
                }
            }
            
            @Override
            public void onError(Throwable error) {
                emitter.completeWithError(error);
            }
        });
        
        emitter.onTimeout(() -> emitterManager.remove(sessionId));
        emitter.onError(e -> emitterManager.remove(sessionId));
        
        return emitter;
    }
}
```

### 7.4 费曼引导提示生成

```java
@Service
public class GuidancePromptService {
    
    @Autowired private ConceptTemplateService templateService;
    @Autowired private LlmService llmService;
    
    /**
     * 为知识点生成讲解引导提示
     */
    public GuidanceResponse generateGuidance(Long kpId, String stage) {
        ConceptTemplate template = templateService.getTemplate(kpId, stage);
        
        String prompt = f"""请为{stage}学生生成"用自己的话讲一讲"的引导提示。
            
知识点：{template.getKnowledgePointName()}
核心概念：{template.getCoreConceptsSummary()}
            
要求：
1. 生成3-5个递进式的引导问题，从定义→原理→应用
2. 给出一个检查清单，列出好的讲解应该包含哪些要点
3. 建议讲解时长
            
输出JSON：
{{
  "guidancePrompts": ["问题1", "问题2", ...],
  "conceptChecklist": ["要点1", "要点2", ...],
  "timeSuggestion": "建议时长"
}}
""";
        
        return llmService.parse(prompt, GuidanceResponse.class);
    }
}
```

---

## 8. 深度评估策略

### 8.1 理解深度评估维度

```python
class DepthEvaluator:
    """评估学生对知识点的理解深度"""
    
    def evaluate(self, text, segments, template, stage):
        prompt = f"""评估学生对"{template.knowledge_point_name}"的理解深度。

学生讲解："{text}"

请从以下维度评估（每项0-100分）：

1. 举例能力：学生是否能用自己的例子说明概念？
2. 类比迁移：学生是否能将概念与其他知识或生活经验联系？
3. 条件边界：学生是否说明了概念的适用条件和局限？
4. 因果推理：学生是否能解释"为什么"，而不只是"是什么"？
5. 元认知：学生是否展现出对自身理解的反思（如"这里我不太确定"）？

输出JSON：
{{
  "example_score": 0-100,
  "analogy_score": 0-100,
  "boundary_score": 0-100,
  "causality_score": 0-100,
  "metacognition_score": 0-100,
  "overall_depth_score": 加权平均分,
  "depth_evidence": {{
    "examples_found": ["学生举的例子1", ...],
    "analogies_found": ["类比1", ...],
    "boundaries_mentioned": ["边界条件1", ...],
    "causal_explanations": ["因果解释1", ...]
  }}
}}
"""
        result = self.llm_service.parse(prompt, response_format="json")
        return DepthResult(**result)
```

### 8.2 分学段评估标准

```yaml
# 评估标准配置
evaluation_standards:
  PRIMARY:  # 小学
    min_words: 30           # 最少字数
    max_words: 500          # 最多字数
    expected_duration: 60-120  # 期望时长（秒）
    
    coverage_weight: 0.30   # 概念覆盖权重更高
    depth_weight: 0.10      # 深度要求较低
    logic_weight: 0.15
    accuracy_weight: 0.30
    expression_weight: 0.15
    
    depth_criteria:
      example: "能用简单例子说明即可"
      analogy: "鼓励但不强制"
      boundary: "了解基本适用场景"
      causality: "能说清"是什么"即可"
      
    feedback_style:
      max_summary_length: 100
      praise_frequency: "高频"
      suggestion_count: 2   # 最多2条建议，避免打击信心
      
  JUNIOR:  # 初中
    min_words: 50
    max_words: 800
    expected_duration: 90-180
    
    coverage_weight: 0.25
    depth_weight: 0.15
    logic_weight: 0.25
    accuracy_weight: 0.25
    expression_weight: 0.10
    
    depth_criteria:
      example: "应有具体例子"
      analogy: "鼓励跨知识类比"
      boundary: "应说明适用条件"
      causality: "应能解释基本原理"
      
    feedback_style:
      max_summary_length: 150
      praise_frequency: "适度"
      suggestion_count: 3
      
  SENIOR:  # 高中
    min_words: 80
    max_words: 1200
    expected_duration: 120-300
    
    coverage_weight: 0.20
    depth_weight: 0.25      # 深度要求最高
    logic_weight: 0.30      # 逻辑要求最高
    accuracy_weight: 0.20
    expression_weight: 0.05
    
    depth_criteria:
      example: "应有多个例子并能对比"
      analogy: "应能跨学科迁移"
      boundary: "应明确边界和特例"
      causality: "应有完整推理链"
      
    feedback_style:
      max_summary_length: 200
      praise_frequency: "精炼"
      suggestion_count: 4
```

---

## 9. 与知识追踪系统的联动

### 9.1 讲解评估回写知识掌握度

```java
@Service
public class KnowledgeTracingBridge {
    
    /**
     * 将讲解评估结果转换为知识掌握度更新
     */
    public void updateMasteryFromExplanation(
            Long userId, Long kpId, EvaluationResult result) {
        
        // 讲解评估作为高信度信号（比做题更深入）
        // 权重映射：讲解得分 → 掌握度更新
        double masterySignal = mapToMasterySignal(result);
        
        // 细粒度概念掌握度更新
        Map<String, Double> conceptMastery = new HashMap<>();
        
        // 已覆盖概念 → 掌握度提升
        for (ExtractedConcept c : result.getCoveredConcepts()) {
            double confidence = switch (c.getCoverageQuality()) {
                case FULL -> 0.9;
                case PARTIAL -> 0.6;
                case MENTIONED -> 0.3;
                default -> 0.0;
            };
            conceptMastery.put(c.getMatchedConceptId(), confidence);
        }
        
        // 遗漏概念 → 掌握度信号
        for (MissingConcept c : result.getMissingConcepts()) {
            conceptMastery.put(c.getConceptId(), 0.1); // 低掌握
        }
        
        // 错误概念 → 掌握度降低（迷思概念信号）
        for (IncorrectConcept c : result.getIncorrectConcepts()) {
            conceptMastery.put(c.getConceptId(), -0.2); // 负信号
        }
        
        // 发送给知识追踪服务
        knowledgeTracingService.applyExplanationSignal(
            userId, kpId, masterySignal, conceptMastery,
            MasterySignalSource.EXPLANATION
        );
    }
    
    private double mapToMasterySignal(EvaluationResult result) {
        // 讲解评分映射到掌握度信号
        // DEEP/EXPERT → 高信度正信号
        // PARTIAL → 中信度信号
        // SURFACE → 负信号（伪理解检测）
        return switch (result.getComprehensionLevel()) {
            case EXPERT -> 0.95;
            case DEEP -> 0.80;
            case PARTIAL -> 0.55;
            case SURFACE -> 0.20;
        };
    }
}
```

### 9.2 伪理解检测

讲解评估最重要的价值之一是发现**伪理解**——做题正确率高但实际理解浅层的情况。

```java
@Service
public class FalseUnderstandingDetector {
    
    /**
     * 检测伪理解：做题正确率与讲解深度严重不匹配
     */
    public FalseUnderstandingAlert detect(Long userId, Long kpId) {
        // 获取做题掌握度
        double practiceMastery = knowledgeTracingService.getMastery(
            userId, kpId, Source.PRACTICE);
        
        // 获取讲解评估
        ExplanationEvaluation latestExplanation = 
            evalRepo.findLatestByUserAndKp(userId, kpId);
        
        if (latestExplanation == null) return null;
        
        double explanationScore = latestExplanation.getOverallScore();
        
        // 伪理解：做题好（>75）但讲解差（<50）
        if (practiceMastery > 0.75 && explanationScore < 50) {
            return FalseUnderstandingAlert.builder()
                .userId(userId)
                .knowledgePointId(kpId)
                .practiceMastery(practiceMastery)
                .explanationScore(explanationScore)
                .gap(practiceMastery - explanationScore / 100.0)
                .severity(practiceMastery - explanationScore / 100.0 > 0.4 
                    ? Severity.HIGH : Severity.MEDIUM)
                .recommendation("该知识点可能存在伪理解，建议重新学习后再次讲解")
                .build();
        }
        
        return null;
    }
}
```

---

## 10. 缓存策略

### 10.1 多级缓存设计

```java
@Configuration
public class ExplanationCacheConfig {
    
    // 标准概念模板缓存（变更频率低，TTL 1小时）
    @Bean
    public Cache conceptTemplateCache() {
        return Caffeine.newBuilder()
            .maximumSize(10_000)
            .expireAfterWrite(Duration.ofHours(1))
            .recordStats()
            .build();
    }
    
    // 引导提示缓存（与知识点+学段绑定，TTL 30分钟）
    @Bean
    public Cache guidanceCache() {
        return Caffeine.newBuilder()
            .maximumSize(5_000)
            .expireAfterWrite(Duration.ofMinutes(30))
            .build();
    }
    
    // 讲解能力趋势缓存（更新频率低，TTL 10分钟）
    @Bean
    public Cache proficiencyCache() {
        return Caffeine.newBuilder()
            .maximumSize(10_000)
            .expireAfterWrite(Duration.ofMinutes(10))
            .build();
    }
}
```

### 10.2 评估结果缓存

```java
// 避免对相同内容重复评估（学生可能重复提交相同内容）
@Cacheable(value = "explanation_eval", 
           key = "T(com.example.util.HashUtil).md5(#text + #kpId + #stage)",
           unless = "#result == null")
public EvaluationResult evaluateCached(String text, Long kpId, String stage) {
    // 实际评估逻辑
    return doEvaluate(text, kpId, stage);
}
```

---

## 11. 错误处理与降级策略

### 11.1 错误码定义

| 错误码 | 说明 | 处理策略 |
| --- | --- | --- |
| EXP-001 | 会话不存在或已过期 | 返回404，引导重新创建 |
| EXP-002 | 会话状态不允许该操作 | 返回409，返回当前状态 |
| EXP-003 | 讲解内容为空或过短 | 返回400，提示最低字数要求 |
| EXP-004 | ASR转写失败 | 返回503，建议改用文字输入 |
| EXP-005 | ASR置信度过低 | 返回200但标记WARNING，提示"识别可能不准" |
| EXP-006 | LLM评估超时 | 降级为关键词匹配评估，标记"简化评估" |
| EXP-007 | LLM评估异常 | 返回503，支持重试 |
| EXP-008 | 讲解内容与知识点无关 | 返回200但评估分数为0，反馈"未检测到相关知识点内容" |
| EXP-009 | 概念模板未配置 | 降级为通用评估模板，使用LLM直接生成标准 |
| EXP-010 | 评估队列满 | 返回429，提示稍后重试 |

### 11.2 降级链路

```
正常链路：ASR → LLM深度评估 → 概念图谱比对 → 个性化反馈
    │ ASR失败
    ▼
降级1：提示用户改用文字输入
    │ LLM超时/异常
    ▼
降级2：关键词匹配评估（覆盖率基于关键词命中）+ 通用反馈模板
    │ 概念模板缺失
    ▼
降级3：LLM直接从教材内容生成评估标准 → 动态评估
    │ 全部失败
    ▼
降级4：返回通用鼓励反馈 + 建议稍后重试
```

### 11.3 降级实现

```java
@Service
@Slf4j
public class ExplanationFallbackService {
    
    /**
     * LLM不可用时的降级评估
     */
    public EvaluationResult fallbackEvaluate(
            String text, ConceptTemplate template, String stage) {
        
        log.warn("Using fallback evaluation for explanation");
        
        // 关键词匹配
        Set<String> standardKeywords = template.getAllConceptKeywords();
        Set<String> textWords = new HashSet<>(jiebaSegment(text));
        
        Set<String> matched = Sets.intersection(standardKeywords, textWords);
        double coverageScore = (double) matched.size() / standardKeywords.size() * 100;
        
        // 简单逻辑检查：是否包含因果连接词
        boolean hasCausalWords = text.contains("因为") || text.contains("所以") 
            || text.contains("由于") || text.contains("因此");
        double logicScore = hasCausalWords ? 60 : 40;
        
        // 字数检查
        double expressionScore = text.length() >= 50 ? 70 : 50;
        
        // 通用反馈
        String feedback = generateGenericFeedback(coverageScore, stage);
        
        return EvaluationResult.builder()
            .overallScore((coverageScore + logicScore + expressionScore) / 3)
            .comprehensionLevel(coverageScore > 60 ? PARTIAL : SURFACE)
            .isFallback(true)  // 标记为降级评估
            .feedback(Feedback.builder()
                .summary(feedback)
                .strengths(List.of())
                .suggestions(List.of())
                .build())
            .build();
    }
    
    private String generateGenericFeedback(double coverage, String stage) {
        if (coverage >= 70) {
            return "你的讲解涵盖了大部分核心内容，继续保持！";
        } else if (coverage >= 40) {
            return "你讲到了一些重点，还有一些内容可以补充，加油！";
        } else {
            return "建议先复习一下相关内容，然后试着再讲一次。相信你可以的！";
        }
    }
}
```

---

## 12. 性能优化

### 12.1 评估性能目标

| 指标 | 目标 | 说明 |
| --- | --- | --- |
| 文字讲解评估 | P95 < 5秒 | 从提交到结果返回 |
| 语音讲解评估 | P95 < 10秒 | 含ASR转写时间 |
| 并发评估 | 100 QPS | 高峰期并发评估量 |
| LLM Token消耗 | 平均 < 2000 token/次 | 控制成本 |

### 12.2 优化策略

```java
// 1. 概念提取和逻辑分析可并行执行
@Async("expEvalParallel")
public CompletableFuture<ConceptExtractResult> extractConcepts(...)

@Async("expEvalParallel")  
public CompletableFuture<LogicResult> analyzeLogic(...)

// 等待所有并行任务完成
CompletableFuture.allOf(conceptFuture, logicFuture, accuracyFuture)
    .thenApply(this::aggregateResults)

// 2. 批量LLM调用合并（概念提取+准确性校验+深度评估合并为一次调用）
// 通过一个精心设计的Prompt同时输出多个维度的评估结果

// 3. Prompt长度优化
// 标准概念只传ID和名称，不传完整描述
// 学生文本分段传入，避免超长上下文

// 4. 结果预热
// 学生进入讲解页面时，预加载概念模板和引导提示
```

### 12.3 合并LLM调用优化

```python
class UnifiedEvaluationPipeline:
    """将多个评估维度合并为一次LLM调用，降低延迟和成本"""
    
    def evaluate_unified(self, text, template, stage, student_text):
        prompt = f"""请对学生的讲解进行综合评估。

知识点：{template.knowledge_point_name}
学段：{stage}
应覆盖核心概念：{template.concepts_brief}

学生讲解："{student_text}"

请一次性完成以下所有评估，输出JSON：

{{
  "concept_analysis": {{
    "covered": [{{"concept_id": "C001", "quality": "FULL|PARTIAL|MENTIONED", "student_text": "原文引用"}}],
    "missing": ["C003", "C004"],
    "incorrect": [{{"concept_id": "C002", "student_text": "原文", "correction": "正确表述"}}]
  }},
  "logic_analysis": {{
    "flow_score": 0-100,
    "gaps": [{{"position": "...", "missing_link": "...", "severity": "HIGH|MEDIUM|LOW"}}]
  }},
  "depth_analysis": {{
    "example_score": 0-100,
    "analogy_score": 0-100,
    "boundary_score": 0-100,
    "causality_score": 0-100
  }},
  "accuracy_score": 0-100,
  "expression_score": 0-100,
  "stuck_points": [{{"position": "...", "type": "VAGUE|CIRCULAR|HESITATION|INCORRECT", "description": "..."}}],
  "feedback": {{
    "summary": "100-200字总体反馈",
    "strengths": ["亮点1", "亮点2"],
    "suggestions": [{{"suggestion": "...", "concept_id": "C003", "priority": "HIGH"}}]
  }}
}}
"""
        # 单次LLM调用完成所有评估
        result = self.llm_service.parse(prompt, response_format="json", 
                                        max_tokens=2000, temperature=0.3)
        return UnifiedResult(**result)
```

---

## 13. 安全与合规

### 13.1 内容安全

```java
@Service
public class ExplanationContentSafetyFilter {
    
    /**
     * 讲解内容安全过滤
     */
    public SafetyResult check(String text) {
        // 1. 敏感词检测
        List<SensitiveTerm> terms = sensitiveWordService.detect(text);
        if (!terms.isEmpty()) {
            String cleaned = sensitiveWordService.mask(text, terms);
            return SafetyResult.warn("检测到敏感内容，已处理", cleaned);
        }
        
        // 2. 非学习内容检测（学生可能闲聊或输入无关内容）
        if (!isRelatedToKnowledgePoint(text)) {
            return SafetyResult.reject("内容与知识点无关");
        }
        
        // 3. 抄袭检测（学生可能直接复制教材原文冒充"自己的话"）
        double originalityScore = checkOriginality(text);
        if (originalityScore < 0.3) {
            return SafetyResult.warn("检测到内容可能为原文复制，建议用自己的话重新表达", 
                                     text, originalityScore);
        }
        
        return SafetyResult.pass(text);
    }
    
    private double checkOriginality(String text) {
        // 与教材原文比对，计算文本相似度
        // 如果几乎一模一样，说明是复制而非自主讲解
        return originalityChecker.check(text);
    }
}
```

### 13.2 隐私保护

- 讲解录音文件加密存储，URL使用带签名的临时链接
- 讲解文本中的个人隐私信息（手机号、姓名等）自动脱敏
- 录音文件保留30天后自动删除，文本结果长期保存
- 家长查看孩子的讲解记录时需通过身份验证

---

## 14. 数据分析与运营

### 14.1 讲解质量看板指标

| 指标 | 定义 | 用途 |
| --- | --- | --- |
| 讲解参与率 | 发起讲解的学生数/活跃学生数 | 评估功能渗透 |
| 讲解完成率 | 完成提交的讲解数/发起的讲解数 | 评估流失 |
| 平均评估分 | 所有讲解的平均overall_score | 整体理解水平 |
| 高频遗漏概念Top10 | 被最多学生遗漏的核心概念 | 内容优化方向 |
| 高频错误概念Top10 | 被最多学生表述错误的概念 | 迷思概念诊断 |
| 伪理解检出率 | 检出伪理解的知识点比例 | 评估做题-only的局限性 |
| 重讲率 | 用户选择重新讲解的比例 | 用户参与度 |
| 讲解→练习转化率 | 讲解后继续练习的比例 | 功能联动效果 |

### 14.2 内容优化反馈

```sql
-- 高频遗漏概念查询（指导内容团队优化教学材料）
SELECT 
    kp.name AS knowledge_point,
    json_extract(missing_concepts, '$') AS missing_details,
    COUNT(*) AS miss_count
FROM explanation_evaluations ee
JOIN knowledge_points kp ON ee.knowledge_point_id = kp.id
WHERE ee.created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY ee.knowledge_point_id, missing_details
HAVING miss_count > 10
ORDER BY miss_count DESC
LIMIT 20;
```

---

## 15. 部署与配置

### 15.1 关键配置项

```yaml
explanation:
  # 评估超时
  evaluation-timeout-seconds: 30
  
  # 线程池
  thread-pool:
    core-size: 10
    max-size: 30
    queue-capacity: 200
  
  # ASR配置
  asr:
    model: edu-enhanced
    language: zh-CN
    min-confidence: 0.70
    max-audio-duration: 300  # 秒
  
  # LLM配置
  llm:
    evaluation-model: glm-5  # 评估使用的模型
    max-tokens: 2000
    temperature: 0.3         # 低温度保证一致性
    timeout-seconds: 15
  
  # 讲解限制
  limits:
    min-text-length: 20      # 最少字数
    max-text-length: 2000    # 最多字数
    min-voice-duration: 10   # 最短语音秒数
    max-voice-duration: 300  # 最长语音秒数
    daily-limit-per-user: 20 # 每日讲解次数上限
  
  # 缓存
  cache:
    template-ttl-minutes: 60
    guidance-ttl-minutes: 30
    result-dedup-ttl-minutes: 10
  
  # 录音文件
  audio:
    storage-provider: oss
    retention-days: 30       # 保留30天
    encrypt: true
```

### 15.2 监控告警

| 告警项 | 条件 | 级别 |
| --- | --- | --- |
| 评估服务可用性 | 错误率 > 5% | P1 |
| 评估延迟 | P95 > 8秒 | P2 |
| LLM调用失败率 | > 10% | P1 |
| ASR置信度均值 | < 0.80 | P3 |
| 评估队列积压 | 队列 > 50 | P2 |
| 降级评估触发率 | > 15% | P3 |

---

## 16. 版本演进规划

### 16.1 V1（MVP）

- 支持文字输入讲解
- 覆盖核心学科高频知识点
- 基础五维评分 + 通用反馈
- 与同步课堂联动（课后触发）
- 评估结果写入学情报告

### 16.2 V1.5

- 支持语音讲解（ASR集成）
- 概念模板覆盖全部P0知识点
- SSE流式评估反馈
- 伪理解检测与预警
- 讲解能力趋势分析

### 16.3 V2.0

- 多轮讲解对话（AI追问、学生补充）
- AI角色扮演"虚拟学生"反向提问
- 讲解视频录制（前置摄像头 + 屏幕白板）
- 跨学科讲解能力评估
- 讲解内容社区精选与示范学习

---

## 17. 附录

### 17.1 术语表

| 术语 | 说明 |
| --- | --- |
| 费曼学习法 | 以诺贝尔奖 physicist Richard Feynman 命名的学习方法：通过用简单语言解释复杂概念来加深理解 |
| 伪理解 | 学生能做对题但无法清晰讲解概念的状态，通常源于模式匹配而非真正理解 |
| 费曼卡点 | 学生讲解过程中暴露理解困难的特定时刻，如犹豫、循环论述、模糊表述 |
| 概念覆盖度 | 学生讲解中涉及的标准核心概念占应有概念的比例 |
| 理解层级 | 基于Bloom分类法的理解深度评估：表层→部分→深度→精通 |

### 17.2 参考文献

- Bloom, B.S. (1956). Taxonomy of Educational Objectives
- Feynman, R. (1985). Surely You're Joking, Mr. Feynman!
- Chi, M.T.H. et al. (1989). Self-Explanations: How Students Study and Use Examples in Learning to Solve Problems
- PrimeTop 项目设计文档 §6.2 AI智能辅导模块
- PrimeTop 项目设计文档 §8.7 安全与合规架构

---

*文档版本：1.0 | 创建日期：2026-08-01 | 作者：PrimeTop 设计细化助手*
