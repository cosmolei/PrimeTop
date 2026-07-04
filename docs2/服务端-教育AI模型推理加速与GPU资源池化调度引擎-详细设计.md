# 服务端 - 教育AI模型推理加速与GPU资源池化调度引擎 详细设计

## 1. 概述

### 1.1 模块定位

本模块是 PrimeTop AI 基础设施层的核心引擎，负责管理所有 AI 模型（LLM、Embedding、OCR、ASR/TTS、多模态）的推理服务、GPU 资源调度、推理加速优化和成本控制。它是连接上层业务服务（AI 辅导、拍题答疑、作文批改等）与底层 GPU 算力的关键中间层。

### 1.2 核心职责

| 职责 | 说明 |
|------|------|
| 模型生命周期管理 | 模型加载、卸载、版本切换、灰度发布 |
| GPU 资源池化 | 多节点 GPU 统一管理、显存分配、共享调度 |
| 推理加速 | 动态批处理、KV-Cache 复用、量化推理、推测解码 |
| 流量调度 | 多模型路由、负载均衡、优先级队列、限流降级 |
| 成本优化 | 推理资源利用率最大化、弹性扩缩容、Spot 实例利用 |
| 质量监控 | 推理延迟、吞吐量、成功率、GPU 利用率监控 |

### 1.3 依赖关系

```
┌─────────────────────────────────────────────────────────┐
│              上层业务服务                                │
│  AI辅导对话  拍题答疑  作文批改  语音服务  RAG检索       │
└──────────────┬──────────────────────────┬───────────────┘
               │                          │
               ▼                          ▼
┌─────────────────────────────────────────────────────────┐
│         AI 模型推理加速与GPU资源调度引擎                  │
│  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────────────┐ │
│  │模型路由 │ │批处理    │ │GPU调度  │ │推理加速      │ │
│  │  引擎   │ │调度器    │ │  器     │ │引擎          │ │
│  └─────────┘ └──────────┘ └─────────┘ └──────────────┘ │
│  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────────────┐ │
│  │模型仓库 │ │监控告警  │ │弹性扩   │ │成本核算      │ │
│  │  管理   │ │  体系    │ │缩容     │ │引擎          │ │
│  └─────────┘ └──────────┘ └─────────┘ └──────────────┘ │
└─────────────────────────────────────────────────────────┘
               │                          │
               ▼                          ▼
┌─────────────────────────────────────────────────────────┐
│              GPU 算力层                                  │
│  GPU Node-1 (A100×8)   GPU Node-2 (A100×4)             │
│  GPU Node-3 (L40S×4)   CPU Inference Node              │
└─────────────────────────────────────────────────────────┘
```

**上游依赖（被调用方）：**
- AI 对话引擎、拍照搜题服务、作文批改服务、语音服务、RAG 检索系统

**下游依赖（调用方）：**
- 容器编排平台（Kubernetes）
- 模型仓库（MinIO / HuggingFace Hub 私有镜像）
- 监控系统（Prometheus + Grafana）
- 分布式缓存（Redis）

### 1.4 设计目标

| 指标 | 目标值 |
|------|--------|
| LLM 首 Token 延迟 (P95) | ≤ 800ms |
| LLM 生成速度 | ≥ 50 tokens/s（7B 模型） |
| Embedding 批量推理吞吐 | ≥ 5000 req/s（单 GPU） |
| GPU 平均利用率 | ≥ 70% |
| 模型冷启动时间 | ≤ 30s（含权重加载） |
| 推理服务可用性 | ≥ 99.9% |
| 推理成本（每千次 LLM 调用） | ≤ ¥2.5 |

---

## 2. 整体架构

### 2.1 系统架构图

```
                    ┌──────────────────────────────────┐
                    │        API Gateway / BFF         │
                    └──────────────┬───────────────────┘
                                   │
                    ┌──────────────▼───────────────────┐
                    │    Inference Gateway (Go)        │
                    │  ┌──────────┐  ┌──────────────┐  │
                    │  │  认证    │  │  限流/熔断   │  │
                    │  │  鉴权    │  │  降级        │  │
                    │  └──────────┘  └──────────────┘  │
                    │  ┌──────────┐  ┌──────────────┐  │
                    │  │  请求    │  │  响应        │  │
                    │  │  路由    │  │  聚合        │  │
                    │  └──────────┘  └──────────────┘  │
                    └──────┬──────────────┬────────────┘
                           │              │
           ┌───────────────▼──┐   ┌───────▼──────────────┐
           │  模型路由决策器   │   │   批处理调度器        │
           │  (Model Router)  │   │  (Batch Scheduler)    │
           │                  │   │                       │
           │  - 意图识别      │   │  - 动态批处理         │
           │  - 模型选择      │   │  - 优先级队列         │
           │  - SLA 匹配      │   │  - 超时淘汰           │
           │  - 成本最优      │   │  - 显存感知           │
           └────────┬─────────┘   └────────┬──────────────┘
                    │                      │
           ┌────────▼──────────────────────▼──────────────┐
           │          GPU 资源调度器                       │
           │          (GPU Scheduler)                     │
           │                                             │
           │  - 节点选择    - 显存管理    - 模型放置      │
           │  - 负载均衡    - 抢占调度    - 弹性扩缩      │
           └────────┬────────────────────────────────────┘
                    │
     ┌──────────────▼──────────────────────────────────┐
     │              推理引擎层                          │
     │                                                 │
     │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐│
     │  │ vLLM     │ │TGI       │ │Triton Inference  ││
     │  │ Engine   │ │Engine    │ │Server            ││
     │  │ (LLM)    │ │(LLM)     │ │(Embedding/OCR)   ││
     │  └──────────┘ └──────────┘ └──────────────────┘│
     │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐│
     │  │Whisper   │ │VITS/TTS  │ │CLIP/Qwen-VL      ││
     │  │(ASR)     │ │Engine    │ │(Multimodal)      ││
     │  └──────────┘ └──────────┘ └──────────────────┘│
     └─────────────────────────────────────────────────┘
```

### 2.2 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| LLM 推理引擎 | **vLLM** (主) / **TGI** (备) | vLLM 的 PagedAttention 吞吐量最高；TGI 作为容灾备份 |
| 通用推理服务 | **NVIDIA Triton Inference Server** | 多框架支持（TensorRT/ONNX/PyTorch），适合 Embedding/OCR 等非 LLM 模型 |
| GPU 集群编排 | **Kubernetes + GPU Operator** | 行业标准，弹性扩缩容成熟 |
| 模型仓库 | **MinIO** (私有 S3) + **HF Hub Mirror** | 兼容 S3 协议，支持大文件分块传输 |
| 监控 | **Prometheus + Grafana + DCGM Exporter** | GPU 级别监控（DCGM），生态丰富 |
| 流量网关 | **自研 Go 网关** | 需要 SSE 流式透传 + 动态批处理深度定制 |
| 消息队列 | **Redis Streams** | 低延迟队列，适合推理批处理场景 |
| 配置中心 | **Etcd** | 模型路由策略、批处理参数实时下发 |

---

## 3. 数据模型

### 3.1 模型注册表 (Model Registry)

```sql
-- 模型定义表
CREATE TABLE inference_model (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    model_key       VARCHAR(128) NOT NULL UNIQUE COMMENT '唯一标识: qwen2.5-7b-instruct',
    model_name      VARCHAR(256) NOT NULL COMMENT '展示名称',
    model_type      VARCHAR(32)  NOT NULL COMMENT 'LLM / EMBEDDING / OCR / ASR / TTS / MULTIMODAL',
    framework       VARCHAR(32)  NOT NULL COMMENT 'VLLM / TGI / TRITON / CUSTOM',
    
    -- 模型文件信息
    model_path      VARCHAR(512) NOT NULL COMMENT '模型权重路径 (s3://bucket/path)',
    tokenizer_path  VARCHAR(512) COMMENT '分词器路径',
    config_path     VARCHAR(512) COMMENT '模型配置路径',
    quantization    VARCHAR(32)  DEFAULT 'none' COMMENT 'none / awq / gptq / int8 / int4',
    
    -- 推理参数默认值
    max_model_len   INT          DEFAULT 32768 COMMENT '模型最大上下文长度',
    gpu_memory_util FLOAT        DEFAULT 0.90  COMMENT 'GPU显存利用率上限',
    max_num_seqs    INT          DEFAULT 256   COMMENT '最大并发序列数',
    dtype           VARCHAR(16)  DEFAULT 'auto' COMMENT 'float16 / bfloat16 / auto',
    
    -- 调度参数
    priority_weight INT          DEFAULT 1     COMMENT '调度优先级权重',
    min_replicas    INT          DEFAULT 1     COMMENT '最小副本数',
    max_replicas    INT          DEFAULT 4     COMMENT '最大副本数',
    target_gpu      VARCHAR(64)  DEFAULT 'any' COMMENT 'A100 / L40S / any',
    
    -- 状态
    status          VARCHAR(16)  DEFAULT 'registered' COMMENT 'registered / loading / ready / draining / stopped / failed',
    version         VARCHAR(32)  NOT NULL COMMENT '模型版本号',
    checksum        VARCHAR(128) COMMENT '权重文件SHA256校验值',
    
    created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_type_status (model_type, status),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI模型注册表';
```

### 3.2 GPU 节点表

```sql
-- GPU节点注册表
CREATE TABLE gpu_node (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    node_name       VARCHAR(128) NOT NULL UNIQUE COMMENT '节点名称: gpu-node-01',
    node_ip         VARCHAR(64)  NOT NULL COMMENT '节点IP',
    
    -- 硬件信息
    gpu_type        VARCHAR(64)  NOT NULL COMMENT 'A100-80G / A100-40G / L40S / A10',
    gpu_count       INT          NOT NULL COMMENT 'GPU数量',
    total_vram_mb   INT          NOT NULL COMMENT '总显存(MB)',
    cpu_cores       INT          NOT NULL COMMENT 'CPU核心数',
    memory_mb       INT          NOT NULL COMMENT '内存(MB)',
    
    -- 运行状态
    status          VARCHAR(16)  DEFAULT 'active' COMMENT 'active / draining / maintenance / offline',
    k8s_node_name   VARCHAR(128) COMMENT 'K8s节点名',
    availability_zone VARCHAR(32) COMMENT '可用区',
    
    -- 实时指标 (由心跳更新)
    used_vram_mb    INT          DEFAULT 0 COMMENT '已用显存(MB)',
    active_models   INT          DEFAULT 0 COMMENT '运行中模型数',
    gpu_utilization FLOAT        DEFAULT 0 COMMENT 'GPU利用率(0-1)',
    pending_requests INT         DEFAULT 0 COMMENT '排队请求数',
    
    -- 成本信息
    cost_per_hour   DECIMAL(10,2) NOT NULL COMMENT '每小时成本(元)',
    is_spot         BOOLEAN      DEFAULT FALSE COMMENT '是否Spot实例',
    
    last_heartbeat  DATETIME     COMMENT '最后心跳时间',
    created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_status_zone (status, availability_zone),
    INDEX idx_gpu_type (gpu_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='GPU节点表';
```

### 3.3 模型部署表

```sql
-- 模型部署实例表 (一个模型可在多个节点部署)
CREATE TABLE model_deployment (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    model_id        BIGINT       NOT NULL COMMENT '模型ID',
    node_id         BIGINT       NOT NULL COMMENT 'GPU节点ID',
    
    -- 部署信息
    replica_id      VARCHAR(128) NOT NULL UNIQUE COMMENT '副本标识: qwen-7b-r0-node1-gpu0',
    gpu_ids         JSON         NOT NULL COMMENT '使用的GPU: [0, 1]',
    allocated_vram_mb INT        NOT NULL COMMENT '分配显存(MB)',
    engine_type     VARCHAR(32)  NOT NULL COMMENT 'VLLM / TGI / TRITON',
    engine_version  VARCHAR(64)  NOT NULL COMMENT '引擎版本',
    
    -- 网络信息
    service_endpoint VARCHAR(256) NOT NULL COMMENT '推理服务地址: http://10.0.1.5:8000',
    health_endpoint VARCHAR(256) NOT NULL COMMENT '健康检查地址',
    metrics_port    INT          DEFAULT 9090,
    
    -- 运行状态
    status          VARCHAR(16)  DEFAULT 'pending' COMMENT 'pending / loading / ready / draining / failed / terminated',
    loaded_at       DATETIME     COMMENT '模型加载完成时间',
    
    -- 实时指标
    active_sequences INT         DEFAULT 0 COMMENT '活跃推理序列数',
    queued_requests  INT         DEFAULT 0 COMMENT '排队请求数',
    avg_latency_ms   FLOAT       DEFAULT 0 COMMENT '平均延迟(ms)',
    tokens_per_sec   FLOAT       DEFAULT 0 COMMENT '生成速度(tokens/s)',
    
    error_message   TEXT         COMMENT '错误信息',
    
    created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_model_replica (model_id, replica_id),
    INDEX idx_status (status),
    INDEX idx_node (node_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='模型部署实例表';
```

### 3.4 推理请求审计表

```sql
-- 推理调用记录表 (用于计费、分析、质量追踪)
CREATE TABLE inference_request_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    request_id      VARCHAR(64)  NOT NULL UNIQUE COMMENT '请求唯一ID',
    trace_id        VARCHAR(64)  NOT NULL COMMENT '链路追踪ID',
    
    -- 调用方信息
    caller_service  VARCHAR(64)  NOT NULL COMMENT 'ai-tutor / photo-search / essay-grading...',
    user_id         BIGINT       COMMENT '用户ID (可空)',
    
    -- 模型信息
    model_key       VARCHAR(128) NOT NULL COMMENT '调用的模型',
    deployment_id   BIGINT       COMMENT '部署实例ID',
    node_name       VARCHAR(128) COMMENT 'GPU节点名',
    
    -- 性能指标
    input_tokens    INT          DEFAULT 0 COMMENT '输入Token数',
    output_tokens   INT          DEFAULT 0 COMMENT '输出Token数',
    queue_wait_ms   INT          DEFAULT 0 COMMENT '排队等待(ms)',
    inference_ms    INT          DEFAULT 0 COMMENT '推理耗时(ms)',
    total_latency_ms INT         DEFAULT 0 COMMENT '总延迟(ms)',
    time_to_first_token_ms INT   DEFAULT 0 COMMENT '首Token延迟(ms)',
    
    -- 结果
    status          VARCHAR(16)  NOT NULL COMMENT 'success / failed / timeout / cancelled',
    error_code      VARCHAR(32)  COMMENT '错误码',
    error_message   TEXT         COMMENT '错误信息',
    
    -- 成本
    compute_cost   DECIMAL(10,6) DEFAULT 0 COMMENT '计算成本(元)',
    
    created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_model_time (model_key, created_at),
    INDEX idx_caller_time (caller_service, created_at),
    INDEX idx_trace (trace_id),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='推理请求日志'
PARTITION BY RANGE (TO_DAYS(created_at)) (
    PARTITION p_202607 VALUES LESS THAN (TO_DAYS('2026-08-01')),
    PARTITION p_202608 VALUES LESS THAN (TO_DAYS('2026-09-01')),
    PARTITION p_max VALUES LESS THAN MAXVALUE
);
```

### 3.5 Redis 缓存结构

```
# GPU 节点实时状态 (Hash, TTL: 10s 心跳更新)
gpu:node:{nodeId}:status → {
    "usedVram": 65536,      # MB
    "gpuUtil": 0.75,        # 0-1
    "activeModels": 3,
    "pendingReqs": 12,
    "vramBreakdown": {       # 各模型显存占用
        "qwen-7b": 32768,
        "bge-large": 4096,
        "qwen-vl": 28672
    }
}

# 模型部署健康状态 (Hash, TTL: 5s)
model:deploy:{replicaId}:health → {
    "status": "ready",
    "activeSeqs": 45,
    "queueDepth": 3,
    "avgLatencyMs": 320,
    "tokensPerSec": 68.5,
    "lastError": null
}

# 批处理队列 (Sorted Set, 按优先级+时间戳排序)
batch:queue:{modelKey} → [
    {"score": 1001, "member": "req_id_1"},  # score = priority * 10000 + timestamp
    {"score": 1002, "member": "req_id_2"}
]

# 推理结果缓存 (String, TTL: 根据模型类型)
inference:cache:{sha256(prompt + model_key + params)} → "cached_response_json"

# 模型路由策略 (Hash, 持久化)
model:route:strategy → {
    "default_llm": "qwen2.5-7b-instruct",
    "reasoning_llm": "qwen2.5-72b-instruct",
    "embedding": "bge-large-zh-v1.5",
    "ocr": "paddleocr-server",
    "asr": "whisper-large-v3",
    "tts": "cosyvoice-300m",
    "multimodal": "qwen2-vl-7b"
}

# 限流计数器 (滑动窗口)
ratelimit:inference:{caller_service}:{minute} → count
```

---

## 4. 核心模块设计

### 4.1 模型路由决策器 (Model Router)

#### 4.1.1 职责

接收上层推理请求，根据请求特征（学科、难度、学段、SLA 要求、成本约束）智能选择最优模型和部署实例。

#### 4.1.2 路由决策流程

```
                         ┌─────────────┐
                         │ 推理请求     │
                         │ (含场景标签) │
                         └──────┬──────┘
                                │
                         ┌──────▼──────┐
                         │ 1. 场景识别 │
                         │ 解析请求中的 │
                         │ 学科/学段/   │
                         │ 难度/意图    │
                         └──────┬──────┘
                                │
                         ┌──────▼──────┐
                         │ 2. 模型匹配 │
                         │ 从策略表查   │
                         │ 可选模型列表 │
                         └──────┬──────┘
                                │
                    ┌───────────┼───────────┐
                    │           │           │
             ┌──────▼──┐ ┌─────▼────┐ ┌────▼─────┐
             │3a. SLA  │ │3b. 成本  │ │3c. 负载  │
             │ 匹配    │ │ 最优     │ │ 均衡     │
             │延迟要求 │ │选便宜模型│ │选空闲实例│
             └──────┬──┘ └─────┬────┘ └────┬─────┘
                    └───────────┼───────────┘
                                │
                         ┌──────▼──────┐
                         │ 4. 综合评分 │
                         │ 加权排序选  │
                         │ 最优部署    │
                         └──────┬──────┘
                                │
                         ┌──────▼──────┐
                         │ 5. 熔断检查 │
                         │ 健康检查+   │
                         │ 限流检查    │
                         └──────┬──────┘
                                │
                    ┌───────────┼───────────┐
                    │                       │
             ┌──────▼──────┐       ┌────────▼────────┐
             │ 正常路由    │       │ 降级路由        │
             │ 转发到选中  │       │ 备选模型或      │
             │ 部署实例    │       │ 外部API兜底     │
             └─────────────┘       └─────────────────┘
```

#### 4.1.3 路由策略配置

```python
# 路由策略 YAML 配置 (存储于 Etcd, 热更新)
route_strategies:
  # 默认 LLM 路由
  - scene: "default_chat"
    model_candidates:
      - model_key: "qwen2.5-7b-instruct"
        weight: 70           # 70% 流量
        priority: 1
        max_latency_ms: 2000
      - model_key: "qwen2.5-14b-instruct"
        weight: 25           # 25% 流量 (灰度)
        priority: 1
        max_latency_ms: 3000
      - model_key: "qwen2.5-72b-instruct"
        weight: 5            # 5% 流量 (高质量场景)
        priority: 2
        max_latency_ms: 5000

  # 数学/理科深度推理
  - scene: "reasoning_math"
    model_candidates:
      - model_key: "qwen2.5-72b-instruct"
        weight: 60
        priority: 1
      - model_key: "qwen2.5-14b-instruct"
        weight: 40
        priority: 1
        fallback: true       # 72B 不可用时降级

  # 作文批改
  - scene: "essay_grading"
    model_candidates:
      - model_key: "qwen2.5-14b-instruct"
        weight: 100
        priority: 1

  # Embedding 向量化
  - scene: "embedding"
    model_candidates:
      - model_key: "bge-large-zh-v1.5"
        weight: 100
        priority: 1

  # 多模态理解
  - scene: "multimodal"
    model_candidates:
      - model_key: "qwen2-vl-7b"
        weight: 100
        priority: 1

  # 外部 API 兜底 (自有推理不可用时)
  fallback_apis:
    - provider: "openai_compatible"
      endpoint: "${FALLBACK_API_URL}"
      api_key: "${FALLBACK_API_KEY}"
      models: ["gpt-4o-mini"]
      trigger: "all_internal_failed"
```

#### 4.1.4 核心代码：路由决策器

```python
"""
模型路由决策器 - 根据请求场景和实时状态选择最优推理实例
"""
import time
import hashlib
import random
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

class SceneType(Enum):
    DEFAULT_CHAT = "default_chat"
    REASONING_MATH = "reasoning_math"
    REASONING_PHYSICS = "reasoning_physics"
    ESSAY_GRADING = "essay_grading"
    OCR_RECOGNITION = "ocr_recognition"
    EMBEDDING = "embedding"
    MULTIMODAL = "multimodal"
    ASR = "asr"
    TTS = "tts"

class RequestPriority(Enum):
    CRITICAL = 0    # 实时交互 (AI对话, 拍题)
    HIGH = 1        # 高优先级 (作文批改, 学情计算)
    NORMAL = 2      # 普通 (批量Embedding, 后台任务)
    LOW = 3         # 低 (离线分析, 模型评测)

@dataclass
class InferenceRequest:
    """推理请求"""
    request_id: str
    scene: SceneType
    priority: RequestPriority
    prompt: str
    images: list[str] = field(default_factory=list)
    max_tokens: int = 2048
    temperature: float = 0.7
    stream: bool = False
    
    # 上下文信息
    user_id: Optional[int] = None
    grade_level: Optional[str] = None   # "小学三年级" / "高中一年级"
    subject: Optional[str] = None        # "数学" / "语文"
    caller_service: str = ""
    
    # SLA 约束
    max_latency_ms: int = 5000
    cost_budget: float = 0.05            # 单次调用成本上限(元)

@dataclass
class RouteDecision:
    """路由决策结果"""
    model_key: str
    deployment_id: int
    endpoint: str
    estimated_latency_ms: int
    estimated_cost: float
    is_fallback_api: bool = False
    cache_hit: bool = False
    cache_key: Optional[str] = None


class ModelRouter:
    """模型路由决策器"""
    
    def __init__(self, etcd_client, redis_client, db_client):
        self.etcd = etcd_client          # 策略配置
        self.redis = redis_client        # 实时状态
        self.db = db_client              # 模型注册表
        
    async def route(self, request: InferenceRequest) -> RouteDecision:
        """主路由入口"""
        
        # Step 1: 检查推理缓存 (仅对非流式、确定性请求)
        if not request.stream and request.temperature < 0.1:
            cache_key = self._compute_cache_key(request)
            cached = await self.redis.get(f"inference:cache:{cache_key}")
            if cached:
                return RouteDecision(
                    model_key="cached",
                    deployment_id=0,
                    endpoint="",
                    estimated_latency_ms=0,
                    estimated_cost=0,
                    cache_hit=True,
                    cache_key=cache_key
                )
        
        # Step 2: 获取路由策略
        strategy = await self._get_strategy(request.scene)
        if not strategy:
            raise RoutingError(f"No strategy for scene: {request.scene}")
        
        # Step 3: 获取所有候选模型的可用部署
        candidates = []
        for candidate in strategy["model_candidates"]:
            deployments = await self._get_healthy_deployments(
                candidate["model_key"]
            )
            for dep in deployments:
                score = self._score_deployment(dep, candidate, request)
                candidates.append((dep, candidate, score))
        
        if not candidates:
            # 所有内部模型不可用, 走外部 API 兜底
            return await self._fallback_to_external(request)
        
        # Step 4: 加权随机选择 (避免单点过载)
        candidates.sort(key=lambda x: x[2], reverse=True)
        selected = self._weighted_select(candidates)
        
        return RouteDecision(
            model_key=selected[0]["model_key"],
            deployment_id=selected[1]["id"],
            endpoint=selected[1]["service_endpoint"],
            estimated_latency_ms=self._estimate_latency(selected[1], request),
            estimated_cost=self._estimate_cost(selected[0], request)
        )
    
    def _score_deployment(self, deployment, candidate, request) -> float:
        """综合评分: 负载(40%) + 延迟(30%) + 成本(20%) + 优先级(10%)"""
        # 负载评分 (越空闲越高)
        load_ratio = deployment["active_sequences"] / deployment["max_seqs"]
        load_score = max(0, 1.0 - load_ratio) * 40
        
        # 延迟评分
        latency = deployment.get("avg_latency_ms", 1000)
        latency_score = max(0, 1.0 - latency / request.max_latency_ms) * 30
        
        # 成本评分 (越便宜越高)
        cost = deployment.get("cost_per_1k_tokens", 0.01)
        cost_score = max(0, 1.0 - cost / request.cost_budget) * 20
        
        # 优先级评分
        priority_score = (4 - candidate.get("priority", 2)) * 2.5
        
        return load_score + latency_score + cost_score + priority_score
    
    def _compute_cache_key(self, request: InferenceRequest) -> str:
        """计算推理缓存键"""
        content = f"{request.scene.value}|{request.prompt}|{request.max_tokens}"
        return hashlib.sha256(content.encode()).hexdigest()
    
    async def _get_healthy_deployments(self, model_key: str) -> list[dict]:
        """从 Redis 获取模型健康部署实例"""
        pattern = f"model:deploy:{model_key}:*:health"
        keys = await self.redis.keys(pattern)
        healthy = []
        for key in keys:
            health = await self.redis.hgetall(key)
            if health.get("status") == "ready":
                healthy.append(health)
        return healthy
    
    async def _fallback_to_external(self, request: InferenceRequest) -> RouteDecision:
        """外部 API 兜底"""
        fallback_config = await self.etcd.get("/inference/fallback_apis")
        if not fallback_config:
            raise RoutingError("All inference backends unavailable")
        
        api = fallback_config[0]  # 取第一个可用的
        return RouteDecision(
            model_key=api["models"][0],
            deployment_id=-1,
            endpoint=api["endpoint"],
            estimated_latency_ms=3000,
            estimated_cost=0.02,
            is_fallback_api=True
        )
```

### 4.2 动态批处理调度器 (Batch Scheduler)

#### 4.2.1 设计目标

将短时间内到达的多个独立推理请求合并为一个批次 (batch) 同时推理，充分利用 GPU 并行能力，大幅提升吞吐量。

#### 4.2.2 批处理策略

```
 时间轴 ──────────────────────────────────────────────►
 
 T+0ms     T+5ms     T+10ms    T+15ms    T+20ms    T+25ms
   │         │         │         │         │         │
   ▼         ▼         ▼         ▼         ▼         ▼
  req1      req2      req3      req4      req5     [触发]
                                                     │
                                          ┌──────────┘
                                          ▼
                          ┌─────────────────────────┐
                          │    Batch [req1~req5]    │
                          │  统一 padding + 推理     │
                          │  共享 KV-Cache 前缀      │
                          └────────────┬────────────┘
                                       │
                          ┌────────────▼────────────┐
                          │  分发结果到各请求 SSE    │
                          └─────────────────────────┘
```

**触发条件（满足任一即提交批次）：**
1. 批次大小达到 `max_batch_size`（如 32）
2. 等待时间达到 `max_wait_ms`（如 50ms）
3. 批次总 Token 数达到 `max_batch_tokens`（如 8192）
4. 存在 `CRITICAL` 优先级请求（立即提交）

#### 4.2.3 优先级队列设计

```python
"""
动态批处理调度器
使用多级反馈队列 + 显存感知调度
"""
import asyncio
import time
from dataclasses import dataclass
from collections import defaultdict

@dataclass
class PendingRequest:
    request_id: str
    prompt_tokens: list[int]   # 已编码的token ids
    max_new_tokens: int
    priority: int              # 0=Critical, 1=High, 2=Normal, 3=Low
    arrival_time: float        # 到达时间戳
    future: asyncio.Future     # 结果Future
    scene: str
    stream: bool = False

class BatchScheduler:
    """动态批处理调度器"""
    
    def __init__(self, config: dict):
        self.max_batch_size = config.get("max_batch_size", 32)
        self.max_batch_tokens = config.get("max_batch_tokens", 8192)
        self.max_wait_ms = config.get("max_wait_ms", 50)
        self.critical_max_wait_ms = config.get("critical_max_wait_ms", 5)
        
        # 多级优先级队列 {priority: [PendingRequest]}
        self.queues: dict[int, list[PendingRequest]] = defaultdict(list)
        self.lock = asyncio.Lock()
        
        # 统计
        self.stats = {
            "total_batched": 0,
            "total_requests": 0,
            "avg_batch_size": 0,
            "avg_wait_ms": 0
        }
    
    async def submit(self, req: PendingRequest):
        """提交推理请求到调度队列"""
        async with self.lock:
            self.queues[req.priority].append(req)
            self.stats["total_requests"] += 1
    
    async def try_form_batch(self) -> list[PendingRequest] | None:
        """尝试组建一个批次"""
        async with self.lock:
            now = time.time() * 1000  # ms
            batch = []
            batch_token_count = 0
            
            # 按优先级从高到低遍历队列
            for priority in sorted(self.queues.keys()):
                queue = self.queues[priority]
                remaining = []
                
                for req in queue:
                    # 检查是否超时 (该优先级的最大等待时间)
                    max_wait = (self.critical_max_wait_ms if priority == 0 
                               else self.max_wait_ms)
                    wait_time = now - req.arrival_time * 1000
                    
                    should_dispatch = (
                        len(batch) >= self.max_batch_size or           # 批次已满
                        batch_token_count + len(req.prompt_tokens) > self.max_batch_tokens
                    )
                    
                    if should_dispatch and batch:
                        # 当前批次已满, 请求留在队列里
                        remaining.append(req)
                        continue
                    
                    # 加入批次
                    batch.append(req)
                    batch_token_count += len(req.prompt_tokens)
                    
                    # 批次满足提交条件
                    if (len(batch) >= self.max_batch_size or
                        batch_token_count >= self.max_batch_tokens):
                        break
                
                self.queues[priority] = remaining + queue[len(batch):]
                
                if len(batch) >= self.max_batch_size:
                    break
            
            # 检查是否有 CRITICAL 请求触发立即提交
            if not batch and self.queues.get(0):
                critical_wait = now - self.queues[0][0].arrival_time * 1000
                if critical_wait >= self.critical_max_wait_ms:
                    batch.append(self.queues[0].pop(0))
            
            # 检查超时提交
            if not batch:
                for priority in sorted(self.queues.keys()):
                    if self.queues[priority]:
                        req = self.queues[priority][0]
                        wait_time = now - req.arrival_time * 1000
                        max_wait = (self.critical_max_wait_ms if priority == 0 
                                   else self.max_wait_ms)
                        if wait_time >= max_wait:
                            batch.append(self.queues[priority].pop(0))
                        break
            
            if batch:
                self.stats["total_batched"] += len(batch)
                self.stats["avg_batch_size"] = (
                    self.stats["avg_batch_size"] * 0.9 + len(batch) * 0.1
                )
            
            return batch if batch else None
    
    async def run(self, inference_callback):
        """调度循环"""
        while True:
            batch = await self.try_form_batch()
            if batch:
                # 异步提交推理
                asyncio.create_task(inference_callback(batch))
            else:
                await asyncio.sleep(0.001)  # 1ms 空转
```

### 4.3 GPU 资源调度器 (GPU Scheduler)

#### 4.3.1 模型放置策略

```
┌──────────────────────────────────────────────────────────────┐
│                    GPU Node-1 (A100-80G ×8)                  │
│                                                              │
│  GPU 0        GPU 1        GPU 2-3       GPU 4-7            │
│  ┌────────┐  ┌────────┐  ┌──────────┐  ┌──────────────┐    │
│  │Qwen-7B │  │BGE-    │  │Qwen-VL   │  │Qwen-72B      │    │
│  │(16GB)  │  │Large   │  │(40GB,    │  │(140GB,       │    │
│  │        │  │(4GB)   │  │ TP=2)    │  │  TP=4)       │    │
│  │        │  │        │  │          │  │              │    │
│  │空闲:   │  │空闲:   │  │          │  │              │    │
│  │48GB    │  │76GB    │  │          │  │              │    │
│  └────────┘  └────────┘  └──────────┘  └──────────────┘    │
│                                                              │
│  总显存: 640GB | 已用: 200GB (31%) | 可分配: 440GB          │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                    GPU Node-2 (L40S ×4)                      │
│                                                              │
│  GPU 0          GPU 1          GPU 2          GPU 3         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │Whisper-L │  │CosyVoice │  │PaddleOCR │  │(空闲)       │ │
│  │(8GB)     │  │(6GB)     │  │(4GB)     │  │             │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘ │
│                                                              │
│  总显存: 192GB | 已用: 18GB (9%) | 可分配: 174GB            │
└──────────────────────────────────────────────────────────────┘
```

**放置原则：**
1. **大模型优先**：72B 等大模型需要 Tensor Parallelism，优先分配连续 GPU
2. **高频模型集中**：7B 对话模型部署在所有节点，保证就近路由
3. **冷热分离**：低频模型（如 ASR/TTS）部署在 L40S 等性价比节点
4. **显存预留**：每个 GPU 预留 10% 显存作为推理缓冲

#### 4.3.2 模型加载与卸载

```python
"""
GPU 资源调度器 - 管理模型在 GPU 节点上的加载/卸载
"""
import asyncio
from dataclasses import dataclass

@dataclass
class ModelPlacement:
    """模型放置决策"""
    model_id: int
    model_key: str
    node_id: int
    node_name: str
    gpu_ids: list[int]
    allocated_vram_mb: int
    engine_type: str
    tensor_parallel_size: int

class GPUScheduler:
    """GPU 资源调度器"""
    
    def __init__(self, db, redis, k8s_client):
        self.db = db
        self.redis = redis
        self.k8s = k8s_client
    
    async def deploy_model(
        self, 
        model_key: str, 
        target_node: str | None = None,
        gpu_count: int | None = None
    ) -> ModelPlacement:
        """部署模型到GPU节点"""
        
        # 1. 获取模型信息
        model = await self.db.fetchone(
            "SELECT * FROM inference_model WHERE model_key = %s AND status = 'registered'",
            model_key
        )
        if not model:
            raise DeployError(f"Model {model_key} not found")
        
        # 2. 选择节点
        if target_node:
            node = await self._get_node(target_node)
        else:
            node = await self._select_best_node(model)
        
        if not node:
            raise DeployError("No suitable GPU node available")
        
        # 3. 计算所需 GPU 数量 (Tensor Parallelism)
        tp_size = gpu_count or self._calc_tp_size(model)
        required_vram = self._estimate_vram(model, tp_size)
        
        # 4. 检查显存
        available = await self._check_vram(node["id"], required_vram)
        if not available:
            # 尝试驱逐低优先级模型
            evicted = await self._try_evict_for_space(node["id"], required_vram)
            if not evicted:
                raise DeployError(f"Insufficient VRAM on node {node['node_name']}")
        
        # 5. 分配 GPU
        gpu_ids = await self._allocate_gpus(node["id"], tp_size, required_vram)
        
        # 6. 启动推理引擎 (通过 K8s)
        deployment_manifest = self._build_deployment_manifest(
            model, node, gpu_ids, tp_size
        )
        
        deployment_id = await self.db.insert(
            "model_deployment",
            {
                "model_id": model["id"],
                "node_id": node["id"],
                "replica_id": f"{model_key}-r{int(time.time())}-{node['node_name']}",
                "gpu_ids": gpu_ids,
                "allocated_vram_mb": required_vram,
                "engine_type": model["framework"],
                "engine_version": "latest",
                "service_endpoint": f"http://{node['node_ip']}:8000",
                "health_endpoint": f"http://{node['node_ip']}:8000/health",
                "status": "loading"
            }
        )
        
        # 7. 创建 K8s Pod
        await self.k8s.create_pod(deployment_manifest)
        
        # 8. 等待就绪
        await self._wait_for_ready(deployment_id, timeout=120)
        
        # 9. 更新状态
        await self.db.update(
            "model_deployment",
            {"status": "ready", "loaded_at": "NOW()"},
            f"id = {deployment_id}"
        )
        
        return ModelPlacement(
            model_id=model["id"],
            model_key=model_key,
            node_id=node["id"],
            node_name=node["node_name"],
            gpu_ids=gpu_ids,
            allocated_vram_mb=required_vram,
            engine_type=model["framework"],
            tensor_parallel_size=tp_size
        )
    
    async def undeploy_model(self, deployment_id: int, drain_timeout: int = 30):
        """优雅卸载模型 (排空流量后卸载)"""
        
        # 1. 标记为 draining
        await self.db.update(
            "model_deployment",
            {"status": "draining"},
            f"id = {deployment_id}"
        )
        
        # 2. 从路由表移除 (新请求不再路由到此实例)
        dep = await self.db.fetchone(
            "SELECT * FROM model_deployment WHERE id = %s", deployment_id
        )
        await self.redis.delete(f"model:deploy:{dep['replica_id']}:health")
        
        # 3. 等待活跃请求完成
        deadline = time.time() + drain_timeout
        while time.time() < deadline:
            if dep["active_sequences"] == 0:
                break
            await asyncio.sleep(1)
            dep = await self.db.fetchone(
                "SELECT active_sequences FROM model_deployment WHERE id = %s", 
                deployment_id
            )
        
        # 4. 强制终止 (如有残留)
        await self.k8s.delete_pod(dep["k8s_pod_name"])
        
        # 5. 释放 GPU 资源
        await self._release_gpus(dep["node_id"], dep["gpu_ids"])
        
        # 6. 更新状态
        await self.db.update(
            "model_deployment",
            {"status": "terminated"},
            f"id = {deployment_id}"
        )
    
    def _calc_tp_size(self, model: dict) -> int:
        """计算 Tensor Parallelism 大小"""
        model_size_gb = model.get("param_count_billion", 7) * 2  # bf16
        single_gpu_vram = 80  # A100-80G
        
        # 留 15% 余量给 KV-Cache
        usable = single_gpu_vram * 0.85
        tp = max(1, -(-int(model_size_gb // usable)))  # 向上取整
        return min(tp, 8)  # 最多8卡并行
    
    def _estimate_vram(self, model: dict, tp_size: int) -> int:
        """估算模型总显存需求 (MB)"""
        param_b = model.get("param_count_billion", 7)
        bytes_per_param = 2 if model["quantization"] == "none" else 1  # int8/int4
        
        model_weight_mb = int(param_b * 1e9 * bytes_per_param / 1e6 / tp_size)
        kv_cache_mb = int(model["max_model_len"] * 0.5 * 1024 / tp_size)  # 估算
        overhead_mb = 2048  # 框架开销
        
        return model_weight_mb + kv_cache_mb + overhead_mb
    
    async def _select_best_node(self, model: dict) -> dict | None:
        """选择最佳部署节点"""
        nodes = await self.db.fetchall(
            """SELECT * FROM gpu_node 
               WHERE status = 'active' 
               AND gpu_type = %s
               ORDER BY used_vram_mb / total_vram_mb ASC""",
            model.get("target_gpu", "any") if model.get("target_gpu") != "any" else "%"
        )
        
        for node in nodes:
            # 检查是否有足够空闲 GPU
            free_gpus = await self._get_free_gpus(node["id"])
            needed = self._calc_tp_size(model)
            if len(free_gpus) >= needed:
                return node
        
        return None
    
    async def _try_evict_for_space(
        self, node_id: int, required_mb: int
    ) -> bool:
        """尝试驱逐低优先级模型释放显存"""
        # 找到该节点上优先级最低、占用最大的模型
        candidates = await self.db.fetchall(
            """SELECT d.*, m.priority_weight 
               FROM model_deployment d
               JOIN inference_model m ON d.model_id = m.id
               WHERE d.node_id = %s AND d.status = 'ready'
               ORDER BY m.priority_weight ASC, d.allocated_vram_mb DESC""",
            node_id
        )
        
        freed = 0
        for dep in candidates:
            if freed >= required_mb:
                return True
            # 只驱逐低优先级模型
            if dep["priority_weight"] <= 1:
                continue
            await self.undeploy_model(dep["id"])
            freed += dep["allocated_vram_mb"]
        
        return freed >= required_mb
```

### 4.4 推理加速引擎

#### 4.4.1 加速技术矩阵

| 技术 | 适用模型 | 加速效果 | 实现方式 |
|------|----------|----------|----------|
| **PagedAttention** | LLM (7B~72B) | 2-4x 吞吐量 | vLLM 原生支持 |
| **Continuous Batching** | LLM | 3-5x 吞吐量 | vLLM / TGI 原生支持 |
| **AWQ 量化** | LLM | 显存降低 50%, 速度 +30% | 4-bit 权重量化 |
| **GPTQ 量化** | LLM | 显存降低 50-75% | 4/8-bit 权重量化 |
| **Speculative Decoding** | LLM | 1.5-2x 生成速度 | 小模型草稿 + 大模型校验 |
| **Prefix Caching** | LLM | 系统提示部分 +3x | KV-Cache 复用 |
| **Flash Attention 2** | LLM / Multimodal | 训练推理通用加速 | 注意力机制优化 |
| **Tensor Parallelism** | 大模型 (14B+) | 多卡并行 | NCCL 通信 |
| **ONNX Runtime** | Embedding / OCR | CPU 推理加速 | 算子融合 |
| **TensorRT** | OCR / Multimodal | GPU 推理加速 | 算子融合 + 精度混合 |

#### 4.4.2 vLLM 引擎配置

```python
"""
vLLM 推理引擎启动配置与封装
"""
import subprocess
import asyncio
import aiohttp

class VLLMEngine:
    """vLLM 推理引擎管理"""
    
    # vLLM 服务启动命令模板
    STARTUP_TEMPLATE = """
python -m vllm.entrypoints.openai.api_server \
    --model {model_path} \
    --tokenizer {tokenizer_path} \
    --dtype bfloat16 \
    --quantization {quantization} \
    --tensor-parallel-size {tp_size} \
    --gpu-memory-utilization {gpu_mem_util} \
    --max-model-len {max_model_len} \
    --max-num-seqs {max_num_seqs} \
    --enable-prefix-caching \
    --enable-chunked-prefill \
    --max-num-batched-tokens 16384 \
    --swap-space 16 \
    --host 0.0.0.0 \
    --port {port} \
    --uvicorn-log-level warning
"""
    
    def __init__(self, model_config: dict, node_config: dict):
        self.config = model_config
        self.node = node_config
        self.process = None
        self.endpoint = f"http://{node_config['node_ip']}:{model_config['port']}"
    
    async def start(self):
        """启动 vLLM 服务"""
        cmd = self.STARTUP_TEMPLATE.format(
            model_path=self.config["model_path"],
            tokenizer_path=self.config.get("tokenizer_path", self.config["model_path"]),
            quantization=self.config.get("quantization", "None"),
            tp_size=self.config.get("tp_size", 1),
            gpu_mem_util=self.config.get("gpu_memory_util", 0.90),
            max_model_len=self.config.get("max_model_len", 32768),
            max_num_seqs=self.config.get("max_num_seqs", 256),
            port=self.config["port"]
        ).strip()
        
        self.process = subprocess.Popen(
            cmd,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=self._build_env()
        )
        
        # 等待服务就绪
        await self._wait_ready(timeout=120)
    
    def _build_env(self) -> dict:
        """构建环境变量"""
        import os
        env = os.environ.copy()
        # CUDA 可见设备
        env["CUDA_VISIBLE_DEVICES"] = ",".join(
            map(str, self.config["gpu_ids"])
        )
        # NCCL 优化
        env["NCCL_P2P_DISABLE"] = "0"
        env["NCCL_IB_DISABLE"] = "0"
        # Flash Attention
        env["VLLM_ATTENTION_BACKEND"] = "FLASH_ATTN"
        return env
    
    async def generate(
        self,
        prompt: str,
        max_tokens: int = 2048,
        temperature: float = 0.7,
        top_p: float = 0.9,
        stream: bool = False,
        stop: list[str] | None = None
    ) -> dict | AsyncGenerator:
        """调用 vLLM 推理 (OpenAI 兼容接口)"""
        
        payload = {
            "model": self.config["model_key"],
            "prompt": prompt,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": top_p,
            "stream": stream,
            "use_beam_search": False,
        }
        if stop:
            payload["stop"] = stop
        
        async with aiohttp.ClientSession() as session:
            if stream:
                return self._stream_generate(session, payload)
            else:
                async with session.post(
                    f"{self.endpoint}/v1/completions",
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=120)
                ) as resp:
                    return await resp.json()
    
    async def _stream_generate(self, session, payload):
        """SSE 流式推理"""
        async with session.post(
            f"{self.endpoint}/v1/completions",
            json=payload,
            timeout=aiohttp.ClientTimeout(total=300)
        ) as resp:
            async for line in resp.content:
                if line.startswith(b"data: "):
                    data = line[6:].strip()
                    if data == b"[DONE]":
                        break
                    import json
                    yield json.loads(data)
    
    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Embedding 向量化"""
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/embeddings",
                json={
                    "model": self.config["model_key"],
                    "input": texts
                },
                timeout=aiohttp.ClientTimeout(total=30)
            ) as resp:
                result = await resp.json()
                return [item["embedding"] for item in result["data"]]
    
    async def health_check(self) -> bool:
        """健康检查"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.endpoint}/health",
                    timeout=aiohttp.ClientTimeout(total=3)
                ) as resp:
                    return resp.status == 200
        except Exception:
            return False
    
    async def get_metrics(self) -> dict:
        """获取推理指标 (vLLM /metrics 端点)"""
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.endpoint}/metrics",
                timeout=aiohttp.ClientTimeout(total=5)
            ) as resp:
                text = await resp.text()
                return self._parse_prometheus_metrics(text)
    
    def _parse_prometheus_metrics(self, text: str) -> dict:
        """解析 Prometheus 格式指标"""
        metrics = {}
        for line in text.strip().split("\n"):
            if line.startswith("#"):
                continue
            if " " in line:
                key, value = line.rsplit(" ", 1)
                try:
                    metrics[key] = float(value)
                except ValueError:
                    pass
        return metrics
    
    async def stop(self):
        """停止推理服务"""
        if self.process:
            self.process.terminate()
            await asyncio.sleep(2)
            if self.process.poll() is None:
                self.process.kill()
```

#### 4.4.3 推测解码 (Speculative Decoding) 配置

```python
"""
推测解码: 使用小模型生成草稿, 大模型批量校验
适用于复杂推理场景 (数学解题、作文批改)
"""

SPECULATIVE_CONFIG = {
    # 主模型 + 草稿模型配置
    "math_reasoning": {
        "target_model": "qwen2.5-72b-instruct",   # 大模型: 高质量
        "draft_model": "qwen2.5-1.5b-instruct",   # 小模型: 快速草稿
        "acceptance_threshold": 0.9,               # 接受阈值
        "max_draft_tokens": 5,                     # 每轮最大草稿token数
        "expected_speedup": "1.5-2x"
    },
    "general_chat": {
        "target_model": "qwen2.5-7b-instruct",
        "draft_model": "qwen2.5-0.5b-instruct",
        "acceptance_threshold": 0.85,
        "max_draft_tokens": 4,
        "expected_speedup": "1.3-1.7x"
    }
}

# vLLM 推测解码启动参数 (v0.5.0+)
# python -m vllm.entrypoints.openai.api_server \
#   --model qwen2.5-72b-instruct \
#   --speculative-model qwen2.5-1.5b-instruct \
#   --num-speculative-tokens 5 \
#   ...
```

#### 4.4.4 前缀缓存优化

```python
"""
Prefix Caching: 复用系统提示的 KV-Cache
PrimeTop 场景中, 系统提示 (Prompt模板) 高度复用
"""

# 典型场景的公共前缀 (系统提示+学科上下文)
PREFIX_TEMPLATES = {
    # 小学数学辅导 - 固定系统提示约 800 tokens
    "primary_math": """你是一名专业的小学数学老师，正在辅导一位小学{grade}年级的学生。
请遵循以下原则：
1. 使用简单易懂的语言，避免专业术语
2. 先引导学生思考，再给出解题思路
3. 每一步都要解释为什么这样做
4. 鼓励学生，使用积极的语气
5. 结合生活实例帮助学生理解
当前教材版本：{textbook_version}
当前章节：{chapter}
...（完整模板约800 tokens）""",
    
    # 初中物理辅导 - 固定系统提示约 1200 tokens
    "middle_physics": """你是一名专业的初中物理老师...
    （完整模板约1200 tokens）""",
    
    # 高中英语作文批改 - 固定系统提示约 1500 tokens
    "high_english_essay": """你是一名高中英语作文批改专家...
    （完整模板约1500 tokens）"""
}

# 前缀缓存命中率监控
# vLLM 的 --enable-prefix-caching 会自动管理 KV-Cache 的复用
# 同一前缀的请求共享 KV-Cache, 避免重复计算

# 监控指标:
# - vllm:prefix_cache_hit_rate  (目标: > 60%)
# - vllm:prefix_cache_miss_rate
# - vllm:gpu_cache_usage_perc   (目标: < 90%)
```

---

## 5. API 接口设计

### 5.1 推理网关 API

#### 5.1.1 文本生成（流式）

```
POST /api/v1/inference/chat/completions
Content-Type: application/json
Authorization: Bearer {service_token}
X-Scene: default_chat
X-Priority: critical
X-Caller-Service: ai-tutor
```

**请求体：**
```json
{
  "model": "auto",
  "messages": [
    {"role": "system", "content": "你是一名数学老师..."},
    {"role": "user", "content": "请解释什么是函数的定义域"}
  ],
  "max_tokens": 2048,
  "temperature": 0.7,
  "top_p": 0.9,
  "stream": true,
  "stream_options": {
    "include_usage": true
  }
}
```

**响应（SSE 流式）：**
```
data: {"id":"req_xxx","choices":[{"delta":{"content":"函数"}}],"model":"qwen2.5-7b-instruct"}

data: {"id":"req_xxx","choices":[{"delta":{"content":"的定义域"}}],"model":"qwen2.5-7b-instruct"}

data: {"id":"req_xxx","choices":[{"delta":{"content":"是指..."}}],"model":"qwen2.5-7b-instruct"}

data: {"id":"req_xxx","choices":[],"usage":{"prompt_tokens":156,"completion_tokens":89,"total_tokens":245}}

data: [DONE]
```

#### 5.1.2 批量 Embedding

```
POST /api/v1/inference/embeddings
Content-Type: application/json
```

```json
{
  "model": "auto",
  "input": [
    "什么是勾股定理",
    "勾股定理的证明方法",
    "直角三角形三边关系"
  ],
  "encoding_format": "float"
}
```

**响应：**
```json
{
  "object": "list",
  "data": [
    {"object": "embedding", "index": 0, "embedding": [0.0123, -0.0456, ...]},
    {"object": "embedding", "index": 1, "embedding": [0.0234, -0.0567, ...]},
    {"object": "embedding", "index": 2, "embedding": [0.0345, -0.0678, ...]}
  ],
  "model": "bge-large-zh-v1.5",
  "usage": {"prompt_tokens": 24, "total_tokens": 24}
}
```

#### 5.1.3 多模态推理

```
POST /api/v1/inference/multimodal/generate
Content-Type: application/json
```

```json
{
  "model": "auto",
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "请解析这道数学题"},
        {"type": "image_url", "image_url": {"url": "https://s3.primetop.com/questions/math_001.jpg"}}
      ]
    }
  ],
  "max_tokens": 1024,
  "stream": false
}
```

### 5.2 管理面 API

#### 5.2.1 模型部署

```
POST /api/v1/admin/inference/deploy
Content-Type: application/json
Authorization: Bearer {admin_token}
```

```json
{
  "model_key": "qwen2.5-14b-instruct",
  "target_node": "gpu-node-01",
  "gpu_count": 2,
  "quantization": "awq",
  "max_model_len": 32768,
  "replicas": 1
}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "deployment_id": 1024,
    "replica_id": "qwen2.5-14b-r0-gpu-node-01",
    "status": "loading",
    "estimated_ready_seconds": 45
  }
}
```

#### 5.2.2 模型卸载

```
POST /api/v1/admin/inference/undeploy
Content-Type: application/json
```

```json
{
  "deployment_id": 1024,
  "drain_timeout_seconds": 30,
  "force": false
}
```

#### 5.2.3 GPU 集群状态查询

```
GET /api/v1/admin/inference/cluster/status
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "nodes": [
      {
        "node_name": "gpu-node-01",
        "gpu_type": "A100-80G",
        "gpu_count": 8,
        "total_vram_mb": 655360,
        "used_vram_mb": 204800,
        "gpu_utilization": 0.72,
        "active_models": 4,
        "pending_requests": 8,
        "status": "active",
        "deployments": [
          {"model_key": "qwen2.5-7b-instruct", "gpu_ids": [0], "vram_mb": 16384},
          {"model_key": "qwen2.5-72b-instruct", "gpu_ids": [4,5,6,7], "vram_mb": 143360}
        ]
      }
    ],
    "summary": {
      "total_gpus": 12,
      "total_vram_mb": 860160,
      "used_vram_mb": 223800,
      "avg_gpu_utilization": 0.68,
      "total_active_models": 8,
      "total_pending_requests": 23
    }
  }
}
```

#### 5.2.4 更新路由策略

```
PUT /api/v1/admin/inference/routing/strategy
Content-Type: application/json
```

```json
{
  "scene": "reasoning_math",
  "model_candidates": [
    {"model_key": "qwen2.5-72b-instruct", "weight": 80, "priority": 1},
    {"model_key": "qwen2.5-14b-instruct", "weight": 20, "priority": 1}
  ],
  "effective_immediately": true
}
```

### 5.3 错误码定义

| 错误码 | HTTP Status | 说明 | 处理建议 |
|--------|-------------|------|----------|
| `INFERENCE_OK` | 200 | 成功 | - |
| `INFERENCE_QUEUED` | 202 | 已入批处理队列 | 客户端等待推送或轮询 |
| `INFERENCE_TIMEOUT` | 504 | 推理超时 | 降级到外部 API 或提示重试 |
| `INFERENCE_MODEL_UNAVAILABLE` | 503 | 模型不可用 | 路由器自动切换备选模型 |
| `INFERENCE_GPU_OOM` | 500 | GPU 显存不足 | 触发模型驱逐或扩容 |
| `INFERENCE_RATE_LIMITED` | 429 | 超出限流 | 客户端指数退避重试 |
| `INFERENCE_INVALID_INPUT` | 400 | 输入参数错误 | 客户端修正后重试 |
| `INFERENCE_CONTENT_FILTERED` | 451 | 内容安全过滤 | 返回安全提示 |
| `INFERENCE_BUDGET_EXCEEDED` | 402 | 成本预算超限 | 降级到更小模型 |
| `INFERENCE_CIRCUIT_OPEN` | 503 | 熔断器开启 | 等待熔断恢复 |

---

## 6. 推理网关实现

### 6.1 网关核心架构 (Go)

```go
// inference_gateway.go - 推理网关核心
package main

import (
    "context"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os"
    "sync"
    "sync/atomic"
    "time"
    
    "github.com/gin-gonic/gin"
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promhttp"
    "go.uber.org/zap"
)

// ===== 结构体定义 =====

type GatewayConfig struct {
    Port                int           `yaml:"port"`
    MaxConcurrentReqs   int           `yaml:"maxConcurrentReqs"`
    RequestTimeoutSec   int           `yaml:"requestTimeoutSec"`
    CircuitBreaker      CircuitConfig `yaml:"circuitBreaker"`
    RateLimit           RateLimitConfig `yaml:"rateLimit"`
}

type CircuitConfig struct {
    MaxFailures    int           `yaml:"maxFailures"`    // 连续失败阈值
    ResetTimeout   time.Duration `yaml:"resetTimeout"`   // 熔断恢复时间
    HalfOpenMax    int           `yaml:"halfOpenMax"`    // 半开状态最大探测
}

type RateLimitConfig struct {
    GlobalQPS    int `yaml:"globalQPS"`    // 全局QPS
    PerServiceQPS map[string]int `yaml:"perServiceQPS"` // 按调用方限流
}

// ===== 熔断器 =====

type CircuitBreaker struct {
    mu              sync.Mutex
    state           string  // "closed", "open", "half_open"
    failureCount    int64
    lastFailureTime time.Time
    config          CircuitConfig
}

func NewCircuitBreaker(config CircuitConfig) *CircuitBreaker {
    return &CircuitBreaker{
        state:  "closed",
        config: config,
    }
}

func (cb *CircuitBreaker) Allow() bool {
    cb.mu.Lock()
    defer cb.mu.Unlock()
    
    switch cb.state {
    case "closed":
        return true
    case "open":
        if time.Since(cb.lastFailureTime) > cb.config.ResetTimeout {
            cb.state = "half_open"
            atomic.StoreInt64(&cb.failureCount, 0)
            return true
        }
        return false
    case "half_open":
        return atomic.LoadInt64(&cb.failureCount) < int64(cb.config.HalfOpenMax)
    }
    return false
}

func (cb *CircuitBreaker) RecordSuccess() {
    cb.mu.Lock()
    defer cb.mu.Unlock()
    
    atomic.StoreInt64(&cb.failureCount, 0)
    if cb.state == "half_open" {
        cb.state = "closed"
    }
}

func (cb *CircuitBreaker) RecordFailure() {
    cb.mu.Lock()
    defer cb.mu.Unlock()
    
    failures := atomic.AddInt64(&cb.failureCount, 1)
    cb.lastFailureTime = time.Now()
    
    if failures >= int64(cb.config.MaxFailures) {
        cb.state = "open"
    }
}

// ===== Prometheus 指标 =====

var (
    requestCounter = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "inference_requests_total",
            Help: "Total inference requests",
        },
        []string{"scene", "model", "status"},
    )
    
    requestDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "inference_request_duration_seconds",
            Help:    "Request duration in seconds",
            Buckets: []float64{0.1, 0.5, 1, 2, 5, 10, 30, 60},
        },
        []string{"scene", "model"},
    )
    
    tokensGenerated = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "inference_tokens_generated_total",
            Help: "Total tokens generated",
        },
        []string{"model"},
    )
    
    queueDepth = prometheus.NewGaugeVec(
        prometheus.GaugeOpts{
            Name: "inference_queue_depth",
            Help: "Current queue depth per scene",
        },
        []string{"scene"},
    )
)

func init() {
    prometheus.MustRegister(requestCounter, requestDuration, tokensGenerated, queueDepth)
}

// ===== 推理网关 HTTP Handler =====

type InferenceGateway struct {
    router     *ModelRouter
    scheduler  *BatchScheduler
    breakers   map[string]*CircuitBreaker  // model_key -> breaker
    logger     *zap.Logger
    config     GatewayConfig
}

func NewInferenceGateway(cfg GatewayConfig) *InferenceGateway {
    return &InferenceGateway{
        router:    NewModelRouter(),
        scheduler: NewBatchScheduler(cfg.BatchConfig),
        breakers:  make(map[string]*CircuitBreaker),
        logger:    zap.L(),
        config:    cfg,
    }
}

// ChatCompletions 处理推理请求 (OpenAI兼容)
func (gw *InferenceGateway) ChatCompletions(c *gin.Context) {
    scene := c.GetHeader("X-Scene")
    priority := c.GetHeader("X-Priority")
    callerService := c.GetHeader("X-Caller-Service")
    
    var req ChatCompletionRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(400, gin.H{"error": err.Error()})
        return
    }
    
    // 1. 限流检查
    if !gw.checkRateLimit(callerService) {
        c.JSON(429, gin.H{
            "error": gin.H{
                "code":    "INFERENCE_RATE_LIMITED",
                "message": "Rate limit exceeded",
            },
        })
        return
    }
    
    // 2. 路由决策
    inferenceReq := buildInferenceRequest(&req, scene, priority, callerService)
    decision, err := gw.router.Route(c.Request.Context(), inferenceReq)
    if err != nil {
        gw.logger.Error("routing failed", zap.Error(err))
        c.JSON(503, gin.H{
            "error": gin.H{
                "code":    "INFERENCE_MODEL_UNAVAILABLE",
                "message": "No available model deployment",
            },
        })
        return
    }
    
    // 3. 缓存命中
    if decision.CacheHit {
        cached, _ := gw.router.GetCachedResult(decision.CacheKey)
        c.JSON(200, json.RawMessage(cached))
        return
    }
    
    // 4. 熔断检查
    breaker := gw.getOrCreateBreaker(decision.ModelKey)
    if !breaker.Allow() {
        c.JSON(503, gin.H{
            "error": gin.H{
                "code":    "INFERENCE_CIRCUIT_OPEN",
                "message": "Circuit breaker open for " + decision.ModelKey,
            },
        })
        return
    }
    
    // 5. 记录指标
    start := time.Now()
    statusLabel := "success"
    
    // 6. 透传到推理引擎
    if req.Stream {
        gw.proxyStreamRequest(c, decision, &req, breaker, start, scene)
    } else {
        gw.proxySyncRequest(c, decision, &req, breaker, start, scene)
    }
    
    requestCounter.WithLabelValues(scene, decision.ModelKey, statusLabel).Inc()
}

// proxyStreamRequest SSE流式透传
func (gw *InferenceGateway) proxyStreamRequest(
    c *gin.Context,
    decision *RouteDecision,
    req *ChatCompletionRequest,
    breaker *CircuitBreaker,
    start time.Time,
    scene string,
) {
    c.Header("Content-Type", "text/event-stream")
    c.Header("Cache-Control", "no-cache")
    c.Header("Connection", "keep-alive")
    c.Header("X-Accel-Buffering", "no")  // Nginx 透传
    
    flusher, ok := c.Writer.(http.Flusher)
    if !ok {
        c.JSON(500, gin.H{"error": "streaming not supported"})
        return
    }
    
    // 构建到下游推理引擎的请求
    downstreamURL := decision.Endpoint + "/v1/completions"
    payload, _ := json.Marshal(req)
    
    httpReq, _ := http.NewRequestWithContext(
        c.Request.Context(), "POST", downstreamURL, bytes.NewReader(payload))
    httpReq.Header.Set("Content-Type", "application/json")
    httpReq.Header.Set("Accept", "text/event-stream")
    
    client := &http.Client{Timeout: time.Duration(gw.config.RequestTimeoutSec) * time.Second}
    resp, err := client.Do(httpReq)
    if err != nil {
        breaker.RecordFailure()
        c.SSEEvent("error", "inference engine unreachable")
        return
    }
    defer resp.Body.Close()
    
    if resp.StatusCode != 200 {
        breaker.RecordFailure()
        c.SSEEvent("error", fmt.Sprintf("engine returned %d", resp.StatusCode))
        return
    }
    
    // 透传 SSE 流
    buf := make([]byte, 4096)
    tokenCount := 0
    for {
        n, err := resp.Body.Read(buf)
        if n > 0 {
            c.Writer.Write(buf[:n])
            flusher.Flush()
            
            // 统计 token (简化: 按chunk计数)
            tokenCount++
        }
        if err == io.EOF {
            break
        }
        if err != nil {
            gw.logger.Error("stream read error", zap.Error(err))
            breaker.RecordFailure()
            break
        }
    }
    
    breaker.RecordSuccess()
    elapsed := time.Since(start).Seconds()
    requestDuration.WithLabelValues(scene, decision.ModelKey).Observe(elapsed)
    tokensGenerated.WithLabelValues(decision.ModelKey).Add(float64(tokenCount))
}

// getOrCreateBreaker 获取或创建模型熔断器
func (gw *InferenceGateway) getOrCreateBreaker(modelKey string) *CircuitBreaker {
    gw.mu.RLock()
    if cb, ok := gw.breakers[modelKey]; ok {
        gw.mu.RUnlock()
        return cb
    }
    gw.mu.RUnlock()
    
    gw.mu.Lock()
    defer gw.mu.Unlock()
    // Double check
    if cb, ok := gw.breakers[modelKey]; ok {
        return cb
    }
    cb := NewCircuitBreaker(gw.config.CircuitBreaker)
    gw.breakers[modelKey] = cb
    return cb
}

// ===== main =====

func main() {
    cfg := loadConfig()
    gw := NewInferenceGateway(cfg)
    
    r := gin.New()
    r.Use(gin.Recovery())
    r.Use(requestIDMiddleware())
    r.Use(loggingMiddleware())
    
    // 推理接口
    api := r.Group("/api/v1/inference")
    {
        api.POST("/chat/completions", gw.ChatCompletions)
        api.POST("/completions", gw.Completions)
        api.POST("/embeddings", gw.Embeddings)
        api.POST("/multimodal/generate", gw.MultimodalGenerate)
    }
    
    // 管理接口
    admin := r.Group("/api/v1/admin/inference")
    admin.Use(adminAuth())
    {
        admin.POST("/deploy", gw.DeployModel)
        admin.POST("/undeploy", gw.UndeployModel)
        admin.GET("/cluster/status", gw.ClusterStatus)
        admin.PUT("/routing/strategy", gw.UpdateRouting)
        admin.GET("/models", gw.ListModels)
    }
    
    // Prometheus 指标
    r.GET("/metrics", gin.WrapH(promhttp.Handler()))
    
    // 健康检查
    r.GET("/health", func(c *gin.Context) {
        c.JSON(200, gin.H{"status": "ok"})
    })
    
    r.Run(fmt.Sprintf(":%d", cfg.Port))
}
```

### 6.2 Nginx SSE 透传配置

```nginx
# /etc/nginx/conf.d/inference-gateway.conf

upstream inference_gateway {
    server 10.0.1.10:8080;
    server 10.0.1.11:8080;
    server 10.0.1.12:8080;
    keepalive 64;
}

server {
    listen 443 ssl http2;
    server_name inference-api.primetop.com;
    
    ssl_certificate     /etc/nginx/ssl/primetop.crt;
    ssl_certificate_key /etc/nginx/ssl/primetop.key;
    
    # 推理请求 - SSE 流式
    location /api/v1/inference/ {
        proxy_pass http://inference_gateway;
        
        # SSE 关键配置
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;              # 关闭缓冲
        proxy_cache off;                   # 关闭缓存
        proxy_read_timeout 300s;           # SSE 长连接超时
        
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        chunked_transfer_encoding on;
    }
    
    # 管理接口
    location /api/v1/admin/inference/ {
        proxy_pass http://inference_gateway;
        proxy_set_header Host $host;
        
        # 管理接口 IP 白名单
        allow 10.0.0.0/8;
        allow 172.16.0.0/12;
        deny all;
    }
    
    # 健康检查 (负载均衡器探测)
    location /health {
        proxy_pass http://inference_gateway;
        access_log off;
    }
}
```

---

## 7. 弹性扩缩容

### 7.1 扩缩容策略

```
┌─────────────────────────────────────────────────────────────┐
│                    自动扩缩容决策器                           │
│                                                             │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────────┐  │
│  │ GPU利用率   │   │ 排队深度     │   │ 请求延迟P95     │  │
│  │ > 75% 持续  │   │ > 50 持续    │   │ > 3s 持续       │  │
│  │ 3分钟       │   │ 2分钟        │   │ 2分钟           │  │
│  └──────┬──────┘   └──────┬───────┘   └────────┬────────┘  │
│         │                 │                    │            │
│         └────────────────┼────────────────────┘            │
│                          ▼                                  │
│              ┌───────────────────────┐                      │
│              │ 扩容触发 (满足2/3)   │                      │
│              │ +1 GPU 节点          │                      │
│              │ 或 +1 模型副本       │                      │
│              └───────────────────────┘                      │
│                                                             │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────────┐  │
│  │ GPU利用率   │   │ 排队深度     │   │ 请求延迟P95     │  │
│  │ < 30% 持续  │   │ < 5 持续     │   │ < 500ms 持续    │  │
│  │ 15分钟      │   │ 15分钟       │   │ 15分钟          │  │
│  └──────┬──────┘   └──────┬───────┘   └────────┬────────┘  │
│         │                 │                    │            │
│         └────────────────┼────────────────────┘            │
│                          ▼                                  │
│              ┌───────────────────────┐                      │
│              │ 缩容触发 (满足3/3)   │                      │
│              │ 排空后移除模型副本   │                      │
│              │ Spot实例优先回收     │                      │
│              └───────────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 K8s HPA 配置

```yaml
# k8s/hpa-inference-gateway.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: inference-gateway-hpa
  namespace: inference
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: inference-gateway
  minReplicas: 3
  maxReplicas: 12
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
    - type: Pods
      pods:
        metric:
          name: inference_active_requests
        target:
          type: AverageValue
          averageValue: "100"
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Percent
          value: 50
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 900  # 15分钟稳定窗口
      policies:
        - type: Percent
          value: 25
          periodSeconds: 300

---
# GPU 节点自动扩缩容 (Karpenter / Cluster Autoscaler)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vllm-qwen-7b
  namespace: inference
spec:
  replicas: 2
  selector:
    matchLabels:
      app: vllm-qwen-7b
  template:
    metadata:
      labels:
        app: vllm-qwen-7b
    spec:
      nodeSelector:
        gpu-type: A100
      containers:
        - name: vllm
          image: vllm/vllm-openai:latest
          args:
            - --model=/models/qwen2.5-7b-instruct
            - --tensor-parallel-size=1
            - --gpu-memory-utilization=0.90
            - --max-model-len=32768
            - --max-num-seqs=256
            - --enable-prefix-caching
            - --port=8000
          env:
            - name: CUDA_VISIBLE_DEVICES
              value: "0"
          resources:
            limits:
              nvidia.com/gpu: 1
              memory: 32Gi
            requests:
              nvidia.com/gpu: 1
              memory: 32Gi
          ports:
            - containerPort: 8000
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 30
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 60
            periodSeconds: 30
```

### 7.3 GPU 节点扩缩容脚本

```python
"""
GPU 节点弹性扩缩容控制器
基于 Prometheus 指标自动调整 GPU 节点数
"""
import asyncio
import aiohttp

class GPUAutoScaler:
    """GPU 节点自动扩缩容"""
    
    def __init__(self, config: dict):
        self.prometheus_url = config["prometheus_url"]
        self.k8s_api = config["k8s_api"]
        self.scale_rules = config["scale_rules"]
    
    async def evaluate_and_scale(self):
        """定期评估并执行扩缩容"""
        metrics = await self._collect_metrics()
        
        for node_group, rule in self.scale_rules.items():
            current = await self._get_current_replicas(node_group)
            
            should_scale, target, reason = self._evaluate_rule(
                metrics, node_group, rule, current
            )
            
            if should_scale:
                await self._scale_node_group(node_group, target)
                self._log_scale_event(node_group, current, target, reason)
    
    async def _collect_metrics(self) -> dict:
        """从 Prometheus 采集指标"""
        queries = {
            "gpu_util": 'avg(DCGM_FI_DEV_GPU_UTIL{node_group=~".*"})',
            "queue_depth": 'sum(inference_queue_depth)',
            "p95_latency": 'histogram_quantile(0.95, inference_request_duration_seconds_bucket)',
            "gpu_mem_usage": 'avg(DCGM_FI_DEV_FB_USED / DCGM_FI_DEV_FB_TOTAL)',
            "active_seqs": 'sum(vllm:num_requests_running)',
            "model_count": 'count by (model_key) (vllm:gpu_cache_usage_perc)',
        }
        
        results = {}
        async with aiohttp.ClientSession() as session:
            for key, query in queries.items():
                async with session.get(
                    f"{self.prometheus_url}/api/v1/query",
                    params={"query": query}
                ) as resp:
                    data = await resp.json()
                    if data["status"] == "success":
                        results[key] = data["data"]["result"]
        
        return results
    
    def _evaluate_rule(
        self, metrics, node_group, rule, current_replicas
    ) -> tuple[bool, int, str]:
        """评估是否需要扩缩容"""
        # 扩容判断
        scale_up_signals = 0
        if metrics.get("gpu_util", 0) > rule["scale_up_gpu_util"]:
            scale_up_signals += 1
        if metrics.get("queue_depth", 0) > rule["scale_up_queue"]:
            scale_up_signals += 1
        if metrics.get("p95_latency", 0) > rule["scale_up_latency_s"]:
            scale_up_signals += 1
        
        if scale_up_signals >= 2 and current_replicas < rule["max_replicas"]:
            return True, current_replicas + 1, f"scale_up_signals={scale_up_signals}"
        
        # 缩容判断
        scale_down_signals = 0
        if metrics.get("gpu_util", 0) < rule["scale_down_gpu_util"]:
            scale_down_signals += 1
        if metrics.get("queue_depth", 0) < rule["scale_down_queue"]:
            scale_down_signals += 1
        if metrics.get("p95_latency", 0) < rule["scale_down_latency_s"]:
            scale_down_signals += 1
        
        if scale_down_signals == 3 and current_replicas > rule["min_replicas"]:
            return True, current_replicas - 1, f"scale_down_signals=3"
        
        return False, current_replicas, "no_change"
```

---

## 8. 监控与告警

### 8.1 监控大盘

#### 8.1.1 核心指标

| 分类 | 指标名 | Prometheus 指标 | 告警阈值 |
|------|--------|----------------|----------|
| **性能** | 首 Token 延迟 P95 | `vllm:time_to_first_token_seconds{quantile="0.95"}` | > 1s |
| **性能** | 生成速度 | `vllm:time_per_output_token_seconds` | > 0.03s |
| **性能** | 批处理大小 | `vllm:num_requests_running` | < 1 (低效) |
| **资源** | GPU 利用率 | `DCGM_FI_DEV_GPU_UTIL` | < 30% 或 > 95% |
| **资源** | 显存使用率 | `DCGM_FI_DEV_FB_USED / DCGM_FI_DEV_FB_TOTAL` | > 95% |
| **可靠性** | 推理成功率 | `rate(inference_requests_total{status="success"}[5m])` | < 95% |
| **可靠性** | 推理错误率 | `rate(inference_requests_total{status="failed"}[5m])` | > 5% |
| **成本** | 日推理成本 | `sum(inference_compute_cost)` | > 日预算 |
| **队列** | 排队深度 | `inference_queue_depth` | > 100 |
| **缓存** | 前缀缓存命中率 | `vllm:prefix_cache_hit_rate` | < 40% |

#### 8.1.2 Grafana Dashboard JSON (核心面板)

```json
{
  "dashboard": {
    "title": "PrimeTop Inference Engine Overview",
    "panels": [
      {
        "title": "GPU Utilization",
        "targets": [{
          "expr": "DCGM_FI_DEV_GPU_UTIL{gpu=~\"$gpu\"}"
        }],
        "thresholds": [{"value": 95, "colorMode": "critical"}]
      },
      {
        "title": "Tokens/sec by Model",
        "targets": [{
          "expr": "rate(vllm:tokens_generated_total[1m])"
        }]
      },
      {
        "title": "Request Latency P50/P95/P99",
        "targets": [{
          "expr": "histogram_quantile(0.50, sum(rate(inference_request_duration_seconds_bucket[5m])) by (le))"
        }, {
          "expr": "histogram_quantile(0.95, sum(rate(inference_request_duration_seconds_bucket[5m])) by (le))"
        }]
      },
      {
        "title": "Active Sequences vs Queue Depth",
        "targets": [{
          "expr": "sum(vllm:num_requests_running) by (model)"
        }, {
          "expr": "sum(vllm:num_requests_waiting) by (model)"
        }]
      },
      {
        "title": "Prefix Cache Hit Rate",
        "targets": [{
          "expr": "vllm:prefix_cache_hit_rate"
        }]
      },
      {
        "title": "Daily Cost Trend",
        "targets": [{
          "expr": "sum(inference_compute_cost) by (model_key)"
        }]
      }
    ]
  }
}
```

### 8.2 告警规则

```yaml
# prometheus/alerts/inference.yml
groups:
  - name: inference_engine
    rules:
      # GPU 利用率过高
      - alert: GPUUtilizationHigh
        expr: avg(DCGM_FI_DEV_GPU_UTIL) by (node) > 95
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "GPU utilization > 95% on {{ $labels.node }}"
      
      # 推理延迟过高
      - alert: InferenceLatencyHigh
        expr: |
          histogram_quantile(0.95, 
            sum(rate(inference_request_duration_seconds_bucket[5m])) by (le, model)
          ) > 5
        for: 3m
        labels:
          severity: critical
        annotations:
          summary: "P95 inference latency > 5s for model {{ $labels.model }}"
      
      # 推理错误率过高
      - alert: InferenceErrorRateHigh
        expr: |
          sum(rate(inference_requests_total{status="failed"}[5m])) by (model) /
          sum(rate(inference_requests_total[5m])) by (model) > 0.05
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Error rate > 5% for model {{ $labels.model }}"
      
      # 队列积压
      - alert: InferenceQueueBacklog
        expr: sum(inference_queue_depth) by (scene) > 100
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Queue backlog > 100 for scene {{ $labels.scene }}"
      
      # 模型实例不可用
      - alert: ModelInstancesLow
        expr: count(model_deployment_status == "ready") by (model_key) < 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "No ready instance for model {{ $labels.model_key }}"
      
      # GPU 显存接近上限
      - alert: GPUVRAMNearFull
        expr: |
          DCGM_FI_DEV_FB_USED / DCGM_FI_DEV_FB_TOTAL > 0.95
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "GPU VRAM > 95% on {{ $labels.gpu }}"
```

---

## 9. 成本优化策略

### 9.1 成本模型

```
单次推理成本 = (GPU小时成本 × 推理耗时) / 批处理大小

示例 (Qwen-7B on A100-80G):
  GPU成本: ¥8.5/h (按需) / ¥3.2/h (Spot)
  平均推理耗时: 1.5s
  平均批处理: 15
  
  单次成本 = (8.5 × 1.5/3600) / 15 ≈ ¥0.000236
  
  千次成本 ≈ ¥0.236  ← 远低于直接调用外部API (~¥2/千次)
```

### 9.2 优化策略矩阵

| 策略 | 节省比例 | 实现方式 | 风险 |
|------|----------|----------|------|
| **动态批处理** | 60-80% | 合并请求共享 GPU | 少量延迟增加 |
| **量化推理** | 30-50% | AWQ/GPTQ 4-bit | 微小精度损失 |
| **前缀缓存** | 20-40% | KV-Cache 复用 | 额外显存占用 |
| **Spot 实例** | 50-65% | 使用竞价GPU | 可能被中断 |
| **模型分级** | 20-30% | 简单问题用小模型 | 质量差异 |
| **请求缓存** | 10-20% | 相同问题直接返回 | 缓存一致性 |
| **CPU 推理** | 100% GPU→CPU | Embedding等轻量推理 | 延迟较高 |
| **Speculative Decoding** | 30-50% | 小模型+大模型协作 | 实现复杂度 |

### 9.3 成本核算服务

```python
"""
推理成本实时核算 - 为计费系统和成本看板提供数据
"""

class CostCalculator:
    """推理成本计算器"""
    
    # GPU 成本表 (元/小时)
    GPU_COST_TABLE = {
        "A100-80G": {"on_demand": 8.5, "spot": 3.2},
        "A100-40G": {"on_demand": 6.0, "spot": 2.4},
        "L40S":     {"on_demand": 4.5, "spot": 1.8},
        "A10":      {"on_demand": 2.5, "spot": 1.0},
    }
    
    # 模型资源占用表 (GPU数 × 显存占比)
    MODEL_RESOURCE_TABLE = {
        "qwen2.5-7b-instruct":   {"gpus": 1, "vram_ratio": 0.20},
        "qwen2.5-14b-instruct":  {"gpus": 1, "vram_ratio": 0.35},
        "qwen2.5-72b-instruct":  {"gpus": 4, "vram_ratio": 0.44},
        "bge-large-zh-v1.5":     {"gpus": 1, "vram_ratio": 0.05},
        "qwen2-vl-7b":           {"gpus": 1, "vram_ratio": 0.25},
    }
    
    async def calculate_request_cost(
        self,
        model_key: str,
        gpu_type: str,
        is_spot: bool,
        inference_time_ms: int,
        batch_size: int,
        input_tokens: int,
        output_tokens: int
    ) -> float:
        """计算单次推理成本"""
        
        resource = self.MODEL_RESOURCE_TABLE.get(model_key)
        if not resource:
            return 0.0
        
        cost_config = self.GPU_COST_TABLE.get(gpu_type, self.GPU_COST_TABLE["A100-80G"])
        hourly_cost = cost_config["spot"] if is_spot else cost_config["on_demand"]
        
        # 单 GPU 每秒成本
        cost_per_gpu_per_second = hourly_cost / 3600
        
        # 该模型占用的 GPU 数量
        gpus_used = resource["gpus"]
        
        # 分摊到单个请求的成本
        total_gpu_seconds = (inference_time_ms / 1000) * gpus_used
        per_request_cost = (total_gpu_seconds * cost_per_gpu_per_second) / max(batch_size, 1)
        
        return round(per_request_cost, 6)
    
    async def get_daily_cost_report(self, date: str) -> dict:
        """获取日成本报告"""
        # 从 inference_request_log 聚合
        report = await self.db.fetchall("""
            SELECT 
                model_key,
                caller_service,
                COUNT(*) as request_count,
                SUM(input_tokens) as total_input_tokens,
                SUM(output_tokens) as total_output_tokens,
                SUM(compute_cost) as total_cost,
                AVG(inference_ms) as avg_latency_ms
            FROM inference_request_log
            WHERE DATE(created_at) = %s
            GROUP BY model_key, caller_service
            ORDER BY total_cost DESC
        """, date)
        
        return {
            "date": date,
            "details": report,
            "total_cost": sum(r["total_cost"] for r in report),
            "total_requests": sum(r["request_count"] for r in report),
        }
```

---

## 10. 容灾与故障恢复

### 10.1 故障场景与应对

| 故障场景 | 影响 | 应对措施 | 恢复时间 |
|----------|------|----------|----------|
| **单 GPU 故障** | 该 GPU 上的模型不可用 | 自动路由到其他副本 | < 5s |
| **整节点故障** | 节点上所有模型不可用 | 流量切到其他节点 + 自动重新部署 | < 30s |
| **推理引擎崩溃** | 单模型实例不可用 | 熔断 + 重启 Pod + 重新路由 | < 15s |
| **GPU 显存 OOM** | 新请求失败 | 驱逐低优先级模型 + 扩容 | < 60s |
| **网络分区** | 部分节点不可达 | K8s 自动驱逐 + 重新调度 | < 120s |
| **外部 API 故障** | 兜底不可用 | 排队等待 + 降级提示 | 手动介入 |

### 10.2 多可用区部署

```
┌─────────────────────────────────────────────────────────────┐
│                    Region: cn-north                         │
│                                                             │
│  ┌─────────────────┐        ┌─────────────────┐            │
│  │  AZ-A           │        │  AZ-B           │            │
│  │                 │        │                 │            │
│  │  GPU Node 1-4   │◄──────►│  GPU Node 5-8   │            │
│  │  (A100 × 32)    │  专线  │  (A100 × 32)    │            │
│  │                 │  低延迟 │                 │            │
│  │  Qwen-7B ×2     │        │  Qwen-7B ×2     │            │
│  │  Qwen-72B ×1    │        │  Qwen-72B ×1    │            │
│  │  BGE-Large ×1   │        │  BGE-Large ×1   │            │
│  │  Qwen-VL ×1     │        │  Qwen-VL ×1     │            │
│  │                 │        │                 │            │
│  │  Gateway ×2     │        │  Gateway ×2     │            │
│  └─────────────────┘        └─────────────────┘            │
│                                                             │
│  ┌─────────────────────────────────────────────────┐       │
│  │              Load Balancer (L7)                  │       │
│  │   轮询 + 健康检查 + 跨AZ亲和                    │       │
│  └─────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### 10.3 数据备份

| 数据 | 存储位置 | 备份策略 | RPO |
|------|----------|----------|-----|
| 模型权重 | MinIO (S3) | 跨区域复制 | 0 (实时) |
| 路由策略 | Etcd | 快照每5分钟 | 5min |
| 推理日志 | MySQL + ClickHouse | Binlog + 定期归档 | 1min |
| GPU 节点状态 | Redis | AOF 持久化 | 1s |

---

## 11. 测试策略

### 11.1 性能基准测试

```python
"""
推理引擎性能基准测试
"""
import asyncio
import time
import aiohttp

class InferenceBenchmark:
    """推理性能基准测试"""
    
    TEST_PROMPTS = [
        ("short", "什么是勾股定理？"),
        ("medium", "请详细解释牛顿第二定律，并给出两个生活中的应用例子。"),
        ("long", "请对比分析李白和杜甫的诗歌风格差异，从以下五个维度展开："
                 "1. 创作背景 2. 思想主题 3. 艺术手法 4. 语言特色 5. 后世影响"),
    ]
    
    async def run_benchmark(self, model_key: str, endpoint: str):
        """运行基准测试"""
        results = {}
        
        for prompt_type, prompt in self.TEST_PROMPTS:
            # 单请求延迟测试
            latency = await self._test_single_request(endpoint, prompt)
            
            # 并发吞吐测试
            throughput = await self._test_concurrent(endpoint, prompt, concurrency=32)
            
            results[prompt_type] = {
                "single_request": latency,
                "concurrent_32": throughput,
            }
        
        return results
    
    async def _test_single_request(self, endpoint, prompt):
        async with aiohttp.ClientSession() as session:
            times = []
            for _ in range(20):  # 20次取平均
                start = time.time()
                async with session.post(
                    f"{endpoint}/v1/completions",
                    json={
                        "model": "benchmark",
                        "prompt": prompt,
                        "max_tokens": 512,
                        "temperature": 0.0,
                        "stream": False
                    },
                    timeout=30
                ) as resp:
                    await resp.json()
                    times.append(time.time() - start)
            
            times.sort()
            return {
                "p50": times[len(times)//2],
                "p95": times[int(len(times)*0.95)],
                "p99": times[int(len(times)*0.99)],
                "avg": sum(times) / len(times)
            }
    
    async def _test_concurrent(self, endpoint, prompt, concurrency=32):
        async with aiohttp.ClientSession() as session:
            start = time.time()
            tasks = [
                session.post(
                    f"{endpoint}/v1/completions",
                    json={
                        "model": "benchmark",
                        "prompt": prompt,
                        "max_tokens": 256,
                        "temperature": 0.0,
                        "stream": False
                    },
                    timeout=60
                ) for _ in range(concurrency)
            ]
            responses = await asyncio.gather(*tasks)
            elapsed = time.time() - start
            
            total_tokens = 0
            for resp in responses:
                data = await resp.json()
                total_tokens += data.get("usage", {}).get("completion_tokens", 0)
            
            return {
                "total_time_s": elapsed,
                "total_tokens": total_tokens,
                "throughput_tokens_s": total_tokens / elapsed,
                "avg_latency_s": elapsed / concurrency
            }
```

### 11.2 测试检查清单

| 测试项 | 验收标准 | 测试方法 |
|--------|----------|----------|
| 模型加载 | 冷启动 < 30s | 计时启动到 /health 返回 200 |
| 单请求延迟 | P95 < 2s (7B模型) | 发送20次请求统计 |
| 并发吞吐 | ≥ 50 tokens/s/GPU | 32并发批量测试 |
| 批处理效率 | 批处理大小 ≥ 8 | 观察监控指标 |
| 前缀缓存 | 命中率 ≥ 60% | 重复前缀请求验证 |
| 熔断恢复 | < 30s 恢复 | 模拟后端故障验证 |
| 故障切换 | < 5s 路由切换 | 关闭一个实例观察 |
| 显存回收 | 卸载后显存归零 | 查看GPU显存 |
| SSE 透传 | 无乱码/截断 | 长文本流式测试 |
| 成本核算 | 误差 < 5% | 对比实际GPU账单 |

---

## 12. 部署清单

### 12.1 依赖组件

| 组件 | 版本要求 | 用途 |
|------|----------|------|
| Kubernetes | ≥ 1.28 | GPU 集群编排 |
| NVIDIA GPU Operator | ≥ 23.9 | GPU 驱动与设备插件 |
| vLLM | ≥ 0.5.0 | LLM 推理引擎 |
| NVIDIA Triton | ≥ 23.10 | 通用推理服务 |
| Redis | ≥ 7.0 | 队列 + 缓存 |
| Etcd | ≥ 3.5 | 配置中心 |
| Prometheus | ≥ 2.45 | 指标采集 |
| DCGM Exporter | ≥ 3.2 | GPU 指标 |
| Grafana | ≥ 10.0 | 可视化大盘 |
| MinIO | ≥ 2024.1 | 模型文件存储 |

### 12.2 模型文件清单

| 模型 | 大小(量化后) | 用途 | 优先部署 |
|------|-------------|------|----------|
| Qwen2.5-7B-Instruct (AWQ) | ~5GB | 默认对话/辅导 | P0 |
| Qwen2.5-14B-Instruct (AWQ) | ~9GB | 高质量对话 | P1 |
| Qwen2.5-72B-Instruct (AWQ) | ~38GB | 深度推理 | P1 |
| BAAI/bge-large-zh-v1.5 | ~1.3GB | RAG 向量化 | P0 |
| Qwen2-VL-7B (AWQ) | ~5GB | 图片理解 | P1 |
| Whisper-Large-v3 | ~3GB | 语音识别 | P2 |
| CosyVoice-300M | ~1.2GB | 语音合成 | P2 |
| PaddleOCR-Server | ~500MB | 文字识别 | P1 |

### 12.3 首次部署顺序

```
1. 部署基础设施 (K8s + GPU Operator + 存储)
   └→ 验证: nvidia-smi 可用, MinIO 可访问

2. 部署监控体系 (Prometheus + DCGM + Grafana)
   └→ 验证: GPU 指标可采集

3. 上传模型权重到 MinIO
   └→ 验证: 校验 SHA256

4. 部署推理网关 (Go 服务)
   └→ 验证: /health 返回 200

5. 部署 BGE-Embedding 模型
   └→ 验证: 向量化接口可用

6. 部署 Qwen-7B (vLLM)
   └→ 验证: 生成接口 + 性能基准

7. 部署 Qwen-72B (vLLM, TP=4)
   └→ 验证: 推理质量 + 性能

8. 配置路由策略
   └→ 验证: 场景路由正确

9. 逐步接入业务流量
   └→ 验证: 端到端闭环

10. 开启自动扩缩容
    └→ 验证: 峰值可弹性扩容
```

---

## 附录

### A. vLLM 启动参数速查

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--model` | 必填 | 模型权重路径 |
| `--tokenizer` | 同model | 分词器路径 |
| `--dtype` | auto | float16/bfloat16/auto |
| `--quantization` | None | awq/gptq/squeezellm/None |
| `--tensor-parallel-size` | 1 | 张量并行度 |
| `--gpu-memory-utilization` | 0.90 | GPU显存利用率上限 |
| `--max-model-len` | 模型默认 | 最大上下文长度 |
| `--max-num-seqs` | 256 | 最大并发序列 |
| `--enable-prefix-caching` | False | 启用前缀缓存 |
| `--enable-chunked-prefill` | False | 分块预填充 |
| `--max-num-batched-tokens` | 8192 | 批处理最大token |
| `--swap-space` | 4 (GB) | CPU swap空间 |
| `--speculative-model` | None | 推测解码草稿模型 |
| `--num-speculative-tokens` | None | 草稿token数 |

### B. GPU 选型参考

| GPU 型号 | 显存 | 适合模型 | 月成本估算 | 推荐指数 |
|----------|------|----------|-----------|----------|
| A100-80G | 80GB | 7B~72B 全覆盖 | ¥6,100 | ⭐⭐⭐⭐⭐ |
| A100-40G | 40GB | 7B~14B | ¥4,300 | ⭐⭐⭐⭐ |
| L40S | 48GB | 7B~14B + 多模态 | ¥3,200 | ⭐⭐⭐⭐ |
| A10 | 24GB | 7B (量化) + Embedding | ¥1,800 | ⭐⭐⭐ |
| RTX 4090 | 24GB | 测试/开发 | ¥800 | ⭐⭐(仅开发) |

### C. 常见问题排查

| 现象 | 可能原因 | 排查方法 |
|------|----------|----------|
| 首 Token 延迟高 | 预填充阶段慢 | 检查输入长度, 开启 chunked prefill |
| OOM | 显存不足 | 降低 gpu_memory_utilization 或 batch_size |
| 吞吐量低 | 批处理不足 | 检查请求频率, 增加 max_wait_ms |
| 生成质量差 | 量化精度损失 | 尝试更高精度或更大模型 |
| GPU 利用率低 | 请求不均匀 | 检查路由策略, 均衡流量 |
| 连续 OOM 后恢复慢 | 显存碎片 | 重启推理进程 |

---

*文档版本: v1.0 | 创建日期: 2026-07-05 | 负责人: AI基础设施组*
