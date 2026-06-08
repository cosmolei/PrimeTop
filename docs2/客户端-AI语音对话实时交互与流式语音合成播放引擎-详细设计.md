# 客户端-AI语音对话实时交互与流式语音合成播放引擎 - 详细设计

## 1. 模块概述

### 1.1 功能定位

本模块负责客户端侧 AI 语音对话的完整实时交互链路，包括语音采集与活动检测（VAD）、流式语音识别（ASR）、AI 响应流式接收、流式语音合成（TTS）播放、语音打断处理、音频可视化与对话状态管理。

本模块是"语音提问"（P1 功能）和"AI 语音陪练"（P2 功能）的核心客户端引擎，与以下模块协同工作：

| 协同模块 | 职责边界 |
|----------|----------|
| `语音服务(ASR-TTS)` | 服务端 ASR/TTS 接口定义与调度 |
| `客户端-语音交互页面` | 语音对话页面的 UI 布局与交互设计 |
| `SSE流式响应与AI增量渲染引擎` | SSE 连接管理与增量文本渲染 |
| `AI对话引擎与会话管理` | AI 对话会话上下文管理 |
| `客户端-Flutter平台通道与原生能力桥接层` | 原生音频能力调用 |

### 1.2 设计目标

1. **低延迟体验**：从用户停止说话到 AI 语音播报首字 < 2 秒
2. **流式体验**：边收文本边合成语音边播放，用户无需等待完整回答
3. **自然交互**：支持用户随时打断 AI 播报，实现类真人对话体验
4. **多场景适配**：支持 AI 辅导语音问答、口语陪练、背诵检测等场景
5. **弱网容错**：在网络波动时提供降级体验（文本优先、语音缓冲）
6. **分龄适配**：根据学段提供不同的语音交互模式（幼儿高互动、高中高效）

---

## 2. 整体架构

### 2.1 模块架构图

```
┌─────────────────────────────────────────────────────────────┐
│                     VoiceConversationPage                     │
│                   (语音对话页面 - UI 层)                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐  ┌──────────────────────────────────┐  │
│  │  AudioVisualizer  │  │  VoiceConversationController     │  │
│  │  (音频可视化)      │  │  (语音对话状态机 & 业务编排)      │  │
│  └──────────────────┘  └──────────┬───────────────────────┘  │
│                                    │                          │
│  ┌─────────────────────────────────┼──────────────────────┐  │
│  │         VoiceConversationEngine (核心引擎)              │  │
│  │                           │                            │  │
│  │  ┌────────────┐  ┌───────┴───────┐  ┌──────────────┐  │  │
│  │  │ VoiceInput  │  │  AIGateway    │  │ VoiceOutput  │  │  │
│  │  │ Controller  │  │  (AI 响应     │  │ Controller   │  │  │
│  │  │ (语音采集 & │  │   流式网关)   │  │ (流式TTS &   │  │  │
│  │  │  VAD)       │  │               │  │  播放控制)   │  │  │
│  │  └──────┬─────┘  └───────┬───────┘  └──────┬───────┘  │  │
│  │         │                │                   │          │  │
│  │  ┌──────┴─────┐  ┌──────┴───────┐  ┌───────┴──────┐   │  │
│  │  │ AudioCapture│  │ SSEClient    │  │ AudioPlayer  │   │  │
│  │  │ Service    │  │ (SSE连接管理) │  │ (音频播放器)  │   │  │
│  │  └────────────┘  └──────────────┘  └──────────────┘   │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           Native Audio Bridge (平台通道)               │   │
│  │   Android: AudioRecord / MediaPlayer / ExoPlayer      │   │
│  │   iOS: AVAudioEngine / AVAudioSession / AVPlayer      │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件职责

| 组件 | 职责 | 关键技术 |
|------|------|----------|
| **VoiceConversationEngine** | 核心引擎，协调语音输入、AI 响应、语音输出三大子系统的状态流转 | 状态机、事件总线 |
| **VoiceInputController** | 管理麦克风采集、VAD 检测、流式 ASR 发送 | WebRTC VAD、Opus 编码 |
| **VoiceOutputController** | 管理流式 TTS 请求、音频缓冲队列、播放控制 | 音频队列、环形缓冲区 |
| **AudioCaptureService** | 底层音频采集服务，提供 PCM 数据流 | 平台通道、AudioRecord/AVAudioEngine |
| **AudioPlayer** | 底层音频播放器，支持流式解码和播放 | ExoPlayer/AVAudioPlayer |
| **AudioVisualizer** | 音频波形和音量可视化 | Canvas/Skia 绘制 |

---

## 3. 语音对话状态机

### 3.1 主状态定义

```
┌──────────┐   startConversation    ┌──────────────┐
│   IDLE   │ ──────────────────────> │   LISTENING   │
│  (空闲)   │ <────────────────────── │  (监听中)     │
└──────────┘   userCancel / timeout  └──────┬───────┘
      ▲                                  │
      │                          vadSpeechDetected
      │                                  │
      │                                  ▼
      │                          ┌──────────────┐
      │                          │  RECORDING    │
      │                          │  (录音中)     │
      │                          └──────┬───────┘
      │                                 │
      │                      vadSilenceTimeout (1.5s)
      │                                 │
      │                                 ▼
      │                          ┌──────────────┐
      │                          │  PROCESSING   │
      │                          │ (ASR处理中)   │
      │                          └──────┬───────┘
      │                                 │
      │                         asrComplete + sendToAI
      │                                 │
      │                                 ▼
      │                          ┌──────────────┐
      │                          │ AI_THINKING   │
      │                          │ (AI思考中)    │
      │                          └──────┬───────┘
      │                                 │
      │                        sseFirstToken / ttsFirstChunk
      │                                 │
      │                                 ▼
      │                          ┌──────────────┐
      │    userInterrupt         │  SPEAKING     │
      │ ┌────────────────────────│ (AI播报中)    │
      │ │                        └──────┬───────┘
      │ │                               │
      │ │                    ttsComplete / responseEnd
      │ │                               │
      │ ▼                               ▼
      │                          ┌──────────────┐
      │                          │  PAUSED       │
      │                          │ (等待用户输入) │
      │                          └──────┬───────┘
      │                                 │
      │                    userResume / autoTimeout
      │                                 │
      └─────────────────────────────────┘
```

### 3.2 状态枚举定义

```dart
/// 语音对话主状态
enum VoiceConversationState {
  /// 空闲状态，等待用户触发
  idle,

  /// 监听中，等待语音输入（VAD待激活）
  listening,

  /// 正在录音，检测到用户说话
  recording,

  /// 录音结束，ASR 正在处理
  processing,

  /// ASR 完成，等待 AI 首个 token
  aiThinking,

  /// AI 正在播报语音
  speaking,

  /// 播报结束，等待用户继续对话
  paused,

  /// 错误状态
  error,
}

/// 语音对话子状态（提供更精细的 UI 反馈）
enum VoiceConversationSubState {
  /// 无子状态
  none,

  /// 正在连接服务
  connecting,

  /// VAD 静音检测中（录音已开始但未检测到语音）
  silenceDetecting,

  /// 流式 ASR 识别中（部分结果已返回）
  asrPartialResult,

  /// TTS 首包加载中
  ttsBuffering,

  /// 网络缓冲中
  networkBuffering,

  /// 语音被打断
  interrupted,

  /// 重连中
  reconnecting,
}
```

### 3.3 状态流转规则

| 当前状态 | 触发事件 | 目标状态 | 条件 |
|----------|----------|----------|------|
| idle | userStart | listening | 麦克风权限已授权 |
| listening | vadSpeechDetected | recording | 音量超过阈值 > 300ms |
| listening | silenceTimeout (5s) | idle | 未检测到语音 |
| listening | userCancel | idle | 用户主动取消 |
| recording | vadSilenceTimeout (1.5s) | processing | 静音持续 1.5 秒 |
| recording | maxRecordingTimeout (60s) | processing | 录音达到最大时长 |
| recording | userStop | processing | 用户手动停止 |
| processing | asrComplete | aiThinking | ASR 返回最终文本 |
| processing | asrEmpty | listening | ASR 未识别到有效内容 |
| aiThinking | sseFirstToken | speaking | 首个文本 token 到达 |
| aiThinking | aiTimeout (15s) | error | AI 无响应超时 |
| speaking | userInterrupt | listening | 用户打断，停止播报 |
| speaking | ttsComplete | paused | TTS 播报完成 |
| speaking | ttsError | paused | TTS 出错，降级为文本 |
| paused | userResume | listening | 用户继续说话 |
| paused | autoPauseTimeout (30s) | idle | 无操作超时 |
| error | retry | listening | 用户重试 |

---

## 4. 语音输入子系统 (VoiceInputController)

### 4.1 音频采集配置

```dart
/// 音频采集配置
class AudioCaptureConfig {
  /// 采样率
  static const int sampleRate = 16000;

  /// 声道数
  static const int channels = 1;

  /// 位深度（PCM 16-bit）
  static const int bitsPerSample = 16;

  /// 每帧采样数（20ms 帧）
  static const int frameSize = 320; // 16000 * 0.02

  /// 缓冲区大小（帧数）
  static const int bufferFrames = 5; // 100ms 缓冲

  /// 最大录音时长（秒）
  static const int maxRecordingDurationSec = 60;

  /// 音频格式
  static const AudioFormat format = AudioFormat.pcm16bit;
}
```

### 4.2 VAD（语音活动检测）实现

采用 WebRTC VAD 算法的原生实现，通过 Flutter 平台通道调用：

```dart
/// VAD 检测器
class VoiceActivityDetector {
  /// VAD 模式（0-3，越高越激进）
  final int aggressiveness;

  /// 静音超时阈值（毫秒）
  final int silenceTimeoutMs;

  /// 语音检测触发时长（毫秒）
  final int speechTriggerMs;

  /// 最小音量阈值
  final double minVolumeThreshold;

  /// 当前 VAD 状态
  VadState _state = VadState.silence;

  /// 连续语音帧计数
  int _speechFrameCount = 0;

  /// 连续静音帧计数
  int _silenceFrameCount = 0;

  /// 处理单帧音频数据
  /// 返回当前 VAD 状态
  VadResult processFrame(Uint8List pcmFrame) {
    // 通过平台通道调用原生 VAD
    final isSpeech = _nativeVad.process(pcmFrame);

    if (isSpeech) {
      _speechFrameCount++;
      _silenceFrameCount = 0;
    } else {
      _silenceFrameCount++;
      _speechFrameCount = 0;
    }

    // 状态转换
    if (_state == VadState.silence &&
        _speechFrameCount * 20 >= speechTriggerMs) {
      _state = VadState.speech;
      return VadResult(state: VadState.speech, event: 'speech_start');
    } else if (_state == VadState.speech &&
               _silenceFrameCount * 20 >= silenceTimeoutMs) {
      _state = VadState.silence;
      return VadResult(state: VadState.silence, event: 'speech_end');
    }

    return VadResult(state: _state, event: null);
  }
}

enum VadState { speech, silence }

class VadResult {
  final VadState state;
  final String? event;
}
```

### 4.3 分龄 VAD 参数配置

| 学段 | aggressiveness | silenceTimeoutMs | speechTriggerMs | minVolumeThreshold |
|------|---------------|------------------|-----------------|-------------------|
| 幼儿 | 1 (宽松) | 2500 | 300 | 0.01 |
| 小学 | 2 (中等) | 2000 | 250 | 0.015 |
| 初中 | 2 (中等) | 1500 | 200 | 0.015 |
| 高中 | 3 (激进) | 1200 | 150 | 0.02 |

> **说明**：幼儿说话速度慢、停顿多，需要更宽松的静音检测和更长的触发时长，避免过早截断。

### 4.4 流式 ASR 交互协议

采用 WebSocket 协议与服务端 ASR 通信，支持边录边传边识别：

```
┌─────────┐                          ┌─────────┐
│ Client  │                          │ Server  │
└────┬────┘                          └────┬────┘
     │  1. WS Connect (wss://...)         │
     │ ──────────────────────────────────>│
     │  2. WS Connected + Config          │
     │ <──────────────────────────────────│
     │                                    │
     │  3. Audio Chunk (PCM, 100ms)       │
     │ ──────────────────────────────────>│
     │  4. ASR Partial Result             │
     │ <──────────────────────────────────│
     │  5. Audio Chunk                    │
     │ ──────────────────────────────────>│
     │  6. ASR Partial Result             │
     │ <──────────────────────────────────│
     │  ...                               │
     │  7. Audio End Signal               │
     │ ──────────────────────────────────>│
     │  8. ASR Final Result               │
     │ <──────────────────────────────────│
     │                                    │
     │  9. WS Close                       │
     │ <─────────────────────────────────>│
```

#### ASR WebSocket 消息格式

```json
// 客户端 → 服务端：音频数据
{
  "type": "audio",
  "data": "<base64-encoded PCM chunk>",
  "sequence": 42,
  "timestamp": 1717862400000
}

// 客户端 → 服务端：结束信号
{
  "type": "end",
  "sequence": 86
}

// 服务端 → 客户端：部分识别结果
{
  "type": "partial",
  "text": "二次函数的",
  "sequence": 42,
  "confidence": 0.85,
  "timestamp": 1717862405000
}

// 服务端 → 客户端：最终识别结果
{
  "type": "final",
  "text": "二次函数的顶点坐标怎么求？",
  "sequence": 86,
  "confidence": 0.96,
  "duration_ms": 3200,
  "language": "zh-CN",
  "timestamp": 1717862408000
}

// 服务端 → 客户端：错误
{
  "type": "error",
  "code": "ASR_TIMEOUT",
  "message": "识别超时"
}
```

---

## 5. AI 响应流式网关 (AIGateway)

### 5.1 流式对话请求

在 ASR 返回最终文本后，通过 SSE 接口发送 AI 对话请求，同时接收流式响应：

```dart
/// AI 流式网关
class AIGateway {
  /// 发送对话请求并获取流式响应
  ///
  /// 同时启动 TTS 流式合成管道（见第6节）
  Stream<AiResponseChunk> sendVoiceConversation({
    required String sessionId,
    required String userMessage,
    required String studentGrade,
    required String subject,
    String? textbookVersion,
    String? chapterId,
    List<ChatMessage>? history,
  }) async* {
    final request = VoiceConversationRequest(
      sessionId: sessionId,
      message: userMessage,
      studentProfile: StudentProfile(
        grade: studentGrade,
        subject: subject,
        textbookVersion: textbookVersion,
      ),
      context: ConversationContext(
        chapterId: chapterId,
        history: history?.takeLast(10), // 最近 10 轮对话
      ),
      responseMode: ResponseMode.streamingTextAndTts,
      ttsConfig: TtsConfig(
        voiceId: _getVoiceForGrade(studentGrade),
        speed: _getSpeedForGrade(studentGrade),
        sampleRate: 24000,
        format: AudioFormat.mp3,
      ),
    );

    // SSE 连接
    final sseStream = _sseClient.connect(
      url: '/api/v1/ai/voice-conversation',
      body: request.toJson(),
      headers: {
        'Authorization': 'Bearer ${_authService.currentToken}',
        'X-Session-Id': sessionId,
      },
    );

    await for (final event in sseStream) {
      switch (event.type) {
        case 'text_delta':
          yield AiResponseChunk.text(event.data['content']);
          break;
        case 'tts_audio':
          yield AiResponseChunk.audio(
            audioData: base64Decode(event.data['audio']),
            sequence: event.data['sequence'],
          );
          break;
        case 'tts_start':
          yield AiResponseChunk.ttsStart();
          break;
        case 'tts_end':
          yield AiResponseChunk.ttsEnd();
          break;
        case 'knowledge_point':
          yield AiResponseChunk.knowledgePoint(event.data);
          break;
        case 'done':
          yield AiResponseChunk.done();
          break;
        case 'error':
          yield AiResponseChunk.error(
            code: event.data['code'],
            message: event.data['message'],
          );
          break;
      }
    }
  }
}
```

### 5.2 SSE 事件类型定义

| 事件类型 | 说明 | 数据结构 |
|----------|------|----------|
| `text_delta` | AI 响应文本增量 | `{ content, sequence }` |
| `tts_start` | TTS 音频开始 | `{ voiceId, sampleRate }` |
| `tts_audio` | TTS 音频数据块（base64） | `{ audio, sequence, isFinal }` |
| `tts_end` | TTS 音频结束 | `{ totalDuration }` |
| `knowledge_point` | 关联知识点 | `{ pointId, name, chapterId }` |
| `done` | 响应完成 | `{ totalTokens, duration }` |
| `error` | 错误 | `{ code, message }` |

### 5.3 服务端联合流式设计（参考）

服务端在收到语音对话请求时，**并行执行**文本生成和 TTS 合成：

```
Client SSE Request
        │
        ▼
┌───────────────────┐
│  AI 对话服务       │
│  (LLM 流式生成)    │
└────────┬──────────┘
         │ text_delta (增量文本)
         │
    ┌────┴─────┐
    │          │
    ▼          ▼
┌────────┐  ┌─────────────┐
│ SSE 发送│  │ TTS 流式合成 │
│ 文本块  │  │ (句子级拆分)  │
└────────┘  └──────┬──────┘
    │              │ tts_audio
    │              ▼
    │         ┌─────────┐
    │         │ SSE 发送 │
    │         │ 音频块   │
    │         └─────────┘
    │              │
    └──────┬───────┘
           ▼
       Client receives
```

**关键设计**：服务端按句子边界（。！？；\n）拆分 LLM 输出，每攒够一个完整句子即触发 TTS 合成，实现文本生成与语音合成的流水线并行。

---

## 6. 语音输出子系统 (VoiceOutputController)

### 6.1 流式 TTS 播放架构

```
SSE tts_audio chunks
        │
        ▼
┌──────────────────┐
│  AudioChunkQueue  │ ← 环形缓冲区，容量 10s
│  (音频块队列)     │
└────────┬─────────┘
         │ dequeue
         ▼
┌──────────────────┐
│  AudioDecoder     │ ← MP3/AAC → PCM
│  (音频解码器)     │
└────────┬─────────┘
         │ PCM data
         ▼
┌──────────────────┐
│  AudioPlayer      │ ← 流式播放 + 打断支持
│  (音频播放器)     │
└────────┬─────────┘
         │ audio session
         ▼
    Speaker Output
```

### 6.2 音频缓冲队列

```dart
/// 流式音频播放队列
class StreamAudioPlayer {
  /// 缓冲队列（最大缓冲时长：10秒）
  final _bufferQueue = StreamQueue<AudioChunk>();

  /// 当前缓冲的音频时长（毫秒）
  int _bufferedDurationMs = 0;

  /// 最大缓冲时长
  static const int _maxBufferMs = 10000;

  /// 最小播放缓冲（开始播放前需要的最小时长）
  static const int _minPlayBufferMs = 300;

  /// 是否正在播放
  bool _isPlaying = false;

  /// 是否收到结束信号
  bool _isEndOfStream = false;

  /// 添加音频块
  Future<void> enqueue(AudioChunk chunk) async {
    if (_bufferedDurationMs >= _maxBufferMs) {
      // 缓冲已满，等待消费
      await _bufferQueue.waitForSpace();
    }

    _bufferQueue.add(chunk);
    _bufferedDurationMs += chunk.durationMs;

    // 达到最小播放缓冲，开始播放
    if (!_isPlaying && _bufferedDurationMs >= _minPlayBufferMs) {
      _startPlayback();
    }
  }

  /// 标记流结束
  void markEndOfStream() {
    _isEndOfStream = true;
    // 如果缓冲不足但有数据，立即开始播放
    if (!_isPlaying && _bufferedDurationMs > 0) {
      _startPlayback();
    }
  }

  /// 用户打断 - 立即停止播放并清空缓冲
  void interrupt() {
    _isPlaying = false;
    _isEndOfStream = false;
    _bufferedDurationMs = 0;
    _bufferQueue.clear();
    _audioPlayer.stop();
  }

  /// 开始播放
  void _startPlayback() {
    _isPlaying = true;
    _playLoop();
  }

  /// 播放循环
  Future<void> _playLoop() async {
    while (_isPlaying) {
      if (_bufferQueue.isEmpty) {
        if (_isEndOfStream) {
          // 流结束且队列空，播放完成
          _isPlaying = false;
          _onPlaybackComplete();
          break;
        }
        // 等待新数据
        await _bufferQueue.waitForData();
        continue;
      }

      final chunk = await _bufferQueue.dequeue();
      _bufferedDurationMs -= chunk.durationMs;
      await _audioPlayer.playPcm(chunk.pcmData);
    }
  }
}

/// 音频块
class AudioChunk {
  /// 原始音频数据
  final Uint8List audioData;

  /// 音频格式
  final String format; // 'mp3', 'pcm'

  /// 序列号
  final int sequence;

  /// 预估时长（毫秒）
  final int durationMs;

  /// 是否为最后一个块
  final bool isFinal;
}
```

### 6.3 TTS 语音参数配置

```dart
/// TTS 语音配置
class TtsVoiceConfig {
  /// 分龄语音配置
  static TtsVoiceConfig forGrade(String grade) {
    final stage = GradeHelper.getStage(grade);
    switch (stage) {
      case StudyStage.kindergarten:
        return TtsVoiceConfig(
          voiceId: 'female_child_friendly',  // 女声，温和亲切
          speed: 0.85,                       // 略慢
          pitch: 1.1,                        // 略高
          volume: 0.9,
          pauseBetweenSentences: 600,        // 句间停顿长
        );
      case StudyStage.primary:
        return TtsVoiceConfig(
          voiceId: 'female_teacher',
          speed: 0.95,
          pitch: 1.05,
          volume: 0.9,
          pauseBetweenSentences: 400,
        );
      case StudyStage.junior:
        return TtsVoiceConfig(
          voiceId: 'female_teacher',
          speed: 1.0,
          pitch: 1.0,
          volume: 0.85,
          pauseBetweenSentences: 300,
        );
      case StudyStage.senior:
        return TtsVoiceConfig(
          voiceId: 'male_teacher',           // 可选男女声
          speed: 1.1,                        // 略快，高效
          pitch: 1.0,
          volume: 0.85,
          pauseBetweenSentences: 200,
        );
    }
  }

  final String voiceId;
  final double speed;
  final double pitch;
  final double volume;
  final int pauseBetweenSentences; // 句间停顿（ms）
}
```

---

## 7. 打断处理机制

### 7.1 打断策略

打断是语音对话体验的核心要素，支持用户在 AI 播报过程中随时开口说话：

```
AI 正在播报: "二次函数的顶点坐标可以通过公式..." 
                                       │
                            用户说话: "等等，这个公式我怎么" 
                                       │
                          ┌─────────────┴───────────────┐
                          │ 打断处理流水线                │
                          │                               │
                          │ 1. 立即停止 TTS 播放          │
                          │ 2. 清空音频缓冲队列           │
                          │ 3. 取消未完成的 TTS 请求      │
                          │ 4. 开始新的 VAD 监听          │
                          │ 5. 保留当前 AI 对话上下文     │
                          └───────────────────────────────┘
                                       │
                                       ▼
                            用户继续: "这个公式我怎么记不住"
```

### 7.2 打断检测实现

```dart
/// 打断检测器 - 在 AI 播报期间持续监听麦克风
class BargeInDetector {
  /// 背景音频参考（AI 正在播放的音频能量）
  double _referenceEnergy = 0;

  /// 是否启用回声消除
  final bool enableAec;

  /// 触发打断的能量阈值倍数
  final double bargeInThresholdMultiplier;

  /// 触发打断所需持续帧数
  final int triggerFrames;

  /// 在播放的同时开启 VAD 检测
  ///
  /// 关键技术：AEC（回声消除）+ 双麦降噪
  Stream<BargeInEvent> detectDuringPlayback(
    Stream<Uint8List> micStream,
    Stream<Uint8List> speakerStream,
  ) async* {
    int speechFrames = 0;

    await for (final micFrame in micStream) {
      final micEnergy = _calculateEnergy(micFrame);

      // 如果启用了 AEC，减去参考信号能量
      double effectiveEnergy = micEnergy;
      if (enableAec && _referenceEnergy > 0) {
        effectiveEnergy = micEnergy - _referenceEnergy * 0.7;
      }

      // 能量超过阈值
      if (effectiveEnergy > _backgroundNoiseThreshold * bargeInThresholdMultiplier) {
        speechFrames++;
        if (speechFrames >= triggerFrames) {
          yield BargeInEvent(
            type: BargeInType.confirmed,
            energy: effectiveEnergy,
            timestamp: DateTime.now(),
          );
          return; // 检测到打断后停止
        } else if (speechFrames == 1) {
          yield BargeInEvent(
            type: BargeInType.possible,
            energy: effectiveEnergy,
            timestamp: DateTime.now(),
          );
        }
      } else {
        speechFrames = 0;
      }
    }
  }

  double _calculateEnergy(Uint8List frame) {
    // 计算 RMS 能量
    int sum = 0;
    final samples = frame.length ~/ 2;
    for (int i = 0; i < samples; i++) {
      final sample = (frame[i * 2 + 1] << 8) | frame[i * 2];
      sum += sample * sample;
    }
    return sqrt(sum / samples) / 32768.0;
  }
}

enum BargeInType {
  /// 可能的打断（需继续观察）
  possible,

  /// 确认打断
  confirmed,
}
```

### 7.3 打断后的上下文处理

```dart
/// 打断后的上下文处理策略
class BargeInContextHandler {
  /// 处理打断后的对话上下文
  ///
  /// [interruptedText] - 被打断时 AI 已说的文本
  /// [newUserMessage] - 用户打断后说的新内容
  BargeInContext buildContext({
    required String interruptedText,
    required String newUserMessage,
    required List<ChatMessage> history,
  }) {
    return BargeInContext(
      // 将被打断的内容标记为不完整
      interruptedAssistantMessage: ChatMessage.assistant(
        content: interruptedText + '…',
        metadata: {'interrupted': true},
      ),
      // 新用户消息
      newUserMessage: ChatMessage.user(
        content: newUserMessage,
        metadata: {'is_barge_in': true},
      ),
      // 发给 AI 的系统提示（告知被打断上下文）
      systemHint:
        '用户在你回答过程中打断了你。你之前说到："$interruptedText…"。'
        '用户的新问题是："$newUserMessage"。请根据上下文自然地继续对话。',
    );
  }
}
```

---

## 8. 音频可视化

### 8.1 波形可视化

```dart
/// 语音波形可视化组件
class VoiceWaveformPainter extends CustomPainter {
  final List<double> amplitudes;
  final VoiceVisualizationState state;
  final Color activeColor;
  final Color inactiveColor;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..style = PaintingStyle.fill;

    final barWidth = 3.0;
    final barGap = 2.0;
    final bars = (size.width / (barWidth + barGap)).floor();
    final centerY = size.height / 2;

    for (int i = 0; i < bars; i++) {
      final index = i % amplitudes.length;
      final amplitude = amplitudes[index];

      // 根据状态决定颜色
      paint.color = _getColorForState(i, bars);

      final barHeight = amplitude * size.height * 0.8;

      final rect = RRect.fromRectAndRadius(
        Rect.fromCenter(
          center: Offset(i * (barWidth + barGap) + barWidth / 2, centerY),
          width: barWidth,
          height: barHeight.clamp(4.0, size.height * 0.9),
        ),
        Radius.circular(barWidth / 2),
      );

      canvas.drawRRect(rect, paint);
    }
  }

  Color _getColorForState(int index, int total) {
    switch (state) {
      case VoiceVisualizationState.recording:
        // 渐变色：中心亮，两边暗
        final center = total / 2;
        final distance = (index - center).abs() / center;
        return activeColor.withOpacity(1.0 - distance * 0.5);
      case VoiceVisualizationState.speaking:
        // AI 播报：蓝色系渐变
        return Color.lerp(Colors.blue, Colors.lightBlue, index / total)!;
      case VoiceVisualizationState.idle:
        return inactiveColor.withOpacity(0.3);
      case VoiceVisualizationState.thinking:
        // 思考中：呼吸动画效果
        return activeColor.withOpacity(0.3 + 0.4 * _breatheValue);
    }
  }
}
```

### 8.2 分龄可视化风格

| 学段 | 波形样式 | 配色 | 动画 |
|------|----------|------|------|
| 幼儿 | 大圆点 + 星星粒子 | 🟡 黄橙暖色系 | 弹性缩放 + 闪烁 |
| 小学 | 圆角柱状波形 | 🔵 蓝绿冷色系 | 平滑波动 |
| 初中 | 细线波形 | ⚪ 蓝灰色系 | 平稳波动 |
| 高中 | 简约频谱线 | ⚫ 深灰单色 | 极简波动 |

---

## 9. 弱网与降级策略

### 9.1 网络状态感知

```dart
/// 网络质量评估
class NetworkQualityEstimator {
  /// 评估网络质量
  NetworkQuality estimate() {
    final latency = _measureLatency();
    final bandwidth = _measureBandwidth();
    final packetLoss = _measurePacketLoss();

    if (latency < 200 && bandwidth > 500 && packetLoss < 0.01) {
      return NetworkQuality.excellent;  // 完整语音体验
    } else if (latency < 500 && bandwidth > 200 && packetLoss < 0.05) {
      return NetworkQuality.good;       // 语音 + 文本
    } else if (latency < 1500 && bandwidth > 50) {
      return NetworkQuality.poor;       // 降级为文本优先
    } else {
      return NetworkQuality.offline;    // 离线模式
    }
  }
}

enum NetworkQuality {
  excellent, // 延迟 < 200ms，带宽 > 500kbps
  good,      // 延迟 < 500ms，带宽 > 200kbps
  poor,      // 延迟 < 1500ms，带宽 > 50kbps
  offline,   // 无网络
}
```

### 9.2 降级策略矩阵

| 网络质量 | 输入方式 | AI 响应 | TTS 播放 | ASR |
|----------|----------|---------|----------|-----|
| excellent | 实时语音流式 | SSE 流式 + 并行 TTS | 流式播放 | 实时流式识别 |
| good | 实时语音流式 | SSE 流式 + 串行 TTS | 缓冲后播放 | 流式识别 |
| poor | 语音录完后发送 | SSE 流式（仅文本） | 不播放语音 | 录完后一次性识别 |
| offline | 不可用 | 本地缓存回复 | 本地 TTS | 本地 ASR（端侧） |

### 9.3 流式重连机制

```dart
/// SSE 连接断开后的重连策略
class SseReconnectStrategy {
  /// 最大重试次数
  static const int maxRetries = 3;

  /// 重试间隔（毫秒）
  static const List<int> retryDelays = [1000, 3000, 5000];

  /// 尝试重连
  ///
  /// 重连时携带 lastEventId 以续传
  Future<Stream<SseEvent>> reconnect({
    required String url,
    required String lastEventId,
    required Map<String, String> headers,
    int attempt = 0,
  }) async {
    if (attempt >= maxRetries) {
      throw VoiceConversationException(
        code: 'SSE_RECONNECT_FAILED',
        message: '连接重试失败，请检查网络后重试',
      );
    }

    await Future.delayed(Duration(milliseconds: retryDelays[attempt]));

    try {
      return _sseClient.connect(
        url: url,
        headers: {
          ...headers,
          'Last-Event-ID': lastEventId,
        },
      );
    } catch (e) {
      return reconnect(
        url: url,
        lastEventId: lastEventId,
        headers: headers,
        attempt: attempt + 1,
      );
    }
  }
}
```

---

## 10. 数据结构定义

### 10.1 语音对话会话

```dart
/// 语音对话会话
class VoiceConversationSession {
  /// 会话ID
  final String sessionId;

  /// 关联的 AI 对话会话ID
  final String aiConversationId;

  /// 学生ID
  final String studentId;

  /// 学科
  final String subject;

  /// 会话状态
  VoiceConversationState state;

  /// 对话轮次列表
  final List<VoiceTurn> turns;

  /// 创建时间
  final DateTime createdAt;

  /// 更新时间
  DateTime updatedAt;

  /// TTS 配置
  final TtsVoiceConfig ttsConfig;

  /// VAD 配置
  final VadConfig vadConfig;

  /// 网络质量快照
  NetworkQuality networkQuality;
}

/// 语音对话轮次
class VoiceTurn {
  /// 轮次ID
  final String turnId;

  /// 轮次序号
  final int turnIndex;

  /// 用户语音信息
  final VoiceInput userVoice;

  /// AI 语音响应
  final VoiceOutput? aiVoice;

  /// 是否被打断
  final bool wasInterrupted;

  /// 打断时的进度（0.0 - 1.0）
  final double? interruptProgress;

  /// 时间戳
  final DateTime timestamp;
}

/// 用户语音输入
class VoiceInput {
  /// ASR 识别文本
  final String text;

  /// ASR 置信度
  final double confidence;

  /// 音频时长（毫秒）
  final int durationMs;

  /// 音频文件URL（可选，用于回放）
  final String? audioUrl;

  /// 语言
  final String language;
}

/// AI 语音输出
class VoiceOutput {
  /// 文本内容（完整）
  final String text;

  /// TTS 音频总时长（毫秒）
  final int totalDurationMs;

  /// 音频文件URL（完整音频，可选）
  final String? audioUrl;

  /// 关联知识点
  final List<String> knowledgePointIds;

  /// 消耗的 token 数
  final int totalTokens;
}
```

### 10.2 本地缓存结构

```dart
/// 语音对话本地缓存（Hive Box）
class VoiceConversationLocalCache {
  static const String boxName = 'voice_conversations';

  /// 缓存会话列表（最近 100 条）
  static const int maxCachedSessions = 100;

  /// 缓存音频文件（最近 50 条对话音频）
  static const int maxCachedAudio = 50;

  /// 单条音频文件最大大小
  static const int maxAudioFileSizeBytes = 5 * 1024 * 1024; // 5MB
}
```

---

## 11. API 接口设计

### 11.1 语音对话 SSE 接口

```
POST /api/v1/ai/voice-conversation
```

**请求体：**
```json
{
  "session_id": "vc_20260609_abc123",
  "message": "二次函数的顶点坐标怎么求？",
  "student_profile": {
    "grade": "九年级",
    "stage": "junior",
    "subject": "数学",
    "textbook_version": "人教版"
  },
  "context": {
    "conversation_id": "conv_xyz789",
    "chapter_id": "ch_math_j3_02",
    "history_last_n": 10
  },
  "response_mode": "streaming_text_and_tts",
  "tts_config": {
    "voice_id": "female_teacher",
    "speed": 1.0,
    "sample_rate": 24000,
    "format": "mp3"
  },
  "device_info": {
    "platform": "android",
    "network_type": "wifi",
    "network_quality": "excellent"
  }
}
```

**响应（SSE 事件流）：**
```
event: text_delta
data: {"content":"二","sequence":1}

event: text_delta
data: {"content":"次函数","sequence":2}

event: text_delta
data: {"content":"的顶点坐标","sequence":3}

event: tts_start
data: {"voice_id":"female_teacher","sample_rate":24000}

event: text_delta
data: {"content":"可以通过配方法来求解。","sequence":4}

event: tts_audio
data: {"audio":"//uQxAAAAAAAAA...","sequence":1,"duration_ms":850}

event: text_delta
data: {"content":"对于一般形式 y=ax²+bx+c，","sequence":5}

event: tts_audio
data: {"audio":"//uQxBBBBBBBBB...","sequence":2,"duration_ms":1200}

event: text_delta
data: {"content":"顶点横坐标为 x=-b/(2a)，","sequence":6}

event: knowledge_point
data: {"point_id":"kp_parabola_vertex","name":"抛物线顶点","chapter_id":"ch_math_j3_02"}

event: tts_audio
data: {"audio":"//uQxCCCCCCCCC...","sequence":3,"duration_ms":1500}

event: text_delta
data: {"content":"纵坐标为 y=(4ac-b²)/(4a)。","sequence":7}

event: tts_audio
data: {"audio":"//uQxDDDDDDDDD...","sequence":4,"duration_ms":1800}

event: tts_end
data: {"total_duration_ms":5350}

event: done
data: {"total_tokens":156,"duration_ms":4200}
```

### 11.2 ASR WebSocket 接口

```
WS /api/v1/asr/stream?lang=zh-CN&grade=junior&enable_partial=true
```

**协议**：见第 4.4 节 ASR WebSocket 消息格式。

### 11.3 TTS 预合成接口（用于降级模式）

```
POST /api/v1/tts/synthesize
```

**请求体：**
```json
{
  "text": "二次函数的顶点坐标可以通过配方法来求解。",
  "voice_id": "female_teacher",
  "speed": 1.0,
  "sample_rate": 24000,
  "format": "mp3"
}
```

**响应：**
```json
{
  "audio_url": "https://cdn.primetop.com/tts/20260609/audio_abc123.mp3",
  "duration_ms": 2100,
  "format": "mp3",
  "sample_rate": 24000,
  "size_bytes": 16800
}
```

---

## 12. 错误处理

### 12.1 错误码体系

| 错误码 | HTTP 状态 | 说明 | 客户端处理 |
|--------|-----------|------|-----------|
| `MIC_PERMISSION_DENIED` | - | 麦克风权限被拒 | 引导用户到设置页授权 |
| `ASR_SERVICE_UNAVAILABLE` | 503 | ASR 服务不可用 | 降级为文本输入 |
| `ASR_NO_SPEECH` | - | 未检测到语音 | 提示用户重新尝试 |
| `ASR_LOW_CONFIDENCE` | - | ASR 置信度过低（< 0.5） | 展示识别结果，允许用户修正 |
| `AI_TIMEOUT` | 504 | AI 响应超时 | 重试或降级 |
| `AI_ERROR` | 500 | AI 生成错误 | 展示错误提示 |
| `TTS_UNAVAILABLE` | 503 | TTS 服务不可用 | 降级为纯文本显示 |
| `SSE_CONNECTION_LOST` | - | SSE 连接断开 | 自动重连（最多 3 次） |
| `NETWORK_OFFLINE` | - | 无网络 | 展示离线提示 |
| `RATE_LIMITED` | 429 | 调用频率限制 | 展示剩余额度提示 |
| `QUOTA_EXCEEDED` | 403 | 会员额度用尽 | 引导升级会员 |

### 12.2 错误处理策略

```dart
/// 语音对话错误处理器
class VoiceConversationErrorHandler {
  final VoiceConversationController _controller;

  void handleError(VoiceConversationError error) {
    switch (error.code) {
      case 'MIC_PERMISSION_DENIED':
        _controller.transitionTo(
          VoiceConversationState.error,
          subState: VoiceConversationSubState.none,
          errorMessage: '需要麦克风权限才能使用语音对话',
          recoveryAction: RecoveryAction.openSettings,
        );
        break;

      case 'ASR_NO_SPEECH':
        // 不算错误，回到监听状态
        _controller.transitionTo(
          VoiceConversationState.listening,
          hint: '没有听清楚，请再说一次',
        );
        break;

      case 'ASR_LOW_CONFIDENCE':
        // 展示识别结果让用户确认
        _controller.showAsrConfirmation(
          text: error.data?['partialText'] ?? '',
          onConfirm: () => _controller.proceedWithAsr(),
          onEdit: () => _controller.switchToTextInput(),
        );
        break;

      case 'TTS_UNAVAILABLE':
        // 降级为纯文本模式
        _controller.transitionTo(
          VoiceConversationState.paused,
          subState: VoiceConversationSubState.none,
          hint: '语音播报暂时不可用，已切换为文字模式',
          isTextMode: true,
        );
        _recordMetric('tts_fallback_to_text');
        break;

      case 'SSE_CONNECTION_LOST':
        _controller.transitionTo(
          VoiceConversationState.aiThinking,
          subState: VoiceConversationSubState.reconnecting,
        );
        // 自动重连
        _controller.attemptReconnect();
        break;

      case 'RATE_LIMITED':
      case 'QUOTA_EXCEEDED':
        _controller.transitionTo(
          VoiceConversationState.error,
          errorMessage: '今日语音对话次数已用完',
          recoveryAction: RecoveryAction.showMembership,
        );
        break;

      default:
        _controller.transitionTo(
          VoiceConversationState.error,
          errorMessage: error.message ?? '语音对话出现问题，请重试',
          recoveryAction: RecoveryAction.retry,
        );
    }
  }
}
```

### 12.3 自动恢复机制

| 场景 | 检测方式 | 恢复策略 |
|------|----------|----------|
| ASR WebSocket 断开 | 心跳超时（5s） | 自动重连，重新发送当前录音 |
| SSE 连接断开 | 读取超时 / 连接错误 | 带 Last-Event-ID 重连，续传未接收的事件 |
| TTS 合成失败 | 服务端错误事件 | 降级为文本显示，记录错误日志 |
| 音频播放卡顿 | 缓冲区空 > 2s | 展示加载状态，增大缓冲策略 |
| 麦克风被其他应用占用 | 原生错误回调 | 提示用户关闭其他录音应用 |

---

## 13. 性能指标与优化

### 13.1 关键性能指标

| 指标 | 目标值 | 测量方式 |
|------|--------|----------|
| VAD 语音检测延迟 | < 100ms | 语音开始到状态切换 |
| ASR 首个部分结果延迟 | < 500ms | 开始说话到第一个 partial |
| ASR 最终结果延迟 | < 1s（说完后） | speech_end 到 final |
| AI 首 token 延迟 | < 2s | 发送请求到 text_delta |
| TTS 首包延迟 | < 500ms | tts_start 到 tts_audio |
| **端到端首音延迟** | **< 2.5s** | 用户说完到 AI 语音首音 |
| 打断响应延迟 | < 200ms | 用户开口到 AI 停止播报 |
| 音频播放连续性 | > 99% | 无卡顿播放时长占比 |

### 13.2 性能优化策略

```dart
/// 性能优化配置
class VoicePerformanceConfig {
  /// 预测性 TTS：在 AI 生成长句时提前合成
  static const bool enablePredictiveTts = true;

  /// 预测性 TTS 触发阈值（积攒文本长度）
  static const int predictiveTtsMinChars = 15;

  /// 音频预缓冲时长（ms）
  static const int preBufferMs = 300;

  /// WebSocket 重用：复用 ASR 连接
  static const bool reuseAsrConnection = true;

  /// VAD 端侧计算：使用平台原生 VAD 而非 Dart 计算
  static const bool useNativeVad = true;

  /// 音频压缩：ASR 发送使用 Opus 编码（降低带宽 80%）
  static const bool useOpusEncoding = true;

  /// 低端设备降级：帧率低于 30fps 时关闭可视化
  static const bool adaptiveVisualization = true;
}
```

### 13.3 内存管理

```dart
/// 语音对话内存管理
class VoiceMemoryManager {
  /// 音频缓冲区最大内存（MB）
  static const int maxBufferMemoryMb = 5;

  /// 单次对话最大音频缓存（MB）
  static const int maxTurnAudioMb = 2;

  /// 播放完成后延迟释放资源（秒）
  static const int resourceReleaseDelaySec = 30;

  /// 资源释放策略
  void releaseResources(VoiceConversationState newState) {
    switch (newState) {
      case VoiceConversationState.idle:
        // 释放所有音频资源
        _audioPlayer.release();
        _audioCapture.stop();
        _bufferQueue.clear();
        break;

      case VoiceConversationState.speaking:
        // 保持播放器，释放采集器
        _audioCapture.stop();
        break;

      case VoiceConversationState.listening:
        // 保持采集器，释放播放器
        _audioPlayer.release();
        break;

      default:
        break;
    }
  }
}
```

---

## 14. 场景适配

### 14.1 不同学习场景的语音模式

| 场景 | 语音模式 | 输入方式 | 输出方式 | 特殊处理 |
|------|----------|----------|----------|----------|
| AI 辅导问答 | 对话模式 | 语音/文字混合 | 语音+文字同步 | 分步提示用语音强调 |
| 口语陪练 | 沉浸语音 | 纯语音 | 纯语音 | 连续对话，无文字界面 |
| 背诵检测 | 朗读模式 | 语音朗读 | 文字对照+语音反馈 | 逐句对比，标注错误 |
| 英语口语 | 双语模式 | 英语语音 | 英语语音+中文翻译 | 发音评分实时展示 |
| 幼儿互动 | 趣味语音 | 语音+按钮 | 语音+动画 | 夸张语气，鼓励反馈 |

### 14.2 口语陪练沉浸模式配置

```dart
/// 口语陪练沉浸语音模式
class ImmersiveVoiceConfig {
  /// 是否显示文字（沉浸模式隐藏）
  final bool showText;

  /// 是否启用语音唤醒词
  final bool enableWakeWord;

  /// 唤醒词
  final String wakeWord; // 默认："小启小启"

  /// 对话间隔超时（自动结束）
  final Duration conversationTimeout;

  /// 最大对话轮次
  final int maxTurns;

  /// 是否启用发音评分
  final bool enablePronunciationScoring;

  static ImmersiveVoiceConfig forScenario(VoiceScenario scenario) {
    switch (scenario) {
      case VoiceScenario.oralPractice:
        return ImmersiveVoiceConfig(
          showText: false,
          enableWakeWord: false,
          conversationTimeout: Duration(minutes: 10),
          maxTurns: 50,
          enablePronunciationScoring: true,
        );
      case VoiceScenario.recitationCheck:
        return ImmersiveVoiceConfig(
          showText: true,
          enableWakeWord: false,
          conversationTimeout: Duration(minutes: 5),
          maxTurns: 20,
          enablePronunciationScoring: false,
        );
      case VoiceScenario.toddlerInteraction:
        return ImmersiveVoiceConfig(
          showText: false,
          enableWakeWord: true,
          wakeWord: '小启小启',
          conversationTimeout: Duration(minutes: 3),
          maxTurns: 15,
          enablePronunciationScoring: false,
        );
      default:
        return ImmersiveVoiceConfig(
          showText: true,
          enableWakeWord: false,
          conversationTimeout: Duration(minutes: 15),
          maxTurns: 100,
          enablePronunciationScoring: false,
        );
    }
  }
}
```

---

## 15. 平台原生能力桥接

### 15.1 Flutter 平台通道定义

```dart
/// 语音引擎平台通道
class VoiceEngineChannel {
  static const MethodChannel _channel = MethodChannel('com.primetop/voice_engine');
  static const EventChannel _audioStreamChannel = EventChannel('com.primetop/audio_stream');
  static const EventChannel _vadChannel = EventChannel('com.primetop/vad_events');

  /// 初始化音频会话
  static Future<void> configureAudioSession({
    required AudioSessionCategory category,
    required AudioSessionMode mode,
  }) async {
    await _channel.invokeMethod('configureAudioSession', {
      'category': category.name,
      'mode': mode.name,
    });
  }

  /// 开始音频采集
  static Future<void> startCapture({
    required int sampleRate,
    required int channels,
    required int bufferFrames,
  }) async {
    await _channel.invokeMethod('startCapture', {
      'sampleRate': sampleRate,
      'channels': channels,
      'bufferFrames': bufferFrames,
    });
  }

  /// 获取音频流（EventChannel）
  static Stream<Uint8List> get audioStream =>
    _audioStreamChannel.receiveBroadcastStream()
      .map((data) => data as Uint8List);

  /// 获取 VAD 事件流
  static Stream<VadEvent> get vadEvents =>
    _vadChannel.receiveBroadcastStream()
      .map((data) => VadEvent.fromMap(data as Map));

  /// 播放 PCM 音频
  static Future<void> playPcm(Uint8List data, {int sampleRate = 24000}) async {
    await _channel.invokeMethod('playPcm', {
      'data': data,
      'sampleRate': sampleRate,
    });
  }

  /// 停止播放
  static Future<void> stopPlayback() async {
    await _channel.invokeMethod('stopPlayback');
  }

  /// 获取当前播放音量（用于可视化）
  static Stream<double> get playbackLevel =>
    EventChannel('com.primetop/playback_level')
      .receiveBroadcastStream()
      .map((data) => data as double);
}
```

### 15.2 Android 原生实现要点

```kotlin
// Android 端 AudioCaptureService
class AudioCaptureService : MethodCallHandler {
    private var audioRecord: AudioRecord? = null
    private var isRecording = false

    companion object {
        private const val SAMPLE_RATE = 16000
        private const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
        private const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT
        private const val BUFFER_SIZE_FACTOR = 2
    }

    fun startCapture() {
        val bufferSize = AudioRecord.getMinBufferSize(
            SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT
        ) * BUFFER_SIZE_FACTOR

        audioRecord = AudioRecord(
            MediaRecorder.AudioSource.VOICE_RECOGNITION, // 使用语音识别音频源，自带降噪
            SAMPLE_RATE,
            CHANNEL_CONFIG,
            AUDIO_FORMAT,
            bufferSize
        )

        audioRecord?.startRecording()
        isRecording = true

        // 通过 EventChannel 发送音频数据
        scope.launch(Dispatchers.IO) {
            val buffer = ShortArray(bufferSize / 2)
            while (isRecording) {
                val read = audioRecord?.read(buffer, 0, buffer.size) ?: 0
                if (read > 0) {
                    val bytes = ShortArray(read).let { shorts ->
                        ByteBuffer.allocate(read * 2).order(ByteOrder.LITTLE_ENDIAN).run {
                            shorts.forEach { putShort(it) }
                            array()
                        }
                    }
                    audioSink?.success(bytes)
                }
            }
        }
    }

    fun stopCapture() {
        isRecording = false
        audioRecord?.stop()
        audioRecord?.release()
        audioRecord = null
    }
}
```

### 15.3 iOS 原生实现要点

```swift
// iOS 端 AudioCaptureService
class AudioCaptureService: NSObject, FlutterPlugin {
    private var audioEngine: AVAudioEngine?
    private var audioSession: AVAudioSession?

    func startCapture(result: @escaping FlutterResult) {
        audioSession = AVAudioSession.sharedInstance()
        try? audioSession?.setCategory(
            .playAndRecord,
            mode: .voiceChat,          // 语音聊天模式，自动启用回声消除
            options: [.allowBluetooth, .defaultToSpeaker]
        )
        try? audioSession?.setActive(true)

        audioEngine = AVAudioEngine()
        let inputNode = audioEngine!.inputNode
        let format = inputNode.outputFormat(forBus: 0)

        // 转换为目标格式
        let targetFormat = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: 16000,
            channels: 1,
            interleaved: true
        )!

        let converter = AVAudioConverter(from: format, to: targetFormat)!

        inputNode.installTap(onBus: 0, bufferSize: 3200, format: format) { [weak self] buffer, time in
            // 转换并回调
            self?.convertAndSend(buffer: buffer, converter: converter, targetFormat: targetFormat)
        }

        try? audioEngine?.start()
        result(nil)
    }

    func stopCapture() {
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        try? audioSession?.setActive(false)
    }
}
```

---

## 16. 测试策略

### 16.1 单元测试

| 测试项 | 覆盖内容 |
|--------|----------|
| VAD 检测 | 静音→语音、语音→静音状态转换 |
| 状态机 | 所有状态转换路径、非法转换拒绝 |
| 打断检测 | 正常打断、误触发改打断、多轮打断 |
| 缓冲队列 | 入队/出队/清空/溢出处理 |
| ASR 消息解析 | WebSocket 消息序列化/反序列化 |
| 网络降级 | 各质量等级的降级路径 |

### 16.2 集成测试

| 测试场景 | 验证内容 |
|----------|----------|
| 完整语音对话流程 | 录音→ASR→AI→TTS→播放 全链路 |
| 打断后继续对话 | 打断→新输入→AI 新响应 |
| 网络中断恢复 | SSE 断开→自动重连→续传 |
| 权限拒绝处理 | 麦克风拒绝→引导→授权后恢复 |
| 低电量模式 | 系统低电量→降低采样率/关闭可视化 |
| 来电中断 | 电话来电→暂停对话→挂断后恢复 |

### 16.3 性能测试

| 测试项 | 通过标准 |
|--------|----------|
| 端到端延迟 | P50 < 2s, P95 < 3s, P99 < 5s |
| 内存占用 | 语音对话期间增量 < 30MB |
| CPU 占用 | 录音+播放期间 < 15% |
| 电池消耗 | 10 分钟语音对话 < 3% 电量 |
| 发热 | 30 分钟连续对话 < 38°C |

---

## 17. 安全与合规

### 17.1 音频数据安全

| 要求 | 实现方式 |
|------|----------|
| 音频传输加密 | WSS + TLS 1.3 |
| 音频本地不持久化 | 录音数据仅存内存，对话结束后清除 |
| ASR 结果脱敏 | 服务端对 ASR 结果进行 PII 检测和脱敏 |
| 未成年人声纹保护 | 不存储未成年人声纹特征数据 |
| 音频文件加密 | CDN 音频文件使用 AES-256 加密，客户端解密播放 |

### 17.2 使用限制

```dart
/// 语音对话使用限制
class VoiceConversationLimits {
  /// 每日语音对话时长限制（分钟）- 按会员等级
  static int dailyDurationMinutes(MembershipLevel level) {
    switch (level) {
      case MembershipLevel.free:
        return 10;    // 免费用户每天 10 分钟
      case MembershipLevel.monthly:
        return 60;    // 月度会员 60 分钟
      case MembershipLevel.yearly:
        return -1;    // 年度会员不限
    }
  }

  /// 单次对话最大轮次
  static const int maxTurnsPerSession = 100;

  /// 单次录音最大时长（秒）
  static const int maxRecordingSec = 60;

  /// 单次 AI 回复最大时长（秒）
  static const int maxReplyDurationSec = 120;

  /// 连续对话最长时间（分钟）
  static const int maxContinuousMinutes = 30;

  /// 防沉迷：连续使用后强制休息
  static const int forcedBreakAfterMinutes = 30;
  static const int forcedBreakDurationMinutes = 10;
}
```

---

## 18. 监控与埋点

### 18.1 关键埋点事件

| 事件名 | 触发时机 | 关键属性 |
|--------|----------|----------|
| `voice_conv_start` | 用户启动语音对话 | session_id, grade, subject, network_quality |
| `voice_vad_speech_start` | VAD 检测到语音 | session_id, turn_index, latency_ms |
| `voice_vad_speech_end` | VAD 检测到静音 | session_id, turn_index, speech_duration_ms |
| `voice_asr_partial` | ASR 返回部分结果 | session_id, partial_text, confidence |
| `voice_asr_final` | ASR 返回最终结果 | session_id, text, confidence, duration_ms, latency_ms |
| `voice_ai_first_token` | AI 返回首个 token | session_id, latency_ms, model_id |
| `voice_tts_first_audio` | TTS 返回首个音频块 | session_id, latency_ms, voice_id |
| `voice_playback_start` | 音频开始播放 | session_id, buffer_ms, e2e_latency_ms |
| `voice_playback_complete` | 音频播放完成 | session_id, total_duration_ms |
| `voice_barge_in` | 用户打断 AI | session_id, turn_index, progress, playback_position_ms |
| `voice_conv_error` | 发生错误 | session_id, error_code, error_message, state |
| `voice_conv_end` | 对话结束 | session_id, total_turns, total_duration_ms, total_tokens |
| `voice_network_degrade` | 网络降级 | session_id, from_quality, to_quality, fallback_mode |

### 18.2 实时监控看板指标

| 指标 | 计算方式 | 告警阈值 |
|------|----------|----------|
| 语音对话成功率 | 成功完成 / 总发起数 | < 95% |
| 端到端首音延迟 P95 | 用户说毕到 AI 首音 | > 5s |
| ASR 识别准确率 | 用户确认无误 / 总识别数 | < 90% |
| TTS 可用率 | TTS 成功 / TTS 请求 | < 98% |
| 打断响应延迟 P95 | 用户开口到 AI 停止 | > 500ms |
| 弱网降级率 | 降级请求数 / 总请求数 | > 30% |
