# 端到端流程设计：语音提问与 AI 语音交互完整链路 - 详细设计

> 版本：v1.0 | 创建日期：2026-08-15 | 状态：待评审
>
> **链路定位**：本文档串联「语音提问 → 流式 ASR → 输入安全 → 意图路由 → AI 生成 → 句子级流式 TTS → 播放 → 打断 → 计费 → 归档合规」的完整端到端链路，并**正式定义服务端联合流式协议**（此前《客户端-AI语音对话实时交互与流式语音合成播放引擎》§5.3 仅为参考级草图，服务端侧无正式设计）。
>
> **关联文档**：
> - 《语音服务(ASR-TTS)-详细设计》—— ASR/TTS 供应商适配、WS 通道、发音评测、降级策略
> - 《客户端-AI语音对话实时交互与流式语音合成播放引擎-详细设计》—— 客户端 VAD、播放器、打断交互、弱网降级
> - 《客户端-语音交互页面架构与口语练习交互设计-详细设计》—— 页面与组件层
> - 《服务端-幼儿端儿童语音识别适配与语音交互安全引擎-详细设计》—— 儿童 ASR 模型路由、儿童声纹检测、儿童语音日限额
> - 《多模态输入统一处理与智能路由引擎-详细设计》—— asr_final 后的统一意图/场景路由
> - 《AI辅导全链路请求处理与编排设计-详细设计》《AI-Prompt编排与场景模板系统-详细设计》—— LLM 生成编排
> - 《答案管控与渐进式提示引擎-详细设计》—— 语音场景答案管控策略（见 §5.7.4）
> - 《大模型流式输出实时安全过滤中间件与动态拦截替换引擎-详细设计》—— TTS 前句子级安全过滤
> - 《服务端-用户额度管控与功能门控引擎-详细设计》—— 语音/LLM/TTS 额度核扣
> - 《服务端-教育平台青少年模式风控与内容访问分级策略引擎-详细设计》—— 青少年模式语音入口门控

---

## 1. 概述

### 1.1 背景与问题

语音提问是原设计 §7.1 P1 功能（"AI 辅导-语音提问"），幼儿端（§5.1"语音化交互"）更是以语音为第一输入方式。当前组件级文档已各自覆盖：客户端采集/VAD/播放（2 份）、服务端 ASR/TTS 适配（1 份）、儿童识别适配（1 份），但存在四个**链路级空白**：

1. **服务端联合流式编排无正式设计**：客户端文档 §5.3 仅给出"参考"级草图，ASR→LLM→TTS 三段流水线在服务端由谁编排、如何背压、如何取消传播，均未定义。
2. **打断（barge-in）只有客户端单侧设计**：服务端如何停止 LLM 上游拉取、清空 TTS 队列、截断对话上下文、裁决在途帧竞态，未定义。
3. **断线重连无续传协议**：移动网络切换（WiFi↔蜂窝）、iOS 后台切换导致 WS 断开时，已生成的句子与音频如何续传未定义。
4. **计费与合规留存无链路级口径**：语音秒数 / LLM token / TTS 字符三重用量如何统一核扣、未成年人语音音频是否留存/留存多久，各文档口径不一。

本文档补齐以上四点，并给出全链路状态机、异常补偿矩阵、容量估算与验收场景。

### 1.2 覆盖场景矩阵

| # | 场景 | 学段 | 输入形态 | 输出形态 | 本文覆盖深度 |
|---|------|------|---------|---------|------------|
| S1 | 语音提问 AI 答疑（连续对话） | 小学-高中 | 按住说话 / 点击说话 + VAD 自动断句 | 流式 TTS 语音 + 同步文字 | **全量**（主链路） |
| S2 | 幼儿语音交互（问常识/听讲解） | 幼儿 | VAD 全自动，短句 | 儿童音色 TTS + 鼓励式反馈 | 差异点（§5.2/§5.3/§10.2），其余复用 S1 |
| S3 | 口语跟读/发音评测 | 全学段 | 朗读指定文本 | 评分卡 + 纠音反馈 | **不复用本链路**，走《语音服务》§4.6 发音评测接口，仅在 §14 边界表中说明 |
| S4 | 语音背诵检测 | 小学-高中 | 背诵指定材料 | 完整度评分 | **不复用本链路**，走《服务端-文科背诵内容管理》语音检测，§14 说明差异 |

> 设计原则：S3/S4 是"评测型"单向链路（有参考文本、无 LLM 生成），与 S1/S2 的"生成型"对话链路架构诉求不同，**不强行合并**，仅共享 ASR 供应商适配层与音频采集 SDK。

### 1.3 链路设计目标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 语音端点判定后 → 首个 `asr_final` | ≤ 800ms（P90） | 提交判定在服务端 VAD 尾点后 |
| `asr_final` → 首个文字 `llm_delta` 上屏 | ≤ 1.5s（P90） | 与原设计 §13.2"首 token ≤3s"对齐并收紧 |
| `asr_final` → 首段 `tts_audio` 可播 | ≤ 3.0s（P90） | 文字先行显示，语音不阻塞阅读 |
| 打断指令 → 服务端停止 TTS 下发 | ≤ 300ms | 在途帧竞态由 seq 裁决（§5.8.3） |
| WS 断线 30s 内重连续传 | 无重复播放、无丢句 | §5.9 |
| 语音会话完成率（有 `session_end` 帧） | ≥ 97% | §12 监控 |

---

## 2. 角色与前置约束

| 角色 | 在链路中的职责 |
|------|--------------|
| 学生（3-18 岁） | 发起语音提问、听讲、打断、追问 |
| 家长 | 可通过家长中心查看"语音功能开关/时长"（复用防沉迷与家长门，不在本链路内重复实现） |
| 系统-语音编排器（VoiceDialogOrchestrator，隶属语音服务，见 §3.2） | 全链路编排：会话生命周期、三段流水线、打断、续传、计费事件 |
| 系统-ASR/TTS 适配层 | 供应商调用与降级（《语音服务》§5.3） |
| 系统-AI 对话编排 | LLM 流式生成（SSE），本链路作为其"语音形态调用方" |
| 系统-额度中心 | 语音秒数/LLM token/TTS 字符核扣 |
| 审核/合规 | 语音转写文本随 AI 对话进入既有抽检体系（《服务端-AI对话质量抽样审核与标注工作台服务》） |

**前置门控**（任一不通过即返回对应错误码，不建立会话）：

1. 麦克风系统权限（客户端本地检查，`VOICE_RECORDER_PERMISSION`）。
2. 青少年模式/防沉迷时间窗（《防沉迷与未成年人保护机制》）。
3. 当日语音额度（免费用户每日 N 次，会员更高；儿童另有儿童语音日限额，见 §10.2）。
4. 学段语音能力开关（后台可配置"语音提问"灰度，复用《灰度发布与特性开关系统》）。

---

## 3. 端到端流程总览

### 3.1 阶段视图

```text
[①前置检查]   权限/模式/额度/特性开关 ──不通过──> 错误提示，链路终止
     │通过
     ▼
[②会话建立]   POST /v1/voice/sessions 协商参数 ──> WSS 双工通道连接
     │session_open
     ▼
[③采集上行]   客户端 VAD + 音频分片上行（弱网自适应码率）
     │audio_chunk ×N（服务端同步做 ASR 增量识别，asr_partial 回显）
     ▼
[④端点判定]   服务端 VAD 尾点静音 / 客户端手动提交(commit) / 最大时长熔断
     │asr_final
     ▼
[⑤安全与路由] 转写文本 ─> 输入安全护栏 ─> 多模态路由引擎（意图/学段/场景）
     │safety_blocked 或 路由决策
     ▼
[⑥生成流水线] LLM SSE 拉取 ─> 句子切分器 ─> 句子级安全过滤 ─> TTS 流式合成池
     │llm_delta（文字上屏）/ sentence_ready / tts_audio（音频下发）
     ▼
[⑦播放与打断] 客户端音频缓冲队列播放；用户说话 ─> interrupt 帧 ─> 服务端
     │            取消传播（停 LLM、清 TTS 队列）─> interrupt_ack ─> 回到[③]
     ▼
[⑧计费归档]   usage 帧 ─> 额度中心核扣（Outbox 补偿）；转写文本+回复落
     │          AI 对话历史；音频默认不持久化（§10.1）
     ▼
[⑨会话结束]   用户退出 / 超时闲置 / 额度耗尽 ─> session_end ─> WS 关闭
```

### 3.2 服务端模块归属（不新增顶级服务）

按原设计 §8.4"模块化单体起步"原则，本链路**不新增顶级服务**，在语音服务（speech-service）内新增 `VoiceDialogOrchestrator` 组件：

```text
speech-service
├── asr-adapter          （已有，《语音服务》§3.3/§5.1）
├── tts-adapter          （已有，《语音服务》§4.5/§5.2-5.3）
├── pron-eval            （已有，S3 场景专用，本链路不经过）
└── voice-orchestrator   【新增】
    ├── SessionManager        会话生命周期 + resume 缓存（Redis）
    ├── UpstreamAsrWorker     桥接 asr-adapter，产出 asr_partial/asr_final
    ├── LlmPipelineWorker     调用 AI 对话编排 SSE，消费 llm_delta
    ├── SentenceSplitter      句子边界切分（LaTeX/Markdown 保护）
    ├── TtsPipelineWorker     句子级 TTS 合成池（并发 2-3，队列上限 8）
    ├── InterruptHandler      打断取消传播与在途帧裁决
    ├── UsageRecorder         用量事件 + Outbox
    └── WsGateway             双工帧编解码、心跳、背压
```

对 AI 对话编排的调用为**内部服务间调用**（携带 `X-Channel: voice` 请求头，见《服务端-请求上下文传递与服务间调用规范》），使其可按渠道差异化（如语音场景 prompt 模板要求"短句、口语化、避免长公式"，见 §5.7.3）。

---

## 4. 核心数据结构

### 4.1 数据库表（MySQL，随语音服务库）

```sql
-- 语音对话会话主表（一次连续语音交互窗口，含多轮）
CREATE TABLE voice_dialog_session (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id      VARCHAR(64)  NOT NULL COMMENT '业务ID，vs_前缀雪花ID',
  user_id         BIGINT       NOT NULL,
  student_profile_json JSON    NULL COMMENT '快照：学段/年级/学科/教材版本（路由用）',
  channel         VARCHAR(16)  NOT NULL DEFAULT 'app' COMMENT 'app/pad/harmony',
  grade_stage     VARCHAR(16)  NOT NULL COMMENT 'kindergarten/primary/junior/senior',
  status          VARCHAR(24)  NOT NULL COMMENT '见 §8 状态机',
  negotiate_json  JSON         NULL COMMENT '会话协商参数（码率/编码/VAD 参数/音色）',
  total_asr_seconds DECIMAL(8,2) NOT NULL DEFAULT 0,
  total_llm_tokens  INT        NOT NULL DEFAULT 0,
  total_tts_chars   INT        NOT NULL DEFAULT 0,
  ai_conversation_id BIGINT    NULL COMMENT '关联 AI 对话会话（文字与语音共用历史）',
  started_at      DATETIME(3)  NOT NULL,
  ended_at        DATETIME(3)  NULL,
  end_reason      VARCHAR(32)  NULL COMMENT 'user_exit/idle_timeout/quota_exhausted/error',
  INDEX idx_user_time (user_id, started_at)
) COMMENT '语音对话会话';

-- 语音轮次表（一问一答一轮；音频本体不落库，仅元数据）
CREATE TABLE voice_dialog_turn (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id      VARCHAR(64)  NOT NULL,
  turn_no         INT          NOT NULL,
  asr_text        TEXT         NULL COMMENT 'ASR 最终转写',
  asr_confidence  DECIMAL(4,3) NULL,
  client_edited   TINYINT      NOT NULL DEFAULT 0 COMMENT '用户是否手动修正过识别文本',
  audio_meta_json JSON         NULL COMMENT '{duration_ms,format,bitrate,sample_rate,vad:server|client}',
  route_decision_json JSON     NULL COMMENT '多模态路由引擎决策快照',
  reply_message_id BIGINT      NULL COMMENT 'AI 对话消息ID（关联 ai_conversation）',
  interrupted     TINYINT     NOT NULL DEFAULT 0,
  played_sentence_seq INT     NULL COMMENT '打断时已播放到的句子序号',
  asr_seconds     DECIMAL(8,2) NOT NULL DEFAULT 0,
  tts_chars       INT          NOT NULL DEFAULT 0,
  created_at      DATETIME(3)  NOT NULL,
  UNIQUE KEY uk_session_turn (session_id, turn_no)
) COMMENT '语音对话轮次';

-- 用量事件表（对账用，Outbox 保障写入额度中心）
CREATE TABLE voice_usage_event (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id    VARCHAR(64) NOT NULL,
  turn_no       INT         NULL,
  user_id       BIGINT      NOT NULL,
  asr_seconds   DECIMAL(8,2) NOT NULL DEFAULT 0,
  llm_tokens    INT         NOT NULL DEFAULT 0,
  tts_chars     INT         NOT NULL DEFAULT 0,
  settle_status VARCHAR(16) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/SETTLED/FAILED/EXEMPT',
  settle_time   DATETIME(3) NULL,
  retried       INT         NOT NULL DEFAULT 0,
  created_at    DATETIME(3) NOT NULL,
  INDEX idx_status (settle_status, created_at)
) COMMENT '语音链路用量事件（Outbox）';
```

### 4.2 Redis 结构

| Key | 类型 | TTL | 用途 |
|-----|------|-----|------|
| `vds:{session_id}:ctx` | Hash | 120s 滚动 | 会话运行态：status、当前 turn、已生成句子 seq、TTS 队列深度 |
| `vds:{session_id}:sentences` | List | 120s | 断线重连续传缓存：`{seq, text, tts_object_key?, audio_bytes?}`，最多保留最近 16 句 |
| `vds:{session_id}:audio_buf` | String（二进制） | 120s | 未下行音频滚动缓冲（上限 512KB，超出仅保元数据，重连后由客户端按 object 补拉） |
| `vds:resume:{session_id}` | String(resume_token) | 30s | 断线重连凭证，一次性使用 |
| `vds:quota:gate:{user_id}` | String 计数 | 当日 24:00 | 会话建立门槛检查（软限，精确核扣以 usage_event 对账为准） |
| `childvlimit:{user_id}` | — | — | 儿童语音日限额（《幼儿语音安全引擎》§5.4 已有，本链路复用） |

> 音频对象：降级模式 / 断线补拉场景下，整句音频写入对象存储 `voice-tts/{session_id}/{turn_no}/{seq}.ogg`，生命周期规则 2 小时自动删除（复用《服务端-存储资源统一生命周期管理》）。

### 4.3 协议帧结构（WSS 双工，JSON 控制帧 + 二进制音频帧）

上行帧（Client → Server）：

```jsonc
// 控制帧（TextMessage）
{ "type": "audio_chunk_meta", "seq": 1024, "format": "opus", "sample_rate": 16000,
  "bitrate_bps": 24000, "duration_ms": 100 }        // 每个二进制音频块前的元信息
{ "type": "commit", "turn_no": 3 }                  // 手动提交（松开按钮），触发端点判定
{ "type": "interrupt", "turn_no": 3, "last_played_seq": 5 }  // 打断，见 §5.8
{ "type": "played_ack", "turn_no": 3, "seq": 5 }    // 已播放确认（用于上下文截断，尽力而为）
{ "type": "heartbeat", "ts": 1755240000000 }
{ "type": "resume", "resume_token": "rt_xxx" }      // 断线重连（新 WS 连接的首帧）
```

```text
二进制帧（BinaryMessage）＝ 纯音频负载，按前一控制帧 audio_chunk_meta 解释
```

下行帧（Server → Client）：

```jsonc
{ "type": "session_open", "session_id": "vs_xxx", "vad": { "tail_silence_ms": 700, "max_utterance_ms": 60000 },
  "tts": { "voice": "female_warm_01", "sample_rate": 24000 }, "resume_window_s": 30 }
{ "type": "asr_partial", "turn_no": 3, "text": "二次函数的对称轴怎么求" }
{ "type": "asr_final", "turn_no": 3, "text": "二次函数的对称轴怎么求？", "confidence": 0.93,
  "asr_seconds": 3.2, "editable_until_reply": true }
{ "type": "safety_blocked", "turn_no": 3, "reason_code": "52303", "tip": "我们可以聊聊学习问题哦" }
{ "type": "reply_started", "turn_no": 3, "reply_message_id": 88231001 }
{ "type": "llm_delta", "turn_no": 3, "text": "我们先来看这个函数的各项系数…" }   // 增量文字
{ "type": "sentence_ready", "turn_no": 3, "seq": 1, "text": "我们先来看这个函数的各项系数。" } // 句边界
{ "type": "tts_audio", "turn_no": 3, "seq": 1, "format": "opus",
  "index": 0, "final": false }                        // 后随二进制音频块；final=true 表示该句音频完结
{ "type": "tts_turn_end", "turn_no": 3, "total_sentences": 9, "total_tts_chars": 402 }
{ "type": "interrupt_ack", "turn_no": 3, "cancelled_sentences": 4, "context_kept_seq": 5 }
{ "type": "usage", "turn_no": 3, "asr_seconds": 3.2, "llm_tokens": 612, "tts_chars": 218 }
{ "type": "error", "turn_no": 3, "code": "52312", "recoverable": true, "tip": "语音合成暂时不可用，已切换为文字显示" }
{ "type": "session_end", "reason": "user_exit", "usage_total": { "asr_seconds": 41.5, "llm_tokens": 3120, "tts_chars": 1502 } }
```

---

## 5. 关键流程步骤详细设计

### 5.1 步骤①：前置检查与会话协商

1. 客户端本地检查麦克风权限、静音开关、设备音频会话可用性。
2. `POST /v1/voice/sessions`（鉴权 Bearer Token）：

```jsonc
// 请求
{ "channel": "app", "client_caps": { "opus": true, "amr_nb": true, "max_bitrate_bps": 32000 },
  "scene": "ai_dialog", "context": { "subject": "math", "chapter_id": 90211 } }
// 响应
{ "session_id": "vs_20260815_9f3a", "wss_url": "wss://api.primetop.edu/v1/voice/sessions/vs_20260815_9f3a/stream?st=<one-time>",
  "vad": { "tail_silence_ms": 700, "max_utterance_ms": 60000, "mode": "server_vad" },
  "tts": { "voice": "female_warm_01", "speed": 1.0 },
  "quota_gate": { "remaining_today": 17, "limit_type": "member_monthly" } }
```

3. 服务端按学段/年龄差异化协商参数：
   - 幼儿：`tail_silence_ms=1200`（儿童语速慢、停顿多）、音色取儿童友好音色、`max_utterance_ms=30000`；ASR 路由至儿童模型（《幼儿语音安全引擎》§4.1）。
   - 高中理科：`tail_silence_ms=500`。
4. `wss_url` 携带一次性票据 `st`（60s 有效），防止会话被劫持重放。

### 5.2 步骤②：WS 建立、鉴权与心跳

- 建连后服务端立即下发 `session_open`；客户端 30s 内未收到即断开重试（指数退避 1s/2s/4s，3 次后转文字模式）。
- 心跳：客户端每 15s 一帧 `heartbeat`；服务端 30s 未收到任何上行帧则下发 `error(code=52301 idle)` 并关闭。
- 背压：服务端发送缓冲高水位（256KB）时暂停读取 TTS 音频（§5.7.5 联动），避免内存膨胀。

### 5.3 步骤③：音频采集与上行

1. 客户端按《客户端-AI语音对话实时交互》§4 采集 16kHz 单声道，本地 VAD 仅用于**波形 UI 与静音抑制**（不发静音包），端点判定以**服务端 VAD 为准**（双端 VAD 冲突时以服务端为权威，避免客户端误断句）。
2. 分片策略：Opus 20ms/帧 → 100ms 打包一块，每块前置 `audio_chunk_meta`；弱网自适应降档：24kbps → 12kbps → AMR-NB 4.75kbps（由客户端网络探测驱动，服务端透传给 ASR 适配层自动匹配解码）。
3. 上行总时长熔断：`max_utterance_ms` 到达时服务端强制触发端点判定并下发 `asr_final`（截断标记 `truncated: true`），提示用户"可以说得简短一点，或分两次问"。

### 5.4 步骤④：流式 ASR 与端点判定

1. `UpstreamAsrWorker` 将音频流桥接至 ASR 适配层（WS 流式，含供应商降级链 A→B→C，《语音服务》§5.3）。
2. 中间结果以 `asr_partial` 下发（节流 ≥300ms 或文本变化时），客户端实时回显。
3. 端点判定三来源（先到先触发，后续来源的触发被幂等丢弃）：
   - 服务端 VAD：尾点静音达到 `tail_silence_ms`；
   - 客户端 `commit`（按住说话松开）；
   - 最大时长熔断。
4. `asr_final` 下发后进入 **编辑窗口**：客户端展示可编辑转写文本，用户可在 4s 内修正或直接说/点击"发送"；服务端不等编辑窗口（默认自动继续），客户端若有修正以 `asr_final_edit` 补帧上报（记 `client_edited=1`，供 ASR 质量归因）。

### 5.5 步骤⑤：输入安全与意图路由

1. `asr_final.text` 先过输入安全护栏（《AI输入安全与教育对话护栏引擎》+《服务端-教育场景敏感词多层次过滤》）：不通过 → `safety_blocked`，本轮结束（计 asr_seconds，不计 LLM/TTS），转写文本仍落 `voice_dialog_turn` 供审核追溯。
2. 通过后提交多模态路由引擎（`X-Channel: voice`）：完成学段/学科/场景意图判定，产出 `route_decision_json`，决定调用哪个 Prompt 场景模板（如 `junior_math_solution_voice`）。
3. 语音场景特有路由规则：
   - 转写文本过短（≤2 字）且低置信度 → 判为误触发，下发 `error(52305 utterance_unclear)`，不调用 LLM（省成本）。
   - 检测到"我要完整答案"类强索答意图 → 走答案管控引擎策略（§5.7.4）。

### 5.6 步骤⑥：LLM 流水线（文字流）

`LlmPipelineWorker` 以 SSE 消费 AI 对话编排输出，逐段转发 `llm_delta` 给客户端（文字上屏不等待语音）。**上下文组装**：语音会话绑定 `ai_conversation_id`，历史轮次复用 AI 对话历史（打断截断规则见 §5.8.4），跨端在文字 AI 对话页可见同一条会话（打上"语音"标记）。

### 5.7 步骤⑦：句子切分与 TTS 流水线（本链路核心增量）

#### 5.7.1 SentenceSplitter 切分规则

1. 主边界集：`。！？；!?;\n`；次边界（凑不够主边界时兜底）：逗号 + 距上句 ≥30 字。
2. **保护区间不切分**：行内公式 `$...$`、代码块围栏、Markdown 表格行——采用"先标记保护区，再找边界"两遍扫描。
3. 幼儿场景：句长上限 25 字，超长句在逗号处强制切分（儿童短时记忆约束，《幼儿语音安全引擎》适龄原则）。
4. LaTeX 公式句处理：整句以公式为主时，TTS 文本走"公式朗读文本化"预处理（如 `\frac{a}{b}` → "a 分之 b"），复用《服务端-学科公式LaTeX统一解析》的朗读序列输出。

#### 5.7.2 流水线并行模型

```text
LLM SSE ──delta──> [SentenceBuffer] ──完整句──> [安全过滤(句级)] ──> [TTS 合成池]
                        │                            │                    │
                        │                      拦截句：替换文案            │ 并发=2（幼儿=1）
                        ▼                                                 ▼
                   llm_delta 下屏                                    sentence_ready + tts_audio
```

- TTS 合成池每会话并发 2（供应商配额保护），队列上限 8 句；
- **背压联动**：队列满 → 暂停消费 LLM SSE（底层 HTTP chunk 缓冲），队列回落至 ≤4 → 恢复；LLM 上游单轮总缓冲上限 64KB 文本，超限主动截断生成（`error 52313 partial_truncated`，已生成部分正常播报）；
- 首句加速：首个完整句到达即插队合成（池内优先级 = 首句 > 后续）。

#### 5.7.3 语音场景 Prompt 约束

`X-Channel: voice` 时场景模板强制注入输出约束：口语化短句（初中/高中 ≤40 字/句）、少用长公式（必要时说"看屏幕上的式子"）、分点用"第一、第二"而非项目符号。模板版本管理走《服务端-Prompt版本管理与效果回归评估引擎》。

#### 5.7.4 语音场景答案管控

对接《答案管控与渐进式提示引擎》：
- 默认轮次播放"思路提示层"语音；屏幕可展开完整分步；
- 学生语音说"直接告诉我答案"/路由判定强索答时，按学段策略执行（高中可释放答案层，小学默认仍提示层 + 引导语），状态同步至答案管控会话，保证同一轮次文字端与语音端**管控层级一致**。

#### 5.7.5 句子级安全过滤

每句 TTS 合成前过《大模型流式输出实时安全过滤中间件》：拦截句替换为安全话术后再合成（不等整段完成，句级天然契合流式过滤）。

### 5.8 步骤⑧：播放、打断与竞态裁决

#### 5.8.1 客户端播放

音频块按 `(turn_no, seq, index)` 顺序进入播放队列；`sentence_ready` 同时携带文字，实现"文字先行、语音跟随"。播放完成发送尽力而为的 `played_ack`。

#### 5.8.2 打断触发

用户说话（客户端 VAD 能量阈值）或点击停止 → 客户端立即本地静音，发送 `interrupt {turn_no, last_played_seq}`。**不等服务端确认即恢复采集**（语音交互自然性优先，服务端裁决只影响计费与上下文）。

#### 5.8.3 服务端取消传播与在途帧裁决

```python
# voice-orchestrator/interrupt_handler.py（关键伪代码）
async def on_interrupt(self, turn: TurnCtx, last_played_seq: int):
    # 1) 取消 LLM 上游（停止 SSE 拉取，传播 cancel 给 AI 编排，未完成 token 不再产生）
    await turn.llm_task.cancel_propagate()
    # 2) 清空 TTS 队列：未开始合成的句子直接取消；
    #    合成中的句子记录 cancelled（已耗字符仍计费）
    cancelled = self.tts_pool.drain(turn)
    # 3) 在途帧裁决：seq <= last_played_seq 的 tts_audio 视为已播（保留上下文）；
    #    seq > last_played_seq 的在途/已缓存帧，标记 drop_after_send（客户端按 seq 丢弃）
    # 4) 上下文截断：对话历史仅保留 seq <= last_played_seq 的句子文本（句边界对齐），
    #    打断处插入标记 [用户在此时打断]，供下一轮 LLM 感知"学生没听完"
    turn.history.truncate_at_sentence(last_played_seq)
    await self.ws.send({"type": "interrupt_ack", "turn_no": turn.no,
                        "cancelled_sentences": cancelled,
                        "context_kept_seq": last_played_seq})
    # 5) 状态回 LISTENING（服务端 VAD 重新武装，300ms 防回声盲区）
    self.session.to_state("LISTENING", guard_echo_blind_ms=300)
```

竞态场景：`interrupt` 与某句 `tts_audio` 同时在途 → 以帧内 `seq` 与 `last_played_seq` 比较裁决（客户端与服务端同一规则，幂等）；重复 `interrupt` 幂等（第二次直接回 `interrupt_ack` 同值）。

#### 5.8.4 打断后的上下文处理

与《客户端-AI语音对话》§7.3 对齐并服务端化：保留已播句子 + `[打断标记]`，下一轮 prompt 组装时注入"上一段讲解在句 N 后被打断，学生可能想换角度问或觉得太长"提示，支撑"讲简单点"类即时纠偏。

### 5.9 步骤⑨（异常路径主线）：断线重连续传

1. WS 断开 → 服务端保留会话运行态 30s（`vds:resume:{id}`），状态转 `RESUMING`；若断开时正在合成，流水线**继续跑完当前句后暂停**（避免重连后从头重算）。
2. 客户端新 WS 连接首帧 `resume {resume_token}`：
   - 校验通过 → 下发 `session_open(resumed=true)` + `resume_replay`：重发客户端缺口的 `sentence_ready` 文本与音频（音频优先从对象存储补拉 URL，超出滚动缓冲的句子仅补文本并提示"该句语音已过期"）；
   - 超时/凭证失效 → `error(52302 resume_expired)`，客户端凭会话 ID 走 HTTP 拉取已落库文字（语音不恢复）。
3. 幂等保证：所有下行帧带 `(turn_no, seq, index)`，客户端去重。

### 5.10 步骤⑩：计费核扣与归档

1. 每轮结束（含打断轮、安全拦截轮）写一条 `voice_usage_event`（Outbox 模式，《服务端-分布式事务补偿》实践）：
   - `asr_seconds`：端点判定后的实际音频时长（静音抑制部分不计）；
   - `llm_tokens`：LLM 编排侧回执（打断时按已生成部分计）；
   - `tts_chars`：**已合成**字符（cancelled_sentences 中已开始合成的计入，未开始的 0）——与 §5.8.3 口径一致。
2. 额度中心定时（5s 批量）消费事件核扣；连续失败 3 次标记 `FAILED` 进人工对账报表（豁免场景如安全拦截轮的 LLM/TTS 计 0，仅 asr）。
3. 归档：转写文本、回复文本、打断点落 `voice_dialog_turn` + AI 对话历史；**音频不持久化**（§10.1）；会话结束下发 `session_end`（含总用量），关闭 WS，清理 Redis。

---

## 6. 时序图

### 6.1 正常链路（含流水线并行）

```text
Client          WsGateway      Orchestrator     ASR适配      AI编排SSE     TTS池
  │ audio_chunk ──>│               │              │             │            │
  │<─ asr_partial ─│<──────────────│<─ partial ───│             │            │
  │ (VAD尾点)      │──commit/自动──>│              │             │            │
  │<─ asr_final ──│<──────────────│<─ final ─────│             │            │
  │                │               ├── 安全+路由 ───────────────>│            │
  │<─ reply_started/safety? ───────│              │             │            │
  │<─ llm_delta ──│<──────────────│<────────── delta ──────────│            │
  │                │               ├─ 句1完整 ── 句级安全 ───────────────────>│ 合成句1
  │<─ sentence_ready(seq=1) ───────│              │          audio ─────────>│
  │<─ tts_audio(1) ─│<─────────────│<───────────────────────────────────────│
  │ (播放句1，文字已先行)           ├─ 句2、句3… 流水线继续                    │
  │<─ …tts_turn_end / usage / session_end …                                   │
```

### 6.2 打断链路

```text
Client                      Server
  │ (用户在句6播放中说新话)      │
  │ 本地立即静音+恢复采集        │
  │── interrupt(last=6) ─────>│ cancel LLM / drain TTS / 在途帧按seq丢弃
  │<── interrupt_ack ─────────│
  │── audio_chunk(新问题) ───>│ 状态回 LISTENING
```

### 6.3 断线重连链路

```text
Client                Server                        OSS
  │ ✖ WS断(网络切换)    │ 保留运行态30s，流水线跑完当前句暂停
  │── 新WS + resume ───>│ 校验token
  │<─ session_open(resumed) + 缺口sentence_ready ──│
  │<─ 补拉URL(整句音频) ─│──────────────────────────>│ GET voice-tts/…
```

---

## 7. API 接口设计（HTTP 部分）

| 接口 | 方法 | 说明 |
|------|------|------|
| `/v1/voice/sessions` | POST | 创建会话并协商参数（§5.1），幂等键 `Idempotency-Key` |
| `/v1/voice/sessions/{id}/stream` | WSS | 双工帧通道（§4.3），一次性票据鉴权 |
| `/v1/voice/sessions/{id}/interrupt` | POST | HTTP 兜底打断（WS 已断时），body `{turn_no,last_played_seq}` |
| `/v1/voice/sessions/{id}` | GET | 会话详情（重连失效后的文字恢复） |
| `/v1/voice/usage/today` | GET | 当日语音用量（会话数/秒数/剩余额度），家长端复用 |

WS 帧协议见 §4.3；鉴权、限流复用《API网关与通用接口规范》《服务端-统一限流熔断与流量防护体系》（语音会话建立接口按用户维度 10 QPM，WS 并发会话数按会员等级 1/2/3）。

## 8. 状态机（会话全局）

```text
IDLE ──建立──> CONNECTING ──open──> LISTENING ──端点判定──> PROCESSING
                                   ▲                        │ asr_final+路由完成
                                   │                        ▼
                                   └──interrupt_ack── RESPONDING(LLM+TTS流水线)
LISTENING <──safety_blocked/空结果── PROCESSING                  │
                                   │                              │ tts_turn_end
CONNECTING/任意态 ──WS断──> RESUMING ──resume ok──> (回到断开前状态)  │
RESUMING ──30s超时──> CLOSED(文字恢复)                            ▼
RESPONDING ──额度耗尽/致命error──> CLOSING ──session_end──> CLOSED
LISTENING ──闲置15min──> CLOSING
```

### 8.1 守卫表（节选）

| 源状态 | 事件 | 目标 | 守卫/动作 |
|--------|------|------|----------|
| LISTENING | 服务端 VAD 尾点 / commit / max 时长 | PROCESSING | 三源幂等；写 audio_meta |
| PROCESSING | safety_blocked | LISTENING | 记 usage（仅 asr）；不建 AI 消息 |
| PROCESSING | asr 空结果/低置信 | LISTENING | `error 52305`，本轮作废不计数（防误触耗额度） |
| RESPONDING | interrupt | LISTENING | §5.8.3 取消传播；300ms 回声盲区 |
| RESPONDING | tts_turn_end | LISTENING | 写 turn 终态 + usage 帧 |
| 任意 | WS close | RESUMING | 保留 30s；流水线完成当前句暂停 |
| RESUMING | resume ok | 断开前状态 | 重放缺口帧（seq 去重） |
| RESUMING | 超时/token 失效 | CLOSED | `error 52302`；HTTP 文字恢复路径 |

## 9. 异常处理与补偿矩阵

| # | 故障点 | 现象 | 处理策略 | 用户感知 |
|---|--------|------|---------|---------|
| 1 | ASR 供应商 A 超时 | 无 asr_partial | 降级链 A→B→C（《语音服务》§5.3）；全挂 → `error 52311` | "语音识别开小差了"，引导文字输入 |
| 2 | ASR 结果空/全噪声 | asr_final 空 | `error 52305`，不计额度 | "没听清，再说一次试试" |
| 3 | 输入安全拦截 | 敏感/非学习内容 | `safety_blocked`，仅计 asr 秒 | 温和引导话术 |
| 4 | LLM 上游失败（首 token 前） | 无 llm_delta | 重试 1 次（《AI辅导全链路》重试策略）；再失败 `error 52314` | "AI 暂时没答上来"，可重问 |
| 5 | LLM 中途失败 | 已播 N 句后断流 | 已生成部分正常结束本轮（`tts_turn_end` + `error partial 52313`），计已耗用量 | 播报中断提示，文字保留已生成部分 |
| 6 | TTS 供应商失败 | 无 tts_audio | 自动降级音色/供应商；仍失败 → 纯文字模式（llm_delta 持续），`error 52312 recoverable=true` | "语音播报暂不可用，文字已显示" |
| 7 | 客户端播放设备占用/蓝牙切换 | 播放中断 | 客户端本地暂停+resume 播放队列；WS 不受影响 | 播放状态条提示 |
| 8 | WS 断线 | 帧中断 | §5.9 续传；30s 窗口 | 顶部"重连中"，恢复后无感续播 |
| 9 | 打断与播放在途竞态 | 边播边打断 | seq 裁决，客户端丢 `seq>last_played` 帧 | 无 |
| 10 | 重复 commit/中断风暴 | 乱序帧 | 会话级串行处理（每会话单事件循环），幂等 | 无 |
| 11 | 额度耗尽（会话中） | 核扣失败/门槛拒绝 | 当前轮播完 → `session_end(quota_exhausted)`；usage 事件 FAILED 进对账 | "今日语音次数用完了"，展示升级入口（合规文案，非焦虑式） |
| 12 | 服务端过载 | WS 建连 429 | 网关限流+排队（《大模型推理请求队列调度》联动） | 排队提示或引导文字 |

链路级错误码段（新增 **52300-52399**，注册入《服务端-统一业务异常码与错误分类体系》；兼容映射旧字符串码，如 `VOICE_LIMIT_EXCEEDED`→52310）：

| 码 | 含义 | | 码 | 含义 |
|----|------|-|----|------|
| 52301 | 会话闲置超时 | | 52308 | 音频格式不支持 |
| 52302 | 续传窗口过期/凭证失效 | | 52310 | 当日语音额度耗尽（=VOICE_LIMIT_EXCEEDED） |
| 52303 | 输入安全拦截 | | 52311 | ASR 全供应商不可用 |
| 52304 | 录音时长超限熔断 | | 52312 | TTS 不可用（可恢复，转文字） |
| 52305 | 未识别到有效语音 | | 52313 | 生成中途截断（部分成功） |
| 52306 | 票据鉴权失败 | | 52314 | LLM 生成失败（重试后） |
| 52307 | 会话不存在/已关闭 | | 52315 | 背压缓冲溢出主动截断 |

## 10. 安全与合规

### 10.1 未成年人语音数据处理（本链路红线）

1. **音频默认不持久化**：仅内存滚动缓冲与续传缓存（TTL 120s/30s）；S3 类对象仅降级补拉用，2 小时生命周期自动删除。
2. **评测场景例外**：发音评测（S3）按《幼儿语音安全引擎》留存策略（最长 7 天，用于复听申诉），与本链路隔离。
3. **声纹不落库**：儿童声纹检测仅做实时路由判别，不存储声纹模板、不用于身份识别或跨会话追踪（对齐《未成年人数据隐私合规自动化》最小必要原则）。
4. **转写文本**随 AI 对话历史存储（服务既有加密与脱敏策略），家长导出/删除请求走既有数据主体权利流程。
5. 语音输入内容安全双闸：ASR 文本（输入护栏）+ TTS 前句级过滤（输出中间件）。

### 10.2 防滥用与儿童限额

- 免费用户每日语音轮次限额（与会员分级），儿童叠加《幼儿语音安全引擎》儿童语音日限额（5.4 接口）；
- 会话级频控：单会话 60 轮/日封顶；连续 3 轮 `safety_blocked` 触发风控事件（《统一风控决策中心》）；
- 语音接口计入设备指纹维度限流，防脚本刷量（《设备指纹与反作弊风控引擎》）。

## 11. 埋点与监控

| 事件 | 关键属性 | 用途 |
|------|---------|------|
| `voice_session_start/end` | grade_stage, limit_type, end_reason, totals | 会话漏斗、完成率 |
| `voice_turn_commit` | turn_no, asr_seconds, client_edited | 轮次量、ASR 纠错率（质量归因） |
| `voice_asr_latency` | partial_first_ms, final_ms | ASR 供应商 SLO |
| `voice_first_audio_latency` | llm_first_token_ms, tts_first_audio_ms | §1.3 核心指标 |
| `voice_interrupt` | last_played_seq, cancelled_sentences, at_sentence_pct | 讲解冗长预警（打断集中在句 1-2 → prompt 约束回归） |
| `voice_fallback` | from(链路段), to(降级档), reason | 降级率按供应商聚合 |
| `voice_resume` | gap_ms, replay_sentences, success | 续传成功率 |

监控面板复用《日志与监控告警体系》：告警项——52311/52312 比例 >2%（5min）、first_audio P90 >4s、interrupt_ack 延迟 P90 >500ms、usage FAILED 积压 >100。

## 12. 容量估算（参考《非功能性需求-性能优化与容量规划》基线）

- 假设 DAU 50 万，语音功能渗透 12%，人均 1.4 会话/日、6 轮/会话 → 日会话 8.4 万、轮次 50 万。
- 并发语音会话（晚高峰系数 0.08）：≈ 6.7k 会话；每会话带宽：上行 ≤24kbps（语音活动占比 ~40% 实际 ~10kbps）、下行 TTS 24kbps（RESPONDING 占比 ~35%）。
- TTS 合成 QPS：轮次 50 万 × 平均 8 句，集中在 4h → ~2.8 句/s × 高峰系数 ≈ 90 句/s（供应商配额与池并发 2/会话校准）。
- Orchestrator 内存：句缓冲 64KB×并发轮 + 音频滚动缓冲 512KB×活跃 RESPONDING 会话 ≈ 高峰 ~2.5GB（单实例 8GB×N，按 K8s HPA 扩缩，复用《服务端-教育平台弹性伸缩》）。
- Redis：会话运行态 ~2KB×6.7k ≈ 14MB + 句缓存，单分片充足。

## 13. 与组件文档的职责边界（防重复建设）

| 关注点 | 归属文档 | 本文提供 |
|--------|---------|---------|
| ASR/TTS 供应商适配、降级链、发音评测 | 《语音服务(ASR-TTS)》 | 调用时机与编排语义 |
| 客户端 VAD/采集/播放器/打断 UI | 《客户端-AI语音对话实时交互…》 | 服务端对等协议与裁决规则 |
| 页面/组件/可视化 | 《客户端-语音交互页面架构…》 | 组件状态对接（帧→组件映射） |
| 儿童 ASR 模型路由/声纹/儿童限额 | 《幼儿端儿童语音识别适配…》 | 路由触发点（建连协商+轮次） |
| LLM 生成编排/Prompt/上下文 | 《AI辅导全链路…》《AI-Prompt编排…》 | 语音渠道约束（X-Channel: voice）与打断截断注入 |
| 输入/输出安全 | 《AI输入安全护栏》《流式安全过滤中间件》 | 触发位置（轮次首/句级） |
| 额度与门控 | 《用户额度管控与功能门控引擎》 | usage 事件口径与 Outbox |

## 14. 验收场景（关键 15 条）

| # | 场景 | 预期 |
|---|------|------|
| 1 | 正常语音问答（初中数学） | asr_partial 实时回显；文字先于语音；首音频 ≤3s（P90 抽检） |
| 2 | 按住说话 vs VAD 自动断句 | 两种提交源均正确触发；重复触发被幂等 |
| 3 | ASR 文本手动修正 | 修正帧上报 client_edited=1；LLM 使用修正后文本 |
| 4 | 60s 长语音 | max_utterance 熔断，truncated=true，引导拆分提问 |
| 5 | 幼儿短句+长停顿 | tail_silence 1200ms 不误断；音色/句长约束生效 |
| 6 | 含 LaTeX 公式回答 | 公式句不被切断；TTS 朗读文本化正确 |
| 7 | 播放中语音打断 | 本地 300ms 内静音；服务端停发；interrupt_ack 一致；下轮上下文含打断标记 |
| 8 | 打断与在途音频竞态 | seq>last_played 帧被客户端丢弃；无重复播放 |
| 9 | WiFi↔蜂窝切换 | 30s 内重连成功；缺口句无重复无丢失；音频补拉可用 |
| 10 | 续传窗口过期 | 52302 后 HTTP 恢复文字历史 |
| 11 | TTS 供应商全挂 | 文字模式继续；52312 recoverable；轮次仍完成 |
| 12 | 输入安全拦截 | safety_blocked 话术；额度仅扣 asr 秒 |
| 13 | 额度耗尽 | 当前轮播完再结束；session_end(quota_exhausted)；FAILED 对账可见 |
| 14 | 小学生索要直接答案 | 答案管控层级与文字端一致（提示层优先） |
| 15 | 音频不留存抽检 | 会话结束 2h 后 OSS 无残留对象；DB 无音频二进制 |

## 15. 版本历史

| 版本 | 日期 | 变更说明 |
|------|------|---------|
| v1.0 | 2026-08-15 | 初版：正式定义服务端联合流式协议（帧结构/编排器模块）、打断取消传播与 seq 竞态裁决、断线 30s 续传协议、三重用量计费 Outbox 口径、未成年人语音不留存红线、状态机与守卫表、异常矩阵（52300-52399 错误码段）、容量估算与 15 条验收场景 |
