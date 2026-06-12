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
    updated_at      DATETIME NOT NULL DEFAULT CURRENTETIME ON UPDATE CURRENT_TIMESTAMP,
    
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