# 客户端-AI听写默写页面架构与交互设计 - 详细设计

> **模块定位**：本文档定义 PrimeTop Flutter 客户端**听写默写**功能的完整页面架构与交互设计，覆盖任务列表、听写准备、听写作答（音频播放）、屏幕手写作答、拍照提交、批改等待、批改结果、字形掌握度报告与家长端听写报告九个页面单元。服务端权威为《服务端-学生听写默写智能评估与语文基础知识自动批改引擎-详细设计》（`/api/v1/dictation/*`、`DICT_*` 错误码、批改/掌握度/归因全链服务端裁决），本文档仅定义客户端呈现层、交互层与端侧守卫，**不重复服务端业务规则，冲突时以服务端文档为准**。
> **关联文档**：`docs2/服务端-学生听写默写智能评估与语文基础知识自动批改引擎-详细设计.md`（服务端契约权威，本文 §3/§8 与其 1:1 对齐）、`docs2/客户端-音频播放器与录制引擎及听力练习交互组件-详细设计.md`（播放引擎委托）、`docs2/汉字笔画顺序检测与评估系统-详细设计.md`（手写画布委托）、`docs2/客户端-拍照图像采集与预处理引擎-详细设计.md`（拍照采集委托）、`docs2/客户端-文件上传服务与断点续传机制-详细设计.md`（图片上传委托）、`docs2/客户端-统一对话框与模态弹出层调度管理系统-详细设计.md`（弹窗委托）、`docs2/客户端-页面状态模式与骨架屏加载空态错误态设计规范-详细设计.md`（状态规范）、`docs2/防沉迷与未成年人保护机制-详细设计.md`（时长/休息权威）、`docs2/客户端-全局防误触与儿童安全交互保护机制-详细设计.md`（低龄防误触）。

## 1. 概述

### 1.1 模块定位

听写默写是中小学语文（及英语词汇）最高频的日常练习形式——几乎每个小学生每天都有听写或默写任务。本模块在客户端的核心使命：

1. **还原课堂听写体验**：音频朗读（可配速/重复/间隔）→ 学生书写 → 拍照/手写提交 → 秒级批改 → 逐字错误归因，全流程不依赖家长陪读。
2. **双作答通道**：纸质拍照（学校听写作业场景，拍整页交给服务端区域检测）与屏幕手写（居家即时练习，逐条大字格）同权，作答模式由任务配置（`config.answerMode`）约束。
3. **默写模式**：看拼音提示凭记忆书写（recitation），与听写（dictation）共用批改链路，仅取消音频播放环节。
4. **错因可见**：批改结果按同音字/形近字/偏旁/漏画/多画/漏写/错字七类归因展示（低龄图形化、高龄术语化），并联动复习计划（服务端事件扇出，客户端只做入口展示）。

### 1.2 设计原则

| 原则 | 说明 |
| --- | --- |
| 零判分 | 对错/分数/归因**永远**由服务端下发，客户端禁本地比对、禁答案明文缓存（G5）；默写模式的拼音提示由服务端 `showPinyin` 控制，客户端禁自行生成拼音（多音字风险，G6） |
| 还原课堂 | 播放节奏（朗读→短停→间隔倒计时）遵循服务端 `config.readMode/speed/repeatCount/intervalSeconds`，客户端仅执行不裁决；`repeatCount` 与 `intervalSeconds` 在客户端播放器实现（服务端 §3.2.2 约定） |
| 权威委托 | 播放器委托 UnifiedAudioEngine、手写画布委托 StrokeCanvasWidget、拍照委托拍照预处理引擎、上传委托断点续传、弹窗委托统一对话框、休息/时长委托防沉迷体系 |
| 弱网可完成 | 音频可预下载（准备页完成），作答全程离线可用，提交走暂存队列 ≤24h 补报（G4） |
| 防挫败 | 低置信度与人工复核状态不暴露技术词（R8）；错误归因用成长型话术（"晨曦的曦是日字旁，和傍晚的夕不一样"），禁"你很差"类评价（合规 C4） |
| 隐私最小化 | 答题照片/手写轨迹仅在提交链路传输，禁写相册、禁分享（G12）；音频缓存退出登录即清（G7） |

### 1.3 职责边界（客户端不做）

- 不做判分、不做字形比对、不做错误归因计算（服务端 §4.1.2/§4.1.3 权威，R1）。
- 不做拍照图片的区域检测与题目切分（服务端 OCR 管线权威，R11）。
- 不生成朗读音频（TTS 权威归服务端；本地 TTS 仅为降级路径，R10）。
- 不维护掌握度、不计算遗忘曲线（服务端 §4.3 BKT 权威，客户端只读报告）。
- 不做时长权威统计与防沉迷裁决（委托防沉迷机制，R6）。
- 不做教师/家长侧的任务创建与管理端功能（家长端仅"查看报告+创建自定义任务入口"）。

## 2. 信息架构与页面地图

### 2.1 路由表

路由注册进《客户端路由与深链接系统》，统一前缀 `/dictation`：

| 路由 | 页面 | 入口 | 鉴权/守卫 |
| --- | --- | --- | --- |
| `/dictation/tasks` | 听写任务列表 | 首页工作台"听写默写"卡片、语文工具箱 | 学生登录态 |
| `/dictation/task/:taskId/prepare` | 听写准备页 | 任务列表卡片点击 | 登录态 + 任务状态守卫 G1 |
| `/dictation/attempt/:attemptId/play` | 听写作答页（播放） | 准备页"开始听写" | 登录态 + attempt 归属校验 |
| `/dictation/attempt/:attemptId/write` | 屏幕手写作答页 | 作答模式为 digital_handwrite/digital_type 时由 play 页内切换，或独立入口 | 登录态 |
| `/dictation/attempt/:attemptId/capture` | 拍照提交页 | 作答模式为 paper_photo 时 play 页"拍照提交" | 登录态 + 相机权限 |
| `/dictation/attempt/:attemptId/grading` | 批改等待页 | 提交成功后自动跳转 | 登录态 |
| `/dictation/attempt/:attemptId/result` | 批改结果页 | 等待页轮询/SSE 完成、推送点击、任务列表"查看结果" | 登录态 |
| `/dictation/mastery` | 字形掌握度报告页 | 结果页"掌握度"入口、任务列表顶部 | 登录态 |
| `/dictation/review` | 今日复习条目页 | 任务列表"今日复习"横幅（GET /review/today） | 登录态 |
| `/parent/dictation/report` | 家长端听写报告 | 家长中心"听写报告"Tab、周报内嵌 | **家长角色** + 统一家长门 |

深链接/推送进入 `/dictation/attempt/:attemptId/result` 时须先校验 attempt 归属（本人或绑定家长），命中 `DICT_ATTEMPT_NOT_FOUND`/`DICT_PERMISSION_DENIED` 渲染错误态页（§8.1），不可降级进入。

### 2.2 页面地图

```
首页工作台 ──[听写默写卡片]──▶ /dictation/tasks 任务列表
                                    │(今日复习横幅 /dictation/review)
                                    │(顶部掌握度入口 /dictation/mastery)
                                    ▼
                        ┌── /dictation/task/:taskId/prepare 准备页
                        │     (音频预加载/试听/作答方式确认)
                        │           │"开始听写/默写"
                        │           ▼
                        │   POST attempts ──▶ /dictation/attempt/:attemptId/play 作答页
                        │     (dictation: 逐条朗读+倒计时; recitation: 拼音提示逐条)
                        │           │作答模式切换(受任务配置约束,G10)
                        │     ┌─────┴─────┐
                        │     ▼           ▼
                        │  /write      /capture
                        │  屏幕手写     拍照提交(整页/格位指引)
                        │  逐条大字格    重拍/补拍
                        │     └─────┬─────┘
                        │           │submit(幂等 G3)
                        │           ▼
                        │   /dictation/attempt/:attemptId/grading 批改等待页
                        │     (轮询退避 + SSE; 可退出由推送召回)
                        │           │status=graded / need_review(话术 R8)
                        │           ▼
                        │   /dictation/attempt/:attemptId/result 批改结果页
                        │     (总览/逐条对错/错误归因/错字卡)
                        │           │(已收录复习 toast 仅服务端事件回执后展示)
                        │           ▼
                        └── /dictation/mastery 掌握度报告 ◀── 家长端 /parent/dictation/report
```

### 2.3 页面状态规范

全部页面复用《客户端-页面状态模式与骨架屏加载空态错误态设计规范》：

- 首屏加载：任务列表骨架（卡片×3）；结果页骨架（环形分占位+条目行×5）。
- 空态：任务列表空态"今天没有听写任务，去复习一下易错字吧"（附 `/dictation/review` 入口）；拍照页空态不出现（相机不可用时直接错误态）。
- 错误态：按 §8.1 错误码映射渲染，可重试按钮统一走 `ErrorMessageFactory` 话术（契约 R3 归口全局异常）。

## 3. 数据模型与 API 契约

### 3.1 Dart 数据模型（与服务端 §3.2 响应 1:1）

```dart
/// 听写任务 —— 对齐服务端 GET /api/v1/dictation/tasks 元素与 /tasks/{taskId}
class DictationTask {
  final String taskId;
  final String title;
  final DictationType type;            // dictation / recitation / mixed
  final TaskSourceType sourceType;     // textbook_chapter / word_bank / custom / ai_generated / error_driven
  final String subject;                // chinese / english
  final int gradeLevel;
  final String? textbookId;
  final List<String>? chapterIds;
  final List<DictationItem> items;
  final DictationConfig config;
  final String publisherType;          // system / teacher / parent / student
  final TaskStatus status;             // draft / published / active / expired / cancelled / completed
  final DateTime? scheduledAt;
  final DateTime? deadline;
  final int myAttemptCount;            // 本人作答次数(列表联表,只读)
  final String? lastAttemptId;
  final int? lastScore;
}

class DictationItem {
  final String itemId;
  final int ordinal;
  final String content;                // 听写内容(字/词/短语)
  final String pinyin;                 // 服务端下发,客户端禁自生成(G6)
  final String itemType;               // char / word / phrase
  final int difficulty;
  final String? selectionReason;       // ai_generated 任务的选题理由(家长端可见)
}

class DictationConfig {
  final ReadMode readMode;             // char_by_char / word_by_word / phrase_by_phrase / sentence_then_slow
  final double speed;                  // 0.5~2.0
  final int repeatCount;               // 每条朗读次数(客户端播放器实现)
  final int intervalSeconds;           // 条目间停顿(客户端 clamp [3,15] 后执行)
  final AnswerMode answerMode;         // paper_photo / digital_handwrite / digital_type
  final int? timeLimit;                // 总时长限制(秒)
  final bool showPinyin;               // 默写模式拼音提示(服务端权威)
  final bool showHint;                 // 首字提示
  final GradingStrictness strictness;  // strict / standard / lenient
}

enum DictationType { dictation, recitation, mixed }
enum TaskSourceType { textbookChapter, wordBank, custom, aiGenerated, errorDriven }
enum TaskStatus { draft, published, active, expired, cancelled, completed }
enum ReadMode { charByChar, wordByWord, phraseByPhrase, sentenceThenSlow }
enum AnswerMode { paperPhoto, digitalHandwrite, digitalType }
enum GradingStrictness { strict, standard, lenient }

/// 作答会话 —— 对齐服务端 POST /tasks/{taskId}/attempts 响应
class DictationAttempt {
  final String attemptId;
  final String taskId;
  final AttemptStatus status;          // in_progress / submitted / grading / graded / need_review / completed
  final AnswerMode answerMode;
  final DateTime startedAt;
  final DateTime? submittedAt;
  final int? estimatedWaitSeconds;     // submit 响应携带
  final String? pollUrl;               // submit 响应携带,轮询基地址
}

enum AttemptStatus { inProgress, submitted, grading, graded, needReview, completed }

/// 音频播放清单 —— 对齐服务端 GET /tasks/{taskId}/audio 响应
class AudioPlaylist {
  final String taskId;
  final DictationConfig config;
  final List<AudioItem> playlist;
  final int totalDuration;             // 毫秒
}

class AudioItem {
  final int ordinal;
  final String itemId;
  final String audioUrl;
  final int duration;                  // 毫秒
  final String content;
  final String pinyin;
}

/// 批改结果 —— 对齐服务端 GET /attempts/{attemptId}/result 响应
class GradingResult {
  final String attemptId;
  final AttemptStatus status;
  final int overallScore;              // 0~100
  final int correctCount;
  final int incorrectCount;
  final int partialCount;
  final int totalCount;
  final String gradedBy;               // ocr_auto / ai_vision / manual
  final DateTime gradedAt;
  final double confidence;             // 仅供客户端展示"已仔细核对"标记,不向学生展示数值(G5/G9)
  final List<ItemResult> itemResults;
  final ErrorSummary errorSummary;
}

enum CorrectnessLevel { fullyCorrect, partial, incorrect }

class ItemResult {
  final String itemId;
  final int ordinal;
  final String expectedContent;
  final String recognizedContent;
  final bool isCorrect;
  final CorrectnessLevel correctnessLevel;
  final List<CharError> errors;
  final String? markedImageUrl;        // 批改标注图(拍照模式)
}

enum ErrorType { homophone, visuallySimilar, radicalError, missingStroke, extraStroke, omission, wrongCharacter }

class CharError {
  final int position;                  // 错字在条目内的位置(1-based)
  final String expected;
  final String actual;
  final ErrorType errorType;
  final Severity severity;             // major / moderate / minor
  final String suggestion;             // 成长型讲解话术(服务端生成)
}

class ErrorSummary {
  final int totalErrors;
  final Map<String, int> byType;       // errorType -> count
  final Map<String, int> bySeverity;
  final List<String> frequentErrorChars;
}

/// 掌握度报告 —— 对齐服务端 GET /mastery/report 响应
class MasteryReport {
  final String userId;
  final String subject;
  final MasterySummary summary;        // total/mastered/proficient/familiar/learning/overallMasteryRate
  final List<WeakCharacter> weakCharacters;
  final RecentProgress recentProgress; // last7Days
}

class WeakCharacter {
  final String character;
  final String pinyin;
  final int masteryLevel;              // 0 learning / 1 familiar / 2 proficient / 3 mastered
  final double correctRate;
  final int totalAttempts;
  final String commonErrorType;
  final DateTime lastAttemptAt;
  final DateTime? nextReviewAt;
}

/// 今日复习 —— 对齐服务端 GET /review/today
class TodayReview {
  final String reviewDate;
  final int itemCount;
  final List<ReviewEntry> entries;     // character/pinyin/masteryLevel/来源说明
  final bool overdue;                  // true 时附 DICT_REVIEW_OVERDUE 横幅
}
```

### 3.2 Repository 层

```dart
class DictationRepository {
  final DictationApi _api;             // Dio, baseUrl=/api/v1/dictation
  final DictationLocalStore _local;    // Hive: 播放清单缓存/提交暂存队列/attempt 断点

  /// 任务列表(分页 page/pageSize,服务端统一分页规范)
  Future<Paged<DictationTask>> fetchTasks({int page = 1, int pageSize = 20});

  /// 任务详情(带条目与配置)
  Future<DictationTask> fetchTaskDetail(String taskId);

  /// 音频清单: 网络优先,202(DICT_AUDIO_NOT_READY)触发服务端生成并本地轮询;
  /// 成功结果按 taskId+configHash 缓存 24h(音频文件本身走 AudioCacheManager)
  Future<AudioPlaylist> fetchAudioPlaylist(String taskId, {bool forceRefresh = false});

  /// 开始作答: 幂等由 attemptId 承担——重复点击/重复进入时服务端 409
  /// DICT_ATTEMPT_EXISTS,客户端捕获后拉取该任务已有 in_progress attempt 继续(G3)
  Future<DictationAttempt> startAttempt(String taskId);

  /// 提交作答: 幂等键 = attemptId + 端侧 submitting 锁(§3.3)
  Future<DictationAttempt> submit(String attemptId, SubmitAttemptPayload payload);

  /// 批改结果: 轮询基地址取 submit 响应 pollUrl;status=grading 时按退避轮询
  Future<GradingResult> fetchResult(String attemptId);

  /// 掌握度报告 / 今日复习
  Future<MasteryReport> fetchMasteryReport({String subject = 'chinese', String? chapterId});
  Future<TodayReview> fetchTodayReview();

  /// 提交暂存队列(弱网,G4): Hive box 'dictation_submit_queue'
  Future<void> enqueueSubmit(DictationAttempt attempt, SubmitAttemptPayload payload);
  Future<List<QueuedSubmit>> pendingSubmits();
  Future<void> removeQueuedSubmit(String attemptId);
}
```

### 3.3 幂等键生成策略

| 操作 | 幂等键 | 服务端语义 | 端侧补强 |
| --- | --- | --- | --- |
| startAttempt | taskId+userId（服务端唯一约束） | `DICT_ATTEMPT_EXISTS`(409) 表示已有进行中作答 | 捕获 409 → 查列表中 in_progress attempt → 续答，禁重复建会话 |
| submit | attemptId（天然幂等键） | `DICT_ATTEMPT_ALREADY_SUBMITTED`(409) | submitting 锁 800ms 防抖 + 重复点击直接 return；网络失败入暂存队列，重试携带同 attemptId |
| 图片上传 | uploadId（文件上传服务断点续传键） | 同 uploadId 重复上传返回同一 URL | 拍照页重进恢复未完成任务的上传断点 |
| 结果轮询 | attemptId + statusVersion | GET 天然幂等 | 退避轮询间隔 [1s,2s,4s,8s] 上限 8s，最长 90s 后转"耐心等待"静态页 + 推送召回 |
| AI 生成任务 | Idempotency-Key（请求头，30min 窗口） | 同 key 返回同 taskId | "AI 推荐听写"按钮置灰至返回 |

## 4. 页面详细设计

### 4.1 任务列表页（/dictation/tasks）

- **结构**：顶部三段：①今日复习横幅（`GET /review/today`，`itemCount>0` 时出现，`overdue=true` 时橙色"有逾期待复习"样式，点击进 `/dictation/review`）；②掌握度速览卡（`overallMasteryRate` 环形图 + "查看掌握度"→`/dictation/mastery`）；③任务卡列表（按 `scheduledAt/deadline` 排序）。
- **任务卡要素**：标题、类型标签（听写/默写/混合）、来源标签（教材单元/AI 推荐/老师布置/家长布置/自定义）、条目数与预估时长、截止时间倒计时（`deadline-now<24h` 高亮）、我的作答状态（未开始/进行中/已批改 X 分/待复核）、`status=expired/cancelled` 置灰不可进。
- **AI 推荐入口**：列表底部"让 AI 出一份听写"→`POST /tasks/ai-generate`（§3.3 幂等）→ 成功后刷新列表并置顶新任务卡。
- **守卫**：点击进行中任务卡 → 若 `lastAttemptId` 存在且 attempt in_progress → 直进对应作答页（续答），否则走准备页。

### 4.2 听写准备页（/dictation/task/:taskId/prepare）

- **结构**：任务信息（标题/条目数/来源）→ 作答配置摘要（语速×倍速、每条读 N 遍、间隔 N 秒、批改严格度）→ 作答方式卡（按 `config.answerMode` 仅展示允许项，G10/G11）→ 音频预加载进度条 → 底部主按钮"开始听写"（recitation 类型显示"开始默写"）。
- **音频预加载**：进入页面即 `GET /audio`；202（`DICT_AUDIO_NOT_READY`）→ 展示"音频生成中（约 10 秒）"每 3s 重试，上限 60s，超时进错误态可重试。成功后将全部 `audioUrl` 交给 `AudioCacheManager` 预下载（进度条同步）；预下载完成前主按钮可点击但进入播放页后逐条边下边播（委托播放器降级）。
- **试听**：前 3 条可点试听（仅播放单条一次，不影响清单）。
- **离线提示**：预下载完成展示"已就绪，可离线完成"绿色标记。

### 4.3 听写作答页（/dictation/attempt/:attemptId/play）

- **两种形态**：
  - dictation/mixed：音频播放主流程。中央大字区显示当前条目序号（如 "3/20"）与播放状态动画（声波），**不显示当前词条内容**（防跟抄）；底部控制条：重听本条（回到本条开头重播 `repeatCount` 遍）、上一条/下一条手动跳转（默认自动流程，手动跳转后切为手动模式）、暂停/继续、进度点阵（20 条竖点阵，已播绿色）。
  - recitation（默写）：无音频。逐条展示拼音（`showPinyin=true` 时）与占位格，学生凭记忆作答；作答方式同为手写/拍照。
- **播放流程**（服务端 §5.2 伪代码的客户端落地，委托 `UnifiedAudioEngine`）：

```
for item in playlist:
  显示第 ordinal 条; 播 repeatCount 遍(item.audioUrl, 每遍间 500ms 短停)
  → 间隔倒计时 intervalSeconds(沙漏/数字,可"跳过等待"提前下一条)
  → 下一条
播完 → 自动弹"听写结束,去提交"(委托统一对话框,可"再听一遍"重置流程)
```

- **中断处理（G2）**：来电/切后台/锁屏 → 播放器自动暂停并记录断点（条目+遍数）；回前台**不自动恢复**，展示"继续听写"按钮手动恢复（防沉迷对齐 + 防外放惊吓）。
- **作答方式切换**：play 页右下浮动按钮"去书写"→ digital_handwrite 进 write 页；paper_photo 进 capture 页。切换不中断 attempt（同一 attemptId，G10）。
- **作答中草稿**：digital 模式每条手写轨迹本地暂存（Hive，`attemptId_itemId` 键），反复进出不丢；paper 模式无草稿（纸质即草稿）。

### 4.4 屏幕手写作答页（/dictation/attempt/:attemptId/write）

- **布局**：顶部条目导航（ordinal 圆点条，点击跳转）；中央大字格区（当前条目，1~4 字自适应格数，米字格背景，K/P1 档加大格与笔顺引导点）；底部：上一条/下一条、撤销一笔、清空本条、提交按钮（常驻右下角，红点提示未完成条目数，可提交，服务端按 omission 判漏写）。
- **书写组件**：委托 `StrokeCanvasWidget`（《汉字笔画顺序检测与评估系统》§4.2，`onStrokeDetected`/`onWritingComplete` 回调）。**差异说明**：听写场景仅采集最终字形轨迹用于 OCR 识别，**不**做实时笔画顺序评判（笔画顺序权威归笔画系统，听写评结果，R3）；低龄档保留书写引导点（笔顺暗示）但不打对错标记，避免与批改结果冲突（防挫败）。
- **轨迹序列化**：`HandwritingData` → 服务端 `answerStrokes` DTO 1:1（points 归一化到 canvasWidth/Height，`t` 为相对毫秒，`pressure` 缺省补 1.0）。
- **键盘输入模式（digital_type，辅助模式）**：J/S 学段可选，拼音输入出字；入口标注"辅助练习"，不计入手写能力评估维度（报告侧展示口径归服务端）。
- **防误触（G 防误触委托）**：K/P1 档开启全局防误触（边缘手势屏蔽、双指误清守卫：清空需二次确认）。

### 4.5 拍照提交页（/dictation/attempt/:attemptId/capture）

- **采集**：委托《客户端-拍照图像采集与预处理引擎》；支持"整页拍摄"（推荐，服务端区域检测映射 itemId，R11）与"逐条补拍"（某一格没拍清，单条重拍覆盖）。
- **拍摄引导**：取景框叠加格位线模板（按条目数动态生成 5×4/4×5 格线框）+ 示例图；拍摄后进入预览：格位缩略图条（点击格位可重拍该格），满意后"上传提交"。
- **上传**：委托断点续传服务，`uploadId = attemptId`（幂等，§3.3）；全部 URL 就绪后组装 `SubmitAttemptDTO(answerMode=paper_photo, answerImages=[{itemId?, imageUrl, boundingBox?}])`。客户端**不上送 boundingBox**（区域检测归服务端），仅在逐条补拍模式携带 itemId。
- **弱网**：上传中断恢复续传；全部失败入暂存队列（G4）。

### 4.6 批改等待页（/dictation/attempt/:attemptId/grading）

- **状态**：动画（低年级：批改小精灵逐条盖章；高龄：进度环 + "已完成 x/y"）。轮询 `pollUrl` 退避 [1,2,4,8]s；同时注册推送召回（服务端批改完成事件 → 推送通知，点击直达结果页）。
- **语义分支**：
  - `status=graded` → 自动跳结果页。
  - `status=need_review` → 静态页"老师正在帮你仔细核对，完成后会通知你"（R8 话术，禁"人工复核/置信度"技术词），可退出，推送召回。
  - 轮询超 90s → 同上静态页 + "完成后通知我"按钮（订阅推送）。
- **守卫（G8）**：该页禁"再次提交/催批改"入口；返回键弹"离开也不会丢，完成后通知你"。

### 4.7 批改结果页（/dictation/attempt/:attemptId/result）

- **总览区**：环形总分（`overallScore`）、对/错/半对计数（correct/incorrect/partial）、与上次对比（▲5 分，服务端 `lastScore` 差值）。
- **逐条列表**：每条一行：序号、期望词、识别词（错字红标 + 期望字注音）、对错图标；点击展开错误明细（`CharError`：位置/expected vs actual/归因标签/讲解话术 suggestion）。拍照模式附 `markedImageUrl` 标注图（委托 PrimeImageLoader，点击全屏查看）。
- **归因标签分龄渲染**：K/P1_3 用图形图标（耳朵=同音字、眼睛=形近字）；P4 以上展示术语（同音字混淆/形近字混淆/偏旁错误/漏画/多画/漏写/错字）。
- **错字卡行动**：每个 frequentErrorChars 生成"错字卡"（字+拼音+归因+例词），点击"加入今日复习"→ 跳转 `/dictation/review`；"已自动安排复习"状态由服务端事件回执后展示（客户端不预设，R1）。
- **底部行动**："再练一遍"（同任务重新 startAttempt，受服务端 attempt 次数约束）、"去掌握度报告"、"分享成绩给家长"（一键触发服务端家长通知事件，客户端不直接触达）。

### 4.8 字形掌握度报告页（/dictation/mastery）

- **结构**：总览卡（四档掌握环形图：已掌握/熟练/熟悉/学习中，`overallMasteryRate`）；近 7 天趋势条（`recentProgress.last7Days.averageScore` + trend 箭头）；易错字列表（`weakCharacters`，字卡：字/拼音/正确率/常见错因/下次复习时间）；按章节筛选（chapterId 下拉，调 `GET /mastery/report?chapterId=`）。
- **交互**：点击字卡 → 错字详情弹层（历史作答次数、错因分布——数据来源服务端报告字段，禁客户端本地聚合 G5）。
- **空态**：新用户"完成一次听写后，这里会展示你的字形掌握度"。

### 4.9 今日复习页（/dictation/review）

- 列表展示 `TodayReview.entries`（字/拼音/掌握度色标/来源说明），点击条目跳转对应错字卡；顶部"开始复习听写"一键调 `POST /tasks/ai-generate`(focus=weak_characters)生成复习任务（幂等 §3.3）。
- `overdue=true` 时顶部横幅"你有 N 个字逾期没复习，今天搞定它们吧"。

### 4.10 家长端听写报告页（/parent/dictation/report）

- **鉴权**：家长角色 + 统一家长门（《服务端-统一家长门与监护人授权核验引擎》）。
- **结构**：孩子选择器（多孩切换）→ 周期筛选（本周/本月）→ 听写次数/平均分/完成率统计 → 高频错字 TOP10 → 任务明细列表（含 ai_generated 任务的 `selectionReason`）。
- **守卫（G9）**：仅展示聚合与结果，不展示批改置信度、`gradedBy` 技术细节、ocr 标注图原图（标注图含孩子手写，仅学生端可看，家长端看缩略遮罩版或不展示，裁决：不展示）。

## 5. 分龄交互适配参数矩阵

| 参数 | K(幼儿) | P1_3(小学低) | P4_6(小学高) | J(初中) | S(高中) | 约束 |
| --- | --- | --- | --- | --- | --- | --- |
| 默认作答模式 | digital_handwrite | digital_handwrite | paper_photo∥digital_handwrite | 三模式可选 | 三模式可选 | 任务配置优先；digital_type 仅 J/S 展示(G11) |
| 大字格尺寸(dp) | 168 | 132 | 112 | 96 | 96 | 设计系统字号档 |
| 播放默认倍速（用户可调） | 0.8 | 0.9 | 1.0 | 1.0 | 1.0 | clamp [0.5,2.0]，服务端 config 为准 |
| 间隔倒计时呈现 | 沙漏动画 | 数字+沙漏 | 数字 | 数字 | 数字 | intervalSeconds 客户端 clamp [3,15] |
| 倒计时跳过长显 | 不显 | 不显 | 显示 | 显示 | 显示 | 防低龄连点跳过书写时间 |
| 归因标签形态 | 图形图标(耳朵/眼睛) | 图形+术语 | 术语 | 术语+例句 | 术语+例句 | §4.7 |
| 重听按钮 | 常驻底部中央 | 常驻底部中央 | 条目栏右侧 | 条目栏右侧 | 条目栏右侧 | 固定位置防误触 |
| 防误触 | 全局防误触开 | 开 | 关 | 关 | 关 | 《全局防误触机制》 |
| 单次连续作答软上限(分钟) | 10 | 15 | 20 | 25 | 30 | 到点委托防沉迷休息页（权威归防沉迷体系，R6） |
| 结果页鼓励动效 | 盖章动画+音效 | 盖章动画 | 简洁动效 | 简洁动效 | 可关闭 | 动效委托手势动画系统，reduceMotion 时静止 |
| 错字卡拼音展示 | 必显 | 必显 | 默认显 | 可折叠 | 可折叠 | showPinyin 服务端权威 |

## 6. 状态机

### 6.1 作答会话状态机（客户端镜像，权威在服务端 §4.2.2）

```
                    ┌─────────────┐
        startAttempt│ IN_PROGRESS │◀────────────────────────┐
                    └──────┬──────┘                         │
                           │submit(网络成功)                 │继续作答
                           ▼                               │
                    ┌─────────────┐   poll status=graded    │
                    │   GRADING   │──────────┬─────────────▶│
                    └──────┬──────┘          │              │
                           │status=           │              │
                           │need_review       │              │
                           ▼                  ▼              │
                    ┌─────────────┐   ┌─────────────┐        │
                    │ NEED_REVIEW │   │    GRADED   │        │
                    │ (静态等待页) │   │  (结果页可   │        │
                    └──────┬──────┘   │   反复查看)  │        │
                           │人工复核后  └──────┬──────┘        │
                           │graded+推送        │result 页"我知道了"│
                           ▼                  ▼              │
                    ┌─────────────────────────────┐          │
                    │          COMPLETED          │──────────┘
                    │  (结果页关闭/再练一遍开新attempt)│  再练=新 attempt
                    └─────────────────────────────┘
```

客户端镜像规则：
- 镜像仅用于 UI 分支，**禁止**客户端自行推进服务端状态；所有迁移以服务端响应/推送为准。
- `submit` 网络失败不迁移状态（本地仍 IN_PROGRESS，入暂存队列 G4）。
- `COMPLETED` 由服务端在学生查看反馈后推进；客户端收到 `status=completed` 的结果查询后，结果页标记"已完结"，再练按钮开新 attempt。

### 6.2 播放状态机（客户端本地权威）

```
IDLE ──load──▶ READY ──play──▶ PLAYING ──pause──▶ PAUSED ──resume──▶ PLAYING
                │                 │    ▲                │
                │                 │    └────────────────┘
                │                 ▼
                │            INTERRUPTED(来电/后台,自动暂停记断点)
                │                 │回前台手动"继续听写"
                │                 ▼
                │              PAUSED(带断点恢复)
                ▼
         COMPLETED(全部条目播完)──▶ 提交引导弹窗
                │
                ▼
         REPLAY(用户点"再听一遍",重置索引)
```

守卫：INTERRUPTED 不可自动迁移回 PLAYING（G2，防沉迷对齐）；REPLAY 不产生新 attempt。

### 6.3 轮询状态机

```
POLLING(间隔1s) ──status=grading──▶ 退避[2,4,8]继续 ──▶ 超90s──▶ WAIT_PUSH(静态页+订阅推送)
                      │status=graded/need_review
                      ▼
                  DONE(关闭轮询定时器,必须 dispose)
```

守卫：页面 dispose 必须取消 Timer 与 SSE 订阅（防内存泄漏）；切后台暂停轮询，回前台重新拉一次结果后再决定是否继续。

### 6.4 守卫规则（G1–G12）

| 编号 | 规则 | 级别 |
| --- | --- | --- |
| G1 | 已过 deadline/expired 任务禁入准备页与作答页（列表置灰，深链接进来自动错误态 `DICT_TASK_DEADLINE_PASSED`） | fail-closed |
| G2 | 播放中断（来电/后台/锁屏）自动暂停记断点，回前台禁自动恢复 | fail-closed |
| G3 | 提交双重防抖 800ms + submitting 锁；409 `DICT_ATTEMPT_ALREADY_SUBMITTED` 视为成功转等待页 | fail-closed |
| G4 | 提交网络失败入暂存队列（≤24h），重试携带同 attemptId；队列满 5 条提示"网络不佳，请联网后提交" | 可降级 |
| G5 | 判分/归因/分数永远服务端下发；客户端禁本地比对与本地答案库 | fail-closed |
| G6 | 拼音一律服务端下发（`pinyin`/`showPinyin`），客户端禁本地拼音生成 | fail-closed |
| G7 | 音频与手写轨迹仅存私有临时目录/Hive，退出登录与注销即清 | fail-closed |
| G8 | NEED_REVIEW 态禁重复提交与催批收入口；话术固定（R8） | fail-closed |
| G9 | 家长端不展示置信度/gradedBy/标注原图 | fail-closed |
| G10 | 同一 attempt 内作答方式可切换，但提交时单一 answerMode，paper 与 digital 不混交（DTO 结构约束） | fail-closed |
| G11 | digital_type 键盘模式仅 J/S 展示且标注"辅助"；K/P1 隐藏入口 | fail-closed |
| G12 | 答题照片/轨迹禁写系统相册、禁分享组件透出；仅提交链路使用 | fail-closed |

## 7. 关键代码示例

### 7.1 播放控制器（DictationPlayerController，委托 UnifiedAudioEngine）

```dart
class DictationPlayerController extends GetxController {
  final UnifiedAudioEngine _audio = Get.find();   // 委托:音频播放器引擎
  final DictationRepository _repo = Get.find();

  final Rx<PlaybackLocalState> state = PlaybackLocalState.idle.obs;
  final RxInt currentIndex = 0.obs;               // 0-based 条目索引
  final RxInt repeatLeft = 0.obs;
  final RxInt countdown = 0.obs;
  final RxBool manualMode = false.obs;            // 手动跳过后切手动

  Timer? _countdownTimer;
  CancelToken? _playToken;

  /// 启动播放(从准备页进入或断点恢复)
  Future<void> start(AudioPlaylist playlist, {int resumeIndex = 0}) async {
    state.value = PlaybackLocalState.ready;
    for (int i = resumeIndex; i < playlist.playlist.length; i++) {
      if (state.value == PlaybackLocalState.interrupted) return; // G2
      currentIndex.value = i;
      final item = playlist.playlist[i];

      // 朗读 repeatCount 遍,每遍间 500ms 短停(服务端 §5.2 语义)
      for (int r = playlist.config.repeatCount; r > 0; r--) {
        repeatLeft.value = r;
        await _playWithLocalFallback(item);      // R10 本地TTS降级
        await Future.delayed(const Duration(milliseconds: 500));
      }

      // 条目间倒计时(可跳过,低龄禁显跳过长显见 §5)
      await _runInterval(playlist.config.intervalSeconds);
    }
    state.value = PlaybackLocalState.completed;
    await Get.find<OverlayManager>().show(      // 委托统一对话框
      DictationFinishDialog(onReplay: replay, onSubmit: gotoSubmit),
    );
  }

  Future<void> _playWithLocalFallback(AudioItem item) async {
    try {
      await _audio.playOnce(
        AudioAsset.remote(item.audioUrl, cacheKey: 'dict_${item.itemId}'),
        token: _playToken,
      );
    } on AudioNetworkException {
      // R10: 网络音频失败 ≥2 次降级本地 TTS;再失败降级拼音文本展示
      final ok = await _audio.speakLocalTts(item.content,
          rate: _currentSpeed);
      if (!ok) _showPinyinFallback(item);        // 大字拼音屏显(不等同音频)
    }
  }

  Future<void> _runInterval(int seconds) async {
    final clamped = seconds.clamp(3, 15);        // 客户端 clamp(§5)
    countdown.value = clamped;
    final completer = Completer<void>();
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      countdown.value--;
      if (countdown.value <= 0 || manualMode.value) { t.cancel(); completer.complete(); }
    });
    await completer.future;
  }

  /// G2: 中断保存断点(条目+剩余遍数),回前台手动恢复
  void onInterrupt() {
    _playToken?.cancel();
    _countdownTimer?.cancel();
    if (state.value == PlaybackLocalState.playing ||
        state.value == PlaybackLocalState.ready) {
      state.value = PlaybackLocalState.interrupted;
      _repo.savePlayBreakpoint(attemptId, currentIndex.value, repeatLeft.value);
    }
  }

  Future<void> dispose() async {                 // 轮询/定时器同规则(§6.3)
    _countdownTimer?.cancel();
    _playToken?.cancel();
    super.dispose();
  }
}
```

### 7.2 手写条格子控制器（WriteGridController，画布委托 StrokeCanvasWidget）

```dart
class WriteGridController extends GetxController {
  final DictationRepository _repo = Get.find();
  final String attemptId;
  WriteGridController(this.attemptId);

  final RxInt currentIndex = 0.obs;
  final RxMap<String, HandwritingData> drafts = <String, HandwritingData>{}.obs;
  late final PageController pager;

  DictationItem get current => task.items[currentIndex.value];

  /// 画布回调(委托 StrokeCanvasWidget.onWritingComplete)
  /// 轨迹本地暂存(G4/防丢),提交时统一序列化
  void onWritingComplete(HandwritingData data) {
    drafts[current.itemId] = data;
    _repo.saveDraft(attemptId, current.itemId, data);
    _autoAdvance();                              // 低龄自动跳下一条,可关
  }

  Future<void> submit() async {
    if (_submitting) return;                     // G3 防抖锁
    _submitting = true;
    try {
      final strokes = task.items
          .where((it) => drafts.containsKey(it.itemId))
          .map((it) => AnswerStroke(
                itemId: it.itemId,
                strokes: drafts[it.itemId]!.strokes,
                canvasWidth: drafts[it.itemId]!.canvasWidth,
                canvasHeight: drafts[it.itemId]!.canvasHeight,
              ))
          .toList();
      final payload = SubmitAttemptPayload(
        answerMode: AnswerMode.digitalHandwrite,
        answerStrokes: strokes,
        durationSeconds: elapsedSeconds,
      );
      await _repo.submitWithQueueGuard(attemptId, payload); // G4 暂存
      Get.offNamed('/dictation/attempt/$attemptId/grading');
    } on AlreadySubmittedException {           // 409 DICT_ATTEMPT_ALREADY_SUBMITTED
      Get.offNamed('/dictation/attempt/$attemptId/grading'); // G3 视为成功
    } finally {
      _submitting = false;
    }
  }
}
```

### 7.3 结果轮询（退避 + 推送召回）

```dart
class GradingPoller {
  final DictationRepository _repo;
  final String attemptId;
  Timer? _timer;
  int _backoff = 1;
  static const _maxPollSeconds = 90;

  void start() {
    final started = DateTime.now();
    _tick(started);
  }

  void _tick(DateTime started) {
    _timer = Timer(Duration(seconds: _backoff), () async {
      try {
        final result = await _repo.fetchResult(attemptId);
        switch (result.status) {
          case AttemptStatus.graded:
            _done(); Get.offNamed('/dictation/attempt/$attemptId/result');
          case AttemptStatus.needReview:
            _done(); Get.offNamed('/dictation/attempt/$attemptId/grading',
                arguments: {'static': true});    // R8 静态等待页
          default:
            if (DateTime.now().difference(started).inSeconds > _maxPollSeconds) {
              _done(); _enterWaitPushMode();     // §6.3 WAIT_PUSH
            } else {
              _backoff = (_backoff * 2).clamp(1, 8);
              _tick(started);
            }
        }
      } on NetworkException {                    // 轮询网络错误不致命,继续退避
        _backoff = (_backoff * 2).clamp(1, 8);
        _tick(started);
      }
    });
  }

  void _done() => _timer?.cancel();              // dispose 必调(§6.3 守卫)
}
```

### 7.4 路由守卫（任务时效与归属校验）

```dart
class DictationRouteGuard extends RouteGuard {
  final DictationRepository _repo = Get.find();

  @override
  Future<bool> canActivate(String route, Map<String, String> params) async {
    if (!AuthSession.isStudent) return false;    // 登录态
    final taskId = params['taskId'];
    if (route.startsWith('/dictation/task/') && taskId != null) {
      final task = await _repo.fetchTaskDetail(taskId);
      if (task.status == TaskStatus.expired ||    // G1
          (task.deadline?.isBefore(DateTime.now()) ?? false)) {
        ErrorMessageFactory.show('DICT_TASK_DEADLINE_PASSED'); // §8.1 映射
        return false;
      }
    }
    return true;
  }
}
```

## 8. 错误处理与降级

### 8.1 错误码映射（服务端 DICT_* → 客户端 DCTP_xxx 符号码，零新增数字段位）

| 服务端错误码 | HTTP | 客户端符号码 | 用户话术（ErrorMessageFactory） | 处理动作 |
| --- | --- | --- | --- | --- |
| `DICT_TASK_NOT_FOUND` | 404 | DCTP_001 | "任务不存在或已删除" | 返回列表页 |
| `DICT_TASK_NOT_PUBLISHED` | 409 | DCTP_002 | "任务还未发布，稍后再来" | 刷新列表 |
| `DICT_TASK_EXPIRED` | 410 | DCTP_003 | "任务已过期" | 列表置灰刷新 |
| `DICT_TASK_DEADLINE_PASSED` | 410 | DCTP_004 | "已过截止时间，下次要早点完成哦" | 返回列表页 |
| `DICT_ATTEMPT_EXISTS` | 409 | DCTP_005 | —（不展示） | 静默续答：拉取 in_progress attempt 进作答页 |
| `DICT_ATTEMPT_NOT_FOUND` | 404 | DCTP_006 | "作答记录不存在" | 返回列表页 |
| `DICT_ATTEMPT_ALREADY_SUBMITTED` | 409 | DCTP_007 | —（不展示） | 转批改等待页（G3） |
| `DICT_GRADING_FAILED` | 500 | DCTP_008 | "批改遇到问题，已请老师处理" | 静态页+推送召回 |
| `DICT_GRADING_LOW_CONFIDENCE` | 200 | DCTP_009 | "老师正在帮你仔细核对" | 结果页附"仔细核对"标记，不展示数值（G5） |
| `DICT_AUDIO_NOT_READY` | 202 | DCTP_010 | "音频生成中，请稍候" | 准备页 3s 重试，上限 60s |
| `DICT_NO_ITEMS_AVAILABLE` | 422 | DCTP_011 | "暂时没有可听写的内容" | 返回列表页 |
| `DICT_PERMISSION_DENIED` | 403 | DCTP_012 | "没有权限查看" | 返回首页 |
| `DICT_ITEM_LIMIT_EXCEEDED` | 422 | DCTP_013 | "内容太多啦，分两次吧" | 自定义内容页提示 |
| `DICT_REVIEW_OVERDUE` | 200 | DCTP_014 | "有逾期的复习字词" | 今日复习页横幅 |

通用语义码（参数校验 40001 系/限流 42901 系/未登录 40103）按《服务端统一业务异常码与错误分类体系》全局映射，本文不重复占用（R7）。

### 8.2 客户端降级矩阵 D1–D10

| 编号 | 场景 | 降级路径 | 红线 |
| --- | --- | --- | --- |
| D1 | 音频下载失败 | 本地 TTS 朗读（R10）→ 拼音大字屏显 | 拼音屏显仍须服务端 pinyin 字段，禁本地生成 |
| D2 | TTS 与音频双不可用 | 展示"本次听写暂不可用，先去做复习"，引导 /dictation/review | 禁静默退出 |
| D3 | 拍照上传失败 | 断点续传重试 → 暂存队列 24h | 禁丢答题照片 |
| D4 | 批改服务超时/失败 | 静态等待页 + 推送召回（DCTP_008 话术） | 禁展示"系统错误/重试中"技术词 |
| D5 | 结果页加载失败 | 可重试错误态；已缓存结果仅本次会话内展示 | 禁持久缓存批改结果（隐私 G7） |
| D6 | 掌握度报告加载失败 | 骨架屏→错误态重试 | — |
| D7 | 推送不可达（无厂商通道） | 等待页轮询延长至 5min 一次，最长 30min 后提示"稍后从任务列表查看" | — |
| D8 | 低端机手写卡顿 | 降采样轨迹采集（仍满足服务端识别精度下限，points 距离≥2dp） | 禁丢笔画（识别输入完整性） |
| D9 | 弱网进入准备页 | 跳过音频预下载，作答页逐条边下边播 | 禁阻塞开始 |
| D10 | 任意降级总红线 | 判分与归因不可降级、不可端侧伪造（G5）；防沉迷休息不可绕过（R6） | fail-closed |

## 9. 合规红线（客户端侧 C1–C8）

| 编号 | 红线 |
| --- | --- |
| C1 | 作答页与播放过程**不显示当前词条内容**（防跟抄），结果页才展示期望词 |
| C2 | 答题照片/手写轨迹禁写系统相册、禁进分享组件、禁第三方 SDK 读取（G12）；退出登录/注销即清（G7） |
| C3 | 不向学生展示批改置信度、gradedBy、复核技术流程；NEED_REVIEW 统一"老师正在帮你仔细核对"话术（R8/G9） |
| C4 | 错误讲解话术使用服务端 `suggestion`（成长型话术经服务端内容安全审核），客户端禁拼接评价性语句（禁"你太粗心"） |
| C5 | 防沉迷：连续作答软上限到点委托防沉迷休息页，禁客户端自行延长（R6）；休息不可跳过 |
| C6 | 音频播放遵守静音/勿扰场景：通知音频不打断课堂模式（委托系统音频会话管理） |
| C7 | 家长端报告遵守数据可见度分级（《学生学习数据家庭共享可见度分级与隐私边界管控引擎》），孩子手写原图不外发 |
| C8 | AI 生成任务（ai_generated）在任务卡与结果页展示"AIGC 生成内容"标识（标识组件委托《AIGC内容标识》体系） |

## 10. 埋点事件（module=dictation，权威归《客户端埋点事件体系与数据采集规范》）

| 事件名 | 触发点 | 关键属性 |
| --- | --- | --- |
| dict_task_list_view | 任务列表曝光 | task_count, review_banner(0/1) |
| dict_task_open | 点击任务卡 | task_id, source_type, type, item_count |
| dict_prepare_view | 准备页曝光 | task_id, answer_mode, audio_preload_ms |
| dict_play_start | 首次播放 | task_id, attempt_id, resume(0/1), speed |
| dict_play_item_done | 每条播完 | task_id, ordinal, replay_count |
| dict_play_interrupt | 播放中断 | task_id, cause(call/background/lock) |
| dict_write_complete | 单条手写完成 | task_id, item_id, stroke_count |
| dict_capture_shot | 拍照完成 | task_id, shot_mode(page/single), retake_count |
| dict_submit_click | 提交点击 | task_id, attempt_id, answer_mode, item_filled/total |
| dict_submit_result | 提交结果 | attempt_id, result(ok/queued/409), duration_ms |
| dict_grading_wait_view | 等待页曝光 | attempt_id, wait_mode(polling/static) |
| dict_result_view | 结果页曝光 | attempt_id, score, correct/total, need_review(0/1) |
| dict_error_char_tap | 点击错字归因 | attempt_id, error_type, char |
| dict_mastery_view | 掌握度页曝光 | overall_rate, weak_count |
| dict_review_tap | 今日复习点击 | entry_count, overdue(0/1) |

**禁采**：照片/轨迹内容、坐标绝对值外的任何图像数据、批改置信度。

## 11. 性能设计

| 项 | 目标 | 手段 |
| --- | --- | --- |
| 任务列表首屏 | P95 ≤ 1.2s | 骨架屏 + 列表接口缓存 30s（任务状态变更以服务端推送失效） |
| 音频起播延迟 | P95 ≤ 300ms（预载后 ≤ 100ms） | 准备页全量预载委托 AudioCacheManager；边下边播走流式 |
| 批改等待感知 | 提交→结果页跳转 ≤ 12s 内展示动效 | 轮询 1s 起步退避，SSE/推送双通道 |
| 手写画布帧率 | 低端 ≥ 55fps | RepaintBoundary 分格、轨迹点抽吸（D8 下限之上） |
| 拍照页相机启动 | P95 ≤ 800ms | 相机引擎预热（进入 play 页即初始化，权限预申请） |
| 内存 | 作答全程 ≤ 180MB（中端机） | 音频逐条释放、轨迹按条目落盘 Hive 后内存只留当前条 |
| 包体积 | 本模块增量 ≤ 400KB | 复用播放器/画布/拍照组件，零新增原生依赖 |

## 12. 契约对齐（R1–R12）

| 编号 | 裁决 |
| --- | --- |
| R1 | 判分/归因/掌握度/复习安排权威 100% 服务端；客户端零判分、零答案库、零本地聚合（G5） |
| R2 | 朗读音频与 `repeatCount/intervalSeconds` 语义对齐服务端 §3.2.2/§5.2；客户端只做播放执行与 interval clamp [3,15] |
| R3 | 手写画布组件权威归《汉字笔画顺序检测与评估系统》StrokeCanvasWidget，本文仅定义采集与序列化；听写场景不启用实时笔顺评判 |
| R4 | 拍照采集与预处理权威归《客户端-拍照图像采集与预处理引擎》，区域检测/题目切分归服务端 OCR 管线（客户端零检测） |
| R5 | 弹窗委托统一对话框、加载态委托页面状态规范、图片委托 PrimeImageLoader，本文不自建 |
| R6 | 时长统计/防沉迷/休息裁决权威归《防沉迷与未成年人保护机制》与统一时长归因引擎，本文只做原始事件上报 |
| R7 | 错误码：客户端 DCTP_001~014 符号码与服务端 DICT_* 1:1 映射，零新增数字段位；通用码归口全局体系 |
| R8 | NEED_REVIEW/低置信度统一话术"老师正在帮你仔细核对"，两端（学生端/推送）同文案，禁技术词 |
| R9 | submit 幂等键 = attemptId；startAttempt 冲突 409 语义 = 续答入口（DCTP_005 不展示） |
| R10 | 本地 TTS 降级路径与服务端 §6.1 降级语义一致；拼音屏显仅使用服务端下发 pinyin |
| R11 | 拍照提交不携带 boundingBox；逐条补拍模式携带 itemId；映射归服务端区域检测 |
| R12 | AIGC 标识组件委托《AIGC内容标识与生成内容溯源水印系统》，文案与位置以标识体系为准 |

## 13. 验收场景（AC01–AC16）

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| AC01 | 学生点击进行中任务卡 | 存在 in_progress attempt 时直进作答页续答（DCTP_005 静默） |
| AC02 | dictation 任务完整流程 | 朗读 N 遍+倒计时逐条播放，播完弹提交引导；不显示词条内容 |
| AC03 | recitation 任务 | 无音频，按 showPinyin 展示拼音，提交走同批改链路 |
| AC04 | 音频未就绪（202） | 准备页"生成中"每 3s 重试，60s 超时错误态可重试 |
| AC05 | 音频下载失败 | 自动降级本地 TTS；双失败降级拼音屏显且词条仍可完成提交 |
| AC06 | 来电中断 | 自动暂停记断点，回前台禁自动恢复，手动"继续听写"从断点续播 |
| AC07 | 屏幕手写 20 条并提交 | 轨迹按条暂存不丢；提交成功转等待页；重复点击不二次提交 |
| AC08 | 弱网提交失败 | 入暂存队列，恢复网络自动补报同 attemptId，服务端不重复计分 |
| AC09 | 拍照整页提交 | 格位指引拍摄→断点续传→服务端区域检测批改，逐条结果映射正确 |
| AC10 | 批改 need_review | 静态等待页固定话术，禁催批入口；复核完成推送直达结果页 |
| AC11 | 结果页归因展示 | 错字红标+期望字+归因标签（分龄形态正确）+服务端 suggestion 话术 |
| AC12 | 过期任务深链接 | G1 拦截，DCTP_004 话术，返回列表页 |
| AC13 | K 档与 J 档模式差异 | K 隐键盘模式与跳过按钮；J 展示 digital_type 并标注"辅助" |
| AC14 | 家长端报告 | 展示聚合数据与 selectionReason；无置信度/标注原图；过家长门 |
| AC15 | 退出登录 | 音频缓存、手写草稿、暂存队列全部清除（G7） |
| AC16 | 埋点完整性 | §10 事件全量触发且属性齐，无照片/轨迹内容上传 |

## 14. 关联文档

- `docs2/服务端-学生听写默写智能评估与语文基础知识自动批改引擎-详细设计.md`（服务端契约权威）
- `docs2/客户端-音频播放器与录制引擎及听力练习交互组件-详细设计.md`（播放/录制委托）
- `docs2/汉字笔画顺序检测与评估系统-详细设计.md`（手写画布委托）
- `docs2/客户端-拍照图像采集与预处理引擎-详细设计.md`（拍照委托）
- `docs2/客户端-文件上传服务与断点续传机制-详细设计.md`（上传委托）
- `docs2/客户端-统一对话框与模态弹出层调度管理系统-详细设计.md`（弹窗委托）
- `docs2/客户端-页面状态模式与骨架屏加载空态错误态设计规范-详细设计.md`（状态规范）
- `docs2/防沉迷与未成年人保护机制-详细设计.md`（时长/休息权威）
- `docs2/客户端-全局防误触与儿童安全交互保护机制-详细设计.md`（低龄防误触）
- `docs2/客户端埋点事件体系与数据采集规范-详细设计.md`（埋点权威）

## 15. 维护记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v1.0 | 2026-11-22 | 初版发布。新开细化点：服务端《学生听写默写智能评估与语文基础知识自动批改引擎》就绪后客户端页面层零覆盖（经全目录关键词扫描"听写/默写"确认：仅服务端引擎、背诵 E2E 枚举引用、英语 E2E 附述，无客户端页面文档）。本文确立 `/dictation/*` 九页面单元 + 家长端报告页，DCTP_001~014 符号码与服务端 DICT_* 1:1 映射（零新增数字段位，规避全库段位扫描），委托播放器/手写画布/拍照/上传/弹窗五组件，守卫 G1-G12、降级 D1-D10、合规 C1-C8、契约 R1-R12、验收 AC01-AC16。 |
