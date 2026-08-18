# 服务端-学生学习上下文全局管理与跨模块AI感知编排引擎-详细设计

## 1. 概述

### 1.1 文档目的

本设计文档详细描述 PrimeTop 系统**学生学习上下文全局管理引擎（Global Learning Context Manager, GLCM）**的架构设计、数据模型、接口规范与核心算法。

GLCM 是整个服务端 AI 能力层的**上下文基础设施**，负责在用户切换不同功能模块（AI 对话、拍照搜题、同步课堂、错题本、练习测评、学习规划等）时，维持一份连贯的、可被 AI 消费的**全局学习上下文**，使 AI 助手在任何入口都能感知学生当前的学习状态、最近行为、薄弱知识点与活跃任务。

### 1.2 设计背景

PrimeTop 的核心交互模式是学生在多个功能模块间频繁切换：

```
同步课堂 → 遇到难题 → 拍照搜题 → AI追问 → 加入错题本 → 练习同类题 → 查看学情
```

当前各模块独立维护上下文，存在以下问题：

| 问题 | 表现 | 影响 |
|------|------|------|
| AI 上下文断裂 | 学生在同步课堂遇到函数问题，切换到 AI 对话提问时，AI 不知道学生在学"二次函数" | AI 回答缺乏针对性，需要学生重新描述背景 |
| 推荐不连贯 | 学生刚在错题本复习了"牛顿第二定律"，首页仍推荐毫不相关的内容 | 用户体验割裂，错失学习连贯性机会 |
| 重复输入负担 | 每次切换模块都要重新选择学科、章节、知识点 | 操作繁琐，降低使用意愿 |
| 学习状态丢失 | 学生中断学习后重新打开 APP，无法快速恢复到之前的学习场景 | 断点续学体验差 |
| 多端不一致 | 手机端学习的数据不能及时反映到平板端的 AI 对话上下文中 | 多设备体验割裂 |

### 1.3 设计目标

1. **全局上下文聚合**：将分散在各模块的学习状态、行为信号、环境信息聚合为统一的上下文视图。
2. **AI 感知增强**：为 AI 对话、拍照搜题、推荐系统等提供结构化的上下文注入，减少冷启动信息缺失。
3. **跨模块导航**：支持模块间学习意图传递，实现"带着问题上 AI"的无缝体验。
4. **上下文持久化**：上下文数据持久化到服务端，支持跨设备、跨会话恢复。
5. **低延迟查询**：上下文查询 P99 < 50ms，不成为 AI 调用链的瓶颈。

### 1.4 术语定义

| 术语 | 定义 |
|------|------|
| GlobalContext | 全局学习上下文，一个学生在某一时刻的完整学习状态快照 |
| ContextLayer | 上下文层级，分为环境层、行为层、知识层、意图层 |
| ContextEntry | 上下文条目，一条具体的上下文信息（如"当前学科:数学"） |
| ContextSnapshot | 上下文快照，某一时间点的 GlobalContext 冻结副本 |
| ContextHotWindow | 热窗口，最近 N 分钟内活跃的上下文，用于实时 AI 注入 |
| ContextColdStore | 冷存储，过期上下文的归档存储，用于长期分析 |

---

## 2. 系统架构

### 2.1 总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        客户端 (APP / Web)                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐│
│  │ AI 对话  │ │ 拍照搜题 │ │ 同步课堂 │ │ 错题本   │ │ ...   ││
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └───┬───┘│
│       │            │            │            │           │     │
│       └────────────┴────────────┴────────────┴───────────┘     │
│                           │ Context SDK                        │
└───────────────────────────┼─────────────────────────────────────┘
                            │ HTTPS / WebSocket
┌───────────────────────────┼─────────────────────────────────────┐
│                       API 网关                                    │
└───────────────────────────┼─────────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────────┐
│                  GLCM 引擎 (本设计核心)                            │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │ 上下文写入   │  │ 上下文查询    │  │ 上下文生命周期管理  │    │
│  │ ContextWrite │  │ ContextQuery │  │ LifecycleManager   │    │
│  └──────┬──────┘  └──────┬───────┘  └─────────┬──────────┘    │
│         │                │                     │                │
│  ┌──────┴────────────────┴─────────────────────┴──────────┐    │
│  │              Context Aggregator (上下文聚合器)           │    │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────────┐ │    │
│  │  │环境层    │ │行为层    │ │知识层    │ │意图层        │ │    │
│  │  │EnvLayer │ │ActLayer │ │KnoLayer │ │IntentLayer   │ │    │
│  │  └─────────┘ └─────────┘ └─────────┘ └──────────────┘ │    │
│  └────────────────────────────────────────────────────────┘    │
│                          │                                      │
│  ┌───────────────────────┴──────────────────────────────────┐  │
│  │                Context Storage (存储层)                    │  │
│  │  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │  │
│  │  │ Redis    │  │ MySQL        │  │ ClickHouse        │  │  │
│  │  │ (热窗口)  │  │ (持久上下文)  │  │ (行为序列归档)     │  │  │
│  │  └──────────┘  └──────────────┘  └───────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │                    │                      │
    ┌────┴────┐         ┌────┴─────┐          ┌─────┴──────┐
    │ AI 对话  │         │ 推荐系统  │          │ 学习规划   │
    │ 服务    │         │ 服务      │          │ 服务       │
    └─────────┘         └──────────┘          └────────────┘
```

### 2.2 核心组件

| 组件 | 职责 | 技术 |
|------|------|------|
| ContextWrite API | 接收各模块的上下文写入请求 | REST + 内部 gRPC |
| ContextQuery API | 提供 AI/推荐等消费方的上下文查询 | REST + GraphQL(可选) |
| Context Aggregator | 多层上下文聚合、冲突解决、优先级排序 | Java/Kotlin |
| LifecycleManager | 上下文 TTL 管理、过期清理、快照触发 | 定时任务 + 事件驱动 |
| EventListener | 监听各业务模块的事件总线消息，自动更新上下文 | Kafka Consumer |
| ContextStorage | 多级存储适配（Redis热/MySQL温/ClickHouse冷） | 存储抽象层 |

### 2.3 上下文消费者

| 消费方 | 用途 | 查询模式 |
|--------|------|----------|
| AI 对话服务 | 注入对话 Prompt，增强回答相关性 | 实时查询热窗口 |
| 拍照搜题服务 | 预判学科与知识点范围 | 实时查询热窗口 |
| 推荐系统 | 个性化内容推荐上下文 | 准实时查询 |
| 学习规划服务 | 根据当前状态调整计划 | 定时查询 |
| 学情分析服务 | 结合上下文生成学情报告 | 批量查询快照 |
| 运营弹窗服务 | 场景化弹窗触发判断 | 实时查询意图层 |

---

## 3. 数据结构设计

### 3.1 GlobalContext（全局上下文）

```java
public class GlobalContext {
    /** 上下文ID（UUID） */
    private String contextId;
    
    /** 学生用户ID */
    private Long userId;
    
    /** 上下文版本号（乐观锁） */
    private Long version;
    
    /** 环境层：设备、时间、网络等 */
    private EnvironmentLayer environment;
    
    /** 行为层：最近的操作行为 */
    private BehaviorLayer behavior;
    
    /** 知识层：当前学习的学科、章节、知识点 */
    private KnowledgeLayer knowledge;
    
    /** 意图层：推测的学习意图 */
    private IntentLayer intent;
    
    /** 上下文创建时间 */
    private LocalDateTime createdAt;
    
    /** 最后更新时间 */
    private LocalDateTime updatedAt;
    
    /** 上下文过期时间 */
    private LocalDateTime expireAt;
    
    /** 上下文来源模块 */
    private SourceModule lastUpdateSource;
}
```

### 3.2 EnvironmentLayer（环境层）

```java
public class EnvironmentLayer {
    /** 当前设备信息 */
    private DeviceInfo device;
    
    /** 当前时间上下文 */
    private TimeContext time;
    
    /** 网络状态 */
    private NetworkState network;
    
    /** APP版本 */
    private String appVersion;
    
    /** 当前页面路由 */
    private String currentRoute;
    
    /** 前一个页面路由 */
    private String previousRoute;
    
    /** 屏幕方向 */
    private ScreenOrientation orientation;
    
    /** 系统外观（深色/浅色） */
    private String appearance;
}

public class DeviceInfo {
    private String deviceId;
    private String platform;      // iOS / Android / Web
    private String deviceModel;   // iPhone 15 Pro, Xiaomi 14
    private String osVersion;
    private Integer screenWidth;
    private Integer screenHeight;
}

public class TimeContext {
    private LocalDateTime currentTime;
    private DayOfWeek dayOfWeek;
    private Boolean isSchoolDay;       // 是否上学日
    private Boolean isPeakStudyTime;   // 是否高效学习时段
    private String season;             // 学期/假期/考前
    /** 时区 */
    private String timezone;
}
```

### 3.3 BehaviorLayer（行为层）

```java
public class BehaviorLayer {
    /** 最近 N 条行为记录（热窗口，默认10条） */
    private List<BehaviorEntry> recentBehaviors;
    
    /** 当前活跃会话信息 */
    private ActiveSession activeSession;
    
    /** 最近完成的任务 */
    private List<TaskCompletion> recentCompletions;
    
    /** 连续学习时长（秒） */
    private Integer continuousStudySeconds;
    
    /** 今日累计学习时长（秒） */
    private Integer todayStudySeconds;
}

public class BehaviorEntry {
    /** 行为ID */
    private String behaviorId;
    
    /** 行为类型 */
    private BehaviorType type;
    // ANSWER_QUESTION, VIEW_EXPLANATION, ADD_MISTAKE,
    // REVIEW_MISTAKE, START_LESSON, FINISH_LESSON,
    // ASK_AI, SEARCH, VIEW_REPORT, CHECK_PLAN...
    
    /** 来源模块 */
    private SourceModule sourceModule;
    
    /** 行为目标（如题目ID、章节ID、对话ID） */
    private String targetId;
    
    /** 行为目标类型 */
    private String targetType;
    
    /** 行为结果 */
    private BehaviorResult result;
    // CORRECT, WRONG, PARTIAL, VIEWED, CREATED, COMPLETED...
    
    /** 行为发生时间 */
    private LocalDateTime timestamp;
    
    /** 行为附加数据 */
    private Map<String, Object> metadata;
}

public class ActiveSession {
    /** 会话ID */
    private String sessionId;
    
    /** 会话类型 */
    private SessionType type;
    // AI_CHAT, PHOTO_SEARCH, SYNC_CLASSROOM, PRACTICE,
    // MISTAKE_REVIEW, PLAN_VIEW, READING...
    
    /** 会话开始时间 */
    private LocalDateTime startTime;
    
    /** 当前模块 */
    private SourceModule currentModule;
    
    /** 会话内行为序列（精简版） */
    private List<String> actionSequence;
    
    /** 会话关联实体 */
    private List<SessionEntity> entities;
}

public class SessionEntity {
    /** 实体类型 */
    private EntityType type;
    // QUESTION, KNOWLEDGE_POINT, CHAPTER, CONVERSATION,
    // MISTAKE, LESSON, PLAN_TASK...
    
    /** 实体ID */
    private String entityId;
    
    /** 关联强度（0-1，越大关联越强） */
    private Double relevance;
    
    /** 实体标题/摘要 */
    private String title;
}
```

### 3.4 KnowledgeLayer（知识层）

```java
public class KnowledgeLayer {
    /** 当前学科 */
    private Subject currentSubject;
    
    /** 当前学段 */
    private Stage currentStage;
    
    /** 当前年级 */
    private Grade currentGrade;
    
    /** 当前教材版本 */
    private String textbookVersion;
    
    /** 当前学习章节（最近访问） */
    private List<ChapterRef> activeChapters;
    
    /** 当前活跃知识点（最近接触/做错/提问的） */
    private List<KnowledgePointRef> activeKnowledgePoints;
    
    /** 当前薄弱知识点（来自学情分析） */
    private List<KnowledgePointRef> weakKnowledgePoints;
    
    /** 最近做错的题目关联知识点 */
    private List<KnowledgePointRef> recentWrongPoints;
}

public class ChapterRef {
    private String chapterId;
    private String chapterTitle;
    private String subject;
    private String textbookVersion;
    private String grade;
    private Double masteryLevel;   // 掌握度 0-1
    private LocalDateTime lastAccessTime;
}

public class KnowledgePointRef {
    private String pointId;
    private String pointName;
    private String subject;
    /** 关联类型：正在学习/薄弱/已掌握/最近提问 */
    private KnowledgeRelation relation;
    /** 掌握度 0-1 */
    private Double masteryLevel;
    /** 最后交互时间 */
    private LocalDateTime lastInteractTime;
    /** 权重（用于排序） */
    private Double weight;
}
```

### 3.5 IntentLayer（意图层）

```java
public class IntentLayer {
    /** 推测的当前学习意图 */
    private LearningIntent currentIntent;
    
    /** 意图置信度（0-1） */
    private Double confidence;
    
    /** 意图推断依据 */
    private List<String> evidence;
    
    /** 待执行的隐式任务 */
    private List<ImplicitTask> pendingTasks;
    
    /** 最近切换模块的路径（用于判断是否在连贯学习） */
    private List<ModuleTransition> recentTransitions;
}

public class LearningIntent {
    /** 意图类型 */
    private IntentType type;
    // HOMEWORK_HELP,       // 作业求助
    // EXAM_PREP,           // 考试备考
    // KNOWLEDGE_REVIEW,    // 知识复习
    // MISTAKE_CORRECTION,  // 错题订正
    // PREVIEW,             // 课前预习
    // EXPLORATORY_LEARN,   // 探索性学习
    // READING_PRACTICE,    // 阅读练习
    // WRITING_PRACTICE,    // 写作练习
    // BROWSE,              // 随意浏览
    // CHECK_PROGRESS       // 查看进度
    
    /** 关联学科 */
    private String subject;
    
    /** 关联知识点（如果有） */
    private String knowledgePointId;
    
    /** 意图描述 */
    private String description;
    
    /** 意图生成时间 */
    private LocalDateTime detectedAt;
}

public class ModuleTransition {
    /** 来源模块 */
    private SourceModule from;
    
    /** 目标模块 */
    private SourceModule to;
    
    /** 切换时间 */
    private LocalDateTime timestamp;
    
    /** 携带的实体（如从错题本带着题目进AI对话） */
    private String carriedEntityType;
    private String carriedEntityId;
}

public class ImplicitTask {
    /** 任务类型 */
    private String type;
    // SUGGEST_REVIEW, SUGGEST_PRACTICE, SUGGEST_ASK_AI...
    
    /** 任务内容描述 */
    private String description;
    
    /** 关联实体 */
    private String entityId;
    
    /** 优先级（1-5，5最高） */
    private Integer priority;
    
    /** 任务过期时间 */
    private LocalDateTime expireAt;
}
```

### 3.6 枚举定义

```java
public enum SourceModule {
    AI_CHAT,           // AI对话
    PHOTO_SEARCH,      // 拍照搜题
    SYNC_CLASSROOM,    // 同步课堂
    PRACTICE,          // 练习测评
    MISTAKE_BOOK,      // 错题本
    STUDY_PLAN,        // 学习规划
    KNOWLEDGE_GRAPH,   // 知识图谱
    EXAM_SIMULATION,   // 考试模拟
    HOME,              // 首页
    PROFILE,           // 个人中心
    PARENT_CENTER,     // 家长中心
    READING,           // 阅读模块
    COMPOSITION,       // 作文辅导
    RECITATION,        // 文科背诵
    PHONICS,           // 拼音识字
    SEARCH             // 全局搜索
}

public enum ContextScope {
    /** 实时热窗口：最近5分钟 */
    HOT_WINDOW,
    /** 会话窗口：当前活跃会话 */
    SESSION,
    /** 日窗口：今天 */
    TODAY,
    /** 周窗口：最近7天 */
    WEEKLY
}
```

---

## 4. 数据库设计

### 4.1 MySQL 持久化表

```sql
-- 全局上下文主表
CREATE TABLE `glcm_context` (
    `context_id`       VARCHAR(36)   NOT NULL COMMENT '上下文UUID',
    `user_id`          BIGINT        NOT NULL COMMENT '学生用户ID',
    `version`          BIGINT        NOT NULL DEFAULT 1 COMMENT '版本号(乐观锁)',
    `environment_json` JSON          COMMENT '环境层数据',
    `behavior_json`    JSON          COMMENT '行为层数据',
    `knowledge_json`   JSON          COMMENT '知识层数据',
    `intent_json`      JSON          COMMENT '意图层数据',
    `status`           VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE/EXPIRED/ARCHIVED',
    `created_at`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `expire_at`        DATETIME(3)   COMMENT '过期时间',
    PRIMARY KEY (`context_id`),
    UNIQUE KEY `uk_user_active` (`user_id`, `status`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_updated` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生学习上下文主表';

-- 上下文变更日志表（审计 + 回溯）
CREATE TABLE `glcm_context_log` (
    `log_id`           BIGINT        NOT NULL AUTO_INCREMENT,
    `context_id`       VARCHAR(36)   NOT NULL,
    `user_id`          BIGINT        NOT NULL,
    `operation`        VARCHAR(20)   NOT NULL COMMENT 'CREATE/UPDATE/MERGE/EXPIRE/SNAPSHOT',
    `source_module`    VARCHAR(30)   COMMENT '变更来源模块',
    `layer`            VARCHAR(20)   COMMENT 'ENVIRONMENT/BEHAVIOR/KNOWLEDGE/INTENT',
    `change_payload`   JSON          COMMENT '变更内容',
    `previous_payload` JSON          COMMENT '变更前内容',
    `operator`         VARCHAR(50)   COMMENT '操作者(system/module_name)',
    `created_at`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`log_id`),
    KEY `idx_context_id` (`context_id`),
    KEY `idx_user_module` (`user_id`, `source_module`),
    KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='上下文变更日志';

-- 上下文快照表（定期冻结）
CREATE TABLE `glcm_context_snapshot` (
    `snapshot_id`      VARCHAR(36)   NOT NULL,
    `context_id`       VARCHAR(36)   NOT NULL,
    `user_id`          BIGINT        NOT NULL,
    `snapshot_json`    JSON          NOT NULL COMMENT '完整上下文快照',
    `snapshot_type`    VARCHAR(20)   NOT NULL COMMENT 'SESSION_END/DAILY/HOURLY/MANUAL',
    `session_id`       VARCHAR(36)   COMMENT '关联会话ID',
    `created_at`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`snapshot_id`),
    KEY `idx_user_created` (`user_id`, `created_at`),
    KEY `idx_context_id` (`context_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='上下文快照';

-- 模块跳转携带实体记录
CREATE TABLE `glcm_module_handoff` (
    `handoff_id`       BIGINT        NOT NULL AUTO_INCREMENT,
    `user_id`          BIGINT        NOT NULL,
    `from_module`      VARCHAR(30)   NOT NULL,
    `to_module`        VARCHAR(30)   NOT NULL,
    `entity_type`      VARCHAR(30)   NOT NULL COMMENT 'QUESTION/KNOWLEDGE_POINT/CHAPTER/CONVERSATION',
    `entity_id`        VARCHAR(64)   NOT NULL,
    `entity_payload`   JSON          COMMENT '携带的实体数据',
    `consumed`         TINYINT(1)    NOT NULL DEFAULT 0 COMMENT '是否已被目标模块消费',
    `consumed_at`      DATETIME(3),
    `expire_at`        DATETIME(3)   NOT NULL,
    `created_at`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`handoff_id`),
    KEY `idx_user_consume` (`user_id`, `consumed`, `expire_at`),
    KEY `idx_expire` (`expire_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='模块跳转携带实体记录';
```

#### v1.0 缺陷修复登记（本版修正）

| # | 缺陷 | 修复方案 |
|---|------|---------|
| 1 | `glcm_context.uk_user_active(user_id, status)` 唯一键约束所有状态行，用户第二次产生 EXPIRED/ARCHIVED 行时撞键，上下文生命周期无法滚动 | 改为 MySQL 8.0 函数唯一索引，仅约束 ACTIVE 行：`CREATE UNIQUE INDEX uk_user_active_only ON glcm_context ((IF(status='ACTIVE', user_id, NULL)));`（NULL 不参与唯一性）；存量迁移需先 `DROP INDEX uk_user_active`，迁移脚本见 §4.6 |
| 2 | `TimeContext.current_time` 字段命名不符合 Java 驼峰规范 | 改为 `currentTime`（§3.2 已同步修正） |
| 3 | `BehaviorType` 枚举注释 `START_LESSION` 拼写错误 | 改为 `START_LESSON`（§3.3 已同步修正） |
| 4 | `glcm_module_handoff` 以 `consumed TINYINT(1)` 表达消费状态，无法表达 REVOKED/SUPERSEDED 等终态，且无幂等约束 | 增补 `status` 列与活跃行函数唯一索引，见 §4.2 |

### 4.2 DDL 增补（v1.1）

```sql
-- 【增补1】handoff 状态列与幂等唯一索引（修复 v1.0 缺陷 #4）
ALTER TABLE `glcm_module_handoff`
    ADD COLUMN `status` VARCHAR(12) NOT NULL DEFAULT 'PENDING'
        COMMENT 'PENDING/CONSUMED/EXPIRED/REVOKED/SUPERSEDED' AFTER `entity_payload`,
    ADD COLUMN `idempotency_key` VARCHAR(64) COMMENT '客户端幂等键(userId:fromModule:toModule:entityType:entityId)',
    ADD COLUMN `consumed_module` VARCHAR(64) COMMENT '实际消费方模块+设备，审计用',
    MODIFY COLUMN `consumed` TINYINT(1) GENERATED ALWAYS AS (IF(`status`='CONSUMED',1,0)) VIRTUAL;

CREATE UNIQUE INDEX `uk_handoff_active` ON `glcm_module_handoff`
    ((IF(status='PENDING', CONCAT(user_id,':',to_module,':',entity_type,':',entity_id), NULL)));

CREATE UNIQUE INDEX `uk_handoff_idem` ON `glcm_module_handoff` (`idempotency_key`);

-- 【增补2】上下文主表函数唯一索引（替换原 uk_user_active，修复 v1.0 缺陷 #1）
ALTER TABLE `glcm_context` DROP INDEX `uk_user_active`;
CREATE UNIQUE INDEX `uk_user_active_only` ON `glcm_context`
    ((IF(status='ACTIVE', user_id, NULL)));

-- 【增补3】意图推断证据表（可解释性与调参回溯）
CREATE TABLE `glcm_intent_infer_log` (
    `infer_id`         BIGINT       NOT NULL AUTO_INCREMENT,
    `user_id`          BIGINT       NOT NULL,
    `context_version`  BIGINT       NOT NULL COMMENT '推断时上下文版本',
    `intent_type`      VARCHAR(30)  NOT NULL,
    `confidence`       DECIMAL(4,3) NOT NULL,
    `evidence_json`    JSON         NOT NULL COMMENT '证据链[{signal,score,weight}]',
    `prev_intent`      VARCHAR(30)  COMMENT '前一意图(用于漂移统计)',
    `adopted`          TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '是否被采纳写入意图层',
    `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`infer_id`),
    KEY `idx_user_created` (`user_id`, `created_at`),
    KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='意图推断日志(采样率见§13容量)' ;

-- 【增补4】Outbox 事件表（与全库事件驱动规范对齐）
CREATE TABLE `glcm_outbox` (
    `event_id`         VARCHAR(64)  NOT NULL COMMENT '事件ID(UUIDv7)',
    `aggregate_type`   VARCHAR(30)  NOT NULL COMMENT 'CONTEXT/HANDOFF/SNAPSHOT/INTENT',
    `aggregate_id`     VARCHAR(64)  NOT NULL,
    `event_type`       VARCHAR(50)  NOT NULL,
    `payload_json`     JSON         NOT NULL,
    `producer`         VARCHAR(64)  NOT NULL DEFAULT 'glcm-service',
    `trace_id`         VARCHAR(64)  COMMENT '链路追踪ID',
    `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `published_at`     DATETIME(3)  COMMENT 'Relay 投递时间',
    `retry_count`     INT          NOT NULL DEFAULT 0,
    `status`           VARCHAR(10)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/PUBLISHED/DEAD',
    PRIMARY KEY (`event_id`),
    KEY `idx_status_created` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='GLCM Outbox 事件表';
```

### 4.3 变更日志写入策略（容量护栏）

`glcm_context_log` 若全量记录每次事件驱动的自动更新，日增量将达千万级（见 §13），必须分层控制：

| 操作类型 | 记录策略 | 理由 |
|---------|---------|------|
| CREATE / EXPIRE / ARCHIVE / SNAPSHOT / MERGE | 100% 全量 | 生命周期关键节点，审计与回溯刚需 |
| 显式写入（模块调用写入 API） | 100% 全量 | 低频高价值，操作者可追责 |
| 事件驱动自动 UPDATE | 采样 10%（按 userId 哈希尾号） | 明细已在埋点平台/ClickHouse 有权威副本，log 仅作变更路径抽查 |
| 意图层变更（intent.shifted） | 100% 全量（层=INTENT） | 意图漂移影响推荐与 AI 注入，需可解释 |

> 采样由 `LogSampler.shouldLog(userId, operation)` 决定，采样率写入配置中心 `glcm.log.sample-rate`，可热更新；变更审计合规要求见 §14-C4。

### 4.4 Redis 数据结构

| # | Key | 类型 | TTL | 用途 |
|---|-----|------|-----|------|
| 1 | `glcm:ctx:{userId}` | String(JSON，热窗口 GlobalContext 压缩序列化) | 30min 滑动（每次读/写刷新） | 热上下文缓存，读路径第一优先级 |
| 2 | `glcm:ver:{userId}` | String(int) | 同 Key1 | 当前版本号，CAS 快速校验 |
| 3 | `glcm:lock:write:{userId}` | String(锁令牌) | 3s | 单写者锁（写路径互斥，见 §8） |
| 4 | `glcm:dirty:{userId}` | String(flag) | 10min | 脏标记，MySQL 延迟刷盘触发器 |
| 5 | `glcm:handoff:{userId}` | ZSET(member=handoffId, score=expireAt 毫秒) | 惰性清理 | 待消费 handoff 索引，查询时过滤 score<now |
| 6 | `glcm:pack:{consumer}:{userId}` | String(JSON) | 60s | ContextPack 裁剪结果缓存（仅只读消费者） |
| 7 | `glcm:rl:write:{userId}` | String(计数器) | 60s 滑动窗口 | 写入限流（默认 120 次/分钟） |
| 8 | `glcm:dedup:evt:{eventId}` | String(1) | 24h | 事件消费幂等去重 |
| 9 | `glcm:idem:write:{idemKey}` | String(handoffId/contextVersion) | 10min | 写入/handoff 创建幂等键 |
| 10 | `glcm:session:ptr:{userId}` | Hash(sessionId/module/startTime) | 2h | 当前活跃会话指针（内容由会话快照引擎权威维护，GLCM 只读镜像） |

> 热上下文超过 64KB 时触发强制裁剪（见 §6.4 预算裁剪器），防止大 JSON 阻塞 Redis；裁剪后仍超限则丢弃 behavior.recentBehaviors 尾部并记监控 M9。

### 4.5 ClickHouse 行为序列归档

```sql
CREATE TABLE glcm_behavior_archive
(
    user_id        UInt64,
    behavior_id    String,
    behavior_type  LowCardinality(String),
    source_module  LowCardinality(String),
    target_type    LowCardinality(String),
    target_id      String,
    result         LowCardinality(String),
    metadata_json  String DEFAULT '',
    event_time     DateTime64(3),
    ingest_time    DateTime64(3) DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (user_id, event_time)
TTL event_time + INTERVAL 180 DAY
SETTINGS index_granularity = 8192;
```

- 归档用途：长期学习行为序列分析、意图推断模型（未来）训练样本、上下文重建（Redis+MySQL 双失时的最后兑底）。
- TTL 180 天与埋点平台行为日志口径对齐（§15 契约对齐 #3）；到期自动删除，不做冷备。

### 4.6 存量迁移脚本

```sql
-- 前置检查：活跃行是否已存在重复（应为 0 行）
SELECT user_id, COUNT(*) FROM glcm_context WHERE status='ACTIVE'
GROUP BY user_id HAVING COUNT(*) > 1;

-- 迁移（低峰期执行，锁表时间 < 1s）
ALTER TABLE `glcm_context` DROP INDEX `uk_user_active`;
CREATE UNIQUE INDEX `uk_user_active_only` ON `glcm_context` ((IF(status='ACTIVE', user_id, NULL)));

-- handoff 存量状态回填
UPDATE `glcm_module_handoff` SET `status` = CASE
    WHEN consumed = 1 THEN 'CONSUMED'
    WHEN expire_at < NOW(3) THEN 'EXPIRED'
    ELSE 'PENDING' END
WHERE `status` = 'PENDING' AND created_at < '2026-09-01';  -- 上线切换日
```

---

## 5. API 接口设计

### 5.1 显式写入接口（客户端/模块服务端调用）

**POST `/api/v1/context/entries`**

```json
{
  "idempotencyKey": "app:9f2c:1719000000",
  "sourceModule": "MISTAKE_BOOK",
  "entries": [
    {
      "layer": "KNOWLEDGE",
      "type": "ACTIVE_KNOWLEDGE_POINT",
      "payload": {
        "pointId": "kp_math_0302",
        "pointName": "二次函数图像",
        "subject": "MATH",
        "relation": "LEARNING",
        "relevance": 0.9
      },
      "ttlSeconds": 7200
    },
    {
      "layer": "INTENT",
      "type": "EXPLICIT_HINT",
      "payload": { "intentType": "MISTAKE_CORRECTION", "confidence": 1.0 }
    }
  ],
  "sessionId": "sess_7d1a",
  "deviceContext": { "deviceId": "hash_5f3a", "currentRoute": "/mistake/123" }
}
```

响应（统一响应封装对齐全库规范）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "contextVersion": 128,
    "accepted": 2,
    "rejected": 0,
    "rejectedDetails": []
  }
}
```

校验规则：

| 规则 | 说明 | 违反错误码 |
|------|------|-----------|
| V1 | `idempotencyKey` 必填，10 分钟内重复提交返回首次结果 | 56202 |
| V2 | 单次 entries ≤ 20 条，payload 单条 ≤ 8KB，总载荷 ≤ 64KB | 56204 |
| V3 | layer/type 必须在注册表内（§5.8），未知类型拒绝不入库 | 56203 |
| V4 | 写入频率 120 次/分钟/用户（Redis 滑动窗口） | 56202 |
| V5 | `deviceId` 必须为哈希形态（客户端预脱敏），禁止明文设备号 | 56203 |
| V6 | EXPLICIT_HINT 类型意图 confidence 固定 1.0，仅允许学生端显式入口调用 | 56212 |

### 5.2 当前上下文查询（客户端）

**GET `/api/v1/context/current?scope=HOT_WINDOW`**

| scope | 返回内容 | 用途 |
|---------|---------|------|
| HOT_WINDOW | 意图层 + 知识层摘要 + 当前会话指针 | 断点续学恢复入口 |
| SESSION | 会话实体 + 携带实体（handoff） | 模块跳转落地页 |
| TODAY | 今日时长 + 完成任务 + 行为统计 | 首页数据卡 |

响应示例（scope=SESSION）：

```json
{
  "code": 0,
  "data": {
    "contextVersion": 128,
    "activeSession": {
      "sessionId": "sess_7d1a",
      "type": "MISTAKE_REVIEW",
      "currentModule": "MISTAKE_BOOK",
      "startTime": "2026-08-18T10:21:33+08:00"
    },
    "pendingHandoffs": [
      {
        "handoffId": "10086",
        "fromModule": "PHOTO_SEARCH",
        "entityType": "QUESTION",
        "entityId": "q_88123",
        "title": "（含二次函数图像的抛物线顶点问题）",
        "expireAt": "2026-08-18T11:30:00+08:00"
      }
    ],
    "knowledge": {
      "currentSubject": "MATH",
      "activeKnowledgePoints": [
        { "pointId": "kp_math_0302", "pointName": "二次函数图像", "relation": "LEARNING", "weight": 0.9 }
      ]
    }
  }
}
```

> 学生本人仅可见自己数据；家长端不提供本接口（家长报告由学情分析服务生成，见 §14-C2）。

### 5.3 ContextPack 查询（AI/推荐等消费方）

**GET `/internal/v1/context/pack?consumer=AI_CHAT&tokenBudget=600`**（内部网关鉴权）

ContextPack 结构（按消费方裁剪后的注入载荷）：

```json
{
  "packVersion": "2026-08-18T10:30:00+08:00/v128",
  "student": {
    "stage": "JUNIOR_HIGH",
    "grade": 9,
    "subject": "MATH",
    "textbookVersion": "PEP"
  },
  "intent": {
    "type": "MISTAKE_CORRECTION",
    "confidence": 0.82,
    "description": "正在订正二次函数相关错题",
    "evidence": ["10分钟内错题本复习3道同类题", "携带拍题实体进入错题本"]
  },
  "knowledge": {
    "activeChapters": [{ "chapterId": "ch_math_9_02", "title": "二次函数", "masteryLevel": 0.62 }],
    "weakPoints": [{ "pointId": "kp_math_0302", "name": "二次函数图像", "masteryLevel": 0.31 }]
  },
  "behavior": {
    "recentSignals": [
      { "type": "REVIEW_MISTAKE", "target": "q_88123", "result": "WRONG", "minutesAgo": 8 }
    ],
    "todayStudyMinutes": 42,
    "continuousStudyMinutes": 25
  },
  "environment": {
    "isPeakStudyTime": true,
    "season": "SEMESTER"
  },
  "truncated": false,
  "degraded": false
}
```

消费方配额与裁剪策略见 §6.4；`degraded=true` 时消费方必须按降级矩阵处理（§11）。

### 5.4 模块跳转携带（Handoff）接口

**POST `/api/v1/context/handoff`**

```json
{
  "idempotencyKey": "9:PHOTO_SEARCH:AI_CHAT:QUESTION:q_88123",
  "fromModule": "PHOTO_SEARCH",
  "toModule": "AI_CHAT",
  "entityType": "QUESTION",
  "entityId": "q_88123",
  "entityPayload": { "title": "抛物线顶点问题", "ocrTextHash": "sim_77aa" },
  "ttlSeconds": 3600
}
```

响应：`{ "handoffId": "10086", "status": "PENDING", "expireAt": "..." }`

- 同一 `(userId, toModule, entityType, entityId)` 活跃 handoff 只允许一个（函数唯一索引）；重复创建返回已有 handoffId（幂等），不报错。
- `entityPayload` ≤ 4KB，仅存引用与摘要，禁止存题目全文/图片（§14-C1）。

**POST `/api/v1/context/handoff/{handoffId}/consume`**

```json
{ "consumeModule": "AI_CHAT", "consumeContext": { "conversationId": "conv_5521" } }
```

- CAS 消费：`UPDATE ... SET status='CONSUMED', consumed_at=NOW(3), consumed_module=? WHERE handoff_id=? AND status='PENDING' AND expire_at > NOW(3)`，影响行数=1 才成功。
- 消费后写入 Outbox `handoff.consumed`（§9），目标模块据此回填跳转转化埋点。

### 5.5 快照接口

| 接口 | 说明 |
|------|------|
| GET `/internal/v1/context/snapshots?userId=&type=&page=` | 分页查询快照（管理端/学情分析） |
| GET `/internal/v1/context/snapshots/{snapshotId}` | 快照详情（含完整 snapshot_json） |
| POST `/internal/v1/context/snapshots/trigger` | 手动触发快照（管理端，需权限 `glcm:snapshot:trigger`） |

### 5.6 内部 gRPC 接口

```protobuf
service GlcmService {
  // 批量获取 ContextPack（推荐系统离线/近线任务用，单批 ≤ 200 用户）
  rpc BatchGetContextPack(BatchPackRequest) returns (BatchPackResponse);
  // 事件驱动写入（内部服务直写，绕过 REST 限流，仍走幂等键）
  rpc ReportEvent(InternalEventRequest) returns (InternalEventResponse);
  // 学习会话状态指针查询（会话快照引擎镜像）
  rpc GetActiveSessionPointer(SessionPtrRequest) returns (SessionPtrResponse);
}
```

### 5.7 管理端接口（挂管理后台权限体系）

| 接口 | 权限点 | 说明 |
|------|--------|------|
| GET `/admin/v1/glcm/context/{userId}` | `glcm:context:read` | 查看用户当前上下文（脱敏视图） |
| GET `/admin/v1/glcm/logs?userId=&op=` | `glcm:log:read` | 变更日志检索 |
| GET `/admin/v1/glcm/metrics/summary` | `glcm:metric:read` | 引擎运行指标摘要 |
| POST `/admin/v1/glcm/context/{userId}/expire` | `glcm:context:expire` | 强制过期（隐私处理/客诉），双人审批 |

> 管理端查看用户上下文属敏感操作：全量审计、默认脱敏、明文查看需二次审批（对齐数据脱敏规范与管理后台审计体系）。

### 5.8 层级/类型注册表（写入白名单）

| layer | type | 写入方 | TTL 默认 |
|-------|------|--------|----------|
| KNOWLEDGE | ACTIVE_KNOWLEDGE_POINT | 各学习模块 | 2h |
| KNOWLEDGE | ACTIVE_CHAPTER | 同步课堂 | 6h |
| KNOWLEDGE | WEAK_POINT_REFRESH | 学情分析服务 | 12h |
| BEHAVIOR | BEHAVIOR_ENTRY | 事件总线自动写入 | 热窗口 30min |
| BEHAVIOR | TASK_COMPLETION | 任务调度引擎事件 | 当日 |
| INTENT | EXPLICIT_HINT | 学生端显式入口 | 30min |
| INTENT | INFERRED | 仅引擎内部（推断器） | 30min |
| ENVIRONMENT | ROUTE_CHANGE / APP_LIFECYCLE | 客户端 SDK | 随主上下文 |

> 注册表存配置中心 `glcm.entry-registry`，热更新双缓冲；未注册 type 拒绝（56203），防止任意写入污染 AI 注入载荷。

---

## 6. 核心流程与算法

### 6.1 上下文写入主链路（双通道）

```
通道A：事件驱动自动更新（主通道，无需业务方改造）
  业务模块 → Kafka(learning-events等Topic) → GLCM EventListener
    → 幂等去重(Redis dedup + 本地 LRU) → 层级路由器 → Aggregator
    → 版本CAS更新(Redis) → 脏标记 → 异步刷盘MySQL(5s/脏量100条触发)
    → 条件触发: 意图重推断 / Outbox

通道B：显式写入（低频高价值）
  客户端SDK/模块服务端 → REST/gRPC → 校验(V1-V6) → Aggregator(同上)
    → 同步刷盘MySQL + 全量变更日志
```

时序图（通道A，以"错题复习"事件为例）：

```
错题服务        Kafka          GLCM-Listener   Aggregator   Redis      MySQL
   │  mistake.reviewed │              │              │          │          │
   │─────────────────>│  consume     │              │          │          │
   │                  │─────────────>│ dedup OK     │          │          │
   │                  │              │──BehaviorEntry+KnowledgeLayer──>   │
   │                  │              │              │ CAS ver++ │          │
   │                  │              │              │<──OK─────│          │
   │                  │              │              │ dirty    │──flush──>│
   │                  │              │<──触发意图重推断(防抖2s)──│          │
```

### 6.2 聚合器与冲突解决

**字段级合并规则（多设备并发写入同一用户）：**

| 层 | 冲突字段 | 解决规则 |
|----|---------|---------|
| ENVIRONMENT | currentRoute / device | 时间戳新者胜（LWW）；不同设备的路由仅保留当前活跃会话设备 |
| BEHAVIOR | recentBehaviors | 追加合并 + 按 timestamp 排序去重（behaviorId 唯一）+ 截断至 N=10 |
| BEHAVIOR | continuousStudySeconds | 取各设备上报的最大值（避免多端双计，与时长对账引擎口径对齐 §15-#7） |
| KNOWLEDGE | activeKnowledgePoints | 按 (pointId, relation) 合并，relevance 取最大，lastInteractTime 取最新 |
| KNOWLEDGE | weakKnowledgePoints | 权威在学情分析服务，GLCM 仅缓存快照 + refreshAt，冲突时直接覆盖本地 |
| INTENT | currentIntent | 显式(1.0) > 高置信推断 > 保留旧值；同置信取新 |

**版本控制**：合并前 `GET glcm:ver:{userId}`，写回时 Lua 脚本校验版本并自增；失败则重读重试（最多 3 次），仍失败则取单写者锁串行化（§8）。

### 6.3 意图推断算法（规则打分 + 证据链）

触发：防抖 2s 聚合一次行为变更；或模块切换事件即时触发。

```
score(intent) = Σ signalScoreᵢ × recencyWeight(signalᵢ) × typeWeight(intent)

recencyWeight: 5min内=1.0 / 30min=0.7 / 2h=0.4 / 6h=0.15
signalScore 示例:
  +0.9  行为result=WRONG且加入错题本       → MISTAKE_CORRECTION
  +0.8  携带QUESTION实体进入AI_CHAT          → HOMEWORK_HELP
  +0.8  连续REVIEW_MISTAKE≥3                → MISTAKE_CORRECTION
  +0.6  START_LESSON且时间∈18:00-22:00上学日 → HOMEWORK_HELP(作业场景)
  +0.6  进入EXAM_SIMULATION模块             → EXAM_PREP
  +0.5  season=考前14天内且查看考点          → EXAM_PREP
  +0.4  FINISH_LESSON后立刻START_LESSON同章节 → KNOWLEDGE_REVIEW
  +0.3  无携带实体进入SEARCH                 → BROWSE
负向:
  ×0.5  当前意图与目标意图学科不一致
typeWeight: 主意图1.0 / 次相关0.5
```

裁决：

| 条件 | 动作 |
|------|------|
| top.score ≥ 0.7 且与当前意图不同 | 采纳写入意图层，confidence = min(0.95, score)，记 intent.shifted Outbox + 全量推断日志（adopted=1） |
| 0.4 ≤ top.score < 0.7 | 保留现意图；pack 注入时附带 `tentativeIntent`（低权重） |
| top.score < 0.4 | 不注入意图 |
| 显式 EXPLICIT_HINT 在 TTL 内 | 免推断，直接以其为准 |

证据链：取贡献度 Top5 信号生成人可读 evidence（用于 AI 消费方可解释与调试），示例见 §5.3。

> 推断为纯规则实现（无模型依赖），单次耗时 < 5ms；规则集版本化存配置中心，变更灰度放量，防固执钻牛角尖的漂移防护：同一意图连续保持 ≥ 2h 且无新证据时 confidence 衰减 ×0.6/h。

### 6.4 ContextPack 裁剪与 Token 预算

消费方预算表（默认，可配置）：

| consumer | tokenBudget | 保留优先级（高→低） |
|----------|-------------|---------------------|
| AI_CHAT | 600 | intent → student → activeKP → activeChapter → recentSignals(3) → weakPoints(3) → environment |
| PHOTO_SEARCH | 200 | student → activeChapter → activeKP → intent(仅subject) |
| RECOMMEND | 300 | intent → activeKP → weakPoints → recentSignals(5) → todayStats |
| STUDY_PLAN | 400 → | weakPoints → activeChapters → intent → recentCompletions |
| OPERATION_POPUP | 120 | intent.type → currentModule → isPeakStudyTime |

裁剪算法（贪心，超预算从优先级尾部逐层丢弃，每层内条目数先减半再整体丢弃）：

```java
public ContextPack buildPack(Long userId, ConsumerProfile consumer, int tokenBudget) {
    GlobalContext ctx = hotStore.get(userId);          // Redis 热窗口
    if (ctx == null) ctx = rebuildFromMySQL(userId);    // 兑底重建（§11-D2）
    ContextPack pack = LayerProjectors.project(ctx, consumer);
    int budget = Math.min(tokenBudget, consumer.maxBudget());
    for (int pri = consumer.priority().size() - 1; pri >= 0 && pack.estimateTokens() > budget; pri--) {
        pack.halveOrDrop(consumer.priority().get(pri));
    }
    pack.setTruncated(pack.estimateTokens() > budget);
    pack.setDegraded(ctx.isStale());                    // 主上下文过期标记透传
    return pack;
}
```

- token 估算：中文字符 ×1 + ASCII ×0.5，向上取整；与 Token 预算分配引擎的计量口径对齐（§15-#4）。
- Pack 缓存 60s 仅对 RECOMMEND/OPERATION_POPUP 等只读消费方生效；AI_CHAT/PHOTO_SEARCH 通道实时构建保证新鲜度。

### 6.5 Handoff 携带与消费流程

```
学生点击"问AI"(拍题解析页)
  → 客户端 SDK: POST /context/handoff (QUESTION:q_88123 → AI_CHAT, TTL 1h)
  → 跳转 AI 对话页
  → 对话页 onReady: GET /context/current?scope=SESSION → pendingHandoffs
  → 自动填充对话输入框上下文卡("关于刚才那道抛物线题提问")
  → 学生发送首条消息时: POST /handoff/10086/consume
  → AI 对话服务拉取 ContextPack(AI_CHAT) 组装 system 注入
```

守卫：
- handoff 未消费即离开：保留 PENDING 至 TTL，期间目标模块任意入口可见（含深链接二次进入）。
- TTL 过期：查询时惰性判定（ZSET score < now 即过滤）+ 每 5min 扫描器落库 EXPIRED（不删除行，保留转化分析）。
- 学生在源模块删除实体（错题删除/对话删除）：源模块发实体删除事件，GLCM 将关联 PENDING handoff 置 REVOKED。

### 6.6 生命周期管理

```
ACTIVE ──(30min 无任何更新且无活跃会话)──> IDLE(仅Redis, MySQL不动作)
IDLE   ──(新活动)──────────────────────> ACTIVE
IDLE   ──(连续 7 天无活动)──────────────> EXPIRED(快照落库, Redis 清除, Outbox: context.expired)
EXPIRED──(用户回归)────────────────────> 新建 ACTIVE 上下文(引用快照链 prevContextId)
EXPIRED──(90 天)───────────────────────> ARCHIVED(快照迁冷存, 主表行删除, 注册存储清理引擎)
```

快照触发点：

| 触发 | 类型 | 时机 |
|------|------|------|
| 会话结束 | SESSION_END | 会话快照引擎 session.ended 事件（延迟 10s 防抖，合并 10s 内多次结束） |
| 日终 | DAILY | 每日 03:00 定时（本地时区），仅当日有变更的用户 |
| 手动 | MANUAL | 管理端触发 |
| 过期前 | EXPIRE | 进入 EXPIRED 前强制一次（防止 7 天窗口内未触发日终快照的用户丢状态） |

### 6.7 多端同步与版本冲突

- 写路径单写者锁 `glcm:lock:write:{userId}`（3s）：同用户并发写串行化，防 Redis Lua 重试风暴。
- 读路径：客户端不订阅上下文推送；各模块进入时按需拉取（§5.2），版本号 `contextVersion` 用于客户端缓存协商（If-None-Match 语义，304 降低流量）。
- 多设备同账号：知识层/意图层全局共享（账号维度）；环境层仅活跃设备有效（Presence 服务判定主设备，§15-#2）。

---

## 7. 状态机设计

### 7.1 上下文主状态机

```
ACTIVE ⇄ IDLE → EXPIRED → ARCHIVED(终态)
           ↑        │
           └─回归新建┘
```

| 守卫 | 规则 |
|------|------|
| G1 | 仅 ACTIVE/IDLE 状态可接受写入；EXPIRED/ARCHIVED 收到新事件时先复活（新建 ACTIVE 行，prevContextId 链接） |
| G2 | IDLE → EXPIRED 必须先完成 EXPIRE 快照；快照失败则留在 IDLE 重试（次日扫描） |
| G3 | EXPIRED → ARCHIVED 仅由归档扫描器执行（90 天），业务不可触发 |
| G4 | ARCHIVED 后 MySQL 主表行删除，仅保留快照与归档；查询返回 56217 提示回源快照 |
| G5 | 管理端强制过期走双人审批，等价 G2 快照路径 + 审计留痕 |

### 7.2 Handoff 状态机

```
PENDING → CONSUMED(终态)
PENDING → EXPIRED(终态, TTL到)
PENDING → REVOKED(终态, 源实体删除)
PENDING → SUPERSEDED(终态, 同实体同目标新handoff创建时旧记录让位)
```

| 守卫 | 规则 |
|------|------|
| G6 | 仅 PENDING 可消费；CAS 影响行数=1 才算成功，重复消费返回 56206（幂等语义：同 consumed_module 重复请求返回首次结果，不同模块返回 403 语义 56208） |
| G7 | 已终态 handoff 不可复活；同键重新创建走新建（函数唯一索引只约束 PENDING 行） |
| G8 | consume 时 expire_at ≤ now 视为 EXPIRED，返回 56207，客户端引导重新携带 |
| G9 | entityPayload 只读，创建后不可修改（防篡改）；标题类字段由源模块实体快照脱敏生成 |

### 7.3 快照类型与不可变性

| 守卫 | 规则 |
|------|------|
| G10 | 快照 JSON 落库后不可变（无 UPDATE 路径）；修正需求新建快照并引用 correctedSnapshotId |
| G11 | SESSION_END 快照与 DAILY 快照可能覆盖同一时间段：查询默认返回最新，时间线并列展示 |
| G12 | 快照内敏感字段在生成时即脱敏（deviceId 哈希、无题目原文），事后无需再脱敏 |

---

## 8. 幂等与并发控制

| 场景 | 机制 |
|------|------|
| 事件消费 | `glcm:dedup:evt:{eventId}` SETNX 24h + 本地 LRU（10 万条）双层；重复事件静默丢弃记指标 M6 |
| 显式写入 | `idempotencyKey` → `glcm:idem:write:{key}`，10min 内返回首次结果（含 contextVersion） |
| handoff 创建 | 函数唯一索引（PENDING 行）+ 幂等键唯一索引双保险；冲突返回已有记录 |
| handoff 消费 | 状态 CAS（§5.4），无锁竞争 |
| 上下文并发写 | Redis Lua 版本 CAS；3 次失败升级单写者锁串行重试 |
| MySQL 刷盘 | 脏队列按 userId 分区串行（同用户顺序性）；刷盘失败重试 2^n 退避，5 次进死信表（复用 glcm_outbox DEAD 语义，aggregate_type=CONTEXT_FLUSH） |
| 快照生成 | 快照幂等键 `snap:{contextId}:{type}:{date}`，唯一索引防日终任务重跑双份 |
| 定时任务 | 分片游标 + Redis 任务锁（对齐服务端定时任务调度规范） |

---

## 9. 事件设计

### 9.1 GLCM 订阅事件（输入，Kafka 消费矩阵）

| Topic / 事件 | 生产方 | 更新层 | 幂等键 |
|--------------|--------|--------|--------|
| learning-events: practice.answer.submitted | 练习服务 | BEHAVIOR+KNOWLEDGE | eventId |
| learning-events: homework.graded | 作业服务 | BEHAVIOR+KNOWLEDGE | eventId |
| mistake-events: mistake.added / mistake.reviewed | 错题服务 | BEHAVIOR+KNOWLEDGE | eventId |
| content-events: chapter.progress.updated | 同步课堂 | KNOWLEDGE | eventId |
| ai-events: ai.conversation.started / message.sent | AI 对话引擎 | BEHAVIOR+ENVIRONMENT | eventId |
| photo-events: photo.search.completed | 拍题服务 | BEHAVIOR+KNOWLEDGE | eventId |
| session-events: session.started / session.ended | 会话快照引擎 | BEHAVIOR(activeSession)+快照触发 | eventId |
| task-events: task.completed | 任务调度引擎 | BEHAVIOR(recentCompletions) | eventId |
| profile-events: mastery.weakpoints.refreshed | 学情分析 | KNOWLEDGE(weakPoints 缓存覆盖) | eventId |
| entity-events: question.deleted / mistake.deleted | 各源模块 | handoff REVOKED 触发 | eventId |

> 消费失败进死信 Topic `glcm.events.dlt`，告警人工介入；积压超 5 分钟自动触发降级 D4（暂停自动更新）。

### 9.2 GLCM 发布事件（输出，glcm_outbox → Relay → Topic `glcm.domain.events`）

| 事件 | 触发 | 主要消费方 | 消费方幂等建议 |
|------|------|-----------|---------------|
| glcm.intent.shifted | 意图采纳且变化（conf≥0.7） | 推荐引擎、运营弹窗服务、AI 对话入口 | (eventId, consumer) |
| glcm.context.expired | 上下文进入 EXPIRED | 学习提醒服务（断更关怀信号源之一）、学情分析 | (eventId, consumer) |
| glcm.handoff.created | handoff 创建 | 埋点平台（跳转漏斗） | (eventId, consumer) |
| glcm.handoff.consumed | handoff 消费 | 埋点平台、源模块（转化率统计） | (eventId, consumer) |
| glcm.snapshot.created | 快照落库 | 学情分析服务 | (snapshotId) 幂等 |

统一事件信封对齐事件驱动架构规范：`{eventId, eventType, occurredAt, producer:"glcm-service", traceId, payload}`；Relay 每 500ms 批量拉取 PENDING → 投递 Kafka → 标记 PUBLISHED，日终与 Kafka 侧对账，差异重发；重试 5 次进 DEAD 并 P1 告警。

---

## 10. 错误码设计（56200-56299）

| 错误码 | 场景 | 客户端提示建议 |
|--------|------|----------------|
| 56200 | 上下文不存在（新用户/已归档且无快照） | 静默，走空状态初始化 |
| 56201 | 乐观锁版本冲突（重试后仍失败） | 客户端重新拉取后再提交 |
| 56202 | 幂等键缺失/写入频率超限 | 稍后重试 |
| 56203 | 层级/类型/设备号等字段非法 | 不提示（客户端bug，上报日志） |
| 56204 | 载荷超限（单条8KB/总量64KB/pack 4KB） | 内容过长，请精简 |
| 56205 | handoff 不存在 | 引导重新携带 |
| 56206 | handoff 已消费（同模块幂等返回首次结果） | 静默 |
| 56207 | handoff 已过期 | 该携带内容已过期，请重新发起 |
| 56208 | handoff 非本人/非目标模块 | 无权限 |
| 56209 | 快照不存在 | 记录已过期 |
| 56210 | 消费方未注册（pack consumer） | 内部错误（消费方接入未配置） |
| 56211 | tokenBudget 超出消费方上限 |
| 56212 | 意图类型非法/EXPLICIT_HINT 越权 |
| 56213 | scope 查询范围非法 |
| 56214 | 管理端权限不足/审批未通过 |
| 56215 | 存储暂不可用（降级中，附 degraded 字段） | 上下文服务暂时受限，功能可正常使用 |
| 56216 | 事件积压（消费方拉取时感知） | 内部错误 |
| 56217 | 上下文已归档，需回源快照接口 |
| 56218 | 批量接口用户数超限（>200） |
| 56219 | 聚合/裁剪超时（内部熔断触发） | 降级返回最小包 |

> 错误码段 56200-56299 已与全库错误码登记表核对无冲突（56100 学习路径 / 56900 测试支撑相邻段）。

---

## 11. 降级矩阵

| # | 故障 | 行为 | 用户感知 |
|---|------|------|---------|
| D1 | Redis 不可用 | 读路径直查 MySQL（Pack P99 放宽至 200ms）；写路径同事务直写 MySQL，放弃热窗口 | 无感（延迟略增） |
| D2 | Redis 数据丢失/大 Key 重建 | 从 MySQL 持久上下文重建热窗口；行为序列缺失部分从 ClickHouse 回放近 30min | 无感 |
| D3 | MySQL 不可用 | 写路径仅更新 Redis（TTL 缩短至 10min）+ 本地磁盘 WAL 补偿队列；查询正常 | 无感；恢复后补偿刷盘 |
| D4 | 事件总线积压 >5min | 暂停自动更新通道，显式写入通道保留；Pack 基于最后一致状态（stale 标记） | AI 注入可能略滞后 |
| D5 | 意图推断异常/超时 | 不注入意图层，Pack 照常返回其余层 | 无感 |
| D6 | Pack 裁剪超时（>50ms） | 返回兑底最小包（student 基础信息，degraded=true） | AI 回答泛化，不报错 |
| D7 | 快照生成失败 | 重试 2^n 退避 5 次；失败不影响主链路，登记补偿任务 | 无感 |
| D8 | handoff 扫描器滞后 | 查询侧惰性过滤 expire_at（ZSET score），不依赖扫描器 | 无感 |
| D9 | 多设备写入冲突风暴（版本 CAS 失败率>30%） | 单写者锁窗口延长至 10s，写入合并批量提交 | 极端并发下毫秒级延迟 |
| D10 | GLCM 整体不可用 | 网关对 /context/* 返回 56215 + 兜底静态包（仅年级/学科，来自用户服务缓存）；各消费方必须能容忍 pack 缺失（AI 对话无上下文仍可回答） | AI 回答缺乏个性化，核心学习功能不受影响 |

> 设计红线：GLCM 属增强型基础设施，任何降级不得阻塞业务主链路；消费方对 pack 的依赖必须是软依赖。

---

## 12. 监控指标

| # | 指标 | 口径 | 告警阈值 |
|---|------|------|---------|
| M1 | Pack 查询 P99 | internal pack 接口 | >50ms 持续 5min（P2）/ >200ms（P1） |
| M2 | 写入延迟 P99（事件→Redis生效） | listener 处理耗时 | >200ms（P2） |
| M3 | 事件消费 lag | Kafka consumer lag | >5min（触发 D4）/ >30min（P1） |
| M4 | handoff 消费率 | consumed/(created-expired-revoked) 7 日窗口 | <40%（产品转化，P3 提示） |
| M5 | 意图注入覆盖率 | pack 中 intent 非空占比 | 周环比下降 >10pct（P3，疑似推断规则回归） |
| M6 | 事件重复消费率 | dedup 命中/总消费 | >5%（上游重复投递或消费 rebalance 异常，P2） |
| M7 | 版本冲突率 | CAS 失败/写入总数 | >5%（P2）/ >30%（触发 D9） |
| M8 | MySQL 刷盘积压 | 脏队列深度 | >10000（P2）/ WAL 补偿启用（P1） |
| M9 | 热上下文超大裁剪次数 | 64KB 裁剪触发/分钟 | >100/min（P3，检查异常写入方） |
| M10 | Outbox DEAD 数 | 死信事件数 | >0（P1，事件丢失风险） |

---

## 13. 容量估算（DAU 50 万基准）

| 项 | 估算 | 说明 |
|-----|------|------|
| 活跃上下文 | 50 万行 glcm_context(ACTIVE+IDLE) | 一人一活跃行 |
| 事件消费 | 日均 2000 万条（订阅 10 类事件加权） | 峰值 3000/s（晚间 19:00-22:00） |
| Redis 热窗口 | 50 万 × ~8KB ≈ 4GB（含 handoff/pack/dedup） | 集群内存预估 8GB（含副本与碎片） |
| MySQL glcm_context | 50 万行 + 历史快照链，< 1GB | 行数稳定（ARCHIVED 删除） |
| glcm_context_log | 全量类操作约 150 万/日 + 采样 10% 更新约 60 万/日 ≈ 210 万/日，月分区保留 90 天 | 约 12GB/90天 |
| glcm_context_snapshot | 日终 50 万 + 会话结束均 3 次 ≈ 200 万/日（JSON 均 4KB） | 约 40GB/90天，建议 90 天后迁对象存储压缩包 |
| glcm_intent_infer_log | 采样 5%（防抖后触发日均 20 亿次×5%） ≈ 1000 万/日，仅存 30 天 | 约 6GB/30天 |
| ClickHouse 归档 | 2000 万/日 × 200B ≈ 4GB/日，TTL 180 天滚动 | 单分片即可承接 |
| gRPC/REST QPS | pack 峰值 2000/s（推荐+AI 双峰叠加） | 4C8G×6 实例（含 1 实例冗余） |

---

## 14. 合规红线（未成年人数据重点）

| # | 红线 |
|---|------|
| C1 | 上下文仅存实体引用（ID/标题摘要/哈希），禁止存题目全文、图片、对话原文、作文内容——明细永远以源模块为权威 |
| C2 | 上下文不对家长端/教师端直接暴露（无查询接口）；家长报告由学情分析服务基于自身权威数据生成 |
| C3 | deviceId 一律哈希形态入库（客户端预脱敏 + 服务端复校验），不存 IMEI/OAID 明文 |
| C4 | 管理端查看用户上下文：默认脱敏视图，明文需二次审批，全量审计（对齐审计日志体系与数据脱敏规范） |
| C5 | 保留期限：在线上下文 90 天（ARCHIVED 后删除主表行）、快照 90 天后转对象存储、行为归档 180 天、意图日志 30 天；到期由存储清理引擎统一执行 |
| C6 | 账号注销：GLCM 注册到统一清理引擎回调清单，级联删除上下文/快照/handoff/日志（保留法定审计必要的匿名化统计） |
| C7 | AI 注入红线：Pack 只含本学生数据；薄弱点表述仅传 ID+数值，成长型话术由消费方负责；禁止跨学生任何数据进入 Pack |
| C8 | 推断意图等算法决策用于功能优化，不用于对未成年人的画像营销投放（运营弹窗消费方仅限学习场景弹窗，禁止商业广告定向，对齐青少年模式风控引擎） |

---

## 15. 契约对齐与边界

| # | 对齐项 | 结论 |
|---|--------|------|
| 1 | 《服务端-学习会话状态快照与跨设备无缝接续恢复引擎》 | 会话内页面级状态恢复归它；GLCM 不存页面明细，仅镜像会话指针（Redis Key10，只读）并消费 session.started/ended 驱动行为层与快照 |
| 2 | 《服务端-实时用户Presence服务与多端活跃状态同步引擎》 | 设备在线/主设备判定归它；GLCM 环境层活跃设备裁决引用其结论，不重复心跳 |
| 3 | 《服务端-统一用户行为埋点平台与事件流处理管线》 | 行为事件权威源；GLCM 订阅其 Kafka Topic 子集；ClickHouse TTL 180 天口径一致 |
| 4 | 《服务端-大模型推理上下文窗口Token预算智能分配与动态裁剪压缩引擎》 | Token 总预算归它；GLCM Pack 是其输入之一，tokenBudget 参数由它传入，计量口径对齐 §6.4 |
| 5 | 《服务端-学习内容阅读上下文智能提取与AI辅导对话上下文注入管线引擎》 | 阅读器内上下文提取与注入归它；其产物通过事件回流 GLCM 行为层（类型注册表 BEHAVIOR_ENTRY） |
| 6 | 《服务端-多源学习任务统一调度与优先级仲裁引擎》 | ImplicitTask 仅作推荐信号，不直接投递任务队列，防双头投递；任务权威在调度引擎 |
| 7 | 《服务端-学生学习时长跨模块统一归因与对账引擎》 | 连续学习时长取多端最大值的口径与其防双计规则对齐 |
| 8 | 《服务端-学情分析》《知识追踪模型引擎》 | weakKnowledgePoints/masteryLevel 权威在学情侧，GLCM 仅缓存 + refreshAt，过期回源 |
| 9 | 《服务端-存储资源统一生命周期管理与过期数据自动清理引擎》 | 快照转存/日志删除/注销级联均注册为其策略项 |
| 10 | 《服务端-统一响应封装与分页查询规范》《服务端-统一业务异常码与错误分类体系》 | REST 响应/错误码/分页完全对齐；56200 段为本模块专属段 |
| 11 | 《服务端-事件驱动架构与统一事件总线详细设计》 | Outbox/信封/Relay/死信/DLT 规范全部沿用 |
| 12 | v1.0 缺陷修复 | uk_user_active 撞键（函数唯一索引）、TimeContext.current_time 命名、START_LESSION 拼写、handoff 状态语义不足（status 列），见 §4.2 登记表 |

---

## 16. 验收场景

| # | 场景 | 预期 |
|---|------|------|
| 1 | 学生在同步课堂学二次函数 → 5 分钟内切到 AI 对话提问“顶点怎么求” | Pack 含 activeChapter=二次函数、intent≥0.7 相关意图，AI 回答引用当前章节语境 |
| 2 | 拍题解析页点“问AI”携带题目跳转 | handoff 创建成功，对话页可见携带卡，发送消息后 consume 成功，再次进入不重复出现 |
| 3 | 同一 handoff 重复 consume（同模块） | 返回首次结果（56206 幂等语义），无二次副作用 |
| 4 | handoff 超 TTL 后 consume | 返回 56207，客户端引导重新携带 |
| 5 | 错题本连续复习 3 道牛顿定律错题 | 2 分钟后意图层 MISTAKE_CORRECTION 且证据链含“连续复习 3 道”；推荐引擎收到 intent.shifted |
| 6 | 双设备同时写（平板学英语+手机做数学） | 版本 CAS 成功合并两学科 activeKnowledgePoints；无丢失 |
| 7 | Redis 击穿（删除热 Key 后查询 Pack） | 从 MySQL 重建热窗口，P99 ≤ 200ms，内容完整 |
| 8 | Kafka 积压 10 分钟 | 自动更新暂停（D4），显式写入仍生效，Pack 返回 stale 标记 |
| 9 | 连续 7 天不活跃后回归 | 旧上下文 EXPIRED+快照落库，新建 ACTIVE 链接 prevContextId，断点续学可从快照恢复 |
| 10 | 日终快照任务重跑 | 幂等键防重，不产生重复快照 |
| 11 | 未注册 type 写入 | 返回 56203，拒绝入库，上下文无污染 |
| 12 | 写入超限载荷（单条>8KB） | 返回 56204，其余合法条目正常处理（部分成功语义在 rejectedDetails 说明） |
| 13 | 源模块删除错题 | 关联 PENDING handoff 自动 REVOKED，对话页不再出现携带卡 |
| 14 | 上下文 64KB 裁剪触发 | recentBehaviors 尾部丢弃，Pack 正常返回，M9 计数 |
| 15 | 管理端强制过期（双人审批） | 快照留痕，上下文 EXPIRED，审计完整 |
| 16 | 账号注销 | 7 日内 GLCM 全部数据级联清除（清理引擎回调） |
| 17 | GLCM 服务整体宕机 5 分钟 | AI 对话/拍题等主链路正常（静态兑底包），恢复后自动补齐 |
| 18 | 学生端显式入口选择“我要考前冲刺” | EXPLICIT_HINT confidence=1.0 免推断直接生效，后续 30min 内 Pack 意图稳定不被规则推断覆盖 |

---

## 17. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-08-10 | 初稿：概述/架构/数据结构/部分 DDL（截断于 glcm_module_handoff 索引定义处） |
| v1.1 | 2026-08-18 | 补全烂尾文档：完成 §4.1 DDL 与 §4.2-§4.6（DDL 增补/变更日志采样策略/Redis 十类 Key/ClickHouse 归档/迁移脚本），新增 §5 API 八节（显式写入 V1-V6/客户端查询三 scope/ContextPack/Handoff 创建消费 CAS/快照/gRPC/管理端/类型注册表）、§6 核心流程七节（双通道写入/字段级合并规则/意图推断打分算法与裁决/Token 预算贪心裁剪/Handoff 生命周期/四状态生命周期/多端同步）、§7 三套状态机守卫 G1-G12、§8 幂等并发八场景、§9 事件双向矩阵（订阅 10 类/发布 5 类）、§10 错误码 56200-56299 共 20 项、§11 降级 D1-D10（软依赖红线）、§12 监控 M1-M10、§13 容量估算、§14 合规 C1-C8、§15 契约对齐 12 项、§16 验收 18 条；修复 v1.0 四处缺陷（uk_user_active 撞键/字段命名/枚举拼写/handoff 状态语义） |