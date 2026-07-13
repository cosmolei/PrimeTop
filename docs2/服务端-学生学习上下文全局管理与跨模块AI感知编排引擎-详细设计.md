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
    private LocalDateTime current_time;
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
    // REVIEW_MISTAKE, START_LESSION, FINISH_LESSON,
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
    KEY `idx_user_consume