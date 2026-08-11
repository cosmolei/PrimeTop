# 客户端-AI对话快捷操作面板与学习场景动作触发引擎-详细设计

## 1. 概述

### 1.1 功能定位

AI 对话快捷操作面板是 PrimeTop 学生端 AI 辅导对话页面中的核心交互组件。当 AI 完成一次回答后，在回答卡片底部展示一组**上下文感知的快捷操作按钮**，让学生通过一键触达的方式执行常见学习动作，如「换一种讲法」「再讲简单点」「生成同类题」「加入错题本」「继续追问」等。

本模块负责：
1. **动作推荐决策**：根据当前对话上下文（学科、学段、问题类型、回答内容）动态决定展示哪些快捷操作。
2. **动作触发编排**：统一管理各动作的执行流程，包括参数构建、跨模块导航、服务端调用等。
3. **交互反馈**：处理动作执行中的加载态、成功态、失败态，并向用户给出清晰反馈。

### 1.2 设计目标

| 目标 | 说明 |
| --- | --- |
| 低延迟 | 快捷操作面板在 AI 回答渲染完成后 **200ms** 内完成渲染 |
| 高扩展 | 新增一种快捷操作只需实现 `QuickAction` 接口并注册，无需修改核心逻辑 |
| 上下文感知 | 同一学生在不同学科、不同问题类型下看到的操作选项不同 |
| 离线友好 | 部分操作（如「加入错题本」）在弱网下支持离线队列延迟执行 |
| 可埋点 | 每个操作的展示、点击、执行结果均支持行为埋点 |

### 1.3 适用范围

- **平台**：Flutter 客户端（Android / iOS）
- **学段**：全学段（幼儿启蒙 / 小学 / 初中 / 高中）
- **触发场景**：AI 文字问答、AI 语音提问转文字后、拍题答疑解析完成后

---

## 2. 快捷操作体系定义

### 2.1 操作分类总览

| 类别 | 操作标识 | 显示名称 | 说明 | 优先级 |
| --- | --- | --- | --- | --- |
| **讲解调整** | `explain_simpler` | 再讲简单点 | 请求 AI 用更简单的方式重新讲解 | P0 |
| **讲解调整** | `explain_alternative` | 换一种讲法 | 请求 AI 换角度/换方法重新讲解 | P0 |
| **讲解调整** | `explain_detail` | 再详细一些 | 请求 AI 展开更详细的步骤 | P1 |
| **追问拓展** | `follow_up` | 继续追问 | 聚焦输入框并给出追问建议词 | P0 |
| **练习推荐** | `generate_similar` | 练一道同类题 | 基于当前题目的知识点生成同类练习 | P1 |
| **练习推荐** | `generate_variants` | 题目变式 | 生成条件变式或数字变式 | P2 |
| **错题管理** | `add_to_mistakes` | 加入错题本 | 将当前问题和 AI 解析存入错题本 | P0 |
| **收藏笔记** | `add_to_favorites` | 收藏此回答 | 将 AI 回答存入收藏夹 | P1 |
| **笔记笔记** | `add_note` | 记笔记 | 对当前回答添加个人笔记 | P2 |
| **知识拓展** | `view_knowledge_map` | 查看知识图谱 | 跳转到该题涉及知识点的知识图谱 | P2 |
| **知识拓展** | `view_related_points` | 相关知识点 | 展示回答中涉及的知识点列表 | P1 |
| **内容反馈** | `report_error` | 回答有误 | 反馈 AI 回答错误，触发纠错流程 | P0 |
| **内容反馈** | `helpful` | 有帮助 | 标记回答有帮助（正向反馈） | P1 |
| **分享导出** | `share_answer` | 分享回答 | 生成图片或文本分享 | P2 |
| **朗读播放** | `read_aloud` | 朗读 | TTS 朗读 AI 回答 | P1 |

### 2.2 上下文感知推荐规则

不同场景下展示的操作集合不同。推荐引擎根据以下维度计算操作列表：

#### 维度定义

```dart
class ActionContext {
  final String subject;          // 学科: math, physics, chemistry, ...
  final String stage;            // 学段: kindergarten, primary, junior, senior
  final MessageType msgType;     // 消息类型: textQuestion, photoQuestion, voiceQuestion
  final bool hasFormula;         // 回答是否包含公式
  final bool hasImage;           // 回答是否包含图片
  final bool isFollowUp;         // 是否是追问消息
  final int conversationTurn;    // 对话轮次 (第几轮)
  final bool answerContainsError;// AI 回答是否被标记疑似有误
  final String? knowledgePointId;// 关联知识点 ID
  final bool alreadyInMistakes;  // 当前题目是否已在错题本中
  final UserMembershipTier tier; // 用户会员等级
}
```

#### 推荐规则表

| 条件 | 展示操作集（最多 6 个） | 默认操作 |
| --- | --- | --- |
| **首轮问答 - 理科** | `explain_simpler`, `explain_alternative`, `follow_up`, `generate_similar`, `add_to_mistakes`, `report_error` | `follow_up` |
| **首轮问答 - 文科** | `explain_detail`, `follow_up`, `add_to_favorites`, `read_aloud`, `add_to_mistakes`, `report_error` | `follow_up` |
| **首轮问答 - 拍题** | `explain_simpler`, `generate_similar`, `add_to_mistakes`, `view_related_points`, `follow_up`, `report_error` | `add_to_mistakes` |
| **追问场景 (turn ≥ 2)** | `explain_simpler`, `explain_alternative`, `follow_up`, `add_to_favorites`, `report_error` | `follow_up` |
| **回答含公式** | 追加 `view_knowledge_map`（若不超过 6 个） | - |
| **题目已在错题本** | 隐藏 `add_to_mistakes`，替换为 `add_note` | - |
| **幼儿学段** | `read_aloud`, `follow_up`, `helpful`, `add_to_favorites` | `read_aloud` |
| **非会员用户** | 隐藏 `generate_similar`, `generate_variants`（会员功能） | - |
| **AI 回答被多人标记疑似有误** | 追加 `report_error` 并高亮提示 | - |

---

## 3. 数据结构设计

### 3.1 客户端数据模型

#### 3.1.1 QuickAction 定义

```dart
/// 快捷操作定义
class QuickAction {
  final String id;                    // 操作唯一标识
  final String label;                 // 显示名称
  final String iconAsset;             // 图标资源路径
  final QuickActionCategory category; // 操作分类
  final QuickActionPriority priority; // 操作优先级
  final bool requiresNetwork;         // 是否需要网络
  final bool requiresMembership;      // 是否需要会员
  final int maxExecutionsPerTurn;     // 每轮最大执行次数 (0=无限)
  final ActionExecutor executor;      // 执行器

  const QuickAction({
    required this.id,
    required this.label,
    required this.iconAsset,
    required this.category,
    required this.priority,
    this.requiresNetwork = true,
    this.requiresMembership = false,
    this.maxExecutionsPerTurn = 1,
    required this.executor,
  });
}

enum QuickActionCategory {
  explanationAdjustment,  // 讲解调整
  followUp,               // 追问拓展
  practiceRecommendation, // 练习推荐
  mistakeManagement,      // 错题管理
  collectionNote,         // 收藏笔记
  knowledgeExpansion,     // 知识拓展
  contentFeedback,        // 内容反馈
  shareExport,            // 分享导出
  readAloud,              // 朗读播放
}

enum QuickActionPriority {
  critical, // 必须展示
  high,     // 优先展示
  medium,   // 空间足够时展示
  low,      // 备选
}
```

#### 3.1.2 推荐结果模型

```dart
/// 单条 AI 回答对应的快捷操作推荐结果
class RecommendedActions {
  final String messageId;           // AI 回答消息 ID
  final List<QuickActionSlot> slots; // 推荐的操作列表
  final String? defaultActionId;    // 默认高亮操作 ID
  final DateTime createdAt;

  RecommendedActions({
    required this.messageId,
    required this.slots,
    this.defaultActionId,
    required this.createdAt,
  });
}

/// 操作槽位
class QuickActionSlot {
  final QuickAction action;
  final bool isHighlighted;    // 是否高亮显示
  final bool isDisabled;       // 是否禁用 (如网络不可用)
  final String? disabledReason;// 禁用原因
  final Map<String, dynamic> params; // 预设参数

  QuickActionSlot({
    required this.action,
    this.isHighlighted = false,
    this.isDisabled = false,
    this.disabledReason,
    this.params = const {},
  });
}
```

#### 3.1.3 执行上下文

```dart
/// 动作执行时的上下文
class ActionExecutionContext {
  final String conversationId;     // 对话 ID
  final String userMessageId;      // 用户提问消息 ID
  final String aiMessageId;        // AI 回答消息 ID
  final String? questionImageId;   // 拍题图片 ID (如有)
  final ActionContext context;     // 上下文信息
  final List<Message> chatHistory; // 近期对话历史

  /// 构建传递给服务端的参数
  Map<String, dynamic> toServerParams() {
    return {
      'conversationId': conversationId,
      'userMessageId': userMessageId,
      'aiMessageId': aiMessageId,
      'subject': context.subject,
      'stage': context.stage,
      'knowledgePointId': context.knowledgePointId,
      'chatHistorySummary': _buildHistorySummary(),
    };
  }
}
```

### 3.2 服务端数据结构

#### 3.2.1 快捷操作点击日志表

```sql
CREATE TABLE `quick_action_log` (
  `id`             BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id`        BIGINT       NOT NULL COMMENT '用户 ID',
  `conversation_id` VARCHAR(64) NOT NULL COMMENT '对话 ID',
  `message_id`     VARCHAR(64)  NOT NULL COMMENT 'AI 回答消息 ID',
  `action_id`      VARCHAR(48)  NOT NULL COMMENT '操作标识',
  `action_category`VARCHAR(32)  NOT NULL COMMENT '操作分类',
  `subject`        VARCHAR(16)  DEFAULT NULL COMMENT '学科',
  `stage`          VARCHAR(16)  DEFAULT NULL COMMENT '学段',
  `shown_at`       DATETIME(3)  NOT NULL COMMENT '操作展示时间',
  `clicked_at`     DATETIME(3)  DEFAULT NULL COMMENT '操作点击时间',
  `executed_at`    DATETIME(3)  DEFAULT NULL COMMENT '操作执行完成时间',
  `execution_status` VARCHAR(16) DEFAULT NULL COMMENT '执行状态: success/failed/cancelled',
  `error_code`     VARCHAR(32)  DEFAULT NULL COMMENT '失败错误码',
  `execution_duration_ms` INT   DEFAULT NULL COMMENT '执行耗时(毫秒)',
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_user_message` (`user_id`, `message_id`),
  INDEX `idx_shown_at` (`shown_at`),
  INDEX `idx_action_id` (`action_id`, `shown_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='快捷操作行为日志';
```

#### 3.2.2 操作推荐配置表（管理后台可配）

```sql
CREATE TABLE `quick_action_rule` (
  `id`              INT          NOT NULL AUTO_INCREMENT,
  `rule_name`       VARCHAR(128) NOT NULL COMMENT '规则名称',
  `action_id`       VARCHAR(48)  NOT NULL COMMENT '操作标识',
  `priority`        INT          NOT NULL DEFAULT 50 COMMENT '排序优先级(越小越优先)',
  `subject_filter`  VARCHAR(256) DEFAULT NULL COMMENT '学科过滤(JSON数组, null=全部)',
  `stage_filter`    VARCHAR(256) DEFAULT NULL COMMENT '学段过滤(JSON数组, null=全部)',
  `msg_type_filter` VARCHAR(256) DEFAULT NULL COMMENT '消息类型过滤(JSON数组)',
  `min_turn`        INT          DEFAULT 1 COMMENT '最小对话轮次',
  `max_turn`        INT          DEFAULT 999 COMMENT '最大对话轮次',
  `membership_only` TINYINT(1)   DEFAULT 0 COMMENT '是否仅会员',
  `conditions_json` TEXT         DEFAULT NULL COMMENT '附加条件(JSON)',
  `is_active`       TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '是否启用',
  `sort_order`      INT          NOT NULL DEFAULT 100 COMMENT '排序',
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_action_active` (`action_id`, `is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='快捷操作推荐规则配置';
```

#### 3.2.3 操作执行结果表

```sql
CREATE TABLE `quick_action_execution` (
  `id`              BIGINT       NOT NULL AUTO_INCREMENT,
  `user_id`         BIGINT       NOT NULL,
  `conversation_id` VARCHAR(64)  NOT NULL,
  `message_id`      VARCHAR(64)  NOT NULL,
  `action_id`       VARCHAR(48)  NOT NULL,
  `target_module`   VARCHAR(32)  DEFAULT NULL COMMENT '目标模块: ai_chat/mistake_book/practice/...',
  `target_entity_id` VARCHAR(64) DEFAULT NULL COMMENT '目标实体 ID(如错题记录ID、练习会话Id)',
  `status`          VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'pending/success/failed',
  `request_payload` TEXT         DEFAULT NULL COMMENT '请求参数(JSON)',
  `response_payload` TEXT        DEFAULT NULL COMMENT '响应数据(JSON)',
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at`    DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_user_action` (`user_id`, `action_id`),
  INDEX `idx_message` (`message_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='快捷操作执行记录';
```

---

## 4. API 接口设计

### 4.1 获取快捷操作推荐列表

客户端在 AI 回答渲染完成后调用此接口，获取该回答对应的快捷操作列表。也可选择纯客户端本地计算（见 4.1.2）。

#### 4.1.1 服务端推荐接口

```
POST /api/v1/ai-chat/quick-actions/recommend
```

**请求体：**
```json
{
  "conversationId": "conv_20260811_001",
  "messageId": "msg_ai_0042",
  "context": {
    "subject": "math",
    "stage": "junior",
    "msgType": "photoQuestion",
    "hasFormula": true,
    "hasImage": false,
    "isFollowUp": false,
    "conversationTurn": 1,
    "knowledgePointId": "kp_linear_equation_001",
    "alreadyInMistakes": false
  }
}
```

**响应体：**
```json
{
  "code": 0,
  "data": {
    "messageId": "msg_ai_0042",
    "actions": [
      {
        "actionId": "explain_simpler",
        "label": "再讲简单点",
        "icon": "icon_simpler.svg",
        "category": "explanationAdjustment",
        "highlighted": false,
        "disabled": false
      },
      {
        "actionId": "generate_similar",
        "label": "练一道同类题",
        "icon": "icon_similar.svg",
        "category": "practiceRecommendation",
        "highlighted": false,
        "disabled": false
      },
      {
        "actionId": "add_to_mistakes",
        "label": "加入错题本",
        "icon": "icon_mistake.svg",
        "category": "mistakeManagement",
        "highlighted": true,
        "disabled": false
      },
      {
        "actionId": "view_related_points",
        "label": "相关知识点",
        "icon": "icon_points.svg",
        "category": "knowledgeExpansion",
        "highlighted": false,
        "disabled": false
      },
      {
        "actionId": "follow_up",
        "label": "继续追问",
        "icon": "icon_followup.svg",
        "category": "followUp",
        "highlighted": false,
        "disabled": false
      },
      {
        "actionId": "report_error",
        "label": "回答有误",
        "icon": "icon_error.svg",
        "category": "contentFeedback",
        "highlighted": false,
        "disabled": false
      }
    ],
    "defaultActionId": "add_to_mistakes"
  }
}
```

#### 4.1.2 纯客户端推荐模式（MVP 首选）

为减少 API 调用开销，MVP 阶段推荐逻辑放在客户端本地执行。服务端接口仅用于后续个性化推荐优化。

```dart
// 客户端本地推荐
class LocalActionRecommender {
  static RecommendedActions recommend({
    required ActionContext context,
    required String messageId,
  }) {
    final candidates = <QuickActionSlot>[];

    // 1. 讲解调整类
    if (context.conversationTurn == 1) {
      if (context.isSTEMSubject) {
        candidates.add(QuickActionSlot(
          action: _registry['explain_simpler']!,
        ));
        candidates.add(QuickActionSlot(
          action: _registry['explain_alternative']!,
        ));
      } else {
        candidates.add(QuickActionSlot(
          action: _registry['explain_detail']!,
        ));
      }
    } else {
      // 追问场景下精简
      candidates.add(QuickActionSlot(
        action: _registry['explain_simpler']!,
      ));
      candidates.add(QuickActionSlot(
        action: _registry['explain_alternative']!,
      ));
    }

    // 2. 练习推荐（仅会员且首轮）
    if (!context.isFollowUp && context.tier != UserMembershipTier.free) {
      candidates.add(QuickActionSlot(
        action: _registry['generate_similar']!,
      ));
    }

    // 3. 错题管理
    if (!context.alreadyInMistakes && context.msgType != MessageType.voiceQuestion) {
      candidates.add(QuickActionSlot(
        action: _registry['add_to_mistakes']!,
        isHighlighted: context.msgType == MessageType.photoQuestion,
      ));
    }

    // 4. 追问
    candidates.add(QuickActionSlot(
      action: _registry['follow_up']!,
      isHighlighted: context.conversationTurn == 1 && !context.isSTEMSubject,
    ));

    // 5. 朗读（幼儿学段强制展示）
    if (context.stage == 'kindergarten') {
      candidates.insert(0, QuickActionSlot(
        action: _registry['read_aloud']!,
        isHighlighted: true,
      ));
    } else if (candidates.length < 6) {
      candidates.add(QuickActionSlot(
        action: _registry['read_aloud']!,
      ));
    }

    // 6. 反馈
    candidates.add(QuickActionSlot(
      action: _registry['report_error']!,
    ));

    // 限制最多 6 个
    final slots = candidates.take(6).toList();

    // 选择默认操作
    final defaultAction = slots.firstWhere(
      (s) => s.isHighlighted,
      orElse: () => slots.first,
    );

    return RecommendedActions(
      messageId: messageId,
      slots: slots,
      defaultActionId: defaultAction.action.id,
      createdAt: DateTime.now(),
    );
  }
}
```

### 4.2 执行快捷操作

```
POST /api/v1/ai-chat/quick-actions/execute
```

**请求体：**
```json
{
  "conversationId": "conv_20260811_001",
  "messageId": "msg_ai_0042",
  "actionId": "add_to_mistakes",
  "params": {
    "questionContent": "...",
    "aiAnalysis": "...",
    "subject": "math",
    "knowledgePointId": "kp_linear_equation_001"
  }
}
```

**响应体（成功）：**
```json
{
  "code": 0,
  "data": {
    "executionId": "exec_20260811_0001",
    "status": "success",
    "targetModule": "mistake_book",
    "targetEntityId": "mistake_20260811_0099",
    "message": "已加入错题本"
  }
}
```

**响应体（异步执行中）：**
```json
{
  "code": 0,
  "data": {
    "executionId": "exec_20260811_0002",
    "status": "pending",
    "estimatedDurationMs": 3000,
    "message": "正在生成同类题..."
  }
}
```

### 4.3 快捷操作行为上报

```
POST /api/v1/ai-chat/quick-actions/track
```

**请求体：**
```json
{
  "events": [
    {
      "messageId": "msg_ai_0042",
      "actionId": "add_to_mistakes",
      "eventType": "shown",
      "timestamp": "2026-08-11T12:24:00.123Z"
    },
    {
      "messageId": "msg_ai_0042",
      "actionId": "add_to_mistakes",
      "eventType": "clicked",
      "timestamp": "2026-08-11T12:24:02.456Z"
    }
  ]
}
```

### 4.4 各操作的专用接口

部分操作有各自独立的服务端接口，快捷操作引擎作为编排层调用：

| 操作 | 实际接口 | 说明 |
| --- | --- | --- |
| `explain_simpler` | `POST /api/v1/ai-chat/messages` (带 `mode=simpler`) | 复用对话接口，附加调节参数 |
| `explain_alternative` | `POST /api/v1/ai-chat/messages` (带 `mode=alternative`) | 同上 |
| `explain_detail` | `POST /api/v1/ai-chat/messages` (带 `mode=detailed`) | 同上 |
| `generate_similar` | `POST /api/v1/practice/generate-similar` | 调用题目生成服务 |
| `add_to_mistakes` | `POST /api/v1/mistakes/add` | 调用错题服务 |
| `add_to_favorites` | `POST /api/v1/favorites/add` | 调用收藏服务 |
| `view_knowledge_map` | 客户端路由跳转 `/knowledge-map/:kpId` | 无需服务端调用 |
| `report_error` | `POST /api/v1/ai-chat/messages/{id}/report` | 调用纠错反馈服务 |
| `read_aloud` | `POST /api/v1/tts/synthesize` | 调用 TTS 服务 |

---

## 5. 核心架构设计

### 5.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    AI 对话页面 (ChatPage)                 │
│                                                         └──┐
│  ┌──────────────────────────────────────────┐               │
│  │         AI 回答消息卡片                    │               │
│  │  (AIMessageBubble)                        │               │
│  └──────────────────────────────────────────┘               │
│  ┌──────────────────────────────────────────┐               │
│  │    QuickActionPanel (本模块)              │ ◄─────────────┘
│  │                                          │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│  │  │ Action1 │ │ Action2 │ │ Action3 │    │
│  │  └─────────┘ └─────────┘ └─────────┘    │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│  │  │ Action4 │ │ Action5 │ │ Action6 │    │
│  │  └─────────┘ └─────────┘ └─────────┘    │
│  └──────────────────────────────────────────┘
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│              QuickActionEngine (核心引擎)                  │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Recommender  │  │  Dispatcher  │  │   Tracker    │  │
│  │ (推荐决策)    │  │ (执行分发)    │  │ (行为追踪)    │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│         │                  │                  │          │
│  ┌──────────────────────────────────────────────────────┐│
│  │           ActionRegistry (操作注册中心)                ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐││
│  │  │ExplainS. │ │Generate. │ │AddMistake│ │FollowUp  │││
│  │  │Executor  │ │Executor  │ │Executor  │ │Executor  │││
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘││
│  └──────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
┌─────────────────┐          ┌─────────────────────┐
│  本地状态管理     │          │  服务端 API           │
│  (ActionStore)  │          │  (ChatService /      │
│                  │          │   MistakeService /   │
│                  │          │   PracticeService)   │
└─────────────────┘          └─────────────────────┘
```

### 5.2 操作注册中心

采用**注册器模式**，所有快捷操作在应用启动时注册到全局注册表中。

```dart
/// 全局操作注册中心
class QuickActionRegistry {
  static final QuickActionRegistry _instance = QuickActionRegistry._();
  factory QuickActionRegistry() => _instance;
  QuickActionRegistry._();

  final Map<String, QuickAction> _actions = {};

  /// 注册操作
  void register(QuickAction action) {
    if (_actions.containsKey(action.id)) {
      throw StateError('QuickAction ${action.id} already registered');
    }
    _actions[action.id] = action;
  }

  /// 批量注册
  void registerAll(List<QuickAction> actions) {
    for (final action in actions) {
      register(action);
    }
  }

  /// 获取操作
  QuickAction? get(String id) => _actions[id];

  /// 获取所有已注册操作
  List<QuickAction> get all => _actions.values.toList();

  /// 按分类获取
  List<QuickAction> byCategory(QuickActionCategory category) {
    return _actions.values
        .where((a) => a.category == category)
        .toList();
  }
}
```

### 5.3 操作执行器接口

每种操作实现统一的 `ActionExecutor` 接口：

```dart
/// 操作执行器抽象接口
abstract class ActionExecutor {
  /// 执行操作
  ///
  /// [context] 执行上下文
  /// [params] 预设参数（来自推荐引擎）
  /// [onProgress] 进度回调（用于异步操作如生成同类题）
  /// 返回执行结果
  Future<ActionResult> execute(
    ActionExecutionContext context,
    Map<String, dynamic> params, {
    void Function(double progress, String message)? onProgress,
  });

  /// 预检查（在执行前判断是否可执行）
  ///
  /// 返回 null 表示可以执行，返回字符串表示不可执行的原因
  String? preCheck(ActionExecutionContext context);

  /// 是否需要用户确认（如删除操作需要二次确认）
  bool get requiresConfirmation => false;

  /// 确认对话框文案（如需要确认）
  String? get confirmationText => null;
}

/// 执行结果
class ActionResult {
  final bool success;
  final String message;
  final String? targetModule;     // 跳转目标模块
  final Map<String, dynamic>? data; // 附加数据

  ActionResult({
    required this.success,
    required this.message,
    this.targetModule,
    this.data,
  });

  factory ActionResult.success({
    String message = '操作成功',
    String? targetModule,
    Map<String, dynamic>? data,
  }) => ActionResult(
    success: true,
    message: message,
    targetModule: targetModule,
    data: data,
  );

  factory ActionResult.failure(String message) => ActionResult(
    success: false,
    message: message,
  );
}
```

---

## 6. 各操作执行器详细实现

### 6.1 讲解调整类执行器

「再讲简单点」「换一种讲法」「再详细一些」三种操作的执行逻辑高度一致，共用一个执行器基类。

```dart
/// 讲解调整执行器
class ExplainAdjustExecutor implements ActionExecutor {
  final String adjustMode; // simpler | alternative | detailed

  ExplainAdjustExecutor(this.adjustMode);

  @override
  Future<ActionResult> execute(
    ActionExecutionContext context,
    Map<String, dynamic> params, {
    void Function(double progress, String message)? onProgress,
  }) async {
    // 1. 构建调整请求
    final request = ChatMessageRequest(
      conversationId: context.conversationId,
      content: _buildAdjustPrompt(context),
      mode: 'explanation_adjust',
      metadata: {
        'adjustMode': adjustMode,
        'originalMessageId': context.aiMessageId,
        'subject': context.context.subject,
        'stage': context.context.stage,
      },
    );

    // 2. 发送新消息（会触发 AI 重新回答）
    // 注意：这个操作的本质是帮用户发送一条调整请求消息
    // 结果作为新的 AI 回答出现在对话流中
    return ActionResult.success(
      message: '正在重新讲解...',
      data: {
        'action': 'send_message',
        'request': request.toJson(),
      },
    );
  }

  String _buildAdjustPrompt(ActionExecutionContext context) {
    switch (adjustMode) {
      case 'simpler':
        return context.context.stage == 'kindergarten' || context.context.stage == 'primary'
            ? '我还是不太明白，能不能用更简单的话再讲一遍？'
            : '请用更简单易懂的方式重新讲解一下。';
      case 'alternative':
        return '能不能换一种方法或思路来讲解这个问题？';
      case 'detailed':
        return '请把步骤讲得更详细一些，我想看清楚每一步是怎么得到的。';
      default:
        return '请重新讲解一下。';
    }
  }

  @override
  String? preCheck(ActionExecutionContext context) {
    // 讲解调整始终可用
    return null;
  }
}
```

### 6.2 加入错题本执行器

```dart
class AddToMistakesExecutor implements ActionExecutor {
  final MistakeService _mistakeService;
  final ConnectivityService _connectivity;

  AddToMistakesExecutor(this._mistakeService, this._connectivity);

  @override
  Future<ActionResult> execute(
    ActionExecutionContext context,
    Map<String, dynamic> params, {
    void Function(double progress, String message)? onProgress,
  }) async {
    // 1. 提取题目内容和 AI 解析
    final questionContent = params['questionContent'] as String?;
    final aiAnalysis = params['aiAnalysis'] as String?;

    if (questionContent == null) {
      return ActionResult.failure('无法获取题目内容');
    }

    // 2. 构建错题数据
    final mistakeData = MistakeCreateDto(
      userId: context.userId,
      subject: context.context.subject,
      stage: context.context.stage,
      questionContent: questionContent,
      aiAnalysis: aiAnalysis ?? '',
      source: context.context.msgType == MessageType.photoQuestion
          ? MistakeSource.photoSearch
          : MistakeSource.aiChat,
      sourceConversationId: context.conversationId,
      sourceMessageId: context.aiMessageId,
      knowledgePointIds: params['knowledgePointIds'] != null
          ? List<String>.from(params['knowledgePointIds'])
          : [],
      errorType: null, // 用户后续在错题本中标注
      createdAt: DateTime.now(),
    );

    // 3. 网络检查
    final isOnline = await _connectivity.isConnected;

    if (isOnline) {
      // 在线模式：直接调用服务端
      try {
        onProgress?.call(0.3, '正在保存...');
        final result = await _mistakeService.create(mistakeData);
        onProgress?.call(1.0, '已加入错题本');

        return ActionResult.success(
          message: '已加入错题本',
          targetModule: 'mistake_book',
          data: {'mistakeId': result.id},
        );
      } catch (e) {
        // 在线失败，降级到离线队列
        await _saveToOfflineQueue(mistakeData, context);
        return ActionResult.success(
          message: '已加入错题本（将在网络恢复后同步）',
        );
      }
    } else {
      // 离线模式：存入本地离线队列
      await _saveToOfflineQueue(mistakeData, context);
      return ActionResult.success(
        message: '已加入错题本（离线保存，网络恢复后自动同步）',
      );
    }
  }

  Future<void> _saveToOfflineQueue(
    MistakeCreateDto data,
    ActionExecutionContext context,
  ) async {
    final queueItem = OfflineActionQueueItem(
      id: 'offline_mistake_${DateTime.now().millisecondsSinceEpoch}',
      actionType: 'add_mistake',
      payload: data.toJson(),
      createdAt: DateTime.now(),
      retryCount: 0,
      maxRetries: 3,
    );
    await OfflineActionQueue.instance.enqueue(queueItem);
  }

  @override
  String? preCheck(ActionExecutionContext context) {
    if (context.alreadyInMistakes) {
      return '该题目已在错题本中';
    }
    return null;
  }
}
```

### 6.3 生成同类题执行器

```dart
class GenerateSimilarExecutor implements ActionExecutor {
  final PracticeService _practiceService;

  GenerateSimilarExecutor(this._practiceService);

  @override
  bool get requiresConfirmation => false;

  @override
  Future<ActionResult> execute(
    ActionExecutionContext context,
    Map<String, dynamic> params, {
    void Function(double progress, String message)? onProgress,
  }) async {
    onProgress?.call(0.1, '正在分析知识点...');

    // 1. 构建同类题生成请求
    final request = SimilarQuestionRequest(
      sourceMessageId: context.aiMessageId,
      subject: context.context.subject,
      stage: context.context.stage,
      knowledgePointId: context.context.knowledgePointId,
      difficulty: params['difficulty'] ?? 'adaptive', // 自适应难度
      count: 1, // 先生成1道
    );

    onProgress?.call(0.3, '正在生成同类题...');

    // 2. 调用服务端生成
    try {
      final response = await _practiceService.generateSimilar(request)
          .timeout(Duration(seconds: 15));

      onProgress?.call(0.8, '生成完成，正在加载...');

      // 3. 跳转到练习页面
      return ActionResult.success(
        message: '同类题已生成',
        targetModule: 'practice',
        data: {
          'practiceSessionId': response.sessionId,
          'questionId': response.questions.first.id,
        },
      );
    } on TimeoutException {
      return ActionResult.failure('生成超时，请稍后重试');
    } catch (e) {
      return ActionResult.failure('生成失败：$e');
    }
  }

  @override
  String? preCheck(ActionExecutionContext context) {
    if (context.tier == UserMembershipTier.free) {
      return '生成同类题是会员功能，升级会员即可使用';
    }
    if (context.context.knowledgePointId == null) {
      return '当前回答未关联知识点，无法生成同类题';
    }
    return null;
  }
}
```

### 6.4 继续追问执行器

```dart
class FollowUpExecutor implements ActionExecutor {
  @override
  Future<ActionResult> execute(
    ActionExecutionContext context,
    Map<String, dynamic> params, {
    void Function(double progress, String message)? onProgress,
  }) async {
    // 1. 获取追问建议（本地生成，无需网络）
    final suggestions = _generateFollowUpSuggestions(context);

    // 2. 返回结果：更新 UI 显示追问建议词
    return ActionResult.success(
      message: '',
      data: {
        'action': 'focus_input',
        'suggestions': suggestions,
      },
    );
  }

  List<String> _generateFollowUpSuggestions(ActionExecutionContext context) {
    final subject = context.context.subject;
    final suggestions = <String>[];

    // 通用追问建议
    suggestions.addAll([
      '这一步是怎么得到的？',
      '为什么要用这个公式？',
      '有没有更简单的方法？',
    ]);

    // 学科特定建议
    switch (subject) {
      case 'math':
        suggestions.addAll([
          '这个知识点常考什么题型？',
          '如果条件变了怎么做？',
        ]);
        break;
      case 'english':
        suggestions.addAll([
          '这个词还有什么用法？',
          '能给我举几个例句吗？',
        ]);
        break;
      case 'chinese':
        suggestions.addAll([
          '这段古文怎么背诵更快？',
          '这个修辞手法还有哪些例子？',
        ]);
        break;
    }

    // 随机取3-4个展示
    suggestions.shuffle();
    return suggestions.take(4).toList();
  }

  @override
  String? preCheck(ActionExecutionContext context) => null;
}
```

### 6.5 回答有误反馈执行器

```dart
class ReportErrorExecutor implements ActionExecutor {
  final FeedbackService _feedbackService;

  ReportErrorExecutor(this._feedbackService);

  @override
  bool get requiresConfirmation => true;

  @override
  String get confirmationText => '感谢反馈！我们会核查此回答。确定提交吗？';

  @override
  Future<ActionResult> execute(
    ActionExecutionContext context,
    Map<String, dynamic> params, {
    void Function(double progress, String message)? onProgress,
  }) async {
    // 1. 先弹出纠错子面板，让用户选择错误类型
    // 这里返回一个特殊结果，由 UI 层处理
    return ActionResult(
      success: true,
      message: 'SHOW_ERROR_REPORT_PANEL',
      data: {
        'action': 'show_panel',
        'panelType': 'error_report',
        'messageId': context.aiMessageId,
      },
    );
  }

  /// 实际提交纠错报告
  Future<ActionResult> submitReport({
    required String messageId,
    required ErrorType errorType,
    String? description,
    String? correctedContent,
  }) async {
    try {
      await _feedbackService.reportAIError(
        messageId: messageId,
        errorType: errorType,
        description: description,
        correctedContent: correctedContent,
      );
      return ActionResult.success(
        message: '感谢反馈，我们会尽快核查并改进',
      );
    } catch (e) {
      return ActionResult.failure('提交失败，请稍后重试');
    }
  }

  @override
  String? preCheck(ActionExecutionContext context) => null;
}
```

---

## 7. 快捷操作面板 UI 组件

### 7.1 面板组件

```dart
/// 快捷操作面板组件
class QuickActionPanel extends ConsumerStatefulWidget {
  final String messageId;
  final List<Message> chatHistory;
  final ActionContext context;

  const QuickActionPanel({
    super.key,
    required this.messageId,
    required this.chatHistory,
    required this.context,
  });

  @override
  ConsumerState<QuickActionPanel> createState() => _QuickActionPanelState();
}

class _QuickActionPanelState extends ConsumerState<QuickActionPanel>
    with TickerProviderStateMixin {
  late AnimationController _fadeController;
  late Animation<double> _fadeAnimation;
  RecommendedActions? _recommended;
  bool _isLoading = true;
  final Map<String, bool> _executingActions = {}; // actionId -> isExecuting
  final Map<String, String?> _actionResults = {}; // actionId -> result message

  @override
  void initState() {
    super.initState();
    _fadeController = AnimationController(
      duration: Duration(milliseconds: 200),
      vsync: this,
    );
    _fadeAnimation = CurvedAnimation(
      parent: _fadeController,
      curve: Curves.easeOut,
    );
    _loadRecommendations();
  }

  void _loadRecommendations() {
    // 本地推荐
    final execContext = ActionExecutionContext(
      conversationId: widget.context.conversationId,
      userMessageId: widget.context.userMessageId,
      aiMessageId: widget.messageId,
      context: widget.context,
      chatHistory: widget.chatHistory,
    );

    _recommended = ref.read(quickActionEngineProvider).recommend(execContext);

    // 上报展示事件
    ref.read(quickActionEngineProvider).trackShown(
      messageId: widget.messageId,
      actions: _recommended!.slots,
    );

    setState(() {
      _isLoading = false;
    });
    _fadeController.forward();
  }

  @override
  Widget build(BuildContext childContext) {
    if (_isLoading || _recommended == null) {
      return SizedBox(height: 0);
    }

    return FadeTransition(
      opacity: _fadeAnimation,
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        child: Wrap(
          spacing: 8,
          runSpacing: 6,
          alignment: WrapAlignment.start,
          children: _recommended!.slots.map((slot) {
            return _buildActionChip(slot);
          }).toList(),
        ),
      ),
    );
  }

  Widget _buildActionChip(QuickActionSlot slot) {
    final isExecuting = _executingActions[slot.action.id] ?? false;
    final resultMessage = _actionResults[slot.action.id];

    if (isExecuting) {
      return ActionChip(
        avatar: SizedBox(
          width: 14,
          height: 14,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
        label: Text('处理中...'),
        backgroundColor: AppColors.chipLoading,
      );
    }

    if (resultMessage != null) {
      // 显示执行结果（短暂展示后消失）
      return ActionChip(
        avatar: Icon(
          resultMessage.startsWith('失败') ? Icons.error_outline : Icons.check,
          size: 16,
          color: resultMessage.startsWith('失败')
              ? AppColors.error
              : AppColors.success,
        ),
        label: Text(resultMessage),
        backgroundColor: resultMessage.startsWith('失败')
            ? AppColors.chipError
            : AppColors.chipSuccess,
      );
    }

    return ActionChip(
      avatar: SvgPicture.asset(
        'assets/icons/${slot.action.iconAsset}',
        width: 16,
        height: 16,
        colorFilter: ColorFilter.mode(
          slot.isHighlighted ? AppColors.primary : AppColors.textSecondary,
          BlendMode.srcIn,
        ),
      ),
      label: Text(slot.action.label),
      backgroundColor: slot.isHighlighted
          ? AppColors.chipHighlight
          : AppColors.chipDefault,
      labelStyle: TextStyle(
        fontSize: 13,
        color: slot.isHighlighted
            ? AppColors.primary
            : AppColors.textPrimary,
        fontWeight: slot.isHighlighted ? FontWeight.w600 : FontWeight.w400,
      ),
      side: slot.isHighlighted
          ? BorderSide(color: AppColors.primary.withValues(alpha: 0.3))
          : BorderSide(color: AppColors.border),
      onPressed: slot.isDisabled ? null : () => _onActionTap(slot),
    );
  }

  Future<void> _onActionTap(QuickActionSlot slot) async {
    // 预检查
    final execContext = _buildExecutionContext();
    final preCheckResult = slot.action.executor.preCheck(execContext);
    if (preCheckResult != null) {
      _showResult(slot.action.id, preCheckResult, isError: true);
      return;
    }

    // 确认检查
    if (slot.action.executor.requiresConfirmation) {
      final confirmed = await _showConfirmation(
        slot.action.executor.confirmationText ?? '确认执行此操作？',
      );
      if (!confirmed) return;
    }

    // 上报点击事件
    ref.read(quickActionEngineProvider).trackClicked(
      messageId: widget.messageId,
      actionId: slot.action.id,
    );

    // 设置加载态
    setState(() {
      _executingActions[slot.action.id] = true;
    });

    // 执行操作
    try {
      final result = await slot.action.executor.execute(
        execContext,
        slot.params,
        onProgress: (progress, message) {
          // 可选：更新加载提示文案
        },
      );

      // 处理结果
      _handleActionResult(slot.action.id, result);
    } catch (e) {
      _showResult(slot.action.id, '操作失败：$e', isError: true);
    } finally {
      setState(() {
        _executingActions[slot.action.id] = false;
      });
    }
  }

  void _handleActionResult(String actionId, ActionResult result) {
    if (!result.success) {
      _showResult(actionId, result.message, isError: true);
      return;
    }

    // 根据结果类型处理
    final action = result.data?['action'];
    switch (action) {
      case 'send_message':
        // 讲解调整：发送新消息
        final request = result.data!['request'];
        ref.read(chatControllerProvider.notifier).sendMessage(
          request['content'],
          metadata: request['metadata'],
        );
        break;

      case 'focus_input':
        // 继续追问：聚焦输入框并显示建议词
        final suggestions = result.data!['suggestions'] as List;
        ref.read(chatInputProvider.notifier).showSuggestions(
          suggestions.cast<String>(),
        );
        FocusScope.of(context).requestFocus(inputFocusNode);
        break;

      case 'show_panel':
        // 显示子面板（如纠错面板）
        _showErrorReportPanel(result.data!['messageId']);
        break;

      default:
        // 默认：显示成功消息
        _showResult(actionId, result.message);

        // 如果需要跳转到其他模块
        if (result.targetModule != null) {
          _navigateToModule(result.targetModule!, result.data);
        }
    }
  }

  void _showResult(String actionId, String message, {bool isError = false}) {
    setState(() {
      _actionResults[actionId] = message;
    });
    // 2秒后清除结果，恢复按钮状态
    Future.delayed(Duration(seconds: 2), () {
      if (mounted) {
        setState(() {
          _actionResults.remove(actionId);
        });
      }
    });
  }

  void _navigateToModule(String module, Map<String, dynamic>? data) {
    switch (module) {
      case 'mistake_book':
        context.push('/mistake-book/detail/${data?['mistakeId']}');
        break;
      case 'practice':
        context.push('/practice/session/${data?['practiceSessionId']}');
        break;
      case 'knowledge_map':
        context.push('/knowledge-map/${data?['knowledgePointId']}');
        break;
    }
  }

  @override
  void dispose() {
    _fadeController.dispose();
    super.dispose();
  }
}
```

### 7.2 面板在消息流中的嵌入

```dart
/// AI 消息气泡（嵌入快捷操作面板）
class AIMessageBubble extends ConsumerWidget {
  final Message message;
  final List<Message> chatHistory;
  final ActionContext context;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // AI 回答内容
        Container(
          margin: EdgeInsets.only(left: 40),
          padding: EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.aiBubbleBackground,
            borderRadius: BorderRadius.circular(12),
          ),
          child: AIAnswerRenderer(
            content: message.content,
            subject: context.subject,
            stage: context.stage,
          ),
        ),

        // 快捷操作面板（仅在回答完成后显示）
        if (message.status == MessageStatus.completed)
          QuickActionPanel(
            messageId: message.id,
            chatHistory: chatHistory,
            context: context,
          ),
      ],
    );
  }
}
```

---

## 8. 状态流转

### 8.1 面板生命周期状态机

```
┌────────────┐     AI回答流结束     ┌──────────────┐
│  HIDDEN    │ ──────────────────► │  LOADING     │
│ (面板隐藏)  │                     │ (推荐计算中)  │
└────────────┘                     └──────┬───────┘
                                          │ 推荐完成
                                          ▼
                                   ┌──────────────┐
                                   │   SHOWN      │
                                   │ (展示操作列表) │
                                   └──────┬───────┘
                                          │ 用户点击操作
                                          ▼
                                   ┌──────────────┐
                                   │  EXECUTING   │
                                   │ (操作执行中)  │
                                   └──────┬───────┘
                                          │
                              ┌───────────┼───────────┐
                              │           │           │
                              ▼           ▼           ▼
                        ┌─────────┐ ┌─────────┐ ┌──────────┐
                        │ SUCCESS │ │ FAILED  │ │ CANCELLED│
                        │(成功态)  │ │(失败态)  │ │(用户取消) │
                        └────┬────┘ └────┬────┘ └──────────┘
                             │           │
                             │ 2秒后恢复  │ 2秒后恢复
                             ▼           ▼
                        ┌──────────────────┐
                        │     SHOWN        │
                        │ (恢复展示操作列表) │
                        └──────────────────┘
```

### 8.2 操作执行状态流转

```dart
/// 操作执行状态枚举
enum ActionExecutionState {
  idle,       // 空闲
  preCheck,   // 预检查中
  confirming, // 等待用户确认
  executing,  // 执行中
  success,    // 成功
  failed,     // 失败
  cancelled,  // 取消
}

/// 状态流转规则
final Map<ActionExecutionState, Set<ActionExecutionState>> _transitions = {
  ActionExecutionState.idle: {
    ActionExecutionState.preCheck,
  },
  ActionExecutionState.preCheck: {
    ActionExecutionState.confirming,
    ActionExecutionState.executing,
    ActionExecutionState.failed,
    ActionExecutionState.idle, // 预检查不通过
  },
  ActionExecutionState.confirming: {
    ActionExecutionState.executing,
    ActionExecutionState.cancelled,
  },
  ActionExecutionState.executing: {
    ActionExecutionState.success,
    ActionExecutionState.failed,
  },
  ActionExecutionState.success: {
    ActionExecutionState.idle, // 恢复
  },
  ActionExecutionState.failed: {
    ActionExecutionState.idle, // 恢复
  },
  ActionExecutionState.cancelled: {
    ActionExecutionState.idle, // 恢复
  },
};
```

---

## 9. 行为追踪与数据分析

### 9.1 埋点事件定义

| 事件名 | 触发时机 | 关键参数 |
| --- | --- | --- |
| `quick_action_shown` | 操作面板展示完成 | `message_id`, `action_ids`, `default_action_id` |
| `quick_action_clicked` | 用户点击某操作 | `message_id`, `action_id`, `category` |
| `quick_action_pre_check_failed` | 预检查未通过 | `message_id`, `action_id`, `reason` |
| `quick_action_execute_start` | 操作开始执行 | `message_id`, `action_id` |
| `quick_action_execute_success` | 操作执行成功 | `message_id`, `action_id`, `duration_ms`, `target_module` |
| `quick_action_execute_failed` | 操作执行失败 | `message_id`, `action_id`, `error_code`, `duration_ms` |
| `quick_action_cancelled` | 用户取消确认 | `message_id`, `action_id` |
| `quick_action_offline_queued` | 操作进入离线队列 | `message_id`, `action_id` |

### 9.2 批量上报策略

为减少网络请求，行为追踪事件采用**批量上报**策略：

```dart
class ActionTracker {
  final List<TrackEvent> _buffer = [];
  Timer? _flushTimer;

  void track(TrackEvent event) {
    _buffer.add(event);

    // 达到 20 条立即上报
    if (_buffer.length >= 20) {
      flush();
      return;
    }

    // 否则等待定时上报（每 10 秒）
    _flushTimer ??= Timer.periodic(Duration(seconds: 10), (_) => flush());
  }

  Future<void> flush() async {
    if (_buffer.isEmpty) return;

    final batch = List<TrackEvent>.from(_buffer);
    _buffer.clear();

    try {
      await _api.batchTrack(batch.map((e) => e.toJson()).toList());
    } catch (_) {
      // 上报失败：放回缓冲区，下次重试
      _buffer.insertAll(0, batch);
    }
  }
}
```

### 9.3 关键分析指标

| 指标 | 计算方式 | 用途 |
| --- | --- | --- |
| 操作展示率 | `shown次数 / AI回答总数` | 衡量面板曝光 |
| 操作点击率(CTR) | `clicked次数 / shown次数` | 衡量推荐精准度 |
| 各操作点击占比 | `某action的clicked次数 / 总clicked次数` | 分析用户偏好 |
| 操作执行成功率 | `success次数 / execute_start次数` | 衡量系统稳定性 |
| 操作执行平均耗时 | `AVG(executed_at - clicked_at)` | 性能监控 |
| 离线队列堆积量 | `offline_queued次数` | 监控弱网体验 |
| 高频操作 Top 5 | 按点击次数排序 | 优化推荐策略 |

---

## 10. 错误处理与降级策略

### 10.1 错误码定义

| 错误码 | 说明 | 处理策略 |
| --- | --- | --- |
| `QA_001` | 操作未注册 | 隐藏该操作按钮，上报异常 |
| `QA_002` | 预检查失败 | 显示禁用原因文案 |
| `QA_003` | 网络不可用 | 根据操作类型决定：离线队列 or 提示网络异常 |
| `QA_004` | 服务端超时 | 显示重试按钮 |
| `QA_005` | 会员权限不足 | 显示升级会员引导 |
| `QA_006` | 操作执行冲突（如重复加入错题本） | 幂等处理，提示"已添加" |
| `QA_007` | 离线队列满（>50条） | 提示"请连接网络后操作" |
| `QA_008` | TTS 服务不可用 | 降级到纯文本展示 |
| `QA_999` | 未知错误 | 显示通用错误提示 + 重试 |

### 10.2 降级策略

```dart
class ActionErrorHandler {
  /// 处理执行错误
  static String handleError(String actionId, dynamic error) {
    // 网络错误
    if (error is SocketException || error is TimeoutException) {
      switch (actionId) {
        case 'add_to_mistakes':
        case 'add_to_favorites':
          // 可离线操作：自动进入离线队列
          return '已保存，将在网络恢复后自动同步';
        case 'generate_similar':
        case 'read_aloud':
          // 不可离线：提示网络问题
          return '网络不给力，请稍后重试';
        default:
          return '网络异常，请稍后重试';
      }
    }

    // 权限错误
    if (error is MembershipRequiredException) {
      return '此功能需要会员，点击升级';
    }

    // 冲突错误（幂等）
    if (error is ConflictException) {
      return '该内容已存在';
    }

    // 通用错误
    return '操作失败，请重试';
  }
}
```

### 10.3 离线队列处理

```dart
/// 离线操作队列
class OfflineActionQueue {
  static final OfflineActionQueue instance = OfflineActionQueue._();
  OfflineActionQueue._();

  final Queue<OfflineActionQueueItem> _queue = Queue();
  final int _maxQueueSize = 50;

  Future<void> enqueue(OfflineActionQueueItem item) async {
    if (_queue.length >= _maxQueueSize) {
      throw OfflineQueueFullException('离线操作队列已满，请连接网络后重试');
    }

    // 持久化到本地存储
    final box = await Hive.openBox<OfflineActionQueueItem>('offline_actions');
    await box.put(item.id, item);
    _queue.add(item);
  }

  /// 网络恢复后自动执行队列中的操作
  Future<void> flush() async {
    while (_queue.isNotEmpty) {
      final item = _queue.removeFirst();
      try {
        await _executeItem(item);
        // 从本地存储移除
        final box = await Hive.openBox<OfflineActionQueueItem>('offline_actions');
        await box.delete(item.id);
      } catch (e) {
        item.retryCount++;
        if (item.retryCount < item.maxRetries) {
          // 重试次数未满，放回队列尾部
          _queue.addLast(item);
          await Future.delayed(Duration(seconds: 2 * item.retryCount));
        } else {
          // 超过最大重试次数，放弃
          // 可选：通知用户操作失败
        }
      }
    }
  }

  Future<void> _executeItem(OfflineActionQueueItem item) async {
    switch (item.actionType) {
      case 'add_mistake':
        final dto = MistakeCreateDto.fromJson(item.payload);
        await GetIt.instance<MistakeService>().create(dto);
        break;
      case 'add_favorite':
        final dto = FavoriteCreateDto.fromJson(item.payload);
        await GetIt.instance<FavoriteService>().create(dto);
        break;
    }
  }
}
```

---

## 11. 性能优化

### 11.1 面板渲染优化

| 优化点 | 策略 |
| --- | --- |
| **推荐计算** | 本地推荐计算 < 5ms，无需异步；服务端推荐可选 |
| **组件构建** | 使用 `const` 构造器，`RepaintBoundary` 隔离重绘 |
| **动画** | 仅 opacity 动画，使用 `FadeTransition`，避免 layout 变化 |
| **图标加载** | SVG 图标预加载到缓存，首次使用时无延迟 |
| **列表虚拟化** | 操作数量 ≤ 6，无需虚拟化 |

```dart
// 使用 RepaintBoundary 隔离面板重绘
class AIMessageBubble extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: Column(
        children: [
          // 消息内容
          _buildMessageContent(),
          // 快捷操作面板
          RepaintBoundary(
            child: QuickActionPanel(...),
          ),
        ],
      ),
    );
  }
}
```

### 11.2 服务端性能

| 优化点 | 策略 |
| --- | --- |
| **推荐接口** | MVP 使用客户端本地推荐，P1 后引入服务端个性化推荐 |
| **执行接口** | 同步操作（如加入错题本）响应 < 200ms；异步操作（如生成同类题）返回 taskId，客户端轮询或 WebSocket 推送结果 |
| **追踪接口** | 批量上报，非关键路径，允许丢失 |

---

## 12. 安全与权限

### 12.1 权限矩阵

| 操作 | 免费用户 | 会员用户 | 幼儿学段 |
| --- | --- | --- | --- |
| `explain_simpler` | ✅ | ✅ | ✅ |
| `explain_alternative` | ✅ | ✅ | ✅ |
| `follow_up` | ✅ | ✅ | ✅ |
| `add_to_mistakes` | ✅ (每日限额) | ✅ | ✅ |
| `add_to_favorites` | ✅ (限额) | ✅ | ✅ |
| `generate_similar` | ❌ | ✅ | ❌ |
| `generate_variants` | ❌ | ✅ | ❌ |
| `view_knowledge_map` | ✅ | ✅ | ❌ |
| `read_aloud` | ✅ (限额) | ✅ | ✅ |
| `report_error` | ✅ | ✅ | ✅ |
| `share_answer` | ✅ | ✅ | ✅ (需家长验证) |

### 12.2 安全措施

1. **频率限制**：同一消息同一操作 3 秒内只允许执行一次（防误触/刷量）
2. **内容脱敏**：分享操作生成图片时去除用户个人信息
3. **会员校验**：服务端二次校验会员状态，防止客户端绕过
4. **行为审计**：所有操作执行记录留存 90 天

---

## 13. 测试要点

### 13.1 单元测试

```dart
group('LocalActionRecommender', () {
  test('首轮理科问答应推荐 explain_simpler', () {
    final context = ActionContext(
      subject: 'math',
      stage: 'junior',
      msgType: MessageType.textQuestion,
      hasFormula: true,
      hasImage: false,
      isFollowUp: false,
      conversationTurn: 1,
      tier: UserMembershipTier.premium,
      alreadyInMistakes: false,
    );

    final result = LocalActionRecommender.recommend(
      context: context,
      messageId: 'test_msg_001',
    );

    expect(result.slots.any((s) => s.action.id == 'explain_simpler'), isTrue);
    expect(result.slots.any((s) => s.action.id == 'follow_up'), isTrue);
    expect(result.slots.any((s) => s.action.id == 'report_error'), isTrue);
  });

  test('非会员不应展示 generate_similar', () {
    final context = ActionContext(
      subject: 'math',
      stage: 'senior',
      msgType: MessageType.photoQuestion,
      hasFormula: false,
      hasImage: true,
      isFollowUp: false,
      conversationTurn: 1,
      tier: UserMembershipTier.free,
      alreadyInMistakes: false,
    );

    final result = LocalActionRecommender.recommend(
      context: context,
      messageId: 'test_msg_002',
    );

    expect(result.slots.any((s) => s.action.id == 'generate_similar'), isFalse);
  });

  test('已在错题本中的题目不应展示 add_to_mistakes', () {
    final context = ActionContext(
      subject: 'math',
      stage: 'junior',
      msgType: MessageType.photoQuestion,
      hasFormula: false,
      hasImage: true,
      isFollowUp: false,
      conversationTurn: 1,
      tier: UserMembershipTier.premium,
      alreadyInMistakes: true,
    );

    final result = LocalActionRecommender.recommend(
      context: context,
      messageId: 'test_msg_003',
    );

    expect(result.slots.any((s) => s.action.id == 'add_to_mistakes'), isFalse);
  });

  test('幼儿学段应将 read_aloud 高亮展示', () {
    final context = ActionContext(
      subject: 'chinese',
      stage: 'kindergarten',
      msgType: MessageType.voiceQuestion,
      hasFormula: false,
      hasImage: false,
      isFollowUp: false,
      conversationTurn: 1,
      tier: UserMembershipTier.premium,
      alreadyInMistakes: false,
    );

    final result = LocalActionRecommender.recommend(
      context: context,
      messageId: 'test_msg_004',
    );

    final readAloudSlot = result.slots.firstWhere(
      (s) => s.action.id == 'read_aloud',
    );
    expect(readAloudSlot.isHighlighted, isTrue);
  });

  test('操作数量不超过 6 个', () {
    for (var i = 0; i < 100; i++) {
      final context = ActionContext(
        subject: ['math', 'physics', 'english', 'chinese'][i % 4],
        stage: ['kindergarten', 'primary', 'junior', 'senior'][i % 4],
        msgType: MessageType.values[i % MessageType.values.length],
        hasFormula: i % 2 == 0,
        hasImage: i % 3 == 0,
        isFollowUp: i % 2 == 1,
        conversationTurn: (i % 5) + 1,
        tier: UserMembershipTier.values[i % UserMembershipTier.values.length],
        alreadyInMistakes: i % 3 == 0,
      );

      final result = LocalActionRecommender.recommend(
        context: context,
        messageId: 'test_msg_$i',
      );

      expect(result.slots.length, lessThanOrEqualTo(6),
          reason: 'Turn $i produced ${result.slots.length} slots');
    }
  });
});
```

### 13.2 集成测试场景

| 场景 | 步骤 | 预期结果 |
| --- | --- | --- |
| 加入错题本-在线 | 拍题→AI解析→点击「加入错题本」 | 提示"已加入错题本"，错题本列表出现新记录 |
| 加入错题本-离线 | 断网→拍题→AI解析→点击「加入错题本」 | 提示"离线保存，网络恢复后同步" |
| 生成同类题-非会员 | 非会员用户→点击「练一道同类题」 | 提示"会员功能"引导升级 |
| 再讲简单点 | 首轮问答→点击「再讲简单点」 | 输入框自动发送调整请求，AI 重新回答 |
| 连续快速点击 | 快速点击同一操作 3 次 | 仅执行第一次，后续提示"操作进行中" |
| 网络恢复后同步 | 离线加入错题本→恢复网络 | 离线队列自动同步，错题本中出现记录 |

---

## 14. 开放问题与后续迭代

| 问题 | 说明 | 计划 |
| --- | --- | --- |
| 个性化推荐 | 当前为规则推荐，后续可引入基于用户行为的个性化推荐模型 | P1.5 |
| 操作 A/B 测试 | 不同操作排列顺序、文案对点击率的影响 | P1 |
| 语音快捷操作 | 幼儿学段支持语音说出操作名称触发 | P2 |
| 长按操作菜单 | 长按操作按钮展示更多子选项（如"分享到朋友圈""分享给好友"） | P2 |
| 操作疲劳度控制 | 同一用户连续多轮对话都被展示相同操作时的降频策略 | P1.5 |
| 跨模块上下文传递 | 从快捷操作跳转到其他模块后，返回时保持对话上下文 | P1 |

---

## 15. 版本记录

| 版本 | 日期 | 修改内容 |
| --- | --- | --- |
| v1.0 | 2026-08-11 | 初始版本 |
