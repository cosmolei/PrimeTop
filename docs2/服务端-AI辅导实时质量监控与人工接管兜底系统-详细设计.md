# 服务端-AI辅导实时质量监控与人工接管兜底系统-详细设计

## 1. 概述

### 1.1 功能定位

本系统是 PrimeTop AI 辅导产品的**实时质量保障兜底层**，与已有的"事后审核"体系（AI对话质量抽样审核、AI回答质量监控与用户纠错反馈、AI幻觉检测等）形成互补，填补**会话进行中**的实时质量感知、风险预警和人工接管能力空白。

核心职责：
1. **实时监控**：对每一轮 AI 辅导对话进行实时质量评估，识别潜在风险
2. **风险预警**：当检测到 AI 回答质量异常、学生持续困惑、对话偏离学习目标等情况时，触发分级预警
3. **人工接管**：为运营/教研团队提供实时人工接管通道，支持无缝切换至人工辅导
4. **兜底保障**：面向未成年人的安全底线——确保任何 AI 辅导会话都不会"失控"

### 1.2 设计目标

| 目标 | 指标 |
| --- | --- |
| 实时检测延迟 | AI 回复生成后 ≤ 2s 内完成质量初评 |
| 高风险会话识别率 | ≥ 95%（宁可误报，不可漏报） |
| 人工接管切换时间 | ≤ 5s（从触发到接管人开始回复） |
| 系统可用性 | 99.95%（作为安全兜底系统，必须高可用） |
| 单会话监控开销 | 增加 ≤ 200ms 额外延迟 |

### 1.3 与现有系统的关系

```
┌─────────────────────────────────────────────────────────────┐
│                     AI 辅导对话链路                          │
│                                                             │
│  用户提问 → AI输入安全护栏 → RAG检索 → 大模型生成            │
│                ↓                                           │
│         [本系统] 实时质量监控拦截点                          │
│                ↓                                           │
│  AI后处理优化 → 知识点标注 → SSE流式输出给客户端             │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              质量保障体系（全景）                      │   │
│  │                                                     │   │
│  │  事前：AI输入安全护栏引擎（已设计）                    │   │
│  │  事中：★ 本系统 - 实时质量监控与人工接管 ★            │   │
│  │  事后：AI对话质量抽样审核（已设计）                    │   │
│  │        AI回答质量监控与用户纠错反馈（已设计）          │   │
│  │        AI幻觉检测与教育事实校验（已设计）              │   │
│  │        AI辅导对话教育成效评估（已设计）                │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 整体架构

### 2.1 系统架构图

```
┌──────────────────────────────────────────────────────────────────────┐
│                        客户端 (APP)                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │ AI对话页面    │  │ 人工接管提示  │  │ 用户反馈（实时评分/举报） │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬──────────────┘  │
└─────────┼─────────────────┼───────────────────────┼──────────────────┘
          │ SSE/WebSocket   │ WebSocket              │ REST
          ▼                 ▼                        ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      API 网关 / BFF                                   │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
          ┌────────────┼────────────────┬─────────────────┐
          ▼            ▼                ▼                 ▼
┌─────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────────┐
│ AI对话服务  │ │ ★ 质量监控   │ │ 人工接管     │ │ 运营监控台     │
│ (已有)      │ │   引擎 ★     │ │ 服务         │ │ (Web后台)      │
│             │ │              │ │              │ │                │
│ • 对话编排  │ │ • 实时评估   │ │ • 接管会话   │ │ • 实时大盘     │
│ • 大模型调用│ │ • 风险检测   │ │ • 消息代理   │ │ • 预警列表     │
│ • SSE推送  │ │ • 预警触发   │ │ • 上下文同步 │ │ • 接管工作台   │
│             │ │ • 降级建议   │ │ • 结束/恢复  │ │ • 质量分析     │
└──────┬──────┘ └──────┬───────┘ └──────┬───────┘ └────────┬───────┘
       │               │                │                   │
       └───────────────┴────────────────┴───────────────────┘
                              │
                    ┌─────────┴──────────┐
                    ▼                    ▼
           ┌──────────────┐    ┌──────────────────┐
           │ 事件流 Kafka  │    │ PostgreSQL       │
           │ (质量事件)    │    │ • 监控记录       │
           │              │    │ • 接管记录       │
           │              │    │ • 质量评估快照   │
           │              │    │ • 预警工单       │
           └──────┬───────┘    └──────────────────┘
                  │
                  ▼
           ┌──────────────────┐    ┌──────────────────┐
           │ Redis            │    │ ClickHouse       │
           │ • 会话质量状态   │    │ • 质量指标统计   │
           │ • 实时风险分数   │    │ • 趋势分析       │
           │ • 接管会话映射   │    │ • 运营报表       │
           │ • 频控计数器     │    │                  │
           └──────────────────┘    └──────────────────┘
```

### 2.2 核心组件职责

| 组件 | 职责 | 部署方式 |
| --- | --- | --- |
| quality-monitor-engine | 实时质量评估引擎，消费对话事件，输出质量评分和风险标签 | 独立服务，水平扩展 |
| risk-detector | 风险检测器，基于规则+模型判断是否需要预警 | quality-monitor-engine 内部模块 |
| alert-dispatcher | 预警分发器，将预警推送到监控台和通知渠道 | 独立微服务 |
| human-takeover-service | 人工接管服务，管理接管会话的生命周期 | 独立微服务 |
| session-context-broker | 会话上下文代理，在AI/人工之间同步对话状态 | human-takeover-service 内部模块 |
| monitor-dashboard | 运营监控台前端，展示实时预警和接管工作台 | Web 应用 |

---

## 3. 数据结构设计

### 3.1 核心数据模型

#### 3.1.1 会话质量监控记录 (ai_session_quality)

```sql
CREATE TABLE ai_session_quality (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    session_id      VARCHAR(64) NOT NULL COMMENT 'AI对话会话ID',
    user_id         BIGINT NOT NULL COMMENT '用户ID',
    user_grade      VARCHAR(20) NOT NULL COMMENT '用户年级',
    subject         VARCHAR(20) COMMENT '学科',
    
    -- 实时质量评分
    current_quality_score  DECIMAL(4,2) DEFAULT 0 COMMENT '当前质量综合评分 0-100',
    current_risk_level     VARCHAR(20) DEFAULT 'safe' COMMENT '当前风险等级: safe/low/medium/high/critical',
    confidence_score       DECIMAL(4,2) DEFAULT 100 COMMENT 'AI回答置信度 0-100',
    
    -- 累计统计
    total_turns            INT DEFAULT 0 COMMENT '总对话轮次',
    quality_issues_count   INT DEFAULT 0 COMMENT '质量问题累计次数',
    user_negative_signals  INT DEFAULT 0 COMMENT '用户负面信号累计(不理解/不满意)',
    
    -- 状态
    monitor_status         VARCHAR(20) DEFAULT 'active' COMMENT '监控状态: active/alerted/taken_over/closed',
    is_taken_over          BOOLEAN DEFAULT FALSE COMMENT '是否已被人工接管',
    takeover_id            BIGINT COMMENT '接管记录ID（关联human_takeover_record）',
    
    -- 时间
    started_at             DATETIME NOT NULL COMMENT '会话开始时间',
    last_evaluated_at      DATETIME COMMENT '最近一次评估时间',
    last_alert_at          DATETIME COMMENT '最近一次预警时间',
    closed_at              DATETIME COMMENT '监控关闭时间',
    
    -- 扩展
    risk_tags              JSON COMMENT '风险标签数组',
    quality_timeline       JSON COMMENT '质量评分时间线 [{turn, score, time}]',
    
    INDEX idx_user (user_id),
    INDEX idx_status (monitor_status),
    INDEX idx_risk (current_risk_level),
    INDEX idx_session (session_id),
    INDEX idx_last_alert (last_alert_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI会话质量监控记录';
```

#### 3.1.2 单轮质量评估快照 (ai_turn_quality_log)

```sql
CREATE TABLE ai_turn_quality_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    session_id      VARCHAR(64) NOT NULL COMMENT '会话ID',
    turn_id         VARCHAR(64) NOT NULL COMMENT '轮次ID',
    user_id         BIGINT NOT NULL,
    turn_index      INT NOT NULL COMMENT '第几轮对话',
    
    -- 评估结果
    quality_score       DECIMAL(4,2) NOT NULL COMMENT '本轮质量评分 0-100',
    risk_level          VARCHAR(20) NOT NULL COMMENT '风险等级',
    confidence_score    DECIMAL(4,2) COMMENT 'AI置信度',
    
    -- 检测维度
    relevance_score         DECIMAL(4,2) COMMENT '相关性（回答是否切题）',
    accuracy_score          DECIMAL(4,2) COMMENT '准确性（知识是否正确）',
    age_appropriateness     DECIMAL(4,2) COMMENT '适龄性（表达是否适合年级）',
    safety_score            DECIMAL(4,2) COMMENT '安全性（是否有不适宜内容）',
    pedagogy_score          DECIMAL(4,2) COMMENT '教学性（是否遵循启发式引导）',
    
    -- 风险标签
    risk_tags          JSON COMMENT '具体风险标签',
    detected_issues    JSON COMMENT '检测到的问题列表 [{type, detail, severity}]',
    
    -- 用户反馈（异步回填）
    user_feedback      VARCHAR(20) COMMENT '用户反馈: like/dislike/none',
    user_reported      BOOLEAN DEFAULT FALSE COMMENT '用户是否举报了此轮回答',
    
    -- 评估方式
    eval_method        VARCHAR(20) COMMENT '评估方式: rule/model/hybrid',
    eval_latency_ms    INT COMMENT '评估耗时(毫秒)',
    
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_session_turn (session_id, turn_index),
    INDEX idx_risk (risk_level),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI单轮对话质量评估日志';
```

#### 3.1.3 人工接管记录 (human_takeover_record)

```sql
CREATE TABLE human_takeover_record (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    session_id          VARCHAR(64) NOT NULL COMMENT '原始AI会话ID',
    user_id             BIGINT NOT NULL,
    
    -- 接管触发
    trigger_type        VARCHAR(30) NOT NULL COMMENT '触发类型: auto_alert/manual/ai_request/user_request',
    trigger_reason      TEXT COMMENT '触发原因描述',
    trigger_risk_level  VARCHAR(20) COMMENT '触发时的风险等级',
    trigger_turn_index  INT COMMENT '触发时的对话轮次',
    
    -- 接管人信息
    operator_id         BIGINT NOT NULL COMMENT '接管人(运营/教研)ID',
    operator_name       VARCHAR(100) NOT NULL,
    operator_role       VARCHAR(20) NOT NULL COMMENT '角色: tutor/reviewer/admin',
    
    -- 接管时间线
    alert_at            DATETIME COMMENT '预警发出时间',
    accepted_at         DATETIME COMMENT '运营人员接单时间',
    takeover_at         DATETIME COMMENT '正式接管时间(开始发消息)',
    completed_at        DATETIME COMMENT '接管结束时间',
    
    -- 接管状态
    status              VARCHAR(20) DEFAULT 'pending' COMMENT 'pending/accepted/active/completed/rejected/timeout',
    resolution          VARCHAR(20) COMMENT 'resolved/escalated/no_action_needed',
    resolution_note     TEXT COMMENT '处理备注',
    
    -- 接管期间交互
    takeover_message_count    INT DEFAULT 0 COMMENT '接管期间消息数',
    user_satisfaction_signal  VARCHAR(20) COMMENT '用户满意度信号: positive/neutral/negative',
    
    -- AI与人工对照
    ai_quality_score_before   DECIMAL(4,2) COMMENT '接管前AI质量评分',
    
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_session (session_id),
    INDEX idx_operator (operator_id),
    INDEX idx_status (status),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='人工接管记录';
```

#### 3.1.4 预警工单 (quality_alert_ticket)

```sql
CREATE TABLE quality_alert_ticket (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    session_id      VARCHAR(64) NOT NULL,
    user_id         BIGINT NOT NULL,
    
    -- 预警信息
    alert_type      VARCHAR(50) NOT NULL COMMENT '预警类型: low_accuracy/safety_violation/user_distress/persistent_confusion/ai_loop/off_topic',
    alert_level     VARCHAR(20) NOT NULL COMMENT '预警级别: low/medium/high/critical',
    alert_title     VARCHAR(200) NOT NULL,
    alert_detail    TEXT NOT NULL COMMENT '预警详情',
    
    -- 关联数据
    turn_index      INT COMMENT '触发轮次',
    ai_response_snippet TEXT COMMENT 'AI回复摘要(前200字)',
    risk_tags       JSON COMMENT '风险标签',
    
    -- 分发与处理
    assigned_to     BIGINT COMMENT '分配处理人ID',
    status          VARCHAR(20) DEFAULT 'open' COMMENT 'open/assigned/resolved/ignored',
    priority        INT DEFAULT 0 COMMENT '优先级分数(用于排序)',
    
    -- SLA
    sla_deadline    DATETIME COMMENT 'SLA截止时间',
    resolved_at     DATETIME,
    resolution      VARCHAR(20) COMMENT 'takeover/ai_adjusted/user_notified/false_positive',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_status_level (status, alert_level),
    INDEX idx_assigned (assigned_to),
    INDEX idx_session (session_id),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='质量预警工单';
```

### 3.2 Redis 数据结构

```
# 会话实时质量状态（Hash）
key: quality:session:{sessionId}
fields:
  score         -> 当前质量评分
  risk_level    -> 当前风险等级
  turn_count    -> 总轮次
  issue_count   -> 问题计数
  taken_over    -> 0/1
  monitor_on    -> 0/1
  last_turn_id  -> 最近轮次ID
  last_eval_at  -> 最近评估时间戳
TTL: 会话结束后保留 1 小时

# 接管会话映射（String）
key: takeover:session:{sessionId}
value: {takeoverId}
TTL: 接管结束后 30 分钟

# 运营人员在线状态（Sorted Set）
key: operators:online
score: 最后心跳时间戳
member: {operatorId}

# 待处理预警队列（Sorted Set，按优先级排序）
key: alerts:pending
score: 优先级分数
member: {ticketId}

# 运营人员当前接管数（用于负载均衡）
key: operator:load:{operatorId}
value: 当前接管会话数
TTL: 5 分钟

# 用户实时负面信号计数器
key: negative:session:{sessionId}
value: 连续负面信号次数
TTL: 10 分钟（窗口期内重置）
```

---

## 4. 实时质量评估引擎

### 4.1 评估流程

```
AI回复生成完成
      │
      ▼
┌─────────────────────────────────┐
│  Step 1: 快速规则检查 (≤50ms)    │
│  • 长度异常（过短/过长）          │
│  • 重复内容检测                   │
│  • 安全关键词命中                 │
│  • 格式异常（无分步/无结构）       │
│  • 与问题无关检测（关键词匹配）     │
└──────────────┬──────────────────┘
               │
      ┌────────┴────────┐
      │ 规则触发高风险?  │
      └────────┬────────┘
         Yes   │   No
      ┌────────┴────────┐
      ▼                 ▼
┌──────────────┐  ┌─────────────────────────────────┐
│ 立即预警      │  │  Step 2: 轻量模型评估 (≤500ms)   │
│ (跳过Step2-3)│  │  • 相关性打分                     │
└──────────────┘  │  • 适龄性检查                     │
                  │  • 教学规范性检查                  │
                  │  • 情绪/语气检测                   │
                  └──────────────┬──────────────────┘
                                 │
                        ┌────────┴────────┐
                        │ 模型评分 < 阈值?│
                        └────────┬────────┘
                           Yes   │   No
                        ┌────────┴────────┐
                        ▼                 ▼
                ┌──────────────┐  ┌─────────────────────────────────┐
                │ 标记风险      │  │  Step 3: 上下文模式检测 (≤200ms)  │
                │ 进入预警流程  │  │  • 多轮困惑模式                   │
                └──────────────┘  │  • 循环提问模式                   │
                                  │  • 用户情绪恶化趋势               │
                                  │  • 对话偏题检测                   │
                                  │  • AI回答质量下滑趋势              │
                                  └──────────────┬──────────────────┘
                                                 │
                                        ┌────────┴────────┐
                                        │ 累计风险触发?   │
                                        └────────┬────────┘
                                           Yes   │   No
                                           ▼      ▼
                                      预警流程   更新评分
```

### 4.2 风险检测规则详解

#### 4.2.1 规则层 — 即时风险检测

```java
/**
 * 即时风险检测规则集
 * 响应时间要求: ≤ 50ms
 */
public class InstantRiskRules {

    // 规则1: AI回复长度异常
    public static RiskResult checkLengthAbnormality(String aiResponse, String userQuestion) {
        int respLen = aiResponse.length();
        int qLen = userQuestion.length();
        
        // 回复过短（可能AI未能生成有效内容）
        if (respLen < 20 && qLen.length() > 10) {
            return RiskResult.of("TOO_SHORT", RiskLevel.MEDIUM, 
                "AI回复过短，可能未能生成有效内容");
        }
        
        // 回复过长（可能信息过载或跑题）
        if (respLen > 5000) {
            return RiskResult.of("TOO_LONG", RiskLevel.LOW,
                "AI回复过长，可能信息过载");
        }
        
        return RiskResult.safe();
    }

    // 规则2: 安全关键词命中
    public static RiskResult checkSafetyKeywords(String aiResponse) {
        List<String> highRiskKeywords = List.of(
            "自杀", "自残", "暴力", "色情", "赌博", "毒品",
            "考试答案全文", "直接抄写"
        );
        
        for (String keyword : highRiskKeywords) {
            if (aiResponse.contains(keyword)) {
                return RiskResult.of("SAFETY_VIOLATION", RiskLevel.CRITICAL,
                    "AI回复包含高风险关键词: " + keyword);
            }
        }
        return RiskResult.safe();
    }

    // 规则3: 重复内容检测（与上一轮AI回复对比）
    public static RiskResult checkRepetition(String currentResponse, String previousResponse) {
        if (previousResponse == null) return RiskResult.safe();
        
        double similarity = TextSimilarity.cosine(currentResponse, previousResponse);
        if (similarity > 0.85) {
            return RiskResult.of("REPETITION", RiskLevel.HIGH,
                String.format("与上轮回复相似度 %.0f%%，疑似循环重复", similarity * 100));
        }
        return RiskResult.safe();
    }

    // 规则4: 无结构化内容（缺乏分步、分段）
    public static RiskResult checkStructure(String aiResponse, String questionType) {
        // 理科解题类问题应有分步结构
        if ("problem_solving".equals(questionType)) {
            boolean hasSteps = aiResponse.contains("步骤") || 
                aiResponse.contains("解:") || aiResponse.contains("第一步") ||
                Pattern.compile("\\d[\\.、)]").matcher(aiResponse).find();
            
            if (!hasSteps && aiResponse.length() > 200) {
                return RiskResult.of("NO_STRUCTURE", RiskLevel.MEDIUM,
                    "解题类回复缺少分步结构");
            }
        }
        return RiskResult.safe();
    }

    // 规则5: 问题-回答相关性（快速关键词匹配）
    public static RiskResult checkRelevanceQuick(String question, String response) {
        Set<String> questionKeywords = TextExtract.extractKeywords(question);
        Set<String> responseKeywords = TextExtract.extractKeywords(response);
        
        Set<String> intersection = new HashSet<>(questionKeywords);
        intersection.retainAll(responseKeywords);
        
        if (questionKeywords.size() > 0) {
            double overlapRatio = (double) intersection.size() / questionKeywords.size();
            if (overlapRatio < 0.1) {
                return RiskResult.of("IRRELEVANT", RiskLevel.HIGH,
                    String.format("关键词重叠率仅 %.0f%%，回答可能偏题", overlapRatio * 100));
            }
        }
        return RiskResult.safe();
    }
}
```

#### 4.2.2 模型层 — 轻量质量评估

```python
"""
轻量质量评估模型 — 基于 fine-tuned 小模型（如 BERT-tiny / DistilBERT）
延迟预算: ≤ 500ms
"""

class LightweightQualityAssessor:
    """
    使用轻量模型进行多维质量评估
    输入: (user_question, ai_response, context)
    输出: QualityDimension
    """
    
    def __init__(self):
        # 维度评估模型（可共享 backbone，不同 head）
        self.relevance_model = self._load_model("relevance_bert_tiny")
        self.appropriateness_model = self._load_model("age_appropriate_bert_tiny")
        self.pedagogy_model = self._load_model("pedagogy_bert_tiny")
        self.emotion_model = self._load_model("emotion_distilbert")
        
    def assess(self, question: str, response: str, 
               user_grade: str, subject: str,
               conversation_history: list) -> QualityDimension:
        """
        多维质量评估
        
        Returns:
            QualityDimension: 包含各维度分数和综合风险判断
        """
        # 1. 相关性评估
        relevance_score = self.relevance_model.predict({
            "question": question,
            "response": response
        })
        
        # 2. 适龄性评估
        appropriateness_score = self.appropriateness_model.predict({
            "response": response,
            "target_grade": user_grade
        })
        
        # 3. 教学规范性（是否遵循启发式引导、分步讲解）
        pedagogy_score = self.pedagogy_model.predict({
            "question": question,
            "response": response,
            "subject": subject
        })
        
        # 4. 情绪检测（检测AI回复中是否含不当语气）
        emotion = self.emotion_model.predict({
            "text": response
        })
        safety_score = self._emotion_to_safety(emotion)
        
        # 综合评分
        overall_score = (
            relevance_score * 0.30 +
            appropriateness_score * 0.20 +
            pedagogy_score * 0.25 +
            safety_score * 0.25
        )
        
        return QualityDimension(
            relevance=relevance_score,
            accuracy=None,  # 准确性需要知识库校验，在异步流程中完成
            age_appropriateness=appropriateness_score,
            safety=safety_score,
            pedagogy=pedagogy_score,
            overall=overall_score
        )
    
    def _emotion_to_safety(self, emotion: dict) -> float:
        """将情绪检测结果转为安全分数"""
        if emotion.get("label") in ["angry", "sarcastic", "condescending"]:
            return 40.0
        if emotion.get("label") in ["neutral", "encouraging", "friendly"]:
            return 90.0
        return 70.0
```

#### 4.2.3 上下文模式检测 — 累计风险识别

```java
/**
 * 上下文模式检测器
 * 基于多轮对话历史，检测累积型风险模式
 */
public class ContextualPatternDetector {

    /**
     * 检测"持续困惑"模式
     * 触发条件: 连续 ≥3 轮用户表达不理解/追问相同问题
     */
    public RiskResult detectPersistentConfusion(SessionContext ctx) {
        int consecutiveConfusion = 0;
        String lastQuestionTopic = null;
        
        for (int i = ctx.getTurns().size() - 1; i >= 0; i--) {
            Turn turn = ctx.getTurns().get(i);
            
            // 检测用户是否表达困惑信号
            boolean isConfused = containsConfusionSignal(turn.getUserMessage());
            // 检测是否在同一主题上追问
            boolean sameTopic = extractTopic(turn.getUserMessage())
                .equals(lastQuestionTopic) || lastQuestionTopic == null;
            
            if (isConfused && sameTopic) {
                consecutiveConfusion++;
                lastQuestionTopic = extractTopic(turn.getUserMessage());
            } else {
                break;
            }
        }
        
        if (consecutiveConfusion >= 3) {
            return RiskResult.builder()
                .type("PERSISTENT_CONFUSION")
                .level(RiskLevel.HIGH)
                .detail(String.format("用户连续 %d 轮表达困惑，AI可能未能有效讲解", 
                    consecutiveConfusion))
                .suggestTakeover(true)
                .build();
        }
        return RiskResult.safe();
    }

    /**
     * 检测"AI循环"模式
     * 触发条件: AI 在 ≥2 轮中给出高度相似的内容
     */
    public RiskResult detectAILoop(SessionContext ctx) {
        if (ctx.getTurns().size() < 3) return RiskResult.safe();
        
        List<Turn> recentTurns = ctx.getRecentTurns(3);
        double sim1 = TextSimilarity.jaccard(
            recentTurns.get(0).getAiResponse(),
            recentTurns.get(2).getAiResponse()
        );
        double sim2 = TextSimilarity.jaccard(
            recentTurns.get(1).getAiResponse(),
            recentTurns.get(2).getAiResponse()
        );
        
        if (sim1 > 0.7 || sim2 > 0.7) {
            return RiskResult.builder()
                .type("AI_LOOP")
                .level(RiskLevel.HIGH)
                .detail("AI进入循环回复模式，持续输出相似内容")
                .suggestTakeover(true)
                .build();
        }
        return RiskResult.safe();
    }

    /**
     * 检测"用户情绪恶化"模式
     * 触发条件: 用户消息情绪从正面/中性转为负面，且持续
     */
    public RiskResult detectUserDistress(SessionContext ctx) {
        if (ctx.getTurns().size() < 2) return RiskResult.safe();
        
        List<Turn> recent = ctx.getRecentTurns(3);
        
        // 分析最近几轮用户情绪
        List<EmotionResult> emotions = recent.stream()
            .map(t -> emotionAnalyzer.analyze(t.getUserMessage()))
            .collect(Collectors.toList());
        
        // 检测情绪恶化趋势
        boolean trendingNegative = false;
        int negativeCount = 0;
        for (int i = 1; i < emotions.size(); i++) {
            if (emotions.get(i).getValence() < emotions.get(i-1).getValence()) {
                trendingNegative = true;
            }
            if (emotions.get(i).getValence() < -0.3) {
                negativeCount++;
            }
        }
        
        if (trendingNegative && negativeCount >= 2) {
            return RiskResult.builder()
                .type("USER_DISTRESS")
                .level(RiskLevel.HIGH)
                .detail("用户情绪持续恶化，可能感到沮丧或愤怒")
                .suggestTakeover(true)
                .build();
        }
        return RiskResult.safe();
    }

    /**
     * 检测"偏离学习目标"模式
     * 触发条件: 对话主题与初始学习目标偏离超过阈值
     */
    public RiskResult detectOffTopic(SessionContext ctx) {
        if (ctx.getTurns().size() < 4) return RiskResult.safe();
        
        String initialTopic = ctx.getInitialLearningTopic();
        String currentTopic = ctx.getCurrentTopic();
        
        if (initialTopic != null && currentTopic != null) {
            double topicDrift = TopicSimilarity.calculate(initialTopic, currentTopic);
            if (topicDrift < 0.3) {
                return RiskResult.builder()
                    .type("OFF_TOPIC")
                    .level(RiskLevel.LOW)
                    .detail(String.format("对话从'%s'偏移到'%s'", 
                        initialTopic, currentTopic))
                    .suggestTakeover(false)
                    .build();
            }
        }
        return RiskResult.safe();
    }

    // 困惑信号关键词
    private static final List<String> CONFUSION_SIGNALS = List.of(
        "听不懂", "不理解", "没看明白", "还是不会", "能不能再讲讲",
        "太复杂了", "简单点", "说人话", "什么意思", "为什么是这样",
        "???", "？？？", "懵了", "晕", "搞不清楚", " confused"
    );
    
    private boolean containsConfusionSignal(String message) {
        String lower = message.toLowerCase();
        return CONFUSION_SIGNALS.stream().anyMatch(lower::contains);
    }
}
```

### 4.3 质量评分模型

```java
/**
 * 综合质量评分计算
 * 融合规则检测结果、模型评估结果和上下文模式
 */
public class QualityScoreCalculator {

    /**
     * 计算会话级别的综合质量评分
     * 
     * @param turnQuality 当前轮次质量评估
     * @param sessionContext 会话上下文
     * @param historyStats 历史统计
     * @return 综合质量评分和风险等级
     */
    public QualityAssessment calculateSessionQuality(
            TurnQualityResult turnQuality,
            SessionContext sessionContext,
            SessionHistoryStats historyStats) {
        
        // 1. 基础分 = 当前轮次模型评分
        double baseScore = turnQuality.getOverallScore();
        
        // 2. 衰减因子：连续问题扣分
        double decayFactor = 1.0;
        int consecutiveIssues = historyStats.getConsecutiveIssueTurns();
        if (consecutiveIssues > 0) {
            decayFactor = Math.max(0.5, 1.0 - consecutiveIssues * 0.15);
        }
        
        // 3. 风险调整：检测到的风险标签调整分数
        double riskPenalty = 0;
        RiskLevel maxRisk = RiskLevel.SAFE;
        
        for (RiskResult risk : turnQuality.getDetectedRisks()) {
            switch (risk.getLevel()) {
                case CRITICAL:
                    riskPenalty += 40;
                    break;
                case HIGH:
                    riskPenalty += 20;
                    break;
                case MEDIUM:
                    riskPenalty += 10;
                    break;
                case LOW:
                    riskPenalty += 3;
                    break;
            }
            if (risk.getLevel().ordinal() > maxRisk.ordinal()) {
                maxRisk = risk.getLevel();
            }
        }
        
        // 4. 用户反馈调整
        double feedbackAdjustment = 0;
        if (historyStats.getRecentDislikes() > 0) {
            feedbackAdjustment -= historyStats.getRecentDislikes() * 5;
        }
        
        // 5. 最终评分
        double finalScore = Math.max(0, Math.min(100, 
            baseScore * decayFactor - riskPenalty + feedbackAdjustment
        ));
        
        // 6. 确定风险等级
        RiskLevel finalRisk = determineRiskLevel(finalScore, maxRisk, 
            turnQuality.getDetectedRisks());
        
        return QualityAssessment.builder()
            .qualityScore(BigDecimal.valueOf(finalScore).setScale(2, RoundingMode.HALF_UP))
            .riskLevel(finalRisk)
            .baseScore(baseScore)
            .decayFactor(decayFactor)
            .riskPenalty(riskPenalty)
            .feedbackAdjustment(feedbackAdjustment)
            .detectedRisks(turnQuality.getDetectedRisks())
            .suggestTakeover(finalRisk == RiskLevel.HIGH || finalRisk == RiskLevel.CRITICAL)
            .build();
    }
    
    private RiskLevel determineRiskLevel(double score, RiskLevel maxRuleRisk, 
            List<RiskResult> risks) {
        // 任何 CRITICAL 规则直接升级
        if (maxRuleRisk == RiskLevel.CRITICAL) return RiskLevel.CRITICAL;
        
        // 是否有建议接管的上下文模式
        boolean suggestTakeover = risks.stream()
            .anyMatch(RiskResult::isSuggestTakeover);
        if (suggestTakeover && score < 50) return RiskLevel.HIGH;
        
        // 按分数分级
        if (score >= 75) return RiskLevel.SAFE;
        if (score >= 55) return RiskLevel.LOW;
        if (score >= 35) return RiskLevel.MEDIUM;
        return RiskLevel.HIGH;
    }
}
```

---

## 5. 风险预警与分级响应

### 5.1 风险等级定义

| 等级 | 分数范围 | 含义 | 系统行为 |
| --- | --- | --- | --- |
| SAFE | 75-100 | AI辅导正常 | 继续监控，记录评分 |
| LOW | 55-74 | 轻微质量波动 | 记录风险标签，加强监控频率 |
| MEDIUM | 35-54 | 存在质量问题 | 生成预警工单，推送到监控台 |
| HIGH | 0-34 | 严重质量问题 | **强制预警弹窗** + 建议接管 + 向用户展示"需要换一种方式吗？" |
| CRITICAL | - | 安全违规/严重幻觉 | **立即中断AI输出** + 强制接管流程 + 记录审查 |

### 5.2 预警类型定义

```java
public enum AlertType {
    
    // ── 内容质量类 ──
    LOW_ACCURACY("AI回答准确性不足", RiskLevel.MEDIUM, 
        "AI回复可能存在知识错误，建议人工复核"),
    AI_HALLUCINATION("疑似AI幻觉", RiskLevel.HIGH,
        "AI回复可能包含编造的信息，需立即核查"),
    NO_PROGRESS("学习无进展", RiskLevel.MEDIUM,
        "多轮对话后用户仍未掌握目标知识点"),
    
    // ── 安全合规类 ──
    SAFETY_VIOLATION("内容安全违规", RiskLevel.CRITICAL,
        "AI回复包含不适宜未成年人接触的内容"),
    ANSWER_LEAKAGE("直接泄露答案", RiskLevel.HIGH,
        "AI在应使用渐进提示的场景直接给出了完整答案"),
    INAPPROPRIATE_TONE("不当语气/态度", RiskLevel.HIGH,
        "AI回复语气不当（嘲讽、不耐烦、过于冷漠等）"),
    
    // ── 用户体验类 ──
    PERSISTENT_CONFUSION("用户持续困惑", RiskLevel.HIGH,
        "用户连续多轮表达不理解，AI未能有效讲解"),
    USER_DISTRESS("用户情绪恶化", RiskLevel.HIGH,
        "检测到用户情绪持续负面，可能感到沮丧"),
    AI_LOOP("AI循环回复", RiskLevel.HIGH,
        "AI在不同轮次给出几乎相同的回复，陷入循环"),
    
    // ── 偏离类 ──
    OFF_TOPIC("对话偏离学习目标", RiskLevel.LOW,
        "对话主题已偏离原始学习目标"),
    NON_LEARNING("非学习类对话", RiskLevel.MEDIUM,
        "检测到对话内容与学习无关，可能是闲聊或滥用");
    
    private final String title;
    private final RiskLevel defaultLevel;
    private final String description;
    
    // constructor, getters...
}
```

### 5.3 分级响应策略

```java
/**
 * 分级响应策略编排
 */
public class AlertResponseStrategy {

    /**
     * 根据风险等级和预警类型选择响应策略
     */
    public AlertResponse compose(RiskLevel level, AlertType type, 
            SessionContext ctx) {
        
        switch (level) {
            case CRITICAL:
                return handleCritical(type, ctx);
            case HIGH:
                return handleHigh(type, ctx);
            case MEDIUM:
                return handleMedium(type, ctx);
            case LOW:
                return handleLow(type, ctx);
            default:
                return AlertResponse.noAction();
        }
    }
    
    // CRITICAL: 立即中断 + 强制接管 + 安全记录
    private AlertResponse handleCritical(AlertType type, SessionContext ctx) {
        return AlertResponse.builder()
            // 1. 立即中断当前AI输出流
            .interruptCurrentStream(true)
            // 2. 向客户端推送安全提示
            .clientNotification(ClientNotification.builder()
                .type("safety_notice")
                .message("为了给您更好的学习体验，正在为您切换至专属辅导老师...")
                .showImmediately(true)
                .build())
            // 3. 创建高优先级接管工单
            .createTakeoverTicket(true)
            .takeoverPriority(100) // 最高优先级
            .slaSeconds(30) // 30秒内必须接管
            // 4. 记录安全事件
            .logSecurityEvent(true)
            // 5. 通知运营主管
            .notifySupervisor(true)
            .build();
    }
    
    // HIGH: 强制预警 + 建议接管
    private AlertResponse handleHigh(AlertType type, SessionContext ctx) {
        return AlertResponse.builder()
            // 不中断AI输出（让用户看到已有内容）
            .interruptCurrentStream(false)
            // 创建预警工单
            .createAlertTicket(true)
            .ticketLevel("high")
            .slaSeconds(120) // 2分钟SLA
            // 向监控台推送高优先级预警
            .pushToDashboard(true)
            .dashboardPriority(80)
            // 向用户展示温和的替代选项
            .clientNotification(ClientNotification.builder()
                .type("learning_suggestion")
                .message("如果觉得还不够清楚，可以试试让辅导老师为你讲解哦~")
                .actionButton("转人工辅导")
                .showAfterDelay(true)
                .delaySeconds(3)
                .build())
            // 标记会话为高风险
            .updateSessionRisk(RiskLevel.HIGH)
            .build();
    }
    
    // MEDIUM: 记录预警 + 监控台展示
    private AlertResponse handleMedium(AlertType type, SessionContext ctx) {
        return AlertResponse.builder()
            .createAlertTicket(true)
            .ticketLevel("medium")
            .slaSeconds(300) // 5分钟SLA
            .pushToDashboard(true)
            .dashboardPriority(50)
            // 不打扰用户，但后台关注
            .clientNotification(null)
            // 增加监控频率
            .increaseMonitorFrequency(true)
            .build();
    }
    
    // LOW: 仅记录
    private AlertResponse handleLow(AlertType type, SessionContext ctx) {
        return AlertResponse.builder()
            .createAlertTicket(false)
            .logRiskTag(true) // 仅记录风险标签
            .build();
    }
}
```

---

## 6. 人工接管服务

### 6.1 接管流程状态机

```
                    ┌──────────────────────────────────────────────────────┐
                    │                                                      │
  预警触发 ──────► │ PENDING                                              │
                    │ (等待运营人员接单)                                    │
                    └──────┬──────────────────┬──────────────────┬────────┘
                           │                  │                  │
                    运营接单│           超时(>SLA)│         运营拒绝│
                           ▼                  ▼                  ▼
                    ┌─────────────┐  ┌──────────────┐   ┌─────────────┐
                    │ ACCEPTED    │  │ TIMEOUT      │   │ REJECTED    │
                    │ (已接单,     │  │ (升级到主管   │   │ (误报/不需   │
                    │  准备接管)   │  │  或AI降级处理)│   │  要处理)    │
                    └──────┬──────┘  └──────────────┘   └─────────────┘
                           │
                    运营发送第一条消息
                           ▼
                    ┌──────────────────────────────────────────┐
                    │ ACTIVE                                    │
                    │ (人工接管中)                               │
                    │ • 客户端消息来源切换为"辅导老师"            │
                    │ • AI输出暂停                              │
                    │ • 运营人员看到完整对话历史 + 用户画像       │
                    │ • 支持引用AI已有回答                       │
                    └──────┬──────────────────┬────────────────┘
                           │                  │
                    用户离开│           运营结束│
                    或超时  │                  │
                           ▼                  ▼
                    ┌─────────────┐    ┌─────────────────────┐
                    │ COMPLETED   │    │ COMPLETED           │
                    │ (resolved)  │    │ (resolved/escalated)│
                    │             │    │                     │
                    │ 评估接管效果 │    │ 恢复AI或升级处理     │
                    └─────────────┘    └─────────────────────┘
```

### 6.2 接管服务核心代码

```java
/**
 * 人工接管服务
 */
@Service
public class HumanTakeoverService {

    @Autowired private SessionContextBroker contextBroker;
    @Autowired private AlertDispatcher alertDispatcher;
    @Autowired private TakeoverMapper takeoverMapper;
    @Autowired private RedisTemplate<String, String> redisTemplate;
    @Autowired private SimpMessagingTemplate messagingTemplate; // WebSocket
    
    /**
     * 发起接管请求
     */
    @Transactional
    public TakeoverResult initiateTakeover(String sessionId, AlertType alertType,
            RiskLevel riskLevel, String triggerReason) {
        
        // 1. 检查是否已被接管
        if (isAlreadyTakenOver(sessionId)) {
            return TakeoverResult.alreadyTakenOver();
        }
        
        // 2. 获取会话上下文
        SessionContext ctx = contextBroker.getSessionContext(sessionId);
        if (ctx == null) {
            return TakeoverResult.failed("会话不存在");
        }
        
        // 3. 创建接管记录
        HumanTakeoverRecord record = HumanTakeoverRecord.builder()
            .sessionId(sessionId)
            .userId(ctx.getUserId())
            .triggerType(alertType.name())
            .triggerReason(triggerReason)
            .triggerRiskLevel(riskLevel.name())
            .triggerTurnIndex(ctx.getCurrentTurnIndex())
            .status(TakeoverStatus.PENDING)
            .alertAt(LocalDateTime.now())
            .aiQualityScoreBefore(ctx.getCurrentQualityScore())
            .build();
        takeoverMapper.insert(record);
        
        // 4. 选择运营人员（负载均衡 + 学科匹配）
        Long operatorId = selectBestOperator(ctx);
        if (operatorId != null) {
            // 直接分配
            assignTakeover(record.getId(), operatorId);
        } else {
            // 广播预警，等待接单
            broadcastTakeoverAlert(record, ctx);
        }
        
        // 5. 暂停AI自动回复（根据风险等级决定）
        if (riskLevel == RiskLevel.CRITICAL || riskLevel == RiskLevel.HIGH) {
            contextBroker.setAiPaused(sessionId, true);
        }
        
        // 6. 通知客户端
        notifyClientTakeoverStarting(ctx.getUserId(), sessionId);
        
        return TakeoverResult.success(record.getId());
    }
    
    /**
     * 选择最佳运营人员
     * 考虑因素: 在线状态、当前负载、学科专长、响应速度
     */
    private Long selectBestOperator(SessionContext ctx) {
        // 获取在线运营人员
        Set<TypedTuple<String>> onlineOps = redisTemplate.opsForZSet()
            .rangeWithScores("operators:online", 0, -1);
        
        if (onlineOps == null || onlineOps.isEmpty()) return null;
        
        long now = System.currentTimeMillis();
        List<OperatorCandidate> candidates = new ArrayList<>();
        
        for (TypedTuple<String> op : onlineOps) {
            Long opId = Long.parseLong(op.getValue());
            
            // 检查心跳是否在5分钟内
            if (now - op.getScore().longValue() > 5 * 60 * 1000) continue;
            
            // 获取当前负载
            Integer currentLoad = getOperatorLoad(opId);
            if (currentLoad >= MAX_CONCURRENT_TAKEOVERS) continue; // 超过最大并发
            
            // 获取学科匹配度
            int subjectMatch = getSubjectMatchScore(opId, ctx.getSubject());
            
            // 获取历史评价
            double avgRating = getOperatorAvgRating(opId);
            
            candidates.add(new OperatorCandidate(opId, currentLoad, 
                subjectMatch, avgRating));
        }
        
        if (candidates.isEmpty()) return null;
        
        // 综合评分排序
        return candidates.stream()
            .max(Comparator.comparingDouble(
                c -> (10 - c.getLoad()) * 0.3 
                   + c.getSubjectMatch() * 0.4 
                   + c.getAvgRating() * 0.3))
            .map(OperatorCandidate::getOperatorId)
            .orElse(null);
    }
    
    /**
     * 运营人员接单
     */
    @Transactional
    public TakeoverResult acceptTakeover(Long takeoverId, Long operatorId) {
        
        HumanTakeoverRecord record = takeoverMapper.selectById(takeoverId);
        if (record == null || record.getStatus() != TakeoverStatus.PENDING) {
            return TakeoverResult.failed("接管记录不存在或已被处理");
        }
        
        // 原子性更新状态（防止多人同时接单）
        int updated = takeoverMapper.updateStatusIfPending(
            takeoverId, TakeoverStatus.ACCEPTED, operatorId);
        if (updated == 0) {
            return TakeoverResult.failed("已被其他人接单");
        }
        
        // 获取完整会话上下文
        SessionContext ctx = contextBroker.getSessionContext(record.getSessionId());
        
        // 发送上下文给运营人员的工作台
        sendContextToOperator(operatorId, ctx, record);
        
        // 更新Redis映射
        redisTemplate.opsForValue().set(
            "takeover:session:" + record.getSessionId(),
            String.valueOf(takeoverId),
            30, TimeUnit.MINUTES);
        
        // 更新运营人员负载
        incrementOperatorLoad(operatorId);
        
        return TakeoverResult.success(takeoverId);
    }
    
    /**
     * 运营人员发送消息（通过WebSocket中转到客户端）
     */
    @Transactional
    public void sendTakeoverMessage(Long takeoverId, String message, 
            MessageType type) {
        
        HumanTakeoverRecord record = takeoverMapper.selectById(takeoverId);
        if (record.getStatus() != TakeoverStatus.ACTIVE && 
            record.getStatus() != TakeoverStatus.ACCEPTED) {
            throw new BusinessException("INVALID_TAKEOVER_STATE", 
                "接管会话状态不允许发送消息");
        }
        
        // 如果是第一条消息，更新状态为ACTIVE
        if (record.getStatus() == TakeoverStatus.ACCEPTED) {
            record.setStatus(TakeoverStatus.ACTIVE);
            record.setTakeoverAt(LocalDateTime.now());
            takeoverMapper.updateById(record);
            
            // 通知客户端：已切换为人工辅导
            notifyClientTakeoverActive(record.getUserId(), 
                record.getSessionId(), record.getOperatorName());
        }
        
        // 通过WebSocket将消息推送给客户端
        messagingTemplate.convertAndSendToUser(
            String.valueOf(record.getUserId()),
            "/queue/takeover/" + record.getSessionId(),
            TakeoverMessage.builder()
                .content(message)
                .type(type)
                .operatorName(record.getOperatorName())
                .timestamp(LocalDateTime.now())
                .build()
        );
        
        // 更新消息计数
        takeoverMapper.incrementMessageCount(takeoverId);
    }
    
    /**
     * 结束接管，恢复AI或关闭会话
     */
    @Transactional
    public void completeTakeover(Long takeoverId, String resolution, 
            String note) {
        
        HumanTakeoverRecord record = takeoverMapper.selectById(takeoverId);
        
        record.setStatus(TakeoverStatus.COMPLETED);
        record.setCompletedAt(LocalDateTime.now());
        record.setResolution(resolution);
        record.setResolutionNote(note);
        takeoverMapper.updateById(record);
        
        // 恢复AI回复
        if ("resolved".equals(resolution)) {
            contextBroker.setAiPaused(record.getSessionId(), false);
        }
        
        // 清理Redis
        redisTemplate.delete("takeover:session:" + record.getSessionId());
        decrementOperatorLoad(record.getOperatorId());
        
        // 通知客户端
        notifyClientTakeoverCompleted(record.getUserId(), 
            record.getSessionId(), resolution);
    }
}
```

### 6.3 会话上下文代理

```java
/**
 * 会话上下文代理
 * 在AI模式和人工模式之间管理对话状态的无缝切换
 */
@Service
public class SessionContextBroker {

    /**
     * 构建运营人员视角的完整会话上下文包
     */
    public OperatorContextPackage buildContextForOperator(String sessionId) {
        SessionContext ctx = getSessionContext(sessionId);
        
        return OperatorContextPackage.builder()
            // 用户基本信息
            .userProfile(UserProfileSummary.builder()
                .userId(ctx.getUserId())
                .grade(ctx.getUserGrade())
                .subject(ctx.getSubject())
                .textbookVersion(ctx.getTextbookVersion())
                .learningGoal(ctx.getLearningGoal())
                .build())
            // 完整对话历史
            .conversationHistory(ctx.getTurns().stream()
                .map(t -> ConversationTurnDto.builder()
                    .turnIndex(t.getTurnIndex())
                    .userMessage(t.getUserMessage())
                    .aiResponse(t.getAiResponse())
                    .qualityScore(t.getQualityScore())
                    .riskTags(t.getRiskTags())
                    .timestamp(t.getCreatedAt())
                    .build())
                .collect(Collectors.toList()))
            // 质量评估摘要
            .qualitySummary(QualitySummary.builder()
                .currentScore(ctx.getCurrentQualityScore())
                .riskLevel(ctx.getCurrentRiskLevel())
                .mainIssues(ctx.getTopRiskTags())
                .qualityTrend(ctx.getQualityTrend())
                .build())
            // 触发原因
            .triggerInfo(TriggerInfo.builder()
                .alertType(ctx.getLastAlertType())
                .alertReason(ctx.getLastAlertReason())
                .specificTurn(ctx.getTriggerTurnIndex())
                .build())
            // 建议处理方式
            .suggestedActions(generateSuggestedActions(ctx))
            .build();
    }
    
    /**
     * 根据上下文生成建议处理方式
     */
    private List<SuggestedAction> generateSuggestedActions(SessionContext ctx) {
        List<SuggestedAction> actions = new ArrayList<>();
        
        // 如果是持续困惑，建议换一种讲解方式
        if (ctx.hasRiskTag("PERSISTENT_CONFUSION")) {
            actions.add(SuggestedAction.builder()
                .action("RE_EXPLAIN_DIFFERENTLY")
                .title("换一种方式重新讲解")
                .description("用户对AI的讲解方式不理解，建议使用更简单的生活化例子")
                .priority(1)
                .build());
        }
        
        // 如果是AI幻觉，建议核实并纠正
        if (ctx.hasRiskTag("AI_HALLUCINATION")) {
            actions.add(SuggestedAction.builder()
                .action("CORRECT_MISTAKE")
                .title("纠正AI错误回答")
                .description("AI回复中可能存在知识性错误，请核实并给出正确解释")
                .priority(1)
                .build());
        }
        
        // 如果是安全违规，建议致歉并引导
        if (ctx.hasRiskTag("SAFETY_VIOLATION")) {
            actions.add(SuggestedAction.builder()
                .action("APOLOGIZE_AND_REDIRECT")
                .title("致歉并引导至学习内容")
                .description("AI回复包含不适宜内容，建议向用户致歉并重新引导至学习目标")
                .priority(1)
                .build());
        }
        
        // 如果是情绪恶化，建议安抚
        if (ctx.hasRiskTag("USER_DISTRESS")) {
            actions.add(SuggestedAction.builder()
                .action("COMFORT_AND_ENCOURAGE")
                .title("安抚用户情绪")
                .description("用户可能感到沮丧，建议先安抚情绪再继续学习")
                .priority(1)
                .build());
        }
        
        // 通用建议：查看相关知识点
        actions.add(SuggestedAction.builder()
            .action("SHOW_KNOWLEDGE_POINT")
            .title("查看相关知识点")
            .description("查看当前对话涉及的知识点详情和教学建议")
            .priority(2)
            .build());
        
        return actions;
    }
}
```

---

## 7. API 接口设计

### 7.1 对话质量监控 API（内部调用）

#### 7.1.1 提交单轮评估请求

```
POST /internal/v1/quality/evaluate
Content-Type: application/json
```

**Request:**
```json
{
  "sessionId": "conv_20260621_user123_a1b2c3",
  "turnId": "turn_005",
  "turnIndex": 5,
  "userId": 100123,
  "userGrade": "初二",
  "subject": "math",
  "userMessage": "为什么勾股定理里c的平方等于a的平方加b的平方？",
  "aiResponse": "勾股定理是一个非常重要的几何定理...",
  "conversationHistory": [
    {"role": "user", "content": "...", "turnIndex": 3},
    {"role": "assistant", "content": "...", "turnIndex": 3, "qualityScore": 78}
  ],
  "questionType": "concept_explanation",
  "ragReferences": ["kp_math_0451", "kp_math_0452"]
}
```

**Response:**
```json
{
  "code": 0,
  "data": {
    "qualityScore": 82.50,
    "riskLevel": "safe",
    "confidence": 88.0,
    "dimensions": {
      "relevance": 90.0,
      "accuracy": null,
      "ageAppropriateness": 85.0,
      "safety": 95.0,
      "pedagogy": 75.0
    },
    "detectedRisks": [],
    "suggestTakeover": false,
    "evalMethod": "hybrid",
    "evalLatencyMs": 412
  }
}
```

### 7.2 预警与接管 API

#### 7.2.1 获取待处理预警列表

```
GET /api/v1/takeover/alerts?status=open&level=high&limit=20
Authorization: Bearer {operator_token}
```

**Response:**
```json
{
  "code": 0,
  "data": {
    "total": 3,
    "alerts": [
      {
        "ticketId": 10086,
        "sessionId": "conv_20260621_user456_d4e5f6",
        "userId": 100456,
        "userGrade": "高一",
        "subject": "physics",
        "alertType": "PERSISTENT_CONFUSION",
        "alertLevel": "high",
        "alertTitle": "用户持续困惑",
        "alertDetail": "用户连续4轮表达不理解力学分析过程",
        "currentTurnIndex": 7,
        "qualityScore": 42.3,
        "riskTags": ["PERSISTENT_CONFUSION", "LOW_PEDAGOGY"],
        "slaDeadline": "2026-06-21T20:10:00",
        "createdAt": "2026-06-21T20:06:00"
      }
    ]
  }
}
```

#### 7.2.2 接管会话

```
POST /api/v1/takeover/{takeoverId}/accept
Authorization: Bearer {operator_token}
```

**Response:**
```json
{
  "code": 0,
  "data": {
    "takeoverId": 2001,
    "sessionId": "conv_20260621_user456_d4e5f6",
    "status": "accepted",
    "contextPackage": {
      "userProfile": {
        "grade": "高一",
        "subject": "physics",
        "textbookVersion": "人教版",
        "learningGoal": "理解牛顿第二定律"
      },
      "conversationHistory": [
        {
          "turnIndex": 1,
          "userMessage": "什么是牛顿第二定律？",
          "aiResponse": "...",
          "qualityScore": 85.0
        },
        {
          "turnIndex": 2,
          "userMessage": "还是不太理解F=ma怎么用",
          "aiResponse": "...",
          "qualityScore": 72.0
        }
        // ... 完整历史
      ],
      "qualitySummary": {
        "currentScore": 42.3,
        "riskLevel": "high",
        "mainIssues": ["PERSISTENT_CONFUSION", "LOW_PEDAGOGY"],
        "qualityTrend": [85, 72, 68, 55, 42]
      },
      "suggestedActions": [
        {
          "action": "RE_EXPLAIN_DIFFERENTLY",
          "title": "换一种方式重新讲解",
          "priority": 1
        }
      ]
    }
  }
}
```

#### 7.2.3 发送接管消息（WebSocket）

```
WS /ws/takeover/{sessionId}
```

**运营 → 服务端:**
```json
{
  "type": "takeover_message",
  "takeoverId": 2001,
  "content": "同学你好，我是辅导老师。让我用更简单的方式来解释牛顿第二定律...",
  "messageType": "text"
}
```

**服务端 → 客户端:**
```json
{
  "type": "takeover_message",
  "data": {
    "content": "同学你好，我是辅导老师。让我用更简单的方式来解释牛顿第二定律...",
    "operatorName": "王老师",
    "operatorAvatar": "https://cdn.primetop.com/avatars/op_001.png",
    "timestamp": "2026-06-21T20:08:15"
  }
}
```

#### 7.2.4 结束接管

```
POST /api/v1/takeover/{takeoverId}/complete
Authorization: Bearer {operator_token}
```

**Request:**
```json
{
  "resolution": "resolved",
  "note": "已用生活化例子重新讲解牛顿第二定律，用户表示理解",
  "restoreAi": true
}
```

#### 7.2.5 获取监控大盘数据

```
GET /api/v1/takeover/dashboard/realtime
Authorization: Bearer {operator_token}
```

**Response:**
```json
{
  "code": 0,
  "data": {
    "summary": {
      "activeSessions": 1256,
      "monitoredSessions": 1256,
      "alertedSessions": 23,
      "takenOverSessions": 5,
      "avgQualityScore": 78.5,
      "criticalAlerts": 0
    },
    "riskDistribution": {
      "safe": 1188,
      "low": 45,
      "medium": 18,
      "high": 5,
      "critical": 0
    },
    "topAlertTypes": [
      {"type": "PERSISTENT_CONFUSION", "count": 12},
      {"type": "LOW_ACCURACY", "count": 6},
      {"type": "OFF_TOPIC", "count": 3},
      {"type": "AI_LOOP", "count": 2}
    ],
    "operatorStatus": {
      "onlineCount": 8,
      "totalCapacity": 40,
      "currentTakeovers": 5,
      "avgResponseTime": 45.2
    },
    "recentAlerts": [
      // 最近10条预警...
    ]
  }
}
```

---

## 8. 运营监控台设计

### 8.1 监控台布局

```
┌──────────────────────────────────────────────────────────────────────┐
│  PrimeTop AI辅导质量监控台                          王老师 | 在线 ●    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  实时大盘                                                       │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────┐│ │
│  │  │ 活跃会话  │ │ 监控覆盖  │ │ 预警会话  │ │ 接管中   │ │ 平均 ││ │
│  │  │  1,256   │ │  1,256   │ │    23    │ │    5     │ │ 78.5 ││ │
│  │  │          │ │          │ │   ⚠️     │ │   🔄    │ │  分  ││ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────┘│ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─────────────────────────────────┐  ┌────────────────────────────┐│
│  │ 待处理预警 (按优先级排序)         │  │ 风险分布                    ││
│  │ ┌──────────────────────────────┐│  │                            ││
│  │ │🔴 HIGH | 持续困惑 | 高一物理  ││  │  🟢 Safe    1188 (94.5%)  ││
│  │ │ 用户连续4轮不理解力学分析      ││  │  🔵 Low       45 ( 3.6%)  ││
│  │ │ SLA: 1分30秒 | [立即处理]    ││  │  🟡 Medium    18 ( 1.4%)  ││
│  │ └──────────────────────────────┘│  │  🟠 High       5 ( 0.4%)  ││
│  │ ┌──────────────────────────────┐│  │  🔴 Critical   0 ( 0.0%)  ││
│  │ │🟡 MED | 准确性不足 | 初二数学 ││  │                            ││
│  │ │ AI回复中公式可能有误          ││  │  预警类型 Top5:            ││
│  │ │ SLA: 4分钟 | [处理] [忽略]   ││  │  ─────────────────         ││
│  │ └──────────────────────────────┘│  │  持续困惑    ████████ 12   ││
│  │ ┌──────────────────────────────┐│  │  准确性不足  ████     6    ││
│  │ │🟡 MED | 偏离主题 | 小学英语   ││  │  偏离主题    ██       3    ││
│  │ │ 对话已偏离至非学习内容        ││  │  AI循环      █        2    ││
│  │ │ SLA: 5分钟 | [处理] [忽略]   ││  │                            ││
│  │ └──────────────────────────────┘│  │                            ││
│  │                                 │  │                            ││
│  └─────────────────────────────────┘  └────────────────────────────┘│
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  我的接管会话                                                    │ │
│  │  ┌────────────────────────────────────────────────────────┐   │ │
│  │  │ 📋 会话 #conv_20260621_user456 | 高一物理 | 持续困惑    │   │ │
│  │  │ 用户: 张同学(化名) | 已对话7轮 | AI质量: 42.3分         │   │ │
│  │  │ ┌──────────────────────────────────────────────────┐   │   │ │
│  │  │ │ 💬 用户: 还是不理解为什么F=ma里的m要乘进去...    │   │   │ │
│  │  │ │ 🤖 AI: 根据牛顿第二定律，物体的加速度与所受...   │   │   │ │
│  │  │ │ ⚠️ 质量评分: 42分 | 持续困惑 | 教学性不足        │   │   │ │
│  │  │ └──────────────────────────────────────────────────┘   │   │ │
│  │  │ 建议: 换一种方式重新讲解                                │   │ │
│  │  │ ┌────────────────────────────────────────────────┐     │   │ │
│  │  │ │ 输入回复...                                    │ [发送]│   │ │
│  │  │ └────────────────────────────────────────────────┘     │   │ │
│  │  └────────────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### 8.2 接管工作台功能

| 功能 | 说明 |
| --- | --- |
| 预警列表 | 实时展示待处理预警，按优先级排序，显示SLA倒计时 |
| 一键接单 | 点击即可接管，系统自动分配上下文 |
| 对话历史回放 | 完整展示AI对话历史，高亮风险轮次 |
| 质量评分曲线 | 可视化展示对话质量的变化趋势 |
| 用户画像卡片 | 展示用户年级、学科、学习目标、历史质量记录 |
| 建议操作 | 系统根据预警类型自动推荐处理方式 |
| 消息编辑器 | 支持文本、公式、图片消息，可引用AI已有回答 |
| 快捷模板 | 预置常见场景的话术模板（安抚、纠错、换解法等） |
| 结束接管 | 选择处理结果（已解决/升级/无需处理），恢复AI或关闭会话 |
| 知识点参考 | 侧边栏展示当前对话涉及的知识点教学内容 |

---

## 9. 客户端对接设计

### 9.1 客户端状态流转

```
                    用户发起AI对话
                    
                         │
                         ▼
                ┌─────────────────┐
                │ AI_MODE         │ ← 正常AI辅导模式
                │ (SSE接收AI回复) │
                └────────┬────────┘
                         │
            收到接管通知  │  (WebSocket 推送)
                         ▼
                ┌─────────────────┐
                │ TRANSITIONING   │ ← 过渡状态
                │ 显示: "正在为您  │
                │ 切换辅导老师..." │
                └────────┬────────┘
                         │
              运营人员接单 │
                         ▼
                ┌─────────────────┐
                │ HUMAN_MODE      │ ← 人工辅导模式
                │ 显示辅导老师头像 │
                │ WebSocket双向通信│
                │ AI输入框禁用    │
                └────────┬────────┘
                         │
              接管结束    │
                         ▼
                ┌─────────────────┐
                │ AI_MODE         │ ← 恢复AI辅导（或会话结束）
                └─────────────────┘
```

### 9.2 客户端关键代码（Flutter 示例）

```dart
/// 接管状态管理
class TakeoverController extends GetxController {
  final Rx<TakeoverState> state = TakeoverState.aiMode.obs;
  final Rx<OperatorInfo?> currentOperator = Rx<OperatorInfo?>(null);
  final RxList<TakeoverMessage> messages = <TakeoverMessage>[].obs;
  
  late StreamSubscription _wsSubscription;
  
  @override
  void onInit() {
    super.onInit();
    // 监听WebSocket接管频道
    _wsSubscription = WebSocketManager.instance
        .subscribe('/topic/takeover/${SessionController.instance.sessionId}')
        .listen(_onTakeoverEvent);
  }
  
  void _onTakeoverEvent(WebSocketMessage event) {
    switch (event.type) {
      case 'takeover_starting':
        state.value = TakeoverState.transitioning;
        _showTransitionBanner(event.data['message']);
        break;
        
      case 'takeover_active':
        state.value = TakeoverState.humanMode;
        currentOperator.value = OperatorInfo.fromJson(event.data['operator']);
        _hideAiInputBox();
        _showOperatorAvatar();
        break;
        
      case 'takeover_message':
        messages.add(TakeoverMessage(
          content: event.data['content'],
          sender: MessageSender.operator,
          operatorName: event.data['operatorName'],
          timestamp: DateTime.parse(event.data['timestamp']),
        ));
        // 轻震动反馈
        HapticFeedback.lightImpact();
        break;
        
      case 'takeover_completed':
        state.value = TakeoverState.aiMode;
        currentOperator.value = null;
        _showCompletionBanner(event.data['resolution']);
        _showAiInputBox();
        break;
    }
  }
  
  /// 发送消息（根据当前模式路由）
  void sendMessage(String content) {
    if (state.value == TakeoverState.humanMode) {
      // 人工模式：通过WebSocket发送
      WebSocketManager.instance.send({
        'type': 'takeover_message',
        'takeoverId': SessionController.instance.takeoverId,
        'content': content,
      });
    } else {
      // AI模式：正常SSE流程
      AiChatController.instance.sendMessage(content);
    }
  }
  
  void _showTransitionBanner(String message) {
    Get.snackbar(
      '切换中',
      message,
      snackPosition: SnackPosition.TOP,
      duration: Duration(seconds: 5),
      backgroundColor: Colors.blue.shade50,
      borderRadius: 12,
      margin: EdgeInsets.all(16),
    );
  }
}

enum TakeoverState { aiMode, transitioning, humanMode }
```

---

## 10. 关键场景流程

### 10.1 场景一：AI讲解知识错误 → 自动预警 → 人工纠正

```
时间轴:
─────────────────────────────────────────────────────────────────────

T+0s    用户(初二学生): "光的折射定律是什么？"
T+0.5s  AI生成回复: "光从一种介质进入另一种介质时，
        折射光线与入射光线在法线两侧，折射角等于入射角..."
        ⚠️ 知识错误！折射角与入射角的关系取决于介质，
           不总是"等于"

T+1.2s  质量监控引擎:
        • 规则检查: 无即时风险触发
        • 模型评估: accuracy=45分 (RAG检索发现冲突)
        • 综合评分: 52分 → MEDIUM风险

T+1.5s  系统行为:
        • 创建预警工单 (LOW_ACCURACY, MEDIUM)
        • 推送到监控台
        • 不打扰用户（AI回复正常展示）
        • SLA: 5分钟

T+3.0s  运营人员(李老师)在监控台看到预警
        • 查看对话内容
        • 确认知识错误: "折射角等于入射角"是错的
        • 点击 [立即处理]

T+5.0s  李老师发送纠正消息:
        "同学你好，刚才的讲解有个地方需要更正一下。
         光从空气射入水中时，折射角小于入射角，
         不是'等于'。具体的折射关系由斯涅尔定律描述..."

T+5.5s  客户端收到接管消息
        • 显示辅导老师头像和消息
        • 用户看到纠正内容

T+30s   用户: "哦哦，明白了！谢谢老师！"
T+32s   李老师点击 [结束接管]，选择"已解决"
        系统记录:
        • AI质量: 52分
        • 接管耗时: ~27秒
        • 用户满意度: 正面
        • 错误类型: 知识性错误 - 光学
```

### 10.2 场景二：CRITICAL 安全违规 → 立即中断

```
时间轴:
─────────────────────────────────────────────────────────────────────

T+0s    用户(小学五年级): "人为什么会死？"
T+1.0s  AI开始流式输出（SSE）:
        "死亡是生命的一部分...有时人会经历很痛苦的过程..."

T+1.5s  质量监控引擎:
        • 规则检查: 命中 "死亡" 相关敏感性检测
        • 风险等级: CRITICAL
        • 触发: SAFETY_VIOLATION

T+1.6s  系统行为（立即执行）:
        ① 中断SSE流（停止AI继续输出）
        ② 向客户端推送安全提示卡片:
           "这个问题很好！让我用更适合你的方式来回答~"
        ③ 创建CRITICAL接管工单
        ④ SLA: 30秒
        ⑤ 通知运营主管

T+2.0s  客户端:
        • AI输出停止
        • 显示温和的过渡提示
        • 输入框暂时禁用

T+15s   运营人员接单，发送适龄化回复:
        "这是一个很深刻的问题！在我们的自然界中，
         所有的生物都有自己的生命周期，就像花开花落一样。
         如果你对此感到好奇或担心，
         可以和爸爸妈妈聊聊，他们会很好地帮助你理解。"

T+45s   接管结束
        系统记录安全事件，纳入AI模型改进数据
```

### 10.3 场景三：用户持续困惑 → 自动建议接管

```
时间轴:
─────────────────────────────────────────────────────────────────────

T+0s    用户(高一): "怎么求这个函数的导数？ f(x) = x²·sin(x)"
T+2s    AI: "使用乘积法则，f'(x) = 2x·sin(x) + x²·cos(x)"
        质量评分: 82分 (SAFE)

T+30s   用户: "为什么是2x·sin(x)而不是x²·sin'(x)？"
T+32s   AI: "因为乘积法则是 (uv)' = u'v + uv'..."
        质量评分: 75分 (SAFE，但用户表达了困惑信号)

T+60s   用户: "听不懂，能不能换个方式讲？"
T+62s   AI: "好的，我们换个角度。把f(x)看成两个函数相乘..."
        质量评分: 68分 (LOW)
        ⚠️ 困惑信号计数: 1

T+90s   用户: "还是不明白 u'v 是什么意思"
T+92s   AI: "u'就是对u求导数。这里u=x²所以u'=2x..."
        质量评分: 60分 (LOW)
        ⚠️ 困惑信号计数: 2

T+120s  用户: "？？？完全懵了"
T+122s  AI: "让我再尝试一个更简单的例子..."
        质量评分: 55分 (LOW)
        ⚠️ 上下文模式检测: PERSISTENT_CONFUSION (3轮)
        ⚠️ 综合评分降至 42分 → HIGH风险

T+123s  系统行为:
        • 创建HIGH预警工单
        • 向用户展示温和提示:
          "如果觉得还不够清楚，可以试试让辅导老师为你讲解~"
          [转人工辅导]
        • 监控台高优先级预警弹出

T+130s  用户点击 [转人工辅导]
        → 主动触发接管流程

T+135s  运营人员(数学专业)接单
T+140s  运营人员: "同学你好！我是数学辅导老师。
         乘积法则其实可以用一个简单的口诀记忆：
         '前导后不导 + 前不导后导'..."

T+200s  用户: "哦！这样记就清楚了！谢谢老师！"
T+202s  接管结束，记录: resolved, 用户满意
```

---

## 11. 异步质量分析链路

### 11.1 离线深度分析

实时评估仅使用轻量模型（≤500ms），深度分析异步进行：

```java
/**
 * 异步深度质量分析消费者
 * 消费Kafka中的质量事件，进行深度分析
 */
@KafkaListener(topics = "ai-quality-events")
public class QualityDeepAnalyzer {

    /**
     * 深度分析流程:
     * 1. 教育事实校验（与知识库对比）
     * 2. 解题步骤完整性验证
     * 3. 适龄化表达深度评估
     * 4. 与历史优质回答对比
     */
    @Autowired private EducationFactChecker factChecker;
    @Autowired private SolutionStepValidator stepValidator;
    @Autowired private QualityRepository qualityRepo;
    
    public void onQualityEvent(QualityEvent event) {
        // 异步执行深度校验
        CompletableFuture.supplyAsync(() -> 
                factChecker.verify(event.getAiResponse(), event.getSubject()))
            .thenCombine(CompletableFuture.supplyAsync(() ->
                stepValidator.validate(event.getAiResponse(), 
                    event.getQuestionType())), 
                (factResult, stepResult) -> {
                    
                DeepAnalysisResult result = DeepAnalysisResult.builder()
                    .turnId(event.getTurnId())
                    .factAccuracy(factResult.getScore())
                    .factConflicts(factResult.getConflicts())
                    .stepCompleteness(stepResult.getScore())
                    .missingSteps(stepResult.getMissingSteps())
                    .build();
                
                // 回填到质量日志
                qualityRepo.updateDeepAnalysis(event.getTurnId(), result);
                
                // 如果发现严重错误且实时评估未捕获，创建补充预警
                if (factResult.getScore() < 40 && 
                    event.getRealtimeRiskLevel() == RiskLevel.SAFE) {
                    alertDispatcher.dispatchSupplementaryAlert(
                        event.getSessionId(), 
                        AlertType.LOW_ACCURACY,
                        "异步分析发现AI回答可能存在知识错误");
                }
                
                return result;
            });
    }
}
```

### 11.2 质量数据回流

```
实时评估 + 异步分析结果
          │
          ▼
    ┌──────────────────────────────────┐
    │ ClickHouse 质量数据仓库          │
    │                                  │
    │ 用途:                            │
    │ • 模型质量趋势分析               │
    │ • Prompt模板效果对比             │
    │ • 预警准确率统计                 │
    │ • 运营人员绩效评估               │
    │ • 知识点错误率排行               │
    │ • 学科/年级质量差异分析          │
    └──────────────────────────────────┘
          │
          ▼
    ┌──────────────────────────────────┐
    │ AI模型优化反馈                   │
    │                                  │
    │ • 错误样本 → 微调训练数据        │
    │ • 低质Prompt → Prompt模板优化    │
    │ • 高频错误知识点 → RAG内容补充   │
    └──────────────────────────────────┘
```

---

## 12. 性能与容量设计

### 12.1 性能预算

| 环节 | 预算 | 说明 |
| --- | --- | --- |
| 即时规则检查 | ≤ 50ms | 纯CPU计算，无外部调用 |
| 轻量模型评估 | ≤ 500ms | BERT-tiny级别模型，GPU推理 |
| 上下文模式检测 | ≤ 200ms | 内存中操作，基于Redis缓存 |
| 综合评分计算 | ≤ 10ms | 纯计算 |
| 预警分发 | ≤ 100ms | WebSocket推送 |
| **总开销** | **≤ 860ms** | 目标 ≤ 200ms（并行化后） |

**并行化策略**: 规则检查与模型评估并行执行，上下文模式检测与模型评估并行：

```
       ┌─ 规则检查 (50ms) ──────────────┐
       │                                ├─→ 合并判断
请求 ──┤                                │
       ├─ 模型评估 (500ms) ─────────────┤
       │                                │
       └─ 上下文模式 (200ms) ───────────┘
       
       总延迟 ≈ max(50, 500, 200) = 500ms
```

### 12.2 容量规划

| 指标 | 预估值 | 说明 |
| --- | --- | --- |
| 日均AI对话轮次 | 500万 | 10万DAU × 50轮/人 |
| 峰值QPS | 2000 | 晚高峰(19:00-21:00) |
| 质量评估QPS | 2000 | 1:1 评估 |
| 轻量模型GPU | 2张 T4 | batch=32, 处理2000 QPS |
| Redis内存 | 4GB | 活跃会话状态 + 计数器 |
| 日均质量日志 | ~50GB | 500万条 × ~10KB |
| 日均预警工单 | ~5000 | 约 0.1% 触发率 |
| 日均接管 | ~200 | 约 0.004% 触发率 |
| 运营人员 | 8-15人 | 分时段排班 |

### 12.3 降级策略

```java
/**
 * 质量监控降级策略
 * 当系统压力过大时，逐步降级以保护核心AI对话功能
 */
public class QualityMonitorDegradation {

    public enum DegradationLevel {
        // L0: 完整监控（默认）
        FULL("全量实时评估 + 模型分析 + 上下文检测"),
        
        // L1: 降级——跳过模型评估，仅规则检查
        RULES_ONLY("仅规则检查，跳过轻量模型评估（QPS > 2500时触发）"),
        
        // L2: 降级——仅安全规则，跳过质量规则
        SAFETY_ONLY("仅安全类规则检查，跳过质量评估（QPS > 3500时触发）"),
        
        // L3: 降级——完全旁路，仅记录日志
        LOG_ONLY("质量监控旁路，仅记录事件供离线分析（QPS > 5000时触发）"),
        
        // L4: 完全关闭
        DISABLED("质量监控完全关闭（极端情况，需人工介入恢复）");
    }
    
    @Scheduled(fixedRate = 10000) // 每10秒检查一次
    public void evaluateDegradation() {
        double currentQps = metricsService.getCurrentEvaluateQps();
        double systemLoad = metricsService.getSystemLoad();
        
        DegradationLevel target;
        if (currentQps > 5000 || systemLoad > 0.95) {
            target = DegradationLevel.LOG_ONLY;
        } else if (currentQps > 3500 || systemLoad > 0.85) {
            target = DegradationLevel.SAFETY_ONLY;
        } else if (currentQps > 2500 || systemLoad > 0.75) {
            target = DegradationLevel.RULES_ONLY;
        } else {
            target = DegradationLevel.FULL;
        }
        
        if (target != currentLevel) {
            applyDegradation(target);
            alertService.notifyOpsTeam(
                "质量监控降级: " + currentLevel + " → " + target);
        }
    }
}
```

---

## 13. 错误处理

### 13.1 异常场景与处理

| 异常场景 | 处理策略 | 影响范围 |
| --- | --- | --- |
| 质量监控引擎宕机 | 自动降级为LOG_ONLY，AI对话不受影响 | 失去实时质量保障 |
| 轻量模型推理超时 | 跳过模型评估，仅使用规则检查结果 | 质量评估精度下降 |
| Redis 连接异常 | 本地缓存兜底，异步重试写入 | 会话状态可能不实时 |
| WebSocket 接管通道断开 | 客户端自动重连 + 消息补全 | 接管消息延迟 |
| 运营人员全部离线 | 自动切换为AI降级模式（增加安全提示） | 无法人工接管 |
| 预警工单积压 | 自动升级通知主管 + 扩大运营团队通知 | 预警处理延迟 |
| Kafka 事件积压 | 消费者扩容 + 丢弃 > 30分钟的过期事件 | 部分质量事件丢失 |

### 13.2 核心异常码

```java
public class QualityMonitorErrorCode {
    
    // 评估引擎错误 70001-70099
    EVAL_TIMEOUT(70001, "质量评估超时", "已降级为规则检查"),
    MODEL_UNAVAILABLE(70002, "评估模型不可用", "已降级为规则检查"),
    CONTEXT_FETCH_FAILED(70003, "会话上下文获取失败", "跳过上下文模式检测"),
    
    // 预警系统错误 70100-70199
    ALERT_DISPATCH_FAILED(70100, "预警分发失败", "记录日志，等待重试"),
    DASHBOARD_PUSH_FAILED(70101, "监控台推送失败", "不影响预警工单创建"),
    
    // 接管服务错误 70200-70299
    TAKEOVER_SESSION_NOT_FOUND(70200, "接管会话不存在", "返回错误提示"),
    TAKEOVER_ALREADY_ACTIVE(70201, "会话已被接管", "忽略重复接管请求"),
    TAKEOVER_OPERATOR_OVERLOAD(70202, "运营人员负载已满", "分配给其他人员或排队"),
    TAKEOVER_WS_DISCONNECTED(70203, "接管WebSocket断开", "客户端自动重连"),
    
    // 降级相关 70300-70399
    DEGRADED_RULES_ONLY(70300, "已降级：仅规则检查", "模型评估暂不可用"),
    DEGRADED_SAFETY_ONLY(70301, "已降级：仅安全检查", "质量评估暂不可用"),
    DEGRADED_LOG_ONLY(70302, "已降级：仅日志记录", "实时质量监控暂停");
}
```

---

## 14. 数据统计与报表

### 14.1 关键指标定义

| 指标 | 定义 | 计算方式 |
| --- | --- | --- |
| AI辅导质量指数 | 全平台AI对话的平均质量评分 | 所有轮次质量评分的加权平均（近期权重高） |
| 预警触发率 | 触发预警的会话占比 | 预警会话数 / 总会话数 |
| 预警准确率 | 真正需要干预的预警占比 | 有效预警数 / 总预警数 |
| 接管覆盖率 | 被人工接管的会话占比 | 接管会话数 / 总会话数 |
| 接管响应时间 | 从预警到运营人员接单的时间 | avg(accepted_at - alert_at) |
| 接管满意度 | 接管后用户表达正面情绪的比例 | 正面信号数 / 接管会话数 |
| 风险热词 | 预警中最频繁出现的风险标签 | risk_tag 频次统计 |
| 质量改善率 | 接管后质量评分的提升幅度 | avg(接管后评分 - 接管前评分) |

### 14.2 ClickHouse 质量统计表

```sql
CREATE TABLE quality_metrics_daily (
    date              Date,
    subject           String,
    grade_level       String,
    
    total_sessions    UInt64,
    total_turns       UInt64,
    avg_quality_score Float64,
    
    alert_count       UInt64,
    alert_by_type     Map(String, UInt64),
    alert_by_level    Map(String, UInt64),
    
    takeover_count    UInt64,
    takeover_avg_response_sec Float64,
    takeover_resolution_breakdown Map(String, UInt64),
    
    false_positive_rate Float64,
    
    ENGINE = MergeTree()
    ORDER BY (date, subject, grade_level)
    PARTITION BY toYYYYMM(date);
```

---

## 15. 安全与权限

### 15.1 权限控制

| 角色 | 权限 |
| --- | --- |
| 运营专员(CSR_L1) | 查看预警、接管会话、发送消息、结束接管 |
| 运营主管(CSR_L2) | 所有L1权限 + 分配预警、查看团队报表、调整SLA |
| 教研专家(EDU_EXPERT) | 查看预警、接管会话、访问知识点详情、质量分析报表 |
| 系统管理员(ADMIN) | 全部权限 + 配置规则、管理运营人员、系统降级操作 |

### 15.2 隐私保护

- 接管时，运营人员看到的是**脱敏后的用户信息**（昵称而非真实姓名）
- 对话内容仅用于辅导，不展示用户的其他学习数据（除非用户授权）
- 接管记录中的敏感对话内容定期脱敏归档
- 所有运营人员操作记录审计日志，防止信息滥用
- 运营人员不得查看用户的位置、联系方式等个人信息

---

## 16. 部署与配置

### 16.1 部署拓扑

```yaml
# Kubernetes 部署拓扑
quality-monitor-system:
  quality-monitor-engine:
    replicas: 4          # 根据QPS水平扩展
    resources:
      cpu: 2
      memory: 4Gi
    gpu: 1               # 轻量模型推理
    
  alert-dispatcher:
    replicas: 2
    resources:
      cpu: 1
      memory: 2Gi
      
  human-takeover-service:
    replicas: 3          # 高可用
    resources:
      cpu: 1
      memory: 2Gi
      
  monitor-dashboard:
    replicas: 2
    resources:
      cpu: 0.5
      memory: 1Gi
      
  redis:
    type: sentinel/cluster
    memory: 4Gi
    
  kafka:
    topic: ai-quality-events
    partitions: 12
    retention: 7d
```

### 16.2 关键配置项

```yaml
quality-monitor:
  # 评估策略
  evaluation:
    enable-model-assessment: true
    enable-context-detection: true
    model-timeout-ms: 500
    rules-timeout-ms: 50
    
  # 风险阈值
  thresholds:
    safe-score: 75
    low-score: 55
    medium-score: 35
    high-score: 0
    confusion-turns: 3        # 连续困惑轮次阈值
    repetition-threshold: 0.85 # 重复检测阈值
    relevance-keyword-overlap: 0.1
    
  # 预警策略
  alert:
    sla:
      critical-sec: 30
      high-sec: 120
      medium-sec: 300
    auto-assign: true          # 自动分配运营人员
    max-assign-wait-sec: 60   # 自动分配等待上限
    
  # 接管策略
  takeover:
    max-concurrent-per-operator: 5
    auto-pause-ai-on-high: true
    auto-pause-ai-on-critical: true
    client-notification-delay-sec: 3
    
  # 降级策略
  degradation:
    enable-auto-degrade: true
    check-interval-sec: 10
    rules-only-qps: 2500
    safety-only-qps: 3500
    log-only-qps: 5000
```

---

## 17. 附录

### 17.1 与现有系统对接清单

| 现有系统 | 对接方式 | 数据流向 |
| --- | --- | --- |
| AI对话引擎与会话管理 | 事件订阅（Kafka） | AI对话完成 → 质量事件 → 本系统 |
| AI输入安全护栏引擎 | 串联前置 | 安全护栏过滤 → AI生成 → 质量监控 |
| AI幻觉检测与教育事实校验 | 异步补充 | 本系统 → 异步任务 → 幻觉检测 → 回填结果 |
| AI回答质量监控与用户纠错反馈 | 数据互补 | 用户纠错数据 → 本系统质量评分修正 |
| AI对话安全审计与敏感内容自动上报 | 事件共享 | CRITICAL预警 → 同步至安全审计系统 |
| 通知中心与站内消息系统 | 消息推送 | 预警通知 → 通知中心分发 |
| 客服与工单系统 | 工单关联 | 高级预警 → 创建客服工单 |
| 学习行为事件流 | 事件消费 | 学习行为事件 → 辅助上下文分析 |
| 数据埋点与关键指标系统 | 数据上报 | 质量指标 → 统一指标系统 |

### 17.2 名词解释

| 术语 | 含义 |
| --- | --- |
| 质量评分 | 对AI单轮回复的综合质量打分，0-100分 |
| 风险等级 | 对AI会话当前风险状态的分级判断 |
| 预警工单 | 系统检测到风险后创建的处理任务 |
| 接管 | 运营人员接管AI对话，直接与用户沟通 |
| SLA | 预警/接管的服务等级协议时间 |
| 降级 | 系统压力过大时，逐步关闭部分监控功能 |
| 困惑信号 | 用户消息中表达"不理解"的语义信号 |
| AI循环 | AI在不同轮次给出高度相似回复的异常模式 |

---

## 文档变更记录

| 日期 | 版本 | 变更 |
| --- | --- | --- |
| 2026-06-21 | v1.0 | 初始版本：实时质量监控、风险检测、人工接管全链路设计 |
