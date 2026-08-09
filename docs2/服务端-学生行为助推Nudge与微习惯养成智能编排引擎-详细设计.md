# 服务端-学生行为助推Nudge与微习惯养成智能编排引擎-详细设计

## 1. 概述

### 1.1 功能定位

本引擎基于行为经济学（Behavioral Economics）和习惯形成理论（Habit Formation Theory），为平台提供**选择架构优化**和**上下文感知行为助推**能力。与已有的积分、排行榜、打卡等外在激励体系不同，本引擎专注于通过**低摩擦引导、默认选项优化、社会证明、损失厌恶提示**等心理学机制，让学生在不知不觉中选择更优的学习行为路径。

### 1.2 设计目标

| 目标 | 说明 |
| --- | --- |
| 降低学习启动摩擦 | 在学生犹豫是否开始学习时，通过微调触达降低决策成本 |
| 锚定学习习惯 | 帮助学生将学习行为与固定时间、场景绑定，形成自动化习惯回路 |
| 提升学习持续性 | 通过 streak 机制和沉没成本提示减少中途放弃 |
| 优化学习选择 | 在"刷短视频 vs 做题"等决策点引导学生选择学习 |
| 个性化助推策略 | 根据学生画像、历史行为响应率匹配最优助推策略 |

### 1.3 与已有模块的关系

| 已有模块 | 区别 |
| --- | --- |
| 学习打卡与成就激励系统 | 打卡是显性激励（做任务→得奖励）；Nudge是隐性引导（改环境→自然做） |
| 运营弹窗规则引擎 | 运营弹窗是平台驱动的广播；Nudge是行为触发的个性化微引导 |
| 学习计划与每日任务 | 计划是学生主动设定的目标；Nudge是在学生没有计划时的环境引导 |
| 学生学习激励时刻编排 | 激励时刻聚焦正反馈触发；Nudge聚焦决策点的选择架构优化 |
| 防沉迷系统 | 防沉迷是硬性限制；Nudge是柔性引导 |

### 1.4 适用范围

- **目标用户**：全学段学生，重点覆盖自驱力较弱的小学高年级至初中阶段
- **触达渠道**：App内浮窗、推送通知、首页Banner、对话页引导条、学习报告嵌入
- **调用方**：首页服务、AI对话服务、学习计划服务、推送服务、消息中心

---

## 2. 理论基础与策略框架

### 2.1 行为助推七大策略（EAST框架扩展）

| 磁盘策略 | 理论依据 | 教育场景应用 |
| --- | --- | --- |
| **Easy（降低摩擦）** | 摩擦减少理论（Friction Reduction） | 一键继续学习、上次位置直达、减少启动步骤 |
| **Attractive（增强吸引）** | 注意力偏差（Attention Bias） | 学习入口高亮、进度可视化、未完成任务红点提醒 |
| **Social（社会证明）** | 从众效应（Conformity Bias） | "同年级XX同学正在学习"、"你的班上80%同学已完成" |
| **Timely（时机捕捉）** | 时间折扣（Temporal Discounting） | 刚放学时段推送、考试前两周加强提醒、新鲜开始效应 |
| **Default（默认选项）** | 默认效应（Default Bias） | 默认展示今日推荐任务、默认开启学习免打扰 |
| **Commitment（承诺一致性）** | 承诺一致性偏差（Commitment Consistency） | 学习计划公开承诺、每日学习意图声明 |
| **Loss（损失厌恶）** | 损失厌恶（Loss Aversion） | "你将失去7天连续学习记录"、过期未用积分提醒 |

### 2.2 习惯回路模型

基于 Charles Duhigg 的习惯回路模型和 James Clear 的原子习惯理论：

```
线索(Cue) → 渴望(Craving) → 反应(Response) → 奖励(Reward)
    ↓                                    ↓               ↓
 时间线索                              学习行为        内在满足感
 场景线索                              （低摩擦启动）   （进度可视化）
 情绪线索                                              （微成就感）
```

引擎需要识别和注入**线索**，降低**反应**摩擦，同时提供**即时微奖励**反馈。

### 2.3 行为阶段模型

基于跨理论模型（Transtheoretical Model），学生在不同阶段需要不同助推策略：

| 阶段 | 特征 | 推荐策略 |
| --- | --- | --- |
| 前意向期 | 无学习意愿，可能沉迷娱乐 | 默认选项引导 + 社会证明 + 低门槛试一试 |
| 意向期 | 想学但拖延 | 承诺机制 + 5分钟微学习 + 摩擦降低 |
| 准备期 | 准备开始 | 计划推荐 + 环境清理 + 学习入口直达 |
| 行动期 | 正在学习 | 连续性维护 + 进度可视化 + 防中断 |
| 维持期 | 已形成习惯 | 习惯锚定 + 新挑战 + 社交分享 |

---

## 3. 数据结构定义

### 3.1 助推策略定义表 `nudge_strategy`

```sql
CREATE TABLE nudge_strategy (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    strategy_code   VARCHAR(64) NOT NULL UNIQUE COMMENT '策略编码，如 EASY_CONTINE_LEARNING',
    strategy_name   VARCHAR(128) NOT NULL COMMENT '策略名称',
    category        VARCHAR(32) NOT NULL COMMENT '策略分类: EASY/ATTRACTIVE/SOCIAL/TIMELY/DEFAULT/COMMITMENT/LOSS',
    description     TEXT COMMENT '策略描述',
    trigger_type    VARCHAR(64) NOT NULL COMMENT '触发类型: EVENT/CRON/CONDITION/BEHAVIORAL',
    trigger_config  JSON NOT NULL COMMENT '触发条件配置',
    action_type     VARCHAR(64) NOT NULL COMMENT '动作类型: POPUP/PUSH/BANNER/INLINE/EFFECT',
    action_template JSON NOT NULL COMMENT '动作内容模板',
    target_segment  JSON COMMENT '目标用户分群条件',
    priority        INT DEFAULT 50 COMMENT '优先级(0-100, 越高越优先)',
    cooldown_minutes INT DEFAULT 360 COMMENT '同一用户冷却时间(分钟)',
    max_daily_per_user INT DEFAULT 3 COMMENT '每用户每日最大触达次数',
    enabled         TINYINT(1) DEFAULT 1 COMMENT '是否启用',
    experiment_id   VARCHAR(64) COMMENT '关联AB实验ID',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_trigger (trigger_type),
    INDEX idx_enabled_priority (enabled, priority)
) COMMENT='助推策略定义表';
```

### 3.2 助推触达记录表 `nudge_delivery`

```sql
CREATE TABLE nudge_delivery (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    strategy_id     BIGINT NOT NULL COMMENT '策略ID',
    strategy_code   VARCHAR(64) NOT NULL COMMENT '策略编码',
    user_id         BIGINT NOT NULL COMMENT '用户ID',
    trigger_event   VARCHAR(128) COMMENT '触发事件',
    trigger_context JSON COMMENT '触发上下文',
    action_type     VARCHAR(64) NOT NULL COMMENT '动作类型',
    action_content  JSON COMMENT '实际触达内容快照',
    delivered_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '触达时间',
    -- 用户响应
    shown_at        DATETIME COMMENT '展示时间',
    clicked_at      DATETIME COMMENT '点击时间',
    dismissed_at    DATETIME COMMENT '关闭时间',
    response_action VARCHAR(64) COMMENT '响应动作: CLICK/DISMISS/IGNORE/CONVERT',
    conversion_time_sec INT COMMENT '从触达到目标行为完成的秒数',
    -- 效果追踪
    target_behavior VARCHAR(64) COMMENT '目标行为: START_LEARNING/COMPLETE_TASK/CONTINUE_STREAK',
    target_achieved TINYINT(1) COMMENT '是否达成目标行为',
    achieved_at     DATETIME COMMENT '目标行为达成时间',
    INDEX idx_user_time (user_id, delivered_at),
    INDEX idx_strategy (strategy_id),
    INDEX idx_response (response_action)
) COMMENT='助推触达记录表';
```

### 3.3 学生行为阶段画像表 `nudge_user_profile`

```sql
CREATE TABLE nudge_user_profile (
    user_id                 BIGINT PRIMARY KEY,
    behavior_stage          VARCHAR(32) NOT NULL DEFAULT 'PRECONTEMPLATION'
        COMMENT '行为阶段: PRECONTEMPLATION/CONTEMPLATION/PREPARATION/ACTION/MAINTENANCE',
    -- 学习习惯线索
    preferred_study_hours   JSON COMMENT '偏好学习时段 ["19:00","21:00"]',
    last_study_at           DATETIME COMMENT '最近学习时间',
    avg_daily_sessions      INT DEFAULT 0 COMMENT '日均学习会话数',
    avg_session_duration    INT DEFAULT 0 COMMENT '平均会话时长(秒)',
    -- streak数据
    current_streak          INT DEFAULT 0 COMMENT '当前连续天数',
    longest_streak          INT DEFAULT 0 COMMENT '最长连续天数',
    last_streak_break_at    DATETIME COMMENT '上次streak断裂时间',
    -- 助推响应画像
    total_nudges_received   INT DEFAULT 0 COMMENT '累计收到助推次数',
    total_nudges_clicked    INT DEFAULT 0 COMMENT '累计点击助推次数',
    total_nudges_converted  INT DEFAULT 0 COMMENT '累计转化次数',
    best_response_channel   VARCHAR(32) COMMENT '最佳响应渠道: PUSH/POPUP/BANNER/INLINE',
    best_response_time      VARCHAR(32) COMMENT '最佳响应时段: MORNING/AFTERNOON/EVENING',
    fatigue_score           DECIMAL(3,2) DEFAULT 0.00 COMMENT '助推疲劳度(0-1)',
    -- 个性化参数
    loss_aversion_sensitivity DECIMAL(3,2) DEFAULT 0.50 COMMENT '损失厌恶敏感度',
    social_proof_sensitivity  DECIMAL(3,2) DEFAULT 0.50 COMMENT '社会证明敏感度',
    last_updated            DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_stage (behavior_stage),
    INDEX idx_last_study (last_study_at)
) COMMENT='学生行为助推画像表';
```

### 3.4 习惯锚点配置表 `nudge_habit_anchor`

```sql
CREATE TABLE nudge_habit_anchor (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id         BIGINT NOT NULL COMMENT '用户ID',
    anchor_type     VARCHAR(32) NOT NULL COMMENT '锚点类型: TIME/LOCATION/BEHAVIOR/EMOTION',
    anchor_config   JSON NOT NULL COMMENT '锚点配置',
    -- 例: {"time": "19:30", "days": [1,2,3,4,5], "timezone": "Asia/Shanghai"}
    -- 例: {"predecessor_behavior": "AFTER_DINNER", "context": "家庭场景"}
    linked_action   VARCHAR(64) NOT NULL COMMENT '锚定行为: START_HOMEWORK/REVIEW_MISTAKES/READ_CONTENT',
    cue_content     JSON NOT NULL COMMENT '线索内容模板',
    -- 锚点状态
    anchor_strength DECIMAL(3,2) DEFAULT 0.00 COMMENT '锚点强度(0-1, 越高越牢固)',
    trigger_count   INT DEFAULT 0 COMMENT '被触发次数',
    success_count   INT DEFAULT 0 COMMENT '成功引导次数',
    status          VARCHAR(16) DEFAULT 'ACTIVE' COMMENT 'ACTIVE/WEAKENED/BROKEN/GRADUATED',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_status (status)
) COMMENT='习惯锚点配置表';
```

### 3.5 助推频控配置表 `nudge_frequency_control`

```sql
CREATE TABLE nudge_frequency_control (
    user_id             BIGINT PRIMARY KEY,
    daily_nudge_count   INT DEFAULT 0 COMMENT '今日已触达次数',
    daily_nudge_limit   INT DEFAULT 3 COMMENT '每日触达上限',
    weekly_nudge_count  INT DEFAULT 0 COMMENT '本周已触达次数',
    weekly_nudge_limit  INT DEFAULT 12 COMMENT '每周触达上限',
    last_nudge_at       DATETIME COMMENT '最近触达时间',
    last_nudge_channel  VARCHAR(32) COMMENT '最近触达渠道',
    cooldown_until      DATETIME COMMENT '冷却截止时间',
    -- 疲劳度追踪
    consecutive_dismiss INT DEFAULT 0 COMMENT '连续忽略次数',
    fatigue_triggered   TINYINT(1) DEFAULT 0 COMMENT '是否触发疲劳保护',
    fatigue_reset_at    DATETIME COMMENT '疲劳保护重置时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_fatigue (fatigue_triggered),
    INDEX idx_cooldown (cooldown_until)
) COMMENT='助推频控配置表';
```

---

## 4. 核心引擎设计

### 4.1 引擎整体架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Nudge Orchestration Engine                         │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ 事件监听层   │  │ 条件评估层    │  │ 策略选择层    │  │ 动作执行层   │ │
│  │             │  │              │  │              │  │              │ │
│  │ • 行为事件   │→│ • 用户画像   │→│ • 策略匹配   │→│ • 渠道选择   │ │
│  │ • 时间事件   │  │ • 频控检查   │  │ • 优先级排序  │  │ • 内容渲染   │ │
│  │ • 场景事件   │  │ • 疲劳度检查  │  │ • AB分组     │  │ • 触达投递   │ │
│  │ • 外部信号   │  │ • 阶段判断    │  │ • 冲突去重   │  │ • 效果追踪   │ │
│  └─────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
│         ↑                                              ↓               │
│  ┌──────┴──────────────────────────────────────────────┴─────────────┐  │
│  │                    画像 & 反馈闭环层                                │  │
│  │  • 行为阶段评估   • 响应率学习   • 策略效果归因   • 画像更新       │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

### 4.2 事件监听层

负责订阅各类业务事件，将其转化为助推引擎可处理的标准事件格式。

```java
/**
 * 助推事件标准格式
 */
@Data
@Builder
public class NudgeEvent {
    private String eventId;          // 事件唯一ID
    private String eventType;        // 事件类型
    private Long userId;             // 用户ID
    private LocalDateTime timestamp; // 事件时间
    private Map<String, Object> context; // 事件上下文
    
    // 事件类型常量
    public static final String APP_OPENED = "APP_OPENED";
    public static final String SESSION_ENDED = "SESSION_ENDED";
    public static final String STREAK_AT_RISK = "STREAK_AT_RISK";
    public static final String LONG_IDLE = "LONG_IDLE";
    public static final String TASK_OVERDUE = "TASK_OVERDUE";
    public static final String EXAM_APPROACHING = "EXAM_APPROACHING";
    public static final String EVENING_PEAK = "EVENING_PEAK";
    public static final String POST_SCHOOL = "POST_SCHOOL";
    public static final String STUDENT_HESITATING = "STUDENT_HESITATING";
}
```

**监听的事件源：**

| 事件源 | 事件 | 说明 |
| --- | --- | --- |
| 用户行为流 | APP_OPENED, PAGE_VIEWED, SESSION_ENDED | 用户在App内的关键行为 |
| 学习会话服务 | SESSION_ENDED, IDLE_DETECTED, LOW_ENGAGEMENT | 学习会话状态变化 |
| 学习计划服务 | TASK_OVERDUE, PLAN_STALLED, GOAL_DEADLINE_NEAR | 计划执行状态 |
| 错题服务 | NEW_MISTAKE, MISTAKE_UNREVIEWED | 错题新增或未复习 |
| 系统时间 | DAILY_STUDY_WINDOW, WEEKEND_MORNING, EXAM_COUNTDOWN | 周期性时间事件 |
| 设备状态 | LOCATION_HOME, DEVICE_IDLE | 场景识别事件 |
| 推送回调 | PUSH_DELIVERED, PUSH_CLICKED, PUSH_DISMISSED | 推送投递结果 |

### 4.3 条件评估层

对每个进入的事件进行多维度条件评估，决定是否进入策略选择。

```java
/**
 * 条件评估器
 */
@Service
public class NudgeConditionEvaluator {

    @Autowired
    private NudgeUserProfileService profileService;
    @Autowired
    private NudgeFrequencyControlService freqService;
    
    /**
     * 评估是否应该对用户进行助推
     */
    public NudgeEvaluationResult evaluate(Long userId, NudgeEvent event) {
        // 1. 加载用户画像
        NudgeUserProfile profile = profileService.getOrCreate(userId);
        
        // 2. 频控检查
        FrequencyControlResult freqResult = freqService.checkFrequency(userId);
        if (freqResult.isBlocked()) {
            return NudgeEvaluationResult.blocked("FREQUENCY_LIMIT", freqResult.getReason());
        }
        
        // 3. 疲劳度检查
        if (profile.getFatigueScore() > 0.8) {
            return NudgeEvaluationResult.blocked("FATIGUE_HIGH", "用户助推疲劳度过高，暂停触达");
        }
        
        // 4. 时间适宜性检查
        if (!isGoodTimeToNudge(userId, event)) {
            return NudgeEvaluationResult.blocked("BAD_TIMING", "当前时段不宜打扰");
        }
        
        // 5. 行为阶段判断
        String stage = profile.getBehaviorStage();
        
        return NudgeEvaluationResult.pass(profile, stage, event);
    }
    
    /**
     * 判断是否是好的助推时机
     */
    private boolean isGoodTimeToNudge(Long userId, NudgeEvent event) {
        LocalDateTime now = LocalDateTime.now();
        int hour = now.getHour();
        
        // 深夜不打扰 (22:00 - 07:00)
        if (hour >= 22 || hour < 7) {
            return false;
        }
        
        // 上课时间不打扰 (08:00 - 11:30, 14:00 - 17:00 工作日)
        DayOfWeek day = now.getDayOfWeek();
        boolean isWeekday = day != DayOfWeek.SATURDAY && day != DayOfWeek.SUNDAY;
        if (isWeekday && ((hour >= 8 && hour < 12) || (hour >= 14 && hour < 17))) {
            return false;
        }
        
        return true;
    }
}
```

### 4.4 策略选择层

根据条件评估结果，从策略库中匹配最优策略。

```java
/**
 * 策略选择器
 */
@Service
public class NudgeStrategySelector {

    @Autowired
    private NudgeStrategyMapper strategyMapper;
    @Autowired
    private NudgeDeliveryService deliveryService;
    @Autowired
    private UserSegmentService userSegmentService;
    
    /**
     * 为用户选择最优助推策略
     */
    public List<NudgeCandidate> selectStrategies(NudgeEvaluationResult evaluation) {
        Long userId = evaluation.getUserId();
        String behaviorStage = evaluation.getBehaviorStage();
        NudgeEvent event = evaluation.getEvent();
        
        // 1. 查询匹配的候选策略
        List<NudgeStrategy> candidates = strategyMapper.findActiveByEventAndStage(
            event.getEventType(), behaviorStage);
        
        // 2. 用户分群过滤
        candidates = candidates.stream()
            .filter(s -> userSegmentService.match(userId, s.getTargetSegment()))
            .collect(Collectors.toList());
        
        // 3. 冷却期过滤
        candidates = filterByCooldown(candidates, userId);
        
        // 4. 评分排序
        List<NudgeCandidate> scored = candidates.stream()
            .map(s -> scoreStrategy(s, evaluation))
            .sorted(Comparator.comparingDouble(NudgeCandidate::getScore).reversed())
            .collect(Collectors.toList());
        
        // 5. 去重：同一类别只保留得分最高的
        List<NudgeCandidate> deduped = deduplicateByCategory(scored);
        
        // 6. 取Top N
        return deduped.subList(0, Math.min(3, deduped.size()));
    }
    
    /**
     * 策略评分模型
     */
    private NudgeCandidate scoreStrategy(NudgeStrategy strategy, NudgeEvaluationResult evaluation) {
        double score = strategy.getPriority() * 0.3; // 基础优先级
        
        NudgeUserProfile profile = evaluation.getProfile();
        
        // 根据用户画像调整得分
        switch (strategy.getCategory()) {
            case "SOCIAL":
                score *= (0.5 + profile.getSocialProofSensitivity());
                break;
            case "LOSS":
                score *= (0.5 + profile.getLossAversionSensitivity());
                break;
            case "EASY":
                // 行动期和维持期的学生对"降低摩擦"需求降低
                if ("ACTION".equals(profile.getBehaviorStage()) || 
                    "MAINTENANCE".equals(profile.getBehaviorStage())) {
                    score *= 0.7;
                }
                break;
            case "TIMELY":
                score *= 1.2; // 时机类策略天然有优势
                break;
        }
        
        // 历史响应率加权
        double historicalResponseRate = deliveryService.getResponseRate(
            profile.getUserId(), strategy.getStrategyCode());
        score = score * (0.6 + historicalResponseRate * 0.8);
        
        return NudgeCandidate.builder()
            .strategy(strategy)
            .score(score)
            .build();
    }
}
```

### 4.5 动作执行层

将选中的策略渲染为具体触达内容并投递。

```java
/**
 * 动作执行器
 */
@Service
public class NudgeActionExecutor {

    @Autowired
    private MessageService messageService;
    @Autowired
    private PushService pushService;
    @Autowired
    private NudgeDeliveryService deliveryService;
    
    /**
     * 执行助推动作
     */
    public void execute(NudgeCandidate candidate, NudgeEvaluationResult evaluation) {
        NudgeStrategy strategy = candidate.getStrategy();
        Long userId = evaluation.getUserId();
        
        // 1. 渲染动作内容
        NudgeActionContent content = renderContent(strategy, evaluation);
        
        // 2. 记录触达
        NudgeDelivery delivery = deliveryService.recordDelivery(
            userId, strategy, content);
        
        // 3. 根据动作类型投递
        switch (strategy.getActionType()) {
            case "POPUP":
                sendPopup(userId, content, delivery.getId());
                break;
            case "PUSH":
                sendPush(userId, content, delivery.getId());
                break;
            case "BANNER":
                sendBanner(userId, content, delivery.getId());
                break;
            case "INLINE":
                sendInlineHint(userId, content, delivery.getId());
                break;
            case "EFFECT":
                // 直接在App内触发效果（如高亮按钮）
                sendEffect(userId, content, delivery.getId());
                break;
        }
        
        // 4. 更新频控
        deliveryService.updateFrequency(userId);
    }
    
    /**
     * 渲染助推内容
     */
    private NudgeActionContent renderContent(NudgeStrategy strategy, 
            NudgeEvaluationResult evaluation) {
        JSONObject template = strategy.getActionTemplate();
        NudgeUserProfile profile = evaluation.getProfile();
        
        return NudgeActionContent.builder()
            .title(renderTemplate(template.getString("title"), profile, evaluation))
            .body(renderTemplate(template.getString("body"), profile, evaluation))
            .ctaText(template.getString("ctaText"))
            .ctaAction(template.getString("ctaAction"))
            .iconUrl(template.getString("iconUrl"))
            .build();
    }
    
    /**
     * 模板渲染（支持变量替换）
     */
    private String renderTemplate(String template, NudgeUserProfile profile, 
            NudgeEvaluationResult evaluation) {
        Map<String, String> vars = new HashMap<>();
        vars.put("{user_name}", profile.getNickname());
        vars.put("{streak_days}", String.valueOf(profile.getCurrentStreak()));
        vars.put("{peer_count}", getPeerStudyCount(profile.getUserId()));
        vars.put("{grade_name}", profile.getGradeName());
        vars.put("{subject_name}", evaluation.getSubject());
        
        String result = template;
        for (Map.Entry<String, String> entry : vars.entrySet()) {
            result = result.replace(entry.getKey(), entry.getValue());
        }
        return result;
    }
}
```

### 4.6 画像与反馈闭环层

持续学习用户对助推的响应，更新画像参数。

```java
/**
 * 助推效果反馈处理器
 */
@Service
public class NudgeFeedbackProcessor {

    @Autowired
    private NudgeUserProfileService profileService;
    @Autowired
    private NudgeDeliveryService deliveryService;
    
    /**
     * 处理用户对助推的响应
     */
    @EventListener
    public void onNudgeResponse(NudgeResponseEvent event) {
        Long userId = event.getUserId();
        Long deliveryId = event.getDeliveryId();
        String responseAction = event.getResponseAction(); // CLICK/DISMISS/IGNORE/CONVERT
        
        // 1. 更新触达记录
        deliveryService.updateResponse(deliveryId, event);
        
        // 2. 更新用户画像
        NudgeUserProfile profile = profileService.getOrCreate(userId);
        updateProfileWithResponse(profile, event);
        
        // 3. 更新策略效果统计
        deliveryService.updateStrategyStats(deliveryId, responseAction);
        
        // 4. 更新疲劳度
        updateFatigueScore(profile, responseAction);
        
        // 5. 更新行为阶段
        updateBehaviorStage(profile);
        
        profileService.save(profile);
    }
    
    /**
     * 更新疲劳度
     * 
     * 策略：
     * - CLICK: 疲劳度 -0.05
     * - CONVERT: 疲劳度 -0.10  
     * - DISMISS: 疲劳度 +0.08
     * - IGNORE: 疲劳度 +0.05
     * - 连续3次DISMISS/IGNORE: 触发疲劳保护，暂停24h
     */
    private void updateFatigueScore(NudgeUserProfile profile, NudgeResponseEvent event) {
        double delta = switch (event.getResponseAction()) {
            case "CLICK" -> -0.05;
            case "CONVERT" -> -0.10;
            case "DISMISS" -> 0.08;
            case "IGNORE" -> 0.05;
            default -> 0;
        };
        
        double newScore = Math.max(0, Math.min(1, profile.getFatigueScore() + delta));
        profile.setFatigueScore(BigDecimal.valueOf(newScore).setScale(2, RoundingMode.HALF_UP));
        
        // 连续忽略检查
        if ("DISMISS".equals(event.getResponseAction()) || "IGNORE".equals(event.getResponseAction())) {
            profile.setConsecutiveDismiss(profile.getConsecutiveDismiss() + 1);
            if (profile.getConsecutiveDismiss() >= 3) {
                // 触发疲劳保护
                freqService.enableFatigueProtection(profile.getUserId(), 24 * 60); // 24h
                profile.setConsecutiveDismiss(0);
            }
        } else {
            profile.setConsecutiveDismiss(0);
        }
    }
    
    /**
     * 自动更新行为阶段
     */
    private void updateBehaviorStage(NudgeUserProfile profile) {
        int streak = profile.getCurrentStreak();
        LocalDateTime lastStudy = profile.getLastStudyAt();
        long daysSinceLastStudy = lastStudy != null ? 
            ChronoUnit.DAYS.between(lastStudy.toLocalDate(), LocalDate.now()) : 999;
        
        String newStage;
        if (daysSinceLastStudy <= 1 && streak >= 21) {
            newStage = "MAINTENANCE";    // 21天以上连续学习
        } else if (daysSinceLastStudy <= 1 && streak >= 7) {
            newStage = "ACTION";          // 7-21天连续学习
        } else if (daysSinceLastStudy <= 3 && streak >= 3) {
            newStage = "PREPARATION";     // 有一定连续性
        } else if (daysSinceLastStudy <= 7) {
            newStage = "CONTEMPLATION";   // 最近一周有学习但不连续
        } else {
            newStage = "PRECONTEMPLATION"; // 超过一周未学习
        }
        
        profile.setBehaviorStage(newStage);
    }
    
    /**
     * 更新个性化敏感度参数
     * 使用简化版多臂老虎机（ε-greedy）思路
     */
    private void updateProfileWithResponse(NudgeUserProfile profile, 
            NudgeResponseEvent event) {
        NudgeDelivery delivery = deliveryService.getById(event.getDeliveryId());
        String category = delivery.getStrategyCategory();
        
        boolean positiveResponse = "CLICK".equals(event.getResponseAction()) || 
                                    "CONVERT".equals(event.getResponseAction());
        
        // 指数移动平均更新敏感度
        double alpha = 0.1; // 学习率
        double currentValue;
        String field;
        
        switch (category) {
            case "LOSS":
                currentValue = profile.getLossAversionSensitivity().doubleValue();
                field = "loss_aversion_sensitivity";
                break;
            case "SOCIAL":
                currentValue = profile.getSocialProofSensitivity().doubleValue();
                field = "social_proof_sensitivity";
                break;
            default:
                return;
        }
        
        double newValue = currentValue + alpha * ((positiveResponse ? 1 : 0) - currentValue);
        profileService.updateSensitiveField(profile.getUserId(), field, newValue);
    }
}
```

---

## 5. 七大助推策略详细设计

### 5.1 EASY - 降低摩擦策略

#### 5.1.1 一键继续学习

**触发条件：** 用户打开App时，存在未完成的学习会话或上次中断的学习内容。

**助推内容：**
```json
{
    "strategy_code": "EASY_CONTINUE_LEARNING",
    "trigger_type": "EVENT",
    "trigger_config": {
        "event": "APP_OPENED",
        "conditions": {
            "has_unfinished_session": true,
            "hours_since_last_session": {"gte": 2, "lte": 48}
        }
    },
    "action_type": "BANNER",
    "action_template": {
        "title": "继续上次的学习",
        "body": "你上次学到了「{last_chapter_name}」的 {last_section_name}",
        "ctaText": "继续学习",
        "ctaAction": "DEEP_LINK://{last_session_url}",
        "iconUrl": "nudge/continue_learning.png"
    },
    "cooldown_minutes": 180,
    "priority": 80
}
```

#### 5.1.2 学习入口前置

**触发条件：** 用户打开App在首页停留超过3秒未点击任何入口。

**策略：** 将"今日推荐"内容卡片自动展开，降低用户的选择成本。

#### 5.1.3 零步骤启动

**触发条件：** 推送通知被点击后。

**策略：** 跳过所有中间页面，直接进入学习内容或AI对话页面。

### 5.2 ATTRACTIVE - 增强吸引策略

#### 5.2.1 进度可视化光环

**触发条件：** 用户进入学习会话。

**策略：** 在学习内容周围渲染动态进度光环，每完成一个知识点就填充一段，利用可视差闭合心理（Zeigarnik Effect）驱动完成。

```java
/**
 * 进度光环渲染数据
 */
@Data
public class ProgressAuraData {
    private int totalSteps;           // 总步骤数
    private int completedSteps;       // 已完成步骤数
    private double completionRatio;   // 完成比例
    private String auraColor;         // 光环颜色(随进度变色)
    private String encouragementText; // 鼓励文案
    
    // 示例：
    // totalSteps=10, completedSteps=7
    // completionRatio=0.7
    // auraColor="#FFD700" (金色)
    // encouragementText="再坚持3步就完成了！"
}
```

#### 5.2.2 红点精准引导

**触发条件：** 存在重要未完成任务（如过期作业、未复习高频错题）。

**策略：** 仅在最高优先级入口显示红点，避免红点轰炸导致焦虑或脱敏。

### 5.3 SOCIAL - 社会证明策略

#### 5.3.1 同侪学习动态

**触发条件：** 用户在晚间学习时段（18:00-22:00）打开App但未开始学习。

**助推内容示例：**
```
标题：你的同学们正在学习
正文：今天已有 {peer_count} 名 {grade_name} 同学完成了学习任务
      {classmate_name} 刚完成了「{subject_name}」练习
CTA：我也要开始学习
```

**数据来源：**
```sql
-- 查询同年级今日活跃学习人数
SELECT COUNT(DISTINCT user_id) 
FROM learning_session 
WHERE user_grade = #{grade} 
  AND DATE(started_at) = CURDATE()
  AND status = 'COMPLETED';

-- 查询同班同学最近学习动态
SELECT ls.user_id, u.nickname, ls.subject, ls.started_at
FROM learning_session ls
JOIN user u ON ls.user_id = u.id
WHERE ls.user_id IN (
    SELECT classmate_id FROM class_member WHERE class_id = #{class_id}
)
AND ls.started_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE)
ORDER BY ls.started_at DESC
LIMIT 3;
```

**隐私保护：** 同班同学信息仅在用户已加入班级且平台隐私设置允许时展示；仅展示名字首字+同学，如"张同学"。

#### 5.3.2 学习贡献榜

**策略：** 展示用户在班级/年级中的学习排名，利用适度竞争激发动力（仅向上展示排名，不公开底部排名避免羞辱）。

### 5.4 TIMELY - 时机捕捉策略

#### 5.4.1 新鲜开始效应（Fresh Start Effect）

**触发时机：**
- 每周一早晨
- 每月1号
- 新学期开始
- 考试结束后的第一天
- 生日/节日

**策略：** 利用"重新开始"的心理感受，推送学习计划重置或新目标设定引导。

```json
{
    "strategy_code": "TIMELY_FRESH_START_MONDAY",
    "trigger_type": "CRON",
    "trigger_config": {
        "cron": "0 0 8 ? * MON",
        "conditions": {
            "user_not_active_today": true,
            "last_study_days_ago": {"gte": 2}
        }
    },
    "action_type": "PUSH",
    "action_template": {
        "title": "新的一周，新的开始 🌟",
        "body": "上周你完成了 {last_week_sessions} 次学习，这周设定一个小目标吧！",
        "ctaText": "制定本周计划",
        "ctaAction": "DEEP_LINK://plan/weekly"
    },
    "priority": 75
}
```

#### 5.4.2 放学后黄金窗口

**触发时机：** 工作日 16:00-18:00（放学后到家时段）

**策略：** 在学生刚到家、还没开始刷手机娱乐前，推送轻量级学习引导。

#### 5.4.3 考前焦虑转化

**触发时机：** 考试前7天、3天、1天

**策略：** 将焦虑情绪转化为备考行动力，推送"复习冲刺计划"而非"你需要学习"。

### 5.5 DEFAULT - 默认选项策略

#### 5.5.1 默认学习免打扰

**策略：** 学生开始学习后自动开启免打扰模式，默认屏蔽非学习相关通知。

#### 5.5.2 默认推荐任务

**触发条件：** 用户打开App首页且没有当日学习计划。

**策略：** 系统基于学情数据自动生成默认推荐任务列表，用户无需手动创建。

```java
/**
 * 默认任务生成器
 */
@Service
public class DefaultTaskGenerator {
    
    public List<RecommendedTask> generate(Long userId) {
        StudentProfile profile = profileService.getById(userId);
        List<RecommendedTask> tasks = new ArrayList<>();
        
        // 1. 查找最薄弱知识点
        List<WeakKnowledgePoint> weakPoints = 
            knowledgeService.getTopWeakPoints(userId, 3);
        for (WeakKnowledgePoint kp : weakPoints) {
            tasks.add(RecommendedTask.builder()
                .type("REVIEW_WEAK_POINT")
                .subject(kp.getSubject())
                .knowledgePoint(kp.getName())
                .estimatedMinutes(15)
                .reason("你的「" + kp.getName() + "」掌握度较低")
                .priority(90)
                .build());
        }
        
        // 2. 查找过期未复习的错题
        int overdueMistakes = mistakeService.countOverdueReview(userId);
        if (overdueMistakes > 0) {
            tasks.add(RecommendedTask.builder()
                .type("REVIEW_MISTAKES")
                .estimatedMinutes(20)
                .reason("你有 " + overdueMistakes + " 道错题需要复习")
                .priority(85)
                .build());
        }
        
        // 3. 今日同步课堂进度
        Chapter nextChapter = chapterService.getNextUncompleted(userId);
        if (nextChapter != null) {
            tasks.add(RecommendedTask.builder()
                .type("STUDY_CHAPTER")
                .subject(nextChapter.getSubject())
                .chapterName(nextChapter.getName())
                .estimatedMinutes(25)
                .reason("继续学习「" + nextChapter.getName() + "」")
                .priority(75)
                .build());
        }
        
        return tasks;
    }
}
```

### 5.6 COMMITMENT - 承诺一致性策略

#### 5.6.1 学习意图声明

**策略：** 在每日首次打开App时，让学生选择今日学习目标（可选项而非必选项），利用承诺一致性驱动完成。

```json
{
    "strategy_code": "COMMITMENT_DAILY_INTENT",
    "trigger_type": "EVENT",
    "trigger_config": {
        "event": "APP_OPENED",
        "conditions": {
            "is_first_open_today": true,
            "behavior_stage_in": ["CONTEMPLATION", "PREPARATION", "ACTION"]
        }
    },
    "action_type": "INLINE",
    "action_template": {
        "title": "今天打算学点什么？",
        "body": "选一个小目标，完成后有成就感 ✨",
        "options": [
            {"text": "复习错题 15分钟", "action": "SET_GOAL:mistake_review:15"},
            {"text": "做10道练习题", "action": "SET_GOAL:exercise:10"},
            {"text": "看一节知识点讲解", "action": "SET_GOAL:chapter:1"},
            {"text": "问问AI今天学什么", "action": "SET_GOAL:ai_suggest"}
        ]
    },
    "max_daily_per_user": 1,
    "priority": 70
}
```

#### 5.6.2 公开承诺板

**策略：** 在学习同伴圈展示"本周学习目标"，利用社交压力增强执行动力。

### 5.7 LOSS - 损失厌恶策略

#### 5.7.1 Streak保护提醒

**触发条件：** 用户当日连续学习记录面临断裂风险（当日还未学习，且距截止时间不足3小时）。

```json
{
    "strategy_code": "LOSS_STREAK_PROTECT",
    "trigger_type": "CRON",
    "trigger_config": {
        "cron": "0 0 20 * * ?",
        "conditions": {
            "current_streak": {"gte": 3},
            "studied_today": false
        }
    },
    "action_type": "PUSH",
    "action_template": {
        "title": "⚠️ 你的 {streak_days} 天连续学习记录需要保护！",
        "body": "只需完成1次学习（5分钟即可），就能延续你的 {streak_days} 天记录",
        "ctaText": "马上学5分钟",
        "ctaAction": "DEEP_LINK://learn/quick-start"
    },
    "priority": 90
}
```

#### 5.7.2 过期积分提醒

**策略：** 提醒用户即将过期的学习积分，利用损失厌恶促进消费和活跃。

#### 5.7.3 知识遗忘曲线预警

**策略：** 基于艾宾浩斯遗忘曲线计算"如果不复习，X知识点将在Y天后遗忘"，以量化损失的方式提醒复习。

```java
/**
 * 知识遗忘损失计算
 */
@Service
public class KnowledgeDecayCalculator {
    
    /**
     * 计算知识遗忘风险
     * 基于艾宾浩斯遗忘曲线: R = e^(-t/S)
     * R = 记忆保持率, t = 天数, S = 记忆强度
     */
    public KnowledgeDecayRisk calculateDecay(Long userId, String knowledgePointId) {
        LearningRecord lastStudy = learningRecordService
            .getLastStudyRecord(userId, knowledgePointId);
        
        if (lastStudy == null) return null;
        
        long daysSinceStudy = ChronoUnit.DAYS.between(
            lastStudy.getStudiedAt().toLocalDate(), 
            LocalDate.now());
        
        // 记忆强度因子（基于复习次数和掌握度）
        double memoryStrength = calculateMemoryStrength(lastStudy);
        
        // 当前记忆保持率
        double retentionRate = Math.exp(-daysSinceStudy / memoryStrength);
        
        // 7天后预测保持率
        double projectedRetention = Math.exp(-(daysSinceStudy + 7) / memoryStrength);
        
        // 计算知识量损失（折算为等效题目数）
        int totalProblems = lastStudy.getTotalProblemsPracticed();
        int forgettingCount = (int) (totalProblems * (1 - projectedRetention));
        
        return KnowledgeDecayRisk.builder()
            .knowledgePoint(lastStudy.getKnowledgePointName())
            .lastStudiedDays(daysSinceStudy)
            .currentRetention(retentionRate)
            .projected7DayRetention(projectedRetention)
            .estimatedLoss("如不复习，7天后你将遗忘约 " + forgettingCount + " 道题的知识")
            .urgencyLevel(daysSinceStudy > 14 ? "HIGH" : daysSinceStudy > 7 ? "MEDIUM" : "LOW")
            .build();
    }
    
    private double calculateMemoryStrength(LearningRecord record) {
        // 基于复习次数计算记忆强度
        // S = 5 * (reviewCount + 1) ^ 0.8
        return 5 * Math.pow(record.getReviewCount() + 1, 0.8);
    }
}
```

---

## 6. 习惯锚点引擎

### 6.1 习惯锚定原理

将学习行为与固定**时间锚点**或**行为锚点**绑定，形成"如果...那么..."的执行意图（Implementation Intention）。

### 6.2 锚点建立流程

```
阶段1: 锚点发现（自动识别用户行为模式）
    ↓
阶段2: 锚点建议（AI推荐最可能成功的锚点）
    ↓
阶段3: 锚点强化（连续触发，逐步提高锚点强度）
    ↓
阶段4: 锚点自动化（学生无需提醒即自动执行）
    ↓
阶段5: 锚点毕业（习惯已形成，减少主动助推）
```

### 6.3 锚点发现算法

```java
/**
 * 从用户历史行为中挖掘潜在习惯锚点
 */
@Service
public class HabitAnchorMiner {
    
    /**
     * 分析用户行为时间序列，发现高频出现的时间模式
     */
    public List<HabitAnchorCandidate> mineAnchors(Long userId) {
        // 1. 获取过去30天的学习会话记录
        List<LearningSession> sessions = sessionService
            .getRecentSessions(userId, 30);
        
        if (sessions.size() < 5) {
            return Collections.emptyList(); // 数据不足
        }
        
        // 2. 提取学习时段
        Map<String, Integer> timeSlotFrequency = new HashMap<>();
        for (LearningSession session : sessions) {
            String timeSlot = extractTimeSlot(session.getStartedAt());
            timeSlotFrequency.merge(timeSlot, 1, Integer::sum);
        }
        
        // 3. 找出频率最高的时段（至少出现5次）
        List<HabitAnchorCandidate> candidates = timeSlotFrequency.entrySet().stream()
            .filter(e -> e.getValue() >= 5)
            .sorted(Map.Entry.<String, Integer>comparingByValue().reversed())
            .map(e -> HabitAnchorCandidate.builder()
                .userId(userId)
                .anchorType("TIME")
                .anchorConfig(buildTimeConfig(e.getKey()))
                .frequency(e.getValue())
                .consistencyRate((double) e.getValue() / 30)
                .recommendedAction(determineAction(sessions, e.getKey()))
                .build())
            .collect(Collectors.toList());
        
        return candidates;
    }
    
    private String extractTimeSlot(LocalDateTime time) {
        int hour = time.getHour();
        int slot = (hour / 2) * 2; // 2小时一个槽位
        return String.format("%02d:00-%02d:59", slot, slot + 1);
    }
}
```

### 6.4 锚点强化阶段策略

| 锚点强度 | 阶段 | 助推策略 |
| --- | --- | --- |
| 0.0 - 0.2 | 初始建立 | 每日推送提醒，降低启动摩擦 |
| 0.2 - 0.4 | 初步形成 | 每日提醒 + streak保护 + 社会证明 |
| 0.4 - 0.6 | 逐步稳固 | 降低推送频率，改为app内提示 |
| 0.6 - 0.8 | 基本自动化 | 仅在streak断裂风险时提醒 |
| 0.8 - 1.0 | 完全自动化 | 锚点毕业，停止主动助推 |

---

## 7. API 接口设计

### 7.1 获取首页助推内容

```
GET /api/v1/nudge/homepage
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| userId | Long | 是 | 用户ID |
| page | String | 否 | 当前页面: HOME/AI_DIALOG/EXERCISE/MISTAKE |
| sessionId | String | 否 | 当前会话ID |

**响应示例：**

```json
{
    "code": 0,
    "data": {
        "banners": [
            {
                "id": "nudge_banner_123",
                "strategyCode": "EASY_CONTINUE_LEARNING",
                "title": "继续上次的学习",
                "body": "你上次学到了「二次函数」的 图像与性质",
                "ctaText": "继续学习",
                "ctaAction": "DEEP_LINK://learn/chapter/12345",
                "iconUrl": "https://cdn.primetop.com/nudge/continue.png",
                "dismissible": true,
                "style": "WARM_CARD"
            }
        ],
        "inlineHints": [
            {
                "id": "nudge_inline_456",
                "strategyCode": "COMMITMENT_DAILY_INTENT",
                "title": "今天打算学点什么？",
                "options": [
                    {"text": "复习错题 15分钟", "action": "SET_GOAL:mistake_review:15"},
                    {"text": "做10道练习题", "action": "SET_GOAL:exercise:10"}
                ]
            }
        ],
        "progressAura": {
            "totalSteps": 5,
            "completedSteps": 3,
            "auraColor": "#FFD700",
            "encouragementText": "再坚持2步就完成了！"
        }
    }
}
```

### 7.2 上报助推响应

```
POST /api/v1/nudge/{deliveryId}/response
```

**请求体：**

```json
{
    "responseAction": "CLICK",      // CLICK/DISMISS/IGNORE/CONVERT
    "responseTimeMs": 1234,         // 从展示到响应的毫秒数
    "targetAchieved": true,         // 是否最终达成目标行为
    "context": {
        "page": "HOME",
        "networkType": "WIFI"
    }
}
```

### 7.3 获取助推效果统计

```
GET /api/v1/nudge/stats
```

**查询参数：**

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| startDate | Date | 开始日期 |
| endDate | Date | 结束日期 |
| strategyCode | String | 策略编码(可选) |
| groupBy | String | 分组维度: STRATEGY/CATEGORY/CHANNEL |

**响应示例：**

```json
{
    "code": 0,
    "data": {
        "summary": {
            "totalDelivered": 15420,
            "totalClicked": 4623,
            "totalConverted": 1856,
            "clickRate": 0.2998,
            "conversionRate": 0.1204,
            "avgFatigueScore": 0.23
        },
        "byStrategy": [
            {
                "strategyCode": "LOSS_STREAK_PROTECT",
                "delivered": 3200,
                "clicked": 1450,
                "converted": 892,
                "clickRate": 0.4531,
                "conversionRate": 0.2788
            },
            {
                "strategyCode": "EASY_CONTINUE_LEARNING",
                "delivered": 5800,
                "clicked": 2100,
                "converted": 650,
                "clickRate": 0.3621,
                "conversionRate": 0.1121
            }
        ]
    }
}
```

### 7.4 管理端 - 策略管理接口

```
POST /api/admin/v1/nudge/strategies         // 创建策略
PUT  /api/admin/v1/nudge/strategies/{id}     // 更新策略
POST /api/admin/v1/nudge/strategies/{id}/toggle  // 启用/禁用
GET  /api/admin/v1/nudge/strategies          // 策略列表
GET  /api/admin/v1/nudge/dashboard           // 助推效果看板
```

---

## 8. 状态流转

### 8.1 助推触达状态机

```
                    ┌─────────┐
                    │ PENDING │ (策略已选中，等待执行)
                    └────┬────┘
                         │ execute()
                         ▼
                    ┌─────────┐
          ┌────────>│ DELIVERED│ (已投递到渠道)
          │         └────┬────┘
          │              │
          │     ┌────────┼────────┐
          │     ▼        ▼        ▼
          │ ┌──────┐ ┌──────┐ ┌──────┐
          │ │ SHOWN │ │EXPIRED│ │FAILED│
          │ └──┬───┘ └──────┘ └──────┘
          │    │
          │    ┌───────────┬───────────┐
          │    ▼           ▼           ▼
          │ ┌──────┐  ┌─────────┐ ┌──────┐
          │ │CLICKED│  │DISMISSED│ │IGNORED│
          │ └──┬───┘  └─────────┘ └──────┘
          │    │
          │    ▼
          │ ┌───────────┐     ┌──────────┐
          └─│ CONVERTING│────>│CONVERTED │ (目标行为达成)
            └───────────┘     └──────────┘
                 │
                 ▼
            ┌───────────┐
            │  EXPIRED  │ (超时未转化)
            └───────────┘
```

### 8.2 疲劳度状态

```
正常(0.0-0.5) ──→ 轻度疲劳(0.5-0.7) ──→ 中度疲劳(0.7-0.8) ──→ 高度疲劳(0.8-1.0)
     ↑                                                                      │
     │                                                                      ▼
     │←────────────────── 疲劳保护期(暂停24h) ←─────────────────────────┘
```

### 8.3 行为阶段流转

```
PRECONTEMPLATION ──→ CONTEMPLATION ──→ PREPARATION ──→ ACTION ──→ MAINTENANCE
       ↑                    ↑               ↑             ↑            │
       │                    │               │             │            │
       └────────────────────┴───────────────┴─────────────┴────────────┘
                              (倒退：长期不学习时回退)
```

---

## 9. 错误处理与降级策略

### 9.1 错误码定义

| 错误码 | 说明 | 处理策略 |
| --- | --- | --- |
| NUDGE_001 | 用户画像加载失败 | 使用默认画像兜底，不阻断主流程 |
| NUDGE_002 | 策略查询超时 | 返回空助推列表，不影响页面正常加载 |
| NUDGE_003 | 模板渲染失败 | 降级为通用文案 |
| NUDGE_004 | 推送投递失败 | 记录失败，不重试（避免重复推送骚扰） |
| NUDGE_005 | 频控服务不可用 | 保守策略：不触达（安全失败） |
| NUDGE_006 | AB实验分组失败 | 默认进入对照组 |

### 9.2 核心降级原则

```java
/**
 * 助推引擎的核心原则：失败时永远不影响主功能
 */
@Aspect
@Component
public class NudgeSafetyAspect {
    
    @Around("execution(* com.primetop.nudge.service..*(..))")
    public Object safeExecute(ProceedingJoinPoint pjp) {
        try {
            return pjp.proceed();
        } catch (Exception e) {
            log.warn("Nudge engine error (suppressed): {} - {}", 
                pjp.getSignature().getName(), e.getMessage());
            // 返回安全的默认值
            return getSafeDefault(pjp.getMethod().getReturnType());
        }
    }
    
    private Object getSafeDefault(Class<?> returnType) {
        if (returnType == List.class) return Collections.emptyList();
        if (returnType == Boolean.class || returnType == boolean.class) return false;
        if (returnType == NudgeActionContent.class) return NudgeActionContent.empty();
        return null;
    }
}
```

### 9.3 核心保障

| 保障项 | 策略 |
| --- | --- |
| **超时控制** | 所有助推查询总超时 ≤ 200ms，超时直接降级 |
| **异步解耦** | 助推内容获取不阻塞页面加载，通过异步加载补充 |
| **本地兜底** | 客户端缓存上一次的助推内容，网络失败时展示兜底内容 |
| **灰度发布** | 新策略上线必须经过AB测试验证效果 |
| **质量监控** | 每日监控各策略的DISMISS率和IGNORE率，超过阈值自动告警 |

---

## 10. 性能优化

### 10.1 缓存策略

```java
/**
 * 助推策略缓存 - 策略不频繁变更，使用本地缓存
 */
@Cacheable(value = "nudge_strategies", key = "#eventType + ':' + #behaviorStage")
public List<NudgeStrategy> findActiveByEventAndStage(String eventType, String behaviorStage) {
    return strategyMapper.findActiveByEventAndStage(eventType, behaviorStage);
}

/**
 * 用户画像缓存 - 更新频率低，使用Redis缓存
 */
@Cacheable(value = "nudge_user_profile", key = "#userId", unless = "#result == null")
public NudgeUserProfile getOrCreate(Long userId) {
    // ...
}

/**
 * 首页助推内容缓存 - 短期缓存，避免频繁刷新
 */
@Cacheable(value = "nudge_homepage", key = "#userId", ttl = 300) // 5分钟
public NudgeHomePageResponse getHomepageNudges(Long userId) {
    // ...
}
```

### 10.2 批量处理

推送类助推使用批量发送：

```java
/**
 * 批量助推任务（定时扫描）
 */
@Scheduled(cron = "0 */10 * * * *") // 每10分钟
public void batchDeliverScheduledNudges() {
    // 1. 扫描所有定时类策略
    List<NudgeStrategy> cronStrategies = strategyMapper
        .findCronStrategiesDueNow();
    
    // 2. 为每个策略批量查找匹配用户
    for (NudgeStrategy strategy : cronStrategies) {
        List<Long> targetUserIds = userSegmentService
            .findMatchingUsers(strategy.getTargetSegment(), 
                               strategy.getMaxBatchSize());
        
        // 3. 批量频控检查
        Map<Long, FrequencyControlResult> freqResults = 
            freqService.batchCheck(targetUserIds);
        
        // 4. 过滤并批量投递
        List<Long> eligibleUserIds = targetUserIds.stream()
            .filter(uid -> freqResults.get(uid).isAllowed())
            .collect(Collectors.toList());
        
        // 5. 批量发送推送
        pushService.batchSend(eligibleUserIds, strategy);
    }
}
```

### 10.3 数据量评估

| 数据表 | 预估日增量 | 存储策略 |
| --- | --- | --- |
| nudge_strategy | 极低（< 100条/年） | 永久保留 |
| nudge_delivery | ~50万条/日（100万DAU × 0.5触达率） | 保留90天，之后归档 |
| nudge_user_profile | ~100万条（1:1用户） | 永久保留，定期更新 |
| nudge_habit_anchor | ~100万条 | 永久保留 |
| nudge_frequency_control | ~100万条 | 每日重置 |

---

## 11. AB实验与效果度量

### 11.1 实验设计框架

```java
/**
 * 助推AB实验管理
 */
@Service
public class NudgeExperimentManager {
    
    /**
     * 为用户分配实验分组
     */
    public String assignGroup(Long userId, String experimentId) {
        // 已有分组直接返回
        String existingGroup = experimentService.getGroup(userId, experimentId);
        if (existingGroup != null) return existingGroup;
        
        // 基于用户ID哈希分组（保证同一用户每次分组一致）
        int hash = Math.abs(userId.hashCode());
        int group = hash % 100;
        
        if (group < 50) {
            return "TREATMENT"; // 实验组（50%）
        } else {
            return "CONTROL";   // 对照组（50%）
        }
    }
    
    /**
     * 效果度量指标
     */
    public ExperimentMetrics calculateMetrics(String experimentId, 
            LocalDate startDate, LocalDate endDate) {
        return ExperimentMetrics.builder()
            // 行为指标
            .dauDelta(calculateDAUDelta(experimentId, startDate, endDate))
            .avgSessionDurationDelta(calculateSessionDurationDelta(...))
            .streakRateDelta(calculateStreakRateDelta(...))
            // 学习指标
            .taskCompletionRateDelta(calculateTaskCompletionDelta(...))
            .mistakeReviewRateDelta(calculateMistakeReviewDelta(...))
            // 商业指标
            .retentionRateDelta(calculateRetentionDelta(...))
            .conversionRateDelta(calculateConversionDelta(...))
            .build();
    }
}
```

### 11.2 核心度量指标

| 指标类别 | 指标名 | 计算方式 | 目标 |
| --- | --- | --- | --- |
| 触达 | 触达率 | DELIVERED / TARGET_USERS | ≥ 95% |
| 响应 | 点击率 | CLICKED / DELIVERED | ≥ 25% |
| 转化 | 转化率 | CONVERTED / CLICKED | ≥ 30% |
| 行为 | 日均学习时长变化 | 实验组 vs 对照组 | +10% |
| 行为 | 连续学习率 | 7天streak用户占比 | +15% |
| 商业 | 7日留存率变化 | 实验组 vs 对照组 | +5% |
| 体验 | 疲劳度均值 | 全用户平均fatigue_score | ≤ 0.3 |
| 体验 | 负面反馈率 | 用户手动关闭/投诉次数 | ≤ 2% |

---

## 12. 安全与合规

### 12.1 隐私保护

| 措施 | 说明 |
| --- | --- |
| 社会证明数据脱敏 | 同班同学动态仅展示"姓氏+同学"，不暴露全名 |
| 学习数据最小化 | 助推内容仅使用必要的学情摘要，不传输详细答题记录 |
| 用户控制权 | 用户可在设置中关闭"智能学习提醒"和"行为引导" |
| 数据留存 | 触达记录保留90天后自动匿名化处理 |

### 12.2 未成年人保护

| 措施 | 说明 |
| --- | --- |
| 触达频率上限 | 未成年用户每日助推上限降至2次（成年用户3次） |
| 深夜禁止触达 | 22:00-08:00 绝对禁止任何助推推送 |
| 内容安全审核 | 所有助推文案模板需经内容安全审核后才可上线 |
| 家长可见性 | 家长可在家长中心查看孩子的助推记录并调整设置 |
| 不诱导消费 | 助推内容不得包含会员购买、增值服务购买等消费引导 |
| 心理安全 | 不使用羞辱性或过度焦虑式表达，如"你再不学就完了" |

### 12.3 审计日志

```sql
CREATE TABLE nudge_audit_log (
    id           BIGINT PRIMARY KEY AUTO_INCREMENT,
    operator     VARCHAR(64) NOT NULL COMMENT '操作人',
    action       VARCHAR(32) NOT NULL COMMENT 'CREATE/UPDATE/TOGGLE/DELETE',
    target_type  VARCHAR(32) NOT NULL COMMENT 'STRATEGY/SEGMENT/TEMPLATE',
    target_id    BIGINT COMMENT '目标ID',
    change_desc  TEXT COMMENT '变更描述',
    old_value    JSON COMMENT '旧值',
    new_value    JSON COMMENT '新值',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_target (target_type, target_id),
    INDEX idx_operator (operator)
) COMMENT='助推审计日志表';
```

---

## 13. 部署与配置

### 13.1 服务部署

| 配置项 | 推荐值 | 说明 |
| --- | --- | --- |
| 实例数 | ≥ 2 | 高可用最低要求 |
| JVM内存 | 2G-4G | 根据实际负载调整 |
| 数据库连接池 | 20-50 | 控制在数据库总连接限制内 |
| Redis连接池 | 20-30 | 画像和频控缓存 |
| HTTP超时 | 200ms | 助推查询超时阈值 |
| 定时任务线程池 | 5-10 | 批量推送和Cron策略 |

### 13.2 关键配置参数

```yaml
nudge:
  # 全局开关
  enabled: true
  # 默认每日触达上限
  default_daily_limit: 3
  # 未成年用户每日触达上限
  minor_daily_limit: 2
  # 默认冷却时间（分钟）
  default_cooldown_minutes: 360
  # 疲劳度阈值
  fatigue_threshold: 0.8
  # 疲劳保护时长（小时）
  fatigue_protection_hours: 24
  # 查询超时（毫秒）
  query_timeout_ms: 200
  # 每次返回最大助推条数
  max_nudges_per_request: 3
  # 允许触达的时间段
  allowed_hours: "07:00-22:00"
  # 上课时间禁止触达（工作日）
  school_hours_blocked: true
  school_hours: "08:00-12:00,14:00-17:00"
```

---

## 14. 总结

本引擎通过**行为经济学助推理论**和**习惯形成科学**，在不依赖积分奖励、排行榜等外在激励的前提下，通过优化选择架构和降低学习启动摩擦，帮助学生自然地形成良好学习习惯。

核心设计亮点：

1. **七大助推策略体系**：覆盖EAST框架（Easy/Attractive/Social/Timely）+ Default + Commitment + Loss，形成完整的助推工具箱
2. **行为阶段模型**：根据学生所处的行为改变阶段（前意向→意向→准备→行动→维持）自动调整助推策略
3. **习惯锚点引擎**：自动发现和强化用户的学习时间模式，将偶发行为转化为自动化习惯
4. **疲劳度管控**：通过响应率学习和连续忽略检测，自动调节助推频率，避免用户产生反感
5. **安全降级**：所有助推逻辑失败时永远不影响主功能，确保用户体验不受损
6. **AB实验驱动**：每个新策略上线必须经过AB测试验证效果，数据驱动迭代