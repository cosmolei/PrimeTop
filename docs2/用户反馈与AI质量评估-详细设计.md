# 用户反馈与 AI 质量评估系统 - 详细设计

## 1. 模块概述

### 1.1 定位

用户反馈与 AI 质量评估系统是 PrimeTop 的跨模块质量保障基础设施，负责收集用户对 AI 输出的反馈、自动评估 AI 回答质量、建立错误回流修正闭环，并提供客服工单能力。该系统不直接面向学生的学习功能，但直接影响所有 AI 交互场景的输出质量持续改进。

### 1.2 解决的核心问题

1. **AI 输出质量不可控**：大模型存在幻觉、解题错误、概念错误等风险，需要系统化的质量监控和纠错机制
2. **用户反馈无处沉淀**：用户对 AI 回答的不满（点踩、投诉、纠错）需要结构化采集和分析
3. **质量改进无闭环**：错误解析无法回流到知识库或 Prompt 模板进行修正，同类问题反复出现
4. **客服缺乏工具**：用户遇到问题后缺少工单系统支撑，运营人员无法追踪处理

### 1.3 涉及的原始文档章节

| 章节 | 关联内容 |
|------|----------|
| 8.5 AI 能力架构 | AI 输出安全处理、质量监控 |
| 12.2 AI 能力迭代 | 质量评分体系、错误回流修正 |
| 12.4 产品端迭代 | 用户反馈、客服、工单和 AI 纠错机制 |
| 13 非功能性需求 | AI 回答准确性和适龄性测试 |
| 16.4 质量指标 | 回答满意率、解析错误反馈率 |

---

## 2. 功能范围

### 2.1 功能清单

| 一级功能 | 二级功能 | 优先级 | 说明 |
|----------|----------|--------|------|
| 即时反馈 | 点赞/点踩 | P0 | AI 每次回答后的快捷反馈 |
| 即时反馈 | 纠错标注 | P0 | 用户标记具体错误类型和位置 |
| 即时反馈 | 文字补充 | P1 | 用户可补充描述问题 |
| 质量自动评估 | 规则评分 | P1 | 基于规则的自动质量打分 |
| 质量自动评估 | 模型评分 | P2 | 调用评估模型进行质量打分 |
| 质量自动评估 | 质量看板 | P1 | 运营后台展示质量趋势 |
| 错误回流 | 知识库修正 | P1 | 将确认错误的回答关联到知识库条目 |
| 错误回流 | Prompt 调优 | P1 | 将典型错误反馈到 Prompt 模板优化 |
| 错误回流 | 解析库更新 | P2 | 将正确解析回流到题库 |
| 工单系统 | 工单创建 | P1 | 用户/运营创建问题工单 |
| 工单系统 | 工单处理 | P1 | 运营人员处理、回复、关闭 |
| 工单系统 | 工单分类 | P2 | 自动分类和优先级标记 |
| 客服入口 | FAQ 自助 | P2 | 常见问题自助查询 |
| 客服入口 | 在线客服 | P3 | 人工客服对接（后期） |

---

## 3. 数据模型

### 3.1 核心表结构

#### 3.1.1 AI 回答记录表 `ai_answer_records`

每次 AI 回答都生成一条记录，作为反馈和质量评估的锚点。

```sql
CREATE TABLE ai_answer_records (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id         BIGINT NOT NULL COMMENT '用户ID',
    conversation_id VARCHAR(64) NOT NULL COMMENT '对话会话ID',
    message_id      VARCHAR(64) NOT NULL COMMENT '消息ID (对应 AIConversation 中的单条)',
    scene           VARCHAR(32) NOT NULL COMMENT '场景: tutor|photo_question|essay|recite|explain|other',
    subject         VARCHAR(16) COMMENT '学科: math|chinese|english|physics|...',
    grade_id        INT COMMENT '年级ID',
    question_text   TEXT COMMENT '用户原始提问 (脱敏后)',
    question_images JSON COMMENT '用户上传图片URL列表',
    ai_model        VARCHAR(64) NOT NULL COMMENT '使用的模型标识: gpt-4o, deepseek-r1, ...',
    prompt_template VARCHAR(64) COMMENT '使用的Prompt模板ID',
    rag_docs        JSON COMMENT 'RAG检索命中的知识库文档ID列表',
    ai_response     TEXT NOT NULL COMMENT 'AI完整回答',
    token_input     INT COMMENT '输入token数',
    token_output    INT COMMENT '输出token数',
    latency_ms      INT COMMENT '首token响应延迟(ms)',
    total_latency_ms INT COMMENT '总响应时间(ms)',
    auto_quality_score DECIMAL(3,2) COMMENT '自动质量评分 0.00-1.00',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_user_id (user_id),
    INDEX idx_scene (scene),
    INDEX idx_created_at (created_at),
    INDEX idx_model_score (ai_model, auto_quality_score),
    INDEX idx_conversation (conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI回答记录';
```

#### 3.1.2 用户反馈表 `user_feedbacks`

```sql
CREATE TABLE user_feedbacks (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    answer_id       BIGINT NOT NULL COMMENT '关联AI回答记录ID',
    user_id         BIGINT NOT NULL COMMENT '反馈用户ID',
    feedback_type   VARCHAR(16) NOT NULL COMMENT 'like|dislike|report|correction',
    
    -- 点赞/点踩 (轻量反馈)
    rating          TINYINT COMMENT '1=赞, -1=踩, NULL=不适用',
    
    -- 纠错详情 (dislike + correction 场景)
    error_types     JSON COMMENT '错误类型标签列表: ["factual_error","calculation_error","off_topic","inappropriate","format_issue","other"]',
    error_position  VARCHAR(16) COMMENT '错误位置: all|beginning|middle|end|specific',
    error_detail    TEXT COMMENT '用户描述的具体错误',
    correction_text TEXT COMMENT '用户提供的正确内容 (可选)',
    screenshot_urls JSON COMMENT '用户截图URL列表',
    
    -- 提交上下文
    client_version  VARCHAR(32) COMMENT '客户端版本号',
    platform        VARCHAR(16) COMMENT 'android|ios|web',
    
    -- 审核状态
    review_status   VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending|confirmed|rejected|ignored',
    reviewer_id     BIGINT COMMENT '审核人ID',
    review_note     TEXT COMMENT '审核备注',
    reviewed_at     DATETIME COMMENT '审核时间',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_answer_id (answer_id),
    INDEX idx_user_id (user_id),
    INDEX idx_type_status (feedback_type, review_status),
    INDEX idx_created_at (created_at),
    CONSTRAINT fk_feedback_answer FOREIGN KEY (answer_id) REFERENCES ai_answer_records(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户反馈';
```

#### 3.1.3 质量评估任务表 `quality_evaluations`

```sql
CREATE TABLE quality_evaluations (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    answer_id       BIGINT NOT NULL COMMENT '关联AI回答记录ID',
    eval_type       VARCHAR(16) NOT NULL COMMENT 'rule|model|human',
    
    -- 评分维度 (每个维度 1-5 分)
    score_accuracy  TINYINT COMMENT '准确性: 内容是否正确',
    score_relevance TINYINT COMMENT '相关性: 是否回答了用户的问题',
    score_clarity   TINYINT COMMENT '清晰度: 表达是否清晰易懂',
    score_age_fit   TINYINT COMMENT '适龄性: 是否匹配用户年级',
    score_safety    TINYINT COMMENT '安全性: 是否有不当内容',
    score_overall   TINYINT NOT NULL COMMENT '综合评分 1-5',
    
    -- 评估详情
    eval_model      VARCHAR(64) COMMENT '评估模型标识 (eval_type=model时)',
    eval_rules_hit  JSON COMMENT '命中的规则列表 (eval_type=rule时)',
    eval_detail     TEXT COMMENT '评估详情/原因说明',
    issues_found    JSON COMMENT '发现的问题列表: [{"type":"factual_error","location":"step3","detail":"..."}]',
    
    -- 标签
    is_flagged      BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否标记为需要关注',
    flag_reason     VARCHAR(128) COMMENT '标记原因',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_answer_id (answer_id),
    INDEX idx_type (eval_type),
    INDEX idx_score_overall (score_overall),
    INDEX idx_flagged (is_flagged),
    CONSTRAINT fk_eval_answer FOREIGN KEY (answer_id) REFERENCES ai_answer_records(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='质量评估记录';
```

#### 3.1.4 错误回流任务表 `error_correction_tasks`

```sql
CREATE TABLE error_correction_tasks (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    source_type     VARCHAR(16) NOT NULL COMMENT 'feedback|evaluation|manual',
    source_id       BIGINT COMMENT '来源ID (反馈ID或评估ID)',
    answer_id       BIGINT NOT NULL COMMENT '关联AI回答记录ID',
    
    -- 错误信息
    error_summary   VARCHAR(512) NOT NULL COMMENT '错误摘要',
    error_category  VARCHAR(32) NOT NULL COMMENT 'knowledge|prompt|rag|model|format|other',
    severity        VARCHAR(16) NOT NULL COMMENT 'critical|major|minor',
    
    -- 关联资源
    knowledge_id    BIGINT COMMENT '关联知识库条目ID (如有)',
    question_id     BIGINT COMMENT '关联题库题目ID (如有)',
    prompt_template VARCHAR(64) COMMENT '关联Prompt模板ID (如有)',
    
    -- 处理流程
    status          VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending|assigned|fixing|verified|closed|wontfix',
    assignee_id     BIGINT COMMENT '处理人ID',
    fix_action      VARCHAR(32) COMMENT 'update_knowledge|update_prompt|update_answer|add_rag_doc|no_fix_needed',
    fix_detail      TEXT COMMENT '修复详情描述',
    
    -- 验证
    verified_by     BIGINT COMMENT '验证人ID',
    verified_at     DATETIME COMMENT '验证时间',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_status (status),
    INDEX idx_category (error_category),
    INDEX idx_assignee (assignee_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='错误回流修正任务';
```

#### 3.1.5 客服工单表 `support_tickets`

```sql
CREATE TABLE support_tickets (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    ticket_no       VARCHAR(32) NOT NULL UNIQUE COMMENT '工单号: TK-20260519-000001',
    user_id         BIGINT NOT NULL COMMENT '提交用户ID',
    
    -- 工单信息
    category        VARCHAR(32) NOT NULL COMMENT 'ai_quality|account|payment|content|bug|feature_request|other',
    sub_category    VARCHAR(32) COMMENT '子分类',
    priority        VARCHAR(8) NOT NULL DEFAULT 'normal' COMMENT 'urgent|high|normal|low',
    title           VARCHAR(256) NOT NULL COMMENT '工单标题',
    description     TEXT NOT NULL COMMENT '问题描述',
    attachments     JSON COMMENT '附件URL列表',
    
    -- 关联 (可选)
    answer_id       BIGINT COMMENT '关联AI回答ID',
    feedback_id     BIGINT COMMENT '关联反馈ID',
    order_id        BIGINT COMMENT '关联订单ID',
    
    -- 状态流转
    status          VARCHAR(16) NOT NULL DEFAULT 'open' COMMENT 'open|in_progress|waiting_user|resolved|closed',
    
    -- 处理信息
    assignee_id     BIGINT COMMENT '处理人ID',
    resolution      TEXT COMMENT '解决方案/回复内容',
    resolved_at     DATETIME COMMENT '解决时间',
    closed_at       DATETIME COMMENT '关闭时间',
    
    -- 满意度
    satisfaction    TINYINT COMMENT '满意度 1-5 (用户评价)',
    user_comment    TEXT COMMENT '用户评价内容',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_category_priority (category, priority),
    INDEX idx_assignee (assignee_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客服工单';
```

#### 3.1.6 工单回复表 `ticket_replies`

```sql
CREATE TABLE ticket_replies (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    ticket_id       BIGINT NOT NULL COMMENT '工单ID',
    reply_type      VARCHAR(16) NOT NULL COMMENT 'user|staff|system',
    replier_id      BIGINT COMMENT '回复人ID (staff时为运营人员ID)',
    content         TEXT NOT NULL COMMENT '回复内容',
    attachments     JSON COMMENT '附件URL列表',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_ticket_id (ticket_id),
    CONSTRAINT fk_reply_ticket FOREIGN KEY (ticket_id) REFERENCES support_tickets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='工单回复';
```

### 3.2 ER 关系

```
User 1──N AIAnswerRecord 1──N UserFeedback
                          1──N QualityEvaluation
                          1──N ErrorCorrectionTask
User 1──N SupportTicket 1──N TicketReply
AIAnswerRecord ──┬── KnowledgePoint (通过 rag_docs 关联)
                 ├── Question (通过 photo_question 场景关联)
                 └── PromptTemplate (通过 prompt_template 关联)
```

---

## 4. API 接口设计

### 4.1 即时反馈接口

#### 提交反馈

```
POST /api/v1/feedback
```

请求体：
```json
{
  "answerId": 12345,
  "feedbackType": "correction",
  "rating": -1,
  "errorTypes": ["factual_error", "calculation_error"],
  "errorPosition": "middle",
  "errorDetail": "第3步的公式应该是 F=ma 而不是 F=mv",
  "correctionText": "根据牛顿第二定律，F=ma"
}
```

响应：
```json
{
  "code": 0,
  "data": {
    "feedbackId": 67890,
    "message": "感谢反馈，我们会认真核实"
  }
}
```

**校验规则：**
- `answerId` 必须存在且属于当前用户
- 同一用户对同一回答同一 `feedbackType` 只能提交一次（幂等）
- `feedbackType=like` 时只需 `rating=1`
- `feedbackType=correction` 时 `errorTypes` 和 `errorDetail` 必填

#### 撤回反馈

```
DELETE /api/v1/feedback/{feedbackId}
```

#### 查询回答的反馈统计

```
GET /api/v1/feedback/stats?answerId=12345
```

响应：
```json
{
  "code": 0,
  "data": {
    "answerId": 12345,
    "likeCount": 15,
    "dislikeCount": 2,
    "correctionCount": 1,
    "myFeedback": {
      "feedbackType": "like",
      "rating": 1
    }
  }
}
```

### 4.2 质量评估接口 (内部服务调用)

#### 触发自动评估

```
POST /api/internal/v1/quality/evaluate
```

请求体：
```json
{
  "answerId": 12345,
  "evalTypes": ["rule"]
}
```

响应：
```json
{
  "code": 0,
  "data": {
    "evaluationId": 111,
    "scoreOverall": 4,
    "isFlagged": false,
    "issuesFound": []
  }
}
```

#### 批量获取质量统计

```
GET /api/internal/v1/quality/stats?scene=tutor&model=gpt-4o&startDate=2026-05-01&endDate=2026-05-19&groupBy=model,scene
```

响应：
```json
{
  "code": 0,
  "data": {
    "groups": [
      {
        "model": "gpt-4o",
        "scene": "tutor",
        "totalAnswers": 15000,
        "avgScore": 4.2,
        "flaggedCount": 45,
        "dislikeRate": 0.032,
        "correctionRate": 0.008
      }
    ]
  }
}
```

### 4.3 错误回流接口 (运营后台)

#### 查询待处理错误回流任务

```
GET /api/admin/v1/error-corrections?status=pending&category=knowledge&page=1&pageSize=20
```

#### 处理错误回流任务

```
PUT /api/admin/v1/error-corrections/{taskId}/process
```

请求体：
```json
{
  "action": "update_knowledge",
  "fixDetail": "已更新牛顿第二定律知识库条目，补充常见错误公式对比",
  "status": "verified"
}
```

#### 批量确认反馈

```
POST /api/admin/v1/feedback/batch-review
```

请求体：
```json
{
  "feedbackIds": [101, 102, 103],
  "reviewStatus": "confirmed",
  "autoCreateCorrectionTask": true,
  "reviewNote": "批量确认，均为知识点错误"
}
```

### 4.4 工单接口

#### 创建工单

```
POST /api/v1/tickets
```

请求体：
```json
{
  "category": "ai_quality",
  "title": "数学题解析步骤错误",
  "description": "今天拍照搜的一道二次函数题，AI解析中判别式计算有误",
  "answerId": 12345,
  "attachments": ["https://cdn.primetop.com/ticket/img001.jpg"]
}
```

响应：
```json
{
  "code": 0,
  "data": {
    "ticketId": 501,
    "ticketNo": "TK-20260519-000501"
  }
}
```

#### 查询我的工单列表

```
GET /api/v1/tickets?status=open&page=1&pageSize=10
```

#### 工单详情

```
GET /api/v1/tickets/{ticketId}
```

#### 回复工单

```
POST /api/v1/tickets/{ticketId}/replies
```

请求体：
```json
{
  "content": "问题已修复，感谢反馈！"
}
```

#### 关闭工单

```
PUT /api/v1/tickets/{ticketId}/close
```

请求体（可选满意度）：
```json
{
  "satisfaction": 4,
  "comment": "处理及时，回答满意"
}
```

#### 运营端工单管理

```
GET /api/admin/v1/tickets?status=open&category=ai_quality&priority=high&page=1&pageSize=20
PUT /api/admin/v1/tickets/{ticketId}/assign   # 分配处理人
PUT /api/admin/v1/tickets/{ticketId}/status    # 更新状态
POST /api/admin/v1/tickets/{ticketId}/replies  # 运营回复
```

---

## 5. 核心流程设计

### 5.1 即时反馈流程

```
用户看到AI回答
    │
    ├── 满意 → 点击👍 → POST /feedback (type=like, rating=1)
    │         → 记录到 user_feedbacks
    │         → 更新 ai_answer_records 的统计缓存
    │
    └── 不满意 → 点击👎 → 弹出快捷反馈面板
                    │
                    ├── 快速点踩 → POST /feedback (type=dislike, rating=-1)
                    │
                    ├── 标记纠错 → 选择错误类型 + 填写描述
                    │             → POST /feedback (type=correction)
                    │             → 后台自动创建 error_correction_task (severity=minor)
                    │
                    └── 投诉/详细反馈 → 跳转工单创建页
                                      → POST /tickets
```

### 5.2 自动质量评估流程

```python
# quality_evaluator.py - 核心评估逻辑

class QualityEvaluator:
    """AI回答质量自动评估器"""
    
    async def evaluate(self, answer_record: AIAnswerRecord) -> QualityEvaluation:
        scores = {}
        issues = []
        
        # ---- 规则评估 (P1, 必做) ----
        rule_result = await self._rule_based_eval(answer_record)
        scores.update(rule_result.scores)
        issues.extend(rule_result.issues)
        
        # ---- 模型评估 (P2, 采样触发) ----
        if self._should_model_eval(answer_record):
            model_result = await self._model_based_eval(answer_record)
            scores.update(model_result.scores)
            issues.extend(model_result.issues)
        
        # 综合评分
        overall = self._compute_overall(scores)
        is_flagged = overall < 3.0 or len(issues) > 0
        
        return QualityEvaluation(
            answer_id=answer_record.id,
            eval_type='rule' if not model_result else 'combined',
            score_accuracy=scores.get('accuracy'),
            score_relevance=scores.get('relevance'),
            score_clarity=scores.get('clarity'),
            score_age_fit=scores.get('age_fit'),
            score_safety=scores.get('safety'),
            score_overall=overall,
            issues_found=issues,
            is_flagged=is_flagged,
            flag_reason='low_score' if overall < 3.0 else 'issues_found' if issues else None,
        )
    
    def _should_model_eval(self, record: AIAnswerRecord) -> bool:
        """决定是否触发模型评估 (成本控制)"""
        # 策略: 100% 规则评估 + 10% 随机采样模型评估
        # 对低分回答、dislike反馈、高风险场景 100% 模型评估
        if record.auto_quality_score and record.auto_quality_score < 0.6:
            return True
        if record.scene in ['photo_question', 'essay']:
            return random.random() < 0.15
        return random.random() < 0.05
```

### 5.3 规则评估引擎

```python
# rule_engine.py

class RuleBasedEvaluator:
    """基于规则的质量评估"""
    
    RULES = [
        # ---- 安全性规则 (硬拦截) ----
        {
            'id': 'R001',
            'name': '敏感内容检测',
            'dimension': 'safety',
            'severity': 'critical',
            'check': lambda ctx: content_safety_check(ctx.response),
            'issue_type': 'inappropriate_content',
        },
        {
            'id': 'R002',
            'name': '答案泄露检测',
            'dimension': 'safety',
            'severity': 'major',
            'check': lambda ctx: direct_answer_leak_check(ctx),
            'issue_type': 'answer_leak',
        },
        
        # ---- 格式规则 ----
        {
            'id': 'R003',
            'name': '回答过短检测',
            'dimension': 'clarity',
            'severity': 'minor',
            'check': lambda ctx: len(ctx.response) < 20,
            'issue_type': 'too_short',
        },
        {
            'id': 'R004',
            'name': '公式格式检查',
            'dimension': 'clarity',
            'severity': 'minor',
            'check': lambda ctx: check_math_format(ctx),
            'issue_type': 'format_issue',
        },
        
        # ---- 相关性规则 ----
        {
            'id': 'R005',
            'name': '学科匹配检查',
            'dimension': 'relevance',
            'severity': 'major',
            'check': lambda ctx: subject_mismatch_check(ctx),
            'issue_type': 'off_topic',
        },
        
        # ---- 适龄性规则 ----
        {
            'id': 'R006',
            'name': '语言复杂度检查',
            'dimension': 'age_fit',
            'severity': 'minor',
            'check': lambda ctx: language_complexity_check(ctx),
            'issue_type': 'too_complex',
        },
    ]
    
    async def evaluate(self, ctx: EvalContext) -> RuleEvalResult:
        scores = {
            'accuracy': 4,     # 默认分，规则无法判定则保持
            'relevance': 4,
            'clarity': 4,
            'age_fit': 4,
            'safety': 5,       # 安全性默认满分
        }
        issues = []
        
        for rule in self.RULES:
            try:
                is_violated = rule['check'](ctx)
                if is_violated:
                    dim = rule['dimension']
                    scores[dim] = max(1, scores[dim] - 
                        (3 if rule['severity'] == 'critical' else
                         2 if rule['severity'] == 'major' else 1))
                    issues.append({
                        'rule_id': rule['id'],
                        'type': rule['issue_type'],
                        'severity': rule['severity'],
                        'detail': f"规则 {rule['name']} 触发"
                    })
            except Exception as e:
                logger.warning(f"Rule {rule['id']} check failed: {e}")
        
        return RuleEvalResult(scores=scores, issues=issues)
```

### 5.4 错误回流修正闭环

```
用户反馈 / 自动评估发现错误
    │
    ▼
创建 ErrorCorrectionTask
(status=pending, severity 根据来源判定)
    │
    ▼
运营后台分配处理人
(status → assigned)
    │
    ├── 知识库错误 → 更新/补充知识库条目
    │   fix_action = update_knowledge
    │   → 通知 RAG 系统重新索引
    │
    ├── Prompt 模板问题 → 调整 Prompt 模板
    │   fix_action = update_prompt
    │   → 通知 Prompt 编排系统更新
    │
    ├── 题库解析错误 → 更新题库解析
    │   fix_action = update_answer
    │   → 更新 Question 表的解析字段
    │
    ├── 缺少 RAG 文档 → 新增知识库文档
    │   fix_action = add_rag_doc
    │   → 触发向量化管道
    │
    └── 非系统问题 → 标记 wontfix
        fix_action = no_fix_needed
    │
    ▼
验证修复效果
(status → verified)
    │
    ├── 用原问题重新触发 AI → 对比修复前后回答
    │
    ▼
关闭任务 (status → closed)
    │
    ▼
更新质量指标 & 通知用户 (可选)
```

### 5.5 工单状态流转

```
                  ┌─────────────────┐
                  │                 │
                  ▼                 │
  [open] ──► [in_progress] ──► [waiting_user] ──► [resolved] ──► [closed]
                  │                    ▲
                  │                    │
                  └────────────────────┘
                  (需用户补充信息)
```

| 状态 | 触发条件 | 可流转到 |
|------|----------|----------|
| open | 用户创建工单 | in_progress |
| in_progress | 运营人员接单 | waiting_user, resolved |
| waiting_user | 运营需要用户补充信息 | in_progress (用户回复后) |
| resolved | 运营标记已解决 | closed (用户确认后自动, 或7天自动) |
| closed | 用户确认 / 超时自动 | - |

---

## 6. 自动评分采样与成本控制

### 6.1 采样策略

| 场景 | 规则评估 | 模型评估 |
|------|----------|----------|
| 全部场景 | 100% 实时 | - |
| 拍题答疑 (photo_question) | 100% | 15% 随机采样 |
| 作文批改 (essay) | 100% | 15% 随机采样 |
| 理科解题 (science_solve) | 100% | 10% 随机采样 |
| 普通辅导 (tutor) | 100% | 5% 随机采样 |
| 背诵检测 (recite) | 100% | 3% 随机采样 |
| 被点踩的回答 | 已执行 | 100% 补充评估 |
| 自动评分 < 3 分 | 已执行 | 100% 补充评估 |

### 6.2 模型评估 Prompt

```python
MODEL_EVAL_PROMPT = """
你是一个教育内容质量评估专家。请评估以下AI教师给学生的回答质量。

## 学生信息
- 年级: {grade}
- 学科: {subject}
- 场景: {scene}

## 学生提问
{question}

## AI回答
{response}

## 评估维度 (每项 1-5 分)

1. **准确性** (accuracy): 内容是否正确，公式/概念/事实有无错误
2. **相关性** (relevance): 是否切题回答了学生的问题
3. **清晰度** (clarity): 表达是否清晰，逻辑是否连贯，排版是否良好
4. **适龄性** (age_fit): 语言和深度是否匹配该年级学生
5. **安全性** (safety): 是否有不适宜内容或直接给答案导致抄写

## 输出格式 (严格 JSON)
```json
{
  "accuracy": 5,
  "relevance": 5,
  "clarity": 4,
  "age_fit": 5,
  "safety": 5,
  "overall": 5,
  "issues": [
    {"type": "format_issue", "location": "step2", "detail": "公式排版不清晰"}
  ],
  "summary": "回答准确清晰，适合该年级学生"
}
```
"""
```

---

## 7. 质量看板指标

### 7.1 核心指标定义

| 指标 | 计算公式 | 目标 | 告警阈值 |
|------|----------|------|----------|
| AI回答满意率 | like_count / (like_count + dislike_count) | ≥ 85% | < 75% |
| 纠错反馈率 | correction_count / total_answers | ≤ 3% | > 5% |
| 自动质量均分 | AVG(score_overall) WHERE eval_type='rule' | ≥ 4.0 | < 3.5 |
| 安全拦截率 | safety_flagged / total_answers | 监控 | > 0.1% |
| 工单平均处理时长 | AVG(resolved_at - created_at) WHERE category='ai_quality' | ≤ 24h | > 48h |
| 错误回流关闭率 | closed_tasks / total_tasks | ≥ 90% | < 70% |
| 按场景/模型满意率 | 同上按维度拆分 | 同上 | 同上 |

### 7.2 看板 API

```
GET /api/admin/v1/quality/dashboard?period=7d
```

响应：
```json
{
  "code": 0,
  "data": {
    "period": "2026-05-12 ~ 2026-05-19",
    "totalAnswers": 150000,
    "totalFeedbacks": 12500,
    "satisfactionRate": 0.87,
    "correctionRate": 0.018,
    "avgQualityScore": 4.15,
    "tickets": {
      "open": 23,
      "avgResolveHours": 18.5,
      "satisfactionAvg": 4.1
    },
    "corrections": {
      "pending": 45,
      "closedThisWeek": 120,
      "closeRate": 0.92
    },
    "byScene": [
      {"scene": "tutor", "total": 80000, "satisfactionRate": 0.89, "avgScore": 4.2},
      {"scene": "photo_question", "total": 40000, "satisfactionRate": 0.82, "avgScore": 3.95},
      {"scene": "essay", "total": 15000, "satisfactionRate": 0.91, "avgScore": 4.3},
      {"scene": "recite", "total": 10000, "satisfactionRate": 0.85, "avgScore": 4.0}
    ],
    "byModel": [
      {"model": "gpt-4o", "total": 60000, "satisfactionRate": 0.88, "avgScore": 4.2},
      {"model": "deepseek-r1", "total": 50000, "satisfactionRate": 0.86, "avgScore": 4.1},
      {"model": "glm-4", "total": 40000, "satisfactionRate": 0.84, "avgScore": 4.0}
    ],
    "trend": {
      "dates": ["05-13", "05-14", "05-15", "05-16", "05-17", "05-18", "05-19"],
      "satisfactionRates": [0.86, 0.87, 0.85, 0.88, 0.87, 0.89, 0.87],
      "avgScores": [4.1, 4.15, 4.05, 4.2, 4.15, 4.2, 4.15]
    }
  }
}
```

---

## 8. 事件驱动集成

### 8.1 事件定义

| 事件名 | 触发时机 | 消费者 |
|--------|----------|--------|
| `answer.created` | AI回答生成完成 | 质量评估服务(触发规则评估) |
| `feedback.created` | 用户提交反馈 | 质量评估服务(触发模型评估采样), 数据埋点 |
| `feedback.confirmed` | 运营确认反馈 | 错误回流服务(创建修正任务) |
| `correction.completed` | 错误回流修复完成 | RAG服务(重索引), Prompt服务(更新模板) |
| `ticket.created` | 工单创建 | 通知服务(通知运营) |
| `ticket.reply.created` | 工单回复 | 通知服务(通知用户) |
| `quality.alert` | 质量指标低于阈值 | 通知服务(告警运营) |

### 8.2 事件消息格式

```json
{
  "event": "feedback.created",
  "timestamp": "2026-05-19T09:41:00Z",
  "data": {
    "feedbackId": 67890,
    "answerId": 12345,
    "userId": 100001,
    "feedbackType": "correction",
    "rating": -1,
    "errorTypes": ["factual_error"],
    "scene": "photo_question",
    "model": "deepseek-r1"
  }
}
```

### 8.3 与其他模块的交互

```
┌──────────────────────────────────────────────────────┐
│                   客户端 (APP)                        │
│  AI回答页 → [👍] [👎] [纠错] → POST /feedback        │
│  设置页 → [帮助与反馈] → 工单列表/创建                 │
└──────────────┬───────────────────────────┬───────────┘
               │                           │
        API Gateway                 API Gateway
               │                           │
    ┌──────────▼──────────┐    ┌───────────▼──────────┐
    │  反馈服务            │    │  工单服务              │
    │  - 接收/查询反馈     │    │  - 创建/查询工单       │
    │  - 发出事件          │    │  - 状态流转            │
    └──────────┬──────────┘    └───────────┬──────────┘
               │                           │
        ┌──────▼──────────────────────────────▼──────┐
        │            消息队列 (Kafka/RabbitMQ)        │
        └──┬───────────┬──────────────┬──────────┬───┘
           │           │              │          │
    ┌──────▼──────┐ ┌──▼──────┐ ┌────▼─────┐ ┌──▼───────┐
    │ 质量评估服务 │ │错误回流  │ │通知服务   │ │数据埋点   │
    │ - 规则评估  │ │ - 任务  │ │ - 告警   │ │ - 指标    │
    │ - 模型评估  │ │ - 修正  │ │ - 推送   │ │ - 看板    │
    │ - 看板      │ │ - 验证  │ │          │ │          │
    └──────┬──────┘ └──┬──────┘ └──────────┘ └──────────┘
           │           │
    ┌──────▼───────────▼──────────────────────────┐
    │        RAG服务 / Prompt服务 / 题库服务        │
    │        (接收修正指令，更新对应资源)            │
    └──────────────────────────────────────────────┘
```

---

## 9. 错误处理

### 9.1 反馈服务错误码

| 错误码 | HTTP | 含义 | 处理方式 |
|--------|------|------|----------|
| `FEEDBACK_ALREADY_EXISTS` | 409 | 该用户已对该回答提交过同类型反馈 | 前端提示"已反馈" |
| `ANSWER_NOT_FOUND` | 404 | 关联的AI回答不存在 | 前端提示"回答已过期" |
| `ANSWER_NOT_OWNED` | 403 | 非本用户的AI回答 | 拒绝操作 |
| `FEEDBACK_PARAM_INVALID` | 400 | 纠错类型缺少必填字段 | 前端校验后重试 |
| `FEEDBACK_RATE_LIMITED` | 429 | 反馈频率过高 (每人每分钟≤10次) | 前端提示稍后重试 |

### 9.2 质量评估容错

```python
# 评估失败不应影响AI回答的主流程
async def evaluate_with_fallback(answer_record):
    try:
        result = await evaluator.evaluate(answer_record)
        await db.save(result)
    except Exception as e:
        # 评估失败只记录日志，不影响用户体验
        logger.error(f"Quality eval failed for answer {answer_record.id}: {e}")
        # 记录失败，后续可重试
        await db.save(EvalFailureLog(
            answer_id=answer_record.id,
            error=str(e)
        ))
```

### 9.3 工单系统错误处理

| 场景 | 处理 |
|------|------|
| 工单创建失败 | 返回友好提示，建议稍后重试 |
| 工单关联的 answerId 不存在 | 忽略关联，正常创建工单 |
| 工单超时未关闭 (resolved 7天后) | 定时任务自动关闭 |
| 运营回复失败 | 重试3次，失败则记录日志 |

---

## 10. 配置项

### 10.1 系统配置 (存储在配置中心)

```yaml
quality:
  evaluation:
    # 规则评估开关
    rule_enabled: true
    # 模型评估开关
    model_enabled: false  # P2阶段开启
    # 各场景模型评估采样率
    model_sample_rates:
      photo_question: 0.15
      essay: 0.15
      science_solve: 0.10
      tutor: 0.05
      recite: 0.03
    # 低分阈值 (触发强制模型评估)
    low_score_threshold: 3.0
    # 模型评估使用的模型
    eval_model: "gpt-4o-mini"

  feedback:
    # 每人每分钟反馈上限
    rate_limit_per_minute: 10
    # 反馈后是否自动创建错误回流任务
    auto_create_correction_on_dislike: false
    auto_create_correction_on_correction: true
    # 自动创建时的默认severity
    auto_correction_severity: minor

  alert:
    # 满意率告警阈值
    satisfaction_rate_threshold: 0.75
    # 纠错率告警阈值
    correction_rate_threshold: 0.05
    # 检测周期 (分钟)
    check_interval_minutes: 30
    # 告警接收渠道
    alert_channels: ["webhook", "admin_notification"]

  ticket:
    # 工单号前缀
    ticket_prefix: "TK"
    # resolved 状态自动关闭天数
    auto_close_days: 7
    # 工单分类列表
    categories:
      - ai_quality
      - account
      - payment
      - content
      - bug
      - feature_request
      - other
```

---

## 11. 开发优先级与里程碑

### 11.1 MVP 阶段 (P0)

| 功能 | 工作量 | 依赖 |
|------|--------|------|
| 点赞/点踩接口 | 1d | AI智能辅导 (answerId) |
| 反馈表结构 + CRUD | 1d | - |
| 客户端反馈UI组件 | 1d | - |
| 规则评估引擎 (核心5条规则) | 2d | - |
| 管理后台反馈列表 + 审核 | 1.5d | 内容与运营后台 |

**MVP 总计：约 6.5 人天**

### 11.2 V1.0 阶段 (P1)

| 功能 | 工作量 | 依赖 |
|------|--------|------|
| 纠错标注 (错误类型选择) | 1d | MVP 反馈系统 |
| 错误回流任务管理 | 2d | MVP 反馈审核 |
| 工单系统 (创建/查询/回复) | 3d | - |
| 运营后台工单管理 | 2d | 工单系统 |
| 质量看板 (基础指标) | 2d | 规则评估数据 |
| 工单状态自动流转 | 1d | 工单系统 |

**V1.0 总计：约 11 人天**

### 11.3 V1.5 阶段 (P2)

| 功能 | 工作量 |
|------|--------|
| 模型评估集成 | 3d |
| 知识库/Prompt 自动回流 | 3d |
| FAQ 自助系统 | 2d |
| 质量趋势分析 + 告警 | 2d |

---

## 12. 与其他模块的依赖关系

| 依赖模块 | 依赖内容 | 方向 |
|----------|----------|------|
| AI智能辅导 | 回答ID、对话上下文 | 读取 |
| 拍照搜题与习题答疑 | 题目ID、识别结果 | 读取 |
| RAG与知识库系统 | 知识库条目ID、重索引 | 读取 + 写入 |
| AI-Prompt编排系统 | Prompt模板ID、模板更新 | 读取 + 写入 |
| 数据埋点与关键指标系统 | 质量指标数据输出 | 写入 |
| 内容与运营后台 | 反馈审核、工单管理、质量看板 | 写入 |
| 消息与推送服务 | 告警通知、工单状态通知 | 写入 |
| API网关与通用接口规范 | 接口规范、鉴权、限流 | 遵循 |
| 安全与内容合规系统 | 内容安全检测结果 | 读取 |
| 用户账号体系 | 用户ID、年级信息 | 读取 |
