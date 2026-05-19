# 语音服务（ASR / TTS）详细设计

> 版本：v1.0 | 更新时间：2026-05-19

## 1. 概述

### 1.1 模块定位

语音服务是 PrimeTop 的基础能力层，为上层业务模块提供统一的语音识别（ASR）和语音合成（TTS）能力。原始设计文档中多处引用语音能力但未独立展开：

| 上游模块 | 语音使用场景 |
|----------|-------------|
| AI 智能辅导 | 语音提问、语音追问、朗读回答 |
| 拼音识字启蒙 | 发音陪练、声调练习、朗读检测 |
| 文科背诵 | 语音背诵检测、朗读对比 |
| 理科解题 | 语音提问（复杂题目口述） |
| AI 对话页 | 语音输入、TTS 播报 AI 回答 |
| 首页与工作台 | 学习提醒语音播报 |

### 1.2 设计目标

1. **统一抽象**：屏蔽不同 ASR/TTS 供应商差异，提供统一 API
2. **多供应商可切换**：支持主流云厂商 ASR/TTS，避免单点依赖
3. **低延迟流式**：ASR 支持实时流式识别，TTS 支持流式合成播放
4. **离线降级**：弱网/离线场景下支持基础 TTS（本地合成）
5. **成本可控**：分级调用策略，免费用户用低成本引擎，会员用高质量引擎
6. **教育场景适配**：支持中英混合、数理化公式朗读、童声/标准声切换

### 1.3 核心能力范围

| 能力 | 说明 | 优先级 |
|------|------|--------|
| 实时流式 ASR | 录音时实时返回中间识别结果 | P0 |
| 短语音识别 | ≤60s 音频文件转文字 | P0 |
| 长语音识别 | >60s 音频（背诵材料）转文字 | P1 |
| 流式 TTS | 文本流式合成音频并播放 | P0 |
| 离线 TTS | 本地 TTS 引擎兜底 | P2 |
| 语音活动检测（VAD） | 检测说话开始/停止，自动截断 | P0 |
| 发音评测 | 拼音/单词/句子发音准确度打分 | P1 |

---

## 2. 整体架构

### 2.1 架构图

```
┌─────────────────────────────────────────────────────┐
│                   客户端 (Flutter)                    │
│  ┌───────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ 录音引擎  │  │ 音频播放引擎 │  │ VAD 模块     │  │
│  │(Recorder) │  │ (AudioPlayer)│  │ (本地/远端)  │  │
│  └─────┬─────┘  └──────┬───────┘  └──────┬───────┘  │
│        │               │                  │          │
│  ┌─────┴───────────────┴──────────────────┴───────┐  │
│  │           Voice SDK (客户端统一封装)             │  │
│  │  VoiceRecorder | VoicePlayer | PronAssessor   │  │
│  └─────────────────────┬──────────────────────────┘  │
└────────────────────────┼─────────────────────────────┘
                         │ HTTPS / WebSocket
┌────────────────────────┼─────────────────────────────┐
│              服务端 Voice Service                       │
│  ┌─────────────────────┴──────────────────────────┐  │
│  │           Voice Gateway (统一网关)               │  │
│  │  路由 │ 鉴权 │ 限流 │ 计量 │ 降级 │ 灰度        │  │
│  └──┬──────────┬──────────┬──────────┬────────────┘  │
│     │          │          │          │                │
│  ┌──┴───┐  ┌──┴───┐  ┌──┴───┐  ┌──┴────┐           │
│  │ASR   │  │TTS   │  │发音   │  │VAD    │           │
│  │Adapter│  │Adapter│ │评测   │  │Service│           │
│  │Pool  │  │Pool  │  │Service│  │       │           │
│  └──┬───┘  └──┬───┘  └──┬───┘  └───┬───┘           │
│     │         │          │           │                │
│  ┌──┴─────────┴──────────┴───────────┴──────────┐   │
│  │        Provider Layer (供应商适配层)            │   │
│  │  阿里云 │ 腾讯云 │ 讯飞 │ Google │ 本地引擎    │   │
│  └───────────────────────────────────────────────┘   │
│                                                       │
│  ┌──────────────┐  ┌──────────────┐                   │
│  │ 语音文件存储  │  │ 调用计量     │                   │
│  │ (对象存储)   │  │ (Redis+DB)  │                   │
│  └──────────────┘  └──────────────┘                   │
└───────────────────────────────────────────────────────┘
```

### 2.2 服务端模块划分

| 模块 | 职责 |
|------|------|
| VoiceGateway | 统一入口，路由、鉴权、限流、计量 |
| ASRAdapterPool | 多 ASR 供应商适配，流式/非流式统一接口 |
| TTSAdapterPool | 多 TTS 供应商适配，流式/非流式统一接口 |
| PronunciationAssessor | 发音评测服务（拼音/单词/句子） |
| VADService | 服务端 VAD（可选，主要 VAD 在客户端） |
| VoiceFileService | 音频文件上传/下载/存储管理 |

---

## 3. 数据结构定义

### 3.1 核心数据模型

#### 3.1.1 语音记录表 `voice_records`

```sql
CREATE TABLE voice_records (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id         BIGINT NOT NULL COMMENT '用户ID',
    session_id      VARCHAR(64) DEFAULT NULL COMMENT '会话ID（AI对话/背诵检测等）',
    biz_type        VARCHAR(32) NOT NULL COMMENT '业务类型: asr_question|asr_recite|tts_answer|tts_read|pron_check',
    direction       TINYINT NOT NULL COMMENT '方向: 1=上行(ASR) 2=下行(TTS)',
    
    -- 音频信息
    audio_format    VARCHAR(16) NOT NULL COMMENT '音频格式: pcm|mp3|opus|wav',
    sample_rate     INT NOT NULL DEFAULT 16000 COMMENT '采样率',
    duration_ms     INT NOT NULL COMMENT '音频时长(ms)',
    file_size       INT NOT NULL COMMENT '文件大小(bytes)',
    file_key        VARCHAR(256) DEFAULT NULL COMMENT '对象存储key',
    
    -- ASR 结果
    asr_text        TEXT DEFAULT NULL COMMENT '识别文本',
    asr_confidence  DECIMAL(5,4) DEFAULT NULL COMMENT '识别置信度 0~1',
    asr_provider    VARCHAR(32) DEFAULT NULL COMMENT 'ASR供应商',
    
    -- TTS 信息
    tts_text        TEXT DEFAULT NULL COMMENT '待合成文本（截断前）',
    tts_voice_type  VARCHAR(32) DEFAULT NULL COMMENT '音色类型',
    tts_provider    VARCHAR(32) DEFAULT NULL COMMENT 'TTS供应商',
    
    -- 发音评测
    pron_score      DECIMAL(5,2) DEFAULT NULL COMMENT '发音得分 0~100',
    pron_detail     JSON DEFAULT NULL COMMENT '评测详情',
    
    -- 元数据
    device_info     VARCHAR(128) DEFAULT NULL COMMENT '设备信息',
    network_type    VARCHAR(16) DEFAULT NULL COMMENT '网络类型',
    latency_ms      INT DEFAULT NULL COMMENT '端到端延迟',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_user_created (user_id, created_at),
    INDEX idx_session (session_id),
    INDEX idx_biz_type_created (biz_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='语音记录表';
```

#### 3.1.2 语音调用计量表 `voice_usage_daily`

```sql
CREATE TABLE voice_usage_daily (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id         BIGINT NOT NULL,
    stat_date       DATE NOT NULL COMMENT '统计日期',
    asr_count       INT NOT NULL DEFAULT 0 COMMENT 'ASR调用次数',
    asr_duration_ms BIGINT NOT NULL DEFAULT 0 COMMENT 'ASR总音频时长',
    tts_count       INT NOT NULL DEFAULT 0 COMMENT 'TTS调用次数',
    tts_chars       INT NOT NULL DEFAULT 0 COMMENT 'TTS合成字符数',
    pron_count      INT NOT NULL DEFAULT 0 COMMENT '发音评测次数',
    
    UNIQUE KEY uk_user_date (user_id, stat_date),
    INDEX idx_date (stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='语音调用日统计';
```

#### 3.1.3 供应商配置表 `voice_provider_config`

```sql
CREATE TABLE voice_provider_config (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    provider        VARCHAR(32) NOT NULL COMMENT '供应商: aliyun|tencent|xunfei|google',
    service_type    VARCHAR(16) NOT NULL COMMENT 'asr|tts|pron',
    tier            VARCHAR(16) NOT NULL DEFAULT 'standard' COMMENT '等级: free|standard|premium',
    config_json     JSON NOT NULL COMMENT '供应商配置(API密钥/端点等,加密存储)',
    voice_types     JSON DEFAULT NULL COMMENT '可用音色列表',
    languages       JSON DEFAULT NULL COMMENT '支持语言',
    priority        INT NOT NULL DEFAULT 0 COMMENT '优先级(越大越优先)',
    enabled         TINYINT NOT NULL DEFAULT 1,
    
    UNIQUE KEY uk_provider_type_tier (provider, service_type, tier),
    INDEX idx_type_tier (service_type, tier, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='语音供应商配置';
```

### 3.2 核心数据结构（代码）

```python
# === 请求/响应模型 ===

from enum import Enum
from pydantic import BaseModel, Field
from typing import Optional, List


class AudioFormat(str, Enum):
    PCM = "pcm"
    MP3 = "mp3"
    OPUS = "opus"
    WAV = "wav"


class VoiceBizType(str, Enum):
    ASR_QUESTION = "asr_question"       # AI提问
    ASR_RECITE = "asr_recite"           # 背诵检测
    ASR_READING = "asr_reading"         # 朗读纠音
    TTS_ANSWER = "tts_answer"           # AI回答播报
    TTS_READING = "tts_reading"         # 课文朗读示范
    PRON_CHECK = "pron_check"           # 发音评测


class VoiceType(str, Enum):
    # 中文音色
    CN_FEMALE_STD = "cn_female_std"     # 标准女声
    CN_MALE_STD = "cn_male_std"         # 标准男声
    CN_CHILD = "cn_child"               # 童声
    CN_FEMALE_GENTLE = "cn_female_gentle"  # 温柔女声
    # 英文音色
    EN_FEMALE_STD = "en_female_std"
    EN_MALE_STD = "en_male_std"
    EN_CHILD = "en_child"


class ASRRequest(BaseModel):
    """ASR 请求（非流式）"""
    audio_format: AudioFormat
    sample_rate: int = 16000
    language: str = Field(default="zh", pattern=r"^(zh|en|zh_en)$")
    enable_punctuation: bool = True
    enable_inverse_text: bool = True    # 数字转中文
    max_silence_ms: int = 800           # 最大静音时间
    biz_type: VoiceBizType


class ASRStreamConfig(BaseModel):
    """流式 ASR 配置"""
    audio_format: AudioFormat = AudioFormat.PCM
    sample_rate: int = 16000
    language: str = "zh"
    enable_interim_result: bool = True   # 返回中间结果
    enable_punctuation: bool = True
    max_silence_ms: int = 1500          # 静音超时自动结束
    max_duration_ms: int = 60000        # 最大录音时长


class ASRResult(BaseModel):
    """ASR 识别结果"""
    text: str
    confidence: float = Field(ge=0, le=1)
    is_final: bool = True               # 是否最终结果
    words: Optional[List[dict]] = None  # 词级别时间戳和对齐
    language_detected: Optional[str] = None


class TTSRequest(BaseModel):
    """TTS 请求"""
    text: str = Field(max_length=5000)
    voice_type: VoiceType = VoiceType.CN_FEMALE_STD
    audio_format: AudioFormat = AudioFormat.MP3
    sample_rate: int = 16000
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    pitch: float = Field(default=0, ge=-12, le=12)
    volume: float = Field(default=0, ge=-6, le=6)
    biz_type: VoiceBizType = VoiceBizType.TTS_ANSWER
    stream: bool = True                 # 是否流式


class TTSResult(BaseModel):
    """TTS 合成结果（非流式）"""
    audio_url: str                       # 音频下载地址
    duration_ms: int
    file_size: int
    voice_type: str


class PronAssessmentRequest(BaseModel):
    """发音评测请求"""
    audio_format: AudioFormat
    sample_rate: int = 16000
    reference_text: str                  # 参考文本
    language: str = Field(default="zh", pattern=r"^(zh|en)$")
    assess_type: str = Field(pattern=r"^(pinyin|word|sentence|paragraph)$")
    # 拼音评测特有
    target_pinyin: Optional[str] = None  # 目标拼音，如 "bā"
    tone_mode: Optional[str] = None      # 声调模式: tone_only|full


class PronAssessmentResult(BaseModel):
    """发音评测结果"""
    overall_score: float = Field(ge=0, le=100)
    completeness: float = Field(ge=0, le=100)    # 完整度
    fluency: float = Field(ge=0, le=100)          # 流利度
    pronunciation: float = Field(ge=0, le=100)    # 发音准确度
    tone_score: Optional[float] = None             # 声调得分（中文）
    details: Optional[List[dict]] = None           # 逐字/逐词评分
    error_phones: Optional[List[str]] = None       # 错误音素列表
```

### 3.3 供应商适配层枚举

```python
class ASRProvider(str, Enum):
    ALIYUN = "aliyun"       # 阿里云智能语音
    TENCENT = "tencent"     # 腾讯云语音识别
    XUNFEI = "xunfei"       # 讯飞开放平台
    GOOGLE = "google"       # Google Cloud Speech（海外备用）


class TTSProvider(str, Enum):
    ALIYUN = "aliyun"
    TENCENT = "tencent"
    XUNFEI = "xunfei"
    LOCAL = "local"         # 本地引擎（离线降级）


class PronProvider(str, Enum):
    XUNFEI = "xunfei"       # 讯飞语音评测（中文拼音评测最成熟）
    TENCENT = "tencent"     # 腾讯云口语评测
    ALIYUN = "aliyun"       # 阿里云智能语音交互
```

---

## 4. API 接口设计

### 4.1 接口总览

| 方法 | 路径 | 说明 | 协议 |
|------|------|------|------|
| POST | `/api/v1/voice/asr/recognize` | 短语音识别（非流式） | HTTPS |
| WebSocket | `/api/v1/voice/asr/stream` | 实时流式 ASR | WSS |
| POST | `/api/v1/voice/asr/file` | 音频文件识别（长语音） | HTTPS |
| POST | `/api/v1/voice/tts/synthesize` | 文本合成语音（非流式） | HTTPS |
| WebSocket | `/api/v1/voice/tts/stream` | 流式 TTS 合成 | WSS |
| POST | `/api/v1/voice/pron/assess` | 发音评测 | HTTPS |
| WebSocket | `/api/v1/voice/pron/assess-stream` | 流式发音评测 | WSS |
| GET | `/api/v1/voice/voices` | 获取可用音色列表 | HTTPS |
| GET | `/api/v1/voice/usage` | 查询语音用量 | HTTPS |

### 4.2 认证与限流

- 所有接口通过 `Authorization: Bearer <token>` 鉴权
- WebSocket 连接通过 URL 参数 `?token=<jwt>` 鉴权
- 限流策略：

| 用户等级 | ASR 日调用量 | TTS 日调用量 | 发音评测日调用量 |
|----------|-------------|-------------|-----------------|
| 免费用户 | 10 次/天 | 20 次/天 | 5 次/天 |
| 月度会员 | 100 次/天 | 200 次/天 | 30 次/天 |
| 年度会员 | 不限 | 不限 | 50 次/天 |

限流基于 Redis 令牌桶，key 格式：`voice:limit:{user_id}:{service}:YYYYMMDD`

### 4.3 短语音识别接口

**POST** `/api/v1/voice/asr/recognize`

请求（`multipart/form-data`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| audio | file | ✅ | 音频文件，≤60s |
| format | string | ✅ | pcm / mp3 / opus / wav |
| sample_rate | int | | 默认 16000 |
| language | string | | 默认 "zh" |
| biz_type | string | ✅ | 业务类型 |

响应：

```json
{
    "code": 0,
    "data": {
        "text": "一元二次方程求根公式是什么",
        "confidence": 0.96,
        "words": [
            {"word": "一元二次方程", "start_ms": 0, "end_ms": 1200},
            {"word": "求根公式", "start_ms": 1300, "end_ms": 2100},
            {"word": "是什么", "start_ms": 2200, "end_ms": 2800}
        ],
        "duration_ms": 2800,
        "provider": "aliyun",
        "latency_ms": 320
    }
}
```

### 4.4 实时流式 ASR（WebSocket）

**WebSocket** `/api/v1/voice/asr/stream?token=<jwt>`

#### 4.4.1 连接流程

```
客户端                                服务端
  │                                    │
  │──── WebSocket 握手 ────────────────>│
  │<──── 连接成功 (200) ───────────────│
  │                                    │
  │──── config JSON ──────────────────>│  (1) 发送配置
  │<──── ready JSON ───────────────────│  (2) 确认就绪
  │                                    │
  │──── binary audio chunk ───────────>│  (3) 流式发送音频
  │<──── interim result JSON ──────────│  (4) 中间识别结果
  │──── binary audio chunk ───────────>│
  │<──── interim result JSON ──────────│
  │──── binary audio chunk ───────────>│
  │<──── final result JSON ────────────│  (5) 最终结果（VAD检测到静音/手动结束）
  │                                    │
  │──── close ─────────────────────────>│
```

#### 4.4.2 消息格式

**配置消息（客户端 → 服务端）**：
```json
{
    "type": "config",
    "audio_format": "pcm",
    "sample_rate": 16000,
    "language": "zh",
    "enable_interim_result": true,
    "max_silence_ms": 1500,
    "max_duration_ms": 60000,
    "biz_type": "asr_question"
}
```

**就绪消息（服务端 → 客户端）**：
```json
{
    "type": "ready",
    "session_id": "asr_s_20260519_abc123"
}
```

**中间结果（服务端 → 客户端）**：
```json
{
    "type": "interim",
    "text": "一元二次方程",
    "session_id": "asr_s_20260519_abc123"
}
```

**最终结果（服务端 → 客户端）**：
```json
{
    "type": "final",
    "text": "一元二次方程求根公式是什么",
    "confidence": 0.96,
    "duration_ms": 2800,
    "words": [...],
    "session_id": "asr_s_20260519_abc123"
}
```

**结束消息（客户端 → 服务端）**：
```json
{"type": "stop"}
```

**错误消息**：
```json
{
    "type": "error",
    "code": "VOICE_LIMIT_EXCEEDED",
    "message": "今日ASR调用次数已达上限"
}
```

### 4.5 流式 TTS（WebSocket）

**WebSocket** `/api/v1/voice/tts/stream?token=<jwt>`

#### 4.5.1 连接流程

```
客户端                                服务端
  │                                    │
  │──── WebSocket 握手 ────────────────>│
  │                                    │
  │──── synthesize JSON ──────────────>│  (1) 发送合成请求
  │<──── binary audio chunk ───────────│  (2) 流式返回音频
  │<──── binary audio chunk ───────────│
  │<──── binary audio chunk ───────────│
  │<──── done JSON ────────────────────│  (3) 合成完成
  │                                    │
  │──── synthesize JSON ──────────────>│  (4) 可复用连接继续合成
  │<──── ...                           │
```

#### 4.5.2 合成请求消息

```json
{
    "type": "synthesize",
    "text": "一元二次方程的求根公式为：x等于2a分之负b加减根号下b平方减4ac",
    "voice_type": "cn_female_std",
    "audio_format": "mp3",
    "sample_rate": 16000,
    "speed": 0.9,
    "biz_type": "tts_answer",
    "request_id": "req_001"
}
```

**注意**：`text` 中不应包含 LaTeX 或数学符号，需由上游模块预处理为自然语言文本（见 5.2 节文本预处理）。

#### 4.5.3 音频分片返回

音频以二进制帧返回，每个帧包含一个音频分片。客户端收到后直接送入播放缓冲区。

完成消息：
```json
{
    "type": "done",
    "request_id": "req_001",
    "duration_ms": 5200,
    "file_size": 41600
}
```

### 4.6 发音评测接口

**POST** `/api/v1/voice/pron/assess`

请求（`multipart/form-data`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| audio | file | ✅ | 音频文件 |
| reference_text | string | ✅ | 参考文本 |
| language | string | | zh / en |
| assess_type | string | ✅ | pinyin / word / sentence / paragraph |
| target_pinyin | string | | 拼音评测时必填 |

响应：

```json
{
    "code": 0,
    "data": {
        "overall_score": 85.5,
        "completeness": 100.0,
        "fluency": 82.0,
        "pronunciation": 86.0,
        "tone_score": 78.5,
        "details": [
            {
                "char": "方",
                "pinyin": "fāng",
                "score": 90,
                "tone_score": 85,
                "error_type": null
            },
            {
                "char": "程",
                "pinyin": "chéng",
                "score": 75,
                "tone_score": 60,
                "error_type": "tone_error"
            }
        ],
        "error_phones": ["cheng2"],
        "duration_ms": 1500,
        "provider": "xunfei"
    }
}
```

### 4.7 获取可用音色

**GET** `/api/v1/voice/voices?language=zh`

响应：

```json
{
    "code": 0,
    "data": {
        "voices": [
            {
                "voice_id": "cn_female_std",
                "name": "小琪",
                "language": "zh",
                "gender": "female",
                "style": "标准",
                "preview_url": "https://cdn.primetop.com/voice/preview/cn_female_std.mp3",
                "tier": "standard"
            },
            {
                "voice_id": "cn_child",
                "name": "小萌",
                "language": "zh",
                "gender": "child",
                "style": "活泼",
                "preview_url": "https://cdn.primetop.com/voice/preview/cn_child.mp3",
                "tier": "premium"
            }
        ]
    }
}
```

### 4.8 查询语音用量

**GET** `/api/v1/voice/usage?date=2026-05-19`

响应：

```json
{
    "code": 0,
    "data": {
        "date": "2026-05-19",
        "asr": {"count": 5, "limit": 10},
        "tts": {"count": 12, "limit": 20},
        "pron": {"count": 2, "limit": 5}
    }
}
```

---

## 5. 关键流程设计

### 5.1 流式 ASR 完整流程

```python
# === 服务端流式 ASR Handler（伪代码） ===

class ASRStreamHandler:
    """处理 WebSocket 流式 ASR 连接"""
    
    def __init__(self, ws, user_id: int):
        self.ws = ws
        self.user_id = user_id
        self.session_id = f"asr_s_{datetime.now():%Y%m%d}_{uuid4().hex[:8]}"
        self.provider: Optional[ASRProviderAdapter] = None
        self.audio_buffer = bytearray()
        self.start_time = 0
    
    async def on_config(self, config: ASRStreamConfig):
        """(1) 收到配置，初始化供应商连接"""
        # 检查用量
        if await self._check_limit():
            await self.ws.send_json({"type": "error", "code": "VOICE_LIMIT_EXCEEDED"})
            await self.ws.close()
            return
        
        # 选择供应商（基于用户等级 + 负载均衡）
        self.provider = await self._select_provider(config)
        await self.provider.open_stream(
            config=config,
            on_interim=self._on_interim,
            on_final=self._on_final,
            on_error=self._on_error
        )
        self.start_time = time.monotonic()
        
        await self.ws.send_json({
            "type": "ready",
            "session_id": self.session_id
        })
    
    async def on_audio(self, chunk: bytes):
        """(2) 收到音频数据，转发给供应商"""
        self.audio_buffer.extend(chunk)
        await self.provider.send_audio(chunk)
    
    async def on_stop(self):
        """(3) 客户端主动结束"""
        await self.provider.end_stream()
    
    async def _on_interim(self, text: str):
        """供应商返回中间结果"""
        await self.ws.send_json({
            "type": "interim",
            "text": text,
            "session_id": self.session_id
        })
    
    async def _on_final(self, result: ASRResult):
        """供应商返回最终结果"""
        # 计算延迟
        latency = int((time.monotonic() - self.start_time) * 1000)
        
        # 记录
        await self._save_record(result, latency)
        await self._increment_usage()
        
        await self.ws.send_json({
            "type": "final",
            "text": result.text,
            "confidence": result.confidence,
            "duration_ms": len(self.audio_buffer) / (16 * 2),  # PCM 16kHz 16bit
            "words": result.words,
            "session_id": self.session_id
        })
    
    async def _on_error(self, error: Exception):
        """供应商错误，尝试降级"""
        # 记录错误
        log.error(f"ASR provider error: {error}")
        
        # 尝试降级到备用供应商
        fallback = await self._get_fallback_provider()
        if fallback:
            await self.ws.send_json({"type": "info", "message": "正在切换识别服务..."})
            # 重新用已有音频尝试
            await fallback.open_stream(...)
            await fallback.send_audio(bytes(self.audio_buffer))
            await fallback.end_stream()
        else:
            await self.ws.send_json({
                "type": "error",
                "code": "ASR_PROVIDER_UNAVAILABLE",
                "message": "语音识别服务暂不可用，请稍后重试"
            })
            await self.ws.close()
```

### 5.2 TTS 文本预处理

AI 回答中常包含数学公式、化学方程式等，TTS 无法直接朗读。需要预处理管道：

```python
class TTSTextPreprocessor:
    """TTS 文本预处理：将结构化内容转为自然语言"""
    
    # 数学符号映射
    MATH_READING_MAP = {
        "+": "加", "-": "减", "×": "乘以", "÷": "除以",
        "=": "等于", "≠": "不等于", "≈": "约等于",
        "<": "小于", ">": "大于", "≤": "小于等于", "≥": "大于等于",
        "²": "的平方", "³": "的立方", "√": "根号",
        "π": "派", "∞": "无穷", "∑": "西格玛",
        "∫": "积分号", "±": "正负",
    }
    
    def preprocess(self, text: str, context: dict = None) -> str:
        """
        预处理管道，按顺序执行各阶段
        
        Args:
            text: 原始文本（可能包含 LaTeX、Markdown、特殊符号）
            context: 上下文信息（学科、学段等）
        
        Returns:
            可供 TTS 朗读的自然语言文本
        """
        result = text
        result = self._strip_markdown(result)
        result = self._convert_latex(result)
        result = self._convert_math_symbols(result)
        result = self._convert_chemical_formula(result)
        result = self._convert_numbers(result)
        result = self._clean_whitespace(result)
        return result
    
    def _convert_latex(self, text: str) -> str:
        """LaTeX 公式转自然语言"""
        # 简单规则示例（复杂公式建议调用 LLM 转写）
        text = re.sub(r'\\frac\{([^}]+)\}\{([^}]+)\}', 
                      lambda m: f'{m.group(1)}分之{m.group(2)}', text)
        text = re.sub(r'\\sqrt\{([^}]+)\}', 
                      lambda m: f'根号下{m.group(1)}', text)
        text = re.sub(r'\^{([^}]+)}', 
                      lambda m: f'的{m.group(1)}次方', text)
        text = re.sub(r'\^(\d)', 
                      lambda m: f'的{m.group(1)}次方', text)
        return text
    
    def _convert_math_symbols(self, text: str) -> str:
        """数学符号转中文朗读"""
        for symbol, reading in self.MATH_READING_MAP.items():
            text = text.replace(symbol, reading)
        return text
    
    def _convert_chemical_formula(self, text: str) -> str:
        """化学方程式简化朗读"""
        # H₂SO₄ → H2SO4（TTS 引擎一般能处理）
        text = re.sub(r'₂', '2', text)
        text = re.sub(r'₃', '3', text)
        text = re.sub(r'₄', '4', text)
        text = re.sub(r'→', '生成', text)
        text = re.sub(r'↑', '气体符号', text)
        text = re.sub(r'↓', '沉淀', text)
        return text
    
    def _strip_markdown(self, text: str) -> str:
        """去除 Markdown 格式标记"""
        text = re.sub(r'```[\s\S]*?```', '', text)   # 代码块
        text = re.sub(r'`([^`]+)`', r'\1', text)       # 行内代码
        text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text) # 加粗
        text = re.sub(r'\*([^*]+)\*', r'\1', text)     # 斜体
        text = re.sub(r'^#+\s*', '', text, flags=re.M) # 标题
        return text
    
    def _convert_numbers(self, text: str) -> str:
        """数字适当转中文（年份、小数等保留阿拉伯数字）"""
        # 这一步主要依赖 TTS 引擎自身的数字读法
        # 只处理特殊情况，如"第1"→"第一"
        text = re.sub(r'第(\d+)', lambda m: f'第{self._num_to_cn(int(m.group(1)))}', text)
        return text
    
    def _clean_whitespace(self, text: str) -> str:
        """清理多余空白"""
        text = re.sub(r'\n{2,}', '。', text)
        text = re.sub(r'\s+', ' ', text)
        return text.strip()
```

### 5.3 供应商选择与降级策略

```python
class VoiceProviderRouter:
    """语音供应商路由器：选择最优供应商 + 自动降级"""
    
    def __init__(self, redis: Redis, config_repo: VoiceProviderConfigRepo):
        self.redis = redis
        self.config_repo = config_repo
    
    async def select_asr_provider(self, user_tier: str, language: str) -> ASRProviderAdapter:
        """选择 ASR 供应商"""
        providers = await self.config_repo.get_available_providers(
            service_type="asr",
            tier=user_tier,
            language=language
        )
        
        if not providers:
            raise VoiceServiceUnavailableError("没有可用的ASR供应商")
        
        # 按优先级排序，检查健康状态
        for p in sorted(providers, key=lambda x: x.priority, reverse=True):
            health_key = f"voice:health:{p.provider}:asr"
            error_count = await self.redis.get(health_key)
            
            # 错误率过高则跳过（最近5分钟错误>3次）
            if error_count and int(error_count) > 3:
                continue
            
            return self._create_adapter(p)
        
        # 全部不健康，选优先级最高的（强制降级）
        return self._create_adapter(providers[0])
    
    async def record_provider_error(self, provider: str, service_type: str):
        """记录供应商错误（用于健康检查）"""
        health_key = f"voice:health:{provider}:{service_type}"
        pipe = self.redis.pipeline()
        pipe.incr(health_key)
        pipe.expire(health_key, 300)  # 5分钟窗口
        await pipe.execute()
    
    async def record_provider_success(self, provider: str, service_type: str):
        """记录成功调用，重置错误计数"""
        health_key = f"voice:health:{provider}:{service_type}"
        await self.redis.delete(health_key)
```

### 5.4 发音评测流程（拼音场景）

```
用户点击"练习拼音"
    │
    ├── 客户端展示目标拼音 "bā" + 示范发音播放
    │
    ├── 用户点击录音按钮，开始录音
    │   │
    │   ├── VAD 检测到语音开始
    │   ├── 录音 1~3 秒
    │   └── VAD 检测到静音 → 自动停止
    │
    ├── 客户端发送发音评测请求
    │   POST /api/v1/voice/pron/assess
    │   audio + reference_text="八" + target_pinyin="bā"
    │
    ├── 服务端调用讯飞拼音评测
    │   └── 返回评分详情
    │
    ├── 客户端展示结果
    │   ├── 总分：85 分
    │   ├── 声母 b：准确 ✅
    │   ├── 韵母 a：准确 ✅
    │   ├── 声调（一声）：偏二声 ⚠️
    │   └── 建议："一声要平，不要往上扬"
    │
    └── 若得分 < 60，自动弹出"再试一次"
```

---

## 6. 客户端 SDK 设计

### 6.1 Flutter Voice SDK 整体结构

```
lib/
  voice/
    ├── voice_sdk.dart              # SDK 入口，单例
    ├── voice_recorder.dart         # 录音管理
    ├── voice_player.dart           # TTS 播放管理
    ├── pronunciation_assessor.dart # 发音评测客户端
    ├── voice_config.dart           # 配置
    ├── models/
    │   ├── asr_result.dart
    │   ├── tts_request.dart
    │   ├── pron_result.dart
    │   └── voice_usage.dart
    ├── providers/
    │   └── voice_api_client.dart   # 与服务端通信
    └── widgets/
        ├── voice_input_button.dart # 录音按钮组件
        ├── voice_player_button.dart# 播放按钮组件
        └── pron_score_display.dart # 发音评分展示
```

### 6.2 录音管理器

```dart
/// 录音管理器：封装录音、VAD、流式 ASR
class VoiceRecorder {
  final VoiceApiClient _apiClient;
  final VoiceConfig _config;
  
  // 录音状态
  final _stateController = StreamController<RecorderState>.broadcast();
  Stream<RecorderState> get stateStream => _stateController.stream;
  
  // ASR 中间结果
  final _resultController = StreamController<ASRResult>.broadcast();
  Stream<ASRResult> get resultStream => _resultController.stream;
  
  RecorderState _state = RecorderState.idle;
  WebSocketChannel? _wsChannel;
  FlutterSoundRecorder? _recorder;
  
  /// 开始录音 + 流式识别
  Future<void> start({
    String language = 'zh',
    VoiceBizType bizType = VoiceBizType.asrQuestion,
    int maxDurationMs = 60000,
  }) async {
    if (_state != RecorderState.idle) return;
    
    _setState(RecorderState.connecting);
    
    // 1. 建立 WebSocket 连接
    final token = await _apiClient.getAccessToken();
    _wsChannel = WebSocketChannel.connect(
      Uri.parse('${_config.wsBaseUrl}/api/v1/voice/asr/stream?token=$token'),
    );
    
    // 2. 发送配置
    _wsChannel!.sink.add(jsonEncode({
      'type': 'config',
      'audio_format': 'pcm',
      'sample_rate': 16000,
      'language': language,
      'enable_interim_result': true,
      'max_silence_ms': 1500,
      'max_duration_ms': maxDurationMs,
      'biz_type': bizType.name,
    }));
    
    // 3. 监听服务端消息
    _wsChannel!.stream.listen(_onWebSocketMessage, onError: _onWebSocketError);
    
    // 4. 等待 ready 消息
    await _waitForReady(timeout: Duration(seconds: 5));
    
    // 5. 开始录音
    _recorder = FlutterSoundRecorder();
    await _recorder!.openRecorder();
    await _recorder!.startRecorder(
      toStream: _audioStream,  // PCM 流
      codec: Codec.pcm16,
      numChannels: 1,
      sampleRate: 16000,
    );
    
    // 6. 将音频流转发到 WebSocket
    _audioStreamController = StreamController<Food>();
    _audioSubscription = _audioStreamController!.stream.listen((food) {
      if (food is FoodData && _wsChannel != null) {
        _wsChannel!.sink.add(food.data);
      }
    });
    
    _setState(RecorderState.recording);
  }
  
  /// 手动停止录音
  Future<void> stop() async {
    if (_state != RecorderState.recording) return;
    
    _setState(RecorderState.stopping);
    
    // 发送停止信号
    _wsChannel?.sink.add(jsonEncode({'type': 'stop'}));
    
    // 停止录音
    await _recorder?.stopRecorder();
    await _recorder?.closeRecorder();
    
    // 等待最终结果（最多 3 秒）
    // 最终结果到达后自动关闭连接
  }
  
  void _onWebSocketMessage(dynamic message) {
    final data = jsonDecode(message as String) as Map<String, dynamic>;
    
    switch (data['type']) {
      case 'ready':
        // 连接就绪
        break;
      case 'interim':
        _resultController.add(ASRResult(
          text: data['text'],
          isFinal: false,
        ));
        break;
      case 'final':
        _resultController.add(ASRResult(
          text: data['text'],
          confidence: (data['confidence'] as num).toDouble(),
          isFinal: true,
          words: (data['words'] as List?)?.cast<Map<String, dynamic>>(),
        ));
        _cleanup();
        _setState(RecorderState.idle);
        break;
      case 'error':
        _handleError(data['code'], data['message']);
        _cleanup();
        break;
    }
  }
}

enum RecorderState {
  idle,         // 空闲
  connecting,   // 正在连接
  recording,    // 录音中
  stopping,     // 正在停止
}
```

### 6.3 TTS 播放管理器

```dart
/// TTS 播放管理器：管理 TTS 请求、流式合成和音频播放
class VoicePlayer {
  final VoiceApiClient _apiClient;
  
  // 播放状态
  final _stateController = StreamController<PlayerState>.broadcast();
  Stream<PlayerState> get stateStream => _stateController.stream;
  
  AudioPlayer? _player;
  WebSocketChannel? _wsChannel;
  String? _currentRequestId;
  
  PlayerState _state = PlayerState.idle;
  
  /// 流式合成并播放文本
  Future<void> speak(
    String text, {
    VoiceType voiceType = VoiceType.cnFemaleStd,
    double speed = 1.0,
    VoiceBizType bizType = VoiceBizType.ttsAnswer,
  }) async {
    if (_state == PlayerState.playing) {
      await stop();
    }
    
    _setState(PlayerState.loading);
    
    // 建立 WebSocket 连接
    final token = await _apiClient.getAccessToken();
    _wsChannel = WebSocketChannel.connect(
      Uri.parse('${_config.wsBaseUrl}/api/v1/voice/tts/stream?token=$token'),
    );
    
    // 收集音频分片到临时文件
    final tempFile = await _createTempAudioFile();
    final sink = tempFile.openWrite();
    int totalBytes = 0;
    
    _wsChannel!.stream.listen(
      (message) async {
        if (message is String) {
          final data = jsonDecode(message) as Map<String, dynamic>;
          if (data['type'] == 'done') {
            // 合成完成，开始播放
            await sink.close();
            _playAudioFile(tempFile);
          } else if (data['type'] == 'error') {
            _handleTTSError(data['code'], data['message']);
          }
        } else if (message is List<int>) {
          // 音频二进制数据
          sink.add(message);
          totalBytes += message.length;
        }
      },
      onError: (error) => _handleTTSError('CONNECTION_ERROR', error.toString()),
    );
    
    // 发送合成请求
    _currentRequestId = 'tts_${DateTime.now().millisecondsSinceEpoch}';
    _wsChannel!.sink.add(jsonEncode({
      'type': 'synthesize',
      'text': text,
      'voice_type': voiceType.name,
      'audio_format': 'mp3',
      'sample_rate': 16000,
      'speed': speed,
      'biz_type': bizType.name,
      'request_id': _currentRequestId,
    }));
  }
  
  /// 停止播放
  Future<void> stop() async {
    _player?.stop();
    _wsChannel?.sink.close();
    _setState(PlayerState.idle);
  }
  
  void _playAudioFile(File file) {
    _player = AudioPlayer();
    _player!.setFilePath(file.path);
    _player!.play();
    _setState(PlayerState.playing);
    
    _player!.playerStateStream.listen((state) {
      if (state.processingState == ProcessingState.completed) {
        _setState(PlayerState.idle);
        _cleanup();
      }
    });
  }
}

enum PlayerState {
  idle,       // 空闲
  loading,    // 正在合成
  playing,    // 正在播放
}
```

### 6.4 录音按钮组件

```dart
/// 语音输入按钮：长按录音，松开结束
class VoiceInputButton extends StatefulWidget {
  final void Function(String text, double confidence) onResult;
  final VoidCallback? onError;
  final String language;
  
  const VoiceInputButton({
    required this.onResult,
    this.onError,
    this.language = 'zh',
    super.key,
  });
  
  @override
  State<VoiceInputButton> createState() => _VoiceInputButtonState();
}

class _VoiceInputButtonState extends State<VoiceInputButton> {
  final _recorder = VoiceRecorder();
  String _interimText = '';
  bool _isRecording = false;
  
  @override
  void initState() {
    super.initState();
    _recorder.resultStream.listen((result) {
      if (result.isFinal) {
        widget.onResult(result.text, result.confidence ?? 0.0);
        setState(() => _interimText = '');
      } else {
        setState(() => _interimText = result.text);
      }
    });
  }
  
  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onLongPressStart: (_) => _startRecording(),
      onLongPressEnd: (_) => _stopRecording(),
      child: Container(
        width: 56,
        height: 56,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: _isRecording 
            ? Theme.of(context).colorScheme.error
            : Theme.of(context).colorScheme.primary,
        ),
        child: Icon(
          _isRecording ? Icons.stop : Icons.mic,
          color: Colors.white,
          size: 28,
        ),
      ),
    );
  }
  
  Future<void> _startRecording() async {
    try {
      await _recorder.start(language: widget.language);
      setState(() => _isRecording = true);
    } catch (e) {
      widget.onError?.call();
    }
  }
  
  Future<void> _stopRecording() async {
    await _recorder.stop();
    setState(() => _isRecording = false);
  }
}
```

---

## 7. 状态流转

### 7.1 ASR 录音状态机

```
                 ┌──────────┐
                 │  idle    │ ◄─────────────────────────┐
                 └────┬─────┘                           │
                      │ start()                         │
                      ▼                                 │
                 ┌──────────┐                           │
                 │connecting│─── 超时/连接失败 ────────►│
                 └────┬─────┘                           │
                      │ WebSocket ready                 │
                      ▼                                 │
                 ┌──────────┐                           │
          ┌─────►│recording │                           │
          │      └────┬─────┘                           │
          │           │ stop() / VAD 静音               │
          │           ▼                                 │
          │      ┌──────────┐                           │
          │      │stopping  │─── 最终结果到达 ─────────►│
          │      └────┬─────┘                           │
          │           │ 超时(3s)                        │
          │           ▼                                 │
          │      ┌──────────┐                           │
          │      │error     │──────────────────────────►│
          │      └──────────┘                           │
          │                                             │
          └── 重试（用户点击重新录音）──────────────────┘
```

### 7.2 TTS 播放状态机

```
                 ┌──────────┐
          ┌─────►│  idle    │
          │      └────┬─────┘
          │           │ speak(text)
          │           ▼
          │      ┌──────────┐
          │      │ loading  │─── 合成失败 ─────► error → idle
          │      └────┬─────┘
          │           │ 音频就绪
          │           ▼
          │      ┌──────────┐
          │      │ playing  │─── stop() ──────► idle
          │      └────┬─────┘
          │           │ 播放完成
          │           ▼
          │      ┌──────────┐
          └──────│completed │ ── speak(next) ──► loading
                 └──────────┘
```

### 7.3 发音评测状态机

```
  idle → showing_target → recording → assessing → showing_result → idle
                ▲               │           │           │
                │               │           │           │
                └── retry ──────┘           │           │
                └───────────────────────────┘           │
                └───────────────────────────────────────┘
```

---

## 8. 错误处理

### 8.1 错误码体系

| 错误码 | HTTP 状态 | 说明 | 客户端处理 |
|--------|----------|------|-----------|
| `VOICE_LIMIT_EXCEEDED` | 429 | 当日调用量已达上限 | 提示升级会员或明天再来 |
| `VOICE_AUDIO_TOO_LONG` | 400 | 音频超过最大时长 | 提示缩短录音 |
| `VOICE_AUDIO_TOO_SHORT` | 400 | 音频过短（<0.3s） | 提示录音时间不足 |
| `VOICE_AUDIO_FORMAT_ERROR` | 400 | 音频格式不支持 | 提示检查录音权限 |
| `VOICE_TEXT_TOO_LONG` | 400 | TTS 文本超过 5000 字符 | 自动截断分段合成 |
| `VOICE_PROVIDER_UNAVAILABLE` | 503 | 供应商服务不可用 | 自动降级 / 提示稍后重试 |
| `VOICE_PROVIDER_TIMEOUT` | 504 | 供应商响应超时 | 重试一次 / 降级 |
| `VOICE_WS_AUTH_FAILED` | 401 | WebSocket 认证失败 | 刷新 token 重连 |
| `VOICE_RECORDER_PERMISSION` | - | 客户端录音权限被拒 | 引导用户开启权限 |
| `VOICE_MIC_BUSY` | - | 麦克风被其他应用占用 | 提示关闭其他录音应用 |
| `PRON_REFERENCE_MISMATCH` | 400 | 评测音频与参考文本严重不匹配 | 提示重新朗读 |
| `PRON_AUDIO_QUALITY` | 400 | 音频质量过低（噪音过大） | 提示在安静环境录音 |

### 8.2 降级策略

```python
class VoiceDegradationManager:
    """语音服务降级管理"""
    
    # ASR 降级链
    ASR_FALLBACK_CHAIN = {
        "premium": ["aliyun", "xunfei", "tencent"],
        "standard": ["aliyun", "tencent"],
        "free": ["tencent"],  # 免费用户用低成本引擎
    }
    
    # TTS 降级链
    TTS_FALLBACK_CHAIN = {
        "premium": ["aliyun", "xunfei", "tencent"],
        "standard": ["aliyun", "tencent"],
        "free": ["tencent", "local"],  # 免费用户最终降级到本地引擎
    }
    
    async def get_provider_with_fallback(
        self, 
        service: str, 
        tier: str,
        attempt: int = 0
    ) -> ProviderAdapter:
        """按降级链选择供应商"""
        chain = self._get_chain(service, tier)
        
        if attempt >= len(chain):
            # 全部降级失败
            if service == "tts" and tier == "free":
                # TTS 最终降级：返回本地引擎
                return LocalTTSProvider()
            raise VoiceAllProvidersFailedError(
                f"{service} 服务暂不可用，所有供应商均失败"
            )
        
        provider_name = chain[attempt]
        provider = self._create_provider(provider_name, service)
        
        # 检查健康状态
        if await self._is_healthy(provider_name, service):
            return provider
        
        # 不健康，尝试下一个
        return await self.get_provider_with_fallback(service, tier, attempt + 1)
```

### 8.3 客户端错误处理流程

```dart
/// 客户端统一错误处理器
class VoiceErrorHandler {
  
  static Future<void> handle(
    BuildContext context,
    VoiceError error,
  ) async {
    switch (error.code) {
      case 'VOICE_LIMIT_EXCEEDED':
        _showLimitDialog(context);
        break;
      case 'VOICE_RECORDER_PERMISSION':
        _showPermissionDialog(context);
        break;
      case 'VOICE_PROVIDER_UNAVAILABLE':
        _showRetrySnackBar(context, '语音服务暂不可用');
        break;
      case 'VOICE_MIC_BUSY':
        _showSnackBar(context, '麦克风被占用，请关闭其他录音应用');
        break;
      case 'VOICE_WS_AUTH_FAILED':
        // 自动刷新 token 并重连
        await _refreshTokenAndRetry();
        break;
      default:
        _showSnackBar(context, '语音服务异常，请稍后重试');
    }
  }
  
  static void _showLimitDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: Text('今日语音次数已用完'),
        content: Text('升级会员可获取更多语音使用次数'),
        actions: [
          TextButton(child: Text('知道了'), onPressed: () => Navigator.pop(context)),
          TextButton(child: Text('查看会员'), onPressed: () {
            Navigator.pop(context);
            Navigator.pushNamed(context, '/membership');
          }),
        ],
      ),
    );
  }
  
  static void _showPermissionDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: Text('需要录音权限'),
        content: Text('请在设置中开启麦克风权限以使用语音功能'),
        actions: [
          TextButton(child: Text('取消'), onPressed: () => Navigator.pop(context)),
          TextButton(child: Text('去设置'), onPressed: () {
            Navigator.pop(context);
            openAppSettings();  // open_app_settings 包
          }),
        ],
      ),
    );
  }
}
```

---

## 9. 分龄适配策略

### 9.1 音色选择策略

| 学段 | 默认音色（TTS） | 说明 |
|------|----------------|------|
| 幼儿（3-6岁） | `cn_child` 童声 | 亲和、活泼、语速偏慢 |
| 小学（6-12岁） | `cn_female_gentle` 温柔女声 | 清晰、鼓励式、语速适中 |
| 初中（12-15岁） | `cn_female_std` 标准女声 | 标准、简洁、信息密度高 |
| 高中（15-18岁） | `cn_female_std` 标准女声 | 专业、快速、无多余语气 |

### 9.2 ASR 语言模型适配

| 学段 | 语言模型 | 特殊处理 |
|------|---------|---------|
| 幼儿 | 儿童语音模型 | 容忍发音不标准、简化语法 |
| 小学 | 通用模型 | 强化拼音、常用词识别 |
| 初中 | 通用模型 + 学科词汇 | 数理化术语热词增强 |
| 高中 | 通用模型 + 学科词汇 | 专业术语热词增强、英语混合 |

### 9.3 VAD 参数调整

| 学段 | 静音超时 | 最大录音时长 | 说明 |
|------|---------|-------------|------|
| 幼儿 | 2500ms | 30s | 儿童语速慢，静音间隔长 |
| 小学 | 2000ms | 45s | 适中 |
| 初中 | 1500ms | 60s | 标准配置 |
| 高中 | 1200ms | 60s | 语速快，短静音即判定结束 |

---

## 10. 性能指标与容量规划

### 10.1 性能目标

| 指标 | 目标值 | 测量方法 |
|------|--------|---------|
| ASR 首结果延迟 | ≤800ms | 从用户停止说话到收到第一个 interim |
| ASR 最终结果延迟 | ≤1500ms | 从用户停止说话到收到 final |
| TTS 首音频延迟 | ≤500ms | 从发送文本到收到第一个音频帧 |
| 发音评测延迟 | ≤2000ms | 从上传音频到返回评分 |
| WebSocket 连接建立 | ≤300ms | 从发起连接到收到 ready |

### 10.2 容量估算（MVP 阶段）

```
假设：
- 日活用户 10,000
- 30% 使用语音功能（3,000 用户/天）
- 人均 ASR 5次、TTS 10次/天
- 平均 ASR 音频 5s、TTS 文本 100 字

日 ASR 请求：15,000 次 × 5s = 75,000s 音频 ≈ 21h
日 TTS 请求：30,000 次 × 100 字 = 3,000,000 字

并发峰值（晚8点）：
- 3,000 × 20% 同时在线 = 600
- 语音使用率 10% = 60 并发
- WebSocket 长连接：60 个

服务器资源：
- 2 核 4G × 2 实例（主备）足够
- Redis：单实例即可
- 对象存储：约 2GB/天（音频文件）
```

---

## 11. 安全与合规

### 11.1 音频数据安全

| 措施 | 说明 |
|------|------|
| 传输加密 | WebSocket 使用 WSS（TLS 1.2+） |
| 存储加密 | 对象存储启用服务端加密（AES-256） |
| 保留期限 | 音频文件保留 30 天后自动删除（合规要求） |
| 脱敏展示 | 后台查看语音记录时不展示原始音频 URL |
| 访问控制 | 音频 URL 使用签名 URL，有效期 10 分钟 |

### 11.2 内容安全

- ASR 识别结果需经过内容安全过滤（复用安全与内容合规系统）
- TTS 合成前检查文本内容安全性
- 发音评测的参考文本由系统控制，不接受用户自定义（防注入）

### 11.3 未成年人保护

- 幼儿/小学学段：语音交互需在家长模式下首次授权
- 录音时长限制：幼儿 ≤30s，小学 ≤45s
- 音频数据不用于模型训练（除非家长明确授权）

---

## 12. 与其他模块的集成

### 12.1 集成关系图

```
┌─────────────────┐     ┌─────────────────┐
│  AI 智能辅导     │────►│                 │
│  (语音提问/播报) │     │                 │
└─────────────────┘     │                 │
┌─────────────────┐     │   语音服务       │
│  拼音识字启蒙    │────►│  (ASR/TTS/Pron) │
│  (发音陪练)      │     │                 │
└─────────────────┘     │                 │     ┌──────────────┐
┌─────────────────┐     │                 │────►│ 供应商适配层  │
│  文科背诵       │────►│                 │     │ (阿里云/讯飞等)│
│  (背诵检测)      │     │                 │◄────│              │
└─────────────────┘     │                 │     └──────────────┘
┌─────────────────┐     │                 │
│  支付与会员     │────►│  用量计量       │
│  (额度校验)      │     │                 │
└─────────────────┘     └────────┬────────┘
┌─────────────────┐               │
│  安全与内容合规  │◄──────────────┘
│  (内容过滤)      │
└─────────────────┘
```

### 12.2 集成调用示例

```python
# AI 智能辅导模块调用语音服务

class AITutoringVoiceIntegration:
    """AI 辅导模块的语音集成"""
    
    def __init__(self, voice_service: VoiceService):
        self.voice = voice_service
    
    async def handle_voice_question(
        self, 
        user_id: int,
        audio: bytes,
        audio_format: str,
        conversation_id: str,
    ) -> AsyncGenerator[bytes, None]:
        """
        处理语音提问：
        1. ASR 识别语音
        2. AI 生成回答
        3. TTS 合成回答并流式返回
        
        Returns:
            TTS 音频流
        """
        # Step 1: ASR
        asr_result = await self.voice.asr_recognize(
            audio=audio,
            format=audio_format,
            language="zh",
            biz_type=VoiceBizType.ASR_QUESTION,
        )
        
        if asr_result.confidence < 0.5:
            yield self._tts_single("抱歉，没有听清楚，请再说一次。")
            return
        
        question_text = asr_result.text
        
        # Step 2: AI 生成回答（流式）
        answer_stream = self.ai_service.chat_stream(
            user_id=user_id,
            question=question_text,
            conversation_id=conversation_id,
        )
        
        # Step 3: 流式 TTS（按句子切分）
        buffer = ""
        async for token in answer_stream:
            buffer += token
            # 遇到句子结束符则合成
            if buffer[-1] in "。！？；\n":
                async for audio_chunk in self.voice.tts_stream(
                    text=buffer,
                    voice_type=self._get_voice_for_user(user_id),
                    biz_type=VoiceBizType.TTS_ANSWER,
                ):
                    yield audio_chunk
                buffer = ""
        
        # 处理剩余文本
        if buffer.strip():
            async for audio_chunk in self.voice.tts_stream(
                text=buffer, 
                voice_type=self._get_voice_for_user(user_id),
                biz_type=VoiceBizType.TTS_ANSWER,
            ):
                yield audio_chunk
```

---

## 13. 开发排期建议

| 阶段 | 内容 | 工期 |
|------|------|------|
| **P0-a** | 服务端基础框架 + ASR 非流式 + TTS 非流式 + 单供应商（阿里云） | 1.5 周 |
| **P0-b** | 客户端录音/播放 SDK + WebSocket 流式 ASR + 流式 TTS | 1.5 周 |
| **P0-c** | AI 辅导语音集成 + 录音按钮 UI + 播放控件 | 1 周 |
| **P1-a** | 多供应商适配（讯飞、腾讯云）+ 降级策略 | 1 周 |
| **P1-b** | 发音评测（拼音/单词）+ 拼音识字启蒙集成 | 1.5 周 |
| **P1-c** | 用量计量 + 限流 + 管理后台供应商配置 | 0.5 周 |
| **P2-a** | 长语音识别（背诵场景）+ 离线 TTS 降级 | 1 周 |
| **P2-b** | 分龄音色/参数策略优化 + 音色试听 | 0.5 周 |

**总计**：约 8.5 周（P0 约 4 周，P1 约 3 周，P2 约 1.5 周）

---

## 附录 A：供应商能力对比

| 能力 | 阿里云 | 腾讯云 | 讯飞 | Google Cloud |
|------|--------|--------|------|-------------|
| 中文 ASR | ★★★★★ | ★★★★ | ★★★★★ | ★★★ |
| 英文 ASR | ★★★★ | ★★★★ | ★★★ | ★★★★★ |
| 儿童语音识别 | ★★★ | ★★★ | ★★★★★ | ★★ |
| 流式 ASR | ✅ | ✅ | ✅ | ✅ |
| 中文 TTS | ★★★★★ | ★★★★ | ★★★★ | ★★ |
| 童声 TTS | ✅ | ✅ | ✅ | ❌ |
| 流式 TTS | ✅ | ✅ | ✅ | ✅ |
| 拼音发音评测 | ❌ | ★★★ | ★★★★★ | ❌ |
| 英文发音评测 | ★★★★ | ★★★★ | ★★★★ | ★★★★★ |
| 中英混合识别 | ★★★★ | ★★★ | ★★★★ | ★★★★ |
| 价格（ASR） | 中 | 低 | 中 | 高 |
| 价格（TTS） | 低 | 低 | 中 | 高 |

**推荐组合**：
- **ASR 主力**：阿里云（性价比高，中文效果好）
- **ASR 备用**：讯飞（儿童语音强）
- **TTS 主力**：阿里云（音色丰富，价格低）
- **TTS 备用**：腾讯云（价格低）
- **发音评测**：讯飞（中文拼音评测最成熟）

---

## 附录 B：音频格式规范

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| 采样率 | 16000 Hz | 语音识别标准采样率 |
| 位深 | 16 bit | PCM 标准位深 |
| 声道 | 单声道 | 语音场景无需立体声 |
| 编码格式 | PCM（流式）/ MP3（非流式） | PCM 低延迟，MP3 压缩省带宽 |
| 比特率（MP3） | 32 kbps | 语音场景足够 |
| 最大文件大小 | 10 MB | 非流式上传限制 |

PCM 数据量计算：16000 Hz × 16 bit × 1 声道 = 32 KB/s

60 秒录音 ≈ 1.92 MB（PCM）≈ 240 KB（MP3 32kbps）
