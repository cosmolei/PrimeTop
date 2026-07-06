# 服务端-学生AI学习伙伴主动对话触发与智能关怀策略引擎 详细设计

## 1. 概述

### 1.1 模块定位

AI 学习伙伴主动对话触发引擎是 PrimeTop 平台中负责**决策何时、以何种方式、用什么内容**主动与学生发起对话的核心服务。它与被动响应式 AI 辅导对话不同——后者是学生提问后 AI 回答，而本引擎关注的是 AI 伙伴在学生没有主动提问时，**主动发起有温度、有策略的交互**，以提升学习动力、维持学习连续性、增强情感联结。

### 1.2 核心职责

| 职责 | 说明 |
| --- | --- |
| 触发时机决策 | 基于多维信号判断是否应主动发起对话 |
| 对话策略选择 | 根据学生当前状态选择关怀、鼓励、提醒、挑战等策略 |
| 频率与疲劳控制 | 避免过度打扰，维持健康的交互节奏 |
| 个性化内容生成 | 结合学生画像、学习历史、伙伴角色设定生成对话内容 |
| 效果闭环追踪 | 衡量主动对话对学生 engagement 的影响并持续优化 |

### 1.3 依赖关系

```
┌─────────────────────────────────────────────────────┐
│              AI学习伙伴主动对话触发引擎                │
├─────────┬──────────┬──────────┬──────────┬──────────┤
│         │          │          │          │          │
▼         ▼          ▼          ▼          ▼          ▼
学生      学习行为    心理状态   伙伴角色   消息推送   效果分析
画像服务   事件流      建模服务   个性化服务  投递服务   埋点服务
```

**上游依赖（数据来源）：**
- `学生画像特征工程平台` — 提供学生基础画像、学习风格、性格特征
- `学习行为事件流与跨模块级联处理引擎` — 提供实时学习行为事件
- `学生心理状态建模与学习动机激励策略引擎` — 提供当前心理状态评估
- `学生AI学习伙伴角色个性化与对话风格自适应引擎` — 提供伙伴角色设定和对话风格
- `学生学习上下文全局管理与跨模块AI感知编排引擎` — 提供当前学习场景上下文

**下游依赖（执行通道）：**
- `统一通知消息模板引擎与多渠道内容适配渲染服务` — 消息渲染
- `多厂商推送通道适配层与国内厂商推送平台集成引擎` — 推送投递
- `客户端-AI学习伙伴虚拟形象与动画交互引擎` — 客户端伙伴动画表现
- `客户端推送通知通道集成与本地提醒调度引擎` — 本地通知调度

---

## 2. 核心概念定义

### 2.1 主动对话类型（ProactiveDialogueType）

| 类型 | 代号 | 场景示例 | 情感基调 |
| --- | --- | --- | --- |
| 学习鼓励 | `ENCOURAGEMENT` | 连续答对题目后、取得进步时 | 肯定、赞赏 |
| 关怀问候 | `CARE_GREETING` | 早上好/晚上好/好久不见 | 温暖、亲切 |
| 学习提醒 | `STUDY_REMINDER` | 计划任务未完成、复习时间到了 | 温和督促 |
| 情绪疏导 | `EMOTIONAL_SUPPORT` | 检测到挫败感、连续答错、长时间无进展 | 共情、安抚 |
| 知识拓展 | `KNOWLEDGE_EXTENSION` | 学完一个章节后推荐有趣的拓展知识 | 好奇、探索 |
| 里程碑庆祝 | `MILESTONE_CELEBRATION` | 打卡达成、掌握度提升、考试完成 | 兴奋、骄傲 |
| 社交互动 | `SOCIAL_INTERACTION` | 分享学习动态、同伴比较、排行榜更新 | 趣味、竞争 |
| 学习反思 | `LEARNING_REFLECTION` | 一次学习结束后的复盘引导 | 沉稳、引导 |

### 2.2 触发信号维度（TriggerSignal）

```java
public enum TriggerSignalCategory {
    TIME_BASED,          // 时间相关：时段、间隔、计划时间
    BEHAVIOR_BASED,      // 行为相关：登录、答题、完成章节
    PERFORMANCE_BASED,   // 表现相关：正确率、速度、进步幅度
    EMOTION_BASED,       // 情绪相关：挫败感、兴奋、疲劳
    CONTEXT_BASED,       // 场景相关：考试临近、假期、周末
    SOCIAL_BASED,        // 社交相关：同伴动态、排行榜变化
    LIFECYCLE_BASED      // 生命周期：新用户、流失风险、续费临近
}
```

### 2.3 关怀强度等级（CareIntensity）

| 等级 | 代号 | 频率上限 | 示例 |
| --- | --- | --- | --- |
| 极轻 | `WHISPER` | 每日 ≤3 次 | 伙伴头像旁出现小气泡 "今天也很棒哦" |
| 轻度 | `GENTLE` | 每日 ≤2 次 | 底部横幅提示 "休息一下吧" |
| 中度 | `WARM` | 每日 ≤1 次 | 弹出伙伴对话卡片，带表情动画 |
| 重度 | `DEEP` | 每周 ≤2 次 | 全屏伙伴对话 + 专属动画 + 音效 |
| 紧急 | `URGENT` | 不限（需审批） | 检测到严重情绪波动时的即时关怀 |

---

## 3. 数据模型

### 3.1 核心实体

#### 3.1.1 主动对话触发规则（proactive_dialogue_rule）

```sql
CREATE TABLE proactive_dialogue_rule (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    rule_code       VARCHAR(64) NOT NULL UNIQUE COMMENT '规则编码',
    rule_name       VARCHAR(128) NOT NULL COMMENT '规则名称',
    dialogue_type   VARCHAR(32) NOT NULL COMMENT '主动对话类型',
    care_intensity  VARCHAR(16) NOT NULL COMMENT '关怀强度等级',
    
    -- 触发条件（JSON配置，支持组合条件）
    trigger_conditions JSON NOT NULL COMMENT '触发条件配置',
    
    -- 目标受众筛选
    audience_filter VARCHAR(32) NOT NULL DEFAULT 'ALL' COMMENT '受众筛选类型',
    audience_config JSON COMMENT '受众筛选配置（学段、年级、VIP等）',
    
    -- 对话内容生成策略
    content_strategy VARCHAR(32) NOT NULL COMMENT '内容生成策略',
    content_config   JSON COMMENT '内容生成配置（Prompt模板、变量等）',
    
    -- 频率控制
    max_per_day      INT DEFAULT 1 COMMENT '每日最大触发次数',
    max_per_week     INT DEFAULT 3 COMMENT '每周最大触发次数',
    min_interval_min INT DEFAULT 60 COMMENT '两次触发最小间隔（分钟）',
    
    -- 投放通道
    channels         JSON NOT NULL COMMENT '投放通道列表',
    
    -- 生效控制
    priority         INT DEFAULT 50 COMMENT '优先级（越大越优先）',
    status           VARCHAR(16) DEFAULT 'ACTIVE' COMMENT '状态：ACTIVE/PAUSED/ARCHIVED',
    effective_start  DATETIME COMMENT '生效开始时间',
    effective_end    DATETIME COMMENT '生效结束时间',
    
    -- 效果指标（聚合缓存）
    total_triggered  BIGINT DEFAULT 0 COMMENT '累计触发次数',
    avg_engagement_rate DECIMAL(5,4) DEFAULT 0 COMMENT '平均互动率',
    
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by       VARCHAR(64) NOT NULL,
    
    INDEX idx_status_type (status, dialogue_type),
    INDEX idx_priority (priority DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='主动对话触发规则';
```

#### 3.1.2 主动对话记录（proactive_dialogue_log）

```sql
CREATE TABLE proactive_dialogue_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    dialogue_id     VARCHAR(64) NOT NULL UNIQUE COMMENT '对话唯一标识',
    student_id      BIGINT NOT NULL COMMENT '学生ID',
    rule_id         BIGINT COMMENT '触发的规则ID',
    dialogue_type   VARCHAR(32) NOT NULL COMMENT '对话类型',
    care_intensity  VARCHAR(16) NOT NULL COMMENT '关怀强度',
    
    -- 触发上下文
    trigger_signals JSON NOT NULL COMMENT '触发时的信号快照',
    trigger_context JSON COMMENT '触发时的场景上下文',
    
    -- 对话内容
    content_text    TEXT COMMENT '生成的对话文本',
    content_meta    JSON COMMENT '内容元数据（表情、动画、附件等）',
    companion_role  VARCHAR(32) COMMENT '使用的伙伴角色',
    
    -- 投递信息
    channels_used   JSON NOT NULL COMMENT '实际投递的通道',
    delivered_at    DATETIME COMMENT '投递时间',
    delivery_status VARCHAR(16) DEFAULT 'PENDING' COMMENT '投递状态',
    
    -- 学生反馈
    student_response VARCHAR(16) COMMENT '学生反应类型',
    response_time_ms BIGINT COMMENT '响应耗时（毫秒）',
    student_replied  BOOLEAN DEFAULT FALSE COMMENT '是否回复了对话',
    reply_content    TEXT COMMENT '学生回复内容',
    feedback_action  VARCHAR(32) COMMENT '学生执行的动作',
    
    -- 效果标记
    is_effective    BOOLEAN COMMENT '是否判定为有效互动',
    effectiveness_score DECIMAL(4,3) COMMENT '效果评分 0-1',
    
    triggered_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_student_time (student_id, triggered_at),
    INDEX idx_type_time (dialogue_type, triggered_at),
    INDEX idx_rule_time (rule_id, triggered_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='主动对话记录';
```

#### 3.1.3 触发频率控制（proactive_dialogue_quota）

```sql
CREATE TABLE proactive_dialogue_quota (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    student_id      BIGINT NOT NULL COMMENT '学生ID',
    quota_date      DATE NOT NULL COMMENT '配额日期',
    
    -- 各强度等级的使用次数
    whisper_count      INT DEFAULT 0 COMMENT 'WHISPER 已用次数',
    gentle_count       INT DEFAULT 0 COMMENT 'GENTLE 已用次数',
    warm_count         INT DEFAULT 0 COMMENT 'WARM 已用次数',
    deep_count         INT DEFAULT 0 COMMENT 'DEEP 已用次数',
    urgent_count       INT DEFAULT 0 COMMENT 'URGENT 已用次数',
    
    -- 各对话类型的使用次数
    type_counts     JSON NOT NULL COMMENT '各DialogueType的使用次数',
    
    -- 汇总
    total_count     INT DEFAULT 0 COMMENT '当日总触发次数',
    last_triggered_at DATETIME COMMENT '最后一次触发时间',
    
    UNIQUE KEY uk_student_date (student_id, quota_date),
    INDEX idx_date (quota_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='主动对话频率控制';
```

#### 3.1.4 对话策略模板（dialogue_strategy_template）

```sql
CREATE TABLE dialogue_strategy_template (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    template_code   VARCHAR(64) NOT NULL UNIQUE COMMENT '模板编码',
    dialogue_type   VARCHAR(32) NOT NULL COMMENT '对话类型',
    
    -- 适用条件
    applicable_grades JSON COMMENT '适用年级列表',
    applicable_stage  VARCHAR(16) COMMENT '适用学段',
    
    -- Prompt 配置
    system_prompt   TEXT NOT NULL COMMENT '系统提示词',
    user_prompt_template TEXT NOT NULL COMMENT '用户提示词模板（含变量占位符）',
    variables       JSON NOT NULL COMMENT '模板变量定义',
    
    -- 语气与风格
    tone_descriptor VARCHAR(64) NOT NULL COMMENT '语气描述',
    emotion_tags    JSON NOT NULL COMMENT '情感标签列表',
    max_length      INT DEFAULT 200 COMMENT '最大回复长度',
    
    -- 多模态配置
    companion_animation VARCHAR(64) COMMENT '伙伴动画类型',
    bgm_type        VARCHAR(64) COMMENT '背景音效类型',
    
    status          VARCHAR(16) DEFAULT 'ACTIVE',
    version         INT DEFAULT 1 COMMENT '模板版本',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_type_status (dialogue_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='对话策略模板';
```

### 3.2 缓存设计

#### 3.2.1 学生频率控制缓存

```java
/**
 * Redis Key: proactive:quota:{studentId}:{date}
 * TTL: 48h（跨天自动过期）
 * 
 * 数据结构：Hash
 */
{
    "whisper_count": "2",
    "gentle_count": "1", 
    "warm_count": "0",
    "deep_count": "0",
    "urgent_count": "0",
    "total_count": "3",
    "last_triggered_at": "2026-07-06T10:30:00",
    "type_counts": "{\"ENCOURAGEMENT\":1,\"CARE_GREETING\":1,\"STUDY_REMINDER\":1}"
}
```

#### 3.2.2 冷却期缓存

```java
/**
 * Redis Key: proactive:cooldown:{studentId}:{dialogueType}
 * TTL: 对应类型的最小间隔时间
 * Value: 触发时间戳
 * 
 * 用于快速判断某类型对话是否在冷却期内
 */
```

#### 3.2.3 学生状态快照缓存

```java
/**
 * Redis Key: proactive:snapshot:{studentId}
 * TTL: 5分钟
 * 
 * 缓存学生当前状态，避免每次触发都查询多个服务
 */
{
    "online_status": "ONLINE",
    "current_activity": "PRACTICE",
    "current_subject": "MATH",
    "session_start_time": "2026-07-06T10:00:00",
    "last_answer_correct": true,
    "consecutive_correct": 5,
    "consecutive_wrong": 0,
    "session_duration_min": 30,
    "fatigue_level": 0.3,
    "emotion_score": 0.7,
    "today_study_min": 45,
    "streak_days": 7,
    "companion_role": "scholar_cat"
}
```

---

## 4. 触发决策引擎

### 4.1 决策架构

```
                    ┌─────────────────────┐
                    │   触发事件总线        │
                    │  (Event Bus)        │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   信号采集器          │
                    │  SignalCollector    │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   规则匹配器          │
                    │  RuleMatcher        │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   频率检查器          │
                    │  QuotaChecker       │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   优先级仲裁器        │
                    │  PriorityArbiter    │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   内容生成器          │
                    │  ContentGenerator   │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   通道分发器          │
                    │  ChannelDispatcher  │
                    └─────────────────────┘
```

### 4.2 触发条件 DSL

使用 JSON 配置组合条件，支持嵌套逻辑：

```json
{
  "logic": "AND",
  "conditions": [
    {
      "category": "TIME_BASED",
      "field": "current_hour",
      "operator": "BETWEEN",
      "value": [7, 9]
    },
    {
      "category": "BEHAVIOR_BASED",
      "field": "last_login_hours_ago",
      "operator": "GTE",
      "value": 12
    },
    {
      "logic": "OR",
      "conditions": [
        {
          "category": "LIFECYCLE_BASED",
          "field": "streak_days",
          "operator": "GTE",
          "value": 3
        },
        {
          "category": "LIFECYCLE_BASED",
          "field": "is_new_user",
          "operator": "EQ",
          "value": true
        }
      ]
    },
    {
      "category": "CONTEXT_BASED",
      "field": "is_holiday",
      "operator": "EQ",
      "value": false
    }
  ]
}
```

### 4.3 条件评估器实现

```java
/**
 * 触发条件评估器
 */
public class TriggerConditionEvaluator {

    private final Map<TriggerSignalCategory, SignalProvider> signalProviders;
    
    /**
     * 评估条件组是否满足
     */
    public boolean evaluate(TriggerCondition condition, StudentContext ctx) {
        if (condition.isLeaf()) {
            return evaluateLeaf(condition, ctx);
        }
        
        // 组合条件
        LogicOperator logic = condition.getLogic();
        List<TriggerCondition> children = condition.getChildren();
        
        if (logic == LogicOperator.AND) {
            return children.stream().allMatch(c -> evaluate(c, ctx));
        } else if (logic == LogicOperator.OR) {
            return children.stream().anyMatch(c -> evaluate(c, ctx));
        } else if (logic == LogicOperator.NOT) {
            return !evaluate(children.get(0), ctx);
        }
        
        return false;
    }
    
    private boolean evaluateLeaf(TriggerCondition condition, StudentContext ctx) {
        SignalProvider provider = signalProviders.get(condition.getCategory());
        if (provider == null) return false;
        
        Object signalValue = provider.getSignalValue(ctx.getStudentId(), condition.getField());
        if (signalValue == null) return false;
        
        return ConditionOperator.compare(signalValue, condition.getOperator(), condition.getValue());
    }
}
```

### 4.4 信号采集器

```java
/**
 * 时间信号提供者
 */
@Component
public class TimeBasedSignalProvider implements SignalProvider {
    
    private final Clock clock;
    private final ChineseHolidayCalendar holidayCalendar;
    
    @Override
    public TriggerSignalCategory getCategory() {
        return TriggerSignalCategory.TIME_BASED;
    }
    
    @Override
    public Object getSignalValue(Long studentId, String field) {
        ZonedDateTime now = ZonedDateTime.now(clock)
            .withZoneSameInstant(ZoneId.of("Asia/Shanghai"));
        
        return switch (field) {
            case "current_hour"      -> now.getHour();
            case "current_weekday"   -> now.getDayOfWeek().getValue();
            case "is_weekend"        -> now.getDayOfWeek().getValue() >= 6;
            case "is_holiday"        -> holidayCalendar.isHoliday(now.toLocalDate());
            case "is_school_season"  -> holidayCalendar.isSchoolSeason(now.toLocalDate());
            case "days_until_exam"   -> holidayCalendar.daysUntilNearestExam(now.toLocalDate());
            default -> null;
        };
    }
}

/**
 * 行为信号提供者
 */
@Component
public class BehaviorBasedSignalProvider implements SignalProvider {
    
    private final LearningEventRepository eventRepo;
    private final StudentSessionService sessionService;
    
    @Override
    public TriggerSignalCategory getCategory() {
        return TriggerSignalCategory.BEHAVIOR_BASED;
    }
    
    @Override
    public Object getSignalValue(Long studentId, String field) {
        return switch (field) {
            case "last_login_hours_ago"     -> getLastLoginHoursAgo(studentId);
            case "session_duration_min"     -> getCurrentSessionDuration(studentId);
            case "today_study_min"          -> getTodayStudyMinutes(studentId);
            case "today_questions_answered" -> getTodayQuestionCount(studentId);
            case "today_chapters_completed" -> getTodayChapterCount(studentId);
            case "streak_days"              -> getStreakDays(studentId);
            case "is_currently_studying"    -> sessionService.isStudying(studentId);
            case "idle_minutes"             -> sessionService.getIdleMinutes(studentId);
            case "last_interaction_min_ago" -> getLastInteractionMinutesAgo(studentId);
            default -> null;
        };
    }
}

/**
 * 表现信号提供者
 */
@Component
public class PerformanceBasedSignalProvider implements SignalProvider {
    
    private final AnswerRecordRepository answerRepo;
    private final KnowledgeMasteryService masteryService;
    
    @Override
    public TriggerSignalCategory getCategory() {
        return TriggerSignalCategory.PERFORMANCE_BASED;
    }
    
    @Override
    public Object getSignalValue(Long studentId, String field) {
        PerformanceSnapshot snapshot = answerRepo.getRecentPerformance(studentId, 10);
        
        return switch (field) {
            case "recent_accuracy"          -> snapshot.getAccuracy();
            case "consecutive_correct"      -> snapshot.getConsecutiveCorrect();
            case "consecutive_wrong"        -> snapshot.getConsecutiveWrong();
            case "avg_response_time_sec"    -> snapshot.getAvgResponseTime();
            case "accuracy_trend"           -> snapshot.getTrend().name(); // UP/DOWN/STABLE
            case "improvement_rate"         -> snapshot.getImprovementRate();
            case "mastery_change_today"     -> masteryService.getTodayMasteryChange(studentId);
            case "weak_points_count"        -> masteryService.getWeakPointCount(studentId);
            default -> null;
        };
    }
}

/**
 * 情绪信号提供者
 */
@Component
public class EmotionBasedSignalProvider implements SignalProvider {
    
    private final EmotionModelService emotionService;
    private final StudentBehaviorAnalyzer behaviorAnalyzer;
    
    @Override
    public TriggerSignalCategory getCategory() {
        return TriggerSignalCategory.EMOTION_BASED;
    }
    
    @Override
    public Object getSignalValue(Long studentId, String field) {
        EmotionState state = emotionService.getCurrentState(studentId);
        
        return switch (field) {
            case "frustration_level"   -> state.getFrustrationLevel();   // 0.0 ~ 1.0
            case "engagement_level"    -> state.getEngagementLevel();    // 0.0 ~ 1.0
            case "fatigue_level"       -> state.getFatigueLevel();       // 0.0 ~ 1.0
            case "emotion_score"       -> state.getOverallScore();       // -1.0 ~ 1.0
            case "is_frustrated"       -> state.getFrustrationLevel() > 0.6;
            case "is_bored"            -> state.getEngagementLevel() < 0.3;
            case "is_fatigued"         -> state.getFatigueLevel() > 0.7;
            case "rage_risk"           -> behaviorAnalyzer.assessRageRisk(studentId); // LOW/MEDIUM/HIGH
            default -> null;
        };
    }
}
```

---

## 5. 频率控制策略

### 5.1 多层频率控制

```java
/**
 * 频率控制检查器
 * 采用漏斗式检查：全局 → 类型 → 强度 → 冷却期 → 学生偏好
 */
@Service
public class QuotaChecker {
    
    @Cacheable(value = "proactive_quota", key = "#studentId + '_' + T(java.time.LocalDate).now()")
    public QuotaCheckResult check(Long studentId, ProactiveDialogueRule rule) {
        
        // 1. 全局每日上限检查
        QuotaSnapshot quota = getQuota(studentId);
        if (quota.getTotalCount() >= getMaxDailyTriggers(studentId)) {
            return QuotaCheckResult.reject("DAILY_LIMIT_REACHED");
        }
        
        // 2. 对话类型每日上限
        int typeCount = quota.getTypeCount(rule.getDialogueType());
        if (typeCount >= rule.getMaxPerDay()) {
            return QuotaCheckResult.reject("TYPE_DAILY_LIMIT_REACHED");
        }
        
        // 3. 强度等级上限
        int intensityCount = quota.getIntensityCount(rule.getCareIntensity());
        int intensityLimit = getIntensityLimit(rule.getCareIntensity(), studentId);
        if (intensityCount >= intensityLimit) {
            return QuotaCheckResult.reject("INTENSITY_LIMIT_REACHED");
        }
        
        // 4. 冷却期检查
        long lastTriggeredMin = quota.getMinutesSinceLastTrigger();
        if (lastTriggeredMin < rule.getMinIntervalMin()) {
            return QuotaCheckResult.reject("IN_COOLDOWN", 
                rule.getMinIntervalMin() - lastTriggeredMin);
        }
        
        // 5. 学生偏好检查
        StudentPreference pref = getStudentPreference(studentId);
        if (!pref.isTypeEnabled(rule.getDialogueType())) {
            return QuotaCheckResult.reject("USER_DISABLED");
        }
        if (pref.getDailyMaxInteractions() > 0 && 
            quota.getTotalCount() >= pref.getDailyMaxInteractions()) {
            return QuotaCheckResult.reject("USER_PREF_LIMIT_REACHED");
        }
        
        // 6. 安静时段检查
        if (isInQuietHours(studentId) && rule.getCareIntensity() != CareIntensity.URGENT) {
            return QuotaCheckResult.reject("QUIET_HOURS");
        }
        
        return QuotaCheckResult.pass();
    }
    
    /**
     * 获取学生自定义每日上限
     */
    private int getMaxDailyTriggers(Long studentId) {
        StudentProfile profile = profileService.getById(studentId);
        // 默认每日上限，可根据年龄段和VIP状态调整
        int baseLimit = 5;
        if (profile.isVIP()) {
            baseLimit = 8;  // VIP用户允许更多互动
        }
        if (profile.getStage() == StageEnum.KINDERGARTEN) {
            baseLimit = Math.min(baseLimit, 3);  // 幼儿用户更少打扰
        }
        StudentPreference pref = getStudentPreference(studentId);
        return Math.min(baseLimit, pref.getDailyMaxInteractions() > 0 
            ? pref.getDailyMaxInteractions() : Integer.MAX_VALUE);
    }
    
    private boolean isInQuietHours(Long studentId) {
        ZonedDateTime now = ZonedDateTime.now(ZoneId.of("Asia/Shanghai"));
        int hour = now.getHour();
        // 默认安静时段：22:00 - 07:00
        if (hour >= 22 || hour < 7) return true;
        
        // 检查学生自定义安静时段
        StudentPreference pref = getStudentPreference(studentId);
        return pref.isInQuietHours(now);
    }
}
```

### 5.2 学生偏好设置

```java
@Data
public class StudentProactivePreference {
    
    /** 是否启用主动对话 */
    private boolean enabled = true;
    
    /** 每日最大主动互动次数（0表示使用默认） */
    private int dailyMaxInteractions = 0;
    
    /** 各类型开关 */
    private Map<ProactiveDialogueType, Boolean> typeEnabled = new EnumMap<>(ProactiveDialogueType.class);
    
    /** 允许触发的时段 */
    private TimeRange allowedTimeRange = new TimeRange("07:00", "22:00");
    
    /** 是否允许在上课时间段触发 */
    private boolean allowDuringSchoolHours = false;
    
    /** 偏好的伙伴对话风格 */
    private String preferredTone = "friendly";
    
    /** 是否允许推送通知 */
    private boolean allowPushNotification = true;
    
    /** 是否允许弹窗 */
    private boolean allowPopup = true;
}
```

---

## 6. 内容生成策略

### 6.1 内容生成流程

```java
/**
 * 主动对话内容生成器
 */
@Service
public class ProactiveContentGenerator {
    
    private final DialogueStrategyTemplateService templateService;
    private final CompanionRoleService companionService;
    private final LLMService llmService;
    private final PromptBuilder promptBuilder;
    
    /**
     * 生成主动对话内容
     */
    public GeneratedDialogue generate(ProactiveDialogueContext context) {
        
        // 1. 选择对话策略模板
        DialogueStrategyTemplate template = templateService.selectTemplate(
            context.getDialogueType(),
            context.getStudentProfile(),
            context.getTriggerSignals()
        );
        
        // 2. 获取伙伴角色设定
        CompanionRole companion = companionService.getRoleForStudent(context.getStudentId());
        
        // 3. 构建 Prompt
        String systemPrompt = buildSystemPrompt(template, companion, context);
        String userPrompt = buildUserPrompt(template, context);
        
        // 4. 调用大模型生成内容
        LLMRequest request = LLMRequest.builder()
            .systemPrompt(systemPrompt)
            .userPrompt(userPrompt)
            .maxTokens(template.getMaxLength())
            .temperature(0.8)
            .timeout(Duration.ofSeconds(5))
            .fallbackStrategy(FallbackStrategy.TEMPLATE)
            .build();
        
        LLMResponse response = llmService.generate(request);
        
        // 5. 安全过滤
        String filteredText = contentFilterService.filter(response.getText());
        
        // 6. 适龄化处理
        String ageAppropriateText = ageAdaptService.adapt(
            filteredText, 
            context.getStudentProfile().getStage(),
            context.getStudentProfile().getGrade()
        );
        
        // 7. 附加多模态元素
        DialogueMetadata meta = buildMetadata(template, context);
        
        return GeneratedDialogue.builder()
            .text(ageAppropriateText)
            .metadata(meta)
            .companionRole(companion)
            .templateUsed(template.getCode())
            .build();
    }
    
    private String buildSystemPrompt(DialogueStrategyTemplate template, 
                                      CompanionRole companion,
                                      ProactiveDialogueContext context) {
        StringBuilder sb = new StringBuilder();
        sb.append("你是学生的AI学习伙伴「").append(companion.getName()).append("」。\n");
        sb.append("角色设定：").append(companion.getPersonality()).append("\n");
        sb.append("对话风格：").append(companion.getSpeechStyle()).append("\n");
        sb.append("语气要求：").append(template.getToneDescriptor()).append("\n\n");
        
        sb.append("学生信息：\n");
        sb.append("- 姓名：").append(context.getStudentName()).append("\n");
        sb.append("- 学段年级：").append(context.getStageGrade()).append("\n");
        sb.append("- 当前时间：").append(context.getCurrentTime()).append("\n\n");
        
        sb.append("注意事项：\n");
        sb.append("1. 保持对话简短自然，像朋友聊天一样\n");
        sb.append("2. 不要说教，不要使用过于正式的语言\n");
        sb.append("3. 不要提及你是AI或程序\n");
        sb.append("4. 适当使用emoji但不要过多\n");
        sb.append("5. 根据学段调整表达方式\n");
        sb.append("6. 如果是幼儿/低年级场景，使用更简单的语言\n\n");
        
        sb.append("策略说明：\n");
        sb.append(template.getSystemPrompt());
        
        return sb.toString();
    }
}
```

### 6.2 预设策略模板示例

#### 6.2.1 早晨问候模板

```yaml
template_code: MORNING_GREETING_V2
dialogue_type: CARE_GREETING
care_intensity: WHISPER
tone_descriptor: 温暖、亲切、充满活力
applicable_stage: ALL

system_prompt: |
  现在是早晨，主动向学生打个招呼。
  - 如果是工作日，可以提到今天的学习计划
  - 如果是周末，语气可以更轻松
  - 如果是考试周，给予鼓励但不要增加压力
  - 可以根据昨天的学习表现自然过渡

user_prompt_template: |
  请主动向{{student_name}}打招呼。
  背景：
  - 当前时间：{{current_time}}
  - 昨天学习情况：{{yesterday_summary}}
  - 今日待完成任务数：{{today_pending_count}}
  - 连续学习天数：{{streak_days}}

variables:
  - name: student_name
    type: string
    source: profile.name
  - name: current_time
    type: string
    source: context.now_formatted
  - name: yesterday_summary
    type: string
    source: learning.yesterday_summary
  - name: today_pending_count
    type: integer
    source: plan.today_pending
  - name: streak_days
    type: integer
    source: learning.streak_days

companion_animation: wave_hello
max_length: 80
```

#### 6.2.2 挫败感疏导模板

```yaml
template_code: FRUSTRATION_SUPPORT_V2
dialogue_type: EMOTIONAL_SUPPORT
care_intensity: WARM
tone_descriptor: 共情、温和、理解
applicable_stage: PRIMARY,MIDDLE,HIGH

system_prompt: |
  检测到学生当前可能正在经历挫败感。请主动发起关怀对话。
  - 首先共情学生的感受，承认困难是正常的
  - 不要急于给出答案或解决方案
  - 用鼓励性语言帮助学生调整心态
  - 可以分享一个"失败是成功之母"的视角
  - 如果学生连续错5题以上，建议休息一下
  - 适当使用幽默缓解紧张情绪（但不要过度）

user_prompt_template: |
  请主动关怀{{student_name}}。
  当前状态：
  - 连续答错：{{consecutive_wrong}}题
  - 已学习时长：{{session_duration_min}}分钟
  - 当前科目：{{current_subject}}
  - 疲劳度：{{fatigue_level}}
  - 最近一道错题知识点：{{last_wrong_knowledge_point}}

variables:
  - name: consecutive_wrong
    type: integer
    source: performance.consecutive_wrong
  - name: session_duration_min
    type: integer
    source: session.duration_min
  - name: current_subject
    type: string
    source: session.subject
  - name: fatigue_level
    type: string
    source: emotion.fatigue_desc
  - name: last_wrong_knowledge_point
    type: string
    source: performance.last_wrong_kp

companion_animation: gentle_pat
max_length: 150
```

#### 6.2.3 学习里程碑庆祝模板

```yaml
template_code: MILESTONE_CELEBRATE_V2
dialogue_type: MILESTONE_CELEBRATION
care_intensity: DEEP
tone_descriptor: 兴奋、骄傲、真诚
applicable_stage: ALL

system_prompt: |
  学生达成了一个学习里程碑！请帮他庆祝。
  - 表达真诚的兴奋和骄傲
  - 具体提到他完成了什么成就
  - 回顾一下这段旅程有多不容易
  - 鼓励他分享这个好消息
  - 不要过度夸张，保持真诚感

user_prompt_template: |
  请为{{student_name}}庆祝里程碑。
  里程碑信息：
  - 成就类型：{{achievement_type}}
  - 成就描述：{{achievement_desc}}
  - 过程数据：{{journey_data}}
  - 学生为此付出的天数：{{days_spent}}

variables:
  - name: achievement_type
    type: string
    source: milestone.type
  - name: achievement_desc
    type: string
    source: milestone.description
  - name: journey_data
    type: string
    source: milestone.journey_summary
  - name: days_spent
    type: integer
    source: milestone.days_spent

companion_animation: celebration_dance
bgm_type: cheerful_chime
max_length: 200
```

---

## 7. 触发事件订阅

### 7.1 事件订阅清单

引擎通过事件驱动架构订阅多种学习行为事件：

```java
/**
 * 主动对话触发事件监听器
 */
@Component
public class ProactiveDialogueEventListener {
    
    private final TriggerDecisionEngine decisionEngine;
    
    // ========== 学习行为事件 ==========
    
    @EventListener
    @Async("proactiveTriggerExecutor")
    public void onAnswerSubmitted(AnswerSubmittedEvent event) {
        TriggerContext ctx = TriggerContext.builder()
            .studentId(event.getStudentId())
            .source("ANSWER_SUBMITTED")
            .signal("consecutive_correct", event.getConsecutiveCorrect())
            .signal("consecutive_wrong", event.getConsecutiveWrong())
            .signal("is_correct", event.isCorrect())
            .signal("subject", event.getSubject())
            .signal("difficulty", event.getDifficulty())
            .build();
        decisionEngine.evaluate(ctx);
    }
    
    @EventListener
    @Async("proactiveTriggerExecutor")
    public void onChapterCompleted(ChapterCompletedEvent event) {
        TriggerContext ctx = TriggerContext.builder()
            .studentId(event.getStudentId())
            .source("CHAPTER_COMPLETED")
            .signal("chapter_id", event.getChapterId())
            .signal("mastery_level", event.getMasteryLevel())
            .signal("time_spent_min", event.getTimeSpentMin())
            .build();
        decisionEngine.evaluate(ctx);
    }
    
    @EventListener
    @Async("proactiveTriggerExecutor")
    public void onUserLogin(UserLoginEvent event) {
        TriggerContext ctx = TriggerContext.builder()
            .studentId(event.getUserId())
            .source("USER_LOGIN")
            .signal("login_hour", event.getLoginTime().getHour())
            .signal("hours_since_last_login", event.getHoursSinceLastLogin())
            .build();
        decisionEngine.evaluate(ctx);
    }
    
    @EventListener
    @Async("proactiveTriggerExecutor")
    public void onSessionIdle(SessionIdleEvent event) {
        TriggerContext ctx = TriggerContext.builder()
            .studentId(event.getStudentId())
            .source("SESSION_IDLE")
            .signal("idle_minutes", event.getIdleMinutes())
            .signal("current_activity", event.getCurrentActivity())
            .build();
        decisionEngine.evaluate(ctx);
    }
    
    @EventListener
    @Async("proactiveTriggerExecutor")
    public void onMilestoneAchieved(MilestoneAchievedEvent event) {
        TriggerContext ctx = TriggerContext.builder()
            .studentId(event.getStudentId())
            .source("MILESTONE_ACHIEVED")
            .signal("milestone_type", event.getType())
            .signal("milestone_data", event.getData())
            .build();
        decisionEngine.evaluate(ctx, Priority.HIGH); // 里程碑事件高优先级处理
    }
    
    @EventListener
    @Async("proactiveTriggerExecutor")
    public void onStudySessionEnded(StudySessionEndedEvent event) {
        TriggerContext ctx = TriggerContext.builder()
            .studentId(event.getStudentId())
            .source("STUDY_SESSION_ENDED")
            .signal("session_duration_min", event.getDurationMin())
            .signal("questions_answered", event.getQuestionsAnswered())
            .signal("accuracy", event.getAccuracy())
            .signal("chapters_studied", event.getChaptersStudied())
            .build();
        decisionEngine.evaluate(ctx);
    }
    
    @EventListener
    @Async("proactiveTriggerExecutor")
    public void onEmotionStateChanged(EmotionStateChangedEvent event) {
        // 只在情绪状态恶化时触发
        if (event.getDelta() < -0.2) {
            TriggerContext ctx = TriggerContext.builder()
                .studentId(event.getStudentId())
                .source("EMOTION_DETECTED")
                .signal("frustration_level", event.getFrustrationLevel())
                .signal("previous_emotion", event.getPreviousState())
                .signal("current_emotion", event.getCurrentState())
                .build();
            decisionEngine.evaluate(ctx, Priority.HIGH);
        }
    }
    
    // ========== 定时触发事件 ==========
    
    /**
     * 定时任务：每小时扫描一次，触发时间相关的主动对话
     */
    @Scheduled(cron = "0 0 * * * *")
    public void scheduledTimeBasedTrigger() {
        // 早晨问候窗口
        // 午间提醒窗口
        // 晚间关怀窗口
        // 长时间未登录召回
        List<Long> activeStudents = studentService.getActiveStudentIds();
        
        for (Long studentId : activeStudents) {
            TriggerContext ctx = TriggerContext.builder()
                .studentId(studentId)
                .source("SCHEDULED_TIME_BASED")
                .build();
            decisionEngine.evaluate(ctx);
        }
    }
    
    /**
     * 定时任务：每天 23:00 生成当日主动对话效果报告
     */
    @Scheduled(cron = "0 0 23 * * *")
    public void dailyEffectReport() {
        effectAnalyzer.generateDailyReport(LocalDate.now());
    }
}
```

### 7.2 定时触发窗口

```java
/**
 * 预设时间窗口触发规则
 */
@Configuration
public class ScheduledTriggerWindows {
    
    // 早晨问候窗口（工作日 7:00-9:00）
    public static final TriggerWindow MORNING_WEEKDAY = TriggerWindow.builder()
        .name("早晨问候")
        .cron("0 0 7 * * MON-FRI")
        .dialogueType(ProactiveDialogueType.CARE_GREETING)
        .maxStudentsPerBatch(500)  // 分批触发，避免峰值
        .batchIntervalSec(60)
        .build();
    
    // 午间关怀窗口（工作日 12:00-13:00）
    public static final TriggerWindow NOON_WEEKDAY = TriggerWindow.builder()
        .name("午间关怀")
        .cron("0 30 12 * * MON-FRI")
        .dialogueType(ProactiveDialogueType.CARE_GREETING)
        .filter(student -> student.isVIP() || student.getStreakDays() >= 3)
        .build();
    
    // 晚间学习提醒（工作日 18:00-20:00）
    public static final TriggerWindow EVENING_REMINDER = TriggerWindow.builder()
        .name("晚间学习提醒")
        .cron("0 0 19 * * MON-FRI")
        .dialogueType(ProactiveDialogueType.STUDY_REMINDER)
        .filter(student -> !studentService.studiedToday(student.getId()))
        .build();
    
    // 周末早安（周末 8:00-10:00）
    public static final TriggerWindow WEEKEND_MORNING = TriggerWindow.builder()
        .name("周末早安")
        .cron("0 0 8 * * SAT,SUN")
        .dialogueType(ProactiveDialogueType.CARE_GREETING)
        .build();
    
    // 考试倒计时提醒（考前7天每天提醒）
    public static final TriggerWindow EXAM_COUNTDOWN = TriggerWindow.builder()
        .name("考试倒计时")
        .triggerCondition("days_until_exam <= 7 AND days_until_exam > 0")
        .dialogueType(ProactiveDialogueType.STUDY_REMINDER)
        .build();
    
    // 流失召回（3天未登录）
    public static final TriggerWindow RETENTION_RECALL = TriggerWindow.builder()
        .name("流失召回")
        .triggerCondition("last_login_hours_ago >= 72")
        .dialogueType(ProactiveDialogueType.CARE_GREETING)
        .careIntensity(CareIntensity.GENTLE)
        .maxPerWeek(1)
        .build();
}
```

---

## 8. 优先级仲裁

当多个规则同时满足条件时，需要仲裁选择最佳的一条（或最多两条）触发。

### 8.1 仲裁策略

```java
/**
 * 优先级仲裁器
 */
@Service
public class PriorityArbiter {
    
    /**
     * 从候选规则中选择最终触发的规则
     * 
     * @param candidates 满足条件的候选规则列表
     * @param ctx 学生上下文
     * @return 最多1-2条最终规则
     */
    public List<ProactiveDialogueRule> arbitrate(
            List<ProactiveDialogueRule> candidates, 
            StudentContext ctx) {
        
        if (candidates.isEmpty()) return List.of();
        
        // 1. 按优先级排序
        candidates.sort(Comparator.comparing(ProactiveDialogueRule::getPriority).reversed());
        
        // 2. 检查是否有紧急规则
        List<ProactiveDialogueRule> urgent = candidates.stream()
            .filter(r -> r.getCareIntensity() == CareIntensity.URGENT)
            .toList();
        if (!urgent.isEmpty()) {
            return urgent.subList(0, 1); // 紧急规则独占
        }
        
        // 3. 检查规则互斥
        List<ProactiveDialogueRule> filtered = applyMutexRules(candidates);
        
        // 4. 最多选择1条（同一次评估中不触发多条）
        //    例外：WHISPER类型可以与其他类型共存
        List<ProactiveDialogueRule> result = new ArrayList<>();
        result.add(filtered.get(0));
        
        // 可选：如果第一条是 WHISPER，允许追加一条非 WHISPER
        if (filtered.get(0).getCareIntensity() == CareIntensity.WHISPER 
            && filtered.size() > 1) {
            result.add(filtered.get(1));
        }
        
        return result;
    }
    
    /**
     * 互斥规则矩阵
     */
    private static final Set<DialogueTypePair> MUTEX_PAIRS = Set.of(
        // 不能同时触发的对
        pair(ENCOURAGEMENT, EMOTIONAL_SUPPORT),     // 鼓励和情绪疏导互斥
        pair(MILESTONE_CELEBRATION, STUDY_REMINDER), // 庆祝和提醒互斥
        pair(CARE_GREETING, STUDY_REMINDER)          // 问候和提醒互斥
    );
    
    private List<ProactiveDialogueRule> applyMutexRules(
            List<ProactiveDialogueRule> candidates) {
        List<ProactiveDialogueRule> result = new ArrayList<>();
        Set<ProactiveDialogueType> usedTypes = new HashSet<>();
        
        for (ProactiveDialogueRule rule : candidates) {
            boolean hasConflict = usedTypes.stream()
                .anyMatch(used -> isMutex(used, rule.getDialogueType()));
            if (!hasConflict) {
                result.add(rule);
                usedTypes.add(rule.getDialogueType());
            }
        }
        return result;
    }
}
```

---

## 9. 通道分发策略

### 9.1 多通道路由

```java
/**
 * 通道分发器
 */
@Service
public class ChannelDispatcher {
    
    private final PushNotificationService pushService;
    private final InAppMessageService inAppService;
    private final CompanionBubbleService bubbleService;
    
    /**
     * 根据强度等级和学生状态选择最佳通道
     */
    public DispatchResult dispatch(ProactiveDialogue dialogue) {
        
        Long studentId = dialogue.getStudentId();
        boolean isOnline = sessionService.isOnline(studentId);
        boolean isAppForeground = sessionService.isAppForeground(studentId);
        CareIntensity intensity = dialogue.getCareIntensity();
        
        List<DeliveryChannel> channels = new ArrayList<>();
        
        if (isAppForeground) {
            // App 在前台
            switch (intensity) {
                case WHISPER:
                    // 仅伙伴气泡
                    channels.add(DeliveryChannel.COMPANION_BUBBLE);
                    break;
                case GENTLE:
                    // 伙伴气泡 + 底部横幅
                    channels.add(DeliveryChannel.COMPANION_BUBBLE);
                    channels.add(DeliveryChannel.BOTTOM_BANNER);
                    break;
                case WARM:
                    // 弹出伙伴对话卡片
                    channels.add(DeliveryChannel.DIALOGUE_CARD);
                    break;
                case DEEP:
                    // 全屏伙伴对话
                    channels.add(DeliveryChannel.FULLSCREEN_DIALOGUE);
                    break;
                case URGENT:
                    // 全屏 + 推送
                    channels.add(DeliveryChannel.FULLSCREEN_DIALOGUE);
                    channels.add(DeliveryChannel.PUSH_NOTIFICATION);
                    break;
            }
        } else if (isOnline) {
            // App 在后台但在线
            switch (intensity) {
                case WHISPER:
                    // 不打扰后台用户
                    break;
                case GENTLE:
                case WARM:
                    // 推送通知
                    channels.add(DeliveryChannel.PUSH_NOTIFICATION);
                    break;
                case DEEP:
                case URGENT:
                    channels.add(DeliveryChannel.PUSH_NOTIFICATION);
                    break;
            }
        } else {
            // 用户离线
            switch (intensity) {
                case WHISPER:
                case GENTLE:
                    // 离线低强度不打扰
                    break;
                default:
                    channels.add(DeliveryChannel.PUSH_NOTIFICATION);
                    break;
            }
        }
        
        // 执行分发
        for (DeliveryChannel channel : channels) {
            sendToChannel(dialogue, channel);
        }
        
        return DispatchResult.builder()
            .channels(channels)
            .deliveredAt(LocalDateTime.now())
            .build();
    }
}
```

### 9.2 通道枚举

```java
public enum DeliveryChannel {
    COMPANION_BUBBLE,      // 伙伴头像旁的对话气泡
    BOTTOM_BANNER,         // 底部横幅
    DIALOGUE_CARD,         // 弹出的对话卡片
    FULLSCREEN_DIALOGUE,   // 全屏伙伴对话
    PUSH_NOTIFICATION,     // 系统推送通知
    IN_APP_MESSAGE,        // 应用内消息中心
    SMS                    // 短信（仅紧急场景，需额外审批）
}
```

---

## 10. 效果追踪与优化

### 10.1 效果评估指标

```java
/**
 * 主动对话效果评估器
 */
@Service
public class ProactiveDialogueEffectAnalyzer {
    
    /**
     * 单条对话效果评分
     * 
     * 评分维度：
     * 1. 是否被看到（曝光率）
     * 2. 学生是否有反应（互动率）
     * 3. 学生是否回复（回复率）
     * 4. 反应是否积极（情感倾向）
     * 5. 是否触发了后续学习行为（转化率）
     */
    public DialogueEffect evaluate(Long dialogueLogId) {
        ProactiveDialogueLog log = logRepo.findById(dialogueLogId);
        
        double score = 0.0;
        
        // 曝光（15%）
        if (log.getDeliveryStatus() == DeliveryStatus.READ) {
            score += 0.15;
        }
        
        // 互动（25%）
        if (log.getStudentResponse() != null && 
            log.getStudentResponse() != StudentReaction.IGNORED) {
            score += 0.25;
        }
        
        // 回复（20%）
        if (log.isStudentReplied()) {
            score += 0.20;
        }
        
        // 正面情感（15%）
        if (isPositiveReaction(log.getStudentResponse())) {
            score += 0.15;
        }
        
        // 学习转化（25%）
        if (triggeredFollowUpStudy(log)) {
            score += 0.25;
        }
        
        return DialogueEffect.builder()
            .dialogueId(dialogueLogId)
            .score(score)
            .metrics(Map.of(
                "exposed", log.getDeliveryStatus() == DeliveryStatus.READ,
                "interacted", log.getStudentResponse() != null,
                "replied", log.isStudentReplied(),
                "positive", isPositiveReaction(log.getStudentResponse()),
                "converted", triggeredFollowUpStudy(log)
            ))
            .build();
    }
    
    /**
     * 检查主动对话后是否触发了学习行为
     */
    private boolean triggeredFollowUpStudy(ProactiveDialogueLog log) {
        // 检查对话后30分钟内是否有学习行为
        List<LearningEvent> events = eventRepo.findAfter(
            log.getStudentId(),
            log.getTriggeredAt(),
            log.getTriggeredAt().plusMinutes(30)
        );
        return !events.isEmpty();
    }
}
```

### 10.2 效果反馈闭环

```java
/**
 * 效果反馈闭环处理器
 * 
 * 每日分析效果数据，自动调整规则权重和频率
 */
@Service
public class EffectFeedbackLoop {
    
    @Scheduled(cron: "0 30 2 * * *")  // 每天凌晨 2:30 执行
    public void dailyOptimization() {
        LocalDate yesterday = LocalDate.now().minusDays(1);
        
        // 1. 按规则聚合效果
        List<RuleEffectSummary> summaries = logRepo.aggregateByRule(yesterday);
        
        for (RuleEffectSummary summary : summaries) {
            if (summary.getSampleSize() < 50) continue;  // 样本不足跳过
            
            double avgScore = summary.getAvgEffectivenessScore();
            
            // 2. 自动调整
            if (avgScore < 0.15) {
                // 效果很差：降低频率
                ruleService.adjustFrequency(summary.getRuleId(), 
                    FrequencyAdjustment.DECREASE_50_PERCENT);
                log.warn("规则 {} 效果评分 {}，自动降低触发频率", 
                    summary.getRuleId(), avgScore);
                
            } else if (avgScore > 0.5) {
                // 效果很好：可以适当提升
                ruleService.adjustFrequency(summary.getRuleId(),
                    FrequencyAdjustment.INCREASE_20_PERCENT);
            }
            
            // 3. 检查负面反应率
            if (summary.getNegativeReactionRate() > 0.3) {
                // 超过30%负面反应：暂停规则
                ruleService.pause(summary.getRuleId(), "自动暂停：负面反应率过高");
                alertService.sendAlert(AlertLevel.HIGH,
                    "主动对话规则负面反应率过高", summary);
            }
            
            // 4. 检查关闭率
            if (summary.getImmediateCloseRate() > 0.5) {
                // 超过50%立即关闭：可能太打扰
                ruleService.adjustFrequency(summary.getRuleId(),
                    FrequencyAdjustment.DECREASE_30_PERCENT);
            }
        }
        
        // 5. 生成日报
        dailyReportService.generate(yesterday);
    }
}
```

---

## 11. API 接口设计

### 11.1 内部服务接口

#### 11.1.1 触发评估接口

```yaml
POST /api/internal/proactive-dialogue/evaluate
Content-Type: application/json

Request:
{
  "studentId": 100001,
  "source": "ANSWER_SUBMITTED",
  "signals": {
    "consecutive_correct": 5,
    "consecutive_wrong": 0,
    "subject": "MATH",
    "is_correct": true,
    "session_duration_min": 25
  }
}

Response (200):
{
  "code": 0,
  "data": {
    "triggered": true,
    "dialogueId": "pd_20260706_100001_001",
    "dialogueType": "ENCOURAGEMENT",
    "careIntensity": "WHISPER",
    "content": "哇，连续5题全对！你今天状态超棒的 🔥",
    "companionName": "学神猫",
    "companionAnimation": "happy_clap",
    "channels": ["COMPANION_BUBBLE"],
    "deliverAsync": false
  }
}

Response (no trigger):
{
  "code": 0,
  "data": {
    "triggered": false,
    "reason": "IN_COOLDOWN",
    "cooldownRemainMin": 35
  }
}
```

#### 11.1.2 学生反馈上报接口

```yaml
POST /api/internal/proactive-dialogue/{dialogueId}/feedback
Content-Type: application/json

Request:
{
  "studentId": 100001,
  "response": "CLICKED",          // IGNORED / CLICKED / REPLIED / CLOSED / DISABLED
  "replyContent": null,            // 学生回复内容（如有）
  "feedbackAction": "CONTINUE_STUDY",  // 点击后执行的动作
  "responseTimeMs": 3200           // 从展示到响应的毫秒数
}

Response (200):
{
  "code": 0,
  "data": {
    "recorded": true,
    "effectScore": 0.65
  }
}
```

#### 11.1.3 频率查询接口

```yaml
GET /api/internal/proactive-dialogue/quota/{studentId}

Response (200):
{
  "code": 0,
  "data": {
    "date": "2026-07-06",
    "todayCount": 2,
    "maxPerDay": 5,
    "remainingQuota": 3,
    "lastTriggeredAt": "2026-07-06T10:30:00",
    "nextAvailableAt": "2026-07-06T11:30:00",
    "typeBreakdown": {
      "CARE_GREETING": 1,
      "ENCOURAGEMENT": 1
    },
    "intensityBreakdown": {
      "WHISPER": 1,
      "GENTLE": 1
    }
  }
}
```

### 11.2 管理后台接口

#### 11.2.1 规则管理接口

```yaml
# 创建规则
POST /api/admin/proactive-dialogue/rules

# 查询规则列表
GET /api/admin/proactive-dialogue/rules?page=1&size=20&status=ACTIVE

# 更新规则
PUT /api/admin/proactive-dialogue/rules/{ruleId}

# 暂停/恢复
PATCH /api/admin/proactive-dialogue/rules/{ruleId}/status
Body: { "status": "PAUSED", "reason": "手动暂停测试" }

# 规则效果统计
GET /api/admin/proactive-dialogue/rules/{ruleId}/effect?startDate=2026-07-01&endDate=2026-07-06

# 全局效果看板
GET /api/admin/proactive-dialogue/dashboard?date=2026-07-06
```

#### 11.2.2 学生偏好设置接口

```yaml
# 获取学生偏好
GET /api/v1/student/proactive-dialogue/preference

# 更新偏好
PUT /api/v1/student/proactive-dialogue/preference
Body:
{
  "enabled": true,
  "dailyMaxInteractions": 3,
  "typeEnabled": {
    "CARE_GREETING": true,
    "ENCOURAGEMENT": true,
    "EMOTIONAL_SUPPORT": true,
    "STUDY_REMINDER": true,
    "MILESTONE_CELEBRATION": true,
    "KNOWLEDGE_EXTENSION": false,
    "SOCIAL_INTERACTION": false,
    "LEARNING_REFLECTION": true
  },
  "allowedTimeRange": { "start": "08:00", "end": "21:30" },
  "allowPushNotification": true
}

# 关闭所有主动对话
POST /api/v1/student/proactive-dialogue/disable-all
Body: { "reason": "太频繁了" }
```

---

## 12. 错误处理与降级

### 12.1 异常处理矩阵

| 异常场景 | 处理策略 | 降级方案 |
| --- | --- | --- |
| LLM 调用超时 | 3秒超时后降级 | 使用预设模板文案（无个性化） |
| LLM 调用失败 | 重试1次后降级 | 使用上一条相似对话的缓存 |
| 学生画像服务不可用 | 跳过个性化定制 | 使用默认学段通用模板 |
| 情绪模型不可用 | 跳过情绪相关规则 | 不触发 EMOTIONAL_SUPPORT 类型 |
| 推送服务不可用 | 记录失败，不重试 | 下次 App 打开时通过气泡展示 |
| Redis 不可用 | 使用 DB 频率数据 | 降级为宽松频率限制 |
| 效果分析服务不可用 | 跳过效果评估 | 不影响主流程 |

### 12.2 熔断保护

```java
/**
 * 主动对话触发熔断器
 * 防止系统异常时大量错误触发
 */
@Component
public class ProactiveDialogueCircuitBreaker {
    
    private final CircuitBreaker circuitBreaker;
    
    @PostConstruct
    public void init() {
        circuitBreaker = CircuitBreaker.builder()
            .failureRateThreshold(50.0f)          // 50%失败率触发熔断
            .slowCallRateThreshold(80.0f)          // 80%慢调用触发熔断
            .slowCallDurationThreshold(Duration.ofSeconds(3))
            .minimumNumberOfCalls(50)               // 最少50次调用后开始计算
            .slidingWindowType(SlidingWindowType.COUNT_BASED)
            .slidingWindowSize(100)                 // 滑动窗口100次
            .waitDurationInOpenState(Duration.ofMinutes(5))  // 熔断后5分钟半开
            .permittedNumberOfCallsInHalfOpenState(10)
            .build();
    }
    
    @CircuitBreaker(name = "proactive-dialogue")
    public TriggerResult evaluateTrigger(TriggerContext ctx) {
        return decisionEngine.evaluate(ctx);
    }
}
```

### 12.3 紧急关闭开关

```java
/**
 * 全局紧急关闭开关
 * 当出现严重问题时可一键关闭所有主动对话
 */
@RestController
@RequestMapping("/api/admin/proactive-dialogue/kill-switch")
public class KillSwitchController {
    
    @PutMapping
    @RequiresPermission(Permission.SUPER_ADMIN)
    public ApiResponse toggleKillSwitch(@RequestBody KillSwitchRequest req) {
        configService.set("proactive_dialogue.global_enabled", req.isEnabled());
        if (!req.isEnabled()) {
            // 立即清除所有缓存的待触发任务
            triggerQueue.clear();
            alertService.sendAlert(AlertLevel.CRITICAL,
                "主动对话已全局关闭", "操作人: " + req.getOperator());
        }
        return ApiResponse.success();
    }
}
```

---

## 13. 并发控制与数据一致性

### 13.1 防重复触发

```java
/**
 * 使用 Redis 分布式锁防止并发重复触发
 */
@Service
public class TriggerLockService {
    
    private static final Duration LOCK_TTL = Duration.ofSeconds(10);
    
    /**
     * 尝试获取触发锁
     * 同一学生在10秒内只能被触发一次评估
     */
    public boolean tryAcquireTriggerLock(Long studentId) {
        String key = "proactive:lock:" + studentId;
        return redisTemplate.opsForValue()
            .setIfAbsent(key, "1", LOCK_TTL);
    }
    
    /**
     * 使用对话ID幂等
     */
    public boolean isDuplicateDialogue(String dialogueId) {
        String key = "proactive:dialogue:" + dialogueId;
        return Boolean.TRUE.equals(
            redisTemplate.hasKey(key)
        );
    }
}
```

### 13.2 配额更新原子性

```lua
-- Redis Lua Script: 原子更新配额
local key = KEYS[1]
local intensity_field = ARGV[1]
local type_field = ARGV[2]
local max_daily = tonumber(ARGV[3])

local current_total = tonumber(redis.call('HGET', key, 'total_count') or '0')
if current_total >= max_daily then
    return 0  -- 超限
end

redis.call('HINCRBY', key, intensity_field .. '_count', 1)
redis.call('HINCRBY', key, 'total_count', 1)
redis.call('HSET', key, 'last_triggered_at', ARGV[4])

-- 更新类型计数（Hash中的JSON字段）
local type_counts = redis.call('HGET', key, 'type_counts') or '{}'
-- 简化：使用 cjson 操作
local tc = cjson.decode(type_counts)
tc[type_field] = (tc[type_field] or 0) + 1
redis.call('HSET', key, 'type_counts', cjson.encode(tc))

return 1  -- 成功
```

### 13.3 最终一致性保障

```java
/**
 * 配额更新使用 Redis + DB 双写
 * Redis 保证实时性，DB 保证持久化
 */
@Service
public class QuotaPersistenceService {
    
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void persistQuotaUpdate(Long studentId, LocalDate date, 
                                    String intensity, String type) {
        // 使用 INSERT ... ON DUPLICATE KEY UPDATE 实现幂等
        quotaMapper.upsertQuota(studentId, date, intensity, type);
    }
    
    /**
     * 每日凌晨从 DB 校准 Redis 缓存
     */
    @Scheduled(cron = "0 0 3 * * *")
    public void reconcileQuotaCache() {
        LocalDate yesterday = LocalDate.now().minusDays(1);
        List<ProactiveDialogueQuota> dbQuotas = quotaMapper.findByDate(yesterday);
        
        for (ProactiveDialogueQuota quota : dbQuotas) {
            String key = String.format("proactive:quota:%d:%s", 
                quota.getStudentId(), yesterday);
            // 从 DB 重建缓存
            redisTemplate.opsForValue().set(key, 
                JsonUtils.toJson(quota), Duration.ofHours(48));
        }
    }
}
```

---

## 14. 安全与隐私考虑

### 14.1 数据安全

| 安全要求 | 实现方式 |
| --- | --- |
| 对话内容加密 | 主动对话文本在传输和存储中使用 TLS + AES-256 |
| 学生数据最小化 | 触发信号只采集必要字段，不存储敏感学习内容原文 |
| 对话记录保留期 | 默认保留 90 天，之后自动归档/删除 |
| 学生隐私控制 | 学生可在设置中查看所有主动对话历史并一键删除 |
| 未成年保护 | 对话内容不包含任何引导学生消费/充值的话术 |
| 审计日志 | 所有规则变更、手动触发、kill-switch 操作记录审计 |

### 14.2 内容安全

```java
/**
 * 主动对话内容安全三重检查
 */
@Service
public class ProactiveContentSafetyFilter {
    
    /**
     * 第一层：关键词过滤
     */
    public String filterKeywords(String text) {
        return sensitiveWordFilter.filter(text);
    }
    
    /**
     * 第二层：教育场景适宜性检查
     */
    public ContentSafetyResult checkEducationalAppropriateness(String text, 
                                                                StudentProfile profile) {
        // 检查是否包含不当引导（消费、社交、游戏等）
        // 检查是否适合当前学段
        // 检查是否包含考试答案泄露
        return safetyChecker.check(text, profile);
    }
    
    /**
     * 第三层：LLM 输出后处理
     */
    public String postProcess(String text, StudentProfile profile) {
        // 移除可能的系统提示泄露
        text = promptLeakDetector.sanitize(text);
        // 适龄化语言调整
        text = ageAppropriateAdapter.adapt(text, profile.getStage());
        return text;
    }
}
```

---

## 15. 测试策略

### 15.1 单元测试

```java
@DisplayName("主动对话触发引擎单元测试")
class ProactiveDialogueTriggerTest {
    
    @Test
    @DisplayName("连续答对5题应触发鼓励对话")
    void shouldTriggerEncouragementOn5ConsecutiveCorrect() {
        // Given
        TriggerContext ctx = TriggerContext.builder()
            .studentId(1L)
            .source("ANSWER_SUBMITTED")
            .signal("consecutive_correct", 5)
            .signal("is_correct", true)
            .build();
        
        // When
        TriggerResult result = decisionEngine.evaluate(ctx);
        
        // Then
        assertTrue(result.isTriggered());
        assertEquals(ProactiveDialogueType.ENCOURAGEMENT, result.getDialogueType());
    }
    
    @Test
    @DisplayName("冷却期内不应重复触发")
    void shouldNotTriggerDuringCooldown() {
        // Given
        when(quotaChecker.check(any(), any()))
            .thenReturn(QuotaCheckResult.reject("IN_COOLDOWN", 30));
        
        // When
        TriggerResult result = decisionEngine.evaluate(validContext);
        
        // Then
        assertFalse(result.isTriggered());
        assertEquals("IN_COOLDOWN", result.getReason());
    }
    
    @Test
    @DisplayName("幼儿学段每日触发上限应为3次")
    void shouldLimitKindergartenTo3PerDay() {
        // Given
        StudentProfile profile = StudentProfile.builder()
            .stage(StageEnum.KINDERGARTEN)
            .build();
        
        // When
        int limit = quotaChecker.getMaxDailyTriggers(profile);
        
        // Then
        assertEquals(3, limit);
    }
    
    @Test
    @DisplayName("安静时段不应触发非紧急对话")
    void shouldNotTriggerDuringQuietHours() {
        // Given
        when(timeProvider.now()).thenReturn(LocalTime.of(23, 30));
        
        // When
        TriggerResult result = decisionEngine.evaluate(validContext);
        
        // Then
        assertFalse(result.isTriggered());
        assertEquals("QUIET_HOURS", result.getReason());
    }
    
    @Test
    @DisplayName("学生关闭主动对话后不应触发")
    void shouldNotTriggerWhenDisabledByStudent() {
        // Given
        when(preferenceService.get(1L))
            .thenReturn(StudentProactivePreference.disabled());
        
        // When
        TriggerResult result = decisionEngine.evaluate(validContext);
        
        // Then
        assertFalse(result.isTriggered());
        assertEquals("USER_DISABLED", result.getReason());
    }
    
    @Test
    @DisplayName("里程碑事件应高优先级处理")
    void shouldProcessMilestoneWithHighPriority() {
        // Given
        MilestoneAchievedEvent event = new MilestoneAchievedEvent(
            1L, "STREAK_7_DAYS", Map.of("days", 7));
        
        // When
        listener.onMilestoneAchieved(event);
        
        // Then
        verify(decisionEngine).evaluate(any(), eq(Priority.HIGH));
    }
    
    @Test
    @DisplayName("互斥规则不应同时触发")
    void shouldNotTriggerMutexRules() {
        // Given
        List<ProactiveDialogueRule> candidates = List.of(
            createRule(ENCOURAGEMENT, 80),
            createRule(EMOTIONAL_SUPPORT, 70)  // 与 ENCOURAGEMENT 互斥
        );
        
        // When
        List<ProactiveDialogueRule> result = arbiter.arbitrate(candidates, ctx);
        
        // Then
        assertEquals(1, result.size());
        assertEquals(ENCOURAGEMENT, result.get(0).getDialogueType());
    }
}
```

### 15.2 集成测试场景

| 测试场景 | 输入 | 期望结果 |
| --- | --- | --- |
| 新用户首次登录 | 注册后立即登录 | 触发 CARE_GREETING 欢迎对话 |
| 连续学习7天后第8天登录 | 累积学习上下文 | 触发带回顾的 ENCOURAGEMENT |
| 连续答错5题 | 答题事件流 | 触发 EMOTIONAL_SUPPORT |
| 深夜打开APP | 22:00后活跃 | 不触发任何非紧急对话 |
| 考前7天每日提醒 | 定时任务 | 每天触发一次 STUDY_REMINDER |
| 关闭主动对话后 | 设置变更 | 当日内不再触发任何主动对话 |
| 同一事件触发多条规则 | 多规则同时满足 | 按优先级只触发1条 |
| LLM超时降级 | 模拟LLM超时 | 使用预设模板文案正常展示 |
| 推送服务不可用 | 模拟推送失败 | 转为应用内消息，不报错 |
| 效果评分持续低 | 连续3天低分 | 自动降低触发频率 |

### 15.3 性能测试

```
性能基准指标：
- 单次触发评估延迟：≤ 50ms（不含 LLM 生成）
- 内容生成延迟：≤ 3s（含 LLM 调用）
- 并发触发吞吐：≥ 500 TPS
- 定时批量触发：10万学生在5分钟内完成评估
- Redis 频率查询：≥ 5000 QPS
```

---

## 16. 部署与配置

### 16.1 服务部署

```yaml
# application-proactive-dialogue.yml
spring:
  application:
    name: proactive-dialogue-service
  
  datasource:
    url: jdbc:mysql://localhost:3306/primetop_proactive
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5

  redis:
    host: localhost
    port: 6379
    database: 5  # 独立DB
    lettuce:
      pool:
        max-active: 50
        max-idle: 20

# 主动对话引擎配置
proactive:
  dialogue:
    global-enabled: true
    
    # LLM 配置
    llm:
      model: gpt-4o-mini
      timeout-ms: 3000
      retry-count: 1
      fallback-to-template: true
    
    # 默认频率
    default-limits:
      max-per-day: 5
      max-per-week: 20
      min-interval-min: 30
    
    # 幼儿学段特殊限制
    stage-overrides:
      KINDERGARTEN:
        max-per-day: 3
        min-interval-min: 60
      PRIMARY:
        max-per-day: 5
        min-interval-min: 30
    
    # 安静时段
    quiet-hours:
      default-start: "22:00"
      default-end: "07:00"
    
    # 批量触发
    batch:
      scheduled-batch-size: 500
      batch-interval-sec: 60
    
    # 线程池
    executor:
      core-pool-size: 8
      max-pool-size: 32
      queue-capacity: 1000
      thread-name-prefix: "proactive-"
```

### 16.2 监控指标

```java
/**
 * Micrometer 监控指标定义
 */
@Component
public class ProactiveDialogueMetrics {
    
    private final MeterRegistry registry;
    
    // 触发总数
    public Counter triggerCounter(String dialogueType, String careIntensity) {
        return Counter.builder("proactive.dialogue.trigger")
            .tag("type", dialogueType)
            .tag("intensity", careIntensity)
            .register(registry);
    }
    
    // 触发到响应的延迟
    public Timer triggerLatencyTimer() {
        return Timer.builder("proactive.dialogue.latency")
            .publishPercentiles(0.5, 0.95, 0.99)
            .register(registry);
    }
    
    // 学生互动率
    public Gauge engagementRate(String ruleCode) {
        return Gauge.builder("proactive.dialogue.engagement", 
                () -> effectAnalyzer.getRecentEngagementRate(ruleCode))
            .tag("rule", ruleCode)
            .register(registry);
    }
    
    // 当前活跃规则数
    public Gauge activeRuleGauge() {
        return Gauge.builder("proactive.dialogue.active_rules",
                () -> ruleService.countActiveRules())
            .register(registry);
    }
    
    // LLM 降级次数
    public Counter llmFallbackCounter() {
        return Counter.builder("proactive.dialogue.llm.fallback")
            .description("LLM降级到模板的次数")
            .register(registry);
    }
}
```

---

## 17. 状态流转图

### 17.1 主动对话生命周期

```
[事件到达]
     │
     ▼
[信号采集] ─── 采集失败 ──→ [跳过，记录日志]
     │
     ▼
[规则匹配] ─── 无匹配规则 ──→ [结束]
     │
     ▼
[频率检查] ─── 超限 ──→ [记录配额日志，结束]
     │
     ▼
[优先级仲裁] ─── 被淘汰 ──→ [结束]
     │
     ▼
[获取触发锁] ─── 获取失败 ──→ [结束（已有其他线程处理）]
     │
     ▼
[内容生成] ─── LLM失败 ──→ [降级模板] ──→ [安全过滤]
     │                            │
     ▼                            ▼
[安全过滤] ←──────────────────────┘
     │
     ▼
[通道分发] ─── 推送失败 ──→ [记录失败，转为应用内消息]
     │
     ▼
[记录日志]
     │
     ▼
[等待学生反馈] ─── 超时(24h) ──→ [标记为IGNORED]
     │
     ▼
[效果评估]
     │
     ▼
[更新效果指标] ──→ [每日优化循环]
```

---

## 18. 关键交互时序图

### 18.1 实时事件触发时序

```
学生答对第5题    答题服务        触发引擎         频率检查      内容生成器      推送服务      客户端
     │              │               │              │             │            │            │
     │──────────────│               │              │             │            │            │
     │              │──事件广播─────→│              │             │            │            │
     │              │               │──查询配额────→│             │            │            │
     │              │               │←──配额通过───│             │            │            │
     │              │               │──生成内容────────────────→│            │            │
     │              │               │←──对话内容────────────────│            │            │
     │              │               │──安全过滤（内部）───│                   │            │
     │              │               │──分发（气泡）─────────────────────────────────────→│
     │              │               │              │             │            │            │
     │              │               │              │             │            │──气泡展示──→│
     │              │               │              │             │            │            │
     │              │               │              │             │            │     学生看到气泡
     │              │               │              │             │            │     点击气泡
     │              │               │←────────────────────────────────────────────────反馈上报
     │              │               │──效果评估（异步）│            │            │            │
```

---

## 19. 文档版本

| 版本 | 日期 | 变更说明 |
| --- | --- | --- |
| v1.0 | 2026-07-06 | 初始版本，包含完整的触发引擎设计 |

---

## 20. 与现有文档的关系

| 关联文档 | 关系 |
| --- | --- |
| `学生AI学习伙伴角色个性化与对话风格自适应引擎` | 本引擎决定「何时触发」，该引擎决定「用什么角色和风格说话」 |
| `学生AI学习伙伴长期记忆库与跨会话关系建构引擎` | 本引擎生成对话时可查询长期记忆库，引用过去的对话历史 |
| `AI辅导对话情感感知与自适应回应策略引擎` | 该引擎分析学生情绪，本引擎消费情绪信号做触发决策 |
| `学生学习上下文全局管理与跨模块AI感知编排引擎` | 该引擎提供学习上下文，本引擎基于上下文做场景化触发 |
| `统一学习干预编排与智能频控引擎` | 该引擎处理学习类干预（如催交作业），本引擎处理情感类/陪伴类互动 |
| `学习提醒与智能通知调度系统` | 该系统处理系统通知调度，本引擎生成的内容可通过该系统投递 |
| `多源通知智能合并与用户通知疲劳度管控引擎` | 本引擎需要参考该引擎的疲劳度评估，避免与其他通知叠加 |
| `客户端-AI学习伙伴虚拟形象与动画交互引擎` | 该引擎负责伙伴的视觉表现，本引擎输出的动画指令由该引擎执行 |