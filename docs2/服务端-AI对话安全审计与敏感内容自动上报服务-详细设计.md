# 服务端-AI对话安全审计与敏感内容自动上报服务-详细设计

## 1. 概述

### 1.1 文档目的

本文档详细设计 PrimeTop 平台的 AI 对话安全审计与敏感内容自动上报服务。作为面向未成年人（3-18岁）的教育产品，实时监控 AI 对话中的安全风险、自动识别和上报敏感内容，是合规运营和未成年人保护的刚需。

### 1.2 背景

- 《未成年人保护法》要求网络产品对未成年人提供安全保护
- 《儿童个人信息网络保护规定》要求对儿童内容进行安全管控
- 学生在 AI 对话中可能暴露心理危机信号（自伤、抑郁、校园霸凌等）
- AI 模型可能产生不适宜未成年人的输出内容
- 需要建立完整的对话安全审计链路，做到"可检测、可上报、可追溯"

### 1.3 设计目标

1. **实时检测**：对每轮 AI 对话进行实时安全扫描，延迟 < 200ms
2. **分级响应**：按风险等级执行不同的处置策略
3. **自动上报**：高危内容自动触发人工审核工单
4. **合规审计**：所有安全事件可追溯、可导出、可审计
5. **隐私保护**：安全审计过程本身也需符合数据最小化原则

### 1.4 与现有系统的关系

| 已有系统 | 与本服务的交互 |
| --- | --- |
| 安全与内容合规系统 | 本服务是其在 AI 对话场景的专项深化 |
| AI输入安全与教育对话护栏引擎 | 护栏引擎负责前置拦截，本服务负责全链路审计 |
| AI输出质量校验与多模型复核引擎 | 输出校验侧重准确性，本服务侧重安全性 |
| 客服与工单系统 | 高危事件自动创建工单并路由到审核团队 |
| 通知中心与站内消息系统 | 触发家长通知或系统告警 |
| 用户账号体系 | 获取用户年龄、学段信息，影响检测策略 |

---

## 2. 风险分类体系

### 2.1 用户输入侧风险（学生发起）

| 风险类别 | 风险代码 | 典型场景 | 风险等级 |
| --- | --- | --- | --- |
| 自伤/自杀倾向 | `SELF_HARM` | "活着没意思""想死""割腕" | 🔴 P0-致命 |
| 校园霸凌 | `BULLYING` | "被同学打""被孤立""不敢去学校" | 🔴 P0-致命 |
| 身体/性侵害 | `ABUSE` | 暗示遭受侵害、描述不当接触 | 🔴 P0-致命 |
| 抑郁/焦虑情绪 | `MENTAL_HEALTH` | "很焦虑""睡不着""不想见人" | 🟠 P1-高危 |
| 危险行为 | `DANGER_BEHAVIOR` | 提及吸毒、酗酒、危险游戏 | 🟠 P1-高危 |
| 不当内容请求 | `INAPPROPRIATE_REQUEST` | 学生要求 AI 生成暴力/色情内容 | 🟡 P2-中危 |
| 非学习滥用 | `OFF_TOPIC_ABUSE` | 持续闲聊、游戏讨论、非学习内容 | 🟢 P3-低危 |

### 2.2 AI 输出侧风险（模型生成）

| 风险类别 | 风险代码 | 典型场景 | 风险等级 |
| --- | --- | --- | --- |
| 暴力内容 | `VIOLENCE_OUTPUT` | AI 回答包含暴力描写 | 🔴 P0-致命 |
| 色情/性暗示 | `SEXUAL_OUTPUT` | AI 输出含有性暗示内容 | 🔴 P0-致命 |
| 自杀诱导 | `SUICIDE_ENCOURAGE` | AI 未能正确引导自伤话题 | 🔴 P0-致命 |
| 政治敏感 | `POLITICAL_OUTPUT` | 涉及不当政治言论 | 🟠 P1-高危 |
| 错误价值观 | `WRONG_VALUE` | 宣扬不劳而获、歧视等 | 🟡 P2-中危 |
| 超纲内容 | `OUT_OF_SCOPE` | 向低龄学生输出不适龄内容 | 🟡 P2-中危 |

### 2.3 风险等级与处置策略

| 等级 | 响应时间 | 处置策略 | 通知范围 |
| --- | --- | --- | --- |
| 🔴 P0-致命 | 立即（< 1s） | 拦截回复 → 安全话术替代 → 创建紧急工单 → 通知审核主管 | 审核团队 + 产品负责人 + 家长(可选) |
| 🟠 P1-高危 | 准实时（< 5min） | 允许回复但标记 → 创建高优工单 → 24h内人工复核 | 审核团队 |
| 🟡 P2-中危 | 批量（< 1h） | 记录日志 → 批量汇总 → 48h内抽检 | 内容团队(日报) |
| 🟢 P3-低危 | 异步（24h） | 记录日志 → 用于行为分析 → 周报汇总 | 无 |

---

## 3. 系统架构

### 3.1 整体架构

```text
┌─────────────────────────────────────────────────────────────┐
│                      AI 对话引擎                             │
│            (AI辅导对话 / 拍题答疑 / 作文辅导)                  │
└──────────┬──────────────────────────────────┬───────────────┘
           │ 用户消息                          │ AI 回复
           ▼                                  ▼
┌─────────────────────┐          ┌─────────────────────────┐
│  输入安全扫描器       │          │  输出安全扫描器          │
│  (InputSafetyScanner)│          │  (OutputSafetyScanner)  │
└──────────┬──────────┘          └──────────┬──────────────┘
           │                                 │
           ▼                                 ▼
┌──────────────────────────────────────────────────────────┐
│               安全审计引擎 (SafetyAuditEngine)              │
│  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────────────┐  │
│  │关键词匹配│ │ 语义分类器 │ │规则引擎  │ │ 行为模式分析  │  │
│  └─────────┘ └──────────┘ └─────────┘ └──────────────┘  │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│               风险评估与决策引擎 (RiskDecisionEngine)       │
│  ┌───────────┐ ┌────────────┐ ┌────────────────────────┐ │
│  │ 风险分级   │ │ 处置策略选择 │ │ 上下文关联判定         │ │
│  └───────────┘ └────────────┘ └────────────────────────┘ │
└──────────────────────┬───────────────────────────────────┘
                       │
           ┌───────────┼───────────┐
           ▼           ▼           ▼
    ┌──────────┐ ┌──────────┐ ┌──────────────┐
    │ 实时处置器 │ │ 审计记录器 │ │ 上报与通知器  │
    │(RealTime │ │(Audit    │ │(Report       │
    │ Handler) │ │ Logger)  │ │ Notifier)    │
    └──────────┘ └──────────┘ └──────────────┘
```

### 3.2 核心组件职责

| 组件 | 职责 | 部署方式 |
| --- | --- | --- |
| InputSafetyScanner | 扫描用户输入消息 | 同步调用，嵌入对话流程 |
| OutputSafetyScanner | 扫描 AI 输出内容 | 同步调用，嵌入对话流程 |
| SafetyAuditEngine | 多维度安全检测 | 同步检测 + 异步深度分析 |
| RiskDecisionEngine | 风险评估与处置决策 | 同步决策 |
| RealTimeHandler | 执行实时拦截/替换/告警 | 同步执行 |
| AuditLogger | 记录完整审计日志 | 异步写入 |
| ReportNotifier | 创建工单、发送通知 | 异步执行 |

---

## 4. 数据结构定义

### 4.1 安全事件记录（safety_audit_event）

```sql
CREATE TABLE safety_audit_event (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    event_id        VARCHAR(64) NOT NULL UNIQUE COMMENT '事件唯一ID (UUID)',
    
    -- 关联信息
    user_id         BIGINT NOT NULL COMMENT '用户ID',
    conversation_id VARCHAR(64) NOT NULL COMMENT 'AI对话会话ID',
    message_id      VARCHAR(64) NOT NULL COMMENT '消息ID',
    
    -- 检测维度
    scan_direction  ENUM('INPUT', 'OUTPUT') NOT NULL COMMENT '扫描方向: 用户输入/AI输出',
    risk_category   VARCHAR(32) NOT NULL COMMENT '风险类别代码 (SELF_HARM, BULLYING...)',
    risk_level      ENUM('P0', 'P1', 'P2', 'P3') NOT NULL COMMENT '风险等级',
    
    -- 检测结果
    detection_method ENUM('KEYWORD', 'SEMANTIC', 'RULE', 'BEHAVIOR_PATTERN', 'MANUAL') 
                     NOT NULL COMMENT '检测方式',
    confidence_score DECIMAL(5,4) COMMENT '置信度 0.0000-1.0000',
    trigger_details  JSON NOT NULL COMMENT '触发详情 (触发词/匹配规则/模型输出)',
    
    -- 原始内容 (加密存储)
    original_content_hash VARCHAR(64) NOT NULL COMMENT '原始内容SHA256哈希',
    original_content_enc  TEXT COMMENT '原始内容(AES加密), 保留90天',
    
    -- 上下文
    user_age            INT COMMENT '用户年龄(脱敏:仅年龄段)',
    user_grade          VARCHAR(16) COMMENT '学段年级',
    conversation_turn   INT COMMENT '对话轮次',
    recent_events_count INT COMMENT '该用户近7天安全事件计数',
    
    -- 处置结果
    action_taken    VARCHAR(32) NOT NULL COMMENT '处置动作 (BLOCK/REPLACE/FLAG/LOG)',
    replacement_content TEXT COMMENT '替换后的安全话术 (如有)',
    
    -- 工单关联
    ticket_id       VARCHAR(64) COMMENT '关联工单ID',
    
    -- 时间
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '事件创建时间',
    reviewed_at     DATETIME(3) COMMENT '人工复核时间',
    review_result   ENUM('CONFIRMED', 'FALSE_POSITIVE', 'ESCALATED', 'PENDING') 
                    DEFAULT 'PENDING' COMMENT '人工复核结果',
    reviewer_id     BIGINT COMMENT '审核人ID',
    
    -- 索引
    INDEX idx_user_time (user_id, created_at),
    INDEX idx_risk_level_time (risk_level, created_at),
    INDEX idx_category (risk_category),
    INDEX idx_conversation (conversation_id),
    INDEX idx_ticket (ticket_id),
    INDEX idx_review_status (review_result, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI对话安全审计事件表';
```

### 4.2 安全话术配置（safety_response_template）

```sql
CREATE TABLE safety_response_template (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    template_code   VARCHAR(64) NOT NULL UNIQUE COMMENT '话术编码',
    risk_category   VARCHAR(32) NOT NULL COMMENT '适用风险类别',
    risk_level      ENUM('P0', 'P1') NOT NULL COMMENT '适用风险等级',
    
    -- 话术内容
    student_response TEXT NOT NULL COMMENT '对学生展示的回复内容',
    parent_notification TEXT COMMENT '发送给家长的通知内容(如有)',
    
    -- 附加资源
    helpline_info   JSON COMMENT '热线电话/求助资源信息',
    
    -- 状态
    is_active       TINYINT(1) NOT NULL DEFAULT 1,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_category_level (risk_category, risk_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='安全话术模板';
```

### 4.3 用户安全画像（user_safety_profile）

```sql
CREATE TABLE user_safety_profile (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id         BIGINT NOT NULL UNIQUE COMMENT '用户ID',
    
    -- 风险统计
    total_events    INT NOT NULL DEFAULT 0 COMMENT '累计安全事件数',
    p0_events       INT NOT NULL DEFAULT 0 COMMENT 'P0事件数',
    p1_events       INT NOT NULL DEFAULT 0 COMMENT 'P1事件数',
    p2_events       INT NOT NULL DEFAULT 0 COMMENT 'P2事件数',
    
    -- 趋势指标
    events_last_7d  INT NOT NULL DEFAULT 0 COMMENT '近7天事件数',
    events_last_30d INT NOT NULL DEFAULT 0 COMMENT '近30天事件数',
    
    -- 风险评估
    risk_score      DECIMAL(5,2) DEFAULT 0.00 COMMENT '综合风险分 0-100',
    risk_level      ENUM('NORMAL', 'WATCH', 'WARNING', 'CRITICAL') 
                    DEFAULT 'NORMAL' COMMENT '风险等级',
    
    -- 标记
    is_monitoring   TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否加强监控',
    parent_notified TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已通知家长',
    
    -- 时间
    last_event_at   DATETIME COMMENT '最近一次安全事件时间',
    last_evaluated_at DATETIME COMMENT '最近一次风险评估时间',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_risk_level (risk_level),
    INDEX idx_risk_score (risk_score DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户安全画像';
```

### 4.4 安全规则配置（safety_rule）

```sql
CREATE TABLE safety_rule (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    rule_code       VARCHAR(64) NOT NULL UNIQUE COMMENT '规则编码',
    rule_name       VARCHAR(128) NOT NULL COMMENT '规则名称',
    rule_type       ENUM('KEYWORD', 'REGEX', 'SEMANTIC', 'COMPOSITE') NOT NULL,
    
    -- 规则内容
    rule_config     JSON NOT NULL COMMENT '规则配置 (关键词列表/正则/模型参数)',
    
    -- 关联
    risk_category   VARCHAR(32) NOT NULL COMMENT '对应风险类别',
    min_risk_level  ENUM('P0', 'P1', 'P2', 'P3') NOT NULL COMMENT '最低风险等级',
    
    -- 适用范围
    apply_age_min   INT COMMENT '最小适用年龄',
    apply_age_max   INT COMMENT '最大适用年龄',
    apply_grades    JSON COMMENT '适用学段年级列表 (null=全部)',
    
    -- 优先级与状态
    priority        INT NOT NULL DEFAULT 100 COMMENT '优先级(越大越先匹配)',
    is_active       TINYINT(1) NOT NULL DEFAULT 1,
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_type_active (rule_type, is_active, priority DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='安全检测规则';
```

### 4.5 关键 JSON 结构定义

#### trigger_details 结构

```typescript
interface TriggerDetails {
  // 关键词匹配
  keyword_match?: {
    matched_keywords: string[];      // 匹配到的关键词
    positions: Array<{               // 匹配位置
      keyword: string;
      start: number;
      end: number;
    }>;
    match_rule_code: string;         // 命中规则编码
  };
  
  // 语义分类
  semantic_classify?: {
    model_id: string;                // 分类模型标识
    categories: Array<{
      category: string;             // 分类结果
      probability: number;          // 概率
    }>;
    top_category: string;
    top_probability: number;
  };
  
  // 规则引擎
  rule_match?: {
    rule_code: string;
    rule_name: string;
    conditions_matched: string[];
  };
  
  // 行为模式
  behavior_pattern?: {
    pattern_type: string;            // FREQUENT_OFF_TOPIC / REPEATED_SENSITIVE / ...
    evidence: string;
    time_window_hours: number;
    occurrence_count: number;
  };
}
```

#### helpline_info 结构

```typescript
interface HelplineInfo {
  national: Array<{
    name: string;        // "全国24小时心理援助热线"
    phone: string;       // "400-161-9995"
    available: string;   // "24小时"
  }>;
  local?: Array<{
    name: string;
    phone: string;
    region: string;
  }>;
  online?: Array<{
    name: string;
    url: string;
    description: string;
  }>;
}
```

---

## 5. API 接口设计

### 5.1 输入安全扫描

```
POST /api/v1/safety/scan-input
```

**请求体：**

```json
{
  "userId": 100001,
  "conversationId": "conv_20260610_abc123",
  "messageId": "msg_001",
  "content": "我最近感觉很烦，活着没什么意思",
  "contentType": "TEXT",
  "metadata": {
    "turnIndex": 5,
    "sessionId": "sess_xyz"
  }
}
```

**响应体：**

```json
{
  "scanId": "scan_input_20260610_def456",
  "safe": false,
  "riskAssessment": {
    "riskCategory": "SELF_HARM",
    "riskLevel": "P0",
    "confidenceScore": 0.92,
    "detectionMethod": "SEMANTIC"
  },
  "action": {
    "type": "REPLACE",
    "blockOriginal": true,
    "replacementContent": "同学，如果你正在经历一些困难，请知道总有人愿意帮助你。你可以拨打24小时心理援助热线 400-161-9995，或者和信任的老师、家长聊一聊。你不是一个人。",
    "helplineInfo": {
      "national": [
        {
          "name": "全国24小时心理援助热线",
          "phone": "400-161-9995",
          "available": "24小时"
        },
        {
          "name": "北京心理危机研究与干预中心",
          "phone": "010-82951332",
          "available": "24小时"
        }
      ]
    }
  },
  "eventId": "evt_20260610_ghi789",
  "processingTimeMs": 85
}
```

### 5.2 输出安全扫描

```
POST /api/v1/safety/scan-output
```

**请求体：**

```json
{
  "userId": 100001,
  "conversationId": "conv_20260610_abc123",
  "messageId": "msg_002",
  "content": "AI模型生成的回复内容...",
  "sourceModel": "glm-5",
  "promptTemplate": "tutor_general_v3",
  "metadata": {
    "inputMessageId": "msg_001",
    "turnIndex": 6
  }
}
```

**响应体：**

```json
{
  "scanId": "scan_output_20260610_jkl012",
  "safe": true,
  "riskAssessment": null,
  "action": {
    "type": "PASS"
  },
  "eventId": null,
  "processingTimeMs": 63
}
```

### 5.3 批量安全扫描（异步任务）

```
POST /api/v1/safety/scan-batch
```

**请求体：**

```json
{
  "batchId": "batch_20260610_mno345",
  "messages": [
    {
      "messageId": "msg_101",
      "userId": 100002,
      "conversationId": "conv_20260610_xxx",
      "content": "...",
      "scanDirection": "INPUT"
    }
  ],
  "callbackUrl": "https://api.primetop.com/internal/safety/batch-callback",
  "priority": "NORMAL"
}
```

### 5.4 查询安全事件

```
GET /api/v1/safety/events
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| userId | Long | 否 | 用户ID |
| riskLevel | String | 否 | 风险等级过滤 (P0/P1/P2/P3) |
| riskCategory | String | 否 | 风险类别过滤 |
| startTime | DateTime | 否 | 开始时间 |
| endTime | DateTime | 否 | 结束时间 |
| reviewResult | String | 否 | 复核状态 |
| page | Integer | 否 | 页码 (默认1) |
| pageSize | Integer | 否 | 每页数量 (默认20, 最大100) |

### 5.5 人工复核

```
POST /api/v1/safety/events/{eventId}/review
```

**请求体：**

```json
{
  "reviewResult": "CONFIRMED",
  "reviewComment": "确认存在自伤倾向，已转交心理危机干预团队",
  "escalateTo": "CRISIS_TEAM",
  "notifyParent": true
}
```

### 5.6 用户安全画像查询

```
GET /api/v1/safety/profiles/{userId}
```

**响应体：**

```json
{
  "userId": 100001,
  "riskScore": 35.5,
  "riskLevel": "WATCH",
  "totalEvents": 3,
  "p0Events": 0,
  "p1Events": 1,
  "p2Events": 2,
  "eventsLast7d": 1,
  "eventsLast30d": 3,
  "isMonitoring": true,
  "lastEventAt": "2026-06-08T15:30:00+08:00",
  "recentCategories": ["MENTAL_HEALTH", "OFF_TOPIC_ABUSE"]
}
```

### 5.7 安全规则管理（管理后台）

```
# 创建规则
POST /api/v1/safety/rules

# 更新规则
PUT /api/v1/safety/rules/{ruleId}

# 启用/禁用规则
PATCH /api/v1/safety/rules/{ruleId}/toggle

# 测试规则
POST /api/v1/safety/rules/test
```

---

## 6. 核心处理流程

### 6.1 对话消息安全扫描主流程

```text
用户发送消息 / AI 生成回复
        │
        ▼
┌───────────────────┐
│ 1. 内容预处理      │
│ - 文本清洗         │
│ - 去除特殊字符     │
│ - 繁简转换         │
│ - 长文本分段       │
└───────┬───────────┘
        │
        ▼
┌───────────────────┐
│ 2. 关键词快速匹配  │ ◄─── 并行执行 ───┐
│ - 敏感词库匹配     │                   │
│ - 正则规则匹配     │                   │
│ - 变形词检测       │                   │
│ (耗时 < 10ms)     │                   │
└───────┬───────────┘                   │
        │                               │
        ▼                               │
┌───────────────────┐                   │
│ 3. 语义分类检测    │ ◄─── 并行执行 ───┤
│ - 调用安全分类模型  │                   │
│ - 多标签分类       │                   │
│ (耗时 < 100ms)    │                   │
└───────┬───────────┘                   │
        │                               │
        ▼                               │
┌───────────────────┐                   │
│ 4. 上下文关联分析  │ ◄─── 并行执行 ───┘
│ - 查询近期安全事件  │
│ - 对话历史风险累积  │
│ - 用户安全画像     │
│ (耗时 < 50ms)     │
└───────┬───────────┘
        │
        ▼
┌───────────────────┐
│ 5. 综合风险评估    │
│ - 汇总各维度结果   │
│ - 加权评分         │
│ - 确定最终风险等级 │
└───────┬───────────┘
        │
        ▼
┌───────────────────┐
│ 6. 处置决策       │
│ ┌────────────────┐│
│ │ P0: BLOCK/     ││
│ │     REPLACE +  ││
│ │     告警上报    ││
│ │ P1: FLAG +     ││
│ │     工单创建    ││
│ │ P2: LOG        ││
│ │ P3: LOG        ││
│ └────────────────┘│
└───────┬───────────┘
        │
        ├─── 异步 ───┐
        │             ▼
        │     ┌───────────────┐
        │     │ 审计日志记录    │
        │     │ 用户画像更新    │
        │     │ 工单/通知发送    │
        │     └───────────────┘
        │
        ▼
   返回扫描结果给调用方
   (AI对话引擎根据结果
    决定是否放行/替换/拦截)
```

### 6.2 P0 危机快速通道流程（委托危机引擎）

**核心裁决（R3）**：心理危机类信号的分级判定与干预决策权威 100% 归《服务端-学生AI对话心理危机信号检测与分级预警干预编排引擎》（下称"危机引擎"）。本服务只做三件事：①检测发现 P0 信号；②同步委托危机引擎决策；③落审计记录并扇出事件。本服务**不重复对 P0 心理危机做二次分级**，避免双权威。

```text
用户输入消息 / AI 输出内容
        │
        ▼ 本服务初判 risk_level = P0 且 category ∈
          {SELF_HARM, BULLYING, ABUSE} (输入侧)
          {VIOLENCE_OUTPUT, SEXUAL_OUTPUT, SUICIDE_ENCOURAGE} (输出侧)
        │
        ▼
┌─────────────────────────────────────────────┐
│ 分支一：输入侧 P0                              │
│ POST /internal/v1/psych-risk/detect (同步)     │
│ - 子预算 100ms（总预算 200ms 内）              │
│ - 携带 text/source=AI_TUTOR_DIALOG/学生年龄     │
│ - 危机引擎返回 decision/replyOverride/actions   │
│ - 本服务按 decision 执行 BLOCK/REPLACE         │
│ - 危机引擎超时(>100ms)：                        │
│   降级本地 SOP：BLOCK + 预置安全话术            │
│   + 标记 degraded=true 异步补委托               │
└─────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────┐
│ 分支二：输出侧 P0（流式场景已由 SOSF 先行中断） │
│ SOSF INTERRUPT + safety.escalated 直连危机引擎 │
│ 本服务消费 safety.blocked 事件补落审计记录      │
│ （scan-output API 非流式兜底路径同上委托）       │
└─────────────────────────────────────────────┘
        │
        ▼
审计事件落库（action_taken=BLOCK/REPLACE）
        │
        ├── Outbox: safety.p0.triggered ──► 工单系统（紧急工单 P0 SLA 15min）
        ├── Outbox: safety.p0.triggered ──► 通知中心（审核主管告警，P0 旁路免打扰）
        └── Outbox: safety.event.recorded ──► 数据分析（审计宽表）
```

**守卫**：

| 编号 | 规则 |
| --- | --- |
| G5 | P0 分支绝不因下游（危机引擎/工单/通知）故障而放行原始内容；危机引擎不可用时执行本地 SOP 兜底（BLOCK + 安全话术），响应降级但不放行 |
| G6 | 同一 messageId 的 P0 委托仅执行一次（Redis `safety:p0:delegated:{messageId}` SETNX 7 天），危机引擎重试回调不重复触发工单 |
| G7 | 危机引擎返回的 replyOverride 为对学生展示内容的**唯一权威**，本服务不得二次改写其话术（保护话术一致性） |

### 6.3 异步审计落库与画像更新流程

同步路径只返回扫描结论；以下步骤全部异步执行，不占用对话主链路耗时：

```text
扫描完成（同步返回后）
        │
        ▼ Kafka topic: safety.scan.completed
┌──────────────────────────────────────┐
│ 1. AuditEventPersister（消费）        │
│ - messageId 幂等去重（Redis SETNX 24h）│
│ - AES-256-GCM 加密 original_content   │
│ - INSERT safety_audit_event           │
│ - 同事务写 audit_outbox               │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ 2. SafetyProfileUpdater（消费）        │
│ - 按 user_id 分片单写者（Redis 锁）    │
│ - 计数器递增 + 近 7/30 天滑动窗口      │
│ - risk_score 重算（见 §8.2 公式）      │
│ - 等级迁移迟滞判定（防抖动）            │
│ - UPSERT user_safety_profile (CAS)    │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ 3. ReportNotifier（消费）              │
│ - P1：创建高优工单（委托工单系统）       │
│ - P0：紧急工单已随同步路径创建，此处补全   │
│ - 家长通知（仅 CONFIRMED 后，且不含原文） │
└──────────────────────────────────────┘
```

**幂等键**：`(user_id, message_id, scan_direction)` 生成 `event_uid`（SHA-256），数据库唯一索引兜底；Redis SETNX 为性能层，DB uk 为最终约束。

### 6.4 人工复核闭环流程

```text
审核工作台拉取 PENDING 事件（P0 优先，SLA 15min；P1 SLA 24h）
        │
        ▼
POST /api/v1/safety/events/{eventId}/review
        │
        ▼ 事务内：
┌────────────────────────────────────────┐
│ 1. UPDATE safety_audit_event            │
│    SET review_result=?, reviewer_id=?   │
│    WHERE event_id=? AND review_result='PENDING'  ← CAS 防并发复核
│ 2. 若 ESCALATED → 委托危机引擎建干预档案   │
│ 3. 若 CONFIRMED 且 P0/P1 → 触发家长通知   │
│    （经统一家长门核验，通知文案不含原文）    │
│ 4. 若 FALSE_POSITIVE → 回流误报样本池     │
│    （供规则/词库调优，7 天聚合评审）        │
│ 5. 同事务写 audit_outbox                 │
│    (safety.review.completed)             │
└────────────────────────────────────────┘
        │
        ▼ 事件扇出：
   - 工单系统（关单）
   - 用户安全画像（FALSE_POSITIVE 冲减 risk_score）
   - 数据分析（审核时效/准确率度量）
```

---

## 7. 关键代码示例

### 7.1 输入扫描编排器（同步主路径）

```java
@Service
public class SafetyScanService {

    private static final long SCAN_BUDGET_MS = 200;
    private static final long CRISIS_SUB_BUDGET_MS = 100;

    private final KeywordScanner keywordScanner;
    private final SemanticSafetyClassifier semanticClassifier;
    private final ContextRiskAnalyzer contextAnalyzer;
    private final CrisisEngineClient crisisEngineClient;
    private final SafetyEventPublisher eventPublisher;

    public ScanResult scanInput(ScanInputRequest req) {
        long deadline = System.currentTimeMillis() + SCAN_BUDGET_MS;

        // 第一层：关键词+正则（本地，<10ms，永不降级跳过）
        KeywordResult kw = keywordScanner.scan(req.getContent());
        if (kw.isP0Hit()) {
            return handleP0(req, kw, deadline);   // §6.2 分支一
        }

        // 第二层：语义分类 + 第三层：上下文分析（并行，合计 <150ms）
        CompletableFuture<SemanticResult> semanticFuture =
                CompletableFuture.supplyAsync(() ->
                        semanticClassifier.classify(req.getContent()));
        CompletableFuture<ContextResult> contextFuture =
                CompletableFuture.supplyAsync(() ->
                        contextAnalyzer.analyze(req.getUserId()));

        SemanticResult sem = awaitWithFallback(semanticFuture, 100,
                SemanticResult.timeout(), deadline);
        ContextResult ctx = awaitWithFallback(contextFuture, 50,
                ContextResult.empty(), deadline);

        // 综合风险评估
        RiskAssessment risk = RiskDecisionEngine.evaluate(kw, sem, ctx);

        // 异步落审计（不阻塞返回）
        eventPublisher.publishScanCompleted(req, risk);

        return ScanResult.of(risk);
    }

    private ScanResult handleP0(ScanInputRequest req, KeywordResult kw, long deadline) {
        // G6：同一 messageId 仅委托一次
        if (!redisOps.setIfAbsent("safety:p0:delegated:" + req.getMessageId(),
                "1", Duration.ofDays(7))) {
            return ScanResult.blockedByPriorDelegation();
        }
        try {
            CrisisDecision decision = crisisEngineClient.detect(
                    CrisisDetectRequest.from(req), CRISIS_SUB_BUDGET_MS);
            // G7：replyOverride 为唯一权威，不得改写
            return ScanResult.fromCrisisDecision(decision);
        } catch (CrisisEngineTimeoutException e) {
            // G5：降级本地 SOP，绝不放行
            return ScanResult.localSopFallback(kw.getCategory());
        }
    }
}
```

### 7.2 综合风险评估决策器

```java
public final class RiskDecisionEngine {

    /**
     * 综合评分 = max(关键词层等级, 语义层等级, 上下文层等级)
     * 其中语义层置信度 < 0.60 时降一档（宁可信规则不信低置信模型）；
     * 上下文层仅在"近 7 天已有同类别事件"时才可抬升等级，不可独立定级。
     */
    public static RiskAssessment evaluate(KeywordResult kw, SemanticResult sem,
                                          ContextResult ctx) {
        RiskLevel level = kw.getLevel();                    // 关键词层（地板）

        if (sem.getTopProbability() >= 0.85) {
            level = RiskLevel.max(level, sem.getLevel());
        } else if (sem.getTopProbability() >= 0.60) {
            level = RiskLevel.max(level, sem.getLevel().downgradeOne());
        }                                                  // <0.60 不采信

        if (ctx.hasRecentSameCategory() && sem.getLevel().isP1OrAbove()) {
            level = level.upgradeOne();                      // 上下文抬升
        }

        ActionType action = switch (level) {
            case P0     -> ActionType.BLOCK_AND_REPLACE;     // §6.2 危机通道
            case P1     -> ActionType.FLAG_AND_TICKET;
            case P2, P3 -> ActionType.LOG_ONLY;
        };
        return new RiskAssessment(level, action, sem.getTopCategory(),
                sem.getTopProbability(), sem.getMethod());
    }
}
```

### 7.3 异步审计落库（幂等 + 加密）

```java
@Component
public class AuditEventPersister {

    public void persist(ScanCompletedEvent evt) {
        String eventUid = sha256(evt.getUserId() + "|" + evt.getMessageId()
                + "|" + evt.getScanDirection());

        // Redis 快去重（24h），DB uk(event_uid 派生唯一键) 为最终约束
        if (!redisOps.setIfAbsent("safety:evt:" + eventUid, "1",
                Duration.ofHours(24))) {
            return;                                          // 重复投递，吞没
        }

        SafetyAuditEvent entity = new SafetyAuditEvent();
        entity.setEventId(UUID.randomUUID().toString());
        entity.setEventUid(eventUid);
        entity.setOriginalContentHash(sha256(evt.getContent()));
        entity.setOriginalContentEnc(
                kmsCipher.encrypt(evt.getContent().getBytes(UTF_8)));  // AES-256-GCM

        txTemplate.executeWithoutResult(tx -> {
            auditEventMapper.insertIgnoreDuplicate(entity);   // uk 兜底幂等
            outboxMapper.insert(SafetyOutbox.of(
                    "safety.event.recorded", entity.getEventId(), entity));
        });
    }
}
```

### 7.4 用户安全画像更新（单写者 + 迟滞）

```java
@Component
public class SafetyProfileUpdater {

    /** risk_score = min(100, w1*P0*50 + w2*P1*15 + w3*P2*3 + w4*近7天斜率*10) */
    public void onEventRecorded(SafetyAuditEvent evt) {
        String lockKey = "safety:profile:lock:" + evt.getUserId();
        if (!redisOps.setIfAbsent(lockKey, nodeId, Duration.ofSeconds(30))) {
            kafkaTemplate.send("safety.profile.retry", evt.getEventId());  // 让位重试
            return;
        }
        try {
            txTemplate.executeWithoutResult(tx -> {
                UserSafetyProfile p = profileMapper
                        .selectForUpdate(evt.getUserId());
                p.applyEvent(evt);                    // 计数/时间窗/risk_score
                RiskLevel newLevel = HYSTERESIS_MAP.resolve(p.getRiskScore());
                if (newLevel != p.getRiskLevel()) {
                    p.setRiskLevel(newLevel);
                    outboxMapper.insert(SafetyOutbox.of(
                            "safety.profile.changed", p.getUserId(),
                            Map.of("from", "...", "to", newLevel)));
                }
                profileMapper.updateById(p);          // version 乐观锁
            });
        } finally {
            redisOps.delete(lockKey);
        }
    }
}
```

### 7.5 人工复核（CAS + 家长通知委托）

```java
@Service
public class SafetyReviewService {

    public ReviewResponse review(String eventId, ReviewRequest req, long reviewerId) {
        return txTemplate.execute(tx -> {
            int updated = auditEventMapper.casReviewResult(
                    eventId, "PENDING", req.getReviewResult(), reviewerId);
            if (updated == 0) {
                throw new BizException(SafetyErrorCode.ALREADY_REVIEWED);  // 53202
            }
            if (req.getReviewResult().equals("ESCALATED")) {
                crisisEngineClient.openInterventionCase(eventId, req.getComment());
            }
            if (req.getReviewResult().equals("CONFIRMED") && req.isNotifyParent()) {
                // 委托统一家长门核验后发送；文案经通知模板引擎渲染，不含原文
                parentNotifier.notifySafetyConfirmed(eventId);   // Outbox 异步
            }
            if (req.getReviewResult().equals("FALSE_POSITIVE")) {
                falsePositivePool.collect(eventId);              // 7 天聚合评审
            }
            outboxMapper.insert(SafetyOutbox.of(
                    "safety.review.completed", eventId, req));
            return ReviewResponse.ok(eventId);
        });
    }
}
```

---

## 8. 状态机与守卫

### 8.1 审计事件复核状态机

```text
                ┌─────────────┐  CONFIRMED(P0/P1)+家长门核验  ┌──────────────┐
                │             │ ────────────────────────────► │ PARENT_NOTIF │
                │             │        (Outbox 异步，可重试)   │ (派生态)      │
                │             │ ◄──────────────────────────── └──────┬───────┘
                ▼             │        失败保留 NOTIFIED_PENDING      │ 成功
          ┌──────────┐  review(PENDING→*)   ┌──────────────┐         │
          │ PENDING  │ ───────────────────► │  CONFIRMED   │ ◄────────┘
          └────┬─────┘                      └──────┬───────┘
               │  review=FALSE_POSITIVE            │ ESCALATED 分支
               ▼                                   ▼
        ┌──────────────┐                   ┌──────────────┐
        │FALSE_POSITIVE│                   │  ESCALATED   │──► 危机引擎干预档案
        └──────┬───────┘                   └──────────────┘
               │ 冲减 risk_score
               ▼
        误报样本池（7 天聚合评审）
```

转移表：

| 当前态 | 事件 | 目标态 | 守卫 |
| --- | --- | --- | --- |
| PENDING | review=CONFIRMED | CONFIRMED | CAS（WHERE review_result='PENDING'），仅审核员角色 |
| PENDING | review=FALSE_POSITIVE | FALSE_POSITIVE | 同上；P0 事件需副组长以上 |
| PENDING | review=ESCALATED | ESCALATED | 同上；同步调用危机引擎开档，失败整事务回滚 |
| CONFIRMED | 家长通知成功 | CONFIRMED（NOTIFIED 派生） | 家长门核验通过才发送 |

### 8.2 用户安全画像等级（迟滞映射）

| risk_score | 等级 | 迟滞规则 |
| --- | --- | --- |
| < 20 | NORMAL | 降级需连续 14 天低于阈值 |
| 20-49 | WATCH | 自动升级即时生效 |
| 50-79 | WARNING | 降级需连续 7 天低于阈值 |
| ≥ 80 | CRITICAL | 升级即时生效 + 强制家长通知（一次/7 天频控） |

### 8.3 守卫总表

| 编号 | 守卫 |
| --- | --- |
| G1 | 关键词本地层（含 P0 词）任何降级下不可跳过；语义/上下文层可降级，关键词层不可 |
| G2 | 审计事件落库与 Outbox 同事务；事件重放不重复扇出（event_id,consumer 消费幂等表） |
| G3 | 原始内容仅 AES-256-GCM 密文落库，密钥经 KMS 信封加密；明文只存在于请求线程与加密函数栈内 |
| G4 | 复核操作只允许 PENDING→终态单向转移，无撤回；误改正走"重新开档"流程 |
| G5 | P0 处置响应降级终点是 BLOCK + 安全话术，绝不放行（对齐全链路 fail-secure 红线） |
| G6 | 同一 messageId 危机委托一次（SETNX 7 天 + DB 状态双保险） |
| G7 | 危机引擎 replyOverride 为对学生展示唯一权威，本服务不得改写 |
| G8 | 家长通知文案永不含事件原文/哈希/类别明细，仅"检测到需要关注的使用信号"+ 建议沟通话术 |
| G9 | user_safety_profile 按 user_id 单写者（Redis 锁 30s + version 乐观锁），禁止多实例并发更新 |
| G10 | P2/P3 事件不得创建工单（防止工单洪泛）；仅 P0/P1 建单 |
| G11 | 内部接口（scan-input/scan-output）仅允许 AI 对话域服务账户调用，mTLS + 服务账户鉴权，不对外暴露 |
| G12 | safety_audit_event 原始内容 90 天字段级抹除（置 NULL，保留 hash 供审计追溯） |
| G13 | 管理端列表接口默认不回传 original_content_enc 明文，解密查看走独立权限点 + 全量审计（对齐 MaskedField 60s 水印规范） |
| G14 | 注销联动：user.deleted 事件消费后 180 天内完成安全事件原文与画像物理删除（法务留存期后） |

---

## 9. 幂等与并发

| 场景 | 幂等机制 | 并发裁决 |
| --- | --- | --- |
| scan-input/scan-output 重试 | 调用方带 scanIdempotencyKey（messageId）；相同 key 返回首次结果快照（Redis 24h） | 首次结果为准 |
| 审计事件重复消费 | event_uid uk + Redis SETNX 双层 | 后者吞没 |
| P0 危机委托重放 | SETNX(messageId) 7 天 | 首次委托为准 |
| 人工复核并发提交 | UPDATE...WHERE review_result='PENDING' CAS | 先到者胜，后者 53202 |
| 画像更新并发 | 按 user_id Redis 锁让位重试 + version CAS | 单写者串行 |
| 家长通知重试 | Outbox (event_id, consumer) 幂等 + 通知中心去重 | 一次成功即终态 |
| 规则热更新 | 版本号单调递增，加载时拒绝旧版本覆盖新版本 | 新版本胜 |

---

## 10. 事件 Outbox 与消费契约

### 10.1 本服务发布（audit_outbox，topic=safety.domain.events）

| 事件 | 触发 | 消费方 | 幂等键 |
| --- | --- | --- | --- |
| safety.event.recorded | 任意风险事件落库 | 数据分析（审计宽表）、运营看板 | (event_id, consumer) |
| safety.p0.triggered | P0 事件确认 | 工单系统（紧急工单）、通知中心（主管告警） | 同上 |
| safety.review.completed | 人工复核完成 | 工单系统（关单）、画像（FALSE_POSITIVE 冲减） | 同上 |
| safety.profile.changed | 画像等级迁移 | 风控决策中心（信誉信号）、干预编排引擎 | (user_id+toLevel+date) |

### 10.2 本服务订阅

| 来源事件 | 用途 | 关键约束 |
| --- | --- | --- |
| safety.blocked（SOSF，Kafka） | 流式拦截场景补落审计事件 | SOSF 已注册本服务为落库消费方（其 R 矩阵）；本服务不重复执行拦截动作 |
| safety.review.required（SOSF） | P2 以上流式拦截转人工队列 | 与自检 P1 工单去重（同 messageId 归并） |
| user.deleted | 级联删除安全事件原文与画像（G14） | 180 天留存期满后执行 |

### 10.3 对账

日终 04:20 对账任务校验三恒等式：① Kafka 消费数 = safety_audit_event 增量数；② Outbox 发布数 = 各消费方 ack 数（差异 >1% P2 告警）；③ 画像事件数 = 等级变更日志数。

---

## 11. 错误码（53200-53299）

| 错误码 | HTTP | 语义 | 说明 |
| --- | --- | --- | --- |
| 53200 | 500 | SCAN_INTERNAL_ERROR | 扫描内部错误（调用方降级放行+异步补扫，见 D1） |
| 53201 | 404 | EVENT_NOT_FOUND | 事件不存在 |
| 53202 | 409 | ALREADY_REVIEWED | 事件已被复核（CAS 冲突） |
| 53203 | 403 | REVIEW_FORBIDDEN | 无复核权限/P0 复核级别不足 |
| 53204 | 400 | INVALID_REVIEW_RESULT | 非法复核结果枚举 |
| 53205 | 200 | SCAN_TIMEOUT_DEGRADED | 语义层超时降级（响应含 degraded=true，调用方按 D1 处理） |
| 53206 | 200 | CRISIS_ENGINE_DEGRADED | 危机引擎超时，本地 SOP 兜底已生效 |
| 53207 | 429 | SCAN_RATE_LIMITED | 单用户扫描频控（10 次/s） |
| 53208 | 400 | CONTENT_TOO_LONG | 单条内容超 8KB 上限 |
| 53209 | 403 | PARENT_GATE_REQUIRED | 家长通知需经统一家长门核验 |
| 53210 | 500 | PROFILE_UPDATE_CONFLICT | 画像更新冲突（自动重试 3 次后入死信，P2 告警） |
| 53211-53299 | - | 预留 | 段内扩展 |

客户端（学生侧）不直接消费本服务错误码；学生可见内容仅为安全话术本身。53205/53206 为 200 语义码，对齐全库"软失败恒 200"惯例。

---

## 12. 降级矩阵 D1-D10

| 编号 | 故障场景 | 降级策略 | 红线 |
| --- | --- | --- | --- |
| D1 | 语义分类模型不可用/超时 | 关键词+上下文层照常，响应 degraded=true，事件入异步补扫队列（模型恢复后重扫，结论以补扫为准并可追加审计记录） | 关键词层不可降级 |
| D2 | 危机引擎超时 | 本地 SOP：BLOCK + 预置安全话术 + 异步补委托（53206） | 绝不放行原始内容（G5） |
| D3 | Kafka 不可用 | 同步路径不受影响；审计事件落本地 spillover 表，恢复后批量补投 | 事件不丢（本地盘队列） |
| D4 | Redis 不可用 | 幂等退化为 DB uk 约束；画像锁退化为 version CAS；P0 委托幂等退化为 DB 状态查询 | 语义同 G1/G5 |
| D5 | 工单系统不可用 | P0/P1 事件在 Outbox 积压重试（1/5/15min 退避），积压 >1 万 P1 告警转人工通道 | P0 不得因工单故障漏报（替代通道：主管告警直发） |
| D6 | 通知中心不可用 | 家长通知延迟队列保留 72h，超时转站内信兑底 | 主管告警（P0）走备用短信通道 |
| D7 | KMS 不可用 | 原文不落库仅存 hash，恢复后无法回溯原文（审计降级标记） | hash 必存 |
| D8 | 数据库只读/主从切换 | 扫描只读模式：仅关键词层+本地缓存规则，审计写本地 spillover | 扫描结论可降级但 P0 处置不变 |
| D9 | 审核工作台不可用 | 复核 SLA 计时暂停，事件保留 PENDING 不自动结案 | 绝不自动 CONFIRMED |
| D10 | 画像更新死信 | 人工介入修复，画像读路径回退"仅计数无等级"模式 | 不返回错误等级 |

---

## 13. 监控与容量

### 13.1 核心指标（M1-M10）

| 指标 | 口径 | 告警阈值 |
| --- | --- | --- |
| M1 扫描 P99 延迟 | scan-input/scan-output 端到端 | >200ms 持续 5min P2 |
| M2 P0 漏检率 | 复核 CONFIRMED 中曾被判 safe 占比 | >0.5% P1（红线指标） |
| M3 误报率 | FALSE_POSITIVE / 已复核事件 | >15% P2（触发规则评审） |
| M4 危机委托成功率 | 危机引擎 2xx / 总委托 | <99.9% P2 |
| M5 审计落库延迟 | 扫描完成→事件可见 | P99 >60s P2 |
| M6 P0 工单创建时延 | 事件确认→工单可见 | >5s P1 |
| M7 复核 SLA 达成率 | 15min(P0)/24h(P1) 内完成占比 | <95% P2 |
| M8 画像更新冲突率 | 锁让位重试占比 | >5% P2 |
| M9 降级发生率 | degraded=true 占比 | >2% P2 |
| M10 存储增长 | safety_audit_event 日增量 | 超容量规划 120% P2 |

### 13.2 容量估算（DAU 50 万）

- AI 对话轮次日均约 400 万轮（输入+输出各一次扫描 → 扫描调用 800 万次/日，峰值约 300 QPS）
- 事件表日增约 8-15 万行（P2/P3 占 97%），90 天在线约 400 万行/分区，超期归档 ClickHouse（宽表 TTL 1 年）
- 语义分类模型 QPS 峰值 300，独立 GPU 池 2 实例（ONNX INT8 单实例 >500 QPS）
- Redis：幂等键+画像锁 ≈200MB；Kafka safety.* 主题 6 分区
- 延迟预算：预处理 5ms + 关键词 10ms + 语义 100ms（并行）+ 上下文 50ms（并行）+ 决策 10ms + 序列化 5ms ≈ P99 180ms

---

## 14. 合规红线（C1-C10）

| 编号 | 红线 |
| --- | --- |
| C1 | 原始内容 90 天字段级抹除（G12），抹除后仅存 hash，不可逆 |
| C2 | 家长通知不含事件原文/类别明细/风险分（G8），仅中性描述 + 沟通建议 |
| C3 | 心理危机信号处置"保护优先"：先阻断+委托危机引擎，再谈内容定性；危机通道永不降级（对齐 SOSF C6/D 红线） |
| C4 | 解密查看原始内容走独立权限点，全量审计 + 屏幕水印（60s），批量导出禁止 |
| C5 | 安全画像数据禁止回流营销/推荐/商业化定向（对齐掌握度引擎合规口径） |
| C6 | 未成年人对话内容禁止用于模型训练（excluded_from_training 标记，对齐 RLHF 管线 G14） |
| C7 | 审核员视角的未成年人身份信息最小化（学段+年龄段，不显示精确年龄/学校） |
| C8 | 热线资源（helpline_info）内容变更需合规+心理顾问双人审批 |
| C9 | 自伤/自杀类话术模板必须由心理顾问起草并年度复审，禁用任何可能诱导性表述 |
| C10 | 透明度：隐私政策中明示"AI 对话接受安全审计"，家长端可查询审计开关状态 |

---

## 15. 契约对齐（R1-R14）

| 编号 | 契约 |
| --- | --- |
| R1 | 危机分级与干预决策权威归《学生AI对话心理危机信号检测与分级预警干预编排引擎》（§6.2 分支一，detect 接口字段对齐其 §6.1.1） |
| R2 | 流式输出危机/违规即时中断权威归 SOSF；本服务消费 safety.blocked/safety.review.required 补落审计，不重复执行拦截（SOSF 消费方矩阵已注册） |
| R3 | 关键词库 SSOT 归《教育场景敏感词多层次过滤与内容安全规则引擎》，本服务本地词库为其单向投影（scene=AI_DIALOGUE），禁独立维护词表 |
| R4 | 输入侧教育护栏（prompt 注入/越狱/话题边界）权威归《AI输入安全与教育对话护栏引擎》；本服务与其并行挂载于对话管线，互不替代 |
| R5 | 家长通知经统一家长门（purpose=safety.alert）核验后发送，模板经统一通知模板引擎渲染（fail-closed） |
| R6 | 工单创建/关单委托《客服与工单系统》，紧急工单类型 SAFETY_P0 需该系统注册 |
| R7 | 用户年龄/学段以实名核验服务为权威输入，本服务仅存快照 |
| R8 | 安全画像 risk_score 只供风控与干预编排消费，不进学习画像/推荐链路（C5） |
| R9 | 注销级联删除对齐《学习数据导出与账户注销服务》180 天法务留存口径 |
| R10 | 管理端权限点注册 RBAC：safety:event:review / safety:content:decrypt（四级分级） |
| R11 | 审计宽表入仓走 CDC 统一管道，本服务不直连 BI 库 |
| R12 | 热点资源位/运营域零依赖：本服务不消费任何运营事件，防止营销信号污染安全判定 |
| R13 | P3（OFF_TOPIC_ABUSE）行为数据仅周聚合供产品分析，不进入任何个体处置链路 |
| R14 | 错误码段 53200-53299 已全库扫描无冲突（521/532 为 5xxxx 空间末两个空闲百段，取 532） |

---

## 16. 验收场景（18 条）

| # | 场景 | 预期 |
| --- | --- | --- |
| A1 | 输入含 P0 自伤关键词 | <1s 返回 BLOCK + 安全话术 + 危机委托一次 + 紧急工单创建 |
| A2 | 危机引擎超时（注入 150ms 延迟） | 本地 SOP 兜底生效（53206），不返回原始内容，异步补委托 |
| A3 | 同一 messageId 重复扫描 | 幂等返回首次快照，不重复建单 |
| A4 | 语义层超时（注入 120ms） | 53205 degraded=true，关键词层结论仍生效，事件入补扫队列 |
| A5 | 语义置信度 0.55 命中 P1 | 降一档按 P2 处理（规则优先于低置信模型） |
| A6 | 近 7 天同类别 + 语义 P1 | 抬升一级按 P0 走危机通道 |
| A7 | 并发双人复核同一事件 | 先到者胜，后者 53202 |
| A8 | P0 复核 ESCALATED 且危机引擎开档失败 | 整事务回滚，事件保持 PENDING，可重试 |
| A9 | 家长通知（CONFIRMED + notifyParent） | 经家长门核验，文案无原文/类别明细 |
| A10 | SOSF safety.blocked 事件到达 | 补落审计事件，不重复拦截，无双工单 |
| A11 | Redis 宕机 | 幂等/锁退化 DB 约束，P0 处置语义不变 |
| A12 | Kafka 宕机 10min | 同步路径无损，事件在 spillover，恢复后零丢失 |
| A13 | 画像并发更新（两事件同用户） | 单写者串行，version 无冲突报错，等级迟滞正确 |
| A14 | risk_score 79→81→76 | 升 WARNING→CRITICAL 即时，降回需 7 天连续低于阈值 |
| A15 | 管理端导出事件列表 | 无原文列；解密查看触发审计+水印 |
| A16 | 事件满 90 天 | 原文抹除，hash 保留，解密接口返回 53201 语义降级 |
| A17 | P3 事件风暴（1 万条/分） | 仅 LOG，不建工单，画像计数正常 |
| A18 | user.deleted 消费 | 180 天后原文与画像物理删除，hash 同步清理 |

---

## 17. 维护记录

- **v1.0（2026-06-10）**：初稿。含概述、风险分类体系、架构、4 张核心 DDL、JSON 结构、API 设计（§1-§5）、§6.1 主流程图（至"返回扫描结果给调用方"处截断，§6.2 起全部缺失）。
- **v1.1（2026-09-28）**：补全烂尾文档。新增 §6.2 P0 危机快速通道（决策权威归危机引擎 R3/G5-G7）、§6.3 异步落库与画像更新、§6.4 人工复核闭环、§7 关键代码五段（扫描编排/决策器/幂等落库/画像单写者/复核 CAS）、§8 复核+画像双状态机与守卫 G1-G14、§9 幂等并发七场景、§10 audit_outbox 四事件与三订阅及对账、§11 错误码 53200-53299（521/532 为全库 5xxxx 末两个空闲百段，取 532；53205/53206 两个 200 语义码）、§12 降级矩阵 D1-D10、§13 监控 M1-M10 与 DAU50 万容量、§14 合规 C1-C10、§15 契约对齐 R1-R14（核心裁决：危机分级权威归危机引擎、流式中断权威归 SOSF、词库 SSOT 归敏感词引擎、家长门委托）、§16 验收场景 18 条。
- **修复 v1.0 缺陷**：F1：§4.3 user_safety_profile DDL `DEFAULT CURRENTETIME` 拼写错误（MySQL 语法错误，编译/建表即失败）→ `CURRENT_TIMESTAMP`；F2：§6.1 流程图围栏未闭合（CommonMark 校验 unclosed@L557）→ 本批随 §6.2 前补闭合并全文校验。
