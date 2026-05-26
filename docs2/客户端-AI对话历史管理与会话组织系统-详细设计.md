# 客户端-AI对话历史管理与会话组织系统-详细设计

## 1. 模块概述

### 1.1 功能定位

为用户提供 AI 对话历史的管理能力，包括会话列表浏览、搜索、分类归档、收藏置顶、批量删除、跨设备同步和离线访问。作为 AI 辅导模块的子功能，独立于"活跃对话"页面的实时交互，专注于"回顾、整理、检索"场景。

### 1.2 设计目标

| 目标 | 说明 |
|------|------|
| 快速回溯 | 3次点击内找到任意历史对话 |
| 离线可用 | 无网络时仍可浏览全部本地历史 |
| 跨设备一致 | 多端登录时对话历史自动同步 |
| 智能整理 | 自动提取标题、标签、关联知识点 |
| 存储可控 | 本地缓存策略透明，用户可管理存储占用 |

### 1.3 与已有模块的关系

| 模块 | 边界 |
|------|------|
| AI对话引擎与会话管理（服务端） | 本模块消费其 `Conversation` 实体和消息CRUD API |
| 客户端AI对话页面交互与组件架构 | 本模块提供历史列表页入口；点击历史项跳转到该模块渲染 |
| 知识点体系与教材映射引擎 | 自动标注：从对话内容中提取知识点标签 |
| 收藏与笔记系统 | 对话可收藏到收藏夹；部分内容可转为笔记 |
| 离线缓存与数据同步 | 本模块遵循统一的离线/同步规范 |
| 用户额度与API调用管控系统 | 历史列表展示额度消耗摘要 |

---

## 2. 核心数据结构

### 2.1 客户端本地数据模型（Hive Box: `conversation_history`）

```dart
/// 对话会话摘要（列表展示用）
@HiveType(typeId: 30)
class ConversationSummary extends HiveObject {
  @HiveField(0)
  String conversationId;      // 服务端 conversation ID

  @HiveField(1)
  String title;               // 自动生成 / 用户修改的标题

  @HiveField(2)
  String? userTitle;          // 用户自定义标题（优先显示）

  @HiveField(3)
  ConversationType type;      // 对话类型

  @HiveField(4)
  String scene;               // 场景标识：tutor/photo_quiz/essay/free_chat...

  @HiveField(5)
  List<String> knowledgePointIds; // 关联知识点ID列表

  @HiveField(6)
  List<String> subjectTags;   // 学科标签：["数学", "几何"]

  @HiveField(7)
  int messageCount;           // 消息总数

  @HiveField(8)
  DateTime createdAt;

  @HiveField(9)
  DateTime updatedAt;

  @HiveField(10)
  DateTime? lastViewedAt;     // 最后查看时间（用于排序）

  @HiveField(11)
  bool isPinned;              // 是否置顶

  @HiveField(12)
  bool isArchived;            // 是否归档

  @HiveField(13)
  bool isFavorite;            // 是否收藏

  @HiveField(14)
  String? folderId;           // 所属文件夹ID

  @HiveField(15)
  ConversationStatus status;  // active/completed/deleted

  @HiveField(16)
  String? firstMessagePreview; // 首条用户消息预览（前50字）

  @HiveField(17)
  String? lastAiMessagePreview; // 末条AI消息预览（前80字）

  @HiveField(18)
  int totalTokensUsed;        // 该会话消耗的总token数

  @HiveField(19)
  int syncVersion;            // 同步版本号（乐观锁）

  @HiveField(20)
  bool isOfflineOnly;         // 是否仅离线创建（未同步到服务端）
}

/// 对话类型枚举
enum ConversationType {
  @HiveField(0)
  textChat,        // 文字问答
  @HiveField(1)
  photoQuiz,       // 拍题答疑
  @HiveField(2)
  essayReview,     // 作文批改
  @HiveField(3)
  oralPractice,    // 口语练习
  @HiveField(4)
  recitation,      // 背诵检测
  @HiveField(5)
  freeChat,        // 自由对话
}

/// 对话状态枚举
enum ConversationStatus {
  @HiveField(0)
  active,          // 进行中
  @HiveField(1)
  completed,       // 已结束
  @HiveField(2)
  deleted,         // 已删除（软删除，等待同步）
}

/// 消息摘要（用于搜索索引，不存完整内容）
@HiveType(typeId: 31)
class MessageIndexEntry extends HiveObject {
  @HiveField(0)
  String messageId;

  @HiveField(1)
  String conversationId;

  @HiveField(2)
  String role;            // user / assistant / system

  @HiveField(3)
  String plainText;       // 纯文本内容（去公式/去格式）

  @HiveField(4)
  DateTime createdAt;

  @HiveField(5)
  List<String> keywords;  // 自动提取的关键词
}

/// 用户自定义文件夹
@HiveType(typeId: 32)
class ConversationFolder extends HiveObject {
  @HiveField(0)
  String folderId;

  @HiveField(1)
  String name;

  @HiveField(2)
  String? emoji;           // 文件夹图标

  @HiveField(3)
  int sortOrder;

  @HiveField(4)
  DateTime createdAt;

  @HiveField(5)
  DateTime updatedAt;

  @HiveField(6)
  int conversationCount;   // 冗余计数，减少列表查询计算
}
```

### 2.2 服务端数据模型扩展

在 `conversations` 表上扩展以下字段：

```sql
ALTER TABLE conversations ADD COLUMN user_title VARCHAR(200) DEFAULT NULL;
ALTER TABLE conversations ADD COLUMN is_pinned TINYINT(1) DEFAULT 0;
ALTER TABLE conversations ADD COLUMN is_archived TINYINT(1) DEFAULT 0;
ALTER TABLE conversations ADD COLUMN is_favorite TINYINT(1) DEFAULT 0;
ALTER TABLE conversations ADD COLUMN folder_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE conversations ADD COLUMN last_viewed_at DATETIME DEFAULT NULL;
ALTER TABLE conversations ADD COLUMN auto_title VARCHAR(200) DEFAULT NULL;
ALTER TABLE conversations ADD COLUMN auto_tags JSON DEFAULT NULL;

-- 文件夹表
CREATE TABLE conversation_folders (
    folder_id       VARCHAR(36) PRIMARY KEY,
    user_id         VARCHAR(36) NOT NULL,
    name            VARCHAR(50) NOT NULL,
    emoji           VARCHAR(10) DEFAULT NULL,
    sort_order      INT DEFAULT 0,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    is_deleted      TINYINT(1) DEFAULT 0,
    INDEX idx_user_folders (user_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 3. API 接口设计

### 3.1 对话列表查询

```
GET /api/v1/conversations
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| cursor | string | 否 | 分页游标 |
| limit | int | 否 | 每页数量，默认20，最大50 |
| filter | string | 否 | 筛选条件：`all`/`pinned`/`archived`/`favorite`/`folder:{id}` |
| type | string | 否 | 按对话类型筛选 |
| subject | string | 否 | 按学科筛选 |
| date_from | string | 否 | 起始日期 ISO8601 |
| date_to | string | 否 | 结束日期 ISO8601 |
| sort | string | 否 | 排序：`updated_desc`（默认）/`created_desc`/`title_asc` |

**响应：**

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "conversationId": "conv_abc123",
        "title": "二次函数最值问题",
        "userTitle": null,
        "displayTitle": "二次函数最值问题",
        "type": "textChat",
        "scene": "tutor",
        "subjectTags": ["数学"],
        "knowledgePointIds": ["kp_math_quad_func"],
        "messageCount": 12,
        "firstMessagePreview": "y=-x²+4x-1的最大值怎么求？",
        "lastAiMessagePreview": "所以当x=2时，y取最大值3。你可以用配方法或顶点公式...",
        "isPinned": false,
        "isArchived": false,
        "isFavorite": true,
        "folderId": null,
        "status": "active",
        "createdAt": "2026-05-25T14:30:00Z",
        "updatedAt": "2026-05-25T14:45:00Z",
        "lastViewedAt": "2026-05-25T14:45:00Z",
        "totalTokensUsed": 3500
      }
    ],
    "cursor": "eyJ1cGRhdGVkX2F0IjoiMjAyNi0wNS0yNVQxNDozMDowMFoiLCJpZCI6ImNvbnZfYWJjMTIzIn0=",
    "hasMore": true,
    "totalCount": 156
  }
}
```

### 3.2 搜索对话

```
GET /api/v1/conversations/search
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | 是 | 搜索关键词 |
| scope | string | 否 | `all`/`titles`/`messages`，默认 `all` |
| subject | string | 否 | 按学科筛选 |
| type | string | 否 | 按对话类型筛选 |
| date_from | string | 否 | 起始日期 |
| date_to | string | 否 | 结束日期 |
| cursor | string | 否 | 分页游标 |
| limit | int | 否 | 默认20 |

**响应：** 与列表接口同结构，额外包含高亮信息：

```json
{
  "conversationId": "conv_abc123",
  "title": "二次函数最值问题",
  "highlights": [
    {
      "messageId": "msg_456",
      "snippet": "...当x=2时，<em>y取最大值</em>3...",
      "role": "assistant"
    }
  ]
}
```

### 3.3 更新对话元数据

```
PATCH /api/v1/conversations/{conversationId}/meta
```

**请求体：**

```json
{
  "userTitle": "二次函数重点复习",
  "isPinned": true,
  "isArchived": false,
  "isFavorite": true,
  "folderId": "folder_xyz789"
}
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "conversationId": "conv_abc123",
    "updatedAt": "2026-05-27T10:00:00Z",
    "syncVersion": 5
  }
}
```

### 3.4 批量操作

```
POST /api/v1/conversations/batch
```

```json
{
  "action": "archive|delete|move|favorite|unfavorite",
  "conversationIds": ["conv_abc123", "conv_def456"],
  "params": {
    "folderId": "folder_xyz789"
  }
}
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "succeeded": 2,
    "failed": 0,
    "errors": []
  }
}
```

### 3.5 文件夹管理

```
POST   /api/v1/conversation-folders           # 创建文件夹
GET    /api/v1/conversation-folders           # 获取文件夹列表
PATCH  /api/v1/conversation-folders/{id}      # 更新文件夹
DELETE /api/v1/conversation-folders/{id}      # 删除文件夹（对话移至根目录）
PATCH  /api/v1/conversation-folders/sort      # 排序
```

**创建请求体：**

```json
{
  "name": "期末复习",
  "emoji": "📚"
}
```

### 3.6 导出对话

```
POST /api/v1/conversations/{conversationId}/export
```

```json
{
  "format": "markdown|pdf|image",
  "includeSystem": false
}
```

**响应（异步任务）：**

```json
{
  "code": 0,
  "data": {
    "taskId": "task_export_001",
    "status": "processing"
  }
}
```

---

## 4. 状态流转

### 4.1 对话生命周期状态机

```
                    ┌──────────────┐
                    │              │
                    ▼              │
  [新建] ──→  active ──→ completed │
                │  ▲         │    │
                │  │         │    │
                ▼  │         ▼    │
            archived ────→ deleted│
                │  ▲              │
                │  │              │
                ▼  │              │
           (restore)──────────────┘
                                    (永久删除，30天后清理)
```

| 转换 | 触发条件 | 动作 |
|------|----------|------|
| → active | 新建对话 / 从归档恢复 | 更新 updatedAt |
| active → completed | 用户点击"结束对话" / 24小时无消息 | 触发标题自动生成 |
| active → archived | 用户手动归档 | 从默认列表移除 |
| archived → active | 用户取消归档 | 恢复到默认列表 |
| active/completed → deleted | 用户删除（软删除） | 标记 deleted，30天后硬删 |
| deleted → active | 撤销删除（24小时内） | 恢复到列表 |

### 4.2 同步状态机

```
  [本地创建] ──→ pending_sync ──→ synced
                      │               ▲
                      │  (网络失败)   │
                      ▼               │
                   sync_failed ───────┘
                      │   (重试)
                      └──→ pending_sync
```

---

## 5. 客户端架构设计

### 5.1 分层架构

```
┌─────────────────────────────────────────────┐
│  UI Layer                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │历史列表页 │ │搜索页    │ │文件夹管理页  │ │
│  └─────┬────┘ └─────┬────┘ └──────┬───────┘ │
├────────┼────────────┼──────────────┼─────────┤
│  Controller Layer                            │
│  ┌──────┴──────────┴──────────────┴───────┐  │
│  │  ConversationHistoryController          │  │
│  │  (Riverpod StateNotifier)               │  │
│  └──────┬──────────────────────────┬──────┘  │
├─────────┼──────────────────────────┼─────────┤
│  Service Layer                                │
│  ┌──────┴──────┐  ┌────────────┐  ┌────────┐ │
│  │LocalService │  │RemoteService│  │SyncSvc │ │
│  │(Hive CRUD)  │  │(API调用)    │  │(同步)  │ │
│  └─────────────┘  └────────────┘  └────────┘ │
├──────────────────────────────────────────────┤
│  Data Layer                                   │
│  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │Hive Box  │  │Dio HTTP  │  │FTS5 Search  │ │
│  └──────────┘  └──────────┘  └─────────────┘ │
└──────────────────────────────────────────────┘
```

### 5.2 Riverpod Provider 设计

```dart
// ===== State 定义 =====

/// 列表页状态
@freezed
class ConversationHistoryState with _$ConversationHistoryState {
  const factory ConversationHistoryState({
    @Default([]) List<ConversationSummary> conversations,
    @Default(false) bool isLoading,
    @Default(false) bool isLoadingMore,
    @Default(false) bool hasMore,
    String? cursor,
    String? error,
    ConversationListFilter? activeFilter,
    String? activeFolderId,
    @Default(ConversationListSort.updatedDesc)
    ConversationListSort sort,
    // 批量操作模式
    @Default(false) bool isSelectMode,
    @Default({}) Set<String> selectedIds,
    // 文件夹列表
    @Default([]) List<ConversationFolder> folders,
  }) = _ConversationHistoryState;
}

/// 搜索状态
@freezed
class ConversationSearchState with _$ConversationSearchState {
  const factory ConversationSearchState({
    String? query,
    @Default([]) List<ConversationSummary> results,
    @Default([]) List<SearchHighlight> highlights,
    @Default(false) bool isSearching,
    String? error,
    @Default(false) bool hasMore,
    String? cursor,
  }) = _ConversationSearchState;
}

// ===== Provider 定义 =====

/// 历史列表 Controller
@riverpod
class ConversationHistory extends _$ConversationHistory {
  @override
  ConversationHistoryState build() {
    // 初始化时加载本地缓存 + 触发远程刷新
    _loadFromLocal();
    _syncFromRemote();
    return const ConversationHistoryState();
  }

  Future<void> _loadFromLocal() async { /* ... */ }
  Future<void> _syncFromRemote() async { /* ... */ }
  Future<void> loadMore() async { /* ... */ }
  Future<void> refresh() async { /* ... */ }

  // 筛选与排序
  void setFilter(ConversationListFilter filter) { /* ... */ }
  void setSort(ConversationListSort sort) { /* ... */ }
  void setFolder(String? folderId) { /* ... */ }

  // 单项操作
  Future<void> togglePin(String id) async { /* ... */ }
  Future<void> toggleFavorite(String id) async { /* ... */ }
  Future<void> archive(String id) async { /* ... */ }
  Future<void> unarchive(String id) async { /* ... */ }
  Future<void> moveToFolder(String id, String? folderId) async { /* ... */ }
  Future<void> rename(String id, String title) async { /* ... */ }
  Future<void> deleteSingle(String id) async { /* ... */ }

  // 批量操作
  void enterSelectMode() { /* ... */ }
  void exitSelectMode() { /* ... */ }
  void toggleSelect(String id) { /* ... */ }
  void selectAll() { /* ... */ }
  Future<void> batchArchive() async { /* ... */ }
  Future<void> batchDelete() async { /* ... */ }
  Future<void> batchMoveToFolder(String folderId) async { /* ... */ }
}

/// 搜索 Controller
@riverpod
class ConversationSearch extends _$ConversationSearch {
  @override
  ConversationSearchState build() =>
      const ConversationSearchState();

  Future<void> search(String query, {String? scope}) async {
    // 1. 先查本地 FTS5 索引（即时结果）
    // 2. 再查远程（补充完整高亮）
  }

  Future<void> loadMore() async { /* ... */ }
  void clear() { /* ... */ }
}

/// 文件夹管理 Controller
@riverpod
class FolderManagement extends _$FolderManagement {
  @override
  List<ConversationFolder> build() {
    return _loadFromLocal();
  }

  Future<void> createFolder(String name, String? emoji) async { /* ... */ }
  Future<void> renameFolder(String id, String name) async { /* ... */ }
  Future<void> deleteFolder(String id) async { /* ... */ }
  Future<void> reorderFolders(List<String> orderedIds) async { /* ... */ }
}

/// 对话详情/导出
@riverpod
class ConversationExport extends _$ConversationExport {
  @override
  AsyncValue<ExportResult?> build() => const AsyncValue.data(null);

  Future<void> export(String conversationId, ExportFormat format) async {
    // 调用异步任务 API → 轮询状态 → 下载文件
  }
}
```

### 5.3 本地搜索实现（SQLite FTS5）

```dart
class ConversationSearchService {
  final HiveBox<MessageIndexEntry> _messageIndex;

  /// 初始化搜索索引（在 Isolate 中运行）
  Future<void> rebuildSearchIndex() async {
    // 使用 Hive lazy box 遍历所有 MessageIndexEntry
    // 批量写入 FTS5 虚拟表
  }

  /// 本地搜索
  Future<List<SearchResult>> searchLocal(String query, {int limit = 20}) async {
    final db = await _getDb();

    // FTS5 搜索，支持中文分词（simple tokenizer + 拼音首字母）
    final results = await db.rawQuery('''
      SELECT
        m.conversation_id,
        m.message_id,
        m.role,
        snippet(messages_fts, '', '<em>', '</em>', '...', 32) as snippet,
        rank
      FROM messages_fts f
      JOIN message_index m ON f.rowid = m.fts_rowid
      WHERE messages_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    ''', [query, limit]);

    return results.map((r) => SearchResult.fromMap(r)).toList();
  }

  /// 为新消息建立索引
  Future<void> indexMessage(MessageIndexEntry entry) async {
    final db = await _getDb();
    await db.insert('message_index', {
      'message_id': entry.messageId,
      'conversation_id': entry.conversationId,
      'role': entry.role,
      'plain_text': entry.plainText,
      'keywords': entry.keywords.join(','),
      'created_at': entry.createdAt.toIso8601String(),
    });
    await db.rawInsert(
      'INSERT INTO messages_fts(rowid, content) VALUES (?, ?)',
      [db.lastInsertRowId(), '${entry.plainText} ${entry.keywords.join(' ')}'],
    );
  }
}
```

---

## 6. 关键交互流程

### 6.1 首次进入历史列表

```
用户点击"历史记录"Tab
        │
        ▼
  ┌─────────────┐
  │ 显示骨架屏   │  ← 立即渲染
  └──────┬──────┘
         │
         ▼
  ┌─────────────────┐
  │ 读取 Hive 缓存   │  ← <50ms
  └──────┬──────────┘
         │
    有数据？──否──→ 显示空态引导页
         │
         是
         ▼
  ┌──────────────────┐
  │ 渲染本地列表      │  ← 骨架屏 → 内容过渡
  └──────┬───────────┘
         │
         ▼
  ┌──────────────────┐
  │ 并发请求远程列表  │  ← 后台静默
  │ (cursor=null)    │
  └──────┬───────────┘
         │
    有更新？──否──→ 保持本地列表
         │
         是
         ▼
  ┌──────────────────────┐
  │ 合并远端到本地        │
  │ (按 syncVersion 乐观) │
  └──────┬───────────────┘
         │
         ▼
  ┌──────────────────┐
  │ 增量更新 UI 列表  │  ← 差量刷新，不闪屏
  └──────────────────┘
```

### 6.2 搜索流程

```
用户输入关键词
        │
        ▼
  ┌──────────────────┐
  │ 防抖 300ms        │
  └──────┬───────────┘
         │
    query.length >= 2？
         │
         是
         ▼
  ┌──────────────────┐
  │ 查本地 FTS5 索引  │  ← 即时展示（<100ms）
  └──────┬───────────┘
         │
         ▼
  ┌─────────────────────┐
  │ 并发查远程搜索 API    │  ← 补充高亮和完整匹配
  └──────┬──────────────┘
         │
    远程有更多结果？
         │
         是
         ▼
  ┌──────────────────┐
  │ 合并去重，更新 UI  │
  │ (本地结果优先)     │
  └──────────────────┘
```

### 6.3 批量删除流程

```
用户长按进入选择模式 → 勾选多个对话
        │
        ▼
  点击"删除"按钮
        │
        ▼
  ┌──────────────────┐
  │ 确认对话框        │
  │ "确定删除 N 个对话？│
  │  24小时内可撤销"   │
  └──────┬───────────┘
         │
      取消 → 退出
      确认
         │
         ▼
  ┌────────────────────────┐
  │ 1. 标记本地数据 deleted │  ← 立即从列表消失
  │ 2. 显示 SnackBar       │  ← "已删除N个对话 [撤销]"
  │ 3. 记录到操作队列       │
  │ 4. 后台同步到服务端     │
  └────────────────────────┘
         │
    24小时内用户点"撤销"？
         │
      是 → 恢复本地数据，取消同步队列中的删除操作
      否 → 同步完成，本地永久删除记录
```

### 6.4 离线创建对话后同步

```
离线状态下创建新对话
        │
        ▼
  ┌──────────────────────┐
  │ 保存到 Hive (isOfflineOnly=true) │
  │ 生成临时ID: local_xxx            │
  └──────┬─────────────────────────┘
         │
    网络恢复
         │
         ▼
  ┌──────────────────────┐
  │ 同步服务检测到待上传项 │
  └──────┬─────────────────┘
         │
         ▼
  ┌───────────────────────────┐
  │ POST /conversations 创建  │
  │ 替换 localId → serverId   │
  │ isOfflineOnly = false     │
  └───────────────────────────┘
```

---

## 7. 服务端实现要点

### 7.1 自动标题生成策略

当对话结束（24小时无消息或用户手动结束）时，触发异步标题生成：

```python
async def generate_conversation_title(conversation_id: str):
    """
    从对话中提取前3轮核心内容，调用 LLM 生成简短标题。
    """
    messages = await get_first_n_messages(conversation_id, n=6)
    
    # 只取用户消息 + AI回复的前几轮
    conversation_text = format_messages_for_title(messages)
    
    title = await llm_client.chat(
        model="fast-model",  # 用快速低成本模型
        messages=[
            {"role": "system", "content": TITLE_PROMPT},
            {"role": "user", "content": conversation_text}
        ],
        max_tokens=30,
        temperature=0.3,
    )
    
    # 清洗标题
    title = sanitize_title(title, max_length=30)
    
    await db.execute(
        "UPDATE conversations SET auto_title = :title WHERE conversation_id = :id",
        {"title": title, "id": conversation_id}
    )
    
    # 同时提取标签
    tags = await extract_subject_tags(conversation_text)
    await db.execute(
        "UPDATE conversations SET auto_tags = :tags WHERE conversation_id = :id",
        {"tags": json.dumps(tags), "id": conversation_id}
    )

TITLE_PROMPT = """根据以下学习对话内容，生成一个简短标题（15字以内），
格式要求：
- 直接输出标题，不加引号
- 突出学科和核心知识点
- 不要使用"关于""关于"等冗余词

示例：
- 二次函数最值问题
- 三角形全等证明
- 英语现在完成时
- 《背影》阅读理解
"""
```

### 7.2 搜索索引同步（ES）

```python
# 对话消息写入 ES 索引
CONVERSATION_INDEX = "conversations"

mapping = {
    "mappings": {
        "properties": {
            "conversation_id": {"type": "keyword"},
            "user_id": {"type": "keyword"},
            "title": {
                "type": "text",
                "analyzer": "ik_max_word",
                "search_analyzer": "ik_smart"
            },
            "messages": {
                "type": "nested",
                "properties": {
                    "message_id": {"type": "keyword"},
                    "role": {"type": "keyword"},
                    "content": {
                        "type": "text",
                        "analyzer": "ik_max_word",
                        "search_analyzer": "ik_smart"
                    },
                    "created_at": {"type": "date"}
                }
            },
            "subject_tags": {"type": "keyword"},
            "type": {"type": "keyword"},
            "status": {"type": "keyword"},
            "created_at": {"type": "date"},
            "updated_at": {"type": "date"}
        }
    }
}

# 搜索实现
async def search_conversations(
    user_id: str, query: str,
    scope: str = "all",
    filters: dict = None,
    cursor: str = None,
    limit: int = 20
) -> dict:
    must = [
        {"term": {"user_id": user_id}},
        {"term": {"status": "active"}},  # 排除已删除
    ]
    
    # 搜索范围
    if scope == "titles":
        must.append({"match": {"title": {"query": query, "minimum_should_match": "75%"}}})
    else:
        must.append({
            "multi_match": {
                "query": query,
                "fields": ["title^3", "messages.content"],
                "type": "best_fields",
                "minimum_should_match": "75%"
            }
        })
    
    # 可选过滤
    if filters:
        if filters.get("subject"):
            must.append({"term": {"subject_tags": filters["subject"]}})
        if filters.get("type"):
            must.append({"term": {"type": filters["type"]}})
        if filters.get("date_from") or filters.get("date_to"):
            range_q = {"updated_at": {}}
            if filters.get("date_from"):
                range_q["updated_at"]["gte"] = filters["date_from"]
            if filters.get("date_to"):
                range_q["updated_at"]["lte"] = filters["date_to"]
            must.append({"range": range_q})
    
    body = {
        "query": {"bool": {"must": must}},
        "size": limit,
        "highlight": {
            "fields": {
                "title": {},
                "messages.content": {
                    "fragment_size": 80,
                    "number_of_fragments": 2
                }
            },
            "pre_tags": ["<em>"],
            "post_tags": ["</em>"]
        },
        "sort": [{"updated_at": "desc"}],
    }
    
    # cursor 处理（search_after）
    if cursor:
        body["search_after"] = decode_cursor(cursor)
    
    result = await es.search(index=CONVERSATION_INDEX, body=body)
    return format_search_results(result)
```

### 7.3 FastAPI 路由实现

```python
router = APIRouter(prefix="/api/v1/conversations", tags=["conversation-history"])

@router.get("", response_model=ConversationListResponse)
async def list_conversations(
    cursor: Optional[str] = None,
    limit: int = Query(20, ge=1, le=50),
    filter: Optional[str] = None,
    type: Optional[str] = None,
    subject: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    sort: str = "updated_desc",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """查询对话列表"""
    query = select(Conversation).where(
        Conversation.user_id == current_user.user_id,
        Conversation.status != "deleted",
    )
    
    # 筛选条件
    if filter == "pinned":
        query = query.where(Conversation.is_pinned == True)
    elif filter == "archived":
        query = query.where(Conversation.is_archived == True)
    elif filter == "favorite":
        query = query.where(Conversation.is_favorite == True)
    elif filter and filter.startswith("folder:"):
        folder_id = filter.split(":", 1)[1]
        query = query.where(Conversation.folder_id == folder_id)
    else:
        # 默认不显示归档
        query = query.where(Conversation.is_archived == False)
    
    if type:
        query = query.where(Conversation.type == type)
    if subject:
        query = query.where(Conversation.subject_tags.contains([subject]))
    if date_from:
        query = query.where(Conversation.updated_at >= date_from)
    if date_to:
        query = query.where(Conversation.updated_at <= date_to)
    
    # 排序
    sort_map = {
        "updated_desc": Conversation.updated_at.desc(),
        "created_desc": Conversation.created_at.desc(),
        "title_asc": Conversation.auto_title.asc(),
    }
    query = query.order_by(
        Conversation.is_pinned.desc(),  # 置顶优先
        sort_map.get(sort, Conversation.updated_at.desc()),
    )
    
    # 游标分页
    if cursor:
        cursor_data = decode_cursor(cursor)
        query = query.where(
            Conversation.updated_at < cursor_data["updated_at"]
        )
    
    query = query.limit(limit + 1)  # 多取1条判断 hasMore
    rows = await db.execute(query)
    conversations = rows.scalars().all()
    
    has_more = len(conversations) > limit
    items = conversations[:limit]
    
    # 更新 last_viewed_at
    await db.execute(
        Conversation.__table__.update()
        .where(Conversation.user_id == current_user.user_id)
        .values(last_viewed_at=datetime.utcnow())
    )
    
    next_cursor = None
    if has_more and items:
        next_cursor = encode_cursor({
            "updated_at": items[-1].updated_at.isoformat(),
            "id": items[-1].conversation_id,
        })
    
    return ConversationListResponse(
        items=[format_conversation_summary(c) for c in items],
        cursor=next_cursor,
        has_more=has_more,
    )


@router.patch("/{conversation_id}/meta")
async def update_meta(
    conversation_id: str,
    body: ConversationMetaUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新对话元数据"""
    conv = await get_user_conversation(db, current_user.user_id, conversation_id)
    if not conv:
        raise HTTPException(404, "对话不存在")
    
    updates = body.dict(exclude_unset=True)
    if not updates:
        return {"code": 0, "data": {"conversation_id": conversation_id}}
    
    updates["updated_at"] = datetime.utcnow()
    
    # 乐观锁递增
    conv.sync_version += 1
    updates["sync_version"] = conv.sync_version
    
    await db.execute(
        Conversation.__table__.update()
        .where(Conversation.conversation_id == conversation_id)
        .values(**updates)
    )
    await db.commit()
    
    # 失效相关缓存
    await cache.delete(f"conv_list:{current_user.user_id}")
    
    return {
        "code": 0,
        "data": {
            "conversationId": conversation_id,
            "updatedAt": updates["updated_at"].isoformat(),
            "syncVersion": conv.sync_version,
        }
    }
```

---

## 8. Flutter 页面结构

### 8.1 历史列表页

```dart
class ConversationHistoryPage extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(conversationHistoryProvider);
    
    return Scaffold(
      appBar: _buildAppBar(context, state),
      body: _buildBody(context, ref, state),
    );
  }

  PreferredSizeWidget _buildAppBar(BuildContext context, ConversationHistoryState state) {
    if (state.isSelectMode) {
      // 批量操作模式 AppBar
      return AppBar(
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () => ref.read(conversationHistoryProvider.notifier).exitSelectMode(),
        ),
        title: Text('已选择 ${state.selectedIds.length} 项'),
        actions: [
          IconButton(icon: const Icon(Icons.archive), onPressed: _onBatchArchive),
          IconButton(icon: const Icon(Icons.folder), onPressed: _onBatchMove),
          IconButton(icon: const Icon(Icons.delete), onPressed: _onBatchDelete),
        ],
      );
    }
    
    // 普通模式
    return AppBar(
      title: const Text('学习记录'),
      actions: [
        IconButton(
          icon: const Icon(Icons.search),
          onPressed: () => context.push('/history/search'),
        ),
        PopupMenuButton(itemBuilder: _buildFilterMenu),
      ],
    );
  }

  Widget _buildBody(BuildContext context, WidgetRef ref, ConversationHistoryState state) {
    if (state.isLoading && state.conversations.isEmpty) {
      return const _SkeletonList();
    }
    
    if (state.conversations.isEmpty) {
      return const _EmptyState();
    }
    
    return RefreshIndicator(
      onRefresh: () => ref.read(conversationHistoryProvider.notifier).refresh(),
      child: PagedListWidget(
        items: state.conversations,
        hasMore: state.hasMore,
        isLoadingMore: state.isLoadingMore,
        onLoadMore: () => ref.read(conversationHistoryProvider.notifier).loadMore(),
        itemBuilder: (context, item, index) => _ConversationTile(
          conversation: item as ConversationSummary,
          isSelectMode: state.isSelectMode,
          isSelected: state.selectedIds.contains(item.conversationId),
          onSelect: () => ref.read(conversationHistoryProvider.notifier).toggleSelect(item.conversationId),
          onTap: () => _navigateToConversation(context, item.conversationId),
          onLongPress: () => ref.read(conversationHistoryProvider.notifier).enterSelectMode(),
        ),
        groupBy: _groupByDate,  // 按日期分组：今天/昨天/本周/更早
      ),
    );
  }
}
```

### 8.2 对话卡片组件

```dart
class _ConversationTile extends ConsumerWidget {
  final ConversationSummary conversation;
  final bool isSelectMode;
  final bool isSelected;
  final VoidCallback onSelect;
  final VoidCallback onTap;
  final VoidCallback onLongPress;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final gradeStyle = ref.watch(gradeUIStyleProvider);  // 分龄样式
    
    return InkWell(
      onTap: isSelectMode ? onSelect : onTap,
      onLongPress: onLongPress,
      child: Container(
        padding: EdgeInsets.symmetric(
          horizontal: gradeStyle.listPaddingH,
          vertical: gradeStyle.listItemGapV,
        ),
        decoration: isSelected
            ? BoxDecoration(color: theme.colorScheme.primaryContainer.withOpacity(0.2))
            : null,
        child: Row(
          children: [
            // 选择模式下显示勾选框
            if (isSelectMode)
              Padding(
                padding: const EdgeInsets.only(right: 12),
                child: Checkbox(
                  value: isSelected,
                  onChanged: (_) => onSelect(),
                ),
              ),
            // 对话类型图标
            _ConversationTypeIcon(type: conversation.type),
            const SizedBox(width: 12),
            // 内容区域
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      if (conversation.isPinned)
                        Padding(
                          padding: const EdgeInsets.only(right: 4),
                          child: Icon(Icons.push_pin, size: 14, color: theme.colorScheme.primary),
                        ),
                      Expanded(
                        child: Text(
                          conversation.displayTitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      // 学科标签
                      if (conversation.subjectTags.isNotEmpty)
                        _SubjectTagChip(tag: conversation.subjectTags.first),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    conversation.lastAiMessagePreview ?? conversation.firstMessagePreview ?? '',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      _formatRelativeTime(conversation.updatedAt),
                      const Spacer(),
                      Text(
                        '${conversation.messageCount}条',
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: theme.colorScheme.outline,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            // 更多操作
            if (!isSelectMode)
              IconButton(
                icon: const Icon(Icons.more_vert, size: 20),
                onPressed: () => _showActionSheet(context, ref),
              ),
          ],
        ),
      ),
    );
  }

  void _showActionSheet(BuildContext context, WidgetRef ref) {
    showCupertinoModalPopup(
      context: context,
      builder: (_) => CupertinoActionSheet(
        actions: [
          CupertinoActionSheetAction(
            onPressed: () { /* 置顶/取消置顶 */ },
            child: Text(conversation.isPinned ? '取消置顶' : '置顶'),
          ),
          CupertinoActionSheetAction(
            onPressed: () { /* 重命名 */ },
            child: const Text('重命名'),
          ),
          CupertinoActionSheetAction(
            onPressed: () { /* 移动到文件夹 */ },
            child: const Text('移动到文件夹'),
          ),
          CupertinoActionSheetAction(
            onPressed: () { /* 收藏/取消收藏 */ },
            child: Text(conversation.isFavorite ? '取消收藏' : '收藏'),
          ),
          CupertinoActionSheetAction(
            onPressed: () { /* 归档 */ },
            child: const Text('归档'),
          ),
          CupertinoActionSheetAction(
            isDestructiveAction: true,
            onPressed: () { /* 删除 */ },
            child: const Text('删除'),
          ),
          CupertinoActionSheetAction(
            onPressed: () { /* 导出 */ },
            child: const Text('导出'),
          ),
        ],
        cancelButton: CupertinoActionSheetAction(
          isDefaultAction: true,
          onPressed: () => Navigator.pop(context),
          child: const Text('取消'),
        ),
      ),
    );
  }
}
```

### 8.3 搜索页

```dart
class ConversationSearchPage extends ConsumerStatefulWidget {
  @override
  ConsumerState<ConversationSearchPage> createState() => _SearchPageState();
}

class _SearchPageState extends ConsumerState<ConversationSearchPage> {
  final _controller = TextEditingController();
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onQueryChanged);
    // 自动弹出键盘
    WidgetsBinding.instance.addPostFrameCallback((_) {
      FocusScope.of(context).requestFocus(_focusNode);
    });
  }

  void _onQueryChanged() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      final query = _controller.text.trim();
      if (query.length >= 2) {
        ref.read(conversationSearchProvider.notifier).search(query);
      } else if (query.isEmpty) {
        ref.read(conversationSearchProvider.notifier).clear();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(conversationSearchProvider);
    
    return Scaffold(
      appBar: AppBar(
        title: TextField(
          controller: _controller,
          focusNode: _focusNode,
          decoration: InputDecoration(
            hintText: '搜索对话内容...',
            border: InputBorder.none,
          ),
        ),
        actions: [
          if (_controller.text.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.clear),
              onPressed: () {
                _controller.clear();
                ref.read(conversationSearchProvider.notifier).clear();
              },
            ),
        ],
      ),
      body: _buildResults(context, state),
    );
  }

  Widget _buildResults(BuildContext context, ConversationSearchState state) {
    if (state.isSearching && state.results.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    
    if (state.query == null || state.query!.isEmpty) {
      return _buildRecentSearches();  // 最近搜索
    }
    
    if (state.results.isEmpty) {
      return Center(child: Text('未找到相关对话'));
    }
    
    return ListView.builder(
      itemCount: state.results.length,
      itemBuilder: (context, index) {
        final conv = state.results[index];
        final highlight = state.highlights
            .where((h) => h.conversationId == conv.conversationId)
            .firstOrNull;
        
        return _SearchResultTile(
          conversation: conv,
          highlight: highlight,
          query: state.query!,
          onTap: () => _navigateToConversation(context, conv.conversationId),
        );
      },
    );
  }
}
```

---

## 9. 数据同步策略

### 9.1 同步触发时机

| 时机 | 动作 |
|------|------|
| 进入历史列表页 | 拉取远程最新列表，与本地合并 |
| 完成一次对话 | 本地写入 + 推送更新到远程 |
| 修改元数据（置顶/归档等） | 本地立即更新 + 异步推送远程 |
| 应用从后台恢复 | 触发增量同步（syncVersion 对比） |
| 网络状态恢复 | 处理离线操作队列 |

### 9.2 合并冲突策略

```
本地版本 vs 远程版本：

  local.syncVersion > remote.syncVersion
    → 本地优先（用户最新操作在本地）

  local.syncVersion < remote.syncVersion
    → 远程优先（可能在其他设备操作过）

  local.syncVersion == remote.syncVersion
    → 无冲突

特殊字段策略：
  userTitle: 非空值优先（任何一端设置了自定义标题就保留）
  isPinned/isArchived/isFavorite: 取 true 值（合并而非覆盖）
  folderId: remote 优先（文件夹结构以服务端为准）
```

### 9.3 同步 API

```
GET /api/v1/conversations/sync?since_version={version}&limit=100
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "changes": [
      {
        "conversationId": "conv_abc123",
        "syncVersion": 10,
        "action": "update",
        "fields": {
          "is_pinned": true,
          "user_title": "二次函数复习"
        }
      },
      {
        "conversationId": "conv_old789",
        "syncVersion": 5,
        "action": "delete"
      }
    ],
    "latestVersion": 10,
    "hasMore": false
  }
}
```

---

## 10. 自动标题与标签生成

### 10.1 标题生成规则

| 规则 | 说明 |
|------|------|
| 时机 | 对话结束时（24h 无消息 / 用户手动结束）|
| 模型 | 使用快速低成本模型 |
| 输入 | 前3轮对话（去公式、去格式，保留纯文本） |
| 输出 | ≤15字的简洁标题 |
| 格式 | 学科 + 核心知识点 |
| 后备 | 若生成失败，取首条用户消息前15字 |

### 10.2 标签自动提取

```python
SUBJECT_KEYWORDS = {
    "数学": ["函数", "方程", "几何", "概率", "三角", "微积分", "向量", "数列", ...],
    "语文": ["古诗文", "阅读理解", "作文", "文言文", "诗词", "修辞", "成语", ...],
    "英语": ["语法", "时态", "从句", "单词", "阅读", "听力", "写作", ...],
    "物理": ["力学", "电学", "光学", "热学", "能量", "牛顿", "电路", ...],
    "化学": ["方程式", "元素", "有机", "酸碱", "氧化", "反应", ...],
    "生物": ["细胞", "遗传", "生态", "光合", "DNA", "进化", ...],
    "历史": ["朝代", "革命", "战争", "条约", "制度", ...],
    "地理": ["气候", "地形", "人口", "河流", "板块", ...],
    "政治": ["哲学", "经济", "法律", "制度", "文化", ...],
}

async def extract_subject_tags(text: str) -> list[str]:
    """基于关键词匹配提取学科标签"""
    tags = []
    for subject, keywords in SUBJECT_KEYWORDS.items():
        if any(kw in text for kw in keywords):
            tags.append(subject)
    return tags[:3]  # 最多3个学科标签
```

---

## 11. 存储与性能

### 11.1 本地存储预算

| 数据 | 单条大小 | 1000条估算 |
|------|----------|------------|
| ConversationSummary | ~500B | 500KB |
| MessageIndexEntry | ~200B (avg) | 10MB (50K条消息) |
| 文件夹 | ~100B | 5KB |
| **合计** | - | **~11MB** |

### 11.2 清理策略

| 策略 | 规则 |
|------|------|
| 服务端软删除 → 硬删除 | 30天后自动清理 |
| 本地归档超过1年 | 提示用户清理，仅保留摘要 |
| 搜索索引 | 跟随对话生命周期，删除时同步清理 |
| 离线操作队列 | 操作完成/失败后24小时清理 |

### 11.3 性能指标

| 指标 | 目标 |
|------|------|
| 历史列表首屏加载 | <500ms（本地）/ <2s（远程） |
| 搜索响应（本地） | <200ms |
| 搜索响应（远程） | <1s |
| 单条元数据更新 | <300ms |
| 批量操作（50条） | <2s |
| 同步增量合并 | <1s |

---

## 12. 错误处理

### 12.1 错误场景与策略

| 场景 | 错误码 | 处理策略 |
|------|--------|----------|
| 网络不可用 | NETWORK_ERROR | 显示本地缓存数据 + "离线模式"标记 |
| 对话不存在 | CONV_NOT_FOUND | 本地标记删除，从列表移除 |
| 同步冲突 | SYNC_CONFLICT | 按9.2策略自动合并，无需用户介入 |
| 搜索超时 | SEARCH_TIMEOUT | 显示本地搜索结果 + "结果可能不完整"提示 |
| 导出失败 | EXPORT_FAILED | 自动重试1次，仍失败则提示稍后再试 |
| 删除撤销过期 | UNDO_EXPIRED | 提示"已超过24小时，无法撤销" |
| 存储空间不足 | STORAGE_FULL | 提示清理归档对话或旧缓存 |

### 12.2 客户端错误处理代码示例

```dart
Future<void> _syncFromRemote() async {
  try {
    final result = await _remoteService.fetchList(
      cursor: null,
      limit: 50,
    );
    
    await _localService.mergeRemoteData(result.items);
    
    state = state.copyWith(
      conversations: await _localService.getAllSorted(),
      isLoading: false,
    );
  } on DioException catch (e) {
    // 网络错误：不影响本地展示
    logger.w('远程同步失败，使用本地数据: ${e.message}');
    state = state.copyWith(
      isLoading: false,
      conversations: await _localService.getAllSorted(),
      error: null,  // 不展示错误，静默降级
    );
  } on ServerException catch (e) {
    if (e.code == 'TOKEN_EXPIRED') {
      // Token过期：不在此处理，由全局拦截器处理
      rethrow;
    }
    logger.e('服务端错误: ${e.message}');
    state = state.copyWith(
      isLoading: false,
      error: '加载失败，请稍后再试',
    );
  }
}
```

---

## 13. 分龄适配

| 学段 | 列表样式 | 交互简化 |
|------|----------|----------|
| 幼儿 | 卡片更大、图标更多、颜色丰富 | 隐藏批量操作、文件夹等高级功能 |
| 小学 | 标准卡片、学科标签彩色 | 简化操作菜单（置顶、删除、导出） |
| 初中 | 紧凑列表、信息密度较高 | 全功能操作菜单 |
| 高中 | 紧凑列表、支持快捷键 | 全功能 + 高级搜索语法 |

---

## 14. 跨模块集成

| 集成点 | 方式 |
|--------|------|
| AI对话页面 → 历史列表 | 对话结束时自动写入 Hive + 触发标题生成 |
| 拍题答疑 → 历史列表 | photoQuiz 类型对话，自动关联题目ID |
| 收藏系统 | 对话可一键收藏到收藏夹（复用收藏系统基础设施） |
| 笔记系统 | 对话中任何一条消息可"转为笔记" |
| 知识点引擎 | 自动标注的知识点ID写入对话元数据 |
| 学情分析 | 历史对话数量/频率作为学习活跃度指标 |
| 会员权益 | 免费用户限制历史保留30天；会员无限制 |

---

## 15. 监控指标

| 指标 | 类型 | 说明 |
|------|------|------|
| history_list_load_ms | Histogram | 列表加载耗时 |
| history_search_local_ms | Histogram | 本地搜索耗时 |
| history_search_remote_ms | Histogram | 远程搜索耗时 |
| history_sync_duration_ms | Histogram | 同步合并耗时 |
| history_batch_operations_total | Counter | 批量操作次数 |
| history_export_requests_total | Counter | 导出请求数 |
| history_storage_used_bytes | Gauge | 本地存储使用量 |
| history_conversation_count | Gauge | 用户对话总数 |
| history_auto_title_generated_total | Counter | 自动标题生成次数 |
| history_auto_title_failed_total | Counter | 标题生成失败次数 |