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
    public static String filterOutput}