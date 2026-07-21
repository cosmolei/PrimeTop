# 管理后台 - AI模型与Prompt模板配置工作台 详细设计

> **文档版本**: v1.0  
> **创建日期**: 2026-07-22  
> **关联模块**: AI服务层、管理后台  
> **关联原始设计**: §6.2 AI智能辅导、§8.5 AI能力架构、§7.3 管理后台功能清单

---

## 1. 文档目的

本文档定义管理后台中「AI模型与Prompt模板配置工作台」的完整设计方案，覆盖管理员在后台对 AI 大模型供应商、模型参数、Prompt 模板、路由策略、成本预算等进行可视化配置和管理的全部交互流程、页面结构、数据模型与接口设计。

**目标读者**: 前端开发工程师、后端开发工程师、AI工程师、产品运营人员

**核心目标**: 让运营和AI团队能够在无需开发介入的情况下，完成模型切换、Prompt调优、路由策略调整、成本管控等日常操作。

---

## 2. 功能总览

### 2.1 功能模块地图

```
AI模型与Prompt模板配置工作台
├── 1. 模型供应商管理
│   ├── 供应商列表与状态监控
│   ├── 新增/编辑供应商配置
│   ├── API Key 与密钥管理
│   └── 供应商健康度探测
│
├── 2. 模型实例管理
│   ├── 模型实例列表
│   ├── 新增/编辑模型实例
│   ├── 模型能力标签配置
│   ├── 模型参数预设管理
│   └── 模型启停与灰度比例
│
├── 3. Prompt模板管理
│   ├── Prompt模板列表与搜索
│   ├── Prompt编辑器（变量插入+版本对比）
│   ├── Prompt测试沙箱
│   ├── Prompt版本管理与回滚
│   └── Prompt效果AB实验配置
│
├── 4. 场景路由策略
│   ├── 场景列表（问答/解题/作文/背诵...）
│   ├── 路由规则编排（模型+Prompt+参数）
│   ├── 优先级与降级链配置
│   └── 灰度发布策略
│
├── 5. 成本与用量管控
│   ├── 场景级Token预算配置
│   ├── 模型级调用限额
│   ├── 实时用量看板
│   └── 超额告警规则
│
└── 6. 操作审计与变更日志
    ├── 配置变更历史
    ├── 操作人员追踪
    └── 配置回滚
```

### 2.2 角色权限矩阵

| 操作 | 超级管理员 | AI工程师 | 运营人员 | 内容编辑 | 只读访客 |
|------|:---:|:---:|:---:|:---:|:---:|
| 查看模型供应商 | ✅ | ✅ | ✅ | ❌ | ✅ |
| 编辑供应商配置 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 查看Prompt模板 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 编辑Prompt模板 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 发布Prompt版本 | ✅ | ✅ | ❌ | ❌ | ❌ |
| Prompt测试沙箱 | ✅ | ✅ | ✅ | ❌ | ❌ |
| 配置路由策略 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 调整成本预算 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 查看用量看板 | ✅ | ✅ | ✅ | ❌ | ✅ |
| 查看审计日志 | ✅ | ✅ | ❌ | ❌ | ❌ |

---

## 3. 页面结构与导航设计

### 3.1 一级导航布局

```
┌─────────────────────────────────────────────────────────┐
│  PrimeTop 管理后台                                       │
│  [用户管理] [内容管理] [AI管理▼] [数据看板] [系统设置]    │
│                          ├── 模型供应商管理               │
│                          ├── Prompt模板管理               │
│                          ├── 场景路由策略                  │
│                          ├── 成本与用量管控                │
│                          └── 操作审计日志                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [当前页面内容区域]                                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 3.2 全局设计规范

| 规范项 | 说明 |
|--------|------|
| 框架 | 基于 Ant Design Pro / Element Plus 的后台管理模板 |
| 主色调 | #1890ff（操作蓝），危险色 #ff4d4f，成功色 #52c41a |
| 表格 | 默认分页 20 条/页，支持列设置、全屏切换、数据导出 |
| 表单 | 关键配置项需二次确认，API Key 等敏感字段需权限验证后脱敏显示 |
| 状态标识 | 启用(绿)、停用(灰)、灰度中(橙)、异常(红) |
| 操作反馈 | 所有写操作需 toast 提示成功/失败，失败时展示具体原因 |
| 面包屑 | 每页顶部展示完整路径面包屑导航 |

---

## 4. 模块详细设计

### 4.1 模型供应商管理

#### 4.1.1 供应商列表页

**页面路径**: AI管理 > 模型供应商管理

**功能描述**: 展示所有已接入的大模型供应商及其整体状态。

**页面布局**:

```
┌──────────────────────────────────────────────────────────────┐
│  模型供应商管理                          [+ 新增供应商]       │
│  ┌──────────────┐ ┌────────┐ ┌──────────┐                  │
│  │ 供应商名称    │ │ 状态   │ │ 协议类型  │  [搜索] [重置]   │
│  └──────────────┘ └────────┘ └──────────┘                  │
├──────────────────────────────────────────────────────────────┤
│ 供应商名称    │ 协议   │ 模型数 │ 状态   │ 健康度 │ 操作      │
├───────────────┼────────┼────────┼────────┼────────┼──────────┤
│ OpenAI        │ OpenAI │ 4      │ 🟢启用 │ 99.2%  │ 编辑/停用 │
│ Azure OpenAI  │ Azure  │ 3      │ 🟢启用 │ 99.5%  │ 编辑/停用 │
│ Anthropic     │ Claude │ 2      │ 🟢启用 │ 98.8%  │ 编辑/停用 │
│ 通义千问       │ DashSc │ 3      │ 🟢启用 │ 99.0%  │ 编辑/停用 │
│ DeepSeek      │ OpenAI │ 2      │ 🟠灰度 │ 97.5%  │ 编辑/停用 │
│ 百度文心       │ ERNIE  │ 2      │ ⚫停用 │  -     │ 编辑/启用 │
└──────────────────────────────────────────────────────────────┘
```

**健康度计算**: 最近 1 小时内 API 调用成功率（成功调用数 / 总调用数），低于 95% 标红。

#### 4.1.2 新增/编辑供应商表单

**交互流程**: 点击「新增供应商」→ 弹出抽屉(Drawer)表单 → 填写配置 → 测试连接 → 保存

**表单字段**:

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|:---:|------|
| 供应商名称 | 文本输入 | ✅ | 自定义名称，如"OpenAI生产环境" |
| 供应商编码 | 文本输入 | ✅ | 唯一标识，如 `openai_prod`，保存后不可修改 |
| 协议类型 | 下拉选择 | ✅ | OpenAI兼容 / Azure / Claude / DashScope / ERNIE / 自定义 |
| Base URL | 文本输入 | ✅ | API 基础地址，如 `https://api.openai.com/v1` |
| API Key | 密码输入 | ✅ | 加密存储，编辑时显示 `****`，需点击「显示」并二次验证 |
| 备用API Key | 密码输入 | ❌ | 主Key异常时自动切换 |
| 请求超时(ms) | 数字输入 | ✅ | 默认 30000，范围 5000-120000 |
| 最大重试次数 | 数字输入 | ✅ | 默认 2，范围 0-5 |
| 重试间隔(ms) | 数字输入 | ✅ | 默认 1000，指数退避基数 |
| 代理地址 | 文本输入 | ❌ | HTTP 代理，如 `http://127.0.0.1:7897` |
| 备注 | 文本域 | ❌ | 供应商描述和用途说明 |
| 状态 | 开关 | ✅ | 启用/停用/灰度 |

**连接测试**: 表单底部提供「测试连接」按钮，发送一个轻量级 ping 请求（如 `GET /models`），展示:
- ✅ 连接成功 - 响应延迟: 234ms - 可用模型数: 12
- ❌ 连接失败 - 错误原因: Authentication failed (401)

#### 4.1.3 供应商数据结构

```typescript
// 供应商配置
interface ModelProvider {
  id: string;                    // UUID
  providerCode: string;          // 唯一编码，如 'openai_prod'
  providerName: string;          // 显示名称
  protocolType: ProtocolType;    // 协议类型
  baseUrl: string;               // API 基础地址
  apiKeyEncrypted: string;       // 加密后的 API Key
  backupApiKeyEncrypted: string; // 加密后的备用 Key
  timeoutMs: number;             // 请求超时
  maxRetries: number;            // 最大重试次数
  retryIntervalMs: number;       // 重试间隔基数
  proxyUrl: string | null;       // 代理地址
  remark: string;                // 备注
  status: ProviderStatus;        // active | inactive | grayscale
  healthScore: number;           // 健康度评分 0-100
  lastHealthCheckAt: string;     // 最后健康检查时间 ISO8601
  createdBy: string;             // 创建人
  createdAt: string;             // 创建时间
  updatedBy: string;             // 最后修改人
  updatedAt: string;             // 最后修改时间
}

type ProtocolType = 'openai_compatible' | 'azure_openai' | 'anthropic' 
                  | 'dashscope' | 'ernie' | 'custom';

type ProviderStatus = 'active' | 'inactive' | 'grayscale';
```

#### 4.1.4 供应商管理 API

**列表查询**

```
GET /api/admin/ai-providers
Query: page=1&size=20&keyword=&status=
Response:
{
  "code": 0,
  "data": {
    "total": 6,
    "items": [ModelProvider, ...]
  }
}
```

**创建供应商**

```
POST /api/admin/ai-providers
Body: Omit<ModelProvider, 'id'|'healthScore'|'lastHealthCheckAt'|'createdAt'|'updatedAt'>
Response: { "code": 0, "data": { "id": "xxx" } }
```

**更新供应商**

```
PUT /api/admin/ai-providers/{id}
Body: Partial<ModelProvider>
Response: { "code": 0 }
```

**测试连接**

```
POST /api/admin/ai-providers/{id}/test-connection
Response:
{
  "code": 0,
  "data": {
    "success": true,
    "latencyMs": 234,
    "availableModels": ["gpt-4o", "gpt-4o-mini", ...],
    "errorMessage": null
  }
}
```

**手动健康检查**

```
POST /api/admin/ai-providers/{id}/health-check
Response:
{
  "code": 0,
  "data": {
    "healthScore": 99,
    "successRate": 0.992,
    "avgLatencyMs": 856,
    "lastError": null
  }
}
```

---

### 4.2 模型实例管理

#### 4.2.1 模型实例列表页

**页面路径**: AI管理 > 模型供应商管理 > [点击供应商] > 模型实例

**功能描述**: 管理某供应商下的具体模型实例及其参数配置。

**页面布局**:

```
┌──────────────────────────────────────────────────────────────┐
│  OpenAI生产环境 > 模型实例                  [+ 绑定模型]      │
├──────────────────────────────────────────────────────────────┤
│ 模型标识        │ 显示名称   │ 能力标签        │ 状态  │ 操作  │
├────────────────┼────────────┼────────────────┼───────┼───────┤
│ gpt-4o         │ GPT-4o     │ 推理,多模态     │ 🟢启用│ 编辑  │
│ gpt-4o-mini    │ GPT-4o Mini│ 通用,轻量       │ 🟢启用│ 编辑  │
│ o1-preview     │ O1预览版   │ 深度推理        │ 🟠灰度│ 编辑  │
│ text-embedding │ Embed-V3   │ 向量嵌入        │ 🟢启用│ 编辑  │
└──────────────────────────────────────────────────────────────┘
```

#### 4.2.2 模型实例编辑表单

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|:---:|------|
| 模型标识 | 文本输入 | ✅ | 供应商API中的模型名，如 `gpt-4o` |
| 显示名称 | 文本输入 | ✅ | 后台展示名，如 "GPT-4o旗舰模型" |
| 供应商 | 关联选择 | ✅ | 关联到供应商，新增时自动填充 |
| 模型类别 | 下拉选择 | ✅ | chat / completion / embedding / vision / speech |
| 能力标签 | 多选标签 | ✅ | 通用问答、深度推理、数学解题、多模态理解、代码、创意写作、嵌入向量化 |
| 上下文窗口 | 数字输入 | ✅ | Token 窗口大小，如 128000 |
| 最大输出 | 数字输入 | ✅ | 最大输出 Token 数，如 16384 |
| 温度默认值 | 滑块 | ✅ | 0.0-2.0，默认 0.7 |
| Top-P 默认值 | 滑块 | ✅ | 0.0-1.0，默认 1.0 |
| 支持流式 | 开关 | ✅ | 是否支持 SSE 流式输出 |
| 支持函数调用 | 开关 | ✅ | 是否支持 Function Calling |
| 输入单价 | 数字输入 | ❌ | 每1K Token 价格（用于成本统计） |
| 输出单价 | 数字输入 | ❌ | 每1K Token 价格 |
| 灰度比例 | 滑块 | ✅ | 0-100%，仅在状态为灰度时生效 |
| 状态 | 单选 | ✅ | 启用 / 停用 / 灰度中 |

#### 4.2.3 模型实例数据结构

```typescript
interface ModelInstance {
  id: string;
  providerId: string;             // 关联供应商ID
  modelId: string;                // 模型标识，如 'gpt-4o'
  displayName: string;            // 显示名称
  modelCategory: ModelCategory;   // 模型类别
  capabilities: ModelCapability[];// 能力标签
  contextWindow: number;          // 上下文窗口大小
  maxOutputTokens: number;        // 最大输出Token数
  defaultTemperature: number;     // 默认温度
  defaultTopP: number;            // 默认Top-P
  supportsStreaming: boolean;     // 支持流式
  supportsFunctionCall: boolean;  // 支持函数调用
  inputPricePer1K: number | null; // 输入单价（元/千Token）
  outputPricePer1K: number | null;// 输出单价（元/千Token）
  grayscaleRatio: number;         // 灰度比例 0-100
  status: InstanceStatus;         // active | inactive | grayscale
  sort: number;                   // 排序权重
  createdAt: string;
  updatedAt: string;
}

type ModelCategory = 'chat' | 'completion' | 'embedding' 
                   | 'vision' | 'speech' | 'reasoning';

type ModelCapability = 'general_qa' | 'deep_reasoning' | 'math_solving' 
                     | 'multimodal' | 'coding' | 'creative_writing' 
                     | 'embedding' | 'function_calling';
```

#### 4.2.4 模型实例 API

```
GET  /api/admin/ai-providers/{providerId}/models
POST /api/admin/ai-providers/{providerId}/models
PUT  /api/admin/ai-models/{id}
DELETE /api/admin/ai-models/{id}   // 软删除，需确认无场景引用
PATCH /api/admin/ai-models/{id}/status   // 快速切换状态
```

**删除前校验**:

```json
// 删除前检查接口
GET /api/admin/ai-models/{id}/usage-check
Response:
{
  "code": 0,
  "data": {
    "canDelete": false,
    "references": [
      { "type": "route_rule", "id": "r-001", "name": "小学数学问答路由" },
      { "type": "ab_experiment", "id": "exp-003", "name": "GPT4o vs Claude 作文批改" }
    ],
    "message": "该模型被 2 处引用，无法删除。请先移除引用后重试。"
  }
}
```

---

### 4.3 Prompt模板管理

#### 4.3.1 Prompt模板列表页

**页面路径**: AI管理 > Prompt模板管理

**功能描述**: 管理所有场景的 Prompt 模板，支持按场景、学科、学段、状态筛选。

**页面布局**:

```
┌──────────────────────────────────────────────────────────────┐
│  Prompt模板管理                          [+ 新建模板]        │
│  ┌──────────┐ ┌────────┐ ┌────────┐ ┌──────┐               │
│  │ 场景      │ │ 学科   │ │ 学段   │ │ 状态  │ [搜索] [重置] │
│  └──────────┘ └────────┘ └────────┘ └──────┘               │
├──────────────────────────────────────────────────────────────┤
│ 模板名称           │ 场景      │ 学段  │ 当前版本 │ 状态  │ 操作        │
├────────────────────┼───────────┼───────┼──────────┼───────┼────────────┤
│ 小学数学讲解Prompt  │ 知识讲解  │ 小学  │ v3.2     │ 🟢上线│ 编辑/版本/测试│
│ 初中物理解题Prompt  │ 理科解题  │ 初中  │ v2.1     │ 🟢上线│ 编辑/版本/测试│
│ 高中作文批改Prompt  │ 作文批改  │ 高中  │ v1.4     │ 🟠灰度│ 编辑/版本/测试│
│ 拼音识字陪练Prompt  │ 启蒙辅导  │ 幼儿  │ v1.0     │ 🟡草稿│ 编辑/版本/测试│
│ 英语口语对话Prompt  │ 口语陪练  │ 全学段 │ v2.3    │ 🟢上线│ 编辑/版本/测试│
└──────────────────────────────────────────────────────────────┘
```

#### 4.3.2 Prompt编辑器（核心交互）

**交互设计**: 点击「编辑」或「新建模板」→ 进入全屏 Prompt 编辑器页面

**编辑器布局**:

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← 返回   小学数学讲解Prompt                     [保存草稿] [发布]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌── 基本信息 ────────────────────────────────────────────────┐    │
│  │ 模板名称: [小学数学讲解Prompt          ]                    │    │
│  │ 场景:    [知识讲解 ▼]  学科: [数学 ▼]  学段: [小学 ▼]      │    │
│  │ 描述:    [用简明语言讲解小学数学知识点，使用生活化例子     ]│    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌── 变量定义 ────────────────────────────────────────────────┐    │
│  │ 可用变量:                                                   │    │
│  │  {{question}}      学生问题                                 │    │
│  │  {{grade}}         学生年级                                 │    │
│  │  {{textbook_ver}}  教材版本                                 │    │
│  │  {{knowledge}}     关联知识点                               │    │
│  │  {{rag_context}}   RAG检索上下文                            │    │
│  │  {{history}}       对话历史                                 │    │
│  │  [+ 新增自定义变量]                                         │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌── Prompt 内容编辑器 ───────────────────────────────────────┐    │
│  │                                                            │    │
│  │  ┌─ Tab: System Prompt ─┬─ Tab: User Prompt Template ─┐   │    │
│  │  │                                                    │   │    │
│  │  │  你是一位经验丰富的小学数学老师，正在辅导一名        │   │    │
│  │  │  {{grade}}学生，使用{{textbook_ver}}教材。           │   │    │
│  │  │                                                    │   │    │
│  │  │  ## 辅导原则                                        │   │    │
│  │  │  1. 使用简明、生活化的语言                           │   │    │
│  │  │  2. 先给思路提示，再逐步展开                         │   │    │
│  │  │  3. 避免直接给出答案                                 │   │    │
│  │  │                                                    │   │    │
│  │  │  ## 知识点上下文                                     │   │    │
│  │  │  {{rag_context}}                                    │   │    │
│  │  │                                                    │   │    │
│  │  │  ## 学生问题                                        │   │    │
│  │  │  {{question}}                                       │   │    │
│  │  │                                                    │   │    │
│  │  │  请按照辅导原则进行讲解。█                           │   │    │
│  │  │                                                    │   │    │
│  │  │  [Monaco Editor - 支持语法高亮]                    │   │    │
│  │  └────────────────────────────────────────────────────┘   │    │
│  │  字数: 342  |  估算Token: ~180  |  变量引用: 5个           │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌── 参数配置 ────────────────────────────────────────────────┐    │
│  │ Temperature: [────●────] 0.3   (偏低，保证输出稳定性)       │    │
│  │ Max Tokens:  [1024    ]                                    │    │
│  │ Top-P:       [──●──────] 0.9                               │    │
│  │ Stop:        []                                            │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌── 测试沙箱 ────────────────────────────────────────────────┐    │
│  │ 测试变量填充:                                               │    │
│  │  question:    [一道三年级的应用题：小明有5个苹果...]        │    │
│  │  grade:       [三年级 ▼]                                    │    │
│  │  textbook_ver:[人教版 ▼]                                    │    │
│  │  knowledge:   [加减法应用 ▼]                               │    │
│  │  rag_context: [自动检索 ▼] ── 或手动粘贴                   │    │
│  │                                                             │    │
│  │  [执行测试]  测试模型: [gpt-4o ▼]                          │    │
│  │                                                             │    │
│  │  ┌─ 输出结果 ─────────────────────────────────────────┐    │    │
│  │  │ 好的，让我们一起来解决这个问题！                    │    │    │
│  │  │                                                    │    │    │
│  │  │ 首先，小明有5个苹果，分给3个朋友...                 │    │    │
│  │  │                                                    │    │    │
│  │  │ [流式输出中...] ✓ 完成                             │    │    │
│  │  │                                                    │    │    │
│  │  │ 耗时: 3.2s | 输入Token: 215 | 输出Token: 89         │    │    │
│  │  └────────────────────────────────────────────────────┘    │    │
│  └────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

**编辑器核心特性**:

1. **Monaco Editor 集成**: 使用 Monaco Editor（VS Code 同款），支持 `{{variable}}` 语法高亮、自动补全
2. **变量实时校验**: 未定义变量标红波浪线，悬停提示"未定义的变量: xxx"
3. **Token 估算**: 实时显示 Prompt 内容的 Token 估算值（基于 tiktoken 或等价库）
4. **版本对比**: 编辑器右侧可展开历史版本面板，选中两个版本进行 diff 对比
5. **自动保存草稿**: 每 30 秒自动保存到草稿，离开页面时提示保存

#### 4.3.3 Prompt模板数据结构

```typescript
// Prompt 模板主表
interface PromptTemplate {
  id: string;
  templateName: string;           // 模板名称
  sceneCode: string;              // 场景编码，如 'knowledge_explain'
  subject: Subject | 'all';       // 学科
  gradeStage: GradeStage | 'all'; // 学段
  description: string;            // 模板描述
  variables: PromptVariable[];    // 变量定义
  currentVersionId: string | null;// 当前上线版本ID
  status: PromptStatus;           // draft | online | grayscale | offline
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// Prompt 版本
interface PromptVersion {
  id: string;
  templateId: string;             // 关联模板ID
  versionNumber: string;          // 版本号，如 'v3.2'
  systemPrompt: string;           // System Prompt 内容
  userPromptTemplate: string;     // User Prompt 模板
  temperature: number;            // 温度参数
  maxTokens: number;              // 最大输出Token
  topP: number;                   // Top-P
  stop: string[];                 // 停止序列
  changeLog: string;              // 版本变更说明
  publishedAt: string | null;     // 发布时间
  publishedBy: string | null;     // 发布人
  status: VersionStatus;          // draft | published | archived
  createdAt: string;
  createdBy: string;
}

// 变量定义
interface PromptVariable {
  key: string;                    // 变量名，如 'question'
  label: string;                  // 显示标签
  type: 'text' | 'select' | 'auto_retrieve';
  required: boolean;
  defaultValue: string | null;
  description: string;
  // 当 type 为 select 时
  options: { label: string; value: string }[];
  // 当 type 为 auto_retrieve 时
  retrieveConfig: {
    source: 'rag' | 'user_profile' | 'textbook' | 'knowledge_graph';
    params: Record<string, string>;
  } | null;
}

type PromptStatus = 'draft' | 'online' | 'grayscale' | 'offline';
type VersionStatus = 'draft' | 'published' | 'archived';
type Subject = 'chinese' | 'math' | 'english' | 'physics' | 'chemistry' 
             | 'biology' | 'history' | 'geography' | 'politics';
type GradeStage = 'preschool' | 'primary' | 'junior' | 'senior';
```

#### 4.3.4 Prompt模板 API

**模板 CRUD**

```
GET    /api/admin/prompt-templates                    // 列表
POST   /api/admin/prompt-templates                    // 创建模板（含首个草稿版本）
GET    /api/admin/prompt-templates/{id}               // 模板详情
PUT    /api/admin/prompt-templates/{id}               // 更新基本信息
DELETE /api/admin/prompt-templates/{id}               // 删除（仅草稿可删）
PATCH  /api/admin/prompt-templates/{id}/status        // 状态切换
```

**版本管理**

```
GET    /api/admin/prompt-templates/{id}/versions      // 版本列表
POST   /api/admin/prompt-templates/{id}/versions      // 基于当前草稿创建新版本
GET    /api/admin/prompt-templates/{id}/versions/{vid}// 版本详情
PUT    /api/admin/prompt-templates/{id}/versions/{vid}// 编辑草稿版本
POST   /api/admin/prompt-templates/{id}/versions/{vid}/publish  // 发布版本
POST   /api/admin/prompt-templates/{id}/versions/{vid}/rollback // 回滚到此版本
GET    /api/admin/prompt-templates/{id}/versions/diff?v1={vid1}&v2={vid2}  // 版本对比
```

**发布流程**:

```
POST /api/admin/prompt-templates/{id}/versions/{vid}/publish
Body:
{
  "publishStrategy": "immediate" | "grayscale",
  "grayscaleRatio": 20,          // 当 strategy=grayscale 时
  "changeLog": "优化数学举例的生活化程度，减少解题跳步"
}
Response:
{
  "code": 0,
  "data": {
    "versionNumber": "v3.3",
    "status": "published",
    "effectiveAt": "2026-07-22T11:40:00Z"
  }
}
```

**Prompt 测试沙箱**

```
POST /api/admin/prompt-templates/{id}/test
Body:
{
  "versionId": "pv-xxx",
  "modelId": "gpt-4o",
  "variables": {
    "question": "小明有5个苹果，分给3个朋友，每人几个？",
    "grade": "三年级",
    "textbook_ver": "人教版",
    "knowledge": "除法应用",
    "rag_context": "可选的手动上下文"
  }
}
Response (SSE 流式):
data: {"type":"chunk","content":"好的"}
data: {"type":"chunk","content":"，让我们"}
data: {"type":"chunk","content":"一起来解决..."}
data: {"type":"done","usage":{"inputTokens":215,"outputTokens":89},"latencyMs":3200}
```

---

### 4.4 场景路由策略

#### 4.4.1 场景路由总览页

**页面路径**: AI管理 > 场景路由策略

**功能描述**: 配置不同学习场景的 AI 调用路由规则，决定每个场景使用哪个模型、哪个 Prompt、什么参数。

**场景列表**:

| 场景编码 | 场景名称 | 默认模型 | 当前Prompt | 灰度比例 | 状态 | 操作 |
|---------|---------|---------|-----------|---------|------|------|
| `knowledge_explain` | 知识点讲解 | gpt-4o-mini | 小学讲解v3.2 | - | 🟢 | 编辑 |
| `math_solving` | 数学解题 | o1-preview | 初中理科v2.1 | 20% | 🟠 | 编辑 |
| `essay_grading` | 作文批改 | claude-3.5 | 高中作文v1.4 | - | 🟢 | 编辑 |
| `oral_practice` | 口语陪练 | gpt-4o-mini | 英语口语v2.3 | - | 🟢 | 编辑 |
| `pinyin_teach` | 拼音识字 | gpt-4o-mini | 启蒙辅导v1.0 | - | 🟡 | 编辑 |
| `error_analysis` | 错题归因 | gpt-4o | 错题分析v2.0 | - | 🟢 | 编辑 |

#### 4.4.2 路由规则编辑器

**页面路径**: 场景路由策略 > [点击场景] > 编辑路由规则

**交互布局**:

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← 返回   数学解题 - 路由规则配置                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌── 基础配置 ────────────────────────────────────────────────┐    │
│  │ 场景名称: [数学解题          ]                              │    │
│  │ 场景编码: [math_solving     ] (不可修改)                    │    │
│  │ 场景描述: [理科数学题目的分步解题和公式推导                ]│    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌── 路由策略链 (按优先级从上到下) ───────────────────────────┐    │
│  │                                                            │    │
│  │  优先级1: 条件路由                                         │    │
│  │  ┌─ 条件 ─────────────────────────────────────────────┐   │    │
│  │  │ 当 学段 = [高中 ▼] AND 题目难度 ∈ [hard, expert]  │   │    │
│  │  └───────────────────────────────────────────────────┘   │    │
│  │  ┌─ 使用 ─────────────────────────────────────────────┐   │    │
│  │  │ 模型: [o1-preview ▼]                                │   │    │
│  │  │ Prompt: [高中理科解题Prompt v2.1 ▼]                │   │    │
│  │  │ Temperature: 0.2   MaxTokens: 4096                  │   │    │
│  │  └───────────────────────────────────────────────────┘   │    │
│  │                                              [删除] [上移] │    │
│  │                                                            │    │
│  │  优先级2: 条件路由                                         │    │
│  │  ┌─ 条件 ─────────────────────────────────────────────┐   │    │
│  │  │ 当 学段 ∈ [初中, 高中] AND 学科 = [数学 ▼]         │   │    │
│  │  └───────────────────────────────────────────────────┘   │    │
│  │  ┌─ 使用 ─────────────────────────────────────────────┐   │    │
│  │  │ 模型: [gpt-4o ▼]                                    │   │    │
│  │  │ Prompt: [初中理科解题Prompt v2.1 ▼]                │   │    │
│  │  │ Temperature: 0.3   MaxTokens: 2048                  │   │    │
│  │  └───────────────────────────────────────────────────┘   │    │
│  │                                              [删除] [下移] │    │
│  │                                                            │    │
│  │  默认路由 (兜底)                                           │    │
│  │  ┌─ 使用 ─────────────────────────────────────────────┐   │    │
│  │  │ 模型: [gpt-4o-mini ▼]                               │   │    │
│  │  │ Prompt: [通用讲解Prompt v1.0 ▼]                    │   │    │
│  │  │ Temperature: 0.5   MaxTokens: 2048                  │   │    │
│  │  └───────────────────────────────────────────────────┘   │    │
│  │                                                            │    │
│  │  [+ 添加条件路由]                                          │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌── 降级链配置 ──────────────────────────────────────────────┐    │
│  │ 当主模型不可用时，按顺序尝试:                               │    │
│  │  1. [gpt-4o ▼]        (主模型)                             │    │
│  │  2. [claude-3.5 ▼]    (降级1)                              │    │
│  │  3. [qwen-max ▼]      (降级2)                              │    │
│  │  4. [缓存/预设回复]   (最终兜底)                           │    │
│  │  [+ 添加降级模型]                                          │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                     │
│                                            [取消] [保存配置]        │
└─────────────────────────────────────────────────────────────────────┘
```

#### 4.4.3 路由策略数据结构

```typescript
// 场景路由配置
interface SceneRouteConfig {
  id: string;
  sceneCode: string;              // 场景编码
  sceneName: string;              // 场景名称
  description: string;
  rules: RouteRule[];             // 路由规则链（有序）
  fallbackChain: FallbackItem[];  // 降级链
  updatedAt: string;
  updatedBy: string;
}

// 单条路由规则
interface RouteRule {
  id: string;
  priority: number;               // 优先级序号
  conditions: RouteCondition[];   // 匹配条件（AND关系）
  target: RouteTarget;            // 命中后的目标配置
  enabled: boolean;
}

// 路由条件
interface RouteCondition {
  field: ConditionField;          // 条件字段
  operator: ConditionOperator;    // 操作符
  values: string[];               // 条件值
}

type ConditionField = 'grade_stage' | 'subject' | 'difficulty' 
                    | 'question_type' | 'member_level' | 'time_range';
type ConditionOperator = 'eq' | 'neq' | 'in' | 'not_in' | 'gt' | 'lt';

// 路由目标
interface RouteTarget {
  modelId: string;                // 模型实例ID
  promptTemplateId: string;       // Prompt模板ID
  promptVersionId: string;        // Prompt版本ID
  temperature: number;
  maxTokens: number;
  topP: number;
  extraParams: Record<string, any>; // 额外参数
}

// 降级链项
interface FallbackItem {
  order: number;
  modelId: string;
  promptTemplateId: string;
  promptVersionId: string;
  degradeStrategy: 'retry_same_prompt' | 'simplified_prompt' | 'cache_only';
}
```

#### 4.4.4 路由策略 API

```
GET  /api/admin/scene-routes                     // 场景列表
GET  /api/admin/scene-routes/{sceneCode}         // 场景路由详情
PUT  /api/admin/scene-routes/{sceneCode}         // 更新路由配置
POST /api/admin/scene-routes/{sceneCode}/rules   // 新增路由规则
PUT  /api/admin/scene-routes/{sceneCode}/rules/{ruleId}  // 编辑规则
DELETE /api/admin/scene-routes/{sceneCode}/rules/{ruleId} // 删除规则
POST /api/admin/scene-routes/{sceneCode}/rules/{ruleId}/toggle  // 启用/禁用规则

// 路由模拟测试
POST /api/admin/scene-routes/{sceneCode}/simulate
Body:
{
  "gradeStage": "senior",
  "subject": "math",
  "difficulty": "hard",
  "questionType": "application"
}
Response:
{
  "code": 0,
  "data": {
    "matchedRule": {
      "priority": 1,
      "conditions": [...],
      "target": {
        "modelId": "o1-preview",
        "promptName": "高中理科解题Prompt v2.1",
        "temperature": 0.2
      }
    },
    "fallbackChain": ["o1-preview", "gpt-4o", "qwen-max"]
  }
}
```

---

### 4.5 成本与用量管控

#### 4.5.1 用量看板页

**页面路径**: AI管理 > 成本与用量管控

**页面布局**:

```
┌──────────────────────────────────────────────────────────────────────┐
│  成本与用量管控                        时间范围: [今日 ▼]  [导出]    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌── 概览卡片 ────────────────────────────────────────────────┐     │
│  │ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │     │
│  │ │ 今日总消耗    │ │ 总调用次数    │ │ 平均延迟      │        │     │
│  │ │ ¥1,234.56    │ │ 45,678       │ │ 1.2s         │        │     │
│  │ │ ↑12% vs昨日  │ │ ↑8% vs昨日   │ │ ↓0.1s vs昨日 │        │     │
│  │ └──────────────┘ └──────────────┘ └──────────────┘        │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  ┌── 趋势图 ──────────────────────────────────────────────────┐     │
│  │  [折线图] 近30天每日成本趋势                                │     │
│  │  [切换] 按场景 / 按模型 / 按学科                            │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  ┌── 场景消耗明细 ────────────────────────────────────────────┐     │
│  │ 场景          │ 调用次数  │ 输入Token │ 输出Token │ 成本    │     │
│  │ │    占比      │           │           │           │         │     │
│  ├───────────────┼───────────┼───────────┼───────────┼─────────┤     │
│  │ 知识讲解       │ 15,234    │ 3.2M      │ 1.8M      │ ¥356   │     │
│  │ 数学解题       │ 8,901     │ 2.1M      │ 1.2M      │ ¥412   │     │
│  │ 作文批改       │ 3,456     │ 0.9M      │ 0.5M      │ ¥234   │     │
│  │ 口语陪练       │ 12,345    │ 1.5M      │ 2.1M      │ ¥198   │     │
│  │ 其他           │ 5,742     │ 1.1M      │ 0.6M      │ ¥34    │     │
│  └───────────────┴───────────┴───────────┴───────────┴─────────┘     │
│                                                                      │
│  ┌── 模型消耗排行 ────────────────────────────────────────────┐     │
│  │ gpt-4o-mini   ████████████████████  ¥456 (37%)             │     │
│  │ gpt-4o        ██████████████        ¥332 (27%)             │     │
│  │ o1-preview    ██████████            ¥234 (19%)             │     │
│  │ claude-3.5    ███████               ¥156 (13%)             │     │
│  │ 其他           ██                    ¥56  (4%)              │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  ┌── 预算告警 ────────────────────────────────────────────────┐     │
│  │ ⚠ 场景"数学解题"今日消耗 ¥412，已达日预算 ¥400 的 103%     │     │
│  │ ⚠ 模型"o1-preview"近1小时调用量异常增长 +150%              │     │
│  └────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
```

#### 4.5.2 预算配置

**预算规则配置页面**:

| 配置项 | 类型 | 说明 |
|--------|------|------|
| 日预算上限 | 数字 | 全局每日 AI 调用成本上限（元） |
| 月预算上限 | 数字 | 全局每月 AI 调用成本上限（元） |
| 场景预算 | 键值对列表 | 各场景的日预算上限 |
| 超额动作 | 单选 | 仅告警 / 降级到更便宜模型 / 暂停服务 |
| 告警阈值 | 滑块 | 达到预算的百分之多少时告警（默认80%） |
| 告警通知渠道 | 多选 | 站内消息 / 邮件 / 钉钉 / 企业微信 |

```typescript
interface CostBudgetConfig {
  globalDailyBudget: number;              // 全局日预算（元）
  globalMonthlyBudget: number;            // 全局月预算（元）
  sceneBudgets: SceneBudget[];            // 场景级预算
  exceedAction: 'alert_only'              // 超额动作
              | 'downgrade_model' 
              | 'pause_service';
  alertThresholdPercent: number;          // 告警阈值百分比（默认80）
  alertChannels: AlertChannel[];          // 告警渠道
  updatedAt: string;
  updatedBy: string;
}

interface SceneBudget {
  sceneCode: string;
  dailyBudget: number;
  modelDowngradeTo: string | null;        // 降级到的模型ID
}
```

#### 4.5.3 用量管控 API

```
// 用量查询
GET /api/admin/ai-usage/overview?date=2026-07-22
GET /api/admin/ai-usage/by-scene?startDate=&endDate=
GET /api/admin/ai-usage/by-model?startDate=&endDate=
GET /api/admin/ai-usage/trend?days=30&groupBy=scene|model|subject

// 预算配置
GET /api/admin/ai-budget
PUT /api/admin/ai-budget

// 告警规则
GET /api/admin/ai-budget/alerts
POST /api/admin/ai-budget/alerts
PUT /api/admin/ai-budget/alerts/{id}
DELETE /api/admin/ai-budget/alerts/{id}
```

---

### 4.6 操作审计与变更日志

#### 4.6.1 审计日志列表

**页面路径**: AI管理 > 操作审计日志

**列表字段**:

| 时间 | 操作人 | 操作类型 | 目标对象 | 变更摘要 | 操作前 | 操作后 |
|------|--------|---------|---------|---------|--------|--------|
| 2026-07-22 11:30 | admin@primetop | 更新Prompt版本 | 小学数学讲解Prompt | 发布v3.3 | v3.2 | v3.3 |
| 2026-07-22 10:15 | ai_eng@primetop | 更新路由规则 | 数学解题场景 | 新增条件路由 | 2条规则 | 3条规则 |
| 2026-07-22 09:00 | admin@primetop | 编辑供应商 | DeepSeek | 修改API Key | - | - |
| 2026-07-21 18:00 | ai_eng@primetop | 切换模型状态 | o1-preview | 停用→灰度 | inactive | grayscale |

**审计日志数据结构**:

```typescript
interface AuditLog {
  id: string;
  timestamp: string;               // 操作时间
  operatorId: string;              // 操作人ID
  operatorName: string;            // 操作人名称
  operationType: AuditOpType;      // 操作类型
  targetType: AuditTargetType;     // 目标对象类型
  targetId: string;                // 目标对象ID
  targetName: string;              // 目标对象名称
  changeSummary: string;           // 变更摘要
  beforeSnapshot: object | null;   // 操作前快照（JSON）
  afterSnapshot: object | null;    // 操作后快照（JSON）
  ipAddress: string;               // 操作IP
  userAgent: string;               // 浏览器UA
}

type AuditOpType = 'create' | 'update' | 'delete' | 'publish' 
                 | 'rollback' | 'status_change' | 'test';

type AuditTargetType = 'provider' | 'model_instance' | 'prompt_template' 
                     | 'prompt_version' | 'scene_route' | 'cost_budget';
```

**审计日志查询**:

```
GET /api/admin/ai-audit-logs
Query: 
  page=1&size=20
  &operatorId=
  &operationType=
  &targetType=
  &startDate=&endDate=
Response: { code: 0, data: { total, items: [AuditLog, ...] } }
```

**配置回滚**:

```
POST /api/admin/ai-audit-logs/{id}/rollback
Response: { code: 0, data: { "rolledBackTo": "...", "newLogId": "..." } }
```

> **注意**: 回滚操作本身也会生成一条新的审计日志，形成完整的变更链条。

---

## 5. 关键业务流程

### 5.1 Prompt 上线流程

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ 创建/编辑  │────→│ 沙箱测试  │────→│ 发布申请  │────→│ 上线生效  │
│  草稿     │     │  验证    │     │  审批    │     │          │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                        │               │
                        │ 未通过        │ 驳回
                        ↓               ↓
                   修改后重试       修改后重新提交
```

**状态流转**:

```
                 保存草稿              测试通过，申请发布          审批通过
  [空] ──────────→ draft ──────────────→ review ───────────────→ published
                     ↑                      │                       │
                     │                      │ 驳回                   │ 回滚
                     │                      ↓                       │
                     │                   rejected                  ↓
                     └──────────────────────┘              archived (归档)
```

**审批规则**:

| 变更类型 | 审批要求 |
|---------|---------|
| 新建 Prompt | AI工程师审核 |
| 修改已有上线Prompt | AI工程师 + 运营负责人双审 |
| 紧急回滚 | AI工程师单审即可 |
| 灰度发布 | AI工程师审核 |

### 5.2 模型切换流程

```
管理员发起模型切换
        │
        ├──→ 选择目标场景
        ├──→ 选择新模型实例
        ├──→ 配置灰度策略（可选）
        │
        ↓
   系统校验
        │
        ├──→ ✅ 模型可用 → 配置灰度比例 → 生效
        ├──→ ❌ 模型未启用 → 提示先启用模型
        └──→ ❌ Prompt不兼容 → 提示变量不匹配
```

### 5.3 超额降级流程

```
实时监控用量
    │
    ├── 用量 < 80% 预算 → 正常服务
    │
    ├── 用量 ≥ 80% 预算 → 触发告警通知
    │
    ├── 用量 ≥ 100% 预算 → 按超额动作执行:
    │     ├── alert_only → 仅告警，继续服务
    │     ├── downgrade_model → 该场景自动降级到更便宜的模型
    │     └── pause_service → 该场景返回"今日额度已用完"提示
    │
    └── 次日 00:00 → 预算重置，恢复服务
```

---

## 6. 前端组件设计

### 6.1 核心可复用组件

#### 6.1.1 PromptEditor 组件

```typescript
// Props
interface PromptEditorProps {
  value: PromptContent;          // { systemPrompt, userPromptTemplate }
  variables: PromptVariable[];   // 可用变量列表
  onChange: (value: PromptContent) => void;
  readOnly?: boolean;
  height?: number;               // 编辑器高度，默认 400
}

// 功能特性:
// 1. 基于 Monaco Editor 封装
// 2. {{}} 变量语法高亮 + 自动补全
// 3. 未定义变量标红波浪线
// 4. Token 实时估算
// 5. 全屏编辑模式
// 6. 查找替换 (Ctrl+F / Ctrl+H)
```

#### 6.1.2 ModelSelector 组件

```typescript
interface ModelSelectorProps {
  value: string;                 // 选中的模型实例ID
  onChange: (modelId: string) => void;
  filter?: {                     // 过滤条件
    providerId?: string;
    capabilities?: ModelCapability[];
    status?: InstanceStatus;
  };
  placeholder?: string;
}
```

#### 6.1.3 RouteConditionBuilder 组件

```typescript
interface RouteConditionBuilderProps {
  value: RouteCondition[];
  onChange: (conditions: RouteCondition[]) => void;
  // 提供可视化条件构建器:
  // - 字段下拉选择 (grade_stage, subject, difficulty...)
  // - 操作符切换 (等于/包含/大于...)
  // - 值多选 (基于字段自动加载选项)
}
```

#### 6.1.4 CostTrendChart 组件

```typescript
interface CostTrendChartProps {
  data: {
    date: string;
    cost: number;
    calls: number;
  }[];
  groupBy?: 'scene' | 'model' | 'subject';
  chartType?: 'line' | 'bar' | 'stacked-area';
}
// 基于 ECharts / Recharts 渲染
```

### 6.2 页面路由

```typescript
// 前端路由定义 (React Router 示例)
const routes = [
  {
    path: '/admin/ai',
    component: AILayout,           // AI管理布局（侧边导航）
    children: [
      { path: 'providers', component: ProviderList },
      { path: 'providers/:id/models', component: ModelInstanceList },
      { path: 'prompts', component: PromptTemplateList },
      { path: 'prompts/:id/edit', component: PromptEditorPage },
      { path: 'prompts/:id/versions', component: PromptVersionList },
      { path: 'routes', component: SceneRouteList },
      { path: 'routes/:sceneCode', component: SceneRouteEditor },
      { path: 'cost', component: CostDashboard },
      { path: 'audit', component: AuditLogList },
    ]
  }
];
```

---

## 7. 后端服务设计

### 7.1 服务模块划分

```
ai-admin-service/
├── controller/
│   ├── ProviderController.java        // 供应商管理
│   ├── ModelInstanceController.java   // 模型实例管理
│   ├── PromptTemplateController.java  // Prompt模板管理
│   ├── SceneRouteController.java      // 场景路由管理
│   ├── CostBudgetController.java      // 成本预算管理
│   └── AuditLogController.java        // 审计日志
├── service/
│   ├── ProviderService.java
│   ├── ModelInstanceService.java
│   ├── PromptTemplateService.java
│   ├── PromptVersionService.java
│   ├── PromptTestSandboxService.java
│   ├── SceneRouteService.java
│   ├── CostBudgetService.java
│   ├── AuditLogService.java
│   └── ConfigPublishService.java      // 配置发布与缓存刷新
├── domain/
│   ├── ModelProvider.java
│   ├── ModelInstance.java
│   ├── PromptTemplate.java
│   ├── PromptVersion.java
│   ├── SceneRouteConfig.java
│   ├── CostBudgetConfig.java
│   └── AuditLog.java
├── repository/
│   ├── ProviderRepository.java
│   ├── ModelInstanceRepository.java
│   ├── PromptTemplateRepository.java
│   ├── PromptVersionRepository.java
│   ├── SceneRouteRepository.java
│   └── AuditLogRepository.java
└── config/
    ├── CryptoConfig.java             // 加密配置（API Key加密）
    └── AiAdminCacheConfig.java       // 缓存配置
```

### 7.2 配置热更新机制

当管理员在后台修改了模型配置、Prompt版本、路由规则等，需要让线上服务实时感知，避免重启。

```java
@Service
public class ConfigPublishService {
    
    private final RedisTemplate<String, String> redisTemplate;
    private final ApplicationEventPublisher eventPublisher;
    
    /**
     * 发布配置变更事件
     * 通过 Redis Pub/Sub 通知所有服务实例刷新本地缓存
     */
    public void publishConfigChange(ConfigChangeEvent event) {
        // 1. 更新 Redis 中的配置版本号
        String configKey = buildConfigKey(event.getTargetType(), event.getTargetId());
        redisTemplate.opsForValue().set(configKey, event.getNewVersion());
        
        // 2. 发布 Redis 消息通知所有实例
        redisTemplate.convertAndSend(
            "ai:config:change",
            JsonUtils.toJson(event)
        );
        
        // 3. 记录审计日志
        auditLogService.recordChange(event);
    }
}

// 配置变更事件
@Data
public class ConfigChangeEvent {
    private ConfigTargetType targetType;  // PROVIDER, MODEL, PROMPT, ROUTE
    private String targetId;
    private String operatorId;
    private String oldVersion;
    private String newVersion;
    private long timestamp;
    private ConfigChangeAction action;    // UPDATE, PUBLISH, ROLLBACK, STATUS_CHANGE
}
```

### 7.3 数据库表设计

```sql
-- 模型供应商表
CREATE TABLE ai_model_provider (
    id              VARCHAR(36) PRIMARY KEY,
    provider_code   VARCHAR(64) NOT NULL UNIQUE,
    provider_name   VARCHAR(128) NOT NULL,
    protocol_type   VARCHAR(32) NOT NULL,
    base_url        VARCHAR(512) NOT NULL,
    api_key_enc     TEXT NOT NULL,           -- AES-256 加密
    backup_api_key_enc TEXT,
    timeout_ms      INT DEFAULT 30000,
    max_retries     INT DEFAULT 2,
    retry_interval_ms INT DEFAULT 1000,
    proxy_url       VARCHAR(256),
    remark          TEXT,
    status          VARCHAR(16) DEFAULT 'inactive',
    health_score    DECIMAL(5,2) DEFAULT 0,
    last_health_at  TIMESTAMP,
    created_by      VARCHAR(64) NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by      VARCHAR(64),
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      TIMESTAMP NULL,
    INDEX idx_status (status),
    INDEX idx_provider_code (provider_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 模型实例表
CREATE TABLE ai_model_instance (
    id              VARCHAR(36) PRIMARY KEY,
    provider_id     VARCHAR(36) NOT NULL,
    model_id        VARCHAR(128) NOT NULL,     -- 如 'gpt-4o'
    display_name    VARCHAR(128) NOT NULL,
    model_category  VARCHAR(32) NOT NULL,
    capabilities    JSON NOT NULL DEFAULT '[]',
    context_window  INT NOT NULL,
    max_output_tokens INT NOT NULL,
    default_temperature DECIMAL(3,2) DEFAULT 0.70,
    default_top_p   DECIMAL(3,2) DEFAULT 1.00,
    supports_streaming BOOLEAN DEFAULT TRUE,
    supports_function_call BOOLEAN DEFAULT FALSE,
    input_price_per_1k DECIMAL(10,4),
    output_price_per_1k DECIMAL(10,4),
    grayscale_ratio INT DEFAULT 0,
    status          VARCHAR(16) DEFAULT 'inactive',
    sort_order      INT DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      TIMESTAMP NULL,
    FOREIGN KEY (provider_id) REFERENCES ai_model_provider(id),
    INDEX idx_provider (provider_id),
    INDEX idx_status (status),
    INDEX idx_category (model_category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Prompt模板表
CREATE TABLE prompt_template (
    id              VARCHAR(36) PRIMARY KEY,
    template_name   VARCHAR(128) NOT NULL,
    scene_code      VARCHAR(64) NOT NULL,
    subject         VARCHAR(32) DEFAULT 'all',
    grade_stage     VARCHAR(32) DEFAULT 'all',
    description     TEXT,
    variables       JSON NOT NULL DEFAULT '[]',
    current_version_id VARCHAR(36),
    status          VARCHAR(16) DEFAULT 'draft',
    created_by      VARCHAR(64) NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by      VARCHAR(64),
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      TIMESTAMP NULL,
    INDEX idx_scene (scene_code),
    INDEX idx_status (status),
    INDEX idx_subject_grade (subject, grade_stage)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Prompt版本表
CREATE TABLE prompt_version (
    id              VARCHAR(36) PRIMARY KEY,
    template_id     VARCHAR(36) NOT NULL,
    version_number  VARCHAR(16) NOT NULL,
    system_prompt   MEDIUMTEXT NOT NULL,
    user_prompt_template MEDIUMTEXT,
    temperature     DECIMAL(3,2) DEFAULT 0.70,
    max_tokens      INT DEFAULT 2048,
    top_p           DECIMAL(3,2) DEFAULT 1.00,
    stop_sequences  JSON DEFAULT '[]',
    change_log      TEXT,
    status          VARCHAR(16) DEFAULT 'draft',
    published_at    TIMESTAMP NULL,
    published_by    VARCHAR(64),
    created_by      VARCHAR(64) NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (template_id) REFERENCES prompt_template(id),
    UNIQUE KEY uk_template_version (template_id, version_number),
    INDEX idx_template (template_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 场景路由配置表
CREATE TABLE scene_route_config (
    id              VARCHAR(36) PRIMARY KEY,
    scene_code      VARCHAR(64) NOT NULL UNIQUE,
    scene_name      VARCHAR(128) NOT NULL,
    description     TEXT,
    rules           JSON NOT NULL DEFAULT '[]',
    fallback_chain  JSON NOT NULL DEFAULT '[]',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by      VARCHAR(64),
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_scene (scene_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 成本预算配置表
CREATE TABLE cost_budget_config (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    config_key      VARCHAR(64) NOT NULL UNIQUE,   -- 'global' 或 scene_code
    daily_budget    DECIMAL(12,2),
    monthly_budget  DECIMAL(12,2),
    exceed_action   VARCHAR(32) DEFAULT 'alert_only',
    downgrade_model_id VARCHAR(36),
    alert_threshold INT DEFAULT 80,
    alert_channels  JSON DEFAULT '[]',
    updated_by      VARCHAR(64),
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- AI管理审计日志表
CREATE TABLE ai_admin_audit_log (
    id              VARCHAR(36) PRIMARY KEY,
    timestamp       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    operator_id     VARCHAR(64) NOT NULL,
    operator_name   VARCHAR(128) NOT NULL,
    operation_type  VARCHAR(32) NOT NULL,
    target_type     VARCHAR(32) NOT NULL,
    target_id       VARCHAR(64) NOT NULL,
    target_name     VARCHAR(256),
    change_summary  TEXT,
    before_snapshot JSON,
    after_snapshot  JSON,
    ip_address      VARCHAR(64),
    user_agent      VARCHAR(512),
    INDEX idx_timestamp (timestamp),
    INDEX idx_operator (operator_id),
    INDEX idx_target (target_type, target_id),
    INDEX idx_operation (operation_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 8. 错误处理与安全设计

### 8.1 统一错误码

| 错误码 | HTTP状态 | 说明 | 处理方式 |
|--------|---------|------|---------|
| `AI_ADMIN_001` | 400 | 供应商编码已存在 | 提示更换编码 |
| `AI_ADMIN_002` | 400 | 模型被引用，无法删除 | 列出引用详情，要求先移除 |
| `AI_ADMIN_003` | 400 | Prompt变量未定义: {var} | 标红未定义变量 |
| `AI_ADMIN_004` | 400 | Prompt版本号已存在 | 提示更换版本号 |
| `AI_ADMIN_005` | 400 | 路由规则条件冲突 | 展示冲突的规则 |
| `AI_ADMIN_006` | 403 | 无权限执行此操作 | 提示联系管理员 |
| `AI_ADMIN_007` | 400 | API Key 格式不正确 | 提示检查格式 |
| `AI_ADMIN_008` | 503 | 供应商连接测试失败 | 展示具体错误信息 |
| `AI_ADMIN_009` | 400 | 场景编码不存在 | 提示有效的场景编码 |
| `AI_ADMIN_010` | 409 | Prompt已有待审核版本 | 提示先处理待审核版本 |

### 8.2 敏感数据保护

1. **API Key 加密**: 使用 AES-256-GCM 对称加密，密钥从 KMS 或环境变量获取
2. **脱敏显示**: API Key 仅展示前4位和后4位，如 `sk-x...3a2f`
3. **权限校验**: 查看/修改敏感字段需额外验证（二次密码输入或 OTP）
4. **传输安全**: 所有 API 强制 HTTPS，关键写操作添加 CSRF Token
5. **操作溯源**: 所有配置变更记录操作人、IP、时间、变更前后快照

### 8.3 并发冲突处理

```java
// 使用乐观锁防止并发修改冲突
@Service
public class PromptTemplateService {
    
    public PromptVersion publishVersion(String templateId, String versionId, 
                                         PublishRequest req, Long expectedVersion) {
        // 乐观锁校验
        PromptTemplate template = repository.findById(templateId);
        if (!template.getVersion().equals(expectedVersion)) {
            throw new ConcurrentModificationException(
                "模板已被其他用户修改，请刷新后重试"
            );
        }
        // ... 发布逻辑
    }
}
```

---

## 9. 性能与缓存设计

### 9.1 缓存策略

| 缓存对象 | 缓存介质 | TTL | 失效策略 |
|---------|---------|-----|---------|
| 供应商配置 | Redis + 本地 | 30min | 配置变更时主动刷新 |
| 模型实例配置 | Redis + 本地 | 30min | 配置变更时主动刷新 |
| Prompt模板(上线版) | Redis + 本地 | 60min | 发布/回滚时主动刷新 |
| 场景路由配置 | Redis + 本地 | 30min | 配置变更时主动刷新 |
| 预算配置 | Redis | 10min | 变更时主动刷新 |
| 审计日志列表 | 不缓存 | - | 实时查询 |

### 9.2 热更新流程

```
管理员保存配置
    │
    ├──→ 写入数据库
    ├──→ 更新 Redis 缓存（覆盖旧值）
    ├──→ 发布 Redis Pub/Sub 消息: "ai:config:change"
    │
    ↓
各业务服务实例收到消息
    │
    ├──→ 清除本地缓存
    ├──→ 从 Redis 重新加载最新配置
    └──→ 记录日志: "配置已刷新: {targetType} {targetId}"
```

---

## 10. 管理后台与其他模块的协作关系

```
┌───────────────────┐         ┌─────────────────────┐
│  本工作台          │         │  AI对话引擎          │
│  (模型/Prompt/     │────────→│  运行时读取路由配置   │
│   路由/成本)       │  配置    │  选择模型+Prompt     │
│                   │  下发    │  执行AI调用          │
└───────┬───────────┘         └─────────────────────┘
        │                              │
        │                          用量回流
        ↓                              │
┌───────────────────┐         ┌────────┴────────────┐
│  审计服务          │         │  成本统计服务        │
│  记录所有变更      │←────────│  统计Token消耗       │
│                   │  告警    │  计算实时成本        │
└───────────────────┘         └─────────────────────┘
        │
        │ 变更通知
        ↓
┌───────────────────┐
│  运营数据看板      │
│  展示配置变更趋势  │
│  AI调用质量监控    │
└───────────────────┘
```

**数据流向说明**:

1. **配置下发**: 本工作台 → Redis缓存 → AI对话引擎运行时读取
2. **用量回流**: AI对话引擎 → 消息队列 → 成本统计服务 → 本工作台用量看板
3. **变更审计**: 本工作台 → 审计日志表 → 可查询/回滚
4. **告警联动**: 成本统计服务 → 超额检测 → 告警通道（站内/邮件/钉钉）

---

## 11. 附录

### 11.1 场景编码标准

| 场景编码 | 中文名称 | 说明 |
|---------|---------|------|
| `knowledge_explain` | 知识讲解 | 概念讲解、知识点说明 |
| `math_solving` | 理科解题 | 数学/物理/化学/生物解题 |
| `essay_grading` | 作文批改 | 作文审题、润色、评分 |
| `oral_practice` | 口语陪练 | 英语口语、语文朗读 |
| `recitation` | 背诵检测 | 课文背诵、单词记忆 |
| `pinyin_teach` | 拼音识字 | 拼音学习、汉字识记 |
| `error_analysis` | 错题归因 | 错因分析、知识点关联 |
| `study_plan` | 学习规划 | 计划生成、任务拆解 |
| `photo_search` | 拍照搜题 | OCR识别后题目解答 |
| `general_qa` | 通用问答 | 不属于特定场景的通用问题 |

### 11.2 供应商协议适配说明

```java
// 供应商适配器接口
public interface ModelProviderAdapter {
    
    /**
     * 发送 Chat 请求
     */
    ChatResponse chat(ChatRequest request, ProviderConfig config);
    
    /**
     * 发送流式 Chat 请求
     */
    Flux<ChatChunk> chatStream(ChatRequest request, ProviderConfig config);
    
    /**
     * 生成 Embedding
     */
    EmbeddingResponse embed(EmbeddingRequest request, ProviderConfig config);
    
    /**
     * 测试连接
     */
    HealthCheckResult healthCheck(ProviderConfig config);
}

// OpenAI 兼容适配器
@Component("openai_compatible")
public class OpenAICompatibleAdapter implements ModelProviderAdapter {
    // 覆盖 OpenAI / DeepSeek / 通义千问(兼容模式) 等
}

// Azure OpenAI 适配器
@Component("azure_openai")
public class AzureOpenAIAdapter implements ModelProviderAdapter {
    // Azure 特有的 deployment-id 模式
}

// Anthropic Claude 适配器
@Component("anthropic")
public class ClaudeAdapter implements ModelProviderAdapter {
    // Claude API 格式
}
```

### 11.3 Token 估算工具

```typescript
// 前端 Token 估算（粗略估算，非精确）
function estimateTokens(text: string): number {
  // 中文：约 1 字 ≈ 1.5 token
  // 英文：约 4 字符 ≈ 1 token
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars * 1.5 + otherChars / 4);
}

// 精确估算建议调用后端接口
// POST /api/admin/ai-tools/estimate-tokens
// Body: { "text": "..." }
// Response: { "tokens": 180, "model": "gpt-4o" }
```

---

## 12. 版本记录

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| v1.0 | 2026-07-22 | 初始版本，包含供应商管理、模型实例管理、Prompt模板管理、场景路由、成本管控、审计日志 |
