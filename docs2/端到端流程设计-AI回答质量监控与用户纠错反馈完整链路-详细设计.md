# 端到端流程设计 — AI回答质量监控与用户纠错反馈完整链路

> **版本**: v1.0  
> **日期**: 2026-06-06  
> **作者**: PrimeTop 设计细化  
> **状态**: 详细设计  

---

## 1. 概述

### 1.1 背景

PrimeTop 作为全学段 AI 辅助学习产品，AI 回答质量直接决定教育价值。原始设计文档（§12.2、§16.4）明确要求建立 AI 回答质量评分体系、用户反馈机制和错误回流修正闭环。本文档定义从"AI 输出产生"到"质量评估 → 用户反馈 → 纠错标注 → 回流优化"的完整端到端链路。

### 1.2 目标

| 目标 | 说明 |
|------|------|
| 实时质检 | AI 回答生成后自动进行教育事实校验与安全审核 |
| 用户反馈闭环 | 学生/家长可便捷标记错误回答，触发复核流程 |
| 标注回流 | 错误样本回流至标注工作台，驱动 Prompt/知识库迭代 |
| 质量可观测 | 建立实时质量看板，监控各场景/模型/学科的准确率趋势 |
| 持续优化 | 形成数据驱动的 AI 质量改进飞轮 |

### 1.3 覆盖场景

- AI 智能辅导对话（文字/语音问答）
- 拍照搜题解析（题目识别 + 解题步骤）
- 作文批改与建议
- 英语口语评测反馈
- 文科背诵检测反馈
- 同步课堂知识点讲解

---

## 2. 端到端流程全景

```
┌─────────────────────────────────────────────────────────────────────┐
│                     用户交互层                                      │
│  学生提问 → AI 回答渲染 → 用户浏览/追问 → 反馈操作(👍👎/纠错)     │
└──────────────┬──────────────────────────────────────┬────────────────┘
               │                                      │
               ▼                                      ▼
┌──────────────────────────┐         ┌──────────────────────────────────┐
│   实时质检管线 (自动)     │         │   用户反馈入口 (主动)            │
│  ① 事实校验引擎          │         │  ① 快捷评价(有帮助/没帮助)       │
│  ② 安全审核引擎          │         │  ② 错误类型选择                  │
│  ③ 格式/适龄性检查       │         │  ③ 文字补充说明                  │
│  ④ 置信度评分            │         │  ④ 截图标注                      │
└──────────┬───────────────┘         └──────────────┬───────────────────┘
           │                                         │
           ▼                                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     质量事件流 (Kafka)                               │
│  Topic: ai-quality-events                                          │
│  消息体: {sessionId, messageId, source, score, issues[], ...}      │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
┌──────────────────┐ ┌──────────┐ ┌────────────────────┐
│  质量数据聚合    │ │ 人工审核 │ │ 自动纠错引擎      │
│  (ClickHouse)    │ │ 工作台   │ │ ( Prompt 修正建议) │
└────────┬─────────┘ └────┬─────┘ └─────────┬──────────┘
         │                │                 │
         ▼                ▼                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      回流优化层                                     │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐                 │
│  │ Prompt   │  │ 知识库更新   │  │ 模型评测基准  │                 │
│  │ 模板迭代 │  │ (RAG 纠偏)  │  │ 回归测试集    │                 │
│  └──────────┘  └──────────────┘  └───────────────┘                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 阶段一：AI 回答生成与实时质检

### 3.1 流程说明

AI 回答生成完成后，在返回客户端之前/同时，自动触发质检管线。

### 3.2 数据结构

```sql
-- AI 回答记录表（核心，已有 ai_conversation_messages 扩展）
CREATE TABLE ai_answer_quality (
    id              BIGSERIAL PRIMARY KEY,
    message_id      BIGINT NOT NULL REFERENCES ai_conversation_messages(id),
    session_id      BIGINT NOT NULL REFERENCES ai_conversation_sessions(id),
    user_id         BIGINT NOT NULL REFERENCES users(id),
    student_id      BIGINT NOT NULL REFERENCES student_profiles(id),

    -- 质检结果
    auto_score      SMALLINT,          -- 自动评分 1-100
    confidence      DECIMAL(5,4),       -- 置信度 0.0000-1.0000
    fact_check_pass BOOLEAN,            -- 事实校验是否通过
    safety_pass     BOOLEAN DEFAULT TRUE, -- 安全审核是否通过
    age_appropriate BOOLEAN DEFAULT TRUE, -- 适龄性是否通过
    format_valid    BOOLEAN DEFAULT TRUE, -- 格式合规性

    -- 场景信息
    scene_type      VARCHAR(32) NOT NULL, -- tutoring/photo_essay/oral/...
    model_id        VARCHAR(64) NOT NULL, -- 使用的模型标识
    prompt_template VARCHAR(128),         -- 使用的 Prompt 模板 ID
    subject_code    VARCHAR(16),          -- 学科
    grade_code      VARCHAR(16),          -- 年级

    -- 问题标签（JSON 数组）
    issues          JSONB DEFAULT '[]',
    -- 示例: [{"type":"fact_error","desc":"勾股定理公式错误","severity":"high"}]

    -- 时间戳
    check_duration_ms INTEGER,            -- 质检耗时(毫秒)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- 索引优化
    CONSTRAINT uq_answer_quality_message UNIQUE(message_id)
);

CREATE INDEX idx_aq_user_date ON ai_answer_quality(user_id, created_at DESC);
CREATE INDEX idx_aq_scene_score ON ai_answer_quality(scene_type, auto_score);
CREATE INDEX idx_aq_model_date ON ai_answer_quality(model_id, created_at DESC);
CREATE INDEX idx_aq_issues ON ai_answer_quality USING GIN(issues);
```

### 3.3 质检管线编排

```java
/**
 * AI 回答质检管线 — 在线异步执行，不阻塞回答返回
 */
@Service
public class AnswerQualityCheckPipeline {

    private final List<QualityChecker> checkers; // 按优先级排序
    private final KafkaTemplate<String, QualityEvent> kafka;
    private final MeterRegistry metrics;

    /**
     * 异步触发质检
     */
    @Async("qualityCheckExecutor")
    public void checkAsync(AiMessage message, AnswerContext ctx) {
        QualityReport report = QualityReport.start(message.getId());

        for (QualityChecker checker : checkers) {
            try {
                CheckResult result = checker.check(message, ctx);
                report.addResult(checker.getName(), result);
            } catch (Exception e) {
                log.warn("质检 checker [{}] 执行异常: {}", checker.getName(), e.getMessage());
                report.addError(checker.getName(), e);
            }
        }

        // 综合评分
        report.calculateOverallScore();
        
        // 持久化
        saveReport(report);
        
        // 发送质量事件
        kafka.send("ai-quality-events", report.toEvent());
        
        // 低分/高风险立即告警
        if (report.getOverallScore() < 40 || report.hasHighSeverityIssue()) {
            alertService.sendUrgent(report);
        }

        metrics.counter("ai.quality.checked", "scene", ctx.getSceneType()).increment();
    }
}
```

### 3.4 各检查器定义

| 检查器 | 说明 | 触发条件 | 评分权重 |
|--------|------|----------|----------|
| FactCheckChecker | 教育事实校验：公式、定义、历史事件等 | 全场景 | 35% |
| SafetyAuditChecker | 内容安全审核：敏感信息、有害内容 | 全场景 | 20% |
| AgeAppropriateChecker | 适龄性检查：语言难度、讲解深度是否匹配学段 | 全场景 | 15% |
| FormatValidator | 格式检查：Markdown/公式/代码块是否正确渲染 | 全场景 | 10% |
| CompletenessChecker | 完整性检查：是否完整回答了问题 | 全场景 | 10% |
| SubjectMatcher | 学科匹配度：回答是否切合学科上下文 | 理科/文科场景 | 10% |

### 3.5 实时质检 — 事实校验示例

```java
@Component
@Order(10)
public class FactCheckChecker implements QualityChecker {

    private final RagSearchService ragSearch;
    private final FactVerificationClient factClient;

    @Override
    public CheckResult check(AiMessage message, AnswerContext ctx) {
        // 1. 提取回答中的关键事实断言
        List<FactClaim> claims = extractFactClaims(message.getContent());
        
        if (claims.isEmpty()) {
            return CheckResult.pass("无明确事实断言");
        }

        List<FactIssue> issues = new ArrayList<>();

        for (FactClaim claim : claims) {
            // 2. 从知识库检索对应知识点的权威表述
            List<KnowledgeRef> refs = ragSearch.search(
                claim.getText(), 
                ctx.getSubjectCode(), 
                ctx.getGradeCode(),
                3 // top3
            );

            // 3. 使用校验模型判断事实一致性
            FactVerifyResult verify = factClient.verify(
                claim.getText(),
                refs.stream().map(KnowledgeRef::getContent).toList()
            );

            if (!verify.isConsistent()) {
                issues.add(FactIssue.builder()
                    .type("fact_error")
                    .description(verify.getExplanation())
                    .claim(claim.getText())
                    .correctAnswer(verify.getCorrectAnswer())
                    .severity(verify.getConfidence() > 0.8 ? "high" : "medium")
                    .knowledgeRefs(refs)
                    .build());
            }
        }

        if (issues.isEmpty()) {
            return CheckResult.pass("事实校验通过");
        }

        int score = Math.max(0, 100 - issues.size() * 25);
        return CheckResult.of(score, "发现 " + issues.size() + " 个事实问题", issues);
    }
}
```

---

## 4. 阶段二：客户端反馈交互

### 4.1 反馈入口设计

AI 回答底部提供多级反馈机制：

```
┌──────────────────────────────────────┐
│  AI 回答内容区域                     │
│  ...                                 │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  这条回答对你有帮助吗？        │  │
│  │  [👍 有帮助]   [👎 没帮助]     │  │
│  └────────────────────────────────┘  │
│                                      │
│  (点击 👎 后展开二级反馈)            │
│  ┌────────────────────────────────┐  │
│  │  选择问题类型：                │  │
│  │  ○ 知识点/公式错误            │  │
│  │  ○ 解题步骤有误               │  │
│  │  ○ 回答不完整                 │  │
│  │  ○ 讲解太难理解               │  │
│  │  ○ 与问题无关                 │  │
│  │  ○ 其他                       │  │
│  │                                │  │
│  │  补充说明 (可选):             │  │
│  │  [                              │  │
│  │                                │  │
│  │  [提交反馈]                    │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

### 4.2 反馈数据结构

```sql
-- AI 回答用户反馈表
CREATE TABLE ai_answer_feedbacks (
    id              BIGSERIAL PRIMARY KEY,
    message_id      BIGINT NOT NULL REFERENCES ai_conversation_messages(id),
    session_id      BIGINT NOT NULL REFERENCES ai_conversation_sessions(id),
    user_id         BIGINT NOT NULL REFERENCES users(id),

    -- 一级反馈
    rating          SMALLINT NOT NULL,   -- 1=有帮助, 0=没帮助

    -- 二级反馈（没帮助时）
    issue_type      VARCHAR(32),         -- fact_error/step_error/incomplete/too_hard/irrelevant/other
    description     TEXT,                -- 用户补充说明

    -- 客户端上下文
    client_version  VARCHAR(32),
    platform        VARCHAR(16),         -- android/ios/web
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- 处理状态
    status          VARCHAR(16) NOT NULL DEFAULT 'pending',
    -- pending → confirmed → resolved → closed
    reviewed_by     BIGINT,              -- 审核人
    reviewed_at     TIMESTAMPTZ,
    resolution      TEXT,                -- 处理结果说明

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_af_status_date ON ai_answer_feedbacks(status, submitted_at DESC);
CREATE INDEX idx_af_message ON ai_answer_feedbacks(message_id);
CREATE INDEX idx_af_issue_type ON ai_answer_feedbacks(issue_type) WHERE rating = 0;
```

### 4.3 反馈提交 API

```
POST /api/v1/ai/feedback
```

**请求体：**

```json
{
  "messageId": 12345678,
  "rating": 0,
  "issueType": "fact_error",
  "description": "勾股定理应该是 a²+b²=c²，但回答写成了 a²+c²=b²"
}
```

**响应体：**

```json
{
  "code": 0,
  "data": {
    "feedbackId": 87654321,
    "status": "pending",
    "message": "感谢反馈，我们会认真核查并在 24 小时内处理"
  }
}
```

### 4.4 客户端反馈组件关键代码

```dart
/// AI 回答反馈组件 — Flutter
class AiAnswerFeedbackWidget extends StatefulWidget {
  final int messageId;
  final String sceneType;
  
  const AiAnswerFeedbackWidget({
    super.key,
    required this.messageId,
    required this.sceneType,
  });

  @override
  State<AiAnswerFeedbackWidget> createState() => _State();
}

class _State extends State<AiAnswerFeedbackWidget> {
  int? _rating;
  String? _issueType;
  final _descController = TextEditingController();
  bool _expanded = false;
  bool _submitting = false;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // 一级评价
        if (_rating == null) ...[
          Text('这条回答对你有帮助吗？', style: context.textTheme.bodySmall),
          const SizedBox(height: 8),
          Row(
            children: [
              _feedbackChip('👍 有帮助', 1, AppColors.success),
              const SizedBox(width: 12),
              _feedbackChip('👎 没帮助', 0, AppColors.warning),
            ],
          ),
        ],

        // 已评价后的感谢 + 展开入口
        if (_rating != null) ...[
          Row(
            children: [
              Icon(_rating == 1 ? Icons.thumb_up : Icons.thumb_down,
                   size: 16, color: _rating == 1 ? AppColors.success : AppColors.warning),
              const SizedBox(width: 6),
              Text('已反馈', style: context.textTheme.bodySmall?.copyWith(
                color: AppColors.textSecondary,
              )),
              if (_rating == 0 && !_expanded) ...[
                const Spacer(),
                TextButton(
                  onPressed: () => setState(() => _expanded = true),
                  child: const Text('告诉我们哪里有问题 →'),
                ),
              ],
            ],
          ),
        ],

        // 二级反馈表单
        if (_expanded) ...[
          const SizedBox(height: 12),
          _IssueTypeSelector(
            selected: _issueType,
            onChanged: (v) => setState(() => _issueType = v),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _descController,
            maxLines: 3,
            decoration: const InputDecoration(
              hintText: '补充说明（可选）',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 8),
          FilledButton(
            onPressed: _submitting ? null : _submitFeedback,
            child: _submitting 
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('提交反馈'),
          ),
        ],
      ],
    );
  }

  Future<void> _submitFeedback() async {
    setState(() => _submitting = true);
    try {
      await AiFeedbackApi.submit(
        messageId: widget.messageId,
        rating: _rating!,
        issueType: _issueType,
        description: _descController.text.trim().isNotEmpty 
            ? _descController.text.trim() : null,
      );
      setState(() {
        _expanded = false;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('感谢你的反馈，我们会认真核查！')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('提交失败：$e')),
        );
      }
    } finally {
      setState(() => _submitting = false);
    }
  }
}

/// 问题类型选择器
class _IssueTypeSelector extends StatelessWidget {
  final String? selected;
  final ValueChanged<String?> onChanged;

  static const _options = [
    ('fact_error', '知识点/公式错误'),
    ('step_error', '解题步骤有误'),
    ('incomplete', '回答不完整'),
    ('too_hard', '讲解太难理解'),
    ('irrelevant', '与问题无关'),
    ('other', '其他'),
  ];

  const _IssueTypeSelector({required this.selected, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: _options.map((opt) {
        final isSelected = selected == opt.$1;
        return ChoiceChip(
          label: Text(opt.$2),
          selected: isSelected,
          onSelected: (_) => onChanged(isSelected ? null : opt.$1),
        );
      }).toList(),
    );
  }
}
```

---

## 5. 阶段三：质量事件处理与人工审核

### 5.1 事件流架构

```java
/**
 * 质量事件消费者 — 统一处理自动质检和用户反馈
 */
@Component
@Slf4j
public class QualityEventConsumer {

    private final QualityAggregationService aggregation;
    private final ReviewTaskService reviewService;
    private final NotificationService notification;

    /**
     * 消费自动质检事件
     */
    @KafkaListener(topics = "ai-quality-events", groupId = "quality-processor")
    public void onQualityEvent(QualityEvent event) {
        log.info("处理质量事件: messageId={}, score={}, issues={}", 
            event.getMessageId(), event.getAutoScore(), event.getIssueCount());

        // 1. 聚合到统计预计算表
        aggregation.accumulate(event);

        // 2. 低分/高风险 → 自动创建人工审核任务
        if (event.getAutoScore() < 50 || event.hasCriticalIssue()) {
            reviewService.createAutoReviewTask(event);
        }

        // 3. 安全审核不通过 → 紧急通知
        if (!event.isSafetyPass()) {
            notification.alertSafetyTeam(event);
        }

        // 4. 事实错误 → 标记到知识库纠偏队列
        if (event.hasFactError()) {
            reviewService.createFactCorrectionTask(event);
        }
    }

    /**
     * 消费用户反馈事件
     */
    @KafkaListener(topics = "ai-feedback-events", groupId = "feedback-processor")
    public void onFeedbackEvent(FeedbackEvent event) {
        log.info("处理用户反馈: messageId={}, rating={}, issueType={}", 
            event.getMessageId(), event.getRating(), event.getIssueType());

        // 正面反馈 → 记录为高质量样本
        if (event.getRating() == 1) {
            aggregation.recordPositiveSample(event);
            return;
        }

        // 负面反馈 → 创建审核任务
        reviewService.createUserFeedbackReviewTask(event);

        // 聚合统计
        aggregation.accumulateFeedback(event);
    }
}
```

### 5.2 人工审核工作台

#### 5.2.1 审核任务数据结构

```sql
-- AI 质量审核任务表
CREATE TABLE ai_quality_review_tasks (
    id                  BIGSERIAL PRIMARY KEY,
    source              VARCHAR(32) NOT NULL,  -- auto_check / user_feedback / sample_audit
    message_id          BIGINT NOT NULL REFERENCES ai_conversation_messages(id),
    quality_report_id   BIGINT REFERENCES ai_answer_quality(id),
    feedback_id         BIGINT REFERENCES ai_answer_feedbacks(id),

    -- 问题分类
    issue_category      VARCHAR(32) NOT NULL,
    -- fact_error / step_error / safety_issue / age_mismatch / format_issue / incomplete / irrelevant / other
    severity            VARCHAR(16) NOT NULL,  -- critical / high / medium / low
    description         TEXT,

    -- 原始上下文（快照，避免关联查询变更）
    original_question   TEXT NOT NULL,
    original_answer     TEXT NOT NULL,
    context_snapshot    JSONB,                 -- 学段、年级、学科、教材版本、Prompt模板等
    model_id            VARCHAR(64),
    prompt_template_id  VARCHAR(128),

    -- 审核处理
    status              VARCHAR(16) NOT NULL DEFAULT 'pending',
    -- pending → assigned → reviewing → resolved → closed
    assignee_id         BIGINT,
    assigned_at         TIMESTAMPTZ,
    
    -- 审核结论
    verdict             VARCHAR(16),           -- confirmed_error / not_error / partial_error / needs_investigation
    corrected_answer    TEXT,                  -- 修正后的正确回答
    correction_type     VARCHAR(32),           -- prompt_fix / knowledge_fix / model_switch / no_fix_needed
    root_cause          TEXT,                  -- 根因分析
    action_items        JSONB DEFAULT '[]',    -- 后续行动项

    resolved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_qrt_status ON ai_quality_review_tasks(status, severity, created_at DESC);
CREATE INDEX idx_qrt_assignee ON ai_quality_review_tasks(assignee_id, status);
CREATE INDEX idx_qrt_category ON ai_quality_review_tasks(issue_category, created_at DESC);
```

#### 5.2.2 审核任务分配策略

```java
@Service
public class ReviewTaskAssignment {

    /**
     * 优先级分配策略
     */
    public void assignNextTask(Long reviewerId) {
        // 1. 安全类问题最高优先级
        Optional<AiQualityReviewTask> task = tryAssignByCategory(
            reviewerId, List.of("safety_issue"), List.of("critical", "high")
        );
        
        // 2. 事实错误（高严重度）
        if (task.isEmpty()) {
            task = tryAssignByCategory(
                reviewerId, List.of("fact_error"), List.of("critical", "high")
            );
        }
        
        // 3. 用户反馈中标记的问题
        if (task.isEmpty()) {
            task = tryAssignBySource(
                reviewerId, "user_feedback", List.of("high", "medium")
            );
        }
        
        // 4. 随机抽样审核（日常质量巡检）
        if (task.isEmpty()) {
            task = tryAssignRandomSample(reviewerId);
        }
    }

    private Optional<AiQualityReviewTask> tryAssignByCategory(
            Long reviewerId, List<String> categories, List<String> severities) {
        return taskRepository.findFirstByStatusAndIssueCategoryInAndSeverityInOrderByCreatedAtAsc(
            "pending", categories, severities
        ).map(task -> {
            task.setStatus("assigned");
            task.setAssigneeId(reviewerId);
            task.setAssignedAt(Instant.now());
            return taskRepository.save(task);
        });
    }
}
```

#### 5.2.3 审核工作台 API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/v1/admin/quality/review/tasks` | GET | 获取待审核任务列表（支持按状态/分类/严重度过滤） |
| `/api/v1/admin/quality/review/tasks/{id}` | GET | 获取审核任务详情（含完整对话上下文） |
| `/api/v1/admin/quality/review/tasks/{id}/assign` | POST | 领取/分配任务 |
| `/api/v1/admin/quality/review/tasks/{id}/resolve` | POST | 提交审核结论 |
| `/api/v1/admin/quality/review/stats` | GET | 审核统计数据 |

**审核结论提交请求体：**

```json
{
  "verdict": "confirmed_error",
  "correctedAnswer": "勾股定理的正确公式为 a² + b² = c²，其中 c 为斜边...",
  "correctionType": "knowledge_fix",
  "rootCause": "RAG 检索到的知识库条目本身存在错误，公式中 a 和 c 的位置写反",
  "actionItems": [
    {
      "type": "knowledge_update",
      "target": "kp_math_geometry_pythagorean",
      "description": "修正勾股定理知识库条目中的公式表述"
    },
    {
      "type": "prompt_test",
      "target": "tutoring_math_junior",
      "description": "在数学辅导 Prompt 中增加公式自验证指令"
    }
  ]
}
```