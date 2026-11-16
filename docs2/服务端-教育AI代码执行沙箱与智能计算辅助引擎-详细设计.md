# 服务端-教育AI代码执行沙箱与智能计算辅助引擎 详细设计

## 1. 概述

### 1.1 模块定位

教育AI代码执行沙箱（Edu Code Sandbox，简称 ECS）是 AI 辅导能力的核心基础设施组件，为 AI 智能辅导对话提供一个**安全、隔离、受控**的代码执行环境。通过允许 AI 在对话过程中动态生成并执行代码来验证数学计算、绘制函数图像、模拟物理实验数据、辅助编程学习等，大幅提升 AI 辅导的准确性和交互丰富度。

### 1.2 核心职责

| 职责 | 说明 |
| --- | --- |
| 安全代码执行 | 在隔离的容器/沙箱中执行 AI 生成的 Python/Sympy/Matplotlib 代码 |
| 计算验证 | 对 AI 的数学解题步骤进行程序化验算，防止计算错误 |
| 可视化生成 | 动态生成函数图像、几何图形、数据图表并返回给客户端 |
| 模拟计算 | 执行物理/化学公式计算和简单模拟 |
| 编程教育 | 为编程题目提供代码运行和评测环境 |
| 结果安全过滤 | 对执行输出进行安全检查后返回 |

### 1.3 依赖关系

```
┌─────────────────────────────────────────────────┐
│              AI 辅导对话引擎                      │
│   (Function Calling / Tool Use 触发代码执行)      │
└───────────────────┬─────────────────────────────┘
                    │ exec_code / query_result
                    ▼
┌─────────────────────────────────────────────────┐
│         代码执行沙箱引擎 (本文档)                  │
│  ┌───────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ 调度管理层 │ │ 沙箱池管理│ │ 结果安全处理器  │  │
│  └───────────┘ └──────────┘ └────────────────┘  │
└───────┬───────────────┬──────────────────────────┘
        │               │
        ▼               ▼
┌──────────────┐ ┌──────────────────┐
│ 对象存储 OSS │ │ 容器编排 (K8s)    │
│ (图片/文件存储)│ │ (沙箱 Pod 管理)   │
└──────────────┘ └──────────────────┘
```

**上游调用方：**
- AI 辅导对话引擎（通过 Function Calling 触发）
- 理科解题步骤推导服务（用于计算验证）
- 编程练习评测服务（用于代码运行评测）

**下游依赖：**
- Kubernetes / 容器运行时（沙箱隔离执行）
- 对象存储 OSS（可视化结果文件存储）
- Redis（执行结果缓存）
- 日志服务（执行审计日志）

---

## 2. 数据模型

### 2.1 核心实体

#### 2.1.1 沙箱执行会话 (SandboxSession)

```json
{
  "sessionId": "sbx_20260630_a1b2c3d4",
  "userId": "u_100023",
  "conversationId": "conv_88001",
  "trigger": "ai_function_call",       // ai_function_call | manual_practice | auto_verify
  "language": "python3",               // python3 | javascript
  "status": "pending",                 // pending | running | success | failed | timeout | killed
  "createdAt": "2026-06-30T04:30:00Z",
  "startedAt": "2026-06-30T04:30:01Z",
  "finishedAt": null,
  "podName": "sandbox-pod-a1b2",
  "nodeName": "node-worker-03",
  "resourceLimit": {
    "cpu": "1",
    "memory": "512Mi",
    "disk": "100Mi",
    "network": "disabled"
  },
  "timeLimitMs": 10000,
  "resultCode": null,                  // 0=success, 1=runtime_error, 2=timeout, 3=oom, 4=killed
  "metrics": {
    "execMs": null,
    "cpuMs": null,
    "memoryPeakKB": null,
    "outputBytes": null
  }
}
```

#### 2.1.2 代码执行请求 (CodeExecRequest)

```json
{
  "requestId": "req_a1b2c3d4",
  "sessionId": "sbx_20260630_a1b2c3d4",
  "code": "import sympy as sp\nx = sp.Symbol('x')\nexpr = sp.integrate(sp.sin(x)*sp.exp(x), x)\nprint(f'积分结果: {expr}')",
  "codeType": "computation",           // computation | visualization | simulation | verification | practice
  "subject": "math",                   // math | physics | chemistry | programming
  "gradeLevel": "grade_11",
  "inputFiles": [],                    // 输入文件 OSS Key 列表
  "expectedOutput": null,              // 预期输出（验证模式）
  "libraries": ["sympy", "matplotlib"],
  "envVars": {
    "MPLBACKEND": "Agg"
  }
}
```

#### 2.1.3 代码执行结果 (CodeExecResult)

```json
{
  "requestId": "req_a1b2c3d4",
  "sessionId": "sbx_20260630_a1b2c3d4",
  "status": "success",
  "stdout": "积分结果: exp(x)*sin(x)/2 - exp(x)*cos(x)/2\n",
  "stderr": "",
  "exitCode": 0,
  "outputFiles": [
    {
      "type": "image",
      "format": "png",
      "ossKey": "sandbox/output/req_a1b2c3d4_plot_001.png",
      "url": "https://cdn.primetop.edu/sandbox/output/req_a1b2c3d4_plot_001.png",
      "width": 800,
      "height": 600
    }
  ],
  "structuredOutput": {
    "type": "math_verification",
    "verified": true,
    "expected": "exp(x)*sin(x)/2 - exp(x)*cos(x)/2",
    "actual": "exp(x)*sin(x)/2 - exp(x)*cos(x)/2",
    "match": true
  },
  "metrics": {
    "execMs": 2340,
    "cpuMs": 1980,
    "memoryPeakKB": 45632,
    "outputBytes": 128
  },
  "safetyCheck": {
    "passed": true,
    "flags": [],
    "filteredOutput": false
  }
}
```

### 2.2 数据库表结构

#### 2.2.1 sandbox_session 表

```sql
CREATE TABLE sandbox_session (
    session_id          VARCHAR(48)     PRIMARY KEY COMMENT '沙箱会话ID',
    user_id             BIGINT          NOT NULL COMMENT '用户ID',
    conversation_id     VARCHAR(48)     NULL COMMENT '关联对话ID',
    trigger_type        VARCHAR(32)     NOT NULL COMMENT '触发来源: ai_function_call/manual_practice/auto_verify',
    language            VARCHAR(16)     NOT NULL DEFAULT 'python3' COMMENT '执行语言',
    status              VARCHAR(16)     NOT NULL DEFAULT 'pending' COMMENT 'pending/running/success/failed/timeout/killed',
    result_code         INT             NULL COMMENT '结果码: 0=成功 1=运行时错误 2=超时 3=OOM 4=被杀',
    pod_name            VARCHAR(128)    NULL COMMENT '执行的 Pod 名称',
    node_name           VARCHAR(128)    NULL COMMENT '执行的节点名称',
    cpu_limit           VARCHAR(16)     NOT NULL DEFAULT '1' COMMENT 'CPU 限制',
    memory_limit        VARCHAR(16)     NOT NULL DEFAULT '512Mi' COMMENT '内存限制',
    disk_limit          VARCHAR(16)     NOT NULL DEFAULT '100Mi' COMMENT '磁盘限制',
    time_limit_ms       INT             NOT NULL DEFAULT 10000 COMMENT '执行超时(ms)',
    exec_ms             INT             NULL COMMENT '实际执行时长(ms)',
    cpu_ms              INT             NULL COMMENT 'CPU 使用时长(ms)',
    memory_peak_kb      INT             NULL COMMENT '内存峰值(KB)',
    output_bytes        INT             NULL COMMENT '输出字节数',
    created_at          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    started_at          DATETIME(3)     NULL,
    finished_at         DATETIME(3)     NULL,
    INDEX idx_user_created (user_id, created_at),
    INDEX idx_conversation (conversation_id),
    INDEX idx_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='沙箱执行会话';
```

#### 2.2.2 sandbox_exec_request 表

```sql
CREATE TABLE sandbox_exec_request (
    request_id          VARCHAR(48)     PRIMARY KEY COMMENT '请求ID',
    session_id          VARCHAR(48)     NOT NULL COMMENT '关联沙箱会话',
    code_hash           CHAR(64)        NOT NULL COMMENT '代码SHA-256哈希',
    code_type           VARCHAR(32)     NOT NULL COMMENT 'computation/visualization/simulation/verification/practice',
    subject             VARCHAR(32)     NULL COMMENT '学科',
    grade_level         VARCHAR(32)     NULL COMMENT '年级',
    libraries           JSON            NULL COMMENT '依赖库列表',
    status              VARCHAR(16)     NOT NULL DEFAULT 'pending',
    exit_code           INT             NULL,
    stdout_truncated    TEXT            NULL COMMENT 'stdout前4000字符',
    stderr_truncated    TEXT            NULL COMMENT 'stderr前4000字符',
    output_file_count   INT             NOT NULL DEFAULT 0 COMMENT '输出文件数量',
    verified            TINYINT         NULL COMMENT '验证模式: 1=匹配 0=不匹配',
    safety_passed       TINYINT         NOT NULL DEFAULT 1 COMMENT '安全检查通过',
    safety_flags        JSON            NULL COMMENT '安全标记列表',
    exec_ms             INT             NULL,
    memory_peak_kb      INT             NULL,
    created_at          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    finished_at         DATETIME(3)     NULL,
    CONSTRAINT fk_session FOREIGN KEY (session_id) REFERENCES sandbox_session(session_id),
    INDEX idx_session_created (session_id, created_at),
    INDEX idx_code_hash (code_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='沙箱代码执行请求';
```

#### 2.2.3 sandbox_output_file 表

```sql
CREATE TABLE sandbox_output_file (
    file_id             BIGINT          AUTO_INCREMENT PRIMARY KEY,
    request_id          VARCHAR(48)     NOT NULL COMMENT '关联请求ID',
    file_type           VARCHAR(16)     NOT NULL COMMENT 'image/csv/json/text/html',
    file_format         VARCHAR(16)     NOT NULL COMMENT 'png/svg/csv/json/txt',
    oss_key             VARCHAR(512)    NOT NULL COMMENT 'OSS存储Key',
    cdn_url             VARCHAR(1024)   NULL COMMENT 'CDN访问URL',
    file_size_bytes     INT             NOT NULL,
    width               INT             NULL COMMENT '图片宽度',
    height              INT             NULL COMMENT '图片高度',
    created_at          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    expires_at          DATETIME        NOT NULL COMMENT '过期清理时间',
    CONSTRAINT fk_request FOREIGN KEY (request_id) REFERENCES sandbox_exec_request(request_id),
    INDEX idx_request (request_id),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='沙箱执行输出文件';
```

### 2.3 Redis 缓存策略

| Key 模式 | TTL | 用途 |
| --- | --- | --- |
| `sbx:session:{sessionId}` | 30min | 沙箱会话状态 |
| `sbx:result:{codeHash}` | 24h | 相同代码的执行结果缓存 |
| `sbx:rate:{userId}` | 滑动窗口 | 用户级别执行频率限制 |
| `sbx:pool:available` | - | 可用沙箱 Pod 计数 |
| `sbx:quota:{userId}:{date}` | 24h | 用户每日执行配额 |

---

## 3. API 接口设计

### 3.1 接口总览

| 接口 | 方法 | 路径 | 说明 |
| --- | --- | --- | --- |
| 创建执行会话 | POST | `/api/v1/sandbox/sessions` | 创建一个新的沙箱会话 |
| 执行代码 | POST | `/api/v1/sandbox/sessions/{sessionId}/execute` | 在沙箱中执行代码 |
| 查询执行结果 | GET | `/api/v1/sandbox/requests/{requestId}/result` | 获取执行结果 |
| 获取会话历史 | GET | `/api/v1/sandbox/sessions/{sessionId}/requests` | 获取会话内所有执行请求 |
| 终止执行 | POST | `/api/v1/sandbox/requests/{requestId}/kill` | 强制终止正在运行的执行 |
| 批量验证 | POST | `/api/v1/sandbox/verify` | 批量验证模式（不出图，仅判断正确性） |
| 健康检查 | GET | `/api/v1/sandbox/health` | 沙箱池健康状态 |

### 3.2 详细接口定义

#### 3.2.1 创建执行会话

```
POST /api/v1/sandbox/sessions
Authorization: Bearer {token}
Content-Type: application/json
```

**请求体：**
```json
{
  "conversationId": "conv_88001",
  "trigger": "ai_function_call",
  "language": "python3",
  "resourceProfile": "standard",       // minimal | standard | high_memory
  "timeLimitMs": 10000
}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "sessionId": "sbx_20260630_a1b2c3d4",
    "status": "ready",
    "expiresIn": 1800
  }
}
```

**资源档位说明：**

| 档位 | CPU | 内存 | 磁盘 | 超时 | 适用场景 |
| --- | --- | --- | --- | --- | --- |
| minimal | 0.5 | 128Mi | 20Mi | 5s | 简单算式验算 |
| standard | 1 | 512Mi | 100Mi | 10s | 常规计算+出图 |
| high_memory | 2 | 2Gi | 500Mi | 30s | 大数据量计算/模拟 |

#### 3.2.2 执行代码

```
POST /api/v1/sandbox/sessions/{sessionId}/execute
Authorization: Bearer {token}
Content-Type: application/json
```

**请求体：**
```json
{
  "code": "import sympy as sp\nimport matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\nimport numpy as np\n\nx = np.linspace(-np.pi, np.pi, 200)\ny = np.sin(x) * np.exp(x/5)\n\nplt.figure(figsize=(8, 5))\nplt.plot(x, y, 'b-', linewidth=2)\nplt.title('f(x) = sin(x)·e^(x/5)')\nplt.xlabel('x')\nplt.ylabel('f(x)')\nplt.grid(True, alpha=0.3)\nplt.savefig('/output/plot_001.png', dpi=150, bbox_inches='tight')\nprint('图像已生成')",
  "codeType": "visualization",
  "subject": "math",
  "gradeLevel": "grade_11",
  "libraries": ["numpy", "matplotlib", "sympy"]
}
```

**响应（同步模式）：**
```json
{
  "code": 0,
  "data": {
    "requestId": "req_a1b2c3d4",
    "status": "success",
    "exitCode": 0,
    "stdout": "图像已生成\n",
    "stderr": "",
    "outputFiles": [
      {
        "type": "image",
        "format": "png",
        "url": "https://cdn.primetop.edu/sandbox/output/req_a1b2c3d4_plot_001.png?Expires=...",
        "width": 1200,
        "height": 750
      }
    ],
    "metrics": {
      "execMs": 3200,
      "memoryPeakKB": 68400
    },
    "safetyCheck": {
      "passed": true
    }
  }
}
```

**响应（异步模式，`mode=async`查询参数）：**
```json
{
  "code": 0,
  "data": {
    "requestId": "req_a1b2c3d4",
    "status": "running",
    "pollInterval": 1000
  }
}
```

#### 3.2.3 批量验证接口

专为 AI 解题步骤验证设计——提交一段验证代码和预期结果，快速返回是否匹配。

```
POST /api/v1/sandbox/verify
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "conversations": [
    {
      "refId": "step_1",
      "code": "print(3**2 + 4**2)",
      "expected": "25",
      "matchMode": "exact"        // exact | numeric | regex
    },
    {
      "refId": "step_2",
      "code": "import sympy as sp\nx=sp.Symbol('x')\nprint(sp.integrate(x**2, x))",
      "expected": "x**3/3",
      "matchMode": "sympy"
    }
  ],
  "timeout": 5
}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "results": [
      { "refId": "step_1", "verified": true, "actual": "25", "execMs": 120 },
      { "refId": "step_2", "verified": true, "actual": "x**3/3", "execMs": 890 }
    ],
    "totalMs": 1010
  }
}
```

#### 3.2.4 错误码定义

| 错误码 | HTTP状态 | 说明 |
| --- | --- | --- |
| SBX_001 | 400 | 代码为空或超过长度限制（最大 50KB） |
| SBX_002 | 400 | 不支持的编程语言 |
| SBX_003 | 400 | 包含禁用的库或模块 |
| SBX_004 | 403 | 用户执行配额已用尽 |
| SBX_005 | 403 | 用户执行频率超限（>10次/分钟） |
| SBX_006 | 404 | 会话不存在或已过期 |
| SBX_007 | 409 | 会话正在执行中，不支持并发 |
| SBX_008 | 408 | 执行超时 |
| SBX_009 | 500 | 沙箱 Pod 创建失败 |
| SBX_010 | 500 | 沙箱资源池耗尽 |
| SBX_011 | 503 | 安全检查未通过，执行被拦截 |
| SBX_012 | 500 | 输出文件过大（>10MB） |

---

## 4. 业务逻辑

### 4.1 整体执行流程

```
客户端/AI引擎发起代码执行请求
        │
        ▼
┌───────────────────┐
│ 1. 请求校验        │  ← 检查代码长度、语言、库白名单
│ - 代码长度限制     │
│ - 语言支持检查     │
│ - 库白名单过滤     │
│ - 用户配额检查     │
└───────┬───────────┘
        │ pass
        ▼
┌───────────────────┐
│ 2. 安全预检        │  ← 静态分析拦截危险代码
│ - AST 解析         │
│ - 危险调用检测     │
│ - 网络操作检测     │
│ - 文件系统检测     │
└───────┬───────────┘
        │ safe
        ▼
┌───────────────────┐
│ 3. 结果缓存查询    │  ← SHA-256(code+env) 命中则直接返回
│ - 计算代码哈希     │
│ - 查询缓存结果     │
└───────┬─────┬─────┘
        │     │ cache hit
        │     └──→ 直接返回缓存结果
        │ miss
        ▼
┌───────────────────┐
│ 4. 沙箱分配与调度  │  ← 从 Pod 池分配或创建新沙箱
│ - 资源档位匹配     │
│ - Pod 池分配       │
│ - 执行环境初始化    │
└───────┬───────────┘
        │
        ▼
┌───────────────────┐
│ 5. 代码执行        │  ← 隔离容器内执行
│ - 依赖库安装缓存   │
│ - 资源限制 enforcement │
│ - 执行超时守护     │
│ - stdout/stderr 捕获 │
│ - /output 目录监控  │
└───────┬───────────┘
        │
        ▼
┌───────────────────┐
│ 6. 结果后处理      │
│ - 输出安全过滤     │
│ - 文件上传 OSS     │
│ - 生成 CDN URL     │
│ - 结果缓存写入     │
│ - 执行指标记录     │
└───────┬───────────┘
        │
        ▼
┌───────────────────┐
│ 7. 返回结果        │
│ - 组装响应 JSON    │
│ - 包含输出文件URL  │
│ - 安全标记         │
└───────────────────┘
```

### 4.2 AI Function Calling 集成流程

AI 辅导对话引擎通过 Function Calling 机制触发沙箱执行，以下是一个典型的交互流程：

```
学生: "帮我求 sin(x)·e^x 的不定积分"

AI引擎: 识别为数学积分问题，决定先用代码验证再回答
AI引擎: Function Call → execute_code({
    "code": "import sympy as sp; x=sp.Symbol('x'); print(sp.integrate(sp.sin(x)*sp.exp(x), x))",
    "codeType": "verification",
    "subject": "math"
})

沙箱引擎: 执行代码 → 返回结果: "exp(x)*sin(x)/2 - exp(x)*cos(x)/2"

AI引擎: 基于验证后的结果，生成分步讲解:
  "sin(x)·e^x 的不定积分可以用分部积分法来求..."

AI引擎: Function Call → execute_code({
    "code": "import numpy as np; import matplotlib; matplotlib.use('Agg'); ...plt.savefig('/output/plot.png')",
    "codeType": "visualization"
})

沙箱引擎: 执行代码 → 返回图片URL

AI引擎: 在对话中嵌入函数图像，继续讲解
```

**Function Calling Schema 定义：**

```json
{
  "name": "execute_code",
  "description": "在安全沙箱中执行Python代码，用于数学计算验证、函数绘图、数据分析等。执行环境预装了numpy, sympy, matplotlib, scipy等科学计算库。",
  "parameters": {
    "type": "object",
    "properties": {
      "code": {
        "type": "string",
        "description": "要执行的Python3代码。输出文件请保存到 /output/ 目录。标准输出将通过stdout返回。"
      },
      "code_type": {
        "type": "string",
        "enum": ["computation", "visualization", "verification"],
        "description": "代码类型：计算/可视化/验证"
      },
      "libraries": {
        "type": "array",
        "items": { "type": "string" },
        "description": "需要的额外库（需在白名单中）"
      }
    },
    "required": ["code"]
  }
}
```

### 4.3 状态机

#### 4.3.1 会话状态流转

```
                    ┌─────────┐
         创建 ───→  │ pending │
                    └────┬────┘
                         │ Pod 分配成功
                         ▼
                    ┌─────────┐
                    │  ready  │ ←─── 会话已创建，等待代码执行
                    └────┬────┘
                         │ execute 请求
                         ▼
                    ┌─────────┐
            ┌──────│ running  │──────┐
            │       └────┬────┘      │
            │            │           │
     超时/OOM     正常完成/异常      被kill
            │            │           │
            ▼            ▼           ▼
      ┌─────────┐  ┌─────────┐ ┌─────────┐
      │ timeout │  │ success │ │ killed  │
      └─────────┘  └─────────┘ └─────────┘
            │            │           │
            └────────────┴───────────┘
                         │
                    可继续执行新代码
                    （会话内支持多次执行）
                         │
                    会话过期(30min)
                         │
                         ▼
                    ┌─────────┐
                    │ expired │
                    └─────────┘
```

#### 4.3.2 单次执行请求状态

```
┌─────────┐     ┌─────────┐     ┌──────────┐
│ queued  │────→│ running │────→│ success  │
└─────────┘     └────┬───┘     └──────────┘
                     │
          ┌──────────┼──────────┐
          │          │          │
          ▼          ▼          ▼
     ┌─────────┐ ┌─────────┐ ┌─────────┐
     │ timeout │ │ failed  │ │ killed  │
     └─────────┘ └─────────┘ └─────────┘
```

### 4.4 安全预检逻辑

代码在执行前需通过静态安全分析，拦截高危操作：

| 检测项 | 检测方式 | 处置 |
| --- | --- | --- |
| `import os` / `import subprocess` / `import socket` | AST 节点分析 | 拦截 |
| `open()` 写模式（非 `/output/`、`/tmp/` 路径） | AST 调用分析 | 拦截 |
| `__import__()` / `importlib` | AST 调用分析 | 拦截 |
| `eval()` / `exec()` / `compile()` | AST 调用分析 | 拦截 |
| 网络操作 (`requests`, `urllib`, `http.client`) | import 白名单 | 拦截 |
| `sys.` 系统调用 | AST 属性访问分析 | 拦截 |
| 无限循环检测（`while True` 无 break） | 启发式 AST 检查 | 告警+缩短超时 |
| 递归深度（无递归限制的递归函数） | AST 函数分析 | 告警 |

**AST 安全分析器核心实现：**

```python
import ast

class CodeSafetyAnalyzer(ast.NodeVisitor):
    """代码安全静态分析器"""

    BLOCKED_IMPORTS = {
        'os', 'subprocess', 'socket', 'shutil', 'ctypes',
        'multiprocessing', 'threading', 'signal',
        'requests', 'urllib', 'http', 'ftplib', 'smtplib',
        'telnetlib', 'socketserver', 'asyncio.subprocess',
        'importlib', 'sys', 'pickle', 'marshal',
    }

    BLOCKED_BUILTINS = {
        'eval', 'exec', 'compile', '__import__',
        'globals', 'locals', 'vars', 'dir',
        'breakpoint', 'exit', 'quit',
    }

    ALLOWED_WRITE_PATHS = {'/output/', '/tmp/'}

    def __init__(self):
        self.violations = []

    def analyze(self, code: str) -> list[str]:
        try:
            tree = ast.parse(code)
            self.visit(tree)
        except SyntaxError as e:
            self.violations.append(f"SYNTAX_ERROR: {e}")
        return self.violations

    def visit_Import(self, node: ast.Import):
        for alias in node.names:
            root_module = alias.name.split('.')[0]
            if root_module in self.BLOCKED_IMPORTS:
                self.violations.append(
                    f"BLOCKED_IMPORT: {alias.name} (line {node.lineno})"
                )
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom):
        if node.module:
            root_module = node.module.split('.')[0]
            if root_module in self.BLOCKED_IMPORTS:
                self.violations.append(
                    f"BLOCKED_IMPORT: {node.module} (line {node.lineno})"
                )
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call):
        # 检测 blocked builtins
        if isinstance(node.func, ast.Name):
            if node.func.id in self.BLOCKED_BUILTINS:
                self.violations.append(
                    f"BLOCKED_BUILTIN: {node.func.id} (line {node.lineno})"
                )
        # 检测 open() 写路径
        if isinstance(node.func, ast.Name) and node.func.id == 'open':
            if node.args:
                first_arg = node.args[0]
                if isinstance(first_arg, ast.Constant):
                    path = first_arg.value
                    mode = 'r'
                    if len(node.args) > 1 and isinstance(node.args[1], ast.Constant):
                        mode = node.args[1].value
                    if 'w' in mode or 'a' in mode or '+' in mode:
                        if not any(path.startswith(p) for p in self.ALLOWED_WRITE_PATHS):
                            self.violations.append(
                                f"BLOCKED_WRITE_PATH: {path} (line {node.lineno})"
                            )
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute):
        # 检测 sys. / os. 等通过属性访问
        if isinstance(node.value, ast.Name):
            if node.value.id == 'sys':
                self.violations.append(
                    f"BLOCKED_SYS_ACCESS: sys.{node.attr} (line {node.lineno})"
                )
        self.generic_visit(node)


# 使用示例
analyzer = CodeSafetyAnalyzer()
violations = analyzer.analyze(user_code)
if violations:
    raise SafetyCheckError(violations)
```

### 4.5 沙箱 Pod 生命周期管理

#### 4.5.1 Pod 池预热策略

为减少冷启动延迟，维护一个预热的 Pod 池：

```yaml
# sandbox-pod-pool-config
poolConfig:
  minIdle: 5          # 最小空闲 Pod 数
  maxIdle: 20         # 最大空闲 Pod 数
  maxTotal: 100       # 最大 Pod 总数
  warmupBatch: 5      # 每次预热批量数
  idleTimeoutSec: 300 # 空闲超时回收(秒)
  imagePullPolicy: IfNotPresent
```

#### 4.5.2 沙箱 Pod 模板

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: sandbox-{sessionId}
  labels:
    app: edu-sandbox
    session-id: "{sessionId}"
spec:
  restartPolicy: Never
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    fsGroup: 1000
  containers:
  - name: python-sandbox
    image: primetop/sandbox-python:3.11-v1.2
    resources:
      limits:
        cpu: "1"
        memory: "512Mi"
        ephemeral-storage: "100Mi"
      requests:
        cpu: "0.5"
        memory: "256Mi"
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: ["ALL"]
    env:
    - name: MPLBACKEND
      value: "Agg"
    - name: PYTHONUNBUFFERED
      value: "1"
    volumeMounts:
    - name: output-vol
      mountPath: /output
      readOnly: false
    - name: tmp-vol
      mountPath: /tmp
      readOnly: false
    - name: libs-vol
      mountPath: /opt/preinstalled-libs
      readOnly: true
  volumes:
  - name: output-vol
    emptyDir:
      sizeLimit: 50Mi
  - name: tmp-vol
    emptyDir:
      sizeLimit: 50Mi
  - name: libs-vol
    persistentVolumeClaim:
      claimName: sandbox-preinstalled-libs
  nodeSelector:
    workload: sandbox
  tolerations:
  - key: "sandbox"
    operator: "Equal"
    value: "true"
    effect: "NoSchedule"
```

#### 4.5.3 网络隔离

沙箱 Pod 的网络完全隔离：

```yaml
networkPolicy:
  podSelector:
    matchLabels:
      app: edu-sandbox
  policyTypes:
  - Egress
  - Ingress
  egress: []    # 禁止所有出站
  ingress: []   # 禁止所有入站
```

---

## 5. 关键代码示例

### 5.1 沙箱调度服务核心实现

```java
/**
 * 沙箱执行调度服务
 */
@Service
@Slf4j
public class SandboxExecutionService {

    @Autowired
    private SandboxPoolManager poolManager;
    @Autowired
    private CodeSafetyAnalyzer safetyAnalyzer;
    @Autowired
    private ResultCacheService resultCache;
    @Autowired
    private OutputFileService outputFileService;
    @Autowired
    private SandboxMetricsRecorder metricsRecorder;
    @Autowired
    private QuotaService quotaService;

    @Value("${sandbox.max-code-length:51200}")
    private int maxCodeLength;

    @Value("${sandbox.max-output-size:10485760}")
    private int maxOutputSize;

    /**
     * 执行代码（同步模式）
     */
    public CodeExecResult execute(String sessionId, CodeExecRequest request) {
        long startNs = System.nanoTime();

        // 1. 基础校验
        validateRequest(request);

        // 2. 安全预检
        List<String> violations = safetyAnalyzer.analyze(request.getCode());
        if (!violations.isEmpty()) {
            log.warn("安全检查未通过: sessionId={}, violations={}", sessionId, violations);
            throw new SandboxSafetyException("SBX_011",
                "代码安全检查未通过", violations);
        }

        // 3. 配额检查
        if (!quotaService.checkQuota(request.getUserId())) {
            throw new SandboxException("SBX_004", "执行配额已用尽");
        }

        // 4. 结果缓存查询
        String codeHash = DigestUtils.sha256Hex(
            request.getCode() + "|" + request.getLanguage()
        );
        CodeExecResult cached = resultCache.get(codeHash);
        if (cached != null && cached.getStatus().equals("success")) {
            log.info("命中执行缓存: hash={}", codeHash);
            return cached.toBuilder()
                .requestId(generateRequestId())
                .sessionId(sessionId)
                .cached(true)
                .build();
        }

        // 5. 分配沙箱 Pod
        SandboxPod pod = poolManager.acquire(request.getResourceProfile());
        if (pod == null) {
            throw new SandboxException("SBX_010", "沙箱资源池耗尽，请稍后重试");
        }

        // 6. 执行代码
        try {
            CodeExecResult result = executeInPod(pod, request, codeHash);

            // 7. 后处理
            postProcessResult(result, request);

            // 8. 缓存成功结果
            if ("success".equals(result.getStatus())) {
                resultCache.put(codeHash, result, 24, TimeUnit.HOURS);
            }

            // 9. 记录指标
            long execMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNs);
            metricsRecorder.record(request, result, execMs);

            return result;
        } finally {
            poolManager.release(pod);
        }
    }

    /**
     * 在 Pod 中执行代码
     */
    private CodeExecResult executeInPod(SandboxPod pod, CodeExecRequest request,
                                         String codeHash) {
        // 构建执行命令
        ExecCommand cmd = ExecCommand.builder()
            .command(Arrays.asList("python3", "-c",
                buildWrapperScript(request)))
            .timeout(Duration.ofMillis(request.getTimeLimitMs()))
            .captureStdout(true)
            .captureStderr(true)
            .build();

        ExecResult execResult;
        try {
            execResult = pod.execute(cmd);
        } catch (TimeoutException e) {
            pod.kill();
            return CodeExecResult.timeout(request.getRequestId(),
                request.getTimeLimitMs());
        }

        // 收集输出文件
        List<OutputFile> outputFiles = pod.collectOutputFiles("/output/");

        // 限制输出大小
        if (execResult.getStdout().length() > maxOutputSize) {
            execResult.setStdout(
                execResult.getStdout().substring(0, maxOutputSize)
                + "\n[output truncated]"
            );
        }

        return CodeExecResult.builder()
            .requestId(request.getRequestId())
            .sessionId(request.getSessionId())
            .status(execResult.getExitCode() == 0 ? "success" : "failed")
            .exitCode(execResult.getExitCode())
            .stdout(execResult.getStdout())
            .stderr(execResult.getStderr())
            .outputFiles(outputFiles)
            .metrics(ExecMetrics.builder()
                .execMs(execResult.getExecMs())
                .memoryPeakKB(execResult.getMemoryPeakKB())
                .build())
            .build();
    }

    /**
     * 构建包装脚本（资源限制+输出捕获）
     */
    private String buildWrapperScript(CodeExecRequest request) {
        return String.format("""
            import sys, resource, signal, faulthandler

            # 设置内存限制
            resource.setrlimit(resource.RLIMIT_AS, (%d, %d))

            # 启用故障转储
            faulthandler.enable()

            # 设置 CPU 时间限制
            resource.setrlimit(resource.RLIMIT_CPU, (%d, %d))

            # 超时信号
            def timeout_handler(signum, frame):
                print("[SANDBOX_TIMEOUT]", file=sys.stderr)
                sys.exit(2)
            signal.signal(signal.SIGALRM, timeout_handler)
            signal.alarm(%d)

            # 执行用户代码
            try:
                exec(compile('''%s''', '<sandbox>', 'exec'))
            except SystemExit:
                raise
            except Exception as e:
                import traceback
                traceback.print_exc()
                sys.exit(1)
            """,
            request.getMemoryLimitBytes(),
            request.getMemoryLimitBytes(),
            request.getCpuTimeLimitSec(),
            request.getCpuTimeLimitSec(),
            request.getTimeLimitSec(),
            sanitizeCode(request.getCode())
        );
    }

    private void validateRequest(CodeExecRequest request) {
        if (request.getCode() == null || request.getCode().isBlank()) {
            throw new SandboxException("SBX_001", "代码不能为空");
        }
        if (request.getCode().length() > maxCodeLength) {
            throw new SandboxException("SBX_001",
                "代码超过长度限制(" + maxCodeLength + "字符)");
        }
    }

    private void postProcessResult(CodeExecResult result, CodeExecRequest request) {
        // 输出文件上传 OSS
        if (result.getOutputFiles() != null) {
            for (OutputFile file : result.getOutputFiles()) {
                String ossKey = outputFileService.uploadToOss(
                    file.getBytes(),
                    "sandbox/output/" + request.getRequestId()
                );
                file.setOssKey(ossKey);
                file.setUrl(outputFileService.generateCdnUrl(ossKey, 30)); // 30分钟有效
            }
        }

        // 安全过滤 stdout/stderr
        result.setStdout(SafetyFilter.filterOutput(result.getStdout()));
        result.setStderr(SafetyFilter.filterOutput(result.getStderr()));
    }
}
```

### 5.2 沙箱 Pod 池管理器

```java
/**
 * 沙箱 Pod 池管理器
 */
@Service
@Slf4j
public class SandboxPoolManager {

    @Autowired
    private KubernetesClient k8sClient;

    @Value("${sandbox.namespace:edu-sandbox}")
    private String namespace;

    @Value("${sandbox.pool.min-idle:5}")
    private int minIdle;

    @Value("${sandbox.pool.max-total:100}")
    private int maxTotal;

    private final BlockingQueue<SandboxPod> idleStandard = new LinkedBlockingQueue<>();
    private final BlockingQueue<SandboxPod> idleHighMem = new LinkedBlockingQueue<>();
    private final AtomicInteger totalCreated = new AtomicInteger(0);

    @PostConstruct
    public void init() {
        // 启动时预热 Pod
        for (int i = 0; i < minIdle; i++) {
            createAndPoolPod("standard", idleStandard);
        }
        // 定时补充
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        scheduler.scheduleAtFixedRate(this::replenishPool, 10, 30, TimeUnit.SECONDS);
    }

    /**
     * 获取一个可用沙箱 Pod
     */
    public SandboxPod acquire(String profile) {
        BlockingQueue<SandboxPod> pool = "high_memory".equals(profile)
            ? idleHighMem : idleStandard;

        SandboxPod pod = pool.poll();
        if (pod != null && pod.isHealthy()) {
            return pod;
        }

        // 池中没有可用 Pod，创建新的
        if (totalCreated.get() < maxTotal) {
            pod = createPod(profile);
            if (pod != null) {
                totalCreated.incrementAndGet();
                return pod;
            }
        }

        // 等待其他 Pod 释放
        try {
            pod = pool.poll(5, TimeUnit.SECONDS);
            return pod;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        }
    }

    /**
     * 释放 Pod 回池
     */
    public void release(SandboxPod pod) {
        if (pod == null) return;

        try {
            // 清理执行环境
            pod.cleanup();

            BlockingQueue<SandboxPod> pool = pod.isHighMemory()
                ? idleHighMem : idleStandard;

            if (!pool.offer(pod)) {
                // 池满，销毁 Pod
                destroyPod(pod);
            }
        } catch (Exception e) {
            log.warn("Pod 清理失败，直接销毁: {}", pod.getName(), e);
            destroyPod(pod);
        }
    }

    /**
     * 创建新沙箱 Pod
     */
    private SandboxPod createPod(String profile) {
        try {
            String sessionTag = "warm-" + UUID.randomUUID().toString().substring(0, 8);
            Pod pod = k8sClient.pods()
                .inNamespace(namespace)
                .create(buildPodManifest(sessionTag, profile));

            // 等待 Pod Ready
            boolean ready = waitForPodReady(pod.getMetadata().getName(), 15);
            if (!ready) {
                k8sClient.pods().inNamespace(namespace)
                    .withName(pod.getMetadata().getName()).delete();
                return null;
            }

            return new SandboxPod(pod.getMetadata().getName(), profile);
        } catch (Exception e) {
            log.error("创建沙箱 Pod 失败", e);
            return null;
        }
    }

    private void replenishPool() {
        int idleCount = idleStandard.size();
        if (idleCount < minIdle && totalCreated.get() < maxTotal) {
            int need = Math.min(minIdle - idleCount, 5);
            for (int i = 0; i < need; i++) {
                createAndPoolPod("standard", idleStandard);
            }
            log.debug("补充沙箱 Pod: need={}, created={}", need, need);
        }
    }
}
```

### 5.3 预装镜像 Dockerfile

```dockerfile
# primetop/sandbox-python:3.11-v1.2
FROM python:3.11-slim-bookworm

# 安全：创建非 root 用户
RUN groupadd -r sandbox && useradd -r -g sandbox -u 1000 sandbox

# 预装科学计算库（利用分层缓存）
RUN pip install --no-cache-dir \
    numpy==1.26.4 \
    scipy==1.12.0 \
    sympy==1.12 \
    matplotlib==3.8.3 \
    pandas==2.2.1 \
    networkx==3.2.1 \
    chempy==0.8.1 \
    pint==0.23 \
    statistics \
    fractions \
    && rm -rf /root/.cache/pip

# 设置 matplotlib 无头模式
ENV MPLBACKEND=Agg
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# 创建输出目录
RUN mkdir -p /output /tmp/sandbox && \
    chown -R sandbox:sandbox /output /tmp/sandbox

# 切换非 root 用户
USER sandbox
WORKDIR /tmp/sandbox

# 健康检查
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
    CMD python3 -c "print('ok')" || exit 1
```

### 5.4 AI 辅导场景的 Prompt 模板

以下是 AI 辅导对话引擎中引导 AI 使用代码沙箱的 System Prompt 片段：

```text
## 工具使用指南 - 代码执行沙箱

你可以在需要时调用 `execute_code` 工具来执行 Python 代码。沙箱环境预装了以下库：
- sympy: 符号计算（积分、微分、方程求解、化简）
- numpy: 数值计算
- matplotlib: 绘制函数图像和图表
- scipy: 科学计算
- pandas: 数据处理
- chempy: 化学方程式配平与计算
- pint: 物理单位换算

### 使用场景
1. **数学计算验证**: 在给出复杂计算结果前，先用代码验证
   - 多步推导的计算结果
   - 不定积分/定积分
   - 复杂的代数化简
   - 求解方程组

2. **函数图像绘制**: 当可视化可以帮助学生理解时
   - 函数图像
   - 几何图形
   - 数据统计图

3. **物理/化学计算**: 需要精确数值计算时
   - 运动学计算
   - 电路分析
   - 化学方程式配平
   - 浓度计算

### 规则
- 代码必须保存图片到 `/output/` 目录
- 打印输出（print）的内容会返回给你
- 不要在代码中尝试网络请求或文件系统操作
- 代码应简洁高效，避免长时间计算
- 对于简单的心算就能解决的题目，不需要使用代码
```

---

## 6. 错误处理

### 6.1 异常分类与处理策略

| 异常类型 | 错误码 | 处理策略 | 用户提示 |
| --- | --- | --- | --- |
| 语法错误 | SBX_001 | 拒绝执行 | "代码格式有误，请检查" |
| 安全违规 | SBX_011 | 拒绝执行+记录日志 | "代码包含不允许的操作" |
| 配额耗尽 | SBX_004 | 拒绝执行 | "今日计算次数已用完，明日重置" |
| 频率限制 | SBX_005 | 拒绝执行 | "操作太频繁，请稍等" |
| 执行超时 | SBX_008 | Kill Pod | "计算超时，可能需要简化问题" |
| 内存溢出 | SBX_009 | Kill Pod | "计算资源不足" |
| Pod 创建失败 | SBX_009 | 重试+告警 | "系统繁忙，请稍后重试" |
| 池资源耗尽 | SBX_010 | 排队等待 | "系统繁忙，正在排队" |
| 输出过大 | SBX_012 | 截断输出 | 正常返回截断后的结果 |

### 6.2 降级策略

```
沙箱服务不可用时的降级链路：

1. 沙箱服务正常 → 完整代码执行能力

2. 沙箱池满 → 等待 5s 获取 Pod → 超时则降级

3. 沙箱服务完全不可用 →
   - AI 辅导引擎继续正常工作（不调用 execute_code）
   - AI 直接使用自身推理能力回答
   - 不影响其他功能模块
   - 触发告警，运维介入

4. 部分沙箱节点故障 →
   - K8s 自动调度到健康节点
   - 故障节点上的 Pod 被 GC 回收
   - 不影响新会话
```

### 6.3 重试策略

```java
/**
 * 沙箱执行重试策略
 */
@Retryable(
    value = {PodCreationException.class, TransientException.class},
    maxAttempts = 2,
    backoff = @Backoff(delay = 500, multiplier = 2)
)
public CodeExecResult executeWithRetry(CodeExecRequest request) {
    return execute(request);
}

/**
 * 熔断保护 - 当沙箱故障率过高时熔断
 */
@CircuitBreaker(
    name = "sandbox-execution",
    fallbackMethod = "executeFallback"
)
public CodeExecResult executeWithCircuitBreaker(CodeExecRequest request) {
    return executeWithRetry(request);
}

/**
 * 熔断降级：返回"沙箱不可用"标记，AI引擎自行处理
 */
public CodeExecResult executeFallback(CodeExecRequest request, Exception e) {
    log.warn("沙箱熔断降级: requestId={}", request.getRequestId(), e);
    return CodeExecResult.builder()
        .requestId(request.getRequestId())
        .status("degraded")
        .message("沙箱服务暂时不可用，AI将直接回答")
        .build();
}
```

---

## 7. 性能优化

### 7.1 冷启动优化

| 策略 | 说明 | 效果 |
| --- | --- | --- |
| Pod 池预热 | 维持 5-20 个预热的 Pod | 避免 Pod 创建延迟（~2-5s） |
| 镜像预拉取 | 节点上预拉取沙箱镜像 | 避免 ImagePull 延迟 |
| 库预装 | 科学计算库打包进镜像 | 避免运行时 pip install |
| 会话复用 | 一个会话内多次执行复用同一 Pod | 避免重复 Pod 分配 |

### 7.2 结果缓存

对于相同的代码（SHA-256 匹配），直接返回缓存的执行结果，避免重复计算。

```java
/**
 * 结果缓存 Key 生成
 */
public String buildCacheKey(CodeExecRequest request) {
    String raw = request.getCode() + "|"
        + request.getLanguage() + "|"
        + StringUtils.join(request.getLibraries(), ",");
    return "sbx:result:" + DigestUtils.sha256Hex(raw);
}
```

**缓存失效策略：**
- TTL: 24 小时
- 镜像版本更新时批量失效
- 手动清除接口（管理后台）

### 7.3 配额与限流

| 维度 | 限制 | 说明 |
| --- | --- | --- |
| 用户日配额 | 免费: 20次/天, 会员: 200次/天 | 每日 0 点重置 |
| 用户频率 | 10次/分钟 | 滑动窗口限流 |
| 单次会话 | 50次/会话 | 防止单会话过度消耗 |
| 并发执行 | 同一用户最多 1 个并发 | 串行执行 |
| 全局并发 | 最大 100 个 Pod | 保护集群资源 |

### 7.4 资源回收

- **执行完成后**: 立即回收 Pod 到池中（如会话活跃）
- **会话过期**: 30 分钟无活动，销毁 Pod
- **输出文件**: CDN URL 有效期 30 分钟，OSS 文件 24 小时后清理
- **审计日志**: 90 天保留

---

## 8. 安全考虑

### 8.1 安全防线（纵深防御）

```
┌────────────────────────────────────────────────────────────┐
│                     安全防线架构                            │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  第1层: 代码静态分析 (AST Safety Analyzer)                  │
│    ↓ (通过)                                                │
│  第2层: 库白名单过滤 (Import Whitelist)                     │
│    ↓ (通过)                                                │
│  第3层: 容器隔离 (Non-root + readOnlyRootFS + drop ALL)     │
│    ↓ (通过)                                                │
│  第4层: 资源限制 (CPU/Memory/Disk/CPU-time)                 │
│    ↓ (通过)                                                │
│  第5层: 网络隔离 (NetworkPolicy: deny all)                  │
│    ↓ (通过)                                                │
│  第6层: 超时保护 (SIGALRM + Wall clock timeout)             │
│    ↓ (通过)                                                │
│  第7层: 输出安全过滤 (SafetyFilter on stdout/stderr)        │
│    ↓ (通过)                                                │
│  第8层: 用户配额限制 (日配额 + 频率限制)                     │
│    ↓ (通过)                                                │
│  第9层: 审计日志 (全量执行日志留存)                          │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 8.2 输出安全过滤

```java
/**
 * 执行输出安全过滤器
 */
public class SafetyFilter {

    // 敏感信息正则模式
    private static final List<Pattern> SENSITIVE_PATTERNS = List.of(
        // 手机号
        Pattern.compile("1[3-9]\\d{9}"),
        // 身份证号
        Pattern.compile("\\d{17}[0-9Xx]"),
        // 邮箱
        Pattern.compile("[\\w.-]+@[\\w.-]+\\.\\w+"),
        // IP 地址
        Pattern.compile("\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b"),
        // 密钥/Token
        Pattern.compile("(?i)(?:key|token|secret|password|api[_-]?key)\\s*[=:]\\s*\\S+"),
        // 文件系统路径（可能的敏感路径）
        Pattern.compile("/(?:etc|root|home|var|proc|sys)/[^\\s]+")
    );

    /**
     * 过滤输出中的敏感信息
     */
    public static String filterOutput(String output, Long userId) {
        if (output == null || output.isEmpty()) {
            return output;
        }

        String filtered = output;
        int totalHits = 0;

        for (Pattern pattern : SENSITIVE_PATTERNS) {
            Matcher matcher = pattern.matcher(filtered);
            StringBuffer sb = new StringBuffer();
            int hits = 0;
            while (matcher.find()) {
                hits++;
                matcher.appendReplacement(sb, "******");
            }
            matcher.appendTail(sb);
            filtered = sb.toString();
            totalHits += hits;
        }

        // 命中敏感信息时写审计日志：不记录原始内容，只记录命中数量，防止审计日志本身成为泄漏源
        if (totalHits > 0) {
            AuditLog.record(AuditEvent.builder()
                .eventType("SANDBOX_OUTPUT_FILTERED")
                .userId(userId)
                .detail("sensitive_hits=" + totalHits)
                .build());
        }

        return filtered;
    }

    /**
     * 判断输出是否包含敏感信息
     * 用于在响应中打标，供上游（AI 引擎/BFF）决定是否降权展示或转人工复核
     */
    public static boolean containsSensitive(String output) {
        if (output == null || output.isEmpty()) {
            return false;
        }
        return SENSITIVE_PATTERNS.stream().anyMatch(p -> p.matcher(output).find());
    }
}
```

**过滤规则说明：**

| 规则 | 匹配目标 | 替换策略 | 误伤控制 |
| --- | --- | --- | --- |
| 手机号 | `1[3-9]\d{9}` | `******` | 数学输出出现 11 位连续数字概率极低，命中即遮蔽 |
| 身份证号 | 18 位（末位含 X） | `******` | 同上 |
| 邮箱 | 通用邮箱正则 | `******` | 正常数学习题输出不会包含邮箱 |
| IP 地址 | 点分四段 | `******` | 数学/物理输出中可能误伤版本号式数字串，但概率低且遮蔽无害 |
| 密钥/Token | key/token/secret/password 赋值形态 | `******` | 仅匹配赋值形态，普通英文单词不误伤 |
| 敏感路径 | /etc、/root、/home 等 | `******` | 沙箱本身只读根文件系统，此规则为纵深防御兜底 |

**过滤执行时机：** stdout 与 stderr 分别过滤后再拼接；输出文件（图片）不做内容过滤（图片不承载上述文本模式），但文件名同样过一遍过滤规则。

**失效处理：** 若过滤后总长度变化超过原文 50%（说明可能存在规避编码），整体标记 `safetyCheck.passed=false`，由 AI 引擎决定不引用该输出。

### 8.3 AI 生成代码的注入防护

AI 生成的代码按"不可信输入"对待，即便通过了 §4.4 静态分析，仍需以下源头治理：

| 防线 | 机制 | 说明 |
| --- | --- | --- |
| Prompt 约束 | §5.4 工具使用指南红线 | AI 被明确告知禁止网络请求与文件系统操作，从生成源头降低恶意/越权代码概率 |
| 会话级熔断 | 50 次/会话硬上限（§7.3） | 防止 AI 进入 runaway 循环调用（如递归自我触发）耗尽资源 |
| 拦截反馈闭环 | 同会话安全拦截 ≥3 次触发事件 | 发布 `sandbox.exec.intercepted` 事件（含 conversationId 与拦截原因），AI 编排引擎消费后调整 prompt 策略或终止该会话的工具调用权限 |
| 全量审计 | 每次拦截记录会话/代码哈希 | 支持事后回放 AI 生成代码的完整上下文 |

---

## 9. 监控告警与审计

### 9.1 核心监控指标

| 指标 | 定义 | 目标 | 告警阈值 |
| --- | --- | --- | --- |
| 执行成功率 | 成功执行数 / 总执行请求数 | ≥99.5% | <98% 持续 10min → P1 |
| P95 端到端延迟 | 请求受理 → 结果返回（含冷启动） | ≤8s | >12s 持续 15min → P2 |
| P99 端到端延迟 | 同上 | ≤15s | >25s 持续 15min → P2 |
| 缓存命中率 | 缓存命中数 / 总请求数 | ≥60% | <40% 连续 3 天 → P3 |
| Pod 池水位 | 使用中 Pod / 池容量 | 40%~70% 健康 | >85% 持续 10min → P1（SBX_010 风暴前兆） |
| 安全拦截率 | 拦截数 / 总请求数 | <2% | >10% 持续 1h → P2（攻击或误伤） |
| 熔断打开次数 | 熔断器 OPEN 状态进入次数 | 0 | ≥1 → P2 |
| 配额拒绝率 | SBX_004/SBX_005 拒绝数 / 总请求数 | <5% | >15% 持续 1h → P3（运营参考） |
| 输出上传失败率 | OSS 上传失败 / 有文件输出请求 | <0.5% | >2% 持续 30min → P2 |
| 冷启动占比 | 新创建 Pod 执行占比 | <30% | >60% 连续 1h → P3（预热不足） |

### 9.2 告警分级

| 级别 | 触发条件 | 响应要求 |
| --- | --- | --- |
| P1 | 成功率 <98%；Pod 池水位 >85%；OSS 上传失败率 >2% | 5min 内响应，15min 内止血（扩容池/切换节点） |
| P2 | 延迟超标；拦截率异常；熔断打开；P99 超标 | 30min 内响应，当日出根因 |
| P3 | 缓存命中率低；配额拒绝率高；冷启动占比高 | 工作日处理，纳入优化 backlog |

### 9.3 审计日志

每次执行全量落审计日志（与 §2.2.2 执行记录表互补，审计日志偏安全维度、不可变）。

**审计事件类型：**

| 事件类型 | 触发时机 | 关键字段 |
| --- | --- | --- |
| SESSION_CREATED | 会话创建 | session_id, conversation_id, resource_profile, user_id_hash |
| EXEC_SUBMITTED | 执行请求受理 | request_id, session_id, code_hash, code_type, language |
| EXEC_BLOCKED | 安全预检/输出过滤拦截 | request_id, code_hash, intercept_stage（AST/whitelist/output）, intercept_reason |
| EXEC_COMPLETED | 执行完成 | request_id, duration_ms, exit_code, output_file_count |
| EXEC_TIMEOUT | 执行超时 | request_id, time_limit_ms, resource_profile |
| QUOTA_EXCEEDED | 配额/频率拒绝 | user_id_hash, limit_type（daily/rate/session） |
| POD_RECYCLED | Pod 回收 | pod_name, session_id, recycle_reason |

**存储与保留：**
- 存储：ClickHouse 审计专用表（只追加，禁 UPDATE/DELETE，删除走 TTL）
- 保留：90 天（与 §7.4 一致，为合规下限）
- 内容红线：只存 `code_hash`（SHA-256），永不存代码原文；输出内容不落审计日志

### 9.4 内部事件

| 事件 | 发布时机 | 订阅方 | 用途 |
| --- | --- | --- | --- |
| sandbox.session.created | 会话创建 | 监控、计费 | 会话计数 |
| sandbox.exec.completed | 执行完成 | AI 编排引擎（异步模式轮询替代）、监控 | 结果回推、延迟统计 |
| sandbox.exec.intercepted | 安全拦截 | AI 编排引擎、安全运营 | §8.3 拦截反馈闭环 |
| sandbox.exec.degraded | 熔断降级 | AI 编排引擎、监控 | AI 切换无验证回答 |

事件均携带 `request_id` 与 `session_id`，经 Outbox 发布（与主流程同事务写入），保证不丢。

---

## 10. 合规要点

| 编号 | 要点 | 落实位置 |
| --- | --- | --- |
| C1 | 代码原文不落库：执行记录与审计日志只存 SHA-256 哈希，防止用户/AI 在代码中写入隐私信息后被长期留存 | §2.2.2、§9.3 |
| C2 | 输出强制 PII 过滤后才返回上游，过滤命中记审计 | §8.2 |
| C3 | 防沉迷时段总红线：未成年人账号在防沉迷模块裁决的禁用时段内，沙箱执行一律 fail-closed 拒绝（SBX_004 语义复用，提示语由 BFF 统一映射为防沉迷话术） | §4.1 步骤 1 配额检查 |
| C4 | 审计日志中 user_id 以 HMAC-SHA256(user_id, 审计专用盐) 存储，不可逆 | §9.3 |
| C5 | 输出文件双时限：CDN URL 30 分钟过期，OSS 对象 24 小时清理，杜绝长期公开可访问 | §7.4 |
| C6 | 沙箱默认无网络（deny-all NetworkPolicy）且不挂载任何用户数据卷，从环境上保证"代码无法访问/导出用户个人数据" | §4.5.3 |
| C7 | 家长端可查询孩子当日沙箱执行次数与拦截计数（不含代码内容），路径归家长中心数据查询 | 家长中心模块 |
| C8 | 执行记录、审计日志、输出文件全部存储于境内同区域（OSS/K8s/ClickHouse 同地域），不出境 | §1.3 部署约束 |

---

## 11. 契约对齐与关联文档

### 11.1 契约裁决（R1-R10）

| 编号 | 裁决 | 说明 |
| --- | --- | --- |
| R1 | 程序化验算权威归本引擎 | AI 引擎不得自行"心算"后声称已验证；凡标注"已验证"的数值结论必须来自 `execute_code`/`verify` 接口返回 |
| R2 | 配额统一裁决 | 日配额/频率/会话上限由本引擎统一判定，上游（AI 编排引擎）不做本地预扣、不缓存额度 |
| R3 | 输出文件生命周期权威 | CDN 30min/OSS 24h 以本文档为准；客户端不得转存为永久本地资源，PDF 导出等二次分发需重新走签名申请 |
| R4 | 与统一学科计算引擎分工 | 学科公式库/符号推导封装归《服务端-统一学科计算引擎与符号推理服务》，本引擎只提供通用代码执行环境，不维护学科公式与单位库 |
| R5 | Function Calling schema 权威 | `execute_code` 工具定义（参数/使用规则）以本文档 §5.4 为准，AI 编排引擎不得私自扩展工具参数 |
| R6 | 熔断降级透明标记 | 降级响应 status=degraded（§6.3），AI 引擎须继续无验证回答，且不得向学生暴露"沙箱/容器"等技术词（话术归 AI 引擎层） |
| R7 | 错误码对外映射 | SBX_xxx 为内部符号码；BFF 对外统一映射为基础错误码语义（40103 等通用码归口 R6），不直接透传 SBX 码 |
| R8 | 编程评测权威外置 | 判分/测试用例比对归编程练习评测服务，本引擎仅提供运行环境与原始输出，不产出分数与等级 |
| R9 | 审计保留期为合规下限 | 90 天为最低保留要求，任何模块不得要求更短；更长保留需安全合规评审 |
| R10 | 会话溯源字段 | 会话创建必传 conversationId（§3.2.1），用于审计回放与 AI 会话级拦截统计，禁止空值创建 |

### 11.2 关联文档

| 文档 | 关系 |
| --- | --- |
| AI辅导全链路请求处理与编排设计-详细设计 | 上游调用编排，Function Calling 集成 |
| AI对话引擎与会话管理-详细设计 | 上游会话管理，conversationId 来源 |
| 服务端-教育AI智能体多步推理与工具调用编排引擎-详细设计 | 上游工具调用编排，runaway 防护协同 |
| 服务端-统一学科计算引擎与符号推理服务-详细设计 | 学科公式能力互补（R4） |
| 服务端-AI提示词注入攻击防御与对抗性输入智能识别拦截引擎-详细设计 | 输入安全协同（学生直接输入路径） |
| 服务端-理科解题步骤推导与模型匹配解析服务-详细设计 | 消费方，计算验证调用 |
| 客户端-数学函数图形绘制与交互式几何画板组件-详细设计 | 消费方，图像输出渲染 |
| 编程学习系统-详细设计 | 消费方，编程练习运行环境（判分归 R8） |
| 服务端-AI模型调用多供应商容灾切换与自动降级引擎-详细设计 | 降级策略参考，熔断模式对齐 |
| 错误处理与服务降级策略-详细设计 | 全局降级总纲，本文档 §6.2/§6.3 对齐 |
| 日志与监控告警体系-详细设计 | 监控告警基础设施，§9 指标接入 |
| 数据安全与隐私合规体系-详细设计 | 合规总纲，§10 对齐 |
| 防沉迷与未成年人保护机制-详细设计 | C3 防沉迷时段裁决来源 |

---

## 12. 验收场景

| 编号 | 场景 | 预期结果 |
| --- | --- | --- |
| AC01 | 提交包含 `os.system('ls')` 的代码 | 静态分析拦截，返回 SBX_011，审计记 EXEC_BLOCKED（stage=AST） |
| AC02 | 提交 `import numpy` 代码 / `import socket` 代码 | 前者执行成功；后者库白名单拒绝 SBX_003 |
| AC03 | 提交死循环代码 | 10s 超时 SIGKILL，返回 SBX_008，Pod 回收，同节点其他 Pod 不受影响 |
| AC04 | 提交申请 2GB 内存的代码（standard 档 512Mi） | OOM Kill，返回 SBX_009，无宿主机内存泄漏 |
| AC05 | 沙箱内发起外网请求（如 urllib 访问公网 IP） | NetworkPolicy deny-all 生效，请求失败，执行结果不受影响 |
| AC06 | 免费用户当日第 21 次执行请求 | 返回 SBX_004；次日 0 点配额重置可再次执行 |
| AC07 | 同用户同会话并发提交两个执行请求 | 第二个返回 SBX_007，不进入队列 |
| AC08 | 同一代码 10 秒内重复执行 | 第二次走缓存，execMs <200ms，结果与第一次一致 |
| AC09 | 同会话连续执行 3 段不同代码 | 复用同一 Pod，仅初始化环境一次 |
| AC10 | 会话创建后 30 分钟无活动再执行 | 返回 SBX_006，需重新创建会话 |
| AC11 | 代码 print 一个手机号 | 输出中手机号被遮蔽为 ******，审计记 SANDBOX_OUTPUT_FILTERED |
| AC12 | 连续模拟 Pod 创建失败 | 熔断器 OPEN，执行返回 degraded，AI 引擎继续无验证回答，P2 告警触发 |
| AC13 | 沙箱服务整体下线 | AI 辅导对话主功能不受影响（§6.2 降级链路 3），无 execute_code 调用 |
| AC14 | 瞬时 150 并发执行请求（池容量 100） | 先排队等待；等待 5s 超时部分返回 SBX_010，池水位 P1 告警触发 |
| AC15 | 未成年人账号在防沉迷禁用时段执行 | fail-closed 拒绝，提示映射为防沉迷话术（C3） |
| AC16 | 审计日志查询 | 可查到 90 天内全部 EXEC_* 事件，无代码原文，user_id 为哈希值 |

---

## 13. 维护记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v1.0 | 2026-08 初批次 | 初始版本：模块定位/数据模型/三表 DDL/Redis 策略/API×3（会话/执行/批量验证）+SBX_001~012/整体执行流程/Function Calling 集成/双状态机/安全预检/Pod 池与模板/网络隔离/调度与池管理代码/Dockerfile/Prompt 模板/错误处理与降级/重试熔断/性能优化/安全防线。文件在 §8.2 `SafetyFilter.filterOutput` 方法签名处截断（围栏未闭合 @L1408），§8.2 后半及监控/合规/契约/验收/维护记录全缺 |
| v1.1 | 2026-11-16 补全 | 补齐 §8.2 `filterOutput` 完整实现（逐模式遮蔽+审计只记数量+`containsSensitive` 打标方法+六条过滤规则说明表+图片文件名过滤+失效 fail 标记）与 §8.3 AI 生成代码注入防护四道防线；新增 §9 监控告警与审计（10 项指标+三级告警+七类审计事件+四内部事件 Outbox）、§10 合规 C1-C8、§11 契约 R1-R10 与 13 篇关联文档、§12 验收 AC01-AC16、§13 维护记录。错误码沿用 v1.0 SBX_xxx 符号码体系零新增数字段位。全文经 node 围栏计数核验（BALANCED）+UTF-8 无 BOM |
