# 服务端-AI对话历史存储检索与知识沉淀服务 详细设计

## 1. 概述

### 1.1 功能定位

AI辅导对话是PrimeTop平台最高频的用户交互行为，每日产生数百万条对话消息。本服务负责对话数据的**持久化存储、高效检索、知识标签索引、跨会话知识沉淀与数据生命周期管理**，为学生端提供对话历史回溯、知识点相关对话检索、学习证据链追溯等核心能力。

### 1.2 设计目标

| 目标 | 指标 |
| --- | --- |
| 对话写入延迟 | P99 < 50ms（单条消息） |
| 历史列表查询 | P99 < 200ms（分页20条） |
| 全文检索响应 | P99 < 500ms（返回Top-20） |
| 知识点关联查询 | P99 < 300ms（指定知识点+最近50条） |
| 数据可靠性 | 消息零丢失，写入成功率 > 99.99% |
| 存储成本控制 | 6个月以上冷数据自动归档，热数据SSD存储 |

### 1.3 与现有模块的关系

| 模块 | 关系说明 |
| --- | --- |
| AI对话引擎与会话管理 | 上游模块，负责实时对话编排，将完成的会话/消息投递给本服务持久化 |
| AI模型上下文管理与对话记忆引擎 | 协作模块，从本服务读取历史消息用于构建LLM上下文窗口 |
| 客户端-AI对话历史管理与会话组织系统 | 下游消费者，通过本服务API获取历史数据并渲染 |
| 服务端-AI对话自动摘要与知识提取引擎 | 协作模块，对本服务存储的对话内容执行摘要和知识点提取 |
| 学情分析服务 | 下游消费者，基于对话数据进行学习行为分析 |

---

## 2. 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                        客户端 / BFF                              │
│   对话历史列表 │ 全文搜索 │ 知识点关联对话 │ 学习证据链          │
└──────────────────────┬───────────────────────────────────────────┘
                       │ REST API
┌──────────────────────▼───────────────────────────────────────────┐
│                  API Gateway (鉴权/限流/路由)                    │
└──────────────────────┬───────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────┐
│            对话历史存储检索服务 (本模块)                          │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐    │
│  │ 写入管线  │  │ 查询服务  │  │ 检索引擎  │  │ 生命周期管理  │    │
│  │ Write    │  │ Query    │  │ Search   │  │ Lifecycle    │    │
│  │ Pipeline │  │ Service  │  │ Engine   │  │ Manager      │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘    │
│       │             │             │               │              │
│       ▼             ▼             ▼               ▼              │
│  ┌────────┐   ┌─────────┐  ┌──────────┐   ┌───────────┐        │
│  │ 消息队列 │   │ Redis   │  │ ES 索引  │   │ 归档任务   │        │
│  │ MQ      │   │ Cache   │  │ Cluster  │   │ Scheduler  │        │
│  └────────┘   └─────────┘  └──────────┘   └───────────┘        │
│       │                                                    │   │
│       ▼                                                    │   │
│  ┌──────────┐                                      ┌────────┘  │
│  │ MySQL    │◄─────────────────────────────────────┘           │
│  │ 分库分表  │                                              │
│  └──────────┘                                              │   │
│       │                                                    │   │
│       ▼                                                    ▼   │
│  ┌──────────┐                                      ┌──────────┐│
│  │ OSS冷存储 │◄─────────────────────────────────────│ S3/OSS   ││
│  └──────────┘                                      └──────────┘│
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. 数据结构设计

### 3.1 核心表设计

#### 3.1.1 `ai_conversation` — 对话会话表

```sql
CREATE TABLE `ai_conversation` (
    `id`                BIGINT       UNSIGNED NOT NULL COMMENT '会话ID（雪花算法生成）',
    `user_id`           BIGINT       UNSIGNED NOT NULL COMMENT '用户ID',
    `session_title`     VARCHAR(200)          DEFAULT NULL COMMENT '会话标题（AI生成或用户编辑）',
    `stage`             TINYINT      UNSIGNED NOT NULL COMMENT '学段: 1-幼儿 2-小学 3-初中 4-高中',
    `grade`             SMALLINT     UNSIGNED NOT NULL COMMENT '年级',
    `subject`           TINYINT      UNSIGNED NOT NULL COMMENT '学科: 1-语文 2-数学 3-英语 4-物理 5-化学 6-生物 7-历史 8-地理 9-政治 0-通用',
    `textbook_version`  VARCHAR(20)           DEFAULT NULL COMMENT '教材版本编码',
    `scenario`          TINYINT      UNSIGNED NOT NULL DEFAULT 0 COMMENT '对话场景: 0-自由问答 1-拍题答疑 2-同步课堂 3-作文辅导 4-背诵辅助 5-错题讲解 6-考点梳理',
    `status`            TINYINT      UNSIGNED NOT NULL DEFAULT 1 COMMENT '会话状态: 0-已删除 1-活跃 2-已归档 3-已总结',
    `message_count`     INT          UNSIGNED NOT NULL DEFAULT 0 COMMENT '消息总数',
    `user_message_count` INT         UNSIGNED NOT NULL DEFAULT 0 COMMENT '用户消息数',
    `total_tokens`      INT          UNSIGNED NOT NULL DEFAULT 0 COMMENT '累计消耗Token数',
    `knowledge_points`  JSON                  DEFAULT NULL COMMENT '涉及知识点ID列表 ["kp_1001","kp_1002"]',
    `summary`           TEXT                  DEFAULT NULL COMMENT 'AI生成的会话摘要',
    `last_message_at`   DATETIME(3)           NOT NULL COMMENT '最后消息时间',
    `last_message_snippet` VARCHAR(500)       DEFAULT NULL COMMENT '最后一条消息摘要片段',
    `created_at`        DATETIME(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`        DATETIME(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `archived_at`       DATETIME(3)           DEFAULT NULL COMMENT '归档时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_conv` (`user_id`, `id`),
    KEY `idx_user_lastmsg` (`user_id`, `status`, `last_message_at` DESC),
    KEY `idx_user_subject` (`user_id`, `subject`, `status`),
    KEY `idx_user_scenario` (`user_id`, `scenario`, `status`),
    KEY `idx_status_archive` (`status`, `archived_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI对话会话表';
```

**分库分表策略：** 按 `user_id % 64` 分为64张表，单表数据量控制在5000万以内。使用 ShardingSphere 进行路由。

#### 3.1.2 `ai_conversation_message` — 对话消息表

```sql
CREATE TABLE `ai_conversation_message` (
    `id`                BIGINT       UNSIGNED NOT NULL COMMENT '消息ID（雪花算法）',
    `conversation_id`   BIGINT       UNSIGNED NOT NULL COMMENT '会话ID',
    `user_id`           BIGINT       UNSIGNED NOT NULL COMMENT '用户ID（冗余，用于分片路由）',
    `role`              TINYINT      UNSIGNED NOT NULL COMMENT '角色: 1-用户 2-AI助手 3-系统 4-家长',
    `seq`               INT          UNSIGNED NOT NULL COMMENT '消息序号（会话内递增）',
    `content_type`      TINYINT      UNSIGNED NOT NULL DEFAULT 1 COMMENT '内容类型: 1-文本 2-图片 3-语音 4-混合 5-卡片 6-公式渲染',
    `content`           MEDIUMTEXT            NOT NULL COMMENT '消息正文（Markdown格式，支持LaTeX公式）',
    `content_json`      JSON                  DEFAULT NULL COMMENT '结构化内容（卡片、多模态等）',
    `media_urls`        JSON                  DEFAULT NULL COMMENT '附件媒体URL列表',
    `model_id`          VARCHAR(50)           DEFAULT NULL COMMENT '生成该消息的模型ID（AI消息）',
    `model_provider`    VARCHAR(30)           DEFAULT NULL COMMENT '模型供应商: openai/anthropic/zhipu/qwen',
    `input_tokens`      INT          UNSIGNED DEFAULT 0 COMMENT '输入Token数（AI消息）',
    `output_tokens`     INT          UNSIGNED DEFAULT 0 COMMENT '输出Token数（AI消息）',
    `response_latency_ms` INT        UNSIGNED DEFAULT 0 COMMENT 'AI响应延迟（毫秒）',
    `knowledge_points`  JSON                  DEFAULT NULL COMMENT '消息涉及的知识点ID列表',
    `knowledge_tags`    JSON                  DEFAULT NULL COMMENT '知识点标签详情 [{"kp_id":"kp_1001","name":"一元二次方程","type":"concept"}]',
    `has_formula`       TINYINT(1)            DEFAULT 0 COMMENT '是否包含数学/化学公式',
    `has_image`         TINYINT(1)            DEFAULT 0 COMMENT '是否包含图片',
    `has_code`          TINYINT(1)            DEFAULT 0 COMMENT '是否包含代码',
    `user_feedback`     TINYINT      UNSIGNED DEFAULT 0 COMMENT '用户反馈: 0-无 1-点赞 2-点踩',
    `feedback_reason`   VARCHAR(100)          DEFAULT NULL COMMENT '点踩原因编码',
    `is_deleted`        TINYINT(1)            DEFAULT 0 COMMENT '用户是否删除该消息',
    `created_at`        DATETIME(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_conv_seq` (`conversation_id`, `seq`),
    KEY `idx_user_created` (`user_id`, `created_at` DESC),
    KEY `idx_conv_created` (`conversation_id`, `created_at`),
    KEY `idx_knowledge` ((CAST(`knowledge_points` AS CHAR(500) ARRAY)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI对话消息表';
```

**分库分表策略：** 与会话表相同，按 `user_id % 64` 分片，保证同一用户的会话和消息落在同一分片。

#### 3.1.3 `ai_conversation_knowledge_index` — 对话知识点索引表

```sql
CREATE TABLE `ai_conversation_knowledge_index` (
    `id`                BIGINT       UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id`           BIGINT       UNSIGNED NOT NULL COMMENT '用户ID',
    `conversation_id`   BIGINT       UNSIGNED NOT NULL COMMENT '会话ID',
    `message_id`        BIGINT       UNSIGNED NOT NULL COMMENT '消息ID',
    `knowledge_point_id` VARCHAR(30)         NOT NULL COMMENT '知识点ID',
    `knowledge_name`    VARCHAR(100)          NOT NULL COMMENT '知识点名称（冗余）',
    `subject`           TINYINT      UNSIGNED NOT NULL COMMENT '学科',
    `relation_type`     TINYINT      UNSIGNED NOT NULL DEFAULT 1 COMMENT '关系类型: 1-提问 2-讲解 3-练习 4-纠错 5-总结',
    `created_at`        DATETIME(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_msg_kp` (`message_id`, `knowledge_point_id`),
    KEY `idx_user_kp_time` (`user_id`, `knowledge_point_id`, `created_at` DESC),
    KEY `idx_user_subject_kp` (`user_id`, `subject`, `knowledge_point_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='对话-知识点关联索引';
```

#### 3.1.4 `ai_conversation_bookmark` — 对话书签/收藏表

```sql
CREATE TABLE `ai_conversation_bookmark` (
    `id`                BIGINT       UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id`           BIGINT       UNSIGNED NOT NULL,
    `conversation_id`   BIGINT       UNSIGNED NOT NULL,
    `message_id`        BIGINT       UNSIGNED NOT NULL,
    `bookmark_name`     VARCHAR(100)          DEFAULT NULL COMMENT '用户自定义标签',
    `note`              VARCHAR(500)          DEFAULT NULL COMMENT '用户笔记',
    `color_tag`         VARCHAR(10)           DEFAULT NULL COMMENT '颜色标签',
    `created_at`        DATETIME(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_msg` (`user_id`, `message_id`),
    KEY `idx_user_conv` (`user_id`, `conversation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='对话消息书签表';
```

#### 3.1.5 `dialogue_archive` — 冷数据归档记录表

```sql
CREATE TABLE `dialogue_archive` (
    `id`                BIGINT       UNSIGNED NOT NULL AUTO_INCREMENT,
    `conversation_id`   BIGINT       UNSIGNED NOT NULL,
    `user_id`           BIGINT       UNSIGNED NOT NULL,
    `archive_batch`     VARCHAR(50)           NOT NULL COMMENT '归档批次号',
    `archive_path`      VARCHAR(500)          NOT NULL COMMENT 'OSS存储路径',
    `archive_size`      BIGINT       UNSIGNED DEFAULT 0 COMMENT '归档文件大小(bytes)',
    `message_count`     INT          UNSIGNED NOT NULL COMMENT '归档消息数',
    `start_date`        DATE                  NOT NULL COMMENT '最早消息日期',
    `end_date`          DATE                  NOT NULL COMMENT '最晚消息日期',
    `status`            TINYINT      UNSIGNED NOT NULL DEFAULT 1 COMMENT '1-已归档 2-已恢复 3-已删除',
    `checksum`          VARCHAR(64)           NOT NULL COMMENT '文件校验和(SHA-256)',
    `created_at`        DATETIME(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    KEY `idx_user_status` (`user_id`, `status`),
    KEY `idx_batch` (`archive_batch`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='对话冷数据归档记录';
```

### 3.2 Redis缓存结构

```
# 用户对话列表缓存（ZSet，score=last_message_at 时间戳）
KEY: dialogue:list:{user_id}
SCORE: 1709640000000 (last_message_at 毫秒时间戳)
VALUE: conversation_id
TTL: 30min（滑动过期，访问时续期）

# 会话元数据缓存（Hash）
KEY: dialogue:conv:{conversation_id}
FIELDS:
    title, subject, scenario, status, message_count, 
    last_message_snippet, last_message_at, summary
TTL: 1h

# 会话消息列表缓存（List，只缓存最近N条）
KEY: dialogue:msgs:{conversation_id}:recent
VALUE: [msg_json_1, msg_json_2, ...]  （最多100条）
TTL: 30min

# 用户消息序列号计数器
KEY: dialogue:seq:{conversation_id}
TYPE: String (INCR)
TTL: 7d（会话结束后自动过期）

# 全文搜索结果缓存
KEY: dialogue:search:{user_id}:{query_hash}
VALUE: [conversation_id_list]
TTL: 5min

# 知识点关联对话缓存
KEY: dialogue:kp:{user_id}:{knowledge_point_id}
TYPE: List
VALUE: [conversation_id:message_id, ...] （最多50条）
TTL: 10min
```

### 3.3 Elasticsearch索引设计

#### 索引 `ai_dialogue_messages`

```json
{
  "settings": {
    "number_of_shards": 6,
    "number_of_replicas": 1,
    "refresh_interval": "5s",
    "index": {
      "max_result_window": 10000
    },
    "analysis": {
      "analyzer": {
        "content_analyzer": {
          "type": "ik_max_word",
          "filter": ["lowercase", "asciifolding"]
        },
        "pinyin_analyzer": {
          "type": "custom",
          "tokenizer": "ik_max_word",
          "filter": ["pinyin_filter", "lowercase"]
        }
      },
      "filter": {
        "pinyin_filter": {
          "type": "pinyin",
          "keep_first_letter": false,
          "keep_full_pinyin": true
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "message_id":      { "type": "long" },
      "conversation_id": { "type": "long" },
      "user_id":         { "type": "long" },
      "role":            { "type": "byte" },
      "content_text": {
        "type": "text",
        "analyzer": "content_analyzer",
        "search_analyzer": "ik_smart",
        "fields": {
          "pinyin": {
            "type": "text",
            "analyzer": "pinyin_analyzer"
          },
          "keyword": {
            "type": "keyword",
            "ignore_above": 256
          }
        }
      },
      "subject":         { "type": "byte" },
      "stage":           { "type": "byte" },
      "grade":           { "type": "short" },
      "scenario":        { "type": "byte" },
      "knowledge_point_ids": { "type": "keyword" },
      "has_formula":     { "type": "boolean" },
      "has_image":       { "type": "boolean" },
      "user_feedback":   { "type": "byte" },
      "created_at":      { "type": "date", "format": "strict_date_optional_time||epoch_millis" },
      "created_date":    { "type": "date", "format": "yyyy-MM-dd" }
    }
  }
}
```

**索引策略：**
- 按月创建索引别名 `ai_dialogue_messages_{YYYY_MM}`，通过别名 `ai_dialogue_messages_current` 写入
- 超过3个月的索引设为只读，减少集群负担
- 使用 ILT (Index Lifecycle Management) 自动管理索引生命周期

---

## 4. API接口设计

### 4.1 对话历史列表查询

```
GET /api/v1/dialogues
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| subject | int | 否 | 学科筛选 |
| scenario | int | 否 | 场景筛选 |
| status | int | 否 | 状态筛选，默认1-活跃 |
| keyword | string | 否 | 标题关键词模糊搜索 |
| date_from | date | 否 | 起始日期 |
| date_to | date | 否 | 截止日期 |
| page | int | 否 | 页码，默认1 |
| page_size | int | 否 | 每页条数，默认20，最大50 |
| sort | string | 否 | 排序字段，默认last_message_at desc |

**响应：**

```json
{
  "code": 0,
  "data": {
    "total": 156,
    "page": 1,
    "page_size": 20,
    "items": [
      {
        "conversation_id": "1850123456789012345",
        "title": "一元二次方程的解法",
        "subject": 2,
        "scenario": 0,
        "status": 1,
        "message_count": 12,
        "last_message_snippet": "所以求根公式是 x = (-b±√(b²-4ac)) / 2a...",
        "last_message_at": "2026-08-05T10:30:00.123Z",
        "knowledge_points": [
          { "kp_id": "kp_1001", "name": "一元二次方程" }
        ],
        "summary": "讨论了一元二次方程的公式法、因式分解法和配方法三种解法"
      }
    ]
  }
}
```

### 4.2 会话消息详情查询（分页）

```
GET /api/v1/dialogues/{conversation_id}/messages
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| cursor | string | 否 | 游标（上一页最后一条消息的`created_at`+`seq`），首次请求不传 |
| direction | string | 否 | 加载方向: before(默认) / after |
| limit | int | 否 | 每页条数，默认30，最大50 |
| include_deleted | bool | 否 | 是否包含已删除消息，默认false |

**响应：**

```json
{
  "code": 0,
  "data": {
    "conversation_id": "1850123456789012345",
    "items": [
      {
        "message_id": "1850123456789012346",
        "role": 1,
        "seq": 1,
        "content_type": 1,
        "content": "老师，一元二次方程怎么解？",
        "has_formula": false,
        "has_image": false,
        "knowledge_points": [],
        "created_at": "2026-08-05T10:25:00.000Z"
      },
      {
        "message_id": "1850123456789012347",
        "role": 2,
        "seq": 2,
        "content_type": 1,
        "content": "一元二次方程有三种常用解法，我们先从最基础的**因式分解法**开始...\n\n$$x^2 + 5x + 6 = 0$$\n\n可以分解为 $(x+2)(x+3) = 0$",
        "has_formula": true,
        "has_image": false,
        "knowledge_points": [
          { "kp_id": "kp_1001", "name": "一元二次方程", "type": "concept" },
          { "kp_id": "kp_1002", "name": "因式分解", "type": "method" }
        ],
        "model_provider": "zhipu",
        "model_id": "glm-4",
        "response_latency_ms": 1523,
        "user_feedback": 0,
        "created_at": "2026-08-05T10:25:03.123Z"
      }
    ],
    "next_cursor": "eyJjcmVhdGVkX2F0IjoiMjAyNi0wOC0wNVQxMDoyNTozMy4xMjNaIiwic2VxIjo0fQ==",
    "has_more": true
  }
}
```

### 4.3 全文搜索对话内容

```
GET /api/v1/dialogues/search
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| q | string | 是 | 搜索关键词 |
| subject | int | 否 | 学科范围 |
| date_from | date | 否 | 起始日期 |
| date_to | date | 否 | 截止日期 |
| scenario | int | 否 | 场景范围 |
| page | int | 否 | 页码，默认1 |
| page_size | int | 否 | 每页条数，默认20，最大30 |

**响应：**

```json
{
  "code": 0,
  "data": {
    "total": 42,
    "took_ms": 87,
    "items": [
      {
        "conversation_id": "1850123456789012345",
        "title": "一元二次方程的解法",
        "subject": 2,
        "matched_message": {
          "message_id": "1850123456789012347",
          "role": 2,
          "content_highlight": "一元二次方程有三种常用解法，我们先从最基础的<em>因式分解法</em>开始...",
          "created_at": "2026-08-05T10:25:03.123Z"
        },
        "relevance_score": 12.34
      }
    ]
  }
}
```

### 4.4 按知识点查询关联对话

```
GET /api/v1/dialogues/by-knowledge/{knowledge_point_id}
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| relation_type | int | 否 | 关系类型: 1-提问 2-讲解 3-练习 4-纠错 5-总结 |
| limit | int | 否 | 返回条数，默认20，最大50 |

**响应：**

```json
{
  "code": 0,
  "data": {
    "knowledge_point_id": "kp_1001",
    "knowledge_name": "一元二次方程",
    "items": [
      {
        "conversation_id": "1850123456789012345",
        "title": "一元二次方程的解法",
        "relation_type": 2,
        "message_count": 4,
        "last_message_at": "2026-08-05T10:30:00.123Z"
      }
    ]
  }
}
```

### 4.5 会话管理操作

```
PUT /api/v1/dialogues/{conversation_id}
```

**请求体（部分更新）：**

```json
{
  "title": "一元二次方程复习",
  "status": 1
}
```

```
DELETE /api/v1/dialogues/{conversation_id}
```

**软删除**，将会话状态置为0，保留数据30天后物理清除。

```
POST /api/v1/dialogues/{conversation_id}/messages/{message_id}/feedback
```

```json
{
  "feedback": 2,
  "reason": "incorrect_answer"
}
```

### 4.6 消息书签操作

```
POST /api/v1/dialogues/{conversation_id}/messages/{message_id}/bookmark
DELETE /api/v1/dialogues/{conversation_id}/messages/{message_id}/bookmark
GET /api/v1/dialogues/bookmarks
```

### 4.7 学习证据链查询

```
GET /api/v1/dialogues/evidence-chain
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| knowledge_point_id | string | 是 | 知识点ID |
| subject | int | 否 | 学科 |

**响应（该知识点所有学习证据时间线）：**

```json
{
  "code": 0,
  "data": {
    "knowledge_point_id": "kp_1001",
    "knowledge_name": "一元二次方程",
    "evidence_count": 8,
    "timeline": [
      {
        "date": "2026-07-15",
        "type": "ai_dialogue",
        "title": "初次学习一元二次方程",
        "conversation_id": "1850123456789012300",
        "relation_type": 2,
        "summary": "学习了因式分解法解一元二次方程"
      },
      {
        "date": "2026-07-20",
        "type": "ai_dialogue",
        "title": "一元二次方程练习",
        "conversation_id": "1850123456789012350",
        "relation_type": 3,
        "summary": "练习了6道一元二次方程题目"
      },
      {
        "date": "2026-08-05",
        "type": "ai_dialogue",
        "title": "一元二次方程的解法",
        "conversation_id": "1850123456789012345",
        "relation_type": 2,
        "summary": "系统复习了三种解法"
      }
    ]
  }
}
```

---

## 5. 写入管线设计

### 5.1 消息写入流程

```
 AI对话引擎
     │
     ▼ (实时SSE流式输出)
 SSE Stream Buffer
     │
     ▼ (AI消息完成 / 用户消息发送)
 Message Assembly
     │
     ├─► MySQL (同步写入，保证持久性)
     │
     ├─► Redis (异步更新会话缓存 & 消息列表)
     │
     ├─► MQ (异步投递到消息队列)
     │       │
     │       ├─► ES Indexer (异步建立全文索引)
     │       │
     │       ├─► Knowledge Tagger (异步知识点标注)
     │       │
     │       └─► Analytics Pipeline (异步行为分析)
     │
     └─► 返回写入成功
```

### 5.2 写入可靠性保障

```python
import asyncio
import json
from datetime import datetime
from typing import Optional

class DialogueMessageWriter:
    """
    对话消息写入器
    采用"先入库，再异步分发"策略，保证消息不丢失
    """

    async def write_message(
        self,
        conversation_id: int,
        user_id: int,
        role: int,
        content: str,
        content_type: int = 1,
        content_json: Optional[dict] = None,
        media_urls: Optional[list] = None,
        model_info: Optional[dict] = None,
    ) -> dict:
        # 1. 获取消息序列号（Redis INCR，失败时回退到DB查询MAX+1）
        seq = await self._get_next_seq(conversation_id)

        # 2. 构造消息实体
        message = {
            "id": self.snowflake.next_id(),
            "conversation_id": conversation_id,
            "user_id": user_id,
            "role": role,
            "seq": seq,
            "content_type": content_type,
            "content": content,
            "content_json": content_json,
            "media_urls": media_urls,
            "model_id": model_info.get("model_id") if model_info else None,
            "model_provider": model_info.get("provider") if model_info else None,
            "input_tokens": model_info.get("input_tokens", 0) if model_info else 0,
            "output_tokens": model_info.get("output_tokens", 0) if model_info else 0,
            "response_latency_ms": model_info.get("latency_ms", 0) if model_info else 0,
            "has_formula": self._detect_formula(content),
            "has_image": 1 if media_urls else 0,
            "created_at": datetime.utcnow(),
        }

        # 3. 同步写入MySQL（核心路径，必须成功）
        try:
            await self.db.insert("ai_conversation_message", message)
        except Exception as e:
            # 写入失败，尝试降级：写入本地文件 + 告警
            await self._fallback_to_local_file(message, str(e))
            raise

        # 4. 更新会话表的冗余字段
        await self._update_conversation_meta(
            conversation_id=conversation_id,
            user_id=user_id,
            message_count_delta=1,
            user_message_delta=1 if role == 1 else 0,
            token_delta=model_info.get("total_tokens", 0) if model_info else 0,
            last_message_snippet=content[:200],
            last_message_at=message["created_at"],
        )

        # 5. 异步更新Redis缓存（失败不影响主流程）
        asyncio.create_task(self._update_cache(conversation_id, message))

        # 6. 异步投递MQ（失败重试3次，最终降级到补偿任务）
        asyncio.create_task(self._publish_to_mq(message))

        return {"message_id": message["id"], "seq": seq}

    async def _get_next_seq(self, conversation_id: int) -> int:
        """获取会话内消息序号"""
        try:
            seq = await self.redis.incr(f"dialogue:seq:{conversation_id}")
            return seq
        except Exception:
            # Redis不可用时，从数据库查询
            result = await self.db.fetch_one(
                "SELECT MAX(seq) as max_seq FROM ai_conversation_message WHERE conversation_id = %s",
                [conversation_id]
            )
            return (result["max_seq"] or 0) + 1

    async def _update_cache(self, conversation_id: int, message: dict):
        """更新Redis缓存"""
        try:
            pipe = self.redis.pipeline()
            # 更新消息列表缓存（LPUSH + LTRIM 保留最近100条）
            pipe.lpush(
                f"dialogue:msgs:{conversation_id}:recent",
                json.dumps(message, default=str)
            )
            pipe.ltrim(f"dialogue:msgs:{conversation_id}:recent", 0, 99)
            pipe.expire(f"dialogue:msgs:{conversation_id}:recent", 1800)
            # 更新会话最后活动时间
            pipe.hset(
                f"dialogue:conv:{conversation_id}",
                mapping={
                    "last_message_at": message["created_at"].isoformat(),
                    "last_message_snippet": message["content"][:200],
                }
            )
            await pipe.execute()
        except Exception as e:
            logger.warning(f"Cache update failed for conversation {conversation_id}: {e}")

    async def _publish_to_mq(self, message: dict):
        """异步投递消息到MQ"""
        max_retries = 3
        for attempt in range(max_retries):
            try:
                await self.mq.publish(
                    topic="dialogue-message-created",
                    key=str(message["conversation_id"]),
                    value=json.dumps(message, default=str),
                )
                return
            except Exception as e:
                if attempt == max_retries - 1:
                    # 最终失败，写入补偿表
                    await self.db.insert("mq_compensation", {
                        "topic": "dialogue-message-created",
                        "key": str(message["conversation_id"]),
                        "value": json.dumps(message, default=str),
                        "retry_count": 0,
                        "next_retry_at": datetime.utcnow(),
                    })
                    logger.error(f"MQ publish failed after {max_retries} retries: {e}")
                else:
                    await asyncio.sleep(0.5 * (attempt + 1))
```

### 5.3 SSE流式消息处理

AI回复采用SSE流式输出，消息在**流结束时**才完整写入数据库，流过程中暂存于Redis：

```python
class SSEMessageBuffer:
    """
    SSE流式消息缓冲区
    流式输出期间暂存于Redis，流结束后写入MySQL
    """

    async def start_stream(self, conversation_id: int, user_msg_id: int) -> int:
        """开始流式响应，生成临时AI消息ID"""
        ai_msg_id = self.snowflake.next_id()
        await self.redis.setex(
            f"dialogue:stream:{ai_msg_id}",
            300,  # 5分钟超时
            json.dumps({
                "id": ai_msg_id,
                "conversation_id": conversation_id,
                "role": 2,
                "user_msg_id": user_msg_id,
                "chunks": [],
                "total_text": "",
                "started_at": datetime.utcnow().isoformat(),
            })
        )
        return ai_msg_id

    async def append_chunk(self, ai_msg_id: int, chunk_text: str, chunk_tokens: int = 0):
        """追加流式分片"""
        stream_data = await self.redis.get(f"dialogue:stream:{ai_msg_id}")
        if not stream_data:
            raise StreamExpiredError(f"Stream {ai_msg_id} expired or not found")

        data = json.loads(stream_data)
        data["total_text"] += chunk_text
        data["chunks"].append({
            "text": chunk_text,
            "tokens": chunk_tokens,
            "ts": datetime.utcnow().isoformat()
        })
        await self.redis.setex(f"dialogue:stream:{ai_msg_id}", 300, json.dumps(data))

    async def finalize_stream(
        self, ai_msg_id: int, model_info: dict, latency_ms: int
    ) -> dict:
        """流结束，写入数据库"""
        stream_data = await self.redis.get(f"dialogue:stream:{ai_msg_id}")
        if not stream_data:
            raise StreamExpiredError(f"Stream {ai_msg_id} expired")

        data = json.loads(stream_data)
        content = data["total_text"]

        # 写入正式消息
        message = await self.writer.write_message(
            conversation_id=data["conversation_id"],
            user_id=data.get("user_id"),
            role=2,
            content=content,
            model_info={
                **model_info,
                "latency_ms": latency_ms,
            },
        )

        # 清理缓冲区
        await self.redis.delete(f"dialogue:stream:{ai_msg_id}")

        return message

    async def abort_stream(self, ai_msg_id: int, reason: str):
        """流中断处理（超时/用户取消/错误）"""
        stream_data = await self.redis.get(f"dialogue:stream:{ai_msg_id}")
        if stream_data:
            data = json.loads(stream_data)
            # 如果已有部分内容，保存为不完整消息
            if len(data["total_text"]) > 10:
                await self.writer.write_message(
                    conversation_id=data["conversation_id"],
                    user_id=data.get("user_id"),
                    role=2,
                    content=data["total_text"] + "\n\n*[响应中断]*",
                    model_info={"provider": "unknown", "model_id": "unknown"},
                )
            await self.redis.delete(f"dialogue:stream:{ai_msg_id}")
```

---

## 6. 异步索引与知识标注管线

### 6.1 消息事件处理拓扑

```
MQ Topic: dialogue-message-created
              │
     ┌────────┼────────────┬────────────────┐
     ▼        ▼            ▼                ▼
 ES Indexer  KP Tagger  Summary Generator  Analytics
 (全文索引)  (知识点标注) (摘要生成)        (行为分析)
```

### 6.2 ES索引消费者

```python
class ESIndexerConsumer:
    """消费消息事件，写入Elasticsearch全文索引"""

    async def handle(self, event: dict):
        message = json.loads(event["value"])

        # 构建ES文档
        doc = {
            "message_id": message["id"],
            "conversation_id": message["conversation_id"],
            "user_id": message["user_id"],
            "role": message["role"],
            "content_text": self._strip_markdown(message["content"]),
            "subject": await self._get_conversation_subject(message["conversation_id"]),
            "stage": await self._get_user_stage(message["user_id"]),
            "grade": await self._get_user_grade(message["user_id"]),
            "scenario": await self._get_conversation_scenario(message["conversation_id"]),
            "has_formula": message.get("has_formula", False),
            "has_image": message.get("has_image", False),
            "created_at": message["created_at"],
            "created_date": message["created_at"][:10],
        }

        # 写入ES（当前月索引）
        index_name = f"ai_dialogue_messages_{datetime.utcnow().strftime('%Y_%m')}"
        await self.es.index(
            index=index_name,
            id=str(message["id"]),
            document=doc,
            routing=str(message["user_id"]),  # 按用户路由，保证同一用户数据在同分片
        )
```

### 6.3 知识点标注消费者

```python
class KnowledgeTaggerConsumer:
    """消费消息事件，异步标注知识点"""

    BATCH_SIZE = 20
    BATCH_TIMEOUT = 5  # 秒

    async def handle_batch(self, events: list):
        """批量处理，减少AI调用次数"""
        messages = [json.loads(e["value"]) for e in events]

        # 过滤：只处理AI回复消息和用户提问消息
        target_messages = [
            m for m in messages
            if m["role"] in (1, 2) and len(m["content"]) > 20
        ]

        if not target_messages:
            return

        # 构造批量标注Prompt
        batch_prompt = self._build_batch_prompt(target_messages)

        try:
            result = await self.ai_client.chat(
                model="glm-4-flash",  # 使用轻量模型降低成本
                messages=batch_prompt,
                temperature=0.1,
                response_format={"type": "json_object"},
            )

            tags = json.loads(result.content)

            for msg_id, tag_info in tags.items():
                kp_ids = [t["kp_id"] for t in tag_info.get("knowledge_points", [])]

                if kp_ids:
                    # 更新消息表的知识点字段
                    await self.db.execute(
                        "UPDATE ai_conversation_message SET knowledge_points = %s, "
                        "knowledge_tags = %s WHERE id = %s",
                        [json.dumps(kp_ids), json.dumps(tag_info["knowledge_points"]), int(msg_id)]
                    )

                    # 写入知识点索引表
                    for kp in tag_info["knowledge_points"]:
                        await self.db.insert(
                            "ai_conversation_knowledge_index",
                            {
                                "user_id": next(m["user_id"] for m in target_messages if m["id"] == int(msg_id)),
                                "conversation_id": next(m["conversation_id"] for m in target_messages if m["id"] == int(msg_id)),
                                "message_id": int(msg_id),
                                "knowledge_point_id": kp["kp_id"],
                                "knowledge_name": kp["name"],
                                "subject": kp.get("subject", 0),
                                "relation_type": kp.get("relation_type", 1),
                            }
                        )

                    # 清除知识点关联缓存
                    user_id = next(m["user_id"] for m in target_messages if m["id"] == int(msg_id))
                    for kp in kp_ids:
                        await self.redis.delete(f"dialogue:kp:{user_id}:{kp}")

        except Exception as e:
            logger.error(f"Knowledge tagging failed: {e}")
            # 标注失败不影响核心流程，后续补偿任务重试

    def _build_batch_prompt(self, messages: list) -> list:
        msg_list = "\n".join([
            f"[MSG_{m['id']}] (角色:{'学生' if m['role']==1 else 'AI'})\n{m['content'][:500]}"
            for m in messages
        ])

        return [
            {
                "role": "system",
                "content": """你是一个教育内容知识点标注专家。请分析以下对话消息，为每条消息标注涉及的知识点。

返回JSON格式：
{
  "消息ID": {
    "knowledge_points": [
      {
        "kp_id": "知识点ID（从已知列表中匹配，无法匹配时用 kp_unknown）",
        "name": "知识点名称",
        "subject": 学科代码,
        "relation_type": 关系类型(1-提问 2-讲解 3-练习 4-纠错 5-总结)
      }
    ]
  }
}

注意：
- 每条消息标注1-5个知识点，不要过度标注
- 只标注明确涉及的知识点，避免猜测
- relation_type: 学生提问用1，AI讲解用2，练习题用3，纠错用4，方法总结用5"""
            },
            {"role": "user", "content": msg_list}
        ]
```

---

## 7. 数据生命周期管理

### 7.1 分层存储策略

```
┌─────────────────────────────────────────────────────────────┐
│                    数据温度分层                              │
│                                                             │
│  🔥 HOT (0-3个月)                                          │
│  │  存储: MySQL(SSD) + Redis Cache + ES索引                │
│  │  特点: 高频访问，毫秒级响应                              │
│  │  成本: 高                                                │
│  │                                                         │
│  ├─── 3个月自动降温 ────┐                                  │
│  │                      ▼                                  │
│  🌡️ WARM (3-6个月)     │                                  │
│  │  存储: MySQL(SSD) + ES索引(只读)                        │
│  │  特点: 偶尔访问，百毫秒级响应                            │
│  │  成本: 中                                                │
│  │                                                         │
│  ├─── 6个月自动归档 ────┐                                  │
│  │                      ▼                                  │
│  ❄️ COLD (6个月-2年)   │                                  │
│  │  存储: OSS(Parquet) + 元数据索引(MySQL)                 │
│  │  特点: 罕见访问，秒级响应(需解冻)                        │
│  │  成本: 低                                                │
│  │                                                         │
│  ├─── 2年自动清理 ────┐                                   │
│  │                     ▼                                   │
│  🗑️ EXPIRED (2年+)   │                                   │
│     操作: 物理删除（用户可提前导出）                        │
│     注意: 涉及知识掌握度计算的关键消息长期保留              │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 归档任务实现

```python
import pyarrow as pa
import pyarrow.parquet as pq
import hashlib
from datetime import datetime, timedelta

class DialogueArchiveJob:
    """
    定时归档任务：将6个月以上的冷数据从MySQL迁移到OSS(Parquet)
    每天凌晨2点执行，按用户分批处理
    """

    ARCHIVE_THRESHOLD_DAYS = 180
    BATCH_SIZE = 100  # 每批处理100个用户的过期数据

    async def run(self):
        """任务入口"""
        # 1. 获取需要归档的用户列表
        cutoff_date = datetime.utcnow() - timedelta(days=self.ARCHIVE_THRESHOLD_DAYS)
        users_to_archive = await self._get_users_with_old_data(cutoff_date)

        logger.info(f"Found {len(users_to_archive)} users with data to archive")

        for user_batch in self._chunk(users_to_archive, self.BATCH_SIZE):
            try:
                await self._archive_user_batch(user_batch, cutoff_date)
            except Exception as e:
                logger.error(f"Archive batch failed: {e}")
                # 失败不影响其他批次
                continue

    async def _archive_user_batch(self, user_ids: list, cutoff_date: datetime):
        """归档一批用户的过期会话"""
        batch_id = f"archive_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{user_ids[0]}"

        for user_id in user_ids:
            # 1. 查询过期会话
            conversations = await self.db.fetch_all(
                """SELECT * FROM ai_conversation 
                   WHERE user_id = %s AND status = 1 
                   AND last_message_at < %s
                   ORDER BY last_message_at ASC""",
                [user_id, cutoff_date]
            )

            if not conversations:
                continue

            for conv in conversations:
                # 2. 查询会话的所有消息
                messages = await self.db.fetch_all(
                    """SELECT * FROM ai_conversation_message 
                       WHERE conversation_id = %s AND user_id = %s
                       ORDER BY seq ASC""",
                    [conv["id"], user_id]
                )

                if not messages:
                    continue

                # 3. 导出为Parquet格式
                table = pa.table({
                    "message_id": [m["id"] for m in messages],
                    "conversation_id": [m["conversation_id"] for m in messages],
                    "user_id": [m["user_id"] for m in messages],
                    "role": [m["role"] for m in messages],
                    "seq": [m["seq"] for m in messages],
                    "content_type": [m["content_type"] for m in messages],
                    "content": [m["content"] for m in messages],
                    "knowledge_points": [m["knowledge_points"] for m in messages],
                    "created_at": [m["created_at"].isoformat() for m in messages],
                })

                buffer = pa.BufferOutputStream()
                pq.write_table(table, buffer, compression="zstd")
                parquet_data = buffer.getvalue().to_pybytes()

                # 4. 计算校验和
                checksum = hashlib.sha256(parquet_data).hexdigest()

                # 5. 上传到OSS
                oss_path = f"archive/dialogue/{user_id}/{conv['id']}_{batch_id}.parquet"
                await self.oss.upload(oss_path, parquet_data)

                # 6. 写入归档记录
                await self.db.insert("dialogue_archive", {
                    "conversation_id": conv["id"],
                    "user_id": user_id,
                    "archive_batch": batch_id,
                    "archive_path": oss_path,
                    "archive_size": len(parquet_data),
                    "message_count": len(messages),
                    "start_date": messages[0]["created_at"].date(),
                    "end_date": messages[-1]["created_at"].date(),
                    "status": 1,
                    "checksum": checksum,
                })

                # 7. 更新会话状态为已归档
                await self.db.execute(
                    "UPDATE ai_conversation SET status = 2, archived_at = %s WHERE id = %s",
                    [datetime.utcnow(), conv["id"]]
                )

                # 8. 删除MySQL中的消息数据（保留会话元数据记录）
                await self.db.execute(
                    "DELETE FROM ai_conversation_message WHERE conversation_id = %s AND user_id = %s",
                    [conv["id"], user_id]
                )

                # 9. 清理ES索引中的对应文档
                await self.es.delete_by_query(
                    index="ai_dialogue_messages_*",
                    body={
                        "query": {
                            "term": {"conversation_id": conv["id"]}
                        }
                    }
                )

                logger.info(
                    f"Archived conversation {conv['id']} for user {user_id}: "
                    f"{len(messages)} messages, {len(parquet_data)} bytes"
                )

    async def restore_from_archive(self, conversation_id: int, user_id: int):
        """从归档恢复会话（用户主动触发）"""
        # 1. 查询归档记录
        archive = await self.db.fetch_one(
            "SELECT * FROM dialogue_archive WHERE conversation_id = %s AND user_id = %s AND status = 1",
            [conversation_id, user_id]
        )
        if not archive:
            raise NotFoundError("Archive record not found")

        # 2. 从OSS下载Parquet文件
        parquet_data = await self.oss.download(archive["archive_path"])

        # 3. 校验完整性
        actual_checksum = hashlib.sha256(parquet_data).hexdigest()
        if actual_checksum != archive["checksum"]:
            raise DataIntegrityError("Checksum mismatch, archive may be corrupted")

        # 4. 解析并写回MySQL
        reader = pa.BufferReader(parquet_data)
        table = pq.read_table(reader)

        records = table.to_pylist()
        for record in records:
            await self.db.insert("ai_conversation_message", {
                "id": record["message_id"],
                "conversation_id": record["conversation_id"],
                "user_id": record["user_id"],
                "role": record["role"],
                "seq": record["seq"],
                "content_type": record["content_type"],
                "content": record["content"],
                "knowledge_points": record["knowledge_points"],
                "created_at": datetime.fromisoformat(record["created_at"]),
            })

        # 5. 更新会话状态
        await self.db.execute(
            "UPDATE ai_conversation SET status = 1, archived_at = NULL WHERE id = %s",
            [conversation_id]
        )

        # 6. 更新归档记录
        await self.db.execute(
            "UPDATE dialogue_archive SET status = 2 WHERE id = %s",
            [archive["id"]]
        )

        logger.info(f"Restored conversation {conversation_id} from archive")
```

### 7.3 永久删除与合规

```python
class DialoguePrivacyCompliance:
    """
    对话隐私合规处理
    - 用户删除账号时彻底清除对话数据
    - 支持GDPR/PIPL数据删除请求
    - 保留脱敏统计数据用于模型训练
    """

    async def purge_user_data(self, user_id: int, retain_stats: bool = True):
        """彻底清除用户对话数据"""

        # 1. 获取用户所有会话ID
        conv_ids = await self.db.fetch_all(
            "SELECT id FROM ai_conversation WHERE user_id = %s",
            [user_id]
        )

        # 2. 删除MySQL消息和索引
        await self.db.execute(
            "DELETE FROM ai_conversation_message WHERE user_id = %s",
            [user_id]
        )
        await self.db.execute(
            "DELETE FROM ai_conversation_knowledge_index WHERE user_id = %s",
            [user_id]
        )
        await self.db.execute(
            "DELETE FROM ai_conversation_bookmark WHERE user_id = %s",
            [user_id]
        )
        await self.db.execute(
            "DELETE FROM ai_conversation WHERE user_id = %s",
            [user_id]
        )

        # 3. 删除ES索引
        await self.es.delete_by_query(
            index="ai_dialogue_messages_*",
            body={"query": {"term": {"user_id": user_id}}}
        )

        # 4. 删除OSS归档
        archives = await self.db.fetch_all(
            "SELECT archive_path FROM dialogue_archive WHERE user_id = %s",
            [user_id]
        )
        for arc in archives:
            await self.oss.delete(arc["archive_path"])
        await self.db.execute(
            "DELETE FROM dialogue_archive WHERE user_id = %s",
            [user_id]
        )

        # 5. 清除Redis缓存
        await self.redis.delete(f"dialogue:list:{user_id}")
        # 使用SCAN删除会话级缓存
        async for key in self.redis.scan_iter(f"dialogue:conv:*"):
            await self.redis.delete(key)
        async for key in self.redis.scan_iter(f"dialogue:msgs:*"):
            await self.redis.delete(key)

        # 6. 可选：保留脱敏数据用于训练
        if retain_stats:
            await self._anonymize_and_retain(user_id, [c["id"] for c in conv_ids])

        logger.info(f"Purged all dialogue data for user {user_id}")
```

---

## 8. 查询服务优化

### 8.1 游标分页实现

对于会话消息列表，使用游标分页代替传统OFFSET分页，避免深度翻页性能问题：

```python
import base64
import json

class CursorPaginator:
    """
    游标分页器
    基于 (created_at, seq) 复合游标，避免OFFSET深度翻页性能退化
    """

    @staticmethod
    def encode_cursor(created_at: str, seq: int) -> str:
        raw = json.dumps({"created_at": created_at, "seq": seq})
        return base64.urlsafe_b64encode(raw.encode()).decode()

    @staticmethod
    def decode_cursor(cursor: str) -> dict:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        return json.loads(raw)

    async def paginate_messages(
        self,
        conversation_id: int,
        cursor: str = None,
        direction: str = "before",
        limit: int = 30,
    ) -> dict:
        where_clause = "conversation_id = %s AND is_deleted = 0"
        params = [conversation_id]

        if cursor:
            cursor_data = self.decode_cursor(cursor)
            cursor_time = cursor_data["created_at"]
            cursor_seq = cursor_data["seq"]

            if direction == "before":
                where_clause += " AND (created_at, seq) < (%s, %s)"
            else:
                where_clause += " AND (created_at, seq) > (%s, %s)"
            params.extend([cursor_time, cursor_seq])

        order = "DESC" if direction == "before" else "ASC"

        sql = f"""
            SELECT id, role, seq, content_type, content, content_json,
                   media_urls, knowledge_points, has_formula, has_image,
                   user_feedback, model_provider, response_latency_ms, created_at
            FROM ai_conversation_message
            WHERE {where_clause}
            ORDER BY created_at {order}, seq {order}
            LIMIT %s
        """
        params.append(limit + 1)  # 多取1条判断has_more

        rows = await self.db.fetch_all(sql, params)
        has_more = len(rows) > limit
        rows = rows[:limit]

        if direction == "before":
            rows.reverse()  # 前端按时间正序展示

        items = [dict(row) for row in rows]

        next_cursor = None
        if has_more and rows:
            last = rows[-1] if direction == "after" else rows[0]
            next_cursor = self.encode_cursor(
                last["created_at"].isoformat(),
                last["seq"],
            )

        return {
            "items": items,
            "next_cursor": next_cursor,
            "has_more": has_more,
        }
```

### 8.2 多级缓存查询策略

```python
class ConversationQueryService:
    """
    会话查询服务，三级缓存策略
    L1: Redis缓存 → L2: MySQL热库 → L3: OSS冷存储
    """

    async def get_conversation_list(
        self, user_id: int, filters: dict, page: int, page_size: int
    ) -> dict:
        # L1: 尝试从Redis ZSet获取会话ID列表
        cache_key = f"dialogue:list:{user_id}"
        cached_conv_ids = await self.redis.zrevrange(
            cache_key, 0, -1
        )

        if cached_conv_ids and not filters.get("keyword"):
            # 缓存命中，按条件过滤后分页
            return await self._filter_and_paginate_from_cache(
                user_id, cached_conv_ids, filters, page, page_size
            )

        # L2: 查询MySQL
        where, params = self._build_where(user_id, filters)
        offset = (page - 1) * page_size

        rows = await self.db.fetch_all(
            f"""SELECT id, session_title, subject, scenario, status, 
                       message_count, last_message_snippet, last_message_at, 
                       knowledge_points, summary
                FROM ai_conversation 
                WHERE {where}
                ORDER BY last_message_at DESC
                LIMIT %s OFFSET %s""",
            params + [page_size, offset]
        )

        total = await self.db.fetch_one(
            f"SELECT COUNT(*) as cnt FROM ai_conversation WHERE {where}",
            params
        )

        return {
            "total": total["cnt"],
            "page": page,
            "page_size": page_size,
            "items": [dict(r) for r in rows],
        }

    async def get_conversation_messages(
        self, conversation_id: int, user_id: int,
        cursor: str = None, limit: int = 30
    ) -> dict:
        # L1: 如果查最近消息，尝试Redis缓存
        if not cursor:
            cache_key = f"dialogue:msgs:{conversation_id}:recent"
            cached = await self.redis.lrange(cache_key, 0, limit - 1)
            if cached:
                items = [json.loads(m) for m in cached[:limit]]
                has_more = len(cached) > limit
                next_cursor = None
                if has_more and items:
                    last = items[-1]
                    next_cursor = CursorPaginator.encode_cursor(
                        last["created_at"], last["seq"]
                    )
                return {"items": items, "next_cursor": next_cursor, "has_more": has_more}

        # L2: 查询MySQL
        result = await CursorPaginator().paginate_messages(
            conversation_id, cursor, "before", limit
        )

        # L3: 如果MySQL返回空且会话已归档，尝试OSS
        if not result["items"]:
            conv = await self._get_conversation_meta(conversation_id)
            if conv and conv["status"] == 2:  # 已归档
                return await self._query_from_archive(
                    conversation_id, user_id, cursor, limit
                )

        return result
```

---

## 9. 全文搜索引擎

### 9.1 搜索查询构建

```python
class DialogueSearchEngine:
    """
    对话全文搜索引擎
    支持中文分词、拼音搜索、学科过滤、知识点过滤
    """

    async def search(
        self,
        user_id: int,
        query: str,
        subject: int = None,
        date_from: str = None,
        date_to: str = None,
        scenario: int = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        # 构建ES查询
        must = [
            {"term": {"user_id": user_id}},
            {
                "bool": {
                    "should": [
                        # 中文全文匹配（权重最高）
                        {
                            "match": {
                                "content_text": {
                                    "query": query,
                                    "boost": 3.0,
                                    "minimum_should_match": "75%",
                                }
                            }
                        },
                        # 拼音搜索
                        {
                            "match": {
                                "content_text.pinyin": {
                                    "query": query,
                                    "boost": 1.0,
                                }
                            }
                        },
                        # 精确短语匹配
                        {
                            "match_phrase": {
                                "content_text": {
                                    "query": query,
                                    "boost": 5.0,
                                    "slop": 2,
                                }
                            }
                        },
                    ]
                }
            },
        ]

        # 学科过滤
        if subject is not None:
            must.append({"term": {"subject": subject}})

        # 场景过滤
        if scenario is not None:
            must.append({"term": {"scenario": scenario}})

        # 日期范围
        date_filter = {}
        if date_from:
            date_filter["gte"] = date_from
        if date_to:
            date_filter["lte"] = date_to

        filters = []
        if date_filter:
            filters.append({"range": {"created_date": date_filter}})

        es_query = {
            "query": {
                "bool": {
                    "must": must,
                    "filter": filters,
                }
            },
            "sort": [
                {"_score": "desc"},
                {"created_at": "desc"},
            ],
            "from": (page - 1) * page_size,
            "size": page_size,
            "highlight": {
                "fields": {
                    "content_text": {
                        "fragment_size": 150,
                        "number_of_fragments": 1,
                        "pre_tags": ["<em>"],
                        "post_tags": ["</em>"],
                        "require_field_match": True,
                    }
                },
                "order": "score",
            },
            "aggs": {
                "by_conversation": {
                    "terms": {
                        "field": "conversation_id",
                        "size": page_size,
                        "order": {"max_score": "desc"},
                    },
                    "aggs": {
                        "max_score": {"max": {"script": "_score"}},
                        "top_hit": {
                            "top_hits": {
                                "size": 1,
                                "sort": [{"_score": "desc"}],
                                "highlight": {
                                    "fields": {"content_text": {"fragment_size": 150}}
                                },
                                "_source": [
                                    "message_id", "role", "created_at",
                                    "conversation_id"
                                ],
                            }
                        },
                    },
                },
            },
        }

        # 执行搜索
        result = await self.es.search(
            index="ai_dialogue_messages_*",
            body=es_query,
            routing=str(user_id),
        )

        # 转换结果
        items = []
        for bucket in result["aggregations"]["by_conversation"]["buckets"]:
            hit = bucket["top_hit"]["hits"]["hits"][0] if bucket["top_hit"]["hits"]["hits"] else None
            if hit:
                highlight = hit.get("highlight", {}).get("content_text", [""])[0]
                items.append({
                    "conversation_id": bucket["key"],
                    "matched_message_id": hit["_source"]["message_id"],
                    "content_highlight": highlight,
                    "created_at": hit["_source"]["created_at"],
                    "relevance_score": bucket["max_score"]["value"],
                })

        # 补充会话标题
        conv_ids = [item["conversation_id"] for item in items]
        conv_map = await self._batch_get_conv_meta(conv_ids)
        for item in items:
            conv = conv_map.get(item["conversation_id"], {})
            item["title"] = conv.get("session_title", "")
            item["subject"] = conv.get("subject")

        return {
            "total": result["hits"]["total"]["value"],
            "took_ms": result["took"],
            "items": items,
        }
```

---

## 10. 错误处理与降级策略

### 10.1 错误码定义

| 错误码 | HTTP状态 | 说明 | 处理策略 |
| --- | --- | --- | --- |
| DIALOGUE_001 | 400 | 会话不存在 | 返回提示信息 |
| DIALOGUE_002 | 403 | 无权访问他人会话 | 安全告警+拒绝 |
| DIALOGUE_003 | 429 | 消息频率超限 | 返回剩余冷却时间 |
| DIALOGUE_004 | 413 | 单条消息超长（>50KB） | 截断+提示 |
| DIALOGUE_005 | 500 | MySQL写入失败 | 降级到本地文件+重试 |
| DIALOGUE_006 | 503 | ES搜索不可用 | 降级到MySQL LIKE查询 |
| DIALOGUE_007 | 503 | Redis不可用 | 直查MySQL |
| DIALOGUE_008 | 404 | 归档数据恢复失败 | 提示稍后重试 |
| DIALOGUE_009 | 400 | 游标格式无效 | 返回第一页 |
| DIALOGUE_010 | 500 | 消息序列号冲突 | 重试+告警 |

### 10.2 降级策略

```python
class DialogueDegradationManager:
    """
    对话服务降级管理器
    """

    # MySQL不可用时的降级策略
    async def write_with_mysql_down(self, message: dict):
        """
        降级方案1：MySQL不可用时
        - 消息写入Redis临时队列
        - 启动恢复任务在MySQL恢复后补写
        """
        try:
            # 写入Redis临时列表
            await self.redis.rpush(
                "dialogue:fallback:pending",
                json.dumps(message, default=str)
            )
            await self.redis.sadd("dialogue:fallback:convs", message["conversation_id"])

            # 更新Redis缓存（至少前端能显示）
            await self._update_cache_only(message)

            logger.warning(f"MySQL down, message {message['id']} saved to Redis fallback")
            return {"message_id": message["id"], "degraded": True}

        except Exception:
            # Redis也不可用，写本地文件
            await self._write_to_local_file(message)
            raise ServiceUnavailableError("Storage layer unavailable")

    async def recover_from_mysql_outage(self):
        """
        MySQL恢复后的补偿写入
        """
        pending_messages = await self.redis.lrange("dialogue:fallback:pending", 0, -1)
        if not pending_messages:
            return

        logger.info(f"Recovering {len(pending_messages)} pending messages")

        for msg_json in pending_messages:
            message = json.loads(msg_json)
            try:
                await self.db.insert("ai_conversation_message", message)
                await self.redis.lrem("dialogue:fallback:pending", 1, msg_json)
            except Exception as e:
                logger.error(f"Recovery write failed for message {message['id']}: {e}")
                break  # 停止恢复，等待下一轮重试

    # ES不可用时的降级策略
    async def search_with_es_down(
        self, user_id: int, query: str, subject: int = None, page: int = 1, page_size: int = 20
    ) -> dict:
        """
        降级方案2：ES不可用时
        - 使用MySQL全文索引或LIKE查询
        - 性能较差但功能可用
        """
        offset = (page - 1) * page_size

        where = "user_id = %s AND content LIKE %s"
        params = [user_id, f"%{query}%"]

        if subject is not None:
            where += " AND subject = %s"
            params.append(subject)

        # 先查会话标题
        conv_rows = await self.db.fetch_all(
            f"""SELECT c.id, c.session_title, c.subject, c.last_message_at
                FROM ai_conversation c
                WHERE c.user_id = %s AND c.session_title LIKE %s
                ORDER BY c.last_message_at DESC
                LIMIT %s OFFSET %s""",
            [user_id, f"%{query}%", page_size, offset]
        )

        # 再查消息内容
        msg_rows = await self.db.fetch_all(
            f"""SELECT m.conversation_id, m.id as message_id, m.content, m.created_at
                FROM ai_conversation_message m
                WHERE {where}
                ORDER BY m.created_at DESC
                LIMIT %s OFFSET %s""",
            params + [page_size, offset]
        )

        items = []
        seen_convs = {r["id"] for r in conv_rows}

        for row in msg_rows:
            if row["conversation_id"] not in seen_convs:
                items.append({
                    "conversation_id": row["conversation_id"],
                    "content_highlight": self._simple_highlight(row["content"], query),
                })

        for row in conv_rows:
            if row["id"] not in {i["conversation_id"] for i in items}:
                items.append({
                    "conversation_id": row["id"],
                    "content_highlight": self._simple_highlight(row["session_title"], query),
                })

        return {
            "total": len(items),
            "took_ms": 0,
            "items": items[:page_size],
            "degraded": True,
        }

    def _simple_highlight(self, text: str, keyword: str) -> str:
        """简单高亮（降级模式）"""
        if not text or not keyword:
            return text or ""
        # 转义正则特殊字符
        import re
        escaped = re.escape(keyword)
        return re.sub(f"({escaped})", r"<em>\1</em>", text, flags=re.IGNORECASE)[:200]
```

---

## 11. 监控与告警

### 11.1 关键监控指标

| 指标 | 采集方式 | 告警阈值 |
| --- | --- | --- |
| 消息写入成功率 | Prometheus counter | < 99.9% (1min窗口) |
| 消息写入延迟P99 | Histogram | > 100ms |
| 会话列表查询延迟P99 | Histogram | > 300ms |
| 全文搜索延迟P99 | Histogram | > 800ms |
| ES索引滞后时间 | 自定义指标 | > 60s |
| 知识点标注成功率 | Counter | < 90% |
| 归档任务执行时长 | Histogram | > 2h |
| Redis缓存命中率 | Gauge | < 70% |
| MQ消息积压量 | Gauge | > 10000 |

### 11.2 Prometheus埋点示例

```python
from prometheus_client import Counter, Histogram, Gauge

# 指标定义
message_write_total = Counter(
    "dialogue_message_write_total",
    "Total messages written",
    ["status"]  # success, failure
)

message_write_latency = Histogram(
    "dialogue_message_write_latency_seconds",
    "Message write latency",
    buckets=[0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0]
)

search_latency = Histogram(
    "dialogue_search_latency_seconds",
    "Full-text search latency",
    ["source"],  # elasticsearch, mysql_fallback
    buckets=[0.05, 0.1, 0.2, 0.5, 1.0, 2.0]
)

cache_hit_rate = Gauge(
    "dialogue_cache_hit_rate",
    "Redis cache hit rate for dialogue queries"
)

es_lag_seconds = Gauge(
    "dialogue_es_index_lag_seconds",
    "ES indexing lag in seconds"
)

mq_backlog = Gauge(
    "dialogue_mq_backlog_size",
    "Message queue backlog size"
)
```

---

## 12. 安全与权限

### 12.1 数据隔离

```python
class DialogueAccessControl:
    """
    对话数据访问控制
    - 学生只能访问自己的对话
    - 家长可查看绑定孩子的对话（受限）
    - 教师可查看班级学生的对话摘要（不含详细内容）
    """

    async def validate_access(
        self, user_id: int, conversation_id: int, access_type: str = "read"
    ) -> bool:
        # 1. 验证会话归属
        conv = await self.db.fetch_one(
            "SELECT user_id, status FROM ai_conversation WHERE id = %s",
            [conversation_id]
        )

        if not conv:
            return False

        # 2. 数据所有者——完全权限
        if conv["user_id"] == user_id:
            return True

        # 3. 家长访问——需要绑定关系+家长权限配置
        parent_binding = await self.db.fetch_one(
            """SELECT * FROM parent_student_binding 
               WHERE parent_user_id = %s AND student_user_id = %s 
               AND status = 1""",
            [user_id, conv["user_id"]]
        )

        if parent_binding:
            permissions = json.loads(parent_binding.get("permissions", "{}"))
            # 检查家长是否有权查看对话内容
            if permissions.get("view_dialogues", False):
                # 家长可能只能看特定学科的对话
                allowed_subjects = permissions.get("allowed_subjects", [])
                if allowed_subjects and conv.get("subject") not in allowed_subjects:
                    return False
                return True

        # 4. 教师访问——需要班级关系+只读摘要权限
        teacher_classes = await self.db.fetch_all(
            """SELECT class_id FROM teacher_class 
               WHERE teacher_user_id = %s AND status = 1""",
            [user_id]
        )

        if teacher_classes:
            student_class = await self.db.fetch_one(
                """SELECT class_id FROM student_class 
                   WHERE student_user_id = %s AND status = 1""",
                [conv["user_id"]]
            )

            if student_class and student_class["class_id"] in [t["class_id"] for t in teacher_classes]:
                # 教师只能查看会话摘要，不能查看详细消息
                return access_type == "summary"

        return False
```

### 12.2 敏感内容过滤

AI对话内容在写入前经过轻量级敏感信息检测：

```python
class ContentSanitizer:
    """
    消息内容脱敏处理
    - 检测并遮蔽手机号、身份证号等PII
    - 记录敏感内容标记用于后续审核
    """

    PATTERNS = {
        "phone": (r"1[3-9]\d{9}", "PHONE_MASKED"),
        "id_card": (r"\d{17}[\dXx]", "ID_CARD_MASKED"),
        "email": (r"[\w.-]+@[\w.-]+\.\w+", "EMAIL_MASKED"),
        "qq": (r"QQ[:\s]*(\d{5,12})", "QQ_MASKED"),
        "wechat": (r"(微信|wechat|v信)[:\s]*([a-zA-Z\d_-]{6,20})", "WECHAT_MASKED"),
    }

    async def sanitize(self, content: str) -> tuple[str, list]:
        """
        返回 (脱敏后内容, 敏感信息标记列表)
        """
        flags = []
        sanitized = content

        for pii_type, (pattern, placeholder) in self.PATTERNS.items():
            import re
            matches = list(re.finditer(pattern, sanitized, re.IGNORECASE))
            if matches:
                for match in matches:
                    flags.append({
                        "type": pii_type,
                        "position": match.start(),
                        "length": len(match.group()),
                        "masked": True,
                    })
                sanitized = re.sub(pattern, f"[{placeholder}]", sanitized, flags=re.IGNORECASE)

        return sanitized, flags
```

---

## 13. 部署与扩容

### 13.1 部署架构

```
                    ┌─────────────┐
                    │  Nginx/SLB  │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌─────┴───┐  ┌────┴────┐  ┌───┴─────┐
        │ API实例1 │  │API实例2  │  │API实例3 │  (水平扩展)
        │(2C4G)   │  │(2C4G)   │  │(2C4G)   │
        └─────┬───┘  └────┬────┘  └───┬─────┘
              │            │            │
     ┌────────┼────────────┼────────────┼────────┐
     │        ▼            ▼            ▼        │
     │   ┌────────────────────────────────────┐  │
     │   │        MySQL主从集群 (分片)         │  │
     │   │  分片1(M) ← 分片1(S)              │  │
     │   │  分片2(M) ← 分片2(S)              │  │
     │   │  分片3(M) ← 分片3(S)              │  │
     │   │  分片4(M) ← 分片4(S)              │  │
     │   └────────────────────────────────────┘  │
     │                                           │
     │   ┌────────────────────────────────────┐  │
     │   │        Redis Cluster (6节点)       │  │
     │   └────────────────────────────────────┘  │
     │                                           │
     │   ┌────────────────────────────────────┐  │
     │   │    Elasticsearch Cluster (6节点)   │  │
     │   │    3 Master + 3 Data Node          │  │
     │   └────────────────────────────────────┘  │
     │                                           │
     │   ┌────────────────────────────────────┐  │
     │   │         RocketMQ集群               │  │
     │   └────────────────────────────────────┘  │
     │                                           │
     │   ┌────────────────────────────────────┐  │
     │   │    OSS对象存储 (冷数据归档)         │  │
     │   └────────────────────────────────────┘  │
     └───────────────────────────────────────────┘
```

### 13.2 容量规划

| 组件 | 初始容量 | 扩容指标 | 扩容方案 |
| --- | --- | --- | --- |
| API实例 | 3实例(2C4G) | CPU > 70% | 水平扩展至10实例 |
| MySQL分片 | 4分片(8C32G) | 单表 > 5000万行 | 扩展至8分片 |
| Redis | 6节点(8G) | 内存 > 70% | 扩展至9节点 |
| ES集群 | 6节点(8C32G) | 索引大小 > 500GB | 增加Data Node |
| MQ | 3节点(4C16G) | 积压 > 10万 | 增加消费者组 |
| OSS | 按量付费 | - | 自动扩展 |

### 13.3 用户量与数据量预估

| 用户规模 | 日活(DAU) | 日消息量 | 月消息量 | 数据存储(MySQL) | ES索引 | OSS归档 |
| --- | --- | --- | --- | --- | --- | --- |
| 10万 | 3万 | 30万 | 900万 | ~50GB | ~30GB | - |
| 50万 | 15万 | 150万 | 4500万 | ~250GB | ~150GB | ~500GB/年 |
| 100万 | 30万 | 300万 | 9000万 | ~500GB | ~300GB | ~1TB/年 |
| 500万 | 150万 | 1500万 | 4.5亿 | ~2.5TB | ~1.5TB | ~5TB/年 |

---

## 14. 附录

### 14.1 消息序列号生成方案

```python
class MessageSequenceGenerator:
    """
    会话内消息序号生成器
    保证同一会话内消息序号严格递增、无空洞
    """

    async def next_seq(self, conversation_id: int) -> int:
        # 方案1: Redis INCR（首选，高性能）
        try:
            key = f"dialogue:seq:{conversation_id}"
            seq = await self.redis.incr(key)
            await self.redis.expire(key, 7 * 86400)  # 7天过期
            return seq
        except RedisError:
            pass

        # 方案2: MySQL行锁（Redis不可用时降级）
        async with self.db.transaction() as tx:
            # SELECT ... FOR UPDATE 锁定会话行
            await tx.execute(
                "SELECT message_count FROM ai_conversation WHERE id = %s FOR UPDATE",
                [conversation_id]
            )
            seq_result = await tx.fetch_one(
                "SELECT COALESCE(MAX(seq), 0) + 1 as next_seq FROM ai_conversation_message WHERE conversation_id = %s",
                [conversation_id]
            )
            return seq_result["next_seq"]
```

### 14.2 Markdown内容预处理

```python
class MarkdownPreprocessor:
    """
    消息内容预处理
    在存储前统一格式，便于后续渲染和检索
    """

    def process(self, content: str) -> dict:
        """
        返回 {
            "clean_content": 去除Markdown语法后的纯文本(用于ES索引),
            "has_formula": bool,
            "has_code": bool,
            "has_image": bool,
        }
        """
        import re

        # 检测LaTeX公式
        has_formula = bool(
            re.search(r"\$\$.+?\$\$|\$.+?\$|\\\(.+?\\\)|\\\[.+?\\\]", content, re.DOTALL)
        )

        # 检测代码块
        has_code = bool(re.search(r"```[\s\S]*?```|`[^`]+`", content))

        # 检测图片
        has_image = bool(re.search(r"!\[.*?\]\(.*?\)", content))

        # 提取纯文本（去除Markdown语法）
        clean = content
        clean = re.sub(r"\$\$(.+?)\$\$", r"\1", clean, flags=re.DOTALL)
        clean = re.sub(r"\$(.+?)\$", r"\1", clean)
        clean = re.sub(r"!\[.*?\]\(.*?\)", "", clean)  # 去图片
        clean = re.sub(r"\[([^\]]+)\]\([^\]]+\)", r"\1", clean)  # 链接保留文字
        clean = re.sub(r"```[\s\S]*?```", "", clean)  # 去代码块
        clean = re.sub(r"`([^`]+)`", r"\1", clean)  # 行内代码保留内容
        clean = re.sub(r"#{1,6}\s+", "", clean)  # 去标题符号
        clean = re.sub(r"[*_~]{1,3}", "", clean)  # 去粗体斜体
        clean = re.sub(r"^>\s+", "", clean, flags=re.MULTILINE)  # 去引用
        clean = re.sub(r"^[-*+]\s+", "", clean, flags=re.MULTILINE)  # 去列表符号
        clean = re.sub(r"\n{3,}", "\n\n", clean)  # 压缩多余空行
        clean = clean.strip()

        return {
            "clean_content": clean[:5000],  # 限制长度
            "has_formula": has_formula,
            "has_code": has_code,
            "has_image": has_image,
        }
```

### 14.3 变更日志

| 日期 | 版本 | 变更内容 | 作者 |
| --- | --- | --- | --- |
| 2026-08-05 | v1.0 | 初始版本 | PrimeTop设计细化助手 |
