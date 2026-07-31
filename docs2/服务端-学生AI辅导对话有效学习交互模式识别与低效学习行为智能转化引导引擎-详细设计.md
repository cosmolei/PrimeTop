# 服务端-学生AI辅导对话有效学习交互模式识别与低效学习行为智能转化引导引擎-详细设计

## 1. 概述

### 1.1 功能定位

本引擎是 PrimeTop 教育平台 AI 辅导子系统的**会话级学习质量保障中间件**，负责实时分析学生在 AI 辅导对话中的**交互行为模式**，识别低效学习行为（抄答案、刷题式提问、浅层交互等），并动态触发引导策略，将低效交互转化为有效学习行为。

与现有系统的职责区分：

| 现有系统 | 关注层面 | 本引擎差异 |
|----------|----------|------------|
| 用户提问质量评估引擎 | 单条问题质量 | **会话级交互序列模式** |
| AI辅助依赖度监测引擎 | 长期依赖趋势 | **实时会话内行为检测** |
| 话题漂移检测引擎 | 是否偏题 | **在题但学法不对** |
| 提问意图分类引擎 | 意图匹配策略 | **模式识别后引导转化** |

### 1.2 设计目标

1. **实时检测**：在对话进行过程中（非结束后）识别低效模式，延迟 < 2s
2. **精准分类**：识别 6 类低效学习交互模式，准确率 ≥ 85%
3. **非侵入式引导**：通过调整 AI 回复策略实现引导，不突兀打断对话
4. **可解释**：每次模式判定输出具体证据和行为序列特征
5. **渐进式干预**：从柔性提示到策略调整再到家长告知，逐级升级
6. **隐私安全**：仅分析行为特征，不存储对话原文内容

### 1.3 教育平台典型场景

| 场景 | 低效模式 | 典型表现 | 引导策略 |
|------|----------|----------|----------|
| 写作业 | 抄答案模式 | 连续粘贴完整题目，响应停留 < 3s 即发下一题 | 延迟展示答案，增加思路引导 |
| 考前刷题 | 刷题式提问 | 30分钟内提问 > 20 题，不看解析 | 降低回答频率，插入知识总结 |
| 浅层学习 | 表面交互 | 仅问"答案是什么""选哪个" | 切换为启发式提问模式 |
| 答案钓鱼 | 反复套取 | 同一题反复换说法问直接答案 | 坚持分步提示不给出最终答案 |
| 被动学习 | 无追问 | 从不追问、不要求讲解 | 主动生成思考题引导深入 |
| 焦虑求助 | 情绪化提问 | 带有焦虑情绪词、频繁重复 | 安抚情绪 + 简化拆解步骤 |

---

## 2. 整体架构

### 2.1 架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│                        AI 辅导对话服务                            │
│                   (对话编排 / Prompt 管理 / 流式输出)              │
└──────────┬───────────────────────────────────────┬──────────────┘
           │ 对话事件流                             │ 回复策略控制
           ▼                                        ▲
┌──────────────────────────────────────────────────────────────────┐
│              学习交互模式识别与引导引擎                            │
│                                                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐    │
│  │ 行为信号采集  │──▶│ 模式检测引擎  │──▶│  引导策略决策引擎  │    │
│  │  Collector   │   │  Detector    │   │ StrategyResolver │    │
│  └──────────────┘   └──────────────┘   └────────┬─────────┘    │
│         │                  │                    │               │
│         ▼                  ▼                    ▼               │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐    │
│  │ 会话窗口状态  │   │ 模式规则库    │   │  引导策略库       │    │
│  │ SessionWindow│   │ PatternRules │   │ StrategyLibrary  │    │
│  └──────────────┘   └──────────────┘   └──────────────────┘    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              事后分析与模型优化层                          │   │
│  │  会话质量评分 │ 模式规则调优 │ 干预效果追踪                 │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
           │                                        │
           ▼                                        ▼
┌──────────────┐                          ┌──────────────────┐
│  Redis       │                          │  MySQL           │
│ (会话窗口缓存)│                          │ (模式记录/干预日志)│
└──────────────┘                          └──────────────────┘
```

### 2.2 核心组件职责

| 组件 | 职责 | 部署方式 |
|------|------|----------|
| **BehaviorSignalCollector** | 从对话事件流中提取行为特征信号 | 嵌入对话服务，事件驱动 |
| **SessionWindowManager** | 维护滑动窗口内的行为特征状态 | Redis 内存操作 |
| **PatternDetectorEngine** | 基于规则 + 模型检测低效交互模式 | 独立服务，gRPC 调用 |
| **StrategyResolver** | 根据检测结果和用户画像决定引导策略 | 独立服务 |
| **StrategyLibrary** | 预定义引导策略模板和 Prompt 注入片段 | 配置中心管理 |
| **PostSessionAnalyzer** | 会话结束后质量评分与模型优化 | 异步批处理 |

---

## 3. 数据结构定义

### 3.1 对话行为信号（BehaviorSignal）

每次学生发送消息时提取的行为特征，不包含消息原文（隐私保护）。

```json
{
  "signalId": "sig_20260801_001",
  "sessionId": "conv_20260801_student_xxx_001",
  "studentId": "stu_xxx",
  "timestamp": "2026-08-01T10:30:15.000Z",
  "turnIndex": 5,
  "signals": {
    "messageType": "text",           // text | image | voice
    "messageLength": 85,             // 字符数
    "inputDurationMs": 3200,         // 从开始输入到发送的耗时（毫秒）
    "timeSinceLastResponseMs": 2800, // 距上次AI回复完成的间隔
    "isPaste": true,                // 是否粘贴输入
    "hasReadLastResponse": false,    // 是否滚动查看上条回复（客户端埋点）
    "lastResponseReadDurationMs": 0, // 上条回复阅读时长
    "lastResponseScrollRatio": 0.1,  // 上条回复滚动比例
    "questionType": "direct_answer", // 问题类型（见3.2）
    "subject": "math",
    "gradeLevel": 8,
    "hasFollowUp": false,            // 本条是否是对上一条回复的追问
    "similarityToLastQuestion": 0.92,// 与上条问题的语义相似度
    "containsAnswerWords": true,     // 是否包含"答案""选什么""直接告诉我"
    "emotionalValence": -0.3,        // 情感倾向 (-1 到 1)
    "emotionalKeywords": ["不会", "太难了"]
  }
}
```

### 3.2 问题类型分类

```python
class QuestionType(Enum):
    """学生提问类型分类"""
    DIRECT_ANSWER    = "direct_answer"    # 直接要答案："答案是什么"
    CHOICE_SEEKING   = "choice_seeking"   # 选择题套答案："选A还是B"
    CONCEPT_QUESTION = "concept"          # 概念理解："什么是勾股定理"
    PROCESS_QUESTION = "process"          # 过程求助："这道题怎么做"
    VERIFICATION     = "verification"     # 验证结果："我算的对吗"
    EXPLANATION      = "explanation"      # 请求讲解："为什么用这个公式"
    PRACTICE_REQUEST = "practice"         # 要练习题："给我出几道类似的"
    EMOTIONAL        = "emotional"        # 情绪表达："好难啊不想学了"
    OFF_TOPIC        = "off_topic"        # 非学习相关
    HOMEWORK_PASTE   = "homework_paste"   # 粘贴整道作业题
```

### 3.3 会话窗口状态（SessionWindow）

滑动窗口内的行为聚合状态，存储在 Redis 中。

```json
{
  "sessionId": "conv_20260801_student_xxx_001",
  "studentId": "stu_xxx",
  "startTime": "2026-08-01T10:00:00.000Z",
  "lastUpdateTime": "2026-08-01T10:30:15.000Z",
  "windowMinutes": 30,
  "metrics": {
    "totalTurns": 12,
    "totalQuestions": 12,
    "avgTimeBetweenTurnsMs": 4500,
    "avgReadDurationMs": 1200,
    "avgReadScrollRatio": 0.25,
    "pasteCount": 8,
    "directAnswerCount": 7,
    "followUpCount": 1,
    "uniqueSubjects": 1,
    "uniqueKnowledgePoints": 1,
    "similarQuestionPairs": 4,
    "avgSimilarityScore": 0.78,
    "emotionalTrend": [-0.1, -0.2, -0.3, -0.4, -0.3],
    "currentStreak": {
      "directAnswerStreak": 4,
      "noReadStreak": 6,
      "pasteStreak": 3
    }
  },
  "detectedPatterns": [
    {
      "pattern": "answer_copying",
      "confidence": 0.92,
      "evidence": [
        "paste_count=8/12",
        "avg_read_duration=1.2s",
        "direct_answer_ratio=0.58",
        "avg_time_between=4.5s"
      ],
      "firstDetectedAt": "2026-08-01T10:15:00.000Z",
      "severity": "high"
    }
  ],
  "activeStrategy": {
    "strategyId": "str_progressive_hint",
    "appliedAt": "2026-08-01T10:16:00.000Z",
    "effectiveness": 0.3
  }
}
```

### 3.4 低效交互模式定义（PatternRule）

```sql
CREATE TABLE pattern_rule (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    pattern_code    VARCHAR(64) NOT NULL UNIQUE COMMENT '模式编码',
    pattern_name    VARCHAR(128) NOT NULL COMMENT '模式名称',
    description     TEXT COMMENT '模式描述',
    
    -- 触发条件（JSON，支持组合条件）
    conditions      JSON NOT NULL COMMENT '触发条件表达式',
    
    -- 置信度阈值
    confidence_threshold DECIMAL(3,2) DEFAULT 0.75 COMMENT '最低置信度',
    
    -- 严重程度
    severity        ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'medium',
    
    -- 适用学段
    applicable_grades JSON COMMENT '适用年级，null=全部',
    
    -- 状态
    status          TINYINT DEFAULT 1 COMMENT '1=启用 0=禁用',
    
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_status (status),
    INDEX idx_severity (severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='低效交互模式规则表';
```

### 3.5 模式检测记录（PatternDetectionRecord）

```sql
CREATE TABLE pattern_detection_record (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    
    session_id      VARCHAR(128) NOT NULL COMMENT '对话会话ID',
    student_id      VARCHAR(64) NOT NULL COMMENT '学生ID',
    pattern_code    VARCHAR(64) NOT NULL COMMENT '检测到的模式编码',
    confidence      DECIMAL(4,3) NOT NULL COMMENT '置信度 0-1',
    severity        ENUM('low', 'medium', 'high') NOT NULL,
    
    -- 检测证据
    evidence        JSON NOT NULL COMMENT '检测证据（行为特征快照）',
    detected_at_turn INT NOT NULL COMMENT '在第几轮对话时检测到',
    
    -- 触发的策略
    strategy_id     VARCHAR(64) COMMENT '应用的引导策略ID',
    strategy_outcome ENUM('pending', 'effective', 'ineffective', 'escalated') 
                    DEFAULT 'pending' COMMENT '策略结果',
    
    detected_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_session_pattern (session_id, pattern_code),
    INDEX idx_student_time (student_id, detected_at),
    INDEX idx_pattern_code (pattern_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='模式检测记录表';
```

### 3.6 引导策略定义（GuidanceStrategy）

```sql
CREATE TABLE guidance_strategy (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    strategy_code   VARCHAR(64) NOT NULL UNIQUE COMMENT '策略编码',
    strategy_name   VARCHAR(128) NOT NULL COMMENT '策略名称',
    
    -- 目标模式
    target_patterns JSON NOT NULL COMMENT '适用的低效模式列表',
    
    -- 策略类型
    strategy_type   ENUM(
        'prompt_inject',       -- Prompt 注入：修改AI回复Prompt
        'response_delay',      -- 延迟响应：延迟展示完整答案
        'content_transform',   -- 内容转换：将答案转为问题
        'ui_nudge',            -- UI 提示：客户端轻提示
        'session_limit',       -- 会话限制：限制连续提问
        'escalate'             -- 升级上报：通知家长/教师
    ) NOT NULL,
    
    -- Prompt 注入片段
    prompt_snippet  TEXT COMMENT '注入到AI系统提示词的片段',
    
    -- 策略参数
    parameters      JSON COMMENT '策略参数（延迟时间、限制次数等）',
    
    -- 触发顺序（同一模式多个策略的优先级）
    priority        INT DEFAULT 100 COMMENT '优先级，数字越小越先执行',
    
    -- 升级链：当前策略无效时切换到的下一个策略
    escalate_to     VARCHAR(64) COMMENT '升级到的策略编码',
    
    status          TINYINT DEFAULT 1,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_target_patterns ((CAST(target_patterns AS CHAR(256))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='引导策略定义表';
```

---

## 4. 低效交互模式检测算法

### 4.1 模式一：抄答案模式（Answer Copying）

**定义**：学生将作业题目逐题粘贴给 AI，快速获取答案后抄写，不阅读解析。

**检测条件**：
```python
def detect_answer_copying(window: SessionWindow) -> DetectionResult:
    """
    检测抄答案模式
    触发条件（满足任意 3 条即判定）:
    1. paste_count / total_turns > 0.6
    2. avg_read_duration_ms < 3000 (平均阅读不足3秒)
    3. direct_answer_count / total_turns > 0.5  
    4. avg_time_between_turns_ms < 8000 (平均间隔不足8秒)
    5. follow_up_count == 0 (完全没有追问)
    """
    m = window.metrics
    total = max(m['totalTurns'], 1)
    
    conditions = [
        m['pasteCount'] / total > 0.6,
        m['avgReadDurationMs'] < 3000,
        m['directAnswerCount'] / total > 0.5,
        m['avgTimeBetweenTurnsMs'] < 8000,
        m['followUpCount'] == 0,
    ]
    
    match_count = sum(conditions)
    confidence = match_count / 5.0
    
    # 至少满足3条
    if match_count >= 3:
        return DetectionResult(
            pattern="answer_copying",
            confidence=confidence,
            evidence=_build_evidence(conditions, m),
            severity="high" if match_count >= 4 else "medium"
        )
    return DetectionResult(pattern="answer_copying", confidence=0, detected=False)
```

**最小检测轮次**：5 轮对话后开始评估

### 4.2 模式二：刷题式提问（Rapid Firing）

**定义**：短时间内大量提问，不看解析，追求数量而非理解。

**检测条件**：
```python
def detect_rapid_firing(window: SessionWindow) -> DetectionResult:
    """
    检测刷题式提问
    触发条件:
    1. 30分钟内提问数 > 15
    2. 平均阅读时长 < 5秒  
    3. unique_knowledge_points <= 3 (在少数几个点上重复)
    4. follow_up_count / total_turns < 0.1
    """
    m = window.metrics
    total = max(m['totalTurns'], 1)
    
    is_high_frequency = m['totalTurns'] > 15
    is_low_read = m['avgReadDurationMs'] < 5000
    is_narrow_scope = m['uniqueKnowledgePoints'] <= 3
    is_no_followup = m['followUpCount'] / total < 0.1
    
    if is_high_frequency and (is_low_read and is_narrow_scope):
        confidence = 0.7 + (0.1 if is_no_followup else 0)
        return DetectionResult(
            pattern="rapid_firing",
            confidence=min(confidence, 0.95),
            evidence={
                "turns_in_30min": m['totalTurns'],
                "avg_read_ms": m['avgReadDurationMs'],
                "unique_kp": m['uniqueKnowledgePoints'],
                "followup_ratio": m['followUpCount'] / total
            },
            severity="medium"
        )
    return DetectionResult(pattern="rapid_firing", confidence=0, detected=False)
```

### 4.3 模式三：答案钓鱼（Answer Fishing）

**定义**：对同一道题反复换说法提问，试图让 AI 直接给出答案而非分步提示。

**检测条件**：
```python
def detect_answer_fishing(window: SessionWindow) -> DetectionResult:
    """
    检测答案钓鱼模式
    触发条件:
    1. 最近5轮中，有>=3轮的 pairwise similarity > 0.7
    2. direct_answer_count 占比 > 0.6  
    3. 当前连续 direct_answer_streak >= 2
    4. 每次提问后 AI 回复中包含分步解析，但学生继续要直接答案
    """
    m = window.metrics
    
    high_similarity_ratio = m['similarQuestionPairs'] >= 3
    seeking_answers = m['directAnswerCount'] / max(m['totalTurns'], 1) > 0.6
    current_streak = m['currentStreak']['directAnswerStreak'] >= 2
    
    if high_similarity_ratio and seeking_answers:
        confidence = 0.75
        if current_streak:
            confidence += 0.15
        return DetectionResult(
            pattern="answer_fishing",
            confidence=min(confidence, 0.95),
            evidence={
                "similar_pairs": m['similarQuestionPairs'],
                "direct_answer_ratio": m['directAnswerCount'] / max(m['totalTurns'], 1),
                "consecutive_streak": m['currentStreak']['directAnswerStreak']
            },
            severity="high"
        )
    return DetectionResult(pattern="answer_fishing", confidence=0, detected=False)
```

### 4.4 模式四：浅层交互（Shallow Engagement）

**定义**：学生只关心结果，不深入理解解题过程和知识点。

```python
def detect_shallow_engagement(window: SessionWindow) -> DetectionResult:
    """
    检测浅层交互
    触发条件（满足全部）:
    1. question_type 分布中 direct_answer + choice_seeking 占比 > 0.7
    2. explanation + concept 类型占比 < 0.1
    3. avg_read_scroll_ratio < 0.4 (回复未滚动到中下部，解析部分未看)
    4. follow_up_count == 0
    """
    m = window.metrics
    total = max(m['totalTurns'], 1)
    
    # 需要从信号序列中统计问题类型分布
    type_dist = _get_question_type_distribution(window)
    shallow_ratio = (type_dist.get('direct_answer', 0) + 
                     type_dist.get('choice_seeking', 0)) / total
    deep_ratio = (type_dist.get('explanation', 0) + 
                  type_dist.get('concept', 0)) / total
    
    conditions = [
        shallow_ratio > 0.7,
        deep_ratio < 0.1,
        m['avgReadScrollRatio'] < 0.4,
        m['followUpCount'] == 0
    ]
    
    if all(conditions):
        return DetectionResult(
            pattern="shallow_engagement",
            confidence=0.82,
            evidence={
                "shallow_ratio": shallow_ratio,
                "deep_ratio": deep_ratio,
                "avg_scroll": m['avgReadScrollRatio'],
                "followups": m['followUpCount']
            },
            severity="medium"
        )
    return DetectionResult(pattern="shallow_engagement", confidence=0, detected=False)
```

### 4.5 模式五：被动学习（Passive Learning）

**定义**：学生从不主动追问、不要求深入讲解，完全被动接受 AI 输出。

```python
def detect_passive_learning(window: SessionWindow) -> DetectionResult:
    """
    检测被动学习模式
    触发条件（满足全部，至少8轮对话）:
    1. follow_up_count == 0 (完全没有追问)
    2. explanation + practice 类型提问占比 < 0.15
    3. 无主动要求"讲解""为什么""再讲一遍"等表达
    4. avg_read_duration_ms 在 3-10s 之间（有基本阅读但不深入）
    """
    m = window.metrics
    total = m['totalTurns']
    
    if total < 8:
        return DetectionResult(pattern="passive_learning", confidence=0, detected=False)
    
    type_dist = _get_question_type_distribution(window)
    proactive_ratio = (type_dist.get('explanation', 0) + 
                       type_dist.get('practice', 0)) / max(total, 1)
    
    conditions = [
        m['followUpCount'] == 0,
        proactive_ratio < 0.15,
        3000 <= m['avgReadDurationMs'] <= 10000
    ]
    
    if all(conditions):
        return DetectionResult(
            pattern="passive_learning",
            confidence=0.78,
            evidence={
                "followups": 0,
                "proactive_ratio": proactive_ratio,
                "avg_read_ms": m['avgReadDurationMs']
            },
            severity="low"
        )
    return DetectionResult(pattern="passive_learning", confidence=0, detected=False)
```

### 4.6 模式六：焦虑求助（Anxiety Help-Seeking）

**定义**：学生处于焦虑或挫败状态，对话中带有明显负面情绪。

```python
def detect_anxiety_help_seeking(window: SessionWindow) -> DetectionResult:
    """
    检测焦虑求助模式
    触发条件:
    1. emotional_trend 最近5轮均值 < -0.3
    2. emotional_keywords 出现频次 >= 3
    3. 相似问题重复 >= 2 次（因焦虑反复确认）
    4. 或直接包含求助信号词："救命""不会做""完蛋了""考不上了"
    """
    m = window.metrics
    
    recent_emotions = m['emotionalTrend'][-5:] if len(m['emotionalTrend']) >= 5 else m['emotionalTrend']
    avg_emotion = sum(recent_emotions) / len(recent_emotions) if recent_emotions else 0
    
    emotion_negative = avg_emotion < -0.3
    has_keywords = len(m.get('emotionalKeywords', [])) >= 3
    has_repetition = m['similarQuestionPairs'] >= 2
    
    # 直接求助信号
    help_signals = ["救命", "不会做", "完蛋", "考不上", "来不及", "看不懂", "放弃"]
    
    if emotion_negative and (has_keywords or has_repetition):
        return DetectionResult(
            pattern="anxiety_help_seeking",
            confidence=0.80,
            evidence={
                "avg_emotion": avg_emotion,
                "keyword_count": len(m.get('emotionalKeywords', [])),
                "similar_pairs": m['similarQuestionPairs']
            },
            severity="medium"  # 不是学习低效，而是需要情感支持
        )
    return DetectionResult(pattern="anxiety_help_seeking", confidence=0, detected=False)
```

---

## 5. 引导策略引擎

### 5.1 策略总览

```
低效模式 ──────▶ 策略选择 ──────▶ 引导执行 ──────▶ 效果评估
    │               │                │                │
    │          ┌────┴────┐      ┌────┴────┐      ┌────┴────┐
    │          ▼         ▼      ▼         ▼      ▼         ▼
    │     柔性引导  升级干预  Prompt注入  UI提示  有效确认  升级链
    │     (1级)    (2级)    (服务端)   (客户端)  → 结束   → 升级
```

### 5.2 策略定义

#### 策略1：渐进式提示强化（Progressive Hint Enhancement）

**目标模式**：answer_copying, answer_fishing, shallow_engagement

**原理**：通过 Prompt 注入，让 AI 从"直接给完整解析"切换为"先给思路提示，再逐步展开"。

```python
STRATEGY_PROGRESSIVE_HINT = {
    "strategyCode": "str_progressive_hint",
    "targetPatterns": ["answer_copying", "answer_fishing", "shallow_engagement"],
    "strategyType": "prompt_inject",
    "priority": 10,
    
    # 注入到 AI 系统提示词的片段
    "promptSnippet": """
【交互模式引导指令】
检测到当前学生可能处于{pattern_name}模式。请在后续回复中执行以下策略：
1. 不要直接给出最终答案，先给出解题思路和方向提示
2. 使用提问式引导："你觉得下一步应该怎么做？"
3. 如果学生坚持要答案，回复："我们先一起来分析这道题的思路，这样以后遇到类似的题你就能自己解决了"
4. 将完整解析拆分为3-4步，每次只展示一步，等待学生确认后再继续
5. 在每步解析后附上一个小思考题
""",
    
    "parameters": {
        "min_steps": 3,              # 最少分步数
        "hint_before_answer": True,  # 答案前必须先给提示
        "with_thinking_question": True  # 每步附带思考题
    },
    
    "escalateTo": "str_content_transform",
    "maxTurnsBeforeEscalate": 5  # 5轮后仍无效则升级
}
```

#### 策略2：内容转换（Content Transform）

**目标模式**：answer_copying（升级策略）

**原理**：将学生的"要答案"请求转换为"反向出题"。

```python
STRATEGY_CONTENT_TRANSFORM = {
    "strategyCode": "str_content_transform",
    "targetPatterns": ["answer_copying"],
    "strategyType": "content_transform",
    "priority": 20,
    
    "promptSnippet": """
【深度引导指令】  
学生已持续表现出抄答案行为，之前的渐进提示策略效果不佳。执行以下策略：
1. 不再提供完整解题过程，改为提供解题框架/模板
2. 引导学生自己填空："这道题的第一步是设未知数x，接下来你来写等量关系"
3. 反向出题：基于原题给出一个简化版变式题，让学生尝试自己解
4. 使用"我会检查你的过程"的角色设定，鼓励学生展示自己的思考
""",
    
    "parameters": {
        "provide_framework_only": True,
        "generate_simplified_variant": True,
        "variant_count": 1
    },
    
    "escalateTo": "str_session_limit"
}
```

#### 策略3：节奏控制（Pace Control）

**目标模式**：rapid_firing

```python
STRATEGY_PACE_CONTROL = {
    "strategyCode": "str_pace_control",
    "targetPatterns": ["rapid_firing"],
    "strategyType": "response_delay",
    "priority": 10,
    
    "promptSnippet": """
【节奏调整指令】
学生提问频率过高，可能未充分消化每道题的解析。执行：
1. 在回复末尾增加"知识总结"小节，提炼本题型核心考点
2. 回复中加入"做一道题不如懂一类题"的引导语
3. 在下次提问时先确认："上一题的解析你理解了吗？有什么疑问吗？"
4. 主动建议："不如我们花2分钟回顾一下刚才这3道题的共同考点？"
""",
    
    "parameters": {
        "add_summary": True,
        "confirm_before_next": True,
        "min_interval_ms": 10000  # 建议最短间隔
    },
    
    "escalateTo": "str_session_limit"
}
```

#### 策略4：主动引导（Proactive Engagement）

**目标模式**：passive_learning, shallow_engagement

```python
STRATEGY_PROACTIVE_ENGAGE = {
    "strategyCode": "str_proactive_engage",
    "targetPatterns": ["passive_learning", "shallow_engagement"],
    "strategyType": "prompt_inject",
    "priority": 10,
    
    "promptSnippet": """
【主动引导指令】
学生当前学习较为被动，未深入探究。执行：
1. 在每次回答后主动提出一个延伸思考题："你知道这个公式还能用在什么场景吗？"
2. 主动提供"要不要听一个有趣的例子？"的引导
3. 将直接答案改为选择题形式："答案有可能是A或B，你觉得哪个更合理？为什么？"
4. 在解析末尾加上"如果你是出题老师，你会怎么变形这道题？"
""",
    
    "parameters": {
        "add_extension_question": True,
        "use_choice_format": True,
        "add_creative_prompt": True
    },
    
    "escalateTo": None  # 被动学习不需要升级
}
```

#### 策略5：情感支持（Emotional Support）

**目标模式**：anxiety_help_seeking

```python
STRATEGY_EMOTIONAL_SUPPORT = {
    "strategyCode": "str_emotional_support",
    "targetPatterns": ["anxiety_help_seeking"],
    "strategyType": "prompt_inject",
    "priority": 5,  # 最高优先级
    
    "promptSnippet": """
【情感支持指令】
检测到学生可能处于焦虑或挫败状态。请执行：
1. 首先给予情感安抚："学习遇到困难很正常，你已经做得很好了"
2. 将复杂问题拆解为更小的步骤，使用更简单的语言
3. 增加鼓励性表达："这一步你做对了！我们继续"
4. 避免一次性展示太多信息，减少认知负荷
5. 如果学生表达极度焦虑，建议休息："要不要先休息5分钟？回来我们一步一步来"
6. 不要催促，给学生足够时间
""",
    
    "parameters": {
        "comfort_first": True,
        "simplify_language": True,
        "add_encouragement": True,
        "suggest_break": True,
        "break_threshold": -0.5  # 情感值低于-0.5时建议休息
    },
    
    "escalateTo": "str_escalate_notify"  # 持续焦虑升级通知
}
```

#### 策略6：会话限制（Session Limit）

**目标模式**：answer_copying（终极限制），rapid_firing（升级）

```python
STRATEGY_SESSION_LIMIT = {
    "strategyCode": "str_session_limit",
    "targetPatterns": ["answer_copying", "rapid_firing"],
    "strategyType": "session_limit",
    "priority": 50,
    
    "parameters": {
        "max_questions_per_session": 10,
        "cooldown_message": "你已经问了很多题了！建议花10分钟回顾一下刚才的解析，真正理解每道题的解题方法。15分钟后可以继续提问～",
        "cooldown_minutes": 15,
        "review_card_count": 3  # 冷却期间推送3张复习卡片
    },
    
    "escalateTo": "str_escalate_notify"
}
```

#### 策略7：升级通知（Escalate Notify）

**目标模式**：所有模式在低级策略无效时

```python
STRATEGY_ESCALATE_NOTIFY = {
    "strategyCode": "str_escalate_notify",
    "targetPatterns": ["answer_copying", "rapid_firing", "anxiety_help_seeking"],
    "strategyType": "escalate",
    "priority": 99,
    
    "parameters": {
        "notify_parent": True,
        "notify_teacher": False,  # 默认不通知老师
        "parent_message_template": "学情提示：{student_name}在今日的AI辅导中，学习方式有优化空间（{pattern_description}）。建议家长关注孩子的学习习惯，鼓励先思考再提问。PrimeTop将持续提供适应性引导。",
        "notify_threshold_turns": 20,  # 至少对话20轮后才通知家长
        "daily_notify_limit": 1  # 每天最多通知1次
    }
}
```

### 5.3 策略决策流程

```python
class StrategyResolver:
    """引导策略决策引擎"""
    
    def resolve(self, detection: DetectionResult, 
                window: SessionWindow,
                student_profile: StudentProfile) -> StrategyDecision:
        """
        决策流程:
        1. 查询模式对应的策略列表，按 priority 排序
        2. 检查是否有正在执行的策略
        3. 如果有，评估策略效果，决定是否升级
        4. 如果没有，选择最高优先级策略
        5. 考虑学生画像（年级、历史行为）调整策略参数
        """
        
        # 获取当前会话已执行的策略
        active = window.activeStrategy
        
        if active and active['strategyId']:
            # 评估当前策略效果
            effectiveness = self._evaluate_strategy_effectiveness(
                window, detection
            )
            
            if effectiveness < 0.3 and active['turnsSinceApplied'] >= 5:
                # 策略无效，升级
                next_strategy = self._get_escalation(active['strategyId'])
                if next_strategy:
                    return StrategyDecision(
                        action="escalate",
                        strategy=next_strategy,
                        reason=f"Previous strategy effectiveness={effectiveness:.2f}"
                    )
        
        # 首次选择策略
        candidates = self._get_strategies_for_pattern(detection.pattern)
        candidates = self._filter_by_profile(candidates, student_profile)
        chosen = candidates[0]  # 最高优先级
        
        return StrategyDecision(
            action="apply",
            strategy=chosen,
            reason=f"Pattern {detection.pattern} detected with confidence={detection.confidence}"
        )
```

---

## 6. API 接口设计

### 6.1 行为信号上报接口

每轮对话后，客户端/对话服务上报行为信号。

```
POST /api/v1/learning-pattern/signals
Content-Type: application/json
Authorization: Bearer {token}
```

**请求体**：
```json
{
  "sessionId": "conv_20260801_stu_xxx_001",
  "turnIndex": 6,
  "signals": {
    "messageType": "text",
    "messageLength": 85,
    "inputDurationMs": 3200,
    "timeSinceLastResponseMs": 2800,
    "isPaste": true,
    "hasReadLastResponse": false,
    "lastResponseReadDurationMs": 0,
    "lastResponseScrollRatio": 0.1,
    "hasFollowUp": false,
    "emotionalKeywords": []
  }
}
```

**响应**：
```json
{
  "code": 0,
  "data": {
    "sessionId": "conv_20260801_stu_xxx_001",
    "activePatterns": [
      {
        "pattern": "answer_copying",
        "confidence": 0.85,
        "severity": "high"
      }
    ],
    "guidanceDirective": {
      "strategyCode": "str_progressive_hint",
      "promptSnippet": "【交互模式引导指令】...",
      "parameters": {
        "min_steps": 3,
        "hint_before_answer": true
      },
      "uiHint": {
        "type": "gentle_nudge",
        "text": "💡 试试先自己想想思路，再对照AI的解析，效果会更好哦！",
        "actionText": "我知道了",
        "dismissible": true,
        "maxShowPerSession": 2
      }
    }
  }
}
```

### 6.2 会话模式分析查询接口

```
GET /api/v1/learning-pattern/sessions/{sessionId}/analysis
```

**响应**：
```json
{
  "code": 0,
  "data": {
    "sessionId": "conv_20260801_stu_xxx_001",
    "sessionDuration": 1800,
    "totalTurns": 12,
    "overallEffectiveness": 0.35,
    "effectivenessLabel": "低效",
    "detectedPatterns": [
      {
        "pattern": "answer_copying",
        "patternName": "抄答案模式",
        "confidence": 0.92,
        "severity": "high",
        "firstDetectedAtTurn": 5,
        "evidence": {
          "paste_ratio": 0.67,
          "avg_read_ms": 1200,
          "direct_answer_ratio": 0.58
        },
        "appliedStrategies": [
          {
            "strategyCode": "str_progressive_hint",
            "appliedAtTurn": 6,
            "outcome": "ineffective",
            "effectiveness": 0.2
          },
          {
            "strategyCode": "str_content_transform",
            "appliedAtTurn": 11,
            "outcome": "pending"
          }
        ]
      }
    ],
    "behaviorMetrics": {
      "avgReadDurationMs": 1200,
      "followUpCount": 1,
      "pasteCount": 8,
      "questionTypeDistribution": {
        "direct_answer": 7,
        "explanation": 2,
        "verification": 3
      }
    }
  }
}
```

### 6.3 学生学习交互习惯画像接口

```
GET /api/v1/learning-pattern/students/{studentId}/profile?period=30d
```

**响应**：
```json
{
  "code": 0,
  "data": {
    "studentId": "stu_xxx",
    "period": "2026-07-01 ~ 2026-07-31",
    "totalSessions": 45,
    "totalTurns": 520,
    "habitProfile": {
      "primaryPattern": "passive_learning",
      "patternFrequency": {
        "answer_copying": 0.11,
        "rapid_firing": 0.07,
        "answer_fishing": 0.04,
        "shallow_engagement": 0.22,
        "passive_learning": 0.36,
        "anxiety_help_seeking": 0.04,
        "effective_learning": 0.16
      },
      "trend": "improving",
      "avgSessionEffectiveness": 0.52,
      "mostEffectiveStrategy": "str_proactive_engage",
      "strategySuccessRate": {
        "str_progressive_hint": 0.45,
        "str_content_transform": 0.38,
        "str_proactive_engage": 0.62,
        "str_pace_control": 0.55,
        "str_emotional_support": 0.71
      }
    },
    "recommendations": [
      "学生倾向于被动学习，建议教师端布置更多开放性思考题",
      "主动引导策略效果最好，可以增加延伸思考题的比例"
    ]
  }
}
```

### 6.4 策略效果反馈接口

```
POST /api/v1/learning-pattern/strategies/feedback
```

**请求体**：
```json
{
  "sessionId": "conv_20260801_stu_xxx_001",
  "strategyCode": "str_progressive_hint",
  "appliedAtTurn": 6,
  "currentTurn": 10,
  "outcome": "ineffective",
  "metrics": {
    "followUpsAfterStrategy": 0,
    "readDurationChange": -200,
    "directAnswerRatioChange": 0.05
  }
}
```

---

## 7. 实时处理架构

### 7.1 事件驱动架构

```
┌──────────────┐
│ AI对话服务   │
│ 对话事件总线 │
└──────┬───────┘
       │ DialogEvent (Kafka topic: dialog.events)
       │
       ├───▶ BehaviorSignalCollector (Flink/Storm)
       │           │
       │           ▼ Extract BehaviorSignal
       │     ┌─────────────┐
       │     │ SessionWindow│ (Redis Hash)
       │     │ Manager      │
       │     └──────┬──────┘
       │            │ WindowUpdated event
       │            ▼
       │     ┌──────────────┐
       │     │ PatternDetector│
       │     │ Engine        │
       │     └──────┬───────┘
       │            │ PatternDetected event (if any)
       │            ▼
       │     ┌──────────────┐
       │     │ Strategy      │
       │     │ Resolver      │
       │     └──────┬───────┘
       │            │ StrategyDecision
       │            ▼
       └───▶ AI对话服务（调整 Prompt / 回复策略）
              │
              └──▶ 客户端（UI 提示）
```

### 7.2 滑动窗口实现

```python
import time
import json
from dataclasses import dataclass, field
from typing import List, Dict, Optional

@dataclass
class SessionWindow:
    """会话行为窗口状态"""
    session_id: str
    student_id: str
    start_time: float
    window_minutes: int = 30
    signals: List[Dict] = field(default_factory=list)
    metrics: Dict = field(default_factory=dict)
    
    def add_signal(self, signal: Dict):
        """添加行为信号，自动维护滑动窗口"""
        now = time.time()
        self.signals.append(signal)
        
        # 清理过期信号
        cutoff = now - self.window_minutes * 60
        self.signals = [s for s in self.signals if s['timestamp_unix'] > cutoff]
        
        # 重新计算聚合指标
        self._recompute_metrics()
    
    def _recompute_metrics(self):
        """重新计算窗口内聚合指标"""
        total = len(self.signals)
        if total == 0:
            return
        
        self.metrics = {
            'totalTurns': total,
            'pasteCount': sum(1 for s in self.signals if s.get('isPaste')),
            'directAnswerCount': sum(
                1 for s in self.signals 
                if s.get('questionType') in ('direct_answer', 'choice_seeking')
            ),
            'followUpCount': sum(1 for s in self.signals if s.get('hasFollowUp')),
            'avgReadDurationMs': (
                sum(s.get('lastResponseReadDurationMs', 0) for s in self.signals) / total
            ),
            'avgReadScrollRatio': (
                sum(s.get('lastResponseScrollRatio', 0) for s in self.signals) / total
            ),
            'avgTimeBetweenTurnsMs': self._calc_avg_interval(),
            'similarQuestionPairs': self._count_similar_pairs(),
            'uniqueKnowledgePoints': len(set(
                s.get('knowledgePoint', 'unknown') for s in self.signals
            )),
            'uniqueSubjects': len(set(
                s.get('subject', 'unknown') for s in self.signals
            )),
            'emotionalTrend': [s.get('emotionalValence', 0) for s in self.signals[-10:]],
        }
        
        # 计算连续计数
        self.metrics['currentStreak'] = self._calc_streaks()
    
    def _calc_avg_interval(self) -> float:
        """计算平均对话间隔"""
        if len(self.signals) < 2:
            return 0
        intervals = []
        for i in range(1, len(self.signals)):
            interval = (
                self.signals[i]['timestamp_unix'] - 
                self.signals[i-1]['timestamp_unix']
            ) * 1000
            intervals.append(interval)
        return sum(intervals) / len(intervals)
    
    def _count_similar_pairs(self) -> int:
        """统计高相似度问题对数"""
        count = 0
        for i in range(len(self.signals)):
            for j in range(i+1, len(self.signals)):
                sim = self.signals[j].get('similarityToLastQuestion', 0)
                # 这里简化处理，实际应计算所有pair的相似度
                if sim > 0.7:
                    count += 1
        return count
    
    def _calc_streaks(self) -> Dict:
        """计算当前连续行为计数"""
        direct_streak = 0
        no_read_streak = 0
        paste_streak = 0
        
        for s in reversed(self.signals):
            if s.get('questionType') in ('direct_answer', 'choice_seeking'):
                direct_streak += 1
            else:
                break
        
        for s in reversed(self.signals):
            if not s.get('hasReadLastResponse'):
                no_read_streak += 1
            else:
                break
        
        for s in reversed(self.signals):
            if s.get('isPaste'):
                paste_streak += 1
            else:
                break
        
        return {
            'directAnswerStreak': direct_streak,
            'noReadStreak': no_read_streak,
            'pasteStreak': paste_streak
        }
```

### 7.3 Redis 存储设计

```
# 会话窗口状态 (Hash)
KEY: pattern:session:{sessionId}
FIELDS: studentId, startTime, lastUpdateTime, metrics (JSON), detectedPatterns (JSON), activeStrategy (JSON)
TTL: 2 hours (会话结束后自动过期)

# 学生活跃会话映射 (Set)  
KEY: pattern:student:{studentId}:active_sessions
VALUE: Set of sessionIds
TTL: 2 hours

# 每日通知计数 (用于通知限频)
KEY: pattern:notify:{studentId}:{date}
VALUE: integer counter
TTL: 25 hours

# 策略效果统计 (Sorted Set)
KEY: pattern:strategy:{strategyCode}:effectiveness
SCORE: effectiveness score
MEMBER: studentId
TTL: 7 days
```

---

## 8. 与 AI 对话服务的集成

### 8.1 Prompt 注入流程

```python
class DialogOrchestrator:
    """AI 对话编排器（简化版，展示集成点）"""
    
    async def handle_student_message(
        self, session_id: str, message: str, student_id: str
    ) -> AsyncGenerator[str, None]:
        
        # 1. 提取行为信号
        signal = self.signal_collector.extract(
            session_id, message, student_id
        )
        
        # 2. 上报信号，获取模式检测结果和引导指令
        guidance = await self.pattern_engine.process_signal(signal)
        
        # 3. 构建系统 Prompt（含引导注入）
        system_prompt = self._build_system_prompt(
            student_id=student_id,
            session_id=session_id,
            guidance_directive=guidance.guidanceDirective
        )
        
        # 4. 调用大模型生成回复
        async for chunk in self.llm_client.chat_stream(
            messages=[Message(role="system", content=system_prompt),
                     Message(role="user", content=message)],
            temperature=0.3
        ):
            yield chunk
    
    def _build_system_prompt(
        self, student_id: str, session_id: str,
        guidance_directive: Optional[Dict] = None
    ) -> str:
        """构建系统提示词"""
        base_prompt = self.prompt_manager.get_base_prompt(student_id)
        
        if guidance_directive and guidance_directive.get('promptSnippet'):
            # 注入引导策略到系统提示词
            pattern_name = guidance_directive.get('patternName', '')
            snippet = guidance_directive['promptSnippet'].format(
                pattern_name=pattern_name
            )
            return f"{base_prompt}\n\n{snippet}"
        
        return base_prompt
```

### 8.2 策略注入时机控制

```python
class GuidanceInjector:
    """控制策略注入时机，避免过于频繁"""
    
    def __init__(self):
        self.min_turns_between_inject = 3  # 最少间隔3轮
        self.max_consecutive_injects = 5   # 单会话最多注入5次
    
    def should_inject(
        self, session_id: str, current_turn: int,
        last_inject_turn: Optional[int],
        inject_count: int
    ) -> bool:
        # 超过最大注入次数
        if inject_count >= self.max_consecutive_injects:
            return False
        
        # 首次注入或满足间隔
        if last_inject_turn is None:
            return True
        
        return current_turn - last_inject_turn >= self.min_turns_between_inject
    
    def build_ui_hint(
        self, pattern: str, severity: str,
        show_count: int
    ) -> Optional[Dict]:
        """构建客户端 UI 提示"""
        
        # 低严重度不弹UI提示
        if severity == 'low':
            return None
        
        # 已展示2次不再展示
        if show_count >= 2:
            return None
        
        hints = {
            'answer_copying': {
                'type': 'gentle_nudge',
                'text': '💡 试试先自己想想思路，再对照解析，学习效果会更好哦！',
                'actionText': '好的，我先想想',
                'icon': 'lightbulb'
            },
            'rapid_firing': {
                'type': 'gentle_nudge',
                'text': '📚 每道题都值得认真理解，不如放慢速度，看看解析中的关键步骤？',
                'actionText': '好的',
                'icon': 'book'
            },
            'anxiety_help_seeking': {
                'type': 'comfort',
                'text': '💪 遇到难题很正常，你已经很努力了！深呼吸，我们一步一步来～',
                'actionText': '继续',
                'icon': 'heart'
            }
        }
        
        hint = hints.get(pattern)
        if hint:
            hint['dismissible'] = True
            hint['maxShowPerSession'] = 2
        
        return hint
```

---

## 9. 会话后分析与会话质量评分

### 9.1 会话质量评分模型

会话结束后（或超过30分钟无活动），计算本次学习会话的质量评分。

```python
class SessionQualityScorer:
    """会话学习质量评分器"""
    
    def score(self, window: SessionWindow) -> SessionQualityScore:
        """
        计算会话质量评分 (0-100)
        
        评分维度:
        1. 参与度 (Engagement) - 25分
        2. 深度学习 (Depth) - 30分  
        3. 自主性 (Autonomy) - 25分
        4. 效率 (Efficiency) - 20分
        """
        m = window.metrics
        total = max(m['totalTurns'], 1)
        
        # 1. 参与度评分
        read_score = min(m['avgReadDurationMs'] / 10000, 1.0)  # 10秒以上为满分
        scroll_score = min(m['avgReadScrollRatio'], 1.0)
        engagement = (read_score * 0.6 + scroll_score * 0.4) * 25
        
        # 2. 深度学习评分
        type_dist = _get_type_distribution(window)
        deep_ratio = (type_dist.get('explanation', 0) + 
                      type_dist.get('concept', 0)) / total
        followup_ratio = m['followUpCount'] / total
        depth = min(deep_ratio * 2 + followup_ratio * 3, 1.0) * 30
        
        # 3. 自主性评分
        paste_ratio = m['pasteCount'] / total
        direct_ratio = m['directAnswerCount'] / total
        autonomy = (1 - paste_ratio * 0.5 - direct_ratio * 0.5) * 25
        autonomy = max(autonomy, 0)
        
        # 4. 效率评分（合理提问节奏 + 适度阅读）
        if 30 <= m['avgTimeBetweenTurnsMs'] / 1000 <= 180:
            efficiency = 20  # 30-180秒间隔为最佳
        elif m['avgTimeBetweenTurnsMs'] / 1000 < 10:
            efficiency = 5   # 过快
        else:
            efficiency = 12  # 适中
        
        total_score = engagement + depth + autonomy + efficiency
        
        return SessionQualityScore(
            total=round(total_score, 1),
            engagement=round(engagement, 1),
            depth=round(depth, 1),
            autonomy=round(autonomy, 1),
            efficiency=round(efficiency, 1),
            label=self._score_to_label(total_score)
        )
    
    def _score_to_label(self, score: float) -> str:
        if score >= 75:
            return "高效"
        elif score >= 50:
            return "有效"
        elif score >= 30:
            return "待改善"
        else:
            return "低效"
```

### 9.2 长期学习习惯画像构建

```sql
CREATE TABLE student_learning_habit_profile (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    student_id      VARCHAR(64) NOT NULL,
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    
    -- 汇总统计
    total_sessions  INT NOT NULL DEFAULT 0,
    total_turns     INT NOT NULL DEFAULT 0,
    avg_session_score DECIMAL(4,1) DEFAULT 0,
    
    -- 模式频率分布 (JSON)
    pattern_distribution JSON NOT NULL COMMENT '各低效模式出现频率',
    
    -- 主要模式
    primary_pattern VARCHAR(64) COMMENT '最频繁的低效模式',
    
    -- 策略效果统计 (JSON)
    strategy_effectiveness JSON COMMENT '各策略的历史效果',
    
    -- 趋势
    trend_direction ENUM('improving', 'stable', 'declining') DEFAULT 'stable',
    
    -- 建议摘要
    recommendations JSON COMMENT '学习习惯改善建议列表',
    
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_student_period (student_id, period_start),
    INDEX idx_trend (trend_direction)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生学习习惯画像表';
```

---

## 10. 错误处理与异常恢复

### 10.1 异常场景与处理

| 异常场景 | 影响 | 处理策略 |
|----------|------|----------|
| Redis 连接中断 | 无法读写会话窗口 | 降级：跳过模式检测，AI对话正常进行；异步重试恢复 |
| 模式检测服务超时 | 无法实时检测 | 超时 500ms 后跳过，记录日志，会话结束后批量分析 |
| 信号采集失败 | 行为数据缺失 | 丢弃当前信号，不影响对话流程；记录缺失率告警 |
| 策略注入异常 | Prompt 构建失败 | 使用基础 Prompt 继续对话，不注入策略 |
| 客户端埋点缺失 | 无阅读时长数据 | 降级：仅使用服务端可获取的特征（消息长度、间隔时间等） |

### 10.2 优雅降级策略

```python
class PatternEngineFallback:
    """模式检测引擎降级策略"""
    
    async def process_signal_with_fallback(
        self, signal: BehaviorSignal
    ) -> GuidanceResult:
        try:
            # 正常流程：实时检测
            return await self.pattern_detector.detect(signal)
        except (RedisConnectionError, TimeoutError) as e:
            logger.warning(f"Pattern detection degraded: {e}")
            return GuidanceResult(
                status="degraded",
                guidanceDirective=None,
                message="Pattern detection temporarily unavailable"
            )
        except Exception as e:
            logger.error(f"Pattern detection error: {e}", exc_info=True)
            return GuidanceResult(
                status="error", 
                guidanceDirective=None
            )
```

### 10.3 数据一致性保障

```python
class SessionWindowRecovery:
    """会话窗口崩溃恢复"""
    
    async def recover_session(self, session_id: str):
        """从持久化存储重建会话窗口"""
        # 1. 检查 Redis 是否有窗口数据
        window_data = await self.redis.hgetall(f"pattern:session:{session_id}")
        
        if not window_data:
            # 2. 从行为信号日志重建
            signals = await self.signal_store.query_by_session(session_id)
            if signals:
                window = SessionWindow(
                    session_id=session_id,
                    student_id=signals[0]['studentId'],
                    start_time=signals[0]['timestamp_unix']
                )
                for signal in signals:
                    window.add_signal(signal)
                
                # 重建后写回 Redis
                await self._persist_window(window)
                return window
        
        return None
```

---

## 11. 性能设计

### 11.1 性能指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 信号处理延迟 | < 50ms | 从信号接收到窗口更新完成 |
| 模式检测延迟 | < 200ms | 从窗口更新到检测完成 |
| 策略决策延迟 | < 100ms | 从检测结果到策略选定 |
| 端到端延迟 | < 500ms | 从信号上报到引导指令返回 |
| 并发会话支持 | 10,000+ | 同时进行的AI辅导会话 |
| Redis 内存消耗 | < 50KB/会话 | 每个会话窗口数据大小 |

### 11.2 优化策略

**1. 滑动窗口增量计算**

```python
class IncrementalWindowUpdater:
    """增量更新窗口指标，避免每次全量重算"""
    
    def update(self, window: SessionWindow, new_signal: Dict):
        m = window.metrics
        total = m['totalTurns'] + 1
        
        # 增量更新平均值
        m['avgReadDurationMs'] = (
            (m['avgReadDurationMs'] * m['totalTurns'] + 
             new_signal.get('lastResponseReadDurationMs', 0)) / total
        )
        m['avgReadScrollRatio'] = (
            (m['avgReadScrollRatio'] * m['totalTurns'] + 
             new_signal.get('lastResponseScrollRatio', 0)) / total
        )
        
        # 增量更新计数
        m['totalTurns'] = total
        if new_signal.get('isPaste'):
            m['pasteCount'] += 1
        if new_signal.get('questionType') in ('direct_answer', 'choice_seeking'):
            m['directAnswerCount'] += 1
        if new_signal.get('hasFollowUp'):
            m['followUpCount'] += 1
        
        # 情感趋势：保留最近10个
        m['emotionalTrend'].append(new_signal.get('emotionalValence', 0))
        if len(m['emotionalTrend']) > 10:
            m['emotionalTrend'] = m['emotionalTrend'][-10:]
```

**2. 检测频率控制**

```python
class DetectionScheduler:
    """控制模式检测频率，避免每轮都全量检测"""
    
    def __init__(self):
        self.min_turns_before_detect = 5   # 前5轮不检测
        self.detect_interval = 2            # 每2轮检测一次
        self.always_detect_patterns = {     # 这些模式每轮都检测（高优先级）
            "anxiety_help_seeking",
            "answer_fishing"
        }
    
    def should_detect(
        self, current_turn: int,
        last_detect_turn: int,
        has_active_pattern: bool
    ) -> bool:
        if current_turn < self.min_turns_before_detect:
            return False
        
        if has_active_pattern:
            return True  # 有活跃模式时每轮都检测
        
        return (current_turn - last_detect_turn) >= self.detect_interval
```

---

## 12. 监控与告警

### 12.1 关键监控指标

```python
MONITORING_METRICS = {
    # 检测引擎性能
    "pattern.detection.latency_ms": "直方图 - 检测延迟分布",
    "pattern.detection.error_rate": "计数器 - 检测错误率",
    
    # 模式分布
    "pattern.detected.{pattern_code}.count": "计数器 - 各模式检测次数",
    "pattern.detected.{pattern_code}.avg_confidence": "仪表 - 平均置信度",
    
    # 策略效果
    "strategy.{strategy_code}.applied.count": "计数器 - 策略应用次数",
    "strategy.{strategy_code}.effective.rate": "仪表 - 策略有效率",
    "strategy.escalation.rate": "仪表 - 策略升级率",
    
    # 会话质量
    "session.quality.avg_score": "仪表 - 平均会话质量分",
    "session.quality.distribution": "直方图 - 质量分分布",
    
    # 系统健康
    "session.window.redis.memory_mb": "仪表 - Redis内存占用",
    "session.active.count": "仪表 - 当前活跃会话数"
}
```

### 12.2 告警规则

```yaml
alerts:
  - name: pattern_detection_error_rate_high
    query: "rate(pattern.detection.error_rate[5m]) > 0.05"
    severity: warning
    message: "模式检测错误率超过5%"
    
  - name: strategy_escalation_rate_high
    query: |
      avg_over_time(strategy.escalation.rate[1h]) > 0.4
    severity: warning
    message: "策略升级率超过40%，说明初始引导策略效果不佳"
    
  - name: avg_session_quality_low
    query: "avg_over_time(session.quality.avg_score[6h]) < 35"
    severity: info
    message: "最近6小时平均会话质量低于35分"
    
  - name: redis_window_memory_high
    query: "session.window.redis.memory_mb > 2048"
    severity: warning
    message: "会话窗口Redis内存超过2GB"
```

---

## 13. 安全与隐私

### 13.1 数据最小化原则

1. **不存储对话原文**：行为信号仅包含元数据特征（消息长度、输入时长等），不包含消息内容
2. **问题类型不等于问题本身**：只记录分类标签，不记录原始问题文本
3. **情感关键词限量存储**：仅记录预定义词表中的命中结果，不记录完整语句
4. **相似度分数而非内容**：存储语义相似度数值，不存储用于计算的内容

### 13.2 访问控制

| 数据 | 可见角色 | 说明 |
|------|----------|------|
| 模式检测记录 | 学生本人、家长（绑定后） | 学生可查看自己的学习习惯画像 |
| 会话质量评分 | 学生、家长、教师 | 教师只能查看班级聚合数据 |
| 引导策略参数 | 平台管理员 | 策略配置属于平台运营范畴 |
| 家长通知记录 | 家长 | 通知内容和频率受家长控制 |
| 学生画像 | 学生、家长 | 画像数据不可对其他学生可见 |

### 13.3 未成年人保护

1. 家长通知频率限制：每日最多 1 次学习习惯通知
2. 通知内容使用正面表述，避免引起家长焦虑或指责学生
3. 不将低效学习行为记录纳入学生正式评价体系
4. 学生可查看自己的行为画像，数据透明

---

## 14. 部署与配置

### 14.1 服务部署

```yaml
# docker-compose.yml 片段
services:
  pattern-detector:
    image: primetop/pattern-detector:1.0
    replicas: 3
    resources:
      requests:
        cpu: "500m"
        memory: "1Gi"
      limits:
        cpu: "2000m"
        memory: "2Gi"
    env:
      - REDIS_URL=redis-cluster:6379
      - MYSQL_URL=mysql-primary:3306/primetop
      - DETECTION_TIMEOUT_MS=200
      - MIN_TURNS_BEFORE_DETECT=5
      - DETECTION_INTERVAL=2
    health_check:
      path: /health
      interval: 10s
      timeout: 3s
    
  strategy-resolver:
    image: primetop/strategy-resolver:1.0
    replicas: 2
    env:
      - STRATEGY_CONFIG_PATH=/config/strategies.yaml
      - NOTIFY_DAILY_LIMIT=1
```

### 14.2 动态配置

```yaml
# strategies.yaml - 可通过配置中心热更新
detection:
  min_turns_before_detect: 5
  detection_interval: 2
  confidence_threshold: 0.75
  
patterns:
  answer_copying:
    enabled: true
    severity: high
    conditions:
      paste_ratio_threshold: 0.6
      avg_read_ms_threshold: 3000
      direct_answer_ratio_threshold: 0.5
      
  rapid_firing:
    enabled: true
    severity: medium
    conditions:
      min_turns_in_window: 15
      window_minutes: 30
      
  anxiety_help_seeking:
    enabled: true
    severity: medium
    always_detect: true  # 每轮都检测

strategies:
  str_progressive_hint:
    max_turns_before_escalate: 5
    effectiveness_threshold: 0.3
    
  str_session_limit:
    max_questions: 10
    cooldown_minutes: 15
    
  str_escalate_notify:
    notify_parent: true
    daily_notify_limit: 1
    min_turns_threshold: 20
```

---

## 15. 与现有系统的集成关系

```
┌─────────────────────────────────────────────────────────────┐
│                    本引擎 (交互模式识别与引导)                │
│                                                             │
│  输入                      输出                              │
│  ────                      ────                              │
│  对话事件流 ──────────▶ 行为信号采集 ──▶ 模式检测 ──▶ 引导策略│
│                                          │         │        │
└──────────────────────────────────────────┼─────────┼────────┘
                                           │         │
                   ┌───────────────────────┘         │
                   ▼                                 ▼
    ┌──────────────────────┐         ┌─────────────────────────┐
    │ 对话事件来源          │         │ 引导指令去向              │
    │ ──────────────        │         │ ──────────────            │
    │ • AI对话引擎与会话管理 │         │ • AI对话编排(Prompt注入)   │
    │ • SSE流式响应引擎      │         │ • 客户端(UI提示)           │
    │ • 客户端行为埋点        │         │ • 消息推送(家长通知)        │
    └──────────────────────┘         │ • 学习提醒系统(节奏控制)    │
                                     └─────────────────────────┘

上下游数据消费:
┌────────────────────────────────────────────────────────────┐
│ 上游数据源                                                  │
│ • 客户端埋点事件体系 → 阅读时长、滚动比例、粘贴检测          │
│ • AI辅导对话知识点掌握度更新 → 当前知识点上下文             │
│ • 用户学习画像 → 学生年级、历史习惯                          │
│                                                            │
│ 下游数据消费                                                │
│ • 学情诊断报告 → 会话质量评分作为学情数据维度                │
│ • 学生AI辅助依赖度监测 → 低效模式数据作为依赖度评估输入      │
│ • 防沉迷与未成年人保护 → 会话时长、频率数据                 │
│ • 家长学情报告 → 学习习惯分析数据                           │
│ • 管理后台AI质量监控 → 策略效果数据                         │
└────────────────────────────────────────────────────────────┘
```

---

## 16. 测试策略

### 16.1 单元测试

```python
class TestAnswerCopyingDetection(unittest.TestCase):
    
    def test_high_confidence_copying(self):
        """测试高置信度抄答案检测"""
        window = self._build_window(
            turns=10,
            paste_count=8,
            avg_read_ms=1500,
            direct_answer_count=7,
            avg_interval_ms=4000,
            follow_up_count=0
        )
        result = detect_answer_copying(window)
        self.assertTrue(result.detected)
        self.assertGreaterEqual(result.confidence, 0.8)
        self.assertEqual(result.severity, "high")
    
    def test_not_copying_normal_study(self):
        """测试正常学习不应误判"""
        window = self._build_window(
            turns=8,
            paste_count=2,
            avg_read_ms=25000,
            direct_answer_count=2,
            avg_interval_ms=120000,
            follow_up_count=4
        )
        result = detect_answer_copying(window)
        self.assertFalse(result.detected)
    
    def test_boundary_conditions(self):
        """测试边界条件"""
        # 刚好5轮对话
        window = self._build_window(turns=5, paste_count=4, 
                                    avg_read_ms=2000, follow_up_count=0)
        result = detect_answer_copying(window)
        # 5轮数据应参与评估但置信度可能不高
        self.assertIsNotNone(result)
```

### 16.2 集成测试

```python
class TestStrategyIntegration(unittest.TestCase):
    
    async def test_full_flow_pattern_to_guidance(self):
        """测试从模式检测到策略注入的完整流程"""
        # 1. 模拟5轮抄答案行为
        for i in range(5):
            signal = self._make_signal(
                turn_index=i,
                is_paste=True,
                read_ms=1500,
                question_type="direct_answer"
            )
            await self.engine.process_signal(signal)
        
        # 2. 第6轮应检测到模式并返回引导策略
        result = await self.engine.get_current_guidance(self.session_id)
        
        self.assertIsNotNone(result.guidanceDirective)
        self.assertEqual(
            result.guidanceDirective['strategyCode'],
            'str_progressive_hint'
        )
        self.assertIn('promptSnippet', result.guidanceDirective)
```

---

## 17. 迭代演进路线

| 阶段 | 目标 | 关键工作 |
|------|------|----------|
| **v1.0 MVP** | 基础模式检测 | 实现 answer_copying 和 rapid_firing 检测；基础 Prompt 注入策略 |
| **v1.5** | 全模式覆盖 | 6 类模式全部上线；客户端 UI 提示；策略效果评估 |
| **v2.0** | 个性化模型 | 基于历史数据训练个性化检测模型；策略效果预测 |
| **v2.5** | 跨模块联动 | 与学情分析、家长报告、教师端联动；学习习惯长期追踪 |
| **v3.0** | AI驱动优化 | 使用 LLM 对话分析替代规则检测；自动策略调优 |

---

## 附录 A：错误码定义

| 错误码 | 含义 | HTTP Status |
|--------|------|-------------|
| LP_001 | 会话不存在 | 404 |
| LP_002 | 信号数据格式错误 | 400 |
| LP_003 | 模式检测服务不可用 | 503 |
| LP_004 | 策略配置不存在 | 500 |
| LP_005 | 权限不足 | 403 |
| LP_006 | 通知频率超限 | 429 |
| LP_101 | Redis 连接失败（已降级） | 200 (degraded=true) |
| LP_102 | 检测超时（已跳过） | 200 (skipped=true) |

## 附录 B：预定义情感关键词表

```json
{
  "anxiety": ["太难了", "不会做", "看不懂", "完蛋", "考不上", "救命", "来不及", "崩溃", "放弃", "不想学"],
  "frustration": ["又错了", "怎么还是不对", "烦死了", "气死", "为什么总是错", "没意思"],
  "encouragement_seek": ["能行吗", "我可以吗", "来得及吗", "还有希望吗"],
  "positive": ["懂了", "明白了", "原来如此", "太好了", "有意思", "学到了"]
}
```
