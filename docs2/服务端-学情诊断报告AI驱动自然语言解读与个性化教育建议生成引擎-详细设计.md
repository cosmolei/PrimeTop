# 服务端-学情诊断报告AI驱动自然语言解读与个性化教育建议生成引擎 详细设计

## 1. 概述

### 1.1 模块定位

本引擎是学情报告系统的"大脑"层，负责将结构化学习数据（答题记录、错题分布、学习时长、知识点掌握度等）转化为**自然语言诊断解读**和**个性化教育建议**，面向学生、家长、教师三类角色生成差异化的报告文案。

与已有模块的关系：
- **上游**：依赖`学情分析服务`、`学习记录与进度追踪服务`、`答题记录服务`、`知识追踪模型引擎`等提供结构化数据
- **下游**：输出给`学习报告生成与交付服务`进行排版渲染，通过`消息与推送服务`触达用户
- **并行**：与`智能数据问答与自然语言学习数据查询引擎`互补——后者是用户主动查询的即问即答，本引擎是系统主动生成的定期/事件触发的诊断报告

### 1.2 核心职责

| 职责 | 说明 |
| --- | --- |
| 数据聚合与特征提取 | 从多个数据源拉取学习数据，提取诊断特征向量 |
| AI诊断解读生成 | 调用大模型将数据转化为自然语言诊断文本 |
| 个性化建议生成 | 基于诊断结果生成可执行的学习建议 |
| 多角色适配 | 同一份数据面向学生/家长/教师生成不同视角的文案 |
| 质量保障 | 对AI生成内容进行事实校验与安全过滤 |
| 定时与事件触发 | 支持周报、月报、考前报告、异常预警等触发模式 |

### 1.3 依赖关系

```
┌─────────────────────────────────────────────────────────┐
│                   外部数据源 (上游)                       │
├──────────┬──────────┬──────────┬──────────┬──────────────┤
│ 学情分析  │ 答题记录  │ 错题服务  │ 学习规划  │ 知识追踪模型 │
│   服务   │   服务   │          │   服务   │   引擎      │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┴──────┬───────┘
     │          │          │          │            │
     ▼          ▼          ▼          ▼            ▼
┌─────────────────────────────────────────────────────────┐
│              数据聚合与特征提取层 (DataAggregator)        │
│  · 学习数据快照拉取 · 特征向量构建 · 时序对比计算         │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│           诊断规则引擎 (DiagnosisRuleEngine)             │
│  · 阈值规则 · 趋势分析 · 异常检测 · 诊断标签生成          │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│       AI诊断解读生成器 (NLGReportGenerator)              │
│  · Prompt编排 · 大模型调用 · 多角色文案适配              │
│  · 流式生成 · 事实校验 · 安全过滤                        │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│          报告编排与交付层 (ReportOrchestrator)            │
│  · 报告组装 · 版本管理 · 缓存 · 推送触发                 │
└─────────────────────────────────────────────────────────┘
```

## 2. 数据模型

### 2.1 核心实体定义

#### 2.1.1 诊断报告主表 `diagnosis_report`

```sql
CREATE TABLE diagnosis_report (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    report_no       VARCHAR(64) NOT NULL UNIQUE COMMENT '报告编号 DR+yyyyMMdd+seq',
    user_id         BIGINT NOT NULL COMMENT '学生用户ID',
    report_type     VARCHAR(32) NOT NULL COMMENT '报告类型: WEEKLY/MONTHLY/EXAM_PREP/EVENT_TRIGGER',
    target_role     VARCHAR(16) NOT NULL COMMENT '目标角色: STUDENT/PARENT/TEACHER',
    period_start    DATE NOT NULL COMMENT '统计周期开始日期',
    period_end      DATE NOT NULL COMMENT '统计周期结束日期',
    status          VARCHAR(16) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/GENERATING/COMPLETED/FAILED/REVIEWING',
    data_snapshot   JSON COMMENT '聚合数据快照(特征向量)',
    diagnosis_tags  JSON COMMENT '诊断标签列表',
    nlg_content     MEDIUMTEXT COMMENT 'AI生成的自然语言诊断内容',
    suggestions     JSON COMMENT '个性化建议列表',
    quality_score   DECIMAL(3,2) COMMENT 'AI内容质量评分 0-1',
    model_info      VARCHAR(128) COMMENT '生成模型信息 model@version',
    token_cost      INT COMMENT 'Token消耗量',
    generate_time   INT COMMENT '生成耗时(毫秒)',
    review_status   VARCHAR(16) DEFAULT 'AUTO_PASSED' COMMENT 'AUTO_PASSED/PENDING_REVIEW/APPROVED/REJECTED',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    tenant_id       BIGINT COMMENT '租户ID',
    INDEX idx_user_type (user_id, report_type, period_start),
    INDEX idx_status (status, review_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学情诊断报告';
```

#### 2.1.2 诊断特征向量 `diagnosis_feature`

```sql
CREATE TABLE diagnosis_feature (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    report_id       BIGINT NOT NULL COMMENT '关联报告ID',
    feature_key     VARCHAR(64) NOT NULL COMMENT '特征键',
    feature_value   DECIMAL(12,4) COMMENT '数值型特征值',
    feature_text    VARCHAR(256) COMMENT '文本型特征值',
    feature_unit    VARCHAR(32) COMMENT '单位',
    prev_value      DECIMAL(12,4) COMMENT '上期值(用于对比)',
    change_rate     DECIMAL(8,4) COMMENT '变化率',
    percentile      DECIMAL(5,2) COMMENT '同龄人百分位',
    is_anomaly      TINYINT DEFAULT 0 COMMENT '是否异常 0/1',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_report (report_id),
    INDEX idx_key (feature_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='诊断特征向量';
```

#### 2.1.3 个性化建议 `diagnosis_suggestion`

```sql
CREATE TABLE diagnosis_suggestion (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    report_id       BIGINT NOT NULL COMMENT '关联报告ID',
    suggestion_type VARCHAR(32) NOT NULL COMMENT '建议类型: STUDY_PLAN/REVIEW/FOCUS/TIME_MGMT/PSYCHOLOGY',
    priority        INT NOT NULL DEFAULT 50 COMMENT '优先级 1-100, 越大越优先',
    target_subject  VARCHAR(32) COMMENT '目标学科, NULL表示全科',
    target_kp_ids   JSON COMMENT '目标知识点ID列表',
    title           VARCHAR(200) NOT NULL COMMENT '建议标题',
    content         TEXT NOT NULL COMMENT '建议详细内容(AI生成)',
    action_type     VARCHAR(32) COMMENT '动作类型: PRACTICE/REVIEW/WATCH/ASK_AI/CUSTOM',
    action_params   JSON COMMENT '动作参数(如题目范围、知识点等)',
    expected_effort VARCHAR(32) COMMENT '预计耗时: 15min/30min/1h/2h',
    UNIQUE INDEX uk_report_type_sub (report_id, suggestion_type, target_subject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='个性化教育建议';
```

#### 2.1.4 报告模板配置 `report_template`

```sql
CREATE TABLE report_template (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    template_code   VARCHAR(64) NOT NULL UNIQUE COMMENT '模板编码',
    report_type     VARCHAR(32) NOT NULL COMMENT '报告类型',
    target_role     VARCHAR(16) NOT NULL COMMENT 'STUDENT/PARENT/TEACHER',
    grade_range     VARCHAR(32) NOT NULL COMMENT '适用学段: KINDERGARTEN/PRIMARY/JUNIOR/SENIOR/ALL',
    prompt_template TEXT NOT NULL COMMENT 'Prompt模板(LLM填充)',
    sections        JSON NOT NULL COMMENT '报告章节配置',
    tone            VARCHAR(32) DEFAULT 'ENCOURAGING' COMMENT '语气: ENCOURAGING/OBJECTIVE/DETAILED',
    enabled         TINYINT DEFAULT 1,
    version         INT DEFAULT 1,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='报告模板配置';
```

#### 2.1.5 报告生成任务 `report_generation_task`

```sql
CREATE TABLE report_generation_task (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_no         VARCHAR(64) NOT NULL UNIQUE,
    report_type     VARCHAR(32) NOT NULL,
    trigger_type    VARCHAR(32) NOT NULL COMMENT 'SCHEDULED/MANUAL/EVENT',
    target_users    JSON NOT NULL COMMENT '目标用户ID列表或筛选条件',
    template_id     BIGINT COMMENT '使用的模板ID',
    status          VARCHAR(16) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/RUNNING/PAUSED/COMPLETED/FAILED',
    total_count     INT DEFAULT 0,
    success_count   INT DEFAULT 0,
    fail_count      INT DEFAULT 0,
    scheduled_at    DATETIME NOT NULL COMMENT '计划执行时间',
    started_at      DATETIME COMMENT '实际开始时间',
    completed_at    DATETIME COMMENT '完成时间',
    error_msg       TEXT,
    created_by      BIGINT NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_status_scheduled (status, scheduled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='报告批量生成任务';
```

### 2.2 缓存策略

| 缓存键 | TTL | 说明 |
| --- | --- | --- |
| `report:data_snapshot:{userId}:{period}` | 24h | 聚合数据快照，避免重复查询 |
| `report:nlg_cache:{userId}:{type}:{period}:{role}` | 7d | NLG结果缓存，同类同期不重复生成 |
| `report:template:{code}:v{version}` | 1h | 模板缓存 |
| `report:generating:lock:{userId}:{type}` | 5min | 生成锁，防止并发重复生成 |
| `report:feature:{userId}:latest` | 1h | 最新特征向量缓存 |

## 3. API 接口设计

### 3.1 接口总览

| 序号 | 接口 | 方法 | 说明 |
| --- | --- | --- | --- |
| 1 | `/api/v1/diagnosis-reports/generate` | POST | 手动触发报告生成 |
| 2 | `/api/v1/diagnosis-reports` | GET | 查询报告列表 |
| 3 | `/api/v1/diagnosis-reports/{reportNo}` | GET | 获取报告详情 |
| 4 | `/api/v1/diagnosis-reports/{reportNo}/suggestions` | GET | 获取建议列表 |
| 5 | `/api/v1/diagnosis-reports/{reportNo}/feedback` | POST | 提交报告反馈 |
| 6 | `/api/v1/diagnosis-reports/preview` | POST | 预览诊断(不保存) |
| 7 | `/api/v1/diagnosis-reports/batch-generate` | POST | 批量生成(管理后台) |
| 8 | `/api/v1/admin/report-templates` | CRUD | 模板管理(管理后台) |

### 3.2 核心接口详细设计

#### 3.2.1 手动触发报告生成

```
POST /api/v1/diagnosis-reports/generate
Authorization: Bearer {token}
Content-Type: application/json
```

**请求体：**
```json
{
  "reportType": "WEEKLY",
  "targetRole": "PARENT",
  "periodStart": "2026-07-07",
  "periodEnd": "2026-07-13",
  "forceRefresh": false,
  "priority": "NORMAL"
}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "reportNo": "DR20260714001",
    "status": "GENERATING",
    "estimatedTime": 15
  }
}
```

#### 3.2.2 获取报告详情

```
GET /api/v1/diagnosis-reports/{reportNo}?role=PARENT
Authorization: Bearer {token}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "reportNo": "DR20260714001",
    "reportType": "WEEKLY",
    "targetRole": "PARENT",
    "periodStart": "2026-07-07",
    "periodEnd": "2026-07-13",
    "status": "COMPLETED",
    "studentName": "小明",
    "grade": "初一",
    "sections": [
      {
        "sectionKey": "overview",
        "title": "本周学习概览",
        "summary": "本周小明共学习 5 天，累计学习时长 12.5 小时，较上周增加 8%。整体学习投入度较高。",
        "metrics": [
          {"key": "study_days", "label": "学习天数", "value": 5, "unit": "天", "changeRate": 0},
          {"key": "total_study_time", "label": "学习时长", "value": 12.5, "unit": "小时", "changeRate": 0.08}
        ]
      },
      {
        "sectionKey": "subject_analysis",
        "title": "学科表现分析",
        "summary": "数学表现突出，正确率达 85%，高于同龄人前 30% 水平。英语阅读理解存在薄弱，正确率仅 62%，建议重点关注。",
        "metrics": [
          {"key": "math_accuracy", "label": "数学正确率", "value": 0.85, "changeRate": 0.05, "percentile": 70.0},
          {"key": "english_accuracy", "label": "英语正确率", "value": 0.62, "changeRate": -0.08, "percentile": 35.0}
        ]
      },
      {
        "sectionKey": "weakness_diagnosis",
        "title": "薄弱知识点诊断",
        "summary": "一元一次方程应用题和英语定语从句是本周主要失分点。一元一次方程应用题已连续 3 周正确率低于 60%，属于持续性薄弱，建议尽快集中突破。",
        "diagnosisTags": ["PERSISTENT_WEAKNESS", "DOWNWARD_TREND"]
      },
      {
        "sectionKey": "recommendation",
        "title": "下周学习建议",
        "summary": "建议下周适当增加英语阅读练习时间，同时继续巩固数学优势。针对一元一次方程应用题，推荐完成「启硕专项突破」中的 10 道精选练习题。"
      }
    ],
    "suggestions": [...],
    "generatedAt": "2026-07-14T06:12:33Z",
    "modelInfo": "glm-4.6@v2.1"
  }
}
```

#### 3.2.3 预览诊断（不保存）

```
POST /api/v1/diagnosis-reports/preview
Authorization: Bearer {token}
Content-Type: application/json
```

**请求体：**
```json
{
  "reportType": "WEEKLY",
  "targetRole": "STUDENT",
  "periodStart": "2026-07-07",
  "periodEnd": "2026-07-13",
  "includeSuggestions": true,
  "maxSuggestions": 3
}
```

**响应：** 同 3.2.2 但不创建数据库记录。

### 3.3 错误码定义

| 错误码 | HTTP状态码 | 说明 |
| --- | --- | --- |
| `REPORT_NOT_FOUND` | 404 | 报告不存在 |
| `REPORT_GENERATING` | 409 | 报告正在生成中，请稍后 |
| `REPORT_GENERATION_FAILED` | 500 | 报告生成失败 |
| `INSUFFICIENT_DATA` | 422 | 数据不足，无法生成诊断报告（需至少3天学习数据） |
| `TEMPLATE_NOT_FOUND` | 404 | 找不到适用的报告模板 |
| `RATE_LIMIT_EXCEEDED` | 429 | 生成频率超限（同一类型每周最多3次手动触发） |
| `LLM_SERVICE_UNAVAILABLE` | 503 | 大模型服务暂不可用，请稍后重试 |
| `CONTENT_REJECTED` | 422 | AI生成内容未通过安全审核 |

## 4. 业务逻辑

### 4.1 核心流程：报告生成全链路

```
用户触发/定时触发
      │
      ▼
┌─────────────────┐     ┌──────────────────┐
│ 1. 请求校验     │────▶│ 2. 获取分布式锁  │
│ · 权限校验      │     │ · 防并发重复生成  │
│ · 频率限制      │     └────────┬─────────┘
│ · 数据充足性检查 │              │
└─────────────────┘              ▼
                       ┌──────────────────┐
                       │ 3. 数据聚合      │
                       │ · 拉取多源数据    │
                       │ · 特征提取       │
                       │ · 时序对比计算   │
                       └────────┬─────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │ 4. 规则诊断      │
                       │ · 阈值判定       │
                       │ · 趋势识别       │
                       │ · 异常检测       │
                       │ · 标签生成       │
                       └────────┬─────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │ 5. NLG生成       │
                       │ · Prompt组装     │
                       │ · 模型调用(SSE)  │
                       │ · 多角色适配     │
                       │ · 超时控制       │
                       └────────┬─────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │ 6. 后处理        │
                       │ · 事实校验       │
                       │ · 安全过滤       │
                       │ · 质量评分       │
                       │ · 建议生成       │
                       └────────┬─────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │ 7. 持久化 & 通知  │
                       │ · 写入DB         │
                       │ · 缓存更新       │
                       │ · 推送通知       │
                       └──────────────────┘
```

### 4.2 数据聚合与特征提取

#### 4.2.1 特征向量定义

```java
/**
 * 学情诊断特征向量
 * 包含从多源数据中提取的诊断特征
 */
public class DiagnosisFeatureVector {
    // ===== 基础学习行为特征 =====
    private int studyDays;                  // 学习天数
    private double totalStudyTime;          // 总学习时长(小时)
    private double avgDailyStudyTime;       // 日均学习时长
    private double studyTimeChangeRate;     // 学习时长环比变化率
    private int activeSubjects;             // 活跃学科数
    
    // ===== 答题表现特征 =====
    private int totalQuestions;             // 答题总数
    private double overallAccuracy;         // 总体正确率
    private double accuracyChangeRate;      // 正确率环比变化
    private Map<String, Double> subjectAccuracy;   // 分学科正确率
    private Map<String, Double> subjectChangeRate; // 分学科环比
    
    // ===== 知识点掌握特征 =====
    private Map<String, Double> masteryDistribution; // 掌握度分布 (精通/良好/一般/薄弱)
    private List<String> weakKpIds;                 // 薄弱知识点ID
    private List<String> persistentWeakKpIds;       // 持续薄弱知识点(连续3周+)
    private List<String> improvedKpIds;             // 进步明显知识点
    
    // ===== 错题特征 =====
    private int newMistakes;                // 新增错题数
    private int reviewedMistakes;           // 已复习错题数
    private double mistakeReviewRate;       // 错题复习完成率
    private double mistakeRepeatRate;       // 错题重做错误率
    
    // ===== 学习计划特征 =====
    private int plannedTasks;               // 计划任务数
    private int completedTasks;             // 完成任务数
    private double taskCompletionRate;      // 任务完成率
    private double planDeviationDays;       // 计划偏离天数
    
    // ===== AI辅导特征 =====
    private int aiConversationCount;        // AI对话次数
    private double avgConversationQuality;  // 平均对话质量评分
    private Set<String> askedTopics;        // 涉及的主题/知识点
    
    // ===== 对比特征 =====
    private double percentileRank;          // 同龄人百分位排名
    private Map<String, Double> subjectPercentiles; // 分学科百分位
    
    // ===== 时序特征 =====
    private List<WeeklyTrend> weeklyTrends; // 最近4-8周趋势数据
}
```

#### 4.2.2 数据聚合服务

```java
@Service
@Slf4j
public class ReportDataAggregator {
    
    @Autowired private StudyRecordClient studyRecordClient;
    @Autowired private AnswerRecordClient answerRecordClient;
    @Autowired private MistakeRecordClient mistakeRecordClient;
    @Autowired private KnowledgeTrackingClient knowledgeTrackingClient;
    @Autowired private StudyPlanClient studyPlanClient;
    @Autowired private AIConversationClient aiConversationClient;
    
    /**
     * 聚合指定时间段的学情数据，构建特征向量
     */
    @Retryable(maxAttempts = 3, backoff = @Backoff(delay = 1000, multiplier = 2))
    @Cacheable(value = "report:data_snapshot", key = "#userId + ':' + #periodStart + ':' + #periodEnd")
    public DiagnosisFeatureVector aggregate(Long userId, LocalDate periodStart, LocalDate periodEnd) {
        log.info("开始聚合用户 {} 的学情数据, 周期: {} ~ {}", userId, periodStart, periodEnd);
        
        // 并行拉取多源数据
        CompletableFuture<StudySummary> studyFuture = CompletableFuture.supplyAsync(
            () -> studyRecordClient.getSummary(userId, periodStart, periodEnd));
        CompletableFuture<AnswerSummary> answerFuture = CompletableFuture.supplyAsync(
            () -> answerRecordClient.getSummary(userId, periodStart, periodEnd));
        CompletableFuture<MistakeSummary> mistakeFuture = CompletableFuture.supplyAsync(
            () -> mistakeRecordClient.getSummary(userId, periodStart, periodEnd));
        CompletableFuture<MasterySnapshot> masteryFuture = CompletableFuture.supplyAsync(
            () -> knowledgeTrackingClient.getSnapshot(userId, periodEnd));
        CompletableFuture<PlanExecutionSummary> planFuture = CompletableFuture.supplyAsync(
            () -> studyPlanClient.getExecutionSummary(userId, periodStart, periodEnd));
        CompletableFuture<AIConversationSummary> aiFuture = CompletableFuture.supplyAsync(
            () -> aiConversationClient.getSummary(userId, periodStart, periodEnd));
        
        // 获取上期数据用于对比
        LocalDate prevStart = periodStart.minusDays(periodStart.until(periodEnd).getDays() + 1);
        LocalDate prevEnd = periodStart.minusDays(1);
        CompletableFuture<AnswerSummary> prevAnswerFuture = CompletableFuture.supplyAsync(
            () -> answerRecordClient.getSummary(userId, prevStart, prevEnd));
        
        // 获取历史趋势
        CompletableFuture<List<WeeklyTrend>> trendFuture = CompletableFuture.supplyAsync(
            () -> answerRecordClient.getWeeklyTrends(userId, periodEnd, 8));
        
        // 等待全部完成
        CompletableFuture.allOf(studyFuture, answerFuture, mistakeFuture, 
            masteryFuture, planFuture, aiFuture, prevAnswerFuture, trendFuture).join();
        
        // 构建特征向量
        DiagnosisFeatureVector vector = new DiagnosisFeatureVector();
        buildStudyFeatures(vector, studyFuture.join());
        buildAnswerFeatures(vector, answerFuture.join(), prevAnswerFuture.join());
        buildMistakeFeatures(vector, mistakeFuture.join());
        buildMasteryFeatures(vector, masteryFuture.join());
        buildPlanFeatures(vector, planFuture.join());
        buildAIFeatures(vector, aiFuture.join());
        vector.setWeeklyTrends(trendFuture.join());
        
        // 计算百分位排名(异步，不阻塞主流程)
        try {
            PercentileResult percentile = answerRecordClient.getPercentile(userId, periodEnd);
            vector.setPercentileRank(percentile.getOverall());
            vector.setSubjectPercentiles(percentile.getBySubject());
        } catch (Exception e) {
            log.warn("获取百分位排名失败, 用户: {}", userId, e);
        }
        
        return vector;
    }
}
```

### 4.3 诊断规则引擎

```java
@Service
@Slf4j
public class DiagnosisRuleEngine {
    
    /**
     * 对特征向量执行诊断规则，生成诊断标签和优先级
     */
    public DiagnosisResult diagnose(DiagnosisFeatureVector vector) {
        List<DiagnosisTag> tags = new ArrayList<>();
        List<DiagnosisFinding> findings = new ArrayList<>();
        
        // 规则1: 学习投入度评估
        evaluateStudyEngagement(vector, tags, findings);
        
        // 规则2: 学科表现诊断
        evaluateSubjectPerformance(vector, tags, findings);
        
        // 规则3: 薄弱知识点持续性分析
        evaluateWeaknessPersistence(vector, tags, findings);
        
        // 规则4: 学习趋势分析
        evaluateTrend(vector, tags, findings);
        
        // 规则5: 错题管理效果
        evaluateMistakeManagement(vector, tags, findings);
        
        // 规则6: 计划执行偏差
        evaluatePlanExecution(vector, tags, findings);
        
        // 规则7: 异常检测
        detectAnomalies(vector, tags, findings);
        
        // 按严重程度排序
        findings.sort(Comparator.comparing(DiagnosisFinding::getSeverity).reversed());
        
        return DiagnosisResult.builder()
            .tags(tags)
            .findings(findings)
            .build();
    }
    
    private void evaluateWeaknessPersistence(DiagnosisFeatureVector v, 
            List<DiagnosisTag> tags, List<DiagnosisFinding> findings) {
        
        for (String kpId : v.getPersistentWeakKpIds()) {
            String kpName = knowledgePointService.getName(kpId);
            findings.add(DiagnosisFinding.builder()
                .key("PERSISTENT_WEAKNESS")
                .severity(Severity.HIGH)
                .target(kpName)
                .description(String.format("「%s」已连续%d周正确率低于60%%，属于持续性薄弱知识点", 
                    kpName, getWeakWeeks(kpId)))
                .evidence(String.format("当前掌握度: %.0f%%, 同龄人均值: %.0f%%", 
                    v.getMasteryDistribution().getOrDefault(kpId, 0.0) * 100,
                    getPeerAverage(kpId) * 100))
                .build());
        }
        if (!v.getPersistentWeakKpIds().isEmpty()) {
            tags.add(DiagnosisTag.PERSISTENT_WEAKNESS);
        }
    }
    
    private void detectAnomalies(DiagnosisFeatureVector v,
            List<DiagnosisTag> tags, List<DiagnosisFinding> findings) {
        
        // 正确率突然下降超过15%
        if (v.getAccuracyChangeRate() < -0.15) {
            findings.add(DiagnosisFinding.builder()
                .key("ACCURACY_DROP")
                .severity(Severity.HIGH)
                .description(String.format("本周正确率较上周下降%.0f%%，需要关注", 
                    Math.abs(v.getAccuracyChangeRate() * 100)))
                .build());
            tags.add(DiagnosisTag.SUDDEN_DECLINE);
        }
        
        // 学习时长异常激增(可能过度疲劳)
        if (v.getStudyTimeChangeRate() > 0.5 && v.getAvgDailyStudyTime() > 4) {
            findings.add(DiagnosisFinding.builder()
                .key("OVERLOAD_WARNING")
                .severity(Severity.MEDIUM)
                .description(String.format("学习时长较上周增加%.0f%%，日均%.1f小时，注意劳逸结合", 
                    v.getStudyTimeChangeRate() * 100, v.getAvgDailyStudyTime()))
                .build());
            tags.add(DiagnosisTag.OVERLOAD_RISK);
        }
        
        // 错题复习率过低
        if (v.getMistakeReviewRate() < 0.3 && v.getNewMistakes() > 10) {
            findings.add(DiagnosisFinding.builder()
                .key("LOW_REVIEW_RATE")
                .severity(Severity.MEDIUM)
                .description(String.format("本周新增%d道错题，但复习完成率仅%.0f%%，错题可能堆积", 
                    v.getNewMistakes(), v.getMistakeReviewRate() * 100))
                .build());
            tags.add(DiagnosisTag.REVIEW_BACKLOG);
        }
    }
}
```

### 4.4 AI诊断解读生成器（NLG）

#### 4.4.1 Prompt 编排策略

```java
@Service
@Slf4j
public class NLGReportGenerator {
    
    @Autowired private LLMGatewayClient llmClient;
    @Autowired private ReportTemplateService templateService;
    @Autowired private ContentSafetyFilter safetyFilter;
    @Autowired private FactChecker factChecker;
    
    /**
     * 基于诊断结果生成自然语言报告内容
     */
    public NLGGenerationResult generate(
            DiagnosisFeatureVector features,
            DiagnosisResult diagnosis,
            ReportContext context) {
        
        // 1. 加载模板
        ReportTemplate template = templateService.getTemplate(
            context.getReportType(), 
            context.getTargetRole(),
            context.getGradeRange()
        );
        
        // 2. 组装Prompt
        String prompt = assemblePrompt(template, features, diagnosis, context);
        
        // 3. 调用大模型(SSE流式)
        long startTime = System.currentTimeMillis();
        LLMResponse response = llmClient.chat(
            LLMRequest.builder()
                .model(selectModel(features, diagnosis))
                .systemPrompt(template.getSystemPrompt())
                .userPrompt(prompt)
                .temperature(0.4)  // 低温度保证稳定性
                .maxTokens(2000)
                .stream(false)
                .timeoutMs(30000)
                .build()
        );
        long elapsed = System.currentTimeMillis() - startTime;
        
        // 4. 事实校验
        FactCheckResult factCheck = factChecker.verify(response.getContent(), features);
        if (factCheck.hasErrors()) {
            log.warn("事实校验未通过, reportNo={}, errors={}", context.getReportNo(), factCheck.getErrors());
            // 修正明显错误后继续
            response = factChecker.autoCorrect(response, factCheck);
        }
        
        // 5. 安全过滤
        SafetyFilterResult safetyResult = safetyFilter.filter(response.getContent());
        if (safetyResult.isBlocked()) {
            throw new ContentRejectedException("AI生成内容未通过安全审核: " + safetyResult.getReason());
        }
        
        // 6. 解析结构化内容
        NLGReportContent content = parseReportContent(response.getContent(), template);
        
        return NLGGenerationResult.builder()
            .content(content)
            .qualityScore(calculateQualityScore(response, factCheck))
            .modelInfo(response.getModelInfo())
            .tokenCost(response.getTotalTokens())
            .generateTime((int) elapsed)
            .build();
    }
    
    /**
     * 根据数据复杂度选择模型
     */
    private String selectModel(DiagnosisFeatureVector features, DiagnosisResult diagnosis) {
        // 复杂场景使用推理模型
        if (diagnosis.getTags().size() > 4 || features.getPersistentWeakKpIds().size() > 3) {
            return "glm-4.6-plus";  // 高级推理模型
        }
        // 常规场景使用标准模型
        return "glm-4.6-air";  // 标准模型，成本更低
    }
    
    private String assemblePrompt(ReportTemplate template, 
            DiagnosisFeatureVector features, DiagnosisResult diagnosis, 
            ReportContext context) {
        
        StringBuilder sb = new StringBuilder();
        
        // 学生画像背景
        sb.append("## 学生信息\n");
        sb.append(String.format("姓名: %s, 年级: %s, 教材版本: %s\n", 
            context.getStudentName(), context.getGradeLabel(), context.getTextbookVersion()));
        sb.append(String.format("报告周期: %s 至 %s\n", 
            context.getPeriodStart(), context.getPeriodEnd()));
        sb.append(String.format("报告受众: %s\n\n", roleDescription(context.getTargetRole())));
        
        // 数据摘要
        sb.append("## 数据摘要\n");
        sb.append(formatMetricsAsText(features));
        sb.append("\n");
        
        // 诊断发现
        sb.append("## 诊断发现\n");
        for (DiagnosisFinding f : diagnosis.getFindings()) {
            sb.append(String.format("- [%s] %s\n  依据: %s\n", 
                f.getSeverity(), f.getDescription(), f.getEvidence()));
        }
        sb.append("\n");
        
        // 生成指令
        sb.append(template.getPromptTemplate());
        
        // 角色语气约束
        sb.append("\n\n## 语气与风格约束\n");
        sb.append(toneGuideline(context.getTargetRole(), template.getTone()));
        
        // 事实约束
        sb.append("\n## 重要约束\n");
        sb.append("1. 所有数据引用必须与上方「数据摘要」一致，不得编造数据\n");
        sb.append("2. 不得给出超出平台能力的承诺\n");
        sb.append("3. 建议必须具体、可执行，避免空泛口号\n");
        sb.append("4. 对于薄弱点的表述应先肯定进步，再指出问题\n");
        sb.append("5. 输出必须为合法JSON格式\n");
        
        return sb.toString();
    }
}
```

#### 4.4.2 多角色文案适配

```java
public class RoleContentAdapter {
    
    /**
     * 根据目标角色调整文案风格和内容侧重
     */
    public NLGReportContent adaptForRole(NLGReportContent raw, 
            ReportTargetRole role, DiagnosisFeatureVector features) {
        
        return switch (role) {
            case STUDENT -> adaptForStudent(raw, features);
            case PARENT  -> adaptForParent(raw, features);
            case TEACHER -> adaptForTeacher(raw, features);
        };
    }
    
    private NLGReportContent adaptForStudent(NLGReportContent raw, DiagnosisFeatureVector f) {
        // 面向学生：鼓励式、具体行动、避免焦虑
        return raw.toBuilder()
            .overview(rewriteForStudent(raw.getOverview(), f))
            .sections(raw.getSections().stream()
                .map(s -> s.toBuilder()
                    .title(studentFriendlyTitle(s.getTitle()))
                    .summary(rewriteForStudent(s.getSummary(), f))
                    .build())
                .toList())
            .build();
    }
    
    private NLGReportContent adaptForParent(NLGReportContent raw, DiagnosisFeatureVector f) {
        // 面向家长：客观、关注趋势、家庭教育建议
        return raw.toBuilder()
            .overview(rewriteForParent(raw.getOverview(), f))
            .sections(addParentGuidance(raw.getSections(), f))
            .build();
    }
    
    private NLGReportContent adaptForTeacher(NLGReportContent raw, DiagnosisFeatureVector f) {
        // 面向教师：专业、数据驱动、教学干预建议
        return raw.toBuilder()
            .overview(rewriteForTeacher(raw.getOverview(), f))
            .sections(addTeachingIntervention(raw.getSections(), f))
            .build();
    }
}
```

#### 4.4.3 报告内容结构

```java
/**
 * AI生成的自然语言报告内容(对应LLM输出JSON)
 */
public class NLGReportContent {
    private String overview;               // 总体概述(1-2段)
    private List<ReportSection> sections;  // 分章节内容
    private String closingRemark;          // 结语/鼓励语
    
    @Data
    public static class ReportSection {
        private String sectionKey;          // 章节标识
        private String title;               // 章节标题
        private String summary;             // 章节摘要(2-4句话)
        private List<MetricHighlight> highlights; // 关键指标高亮
        private String diagnosisText;       // 诊断分析(详细段落)
        private List<String> bulletPoints;  // 要点列表
    }
    
    @Data
    public static class MetricHighlight {
        private String label;
        private String value;
        private String trend;  // UP/DOWN/FLAT
        private String comment; // AI对该指标的一句话点评
    }
}
```

### 4.5 个性化建议生成

```java
@Service
public class SuggestionGenerator {
    
    @Autowired private KnowledgePointService kpService;
    @Autowired private QuestionRecommendClient questionClient;
    @Autowired private StudyPlanClient planClient;
    
    /**
     * 基于诊断结果生成个性化学习建议
     */
    public List<DiagnosisSuggestion> generate(
            DiagnosisFeatureVector features,
            DiagnosisResult diagnosis,
            ReportTargetRole role) {
        
        List<DiagnosisSuggestion> suggestions = new ArrayList<>();
        
        // 策略1: 针对持续性薄弱知识点 → 专项突破建议
        for (String kpId : features.getPersistentWeakKpIds()) {
            suggestions.add(buildTargetedPracticeSuggestion(kpId, features, role));
        }
        
        // 策略2: 针对正确率下降学科 → 复习巩固建议
        features.getSubjectChangeRate().entrySet().stream()
            .filter(e -> e.getValue() < -0.10)
            .forEach(e -> suggestions.add(buildReviewSuggestion(e.getKey(), e.getValue(), role)));
        
        // 策略3: 针对错题堆积 → 错题复习建议
        if (features.getMistakeReviewRate() < 0.5) {
            suggestions.add(buildMistakeReviewSuggestion(features, role));
        }
        
        // 策略4: 针对计划完成率低 → 计划调整建议
        if (features.getTaskCompletionRate() < 0.6) {
            suggestions.add(buildPlanAdjustmentSuggestion(features, role));
        }
        
        // 策略5: 正向激励 → 巩固优势建议
        features.getSubjectAccuracy().entrySet().stream()
            .filter(e -> e.getValue() > 0.85)
            .limit(1)
            .forEach(e -> suggestions.add(buildStrengthConsolidationSuggestion(e.getKey(), role)));
        
        // 按优先级排序
        suggestions.sort(Comparator.comparing(DiagnosisSuggestion::getPriority).reversed());
        
        // 限制建议数量(避免信息过载)
        int maxSuggestions = role == ReportTargetRole.STUDENT ? 3 : 5;
        return suggestions.stream().limit(maxSuggestions).toList();
    }
    
    private DiagnosisSuggestion buildTargetedPracticeSuggestion(
            String kpId, DiagnosisFeatureVector features, ReportTargetRole role) {
        
        KnowledgePoint kp = kpService.getById(kpId);
        List<String> recommendedQuestionIds = questionClient.getRecommendQuestions(
            features.getUserId(), kpId, 10);
        
        return DiagnosisSuggestion.builder()
            .suggestionType("FOCUS")
            .priority(90)
            .targetSubject(kp.getSubject())
            .targetKpIds(List.of(kpId))
            .title(String.format("专项突破：%s", kp.getName()))
            .content(buildSuggestionContent(kp, role))
            .actionType("PRACTICE")
            .actionParams(Map.of(
                "questionIds", recommendedQuestionIds,
                "knowledgePointId", kpId,
                "source", "diagnosis_report"
            ))
            .expectedEffort("30min")
            .build();
    }
}
```

### 4.6 事实校验器

```java
@Service
@Slf4j
public class ReportFactChecker {
    
    /**
     * 校验AI生成内容中引用的数据是否与原始数据一致
     * 防止LLM幻觉导致数据错误
     */
    public FactCheckResult verify(String nlgContent, DiagnosisFeatureVector features) {
        List<FactualError> errors = new ArrayList<>();
        
        // 提取AI内容中引用的数值
        Map<String, Double> referencedNumbers = extractReferencedNumbers(nlgContent);
        
        // 逐项比对
        for (Map.Entry<String, Double> entry : referencedNumbers.entrySet()) {
            Double actualValue = getActualValue(entry.getKey(), features);
            if (actualValue == null) continue;
            
            double diff = Math.abs(entry.getValue() - actualValue);
            double tolerance = Math.max(actualValue * 0.05, 0.01); // 5%容差
            
            if (diff > tolerance) {
                errors.add(FactualError.builder()
                    .field(entry.getKey())
                    .claimed(entry.getValue())
                    .actual(actualValue)
                    .description(String.format("AI引用的「%s」值为%.2f，实际值为%.2f", 
                        entry.getKey(), entry.getValue(), actualValue))
                    .build());
            }
        }
        
        // 检查是否编造了不存在的学科/知识点
        Set<String> mentionedSubjects = extractSubjects(nlgContent);
        Set<String> actualSubjects = features.getSubjectAccuracy().keySet();
        for (String subj : mentionedSubjects) {
            if (!actualSubjects.contains(subj)) {
                errors.add(FactualError.builder()
                    .field("subject:" + subj)
                    .description("AI提到了学科「" + subj + "」，但该学科不在数据范围内")
                    .build());
            }
        }
        
        return FactCheckResult.builder()
            .errors(errors)
            .passed(errors.isEmpty())
            .build();
    }
    
    /**
     * 自动修正事实错误(简单替换)
     */
    public LLMResponse autoCorrect(LLMResponse response, FactCheckResult factCheck) {
        String content = response.getContent();
        for (FactualError error : factCheck.getErrors()) {
            if (error.getClaimed() != null && error.getActual() != null) {
                // 简单数值替换
                content = content.replace(
                    String.format("%.0f", error.getClaimed()),
                    String.format("%.0f", error.getActual())
                );
                content = content.replace(
                    String.format("%.1f", error.getClaimed()),
                    String.format("%.1f", error.getActual())
                );
            }
        }
        return response.toBuilder().content(content).build();
    }
}
```

### 4.7 状态流转

#### 4.7.1 报告状态机

```
                         ┌──────────────────────────────────────────┐
                         │              EXPIRED                      │
                         │  (超过90天, 数据已归档)                    │
                         └──────────────────────────────────────────┘
                                      ▲
                                      │ 定时任务归档
                                      │
    ┌───────┐    生成请求    ┌──────────────┐    数据聚合完成    ┌───────────┐
    │ CREATED│──────────────▶│  PENDING     │─────────────────▶│ GENERATING│
    └───────┘                │ (等待数据)    │                  │ (LLM生成中)│
                             └──────┬───────┘                  └─────┬─────┘
                                    │                                │
                          数据不足   │ 数据不足                       │ 生成完成
                          ┌─────────▼─────────┐              ┌───────▼───────┐
                          │  INSUFFICIENT_DATA │              │   COMPLETED   │
                          │  (提示补充数据)     │              └───────┬───────┘
                          └───────────────────┘                      │
                                                    质量分低 / 命中敏感词│
                                                    ┌─────────────────▼──────────┐
                                                    │      REVIEWING             │
                                                    │  (转人工审核队列)           │
                                                    └─────┬──────────────┬──────┘
                                                          │审核通过      │审核拒绝
                                                 ┌────────▼────┐  ┌──────▼──────┐
                                                 │  COMPLETED  │  │   REJECTED  │
                                                 │ (已发布)    │  │ (不发布)    │
                                                 └─────────────┘  └─────────────┘
                                                                    │
                                                          用户申诉 │
                                                 ┌────────────────▼──────┐
                                                 │    RE_REVIEWING       │
                                                 └───────────────────────┘
```

#### 4.7.2 状态机实现

```java
@Service
public class ReportStateMachine {
    
    private static final Map<ReportStatus, Set<ReportStatus>> TRANSITIONS = Map.of(
        ReportStatus.CREATED,      EnumSet.of(ReportStatus.PENDING, ReportStatus.FAILED),
        ReportStatus.PENDING,      EnumSet.of(ReportStatus.GENERATING, ReportStatus.INSUFFICIENT_DATA, ReportStatus.FAILED),
        ReportStatus.GENERATING,   EnumSet.of(ReportStatus.COMPLETED, ReportStatus.REVIEWING, ReportStatus.FAILED),
        ReportStatus.REVIEWING,    EnumSet.of(ReportStatus.COMPLETED, ReportStatus.REJECTED),
        ReportStatus.COMPLETED,    EnumSet.of(ReportStatus.EXPIRED),
        ReportStatus.REJECTED,     EnumSet.of(ReportStatus.RE_REVIEWING),
        ReportStatus.RE_REVIEWING, EnumSet.of(ReportStatus.COMPLETED, ReportStatus.REJECTED)
    );
    
    @Transactional
    public void transition(Long reportId, ReportStatus target, String operator) {
        DiagnosisReport report = reportMapper.selectById(reportId);
        ReportStatus current = ReportStatus.valueOf(report.getStatus());
        
        if (!TRANSITIONS.getOrDefault(current, EnumSet.noneOf(ReportStatus.class)).contains(target)) {
            throw new IllegalStateTransitionException(
                String.format("非法状态转换: %s -> %s, reportId=%d", current, target, reportId));
        }
        
        reportMapper.updateStatus(reportId, target.name());
        
        // 记录状态变更日志
        eventPublisher.publishEvent(new ReportStatusChangedEvent(reportId, current, target, operator));
        
        // 触发后续动作
        onStateChanged(report, target);
    }
    
    private void onStateChanged(DiagnosisReport report, ReportStatus newStatus) {
        switch (newStatus) {
            case COMPLETED -> notifyUser(report);
            case REVIEWING -> enqueueForManualReview(report);
            case FAILED -> notifyAdminForFailure(report);
        }
    }
}
```

## 5. 关键代码示例

### 5.1 报告生成服务（核心编排）

```java
@Service
@Slf4j
@RequiredArgsConstructor
public class ReportGenerationService {
    
    private final ReportDataAggregator dataAggregator;
    private final DiagnosisRuleEngine ruleEngine;
    private final NLGReportGenerator nlgGenerator;
    private final SuggestionGenerator suggestionGenerator;
    private final ReportFactChecker factChecker;
    private final ReportStateMachine stateMachine;
    private final ContentSafetyFilter safetyFilter;
    private final DiagnosisReportMapper reportMapper;
    private final RedisTemplate<String, String> redisTemplate;
    
    /**
     * 生成完整的学情诊断报告
     */
    @Async("reportGenerationExecutor")
    @DistributedLock(key = "'report:gen:' + #request.userId + ':' + #request.reportType", 
                     expire = 300, unit = TimeUnit.SECONDS)
    public void generateReport(ReportGenerationRequest request) {
        Long userId = request.getUserId();
        String reportNo = generateReportNo();
        long startTime = System.currentTimeMillis();
        
        // 创建报告记录
        DiagnosisReport report = createReportRecord(request, reportNo);
        stateMachine.transition(report.getId(), ReportStatus.PENDING, "system");
        
        try {
            // Step 1: 数据聚合
            DiagnosisFeatureVector features = dataAggregator.aggregate(
                userId, request.getPeriodStart(), request.getPeriodEnd());
            
            // 数据充足性检查
            if (!isDataSufficient(features)) {
                stateMachine.transition(report.getId(), ReportStatus.INSUFFICIENT_DATA, "system");
                return;
            }
            
            // Step 2: 规则诊断
            DiagnosisResult diagnosis = ruleEngine.diagnose(features);
            report.setDataSnapshot(toJson(features));
            report.setDiagnosisTags(toJson(diagnosis.getTags()));
            
            // Step 3: 切换到生成中
            stateMachine.transition(report.getId(), ReportStatus.GENERATING, "system");
            
            // Step 4: AI自然语言生成
            ReportContext context = buildContext(request, reportNo);
            NLGGenerationResult nlgResult = nlgGenerator.generate(features, diagnosis, context);
            
            // Step 5: 事实校验
            FactCheckResult factCheck = factChecker.verify(nlgResult.getContent().toString(), features);
            if (factCheck.hasCriticalErrors()) {
                log.warn("事实校验发现严重错误, 进入人工审核: {}", factCheck);
                report.setNlgContent(nlgResult.getContent().toString());
                reportMapper.updateById(report);
                stateMachine.transition(report.getId(), ReportStatus.REVIEWING, "system");
                return;
            }
            
            // Step 6: 安全过滤
            SafetyFilterResult safety = safetyFilter.filter(nlgResult.getContent().toString());
            if (safety.isBlocked()) {
                throw new ContentRejectedException(safety.getReason());
            }
            
            // Step 7: 生成个性化建议
            List<DiagnosisSuggestion> suggestions = suggestionGenerator.generate(
                features, diagnosis, request.getTargetRole());
            
            // Step 8: 持久化
            report.setNlgContent(toJson(nlgResult.getContent()));
            report.setSuggestions(toJson(suggestions));
            report.setQualityScore(nlgResult.getQualityScore());
            report.setModelInfo(nlgResult.getModelInfo());
            report.setTokenCost(nlgResult.getTokenCost());
            report.setGenerateTime((int)(System.currentTimeMillis() - startTime));
            reportMapper.updateById(report);
            
            // Step 9: 保存建议
            saveSuggestions(report.getId(), suggestions);
            
            // Step 10: 完成
            stateMachine.transition(report.getId(), ReportStatus.COMPLETED, "system");
            
            log.info("报告生成完成: reportNo={}, userId={}, elapsed={}ms, tokens={}", 
                reportNo, userId, System.currentTimeMillis() - startTime, nlgResult.getTokenCost());
            
        } catch (LLMServiceException e) {
            log.error("大模型调用失败: reportNo={}", reportNo, e);
            handleGenerationFailure(report, e, "LLM服务不可用");
        } catch (ContentRejectedException e) {
            log.error("内容安全审核未通过: reportNo={}", reportNo, e);
            handleGenerationFailure(report, e, "内容安全审核未通过");
        } catch (Exception e) {
            log.error("报告生成失败: reportNo={}", reportNo, e);
            handleGenerationFailure(report, e, e.getMessage());
        }
    }
    
    /**
     * 数据充足性校验
     */
    private boolean isDataSufficient(DiagnosisFeatureVector f) {
        // 至少3天学习记录或至少20道答题记录
        return f.getStudyDays() >= 3 || f.getTotalQuestions() >= 20;
    }
}
```

### 5.2 批量定时生成调度

```java
@Service
@RequiredArgsConstructor
public class ReportScheduleService {
    
    private final ReportGenerationService generationService;
    private final UserQueryService userQueryService;
    private final ReportGenerationTaskMapper taskMapper;
    
    /**
     * 每周一早上7点自动生成周报
     */
    @Scheduled(cron = "0 0 7 * * MON")
    public void generateWeeklyReports() {
        // 查询需要生成周报的活跃用户
        List<Long> userIds = userQueryService.getActiveUserIds(
            LocalDate.now().minusDays(7), 
            10000  // 批量大小
        );
        
        // 创建批量任务
        ReportGenerationTask task = ReportGenerationTask.builder()
            .taskNo("TASK_W" + LocalDate.now().format(YYYYMMDD))
            .reportType("WEEKLY")
            .triggerType("SCHEDULED")
            .targetUsers(toJson(userIds))
            .status("RUNNING")
            .totalCount(userIds.size())
            .scheduledAt(LocalDateTime.now())
            .build();
        taskMapper.insert(task);
        
        // 分批异步生成(每批50个用户)
        int batchSize = 50;
        for (int i = 0; i < userIds.size(); i += batchSize) {
            List<Long> batch = userIds.subList(i, Math.min(i + batchSize, userIds.size()));
            
            // 每个用户分别生成PARENT和STUDENT两个版本
            for (Long userId : batch) {
                for (String role : List.of("STUDENT", "PARENT")) {
                    CompletableFuture.runAsync(() -> {
                        try {
                            generationService.generateReport(ReportGenerationRequest.builder()
                                .userId(userId)
                                .reportType("WEEKLY")
                                .targetRole(role)
                                .periodStart(LocalDate.now().minusDays(7))
                                .periodEnd(LocalDate.now().minusDays(1))
                                .build());
                        } catch (Exception e) {
                            log.error("周报生成失败: userId={}, role={}", userId, role, e);
                        }
                    }, reportGenerationExecutor);
                }
            }
            
            // 批次间间隔，避免突发流量
            sleep(Duration.ofSeconds(2));
        }
    }
    
    /**
     * 考前3天自动生成备考诊断报告
     */
    @Scheduled(cron = "0 0 20 * * *")
    public void checkAndGenerateExamPrepReports() {
        List<ExamSchedule> upcomingExams = examScheduleService.getExamsInDays(3);
        for (ExamSchedule exam : upcomingExams) {
            List<Long> classUserIds = classService.getStudentIds(exam.getClassId());
            for (Long userId : classUserIds) {
                generationService.generateReport(ReportGenerationRequest.builder()
                    .userId(userId)
                    .reportType("EXAM_PREP")
                    .targetRole("STUDENT")
                    .periodStart(LocalDate.now().minusDays(14))
                    .periodEnd(LocalDate.now())
                    .build());
            }
        }
    }
}
```

### 5.3 异常事件触发报告

```java
@Service
@RequiredArgsConstructor
public class EventTriggeredReportService {
    
    private final ReportGenerationService generationService;
    private final KafkaTemplate<String, String> kafkaTemplate;
    
    /**
     * 监听学习异常事件，触发即时诊断报告
     */
    @KafkaListener(topics = "learning-anomaly-events")
    public void onLearningAnomaly(LearningAnomalyEvent event) {
        log.info("收到学习异常事件: userId={}, type={}", event.getUserId(), event.getType());
        
        switch (event.getType()) {
            case ACCURACY_SUDDEN_DROP -> {
                // 正确率骤降 → 触发PARENT版本预警报告
                generationService.generateReport(ReportGenerationRequest.builder()
                    .userId(event.getUserId())
                    .reportType("EVENT_TRIGGER")
                    .targetRole("PARENT")
                    .periodStart(LocalDate.now().minusDays(7))
                    .periodEnd(LocalDate.now())
                    .priority("HIGH")
                    .build());
            }
            case PROLONGED_INACTIVITY -> {
                // 连续7天未学习 → 触发STUDENT版本激励报告
                generationService.generateReport(ReportGenerationRequest.builder()
                    .userId(event.getUserId())
                    .reportType("EVENT_TRIGGER")
                    .targetRole("STUDENT")
                    .periodStart(LocalDate.now().minusDays(14))
                    .periodEnd(LocalDate.now())
                    .build());
            }
            case SUBJECT_IMBALANCE -> {
                // 学科严重偏科 → 触发TEACHER版本报告
                generationService.generateReport(ReportGenerationRequest.builder()
                    .userId(event.getUserId())
                    .reportType("EVENT_TRIGGER")
                    .targetRole("TEACHER")
                    .periodStart(LocalDate.now().minusDays(30))
                    .periodEnd(LocalDate.now())
                    .build());
            }
        }
    }
}
```

## 6. 错误处理

### 6.1 异常类型与处理策略

| 异常类型 | 场景 | 处理策略 | 用户感知 |
| --- | --- | --- | --- |
| `DataInsufficientException` | 学习数据不足3天 | 标记INSUFFICIENT_DATA，提示用户 | "数据积累中，再学几天就能看到诊断报告了" |
| `LLMServiceException` | 大模型调用超时/不可用 | 自动重试3次→降级到规则模板→记录告警 | "报告生成中，请稍后在通知中心查看" |
| `ContentRejectedException` | AI内容未通过安全审核 | 转人工审核队列→使用脱敏模板重新生成 | "报告正在审核中，预计1小时内完成" |
| `FactCheckCriticalException` | AI内容严重事实错误 | 转人工审核→记录模型质量问题 | "报告正在审核中" |
| `RateLimitException` | 生成频率超限 | 拒绝并返回上次报告 | "本周报告已生成，可在报告中心查看" |
| `TemplateNotFoundException` | 找不到适配模板 | 使用默认模板fallback | (无感知) |
| `RedisLockException` | 并发生成冲突 | 返回正在生成中的报告编号 | "报告正在生成中" |

### 6.2 LLM降级策略

```java
@Service
public class LLMFallbackManager {
    
    private static final List<LlmEndpoint> FALLBACK_CHAIN = List.of(
        new LlmEndpoint("glm-4.6-plus", 30_000, 3),   // 主模型: 高质量, 30s超时, 3次重试
        new LlmEndpoint("glm-4.6-air",  20_000, 2),   // 降级1: 标准模型, 20s超时
        new LlmEndpoint("glm-4-flash",  10_000, 1)    // 降级2: 快速模型, 10s超时
    );
    
    // 最终兜底: 不使用LLM，用规则模板填充
    private static final String RULE_BASED_FALLBACK = """
        本周学习时长 {studyTime} 小时，{studyDays} 天。
        正确率 {accuracy}%，{accuracyTrend}。
        建议关注: {weakSubjects}。
        """;
    
    public String generateWithFallback(String prompt, String systemPrompt) {
        for (LlmEndpoint endpoint : FALLBACK_CHAIN) {
            try {
                return callLLM(endpoint, prompt, systemPrompt);
            } catch (LLMTimeoutException | LLMUnavailableException e) {
                log.warn("LLM降级: {} → 下一级, error: {}", endpoint.getModel(), e.getMessage());
            }
        }
        
        // 所有LLM均不可用，使用规则模板
        log.error("所有LLM不可用，使用规则模板兜底");
        return RULE_BASED_FALLBACK;
    }
}
```

### 6.3 质量评分与自动审核

```java
@Service
public class ReportQualityEvaluator {
    
    /**
     * 对AI生成的报告内容进行质量评分 (0.0 ~ 1.0)
     */
    public double evaluate(NLGReportContent content, DiagnosisFeatureVector features, 
                          FactCheckResult factCheck) {
        double score = 1.0;
        
        // 事实准确性 (权重 40%)
        if (factCheck.hasErrors()) {
            double penalty = factCheck.getCriticalCount() * 0.2 + factCheck.getMinorCount() * 0.05;
            score -= penalty * 0.4;
        }
        
        // 完整性 (权重 20%): 是否覆盖了所有诊断发现
        int coveredFindings = countCoveredFindings(content, features);
        double coverage = coveredFindings / (double) Math.max(1, features.getFindings().size());
        score -= (1 - coverage) * 0.2;
        
        // 结构规范性 (权重 15%): JSON格式是否正确，章节是否完整
        if (!isWellStructured(content)) {
            score -= 0.15;
        }
        
        // 语气一致性 (权重 15%): 是否符合目标角色语气
        double toneScore = evaluateTone(content);
        score -= (1 - toneScore) * 0.15;
        
        // 长度合规 (权重 10%): 不能过短或过长
        int length = content.toString().length();
        if (length < 200 || length > 3000) {
            score -= 0.10;
        }
        
        return Math.max(0, Math.min(1, score));
    }
    
    /**
     * 质量分 < 0.7 时转人工审核
     */
    public boolean needsManualReview(double qualityScore) {
        return qualityScore < 0.7;
    }
}
```

## 7. 性能优化

### 7.1 生成性能指标

| 指标 | 目标 | 说明 |
| --- | --- | --- |
| 单份报告生成耗时 | < 15秒 | 含数据聚合+LLM生成+后处理 |
| 批量生成吞吐 | 100份/分钟 | 定时任务场景 |
| LLM Token消耗 | < 1500 tokens/份 | 优化Prompt长度 |
| 数据聚合耗时 | < 3秒 | 并行查询+缓存 |
| 缓存命中率 | > 80% | 同期重复请求 |

### 7.2 优化策略

**1. 数据预聚合：**
```java
// 定时预计算，避免实时聚合延迟
@Scheduled(cron = "0 0 6 * * MON")  // 每天/每周提前计算
public void preAggregate() {
    List<Long> activeUserIds = getActiveUsers();
    for (Long userId : activeUserIds) {
        CompletableFuture.runAsync(() -> {
            DiagnosisFeatureVector vector = dataAggregator.aggregate(
                userId, periodStart, periodEnd);
            cacheTemplate.opsForValue().set(
                "report:data_snapshot:" + userId + ":" + periodEnd,
                toJson(vector), Duration.ofHours(24));
        }, preAggregationExecutor);
    }
}
```

**2. Prompt压缩：**
```java
// 数据摘要压缩，减少Token消耗
private String formatMetricsAsText(DiagnosisFeatureVector f) {
    return String.format("""
        学习: %d天/%.1fh(日均%.1fh,环比%+.0f%%)
        答题: %d题,正确率%.0f%%(环比%+.0f%%),百分位%.0f
        学科: %s
        薄弱: %s
        错题: 新增%d/复习率%.0f%%/重做错误率%.0f%%
        计划: 完成%d/%d(%.0f%%)
        """,
        f.getStudyDays(), f.getTotalStudyTime(), f.getAvgDailyStudyTime(), 
        f.getStudyTimeChangeRate() * 100,
        f.getTotalQuestions(), f.getOverallAccuracy() * 100, 
        f.getAccuracyChangeRate() * 100, f.getPercentileRank(),
        formatSubjectSummary(f.getSubjectAccuracy()),
        formatWeaknessSummary(f.getWeakKpIds()),
        f.getNewMistakes(), f.getMistakeReviewRate() * 100, 
        f.getMistakeRepeatRate() * 100,
        f.getCompletedTasks(), f.getPlannedTasks(), 
        f.getTaskCompletionRate() * 100
    );
    // 目标: 将所有关键数据压缩到 < 300 tokens
}
```

**3. 并发控制：**
```java
@Configuration
public class ReportThreadPoolConfig {
    
    @Bean("reportGenerationExecutor")
    public ThreadPoolTaskExecutor reportGenerationExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(10);      // 10个并发生成
        executor.setMaxPoolSize(20);
        executor.setQueueCapacity(500);
        executor.setKeepAliveSeconds(60);
        executor.setThreadNamePrefix("report-gen-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        return executor;
    }
    
    @Bean("preAggregationExecutor")
    public ThreadPoolTaskExecutor preAggregationExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(5);
        executor.setMaxPoolSize(10);
        executor.setQueueCapacity(200);
        executor.setThreadNamePrefix("report-prep-");
        return executor;
    }
}
```

## 8. 安全考虑

### 8.1 数据安全

| 安全维度 | 措施 |
| --- | --- |
| 数据隔离 | 严格按tenant_id和user_id过滤，禁止跨用户/跨班级查询 |
| 未成年人隐私 | PARENT角色报告需验证家长绑定关系后才能查看 |
| 数据脱敏 | 发送给LLM的数据中不包含真实姓名，使用"该同学"/"您的孩子" |
| 敏感信息过滤 | 心理状态相关内容不发送给LLM，仅用规则引擎处理 |

### 8.2 AI内容安全

```java
@Component
public class ReportContentSafetyFilter {
    
    // 禁止AI输出的内容类型
    private static final List<SafetyRule> RULES = List.of(
        // 不得包含具体分数预测("你的高考分数预计为XXX")
        new SafetyRule("SCORE_PREDICTION", Pattern.compile("(预计|预测).{0,10}(分数|成绩).{0,5}\\d{3}"), "REMOVE"),
        
        // 不得包含医疗/心理诊断
        new SafetyRule("MEDICAL_DIAGNOSIS", Pattern.compile("(抑郁症|多动症|ADHD|智力障碍)"), "REPLACE"),
        
        // 不得包含与其他学生具名比较
        new SafetyRule("NAMED_COMPARISON", Pattern.compile("(比|与).{0,5}(同学|朋友).{0,5}(好|差|强|弱)"), "REMOVE"),
        
        // 不得包含过度负面表述
        new SafetyRule("EXCESSIVE_NEGATIVE", Pattern.compile("(毫无|完全|彻底).{0,5}(希望|进步|可能)"), "REPLACE"),
        
        // 不得包含商业推销
        new SafetyRule("COMMERCIAL_PROMOTION", Pattern.compile("(立即购买|限时优惠|抢先报名)"), "REMOVE")
    );
    
    public SafetyFilterResult filter(String content) {
        String filtered = content;
        List<String> actions = new ArrayList<>();
        
        for (SafetyRule rule : RULES) {
            Matcher matcher = rule.getPattern().matcher(filtered);
            if (matcher.find()) {
                actions.add(String.format("规则[%s]命中: %s", rule.getName(), matcher.group()));
                if ("REMOVE".equals(rule.getAction())) {
                    filtered = matcher.replaceAll("");
                } else if ("REPLACE".equals(rule.getAction())) {
                    filtered = matcher.replaceAll("[已过滤]");
                }
            }
        }
        
        return SafetyFilterResult.builder()
            .passed(actions.isEmpty())
            .filteredContent(filtered)
            .actions(actions)
            .build();
    }
}
```

### 8.3 审计日志

```sql
CREATE TABLE report_audit_log (
    id           BIGINT PRIMARY KEY AUTO_INCREMENT,
    report_id    BIGINT NOT NULL,
    action       VARCHAR(32) NOT NULL COMMENT 'GENERATE/VIEW/SHARE/REVIEW/REJECT',
    operator_id  BIGINT NOT NULL,
    operator_type VARCHAR(16) COMMENT 'USER/ADMIN/SYSTEM',
    detail       JSON COMMENT '操作详情',
    ip           VARCHAR(64),
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_report (report_id),
    INDEX idx_operator (operator_id, action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='报告审计日志';
```

## 9. 测试策略

### 9.1 单元测试

| 测试对象 | 测试重点 | 用例数 |
| --- | --- | --- |
| `DiagnosisRuleEngine` | 阈值判定准确性、边界值、标签生成逻辑 | 30+ |
| `ReportFactChecker` | 数值偏差检测、虚构学科检测、自动修正 | 15+ |
| `ReportContentSafetyFilter` | 各安全规则命中、边界情况 | 20+ |
| `SuggestionGenerator` | 建议优先级排序、建议类型覆盖、数量限制 | 15+ |
| `ReportStateMachine` | 合法转换、非法转换拒绝、并发安全 | 10+ |

### 9.2 集成测试

```java
@SpringBootTest
class ReportGenerationIntegrationTest {
    
    @Test
    @Description("完整报告生成流程: 数据聚合 → 诊断 → NLG → 校验 → 持久化")
    void testFullGenerationFlow() {
        // Given: 准备测试数据
        Long userId = 10001L;
        mockStudyData(userId, 7);  // mock 7天学习数据
        mockAnswerRecords(userId, 50);  // mock 50道答题记录
        
        ReportGenerationRequest request = ReportGenerationRequest.builder()
            .userId(userId)
            .reportType("WEEKLY")
            .targetRole("PARENT")
            .periodStart(LocalDate.now().minusDays(7))
            .periodEnd(LocalDate.now().minusDays(1))
            .build();
        
        // When: 生成报告
        reportGenerationService.generateReport(request);
        
        // 等待异步完成
        await().atMost(30, SECONDS).untilAsserted(() -> {
            DiagnosisReport report = reportMapper.selectLatest(userId, "WEEKLY");
            assertThat(report).isNotNull();
            assertThat(report.getStatus()).isEqualTo("COMPLETED");
            assertThat(report.getQualityScore()).isGreaterThanOrEqualTo(0.7);
            assertThat(report.getNlgContent()).isNotBlank();
            // 事实校验通过: 报告中引用的数据与实际一致
            assertThat(report.getNlgContent()).doesNotContain("100%"); // 不应有满分表述
        });
    }
    
    @Test
    @Description("大模型不可用时自动降级到规则模板")
    void testLLMFallback() {
        when(llmClient.chat(any())).thenThrow(new LLMUnavailableException("模拟不可用"));
        
        reportGenerationService.generateReport(request);
        
        await().atMost(15, SECONDS).untilAsserted(() -> {
            DiagnosisReport report = reportMapper.selectLatest(userId, "WEEKLY");
            assertThat(report.getStatus()).isEqualTo("COMPLETED");
            assertThat(report.getModelInfo()).contains("rule_based");
        });
    }
}
```

### 9.3 AI质量回归测试

```java
@Test
@Description("AI生成内容的Golden Test: 确保Prompt变更不影响输出质量")
void testNLGQualityRegression() {
    // 使用固定输入数据集
    List<TestDataPack> goldenPacks = loadGoldenPacks("test-data/nlg-golden/");
    
    for (TestDataPack pack : goldenPacks) {
        NLGGenerationResult result = nlgGenerator.generate(
            pack.getFeatures(), pack.getDiagnosis(), pack.getContext());
        
        // 质量分不低于历史基线
        assertThat(result.getQualityScore())
            .as("质量分低于基线: " + pack.getName())
            .isGreaterThanOrEqualTo(pack.getBaselineScore());
        
        // 事实校验通过
        FactCheckResult factCheck = factChecker.verify(
            result.getContent().toString(), pack.getFeatures());
        assertThat(factCheck.hasCriticalErrors()).isFalse();
        
        // 安全过滤通过
        SafetyFilterResult safety = safetyFilter.filter(result.getContent().toString());
        assertThat(safety.isPassed()).isTrue();
    }
}
```

---

## 附录：配置项

```yaml
# application.yml
primetop:
  diagnosis-report:
    # 生成配置
    generation:
      max-concurrent: 20              # 最大并发生成数
      timeout-seconds: 60             # 单份报告超时
      retry-count: 3                  # 失败重试次数
      cache-ttl-days: 7               # NLG缓存天数
    
    # 数据充足性
    data-sufficiency:
      min-study-days: 3               # 最少学习天数
      min-questions: 20               # 最少答题数
    
    # 频率限制
    rate-limit:
      manual-per-week: 3              # 手动触发: 每周最多3次
      event-per-day: 2                # 事件触发: 每天最多2次
    
    # 质量阈值
    quality:
      auto-review-threshold: 0.7      # 低于此分转人工审核
      reject-threshold: 0.4           # 低于此分直接拒绝
    
    # NLG模型路由
    model-routing:
      complex-scenario: "glm-4.6-plus"   # 复杂场景(多薄弱点)
      normal-scenario: "glm-4.6-air"      # 常规场景
      fallback: "glm-4-flash"             # 降级模型
      rule-based: true                     # 最终规则兜底
    
    # 建议配置
    suggestion:
      max-student: 3                # 学生版最多建议数
      max-parent: 5                 # 家长版最多建议数
      max-teacher: 8                # 教师版最多建议数
```
