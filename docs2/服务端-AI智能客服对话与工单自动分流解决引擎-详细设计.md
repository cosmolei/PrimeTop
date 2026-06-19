# 服务端 - AI 智能客服对话与工单自动分流解决引擎

> 细化日期：2026-06-20
> 关联模块：客服与工单系统、AI对话引擎与会话管理、RAG与知识库系统、消息与推送服务、用户反馈与AI质量评估
> 层级：服务端·AI能力层·客服智能化

---

## 1. 模块概述

### 1.1 功能定位

AI 智能客服对话与工单自动分流解决引擎（Intelligent Customer Service Engine，简称 ICS）是 PrimeTop 客服体系的智能化核心层。它在现有「客服与工单系统」之上构建一层 AI 驱动的自动化能力，实现：

1. **即时自助解决**：用户进入帮助中心后，AI 对话机器人优先接待，通过多轮对话理解用户问题，直接给出解决方案，减少人工工单量。
2. **智能工单分流**：当 AI 无法自动解决时，自动提取问题摘要、分类、紧急度、关联实体，生成结构化工单并精准路由到对应客服组。
3. **客服辅助决策**：人工客服处理过程中，AI 实时推荐回复话术、关联 FAQ、相似历史工单，提升处理效率。
4. **知识闭环自学习**：从已解决的工单中自动提炼问答对，反哺知识库，持续提升自动解决率。

### 1.2 与现有系统的边界

| 系统 | 职责 | 与 ICS 的关系 |
|------|------|---------------|
| 客服与工单系统 | 工单 CRUD、客服分配、SLA 监控 | ICS 是其前置 AI 层 + 辅助层；工单创建/流转仍由该系统负责 |
| AI 对话引擎与会话管理 | 教育场景 AI 辅导对话 | ICS 复用对话基础设施（SSE 流式、会话管理），但使用独立的 Prompt 模板和知识库 |
| RAG 与知识库系统 | 教育知识检索 | ICS 拥有独立的客服知识库（FAQ + 历史工单 + 产品帮助文档） |
| 用户反馈与 AI 质量评估 | 用户对 AI 回答的纠错反馈 | 纠错反馈升级为工单时，ICS 负责前置 AI 拦截 |
| 消息与推送服务 | 站内消息 / Push | ICS 通过事件驱动通知客服 / 用户 |

### 1.3 核心目标

| 目标 | 指标 |
|------|------|
| 自助解决率 | AI 对话机器人独立解决用户问题比例 ≥ 55% |
| 首次响应时间 | AI 即时响应 < 1s（首 Token），完整回复 < 5s |
| 工单自动分类准确率 | 意图分类 Top-1 准确率 ≥ 85%，Top-3 ≥ 95% |
| 客服效率提升 | 客服平均处理时长（AHT）降低 ≥ 30% |
| 用户满意度 | AI 解决场景满意度 ≥ 4.0/5.0 |
| 知识库自增长 | 每月自动新增有效问答对 ≥ 200 条 |

### 1.4 依赖关系

```
                    ┌──────────────────────────────────┐
                    │       ICS 智能客服引擎            │
                    └──────────┬───────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
  ┌───────▼────────┐  ┌───────▼────────┐  ┌───────▼────────┐
  │  AI 对话层      │  │  知识检索层     │  │  工单桥接层     │
  │  (LLM + Prompt) │  │  (RAG + FAQ)   │  │  (创建/路由)    │
  └───────┬────────┘  └───────┬────────┘  └───────┬────────┘
          │                    │                    │
  ┌───────▼────────┐  ┌───────▼────────┐  ┌───────▼────────┐
  │ 多模型调度服务  │  │ 向量数据库      │  │ 客服与工单系统  │
  │ SSE 流式响应   │  │ Elasticsearch   │  │ 用户账号体系    │
  │ 对话记忆引擎   │  │ Redis 缓存      │  │ 消息推送服务    │
  └────────────────┘  └────────────────┘  └────────────────┘
```

---

## 2. 整体架构设计

### 2.1 架构分层

```
┌─────────────────────────────────────────────────────────────────────┐
│                        客户端入口                                    │
│   帮助中心页 │ 设置-意见反馈 │ 工单详情页 │ 站内消息                 │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │  API Gateway │
                    └──────┬──────┘
                           │
              ┌────────────▼────────────┐
              │    ICS API Controller    │
              │  (REST + SSE + WebSocket)│
              └────────────┬────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
   ┌──────▼──────┐  ┌─────▼───────┐  ┌─────▼───────┐
   │ 会话管理器   │  │ 意图分类器   │  │ 知识检索器   │
   │ Session     │  │ Intent      │  │ Knowledge   │
   │ Manager     │  │ Classifier  │  │ Retriever   │
   └──────┬──────┘  └─────┬───────┘  └─────┬───────┘
          │                │                │
          └────────────────┼────────────────┘
                           │
              ┌────────────▼────────────┐
              │     对话编排引擎          │
              │  Dialogue Orchestrator   │
              │                         │
              │  ┌─────────────────┐    │
              │  │ Prompt 构建器    │    │
              │  │ (场景模板+上下文)│    │
              │  └────────┬────────┘    │
              │           │             │
              │  ┌────────▼────────┐    │
              │  │ LLM 调用器      │    │
              │  │ (流式/非流式)    │    │
              │  └────────┬────────┘    │
              │           │             │
              │  ┌────────▼────────┐    │
              │  │ 回复后处理      │    │
              │  │ (安全/格式/引用) │    │
              │  └─────────────────┘    │
              └────────────┬────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
   ┌──────▼──────┐  ┌─────▼───────┐  ┌─────▼───────┐
   │ 解决判定器   │  │ 情感分析器   │  │ 工单生成器   │
   │ Resolution  │  │ Sentiment   │  │ Ticket      │
   │ Detector    │  │ Analyzer    │  │ Builder     │
   └─────────────┘  └─────────────┘  └──────┬──────┘
                                          │
                                   ┌──────▼──────┐
                                   │ 路由分发器   │
                                   │ Router      │
                                   └──────┬──────┘
                                          │
                              ┌───────────┼───────────┐
                              │           │           │
                        ┌─────▼────┐ ┌────▼────┐ ┌───▼─────┐
                        │ 自动解决  │ │人工客服组│ │紧急升级  │
                        │ Auto-    │ │Human    │ │Escalate │
                        │ Resolve  │ │Agent    │ │         │
                        └──────────┘ └─────────┘ └─────────┘
```

### 2.2 核心流程概览

```
用户提问
   │
   ▼
┌──────────┐     ┌──────────┐     ┌──────────┐
│ 会话初始化 │────▶│ 意图分类  │────▶│ 知识检索  │
│ + 上下文   │     │ + 实体抽取│     │ RAG+FAQ  │
└──────────┘     └──────────┘     └──────────┘
                                         │
                                         ▼
                 ┌──────────┐     ┌──────────┐
                 │ 回复生成  │◀────│ Prompt   │
                 │ (流式SSE) │     │ 组装     │
                 └─────┬────┘     └──────────┘
                       │
               ┌───────▼────────┐
               │  解决判定       │
               │  ┌─已解决─┐    │
               │  │        │    │
               │  │ 满意度  │    │
               │  │ 收集   │    │
               │  └────────┘    │
               │  ┌─未解决─┐    │
               │  │        │    │
               │  │ 情感+   │    │
               │  │ 紧急度  │    │
               │  │ 判定    │    │
               │  └───┬────┘    │
               └──────┼─────────┘
                      │
               ┌──────▼──────┐
               │ 工单自动生成 │
               │ + 智能路由   │
               └─────────────┘
```

---

## 3. 数据模型设计

### 3.1 客服对话会话表 `ics_sessions`

```sql
CREATE TABLE ics_sessions (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_token   VARCHAR(64) NOT NULL UNIQUE COMMENT '会话唯一标识',
    user_id         BIGINT NOT NULL COMMENT '用户ID',
    user_role       ENUM('student', 'parent', 'teacher', 'other') NOT NULL DEFAULT 'student',
    
    -- 用户上下文
    user_grade      VARCHAR(32) NULL COMMENT '用户当前年级（来自用户画像）',
    user_member_level VARCHAR(32) NULL COMMENT '会员等级',
    user_device     VARCHAR(128) NULL COMMENT '设备信息',
    app_version     VARCHAR(32) NULL COMMENT 'APP版本',
    
    -- 会话状态
    status          ENUM('active', 'resolved', 'escalated', 'abandoned', 'timeout')
                    NOT NULL DEFAULT 'active' COMMENT '会话状态',
    source          ENUM('help_center', 'feedback', 'settings', 'ticket_detail', 'push')
                    NOT NULL DEFAULT 'help_center' COMMENT '入口来源',
    
    -- AI 处理信息
    primary_intent  VARCHAR(64) NULL COMMENT '主意图分类',
    intent_confidence DECIMAL(5,4) NULL COMMENT '意图置信度',
    entities        JSON NULL COMMENT '抽取的实体 {"order_id":"ORD123","subject":"数学"}',
    sentiment_score DECIMAL(4,3) NULL COMMENT '情感得分(-1.000~1.000)',
    urgency_level   ENUM('low', 'normal', 'high', 'urgent') NOT NULL DEFAULT 'normal',
    
    -- 关联信息
    related_ticket_id BIGINT NULL COMMENT '关联工单ID（升级时关联）',
    resolved_by     ENUM('ai_auto', 'ai_assisted', 'human', 'self_service') NULL COMMENT '解决方式',
    satisfaction_score TINYINT NULL COMMENT '满意度评分 1-5',
    
    -- 时间
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    first_response_at DATETIME(3) NULL COMMENT '首次AI响应时间',
    resolved_at     DATETIME(3) NULL COMMENT '解决时间',
    abandoned_at    DATETIME(3) NULL COMMENT '放弃时间',
    
    INDEX idx_user (user_id, status),
    INDEX idx_status_created (status, created_at),
    INDEX idx_intent (primary_intent),
    INDEX idx_ticket (related_ticket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI智能客服会话表';
```

### 3.2 对话消息表 `ics_messages`

```sql
CREATE TABLE ics_messages (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id      BIGINT NOT NULL COMMENT '会话ID',
    message_index   INT NOT NULL DEFAULT 0 COMMENT '消息序号（会话内递增）',
    
    role            ENUM('user', 'assistant', 'system', 'agent') NOT NULL COMMENT '消息角色',
    content_type    ENUM('text', 'image', 'card', 'quick_reply', 'action'] 
                    NOT NULL DEFAULT 'text' COMMENT '内容类型',
    content         MEDIUMTEXT NOT NULL COMMENT '消息内容（文本/JSON结构化卡片）',
    
    -- AI 元数据
    model_name      VARCHAR(64) NULL COMMENT '生成模型名',
    prompt_tokens   INT NULL COMMENT '输入Token数',
    completion_tokens INT NULL COMMENT '输出Token数',
    latency_ms      INT NULL COMMENT '生成耗时(毫秒)',
    
    -- 检索引用
    cited_sources   JSON NULL COMMENT '引用的知识源 [{"type":"faq","id":123,"title":"如何退款","score":0.95}]',
    
    -- 安全审核
    safety_flag     ENUM('clean', 'blocked', 'reviewed') NOT NULL DEFAULT 'clean',
    safety_reason   VARCHAR(256) NULL,
    
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    
    UNIQUE KEY uk_session_index (session_id, message_index),
    INDEX idx_session (session_id, created_at),
    CONSTRAINT fk_msg_session FOREIGN KEY (session_id) 
        REFERENCES ics_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='智能客服对话消息表';
```

### 3.3 客服知识库表 `ics_knowledge_items`

```sql
CREATE TABLE ics_knowledge_items (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    
    -- 知识类型
    type            ENUM('faq', 'article', 'resolved_ticket', 'policy', 'product_doc')
                    NOT NULL COMMENT '知识条目类型',
    source_id       BIGINT NULL COMMENT '来源关联ID（如resolved_ticket关联工单ID）',
    
    -- 内容
    title           VARCHAR(512) NOT NULL COMMENT '标题/问题',
    content         MEDIUMTEXT NOT NULL COMMENT '内容/答案（Markdown）',
    summary         VARCHAR(1024) NULL COMMENT '摘要（用于检索展示）',
    tags            JSON NULL COMMENT '标签 ["退款","会员","支付"]',
    category_path   VARCHAR(256) NULL COMMENT '分类路径 "支付/退款/会员退款"',
    
    -- 适用条件
    applicable_roles VARCHAR(128) NULL COMMENT '适用角色 "student,parent"',
    applicable_scenarios JSON NULL COMMENT '适用场景条件 {"min_grade":"初一"}',
    
    -- 向量化
    embedding_status ENUM('pending', 'embedded', 'failed') NOT NULL DEFAULT 'pending',
    embedding_model  VARCHAR(64) NULL COMMENT '向量化使用的模型',
    content_hash    VARCHAR(64) NULL COMMENT '内容哈希（去重用）',
    
    -- 质量与反馈
    view_count      INT NOT NULL DEFAULT 0 COMMENT '被引用次数',
    helpful_count   INT NOT NULL DEFAULT 0 COMMENT '用户标记"有用"次数',
    unhelpful_count INT NOT NULL DEFAULT 0 COMMENT '用户标记"无用"次数',
    quality_score   DECIMAL(3,2) NOT NULL DEFAULT 0.50 COMMENT '质量分(0.00~1.00)',
    
    -- 状态
    status          ENUM('draft', 'active', 'archived', 'deprecated') NOT NULL DEFAULT 'draft',
    reviewed_by     BIGINT NULL COMMENT '审核人ID',
    reviewed_at     DATETIME(3) NULL,
    
    -- 自动提取来源
    auto_extracted  TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否从工单自动提取',
    extract_confidence DECIMAL(5,4) NULL COMMENT '自动提取置信度',
    
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    
    INDEX idx_type_status (type, status),
    INDEX idx_category (category_path),
    INDEX idx_hash (content_hash),
    INDEX idx_quality (quality_score DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客服知识库条目表';
```

### 3.4 意图配置表 `ics_intents`

```sql
CREATE TABLE ics_intents (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    intent_code     VARCHAR(64) NOT NULL UNIQUE COMMENT '意图编码 如 refund.member',
    intent_name     VARCHAR(128) NOT NULL COMMENT '意图名称 如 会员退款咨询',
    parent_code     VARCHAR(64) NULL COMMENT '父意图编码（支持层级）',
    level           TINYINT NOT NULL DEFAULT 1 COMMENT '层级 1/2/3',
    
    -- 关键词与示例
    keywords        JSON NULL COMMENT '关键词列表 ["退款","退订","退会员"]',
    example_queries JSON NULL COMMENT '示例用户问法 ["如何取消会员自动续费","会员退了钱什么时候到"]',
    
    -- 处理策略
    auto_resolvable TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否可自动解决',
    suggested_faq_ids JSON NULL COMMENT '关联FAQ ID列表',
    route_target    VARCHAR(64) NULL COMMENT '人工路由目标组 "cs_payment"',
    sla_priority    ENUM('urgent', 'high', 'normal', 'low') NOT NULL DEFAULT 'normal',
    
    -- 超时升级
    auto_escalate_after_seconds INT NULL COMMENT 'AI尝试N秒未解决后自动升级',
    max_ai_turns   INT NOT NULL DEFAULT 5 COMMENT 'AI最大对话轮次（超过则升级人工）',
    
    status          ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    
    UNIQUE KEY uk_intent_code (intent_code),
    INDEX idx_parent (parent_code),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客服意图配置表';
```

### 3.5 客服辅助记录表 `ics_agent_assists`

```sql
CREATE TABLE ics_agent_assists (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    ticket_id       BIGINT NOT NULL COMMENT '关联工单ID',
    session_id      BIGINT NULL COMMENT '关联AI会话ID',
    agent_id        BIGINT NOT NULL COMMENT '客服ID',
    
    assist_type     ENUM('suggested_reply', 'similar_case', 'faq_recommend', 
                         'sentiment_alert', 'summary', 'action_suggest')
                    NOT NULL COMMENT '辅助类型',
    assist_content  JSON NOT NULL COMMENT '辅助内容（推荐话术/相似案例/FAQ等）',
    adopted         TINYINT(1) NULL COMMENT '客服是否采纳',
    agent_feedback  VARCHAR(256) NULL COMMENT '客服反馈（采纳/不采纳原因）',
    
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    
    INDEX idx_ticket (ticket_id),
    INDEX idx_agent (agent_id, created_at),
    INDEX idx_type_adopted (assist_type, adopted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客服AI辅助记录表';
```

---

## 4. 意图分类与实体抽取

### 4.1 意图分类树

基于 PrimeTop 业务特征，构建三级意图树：

```
root
├── account          账号相关
│   ├── account.register        注册/登录问题
│   ├── account.password        密码/验证码
│   ├── account.merge           账号合并
│   ├── account.delete          注销账号
│   └── account.security        安全/被盗
├── payment          支付相关
│   ├── payment.subscribe       会员订阅
│   ├── payment.refund          退款申请
│   ├── payment.invoice         发票问题
│   ├── payment.failure         支付失败
│   └── payment.auto_renew      自动续费
├── learning         学习功能
│   ├── learning.ai_tutor       AI辅导异常
│   ├── learning.photo_search   拍照搜题问题
│   ├── learning.sync_class     同步课堂
│   ├── learning.error_book     错题本
│   ├── learning.analysis       学情报告
│   └── learning.plan           学习规划
├── content          内容问题
│   ├── content.error           内容错误/过时
│   ├── content.missing         缺少某教材/年级
│   ├── content.difficulty      内容难度反馈
│   └── content.copyright       版权投诉
├── technical        技术问题
│   ├── technical.crash         APP闪退
│   ├── technical.network       网络/加载问题
│   ├── technical.sync          数据同步异常
│   ├── technical.device        设备兼容性
│   └── technical.performance   卡顿/慢
├── parent           家长相关
│   ├── parent.bind             绑定孩子账号
│   ├── parent.control          管控设置
│   └── parent.report           家长端报告
├── teacher          教师相关
│   ├── teacher.class           班级管理
│   └── teacher.homework        作业发布
└── other            其他
    ├── other.suggestion        功能建议
    ├── other.complaint         投诉
    └── other.business          商务合作
```

### 4.2 意图分类器实现

采用 **LLM Few-Shot + 规则关键词双通道** 策略，LLM 为主，规则为兜底。

#### 4.2.1 LLM 分类 Prompt 模板

```python
INTENT_CLASSIFY_PROMPT = """你是一个客服意图分类助手。请根据用户的问题，判断其属于以下哪个意图类别。

## 意图类别列表
{intent_list_with_descriptions}

## 用户画像
- 角色：{user_role}
- 年级：{user_grade}
- 会员等级：{member_level}

## 历史对话（最近3轮）
{recent_dialogue}

## 用户当前问题
{user_query}

## 请输出 JSON
{{
    "intent_code": "意图编码",
    "confidence": 0.0-1.0,
    "entities": {{
        "order_id": "订单号（如有）",
        "subject": "学科（如有）",
        "textbook_version": "教材版本（如有）"
    }},
    "urgency": "low|normal|high|urgent",
    "needs_human": true|false
}}

注意：
- confidence < 0.6 时设置 needs_human = true
- 涉及退款、投诉、安全、隐私的 urgency 至少为 high
- 如果用户明确要求人工客服，直接 needs_human = true
"""
```

#### 4.2.2 关键词兜底规则

```python
KEYWORD_FALLBACK_RULES = {
    "payment.refund": {
        "any": ["退款", "退钱", "退还", "退费"],
        "boost_keywords": ["会员", "订阅", "扣款"],
        "min_score": 2
    },
    "account.delete": {
        "any": ["注销", "删除账号", "销号", "注销账号"],
        "min_score": 1
    },
    "technical.crash": {
        "any": ["闪退", "崩溃", "白屏", "黑屏", "闪退了", "打不开"],
        "min_score": 1
    },
    "payment.auto_renew": {
        "all": ["自动", "续费"],
        "min_score": 2
    },
    # ... 更多规则
}
```

#### 4.2.3 分类器调度逻辑

```python
class IntentClassifier:
    """双通道意图分类器"""
    
    async def classify(
        self, 
        query: str, 
        context: SessionContext
    ) -> IntentResult:
        # 1. 先走快速关键词匹配（<10ms）
        keyword_result = self._keyword_match(query)
        if keyword_result and keyword_result.confidence >= 0.9:
            return keyword_result
        
        # 2. LLM 分类（主通道）
        try:
            llm_result = await self._llm_classify(query, context)
            if llm_result.confidence >= 0.6:
                return llm_result
        except LLMException:
            pass  # 降级到关键词结果
        
        # 3. 合并结果，取置信度更高的
        if keyword_result and llm_result:
            return keyword_result if keyword_result.confidence > llm_result.confidence else llm_result
        
        # 4. 都失败，返回兜底
        return keyword_result or llm_result or IntentResult(
            intent_code="other.unknown",
            confidence=0.0,
            needs_human=True
        )
```

### 4.3 实体抽取

从用户消息中提取关键业务实体，辅助精准路由：

| 实体类型 | 示例 | 用途 |
|----------|------|------|
| `order_id` | ORD20260620XXXX | 自动关联支付系统查询订单状态 |
| `member_level` | VIP/钻石会员 | 判断是否优先处理 |
| `subject` | 数学/英语/物理 | 路由到学科内容组 |
| `textbook_version` | 人教版/北师大版 | 定位内容问题 |
| `grade` | 初一/高三 | 确认适用范围 |
| `amount` | 98元/198元 | 退款相关金额 |
| `device_info` | iPhone 15 / 小米14 | 技术问题诊断 |
| `date` | 昨天/6月15日 | 时间范围定位 |

---

## 5. 知识检索层（RAG）

### 5.1 检索策略

采用 **混合检索** 策略，结合语义检索和关键词检索：

```python
class KnowledgeRetriever:
    """客服知识混合检索器"""
    
    async def retrieve(
        self,
        query: str,
        intent_code: str | None = None,
        user_context: UserContext = None,
        top_k: int = 5
    ) -> list[KnowledgeHit]:
        
        # 并行执行两路检索
        semantic_task = self._semantic_search(query, top_k=top_k * 2)
        keyword_task = self._keyword_search(query, top_k=top_k * 2)
        
        semantic_hits, keyword_hits = await asyncio.gather(
            semantic_task, keyword_task
        )
        
        # 融合排序
        merged = self._merge_results(
            semantic_hits, keyword_hits,
            weights=(0.65, 0.35)  # 语义检索权重更高
        )
        
        # 意图过滤 boost
        if intent_code:
            merged = self._intent_boost(merged, intent_code)
        
        # 角色过滤
        if user_context:
            merged = self._role_filter(merged, user_context.role)
        
        # 质量分过滤
        merged = [h for h in merged if h.quality_score >= 0.3]
        
        return merged[:top_k]
```

### 5.2 向量索引管理

```python
class KnowledgeIndexManager:
    """知识库向量索引管理"""
    
    INDEX_NAME = "ics_knowledge"
    EMBEDDING_DIM = 1024  # 使用 bge-large-zh-v1.5
    
    async def index_item(self, item: KnowledgeItem) -> None:
        """新知识入库时自动向量化"""
        embedding = await self.embedding_client.embed(
            text=f"{item.title}\n{item.summary or item.content[:500]}",
            model=self.EMBEDDING_MODEL
        )
        
        await self.vector_store.upsert(
            index=self.INDEX_NAME,
            id=item.id,
            vector=embedding,
            payload={
                "title": item.title,
                "type": item.type,
                "category": item.category_path,
                "tags": item.tags,
                "quality_score": item.quality_score,
                "status": item.status
            }
        )
    
    async def reindex_batch(self, batch_size: int = 100) -> int:
        """批量重建索引（数据迁移/模型升级时使用）"""
        total = 0
        async for batch in self._iter_active_items(batch_size):
            embeddings = await self.embedding_client.embed_batch(
                texts=[self._build_text(i) for i in batch]
            )
            await self.vector_store.upsert_batch(
                index=self.INDEX_NAME,
                items=[
                    {"id": i.id, "vector": emb, "payload": self._build_payload(i)}
                    for i, emb in zip(batch, embeddings)
                ]
            )
            total += len(batch)
        return total
```

### 5.3 Elasticsearch 关键词检索

```json
// Elasticsearch 索引映射 ics_knowledge
{
  "mappings": {
    "properties": {
      "title": {
        "type": "text",
        "analyzer": "ik_max_word",
        "search_analyzer": "ik_smart"
      },
      "content": {
        "type": "text",
        "analyzer": "ik_max_word"
      },
      "summary": {
        "type": "text",
        "analyzer": "ik_max_word"
      },
      "tags": {
        "type": "keyword"
      },
      "category_path": {
        "type": "keyword"
      },
      "quality_score": {
        "type": "rank_feature"
      },
      "type": {
        "type": "keyword"
      },
      "status": {
        "type": "keyword"
      }
    }
  }
}
```

---

## 6. 对话编排引擎

### 6.1 Prompt 场景模板

客服场景的 Prompt 与教育辅导完全不同，使用独立模板体系：

```python
CUSTOMER_SERVICE_SYSTEM_PROMPT = """你是 PrimeTop（启硕）学习APP的智能客服助手。你的职责是帮助用户解决使用中遇到的问题。

## 你的能力边界
- 你可以回答：账号问题、支付/退款、功能使用指导、技术故障排查、内容反馈等
- 你不能做：直接操作退款、修改用户数据、透露其他用户信息、承诺非官方政策
- 涉及退款/隐私/安全的问题，如果无法自动解决，必须引导转人工

## 回答规范
1. 态度友好、表达简洁、给出明确操作步骤
2. 如果涉及操作路径，请给出具体的页面路径（如 首页 → 我的 → 设置）
3. 如果需要用户提供信息，请明确列出需要什么
4. 不要编造不存在的功能或政策
5. 如果不确定，说"我帮您转接人工客服进一步确认"

## 当前用户信息
- 用户角色：{user_role}
- 年级：{user_grade}
- 会员等级：{member_level}
- APP版本：{app_version}
- 设备：{device_info}

## 相关知识参考
{retrieved_knowledge}

## 历史对话
{dialogue_history}

## 意图分析
- 意图：{intent_code}（置信度：{intent_confidence}）
- 抽取实体：{entities}
"""

RESOLUTION_CHECK_PROMPT = """请判断以下客服对话是否已经解决了用户的问题。

## 对话内容
{dialogue}

## 判断标准
- "已解决"：用户表示满意/感谢/理解，或用户主动结束对话
- "未解决"：用户仍表示困惑/不满，或追问新的细节
- "需人工"：用户明确要求人工客服，或涉及退款等AI无法操作的事项

输出 JSON：
{{
    "resolution_status": "resolved" | "unresolved" | "needs_human",
    "confidence": 0.0-1.0,
    "reason": "判断依据"
}}
"""
```

### 6.2 对话编排状态机

```
                    ┌─────────────┐
                    │   IDLE      │
                    └──────┬──────┘
                           │ 用户首条消息
                           ▼
                    ┌─────────────┐
                    │ CLASSIFYING │  意图分类 + 实体抽取
                    └──────┬──────┘
                           │
              ┌────────────┼──────────────┐
              │            │              │
    confidence<0.4    confidence≥0.4   needs_human=true
              │            │              │
              ▼            ▼              ▼
        ┌──────────┐ ┌──────────┐  ┌──────────┐
        │ CLARIFY  │ │ RETRIEVE │  │ ESCALATE │
        │ 澄清意图  │ │ 检索知识  │  │ 直接升级  │
        └────┬─────┘ └────┬─────┘  └──────────┘
             │             │
             │ 澄清后      │
             ▼             ▼
        ┌──────────┐ ┌──────────────┐
        │CLASSIFYING│ │ GENERATING   │
        │(重新分类) │ │ 生成AI回复   │
        └──────────┘ │ (流式SSE)    │
                     └──────┬───────┘
                            │
                    ┌───────▼───────┐
                    │  CHECKING     │  解决判定
                    └───────┬───────┘
                            │
              ┌─────────────┼──────────────┐
              │             │              │
          resolved      unresolved     needs_human
              │             │              │
              ▼             ▼              ▼
        ┌──────────┐ ┌──────────┐   ┌──────────┐
        │FEEDBACK  │ │ 检查轮次 │   │ESCALATE  │
        │ 满意度   │ │ ≤max?   │   │ 升级人工  │
        └──────────┘ └────┬─────┘   └──────────┘
                           │
                   ┌───────┴───────┐
                   │               │
                  是               否
                   │               │
                   ▼               ▼
             ┌──────────┐   ┌──────────┐
             │RETRIEVE  │   │ESCALATE  │
             │ 继续对话  │   │ 升级人工  │
             └──────────┘   └──────────┘
```

### 6.3 对话编排核心代码

```python
class DialogueOrchestrator:
    """客服对话编排器"""
    
    MAX_AI_TURNS = 5  # 默认最大AI对话轮次
    
    def __init__(
        self,
        classifier: IntentClassifier,
        retriever: KnowledgeRetriever,
        llm_client: LLMClient,
        resolution_detector: ResolutionDetector,
        sentiment_analyzer: SentimentAnalyzer,
        ticket_builder: TicketBuilder,
        router: SmartRouter,
    ):
        self.classifier = classifier
        self.retriever = retriever
        self.llm_client = llm_client
        self.resolution_detector = resolution_detector
        self.sentiment_analyzer = sentiment_analyzer
        self.ticket_builder = ticket_builder
        self.router = router
    
    async def handle_user_message(
        self, 
        session: IcsSession, 
        user_message: str
    ) -> AsyncIterator[str]:
        """处理用户消息，流式返回AI回复"""
        
        # 1. 保存用户消息
        await self._save_message(session.id, "user", user_message)
        
        # 2. 意图分类（仅首轮或重新分类时）
        if not session.primary_intent or session.message_count <= 1:
            intent_result = await self.classifier.classify(
                query=user_message,
                context=SessionContext.from_session(session)
            )
            session.primary_intent = intent_result.intent_code
            session.intent_confidence = intent_result.confidence
            session.entities = intent_result.entities
            
            # 高紧急度立即升级
            if intent_result.needs_human or intent_result.urgency in ("high", "urgent"):
                yield await self._escalate_to_human(session, reason="intent_high_urgency")
                return
        else:
            intent_result = None
        
        # 3. 知识检索
        knowledge_hits = await self.retriever.retrieve(
            query=user_message,
            intent_code=session.primary_intent,
            user_context=UserContext.from_session(session)
        )
        
        if not knowledge_hits:
            # 无知识命中，检查轮次
            if session.ai_turn_count >= self.MAX_AI_TURNS:
                yield await self._escalate_to_human(session, reason="max_turns_no_knowledge")
                return
        
        # 4. 构建 Prompt
        prompt = self._build_prompt(session, user_message, knowledge_hits)
        
        # 5. 流式生成回复
        full_reply = []
        async for chunk in self.llm_client.stream_chat(
            model=self._select_model(session),
            messages=prompt,
            temperature=0.3,  # 客服场景需要确定性
            max_tokens=800
        ):
            full_reply.append(chunk)
            yield chunk  # SSE 流式推送
        
        reply_text = "".join(full_reply)
        
        # 6. 保存AI消息
        await self._save_message(
            session_id=session.id,
            role="assistant",
            content=reply_text,
            cited_sources=[h.to_dict() for h in knowledge_hits[:3]]
        )
        
        # 7. 解决判定（每轮都检查）
        resolution = await self.resolution_detector.check(session)
        
        if resolution.status == "resolved":
            # 标记解决，发送满意度评价
            await self._mark_resolved(session, resolved_by="ai_auto")
            yield self._render_satisfaction_card(session)
            
        elif resolution.status == "needs_human" or \
             session.ai_turn_count >= self.MAX_AI_TURNS:
            # 超过最大轮次或判定需人工
            yield await self._escalate_to_human(session, reason="ai_limit_reached")
        
        else:
            # 未解决但可继续对话
            session.ai_turn_count += 1
            await session.save()
    
    async def _escalate_to_human(
        self, 
        session: IcsSession, 
        reason: str
    ) -> str:
        """升级到人工客服"""
        # 情感分析判定紧急度
        sentiment = await self.sentiment_analyzer.analyze(session)
        session.sentiment_score = sentiment.score
        
        # 自动生成工单
        ticket = await self.ticket_builder.build_from_session(session, reason)
        
        # 智能路由
        route_result = self.router.route(ticket, session)
        
        # 更新会话状态
        session.status = "escalated"
        session.related_ticket_id = ticket.id
        await session.save()
        
        # 推送通知给客服组
        await self._notify_agent_group(route_result, ticket)
        
        return self._render_escalation_card(
            ticket_no=ticket.ticket_no,
            estimated_wait=route_result.estimated_wait,
            group_name=route_result.group_name
        )
```

---

## 7. 解决判定器

### 7.1 解决判定策略

```python
class ResolutionDetector:
    """对话解决状态判定器"""
    
    RESOLUTION_PATTERNS = [
        # 用户表达满意/感谢
        r"(?:谢谢|感谢|好的|明白了|懂了|收到|谢谢.*帮|解决了|可以了|没问题)",
        # 用户主动结束
        r"(?:没事了|不用了|算了|好的.*再见|拜拜)",
    ]
    
    ESCALATION_PATTERNS = [
        # 用户要求人工
        r"(?:人工|真人客服|人工客服|找客服|转人工|接线员)",
        # 用户表达不满
        r"(?:没解决|没用|不行|垃圾|什么破|投诉|差评|什么垃圾)",
    ]
    
    async def check(self, session: IcsSession) -> ResolutionResult:
        """判断会话解决状态"""
        recent_messages = await self._get_recent_messages(session.id, limit=6)
        last_user_msg = self._get_last_user_message(recent_messages)
        
        if not last_user_msg:
            return ResolutionResult(status="unresolved", confidence=0.0)
        
        # 快速规则匹配
        if self._match_escalation(last_user_msg):
            return ResolutionResult(
                status="needs_human", 
                confidence=0.9,
                reason="用户要求人工或表达不满"
            )
        
        if self._match_resolved(last_user_msg):
            return ResolutionResult(
                status="resolved",
                confidence=0.85,
                reason="用户表达满意或理解"
            )
        
        # LLM 判定（复杂场景）
        if session.ai_turn_count >= 3:
            return await self._llm_check(session, recent_messages)
        
        return ResolutionResult(status="unresolved", confidence=0.3)
```

---

## 8. 智能路由引擎

### 8.1 路由决策模型

```python
class SmartRouter:
    """工单智能路由引擎"""
    
    async def route(
        self, 
        ticket: SupportTicket, 
        session: IcsSession
    ) -> RouteResult:
        """根据多维度信号决策路由目标"""
        
        signals = RouteSignals(
            intent_code=session.primary_intent,
            urgency=session.urgency_level,
            sentiment=session.sentiment_score,
            user_role=session.user_role,
            user_member_level=session.user_member_level,
            entities=session.entities,
            time_of_day=datetime.now().hour,
        )
        
        # 1. 意图配置直匹配
        intent_config = await self._get_intent_config(session.primary_intent)
        if intent_config and intent_config.route_target:
            target_group = intent_config.route_target
            estimated_wait = await self._estimate_wait(target_group)
            return RouteResult(
                group_name=target_group,
                estimated_wait=estimated_wait,
                priority=intent_config.sla_priority,
                route_reason="intent_config_match",
                signals=signals
            )
        
        # 2. 综合评分路由
        candidate_groups = await self._get_available_groups()
        scores = []
        for group in candidate_groups:
            score = await self._compute_match_score(group, signals)
            scores.append((group, score))
        
        scores.sort(key=lambda x: x[1], reverse=True)
        best_group, best_score = scores[0]
        
        return RouteResult(
            group_name=best_group.code,
            estimated_wait=await self._estimate_wait(best_group.code),
            priority=self._derive_priority(signals),
            route_reason="score_based",
            confidence=best_score,
            signals=signals
        )
    
    async def _compute_match_score(
        self, 
        group: AgentGroup, 
        signals: RouteSignals
    ) -> float:
        """计算工单与客服组的匹配分数"""
        score = 0.0
        
        # 技能匹配 (权重 0.4)
        skill_overlap = self._skill_match(group.skills, signals.intent_code)
        score += skill_overlap * 0.4
        
        # 当前负载 (权重 0.25) - 空闲率越高越好
        availability = await self._get_group_availability(group.id)
        score += availability * 0.25
        
        # SLA 历史 (权重 0.2) - 该组处理同类问题的SLA达标率
        sla_rate = await self._get_group_sla_rate(group.id, signals.intent_code)
        score += sla_rate * 0.2
        
        # VIP 优先 (权重 0.15) - 有VIP处理能力的组优先
        if signals.user_member_level in ("diamond", "gold"):
            vip_capable = 1.0 if group.has_vip_skill else 0.5
            score += vip_capable * 0.15
        
        return score
```

### 8.2 路由规则矩阵

| 意图 | 默认路由组 | 升级条件 | VIP路由 |
|------|-----------|----------|---------|
| payment.refund | cs_payment | 金额>500元→cs_senior | cs_vip |
| account.security | cs_security | 疑似被盗→cs_security+tech | cs_vip |
| learning.* | cs_content | 内容错误→content_review | cs_content_vip |
| technical.crash | cs_technical | 批量闪退→cs_senior+dev_oncall | cs_vip |
| parent.* | cs_family | 投诉→cs_senior | cs_family_vip |
| other.complaint | cs_senior | 始终高级 | cs_vip |
| other.business | cs_business | — | cs_business |

---

## 9. 客服辅助引擎

### 9.1 实时推荐架构

当人工客服接管工单后，ICS 持续提供 AI 辅助：

```python
class AgentAssistEngine:
    """客服辅助引擎"""
    
    async def assist(
        self, 
        ticket_id: int, 
        agent_id: int,
        trigger: str  # "ticket_opened" | "user_replied" | "manual_request"
    ) -> list[AssistSuggestion]:
        suggestions = []
        
        # 并行获取多种辅助
        tasks = [
            self._suggest_reply(ticket_id),
            self._find_similar_cases(ticket_id),
            self._recommend_faq(ticket_id),
            self._analyze_sentiment(ticket_id),
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for result in results:
            if isinstance(result, AssistSuggestion) and result:
                suggestions.append(result)
        
        # 记录辅助历史
        await self._log_assists(ticket_id, agent_id, suggestions)
        
        return suggestions
    
    async def _suggest_reply(self, ticket_id: int) -> AssistSuggestion:
        """根据工单内容生成建议回复"""
        ticket = await self.ticket_service.get(ticket_id)
        recent_messages = await self.message_service.get_recent(ticket_id, limit=4)
        
        # 检索相关知识
        knowledge = await self.retriever.retrieve(
            query=ticket.description,
            top_k=3
        )
        
        # 生成建议回复
        prompt = ASSIST_REPLY_PROMPT.format(
            ticket_summary=ticket.summary,
            user_messages=recent_messages,
            knowledge=[k.content[:500] for k in knowledge],
            user_role=ticket.user_role
        )
        
        suggested_reply = await self.llm_client.complete(
            prompt=prompt,
            temperature=0.4,
            max_tokens=400
        )
        
        return AssistSuggestion(
            type="suggested_reply",
            content={
                "reply_text": suggested_reply,
                "confidence": 0.75,
                "editable": True
            }
        )
    
    async def _find_similar_cases(self, ticket_id: int) -> AssistSuggestion:
        """查找相似历史工单"""
        ticket = await self.ticket_service.get(ticket_id)
        
        # 向量检索相似工单
        similar = await self.vector_store.search(
            index="resolved_tickets",
            query_text=ticket.description,
            top_k=5,
            score_threshold=0.75,
            filters={"status": "closed", "category_l1": ticket.category_l1}
        )
        
        return AssistSuggestion(
            type="similar_case",
            content={
                "cases": [
                    {
                        "ticket_no": s.payload["ticket_no"],
                        "title": s.payload["title"],
                        "resolution": s.payload["resolution_summary"],
                        "similarity": s.score
                    }
                    for s in similar
                ]
            }
        )
```

### 9.2 客服辅助 UI 推送

```json
// WebSocket 推送给客服工作台的辅助建议
{
    "event": "agent_assist",
    "data": {
        "ticket_id": 12345,
        "suggestions": [
            {
                "type": "suggested_reply",
                "content": {
                    "reply_text": "您好，关于会员退款，如果您的订单在7天内...",
                    "confidence": 0.82,
                    "editable": true
                }
            },
            {
                "type": "similar_case",
                "content": {
                    "cases": [
                        {
                            "ticket_no": "TK-20260615-001234",
                            "title": "钻石会员退款咨询",
                            "resolution": "引导用户在我的-订单页面申请，3-5工作日到账",
                            "similarity": 0.91
                        }
                    ]
                }
            },
            {
                "type": "sentiment_alert",
                "content": {
                    "current_sentiment": -0.35,
                    "trend": "declining",
                    "suggestion": "用户情绪不佳，建议优先处理并使用安抚话术"
                }
            }
        ]
    }
}
```

---

## 10. 知识自学习管线

### 10.1 从已解决工单提取知识

```python
class KnowledgeExtractionPipeline:
    """从已解决工单中自动提取问答对"""
    
    BATCH_SCHEDULE = "0 0 3 * * ?"  # 每天凌晨3点执行
    
    async def run_daily_extraction(self):
        """每日批处理：从昨日已解决工单中提取知识"""
        
        # 1. 获取昨日已解决的工单
        tickets = await self.ticket_repo.find_resolved_since(
            since=days_ago(1),
            min_quality_score=4.0  # 满意度≥4星的工单
        )
        
        for ticket in tickets:
            try:
                # 2. LLM 提取问答对
                qa_pairs = await self._extract_qa_from_ticket(ticket)
                
                for qa in qa_pairs:
                    # 3. 去重检查
                    if await self._is_duplicate(qa):
                        continue
                    
                    # 4. 质量评估
                    quality = await self._assess_quality(qa)
                    if quality.score < 0.6:
                        continue
                    
                    # 5. 入库（草稿状态，待人工审核）
                    await self._create_knowledge_item(
                        type="resolved_ticket",
                        source_id=ticket.id,
                        title=qa.question,
                        content=qa.answer,
                        summary=qa.summary,
                        tags=qa.tags,
                        auto_extracted=True,
                        extract_confidence=quality.score,
                        status="draft"
                    )
                
            except Exception as e:
                logger.error(f"Failed to extract from ticket {ticket.id}: {e}")
    
    async def _extract_qa_from_ticket(
        self, 
        ticket: SupportTicket
    ) -> list[QA Pair]:
        """使用 LLM 从工单对话中提取问答对"""
        
        dialogue = await self._get_ticket_dialogue(ticket.id)
        
        prompt = f"""请分析以下客服工单对话，提取可以加入客服知识库的问答对。

## 工单信息
- 标题：{ticket.title}
- 分类：{ticket.category_l1} / {ticket.category_l2}

## 对话内容
{dialogue}

## 提取要求
1. 只提取有通用价值的问答（不适合只针对单个用户的特殊问题）
2. 问题应该是用户可能反复问的常见问题
3. 答案应该基于客服的实际回复，可适当概括
4. 生成合适的标签和分类

输出 JSON 数组：
[
    {{
        "question": "问题标题",
        "answer": "标准答案（Markdown格式）",
        "summary": "一句话摘要",
        "tags": ["标签1", "标签2"],
        "category": "建议分类路径"
    }}
]
"""
        result = await self.llm_client.complete(
            prompt=prompt,
            temperature=0.2,
            max_tokens=2000,
            response_format="json"
        )
        
        return [QAPair(**item) for item in json.loads(result)]
```

### 10.2 知识质量自动评估

```python
class KnowledgeQualityAssessor:
    """评估自动提取的知识条目质量"""
    
    async def assess(self, qa: QAPair) -> QualityAssessment:
        score = 0.0
        checks = []
        
        # 1. 完整性检查：问题和答案都足够完整
        completeness = self._check_completeness(qa)
        checks.append(("completeness", completeness))
        
        # 2. 准确性检查：与已有知识库不矛盾
        consistency = await self._check_consistency(qa)
        checks.append(("consistency", consistency))
        
        # 3. 通用性检查：不包含过多特定用户信息
        generality = self._check_generality(qa)
        checks.append(("generality", generality))
        
        # 4. 简洁性检查：答案不过长
        conciseness = self._check_conciseness(qa)
        checks.append(("conciseness", conciseness))
        
        # 加权综合
        weights = {"completeness": 0.3, "consistency": 0.3, 
                   "generality": 0.25, "conciseness": 0.15}
        score = sum(checks_map[k] * weights[k] for k in checks_map)
        
        return QualityAssessment(
            score=score,
            details=checks,
            recommend=(score >= 0.7)
        )
```

---

## 11. API 接口设计

### 11.1 对话接口（SSE 流式）

```
POST /api/v1/ics/chat
Content-Type: application/json
Accept: text/event-stream

Request:
{
    "session_token": "ics_xxxx",       // 可选，首次对话不传
    "message": "我买的会员怎么退款",
    "source": "help_center",
    "user_context": {
        "role": "parent",
        "grade": "初二",
        "member_level": "gold"
    }
}

Response (SSE):
event: session
data: {"session_token": "ics_20260620_xxxx", "is_new": true}

event: intent
data: {"intent_code": "payment.refund", "confidence": 0.92}

event: token
data: {"content": "您"}

event: token
data: {"content": "好"}

event: token
data: {"content": "，"}

event: token
data: {"content": "关于会员退款"}

...

event: sources
data: {"cited": [{"type": "faq", "title": "会员退款政策", "id": 42}]}

event: done
data: {
    "message_id": 12345,
    "can_continue": true,
    "turn_count": 1,
    "max_turns": 5
}
```

### 11.2 会话历史接口

```
GET /api/v1/ics/sessions/{session_token}/messages?limit=20&before_id=100

Response:
{
    "code": 0,
    "data": {
        "messages": [
            {
                "id": 101,
                "role": "user",
                "content": "我买的会员怎么退款",
                "created_at": "2026-06-20T10:30:00.000Z"
            },
            {
                "id": 102,
                "role": "assistant",
                "content": "您好，关于会员退款...",
                "cited_sources": [...],
                "created_at": "2026-06-20T10:30:02.000Z"
            }
        ],
        "has_more": false
    }
}
```

### 11.3 满意度评价接口

```
POST /api/v1/ics/sessions/{session_token}/feedback

Request:
{
    "score": 5,
    "tag": "helpful",       // helpful | not_helpful | slow | incorrect
    "comment": "回答很详细"
}

Response:
{
    "code": 0,
    "data": {"received": true}
}
```

### 11.4 转人工接口

```
POST /api/v1/ics/sessions/{session_token}/escalate

Request:
{
    "reason": "user_request"   // user_request | ai_limit | policy
}

Response:
{
    "code": 0,
    "data": {
        "ticket_no": "TK-20260620-001234",
        "target_group": "客服-支付组",
        "estimated_wait_minutes": 5,
        "queue_position": 3
    }
}
```

### 11.5 客服辅助接口（WebSocket）

```
WS /api/v1/ics/agent-assist?ticket_id=12345&agent_id=678

# 服务端推送
{"event": "assist", "type": "suggested_reply", "data": {...}}
{"event": "assist", "type": "similar_case", "data": {...}}
{"event": "assist", "type": "sentiment_alert", "data": {...}}

# 客服端请求
{"action": "refresh_assist", "trigger": "user_replied"}
{"action": "feedback", "suggestion_id": "xxx", "adopted": true}
```

### 11.6 知识管理接口

```
# 搜索客服知识（管理后台用）
GET /api/v1/admin/ics/knowledge/search?keyword=退款&type=faq&status=active&page=1

# 创建/更新知识条目
POST /api/v1/admin/ics/knowledge
PUT  /api/v1/admin/ics/knowledge/{id}

# 审核自动提取的知识
POST /api/v1/admin/ics/knowledge/{id}/review
Request: {"action": "approve"|"reject", "reason": "..."}

# 意图配置管理
GET  /api/v1/admin/ics/intents
POST /api/v1/admin/ics/intents
PUT  /api/v1/admin/ics/intents/{id}

# 统计看板
GET /api/v1/admin/ics/stats?period=2026-06
Response:
{
    "total_sessions": 15234,
    "auto_resolved": 8378,
    "auto_resolve_rate": 0.55,
    "escalated": 6856,
    "avg_ai_turns": 2.3,
    "avg_first_response_ms": 850,
    "satisfaction_avg": 4.2,
    "top_intents": [
        {"intent_code": "payment.refund", "count": 3214, "resolve_rate": 0.42},
        {"intent_code": "technical.crash", "count": 2156, "resolve_rate": 0.28}
    ],
    "knowledge_growth": 234
}
```

---

## 12. 状态流转定义

### 12.1 会话状态机

```
                         用户首条消息
                              │
                              ▼
                     ┌─── active ───┐
                     │              │
              ┌──────┤              ├──────┐
              │      │              │      │
              ▼      └──────────────┘      ▼
        resolved                    escalated
        (AI解决)                     (转人工)
              │                             │
              ▼                             ▼
        FEEDBACK收集                   关联工单处理
              │                             │
       ┌──────┴──────┐              工单关闭后
       │             │                     │
    满意          不满意                    ▼
       │             │               session 关闭
       ▼             ▼
   closed      re-active?
                   │
                   ▼
              重新进入active
              (新问题继续问)

  其他终态:
  ┌──────────┐  ┌──────────┐
  │ timeout  │  │abandoned │
  │(15分钟无  │  │(用户离开) │
  │ 操作)    │  │          │
  └──────────┘  └──────────┘
```

### 12.2 会话超时策略

| 场景 | 超时时间 | 处理 |
|------|---------|------|
| 用户15分钟无回复 | 15min | 标记 timeout，推送"是否还需要帮助" |
| 用户点击"没有了" | 即时 | 关闭会话，请求满意度评价 |
| AI连续3轮无法解决 | 3轮 | 自动升级人工 |
| 会话总时长>30分钟 | 30min | 主动询问是否转人工 |

---

## 13. 错误处理与降级策略

### 13.1 LLM 调用降级链

```python
class LLMFallbackChain:
    """LLM 调用降级链"""
    
    MODELS = [
        {"model": "gpt-4o-mini", "max_tokens": 800, "timeout": 8},
        {"model": "glm-4-flash", "max_tokens": 800, "timeout": 8},
        {"model": "qwen-turbo", "max_tokens": 600, "timeout": 6},
    ]
    
    async def complete_with_fallback(
        self, 
        prompt: str, 
        **kwargs
    ) -> str:
        last_error = None
        
        for model_config in self.MODELS:
            try:
                result = await self.llm_client.complete(
                    model=model_config["model"],
                    prompt=prompt,
                    timeout=model_config["timeout"],
                    **kwargs
                )
                return result
            except (TimeoutException, LLMException) as e:
                logger.warning(f"Model {model_config['model']} failed: {e}")
                last_error = e
                continue
        
        # 所有模型都失败
        raise AllModelsFailedError(last_error)
```

### 13.2 全链路降级矩阵

| 故障点 | 降级策略 | 用户感知 |
|--------|---------|----------|
| LLM 全部不可用 | 关键词匹配 + 模板回复 + 直接转人工 | "客服繁忙，已为您创建工单" |
| 向量检索不可用 | 仅 Elasticsearch 关键词检索 | 结果相关性可能下降 |
| Elasticsearch 不可用 | 仅向量检索 | 关键词匹配缺失 |
| 全部检索不可用 | LLM 基于通用知识回复 + 标注"仅供参考" | 回复可能不够精准 |
| 意图分类器不可用 | 关键词兜底规则 | 分类准确率下降 |
| 情感分析不可用 | 跳过，使用默认情感分 0 | 不影响核心流程 |
| 解决判定不可用 | 使用轮次限制（3轮后升级） | 可能过早转人工 |
| 工单系统不可用 | ICS 内部排队 + 告警运维 | 用户看到"已为您记录" |

### 13.3 限流与保护

```python
# 用户级限流
RATE_LIMITS = {
    "session_per_user_per_day": 20,       # 每人每天最多20次会话
    "messages_per_session": 30,            # 每会话最多30条消息
    "messages_per_minute": 10,             # 每分钟最多10条
    "concurrent_sessions_per_user": 1,     # 不允许并发会话
}

# 系统级保护
SYSTEM_PROTECTION = {
    "max_concurrent_llm_calls": 100,       # 全局并发LLM调用上限
    "max_queue_size": 500,                 # 排队上限
    "circuit_breaker_threshold": 0.3,      # 错误率>30%触发熔断
    "circuit_breaker_duration_sec": 60,    # 熔断持续时间
}
```

---

## 14. 缓存设计

### 14.1 多级缓存策略

| 缓存层 | 存储内容 | TTL | 失效策略 |
|--------|---------|-----|----------|
| L1 客户端缓存 | FAQ 列表、热门问题 | 1h | 版本号比对 |
| L2 Redis 缓存 | 意图配置、FAQ详情、Prompt模板 | 30min | 后台更新时主动刷新 |
| L3 本地缓存（Caffeine） | 高频FAQ、分类树 | 5min | 定时刷新 |
| L4 数据库 | 全量数据 | — | 持久化 |

### 14.2 Prompt 模板缓存

```python
@cached(ttl=1800, key="ics:prompt:{scene}:{hash}")
async def get_prompt_template(scene: str, variables: dict) -> str:
    """缓存渲染后的Prompt（相同场景+变量哈希时直接复用）"""
    template = await self.template_service.get(scene)
    return template.render(**variables)
```

---

## 15. 监控与告警

### 15.1 核心监控指标

| 指标 | 告警阈值 | 通知方式 |
|------|---------|----------|
| AI 解决率 5分钟滑动 | < 40% | 钉钉机器人 |
| 首Token延迟 P95 | > 2s | 钉钉 + 电话 |
| LLM 调用错误率 | > 5% | 钉钉机器人 |
| 升级率 5分钟滑动 | > 70% | 钉钉机器人（可能AI出问题） |
| 平均对话轮次 | > 3.5 | 邮件（质量下降预警） |
| 用户满意度均值 | < 3.8 | 邮件 + 周报 |
| 知识库日增长 | < 5 条 | 邮件（提取管线可能异常） |
| 意图分类 Top-1 准确率 | < 80% | 邮件（需检查分类器） |

### 15.2 关键埋点事件

```json
[
    {
        "event": "ics_session_started",
        "properties": ["user_id", "source", "user_role", "user_grade"]
    },
    {
        "event": "ics_intent_classified",
        "properties": ["session_id", "intent_code", "confidence", "method"]
    },
    {
        "event": "ics_ai_reply_sent",
        "properties": ["session_id", "turn", "model", "latency_ms", "cited_count"]
    },
    {
        "event": "ics_resolved",
        "properties": ["session_id", "intent_code", "turns", "duration_sec"]
    },
    {
        "event": "ics_escalated",
        "properties": ["session_id", "reason", "intent_code", "ticket_id"]
    },
    {
        "event": "ics_feedback_received",
        "properties": ["session_id", "score", "tag", "resolved_by"]
    },
    {
        "event": "ics_agent_assist_shown",
        "properties": ["ticket_id", "assist_type", "adopted"]
    },
    {
        "event": "ics_knowledge_auto_extracted",
        "properties": ["ticket_id", "qa_count", "avg_quality"]
    }
]
```

---

## 16. 安全与隐私

### 16.1 数据安全

| 维度 | 措施 |
|------|------|
| 用户身份验证 | 会话必须携带有效 Token，绑定 user_id |
| 敏感信息脱敏 | LLM 输入前对手机号、身份证号、银行卡号脱敏 |
| 对话数据加密 | ics_messages.content 使用应用层 AES-256-GCM 加密存储 |
| 知识库访问控制 | 管理后台基于 RBAC，仅客服管理岗可编辑知识库 |
| 审计日志 | 所有知识库增删改 + 意图配置变更记录审计日志 |
| 数据保留 | 会话数据保留 180 天，超期归档冷存储 |

### 16.2 AI 安全护栏

```python
SAFETY_RULES = {
    "禁止操作": [
        "AI不得承诺具体退款金额或时间",
        "AI不得透露其他用户信息",
        "AI不得对政策做出超出知识库的承诺",
        "AI不得处理涉及未成年人的敏感投诉（必须转人工）"
    ],
    "强制升级": [
        "用户提及法律诉讼/媒体曝光 → immediate_escalate",
        "用户提及自残/自杀等 → immediate_escalate + 危机热线",
        "用户连续2次负反馈 → escalate",
        "疑似钓鱼/欺诈行为 → block + escalate"
    ]
}
```

---

## 17. 部署与容量规划

### 17.1 资源估算（初期）

| 资源 | 估算 | 说明 |
|------|------|------|
| 日均会话量 | ~8,000 | DAU 80K × 10% 帮助中心访问率 |
| 日均消息量 | ~40,000 | 平均5条/会话 |
| LLM 调用/日 | ~50,000 | 含分类+生成+解决判定+辅助 |
| QPS 峰值 | ~200 | 晚高峰 |
| 向量库容量 | ~50,000 条 | 初期 FAQ + 历史工单 |
| Redis 内存 | ~4GB | 会话缓存 + 知识缓存 |
| MySQL 存储 | ~20GB/月 | 会话+消息+知识+日志 |

### 17.2 扩容策略

- **LLM 调用**：多供应商负载均衡，单供应商限流自动切换
- **向量库**：Qdrant 集群分片，按意图大类分 collection
- **Redis**：Cluster 模式，会话数据按 user_id hash 分片
- **MySQL**：读写分离，ics_messages 按月分表

---

## 18. 与现有客服系统的集成改造

### 18.1 改造范围

| 现有组件 | 改造内容 |
|---------|----------|
| 客服与工单系统 | 新增 `source = 'ics_auto'` 来源；工单创建接口增加 AI 预填字段 |
| 帮助中心页面 | 新增 AI 对话入口（浮动按钮）；保留 FAQ 列表作为次选 |
| 意见反馈页面 | 提交前增加 AI 前置拦截（尝试即时解决） |
| 客服工作台 | 新增"AI 建议"侧边栏（实时推荐话术/相似案例） |
| 管理后台 | 新增"智能客服"管理菜单（知识库/意图/统计） |

### 18.2 数据流集成

```
用户进入帮助中心
      │
      ▼
┌─────────────┐    不需要     ┌─────────────┐
│ ICS AI 对话  │─────────────▶│ FAQ 自助浏览 │
│ (首选入口)   │              │ (原有功能)   │
└──────┬──────┘              └─────────────┘
       │ AI无法解决
       ▼
┌─────────────┐    自动填充    ┌─────────────┐
│ 工单自动生成 │──────────────▶│ 客服工单系统 │
│ (预填摘要、  │              │ (原有系统)   │
│  分类、紧急度)│              │             │
└─────────────┘              └──────┬──────┘
                                     │
                              ┌──────▼──────┐
                              │ 客服处理中   │
                              │ +AI辅助推荐  │
                              └──────┬──────┘
                                     │
                                     ▼
                              ┌─────────────┐
                              │ 工单解决     │
                              │ →知识提取管线│
                              │ →反哺知识库  │
                              └─────────────┘
```

---

## 19. 开发优先级

### 19.1 Phase 1（P0 - MVP）

| 功能 | 说明 | 预估工时 |
|------|------|---------|
| 会话管理 + 对话接口 | 基础对话能力（SSE流式） | 5天 |
| 意图分类器（规则版） | 关键词规则分类（15个核心意图） | 3天 |
| 知识检索（FAQ+文章） | Elasticsearch 关键词检索 | 3天 |
| Prompt 模板 | 客服场景系统 Prompt | 2天 |
| 解决判定 | 规则版解决判定 | 2天 |
| 工单自动创建+路由 | 转人工时自动创建工单 | 3天 |
| 帮助中心页改造 | 新增AI对话入口 | 2天 |
| **小计** | | **20天** |

### 19.2 Phase 2（P1）

| 功能 | 说明 | 预估工时 |
|------|------|---------|
| LLM 意图分类 | Few-shot LLM 分类 | 3天 |
| 向量检索 RAG | 语义检索 + 混合排序 | 5天 |
| 情感分析 | 实时情感追踪 | 2天 |
| 客服辅助引擎 | 建议回复+相似案例 | 5天 |
| 知识自动提取 | 工单→知识管线 | 4天 |
| 统计看板 | 管理后台数据面板 | 3天 |
| **小计** | | **22天** |

### 19.3 Phase 3（P2）

| 功能 | 说明 |
|------|------|
| 多语言支持 | 英文/繁体客服 |
| 语音输入 | 用户可语音描述问题 |
| 主动服务 | 基于用户行为主动触发关怀对话 |
| 智能质检 | AI 抽检客服对话质量 |
| 预测性工单 | 异常事件批量预警工单 |

---

## 20. 附录

### 20.1 典型对话流程示例

**场景：用户咨询会员退款**

```
用户: 我昨天不小心买了会员，能退吗？

[ICS 后端]
→ 意图分类: payment.refund (confidence: 0.93)
→ 实体抽取: {"member_level":"未知","amount":"未知","date":"昨天"}
→ 知识检索: 命中 FAQ #42 "会员退款政策" (score: 0.96)

AI: 您好！PrimeTop 会员支持 7 天无理由退款。
    请提供一下您的订单号（格式如 ORD 开头），我帮您查看具体订单信息。
    您也可以在「我的 → 订单记录」中找到订单号。

用户: 订单号是 ORD202606198765

[ICS 后端]
→ 实体补全: {"order_id":"ORD202606198765"}
→ 查询订单: 调用支付服务，订单金额 ¥198，6月19日购买，Gold会员
→ 知识检索: 命中 FAQ #43 "退款到账时间" (score: 0.91)

AI: 已找到您的订单：
    - 订单号：ORD202606198765
    - 商品：Gold 月卡会员
    - 金额：¥198
    - 购买时间：2026-06-19
    
    该订单符合 7 天无理由退款条件。请问您要申请退款吗？

用户: 是的，帮我退了吧

[ICS 后端]
→ 解决判定: needs_human（退款操作AI无法直接执行）
→ 工单自动生成: {
    "category": "支付/退款",
    "priority": "normal",
    "title": "Gold会员退款-ORD202606198765",
    "description": "用户申请退款，订单ORD202606198765，¥198，符合7天退款",
    "entities": {"order_id": "ORD202606198765", "amount": 198}
  }
→ 路由: cs_payment 组
→ 推送通知给客服

AI: 已为您创建退款工单（TK-20260620-001234），
    已分配给我们的支付客服团队，预计 5 分钟内有人处理。
    退款将在 3-5 个工作日内原路返回。
    您可以在「我的 → 意见反馈 → 工单记录」中查看进度。
```

### 20.2 术语表

| 术语 | 说明 |
|------|------|
| ICS | Intelligent Customer Service，智能客服引擎 |
| 自助解决率 | AI 独立解决、无需转人工的会话占比 |
| AHT | Average Handling Time，平均处理时长 |
| 解决判定 | 判断用户问题是否已被解决的分析过程 |
| 知识提取 | 从已解决工单中自动提炼问答对的过程 |
| Agent Assist | 客服辅助，为人工客服提供AI建议 |
| 路由 | 将工单分配到合适的客服组的过程 |

---

> 本文档为 PrimeTop 智能客服引擎的详细设计规范，供后端开发、AI 工程、前端、客服产品经理及测试团队参考。
